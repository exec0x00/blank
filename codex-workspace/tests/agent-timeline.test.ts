import { describe, expect, it } from 'vitest';
import type { AgentEvent, ChatMessage, ConversationTimelineEntry, Thread, ToolActivity } from '../shared/types';
import { createRedactor } from '../server/agent/redact';
import { ensureConversationTimeline, projectConversationTimeline, TimelineTextStream, TimelineWriter } from '../server/agent/timeline';

const at = '2026-09-20T10:00:00.000Z';
function fixture() {
  const message: ChatMessage = { id: 'assistant-1', role: 'assistant', content: '', createdAt: at, activities: [] };
  const thread: Thread = { id: 'thread-1', workspaceId: 'workspace-1', title: 'Timeline fixture', createdAt: at, updatedAt: at,
    status: 'running', messages: [message], timeline: { version: 1, revision: 0, nextSequence: 1, entries: [] } };
  const events: AgentEvent[] = [];
  const writer = new TimelineWriter(thread, entry => events.push({ type: 'timeline', threadId: thread.id, version: 1, revision: entry.revision, entry }));
  return { thread, message, writer, events };
}
function activity(writer: TimelineWriter, message: ChatMessage, id: string, startedAt = at) {
  const tool: ToolActivity = { id, name: 'read_file', input: JSON.stringify({ path: `${id}.txt` }), status: 'running', startedAt };
  message.activities!.push(tool); writer.activity(message.id, tool); return tool;
}
function visible(thread: Thread) {
  return thread.timeline!.entries.filter(entry => !('text' in entry) || !!entry.text).map(entry =>
    entry.kind === 'text' || entry.kind === 'reasoning' ? `${entry.kind}:${entry.text}` : entry.kind === 'activity' ? `tool:${entry.activityId}` : `${entry.kind}:${entry.messageId}`);
}
describe('persisted chronological timeline evidence', () => {
  it('records tool → text → tool inside one message using event sequence despite equal or reversed timestamps', () => {
    const { thread, message, writer } = fixture();
    const stream = new TimelineTextStream(writer, message, createRedactor([]));
    activity(writer, message, 'first', '2030-01-01T00:00:00.000Z');
    stream.push('Between the tools.');
    activity(writer, message, 'second', '2000-01-01T00:00:00.000Z');
    stream.push('After the second tool.'); stream.finish();
    expect(visible(thread)).toEqual(['tool:first', 'text:Between the tools.', 'tool:second', 'text:After the second tool.']);
    expect(message.content).toBe('Between the tools.After the second tool.');
    expect(thread.timeline!.entries.map(entry => entry.sequence)).toEqual([1, 2, 3, 4]);
  });

  it('keeps an activity ID in its initial position while its real status and output change', () => {
    const { thread, message, writer } = fixture();
    const tool = activity(writer, message, 'read');
    new TimelineTextStream(writer, message, createRedactor([])).push('A later message fragment.');
    const original = thread.timeline!.entries[0];
    const identity = { id: original.id, sequence: original.sequence };
    tool.status = 'completed'; tool.output = 'Actual file content.'; writer.activity(message.id, tool);
    expect(thread.timeline!.entries[0]).toMatchObject(identity);
    expect(thread.timeline!.entries.filter(entry => entry.kind === 'activity')).toHaveLength(1);
    expect(visible(thread)).toEqual(['tool:read', 'text:A later message fragment.']);
  });

  it('returns a redaction-held plain-text prefix to its original position around a tool', () => {
    const { thread, message, writer } = fixture();
    const stream = new TimelineTextStream(writer, message, createRedactor(['secret-fixture-value']));
    expect(stream.push('s')).toBe('');
    activity(writer, message, 'between');
    stream.push('afe.'); stream.finish();
    expect(visible(thread)).toEqual(['text:s', 'tool:between', 'text:afe.']);
    expect(message.content).toBe('safe.');
    const text = thread.timeline!.entries.filter(entry => entry.kind === 'text');
    expect(text.map(entry => entry.startOffset)).toEqual([0, 1]);
  });

  it('never flushes a split secret early and keeps the mask at the original source position', () => {
    const { thread, message, writer, events } = fixture();
    const secret = 'secret-fixture-value';
    const stream = new TimelineTextStream(writer, message, createRedactor([secret]));
    stream.push('secret-fixture-');
    activity(writer, message, 'between');
    stream.push('value after.'); stream.finish();
    expect(visible(thread)).toEqual(['text:[redacted]', 'tool:between', 'text: after.']);
    expect(message.content).toBe('[redacted] after.');
    expect(JSON.stringify({ thread, events })).not.toContain(secret);
    expect(JSON.stringify({ thread, events })).not.toContain('secret-fixture-');
  });

  it('flushes an unresolved safe tail in its reserved position and keeps Unicode intact across callbacks', () => {
    const held = fixture();
    const stream = new TimelineTextStream(held.writer, held.message, createRedactor(['secret-fixture-value']));
    stream.push('s'); activity(held.writer, held.message, 'after-prefix'); stream.finish();
    expect(visible(held.thread)).toEqual(['text:s', 'tool:after-prefix']);
    const unicode = fixture();
    const unicodeStream = new TimelineTextStream(unicode.writer, unicode.message, createRedactor([]));
    unicodeStream.push('\ud83d'); activity(unicode.writer, unicode.message, 'between'); unicodeStream.push('\ude42 ready.'); unicodeStream.finish();
    expect(visible(unicode.thread)).toEqual(['text:🙂', 'tool:between', 'text: ready.']);
    expect(unicode.message.content).toBe('🙂 ready.');
  });

  it('preserves streamed fragment identities on an identical final value and appends completion-only suffixes after intervening tools', () => {
    const { thread, message, writer } = fixture();
    const stream = new TimelineTextStream(writer, message, createRedactor([]));
    stream.push('Before.'); activity(writer, message, 'between'); stream.push('After.'); stream.finish();
    const ids = thread.timeline!.entries.map(entry => entry.id);
    writer.reconcileText(message, 'Before.After.');
    expect(thread.timeline!.entries.map(entry => entry.id)).toEqual(ids);
    activity(writer, message, 'last'); writer.reconcileText(message, 'Before.After.Done.');
    expect(visible(thread)).toEqual(['text:Before.', 'tool:between', 'text:After.', 'tool:last', 'text:Done.']);
    expect(message.content).toBe('Before.After.Done.');
  });

  it('places a changed authoritative answer at completion without guessing corrected word positions among earlier tools', () => {
    const { thread, message, writer } = fixture();
    const stream = new TimelineTextStream(writer, message, createRedactor([]));
    stream.push('Provisional before.'); activity(writer, message, 'between'); stream.push('Provisional after.'); stream.finish();
    const oldTextIds = thread.timeline!.entries.filter(entry => entry.kind === 'text').map(entry => entry.id);
    writer.reconcileText(message, 'The corrected final response.');
    expect(visible(thread)).toEqual(['tool:between', 'text:The corrected final response.']);
    expect(message.content).toBe('The corrected final response.');
    expect(thread.timeline!.entries.at(-1)).toMatchObject({ kind: 'text', revised: true, startOffset: 0 });
    for (const id of oldTextIds) expect(thread.timeline!.entries.find(entry => entry.id === id)).toMatchObject({ text: '' });
  });

  it('keeps saved public reasoning order and IDs in a read-only legacy projection', () => {
    const { thread, message } = fixture();
    message.reasoningSummary = [{ id: 'public-one', summaryIndex: 0, text: 'Before. After.', status: 'complete' }];
    message.content = 'Public assistant text.';
    message.activities = [{ id: 'saved-tool', name: 'read_file', input: '{}', status: 'completed', startedAt: at }];
    thread.timeline = { version: 1, revision: 4, nextSequence: 5, entries: [
      { id: 'saved-before', sequence: 1, revision: 1, messageId: message.id, kind: 'reasoning', summaryId: 'public-one', text: 'Before. ', status: 'complete' },
      { id: 'saved-text', sequence: 2, revision: 2, messageId: message.id, kind: 'text', text: message.content, startOffset: 0 },
      { id: 'saved-tool-row', sequence: 3, revision: 3, messageId: message.id, kind: 'activity', activityId: 'saved-tool' },
      { id: 'saved-after', sequence: 4, revision: 4, messageId: message.id, kind: 'reasoning', summaryId: 'public-one', text: 'After.', status: 'complete' },
    ] };
    const before = JSON.stringify(thread);
    expect(ensureConversationTimeline(thread)).toBe(thread.timeline);
    const projected = projectConversationTimeline(thread, [message])!;
    expect(projected.entries).toEqual(thread.timeline.entries);
    expect(projected.nextSequence).toBe(5);
    expect(visible({ ...thread, timeline: projected })).toEqual(['reasoning:Before. ', 'text:Public assistant text.', 'tool:saved-tool', 'reasoning:After.']);
    expect(JSON.stringify(thread)).toBe(before);
  });

  it('marks legacy assistant records without inventing intra-message event positions', () => {
    const { thread, message } = fixture();
    delete thread.timeline;
    message.content = 'Older saved text.';
    message.activities = [{ id: 'older-tool', name: 'read_file', input: '{}', status: 'completed', startedAt: at }];
    const oldOrder = ensureConversationTimeline(thread);
    expect(oldOrder.entries).toEqual([{ kind: 'legacy', id: `historical:${message.id}`, sequence: 1, revision: 1, messageId: message.id }]);
    expect(message.content).toBe('Older saved text.');
    expect(ensureConversationTimeline(thread)).toBe(oldOrder);
  });

  it('projects retained message evidence for forks/rewind and never reuses removed sequence positions', () => {
    const { thread, message, writer } = fixture();
    new TimelineTextStream(writer, message, createRedactor([])).push('Retained.');
    const removed: ChatMessage = { ...message, id: 'assistant-removed', content: '', activities: [] };
    thread.messages.push(removed);
    new TimelineTextStream(writer, removed, createRedactor([])).push('Removed.');
    const highest = Math.max(...thread.timeline!.entries.map(entry => entry.sequence));
    const nextSequence = thread.timeline!.nextSequence;
    const projected = projectConversationTimeline(thread, [message])!;
    expect(projected.entries.every(entry => entry.messageId === message.id)).toBe(true);
    expect(projected.nextSequence).toBe(nextSequence);
    const rewound = { ...thread, timeline: projected, messages: [message] };
    const appended: ConversationTimelineEntry[] = [];
    const nextWriter = new TimelineWriter(rewound, entry => appended.push(entry));
    activity(nextWriter, message, 'new');
    expect(appended.at(-1)!.sequence).toBeGreaterThan(highest);
    expect(thread.timeline!.entries).toHaveLength(2);
  });
});
