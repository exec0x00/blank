import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { createServer, request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import { ApiError } from '../client/api';
import { UiStateClient } from '../client/ui-state';
import type { UiState, UiStateChange, UiStatePatch } from '../shared/types';
import { AuthService } from '../server/auth';
import { shutdownAgent } from '../server/agent';
import { loadConfig } from '../server/config';
import type { AppContext } from '../server/context';
import { HttpError } from '../server/errors';
import { defaultSettings } from '../server/settings';
import { JsonStore, SecretStore } from '../server/store';
import { createUiStateRouter, readUiState } from '../server/ui-state';
import { WorkspaceService } from '../server/workspaces';

const password = 'ui-state-only-fixture-password';

const legacyId = (character: string) => `thr_${character.repeat(32)}`;
const ROOT_ONE = legacyId('1'), ROOT_TWO = legacyId('2'), OTHER_ROOT = legacyId('3');
const PARENT_ROOT = legacyId('4'), CHILD_THREAD = legacyId('5'), MISSING_THREAD = legacyId('f');
// Canonical legacy selection is valid while Codex is offline. The real
// conversation/legacy readers run, but any native readiness/RPC work is a bug.
const nativeWork = vi.hoisted(() => vi.fn((method: string): never => { throw new Error(`UI-state legacy selection attempted native work: ${method}`); }));
vi.mock('../server/codex-cli/runtime', () => ({ getCodexRuntime: () => ({
  onNotification: () => () => {}, onRequest: () => () => {}, onConnection: () => () => {},
  status: () => nativeWork('status'), generation: () => nativeWork('generation'), supports: () => nativeWork('supports'),
  request: () => nativeWork('request'), respond: () => nativeWork('respond'), rejectRequest: () => nativeWork('rejectRequest'),
  start: () => nativeWork('start'), close: async () => {},
}) }));
interface Reply { status: number; headers: IncomingHttpHeaders; body: Record<string, unknown>; text: string }
interface Options { method?: string; cookie?: string; body?: unknown; origin?: string; marker?: string }
interface Fixture { ctx: AppContext; request(route: string, options?: Options): Promise<Reply>; login(): Promise<string>; close(): Promise<void> }
let directory: string;
let fixture: Fixture;
let cookie: string;
let workspaceId: string;
const clients: UiStateClient[] = [];

async function createFixture(): Promise<Fixture> {
  const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: directory, RUNTIME_DIR: path.join(directory, 'runtime'), WORKSPACE_PASSWORD: password,
    SESSION_SECRET: 'ui-state-fixture-session-secret-not-a-real-key-12345', ENCRYPTION_KEY: 'ui-state-fixture-credential-key-not-a-real-key-12345' });
  const store = new JsonStore(config.stateDir);
  const ctx: AppContext = { config, store, secrets: new SecretStore(store, config.encryptionKey), events: new EventEmitter(),
    workspaces: new WorkspaceService(config, store), settings: async () => defaultSettings, saveSettings: async () => defaultSettings, providerKey: async () => undefined };
  await ctx.workspaces.initialize();
  const auth = new AuthService(ctx);
  await auth.initialize();
  const app = express();
  app.use('/api', auth.protectMutations);
  app.use('/api/session', express.json({ limit: '4kb' }));
  app.use('/api', auth.router());
  app.use('/api', auth.requireSession, express.json({ limit: '2mb' }), createUiStateRouter(ctx));
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof HttpError) return void res.status(error.status).json({ error: error.message, code: error.code });
    res.status(500).json({ error: 'Unexpected UI-state fixture failure.' });
  };
  app.use(errors);
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('UI-state HTTP fixture did not start.');
  const origin = `http://127.0.0.1:${address.port}`;
  const request = (route: string, options: Options = {}): Promise<Reply> => new Promise((resolve, reject) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = httpRequest(`${origin}/api${route}`, { method: options.method || 'GET', agent: false,
      headers: { Origin: options.origin ?? origin, 'X-Codex-Workspace': options.marker ?? '1',
        ...(options.cookie ? { Cookie: options.cookie } : {}),
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}) } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.once('error', reject);
      res.once('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: res.statusCode || 0, headers: res.headers, body: JSON.parse(text), text }); }
        catch { reject(new Error(`Invalid fixture response (${res.statusCode}).`)); }
      });
    });
    req.once('error', reject); req.setTimeout(5000, () => req.destroy(new Error('UI-state request timed out.'))); req.end(body);
  });
  let closed = false;
  return { ctx, request,
    login: async () => {
      const response = await request('/session', { method: 'POST', body: { password } });
      expect(response.status).toBe(200);
      const session = response.headers['set-cookie']?.[0]?.split(';')[0];
      if (!session) throw new Error('Fixture login did not provide a session.');
      return session;
    },
    close: async () => { if (closed) return; closed = true; await auth.close(); await shutdownAgent(ctx); await store.flush(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}
const state = async (session = cookie) => {
  const response = await fixture.request('/ui-state', { cookie: session });
  expect(response.status).toBe(200);
  return response.body as unknown as UiState;
};
const patch = (changes: UiStateChange[], revision = 0, session = cookie) => fixture.request('/ui-state', { method: 'PATCH', cookie: session, body: { revision, changes } });

async function seedLegacySelection(id: string, selectedWorkspace: string, options: { summaryOnly?: boolean; parentThreadId?: string } = {}) {
  const timestamp = '2026-09-22T16:40:00.000Z';
  const summary = { id, workspaceId: selectedWorkspace, title: 'Canonical previous conversation', createdAt: timestamp, updatedAt: timestamp,
    status: 'idle', ...(options.parentThreadId ? { parentThreadId: options.parentThreadId, rootThreadId: options.parentThreadId } : {}) };
  if (options.summaryOnly) await fixture.ctx.store.write(`thread-summary-${id}`, summary);
  else await fixture.ctx.store.write(`thread-${id}`, { thread: { ...summary, messages: [], turns: [] }, input: [], revision: 1 });
}
const tabs = (file: string, workId = workspaceId): UiStateChange => ({ section: 'workspace', workspaceId: workId, key: 'tabs', value: { paths: [file], active: file } });
const editor = (key: 'minimap' | 'lineNumbers', value: boolean): UiStateChange => ({ section: 'editor', key, value });
const memoryCache = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); }, values };
};
const transport = (session: () => string) => async (body?: UiStatePatch): Promise<UiState> => {
  const response = await fixture.request('/ui-state', { cookie: session(), ...(body ? { method: 'PATCH', body } : {}) });
  if (response.status !== 200) throw new ApiError(String(response.body.error), response.status, String(response.body.code));
  return response.body as unknown as UiState;
};
const client = (session: () => string = () => cookie, storage = memoryCache()) => {
  const result = new UiStateClient(transport(session), storage, 60_000);
  clients.push(result); return result;
};

beforeEach(async () => {
  nativeWork.mockClear();
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-ui-state-test-'));
  fixture = await createFixture(); cookie = await fixture.login(); workspaceId = (await fixture.ctx.workspaces.list())[0].id;
});
afterEach(async () => {
  clients.splice(0).forEach(item => item.dispose());
  await fixture?.close();
  await fs.rm(directory, { recursive: true, force: true });
  expect(nativeWork).not.toHaveBeenCalled();
});

describe('authenticated canonical interface preferences', () => {
  it('persists independent conversation tiers and an unsent-draft choice across server and browser reloads', async () => {
    const firstId = '01990000-0000-7000-8000-000000000101', secondId = '01990000-0000-7000-8000-000000000102';
    const storage = memoryCache(), live = client(() => cookie, storage);
    await live.hydrate(await state(), [workspaceId], 'desktop'); live.setSession(true);
    const tiers = { draft: 'priority', [firstId]: 'fast', [secondId]: 'ultrafast' };
    live.change(Object.entries(tiers).map(([id, value]) => ({ section: 'workspace', workspaceId, key: 'serviceTier', threadId: id === 'draft' ? null : id, value })));
    await live.flush();
    expect(live.getSnapshot().status).toBe('saved');
    live.dispose(); await fixture.close(); fixture = await createFixture(); cookie = await fixture.login();
    const reloaded = client(() => cookie, storage);
    await reloaded.hydrate(await state(), [workspaceId], 'desktop'); reloaded.setSession(true);
    expect(reloaded.getSnapshot().value.workspaces[workspaceId].serviceTiers).toEqual(tiers);
    reloaded.change([{ section: 'workspace', workspaceId, key: 'serviceTier', threadId: firstId, value: 'default' }]);
    await reloaded.flush();
    expect((await state()).workspaces[workspaceId].serviceTiers).toEqual({ ...tiers, [firstId]: 'default' });
  });

  it('merges independent tier choices from two browser windows without changing the other conversation', async () => {
    const first = client(), second = client();
    const a = '01990000-0000-7000-8000-000000000101', b = '01990000-0000-7000-8000-000000000102';
    for (const window of [first, second]) { await window.hydrate(await state(), [workspaceId], 'desktop'); window.setSession(true); }
    first.change([{ section: 'workspace', workspaceId, key: 'serviceTier', threadId: a, value: 'ultrafast' }]);
    second.change([{ section: 'workspace', workspaceId, key: 'serviceTier', threadId: b, value: 'fast' }]);
    await first.flush(); await second.flush();
    expect((await state()).workspaces[workspaceId].serviceTiers).toEqual({ [a]: 'ultrafast', [b]: 'fast' });
    expect(second.getSnapshot().status).toBe('saved');
  });

  it('refuses a tier map beyond its bound before writing canonical preferences', async () => {
    const tiers = Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [
      `01990000-0000-7000-8000-${index.toString(16).padStart(12, '0')}`, 'priority',
    ]));
    const initial = { ...await state(), workspaces: { [workspaceId]: { serviceTiers: tiers } } };
    await fixture.ctx.store.write('ui-state', initial);
    const response = await fixture.request('/ui-state', { method: 'PATCH', cookie, body: { revision: initial.revision,
      changes: [{ section: 'workspace', workspaceId, key: 'serviceTier', threadId: '01990000-0000-7000-8000-ffffffffffff', value: 'ultrafast' }] } });
    expect(response.status).toBe(503); expect(response.body.code).toBe('UI_STATE_INVALID');
    expect(await state()).toEqual(initial);
  });

  it('starts empty, requires the workspace password, and protects all mutations by origin', async () => {
    expect(await state()).toEqual({ version: 1, revision: 0, layouts: {}, editor: {}, workspaces: {}, fieldRevisions: {} });
    expect((await fixture.request('/ui-state')).status).toBe(401);
    const body = { revision: 0, changes: [editor('minimap', true)] };
    expect((await fixture.request('/ui-state', { method: 'PATCH', body })).status).toBe(401);
    expect((await fixture.request('/ui-state', { method: 'PATCH', cookie, body, origin: 'https://untrusted.invalid' })).status).toBe(403);
    expect((await fixture.request('/ui-state', { method: 'PATCH', cookie, body, marker: '' })).status).toBe(403);
    expect((await state()).revision).toBe(0);
  });

  it('persists an authorized native child selection across restart and rejects another workspace', async () => {
    const { getCodexConversations } = await import('../server/codex-cli/router');
    const childId = '0199ac01-0000-7000-8000-000000000002';
    // The native conversation service owns read-only metadata authorization.
    // This HTTP boundary must accept its verified child without resuming it.
    const summary = { id: childId, workspaceId, backend: 'codex-cli' as const,
      parentThreadId: '0199ac01-0000-7000-8000-000000000001', title: 'Verified child', status: 'idle' as const,
      createdAt: '2026-09-23T10:00:00.000Z', updatedAt: '2026-09-23T10:00:00.000Z' };
    const selection = vi.spyOn(getCodexConversations(fixture.ctx), 'summaryForSelection').mockResolvedValue(summary);
    const accepted = await patch([{ section: 'workspace', workspaceId, key: 'threadId', value: childId }]);
    expect(accepted.status).toBe(200);
    expect(selection).toHaveBeenCalledWith(childId);
    expect((await state()).workspaces[workspaceId]?.threadId).toBe(childId);

    const foreign = await fixture.ctx.workspaces.create({ name: 'Foreign native workspace' });
    selection.mockResolvedValue({ ...summary, workspaceId: foreign.id });
    const denied = await patch([{ section: 'workspace', workspaceId, key: 'threadId', value: childId }], 1);
    expect(denied.status).toBe(400);
    expect(denied.body.code).toBe('UI_STATE_THREAD_NOT_FOUND');
    expect((await state()).revision).toBe(1);

    await fixture.close();
    fixture = await createFixture(); cookie = await fixture.login();
    expect((await state()).workspaces[workspaceId]?.threadId).toBe(childId);
    expect(nativeWork).not.toHaveBeenCalled();
  });

  it('persists independent device layouts, editor selections, root threads and tabs across a new server and browser', async () => {
    const second = await fixture.ctx.workspaces.create({ name: 'Second workspace' });
    await seedLegacySelection(ROOT_ONE, workspaceId);
    // Selecting a canonical summary must not load or resume a full transcript.
    await seedLegacySelection(ROOT_TWO, second.id, { summaryOnly: true });
    const changed = await patch([
      { section: 'layout', profile: 'desktop', key: 'view', value: 'editor' },
      { section: 'layout', profile: 'desktop', key: 'split', value: 'split' },
      { section: 'layout', profile: 'laptop', key: 'sidebar', value: 'collapsed' },
      { section: 'layout', profile: 'tablet', key: 'view', value: 'git' },
      { section: 'layout', profile: 'mobile', key: 'view', value: 'terminal' },
      editor('minimap', true), editor('lineNumbers', false), { section: 'editor', key: 'wrap', value: null },
      { section: 'workspace', workspaceId, key: 'threadId', value: ROOT_ONE }, tabs('README.md'),
      { section: 'workspace', workspaceId: second.id, key: 'threadId', value: ROOT_TWO }, tabs('src/future-file.ts', second.id),
    ]);
    expect(changed.status).toBe(200);
    const file = path.join(fixture.ctx.config.stateDir, 'ui-state.json');
    expect(file.startsWith(fixture.ctx.config.dataDir)).toBe(true);
    const saved = await fs.readFile(file, 'utf8');
    expect(JSON.parse(saved)).toEqual(changed.body);
    expect(saved).toContain('src/future-file.ts');
    await fixture.close(); fixture = await createFixture();
    const newBrowserCookie = await fixture.login();
    expect(await state(newBrowserCookie)).toEqual(changed.body);
    const fresh = client(() => newBrowserCookie);
    await fresh.hydrate(await state(newBrowserCookie), [workspaceId, second.id], 'mobile');
    expect(fresh.getSnapshot().value.layouts.mobile?.view).toBe('terminal');
    expect(fresh.getSnapshot().value.workspaces[second.id].tabs?.active).toBe('src/future-file.ts');
    expect(fresh.getSnapshot().value.workspaces[workspaceId].threadId).toBe(ROOT_ONE);
  });

  it('merges stale revisions on unrelated fields and never partially applies a conflicting patch', async () => {
    expect((await patch([editor('minimap', true)])).status).toBe(200);
    expect((await patch([editor('lineNumbers', false), tabs('README.md')])).status).toBe(200);
    const before = await state();
    const collision = await patch([editor('minimap', false), { section: 'layout', profile: 'mobile', key: 'view', value: 'git' }]);
    expect(collision.status).toBe(409);
    expect(collision.body.code).toBe('UI_STATE_CONFLICT');
    expect(await state()).toEqual(before);
    const retryAcknowledged = await patch([editor('minimap', true)]);
    expect(retryAcknowledged.status).toBe(200);
    expect(retryAcknowledged.body).toEqual(before);
    expect((await patch([editor('minimap', false)], before.revision + 1)).status).toBe(409);
  });

  it('serializes simultaneous browsers without losing unrelated selections', async () => {
    const secondCookie = await fixture.login();
    const replies = await Promise.all([patch([editor('minimap', true)], 0, cookie), patch([editor('lineNumbers', false)], 0, secondCookie)]);
    expect(replies.map(reply => reply.status)).toEqual([200, 200]);
    expect((await state()).editor).toEqual({ minimap: true, lineNumbers: false });
    const competing = await Promise.all([patch([editor('minimap', false)], 2, cookie), patch([editor('minimap', true)], 2, secondCookie)]);
    expect(competing.some(reply => reply.status === 200)).toBe(true);
    expect(competing.every(reply => reply.status === 200 || reply.status === 409)).toBe(true);
  });

  it('keeps tabs for different workspaces independent and protects tabs changed in the same workspace', async () => {
    const second = await fixture.ctx.workspaces.create({ name: 'Other tabs' });
    expect((await patch([tabs('README.md')])).status).toBe(200);
    expect((await patch([tabs('other.ts', second.id)])).status).toBe(200);
    expect((await patch([tabs('stale.ts')])).status).toBe(409);
    expect((await state()).workspaces).toMatchObject({ [workspaceId]: { tabs: { paths: ['README.md'], active: 'README.md' } }, [second.id]: { tabs: { paths: ['other.ts'], active: 'other.ts' } } });
  });

  it.each([
    { apiKey: 'must-never-store-this-secret' }, { baseUrl: 'https://unexpected.invalid' }, { contents: 'unsaved source code' },
    { password: 'must-never-store-this-secret' }, { theme: 'dark' }, { model: 'unrelated-model' },
  ])('rejects unsupported request data without persisting any value: %j', async extra => {
    const response = await fixture.request('/ui-state', { method: 'PATCH', cookie, body: { revision: 0, changes: [editor('minimap', true)], ...extra } });
    expect(response.status).toBe(400);
    expect(response.text).not.toContain('must-never-store-this-secret');
    expect((await state()).revision).toBe(0);
    expect(await fixture.ctx.store.read('ui-state', null)).toBeNull();
  });

  it.each(['../escape', '/etc/passwd', 'C:/Windows/path', 'folder\\escape', 'folder/../escape', 'folder//file', './file', 'folder/\u0000file', '.codex-write-reserved'])('rejects unsafe file locations: %j', async file => {
    expect((await patch([tabs(file)])).status).toBe(400);
    expect((await state()).revision).toBe(0);
  });

  it('rejects unknown workspaces, escaping links, child threads and cross-workspace root selections', async () => {
    const workspace = await fixture.ctx.workspaces.get(workspaceId);
    await fs.symlink(directory, path.join(workspace.path, 'escape-link'));
    expect((await patch([tabs('escape-link/private')])).status).toBe(403);
    expect((await patch([tabs('README.md', 'removed-workspace')])).status).toBe(404);
    const second = await fixture.ctx.workspaces.create({ name: 'Another workspace' });
    await seedLegacySelection(OTHER_ROOT, second.id, { summaryOnly: true });
    await seedLegacySelection(PARENT_ROOT, workspaceId);
    await seedLegacySelection(CHILD_THREAD, workspaceId, { summaryOnly: true, parentThreadId: PARENT_ROOT });
    // An obsolete index cannot authorize a missing record or override actual
    // workspace/parent metadata in the canonical records above.
    await fixture.ctx.store.write('thread-index', [OTHER_ROOT, CHILD_THREAD, MISSING_THREAD].map(id => ({ id, workspaceId })));
    for (const [threadId, status, code] of [[OTHER_ROOT, 400, 'UI_STATE_THREAD_NOT_FOUND'], [CHILD_THREAD, 400, 'UI_STATE_THREAD_NOT_FOUND'],
      [MISSING_THREAD, 404, 'THREAD_NOT_FOUND']] as const) {
      const response = await patch([{ section: 'workspace', workspaceId, key: 'threadId', value: threadId }]);
      expect(response.status).toBe(status);
      expect(response.body.code).toBe(code);
    }
    expect((await state()).revision).toBe(0);
  });

  it('bounds tabs, values, duplicate writes and the whole body without accepting raw editor buffers', async () => {
    const cases: unknown[] = [
      { revision: -1, changes: [editor('minimap', true)] },
      { revision: 0, changes: [editor('minimap', true), editor('minimap', false)] },
      { revision: 0, changes: [{ section: 'editor', key: 'wrap', value: 'yes' }] },
      { revision: 0, changes: [{ section: 'workspace', workspaceId, key: 'tabs', value: { paths: ['a'], active: 'b' } }] },
      { revision: 0, changes: [{ section: 'workspace', workspaceId, key: 'tabs', value: { paths: ['a', 'a'], active: 'a' } }] },
      { revision: 0, changes: [{ section: 'workspace', workspaceId, key: 'tabs', value: { paths: Array.from({ length: 101 }, (_, index) => `file-${index}`), active: '' } }] },
      { revision: 0, changes: [{ section: 'workspace', workspaceId, key: 'tabs', value: { paths: ['a'], active: 'a', content: 'UNSAVED SECRET BUFFER' } }] },
      { revision: 0, changes: [{ section: 'workspace', workspaceId: '__proto__', key: 'threadId', value: null }] },
      { revision: 0, changes: [editor('minimap', true)], fieldRevisions: { 'editor.minimap': 999 } },
    ];
    for (const body of cases) {
      const response = await fixture.request('/ui-state', { method: 'PATCH', cookie, body });
      expect(response.status).toBe(400);
      expect(response.text).not.toContain('UNSAVED SECRET BUFFER');
    }
    expect((await fixture.request('/ui-state', { method: 'PATCH', cookie, body: { revision: 0, changes: [editor('minimap', true)], contents: 'x'.repeat(530_000) } })).status).toBe(413);
    expect((await state()).revision).toBe(0);
  });

  it('does not expose unexpected fields added directly to the ordinary state file', async () => {
    await fixture.ctx.store.write('ui-state', { ...(await readUiState(fixture.ctx)), apiKey: 'private-fixture-value' });
    const response = await fixture.request('/ui-state', { cookie });
    expect(response.status).toBe(503);
    expect(response.text).not.toContain('private-fixture-value');
  });

  it('allows legacy migration once, skips obsolete threads, and never replaces established server state', async () => {
    const changes: UiStateChange[] = [editor('minimap', true), { section: 'workspace', workspaceId, key: 'threadId', value: MISSING_THREAD }];
    const migrated = await fixture.request('/ui-state', { method: 'PATCH', cookie, body: { revision: 0, changes, migration: true } });
    expect(migrated.status).toBe(200);
    expect(migrated.body.editor).toEqual({ minimap: true });
    expect(migrated.body.workspaces).toEqual({});
    const stale = await fixture.request('/ui-state', { method: 'PATCH', cookie, body: { revision: 0, changes: [editor('minimap', false)], migration: true } });
    expect(stale.body).toEqual(migrated.body);
  });
});

describe('optimistic browser preference journal', () => {
  it('hydrates from the canonical server and migrates compatible local selections only into empty state', async () => {
    const storage = memoryCache();
    storage.setItem('codex.view', 'editor'); storage.setItem('codex.sidebar', 'collapsed'); storage.setItem('codex.split', 'focus');
    storage.setItem('codex:editor-view', JSON.stringify({ minimap: true, lineNumbers: false, wrap: true }));
    storage.setItem(`codex:thread:${workspaceId}`, '$new');
    storage.setItem(`codex:tabs:${workspaceId}`, JSON.stringify({ paths: ['README.md', '../bad'], active: 'README.md', content: 'buffer-must-not-migrate' }));
    const first = client(() => cookie, storage);
    await first.hydrate(await state(), [workspaceId], 'laptop');
    expect(first.getSnapshot().value.layouts).toEqual({ laptop: { view: 'editor', sidebar: 'collapsed', split: 'focus' } });
    expect(first.getSnapshot().value.workspaces[workspaceId]).toEqual({ threadId: null, tabs: { paths: ['README.md'], active: 'README.md' } });
    expect(JSON.stringify(await state())).not.toContain('buffer-must-not-migrate');
    const stale = memoryCache(); stale.setItem('codex.view', 'github'); stale.setItem('codex:editor-view', JSON.stringify({ minimap: false }));
    const otherBrowser = client(() => cookie, stale);
    await otherBrowser.hydrate(await state(), [workspaceId], 'mobile');
    expect(otherBrowser.getSnapshot().value).toEqual(first.getSnapshot().value);
  });

  it('makes UI choices immediate, coalesces repeated calls, and stores paths without issuing a request per editor update', async () => {
    const saved = await state();
    let calls = 0;
    const live = new UiStateClient(async body => { calls += 1; return transport(() => cookie)(body); }, memoryCache(), 60_000);
    clients.push(live);
    await live.hydrate(saved, [workspaceId], 'desktop'); live.setSession(true);
    for (let index = 0; index < 50; index++) live.change([tabs('README.md')]);
    expect(live.getSnapshot().value.workspaces[workspaceId].tabs?.active).toBe('README.md');
    expect(live.getSnapshot().pending).toBe(1);
    expect(calls).toBe(0);
    expect((await state()).workspaces).toEqual({});
    await live.flush();
    expect(calls).toBe(1); expect(live.getSnapshot().pending).toBe(0);
    expect((await state()).workspaces[workspaceId].tabs?.active).toBe('README.md');
  });

  it('keeps optimistic changes through a session expiration and saves after the same workspace password renews access', async () => {
    let session = cookie;
    const live = client(() => session);
    await live.hydrate(await state(), [workspaceId], 'desktop'); live.setSession(true);
    live.change([tabs('README.md'), editor('minimap', true)]);
    await fixture.request('/session', { method: 'DELETE', cookie: session });
    await live.flush();
    expect(live.getSnapshot().status).toBe('locked'); expect(live.getSnapshot().pending).toBe(2);
    expect(live.getSnapshot().value.editor.minimap).toBe(true);
    session = await fixture.login();
    await live.hydrate(await state(session), [workspaceId], 'desktop'); live.setSession(true); await live.flush();
    expect(live.getSnapshot().status).toBe('saved');
    expect((await state(session)).workspaces[workspaceId].tabs?.active).toBe('README.md');
  });

  it('recovers an unacknowledged cache journal after offline browser reload and a fresh server', async () => {
    const storage = memoryCache();
    const first = client(() => cookie, storage);
    await first.hydrate(await state(), [workspaceId], 'desktop'); first.setSession(true); first.setOnline(false);
    first.change([tabs('README.md'), { section: 'layout', profile: 'mobile', key: 'view', value: 'terminal' }]);
    expect(first.getSnapshot().status).toBe('offline'); expect(first.getSnapshot().pending).toBe(2);
    first.dispose(); await fixture.close(); fixture = await createFixture(); cookie = await fixture.login();
    const reloaded = client(() => cookie, storage);
    await reloaded.hydrate(await state(), [workspaceId], 'desktop'); reloaded.setSession(true); await reloaded.flush();
    expect(reloaded.getSnapshot().status).toBe('saved');
    expect((await state()).layouts.mobile?.view).toBe('terminal');
    expect((await state()).workspaces[workspaceId].tabs?.active).toBe('README.md');
  });

  it('keeps a visible retry state for network failures and recovers without losing choices', async () => {
    let available = false;
    const live = new UiStateClient(body => available ? transport(() => cookie)(body) : Promise.reject(new TypeError('Offline')), memoryCache(), 60_000);
    clients.push(live);
    await live.hydrate(await state(), [workspaceId], 'desktop'); live.setSession(true); live.change([editor('minimap', true)]);
    await live.flush();
    expect(live.getSnapshot()).toMatchObject({ status: 'error', pending: 1, message: expect.stringContaining('have not synced') });
    available = true; await live.flush();
    expect(live.getSnapshot()).toMatchObject({ status: 'saved', pending: 0 });
    expect((await state()).editor.minimap).toBe(true);
  });

  it('merges unrelated changes from two browsers and reports a competing saved tab selection', async () => {
    const initial = await state();
    const otherCookie = await fixture.login();
    const left = client(), right = client(() => otherCookie);
    for (const live of [left, right]) { await live.hydrate(initial, [workspaceId], 'desktop'); live.setSession(true); }
    left.change([editor('minimap', true), tabs('README.md')]);
    right.change([editor('lineNumbers', false)]);
    await left.flush(); await right.flush();
    expect((await state()).editor).toEqual({ minimap: true, lineNumbers: false });
    const stale = client(); await stale.hydrate(initial, [workspaceId], 'desktop'); stale.setSession(true);
    stale.change([tabs('AGENTS.md'), { section: 'layout', profile: 'mobile', key: 'view', value: 'git' }]);
    await stale.flush();
    expect(stale.getSnapshot().status).toBe('conflict');
    expect(stale.getSnapshot().pending).toBe(1);
    expect(stale.getSnapshot().value.workspaces[workspaceId].tabs?.active).toBe('README.md');
    await stale.flush();
    expect((await state()).layouts.mobile?.view).toBe('git');
    expect((await state()).workspaces[workspaceId].tabs?.active).toBe('README.md');
  });

  it('does not replay an old queued choice over a newer selection after reload', async () => {
    const storage = memoryCache();
    const first = client(() => cookie, storage);
    await first.hydrate(await state(), [workspaceId], 'desktop'); first.setOnline(false); first.change([tabs('AGENTS.md')]); first.dispose();
    await patch([tabs('README.md')]);
    const reloaded = client(() => cookie, storage);
    await reloaded.hydrate(await state(), [workspaceId], 'desktop'); reloaded.setSession(true); await reloaded.flush();
    expect(reloaded.getSnapshot().pending).toBe(0);
    expect(reloaded.getSnapshot().value.workspaces[workspaceId].tabs?.active).toBe('README.md');
    expect((await state()).workspaces[workspaceId].tabs?.active).toBe('README.md');
  });

  it('preserves a newer local interaction while an earlier request is completing', async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let firstRequest = true;
    const live = new UiStateClient(async body => {
      const response = await transport(() => cookie)(body);
      if (body && firstRequest) { firstRequest = false; entered(); await gate; }
      return response;
    }, memoryCache(), 60_000);
    clients.push(live);
    await live.hydrate(await state(), [workspaceId], 'desktop'); live.setSession(true);
    live.change([{ section: 'layout', profile: 'desktop', key: 'view', value: 'editor' }]);
    const saving = live.flush(); await started;
    live.change([{ section: 'layout', profile: 'desktop', key: 'view', value: 'github' }]); release(); await saving;
    expect(live.getSnapshot().value.layouts.desktop?.view).toBe('github'); expect(live.getSnapshot().pending).toBe(1);
    await live.flush();
    expect((await state()).layouts.desktop?.view).toBe('github');
  });

  it('does not lose a newer local choice when bootstrap observes its earlier save before acknowledgement', async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let firstRequest = true;
    const live = new UiStateClient(async body => {
      const response = await transport(() => cookie)(body);
      if (body && firstRequest) { firstRequest = false; entered(); await gate; }
      return response;
    }, memoryCache(), 60_000);
    clients.push(live);
    await live.hydrate(await state(), [workspaceId], 'desktop'); live.setSession(true);
    live.change([{ section: 'layout', profile: 'desktop', key: 'view', value: 'editor' }]);
    const saving = live.flush(); await started;
    live.change([{ section: 'layout', profile: 'desktop', key: 'view', value: 'github' }]);
    await live.hydrate(await state(), [workspaceId], 'desktop');
    expect(live.getSnapshot().pending).toBe(1);
    expect(live.getSnapshot().value.layouts.desktop?.view).toBe('github');
    release(); await saving; await live.flush();
    expect((await state()).layouts.desktop?.view).toBe('github');
  });

  it('never regresses canonical state when a delayed conflict refresh returns after newer bootstrap data', async () => {
    const initial = await state();
    await patch([editor('minimap', true)]);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const live = new UiStateClient(async body => {
      const response = await transport(() => cookie)(body);
      if (!body) { entered(); await gate; }
      return response;
    }, memoryCache(), 60_000);
    clients.push(live);
    await live.hydrate(initial, [workspaceId], 'desktop'); live.setSession(true); live.change([editor('minimap', false)]);
    const saving = live.flush(); await started;
    await patch([editor('lineNumbers', false)], 1);
    await live.hydrate(await state(), [workspaceId], 'desktop');
    release(); await saving;
    expect(live.getSnapshot().value.revision).toBe(2);
    expect(live.getSnapshot().value.editor).toEqual({ minimap: true, lineNumbers: false });
  });

  it('does not mistake a later external return to the same value for its own in-flight acknowledgement', async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let firstRequest = true;
    const live = new UiStateClient(async body => {
      const response = await transport(() => cookie)(body);
      if (body && firstRequest) { firstRequest = false; entered(); await gate; }
      return response;
    }, memoryCache(), 60_000);
    clients.push(live);
    await live.hydrate(await state(), [workspaceId], 'desktop'); live.setSession(true);
    live.change([{ section: 'layout', profile: 'desktop', key: 'view', value: 'editor' }]);
    const saving = live.flush(); await started;
    live.change([{ section: 'layout', profile: 'desktop', key: 'view', value: 'github' }]);
    await patch([{ section: 'layout', profile: 'desktop', key: 'view', value: 'git' }], 1);
    await patch([{ section: 'layout', profile: 'desktop', key: 'view', value: 'editor' }], 2);
    await live.hydrate(await state(), [workspaceId], 'desktop');
    release(); await saving; await live.flush();
    expect(live.getSnapshot()).toMatchObject({ status: 'conflict', pending: 0 });
    expect(live.getSnapshot().value.layouts.desktop?.view).toBe('editor');
    expect((await state()).revision).toBe(3);
  });

  it('keeps a queued revert that matches an older bootstrap until the in-flight write finishes', async () => {
    await patch([{ section: 'layout', profile: 'desktop', key: 'view', value: 'agent' }]);
    const initial = await state();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let firstRequest = true;
    const live = new UiStateClient(async body => {
      const response = await transport(() => cookie)(body);
      if (body && firstRequest) { firstRequest = false; entered(); await gate; }
      return response;
    }, memoryCache(), 60_000);
    clients.push(live);
    await live.hydrate(initial, [workspaceId], 'desktop'); live.setSession(true);
    live.change([{ section: 'layout', profile: 'desktop', key: 'view', value: 'editor' }]);
    const saving = live.flush(); await started;
    live.change([{ section: 'layout', profile: 'desktop', key: 'view', value: 'agent' }]);
    await live.hydrate(initial, [workspaceId], 'desktop');
    expect(live.getSnapshot().pending).toBe(1);
    release(); await saving; await live.flush();
    expect((await state()).layouts.desktop?.view).toBe('agent');
    expect(live.getSnapshot()).toMatchObject({ status: 'saved', pending: 0 });
  });

  it('keeps blocked queue status accurate through retry, dismissal and hydration', async () => {
    const live = client();
    await live.hydrate(await state(), [workspaceId], 'desktop'); live.setSession(true); live.setOnline(false); live.change([editor('minimap', true)]);
    live.retry(); expect(live.getSnapshot().status).toBe('offline');
    live.dismissNotice(); expect(live.getSnapshot().status).toBe('offline');
    await live.hydrate(await state(), [workspaceId], 'desktop'); expect(live.getSnapshot().status).toBe('offline');
    live.setSession(false); live.retry(); expect(live.getSnapshot().status).toBe('locked');
    expect(live.getSnapshot().pending).toBe(1);
  });
});
