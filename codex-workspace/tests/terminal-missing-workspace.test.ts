import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../server/config';
import { createApplication } from '../server/index';
import { workspaceIsBusy } from '../server/worktrees/activity';
import type { TerminalSession, Workspace } from '../shared/types';
import type { TerminalReplayState } from '../shared/terminal-replay';
import { renderedTerminal } from './terminal-render';

const timeout = 8_000;
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
type TerminalMessage =
  | { type: 'ready'; session: TerminalSession; sessions?: TerminalSession[]; cols: number; rows: number }
  | { type: 'output'; data: string }
  | { type: 'replay-complete'; state: TerminalReplayState; pending: string }
  | { type: 'exit'; exitCode: number }
  | { type: 'error'; message: string };
interface Connection {
  socket: WebSocket;
  messages: TerminalMessage[];
  output: string;
  closed?: number;
  error?: Error;
}

let directory: string;
let app: Awaited<ReturnType<typeof createApplication>>;
let workspace: Workspace;
let origin: string;
let cookie: string;
let sockets: Set<WebSocket>;

function request(route: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  return fetch(`${origin}/api${route}`, { method, headers: { Origin: origin, Cookie: cookie,
    'X-Codex-Workspace': '1', 'Content-Type': 'application/json', ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

async function login(): Promise<void> {
  const response = await request('/session', 'POST', { password: app.ctx.config.password });
  expect(response.status).toBe(200);
  cookie = response.headers.get('set-cookie')!.split(';')[0];
}

async function create(workspaceId = workspace.id): Promise<TerminalSession> {
  const response = await request(`/workspaces/${workspaceId}/terminals`, 'POST', {});
  expect(response.status, await response.clone().text()).toBe(201);
  return response.json();
}

function recoveryRoute(sessionId?: string, workspaceId = workspace.id, requestId: string = randomUUID()): string {
  const query = new URLSearchParams({ workspaceId, requestId, existingOnly: '1' });
  if (sessionId) query.set('sessionId', sessionId);
  return `/ws/terminal?${query}`;
}

function observe(route: string, headers: Record<string, string> = {}): Connection {
  const socket = new WebSocket(`${origin.replace('http:', 'ws:')}${route}`, {
    headers: { Origin: origin, Cookie: cookie, ...headers },
  });
  sockets.add(socket);
  const connection: Connection = { socket, messages: [], output: '' };
  socket.on('message', data => {
    const message = JSON.parse(data.toString()) as TerminalMessage;
    connection.messages.push(message);
    if (message.type === 'output') connection.output += message.data;
  });
  socket.on('close', code => { connection.closed = code; });
  socket.on('error', error => { connection.error = error; });
  return connection;
}

function ready(connection: Connection): Extract<TerminalMessage, { type: 'ready' }> {
  const message = connection.messages.find(message => message.type === 'ready');
  if (!message || message.type !== 'ready') throw new Error('The real terminal did not send its ready message.');
  return message;
}

async function connect(route: string): Promise<Connection> {
  const connection = observe(route);
  await expect.poll(() => connection.messages.some(message => message.type === 'ready'), { timeout }).toBe(true);
  return connection;
}

function rejectUpgrade(route: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${origin.replace('http:', 'ws:')}${route}`, {
      headers: { Origin: origin, Cookie: cookie, ...headers },
    });
    sockets.add(socket);
    let received = false;
    const timer = setTimeout(() => { socket.terminate(); reject(new Error('Terminal upgrade rejection timed out.')); }, timeout);
    socket.on('unexpected-response', (outgoing, response) => {
      received = true;
      clearTimeout(timer);
      response.resume();
      outgoing.destroy();
      resolve(response.statusCode ?? 0);
    });
    socket.on('error', error => { if (!received) { clearTimeout(timer); reject(error); } });
    socket.on('open', () => {
      clearTimeout(timer);
      socket.terminate();
      reject(new Error('The missing or unauthorized terminal accepted a WebSocket.'));
    });
  });
}

/** Control-character markers distinguish executed output from echoed input. */
async function command(connection: Connection, source: string): Promise<string> {
  const marker = randomUUID();
  const start = `\x1e${marker}:begin\x1f`, end = `\x1e${marker}:end\x1f`;
  connection.socket.send(JSON.stringify({ type: 'input',
    data: `printf '\\036${marker}:begin\\037\\n'; ${source}; printf '\\036${marker}:end\\037\\n'\r` }));
  await expect.poll(() => connection.output.includes(end), { timeout }).toBe(true);
  expect(connection.output.includes(start)).toBe(true);
  return connection.output.slice(connection.output.indexOf(start) + start.length, connection.output.indexOf(end)).replace(/\r/g, '').trim();
}

async function live(pid: number): Promise<boolean> {
  try {
    const record = await readFile(`/proc/${pid}/stat`, 'utf8');
    return !['Z', 'X'].includes(record.slice(record.lastIndexOf(')') + 2).split(' ')[0]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function disappear(): Promise<void> {
  await rm(workspace.path, { recursive: true });
  const response = await request('/workspaces');
  expect(response.status).toBe(200);
  const active = await response.json() as Workspace[];
  expect(active.some(item => item.id === workspace.id)).toBe(false);
  await expect(app.ctx.workspaces.get(workspace.id)).rejects.toMatchObject({ status: 404 });
  expect(await app.ctx.workspaces.getRegistration(workspace.id, { includeArchived: true })).toMatchObject({ id: workspace.id });
  app.ctx.events.emit('workspace:changed', { workspaceId: workspace.id });
}

async function listed(workspaceId = workspace.id): Promise<TerminalSession[]> {
  const response = await request(`/workspaces/${workspaceId}/terminals?existingOnly=1`);
  expect(response.status).toBe(200);
  return response.json();
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

// The deployment host is Linux; every shell and filesystem operation here is real.
describe.skipIf(process.platform !== 'linux')('existing terminals after workspace disappearance', () => {
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'codex-terminal-recovery-'));
    sockets = new Set();
    app = await createApplication(loadConfig({ NODE_ENV: 'test', DATA_DIR: directory,
      WORKSPACE_PASSWORD: 'terminal-recovery-test-password', SESSION_SECRET: 'terminal-recovery-session-secret-over-32-characters',
      ENCRYPTION_KEY: 'terminal-recovery-credential-key-over-32-characters' }));
    workspace = await app.ctx.workspaces.create({ name: 'Terminal recovery' });
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    cookie = '';
    await login();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const socket of sockets ?? []) socket.terminate();
    await app?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('keeps the original PTY alive, reconnects and resizes it, and closes only that session', async () => {
    const session = await create();
    const otherWorkspace = await app.ctx.workspaces.create({ name: 'Other live terminal' });
    const otherSession = await create(otherWorkspace.id);
    const original = await connect(`/ws/terminal?workspaceId=${workspace.id}&requestId=${randomUUID()}&sessionId=${session.id}`);
    const retainedValue = randomUUID();
    expect(await command(original, `RECOVERY_VALUE=${quote(retainedValue)}; printf '%s' "$RECOVERY_VALUE"`)).toBe(retainedValue);
    expect(workspaceIsBusy(app.ctx.config.workspacesDir, workspace.id)).toBe(true);

    await disappear();
    expect(await listed()).toEqual([session]);
    expect((await request(`/workspaces/${workspace.id}/terminals`)).status).toBe(404);
    expect(await command(original, `printf '%s:%s' "$$" "$RECOVERY_VALUE"`)).toBe(`${session.pid}:${retainedValue}`);
    original.socket.close(1000, 'Reconnect after workspace loss');
    await expect.poll(() => original.closed, { timeout }).toBe(1000);

    const recovered = await connect(recoveryRoute(session.id));
    expect(ready(recovered).session).toEqual(session);
    expect(ready(recovered).sessions).toEqual([session]);
    expect(recovered.output).toContain(retainedValue);
    expect(await command(recovered, `test -t 0 && test -t 1 && printf '%s:%s' "$$" "$RECOVERY_VALUE"`)).toBe(`${session.pid}:${retainedValue}`);
    recovered.socket.send(JSON.stringify({ type: 'resize', cols: 119, rows: 39 }));
    expect(await command(recovered, 'stty size')).toBe('39 119');

    const legacy = await connect(`/ws/terminal/${session.id}`);
    expect(ready(legacy).session.pid).toBe(session.pid);
    expect(ready(legacy)).toMatchObject({ cols: 119, rows: 39 });
    expect((await request(`/terminals/${session.id}`, 'DELETE')).status).toBe(200);
    await expect.poll(() => recovered.closed, { timeout }).toBe(1000);
    await expect.poll(() => legacy.closed, { timeout }).toBe(1000);
    await expect.poll(() => live(session.pid), { timeout }).toBe(false);
    expect(await listed()).toEqual([]);
    expect(await live(otherSession.pid)).toBe(true);
    expect(await listed(otherWorkspace.id)).toEqual([otherSession]);
    expect(await rejectUpgrade(recoveryRoute(session.id))).toBe(404);
    expect(await rejectUpgrade(`/ws/terminal/${session.id}`)).toBe(404);
    expect((await request(`/terminals/${session.id}`, 'DELETE')).status).toBe(404);
  });

  it('never substitutes a fresh shell for a missing, foreign or closed recovery session', async () => {
    const session = await create();
    const available = await app.ctx.workspaces.create({ name: 'Available but empty' });
    await disappear();
    // Even a new directory at the old path does not unarchive the registration.
    await mkdir(workspace.path);
    const unknown = randomUUID();
    for (const route of [
      recoveryRoute(unknown), recoveryRoute(unknown, workspace.id, session.id),
      recoveryRoute(session.id, available.id), recoveryRoute(unknown, available.id),
      recoveryRoute(session.id, randomUUID()),
    ]) expect(await rejectUpgrade(route)).toBe(404);
    for (const route of [
      recoveryRoute(), `${recoveryRoute(session.id)}&new=1`,
      recoveryRoute(session.id).replace('existingOnly=1', 'existingOnly=0'),
      recoveryRoute('invalid-session'),
    ]) expect(await rejectUpgrade(route)).toBe(400);

    expect((await request(`/workspaces/${workspace.id}/terminals`, 'POST', {})).status).toBe(404);
    expect((await request(`/workspaces/${workspace.id}/terminals?existingOnly=1`, 'POST', {})).status).toBe(404);
    const fresh = observe(`/ws/terminal?workspaceId=${workspace.id}&requestId=${randomUUID()}&new=1`);
    await expect.poll(() => fresh.closed, { timeout }).toBe(1008);
    expect(fresh.messages.some(message => message.type === 'error')).toBe(true);
    expect(fresh.messages.some(message => message.type === 'ready')).toBe(false);
    expect(await listed()).toEqual([session]);
    expect(await listed(available.id)).toEqual([]);
    expect((await request(`/workspaces/${randomUUID()}/terminals?existingOnly=1`)).status).toBe(404);
    expect((await request(`/workspaces/${workspace.id}/terminals?existingOnly=0`)).status).toBe(400);

    expect((await request(`/terminals/${session.id}`, 'DELETE')).status).toBe(200);
    expect(await rejectUpgrade(recoveryRoute(session.id, workspace.id, session.id))).toBe(404);
    expect(await listed()).toEqual([]);
  });

  it('replays an exited terminal without restarting its process in recovery', async () => {
    const session = await create();
    const original = await connect(`/ws/terminal/${session.id}`);
    await command(original, 'stty -echo; PS1=; PROMPT_COMMAND=');
    original.socket.send(JSON.stringify({ type: 'input', data: "printf '\\036recovery-exit-output\\037\\n'; exit 7\r" }));
    await expect.poll(() => original.closed, { timeout }).toBe(1000);
    await expect.poll(() => live(session.pid), { timeout }).toBe(false);
    await disappear();
    const recovered = await connect(recoveryRoute(session.id));
    expect(ready(recovered).session).toEqual({ ...session, exited: true });
    await expect.poll(() => recovered.closed, { timeout }).toBe(1000);
    expect(original.output).toContain('\x1erecovery-exit-output\x1f');
    expect((await renderedTerminal(recovered.messages)).normal).toContain('recovery-exit-output');
    expect(recovered.messages).toContainEqual({ type: 'exit', exitCode: 7 });
    expect(await listed()).toEqual([{ ...session, exited: true }]);
    expect(await live(session.pid)).toBe(false);
  });

  it('keeps recovery behind real sessions, same-origin mutations and logout revalidation', async () => {
    const session = await create();
    await disappear();
    const route = recoveryRoute(session.id);
    for (const [endpoint, method] of [
      [`/workspaces/${workspace.id}/terminals?existingOnly=1`, 'GET'],
      [`/terminals/${session.id}`, 'DELETE'],
    ]) expect((await request(endpoint, method, undefined, { Cookie: '' })).status).toBe(401);
    expect((await request(`/terminals/${session.id}`, 'DELETE', undefined, { Origin: 'https://other.invalid' })).status).toBe(403);
    expect(await rejectUpgrade(route, { Cookie: '' })).toBe(401);
    expect(await rejectUpgrade(route, { Origin: 'https://other.invalid' })).toBe(401);
    expect(await rejectUpgrade(`/ws/terminal/${session.id}`, { Cookie: '' })).toBe(401);

    const recovery = await connect(route);
    expect(await command(recovery, "printf '%s' \"$$\"")).toBe(String(session.pid));
    const forbiddenWrite = path.join(directory, 'logged-out-terminal-must-not-write');
    expect((await request('/session', 'DELETE')).status).toBe(200);
    if (recovery.socket.readyState === WebSocket.OPEN) {
      recovery.socket.send(JSON.stringify({ type: 'input', data: `printf forbidden >${quote(forbiddenWrite)}\r` }));
    }
    await expect.poll(() => recovery.closed, { timeout }).toBe(1008);
    await expect(access(forbiddenWrite)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await rejectUpgrade(route)).toBe(401);
    expect(await live(session.pid)).toBe(true);

    await login();
    const restored = await connect(route);
    expect(ready(restored).session).toEqual(session);
    expect(await command(restored, "printf '%s' \"$$\"")).toBe(String(session.pid));
    expect(await listed()).toEqual([session]);
  });

  it.each(['registration', 'final authentication'] as const)('rejects a tab closed during %s without upgrading or replacing it', async stage => {
    const session = await create();
    await disappear();
    const entered = deferred(), release = deferred();
    if (stage === 'registration') {
      const original = app.ctx.workspaces.getRegistration.bind(app.ctx.workspaces);
      let held = false;
      vi.spyOn(app.ctx.workspaces, 'getRegistration').mockImplementation(async (id, options) => {
        const registration = await original(id, options);
        if (id === workspace.id && !held) { held = true; entered.resolve(); await release.promise; }
        return registration;
      });
    } else {
      const original = app.auth.authenticated.bind(app.auth);
      let checks = 0;
      vi.spyOn(app.auth, 'authenticated').mockImplementation(async incoming => {
        const allowed = await original(incoming);
        if (incoming.url?.startsWith('/ws/terminal?') && ++checks === 2) { entered.resolve(); await release.promise; }
        return allowed;
      });
    }
    const rejection = rejectUpgrade(recoveryRoute(session.id));
    try {
      await entered.promise;
      expect((await request(`/terminals/${session.id}`, 'DELETE')).status).toBe(200);
    } finally { release.resolve(); }
    expect(await rejection).toBe(404);
    expect(await listed()).toEqual([]);
    await expect.poll(() => live(session.pid), { timeout }).toBe(false);
  });
});
