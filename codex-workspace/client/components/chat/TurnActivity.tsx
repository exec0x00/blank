import { memo, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Check, ChevronRight, CircleAlert, CircleHelp, CirclePause, LoaderCircle, ShieldCheck, Sparkles } from 'lucide-react';
import type { ChatMessage, ReasoningSummarySegment, ThreadTurn, ToolActivity } from '../../../shared/types';
import { ActivityCard } from './ActivityCard';
import { isRoutineTurnActivity } from './lifecycle-presentation';
import { MarkdownMessage } from './MarkdownMessage';
import { toolActivityHasFailure } from './tool-presentation';
import './turn-activity.css';

type Notify = (message: string, kind?: 'error' | 'success' | 'info') => void;

export interface TurnActivityProps {
  messages: readonly ChatMessage[];
  turn?: ThreadTurn;
  live?: boolean;
  workspacePath?: string;
  onNotify: Notify;
  onOpenFile?: (path: string, location?: { line: number; column?: number }) => void;
  renderActivity?: (activity: ToolActivity, visible: boolean) => ReactNode;
}

type ActivityEntry =
  | { kind: 'summary'; key: string; summary: ReasoningSummarySegment }
  | { kind: 'tool'; key: string; activity: ToolActivity };

const failures = new WeakMap<ToolActivity, boolean>();
function failedActivity(activity: ToolActivity) {
  const cached = failures.get(activity);
  if (cached !== undefined) return cached;
  const failed = toolActivityHasFailure(activity);
  failures.set(activity, failed);
  return failed;
}

function recordedTime(value: string | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function turnEntries(messages: readonly ChatMessage[]): ActivityEntry[] {
  const entries = new Map<string, ActivityEntry>();
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    // Summary text is an authoritative replacement, including an empty update.
    // Map replacement preserves its first position without duplicating replays.
    const itemOrder = new Map<string, number>();
    const summaries = [...(message.reasoningSummary ?? [])];
    for (const summary of summaries) if (!itemOrder.has(summary.id)) itemOrder.set(summary.id, itemOrder.size);
    summaries.sort((a, b) => itemOrder.get(a.id)! - itemOrder.get(b.id)! || a.summaryIndex - b.summaryIndex);
    for (const summary of summaries) {
      const key = `summary:${JSON.stringify([message.id, summary.id, summary.summaryIndex])}`;
      entries.set(key, { kind: 'summary', key, summary });
    }
    // Legacy records only establish array order. Equal or delayed clock times
    // cannot recover an event sequence and must not reshuffle saved tool rows.
    for (const activity of message.activities ?? []) {
      const key = `tool:${activity.id}`;
      if (isRoutineTurnActivity(activity)) { entries.delete(key); continue; }
      entries.set(key, { kind: 'tool', key, activity });
    }
  }
  return [...entries.values()].filter(entry => entry.kind === 'tool' || entry.summary.text.trim().length > 0);
}

function recordedTiming(turn: ThreadTurn | undefined, activities: readonly ToolActivity[]) {
  if (turn) {
    const start = recordedTime(turn.startedAt);
    const end = recordedTime(turn.completedAt);
    if (start === null || turn.completedAt && end === null || end !== null && end < start) return null;
    return { start, end, source: 'Turn' };
  }
  if (!activities.length) return null;
  const starts = activities.map(activity => recordedTime(activity.startedAt));
  if (starts.some(start => start === null)) return null;
  const start = Math.min(...starts as number[]);
  const terminal = activities.every(activity => activity.status === 'completed' || activity.status === 'error');
  if (!terminal) return { start, end: null, source: 'Tool activity' };
  const ends = activities.map(activity => recordedTime(activity.completedAt));
  if (ends.some((end, index) => end === null || end < starts[index]!)) return null;
  return { start, end: Math.max(...ends as number[]), source: 'Tool activity' };
}

function elapsedLabel(milliseconds: number): string {
  if (milliseconds < 1_000) return '<1s';
  const seconds = Math.floor(milliseconds / 1_000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ${Math.floor(seconds % 3_600 / 60)}m`;
  return `${Math.floor(seconds / 86_400)}d ${Math.floor(seconds % 86_400 / 3_600)}h`;
}

export const TurnActivity = memo(function TurnActivity({ messages, turn, live, workspacePath = '', onNotify, onOpenFile, renderActivity }: TurnActivityProps) {
  const entries = useMemo(() => turnEntries(messages), [messages]);
  const activities = useMemo(() => entries.flatMap(entry => entry.kind === 'tool' ? [entry.activity] : []), [entries]);
  const summaryCount = entries.length - activities.length;
  const failedCount = activities.filter(failedActivity).length;
  const awaitingApproval = activities.some(activity => activity.status === 'awaiting_approval');
  const awaitingInput = activities.some(activity => activity.status === 'awaiting_input');
  const terminalTurn = !!turn && turn.status !== 'running';
  const running = !terminalTurn && (live ?? (turn?.status === 'running' || activities.some(activity => activity.status === 'running' || activity.status === 'awaiting_approval' || activity.status === 'awaiting_input') || entries.some(entry => entry.kind === 'summary' && entry.summary.status === 'streaming')));
  const interrupted = turn?.status === 'interrupted';
  const failed = turn?.status === 'error' || failedCount > 0;
  const needsAttention = failed || interrupted || awaitingApproval || awaitingInput;
  const identity = turn?.id ?? messages.find(message => message.role === 'assistant')?.id ?? '';
  const [choice, setChoice] = useState<{ identity: string; expanded: boolean } | null>(null);
  const expanded = choice?.identity === identity ? choice.expanded : running || needsAttention;
  const [openedIdentity, setOpenedIdentity] = useState<string | null>(null);
  const detailsId = useId();
  const triggerId = useId();
  const [now, setNow] = useState(Date.now);
  const timing = useMemo(() => recordedTiming(turn, activities), [turn, activities]);
  const ticking = !!entries.length && running && timing !== null && timing.end === null;

  useEffect(() => { if (expanded) setOpenedIdentity(identity); }, [expanded, identity]);
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [ticking, identity]);

  if (!entries.length) return null;

  const elapsed = timing && (timing.end !== null || running) ? (timing.end ?? now) - timing.start : null;
  const duration = elapsed !== null && elapsed >= 0 ? elapsedLabel(elapsed) : null;
  const status = awaitingApproval ? 'Awaiting approval' : awaitingInput ? 'Awaiting your answer' : interrupted ? 'Interrupted' : turn?.status === 'error' ? 'Stopped with an error' : running ? 'Working' : failed ? 'Finished with errors' : 'Completed';
  const StatusIcon = awaitingApproval ? ShieldCheck : awaitingInput ? CircleHelp : failed ? CircleAlert : interrupted ? CirclePause : running ? LoaderCircle : Check;
  const statusDescription = `${status}${failedCount ? `, ${failedCount} ${failedCount === 1 ? 'step' : 'steps'} failed` : ''}`;
  const countLabel = activities.length ? `${activities.length} ${activities.length === 1 ? 'step' : 'steps'}` : 'Reasoning summary';
  const accessibleLabel = `Turn activity, ${countLabel}, ${statusDescription}${duration && !running ? `, ${duration} elapsed` : ''}`;
  const retainExpanded = () => setChoice(previous => previous?.identity === identity && previous.expanded ? previous : { identity, expanded: true });

  return <section className={`chat-turn-activity${expanded ? ' is-expanded' : ''}${running ? ' is-working' : ''}${failed ? ' has-failures' : ''}`} aria-label="Turn activity">
    <button type="button" id={triggerId} className="chat-turn-activity-toggle" aria-label={accessibleLabel} aria-expanded={expanded} aria-controls={detailsId} onClick={() => setChoice({ identity, expanded: !expanded })}>
      <StatusIcon size={15} aria-hidden="true" className={`chat-turn-activity-icon${running && !needsAttention ? ' chat-spin' : ''}`} />
      <span className="chat-turn-activity-heading">
        <span className="chat-turn-activity-title">Activity</span>
        <span className="chat-turn-activity-meta">{countLabel}</span>
        {duration && <span className="chat-turn-activity-meta chat-turn-activity-duration" title={`${timing?.source} elapsed time from recorded timestamps`} aria-hidden="true">{duration}</span>}
        {status !== 'Completed' && <span className="chat-turn-activity-state">{status}</span>}
        {failedCount > 0 && <span className="chat-turn-activity-failures">{failedCount} failed</span>}
      </span>
      <ChevronRight size={14} className="chat-turn-activity-chevron" aria-hidden="true" />
    </button>
    <span className="chat-sr-only" role="status" aria-live="polite" aria-atomic="true">{statusDescription}. {activities.length ? `${countLabel}.` : ''}{summaryCount ? ` ${summaryCount} public reasoning ${summaryCount === 1 ? 'summary' : 'summaries'}.` : ''}</span>
    <div id={detailsId} className="chat-turn-activity-details" hidden={!expanded} role="region" aria-labelledby={triggerId} onPointerDownCapture={retainExpanded} onFocusCapture={retainExpanded}>
      {(expanded || openedIdentity === identity) && <ol className="chat-turn-activity-list">
        {entries.map(entry => <li key={entry.key} className={`chat-turn-activity-entry is-${entry.kind}`}>
          {entry.kind === 'tool' ? renderActivity ? renderActivity(entry.activity, expanded) : <ActivityCard activity={entry.activity} onNotify={onNotify} workspacePath={workspacePath} onOpenFile={onOpenFile} /> : <div className="chat-turn-reasoning">
            <div className="chat-turn-reasoning-heading"><Sparkles size={13} aria-hidden="true" /><span>Reasoning summary</span>{running && entry.summary.status === 'streaming' && <small>Updating</small>}</div>
            <MarkdownMessage content={entry.summary.text} workspacePath={workspacePath} onNotify={onNotify} onOpenFile={onOpenFile} />
            {entry.summary.truncated && <p className="chat-turn-reasoning-truncated">Summary truncated.</p>}
          </div>}
        </li>)}
      </ol>}
    </div>
  </section>;
});
