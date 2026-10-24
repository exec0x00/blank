import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { request as httpRequest, type ClientRequest, type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import https from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
import { createApplication } from '../server/index';
import { loadConfig } from '../server/config';
import { HttpError } from '../server/errors';
import { JsonStore } from '../server/store';
import type { CodexBridge } from '../server/codex-cli/bridge';
import type { NativeNotification, NativeServerRequest, RpcId } from '../server/codex-cli/rpc';
import type { CodexRuntimeStatus, CodexModelCatalog } from '../shared/codex-cli';
import type { AgentEvent, NativeItemDetail, Thread, UiState, Workspace } from '../shared/types';
import { inputAcceptance } from '../client/components/chat/input-shortcuts';

const runtimeSlot = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('../server/codex-cli/runtime', () => ({ getCodexRuntime: () => {
  if (!runtimeSlot.current) throw new Error('The owned native HTTP fixture runtime was not installed.');
  return runtimeSlot.current;
} }));

/* Migration coverage map (the old suites remain independently owned):
 * agent-api: custom engine runId/queue/approval fixtures -> actual native UUIDv7
 *   turn acknowledgments, native queue IDs and connection-bound RPC replies.
 * auth-sse: custom engine listeners/pendingQuestion -> actual native snapshot
 *   subscription, session close and read/reconnect without native work.
 * integration/ui-state: retired thread-index selection -> authorized native
 *   workspace/root selection in the real durable site store.
 * agent-http: direct Responses/provider-loop assertions belong to retired
 *   transport tests; this boundary neither implements nor calls that loop.
 * Custom changes/rewind/context/workflow actions -> explicit authenticated410.
 * These are controlled official0.155.1 DTOs, not model-success evidence.
 */
const ROOT = '01990000-0000-7000-8000-000000000001';
const PEER = '01990000-0000-7000-8000-000000000002';
const TURN = '01990000-0000-7000-8000-000000000101';
const QUEUED = '01990000-0000-7000-8000-000000000201';
const CLIENT = '11111111-1111-4111-8111-111111111111';
const PASSWORD = 'owned-native-http-password';
const SETTINGS = { model: 'native/http-fixture', model_reasoning_effort: 'literal-effort', model_reasoning_summary: 'none',
  model_verbosity: 'medium', web_search: 'disabled', approval_policy: 'on-request' };
const READ_METHODS = new Set(['config/read', 'thread/read', 'thread/list', 'thread/items/list', 'thread/turns/list',
  'thread/queue/list', 'thread/goal/get']);
const METHODS = new Set([...READ_METHODS, 'thread/start', 'thread/name/set', 'thread/resume', 'turn/start', 'turn/steer',
  'turn/interrupt', 'thread/queue/add', 'thread/queue/delete', 'thread/queue/start', 'thread/revert']);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const nativeTurn = (status = 'inProgress') => ({ id: TURN, status, items: [], itemsView: 'notLoaded', error: null,
  startedAt: 1_700_000_001, completedAt: status === 'inProgress' ? null : 1_700_000_010 });
const nativeThread = (cwd: string, id = ROOT, extra: Record<string, unknown> = {}) => ({ id, cwd,
  createdAt: 1_700_000_000, updatedAt: 1_700_000_001, status: { type: 'idle' }, name: 'Owned native DTO fixture',
  model: SETTINGS.model, modelProvider: 'workspace_owner', reasoningEffort: SETTINGS.model_reasoning_effort,
  parentThreadId: null, forkedFromId: null, turns: [], ...extra });

/** Records only native RPC dispatch/acknowledgment. It runs no model, tool,
 * shell, installer, native executable, queue drain or automatic goal loop. */
class NativeHttpRuntime implements CodexBridge {
  current = 'owned-http-generation-one';
  state: CodexRuntimeStatus['state'] = 'ready';
  unavailable = new Set<string>();
  threads = new Map<string, Record<string, unknown>>();
  itemPage: Record<string, unknown> = { data: [], nextCursor: null, backwardsCursor: null };
  turnPage: Record<string, unknown> = { data: [], nextCursor: null, backwardsCursor: null };
  queue: Array<{ id: string; clientUserMessageId: string; input: unknown[] }> = [];
  goal: Record<string, unknown> | null = null;
  calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  replies: Array<{ id: RpcId; result: unknown; generation: string }> = [];
  rejected: Array<{ id: RpcId; generation: string }> = [];
  handlers = new Map<string, (params: Record<string, unknown>) => unknown | Promise<unknown>>();
  notifications = new Set<(message: NativeNotification, generation: string) => void>();
  requests = new Set<(message: NativeServerRequest, generation: string) => void>();
  connections = new Set<(state: 'ready' | 'closed', generation: string) => void>();
  start = vi.fn(async () => { throw new Error('HTTP fixtures must not launch native Codex.'); });
  restart = vi.fn(async () => this.status());
  constructor(readonly preferencesPath: string) {}
  generation() { return this.state === 'ready' ? this.current : null; }
  supports(method: string) { return METHODS.has(method) && !this.unavailable.has(method); }
  status(): CodexRuntimeStatus { return { backend: 'codex-cli', state: this.state, version: '0.155.1', installedVersion: '0.155.1',
    startedAt: null, updatedAt: '2026-09-22T00:00:00.000Z', canUpdate: true, updateBlockedReason: null,
    error: this.state === 'error' ? 'Owned fixture: native Codex is unavailable.' : null, activeTurns: 0,
    capabilities: { conversations: this.state === 'ready', pagination: true,
      queue: ['thread/queue/add', 'thread/queue/list', 'thread/queue/delete', 'thread/queue/start'].every(method => this.supports(method)),
      goals: false, skills: false, plan: true, review: false, historyRevert: this.supports('thread/revert') } }; }
  async models(): Promise<CodexModelCatalog> {
    const models = [SETTINGS.model, 'native/literal-wire'];
    return { backend: 'codex-cli', connected: this.state === 'ready', models, catalog: models.map(model => ({
      id: model, model, displayName: model, description: 'Owned native metadata fixture', hidden: false, isDefault: model === SETTINGS.model,
      inputModalities: ['text'], supportedReasoningEfforts: [{ reasoningEffort: 'literal-effort', description: '' }],
      defaultReasoningEffort: 'literal-effort', maximumContextWindow: 120_000, contextWindow: 120_000,
    })) };
  }
  async request<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    if (!record(params)) throw new Error('The native HTTP fixture requires object RPC parameters.');
    this.calls.push({ method, params: structuredClone(params) });
    if (this.state !== 'ready') throw new HttpError(503, 'Owned native connection is unavailable.', 'CODEX_UNAVAILABLE');
    const override = this.handlers.get(method); if (override) return await override(params) as T;
    const threadId = String(params.threadId || ROOT), thread = this.threads.get(threadId);
    if (method === 'config/read') return { config: { ...SETTINGS }, origins: {}, layers: [
      { name: { type: 'user', file: this.preferencesPath, profile: null }, version: 'owned-native-config-v1', config: { ...SETTINGS }, disabledReason: null },
    ] } as T;
    if (method === 'thread/start') {
      const created = nativeThread(String(params.cwd)); this.threads.set(ROOT, created);
      return { thread: structuredClone(created) } as T;
    }
    if (method === 'thread/read') {
      if (!thread) throw new HttpError(404, 'Owned native thread not found.', 'CODEX_RPC_REJECTED');
      return { thread: structuredClone(thread) } as T;
    }
    if (method === 'thread/list') return { data: [...this.threads.values()].map(value => structuredClone(value)), nextCursor: null, backwardsCursor: null } as T;
    if (method === 'thread/name/set') { if (thread) thread.name = params.name; return {} as T; }
    if (method === 'thread/resume') {
      if (!thread) throw new Error('Missing native fixture for explicit resume.');
      thread.status = { type: 'idle' }; return { thread: structuredClone(thread) } as T;
    }
    if (method === 'thread/items/list') return structuredClone(this.itemPage) as T;
    if (method === 'thread/turns/list') return structuredClone(this.turnPage) as T;
    if (method === 'thread/queue/list') return { data: structuredClone(this.queue), nextCursor: null } as T;
    if (method === 'thread/goal/get') return { goal: structuredClone(this.goal) } as T;
    if (method === 'turn/start' || method === 'thread/queue/start') return { turn: nativeTurn() } as T;
    if (method === 'turn/steer') return { turnId: TURN } as T;
    if (method === 'turn/interrupt') return {} as T;
    if (method === 'thread/queue/add') {
      const queued = { id: QUEUED, clientUserMessageId: String(params.clientUserMessageId), input: structuredClone(params.input) as unknown[] };
      this.queue = [queued]; return { queuedSubmission: structuredClone(queued) } as T;
    }
    if (method === 'thread/queue/delete') {
      const deleted = this.queue.some(value => value.id === params.queuedSubmissionId);
      this.queue = this.queue.filter(value => value.id !== params.queuedSubmissionId); return { deleted } as T;
    }
    throw new Error(`Unexpected native HTTP fixture RPC: ${method}`);
  }
  respond(id: RpcId, result: unknown, generation: string) {
    if (generation !== this.current) throw new Error('The site attempted a stale native reply.');
    this.replies.push({ id, result: structuredClone(result), generation });
  }
  rejectRequest(id: RpcId, _message: string, generation: string) { this.rejected.push({ id, generation }); }
  onNotification(listener: (message: NativeNotification, generation: string) => void) { this.notifications.add(listener); return () => { this.notifications.delete(listener); }; }
  onRequest(listener: (message: NativeServerRequest, generation: string) => void) { this.requests.add(listener); return () => { this.requests.delete(listener); }; }
  onConnection(listener: (state: 'ready' | 'closed', generation: string) => void) { this.connections.add(listener); return () => { this.connections.delete(listener); }; }
  serverRequest(id: RpcId, method: string, params: Record<string, unknown>) {
    for (const listener of this.requests) listener({ id, method, params }, this.current);
  }
  reconnect() {
    const previous = this.current; this.state = 'stopped';
    for (const listener of this.connections) listener('closed', previous);
    this.current = 'owned-http-generation-two'; this.state = 'ready';
    for (const thread of this.threads.values()) thread.status = { type: 'notLoaded' };
    for (const listener of this.connections) listener('ready', this.current);
  }
  async close() {
    this.state = 'stopped';
    for (const listener of this.connections) listener('closed', this.current);
  }
}

type Application = Awaited<ReturnType<typeof createApplication>>;
type Reply = { status: number; headers: IncomingHttpHeaders; body: any; text: string };
type RequestOptions = { method?: string; body?: unknown; cookie?: string | false; origin?: string; marker?: boolean };
let directory: string, app: Application | undefined, runtime: NativeHttpRuntime, workspace: Workspace, origin: string, cookie: string;
const sockets = new Set<ClientRequest>();
const mutations = () => runtime.calls.filter(call => !READ_METHODS.has(call.method));
function headers(options: RequestOptions = {}): Record<string, string> {
  return { 'Content-Type': 'application/json', Origin: options.origin ?? origin,
    ...(options.marker === false ? {} : { 'X-Codex-Workspace': '1' }),
    ...(options.cookie === false ? {} : { Cookie: options.cookie ?? cookie }) };
}
async function request(route: string, options: RequestOptions = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(origin + route, { method: options.method ?? 'GET', headers: headers(options), agent: false }, response => {
      let text = ''; response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; }); response.once('error', reject);
      response.once('end', () => {
        try { resolve({ status: response.statusCode!, headers: response.headers, text, body: text ? JSON.parse(text) : null }); }
        catch (error) { reject(error); }
      });
    });
    sockets.add(req); req.once('close', () => sockets.delete(req)); req.once('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Owned HTTP request timed out.')));
    req.end(options.body === undefined ? undefined : JSON.stringify(options.body));
  });
}
async function until(predicate: () => boolean | Promise<boolean>, message: string): Promise<void> {
  const end = Date.now() + 3000;
  while (!await predicate()) { if (Date.now() >= end) throw new Error(message); await delay(5); }
}
async function eventStream(lastEventId?: string) {
  const req = httpRequest(`${origin}/api/threads/${ROOT}/events`, { headers: { ...headers(), ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}) }, agent: false });
  sockets.add(req); req.once('close', () => sockets.delete(req));
  const response = await new Promise<IncomingMessage>((resolve, reject) => { req.once('response', resolve); req.once('error', reject); req.end(); });
  let text = ''; response.setEncoding('utf8'); response.on('data', chunk => { text += chunk; });
  const closed = new Promise<void>(resolve => response.once('close', resolve));
  const frames = (): AgentEvent[] => text.split('\n\n').slice(0, -1).filter(frame => frame.includes('\ndata: ') || frame.startsWith('data: '))
    .flatMap(frame => frame.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)) as AgentEvent));
  const ids = () => text.split('\n\n').slice(0, -1).flatMap(frame => frame.split('\n').filter(line => line.startsWith('id: ')).map(line => line.slice(4)));
  return { response, text: () => text, frames, ids, closed, close: async () => { req.destroy(); response.destroy(); await closed; } };
}
async function view(): Promise<Thread> { const result = await request(`/api/threads/${ROOT}`); expect(result.status).toBe(200); return result.body as Thread; }
async function configuredThread() {
  expect((await request('/api/threads', { method: 'POST', body: { workspaceId: workspace.id } })).status).toBe(201);
  runtime.calls = [];
}
async function pending(kind: 'approvals' | 'questions') {
  let current: Thread | undefined;
  await until(async () => { current = await view(); return !!current.native?.[kind].length; }, `Native ${kind} fixture was not published.`);
  return current!.native![kind][0]!;
}

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-cli-http-'));
  const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: path.join(directory, 'data'), RUNTIME_DIR: path.join(directory, 'runtime'),
    CLIENT_DIST_DIR: path.join(directory, 'unused-client'), REQUIRE_PERSISTENT_DATA: '0',
    WORKSPACE_PASSWORD: PASSWORD, SESSION_SECRET: 'owned-native-http-session-secret-32-bytes', ENCRYPTION_KEY: 'owned-native-http-encryption-key-32-bytes' });
  expect(config.codexCliAutoStart).toBe(false);
  runtime = new NativeHttpRuntime(path.join(config.dataDir, 'codex-workspace', 'native-codex', 'config.toml'));
  runtimeSlot.current = runtime;
  vi.spyOn(https, 'request').mockImplementation(() => { throw new Error('Native HTTP tests must not call HTTPS or a provider.'); });
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Native HTTP tests must not call providers, registries or HF.'); }));
  app = await createApplication(config);
  workspace = await app.ctx.workspaces.create({ name: 'Owned native HTTP fixture' });
  runtime.threads.set(ROOT, nativeThread(workspace.path));
  await new Promise<void>(resolve => app!.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('Owned application did not listen.');
  origin = `http://127.0.0.1:${address.port}`; cookie = '';
  const login = await request('/api/session', { method: 'POST', body: { password: PASSWORD }, cookie: false });
  expect(login.status).toBe(200); cookie = login.headers['set-cookie']![0]!.split(';')[0]!;
});
afterEach(async () => {
  for (const socket of sockets) socket.destroy(); sockets.clear();
  if (app) { await app.close(); await app.ctx.store.flush(); app = undefined; }
  expect(runtime.start).not.toHaveBeenCalled(); expect(https.request).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  expect(runtime.notifications.size + runtime.requests.size + runtime.connections.size).toBe(0);
  runtimeSlot.current = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

describe('native Codex HTTP authentication and route contract', () => {
  it('starts the real site without starting Codex or sending any native RPC', async () => {
    expect(runtime.calls).toEqual([]);
    expect((await request('/health', { cookie: false })).body).toEqual({ status: 'ok' });
    const status = await request('/api/codex/runtime');
    expect(status.status).toBe(200); expect(status.body).toMatchObject({ backend: 'codex-cli', state: 'ready', version: '0.155.1' });
    expect(status.headers['cache-control']?.split(',').map(value => value.trim())).toEqual(expect.arrayContaining(['private', 'no-store', 'max-age=0']));
    expect(runtime.calls).toEqual([]);
  });
  it('requires the real session on native metadata, history, queue, event and site-file reads', async () => {
    for (const route of ['/api/codex/runtime', '/api/threads', `/api/threads/${ROOT}`, `/api/threads/${ROOT}/history`,
      `/api/threads/${ROOT}/queue`, `/api/threads/${ROOT}/events`, '/api/ui-state', `/api/workspaces/${workspace.id}/file?path=note.txt`]) {
      const response = await request(route, { cookie: false });
      expect(response.status, route).toBe(401); expect(response.body).toMatchObject({ code: 'AUTH_REQUIRED' });
    }
    expect(runtime.calls).toEqual([]);
  });
  it.each([
    { name: 'another origin', options: { origin: 'https://another.invalid' }, status: 403 },
    { name: 'opaque origin', options: { origin: 'null' }, status: 403 },
    { name: 'missing application header', options: { marker: false }, status: 403 },
    { name: 'missing session', options: { cookie: false as const }, status: 401 },
  ])('rejects $name before any native mutation or callback', async ({ options, status }) => {
    for (const route of ['/api/threads', `/api/threads/${ROOT}/run`, `/api/threads/${ROOT}/input`, `/api/threads/${ROOT}/queue`,
      `/api/threads/${ROOT}/approval`, `/api/threads/${ROOT}/answer`, '/api/codex/runtime/update', '/api/codex/runtime/restart']) {
      const response = await request(route, { ...options, method: 'POST', body: { prompt: 'Rejected at the session boundary.' } });
      expect(response.status, route).toBe(status);
    }
    expect(runtime.calls).toEqual([]); expect(runtime.replies).toEqual([]);
  });
  it.each([
    ['POST', '/changes'], ['GET', '/changes/retired-change'], ['POST', `/threads/${ROOT}/auto-name`],
    ['POST', `/threads/${ROOT}/rewind`], ['GET', `/threads/${ROOT}/context-details`],
  ])('keeps retired custom %s %s explicitly disabled behind authentication', async (method, route) => {
    const response = await request('/api' + route, { method, body: method === 'GET' ? undefined : {} });
    expect(response.status).toBe(410); expect(response.body).toMatchObject({ code: 'CUSTOM_AGENT_FEATURE_REMOVED' });
    expect(runtime.calls).toEqual([]);
  });
  it('keeps retired workspace workflow actions disabled rather than invoking a custom engine', async () => {
    const response = await request(`/api/workspaces/${workspace.id}/workflows`);
    expect(response.status).toBe(410); expect(response.body.code).toBe('CUSTOM_AGENT_FEATURE_REMOVED'); expect(runtime.calls).toEqual([]);
  });
  it.each([
    ['create injection', '/threads', { workspaceId: 'fixture', cwd: '/forged' }],
    ['empty run', `/threads/${ROOT}/run`, {}],
    ['blank run', `/threads/${ROOT}/run`, { prompt: '   ' }],
    ['provider override', `/threads/${ROOT}/run`, { prompt: 'Task', modelProvider: 'other-provider' }],
    ['raw native config', `/threads/${ROOT}/run`, { prompt: 'Task', config: { base_url: 'https://unapproved.invalid' } }],
    ['custom output budget', `/threads/${ROOT}/run`, { prompt: 'Task', maxOutputTokens: 123 }],
    ['malformed wire model', `/threads/${ROOT}/run`, { prompt: 'Task', model: 'model with whitespace' }],
    ['steering run options', `/threads/${ROOT}/input`, { prompt: 'Steer', model: 'other' }],
    ['custom interrupt flag', `/threads/${ROOT}/input`, { prompt: 'Steer', interrupt: true }],
    ['queued permission override', `/threads/${ROOT}/queue`, { prompt: 'Later', permissionMode: 'full-access' }],
    ['queued model override', `/threads/${ROOT}/queue`, { prompt: 'Later', model: 'other' }],
    ['legacy approval boolean', `/threads/${ROOT}/approval`, { approvalId: 'request', approved: true }],
    ['invalid approval decision', `/threads/${ROOT}/approval`, { approvalId: 'request', decision: 'execute' }],
    ['malformed answer value', `/threads/${ROOT}/answer`, { requestId: 'request', answers: { scope: ['bad'] } }],
  ])('rejects %s without dispatching native work', async (_label, route, body) => {
    const response = await request('/api' + route, { method: 'POST', body });
    expect(response.status).toBe(400); expect(response.body.code).toBe('VALIDATION_ERROR'); expect(runtime.calls).toEqual([]);
  });
});

describe('real HTTP native acknowledgments and durable site identity', () => {
  it('exposes explicit native restart through the authenticated strict action route', async () => {
    const invalid = await request('/api/codex/runtime/restart', { method: 'POST', body: { force: true } });
    expect(invalid.status).toBe(400); expect(runtime.restart).not.toHaveBeenCalled();
    const response = await request('/api/codex/runtime/restart', { method: 'POST', body: {} });
    expect(response.status).toBe(202); expect(response.body).toMatchObject({ backend: 'codex-cli', state: 'ready' });
    expect(runtime.restart).toHaveBeenCalledOnce(); expect(runtime.start).not.toHaveBeenCalled();
  });
  it('creates one native conversation with a fixed provider and persists only its site binding', async () => {
    const response = await request('/api/threads', { method: 'POST', body: { workspaceId: workspace.id, title: 'Named from HTTP' } });
    expect(response.status).toBe(201); expect(response.body).toMatchObject({ id: ROOT, workspaceId: workspace.id, backend: 'codex-cli', title: 'Named from HTTP' });
    expect(mutations()).toEqual([
      { method: 'thread/start', params: { cwd: workspace.path, model: SETTINGS.model, modelProvider: 'workspace_owner',
        allowProviderModelFallback: false, sandbox: 'danger-full-access', approvalPolicy: 'on-request', serviceTier: 'fast',
        config: { model_context_window: 120_000, model_auto_compact_token_limit: 108_000 },
        ephemeral: false, experimentalRawEvents: false } },
      { method: 'thread/name/set', params: { threadId: ROOT, name: 'Named from HTTP' } },
    ]);
    await app!.ctx.store.flush();
    const persisted = await new JsonStore(app!.ctx.config.stateDir).read(`codex-thread-${ROOT}`, null);
    expect(persisted).toMatchObject({ version: 1, id: ROOT, workspaceId: workspace.id, cwd: workspace.path });
    expect(persisted).not.toHaveProperty('messages'); expect(response.body).not.toHaveProperty('pendingQuestion');
  });
  it('returns only the native turn/client acknowledgment and forwards exact supported run options', async () => {
    await configuredThread();
    const response = await request(`/api/threads/${ROOT}/run`, { method: 'POST', body: { prompt: 'Owned HTTP input.', clientUserMessageId: CLIENT,
      model: 'native/literal-wire', reasoningEffort: 'literal-plus', reasoningSummary: 'concise', permissionMode: 'full-access', mode: 'plan' } });
    expect(response.status).toBe(202); expect(response.body).toEqual({ threadId: ROOT, turnId: TURN, clientUserMessageId: CLIENT });
    expect(mutations()).toEqual([{ method: 'turn/start', params: { threadId: ROOT, clientUserMessageId: CLIENT,
      input: [{ type: 'text', text: 'Owned HTTP input.', text_elements: [] }], model: 'native/literal-wire', effort: 'literal-plus',
      summary: 'concise', serviceTier: 'fast', approvalPolicy: 'never', collaborationMode: { mode: 'plan', settings: { model: 'native/literal-wire', reasoning_effort: 'literal-plus', developer_instructions: null } } } }]);
    expect(response.body).not.toHaveProperty('runId'); expect(response.body).not.toHaveProperty('messages');
    const calls = runtime.calls.length;
    expect(inputAcceptance(response.body, 'run', ROOT, CLIENT)).toEqual({ threadId: ROOT, turnId: TURN, delivery: 'run' });
    expect(() => inputAcceptance(response.body, 'run', PEER, CLIENT)).toThrow(/did not confirm/);
    expect(runtime.calls).toHaveLength(calls);
  });
  it.each(['auto', 'default', 'flex', 'scale', 'priority', 'fast', 'ultrafast'])('accepts literal %s on a strict run request', async serviceTier => {
    await configuredThread();
    const response = await request(`/api/threads/${ROOT}/run`, { method: 'POST', body: {
      prompt: 'Use this exact tier.', clientUserMessageId: CLIENT, serviceTier,
    } });
    expect(response.status).toBe(202);
    const starts = mutations().filter(call => call.method === 'turn/start');
    expect(starts).toHaveLength(1); expect(starts[0].params.serviceTier).toBe(serviceTier);
  });
  it('strips HTTP prompt from steering options and binds the exact active native turn', async () => {
    const response = await request(`/api/threads/${ROOT}/input`, { method: 'POST', body: { prompt: 'Owned steering input.', clientUserMessageId: CLIENT, expectedTurnId: TURN } });
    expect(response.status).toBe(202); expect(response.body).toEqual({ threadId: ROOT, turnId: TURN, clientUserMessageId: CLIENT });
    expect(mutations()).toEqual([{ method: 'turn/steer', params: { threadId: ROOT, expectedTurnId: TURN, clientUserMessageId: CLIENT,
      input: [{ type: 'text', text: 'Owned steering input.', text_elements: [] }] } }]);
    const calls = runtime.calls.length;
    expect(inputAcceptance(response.body, 'steer', ROOT, CLIENT, TURN)).toEqual({ threadId: ROOT, turnId: TURN, delivery: 'steer' });
    expect(() => inputAcceptance(response.body, 'steer', ROOT, CLIENT, PEER)).toThrow(/did not confirm/);
    expect(runtime.calls).toHaveLength(calls);
  });
  it('refuses to guess a native turn when steering an idle conversation', async () => {
    const response = await request(`/api/threads/${ROOT}/input`, { method: 'POST', body: { prompt: 'No active turn.' } });
    expect(response.status).toBe(409); expect(response.body.code).toBe('CODEX_ACTIVE_TURN_REQUIRED'); expect(mutations()).toEqual([]);
  });
  it('preserves a native queue acknowledgment, bounded page and exact deletion without automatic start', async () => {
    const response = await request(`/api/threads/${ROOT}/queue`, { method: 'POST', body: { prompt: 'Owned queued input.', clientUserMessageId: CLIENT } });
    expect(response.status).toBe(202); expect(response.body).toEqual({ threadId: ROOT, queuedSubmission: { id: QUEUED, clientUserMessageId: CLIENT }, clientUserMessageId: CLIENT });
    const calls = runtime.calls.length;
    const accepted = inputAcceptance(response.body, 'next_turn', ROOT, CLIENT);
    expect(accepted).toEqual({ threadId: ROOT, queuedSubmission: { id: QUEUED, clientUserMessageId: CLIENT }, delivery: 'next_turn' });
    expect(response.body.queuedSubmission).not.toHaveProperty('prompt'); expect(response.body.queuedSubmission).not.toHaveProperty('attachmentNames');
    expect(inputAcceptance({ ...response.body, queuedSubmission: { ...response.body.queuedSubmission, incidental: 'discard this extra field' } }, 'next_turn', ROOT, CLIENT)).toEqual(accepted);
    expect(() => inputAcceptance(response.body, 'next_turn', ROOT, 'another-client-correlation')).toThrow(/did not confirm/);
    expect(runtime.calls).toHaveLength(calls);
    const page = await request(`/api/threads/${ROOT}/queue?limit=60`);
    expect(page.body).toEqual({ items: [{ id: QUEUED, clientUserMessageId: CLIENT, prompt: 'Owned queued input.', attachmentNames: [] }], nextCursor: null });
    expect(runtime.calls.filter(call => call.method === 'thread/queue/list').every(call => call.params.limit === 1)).toBe(true);
    const removed = await request(`/api/threads/${ROOT}/queue/${QUEUED}`, { method: 'DELETE' });
    expect(removed.status).toBe(200); expect(removed.body).toEqual({ deleted: true });
    expect(mutations().map(call => call.method)).toEqual(['thread/queue/add', 'thread/queue/delete']);
    expect(mutations()[1]!.params).toEqual({ threadId: ROOT, queuedSubmissionId: QUEUED });
  });
  it('starts an explicitly selected native queue entry only through its native action and then interrupts the exact turn', async () => {
    const response = await request(`/api/threads/${ROOT}/queue/${QUEUED}/resume`, { method: 'POST', body: {} });
    expect(response.status).toBe(202); expect(response.body).toEqual({ threadId: ROOT, turnId: TURN });
    const stopped = await request(`/api/threads/${ROOT}/stop`, { method: 'POST', body: { expectedTurnId: TURN } });
    expect(stopped.status).toBe(200); expect(stopped.body).toEqual({ stopped: true, turnId: TURN });
    expect(mutations()).toEqual([
      { method: 'thread/queue/start', params: { threadId: ROOT, queuedSubmissionId: QUEUED } },
      { method: 'turn/interrupt', params: { threadId: ROOT, turnId: TURN } },
    ]);
  });
  it('reports an unknown native acknowledgment as an error without inventing success or replaying it on read', async () => {
    await configuredThread();
    runtime.handlers.set('turn/start', () => { throw new HttpError(504, 'Owned unconfirmed native acknowledgment.', 'CODEX_ACKNOWLEDGMENT_TIMEOUT'); });
    const response = await request(`/api/threads/${ROOT}/run`, { method: 'POST', body: { prompt: 'Unconfirmed fixture input.', clientUserMessageId: CLIENT } });
    expect(response.status).toBe(504); expect(response.body.code).toBe('CODEX_ACKNOWLEDGMENT_TIMEOUT'); expect(response.body).not.toHaveProperty('turnId');
    await view(); runtime.reconnect(); await view();
    expect(mutations().map(call => call.method)).toEqual(['turn/start']);
  });
  it.each(['run', 'queue'] as const)('rejects a malformed native %s acknowledgment without inventing a site success', async action => {
    if (action === 'run') await configuredThread();
    const method = action === 'run' ? 'turn/start' : 'thread/queue/add';
    runtime.handlers.set(method, () => action === 'run'
      ? { turn: { ...nativeTurn(), id: 'retired-site-turn-alias' } }
      : { queuedSubmission: { id: QUEUED, clientUserMessageId: 'a-different-client-correlation', input: [] } });
    const response = await request(`/api/threads/${ROOT}/${action}`, { method: 'POST', body: { prompt: 'Malformed native acknowledgment fixture.', clientUserMessageId: CLIENT } });
    expect(response.status).toBe(502); expect(response.body.code).toBe('CODEX_PROTOCOL_ERROR');
    expect(response.body).not.toHaveProperty('turnId'); expect(response.body).not.toHaveProperty('queuedSubmission');
    await view(); expect(mutations().map(call => call.method)).toEqual([method]);
  });
  it('reports an unsupported native method without substituting custom queue execution', async () => {
    runtime.unavailable.add('thread/queue/add');
    const response = await request(`/api/threads/${ROOT}/queue`, { method: 'POST', body: { prompt: 'Unsupported queue fixture.' } });
    expect(response.status).toBe(501); expect(response.body.code).toBe('CODEX_METHOD_UNAVAILABLE'); expect(mutations()).toEqual([]);
  });
  it('rejects a native cwd outside the actual registered workspace before input dispatch', async () => {
    runtime.threads.set(ROOT, nativeThread(path.join(directory, 'unregistered-native-cwd')));
    const response = await request(`/api/threads/${ROOT}/run`, { method: 'POST', body: { prompt: 'Must not cross workspace scope.' } });
    expect(response.status).toBe(403); expect(response.body.code).toBe('CODEX_THREAD_SCOPE'); expect(mutations()).toEqual([]);
  });
  it('saves and reloads a native root selection without legacy indexing or resume, and rejects another workspace', async () => {
    const created = await request('/api/threads', { method: 'POST', body: { workspaceId: workspace.id } }); expect(created.status).toBe(201);
    runtime.threads.get(ROOT)!.status = { type: 'notLoaded' }; const before = mutations().length;
    const beforeSelection = runtime.calls.length;
    runtime.handlers.set('thread/items/list', () => { throw new HttpError(409, 'Owned empty native history.', 'CODEX_HISTORY_UNMATERIALIZED'); });
    runtime.handlers.set('thread/turns/list', () => { throw new HttpError(409, 'Owned empty native history.', 'CODEX_HISTORY_UNMATERIALIZED'); });
    const saved = await request('/api/ui-state', { method: 'PATCH', body: { revision: 0,
      changes: [{ section: 'workspace', workspaceId: workspace.id, key: 'threadId', value: ROOT }] } });
    expect(saved.status).toBe(200); expect(saved.body.workspaces[workspace.id]).toEqual({ threadId: ROOT });
    const reloaded = await request('/api/ui-state'); expect(reloaded.body).toEqual(saved.body);
    await app!.ctx.store.flush(); expect(await new JsonStore(app!.ctx.config.stateDir).read<UiState | null>('ui-state', null)).toEqual(saved.body);
    const other = await app!.ctx.workspaces.create({ name: 'Other owned HTTP workspace' });
    const rejected = await request('/api/ui-state', { method: 'PATCH', body: { revision: saved.body.revision,
      changes: [{ section: 'workspace', workspaceId: other.id, key: 'threadId', value: ROOT }] } });
    expect(rejected.status).toBe(400); expect(rejected.body.code).toBe('UI_STATE_THREAD_NOT_FOUND');
    expect((await request('/api/ui-state')).body).toEqual(saved.body); expect(mutations()).toHaveLength(before);
    const selectionReads = runtime.calls.slice(beforeSelection);
    expect(selectionReads.length).toBeGreaterThanOrEqual(2); expect(selectionReads.every(call => call.method === 'thread/read')).toBe(true);
  });
});

describe('native pending-request authority through the actual HTTP router', () => {
  async function commandApproval(rpcId: RpcId = 41) {
    runtime.serverRequest(rpcId, 'item/commandExecution/requestApproval', { threadId: ROOT, turnId: TURN, itemId: 'owned-command-item',
      command: 'printf native-fixture', cwd: workspace.path, reason: 'Controlled native callback fixture.', availableDecisions: ['accept', 'decline'] });
    return pending('approvals');
  }
  it('answers only the pending native request using an advertised decision and exact private RPC generation', async () => {
    const approval = await commandApproval();
    expect(approval.id).toMatch(/^native-request-/); expect(approval).not.toHaveProperty('rpcId');
    const unadvertised = await request(`/api/threads/${ROOT}/approval`, { method: 'POST', body: { approvalId: approval.id, decision: 'acceptForSession' } });
    expect(unadvertised.status).toBe(400); expect(runtime.replies).toEqual([]);
    const wrongThread = await request(`/api/threads/${PEER}/approval`, { method: 'POST', body: { approvalId: approval.id, decision: 'accept' } });
    expect(wrongThread.status).toBe(409); expect(runtime.replies).toEqual([]);
    const answered = await request(`/api/threads/${ROOT}/approval`, { method: 'POST', body: { approvalId: approval.id, decision: 'accept' } });
    expect(answered.status).toBe(200); expect(answered.body).toEqual({ accepted: true });
    expect(runtime.replies).toEqual([{ id: 41, result: { decision: 'accept' }, generation: 'owned-http-generation-one' }]);
    const repeated = await request(`/api/threads/${ROOT}/approval`, { method: 'POST', body: { approvalId: approval.id, decision: 'accept' } });
    expect(repeated.status).toBe(409); expect(repeated.body.code).toBe('CODEX_REQUEST_STALE'); expect(runtime.replies).toHaveLength(1);
  });
  it('retires old approval authority on a native connection change without restarting anything', async () => {
    const approval = await commandApproval('native-outer-rpc-id'); const before = runtime.calls.length;
    runtime.reconnect(); expect(runtime.calls).toHaveLength(before);
    const answered = await request(`/api/threads/${ROOT}/approval`, { method: 'POST', body: { approvalId: approval.id, decision: 'decline' } });
    expect(answered.status).toBe(409); expect(answered.body.code).toBe('CODEX_REQUEST_STALE'); expect(runtime.replies).toEqual([]); expect(mutations()).toEqual([]);
  });
  it('validates question IDs and sends secret answers only to the actual native callback', async () => {
    runtime.serverRequest(72, 'item/tool/requestUserInput', { threadId: ROOT, turnId: TURN, itemId: 'owned-question-item', isBlocking: true,
      questions: [{ id: 'scope', header: 'Fixture', question: 'Provide the owned test value.', isSecret: true, isOther: true, options: null }] });
    const question = await pending('questions'); const stream = await eventStream();
    try {
      await until(() => stream.frames().some(event => event.type === 'snapshot'), 'Native question snapshot missing.');
      const invalid = await request(`/api/threads/${ROOT}/answer`, { method: 'POST', body: { requestId: question.id, answers: { unknown: { answers: ['invalid'] } } } });
      expect(invalid.status).toBe(400); expect(runtime.replies).toEqual([]);
      const secret = 'owned-secret-answer-fixture-only';
      const answered = await request(`/api/threads/${ROOT}/answer`, { method: 'POST', body: { requestId: question.id, answers: { scope: { answers: [secret] } } } });
      expect(answered.status).toBe(200); expect(answered.body).toEqual({ accepted: true });
      expect(runtime.replies).toEqual([{ id: 72, result: { answers: { scope: { answers: [secret] } } }, generation: 'owned-http-generation-one' }]);
      expect(JSON.stringify(await view())).not.toContain(secret); expect(stream.text()).not.toContain(secret);
      await app!.ctx.store.flush();
      for (const file of await fs.readdir(app!.ctx.config.stateDir)) {
        const absolute = path.join(app!.ctx.config.stateDir, file);
        if ((await fs.lstat(absolute)).isFile()) expect((await fs.readFile(absolute)).includes(Buffer.from(secret)), file).toBe(false);
      }
      const repeated = await request(`/api/threads/${ROOT}/answer`, { method: 'POST', body: { requestId: question.id, answers: {} } });
      expect(repeated.status).toBe(409); expect(runtime.replies).toHaveLength(1);
    } finally { await stream.close(); }
  });
});

describe('native reads and unavailable-runtime isolation', () => {
  it('reads opaque native pages and reconnects SSE without resume, queue start, goal continuation or model requests', async () => {
    runtime.threads.set(ROOT, nativeThread(workspace.path, ROOT, { status: { type: 'notLoaded' } }));
    runtime.itemPage = { data: [{ turnId: TURN, item: { type: 'userMessage', id: 'owned-native-user-item', clientId: CLIENT,
      content: [{ type: 'text', text: 'Stored native user-input DTO.', text_elements: [] }] } }], nextCursor: 'native/next+==', backwardsCursor: 'native:previous?' };
    runtime.turnPage = { data: [nativeTurn('completed')], nextCursor: null, backwardsCursor: null };
    runtime.queue = [{ id: QUEUED, clientUserMessageId: CLIENT, input: [{ type: 'text', text: 'Native queued DTO.', text_elements: [] }] }];
    runtime.goal = { threadId: ROOT, objective: 'Stored native goal DTO.', status: 'active', tokenBudget: 100,
      tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1_700_000_000, updatedAt: 1_700_000_001 };
    expect((await request(`/api/threads?workspaceId=${workspace.id}&backend=codex-cli`)).status).toBe(200);
    const result = await request(`/api/threads/${ROOT}/history?after=${encodeURIComponent('native:old-anchor?')}&limit=60`);
    expect(result.status).toBe(200); expect(result.body.nativePage).toEqual({ nextCursor: 'native/next+==', backwardsCursor: 'native:previous?' });
    expect(result.body.messages[0]).toMatchObject({ content: 'Stored native user-input DTO.', clientUserMessageId: CLIENT, turnId: TURN });
    expect(result.body).not.toHaveProperty('history');
    expect(runtime.calls.find(call => call.method === 'thread/items/list')!.params).toEqual({ threadId: ROOT, limit: 1, sortDirection: 'asc', cursor: 'native:old-anchor?' });
    const beforeStream = runtime.calls.length, first = await eventStream();
    try {
      expect(first.response.statusCode).toBe(200); await until(() => first.frames().some(event => event.type === 'snapshot'), 'First native snapshot missing.');
      expect(runtime.calls.slice(beforeStream).filter(call => call.method === 'thread/items/list')).toHaveLength(1);
      expect(runtime.calls.slice(beforeStream).filter(call => call.method === 'thread/turns/list')).toHaveLength(1);
    }
    finally { await first.close(); }
    const before = runtime.calls.length; runtime.reconnect(); expect(runtime.calls).toHaveLength(before);
    const second = await eventStream();
    try { await until(() => second.frames().some(event => event.type === 'snapshot'), 'Reconnected native snapshot missing.'); }
    finally { await second.close(); }
    expect(runtime.calls.every(call => READ_METHODS.has(call.method))).toBe(true); expect(mutations()).toEqual([]);
    expect(runtime.calls.filter(call => call.method === 'thread/turns/list').every(call => call.params.itemsView === 'notLoaded')).toBe(true);
  });
  it('emits observable authorized heartbeats without polling or restarting native work', async () => {
    const stream = await eventStream();
    try {
      await until(() => stream.frames().some(event => event.type === 'snapshot'), 'Initial native snapshot missing.');
      const before = runtime.calls.length;
      await delay(15_010);
      await until(() => stream.text().includes('event: heartbeat\ndata: {}\n\n'), 'Observable heartbeat missing.');
      expect(runtime.calls).toHaveLength(before); expect(mutations()).toEqual([]);
      expect(stream.response.headers['cache-control']).toContain('private');
    } finally { await stream.close(); }
  }, 25_000);
  it('rejects ambiguous native cursor directions before touching the native bridge', async () => {
    const response = await request(`/api/threads/${ROOT}/history?before=opaque-one&after=opaque-two`);
    expect(response.status).toBe(400); expect(response.body.code).toBe('VALIDATION_ERROR'); expect(runtime.calls).toEqual([]);
  });
  it('closes the native event stream on session logout without issuing native cancellation or continuation', async () => {
    const listeners = app!.ctx.events.listenerCount('auth:logout'); const stream = await eventStream();
    try {
      await until(() => stream.frames().some(event => event.type === 'snapshot'), 'Authenticated native stream did not open.');
      const signedOut = await request('/api/session', { method: 'DELETE' }); expect(signedOut.status).toBe(200);
      await stream.closed;
      expect((await request(`/api/threads/${ROOT}`)).status).toBe(401);
      await until(() => app!.ctx.events.listenerCount('auth:logout') === listeners, 'Native stream retained its session listener.');
      expect(mutations()).toEqual([]);
    } finally { await stream.close(); }
  });
  it('keeps real workspace/file operations and appearance usable while native Codex is unavailable', async () => {
    runtime.state = 'error';
    expect((await request('/health', { cookie: false })).status).toBe(200);
    expect((await request('/api/codex/runtime')).body).toMatchObject({ backend: 'codex-cli', state: 'error' });
    const nativeRead = await request(`/api/threads/${ROOT}`); expect(nativeRead.status).toBe(503); expect(nativeRead.body.code).toBe('CODEX_UNAVAILABLE');
    const run = await request(`/api/threads/${ROOT}/run`, { method: 'POST', body: { prompt: 'Unavailable native input.' } });
    expect(run.status).toBe(503); expect(run.body.code).toBe('CODEX_UNAVAILABLE');
    const created = await request('/api/workspaces', { method: 'POST', body: { name: 'Usable owned site files' } });
    expect(created.status).toBe(201); const local = created.body as Workspace;
    const made = await request(`/api/workspaces/${local.id}/files`, { method: 'POST', body: { path: 'note.txt', kind: 'file' } }); expect(made.status).toBe(201);
    const initial = await request(`/api/workspaces/${local.id}/file?path=note.txt`); expect(initial.status).toBe(200);
    const saved = await request(`/api/workspaces/${local.id}/file`, { method: 'PUT', body: { path: 'note.txt', content: 'Real file while CLI is offline.\n', expectedVersion: initial.body.version } });
    expect(saved.status).toBe(200); expect((await request(`/api/workspaces/${local.id}/file?path=note.txt`)).body.content).toBe('Real file while CLI is offline.\n');
    expect(await fs.readFile(path.join(local.path, 'note.txt'), 'utf8')).toBe('Real file while CLI is offline.\n');
    const settings = await request('/api/settings', { method: 'PATCH', body: { fontSize: 19, wordWrap: true } });
    expect(settings.status).toBe(200); expect(settings.body).toMatchObject({ fontSize: 19, wordWrap: true, agentConfigured: false });
    expect(runtime.calls).toEqual([]); expect(runtime.replies).toEqual([]);
  });
});


describe('read-only native detail through the authenticated application', () => {
  const ITEM = 'owned-native-detail-item';
  const detailRoute = (changes: Record<string, string | undefined> = {}) => {
    const query = new URLSearchParams({ turnId: TURN, itemId: ITEM, field: 'text' });
    for (const [key, value] of Object.entries(changes)) { if (value === undefined) query.delete(key); else query.set(key, value); }
    return `/api/threads/${ROOT}/native-item-detail?${query}`;
  };
  const itemPage = (item: Record<string, unknown>, nextCursor: string | null = null) => ({ data: [{ turnId: TURN, item: { id: ITEM, ...item } }], nextCursor });
  function ready(response: Reply) {
    expect(response.status).toBe(200); const result = response.body as NativeItemDetail;
    expect(result.status).toBe('ready'); if (result.status !== 'ready') throw new Error('Expected a public native detail page.');
    return result;
  }
  function heldPage() {
    let entered = false, release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    runtime.handlers.set('thread/items/list', async () => {
      entered = true; await gate;
      return itemPage({ type: 'commandExecution', command: 'printf fixture', cwd: workspace.path, aggregatedOutput: 'HELD_PUBLIC_NATIVE_DETAIL' });
    });
    const read = request(detailRoute({ field: 'output' })); void read.catch(() => undefined);
    return { entered: () => entered, release, read };
  }

  it('authenticates detail reads and applies the normal origin policy before unsupported mutations', async () => {
    const guest = await request(detailRoute(), { cookie: false }); expect(guest.status).toBe(401); expect(guest.body.code).toBe('AUTH_REQUIRED');
    const foreign = await request(detailRoute(), { method: 'POST', origin: 'https://another.invalid', body: {} });
    expect(foreign.status).toBe(403); expect(foreign.body.code).toBe('ORIGIN_REQUIRED');
    const mutation = await request(detailRoute(), { method: 'POST', body: {} }); expect(mutation.status).toBe(404);
    expect(runtime.calls).toEqual([]);
  });
  it('rejects invalid detail query identities, fields, parts, bounds and unknown options before native reads', async () => {
    const invalid: Array<Record<string, string | undefined>> = [
      { turnId: undefined }, { turnId: 'not-a-native-uuid' }, { itemId: '\u0000invalid' }, { itemId: 'x'.repeat(201) },
      { field: 'encrypted_content' }, { part: '128' }, { offset: '-1' }, { offset: '9007199254740992' },
      { limit: '1' }, { limit: '16001' }, { version: 'not-a-version' }, { cwd: '/forged-native-root' },
    ];
    for (const query of invalid) {
      const response = await request(detailRoute(query)); expect(response.status, JSON.stringify(query)).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    }
    const repeated = await request(detailRoute() + '&field=output'); expect(repeated.status).toBe(400);
    expect(runtime.calls).toEqual([]);
  });
  it('requires a pinned cursor/version for later text offsets instead of accepting a guessed page', async () => {
    for (const query of [{ offset: '2' }, { version: '0'.repeat(64) }]) {
      const response = await request(detailRoute(query)); expect(response.status).toBe(400); expect(response.body.code).toBe('CODEX_DETAIL_INVALID');
    }
    expect(runtime.calls.every(call => call.method === 'thread/read')).toBe(true); expect(mutations()).toEqual([]);
  });
  it('returns only public redacted detail and round-trips the explicit empty cursor for a pinned continuation', async () => {
    runtime.threads.get(ROOT)!.status = { type: 'notLoaded' };
    const publicText = `Stored public summary: ${PASSWORD}; ` + 'bounded native text '.repeat(5);
    runtime.itemPage = itemPage({ type: 'reasoning', summary: [publicText], content: ['PRIVATE_NATIVE_REASONING_BODY'] });
    const firstResponse = await request(detailRoute({ limit: '16' })); const first = ready(firstResponse);
    const expected = publicText.replaceAll(PASSWORD, '[redacted]');
    expect(first).toMatchObject({ threadId: ROOT, turnId: TURN, itemId: ITEM, itemType: 'reasoning', field: 'text', itemCursor: null,
      text: expected.slice(0, 16), totalChars: expected.length, offset: 0, nextOffset: 16 });
    expect(first.version).toMatch(/^[a-f0-9]{64}$/); expect(firstResponse.headers['access-control-allow-origin']).toBeUndefined();
    expect(firstResponse.text).not.toContain(PASSWORD); expect(firstResponse.text).not.toContain('PRIVATE_NATIVE_REASONING_BODY');
    const second = ready(await request(detailRoute({ cursor: '', version: first.version, offset: String(first.nextOffset), limit: '16' })));
    expect(second.text).toBe(expected.slice(16, 32)); expect(second.offset).toBe(16); expect(second.version).toBe(first.version);
    expect(runtime.calls.filter(call => call.method === 'thread/items/list').map(call => call.params)).toEqual([
      { threadId: ROOT, turnId: TURN, limit: 1, sortDirection: 'asc' }, { threadId: ROOT, turnId: TURN, limit: 1, sortDirection: 'asc' },
    ]);
    expect(mutations()).toEqual([]);
  });
  it('returns bounded search progress and preserves an opaque native cursor on the next HTTP request', async () => {
    let scanned = 0;
    const opaque = 'native/opaque+?=:8';
    runtime.handlers.set('thread/items/list', params => {
      if (params.cursor === opaque) return itemPage({ type: 'commandExecution', command: 'printf fixture', cwd: workspace.path, aggregatedOutput: 'Found public output.' });
      scanned++;
      return { data: [{ turnId: TURN, item: { type: 'userMessage', id: `other-native-item-${scanned}`, content: [] } }],
        nextCursor: scanned === 8 ? opaque : `native-page-${scanned}` };
    });
    const search = await request(detailRoute({ field: 'output' }));
    expect(search.status).toBe(200); expect(search.body).toMatchObject({ status: 'searching', nextCursor: opaque, pagesScanned: 8 });
    expect(scanned).toBe(8); expect(search.body).not.toHaveProperty('text');
    const found = ready(await request(detailRoute({ field: 'output', cursor: search.body.nextCursor })));
    expect(found.text).toBe('Found public output.'); expect(found.itemCursor).toBe(opaque);
    expect(runtime.calls.filter(call => call.method === 'thread/items/list').at(-1)!.params.cursor).toBe(opaque);
    expect(mutations()).toEqual([]);
  });
  it('refuses a stale public item version without replacing it with changed native output', async () => {
    runtime.itemPage = itemPage({ type: 'commandExecution', command: 'printf fixture', cwd: workspace.path, aggregatedOutput: 'Original native public output.' });
    const first = ready(await request(detailRoute({ field: 'output', limit: '8' })));
    runtime.itemPage = itemPage({ type: 'commandExecution', command: 'printf fixture', cwd: workspace.path, aggregatedOutput: 'CHANGED_NATIVE_OUTPUT_MUST_NOT_REPLACE_THE_PAGE' });
    const stale = await request(detailRoute({ field: 'output', cursor: '', version: first.version, offset: '8', limit: '8' }));
    expect(stale.status).toBe(409); expect(stale.body.code).toBe('CODEX_DETAIL_STALE'); expect(stale.text).not.toContain('CHANGED_NATIVE_OUTPUT');
    expect(mutations()).toEqual([]);
  });
  it('rejects another native turn in the returned page rather than exposing its contents', async () => {
    runtime.itemPage = { data: [{ turnId: PEER, item: { type: 'commandExecution', id: ITEM, aggregatedOutput: 'FOREIGN_TURN_OUTPUT' } }], nextCursor: null };
    const response = await request(detailRoute({ field: 'output' })); expect(response.status).toBe(502); expect(response.body.code).toBe('CODEX_DETAIL_PROTOCOL');
    expect(response.text).not.toContain('FOREIGN_TURN_OUTPUT'); expect(mutations()).toEqual([]);
  });
  it('rejects an unregistered native workspace before requesting any item text', async () => {
    runtime.threads.set(ROOT, nativeThread(path.join(directory, 'unregistered-native-detail-root')));
    const response = await request(detailRoute()); expect(response.status).toBe(403); expect(response.body.code).toBe('CODEX_THREAD_SCOPE');
    expect(runtime.calls.map(call => call.method)).toEqual(['thread/read']);
  });
  it('discards a delayed detail response after the native connection generation changes', async () => {
    const held = heldPage();
    try {
      await until(held.entered, 'Native detail read did not reach its controlled RPC.');
      runtime.reconnect(); held.release();
      const response = await held.read; expect(response.status).toBe(409); expect(response.body.code).toBe('CODEX_DETAIL_CONNECTION_CHANGED');
      expect(response.text).not.toContain('HELD_PUBLIC_NATIVE_DETAIL'); expect(mutations()).toEqual([]);
    } finally { held.release(); }
  });
  it('discards a delayed detail page after an explicitly acknowledged native revert changes history', async () => {
    runtime.handlers.set('thread/revert', () => ({ thread: nativeThread(workspace.path), turnsBackwardsCursor: null, itemsBackwardsCursor: null }));
    const held = heldPage();
    try {
      await until(held.entered, 'Native detail read did not reach its controlled RPC.');
      const reverted = await request(`/api/threads/${ROOT}/revert`, { method: 'POST', body: { beforeTurnId: TURN } });
      expect(reverted.status).toBe(200); held.release();
      const response = await held.read; expect(response.status).toBe(409); expect(response.body.code).toBe('CODEX_DETAIL_STALE');
      expect(response.text).not.toContain('HELD_PUBLIC_NATIVE_DETAIL');
      expect(mutations()).toEqual([{ method: 'thread/revert', params: { threadId: ROOT, beforeTurnId: TURN } }]);
    } finally { held.release(); }
  });
  it('rechecks the real workspace directory before returning a held native item', async () => {
    const held = heldPage(), moved = workspace.path + '-owned-held'; let replaced = false;
    try {
      await until(held.entered, 'Native detail read did not reach its controlled RPC.');
      await fs.rename(workspace.path, moved); replaced = true; await fs.symlink(moved, workspace.path);
      held.release(); const response = await held.read;
      expect(response.status).toBe(409); expect(response.body.code).toBe('WORKSPACE_TRASH_UNSAFE');
      expect(response.text).not.toContain('HELD_PUBLIC_NATIVE_DETAIL'); expect(mutations()).toEqual([]);
    } finally {
      held.release();
      if (replaced) { await fs.unlink(workspace.path).catch(() => undefined); await fs.rename(moved, workspace.path); }
    }
  });
});

describe('passive empty native history and opaque event identities', () => {
  it('opens a freshly created native conversation when the installed item method rejects and first history is not yet materialized', async () => {
    await configuredThread();
    runtime.handlers.set('thread/items/list', () => { throw Object.assign(new HttpError(501, 'Native item listing unavailable.', 'CODEX_METHOD_UNAVAILABLE'),
      { nativeCode: -32601, nativeMethod: 'thread/items/list' }); });
    runtime.handlers.set('thread/turns/list', () => { throw new HttpError(409, 'Native history is not materialized.', 'CODEX_HISTORY_UNMATERIALIZED'); });
    const first = await request(`/api/threads/${ROOT}`);
    expect(first.status).toBe(200); expect(first.body).toMatchObject({ backend: 'codex-cli', readOnly: false,
      native: { loaded: true }, nativePage: { unavailable: 'not-materialized' } });
    expect(mutations()).toEqual([]);
    const sent = await request(`/api/threads/${ROOT}/run`, { method: 'POST', body: { prompt: 'Actual explicit first input.', clientUserMessageId: CLIENT } });
    expect(sent.status).toBe(202); expect(sent.body).toMatchObject({ threadId: ROOT, turnId: TURN });
    expect(mutations().map(call => call.method)).toEqual(['turn/start']);
  });

  it('serves supported native turn history and full tool detail through the same authenticated public routes', async () => {
    const output = 'Native command output.\n'.repeat(2000), itemId = 'real-command-item';
    runtime.handlers.set('thread/items/list', () => { throw Object.assign(new HttpError(501, 'Native item listing unavailable.', 'CODEX_METHOD_UNAVAILABLE'),
      { nativeCode: -32601, nativeMethod: 'thread/items/list' }); });
    runtime.handlers.set('thread/turns/list', params => ({ data: [{ ...nativeTurn('completed'), itemsView: params.itemsView,
      items: params.itemsView === 'full' ? [{ id: itemId, type: 'commandExecution', command: 'printf example', cwd: workspace.path,
        status: 'completed', aggregatedOutput: output }] : [] }], nextCursor: null, backwardsCursor: null }));
    expect((await request(`/api/threads/${ROOT}/history`)).status).toBe(200);
    const route = `/api/threads/${ROOT}/native-item-detail?turnId=${TURN}&itemId=${itemId}&field=output`;
    const first = await request(route);
    expect(first.status).toBe(200); expect(first.body).toMatchObject({ status: 'ready', totalChars: output.length,
      nextOffset: 16_000, text: output.slice(0, 16_000) });
    const next = await request(route + '&offset=16000&cursor=' + encodeURIComponent(first.body.itemCursor) + '&version=' + first.body.version);
    expect(next.status).toBe(200); expect(next.body.text).toBe(output.slice(16_000, 32_000));
    // Independent reads recheck availability; a legacy or unmaterialized
    // thread must not disable item history for the entire native connection.
    // The already-issued turn cursor still serves later detail offsets.
    expect(runtime.calls.filter(call => call.method === 'thread/items/list')).toHaveLength(2);
    runtime.handlers.delete('thread/items/list');
    runtime.itemPage = { data: [{ turnId: TURN, item: { id: itemId, type: 'commandExecution',
      command: 'printf example', cwd: workspace.path, status: 'completed', aggregatedOutput: output } }],
      nextCursor: null, backwardsCursor: null };
    const materialized = await request(`/api/threads/${ROOT}/history`);
    expect(materialized.status).toBe(200);
    expect(materialized.body.messages.map((message: { id: string }) => message.id)).toEqual([itemId]);
    expect(runtime.calls.filter(call => call.method === 'thread/items/list')).toHaveLength(3);
    expect(mutations()).toEqual([]);
  });
  it('reports specifically unmaterialized history honestly and never loads an unloaded thread to read goals', async () => {
    runtime.threads.get(ROOT)!.status = { type: 'notLoaded' };
    for (const method of ['thread/items/list', 'thread/turns/list']) runtime.handlers.set(method, () => {
      throw new HttpError(409, 'Owned native history has no materialized rollout yet.', 'CODEX_HISTORY_UNMATERIALIZED');
    });
    runtime.handlers.set('thread/goal/get', () => { throw new Error('An unloaded history read must not query native goals.'); });
    for (const route of [`/api/threads/${ROOT}`, `/api/threads/${ROOT}/history`]) {
      const response = await request(route); expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: ROOT, backend: 'codex-cli', messages: [], native: { loaded: false, capabilities: { goals: false } },
        nativePage: { nextCursor: null, backwardsCursor: null, unavailable: 'not-materialized' } });
    }
    const goal = await request(`/api/threads/${ROOT}/goal`); expect(goal.status).toBe(409); expect(goal.body.code).toBe('CODEX_GOAL_UNAVAILABLE');
    expect(runtime.calls.some(call => call.method === 'thread/goal/get')).toBe(false); expect(mutations()).toEqual([]);
  });
  it('does not turn an ordinary native history error into a fabricated empty successful view', async () => {
    runtime.handlers.set('thread/items/list', () => { throw new HttpError(502, 'Owned native history failure.', 'CODEX_RPC_REJECTED'); });
    const response = await request(`/api/threads/${ROOT}/history`);
    expect(response.status).toBe(502); expect(response.body.code).toBe('CODEX_RPC_REJECTED'); expect(response.body).not.toHaveProperty('nativePage');
    expect(mutations()).toEqual([]);
  });
  it('uses distinct opaque SSE identities across native reconnect and application restart, even when native generation names repeat', async () => {
    const first = await eventStream(); let original!: string;
    try { await until(() => first.ids().length > 0, 'Initial native event identity missing.'); original = first.ids()[0]!; expect(original).not.toMatch(/^\d+$/); }
    finally { await first.close(); }
    runtime.reconnect(); const next = await eventStream(original); let reconnected!: string;
    try {
      await until(() => next.ids().length > 0, 'Reconnected native event identity missing.'); reconnected = next.ids()[0]!;
      expect(reconnected).not.toBe(original); expect(next.frames()[0]).toMatchObject({ type: 'snapshot', threadId: ROOT });
    } finally { await next.close(); }
    expect(mutations()).toEqual([]);
    const previous = runtime, config = app!.ctx.config;
    await app!.close(); app = undefined;
    expect(previous.notifications.size + previous.requests.size + previous.connections.size).toBe(0); expect(previous.start).not.toHaveBeenCalled();
    runtime = new NativeHttpRuntime(previous.preferencesPath); runtime.threads.set(ROOT, nativeThread(workspace.path)); runtimeSlot.current = runtime;
    app = await createApplication(config);
    await new Promise<void>(resolve => app!.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('Restarted owned application did not listen.');
    origin = `http://127.0.0.1:${address.port}`;
    const restarted = await eventStream(original);
    try {
      expect(restarted.response.statusCode).toBe(200); await until(() => restarted.ids().length > 0, 'Restarted native event identity missing.');
      expect(new Set([original, reconnected, restarted.ids()[0]!]).size).toBe(3);
      expect(restarted.ids()[0]).not.toMatch(/^\d+$/); expect(restarted.frames()[0]).toMatchObject({ type: 'snapshot', threadId: ROOT });
      expect(mutations()).toEqual([]);
    } finally { await restarted.close(); }
  });
});
