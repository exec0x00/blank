import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { createServer, request as httpRequest, type Server } from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AuthService } from '../server/auth';
import { loadConfig } from '../server/config';
import type { AppContext } from '../server/context';
import { HttpError } from '../server/errors';
import { JsonStore, SecretStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import { createSettingsRouter, migrateNativePreferences, readPreferences, savedPreferences, saveSettingsPreferences,
  settingsSchema, type NativePreferencesRpc } from '../server/settings';
import { createProviderRouter, getProviderStatus, listProviderModels, resolveProvider } from '../server/provider';
import type { CodexModelCatalog, CodexRuntimeStatus } from '../shared/codex-cli';

const bindings = vi.hoisted(() => ({ runtimes: new WeakMap<object, unknown>() }));
vi.mock('../server/codex-cli/runtime', () => ({ getCodexRuntime: (ctx: object) => {
  const runtime = bindings.runtimes.get(ctx);
  if (!runtime) throw new Error('Unexpected native runtime creation in preferences fixture.');
  return runtime;
} }));
vi.mock('../server/model-registry', () => { throw new Error('Native preferences must not import the custom model registry.'); });

type Config = Record<string, string | boolean | null>;
type Edit = { keyPath: string; value: string | boolean | null; mergeStrategy: 'replace' };
const fixedCapabilities = { conversations: true, pagination: true, queue: true, goals: true, skills: true, plan: true, review: true, historyRevert: true };
const catalog: CodexModelCatalog = { backend: 'codex-cli', connected: true, models: ['native/first', 'native/default'], catalog: [
  { id: 'cli-first', model: 'native/first', displayName: 'First native model', description: '', hidden: false,
    supportedReasoningEfforts: [{ reasoningEffort: 'low', description: '' }], defaultReasoningEffort: 'low', inputModalities: ['text'], isDefault: false },
  { id: 'cli-default', model: 'native/default', displayName: 'Native default label', description: '', hidden: false,
    supportedReasoningEfforts: [{ reasoningEffort: 'literal-plus', description: '' }], defaultReasoningEffort: 'literal-plus', inputModalities: ['text', 'image'], isDefault: true },
] };

/** Local RPC boundary backed by owned files. Native null/delete/version
 * semantics were independently checked against the actual installed0.155.1. */
class PreferencesRpc implements NativePreferencesRpc {
  state: CodexRuntimeStatus['state'] = 'ready';
  live = true;
  user: Config = { model: 'native/selected', model_reasoning_effort: 'literal-plus' };
  inherited: Config = {};
  overrides: Config = {};
  revision = 1;
  readsFail = false;
  failAfterCommit = false;
  failVerificationRead = false;
  foreignLayer = false;
  beforeBatch?: () => void | Promise<void>;
  calls: Array<{ method: string; params: unknown }> = [];
  models = vi.fn(async () => structuredClone(catalog));
  constructor(readonly filePath: string) {}
  version() { return `native-version-${this.revision}`; }
  generation() { return this.live ? 'owned-native-generation' : null; }
  status(): CodexRuntimeStatus { return { backend: 'codex-cli', state: this.state, version: this.live ? '0.155.1' : null,
    installedVersion: '0.155.1', startedAt: null, updatedAt: new Date().toISOString(), canUpdate: false, updateBlockedReason: null,
    error: null, activeTurns: 0, capabilities: { ...fixedCapabilities } }; }
  async persist() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, Object.entries(this.user).map(([key, value]) => `${key} = ${JSON.stringify(value)}\n`).join(''));
  }
  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    this.calls.push({ method, params: structuredClone(params) });
    if (method === 'config/read') {
      if (this.readsFail) throw new HttpError(503, 'Owned native config-read failure.', 'CODEX_CONNECTION_LOST');
      return { config: { model: null, model_reasoning_effort: null, model_reasoning_summary: null, model_verbosity: null,
        web_search: null, approval_policy: null, ...this.inherited, ...this.user, ...this.overrides }, origins: {},
      layers: [{ name: { type: 'user', file: this.foreignLayer ? '/unowned/config.toml' : this.filePath, profile: null },
        version: this.version(), config: structuredClone(this.user), disabledReason: null }] } as T;
    }
    if (method !== 'config/batchWrite') throw new Error(`Unexpected native RPC: ${method}`);
    const input = params as { filePath: string; expectedVersion: string; edits: Edit[]; reloadUserConfig: boolean };
    expect(input.filePath).toBe(this.filePath); expect(input.reloadUserConfig).toBe(true);
    await this.beforeBatch?.();
    if (input.expectedVersion !== this.version()) throw new HttpError(409, 'Configuration was modified since last read.', 'CODEX_RPC_REJECTED');
    for (const edit of input.edits) {
      expect(edit.mergeStrategy).toBe('replace');
      if (edit.value === null) delete this.user[edit.keyPath]; else this.user[edit.keyPath] = edit.value;
    }
    this.revision++; await this.persist();
    if (this.failAfterCommit) throw new HttpError(504, 'Owned lost write acknowledgment.', 'CODEX_ACKNOWLEDGMENT_TIMEOUT');
    if (this.failVerificationRead) this.readsFail = true;
    const overridden = input.edits.some(edit => Object.hasOwn(this.overrides, edit.keyPath));
    return { status: overridden ? 'okOverridden' : 'ok', version: this.version(), filePath: this.filePath,
      overriddenMetadata: overridden ? { message: 'Owned override.', effectiveValue: 'managed',
        overridingLayer: { name: { type: 'sessionFlags' }, version: 'native-session-version' } } : null } as T;
  }
}

let directory: string, ctx: AppContext, native: PreferencesRpc, server: Server | undefined;
const password = 'owned-native-settings-password';
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-native-settings-'));
  const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: directory, RUNTIME_DIR: path.join(directory, 'runtime'),
    WORKSPACE_PASSWORD: password, SESSION_SECRET: 'owned-native-settings-session-secret-32', ENCRYPTION_KEY: 'owned-native-settings-encryption-key-32' });
  const store = new JsonStore(config.stateDir), workspaces = new WorkspaceService(config, store);
  await workspaces.initialize();
  ctx = { config, store, workspaces, secrets: new SecretStore(store, config.encryptionKey), events: new EventEmitter(),
    providerKey: vi.fn(async () => { throw new Error('Native settings must not read a model credential.'); }),
    settings: () => readPreferences(ctx), saveSettings: patch => saveSettingsPreferences(ctx, patch) };
  native = new PreferencesRpc(path.join(config.dataDir, 'codex-workspace', 'native-codex', 'config.toml'));
  bindings.runtimes.set(ctx, native); await native.persist();
  vi.spyOn(https, 'request').mockImplementation(() => { throw new Error('Native settings must not make HTTPS requests.'); });
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Native settings must not make provider or registry requests.'); }));
});
afterEach(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; }
  await ctx.store.flush();
  expect(https.request).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(ctx.providerKey).not.toHaveBeenCalled();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  await fs.rm(directory, { recursive: true, force: true });
});

const batches = () => native.calls.filter(call => call.method === 'config/batchWrite');
const migration = () => ctx.store.read('codex-native-preferences-migration', null);

describe('official Codex preferences and startup migration', () => {
  it('reads actual native literals while retaining appearance and removing retired output/provider fields', async () => {
    await ctx.store.write('settings', { model: 'old-choice', reasoningEffort: 'old-effort', fontSize: 19, wordWrap: true,
      maxOutputTokens: 9999, apiKey: 'owned-retired-fixture-token', theme: 'light' });
    native.user = { model: 'native/case-Sensitive', model_reasoning_effort: 'literal-plus', model_reasoning_summary: 'none',
      model_verbosity: 'high', web_search: 'live', approval_policy: 'never' }; await native.persist();
    const result = await readPreferences(ctx);
    expect(result).toMatchObject({ model: 'native/case-Sensitive', reasoningEffort: 'literal-plus', reasoningSummary: 'none',
      verbosity: 'high', webSearchMode: 'live', autoApprove: true, fontSize: 19, wordWrap: true, theme: 'dark', agentConfigured: true });
    expect(result).not.toHaveProperty('maxOutputTokens'); expect(result).not.toHaveProperty('apiKey');
    expect(batches()).toEqual([]); expect(await migration()).toBeNull(); expect(native.models).toHaveBeenCalledTimes(1);
  });

  it('uses only the reported native default when unset, and reports empty/unavailable when no default exists', async () => {
    native.user = {};
    expect(await readPreferences(ctx)).toMatchObject({ model: 'native/default', reasoningEffort: null });
    native.models.mockResolvedValue({ ...structuredClone(catalog), catalog: catalog.catalog.map(row => ({ ...row, isDefault: false })) });
    expect(await readPreferences(ctx)).toMatchObject({ model: '', agentConfigured: false, reasoningEffort: null });
    expect(batches()).toEqual([]);
  });

  it('keeps old supported preferences and editor saves usable while installing without touching native config', async () => {
    native.state = 'installing'; native.live = false;
    await ctx.store.write('settings', { model: 'saved/literal', reasoningEffort: 'saved-effort', reasoningSummary: 'none', verbosity: 'low',
      webSearchMode: 'disabled', autoApprove: true, fontSize: 17, wordWrap: false, maxOutputTokens: 42 });
    expect(await readPreferences(ctx)).toMatchObject({ model: 'saved/literal', reasoningEffort: 'saved-effort', autoApprove: true, agentConfigured: false });
    const result = await saveSettingsPreferences(ctx, { fontSize: 21, wordWrap: true });
    expect(result).toMatchObject({ fontSize: 21, wordWrap: true, model: 'saved/literal', reasoningSummary: 'none', webSearchMode: 'disabled' });
    expect(await ctx.store.read('settings', {})).not.toHaveProperty('maxOutputTokens');
    expect(native.calls).toEqual([]); expect(native.models).not.toHaveBeenCalled();
    await expect(saveSettingsPreferences(ctx, { model: 'different', fontSize: 16 })).rejects.toMatchObject({ code: 'CODEX_UNAVAILABLE' });
    expect((await readPreferences(ctx)).fontSize).toBe(21);
  });

  it('rejects agent changes during update before any native request, while appearance remains editable', async () => {
    native.state = 'updating';
    await expect(saveSettingsPreferences(ctx, { autoApprove: true })).rejects.toMatchObject({ code: 'CODEX_UPDATING' });
    expect(native.calls).toEqual([]);
    expect((await saveSettingsPreferences(ctx, { fontSize: 20 })).fontSize).toBe(20); expect(batches()).toEqual([]);
  });

  it('treats an undefined optional helper field as omitted rather than deleting a saved startup choice', async () => {
    native.state = 'installing'; native.live = false;
    await ctx.store.write('settings', { model: 'saved/Exact', reasoningEffort: 'saved-effort' });
    expect(await saveSettingsPreferences(ctx, { fontSize: 20, reasoningEffort: undefined })).toMatchObject({
      model: 'saved/Exact', reasoningEffort: 'saved-effort', fontSize: 20,
    });
    expect(await ctx.store.read('settings', {})).toMatchObject({ reasoningEffort: 'saved-effort' });
    expect(native.calls).toEqual([]);
  });

  it('sends exact supported native fields, fixed destination and current user-layer version, then verifies actual state', async () => {
    const result = await saveSettingsPreferences(ctx, { model: 'native/Exact-wire', reasoningEffort: 'literal-plus', reasoningSummary: 'none',
      verbosity: 'high', webSearchMode: 'live', autoApprove: true, fontSize: 18 });
    expect(batches()).toEqual([{ method: 'config/batchWrite', params: {
      filePath: native.filePath, expectedVersion: 'native-version-1', reloadUserConfig: true,
      edits: [
        { keyPath: 'model', value: 'native/Exact-wire', mergeStrategy: 'replace' },
        { keyPath: 'model_reasoning_effort', value: 'literal-plus', mergeStrategy: 'replace' },
        { keyPath: 'model_reasoning_summary', value: 'none', mergeStrategy: 'replace' },
        { keyPath: 'model_verbosity', value: 'high', mergeStrategy: 'replace' },
        { keyPath: 'web_search', value: 'live', mergeStrategy: 'replace' },
        { keyPath: 'approval_policy', value: 'never', mergeStrategy: 'replace' },
        { keyPath: 'model_context_window', value: null, mergeStrategy: 'replace' },
        { keyPath: 'model_auto_compact_token_limit', value: null, mergeStrategy: 'replace' },
      ],
    } }]);
    expect(result).toMatchObject({ model: 'native/Exact-wire', reasoningEffort: 'literal-plus', reasoningSummary: 'none', autoApprove: true, fontSize: 18 });
    expect(await fs.readFile(native.filePath, 'utf8')).toContain('model_reasoning_summary = "none"');
    expect(native.models).toHaveBeenCalled();
  });

  it.each([
    ['ultrafast', false, true], ['fast', false, true], ['default', true, false], ['future-native-tier', true, false],
  ] as const)('preserves explicit %s over the legacy Fast field and through unrelated edits', async (serviceTier, fastMode, accelerated) => {
    const result = await saveSettingsPreferences(ctx, { serviceTier, fastMode });
    expect(result).toMatchObject({ serviceTier, fastMode: accelerated });
    expect(batches()).toHaveLength(1);
    expect(batches()[0].params).toMatchObject({ edits: [{ keyPath: 'service_tier', value: serviceTier, mergeStrategy: 'replace' }] });
    expect(await fs.readFile(native.filePath, 'utf8')).toContain(`service_tier = "${serviceTier}"`);
    expect(await saveSettingsPreferences(ctx, { fontSize: 18 })).toMatchObject({ serviceTier, fastMode: accelerated, fontSize: 18 });
    expect(batches()).toHaveLength(1);
    native.state = 'installing'; native.live = false;
    expect(await readPreferences(ctx)).toMatchObject({ serviceTier, fastMode: accelerated });
  });

  it('retains legacy Fast-only changes after an explicit tier selection, including during native startup', async () => {
    await saveSettingsPreferences(ctx, { serviceTier: 'ultrafast' });
    for (const fastMode of [false, true]) {
      native.state = 'ready'; native.live = true;
      const serviceTier = fastMode ? 'priority' : 'default';
      expect(await saveSettingsPreferences(ctx, { fastMode })).toMatchObject({ serviceTier, fastMode });
      expect(native.user.service_tier).toBe(serviceTier);
      expect(await ctx.store.read('settings', {})).toMatchObject({ serviceTier, fastMode });
      native.state = 'installing'; native.live = false;
      expect(await readPreferences(ctx)).toMatchObject({ serviceTier, fastMode });
    }
    await ctx.store.write('settings', { fastMode: false });
    expect(await readPreferences(ctx)).toMatchObject({ serviceTier: 'default', fastMode: false });
  });

  it('deletes null overrides and reports the actual inherited values rather than asserting a reset to invented defaults', async () => {
    native.user = { model: 'native/selected', model_reasoning_effort: 'high', model_reasoning_summary: 'none', model_verbosity: 'high' };
    native.inherited = { model_reasoning_effort: 'low', model_reasoning_summary: 'concise', model_verbosity: 'medium' };
    const result = await saveSettingsPreferences(ctx, { reasoningEffort: null, reasoningSummary: null, verbosity: null });
    expect(result).toMatchObject({ reasoningEffort: 'low', reasoningSummary: 'concise', verbosity: 'medium' });
    for (const name of ['model_reasoning_effort', 'model_reasoning_summary', 'model_verbosity']) expect(native.user).not.toHaveProperty(name);
    expect(await fs.readFile(native.filePath, 'utf8')).toBe('model = "native/selected"\n');
    expect(await ctx.store.read('settings', {})).toMatchObject({ reasoningEffort: null, reasoningSummary: null, verbosity: null });
  });

  it('serializes partial writes using a fresh native version and preserves both changes', async () => {
    await Promise.all([saveSettingsPreferences(ctx, { reasoningSummary: 'detailed' }), saveSettingsPreferences(ctx, { verbosity: 'low' })]);
    expect(batches().map(call => (call.params as { expectedVersion: string }).expectedVersion)).toEqual(['native-version-1', 'native-version-2']);
    expect(await readPreferences(ctx)).toMatchObject({ reasoningSummary: 'detailed', verbosity: 'low' });
  });

  it('does not retry or overwrite a native edit that wins between reading and writing', async () => {
    native.beforeBatch = () => { native.user.model = 'native/external-edit'; native.revision++; };
    await expect(saveSettingsPreferences(ctx, { model: 'native/requested' })).rejects.toMatchObject({ code: 'CODEX_SETTINGS_OUTCOME_UNKNOWN' });
    expect(batches()).toHaveLength(1); expect(native.user.model).toBe('native/external-edit');
    expect(await ctx.store.read('settings', null)).toBeNull();
  });

  it('reports a saved-but-overridden value honestly and never mirrors it as effective success', async () => {
    native.overrides = { model_reasoning_effort: 'managed-effort' };
    await expect(saveSettingsPreferences(ctx, { reasoningEffort: 'requested-effort' })).rejects.toMatchObject({ status: 409, code: 'CODEX_SETTINGS_OVERRIDDEN' });
    expect(native.user.model_reasoning_effort).toBe('requested-effort');
    expect((await readPreferences(ctx)).reasoningEffort).toBe('managed-effort');
    expect(await ctx.store.read('settings', null)).toBeNull();
  });

  it.each(['lost acknowledgment', 'failed verification read'] as const)('reports an unknown outcome after %s without a rollback or repeat', async cause => {
    native.failAfterCommit = cause === 'lost acknowledgment'; native.failVerificationRead = cause === 'failed verification read';
    await expect(saveSettingsPreferences(ctx, { reasoningSummary: 'none' })).rejects.toMatchObject({ code: 'CODEX_SETTINGS_OUTCOME_UNKNOWN',
      message: expect.stringContaining('may have been saved') });
    expect(batches()).toHaveLength(1); expect(await ctx.store.read('settings', null)).toBeNull();
    expect(await fs.readFile(native.filePath, 'utf8')).toContain('model_reasoning_summary = "none"');
    native.readsFail = false;
    expect((await readPreferences(ctx)).reasoningSummary).toBe('none');
  });

  it('reports a confirmed native save separately from a failed web preference copy', async () => {
    const failure = vi.spyOn(ctx.store, 'update').mockRejectedValueOnce(new Error('Owned web preference-copy fault.'));
    await expect(saveSettingsPreferences(ctx, { reasoningSummary: 'none', fontSize: 20 })).rejects.toMatchObject({
      code: 'SETTINGS_PERSISTENCE_UNCONFIRMED', message: expect.stringContaining('Codex saved its preferences'),
    });
    failure.mockRestore();
    expect(batches()).toHaveLength(1);
    expect(await fs.readFile(native.filePath, 'utf8')).toContain('model_reasoning_summary = "none"');
    expect(await ctx.store.read('settings', null)).toBeNull();
    expect(await readPreferences(ctx)).toMatchObject({ reasoningSummary: 'none', fontSize: 14 });
  });

  it('refuses an unowned native config layer before writing', async () => {
    native.foreignLayer = true;
    await expect(saveSettingsPreferences(ctx, { autoApprove: true })).rejects.toMatchObject({ code: 'CODEX_SETTINGS_LAYER_UNAVAILABLE' });
    expect(batches()).toEqual([]);
  });

  it('migrates only actually saved missing native fields once, using the initialized client before public readiness', async () => {
    native.state = 'starting'; native.user = {}; await native.persist();
    await ctx.store.write('settings', { model: 'saved/Exact', reasoningEffort: 'saved-literal', reasoningSummary: 'none', verbosity: 'low',
      webSearchMode: 'live', autoApprove: true, fontSize: 19, maxOutputTokens: 9000, apiKey: 'owned-retired-fixture-value' });
    await Promise.all([migrateNativePreferences(ctx, native), migrateNativePreferences(ctx, native)]);
    expect(batches()).toHaveLength(1);
    expect(native.user).toEqual({ model: 'saved/Exact', model_reasoning_effort: 'saved-literal', model_reasoning_summary: 'none',
      model_verbosity: 'low', web_search: 'live', approval_policy: 'never', service_tier: 'fast' });
    expect(await migration()).toMatchObject({ version: 2, filePath: native.filePath, nativeVersion: 'native-version-2' });
    expect(await ctx.store.read('settings', {})).not.toHaveProperty('maxOutputTokens');
    expect(await ctx.store.read('settings', {})).not.toHaveProperty('apiKey');
    expect(native.models).not.toHaveBeenCalled();
  });

  it('preserves existing native choices and does not carry old model-specific effort onto a different native model', async () => {
    native.user = { model: 'native/existing', model_reasoning_summary: 'concise', approval_policy: 'on-request' };
    await ctx.store.write('settings', { model: 'saved/other', reasoningEffort: 'old-model-effort', reasoningSummary: 'detailed',
      autoApprove: true, verbosity: 'high', fontSize: 18 });
    await migrateNativePreferences(ctx, native);
    expect(native.user).toEqual({ model: 'native/existing', model_reasoning_summary: 'concise', approval_policy: 'on-request', model_verbosity: 'high', service_tier: 'fast' });
    expect(native.models).not.toHaveBeenCalled();
  });

  it('seeds only the requested Fast default when appearance or null overrides were saved', async () => {
    native.user = {};
    await ctx.store.write('settings', { fontSize: 18, wordWrap: true, reasoningEffort: null, reasoningSummary: null });
    await migrateNativePreferences(ctx, native);
    expect(batches()).toHaveLength(1); expect(native.user).toEqual({ service_tier: 'fast' });
    expect(await migration()).toMatchObject({ importedKeys: ['service_tier'] });
    expect(native.models).not.toHaveBeenCalled();
  });

  it('upgrades the old migration marker to Fast once and preserves explicit native off', async () => {
    await ctx.store.write('codex-native-preferences-migration', { version: 1, filePath: native.filePath, nativeVersion: native.version() });
    await migrateNativePreferences(ctx, native);
    expect(native.user.service_tier).toBe('fast'); expect(await migration()).toMatchObject({ version: 2 });
    native.user.service_tier = 'default'; native.revision++;
    await migrateNativePreferences(ctx, native);
    expect(native.user.service_tier).toBe('default'); expect(batches()).toHaveLength(1);
    expect((await readPreferences(ctx)).fastMode).toBe(false);
  });

  it('does not mark a lost migration outcome complete or replay already committed values on an explicit restart attempt', async () => {
    native.user = {}; native.failAfterCommit = true;
    await ctx.store.write('settings', { model: 'saved/Exact' });
    await expect(migrateNativePreferences(ctx, native)).rejects.toMatchObject({ code: 'CODEX_SETTINGS_OUTCOME_UNKNOWN' });
    expect(await migration()).toBeNull(); expect(native.user.model).toBe('saved/Exact');
    native.failAfterCommit = false;
    await migrateNativePreferences(ctx, native);
    expect(batches()).toHaveLength(1); expect(await migration()).toMatchObject({ importedKeys: [] });
  });

  it('reflects actual CLI readiness and rejects legacy direct-model resolution without reading credentials', async () => {
    expect(await getProviderStatus(ctx)).toMatchObject({ backend: 'codex-cli', state: 'ready', agentConfigured: true, managed: true });
    native.live = false;
    expect(await getProviderStatus(ctx)).toMatchObject({ state: 'ready', agentConfigured: false, apiKeyConfigured: false });
    await expect(resolveProvider(ctx)).rejects.toMatchObject({ code: 'CODEX_CLI_REQUIRED' });
    expect(await listProviderModels(ctx)).toEqual(catalog.models);
    expect(native.calls).toEqual([]);
  });
});

async function httpFixture() {
  const auth = new AuthService(ctx); await auth.initialize();
  const app = express();
  app.use('/api', auth.protectMutations, express.json({ limit: '32kb' }), auth.router(), auth.requireSession,
    createSettingsRouter(ctx), createProviderRouter(ctx));
  app.use((_req, res) => { res.status(404).json({ error: 'Not found.' }); });
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof HttpError) res.status(error.status).json({ error: error.message, code: error.code });
    else if (error instanceof ZodError) res.status(400).json({ error: 'Invalid native preferences.' });
    else res.status(500).json({ error: 'Unexpected fixture failure.' });
  };
  app.use(errors); server = createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; let cookie = '';
  const request = (route: string, method = 'GET', body?: unknown, authenticated = true) => new Promise<{ status: number; body: unknown; headers: Record<string, unknown> }>((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest(`${base}/api${route}`, { method, agent: false, headers: { Origin: base, 'X-Codex-Workspace': '1',
      ...(authenticated && cookie ? { Cookie: cookie } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }) } }, res => {
      const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => { try { resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString('utf8')), headers: res.headers }); } catch (error) { reject(error); } });
      res.on('error', reject);
    });
    req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('Owned HTTP fixture timed out.'))); req.end(data);
  });
  const login = await request('/session', 'POST', { password });
  expect(login.status).toBe(200); cookie = (login.headers['set-cookie'] as string[])[0].split(';')[0];
  return request;
}

describe('authenticated native settings routes', () => {
  it('returns the runtime catalog unchanged and keeps settings/status behind site authentication', async () => {
    const request = await httpFixture();
    for (const route of ['/models', '/settings', '/provider/status']) expect((await request(route, 'GET', undefined, false)).status).toBe(401);
    const result = await request('/models');
    expect(result.status).toBe(200); expect(result.body).toEqual(catalog); expect(result.headers['cache-control']).toBe('no-store');
    expect(native.models).toHaveBeenCalledTimes(1);
    expect((await request('/provider/status')).body).toMatchObject({ backend: 'codex-cli', agentConfigured: true });
    for (const route of ['/provider/key', '/provider/method', '/provider/device/start']) expect((await request(route, 'POST', {})).status).toBe(404);
    expect(native.calls).toEqual([]);
  });

  it('rejects retired output/provider/destination fields and accepts only the supported literal summary choices', async () => {
    const request = await httpFixture();
    for (const body of [{ maxOutputTokens: 512 }, { provider: 'other' }, { apiKey: 'owned-fixture' }, { filePath: '/unowned' },
      { expectedVersion: 'browser-chosen' }, { reasoningSummary: 'public-marketing-alias' }]) {
      expect((await request('/settings', 'PATCH', body)).status).toBe(400);
    }
    expect(native.calls).toEqual([]); expect(settingsSchema.safeParse({ reasoningSummary: 'none' }).success).toBe(true);
    expect(savedPreferences({ maxOutputTokens: 42, reasoningSummary: 'none', fontSize: 18 })).toEqual({ reasoningSummary: 'none', fontSize: 18 });
    expect((await request('/settings', 'PATCH', { reasoningSummary: 'none' })).body).toMatchObject({ reasoningSummary: 'none' });
  });
});
