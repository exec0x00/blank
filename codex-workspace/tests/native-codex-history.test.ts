import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { ChatMessage, CodexThreadState, ConversationTimelineEntry, Thread } from '../shared/types';
import { ConversationHistoryCache, HISTORY_CACHE_ENTRIES, NATIVE_HISTORY_MAX_ITEMS } from '../client/components/chat/history-cache';
import { conversationTimeline } from '../client/components/chat/timeline';

const THREAD = '01992a6e-7fa0-7000-8000-111111111111';
const native = (): CodexThreadState => ({ model: 'literal-model', reasoningEffort: 'high', activeTurnId: null, approvals: [], questions: [], queue: [], queueCursor: null,
  goal: null, tokenUsage: null, diff: null, capabilities: { conversations: true, pagination: true, queue: true, goals: true, skills: true, plan: true, review: true, historyRevert: true } });
function message(id: string, content = id): ChatMessage { return { id, role: 'assistant', content, createdAt: '2026-09-22T14:00:00Z', turnId: 'native-turn' }; }
function entry(id: string, text = id, messageId = id): Extract<ConversationTimelineEntry, { kind: 'text' }> {
  return { id: `row:${id}`, messageId, kind: 'text', text, startOffset: 0, sequence: 1, revision: 1 };
}
function view(ids: string[], nextCursor: string | null = 'older:next', backwardsCursor: string | null = 'reverse:anchor', overrides: Partial<Thread> = {}): Thread {
  return { backend: 'codex-cli', id: THREAD, workspaceId: 'workspace-native', title: 'Native history', createdAt: '2026-09-22T14:00:00Z', updatedAt: '2026-09-22T14:00:00Z',
    status: 'idle', messages: ids.map(id => message(id)), timeline: { version: 1, revision: 1, nextSequence: ids.length + 1, entries: ids.map((id, index) => ({ ...entry(id), sequence: index + 1 })) },
    native: native(), nativePage: { nextCursor, backwardsCursor }, ...overrides };
}
const ids = (thread: Thread) => thread.messages.map(message => message.id);

const earlierTurn = 'earlier-native-turn', currentTurn = 'current-native-turn';
function represented(items: Array<[string, string, string]>, revision: number,
  turns: NonNullable<Thread['nativeView']>['turns'], nextCursor: string | null = null, epoch = 'native-source-one'): Thread {
  return view(items.map(([id]) => id), nextCursor, 'actual-reverse-cursor', {
    messages: items.map(([id, turnId, content]) => ({ ...message(id, content), turnId })),
    timeline: { version: 1, revision, nextSequence: items.length + 1, entries: items.map(([id, , text], index) => ({ ...entry(id, text), sequence: index + 1, revision })) },
    nativeView: { epoch, revision, historyMode: 'legacy', turns },
  });
}
const earlierView = { turnId: earlierTurn, identity: 'legacy' as const, revision: 1, coverage: 'complete' as const };
const liveView = { turnId: currentTurn, identity: 'native' as const, revision: 2, coverage: 'complete' as const };
const savedView = { turnId: currentTurn, identity: 'legacy' as const, revision: 3, coverage: 'partial' as const };
const streamed = (thread: Thread): Thread => ({ ...thread, nativePage: undefined });
function handoff() {
  const commentary = 'I will inspect the current project and its documentation.';
  const earlier: [string, string, string] = ['earlier-message', earlierTurn, 'An unrelated earlier answer.'];
  const live = represented([earlier, ['live-commentary', currentTurn, commentary], ['live-final', currentTurn, 'Final answer.']], 10, [earlierView, liveView]);
  const saved = represented([['saved-commentary', currentTurn, commentary], ['saved-final', currentTurn, 'Final answer.']], 11, [savedView], 'actual-missing-prefix-cursor');
  return { live, saved, earlier, commentary };
}

test('authoritative per-turn history handoff replaces live identities without deleting unrelated earlier turns', () => {
  const { live, saved, commentary } = handoff(), cache = new ConversationHistoryCache();
  let thread = cache.snapshot(null, live, true);
  thread = cache.snapshot(thread, saved, true, false, { canonical: true });
  assert.deepEqual(ids(thread), ['earlier-message', 'saved-commentary', 'saved-final']);
  assert.equal(thread.messages.filter(message => message.content === commentary).length, 1);
  assert.equal(cache.cursor(thread, 'older'), 'actual-missing-prefix-cursor');
  assert.equal(cache.event(thread, { type: 'snapshot', threadId: THREAD, thread: streamed(live) }, true), thread);
  const lateTurn = structuredClone(live); lateTurn.nativeView!.revision = 12;
  const replayed = cache.event(thread, { type: 'snapshot', threadId: THREAD, thread: streamed(lateTurn) }, true)!;
  assert.deepEqual(ids(replayed), ['earlier-message', 'saved-commentary', 'saved-final']);
});

test('an SSE canonical page can update its covered turn after a newer unrelated live observation', () => {
  const { live, saved } = handoff(), cache = new ConversationHistoryCache();
  const newest = { ...live, status: 'running' as const, native: { ...live.native!, activeTurnId: 'a-newer-active-turn' },
    nativeView: { ...live.nativeView!, revision: 20 } };
  let thread = cache.snapshot(null, newest, true);
  thread = cache.event(thread, { type: 'snapshot', threadId: THREAD, thread: saved }, true)!;
  assert.deepEqual(ids(thread), ['earlier-message', 'saved-commentary', 'saved-final']);
  assert.equal(thread.status, 'running');
  assert.equal(thread.native!.activeTurnId, 'a-newer-active-turn');
  assert.equal(thread.nativeView!.revision, 20);
  assert.equal(cache.cursor(thread, 'older'), 'actual-missing-prefix-cursor');
});

test('an explicit native replacement still retires rows outside the returned snapshot', () => {
  const { live } = handoff(), cache = new ConversationHistoryCache();
  let thread = cache.snapshot(null, live, true);
  const replaced = represented([['earlier-message', earlierTurn, 'An unrelated earlier answer.']], 11, [earlierView]);
  thread = cache.snapshot(thread, replaced, true, true, { canonical: false });
  assert.deepEqual(ids(thread), ['earlier-message']);
});

test('partial pages of the selected representation refill the actual gap in native turn order', () => {
  const { live, saved } = handoff(), cache = new ConversationHistoryCache();
  let thread = cache.snapshot(null, live, true);
  thread = cache.snapshot(thread, saved, true, false, { canonical: true });
  const prefix = represented([['saved-prefix', currentTurn, 'A retained earlier section.']], 11, [savedView], 'actual-before-turn-cursor');
  thread = cache.page(thread, prefix, 'older');
  assert.deepEqual(ids(thread), ['earlier-message', 'saved-prefix', 'saved-commentary', 'saved-final']);
  assert.equal(cache.cursor(thread, 'older'), 'actual-before-turn-cursor');
  const last = represented([['earlier-message', earlierTurn, 'An unrelated earlier answer.']], 11, [earlierView]);
  thread = cache.page(thread, last, 'older');
  assert.deepEqual(ids(thread), ['earlier-message', 'saved-prefix', 'saved-commentary', 'saved-final']);
  assert.equal(cache.hasOlder(thread), false);
});

test('a focused native identity stays mounted until the authoritative turn handoff can be applied', () => {
  const { live, saved, commentary } = handoff(), cache = new ConversationHistoryCache();
  let thread = cache.snapshot(null, live, true);
  cache.anchor(thread, 'row:live-commentary', new Set(['row:live-commentary']));
  thread = cache.snapshot(thread, saved, true, false, { canonical: true });
  assert.deepEqual(ids(thread), ['earlier-message', 'live-commentary', 'live-final']);
  assert.equal(thread.messages.filter(message => message.content === commentary).length, 1);
  assert.equal(cache.takeLatestRefresh(thread), false);
  cache.anchor(thread, null, new Set());
  assert.equal(cache.takeLatestRefresh(thread), true);
  thread = cache.snapshot(thread, saved, true, false, { canonical: true });
  assert.deepEqual(ids(thread), ['earlier-message', 'saved-commentary', 'saved-final']);
});

test('retired and unseen late producer epochs cannot replace a newer live view', () => {
  const { live, saved } = handoff(), cache = new ConversationHistoryCache();
  let thread = cache.snapshot(null, live, true);
  const newest = { ...saved, nativeView: { ...saved.nativeView!, epoch: 'source-three', revision: 1 } };
  thread = cache.snapshot(thread, newest, true);
  const late = { ...live, nativeView: { ...live.nativeView!, epoch: 'source-two', revision: 500 } };
  assert.equal(cache.snapshot(thread, late, true, false, { canonical: true, preserveMetadata: true }), thread);
  assert.equal(cache.snapshot(thread, live, true), thread);
  const cursor = cache.cursor(thread, 'older');
  assert.throws(() => cache.page(thread, late, 'older'), /connection changed/);
  assert.equal(cache.cursor(thread, 'older'), cursor);
});

test('complete turn coverage removes only obsolete items of that turn', () => {
  const { live, saved } = handoff(), cache = new ConversationHistoryCache();
  let thread = cache.snapshot(null, live, true);
  thread = cache.snapshot(thread, saved, true, false, { canonical: true });
  const completed = represented([['saved-final', currentTurn, 'Final answer.']], 12, [{ ...savedView, revision: 4, coverage: 'complete' }]);
  thread = cache.snapshot(thread, completed, true);
  assert.deepEqual(ids(thread), ['earlier-message', 'saved-final']);
  const cursor = cache.cursor(thread, 'older');
  const late = represented([['saved-commentary', currentTurn, 'A retired public item.']], 11, [savedView], 'retired-page-cursor');
  thread = cache.page(thread, late, 'older');
  assert.deepEqual(ids(thread), ['earlier-message', 'saved-final']);
  assert.equal(cache.cursor(thread, 'older'), cursor);
});

test('native revision tombstones stay bounded across many distinct paged turns', () => {
  const cache = new ConversationHistoryCache();
  const page = (index: number) => represented([[`message-${index}`, `turn-${index}`, `Saved response ${index}`]], 100,
    [{ turnId: `turn-${index}`, identity: 'native', revision: 1, coverage: 'complete' }], `before-${index}`);
  let thread = cache.snapshot(null, page(1000), true, false, { canonical: true });
  for (let index = 999; index >= 0; index--) thread = cache.page(thread, page(index), 'older');
  assert.equal(thread.messages.length, HISTORY_CACHE_ENTRIES);
  const marks = (cache as unknown as { nativeTurnRevisions: Map<string, unknown> }).nativeTurnRevisions;
  assert.ok(marks.size <= NATIVE_HISTORY_MAX_ITEMS * 3);
  assert.ok(thread.messages.every(message => marks.has(message.turnId!)));
  assert.equal(cache.cursor(thread, 'older'), 'before-0');
});

test('a parked historical view does not accumulate metadata for unmounted live turns', () => {
  const cache = new ConversationHistoryCache();
  let thread = cache.snapshot(null, represented([['pinned', 'pinned-turn', 'A selected historical response.']], 1,
    [{ turnId: 'pinned-turn', identity: 'legacy', revision: 1, coverage: 'complete' }], 'actual-pinned-older'), true);
  cache.anchor(thread, 'row:pinned', new Set(['row:pinned']));
  for (let index = 1; index <= 1000; index++) {
    const incoming = represented([[`live-${index}`, `live-turn-${index}`, 'A new native update.']], index + 1,
      [{ turnId: `live-turn-${index}`, identity: 'native', revision: 1, coverage: 'partial' }], `older-${index}`);
    thread = cache.snapshot(thread, streamed(incoming), false);
  }
  assert.deepEqual(ids(thread), ['pinned']);
  assert.deepEqual(thread.nativeView!.turns.map(turn => turn.turnId), ['pinned-turn']);
  assert.equal(cache.cursor(thread, 'older'), 'actual-pinned-older');
  const marks = (cache as unknown as { nativeTurnRevisions: Map<string, unknown> }).nativeTurnRevisions;
  assert.ok(marks.size <= NATIVE_HISTORY_MAX_ITEMS * 3);
  assert.ok(marks.has('pinned-turn'));
});

test('empty public pages advance real cursors without accumulating invisible turn metadata', () => {
  const cache = new ConversationHistoryCache();
  let thread = cache.snapshot(null, represented([['visible', 'visible-turn', 'A public response.']], 1,
    [{ turnId: 'visible-turn', identity: 'native', revision: 1, coverage: 'complete' }], 'before-visible'), true);
  for (let index = 0; index < 1000; index++) {
    thread = cache.page(thread, represented([], 1,
      [{ turnId: `hidden-turn-${index}`, identity: 'legacy', revision: 1, coverage: 'complete' }], `before-hidden-${index}`), 'older');
  }
  assert.deepEqual(ids(thread), ['visible']);
  assert.deepEqual(thread.nativeView!.turns.map(turn => turn.turnId), ['visible-turn']);
  assert.equal(cache.cursor(thread, 'older'), 'before-hidden-999');
});

test('an overflowing identity replacement rolls back page cursors without rolling back observation fences', () => {
  const cache = new ConversationHistoryCache();
  const base = represented([['old-a', 'turn-a', 'One live item.'], ...Array.from({ length: 255 }, (_, index): [string, string, string] =>
    [`b-${index}`, 'turn-b', `Protected neighboring turn ${index}`])], 1, [
      { turnId: 'turn-a', identity: 'native', revision: 1, coverage: 'complete' },
      { turnId: 'turn-b', identity: 'legacy', revision: 1, coverage: 'complete' },
    ], 'base-older');
  let thread = cache.snapshot(null, base, true);
  cache.anchor(thread, 'row:b-254', new Set(['row:b-254']));
  const replacement = represented([['new-a-one', 'turn-a', 'First canonical item.'], ['new-a-two', 'turn-a', 'Second canonical item.']], 2,
    [{ turnId: 'turn-a', identity: 'legacy', revision: 2, coverage: 'partial' }], 'replacement-older');
  assert.throws(() => cache.page(thread, replacement, 'older'), /Move keyboard focus/);
  assert.equal(cache.cursor(thread, 'older'), 'base-older');
  assert.equal(thread.messages.length, 256);
  assert.equal(thread.nativeView!.turns.find(turn => turn.turnId === 'turn-a')!.revision, 1);
  assert.equal(cache.snapshot(thread, streamed(base), true), thread);
  cache.anchor(thread, null, new Set());
  thread = cache.page(thread, replacement, 'older');
  assert.deepEqual(ids(thread), ['new-a-one', 'new-a-two']);
  assert.equal(cache.cursor(thread, 'older'), 'replacement-older');
  assert.equal(thread.nativeView!.turns.find(turn => turn.turnId === 'turn-a')!.revision, 2);
});

test('explicit latest overflow keeps the newest live tail and a refresh path to every replaced turn', () => {
  const cache = new ConversationHistoryCache();
  const base = represented([['old-a', 'turn-a', 'Earlier live response.'], ...Array.from({ length: 255 }, (_, index): [string, string, string] =>
    [`live-b-${index}`, 'turn-b', `Latest live response ${index}`])], 3, [
      { turnId: 'turn-a', identity: 'native', revision: 1, coverage: 'complete' },
      { turnId: 'turn-b', identity: 'native', revision: 1, coverage: 'complete' },
    ], 'actual-original-older');
  let thread = cache.snapshot(null, base, true);
  const stalePrefix = represented([['saved-a-one', 'turn-a', 'First canonical item.'], ['saved-a-two', 'turn-a', 'Second canonical item.']], 2,
    [{ turnId: 'turn-a', identity: 'legacy', revision: 2, coverage: 'partial' }], 'cursor-before-canonical-a');
  assert.throws(() => cache.snapshot(thread, stalePrefix, true, true, { canonical: true, preserveMetadata: true }), /current view is kept.*Retry/);
  assert.equal(thread.messages.length, 256);
  assert.equal(ids(thread).at(-1), 'live-b-254');
  assert.equal(cache.cursor(thread, 'older'), 'actual-original-older');
  assert.equal(cache.takeLatestRefresh(thread), false); // An explicit retry, never an automatic request loop.
  assert.equal(cache.snapshot(thread, streamed(stalePrefix), true), thread);

  const fresh = represented([['saved-b', 'turn-b', 'The newest canonical response.']], 4,
    [{ turnId: 'turn-b', identity: 'legacy', revision: 2, coverage: 'complete' }], 'actual-cursor-to-canonical-a');
  thread = cache.snapshot(thread, fresh, true, true, { canonical: true });
  assert.deepEqual(ids(thread), ['saved-b']);
  assert.equal(cache.cursor(thread, 'older'), 'actual-cursor-to-canonical-a');
  thread = cache.page(thread, { ...stalePrefix, nativeView: { ...stalePrefix.nativeView!, revision: 4 }, nativePage: { nextCursor: null, backwardsCursor: 'actual-after-a' } }, 'older');
  assert.deepEqual(ids(thread), ['saved-a-one', 'saved-a-two', 'saved-b']);
  assert.equal(cache.hasOlder(thread), false);
});

test('equal text in distinct native items stays distinct and native turns alone determine turn endings', () => {
  const text = 'I will check the recorded files.';
  for (const separateTurn of [false, true]) {
    const keys = ['commentary-one', 'commentary-two', 'commentary-three'];
    const messages = keys.map((key, index) => ({ ...message(key, text), turnId: separateTurn && index === 2 ? 'second-turn' : 'first-turn' }));
    const source = view(keys, null, null, { messages,
      timeline: { version: 1, revision: 3, nextSequence: 4, entries: keys.map((key, index) => ({ ...entry(key, text), sequence: index + 1, revision: index + 1 })) },
      turns: [...new Set(messages.map(message => message.turnId))].map(id => ({ id, userMessageId: `user-${id}`, startedAt: '2026-09-22T14:00:00Z',
        completedAt: '2026-09-22T14:00:03Z', status: 'completed', messageIds: messages.filter(message => message.turnId === id).map(message => message.id) })) });
    const cache = new ConversationHistoryCache();
    let thread = cache.snapshot(null, source, true, false, { canonical: true });
    thread = cache.event(thread, { type: 'snapshot', threadId: THREAD, thread: structuredClone(source) }, true)!;
    const rows = conversationTimeline(thread);
    assert.deepEqual(rows.filter(row => row.kind === 'message').map(row => [row.message.id, row.content]), keys.map(key => [key, text]));
    assert.equal(rows.filter(row => row.kind === 'turn-end').length, separateTurn ? 2 : 1);
  }
});

test('native pages prepend in native item order despite restarting local sequences and expose no invented history', () => {
  const cache = new ConversationHistoryCache();
  let thread = cache.snapshot(null, view(['item-3', 'item-4'], 'cursor/older?4 + =', 'reverse/4'), true, false, { canonical: true });
  assert.equal(cache.hasOlder(thread), true); assert.equal(cache.hasNewer(thread), false);
  assert.equal(cache.cursor(thread, 'older'), 'cursor/older?4 + =');
  thread = cache.page(thread, view(['item-1', 'item-2'], null, 'reverse/2'), 'older');
  assert.deepEqual(ids(thread), ['item-1', 'item-2', 'item-3', 'item-4']);
  assert.deepEqual(thread.timeline!.entries.map(row => row.sequence), [1, 2, 3, 4]);
  assert.deepEqual(thread.timeline!.entries.map(row => row.id), ['row:item-1', 'row:item-2', 'row:item-3', 'row:item-4']);
  assert.equal(thread.history, undefined); assert.equal(cache.hasOlder(thread), false);
  assert.ok(thread.messages.every(message => message.ordinal === undefined));
});

test('one-item pages retain a useful bounded window and reverse with real native anchors', () => {
  const cache = new ConversationHistoryCache();
  let thread = cache.snapshot(null, view(['item-200'], 'before:200', 'after:200'), true, false, { canonical: true });
  for (let index = 199; index >= 40; index--) thread = cache.page(thread, view([`item-${index}`], `before:${index}`, `after:${index}`), 'older');
  assert.equal(thread.messages.length, HISTORY_CACHE_ENTRIES);
  assert.equal(ids(thread)[0], 'item-40'); assert.equal(ids(thread).at(-1), 'item-199');
  assert.equal(cache.hasNewer(thread), true); assert.equal(cache.cursor(thread, 'newer'), 'after:199');
  const anchor = view(['item-199'], 'continue:199', 'reverse-older:199', { messages: [message('item-199', 'stale duplicate')] });
  thread = cache.page(thread, anchor, 'newer');
  assert.equal(thread.messages.at(-1)!.content, 'item-199'); assert.equal(cache.cursor(thread, 'newer'), 'continue:199');
  thread = cache.page(thread, view(['item-200'], null, 'reverse-older:200'), 'newer');
  assert.equal(thread.messages.length, HISTORY_CACHE_ENTRIES); assert.equal(ids(thread)[0], 'item-41'); assert.equal(ids(thread).at(-1), 'item-200');
  assert.equal(cache.hasNewer(thread), false); assert.equal(cache.hasOlder(thread), true);
});

test('short and empty public pages continue according to the native cursor only', () => {
  const cache = new ConversationHistoryCache();
  let thread = cache.snapshot(null, view(['latest'], 'opaque:first', 'reverse:latest'), true, false, { canonical: true });
  thread = cache.page(thread, view([], 'opaque:second', 'reverse:hidden'), 'older');
  assert.deepEqual(ids(thread), ['latest']); assert.equal(cache.hasOlder(thread), true); assert.equal(cache.cursor(thread, 'older'), 'opaque:second');
  thread = cache.page(thread, view(['earlier'], 'opaque:third', 'reverse:earlier'), 'older');
  assert.deepEqual(ids(thread), ['earlier', 'latest']); assert.equal(cache.hasOlder(thread), true);
  thread = cache.page(thread, view([], null, null), 'older');
  assert.equal(cache.hasOlder(thread), false); assert.deepEqual(ids(thread), ['earlier', 'latest']);
});

test('late canonical pages cannot overwrite live content or collapse its interleaved fragments', () => {
  const cache = new ConversationHistoryCache();
  let thread = cache.snapshot(null, view(['assistant'], 'older:assistant', 'after:assistant'), true, false, { canonical: true });
  const tool: ChatMessage = { ...message('tool-item', ''), activities: [{ id: 'tool-item', name: 'commandExecution', input: 'pwd', output: '/workspace', status: 'completed', startedAt: '2026-09-22T14:00:01Z' }] };
  const live = view(['assistant', 'tool-item'], 'older:assistant', 'after:assistant', { messages: [message('assistant', 'First then last'), tool],
    timeline: { version: 1, revision: 9, nextSequence: 4, entries: [entry('assistant', 'First', 'assistant'),
      { id: 'row:tool-item', messageId: 'tool-item', kind: 'activity', activityId: 'tool-item', sequence: 2, revision: 9 },
      { ...entry('assistant-second', ' then last', 'assistant'), startOffset: 5, sequence: 3, revision: 9 }] } });
  thread = cache.snapshot(thread, live, true);
  thread = cache.page(thread, view(['older-item', 'assistant'], null, 'reverse:assistant', { messages: [message('older-item'), message('assistant', 'stale full item')] }), 'older');
  assert.deepEqual(thread.timeline!.entries.map(row => row.id), ['row:older-item', 'row:assistant', 'row:tool-item', 'row:assistant-second']);
  assert.equal(thread.messages.find(message => message.id === 'assistant')!.content, 'First then last');
  assert.equal(thread.messages.find(message => message.id === 'tool-item')!.activities![0].output, '/workspace');
});

test('a live tail observed during initial history hydration preserves the authorized page and older cursor', () => {
  const cache = new ConversationHistoryCache();
  let thread = cache.snapshot(null, view(['read-before-live'], 'actual-native-older-cursor', 'actual-native-reverse-cursor'), true, false, { canonical: true });
  const live = view(['new-live-item'], null, null, { nativePage: undefined, status: 'running', native: { ...native(), activeTurnId: 'live-turn' } });
  thread = cache.event(thread, { type: 'snapshot', threadId: THREAD, thread: live }, true)!;
  assert.deepEqual(ids(thread), ['read-before-live', 'new-live-item']);
  assert.equal(cache.cursor(thread, 'older'), 'actual-native-older-cursor'); assert.equal(cache.hasOlder(thread), true);
  assert.equal(thread.native!.activeTurnId, 'live-turn'); assert.equal(thread.status, 'running');
  const metadataOnly = view([], null, null, { nativePage: undefined, status: 'idle' });
  thread = cache.event(thread, { type: 'snapshot', threadId: THREAD, thread: metadataOnly }, true)!;
  assert.deepEqual(ids(thread), ['read-before-live', 'new-live-item']);
  assert.equal(cache.cursor(thread, 'older'), 'actual-native-older-cursor'); assert.equal(thread.native!.activeTurnId, null);
  thread = cache.page(thread, view(['earlier'], null, 'native-previous-window'), 'older');
  assert.deepEqual(ids(thread), ['earlier', 'read-before-live', 'new-live-item']); assert.equal(cache.hasOlder(thread), false);
});

test('a live tail without a history page does not disturb a selected historical viewport', () => {
  const cache = new ConversationHistoryCache();
  let thread = cache.snapshot(null, view(['focused'], 'actual-native-older-cursor', 'actual-native-newer-cursor'), true, false, { canonical: true });
  cache.anchor(thread, 'row:focused', new Set(['row:focused']), new Set(['row:focused']));
  const live = view(['new-live-item'], null, null, { nativePage: undefined, status: 'running', native: { ...native(), activeTurnId: 'live-turn' } });
  thread = cache.event(thread, { type: 'snapshot', threadId: THREAD, thread: live }, false)!;
  assert.deepEqual(ids(thread), ['focused']); assert.equal(thread.native!.activeTurnId, 'live-turn');
  assert.equal(cache.cursor(thread, 'older'), 'actual-native-older-cursor'); assert.equal(cache.cursor(thread, 'newer'), 'actual-native-newer-cursor');
  assert.equal(cache.hasNewer(thread), true); assert.equal(cache.unseen, 1);
});

test('a historical window keeps its rows while native controls and unread tail notifications remain current', () => {
  const cache = new ConversationHistoryCache();
  let thread = cache.snapshot(null, view(['old-item'], 'before:old', 'after:old'), true, false, { canonical: true });
  cache.anchor(thread, 'row:old-item', new Set(['row:old-item']), new Set(['row:old-item']));
  const latest = view(['live-item'], 'before:live', 'after:live', { status: 'awaiting_approval', native: { ...native(), activeTurnId: 'running-turn',
    approvals: [{ id: 'rpc-approval', threadId: THREAD, turnId: 'running-turn', itemId: 'command-item', kind: 'command', title: 'Run command', description: 'Review this command.', command: 'pwd', decisions: ['accept', 'decline'], createdAt: '2026-09-22T14:00:02Z' }] } });
  thread = cache.snapshot(thread, latest, false);
  assert.deepEqual(ids(thread), ['old-item']); assert.equal(thread.native!.approvals[0].id, 'rpc-approval'); assert.equal(thread.status, 'awaiting_approval');
  assert.equal(cache.hasNewer(thread), true); assert.equal(cache.cursor(thread, 'newer'), 'after:old'); assert.equal(cache.unseen, 1);
  thread = cache.snapshot(thread, latest, false); assert.equal(cache.unseen, 1);
});

test('focused native item retention is bounded and refuses further growth without corrupting the cursor', () => {
  const cache = new ConversationHistoryCache();
  let thread = cache.snapshot(null, view(['focused'], 'before:focused', 'after:focused'), true, false, { canonical: true });
  cache.anchor(thread, 'row:focused', new Set(['row:focused']));
  for (let index = 0; index < NATIVE_HISTORY_MAX_ITEMS - 1; index++) thread = cache.page(thread, view([`older-${index}`], `before:${index}`, `after:${index}`), 'older');
  const cursor = cache.cursor(thread, 'older');
  assert.equal(thread.messages.length, NATIVE_HISTORY_MAX_ITEMS); assert.ok(ids(thread).includes('focused'));
  assert.throws(() => cache.page(thread, view(['one-too-many'], 'before:overflow', 'after:overflow'), 'older'), /Move keyboard focus|display bounds/);
  assert.equal(cache.cursor(thread, 'older'), cursor); assert.ok(ids(thread).includes('focused'));
  cache.anchor(thread, null, new Set());
  thread = cache.page(thread, view(['after-focus-clears'], 'before:continuation', 'after:continuation'), 'older');
  assert.equal(thread.messages.length, HISTORY_CACHE_ENTRIES); assert.equal(cache.cursor(thread, 'older'), 'before:continuation');
});

test('explicit native history replacement drops prior page boundaries and rows', () => {
  const cache = new ConversationHistoryCache();
  let thread = cache.snapshot(null, view(['before-revert', 'removed'], 'older:old', 'after:old'), true, false, { canonical: true });
  cache.anchor(thread, 'row:removed', new Set(['row:removed']));
  thread = cache.snapshot(thread, view(['before-revert'], null, 'after:retained'), false, true);
  assert.deepEqual(ids(thread), ['before-revert']); assert.equal(cache.hasOlder(thread), false); assert.equal(cache.hasNewer(thread), false); assert.equal(cache.unseen, 0);
});

test('a canonical latest read retains a newer observed live suffix and its current control state', () => {
  const cache = new ConversationHistoryCache();
  const live = view(['anchor', 'newer-live'], 'older:anchor', 'after:anchor', { status: 'running', native: { ...native(), activeTurnId: 'live-turn' }, messages: [message('anchor', 'current live content'), message('newer-live')] });
  let thread = cache.snapshot(null, live, true);
  const stale = view(['anchor'], 'canonical:older', 'canonical:reverse', { messages: [message('anchor', 'older canonical content')] });
  thread = cache.snapshot(thread, stale, true, true, { canonical: true, preserveMetadata: true });
  assert.deepEqual(ids(thread), ['anchor', 'newer-live']); assert.equal(thread.messages[0].content, 'current live content');
  assert.equal(thread.native!.activeTurnId, 'live-turn'); assert.equal(cache.cursor(thread, 'older'), 'canonical:older'); assert.equal(thread.history, undefined);
});

test('nonadvancing or wrong-conversation native responses are rejected', () => {
  const cache = new ConversationHistoryCache();
  const thread = cache.snapshot(null, view(['latest'], 'same-cursor', 'after:latest'), true, false, { canonical: true });
  assert.throws(() => cache.page(thread, view([], 'same-cursor', 'after:latest'), 'older'), /did not advance/);
  assert.throws(() => cache.page(thread, view(['wrong'], null, null, { id: 'another-thread' }), 'older'), /does not match/);
  assert.deepEqual(ids(thread), ['latest']); assert.equal(cache.cursor(thread, 'older'), 'same-cursor');
});

test('native overflow invalidation requests a canonical refill and keeps focused rows until explicit movement', () => {
  const cache = new ConversationHistoryCache();
  const thread = cache.snapshot(null, view(['focused'], 'before:focused', 'after:focused'), true, false, { canonical: true });
  cache.anchor(thread, 'row:focused', new Set(['row:focused']));
  const unchanged = cache.event(thread, { type: 'error', threadId: THREAD, code: 'NATIVE_VIEW_WINDOW_LIMIT' }, true)!;
  assert.deepEqual(ids(unchanged), ['focused']); assert.equal(cache.takeLatestRefresh(unchanged), false); assert.equal(cache.refreshLatest, true);
  cache.anchor(unchanged, null, new Set()); assert.equal(cache.takeLatestRefresh(unchanged), true); assert.equal(cache.refreshLatest, false);
});


test('native items without a public row do not invent unread display content', () => {
  const cache = new ConversationHistoryCache();
  let thread = cache.snapshot(null, view(['visible'], 'before:visible', 'after:visible'), true, false, { canonical: true });
  const update = view(['visible', 'private-only'], 'before:visible', 'after:visible', {
    timeline: { version: 1, revision: 2, nextSequence: 2, entries: [entry('visible')] },
  });
  thread = cache.snapshot(thread, update, false);
  assert.deepEqual(ids(thread), ['visible']); assert.equal(cache.unseen, 0); assert.equal(cache.hasNewer(thread), false);
});
