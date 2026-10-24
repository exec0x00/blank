import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'smol-toml';
import type { AppContext } from '../server/context';
import type { AppSettings } from '../shared/types';
import type { CodexModelCatalog, CodexRuntimeStatus } from '../shared/codex-cli';
import { loadConfig } from '../server/config';
import { JsonStore, SecretStore } from '../server/store';
import { readPreferences, saveSettingsPreferences, type NativePreferencesRpc } from '../server/settings';
import { checkNativeMcpServers, readNativeSettings, saveNativeSettings } from '../server/codex-cli/native-settings';
import { markMcpEnvironmentApplied, mcpEnvironmentStatus, protectedMcpShellFilters, readMcpEnvironmentForLaunch, redactMcpSecrets } from '../server/codex-cli/mcp-environment';
import { nativeThreadConfig, nativeTurnServiceTier, parseBundledModelMetadata, readBundledModelMetadata } from '../server/codex-cli/model-metadata';
import { CodexRpcClient } from '../server/codex-cli/rpc';

const bindings = vi.hoisted(() => ({ runtimes: new WeakMap<object, unknown>() }));
vi.mock('../server/codex-cli/runtime', () => ({ getCodexRuntime: (ctx: object) => {
  const runtime = bindings.runtimes.get(ctx); if (!runtime) throw new Error('Missing owned native-settings runtime.'); return runtime;
} }));
vi.mock('../server/model-registry', () => { throw new Error('Official settings must not use the retired custom registry.'); });

const capabilities = { conversations: true, pagination: true, queue: true, goals: true, skills: true, plan: true, review: true, historyRevert: true };
const catalog: CodexModelCatalog = { backend: 'codex-cli', connected: true, models: ['gpt-6-sol', 'gpt-daybreak-red-latest'], catalog: [
  { id: 'gpt-6-sol', model: 'gpt-6-sol', displayName: 'GPT-6 Sol', description: '', hidden: false,
    supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: '' }], defaultReasoningEffort: 'medium',
    inputModalities: ['text', 'image'], isDefault: true, contextWindow: 272_000, maximumContextWindow: 872_000,
    officialMaximumContextWindow: 1_050_000, contextWindowSource: 'native-bundled', serviceTiers: [{ id: 'priority', name: 'Fast', description: '' }] },
  { id: 'gpt-daybreak-red-latest', model: 'gpt-daybreak-red-latest', displayName: 'Daybreak red', description: '', hidden: false,
    supportedReasoningEfforts: [{ reasoningEffort: 'high', description: '' }], defaultReasoningEffort: 'high',
    inputModalities: ['text'], isDefault: false, contextWindow: 372_000, maximumContextWindow: 372_000, contextWindowSource: 'native-bundled' },
] };

type Table = Record<string, unknown>;
function edit(target: Table, keyPath: string, value: unknown): void {
  const keys = keyPath.split('.'); let at = target;
  for (const key of keys.slice(0, -1)) { at[key] ??= {}; at = at[key] as Table; }
  if (value === null) delete at[keys.at(-1)!]; else at[keys.at(-1)!] = structuredClone(value);
}

class SettingsRpc implements NativePreferencesRpc {
  user: Table = { model: 'gpt-6-sol', service_tier: 'fast' };
  calls: Array<{ method: string; params: unknown }> = [];
  revision = 1;
  mcpResult: unknown = { data: [], nextCursor: null };
  constructor(readonly filePath: string) {}
  generation() { return 'owned-settings-generation'; }
  supports(method: string) { return ['mcpServerStatus/list', 'config/mcpServer/reload'].includes(method); }
  status(): CodexRuntimeStatus { return { backend: 'codex-cli', state: 'ready', version: '0.156.1', installedVersion: '0.156.1',
    startedAt: null, updatedAt: new Date().toISOString(), canUpdate: true, updateBlockedReason: null, error: null, activeTurns: 0, capabilities }; }
  models = vi.fn(async () => structuredClone(catalog));
  async persist() { await fs.mkdir(path.dirname(this.filePath), { recursive: true }); await fs.writeFile(this.filePath, stringify(this.user)); }
  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    this.calls.push({ method, params: structuredClone(params) });
    if (method === 'config/read') return { config: structuredClone(this.user), origins: {}, layers: [
      { name: { type: 'user', file: this.filePath }, config: structuredClone(this.user), version: `version-${this.revision}`, disabledReason: null },
    ] } as T;
    if (method === 'mcpServerStatus/list') return structuredClone(this.mcpResult) as T;
    if (method === 'config/mcpServer/reload') return {} as T;
    if (method !== 'config/batchWrite') throw new Error('Unexpected native settings operation.');
    const input = params as { filePath: string; expectedVersion: string; reloadUserConfig: boolean; edits: Array<{ keyPath: string; value: unknown }> };
    expect(input.filePath).toBe(this.filePath); expect(input.expectedVersion).toBe(`version-${this.revision}`); expect(input.reloadUserConfig).toBe(true);
    for (const item of input.edits) edit(this.user, item.keyPath, item.value);
    this.revision++; await this.persist();
    return { status: 'ok', filePath: this.filePath, version: `version-${this.revision}`, overriddenMetadata: null } as T;
  }
}

let root: string, ctx: AppContext, rpc: SettingsRpc;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-native-controls-'));
  const config = loadConfig({ DATA_DIR: path.join(root, 'data'), RUNTIME_DIR: path.join(root, 'runtime'), NODE_ENV: 'test',
    WORKSPACE_PASSWORD: 'owned-settings-password', SESSION_SECRET: 'owned-settings-session-secret-32', ENCRYPTION_KEY: 'owned-settings-encryption-key-32' });
  const store = new JsonStore(config.stateDir);
  ctx = { config, store, secrets: new SecretStore(store, config.encryptionKey), events: new EventEmitter(),
    settings: () => readPreferences(ctx), saveSettings: (patch: Partial<AppSettings>) => saveSettingsPreferences(ctx, patch),
    providerKey: vi.fn(async () => { throw new Error('Native settings must not read provider credentials.'); }),
  } as unknown as AppContext;
  rpc = new SettingsRpc(path.join(config.dataDir, 'codex-workspace', 'native-codex', 'config.toml'));
  bindings.runtimes.set(ctx, rpc); markMcpEnvironmentApplied(ctx, 'empty'); await rpc.persist();
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Native settings cannot query a provider.'); }));
});
afterEach(async () => {
  await ctx.store.flush(); expect(fetch).not.toHaveBeenCalled(); expect(ctx.providerKey).not.toHaveBeenCalled();
  vi.unstubAllGlobals(); vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true });
});
const batches = () => rpc.calls.filter(call => call.method === 'config/batchWrite');

describe('native configuration controls', () => {
  it('defaults to Fast, actual installed capacity and 90%, retaining distinct API-capacity metadata', async () => {
    const snapshot = await readNativeSettings(ctx);
    expect(snapshot.settings).toMatchObject({ fastMode: true, modelContextWindow: 872_000, autoCompactTokenLimit: 784_800 });
    expect(snapshot.modelContext).toMatchObject({ maximum: 872_000, officialMaximum: 1_050_000, configured: null, effective: 872_000, autoCompactTokenLimit: 784_800 });
    expect(snapshot.editableKeys).toEqual(expect.arrayContaining(['agents', 'mcp_servers', 'features', 'memories', 'hooks', 'tool_output_token_limit']));
    expect(snapshot.editableKeys).not.toContain('model_providers'); expect(snapshot.config).not.toHaveProperty('model_provider');
    expect(snapshot.schema).toHaveProperty('definitions.RawMcpServerConfig'); expect(batches()).toEqual([]);
    expect(rpc.calls.some(call => call.method === 'mcpServerStatus/list')).toBe(false);
  });

  it('saves curated and advanced native values atomically, then derives actual settings', async () => {
    const before = await readNativeSettings(ctx);
    const saved = await saveNativeSettings(ctx, { expectedVersion: before.version, edits: [
      { keyPath: 'agents', value: { max_concurrent_threads_per_session: 7, max_depth: 3 } },
      { keyPath: 'service_tier', value: 'default' }, { keyPath: 'model_context_window', value: 600_000 },
      { keyPath: 'tool_output_token_limit', value: 20_000 },
    ], preferences: { fontSize: 18 } });
    expect(batches()).toHaveLength(1); expect(saved.version).not.toBe(before.version);
    expect(saved.settings).toMatchObject({ fastMode: false, maxConcurrentAgents: 7, modelContextWindow: 600_000, autoCompactTokenLimit: 540_000, fontSize: 18 });
    expect(rpc.user).toMatchObject({ agents: { max_concurrent_threads_per_session: 7 }, service_tier: 'default', model_context_window: 600_000 });
    expect(nativeThreadConfig(saved.settings, 'gpt-6-sol', catalog)).toEqual({ model_context_window: 600_000, model_auto_compact_token_limit: 540_000, 'agents.max_concurrent_threads_per_session': 7 });
    expect(nativeTurnServiceTier(saved.settings)).toBe('default');
  });

  it.each(['gpt-6-sol', 'future/owned-model'])('persists and rereads literal Ultrafast for %s without a model-tier gate', async model => {
    rpc.user.model = model;
    const before = await readNativeSettings(ctx);
    const saved = await saveNativeSettings(ctx, { expectedVersion: before.version,
      edits: [{ keyPath: 'service_tier', value: 'ultrafast' }] });
    expect(saved.settings).toMatchObject({ model, serviceTier: 'ultrafast', fastMode: true });
    expect(nativeTurnServiceTier(saved.settings)).toBe('ultrafast');
    expect(batches()).toHaveLength(1);
    expect(batches()[0].params).toMatchObject({ edits: [{ keyPath: 'service_tier', value: 'ultrafast', mergeStrategy: 'replace' }] });
    const persisted = await fs.readFile(rpc.filePath, 'utf8');
    expect(persisted).toContain('service_tier = "ultrafast"');
    // Recreate the native boundary from its saved config rather than retaining
    // the old RPC object's in-memory preference state.
    rpc = new SettingsRpc(rpc.filePath); rpc.user = parse(persisted); bindings.runtimes.set(ctx, rpc);
    const restored = await readNativeSettings(ctx);
    expect(restored.settings).toMatchObject({ model, serviceTier: 'ultrafast', fastMode: true });
    expect(nativeTurnServiceTier(restored.settings)).toBe('ultrafast');
    expect(batches()).toEqual([]);
  });

  it('resets model-specific overrides when changing models and uses the selected model maximum', async () => {
    rpc.user.model_context_window = 800_000; rpc.user.model_auto_compact_token_limit = 700_000;
    const before = await readNativeSettings(ctx);
    const saved = await saveNativeSettings(ctx, { expectedVersion: before.version, edits: [{ keyPath: 'model', value: 'gpt-daybreak-red-latest' }] });
    expect(saved.settings).toMatchObject({ model: 'gpt-daybreak-red-latest', modelContextWindow: 372_000, autoCompactTokenLimit: 334_800 });
    expect(rpc.user).not.toHaveProperty('model_context_window'); expect(rpc.user).not.toHaveProperty('model_auto_compact_token_limit');
    expect(nativeThreadConfig(saved.settings, 'gpt-6-sol', catalog)).toEqual({ model_context_window: 872_000, model_auto_compact_token_limit: 784_800 });
  });

  it('restores the native default model without retaining the previous model context overrides', async () => {
    rpc.user = { model: 'gpt-daybreak-red-latest', model_context_window: 300_000, model_auto_compact_token_limit: 270_000, service_tier: 'fast' };
    const before = await readNativeSettings(ctx);
    const saved = await saveNativeSettings(ctx, { expectedVersion: before.version, edits: [{ keyPath: 'model', value: null }] });
    expect(rpc.user).not.toHaveProperty('model'); expect(rpc.user).not.toHaveProperty('model_context_window');
    expect(rpc.user).not.toHaveProperty('model_auto_compact_token_limit');
    expect(saved.settings).toMatchObject({ model: 'gpt-6-sol', modelContextWindow: 872_000, autoCompactTokenLimit: 784_800 });
  });

  it('refuses stale form versions, invalid official fields, locked overrides and impossible context values before writing', async () => {
    const before = await readNativeSettings(ctx); rpc.revision++;
    await expect(saveNativeSettings(ctx, { expectedVersion: before.version, edits: [] })).rejects.toMatchObject({ code: 'CODEX_SETTINGS_VERSION_CONFLICT' });
    const fresh = await readNativeSettings(ctx);
    for (const [entry, code] of [
      [{ keyPath: 'model_providers', value: {} }, 'CODEX_SETTINGS_LOCKED'],
      [{ keyPath: 'features', value: { api_key_model_discovery: true } }, 'CODEX_SETTINGS_LOCKED'],
      [{ keyPath: 'agents', value: { max_concurrent_threads_per_session: 'many' } }, 'CODEX_SETTINGS_SCHEMA_INVALID'],
      [{ keyPath: 'model_context_window', value: 1_050_000 }, 'CODEX_CONTEXT_LIMIT'],
      [{ keyPath: 'model_auto_compact_token_limit', value: 900_000 }, 'CODEX_CONTEXT_LIMIT'],
    ] as const) await expect(saveNativeSettings(ctx, { expectedVersion: fresh.version, edits: [entry] })).rejects.toMatchObject({ code });
    expect(batches()).toEqual([]);
  });

  it('rejects overlapping JSON paths and prototype-like fields without mutating native config', async () => {
    const before = await readNativeSettings(ctx);
    await expect(saveNativeSettings(ctx, { expectedVersion: before.version, edits: [
      { keyPath: 'agents', value: {} }, { keyPath: 'agents.max_depth', value: 2 },
    ] })).rejects.toMatchObject({ code: 'CODEX_SETTINGS_CONFLICT' });
    await expect(saveNativeSettings(ctx, { expectedVersion: before.version, edits: [
      { keyPath: 'mcp_servers', value: JSON.parse('{"__proto__":{"command":"bad"}}') },
    ] })).rejects.toMatchObject({ code: 'CODEX_SETTINGS_INVALID' });
    expect(batches()).toEqual([]);
  });

  it('accepts exact catalog effort literals and rejects values outside the official non-empty string schema', async () => {
    const advertised = structuredClone(catalog);
    advertised.catalog[0].supportedReasoningEfforts.push({ reasoningEffort: 'opaque_max', description: 'Owned future schema fixture' });
    rpc.models.mockResolvedValue(advertised);
    const before = await readNativeSettings(ctx);
    const saved = await saveNativeSettings(ctx, { expectedVersion: before.version, edits: [{ keyPath: 'model_reasoning_effort', value: 'opaque_max' }] });
    expect(saved.settings.reasoningEffort).toBe('opaque_max');
    await expect(saveNativeSettings(ctx, { expectedVersion: saved.version, edits: [{ keyPath: 'model_reasoning_effort', value: '' }] }).then(() => true))
      .rejects.toMatchObject({ code: 'CODEX_SETTINGS_SCHEMA_INVALID' });
    expect(batches()).toHaveLength(1);
  });

  it('presents legacy concurrency under the native canonical key and replaces the alias on save', async () => {
    rpc.user.agents = { max_threads: 6 };
    const before = await readNativeSettings(ctx);
    expect(before.userConfig).toMatchObject({ agents: { max_concurrent_threads_per_session: 6 } });
    expect((await saveSettingsPreferences(ctx, { maxConcurrentAgents: 9 })).maxConcurrentAgents).toBe(9);
    expect(rpc.user.agents).toEqual({ max_concurrent_threads_per_session: 9 });
  });

  it('preserves hidden managed children when a complete visible settings table changes', async () => {
    rpc.user.features = { shell_snapshot: false, memories: false };
    const before = await readNativeSettings(ctx);
    expect(before.userConfig.features).toEqual({ memories: false });
    await saveNativeSettings(ctx, { expectedVersion: before.version, edits: [{ keyPath: 'features', value: { memories: true } }] });
    expect(rpc.user.features).toEqual({ shell_snapshot: false, memories: true });
    expect((batches()[0].params as { edits: unknown[] }).edits).toEqual([{ keyPath: 'features.memories', value: true, mergeStrategy: 'replace' }]);
  });
});

describe('native MCP configuration and encrypted environment', () => {
  it('persists native references, encrypts write-only values, and marks them pending until the matching launch is ready', async () => {
    const before = await readNativeSettings(ctx), credential = 'owned-mcp-test-value-unique';
    const servers = { local: { command: '/usr/bin/node', args: ['server.mjs'], env_vars: ['MCP_SERVICE_TOKEN'], enabled: false },
      web: { url: 'https://example.invalid/mcp', bearer_token_env_var: 'MCP_SERVICE_TOKEN', enabled: false } };
    const saved = await saveNativeSettings(ctx, { expectedVersion: before.version, edits: [{ keyPath: 'mcp_servers', value: servers }],
      mcpEnvironment: [{ name: 'MCP_SERVICE_TOKEN', value: credential }] });
    expect(saved.mcpEnvironment).toEqual([{ name: 'MCP_SERVICE_TOKEN' }]); expect(saved.restartRequired).toBe(true);
    expect(JSON.stringify(saved).includes(credential)).toBe(false);
    expect((await fs.readFile(rpc.filePath, 'utf8')).includes(credential)).toBe(false);
    expect((await fs.readFile(path.join(ctx.config.stateDir, 'protected-credentials.json'), 'utf8')).includes(credential)).toBe(false);
    expect(rpc.calls.some(call => call.method === 'config/mcpServer/reload')).toBe(false);
    const launch = await readMcpEnvironmentForLaunch(ctx);
    expect(launch.env.MCP_SERVICE_TOKEN === credential).toBe(true);
    markMcpEnvironmentApplied(ctx, launch.revision); expect((await readNativeSettings(ctx)).restartRequired).toBe(false);
    const restarted = { ...ctx, secrets: new SecretStore(new JsonStore(ctx.config.stateDir), ctx.config.encryptionKey) } as AppContext;
    expect((await readMcpEnvironmentForLaunch(restarted)).env.MCP_SERVICE_TOKEN === credential).toBe(true);
    const current = await readNativeSettings(ctx);
    await saveNativeSettings(ctx, { expectedVersion: current.version, edits: [], mcpEnvironment: [{ name: 'MCP_SERVICE_TOKEN', value: null }] });
    expect((await mcpEnvironmentStatus(ctx)).restartRequired).toBe(true);
    expect((await readMcpEnvironmentForLaunch(ctx)).env).toEqual({});
  });

  it('rejects inline credentials, forbidden launchers and host-variable overrides', async () => {
    const before = await readNativeSettings(ctx);
    for (const value of [
      { test: { command: 'node', env: { API_KEY: 'private' } } },
      { test: { url: 'https://example.invalid/mcp', http_headers: { Authorization: 'private' } } },
      { test: { url: 'https://username:private@example.invalid/mcp' } },
      { test: { url: 'https://example.invalid/mcp?access_token=private' } },
      { test: { url: 'https://alvin3y10-api.hf.space/api/models' } },
      { test: { command: '/usr/bin/docker', args: ['run', 'example'] } },
      { test: { command: 'sh', args: ['-c', 'podman run example'] } },
      { test: { command: '/usr/local/bin/lolMiner', args: ['--help'] } },
      { test: { command: '/usr/local/bin/SRBMiner-MULTI', args: ['--version'] } },
      { test: { command: 'npx', args: ['example-mcp', '--api-key', 'private'] } },
      { test: { command: 'node', args: ['server.mjs', '--access-token=private'] } },
      { test: { command: 'sh', args: ['-c', 'API_TOKEN=private node server.mjs'] } },
      { test: { command: 'node', args: ['server.mjs', '-H', 'Authorization: Bearer private'] } },
    ]) await expect(saveNativeSettings(ctx, { expectedVersion: before.version, edits: [{ keyPath: 'mcp_servers', value }] })).rejects.toBeDefined();
    for (const name of ['HF_DOWNLOAD_TOKEN', 'HUGGINGFACE_TOKEN', 'OPENAI_API_KEY', 'CODEX_AUTH_TOKEN', 'XDG_SECRET_HOME', 'LD_SECRET_PRELOAD', 'HTTPS_PROXY_TOKEN', 'SSL_CERT_TOKEN']) {
      await expect(saveNativeSettings(ctx, { expectedVersion: before.version, edits: [], mcpEnvironment: [{ name, value: 'owned-private-value' }] })).rejects.toBeDefined();
    }
    expect(batches()).toEqual([]); expect(await ctx.store.read('protected-credentials', null)).toBeNull();
  });

  it('supports exact MCP environment names while preserving both native shell filter syntaxes', async () => {
    rpc.user.shell_environment_policy = { exclude: ['DROP_ME'], include_only: ['*'] }; await rpc.persist();
    const before = await readNativeSettings(ctx);
    const saved = await saveNativeSettings(ctx, { expectedVersion: before.version, edits: [], mcpEnvironment: [
      { name: 'DATABASE_URL', value: 'owned-database-value' }, { name: 'AWS_REGION', value: 'owned-region-value' }, { name: 'NODE_ENV', value: 'owned-node-environment' },
    ] });
    expect(saved.mcpEnvironment.map(row => row.name)).toEqual(['AWS_REGION', 'DATABASE_URL', 'NODE_ENV']);
    const launch = await readMcpEnvironmentForLaunch(ctx);
    expect(launch.shellFilters).toEqual({ '*': 'include', DROP_ME: 'exclude', DATABASE_URL: 'exclude', AWS_REGION: 'exclude', NODE_ENV: 'exclude' });
    expect(rpc.user.shell_environment_policy).toEqual({ exclude: ['DROP_ME'], include_only: ['*'] });
    markMcpEnvironmentApplied(ctx, launch.revision);
    const current = await readNativeSettings(ctx);
    const changed = await saveNativeSettings(ctx, { expectedVersion: current.version, edits: [
      { keyPath: 'shell_environment_policy', value: { filters: { '*': 'include', USER_ONLY: 'exclude' } } },
    ] });
    expect(changed.restartRequired).toBe(true);
    expect((await readMcpEnvironmentForLaunch(ctx)).shellFilters).toMatchObject({ USER_ONLY: 'exclude', DATABASE_URL: 'exclude' });
  });

  it('preserves native empty-allowlist syntax semantics and prevents case collisions from restoring excluded names', () => {
    expect(protectedMcpShellFilters({ include_only: [] }, ['DATABASE_URL'])).toEqual({ DATABASE_URL: 'exclude' });
    for (const filters of [{ '*': 'include', MiXeD: 'exclude', mixed: 'include' }, { '*': 'include', mixed: 'include', MiXeD: 'exclude' }]) {
      expect(protectedMcpShellFilters({ filters }, ['DATABASE_URL'])).toMatchObject({ '*': 'include', MIXED: 'exclude', DATABASE_URL: 'exclude' });
    }
    expect(protectedMcpShellFilters({ include_only: ['DATABASE_URL'] }, ['DATABASE_URL'])).toEqual({ DATABASE_URL: 'exclude', '=': 'include' });
  });

  it('redacts both active and newly saved MCP values while a restart is pending', async () => {
    const first = 'owned-active-value-private', second = 'owned-pending-value-private';
    const before = await readNativeSettings(ctx);
    const saved = await saveNativeSettings(ctx, { expectedVersion: before.version, edits: [], mcpEnvironment: [{ name: 'DATABASE_URL', value: first }] });
    const launch = await readMcpEnvironmentForLaunch(ctx); markMcpEnvironmentApplied(ctx, launch.revision);
    await saveNativeSettings(ctx, { expectedVersion: saved.version, edits: [], mcpEnvironment: [{ name: 'DATABASE_URL', value: second }] });
    const redacted = redactMcpSecrets(ctx, `${first} ${second}`);
    expect(redacted.includes(first)).toBe(false); expect(redacted.includes(second)).toBe(false);
    expect(redacted).toBe('[REDACTED] [REDACTED]');
  });

  it('never returns pre-existing inline MCP credentials from external native configuration', async () => {
    rpc.user.mcp_servers = { test: { command: 'node', args: ['server.mjs', '--api-key', 'owned-private-inline-marker'],
      env: { API_TOKEN: 'owned-private-inline-marker' } } };
    expect(JSON.stringify(await readNativeSettings(ctx)).includes('owned-private-inline-marker')).toBe(false);
  });

  it('preserves benign MCP URL queries and redacts only credential-bearing query values', async () => {
    const before = await readNativeSettings(ctx), url = 'https://example.invalid/mcp?project_ref=project&read_only=true';
    const saved = await saveNativeSettings(ctx, { expectedVersion: before.version, edits: [{ keyPath: 'mcp_servers', value: { web: { url, enabled: false } } }] });
    expect(saved.userConfig).toMatchObject({ mcp_servers: { web: { url } } });
    rpc.user.mcp_servers = { web: { url: `${url}&access_token=owned-private-query-marker`, enabled: false } };
    const redacted = await readNativeSettings(ctx);
    expect(JSON.stringify(redacted).includes('owned-private-query-marker')).toBe(false);
    expect(redacted.userConfig).toMatchObject({ mcp_servers: { web: { url } } });
  });

  it('uses official MCP reload and explicit status, sanitizing discovery errors', async () => {
    const before = await readNativeSettings(ctx);
    await saveNativeSettings(ctx, { expectedVersion: before.version, edits: [{ keyPath: 'mcp_servers', value: {
      local: { command: 'node', args: ['server.mjs'], enabled: false, startup_timeout_sec: 15, tool_timeout_sec: 60 },
    } }] });
    expect(rpc.calls.filter(call => call.method === 'config/mcpServer/reload')).toHaveLength(1);
    expect(rpc.calls.filter(call => call.method === 'mcpServerStatus/list')).toHaveLength(0);
    rpc.mcpResult = { data: [{ name: 'local', authStatus: 'unsupported', runtimeStatus: 'failed', tools: {}, resources: [],
      resourceTemplates: [], toolsError: 'owned-error-must-never-reach-browser' }], nextCursor: null };
    const status = await checkNativeMcpServers(ctx);
    expect(status.servers[0]).toMatchObject({ name: 'local', authStatus: 'unsupported', connectionStatus: 'failed', toolCount: 0 });
    expect(JSON.stringify(status)).not.toContain('owned-error-must-never-reach-browser');
  });
});

describe('official installed model metadata', () => {
  it('keeps native caps authoritative and leaves unadvertised context unknown', () => {
    const metadata = parseBundledModelMetadata({ models: [{ slug: 'gpt-6-sol', context_window: 272_000, max_context_window: 872_000,
      effective_context_window_percent: 95, service_tiers: [{ id: 'priority', name: 'Fast', description: '' }] }, { slug: 'unknown' }] });
    expect(metadata.get('gpt-6-sol')).toMatchObject({ maximumContextWindow: 872_000, officialMaximumContextWindow: 1_050_000 });
    expect(metadata.get('unknown')?.maximumContextWindow).toBeNull();
    expect(() => parseBundledModelMetadata({ models: [{ slug: 'duplicate' }, { slug: 'duplicate' }] })).toThrow();
  });
});

const nativeBinary = process.env.CODEX_CLI_TEST_EXECUTABLE;
describe.skipIf(!nativeBinary)('actual official CLI configuration and MCP boundary', () => {
  it.each([false, true])('preserves the native include_only=[] behavior while applying protected exclusions: %s', async protectedOverlay => {
    const nativeHome = path.join(root, 'empty-allowlist-native'); await fs.mkdir(nativeHome);
    await fs.writeFile(path.join(nativeHome, 'config.toml'), '[shell_environment_policy]\ninclude_only = []\n');
    const client = new CodexRpcClient({ executable: nativeBinary!, cwd: nativeHome,
      env: { PATH: process.env.PATH, HOME: nativeHome, CODEX_HOME: nativeHome, KEEP_ME: 'present', DATABASE_URL: 'owned-private-test-value' },
      args: ['app-server', '--listen', 'stdio://', '-c', 'features.api_key_model_discovery=false', '-c', 'sandbox_mode="danger-full-access"',
        ...(protectedOverlay ? ['-c', 'shell_environment_policy.filters={ DATABASE_URL="exclude" }'] : [])] });
    try {
      await client.start();
      const command = await client.request<{ exitCode: number; stdout: string }>('command/exec', {
        command: [process.execPath, '-e', `process.exit(process.env.KEEP_ME === "present" && !!process.env.DATABASE_URL === ${!protectedOverlay} ? 0 : 42)`],
        timeoutMs: 5000, outputBytesCap: 1024,
      });
      expect(command.exitCode).toBe(0); expect(command.stdout).toBe('');
    } finally { await client.close(); }
  }, 30_000);

  it('round-trips Fast, concurrency, context and native MCP config without a model request', async () => {
    const nativeHome = path.join(root, 'real-native'); await fs.mkdir(nativeHome);
    await fs.writeFile(path.join(nativeHome, 'config.toml'), '[shell_environment_policy]\nexclude = ["DROP_ME"]\ninclude_only = ["*"]\n');
    const env = { PATH: process.env.PATH, HOME: nativeHome, CODEX_HOME: nativeHome, LANG: 'C.UTF-8', DATABASE_URL: 'owned-native-database-value', DROP_ME: 'filtered', KEEP_ME: 'present' };
    const filters = protectedMcpShellFilters({ exclude: ['DROP_ME'], include_only: ['*'] }, ['DATABASE_URL']);
    const filterOverride = `shell_environment_policy.filters={${Object.entries(filters).map(([key, value]) => `${JSON.stringify(key)}=${JSON.stringify(value)}`).join(',')}}`;
    const serverFile = path.join(nativeHome, 'owned-mcp.mjs');
    await fs.writeFile(serverFile, `import readline from 'node:readline';
const lines = readline.createInterface({input:process.stdin});
lines.on('line', line => {
  const request = JSON.parse(line); if (request.id === undefined) return;
  let result = {};
  if (request.method === 'initialize') result = {protocolVersion:'2024-11-05', capabilities:{tools:{},resources:{}}, serverInfo:{name:'owned-mcp-test',version:'1'}};
  else if (request.method === 'tools/list') result = {tools:[{name:process.env.DATABASE_URL ? 'token_present' : 'token_missing',description:'Owned environment check',inputSchema:{type:'object',properties:{}}}]};
  else if (request.method === 'resources/list') result = {resources:[]};
  else if (request.method === 'resources/templates/list') result = {resourceTemplates:[]};
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\\n');
});\n`);
    const client = new CodexRpcClient({ executable: nativeBinary!, cwd: nativeHome, env,
      args: ['app-server', '--listen', 'stdio://', '-c', 'features.api_key_model_discovery=false',
        '-c', 'analytics.enabled=false', '-c', 'mcp_oauth_credentials_store="keyring"',
        '-c', 'sandbox_mode="danger-full-access"', '-c', 'shell_environment_policy.ignore_default_excludes=false',
        '-c', filterOverride] });
    try {
      await client.start();
      const before = await client.request<{ layers: Array<{ name: { type: string; file?: string }; version: string }> }>('config/read', { includeLayers: true });
      const layer = before.layers.find(value => value.name.type === 'user')!;
      expect(layer.name.file).toBe(path.join(nativeHome, 'config.toml'));
      const reply = await client.request<{ status: string; version: string }>('config/batchWrite', { filePath: layer.name.file,
        expectedVersion: layer.version, reloadUserConfig: true, edits: [
          { keyPath: 'service_tier', value: 'fast', mergeStrategy: 'replace' },
          { keyPath: 'agents.max_concurrent_threads_per_session', value: 7, mergeStrategy: 'replace' },
          { keyPath: 'model_context_window', value: 600_000, mergeStrategy: 'replace' },
          { keyPath: 'model_auto_compact_token_limit', value: 540_000, mergeStrategy: 'replace' },
          { keyPath: 'mcp_servers', value: { owned: { command: process.execPath, args: [serverFile], env_vars: ['DATABASE_URL'], enabled: true } }, mergeStrategy: 'replace' },
        ] });
      expect(reply.status).toBe('ok');
      const after = await client.request<{ config: Table; layers: Array<{ name: { type: string }; config: Table; version: string }> }>('config/read', { includeLayers: true });
      expect(after.config).toMatchObject({ service_tier: 'fast', model_context_window: 600_000, model_auto_compact_token_limit: 540_000 });
      expect(after.layers.find(value => value.name.type === 'user')?.config).toMatchObject({ agents: { max_concurrent_threads_per_session: 7 }, mcp_servers: { owned: { enabled: true } } });
      await client.request('config/mcpServer/reload', {});
      const status = await client.request<{ data: Array<{ name: string; tools: Record<string, unknown> }> }>('mcpServerStatus/list', { limit: 100, detail: 'full' });
      expect(Object.keys(status.data.find(row => row.name === 'owned')?.tools ?? {})).toContain('token_present');
      const command = await client.request<{ exitCode: number; stdout: string; stderr: string }>('command/exec', {
        command: [process.execPath, '-e', 'process.exit(process.env.DATABASE_URL || process.env.DROP_ME || process.env.KEEP_ME !== "present" ? 42 : 0)'], timeoutMs: 5000, outputBytesCap: 1024,
      });
      expect(command.exitCode).toBe(0); expect(command.stdout).toBe('');
      const metadata = await readBundledModelMetadata(nativeBinary!, { env, cwd: nativeHome });
      expect(metadata.get('gpt-6-sol')?.maximumContextWindow).toBeGreaterThan(0);
    } finally { await client.close(); }
  }, 30_000);
});
