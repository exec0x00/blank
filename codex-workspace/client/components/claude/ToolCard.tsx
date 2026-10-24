import { memo, useMemo, useState, type ReactNode } from 'react';
import { diffLines } from 'diff';
import {
  Ban, Bot, Check, ChevronRight, CircleDashed, FileCode2, FilePen, FilePlus2, FileSearch, Globe, ListChecks, LoaderCircle, Plug, Search,
  ShieldQuestion, Sparkles, SquareTerminal, Wrench, X, BookOpen, MessageCircleQuestion, ClipboardList,
} from 'lucide-react';
import type { ClaudeEntry, ClaudeTodo } from '../../../shared/claude';
import { MarkdownMessage } from '../chat/MarkdownMessage';

type ToolEntry = Extract<ClaudeEntry, { kind: 'tool' }>;
type Notify = (message: string, kind?: 'error' | 'success' | 'info') => void;
interface Props {
  entry: ToolEntry; workspacePath: string; childrenEntries?: ReactNode; childCount?: number;
  onOpenFile?: (path: string, location?: { line: number; column?: number }) => void; onNotify: Notify;
}

const str = (value: unknown) => typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value);
export function relativePath(file: string, root: string) {
  if (!file) return '';
  const base = root.endsWith('/') ? root : root + '/';
  return file.startsWith(base) ? file.slice(base.length) : file === root ? '.' : file;
}

function describe(entry: ToolEntry, root: string): { icon: ReactNode; title: string; detail?: string; path?: string } {
  const input = entry.input, name = entry.name;
  const file = str(input.file_path || input.notebook_path || input.path);
  switch (name) {
    case 'Bash': return { icon: <SquareTerminal size={15} />, title: str(input.description) || 'Ran a command', detail: str(input.command) };
    case 'BashOutput': return { icon: <SquareTerminal size={15} />, title: 'Read background output', detail: str(input.bash_id) };
    case 'KillShell': case 'TaskStop': return { icon: <SquareTerminal size={15} />, title: 'Stopped a background task', detail: str(input.shell_id || input.task_id) };
    case 'Read': return { icon: <FileCode2 size={15} />, title: 'Read', detail: relativePath(file, root) + (input.offset ? ` · from line ${input.offset}` : ''), path: file };
    case 'Edit': case 'MultiEdit': return { icon: <FilePen size={15} />, title: 'Edited', detail: relativePath(file, root), path: file };
    case 'Write': return { icon: <FilePlus2 size={15} />, title: 'Wrote', detail: relativePath(file, root), path: file };
    case 'NotebookEdit': return { icon: <FilePen size={15} />, title: 'Edited notebook', detail: relativePath(file, root), path: file };
    case 'Glob': return { icon: <FileSearch size={15} />, title: 'Found files', detail: str(input.pattern) + (input.path ? ` in ${relativePath(str(input.path), root)}` : '') };
    case 'Grep': return { icon: <Search size={15} />, title: 'Searched code', detail: str(input.pattern) + (input.glob ? ` · ${str(input.glob)}` : '') + (input.path ? ` in ${relativePath(str(input.path), root)}` : '') };
    case 'WebFetch': return { icon: <Globe size={15} />, title: 'Fetched', detail: str(input.url) };
    case 'WebSearch': return { icon: <Globe size={15} />, title: 'Searched the web', detail: str(input.query) };
    case 'Task': case 'Agent': return { icon: <Bot size={15} />, title: str(input.description) || 'Ran a subagent', detail: str(input.subagent_type) || 'general-purpose' };
    case 'TodoWrite': return { icon: <ListChecks size={15} />, title: 'Updated the plan', detail: `${(input.todos as unknown[] | undefined)?.length ?? 0} tasks` };
    case 'ExitPlanMode': return { icon: <ClipboardList size={15} />, title: 'Proposed a plan' };
    case 'EnterPlanMode': return { icon: <ClipboardList size={15} />, title: 'Entered plan mode' };
    case 'AskUserQuestion': return { icon: <MessageCircleQuestion size={15} />, title: 'Asked you a question', detail: ((input.questions as { header?: string }[] | undefined) ?? []).map(question => question.header).filter(Boolean).join(' · ') };
    case 'Skill': return { icon: <BookOpen size={15} />, title: 'Used a skill', detail: str(input.skill || input.command) };
    case 'ToolSearch': return { icon: <Wrench size={15} />, title: 'Loaded tools', detail: str(input.query) };
    default:
      if (name.startsWith('mcp__')) { const [, server, ...tool] = name.split('__'); return { icon: <Plug size={15} />, title: tool.join('__') || name, detail: server }; }
      return { icon: <Sparkles size={15} />, title: name, detail: Object.values(input).map(str).find(value => value && value.length < 160) };
  }
}

function StatusIcon({ status }: { status: ToolEntry['status'] }) {
  if (status === 'pending' || status === 'running') return <span className="chat-activity-status is-running" aria-label="Running"><LoaderCircle size={14} className="chat-spin" /></span>;
  if (status === 'awaiting') return <span className="chat-activity-status claude-status-awaiting" aria-label="Waiting for approval"><ShieldQuestion size={14} /></span>;
  if (status === 'success') return <span className="chat-activity-status is-completed" aria-label="Completed"><Check size={14} /></span>;
  if (status === 'denied') return <span className="chat-activity-status claude-status-denied" aria-label="Denied"><Ban size={14} /></span>;
  return <span className="chat-activity-status is-error" aria-label="Failed"><X size={14} /></span>;
}

function DiffView({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => diffLines(before, after), [before, after]);
  let shown = 0;
  return <pre className="claude-diff">{parts.map((part, index) => {
    const linesOf = part.value.replace(/\n$/, '').split('\n');
    if (!part.added && !part.removed) {
      const context = linesOf.length > 6 ? [...linesOf.slice(0, 2), '…', ...linesOf.slice(-2)] : linesOf;
      return context.map((line, position) => <span key={`${index}:${position}`} className="claude-diff-line">{'  ' + line}</span>);
    }
    return linesOf.map((line, position) => { shown++; return shown > 400 ? null : <span key={`${index}:${position}`} className={`claude-diff-line ${part.added ? 'is-added' : 'is-removed'}`}>{(part.added ? '+ ' : '- ') + line}</span>; });
  })}</pre>;
}

export function TodoList({ todos }: { todos: ClaudeTodo[] }) {
  return <ol className="claude-todos">{todos.map((todo, index) => <li key={index} className={`is-${todo.status}`}>
    {todo.status === 'completed' ? <Check size={13} /> : todo.status === 'in_progress' ? <LoaderCircle size={13} className="chat-spin" /> : <CircleDashed size={13} />}
    <span>{todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content}</span></li>)}</ol>;
}

function Body({ entry, workspacePath, onOpenFile, onNotify }: Props) {
  const input = entry.input;
  const result = entry.result ?? '';
  const output = result && <><div className="chat-activity-section-heading"><span>{entry.status === 'error' ? 'Error' : entry.status === 'denied' ? 'Not run' : 'Output'}</span></div><pre className="chat-activity-output">{result}{entry.resultTruncated ? '\n… output truncated' : ''}</pre></>;
  switch (entry.name) {
    case 'Bash': return <><div className="chat-activity-section-heading"><span>Command</span></div><pre>{str(input.command)}</pre>{output}</>;
    case 'Edit': return <><DiffView before={str(input.old_string)} after={str(input.new_string)} />{entry.status !== 'success' && output}</>;
    case 'MultiEdit': return <>{((input.edits as { old_string?: string; new_string?: string }[] | undefined) ?? []).map((edit, index) => <DiffView key={index} before={str(edit.old_string)} after={str(edit.new_string)} />)}{entry.status !== 'success' && output}</>;
    case 'Write': { const content = str(input.content); const lines = content.split('\n');
      return <><div className="chat-activity-section-heading"><span>{lines.length} lines</span></div><pre className="claude-diff">{lines.slice(0, 80).map((line, index) => <span key={index} className="claude-diff-line is-added">{'+ ' + line}</span>)}{lines.length > 80 ? <span className="claude-diff-line">… {lines.length - 80} more lines</span> : null}</pre>{entry.status !== 'success' && output}</>; }
    case 'TodoWrite': return <TodoList todos={(input.todos as ClaudeTodo[] | undefined) ?? []} />;
    case 'ExitPlanMode': return <div className="claude-plan-body"><MarkdownMessage content={str(input.plan)} workspacePath={workspacePath} onOpenFile={onOpenFile} onNotify={onNotify} /></div>;
    case 'AskUserQuestion': return <>{((input.questions as { question: string }[] | undefined) ?? []).map((question, index) => <p key={index} className="claude-question-recap">{question.question}</p>)}{output}</>;
    case 'Read': case 'Glob': case 'Grep': case 'WebFetch': case 'WebSearch': return output || <p className="chat-activity-waiting">No output yet.</p>;
    case 'Task': case 'Agent': return <>{!!input.prompt && <><div className="chat-activity-section-heading"><span>Instructions</span></div><pre>{str(input.prompt)}</pre></>}{result && <><div className="chat-activity-section-heading"><span>Result</span></div><div className="claude-agent-result"><MarkdownMessage content={result} workspacePath={workspacePath} onOpenFile={onOpenFile} onNotify={onNotify} /></div></>}</>;
    default: return <><div className="chat-activity-section-heading"><span>Input</span></div><pre>{JSON.stringify(input, null, 2)}</pre>{output}</>;
  }
}

export const ToolCard = memo(function ToolCard(props: Props) {
  const { entry, workspacePath, childrenEntries, childCount, onOpenFile } = props;
  const agent = entry.name === 'Task' || entry.name === 'Agent';
  const [expanded, setExpanded] = useState(entry.name === 'TodoWrite' || entry.name === 'ExitPlanMode');
  const [childrenOpen, setChildrenOpen] = useState(false);
  const info = describe(entry, workspacePath);
  const duration = entry.elapsedSeconds ? `${entry.elapsedSeconds}s` : '';
  return <div className={`chat-activity claude-tool is-${entry.status}${expanded ? ' is-expanded' : ''}${agent ? ' is-agent' : ''}`}>
    <button type="button" className="chat-activity-summary" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      <span className="chat-activity-icon">{info.icon}</span>
      <span className="chat-activity-label"><span>{info.title}</span>{info.detail && <code title={info.detail}>{info.detail}</code>}
        {agent && entry.progress && entry.status === 'running' && <small className="claude-tool-progress">{entry.progress}</small>}</span>
      {duration && (entry.status === 'running' || entry.status === 'pending') && <small className="claude-tool-time">{duration}</small>}
      <StatusIcon status={entry.status} />
      <ChevronRight size={14} className="chat-activity-chevron" />
    </button>
    {expanded && <div className="chat-activity-body">
      {info.path && onOpenFile && <button type="button" className="text-button claude-open-file" onClick={() => onOpenFile(relativePath(info.path!, workspacePath))}>Open {relativePath(info.path, workspacePath)}</button>}
      <Body {...props} />
    </div>}
    {agent && !!childCount && <div className="claude-agent-children">
      <button type="button" className="claude-agent-toggle" onClick={() => setChildrenOpen(value => !value)} aria-expanded={childrenOpen}>
        <ChevronRight size={12} className={childrenOpen ? 'is-open' : ''} />{childCount} step{childCount === 1 ? '' : 's'} by the subagent</button>
      {childrenOpen && <div className="claude-agent-steps">{childrenEntries}</div>}
    </div>}
  </div>;
});
