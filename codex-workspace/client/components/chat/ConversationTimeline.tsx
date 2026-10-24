import { Fragment, memo, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ChatMessage, ReasoningSummarySegment, Thread, ThreadTurn, ToolActivity, WebCitation } from '../../../shared/types';
import { ActivityCard } from './ActivityCard';
import { ActivityGroup } from './ActivityGroup';
import { TimelineReasoning } from './TimelineReasoning';
import { MeasuredWindow, type MeasuredWindowHandle, type MeasuredWindowProps } from './MeasuredWindow';
import { HistoryDetail, type HistoryDetailTarget } from './HistoryDetail';
import { NativeItemDetail, type NativeItemDetailTarget } from './NativeItemDetail';
import { ToolDetailScope } from './ToolDetailScope';
import { groupConversationTimeline, groupExpansion, timelineEntryKeys, timelineRangeEntries, type GroupedTimelineRow, type TimelineActivityGroup, type TimelineExpansionChoice } from './activity-groups';
import type { OpenChange } from '../editor/change-review';
import './conversation-timeline.css';

export interface TimelineMessagePart {
  key: string;
  message: ChatMessage;
  content: string;
  startOffset?: number;
  entryKeys?: readonly string[];
  citations?: readonly WebCitation[];
  first: boolean;
  last: boolean;
  showCopy?: boolean;
}

export type ConversationTimelineRow =
  | ({ kind: 'message' } & TimelineMessagePart)
  | { kind: 'activity'; key: string; message: ChatMessage; activity: ToolActivity; turn?: ThreadTurn; live?: boolean }
  | { kind: 'reasoning'; key: string; entryKeys?: readonly string[]; message: ChatMessage; summary: ReasoningSummarySegment; turn?: ThreadTurn; live: boolean; revised?: boolean }
  | { kind: 'legacy-activity'; key: string; message: ChatMessage; turn?: ThreadTurn; live: boolean }
  | { kind: 'notice'; key: string; text: string }
  | { kind: 'turn-end'; key: string; turn: ThreadTurn; ordinal: number };

interface ConversationTimelineProps {
  rows: readonly ConversationTimelineRow[];
  thread?: Thread;
  locked?: boolean;
  liveConnected?: boolean;
  window?: Omit<MeasuredWindowProps<GroupedTimelineRow>, 'items' | 'itemKey' | 'estimateHeight' | 'renderItem'>;
  workspacePath: string;
  onNotify: (message: string, kind?: 'error' | 'success' | 'info') => void;
  onOpenFile?: (path: string, location?: { line: number; column?: number }) => void;
  onOpenChange?: OpenChange;
  renderMessage: (part: TimelineMessagePart) => ReactNode;
  renderActivity?: (activity: ToolActivity, visible: boolean) => ReactNode;
  renderTurnEnd?: (turn: ThreadTurn, ordinal: number) => ReactNode;
}

const rowKey = (row: GroupedTimelineRow) => row.key;
export function estimateTimelineHeight(row: ConversationTimelineRow | TimelineActivityGroup): number {
  if (row.kind === 'message') return 70 + Math.min(1_000, Math.ceil(row.content.length / 65) * 20) + (row.first && row.message.attachments?.length ? 180 : 0);
  if (row.kind === 'activity-group' || row.kind === 'activity' || row.kind === 'reasoning' || row.kind === 'legacy-activity') return 58;
  return 46;
}

interface ExpansionState {
  scope: string;
  revision: number;
  groups: ReadonlyMap<string, TimelineExpansionChoice>;
  tools: ReadonlyMap<string, boolean>;
}
const emptyExpansion = (scope: string): ExpansionState => ({ scope, revision: 0, groups: new Map(), tools: new Map() });

/** Ordered rows stay in one flow. Offscreen Markdown/tools are actually unmounted. */
export const ConversationTimeline = memo(function ConversationTimeline({ rows, thread, locked, liveConnected = true, window: windowProps, workspacePath, onNotify, onOpenFile, onOpenChange, renderMessage, renderActivity, renderTurnEnd }: ConversationTimelineProps) {
  const [detail, setDetail] = useState<HistoryDetailTarget | null>(null);
  const [nativeDetail, setNativeDetail] = useState<NativeItemDetailTarget | null>(null);
  useLayoutEffect(() => {
    setNativeDetail(previous => !locked && thread?.backend === 'codex-cli' && previous?.threadId === thread.id
      && previous.workspaceId === thread.workspaceId ? previous : null);
  }, [thread?.id, thread?.workspaceId, thread?.backend, locked]);
  const entries = useMemo(() => new Map(thread?.timeline?.entries.map(entry => [entry.id, entry]) ?? []), [thread?.timeline?.entries]);
  const copyScope = `${thread?.id ?? ''}:${thread?.history?.epoch ?? ''}`;
  const expansionScope = JSON.stringify([thread?.workspaceId, copyScope, windowProps?.resetKey]);
  const [expansionState, setExpansionState] = useState<ExpansionState>(() => emptyExpansion(expansionScope));
  const choices = expansionState.scope === expansionScope ? expansionState : emptyExpansion(expansionScope);
  const committedGroupOwners = useRef<{ scope: string; owners: ReadonlyMap<string, string> }>({ scope: '', owners: new Map() });
  const displayedRows = useMemo(() => {
    const previous = committedGroupOwners.current.scope === expansionScope ? committedGroupOwners.current.owners : undefined;
    return groupConversationTimeline(rows, thread).filter(row => renderTurnEnd || row.kind !== 'turn-end').map(row => {
      if (row.kind !== 'activity-group') return row;
      // Prepending older entries must not replace a focused/current disclosure.
      const resident = new Set(row.entryKeys);
      const key = row.entryKeys.map(entry => previous?.get(entry)).find(key => key && resident.has(key));
      return key && key !== row.key ? { ...row, key } : row;
    });
  }, [rows, thread?.turns, thread?.status, thread?.native?.approvals, thread?.native?.questions, renderTurnEnd, expansionScope]);
  useLayoutEffect(() => {
    const owners = new Map<string, string>();
    for (const row of displayedRows) if (row.kind === 'activity-group') for (const entry of row.entryKeys) owners.set(entry, row.key);
    committedGroupOwners.current = { scope: expansionScope, owners };
  }, [displayedRows, expansionScope]);
  const changeGroupExpansion = (group: TimelineActivityGroup, expanded: boolean) => setExpansionState(previous => {
    const base = previous.scope === expansionScope ? previous : emptyExpansion(expansionScope);
    const groups = new Map(base.groups), revision = base.revision + 1;
    for (const key of group.entryKeys) groups.set(key, { expanded, changedAt: revision });
    return { ...base, groups, revision };
  });
  const changeToolExpansion = (key: string, expanded: boolean) => setExpansionState(previous => {
    const base = previous.scope === expansionScope ? previous : emptyExpansion(expansionScope);
    if (base.tools.get(key) === expanded) return previous;
    const tools = new Map(base.tools); tools.set(key, expanded);
    return { ...base, tools };
  });
  const aliases = useMemo(() => new Map(displayedRows.flatMap(row => timelineEntryKeys(row).map(key => [key, row.key] as const))), [displayedRows]);
  const measuredHandle = useRef<MeasuredWindowHandle | null>(null);
  useImperativeHandle(windowProps?.handleRef, () => ({
    capture: () => measuredHandle.current?.capture(),
    jumpToStart: () => measuredHandle.current?.jumpToStart(),
    jumpToEnd: () => measuredHandle.current?.jumpToEnd(),
    jumpToKey: (key, align) => measuredHandle.current?.jumpToKey(aliases.get(key) ?? key, align) ?? false,
  }), [aliases]);
  const committedCopyOwners = useRef<{ scope: string; owners: ReadonlyMap<string, string> }>({ scope: '', owners: new Map() });
  const copyOwners = useMemo(() => {
    const previous = committedCopyOwners.current.scope === copyScope ? committedCopyOwners.current.owners : undefined;
    const owners = new Map<string, string>();
    for (const row of displayedRows) {
      if (row.kind !== 'message' || row.message.role !== 'assistant') continue;
      // Earlier pages can reveal another first fragment. Keep the existing
      // control in its resident row so a focused copy button is never replaced.
      if ((row.first && !owners.has(row.message.id)) || previous?.get(row.message.id) === row.key) owners.set(row.message.id, row.key);
    }
    return owners;
  }, [displayedRows, copyScope]);
  // Retain only current resident messages, and commit ownership after rendering.
  useLayoutEffect(() => { committedCopyOwners.current = { scope: copyScope, owners: copyOwners }; }, [copyScope, copyOwners]);
  const renderTool = (activity: ToolActivity, message: ChatMessage, visible: boolean) => {
    const key = JSON.stringify([message.id, activity.id]);
    return <ToolDetailScope thread={thread} message={message} locked={locked} visible={visible} grouped onOpenChange={onOpenChange}
      expanded={choices.tools.get(key)} onExpandedChange={expanded => changeToolExpansion(key, expanded)}>
      {renderActivity ? renderActivity(activity, visible) : <ActivityCard activity={activity} workspacePath={workspacePath} onNotify={onNotify} onOpenFile={onOpenFile} onOpenChange={onOpenChange} />}
    </ToolDetailScope>;
  };
  const renderEntry = (row: Exclude<ConversationTimelineRow, { kind: 'legacy-activity' }>, visible = true) => {
    let content: ReactNode;
    if (row.kind === 'message') content = renderMessage({ ...row, showCopy: copyOwners.get(row.message.id) === row.key });
    else if (row.kind === 'turn-end') content = renderTurnEnd?.(row.turn, row.ordinal);
    else if (row.kind === 'notice') content = <p className="chat-timeline-note">{row.text}</p>;
    else if (row.kind === 'reasoning') content = <div data-timeline-entry={row.key}><TimelineReasoning summary={row.summary} inGroup revised={row.revised} workspacePath={workspacePath} onNotify={onNotify} onOpenFile={onOpenFile} /></div>;
    else content = <div className="chat-timeline-activity" data-timeline-entry={row.key}>
      {renderTool(row.activity, row.message, visible)}
    </div>;
    const rowEntries = timelineEntryKeys(row).flatMap(key => entries.get(key) ?? []);
    if (thread?.backend === 'codex-cli') {
      if (!('message' in row) || !row.message.turnId) return content;
      const targets = new Map<NativeItemDetailTarget['field'], NativeItemDetailTarget>();
      const add = (field: NativeItemDetailTarget['field'], label: string) => targets.set(field, {
        workspaceId: thread.workspaceId, threadId: thread.id, turnId: row.message.turnId!, itemId: row.message.id, field, label,
      });
      if (rowEntries.some(entry => entry.textTruncated) || row.kind === 'message' && row.message.contentTruncated) {
        add('text', row.kind === 'reasoning' ? 'Full public reasoning summary' : row.message.role === 'user' ? 'Full message' : 'Full response');
      }
      if (row.kind === 'reasoning' && (row.summary.truncated || rowEntries.some(entry => entry.kind === 'reasoning' && entry.truncated))) {
        add('text', 'Full public reasoning summary');
      }
      if (!targets.size) return content;
      return <div className="chat-history-excerpt">{content}<div className="chat-history-detail-actions"><span>Showing a preview</span>
        {[...targets.values()].map(target => <button type="button" key={target.field} disabled={locked} onClick={() => setNativeDetail(target)}>
          Inspect {target.label.toLowerCase()}
        </button>)}
      </div></div>;
    }
    if (!thread?.history) return content;
    const targets: HistoryDetailTarget[] = [];
    const base = { threadId: thread.id, epoch: thread.history.epoch };
    for (const entry of rowEntries) if (entry.textTruncated) targets.push({ ...base, entryId: entry.id, field: 'text', label: row.kind === 'reasoning' ? 'Full public reasoning summary' : 'Full response section' });
    if (row.kind === 'message' && row.first && row.message.contentTruncated) targets.push({ ...base, messageId: row.message.id, field: 'content', label: row.message.role === 'user' ? 'Full message' : 'Full response' });
    if (row.kind === 'message' && row.last && row.message.citationsTruncated) targets.push({ ...base, messageId: row.message.id, field: 'citations', label: 'All sources' });
    if (!targets.length) return content;
    return <div className="chat-history-excerpt">{content}<div className="chat-history-detail-actions"><span>Showing a preview</span>{targets.map(target => <button type="button" key={`${target.field}:${target.entryId ?? target.messageId}`} disabled={locked} onClick={() => setDetail(target)}>Inspect {target.label.toLowerCase()}</button>)}</div></div>;
  };
  const renderRow = (row: GroupedTimelineRow) => row.kind === 'activity-group'
    ? <ActivityGroup group={row} expanded={groupExpansion(choices.groups, row.entryKeys)} motionAllowed={!locked && liveConnected} onExpandedChange={expanded => changeGroupExpansion(row, expanded)} renderEntry={renderEntry} />
    : renderEntry(row);
  return <>{windowProps ? <MeasuredWindow {...windowProps} handleRef={measuredHandle} items={displayedRows} itemKey={rowKey} estimateHeight={estimateTimelineHeight} renderItem={renderRow}
    onRangeChange={range => windowProps.onRangeChange?.(timelineRangeEntries(range, displayedRows))}
    itemClassName={(row, index) => `chat-window-${row.kind}${index ? ` follows-${displayedRows[index - 1].kind}` : ''}`} />
    : displayedRows.map(row => <Fragment key={row.key}>{renderRow(row)}</Fragment>)}
    <HistoryDetail target={detail && thread && detail.threadId === thread.id && detail.epoch === thread.history?.epoch ? detail : null} locked={locked} onClose={() => setDetail(null)} onNotify={onNotify} />
    <NativeItemDetail target={nativeDetail && thread?.backend === 'codex-cli' && nativeDetail.threadId === thread.id
      && nativeDetail.workspaceId === thread.workspaceId ? nativeDetail : null} locked={locked} onClose={() => setNativeDetail(null)} onNotify={onNotify} />
  </>;
});
