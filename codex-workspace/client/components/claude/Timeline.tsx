import { memo, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, Brain, ChevronRight, FileText, GitFork, History, Info, PencilLine } from 'lucide-react';
import type { ClaudeEntry } from '../../../shared/claude';
import { CopyButton, MarkdownMessage } from '../chat/MarkdownMessage';
import { ToolCard } from './ToolCard';

type Notify = (message: string, kind?: 'error' | 'success' | 'info') => void;
export interface TimelineActions {
  onEdit: (entry: Extract<ClaudeEntry, { kind: 'user' }>) => void;
  onRewind: (entry: Extract<ClaudeEntry, { kind: 'user' }>) => void;
  onFork: (entryId: string) => void;
}
interface Props {
  conversationId: string; entries: ClaudeEntry[]; workspacePath: string; running: boolean; actionsDisabled: boolean; actions: TimelineActions;
  onNotify: Notify; onOpenFile?: (path: string, location?: { line: number; column?: number }) => void;
}

const seconds = (ms: number) => ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
export const money = (value: number) => value >= 1 ? `$${value.toFixed(2)}` : value >= 0.01 ? `$${value.toFixed(3)}` : value > 0 ? '<$0.01' : '$0';
export const compactTokens = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k` : String(value);

const Thinking = memo(function Thinking({ entry, workspacePath, onNotify, fresh }: { entry: Extract<ClaudeEntry, { kind: 'thinking' }>; workspacePath: string; onNotify: Notify; fresh?: boolean }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const words = entry.text.trim().split(/\s+/).filter(Boolean).length;
  return <div className={`claude-thinking${open ? ' is-open' : ''}${entry.streaming ? ' is-streaming' : ''}${fresh ? ' claude-enter' : ''}`}>
    <button type="button" onClick={() => { setMounted(true); setOpen(value => !value); }} aria-expanded={open}>
      <Brain size={14} /><span>{entry.streaming ? 'Thinking…' : entry.redacted ? 'Thought (hidden)' : `Thought${words ? ` · ${words} words` : ''}`}</span><ChevronRight size={13} />
    </button>
    <div className={`claude-collapse${open ? ' is-open' : ''}`}><div className="claude-collapse-inner">
      {mounted && entry.text && <div className="claude-thinking-body"><MarkdownMessage content={entry.text} workspacePath={workspacePath} onNotify={onNotify} /></div>}
    </div></div>
  </div>;
});

const ENTER_MS = 900;

export const Timeline = memo(function Timeline({ conversationId, entries, workspacePath, running, actionsDisabled, actions, onNotify, onOpenFile }: Props) {
  // Entries already present when a conversation opens appear at rest; only
  // entries that arrive afterwards animate in, and only briefly.
  const born = useRef<{ id: string; at: Map<string, number> }>({ id: '', at: new Map() });
  if (born.current.id !== conversationId) born.current = { id: conversationId, at: new Map(entries.map(entry => [entry.id, 0])) };
  const now = Date.now();
  for (const entry of entries) if (!born.current.at.has(entry.id)) born.current.at.set(entry.id, now);
  const fresh = (id: string) => now - (born.current.at.get(id) ?? 0) < ENTER_MS;
  const children = useMemo(() => {
    const map = new Map<string, ClaudeEntry[]>();
    for (const entry of entries) {
      const parent = 'parentToolUseId' in entry ? entry.parentToolUseId : null;
      if (parent) map.set(parent, [...(map.get(parent) ?? []), entry]);
    }
    return map;
  }, [entries]);
  const known = useMemo(() => new Set(entries.map(entry => entry.id)), [entries]);
  const top = entries.filter(entry => !('parentToolUseId' in entry) || !entry.parentToolUseId || !known.has(entry.parentToolUseId));
  const lastAssistant = [...top].reverse().find(entry => entry.kind === 'assistant')?.id;
  // Actions belong to the reply that ends a turn, not to interim narration between tools.
  const turnFinal = new Set(top.filter((entry, index) => entry.kind === 'assistant' && (!top[index + 1] || ['turn', 'user'].includes(top[index + 1].kind))).map(entry => entry.id));

  const renderEntry = (entry: ClaudeEntry, nested = false): ReactNode => {
    switch (entry.kind) {
      case 'user':
        return <article key={entry.id} className={`chat-message is-user claude-user${entry.command ? ' is-command' : ''}${fresh(entry.id) ? ' claude-enter-user' : ''}`} aria-label="Your message">
          {!!entry.attachments?.length && <div className="claude-message-attachments">{entry.attachments.map(attachment => attachment.kind === 'image'
            ? <a key={attachment.id} href={`/api/claude/attachments/${attachment.id}`} target="_blank" rel="noreferrer"><img src={`/api/claude/attachments/${attachment.id}`} alt={attachment.name} /></a>
            : <a key={attachment.id} className="claude-file-chip" href={`/api/claude/attachments/${attachment.id}`} target="_blank" rel="noreferrer"><FileText size={13} />{attachment.name}</a>)}</div>}
          {entry.steered && <span className="claude-steered-tag" title="Sent while Claude was working; it joined that turn">Steered</span>}
          {entry.text && <div className="chat-user-content">{entry.text}</div>}
          {!nested && <div className="chat-message-actions claude-user-actions">
            <CopyButton text={entry.text} label="Copy message" onNotify={onNotify} />
            <button type="button" className="chat-copy" title="Edit and resend" aria-label="Edit and resend" disabled={actionsDisabled} onClick={() => actions.onEdit(entry)}><PencilLine size={14} /></button>
            <button type="button" className="chat-copy" title="Rewind to before this message" aria-label="Rewind" disabled={actionsDisabled} onClick={() => actions.onRewind(entry)}><History size={14} /></button>
          </div>}
        </article>;
      case 'assistant':
        if (!entry.text.trim() && !entry.streaming) return null;
        return <article key={entry.id} className={`chat-message is-assistant claude-assistant${nested ? ' is-nested' : ''}${entry.streaming ? ' is-streaming' : ''}${fresh(entry.id) ? ' claude-enter' : ''}`} aria-label="Claude's response">
          <MarkdownMessage content={entry.text} workspacePath={workspacePath} onNotify={onNotify} onOpenFile={onOpenFile} />
          {!entry.streaming && !nested && turnFinal.has(entry.id) && <div className={`chat-message-actions claude-assistant-actions${entry.id === lastAssistant && !running ? ' is-last' : ''}`}>
            <CopyButton text={entry.text} label="Copy response" onNotify={onNotify} />
            <button type="button" className="chat-copy" title="Fork conversation from here" aria-label="Fork from here" disabled={actionsDisabled} onClick={() => actions.onFork(entry.id)}><GitFork size={14} /></button>
          </div>}
        </article>;
      case 'thinking':
        return <Thinking key={entry.id} entry={entry} workspacePath={workspacePath} onNotify={onNotify} fresh={fresh(entry.id)} />;
      case 'tool': {
        const nestedEntries = children.get(entry.id) ?? [];
        return <ToolCard key={entry.id} entry={entry} workspacePath={workspacePath} onNotify={onNotify} onOpenFile={onOpenFile} fresh={fresh(entry.id)}
          childCount={nestedEntries.length} childrenEntries={nestedEntries.length ? nestedEntries.map(child => renderEntry(child, true)) : undefined} />;
      }
      case 'system':
        return <div key={entry.id} className={`chat-system-message claude-system is-${entry.level}${fresh(entry.id) ? ' claude-enter' : ''}`} role={entry.level === 'error' ? 'alert' : undefined}>
          {entry.level === 'error' ? <AlertCircle size={13} /> : entry.level === 'warning' ? <AlertTriangle size={13} /> : <Info size={13} />}<p>{entry.text}</p></div>;
      case 'turn':
        return <div key={entry.id} className={`claude-turn-footer${fresh(entry.id) ? ' claude-enter-soft' : ''}`}><span>{entry.ok ? 'Worked' : 'Stopped'} for {seconds(entry.durationMs)}</span>
          {entry.numTurns > 1 && <span>{entry.numTurns} steps</span>}
          {entry.outputTokens > 0 && <span>{compactTokens(entry.outputTokens)} tokens out</span>}
          {entry.costUsd > 0 && <span>{money(entry.costUsd)}</span>}</div>;
    }
  };

  // Group consecutive tool calls so they read as a single block of activity.
  const blocks: ReactNode[] = [];
  let group: ReactNode[] = [];
  const flush = () => { if (group.length) { blocks.push(<div className="chat-activities claude-activities" key={`group-${blocks.length}`}>{group}</div>); group = []; } };
  for (const entry of top) {
    const node = renderEntry(entry);
    if (!node) continue;
    if (entry.kind === 'tool' || entry.kind === 'thinking') group.push(node);
    else { flush(); blocks.push(node); }
  }
  flush();
  return <>{blocks}</>;
});
