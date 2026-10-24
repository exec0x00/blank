import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { connect as connectTcp, type AddressInfo, type Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import express, { type ErrorRequestHandler } from 'express';
import { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../server/context';
import { HttpError } from '../server/errors';
import { attachTerminalServer, createTerminalRouter, type TerminalAuthorizationOptions } from '../server/terminal';
import type { TerminalSession, Workspace } from '../shared/types';
import type { TerminalReplayState } from '../shared/terminal-replay';
import { TerminalReplay, TERMINAL_HISTORY_BYTES, TERMINAL_HISTORY_LINES, TERMINAL_OUTPUT_CHUNK } from '../server/terminal-replay';
import { renderedTerminal } from './terminal-render';

const cookie = 'test-session=terminal-integration';
const timeout = 5_000;

type TerminalMessage =
  | { type: 'ready'; session: TerminalSession; sessions?: TerminalSession[]; cols: number; rows: number; truncated: boolean; flowControl?: boolean; replay: { historyLines: number; historyLimit: number } }
  | { type: 'output'; data: string; sequence?: number; respond?: boolean }
  | { type: 'replay-complete'; state: TerminalReplayState; pending: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'exit'; exitCode: number }
  | { type: 'clear' }
  | { type: 'pong'; id: string }
  | { type: 'error'; message: string };

interface Connection {
  socket: WebSocket;
  messages: TerminalMessage[];
  output: string;
  closed?: { code: number; reason: string };
  error?: Error;
}

interface Fixture {
  server: Server;
  ctx: AppContext;
  dataDir: string;
  runtimeDir: string;
  workspace: Workspace;
  workspaces: Map<string, Workspace>;
  authenticated: boolean;
  failures: Array<{ status: number; code?: string; causeCode?: string; causeKind?: string }>;
  origin: string;
  checkConnections(): void;
  request(method: string, route: string, authenticated?: boolean): Promise<Response>;
  create(workspaceId?: string): Promise<TerminalSession>;
  connect(id: string, flowControl?: boolean, frameControl?: boolean): Promise<Connection>;
  open(options?: { requestId?: string; sessionId?: string; fresh?: boolean; cols?: number; rows?: number; flowControl?: boolean; frameControl?: boolean }): Promise<Connection>;
  rejectUpgrade(id: string, authenticated?: boolean, route?: string, extraHeaders?: Record<string, string>): Promise<number>;
  close(keepData?: boolean): Promise<void>;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function processExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

function ready(connection: Connection): Extract<TerminalMessage, { type: 'ready' }> {
  const message = connection.messages.find(message => message.type === 'ready');
  if (!message || message.type !== 'ready') throw new Error('No terminal ready message received');
  return message;
}

/** Framing uses actual control characters so echoed command text cannot satisfy an assertion. */
async function command(connection: Connection, source: string): Promise<string> {
  const marker = randomUUID();
  const begin = `\x1e${marker}:begin\x1f`;
  const end = `\x1e${marker}:end\x1f`;
  connection.socket.send(JSON.stringify({
    type: 'input',
    data: `printf '\\036${marker}:begin\\037\\n'; ${source}; printf '\\036${marker}:end\\037\\n'\r`,
  }));
  await expect.poll(() => connection.output.includes(end), { timeout }).toBe(true);
  const start = connection.output.indexOf(begin);
  expect(start).toBeGreaterThanOrEqual(0);
  return connection.output.slice(start + begin.length, connection.output.indexOf(end)).replace(/\r/g, '').trim();
}

async function disconnect(connection: Connection): Promise<void> {
  connection.socket.close(1000, 'Test reconnect');
  await expect.poll(() => connection.closed?.code, { timeout }).toBe(1000);
}

interface FixtureOptions {
  authorizeUpgrade?: (request: IncomingMessage, authenticated: boolean) => boolean | Promise<boolean>;
  authorizationTiming?: TerminalAuthorizationOptions;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function createFixture(existingDataDir?: string, options: FixtureOptions = {}): Promise<Fixture> {
  const dataDir = existingDataDir ?? await mkdtemp(path.join(os.tmpdir(), 'codex-terminal-test-'));
  const runtimeDir = await mkdtemp(path.join(await realpath(os.tmpdir()), 'codex-terminal-runtime-test-'));
  const workspace: Workspace = {
    id: 'terminal-project', name: 'Terminal project',
    path: path.join(dataDir, 'workspaces', 'terminal project'),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  await mkdir(workspace.path, { recursive: true });
  const workspaces = new Map([[workspace.id, workspace]]);
  const ctx = {
    config: { dataDir, homeDir: path.join(dataDir, 'home'), workspacesDir: path.join(dataDir, 'workspaces'), runtimeDir },
    events: new EventEmitter(),
    workspaces: {
      async get(id: string) {
        const entry = workspaces.get(id);
        if (!entry) throw new HttpError(404, 'Workspace not found.');
        return entry;
      },
      async resolvePath(id: string, relative: string) {
        const entry = workspaces.get(id);
        if (!entry) throw new HttpError(404, 'Workspace not found.');
        if (relative) throw new Error('The terminal must request the validated workspace root.');
        return realpath(entry.path);
      },
    },
  } as unknown as AppContext;
  const app = express();
  const server = createServer(app);
  const connections = new Set<WebSocket>();
  let fixture: Fixture;
  const authenticate = (request: IncomingMessage): boolean => fixture.authenticated && request.headers.cookie === cookie
    && (!request.headers.origin || request.headers.origin === fixture.origin);
  app.use('/api', (req, res, next) => {
    if (!authenticate(req)) { res.status(401).json({ error: 'Authentication required.' }); return; }
    next();
  }, express.json(), createTerminalRouter(ctx));
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const cause = error instanceof Error && error.cause && typeof error.cause === 'object'
      ? error.cause as { code?: unknown; message?: unknown } : undefined;
    fixture.failures.push({ status: error instanceof HttpError ? error.status : 500,
      ...(error instanceof HttpError && error.code ? { code: error.code } : {}),
      ...(typeof cause?.code === 'string' && /^E[A-Z0-9_]{1,40}$/.test(cause.code) ? { causeCode: cause.code } : {}),
      ...(typeof cause?.message === 'string' && /forkpty\(3\) failed|posix_spawnp failed/.test(cause.message) ? { causeKind: 'native PTY spawn failed' } : {}),
    });
    res.status(error instanceof HttpError ? error.status : 500).json({
      error: error instanceof Error ? error.message : 'Unexpected test server error',
      ...(error instanceof HttpError && error.code ? { code: error.code } : {}),
    });
  };
  app.use(errors);
  const intervals = vi.spyOn(globalThis, 'setInterval');
  const terminal = attachTerminalServer(server, ctx, (request) => options.authorizeUpgrade
    ? options.authorizeUpgrade(request, authenticate(request)) : authenticate(request), options.authorizationTiming);
  const checkConnections = intervals.mock.calls.find(([, delay]) => delay === 30_000)?.[0] as (() => void) | undefined;
  intervals.mockRestore();
  if (!checkConnections) throw new Error('Terminal connection maintenance was not registered.');
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const wsOrigin = origin.replace('http:', 'ws:');
  async function connect(route: string): Promise<Connection> {
    const socket = new WebSocket(`${wsOrigin}${route}`, { headers: { Cookie: cookie, Origin: origin } });
    connections.add(socket);
    const connection: Connection = { socket, messages: [], output: '' };
    socket.on('message', data => {
      const message = JSON.parse(data.toString()) as TerminalMessage;
      connection.messages.push(message);
      if (message.type === 'output') connection.output += message.data;
    });
    socket.on('close', (code, reason) => { connection.closed = { code, reason: reason.toString() }; });
    socket.on('error', error => { connection.error = error; });
    await expect.poll(() => connection.messages.some(message => message.type === 'ready'), { timeout }).toBe(true);
    return connection;
  }

  fixture = {
    server, ctx, dataDir, runtimeDir, workspace, workspaces, authenticated: true, failures: [], origin, checkConnections,
    request(method, route, authenticated = true) {
      return fetch(`${origin}/api${route}`, { method, headers: authenticated ? { Cookie: cookie } : {} });
    },
    async create(workspaceId = workspace.id) {
      const response = await fixture.request('POST', `/workspaces/${workspaceId}/terminals`);
      const body = await response.text();
      expect(response.status, `Terminal creation returned ${response.status}: ${body}`).toBe(201);
      return JSON.parse(body) as TerminalSession;
    },
    connect(id, flowControl = false, frameControl = false) { return connect(`/ws/terminal/${id}${flowControl ? `?flow=1${frameControl ? '&frames=1' : ''}` : ''}`); },
    open(options = {}) {
      const params = new URLSearchParams({ workspaceId: workspace.id, requestId: options.requestId ?? randomUUID(),
        cols: String(options.cols ?? 100), rows: String(options.rows ?? 28) });
      if (options.sessionId) params.set('sessionId', options.sessionId);
      if (options.fresh) params.set('new', '1');
      if (options.flowControl) params.set('flow', '1');
      if (options.frameControl) params.set('frames', '1');
      return connect(`/ws/terminal?${params}`);
    },
    rejectUpgrade(id, authenticated = true, route = `/ws/terminal/${id}`, extraHeaders = {}) {
      return new Promise<number>((resolve, reject) => {
        const socket = new WebSocket(`${wsOrigin}${route}`, {
          headers: { ...(authenticated ? { Cookie: cookie } : {}), ...extraHeaders },
        });
        connections.add(socket);
        let responseReceived = false;
        const timer = setTimeout(() => { socket.terminate(); reject(new Error('Upgrade rejection timed out')); }, timeout);
        socket.on('unexpected-response', (request, response) => {
          responseReceived = true;
          clearTimeout(timer);
          response.resume();
          request.destroy();
          resolve(response.statusCode ?? 0);
        });
        socket.on('error', error => {
          if (!responseReceived) { clearTimeout(timer); reject(error); }
        });
        socket.on('open', () => {
          clearTimeout(timer);
          socket.terminate();
          reject(new Error('An unauthorized or missing terminal accepted a WebSocket'));
        });
      });
    },
    async close(keepData = false) {
      await terminal.close();
      for (const socket of connections) socket.terminate();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await rm(runtimeDir, { recursive: true, force: true });
      if (!keepData) await rm(dataDir, { recursive: true, force: true });
    },
  };
  return fixture;
}

// The deployed host is Linux. Windows has different shell/PTY semantics, not a simulated fallback.
describe.skipIf(process.platform === 'win32')('real host terminal sessions', () => {
  let fixture: Fixture;
  beforeEach(async () => { fixture = await createFixture(); });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await fixture?.close();
  });

  it('starts an actual PTY in the selected workspace and applies resize messages', async () => {
    const session = await fixture.create();
    expect(session.workspaceId).toBe(fixture.workspace.id);
    expect(session.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(processExists(session.pid)).toBe(true);
    const connection = await fixture.connect(session.id);
    expect(ready(connection)).toMatchObject({ session, cols: 100, rows: 28, truncated: false });
    expect(await command(connection, 'pwd')).toBe(fixture.workspace.path);
    expect(await command(connection, 'printf "%s" "$$"')).toBe(String(session.pid));
    expect(await command(connection, "test -t 0 && test -t 1 && printf 'real-pty'")).toBe('real-pty');
    expect(await command(connection, 'stty size')).toBe('28 100');

    connection.socket.send(JSON.stringify({ type: 'resize', cols: 123, rows: 41 }));
    expect(await command(connection, 'stty size')).toBe('41 123');
    connection.socket.send(JSON.stringify({ type: 'resize', cols: 0, rows: 301 }));
    await expect.poll(() => connection.messages.some(message => message.type === 'error'), { timeout }).toBe(true);
    expect(await command(connection, 'stty size')).toBe('41 123');
    const listed = await fixture.request('GET', `/workspaces/${fixture.workspace.id}/terminals`);
    expect(await listed.json()).toEqual([session]);
  });

  it('keeps user state durable and disposable caches outside data while excluding deployment credentials and proxies', async () => {
    const forbidden = [
      'HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN', 'OPENAI_API_KEY', 'GITHUB_TOKEN', 'GH_TOKEN',
      'WORKSPACE_PASSWORD', 'SESSION_SECRET', 'ENCRYPTION_KEY', 'AWS_SECRET_ACCESS_KEY',
      'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
      'CODEX_TERMINAL_ARBITRARY_ENV', 'NODE_OPTIONS', 'PYTHONPATH', 'PIP_INDEX_URL', 'PIP_EXTRA_INDEX_URL',
      'npm_config_proxy', 'npm_config_https_proxy',
    ];
    for (const name of forbidden) vi.stubEnv(name, `terminal-fixture-${name}`);
    const session = await fixture.create();
    const connection = await fixture.connect(session.id);
    const homeKeys = [
      'HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'HF_HOME',
      'CARGO_HOME', 'RUSTUP_HOME', 'NPM_CONFIG_USERCONFIG', 'HISTFILE',
    ];
    const runtimeKeys = [
      'XDG_CACHE_HOME', 'XDG_RUNTIME_DIR', 'TMPDIR', 'TMP', 'TEMP', 'CODEX_RUNTIME_DIR', 'CODEX_BUILD_DIR', 'CODEX_DEPENDENCIES_DIR',
      'npm_config_cache', 'NPM_CONFIG_CACHE', 'npm_config_store_dir', 'PIP_CACHE_DIR', 'UV_CACHE_DIR', 'YARN_CACHE_FOLDER',
      'HF_HUB_CACHE', 'HUGGINGFACE_HUB_CACHE', 'HF_ASSETS_CACHE', 'HF_DATASETS_CACHE', 'HF_XET_CACHE', 'TRANSFORMERS_CACHE',
      'TORCH_HOME', 'TRITON_CACHE_DIR', 'CUDA_CACHE_PATH', 'CCACHE_DIR', 'SCCACHE_DIR', 'GOCACHE', 'GOMODCACHE',
      'NODE_COMPILE_CACHE', 'DENO_DIR', 'BUN_INSTALL_CACHE_DIR', 'COMPOSER_CACHE_DIR', 'PYTHONPYCACHEPREFIX',
      'MYPY_CACHE_DIR', 'NUMBA_CACHE_DIR', 'NUGET_PACKAGES',
    ];
    const script = `process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify([...forbidden, ...homeKeys, ...runtimeKeys, 'TERM'])}.map(k => [k, process.env[k] ?? null]))))`;
    const env = JSON.parse(await command(connection, `${shellQuote(process.execPath)} -e ${shellQuote(script)}`)) as Record<string, string | null>;
    for (const key of forbidden) expect(env[key], key).toBeNull();
    for (const key of homeKeys) {
      expect(env[key], key).toBeTypeOf('string');
      expect(path.relative(fixture.dataDir, env[key]!).startsWith('..'), key).toBe(false);
      expect(path.isAbsolute(env[key]!), key).toBe(true);
    }
    for (const key of runtimeKeys) {
      expect(env[key], key).toBeTypeOf('string');
      expect(path.isAbsolute(env[key]!), key).toBe(true);
      expect(path.relative(fixture.runtimeDir, env[key]!).startsWith('..'), key).toBe(false);
      for (const durable of ['/data', fixture.dataDir, fixture.ctx.config.homeDir]) {
        expect(path.relative(durable, env[key]!).startsWith(`..${path.sep}`), `${key} must be outside ${durable}`).toBe(true);
      }
      expect(await realpath(env[key]!), key).toBe(env[key]);
    }
    expect((await stat(fixture.runtimeDir)).mode & 0o077).toBe(0);
    expect(env.HOME).toBe(path.join(fixture.dataDir, 'home'));
    expect(env.HF_HOME).toBe(path.join(fixture.dataDir, 'home', '.cache', 'huggingface'));
    expect(env.TERM).toBe('xterm-256color');
    expect(env.CODEX_RUNTIME_DIR).toBe(fixture.runtimeDir);
    await command(connection, 'printf cache >"$npm_config_cache/terminal-cache-probe"; printf temporary >"$TMPDIR/terminal-temp-probe"; printf state >"$XDG_STATE_HOME/terminal-state-probe"');
    expect(await readFile(path.join(env.npm_config_cache!, 'terminal-cache-probe'), 'utf8')).toBe('cache');
    expect(await readFile(path.join(env.TMPDIR!, 'terminal-temp-probe'), 'utf8')).toBe('temporary');
    expect(await readFile(path.join(env.XDG_STATE_HOME!, 'terminal-state-probe'), 'utf8')).toBe('state');
  });

  it('rejects a disposable terminal directory inside durable data before spawning a shell', async () => {
    const invalid = path.join(fixture.dataDir, 'runtime');
    fixture.ctx.config.runtimeDir = invalid;
    const response = await fixture.request('POST', `/workspaces/${fixture.workspace.id}/terminals`);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'RUNTIME_STORAGE_UNSAFE' });
    expect(await (await fixture.request('GET', `/workspaces/${fixture.workspace.id}/terminals`)).json()).toEqual([]);
    await expect(access(invalid)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('identifies accepted human input separately from output, resize, replay and clear', async () => {
    const humanInputs: { workspaceId: string; sessionId: string }[] = [];
    fixture.ctx.events.on('workspace:user-terminal', event => humanInputs.push(event));
    const session = await fixture.create();
    const connection = await fixture.connect(session.id);
    expect(humanInputs).toEqual([]);
    connection.socket.send(JSON.stringify({ type: 'resize', cols: 101, rows: 29 }));
    expect(await command(connection, 'stty size')).toBe('29 101');
    expect(humanInputs).toEqual([{ workspaceId: fixture.workspace.id, sessionId: session.id }]);

    const reconnected = await fixture.connect(session.id);
    reconnected.socket.send(JSON.stringify({ type: 'clear' }));
    await expect.poll(() => reconnected.messages.some(message => message.type === 'clear'), { timeout }).toBe(true);
    expect(humanInputs).toHaveLength(1);
    fixture.authenticated = false;
    fixture.ctx.events.emit('auth:logout');
    reconnected.socket.send(JSON.stringify({ type: 'input', data: 'echo revoked\r' }));
    await expect.poll(() => reconnected.closed?.code, { timeout }).toBe(1008);
    expect(humanInputs).toHaveLength(1);
  });

  it('reconnects to the same shell with retained output, directory, environment and dimensions', async () => {
    const session = await fixture.create();
    const original = await fixture.connect(session.id);
    const child = path.join(fixture.workspace.path, 'sub directory');
    await mkdir(child);
    expect(await command(original, `export CODEX_RECONNECT_VALUE=retained; cd ${shellQuote(child)}; printf 'replay-before-disconnect'`))
      .toBe('replay-before-disconnect');
    original.socket.send(JSON.stringify({ type: 'resize', cols: 110, rows: 35 }));
    expect(await command(original, 'stty size')).toBe('35 110');
    await disconnect(original);
    expect(processExists(session.pid)).toBe(true);

    const resumed = await fixture.connect(session.id);
    expect(ready(resumed)).toMatchObject({ session: { id: session.id, pid: session.pid }, cols: 110, rows: 35 });
    await expect.poll(() => resumed.output, { timeout }).toContain('replay-before-disconnect');
    expect(await command(resumed, 'printf "%s" "$CODEX_RECONNECT_VALUE"')).toBe('retained');
    expect(await command(resumed, 'pwd')).toBe(child);
    expect(await command(resumed, 'printf "%s" "$$"')).toBe(String(session.pid));
  });

  it('bounds replayed output and clears scrollback for every connected client', async () => {
    const session = await fixture.create();
    const original = await fixture.connect(session.id);
    const script = "process.stdout.write('discarded-output-prefix\\n' + 'x'.repeat(320 * 1024) + '\\nretained-output-suffix')";
    await command(original, `${shellQuote(process.execPath)} -e ${shellQuote(script)}`);
    const second = await fixture.connect(session.id);
    expect(ready(second).truncated).toBe(true);
    await expect.poll(() => second.output, { timeout }).toContain('retained-output-suffix');
    const replay = second.messages.find(message => message.type === 'output');
    expect(replay?.type).toBe('output');
    if (!replay || replay.type !== 'output') throw new Error('No replayed output');
    expect(replay.data.length).toBeLessThanOrEqual(TERMINAL_OUTPUT_CHUNK);
    expect(ready(second).replay.historyLines).toBeLessThanOrEqual(TERMINAL_HISTORY_LINES);
    expect(Buffer.byteLength(second.output)).toBeLessThan(TERMINAL_HISTORY_BYTES + 10 * 1024);
    expect(replay.data).not.toContain('discarded-output-prefix');

    second.socket.send(JSON.stringify({ type: 'clear' }));
    await expect.poll(() => original.messages.some(message => message.type === 'clear'), { timeout }).toBe(true);
    await expect.poll(() => second.messages.some(message => message.type === 'clear'), { timeout }).toBe(true);
    const cleared = await fixture.connect(session.id);
    expect(ready(cleared).truncated).toBe(false);
    expect(await command(cleared, "printf 'after-clear'" )).toBe('after-clear');
    expect(cleared.output).not.toContain('retained-output-suffix');
    expect(cleared.output).not.toContain('discarded-output-prefix');
  });

  it('hands a live PTY producer from snapshot to new output with no duplicate or missing rows', async () => {
    const first = await fixture.open();
    await command(first, 'stty -echo; PS1=; PROMPT_COMMAND=');
    const trigger = path.join(fixture.workspace.path, 'continue-owned-stream');
    // LF is translated by the real PTY's ONLCR mode. Writing CRLF here would
    // produce CRCRLF and test terminal byte spelling rather than the handoff.
    const script = `const fs=require('node:fs');let i=0; const timer=setInterval(()=>{if(i===200&&!fs.existsSync(${JSON.stringify(trigger)}))return;process.stdout.write('STREAM-'+String(i++).padStart(6,'0')+'\\n'); if(i===1000){clearInterval(timer); process.stdout.write('STREAM_COMPLETE\\n')}},1)`;
    first.socket.send(JSON.stringify({ type: 'input', data: `${shellQuote(process.execPath)} -e ${shellQuote(script)}\r` }));
    await expect.poll(() => first.output.includes('STREAM-000199'), { timeout }).toBe(true);
    const release = deferred<void>();
    let captured = false;
    const actualSnapshot = TerminalReplay.prototype.snapshot;
    const heldSnapshot = vi.spyOn(TerminalReplay.prototype, 'snapshot').mockImplementation(function(this: TerminalReplay, lines, bytes) {
      return actualSnapshot.call(this, lines, bytes).then(async snapshot => {
        captured = true;
        await release.promise;
        return snapshot;
      });
    });
    const connecting = fixture.connect(ready(first).session.id);
    // Attach a rejection handler immediately; an assertion failure must not
    // leave an unobserved connection promise while teardown closes its socket.
    void connecting.catch(() => undefined);
    try {
      await expect.poll(() => captured, { timeout }).toBe(true);
      await writeFile(trigger, 'continue');
      // These real rows arrive while the captured snapshot is held and must be
      // queued for the new viewer, never included twice or lost between phases.
      await expect.poll(() => first.output.includes('STREAM-000450'), { timeout }).toBe(true);
      release.resolve();
      const second = await connecting;
      await expect.poll(() => second.output.includes('STREAM_COMPLETE\r\n'), { timeout }).toBe(true);
      expect(second.messages.some(message => message.type === 'replay-complete')).toBe(true);
      const rows = [...second.output.matchAll(/STREAM-(\d{6})/g)].map(match => Number(match[1]));
      expect(rows).toEqual(Array.from({ length: 1000 }, (_, index) => index));
    } finally {
      release.resolve(); heldSnapshot.mockRestore();
      await connecting.catch(() => undefined);
    }
  });

  it.each([false, true])('restores a native TUI, binary mouse input and one reply per query viewer with frame credit %s', async frameControl => {
    const first = await fixture.open({ cols: 80, rows: 24, flowControl: frameControl, frameControl });
    const consume = (connection: Connection) => {
      if (!frameControl) return;
      // Include acknowledgements which consume only part of a sent frame.
      // Binary mouse bytes and generated replies must never consume output credit.
      connection.socket.on('message', raw => {
        const message = JSON.parse(raw.toString()) as TerminalMessage;
        if (message.type !== 'output') return;
        const partial = Math.floor(message.data.length / 2);
        if (partial) connection.socket.send(JSON.stringify({ type: 'ack', characters: partial }));
        connection.socket.send(JSON.stringify({ type: 'ack', characters: message.data.length - partial }));
      });
      if (connection.output.length) connection.socket.send(JSON.stringify({ type: 'ack', characters: connection.output.length }));
    };
    consume(first);
    const script = path.resolve('tests/fixtures/terminal-tui.cjs');
    const log = path.join(fixture.workspace.path, 'owned-tui-input.log');
    first.socket.send(JSON.stringify({ type: 'input', data: `${shellQuote(process.execPath)} ${shellQuote(script)} ${shellQuote(log)}\r` }));
    await expect.poll(async () => readFile(`${log}.ready`, 'utf8').then(JSON.parse).catch(() => null), { timeout }).toMatchObject({ term: 'xterm-256color', colorterm: 'truecolor' });
    const second = await fixture.connect(ready(first).session.id, frameControl, frameControl);
    consume(second);
    await expect.poll(() => second.messages.some(message => message.type === 'replay-complete'), { timeout }).toBe(true);
    const snapshot = second.messages.find(message => message.type === 'replay-complete');
    if (snapshot?.type !== 'replay-complete') throw new Error('Missing actual terminal snapshot');
    expect(snapshot.state.modes).toMatchObject({ bracketedPasteMode: true, applicationCursorKeys: true, applicationKeypad: true });
    expect(snapshot.state.mouse).toEqual({ protocol: 'VT200', encoding: 'SGR' });
    expect(snapshot.state.cursor.hidden).toBe(true);
    expect(second.output).toContain('Native TUI fixture');
    expect(second.output).toContain('\x1b[?1049h');
    const binary = '\x1b[M' + String.fromCharCode(32, 160, 255);
    second.socket.send(JSON.stringify({ type: 'binary', data: binary }));
    await expect.poll(async () => readFile(log, 'utf8').catch(() => ''), { timeout }).toContain(Buffer.from(binary, 'latin1').toString('hex'));
    const start = [first.messages.length, second.messages.length];
    second.socket.send(JSON.stringify({ type: 'input', data: 'D' }));
    const query = (connection: Connection, from: number) => connection.messages.slice(from).find(message => message.type === 'output' && message.data.includes('\x1b[6n'));
    await expect.poll(() => Boolean(query(first, start[0]) && query(second, start[1])), { timeout }).toBe(true);
    const frames = [query(first, start[0]), query(second, start[1])];
    for (let index = 0; index < frames.length; index++) {
      const frame = frames[index];
      if (frame?.type !== 'output') throw new Error('No real query frame');
      [first, second][index].socket.send(JSON.stringify({ type: 'reply', sequence: frame.sequence, data: '\x1b[6;12R' }));
    }
    await expect.poll(async () => readFile(log, 'utf8').catch(() => ''), { timeout }).toContain(Buffer.from('\x1b[6;12R').toString('hex'));
    second.socket.send(JSON.stringify({ type: 'input', data: 'q' }));
    await expect.poll(() => second.output.includes('TUI closed cleanly'), { timeout }).toBe(true);
    const input = (await readFile(log, 'utf8')).trim().split('\n').map(hex => Buffer.from(hex, 'hex').toString('latin1')).join('');
    expect(input.split('\x1b[6;12R')).toHaveLength(2);
    expect(await command(second, 'printf real-shell-after-tui')).toBe('real-shell-after-tui');
  });

  it('rejects unauthenticated REST and WebSocket access and unknown terminals or workspaces', async () => {
    const session = await fixture.create();
    for (const [method, route] of [
      ['GET', `/workspaces/${fixture.workspace.id}/terminals`],
      ['POST', `/workspaces/${fixture.workspace.id}/terminals`],
      ['DELETE', `/terminals/${session.id}`],
    ]) expect((await fixture.request(method, route, false)).status).toBe(401);
    expect(await fixture.rejectUpgrade(session.id, false)).toBe(401);
    expect(await fixture.rejectUpgrade(randomUUID())).toBe(404);
    expect(await fixture.rejectUpgrade('invalid-terminal-id')).toBe(404);
    expect(await fixture.rejectUpgrade('../../unknown-socket-route')).toBe(404);
    expect((await fixture.request('GET', '/workspaces/missing/terminals')).status).toBe(404);
    expect((await fixture.request('POST', '/workspaces/missing/terminals')).status).toBe(404);
    fixture.workspaces.delete(fixture.workspace.id);
    expect(await fixture.rejectUpgrade(session.id)).toBe(404);
  });

  it('rejects input after authentication expires and closes connections immediately on logout', async () => {
    const session = await fixture.create();
    const connection = await fixture.connect(session.id);
    const unauthorizedFile = path.join(fixture.workspace.path, 'must-not-be-created');
    fixture.authenticated = false;
    fixture.ctx.events.emit('auth:logout');
    connection.socket.send(JSON.stringify({ type: 'input', data: `touch ${shellQuote(unauthorizedFile)}\r` }));
    await expect.poll(() => connection.closed?.code, { timeout }).toBe(1008);
    await expect(access(unauthorizedFile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fixture.rejectUpgrade(session.id)).toBe(401);

    fixture.authenticated = true;
    const reauthenticated = await fixture.connect(session.id);
    expect(await command(reauthenticated, "printf 'signed-back-in'" )).toBe('signed-back-in');
    fixture.authenticated = false;
    fixture.ctx.events.emit('auth:logout');
    await expect.poll(() => reauthenticated.closed?.code, { timeout }).toBe(1008);
  });

  it.each([
    { label: 'malformed JSON', payload: '{' },
    { label: 'array instead of an action', payload: '[]' },
    { label: 'oversized input', payload: JSON.stringify({ type: 'input', data: 'x'.repeat(64 * 1024 + 1) }) },
    { label: 'binary input', payload: Buffer.from('{"type":"input","data":"echo forbidden\\r"}') },
  ])('rejects $label without terminating the underlying shell', async ({ payload }) => {
    const session = await fixture.create();
    const connection = await fixture.connect(session.id);
    connection.socket.send(payload);
    await expect.poll(() => connection.closed?.code, { timeout }).toBe(1008);
    const resumed = await fixture.connect(session.id);
    expect(await command(resumed, "printf 'still-alive'" )).toBe('still-alive');
  });

  it('deletes sessions, closes their clients and terminates the actual shell process', async () => {
    const session = await fixture.create();
    const connection = await fixture.connect(session.id);
    expect((await fixture.request('DELETE', `/terminals/${session.id}`)).status).toBe(200);
    await expect.poll(() => connection.closed?.code, { timeout }).toBe(1000);
    await expect.poll(() => processExists(session.pid), { timeout }).toBe(false);
    expect(await (await fixture.request('GET', `/workspaces/${fixture.workspace.id}/terminals`)).json()).toEqual([]);
    expect(await fixture.rejectUpgrade(session.id)).toBe(404);
    expect((await fixture.request('DELETE', `/terminals/${session.id}`)).status).toBe(404);
  });

  it('stops sessions when their workspace is removed', async () => {
    const session = await fixture.create();
    const connection = await fixture.connect(session.id);
    fixture.workspaces.delete(fixture.workspace.id);
    fixture.ctx.events.emit('workspace:changed', { workspaceId: fixture.workspace.id });
    await expect.poll(() => connection.closed?.code, { timeout }).toBe(1000);
    await expect.poll(() => processExists(session.pid), { timeout }).toBe(false);
    expect(await fixture.rejectUpgrade(session.id)).toBe(404);
  });

  it('reports a shell exit and replays its final output and exit code after reconnecting', async () => {
    const session = await fixture.create();
    const connection = await fixture.connect(session.id);
    await command(connection, 'stty -echo; PS1=; PROMPT_COMMAND=');
    connection.socket.send(JSON.stringify({ type: 'input', data: "printf '\\036finished\\037\\n'; exit 7\r" }));
    await expect.poll(() => connection.closed?.code, { timeout }).toBe(1000);
    expect(connection.messages).toContainEqual({ type: 'exit', exitCode: 7 });
    expect(connection.output).toContain('\x1efinished\x1f');
    const list = await (await fixture.request('GET', `/workspaces/${fixture.workspace.id}/terminals`)).json();
    expect(list).toEqual([{ ...session, exited: true }]);

    const resumed = await fixture.connect(session.id);
    await expect.poll(() => resumed.closed?.code, { timeout }).toBe(1000);
    expect(ready(resumed).session.exited).toBe(true);
    expect((await renderedTerminal(resumed.messages)).normal).toContain('finished');
    expect(resumed.messages).toContainEqual({ type: 'exit', exitCode: 7 });
  });

  it('enforces the workspace session limit during concurrent creation and releases capacity on delete', async () => {
    const responses = await Promise.all(Array.from({ length: 10 }, () =>
      fixture.request('POST', `/workspaces/${fixture.workspace.id}/terminals`),
    ));
    const created = responses.filter(response => response.status === 201);
    const rejected = responses.filter(response => response.status === 409);
    const admissions = await Promise.all(responses.map(async response => ({ status: response.status, body: await response.clone().json() })));
    expect(created, JSON.stringify({ admissions, failures: fixture.failures })).toHaveLength(8);
    expect(rejected).toHaveLength(2);
    for (const response of rejected) expect(await response.json()).toMatchObject({ code: 'TERMINAL_LIMIT' });
    const sessions = await Promise.all(created.map(response => response.json() as Promise<TerminalSession>));
    expect(new Set(sessions.map(session => session.pid)).size).toBe(8);
    expect((await fixture.request('DELETE', `/terminals/${sessions[0].id}`)).status).toBe(200);
    expect((await fixture.create()).id).not.toBe(sessions[0].id);
    const remaining = await (await fixture.request('GET', `/workspaces/${fixture.workspace.id}/terminals`)).json();
    expect(remaining).toHaveLength(8);
  });

  it('reports an unavailable workspace directory instead of spawning a shell elsewhere', async () => {
    await rm(fixture.workspace.path, { recursive: true });
    const response = await fixture.request('POST', `/workspaces/${fixture.workspace.id}/terminals`);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'The workspace directory is unavailable.' });
  });

  it('opens or resumes in one authenticated upgrade and starts at the actual viewport size', async () => {
    const first = await fixture.open({ cols: 121, rows: 37 });
    const info = ready(first);
    expect(info.sessions).toEqual([info.session]);
    expect(info).toMatchObject({ cols: 121, rows: 37 });
    expect(await command(first, 'stty size')).toBe('37 121');
    expect(await command(first, 'pwd')).toBe(fixture.workspace.path);
    const resumed = await fixture.open({ sessionId: info.session.id });
    expect(ready(resumed).session).toEqual(info.session);
    expect(await command(resumed, 'printf "%s" "$$"')).toBe(String(info.session.pid));
    const list = await (await fixture.request('GET', `/workspaces/${fixture.workspace.id}/terminals`)).json();
    expect(list).toHaveLength(1);
  });

  it('deduplicates first-open races and retries of a new-terminal request', async () => {
    const [first, second] = await Promise.all([fixture.open(), fixture.open()]);
    expect(ready(first).session.id).toBe(ready(second).session.id);
    const requestId = randomUUID();
    const [fresh, retry] = await Promise.all([
      fixture.open({ fresh: true, requestId }), fixture.open({ fresh: true, requestId }),
    ]);
    expect(ready(fresh).session.id).toBe(requestId);
    expect(ready(retry).session.pid).toBe(ready(fresh).session.pid);
    expect(ready(fresh).session.id).not.toBe(ready(first).session.id);
    const list = await (await fixture.request('GET', `/workspaces/${fixture.workspace.id}/terminals`)).json();
    expect(list).toHaveLength(2);
  });

  it('validates direct-open dimensions, identifiers, authentication and browser Origin before creating a shell', async () => {
    const route = `/ws/terminal?workspaceId=${fixture.workspace.id}&requestId=${randomUUID()}`;
    expect(await fixture.rejectUpgrade('', false, route)).toBe(401);
    expect(await fixture.rejectUpgrade('', true, route, { Origin: 'https://attacker.invalid' })).toBe(401);
    for (const suffix of ['&cols=0', '&rows=301', '&rows=1.5', '&new=0', '&flow=invalid', '&frames=1', '&flow=1&frames=invalid', '&sessionId=invalid']) {
      expect(await fixture.rejectUpgrade('', true, route + suffix)).toBe(400);
    }
    expect(await fixture.rejectUpgrade('', true, '/ws/terminal?workspaceId=../escape&requestId=invalid')).toBe(400);
    expect(await (await fixture.request('GET', `/workspaces/${fixture.workspace.id}/terminals`)).json()).toEqual([]);
  });

  it('does not spawn an orphan when logout cancels a pending direct open', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const lookup = vi.spyOn(fixture.ctx.workspaces, 'get').mockImplementation(async (id: string) => {
      await pending;
      const workspace = fixture.workspaces.get(id);
      if (!workspace) throw new HttpError(404, 'Workspace not found.');
      return workspace;
    });
    const socket = new WebSocket(`${fixture.origin.replace('http:', 'ws:')}/ws/terminal?workspaceId=${fixture.workspace.id}&requestId=${randomUUID()}`, { headers: { Cookie: cookie } });
    socket.on('error', () => {});
    await new Promise<void>((resolve) => socket.once('open', resolve));
    const closed = new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)));
    fixture.authenticated = false;
    fixture.ctx.events.emit('auth:logout');
    expect(await closed).toBe(1008);
    release();
    await pending;
    lookup.mockRestore();
    fixture.authenticated = true;
    expect(await (await fixture.request('GET', `/workspaces/${fixture.workspace.id}/terminals`)).json()).toEqual([]);
  });

  it('bounds an unconsumed browser stream and resumes all actual command output after parser acknowledgement', async () => {
    const connection = await fixture.open({ flowControl: true });
    expect(ready(connection).flowControl).toBe(true);
    const length = 2 * 1024 * 1024;
    const marker = randomUUID();
    const begin = `\x1e${marker}:begin\x1f`;
    const end = `\x1e${marker}:end\x1f`;
    const script = `process.stdout.write('x'.repeat(${length}))`;
    connection.socket.send(JSON.stringify({ type: 'input', data: `printf '\\036${marker}:begin\\037'; ${shellQuote(process.execPath)} -e ${shellQuote(script)}; printf '\\036${marker}:end\\037'\r` }));
    await expect.poll(() => connection.output.length, { timeout }).toBeGreaterThanOrEqual(256 * 1024);
    const pingId = randomUUID();
    connection.socket.send(JSON.stringify({ type: 'ping', id: pingId }));
    await expect.poll(() => connection.messages.some((message) => message.type === 'pong' && message.id === pingId), { timeout }).toBe(true);
    expect(connection.output.length).toBeLessThan(512 * 1024);
    expect(connection.output).not.toContain(end);
    const acknowledge = (raw: Buffer) => {
      const message = JSON.parse(raw.toString()) as TerminalMessage;
      if (message.type === 'output') connection.socket.send(JSON.stringify({ type: 'ack', characters: message.data.length }));
    };
    connection.socket.on('message', acknowledge);
    connection.socket.send(JSON.stringify({ type: 'ack', characters: connection.output.length }));
    await expect.poll(() => connection.output.includes(end), { timeout }).toBe(true);
    const actual = connection.output.slice(connection.output.indexOf(begin) + begin.length, connection.output.indexOf(end));
    expect(actual).toBe('x'.repeat(length));
    expect(connection.closed).toBeUndefined();
  });

  it.each([false, true])('measures a stalled viewer from fresh output and actual consumption, not idle time (frame credit %s)', async frameControl => {
    const connection = await fixture.open({ flowControl: true, frameControl });
    await command(connection, 'stty -echo; PS1=; PROMPT_COMMAND=');
    connection.socket.send(JSON.stringify({ type: 'ack', characters: connection.output.length }));
    let now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      now += 61_000;
      const before = connection.output.length;
      const script = 'process.stdout.write("x".repeat(128 * 1024))';
      connection.socket.send(JSON.stringify({ type: 'input', data: `${shellQuote(process.execPath)} -e ${shellQuote(script)}\r` }));
      await expect.poll(() => connection.output.length - before, { timeout }).toBeGreaterThanOrEqual(128 * 1024);
      fixture.checkConnections();
      await delay(30);
      expect(connection.closed).toBeUndefined();

      now += 29_000;
      connection.socket.send(JSON.stringify({ type: 'ack', characters: 1024 }));
      const probe = randomUUID();
      connection.socket.send(JSON.stringify({ type: 'ping', id: probe }));
      await expect.poll(() => connection.messages.some(message => message.type === 'pong' && message.id === probe), { timeout }).toBe(true);
      now += 29_000;
      fixture.checkConnections();
      await delay(30);
      expect(connection.closed).toBeUndefined();

      now += 2001;
      fixture.checkConnections();
      await expect.poll(() => connection.closed?.code, { timeout }).toBe(1013);
      const resumed = await fixture.connect(ready(connection).session.id);
      expect(ready(resumed).session.pid).toBe(ready(connection).session.pid);
      expect(await command(resumed, "printf 'retained-shell'" )).toBe('retained-shell');
    } finally { clock.mockRestore(); }
  });

  it('unblocks a producing shell when a slow browser disconnects', async () => {
    const connection = await fixture.open({ flowControl: true });
    const marker = randomUUID();
    const script = `process.stdout.write('x'.repeat(${1024 * 1024}) + '${marker}')`;
    connection.socket.send(JSON.stringify({ type: 'input', data: `${shellQuote(process.execPath)} -e ${shellQuote(script)}\r` }));
    await expect.poll(() => connection.output.length, { timeout }).toBeGreaterThanOrEqual(256 * 1024);
    await disconnect(connection);
    const resumed = await fixture.connect(ready(connection).session.id);
    await expect.poll(() => resumed.output.includes(marker), { timeout }).toBe(true);
    expect(await command(resumed, "printf 'unblocked'" )).toBe('unblocked');
  });

  it('bounds tiny native output frames before a slow renderer exhausts its operation queue', async () => {
    const connection = await fixture.open({ flowControl: true, frameControl: true });
    await command(connection, 'stty -echo; PS1=; PROMPT_COMMAND=');
    const written = path.join(fixture.dataDir, 'tiny-frames-written');
    const marker = `\x1e${randomUUID()}\x1f`;
    const script = `let remaining=1200; const next=()=>{if(remaining--){process.stdout.write('x');setTimeout(next,1)}else{require('node:fs').writeFileSync(${JSON.stringify(written)},'done');process.stdout.write(${JSON.stringify(marker)})}};next()`;
    const initialFrames = connection.messages.filter(message => message.type === 'output').length;
    connection.socket.send(JSON.stringify({ type: 'input', data: `${shellQuote(process.execPath)} -e ${shellQuote(script)}\r` }));
    await expect.poll(() => access(written).then(() => true, () => false), { timeout }).toBe(true);
    const receivedFrames = connection.messages.filter(message => message.type === 'output').length - initialFrames;
    // A full 1,200-fragment stream is only 1,200 characters, far below byte
    // credit. It must stop before either the auth or browser 1,024-frame cap.
    expect(receivedFrames).toBeLessThanOrEqual(256);
    expect(connection.output).not.toContain(marker);
    expect(connection.closed).toBeUndefined();
    const consumed = connection.output.length;
    connection.socket.on('message', raw => {
      const message = JSON.parse(raw.toString()) as TerminalMessage;
      if (message.type === 'output') connection.socket.send(JSON.stringify({ type: 'ack', characters: message.data.length }));
    });
    connection.socket.send(JSON.stringify({ type: 'ack', characters: consumed }));
    await expect.poll(() => connection.output.includes(marker), { timeout }).toBe(true);
    expect(connection.closed).toBeUndefined();
    expect(await command(connection, "printf 'small-frames-resumed'" )).toBe('small-frames-resumed');
  });

  it('keeps the final bytes when the PTY exits while its viewer is paused', async () => {
    const connection = await fixture.open({ flowControl: true, frameControl: true });
    await command(connection, 'stty -echo; PS1=; PROMPT_COMMAND=');
    const finished = path.join(fixture.dataDir, 'exiting-frames-written');
    const marker = `\x1e${randomUUID()}\x1f`;
    const start = `\x1e${randomUUID()}\x1f`;
    const script = `process.stdout.write(${JSON.stringify(start)});let remaining=800; const next=()=>{if(remaining--){process.stdout.write('x');setTimeout(next,1)}else{process.stdout.write(${JSON.stringify(marker)});require('node:fs').writeFileSync(${JSON.stringify(finished)},'done');process.exit(7)}};next()`;
    connection.socket.send(JSON.stringify({ type: 'input', data: `exec ${shellQuote(process.execPath)} -e ${shellQuote(script)}\r` }));
    await expect.poll(() => access(finished).then(() => true, () => false), { timeout }).toBe(true);
    // node-pty's native exit cleanup currently has a 200 ms read-socket grace
    // period. A renderer can legitimately remain paused beyond that interval.
    await delay(350);
    const consumed = connection.output.length;
    connection.socket.on('message', raw => {
      const message = JSON.parse(raw.toString()) as TerminalMessage;
      if (message.type === 'output' && connection.socket.readyState === WebSocket.OPEN) connection.socket.send(JSON.stringify({ type: 'ack', characters: message.data.length }));
    });
    connection.socket.send(JSON.stringify({ type: 'ack', characters: consumed }));
    await expect.poll(() => connection.closed?.code, { timeout }).toBe(1000);
    expect(connection.output).toContain(marker);
    expect(connection.output.slice(connection.output.indexOf(start) + start.length, connection.output.indexOf(marker))).toBe('x'.repeat(800));
    expect(connection.messages).toContainEqual({ type: 'exit', exitCode: 7 });
  });

  it('rejects invalid flow acknowledgements without killing the retained PTY', async () => {
    const connection = await fixture.open({ flowControl: true });
    connection.socket.send(JSON.stringify({ type: 'ack', characters: 1024 * 1024 }));
    await expect.poll(() => connection.closed?.code, { timeout }).toBe(1008);
    const resumed = await fixture.connect(ready(connection).session.id);
    expect(await command(resumed, "printf 'ack-validation-preserved-shell'" )).toBe('ack-validation-preserved-shell');
  });

  it('keeps a consuming window responsive when a second window stops acknowledging output', async () => {
    const slow = await fixture.open({ flowControl: true });
    const active = await fixture.connect(ready(slow).session.id);
    const script = `process.stdout.write('x'.repeat(${1024 * 1024}))`;
    expect(await command(active, `${shellQuote(process.execPath)} -e ${shellQuote(script)}`)).toBe('x'.repeat(1024 * 1024));
    await expect.poll(() => slow.closed?.code, { timeout }).toBe(1013);
    expect(active.closed).toBeUndefined();
    expect(await command(active, "printf 'active-window-kept-up'" )).toBe('active-window-kept-up');
  });

  it('lets a second viewer parse a large intact screen without mistaking replay for a stalled live stream', async () => {
    const active = await fixture.open({ cols: 500, rows: 100 });
    const script = "let out='\\x1b[H'; for(let y=0;y<95;y++){for(let x=0;x<490;x++)out+='\\x1b[38;2;'+(x%255)+';'+(y*2)+';160mX'; out+='\\r\\n'} process.stdout.write(out+'\\x1b[0mRICH_SCREEN_READY')";
    expect(await command(active, `${shellQuote(process.execPath)} -e ${shellQuote(script)}`)).toContain('RICH_SCREEN_READY');
    const restoring = await fixture.connect(ready(active).session.id, true);
    await expect.poll(() => restoring.output.length, { timeout }).toBeGreaterThanOrEqual(256 * 1024);
    const ping = randomUUID();
    restoring.socket.send(JSON.stringify({ type: 'ping', id: ping }));
    await expect.poll(() => restoring.messages.some(message => message.type === 'pong' && message.id === ping), { timeout }).toBe(true);
    expect(restoring.closed).toBeUndefined();
    restoring.socket.on('message', raw => {
      const message = JSON.parse(raw.toString()) as TerminalMessage;
      if (message.type === 'output') restoring.socket.send(JSON.stringify({ type: 'ack', characters: message.data.length }));
    });
    restoring.socket.send(JSON.stringify({ type: 'ack', characters: restoring.output.length }));
    await expect.poll(() => restoring.messages.some(message => message.type === 'replay-complete'), { timeout }).toBe(true);
    expect(restoring.output).toContain('RICH_SCREEN_READY');
    expect(restoring.closed).toBeUndefined();
    expect(await command(restoring, "printf 'live-after-large-screen'" )).toBe('live-after-large-screen');
  });

  it('keeps workspace history and user setup after server restart while replacing disposable caches', async () => {
    const first = await fixture.open();
    const value = `persist_${randomUUID().replaceAll('-', '')}`;
    await command(first, `export CODEX_HISTORY_PROBE=${value}`);
    await command(first, 'printf disposable >"$npm_config_cache/terminal-restart-cache"');
    const shellSettings = path.join(fixture.ctx.config.homeDir, '.bashrc');
    await writeFile(shellSettings, `\nexport CODEX_SHELL_SETTING=${shellQuote(value)}\n`, { flag: 'a' });
    await command(first, 'history -a');
    const histfile = await command(first, 'printf "%s" "$HISTFILE"');
    const session = ready(first).session;
    const dataDir = fixture.dataDir;
    const runtimeDir = fixture.runtimeDir;
    await fixture.close(true);
    await expect.poll(() => processExists(session.pid), { timeout }).toBe(false);
    await expect(access(runtimeDir)).rejects.toMatchObject({ code: 'ENOENT' });
    fixture = await createFixture(dataDir);
    expect(fixture.runtimeDir).not.toBe(runtimeDir);
    const next = await fixture.open({ fresh: true });
    expect(await command(next, 'printf "%s" "$HISTFILE"')).toBe(histfile);
    expect(await command(next, 'history')).toContain(`export CODEX_HISTORY_PROBE=${value}`);
    expect(await command(next, 'printf "%s" "$CODEX_SHELL_SETTING"')).toBe(value);
    expect(await readFile(shellSettings, 'utf8')).toContain(`export CODEX_SHELL_SETTING=${shellQuote(value)}`);
    await expect(access(path.join(fixture.runtimeDir, 'cache', 'npm', 'terminal-restart-cache'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('trusts only the registered canonical Git workspace despite different native bucket ownership', async () => {
    vi.stubEnv('GIT_CONFIG_COUNT', '1');
    vi.stubEnv('GIT_CONFIG_KEY_0', 'safe.directory');
    vi.stubEnv('GIT_CONFIG_VALUE_0', '*');
    const connection = await fixture.open({ cols: 40 });
    const canonical = await realpath(fixture.workspace.path);
    expect(canonical.length).toBeGreaterThan(ready(connection).cols);
    await command(connection, "git init -q; git -c user.name=TerminalTest -c user.email=terminal@example.invalid commit --allow-empty -qm initial");
    // Git supplies this deterministic ownership test switch. The same real Git
    // process that succeeds with our exact root must reject an untrusted repo.
    const revision = await command(connection, 'GIT_TEST_ASSUME_DIFFERENT_OWNER=1 git rev-parse --verify HEAD');
    expect(revision).toMatch(/^[a-f0-9]{40}$/);
    // The native pager can insert display-width line breaks in a long path.
    // Query the exact Git value; do not normalize meaningful pathname bytes.
    expect(await command(connection, 'git --no-pager config --get-all safe.directory')).toBe(canonical);
    expect(await command(connection, 'printf "%s" "$GIT_CONFIG_COUNT"')).toBe('1');
    const sibling = path.join(fixture.dataDir, 'unregistered-repository');
    await mkdir(sibling);
    await command(connection, `git -C ${shellQuote(sibling)} init -q`);
    expect(await command(connection, `GIT_TEST_ASSUME_DIFFERENT_OWNER=1 git -C ${shellQuote(sibling)} status --porcelain 2>&1`)).toContain('detected dubious ownership');
    expect(await command(connection, 'test ! -e "$HOME/.gitconfig" && printf untouched')).toBe('untouched');
  });

  it('awaits both asynchronous upgrade proofs before opening a socket or starting a shell', async () => {
    await fixture.close();
    const first = deferred<boolean>();
    const final = deferred<boolean>();
    let reads = 0;
    fixture = await createFixture(undefined, { authorizeUpgrade: () => ++reads === 1 ? first.promise : final.promise,
      authorizationTiming: { maxAgeMs: 1500, timeoutMs: 1000 } });
    const target = path.join(fixture.workspace.path, 'authorized-after-both-proofs');
    let opened = false;
    const socket = new WebSocket(`${fixture.origin.replace('http:', 'ws:')}/ws/terminal?workspaceId=${fixture.workspace.id}&requestId=${randomUUID()}`, { headers: { Cookie: cookie, Origin: fixture.origin } });
    socket.on('error', () => {});
    socket.on('open', () => {
      opened = true;
      // Exercise a legacy caller that sends immediately on open, before ready.
      socket.send(JSON.stringify({ type: 'input', data: `touch ${shellQuote(target)}\r` }));
    });
    try {
      await expect.poll(() => reads, { timeout }).toBe(1);
      expect(opened).toBe(false);
      expect(await (await fixture.request('GET', `/workspaces/${fixture.workspace.id}/terminals`)).json()).toEqual([]);
      first.resolve(true);
      await expect.poll(() => reads, { timeout }).toBe(2);
      expect(opened).toBe(false);
      await expect(access(target)).rejects.toMatchObject({ code: 'ENOENT' });
      final.resolve(true);
      await expect.poll(async () => access(target).then(() => true, () => false), { timeout }).toBe(true);
      expect(opened).toBe(true);
    } finally { socket.terminate(); first.resolve(false); final.resolve(false); }
  });

  it.each(['denied', 'rejected', 'timeout', 'pre-handoff-denied'] as const)('fails closed on %s asynchronous upgrade authorization', async (mode) => {
    await fixture.close();
    let reads = 0;
    const withheld = deferred<boolean>();
    fixture = await createFixture(undefined, {
      authorizeUpgrade: () => {
        reads++;
        if (mode === 'rejected') return Promise.reject(new Error('Authority is unavailable'));
        if (mode === 'timeout') return withheld.promise;
        return Promise.resolve(mode === 'pre-handoff-denied' && reads === 1);
      },
      authorizationTiming: { maxAgeMs: 500, timeoutMs: 100 },
    });
    const route = `/ws/terminal?workspaceId=${fixture.workspace.id}&requestId=${randomUUID()}`;
    expect(await fixture.rejectUpgrade('', true, route)).toBe(401);
    withheld.resolve(true); // A late result must not upgrade the rejected socket.
    expect(await (await fixture.request('GET', `/workspaces/${fixture.workspace.id}/terminals`)).json()).toEqual([]);
    expect(reads).toBe(mode === 'pre-handoff-denied' ? 2 : 1);
  });

  it('holds ordered input and resize frames while an authority refresh is pending', async () => {
    await fixture.close();
    const refresh = deferred<boolean>();
    let reads = 0;
    fixture = await createFixture(undefined, { authorizeUpgrade: (_request, allowed) => ++reads === 3 ? refresh.promise : Promise.resolve(allowed),
      authorizationTiming: { maxAgeMs: 350, timeoutMs: 300 } });
    const connection = await fixture.open();
    await command(connection, 'stty -echo; PS1=; PROMPT_COMMAND=');
    await expect.poll(() => reads, { timeout }).toBe(3);
    const target = path.join(fixture.workspace.path, 'ordered-input.txt');
    const marker = `\x1e${randomUUID()}\x1f`;
    for (const source of [`printf 'first\\n' >> ${shellQuote(target)}\r`, `printf 'second\\n' >> ${shellQuote(target)}\r`]) {
      connection.socket.send(JSON.stringify({ type: 'input', data: source }));
    }
    connection.socket.send(JSON.stringify({ type: 'resize', cols: 77, rows: 33 }));
    connection.socket.send(JSON.stringify({ type: 'input', data: `stty size; printf '\\036${marker.slice(1, -1)}\\037'\r` }));
    await delay(25);
    await expect(access(target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(connection.closed).toBeUndefined();
    refresh.resolve(true);
    await expect.poll(() => connection.output.includes(marker), { timeout }).toBe(true);
    expect(await readFile(target, 'utf8')).toBe('first\nsecond\n');
    expect(connection.output).toContain('33 77');
  });

  it('invalidates an in-flight proof synchronously on logout and never writes queued input', async () => {
    await fixture.close();
    const stale = deferred<boolean>();
    let reads = 0;
    let allowed = true;
    fixture = await createFixture(undefined, { authorizeUpgrade: () => ++reads === 3 ? stale.promise : Promise.resolve(allowed),
      authorizationTiming: { maxAgeMs: 350, timeoutMs: 300 } });
    const connection = await fixture.open();
    await expect.poll(() => reads, { timeout }).toBe(3);
    const target = path.join(fixture.workspace.path, 'must-not-run-after-logout');
    connection.socket.send(JSON.stringify({ type: 'input', data: `touch ${shellQuote(target)}\r` }));
    await delay(25);
    allowed = false;
    fixture.ctx.events.emit('auth:logout', { hash: 'the-revoked-session-digest' });
    stale.resolve(true);
    await expect.poll(() => connection.closed?.code, { timeout: 500 }).toBe(1008);
    await expect(access(target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(processExists(ready(connection).session.pid)).toBe(true);
    allowed = true;
    const restored = await fixture.connect(ready(connection).session.id);
    expect(await command(restored, "printf 'same-retained-shell'" )).toBe('same-retained-shell');
  });

  it('detects a visible remote revocation on the bounded periodic check', async () => {
    await fixture.close();
    let allowed = true;
    let reads = 0;
    fixture = await createFixture(undefined, { authorizeUpgrade: async () => { reads++; return allowed; },
      authorizationTiming: { maxAgeMs: 300, timeoutMs: 200 } });
    const connection = await fixture.open();
    const revokedAt = performance.now();
    allowed = false; // Another instance writes the marker; no local logout event.
    await expect.poll(() => connection.closed?.code, { timeout: 1000 }).toBe(1008);
    expect(performance.now() - revokedAt).toBeLessThan(1000);
    expect(reads).toBeGreaterThanOrEqual(3);
    expect(processExists(ready(connection).session.pid)).toBe(true);
  });

  it('withholds actual PTY output during a denied refresh and replays it after reauthentication', async () => {
    await fixture.close();
    const refresh = deferred<boolean>();
    const startupRefresh = deferred<void>(), refreshEntered = deferred<void>(), nativeOutput = deferred<void>();
    let reads = 0, heldReads = 0, readsAtGate = 0;
    let startupHeld = false, armed = false;
    let openingRequest: IncomingMessage | undefined, heldRequest: IncomingMessage | undefined;
    const awaitProof = async (proof: Promise<void>, milliseconds: number, message: string) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([proof, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]);
      } finally { if (timer) clearTimeout(timer); }
    };
    fixture = await createFixture(undefined, { authorizeUpgrade: (request, allowed) => {
      reads++;
      openingRequest ??= request;
      if (startupHeld && request === openingRequest) startupRefresh.resolve();
      if (armed && !heldReads && request === openingRequest) {
        heldReads++; readsAtGate = reads; heldRequest = request; refreshEntered.resolve();
        return refresh.promise;
      }
      return Promise.resolve(allowed);
    },
      authorizationTiming: { maxAgeMs: 350, timeoutMs: 300 } });
    // Deliberately keep this real shell inside its owned startup file through
    // a healthy periodic proof. A connection-ready frame is not shell readiness,
    // and the denial under test must never consume setup's authority lease.
    const startupRelease = path.join(fixture.dataDir, 'release-shell-startup');
    const startupMarker = randomUUID(), producerMarker = randomUUID();
    await mkdir(fixture.ctx.config.homeDir, { recursive: true });
    await writeFile(path.join(fixture.ctx.config.homeDir, '.bashrc'),
      `PS1=; PROMPT_COMMAND=\nprintf '\\036${startupMarker}\\037\\n'\nwhile [ ! -e ${shellQuote(startupRelease)} ]; do sleep 0.01; done\n`, { flag: 'wx' });
    const trigger = path.join(fixture.dataDir, 'produce-output');
    const produced = path.join(fixture.dataDir, 'output-produced');
    const marker = `\x1e${randomUUID()}\x1f`;
    const write = TerminalReplay.prototype.write;
    let nativeTail = '';
    const observed = vi.spyOn(TerminalReplay.prototype, 'write').mockImplementation(function (this: TerminalReplay, data, detached) {
      write.call(this, data, detached);
      const received = nativeTail + data;
      if (received.includes(marker)) nativeOutput.resolve();
      nativeTail = received.slice(-(marker.length - 1));
    });
    try {
      const connection = await fixture.open();
      await expect.poll(() => connection.output.includes(`\x1e${startupMarker}\x1f`), { timeout }).toBe(true);
      startupHeld = true;
      await awaitProof(startupRefresh.promise, timeout, 'The held native shell did not cross a healthy periodic proof.');
      expect(reads).toBeGreaterThanOrEqual(3); expect(heldReads).toBe(0);
      expect(connection.closed).toBeUndefined();
      startupHeld = false;
      await writeFile(startupRelease, 'ready');
      await command(connection, 'stty -echo; PS1=; PROMPT_COMMAND=');
      connection.socket.send(JSON.stringify({ type: 'input', data: `printf '\\036${producerMarker}\\037\\n'; while [ ! -e ${shellQuote(trigger)} ]; do sleep 0.01; done; printf '\\036${marker.slice(1, -1)}\\037'; touch ${shellQuote(produced)}\r` }));
      await expect.poll(() => connection.output.includes(`\x1e${producerMarker}\x1f`), { timeout }).toBe(true);
      // The actual shell has accepted the blocking producer. Only its next
      // periodic proof is withheld, regardless of startup's earlier read count.
      const readsBeforeArm = reads;
      armed = true;
      await awaitProof(refreshEntered.promise, timeout, 'The output scenario never entered its withheld authorization proof.');
      expect(heldRequest).toBe(openingRequest);
      expect(heldReads).toBe(1); expect(readsAtGate).toBe(readsBeforeArm + 1);
      await writeFile(trigger, 'go');
      await awaitProof(nativeOutput.promise, 500, 'The producer did not deliver actual PTY bytes while authorization was withheld.');
      await expect.poll(async () => access(produced).then(() => true, () => false), { timeout: 500 }).toBe(true);
      expect(reads).toBe(readsAtGate);
      expect(connection.closed).toBeUndefined();
      expect(connection.output).not.toContain(marker);
      expect(connection.output).not.toContain(marker.slice(1, -1));
      const deniedAt = performance.now();
      refresh.resolve(false);
      await expect.poll(() => connection.closed?.code, { timeout: 500 }).toBe(1008);
      expect(performance.now() - deniedAt).toBeLessThan(500);
      expect(connection.closed?.reason).toBe('Your session has expired. Sign in again.');
      expect(connection.output).not.toContain(marker);
      expect(connection.output).not.toContain(marker.slice(1, -1));
      const restored = await fixture.connect(ready(connection).session.id);
      await expect.poll(() => restored.messages.some(message => message.type === 'replay-complete'), { timeout }).toBe(true);
      const rendered = (await renderedTerminal(restored.messages)).normal;
      expect(rendered).toContain(marker.slice(1, -1));
      expect(rendered.indexOf(producerMarker)).toBeGreaterThanOrEqual(0);
      expect(rendered.indexOf(producerMarker)).toBeLessThan(rendered.indexOf(marker.slice(1, -1)));
      expect(ready(restored).session.pid).toBe(ready(connection).session.pid);
    } finally { observed.mockRestore(); refresh.resolve(false); }
  });

  it('bounds pending-auth frames and leaves the underlying shell alive on overflow', async () => {
    await fixture.close();
    const refresh = deferred<boolean>();
    let reads = 0;
    fixture = await createFixture(undefined, { authorizeUpgrade: (_request, allowed) => ++reads === 3 ? refresh.promise : Promise.resolve(allowed),
      authorizationTiming: { maxAgeMs: 350, timeoutMs: 300 } });
    const connection = await fixture.open();
    await expect.poll(() => reads, { timeout }).toBe(3);
    const frame = JSON.stringify({ type: 'input', data: 'x'.repeat(60 * 1024) });
    for (let index = 0; index < 18; index++) connection.socket.send(frame);
    await expect.poll(() => connection.closed?.code, { timeout }).toBe(1013);
    refresh.resolve(true);
    expect(processExists(ready(connection).session.pid)).toBe(true);
    const restored = await fixture.connect(ready(connection).session.id);
    expect(await command(restored, "printf 'input-was-not-delivered'" )).toBe('input-was-not-delivered');
  });

  it('does not read the async authority for each authenticated input frame', async () => {
    await fixture.close();
    const proofs = new Map<IncomingMessage, number>();
    fixture = await createFixture(undefined, { authorizeUpgrade: async (request, allowed) => {
      proofs.set(request, (proofs.get(request) ?? 0) + 1); return allowed;
    } });
    const setup = await fixture.open();
    await command(setup, 'stty -echo; PS1=; PROMPT_COMMAND=');
    await disconnect(setup);
    const setupRequests = new Set(proofs.keys());
    // Reconnect the already-running shell so the measured request owns a fresh
    // two-proof lease. Native startup is not part of the 101-frame interval.
    const connection = await fixture.connect(ready(setup).session.id);
    await expect.poll(() => connection.messages.some(message => message.type === 'replay-complete'), { timeout }).toBe(true);
    const measuredRequests = [...proofs.keys()].filter(request => !setupRequests.has(request));
    expect(measuredRequests).toHaveLength(1);
    const request = measuredRequests[0];
    expect(proofs.get(request)).toBe(2);
    expect(ready(connection).session.pid).toBe(ready(setup).session.pid);
    const ping = randomUUID();
    connection.socket.send(JSON.stringify({ type: 'ping', id: ping }));
    await expect.poll(() => connection.messages.some(message => message.type === 'pong' && message.id === ping), { timeout }).toBe(true);
    expect(proofs.get(request)).toBe(2);
    const marker = `\x1e${randomUUID()}\x1f`;
    let acceptedFrames = 0;
    const accepted = (event: { sessionId: string }) => { if (event.sessionId === ready(connection).session.id) acceptedFrames++; };
    fixture.ctx.events.on('workspace:user-terminal', accepted);
    try {
      for (let index = 0; index < 100; index++) connection.socket.send(JSON.stringify({ type: 'input', data: 'q\x15' }));
      connection.socket.send(JSON.stringify({ type: 'input', data: `printf '\\036${marker.slice(1, -1)}\\037'\r` }));
      await expect.poll(() => connection.output.includes(marker), { timeout: 2000 }).toBe(true);
      expect(acceptedFrames).toBe(101);
      expect(proofs.get(request)).toBe(2);
    } finally { fixture.ctx.events.off('workspace:user-terminal', accepted); }
  });

  it('makes a stalled refresh retryable without delivering pending commands or killing the PTY', async () => {
    await fixture.close();
    const stalled = deferred<boolean>();
    let reads = 0;
    fixture = await createFixture(undefined, { authorizeUpgrade: (_request, allowed) => ++reads === 3 ? stalled.promise : Promise.resolve(allowed),
      authorizationTiming: { maxAgeMs: 250, timeoutMs: 150 } });
    const connection = await fixture.open();
    await expect.poll(() => reads, { timeout }).toBe(3);
    const target = path.join(fixture.workspace.path, 'must-not-run-after-timeout');
    connection.socket.send(JSON.stringify({ type: 'input', data: `touch ${shellQuote(target)}\r` }));
    await expect.poll(() => connection.closed?.code, { timeout: 1000 }).toBe(1013);
    stalled.resolve(true);
    await expect(access(target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(processExists(ready(connection).session.pid)).toBe(true);
    const restored = await fixture.connect(ready(connection).session.id);
    expect(ready(restored).session.pid).toBe(ready(connection).session.pid);
    expect(await command(restored, "printf 'authority-recovered'" )).toBe('authority-recovered');
  });

  it('cancels an abandoned initial authorization without creating a shell after a late success', async () => {
    await fixture.close();
    const pending = deferred<boolean>();
    let reads = 0;
    fixture = await createFixture(undefined, { authorizeUpgrade: () => { reads++; return pending.promise; },
      authorizationTiming: { maxAgeMs: 1000, timeoutMs: 700 } });
    const socket = new WebSocket(`${fixture.origin.replace('http:', 'ws:')}/ws/terminal?workspaceId=${fixture.workspace.id}&requestId=${randomUUID()}`, { headers: { Cookie: cookie } });
    socket.on('error', () => {});
    await expect.poll(() => reads, { timeout }).toBe(1);
    socket.terminate();
    await delay(25);
    pending.resolve(true);
    await delay(25);
    expect(await (await fixture.request('GET', `/workspaces/${fixture.workspace.id}/terminals`)).json()).toEqual([]);
    expect(reads).toBe(1);
  });

  it('resumes bounded PTY flow acknowledgements after asynchronous revalidation', async () => {
    await fixture.close();
    const refresh = deferred<boolean>();
    let reads = 0;
    fixture = await createFixture(undefined, { authorizeUpgrade: (_request, allowed) => ++reads === 3 ? refresh.promise : Promise.resolve(allowed),
      authorizationTiming: { maxAgeMs: 500, timeoutMs: 400 } });
    const connection = await fixture.open({ flowControl: true });
    connection.socket.on('message', raw => {
      const message = JSON.parse(raw.toString()) as TerminalMessage;
      if (message.type === 'output' && message.data.length) connection.socket.send(JSON.stringify({ type: 'ack', characters: message.data.length }));
    });
    if (connection.output.length) connection.socket.send(JSON.stringify({ type: 'ack', characters: connection.output.length }));
    await command(connection, 'stty -echo; PS1=; PROMPT_COMMAND=');
    const trigger = path.join(fixture.dataDir, 'flow-trigger');
    const producing = path.join(fixture.dataDir, 'flow-producing');
    const marker = randomUUID();
    const begin = `\x1e${marker}:begin\x1f`, end = `\x1e${marker}:end\x1f`;
    const length = 2 * 1024 * 1024;
    const script = `require('node:fs').writeFileSync(${JSON.stringify(producing)},'started');process.stdout.write('x'.repeat(${length}))`;
    connection.socket.send(JSON.stringify({ type: 'input', data: `while [ ! -e ${shellQuote(trigger)} ]; do sleep 0.01; done; printf '\\036${marker}:begin\\037'; ${shellQuote(process.execPath)} -e ${shellQuote(script)}; printf '\\036${marker}:end\\037'\r` }));
    await expect.poll(() => reads, { timeout }).toBe(3);
    await writeFile(trigger, 'go');
    await expect.poll(async () => access(producing).then(() => true, () => false), { timeout: 500 }).toBe(true);
    expect(connection.output).not.toContain(begin);
    refresh.resolve(true);
    await expect.poll(() => connection.output.includes(end), { timeout }).toBe(true);
    expect(connection.output.slice(connection.output.indexOf(begin) + begin.length, connection.output.indexOf(end))).toBe('x'.repeat(length));
    expect(connection.closed).toBeUndefined();
  });

  it('waits for a fresh proof when workspace setup overlaps a periodic authorization refresh', async () => {
    await fixture.close();
    const refresh = deferred<boolean>();
    let reads = 0;
    fixture = await createFixture(undefined, { authorizeUpgrade: (_request, allowed) => ++reads === 3 ? refresh.promise : Promise.resolve(allowed),
      authorizationTiming: { maxAgeMs: 250, timeoutMs: 200 } });
    const resolve = fixture.ctx.workspaces.resolvePath.bind(fixture.ctx.workspaces);
    vi.spyOn(fixture.ctx.workspaces, 'resolvePath').mockImplementation(async (...args) => {
      await expect.poll(() => reads, { timeout }).toBe(3);
      return resolve(...args);
    });
    const opening = fixture.open();
    await expect.poll(() => reads, { timeout }).toBe(3);
    expect(await (await fixture.request('GET', `/workspaces/${fixture.workspace.id}/terminals`)).json()).toEqual([]);
    refresh.resolve(true);
    const connection = await opening;
    expect(await command(connection, "printf 'fresh-proof-before-spawn'" )).toBe('fresh-proof-before-spawn');
    expect(connection.closed).toBeUndefined();
  });

  it.each([401, 404])('fully closes a rejected %i upgrade even when the raw client never sends FIN', async (status) => {
    const accepted = new Promise<Socket>((resolve) => fixture.server.once('connection', resolve));
    const address = new URL(fixture.origin);
    const socket = connectTcp({ host: address.hostname, port: Number(address.port), allowHalfOpen: true });
    socket.on('error', () => {});
    let response = '';
    socket.on('data', (chunk) => { response += chunk.toString(); });
    const serverSocket = await accepted;
    const route = status === 401 ? `/ws/terminal?workspaceId=${fixture.workspace.id}&requestId=${randomUUID()}` : '/ws/not-a-terminal';
    try {
      socket.write(`GET ${route} HTTP/1.1\r\nHost: ${address.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
      await expect.poll(() => response, { timeout }).toContain(`HTTP/1.1 ${status}`);
      await expect.poll(() => serverSocket.destroyed, { timeout: 1000 }).toBe(true);
      // A reset after rejection must not reach an unhandled server error listener.
      if (!socket.destroyed) socket.resetAndDestroy();
      expect(serverSocket.destroyed).toBe(true);
    } finally { socket.destroy(); }
  });

  it('delivers final PTY output and exit status before closing after a healthy refresh', async () => {
    await fixture.close();
    const refresh = deferred<boolean>();
    let reads = 0;
    fixture = await createFixture(undefined, { authorizeUpgrade: (_request, allowed) => ++reads === 3 ? refresh.promise : Promise.resolve(allowed),
      authorizationTiming: { maxAgeMs: 500, timeoutMs: 400 } });
    const connection = await fixture.open();
    await command(connection, 'stty -echo; PS1=; PROMPT_COMMAND=');
    const trigger = path.join(fixture.dataDir, 'exit-trigger');
    const marker = `\x1e${randomUUID()}\x1f`;
    connection.socket.send(JSON.stringify({ type: 'input', data: `while [ ! -e ${shellQuote(trigger)} ]; do sleep 0.01; done; printf '\\036${marker.slice(1, -1)}\\037'; exit 7\r` }));
    await expect.poll(() => reads, { timeout }).toBe(3);
    await writeFile(trigger, 'go');
    await expect.poll(() => processExists(ready(connection).session.pid), { timeout: 500 }).toBe(false);
    expect(connection.output).not.toContain(marker);
    expect(connection.closed).toBeUndefined();
    refresh.resolve(true);
    await expect.poll(() => connection.closed?.code, { timeout }).toBe(1000);
    expect(connection.output).toContain(marker);
    expect(connection.messages).toContainEqual({ type: 'exit', exitCode: 7 });
  });
});
