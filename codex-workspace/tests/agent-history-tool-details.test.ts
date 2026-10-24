import { describe, expect, it } from 'vitest';
import type { ConversationHistoryDetail, Thread, ToolActivity } from '../shared/types';
import { PublicConversationHistory, type HistoryDetailInput } from '../server/agent/public-history';

const at = '2026-09-20T15:00:00.000Z';
const state = { epoch: `history_${'a'.repeat(32)}`, revision: 12 };
function fixture(name: string, input: string, output?: string) {
  const activity: ToolActivity = { id: 'saved-tool', name, input, output, status: 'completed', startedAt: at, completedAt: at };
  const thread: Thread = { id: `thr_${'b'.repeat(32)}`, workspaceId: 'workspace-test', title: 'Saved tool inspection', createdAt: at, updatedAt: at,
    status: 'idle', messages: [{ id: 'assistant-message', role: 'assistant', content: '', createdAt: at, activities: [activity] }],
    timeline: { version: 1, revision: 1, nextSequence: 2,
      entries: [{ id: 'tool-entry', sequence: 1, revision: 1, messageId: 'assistant-message', kind: 'activity', activityId: activity.id }] } };
  const history = new PublicConversationHistory('detail-fixture-key');
  const read = (field: 'input' | 'output', options: Partial<HistoryDetailInput> = {}) => history.detail(thread, state, {
    epoch: state.epoch, messageId: 'assistant-message', activityId: activity.id, field, ...options,
  });
  return { thread, activity, history, read };
}

function complete(read: (options: Partial<HistoryDetailInput>) => ConversationHistoryDetail, part?: string): { text: string; pages: ConversationHistoryDetail[] } {
  const pages: ConversationHistoryDetail[] = [];
  let offset: number | null = 0, version: string | undefined, selected = part;
  while (offset !== null) {
    const page = read({ offset, limit: 4096, ...(version ? { version } : {}), ...(selected ? { part: selected } : {}) });
    expect(page.offset).toBe(offset); expect(page.text.length).toBeLessThanOrEqual(4096);
    expect(/[\ud800-\udbff]$/.test(page.text)).toBe(false);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(64 * 1024);
    expect(page.presentation!.parts.length).toBeLessThanOrEqual(8);
    if (version) expect(page.version).toBe(version);
    if (page.nextOffset !== null) expect(page.nextOffset).toBeGreaterThan(offset);
    selected ??= page.presentation!.partId; version = page.version; offset = page.nextOffset; pages.push(page);
    if (pages.length > 1000) throw new Error('Tool detail inspection did not advance.');
  }
  return { text: pages.map(page => page.text).join(''), pages };
}

describe('readable bounded details from actual saved public tool records', () => {
  it('pages exact write-file code and its separate path without returning the request envelope', () => {
    const code = `  const greeting = "héllo 🙂";\r\n${'export const value = "actual code";\n'.repeat(1800)}\n`;
    const input = JSON.stringify({ path: 'src/real file.ts', content: code, expected_version: 'f'.repeat(64) });
    const { read, activity } = fixture('write_file', input, JSON.stringify({ path: 'src/real file.ts', written: true }));
    const detail = complete(options => read('input', options));
    expect(detail.text).toBe(code); expect(detail.pages.length).toBeGreaterThan(10);
    expect(detail.pages[0].totalChars).toBe(code.length);
    expect(detail.pages[0].presentation).toMatchObject({ label: 'File content', kind: 'code', partId: 'content', path: 'src/real file.ts' });
    expect(detail.pages[0].text).not.toContain('expected_version');
    expect(read('input', { part: 'path' })).toMatchObject({ text: 'src/real file.ts', presentation: { label: 'File path', kind: 'path', partId: 'path' } });
    expect(read('input', { part: 'details' }).text).toBe(`Expected version: ${'f'.repeat(64)}`);
    expect(activity.input).toBe(input);
  });

  it('extracts actual commands and each output channel while preserving running/failure and partial-result semantics', () => {
    const command = `printf '%s\\n' '🙂 actual command'\n${'printf "line\\n"\n'.repeat(1600)}`;
    const stdout = 'Normal output 🙂\n'.repeat(2400), stderr = 'Actual diagnostic Ω\n'.repeat(900), combined = stdout + stderr;
    const input = JSON.stringify({ command, cwd: 'project', timeout_ms: 5000 });
    const output = JSON.stringify({ execution_scope: 'local_host', output: combined, stdout, stderr, running: false, exit_code: 7, truncated: true, session_id: 'owned-session' });
    const { read, activity } = fixture('functions.exec_command', input, output);
    expect(complete(options => read('input', options)).text).toBe(command);
    expect(read('input').presentation).toMatchObject({ label: 'Command', kind: 'code', language: 'shell', partId: 'command' });
    const result = complete(options => read('output', options));
    expect(result.text).toBe(combined);
    expect(result.pages[0].presentation!.parts).toEqual(expect.arrayContaining([
      { id: 'stdout', label: 'Standard output' }, { id: 'stderr', label: 'Standard error' }, { id: 'details', label: 'Result details' },
    ]));
    expect(result.pages[0].presentation!.notices).toEqual(expect.arrayContaining([
      expect.stringContaining('exit code: 7'), expect.stringContaining('partial result'),
    ]));
    expect(complete(options => read('output', options), 'stdout').text).toBe(stdout);
    expect(complete(options => read('output', options), 'stderr').text).toBe(stderr);
    expect(read('output').text).not.toContain('execution_scope');
    const version = read('output').version;
    activity.output = JSON.stringify({ output: combined, stdout, stderr, running: true, session_id: 'owned-session' });
    expect(read('output').presentation!.notices).toContain('The command was still running when this output was recorded.');
    expect(() => read('output', { version })).toThrow(/changed while it was being inspected/);
    expect(activity.input).toBe(input);
  });

  it('pages the complete read-file content, preserves JSON source files as real code, and keeps patch text exact', () => {
    const code = JSON.stringify({ command: 'This is source data, not a tool request.', values: Array.from({ length: 5000 }, (_, index) => `line ${index} 🙂`) }, null, 2) + '\n';
    const output = JSON.stringify({ path: 'data/document.json', version: 'a'.repeat(64), total_lines: 5006, offset: 1, content: code, truncated: false });
    const file = fixture('read_file', JSON.stringify({ path: 'data/document.json', offset: 1, limit: 1200 }), output);
    const result = complete(options => file.read('output', options));
    expect(result.text).toBe(code);
    expect(result.pages[0].presentation).toMatchObject({ label: 'File content', path: 'data/document.json', partId: 'content' });
    expect(file.read('output', { part: 'path' }).text).toBe('data/document.json');
    expect(file.activity.output).toBe(output);
    const patch = `*** Begin Patch\n*** Add File: src/new.ts\n${'+// Actual patch line 🙂\n'.repeat(1800)}*** End Patch`;
    const edit = fixture('apply_patch', JSON.stringify({ patch }));
    expect(complete(options => edit.read('input', options)).text).toBe(patch);
    expect(edit.read('input').presentation).toMatchObject({ label: 'Patch', language: 'diff', partId: 'patch' });
  });

  it('recovers captured code from incomplete saved envelopes without inventing missing characters or exposing JSON wrappers', () => {
    const code = 'const value = "🙂";\n'.repeat(1100);
    const captured = JSON.stringify({ path: 'incomplete.ts', content: code }).slice(0, -2);
    const file = fixture('write_file', captured);
    expect(complete(options => file.read('input', options)).text).toBe(code);
    expect(file.read('input').presentation!.notices).toEqual(expect.arrayContaining([expect.stringContaining('incomplete')]));
    expect(file.activity.input).toBe(captured);
    const partialEscape = String.raw`{"command":"printf \"ready\"\n\uD83D\uDE42\uD83D\uDE`;
    const process = fixture('exec_command', partialEscape);
    expect(process.read('input').text).toBe('printf "ready"\n🙂');
    expect(process.read('input').presentation!.notices).toEqual(expect.arrayContaining([expect.stringContaining('incomplete')]));
    const incompleteExit = fixture('exec_command', '{}', '{"output":"captured output","exit_code":7');
    expect(incompleteExit.read('output').text).toBe('captured output');
    expect(incompleteExit.read('output').presentation!.notices).not.toEqual(expect.arrayContaining([expect.stringContaining('exit code: 7')]));
  });

  it('uses readable labels for unfamiliar metadata and excludes private/encrypted reasoning fields', () => {
    const saved = JSON.stringify({ ok: true, total: 2, items: [{ name: 'First saved value', bytes: 42 }, { name: 'Second saved value', note: 'Observed result' }],
      nested: { encrypted_content: 'PRIVATE_CIPHERTEXT', record: { type: 'reasoning', text: 'PRIVATE_THOUGHT' }, public: 'Actual public fact' },
      modelContent: [{ text: 'PRIVATE_MODEL_INPUT' }] });
    const generic = fixture('future_read_tool', '{}', saved), result = generic.read('output');
    expect(result.presentation).toMatchObject({ label: 'Result details', kind: 'text', partId: 'details' });
    expect(result.text).toContain('Ok: Yes'); expect(result.text).toContain('Total: 2'); expect(result.text).toContain('First saved value');
    expect(result.text).toContain('Actual public fact'); expect(result.text).not.toContain('{"');
    for (const forbidden of ['PRIVATE_CIPHERTEXT', 'PRIVATE_THOUGHT', 'PRIVATE_MODEL_INPUT']) expect(JSON.stringify(result)).not.toContain(forbidden);
    expect(generic.activity.output).toBe(saved);
    const privateRecord = fixture('exec_command', '{}', JSON.stringify({ type: 'reasoning', text: 'PRIVATE_THOUGHT', encrypted_content: 'PRIVATE_CIPHERTEXT' }));
    expect(privateRecord.read('output').text).toBe('');
    expect(JSON.stringify(privateRecord.read('output'))).not.toContain('PRIVATE_');
  });

  it('keeps bare legacy JSON stdout as command data and does not invent error/truncation semantics from its data keys', () => {
    const raw = '{"error":"a legitimate data field","truncated":true,"records":[1,2,3]}\n';
    const process = fixture('exec_command', '{"command":"print-saved-json"}', raw);
    const page = process.read('output');
    expect(page.text).toBe(raw); expect(page.presentation).toMatchObject({ label: 'Command output', kind: 'code', partId: 'output' });
    expect(page.presentation!.parts).toEqual([{ id: 'output', label: 'Command output' }]);
    expect(page.presentation!.notices).toBeUndefined();
  });

  it('pins versions to the selected part and complete saved result, and never substitutes a removed part', () => {
    const process = fixture('exec_command', '{"command":"check"}', JSON.stringify({ output: 'Combined', stdout: 'Out', stderr: 'Error', running: false, exit_code: 1 }));
    const initial = process.read('output');
    expect(() => process.read('output', { part: 'stderr', version: initial.version })).toThrow(/changed while it was being inspected/);
    const error = process.read('output', { part: 'stderr' });
    process.activity.output = JSON.stringify({ output: 'Combined', stdout: 'Out', stderr: 'Error', running: false, exit_code: 2 });
    expect(() => process.read('output', { part: 'stderr', version: error.version })).toThrow(/changed while it was being inspected/);
    process.activity.output = JSON.stringify({ output: 'Combined', running: false, exit_code: 2 });
    expect(() => process.read('output', { part: 'stderr' })).toThrow(/unavailable/);
    expect(() => process.read('output', { part: '../input' })).toThrow(/readable part/);
    expect(() => process.read('input', { field: 'content', part: 'command', activityId: undefined })).toThrow(/readable part/);
  });
});
