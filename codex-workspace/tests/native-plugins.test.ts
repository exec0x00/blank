import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import express from 'express';
import { z } from 'zod';
import { createNativePluginsRouter } from '../server/codex-cli/features/plugins';
import { loadConfig } from '../server/config';
import { JsonStore, SecretStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import { HttpError } from '../server/errors';
import type { AppContext } from '../server/context';
import type { CodexBridge } from '../server/codex-cli/bridge';
import type { NativeNotification, NativeServerRequest, RpcId } from '../server/codex-cli/rpc';
import type { CodexRuntimeStatus } from '../shared/codex-cli';
import type { ThreadSummary, Workspace } from '../shared/types';
import type { PluginSummary } from '../server/codex-cli/protocol/generated/v2/PluginSummary';
import type { PluginDetail } from '../server/codex-cli/protocol/generated/v2/PluginDetail';
import { NATIVE_PLUGIN_METHODS, type NativePluginCatalogPage, type NativePluginDetail, type NativePluginsCapabilities, type NativePluginSharePage, type NativeAppDetails, type NativeInstalledAppPage } from '../shared/native-plugins';

const THREAD = '01990000-0000-7000-8000-000000000001';
const PEER_THREAD = '01990000-0000-7000-8000-000000000002';
const SECRET = 'owned-native-plugin-secret-value';
class PluginBridge implements CodexBridge {
  current = 'native-plugin-test-generation';
  ready = true;
  unsupported = new Set<string>();
  calls: Array<{ method: string; params: unknown }> = [];
  handlers = new Map<string, (params: unknown) => unknown | Promise<unknown>>();
  connections = new Set<(state: 'ready' | 'closed', generation: string) => void>();
  supports(method: string) { return NATIVE_PLUGIN_METHODS.includes(method as typeof NATIVE_PLUGIN_METHODS[number]) && !this.unsupported.has(method); }
  generation() { return this.current; }
  status() { return { state: this.ready ? 'ready' : 'error' } as CodexRuntimeStatus; }
  async request<T>(method: string, params?: unknown): Promise<T> {
    this.calls.push({ method, params: structuredClone(params) });
    const handler = this.handlers.get(method);
    if (!handler) throw new Error(`Unexpected fixture native call: ${method}`);
    return await handler(params) as T;
  }
  respond(_id: RpcId, _result: unknown, _generation: string) { throw new Error('Plugin routes must not synthesize callback responses.'); }
  rejectRequest(_id: RpcId, _message: string, _generation: string) { throw new Error('Plugin routes must not reject unrelated callbacks.'); }
  onNotification(_listener: (message: NativeNotification, generation: string) => void) { return () => undefined; }
  onRequest(_listener: (message: NativeServerRequest, generation: string) => void) { return () => undefined; }
  onConnection(listener: (state: 'ready' | 'closed', generation: string) => void) { this.connections.add(listener); return () => { this.connections.delete(listener); }; }
}

let root: string, ctx: AppContext, workspace: Workspace, peer: Workspace, bridge: PluginBridge, server: Server, origin: string;
let summary: PluginSummary, detail: PluginDetail, marketplacePath: string, localPluginPath: string;
const cleanup: Array<() => void | Promise<void>> = [];
let authorize: ReturnType<typeof vi.fn<(workspaceId: string, threadId: string) => Promise<ThreadSummary>>>;
const plugin = (overrides: Partial<PluginSummary> = {}): PluginSummary => ({
  id: 'sample@owned-catalog', remotePluginId: 'remote-sample', version: '2.0', localVersion: null, name: 'sample', shareContext: null,
  source: { type: 'remote' }, installed: false, installedAt: null, enabled: true, installPolicy: 'AVAILABLE', installPolicySource: null,
  mustShowInstallationInterstitial: false, authPolicy: 'ON_USE', availability: 'AVAILABLE', disabledReason: null, eligiblePlanTypes: null,
  interface: { displayName: 'Sample plugin', shortDescription: 'Owned plugin fixture', longDescription: null, developerName: 'Fixture author', category: null,
    capabilities: ['skills'], websiteUrl: null, privacyPolicyUrl: null, termsOfServiceUrl: null, defaultPrompt: null, brandColor: null,
    composerIcon: null, composerIconUrl: null, logo: null, logoDark: null, logoUrl: null, logoUrlDark: null, screenshots: [], screenshotUrls: [] }, keywords: ['fixture'], ...overrides,
});
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-native-plugins-'));
  const config = loadConfig({ DATA_DIR: path.join(root, 'data'), RUNTIME_DIR: path.join(root, 'runtime'), NODE_ENV: 'test', WORKSPACE_PASSWORD: SECRET,
    SESSION_SECRET: 'owned-native-plugin-session-secret-32', ENCRYPTION_KEY: 'owned-native-plugin-encryption-key-32' });
  const store = new JsonStore(config.stateDir), workspaces = new WorkspaceService(config, store);
  await workspaces.initialize(); workspace = await workspaces.create({ name: 'Plugin workspace' }); peer = await workspaces.create({ name: 'Other workspace' });
  ctx = { config, store, workspaces, secrets: new SecretStore(store, config.encryptionKey), events: new EventEmitter(),
    settings: vi.fn(), saveSettings: vi.fn(), providerKey: vi.fn(async () => { throw new Error('Plugins never read provider credentials.'); }) } as unknown as AppContext;
  localPluginPath = path.join(workspace.path, 'plugins', 'sample');
  marketplacePath = path.join(workspace.path, 'catalog', 'marketplace.json');
  await fs.mkdir(path.join(localPluginPath, '.codex-plugin'), { recursive: true });
  await fs.writeFile(path.join(localPluginPath, '.codex-plugin', 'plugin.json'), '{"name":"sample"}');
  await fs.mkdir(path.dirname(marketplacePath), { recursive: true }); await fs.writeFile(marketplacePath, '{}');
  summary = plugin();
  detail = { marketplaceName: 'owned-catalog', marketplacePath: null, summary, shareUrl: null, description: 'A plugin with a real native skill.',
    skills: [{ name: 'sample-skill', description: 'Inspect this skill.', shortDescription: null, interface: null, path: null, enabled: true }],
    onboardingSkill: null, hooks: [], apps: [], appTemplates: [], mcpServers: [], scheduledTasks: [] };
  bridge = new PluginBridge();
  const catalog = () => ({ marketplaces: [{ name: 'owned-catalog', path: null, interface: { displayName: 'Owned catalog' }, plugins: [summary] }], marketplaceLoadErrors: [], featuredPluginIds: [summary.id] });
  bridge.handlers.set('plugin/list', catalog); bridge.handlers.set('plugin/installed', catalog);
  bridge.handlers.set('plugin/search', () => ({ data: [{ plugin: summary, marketplaceName: 'owned-catalog', marketplacePath: null }], nextCursor: null }));
  bridge.handlers.set('plugin/read', () => ({ plugin: detail }));
  bridge.handlers.set('plugin/skill/read', () => ({ contents: '# Sample skill\nNative instructions.' }));
  bridge.handlers.set('plugin/install', () => { summary.installed = true; return { authPolicy: 'ON_USE', appsNeedingAuth: [{ id: 'app-one', name: 'App one', description: null, installUrl: 'https://chatgpt.com/auth/login', category: null }] }; });
  bridge.handlers.set('plugin/uninstall', () => { summary.installed = false; return {}; });
  bridge.handlers.set('plugin/reconcile', () => ({ changedPlugins: [{ id: summary.id, hasMcps: false, hasApps: false, hasHooks: false, hasSkills: true }], failedRemotePluginIds: [], failedMaterializationRemotePluginIds: [] }));
  bridge.handlers.set('marketplace/add', () => ({ marketplaceName: 'owned-catalog', installedRoot: path.join(config.dataDir, 'codex-workspace', 'native-codex', 'plugins', 'marketplaces', 'owned-catalog'), alreadyAdded: false }));
  bridge.handlers.set('marketplace/remove', () => ({ marketplaceName: 'owned-catalog', installedRoot: null }));
  bridge.handlers.set('marketplace/upgrade', () => ({ selectedMarketplaces: ['owned-catalog'], upgradedRoots: ['/private/native/cache'], errors: [] }));
  bridge.handlers.set('plugin/share/list', () => ({ data: [{ plugin: summary, localPluginPath }] }));
  bridge.handlers.set('plugin/share/save', () => ({ remotePluginId: 'remote-sample', shareUrl: 'https://example.com/plugin/shared', canPublishToWorkspace: false }));
  bridge.handlers.set('plugin/share/updateTargets', () => ({ principals: [{ principalType: 'user', principalId: 'user-one', role: 'reader', name: 'Reader' }], discoverability: 'PRIVATE' }));
  bridge.handlers.set('plugin/share/checkout', () => ({ remotePluginId: 'remote-sample', pluginId: summary.id, pluginName: 'sample', pluginPath: localPluginPath, marketplaceName: 'owned-catalog', marketplacePath, remoteVersion: '2.0' }));
  bridge.handlers.set('plugin/share/delete', () => ({}));
  bridge.handlers.set('app/list', () => ({ data: [{ id: 'app-one', name: 'App one', description: 'Available metadata.', isAccessible: true, isEnabled: true, pluginDisplayNames: ['Sample plugin'], appMetadata: null }], nextCursor: null }));
  bridge.handlers.set('app/read', () => ({ apps: [{ id: 'app-one', name: 'App one', description: 'Description.', pluginDisplayNames: ['Sample plugin'], installUrl: 'https://chatgpt.com/auth/login', toolSummaries: [
    { name: 'lookup', title: 'Look up', description: 'Find entries.', isEnabled: true, disabledReason: null, isReadOnly: true },
    { name: 'write', title: 'Write', description: 'Update entries.', isEnabled: false, disabledReason: 'Disabled by app policy', isReadOnly: false },
  ] }], missingAppIds: [] }));
  bridge.handlers.set('app/installed', () => ({ apps: [{ id: 'app-one', runtimeName: 'Runtime app', enabled: true, callable: false }] }));
  authorize = vi.fn(async (workspaceId: string, threadId: string) => {
    if (workspaceId !== workspace.id || threadId !== THREAD) throw new HttpError(403, 'Thread is outside this workspace.', 'THREAD_UNAUTHORIZED');
    return { id: threadId, workspaceId } as ThreadSummary;
  });
  const app = express(); app.use(express.json({ limit: '64kb' }));
  app.use('/api', createNativePluginsRouter({ ctx, bridge, authorizeThread: authorize, registerCleanup: dispose => cleanup.push(dispose) }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error instanceof HttpError ? error.status : error instanceof z.ZodError ? 400 : 500).json({ error: error instanceof z.ZodError ? 'Invalid request' : error instanceof HttpError ? error.message : 'Unexpected failure', code: error instanceof HttpError ? error.code : 'INVALID_REQUEST' });
  });
  server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
  server?.closeAllConnections(); if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (ctx) { expect(ctx.providerKey).not.toHaveBeenCalled(); expect(ctx.saveSettings).not.toHaveBeenCalled(); await ctx.store.flush(); }
  if (root) await fs.rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});
function base(id = workspace.id) { return `/workspaces/${id}/codex/plugins`; }
async function call<T = Record<string, unknown>>(url: string, body?: unknown) {
  const response = await fetch(origin + url, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, value: response.headers.get('content-type')?.includes('application/json') ? await response.json() as T : {} as T };
}
async function selection() { const result = await call<NativePluginCatalogPage>(base()); expect(result.status).toBe(200); return result.value; }

describe('native plugin and marketplace routes', () => {
  it('covers every native method with exact, authorized parameter mapping and public projections', async () => {
    let catalog = await selection(), ref = catalog.data[0].ref;
    await call(`${base()}/installed`); await call(`${base()}/search?searchTerm=sample&scope=workspace&limit=10`);
    const read = await call<NativePluginDetail>(`${base()}/read`, { ref }); expect(read.value.plugin.name).toBe('sample');
    expect(await call(`${base()}/skill/read`, { ref, skillName: 'sample-skill' })).toMatchObject({ status: 200, value: { contents: '# Sample skill\nNative instructions.', truncated: false } });
    const install = await call(`${base()}/install`, { ref }); expect(install).toMatchObject({ status: 200, value: { appsNeedingAuth: [{ id: 'app-one', name: 'App one' }] } });
    expect(JSON.stringify(install)).not.toContain('installUrl');
    expect(await call(`${base()}/uninstall`, { ref })).toMatchObject({ status: 200, value: { removed: true } });
    expect((await call(`${base()}/reconcile`, {})).status).toBe(200);
    expect(await call(`${base()}/marketplaces/add`, { source: 'https://github.com/example/marketplace', refName: 'main', sparsePaths: ['plugins', 'catalog'] })).toMatchObject({ status: 200, value: { marketplaceName: 'owned-catalog' } });
    catalog = await selection();
    expect(await call(`${base()}/marketplaces/upgrade`, { ref: catalog.marketplaces[0].ref })).toMatchObject({ status: 200, value: { upgradedCount: 1 } });
    expect(await call(`${base()}/marketplaces/remove`, { ref: catalog.marketplaces[0].ref })).toMatchObject({ status: 200 });
    const shares = await call<NativePluginSharePage>(`${base()}/shares`); expect(shares.status).toBe(200);
    expect(await call(`${base()}/shares/save`, { localRef: shares.value.data[0].localRef, discoverability: 'PRIVATE', shareTargets: [] })).toMatchObject({ status: 200, value: { remotePluginId: 'remote-sample' } });
    expect(await call(`${base()}/shares/update-targets`, { remotePluginId: 'remote-sample', discoverability: 'PRIVATE', shareTargets: [{ principalType: 'user', principalId: 'user-one', role: 'reader' }] })).toMatchObject({ status: 200 });
    expect(await call(`${base()}/shares/checkout`, { remotePluginId: 'remote-sample' })).toMatchObject({ status: 200, value: { workspacePath: 'plugins/sample' } });
    expect(await call(`${base()}/shares/delete`, { remotePluginId: 'remote-sample' })).toMatchObject({ status: 200, value: { deleted: true } });
    const apps = base().replace(/plugins$/, 'apps');
    expect((await call(`${apps}?threadId=${THREAD}`)).status).toBe(200);
    expect((await call(`${apps}/read`, { appIds: ['app-one'], threadId: THREAD, includeTools: true })).status).toBe(200);
    expect((await call(`${apps}/installed?threadId=${THREAD}&forceRefresh=true`)).status).toBe(200);
    expect(new Set(bridge.calls.map(item => item.method))).toEqual(new Set(NATIVE_PLUGIN_METHODS));
    expect(bridge.calls.find(item => item.method === 'plugin/list')?.params).toEqual({ cwds: [workspace.path], forceRefetch: false });
    expect(bridge.calls.find(item => item.method === 'plugin/search')?.params).toMatchObject({ searchTerm: 'sample', scope: 'workspace', cwds: [workspace.path], limit: 10 });
    expect(bridge.calls.find(item => item.method === 'plugin/install')?.params).toMatchObject({ pluginName: 'sample', remoteMarketplaceName: 'owned-catalog', installAttemptId: expect.stringMatching(/^[a-f0-9-]{36}$/) });
    expect(bridge.calls.find(item => item.method === 'plugin/share/save')?.params).toEqual({ pluginPath: localPluginPath, remotePluginId: 'remote-sample', discoverability: 'PRIVATE', shareTargets: [] });
    expect(authorize).toHaveBeenCalledTimes(6);
  });

  it('distinguishes advertised, successful and rejected native availability without faking fallbacks', async () => {
    let status = await call<NativePluginsCapabilities>('/codex/plugins/capabilities'); expect(status.value.methods['plugin/list'].status).toBe('advertised');
    await selection(); status = await call('/codex/plugins/capabilities'); expect(status.value.methods['plugin/list'].status).toBe('working');
    bridge.unsupported.add('plugin/search');
    expect(await call(`${base()}/search?searchTerm=sample`)).toMatchObject({ status: 501, value: { code: 'CODEX_PLUGIN_UNAVAILABLE' } });
    expect(bridge.calls.filter(item => item.method === 'plugin/search')).toHaveLength(0);
    bridge.handlers.set('plugin/list', () => { throw new HttpError(400, `Plugins require an existing native connection ${SECRET}`, 'CODEX_RPC_REJECTED'); });
    const failure = await call(base()); expect(failure.status).toBe(400); expect(JSON.stringify(failure)).not.toContain(SECRET);
    status = await call('/codex/plugins/capabilities'); expect(status.value.methods['plugin/list'].status).toBe('rejected');
    expect(status.value.methods['plugin/search'].status).toBe('unavailable'); expect(JSON.stringify(status)).not.toContain(SECRET);
  });

  it('rejects arbitrary methods, environment/provider fields, raw native paths and oversized input before native dispatch', async () => {
    const catalog = await selection(); bridge.calls.length = 0;
    for (const [url, body] of [
      [`${base()}/read`, { ref: catalog.data[0].ref, marketplacePath: '/etc' }],
      [`${base()}/install`, { ref: catalog.data[0].ref, environment: { TOKEN: SECRET } }],
      [`${base()}/marketplaces/add`, { source: 'https://user:password@example.com/repo' }],
      [`${base()}/marketplaces/add`, { source: 'https://example.com/repo?token=private' }],
      [`${base()}/marketplaces/add`, { source: 'https://alvin3y10-api.hf.space/api/models' }],
      [`${base()}/marketplaces/add`, { source: 'https://example.com/repo', refName: '--upload-pack=evil' }],
      [`${base()}/marketplaces/add`, { source: '../other-workspace' }],
      [`${base()}/shares/save`, { pluginPath: '/etc', discoverability: 'PRIVATE', shareTargets: [] }],
      [`${base()}/shares/update-targets`, { remotePluginId: 'r', discoverability: 'PRIVATE', shareTargets: [{ principalType: 'user', principalId: 'x', role: 'owner' }] }],
    ] as const) expect((await call(url, body)).status).toBe(400);
    expect((await call(`${base()}?cwds=/etc`)).status).toBe(400);
    expect((await call(`${base()}/install?provider=other`, { ref: catalog.data[0].ref })).status).toBe(400);
    expect((await call(`${base()}/search?searchTerm=x&limit=5000`)).status).toBe(400);
    expect((await call('/codex/plugins/request', { method: 'account/login/start', params: {} })).status).toBe(404);
    expect(bridge.calls).toHaveLength(0);
  });

  it('binds catalog references and pages to their workspace and native connection, with bounded snapshots', async () => {
    const many = Array.from({ length: 55 }, (_, index) => plugin({ id: `plugin-${index}@owned-catalog`, name: `plugin-${index}` }));
    bridge.handlers.set('plugin/list', () => ({ marketplaces: [{ name: 'owned-catalog', path: null, interface: null, plugins: many }], marketplaceLoadErrors: [], featuredPluginIds: [] }));
    const first = await call<NativePluginCatalogPage>(`${base()}?limit=20`); expect(first.value.data).toHaveLength(20); expect(first.value.total).toBe(55);
    const second = await call<NativePluginCatalogPage>(`${base()}?limit=20&cursor=${encodeURIComponent(first.value.nextCursor!)}`);
    expect(second.value.data[0].name).toBe('plugin-20'); expect(bridge.calls.filter(item => item.method === 'plugin/list')).toHaveLength(1);
    expect(await call(`${base(peer.id)}/read`, { ref: first.value.data[0].ref })).toMatchObject({ status: 409 });
    expect((await call(`${base(peer.id)}?cursor=${encodeURIComponent(first.value.nextCursor!)}`)).status).toBe(409);
    bridge.current = 'reconnected';
    expect(await call(`${base()}/read`, { ref: first.value.data[0].ref })).toMatchObject({ status: 409 });
    expect((await call(`${base()}?cursor=${encodeURIComponent(first.value.nextCursor!)}`)).status).toBe(409);
    expect(bridge.calls.some(item => item.method === 'plugin/read')).toBe(false);
  });

  it('checks authoritative marketplace and local source paths before reading or installing plugins', async () => {
    const other = path.join(peer.path, 'marketplace.json'); await fs.writeFile(other, '{}');
    bridge.handlers.set('plugin/list', () => ({ marketplaces: [{ name: 'other', path: other, interface: null, plugins: [summary] }], marketplaceLoadErrors: [], featuredPluginIds: [] }));
    let catalog = await selection();
    expect(await call(`${base()}/read`, { ref: catalog.data[0].ref })).toMatchObject({ status: 403, value: { code: 'CODEX_PLUGIN_PATH_UNAUTHORIZED' } });
    expect(bridge.calls.some(item => item.method === 'plugin/read')).toBe(false);
    const link = path.join(workspace.path, 'external-catalog'); await fs.symlink(peer.path, link);
    bridge.handlers.set('plugin/list', () => ({ marketplaces: [{ name: 'linked', path: path.join(link, 'marketplace.json'), interface: null, plugins: [summary] }], marketplaceLoadErrors: [], featuredPluginIds: [] }));
    catalog = await selection(); expect((await call(`${base()}/read`, { ref: catalog.data[0].ref })).status).toBe(403);
    expect((await call(`${base()}/marketplaces/add`, { source: 'external-catalog' })).status).toBe(403);
    bridge.handlers.set('plugin/list', () => ({ marketplaces: [{ name: 'owned-catalog', path: marketplacePath, interface: null, plugins: [summary] }], marketplaceLoadErrors: [], featuredPluginIds: [] }));
    detail.marketplacePath = marketplacePath; summary.source = { type: 'local', path: peer.path };
    catalog = await selection(); expect((await call(`${base()}/install`, { ref: catalog.data[0].ref })).status).toBe(403);
    expect(bridge.calls.some(item => item.method === 'plugin/install')).toBe(false);
    summary.source = { type: 'git', url: 'https://alvin3y10-api.hf.space/api/models', path: null, refName: null, sha: null };
    expect(await call(`${base()}/install`, { ref: catalog.data[0].ref })).toMatchObject({ status: 403, value: { code: 'CODEX_PLUGIN_MODEL_SERVICE_LOCKED' } });
    expect(bridge.calls.some(item => item.method === 'plugin/install')).toBe(false);
  });

  it('requires native installation review and availability policy, and validates requested skill membership', async () => {
    summary.mustShowInstallationInterstitial = true;
    const catalog = await selection(), ref = catalog.data[0].ref;
    expect(await call(`${base()}/install`, { ref })).toMatchObject({ status: 409, value: { code: 'CODEX_PLUGIN_INSTALL_REVIEW_REQUIRED' } });
    summary.availability = 'DISABLED_BY_ADMIN';
    expect((await call(`${base()}/install`, { ref, reviewed: true })).status).toBe(403);
    summary.availability = 'AVAILABLE';
    expect((await call(`${base()}/install`, { ref, reviewed: true })).status).toBe(200);
    expect((await call(`${base()}/skill/read`, { ref, skillName: 'not-a-plugin-skill' })).status).toBe(404);
    expect(bridge.calls.filter(item => item.method === 'plugin/install')).toHaveLength(1);
    expect(bridge.calls.filter(item => item.method === 'plugin/skill/read')).toHaveLength(0);
  });

  it('never shares symlinks, credential files or folders outside the authorized workspace', async () => {
    const input = { pluginPath: 'plugins/sample', discoverability: 'PRIVATE', shareTargets: [] };
    await fs.symlink(peer.path, path.join(localPluginPath, 'escape'));
    expect(await call(`${base()}/shares/save`, input)).toMatchObject({ status: 403, value: { code: 'CODEX_PLUGIN_SHARE_PATH_UNSAFE' } });
    await fs.unlink(path.join(localPluginPath, 'escape')); await fs.writeFile(path.join(localPluginPath, '.env'), 'TOKEN=fixture-only');
    expect(await call(`${base()}/shares/save`, input)).toMatchObject({ status: 403, value: { code: 'CODEX_PLUGIN_SHARE_CREDENTIAL_FILE' } });
    await fs.unlink(path.join(localPluginPath, '.env'));
    expect((await call(`${base()}/shares/save`, { ...input, pluginPath: '../outside' })).status).toBe(400);
    expect(bridge.calls.some(item => item.method === 'plugin/share/save')).toBe(false);
    expect((await call(`${base()}/shares/save`, input)).status).toBe(200);
    expect(bridge.calls.find(item => item.method === 'plugin/share/save')?.params).toMatchObject({ pluginPath: localPluginPath });
  });

  it('supports the selected workspace root as an explicitly chosen local marketplace or plugin', async () => {
    expect((await call(`${base()}/marketplaces/add`, { source: '.' })).status).toBe(200);
    expect(bridge.calls.find(item => item.method === 'marketplace/add')?.params).toEqual({ source: workspace.path });
    const input = { pluginPath: '.', discoverability: 'PRIVATE', shareTargets: [] };
    await fs.writeFile(path.join(workspace.path, 'unrelated-source.ts'), 'export const unrelated = true;');
    // A plugin in a child folder does not turn an unrelated project root into
    // a publishable plugin. That exact root must carry its own manifest.
    expect(await call(`${base()}/shares/save`, input)).toMatchObject({ status: 400, value: { code: 'CODEX_PLUGIN_FOLDER_INVALID' } });
    expect(bridge.calls.some(item => item.method === 'plugin/share/save')).toBe(false);
    await fs.mkdir(path.join(workspace.path, '.codex-plugin')); await fs.writeFile(path.join(workspace.path, '.codex-plugin', 'plugin.json'), '{"name":"workspace-plugin"}');
    await fs.symlink(peer.path, path.join(workspace.path, 'outside-project'));
    expect(await call(`${base()}/shares/save`, input)).toMatchObject({ status: 403, value: { code: 'CODEX_PLUGIN_SHARE_PATH_UNSAFE' } });
    await fs.unlink(path.join(workspace.path, 'outside-project'));
    // Native catalog provenance also cannot authorize another workspace.
    bridge.handlers.set('plugin/share/list', () => ({ data: [{ plugin: summary, localPluginPath: peer.path }] }));
    const shares = await call<NativePluginSharePage>(`${base()}/shares`);
    expect(await call(`${base()}/shares/save`, { localRef: shares.value.data[0].localRef, discoverability: 'PRIVATE', shareTargets: [] }))
      .toMatchObject({ status: 403, value: { code: 'CODEX_PLUGIN_PATH_UNAUTHORIZED' } });
    expect(bridge.calls.some(item => item.method === 'plugin/share/save')).toBe(false);
    expect((await call(`${base()}/shares/save`, input)).status).toBe(200);
    expect(bridge.calls.find(item => item.method === 'plugin/share/save')?.params).toMatchObject({ pluginPath: workspace.path });
  });

  it('projects only public bounded fields, redacts secrets and rejects oversized native results', async () => {
    detail.description = `Public ${SECRET} sk-123456789012345678901234567890`;
    Object.assign(detail, { encryptedContent: 'hidden-private-content', env: { TOKEN: SECRET }, auth: { accessToken: SECRET } });
    const catalog = await selection();
    const view = await call<NativePluginDetail>(`${base()}/read`, { ref: catalog.data[0].ref });
    expect(view.status).toBe(200); expect(view.value.description).toContain('redacted');
    for (const forbidden of [SECRET, 'sk-123456789012345678901234567890', 'encryptedContent', 'accessToken', 'hidden-private-content']) expect(JSON.stringify(view)).not.toContain(forbidden);
    bridge.handlers.set('plugin/list', () => ({ hugePrivateField: 'a'.repeat(4 * 1024 * 1024 + 1) }));
    expect(await call(base())).toMatchObject({ status: 413, value: { code: 'CODEX_PLUGIN_RESULT_LIMIT' } });
  });

  it('treats malformed native metadata and connection changes as failures, without empty-success projections', async () => {
    bridge.handlers.set('plugin/list', () => ({ marketplaces: null, marketplaceLoadErrors: [] }));
    expect(await call(base())).toMatchObject({ status: 502, value: { code: 'CODEX_PLUGIN_PROTOCOL' } });
    bridge.handlers.set('app/installed', () => ({ apps: [{ id: 'app-one', runtimeName: 'App one', enabled: true, callable: 'yes' }] }));
    expect(await call(base().replace(/plugins$/, 'apps/installed'))).toMatchObject({ status: 502, value: { code: 'CODEX_PLUGIN_PROTOCOL' } });
    bridge.handlers.set('plugin/list', () => { bridge.current = 'changed-during-native-read'; return { marketplaces: [], marketplaceLoadErrors: [], featuredPluginIds: [] }; });
    expect(await call(base())).toMatchObject({ status: 409, value: { code: 'CODEX_CONNECTION_CHANGED' } });
  });

  it('redacts URL credentials and authorization text from native rejection messages', async () => {
    bridge.handlers.set('plugin/list', () => { throw new Error('Failed https://user:opaque-password@example.com/repo?token=opaque-token with Bearer opaque-bearer-value'); });
    const result = await call(base());
    expect(result.status).toBe(502);
    for (const secret of ['opaque-password', 'opaque-token', 'opaque-bearer-value']) expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).toContain('redacted');
  });
});

describe('native app metadata and runtime authority', () => {
  it('rechecks thread authority after native metadata returns', async () => {
    let moved = false;
    authorize.mockImplementation(async () => { if (moved) throw new HttpError(403, 'Thread moved out of this workspace.', 'THREAD_UNAUTHORIZED'); return { id: THREAD, workspaceId: workspace.id } as ThreadSummary; });
    const original = bridge.handlers.get('app/read')!;
    bridge.handlers.set('app/read', async params => { const result = await original(params); moved = true; return result; });
    expect(await call(base().replace(/plugins$/, 'apps/read'), { appIds: ['app-one'], threadId: THREAD })).toMatchObject({ status: 403, value: { code: 'THREAD_UNAUTHORIZED' } });
    expect(authorize).toHaveBeenCalledTimes(2);
  });

  it('authorizes every provided thread and exposes tool metadata separately from actual callability', async () => {
    const apps = base().replace(/plugins$/, 'apps');
    expect((await call(`${apps}?threadId=${PEER_THREAD}`)).status).toBe(403);
    expect((await call(`${apps}/read`, { appIds: ['app-one'], threadId: PEER_THREAD })).status).toBe(403);
    expect((await call(`${apps}/installed?threadId=${PEER_THREAD}`)).status).toBe(403);
    expect(bridge.calls).toHaveLength(0);
    const read = await call<NativeAppDetails>(`${apps}/read`, { appIds: ['app-one'], threadId: THREAD, includeTools: true });
    const runtime = await call<NativeInstalledAppPage>(`${apps}/installed?threadId=${THREAD}&appId=app-one`);
    expect(read.value.apps[0].tools).toEqual([
      { name: 'lookup', title: 'Look up', description: 'Find entries.', enabled: true, disabledReason: null, readOnly: true },
      { name: 'write', title: 'Write', description: 'Update entries.', enabled: false, disabledReason: 'Disabled by app policy', readOnly: false },
    ]);
    expect(runtime.value.apps[0]).toEqual({ id: 'app-one', runtimeName: 'Runtime app', enabled: true, callable: false });
    expect(JSON.stringify(read)).not.toContain('installUrl'); expect(JSON.stringify(read)).not.toContain('chatgpt.com');
    expect(read.value.apps[0]).not.toHaveProperty('callable');
  });

  it('pages committed app snapshots without repeated refresh, filtering only explicitly selected app metadata', async () => {
    const apps = base().replace(/plugins$/, 'apps');
    bridge.handlers.set('app/installed', () => ({ apps: Array.from({ length: 70 }, (_, index) => ({ id: `app-${index}`, runtimeName: null, enabled: true, callable: index === 1 })) }));
    const first = await call<NativeInstalledAppPage>(`${apps}/installed?forceRefresh=true&limit=20`);
    expect(first.value.apps).toHaveLength(20); expect(first.value.total).toBe(70);
    const next = await call<NativeInstalledAppPage>(`${apps}/installed?limit=20&cursor=${encodeURIComponent(first.value.nextCursor!)}`);
    expect(next.value.apps[0].id).toBe('app-20'); expect(bridge.calls.filter(item => item.method === 'app/installed')).toHaveLength(1);
    expect(bridge.calls[0].params).toEqual({ threadId: undefined, forceRefresh: true });
    const selected = await call<NativeInstalledAppPage>(`${apps}/installed?appId=app-69&limit=1`);
    expect(selected.value.apps).toEqual([{ id: 'app-69', runtimeName: null, enabled: true, callable: false }]);
    expect((await call(`${apps}/installed?appId=app-69&cursor=${encodeURIComponent(first.value.nextCursor!)}`)).status).toBe(409);
    bridge.handlers.set('app/read', () => ({ apps: [{ id: 'unrequested-app', name: 'Do not show', pluginDisplayNames: [], toolSummaries: [] }], missingAppIds: [] }));
    expect(await call(`${apps}/read`, { appIds: ['app-one'] })).toMatchObject({ status: 502, value: { code: 'CODEX_PLUGIN_PROTOCOL' } });
  });
});
