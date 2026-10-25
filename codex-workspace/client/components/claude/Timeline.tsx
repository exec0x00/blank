import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, ChevronRight, FileText, GitFork, History, Info, PencilLine, TriangleAlert } from 'lucide-react';
import type { ClaudeEntry } from '../../../shared/claude';
import { CopyButton, MarkdownMessage } from '../chat/MarkdownMessage';
import { Step, StepIcon, type StepContext } from './agent/Step';
import { describeStep, duration, isRunning, summarize, type StepEntry } from './agent/steps';

type Notify = (message: string, kind?: 'error' | 'success' | 'info') => void;
type UserEntry = Extract<ClaudeEntry, { kind: 'user' }>;
type AssistantEntry = Extract<ClaudeEntry, { kind: 'assistant' }>;
type TurnEntry = Extract<ClaudeEntry, { kind: 'turn' }>;
export interface TimelineActions {
  onEdit: (entry: UserEntry) => void;
  onRewind: (entry: UserEntry) => void;
  onFork: (entryId: string) => void;
}
interface Props {
  conversationId: string; entries: ClaudeEntry[]; workspacePath: string; running: boolean; actionsDisabled: boolean; actions: TimelineActions;
  onNotify: Notify; onOpenFile?: (path: string, location?: { line: number; column?: number }) => void;
}

export const money = (value: number) => value >= 1 ? `$${value.toFixed(2)}` : value >= 0.01 ? `$${value.toFixed(3)}` : value > 0 ? '<$0.01' : '$0';
export const compactTokens = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k` : String(value);
const ICON = { size: 14, strokeWidth: 1.75 };
const ENTER_MS = 900;

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/** A run of tool calls and thinking, folded into one line that opens into its steps. */
const WorkGroup = memo(function WorkGroup({ steps, ctx, children, running, fresh }: {
  steps: StepEntry[]; ctx: StepContext; children: Map<string, ClaudeEntry[]>; running: boolean; fresh: boolean;
}) {
  const [open, setOpen] = useState(false);
  const live = running && steps.some(isRunning);
  const current = [...steps].reverse().find(isRunning) ?? steps[steps.length - 1];
  const info = describeStep(current, ctx.workspacePath);
  const now = useNow(live);
  const start = new Date(steps[0].at).getTime();
  const last = steps[steps.length - 1];
  const end = live ? now : new Date((last.kind === 'tool' && last.finishedAt) || last.at).getTime();
  const failed = steps.filter(step => step.kind === 'tool' && step.status === 'error').length;
  const label = live ? `${info.doing}…` : summarize(steps);
  const renderNested = (step: StepEntry) => {
    const nested = children.get(step.id) ?? [];
    if (!nested.length) return undefined;
    return <ol className="ag-steps">{nested.map(child => child.kind === 'tool' || child.kind === 'thinking'
      ? <Step key={child.id} entry={child} ctx={ctx} nested={renderNested(child)} nestedCount={children.get(child.id)?.length} />
      : child.kind === 'assistant' && child.text.trim()
        ? <li key={child.id} className="ag-step ag-step-note"><span className="ag-step-i"><i className="ag-dot" /></span>
          <div className="ag-step-main ag-md ag-md-sm"><MarkdownMessage content={child.text} workspacePath={ctx.workspacePath} onNotify={ctx.onNotify} onOpenFile={ctx.onOpenFile} /></div></li>
        : null)}</ol>;
  };
  return <section className={`ag-work${open ? ' open' : ''}${live ? ' live' : ''}${fresh ? ' ag-in' : ''}`}>
    <button type="button" className="ag-work-h" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span className="ag-work-i">{live ? <i className="ag-ring" /> : <StepIcon kind={info.kind} />}</span>
      <span className={`ag-work-t${live ? ' ag-shimmer' : ''}`} key={label}>{label}</span>
      {!live && failed > 0 && <span className="ag-work-m">{failed} failed</span>}
      <span className="ag-work-time">{duration(Math.max(0, end - start))}</span>
      <ChevronRight {...ICON} className="ag-chev" />
    </button>
    <div className={`ag-collapse${open ? ' open' : ''}`}><div className="ag-collapse-in">
      {open && <ol className="ag-steps">{steps.map(step => <Step key={step.id} entry={step} ctx={ctx}
        nested={renderNested(step)} nestedCount={children.get(step.id)?.filter(child => child.kind === 'tool').length} />)}</ol>}
    </div></div>
  </section>;
});

/** Long pasted messages stay compact until opened. */
function Bubble({ text, command }: { text: string; command: boolean }) {
  const long = text.length > 900 || text.split('\n').length > 12;
  const [open, setOpen] = useState(false);
  return <div className={`ag-bubble${command ? ' is-command' : ''}${long && !open ? ' clamped' : ''}`}>
    <div className="ag-bubble-t">{text}</div>
    {long && <button type="button" className="ag-more-t" onClick={() => setOpen(value => !value)}>{open ? 'Show less' : 'Show more'}</button>}
  </div>;
}

function UserMessage({ entry, fresh, disabled, actions, onNotify }: { entry: UserEntry; fresh: boolean; disabled: boolean; actions: TimelineActions; onNotify: Notify }) {
  return <article className={`ag-user${fresh ? ' ag-in-user' : ''}`} aria-label="Your message">
    {!!entry.attachments?.length && <div className="ag-attach">{entry.attachments.map(attachment => attachment.kind === 'image'
      ? <a key={attachment.id} className="ag-thumb" href={`/api/claude/attachments/${attachment.id}`} target="_blank" rel="noreferrer"><img src={`/api/claude/attachments/${attachment.id}`} alt={attachment.name} /></a>
      : <a key={attachment.id} className="ag-file" href={`/api/claude/attachments/${attachment.id}`} target="_blank" rel="noreferrer"><FileText {...ICON} /><span>{attachment.name}</span></a>)}</div>}
    {entry.steered && <span className="ag-tag" title="Sent while Claude was working; it joined that turn">Steered</span>}
    {entry.text && <Bubble text={entry.text} command={!!entry.command} />}
    <div className="ag-acts ag-user-acts">
      <CopyButton text={entry.text} label="Copy message" onNotify={onNotify} />
      <button type="button" className="chat-copy" title="Edit and resend" aria-label="Edit and resend" disabled={disabled} onClick={() => actions.onEdit(entry)}><PencilLine {...ICON} /></button>
      <button type="button" className="chat-copy" title="Rewind to before this message" aria-label="Rewind" disabled={disabled} onClick={() => actions.onRewind(entry)}><History {...ICON} /></button>
    </div>
  </article>;
}

function Reply({ entry, final, turn, last, fresh, disabled, actions, ctx }: {
  entry: AssistantEntry; final: boolean; turn?: TurnEntry; last: boolean; fresh: boolean; disabled: boolean; actions: TimelineActions; ctx: StepContext;
}) {
  return <article className={`ag-reply${entry.streaming ? ' streaming' : ''}${fresh ? ' ag-in' : ''}`} aria-label="Claude's response">
    <div className="ag-md"><MarkdownMessage content={entry.text} workspacePath={ctx.workspacePath} onNotify={ctx.onNotify} onOpenFile={ctx.onOpenFile} /></div>
    {final && !entry.streaming && <div className={`ag-acts ag-reply-acts${last ? ' last' : ''}`}>
      <CopyButton text={entry.text} label="Copy response" onNotify={ctx.onNotify} />
      <button type="button" className="chat-copy" title="Fork conversation from here" aria-label="Fork from here" disabled={disabled} onClick={() => actions.onFork(entry.id)}><GitFork {...ICON} /></button>
      {turn && <TurnMeta turn={turn} />}
    </div>}
  </article>;
}

function TurnMeta({ turn }: { turn: TurnEntry }) {
  const detail = [turn.outputTokens > 0 && `${compactTokens(turn.outputTokens)} tokens out`, turn.costUsd > 0 && money(turn.costUsd), turn.numTurns > 1 && `${turn.numTurns} steps`].filter(Boolean).join(' · ');
  return <span className="ag-meta" title={detail || undefined}>{turn.ok ? 'Worked for' : 'Stopped after'} {duration(turn.durationMs)}</span>;
}

function Note({ entry, fresh }: { entry: Extract<ClaudeEntry, { kind: 'system' }>; fresh: boolean }) {
  if (entry.level === 'error') return <div className={`ag-alert${fresh ? ' ag-in' : ''}`} role="alert"><AlertCircle {...ICON} /><p>{entry.text}</p></div>;
  return <div className={`ag-note${fresh ? ' ag-in' : ''}`}>{entry.level === 'warning' ? <TriangleAlert {...ICON} /> : <Info {...ICON} />}<p>{entry.text}</p></div>;
}

export const Timeline = memo(function Timeline({ conversationId, entries, workspacePath, running, actionsDisabled, actions, onNotify, onOpenFile }: Props) {
  // Entries already present when a conversation opens appear at rest; only new arrivals animate in.
  const born = useRef<{ id: string; at: Map<string, number> }>({ id: '', at: new Map() });
  if (born.current.id !== conversationId) born.current = { id: conversationId, at: new Map(entries.map(entry => [entry.id, 0])) };
  const now = Date.now();
  for (const entry of entries) if (!born.current.at.has(entry.id)) born.current.at.set(entry.id, now);
  const fresh = (id: string) => now - (born.current.at.get(id) ?? 0) < ENTER_MS;
  const ctx = useMemo<StepContext>(() => ({ workspacePath, onNotify, onOpenFile }), [workspacePath, onNotify, onOpenFile]);

  const { top, children } = useMemo(() => {
    const children = new Map<string, ClaudeEntry[]>();
    const known = new Set(entries.map(entry => entry.id));
    const top: ClaudeEntry[] = [];
    for (const entry of entries) {
      const parent = 'parentToolUseId' in entry ? entry.parentToolUseId : null;
      if (parent && known.has(parent)) children.set(parent, [...(children.get(parent) ?? []), entry]);
      else top.push(entry);
    }
    return { top, children };
  }, [entries]);

  const visible = top.filter(entry => entry.kind !== 'assistant' || entry.text.trim() || entry.streaming);
  const lastReply = [...visible].reverse().find(entry => entry.kind === 'assistant')?.id;
  const blocks: ReactNode[] = [];
  for (let index = 0; index < visible.length; index++) {
    const entry = visible[index];
    if (entry.kind === 'tool' || entry.kind === 'thinking') {
      const steps: StepEntry[] = [];
      while (index < visible.length && (visible[index].kind === 'tool' || visible[index].kind === 'thinking')) steps.push(visible[index++] as StepEntry);
      index--;
      blocks.push(<WorkGroup key={`work-${steps[0].id}`} steps={steps} ctx={ctx} children={children} running={running} fresh={fresh(steps[0].id)} />);
      continue;
    }
    switch (entry.kind) {
      case 'user':
        blocks.push(<UserMessage key={entry.id} entry={entry} fresh={fresh(entry.id)} disabled={actionsDisabled} actions={actions} onNotify={onNotify} />);
        break;
      case 'assistant': {
        const next = visible[index + 1];
        const final = !next || next.kind === 'turn' || next.kind === 'user';
        const turn = next?.kind === 'turn' ? next : undefined;
        if (turn) index++;
        blocks.push(<Reply key={entry.id} entry={entry} final={final} turn={turn} last={entry.id === lastReply && !running} fresh={fresh(entry.id)}
          disabled={actionsDisabled} actions={actions} ctx={ctx} />);
        break;
      }
      case 'system':
        blocks.push(<Note key={entry.id} entry={entry} fresh={fresh(entry.id)} />);
        break;
      case 'turn':
        // A turn that ended without a closing reply still says how it ended.
        blocks.push(<div key={entry.id} className={`ag-acts ag-turn-end${fresh(entry.id) ? ' ag-in' : ''}`}><TurnMeta turn={entry} /></div>);
        break;
    }
  }
  return <div className="ag-timeline">{blocks}</div>;
});
