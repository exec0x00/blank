import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ChatMessage, ConversationTimelineEntry, Thread, ThreadTurn, ToolActivity } from '../shared/types';
import { ConversationTimeline, type ConversationTimelineRow } from '../client/components/chat/ConversationTimeline';
import { ActivityGroup } from '../client/components/chat/ActivityGroup';
import { TimelineReasoning } from '../client/components/chat/TimelineReasoning';
import { activityGroupDetails, activityGroupPresentation, groupExpansion, timelineEntryKeys, timelineRangeEntries, type TimelineActivityGroup, type TimelineExpansionChoice } from '../client/components/chat/activity-groups';
import { conversationTimeline, groupConversationTimeline, hasLiveTimelineActivity } from '../client/components/chat/timeline';
import { applyNativeNotification, projectNativeThread } from '../server/codex-cli/projection';
import type { ThreadItem as NativeThreadItem } from '../server/codex-cli/protocol/generated/v2/ThreadItem';

const at = '2026-09-30T10:00:00.000Z';
const turn: ThreadTurn = { id: 'turn-1', userMessageId: 'user-1', messageIds: [], startedAt: at, status: 'running' };
const message = (id: string, turnId = turn.id): ChatMessage => ({ id, turnId, role: 'assistant', content: '', createdAt: at });
const tool = (key: string, status: ToolActivity['status'] = 'completed', turnId = turn.id): ConversationTimelineRow => ({ kind: 'activity', key,
  message: message(key, turnId), live: true, turn: { ...turn, id: turnId },
  activity: { id: key, name: 'exec_command', input: JSON.stringify({ cmd: `cat ${key}.txt` }), status, startedAt: at,
    output: status === 'completed' ? JSON.stringify({ output: `Canonical output for ${key}`, exit_code: 0 }) : undefined } });
const reasoning = (key: string, live = true): ConversationTimelineRow => ({ kind: 'reasoning', key, message: message(key), turn, live,
  summary: { id: key, summaryIndex: 0, text: `Public summary ${key}`, status: live ? 'streaming' : 'complete' } });
const text = (key: string, role: ChatMessage['role'] = 'assistant'): ConversationTimelineRow => ({ kind: 'message', key,
  message: { ...message(key), role }, content: `Message ${key}`, first: true, last: true });
const render = (rows: readonly ConversationTimelineRow[]) => renderToStaticMarkup(<ConversationTimeline rows={rows} workspacePath="/workspace" onNotify={() => undefined}
  renderMessage={part => <article>{part.content}</article>} />);
const groups = (rows: readonly ConversationTimelineRow[]) => groupConversationTimeline(rows).filter(row => row.kind === 'activity-group');
const expanded = (group: TimelineActivityGroup) => renderToStaticMarkup(<ActivityGroup group={group} expanded onExpandedChange={() => undefined}
  renderEntry={entry => entry.kind === 'reasoning' ? <TimelineReasoning summary={entry.summary} inGroup workspacePath="/workspace" onNotify={() => undefined} /> : <span>Recorded tool</span>} />);

describe('compact chronological activity groups', () => {
  it('groups only neighboring reasoning and tools from one turn, keeping all message and notice boundaries', () => {
    const rows = [reasoning('reason-a', false), tool('tool-a'), text('assistant-between'), tool('tool-b'), text('user-between', 'user'),
      reasoning('reason-b', false), { kind: 'notice' as const, key: 'notice', text: 'Response updated.' }, tool('tool-c'), tool('other-turn', 'completed', 'turn-2')];
    const result = groupConversationTimeline(rows);
    expect(result.map(row => row.kind)).toEqual(['activity-group', 'message', 'activity-group', 'message', 'activity-group', 'notice', 'activity-group', 'activity-group']);
    const grouped = groups(rows);
    expect(grouped.map(group => group.entryKeys)).toEqual([['reason-a', 'tool-a'], ['tool-b'], ['reason-b'], ['tool-c'], ['other-turn']]);
    expect(grouped[0].key).toBe('reason-a');
    expect(grouped[0].entries[0]).toBe(rows[0]);
    expect(grouped[0].entries[1]).toBe(rows[1]);
  });

  it('starts collapsed during streaming, renders one current status, and leaves canonical text lazy', () => {
    const rows = [reasoning('old-reason'), tool('old-tool', 'running'), text('between'), reasoning('current-reason'), tool('current-tool', 'running')];
    const result = groups(rows);
    expect(result.map(group => group.current)).toEqual([false, true]);
    expect(result.map(group => activityGroupPresentation(group).animating)).toEqual([false, true]);
    const html = render(rows);
    expect(html.match(/class="chat-activity-group-toggle"/g)).toHaveLength(2);
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(2);
    expect(html.match(/arc-activity-pulse chat-activity-group-icon/g)).toHaveLength(1);
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).not.toContain('Public summary');
    expect(html).not.toContain('Canonical output');
    expect(html).toContain('cat current-tool.txt');
    expect(hasLiveTimelineActivity(rows)).toBe(true);
    expect(hasLiveTimelineActivity([...rows, text('final-answer')])).toBe(false);
    expect(render([...rows, text('final-answer')])).not.toContain('arc-activity-pulse');
  });

  it('does not revive a stale reasoning stream after a later tool has completed', () => {
    const rows = [reasoning('earlier-reason'), tool('finished-tool')];
    expect(groups(rows)[0].current).toBe(false);
    expect(activityGroupPresentation(groups(rows)[0])).toMatchObject({ status: 'recorded', animating: false });
    expect(hasLiveTimelineActivity(rows)).toBe(false);
  });

  it.each([
    ['awaiting_approval', 'approval', 'Approval needed'],
    ['awaiting_input', 'input', 'Answer needed'],
    ['error', 'error', 'Finished with errors'],
  ] as const)('keeps %s visible and actionable while collapsed', (status, presented, label) => {
    const rows = [tool('attention', status)];
    const view = activityGroupPresentation(groups(rows)[0]);
    expect(view).toMatchObject({ status: presented, label, attention: true, animating: false });
    const html = render(rows);
    expect(html).toContain('needs-attention');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(label);
  });

  it('uses terminal turn state to stop stale spinners and expose interruption or error on its final group', () => {
    for (const status of ['interrupted', 'error'] as const) {
      const finished = { ...turn, status, completedAt: at };
      const rows = [tool('earlier'), text('between'), tool('last', 'running'), { kind: 'turn-end' as const, key: 'turn-end:turn-1', turn: finished, ordinal: 1 }];
      const result = groups(rows);
      expect(result[0].lastForTurn).toBe(false);
      expect(activityGroupPresentation(result[0]).status).toBe('completed');
      expect(activityGroupPresentation(result[1])).toMatchObject({ status, attention: true, animating: false });
      expect(render(rows)).not.toContain('is-animating');
    }
  });

  it('reports failed command output even when the transport finished successfully', () => {
    const row = tool('exit-failure');
    if (row.kind !== 'activity') throw new Error('Missing tool fixture.');
    row.activity.output = JSON.stringify({ output: 'Tests failed.', exit_code: 1 });
    expect(activityGroupPresentation(groups([row])[0])).toMatchObject({ status: 'error', failedCount: 1, attention: true });
  });

  it('keeps disclosure choices through new streamed members, prepended pages, and unchanged canonical aliases', () => {
    const choices = new Map<string, TimelineExpansionChoice>([['middle', { expanded: true, changedAt: 1 }]]);
    expect(groupExpansion(choices, ['middle'])).toBe(true);
    expect(groupExpansion(choices, ['older', 'middle', 'newer'])).toBe(true);
    choices.set('newer', { expanded: false, changedAt: 2 });
    expect(groupExpansion(choices, ['older', 'middle', 'newer', 'streamed'])).toBe(false);
    expect(groupExpansion(choices, ['unrelated'])).toBe(false);
    const raw = reasoning('coalesced', false);
    if (raw.kind !== 'reasoning') throw new Error('Missing summary fixture.');
    raw.entryKeys = ['coalesced', 'fragment-2', 'fragment-3'];
    expect(timelineEntryKeys(groups([raw, tool('command')])[0])).toEqual(['coalesced', 'fragment-2', 'fragment-3', 'command']);
    const projected = groupConversationTimeline([raw, tool('command'), text('later')]);
    const range = timelineRangeEntries({ start: 0, end: 2, firstKey: 'coalesced', lastKey: 'later',
      pinnedKeys: new Set(['coalesced']), atStart: true, atEnd: true }, projected);
    expect([...range.pinnedKeys]).toEqual(['coalesced', 'fragment-2', 'fragment-3', 'command']);
    expect([...range.viewportKeys!]).toEqual(['coalesced', 'fragment-2', 'fragment-3', 'command', 'later']);
    expect(range.firstKey).toBe('coalesced');
  });

  it('uses native request identity for waiting status without rewriting the running tool record', () => {
    const rows = [tool('pending-native', 'running')];
    const thread: Thread = { id: 'request-thread', workspaceId: 'workspace', title: 'Waiting', status: 'awaiting_approval', createdAt: at, updatedAt: at, messages: [],
      native: { loaded: true, model: 'fixture', reasoningEffort: null, activeTurnId: turn.id,
        approvals: [{ id: 'request', threadId: 'request-thread', turnId: turn.id, itemId: 'pending-native', kind: 'command', title: 'Run command', description: 'Approval requested', decisions: ['accept', 'decline'], createdAt: at }],
        questions: [], queue: [], queueCursor: null, goal: null, tokenUsage: null, diff: null,
        capabilities: { conversations: true, pagination: true, queue: true, goals: true, skills: true, plan: true, review: true, historyRevert: true } } };
    let grouped = groupConversationTimeline(rows, thread).filter(row => row.kind === 'activity-group');
    expect(activityGroupPresentation(grouped[0])).toMatchObject({ status: 'approval', animating: false, attention: true });
    expect(hasLiveTimelineActivity(rows, thread)).toBe(true);
    expect(rows[0]).toMatchObject({ activity: { status: 'running' } });
    thread.native!.approvals[0].itemId = 'different-native-item';
    grouped = groupConversationTimeline(rows, thread).filter(row => row.kind === 'activity-group');
    expect(grouped[0].request).toBeUndefined();
    expect(grouped[0].current).toBe(false);
    expect(hasLiveTimelineActivity(rows, thread)).toBe(false);
    thread.status = 'awaiting_input'; thread.native!.approvals = [];
    thread.native!.questions = [{ id: 'question', threadId: thread.id, turnId: turn.id, itemId: 'pending-native', isBlocking: true, questions: [] }];
    grouped = groupConversationTimeline(rows, thread).filter(row => row.kind === 'activity-group');
    expect(activityGroupPresentation(grouped[0])).toMatchObject({ status: 'input', animating: false, attention: true });
  });
});

describe('public reasoning fragments', () => {
  // Same structure as the observed app-server response: one reasoning item,
  // seven summary sections, each containing only a public Markdown heading.
  // IDs and text are fictional; the native item/summaryIndex relationship is exact.
  const sevenSections = ['**Inspecting the request**', '**Checking available context**', '**Reviewing source files**',
    '**Checking reported behavior**', '**Considering a correction**', '**Verifying the result**', '**Preparing the response**'];
  const threadId = '0199b111-1111-7111-8111-111111111111', turnId = '0199b222-2222-7222-8222-222222222222';
  const metadata = { id: threadId, name: 'Public summary sections', createdAt: 1_790_100_000, updatedAt: 1_790_100_000,
    status: { type: 'idle' }, turns: [{ id: turnId, status: 'completed', startedAt: 1_790_100_000, completedAt: 1_790_100_000 }] };

  it('presents one seven-section native item as Reasoning while retaining all native identities and entry anchors', () => {
    const item: Extract<NativeThreadItem, { type: 'reasoning' }> = { type: 'reasoning', id: 'fixture-reasoning-item', summary: sevenSections, content: [] };
    Object.defineProperty(item, 'content', { get: () => { throw new Error('Private reasoning must not be inspected.'); } });
    const view = projectNativeThread(metadata, [
      { turnId, item: { type: 'agentMessage', id: 'fixture-before', text: 'Before the public summary.' } },
      { turnId, item },
      { turnId, item: { type: 'agentMessage', id: 'fixture-after', text: 'After the public summary.' } },
    ], 'workspace');
    const canonical = structuredClone(view);
    const rows = conversationTimeline(view), parts = rows.filter(row => row.kind === 'reasoning');
    const group = groups(rows)[0];
    expect(parts.map(row => ({ itemId: row.message.id, id: row.summary.id, index: row.summary.summaryIndex, text: row.summary.text }))).toEqual(
      sevenSections.map((text, index) => ({ itemId: item.id, id: item.id, index, text })));
    expect(group.entryKeys).toEqual(view.timeline!.entries.filter(entry => entry.kind === 'reasoning').map(entry => entry.id));
    expect(group.entryKeys).toHaveLength(7);
    expect(activityGroupPresentation(group)).toMatchObject({ action: 'Reasoning', count: '', animating: false });
    const detail = activityGroupDetails(group.entries);
    expect(detail).toHaveLength(1);
    expect(detail[0]).toMatchObject({ kind: 'reasoning', itemId: item.id, messageId: item.id, entries: parts });
    expect(groupConversationTimeline(rows).map(row => row.kind)).toEqual(['message', 'activity-group', 'message']);
    const html = expanded(group);
    expect(html).not.toMatch(/7 steps|7 actions|>Reasoning summary</);
    expect(html.match(/>Reasoning<\/span>/g)).toHaveLength(1);
    expect(html.match(/data-reasoning-item=/g)).toHaveLength(1);
    expect(html.match(/<strong>/g)).toHaveLength(7);
    expect([...html.matchAll(/data-reasoning-section="(\d+)"/g)].map(match => Number(match[1]))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(view).toEqual(canonical);
  });

  it('keeps distinct native reasoning items separate in details and counts only actual tool actions', () => {
    const view = projectNativeThread(metadata, [
      { turnId, item: { type: 'reasoning', id: 'first-reasoning', summary: ['**Repeated heading**', '**Another section**'] } },
      { turnId, item: { type: 'reasoning', id: 'second-reasoning', summary: ['**Repeated heading**'] } },
      { turnId, item: { type: 'commandExecution', id: 'fixture-tool', command: 'pwd', status: 'completed', aggregatedOutput: '/workspace', exitCode: 0 } },
      { turnId, item: { type: 'reasoning', id: 'third-reasoning', summary: ['**Result section**'] } },
    ], 'workspace');
    const group = groups(conversationTimeline(view))[0], detail = activityGroupDetails(group.entries);
    expect(detail.map(row => row.kind === 'reasoning' ? [row.itemId, row.entries.map(entry => entry.summary.summaryIndex)] : ['tool', row.entry.activity.id]))
      .toEqual([['first-reasoning', [0, 1]], ['second-reasoning', [0]], ['tool', 'fixture-tool'], ['third-reasoning', [0]]]);
    expect(activityGroupPresentation(group).count).toBe('1 action');
    const html = expanded(group);
    expect(html.match(/<strong>Repeated heading<\/strong>/g)).toHaveLength(2);
    expect(html.match(/data-reasoning-item=/g)).toHaveLength(3);
    expect(html).not.toContain('>Reasoning summary<');
  });

  it('streams new native summary sections immediately and never regroups one item across an intervening tool', () => {
    let view = projectNativeThread({ ...metadata, status: { type: 'active' }, turns: [{ id: turnId, status: 'inProgress', startedAt: 1_790_100_000 }] }, [], 'workspace');
    const notify = (method: string, fields: Record<string, unknown>) => { view = applyNativeNotification(view, method, { threadId, turnId, ...fields }, { observedAt: at }); };
    notify('item/started', { item: { type: 'reasoning', id: 'streamed-sections', summary: [] } });
    for (const [summaryIndex, delta] of ['First section. ', 'Second section.'].entries()) {
      notify('item/reasoning/summaryPartAdded', { itemId: 'streamed-sections', summaryIndex });
      notify('item/reasoning/summaryTextDelta', { itemId: 'streamed-sections', summaryIndex, delta });
      const parts = conversationTimeline(view).filter(row => row.kind === 'reasoning');
      expect(parts.at(-1)!.summary).toMatchObject({ id: 'streamed-sections', summaryIndex, text: delta, status: 'streaming' });
      expect(expanded(groups(conversationTimeline(view))[0])).toContain(delta.trim());
    }
    notify('item/completed', { item: { type: 'commandExecution', id: 'between-sections', command: 'pwd', status: 'completed', aggregatedOutput: '/workspace', exitCode: 0 } });
    notify('item/reasoning/summaryTextDelta', { itemId: 'streamed-sections', summaryIndex: 0, delta: 'After the tool.' });
    const group = groups(conversationTimeline(view))[0], detail = activityGroupDetails(group.entries);
    expect(detail.map(row => row.kind === 'reasoning' ? row.entries.map(entry => [entry.summary.summaryIndex, entry.summary.text]) : 'tool'))
      .toEqual([[[0, 'First section. '], [1, 'Second section.']], 'tool', [[0, 'After the tool.']]]);
    expect(group.entryKeys).toHaveLength(4);
    expect(activityGroupPresentation(group).count).toBe('1 action');
  });

  it.each(['["another-item",6]', '["native-item",-1]', '["native-item",1.5]', '[ "native-item", 6 ]'])
    ('does not claim or coalesce an invalid native summary identity %s', key => {
      const view = projectNativeThread(metadata, [{ turnId, item: { type: 'reasoning', id: 'native-item', summary: ['Public section.'] } }], 'workspace');
      const entry = view.timeline!.entries.find(entry => entry.kind === 'reasoning')!;
      if (entry.kind !== 'reasoning') throw new Error('Missing reasoning entry.');
      entry.summaryId = key;
      view.timeline!.entries.push({ ...entry, id: 'second-fragment', sequence: entry.sequence + 1, revision: entry.revision + 1, text: 'Later fragment.' });
      const parts = conversationTimeline(view).filter(row => row.kind === 'reasoning');
      expect(parts).toHaveLength(2);
      expect(parts.every(row => row.summary.id === key && row.summary.summaryIndex === 0)).toBe(true);
      expect(parts.map(row => row.entryKeys)).toEqual([[entry.id], ['second-fragment']]);
    });

  it('coalesces adjacent identity fragments with repeated words and whitespace without crossing tools or messages', () => {
    const source = message('same-item');
    source.activities = [{ id: 'tool', name: 'read_file', input: '{"path":"file.txt"}', status: 'completed', startedAt: at }];
    const entries: ConversationTimelineEntry[] = [];
    const summary = (id: string, summaryId: string, value: string) => entries.push({ id, messageId: source.id, kind: 'reasoning',
      sequence: entries.length + 1, revision: entries.length + 1, summaryId, text: value, status: 'streaming' });
    summary('a', 'same-summary', 'ha'); summary('b', 'same-summary', 'ha'); summary('space', 'same-summary', ' '); summary('c', 'same-summary', 'again');
    entries.push({ id: 'tool-entry', kind: 'activity', messageId: source.id, activityId: 'tool', sequence: 5, revision: 5 });
    summary('d', 'same-summary', 'haha'); summary('e', 'different-summary', 'haha');
    const user: ChatMessage = { ...message('user-item'), role: 'user', content: 'Continue.' };
    entries.push({ id: 'user-entry', kind: 'message', messageId: user.id, sequence: 8, revision: 8 });
    summary('f', 'same-summary', 'haha');
    const thread: Thread = { id: 'thread', workspaceId: 'workspace', title: 'Fragments', status: 'running', createdAt: at, updatedAt: at,
      messages: [source, user], turns: [turn], timeline: { version: 1, revision: 9, nextSequence: 10, entries } };
    const canonical = structuredClone(thread);
    const rows = conversationTimeline(thread);
    const summaries = rows.filter(row => row.kind === 'reasoning');
    expect(summaries.map(row => row.summary.text)).toEqual(['haha again', 'haha', 'haha', 'haha']);
    expect(summaries[0].entryKeys).toEqual(['a', 'b', 'space', 'c']);
    expect(rows.map(row => row.kind)).toEqual(['reasoning', 'activity', 'reasoning', 'reasoning', 'message', 'reasoning']);
    expect(thread).toEqual(canonical);
  });

  it('keeps native completed-item replays idempotent and genuine repeated summary text intact', () => {
    const threadId = '0199a111-1111-7111-8111-111111111111', turnId = '0199a222-2222-7222-8222-222222222222';
    let view = projectNativeThread({ id: threadId, name: 'Native source', createdAt: 1_790_100_000, updatedAt: 1_790_100_000,
      status: { type: 'active' }, turns: [{ id: turnId, status: 'inProgress', startedAt: 1_790_100_000 }] }, [], 'workspace');
    const notify = (method: string, fields: Record<string, unknown>) => { view = applyNativeNotification(view, method, { threadId, turnId, ...fields }, { observedAt: at }); };
    notify('item/started', { item: { id: 'native-summary', type: 'reasoning', summary: [] } });
    notify('item/reasoning/summaryPartAdded', { itemId: 'native-summary', summaryIndex: 0 });
    notify('item/reasoning/summaryTextDelta', { itemId: 'native-summary', summaryIndex: 0, delta: 'ha' });
    notify('item/reasoning/summaryTextDelta', { itemId: 'native-summary', summaryIndex: 0, delta: 'ha' });
    const final = { item: { id: 'native-summary', type: 'reasoning', summary: ['haha'], content: ['PRIVATE'] } };
    notify('item/completed', final);
    const beforeReplay = structuredClone(view);
    notify('item/completed', final);
    const rows = conversationTimeline(view);
    expect(rows.filter(row => row.kind === 'reasoning').map(row => row.summary.text)).toEqual(['haha']);
    expect(view.timeline!.entries).toEqual(beforeReplay.timeline!.entries);
    expect(view.messages[0].id).toBe('native-summary');
    expect(JSON.stringify(view)).not.toContain('PRIVATE');
    expect(groups(rows)).toHaveLength(1);
  });
});
