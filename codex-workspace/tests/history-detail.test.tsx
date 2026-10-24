import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium, expect as browserExpect, type Browser, type BrowserContext, type Page, type Request as BrowserRequest } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Thread, ToolActivity } from '../shared/types';
import { PublicConversationHistory, type PublicHistoryState } from '../server/agent/public-history';
import { HistoryDetail, HISTORY_DETAIL_PAGE_CHARS, parseHistoryDetail, type HistoryDetailTarget } from '../client/components/chat/HistoryDetail';
import { browserLaunchOptions } from './browser-launch';
import { expandActivityGroups } from './activity-group-browser';

const target: HistoryDetailTarget = { threadId: 'thread_detail_one', epoch: 'history_epoch_one', entryId: 'entry_one', field: 'text', label: 'Full assistant text' };
const secondTarget: HistoryDetailTarget = { threadId: 'thread_detail_two', epoch: 'history_epoch_two', messageId: 'message_two', field: 'content', label: 'Full message' };
const firstVersion = 'a'.repeat(64), secondVersion = 'b'.repeat(64);
const firstSection = 'FIRST SECTION\n'.padEnd(HISTORY_DETAIL_PAGE_CHARS, 'a');
const secondSection = 'SECOND SECTION\n'.padEnd(HISTORY_DETAIL_PAGE_CHARS, 'b');
const finalSection = 'FINAL SECTION\n<script>window.__untrustedExecuted = true</script>\n<img src="https://invalid.example/tracking.png">';
const fullText = firstSection + secondSection + finalSection;

function detail(text: string, offset = 0, current: HistoryDetailTarget = target, version = firstVersion) {
  let end = Math.min(text.length, offset + HISTORY_DETAIL_PAGE_CHARS);
  if (end < text.length && /[\ud800-\udbff]/.test(text[end - 1]) && /[\udc00-\udfff]/.test(text[end])) end--;
  const section = text.slice(offset, end);
  let previous = Math.max(0, offset - HISTORY_DETAIL_PAGE_CHARS);
  if (previous > 0 && /[\ud800-\udbff]/.test(text[previous - 1]) && /[\udc00-\udfff]/.test(text[previous])) previous++;
  return { threadId: current.threadId, epoch: current.epoch, revision: 1, version, text: section,
    totalChars: text.length, offset, previousOffset: offset === 0 ? null : previous, nextOffset: offset + section.length < text.length ? offset + section.length : null,
    ...(current.field === 'input' || current.field === 'output' ? { presentation: {
      label: current.field === 'input' ? 'Request' : 'Result', kind: 'code' as const, partId: 'content', parts: [{ id: 'content', label: 'Content' }],
    } } : {}) };
}

describe('saved history detail response bounds', () => {
  it('retains only the requested public fields and a bounded section', () => {
    const response = detail(fullText);
    const parsed = parseHistoryDetail({ ...response, encrypted_content: 'PRIVATE_FIELD_FIXTURE', reasoning: 'PRIVATE_REASONING_FIXTURE' }, target, 0);
    expect(parsed).toEqual(response);
    expect(parsed.text).toHaveLength(HISTORY_DETAIL_PAGE_CHARS);
    expect(parsed).not.toHaveProperty('encrypted_content');
    expect(parsed).not.toHaveProperty('reasoning');
    expect(parseHistoryDetail(detail(''), target, 0)).toMatchObject({ text: '', totalChars: 0, nextOffset: null });
  });

  const invalidPages: Array<{ name: string; patch: Record<string, unknown> }> = [
    { name: 'a different conversation', patch: { threadId: 'another_thread' } },
    { name: 'a different offset', patch: { offset: 1 } },
    { name: 'a negative revision', patch: { revision: -1 } },
    { name: 'a negative character total', patch: { totalChars: -1 } },
    { name: 'an empty version', patch: { version: '' } },
    { name: 'an oversized section', patch: { text: 'x'.repeat(HISTORY_DETAIL_PAGE_CHARS + 1), nextOffset: HISTORY_DETAIL_PAGE_CHARS + 1 } },
    { name: 'an empty nonterminal section', patch: { text: '', nextOffset: 0 } },
    { name: 'a gap before the next section', patch: { nextOffset: HISTORY_DETAIL_PAGE_CHARS + 10 } },
    { name: 'a missing next section', patch: { nextOffset: null } },
    { name: 'a previous offset before the beginning', patch: { previousOffset: -1 } },
  ];
  it.each(invalidPages)('rejects $name', ({ patch }) => {
    expect(() => parseHistoryDetail({ ...detail(fullText), ...patch }, target, 0)).toThrow();
  });

  it('distinguishes a corrected item from a replaced conversation and pins the total to the selected version', () => {
    expect(() => parseHistoryDetail(detail(fullText, HISTORY_DETAIL_PAGE_CHARS), target, HISTORY_DETAIL_PAGE_CHARS, secondVersion)).toThrow(expect.objectContaining({ status: 409, code: 'HISTORY_ITEM_CHANGED' }));
    expect(() => parseHistoryDetail({ ...detail(fullText), epoch: 'new_epoch' }, target, 0)).toThrow(expect.objectContaining({ status: 409, code: 'HISTORY_EPOCH_CHANGED' }));
    expect(() => parseHistoryDetail(detail(fullText), target, 0, firstVersion, fullText.length + 1)).toThrow();
    expect(() => parseHistoryDetail({ ...detail(fullText, HISTORY_DETAIL_PAGE_CHARS), previousOffset: HISTORY_DETAIL_PAGE_CHARS }, target, HISTORY_DETAIL_PAGE_CHARS)).toThrow();
  });

  it('renders no dialog or document-dependent content for a closed target', () => {
    expect(renderToStaticMarkup(<HistoryDetail target={null} onClose={() => undefined} onNotify={() => undefined} />)).toBe('');
  });

  it('refuses unpresented tool envelopes and mismatched or unbounded content choices', () => {
    const selected: HistoryDetailTarget = { threadId: target.threadId, epoch: target.epoch, messageId: 'message', activityId: 'activity', field: 'output', label: 'Full command output' };
    const response = detail('Actual command output', 0, selected);
    expect(() => parseHistoryDetail({ ...detail('{"output":"PROTOCOL_ENVELOPE"}', 0, selected), presentation: undefined }, selected, 0)).toThrow(/readable content section/);
    expect(() => parseHistoryDetail({ ...response, presentation: { ...response.presentation, parts: Array.from({ length: 9 }, (_, index) => ({ id: `part${index}`, label: 'Output' })) } }, selected, 0)).toThrow();
    expect(() => parseHistoryDetail({ ...response, presentation: { ...response.presentation, parts: [{ id: 'content', label: 'Output' }, { id: 'content', label: 'Duplicate' }] } }, selected, 0)).toThrow();
    expect(() => parseHistoryDetail(response, selected, 0, undefined, undefined, 'stderr')).toThrow();
  });

  it('keeps actual JSON source text intact while dropping unexpected presentation fields', () => {
    const selected: HistoryDetailTarget = { threadId: target.threadId, epoch: target.epoch, messageId: 'message', activityId: 'activity', field: 'output', label: 'Full file content' };
    const source = '{"output":"This is an actual JSON document, not a process envelope."}\n';
    const response = detail(source, 0, selected);
    const parsed = parseHistoryDetail({ ...response, presentation: { ...response.presentation, protocol: { private: 'DO_NOT_RETAIN' },
      parts: [{ id: 'content', label: 'Content', text: 'DO_NOT_RETAIN' }] } }, selected, 0);
    expect(parsed.text).toBe(source);
    expect(parsed.presentation).toEqual(response.presentation);
  });
});

// A local HTTP seam exercises the production React component and api() helper.
// No provider, agent runtime, or durable workspace data is involved.
describe.sequential('saved history detail in the browser', () => {
  interface RequestRecord { method: string; path: string; query: Record<string, string>; headers: IncomingHttpHeaders }
  interface Reply { status?: number; body: unknown }
  interface Saved { target: HistoryDetailTarget; text: string; version: string }
  const records: RequestRecord[] = [];
  const saved = new Map<string, Saved>();
  const publicHistory = new PublicConversationHistory('history-detail-browser-fixture-only');
  const toolThreads = new Map<string, { thread: Thread; state: PublicHistoryState }>();
  const overrides: Array<(record: RequestRecord) => Reply | Promise<Reply>> = [];
  const releases: Array<() => void> = [];
  const inflight = new Set<Promise<void>>();
  const freshBrowserPerTest = process.env.CODEX_BROWSER_LOW_THREADS === '1';
  let server: Server | undefined;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page;
  let directory = '', origin = '';
  let browserErrors: string[] = [];

  const itemKey = (threadId: string, query: Record<string, string>) => JSON.stringify([threadId, query.entryId, query.messageId, query.activityId, query.field]);
  const save = (current: HistoryDetailTarget, text: string, version = firstVersion) => saved.set(itemKey(current.threadId, {
    ...(current.entryId ? { entryId: current.entryId } : {}), ...(current.messageId ? { messageId: current.messageId } : {}),
    ...(current.activityId ? { activityId: current.activityId } : {}), field: current.field,
  }), { target: current, text, version });

  function defaultReply(record: RequestRecord): Reply {
    if (!record.headers.cookie?.includes('detail-fixture=authenticated')) return { status: 401, body: { error: 'Unlock the workspace to continue.', code: 'AUTH_REQUIRED' } };
    const threadId = decodeURIComponent(record.path.split('/')[3]);
    const tool = toolThreads.get(threadId);
    if (tool) {
      try {
        return { body: publicHistory.detail(tool.thread, tool.state, { epoch: record.query.epoch, field: record.query.field as HistoryDetailTarget['field'],
          messageId: record.query.messageId, activityId: record.query.activityId, entryId: record.query.entryId,
          offset: Number(record.query.offset), limit: Number(record.query.limit), version: record.query.version, part: record.query.part }) };
      } catch (error) {
        const failure = error as Error & { status?: number; code?: string };
        return { status: failure.status ?? 500, body: { error: failure.message, code: failure.code } };
      }
    }
    const current = saved.get(itemKey(threadId, record.query));
    if (!current) return { status: 404, body: { error: 'Saved content was not found.' } };
    if (record.query.epoch !== current.target.epoch) return { status: 409, body: { error: 'Conversation history changed.', code: 'HISTORY_EPOCH_CHANGED' } };
    if (record.query.version && record.query.version !== current.version) return { status: 409, body: { error: 'Saved content changed.', code: 'HISTORY_ITEM_CHANGED' } };
    const offset = Number(record.query.offset);
    if (offset > 0 && /[\ud800-\udbff]/.test(current.text[offset - 1]) && /[\udc00-\udfff]/.test(current.text[offset] ?? '')) return { status: 400, body: { error: 'Use the returned text offset.', code: 'INVALID_INPUT' } };
    return { body: detail(current.text, offset, current.target, current.version) };
  }

  function holdNext() {
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    releases.push(release);
    overrides.push(async record => { const response = defaultReply(record); await wait; return response; });
    return release;
  }

  async function patch(value: { target?: HistoryDetailTarget | null; locked?: boolean; toolThread?: Thread | null }) {
    await page.evaluate(next => { (window as unknown as { __patchHistoryFixture: (patch: unknown) => void }).__patchHistoryFixture(next); }, value);
  }

  async function settleReleasedResponse(release: () => void) {
    // Cancelling an unread late body produces requestfailed, for which this
    // Playwright release does not settle Response.finished(). Observe the exact
    // released request's completion or abort, including termination before the
    // response promise continuation runs; unrelated requests cannot release it.
    const terminated = new Set<BrowserRequest>();
    let released: BrowserRequest | undefined;
    let completed!: () => void;
    const completion = new Promise<void>(resolve => { completed = resolve; });
    const settled = (request: BrowserRequest) => {
      if (!request.url().includes('/history/detail?')) return;
      terminated.add(request);
      if (request === released) completed();
    };
    page.on('requestfinished', settled); page.on('requestfailed', settled);
    try {
      const response = page.waitForResponse(value => value.url().includes('/history/detail?'));
      release();
      released = (await response).request();
      if (terminated.has(released)) completed();
      await completion;
      const failure = released.failure();
      if (failure) expect(failure.errorText).toBe('net::ERR_ABORTED');
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    } finally { page.off('requestfinished', settled); page.off('requestfailed', settled); }
  }

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'codex-history-detail-'));
    const source = `
      import React, { StrictMode, useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { HistoryDetail } from './client/components/chat/HistoryDetail';
      import { ConversationTimeline } from './client/components/chat/ConversationTimeline';
      import { conversationTimeline } from './client/components/chat/timeline';
      import { installScrollActivity } from './client/scroll-activity';
      import './client/styles.css';
      import './client/scrollbars.css';
      installScrollActivity();
      window.__historyNotices = [];
      window.__historyAborted = [];
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const history = typeof input === 'string' && input.includes('/history/detail?');
        if (history) init?.signal?.addEventListener('abort', () => window.__historyAborted.push(input), {once:true});
        return originalFetch(input, history && window.__ignoreHistoryAbort ? {...init, signal:undefined} : init);
      };
      function Fixture() {
        const [state, setState] = useState({ target:null, locked:false, toolThread:null });
        window.__patchHistoryFixture = patch => setState(current => ({...current, ...patch}));
        return <main style={{padding:'16px'}}><button className="button" onClick={() => setState(current => ({...current, target:${JSON.stringify(target)}}))}>Open content</button>
          <HistoryDetail {...state} onClose={() => setState(current => ({...current, target:null}))}
            onNotify={(message, kind) => window.__historyNotices.push({message, kind})} />
          {state.toolThread && <ConversationTimeline rows={conversationTimeline(state.toolThread)} thread={state.toolThread} locked={state.locked}
            workspacePath="/data/workspaces/history-fixture" onNotify={(message, kind) => window.__historyNotices.push({message, kind})}
            renderMessage={({content}) => <p>{content}</p>} />}
        </main>;
      }
      createRoot(document.getElementById('root')).render(<StrictMode><Fixture /></StrictMode>);
    `;
    const bundle = await build({ stdin: { contents: source, loader: 'tsx', resolveDir: process.cwd(), sourcefile: 'history-detail-browser-fixture.tsx' },
      bundle: true, write: false, outfile: path.join(directory, 'fixture.js'), format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
    const javascript = bundle.outputFiles!.find(file => file.path.endsWith('.js'))!.contents;
    const css = bundle.outputFiles!.find(file => file.path.endsWith('.css'))!.contents;
    server = createServer((request, response) => {
      const handle = async () => {
        const url = new URL(request.url!, 'http://localhost');
        if (url.pathname === '/') {
          response.setHeader('Content-Type', 'text/html');
          response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); return;
        }
        if (url.pathname === '/fixture.js' || url.pathname === '/fixture.css') {
          response.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css');
          response.end(url.pathname.endsWith('.js') ? javascript : css); return;
        }
        if (!/^\/api\/threads\/[^/]+\/history\/detail$/.test(url.pathname)) { response.statusCode = 404; response.end(); return; }
        const record: RequestRecord = { method: request.method!, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: request.headers };
        records.push(record);
        const override = overrides.shift();
        const reply = await (override ? override(record) : defaultReply(record));
        if (response.destroyed) return;
        response.statusCode = reply.status ?? 200;
        response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store');
        response.end(JSON.stringify(reply.body));
      };
      const operation = handle().catch(() => { if (!response.destroyed) { response.statusCode = 500; response.end(JSON.stringify({ error: 'History test request failed.' })); } });
      inflight.add(operation);
      void operation.finally(() => inflight.delete(operation));
    });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('History detail fixture failed to listen.');
    origin = `http://127.0.0.1:${address.port}`;
    if (!freshBrowserPerTest) browser = await chromium.launch({ headless: true, ...browserLaunchOptions() });
  }, 30_000);

  beforeEach(async () => {
    records.length = 0; overrides.length = 0; releases.length = 0; saved.clear(); toolThreads.clear(); browserErrors = [];
    save(target, fullText); save(secondTarget, 'OTHER CONVERSATION');
    if (freshBrowserPerTest) browser = await chromium.launch({ headless: true, ...browserLaunchOptions() });
    context = await browser!.newContext({ viewport: { width: 1100, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });
    await context.addCookies([{ name: 'detail-fixture', value: 'authenticated', url: origin }]);
    page = await context.newPage();
    page.on('pageerror', error => browserErrors.push(error.message));
    await page.goto(origin);
    await browserExpect(page.getByRole('button', { name: 'Open content', exact: true })).toBeVisible();
  });

  afterEach(async () => {
    for (const release of releases) release();
    await Promise.allSettled([...inflight]);
    try { await context?.close(); }
    finally { if (freshBrowserPerTest) await browser?.close(); }
    expect(browserErrors).toEqual([]);
  });

  afterAll(async () => {
    if (!freshBrowserPerTest) await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('pages and copies exact bounded text, pins the version, and never renders returned markup', async () => {
    await page.getByRole('button', { name: 'Open content', exact: true }).click();
    const content = page.locator('.chat-history-detail-text');
    await browserExpect(content).toHaveText(firstSection);
    await browserExpect(page.getByRole('button', { name: 'Previous section', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Copy this section', exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(firstSection);
    await page.getByRole('button', { name: 'Next section', exact: true }).click();
    await browserExpect(content).toHaveText(secondSection);
    expect(await content.textContent()).toHaveLength(HISTORY_DETAIL_PAGE_CHARS);
    await browserExpect(page.getByText('FIRST SECTION', { exact: false })).toHaveCount(0);
    await page.getByRole('button', { name: 'Next section', exact: true }).click();
    await browserExpect(content).toHaveText(finalSection);
    await browserExpect(page.locator('[role="dialog"] script, [role="dialog"] img')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __untrustedExecuted?: boolean }).__untrustedExecuted)).toBeUndefined();
    await browserExpect(page.getByRole('button', { name: 'Next section', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Previous section', exact: true }).click();
    await browserExpect(content).toHaveText(secondSection);
    await page.getByRole('button', { name: 'Previous section', exact: true }).click();
    await browserExpect(content).toHaveText(firstSection);
    expect(records.map(record => Number(record.query.offset))).toEqual([0, HISTORY_DETAIL_PAGE_CHARS, 2 * HISTORY_DETAIL_PAGE_CHARS, HISTORY_DETAIL_PAGE_CHARS, 0]);
    expect(records.every(record => record.method === 'GET' && record.query.limit === String(HISTORY_DETAIL_PAGE_CHARS))).toBe(true);
    expect(records[0].query.version).toBeUndefined();
    expect(records.slice(1).every(record => record.query.version === firstVersion)).toBe(true);
    expect(records[0].headers['x-codex-workspace']).toBe('1');
    expect(records[0].headers.cookie).toContain('detail-fixture=authenticated');
  });

  it('reads complete large command and file content inline through the real public-history presenter without tool envelopes', async () => {
    const at = '2026-09-20T12:00:00.000Z';
    const commandText = Array.from({ length: 1800 }, (_, index) => `printf "real-line-${index}\\n"`).join('\n') + '\n# COMMAND END';
    const stdout = Array.from({ length: 1800 }, (_, index) => `Actual command output ${index}`).join('\n') + '\nOUTPUT END';
    const stderr = 'Actual standard error channel\nA recorded warning, preserved exactly.\n';
    const fileText = Array.from({ length: 1800 }, (_, index) => `export const value${index} = ${index};`).join('\n') + '\n// FILE END';
    const filePath = 'src/large.ts';
    const command: ToolActivity = { id: 'large-command', name: 'exec_command', status: 'completed', startedAt: at, completedAt: at,
      input: JSON.stringify({ cmd: commandText, workdir: '/data/workspaces/history-fixture', yield_time_ms: 1000, max_output_tokens: 24000 }),
      output: JSON.stringify({ stdout, stderr, exit_code: 0, wall_time_seconds: 2.5, session_id: 918273, chunk_id: 'PROTOCOL_CHUNK_ID' }) };
    const file: ToolActivity = { id: 'large-file', name: 'read_file', status: 'completed', startedAt: at, completedAt: at,
      input: JSON.stringify({ path: filePath, offset: 1, limit: 2000 }),
      output: JSON.stringify({ path: filePath, content: fileText, total_lines: 1801, offset: 1, truncated: false }) };
    const thread: Thread = { id: 'thread_semantic_tool_details', workspaceId: 'history-fixture', title: 'Saved tool source', createdAt: at, updatedAt: at, status: 'idle',
      messages: [{ id: 'tool-message', role: 'assistant', content: '', createdAt: at, activities: [command, file] }],
      timeline: { version: 1, revision: 2, nextSequence: 3, entries: [command, file].map((activity, index) => ({
        id: `entry-${activity.id}`, sequence: index + 1, revision: index + 1, messageId: 'tool-message', kind: 'activity' as const, activityId: activity.id,
      })) } };
    const state: PublicHistoryState = { epoch: 'semantic-tool-epoch', revision: 2 };
    toolThreads.set(thread.id, { thread, state });
    await patch({ toolThread: { ...thread, ...publicHistory.window(thread, state) } });
    expect(records).toHaveLength(0);
    await browserExpect(page.locator('.chat-activity-group-toggle')).toHaveCount(1);
    await expandActivityGroups(page);
    await page.getByRole('button', { name: /Ran command/ }).click();
    let section = page.getByRole('region', { name: 'Command', exact: true });
    let content = section.locator('.chat-history-detail-text');
    await browserExpect(content).toHaveText(commandText.slice(0, HISTORY_DETAIL_PAGE_CHARS));
    await browserExpect(page.getByRole('dialog')).toHaveCount(0);
    await browserExpect(section).not.toContainText('"yield_time_ms"');
    await browserExpect(section).not.toContainText('"cmd"');
    await section.getByRole('button', { name: 'Copy this section', exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(commandText.slice(0, HISTORY_DETAIL_PAGE_CHARS));
    for (let offset = HISTORY_DETAIL_PAGE_CHARS; offset < commandText.length; offset += HISTORY_DETAIL_PAGE_CHARS) {
      await section.getByRole('button', { name: 'Next section', exact: true }).click();
      await browserExpect(content).toHaveText(commandText.slice(offset, offset + HISTORY_DETAIL_PAGE_CHARS));
      await browserExpect(content).toHaveCount(1);
      expect(records.at(-1)!.query.part).toBe('command');
      expect(records.at(-1)!.query.version).toMatch(/^[a-f0-9]{64}$/);
    }
    await browserExpect(section.getByRole('button', { name: 'Next section', exact: true })).toBeDisabled();
    const correctedCommand = '# Corrected saved command\n' + commandText;
    command.input = JSON.stringify({ cmd: correctedCommand, workdir: '/data/workspaces/history-fixture' });
    await section.getByRole('button', { name: 'Previous section', exact: true }).click();
    await browserExpect(section.getByRole('alert')).toContainText('This content changed');
    await section.getByRole('button', { name: 'Restart from beginning', exact: true }).click();
    await browserExpect(content).toHaveText(correctedCommand.slice(0, HISTORY_DETAIL_PAGE_CHARS));
    expect(records.at(-1)!.query.part).toBe('command');
    expect(records.at(-1)!.query.offset).toBe('0');
    expect(records.at(-1)!.query.version).toBeUndefined();
    section = page.getByRole('region', { name: 'Command output', exact: true });
    content = section.locator('.chat-history-detail-text');
    await browserExpect(content).toHaveText(stdout.slice(0, HISTORY_DETAIL_PAGE_CHARS));
    await browserExpect(section).not.toContainText('PROTOCOL_CHUNK_ID');
    await browserExpect(section).not.toContainText('"exit_code"');
    await section.getByRole('combobox', { name: 'Content section', exact: true }).click();
    await page.getByRole('option', { name: 'Standard error', exact: true }).click();
    await browserExpect(content).toHaveText(stderr);
    expect(records.at(-1)!.query.part).toBe('stderr');
    expect(records.at(-1)!.query.offset).toBe('0');
    expect(records.at(-1)!.query.version).toBeUndefined();
    await section.getByRole('button', { name: 'Copy this section', exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(stderr);
    await page.locator('.chat-timeline-activity').getByRole('button', { name: /Read file.*src\/large.ts/ }).click();
    section = page.getByRole('region', { name: 'File content', exact: true });
    content = section.locator('.chat-history-detail-text');
    await browserExpect(content).toHaveText(fileText.slice(0, HISTORY_DETAIL_PAGE_CHARS));
    await browserExpect(section.locator('.chat-history-detail-path')).toContainText(filePath);
    await browserExpect(section).not.toContainText('"total_lines"');
    await browserExpect(section).not.toContainText('"content"');
    for (let offset = HISTORY_DETAIL_PAGE_CHARS; offset < fileText.length; offset += HISTORY_DETAIL_PAGE_CHARS) {
      await section.getByRole('button', { name: 'Next section', exact: true }).click();
      await browserExpect(content).toHaveText(fileText.slice(offset, offset + HISTORY_DETAIL_PAGE_CHARS));
      expect(await content.textContent()).toHaveLength(Math.min(HISTORY_DETAIL_PAGE_CHARS, fileText.length - offset));
    }
    await browserExpect(content).toContainText('// FILE END');
    await browserExpect(section.getByRole('button', { name: 'Next section', exact: true })).toBeDisabled();
    await section.getByRole('combobox', { name: 'Content section', exact: true }).click();
    await page.getByRole('option', { name: 'File path', exact: true }).click();
    await browserExpect(content).toHaveText(filePath);
    await section.getByRole('button', { name: 'Copy this section', exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(filePath);
    expect(records.every(record => record.query.limit === String(HISTORY_DETAIL_PAGE_CHARS))).toBe(true);
  });

  it('retries failures, restarts corrected content, and refuses to page a replaced conversation', async () => {
    overrides.push(() => ({ status: 503, body: { error: 'The saved content is temporarily unavailable.' } }));
    await page.getByRole('button', { name: 'Open content', exact: true }).click();
    await browserExpect(page.getByRole('alert')).toContainText('temporarily unavailable');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await browserExpect(page.locator('.chat-history-detail-text')).toHaveText(firstSection);
    const corrected = 'CORRECTED CONTENT\n'.padEnd(HISTORY_DETAIL_PAGE_CHARS + 20, 'c');
    save(target, corrected, secondVersion);
    await page.getByRole('button', { name: 'Next section', exact: true }).click();
    await browserExpect(page.getByRole('alert')).toContainText('This content changed');
    await browserExpect(page.locator('.chat-history-detail-text')).toHaveCount(0);
    await page.getByRole('button', { name: 'Restart from beginning', exact: true }).click();
    await browserExpect(page.locator('.chat-history-detail-text')).toHaveText(corrected.slice(0, HISTORY_DETAIL_PAGE_CHARS));
    expect(records.at(-1)!.query.offset).toBe('0');
    expect(records.at(-1)!.query.version).toBeUndefined();
    save({ ...target, epoch: 'replaced_epoch' }, corrected, secondVersion);
    await page.getByRole('button', { name: 'Next section', exact: true }).click();
    await browserExpect(page.getByRole('alert')).toContainText('This conversation changed');
    await page.getByRole('button', { name: 'Back to conversation', exact: true }).click();
    await browserExpect(page.getByRole('dialog')).toHaveCount(0);
  });

  it('uses returned previous offsets across UTF-16 surrogate boundaries', async () => {
    const unicodeText = 'x'.repeat(HISTORY_DETAIL_PAGE_CHARS - 3) + '😀😀' + 'y'.repeat(HISTORY_DETAIL_PAGE_CHARS - 3) + '😀FINAL SECTION';
    const boundary = HISTORY_DETAIL_PAGE_CHARS - 1;
    save(target, unicodeText);
    await page.getByRole('button', { name: 'Open content', exact: true }).click();
    const content = page.locator('.chat-history-detail-text');
    await browserExpect(content).toHaveText(unicodeText.slice(0, boundary));
    await page.getByRole('button', { name: 'Next section', exact: true }).click();
    await browserExpect(content).toHaveText(unicodeText.slice(boundary, 2 * boundary));
    await page.getByRole('button', { name: 'Next section', exact: true }).click();
    await browserExpect(content).toHaveText('😀FINAL SECTION');
    await page.getByRole('button', { name: 'Previous section', exact: true }).click();
    await browserExpect(content).toHaveText(unicodeText.slice(boundary, 2 * boundary));
    await page.getByRole('button', { name: 'Previous section', exact: true }).click();
    await browserExpect(content).toHaveText(unicodeText.slice(0, boundary));
    expect(records.map(record => Number(record.query.offset))).toEqual([0, boundary, 2 * boundary, boundary, 0]);
  });

  it('selects saved citations and tool inputs or outputs without requesting unrelated fields', async () => {
    for (const field of ['citations', 'input', 'output'] as const) {
      const selected: HistoryDetailTarget = { threadId: target.threadId, epoch: target.epoch, messageId: 'message_with_details',
        ...(field === 'citations' ? {} : { activityId: 'activity_with_details' }), field, label: `Full ${field}` };
      const text = field === 'citations' ? 'Reference title\nhttps://example.test/reference' : `${field}: exact saved tool content`;
      save(selected, text);
      await patch({ target: selected });
      await browserExpect(page.locator('.chat-history-detail-text')).toHaveText(text);
      const query = records.at(-1)!.query;
      expect(query).toMatchObject({ field, messageId: selected.messageId, offset: '0', epoch: selected.epoch });
      expect(query).not.toHaveProperty('entryId');
      if (field === 'citations') expect(query).not.toHaveProperty('activityId');
      else expect(query.activityId).toBe(selected.activityId);
    }
  });

  it('ignores a late response from a different target even when transport abort is ignored', async () => {
    await page.evaluate(() => { (window as unknown as { __ignoreHistoryAbort: boolean }).__ignoreHistoryAbort = true; });
    const release = holdNext();
    await page.getByRole('button', { name: 'Open content', exact: true }).click();
    await expect.poll(() => records.length).toBe(1);
    await patch({ target: secondTarget });
    await browserExpect(page.locator('.chat-history-detail-text')).toHaveText('OTHER CONVERSATION');
    await settleReleasedResponse(release);
    await browserExpect(page.locator('.chat-history-detail-text')).toHaveText('OTHER CONVERSATION');
    expect(records[1].query).toMatchObject({ messageId: secondTarget.messageId, field: 'content', offset: '0' });
    expect(records[1].query).not.toHaveProperty('entryId');
  });

  it('ignores a pre-close response after reopening the same target', async () => {
    await page.evaluate(() => { (window as unknown as { __ignoreHistoryAbort: boolean }).__ignoreHistoryAbort = true; });
    const release = holdNext();
    await page.getByRole('button', { name: 'Open content', exact: true }).click();
    await expect.poll(() => records.length).toBe(1);
    await page.keyboard.press('Escape');
    await browserExpect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __historyAborted: string[] }).__historyAborted.length)).toBe(1);
    save(target, 'SAVED AFTER CLOSING', secondVersion);
    await page.getByRole('button', { name: 'Open content', exact: true }).click();
    await browserExpect(page.locator('.chat-history-detail-text')).toHaveText('SAVED AFTER CLOSING');
    await settleReleasedResponse(release);
    await browserExpect(page.locator('.chat-history-detail-text')).toHaveText('SAVED AFTER CLOSING');
  });

  it('clears content on lock or authentication expiry and starts fresh after unlocking', async () => {
    await page.evaluate(() => { (window as unknown as { __ignoreHistoryAbort: boolean }).__ignoreHistoryAbort = true; });
    await page.getByRole('button', { name: 'Open content', exact: true }).click();
    await browserExpect(page.locator('.chat-history-detail-text')).toHaveText(firstSection);
    const release = holdNext();
    await page.getByRole('button', { name: 'Next section', exact: true }).click();
    await expect.poll(() => records.length).toBe(2);
    await page.evaluate(() => { document.body.dataset.workspaceLocked = 'true'; window.dispatchEvent(new CustomEvent('codex:session-locked')); });
    await browserExpect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(offset => (window as unknown as { __historyAborted: string[] }).__historyAborted.some(url => new URL(url, location.origin).searchParams.get('offset') === String(offset)), HISTORY_DETAIL_PAGE_CHARS)).toBe(true);
    await settleReleasedResponse(release);
    await page.evaluate(() => { document.body.dataset.workspaceLocked = 'false'; window.dispatchEvent(new CustomEvent('codex:session-unlocked')); });
    await browserExpect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Open content', exact: true }).click();
    await browserExpect(page.locator('.chat-history-detail-text')).toHaveText(firstSection);
    expect(records.at(-1)!.query.offset).toBe('0');
    expect(records.at(-1)!.query.version).toBeUndefined();
    overrides.push(() => ({ status: 401, body: { error: 'Unlock the workspace to continue.', code: 'AUTH_REQUIRED' } }));
    await page.getByRole('button', { name: 'Next section', exact: true }).click();
    await browserExpect(page.getByRole('dialog')).toHaveCount(0);
    await browserExpect(page.locator('.chat-history-detail-text')).toHaveCount(0);
  });

  it('supports narrow-screen controls, reduced motion, trapped focus, and Escape restoration', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const release = holdNext();
    const opener = page.getByRole('button', { name: 'Open content', exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: target.label, exact: true });
    await browserExpect(dialog).toBeVisible();
    await browserExpect(page.locator('.chat-history-detail-scroll')).toBeFocused();
    expect(await page.locator('.chat-history-detail-spinner').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
    release();
    await browserExpect(page.locator('.chat-history-detail-text')).toHaveText(firstSection);
    const dimensions = await dialog.evaluate(element => ({ width: element.getBoundingClientRect().width, right: element.getBoundingClientRect().right,
      buttons: [...element.querySelectorAll('button')].map(button => button.getBoundingClientRect().height) }));
    expect(dimensions.width).toBeLessThanOrEqual(375);
    expect(dimensions.right).toBeLessThanOrEqual(375);
    expect(dimensions.buttons.every(height => height >= 44)).toBe(true);
    const next = page.getByRole('button', { name: 'Next section', exact: true });
    await next.focus();
    await page.keyboard.press('Tab');
    await browserExpect(page.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await browserExpect(next).toBeFocused();
    await page.keyboard.press('Escape');
    await browserExpect(dialog).toHaveCount(0);
    await browserExpect(opener).toBeFocused();
  });
});
