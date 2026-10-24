import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { createApplication } from '../server/index';
import { loadConfig } from '../server/config';
import { GitService } from '../server/git';
import { withWorkspaceRemoval, workspaceIsBusy } from '../server/worktrees/activity';
import type { CreatedWorktree, TerminalSession, Workspace } from '../shared/types';

const timeout = 8000;
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const baseline = 'committed worktree content\n';
let directory: string;
let app: Awaited<ReturnType<typeof createApplication>>;
let source: Workspace;
let child: CreatedWorktree;
let origin: string;
let cookie: string;
let closed: boolean;
let sockets: Set<WebSocket>;
let children: Map<number, string>;
let ends: Array<{ workspaceId: string; sessionId: string }>;

async function processIdentity(pid: number): Promise<{ started: string; live: boolean } | undefined> {
  try {
    const record = await readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = record.slice(record.lastIndexOf(')') + 2).trim().split(/\s+/);
    return { started: fields[19], live: !['Z', 'X'].includes(fields[0]) };
  } catch { return undefined; }
}
function request(route: string, method = 'GET', body?: unknown) {
  return fetch(`${origin}/api${route}`, { method, headers: { Origin: origin, Cookie: cookie,
    'X-Codex-Workspace': '1', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function login() {
  const response = await request('/session', 'POST', { password: app.ctx.config.password });
  expect(response.status).toBe(200);
  cookie = response.headers.get('set-cookie')!.split(';')[0];
}
async function createTerminal(): Promise<TerminalSession> {
  const response = await request(`/workspaces/${child.workspace.id}/terminals`, 'POST', {});
  expect(response.status).toBe(201);
  return response.json();
}
async function connect(id: string) {
  const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/ws/terminal/${id}`, { headers: { Origin: origin, Cookie: cookie } });
  sockets.add(socket);
  let ready = false, output = '';
  let closeCode: number | undefined;
  socket.on('error', () => {});
  socket.on('message', raw => {
    const message = JSON.parse(raw.toString());
    if (message.type === 'ready') ready = true;
    if (message.type === 'output') output += message.data;
  });
  socket.on('close', code => { closeCode = code; });
  await expect.poll(() => ready, { timeout }).toBe(true);
  return { socket, output: () => output, closeCode: () => closeCode };
}
const busy = () => workspaceIsBusy(app.ctx.config.workspacesDir, child.workspace.id);
const removeRoute = () => `/workspaces/${source.id}/worktrees/${child.worktree.id}`;
async function assertBusy() {
  expect(busy()).toBe(true);
  const response = await request(removeRoute(), 'DELETE');
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'WORKTREE_BUSY' });
  expect(await readFile(path.join(child.workspace.path, 'notes.txt'), 'utf8')).toBe(baseline);
}
async function closeTerminal(session: TerminalSession) {
  expect((await request(`/terminals/${session.id}`, 'DELETE')).status).toBe(200);
  await expect.poll(async () => (await processIdentity(session.pid))?.live ?? false, { timeout }).toBe(false);
}
async function background(connection: Awaited<ReturnType<typeof connect>>, mode: 'nohup' | 'setsid' | 'cleared', waitForever = false) {
  const id = randomUUID();
  const readyFile = path.join(directory, `${id}.ready`);
  const outputFile = path.join(directory, `${id}.output`);
  const gate = path.join(directory, `${id}.gate`);
  const done = path.join(directory, `${id}.done`);
  const target = path.join(child.workspace.path, 'notes.txt');
  const script = [
    "const fs=require('node:fs');",
    'const [ready,gate,done,target]=process.argv.slice(1);',
    "process.on('SIGHUP',()=>{});process.on('SIGTERM',()=>{});",
    "fs.writeFileSync(ready,String(process.pid));",
    'const deadline=setTimeout(()=>process.exit(72),30000);',
    'const timer=setInterval(()=>{',
    waitForever ? '' : "if(fs.existsSync(gate)){fs.writeFileSync(target,'delayed terminal write\\n');fs.writeFileSync(done,'done');clearInterval(timer);clearTimeout(deadline);}",
    '},10);',
  ].join('');
  const wrapper = mode === 'nohup' ? 'nohup' : mode === 'setsid' ? 'setsid' : 'setsid env -i';
  const command = `${wrapper} ${[process.execPath, '-e', script, readyFile, gate, done, target].map(quote).join(' ')} </dev/null >${quote(outputFile)} 2>&1 & disown\r`;
  connection.socket.send(JSON.stringify({ type: 'input', data: command }));
  try {
    await expect.poll(async () => readFile(readyFile, 'utf8').catch(() => ''), { timeout }).toMatch(/^\d+$/);
  } catch (error) {
    // Retain real launch failures (for example fork/thread exhaustion) instead
    // of reporting them as an unexplained ownership-cleanup timeout.
    const output = await readFile(outputFile, 'utf8').catch(() => 'No child output file was created.');
    throw new Error(`The real ${mode} child did not report readiness.\nShell output:\n${connection.output().slice(-4096)}\nChild output:\n${output.slice(-4096)}`, { cause: error });
  }
  const pid = Number(await readFile(readyFile, 'utf8'));
  const identity = await processIdentity(pid);
  expect(identity?.live).toBe(true);
  children.set(pid, identity!.started);
  return { pid, gate, done };
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'codex-terminal-worktree-'));
  app = await createApplication(loadConfig({ NODE_ENV: 'test', DATA_DIR: directory,
    WORKSPACE_PASSWORD: 'terminal-worktree-test-password', SESSION_SECRET: 'terminal-worktree-session-secret-over-32-characters',
    ENCRYPTION_KEY: 'terminal-worktree-credential-key-over-32-characters' }));
  source = await app.ctx.workspaces.create({ name: 'Terminal worktree source', initializeGit: true });
  await app.ctx.workspaces.writeFile(source.id, 'notes.txt', baseline);
  const git = new GitService(app.ctx);
  await git.stage(source.id, ['notes.txt']);
  await git.commit(source.id, 'Worktree activity baseline');
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  cookie = '';
  closed = false;
  sockets = new Set();
  children = new Map();
  ends = [];
  app.ctx.events.on('workspace:user-terminal-end', event => ends.push(event));
  await login();
  const created = await request(`/workspaces/${source.id}/worktrees`, 'POST', { branch: 'terminal/activity', createBranch: true });
  expect(created.status).toBe(201);
  child = await created.json();
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const socket of sockets) socket.terminate();
  for (const [pid, started] of children) {
    const current = await processIdentity(pid);
    if (current?.live && current.started === started) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* Already stopped. */ }
      await expect.poll(async () => (await processIdentity(pid))?.live ?? false, { timeout }).toBe(false);
    }
  }
  if (!closed) await app.close();
  await rm(directory, { recursive: true, force: true });
});

describe.skipIf(process.platform !== 'linux')('real PTY worktree activity lifetime', () => {
  it('fences direct-WebSocket admission before slow setup and releases a canceled attempt', async () => {
    const original = app.ctx.workspaces.get.bind(app.ctx.workspaces);
    let entered = false;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(app.ctx.workspaces, 'get').mockImplementation(async id => {
      if (id === child.workspace.id) { entered = true; await gate; }
      return original(id);
    });
    const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/ws/terminal?workspaceId=${child.workspace.id}&requestId=${randomUUID()}`, { headers: { Origin: origin, Cookie: cookie } });
    sockets.add(socket); socket.on('error', () => {});
    await expect.poll(() => entered, { timeout }).toBe(true);
    expect(busy()).toBe(true);
    await expect(withWorkspaceRemoval(app.ctx.config.workspacesDir, child.workspace.id, async () => undefined)).rejects.toMatchObject({ code: 'WORKTREE_BUSY' });
    socket.terminate();
    await delay(30);
    release();
    await expect.poll(() => busy(), { timeout }).toBe(false);
    expect(await (await request(`/workspaces/${child.workspace.id}/terminals`)).json()).toEqual([]);
  });

  it('rolls admission back when actual HOME setup fails before spawning', async () => {
    const previous = app.ctx.config.homeDir;
    const invalidHome = path.join(directory, 'not-a-home-directory');
    await writeFile(invalidHome, 'a regular file');
    app.ctx.config.homeDir = invalidHome;
    try {
      const response = await request(`/workspaces/${child.workspace.id}/terminals`, 'POST', {});
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(busy()).toBe(false);
      expect(await (await request(`/workspaces/${child.workspace.id}/terminals`)).json()).toEqual([]);
    } finally { app.ctx.config.homeDir = previous; }
    expect((await request(removeRoute(), 'DELETE')).status).toBe(200);
  });

  it('retains a live PTY lease across disconnect/logout and emits end only after confirmed cleanup', async () => {
    const terminal = await createTerminal();
    const connection = await connect(terminal.id);
    await assertBusy();
    connection.socket.close();
    await expect.poll(() => connection.closeCode(), { timeout }).toBe(1005);
    await assertBusy();
    expect((await request('/session', 'DELETE')).status).toBe(200);
    expect(busy()).toBe(true);
    expect((await processIdentity(terminal.pid))?.live).toBe(true);
    expect(ends).toEqual([]);
    await login();
    await closeTerminal(terminal);
    await expect.poll(() => busy(), { timeout }).toBe(false);
    expect(ends.filter(event => event.sessionId === terminal.id)).toEqual([{ workspaceId: child.workspace.id, sessionId: terminal.id }]);
    expect((await request(removeRoute(), 'DELETE')).status).toBe(200);
  });

  it('does not accumulate activity entries across repeated otherwise idle close/reopen cycles', async () => {
    for (let index = 0; index < 5; index++) {
      const terminal = await createTerminal();
      expect(busy()).toBe(true);
      await closeTerminal(terminal);
      await expect.poll(() => busy(), { timeout }).toBe(false);
      expect(ends.filter(event => event.sessionId === terminal.id)).toHaveLength(1);
    }
    expect((await request(removeRoute(), 'DELETE')).status).toBe(200);
  });

  it.each(['nohup', 'setsid'] as const)('keeps the checkout busy while a real %s child outlives its closed terminal', async (mode) => {
    const terminal = await createTerminal();
    const connection = await connect(terminal.id);
    const childProcess = await background(connection, mode);
    await closeTerminal(terminal);
    await delay(1000);
    expect((await processIdentity(childProcess.pid))?.live).toBe(true);
    expect(ends.filter(event => event.sessionId === terminal.id)).toEqual([]);
    await assertBusy();
    await writeFile(childProcess.gate, 'go');
    await expect.poll(async () => access(childProcess.done).then(() => true, () => false), { timeout }).toBe(true);
    expect(await readFile(path.join(child.workspace.path, 'notes.txt'), 'utf8')).toBe('delayed terminal write\n');
    await expect.poll(() => busy(), { timeout }).toBe(false);
    expect(ends.filter(event => event.sessionId === terminal.id)).toHaveLength(1);
    await app.ctx.workspaces.writeFile(child.workspace.id, 'notes.txt', baseline);
    expect((await request(removeRoute(), 'DELETE')).status).toBe(200);
  });

  it('drains marker-owned escaped native children during application shutdown before release', async () => {
    const terminal = await createTerminal();
    const connection = await connect(terminal.id);
    const childProcess = await background(connection, 'setsid', true);
    await closeTerminal(terminal);
    expect(busy()).toBe(true);
    const firstClose = app.close();
    const secondClose = app.close();
    expect(secondClose).toBe(firstClose);
    const observed = await Promise.all([firstClose, secondClose].map(close => close.then(async () => ({
      childLive: (await processIdentity(childProcess.pid))?.live ?? false,
      busy: busy(),
    }))));
    closed = true;
    expect(observed).toEqual([{ childLive: false, busy: false }, { childLive: false, busy: false }]);
    expect((await processIdentity(childProcess.pid))?.live ?? false).toBe(false);
    expect(busy()).toBe(false);
    expect(ends.filter(event => event.sessionId === terminal.id)).toHaveLength(1);
    expect(await readFile(path.join(child.workspace.path, 'notes.txt'), 'utf8')).toBe(baseline);
  });

  it('refuses to release uncertainty for an environment-clearing reparented process and never kills an unproven owner', async () => {
    const terminal = await createTerminal();
    const connection = await connect(terminal.id);
    const childProcess = await background(connection, 'cleared', true);
    await closeTerminal(terminal);
    await delay(1000);
    await assertBusy();
    await app.close(); closed = true;
    expect((await processIdentity(childProcess.pid))?.live).toBe(true);
    expect(busy()).toBe(true);
    expect(ends.filter(event => event.sessionId === terminal.id)).toEqual([]);
    await expect(withWorkspaceRemoval(app.ctx.config.workspacesDir, child.workspace.id, async () => undefined)).rejects.toMatchObject({ code: 'WORKTREE_BUSY' });
    expect(await readFile(path.join(child.workspace.path, 'notes.txt'), 'utf8')).toBe(baseline);
  });
});
