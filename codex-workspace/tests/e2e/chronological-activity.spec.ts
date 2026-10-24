import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { AgentEvent, AppSettings, Thread, Workspace } from '../../shared/types';
import type { CodexCapabilities, CodexModel, CodexModelCatalog, CodexRuntimeStatus, CodexThreadState } from '../../shared/codex-cli';
import { applyNativeNotification, projectNativeThread } from '../../server/codex-cli/projection';
import { conversationTimeline, groupConversationTimeline } from '../../client/components/chat/timeline';

// The real native-item projector, ChatPanel, reducer, Markdown and tool controls
// talk to a controlled local HTTP/SSE peer. No CLI/model run is simulated.
const at = '2026-09-20T10:00:00.000Z';
const threadId = '0199a111-1111-7111-8111-111111111111';
const turnId = '0199a222-2222-7222-8222-222222222222';
const workspace: Workspace = { id: 'chronology-workspace', name: 'Chronology fixture', path: '/workspace/chronology', createdAt: at, updatedAt: at };
const capabilities: CodexCapabilities = { conversations: true, pagination: true, queue: true, goals: true, skills: true, plan: true, review: true, historyRevert: true };
const limitedModel: CodexModel = { id: 'fixture-limited-catalog-id', model: 'fixture-limited-wire-id', displayName: 'Limited reasoning fixture',
  description: 'Explicit native catalog test record.', hidden: false, isDefault: false, inputModalities: ['text', 'image'],
  defaultReasoningEffort: 'xhigh', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'].map(reasoningEffort => ({ reasoningEffort, description: reasoningEffort })) };
const solModel: CodexModel = { ...limitedModel, id: 'fixture-sol-catalog-id', model: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', isDefault: true,
  defaultReasoningEffort: 'max', supportedReasoningEfforts: [...limitedModel.supportedReasoningEfforts, { reasoningEffort: 'max', description: 'Max' }] };
const catalog: CodexModelCatalog = { backend: 'codex-cli', connected: true, models: [solModel.model, limitedModel.model], catalog: [solModel, limitedModel] };
const runtime: CodexRuntimeStatus = { backend: 'codex-cli', state: 'ready', version: '0.155.1', installedVersion: '0.155.1',
  startedAt: at, updatedAt: at, canUpdate: false, updateBlockedReason: 'A fixture turn is active.', error: null, activeTurns: 1, capabilities };
const state: CodexThreadState = { model: solModel.model, reasoningEffort: 'max', activeTurnId: turnId,
  approvals: [], questions: [], queue: [], queueCursor: null, goal: null, tokenUsage: null, diff: null, capabilities };
const defaults: AppSettings = { model: 'gpt-5.6-sol', reasoningEffort: 'max', autoApprove: true, theme: 'dark', fontSize: 13,
  wordWrap: true, provider: 'openai', apiKeyConfigured: false, agentConfigured: true };
const seed: Thread = { ...projectNativeThread({ id: threadId, name: 'Chronology fixture', createdAt: Date.parse(at) / 1000,
  updatedAt: Date.parse(at) / 1000, status: { type: 'active' }, turns: [{ id: turnId, status: 'inProgress', startedAt: Date.parse(at) / 1000 }] },
  [{ turnId, item: { type: 'userMessage', id: 'chronology-user', content: [{ type: 'text', text: 'Inspect the two requested files.', text_elements: [] }] } }], workspace.id, state),
  nativePage: { nextCursor: null, backwardsCursor: null } };
type FixtureWindow = Window & { __chronologyFixture: { openedFiles: string[]; notifications: string[] } };
let server: Server, origin = '', script = '', styles = '';
let thread: Thread, settings: AppSettings;
let sequence = 0, streamOpens = 0, messageCount = 0;
const streams = new Set<ServerResponse>();
const requests: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
const historyPages = new Map<string, Thread>(), historyReads: string[] = [];

function emit(fields: Omit<AgentEvent, 'threadId'>, duplicate = false) {
  const event = { ...fields, threadId: thread.id } as AgentEvent;
  const envelope = `id: ${++sequence}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const stream of streams) { stream.write(envelope); if (duplicate) stream.write(envelope); }
}
function reset() {
  for (const stream of streams) stream.end();
  streams.clear(); requests.length = 0; sequence = 0; streamOpens = 0; messageCount = 0;
  historyPages.clear(); historyReads.length = 0;
  thread = structuredClone(seed); settings = { ...defaults };
}
function notification(method: string, fields: Record<string, unknown>, duplicate = false) {
  thread = applyNativeNotification(thread, method, { threadId, turnId, ...fields }, { observedAt: at });
  if (thread.nativeView) thread = { ...thread, nativeView: { ...thread.nativeView, revision: thread.nativeView.revision + 1 } };
  emit({ type: 'snapshot', thread: thread.nativeView ? { ...thread, nativePage: undefined } : thread }, duplicate);
}
function tool(id: string, content: string) {
  notification('item/completed', { item: { type: 'commandExecution', id, command: `cat ${id}.txt`, cwd: workspace.path,
    aggregatedOutput: content, exitCode: 0, status: 'completed' }, startedAtMs: Date.parse(at), completedAtMs: Date.parse(at) }, true);
}
function publicSummary() {
  notification('item/completed', { item: { type: 'reasoning', id: 'chronology-reasoning', summary: ['Checking the saved files before continuing.'],
    content: ['PRIVATE_REASONING_NOT_FOR_RENDERING'], encrypted_content: 'PRIVATE_ENCRYPTED_PAYLOAD' }, completedAtMs: Date.parse(at) });
}
function append(text: string) {
  const id = `chronology-assistant-${++messageCount}`;
  notification('item/started', { item: { type: 'agentMessage', id, text: '' }, startedAtMs: Date.parse(at) });
  notification('item/agentMessage/delta', { itemId: id, delta: text }, true);
  notification('item/completed', { item: { type: 'agentMessage', id, text }, completedAtMs: Date.parse(at) });
}
function finish() {
  notification('turn/completed', { turn: { id: turnId, status: 'completed', startedAt: Date.parse(at) / 1000, completedAt: Date.parse(at) / 1000 } });
}

test.beforeAll(async () => {
  const bundled = await build({
    absWorkingDir: fileURLToPath(new URL('../..', import.meta.url)),
    stdin: { contents: `
      import { createRoot } from 'react-dom/client';
      import ChatPanel from './client/components/ChatPanel';
      import './client/styles.css';
      const root = createRoot(document.getElementById('root'));
      const openedFiles = [], notifications = [];
      window.__chronologyFixture = { openedFiles, notifications };
      fetch('/fixture-config').then(response => response.json()).then(({ workspace, settings }) => {
        root.render(<main className="chronology-test-frame"><ChatPanel workspace={workspace} settings={settings}
          onSettings={() => {}} onNotify={message => notifications.push(message)} onOpenFile={path => openedFiles.push(path)} /></main>);
      });
    `, loader: 'tsx', resolveDir: fileURLToPath(new URL('../..', import.meta.url)) },
    bundle: true, write: false, outfile: 'chronology-fixture.js', format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent',
  });
  script = bundled.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  styles = bundled.outputFiles.find(file => file.path.endsWith('.css'))!.text + '\n#root { height: 100dvh; overflow: hidden; } .chronology-test-frame { height: 100%; max-width: 790px; min-width: 0; margin: 0 auto; display: flex; }';
  reset();
  server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://localhost'), pathname = requestUrl.pathname;
    const reply = (value: unknown, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
    if (pathname === '/' || pathname === '/work') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); return; }
    if (pathname === '/fixture.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(script); return; }
    if (pathname === '/fixture.css') { response.writeHead(200, { 'Content-Type': 'text/css' }); response.end(styles); return; }
    if (pathname === '/fixture-config') { reply({ workspace, settings }); return; }
    if (pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    let body: Record<string, unknown> | undefined;
    if (request.method !== 'GET') {
      let raw = '';
      for await (const chunk of request) raw += String(chunk);
      try { body = raw ? JSON.parse(raw) : undefined; } catch { reply({ error: 'Invalid fixture request.' }, 400); return; }
    }
    requests.push({ method: request.method || 'GET', path: pathname, body });
    if (pathname === '/api/codex/runtime') { reply(runtime); return; }
    if (pathname === '/api/models') { reply(catalog); return; }
    if (pathname === '/api/threads') { const { id, workspaceId, title, createdAt, updatedAt, status, backend, readOnly } = thread; reply([{ id, workspaceId, title, createdAt, updatedAt, status, backend, readOnly }]); return; }
    if (pathname === `/api/threads/${thread.id}`) { reply(thread); return; }
    if (pathname === `/api/threads/${thread.id}/history`) {
      const cursor = requestUrl.searchParams.get('before') ?? requestUrl.searchParams.get('after') ?? '';
      historyReads.push(cursor);
      const page = historyPages.get(cursor);
      if (page) reply(page); else reply({ error: 'Unknown native history fixture cursor.' }, 409);
      return;
    }
    if (pathname === `/api/threads/${thread.id}/events`) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); response.flushHeaders();
      streams.add(response); streamOpens++;
      response.write(`id: ${++sequence}\ndata: ${JSON.stringify({ type: 'snapshot', threadId: thread.id, thread })}\n\n`);
      response.on('close', () => streams.delete(response)); return;
    }
    if (pathname === `/api/threads/${thread.id}/agents`) { reply([]); return; }
    if (pathname === `/api/threads/${thread.id}/queue`) { reply({ items: [], nextCursor: null }); return; }
    if (pathname === `/api/threads/${thread.id}/goal`) { reply({ goal: thread.native!.goal }); return; }
    if (pathname === `/api/workspaces/${workspace.id}/codex/skills`) { reply({ skills: [], errors: [] }); return; }
    if (pathname === '/api/session') { reply({ authenticated: true }); return; }
    if (pathname === '/api/ui-state') { reply({ version: 1, revision: 1, layouts: {}, editor: {}, workspaces: { [workspace.id]: { threadId: thread.id } }, fieldRevisions: {} }); return; }
    if (pathname === `/api/threads/${thread.id}/run` && request.method === 'POST') { thread.status = 'running'; reply({ threadId: thread.id, turnId }, 202); return; }
    reply({ error: `Unexpected chronology fixture route: ${pathname}` }, 404);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.beforeEach(() => reset());
test.afterAll(async () => {
  for (const stream of streams) stream.end();
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

async function mount(page: Page) {
  await page.goto(origin);
  await expect(page.getByRole('region', { name: 'Codex conversation' })).toBeVisible();
  await expect(page.getByText('Inspect the two requested files.', { exact: true })).toBeVisible();
  await expect.poll(() => streams.size).toBe(1);
}
async function visibleOrder(page: Page) {
  return page.locator('.chat-conversation-content .measured-window-row').evaluateAll(elements => elements
    .filter(element => element.matches('.chat-activity-group, .chat-message.is-assistant')
      || element.querySelector('.chat-activity-group, .chat-message.is-assistant'))
    .map(element => element.getAttribute('data-window-key')));
}
function expectedOrder() { return groupConversationTimeline(conversationTimeline(thread), thread)
  .filter(row => row.kind === 'activity-group' || row.kind === 'message' && row.message.role === 'assistant').map(row => row.key); }

test('actual chat preserves tool/text order through live events, reconnect and reload without repeated assistant branding', async ({ page }) => {
  const failures: string[] = []; page.on('pageerror', error => failures.push(error.message));
  await mount(page);
  const panel = page.getByRole('region', { name: 'Codex conversation' });
  tool('first', 'First inspectable fixture contents.');
  publicSummary();
  append('Between the reads, inspect the [first source](first.txt).');
  await panel.getByRole('button', { name: 'Copy response', exact: true }).focus();
  tool('second', 'Second inspectable fixture contents.');
  append('Both reads are now represented in their recorded order.');
  await expect.poll(() => visibleOrder(page)).toEqual(expectedOrder());
  await expect(panel.getByRole('button', { name: 'Copy response', exact: true }).first()).toBeFocused();
  await expect(panel.locator('.chat-message-heading, .chat-agent-symbol')).toHaveCount(0);
  await expect(panel.getByText('Codex', { exact: true })).toHaveCount(0);
  await expect(panel.getByRole('article', { name: 'Assistant response', exact: true })).toHaveCount(2);
  await expect(panel.getByRole('button', { name: 'Copy response', exact: true })).toHaveCount(2);
  await expect(panel.locator('.chat-activity-group-toggle')).toHaveCount(2);
  await expect(panel.locator('.chat-activity-group-toggle').first()).toHaveAttribute('aria-expanded', 'false');
  await panel.locator('.chat-activity-group-toggle').first().click();
  await expect(panel.getByText('Checking the saved files before continuing.', { exact: true })).toBeVisible();
  expect(await page.content()).not.toMatch(/PRIVATE_REASONING_NOT_FOR_RENDERING|PRIVATE_ENCRYPTED_PAYLOAD|encrypted_content/);
  const firstTool = panel.locator('.chat-timeline-activity').first().getByRole('button').first();
  await firstTool.focus(); await page.keyboard.press('Enter');
  await expect(panel.getByText('First inspectable fixture contents.', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'first source', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).__chronologyFixture.openedFiles)).toEqual(['first.txt']);
  expect(await panel.locator('.chat-conversation-content').innerText()).not.toContain('"content"');

  const previousOpens = streamOpens;
  for (const stream of streams) stream.end();
  await expect.poll(() => streamOpens, { timeout: 10_000 }).toBeGreaterThan(previousOpens);
  await expect.poll(() => visibleOrder(page)).toEqual(expectedOrder());
  await expect(panel.getByText('First inspectable fixture contents.', { exact: true })).toBeVisible();
  finish();
  await expect(panel.getByRole('button', { name: 'Stop response', exact: true })).toHaveCount(0);
  const savedOrder = expectedOrder();
  await page.reload();
  await expect.poll(() => visibleOrder(page)).toEqual(savedOrder);
  await expect(panel.locator('.chat-activity-group-toggle')).toHaveCount(2);
  await expect(panel.locator('.chat-timeline-activity')).toHaveCount(0);
  await expect(panel.getByRole('article', { name: 'Assistant response', exact: true })).toHaveCount(2);
  expect(failures).toEqual([]);
});

test('chronological controls remain usable in phone and tablet panes with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(page);
  tool('first', 'Read this fixture output with the keyboard or touch.');
  append('The first result is available.');
  tool('second', 'The second output stays after the assistant text.');
  append('The full response can still be copied.'); finish();
  const panel = page.getByRole('region', { name: 'Codex conversation' });
  await expect(panel.getByRole('button', { name: 'Stop response', exact: true })).toHaveCount(0);
  for (const control of await panel.locator('.chat-activity-group-toggle').all()) await control.click();
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    await expect.poll(() => visibleOrder(page)).toEqual(expectedOrder());
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    for (const control of await panel.locator('.chat-activity-group-toggle, .chat-timeline-activity .chat-activity-summary, .chat-timeline-copy .chat-copy').all()) {
      const bounds = await control.boundingBox(); expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await panel.locator('.chat-conversation-content').evaluate(element => [element, ...element.querySelectorAll('*')].every(node => {
      const style = getComputedStyle(node); return style.boxShadow === 'none' && style.textShadow === 'none' && style.backdropFilter === 'none' && style.animationName === 'none';
    }))).toBe(true);
  }
});

test('one native reasoning item with seven summary sections shows one Reasoning disclosure through streaming and reload', async ({ page }) => {
  await mount(page);
  const panel = page.getByRole('region', { name: 'Codex conversation' });
  // The observed native shape has seven heading-only summary sections in ONE
  // item. These IDs and headings are fictional; no live conversation data is stored.
  const headings = ['Inspecting the request', 'Checking available context', 'Reviewing source files',
    'Checking reported behavior', 'Considering a correction', 'Verifying the result', 'Preparing the response'];
  const summary = headings.map(heading => `**${heading}**`), itemId = 'fixture-seven-section-reasoning';
  append('Before the public reasoning sections.');
  notification('item/started', { item: { type: 'reasoning', id: itemId, summary: [] } });
  const disclosure = panel.locator('.chat-activity-group-toggle');
  for (const [summaryIndex, delta] of summary.entries()) {
    notification('item/reasoning/summaryPartAdded', { itemId, summaryIndex });
    notification('item/reasoning/summaryTextDelta', { itemId, summaryIndex, delta });
    if (summaryIndex === 0) {
      await expect(disclosure).toHaveCount(1);
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
      await disclosure.click();
    }
    await expect(panel.locator('.chat-timeline-reasoning .chat-markdown strong')).toHaveText(headings.slice(0, summaryIndex + 1));
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await expect(disclosure.locator('.chat-activity-group-count')).toHaveText('');
  }
  notification('item/completed', { item: { type: 'reasoning', id: itemId, summary, content: ['PRIVATE_REASONING_MUST_NOT_RENDER'] } }, true);
  append('After the public reasoning sections.');
  const anchors = thread.timeline!.entries.filter(entry => entry.kind === 'reasoning' && entry.messageId === itemId).map(entry => entry.id);
  const verify = async () => {
    await expect(disclosure).toContainText('Reasoning');
    await expect(disclosure).not.toContainText('steps');
    await expect(panel.locator(`.chat-activity-group-entry[data-reasoning-item="${itemId}"]`)).toHaveCount(1);
    await expect(panel.locator('.chat-timeline-reasoning .chat-markdown strong')).toHaveText(headings);
    await expect(panel.locator('.chat-timeline-reasoning-heading')).toHaveCount(0);
    expect(await panel.locator('.chat-timeline-reasoning').evaluateAll(elements => elements.map(element => Number(element.getAttribute('data-reasoning-section'))))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(await panel.locator('.chat-activity-group-details [data-timeline-entry]').evaluateAll(elements => elements.map(element => element.getAttribute('data-timeline-entry')))).toEqual(anchors);
    expect(await panel.locator('.chat-conversation-content').innerText()).not.toContain('Reasoning summary');
    expect(await page.content()).not.toContain('PRIVATE_REASONING_MUST_NOT_RENDER');
    await expect.poll(() => visibleOrder(page)).toEqual(expectedOrder());
  };
  await verify();
  finish();
  await page.reload();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await disclosure.click();
  await verify();
});

test('replayed completion of one commentary item keeps one message and one native turn ending', async ({ page }) => {
  await mount(page);
  const panel = page.getByRole('region', { name: 'Codex conversation' });
  const commentary = 'I will review the project and check its published documentation.';
  publicSummary();
  notification('item/started', { item: { type: 'agentMessage', id: 'fixture-commentary', phase: 'commentary', text: '' } });
  notification('item/agentMessage/delta', { itemId: 'fixture-commentary', delta: commentary }, true);
  notification('item/completed', { item: { type: 'agentMessage', id: 'fixture-commentary', phase: 'commentary', text: commentary } }, true);
  notification('item/completed', { item: { type: 'reasoning', id: 'fixture-next-reasoning', summary: ['A later public summary section.'] } });
  // A completed item can be repeated after another item without becoming a new message.
  notification('item/completed', { item: { type: 'agentMessage', id: 'fixture-commentary', phase: 'commentary', text: commentary } }, true);
  tool('fixture-first-command', 'First recorded command output.');
  tool('fixture-second-command', 'Second recorded command output.');
  notification('item/completed', { item: { type: 'agentMessage', id: 'fixture-final-answer', phase: 'final_answer', text: 'The verified final response.' } });
  finish();
  await expect(panel.getByText(commentary, { exact: true })).toHaveCount(1);
  await expect(panel.getByRole('article', { name: 'Assistant response', exact: true })).toHaveCount(2);
  await expect(panel.getByRole('button', { name: 'Copy response', exact: true })).toHaveCount(2);
  await expect(panel.locator('.chat-turn-boundary')).toHaveCount(1);
  await expect.poll(() => visibleOrder(page)).toEqual(expectedOrder());
  await page.reload();
  await expect(panel.getByText(commentary, { exact: true })).toHaveCount(1);
  await expect(panel.getByRole('button', { name: 'Copy response', exact: true })).toHaveCount(2);
  await expect(panel.locator('.chat-turn-boundary')).toHaveCount(1);
});

test('canonical partial history replaces live item identities while preserving real turns, paging and late-frame fences', async ({ page }) => {
  const olderTurn = '0199a333-3333-7333-8333-333333333333';
  const commentary = 'I will inspect the current project and its published documentation.';
  const olderItems = [
    { turnId: olderTurn, item: { type: 'userMessage', id: 'prior-user', content: [{ type: 'text', text: 'An earlier genuine request.' }] } },
    { turnId: olderTurn, item: { type: 'agentMessage', id: 'prior-commentary', phase: 'commentary', text: commentary } },
    { turnId: olderTurn, item: { type: 'agentMessage', id: 'prior-final', phase: 'final_answer', text: 'The earlier final answer.' } },
  ];
  const metadata = { id: threadId, name: 'Identity handoff fixture', createdAt: Date.parse(at) / 1000, updatedAt: Date.parse(at) / 1000,
    status: { type: 'active' }, turns: [
      { id: olderTurn, status: 'completed', startedAt: Date.parse(at) / 1000 - 60, completedAt: Date.parse(at) / 1000 - 30 },
      { id: turnId, status: 'inProgress', startedAt: Date.parse(at) / 1000 },
    ] };
  const earlierView = { turnId: olderTurn, identity: 'legacy' as const, revision: 1, coverage: 'complete' as const };
  thread = { ...projectNativeThread(metadata, [...olderItems,
    { turnId, item: { type: 'userMessage', id: 'chronology-user', content: [{ type: 'text', text: 'Inspect the two requested files.' }] } }], workspace.id, state),
    nativePage: { nextCursor: null, backwardsCursor: null },
    nativeView: { epoch: 'fixture-producer', revision: 1, historyMode: 'legacy', turns: [earlierView,
      { turnId, identity: 'native', revision: 2, coverage: 'complete' }] } };
  await mount(page);
  const panel = page.getByRole('region', { name: 'Codex conversation' });
  const scroller = panel.getByRole('region', { name: 'Conversation messages', exact: true });
  notification('item/completed', { item: { type: 'reasoning', id: 'live-first-reasoning', summary: ['**Reviewing the project**\n\nA public overview.'] } });
  notification('item/started', { item: { type: 'agentMessage', id: 'live-commentary', phase: 'commentary', text: '' } });
  notification('item/agentMessage/delta', { itemId: 'live-commentary', delta: commentary });
  notification('item/completed', { item: { type: 'agentMessage', id: 'live-commentary', phase: 'commentary', text: commentary } });
  notification('item/completed', { item: { type: 'reasoning', id: 'live-later-reasoning', summary: ['**Checking the details**'] } });
  tool('shared-command-one', 'A real recorded command result.');
  tool('shared-command-two', 'Another recorded result.');
  notification('item/completed', { item: { type: 'agentMessage', id: 'live-final', phase: 'final_answer', text: 'The current final answer.' } });
  finish();
  await expect(panel.getByText(commentary, { exact: true })).toHaveCount(2);
  await expect(panel.getByRole('button', { name: 'Copy response', exact: true })).toHaveCount(4);
  await expect(panel.locator('.chat-turn-boundary')).toHaveCount(2);
  await panel.getByRole('textbox', { name: 'Message Codex', exact: true }).focus();
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
  const retired = structuredClone(thread);
  const completedMetadata = { ...metadata, status: { type: 'idle' }, turns: metadata.turns.map(turn => ({ ...turn, status: 'completed', completedAt: Date.parse(at) / 1000 })) };
  const complete = projectNativeThread(completedMetadata, [...olderItems,
    { turnId, item: { type: 'userMessage', id: 'stored-current-user', content: [{ type: 'text', text: 'Inspect the two requested files.' }] } },
    { turnId, item: { type: 'reasoning', id: 'stored-first-reasoning', summary: ['**Reviewing the project**\n\nA public overview.'] } },
    { turnId, item: { type: 'agentMessage', id: 'stored-commentary', phase: 'commentary', text: commentary } },
    { turnId, item: { type: 'reasoning', id: 'stored-later-reasoning', summary: ['**Checking the details**'] } },
    ...['shared-command-one', 'shared-command-two'].map(id => ({ turnId, item: { type: 'commandExecution', id, command: `cat ${id}.txt`, cwd: workspace.path, status: 'completed', aggregatedOutput: 'Recorded output.', exitCode: 0 } })),
    { turnId, item: { type: 'agentMessage', id: 'stored-final', phase: 'final_answer', text: 'The current final answer.' } },
  ], workspace.id, { ...state, activeTurnId: null });
  const savedView = { turnId, identity: 'legacy' as const, revision: 3, coverage: 'partial' as const };
  const source = { epoch: 'fixture-producer', revision: retired.nativeView!.revision + 1, historyMode: 'legacy' as const };
  const slice = (ids: string[], nextCursor: string | null, turns: NonNullable<Thread['nativeView']>['turns']): Thread => {
    const selected = new Set(ids);
    return { ...complete, messages: complete.messages.filter(message => selected.has(message.id)),
      timeline: { ...complete.timeline!, entries: complete.timeline!.entries.filter(entry => selected.has(entry.messageId)) },
      nativePage: { nextCursor, backwardsCursor: 'actual-native-reverse' }, nativeView: { ...source, turns } };
  };
  thread = slice(['stored-commentary', 'stored-later-reasoning', 'shared-command-one', 'shared-command-two', 'stored-final'], 'canonical-prefix', [savedView]);
  historyPages.set('canonical-prefix', slice(['stored-current-user', 'stored-first-reasoning'], 'prior-turn-page', [savedView]));
  historyPages.set('prior-turn-page', slice(['prior-user', 'prior-commentary', 'prior-final'], null, [earlierView]));
  emit({ type: 'snapshot', thread });
  const currentKey = complete.timeline!.entries.find(entry => entry.messageId === 'stored-commentary')!.id;
  await expect(panel.locator(`[data-timeline-entry="${currentKey}"]`)).toBeVisible();
  await scroller.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
  await expect.poll(() => historyReads).toContain('canonical-prefix');
  await expect.poll(() => historyReads).toContain('prior-turn-page');
  const verify = async () => {
    await expect(panel.getByText(commentary, { exact: true })).toHaveCount(2); // One per genuine native turn.
    await expect(panel.getByRole('button', { name: 'Copy response', exact: true })).toHaveCount(4);
    await expect(panel.locator('.chat-turn-boundary')).toHaveCount(2);
    await expect(panel.getByText('The earlier final answer.', { exact: true })).toBeVisible();
    await expect(panel.getByText('The current final answer.', { exact: true })).toBeVisible();
  };
  await verify();
  emit({ type: 'snapshot', thread: retired });
  await verify();
  await expect(panel.getByRole('button', { name: 'Stop response', exact: true })).toHaveCount(0);
  await page.reload();
  await scroller.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
  await verify();
});

test('streaming groups stay collapsed and only the current action animates across message boundaries', async ({ page }) => {
  await mount(page);
  const panel = page.getByRole('region', { name: 'Codex conversation' });
  notification('item/started', { item: { type: 'reasoning', id: 'streamed-reason', summary: [] } });
  notification('item/reasoning/summaryPartAdded', { itemId: 'streamed-reason', summaryIndex: 0 });
  notification('item/reasoning/summaryTextDelta', { itemId: 'streamed-reason', summaryIndex: 0, delta: 'Public streaming summary for this fixture.' });
  const first = panel.locator('.chat-activity-group-toggle').first();
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.getByText('Public streaming summary for this fixture.', { exact: true })).toHaveCount(0);
  notification('item/started', { item: { type: 'commandExecution', id: 'streamed-command', command: 'cat first.txt', cwd: workspace.path, status: 'inProgress', aggregatedOutput: '' } });
  await expect(panel.locator('.chat-activity-group-toggle')).toHaveCount(1);
  await expect(panel.locator('.chat-activity-group-icon.arc-activity-pulse[data-active="true"]')).toHaveCount(1);
  await first.focus(); await page.keyboard.press('Enter');
  await expect(panel.getByText('Public streaming summary for this fixture.', { exact: true })).toBeVisible();
  await expect(panel.locator('.chat-activity-group .chat-spin')).toHaveCount(0);
  append('The earlier activity remains available above this message.');
  await expect(panel.locator('.chat-activity-group-icon.arc-activity-pulse[data-active="true"]')).toHaveCount(0);
  notification('item/started', { item: { type: 'commandExecution', id: 'current-command', command: 'cat second.txt', cwd: workspace.path, status: 'inProgress', aggregatedOutput: '' } });
  await expect(panel.locator('.chat-activity-group-toggle')).toHaveCount(2);
  await expect(panel.locator('.chat-activity-group-toggle').last()).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.locator('.chat-activity-group-icon.arc-activity-pulse[data-active="true"]')).toHaveCount(1);
  await first.click();
  notification('item/commandExecution/outputDelta', { itemId: 'current-command', delta: 'A streamed tool result.\n' }, true);
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.locator('.chat-activity-group-toggle').last()).toHaveAttribute('aria-expanded', 'false');
  notification('turn/completed', { turn: { id: turnId, status: 'interrupted', startedAt: Date.parse(at) / 1000, completedAt: Date.parse(at) / 1000 } });
  await expect(panel.locator('.chat-activity-group-icon.arc-activity-pulse[data-active="true"]')).toHaveCount(0);
  await expect(panel.locator('.chat-activity-group-toggle').last()).toContainText('Interrupted');
  await expect(panel.locator('.chat-activity-group-toggle').last()).toHaveAttribute('aria-expanded', 'false');
});

test('group and tool choices survive measured-window unmount and remount without duplicating canonical entries', async ({ page }) => {
  tool('retained', 'This opened output survives leaving the viewport.');
  append('The activity above can be reopened without losing the selected disclosure.');
  for (let index = 0; index < 45; index++) append(`Later saved response ${index + 1}.\n\n${'A recorded paragraph keeps this history long enough to window. '.repeat(8)}`);
  finish();
  await page.goto(origin);
  const panel = page.getByRole('region', { name: 'Codex conversation' });
  const scroller = panel.getByRole('region', { name: 'Conversation messages', exact: true });
  await expect(panel).toBeVisible();
  await expect.poll(() => streams.size).toBe(1);
  await scroller.focus();
  await scroller.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
  const group = panel.locator('.chat-activity-group-toggle');
  await expect(group).toHaveCount(1);
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  await group.click();
  const toolToggle = panel.locator('.chat-timeline-activity .chat-activity-summary');
  await toolToggle.click();
  await expect(panel.getByText('This opened output survives leaving the viewport.', { exact: true })).toBeVisible();
  // Release the interaction pin before leaving this row.
  await panel.getByRole('textbox', { name: 'Message Codex', exact: true }).focus();
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
  await expect(group).toHaveCount(0);
  await scroller.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
  await expect(group).toHaveCount(1);
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  await expect(toolToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByText('This opened output survives leaving the viewport.', { exact: true })).toBeVisible();
  await group.click();
  await panel.getByRole('textbox', { name: 'Message Codex', exact: true }).focus();
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
  await expect(group).toHaveCount(0);
  await scroller.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
  await expect(group).toHaveAttribute('aria-expanded', 'false');
});

test('retains an unavailable native-model effort visibly and submits only the explicit supported wire choice', async ({ page }) => {
  settings = { ...defaults, model: limitedModel.model, reasoningEffort: 'max' };
  thread.status = 'idle'; thread.turns![0].status = 'completed'; thread.turns![0].completedAt = at;
  thread.native!.activeTurnId = null;
  thread.native!.model = limitedModel.model;
  await mount(page);
  const panel = page.getByRole('region', { name: 'Codex conversation' });
  const effort = panel.getByRole('combobox', { name: 'Reasoning effort', exact: true });
  const model = panel.getByRole('combobox', { name: 'Model', exact: true });
  await panel.getByRole('textbox', { name: 'Message Codex', exact: true }).fill('Keep this draft until a supported choice is selected.');
  await expect(effort).toHaveText('max');
  await expect(panel.getByText('Limited reasoning fixture does not offer reasoning effort “max”. Choose an available effort or the Codex default.', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  await effort.click();
  await expect(page.getByRole('option', { name: 'max', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await model.click();
  const sol = page.getByRole('option', { name: `${solModel.displayName} ${solModel.model} · ${solModel.description}`, exact: true });
  await expect(sol).toHaveAttribute('data-value', 'gpt-5.6-sol');
  await sol.click();
  await expect(model).toHaveText('GPT-5.6 Sol');
  await expect(effort).toHaveText('max');
  await model.click();
  const limited = page.getByRole('option', { name: `${limitedModel.displayName} ${limitedModel.model} · ${limitedModel.description}`, exact: true });
  await expect(limited).toHaveAttribute('data-value', limitedModel.model);
  await limited.click();
  await expect(model).toHaveText(limitedModel.displayName);
  await expect(effort).toHaveText('max');
  await effort.click(); await page.getByRole('option', { name: 'xhigh', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await panel.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => requests.filter(request => request.path.endsWith('/run')).length).toBe(1);
  expect(requests.find(request => request.path.endsWith('/run'))!.body).toMatchObject({ model: limitedModel.model, reasoningEffort: 'xhigh', prompt: 'Keep this draft until a supported choice is selected.' });
  expect(JSON.stringify(requests)).not.toContain(limitedModel.id);
});
