import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import type { AppContext } from '../server/context';
import { loadConfig } from '../server/config';
import { HttpError } from '../server/errors';
import type { HostResourceSnapshot } from '../server/host-resources';
import { CodexRuntime, type CodexRuntimeOptions } from '../server/codex-cli/runtime';
import { CodexRpcClient, type NativeNotification, type RpcId } from '../server/codex-cli/rpc';
import type { CodexCliInstaller, CodexCliInstallStatus, InstalledCodexCli } from '../server/codex-cli/install-types';
import { CODEX_CLI_HOST_POLICY, renderCodexManagedRequirements } from '../server/codex-cli/config';

// Lifecycle fixtures only: no npm, native process, provider request or /etc write.
// Metadata fields below follow the retained official 0.155.1 app-server schema.
const methods = ['initialize', 'thread/start', 'thread/read', 'thread/list', 'thread/resume', 'turn/start', 'turn/interrupt',
  'thread/loaded/list', 'thread/items/list', 'thread/turns/list', 'thread/queue/add', 'thread/queue/list', 'thread/queue/delete',
  'thread/queue/start', 'thread/goal/set', 'thread/goal/get', 'thread/goal/clear', 'thread/backgroundTerminals/list',
  'skills/list', 'skills/config/write', 'review/start', 'thread/revert', 'collaborationMode/list', 'experimentalFeature/list',
  'model/list', 'config/read', 'config/batchWrite', 'configRequirements/read'];
const THREAD = '01990000-0000-7000-8000-000000000001';
const SECOND = '01990000-0000-7000-8000-000000000002';
function release(name: string, version = '0.155.1'): InstalledCodexCli {
  return { releaseId: name, version, installedAt: '2026-09-22T00:00:00.000Z', executablePath: `/tmp/native-lifecycle-fixture/${name}/codex`,
    launcherPath: `/tmp/native-lifecycle-fixture/${name}/codex.js`, packageRoot: `/tmp/native-lifecycle-fixture/${name}`,
    schemaDirectory: `/tmp/native-lifecycle-fixture/${name}/schema`, schemaManifestPath: `/tmp/native-lifecycle-fixture/${name}/schema-manifest.json`,
    schemaSha256: 'a'.repeat(64), methods: [...methods] };
}
function resources(headroomBytes = 80_000_000_000): HostResourceSnapshot {
  return { observedAt: new Date().toISOString(), memory: { status: 'available', source: 'cgroup-v2', currentBytes: 90_000_000_000 - headroomBytes,
    limitBytes: 104_000_000_000, limitKind: 'limited', policyCeilingBytes: 90_000_000_000, effectiveCeilingBytes: 90_000_000_000,
    headroomBytes, defaultReserveBytes: 2_000_000_000, hostTotalBytes: null, hostAvailableBytes: null, highBytes: null,
    breakdown: null, swapCurrentBytes: null, scopes: [] } as HostResourceSnapshot['memory'], filesystems: [], warnings: [] };
}
function managedRequirements() {
  return { requirements: { additionalDeveloperInstructions: CODEX_CLI_HOST_POLICY, allowedSandboxModes: ['read-only', 'danger-full-access'],
    allowedApprovalPolicies: ['never', 'on-request'], cliAuthCredentialsStore: 'ephemeral', featureRequirements: parse(renderCodexManagedRequirements()).features } };
}
function model(model = 'gpt-5.6-luna', overrides: Record<string, unknown> = {}) {
  return { id: `catalog-entry:${model}`, model, displayName: model, description: 'Native metadata fixture', hidden: false,
    defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Native low effort' }],
    inputModalities: ['text', 'image'], isDefault: true, ...overrides };
}
const releases: Array<() => void> = [], runtimes: CodexRuntime[] = [], directories: string[] = [];
function deferred<T = void>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  releases.push(() => resolve(undefined as T));
  return { promise, resolve, reject };
}
class NativeClient extends CodexRpcClient {
  private live = false;
  private nativePid?: number;
  private done = false;
  private fixtureClose?: Promise<void>;
  spawn = true;
  starts = 0;
  closes = 0;
  aborts: string[] = [];
  loaded: string[] = [];
  calls: Array<{ method: string; params: Record<string, unknown>; timeoutMs?: number }> = [];
  responses: Array<{ id: RpcId; result: unknown }> = [];
  rejections: RpcId[] = [];
  handlers = new Map<string, (params: Record<string, unknown>) => unknown | Promise<unknown>>();
  onStart?: () => Promise<void>;
  onClose?: () => Promise<void>;
  onAbort?: () => Promise<void>;
  onRespond?: () => void;
  constructor() { super({ executable: '/never-executed-lifecycle-fixture', args: [], cwd: '/tmp', env: {} }); }
  override get running() { return this.live && !this.done; }
  override get pid() { return this.nativePid; }
  override async start() {
    this.starts++;
    if (this.spawn) { this.nativePid = 100_000 + this.starts; this.live = true; }
    await this.onStart?.();
    if (this.done || !this.live) throw new HttpError(503, 'Fixture connection closed.', 'CODEX_CONNECTION_CLOSED');
  }
  override async request<T>(method: string, input: unknown = {}, timeoutMs?: number): Promise<T> {
    if (!this.running) throw new HttpError(503, 'Fixture connection closed.', 'CODEX_UNAVAILABLE');
    const params = input as Record<string, unknown>;
    this.calls.push({ method, params: structuredClone(params), timeoutMs });
    const handler = this.handlers.get(method);
    if (handler) return await handler(params) as T;
    if (method === 'experimentalFeature/list') return { data: [{ name: 'goals', enabled: true, defaultEnabled: false, stage: 'underDevelopment' }], nextCursor: null } as T;
    if (method === 'thread/loaded/list') return { data: [...this.loaded], nextCursor: null } as T;
    if (method === 'thread/read') return { thread: { id: params.threadId, status: { type: 'idle' } } } as T;
    if (method === 'thread/goal/get') return { goal: null } as T;
    if (['thread/queue/list', 'thread/backgroundTerminals/list', 'thread/list'].includes(method)) return { data: [], nextCursor: null } as T;
    if (method === 'model/list') return { data: [model()], nextCursor: null } as T;
    if (method === 'configRequirements/read') return managedRequirements() as T;
    if (method === 'turn/start' || method === 'thread/queue/start') return { turn: { id: 'native-turn-fixture', status: 'inProgress' } } as T;
    return {} as T;
  }
  override respond(id: RpcId, result: unknown) { this.responses.push({ id, result: structuredClone(result) }); this.onRespond?.(); }
  override rejectRequest(id: RpcId) { this.rejections.push(id); }
  override async abort(message: string) { this.aborts.push(message); await this.onAbort?.(); await this.close(); }
  override close(): Promise<void> {
    this.closes++;
    this.fixtureClose ??= (async () => {
      await this.onClose?.(); this.done = true; this.live = false;
      this.emit('closed', { expected: true, message: 'Fixture connection stopped.' });
    })();
    return this.fixtureClose;
  }
  notification(method: string, params: Record<string, unknown>) { this.emit('notification', { method, params } satisfies NativeNotification); }
  callback(id: RpcId, method = 'item/commandExecution/requestApproval') { this.emit('request', { id, method, params: { threadId: THREAD } }); }
  exit(cleanupComplete?: boolean) {
    this.live = false;
    this.emit('closed', { expected: false, message: 'Fixture native process exited.', ...(cleanupComplete === undefined ? {} : { cleanupComplete }) });
  }
}
function fixture(input: { dataDir?: string; release?: InstalledCodexCli; options?: Partial<CodexRuntimeOptions> } = {}) {
  const initial = input.release ?? release('initial'), candidate = release('candidate', '0.155.2');
  let installed: InstalledCodexCli | null = null;
  const installer = {
    start: vi.fn(async () => { installed = initial; return initial; }),
    updateLatest: vi.fn(async () => { installed = candidate; return candidate; }), close: vi.fn(async () => {}),
    current: () => installed,
    status: (): CodexCliInstallStatus => ({ phase: installed ? 'ready' : 'idle', available: !!installed, currentVersion: installed?.version ?? null,
      installedAt: installed?.installedAt ?? null, lastAttempt: null, lastError: null }),
  } satisfies CodexCliInstaller;
  const config = loadConfig({ DATA_DIR: input.dataDir ?? `/tmp/codex-runtime-unused-${randomUUID()}`,
    RUNTIME_DIR: `/tmp/codex-runtime-unused-cache-${randomUUID()}`, NODE_ENV: 'test',
    WORKSPACE_PASSWORD: 'synthetic-lifecycle-password', SESSION_SECRET: 'synthetic-lifecycle-session-secret-32', ENCRYPTION_KEY: 'synthetic-lifecycle-credential-key-32' });
  const ctx = { config, events: new EventEmitter(), workspaces: { get: async (id: string) => ({ id, path: '/tmp/native-skill-workspace' }) } } as unknown as AppContext;
  const clients: NativeClient[] = [], queued: NativeClient[] = [];
  const prepareLaunch = vi.fn(async () => ({ codexHomeDir: path.join(config.dataDir, 'codex-workspace/native-codex'),
    cwd: config.homeDir, args: ['app-server', '--listen', 'stdio://'], env: { CODEX_FIXED_PROVIDER_PLACEHOLDER: 'not-needed' } }));
  const validateLaunchPolicy = vi.fn(async () => ({ fingerprint: 'policy-one', files: [] }));
  const readLaunchRuleSnapshot = vi.fn(async () => ({ fingerprint: 'policy-one', files: [] }));
  const observeResources = vi.fn(async () => resources());
  const migratePreferences = vi.fn(async () => {});
  const readModelMetadata = vi.fn(async () => new Map());
  const clientFactory = vi.fn(() => { const client = queued.shift() ?? new NativeClient(); clients.push(client); return client; });
  const options: CodexRuntimeOptions = { installer, prepareLaunch, validateLaunchPolicy, readLaunchRuleSnapshot, observeResources,
    migratePreferences, readModelMetadata, clientFactory, ...input.options };
  const runtime = new CodexRuntime(ctx, options); runtimes.push(runtime);
  return { runtime, ctx, installer, initial, candidate, clients, queued, options, prepareLaunch, validateLaunchPolicy,
    readLaunchRuleSnapshot, observeResources, migratePreferences, readModelMetadata, clientFactory };
}
async function settledUpdate(runtime: CodexRuntime) {
  await vi.waitFor(() => {
    expect(['updating', 'starting', 'installing']).not.toContain(runtime.status().state);
    expect(runtime.status().updateBlockedReason).not.toBe('A Codex update is already in progress.');
  });
}
afterEach(async () => {
  const closing = Promise.allSettled(runtimes.splice(0).map(runtime => runtime.close()));
  for (const release of releases.splice(0)) release();
  await closing;
  vi.restoreAllMocks(); vi.useRealTimers();
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});

describe('native extension callback and activity ownership', () => {
  it('advertises an MCP request shelf only for a running native callback with a registered site owner', async () => {
    const installed = release('mcp-capable'); installed.methods.push('mcpServerStatus/list');
    installed.serverRequestMethods = ['mcpServer/elicitation/request'];
    const value = fixture({ release: installed });
    expect(value.runtime.status().capabilities.mcpRequests).toBeUndefined();
    await value.runtime.start(); expect(value.runtime.status().capabilities.mcpRequests).toBeUndefined();
    const dispose = value.runtime.registerServerRequestHandler('mcpServer/elicitation/request', () => {});
    expect(value.runtime.status().capabilities.mcpRequests).toBe(true);
    dispose(); expect(value.runtime.status().capabilities.mcpRequests).toBeUndefined();
  });
  it('dispatches a claimed callback to exactly one owner before generic conversation listeners', async () => {
    const value = fixture(); await value.runtime.start();
    const generic = vi.fn(); value.runtime.onRequest(generic);
    const owner = vi.fn((message: { id: RpcId }, generation: string) => {
      value.runtime.respond(message.id, { action: 'cancel', content: null, _meta: null }, generation);
    });
    const dispose = value.runtime.registerServerRequestHandler('mcpServer/elicitation/request', owner);
    expect(() => value.runtime.registerServerRequestHandler('mcpServer/elicitation/request', owner)).toThrow();
    value.clients[0].callback('elicitation-one', 'mcpServer/elicitation/request');
    expect(owner).toHaveBeenCalledTimes(1); expect(generic).not.toHaveBeenCalled();
    expect(value.clients[0].responses).toHaveLength(1); expect(value.clients[0].rejections).toEqual([]);
    dispose(); dispose();
    value.clients[0].callback('elicitation-two', 'mcpServer/elicitation/request');
    expect(generic).toHaveBeenCalledTimes(1);
  });

  it('rejects failed or removed callback handlers once and cannot reuse the current-time owner', async () => {
    const value = fixture(); await value.runtime.start();
    const generic = vi.fn(); value.runtime.onRequest(generic);
    const dispose = value.runtime.registerServerRequestHandler('mcpServer/elicitation/request', async () => { throw new Error('synthetic handler failure'); });
    value.clients[0].callback('failed-owner', 'mcpServer/elicitation/request');
    await vi.waitFor(() => expect(value.clients[0].rejections).toEqual(['failed-owner']));
    dispose(); expect(value.clients[0].rejections).toEqual(['failed-owner']); expect(generic).not.toHaveBeenCalled();
    expect(() => value.runtime.registerServerRequestHandler('currentTime/read', () => {})).toThrow();
    const pending = value.runtime.registerServerRequestHandler('mcpServer/elicitation/request', () => {});
    value.clients[0].callback('pending-owner', 'mcpServer/elicitation/request'); pending(); pending();
    expect(value.clients[0].rejections).toEqual(['failed-owner', 'pending-owner']);
  });

  it('holds updates while a native process outlives its start acknowledgment and fences stale release calls', async () => {
    const value = fixture(); await value.runtime.start();
    const generation = value.runtime.generation()!, release = value.runtime.acquireActivity(generation);
    expect(value.runtime.status().canUpdate).toBe(false);
    await expect(value.runtime.updateLatest()).rejects.toMatchObject({ code: 'CODEX_BUSY' });
    release(); release(); expect(value.runtime.status().canUpdate).toBe(true);
    expect(() => value.runtime.acquireActivity('old-generation')).toThrow();
    const abandoned = value.runtime.acquireActivity(generation);
    value.clients[0].exit(true); abandoned();
    expect(value.runtime.status().canUpdate).toBe(true);
  });

  it('allows native cancellation when the resource budget cannot admit new work', async () => {
    const installed = release('cleanup-capable'); installed.methods.push('process/kill', 'command/exec/terminate', 'process/spawn');
    const value = fixture({ release: installed }); await value.runtime.start();
    value.observeResources.mockResolvedValue(resources(1));
    await expect(value.runtime.request('process/spawn', { processId: 'new' })).rejects.toMatchObject({ code: 'CODEX_RESOURCE_LIMIT' });
    await expect(value.runtime.request('process/kill', { processId: 'existing' })).resolves.toEqual({});
    await expect(value.runtime.request('command/exec/terminate', { processId: 'existing' })).resolves.toEqual({});
    expect(value.clients[0].calls.filter(call => call.method === 'process/spawn')).toEqual([]);
  });
});

describe('official CLI startup lifecycle', () => {
  it('installs once per service start, passes the real launch contract, and never resumes or requests models implicitly', async () => {
    const first = fixture(), second = fixture();
    const begun = first.runtime.start(); expect(first.runtime.start()).toBe(begun);
    await begun; await second.runtime.start();
    for (const value of [first, second]) {
      expect(value.installer.start).toHaveBeenCalledTimes(1); expect(value.clients[0].starts).toBe(1);
      expect(value.clients[0].calls.map(call => call.method)).toEqual(['experimentalFeature/list']);
      expect(value.clientFactory).toHaveBeenCalledWith({ executable: value.initial.executablePath, ...(await value.prepareLaunch.mock.results[0].value) });
      expect(value.migratePreferences).toHaveBeenCalledWith(value.ctx, value.clients[0]);
      expect(value.runtime.status()).toMatchObject({ state: 'ready', version: '0.155.1', activeTurns: 0, canUpdate: true });
    }
  });
  it('publishes only capabilities supported by installed metadata and all actual feature pages', async () => {
    const installed = release('limited'); installed.methods = installed.methods.filter(method => !['thread/revert', 'thread/queue/delete'].includes(method));
    const value = fixture({ release: installed }), client = new NativeClient(); value.queued.push(client);
    client.handlers.set('experimentalFeature/list', params => params.cursor
      ? { data: [{ name: 'goals', enabled: false }], nextCursor: null }
      : { data: [{ name: 'other', enabled: true }], nextCursor: 'native-feature-page' });
    await value.runtime.start();
    expect(value.runtime.status().capabilities).toEqual({ conversations: true, pagination: true, queue: false, goals: false,
      skills: true, plan: true, review: true, historyRevert: false });
    expect(client.calls[1].params.cursor).toBe('native-feature-page');
    expect(client.calls.some(call => /resume|turn\/start|model\/list|\/models/.test(call.method))).toBe(false);
  });
  it('does not call absent optional metadata methods or start an unsupported core protocol', async () => {
    const limited = release('without-features'); limited.methods = limited.methods.filter(method => method !== 'experimentalFeature/list');
    const first = fixture({ release: limited }); await first.runtime.start(); expect(first.clients[0].calls).toEqual([]);
    const unsupported = release('without-turns'); unsupported.methods = unsupported.methods.filter(method => method !== 'turn/start');
    const second = fixture({ release: unsupported }); await second.runtime.start();
    expect(second.runtime.status().state).toBe('error'); expect(second.clients).toHaveLength(0);
  });
  it('requires effective native managed requirements before production readiness', async () => {
    const value = fixture(); value.ctx.config.production = true; value.ctx.config.requirePersistentData = true;
    await value.runtime.start();
    expect(value.clients[0].calls[0].method).toBe('configRequirements/read');
    expect(value.runtime.status().state).toBe('ready');
    const denied = fixture(); denied.ctx.config.production = true; denied.ctx.config.requirePersistentData = true;
    const client = new NativeClient(); client.handlers.set('configRequirements/read', () => ({ requirements: null })); denied.queued.push(client);
    await denied.runtime.start();
    expect(denied.runtime.status()).toMatchObject({ state: 'error', capabilities: { conversations: false } });
    expect(denied.runtime.status().error).toMatch(/managed host policy/);
    expect(denied.migratePreferences).not.toHaveBeenCalled(); expect(client.running).toBe(false);
  });
  it('keeps migration failure visible without rolling back potentially committed native preferences', async () => {
    const value = fixture(); value.migratePreferences.mockRejectedValue(new HttpError(409, 'Native publication needs review.', 'CODEX_SETTINGS_OUTCOME_UNKNOWN'));
    await value.runtime.start();
    expect(value.runtime.status()).toMatchObject({ state: 'error', error: 'Native publication needs review.' });
    expect(value.clients[0].running).toBe(false); expect(value.clients).toHaveLength(1);
    expect(value.clients[0].calls.map(call => call.method)).toEqual(['experimentalFeature/list']);
  });
  it.each(['prepare', 'resources', 'initialize', 'migration'] as const)('drains shutdown during %s without a later process or ready event', async stage => {
    const value = fixture(), gate = deferred<any>(), entered = deferred(), connections: string[] = [];
    value.runtime.onConnection(state => connections.push(state));
    if (stage === 'prepare') value.prepareLaunch.mockImplementation(async () => { entered.resolve(); return gate.promise; });
    if (stage === 'resources') value.observeResources.mockImplementation(async () => { entered.resolve(); return gate.promise; });
    if (stage === 'initialize') { const client = new NativeClient(); client.onStart = async () => { entered.resolve(); await gate.promise; }; value.queued.push(client); }
    if (stage === 'migration') value.migratePreferences.mockImplementation(async () => { entered.resolve(); await gate.promise; });
    const starting = value.runtime.start(); await entered.promise;
    const closing = value.runtime.close();
    gate.resolve(stage === 'resources' ? resources() : { codexHomeDir: '/tmp/unused', cwd: '/tmp', args: [], env: {} });
    await Promise.all([starting, closing]);
    expect(value.runtime.status().state).toBe('stopped'); expect(connections).not.toContain('ready');
    expect(value.clients.every(client => !client.running)).toBe(true);
    if (stage !== 'migration' && stage !== 'initialize') expect(value.clients).toHaveLength(0);
  });
  it('does not begin a deferred startup after shutdown and contains reentrant/async status observers', async () => {
    const value = fixture();
    value.ctx.events.on('codex:status', async () => { throw new Error('Observer failure'); });
    const starting = value.runtime.start(), closing = value.runtime.close();
    expect(value.runtime.close()).toBe(closing); await Promise.all([starting, closing]);
    await value.runtime.start(); expect(value.installer.start).not.toHaveBeenCalled(); expect(value.clients).toHaveLength(0);
    const reentrant = fixture(); reentrant.ctx.events.once('codex:status', () => { void reentrant.runtime.close(); });
    await reentrant.runtime.start(); await reentrant.runtime.close(); expect(reentrant.runtime.status().state).toBe('stopped');
  });
});

describe('native callback and activity accounting', () => {
  it('keeps exact numeric/string/empty IDs busy through response until native resolution and rejects stale generations', async () => {
    const value = fixture(); await value.runtime.start(); const client = value.clients[0];
    value.runtime.onRequest(() => {});
    for (const id of [0, '0', '']) client.callback(id);
    value.runtime.respond(0, { decision: 'accept' }, client.generation);
    expect(value.runtime.status().canUpdate).toBe(false);
    expect(() => value.runtime.respond(0, {}, client.generation)).toThrow(expect.objectContaining({ code: 'CODEX_REQUEST_STALE' }));
    expect(() => value.runtime.respond('0', {}, 'previous-generation')).toThrow(expect.objectContaining({ code: 'CODEX_REQUEST_STALE' }));
    client.notification('serverRequest/resolved', { threadId: THREAD, requestId: 0 });
    expect(value.runtime.status().canUpdate).toBe(false);
    value.runtime.rejectRequest('0', 'Declined.', client.generation); value.runtime.rejectRequest('0', 'Declined.', client.generation);
    expect(client.rejections).toEqual(['0']); expect(value.runtime.status().canUpdate).toBe(false);
    client.notification('serverRequest/resolved', { threadId: THREAD, requestId: '0' });
    value.runtime.respond('', {}, client.generation); client.notification('serverRequest/resolved', { threadId: THREAD, requestId: '' });
    expect(value.runtime.status().canUpdate).toBe(true);
    expect(client.responses.map(item => item.id)).toEqual([0, '']);
  });
  it('answers clock metadata without a human prompt but still waits for native resolution', async () => {
    const value = fixture(); await value.runtime.start(); const client = value.clients[0], request = vi.fn();
    value.runtime.onRequest(request); client.callback('clock', 'currentTime/read');
    expect(request).not.toHaveBeenCalled(); expect(client.responses[0]).toMatchObject({ id: 'clock', result: { currentTimeAt: expect.any(Number) } });
    expect(value.runtime.status().canUpdate).toBe(false);
    client.notification('serverRequest/resolved', { threadId: THREAD, requestId: 'clock' }); expect(value.runtime.status().canUpdate).toBe(true);
  });
  it('does not duplicate a callback whose write outcome is unknown or whose observer fails after resolution', async () => {
    const value = fixture(); await value.runtime.start(); const client = value.clients[0]; value.runtime.onRequest(() => {});
    client.callback('unknown'); client.onRespond = () => { throw new HttpError(503, 'Unknown write outcome.', 'CODEX_CONNECTION_LOST'); };
    expect(() => value.runtime.respond('unknown', {}, client.generation)).toThrow();
    value.runtime.rejectRequest('unknown', 'No duplicate.', client.generation);
    expect(client.responses).toHaveLength(1); expect(client.rejections).toHaveLength(0);
    client.notification('serverRequest/resolved', { threadId: THREAD, requestId: 'unknown' }); client.onRespond = undefined;
    const late = deferred(); value.runtime.onRequest(async () => { await late.promise; throw new Error('Late observer failure'); });
    client.callback('later'); client.notification('serverRequest/resolved', { threadId: THREAD, requestId: 'later' });
    late.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(client.rejections).toHaveLength(0); expect(client.running).toBe(true);
  });
  it('rejects unsupported callbacks once and keeps them accounted until the real resolved event', async () => {
    const value = fixture(); await value.runtime.start(); const client = value.clients[0]; client.callback('unsupported', 'unsupported/callback');
    expect(client.rejections).toEqual(['unsupported']); expect(value.runtime.status().canUpdate).toBe(false);
    client.notification('serverRequest/resolved', { threadId: THREAD, requestId: 'unsupported' });
    expect(value.runtime.status().canUpdate).toBe(true);
  });
  it('does not resurrect a completed turn from an earlier in-progress acknowledgment', async () => {
    const value = fixture(); await value.runtime.start(); const client = value.clients[0];
    client.handlers.set('turn/start', () => {
      client.notification('turn/started', { threadId: THREAD, turn: { id: 'turn-one', status: 'inProgress' } });
      client.notification('turn/completed', { threadId: THREAD, turn: { id: 'turn-one', status: 'completed' } });
      return { turn: { id: 'turn-one', status: 'inProgress' } };
    });
    await value.runtime.request('turn/start', { threadId: THREAD }); expect(value.runtime.status().activeTurns).toBe(0);
    expect(value.runtime.status().canUpdate).toBe(true);
  });
  it('bounds unresolved callbacks before forwarding more native requests', async () => {
    const value = fixture(); await value.runtime.start(); const client = value.clients[0];
    const observer = vi.fn(); value.runtime.onRequest(observer);
    for (let index = 0; index < 129; index++) client.callback(index);
    await vi.waitFor(() => expect(client.running).toBe(false));
    expect(observer).toHaveBeenCalledTimes(128); expect(client.aborts).toHaveLength(1);
    expect(value.runtime.status().error).toMatch(/excessive unresolved/);
  });
});

describe('explicit update admission and release recovery', () => {
  it('restarts the verified installed release with fresh launch configuration and no installer or thread replay', async () => {
    const value = fixture(); await value.runtime.start();
    const original = value.clients[0], generation = value.runtime.generation();
    original.loaded = [THREAD];
    expect(await value.runtime.restart()).toMatchObject({ state: 'updating', canUpdate: false });
    await settledUpdate(value.runtime);
    expect(value.runtime.status()).toMatchObject({ state: 'ready', version: value.initial.version, error: null });
    expect(value.runtime.generation()).not.toBe(generation);
    expect(original.closes).toBe(1); expect(value.clients).toHaveLength(2);
    expect(value.installer.start).toHaveBeenCalledOnce(); expect(value.installer.updateLatest).not.toHaveBeenCalled();
    expect(value.prepareLaunch).toHaveBeenCalledTimes(2);
    expect(value.clientFactory).toHaveBeenNthCalledWith(2, expect.objectContaining({ executable: value.initial.executablePath }));
    expect(value.clients.flatMap(client => client.calls).some(call => ['thread/resume', 'turn/start', 'thread/queue/start'].includes(call.method))).toBe(false);
  });
  it.each(['active', 'callback'] as const)('refuses restart with %s without closing the native process', async kind => {
    const value = fixture(); await value.runtime.start(); const client = value.clients[0];
    if (kind === 'active') client.notification('turn/started', { threadId: THREAD });
    else { value.runtime.onRequest(() => {}); client.callback('unanswered-native-approval'); }
    await expect(value.runtime.restart()).rejects.toMatchObject({ code: 'CODEX_BUSY' });
    expect(client.closes).toBe(0); expect(value.installer.updateLatest).not.toHaveBeenCalled();
  });
  it.each(['queue', 'goal', 'background'] as const)('preserves native %s work discovered during a restart check', async kind => {
    const value = fixture(); await value.runtime.start(); const client = value.clients[0]; client.loaded = [THREAD];
    if (kind === 'queue') client.handlers.set('thread/queue/list', () => ({ data: [{ id: 'actual-queued-input' }], nextCursor: null }));
    if (kind === 'goal') client.handlers.set('thread/goal/get', () => ({ goal: { threadId: THREAD, status: 'active' } }));
    if (kind === 'background') client.handlers.set('thread/backgroundTerminals/list', () => ({ data: [{ processId: 'actual-command' }], nextCursor: null }));
    await expect(value.runtime.restart()).rejects.toMatchObject({ status: 409, code: 'CODEX_BUSY' });
    expect(value.runtime.status()).toMatchObject({ state: 'ready', error: null });
    expect(client.closes).toBe(0); expect(value.clients).toHaveLength(1); expect(value.installer.updateLatest).not.toHaveBeenCalled();
  });
  it.each(['restart', 'updateLatest'] as const)('keeps conversations usable after %s refuses background terminals and admits a later retry', async action => {
    const value = fixture(); await value.runtime.start(); const client = value.clients[0], before = value.runtime.status();
    const generation = value.runtime.generation(), states: string[] = [];
    value.ctx.events.on('codex:status', status => states.push(status.state));
    client.loaded = [THREAD]; let backgroundRunning = true;
    client.handlers.set('thread/backgroundTerminals/list', () => ({ data: backgroundRunning ? [{ processId: 'user-server' }] : [], nextCursor: null }));
    await expect(value.runtime[action]()).rejects.toMatchObject({ status: 409, code: 'CODEX_BUSY',
      message: expect.stringMatching(/background terminals.*restarting or updating.*continue conversations/) });
    expect(states.length).toBeGreaterThan(0); expect(states.every(state => state === 'ready')).toBe(true);
    expect(value.runtime.status()).toMatchObject({ state: 'ready', error: null, canUpdate: true, updateBlockedReason: null,
      startedAt: before.startedAt, version: before.version, capabilities: before.capabilities });
    expect(value.runtime.generation()).toBe(generation);
    expect(client.closes).toBe(0); expect(client.aborts).toEqual([]); expect(value.installer.updateLatest).not.toHaveBeenCalled();
    await expect(value.runtime.request('thread/read', { threadId: THREAD })).resolves.toMatchObject({ thread: { id: THREAD } });
    await expect(value.runtime.request('turn/start', { threadId: THREAD })).resolves.toMatchObject({ turn: { status: 'inProgress' } });
    client.notification('turn/completed', { threadId: THREAD });
    backgroundRunning = false;
    expect(await value.runtime[action]()).toMatchObject({ state: 'updating', canUpdate: false });
    await settledUpdate(value.runtime);
    expect(value.runtime.status()).toMatchObject({ state: 'ready', error: null, canUpdate: true,
      version: action === 'restart' ? value.initial.version : value.candidate.version });
    expect(value.runtime.generation()).not.toBe(generation); expect(client.closes).toBe(1); expect(value.clients).toHaveLength(2);
    expect(value.clients.flatMap(native => native.calls).some(call => /thread\/resume|backgroundTerminals\/(?:clean|terminate)|process\/kill/.test(call.method))).toBe(false);
  });
  it('shares pending admission across restart and update while fencing mutations and preserving metadata reads', async () => {
    const value = fixture(); await value.runtime.start(); const client = value.clients[0]; client.loaded = [THREAD];
    const gate = deferred<{ data: unknown[]; nextCursor: null }>(), entered = deferred(); let resolved = 0;
    client.handlers.set('thread/backgroundTerminals/list', async () => { entered.resolve(); return gate.promise; });
    const restarting = value.runtime.restart().finally(() => resolved++);
    const updating = value.runtime.updateLatest().finally(() => resolved++);
    const results = Promise.allSettled([restarting, updating]);
    expect(value.runtime.status()).toMatchObject({ state: 'ready', error: null, canUpdate: false,
      updateBlockedReason: 'Checking whether Codex can restart or update safely.' });
    await entered.promise; expect(resolved).toBe(0);
    await expect(value.runtime.request('turn/start', { threadId: THREAD })).rejects.toMatchObject({ code: 'CODEX_UPDATING' });
    expect(() => value.runtime.acquireActivity(value.runtime.generation()!)).toThrow(expect.objectContaining({ code: 'CODEX_BUSY' }));
    await expect(value.runtime.request('thread/list', {})).resolves.toEqual({ data: [], nextCursor: null });
    gate.resolve({ data: [{ processId: 'user-server' }], nextCursor: null });
    expect(await results).toEqual([
      { status: 'rejected', reason: expect.objectContaining({ code: 'CODEX_BUSY' }) },
      { status: 'rejected', reason: expect.objectContaining({ code: 'CODEX_BUSY' }) },
    ]);
    expect(client.calls.filter(call => call.method === 'thread/backgroundTerminals/list')).toHaveLength(1);
    expect(value.runtime.status()).toMatchObject({ state: 'ready', error: null, canUpdate: true, updateBlockedReason: null });
    expect(client.closes).toBe(0); expect(value.installer.updateLatest).not.toHaveBeenCalled();
    await expect(value.runtime.request('turn/start', { threadId: THREAD })).resolves.toMatchObject({ turn: { status: 'inProgress' } });
  });
  it('reports a native process exit during admission instead of restoring a false ready state', async () => {
    const value = fixture(); await value.runtime.start(); const client = value.clients[0], gate = deferred(), entered = deferred();
    client.handlers.set('thread/loaded/list', async () => { entered.resolve(); await gate.promise; return { data: [], nextCursor: null }; });
    const restarting = expect(value.runtime.restart()).rejects.toMatchObject({ code: 'CODEX_CONNECTION_CHANGED' });
    await entered.promise; client.exit(true); gate.resolve(); await restarting;
    expect(value.runtime.status()).toMatchObject({ state: 'error', error: 'Fixture native process exited.', capabilities: { conversations: false } });
    expect(value.runtime.generation()).toBeNull(); expect(value.clients).toHaveLength(1);
  });
  it('finishes shutdown during admission without launching a replacement or treating refusal as a shutdown failure', async () => {
    const value = fixture(); await value.runtime.start(); const client = value.clients[0], gate = deferred(), entered = deferred();
    client.handlers.set('thread/loaded/list', async () => { entered.resolve(); await gate.promise; return { data: [], nextCursor: null }; });
    const restarting = expect(value.runtime.restart()).rejects.toMatchObject({ code: 'CODEX_UNAVAILABLE' });
    await entered.promise; const closing = value.runtime.close(); gate.resolve(); await restarting; await closing;
    expect(value.runtime.status()).toMatchObject({ state: 'stopped', error: null });
    expect(value.clients).toHaveLength(1); expect(value.installer.updateLatest).not.toHaveBeenCalled();
  });
  it.each(['restart', 'updateLatest'] as const)('rechecks background work admitted natively after %s admission', async action => {
    const value = fixture(); await value.runtime.start(); const client = value.clients[0], generation = value.runtime.generation();
    client.loaded = [THREAD]; const gate = deferred(), entered = deferred(), launch = await value.prepareLaunch.mock.results[0].value;
    value.prepareLaunch.mockImplementationOnce(async () => { entered.resolve(); await gate.promise; return launch; });
    expect(await value.runtime[action]()).toMatchObject({ state: 'updating' }); await entered.promise;
    client.handlers.set('thread/backgroundTerminals/list', () => ({ data: [{ processId: 'later-user-server' }], nextCursor: null }));
    gate.resolve(); await settledUpdate(value.runtime);
    expect(value.runtime.status()).toMatchObject({ state: 'ready', version: value.initial.version, error: expect.stringContaining('background terminals') });
    expect(value.runtime.generation()).toBe(generation); expect(client.closes).toBe(0); expect(value.clients).toHaveLength(1);
    await expect(value.runtime.request('turn/start', { threadId: THREAD })).resolves.toMatchObject({ turn: { status: 'inProgress' } });
  });
  it('keeps an actual restart startup failure visible after the old process was stopped', async () => {
    const value = fixture(); await value.runtime.start(); const candidate = new NativeClient();
    candidate.onStart = async () => { throw new HttpError(503, 'Native startup failed.', 'CODEX_START_FAILED'); }; value.queued.push(candidate);
    expect(await value.runtime.restart()).toMatchObject({ state: 'updating' }); await settledUpdate(value.runtime);
    expect(value.runtime.status()).toMatchObject({ state: 'error', error: 'Native startup failed.', capabilities: { conversations: false } });
    expect(value.clients).toHaveLength(2); expect(value.clients.every(client => !client.running)).toBe(true);
    await expect(value.runtime.request('turn/start', { threadId: THREAD })).rejects.toMatchObject({ code: 'CODEX_UNAVAILABLE' });
  });
  it('keeps update blocked after an unconfirmed native close until current-connection drain confirmation', async () => {
    const value = fixture(); await value.runtime.start(); const client = value.clients[0];
    client.exit(false);
    expect(value.runtime.generation()).toBeNull(); expect(value.runtime.status()).toMatchObject({ state: 'error', canUpdate: false });
    await expect(value.runtime.updateLatest()).rejects.toMatchObject({ code: 'CODEX_BUSY' });
    expect(value.installer.updateLatest).not.toHaveBeenCalled(); expect(value.clientFactory).toHaveBeenCalledTimes(1);
    // A repeated close without cleanup evidence cannot clear known uncertainty.
    client.exit(); expect(value.runtime.status().canUpdate).toBe(false);
    await expect(value.runtime.updateLatest()).rejects.toMatchObject({ code: 'CODEX_BUSY' });
    expect(value.installer.updateLatest).not.toHaveBeenCalled(); expect(value.clients).toHaveLength(1);
    client.exit(true); expect(value.runtime.status().canUpdate).toBe(true);
    expect(value.installer.updateLatest).not.toHaveBeenCalled(); expect(value.clients).toHaveLength(1);
  });
  it.each(['active', 'callback', 'mutation'] as const)('refuses update during %s before installing', async kind => {
    const value = fixture(); await value.runtime.start(); const client = value.clients[0]; let request: Promise<unknown> | undefined;
    if (kind === 'active') client.notification('turn/started', { threadId: THREAD });
    if (kind === 'callback') { value.runtime.onRequest(() => {}); client.callback('pending'); }
    if (kind === 'mutation') {
      const gate = deferred(), entered = deferred();
      value.readLaunchRuleSnapshot.mockImplementation(async () => { entered.resolve(); await gate.promise; return { fingerprint: 'policy-one', files: [] }; });
      request = value.runtime.request('turn/start', { threadId: THREAD }); void request.catch(() => undefined); await entered.promise;
    }
    await expect(value.runtime.updateLatest()).rejects.toMatchObject({ code: 'CODEX_BUSY' });
    expect(value.installer.updateLatest).not.toHaveBeenCalled(); expect(client.closes).toBe(0);
  });
  it.each(['active', 'queue', 'goal', 'background', 'queue-cursor', 'malformed-background'] as const)('refuses authoritative loaded %s work without stopping the current process', async kind => {
    const value = fixture(); await value.runtime.start(); const client = value.clients[0]; client.loaded = [THREAD];
    if (kind === 'active') client.handlers.set('thread/read', () => ({ thread: { id: THREAD, status: { type: 'active', activeFlags: [] } } }));
    if (kind === 'queue') client.handlers.set('thread/queue/list', () => ({ data: [{ id: 'queued' }], nextCursor: null }));
    if (kind === 'queue-cursor') client.handlers.set('thread/queue/list', () => ({ data: [], nextCursor: 'uninspected' }));
    if (kind === 'goal') client.handlers.set('thread/goal/get', () => ({ goal: { threadId: THREAD, status: 'active' } }));
    if (kind === 'background') client.handlers.set('thread/backgroundTerminals/list', () => ({ data: [{ processId: 'native-process' }], nextCursor: null }));
    if (kind === 'malformed-background') client.handlers.set('thread/backgroundTerminals/list', () => ({}));
    await expect(value.runtime.updateLatest()).rejects.toMatchObject({ code: 'CODEX_BUSY' });
    expect(value.installer.updateLatest).not.toHaveBeenCalled(); expect(client.closes).toBe(0); expect(client.running).toBe(true);
    expect(value.runtime.status()).toMatchObject({ state: 'ready', version: value.initial.version, error: null });
  });
  it('inspects later loaded pages and refuses a changed or cyclic native listing', async () => {
    const value = fixture(); await value.runtime.start(); const client = value.clients[0];
    client.handlers.set('thread/loaded/list', params => params.cursor ? { data: [SECOND], nextCursor: null } : { data: [THREAD], nextCursor: 'page-two' });
    client.handlers.set('thread/read', params => ({ thread: { id: params.threadId, status: { type: params.threadId === SECOND ? 'active' : 'idle' } } }));
    await expect(value.runtime.updateLatest()).rejects.toMatchObject({ code: 'CODEX_BUSY' });
    expect(client.calls.some(call => call.method === 'thread/read' && call.params.threadId === SECOND)).toBe(true);
    expect(value.installer.updateLatest).not.toHaveBeenCalled();
    client.handlers.set('thread/loaded/list', () => ({ data: [], nextCursor: 'same-page' }));
    await expect(value.runtime.updateLatest()).rejects.toMatchObject({ code: 'CODEX_PROTOCOL_ERROR', message: expect.stringMatching(/bounded pages/) });
    expect(value.installer.updateLatest).not.toHaveBeenCalled(); expect(value.runtime.status()).toMatchObject({ state: 'ready', error: null });
  });
  it('rechecks loaded membership before admitting installation', async () => {
    const value = fixture(); await value.runtime.start(); const client = value.clients[0]; let reads = 0;
    client.handlers.set('thread/loaded/list', () => ({ data: ++reads === 1 ? [] : [THREAD], nextCursor: null }));
    await expect(value.runtime.updateLatest()).rejects.toMatchObject({ code: 'CODEX_BUSY' });
    expect(value.installer.updateLatest).not.toHaveBeenCalled(); expect(client.closes).toBe(0);
  });
  it('blocks new native mutations for the entire update while allowing metadata reads and sharing one install', async () => {
    const value = fixture(); await value.runtime.start(); const old = value.clients[0], gate = deferred<InstalledCodexCli>(), entered = deferred();
    value.installer.updateLatest.mockImplementation(async () => { entered.resolve(); return gate.promise; });
    expect((await value.runtime.updateLatest()).state).toBe('updating'); await entered.promise;
    await value.runtime.updateLatest();
    await expect(value.runtime.request('turn/start', { threadId: THREAD })).rejects.toMatchObject({ code: 'CODEX_UPDATING' });
    await expect(value.runtime.request('config/batchWrite', {})).rejects.toMatchObject({ code: 'CODEX_UPDATING' });
    await value.runtime.request('thread/list', {});
    gate.resolve(value.candidate); await settledUpdate(value.runtime);
    expect(value.installer.updateLatest).toHaveBeenCalledTimes(1); expect(old.running).toBe(false);
    expect(value.runtime.status().version).toBe(value.candidate.version);
    expect(value.clients.flatMap(client => client.calls).some(call => ['thread/resume', 'turn/start', 'model/list'].includes(call.method))).toBe(false);
  });
  it('keeps the running release when installation fails and when candidate preflight is unsupported', async () => {
    const value = fixture(); await value.runtime.start(); const client = value.clients[0];
    value.installer.updateLatest.mockRejectedValueOnce(new Error('Private installer diagnostics'));
    await value.runtime.updateLatest(); await settledUpdate(value.runtime);
    expect(value.runtime.status()).toMatchObject({ state: 'ready', version: value.initial.version });
    expect(value.runtime.status().error).not.toContain('Private installer'); expect(client.closes).toBe(0);
    const unsupported = release('bad-candidate'); unsupported.methods = [];
    value.installer.updateLatest.mockResolvedValueOnce(unsupported);
    await value.runtime.updateLatest(); await settledUpdate(value.runtime);
    expect(client.running).toBe(true); expect(client.closes).toBe(0); expect(value.clients).toHaveLength(1);
  });
  it('rechecks work admitted natively during installation before replacing the old process', async () => {
    const value = fixture(); await value.runtime.start(); const client = value.clients[0], gate = deferred<InstalledCodexCli>(), entered = deferred();
    value.installer.updateLatest.mockImplementation(async () => { entered.resolve(); return gate.promise; });
    await value.runtime.updateLatest(); await entered.promise;
    client.notification('turn/started', { threadId: THREAD }); gate.resolve(value.candidate); await settledUpdate(value.runtime);
    expect(client.running).toBe(true); expect(client.closes).toBe(0); expect(value.clients).toHaveLength(1);
    expect(value.runtime.status().activeTurns).toBe(1);
  });
  it('restarts the prior release only after a confirmed never-spawned candidate, without resuming threads', async () => {
    const value = fixture(); await value.runtime.start(); const candidate = new NativeClient(); candidate.spawn = false;
    candidate.onStart = async () => { throw new HttpError(503, 'Candidate could not spawn.', 'CODEX_START_FAILED'); }; value.queued.push(candidate);
    await value.runtime.updateLatest(); await settledUpdate(value.runtime);
    expect(value.clients).toHaveLength(3); expect(value.runtime.status()).toMatchObject({ state: 'ready', version: value.initial.version });
    expect(value.runtime.status().error).toMatch(/previous.*restarted.*without resuming/i);
    expect(value.clients.flatMap(client => client.calls).some(call => /resume|turn\/start/.test(call.method))).toBe(false);
  });
  it('does not downgrade after a spawned candidate or a migration acknowledgment becomes uncertain', async () => {
    const value = fixture(); await value.runtime.start();
    value.migratePreferences.mockRejectedValueOnce(new HttpError(409, 'Native settings outcome is unknown.', 'CODEX_SETTINGS_OUTCOME_UNKNOWN'));
    await value.runtime.updateLatest(); await settledUpdate(value.runtime);
    expect(value.clients).toHaveLength(2); expect(value.clients.every(client => !client.running)).toBe(true);
    expect(value.runtime.status()).toMatchObject({ state: 'error', error: 'Native settings outcome is unknown.' });
  });
  it('ignores old-generation notifications without clearing the replacement turn or callback', async () => {
    const value = fixture(); await value.runtime.start(); const old = value.clients[0];
    await value.runtime.updateLatest(); await settledUpdate(value.runtime); const current = value.clients[1];
    value.runtime.onRequest(() => {}); current.callback('pending');
    await value.runtime.request('turn/start', { threadId: THREAD });
    old.notification('turn/completed', { threadId: THREAD });
    old.notification('serverRequest/resolved', { threadId: THREAD, requestId: 'pending' });
    old.emit('closed', { expected: false, message: 'Late old process exit.' });
    expect(value.runtime.status()).toMatchObject({ state: 'ready', version: value.candidate.version, activeTurns: 1, canUpdate: false });
    expect(() => value.runtime.respond('pending', {}, old.generation)).toThrow(expect.objectContaining({ code: 'CODEX_REQUEST_STALE' }));
    value.runtime.respond('pending', {}, current.generation); expect(current.responses).toHaveLength(1);
  });
  it('does not restart the same installed release, or launch a candidate after shutdown during installation', async () => {
    const value = fixture(); await value.runtime.start(); value.installer.updateLatest.mockResolvedValueOnce(value.initial);
    await value.runtime.updateLatest(); await settledUpdate(value.runtime); expect(value.clients).toHaveLength(1); expect(value.clients[0].closes).toBe(0);
    const gate = deferred<InstalledCodexCli>(), entered = deferred();
    value.installer.updateLatest.mockImplementation(async () => { entered.resolve(); return gate.promise; });
    await value.runtime.updateLatest(); await entered.promise;
    const closing = value.runtime.close(); gate.resolve(value.candidate); await closing;
    expect(value.runtime.status().state).toBe('stopped'); expect(value.clients).toHaveLength(1);
  });
});

describe('native metadata and host supervision', () => {
  it('requires fresh headroom before creating a native app-server', async () => {
    const value = fixture(); value.observeResources.mockImplementation(async () => resources(2_100_000_000));
    await value.runtime.start();
    expect(value.runtime.status()).toMatchObject({ state: 'error', capabilities: { conversations: false } });
    expect(value.runtime.status().error).toMatch(/memory headroom/); expect(value.clientFactory).not.toHaveBeenCalled();
  });
  it('keeps literal wire IDs and hidden Red options, never invents an absent Cyber row, and returns immutable views', async () => {
    const value = fixture(); await value.runtime.start(); const client = value.clients[0];
    client.handlers.set('model/list', params => params.cursor ? { data: [model('gpt-5.5', { displayName: 'Retired' }), model('old-pro', { displayName: 'Pro old' })], nextCursor: null }
      : { data: [model('gpt-daybreak-red-latest', { id: 'native-red-catalog-id', displayName: 'Team Red', hidden: true,
        defaultReasoningEffort: 'xhigh', supportedReasoningEfforts: [{ reasoningEffort: 'xhigh', description: 'Native advertised value' }] })], nextCursor: 'catalog-next' });
    const first = await value.runtime.models();
    expect(first.models).toEqual(['gpt-daybreak-red-latest']); expect(first.catalog[0]).toMatchObject({ id: 'native-red-catalog-id',
      model: 'gpt-daybreak-red-latest', hidden: true, defaultReasoningEffort: 'xhigh', supportedReasoningEfforts: [{ reasoningEffort: 'xhigh', description: 'Native advertised value' }] });
    expect(first.models).not.toContain('gpt-5.6-cyber');
    expect(client.calls.filter(call => call.method === 'model/list').every(call => call.params.includeHidden === true)).toBe(true);
    first.catalog[0].model = 'changed-by-caller'; expect((await value.runtime.models()).catalog[0].model).toBe('gpt-daybreak-red-latest');
  });
  it('exposes latest native models with bundled capacity, separate published maxima, and advertised Fast metadata', async () => {
    const readModelMetadata = vi.fn(async () => new Map([
      ['gpt-6-sol', { contextWindow: 272_000, maximumContextWindow: 872_000, effectiveContextWindowPercent: 95,
        contextWindowSource: 'native-bundled' as const, officialMaximumContextWindow: 1_050_000,
        serviceTiers: [{ id: 'priority', name: 'Fast', description: 'Native tier' }], defaultServiceTier: 'priority' }],
    ]));
    const value = fixture({ options: { readModelMetadata } }); await value.runtime.start();
    value.clients[0].handlers.set('model/list', () => ({ data: [model('gpt-6-sol'), model('custom-capacity-unknown'),
      model('future-native-model', { contextWindow: 120_000, maxContextWindow: 240_000,
        serviceTiers: [{ id: 'priority', name: 'Fast', description: 'Advertised tier' }], defaultServiceTier: 'default' })], nextCursor: null }));
    const response = await value.runtime.models();
    expect(response.models).toContain('gpt-6-sol');
    expect(response.catalog[0]).toMatchObject({ maximumContextWindow: 872_000, officialMaximumContextWindow: 1_050_000,
      effectiveContextWindowPercent: 95, contextWindowSource: 'native-bundled', defaultServiceTier: 'priority' });
    expect(response.catalog[1].maximumContextWindow).toBeUndefined();
    expect(response.catalog[2]).toMatchObject({ contextWindow: 120_000, maximumContextWindow: 240_000,
      contextWindowSource: 'native', defaultServiceTier: 'default' });
    await value.runtime.models(); expect(readModelMetadata).toHaveBeenCalledOnce();
    expect(value.clients[0].calls.filter(call => call.method === 'model/list')).toHaveLength(1);
  });
  it('advances the loaded-thread configuration version only after an acknowledged native config write', async () => {
    const value = fixture(); await value.runtime.start(); const initial = value.runtime.configurationVersion();
    await value.runtime.request('config/read', {}); expect(value.runtime.configurationVersion()).toBe(initial);
    await value.runtime.request('config/batchWrite', { edits: [{ keyPath: 'agents.max_concurrent_threads_per_session', value: 12, mergeStrategy: 'replace' }] });
    const changed = value.runtime.configurationVersion(); expect(changed).not.toBe(initial);
    value.clients[0].handlers.set('config/batchWrite', () => { throw new HttpError(409, 'Native validation rejected the setting.', 'CODEX_RPC_REJECTED'); });
    await expect(value.runtime.request('config/batchWrite', { edits: [] })).rejects.toMatchObject({ code: 'CODEX_RPC_REJECTED' });
    expect(value.runtime.configurationVersion()).toBe(changed);
  });
  it('does not cache an old generation model response after replacement', async () => {
    const value = fixture(); await value.runtime.start(); const old = value.clients[0], gate = deferred<unknown>(), entered = deferred();
    old.handlers.set('model/list', async () => { entered.resolve(); return gate.promise; });
    const catalog = value.runtime.models(); void catalog.catch(() => undefined); await entered.promise;
    await value.runtime.updateLatest(); await settledUpdate(value.runtime);
    gate.resolve({ data: [model('old-generation')], nextCursor: null });
    await expect(catalog).rejects.toMatchObject({ code: 'CODEX_CONNECTION_CHANGED' });
    expect((await value.runtime.models()).models).toEqual(['gpt-5.6-luna']);
  });
  it('rejects incomplete metadata rather than claiming an empty or fully inspected catalog', async () => {
    const value = fixture(); await value.runtime.start(); const client = value.clients[0];
    client.handlers.set('model/list', () => ({ data: [model()], nextCursor: 'repeat' }));
    await expect(value.runtime.models()).rejects.toMatchObject({ code: 'CODEX_PROTOCOL_ERROR' });
    client.handlers.set('model/list', () => ({ data: [model('broken', { supportedReasoningEfforts: [{ reasoningEffort: '' }] })], nextCursor: null }));
    await expect(value.runtime.models()).rejects.toMatchObject({ code: 'CODEX_MODELS_INVALID' });
  });
  it('refuses new work without headroom but still permits an exact native interrupt', async () => {
    const value = fixture(); await value.runtime.start(); value.observeResources.mockImplementation(async () => resources(2_100_000_000));
    await expect(value.runtime.request('turn/start', { threadId: THREAD })).rejects.toMatchObject({ code: 'CODEX_RESOURCE_LIMIT' });
    await value.runtime.request('turn/interrupt', { threadId: THREAD, turnId: 'native-turn' });
    expect(value.clients[0].calls.at(-1)).toMatchObject({ method: 'turn/interrupt', params: { threadId: THREAD, turnId: 'native-turn' } });
    expect(value.clients[0].calls.some(call => call.method === 'turn/start')).toBe(false);
  });
  it('revalidates changed host rules and refuses a lost connection after admission awaits', async () => {
    const value = fixture(); await value.runtime.start();
    value.readLaunchRuleSnapshot.mockResolvedValue({ fingerprint: 'policy-two', files: [] });
    value.validateLaunchPolicy.mockResolvedValue({ fingerprint: 'policy-two', files: [] });
    await value.runtime.request('config/batchWrite', { edits: [] }); expect(value.validateLaunchPolicy).toHaveBeenCalledTimes(2);
    const gate = deferred<HostResourceSnapshot>(), entered = deferred();
    value.observeResources.mockImplementation(async () => { entered.resolve(); return gate.promise; });
    const request = value.runtime.request('turn/start', { threadId: THREAD }); void request.catch(() => undefined); await entered.promise;
    const closing = value.runtime.close(); gate.resolve(resources());
    await expect(request).rejects.toMatchObject({ code: 'CODEX_UNAVAILABLE' }); await closing;
    expect(value.clients[0].calls.some(call => call.method === 'turn/start')).toBe(false);
  });
  it('waits for in-flight pre-send policy work during shutdown without sending its native mutation', async () => {
    const value = fixture(); await value.runtime.start(); const gate = deferred(), entered = deferred();
    value.readLaunchRuleSnapshot.mockImplementation(async () => { entered.resolve(); await gate.promise; return { fingerprint: 'policy-one', files: [] }; });
    const request = value.runtime.request('turn/start', { threadId: THREAD }); void request.catch(() => undefined); await entered.promise;
    let closed = false; const closing = value.runtime.close().then(() => { closed = true; });
    await Promise.resolve(); await Promise.resolve(); expect(closed).toBe(false);
    gate.resolve(); await expect(request).rejects.toMatchObject({ code: 'CODEX_UNAVAILABLE' }); await closing;
    expect(closed).toBe(true); expect(value.clients[0].calls.some(call => call.method === 'turn/start')).toBe(false);
  });
  it('supervises only the current process and contains both observation and abort failures', async () => {
    vi.useFakeTimers(); const value = fixture(); await value.runtime.start(); const client = value.clients[0];
    value.observeResources.mockRejectedValue(new Error('Resource reader failed'));
    client.onAbort = async () => { throw new Error('Abort failed before fallback close'); };
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.aborts).toHaveLength(1); expect(client.running).toBe(false);
    expect(value.runtime.status()).toMatchObject({ state: 'error', capabilities: { conversations: false } });
    expect(value.runtime.status().error).toMatch(/resources could not be verified/);
    await vi.advanceTimersByTimeAsync(3000); expect(client.aborts).toHaveLength(1);
  });
  it('does not stop a replacement because an old resource observation finishes late', async () => {
    vi.useFakeTimers(); const value = fixture(); await value.runtime.start(); const old = value.clients[0], gate = deferred<HostResourceSnapshot>();
    value.observeResources.mockImplementationOnce(async () => gate.promise);
    await vi.advanceTimersByTimeAsync(1000); await value.runtime.updateLatest();
    await vi.waitFor(() => expect(value.runtime.status().version).toBe(value.candidate.version));
    gate.resolve(resources(1)); await Promise.resolve(); await Promise.resolve();
    expect(value.clients[1].running).toBe(true); expect(value.clients[1].aborts).toEqual([]); expect(old.aborts).toEqual([]);
  });
  it('reports unconfirmed safety shutdown and keeps updates blocked when native group drain fails', async () => {
    vi.useFakeTimers(); const value = fixture(); await value.runtime.start(); const client = value.clients[0];
    value.observeResources.mockImplementation(async () => resources(1));
    client.onAbort = async () => { throw new Error('Abort did not confirm ownership drain'); };
    client.onClose = async () => { throw new HttpError(503, 'Native group still unconfirmed.', 'CODEX_SHUTDOWN_INCOMPLETE'); };
    await vi.advanceTimersByTimeAsync(1000);
    expect(value.runtime.status()).toMatchObject({ state: 'error', canUpdate: false });
    expect(value.runtime.status().error).toMatch(/could not confirm shutdown/);
    await expect(value.runtime.updateLatest()).rejects.toMatchObject({ code: 'CODEX_BUSY' });
    await expect(value.runtime.close()).rejects.toMatchObject({ code: 'CODEX_SHUTDOWN_FAILED' });
  });
});

describe('native absence proof for fresh site workspaces', () => {
  async function diskFixture() { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-runtime-absence-')); directories.push(directory); return fixture({ dataDir: directory }); }
  it('proves an absent home without starting anything or reading native contents', async () => {
    const value = await diskFixture(); const read = vi.spyOn(fs, 'readFile');
    expect(await value.runtime.verifyNativeStateAbsent()).toBe(true);
    await fs.mkdir(path.join(value.ctx.config.dataDir, 'codex-workspace'));
    expect(await value.runtime.verifyNativeStateAbsent()).toBe(true);
    expect(value.installer.start).not.toHaveBeenCalled(); expect(value.clients).toHaveLength(0); expect(read).not.toHaveBeenCalled();
  });
  it('proves an empty canonical native directory created before CLI startup without reading content', async () => {
    const value = await diskFixture(), home = path.join(value.ctx.config.dataDir, 'codex-workspace/native-codex');
    await fs.mkdir(home, { recursive: true });
    const read = vi.spyOn(fs, 'readFile');
    expect(await value.runtime.verifyNativeStateAbsent()).toBe(true);
    expect(value.installer.start).not.toHaveBeenCalled(); expect(value.clients).toHaveLength(0); expect(read).not.toHaveBeenCalled();
  });
  it('refuses a non-directory native home or symlinked parent even if no thread bindings exist', async () => {
    const value = await diskFixture(), home = path.join(value.ctx.config.dataDir, 'codex-workspace/native-codex');
    await fs.mkdir(path.dirname(home), { recursive: true });
    await fs.writeFile(home, 'not a native database'); expect(await value.runtime.verifyNativeStateAbsent()).toBe(false);
    await fs.unlink(home); await fs.rmdir(path.dirname(home));
    const target = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-runtime-parent-')); directories.push(target);
    await fs.symlink(target, path.dirname(home)); expect(await value.runtime.verifyNativeStateAbsent()).toBe(false);
  });
  it.each(['state.sqlite', '.state.sqlite-wal', '.temporary', 'unrelated.txt', 'empty-child-directory'])('refuses any native directory entry: %s', async name => {
    const value = await diskFixture(), home = path.join(value.ctx.config.dataDir, 'codex-workspace/native-codex');
    await fs.mkdir(home, { recursive: true });
    if (name === 'empty-child-directory') await fs.mkdir(path.join(home, name));
    else await fs.writeFile(path.join(home, name), 'Never parsed by the absence proof.');
    const read = vi.spyOn(fs, 'readFile');
    expect(await value.runtime.verifyNativeStateAbsent()).toBe(false); expect(read).not.toHaveBeenCalled();
    expect(value.clients).toHaveLength(0);
  });
  it.each(['entry-created', 'directory-replaced', 'native-started'] as const)('refuses a stale empty-directory proof when %s after the real directory read', async change => {
    const value = await diskFixture(), home = path.join(value.ctx.config.dataDir, 'codex-workspace/native-codex');
    await fs.mkdir(home, { recursive: true });
    const original = fs.opendir.bind(fs), entered = deferred(), gate = deferred(); let held = false;
    vi.spyOn(fs, 'opendir').mockImplementation(async (filename, options) => {
      const directory = await original(filename, options), read = directory.read.bind(directory);
      vi.spyOn(directory, 'read').mockImplementation((async () => {
        const entry = await read();
        if (!held) { held = true; entered.resolve(); await gate.promise; }
        return entry;
      }) as typeof directory.read);
      return directory;
    });
    const proof = value.runtime.verifyNativeStateAbsent(); await entered.promise;
    if (change === 'entry-created') await fs.writeFile(path.join(home, 'state.sqlite'), 'No content inspection.');
    if (change === 'directory-replaced') { await fs.rename(home, `${home}-held`); await fs.mkdir(home); }
    if (change === 'native-started') await value.runtime.start();
    gate.resolve(); expect(await proof).toBe(false);
  });
  it('allows a never-native installation wait but refuses preparation, an ever-created client, and shutdown', async () => {
    const value = await diskFixture(), install = deferred<InstalledCodexCli>(), installing = deferred(), preparing = deferred(), prepared = deferred<any>();
    value.installer.start.mockImplementation(async () => { installing.resolve(); return install.promise; });
    value.prepareLaunch.mockImplementation(async () => { preparing.resolve(); return prepared.promise; });
    const started = value.runtime.start(); await installing.promise;
    expect(await value.runtime.verifyNativeStateAbsent()).toBe(true);
    install.resolve(value.initial); await preparing.promise; expect(await value.runtime.verifyNativeStateAbsent()).toBe(false);
    prepared.resolve({ codexHomeDir: '/tmp/native-absent-fixture', cwd: '/tmp', args: [], env: {} }); await started;
    expect(await value.runtime.verifyNativeStateAbsent()).toBe(false);
    await value.clients[0].close(); expect(await value.runtime.verifyNativeStateAbsent()).toBe(false);
    await value.runtime.close(); expect(await value.runtime.verifyNativeStateAbsent()).toBe(false);
  });
  it('rechecks lifecycle after an awaited absence read instead of granting a stale deletion proof', async () => {
    const value = await diskFixture(), original = fs.lstat.bind(fs), entered = deferred(), gate = deferred(); let held = false;
    vi.spyOn(fs, 'lstat').mockImplementation((async (filename: any, options: any) => {
      if (!held && String(filename).startsWith('/proc/self/fd/') && String(filename).endsWith('/codex-workspace')) {
        held = true; entered.resolve(); await gate.promise;
      }
      return original(filename, options);
    }) as typeof fs.lstat);
    const proof = value.runtime.verifyNativeStateAbsent(); await entered.promise;
    await value.runtime.start(); gate.resolve(); expect(await proof).toBe(false);
  });
});
