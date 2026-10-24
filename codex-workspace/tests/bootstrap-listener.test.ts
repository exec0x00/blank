import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { consumeBootstrapListenerEnvironment } from '../server/bootstrap-listener';
import { loadConfig } from '../server/config';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = path.join(root, 'tests/fixtures/bootstrap-listener-process.ts');
const password = 'bootstrap-loopback-fixture-password';
const readyLine = 'codex-workspace-ready-v1\n';
const privateKeys = ['CODEX_BOOTSTRAP_LISTEN_FD', 'CODEX_BOOTSTRAP_READY_FD'];
const configEnvironment = { NODE_ENV: 'test', WORKSPACE_PASSWORD: password,
  SESSION_SECRET: 'bootstrap-test-session-key-not-real-12345678', ENCRYPTION_KEY: 'bootstrap-test-credential-key-not-real-12345678' };

// Python is the real descriptor owner. Node receives child copies through
// pass_fds, exactly as in app.py; no HTTP, SSE or websocket proxy is involved.
const parentProgram = String.raw`
import json, os, select, socket, subprocess, sys, time
mode, node, fixture, directory = sys.argv[1:]
listener = socket.socket()
listener.bind(('127.0.0.1', 0)); listener.listen(16); listener.setblocking(False)
ready_read, ready_write = os.pipe2(os.O_CLOEXEC | os.O_NONBLOCK)
extra_sockets, extra_fds = [], []
listen_fd, ready_fd = listener.fileno(), ready_write
if mode == 'invalid-listener-file':
    listen_fd = os.open(os.path.join(directory, 'invalid-listener'), os.O_RDWR | os.O_CREAT, 0o600)
    extra_fds.append(listen_fd)
elif mode == 'invalid-ready-file':
    ready_fd = os.open(os.path.join(directory, 'invalid-ready'), os.O_RDWR | os.O_CREAT, 0o600)
    extra_fds.append(ready_fd)
elif mode == 'invalid-ready-read':
    ready_fd = ready_read
elif mode == 'invalid-ready-blocking':
    os.set_blocking(ready_write, True)
elif mode == 'invalid-unbound':
    other = socket.socket(); extra_sockets.append(other); listen_fd = other.fileno()
elif mode == 'invalid-connected':
    client = socket.create_connection(listener.getsockname())
    connected, _ = listener.accept()
    extra_sockets.extend([client, connected]); listen_fd = connected.fileno()
elif mode == 'invalid-unix':
    first, second = socket.socketpair()
    extra_sockets.extend([first, second]); listen_fd = first.fileno()
if mode == 'ready-closed':
    os.close(ready_read); ready_read = None
elif mode == 'ready-full':
    while True:
        try: os.write(ready_write, b'x' * 4096)
        except BlockingIOError: break
environment = os.environ.copy()
environment.update({
    'CODEX_BOOTSTRAP_LISTEN_FD': str(listen_fd), 'CODEX_BOOTSTRAP_READY_FD': str(ready_fd),
    'PORT': str(listener.getsockname()[1] + (1 if mode == 'invalid-port' else 0)), 'HOST': '127.0.0.1',
    'DATA_DIR': os.path.join(directory, 'data'), 'RUNTIME_DIR': os.path.join(directory, 'runtime'),
    'BOOTSTRAP_TEST_DIR': directory,
})
process = None
received = b''
try:
    process = subprocess.Popen([node, '--import', 'tsx', fixture, mode], env=environment, pass_fds=(listen_fd, ready_fd))
    os.close(ready_write); ready_write = None
    print(json.dumps({'kind': 'parent-bound', 'port': listener.getsockname()[1]}), flush=True)
    if ready_read is not None and mode != 'ready-full':
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if not select.select([ready_read], [], [], 0.1)[0]:
                continue
            chunk = os.read(ready_read, 128)
            received += chunk
            if b'\n' in received:
                print(json.dumps({'kind': 'parent-ready', 'record': received.decode()}), flush=True)
                break
            if not chunk: break
        else: raise RuntimeError('No bootstrap readiness result arrived.')
    code = process.wait(timeout=20)
    if ready_read is not None:
        while True:
            chunk = os.read(ready_read, 65536)
            if not chunk: break
            received += chunk
    # Node closing or failing must not destroy the parent's original listener.
    probe = socket.create_connection(listener.getsockname(), timeout=2)
    if not select.select([listener], [], [], 2)[0]: raise RuntimeError('Parent listener was lost.')
    accepted, _ = listener.accept()
    accepted.sendall(b'parent retained listener'); accepted.close()
    survived = probe.recv(100) == b'parent retained listener'; probe.close()
    print(json.dumps({'kind': 'parent-finished', 'code': code, 'parentSurvived': survived,
        'exactReady': received == b'codex-workspace-ready-v1\n', 'readyBytes': len(received)}), flush=True)
    sys.exit(code)
finally:
    if process is not None and process.poll() is None:
        process.terminate()
        try: process.wait(timeout=5)
        except subprocess.TimeoutExpired: process.kill(); process.wait()
    for number in [ready_read, ready_write, *extra_fds]:
        if number is not None: os.close(number)
    for item in extra_sockets: item.close()
    listener.close()
`;

type Message = { kind: string; [key: string]: unknown };
interface Fixture {
  child: ChildProcessWithoutNullStreams;
  directory: string;
  messages: Message[];
  closed: Promise<number | null>;
  message(kind: string): Promise<Message>;
  diagnostics(): string;
}
const fixtures: Fixture[] = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    if (!fixture.child.stdin.destroyed && !fixture.child.stdin.writableEnded) fixture.child.stdin.end('stop\n');
    let timer: NodeJS.Timeout | undefined;
    const ended = await Promise.race([fixture.closed.then(() => true), new Promise<boolean>(resolve => {
      timer = setTimeout(() => resolve(false), 10_000);
    })]);
    clearTimeout(timer);
    if (!ended) {
      process.kill(-fixture.child.pid!, 'SIGTERM');
      await fixture.closed;
    }
    await fs.rm(fixture.directory, { recursive: true, force: true });
  }
});

async function start(mode: string): Promise<Fixture> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-bootstrap-listener-'));
  const child = spawn('python3', ['-u', '-c', parentProgram, mode, process.execPath, fixture, directory], {
    cwd: root, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, LANG: 'C.UTF-8', ...configEnvironment, CODEX_CLI_TEST_START: '0' },
  });
  const events = new EventEmitter(); const messages: Message[] = [];
  let diagnostics = ''; let exited = false;
  child.stderr.on('data', bytes => { diagnostics = (diagnostics + String(bytes)).slice(-8000); });
  child.on('error', error => { diagnostics += String(error); });
  createInterface({ input: child.stdout }).on('line', line => {
    try { const message = JSON.parse(line) as Message; messages.push(message); events.emit('message', message); }
    catch { diagnostics = (diagnostics + line).slice(-8000); }
  });
  const closed = new Promise<number | null>(resolve => child.once('close', code => { exited = true; events.emit('ended'); resolve(code); }));
  const result: Fixture = { child, directory, messages, closed, diagnostics: () => diagnostics, message(kind) {
    const existing = messages.find(value => value.kind === kind);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const finish = (error?: Error, message?: Message) => {
        clearTimeout(timeout); events.off('message', onMessage); events.off('ended', onEnd);
        if (error) reject(error); else resolve(message!);
      };
      const onMessage = (message: Message) => { if (message.kind === kind) finish(undefined, message); };
      const onEnd = () => finish(new Error(`Bootstrap fixture ended before ${kind}: ${diagnostics}`));
      const timeout = setTimeout(() => finish(new Error(`Timed out awaiting ${kind}: ${diagnostics}`)), 15_000);
      events.on('message', onMessage); events.once('ended', onEnd);
      if (exited) onEnd();
    });
  } };
  fixtures.push(result); return result;
}

async function finish(fixture: Fixture) {
  const checked = await fixture.message('checked');
  const parent = await fixture.message('parent-finished');
  expect(await fixture.closed, fixture.diagnostics()).toBe(0);
  expect(parent.parentSurvived).toBe(true);
  return { checked, parent };
}

describe('bootstrap activation configuration', () => {
  it('preserves ordinary launches and consumes both private variables before runtime setup', () => {
    expect(loadConfig({ ...configEnvironment })).not.toHaveProperty('bootstrapListener');
    const env = { ...configEnvironment, CODEX_BOOTSTRAP_LISTEN_FD: '31', CODEX_BOOTSTRAP_READY_FD: '32' };
    expect(loadConfig(env).bootstrapListener).toEqual({ fd: 31, readyFd: 32 });
    for (const key of privateKeys) expect(env).not.toHaveProperty(key);
  });

  it.each([
    ['3', undefined], [undefined, '4'], ['', '4'], ['3', ''], ['0', '4'], ['1', '4'], ['2', '4'],
    ['3', '0'], ['3', '1'], ['3', '2'], ['3', '3'], ['-1', '4'], ['+3', '4'], ['03', '4'],
    ['3.0', '4'], ['3e1', '4'], [' 3', '4'], ['3\n', '4'], ['Infinity', '4'], ['2147483648', '4'],
  ])('rejects incomplete or malformed activation (%s, %s) and always scrubs it', (fd, readyFd) => {
    const env = { CODEX_BOOTSTRAP_LISTEN_FD: fd, CODEX_BOOTSTRAP_READY_FD: readyFd };
    expect(() => consumeBootstrapListenerEnvironment(env)).toThrow('configuration is invalid');
    for (const key of privateKeys) expect(env).not.toHaveProperty(key);
  });
});

describe.runIf(process.platform === 'linux')('real inherited bootstrap descriptors', () => {
  it.each(['listener-file', 'ready-file', 'ready-read', 'ready-blocking', 'unbound', 'connected', 'unix', 'port'])(
    'rejects invalid %s without taking ownership of unrelated descriptors', async mode => {
      const result = await finish(await start(`invalid-${mode}`));
      expect(result.checked.invalidPreserved).toBe(true);
      expect(result.parent.readyBytes).toBe(0);
    },
  );

  it.each(['reuse-listener', 'reuse-ready', 'listen-failure', 'ready-changed-flags'])(
    'unwinds %s and preserves descriptors reused during initialization', async mode => {
      const result = await finish(await start(mode));
      expect(result.checked.ownedClosed).toBe(true);
      expect(result.checked.reusedPreserved).toBe(mode.startsWith('reuse-'));
      expect(result.parent.readyBytes).toBe(0);
    },
  );

  it.each(['initialize-failure', 'application-listen-failure', 'ready-closed', 'ready-full'])(
    'drains the real application and inherited copies after %s', async mode => {
      const result = await finish(await start(mode));
      expect(result.checked).toMatchObject({ runtimeClosed: true, ownedClosed: true, descendants: { leaked: false, privateEnvironment: false } });
      expect(result.parent.exactReady).toBe(false);
    },
  );

  it('serves authenticated HTTP, SSE and a real terminal websocket directly on the inherited port', async () => {
    const fixture = await start('application');
    const bound = await fixture.message('parent-bound');
    const ready = await fixture.message('parent-ready');
    const application = await fixture.message('application-ready');
    expect(ready.record).toBe(readyLine);
    expect(application.descendants).toEqual({ leaked: false, privateEnvironment: false });
    const origin = `http://127.0.0.1:${bound.port}`;
    const root = await fetch(origin, { signal: AbortSignal.timeout(5000) });
    expect(root.status).toBe(200); expect(await root.text()).toBe('status: ok');
    const refused = await fetch(`${origin}/api/workspaces/${application.workspaceId}`, { signal: AbortSignal.timeout(5000) });
    expect(refused.status).toBe(401); await refused.arrayBuffer();
    const login = await fetch(`${origin}/api/session`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Codex-Workspace': '1' },
      body: JSON.stringify({ password }), signal: AbortSignal.timeout(5000) });
    expect(login.status).toBe(200); expect(await login.json()).toEqual({ authenticated: true });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const headers = { Cookie: cookie, Origin: origin, 'X-Codex-Workspace': '1' };
    const workspace = await fetch(`${origin}/api/workspaces/${application.workspaceId}`, { headers, signal: AbortSignal.timeout(5000) });
    expect(workspace.status).toBe(200); expect(await workspace.json()).toMatchObject({ id: application.workspaceId });

    const eventsUrl = `${origin}/api/threads/${application.threadId}/events`;
    const deniedStream = await fetch(eventsUrl, { signal: AbortSignal.timeout(5000) });
    expect(deniedStream.status).toBe(401); await deniedStream.arrayBuffer();
    const events = await fetch(eventsUrl, { headers, signal: AbortSignal.timeout(5000) });
    expect(events.status).toBe(200); expect(events.headers.get('content-type')).toContain('text/event-stream');
    const reader = events.body!.getReader(); let snapshot = '';
    try {
      while (!snapshot.includes('Retained stream bytes.')) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error(`SSE ended before its retained snapshot: ${snapshot}`);
        snapshot += new TextDecoder().decode(chunk.value);
      }
      expect(snapshot).toContain('"type":"snapshot"');
    } finally { await reader.cancel(); }

    const created = await fetch(`${origin}/api/workspaces/${application.workspaceId}/terminals`, { method: 'POST', headers, signal: AbortSignal.timeout(5000) });
    expect(created.status).toBe(201);
    const terminal = await created.json() as { id: string };
    const address = `${origin.replace('http:', 'ws:')}/ws/terminal/${terminal.id}`;
    const denied = new WebSocket(address, { headers: { Origin: origin }, handshakeTimeout: 5000 });
    denied.on('error', () => {});
    const status = await new Promise<number | undefined>((resolve, reject) => {
      denied.once('unexpected-response', (_request, response) => { response.resume(); denied.terminate(); resolve(response.statusCode); });
      denied.once('open', () => { denied.close(); reject(new Error('Unauthenticated websocket was admitted.')); });
      denied.once('error', reject);
    });
    expect(status).toBe(401);
    const socket = new WebSocket(address, { headers, handshakeTimeout: 5000 });
    let output = ''; const messages: Array<{ type: string; data?: string }> = [];
    socket.on('message', bytes => {
      const message = JSON.parse(String(bytes)) as { type: string; data?: string }; messages.push(message);
      if (message.type === 'output') output += message.data;
    });
    try {
      await once(socket, 'open');
      await vi.waitFor(() => expect(messages.some(message => message.type === 'ready')).toBe(true));
      socket.send(JSON.stringify({ type: 'input', data: "printf '\\036inherited-terminal\\037\\n'\r" }));
      await vi.waitFor(() => expect(output).toContain('\x1einherited-terminal\x1f'), { timeout: 5000 });
    } finally {
      const closing = once(socket, 'close'); socket.close(); await closing;
      const removed = await fetch(`${origin}/api/terminals/${terminal.id}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(5000) });
      expect(removed.status).toBe(200); await removed.arrayBuffer();
    }
    fixture.child.stdin.end('stop\n');
    const result = await finish(fixture);
    expect(result.checked).toMatchObject({ ownedClosed: true, runtimeClosed: true });
    expect(result.parent).toMatchObject({ exactReady: true, readyBytes: Buffer.byteLength(readyLine) });
  });
});
