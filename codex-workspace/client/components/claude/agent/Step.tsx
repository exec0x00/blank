import { memo, useMemo, useRef, useState, type ReactNode } from 'react';
import { diffLines } from 'diff';
import {
  Ban, Bot, BookOpen, Brain, Check, ChevronRight, CircleDashed, ClipboardList, FileCode2, FilePen, FilePlus2, Globe, MessageCircleQuestion, Plug, Search,
  ShieldQuestion, SquareTerminal, X,
} from 'lucide-react';
import type { ClaudeTodo } from '../../../../shared/claude';
import { MarkdownMessage } from '../../chat/MarkdownMessage';
import { useCustomScroll } from '../composer/useCustomScroll';
import { describeStep, diffStat, isRunning, parseSearch, relativePath, str, toolName, type StepEntry, type StepKind, type ToolEntry } from './steps';

type Notify = (message: string, kind?: 'error' | 'success' | 'info') => void;
export interface StepContext { workspacePath: string; onNotify: Notify; onOpenFile?: (path: string, location?: { line: number; column?: number }) => void }

const ICON = { size: 14, strokeWidth: 1.75 };
export function StepIcon({ kind }: { kind: StepKind }) {
  switch (kind) {
    case 'read': return <FileCode2 {...ICON} />;
    case 'edit': return <FilePen {...ICON} />;
    case 'create': return <FilePlus2 {...ICON} />;
    case 'command': return <SquareTerminal {...ICON} />;
    case 'search': return <Search {...ICON} />;
    case 'web': case 'fetch': return <Globe {...ICON} />;
    case 'agent': return <Bot {...ICON} />;
    case 'plan': return <ClipboardList {...ICON} />;
    case 'question': return <MessageCircleQuestion {...ICON} />;
    case 'skill': return <BookOpen {...ICON} />;
    case 'think': return <Brain {...ICON} />;
    default: return <Plug {...ICON} />;
  }
}

/** A bounded, quietly scrolling block of monospace text. */
function Scroll({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLPreElement>(null);
  useCustomScroll(ref, { right: 3, inset: 6 });
  return <div className="ag-scroll-host"><pre ref={ref} className={`ag-pre ${className}`}>{children}</pre></div>;
}

function Caption({ children }: { children: ReactNode }) { return <div className="ag-caption">{children}</div>; }

function DiffView({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => diffLines(before, after), [before, after]);
  let shown = 0;
  return <Scroll className="ag-diff">{parts.map((part, index) => {
    const lines = part.value.replace(/\n$/, '').split('\n');
    if (!part.added && !part.removed) {
      const context = lines.length > 6 ? [...lines.slice(0, 2), '⋯', ...lines.slice(-2)] : lines;
      return context.map((line, position) => <span key={`${index}:${position}`} className="ag-dl"><i> </i>{line}</span>);
    }
    return lines.map((line, position) => {
      shown++;
      return shown > 400 ? null : <span key={`${index}:${position}`} className={`ag-dl ${part.added ? 'add' : 'del'}`}><i>{part.added ? '+' : '−'}</i>{line}</span>;
    });
  })}</Scroll>;
}

export function TodoList({ todos }: { todos: ClaudeTodo[] }) {
  return <ol className="ag-todos">{todos.map((todo, index) => <li key={index} className={todo.status}>
    <span className="ag-todo-i">{todo.status === 'completed' ? <Check size={11} strokeWidth={2.5} /> : todo.status === 'in_progress' ? <i className="ag-ring" /> : <CircleDashed size={13} strokeWidth={1.75} />}</span>
    <span>{todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content}</span></li>)}</ol>;
}

const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

function Sources({ result, ctx }: { result: string; ctx: StepContext }) {
  const { links, notes } = useMemo(() => parseSearch(result), [result]);
  if (!links.length) return <Scroll>{result}</Scroll>;
  return <>
    <ol className="ag-sources">{links.map((link, index) => <li key={index} style={{ animationDelay: `${Math.min(index, 8) * 28}ms` }}>
      <a href={link.url} target="_blank" rel="noreferrer"><img src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host(link.url))}&sz=32`} alt="" loading="lazy" />
        <span>{link.title}</span><small>{host(link.url)}</small></a></li>)}</ol>
    {notes && <div className="ag-md ag-md-sm"><MarkdownMessage content={notes} workspacePath={ctx.workspacePath} onOpenFile={ctx.onOpenFile} onNotify={ctx.onNotify} /></div>}
  </>;
}

function Images({ images }: { images: NonNullable<ToolEntry['images']> }) {
  return <div className="ag-images">{images.map(image => <a key={image.id} href={`/api/claude/attachments/${image.id}`} target="_blank" rel="noreferrer" title="Open full size">
    <img src={`/api/claude/attachments/${image.id}`} alt={image.name} loading="lazy" /></a>)}</div>;
}

function Output({ entry }: { entry: ToolEntry }) {
  const result = entry.result ?? '';
  if (!result) return entry.status === 'running' || entry.status === 'pending' ? <p className="ag-waiting">Waiting for output…</p> : null;
  return <>{entry.status === 'error' && <Caption>Error</Caption>}{entry.status === 'denied' && <Caption>Not run</Caption>}
    <Scroll className={entry.status === 'error' ? 'is-error' : ''}>{result}{entry.resultTruncated ? '\n⋯ output truncated' : ''}</Scroll></>;
}

function ToolDetail({ entry, ctx, nested }: { entry: ToolEntry; ctx: StepContext; nested?: ReactNode }) {
  const input = entry.input;
  const md = (content: string) => <div className="ag-md ag-md-sm"><MarkdownMessage content={content} workspacePath={ctx.workspacePath} onOpenFile={ctx.onOpenFile} onNotify={ctx.onNotify} /></div>;
  const failed = entry.status !== 'success';
  switch (toolName(entry.name)) {
    case 'Bash': return <><Scroll className="ag-cmd"><span className="ag-prompt">$</span>{str(input.command)}</Scroll><Output entry={entry} /></>;
    case 'Edit': return <><DiffView before={str(input.old_string)} after={str(input.new_string)} />{failed && <Output entry={entry} />}</>;
    case 'MultiEdit': return <>{((input.edits as { old_string?: string; new_string?: string }[] | undefined) ?? []).map((edit, index) => <DiffView key={index} before={str(edit.old_string)} after={str(edit.new_string)} />)}{failed && <Output entry={entry} />}</>;
    case 'Write': return <><DiffView before="" after={str(input.content).split('\n').slice(0, 400).join('\n')} />{failed && <Output entry={entry} />}</>;
    case 'TodoWrite': return <TodoList todos={(input.todos as ClaudeTodo[] | undefined) ?? []} />;
    case 'ExitPlanMode': return md(str(input.plan));
    case 'AskUserQuestion': return <>{((input.questions as { question: string }[] | undefined) ?? []).map((question, index) => <p key={index} className="ag-recap">{question.question}</p>)}
      {entry.result && <><Caption>Answer</Caption><p className="ag-recap is-answer">{entry.result}</p></>}</>;
    case 'WebSearch': return entry.result && entry.status === 'success' ? <Sources result={entry.result} ctx={ctx} /> : <Output entry={entry} />;
    case 'Read': return entry.images?.length && (entry.result ?? '').trim() === '[image]' ? null : <Output entry={entry} />;
    case 'Task': case 'Agent': return <>
      {!!input.prompt && <><Caption>Instructions</Caption><Scroll className="ag-prose">{str(input.prompt)}</Scroll></>}
      {nested && <><Caption>Steps</Caption><div className="ag-nested">{nested}</div></>}
      {entry.result && <><Caption>Result</Caption>{md(entry.result)}</>}</>;
    case 'Glob': case 'Grep': case 'WebFetch': case 'Skill': case 'ToolSearch': return <Output entry={entry} />;
    default: return <><Caption>Input</Caption><Scroll>{JSON.stringify(input, null, 2)}</Scroll><Output entry={entry} /></>;
  }
}

function Status({ entry }: { entry: StepEntry }) {
  if (isRunning(entry)) return entry.kind === 'tool' && entry.status === 'awaiting'
    ? <span className="ag-st" title="Waiting for your approval"><ShieldQuestion size={13} strokeWidth={1.75} /></span>
    : <span className="ag-st" aria-label="Running"><i className="ag-ring" /></span>;
  if (entry.kind === 'tool' && entry.status === 'error') return <span className="ag-st is-error" title="Failed"><X size={13} strokeWidth={2} /></span>;
  if (entry.kind === 'tool' && entry.status === 'denied') return <span className="ag-st" title="Not allowed"><Ban size={12} strokeWidth={1.75} /></span>;
  return null;
}

/** One step inside a work group; opens to show exactly what happened. */
export const Step = memo(function Step({ entry, ctx, nested, nestedCount }: { entry: StepEntry; ctx: StepContext; nested?: ReactNode; nestedCount?: number }) {
  const info = describeStep(entry, ctx.workspacePath);
  const running = isRunning(entry);
  const autoOpen = entry.kind === 'tool' && (entry.name === 'TodoWrite' || entry.name === 'ExitPlanMode');
  const [open, setOpen] = useState(autoOpen);
  const [mounted, setMounted] = useState(autoOpen);
  const stat = entry.kind === 'tool' ? diffStat(entry) : null;
  const words = entry.kind === 'thinking' ? entry.text.trim().split(/\s+/).filter(Boolean).length : 0;
  const expandable = entry.kind === 'thinking' ? !!entry.text.trim() : true;
  const label = running ? `${info.doing}…` : info.done;
  // File steps already name the file; the detail adds only the folder it lives in.
  const sub = info.path ? info.detail?.split('/').slice(0, -1).join('/') : info.detail;
  const agentProgress = entry.kind === 'tool' && running && entry.progress;
  return <li className={`ag-step${open ? ' open' : ''}${running ? ' live' : ''}${entry.kind === 'tool' ? ` s-${entry.status}` : ''}`}>
    <span className="ag-step-i"><StepIcon kind={info.kind} /></span>
    <div className="ag-step-main">
      <button type="button" className="ag-step-h" aria-expanded={open} disabled={!expandable} onClick={() => { setMounted(true); setOpen(value => !value); }}>
        <span className={`ag-step-t${running ? ' ag-shimmer' : ''}`} key={label}>{label}</span>
        {sub && <code className="ag-step-d" title={info.detail}>{sub}</code>}
        {agentProgress && <span className="ag-step-d">{agentProgress}</span>}
        <span className="ag-step-sp" />
        {stat && entry.kind === 'tool' && entry.status === 'success' && <span className="ag-stat"><span>+{stat.added}</span>{stat.removed > 0 && <span className="del">−{stat.removed}</span>}</span>}
        {entry.kind === 'thinking' && !running && words > 0 && <span className="ag-step-m">{words} words</span>}
        {!!nestedCount && <span className="ag-step-m">{nestedCount} steps</span>}
        {entry.kind === 'tool' && running && !!entry.elapsedSeconds && <span className="ag-step-m">{entry.elapsedSeconds}s</span>}
        <Status entry={entry} />
        {expandable && <ChevronRight size={13} strokeWidth={1.75} className="ag-chev" />}
      </button>
      {entry.kind === 'tool' && !!entry.images?.length && <Images images={entry.images} />}
      <div className={`ag-collapse${open ? ' open' : ''}`}><div className="ag-collapse-in">
        {mounted && <div className="ag-detail">
          {entry.kind === 'thinking'
            ? <div className="ag-md ag-md-sm ag-thought"><MarkdownMessage content={entry.text} workspacePath={ctx.workspacePath} onNotify={ctx.onNotify} /></div>
            : <>{info.path && ctx.onOpenFile && <button type="button" className="ag-open" onClick={() => ctx.onOpenFile!(relativePath(info.path!, ctx.workspacePath))}>Open {relativePath(info.path, ctx.workspacePath)}</button>}
              <ToolDetail entry={entry} ctx={ctx} nested={nested} /></>}
        </div>}
      </div></div>
    </div>
  </li>;
});
