import type { ToolActivity } from '../../shared/types';

export const TOOL_DETAIL_PRESENTATION_VERSION = 'readable-tool-details-v1';
type ObjectValue = Record<string, unknown>;
export interface ToolDetailPart {
  id: string; label: string; kind: 'text' | 'code' | 'path'; text: string;
  language?: 'shell' | 'diff'; path?: string;
}
export interface ToolDetailDocument { parts: ToolDetailPart[]; defaultPartId: string; notices: string[] }
interface Parsed { value?: unknown; object?: ObjectValue; structured: boolean; complete: boolean; tail?: string }

const COMMANDS = new Set(['exec_command', 'shell_command', 'shell', 'wait_command', 'write_stdin']);
const FILE_READERS = new Set(['read_file', 'read_review_file', 'read_file_attachment', 'read_skill_resource', 'load_skill']);
const PRIVATE_FIELDS = new Set(['encrypted_content', 'encryptedcontent', 'private_reasoning', 'privatereasoning',
  'reasoning_content', 'reasoningcontent', 'chain_of_thought', 'chainofthought', 'modelcontent', 'model_content']);
const object = (value: unknown): ObjectValue | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : undefined;
const string = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
const own = (value: ObjectValue, key: string) => Object.hasOwn(value, key);
const privateObject = (value: ObjectValue) => value.type === 'reasoning';
const displayPath = (value: unknown) => typeof value === 'string' && value.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(value) ? value : undefined;
const label = (key: string) => {
  const value = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  return value ? value[0].toUpperCase() + value.slice(1) : 'Value';
};
const prefix = (value: string, limit: number) => {
  let end = Math.min(value.length, limit);
  if (end < value.length && /[\ud800-\udbff]/.test(value[end - 1] ?? '') && /[\udc00-\udfff]/.test(value[end] ?? '')) end--;
  return value.slice(0, end);
};

/** Recover observed fields from old bounded/incomplete public captures. Never
 * invent a closing value, execute text, or treat an incomplete token as fact. */
function jsonPrefix(source: string): { value?: unknown; complete: boolean; end: number } {
  let index = 0, nodes = 0;
  const whitespace = () => { while (index < source.length && /\s/.test(source[index])) index++; };
  function quoted(): { value: string; complete: boolean } | undefined {
    if (source[index] !== '"') return;
    index++; let start = index;
    const pieces: string[] = [];
    while (index < source.length) {
      const character = source[index++];
      if (character === '"') { pieces.push(source.slice(start, index - 1)); return { value: pieces.join(''), complete: true }; }
      if (character === '\\') {
        pieces.push(source.slice(start, index - 1));
        const escaped = source[index++];
        if (escaped === 'u') {
          const hex = source.slice(index, index + 4);
          if (!/^[a-f0-9]{4}$/i.test(hex)) return { value: completeCharacters(pieces.join('')), complete: false };
          pieces.push(String.fromCharCode(parseInt(hex, 16))); index += 4;
        } else {
          const escapes: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
          if (!escaped || !Object.hasOwn(escapes, escaped)) return { value: completeCharacters(pieces.join('')), complete: false };
          pieces.push(escapes[escaped]);
        }
        start = index;
      } else if (character < ' ') {
        pieces.push(source.slice(start, index - 1)); return { value: completeCharacters(pieces.join('')), complete: false };
      }
    }
    pieces.push(source.slice(start));
    return { value: completeCharacters(pieces.join('')), complete: false };
  }
  const parse = (depth: number): { value: unknown; complete: boolean } | undefined => {
    whitespace();
    if (++nodes > 32_768 || depth > 32 || index >= source.length) return;
    if (source[index] === '"') return quoted();
    const start = source[index];
    if (start === '{' || start === '[') {
      index++;
      const array = start === '[', close = array ? ']' : '}';
      const value: unknown[] | ObjectValue = array ? [] : Object.create(null) as ObjectValue;
      whitespace(); if (source[index] === close) { index++; return { value, complete: true }; }
      for (;;) {
        whitespace(); let key: string | undefined;
        if (!array) {
          const name = quoted(); if (!name?.complete) break;
          key = name.value; whitespace(); if (source[index++] !== ':') break;
        }
        const child = parse(depth + 1); if (!child) break;
        if (Array.isArray(value)) value.push(child.value); else value[key!] = child.value;
        if (!child.complete) break;
        whitespace();
        if (source[index] === close) { index++; return { value, complete: true }; }
        if (source[index++] !== ',') break;
      }
      return { value, complete: false };
    }
    const literal = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=[\s,\]}]|$)/.exec(source.slice(index));
    if (!literal) return;
    // An unfinished numeric token could still gain digits. It cannot establish
    // an exit code/count merely because the saved envelope ended there.
    if (depth > 0 && index + literal[0].length === source.length && /^-?\d/.test(literal[0])) return;
    index += literal[0].length;
    return { value: JSON.parse(literal[0]), complete: true };
  };
  const result = parse(0);
  return { value: result?.value, complete: result?.complete ?? false, end: index };
}

function completeCharacters(value: string): string {
  return /[\ud800-\udbff]$/.test(value) ? value.slice(0, -1) : value;
}

function parseSaved(source: string): Parsed {
  const text = source.trimStart();
  const structured = /^\{\s*(?:"|\}|$)/.test(text) || /^\[\s*(?:["{\[\]\d]|-(?:\d|$)|true|false|null|$)/.test(text);
  if (!structured) return { structured: false, complete: true };
  try { const value: unknown = JSON.parse(text); return { value, object: object(value), structured: true, complete: true }; }
  catch {
    const parsed = jsonPrefix(text), tail = parsed.complete ? text.slice(parsed.end).trim() : '';
    return { value: parsed.value, object: object(parsed.value), structured: true, complete: parsed.complete,
      ...(tail ? { tail } : {}) };
  }
}

function containsPrivateFields(value: unknown): boolean {
  const pending = [value]; let examined = 0;
  while (pending.length) {
    if (++examined > 32_768) return true;
    const next = pending.pop(), record = object(next);
    if (Array.isArray(next)) { pending.push(...next.slice(0, 32_768 - examined)); continue; }
    if (!record) continue;
    if (privateObject(record)) return true;
    for (const [key, child] of Object.entries(record)) {
      if (PRIVATE_FIELDS.has(key.toLowerCase())) return true;
      if (child && typeof child === 'object') pending.push(child);
    }
  }
  return false;
}

/** Human labels retain observed data; they are not JSON/protocol serialization.
 * A fixed traversal budget guards pathological legacy objects, with an honest
 * notice. Actual large code/command/channel strings are separate exact parts. */
function readable(value: unknown, notices: string[], excluded: ReadonlySet<string> = new Set()): string {
  const pieces: string[] = []; let nodes = 0, limited = false, privateFields = false;
  const visit = (item: unknown, name: string, depth: number) => {
    if (++nodes > 32_768 || depth > 32) { limited = true; return; }
    const valueObject = object(item), indent = '  '.repeat(Math.min(depth, 8));
    if (valueObject && privateObject(valueObject)) { privateFields = true; return; }
    if (typeof item === 'string' || typeof item === 'number' && Number.isFinite(item) || typeof item === 'boolean' || item === null) {
      const text = item === null ? 'Not specified' : typeof item === 'boolean' ? item ? 'Yes' : 'No' : String(item);
      pieces.push(name ? `${indent}${name}:${typeof item === 'string' && item.includes('\n') ? '\n' : ' '}${text}\n` : `${text}\n`);
      return;
    }
    if (Array.isArray(item)) {
      if (name) pieces.push(`${indent}${name}${item.length ? ':' : ': None recorded'}\n`);
      for (let index = 0; index < item.length && !limited; index++) visit(item[index], `Item ${index + 1}`, depth + 1);
      return;
    }
    if (!valueObject) return;
    if (name) pieces.push(`${indent}${name}:\n`);
    for (const [key, child] of Object.entries(valueObject)) {
      if (depth === 0 && !name && excluded.has(key)) continue;
      if (PRIVATE_FIELDS.has(key.toLowerCase())) { privateFields = true; continue; }
      if (limited) break;
      visit(child, prefix(label(key), 200), depth + (name ? 1 : 0));
    }
  };
  visit(value, '', 0);
  if (limited) notices.push('Some deeply nested or numerous metadata fields could not be formatted. The saved tool record is unchanged.');
  if (privateFields) notices.push('Private or encrypted reasoning fields are excluded from this view.');
  return pieces.join('').trimEnd();
}

export function toolDetailDocument(activity: ToolActivity, field: 'input' | 'output'): ToolDetailDocument | undefined {
  const raw = activity[field]; if (raw === undefined) return;
  const name = activity.name.replace(/^(?:functions|tools)\./, ''), parsed = parseSaved(raw);
  const data = parsed.object && !privateObject(parsed.object) ? parsed.object : undefined;
  const notices: string[] = [], parts: ToolDetailPart[] = [], excluded = new Set<string>();
  let metadataValue: unknown = data ?? parsed.value;
  const request = field === 'output' ? parseSaved(activity.input).object : data;
  const file = displayPath(data?.path ?? data?.file_path ?? request?.path ?? request?.file_path);
  const command = COMMANDS.has(name) || name.startsWith('hook:');
  let rawCommandOutput = false;
  const add = (id: string, title: string, kind: ToolDetailPart['kind'], text: unknown, options: Pick<ToolDetailPart, 'language' | 'path'> = {}) => {
    if (typeof text !== 'string' || parts.length >= 7 || parts.some(part => part.id === id)) return;
    parts.push({ id, label: title, kind, text, ...options });
  };
  const take = (id: string, title: string, kind: ToolDetailPart['kind'], keys: string[], options: Pick<ToolDetailPart, 'language' | 'path'> = {}) => {
    if (!data) return;
    const key = keys.find(key => typeof data[key] === 'string');
    if (!key) return;
    add(id, title, kind, data[key], options); excluded.add(key);
  };
  const pathPart = () => {
    take('path', name === 'list_files' ? 'Folder path' : 'File path', 'path', ['path', 'file_path']);
    if (!parts.some(part => part.id === 'path') && file) add('path', 'File path', 'path', file);
  };
  if (parsed.structured && !parsed.complete) notices.push(`The saved ${field === 'input' ? 'request' : 'result'} is incomplete. Only captured fields and text are shown.`);
  if (field === 'output' && activity.status === 'error') notices.push('This tool step reported an error.');

  if (field === 'input') {
    if (command) {
      if (name === 'write_stdin') take('stdin', 'Command input', 'code', ['chars']);
      take('command', 'Command', 'code', ['command', 'cmd'], { language: 'shell' });
      take('directory', 'Working directory', 'path', ['cwd', 'workdir']);
      if (!parsed.structured) add('command', name === 'write_stdin' ? 'Command input' : 'Command', 'code', raw, { language: 'shell' });
    } else if (name === 'write_file') {
      take('content', 'File content', 'code', ['content'], file ? { path: file } : {}); pathPart();
    } else if (name === 'apply_patch') take('patch', 'Patch', 'code', ['patch'], { language: 'diff' });
    else if (FILE_READERS.has(name) || ['view_image', 'list_files', 'copy_file_attachment'].includes(name)) pathPart();
    else if (name === 'spawn_agent' || name === 'send_input') take('message', name === 'spawn_agent' ? 'Assigned task' : 'Agent message', 'text', ['message', 'prompt']);
    else if (name === 'create_goal' || name === 'update_goal') take('objective', 'Goal objective', 'text', ['objective']);
    else {
      take('content', 'Requested content', 'code', ['content', 'code'], file ? { path: file } : {});
      take('message', 'Request', 'text', ['message', 'prompt', 'instructions']);
      pathPart();
    }
  } else {
    const channels = data && ['output', 'stdout', 'stderr'].some(key => typeof data[key] === 'string');
    const processState = data && (typeof data.running === 'boolean' || typeof data.exit_code === 'number' || typeof data.exitCode === 'number');
    const processEnvelope = channels && (processState || name.startsWith('hook:') || !parsed.complete && typeof data?.output === 'string');
    if (command && processEnvelope) {
      take('output', typeof data!.stdout === 'string' || typeof data!.stderr === 'string' ? 'Combined output' : 'Command output', 'code', ['output']);
      take('stdout', 'Standard output', 'code', ['stdout']); take('stderr', 'Standard error', 'code', ['stderr']);
      if (data!.running === true) notices.push('The command was still running when this output was recorded.');
      const exit = data!.exit_code ?? data!.exitCode;
      if (typeof exit === 'number' && Number.isFinite(exit)) notices.push(`Recorded exit code: ${exit}.`);
      if (data!.output_suppressed === true) notices.push('The tool suppressed its output.');
    } else if (command && (!parsed.structured || parsed.complete && !name.startsWith('hook:')
      && !own(data ?? {}, 'execution_scope') && !own(data ?? {}, 'output_suppressed')
      && !(activity.status === 'error' && data?.error) && !containsPrivateFields(parsed.value))) {
      // JSON emitted by a command is real stdout, not automatically an app
      // envelope. Do not parse/reformat legitimate JSON command output.
      add('output', 'Command output', 'code', raw);
      rawCommandOutput = true;
      if (data) for (const key of Object.keys(data)) excluded.add(key);
    } else if (!parsed.structured) {
      const failed = activity.status === 'error', fileText = FILE_READERS.has(name);
      add(failed ? 'error' : 'output', failed ? 'Error' : fileText ? 'Recorded file text' : 'Recorded result',
        fileText && !failed ? 'code' : 'text', raw, file && fileText ? { path: file } : {});
      if (fileText) pathPart();
    } else if (name === 'read_file_attachment' && data?.format === 'binary') {
      take('binary', 'Recorded binary bytes', 'code', ['hex', 'data', 'base64']);
      notices.push('Binary bytes were recorded. Their document contents have not been parsed.');
    } else if (FILE_READERS.has(name)) {
      take('content', name === 'load_skill' ? 'Skill instructions' : name === 'read_skill_resource' ? 'Resource content' : 'File content', 'code', ['content', 'text'], file ? { path: file } : {});
      pathPart();
    } else if (name === 'get_review_diff') {
      take('diff', 'Review diff', 'code', ['diff', 'patch'], { language: 'diff', ...(file ? { path: file } : {}) });
      if (!parts.length && Array.isArray(data?.files)) {
        const diffs = data.files.flatMap(value => { const file = object(value); const text = string(file?.diff ?? file?.patch); return text === undefined ? [] : [text]; });
        if (diffs.length) {
          add('diff', 'Recorded file diffs', 'code', diffs.join('\n\n'), { language: 'diff' });
          metadataValue = { ...data, files: data.files.map(value => {
            const item = object(value); return item ? Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'diff' && key !== 'patch')) : value;
          }) };
        }
      }
    } else {
      take('content', 'Content', 'code', ['content', 'code'], file ? { path: file } : {});
      take('text', 'Result', 'text', ['text', 'summary', 'message', 'description']);
      take('output', 'Output', 'code', ['output']);
      pathPart();
    }
    if (!rawCommandOutput) {
      take('error', 'Error', 'text', ['error']);
      if (object(data?.error) && typeof object(data?.error)!.message === 'string') {
        add('error', 'Error', 'text', object(data?.error)!.message); excluded.add('error');
      }
      if (data?.truncated === true || data?.output_truncated === true) notices.push('The tool recorded a partial result. Output that was not saved cannot be recovered here.');
      if (command && data?.running === true) notices.push('The command was still running when this output was recorded.');
      if (command && data?.output_suppressed === true) notices.push('The tool suppressed its output.');
    }
  }

  if (parsed.structured && !rawCommandOutput) {
    const metadata = readable(metadataValue, notices, excluded);
    if (metadata) add('details', field === 'input' ? 'Request details' : 'Result details', 'text', metadata);
  } else if (!parts.length) add(field === 'input' ? 'input' : 'output', field === 'input' ? 'Recorded request' : 'Recorded result', 'text', raw);
  if (parsed.tail && !rawCommandOutput) {
    const tail = parseSaved(parsed.tail);
    add('continuation', parsed.tail.startsWith('Plugin hook feedback') ? 'Plugin feedback' : 'Additional recorded text', 'text',
      tail.structured ? readable(tail.value, notices) : parsed.tail);
  }
  if (!parts.length) {
    parts.push({ id: 'details', label: field === 'input' ? 'Request details' : 'Result details', kind: 'text', text: '' });
    notices.push('No readable text was present in the captured tool fields. The saved record is unchanged.');
  }
  const contentParts = parts.filter(part => !['details', 'path', 'directory'].includes(part.id));
  return { parts, defaultPartId: (contentParts.find(part => part.text.length) ?? contentParts[0] ?? parts.find(part => part.text.length) ?? parts[0]).id,
    notices: [...new Set(notices)].slice(0, 8).map(notice => prefix(notice, 1000)) };
}
