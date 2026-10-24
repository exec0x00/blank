import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { loadConfig } from '../server/config';
import { JsonStore, SecretStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import type { AppContext } from '../server/context';
import type { CodexRuntimeStatus, Thread, Workspace } from '../shared/types';
import type { CodexBridge } from '../server/codex-cli/bridge';
import type { NativeNotification, NativeServerRequest, RpcId } from '../server/codex-cli/rpc';
import { CodexConversations, type CodexConversationsOptions } from '../server/codex-cli/conversations';
import { HttpError } from '../server/errors';
import { workspaceActivityKinds } from '../server/worktrees/activity';
import { nativeQueueEntryRevision, nativeQueueRevision } from '../server/codex-cli/protocol/queue-revision';
import { readNativeHistoryPage } from '../server/codex-cli/history';
import { SERVICE_TIERS } from '../shared/service-tiers';

const ROOT = '01980000-0000-7000-8000-000000000001';
const CHILD = '01980000-0000-7000-8000-000000000002';
const FORK = '01980000-0000-7000-8000-000000000003';
const TURN = '01980000-0000-7000-8000-000000000101';
const CLIENT = '11111111-1111-4111-8111-111111111111';
const LEGACY = 'thr_' + 'a'.repeat(32);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const nativeTurn = (status = 'inProgress') => ({ id: TURN, status, items: [], itemsView: 'notLoaded', error: null,
  startedAt: 1_700_000_001, completedAt: status === 'inProgress' ? null : 1_700_000_010 });

class Bridge implements CodexBridge {
  models?: CodexBridge['models'];
  configurationVersion?: CodexBridge['configurationVersion'];
  current = 'connection-one';
  connected = true;
  absentProof = false;
  state: CodexRuntimeStatus['state'] = 'ready';
  methods = new Set<string>();
  threads = new Map<string, Record<string, unknown>>();
  requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  responses: Array<{ id: RpcId; result: unknown; generation: string }> = [];
  rejected: Array<{ id: RpcId; generation: string }> = [];
  handlers = new Map<string, (params: Record<string, unknown>) => unknown | Promise<unknown>>();
  notifications = new Set<(message: NativeNotification, generation: string) => void>();
  serverRequests = new Set<(message: NativeServerRequest, generation: string) => void>();
  connections = new Set<(state: 'ready' | 'closed', generation: string) => void>();
  generation() { return this.connected ? this.current : null; }
  async verifyNativeStateAbsent() { return this.absentProof; }
  supports(method: string) { return !this.methods.has(method); }
  status(): CodexRuntimeStatus { return { backend: 'codex-cli', state: this.state, version: '0.155.1', installedVersion: '0.155.1',
    startedAt: null, updatedAt: '2026-09-22T00:00:00.000Z', canUpdate: true, updateBlockedReason: null, error: null, activeTurns: 0,
    capabilities: { conversations: true, pagination: true, queue: true, goals: true, skills: true, plan: true, review: true, historyRevert: true } }; }
  async request<T>(method: string, input: unknown = {}): Promise<T> {
    if (!object(input)) throw new Error('The fixture expects native object parameters.');
    this.requests.push({ method, params: structuredClone(input) });
    const handler = this.handlers.get(method); if (handler) return await handler(input) as T;
    const threadId = String(input.threadId || ROOT), thread = this.threads.get(threadId);
    if (method === 'thread/start') return { thread: this.threads.get(ROOT) } as T;
    if (method === 'thread/read') {
      if (!thread) throw new HttpError(404, 'Native thread missing.', 'CODEX_RPC_REJECTED');
      return { thread: structuredClone(thread) } as T;
    }
    if (method === 'thread/resume') {
      if (!thread) throw new Error('Missing native fixture.'); thread.status = { type: 'idle' };
      if (typeof input.model === 'string') thread.model = input.model;
      return { thread: structuredClone(thread) } as T;
    }
    if (method === 'thread/unsubscribe') return { status: 'unsubscribed' } as T;
    if (method === 'thread/backgroundTerminals/list') return { data: [], nextCursor: null } as T;
    if (method === 'thread/items/list') return { data: [], nextCursor: null, backwardsCursor: null } as T;
    if (method === 'thread/turns/list') return { data: [], nextCursor: null, backwardsCursor: null } as T;
    if (method === 'thread/queue/list') return { data: [], nextCursor: null } as T;
    if (method === 'thread/goal/get') return { goal: null } as T;
    if (method === 'turn/start' || method === 'thread/queue/start') return { turn: nativeTurn() } as T;
    if (method === 'turn/steer') return { turnId: TURN } as T;
    if (method === 'thread/queue/add') return { queuedSubmission: { id: 'native-queue-item', clientUserMessageId: input.clientUserMessageId, input: input.input } } as T;
    if (method === 'thread/queue/delete') return { deleted: true } as T;
    if (method === 'thread/goal/clear') return { cleared: true } as T;
    if (method === 'thread/list') return { data: [...this.threads.values()], nextCursor: null, backwardsCursor: null } as T;
    return {} as T;
  }
  respond(id: RpcId, result: unknown, generation: string) {
    if (generation !== this.current) throw new Error('A stale generation was sent.');
    this.responses.push({ id, result: structuredClone(result), generation });
  }
  rejectRequest(id: RpcId, _message: string, generation: string) { this.rejected.push({ id, generation }); }
  onNotification(listener: (message: NativeNotification, generation: string) => void) { this.notifications.add(listener); return () => this.notifications.delete(listener); }
  onRequest(listener: (message: NativeServerRequest, generation: string) => void) { this.serverRequests.add(listener); return () => this.serverRequests.delete(listener); }
  onConnection(listener: (state: 'ready' | 'closed', generation: string) => void) { this.connections.add(listener); return () => this.connections.delete(listener); }
  notify(method: string, params: Record<string, unknown>, generation = this.current) { for (const listener of this.notifications) listener({ method, params }, generation); }
  requestUser(id: RpcId, method: string, params: Record<string, unknown>) { for (const listener of this.serverRequests) listener({ id, method, params }, this.current); }
  reconnect() {
    const old = this.current; this.state = 'stopped'; for (const listener of this.connections) listener('closed', old);
    this.current = 'connection-two'; this.state = 'ready'; for (const listener of this.connections) listener('ready', this.current);
  }
}

let directory: string, ctx: AppContext, workspace: Workspace, bridge: Bridge, service: CodexConversations;
let prepared: { acknowledge: ReturnType<typeof vi.fn>; hold: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
let adapter: CodexConversationsOptions;
function metadata(id = ROOT, extra: Record<string, unknown> = {}) {
  return { id, cwd: workspace.path, createdAt: 1_700_000_000, updatedAt: 1_700_000_001, status: { type: 'idle' },
    model: 'gpt-5.6-luna', modelProvider: 'workspace_owner', reasoningEffort: 'low', name: 'Native fixture',
    parentThreadId: null, forkedFromId: null, turns: [], ...extra };
}
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-conversation-service-'));
  const config = loadConfig({ DATA_DIR: directory, RUNTIME_DIR: path.join(directory, 'runtime'),
    WORKSPACE_PASSWORD: 'synthetic-password-only', SESSION_SECRET: 'synthetic-session-secret-32-bytes-long', ENCRYPTION_KEY: 'synthetic-encryption-key-32-bytes-long' });
  const store = new JsonStore(config.stateDir), workspaces = new WorkspaceService(config, store);
  await workspaces.initialize(); workspace = (await workspaces.list())[0];
  ctx = { config, store, workspaces, secrets: new SecretStore(store, config.encryptionKey), events: new EventEmitter(),
    settings: async () => ({ model: 'gpt-5.6-luna', reasoningEffort: 'low', reasoningSummary: null, autoApprove: false,
      theme: 'dark', fontSize: 14, wordWrap: false, provider: 'openai', apiKeyConfigured: false }),
    saveSettings: async () => { throw new Error('Native conversation controls must not edit global settings.'); }, providerKey: async () => undefined };
  bridge = new Bridge(); bridge.threads.set(ROOT, metadata());
  prepared = { acknowledge: vi.fn(async () => {}), hold: vi.fn(async () => {}), release: vi.fn(async () => {}) };
  adapter = { prepareInput: vi.fn(async (_ctx, _workspace, _thread, input) => ({ ...prepared,
    input: [{ type: 'text', text: input.prompt, text_elements: [] }], clientUserMessageId: input.clientUserMessageId ?? 'server-generated-correlation' })),
    loadResolver: vi.fn(async () => () => undefined), projectQueue: (input, _client, _resolver) => ({
      prompt: input.filter(item => item.type === 'text').map(item => String(item.text)).join('\n'), attachmentNames: [] }) };
  service = new CodexConversations(ctx, bridge, adapter);
});
afterEach(async () => { await service.shutdown(); await ctx.store.flush(); await fs.rm(directory, { recursive: true, force: true }); });

describe('native live and materialized identity handoff', () => {
  const NEXT = '01980000-0000-7000-8000-000000000102';
  const user = (id: string) => ({ id, type: 'userMessage', clientId: CLIENT,
    content: [{ type: 'text', text: 'A fictional request about a small note.', text_elements: [] }] });
  const commentary = (id: string) => ({ id, type: 'agentMessage', phase: 'commentary', text: 'Checking the small note.' });
  const final = (id: string) => ({ id, type: 'agentMessage', phase: 'final_answer', text: 'The fictional note is ready.' });
  function legacySource() {
    bridge.threads.set(ROOT, metadata(ROOT, { historyMode: 'legacy' }));
    let value: Record<string, unknown> | undefined;
    bridge.handlers.set('thread/turns/list', params => structuredClone({ data: value
      ? [{ ...value, ...(params.itemsView === 'notLoaded' ? { items: [], itemsView: 'notLoaded' } : {}) }] : [], nextCursor: null, backwardsCursor: null }));
    return (items: unknown[], status = 'completed') => { value = { ...nativeTurn(status), items, itemsView: 'full' }; };
  }
  async function begin(snapshots: Thread[]) {
    const stop = await service.subscribe(ROOT, event => { if (event.type === 'snapshot') snapshots.push(event.thread as Thread); });
    bridge.threads.set(ROOT, metadata(ROOT, { historyMode: 'legacy', status: { type: 'active' } }));
    bridge.notify('turn/started', { threadId: ROOT, turn: nativeTurn() });
    bridge.notify('item/completed', { threadId: ROOT, turnId: TURN, item: user('live-user') });
    await vi.waitFor(() => expect(snapshots.at(-1)?.messages.some(message => message.id === 'live-user')).toBe(true));
    return stop;
  }
  it('keeps an active legacy turn in one identity space, then replaces only its completed materialized representation', async () => {
    const source = legacySource(), snapshots: Thread[] = [], stop = await begin(snapshots);
    source([user('item-10'), commentary('item-11'), commentary('item-12')], 'inProgress');
    bridge.notify('item/completed', { threadId: ROOT, turnId: TURN, item: commentary('live-comment-one') });
    bridge.notify('item/completed', { threadId: ROOT, turnId: TURN, item: commentary('live-comment-two') });
    bridge.notify('item/completed', { threadId: ROOT, turnId: TURN, item: { id: 'live-only-tool', type: 'functionCallOutput', name: 'read_note', output: 'A live tool result.' } });
    const live = await service.get(ROOT), oldRevision = live.nativeView!.turns.find(turn => turn.turnId === TURN)!.revision;
    expect(live.messages.map(message => message.id)).toEqual(['live-user', 'live-comment-one', 'live-comment-two', 'live-only-tool']);
    expect(live.messages.filter(message => message.content === 'Checking the small note.')).toHaveLength(2);
    expect(live.nativeView!.turns.find(turn => turn.turnId === TURN)!.identity).toBe('native');
    source([user('item-10'), commentary('item-11'), commentary('item-12'), final('item-13')]);
    bridge.notify('item/completed', { threadId: ROOT, turnId: TURN, item: final('live-final') });
    bridge.threads.set(ROOT, metadata(ROOT, { historyMode: 'legacy' }));
    bridge.notify('turn/completed', { threadId: ROOT, turn: nativeTurn('completed') });
    await vi.waitFor(() => expect(snapshots.at(-1)?.nativeView?.turns.find(turn => turn.turnId === TURN)?.identity).toBe('legacy'));
    const canonical = snapshots.at(-1)!;
    expect(canonical.messages.map(message => message.id)).toEqual(['item-10', 'item-11', 'item-12', 'item-13']);
    expect(canonical.messages.filter(message => message.nativePhase === 'commentary')).toHaveLength(2);
    expect(canonical.messages.find(message => message.id === 'item-13')?.nativePhase).toBe('final_answer');
    expect(canonical.nativeView!.turns[0]).toMatchObject({ identity: 'legacy', coverage: 'complete' });
    expect(canonical.nativeView!.turns[0].revision).toBeGreaterThan(oldRevision);
    bridge.notify('item/completed', { threadId: ROOT, turnId: TURN, item: commentary('live-comment-one') });
    expect(snapshots.at(-1)!.messages.some(message => message.id === 'live-comment-one' || message.id === 'live-only-tool')).toBe(false);
    stop();
  });

  it('retains a newer real turn when completion and canonical handoff race an older history resolver', async () => {
    const source = legacySource(), snapshots: Thread[] = [], stop = await begin(snapshots);
    bridge.notify('item/completed', { threadId: ROOT, turnId: TURN, item: commentary('live-comment') });
    source([user('item-20'), commentary('item-21')], 'inProgress');
    let release!: () => void, entered!: () => void, once = true;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    adapter.loadResolver = async () => { if (once) { once = false; entered(); await new Promise<void>(resolve => { release = resolve; }); } return () => undefined; };
    const read = service.get(ROOT); await waiting;
    source([user('item-20'), commentary('item-21'), final('item-22')]);
    bridge.notify('turn/completed', { threadId: ROOT, turn: nativeTurn('completed') });
    await vi.waitFor(() => expect(snapshots.at(-1)?.nativeView?.turns.find(turn => turn.turnId === TURN)?.identity).toBe('legacy'));
    bridge.notify('turn/started', { threadId: ROOT, turn: { ...nativeTurn(), id: NEXT } });
    bridge.notify('item/completed', { threadId: ROOT, turnId: NEXT, item: { ...commentary('next-live-comment'), text: 'A different real turn.' } });
    release(); const result = await read;
    expect(result.messages.map(message => message.id)).toEqual(['item-20', 'item-21', 'item-22', 'next-live-comment']);
    expect(result.native?.activeTurnId).toBe(NEXT);
    expect(result.messages.some(message => message.id === 'live-comment')).toBe(false);
    stop();
  });

  it('does not replay a delayed user-item resolver after a canonical representation supersedes it', async () => {
    const source = legacySource(), snapshots: Thread[] = [];
    const stop = await service.subscribe(ROOT, event => { if (event.type === 'snapshot') snapshots.push(event.thread as Thread); });
    let release!: () => void, entered!: () => void, once = true;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    adapter.loadResolver = async () => { if (once) { once = false; entered(); await new Promise<void>(resolve => { release = resolve; }); } return () => undefined; };
    // This client joined an existing turn; it did not observe its start.
    bridge.notify('item/completed', { threadId: ROOT, turnId: TURN, item: user('late-live-user') }); await waiting;
    source([user('item-30'), final('item-31')]);
    await service.get(ROOT);
    const count = snapshots.length; release();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(snapshots.at(-1)!.messages.map(message => message.id)).toEqual(['item-30', 'item-31']);
    expect(snapshots.length).toBe(count);
    stop();
  });

  it('advances the turn revision for removed members or cleared public summaries, with partial coverage explicit', async () => {
    const source = legacySource();
    source([user('item-40'), { id: 'item-41', type: 'reasoning', summary: ['A public summary.'] }, final('item-42')]);
    const first = await service.get(ROOT), revision = first.nativeView!.turns[0].revision;
    source([user('item-40'), { id: 'item-41', type: 'reasoning', summary: [] }, final('item-42')]);
    const cleared = await service.get(ROOT);
    expect(cleared.nativeView!.turns[0].revision).toBeGreaterThan(revision);
    source([user('item-40'), final('item-42')]);
    const removed = await service.get(ROOT);
    expect(removed.nativeView!.turns[0].revision).toBeGreaterThan(cleared.nativeView!.turns[0].revision);
    source([user('item-50'), ...Array.from({ length: 12 }, (_, index) => commentary(`item-${51 + index}`))]);
    const partial = await service.get(ROOT);
    expect(partial.messages).toHaveLength(8);
    expect(partial.nativeView!.turns[0].coverage).toBe('partial'); expect(partial.nativePage!.nextCursor).toBeTruthy();
  });

  it('rejects a held read across a same-cache revert without publishing pre-revert rows in the new epoch', async () => {
    let rows = [{ turnId: TURN, item: final('native-stable-final') }];
    bridge.threads.set(ROOT, metadata(ROOT, { historyMode: 'paginated' }));
    bridge.handlers.set('thread/items/list', () => structuredClone({ data: rows, nextCursor: null, backwardsCursor: null }));
    bridge.handlers.set('thread/revert', () => { rows = []; return { thread: metadata(ROOT, { historyMode: 'paginated' }), turnsBackwardsCursor: null, itemsBackwardsCursor: null }; });
    const before = await service.get(ROOT);
    let release!: () => void, entered!: () => void, once = true;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    adapter.loadResolver = async () => { if (once) { once = false; entered(); await new Promise<void>(resolve => { release = resolve; }); } return () => undefined; };
    const read = service.get(ROOT); void read.catch(() => undefined); await waiting;
    const changed = await service.revert(ROOT, TURN); release();
    await expect(read).rejects.toMatchObject({ code: 'CODEX_HISTORY_CURSOR_STALE' });
    expect(changed.thread.nativeView!.epoch).not.toBe(before.nativeView!.epoch);
    expect((await service.get(ROOT)).messages).toEqual([]);
  });

  it('rejects a held read after cache eviction instead of publishing its retired incarnation', async () => {
    const source = legacySource(); source([user('item-60'), final('item-61')]);
    await service.shutdown(); service = new CodexConversations(ctx, bridge, { ...adapter, cacheThreads: 1 });
    const before = await service.get(ROOT);
    let release!: () => void, entered!: () => void, once = true;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    // Constructor options are server-owned seams; keep this fixture adapter
    // instance so only the intended root read is held.
    await service.shutdown();
    adapter.loadResolver = async () => { if (once) { once = false; entered(); await new Promise<void>(resolve => { release = resolve; }); } return () => undefined; };
    service = new CodexConversations(ctx, bridge, { ...adapter, cacheThreads: 1 });
    const read = service.get(ROOT); void read.catch(() => undefined); await waiting;
    bridge.threads.set(CHILD, metadata(CHILD)); await service.get(CHILD);
    const fresh = await service.get(ROOT); release();
    await expect(read).rejects.toMatchObject({ code: 'CODEX_HISTORY_CURSOR_STALE' });
    expect(fresh.nativeView!.epoch).not.toBe(before.nativeView!.epoch);
  });

  it('does not infer a steerable active turn from an unloaded persisted in-progress record', async () => {
    bridge.threads.set(ROOT, metadata(ROOT, { historyMode: 'paginated', status: { type: 'notLoaded' } }));
    bridge.handlers.set('thread/turns/list', () => ({ data: [nativeTurn()], nextCursor: null }));
    const view = await service.get(ROOT);
    expect(view.native).toMatchObject({ loaded: false, activeTurnId: null });
  });

  it('returns an ascending interior lookup only through HTTP and publishes a genuine bounded tail with usable prefix cursors', async () => {
    const source = legacySource(), snapshots: Thread[] = [];
    const items = (label: string) => Array.from({ length: 24 }, (_, index) => ({ id: `item-${index}`, type: 'agentMessage',
      phase: index === 23 ? 'final_answer' : 'commentary', text: `${label} fictional item ${index}.` }));
    source(items('Before'));
    const stop = await service.subscribe(ROOT, event => { if (event.type === 'snapshot') snapshots.push(event.thread as Thread); });
    source(items('After'));
    // Obtain real cursor envelopes over the new fictional native snapshot;
    // this does not update the conversation service's retained representation.
    const first = await readNativeHistoryPage(bridge, { threadId: ROOT, direction: 'desc', historyMode: 'legacy' });
    const second = await readNativeHistoryPage(bridge, { threadId: ROOT, direction: 'desc', historyMode: 'legacy', cursor: first.nextCursor });
    const third = await readNativeHistoryPage(bridge, { threadId: ROOT, direction: 'desc', historyMode: 'legacy', cursor: second.nextCursor });
    let release!: () => void, entered!: () => void, once = true;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    adapter.loadResolver = async () => { if (once) { once = false; entered(); await new Promise<void>(resolve => { release = resolve; }); } return () => undefined; };
    const pending = service.history(ROOT, { after: third.backwardsCursor!, limit: 4 }); await waiting;
    bridge.notify('thread/name/updated', { threadId: ROOT, threadName: 'A newer native title' });
    release(); const response = await pending;
    expect(response.messages.map(message => message.id)).toEqual(['item-8', 'item-9', 'item-10', 'item-11']);
    const published = snapshots.at(-1)!;
    expect(published.messages.map(message => message.id)).toEqual(['item-20', 'item-21', 'item-22', 'item-23']);
    expect(published.title).toBe('A newer native title');
    expect(published.nativeView!.turns[0].coverage).toBe('partial');
    const prefix = await readNativeHistoryPage(bridge, { threadId: ROOT, direction: 'desc', historyMode: 'legacy',
      cursor: published.nativePage!.nextCursor, limit: 4 });
    expect(prefix.data.map(entry => entry.item.id)).toEqual(['item-19', 'item-18', 'item-17', 'item-16']);
    bridge.notify('thread/name/updated', { threadId: ROOT, threadName: 'Current title' });
    expect(snapshots.at(-1)!.nativePage).toBeUndefined();
    stop();
  });
});

describe('native queued input edits', () => {
  const entry = () => ({ id: 'queued-edit', clientUserMessageId: CLIENT,
    input: [{ type: 'text', text: 'Original prompt', text_elements: [] }, { type: 'localImage', path: '/native/retained/image.png' }] });
  it('edits only existing prompt text and preserves exact native image positions and client correlation', async () => {
    const original = entry();
    bridge.handlers.set('thread/queue/list', () => ({ data: [original], nextCursor: null }));
    bridge.handlers.set('thread/queue/update', params => ({ queuedSubmission: { ...original, input: params.input } }));
    await expect(service.updateQueuedInput(ROOT, original.id, { prompt: 'Edited prompt',
      expectedRevision: nativeQueueEntryRevision(ROOT, bridge.current, original) })).resolves.toEqual({ updated: true, queuedSubmissionId: original.id });
    expect(bridge.requests.find(request => request.method === 'thread/queue/update')?.params).toEqual({ threadId: ROOT, queuedSubmissionId: original.id,
      input: [{ type: 'text', text: 'Edited prompt', text_elements: [] }, original.input[1]] });
    expect(adapter.prepareInput).not.toHaveBeenCalled(); expect(prepared.acknowledge).not.toHaveBeenCalled();
    expect(bridge.requests.some(request => ['turn/start', 'turn/steer', 'thread/resume', 'thread/inject_items'].includes(request.method))).toBe(false);
  });
  it('preserves a verified file reference suffix and rejects an unverified one without any mutation', async () => {
    const suffix = '\n[User-selected files: untrusted attachment metadata]\nverified retained reference';
    const original = { ...entry(), input: [{ type: 'text', text: 'Original prompt' + suffix, text_elements: [] }] };
    bridge.handlers.set('thread/queue/list', () => ({ data: [original], nextCursor: null }));
    bridge.handlers.set('thread/queue/update', params => ({ queuedSubmission: { ...original, input: params.input } }));
    const expectedRevision = nativeQueueEntryRevision(ROOT, bridge.current, original);
    await expect(service.updateQueuedInput(ROOT, original.id, { prompt: 'New prompt', expectedRevision })).rejects.toMatchObject({ code: 'CODEX_QUEUE_EDIT_UNAVAILABLE' });
    expect(bridge.requests.some(request => request.method === 'thread/queue/update')).toBe(false);
    adapter.loadResolver = async () => Object.assign(() => undefined, { resolveInput: () => ({ text: 'Original prompt', fileAttachments: [{ id: 'verified-file' }] }) }) as never;
    await service.updateQueuedInput(ROOT, original.id, { prompt: 'New prompt', expectedRevision });
    expect((bridge.requests.find(request => request.method === 'thread/queue/update')!.params.input as Array<{ text: string }>)[0].text).toBe('New prompt' + suffix);
  });
  it('refuses changed queue entries, special text elements, and stale generations before dispatch', async () => {
    const original = entry(), revision = nativeQueueEntryRevision(ROOT, bridge.current, original);
    bridge.handlers.set('thread/queue/list', () => ({ data: [{ ...original, input: [{ type: 'text', text: 'Someone changed this', text_elements: [] }] }], nextCursor: null }));
    await expect(service.updateQueuedInput(ROOT, original.id, { prompt: 'Edit', expectedRevision: revision })).rejects.toMatchObject({ code: 'CODEX_QUEUE_CHANGED' });
    const special = { ...original, input: [{ type: 'text', text: 'Original', text_elements: [{ start: 0 }] }] };
    bridge.handlers.set('thread/queue/list', () => ({ data: [special], nextCursor: null }));
    await expect(service.updateQueuedInput(ROOT, original.id, { prompt: 'Edit', expectedRevision: nativeQueueEntryRevision(ROOT, bridge.current, special) })).rejects.toMatchObject({ code: 'CODEX_QUEUE_EDIT_UNAVAILABLE' });
    bridge.handlers.set('thread/queue/list', () => { bridge.reconnect(); return { data: [original], nextCursor: null }; });
    await expect(service.updateQueuedInput(ROOT, original.id, { prompt: 'Edit', expectedRevision: revision })).rejects.toMatchObject({ code: 'CODEX_CONNECTION_CHANGED' });
    expect(bridge.requests.some(request => request.method === 'thread/queue/update')).toBe(false);
  });
  it('reorders only an entire unchanged bounded native queue and never claims or replays its entries', async () => {
    const entries = [entry(), { ...entry(), id: 'queued-second', clientUserMessageId: 'client-second' }];
    bridge.handlers.set('thread/queue/list', params => ({ data: [entries[params.cursor ? 1 : 0]], nextCursor: params.cursor ? null : 'second-page' }));
    const revision = nativeQueueRevision(ROOT, bridge.current, entries.map(value => ({ id: value.id, revision: nativeQueueEntryRevision(ROOT, bridge.current, value) })));
    await expect(service.reorderQueuedInput(ROOT, { queuedSubmissionIds: ['queued-second', 'queued-edit'], expectedRevision: revision })).resolves.toEqual({ reordered: true });
    expect(bridge.requests.find(request => request.method === 'thread/queue/reorder')?.params).toEqual({ threadId: ROOT, queuedSubmissionIds: ['queued-second', 'queued-edit'] });
    expect(bridge.requests.some(request => ['thread/queue/start', 'thread/queue/add', 'turn/start'].includes(request.method))).toBe(false);
    bridge.requests.length = 0;
    await expect(service.reorderQueuedInput(ROOT, { queuedSubmissionIds: ['queued-second', 'foreign-queue-id'], expectedRevision: revision })).rejects.toMatchObject({ code: 'CODEX_QUEUE_CHANGED' });
    expect(bridge.requests.some(request => request.method === 'thread/queue/reorder')).toBe(false);
  });
});

describe('native conversations delegate only documented RPC operations', () => {
  it('initializes without starting/resuming a CLI, provider, queue or goal', async () => {
    bridge.state = 'installing'; await service.initialize(); expect(bridge.requests).toEqual([]);
  });
  it('reports native unavailability before interpreting empty startup preference metadata', async () => {
    bridge.state = 'installing';
    const settings = await ctx.settings(); ctx.settings = async () => ({ ...settings, model: '' });
    await expect(service.create(workspace.id)).rejects.toMatchObject({ status: 503, code: 'CODEX_UNAVAILABLE' });
    expect(bridge.requests).toEqual([]);
  });
  it('creates a native rollout thread with Fast enabled and names it through its separate actual RPC', async () => {
    const view = await service.create(workspace.id, 'Human title');
    expect(view).toMatchObject({ id: ROOT, backend: 'codex-cli', readOnly: false, title: 'Human title' });
    expect(bridge.requests[0]).toEqual({ method: 'thread/start', params: { cwd: workspace.path, model: 'gpt-5.6-luna',
      modelProvider: 'workspace_owner', allowProviderModelFallback: false, sandbox: 'danger-full-access',
      approvalPolicy: 'on-request', serviceTier: 'priority', ephemeral: false, experimentalRawEvents: false } });
    expect(bridge.requests[1]).toEqual({ method: 'thread/name/set', params: { threadId: ROOT, name: 'Human title' } });
    expect(bridge.requests).toHaveLength(2);
    await ctx.store.flush(); expect(await ctx.store.read(`codex-thread-${ROOT}`, null)).toMatchObject({ id: ROOT, workspaceId: workspace.id, cwd: workspace.path });
  });
  it('preserves native creation acknowledgment if the independent title action fails', async () => {
    bridge.handlers.set('thread/name/set', () => { throw new HttpError(504, 'Unknown title outcome.', 'CODEX_ACKNOWLEDGMENT_TIMEOUT'); });
    const result = await service.create(workspace.id, 'Requested title');
    expect(result.id).toBe(ROOT); expect(result.title).toBe('Native fixture'); expect(result.error).toMatch(/created.*title/);
    expect(bridge.requests.map(value => value.method)).toEqual(['thread/start', 'thread/name/set']);
  });
  it('reads unloaded native history, queue and goal state without resume or any mutation', async () => {
    bridge.threads.set(ROOT, metadata(ROOT, { status: { type: 'notLoaded' } }));
    const view = await service.get(ROOT);
    expect(view.backend).toBe('codex-cli'); expect(view.native?.tokenUsage).toBeNull(); expect(view.history).toBeUndefined();
    expect(view.native?.loaded).toBe(false); expect(view.native?.capabilities.goals).toBe(false);
    expect(bridge.requests.map(value => value.method)).toEqual(['thread/read', 'thread/items/list', 'thread/turns/list', 'thread/queue/list']);
    expect(bridge.requests.find(value => value.method === 'thread/items/list')?.params).toEqual({ threadId: ROOT, limit: 1, sortDirection: 'desc' });
    expect(bridge.requests.find(value => value.method === 'thread/turns/list')?.params.itemsView).toBe('notLoaded');
  });
  it('delivers activity that arrives during stream hydration after its initial history snapshot', async () => {
    bridge.handlers.set('thread/items/list', () => ({ data: [{ turnId: TURN,
      item: { type: 'agentMessage', id: 'live-answer', text: 'Before', phase: 'final_answer' } }], nextCursor: null, backwardsCursor: null }));
    bridge.handlers.set('thread/turns/list', () => ({ data: [nativeTurn()], nextCursor: null, backwardsCursor: null }));
    await service.get(ROOT);
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    adapter.loadResolver = vi.fn(async () => { await gate; return () => undefined; });
    const snapshots: Array<{ thread: Thread; sequence: number }> = [];
    const subscribing = service.subscribe(ROOT, (event, sequence) => {
      if (event.type === 'snapshot') snapshots.push({ thread: event.thread as Thread, sequence });
    });
    await vi.waitFor(() => expect(adapter.loadResolver).toHaveBeenCalled());
    bridge.notify('item/agentMessage/delta', { threadId: ROOT, turnId: TURN, itemId: 'live-answer', delta: ' and after.' });
    bridge.notify('turn/completed', { threadId: ROOT, turn: nativeTurn('completed') });
    expect(snapshots).toEqual([]); // No stream content before the authorized read completes.
    release(); const stop = await subscribing;
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].thread.messages[0].content).toBe('Before');
    expect(snapshots.at(-1)?.thread.messages[0].content).toBe('Before and after.');
    expect(snapshots.at(-1)?.thread.native?.activeTurnId).toBeNull();
    expect(snapshots.at(-1)?.thread.status).toBe('idle');
    expect(snapshots[0].sequence).toBeLessThan(snapshots[1].sequence);
    expect(bridge.requests.some(call => ['thread/resume', 'turn/start', 'turn/interrupt'].includes(call.method))).toBe(false);
    stop();
  });
  it('discards buffered stream activity when the authorized history read fails', async () => {
    await service.get(ROOT);
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    adapter.loadResolver = vi.fn(async () => { await gate; throw new HttpError(403, 'Workspace access changed.', 'CODEX_THREAD_SCOPE'); });
    const listener = vi.fn(), subscribing = service.subscribe(ROOT, listener);
    const rejected = expect(subscribing).rejects.toMatchObject({ code: 'CODEX_THREAD_SCOPE' });
    await vi.waitFor(() => expect(adapter.loadResolver).toHaveBeenCalled());
    bridge.notify('thread/name/updated', { threadId: ROOT, threadName: 'A newer native title' });
    release(); await rejected; expect(listener).not.toHaveBeenCalled();
    adapter.loadResolver = vi.fn(async () => () => undefined);
    const stops = await Promise.all(Array.from({ length: 8 }, () => service.subscribe(ROOT, () => {})));
    for (const stop of stops) stop();
  });
  it('reserves stream capacity during slow reads and releases it promptly on browser cancellation', async () => {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const read = vi.fn(async () => { await gate; return { thread: metadata() }; });
    bridge.handlers.set('thread/read', read);
    const controllers = Array.from({ length: 8 }, () => new AbortController());
    const listener = vi.fn();
    const pending = controllers.map(controller => service.subscribe(ROOT, listener, controller.signal).catch(error => error as HttpError));
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(8));
    await expect(service.subscribe(ROOT, listener)).rejects.toMatchObject({ code: 'CODEX_STREAM_LIMIT' });
    controllers[0].abort();
    const replacement = service.subscribe(ROOT, listener); await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(9));
    release(); const settled = await Promise.all(pending), stopReplacement = await replacement;
    expect(settled[0]).toMatchObject({ code: 'CODEX_STREAM_CLOSED' });
    expect(listener).toHaveBeenCalledTimes(8);
    for (const stop of settled) if (typeof stop === 'function') stop();
    stopReplacement();
  });
  it('returns a truthful metadata-only unavailable view for the precise official unmaterialized-history error', async () => {
    bridge.threads.set(ROOT, metadata(ROOT, { status: { type: 'notLoaded' } }));
    for (const method of ['thread/items/list', 'thread/turns/list']) bridge.handlers.set(method, () => {
      throw new HttpError(409, 'Native paginated history is not materialized.', 'CODEX_HISTORY_UNMATERIALIZED');
    });
    bridge.handlers.set('thread/goal/get', () => { throw new Error('An unloaded goal must not be read.'); });
    const view = await service.get(ROOT);
    expect(view).toMatchObject({ id: ROOT, title: 'Native fixture', messages: [], nativePage: {
      nextCursor: null, backwardsCursor: null, unavailable: 'not-materialized' }, native: { loaded: false, capabilities: { goals: false } } });
    expect(view.history).toBeUndefined(); expect(view.timeline?.entries).toEqual([]);
    expect(bridge.requests.some(value => ['thread/resume', 'thread/goal/get', 'turn/start'].includes(value.method))).toBe(false);
    const count = bridge.requests.length;
    await expect(service.start(ROOT, { prompt: 'Do not invent or recreate this empty thread.' })).rejects.toMatchObject({ code: 'CODEX_EMPTY_THREAD_UNRESUMABLE' });
    expect(bridge.requests.slice(count).map(value => value.method)).toEqual(['thread/read', 'thread/turns/list']);
  });
  it('does not convert arbitrary native read rejection or protocol failure into an empty transcript', async () => {
    bridge.threads.set(ROOT, metadata(ROOT, { status: { type: 'notLoaded' } }));
    bridge.handlers.set('thread/items/list', () => { throw new HttpError(409, 'A different native request was rejected.', 'CODEX_RPC_REJECTED'); });
    await expect(service.get(ROOT)).rejects.toMatchObject({ code: 'CODEX_RPC_REJECTED' });
    expect(bridge.requests.some(value => value.method === 'thread/resume')).toBe(false);
  });
  it('still admits an explicit first turn on a loaded fresh thread with unmaterialized history', async () => {
    for (const method of ['thread/items/list', 'thread/turns/list']) bridge.handlers.set(method, () => {
      throw new HttpError(409, 'Native paginated history is not materialized.', 'CODEX_HISTORY_UNMATERIALIZED');
    });
    const view = await service.get(ROOT);
    expect(view.native?.loaded).toBe(true); expect(view.native?.capabilities.goals).toBe(true);
    await expect(service.start(ROOT, { prompt: 'Explicit first native turn.' })).resolves.toMatchObject({ threadId: ROOT, turnId: TURN });
    expect(bridge.requests.filter(value => value.method === 'turn/start')).toHaveLength(1);
    expect(bridge.requests.some(value => value.method === 'thread/resume')).toBe(false);
  });
  it('validates selection using only authorized metadata even when history and goals are unavailable', async () => {
    bridge.threads.set(ROOT, metadata(ROOT, { status: { type: 'notLoaded' } }));
    for (const method of ['thread/items/list', 'thread/turns/list', 'thread/goal/get']) bridge.handlers.set(method, () => { throw new Error('Selection must not request history or goal state.'); });
    expect(await service.summaryForSelection(ROOT)).toMatchObject({ id: ROOT, workspaceId: workspace.id, title: 'Native fixture', backend: 'codex-cli' });
    expect(bridge.requests.map(value => value.method)).toEqual(['thread/read']);
  });
  it('preserves opaque direction-sensitive native cursors and actual message client IDs', async () => {
    bridge.handlers.set('thread/items/list', () => ({ data: [{ turnId: TURN, item: { type: 'userMessage', id: 'native-user-item',
      clientId: CLIENT, content: [{ type: 'text', text: 'Actual native text', text_elements: [] }] } }], nextCursor: 'native/next+==', backwardsCursor: 'native:reverse?' }));
    bridge.handlers.set('thread/turns/list', () => ({ data: [nativeTurn('completed')], nextCursor: null, backwardsCursor: null }));
    const page = await service.history(ROOT, { after: 'native:old-anchor?', limit: 60 });
    expect(page.nativePage).toEqual({ nextCursor: 'native/next+==', backwardsCursor: 'native:reverse?' });
    expect(page.messages[0]).toMatchObject({ content: 'Actual native text', clientUserMessageId: CLIENT, turnId: TURN });
    expect(bridge.requests.find(value => value.method === 'thread/items/list')?.params).toEqual({ threadId: ROOT, limit: 1, sortDirection: 'asc', cursor: 'native:old-anchor?' });
    expect(page.history).toBeUndefined();
  });
  it('rejects foreign native cwd/lineage before loading content or admitting a mutation', async () => {
    bridge.threads.set(ROOT, metadata(ROOT, { cwd: '/outside/site/another-user' }));
    await expect(service.get(ROOT)).rejects.toMatchObject({ code: 'CODEX_THREAD_SCOPE' });
    expect(bridge.requests.map(value => value.method)).toEqual(['thread/read']);
    expect(adapter.prepareInput).not.toHaveBeenCalled();
  });
  it('rejects raw provider/cwd/config and sends literal allowed options without provider fallback', async () => {
    await expect(service.start(ROOT, { prompt: 'Task', config: { base_url: 'elsewhere' } } as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(bridge.requests).toEqual([]);
    const result = await service.start(ROOT, { prompt: 'Plan the task.', clientUserMessageId: CLIENT, mode: 'plan', permissionMode: 'full-access',
      model: 'literal-native-model', reasoningEffort: 'literal_effort', reasoningSummary: 'concise' });
    expect(result).toEqual({ threadId: ROOT, turnId: TURN, clientUserMessageId: CLIENT });
    const sent = bridge.requests.find(value => value.method === 'turn/start')!.params;
    expect(sent).toMatchObject({ threadId: ROOT, clientUserMessageId: CLIENT, model: 'literal-native-model', effort: 'literal_effort',
      summary: 'concise', approvalPolicy: 'never', collaborationMode: { mode: 'plan', settings: { model: 'literal-native-model', reasoning_effort: 'literal_effort', developer_instructions: null } } });
    expect(sent).not.toHaveProperty('config'); expect(sent).not.toHaveProperty('cwd');
    expect(bridge.requests.filter(value => value.method === 'thread/resume')).toEqual([]);
  });
  it('composes the real text adapter without leaking run options into its strict input draft', async () => {
    await service.shutdown(); service = new CodexConversations(ctx, bridge);
    const result = await service.start(ROOT, { prompt: 'Real native text adapter.', clientUserMessageId: CLIENT,
      mode: 'plan', permissionMode: 'ask', model: 'gpt-5.6-luna', reasoningEffort: 'low', reasoningSummary: 'concise' });
    expect(result).toEqual({ threadId: ROOT, turnId: TURN, clientUserMessageId: CLIENT });
    expect(bridge.requests.find(value => value.method === 'turn/start')?.params.input)
      .toEqual([{ type: 'text', text: 'Real native text adapter.', text_elements: [] }]);
  });
  it('resumes only an explicitly submitted unloaded conversation before its native start', async () => {
    bridge.threads.set(ROOT, metadata(ROOT, { status: { type: 'notLoaded' } }));
    await service.start(ROOT, { prompt: 'Explicit new native work.' });
    expect(bridge.requests.map(value => value.method)).toEqual(['thread/read', 'thread/resume', 'turn/start']);
    expect(bridge.requests[1].params).toMatchObject({ threadId: ROOT, excludeTurns: true, cwd: workspace.path, modelProvider: 'workspace_owner' });
  });
  it('preserves a known turn acknowledgment despite attachment receipt failure and performs no post-ack read', async () => {
    prepared.acknowledge.mockRejectedValue(new Error('Receipt write unavailable.'));
    bridge.handlers.set('turn/start', () => { bridge.handlers.set('thread/read', () => { throw new Error('A post-ack read must not occur.'); }); return { turn: nativeTurn() }; });
    await expect(service.start(ROOT, { prompt: 'One native request.' })).resolves.toMatchObject({ turnId: TURN });
    expect(bridge.requests.map(value => value.method)).toEqual(['thread/read', 'turn/start']);
    expect(prepared.hold).not.toHaveBeenCalled();
  });
  it('retains uncertain submitted input without retrying it or releasing its workspace lease', async () => {
    bridge.handlers.set('turn/start', () => { throw new HttpError(504, 'Native acknowledgment missing.', 'CODEX_ACKNOWLEDGMENT_TIMEOUT'); });
    await expect(service.start(ROOT, { prompt: 'One uncertain native request.' })).rejects.toMatchObject({ code: 'CODEX_ACKNOWLEDGMENT_TIMEOUT' });
    expect(prepared.hold).toHaveBeenCalledOnce(); expect(prepared.release).not.toHaveBeenCalled();
    expect(bridge.requests.filter(value => value.method === 'turn/start')).toHaveLength(1);
    expect(workspaceActivityKinds(ctx.config.workspacesDir, workspace.id).counts.agent).toBeGreaterThan(0);
  });
  it('returns an actual acknowledgment across connection turnover without replaying the native turn', async () => {
    bridge.handlers.set('turn/start', () => { bridge.reconnect(); return { turn: nativeTurn() }; });
    await expect(service.start(ROOT, { prompt: 'One native request.' })).resolves.toMatchObject({ turnId: TURN });
    expect(bridge.requests.filter(value => value.method === 'turn/start')).toHaveLength(1);
  });
  it('steers only the exact expected native turn and preserves supplied correlation strings', async () => {
    const result = await service.sendInput(ROOT, 'Steer precisely.', { expectedTurnId: TURN, clientUserMessageId: 'literal-correlation:7' });
    expect(result).toMatchObject({ turnId: TURN, clientUserMessageId: 'literal-correlation:7' });
    expect(bridge.requests.find(value => value.method === 'turn/steer')?.params).toMatchObject({ threadId: ROOT, expectedTurnId: TURN, clientUserMessageId: 'literal-correlation:7' });
  });
  it('queues through native add and explicit start/delete only, with no site queue drain', async () => {
    const ack = await service.queueInput(ROOT, { prompt: 'Native future turn.', clientUserMessageId: CLIENT });
    expect(ack.queuedSubmission).toEqual({ id: 'native-queue-item', clientUserMessageId: CLIENT });
    await vi.waitFor(() => expect(bridge.requests.some(value => value.method === 'thread/queue/list')).toBe(true));
    expect(bridge.requests.some(value => value.method === 'turn/start' || value.method === 'thread/queue/start' || value.method === 'thread/resume')).toBe(false);
    await service.cancelQueuedInput(ROOT, 'native-queue-item');
    await service.resumeQueuedInput(ROOT, 'native-queue-item');
    expect(bridge.requests.filter(value => value.method === 'thread/queue/start')).toHaveLength(1);
    expect(bridge.requests.find(value => value.method === 'thread/queue/delete')?.params).toEqual({ threadId: ROOT, queuedSubmissionId: 'native-queue-item' });
  });
  it('holds real workspace activity until the actual native completion notification and refreshes editor/Git', async () => {
    const changed = vi.fn(); ctx.events.on('workspace:changed', changed);
    await service.start(ROOT, { prompt: 'Native task.' });
    expect(workspaceActivityKinds(ctx.config.workspacesDir, workspace.id).counts.agent).toBe(1);
    bridge.notify('turn/completed', { threadId: ROOT, turn: nativeTurn('completed') });
    expect(workspaceActivityKinds(ctx.config.workspacesDir, workspace.id).counts.agent ?? 0).toBe(0);
    expect(changed).toHaveBeenCalledWith({ workspaceId: workspace.id });
  });
  it('uses history-only native fork/revert and native review/compact without site Git/history restore', async () => {
    bridge.handlers.set('thread/fork', () => ({ thread: metadata(FORK, { forkedFromId: ROOT }) }));
    bridge.handlers.set('thread/revert', () => ({ thread: metadata(), turnsBackwardsCursor: 'turn/native', itemsBackwardsCursor: 'item/native' }));
    bridge.handlers.set('review/start', () => ({ reviewThreadId: ROOT, turn: nativeTurn() }));
    expect((await service.fork(ROOT, { beforeTurnId: TURN })).id).toBe(FORK);
    expect(await service.revert(ROOT, TURN)).toMatchObject({ beforeTurnId: TURN, turnsBackwardsCursor: 'turn/native', itemsBackwardsCursor: 'item/native' });
    expect(await service.review(ROOT, { target: { type: 'uncommittedChanges' } })).toMatchObject({ reviewThreadId: ROOT, turnId: TURN });
    await service.compact(ROOT);
    expect(bridge.requests.find(value => value.method === 'thread/fork')?.params).toMatchObject({ beforeTurnId: TURN, excludeTurns: true, deferGoalContinuation: true });
    expect(bridge.requests.map(value => value.method)).not.toContain('thread/injectItems');
  });
  it('authorizes immediate-parent preview fallback only after an actual explicit user fork acknowledgment', async () => {
    bridge.handlers.set('thread/fork', () => { const thread = metadata(FORK, { forkedFromId: ROOT }); bridge.threads.set(FORK, thread); return { thread }; });
    await service.fork(ROOT); await ctx.store.flush(); await service.get(FORK);
    expect((adapter.loadResolver as ReturnType<typeof vi.fn>).mock.calls.filter(call => call[2] === FORK).at(-1)?.[4])
      .toEqual({ explicitForkFromThreadId: ROOT });
    bridge.threads.set(CHILD, metadata(CHILD, { parentThreadId: ROOT, forkedFromId: ROOT })); await service.get(CHILD);
    expect((adapter.loadResolver as ReturnType<typeof vi.fn>).mock.calls.filter(call => call[2] === CHILD).at(-1)?.[4]).toEqual({});
    bridge.threads.set(FORK, metadata(FORK, { forkedFromId: CHILD }));
    await expect(service.get(FORK)).rejects.toMatchObject({ code: 'CODEX_THREAD_SCOPE' });
  });
  it('keeps acknowledged forks usable but withholds inherited preview authority when site metadata cannot persist', async () => {
    await service.get(ROOT); await ctx.store.flush();
    bridge.handlers.set('thread/fork', () => { const thread = metadata(FORK, { forkedFromId: ROOT }); bridge.threads.set(FORK, thread); return { thread }; });
    vi.spyOn(ctx.store, 'update').mockRejectedValueOnce(new Error('Synthetic site binding failure.'));
    expect((await service.fork(ROOT)).id).toBe(FORK);
    await new Promise(resolve => setImmediate(resolve));
    const view = await service.get(FORK);
    expect(view.error).toMatch(/metadata could not be confirmed/);
    expect((adapter.loadResolver as ReturnType<typeof vi.fn>).mock.calls.filter(call => call[2] === FORK).at(-1)?.[4]).toEqual({});
    expect(await ctx.store.read(`codex-thread-${FORK}`, null)).toBeNull();
  });
  it('passes explicit goal mutations once and never implements a continuation loop', async () => {
    const goal = { threadId: ROOT, objective: 'Explicit native objective.', status: 'active', tokenBudget: 500, tokensUsed: 17,
      timeUsedSeconds: 3, createdAt: 1_700_000_000, updatedAt: 1_700_000_001 };
    bridge.handlers.set('thread/goal/set', params => ({ goal: { ...goal, ...params } }));
    const result = await service.goalSet(ROOT, { objective: goal.objective, tokenBudget: 500 });
    expect(result.goal.tokensUsed).toBe(17); expect(bridge.requests.filter(value => value.method === 'thread/goal/set')).toHaveLength(1);
    expect(bridge.requests.some(value => value.method === 'turn/start' || value.method === 'thread/resume')).toBe(false);
    await service.goalClear(ROOT); expect(bridge.requests.filter(value => value.method === 'thread/goal/clear')).toHaveLength(1);
  });
  it('reports unloaded goal state as unavailable instead of observing a missing goal or resuming', async () => {
    bridge.threads.set(ROOT, metadata(ROOT, { status: { type: 'notLoaded' } }));
    await expect(service.goalGet(ROOT)).rejects.toMatchObject({ code: 'CODEX_GOAL_UNAVAILABLE' });
    await expect(service.goalSet(ROOT, { objective: 'Must not imply a resume.' })).rejects.toMatchObject({ code: 'CODEX_GOAL_UNAVAILABLE' });
    await expect(service.goalClear(ROOT)).rejects.toMatchObject({ code: 'CODEX_GOAL_UNAVAILABLE' });
    expect(bridge.requests.every(value => value.method === 'thread/read')).toBe(true);
  });
  it('retains the last native usage report across reconnects and rejects stale-generation updates', async () => {
    await service.get(ROOT);
    const total = { totalTokens: 140, inputTokens: 100, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 40, reasoningOutputTokens: 10 };
    bridge.notify('thread/tokenUsage/updated', { threadId: ROOT, turnId: TURN, tokenUsage: { total, last: { totalTokens: 80 }, modelContextWindow: 1_050_000 } });
    expect((await service.get(ROOT)).native?.tokenUsage).toMatchObject({ total, contextTokens: 80, modelContextWindow: 1_050_000 });
    const previous = (await service.get(ROOT)).native?.tokenUsage;
    bridge.reconnect(); expect((await service.get(ROOT)).native?.tokenUsage).toEqual(previous);
    bridge.notify('thread/tokenUsage/updated', { threadId: ROOT, turnId: TURN,
      tokenUsage: { total, last: { totalTokens: 999 }, modelContextWindow: 1_050_000 } }, 'connection-one');
    expect((await service.get(ROOT)).native?.tokenUsage).toEqual(previous);
    bridge.notify('turn/started', { threadId: ROOT, turn: nativeTurn() });
    expect((await service.get(ROOT)).native?.tokenUsage).toEqual(previous);
  });
  it('restores reported usage after a site restart without resuming or inventing native usage', async () => {
    await service.get(ROOT);
    const total = { totalTokens: 140, inputTokens: 100, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 40, reasoningOutputTokens: 10 };
    bridge.notify('thread/tokenUsage/updated', { threadId: ROOT, turnId: TURN, tokenUsage: { total, last: { totalTokens: 80 }, modelContextWindow: 1_050_000 } });
    const reported = (await service.get(ROOT)).native?.tokenUsage;
    await service.shutdown(); await ctx.store.flush(); bridge.requests.length = 0;
    service = new CodexConversations(ctx, bridge, adapter);
    expect((await service.get(ROOT)).native?.tokenUsage).toEqual(reported);
    expect(bridge.requests.every(request => ['thread/read', 'thread/items/list', 'thread/turns/list', 'thread/queue/list', 'thread/goal/get'].includes(request.method))).toBe(true);
    bridge.threads.set(CHILD, metadata(CHILD));
    expect((await service.get(CHILD)).native?.tokenUsage).toBeNull();
  });
  it('retains a real report received while the first native metadata read is still awaiting authorization', async () => {
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    let entered = false;
    bridge.handlers.set('thread/read', async () => { entered = true; await waiting; return { thread: metadata() }; });
    const reading = service.get(ROOT); await vi.waitFor(() => expect(entered).toBe(true));
    const total = { totalTokens: 140, inputTokens: 100, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 40, reasoningOutputTokens: 10 };
    bridge.notify('thread/tokenUsage/updated', { threadId: ROOT, turnId: TURN, tokenUsage: { total, last: { totalTokens: 80 }, modelContextWindow: 1_050_000 } });
    release();
    expect((await reading).native?.tokenUsage).toMatchObject({ total, contextTokens: 80 });
  });
  it.each(['foreign workspace', 'connection change'])('discards an unauthenticated pending usage report after %s', async failure => {
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    let entered = false;
    bridge.handlers.set('thread/read', async () => { entered = true; await waiting;
      return { thread: metadata(ROOT, failure === 'foreign workspace' ? { cwd: '/unregistered-native-workspace' } : {}) }; });
    const reading = service.get(ROOT); await vi.waitFor(() => expect(entered).toBe(true));
    bridge.notify('thread/tokenUsage/updated', { threadId: ROOT, turnId: TURN, tokenUsage: {
      total: { totalTokens: 140, inputTokens: 100, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 40, reasoningOutputTokens: 10 },
      last: { totalTokens: 80 }, modelContextWindow: 1_050_000 } });
    if (failure === 'connection change') bridge.reconnect();
    release(); await expect(reading).rejects.toMatchObject({ code: failure === 'connection change' ? 'CODEX_CONNECTION_CHANGED' : 'CODEX_THREAD_SCOPE' });
    await ctx.store.flush(); expect(await ctx.store.read(`codex-token-usage-${ROOT}`, null)).toBeNull();
    bridge.handlers.delete('thread/read'); expect((await service.get(ROOT)).native?.tokenUsage).toBeNull();
  });
  it('keeps a native start report that arrives before asynchronous workspace authorization finishes', async () => {
    await service.initialize();
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    let entered = false;
    vi.spyOn(ctx.workspaces, 'getAvailable').mockImplementationOnce(async () => { entered = true; await waiting; return workspace; });
    bridge.notify('thread/started', { thread: metadata() });
    await vi.waitFor(() => expect(entered).toBe(true));
    const total = { totalTokens: 140, inputTokens: 100, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 40, reasoningOutputTokens: 10 };
    bridge.notify('thread/tokenUsage/updated', { threadId: ROOT, turnId: TURN, tokenUsage: { total, last: { totalTokens: 80 }, modelContextWindow: 1_050_000 } });
    release(); await vi.waitFor(() => expect(bridge.requests.some(request => request.method === 'thread/read')).toBe(true));
    expect((await service.get(ROOT)).native?.tokenUsage).toMatchObject({ total, contextTokens: 80 });
  });
  it('recovers an evicted thread report without carrying counts into a different thread or explicit fork', async () => {
    await service.shutdown(); service = new CodexConversations(ctx, bridge, { ...adapter, cacheThreads: 1 });
    bridge.threads.set(CHILD, metadata(CHILD)); await service.get(ROOT);
    const total = { totalTokens: 140, inputTokens: 100, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 40, reasoningOutputTokens: 10 };
    bridge.notify('thread/tokenUsage/updated', { threadId: ROOT, turnId: TURN, tokenUsage: { total, last: { totalTokens: 80 }, modelContextWindow: 1_050_000 } });
    expect((await service.get(CHILD)).native?.tokenUsage).toBeNull();
    bridge.notify('thread/tokenUsage/updated', { threadId: ROOT, turnId: TURN, tokenUsage: { total, last: { totalTokens: 90 }, modelContextWindow: 1_050_000 } });
    expect((await service.get(ROOT)).native?.tokenUsage?.contextTokens).toBe(90);
    await service.shutdown(); service = new CodexConversations(ctx, bridge, adapter);
    bridge.handlers.set('thread/fork', () => ({ thread: metadata(FORK, { forkedFromId: ROOT }) }));
    expect((await service.fork(ROOT)).native?.tokenUsage).toBeNull();
  });
  it('loads independent descendant reports after restart without merging their context windows', async () => {
    bridge.threads.set(CHILD, metadata(CHILD, { parentThreadId: ROOT }));
    await service.get(ROOT); await service.get(CHILD);
    for (const [id, size] of [[ROOT, 80], [CHILD, 30]] as const) bridge.notify('thread/tokenUsage/updated', { threadId: id, turnId: TURN,
      tokenUsage: { total: { totalTokens: size * 2, inputTokens: size, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: size, reasoningOutputTokens: 0 },
        last: { totalTokens: size }, modelContextWindow: id === ROOT ? 1_050_000 : 400_000 } });
    await service.shutdown(); service = new CodexConversations(ctx, bridge, adapter);
    bridge.handlers.set('thread/list', () => ({ data: [bridge.threads.get(CHILD)], nextCursor: null, backwardsCursor: null }));
    expect((await service.listAgents(ROOT))[0].native?.tokenUsage).toMatchObject({ contextTokens: 30, modelContextWindow: 400_000, total: { totalTokens: 60 } });
    expect((await service.get(ROOT)).native?.tokenUsage).toMatchObject({ contextTokens: 80, modelContextWindow: 1_050_000, total: { totalTokens: 160 } });
  });
  it('invalidates saved usage before a native rewind and does not revive an in-flight old report on restart', async () => {
    await service.get(ROOT);
    const total = { totalTokens: 140, inputTokens: 100, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 40, reasoningOutputTokens: 10 };
    const notification = { threadId: ROOT, turnId: TURN, tokenUsage: { total, last: { totalTokens: 80 }, modelContextWindow: 1_050_000 } };
    bridge.notify('thread/tokenUsage/updated', notification);
    bridge.handlers.set('thread/revert', async () => {
      expect(await ctx.store.read(`codex-token-usage-${ROOT}`, null)).toMatchObject({ usage: null });
      bridge.notify('thread/tokenUsage/updated', notification);
      return { thread: metadata(), turnsBackwardsCursor: null, itemsBackwardsCursor: null };
    });
    expect((await service.revert(ROOT, TURN)).thread.native?.tokenUsage).toBeNull();
    await service.shutdown(); service = new CodexConversations(ctx, bridge, adapter);
    expect((await service.get(ROOT)).native?.tokenUsage).toBeNull();
    bridge.notify('thread/tokenUsage/updated', { ...notification, tokenUsage: { ...notification.tokenUsage, last: { totalTokens: 25 } } });
    expect((await service.get(ROOT)).native?.tokenUsage?.contextTokens).toBe(25);
  });
  it('retains usage when native rewind is explicitly rejected, but clears it for an uncertain outcome', async () => {
    await service.get(ROOT);
    const total = { totalTokens: 140, inputTokens: 100, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 40, reasoningOutputTokens: 10 };
    bridge.notify('thread/tokenUsage/updated', { threadId: ROOT, turnId: TURN, tokenUsage: { total, last: { totalTokens: 80 }, modelContextWindow: 1_050_000 } });
    bridge.handlers.set('thread/revert', () => { throw new HttpError(409, 'Synthetic native rejection.', 'CODEX_RPC_REJECTED'); });
    await expect(service.revert(ROOT, TURN)).rejects.toMatchObject({ code: 'CODEX_RPC_REJECTED' });
    expect((await service.get(ROOT)).native?.tokenUsage?.contextTokens).toBe(80);
    bridge.handlers.set('thread/revert', () => { throw new HttpError(504, 'Synthetic missing acknowledgment.', 'CODEX_ACKNOWLEDGMENT_TIMEOUT'); });
    await expect(service.revert(ROOT, TURN)).rejects.toMatchObject({ code: 'CODEX_ACKNOWLEDGMENT_TIMEOUT' });
    await service.shutdown(); service = new CodexConversations(ctx, bridge, adapter);
    expect((await service.get(ROOT)).native?.tokenUsage).toBeNull();
  });
  it('keeps a newer native name/usage notification when a historical page read completes late', async () => {
    await service.get(ROOT);
    let release!: (value: unknown) => void;
    bridge.handlers.set('thread/items/list', () => new Promise(resolve => { release = resolve; }));
    const reading = service.history(ROOT, { before: 'actual-native-older-cursor' });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    bridge.notify('thread/name/updated', { threadId: ROOT, threadName: 'New native name' });
    bridge.notify('thread/tokenUsage/updated', { threadId: ROOT, turnId: TURN, tokenUsage: {
      total: { totalTokens: 30, inputTokens: 20, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 10, reasoningOutputTokens: 0 },
      last: { totalTokens: 25 }, modelContextWindow: 1000 } });
    release({ data: [], nextCursor: 'native-next-page', backwardsCursor: 'native-back-page' });
    const read = await reading;
    expect(read.title).toBe('New native name'); expect(read.native?.tokenUsage?.contextTokens).toBe(25);
    expect(read.nativePage).toEqual({ nextCursor: 'native-next-page', backwardsCursor: 'native-back-page' });
  });
});

describe('native readiness and attachment submission recovery', () => {
  const tick = () => new Promise<void>(resolve => setImmediate(resolve));
  const file = { id: 'file_' + 'a'.repeat(32), sha256: 'b'.repeat(64) };

  it('keeps a fresh thread usable when item pagination is unimplemented and its first message is not materialized', async () => {
    bridge.threads.set(ROOT, metadata(ROOT, { historyMode: 'legacy' }));
    bridge.handlers.set('thread/items/list', () => { throw Object.assign(new HttpError(501, 'Native item listing unavailable.', 'CODEX_METHOD_UNAVAILABLE'),
      { nativeCode: -32601, nativeMethod: 'thread/items/list' }); });
    bridge.handlers.set('thread/turns/list', () => { throw new HttpError(409, 'Native history is not materialized.', 'CODEX_HISTORY_UNMATERIALIZED'); });
    const view = await service.get(ROOT);
    expect(view).toMatchObject({ backend: 'codex-cli', native: { loaded: true, capabilities: { historyRevert: false } },
      nativePage: { unavailable: 'not-materialized' } });
    await expect(service.start(ROOT, { prompt: 'Inspect my file.', fileAttachments: [file] })).resolves.toMatchObject({ threadId: ROOT, turnId: TURN });
    expect(prepared.acknowledge).toHaveBeenCalledOnce(); expect(prepared.hold).not.toHaveBeenCalled();
    expect(bridge.requests.filter(call => call.method === 'turn/start')).toHaveLength(1);
  });

  it('rechecks stale empty-history evidence before resuming a real thread after a later first turn', async () => {
    let materialized = false;
    for (const method of ['thread/items/list', 'thread/turns/list']) bridge.handlers.set(method, () => {
      if (!materialized) throw new HttpError(409, 'Native history is not materialized.', 'CODEX_HISTORY_UNMATERIALIZED');
      return { data: [], nextCursor: null, backwardsCursor: null };
    });
    await service.get(ROOT);
    await service.start(ROOT, { prompt: 'Actual first user input.' });
    materialized = true;
    bridge.notify('turn/completed', { threadId: ROOT, turn: nativeTurn('completed') });
    bridge.reconnect(); bridge.threads.set(ROOT, metadata(ROOT, { status: { type: 'notLoaded' } }));
    const count = bridge.requests.length;
    await expect(service.start(ROOT, { prompt: 'Continue with a file.', fileAttachments: [file] })).resolves.toMatchObject({ threadId: ROOT });
    expect(bridge.requests.slice(count).map(call => call.method)).toEqual(['thread/read', 'thread/turns/list', 'thread/resume', 'turn/start']);
    expect(bridge.requests.some(call => call.method === 'thread/start')).toBe(false);
  });

  it('uses a later native close instead of an earlier authorized read when preparing an attachment input', async () => {
    await service.get(ROOT);
    const getAvailable = ctx.workspaces.getAvailable.bind(ctx.workspaces);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const lookup = vi.spyOn(ctx.workspaces, 'getAvailable').mockImplementationOnce(async id => { await gate; return getAvailable(id); });
    const sending = service.start(ROOT, { prompt: 'Inspect the attachment.', fileAttachments: [file] });
    await vi.waitFor(() => expect(lookup).toHaveBeenCalled());
    bridge.threads.set(ROOT, metadata(ROOT, { status: { type: 'notLoaded' } }));
    bridge.notify('thread/closed', { threadId: ROOT });
    release(); await sending;
    expect(bridge.requests.filter(call => ['thread/resume', 'turn/start'].includes(call.method)).map(call => call.method))
      .toEqual(['thread/resume', 'turn/start']);
    lookup.mockRestore();
  });

  it('releases an undispatched prepared upload when the process changes, without resuming or replaying it', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const original = adapter.prepareInput!;
    adapter.prepareInput = vi.fn(async (...args: Parameters<NonNullable<CodexConversationsOptions['prepareInput']>>) => { await gate; return original(...args); });
    const sending = service.start(ROOT, { prompt: 'Prepared only.', fileAttachments: [file] });
    await vi.waitFor(() => expect(adapter.prepareInput).toHaveBeenCalled());
    bridge.reconnect(); release();
    await expect(sending).rejects.toMatchObject({ code: 'CODEX_CONNECTION_CHANGED' });
    expect(prepared.release).toHaveBeenCalledOnce(); expect(prepared.hold).not.toHaveBeenCalled();
    expect(bridge.requests.some(call => ['thread/resume', 'turn/start', 'thread/queue/add'].includes(call.method))).toBe(false);
  });

  it('keeps a completed turn completed when its start acknowledgment arrives after native completion', async () => {
    const snapshots: Thread[] = [];
    const stop = await service.subscribe(ROOT, event => { if (event.type === 'snapshot') snapshots.push(event.thread as Thread); });
    bridge.handlers.set('turn/start', () => {
      bridge.notify('turn/started', { threadId: ROOT, turn: nativeTurn() });
      bridge.notify('turn/completed', { threadId: ROOT, turn: nativeTurn('completed') });
      return { turn: nativeTurn() };
    });
    await service.start(ROOT, { prompt: 'One short native turn.' });
    expect(snapshots.at(-1)?.native?.activeTurnId).toBeNull(); expect(snapshots.at(-1)?.status).toBe('idle');
    expect(workspaceActivityKinds(ctx.config.workspacesDir, workspace.id).counts.agent ?? 0).toBe(0);
    stop();
  });

  it('does not re-mark a closed thread loaded after asynchronous start authorization', async () => {
    const snapshots: Thread[] = [];
    const stop = await service.subscribe(ROOT, event => { if (event.type === 'snapshot') snapshots.push(event.thread as Thread); });
    const getAvailable = ctx.workspaces.getAvailable.bind(ctx.workspaces);
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const lookup = vi.spyOn(ctx.workspaces, 'getAvailable').mockImplementation(async id => { await gate; return getAvailable(id); });
    bridge.notify('thread/started', { thread: metadata() });
    bridge.notify('thread/closed', { threadId: ROOT });
    await tick(); release(); await tick(); await tick();
    expect(snapshots.at(-1)?.native?.loaded).toBe(false);
    stop(); lookup.mockRestore();
  });

  it('releases prepared input after a definitive unsupported native action and admits an explicit retry', async () => {
    bridge.handlers.set('turn/start', () => { throw Object.assign(new HttpError(501, 'Native method unavailable.', 'CODEX_METHOD_UNAVAILABLE'),
      { nativeMethod: 'turn/start', nativeCode: -32601 }); });
    await expect(service.start(ROOT, { prompt: 'One attached input.', fileAttachments: [file], clientUserMessageId: CLIENT }))
      .rejects.toMatchObject({ code: 'CODEX_METHOD_UNAVAILABLE' });
    expect(prepared.release).toHaveBeenCalledOnce(); expect(prepared.hold).not.toHaveBeenCalled();
    bridge.handlers.delete('turn/start');
    await expect(service.start(ROOT, { prompt: 'One attached input.', fileAttachments: [file], clientUserMessageId: CLIENT }))
      .resolves.toMatchObject({ clientUserMessageId: CLIENT });
    expect(bridge.requests.filter(call => call.method === 'turn/start')).toHaveLength(2);
  });

  it('prevents concurrent uploads from submitting two native starts while preserving explicit queue semantics', async () => {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const original = adapter.prepareInput!;
    adapter.prepareInput = vi.fn(async (...args: Parameters<NonNullable<CodexConversationsOptions['prepareInput']>>) => { await gate; return original(...args); });
    const first = service.start(ROOT, { prompt: 'First file.', fileAttachments: [file] });
    await vi.waitFor(() => expect(adapter.prepareInput).toHaveBeenCalledOnce());
    await expect(service.start(ROOT, { prompt: 'Second file.', fileAttachments: [file] })).rejects.toMatchObject({ code: 'CODEX_INPUT_BUSY' });
    release(); await first;
    expect(bridge.requests.filter(call => call.method === 'turn/start')).toHaveLength(1);
    await expect(service.queueInput(ROOT, { prompt: 'Explicit next native turn.' })).resolves.toMatchObject({ queuedSubmission: { id: 'native-queue-item' } });
  });
});

describe('native model context and service-tier preferences', () => {
  const model = (model: string, maximumContextWindow: number) => ({ id: model, model, displayName: model, description: '', hidden: false,
    supportedReasoningEfforts: [{ reasoningEffort: 'low', description: '' }], defaultReasoningEffort: 'low', inputModalities: ['text'], isDefault: true,
    contextWindow: maximumContextWindow, maximumContextWindow });
  function catalog() {
    bridge.models = async () => ({ backend: 'codex-cli', connected: true, models: ['gpt-6-sol', 'gpt-daybreak-red-latest'],
      catalog: [model('gpt-6-sol', 872_000), model('gpt-daybreak-red-latest', 400_000)] });
  }
  it('starts with the selected model capacity and Fast, then reloads the same idle native thread when its model changes', async () => {
    catalog();
    bridge.threads.set(ROOT, metadata(ROOT, { model: 'gpt-6-sol', historyMode: 'legacy' }));
    await service.create(workspace.id, undefined, 'gpt-6-sol');
    expect(bridge.requests[0]).toMatchObject({ method: 'thread/start', params: { model: 'gpt-6-sol', serviceTier: 'priority',
      config: { model_context_window: 872_000, model_auto_compact_token_limit: 784_800 } } });
    await service.start(ROOT, { prompt: 'First work.', model: 'gpt-6-sol' });
    bridge.notify('turn/completed', { threadId: ROOT, turn: nativeTurn('completed') });
    bridge.threads.get(ROOT)!.status = { type: 'idle' };
    const count = bridge.requests.length;
    await service.start(ROOT, { prompt: 'Continue with the selected smaller model.', model: 'gpt-daybreak-red-latest' });
    const writes = bridge.requests.slice(count).filter(call => ['thread/unsubscribe', 'thread/resume', 'turn/start'].includes(call.method));
    expect(writes.map(call => call.method)).toEqual(['thread/unsubscribe', 'thread/resume', 'turn/start']);
    expect(writes[1].params).toMatchObject({ threadId: ROOT, model: 'gpt-daybreak-red-latest', serviceTier: 'priority',
      config: { model_context_window: 400_000, model_auto_compact_token_limit: 360_000 } });
    expect(writes[2].params).not.toHaveProperty('config');
    expect(bridge.requests.filter(call => call.method === 'thread/start')).toHaveLength(1);
  });

  it('applies changed context preferences on a loaded thread and explicitly turns priority off', async () => {
    catalog(); const original = await ctx.settings();
    ctx.settings = async () => ({ ...original, model: 'gpt-6-sol', fastMode: true });
    bridge.threads.set(ROOT, metadata(ROOT, { model: 'gpt-6-sol' }));
    await service.create(workspace.id);
    await service.start(ROOT, { prompt: 'Materialize the native thread first.' });
    bridge.notify('turn/completed', { threadId: ROOT, turn: nativeTurn('completed') });
    ctx.settings = async () => ({ ...original, model: 'gpt-6-sol', modelContextWindow: 600_000, fastMode: false });
    await service.start(ROOT, { prompt: 'Apply the saved preferences.' });
    expect(bridge.requests.find(call => call.method === 'thread/resume')?.params).toMatchObject({ serviceTier: 'default',
      config: { model_context_window: 600_000, model_auto_compact_token_limit: 540_000 } });
    expect(bridge.requests.filter(call => call.method === 'turn/start').at(-1)?.params.serviceTier).toBe('default');
    await service.queueInput(ROOT, { prompt: 'Queued work inherits the explicit Fast choice.' });
    expect(bridge.requests.find(call => call.method === 'thread/settings/update')?.params).toEqual({ threadId: ROOT, serviceTier: 'default' });
  });

  it.each(['gpt-6-sol', 'future/owned-model'])('forwards literal Ultrafast through thread and turn requests for %s', async modelId => {
    bridge.models = async () => ({ backend: 'codex-cli', connected: true, models: [modelId],
      catalog: [{ ...model(modelId, 872_000), serviceTiers: [{ id: 'priority', name: 'Fast', description: '' }] }] });
    const original = await ctx.settings(); let revision = 'ultrafast-config-one';
    ctx.settings = async () => ({ ...original, model: modelId, serviceTier: 'ultrafast', fastMode: false, nativeConfigVersion: revision });
    bridge.threads.set(ROOT, metadata(ROOT, { model: modelId, historyMode: 'legacy' }));
    await service.create(workspace.id);
    await service.start(ROOT, { prompt: 'Start with the explicit Ultrafast selection.' });
    bridge.notify('turn/completed', { threadId: ROOT, turn: nativeTurn('completed') });
    revision = 'ultrafast-config-two';
    await service.start(ROOT, { prompt: 'Resume this conversation with the saved tier.' });
    await service.queueInput(ROOT, { prompt: 'Queued work retains the selected tier.' });
    for (const method of ['thread/start', 'thread/resume', 'turn/start', 'thread/settings/update']) {
      const requests = bridge.requests.filter(call => call.method === method);
      expect(requests.length).toBeGreaterThan(0);
      for (const request of requests) expect(request.params.serviceTier).toBe('ultrafast');
    }
    expect(bridge.requests.filter(call => call.method === 'thread/start')).toHaveLength(1);
    expect(bridge.requests.filter(call => call.method === 'thread/resume')).toHaveLength(1);
    expect(bridge.requests.filter(call => call.method === 'turn/start')).toHaveLength(2);
  });

  it.each(SERVICE_TIERS)('keeps an explicit $id tier scoped to its conversation through queueing and restart', async tier => {
    const original = await ctx.settings();
    ctx.settings = async () => ({ ...original, serviceTier: 'priority' });
    bridge.threads.set(ROOT, metadata(ROOT, { historyMode: 'legacy' }));
    await service.start(ROOT, { prompt: 'An explicit per-conversation tier.', serviceTier: tier.id });
    bridge.notify('turn/completed', { threadId: ROOT, turn: nativeTurn('completed') });
    ctx.settings = async () => ({ ...original, serviceTier: 'default' });
    await service.queueInput(ROOT, { prompt: 'Keep this conversation’s tier.' });
    await service.resumeQueuedInput(ROOT);
    expect(bridge.requests.filter(call => call.method === 'thread/settings/update').every(call => call.params.serviceTier === tier.id)).toBe(true);
    await service.shutdown(); service = new CodexConversations(ctx, bridge, adapter);
    bridge.threads.get(ROOT)!.status = { type: 'notLoaded' };
    const checkpoint = bridge.requests.length;
    await service.prepareThreadForAction(ROOT, bridge.current);
    await service.start(ROOT, { prompt: 'Resume using the saved explicit tier.', model: 'future/literal-model' });
    const resumed = bridge.requests.slice(checkpoint);
    expect(resumed.find(call => call.method === 'thread/resume')?.params.serviceTier).toBe(tier.id);
    expect(resumed.find(call => call.method === 'turn/start')?.params.serviceTier).toBe(tier.id);
    bridge.threads.set(FORK, metadata(FORK));
    await service.start(FORK, { prompt: 'Another conversation still uses its own default.' });
    expect(bridge.requests.filter(call => call.method === 'turn/start').at(-1)?.params.serviceTier).toBe('default');
  });

  it('retains a queue-specific tier and refuses unsupported tier updates without dispatching queued work', async () => {
    await service.queueInput(ROOT, { prompt: 'Request literal Fast.', serviceTier: 'fast' });
    await service.resumeQueuedInput(ROOT);
    expect(bridge.requests.filter(call => call.method === 'thread/settings/update').map(call => call.params.serviceTier)).toEqual(['fast', 'fast']);
    const checkpoint = bridge.requests.length;
    bridge.handlers.set('thread/settings/update', () => { throw new HttpError(422, 'This native tier was rejected.', 'CODEX_RPC_REJECTED'); });
    await expect(service.queueInput(ROOT, { prompt: 'Do not silently fall back.', serviceTier: 'ultrafast' })).rejects.toMatchObject({ status: 422, code: 'CODEX_RPC_REJECTED' });
    expect(bridge.requests.slice(checkpoint).filter(call => call.method === 'thread/queue/add')).toEqual([]);
    expect(bridge.requests.slice(checkpoint).filter(call => call.method === 'thread/settings/update')).toHaveLength(1);
  });

  it('preserves native Ultrafast rejection without starting a fallback turn', async () => {
    catalog(); const original = await ctx.settings();
    ctx.settings = async () => ({ ...original, model: 'gpt-6-sol', serviceTier: 'ultrafast' });
    bridge.threads.set(ROOT, metadata(ROOT, { model: 'gpt-6-sol' }));
    await service.create(workspace.id);
    bridge.handlers.set('turn/start', () => { throw new HttpError(400, 'Ultrafast is unavailable for this model.', 'CODEX_RPC_REJECTED'); });
    await expect(service.start(ROOT, { prompt: 'Request the selected tier once.' })).rejects.toMatchObject({
      code: 'CODEX_RPC_REJECTED', message: 'Ultrafast is unavailable for this model.',
    });
    const starts = bridge.requests.filter(call => call.method === 'turn/start');
    expect(starts).toHaveLength(1); expect(starts[0].params.serviceTier).toBe('ultrafast');
  });

  it('leaves active native goals and queues intact when new context settings cannot safely reload', async () => {
    catalog(); bridge.threads.set(ROOT, metadata(ROOT, { model: 'gpt-6-sol' }));
    await service.create(workspace.id, undefined, 'gpt-6-sol');
    bridge.handlers.set('thread/queue/list', () => ({ data: [{ id: 'actual-queued-work' }], nextCursor: null }));
    await expect(service.start(ROOT, { prompt: 'Change context.', model: 'gpt-daybreak-red-latest' })).rejects.toMatchObject({ code: 'CODEX_THREAD_BUSY' });
    expect(bridge.requests.some(call => ['thread/unsubscribe', 'thread/resume', 'turn/start'].includes(call.method))).toBe(false);
    expect(prepared.release).toHaveBeenCalledOnce();
  });

  it('reloads the same idle thread after advanced native settings change even when context numbers stay equal', async () => {
    catalog(); let revision = 'native-user-config-one';
    const settings = await ctx.settings(); ctx.settings = async () => ({ ...settings, nativeConfigVersion: revision });
    bridge.threads.set(ROOT, metadata(ROOT, { model: 'gpt-6-sol' }));
    await service.create(workspace.id, undefined, 'gpt-6-sol');
    await service.start(ROOT, { prompt: 'Existing native work.', model: 'gpt-6-sol' });
    bridge.notify('turn/completed', { threadId: ROOT, turn: nativeTurn('completed') });
    revision = 'native-user-config-two';
    const before = bridge.requests.length;
    await service.start(ROOT, { prompt: 'Use the changed native configuration.', model: 'gpt-6-sol' });
    expect(bridge.requests.slice(before).filter(call => ['thread/unsubscribe', 'thread/resume', 'turn/start'].includes(call.method)).map(call => call.method))
      .toEqual(['thread/unsubscribe', 'thread/resume', 'turn/start']);
    expect(bridge.requests.filter(call => call.method === 'thread/start')).toHaveLength(1);
  });

  it('applies the official per-session agent limit when an existing conversation next becomes idle', async () => {
    catalog(); const settings = await ctx.settings(); let maximum = 6;
    ctx.settings = async () => ({ ...settings, model: 'gpt-6-sol', maxConcurrentAgents: maximum });
    bridge.threads.set(ROOT, metadata(ROOT, { model: 'gpt-6-sol' }));
    await service.create(workspace.id);
    expect(bridge.requests[0].params.config).toMatchObject({ 'agents.max_concurrent_threads_per_session': 6 });
    await service.start(ROOT, { prompt: 'Current native work.' });
    bridge.notify('turn/completed', { threadId: ROOT, turn: nativeTurn('completed') });
    maximum = 12;
    await service.start(ROOT, { prompt: 'Use the new native limit.' });
    expect(bridge.requests.find(call => call.method === 'thread/resume')?.params.config)
      .toMatchObject({ 'agents.max_concurrent_threads_per_session': 12 });
    expect(bridge.requests.filter(call => call.method === 'turn/start').at(-1)?.params).not.toHaveProperty('configVersion');
  });

  it('requires an explicit capacity for unknown custom models without substituting a native model', async () => {
    catalog();
    await expect(service.create(workspace.id, undefined, 'custom-literal-model')).rejects.toMatchObject({ code: 'CODEX_MODEL_CONTEXT_REQUIRED' });
    expect(bridge.requests).toEqual([]);
    const settings = await ctx.settings(); ctx.settings = async () => ({ ...settings, model: 'custom-literal-model', modelContextWindow: 120_000 });
    await service.create(workspace.id, undefined, 'custom-literal-model');
    expect(bridge.requests[0].params).toMatchObject({ model: 'custom-literal-model',
      config: { model_context_window: 120_000, model_auto_compact_token_limit: 108_000 } });
  });
});

describe('connection-scoped native approvals and questions', () => {
  const command = () => ({ threadId: ROOT, turnId: TURN, itemId: 'native-command-item', approvalId: 'inner-approval-is-not-rpc-id',
    command: 'printf synthetic', cwd: workspace.path, reason: 'Native command needs your decision.' });
  async function approvalId() {
    let view!: Thread;
    await vi.waitFor(async () => { view = await service.get(ROOT); expect(view.native?.approvals).toHaveLength(1); });
    return view.native!.approvals[0].id;
  }
  it('answers the actual outer numeric RPC ID exactly once, not its inner approval ID', async () => {
    await service.get(ROOT); bridge.requestUser(0, 'item/commandExecution/requestApproval', command());
    const id = await approvalId(); await service.approve(ROOT, id, 'acceptForSession');
    expect(bridge.responses).toEqual([{ id: 0, result: { decision: 'acceptForSession' }, generation: 'connection-one' }]);
    await expect(service.approve(ROOT, id, 'accept')).rejects.toMatchObject({ code: 'CODEX_REQUEST_STALE' });
  });
  it('never offers approval for a command whose authoritative contents exceed the displayed bound', async () => {
    await service.get(ROOT);
    bridge.requestUser('oversized-command', 'item/commandExecution/requestApproval', { ...command(), command: 'x'.repeat(16_001) });
    await vi.waitFor(() => expect(bridge.rejected).toContainEqual({ id: 'oversized-command', generation: 'connection-one' }));
    expect((await service.get(ROOT)).native?.approvals).toEqual([]); expect(bridge.responses).toEqual([]);
  });
  it('refuses stale callbacks after reconnect and ignores old-generation notifications', async () => {
    await service.get(ROOT); bridge.requestUser('native-request', 'item/commandExecution/requestApproval', command());
    const id = await approvalId(); bridge.reconnect();
    await expect(service.approve(ROOT, id, 'accept')).rejects.toMatchObject({ code: 'CODEX_REQUEST_STALE' });
    bridge.notify('thread/goal/updated', { threadId: ROOT, goal: {} }, 'connection-one'); expect(bridge.responses).toEqual([]);
  });
  it('does not publish a request resolved while its workspace authorization read was pending', async () => {
    await service.get(ROOT);
    let resume!: (value: unknown) => void;
    bridge.handlers.set('thread/read', () => new Promise(resolve => { resume = resolve; }));
    bridge.requestUser('expired-native-request', 'item/commandExecution/requestApproval', command());
    await vi.waitFor(() => expect(resume).toBeTypeOf('function'));
    bridge.notify('serverRequest/resolved', { threadId: ROOT, requestId: 'expired-native-request' });
    resume({ thread: metadata() }); bridge.handlers.delete('thread/read');
    await vi.waitFor(async () => expect((await service.get(ROOT)).native?.approvals).toEqual([]));
    expect(bridge.responses).toEqual([]);
  });
  it('preserves native secret/nonblocking questions and sends answers only to that callback', async () => {
    await service.get(ROOT); const writes = vi.spyOn(ctx.store, 'write');
    bridge.requestUser('question-wire-id', 'item/tool/requestUserInput', { threadId: ROOT, turnId: TURN, itemId: 'question-item', isBlocking: false,
      questions: [{ id: 'choice', header: 'Secret', question: 'Enter the synthetic response.', isOther: true, isSecret: true, options: null }] });
    let view!: Thread;
    await vi.waitFor(async () => { view = await service.get(ROOT); expect(view.native?.questions).toHaveLength(1); });
    expect(view.native!.questions[0]).toMatchObject({ isBlocking: false, questions: [{ isSecret: true, options: null }] });
    await service.answer(ROOT, view.native!.questions[0].id, { choice: { answers: ['synthetic-answer-only'] } });
    expect(bridge.responses[0]).toEqual({ id: 'question-wire-id', generation: 'connection-one', result: { answers: { choice: { answers: ['synthetic-answer-only'] } } } });
    expect(JSON.stringify(writes.mock.calls)).not.toContain('synthetic-answer-only');
  });
  it('grants only the exact requested permissions and rejects unknown server methods', async () => {
    await service.get(ROOT);
    bridge.requestUser('permissions-rpc', 'item/permissions/requestApproval', { threadId: ROOT, turnId: TURN, itemId: 'permissions-item',
      cwd: workspace.path, permissions: { network: { enabled: true }, fileSystem: null } });
    await service.approve(ROOT, await approvalId(), 'accept');
    expect(bridge.responses[0].result).toEqual({ permissions: { network: { enabled: true } }, scope: 'turn' });
    bridge.requestUser('unknown', 'mcpServer/elicitation/request', {}); bridge.requestUser('clock', 'currentTime/read', {});
    await vi.waitFor(() => expect(bridge.rejected).toContainEqual({ id: 'unknown', generation: 'connection-one' }));
    expect(bridge.rejected.some(item => item.id === 'clock')).toBe(false);
  });
  it('exposes actual native descendants with their required approvals and enforces their cwd', async () => {
    bridge.threads.set(CHILD, metadata(CHILD, { parentThreadId: ROOT, agentRole: 'reviewer' }));
    bridge.handlers.set('thread/list', params => {
      expect(params.ancestorThreadId).toBe(ROOT); return { data: [bridge.threads.get(CHILD)], nextCursor: null, backwardsCursor: null };
    });
    expect((await service.listAgents(ROOT))[0]).toMatchObject({ id: CHILD, parentThreadId: ROOT, workspaceId: workspace.id, backend: 'codex-cli' });
    bridge.requestUser('child-approval', 'item/fileChange/requestApproval', { threadId: CHILD, turnId: TURN, itemId: 'native-patch', reason: 'Approve child change.' });
    await vi.waitFor(async () => expect((await service.listAgents(ROOT))[0].native?.approvals).toHaveLength(1));
    bridge.threads.set(CHILD, metadata(CHILD, { parentThreadId: ROOT, cwd: '/unregistered/other-folder' }));
    await expect(service.listAgents(ROOT)).rejects.toMatchObject({ code: 'CODEX_THREAD_SCOPE' });
  });
});

describe('previous conversations remain a separate read-only domain', () => {
  async function saveLegacy() {
    const thread = { id: LEGACY, workspaceId: workspace.id, title: 'Previous conversation', createdAt: '2026-09-20T00:00:00.000Z',
      updatedAt: '2026-09-20T00:00:01.000Z', status: 'running', messages: [{ id: 'msg_' + 'b'.repeat(32), role: 'user', content: 'Saved public message.', createdAt: '2026-09-20T00:00:00.000Z' }] };
    await ctx.store.write(`thread-${LEGACY}`, { thread, input: [{ encrypted_content: 'private-old-model-protocol' }], pendingJournal: { private: true } });
    return fs.readFile(path.join(ctx.config.stateDir, `thread-${LEGACY}.json`));
  }
  it('reads/lists public legacy history while CLI is unavailable without importing, migrating or replaying it', async () => {
    const before = await saveLegacy(); bridge.state = 'installing';
    const view = await service.get(LEGACY), page = await service.listPage({ backend: 'legacy', workspaceId: workspace.id });
    expect(view).toMatchObject({ backend: 'legacy', readOnly: true, status: 'interrupted' });
    expect(view.messages[0].content).toBe('Saved public message.'); expect(JSON.stringify(view)).not.toContain('private-old-model-protocol');
    expect(page.items[0]).toMatchObject({ id: LEGACY, backend: 'legacy', readOnly: true }); expect(bridge.requests).toEqual([]);
    expect(await fs.readFile(path.join(ctx.config.stateDir, `thread-${LEGACY}.json`))).toEqual(before);
  });
  it('keeps bounded legacy inspect working beyond the visible preview without CLI access or source writes', async () => {
    await saveLegacy(); const key = `thread-${LEGACY}`, stored = await ctx.store.read<Record<string, unknown>>(key, {});
    const thread = stored.thread as Thread, text = 'Saved public content '.repeat(1200);
    thread.messages[0].content = text; await ctx.store.write(key, stored);
    const before = await fs.readFile(path.join(ctx.config.stateDir, `${key}.json`)); bridge.state = 'installing';
    const view = await service.get(LEGACY); expect(view.messages[0].contentTruncated).toBe(true);
    const detail = await service.historyDetail(LEGACY, { epoch: view.history!.epoch, field: 'content', messageId: thread.messages[0].id, offset: 9000, limit: 1000 });
    expect(detail).toMatchObject({ text: text.slice(9000, 10_000), offset: 9000, totalChars: text.length, nextOffset: 10_000 });
    expect(await fs.readFile(path.join(ctx.config.stateDir, `${key}.json`))).toEqual(before); expect(bridge.requests).toEqual([]);
    await expect(service.historyDetail(LEGACY, { epoch: 'history_' + '0'.repeat(32), field: 'content', messageId: thread.messages[0].id }))
      .rejects.toMatchObject({ status: 409 });
  });
  it('refuses every legacy mutation before a native RPC and rejects merged native archived-all lists', async () => {
    await saveLegacy();
    for (const action of [() => service.start(LEGACY, { prompt: 'Continue' }), () => service.queueInput(LEGACY, { prompt: 'Future' }),
      () => service.rename(LEGACY, 'Changed'), () => service.remove(LEGACY), () => service.fork(LEGACY), () => service.compact(LEGACY),
      () => service.goalSet(LEGACY, { objective: 'Changed' }), () => service.revert(LEGACY, TURN)]) {
      await expect(action()).rejects.toMatchObject({ code: 'LEGACY_THREAD_READ_ONLY' });
    }
    await expect(service.listPage({ archived: 'all' })).rejects.toMatchObject({ code: 'INVALID_INPUT' }); expect(bridge.requests).toEqual([]);
  });
});

describe('native workspace lifecycle checks and permanent cleanup', () => {
  const request = () => ({ workspaceId: workspace.id, deletionId: 'permanent-native-fixture', mode: 'permanent' as const,
    deletedAt: '2026-09-22T00:00:00.000Z', assertCurrent: vi.fn(async () => {}) });
  function nativeInventory() {
    bridge.handlers.set('thread/list', params => ({ data: [...bridge.threads.values()].filter(thread => params.cwd === undefined
      || thread.cwd === params.cwd || Array.isArray(params.cwd) && params.cwd.includes(thread.cwd)), nextCursor: null, backwardsCursor: null }));
    bridge.handlers.set('thread/loaded/list', () => ({ data: [...bridge.threads.values()].filter(thread => object(thread.status) && thread.status.type !== 'notLoaded').map(thread => thread.id), nextCursor: null }));
    bridge.handlers.set('thread/backgroundTerminals/list', () => ({ data: [], nextCursor: null }));
  }
  async function bind(id = ROOT, parentThreadId?: string) {
    await ctx.store.write(`codex-thread-${id}`, { version: 1, id, workspaceId: workspace.id, cwd: workspace.path,
      ...(parentThreadId ? { parentThreadId } : {}) });
  }
  it('does not equate completed turns with an idle checkout while a native background process remains', async () => {
    nativeInventory(); await service.start(ROOT, { prompt: 'Native task.' });
    bridge.notify('turn/completed', { threadId: ROOT, turn: nativeTurn('completed') });
    expect(workspaceActivityKinds(ctx.config.workspacesDir, workspace.id).counts.agent ?? 0).toBe(0);
    bridge.handlers.set('thread/backgroundTerminals/list', () => ({ data: [{ itemId: 'bg', processId: 'native-process', cwd: workspace.path,
      command: 'synthetic-background-job', osPid: 42, cpuPercent: 0, rssKb: 10 }], nextCursor: null }));
    await expect(service.quiesceWorkspace(workspace.id)).rejects.toMatchObject({ code: 'WORKSPACE_BUSY' });
    expect(bridge.requests.some(value => /(?:terminate|clean|delete)$/.test(value.method))).toBe(false);
  });
  it('checks explicit background cwd even when its native owning thread belongs elsewhere', async () => {
    nativeInventory(); const other = await ctx.workspaces.create({ name: 'Other native workspace', initializeGit: false });
    bridge.threads.set(CHILD, metadata(CHILD, { cwd: other.path }));
    bridge.handlers.set('thread/backgroundTerminals/list', params => ({ data: params.threadId === CHILD
      ? [{ itemId: 'other-bg', processId: 'native-process', cwd: workspace.path, command: 'synthetic' }] : [], nextCursor: null }));
    await expect(service.quiesceWorkspace(workspace.id)).rejects.toMatchObject({ code: 'WORKSPACE_BUSY' });
    expect(bridge.requests.some(value => value.method === 'thread/backgroundTerminals/terminate')).toBe(false);
  });
  it('allows a verified quiet workspace through passive native checks and fails closed when CLI is unavailable', async () => {
    nativeInventory(); await expect(service.quiesceWorkspace(workspace.id)).resolves.toBeUndefined();
    expect(bridge.requests.every(value => /(?:list|read|get)$/.test(value.method))).toBe(true);
    bridge.state = 'error'; await expect(service.quiesceWorkspace(workspace.id)).rejects.toMatchObject({ code: 'CODEX_UNAVAILABLE' });
  });
  it('checks and cleans unloaded native metadata without unsupported goal/background reads or implicit resume', async () => {
    nativeInventory(); await bind(); bridge.threads.set(ROOT, metadata(ROOT, { status: { type: 'notLoaded' } }));
    for (const method of ['thread/goal/get', 'thread/backgroundTerminals/list', 'thread/resume']) bridge.handlers.set(method, () => {
      throw new Error('The official CLI does not expose loaded-only state for this unloaded thread.');
    });
    await expect(service.quiesceWorkspace(workspace.id)).resolves.toBeUndefined();
    bridge.handlers.set('thread/delete', params => { bridge.threads.delete(String(params.threadId)); return {}; });
    await expect(service.cleanupWorkspace(request())).resolves.toBeUndefined();
    expect(bridge.requests.some(value => ['thread/goal/get', 'thread/backgroundTerminals/list', 'thread/resume'].includes(value.method))).toBe(false);
    expect(bridge.requests.filter(value => value.method === 'thread/delete')).toHaveLength(1);
  });
  it('allows a genuinely never-native workspace lifecycle while installation is unavailable, without reentering workspace initialization', async () => {
    bridge.state = 'installing'; bridge.connected = false; bridge.absentProof = true; bridge.threads.clear();
    const get = vi.spyOn(ctx.workspaces, 'getAvailable').mockRejectedValue(new Error('Lifecycle must not reenter workspace initialization.'));
    await expect(service.quiesceWorkspace(workspace.id)).resolves.toBeUndefined();
    const deletion = request(); await expect(service.cleanupWorkspace(deletion)).resolves.toBeUndefined();
    expect(deletion.assertCurrent).toHaveBeenCalled(); expect(get).not.toHaveBeenCalled(); expect(bridge.requests).toEqual([]);
  });
  it('does not infer absent native state from stopped metadata, missing proof, existing bindings, or a changing absence proof', async () => {
    bridge.state = 'stopped'; bridge.connected = false;
    await expect(service.quiesceWorkspace(workspace.id)).rejects.toMatchObject({ code: 'CODEX_UNAVAILABLE' });
    bridge.absentProof = true; await bind();
    await expect(service.quiesceWorkspace(workspace.id)).rejects.toMatchObject({ code: 'CODEX_UNAVAILABLE' });
    await ctx.store.delete(`codex-thread-${ROOT}`);
    vi.spyOn(bridge, 'verifyNativeStateAbsent').mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(service.quiesceWorkspace(workspace.id)).rejects.toMatchObject({ code: 'CODEX_UNAVAILABLE' });
    expect(bridge.requests).toEqual([]);
  });
  it('deletes only the exact native cwd/registered descendants after files become unavailable, preserving legacy and another workspace', async () => {
    nativeInventory(); const other = await ctx.workspaces.create({ name: 'Unrelated workspace', initializeGit: false });
    bridge.threads.set(CHILD, metadata(CHILD, { parentThreadId: ROOT })); bridge.threads.set(FORK, metadata(FORK, { cwd: other.path }));
    await bind(); await bind(CHILD, ROOT);
    await ctx.store.write(`codex-thread-${FORK}`, { version: 1, id: FORK, workspaceId: other.id, cwd: other.path });
    await ctx.store.write(`thread-${LEGACY}`, { untouched: 'legacy must not be rewritten' });
    const legacyBefore = await fs.readFile(path.join(ctx.config.stateDir, `thread-${LEGACY}.json`));
    bridge.handlers.set('thread/delete', params => { bridge.threads.delete(String(params.threadId)); return {}; });
    await fs.rm(workspace.path, { recursive: true });
    const deletion = request(); await service.cleanupWorkspace(deletion);
    expect(bridge.requests.filter(value => value.method === 'thread/delete').map(value => value.params.threadId)).toEqual([ROOT, CHILD]);
    expect(deletion.assertCurrent).toHaveBeenCalled(); expect(bridge.threads.has(FORK)).toBe(true);
    expect(await ctx.store.read(`codex-thread-${ROOT}`, null)).toBeNull(); expect(await ctx.store.read(`codex-thread-${CHILD}`, null)).toBeNull();
    expect(await ctx.store.read(`codex-thread-${FORK}`, null)).toMatchObject({ workspaceId: other.id });
    expect(await fs.readFile(path.join(ctx.config.stateDir, `thread-${LEGACY}.json`))).toEqual(legacyBefore);
    await service.cleanupWorkspace(deletion);
    expect(bridge.requests.filter(value => value.method === 'thread/delete')).toHaveLength(2);
  });
  it('retains an uncertain deletion receipt, refuses a replay while present, and settles proved global absence read-only', async () => {
    nativeInventory(); await bind(); const deletion = request();
    bridge.handlers.set('thread/delete', () => { throw new HttpError(504, 'Native deletion outcome unknown.', 'CODEX_ACKNOWLEDGMENT_TIMEOUT'); });
    await expect(service.cleanupWorkspace(deletion)).rejects.toMatchObject({ code: 'CODEX_ACKNOWLEDGMENT_TIMEOUT' });
    await expect(service.cleanupWorkspace(deletion)).rejects.toMatchObject({ code: 'CODEX_DELETE_OUTCOME_UNCERTAIN' });
    expect(bridge.requests.filter(value => value.method === 'thread/delete')).toHaveLength(1);
    bridge.threads.delete(ROOT); await service.cleanupWorkspace(deletion);
    expect(bridge.requests.filter(value => value.method === 'thread/delete')).toHaveLength(1);
    expect(await ctx.store.read(`codex-workspace-cleanup-${workspace.id}`, null)).toMatchObject({ complete: true, entries: [{ id: ROOT, state: 'absent' }] });
  });
  it('refuses permanent native history cleanup if its binding belongs to another workspace or fence changed', async () => {
    nativeInventory(); const other = await ctx.workspaces.create({ name: 'Foreign binding', initializeGit: false });
    await ctx.store.write(`codex-thread-${ROOT}`, { version: 1, id: ROOT, workspaceId: other.id, cwd: workspace.path });
    await expect(service.cleanupWorkspace(request())).rejects.toMatchObject({ code: 'CODEX_THREAD_SCOPE_CHANGED' });
    expect(bridge.requests.filter(value => value.method === 'thread/delete')).toEqual([]);
    const stale = request(); stale.assertCurrent.mockRejectedValue(new HttpError(409, 'Deletion generation changed.', 'STALE_DELETION'));
    await expect(service.cleanupWorkspace(stale)).rejects.toMatchObject({ code: 'STALE_DELETION' });
    expect(bridge.requests.filter(value => value.method === 'thread/delete')).toEqual([]);
  });
});
