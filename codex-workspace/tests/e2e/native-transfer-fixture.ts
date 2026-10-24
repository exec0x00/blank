import type { AppSettings } from '../../shared/types';
import type { CodexModelCatalog, CodexRuntimeStatus } from '../../shared/codex-cli';
import type { BrowserContext } from '@playwright/test';

/** Registered before each case's explicit bucket/CAS routes. Those later
 * fixture routes take precedence; every otherwise-unmatched external request
 * is aborted instead of contacting a provider, registry or Hugging Face. */
export async function blockUnmatchedTransferNetwork(context: BrowserContext, baseURL: string | undefined): Promise<void> {
  const origin = new URL(baseURL || 'http://127.0.0.1:4390').origin;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) throw new Error('Transfer fixtures require an owned loopback server.');
  await context.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
}

/** Native metadata only for whole-API transfer fixtures. This does not restore
 * a model registry or perform any CLI/provider request. */
export function nativeTransferMetadata(pathname: string, method: string, settings: AppSettings): unknown | undefined {
  if (method !== 'GET') return;
  if (pathname === '/models') return {
    backend: 'codex-cli', connected: true, models: [settings.model], catalog: [{
      id: 'transfer-native-catalog-entry', model: settings.model, displayName: 'Native transfer fixture', description: 'Native catalog metadata for site-transfer coverage',
      hidden: false, isDefault: true, inputModalities: ['text', 'image'], defaultReasoningEffort: settings.reasoningEffort ?? 'high',
      supportedReasoningEfforts: [{ reasoningEffort: settings.reasoningEffort ?? 'high', description: 'Fixture native effort' }],
    }],
  } satisfies CodexModelCatalog;
  if (pathname === '/codex/runtime') return {
    backend: 'codex-cli', state: 'ready', version: '0.155.1', installedVersion: '0.155.1', startedAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z', canUpdate: false, updateBlockedReason: 'Transfer fixture', error: null, activeTurns: 0,
    capabilities: { conversations: true, pagination: true, queue: true, goals: true, skills: true, plan: true, review: true, historyRevert: true },
  } satisfies CodexRuntimeStatus;
  if (pathname === '/threads') return { items: [], olderCursor: null, newerCursor: null, hasOlder: false, hasNewer: false };
  if (/^\/workspaces\/[^/]+\/codex\/skills$/.test(pathname)) return { skills: [], errors: [] };
  return undefined;
}
