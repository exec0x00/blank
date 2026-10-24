import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AgentEvent, ChatMessage, ConversationTimelineEntry, ReasoningSummarySegment, Thread, ToolActivity } from '../shared/types';
import { ConversationTimeline } from '../client/components/chat/ConversationTimeline';
import { MarkdownMessage } from '../client/components/chat/MarkdownMessage';
import { TimelineReasoning } from '../client/components/chat/TimelineReasoning';
import { conversationTimeline, hasLiveTimelineActivity } from '../client/components/chat/timeline';
import { applyAgentEvent } from '../client/components/chat/state';
import { createRedactor } from '../server/agent/redact';
import { TimelineTextStream, TimelineWriter } from '../server/agent/timeline';

const at = '2026-09-20T10:00:00.000Z';
function fixture() {
  const message: ChatMessage = { id: 'assistant-fixture', role: 'assistant', content: '', createdAt: at, activities: [], turnId: 'turn-fixture' };
  const thread: Thread = { id: 'thread-fixture', workspaceId: 'workspace-fixture', title: 'Timeline fixture', createdAt: at, updatedAt: at, status: 'running',
    messages: [message], timeline: { version: 1, revision: 0, nextSequence: 1, entries: [] },
    turns: [{ id: 'turn-fixture', userMessageId: 'user-fixture', messageIds: [message.id], startedAt: at, status: 'running' }] };
  const initial = structuredClone(thread);
  const events: AgentEvent[] = [];
  const writer = new TimelineWriter(thread, entry => events.push({ type: 'timeline', threadId: thread.id, version: 1, revision: entry.revision, entry }));
  const text = new TimelineTextStream(writer, message, createRedactor([]));
  const tool = (id: string, startedAt = at) => {
    const activity: ToolActivity = { id, name: 'read_file', input: JSON.stringify({ path: `${id}.txt` }), status: 'completed', startedAt, completedAt: startedAt, output: JSON.stringify({ content: 'Actual inspectable file text.' }) };
    message.activities!.push(activity); writer.activity(message.id, activity);
    events.push({ type: 'activity', threadId: thread.id, messageId: message.id, activity: structuredClone(activity), timelineRevision: thread.timeline!.revision });
    return activity;
  };
  return { thread, initial, message, writer, text, tool, events };
}
function render(thread: Thread) {
  return renderToStaticMarkup(<ConversationTimeline rows={conversationTimeline(thread)} workspacePath="/workspace/project" onNotify={() => undefined}
    renderMessage={({ key, message, content, citations }) => <article data-timeline-entry={key} aria-label={message.role === 'assistant' ? 'Assistant response' : 'Your message'}><MarkdownMessage content={content} citations={citations} workspacePath="/workspace/project" onNotify={() => undefined} /></article>}
    renderTurnEnd={(_turn, ordinal) => <footer>Turn {ordinal} finished</footer>} />);
}
const reduce = (thread: Thread, events: AgentEvent[]) => events.reduce<Thread | null>(applyAgentEvent, thread)!;

describe('chronological reducer and rendered transcript', () => {
  it('omits routine turn notifications while keeping real text, failures and running tool state in order', () => {
    const f = fixture();
    f.text.push('Before the command.');
    for (const [id, content, role] of [['started', 'Turn started.', 'system'], ['over', 'turn_over', 'system'],
      ['warning', 'Turn interrupted because the command failed.', 'system'], ['ordinary', 'Turn over.', 'user']] as const) {
      const message: ChatMessage = { id, role, content, createdAt: at, turnId: 'turn-fixture' };
      f.thread.messages.push(message); f.writer.message(message);
    }
    for (const [id, name, status] of [['routine-start', 'turn_started', 'running'], ['routine-end', 'turnOver', 'completed'],
      ['failure', 'turn_completed', 'error']] as const) {
      const activity: ToolActivity = { id, name, input: '{}', status, startedAt: at };
      f.message.activities!.push(activity); f.writer.activity(f.message.id, activity);
    }
    const work = f.tool('actual-command'); work.status = 'running';
    f.text.push('After the command.');
    const rows = conversationTimeline(f.thread);
    expect(rows.filter(row => row.kind === 'activity').map(row => row.activity.id)).toEqual(['failure', 'actual-command']);
    expect(rows.filter(row => row.kind === 'message').map(row => row.message.id)).not.toContain('started');
    expect(rows.filter(row => row.kind === 'message').map(row => row.message.id)).not.toContain('over');
    expect(rows.filter(row => row.kind === 'message').map(row => row.content)).toContain('Turn over.');
    expect(rows.filter(row => row.kind === 'message').map(row => row.content)).toContain('Turn interrupted because the command failed.');
    expect(hasLiveTimelineActivity(rows)).toBe(false); // Later assistant text supersedes old activity status.
    expect(hasLiveTimelineActivity(rows.slice(0, -1))).toBe(true);
    expect(hasLiveTimelineActivity(rows.filter(row => row.kind !== 'activity' || row.activity.id !== 'actual-command'))).toBe(false);
    const html = render(f.thread);
    expect(html.indexOf('Before the command.')).toBeLessThan(html.indexOf('actual-command.txt'));
    expect(html.indexOf('actual-command.txt')).toBeLessThan(html.indexOf('After the command.'));
    const older = structuredClone(f.thread); delete older.timeline;
    expect(conversationTimeline(older).filter(row => row.kind === 'message').map(row => row.message.id)).not.toContain('started');
    expect(render(older)).not.toContain('Turn started');
  });

  it('renders tool → assistant text → tool in identical order live, after reconnect, and from a saved snapshot', () => {
    const f = fixture();
    f.tool('first-tool', '2030-01-01T00:00:00.000Z');
    f.text.push('Text between the two tools.');
    f.tool('second-tool', '2000-01-01T00:00:00.000Z');
    f.text.push('Text after the second tool.'); f.text.finish();
    const live = reduce(f.initial, f.events);
    const reconnected = applyAgentEvent(live, { type: 'snapshot', threadId: f.thread.id, thread: structuredClone(f.thread) })!;
    const saved = JSON.parse(JSON.stringify(f.thread)) as Thread;
    for (const state of [live, reconnected, saved]) {
      const html = render(state);
      expect(html.indexOf('first-tool.txt')).toBeLessThan(html.indexOf('Text between the two tools.'));
      expect(html.indexOf('Text between the two tools.')).toBeLessThan(html.indexOf('second-tool.txt'));
      expect(html.indexOf('second-tool.txt')).toBeLessThan(html.indexOf('Text after the second tool.'));
      expect(html.match(/class="chat-activity-group-toggle"/g)).toHaveLength(2);
      expect(html.match(/aria-expanded="false"/g)).toHaveLength(2);
      expect(html).not.toContain('chat-turn-activity-toggle');
      expect(html).not.toContain('chat-agent-symbol');
      expect(html).not.toContain('&quot;content&quot;');
    }
    expect(render(live)).toBe(render(reconnected));
    expect(live.messages[0].content).toBe(f.message.content);
  });

  it('makes full-entry replays idempotent while preserving legitimate repeated text', () => {
    const f = fixture();
    f.text.push('ha'); f.text.push('ha'); f.tool('between'); f.text.push('!');
    const live = reduce(f.initial, f.events);
    const replay = reduce(live, [...f.events, ...f.events, { type: 'delta', threadId: f.thread.id, messageId: f.message.id, text: 'haha!' }]);
    expect(replay.timeline).toEqual(live.timeline);
    expect(replay.messages[0].content).toBe('haha!');
    expect(render(replay)).toBe(render(live));
    expect(render(replay).match(/class="chat-activity-group-toggle"/g)).toHaveLength(1);
  });

  it('uses a reconnect snapshot as a barrier against stale compatibility frames and pruned entries', () => {
    const f = fixture();
    f.text.push('Retained.'); f.tool('old-tool');
    const older = structuredClone(f.events);
    const latest = reduce(f.initial, f.events);
    const snapshot = structuredClone(latest);
    snapshot.timeline!.revision += 10;
    snapshot.timeline!.entries = snapshot.timeline!.entries.filter(entry => entry.kind !== 'activity');
    snapshot.messages[0].activities = [];
    const restored = applyAgentEvent(latest, { type: 'snapshot', threadId: f.thread.id, thread: snapshot })!;
    const replayed = reduce(restored, older);
    expect(replayed).toBe(restored);
    expect(render(replayed)).not.toContain('old-tool.txt');
    expect(replayed.messages[0].content).toBe('Retained.');
  });

  it('keeps text and activity in saved message order for older history and explains the limitation once', () => {
    const f = fixture();
    f.text.push('First older response.'); f.tool('first-older');
    const older = structuredClone(f.thread); delete older.timeline;
    older.messages.push({ ...structuredClone(older.messages[0]), id: 'second-older-message', content: 'Second older response.', activities: [{ ...older.messages[0].activities![0], id: 'second-older', input: JSON.stringify({ path: 'second-older.txt' }) }] });
    older.turns![0].messageIds.push('second-older-message');
    const html = render(older);
    expect(html.match(/Exact text and activity order was not recorded/g)).toHaveLength(1);
    expect(html.indexOf('First older response.')).toBeLessThan(html.indexOf('first-older.txt'));
    expect(html.indexOf('first-older.txt')).toBeLessThan(html.indexOf('Second older response.'));
    expect(html.indexOf('Second older response.')).toBeLessThan(html.indexOf('second-older.txt'));
  });

  it('places a system/user message accepted midstream between the original and later assistant fragments', () => {
    const f = fixture();
    f.text.push('Before guidance.');
    const guidance: ChatMessage = { id: 'user-guidance', role: 'user', content: 'Keep the original file.', createdAt: at, turnId: 'turn-fixture' };
    f.thread.messages.push(guidance); f.writer.message(guidance);
    f.text.push('After guidance.');
    const html = render(f.thread);
    expect(html.indexOf('Before guidance.')).toBeLessThan(html.indexOf('Keep the original file.'));
    expect(html.indexOf('Keep the original file.')).toBeLessThan(html.indexOf('After guidance.'));
  });

  it('keeps a turn boundary after its last recorded item even if a hook belongs to an earlier message', () => {
    const f = fixture();
    f.text.push('First response.');
    const lastMessage: ChatMessage = { id: 'later-assistant', role: 'assistant', content: '', createdAt: at, turnId: 'turn-fixture' };
    f.thread.messages.push(lastMessage); f.thread.turns![0].messageIds.push(lastMessage.id);
    new TimelineTextStream(f.writer, lastMessage, createRedactor([])).push('Later response.');
    f.tool('late-hook');
    f.thread.turns![0].status = 'completed'; f.thread.turns![0].completedAt = at; f.thread.status = 'idle';
    const html = render(f.thread);
    expect(html.indexOf('Later response.')).toBeLessThan(html.indexOf('late-hook.txt'));
    expect(html.indexOf('late-hook.txt')).toBeLessThan(html.indexOf('Turn 1 finished'));
    expect(html.match(/Turn 1 finished/g)).toHaveLength(1);
  });

  it('assigns canonical citation offsets to their text fragment and unpositioned sources only once', () => {
    const f = fixture();
    f.text.push('First.'); f.tool('between'); f.text.push('Second.');
    f.message.citations = [
      { url: 'https://example.com/first', title: 'First source', startIndex: 0, endIndex: 6 },
      { url: 'https://example.com/second', title: 'Second source', startIndex: 6, endIndex: 13 },
      { url: 'https://example.com/whole', title: 'Whole response source' },
    ];
    const parts = conversationTimeline(f.thread).filter(row => row.kind === 'message');
    expect(parts[0].citations).toEqual([f.message.citations[0]]);
    expect(parts[1].citations).toEqual([{ ...f.message.citations[1], startIndex: 0, endIndex: 7 }, f.message.citations[2]]);
    expect(parts.map(part => [part.first, part.last])).toEqual([[true, false], [false, true]]);
    const html = render(f.thread);
    expect(html.match(/Whole response source<\/span>/g)).toHaveLength(1);
  });

  it('does not expose private reasoning/protocol fields and rejects malformed sequence identities', () => {
    const f = fixture();
    Object.assign(f.message, { reasoning: 'PRIVATE_REASONING', encrypted_content: 'PRIVATE_CIPHER' });
    f.text.push('Only public assistant text.');
    const state = reduce(f.initial, f.events);
    const entry = structuredClone(f.thread.timeline!.entries[0]);
    const bad = { type: 'timeline' as const, threadId: f.thread.id, version: 1, revision: f.thread.timeline!.revision + 1, entry: { ...entry, revision: f.thread.timeline!.revision + 1, sequence: entry.sequence + 1 } };
    expect(applyAgentEvent(state, bad)).toBe(state);
    expect(applyAgentEvent(state, { ...bad, entry: { ...bad.entry, kind: 'reasoning_text', text: 'PRIVATE_REASONING' } })).toBe(state);
    const html = render(f.thread);
    expect(html).toContain('Only public assistant text.');
    expect(html).not.toContain('PRIVATE_REASONING');
    expect(html).not.toContain('PRIVATE_CIPHER');
  });

  it('renders a later authoritative public-summary correction at its actual revision position', () => {
    const f = fixture();
    // Seed already-public presentation data. Provider summary accumulation was
    // retired; this test continues to cover rendering, ordering and replay.
    const original: ReasoningSummarySegment = { id: 'public-revised', summaryIndex: 0, text: 'Outdated completed summary.', status: 'complete' };
    const entry: ConversationTimelineEntry = { id: 'old-public-summary', messageId: f.message.id, kind: 'reasoning',
      sequence: 1, revision: 1, summaryId: JSON.stringify([original.id, original.summaryIndex]), text: original.text, status: 'complete' };
    f.message.reasoningSummary = [original];
    f.thread.timeline!.entries.push(entry); f.thread.timeline!.revision = 1; f.thread.timeline!.nextSequence = 2;
    f.events.push({ type: 'timeline', threadId: f.thread.id, version: 1, revision: 1, entry: structuredClone(entry) });
    f.tool('between-summaries');
    const corrected: ReasoningSummarySegment = { ...original,
      text: createRedactor(['private-summary-fixture']).text('Corrected public summary mentioning private-summary-fixture.') };
    f.message.reasoningSummary = [corrected];
    f.thread.timeline!.entries = [...f.thread.timeline!.entries.filter(item => item.id !== entry.id),
      { ...entry, id: 'revised-public-summary', sequence: f.thread.timeline!.nextSequence++, revision: ++f.thread.timeline!.revision,
        text: corrected.text, revised: true }];
    f.events.push({ type: 'snapshot', threadId: f.thread.id, thread: structuredClone(f.thread) });
    const live = reduce(f.initial, f.events);
    const rows = conversationTimeline(live).filter(row => row.kind === 'activity' || row.kind === 'reasoning');
    expect(rows.map(row => row.kind)).toEqual(['activity', 'reasoning']);
    expect(rows[1]).toMatchObject({ revised: true, summary: { text: 'Corrected public summary mentioning [redacted].', status: 'complete' } });
    const revised = rows[1];
    if (revised.kind !== 'reasoning') throw new Error('The corrected summary is missing.');
    expect(renderToStaticMarkup(<TimelineReasoning summary={revised.summary} revised={revised.revised} inGroup workspacePath="/workspace/project" onNotify={() => undefined} />)).toContain('Updated');
    expect(render(live)).not.toContain('private-summary-fixture');
    expect(reduce(live, f.events).timeline).toEqual(live.timeline);
  });
});
