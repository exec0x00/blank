import { describe, expect, it } from 'vitest';
import type { AgentEvent, ConversationTimelineEntry, Thread } from '../shared/types';
import { ConversationHistoryCache, HISTORY_CACHE_ENTRIES, HISTORY_CACHE_PAGES } from '../client/components/chat/history-cache';
import { applyAgentEvent } from '../client/components/chat/state';
import { conversationTimeline } from '../client/components/chat/timeline';
import { anchorAt, anchorOffset, indexAt, mountedIndices, offsetForKey, visibleWindow, windowLayout } from '../client/components/chat/window-layout';

const at = '2026-09-20T10:00:00.000Z';
function page(first: number, last: number, options: { latest?: number; revision?: number; epoch?: string } = {}): Thread {
  const latest = options.latest ?? 720, revision = options.revision ?? latest, epoch = options.epoch ?? 'saved-epoch';
  const entries: ConversationTimelineEntry[] = Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => {
    const sequence = first + index;
    return { id: `entry-${sequence}`, kind: 'message', messageId: `message-${sequence}`, sequence, revision: sequence };
  });
  return { id: 'thread-fixture', workspaceId: 'workspace-fixture', title: 'Saved history fixture', createdAt: at, updatedAt: at, status: 'idle',
    messages: entries.map(entry => ({ id: entry.messageId, role: entry.sequence % 2 ? 'user' : 'assistant', content: `Saved content ${entry.sequence}.`, createdAt: at, ordinal: entry.sequence })),
    timeline: { version: 1, revision, nextSequence: latest + 1, entries },
    history: { version: 1, epoch, revision, oldestSequence: entries.length ? first : null, newestSequence: entries.length ? last : null, latestSequence: latest,
      totalMessages: latest, olderCursor: `before-${first}`, newerCursor: `after-${last}`, hasOlder: first > 1, hasNewer: last < latest } };
}

describe('measured window geometry', () => {
  it('mounts the visible region and isolated interaction rows without mounting the gap', () => {
    const keys = Array.from({ length: 1_000 }, (_, index) => `row-${index}`);
    const layout = windowLayout(keys, new Map([['row-20', 900]]), () => 80);
    const range = visibleWindow(layout, layout.offsets[500], 640, 160);
    const shown = mountedIndices(layout, range.start, range.end, new Set(['row-8', 'row-975']));
    expect(shown).toContain(8); expect(shown).toContain(975);
    expect(shown).toContain(500);
    expect(shown.length).toBeLessThan(18);
    expect(shown).not.toContain(300);
    expect(indexAt(layout, layout.offsets[20] + 850)).toBe(20);
  });

  it('keeps the exact in-row position through prepend, image height changes and tail eviction', () => {
    const keys = Array.from({ length: 50 }, (_, index) => `row-${index + 50}`);
    const before = windowLayout(keys, new Map(), () => 100);
    const anchor = anchorAt(before, 1_237);
    expect(anchor).toEqual({ key: 'row-62', offset: 37 });
    const prepended = windowLayout([...Array.from({ length: 40 }, (_, index) => `row-${index + 10}`), ...keys.slice(0, 30)], new Map([['row-40', 440]]), () => 100);
    expect(anchorOffset(prepended, anchor)).toBe(5_577);
    expect(anchorAt(prepended, anchorOffset(prepended, anchor)!)).toEqual(anchor);
    const wrapped = windowLayout(prepended.keys, new Map([['row-40', 440], ['row-62', 900]]), () => 140);
    expect(anchorAt(wrapped, anchorOffset(wrapped, anchor)!)).toEqual(anchor);
    expect(anchorOffset(windowLayout(['different'], new Map(), () => 100), anchor)).toBeNull();
    const long = anchorAt(windowLayout(['long', 'next'], new Map([['long', 1_000]]), () => 100), 800);
    expect(anchorOffset(windowLayout(['long', 'next'], new Map([['long', 20]]), () => 100), long)).toBe(19);
  });

  it('preserves footer navigation beyond the measured timeline instead of snapping 324px into its last row', () => {
    const layout = windowLayout(['a', 'b', 'c', 'd', 'e'], new Map(), () => 200);
    const viewportHeight = 480, expandedFooterHeight = 803;
    const scrollBottom = layout.total + expandedFooterHeight - viewportHeight;
    const anchor = anchorAt(layout, scrollBottom);
    // End/scrollTop=scrollHeight can put the viewport wholly inside the child
    // disclosure after the virtualized rows. It is not a last-row offset.
    expect(anchorOffset(layout, anchor)).toBe(scrollBottom);
    expect(Math.abs(scrollBottom - anchorOffset(layout, anchor)!)).toBeLessThanOrEqual(3);
  });

  it('keeps footer offsets relative to the measured end through prepend and height changes', () => {
    const before = windowLayout(['a', 'b'], new Map(), () => 100);
    const footer = anchorAt(before, 237.5);
    const prepended = windowLayout(['older', 'a', 'b'], new Map([['older', 180], ['a', 140]]), () => 100);
    expect(anchorOffset(prepended, footer)).toBe(prepended.total + 37.5);
    const collapsed = windowLayout(['older', 'a', 'b'], new Map([['older', 180], ['a', 140], ['b', 20]]), () => 100);
    expect(anchorOffset(collapsed, footer)).toBe(collapsed.total + 37.5);
    expect(anchorAt(collapsed, anchorOffset(collapsed, footer)!)).toEqual(footer);
  });

  it('distinguishes the exact footer boundary while retaining ordinary first-row margin anchors', () => {
    const before = windowLayout(['a', 'b'], new Map(), () => 100);
    const boundary = anchorAt(before, before.total);
    expect(anchorOffset(before, boundary)).toBe(before.total);
    const shrunk = windowLayout(['a', 'b'], new Map([['b', 20]]), () => 100);
    expect(anchorOffset(shrunk, boundary)).toBe(shrunk.total);
    const margin = anchorAt(before, -12);
    expect(margin).toEqual({ key: 'a', offset: -12 });
    expect(anchorOffset(windowLayout(['older', 'a', 'b'], new Map(), () => 100), margin)).toBe(88);
    expect(anchorAt(windowLayout([], new Map(), () => 100), 300)).toBeNull();
  });

  it('reveals keyed variable-height rows without moving an already visible nearest target', () => {
    const layout = windowLayout(['a', 'b', 'c', 'd', 'e'], new Map([['b', 300], ['d', 240]]), () => 100);
    expect(offsetForKey(layout, 'd', 0, 300, 'start')).toBe(500);
    expect(offsetForKey(layout, 'd', 0, 300, 'center')).toBe(470);
    expect(offsetForKey(layout, 'd', 0, 300, 'end')).toBe(440);
    expect(offsetForKey(layout, 'd', 100, 300)).toBe(440);
    expect(offsetForKey(layout, 'd', 470, 300)).toBe(470);
    expect(offsetForKey(layout, 'a', 470, 300)).toBe(0);
    expect(offsetForKey(layout, 'b', 200, 100)).toBe(200);
    expect(offsetForKey(layout, 'missing', 0, 300)).toBeNull();
    expect(offsetForKey(layout, 'a', 0, 0)).toBeNull();
    const changed = windowLayout(layout.keys, new Map([['b', 500], ['d', 340]]), () => 100);
    expect(offsetForKey(changed, 'd', 470, 300, 'center')).toBe(720);
  });
});

describe('bounded public conversation page cache', () => {
  it('loads recent history first and evicts newer page data while walking toward the oldest saved messages', () => {
    const cache = new ConversationHistoryCache();
    let current = cache.snapshot(null, page(681, 720), true);
    expect(current.messages).toHaveLength(40);
    for (let last = 680; last >= 40; last -= 40) {
      current = cache.page(current, page(last - 39, last), 'older');
      expect(current.timeline!.entries.length).toBeLessThanOrEqual(HISTORY_CACHE_PAGES * 40);
      expect(current.messages.length).toBeLessThanOrEqual(HISTORY_CACHE_ENTRIES);
    }
    expect(current.history).toMatchObject({ oldestSequence: 1, newestSequence: 160, hasOlder: false, hasNewer: true, latestSequence: 720, newerCursor: 'after-160' });
    expect(current.messages.some(message => message.id === 'message-720')).toBe(false);
    current = cache.page(current, page(161, 200), 'newer');
    expect(current.history).toMatchObject({ oldestSequence: 41, newestSequence: 200, olderCursor: 'before-41', newerCursor: 'after-200' });
    expect(current.messages.some(message => message.id === 'message-1')).toBe(false);
  });

  it('keeps live controls without appending a distant newest snapshot to a historical viewport', () => {
    const cache = new ConversationHistoryCache();
    const current = cache.snapshot(null, page(121, 160), false);
    const next = page(701, 740, { latest: 740, revision: 800 });
    next.status = 'awaiting_approval'; next.pendingApproval = { id: 'approval-live', threadId: next.id, tool: 'shell', description: 'Run the requested tests.' };
    const merged = cache.snapshot(current, next, false);
    expect(merged.messages).toBe(current.messages);
    expect(merged.timeline).toBe(current.timeline);
    expect(merged.pendingApproval).toEqual(next.pendingApproval);
    expect(merged.history).toMatchObject({ oldestSequence: 121, newestSequence: 160, latestSequence: 740, hasNewer: true });
    expect(cache.unseen).toBe(1);
    const reread = cache.snapshot(merged, next, false);
    expect(cache.unseen).toBe(1);
    expect(reread.messages).toHaveLength(40);
  });

  it('retains focused turn actions across a following reconnect without creating a missing middle range', () => {
    const cache = new ConversationHistoryCache();
    const current = cache.snapshot(null, page(681, 720), true);
    current.turns = [{ id: 'focused-turn', ordinal: 99, userMessageId: 'message-699', messageIds: ['message-699', 'message-700'],
      startedAt: at, status: 'completed', firstSequence: 699, lastSequence: 700 }];
    cache.anchor(current, 'entry-715', new Set(['turn-end:focused-turn']), new Set(['entry-716']));
    const incoming = page(761, 800, { latest: 800, revision: 810 });
    incoming.pendingApproval = { id: 'newest-approval', threadId: current.id, tool: 'shell', description: 'Approve the explicit fixture.' };
    incoming.status = 'awaiting_approval';
    const retained = cache.snapshot(current, incoming, true);
    expect(retained.messages).toBe(current.messages);
    expect(retained.timeline).toBe(current.timeline);
    expect(retained.pendingApproval?.id).toBe('newest-approval');
    expect(retained.history).toMatchObject({ oldestSequence: 681, newestSequence: 720, newerCursor: 'after-720', latestSequence: 800, totalMessages: 800, hasNewer: true });
    expect(retained.timeline!.entries.some(entry => entry.sequence > 720)).toBe(false);
    const bridge = { ...page(721, 760, { latest: 800, revision: 810 }), pendingApproval: incoming.pendingApproval, status: incoming.status };
    const advanced = cache.page(retained, bridge, 'newer');
    expect(advanced.history).toMatchObject({ oldestSequence: 681, newestSequence: 760, newerCursor: 'after-760', hasNewer: true });
    expect(advanced.timeline!.entries.map(entry => entry.sequence)).toEqual(Array.from({ length: 80 }, (_, index) => 681 + index));
    const jumped = cache.snapshot(advanced, incoming, true, true);
    expect(jumped.messages.some(message => message.id === 'message-700')).toBe(false);
    expect(jumped.history).toMatchObject({ oldestSequence: 761, newestSequence: 800, hasNewer: false });
    expect(cache.snapshot(jumped, page(841, 880, { latest: 880, revision: 880 }), true).history!.oldestSequence).toBe(841);
  });

  it('distinguishes actual selections from viewport-only anchors during an automatic latest advance', () => {
    const selected = new ConversationHistoryCache();
    const old = selected.snapshot(null, page(681, 720), true);
    selected.anchor(old, 'entry-715', new Set(['entry-695']));
    expect(selected.snapshot(old, page(761, 800, { latest: 800 }), true).messages).toBe(old.messages);
    const unselected = new ConversationHistoryCache();
    const visible = unselected.snapshot(null, page(681, 720), true);
    unselected.anchor(visible, 'entry-715', new Set(), new Set(['entry-716', 'entry-717']));
    const advanced = unselected.snapshot(visible, page(761, 800, { latest: 800 }), true);
    expect(advanced.history).toMatchObject({ oldestSequence: 761, newestSequence: 800, hasNewer: false });
    expect(advanced.messages.some(message => message.id === 'message-715')).toBe(false);
  });

  it('drains one queued cursorless refill and advances a contained saved cursor without replacing newer rows', () => {
    const cache = new ConversationHistoryCache();
    let current = cache.snapshot(null, page(1, 40, { latest: 40 }), true);
    const append = (sequence: number) => {
      current = cache.event(current, { type: 'timeline', threadId: current.id, version: 1, revision: sequence, historyEpoch: 'saved-epoch', historyRevision: sequence,
        entry: { id: `entry-${sequence}`, messageId: `message-${sequence}`, kind: 'text', text: `Cursorless fixture ${sequence}.`, startOffset: 0, sequence, revision: sequence },
        message: { id: `message-${sequence}`, role: 'assistant', content: '', createdAt: at, ordinal: sequence } }, true)!;
    };
    const saved = (first: number, last: number) => {
      const snapshot = page(first, last, { latest: last });
      const entries = current.timeline!.entries.filter(entry => entry.sequence >= first && entry.sequence <= last);
      const ids = new Set(entries.map(entry => entry.messageId));
      return structuredClone({ ...snapshot, messages: current.messages.filter(message => ids.has(message.id)), timeline: { ...snapshot.timeline!, entries } });
    };
    for (let sequence = 41; sequence <= 81; sequence++) append(sequence);
    const firstResponse = saved(42, 81);
    expect(cache.takeLatestRefresh(current)).toBe(true); // The first request is now in flight.
    for (let sequence = 82; sequence <= 90; sequence++) append(sequence);
    const secondResponse = saved(51, 90);
    expect(cache.refreshLatest).toBe(true);
    current = cache.snapshot(current, firstResponse, true);
    expect(current.history).toMatchObject({ newestSequence: 90, newerCursor: 'after-81', revision: 90 });
    expect(cache.takeLatestRefresh(current)).toBe(true);
    current = cache.snapshot(current, secondResponse, true);
    expect(current.history).toMatchObject({ newestSequence: 90, newerCursor: 'after-90' });
    expect(cache.takeLatestRefresh(current)).toBe(false);
    append(91);
    expect(cache.takeLatestRefresh(current)).toBe(false); // A token/frame is not a new page refill.
  });

  it('suppresses queued refills when an in-flight automatic snapshot is blocked by selected text', () => {
    const cache = new ConversationHistoryCache();
    let current = cache.snapshot(null, page(1, 40, { latest: 40 }), true);
    for (let sequence = 41; sequence <= 81; sequence++) current = cache.event(current, {
      type: 'timeline', threadId: current.id, version: 1, revision: sequence, historyRevision: sequence, historyEpoch: 'saved-epoch',
      entry: { id: `entry-${sequence}`, messageId: `message-${sequence}`, kind: 'text', text: `Cursorless fixture ${sequence}.`, startOffset: 0, sequence, revision: sequence },
    }, true)!;
    expect(cache.takeLatestRefresh(current)).toBe(true);
    current = cache.event(current, { type: 'timeline', threadId: current.id, version: 1, revision: 82, historyRevision: 82, historyEpoch: 'saved-epoch',
      entry: { id: 'entry-82', messageId: 'message-82', kind: 'text', text: 'Another queued fixture.', startOffset: 0, sequence: 82, revision: 82 } }, true)!;
    cache.anchor(current, 'entry-80', new Set(['entry-45']));
    const incoming = page(101, 140, { latest: 140, revision: 200 });
    const retained = cache.snapshot(current, incoming, true);
    expect(retained.messages).toBe(current.messages);
    expect(retained.history).toMatchObject({ newestSequence: 82, newerCursor: 'after-40', latestSequence: 140, hasNewer: true });
    expect(cache.takeLatestRefresh(retained)).toBe(false);
    expect(cache.refreshLatest).toBe(false);
    cache.anchor(retained, 'entry-80', new Set());
    expect(cache.takeLatestRefresh(retained)).toBe(false);
    expect(cache.snapshot(retained, incoming, true, true).history!.oldestSequence).toBe(101);
  });

  it('discards unseen content beyond the resident interval during a long live run and can return to latest', () => {
    const cache = new ConversationHistoryCache();
    let current = cache.snapshot(null, page(121, 160), false);
    for (let sequence = 721; sequence <= 1_320; sequence++) {
      const event: AgentEvent = { type: 'timeline', threadId: current.id, version: 1, historyEpoch: 'saved-epoch', historyRevision: sequence,
        revision: sequence, entry: { id: `live-${sequence}`, messageId: `live-message-${sequence}`, kind: 'text', text: `Live ${sequence}`, startOffset: 0, sequence, revision: sequence } };
      current = cache.event(current, event, false)!;
    }
    expect(current.messages).toHaveLength(40);
    expect(current.timeline!.entries).toHaveLength(40);
    expect(current.history).toMatchObject({ latestSequence: 1_320, newestSequence: 160, hasNewer: true });
    expect(cache.unseen).toBe(600);
    current = cache.snapshot(current, page(1_281, 1_320, { latest: 1_320 }), true, true);
    expect(current.history).toMatchObject({ oldestSequence: 1_281, newestSequence: 1_320, hasNewer: false });
    expect(cache.unseen).toBe(0);
    expect(current.messages).toHaveLength(40);
  });

  it('rejects stale epochs/revisions after rewind and never restores removed messages', () => {
    const cache = new ConversationHistoryCache();
    const old = cache.snapshot(null, page(681, 720), true);
    const rewound = cache.snapshot(old, page(1, 20, { latest: 20, revision: 900, epoch: 'rewound-epoch' }), false);
    expect(cache.page(rewound, page(641, 680), 'older')).toBe(rewound);
    expect(cache.snapshot(rewound, page(681, 720, { revision: 950 }), false)).toBe(rewound);
    expect(cache.event(rewound, { type: 'message', threadId: old.id, historyEpoch: 'saved-epoch', historyRevision: 1_000,
      message: { id: 'removed', role: 'assistant', content: 'Removed content', createdAt: at } }, false)).toBe(rewound);
    expect(cache.snapshot(rewound, page(1, 10, { latest: 10, epoch: 'rewound-epoch', revision: 800 }), true, true)).toBe(rewound);
  });

  it('advances signed live cursors and evicts complete fixed-size live segments', () => {
    const cache = new ConversationHistoryCache();
    let current = cache.snapshot(null, page(121, 160, { latest: 160 }), true);
    const append = (sequence: number, following: boolean) => {
      current = cache.event(current, { type: 'timeline', threadId: current.id, version: 1, revision: sequence, historyEpoch: 'saved-epoch', historyRevision: sequence,
        historyCursor: `boundary-${sequence}`, entry: { id: `entry-${sequence}`, messageId: `message-${sequence}`, kind: 'text', text: `Live ${sequence}`, startOffset: 0, sequence, revision: sequence },
        message: { id: `message-${sequence}`, role: 'assistant', content: '', createdAt: at, ordinal: sequence } }, following)!;
    };
    for (let sequence = 161; sequence <= 320; sequence++) append(sequence, false);
    expect(current.timeline!.entries).toHaveLength(160);
    expect(current.history).toMatchObject({ newestSequence: 280, newerCursor: 'boundary-280', hasNewer: true });
    current = cache.page(current, page(281, 320, { latest: 320 }), 'newer');
    expect(current.history).toMatchObject({ oldestSequence: 161, newestSequence: 320, olderCursor: 'boundary-161', newerCursor: 'after-320', hasNewer: false });
    for (let sequence = 321; sequence <= 1_000; sequence++) {
      append(sequence, true);
      expect(current.timeline!.entries.length).toBeLessThanOrEqual(160);
      expect(current.messages.length).toBeLessThanOrEqual(160);
    }
    expect(current.history).toMatchObject({ newestSequence: 1_000, newerCursor: 'boundary-1000', hasNewer: false });
    expect(current.messages.some(message => message.id === 'message-161')).toBe(false);
  });

  it('does not retain compatibility tool or summary bodies when their timeline entries have been evicted', () => {
    const cache = new ConversationHistoryCache();
    const initial = page(1, 40, { latest: 40 });
    initial.messages = [{ id: 'one-long-message', role: 'assistant', content: '', createdAt: at, activities: [] }];
    initial.timeline!.entries = initial.timeline!.entries.map(entry => ({ ...entry, kind: 'activity', messageId: 'one-long-message', activityId: `activity-${entry.sequence}` }));
    let current = cache.snapshot(null, initial, false);
    for (let sequence = 41; sequence <= 500; sequence++) {
      const revision = sequence * 3;
      current = cache.event(current, { type: 'timeline', threadId: current.id, version: 1, revision, historyRevision: revision, historyEpoch: 'saved-epoch', historyCursor: `boundary-${sequence}`,
        entry: { id: `entry-${sequence}`, kind: 'activity', messageId: 'one-long-message', activityId: `activity-${sequence}`, sequence, revision } }, false)!;
      current = cache.event(current, { type: 'activity', threadId: current.id, messageId: 'one-long-message', historyEpoch: 'saved-epoch', historyRevision: revision + 1,
        activity: { id: `activity-${sequence}`, name: 'read_file', input: '{}', output: 'Public saved output.', status: 'completed', startedAt: at } }, false)!;
      current = cache.event(current, { type: 'reasoning_summary', threadId: current.id, messageId: 'one-long-message', historyEpoch: 'saved-epoch', historyRevision: revision + 2,
        summary: { id: `unloaded-summary-${sequence}`, summaryIndex: 0, text: 'Unloaded public summary.', status: 'complete' } }, false)!;
    }
    expect(current.timeline!.entries).toHaveLength(160);
    expect(current.messages[0].activities?.length).toBeLessThanOrEqual(160);
    expect(current.messages[0].activities?.some(activity => activity.id === 'activity-500')).toBe(false);
    expect(current.messages[0].reasoningSummary?.length ?? 0).toBe(0);
    expect(current.history!.hasNewer).toBe(true);
  });

  it('accepts missing latest page content after a newer SSE control revision without reverting that control', () => {
    const cache = new ConversationHistoryCache();
    let current = cache.snapshot(null, page(1, 40, { latest: 1_000, revision: 1_010 }), false);
    current = cache.event(current, { type: 'question', threadId: current.id, historyEpoch: 'saved-epoch', historyRevision: 1_012,
      question: { id: 'current-question', threadId: current.id, callId: 'call', createdAt: at, questions: [] } }, false)!;
    const latest = cache.snapshot(current, page(961, 1_000, { latest: 1_000, revision: 1_011 }), true, true);
    expect(latest.history).toMatchObject({ revision: 1_012, oldestSequence: 961, newestSequence: 1_000, hasNewer: false });
    expect(latest.status).toBe('awaiting_input');
    expect(latest.pendingQuestion?.id).toBe('current-question');
    expect(latest.messages[0].id).toBe('message-961');
    const obsoleteEmpty = page(1, 0, { latest: 0, revision: 1 });
    expect(cache.snapshot(latest, obsoleteEmpty, true).messages).toBe(latest.messages);
  });

  it('retains focused turn controls and live approvals when a snapshot exceeds the protected cache cap', () => {
    const cache = new ConversationHistoryCache();
    let current = cache.snapshot(null, page(681, 720), true);
    current.turns = [{ id: 'selected-turn', ordinal: 99, userMessageId: 'message-700', messageIds: ['message-700', 'message-715'], startedAt: at, status: 'completed', lastSequence: 715 }];
    current.messages.find(message => message.id === 'message-715')!.turnId = 'selected-turn';
    cache.anchor(current, 'entry-685', new Set(['turn-end:selected-turn']));
    for (let last = 680; last >= 520; last -= 40) current = cache.page(current, page(last - 39, last), 'older');
    const snapshot = page(700, 739, { latest: 739, revision: 900 });
    snapshot.pendingApproval = { id: 'still-actionable', threadId: current.id, tool: 'shell', description: 'Approve the saved fixture.' };
    snapshot.status = 'awaiting_approval';
    const merged = cache.snapshot(current, snapshot, false);
    expect(merged.messages).toBe(current.messages);
    expect(merged.messages).toHaveLength(240);
    expect(merged.pendingApproval?.id).toBe('still-actionable');
    expect(merged.history).toMatchObject({ totalMessages: 739, hasNewer: true });
  });

  it('merges older entry data without replacing newer revisions or live request metadata', () => {
    const cache = new ConversationHistoryCache();
    let current = cache.snapshot(null, page(81, 120, { latest: 120, revision: 140 }), true);
    current = { ...current, status: 'awaiting_input', pendingQuestion: { id: 'new-question', threadId: current.id, callId: 'call', createdAt: at, questions: [] } };
    current.messages[0].content = 'Corrected canonical content.';
    const older = page(61, 100, { latest: 120, revision: 130 });
    const merged = cache.page(current, older, 'older');
    expect(merged.history!.revision).toBe(140);
    expect(merged.pendingQuestion?.id).toBe('new-question');
    expect(merged.messages.find(message => message.id === 'message-81')?.content).toBe('Corrected canonical content.');
    expect(merged.timeline!.entries.map(entry => entry.sequence)).toEqual(Array.from({ length: 60 }, (_, index) => index + 61));
  });

  it('pins focused/selected resident pages within a hard bound until the interaction ends', () => {
    const cache = new ConversationHistoryCache();
    let current = cache.snapshot(null, page(681, 720), true);
    cache.anchor(current, 'entry-690', new Set(['entry-690']));
    for (let last = 680; last >= 520; last -= 40) current = cache.page(current, page(last - 39, last), 'older');
    expect(current.messages).toHaveLength(240);
    expect(current.messages.some(message => message.id === 'message-690')).toBe(true);
    expect(() => cache.page(current, page(441, 480), 'older')).toThrow(/keyboard focus|selection/);
    cache.anchor(current, 'entry-490', new Set());
    current = cache.page(current, page(441, 480), 'older');
    expect(current.messages.length).toBeLessThanOrEqual(160);
    expect(current.messages.some(message => message.id === 'message-690')).toBe(false);
  });

  it('does not fabricate canonical copy text from one partial message page', () => {
    const partial = page(20, 20, { latest: 20 });
    partial.messages = [{ id: 'long-message', role: 'assistant', content: 'Canonical preview', contentChars: 20_000, contentTruncated: true, createdAt: at }];
    partial.timeline!.entries = [{ id: 'late-fragment', messageId: 'long-message', kind: 'text', text: 'A later fragment.', startOffset: 10_000, sequence: 20, revision: 20 }];
    const next = applyAgentEvent(partial, { type: 'timeline', threadId: partial.id, version: 1, revision: 21,
      entry: { ...partial.timeline!.entries[0], kind: 'text', text: 'A corrected later fragment.', startOffset: 10_000, revision: 21 } })!;
    expect(next.messages[0].content).toBe('Canonical preview');
    expect(next.messages[0].contentTruncated).toBe(true);
    expect(conversationTimeline(next).find(row => row.kind === 'message')).toMatchObject({ content: 'A corrected later fragment.' });
  });

  it('shows a completed turn action only on the page containing its actual ending and keeps global ordinals', () => {
    const thread = page(100, 120, { latest: 160 });
    thread.messages.forEach(message => { message.turnId = 'long-turn'; });
    thread.turns = [{ id: 'long-turn', ordinal: 50, firstSequence: 100, lastSequence: 140, userMessageId: 'message-100', messageIds: thread.messages.map(message => message.id), startedAt: at, status: 'completed' }];
    expect(conversationTimeline(thread).some(row => row.kind === 'turn-end')).toBe(false);
    const end = page(121, 140, { latest: 160 });
    end.messages.forEach(message => { message.turnId = 'long-turn'; });
    end.turns = [{ ...thread.turns[0], messageIds: end.messages.map(message => message.id) }];
    expect(conversationTimeline(end).at(-1)).toMatchObject({ kind: 'turn-end', ordinal: 50, turn: { id: 'long-turn' } });
  });
});
