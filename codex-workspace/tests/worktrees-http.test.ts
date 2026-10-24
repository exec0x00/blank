import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { createApplication } from '../server/index';
import { loadConfig } from '../server/config';
import { GitService } from '../server/git';
import * as gitModule from '../server/git';
import { workspaceIsBusy } from '../server/worktrees/activity';
import { readWorktreeRecord } from '../server/worktrees/records';
import type { CreatedWorktree, Workspace } from '../shared/types';

let directory: string;
let app: Awaited<ReturnType<typeof createApplication>>;
let base: string;
let cookie: string;
let source: Workspace;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-worktree-http-'));
  const config = loadConfig({ DATA_DIR: directory, NODE_ENV: 'test', WORKSPACE_PASSWORD: 'worktrees-http-test-password', SESSION_SECRET: 'worktrees-http-session-secret-over-32-characters', ENCRYPTION_KEY: 'worktrees-http-encryption-key-over-32-characters' });
  app = await createApplication(config);
  source = await app.ctx.workspaces.create({ name: 'HTTP source', initializeGit: true });
  await app.ctx.workspaces.writeFile(source.id, 'notes.txt', 'real committed content\n');
  const git = new GitService(app.ctx);
  await git.stage(source.id, ['notes.txt']);
  await git.commit(source.id, 'HTTP baseline');
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const signedIn = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Codex-Workspace': '1', Origin: base }, body: JSON.stringify({ password: config.password }) });
  expect(signedIn.status).toBe(200);
  cookie = signedIn.headers.get('set-cookie')!.split(';')[0];
});

afterEach(async () => {
  await app?.close();
  vi.restoreAllMocks();
  await fs.rm(directory, { recursive: true, force: true });
});

function request(route: string, method = 'GET', body?: unknown, headers?: Record<string, string>) {
  return fetch(`${base}/api${route}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Codex-Workspace': '1', Origin: base, ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function create(): Promise<CreatedWorktree> {
  const response = await request(`/workspaces/${source.id}/worktrees`, 'POST', { branch: 'http/task', createBranch: true });
  expect(response.status).toBe(201);
  return response.json();
}

describe('worktree routes in the real composed application', () => {
  it('authenticates list and mutation routes and rejects cross-origin creation and forced deletion', async () => {
    const route = `/workspaces/${source.id}/worktrees`;
    expect((await fetch(`${base}/api${route}`)).status).toBe(401);
    expect((await fetch(`${base}/api${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Codex-Workspace': '1', Origin: base }, body: '{}' })).status).toBe(401);
    expect((await request(route, 'POST', { branch: 'cross-origin', createBranch: true }, { Origin: 'https://unrelated.example' })).status).toBe(403);
    expect(await (await request(route)).json()).toEqual([]);
    const child = await create();
    const forced = await request(`${route}/${child.worktree.id}`, 'DELETE', { force: true });
    expect(forced.status).toBe(400);
    expect(await forced.json()).toMatchObject({ code: 'INVALID_WORKTREE' });
    expect(await fs.readFile(path.join(child.workspace.path, 'notes.txt'), 'utf8')).toBe('real committed content\n');
    const other = await app.ctx.workspaces.create({ name: 'Other repository', initializeGit: true });
    expect((await request(`/workspaces/${other.id}/worktrees/${child.worktree.id}/open`, 'POST', {})).status).toBe(404);
  });

  it('uses native files and Git through HTTP, preserves dirty data across archive/open, and removes only after committing', async () => {
    const { workspace, worktree } = await create();
    const route = `/workspaces/${source.id}/worktrees/${worktree.id}`;
    expect(await (await request(`/workspaces/${workspace.id}/git/status`)).json()).toMatchObject({ isRepository: true, branch: 'http/task', files: [] });
    expect((await request(`/workspaces/${workspace.id}/file`, 'PUT', { path: 'new.txt', content: 'valuable native text\n' })).status).toBe(200);
    const refused = await request(route, 'DELETE');
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'WORKTREE_DIRTY' });
    expect(await (await request(`${route}/archive`, 'POST', {})).json()).toMatchObject({ id: worktree.id, state: 'archived' });
    expect((await request(`/workspaces/${workspace.id}/file?path=new.txt`)).status).toBe(404);
    expect(await (await request(`${route}/open`, 'POST', {})).json()).toMatchObject({ id: workspace.id, path: workspace.path });
    expect(await (await request(`/workspaces/${workspace.id}/file?path=new.txt`)).json()).toMatchObject({ content: 'valuable native text\n' });
    expect((await request(`/workspaces/${workspace.id}/git/stage`, 'POST', { paths: ['new.txt'] })).status).toBe(200);
    expect((await request(`/workspaces/${workspace.id}/git/commit`, 'POST', { message: 'Keep the native HTTP work' })).status).toBe(200);
    expect(await (await request(route, 'DELETE')).json()).toEqual({ removed: true, workspaceId: workspace.id });
    await expect(fs.lstat(workspace.path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await (await request(`/workspaces/${source.id}/worktrees`)).json()).toEqual([]);
  });

  it('keeps a real native terminal checkout in use until its owned shell has ended', async () => {
    const { workspace, worktree } = await create();
    const started = await request(`/workspaces/${workspace.id}/terminals`, 'POST', {});
    expect(started.status).toBe(201);
    const terminal = await started.json() as { id: string; pid: number };
    expect(terminal.pid).toBeGreaterThan(1);
    const route = `/workspaces/${source.id}/worktrees/${worktree.id}`;
    const blocked = await request(route, 'DELETE');
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ code: 'WORKTREE_BUSY' });
    expect((await request(`/terminals/${terminal.id}`, 'DELETE')).status).toBe(200);
    const deadline = Date.now() + 5000;
    while (workspaceIsBusy(app.ctx.config.workspacesDir, workspace.id) && Date.now() < deadline) await delay(10);
    expect(workspaceIsBusy(app.ctx.config.workspacesDir, workspace.id)).toBe(false);
    expect(() => process.kill(terminal.pid, 0)).toThrow();
    expect((await request(route, 'DELETE')).status).toBe(200);
  });

  it('drains an in-flight native Git command and preserves its journal through actual application close', async () => {
    const run = gitModule.runGit;
    let checkout = '';
    vi.spyOn(gitModule, 'runGit').mockImplementation((cwd, args, options) => {
      if (!checkout && args.includes('checkout-index')) {
        checkout = cwd;
        return run(cwd, ['-c', 'alias.httpworktreewait=!printf %s $$ > closing-pid.txt; sleep 30', 'httpworktreewait'], options);
      }
      return run(cwd, args, options);
    });
    const pending = request(`/workspaces/${source.id}/worktrees`, 'POST', { branch: 'http/closing', createBranch: true });
    const deadline = Date.now() + 5000;
    while (!checkout || !await fs.lstat(path.join(checkout, 'closing-pid.txt')).then(() => true, () => false)) {
      if (Date.now() > deadline) throw new Error('The HTTP Git operation did not start.');
      await delay(5);
    }
    const pid = Number(await fs.readFile(path.join(checkout, 'closing-pid.txt'), 'utf8'));
    expect(pid).toBeGreaterThan(1);
    await app.close();
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'GIT_INTERRUPTED' });
    expect(() => process.kill(pid, 0)).toThrow();
    const record = await readWorktreeRecord(app.ctx, path.basename(checkout));
    expect(record).toMatchObject({ phase: 'recovery', path: checkout });
    expect(await fs.readFile(path.join(checkout, 'closing-pid.txt'), 'utf8')).toBe(String(pid));
    expect(workspaceIsBusy(app.ctx.config.workspacesDir, path.basename(checkout))).toBe(false);
  });
});
