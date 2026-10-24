import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createServer, request as httpRequest, type Server } from 'node:http';
import express, { type ErrorRequestHandler } from 'express';
import type { Bootstrap, Workspace, WorkspacePage } from '../shared/types';
import { AuthService } from '../server/auth';
import { loadConfig } from '../server/config';
import type { AppContext } from '../server/context';
import { HttpError } from '../server/errors';
import { createSettingsRouter, defaultSettings } from '../server/settings';
import { JsonStore, SecretStore } from '../server/store';
import { WorkspaceService, createWorkspaceRouter } from '../server/workspaces';
import { getWorkspacePage, WORKSPACE_INDEX_FRESHNESS_MS } from '../server/workspace-pages';

describe('bounded workspace pages backed by independent native registrations', () => {
  let directory: string;
  let ctx: AppContext;
  const servers: Server[] = [];
  const authServices: AuthService[] = [];

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-workspace-pages-'));
    const config = loadConfig({ DATA_DIR: directory, WORKSPACE_PASSWORD: 'page-test-only-password', SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'k'.repeat(64) });
    const store = new JsonStore(config.stateDir);
    await store.write('workspaces', []);
    ctx = { config, store, secrets: new SecretStore(store, config.encryptionKey), events: new EventEmitter(),
      workspaces: new WorkspaceService(config, store), settings: async () => defaultSettings,
      saveSettings: async patch => ({ ...defaultSettings, ...patch }), providerKey: async () => undefined };
    await ctx.workspaces.initialize();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const server of servers.splice(0)) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
    for (const auth of authServices.splice(0)) await auth.close();
    await ctx.workspaces.closeTrashCleanup();
    await fs.rm(directory, { recursive: true, force: true });
  });

  async function seed(count: number): Promise<Workspace[]> {
    const workspaces: Workspace[] = [];
    for (let index = 0; index < count; index++) {
      const id = `project-${String(index).padStart(4, '0')}`;
      const date = new Date(Date.UTC(2025, 0, 1) + index * 1000).toISOString();
      const workspace: Workspace = { id, name: `Project ${String(index).padStart(4, '0')}`, path: path.join(ctx.config.workspacesDir, id), createdAt: date, updatedAt: date };
      await fs.mkdir(workspace.path);
      await ctx.store.write(`workspace-record-${id}`, workspace);
      workspaces.push(workspace);
    }
    return workspaces;
  }

  async function httpFixture() {
    const auth = new AuthService(ctx); await auth.initialize(); authServices.push(auth);
    const app = express();
    app.use('/api', auth.protectMutations);
    app.use('/api/session', express.json({ limit: '4kb' }));
    app.use('/api', auth.router(), auth.requireSession, express.json({ limit: '8mb' }), createWorkspaceRouter(ctx), createSettingsRouter(ctx));
    const errors: ErrorRequestHandler = (error, _req, res, _next) => {
      if (error instanceof HttpError) { res.status(error.status).json({ error: error.message, code: error.code }); return; }
      res.status(500).json({ error: 'Unexpected fixture failure.' });
    };
    app.use(errors);
    const server = createServer(app); servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing HTTP fixture address.');
    const origin = `http://127.0.0.1:${address.port}`;
    let cookie = '';
    const request = (route: string, options: { method?: string; body?: unknown; authenticated?: boolean; origin?: string } = {}) => new Promise<{ status: number; body: unknown; cookie?: string }>((resolve, reject) => {
      const body = options.body === undefined ? undefined : JSON.stringify(options.body);
      const request = httpRequest(`${origin}/api${route}`, { method: options.method || 'GET', agent: false, headers: {
        Origin: options.origin || origin, 'X-Codex-Workspace': '1', ...(cookie && options.authenticated !== false ? { Cookie: cookie } : {}),
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
      } }, response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.once('error', reject);
        response.once('end', () => {
          try { resolve({ status: response.statusCode || 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8')), cookie: response.headers['set-cookie']?.[0]?.split(';')[0] }); }
          catch (error) { reject(error); }
        });
      });
      request.once('error', reject); request.end(body);
    });
    const login = await request('/session', { method: 'POST', body: { password: 'page-test-only-password' } });
    expect(login.status).toBe(200); cookie = login.cookie || ''; expect(cookie).not.toBe('');
    return request;
  }

  it('returns bounded pages in both directions and searches beyond the first page without rereading the registry on warm requests', async () => {
    const workspaces = await seed(87);
    const source = vi.spyOn(ctx.workspaces, 'listMetadata');
    const first = await getWorkspacePage(ctx, { limit: 40 });
    expect(first.workspaces.map(workspace => workspace.id)).toEqual(workspaces.slice(0, 40).map(workspace => workspace.id));
    expect(first).toMatchObject({ offset: 0, total: 87, previousCursor: null });
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(source).toHaveBeenCalledTimes(1);
    const readdir = vi.spyOn(fs, 'readdir');
    const reads = vi.spyOn(ctx.store, 'read');
    const second = await getWorkspacePage(ctx, { limit: 40, cursor: first.nextCursor! });
    expect(second.workspaces.map(workspace => workspace.id)).toEqual(workspaces.slice(40, 80).map(workspace => workspace.id));
    expect(second).toMatchObject({ offset: 40, total: 87 });
    expect(source).toHaveBeenCalledTimes(1);
    expect(readdir.mock.calls.filter(call => String(call[0]) === ctx.config.stateDir)).toHaveLength(0);
    expect(new Set(reads.mock.calls.map(call => call[0]).filter(key => key.startsWith('workspace-record-'))).size).toBeLessThanOrEqual(40);
    const back = await getWorkspacePage(ctx, { limit: 40, cursor: second.previousCursor! });
    expect(back.workspaces).toEqual(first.workspaces);
    const last = await getWorkspacePage(ctx, { limit: 40, cursor: second.nextCursor! });
    expect(last).toMatchObject({ offset: 80, total: 87, nextCursor: null });
    expect(last.workspaces).toHaveLength(7);
    const search = await getWorkspacePage(ctx, { query: ' PROJECT 0086 ' });
    expect(search.workspaces).toEqual([workspaces[86]]);
    expect(source).toHaveBeenCalledTimes(1);
  });

  it('binds cursors to search and page size, rejects forged offsets and bounds request inputs', async () => {
    await seed(7);
    const first = await getWorkspacePage(ctx, { limit: 2 });
    await expect(getWorkspacePage(ctx, { limit: 3, cursor: first.nextCursor! })).rejects.toMatchObject({ status: 400, code: 'INVALID_WORKSPACE_CURSOR' });
    await expect(getWorkspacePage(ctx, { limit: 2, query: 'different', cursor: first.nextCursor! })).rejects.toMatchObject({ status: 400, code: 'INVALID_WORKSPACE_CURSOR' });
    const parts = first.nextCursor!.split('.');
    parts[0] = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(parts[0], 'base64url').toString()), offset: 4 })).toString('base64url');
    await expect(getWorkspacePage(ctx, { limit: 2, cursor: parts.join('.') })).rejects.toMatchObject({ status: 400 });
    for (const limit of [0, 101, 1.5, NaN]) await expect(getWorkspacePage(ctx, { limit })).rejects.toMatchObject({ status: 400 });
    await expect(getWorkspacePage(ctx, { query: 'x'.repeat(201) })).rejects.toMatchObject({ status: 400 });
    const request = await httpFixture();
    for (const suffix of ['limit=101', 'limit=2&limit=3', 'limit=2&refresh=yes', 'limit=2&unknown=true', 'limit=2&query=%00']) {
      expect((await request(`/workspaces?${suffix}`)).status).toBe(400);
    }
  });

  it('patches changed local metadata immediately, preserves per-workspace files and invalidates stale page cursors', async () => {
    const workspaces = await seed(9);
    const first = await getWorkspacePage(ctx, { limit: 2 });
    const source = vi.spyOn(ctx.workspaces, 'listMetadata');
    const edited = await ctx.workspaces.update(workspaces[8].id, { name: 'Off-page renamed project', githubAccountId: 'saved-account' });
    const found = await getWorkspacePage(ctx, { query: 'renamed' });
    expect(found.workspaces).toEqual([edited]);
    expect(source).not.toHaveBeenCalled();
    await expect(getWorkspacePage(ctx, { limit: 2, cursor: first.nextCursor! })).rejects.toMatchObject({ status: 409, code: 'WORKSPACE_LIST_CHANGED' });
    const created = await ctx.workspaces.create({ name: 'New project' });
    expect((await getWorkspacePage(ctx, { query: created.id })).workspaces).toEqual([created]);
    await ctx.workspaces.remove(workspaces[0].id);
    expect((await getWorkspacePage(ctx)).total).toBe(9);
    expect(await fs.stat(workspaces[0].path)).toBeTruthy();
    const restarted = new WorkspaceService(ctx.config, new JsonStore(ctx.config.stateDir));
    await restarted.initialize();
    await expect(restarted.getAvailable(workspaces[0].id)).rejects.toMatchObject({ status: 404 });
    expect((await restarted.getAvailable(edited.id)).githubAccountId).toBe('saved-account');
    expect(await ctx.store.read(`workspace-record-${created.id}`, null)).toEqual(created);
    await restarted.closeTrashCleanup();
  });

  it('discovers external changes after bounded freshness and shares an explicit refresh across concurrent pages', async () => {
    const workspaces = await seed(6);
    await getWorkspacePage(ctx, { limit: 2 });
    const changed = { ...workspaces[5], name: 'Another instance renamed this', updatedAt: new Date().toISOString() };
    await new JsonStore(ctx.config.stateDir).write(`workspace-record-${changed.id}`, changed);
    expect((await getWorkspacePage(ctx, { limit: 2, query: 'another instance' })).workspaces).toHaveLength(0);
    const source = vi.spyOn(ctx.workspaces, 'listMetadata');
    const pages = await Promise.all(Array.from({ length: 5 }, () => getWorkspacePage(ctx, { query: 'another instance', refresh: true })));
    expect(pages.every(page => page.workspaces[0]?.name === changed.name)).toBe(true);
    expect(source).toHaveBeenCalledTimes(1);
    const changedAgain = { ...changed, name: 'Fresh after expiry', updatedAt: new Date().toISOString() };
    await new JsonStore(ctx.config.stateDir).write(`workspace-record-${changed.id}`, changedAgain);
    const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + WORKSPACE_INDEX_FRESHNESS_MS + 1);
    expect((await getWorkspacePage(ctx, { query: 'fresh after expiry' })).workspaces).toEqual([changedAgain]);
    expect(source).toHaveBeenCalledTimes(2);
  });

  it('confirms selected and visible roots exactly without converting transient errors or unsafe links into deletion', async () => {
    const [workspace] = await seed(1);
    await getWorkspacePage(ctx);
    const lstat = fs.lstat.bind(fs);
    const unavailable = vi.spyOn(fs, 'lstat').mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
      if (String(args[0]) === ctx.config.workspacesDir) throw Object.assign(new Error('Fixture storage unavailable.'), { code: 'EIO' });
      return lstat(...args);
    }) as typeof fs.lstat);
    await expect(ctx.workspaces.getAvailable(workspace.id)).rejects.toMatchObject({ status: 503, code: 'WORKSPACE_UNAVAILABLE' });
    await expect(getWorkspacePage(ctx)).rejects.toMatchObject({ status: 503 });
    unavailable.mockRestore();
    expect(await ctx.store.read(`workspace-archived-${workspace.id}`, null)).toBeNull();
    const preserved = `${workspace.path}-preserved`;
    await fs.rename(workspace.path, preserved); await fs.symlink(preserved, workspace.path);
    await expect(ctx.workspaces.getAvailable(workspace.id)).rejects.toMatchObject({ status: 409, code: 'WORKSPACE_TRASH_UNSAFE' });
    expect(await ctx.store.read(`workspace-archived-${workspace.id}`, null)).toBeNull();
    await fs.unlink(workspace.path); await fs.rename(preserved, workspace.path);
    expect((await getWorkspacePage(ctx)).workspaces).toEqual([workspace]);
    await fs.rmdir(workspace.path);
    await expect(ctx.workspaces.getAvailable(workspace.id)).rejects.toMatchObject({ status: 404, code: 'WORKSPACE_DIRECTORY_MISSING' });
    expect((await getWorkspacePage(ctx)).workspaces).toHaveLength(0);
    expect(await ctx.store.read(`workspace-archived-${workspace.id}`, null)).not.toBeNull();
  });

  it('returns an off-page active workspace explicitly in authenticated bootstrap and exact lookup responses', async () => {
    const workspaces = await seed(45);
    const selected = await ctx.workspaces.update(workspaces[44].id, { active: true, githubAccountId: 'saved-account' });
    const request = await httpFixture();
    for (const route of ['/bootstrap', '/workspaces?limit=40', `/workspaces/${selected.id}`]) expect((await request(route, { authenticated: false })).status).toBe(401);
    const boot = await request('/bootstrap'); expect(boot.status).toBe(200);
    const body = boot.body as Bootstrap;
    expect(body.workspaces).toHaveLength(40);
    expect(body.workspaces.some(workspace => workspace.id === selected.id)).toBe(false);
    expect(body.activeWorkspace).toEqual(selected);
    expect(body.activeWorkspaceId).toBe(selected.id);
    expect(body.workspacePage).toMatchObject({ total: 45, offset: 0, previousCursor: null });
    expect(body.workspacePage?.nextCursor).toEqual(expect.any(String));
    expect((await request(`/workspaces/${selected.id}`)).body).toEqual(selected);
    const page = await request('/workspaces?limit=3'); expect((page.body as WorkspacePage).workspaces).toHaveLength(3);
    expect(Array.isArray((await request('/workspaces')).body)).toBe(true);
    expect((await request('/workspaces', { method: 'POST', body: { name: 'Rejected cross-origin request' }, origin: 'https://different.example' })).status).toBe(403);
    const logout = await request('/session', { method: 'DELETE' }); expect(logout.status).toBe(200);
    expect((await ctx.workspaces.getAvailable(selected.id)).githubAccountId).toBe('saved-account');
  });

  it('keeps trash restoration and derived metadata limits independent of canonical workspace records', async () => {
    const [workspace] = await seed(1);
    await fs.writeFile(path.join(workspace.path, 'retained.txt'), 'Actual saved workspace contents.');
    await getWorkspacePage(ctx);
    const deleted = await ctx.workspaces.trashWorkspace(workspace.id, { expectedMode: 'trash' });
    if (deleted.mode !== 'trash') throw new Error('Expected ordinary workspace trash.');
    expect((await getWorkspacePage(ctx)).workspaces).toHaveLength(0);
    const restored = await ctx.workspaces.restoreWorkspaceTrash(deleted.trash.id);
    expect((await getWorkspacePage(ctx)).workspaces).toEqual([restored]);
    expect(await fs.readFile(path.join(restored.path, 'retained.txt'), 'utf8')).toBe('Actual saved workspace contents.');
    const oversized = { ...restored, name: 'x'.repeat(40 * 1024) };
    await ctx.store.write(`workspace-record-${workspace.id}`, oversized);
    await expect(getWorkspacePage(ctx, { refresh: true })).rejects.toMatchObject({ status: 413, code: 'WORKSPACE_LIMIT' });
    expect(await ctx.store.read(`workspace-record-${workspace.id}`, null)).toEqual(oversized);
    expect(await fs.readFile(path.join(restored.path, 'retained.txt'), 'utf8')).toBe('Actual saved workspace contents.');
  });
});
