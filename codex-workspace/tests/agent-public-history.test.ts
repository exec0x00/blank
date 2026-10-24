import { describe, expect, it } from 'vitest';
import type { ChatMessage, ConversationTimelineEntry, Thread, ThreadTurn, ToolActivity } from '../shared/types';
import { PublicConversationHistory, PUBLIC_HISTORY_LIMITS } from '../server/agent/public-history';
import { formatToolActivity } from '../client/components/chat/tool-presentation';

const timestamp = '2026-09-20T12:00:00.000Z';
const state = { epoch: `history_${'1'.repeat(32)}`, revision: 200 };
function fixture(count = 180): Thread {
  const messages: ChatMessage[] = [], entries: ConversationTimelineEntry[] = [], turns: ThreadTurn[] = [];
  let sequence = 0;
  const add = (entry: Omit<ConversationTimelineEntry, 'sequence' | 'revision'>) => {
    sequence++;
    entries.push({ ...entry, sequence, revision: sequence } as ConversationTimelineEntry);
  };
  for (let position = 0; position < count; position++) {
    const user: ChatMessage = { id: `user_${position}`, role: 'user', content: `Request ${position}`, createdAt: timestamp, turnId: `turn_${position}` };
    const activity: ToolActivity = { id: `tool_${position}`, name: 'read_file', status: 'completed', startedAt: timestamp, completedAt: timestamp,
      input: JSON.stringify({ path: `source-${position}.ts` }), output: `Saved tool output ${position}\n${'x'.repeat(48_000)}` };
    const message: ChatMessage = { id: `assistant_${position}`, role: 'assistant', content: `Before ${position}.After ${position}.`, createdAt: timestamp,
      turnId: user.turnId, activities: [activity], reasoningSummary: [{ id: `summary_${position}`, summaryIndex: 0, text: `Public summary ${position}.`, status: 'complete' }] };
    messages.push(user, message);
    turns.push({ id: user.turnId!, userMessageId: user.id, startedAt: timestamp, completedAt: timestamp, status: 'completed', messageIds: [user.id, message.id] });
    add({ id: `user-entry_${position}`, messageId: user.id, kind: 'message' });
    add({ id: `before_${position}`, messageId: message.id, kind: 'text', text: `Before ${position}.`, startOffset: 0 } as ConversationTimelineEntry);
    add({ id: `reasoning_${position}`, messageId: message.id, kind: 'reasoning', summaryId: JSON.stringify([`summary_${position}`, 0]), text: `Public summary ${position}.`, status: 'complete' } as ConversationTimelineEntry);
    add({ id: `activity_${position}`, messageId: message.id, kind: 'activity', activityId: activity.id } as ConversationTimelineEntry);
    add({ id: `after_${position}`, messageId: message.id, kind: 'text', text: `After ${position}.`, startOffset: `Before ${position}.`.length } as ConversationTimelineEntry);
  }
  return { id: `thr_${'a'.repeat(32)}`, workspaceId: 'workspace-test', title: 'Long saved conversation', createdAt: timestamp, updatedAt: timestamp,
    status: 'idle', messages, turns, timeline: { version: 1, revision: sequence, nextSequence: sequence + 1, entries } };
}

describe('bounded public conversation history without changing saved protocol', () => {
  it('pages the complete recorded order in both directions with only referenced activities and turns', () => {
    const thread = fixture(), history = new PublicConversationHistory('cursor-test-secret');
    const recent = history.window(thread, state);
    expect(recent.timeline!.entries).toHaveLength(PUBLIC_HISTORY_LIMITS.entries);
    expect(recent.history).toMatchObject({ hasOlder: true, hasNewer: false, totalMessages: thread.messages.length });
    expect(Buffer.byteLength(JSON.stringify(recent))).toBeLessThan(PUBLIC_HISTORY_LIMITS.pageBytes);
    expect(recent.turns![0].ordinal).toBeGreaterThan(1);
    const all = [...recent.timeline!.entries];
    let page = recent;
    while (page.history!.hasOlder) {
      const previous = page;
      page = history.window(thread, state, { before: page.history!.olderCursor!, limit: PUBLIC_HISTORY_LIMITS.entries });
      expect(page.history!.newestSequence).toBeLessThan(previous.history!.oldestSequence!);
      expect(page.history!.hasNewer).toBe(true);
      for (const message of page.messages) {
        const referenced = page.timeline!.entries.filter(entry => entry.messageId === message.id && entry.kind === 'activity')
          .map(entry => (entry as Extract<ConversationTimelineEntry, { kind: 'activity' }>).activityId);
        expect((message.activities ?? []).map(activity => activity.id)).toEqual(referenced);
      }
      all.unshift(...page.timeline!.entries);
    }
    expect(all.map(entry => entry.id)).toEqual(thread.timeline!.entries.map(entry => entry.id));
    expect(new Set(all.map(entry => entry.sequence)).size).toBe(all.length);
    const next = history.window(thread, state, { after: page.history!.newerCursor!, limit: PUBLIC_HISTORY_LIMITS.entries });
    const offset = page.timeline!.entries.length;
    expect(next.timeline!.entries.map(entry => entry.id)).toEqual(thread.timeline!.entries.slice(offset, offset + 40).map(entry => entry.id));
    expect(thread.messages.at(-1)!.activities![0].output!.length).toBeGreaterThan(PUBLIC_HISTORY_LIMITS.outputChars);
    expect(recent.messages.at(-1)!.activities![0]).toMatchObject({ outputTruncated: true });
  });

  it('keeps append cursors stable, scopes them to thread and epoch, and bounds caller-selected sizes', () => {
    const thread = fixture(25), history = new PublicConversationHistory('cursor-test-secret');
    const recent = history.window(thread, state), expected = history.window(thread, state, { before: recent.history!.olderCursor! });
    const source = thread.timeline!, sequence = source.nextSequence++;
    thread.messages.push({ id: 'new_user', role: 'user', content: 'A newer request', createdAt: timestamp });
    source.entries.push({ id: 'new_entry', sequence, revision: ++source.revision, messageId: 'new_user', kind: 'message' });
    expect(history.window(thread, { ...state, revision: 201 }, { before: recent.history!.olderCursor! }).timeline!.entries).toEqual(expected.timeline!.entries);
    expect(history.window(thread, { ...state, revision: 201 }, { after: recent.history!.newerCursor! }).timeline!.entries.map(entry => entry.id)).toEqual(['new_entry']);
    expect(() => history.window({ ...thread, id: `thr_${'b'.repeat(32)}` }, state, { before: recent.history!.olderCursor! })).toThrow(/does not belong/);
    expect(() => history.window(thread, { ...state, epoch: `history_${'2'.repeat(32)}` }, { before: recent.history!.olderCursor! })).toThrow(/history changed/);
    expect(() => history.window(thread, state, { before: `${recent.history!.olderCursor!}x` })).toThrow(/invalid/);
    expect(() => history.window(thread, state, { limit: 61 })).toThrow(/size is invalid/);
    expect(() => history.window(thread, state, { before: recent.history!.olderCursor!, after: recent.history!.newerCursor! })).toThrow(/direction/);
  });

  it('expands giant legacy activity aggregates only in the public view, with stable modern live positions', () => {
    const thread = fixture(1), message = thread.messages[1];
    message.activities = Array.from({ length: 320 }, (_, index) => ({ ...message.activities![0], id: `legacy_tool_${index}` }));
    thread.timeline = { version: 1, revision: 2, nextSequence: 3, entries: [
      { id: 'legacy_user', kind: 'message', sequence: 1, revision: 1, messageId: thread.messages[0].id },
      { id: 'legacy_assistant', kind: 'legacy', sequence: 2, revision: 2, messageId: message.id },
    ] };
    const history = new PublicConversationHistory('cursor-test-secret');
    let page = history.window(thread, state), all = [...page.timeline!.entries];
    expect(page.messages[0].activities).toHaveLength(40);
    while (page.history!.hasOlder) { page = history.window(thread, state, { before: page.history!.olderCursor! }); all.unshift(...page.timeline!.entries); }
    expect(all).toHaveLength(323);
    expect(all[1]).toMatchObject({ id: 'legacy_assistant', kind: 'message', legacyOrder: true });
    expect(all.filter(entry => entry.kind === 'activity')).toHaveLength(320);
    const next: ConversationTimelineEntry = { id: 'modern', sequence: 3, revision: 3, messageId: message.id, kind: 'text', text: 'New public text', startOffset: 0 };
    thread.timeline.entries.push(next); thread.timeline.revision = 3; thread.timeline.nextSequence = 4;
    expect(history.publicEntry(thread, 'modern')!.sequence).toBe(324);
    expect(history.window(thread, state).timeline!.entries.at(-1)).toEqual(history.publicEntry(thread, 'modern'));
    expect(thread.timeline.entries[1].kind).toBe('legacy');
    expect(next.sequence).toBe(3);
  });

  it('serves only scoped public text details, detects corrected bodies, and never splits Unicode characters', () => {
    const thread = fixture(1), history = new PublicConversationHistory('cursor-test-secret');
    const message = thread.messages[1], activity = message.activities![0];
    activity.output = 'a'.repeat(4095) + '🙂' + 'b'.repeat(20_000);
    const recent = history.window(thread, state);
    expect(recent.messages[1].activities![0].output).toBe('a'.repeat(4095));
    const target = { epoch: state.epoch, messageId: message.id, activityId: activity.id, field: 'output' as const, limit: 4096 };
    const first = history.detail(thread, state, target);
    const second = history.detail(thread, state, { ...target, offset: first.nextOffset!, version: first.version });
    expect(first.text).toBe('a'.repeat(4095)); expect(second.text.startsWith('🙂')).toBe(true);
    expect(first.previousOffset).toBeNull(); expect(second.previousOffset).toBe(0);
    const one = history.detail(thread, state, { ...target, offset: 4095, limit: 1 });
    expect(one.text).toBe('🙂'); expect(one.nextOffset).toBe(4097);
    expect(() => history.detail(thread, state, { ...target, offset: 4096 })).toThrow(/next text offset/);
    activity.output = 'A corrected public result.';
    expect(() => history.detail(thread, { ...state, revision: 201 }, { ...target, version: first.version })).toThrow(/item changed/);
    expect(() => history.detail(thread, state, { ...target, messageId: 'absent' })).toThrow(/unavailable/);
    expect(() => history.detail(thread, state, { ...target, field: 'encrypted_content' as 'output' })).toThrow(/public conversation text/);
    Object.assign(thread.timeline!.entries[1], { encrypted_content: 'PRIVATE_REASONING', privateThought: 'PRIVATE_REASONING' });
    Object.assign(message, { modelContent: [{ text: 'PRIVATE_MODEL_INPUT' }] });
    const wire = JSON.stringify(history.window(thread, state));
    expect(wire).not.toContain('PRIVATE_REASONING'); expect(wire).not.toContain('PRIVATE_MODEL_INPUT');
  });

  it('bounds citation metadata while preserving every original source in paged inspection', () => {
    const thread = fixture(1), message = thread.messages[1], history = new PublicConversationHistory('cursor-test-secret');
    message.citations = Array.from({ length: 128 }, (_, index) => ({ title: `Source ${index}`, url: `https://example.org/${index}?data=${'a'.repeat(8000)}` }));
    const page = history.window(thread, state), preview = page.messages[1];
    expect(preview.citationsTruncated).toBe(true); expect(preview.citationsCount).toBe(128);
    expect(preview.citations!.length).toBeLessThanOrEqual(24);
    expect(Buffer.byteLength(JSON.stringify(preview.citations))).toBeLessThanOrEqual(16 * 1024);
    expect(preview.citations![0].url).toBe(message.citations[0].url);
    const first = history.detail(thread, state, { epoch: state.epoch, messageId: message.id, field: 'citations' });
    expect(first.text).toContain(message.citations[0].url); expect(first.nextOffset).not.toBeNull();
    expect(first.totalChars).toBe(message.citations.map(citation => `${citation.title}\n${citation.url}`).join('\n\n').length);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(PUBLIC_HISTORY_LIMITS.pageBytes);
  });

  it('keeps actual process state and failure codes when those fields follow a very large output body', () => {
    const history = new PublicConversationHistory('cursor-test-secret');
    const output = 'Actual command output\n'.repeat(10_000);
    const activity: ToolActivity = { id: 'process', name: 'exec_command', status: 'completed', startedAt: timestamp,
      input: JSON.stringify({ command: 'run-the-requested-check' }),
      output: JSON.stringify({ output, running: true, session_id: 'owned-command', tty: false }) };
    const running = history.publicActivity(activity);
    expect(JSON.parse(running.output!)).toMatchObject({ running: true, session_id: 'owned-command', truncated: true });
    expect(JSON.parse(running.output!).output).toBe(output.slice(0, JSON.parse(running.output!).output.length));
    expect(running.output!.length).toBeLessThanOrEqual(PUBLIC_HISTORY_LIMITS.outputChars);
    expect(formatToolActivity(running).statusLabel).toBe('Still running');
    activity.output = JSON.stringify({ output, exit_code: 7, running: false, tty: false });
    const failed = history.publicActivity(activity);
    expect(formatToolActivity(failed)).toMatchObject({ status: 'error', statusLabel: 'Exit 7' });
    expect(failed.outputTruncated).toBe(true);
    expect(JSON.parse(activity.output).output).toBe(output);
  });
});
