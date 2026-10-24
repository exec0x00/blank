import type { Thread, ThreadTurn, ToolActivity } from '../../../shared/types';
import type { ConversationTimelineRow } from './ConversationTimeline';
import type { MeasuredRange } from './MeasuredWindow';
import { isRoutineTurnActivity } from './lifecycle-presentation';
import { formatToolActivity, toolActivityHasFailure, type ToolPresentation } from './tool-presentation';

export type TimelineActivityEntry = Extract<ConversationTimelineRow, { kind: 'activity' | 'reasoning' }>;
type TimelineReasoningEntry = Extract<TimelineActivityEntry, { kind: 'reasoning' }>;
export type TimelineActivityDetail =
  | { kind: 'activity'; key: string; entry: Extract<TimelineActivityEntry, { kind: 'activity' }> }
  | { kind: 'reasoning'; key: string; messageId: string; itemId: string; entries: readonly TimelineReasoningEntry[] };
export interface TimelineActivityGroup {
  kind: 'activity-group';
  /** A canonical entry key, also used by history anchors. */
  key: string;
  entryKeys: readonly string[];
  entries: readonly TimelineActivityEntry[];
  turnId?: string;
  turn?: ThreadTurn;
  live: boolean;
  current: boolean;
  lastForTurn: boolean;
  legacy?: boolean;
  request?: { kind: 'approval' | 'input'; entryKey: string };
}
export type GroupedTimelineRow = Exclude<ConversationTimelineRow, { kind: 'activity' | 'reasoning' | 'legacy-activity' }> | TimelineActivityGroup;

/** A reasoning item's public summary array contains sections, not tool steps.
 * Keep section text separate, and never join around a tool or another item. */
export function activityGroupDetails(entries: readonly TimelineActivityEntry[]): TimelineActivityDetail[] {
  const details: TimelineActivityDetail[] = [];
  for (const entry of entries) {
    const previous = details.at(-1);
    if (entry.kind === 'activity') details.push({ kind: 'activity', key: entry.key, entry });
    else if (previous?.kind === 'reasoning' && previous.messageId === entry.message.id && previous.itemId === entry.summary.id) {
      previous.entries = [...previous.entries, entry];
    } else details.push({ kind: 'reasoning', key: entry.key, messageId: entry.message.id, itemId: entry.summary.id, entries: [entry] });
  }
  return details;
}

export function timelineEntryKeys(row: ConversationTimelineRow | TimelineActivityGroup): readonly string[] {
  return 'entryKeys' in row && row.entryKeys?.length ? row.entryKeys : [row.key];
}

/** History eviction must protect every canonical entry represented by a group. */
export function timelineRangeEntries(range: MeasuredRange, rows: readonly GroupedTimelineRow[]): MeasuredRange {
  const resident = new Map(rows.map(row => [row.key, row]));
  const pinnedKeys = new Set(range.pinnedKeys), viewportKeys = new Set<string>();
  for (const key of range.pinnedKeys) {
    const row = resident.get(key);
    if (row) for (const entry of timelineEntryKeys(row)) pinnedKeys.add(entry);
  }
  for (const key of [range.firstKey, range.lastKey]) {
    const row = key ? resident.get(key) : undefined;
    if (row) for (const entry of timelineEntryKeys(row)) viewportKeys.add(entry);
  }
  return { ...range, pinnedKeys, viewportKeys };
}

const outstanding = (row: TimelineActivityEntry) => row.kind === 'reasoning' ? row.summary.status === 'streaming'
  : ['running', 'awaiting_approval', 'awaiting_input'].includes(row.activity.status);
const currentEntry = (entries: readonly TimelineActivityEntry[]) => [...entries].reverse().find(row => outstanding(row)
  && (row.kind === 'activity' || row === entries.at(-1)));

/** Only adjacent activity within one known turn shares a disclosure. */
export function groupConversationTimeline(rows: readonly ConversationTimelineRow[], thread?: Thread): GroupedTimelineRow[] {
  const turns = new Map<string, ThreadTurn>();
  const membership = new Map<string, string>();
  for (const turn of thread?.turns ?? []) for (const id of turn.messageIds) membership.set(id, turn.id);
  for (const row of rows) if ('turn' in row && row.turn) turns.set(row.turn.id, row.turn);
  for (const turn of thread?.turns ?? []) turns.set(turn.id, turn);
  const groups: GroupedTimelineRow[] = [];
  const owners = new Map<TimelineActivityGroup, string>();
  const lastInTurn = new Map<string, TimelineActivityGroup>();
  const append = (entries: TimelineActivityEntry[], key: string, entryKeys: readonly string[], turn?: ThreadTurn, legacy = false) => {
    if (!entries.length) return;
    const message = entries[0].message;
    const turnId = message.turnId || turn?.id || membership.get(message.id);
    turn = (turnId ? turns.get(turnId) : undefined) ?? turn;
    // Unknown turn IDs never imply that unrelated native items belong together.
    const owner = turnId ? `turn:${turnId}` : `message:${message.id}`;
    const live = entries.some(row => row.live ?? (turn ? turn.status === 'running' : outstanding(row))) && (!turn || turn.status === 'running');
    const previous = groups.at(-1);
    if (!legacy && previous?.kind === 'activity-group' && !previous.legacy && owners.get(previous) === owner) {
      previous.entries = [...previous.entries, ...entries];
      previous.entryKeys = [...previous.entryKeys, ...entryKeys];
      previous.live ||= live;
    } else {
      const group: TimelineActivityGroup = { kind: 'activity-group', key, entryKeys, entries, turn, turnId, live, current: false, lastForTurn: false, ...(legacy ? { legacy: true } : {}) };
      groups.push(group); owners.set(group, owner); lastInTurn.set(owner, group);
    }
  };
  for (const row of rows) {
    if (row.kind === 'activity' || row.kind === 'reasoning') append([row], row.key, timelineEntryKeys(row), row.turn);
    else if (row.kind === 'legacy-activity') {
      const entries: TimelineActivityEntry[] = [
        ...(row.message.reasoningSummary ?? []).filter(summary => summary.text.trim()).map(summary => ({ kind: 'reasoning' as const,
          key: `legacy-summary:${JSON.stringify([row.message.id, summary.id, summary.summaryIndex])}`, message: row.message, summary, live: row.live, turn: row.turn })),
        ...(row.message.activities ?? []).filter(activity => !isRoutineTurnActivity(activity)).map(activity => ({ kind: 'activity' as const,
          key: `legacy-tool:${JSON.stringify([row.message.id, activity.id])}`, message: row.message, activity, live: row.live, turn: row.turn })),
      ];
      append(entries, row.key, [row.key, `message:${row.message.id}`], row.turn, true);
    } else groups.push(row);
  }
  for (const row of groups) if (row.kind === 'activity-group') {
    row.lastForTurn = lastInTurn.get(owners.get(row)!) === row;
    const requestEntry = (requests: readonly { threadId: string; turnId: string; itemId: string }[] | undefined) => row.entries.find(entry =>
      requests?.some(request => request.threadId === thread?.id && request.turnId === row.turnId && request.itemId === entry.message.id));
    const approval = requestEntry(thread?.native?.approvals), question = requestEntry(thread?.native?.questions);
    if (approval || question) row.request = { kind: approval ? 'approval' : 'input', entryKey: (approval || question)!.key };
    const waiting = thread?.status === 'awaiting_approval' || thread?.status === 'awaiting_input';
    // A later assistant/user message or notice supersedes stale streaming
    // flags. Only the final chronological group can show current progress.
    row.current = row === groups.at(-1) && (row.request !== undefined || row.live && !waiting && !!currentEntry(row.entries));
  }
  return groups;
}

const failures = new WeakMap<ToolActivity, boolean>();
function failed(activity: ToolActivity) {
  let value = failures.get(activity);
  if (value === undefined) { value = toolActivityHasFailure(activity); failures.set(activity, value); }
  return value;
}
const toolViews = new WeakMap<ToolActivity, ToolPresentation>();
function toolView(activity: ToolActivity) {
  let value = toolViews.get(activity);
  if (!value) { value = formatToolActivity(activity); toolViews.set(activity, value); }
  return value;
}

export interface ActivityGroupPresentation {
  status: 'working' | 'approval' | 'input' | 'error' | 'interrupted' | 'completed' | 'recorded';
  label: string;
  action: string;
  preview: string;
  count: string;
  failedCount: number;
  attention: boolean;
  animating: boolean;
}

export function activityGroupPresentation(group: TimelineActivityGroup): ActivityGroupPresentation {
  const tools = group.entries.filter((entry): entry is Extract<TimelineActivityEntry, { kind: 'activity' }> => entry.kind === 'activity');
  const failedCount = tools.filter(row => failed(row.activity)).length;
  const terminal = group.lastForTurn && group.turn?.status !== 'running' ? group.turn?.status : undefined;
  const requestEntry = group.entries.find(row => row.key === group.request?.entryKey);
  const approval = group.request?.kind === 'approval' ? requestEntry : group.live && tools.find(row => row.activity.status === 'awaiting_approval');
  const input = group.request?.kind === 'input' ? requestEntry : group.live && tools.find(row => row.activity.status === 'awaiting_input');
  const active = group.current ? currentEntry(group.entries) : undefined;
  const status = approval ? 'approval' : input ? 'input' : terminal === 'interrupted' ? 'interrupted' : terminal === 'error' ? 'error'
    : active ? 'working' : failedCount ? 'error' : group.entries.some(outstanding) && group.turn?.status !== 'completed' ? 'recorded' : 'completed';
  const latest = approval || input || active || tools.at(-1) || group.entries.at(-1)!;
  const view = latest.kind === 'activity' ? toolView(latest.activity) : undefined;
  const label = { working: latest.kind === 'reasoning' ? 'Thinking' : 'Working', approval: 'Approval needed', input: 'Answer needed',
    error: terminal === 'error' ? 'Stopped with an error' : 'Finished with errors', interrupted: 'Interrupted', completed: 'Completed', recorded: 'Recorded activity' }[status];
  return {
    status, label,
    action: view?.label ?? (status === 'working' ? 'Thinking' : 'Reasoning'),
    preview: view?.preview ?? '',
    // Summary sections have no native "step" semantics. Only tools are actions.
    count: tools.length ? `${tools.length} ${tools.length === 1 ? 'action' : 'actions'}` : '',
    failedCount,
    attention: ['approval', 'input', 'error', 'interrupted'].includes(status) || failedCount > 0,
    animating: group.current && status === 'working',
  };
}

export interface TimelineExpansionChoice { expanded: boolean; changedAt: number }
/** Aliases let a disclosure retain its choice when an older page prepends to it. */
export function groupExpansion(choices: ReadonlyMap<string, TimelineExpansionChoice>, entryKeys: readonly string[]): boolean {
  let newest: TimelineExpansionChoice | undefined;
  for (const key of entryKeys) {
    const choice = choices.get(key);
    if (choice && (!newest || choice.changedAt > newest.changedAt)) newest = choice;
  }
  return newest?.expanded ?? false;
}
