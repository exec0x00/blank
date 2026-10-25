import { diffLines } from 'diff';
import type { ClaudeEntry } from '../../../../shared/claude';

export type ToolEntry = Extract<ClaudeEntry, { kind: 'tool' }>;
export type ThinkingEntry = Extract<ClaudeEntry, { kind: 'thinking' }>;
export type StepEntry = ToolEntry | ThinkingEntry;
export type StepKind = 'read' | 'edit' | 'create' | 'command' | 'search' | 'web' | 'fetch' | 'agent' | 'plan' | 'question' | 'skill' | 'tool' | 'think';

export const str = (value: unknown) => typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value);
export function relativePath(file: string, root: string) {
  if (!file) return '';
  const base = root.endsWith('/') ? root : root + '/';
  return file.startsWith(base) ? file.slice(base.length) : file === root ? '.' : file;
}
const baseName = (file: string) => file.split('/').filter(Boolean).pop() ?? file;
/** The workspace's own web search tool behaves like Claude Code's WebSearch. */
export const toolName = (name: string) => name === 'mcp__web__search' ? 'WebSearch' : name;
export const isRunning = (entry: StepEntry) => entry.kind === 'thinking' ? !!entry.streaming : entry.status === 'running' || entry.status === 'pending' || entry.status === 'awaiting';

export interface StepInfo { kind: StepKind; done: string; doing: string; detail?: string; path?: string }

/** How a step reads in the timeline: a short past-tense title, a present-tense one while it runs, and its target. */
export function describeStep(entry: StepEntry, root: string): StepInfo {
  if (entry.kind === 'thinking') return { kind: 'think', done: entry.redacted ? 'Thought privately' : 'Thought', doing: 'Thinking' };
  const input = entry.input, name = toolName(entry.name);
  const file = str(input.file_path || input.notebook_path || input.path);
  const rel = relativePath(file, root);
  switch (name) {
    case 'Bash': { const what = str(input.description); return { kind: 'command', done: what || 'Ran a command', doing: what || 'Running a command', detail: str(input.command) }; }
    case 'BashOutput': return { kind: 'command', done: 'Read command output', doing: 'Reading command output', detail: str(input.bash_id) };
    case 'KillShell': case 'TaskStop': return { kind: 'command', done: 'Stopped a background task', doing: 'Stopping a background task', detail: str(input.shell_id || input.task_id) };
    case 'Read': return { kind: 'read', done: `Read ${baseName(rel)}`, doing: `Reading ${baseName(rel)}`, detail: rel, path: file };
    case 'Edit': case 'MultiEdit': return { kind: 'edit', done: `Edited ${baseName(rel)}`, doing: `Editing ${baseName(rel)}`, detail: rel, path: file };
    case 'NotebookEdit': return { kind: 'edit', done: `Edited ${baseName(rel)}`, doing: `Editing ${baseName(rel)}`, detail: rel, path: file };
    case 'Write': return { kind: 'create', done: `Wrote ${baseName(rel)}`, doing: `Writing ${baseName(rel)}`, detail: rel, path: file };
    case 'Glob': return { kind: 'search', done: 'Found files', doing: 'Finding files', detail: str(input.pattern) + (input.path ? ` in ${relativePath(str(input.path), root)}` : '') };
    case 'Grep': return { kind: 'search', done: 'Searched the code', doing: 'Searching the code', detail: str(input.pattern) + (input.path ? ` in ${relativePath(str(input.path), root)}` : '') };
    case 'WebSearch': return { kind: 'web', done: 'Searched the web', doing: 'Searching the web', detail: str(input.query) };
    case 'WebFetch': return { kind: 'fetch', done: 'Read a page', doing: 'Reading a page', detail: str(input.url) };
    case 'Task': case 'Agent': { const what = str(input.description); return { kind: 'agent', done: what || 'Ran an agent', doing: what || 'Running an agent', detail: str(input.subagent_type) || undefined }; }
    case 'TodoWrite': return { kind: 'plan', done: 'Updated the plan', doing: 'Updating the plan' };
    case 'ExitPlanMode': return { kind: 'plan', done: 'Proposed a plan', doing: 'Proposing a plan' };
    case 'EnterPlanMode': return { kind: 'plan', done: 'Started planning', doing: 'Starting to plan' };
    case 'AskUserQuestion': return { kind: 'question', done: 'Asked a question', doing: 'Asking a question',
      detail: ((input.questions as { header?: string }[] | undefined) ?? []).map(question => question.header).filter(Boolean).join(' · ') || undefined };
    case 'Skill': return { kind: 'skill', done: 'Loaded a skill', doing: 'Loading a skill', detail: str(input.skill || input.command) };
    case 'ToolSearch': return { kind: 'tool', done: 'Loaded tools', doing: 'Loading tools', detail: str(input.query) };
    default:
      if (name.startsWith('mcp__')) { const [, server, ...tool] = name.split('__'); const label = tool.join('__') || name; return { kind: 'tool', done: `Used ${label}`, doing: `Using ${label}`, detail: server }; }
      return { kind: 'tool', done: `Used ${name}`, doing: `Using ${name}`, detail: Object.values(input).map(str).find(value => value && value.length < 160) };
  }
}

const plural = (count: number, one: string, many: string) => count === 1 ? one : many.replace('#', String(count));

/** "Read 3 files, edited 2 files and ran a command": the whole group in one line. */
export function summarize(steps: StepEntry[]): string {
  const files = (kind: StepKind) => new Set(steps.filter(step => step.kind === 'tool' && describeStep(step, '').kind === kind)
    .map(step => str((step as ToolEntry).input.file_path || (step as ToolEntry).input.notebook_path) || step.id)).size;
  const count = (kind: StepKind) => steps.filter(step => step.kind === 'tool' && describeStep(step, '').kind === kind).length;
  const parts: string[] = [];
  const add = (n: number, text: string) => { if (n) parts.push(text); };
  add(files('read'), plural(files('read'), 'read a file', 'read # files'));
  add(files('edit'), plural(files('edit'), 'edited a file', 'edited # files'));
  add(files('create'), plural(files('create'), 'created a file', 'created # files'));
  add(count('command'), plural(count('command'), 'ran a command', 'ran # commands'));
  add(count('search'), plural(count('search'), 'searched the code', 'searched the code # times'));
  add(count('web'), plural(count('web'), 'searched the web', 'searched the web # times'));
  add(count('fetch'), plural(count('fetch'), 'read a page', 'read # pages'));
  add(count('agent'), plural(count('agent'), 'ran an agent', 'ran # agents'));
  add(count('plan'), 'updated the plan');
  add(count('question'), 'asked a question');
  add(count('skill'), plural(count('skill'), 'loaded a skill', 'loaded # skills'));
  add(count('tool'), plural(count('tool'), 'used a tool', 'used # tools'));
  if (!parts.length) return steps.some(step => step.kind === 'thinking') ? 'Thought' : 'Worked';
  const shown = parts.length > 3 ? [...parts.slice(0, 2), `${parts.length - 2} more`] : parts;
  const text = shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : shown[0];
  return text[0].toUpperCase() + text.slice(1);
}

/** Lines added and removed by an edit or a new file. */
export function diffStat(entry: ToolEntry): { added: number; removed: number } | null {
  const name = toolName(entry.name), input = entry.input;
  const count = (before: string, after: string) => diffLines(before, after).reduce((total, part) => {
    const lines = part.value.replace(/\n$/, '').split('\n').length;
    if (part.added) total.added += lines; else if (part.removed) total.removed += lines;
    return total;
  }, { added: 0, removed: 0 });
  if (name === 'Edit') return count(str(input.old_string), str(input.new_string));
  if (name === 'MultiEdit') return ((input.edits as { old_string?: string; new_string?: string }[] | undefined) ?? [])
    .map(edit => count(str(edit.old_string), str(edit.new_string))).reduce((a, b) => ({ added: a.added + b.added, removed: a.removed + b.removed }), { added: 0, removed: 0 });
  if (name === 'Write') return { added: str(input.content).split('\n').length, removed: 0 };
  return null;
}

export const duration = (ms: number) => {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

/** Claude Code's WebSearch output is "Links: [{title,url}]" followed by its notes. */
export function parseSearch(result: string): { links: { title: string; url: string }[]; notes: string } {
  const match = /Links:\s*(\[[\s\S]*?\])\s*(?:\n|$)/.exec(result);
  if (!match) return { links: [], notes: result };
  try {
    const parsed = JSON.parse(match[1]) as { title?: unknown; url?: unknown }[];
    const links = parsed.filter(link => typeof link?.url === 'string' && /^https?:\/\//.test(link.url as string))
      .map(link => ({ url: link.url as string, title: typeof link.title === 'string' && link.title ? link.title : link.url as string }));
    const notes = result.slice(match.index + match[0].length).replace(/^\s*REMINDER:[\s\S]*$/m, '').trim();
    return { links, notes };
  } catch { return { links: [], notes: result }; }
}
