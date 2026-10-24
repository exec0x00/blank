import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'smol-toml';
import type { AppContext } from '../../server/context';
import type { CodexModelCatalog } from '../../shared/codex-cli';
import { getCodexRuntime } from '../../server/codex-cli/runtime';

export const preferenceFixtureTokens = ['preference-fixture-account-a-token-not-real', 'preference-fixture-account-b-token-not-real'] as const;
const profiles = preferenceFixtureTokens.map((_, index) => ({ id: 7201 + index, login: `preference-fixture-${index + 1}`,
  name: `Preference fixture ${index + 1}`, avatar_url: `https://avatars.githubusercontent.com/u/${7201 + index}` }));

export interface PreferenceBoundaryInspection {
  nativeBoundary: 'controlled-file-backed-config';
  nativeMethods: string[];
  nativeProcessStarted: boolean;
  githubProfiles: number;
  githubRepositoryReads: number;
  unexpectedNetwork: number;
}

/** Real application storage/auth remains active. Only native config RPC and
 * GitHub HTTPS responses are controlled. No CLI, npm, model or HF is started. */
export function githubPreferenceBoundary() {
  const counts = { profiles: 0, repositories: 0, unexpected: 0 };
  const denied = () => { counts.unexpected++;throw new Error('Preference persistence must not contact an external service.'); };
  const request = (options: { protocol?: string; hostname?: string; method?: string; path?: string; headers?: Record<string, string> },
    callback: (response: Readable & { statusCode: number; headers: Record<string, string> }) => void) => {
    const index = preferenceFixtureTokens.findIndex(token => options?.headers?.Authorization === `Bearer ${token}`);
    if (options?.protocol !== 'https:' || options.hostname !== 'api.github.com' || options.method !== 'GET' || index < 0) return denied();
    const url = new URL(options.path || '/', 'https://api.github.com');
    if (!['/user', '/user/repos'].includes(url.pathname)) return denied();
    const profile = profiles[index];
    if (url.pathname === '/user') counts.profiles++;else counts.repositories++;
    const body = url.pathname === '/user' ? profile : [{ id: 8201 + index, name: 'saved-repository', full_name: `${profile.login}/saved-repository`,
      description: 'Controlled repository metadata', private: false, default_branch: 'main', updated_at: '2026-09-20T00:00:00Z',
      html_url: `https://github.com/${profile.login}/saved-repository`, clone_url: `https://github.com/${profile.login}/saved-repository.git` }];
    const stream = Readable.from([Buffer.from(JSON.stringify(body))]) as Readable & { statusCode: number; headers: Record<string, string> };
    stream.statusCode = 200;stream.headers = {};
    const outgoing = new EventEmitter() as EventEmitter & { end(): void; destroy(): void };
    outgoing.end = () => { queueMicrotask(() => callback(stream)); };
    outgoing.destroy = () => { stream.destroy(); };
    return outgoing;
  };
  return { counts, denied, request };
}

export async function installPreferenceNativeBoundary(ctx: AppContext, github: ReturnType<typeof githubPreferenceBoundary>) {
  const runtime = getCodexRuntime(ctx), originalGeneration = runtime.generation.bind(runtime), initial = runtime.status();
  if (ctx.config.codexCliAutoStart || originalGeneration() || initial.state === 'ready') throw new Error('Preference fixture requires native autostart disabled.');
  const filePath = path.join(ctx.config.dataDir, 'codex-workspace', 'native-codex', 'config.toml');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, '', { flag: 'wx', mode: 0o600 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
  const calls: string[] = [], allowed = new Set(['model', 'model_reasoning_effort', 'model_reasoning_summary', 'model_verbosity', 'web_search', 'approval_policy',
    'service_tier', 'model_context_window', 'model_auto_compact_token_limit', 'agents.max_concurrent_threads_per_session', 'agents.max_threads']);
  const read = async () => {
    const bytes = await fs.readFile(filePath), config = parse(bytes.toString('utf8'));
    return { config, version: createHash('sha256').update(bytes).digest('hex') };
  };
  runtime.status = () => ({ ...initial, state: 'ready', version: '0.155.1', installedVersion: '0.155.1', error: null,
    canUpdate: false, updateBlockedReason: 'Controlled persistence fixture', activeTurns: 0 });
  runtime.generation = () => 'controlled-preference-generation';
  runtime.start = async () => { throw new Error('Native processes must not start in the preference fixture.'); };
  runtime.request = async <T>(method: string, value?: unknown): Promise<T> => {
    calls.push(method);
    const input = value as { includeLayers?: boolean; filePath?: string; expectedVersion?: string; reloadUserConfig?: boolean;
      edits?: Array<{ keyPath: string; value: string | number | boolean | null; mergeStrategy: string }> } | undefined;
    if (method === 'config/read') {
      if (input?.includeLayers !== true) throw new Error('Expected native layers for preference verification.');
      const current = await read();
      return { config: current.config, layers: [{ name: { type: 'user', file: filePath, profile: null },
        version: current.version, config: current.config, disabledReason: null }] } as T;
    }
    if (method !== 'config/batchWrite') throw new Error('Unexpected native operation in the preference fixture.');
    const current = await read();
    if (input?.filePath !== filePath || input.expectedVersion !== current.version || input.reloadUserConfig !== true || !input.edits?.length)
      throw new Error('Native preference comparison did not match its owned file.');
    for (const edit of input.edits) {
      if (!allowed.has(edit.keyPath) || edit.mergeStrategy !== 'replace') throw new Error('Unexpected native preference key.');
      const parts = edit.keyPath.split('.'); let target = current.config as Record<string, unknown>;
      for (const part of parts.slice(0, -1)) {
        if (!target[part] || typeof target[part] !== 'object' || Array.isArray(target[part])) target[part] = {};
        target = target[part] as Record<string, unknown>;
      }
      if (edit.value === null) delete target[parts.at(-1)!];else target[parts.at(-1)!] = edit.value;
    }
    await fs.writeFile(filePath, stringify(current.config));
    return { status: 'ok', filePath, version: (await read()).version, overriddenMetadata: null } as T;
  };
  runtime.models = async (): Promise<CodexModelCatalog> => ({ backend: 'codex-cli', connected: true, models: ['gpt-6-astra'], catalog: [{
    id: 'native-preference-fixture', model: 'gpt-6-astra', displayName: 'Native preference fixture', description: 'Controlled native metadata',
    hidden: false, inputModalities: ['text', 'image'], isDefault: true, defaultReasoningEffort: 'xhigh',
    supportedReasoningEfforts: [{ reasoningEffort: 'xhigh', description: 'Fixture native effort' }],
  }] });
  return { filePath, inspect: (): PreferenceBoundaryInspection => ({ nativeBoundary: 'controlled-file-backed-config', nativeMethods: [...calls],
    nativeProcessStarted: originalGeneration() !== null, githubProfiles: github.counts.profiles, githubRepositoryReads: github.counts.repositories,
    unexpectedNetwork: github.counts.unexpected }) };
}
