import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { request as httpRequest, type Server } from 'node:http';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { AppContext } from '../server/context';
import { loadConfig } from '../server/config';
import { JsonStore, SecretStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import { defaultSettings } from '../server/settings';
import { HttpError } from '../server/errors';
import { withWorkspaceRemoval } from '../server/worktrees/activity';
import type { CodexBridge } from '../server/codex-cli/bridge';
import type { CodexModelCatalog, CodexRuntimeStatus } from '../shared/codex-cli';
import type { Thread, ThreadSummary, Workspace } from '../shared/types';
import type { NativeFeatureDependencies } from '../server/codex-cli/features/common';
import { createNativeTurnControlsRouter } from '../server/codex-cli/features/turn-controls';
import { SERVICE_TIERS } from '../shared/service-tiers';

const THREAD = '01990000-0000-7000-8000-000000000101';
const TURN = '01990000-0000-7000-8000-000000000201';
const NEXT_TURN = '01990000-0000-7000-8000-000000000202';
const METHOD = 'turn/settings/update';
let directory: string, ctx: AppContext, workspace: Workspace, other: Workspace, server: Server, base: string;
let deps: NativeFeatureDependencies, bridge: CodexBridge, view: Thread, generation: string, supported: boolean;
let catalog: CodexModelCatalog, nativeResult: unknown;
const calls: Array<{ method: string; params: unknown }> = [];
const cleanup: Array<() => void | Promise<void>> = [];
let handler: ((params: unknown) => unknown | Promise<unknown>) | undefined;
let catalogHook: (() => void | Promise<void>) | undefined;

async function request(method = 'GET', body?: unknown, workspaceId = workspace.id) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const bytes = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest(`${base}/workspaces/${workspaceId}/codex/threads/${THREAD}/current-turn-settings`, { method,
      headers: bytes ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) } : {} }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', value => { text += value; });
      res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(text) }));
    }); req.on('error', reject); req.end(bytes);
  });
}
const input = (changes: Record<string, unknown> = {}) => ({ expectedTurnId: TURN, expectedGeneration: generation, ...changes });
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-turn-controls-test-'));
  const config = loadConfig({ DATA_DIR: path.join(directory, 'data'), RUNTIME_DIR: path.join(directory, 'runtime'), NODE_ENV: 'test',
    WORKSPACE_PASSWORD: 'turn-controls-fixture-password', SESSION_SECRET: 'turn-controls-session-'.repeat(3), ENCRYPTION_KEY: 'turn-controls-key-'.repeat(3) });
  const store = new JsonStore(config.stateDir), workspaces = new WorkspaceService(config, store); await workspaces.initialize();
  workspace = (await workspaces.list())[0]; other = await workspaces.create({ name: 'Other workspace' });
  ctx = { config, store, workspaces, secrets: new SecretStore(store, config.encryptionKey), events: new EventEmitter(),
    settings: vi.fn(async () => ({ ...defaultSettings })), saveSettings: vi.fn(async patch => ({ ...defaultSettings, ...patch })),
    providerKey: vi.fn(async () => { throw new Error('Turn controls must not use provider credentials.'); }) };
  generation = 'turn-controls-native-generation'; supported = true; nativeResult = { status: 'applied' }; handler = undefined; catalogHook = undefined; calls.length = 0; cleanup.length = 0;
  view = { id: THREAD, workspaceId: workspace.id, backend: 'codex-cli', title: 'Owned native thread', createdAt: '2026-09-30T00:00:00Z', updatedAt: '2026-09-30T00:00:00Z',
    status: 'running', messages: [], native: { loaded: true, activeTurnId: TURN, model: 'native/first', reasoningEffort: 'low', approvals: [], questions: [], queue: [], queueCursor: null,
      goal: null, tokenUsage: null, diff: null, capabilities: { conversations: true, pagination: true, queue: true, goals: true, skills: true, plan: true, review: true, historyRevert: true } } };
  catalog = { backend: 'codex-cli', connected: true, models: ['native/first', 'native/second'], catalog: [
    { id: 'first-metadata', model: 'native/first', displayName: 'First native model', description: '', hidden: false, isDefault: true, inputModalities: ['text'], defaultReasoningEffort: 'low',
      supportedReasoningEfforts: [{ reasoningEffort: 'low', description: '' }, { reasoningEffort: 'literal wire effort', description: '' }], serviceTiers: [{ id: 'fast', name: 'Fast', description: '' }] },
    { id: 'second-metadata', model: 'native/second', displayName: 'Second native model', description: '', hidden: false, isDefault: false, inputModalities: ['text'], defaultReasoningEffort: 'max',
      supportedReasoningEfforts: [{ reasoningEffort: 'max', description: '' }, { reasoningEffort: 'ultra', description: '' }], serviceTiers: [{ id: 'flex', name: 'Flex', description: '' }] },
  ] };
  bridge = { generation: () => generation, supports: method => method !== METHOD || supported,
    status: () => ({ state: 'ready', activeTurns: view.native?.activeTurnId ? 1 : 0 } as CodexRuntimeStatus),
    models: vi.fn(async () => { await catalogHook?.(); return structuredClone(catalog); }),
    request: async <T>(method: string, params?: unknown): Promise<T> => {
      calls.push({ method, params: structuredClone(params) }); return await (handler ? handler(params) : nativeResult) as T;
    }, respond: () => undefined, rejectRequest: () => undefined,
    onNotification: () => () => undefined, onRequest: () => () => undefined, onConnection: () => () => undefined };
  deps = { ctx, bridge, authorizeThread: vi.fn(async (workspaceId, threadId) => {
    if (workspaceId !== workspace.id || threadId !== THREAD) throw new HttpError(403, 'Thread is outside this workspace.', 'CODEX_THREAD_SCOPE');
    return { id: THREAD, workspaceId, backend: 'codex-cli', title: view.title, createdAt: view.createdAt, updatedAt: view.updatedAt, status: view.status } as ThreadSummary;
  }), readThread: vi.fn(async () => structuredClone(view)), registerCleanup: dispose => cleanup.push(dispose) };
  const app = express(); app.use(express.json()); app.use('/api', createNativeTurnControlsRouter(deps));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error instanceof HttpError ? error.status : error instanceof z.ZodError ? 400 : 500).json({
      error: error instanceof Error ? error.message : 'Unknown failure', code: error instanceof HttpError ? error.code : 'INVALID_INPUT',
      ...((error as { outcomeUnknown?: boolean })?.outcomeUnknown ? { outcomeUnknown: true } : {}),
    });
  });
  server = await new Promise<Server>(resolve => { const current = app.listen(0, '127.0.0.1', () => resolve(current)); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing owned fixture address.'); base = `http://127.0.0.1:${address.port}/api`;
});
afterEach(async () => {
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  for (const dispose of cleanup) await dispose();
  await ctx.workspaces.closeFileTrashPages(); await ctx.workspaces.closeTrashCleanup(); await ctx.store.flush();
  expect(ctx.settings).not.toHaveBeenCalled(); expect(ctx.saveSettings).not.toHaveBeenCalled(); expect(ctx.providerKey).not.toHaveBeenCalled();
  await fs.rm(directory, { recursive: true, force: true });
});

describe('native current-turn controls', () => {
  it('reads the exact active ID and catalogued options without inventing current values or executing work', async () => {
    const result = await request();
    expect(result.status).toBe(200); expect(result.body).toMatchObject({ scope: 'current-turn', activeTurnId: TURN, generation, canRequest: true, currentValuesReadable: false });
    expect(result.body.models[0]).toEqual({ id: 'first-metadata', model: 'native/first', displayName: 'First native model', reasoningEfforts: ['low', 'literal wire effort'],
      serviceTiers: [{ id: 'fast', name: 'Fast' }, ...SERVICE_TIERS.filter(tier => tier.id !== 'fast')] });
    expect(result.body).not.toHaveProperty('model'); expect(result.body).not.toHaveProperty('settings'); expect(calls).toEqual([]);
    expect(deps.readThread).toHaveBeenCalledTimes(2); expect(bridge.models).toHaveBeenCalledTimes(1);
  });

  it('makes idle, unloaded, and unaddressable turns unavailable without looking up models', async () => {
    view.status = 'idle'; view.native!.activeTurnId = null;
    expect((await request()).body).toMatchObject({ canRequest: false, activeTurnId: null, models: [] });
    expect((await request('PATCH', input({ summary: 'detailed' }))).status).toBe(409);
    view.status = 'running';
    expect((await request()).body.unavailableReason).toMatch(/not reported an addressable active turn/);
    view.native!.activeTurnId = TURN; view.native!.loaded = false;
    expect((await request()).body.canRequest).toBe(false); expect(bridge.models).not.toHaveBeenCalled(); expect(calls).toEqual([]);
  });

  it('requires matching native thread and selected workspace authority before read or mutation', async () => {
    expect((await request('GET', undefined, other.id)).status).toBe(403);
    expect((await request('PATCH', input({ effort: 'ultra' }), other.id)).status).toBe(403);
    expect(deps.readThread).not.toHaveBeenCalled(); expect(bridge.models).not.toHaveBeenCalled();
    view.workspaceId = other.id;
    expect((await request()).status).toBe(403); expect(calls).toEqual([]);
  });

  it('holds workspace lifecycle admission and never resumes an unavailable native thread', async () => {
    await withWorkspaceRemoval(ctx.config.workspacesDir, workspace.id, async () => {
      expect((await request()).status).toBe(409);
      expect((await request('PATCH', input({ summary: 'none' }))).status).toBe(409);
    });
    deps.readThread = undefined;
    expect((await request()).status).toBe(501); expect(calls).toEqual([]);
  });

  it('rejects an empty patch, unknown host/provider settings, and null no-op fields', async () => {
    for (const fields of [{}, { modelProvider: 'other' }, { config: {} }, { sandboxPolicy: { type: 'dangerFullAccess' } }, { model: null }, { effort: null }, { summary: null }]) {
      expect((await request('PATCH', input(fields))).status).toBe(400);
    }
    expect(calls).toEqual([]); expect(deps.readThread).not.toHaveBeenCalled();
  });

  it('dispatches only explicit current-turn fields and preserves the exact applied status', async () => {
    const result = await request('PATCH', input({ model: 'native/second', effort: 'ultra', summary: 'detailed', serviceTier: null, approvalsReviewer: 'user' }));
    expect(result.status).toBe(200); expect(result.body).toEqual({ scope: 'current-turn', threadId: THREAD, turnId: TURN, status: 'applied' });
    expect(calls).toEqual([{ method: METHOD, params: { threadId: THREAD, turnId: TURN, model: 'native/second', effort: 'ultra', summary: 'detailed', serviceTier: null, approvalsReviewer: 'user' } }]);
    expect(view.native).toMatchObject({ model: 'native/first', reasoningEffort: 'low' });
  });

  it('omits unchanged fields and sends clear-tier null without choosing a default model or effort', async () => {
    expect((await request('PATCH', input({ summary: 'none' }))).status).toBe(200);
    expect(calls[0].params).toEqual({ threadId: THREAD, turnId: TURN, summary: 'none' });
    expect((await request('PATCH', input({ serviceTier: null, approvalsReviewer: 'guardian_subagent' }))).status).toBe(200);
    expect(calls[1].params).toEqual({ threadId: THREAD, turnId: TURN, serviceTier: null, approvalsReviewer: 'guardian_subagent' });
    expect(bridge.models).not.toHaveBeenCalled();
  });

  it('uses exact native catalogue effort values without marketing aliases or model substitution', async () => {
    expect((await request('PATCH', input({ effort: 'literal wire effort' }))).status).toBe(200);
    expect(calls[0].params).toEqual({ threadId: THREAD, turnId: TURN, effort: 'literal wire effort' });
    expect((await request('PATCH', input({ serviceTier: 'fast' }))).status).toBe(200);
    expect(calls[1].params).toEqual({ threadId: THREAD, turnId: TURN, serviceTier: 'fast' });
  });

  it('offers and forwards Ultrafast for every model, including future models without advertised tiers', async () => {
    catalog.catalog[0].serviceTiers = [{ id: 'priority', name: 'Fast', description: '' }];
    catalog.catalog[1].model = 'future/owned-model'; catalog.catalog[1].serviceTiers = [];
    catalog.models[1] = 'future/owned-model';
    const result = await request();
    expect(result.status).toBe(200);
    for (const choice of result.body.models) {
      expect(choice.serviceTiers).toContainEqual({ id: 'ultrafast', name: 'Ultrafast' });
      expect((await request('PATCH', input({ model: choice.model, serviceTier: 'ultrafast' }))).status).toBe(200);
    }
    expect(calls).toEqual(catalog.catalog.map(model => ({ method: METHOD,
      params: { threadId: THREAD, turnId: TURN, model: model.model, serviceTier: 'ultrafast' } })));
    expect(catalog.catalog.every(model => !model.serviceTiers?.some(tier => tier.id === 'ultrafast'))).toBe(true);
  });

  it('preserves an advertised Ultrafast entry without duplicating it', async () => {
    catalog.catalog[0].serviceTiers!.push({ id: 'ultrafast', name: 'Ultrafast', description: 'Native advertised tier' });
    const result = await request();
    expect(result.status).toBe(200);
    expect(result.body.models[0].serviceTiers.filter((tier: { id: string }) => tier.id === 'ultrafast'))
      .toEqual([{ id: 'ultrafast', name: 'Ultrafast' }]);
  });

  it('allows an Ultrafast-only request without depending on model metadata', async () => {
    bridge.models = undefined; view.native!.model = 'future/uncatalogued-model';
    expect((await request('PATCH', input({ serviceTier: 'ultrafast' }))).status).toBe(200);
    expect(calls).toEqual([{ method: METHOD, params: { threadId: THREAD, turnId: TURN, serviceTier: 'ultrafast' } }]);
  });

  it.each(SERVICE_TIERS)('passes $id unchanged for an uncatalogued model without a model lookup', async tier => {
    bridge.models = undefined; view.native!.model = 'future/uncatalogued-model';
    expect((await request('PATCH', input({ serviceTier: tier.id }))).status).toBe(200);
    expect(calls).toEqual([{ method: METHOD, params: { threadId: THREAD, turnId: TURN, serviceTier: tier.id } }]);
    expect(ctx.saveSettings).not.toHaveBeenCalled();
  });

  it('returns a native Ultrafast rejection without retrying or substituting another tier', async () => {
    handler = () => { throw new HttpError(400, 'Ultrafast is unavailable for this model.', 'CODEX_RPC_REJECTED'); };
    const result = await request('PATCH', input({ model: 'native/second', serviceTier: 'ultrafast' }));
    expect(result.status).toBe(400); expect(result.body).toMatchObject({ code: 'CODEX_RPC_REJECTED', error: 'Ultrafast is unavailable for this model.' });
    expect(calls).toEqual([{ method: METHOD, params: { threadId: THREAD, turnId: TURN, model: 'native/second', serviceTier: 'ultrafast' } }]);
  });

  it('refuses uncatalogued models, efforts, and tiers before native dispatch', async () => {
    for (const fields of [{ model: 'invented/model' }, { effort: 'marketing-max' }, { model: 'native/second', effort: 'low' },
      { serviceTier: 'invented-tier' }]) {
      expect((await request('PATCH', input(fields))).status).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it('rechecks exact turn identity after catalogue work and fences stale generations', async () => {
    expect((await request('PATCH', input({ expectedGeneration: 'older-native-generation', summary: 'auto' }))).status).toBe(409);
    expect((await request('PATCH', input({ expectedTurnId: NEXT_TURN, summary: 'auto' }))).status).toBe(409);
    catalogHook = () => { view.native!.activeTurnId = NEXT_TURN; };
    const result = await request('PATCH', input({ model: 'native/second' }));
    expect(result.status).toBe(409); expect(result.body.code).toBe('CODEX_ACTIVE_TURN_CHANGED'); expect(calls).toEqual([]);
  });

  it('returns targetUnavailable verbatim and rejects malformed acknowledgments', async () => {
    nativeResult = { status: 'targetUnavailable' };
    const result = await request('PATCH', input({ summary: 'concise' }));
    expect(result.status).toBe(200); expect(result.body.status).toBe('targetUnavailable'); expect(result.body).not.toHaveProperty('applied');
    nativeResult = { status: 'queued' };
    const invalid = await request('PATCH', input({ summary: 'detailed' }));
    expect(invalid.status).toBe(502); expect(invalid.body.outcomeUnknown).toBe(true);
  });

  it('retains actual native rejection and makes an unimplemented method unavailable for that runtime', async () => {
    handler = () => { throw Object.assign(new HttpError(501, 'Method not found', 'CODEX_METHOD_UNAVAILABLE'), { nativeCode: -32601, nativeMethod: METHOD }); };
    expect((await request('PATCH', input({ summary: 'auto' }))).status).toBe(501);
    const unavailable = await request(); expect(unavailable.body.canRequest).toBe(false); expect(unavailable.body.unavailableReason).toMatch(/rejected current-turn settings/);
    expect((await request('PATCH', input({ summary: 'none' }))).status).toBe(501); expect(calls).toHaveLength(1);
    generation = 'new-runtime-generation'; handler = undefined;
    expect((await request()).body.canRequest).toBe(true);
  });

  it('keeps native option errors readable while redacting known server credentials', async () => {
    handler = () => { throw new HttpError(400, `Native model change rejected: unavailable tier. ${ctx.config.password}`, 'CODEX_RPC_REJECTED'); };
    const result = await request('PATCH', input({ summary: 'auto' }));
    expect(result.status).toBe(400); expect(result.body.error).toContain('unavailable tier'); expect(result.body.error).not.toContain(ctx.config.password);
    expect(calls).toHaveLength(1);
  });

  it('does not retry an update whose runtime changed after dispatch', async () => {
    handler = () => { generation = 'replaced-after-dispatch'; return { status: 'applied' }; };
    const result = await request('PATCH', input({ summary: 'auto' }));
    expect(result.status).toBe(409); expect(result.body.outcomeUnknown).toBe(true); expect(calls).toHaveLength(1);
  });

  it('admits one explicit update per thread while a native result is pending', async () => {
    let settle!: (value: unknown) => void;
    handler = () => new Promise(resolve => { settle = resolve; });
    const first = request('PATCH', input({ summary: 'concise' }));
    try {
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      const second = await request('PATCH', input({ summary: 'detailed' }));
      expect(second.status).toBe(409); expect(second.body.code).toBe('CODEX_TURN_SETTINGS_BUSY');
    } finally { settle({ status: 'applied' }); }
    expect((await first).body.status).toBe('applied'); expect(calls).toHaveLength(1);
  });
});
