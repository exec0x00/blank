import type { ToolActivity } from '../../../shared/types';
import { stripAnsi } from './state';

type ObjectValue = Record<string, unknown>;
export type ToolViewKind = 'command' | 'file' | 'files' | 'search' | 'web' | 'changes' | 'plan' | 'goal' | 'skill' | 'agent' | 'question' | 'image' | 'hook' | 'time' | 'generic';
export interface ToolFact { label: string; value: string }
export interface ToolRow {
  title: string;
  detail?: string;
  path?: string;
  url?: string;
  line?: number;
  column?: number;
  kind?: 'file' | 'directory' | 'symlink';
  badge?: string;
  status?: 'pending' | 'in_progress' | 'completed' | 'error';
  truncated?: boolean;
}
export type ToolSection = (
  | { type: 'code'; title: string; text: string; language?: 'shell' | 'diff'; truncated?: boolean }
  | { type: 'text'; title?: string; text: string; truncated?: boolean }
  | { type: 'facts'; facts: ToolFact[] }
  | { type: 'rows'; title?: string; variant: 'files' | 'search' | 'plan' | 'catalog' | 'agents' | 'sources' | 'queries'; rows: ToolRow[]; omitted?: number; empty?: string }
) & { field?: 'input' | 'output' };
export interface ToolNotice { text: string; kind: 'info' | 'warning' | 'error' }
export interface ToolPresentation {
  kind: ToolViewKind;
  label: string;
  preview: string;
  summary: string;
  status: ToolActivity['status'];
  statusLabel: string;
  sections: ToolSection[];
  notices: ToolNotice[];
  truncated: boolean;
}

const MAX_JSON_CHARS = 2_100_000;
const MAX_CODE_CHARS = 40_000;
const MAX_ROWS = 60;
const COMMAND_TOOLS = new Set(['exec_command', 'wait_command', 'write_stdin', 'shell', 'shell_command']);
const AGENT_TOOLS = new Set(['spawn_agent', 'send_input', 'wait_agent', 'wait', 'list_agents', 'interrupt_agent', 'close_agent', 'resume_agent']);
const OBJECT = (value: unknown): ObjectValue | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : undefined;
const string = (value: unknown): string | undefined => typeof value === 'string' ? stripAnsi(value) : undefined;
const number = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const count = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const words = (value: string): string => value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
const sentence = (value: string): string => { const label = words(value); return label ? label[0].toUpperCase() + label.slice(1) : 'Tool'; };
const human = (value: unknown): string | undefined => typeof value === 'string' && value ? sentence(value) : undefined;
const compact = (value: string | undefined, maximum = 260): string => value ? value.replace(/\s+/g, ' ').trim().slice(0, maximum) : '';
const plural = (amount: number, label: string): string => `${amount.toLocaleString('en-US')} ${amount === 1 ? label : ({ entry: 'entries', 'file entry': 'file entries', match: 'matches' } as Record<string, string>)[label] ?? `${label}s`}`;
const opaque = (value: string): boolean => /^(?:[a-f\d]{32,}|[a-z]+_[a-f\d]{24,}|[0-9a-f]{8}-[0-9a-f-]{27,})$/i.test(value);

/** Recover only observed JSON prefix values. No missing value is filled in.
 * A tool may be streaming, or its persisted envelope may end at the server cap.
 * This deliberately never evaluates output or repairs it into a success result. */
function jsonPrefix(source: string): unknown {
  let index = 0, nodes = 0;
  const whitespace = () => { while (/\s/.test(source[index] ?? '') && index < source.length) index++; };
  const quoted = (): { value: string; complete: boolean } | undefined => {
    if (source[index] !== '"') return undefined;
    index++;
    let start = index;
    const pieces: string[] = [];
    while (index < source.length) {
      const character = source[index++];
      if (character === '"') { pieces.push(source.slice(start, index - 1)); return { value: pieces.join(''), complete: true }; }
      if (character === '\\') {
        pieces.push(source.slice(start, index - 1));
        const escaped = source[index++];
        if (!escaped) return { value: pieces.join(''), complete: false };
        if (escaped === 'u') {
          const hex = source.slice(index, index + 4);
          if (!/^[\da-f]{4}$/i.test(hex)) return { value: pieces.join(''), complete: false };
          pieces.push(String.fromCharCode(parseInt(hex, 16))); index += 4;
        } else {
          const escapes: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
          if (!Object.hasOwn(escapes, escaped)) return { value: pieces.join(''), complete: false };
          pieces.push(escapes[escaped]);
        }
        start = index;
      } else if (character < ' ') return { value: pieces.join('') + source.slice(start, index - 1), complete: false };
    }
    pieces.push(source.slice(start));
    return { value: pieces.join(''), complete: false };
  };
  const parse = (depth: number): { value: unknown; complete: boolean } | undefined => {
    whitespace();
    if (++nodes > 4000 || depth > 12 || index >= source.length) return undefined;
    const character = source[index];
    if (character === '"') return quoted();
    if (character === '{' || character === '[') {
      index++;
      const isArray = character === '[';
      const result: unknown[] | ObjectValue = isArray ? [] : Object.create(null) as ObjectValue;
      const close = isArray ? ']' : '}';
      whitespace();
      if (source[index] === close) { index++; return { value: result, complete: true }; }
      for (let entries = 0; entries < 1600; entries++) {
        whitespace();
        let key: string | undefined;
        if (!isArray) {
          const read = quoted();
          if (!read?.complete) break;
          key = read.value; whitespace();
          if (source[index++] !== ':') break;
        }
        const next = parse(depth + 1);
        if (!next) break;
        if (Array.isArray(result)) result.push(next.value); else result[key!] = next.value;
        if (!next.complete) break;
        whitespace();
        if (source[index] === close) { index++; return { value: result, complete: true }; }
        if (source[index++] !== ',') break;
      }
      return { value: result, complete: false };
    }
    const literal = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=[\s,\]}]|$)/.exec(source.slice(index));
    if (!literal) return undefined;
    index += literal[0].length;
    return { value: JSON.parse(literal[0]) as unknown, complete: true };
  };
  return parse(0)?.value;
}

interface Decoded { value?: unknown; object?: ObjectValue; structured: boolean; incomplete: boolean; raw: string }
function decode(source: string | undefined): Decoded {
  const raw = source ?? '';
  const text = raw.slice(0, MAX_JSON_CHARS).trim();
  const structured = text.startsWith('{') || text.startsWith('[');
  if (!structured) return { raw, structured: false, incomplete: raw.length > MAX_JSON_CHARS };
  try {
    const value: unknown = JSON.parse(text);
    return { raw, value, object: OBJECT(value), structured: true, incomplete: raw.length > MAX_JSON_CHARS };
  } catch {
    const value = jsonPrefix(text);
    return { raw, value, object: OBJECT(value), structured: true, incomplete: true };
  }
}

function resultFailure(name: string, output: Decoded): string | undefined {
  const result = output.object;
  if (!result) return undefined;
  const command = COMMAND_TOOLS.has(name);
  if (command) {
    const channel = [result.output, result.stdout, result.stderr].some(value => typeof value === 'string');
    const state = typeof result.running === 'boolean' || number(result.exit_code ?? result.exitCode) !== undefined;
    if (!(channel && state || output.incomplete && typeof result.output === 'string')) return undefined;
  }
  if (string(result.error) || string(OBJECT(result.error)?.message) || result.ok === false || result.success === false || result.status === 'error' || result.status === 'failed') return 'Failed';
  if (command || name.startsWith('hook:')) {
    const exit = number(result.exit_code ?? result.exitCode);
    if (exit !== undefined && exit !== 0) return `Exit ${exit}`;
    if (string(result.review_error)) return 'Review failed';
  }
  if (AGENT_TOOLS.has(name)) {
    const agents = [...array(result.agents), ...Object.values(OBJECT(result.status) ?? {})];
    if (agents.some(agent => OBJECT(agent)?.status === 'error')) return 'Agent failed';
  }
  return undefined;
}

/** Group summaries use the same failures as the row, without building previews.
 * A nonzero exit, failed child, or failed file review must remain visible when
 * the enclosing turn's output is collapsed. */
export function toolActivityHasFailure(activity: ToolActivity): boolean {
  if (activity.status === 'error') return true;
  if (activity.status !== 'completed') return false;
  return resultFailure(activity.name.replace(/^(?:functions|tools)\./, ''), decode(activity.output)) !== undefined;
}

function clip(value: string, maximum: number, keepTail = false): { text: string; truncated?: boolean } {
  if (value.length <= maximum) return { text: value };
  if (!keepTail) return { text: value.slice(0, maximum), truncated: true };
  const tail = Math.floor(maximum / 3), head = maximum - tail;
  return { text: `${value.slice(0, head)}\n\n… ${plural(value.length - maximum, 'character')} omitted from this preview …\n\n${value.slice(-tail)}`, truncated: true };
}

function bytes(value: number): string {
  return value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function duration(seconds: number): string | undefined {
  if (seconds < 0) return undefined;
  return seconds < 1 ? '<1s' : seconds < 60 ? `${Math.floor(seconds)}s` : `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
}

/** Only real workspace-relative files become editor actions. Absolute paths
 * outside the workspace stay readable, without a misleading navigation target. */
export function workspaceFileTarget(value: string, workspacePath = ''): string | null {
  if (!value || value.length > 4096 || /[\u0000-\u001f\u007f\\]/.test(value) || /^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//')) return null;
  let path = value;
  const root = workspacePath.replace(/\/+$/, '');
  if (path.startsWith('/')) {
    if (!root || !path.startsWith(`${root}/`)) return null;
    path = path.slice(root.length + 1);
  }
  const pieces = path.split('/');
  if (pieces.some(piece => piece === '..')) return null;
  path = pieces.filter(piece => piece && piece !== '.').join('/');
  return path || null;
}

/** Browser boundary for native web-search links. Mirrors the server's public
 * HTTP(S) policy without Node imports, DNS resolution, or automatic requests. */
export function safeWebSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 8192
    || /[\u0000-\u0020\u007f\\]/.test(value) || /%(?:00|0a|0d)/i.test(value)
    || !/^https?:\/\//i.test(value)) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (/^\d+(?:\.\d+){3}$/.test(host)) {
    // WHATWG URL already canonicalizes hexadecimal, octal, and integer IPv4.
    const [a, b, c] = host.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224
      || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254
      || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 2)
      || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)
      || a === 203 && b === 0 && c === 113) return null;
  } else if (host.includes(':')) {
    if (!/^[23]/.test(host) || /^2001:(?::|(?:db8|0)(?::|$))/.test(host)) return null;
  } else if (!host.includes('.') || host.length > 253 || /\.(?:localhost|local|internal|test)$/.test(host)
    || /^(?:localhost|localhost\.localdomain)$/.test(host)
    || !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
  return value;
}

function webSourceRow(url: string, title?: string): ToolRow {
  const parsed = new URL(url);
  const name = clip(title?.trim() || parsed.hostname, 512);
  const location = `${parsed.hostname}${parsed.pathname === '/' ? '' : parsed.pathname}`;
  return { title: name.text, url, ...(location !== name.text ? { detail: location } : {}), ...(name.truncated ? { truncated: true } : {}) };
}

function planRows(value: unknown): ToolRow[] {
  return array(value).flatMap(entry => {
    const step = OBJECT(entry), title = string(step?.step ?? step?.text);
    const status = step?.status === 'inProgress' ? 'in_progress' : step?.status;
    if (!title || typeof status !== 'string' || !['pending', 'in_progress', 'completed'].includes(status)) return [];
    const bounded = clip(title, 1400);
    return [{ title: bounded.text, status: status as ToolRow['status'], ...(bounded.truncated ? { truncated: true } : {}) }];
  });
}

function patchRows(patch: string): ToolRow[] {
  const rows: ToolRow[] = [];
  for (const line of patch.split('\n')) {
    const match = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
    if (match) rows.push({ title: match[2], path: match[2], kind: 'file', badge: match[1] === 'Add' ? 'Add' : match[1] === 'Delete' ? 'Delete' : 'Update' });
    const move = /^\*\*\* Move to: (.+)$/.exec(line);
    if (move && rows.length) rows[rows.length - 1] = { ...rows[rows.length - 1], detail: `Move to ${move[1]}` };
    if (rows.length >= MAX_ROWS + 1) break;
  }
  return rows;
}

function safeName(value: unknown): string {
  const text = string(value);
  return text && !opaque(text) ? compact(text, 180) : '';
}

export function formatToolActivity(activity: ToolActivity): ToolPresentation {
  const name = activity.name.replace(/^(?:functions|tools)\./, '');
  const input = decode(activity.input), output = decode(activity.output);
  const args = input.object ?? {}, result = output.object;
  const done = activity.status === 'completed';
  const pending = activity.status === 'running' || activity.status === 'awaiting_approval' || activity.status === 'awaiting_input';
  const view: ToolPresentation = {
    kind: 'generic', label: sentence(name), preview: '', summary: '', status: activity.status,
    statusLabel: activity.status === 'running' ? 'Running' : activity.status === 'error' ? 'Failed' : activity.status === 'awaiting_approval' ? 'Awaiting approval' : activity.status === 'awaiting_input' ? 'Awaiting your answer' : 'Completed',
    sections: [], notices: [], truncated: !!(activity.inputTruncated || activity.outputTruncated),
  };
  const text = (title: string | undefined, value: unknown, field: 'input' | 'output' = 'output') => {
    const content = string(value);
    if (content) view.sections.push({ type: 'text', title, field, ...clip(content, 12_000) });
  };
  const code = (title: string, value: unknown, language?: 'shell' | 'diff', keepTail = false, field: 'input' | 'output' = 'output') => {
    const content = string(value);
    if (content !== undefined && content.length) view.sections.push({ type: 'code', title, field, ...clip(content, MAX_CODE_CHARS, keepTail), language });
  };
  const facts = (values: Array<[string, unknown]>) => {
    const items = values.flatMap(([label, value]) => value === undefined || value === null || value === '' ? [] : [{ label, value: compact(String(value), 1200) }]);
    if (items.length) view.sections.push({ type: 'facts', facts: items });
  };
  const rows = (variant: Extract<ToolSection, { type: 'rows' }>['variant'], title: string | undefined, items: ToolRow[], empty?: string) => {
    const maximum = variant === 'plan' ? 64 : MAX_ROWS;
    view.sections.push({ type: 'rows', variant, title, rows: items.slice(0, maximum).map(item => {
      const title = clip(item.title, 4096), detail = item.detail ? clip(item.detail, 1800) : undefined;
      return { ...item, title: title.text, ...(detail ? { detail: detail.text } : {}), ...(title.truncated || detail?.truncated ? { truncated: true } : {}) };
    }), omitted: Math.max(0, items.length - maximum) || undefined, empty });
  };
  const notice = (value: unknown, kind: ToolNotice['kind'] = 'warning') => {
    const content = string(value);
    if (content && !view.notices.some(item => item.text === content)) {
      const bounded = clip(content, 4000);
      if (bounded.truncated) view.truncated = true;
      view.notices.push({ text: bounded.text + (bounded.truncated ? '… (Notice truncated.)' : ''), kind });
    }
  };
  const path = string(result?.path) ?? string(args.path ?? args.file_path) ?? '';
  const query = string(args.query ?? args.pattern);
  const knownFile = name === 'read_file' || name === 'read_review_file';
  const commandTool = COMMAND_TOOLS.has(name);
  const hook = name.startsWith('hook:');
  let outputIsEnvelope = !commandTool;

  if (name === 'web_search') {
    view.kind = 'web';
    // Incomplete JSON is not a complete query or URL. Wait for a valid snapshot
    // instead of linking a recovered prefix that may point somewhere else.
    const observed = output.incomplete ? undefined : result;
    const request = input.incomplete ? {} : args;
    const action = [observed?.action, request.action].find(value => value === 'search' || value === 'open_page' || value === 'find_in_page');
    view.label = action === 'search' ? done ? 'Searched the web' : 'Search the web' : action === 'open_page' ? done ? 'Opened web page' : 'Open web page' : action === 'find_in_page' ? done ? 'Searched web page' : 'Find on web page' : 'Web search';
    if (activity.status === 'running') view.statusLabel = observed?.status === 'searching' ? 'Searching' : 'In progress';
    const field = (key: string): unknown => observed && Object.hasOwn(observed, key) ? observed[key] : request[key];
    const rawQueries = array(field('queries'));
    const queries = [...new Set([field('query'), ...rawQueries.slice(0, 32)].flatMap(value => {
      const query = string(value);
      return query?.trim() ? [query] : [];
    }))];
    const pageUrl = safeWebSourceUrl(field('url'));
    const pattern = string(field('pattern'));
    const pageRow = pageUrl ? webSourceRow(pageUrl) : undefined;
    view.preview = compact(action === 'find_in_page' ? pattern : action === 'open_page' ? pageRow?.detail ?? pageRow?.title : queries[0]);
    if (queries.length) rows('queries', queries.length === 1 ? 'Query' : 'Queries', queries.map(title => ({ title })));
    if (rawQueries.length > 32) { notice('More query entries are outside this preview.', 'info'); view.truncated = true; }
    if (action === 'find_in_page' && pattern) rows('queries', 'Text to find', [{ title: pattern }]);
    if (pageRow) rows('sources', 'Page', [pageRow]);
    else if (field('url') !== undefined) { notice('The recorded page address could not be displayed.'); view.truncated = true; }
    const providedSources = array(observed?.sources);
    const seen = new Set<string>();
    let rejected = 0;
    const sources = providedSources.slice(0, 128).flatMap(value => {
      const source = OBJECT(value), url = source?.type === 'url' ? safeWebSourceUrl(source.url) : null;
      if (!url) { rejected++; return []; }
      if (seen.has(url)) return [];
      seen.add(url);
      return [webSourceRow(url, string(source?.title))];
    });
    if (sources.length) {
      rows('sources', 'Sources', sources);
      view.summary = `${plural(sources.length, 'source')}${providedSources.length > 128 ? ' shown' : ''}`;
    } else if (done && Array.isArray(observed?.sources) && !rejected && !output.incomplete) text(undefined, 'No source links were included.');
    if (rejected) { notice(`${plural(rejected, 'source link')} could not be displayed.`); view.truncated = true; }
    if (providedSources.length > 128) { notice(`${plural(providedSources.length - 128, 'source link')} ${providedSources.length - 128 === 1 ? 'is' : 'are'} outside this preview.`, 'info'); view.truncated = true; }
    if (!view.sections.length && !view.notices.length && activity.status !== 'error' && !observed?.error) text(undefined, pending ? 'Search details have not arrived yet.' : 'No query or source details were recorded.');
  } else if (commandTool || hook) {
    view.kind = hook ? 'hook' : 'command';
    const command = string(args.command ?? args.cmd) ?? (Array.isArray(args.command) ? args.command.filter(value => typeof value === 'string').join(' ') : undefined) ?? (!input.structured && activity.input.trim() ? activity.input : undefined);
    const isWait = name === 'wait_command' || name === 'write_stdin' && !args.chars;
    const interrupt = name === 'write_stdin' && args.chars === '\u0003';
    view.label = hook ? `${sentence(name.slice(5))} hook` : name === 'write_stdin' && !isWait ? interrupt ? done ? 'Interrupted command' : 'Interrupt command' : done ? 'Sent command input' : 'Send command input' : isWait ? pending ? 'Wait for command' : 'Command output' : done ? 'Ran command' : 'Run command';
    view.preview = compact(command);
    code('Command', command, 'shell', false, 'input');
    if (name === 'write_stdin' && args.chars && !interrupt) code(done ? 'Input sent' : 'Input to send', args.chars, undefined, false, 'input');
    facts([['Directory', string(args.cwd ?? args.workdir)], ['Hook source', hook ? string(args.source_path ?? args.sourcePath) : undefined]]);
    // JSON emitted by a command is content. Only unwrap an actual process/hook envelope.
    const hasChannel = result && [result.output, result.stdout, result.stderr].some(value => typeof value === 'string');
    const hasProcessState = result && (typeof result.running === 'boolean' || number(result.exit_code ?? result.exitCode) !== undefined);
    const envelope = result && (hasChannel && hasProcessState || output.incomplete && (pending || typeof result.output === 'string') || hook);
    outputIsEnvelope = !!envelope;
    if (envelope) {
      const exit = number(result.exit_code ?? result.exitCode);
      const stdout = string(result.stdout), stderr = string(result.stderr), combined = string(result.output);
      if (stdout !== undefined || stderr !== undefined) {
        code('Standard output', stdout, undefined, true);
        code('Standard error', stderr, undefined, true);
        // A combined channel can include content missing from the separate channels.
        if (!stdout && !stderr) code('Output', combined, undefined, true);
      } else code('Output', combined, undefined, true);
      facts([['Exit code', exit], ['Elapsed', number(result.wall_time_seconds) !== undefined ? duration(result.wall_time_seconds as number) : number(result.duration_ms) !== undefined ? duration((result.duration_ms as number) / 1000) : undefined]]);
      if (done && result.running === true) { view.statusLabel = 'Still running'; view.summary = 'The command was still running when this output was captured.'; }
      if (exit !== undefined && exit !== 0 && !pending) { view.status = 'error'; view.statusLabel = `Exit ${exit}`; view.summary = `Command exited with code ${exit}.`; }
      else if (exit === 0 && !view.summary) view.summary = 'Exit 0';
      if (result.output_suppressed === true) notice('The hook suppressed its output.', 'info');
      if (result.review_pending === true) notice('File changes are still being recorded for review.', 'info');
      notice(result.review_error, 'error');
      notice(result.block_reason);
      notice(result.stop_reason);
      notice(result.permission_message, 'info');
      if (result.permission_decision) facts([['Hook decision', human(result.permission_decision)]]);
      for (const message of array(result.system_messages).slice(0, 10)) notice(message);
    } else if (activity.output) {
      // A completed legacy command may contain a JSON document as its entire stdout.
      code(activity.status === 'error' ? 'Error' : 'Output', activity.output, undefined, true);
    }
    if (!activity.output) text(undefined, activity.status === 'awaiting_approval' ? 'Review the command in the approval request to continue.' : pending ? 'Waiting for output…' : done ? 'Completed without output.' : 'No output was recorded.');
    else if (envelope && !string(result.output) && !string(result.stdout) && !string(result.stderr) && !result.error && result.output_suppressed !== true) text(undefined, result.running === true ? 'No new output yet.' : pending || output.incomplete ? 'Waiting for output…' : 'No command output.');
  } else if (name === 'list_file_attachments') {
    view.kind = 'files'; view.label = done ? 'Listed attachments' : 'List attachments'; view.preview = 'Conversation files';
    const attachments = array(result?.attachments).flatMap(entry => {
      const item = OBJECT(entry), title = string(item?.name), size = count(item?.bytes);
      return title ? [{ title, kind: 'file' as const, detail: string(item?.mimeType), badge: size !== undefined ? bytes(size) : undefined }] : [];
    });
    if (Array.isArray(result?.attachments)) {
      const total = count(result.total);
      const malformed = result.attachments.length - attachments.length;
      if (malformed) { notice(`${plural(malformed, 'attachment')} could not be displayed.`); view.truncated = true; }
      view.summary = total !== undefined && total > attachments.length ? `${attachments.length} of ${plural(total, 'attachment')}` : plural(attachments.length, 'attachment');
      // An attached snapshot is not a workspace path until explicitly copied.
      rows('files', 'Attached files', attachments, output.incomplete || malformed ? undefined : 'No files are attached to this conversation.');
    }
    if (count(result?.nextOffset) !== undefined) notice('More attached files are available.', 'info');
    notice(result?.notice, 'info');
  } else if (name === 'read_file_attachment') {
    const attachment = OBJECT(result?.attachment), size = count(attachment?.bytes), offset = count(result?.offset), read = count(result?.bytesRead), total = count(result?.totalBytes);
    view.kind = 'file'; view.label = result?.format === 'binary' && done ? 'Inspected attachment' : activity.status === 'running' ? 'Reading attachment' : 'Read attachment';
    view.preview = compact(string(attachment?.name)) || 'Conversation attachment';
    facts([['File type', string(attachment?.mimeType)], ['File size', size !== undefined ? bytes(size) : undefined], ['Bytes read', read !== undefined ? bytes(read) : undefined]]);
    if (offset !== undefined && read !== undefined && total !== undefined) view.summary = total === 0 ? 'Empty file' : read > 0 ? `Bytes ${offset + 1}–${offset + read} of ${total.toLocaleString('en-US')}` : 'No bytes returned';
    if (result?.format === 'utf8') {
      code('Attachment text', result.content);
      if (result.content === '') text(undefined, total === 0 ? 'This file is empty.' : 'No text was returned for this range.');
    } else if (result?.format === 'binary') {
      // Original binary bytes remain available through the attachment inspector;
      // a hex block is not a readable document and never fills the transcript.
      text('File inspection', 'Binary bytes were read. Document contents have not been parsed.');
    }
    notice(result?.notice, 'info');
  } else if (name === 'copy_file_attachment' || name === 'copy_generated_image') {
    const generated = name === 'copy_generated_image';
    const attachment = OBJECT(generated ? result?.image : result?.attachment), review = OBJECT(result?.review), size = count(attachment?.bytes);
    const copied = done && typeof result?.path === 'string' && !output.incomplete && !resultFailure(name, output);
    view.kind = 'changes'; view.label = generated ? copied ? 'Copied generated image' : 'Copy generated image' : copied ? 'Copied attachment' : 'Copy attachment'; view.preview = compact(path);
    if (path) rows('files', copied ? 'Copied file' : 'Proposed destination', [{ title: path, path: copied ? path : undefined, kind: 'file', badge: copied ? 'Copied' : 'Proposed' }]);
    facts([[generated ? 'Image' : 'Attachment', string(attachment?.name)], ['File size', size !== undefined ? bytes(size) : undefined], ['Undo', review?.undoAvailable === false ? 'Unavailable' : review?.undoAvailable === true ? 'Available in change review' : undefined]]);
    if (copied) view.summary = 'Copied to workspace';
    if (review?.undoAvailable === false) notice(review.notice || 'Undo is not available for this copied file.');
    else notice(review?.notice, 'info');
  } else if (knownFile) {
    view.kind = 'file'; view.label = activity.status === 'running' ? 'Reading file' : 'Read file'; view.preview = compact(path);
    if (path) rows('files', undefined, [{ title: path, path, kind: 'file' }]);
    const content = string(result?.content);
    const offset = count(result?.offset) ?? count(args.offset) ?? 1;
    const total = count(result?.total_lines ?? result?.totalLines);
    const emptyFile = content === '' && (total === 0 || total === 1 && offset === 1);
    const blankLine = content === '' && !emptyFile && total !== undefined && offset <= total;
    const lines = content === undefined ? undefined : content.length ? content.split('\n').length : blankLine ? 1 : 0;
    view.summary = lines ? `Lines ${offset}–${offset + lines - 1}${total !== undefined ? ` of ${total.toLocaleString('en-US')}` : ''}` : emptyFile ? 'Empty file' : lines === 0 ? 'No lines returned' : '';
    facts([['Snapshot', human(result?.source)], ['Side', human(result?.side)]]);
    code(activity.status === 'error' && content === undefined ? 'Error' : 'File content', content ?? (!output.structured ? activity.output : undefined));
    if (content === '') text(undefined, emptyFile ? 'This file is empty.' : blankLine ? 'This line is blank.' : 'No text was returned for this range.');
    const instructions = array(result?.instructions).flatMap(entry => { const item = OBJECT(entry); const location = string(item?.path); return location ? [{ title: location, path: location, kind: 'file' as const }] : []; });
    if (instructions.length) rows('files', 'Project guidance', instructions);
  } else if (name === 'list_files') {
    view.kind = 'files'; view.label = done ? 'Explored files' : 'Explore files'; view.preview = compact(string(args.path)) || 'Workspace';
    const files = array(result?.files).flatMap(entry => {
      const item = OBJECT(entry), location = string(item?.path) ?? (typeof entry === 'string' ? entry : undefined);
      if (!location) return [];
      const directory = item?.kind === 'directory';
      return [{ title: location, path: directory ? undefined : location, kind: item?.isSymlink ? 'symlink' as const : directory ? 'directory' as const : 'file' as const, badge: directory ? 'Folder' : item?.isSymlink ? 'Link' : count(item?.size) !== undefined ? bytes(item!.size as number) : undefined }];
    });
    if (Array.isArray(result?.files)) {
      const malformed = result.files.length - files.length;
      if (malformed) { notice(`${plural(malformed, 'file entry')} could not be displayed.`); view.truncated = true; }
      view.summary = output.incomplete && !files.length ? 'Receiving file entries…' : plural(files.length, 'entry');
      rows('files', undefined, files, output.incomplete || malformed ? undefined : 'This directory is empty.');
    }
    facts([['Folder', string(args.path) || 'Workspace root'], ['Include subfolders', args.recursive === true ? 'Yes' : undefined]]);
  } else if (name === 'search_files') {
    view.kind = 'search'; view.label = done ? 'Searched workspace' : 'Search workspace'; view.preview = compact(query);
    const matches = array(result?.matches).flatMap(entry => {
      const item = OBJECT(entry), location = string(item?.path), line = count(item?.line);
      return location ? [{ title: location, path: location, line: line && line > 0 ? line : undefined, column: count(item?.column), detail: string(item?.text ?? item?.lineText ?? item?.content), kind: 'file' as const, badge: line ? `Line ${line}` : undefined }] : [];
    });
    if (Array.isArray(result?.matches)) {
      const files = new Set(matches.map(item => item.path)).size;
      const malformed = result.matches.length - matches.length;
      if (malformed) { notice(`${plural(malformed, 'search result')} could not be displayed.`); view.truncated = true; }
      view.summary = output.incomplete && !matches.length ? 'Receiving search matches…' : `${plural(matches.length, 'match')}${files ? ` in ${plural(files, 'file')}` : ''}`;
      rows('search', 'Matches', matches, output.incomplete || malformed ? undefined : 'No matches found.');
    }
    facts([['Search', query], ['In', string(args.include)], ['Match', args.regex === true ? 'Regular expression' : undefined], ['Case sensitive', args.case_sensitive === true ? 'Yes' : undefined]]);
    if (result?.note) text(undefined, result.note);
  } else if (name === 'write_file' || name === 'apply_patch' || name === 'get_review_diff') {
    view.kind = 'changes';
    const review = name === 'get_review_diff';
    view.label = review ? 'Review diff' : done ? 'Edited files' : 'Edit files';
    const patch = string(args.patch) ?? (!input.structured && name === 'apply_patch' ? activity.input : undefined);
    const changed = array(review ? result?.files : result?.changed).flatMap(entry => {
      const item = OBJECT(entry), location = string(item?.path);
      return location ? [{ title: location, path: item?.operation === 'deleted' || item?.change === 'deleted' ? undefined : location, kind: 'file' as const, badge: sentence(string(item?.operation ?? item?.change) ?? 'changed') }] : [];
    });
    const proposed = name === 'write_file' && path ? [{ title: path, path, kind: 'file' as const, badge: done && result?.path ? 'Saved' : 'Proposed' }] : patch ? patchRows(patch) : [];
    const files = changed.length ? changed : proposed;
    view.preview = files.length === 1 ? compact(files[0].title) : files.length ? plural(files.length, 'file') : compact(path);
    if (files.length) rows('files', !review && !done ? 'Proposed changes' : undefined, files);
    if (changed.length) view.summary = plural(changed.length, 'file');
    facts([['Saved size', count(result?.bytes) !== undefined ? bytes(result!.bytes as number) : undefined]]);
    if (review) {
      for (const file of array(result?.files).slice(0, 12)) { const item = OBJECT(file); code(string(item?.path) ?? 'Diff', item?.diff, 'diff'); }
      if (array(result?.files).length > 12) notice('Showing patches for the first 12 files. Open the remaining files from the review panel.', 'info');
    } else { code(done && result ? 'Patch' : 'Proposed patch', patch, 'diff', false, 'input'); code(done && result ? 'File content' : 'Proposed file content', args.content, undefined, false, 'input'); }
  } else if (name === 'update_plan') {
    view.kind = 'plan'; view.label = 'Plan';
    const steps = planRows(result?.steps ?? result?.plan ?? args.steps ?? args.plan);
    const completed = steps.filter(step => step.status === 'completed').length;
    view.summary = steps.length ? `${completed} of ${steps.length} completed` : '';
    if (done && steps.length && completed < steps.length) view.statusLabel = 'Updated';
    text(undefined, result?.explanation ?? args.explanation);
    if (steps.length) rows('plan', undefined, steps);
  } else if (['create_goal', 'get_goal', 'update_goal'].includes(name)) {
    view.kind = 'goal'; view.label = name === 'get_goal' ? 'Goal' : name === 'create_goal' ? done ? 'Created goal' : 'Create goal' : done ? 'Updated goal' : 'Update goal';
    const goal = OBJECT(result?.goal);
    const objective = string(goal?.objective ?? args.objective);
    view.preview = compact(objective);
    text('Objective', objective);
    if (goal) {
      if (done && typeof goal.status === 'string') view.statusLabel = sentence(goal.status);
      facts([['Status', human(goal.status)], ['Tokens used', count(goal.tokensUsed)?.toLocaleString('en-US')], ['Token budget', count(goal.tokenBudget)?.toLocaleString('en-US')], ['Tokens remaining', count(result?.remainingTokens)?.toLocaleString('en-US')], ['Active time', number(goal.timeUsedSeconds) !== undefined ? duration(goal.timeUsedSeconds as number) : undefined]]);
      if (goal.usageIncomplete === true) notice('Some provider usage is unavailable. Token usage is a lower bound.');
      if (typeof goal.continuationBlockedReason === 'string') notice(`Continuation stopped: ${words(goal.continuationBlockedReason)}.`);
    } else if (result?.goal === null) text(undefined, 'No goal is set for this thread.');
  } else if (['list_skills', 'list_plugins', 'load_skill', 'read_skill_resource', 'list_workflows'].includes(name)) {
    view.kind = 'skill';
    const catalog = name === 'list_skills' || name === 'list_plugins' || name === 'list_workflows';
    const noun = name === 'list_plugins' ? 'plugins' : name === 'list_workflows' ? 'workflows' : 'skills';
    view.label = catalog ? done ? `Found ${noun}` : `Discover ${noun}` : name === 'load_skill' ? done ? 'Loaded skill' : 'Load skill' : 'Read skill resource';
    const skill = OBJECT(result?.skill);
    view.preview = compact(string(skill?.displayName ?? skill?.name) || safeName(args.skill) || query);
    if (catalog) {
      view.preview = compact(query);
      const entries = array(result?.[noun]);
      if (Array.isArray(result?.[noun])) {
        view.summary = `${entries.length}${count(result?.total) !== undefined && result?.total !== entries.length ? ` of ${result.total}` : ''} ${entries.length === 1 ? noun.slice(0, -1) : noun}`;
        rows('catalog', undefined, entries.flatMap(entry => {
          const item = OBJECT(entry), title = safeName(item?.displayName ?? item?.name);
          if (!title) return [];
          return [{ title, detail: string(item?.description), badge: item?.enabled === false ? 'Disabled' : human(item?.scope) }];
        }), output.incomplete ? undefined : `No ${noun} found.`);
        for (const entry of entries.slice(0, MAX_ROWS)) for (const warning of array(OBJECT(entry)?.warnings).slice(0, 3)) notice(warning);
      }
    } else {
      text(undefined, skill?.description);
      facts([['Skill', safeName(skill?.name) || safeName(args.skill)], ['Resource', name === 'read_skill_resource' ? path : string(skill?.path)], ['Scope', human(skill?.scope)]]);
      code(name === 'load_skill' ? 'Skill instructions' : 'Resource content', result?.content);
      const resources = array(result?.resources).flatMap(entry => { const item = OBJECT(entry); const location = string(item?.path); return location ? [{ title: location, kind: item?.kind === 'directory' ? 'directory' as const : 'file' as const }] : []; });
      if (resources.length) rows('files', 'Skill resources', resources);
      for (const warning of array(skill?.warnings).slice(0, 5)) notice(warning);
    }
    if (number(result?.nextOffset) !== undefined) { notice(catalog ? 'More results are available.' : 'Only part of this document was returned. More content is available.', 'info'); if (!catalog) view.truncated = true; }
    if (result?.resourcesTruncated === true) { notice('The skill resource list was truncated.'); view.truncated = true; }
    for (const issue of array(result?.issues).slice(0, 10)) notice(OBJECT(issue)?.message);
  } else if (AGENT_TOOLS.has(name)) {
    view.kind = 'agent';
    const labels: Record<string, [string, string]> = { spawn_agent: ['Delegate task', 'Delegated task'], send_input: ['Message agent', 'Messaged agent'], wait_agent: ['Waiting for agents', 'Agent results'], wait: ['Waiting for agents', 'Agent results'], list_agents: ['Check agents', 'Agent activity'], interrupt_agent: ['Interrupt agent', 'Interrupted agent'], close_agent: ['Close agent', 'Closed agent'], resume_agent: ['Resume agent', 'Resumed agent'] };
    view.label = labels[name][done ? 1 : 0];
    view.preview = safeName(result?.nickname) || safeName(args.task_name) || safeName(args.target ?? args.id);
    text(name === 'send_input' ? 'Message' : 'Assigned task', args.message, 'input');
    facts([['Role', safeName(args.agent_type)], ['Model', safeName(args.model)], ['Reasoning', safeName(args.reasoning_effort)]]);
    const agents = array(result?.agents).flatMap(entry => {
      const item = OBJECT(entry), title = safeName(item?.nickname) || safeName(item?.taskName) || safeName(item?.path);
      return title ? [{ title, badge: human(item?.status), detail: string(item?.error ?? item?.finalMessage) }] : [];
    });
    const results = OBJECT(result?.status);
    if (results) {
      let index = 0;
      for (const [target, value] of Object.entries(results).slice(0, MAX_ROWS)) {
        const item = OBJECT(value); if (!item) continue;
        const title = safeName(item.nickname ?? item.path) || (target.startsWith('/') ? safeName(target) : '') || `Agent result ${++index}`;
        agents.push({ title, badge: sentence(string(item.status) ?? 'Result'), detail: string(item.error ?? item.finalMessage) });
      }
    }
    if (agents.length || Array.isArray(result?.agents)) { rows('agents', undefined, agents, 'No agents in this thread.'); view.summary = plural(agents.length, 'agent'); }
    if (typeof result?.status === 'string') facts([['Agent status', sentence(result.status)]]);
    if (typeof result?.previous_status === 'string') facts([['Previous status', sentence(result.previous_status)]]);
    if (result?.timed_out === true) { view.summary = 'No agent finished during this wait.'; notice('The wait ended without a result. Agents may still be working.', 'info'); }
    if (done && name === 'send_input' && result?.submission_id) text(undefined, 'Message accepted for the agent.');
  } else if (name === 'request_user_input') {
    view.kind = 'question'; view.label = activity.status === 'awaiting_input' ? 'Waiting for your answer' : 'Question';
    const questions = array(args.questions).flatMap(entry => { const item = OBJECT(entry); const question = string(item?.question); return question ? [{ title: question, badge: string(item?.header) }] : []; });
    if (questions.length) rows('catalog', undefined, questions);
    const answers = OBJECT(result?.answers);
    if (answers) {
      const entries = array(args.questions).flatMap(entry => {
        const question = OBJECT(entry), answer = typeof question?.id === 'string' ? OBJECT(answers[question.id]) : undefined;
        const values = array(answer?.answers).filter((value): value is string => typeof value === 'string');
        return values.length ? [{ title: string(question?.header ?? question?.question) || 'Your answer', detail: values.join('\n') }] : [];
      });
      if (entries.length) rows('catalog', 'Your answers', entries);
    }
    if (activity.status === 'awaiting_input') text(undefined, 'Use the question form to continue.');
  } else if (name === 'generate_image' || name === 'read_generated_image') {
    const generating = name === 'generate_image';
    const image = OBJECT(result?.image), size = count(image?.bytes), width = count(image?.width), height = count(image?.height);
    const complete = done && result?.status === 'completed' && !output.incomplete && !resultFailure(name, output);
    view.kind = 'image';
    view.label = generating ? complete ? 'Generated image' : activity.status === 'running' ? 'Generating image' : 'Generate image'
      : complete ? 'Read generated image' : activity.status === 'running' ? 'Reading generated image' : 'Read generated image';
    if (activity.status === 'running') view.statusLabel = result?.status === 'saving' ? 'Saving' : generating ? 'Generating' : 'Reading';
    if (generating && !input.incomplete) text('Image prompt', args.prompt, 'input');
    facts([['Dimensions', width && height ? `${width.toLocaleString('en-US')} × ${height.toLocaleString('en-US')}` : undefined],
      ['Format', image?.mimeType === 'image/png' ? 'PNG' : image?.mimeType === 'image/jpeg' ? 'JPEG' : image?.mimeType === 'image/webp' ? 'WebP' : undefined],
      ['File size', size !== undefined ? bytes(size) : undefined]]);
    notice(result?.notice, 'info');
    if (activity.status === 'running' && !result?.notice) text(undefined, generating ? 'Waiting for the image service…' : 'Loading the saved image…');
  } else if (name === 'list_generated_images') {
    view.kind = 'image'; view.label = done ? 'Listed generated images' : 'List generated images';
    const offset = count(result?.offset) ?? 0;
    const returned = array(result?.images);
    const images = returned.slice(0, MAX_ROWS).flatMap((entry, index) => {
      const item = OBJECT(entry), size = count(item?.bytes), width = count(item?.width), height = count(item?.height);
      const format = item?.mimeType === 'image/png' ? 'PNG' : item?.mimeType === 'image/jpeg' ? 'JPEG' : item?.mimeType === 'image/webp' ? 'WebP' : undefined;
      if (!format || !size || size > 8 * 1024 * 1024 || !width || !height || width > 16_384 || height > 16_384 || width * height > 40_000_000) return [];
      const prompt = string(item?.revisedPrompt);
      return [{ title: `Image ${offset + index + 1}`, detail: [format, `${width.toLocaleString('en-US')} × ${height.toLocaleString('en-US')}`, prompt ? compact(prompt, 500) : undefined].filter(Boolean).join(' · '), badge: bytes(size) }];
    });
    if (Array.isArray(result?.images)) {
      const total = count(result.total), rejected = Math.min(returned.length, MAX_ROWS) - images.length;
      view.summary = total !== undefined && total > images.length ? `${images.length} of ${plural(total, 'image')}` : plural(images.length, 'image');
      rows('catalog', 'Generated images', images, output.incomplete || rejected ? undefined : 'No generated images were returned for this conversation.');
      if (rejected) { notice(`${plural(rejected, 'image')} could not be displayed.`); view.truncated = true; }
      if (returned.length > MAX_ROWS) { notice(`${plural(returned.length - MAX_ROWS, 'image')} outside this preview.`, 'info'); view.truncated = true; }
    }
    if (count(result?.nextOffset) !== undefined) notice('More generated images are available.', 'info');
    notice(result?.notice, 'info');
  } else if (name === 'view_image') {
    view.kind = 'image'; view.label = done ? 'Viewed image' : 'View image'; view.preview = compact(path);
    if (path) rows('files', undefined, [{ title: path, path, kind: 'file' }]);
    facts([['Dimensions', count(result?.width) && count(result?.height) ? `${result?.width} × ${result?.height}` : undefined], ['Detail', safeName(result?.detail ?? args.detail)]]);
  } else if (name === 'current_time' || name === 'sleep') {
    view.kind = 'time'; view.label = name === 'current_time' ? 'Checked time' : pending ? 'Waiting' : 'Wait finished';
    if (name === 'current_time') { view.preview = compact(string(result?.current_time)); text('Host time', result?.current_time); }
    else {
      facts([['Requested wait', number(args.duration_ms) !== undefined ? duration((args.duration_ms as number) / 1000) : undefined], ['Elapsed', number(result?.wall_time_seconds) !== undefined ? duration(result!.wall_time_seconds as number) : undefined]]);
      if (result?.interrupted_by_input === true) text(undefined, 'The wait ended early because new input arrived.');
    }
  } else {
    // Unknown tools still get a useful semantic result, without a protocol dump.
    view.preview = compact(string(args.path ?? args.query ?? args.description ?? args.task));
    facts([['File', string(args.path ?? args.file_path)], ['Search', string(args.query ?? args.pattern)]]);
    text('Request', args.message ?? args.description, 'input');
    if (!output.structured) code(activity.status === 'error' ? 'Error' : 'Result', activity.output, undefined, true);
    else {
      text('Result', result?.summary ?? result?.message ?? result?.description ?? result?.text ?? result?.detail);
      code('Output', result?.output, undefined, true);
      code('Content', result?.content);
      const values: Array<[string, unknown]> = [];
      for (const key of ['status', 'count', 'total', 'ok', 'success', 'available', 'bytes', 'size']) {
        const value = result?.[key];
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') values.push([sentence(key), typeof value === 'boolean' ? value ? 'Yes' : 'No' : value]);
      }
      const payload = result?.data ?? result?.value ?? result?.result;
      if (typeof payload === 'string') text('Result', payload);
      else if (typeof payload === 'number' && Number.isFinite(payload) || typeof payload === 'boolean') values.push(['Result', String(payload)]);
      facts(values);
      const items = Array.isArray(output.value) ? output.value : array(result?.items ?? result?.results);
      if (items.length) rows('catalog', 'Results', items.flatMap(item => {
        if (typeof item === 'string' || typeof item === 'number' && Number.isFinite(item) || typeof item === 'boolean') return [{ title: String(item) }];
        const value = OBJECT(item), title = safeName(value?.title ?? value?.name ?? value?.path);
        return title ? [{ title, detail: string(value?.description ?? value?.message ?? value?.summary) }] : [];
      }));
      if (!view.sections.length && activity.output && !result?.error) text(undefined, pending ? 'Receiving tool details…' : 'The tool returned structured data with no displayable summary.');
    }
  }

  const error = outputIsEnvelope ? string(result?.error) ?? string(OBJECT(result?.error)?.message) : undefined;
  if (error) { notice(error, 'error'); if (!pending) { view.status = 'error'; view.statusLabel = 'Failed'; } }
  if (activity.status === 'error' && !commandTool && !hook && !output.structured && activity.output && !view.sections.some(section => (section.type === 'text' || section.type === 'code') && section.text === stripAnsi(activity.output!))) text('Error', activity.output);
  if (!pending && outputIsEnvelope && (result?.ok === false || result?.success === false || result?.status === 'error' || result?.status === 'failed')) { view.status = 'error'; view.statusLabel = 'Failed'; }
  const failure = done ? resultFailure(name, output) : undefined;
  if (failure) {
    view.status = 'error'; view.statusLabel = failure;
    if (failure === 'Review failed') view.summary = 'Changes could not be recorded for review.';
    if (failure === 'Agent failed') view.summary = 'A delegated agent reported an error.';
  }
  if (view.status === 'error' && !view.summary) view.summary = 'This step failed.';
  if (outputIsEnvelope) {
    for (const warning of [...array(result?.warnings), ...array(result?.review_warnings)].slice(0, 12)) notice(typeof warning === 'string' ? warning : OBJECT(warning)?.message);
    if (result?.truncated === true || result?.output_truncated === true) notice('The tool returned a truncated result.');
    if (output.structured && output.incomplete) notice(pending ? 'Result details are still arriving.' : 'The recorded result is incomplete or truncated. Only available details are shown.', pending ? 'info' : 'warning');
  }
  if (input.structured && input.incomplete) notice(pending ? 'Tool details are still arriving.' : 'Some recorded request details are incomplete.', pending ? 'info' : 'warning');
  if (view.sections.some(section => (section.type === 'code' || section.type === 'text') && section.truncated || section.type === 'rows' && (section.omitted || section.rows.some(row => row.truncated)))) view.truncated = true;
  view.truncated ||= outputIsEnvelope && (result?.truncated === true || result?.output_truncated === true || output.incomplete);
  if (!view.sections.length && !view.notices.length) text(undefined, activity.status === 'awaiting_approval' ? 'Waiting for your approval.' : activity.status === 'awaiting_input' ? 'Waiting for your answer.' : pending ? 'Waiting for the result…' : done ? 'Completed without output.' : 'No further details were recorded.');
  return view;
}
