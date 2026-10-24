import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { EventEmitter } from 'node:events';
import type { AppContext } from '../server/context';
import type { Workspace } from '../shared/types';
import { loadConfig } from '../server/config';
import { JsonStore, SecretStore } from '../server/store';
import { AuthService } from '../server/auth';
import { WorkspaceService, createWorkspaceRouter } from '../server/workspaces';
import { cleanupWorkspaceConversationState } from '../server/agent/workspace-conversation-cleanup';
import type { WorkspaceArtifactCleanupRequest } from '../server/workspace-trash/service';

const threadId = `thr_${'3'.repeat(32)}`, sentinel = 'API_OWNED_CONVERSATION_BYTES';
describe('authenticated workspace deletion removes conversation artifacts', () => {
  let directory: string, ctx: AppContext, workspace: Workspace, auth: AuthService, server: Server, base: string, cookie: string;
  let cleanup: ReturnType<typeof vi.fn<(request: WorkspaceArtifactCleanupRequest) => Promise<void>>>;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-workspace-conversation-api-'));
    const config = loadConfig({ DATA_DIR: directory, WORKSPACE_PASSWORD: 'api-cleanup-fixture', SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'k'.repeat(64) });
    const store = new JsonStore(config.stateDir);
    cleanup = vi.fn(async (request: WorkspaceArtifactCleanupRequest) => cleanupWorkspaceConversationState(ctx, request));
    const workspaces = new WorkspaceService(config, store, { cleanupWorkspaceArtifacts: cleanup });
    ctx = { config, store, workspaces, secrets: new SecretStore(store, config.encryptionKey), events: new EventEmitter(),
      settings: vi.fn(async () => { throw new Error('Deletion may not initialize model settings.'); }),
      saveSettings: vi.fn(async () => { throw new Error('Deletion may not change global settings.'); }),
      providerKey: vi.fn(async () => { throw new Error('Deletion may not request a model.'); }) };
    await workspaces.initialize(); workspace = await workspaces.create({ name: 'API deletion source' });
    const at = new Date().toISOString(), summary = { id: threadId, workspaceId: workspace.id, title: sentinel, createdAt: at, updatedAt: at, status: 'idle' };
    await store.write(`thread-${threadId}`, { thread: { ...summary, messages: [{ id: 'msg_saved', role: 'user', content: sentinel, createdAt: at }], turns: [] },
      input: [{ role: 'user', content: sentinel }], revision: 1 });
    await store.write(`thread-summary-${threadId}`, { version: 1, summary });
    await store.write('thread-index', [summary]);
    await store.write('agent-changes', [{ id: 'saved-source-copy', workspaceId: workspace.id, threadId, path: 'source.ts', status: 'kept', original: sentinel, modified: sentinel, createdAt: at }]);
    await store.write('settings', { marker: 'saved-configuration' });
    auth = new AuthService(ctx); await auth.initialize();
    const app = express(); app.use(express.json());
    app.use('/api', auth.protectMutations, auth.router(), auth.requireSession, createWorkspaceRouter(ctx));
    app.use((error: Error & { status?: number; code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(error.status ?? 500).json({ error: error.message, code: error.code });
    });
    server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const loggedIn = await fetch(`${base}/api/session`, { method: 'POST', headers: { Origin: base, 'X-Codex-Workspace': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: config.password }) });
    expect(loggedIn.status).toBe(200); await loggedIn.json(); cookie = loggedIn.headers.get('set-cookie')!.split(';')[0];
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    server?.closeAllConnections();
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    await auth?.close(); await ctx?.workspaces.closeFileTrashPages(); await ctx?.workspaces.closeTrashCleanup();
    await ctx?.store.flush(); await fs.rm(directory, { recursive: true, force: true });
  });
  const request = (route: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => fetch(`${base}/api${route}`, {
    method, headers: { Origin: base, Cookie: cookie, 'X-Codex-Workspace': '1', 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const threadFile = () => path.join(ctx.config.stateDir, `thread-${threadId}.json`);

  it('does not admit unauthenticated or cross-origin deletion', async () => {
    const missingSession = await request(`/workspaces/${workspace.id}`, 'DELETE', { expectedMode: 'trash' }, { Cookie: '' });
    expect(missingSession.status).toBe(401); await missingSession.json();
    const crossOrigin = await request(`/workspaces/${workspace.id}`, 'DELETE', { expectedMode: 'trash' }, { Origin: 'https://outside.invalid' });
    expect(crossOrigin.status).toBe(403); await crossOrigin.json();
    expect(cleanup).not.toHaveBeenCalled();
    expect(await fs.readFile(threadFile(), 'utf8')).toContain(sentinel);
  });

  it('retains ordinary trash state until the authenticated permanent purge endpoint succeeds', async () => {
    const deleted = await request(`/workspaces/${workspace.id}`, 'DELETE', { expectedMode: 'trash' });
    expect(deleted.status).toBe(200); const result = await deleted.json();
    expect(result.mode).toBe('trash'); expect(cleanup).not.toHaveBeenCalled();
    expect(await fs.readFile(threadFile(), 'utf8')).toContain(sentinel);
    const purged = await request(`/workspace-trash/${result.trash.id}`, 'DELETE', {});
    expect(purged.status).toBe(200); expect(await purged.json()).toMatchObject({ deleted: true, id: result.trash.id });
    expect(cleanup).toHaveBeenCalledTimes(1);
    await expect(fs.stat(threadFile())).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await ctx.store.read('agent-changes', [])).toEqual([]);
    expect(await ctx.store.read('settings', null)).toEqual({ marker: 'saved-configuration' });
    expect(ctx.settings).not.toHaveBeenCalled(); expect(ctx.providerKey).not.toHaveBeenCalled();
  });

  it('reports incomplete GitHub permanent cleanup and retries the same deletion without restoring the missing root', async () => {
    await ctx.workspaces.completeGithubImport(workspace.id, 'verified-test-account', 'example/test-repository');
    const unlink = fs.unlink.bind(fs); let fail = true;
    const injected = vi.spyOn(fs, 'unlink').mockImplementation(async value => {
      if (fail && String(value).endsWith(`/thread-${threadId}.json`)) { fail = false; throw Object.assign(new Error('Injected state outage'), { code: 'EIO' }); }
      return unlink(value);
    });
    const response = await request(`/workspaces/${workspace.id}`, 'DELETE', { expectedMode: 'permanent' });
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'WORKSPACE_ARTIFACT_CLEANUP_FAILED' });
    await expect(fs.stat(workspace.path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(threadFile(), 'utf8')).toContain(sentinel);
    const statuses = await (await request('/workspace-deletions')).json();
    expect(statuses).toHaveLength(1); expect(statuses[0]).toMatchObject({ workspaceId: workspace.id, mode: 'permanent' });
    injected.mockRestore();
    const retried = await request(`/workspace-deletions/${statuses[0].id}/retry`, 'POST', {});
    expect(retried.status).toBe(200); expect(await retried.json()).toEqual({ removed: true, mode: 'permanent', workspaceId: workspace.id });
    await expect(fs.stat(threadFile())).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await (await request('/workspace-deletions')).json()).toEqual([]);
    expect(await ctx.store.read('settings', null)).toEqual({ marker: 'saved-configuration' });
  });
});
