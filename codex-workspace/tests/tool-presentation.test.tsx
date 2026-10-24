import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ToolActivity } from '../shared/types';
import { ActivityCard } from '../client/components/chat/ActivityCard';
import { formatToolActivity, toolActivityHasFailure, workspaceFileTarget, type ToolPresentation, type ToolSection } from '../client/components/chat/tool-presentation';

const start = '2026-09-19T12:00:00.000Z';
const secretVersion = 'a'.repeat(64);
function activity(name: string, args: unknown = {}, output?: unknown, extra: Partial<ToolActivity> = {}): ToolActivity {
  return { id: 'test-tool', name, input: typeof args === 'string' ? args : JSON.stringify(args), ...(output !== undefined ? { output: typeof output === 'string' ? output : JSON.stringify(output) } : {}), status: 'completed', startedAt: start, completedAt: '2026-09-19T12:00:03.000Z', ...extra };
}
function codes(view: ToolPresentation): Extract<ToolSection, { type: 'code' }>[] { return view.sections.filter(section => section.type === 'code'); }
function rows(view: ToolPresentation): Extract<ToolSection, { type: 'rows' }>[] { return view.sections.filter(section => section.type === 'rows'); }
function visible(view: ToolPresentation) { return JSON.stringify(view); }

describe('semantic tool results', () => {
  it('unwraps actual process output without showing IDs, argument envelopes, or review bookkeeping', () => {
    const view = formatToolActivity(activity('exec_command', { command: 'npm test', cwd: 'client', timeout_ms: 120000 }, { output: '\u001b[32m12 tests passed\u001b[0m\n', exit_code: 0, running: false, session_id: 'PROCESS_ID', chunk_id: 'CHUNK_ID', wall_time_seconds: 2.7, review_note: 'Protocol review metadata.' }));
    expect(view.label).toBe('Ran command');
    expect(view.statusLabel).toBe('Completed');
    expect(codes(view).map(section => section.text)).toEqual(['npm test', '12 tests passed\n']);
    expect(visible(view)).toContain('Exit code');
    expect(visible(view)).toContain('client');
    expect(visible(view)).not.toMatch(/PROCESS_ID|CHUNK_ID|timeout_ms|Protocol review metadata|exit_code/);
    const invalidTime = formatToolActivity(activity('exec_command', {}, { output: '', running: false, exit_code: 0, wall_time_seconds: -3 }));
    expect(visible(invalidTime)).not.toContain('Elapsed');
  });

  it('keeps genuine JSON command output and JSON file content as code', () => {
    const data = '{"name":"real-file","version":"1.2","session_id":"a field in the document"}';
    const command = formatToolActivity(activity('exec_command', { command: 'cat package.json' }, { output: data, running: false, exit_code: 0 }));
    const legacy = formatToolActivity(activity('exec_command', { command: 'cat package.json' }, data));
    const file = formatToolActivity(activity('read_file', { path: 'package.json' }, { path: 'package.json', version: secretVersion, offset: 1, total_lines: 1, content: data, truncated: false }));
    expect(codes(command).at(-1)?.text).toBe(data);
    expect(codes(legacy).at(-1)?.text).toBe(data);
    expect(codes(file)[0].text).toBe(data);
    expect(visible(file)).not.toContain(secretVersion);
  });

  it('separates actual stdout/stderr and exposes a nonzero exit even when tool execution completed', () => {
    const view = formatToolActivity(activity('exec_command', { cmd: 'npm run check' }, { stdout: 'Checking…', stderr: 'src/app.ts: missing import', exit_code: 2, running: false, review_warnings: ['One file was too large to review.'] }));
    expect(view.status).toBe('error');
    expect(view.statusLabel).toBe('Exit 2');
    expect(codes(view).map(section => [section.title, section.text])).toContainEqual(['Standard error', 'src/app.ts: missing import']);
    expect(view.notices).toContainEqual({ kind: 'warning', text: 'One file was too large to review.' });
    expect(view.summary).toBe('Command exited with code 2.');
  });

  it('distinguishes the command still running from a completed poll', () => {
    const view = formatToolActivity(activity('wait_command', { session_id: 'DO_NOT_SHOW_SESSION' }, { output: 'Listening on the local port', session_id: 'DO_NOT_SHOW_SESSION', running: true }));
    expect(view.statusLabel).toBe('Still running');
    expect(view.summary).toContain('when this output was captured');
    expect(visible(view)).not.toContain('DO_NOT_SHOW_SESSION');
  });

  it('labels pending, approved, and failed states without inventing results', () => {
    for (const [status, label] of [['running', 'Running'], ['awaiting_approval', 'Awaiting approval'], ['awaiting_input', 'Awaiting your answer']] as const) {
      const view = formatToolActivity(activity('write_file', { path: 'new.ts', content: 'export {}', expected_version: secretVersion }, undefined, { status, completedAt: undefined }));
      expect(view.statusLabel).toBe(label);
      expect(visible(view)).toContain('Proposed');
      expect(visible(view)).not.toContain(secretVersion);
      expect(visible(view)).not.toContain('Saved');
    }
    const failed = formatToolActivity(activity('read_file', { path: 'missing.ts' }, 'File does not exist.', { status: 'error' }));
    expect(failed.statusLabel).toBe('Failed');
    expect(visible(failed)).toContain('File does not exist.');
    expect(visible(failed)).not.toContain('Completed without output');
  });

  it('presents files, directories, and search results as navigable structured rows', () => {
    const listed = formatToolActivity(activity('list_files', { recursive: true }, { files: [{ path: 'src', kind: 'directory' }, { path: 'src/index.ts', kind: 'file', size: 1048 }], truncated: false }));
    expect(listed.summary).toBe('2 entries');
    expect(rows(listed)[0].rows[0]).toMatchObject({ kind: 'directory', title: 'src' });
    expect(rows(listed)[0].rows[0].path).toBeUndefined();
    expect(rows(listed)[0].rows[1]).toMatchObject({ path: 'src/index.ts', badge: '1.0 KB' });
    const search = formatToolActivity(activity('search_files', { query: 'render', include: 'src/**/*.ts' }, { matches: [{ path: 'src/index.ts', line: 42, column: 7, text: 'export function render() {}' }], truncated: false }));
    expect(search.summary).toBe('1 match in 1 file');
    expect(rows(search)[0].rows[0]).toMatchObject({ path: 'src/index.ts', line: 42, column: 7, detail: 'export function render() {}' });
    const empty = formatToolActivity(activity('search_files', { query: 'absent' }, { matches: [], truncated: false }));
    expect(rows(empty)[0].empty).toBe('No matches found.');
  });

  it('distinguishes an empty file from an empty or blank requested line range', () => {
    const empty = formatToolActivity(activity('read_file', { path: 'empty.txt' }, { path: 'empty.txt', content: '', total_lines: 1, offset: 1 }));
    expect(visible(empty)).toContain('This file is empty.');
    const outside = formatToolActivity(activity('read_file', { path: 'file.txt', offset: 100 }, { path: 'file.txt', content: '', total_lines: 20, offset: 100 }));
    expect(visible(outside)).not.toContain('Empty file');
    expect(visible(outside)).toContain('No text was returned for this range.');
    const blank = formatToolActivity(activity('read_file', { path: 'file.txt', offset: 4 }, { path: 'file.txt', content: '', total_lines: 20, offset: 4 }));
    expect(blank.summary).toBe('Lines 4–4 of 20');
    expect(visible(blank)).toContain('This line is blank.');
  });

  it('shows proposed patch paths and actual completed change operations without claiming Keep or Undo', () => {
    const patch = '*** Begin Patch\n*** Update File: src/app.ts\n@@\n-old\n+new\n*** Delete File: old.txt\n*** End Patch';
    const pending = formatToolActivity(activity('apply_patch', { patch }, undefined, { status: 'awaiting_approval' }));
    expect(rows(pending)[0].title).toBe('Proposed changes');
    expect(rows(pending)[0].rows).toHaveLength(2);
    const complete = formatToolActivity(activity('apply_patch', { patch }, { changed: [{ path: 'src/app.ts', operation: 'updated' }, { path: 'old.txt', operation: 'deleted' }] }));
    expect(rows(complete)[0].rows.map(row => row.badge)).toEqual(['Updated', 'Deleted']);
    expect(rows(complete)[0].rows[1].path).toBeUndefined();
    expect(codes(complete)[0].text).toBe(patch);
    expect(visible(complete)).not.toMatch(/Kept|Undone/);
  });

  it('uses actual plan states, goal usage, and skill documents while omitting version and identity fields', () => {
    const plan = formatToolActivity(activity('update_plan', { explanation: 'The build is verified.', steps: [{ step: 'Inspect files', status: 'completed' }, { step: 'Check the browser', status: 'in_progress' }] }));
    expect(plan.summary).toBe('1 of 2 completed');
    expect(plan.statusLabel).toBe('Updated');
    expect(rows(plan)[0].rows.map(row => row.status)).toEqual(['completed', 'in_progress']);
    const goal = formatToolActivity(activity('get_goal', {}, { goal: { id: 'GOAL_ID', objective: 'Finish the editor', status: 'active', tokensUsed: 100, tokenBudget: 400, timeUsedSeconds: 71, usageIncomplete: true }, remainingTokens: 300 }));
    expect(visible(goal)).toContain('Tokens remaining');
    expect(visible(goal)).toContain('300');
    expect(visible(goal)).toContain('lower bound');
    expect(visible(goal)).not.toContain('GOAL_ID');
    const skill = formatToolActivity(activity('load_skill', { skill: 'opaque_skill_identifier' }, { skill: { id: 'SKILL_ID', name: 'test-writing', displayName: 'Test writing', description: 'Project test workflow', scope: 'project', path: '.codex/skills/test-writing/SKILL.md' }, content: '# Instructions\nUse the existing test runner.', version: secretVersion, resources: [{ path: 'reference.md', kind: 'file' }], nextOffset: null }));
    expect(skill.preview).toBe('Test writing');
    expect(codes(skill)[0].text).toContain('Use the existing test runner.');
    expect(visible(skill)).not.toMatch(new RegExp(`SKILL_ID|${secretVersion}`));
  });

  it('summarizes real agent results and wait timeouts without leaking agent IDs or implying completion', () => {
    const id = 'thr_' + 'b'.repeat(32);
    const timeout = formatToolActivity(activity('wait_agent', { targets: [id] }, { status: {}, timed_out: true }));
    expect(timeout.summary).toBe('No agent finished during this wait.');
    expect(visible(timeout)).not.toContain(id);
    const complete = formatToolActivity(activity('wait_agent', { targets: [id] }, { status: { [id]: { status: 'completed', finalMessage: 'The parser fix passed its regression test.', agent_id: id } }, timed_out: false }));
    expect(rows(complete)[0].rows[0].detail).toBe('The parser fix passed its regression test.');
    expect(visible(complete)).not.toContain(id);
  });

  it('shows hook decisions, review failures, and true hook stdout instead of control envelopes', () => {
    const hook = formatToolActivity(activity('hook:PreToolUse', { source_path: '.codex/hooks/check.sh', hook_id: 'HOOK_ID' }, { status: 'completed', exit_code: 0, stdout: 'Hook checked the path.', stderr: '', review_pending: true, permission_decision: 'deny', permission_message: 'This change needs review.', review_error: 'File review failed.', additional_context: [{ characters: 100 }] }));
    expect(codes(hook)[0].text).toBe('Hook checked the path.');
    expect(visible(hook)).toContain('This change needs review.');
    expect(visible(hook)).toContain('File review failed.');
    expect(visible(hook)).not.toMatch(/HOOK_ID|additional_context|permission_decision/);
    expect(hook.statusLabel).toBe('Review failed');
  });

  it('keeps completed process, review, and child failures visible to collapsed turn summaries', () => {
    const records = [
      activity('exec_command', {}, { output: 'Command failed', exit_code: 2, running: false }),
      activity('hook:PostToolUse', {}, { stdout: 'ok', exit_code: 0, review_error: 'File changes could not be recorded.' }),
      activity('wait_agent', {}, { status: { hidden_id: { status: 'error', error: 'The check failed.' } } }),
      activity('inspect_service', {}, { success: false }),
    ];
    for (const entry of records) {
      expect(toolActivityHasFailure(entry)).toBe(true);
      expect(formatToolActivity(entry).status).toBe('error');
    }
    expect(toolActivityHasFailure(activity('exec_command', {}, '{"error":"a JSON file field"}'))).toBe(false);
    expect(toolActivityHasFailure(activity('exec_command', {}, { output: 'Still working', running: true }, { status: 'running' }))).toBe(false);
    expect(toolActivityHasFailure(activity('read_file', {}, { content: '{"success": false}', path: 'file.json' }))).toBe(false);
    expect(formatToolActivity(records[2]).statusLabel).toBe('Agent failed');
    expect(visible(formatToolActivity(records[2]))).not.toContain('hidden_id');
  });

  it('gives unknown tools a readable result and preserves an explicit error', () => {
    const view = formatToolActivity(activity('inspect_database', { query: 'active projects', trace_id: 'TRACE_ID' }, { summary: 'Three active projects found.', count: 3, request_id: 'REQUEST_ID', encrypted_content: 'PRIVATE_CONTENT', results: [{ id: 'RECORD_ID', name: 'Editor', description: 'Current project' }] }));
    expect(visible(view)).toContain('Three active projects found.');
    expect(visible(view)).toContain('Editor');
    expect(visible(view)).not.toMatch(/TRACE_ID|REQUEST_ID|PRIVATE_CONTENT|RECORD_ID/);
    const failure = formatToolActivity(activity('unknown_tool', {}, { error: { message: 'The service is unavailable.', code: 'INTERNAL_CODE' } }));
    expect(failure.status).toBe('error');
    expect(visible(failure)).toContain('The service is unavailable.');
    expect(visible(failure)).not.toContain('INTERNAL_CODE');
    const values = formatToolActivity(activity('calculate_values', {}, '[12, 24, 36]'));
    expect(rows(values)[0].rows.map(row => row.title)).toEqual(['12', '24', '36']);
    const payload = formatToolActivity(activity('inspect_text', {}, { output: 'Actual textual tool output.', trace_id: 'TRACE_ID' }));
    expect(codes(payload)[0].text).toBe('Actual textual tool output.');
    expect(visible(payload)).not.toContain('TRACE_ID');
  });

  it('recovers only observed text from incomplete streamed envelopes without showing protocol JSON', () => {
    const opening = formatToolActivity(activity('exec_command', { command: 'npm test' }, '{', { status: 'running' }));
    expect(codes(opening)).toHaveLength(1);
    expect(visible(opening)).toContain('Waiting for output');
    const stream = formatToolActivity(activity('exec_command', { command: 'npm test' }, '{"output":"first line\\nsecond', { status: 'running' }));
    expect(codes(stream).at(-1)?.text).toBe('first line\nsecond');
    expect(stream.notices.some(notice => notice.text === 'Result details are still arriving.')).toBe(true);
    expect(stream.summary).not.toContain('Exit 0');
    const final = formatToolActivity(activity('exec_command', { command: 'npm test' }, { output: 'first line\nsecond line\nPassed.', running: false, exit_code: 0 }));
    expect(codes(final).at(-1)?.text).toBe('first line\nsecond line\nPassed.');
    expect(final.truncated).toBe(false);
    const clipped = formatToolActivity(activity('read_file', { path: 'src/app.ts' }, '{"path":"src/app.ts","version":"' + secretVersion + '","content":"export const value = 1;\n[Tool output truncated to 120,000 characters.]'));
    expect(codes(clipped)[0].text).toBe('export const value = 1;');
    expect(clipped.truncated).toBe(true);
    expect(visible(clipped)).not.toContain(secretVersion);
  });

  it('never claims an incomplete array is empty and bounds long code, rows, and warnings visibly', () => {
    const partial = formatToolActivity(activity('search_files', { query: 'state' }, '{"matches":[', { status: 'running' }));
    expect(rows(partial)[0].empty).toBeUndefined();
    const malformed = formatToolActivity(activity('search_files', { query: 'state' }, { matches: [null, { protocol_id: 'INVALID_MATCH' }] }));
    expect(rows(malformed)[0].empty).toBeUndefined();
    expect(malformed.notices.some(notice => notice.text === '2 search results could not be displayed.')).toBe(true);
    const output = 'x'.repeat(85000) + '\nFATAL: actual last line';
    const command = formatToolActivity(activity('exec_command', { command: 'test' }, { output, exit_code: 1, running: false, truncated: true }));
    expect(command.truncated).toBe(true);
    expect(codes(command).at(-1)?.text.length).toBeLessThan(41000);
    expect(codes(command).at(-1)?.text).toContain('FATAL: actual last line');
    expect(codes(command).at(-1)?.text).toContain('omitted from this preview');
    const list = formatToolActivity(activity('list_files', {}, { files: Array.from({ length: 90 }, (_, index) => ({ path: `src/${index}.ts`, kind: 'file' })), truncated: true }));
    expect(rows(list)[0].rows).toHaveLength(60);
    expect(rows(list)[0].omitted).toBe(30);
    expect(list.truncated).toBe(true);
  });

  it('keeps unusually long individual results and partial skill documents explicitly marked', () => {
    const result = formatToolActivity(activity('search_files', { query: 'long line' }, { matches: [{ path: 'file.txt', line: 1, text: 'x'.repeat(3000) }] }));
    expect(rows(result)[0].rows[0].truncated).toBe(true);
    expect(rows(result)[0].rows[0].detail?.length).toBe(1800);
    expect(result.truncated).toBe(true);
    const skill = formatToolActivity(activity('load_skill', { skill: 'review' }, { skill: { name: 'review' }, content: '# First part', nextOffset: 12000, resourcesTruncated: true }));
    expect(skill.truncated).toBe(true);
    expect(visible(skill)).toContain('More content is available');
  });

  it('tolerates malformed and deeply nested protocol data without evaluating or revealing it', () => {
    const malformed = formatToolActivity(activity('read_file', '{bad arguments', '{"__proto__":{"polluted":true},"encrypted_content":"PRIVATE"', { status: 'error' }));
    expect(malformed.truncated).toBe(true);
    expect(visible(malformed)).not.toMatch(/PRIVATE|polluted|__proto__/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(() => formatToolActivity(activity('unknown', {}, '['.repeat(100) + '0'))).not.toThrow();
    const malformedField = { toString: null, valueOf: null };
    expect(() => formatToolActivity(activity('read_review_file', {}, { content: 'actual content', source: malformedField, side: malformedField }))).not.toThrow();
    expect(() => formatToolActivity(activity('update_plan', { steps: [{ step: 'Malformed state', status: malformedField }] }))).not.toThrow();
    expect(() => formatToolActivity(activity('list_agents', {}, { agents: [{ nickname: 'Worker', status: malformedField }] }))).not.toThrow();
  });
});

describe('tool file navigation and safe rendering', () => {
  it('only links workspace-contained paths and preserves literal filenames', () => {
    expect(workspaceFileTarget('/workspace/project/src/file name.ts', '/workspace/project')).toBe('src/file name.ts');
    expect(workspaceFileTarget('./src/index.ts')).toBe('src/index.ts');
    expect(workspaceFileTarget('data%20file.json')).toBe('data%20file.json');
    for (const path of ['../outside', 'src/../../outside', '/etc/passwd', '//example.test/file', 'javascript:alert(1)', 'file:///etc/passwd', 'src\\..\\file', 'src/\u0000file']) expect(workspaceFileTarget(path, '/workspace/project')).toBeNull();
    expect(workspaceFileTarget('/workspace/project-other/file.ts', '/workspace/project')).toBeNull();
  });

  it('escapes hostile output, exposes real errors immediately, and keeps region controls accessible', () => {
    const html = renderToStaticMarkup(<ActivityCard activity={activity('exec_command', { command: 'npm test' }, { output: '<script>window.EXECUTED=true</script>\n<img src="https://example.test/tracker" />', exit_code: 1, running: false })} onNotify={() => undefined} />);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('role="region"');
    expect(html).toContain('role="status"');
    expect(html).toContain('Exit 1');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('exit_code');
  });

  it('does not mount heavy completed results until requested, but leaves truncation visible', () => {
    const html = renderToStaticMarkup(<ActivityCard activity={activity('read_file', { path: 'src/app.ts' }, { path: 'src/app.ts', content: 'HEAVY_FILE_CONTENT', version: secretVersion, total_lines: 1000, offset: 1, truncated: true })} onNotify={() => undefined} />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Partial result');
    expect(html).not.toContain('HEAVY_FILE_CONTENT');
    expect(html).not.toContain(secretVersion);
  });
});
