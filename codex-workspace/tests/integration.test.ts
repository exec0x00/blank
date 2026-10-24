import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Thread } from '../shared/types';
import { createApplication } from '../server/index';
import { loadConfig } from '../server/config';

const runtimes: Awaited<ReturnType<typeof createApplication>>[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.close()));
  await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

async function start(directory?: string) {
  const dataDir = directory || await fs.mkdtemp(path.join(os.tmpdir(), 'codex-composed-server-'));
  if (!directory) directories.push(dataDir);
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-composed-runtime-'));
  directories.push(runtimeDir);
  const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: dataDir, RUNTIME_DIR: runtimeDir, CODEX_CLI_TEST_START: '0', WORKSPACE_PASSWORD: 'test-composed-password', SESSION_SECRET: 'composed-session-secret-for-integration-tests', ENCRYPTION_KEY: 'composed-credential-key-for-integration-tests', PORT: '4399' });
  expect(config.codexCliAutoStart).toBe(false);
  const runtime = await createApplication(config);
  runtimes.push(runtime);
  await new Promise<void>(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
  const login = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Codex-Workspace': '1' }, body: JSON.stringify({ password: config.password }) });
  expect(login.status).toBe(200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const request = (route: string, method = 'GET', body?: unknown) => fetch(`${base}/api${route}`, {
    method,
    headers: { Cookie: cookie, 'X-Codex-Workspace': '1', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { ...runtime, base, request, cookie, dataDir };
}

describe('the complete application server', () => {
  it('serves authenticated requests while a slow metadata refresh runs and after it fails', async () => {
    const originalReaddir = fs.readdir;
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let paused = false;
    const readdir = vi.spyOn(fs, 'readdir').mockImplementation((async (...args: Parameters<typeof fs.readdir>) => {
      // Metadata walks use pinned directory descriptors. Hold the first scan
      // at a real filesystem boundary, as a slow remote bucket would.
      if (!paused && /^\/proc\/self\/fd\/\d+$/.test(String(args[0]))) {
        paused = true;
        await blocked;
        throw Object.assign(new Error('Remote metadata scan timed out'), { code: 'FILE_METADATA_SCAN_TIMEOUT' });
      }
      return Reflect.apply(originalReaddir, fs, args);
    }) as typeof fs.readdir);
    try {
      const app = await start();
      await vi.waitFor(() => expect(paused).toBe(true));
      expect(await (await fetch(`${app.base}/health`)).json()).toEqual({ status: 'ok' });
      expect((await fetch(`${app.base}/api/storage`)).status).toBe(401);
      expect(await (await app.request('/storage')).json()).toMatchObject({
        metadata: { initialized: true, capturing: true, lastCapturedAt: null },
      });

      release();
      await vi.waitFor(() => expect(app.metadata.status().error).not.toBeNull());
      expect(await (await fetch(`${app.base}/health`)).json()).toEqual({ status: 'ok' });
      expect(await (await app.request('/session')).json()).toEqual({ authenticated: true });
      readdir.mockRestore();
      await app.metadata.capture();
      expect(app.metadata.status()).toMatchObject({ initialized: true, error: null });
      expect(app.metadata.status().lastCapturedAt).not.toBeNull();
    } finally {
      release();
      readdir.mockRestore();
    }
  });

  it('composes authenticated modules and gates every access surface', async () => {
    const app = await start();
    expect(await (await fetch(`${app.base}/health`)).json()).toEqual({ status: 'ok' });
    for (const route of ['/bootstrap', '/workspaces', '/settings', '/github/accounts', '/threads', '/changes', '/provider/status', '/models', '/storage', '/threads/unknown/events']) {
      expect((await fetch(`${app.base}/api${route}`)).status, route).toBe(401);
    }
    const bootstrap = await (await app.request('/bootstrap')).json();
    expect(bootstrap.workspaces).toHaveLength(1);
    expect(bootstrap.settings.agentConfigured).toBe(false);
    expect(bootstrap.settings.chatgptConnected).toBe(false);
    expect(bootstrap.storage.path).toBe(app.dataDir);
    expect(await (await app.request('/github/accounts')).json()).toEqual([]);
    expect(await (await app.request('/provider/status')).json()).toMatchObject({ managed: true, backend: 'codex-cli', state: 'stopped', agentConfigured: false, apiKeyConfigured: false });
    expect(await (await app.request('/codex/runtime')).json()).toMatchObject({ backend: 'codex-cli', state: 'stopped', activeTurns: 0 });
    const models = await (await app.request('/models')).json();
    expect(models).toEqual({ backend: 'codex-cli', models: [], catalog: [], connected: false });
    await app.ctx.store.write('settings', { theme: 'light', fontSize: 17, provider: 'unapproved', apiKey: 'historical-private-value', baseUrl: 'https://invalid.example', endpoint: 'https://invalid.example/api' });
    const safeSettings = await (await app.request('/settings')).json();
    expect(safeSettings).toMatchObject({ theme: 'dark', fontSize: 17, provider: 'openai', agentConfigured: false });
    expect(JSON.stringify(safeSettings)).not.toContain('historical-private-value');
    expect(safeSettings).not.toHaveProperty('baseUrl');
    expect(safeSettings).not.toHaveProperty('endpoint');
    expect(safeSettings).not.toHaveProperty('apiKey');
    expect(await (await app.request('/storage')).json()).toMatchObject({ writable: true, metadata: { initialized: true } });
    const workspaceId = bootstrap.workspaces[0].id;
    const created = await app.request('/threads', 'POST', { workspaceId, title: 'A real conversation' });
    expect(created.status).toBe(503);
    expect(await created.json()).toMatchObject({ code: 'CODEX_UNAVAILABLE' });
    // This well-formed native ID is deliberately not a created conversation.
    // Body validation must reject malformed input before native work/lookup.
    const unavailableNativeId = '0199a111-1111-7111-8111-111111111111';
    expect((await app.request(`/threads/${unavailableNativeId}/run`, 'POST', { prompt: '' })).status).toBe(400);
    const nativePreferences = await app.request('/settings', 'PATCH', { model: 'gpt-6-astra', reasoningEffort: 'high' });
    expect(nativePreferences.status).toBe(503);
    expect(await nativePreferences.json()).toMatchObject({ code: 'CODEX_UNAVAILABLE' });
    expect((await app.request('/settings', 'PATCH', { apiKey: 'a-user-supplied-key' })).status).toBe(400);
    expect(await (await app.request(`/workspaces/${workspaceId}/terminals`)).json()).toEqual([]);
    expect((await app.request('/missing')).status).toBe(404);
    expect((await app.request('/provider/device/start', 'POST', {})).status).toBe(404);
  });

  it('retains ordinary files, Git state, threads, preferences, and valid sessions across application restart', async () => {
    const app = await start();
    const created = await app.request('/workspaces', 'POST', { name: 'Persistent project', initializeGit: true });
    expect(created.status).toBe(201);
    const workspace = await created.json();
    await app.request(`/workspaces/${workspace.id}/files`, 'POST', { path: 'hello.txt', kind: 'file' });
    const save = await app.request(`/workspaces/${workspace.id}/file`, 'PUT', { path: 'hello.txt', content: 'ordinary unencrypted workspace text\n' });
    expect(save.status).toBe(200);
    await app.request(`/workspaces/${workspace.id}`, 'PATCH', { active: true });
    const rejectedNative = await app.request('/settings', 'PATCH', { reasoningEffort: 'high', webSearchMode: 'live' });
    expect(rejectedNative.status).toBe(503);
    expect(await rejectedNative.json()).toMatchObject({ code: 'CODEX_UNAVAILABLE' });
    const preferences = { fontSize: 16, wordWrap: true };
    const savedSettings = await app.request('/settings', 'PATCH', preferences);
    expect(savedSettings.status).toBe(200);
    expect(await savedSettings.json()).toMatchObject({ ...preferences, theme: 'dark' });
    const stamp = '2026-09-20T00:00:00.000Z';
    const thread: Thread = { id: `thr_${randomUUID().replaceAll('-', '')}`, workspaceId: workspace.id, title: 'Saved thread',
      createdAt: stamp, updatedAt: stamp, status: 'idle', messages: [{ id: 'saved-user-message', role: 'user', content: 'A preserved request.', createdAt: stamp }] };
    // Real canonical prior history replaces the retired custom creation/index
    // path. Native persistence has separate controlled-boundary/live coverage.
    await app.ctx.store.write(`thread-${thread.id}`, { thread, input: [{ type: 'reasoning', encrypted_content: 'PRIVATE_PRESERVED_INPUT' }] });
    const canonical = await fs.readFile(path.join(app.ctx.config.stateDir, `thread-${thread.id}.json`), 'utf8');
    const savedThread = await (await app.request(`/threads/${thread.id}`)).json();
    expect(savedThread).toMatchObject({ id: thread.id, title: 'Saved thread', backend: 'legacy', readOnly: true });
    expect(savedThread.messages).toMatchObject(thread.messages);
    expect(JSON.stringify(savedThread)).not.toContain('PRIVATE_PRESERVED_INPUT');
    await app.close();
    const resumed = await start(app.dataDir);
    const bootstrap = await (await resumed.request('/bootstrap')).json();
    expect(bootstrap.activeWorkspaceId).toBe(workspace.id);
    expect(bootstrap.settings).toMatchObject({ ...preferences, theme: 'dark' });
    expect(await fs.readFile(path.join(workspace.path, 'hello.txt'), 'utf8')).toBe('ordinary unencrypted workspace text\n');
    expect(await (await resumed.request(`/workspaces/${workspace.id}/file?path=hello.txt`)).json()).toMatchObject({ content: 'ordinary unencrypted workspace text\n' });
    expect(await (await resumed.request(`/workspaces/${workspace.id}/git/status`)).json()).toMatchObject({ isRepository: true, branch: 'main' });
    expect(await (await resumed.request(`/threads/${thread.id}`)).json()).toEqual(savedThread);
    expect(await fs.readFile(path.join(resumed.ctx.config.stateDir, `thread-${thread.id}.json`), 'utf8')).toBe(canonical);
    const oldSession = await fetch(`${resumed.base}/api/session`, { headers: { Cookie: app.cookie } });
    expect(await oldSession.json()).toEqual({ authenticated: true });
  });

  it.each(['light', 'system'])('restores legacy %s settings in dark mode without losing other preferences', async theme => {
    const app = await start();
    const preferences = { model: 'gpt-daybreak-red-latest', reasoningEffort: 'xhigh', webSearchMode: 'disabled', autoApprove: true, fontSize: 19, wordWrap: true };
    await app.ctx.store.write('settings', { ...preferences, theme });
    await app.close();
    const resumed = await start(app.dataDir);
    expect(await (await resumed.request('/settings')).json()).toMatchObject({ ...preferences, theme: 'dark' });
    expect((await (await resumed.request('/bootstrap')).json()).settings).toMatchObject({ ...preferences, theme: 'dark' });
    const rejected = await resumed.request('/settings', 'PATCH', { theme, fontSize: 20 });
    expect(rejected.status).toBe(400);
    expect(await resumed.ctx.store.read('settings', null)).toEqual({ ...preferences, theme });
    const changed = await resumed.request('/settings', 'PATCH', { fontSize: 18 });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject({ ...preferences, fontSize: 18, theme: 'dark' });
    expect(await resumed.ctx.store.read('settings', null)).toEqual({ ...preferences, fontSize: 18 });
  });
});
