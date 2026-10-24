import { Router } from 'express';
import type { AppContext } from './context';
import type { CodexRuntimeStatus } from '../shared/codex-cli';
import { getCodexRuntime } from './codex-cli/runtime';
import { HttpError } from './errors';

// This is the user-selected service's complete Responses URL, not a base URL.
// It is never read from settings, environment variables, or browser requests.
export const FIXED_RESPONSES_URL = 'https://alvin3y12-test.hf.space/api';

export interface ProviderStatus {
  managed: true;
  backend: 'codex-cli';
  state: CodexRuntimeStatus['state'];
  agentConfigured: boolean;
  // Retained while existing settings consumers transition to agentConfigured.
  // These are availability indicators, not editable account configuration.
  method: 'api-key';
  apiKeyConfigured: boolean;
  chatgptConnected: boolean;
}

export interface ResolvedProvider {
  kind: 'api-key';
  token: string;
}

export async function getProviderStatus(ctx: AppContext): Promise<ProviderStatus> {
  const runtime = getCodexRuntime(ctx), status = runtime.status();
  // Ready means the official process accepted the server-owned fixed provider
  // configuration. It is not a claim that an inference request succeeded.
  const ready = ['ready', 'updating'].includes(status.state) && !!runtime.generation() && status.capabilities.conversations;
  return {
    managed: true, backend: 'codex-cli', state: status.state, agentConfigured: ready,
    method: 'api-key', apiKeyConfigured: ready, chatgptConnected: false,
  };
}

export async function resolveProvider(_ctx: AppContext): Promise<ResolvedProvider> {
  // Keep the legacy type importable for archived artifact readers, while
  // preventing a forgotten legacy caller from starting another JS model loop.
  throw new HttpError(410, 'Direct application model requests are retired. Use the official Codex CLI runtime.', 'CODEX_CLI_REQUIRED');
}

export async function listProviderModels(ctx: AppContext): Promise<string[]> {
  return (await getCodexRuntime(ctx).models()).models;
}

export async function shutdownProvider(_ctx: AppContext): Promise<void> {
  // Managed configuration has no OAuth polling jobs or credential refresh state.
}

export function createProviderRouter(ctx: AppContext): Router {
  const router = Router();
  router.get('/provider/status', async (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await getProviderStatus(ctx)); });
  // There are deliberately no login, key, endpoint or provider-method routes.
  return router;
}
