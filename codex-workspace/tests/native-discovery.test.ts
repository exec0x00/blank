import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { request as httpRequest, type Server } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppContext } from '../server/context';
import { loadConfig } from '../server/config';
import { HttpError } from '../server/errors';
import { workspaceIsBusy } from '../server/worktrees/activity';
import type { CodexBridge } from '../server/codex-cli/bridge';
import type { CodexRuntimeStatus } from '../shared/codex-cli';
import type { ThreadSummary, Workspace } from '../shared/types';
import type { NativeNotification, NativeServerRequest, RpcId } from '../server/codex-cli/rpc';
import type { NativeFeatureDependencies } from '../server/codex-cli/features/common';
import { createNativeDiscoveryRouter, NativeDiscoveryService, NATIVE_DISCOVERY_METHODS } from '../server/codex-cli/features/discovery';
import type { NativeImportItemType } from '../shared/native-discovery';

const THREAD = '01990000-0000-7000-8000-000000000001';
const IMPORT = '01990000-0000-7000-8000-000000000011';
const OTHER_IMPORT = '01990000-0000-7000-8000-000000000012';
const fixtureSecret = 'owned-discovery-test-password';
const allTypes: NativeImportItemType[] = ['AGENTS_MD', 'CONFIG', 'SKILLS', 'PLUGINS', 'MCP_SERVER_CONFIG', 'SUBAGENTS', 'HOOKS', 'COMMANDS', 'MEMORY', 'SESSIONS'];
type Handler = (params: any) => unknown | Promise<unknown>;

/** Controlled official DTOs only. These tests never launch the CLI, execute
 * tools, call a model, send feedback, or access account/provider endpoints. */
class DiscoveryBridge implements CodexBridge {
  current = 'owned-discovery-generation';
  state: CodexRuntimeStatus['state'] = 'ready';
  activeTurns = 0;
  unavailable = new Set<string>();
  calls: Array<{ method: string; params: any }> = [];
  handlers = new Map<string, Handler>();
  notifications = new Set<(message: NativeNotification, generation: string) => void>();
  connections = new Set<(state: 'ready' | 'closed', generation: string) => void>();
  generation() { return this.state === 'ready' ? this.current : null; }
  supports(method: string) { return NATIVE_DISCOVERY_METHODS.includes(method as typeof NATIVE_DISCOVERY_METHODS[number]) && !this.unavailable.has(method); }
  status(): CodexRuntimeStatus { return { backend: 'codex-cli', state: this.state, version: '0.159.2', installedVersion: '0.159.2',
    startedAt: null, updatedAt: '2026-09-30T00:00:00.000Z', canUpdate: false, updateBlockedReason: null, error: null, activeTurns: this.activeTurns,
    capabilities: { conversations: false, pagination: false, queue: false, goals: false, skills: false, plan: false, review: false, historyRevert: false } }; }
  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    this.calls.push({ method, params: structuredClone(params) });
    const handler = this.handlers.get(method);
    if (!handler) throw new Error(`Unexpected owned native discovery fixture request: ${method}`);
    return await handler(params) as T;
  }
  respond(_id: RpcId, _result: unknown, _generation: string) { throw new Error('Discovery never answers a server request.'); }
  rejectRequest(_id: RpcId, _message: string, _generation: string) { throw new Error('Discovery never rejects a server request.'); }
  onNotification(listener: (message: NativeNotification, generation: string) => void) { this.notifications.add(listener); return () => { this.notifications.delete(listener); }; }
  onRequest(_listener: (message: NativeServerRequest, generation: string) => void) { return () => undefined; }
  onConnection(listener: (state: 'ready' | 'closed', generation: string) => void) { this.connections.add(listener); return () => { this.connections.delete(listener); }; }
  emit(method: string, params: Record<string, unknown>, generation = this.current) {
    for (const listener of this.notifications) listener({ method, params }, generation);
  }
  reconnect() {
    const old = this.current; this.state = 'stopped';
    for (const listener of this.connections) listener('closed', old);
    this.current = randomUUID(); this.state = 'ready';
    for (const listener of this.connections) listener('ready', this.current);
  }
}

let directory: string, root: string, otherRoot: string, ctx: AppContext, bridge: DiscoveryBridge, service: NativeDiscoveryService;
let deps: NativeFeatureDependencies, appServer: Server | undefined, origin: string;
let disposers: Array<() => void | Promise<void>>;
const flag = (name = 'memories', enabled = false) => ({ name, displayName: null, stage: 'underDevelopment', description: 'Native feature description', announcement: null, enabled, defaultEnabled: false });
const calls = (method: string) => bridge.calls.filter(call => call.method === method);
const success = (itemType: NativeImportItemType, cwd = root) => ({ itemType, cwd, source: path.join(cwd, 'CLAUDE.md'), target: path.join(cwd, 'AGENTS.md'), title: null });
const result = (itemType: NativeImportItemType = 'AGENTS_MD', cwd = root) => ({ itemType, successes: [success(itemType, cwd)], failures: [] });
async function write(relative: string, content = 'Workspace artifact\n', selectedRoot = root) {
  const absolute = path.join(selectedRoot, relative); await fs.mkdir(path.dirname(absolute), { recursive: true }); await fs.writeFile(absolute, content); return absolute;
}
async function sources() {
  await write('CLAUDE.md', '# Workspace instructions\nRead the project README.\n');
  await write('.claude/skills/format/SKILL.md', '# Formatter\nUse the existing project formatter.\n');
  await write('.claude/commands/check.md', 'Read and explain the project checks.\n');
  bridge.handlers.set('externalAgentConfig/detect', () => ({ items: allTypes.map(itemType => ({ itemType, cwd: root,
    description: `Native detail must not expose ${fixtureSecret} /outside/private/settings.json`, details: null })), connectors: [{ secret: fixtureSecret }] }));
}

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'owned-native-discovery-test-'));
  root = path.join(directory, 'workspaces', 'workspace-one'); otherRoot = path.join(directory, 'workspaces', 'workspace-two');
  await fs.mkdir(root, { recursive: true }); await fs.mkdir(otherRoot, { recursive: true });
  const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: directory, RUNTIME_DIR: path.join(directory, 'runtime'),
    WORKSPACE_PASSWORD: fixtureSecret, SESSION_SECRET: 'owned-discovery-session-secret-32-characters', ENCRYPTION_KEY: 'owned-discovery-encryption-key-32-characters' });
  const workspaces = new Map<string, Workspace>([['workspace-one', { id: 'workspace-one', path: root } as Workspace], ['workspace-two', { id: 'workspace-two', path: otherRoot } as Workspace]]);
  const get = async (id: string) => { const workspace = workspaces.get(id); if (!workspace) throw new HttpError(404, 'Workspace not found.', 'WORKSPACE_NOT_FOUND'); return workspace; };
  ctx = { config, workspaces: { get, resolvePath: async (id: string, relative: string) => path.join((await get(id)).path, relative) }, events: new EventEmitter(),
    store: { write: vi.fn(), read: vi.fn(), update: vi.fn() }, secrets: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
    settings: vi.fn(), saveSettings: vi.fn(), providerKey: vi.fn() } as unknown as AppContext;
  bridge = new DiscoveryBridge(); disposers = [];
  deps = { ctx, bridge, authorizeThread: vi.fn(async (workspaceId, threadId) => {
    if (workspaceId !== 'workspace-one' || threadId !== THREAD) throw new HttpError(404, 'Conversation not found.', 'THREAD_NOT_FOUND');
    return { id: THREAD, workspaceId, backend: 'codex-cli' } as ThreadSummary;
  }), registerCleanup: dispose => disposers.push(dispose) };
  service = new NativeDiscoveryService(deps);
});

afterEach(async () => {
  await service.dispose();
  for (const dispose of disposers) await dispose();
  if (appServer) { appServer.closeAllConnections(); await new Promise<void>(resolve => appServer!.close(() => resolve())); appServer = undefined; }
  await fs.rm(directory, { recursive: true, force: true });
});

describe('bounded native discovery', () => {
  it('reads only content-free native diagnostics and the fixed provider capabilities', async () => {
    bridge.handlers.set('server/diagnostics', () => ({ process: { id: 40, residentMemoryBytes: 4096, physicalFootprintBytes: null, environment: fixtureSecret },
      gauges: [{ name: 'threads.loaded', value: 2 }], logs: fixtureSecret }));
    bridge.handlers.set('modelProvider/capabilities/read', () => ({ namespaceTools: true, imageGeneration: false, webSearch: true, providerKey: fixtureSecret }));
    expect(await service.diagnostics('workspace-one')).toMatchObject({ nativeConfirmed: true,
      process: { id: 40, residentMemoryBytes: 4096, physicalFootprintBytes: null }, gauges: [{ name: 'threads.loaded', value: 2 }] });
    const capabilities = await service.providerCapabilities('workspace-one');
    expect(capabilities).toMatchObject({ namespaceTools: true, imageGeneration: false, webSearch: true, nativeConfirmed: true });
    expect(JSON.stringify(capabilities)).not.toContain(fixtureSecret);
    expect(bridge.calls.map(call => [call.method, call.params])).toEqual([['server/diagnostics', {}], ['modelProvider/capabilities/read', {}]]);
    expect(ctx.providerKey).not.toHaveBeenCalled(); expect(ctx.secrets.get).not.toHaveBeenCalled();
  });

  it('requires actual success and rejects malformed or unavailable diagnostics', async () => {
    bridge.handlers.set('server/diagnostics', () => ({ process: { id: 1, residentMemoryBytes: -1, physicalFootprintBytes: null }, gauges: [] }));
    await expect(service.diagnostics('workspace-one')).rejects.toMatchObject({ code: 'NATIVE_DISCOVERY_RESPONSE' });
    bridge.handlers.set('server/diagnostics', () => { throw Object.assign(new HttpError(400, 'Native method missing', 'CODEX_RPC_REJECTED'), { nativeCode: -32601, nativeMethod: 'server/diagnostics' }); });
    await expect(service.diagnostics('workspace-one')).rejects.toMatchObject({ status: 501, code: 'CODEX_METHOD_UNAVAILABLE' });
    bridge.state = 'stopped';
    await expect(service.diagnostics('workspace-one')).rejects.toMatchObject({ status: 503 });
    expect((await service.overview('workspace-one')).runtimeState).toBe('stopped');
  });

  it('lists lifecycle hook metadata without commands, foreign roots or diagnostic contents', async () => {
    bridge.handlers.set('hooks/list', () => ({ data: [{ cwd: otherRoot, hooks: [], warnings: [fixtureSecret], errors: [] }, { cwd: root,
      hooks: [{ key: 'hook-key', eventName: 'preToolUse', handlerType: 'command', command: `print ${fixtureSecret}`, source: 'project',
        sourcePath: path.join(root, '.codex/hooks.json'), enabled: true, isManaged: false, trustStatus: 'modified', timeoutSec: 30n, statusMessage: `Starting ${fixtureSecret}` },
      { key: 'user-hook', eventName: 'stop', handlerType: 'prompt', source: 'user', sourcePath: '/outside/private/hooks.json', enabled: false,
        isManaged: true, trustStatus: 'managed', timeoutSec: 10, statusMessage: null }], warnings: [fixtureSecret], errors: [{ message: fixtureSecret }] }] }));
    const hooks = await service.hooks('workspace-one', {});
    expect(hooks).toMatchObject({ nativeConfirmed: true, warningCount: 1, errorCount: 1, nextCursor: null });
    expect(hooks.data[0]).toMatchObject({ event: 'Before tool use', sourcePath: '.codex/hooks.json', timeoutSeconds: 30, trust: 'modified' });
    expect(hooks.data[1].sourcePath).toBeNull();
    expect(JSON.stringify(hooks)).not.toContain(fixtureSecret); expect(JSON.stringify(hooks)).not.toContain('/outside'); expect(hooks.data[0]).not.toHaveProperty('command');
    expect(calls('hooks/list')[0].params).toEqual({ cwds: [root] });
  });

  it('passes bounded native profile cursors and projects collaboration metadata', async () => {
    bridge.handlers.set('permissionProfile/list', () => ({ data: [{ id: 'full-access', description: 'Native configured profile', allowed: true }], nextCursor: 'opaque-next' }));
    bridge.handlers.set('collaborationMode/list', () => ({ data: [{ name: 'Plan', mode: 'plan', model: null, reasoning_effort: null, instructions: fixtureSecret }] }));
    expect(await service.permissionProfiles('workspace-one', { cursor: 'opaque-prior' })).toMatchObject({ data: [{ id: 'full-access', allowed: true }], nextCursor: 'opaque-next' });
    expect(calls('permissionProfile/list')[0].params).toEqual({ cwd: root, cursor: 'opaque-prior', limit: 20 });
    expect(await service.collaborationModes('workspace-one')).toMatchObject({ data: [{ name: 'Plan', mode: 'plan', model: null, reasoningEffort: null }] });
    await expect(service.permissionProfiles('workspace-one', { cwd: otherRoot })).rejects.toBeInstanceOf(z.ZodError);
  });
});

describe('native runtime feature and skill-root controls', () => {
  it('cannot enable locked or unknown flags and authorizes native thread scope', async () => {
    bridge.handlers.set('experimentalFeature/list', () => ({ data: [flag(), flag('remote_control'), flag('future_remote_bridge')], nextCursor: null }));
    const page = await service.features('workspace-one', { threadId: THREAD });
    expect(page.data.map(row => row.canToggle)).toEqual([true, false, false]);
    expect(deps.authorizeThread).toHaveBeenCalledWith('workspace-one', THREAD);
    for (const name of ['remote_control', 'apps', 'remote_plugin', 'api_key_model_discovery', 'code_mode_host', 'future_remote_bridge', 'fast_mode', 'image_generation']) {
      await expect(service.setFeature('workspace-one', { name, enabled: true, expectedEnabled: false })).rejects.toMatchObject({ status: 403 });
    }
    await expect(service.features('workspace-two', { threadId: THREAD })).rejects.toMatchObject({ status: 404 });
    expect(calls('experimentalFeature/enablement/set')).toHaveLength(0);
  });

  it('distinguishes acknowledgement, ignored keys, saved overrides and stale feature state', async () => {
    let enabled = false;
    bridge.handlers.set('experimentalFeature/list', () => ({ data: [flag('memories', enabled)], nextCursor: null }));
    bridge.handlers.set('experimentalFeature/enablement/set', () => ({ enablement: {} }));
    await expect(service.setFeature('workspace-one', { name: 'memories', enabled: true, expectedEnabled: false })).rejects.toMatchObject({ code: 'NATIVE_FEATURE_NOT_ACKNOWLEDGED' });
    bridge.handlers.set('experimentalFeature/enablement/set', params => ({ enablement: params.enablement }));
    const overridden = await service.setFeature('workspace-one', { name: 'memories', enabled: true, expectedEnabled: false });
    expect(overridden).toMatchObject({ acknowledged: true, effectiveEnabled: false, requestedEnabled: true, runtimeOnly: true });
    expect(overridden.message).toContain('saved configuration');
    bridge.handlers.set('experimentalFeature/enablement/set', params => { enabled = params.enablement.memories; return { enablement: params.enablement }; });
    expect(await service.setFeature('workspace-one', { name: 'memories', enabled: true, expectedEnabled: false })).toMatchObject({ effectiveEnabled: true, nativeConfirmed: true });
    const before = calls('experimentalFeature/enablement/set').length;
    await expect(service.setFeature('workspace-one', { name: 'memories', enabled: false, expectedEnabled: false })).rejects.toMatchObject({ code: 'NATIVE_FEATURE_CHANGED' });
    expect(calls('experimentalFeature/enablement/set')).toHaveLength(before);
    expect(bridge.calls.some(call => call.method.startsWith('config/'))).toBe(false);
  });

  it('replaces only registered workspace skill roots and preserves other workspace additions', async () => {
    await write('skills/one/SKILL.md'); await write('skills/two/SKILL.md', 'Other workspace skill', otherRoot);
    bridge.handlers.set('skills/extraRoots/set', () => ({}));
    expect(await service.skillRoots('workspace-one')).toMatchObject({ nativeConfirmed: false, paths: [] });
    expect(await service.setSkillRoots('workspace-one', { paths: ['skills'] })).toMatchObject({ nativeConfirmed: true, paths: ['skills'], runtimeOnly: true });
    await service.setSkillRoots('workspace-two', { paths: ['skills'] });
    expect(calls('skills/extraRoots/set').at(-1)?.params).toEqual({ extraRoots: [path.join(root, 'skills'), path.join(otherRoot, 'skills')] });
    await service.setSkillRoots('workspace-one', { paths: [] });
    expect(calls('skills/extraRoots/set').at(-1)?.params).toEqual({ extraRoots: [path.join(otherRoot, 'skills')] });
    bridge.reconnect(); expect(await service.skillRoots('workspace-two')).toMatchObject({ nativeConfirmed: false, paths: [] });
    expect(ctx.store.write).not.toHaveBeenCalled(); expect(ctx.secrets.set).not.toHaveBeenCalled();
  });

  it('rejects absolute, parent and linked skill roots before native discovery changes', async () => {
    await write('skills/one/SKILL.md'); await fs.symlink(otherRoot, path.join(root, 'outside'));
    bridge.handlers.set('skills/extraRoots/set', () => ({}));
    for (const value of [otherRoot, '../workspace-two', 'outside', '.']) {
      await expect(service.setSkillRoots('workspace-one', { paths: [value] })).rejects.toMatchObject({ status: 403 });
    }
    await fs.symlink(otherRoot, path.join(root, 'skills', 'nested-link'));
    await expect(service.setSkillRoots('workspace-one', { paths: ['skills'] })).rejects.toMatchObject({ status: 403 });
    expect(calls('skills/extraRoots/set')).toHaveLength(0);
  });
});

describe('scoped native migration previews, progress and history', () => {
  it('previews allowed categories, omits home content and never exposes native descriptions or connectors', async () => {
    await sources();
    const original = bridge.handlers.get('externalAgentConfig/detect')!;
    bridge.handlers.set('externalAgentConfig/detect', async params => { const value = await original(params) as any; value.items.push({ itemType: 'SESSIONS', cwd: null, description: fixtureSecret, details: null }); return value; });
    const preview = await service.imports.preview('workspace-one', { source: 'claude' });
    expect(preview.items.filter(item => item.allowed).map(item => item.itemType)).toEqual(['AGENTS_MD', 'SKILLS', 'COMMANDS']);
    expect(preview.items.find(item => item.itemType === 'CONFIG')?.blockedReason).toContain('fixed provider');
    expect(preview.items.find(item => item.itemType === 'MCP_SERVER_CONFIG')?.blockedReason).toContain('protected storage');
    expect(preview.excludedCount).toBe(1); expect(JSON.stringify(preview)).not.toContain(fixtureSecret); expect(JSON.stringify(preview)).not.toContain('/outside');
    expect(calls('externalAgentConfig/detect')[0].params).toMatchObject({ includeHome: false, cwds: [root], migrationSource: 'claude', maxSessions: 10 });
    await expect(service.imports.preview('workspace-one', { source: 'claude', includeHome: true })).rejects.toBeInstanceOf(z.ZodError);
  });

  it('blocks credential-bearing skills while allowing an independent clean category', async () => {
    await sources(); await write('.claude/skills/format/config.txt', `API_KEY = "${fixtureSecret}"`);
    const preview = await service.imports.preview('workspace-one', { source: 'claude' });
    expect(preview.items.find(item => item.itemType === 'SKILLS')).toMatchObject({ allowed: false });
    expect(preview.items.find(item => item.itemType === 'AGENTS_MD')).toMatchObject({ allowed: true });
    const blocked = preview.items.find(item => item.itemType === 'SKILLS')!;
    await expect(service.imports.start('workspace-one', { previewId: preview.previewId, itemIds: [blocked.id] })).rejects.toMatchObject({ status: 403 });
    expect(calls('externalAgentConfig/import')).toHaveLength(0);
  });

  it('reserves preview capacity before asynchronous file reads and native detection', async () => {
    await sources();
    const original = bridge.handlers.get('externalAgentConfig/detect')!;
    let release!: () => void, entered!: () => void, entries = 0;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const admitted = new Promise<void>(resolve => { entered = resolve; });
    bridge.handlers.set('externalAgentConfig/detect', async params => {
      if (++entries === 4) entered(); await pending; return original(params);
    });
    const completed = Promise.allSettled(Array.from({ length: 8 }, () => service.imports.preview('workspace-one', { source: 'claude' })));
    await admitted; expect(calls('externalAgentConfig/detect')).toHaveLength(4); release();
    const outcomes = await completed;
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(4);
    expect(outcomes.filter(outcome => outcome.status === 'rejected').every(outcome => outcome.status === 'rejected' && outcome.reason.code === 'NATIVE_IMPORT_PREVIEW_LIMIT')).toBe(true);
  });

  it('rejects source links, overly large artifacts and parent repository scope before detection', async () => {
    await fs.symlink(otherRoot, path.join(root, '.claude'));
    await expect(service.imports.preview('workspace-one', { source: 'claude' })).rejects.toMatchObject({ status: 403 });
    await fs.unlink(path.join(root, '.claude')); await fs.mkdir(path.join(directory, '.git'));
    await expect(service.imports.preview('workspace-one', { source: 'claude' })).rejects.toMatchObject({ status: 403 });
    await fs.rmdir(path.join(directory, '.git')); const big = await write('CLAUDE.md'); await fs.truncate(big, 1024 * 1024 + 1);
    await expect(service.imports.preview('workspace-one', { source: 'claude' })).rejects.toMatchObject({ status: 413 });
    expect(calls('externalAgentConfig/detect')).toHaveLength(0);
  });

  it('uses only the reviewed native categories and binds progress that arrives before acknowledgement', async () => {
    await sources(); const preview = await service.imports.preview('workspace-one', { source: 'claude' });
    bridge.handlers.set('externalAgentConfig/import', params => {
      expect(params).toEqual({ migrationItems: [{ itemType: 'AGENTS_MD', cwd: root, description: 'Workspace instructions', details: null }],
        source: 'codex-workspace', providerId: 'claude', migrationSource: 'claude' });
      bridge.emit('externalAgentConfig/import/progress', { importId: OTHER_IMPORT, itemTypeResults: [result('SKILLS', otherRoot)] });
      bridge.emit('externalAgentConfig/import/progress', { importId: IMPORT, itemTypeResults: [result()] });
      bridge.emit('externalAgentConfig/import/completed', { importId: IMPORT, itemTypeResults: [result()] });
      return { importId: IMPORT };
    });
    const operation = await service.imports.start('workspace-one', { previewId: preview.previewId, itemIds: [preview.items[0].id] });
    expect(operation).toMatchObject({ importId: IMPORT, status: 'completed', results: [{ itemType: 'AGENTS_MD', successes: 1, failures: 0, sourcePaths: ['CLAUDE.md'], destinationPaths: ['AGENTS.md'] }] });
    await expect(service.imports.status('workspace-two', operation.operationId)).rejects.toMatchObject({ status: 404 });
    await expect(service.imports.start('workspace-one', { previewId: preview.previewId, itemIds: [preview.items[0].id] })).rejects.toMatchObject({ status: 409 });
    expect(calls('externalAgentConfig/import')).toHaveLength(1); expect(ctx.secrets.set).not.toHaveBeenCalled();
  });

  it('requires a fresh preview after file edits, restart, or forged selection payloads', async () => {
    await sources(); let preview = await service.imports.preview('workspace-one', { source: 'claude' });
    await write('CLAUDE.md', 'Changed instructions');
    await expect(service.imports.start('workspace-one', { previewId: preview.previewId, itemIds: [preview.items[0].id] })).rejects.toMatchObject({ code: 'NATIVE_DISCOVERY_PREVIEW_CHANGED' });
    preview = await service.imports.preview('workspace-one', { source: 'claude' });
    await expect(service.imports.start('workspace-one', { previewId: preview.previewId, itemIds: [randomUUID()] })).rejects.toMatchObject({ status: 403 });
    await expect(service.imports.start('workspace-one', { previewId: preview.previewId, itemIds: [preview.items[0].id], migrationItems: [{ itemType: 'CONFIG', cwd: '/home' }] })).rejects.toBeInstanceOf(z.ZodError);
    bridge.reconnect(); await expect(service.imports.start('workspace-one', { previewId: preview.previewId, itemIds: [preview.items[0].id] })).rejects.toMatchObject({ code: 'NATIVE_IMPORT_PREVIEW_EXPIRED' });
    expect(calls('externalAgentConfig/import')).toHaveLength(0);
  });

  it('does not infer completion from the import acknowledgement or replay after disconnect', async () => {
    await sources(); const preview = await service.imports.preview('workspace-one', { source: 'claude' });
    bridge.handlers.set('externalAgentConfig/import', () => ({ importId: IMPORT }));
    const operation = await service.imports.start('workspace-one', { previewId: preview.previewId, itemIds: [preview.items[0].id] });
    expect(operation.status).toBe('running'); expect(operation.results).toEqual([]);
    bridge.reconnect(); expect((await service.imports.status('workspace-one', operation.operationId)).status).toBe('unknown');
    bridge.emit('externalAgentConfig/import/completed', { importId: IMPORT, itemTypeResults: [result()] }, 'owned-discovery-generation');
    expect((await service.imports.status('workspace-one', operation.operationId)).status).toBe('unknown');
    expect(calls('externalAgentConfig/import')).toHaveLength(1);
  });

  it('keeps a transport-uncertain import visibly unknown', async () => {
    await sources(); const preview = await service.imports.preview('workspace-one', { source: 'claude' });
    bridge.handlers.set('externalAgentConfig/import', () => { throw Object.assign(new HttpError(504, fixtureSecret, 'CODEX_REQUEST_TIMEOUT'), { outcomeUnknown: true }); });
    const operation = await service.imports.start('workspace-one', { previewId: preview.previewId, itemIds: [preview.items[0].id] });
    expect(operation).toMatchObject({ status: 'unknown', importId: null }); expect(JSON.stringify(operation)).not.toContain(fixtureSecret);
    expect(workspaceIsBusy(ctx.config.workspacesDir, 'workspace-one')).toBe(true);
    const next = await service.imports.preview('workspace-one', { source: 'claude' });
    await expect(service.imports.start('workspace-one', { previewId: next.previewId, itemIds: [next.items[0].id] })).rejects.toMatchObject({ code: 'NATIVE_IMPORT_BUSY' });
    bridge.reconnect(); expect(workspaceIsBusy(ctx.config.workspacesDir, 'workspace-one')).toBe(false);
  });

  it('retains workspace admission until native completion or exact recorded history proves it', async () => {
    await sources(); const preview = await service.imports.preview('workspace-one', { source: 'claude' });
    bridge.handlers.set('externalAgentConfig/import', () => ({ importId: IMPORT }));
    const operation = await service.imports.start('workspace-one', { previewId: preview.previewId, itemIds: [preview.items[0].id] });
    expect(workspaceIsBusy(ctx.config.workspacesDir, 'workspace-one')).toBe(true);
    bridge.handlers.set('externalAgentConfig/import/readHistories', () => ({ data: [{ importId: IMPORT, providerId: 'claude',
      completedAtMs: Date.now(), successes: [success('AGENTS_MD')], failures: [] }], connectors: [] }));
    await service.imports.history('workspace-one', {});
    expect((await service.imports.status('workspace-one', operation.operationId)).status).toBe('completed');
    expect(workspaceIsBusy(ctx.config.workspacesDir, 'workspace-one')).toBe(false);
  });

  it('does not interpret an invalid native import receipt as a known rejection', async () => {
    await sources(); const preview = await service.imports.preview('workspace-one', { source: 'claude' });
    bridge.handlers.set('externalAgentConfig/import', () => ({}));
    const operation = await service.imports.start('workspace-one', { previewId: preview.previewId, itemIds: [preview.items[0].id] });
    expect(operation).toMatchObject({ status: 'unknown', importId: null });
    expect(workspaceIsBusy(ctx.config.workspacesDir, 'workspace-one')).toBe(true);
  });

  it('paginates scoped native history and refuses cursors after history changes', async () => {
    let rows = Array.from({ length: 23 }, (_, index) => ({ importId: `import-${index}`, providerId: 'claude', completedAtMs: 1_700_000_000_000 + index,
      successes: [success('AGENTS_MD')], failures: [] }));
    bridge.handlers.set('externalAgentConfig/import/readHistories', () => ({ data: [{ importId: 'foreign', completedAtMs: 1, successes: [success('CONFIG', otherRoot)], failures: [] }, ...rows], connectors: [{ secret: fixtureSecret }] }));
    const first = await service.imports.history('workspace-one', {});
    expect(first.data).toHaveLength(20); expect(first.nextCursor).not.toBeNull();
    const second = await service.imports.history('workspace-one', { cursor: first.nextCursor }); expect(second.data).toHaveLength(3);
    expect(JSON.stringify(first)).not.toContain(otherRoot); expect(JSON.stringify(first)).not.toContain(fixtureSecret);
    rows = rows.slice(1);
    await expect(service.imports.history('workspace-one', { cursor: first.nextCursor })).rejects.toMatchObject({ code: 'NATIVE_DISCOVERY_PAGE_CHANGED' });
    expect(calls('externalAgentConfig/import/readHistories')[0].params).toBeUndefined();
  });

  it('records only explicit user-reported completed imports with verified workspace paths', async () => {
    await write('CLAUDE.md'); await write('AGENTS.md');
    bridge.handlers.set('externalAgentConfig/import/recordHistory', () => ({ importId: IMPORT }));
    await expect(service.imports.recordHistory('workspace-one', { itemType: 'AGENTS_MD', sourcePath: 'CLAUDE.md', targetPath: 'AGENTS.md', confirmCompleted: false })).rejects.toBeInstanceOf(z.ZodError);
    await expect(service.imports.recordHistory('workspace-one', { itemType: 'AGENTS_MD', sourcePath: '../workspace-two/private', targetPath: 'AGENTS.md', confirmCompleted: true })).rejects.toMatchObject({ status: 403 });
    expect(await service.imports.recordHistory('workspace-one', { itemType: 'AGENTS_MD', sourcePath: 'CLAUDE.md', targetPath: 'AGENTS.md', confirmCompleted: true })).toEqual({ importId: IMPORT, recorded: true, userReported: true });
    expect(calls('externalAgentConfig/import/recordHistory')[0].params).toEqual({ providerId: 'workspace_manual', itemTypeResults: [result()] });
    expect(await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8')).toBe('Workspace artifact\n');
  });
});

describe('explicit bounded feedback', () => {
  it('requires review and consent, then sends immutable approved snapshots without native logs', async () => {
    await write('report.log', 'Reviewed text\n');
    const preview = await service.feedback.preview('workspace-one', { classification: 'bug', reason: 'The command status remained pending.', files: ['report.log'] });
    expect(preview).toMatchObject({ files: [{ path: 'report.log', bytes: 14 }], includeLogs: false, destination: 'OpenAI feedback service' });
    expect(calls('feedback/upload')).toHaveLength(0);
    await expect(service.feedback.send('workspace-one', { previewId: preview.previewId, consent: false })).rejects.toBeInstanceOf(z.ZodError);
    await write('report.log', 'Edited after preview\n'); let staged: string[] = [];
    bridge.handlers.set('feedback/upload', async params => {
      expect(params).toMatchObject({ classification: 'bug', reason: 'The command status remained pending.', includeLogs: false, threadId: THREAD });
      staged = params.extraLogFiles; expect(staged).toHaveLength(1); expect(staged[0]).not.toBe(path.join(root, 'report.log'));
      expect(await fs.readFile(staged[0], 'utf8')).toBe('Reviewed text\n'); expect((await fs.stat(staged[0])).mode & 0o777).toBe(0o600);
      return { threadId: THREAD, promptHash: null };
    });
    expect(await service.feedback.send('workspace-one', { previewId: preview.previewId, consent: true, threadId: THREAD })).toMatchObject({ sent: true, reference: THREAD, nativeConfirmed: true });
    expect(deps.authorizeThread).toHaveBeenCalledWith('workspace-one', THREAD);
    await expect(fs.stat(staged[0])).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(service.feedback.send('workspace-one', { previewId: preview.previewId, consent: true })).rejects.toMatchObject({ status: 409 });
    expect(calls('feedback/upload')).toHaveLength(1); expect(ctx.secrets.set).not.toHaveBeenCalled();
  });

  it('rejects external paths, linked files, credentials, private-key files and oversized attachments', async () => {
    await write('secret.txt', `Password: ${fixtureSecret}`); await write('ordinary.txt', 'Normal test text');
    await write('private-key.txt', 'Possibly sensitive'); await fs.symlink(path.join(root, 'ordinary.txt'), path.join(root, 'linked.log'));
    const big = await write('large.log'); await fs.truncate(big, 256 * 1024 + 1);
    for (const file of ['/etc/passwd', '../workspace-two/private.txt', 'secret.txt', 'private-key.txt', 'linked.log', 'large.log']) {
      await expect(service.feedback.preview('workspace-one', { classification: 'other', reason: 'Fixture feedback', files: [file] })).rejects.toBeInstanceOf(HttpError);
    }
    await expect(service.feedback.preview('workspace-one', { classification: 'other', reason: `Oops ${fixtureSecret}`, files: [] })).rejects.toMatchObject({ code: 'NATIVE_DISCOVERY_SECRET_CONTENT' });
    expect(calls('feedback/upload')).toHaveLength(0);
  });

  it('reports native disabled feedback without changing configuration or guessing success', async () => {
    const preview = await service.feedback.preview('workspace-one', { classification: 'performance', reason: 'Fixture performance concern', files: [] });
    bridge.handlers.set('feedback/upload', () => { throw new HttpError(400, 'sending feedback is disabled by configuration', 'CODEX_RPC_REJECTED'); });
    await expect(service.feedback.send('workspace-one', { previewId: preview.previewId, consent: true })).rejects.toMatchObject({ code: 'NATIVE_FEEDBACK_DISABLED', status: 409 });
    expect(bridge.calls.map(call => call.method)).toEqual(['feedback/upload']); expect(ctx.saveSettings).not.toHaveBeenCalled();
  });

  it('consumes feedback consent atomically under simultaneous submissions', async () => {
    const preview = await service.feedback.preview('workspace-one', { classification: 'bug', reason: 'Concurrent submission fixture', files: [] });
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    bridge.handlers.set('feedback/upload', async () => { await pending; return { threadId: THREAD, promptHash: null }; });
    const outcomes = Promise.allSettled([1, 2].map(() => service.feedback.send('workspace-one', { previewId: preview.previewId, consent: true, threadId: THREAD })));
    for (let tries = 0; calls('feedback/upload').length === 0 && tries < 30; tries++) await new Promise(resolve => setTimeout(resolve, 1));
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(calls('feedback/upload')).toHaveLength(1); finish();
    const settled = await outcomes;
    expect(settled.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter(row => row.status === 'rejected')).toHaveLength(1);
  });
});

async function mount() {
  const app = express(); app.use(express.json()); app.use('/api', createNativeDiscoveryRouter(deps));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error instanceof HttpError ? error.status : error instanceof z.ZodError ? 400 : 500)
    .json({ error: error instanceof Error ? error.message : 'Unexpected error', code: error instanceof HttpError ? error.code : 'INVALID_INPUT' }));
  appServer = await new Promise<Server>(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  const address = appServer.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  origin = `http://127.0.0.1:${address.port}/api/workspaces/workspace-one/codex/discovery`;
}
function request(route: string, method = 'GET', body?: unknown): Promise<{ status: number; body: any; cache: string | undefined }> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest(origin + route, { method, agent: false, headers: data === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, res => {
      let value = ''; res.setEncoding('utf8'); res.on('data', chunk => { value += chunk; }); res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(value), cache: res.headers['cache-control'] }));
    }); req.on('error', reject); req.setTimeout(3000, () => req.destroy(new Error('Fixture request timed out.'))); req.end(data);
  });
}

describe('native discovery HTTP boundary', () => {
  it('keeps responses private and rejects arbitrary provider selectors or raw migration/feedback arguments', async () => {
    await mount(); bridge.handlers.set('modelProvider/capabilities/read', () => ({ namespaceTools: true, imageGeneration: false, webSearch: false }));
    const response = await request('/provider-capabilities'); expect(response.status).toBe(200); expect(response.cache).toContain('no-store');
    expect((await request('/provider-capabilities?provider=another&model=secret')).status).toBe(400);
    expect((await request('/imports/preview', 'POST', { source: 'claude', cwds: ['/etc'], includeHome: true })).status).toBe(400);
    expect((await request('/feedback', 'POST', { reason: 'Immediate external send', includeLogs: true, extraLogFiles: ['/etc/passwd'], consent: true })).status).toBe(400);
    expect(bridge.calls.map(call => call.method)).toEqual(['modelProvider/capabilities/read']);
  });

  it('redacts rejected native error bodies and disposes subscriptions', async () => {
    await mount(); bridge.handlers.set('server/diagnostics', () => { throw new HttpError(400, `Failure: ${fixtureSecret} /private/server/config.json`, 'CODEX_RPC_REJECTED'); });
    const response = await request('/diagnostics'); expect(response.status).toBe(400); expect(JSON.stringify(response.body)).not.toContain(fixtureSecret); expect(JSON.stringify(response.body)).not.toContain('/private');
    expect(disposers).toHaveLength(1); await disposers[0](); disposers = [];
    await service.dispose(); expect(bridge.notifications.size).toBe(0); expect(bridge.connections.size).toBe(0);
    const dispatched = bridge.calls.length;
    await expect(service.diagnostics('workspace-one')).rejects.toMatchObject({ code: 'CODEX_UNAVAILABLE', status: 503 });
    expect(bridge.calls).toHaveLength(dispatched);
  });
});
