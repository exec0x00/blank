import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, Thread } from '../shared/types';
import { ApiError } from '../client/api';
import { connectConversation, type ConversationConnectionState } from '../client/components/chat/conversation-connection';

const thread = (workspaceId = 'workspace-one'): Thread => ({ id: 'thread-one', workspaceId, backend: 'codex-cli', readOnly: false,
  title: 'Owned connection metadata', createdAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:00:00.000Z', status: 'idle', messages: [],
  native: { model: 'owned-model', reasoningEffort: null, activeTurnId: null, approvals: [], questions: [], queue: [], queueCursor: null,
    goal: null, tokenUsage: null, diff: null, capabilities: { conversations: true, pagination: true, queue: true, goals: true,
      skills: true, plan: true, review: true, historyRevert: true } },
});
const snapshot = (value = thread()): AgentEvent => ({ type: 'snapshot', threadId: 'thread-one', thread: value });
class Source {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  listeners = new Map<string, () => void>();
  closed = false;
  addEventListener(name: string, callback: () => void) { this.listeners.set(name, callback); }
  removeEventListener(name: string) { this.listeners.delete(name); }
  close() { this.closed = true; }
  send(event: AgentEvent, id = '') { this.onmessage?.({ data: JSON.stringify(event), lastEventId: id } as MessageEvent); }
  heartbeat() { this.listeners.get('heartbeat')?.(); }
}
function deferred() {
  let resolve!: (value: Thread) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<Thread>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const stops: Array<() => void> = [];
afterEach(() => { for (const stop of stops.splice(0)) stop(); vi.useRealTimers(); });
function fixture() {
  vi.useFakeTimers();
  const sources: Source[] = [], reads: Array<ReturnType<typeof deferred> & { signal: AbortSignal }> = [];
  const states: ConversationConnectionState[] = [], errors: Array<string | null> = [], notices: Array<string | null> = [];
  const onThread = vi.fn(), onEvent = vi.fn(), onLoading = vi.fn();
  const connection = connectConversation({ threadId: 'thread-one', workspaceId: 'workspace-one',
    read: signal => { const read = deferred(); reads.push({ ...read, signal }); return read.promise; },
    events: () => { const source = new Source(); sources.push(source); return source as unknown as EventSource; },
    onThread, onEvent, onLoading, onConnection: value => states.push(value), onError: value => errors.push(value), onNotice: value => notices.push(value),
  });
  stops.push(connection.stop);
  const open = async () => {
    await vi.advanceTimersByTimeAsync(0); reads.at(-1)!.resolve(thread()); await vi.advanceTimersByTimeAsync(0);
    sources.at(-1)!.onopen?.(); return sources.at(-1)!;
  };
  return { connection, sources, reads, states, errors, notices, onThread, onEvent, onLoading, open };
}

describe('browser conversation transport recovery', () => {
  it('confirms a connection only after a valid current snapshot and keeps an idle stream fresh with heartbeats', async () => {
    const data = fixture(), source = await data.open();
    expect(data.onThread).toHaveBeenCalledOnce(); expect(data.states.at(-1)).toBe('connecting');
    source.heartbeat(); expect(data.states.at(-1)).toBe('connecting');
    source.send(snapshot(), 'site:runtime:1'); expect(data.states.at(-1)).toBe('connected');
    source.send(snapshot(), 'site:runtime:1'); expect(data.onEvent).toHaveBeenCalledOnce();
    for (let index = 0; index < 5; index++) { await vi.advanceTimersByTimeAsync(15_000); source.heartbeat(); }
    expect(source.closed).toBe(false); expect(data.reads).toHaveLength(1);
  });

  it.each([new TypeError('Failed to fetch'), new ApiError('The browser read deadline expired.', 0, 'REQUEST_TIMEOUT')])
  ('retries a failed read without inventing a native runtime failure or replaying work (%#)', async failure => {
    const data = fixture(); await vi.advanceTimersByTimeAsync(0);
    data.reads[0].reject(failure); await vi.advanceTimersByTimeAsync(0);
    expect(data.states.at(-1)).toBe('reconnecting'); expect(data.sources).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000); expect(data.reads).toHaveLength(2);
    const source = await data.open(); source.send(snapshot(), 'fresh');
    expect(data.states.at(-1)).toBe('connected'); expect(data.errors.at(-1)).toBeNull();
  });

  it('recovers a silently stale stream with a fresh read and rejects the previous source callbacks', async () => {
    const data = fixture(), first = await data.open(); first.send(snapshot(), 'one');
    const oldMessage = first.onmessage!, oldError = first.onerror!;
    await vi.advanceTimersByTimeAsync(45_000);
    expect(first.closed).toBe(true); expect(data.states.at(-1)).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(1000);
    const next = await data.open(); next.send(snapshot(), 'two');
    oldMessage({ data: JSON.stringify(snapshot(thread('wrong-workspace'))), lastEventId: 'old' } as MessageEvent); oldError();
    expect(data.states.at(-1)).toBe('connected'); expect(data.errors.at(-1)).toBeNull(); expect(data.onEvent).toHaveBeenCalledTimes(2);
  });

  it('does not count heartbeats as confirmation when the initial authorized snapshot never arrives', async () => {
    const data = fixture(), source = await data.open();
    await vi.advanceTimersByTimeAsync(15_000); source.heartbeat();
    await vi.advanceTimersByTimeAsync(15_000); source.heartbeat();
    await vi.advanceTimersByTimeAsync(5000);
    expect(source.closed).toBe(true); expect(data.errors.at(-1)).toMatch(/snapshot did not arrive/);
    expect(data.states).not.toContain('connected');
  });

  it('cancels a read on offline and ignores its late response after the connection returns', async () => {
    const data = fixture(); await vi.advanceTimersByTimeAsync(0);
    data.connection.setOnline(false); expect(data.reads[0].signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000); expect(data.reads).toHaveLength(1);
    data.connection.setOnline(true); const source = await data.open(); source.send(snapshot(), 'new');
    data.reads[0].resolve(thread('old-workspace')); await vi.advanceTimersByTimeAsync(0);
    expect(data.onThread).toHaveBeenCalledOnce(); expect(data.states.at(-1)).toBe('connected'); expect(data.notices.at(-1)).toBeNull();
  });

  it('cannot apply read or stream results after a thread, workspace, or session disposes the connection', async () => {
    const data = fixture(); await vi.advanceTimersByTimeAsync(0); data.connection.stop();
    data.reads[0].resolve(thread()); await vi.advanceTimersByTimeAsync(60_000);
    expect(data.onThread).not.toHaveBeenCalled(); expect(data.sources).toHaveLength(0);
    const other = fixture(), source = await other.open(), oldMessage = source.onmessage!;
    other.connection.stop(); oldMessage({ data: JSON.stringify(snapshot()), lastEventId: 'old' } as MessageEvent);
    expect(source.closed).toBe(true); expect(other.onEvent).not.toHaveBeenCalled();
  });

  it('keeps a definitive native stream failure visible without automatically reconnecting or clearing it', async () => {
    const data = fixture(), source = await data.open(); source.send(snapshot());
    source.send({ type: 'error', threadId: 'thread-one', streamOnly: true, error: 'Native history needs an explicit refresh.' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(source.closed).toBe(true); expect(data.states.at(-1)).toBe('disconnected');
    expect(data.notices.at(-1)).toBe('Native history needs an explicit refresh.'); expect(data.reads).toHaveLength(1);
  });

  it('does not retry denied or invalid workspace reads as a generic connectivity failure', async () => {
    const data = fixture(); await vi.advanceTimersByTimeAsync(0);
    data.reads[0].reject(new ApiError('Conversation is outside this workspace.', 403, 'CODEX_THREAD_SCOPE'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(data.reads).toHaveLength(1); expect(data.states.at(-1)).toBe('disconnected');
    expect(data.errors.at(-1)).toBe('Conversation is outside this workspace.');
  });
});
