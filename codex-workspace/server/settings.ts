import { Router } from 'express';
import { z } from 'zod';
import path from 'node:path';
import type { AppContext } from './context';
import type { AppSettings, Workspace } from '../shared/types';
import { getCodexRuntime } from './codex-cli/runtime';
import { getProviderStatus } from './provider';
import { readUiState } from './ui-state';
import { getGithubAccountsPage } from './github';
import { getWorkspacePage } from './workspace-pages';
import { HttpError } from './errors';
import type { CodexConfigValue, CodexModelCatalog } from '../shared/codex-cli';
import { nativeModelContext } from './codex-cli/model-metadata';

export const defaultSettings: AppSettings = {
  model: '', reasoningEffort: null, autoApprove: false, fastMode: true, serviceTier: 'fast',
  theme: 'dark', fontSize: 14, wordWrap: false, provider: 'openai', apiKeyConfigured: false, agentConfigured: false,
};
const literalPreference = (maximum: number) => z.string().min(1).max(maximum)
  .refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value), 'Use an unchanged, readable native Codex value.');
const fastModeForTier = (tier: unknown): boolean => tier === null || tier === undefined
  || tier === 'fast' || tier === 'priority' || tier === 'ultrafast';
export const settingsSchema = z.object({
  model: literalPreference(200).optional(),
  reasoningEffort: literalPreference(100).nullable().optional(),
  reasoningSummary: z.enum(['auto', 'concise', 'detailed', 'none']).nullable().optional(),
  verbosity: z.enum(['low', 'medium', 'high']).nullable().optional(),
  webSearchMode: z.enum(['disabled', 'cached', 'indexed', 'live']).optional(),
  fastMode: z.boolean().optional(),
  serviceTier: literalPreference(100).nullable().optional(),
  maxConcurrentAgents: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  modelContextWindow: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  autoCompactTokenLimit: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  autoApprove: z.boolean().optional(),
  fontSize: z.number().int().min(10).max(24).optional(),
  wordWrap: z.boolean().optional(),
}).strict();

export type EditableSettings = z.infer<typeof settingsSchema>;
const nativeKeys = {
  model: 'model', reasoningEffort: 'model_reasoning_effort', reasoningSummary: 'model_reasoning_summary',
  verbosity: 'model_verbosity', webSearchMode: 'web_search', autoApprove: 'approval_policy',
  serviceTier: 'service_tier', maxConcurrentAgents: 'agents.max_concurrent_threads_per_session',
  modelContextWindow: 'model_context_window', autoCompactTokenLimit: 'model_auto_compact_token_limit',
} as const;
type AgentPreferenceKey = keyof typeof nativeKeys;
const agentPreferenceKeys = Object.keys(nativeKeys) as AgentPreferenceKey[];
const migrationsKey = 'codex-native-preferences-migration';
const writes = new WeakMap<AppContext, Promise<unknown>>();
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const boundedText = (value: unknown, maximum = 512): value is string => typeof value === 'string' && value.length > 0
  && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
const configPath = (ctx: AppContext) => path.join(ctx.config.dataDir, 'codex-workspace', 'native-codex', 'config.toml');

/** Trusted lifecycle seam: the runtime passes its initialized client before
 * announcing readiness. This interface accepts no browser-selected paths. */
export interface NativePreferencesRpc {
  request<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T>;
}
export interface NativePreferencesSnapshot {
  effective: Record<string, unknown>;
  user: Record<string, unknown>;
  version: string;
  filePath: string;
}
export interface NativeEdit { keyPath: string; value: CodexConfigValue; mergeStrategy: 'replace' }

export function serializeSettings<T>(ctx: AppContext, operation: () => Promise<T>): Promise<T> {
  const next = (writes.get(ctx) ?? Promise.resolve()).catch(() => undefined).then(operation);
  writes.set(ctx, next);
  void next.finally(() => { if (writes.get(ctx) === next) writes.delete(ctx); }).catch(() => undefined);
  return next;
}

export async function nativeSnapshot(ctx: AppContext, rpc: NativePreferencesRpc): Promise<NativePreferencesSnapshot> {
  const value = await rpc.request('config/read', { includeLayers: true });
  if (!object(value) || !object(value.config) || !Array.isArray(value.layers) || value.layers.length > 64) {
    throw new HttpError(502, 'Codex did not return a valid preferences snapshot.', 'CODEX_SETTINGS_INVALID');
  }
  const destination = configPath(ctx);
  const layers = value.layers.filter(object).filter(layer => object(layer.name) && layer.name.type === 'user'
    && layer.name.file === destination && (layer.name.profile === null || layer.name.profile === undefined));
  if (layers.length !== 1 || !boundedText(layers[0].version) || !object(layers[0].config)
    || layers[0].disabledReason !== null && layers[0].disabledReason !== undefined) {
    throw new HttpError(409, 'Codex did not expose the application’s writable native preferences layer.', 'CODEX_SETTINGS_LAYER_UNAVAILABLE');
  }
  return { effective: value.config, user: layers[0].config, version: layers[0].version, filePath: destination };
}

export function nativeValue(root: Record<string, unknown>, keyPath: string): unknown {
  let value: unknown = root;
  for (const part of keyPath.split('.')) {
    if (!object(value) || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return value;
}

export function nativeEdits(patch: EditableSettings): NativeEdit[] {
  const edits: NativeEdit[] = agentPreferenceKeys.filter(key => Object.hasOwn(patch, key) && patch[key] !== undefined).map(key => ({
    keyPath: nativeKeys[key], value: key === 'autoApprove' ? patch.autoApprove ? 'never' : 'on-request' : patch[key] as CodexConfigValue,
    mergeStrategy: 'replace',
  }));
  // Explicit native tiers are canonical, including null to clear the tier.
  // The legacy boolean applies only when no tier was supplied.
  if (patch.fastMode !== undefined && patch.serviceTier === undefined) {
    edits.push({ keyPath: 'service_tier', value: patch.fastMode ? 'priority' : 'default', mergeStrategy: 'replace' });
  }
  return edits;
}

const unknownWrite = () => new HttpError(503,
  'Codex preferences could not be verified. The change may have been saved; refresh before retrying. No rollback or automatic retry was performed.',
  'CODEX_SETTINGS_OUTCOME_UNKNOWN');

export async function writeNative(ctx: AppContext, rpc: NativePreferencesRpc, before: NativePreferencesSnapshot,
  edits: NativeEdit[], pendingRuntimeKeys: readonly string[] = []): Promise<NativePreferencesSnapshot> {
  let result: unknown, after: NativePreferencesSnapshot;
  try {
    result = await rpc.request('config/batchWrite', { edits, filePath: before.filePath,
      expectedVersion: before.version, reloadUserConfig: true });
    after = await nativeSnapshot(ctx, rpc);
  } catch { throw unknownWrite(); }
  if (!object(result) || !['ok', 'okOverridden'].includes(String(result.status)) || result.filePath !== before.filePath
    || !boundedText(result.version) || after.version !== result.version) throw unknownWrite();
  for (const edit of edits) {
    const value = nativeValue(after.user, edit.keyPath);
    if (edit.value === null ? value !== undefined : !sameNativeValue(value, edit.value)) throw unknownWrite();
  }
  const pending = (edit: NativeEdit) => pendingRuntimeKeys.some(key => edit.keyPath === key || edit.keyPath.startsWith(`${key}.`));
  if ((result.status === 'okOverridden' || result.overriddenMetadata !== null && result.overriddenMetadata !== undefined) && !edits.some(pending)
    || edits.some(edit => !pending(edit) && edit.value !== null && !nativeValueContains(nativeValue(after.effective, edit.keyPath), edit.value))) {
    throw new HttpError(409, 'The preference was saved, but a higher-priority Codex setting overrides it. Refresh to see the effective native value.', 'CODEX_SETTINGS_OVERRIDDEN');
  }
  return after;
}

export function sameNativeValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, index) => sameNativeValue(value, right[index]));
  if (object(left) || object(right)) return object(left) && object(right) && Object.keys(left).length === Object.keys(right).length
    && Object.entries(left).every(([key, value]) => Object.hasOwn(right, key) && sameNativeValue(value, right[key]));
  return left === right;
}
function nativeValueContains(actual: unknown, expected: unknown): boolean {
  // Higher layers may contribute unrelated keys inside a table. Only a changed
  // requested leaf is an override of this edit.
  return object(expected) ? object(actual) && Object.entries(expected).every(([key, value]) => nativeValueContains(actual[key], value))
    : sameNativeValue(actual, expected);
}

// Read old state without exposing retired connection fields or allowing them
// to override the server-owned provider configuration and dark theme.
export function savedPreferences(value: unknown): Partial<AppSettings> {
  const result: Record<string, unknown> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [key, schema] of Object.entries(settingsSchema.shape)) {
    const parsed = schema.safeParse((value as Record<string, unknown>)[key]);
    if (parsed.success && parsed.data !== undefined) result[key] = parsed.data;
  }
  return result;
}

/** Called explicitly by runtime startup; reads never seed or mutate config. */
export function migrateNativePreferences(ctx: AppContext, rpc: NativePreferencesRpc = getCodexRuntime(ctx)): Promise<void> {
  return serializeSettings(ctx, async () => {
    const marker = await ctx.store.read<unknown>(migrationsKey, null);
    if (marker !== null) {
      if (!object(marker) || marker.version !== 1 && marker.version !== 2 || marker.filePath !== configPath(ctx) || !boundedText(marker.nativeVersion)) {
        throw new HttpError(409, 'Native preference migration metadata could not be verified. Existing choices were retained.', 'CODEX_SETTINGS_MIGRATION_INVALID');
      }
      if (marker.version === 2) return;
    }
    const saved = savedPreferences(await ctx.store.read<unknown>('settings', {}));
    const before = await nativeSnapshot(ctx, rpc), seed: EditableSettings = {};
    for (const key of marker === null ? agentPreferenceKeys : []) {
      const value = saved[key];
      if (value === undefined || value === null || nativeValue(before.user, nativeKeys[key]) !== undefined
        || nativeValue(before.effective, nativeKeys[key]) !== null && nativeValue(before.effective, nativeKeys[key]) !== undefined) continue;
      // An existing different native model is not authority to carry over the
      // old model's effort choice. Global independent preferences remain eligible.
      if (key === 'reasoningEffort' && saved.model && typeof before.effective.model === 'string'
        && before.effective.model !== saved.model) continue;
      Object.assign(seed, { [key]: value });
    }
    // Latest user default: Fast is enabled unless an explicit native tier
    // (including standard/off) already exists. This runs before readiness.
    if (before.effective.service_tier === null || before.effective.service_tier === undefined) {
      seed.serviceTier ??= saved.serviceTier ?? (saved.fastMode === false ? 'default' : 'fast');
    }
    const edits = nativeEdits(seed), after = edits.length ? await writeNative(ctx, rpc, before, edits) : before;
    await ctx.store.update<Partial<AppSettings>>('settings', {}, current => savedPreferences(current));
    await ctx.store.write(migrationsKey, { version: 2, filePath: after.filePath, nativeVersion: after.version,
      importedKeys: edits.map(edit => edit.keyPath), completedAt: new Date().toISOString() });
  });
}

export function readNativeFields(snapshot: NativePreferencesSnapshot): Partial<AppSettings> {
  const selected: Record<string, unknown> = {};
  for (const key of agentPreferenceKeys) {
    if (key === 'autoApprove') continue;
    const value = nativeValue(snapshot.effective, nativeKeys[key])
      ?? (key === 'maxConcurrentAgents' ? nativeValue(snapshot.effective, 'agents.max_threads') : undefined);
    if (value === null || value === undefined) {
      if (['reasoningEffort', 'reasoningSummary', 'verbosity', 'serviceTier', 'maxConcurrentAgents', 'modelContextWindow', 'autoCompactTokenLimit'].includes(key)) selected[key] = null;
      continue;
    }
    const parsed = settingsSchema.shape[key].safeParse(value);
    if (!parsed.success) throw new HttpError(502, 'Codex returned an unsupported native preference value.', 'CODEX_SETTINGS_INVALID');
    selected[key] = parsed.data;
  }
  selected.autoApprove = snapshot.effective.approval_policy === 'never';
  selected.fastMode = fastModeForTier(selected.serviceTier);
  return selected as Partial<AppSettings>;
}

/** Appearance and last saved supported web choices remain readable while the
 * CLI installs. A ready native config is authoritative; no settings writes,
 * native thread resume, probes or model requests happen here. */
export async function readPreferences(ctx: AppContext): Promise<AppSettings> {
  const saved = savedPreferences(await ctx.store.read<unknown>('settings', {}));
  const provider = await getProviderStatus(ctx);
  const serviceTier = saved.serviceTier !== undefined ? saved.serviceTier : saved.fastMode === false ? 'default' : defaultSettings.serviceTier;
  const base: AppSettings = { ...defaultSettings, ...saved, serviceTier, fastMode: fastModeForTier(serviceTier), apiKeyConfigured: provider.apiKeyConfigured,
    agentConfigured: provider.agentConfigured, chatgptConnected: false, authMethod: 'api-key' };
  if (!provider.agentConfigured) return base;
  const runtime = getCodexRuntime(ctx), snapshot = await nativeSnapshot(ctx, runtime), native = readNativeFields(snapshot);
  let model = native.model ?? '';
  // Runtime catalog reads are cached per generation and never query the fixed
  // provider. Always retain its cap when an external config supplied a larger
  // context than this installed Codex can use.
  const catalog: CodexModelCatalog = await runtime.models();
  const defaults = catalog.catalog.filter(value => value.isDefault);
  if ((!model || !catalog.models.includes(model)) && catalog.connected && defaults.length === 1) model = defaults[0].model;
  const result: AppSettings = { ...defaultSettings, fontSize: base.fontSize, wordWrap: base.wordWrap, ...native, model, nativeConfigVersion: snapshot.version,
    reasoningEffort: catalog.catalog.find(row => row.model === model)?.supportedReasoningEfforts.some(value => value.reasoningEffort === native.reasoningEffort) ? native.reasoningEffort ?? null : null, apiKeyConfigured: provider.apiKeyConfigured,
    agentConfigured: provider.agentConfigured && !!model, chatgptConnected: false, authMethod: 'api-key' };
  const context = nativeModelContext(result, model, catalog);
  result.modelContextWindow = context.effective; result.autoCompactTokenLimit = context.autoCompactTokenLimit;
  if (!result.serviceTier) { result.serviceTier = 'fast'; result.fastMode = true; }
  return result;
}

/** Serialize application writes around native compare-and-swap. Codex owns
 * validation/persistence; the web store keeps appearance and fallback choices. */
export async function saveSettingsPreferences(ctx: AppContext, patch: Partial<AppSettings>): Promise<AppSettings> {
  const clean = settingsSchema.parse(patch);
  for (const key of Object.keys(clean) as Array<keyof EditableSettings>) if (clean[key] === undefined) delete clean[key];
  // Keep the fallback web preference copy consistent with the native write,
  // including legacy clients toggling Fast after an explicit tier was saved.
  if (clean.serviceTier !== undefined) clean.fastMode = fastModeForTier(clean.serviceTier);
  else if (clean.fastMode !== undefined) clean.serviceTier = clean.fastMode ? 'priority' : 'default';
  return serializeSettings(ctx, async () => {
    let edits = nativeEdits(clean);
    if (edits.length) {
      const runtime = getCodexRuntime(ctx);
      if (runtime.status().state === 'updating') {
        throw new HttpError(409, 'Wait for the Codex update before changing agent preferences.', 'CODEX_UPDATING');
      }
      if (runtime.status().state !== 'ready' || !runtime.generation()) {
        throw new HttpError(503, 'Codex is not ready to save agent preferences. Editor preferences remain available.', 'CODEX_UNAVAILABLE');
      }
      const before = await nativeSnapshot(ctx, runtime);
      edits = await prepareNativePreferenceEdits(ctx, clean, before);
      await writeNative(ctx, runtime, before, edits);
    }
    try {
      await ctx.store.update<Partial<AppSettings>>('settings', {}, current => ({ ...savedPreferences(current), ...clean }));
    } catch {
      throw new HttpError(503, edits.length ? 'Codex saved its preferences, but the web preference copy could not be confirmed. Refresh before retrying.'
        : 'Editor preferences could not be confirmed in storage. Refresh before retrying.', 'SETTINGS_PERSISTENCE_UNCONFIRMED');
    }
    return readPreferences(ctx);
  });
}

/** Set defaults when the selected model or context changes, using actual
 * native catalog maxima. Other preference writes do not rewrite context. */
export async function prepareNativePreferenceEdits(ctx: AppContext, clean: EditableSettings,
  before: NativePreferencesSnapshot): Promise<NativeEdit[]> {
  const adjusted = { ...clean };
  const contextChanged = Object.hasOwn(clean, 'modelContextWindow');
  const modelChanged = clean.model !== undefined && clean.model !== before.effective.model;
  if (modelChanged || contextChanged || Object.hasOwn(clean, 'autoCompactTokenLimit')) {
    const runtime = getCodexRuntime(ctx), catalog = await runtime.models();
    const model = clean.model ?? (typeof before.effective.model === 'string' ? before.effective.model : catalog.catalog.find(row => row.isDefault)?.model ?? '');
    const fields = readNativeFields(before);
    if (modelChanged && !contextChanged) adjusted.modelContextWindow = null;
    if ((modelChanged || contextChanged) && !Object.hasOwn(clean, 'autoCompactTokenLimit')) adjusted.autoCompactTokenLimit = null;
    const selected = { ...defaultSettings, ...fields, ...adjusted, model };
    const context = nativeModelContext(selected, model, catalog);
    if (typeof adjusted.modelContextWindow === 'number' && context.maximum !== null && adjusted.modelContextWindow > context.maximum) {
      throw new HttpError(400, `The installed Codex supports at most ${context.maximum} context tokens for this model.`, 'CODEX_CONTEXT_LIMIT');
    }
    if (typeof adjusted.autoCompactTokenLimit === 'number' && context.effective !== null && adjusted.autoCompactTokenLimit > context.effective) {
      throw new HttpError(400, 'The auto-compaction threshold cannot exceed the selected context window.', 'CODEX_CONTEXT_LIMIT');
    }
    // Reset removes a user override. The runtime supplies the maximum/90%
    // defaults at official thread start/resume, so future CLI maxima can grow.
  }
  const edits = nativeEdits(adjusted);
  if (Object.hasOwn(clean, 'maxConcurrentAgents') && nativeValue(before.user, 'agents.max_threads') !== undefined) {
    edits.push({ keyPath: 'agents.max_threads', value: null, mergeStrategy: 'replace' });
  }
  return edits;
}

export function createSettingsRouter(ctx: AppContext): Router {
  const router = Router();
  router.get('/settings', async (_req, res) => res.json(await ctx.settings()));
  router.patch('/settings', async (req, res) => {
    const input = settingsSchema.parse(req.body);
    res.json(await ctx.saveSettings(input));
  });
  router.get('/settings/native', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const { readNativeSettings } = await import('./codex-cli/native-settings');
    res.json(await readNativeSettings(ctx));
  });
  router.patch('/settings/native', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const { saveNativeSettings } = await import('./codex-cli/native-settings');
    res.json(await saveNativeSettings(ctx, req.body));
  });
  router.post('/settings/native/mcp/check', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const { checkNativeMcpServers } = await import('./codex-cli/native-settings');
    const input = z.object({ cursor: z.string().min(1).max(1024).nullable().optional() }).strict().parse(req.body ?? {});
    res.json(await checkNativeMcpServers(ctx, input.cursor));
  });
  router.get('/bootstrap', async (_req, res) => {
    const [page, active, settings, accountsPage, uiState] = await Promise.all([
      getWorkspacePage(ctx),
      ctx.store.read<string | null>('active-workspace', null),
      ctx.settings(),
      getGithubAccountsPage(ctx),
      readUiState(ctx),
    ]);
    let activeWorkspace: Workspace | null = null;
    if (active) {
      try { activeWorkspace = await ctx.workspaces.getAvailable(active); }
      catch (error) {
        if (!(error instanceof HttpError) || error.status !== 404
          || !['WORKSPACE_NOT_FOUND', 'WORKSPACE_DIRECTORY_MISSING'].includes(error.code || '')) throw error;
      }
    }
    activeWorkspace ??= page.workspaces[0] || null;
    const { workspaces, ...workspacePage } = page;
    const { accounts: githubAccounts, selected: _selectedAccount, ...githubAccountPage } = accountsPage;
    res.json({
      workspaces,
      workspacePage,
      activeWorkspace,
      activeWorkspaceId: activeWorkspace?.id || null,
      settings,
      githubAccounts,
      githubAccountPage,
      uiState,
      storage: { path: ctx.config.dataDir, persistent: ctx.config.requirePersistentData, bucket: ctx.config.bucket, writable: true },
    });
  });
  router.get('/models', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await getCodexRuntime(ctx).models());
  });
  return router;
}
