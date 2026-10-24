import { expect, test, type Locator, type Page, type Request as BrowserRequest } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { AppSettings, ChatMessage, CodexModel, CodexRuntimeStatus, ConversationTimelineEntry, Thread, ThreadTurn, ToolActivity, UiState, UiStatePatch, Workspace } from '../../shared/types';
import { expandActivityGroups } from '../activity-group-browser';

// Controlled fixture records exercise the production window, timeline and native
// child disclosure. They are never provider calls or answers shipped in the app.
const at = '2026-09-20T12:00:00.000Z';
const ROOT_ID = '0199e111-1111-7111-8111-111111111111';
const CHILD_ID = '0199e222-2222-7222-8222-222222222222';
const OTHER_ROOT_ID = '0199e333-3333-7333-8333-333333333333';
const OTHER_CHILD_ID = '0199e444-4444-7444-8444-444444444444';
const PARENT_ENTRIES = 256;
const workspace: Workspace = { id: 'first-mount-workspace', name: 'Measured window fixture', path: '/workspace/measured', createdAt: at, updatedAt: at };
const nativeWorkspace: Workspace = { ...workspace, id: '11111111-1111-4111-8111-111111111111', path: '/data/workspaces/11111111-1111-4111-8111-111111111111' };
const nativeModel: CodexModel = { id: 'native-fixture-model', model: 'gpt-5.6-sol', displayName: 'Native fixture model', description: 'Controlled native metadata.',
  hidden: false, isDefault: true, inputModalities: ['text'], supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Native medium.' }], defaultReasoningEffort: 'medium' };
const nativeSettings: AppSettings = { model: nativeModel.model, reasoningEffort: 'medium', reasoningSummary: 'auto', autoApprove: false, theme: 'dark',
  fontSize: 13, wordWrap: true, provider: 'openai', apiKeyConfigured: false, agentConfigured: true };
const capabilities = { conversations: true, pagination: true, queue: true, goals: true, skills: true, plan: true, review: true, historyRevert: true };
const runtime: CodexRuntimeStatus = { backend: 'codex-cli', state: 'ready', version: '0.155.1', installedVersion: '0.155.1', startedAt: at, updatedAt: at,
  canUpdate: true, updateBlockedReason: null, error: null, activeTurns: 0, capabilities };

type EntryInput<T = ConversationTimelineEntry> = T extends ConversationTimelineEntry ? Omit<T, 'sequence' | 'revision'> : never;
type Geometry = { top: number; height: number; marginTop: number; marginBottom: number };
type HeldChildRefresh = { captured: boolean; response?: ServerResponse; payload?: Thread[]; writtenBody?: string; release: () => void };
let server: Server, origin = '', script = '', styles = '', sequence = 0;
let parent: Thread, otherParent: Thread, child: Thread, otherChild: Thread, uiState: UiState;
let heldChildRefresh: HeldChildRefresh | null = null;
const streams = new Set<ServerResponse>();
const requests: Array<{ path: string; query: Record<string, string> }> = [];
const unexpected: string[] = [];

function transcript(id: string, turns: number): Thread {
  const messages: ChatMessage[] = [], entries: ConversationTimelineEntry[] = [], completedTurns: ThreadTurn[] = [];
  for (let ordinal = 1; ordinal <= turns; ordinal++) {
    const firstSequence = entries.length + 1, turnId = `${id}-turn-${ordinal}`;
    const user: ChatMessage = { id: `${id}-user-${ordinal}`, role: 'user', content: `Stored fixture task ${ordinal}.`, createdAt: at, ordinal: messages.length + 1, turnId };
    const activities: ToolActivity[] = ['source', 'result'].map(part => ({ id: `${id}-activity-${ordinal}-${part}`, name: 'read_file',
      input: JSON.stringify({ path: `fixture-${ordinal}-${part}.txt` }),
      output: JSON.stringify({ path: `fixture-${ordinal}-${part}.txt`, version: 'fixture-version',
        content: `Inspectable fixture ${ordinal} ${part}.\n${Array.from({ length: part === 'result' ? 16 : 3 }, (_, index) => `Stored fixture line ${index + 1}.`).join('\n')}` }),
      status: 'completed', startedAt: at, completedAt: at }));
    const assistant: ChatMessage = { id: `${id}-assistant-${ordinal}`, role: 'assistant', createdAt: at, ordinal: messages.length + 2, turnId, activities,
      content: `Explicit fixture response ${ordinal}.\n\n${'This stored paragraph wraps differently when the pane width changes. '.repeat(2 + ordinal % 3)}` };
    messages.push(user, assistant);
    const add = (entry: EntryInput) => entries.push({ ...entry, sequence: entries.length + 1, revision: entries.length + 1 });
    add({ id: `${id}-entry-${firstSequence}`, kind: 'message', messageId: user.id });
    add({ id: `${id}-entry-${firstSequence + 1}`, kind: 'text', messageId: assistant.id, text: assistant.content, startOffset: 0 });
    add({ id: `${id}-entry-${firstSequence + 2}`, kind: 'activity', messageId: assistant.id, activityId: activities[0].id });
    add({ id: `${id}-entry-${firstSequence + 3}`, kind: 'activity', messageId: assistant.id, activityId: activities[1].id });
    completedTurns.push({ id: turnId, userMessageId: user.id, messageIds: [user.id, assistant.id], startedAt: at, completedAt: at,
      status: 'completed', ordinal, firstSequence, lastSequence: entries.length });
  }
  return { id, workspaceId: workspace.id, title: 'Explicit stored transcript fixture', createdAt: at, updatedAt: at, status: 'idle', goal: null,
    ...(id === CHILD_ID ? { parentThreadId: ROOT_ID, rootThreadId: ROOT_ID } : {}), messages, turns: completedTurns,
    timeline: { version: 1, revision: entries.length, nextSequence: entries.length + 1, entries } };
}

function nativeTranscript(id: string, title: string, turns: number, rootId?: string): Thread {
  const source = transcript(id, turns), messages: ChatMessage[] = [];
  const nativeTurns = new Map(source.turns!.map((turn, index) => [turn.id, '0199efff-ffff-7fff-8fff-' + String(index + 1).padStart(12, '0')]));
  for (const message of source.messages) {
    const { ordinal: _ordinal, activities, ...text } = message;
    messages.push({ ...text, turnId: nativeTurns.get(message.turnId!) });
    for (const activity of activities ?? []) {
      const input = JSON.parse(activity.input), output = JSON.parse(activity.output!);
      const command: ToolActivity = { ...activity, name: 'exec_command', input: JSON.stringify({ cmd: 'cat ' + input.path, workdir: nativeWorkspace.path }),
        output: JSON.stringify({ output: output.content, exit_code: 0 }) };
      messages.push({ id: activity.id, role: 'assistant', content: '', turnId: nativeTurns.get(message.turnId!), createdAt: at, activities: [command] });
    }
  }
  return { ...source, id, title, workspaceId: nativeWorkspace.id, backend: 'codex-cli', readOnly: false, messages,
    ...(rootId ? { parentThreadId: rootId, rootThreadId: rootId } : { parentThreadId: undefined, rootThreadId: undefined }),
    turns: source.turns!.map(({ ordinal: _ordinal, firstSequence: _first, lastSequence: _last, ...turn }) => ({ ...turn, id: nativeTurns.get(turn.id)!,
      messageIds: messages.filter(message => message.turnId === nativeTurns.get(turn.id)).map(message => message.id) })),
    timeline: { ...source.timeline!, entries: source.timeline!.entries.map(entry => entry.kind === 'activity' ? { ...entry, messageId: entry.activityId } : entry) },
    nativePage: { nextCursor: null, backwardsCursor: null },
    native: { loaded: true, model: nativeModel.model, reasoningEffort: 'medium', activeTurnId: null, approvals: [], questions: [], queue: [], queueCursor: null,
      goal: null, tokenUsage: null, diff: null, capabilities } };
}

function holdChildListRefresh(): HeldChildRefresh {
  if (heldChildRefresh) throw new Error('A native child metadata read is already held.');
  const held: HeldChildRefresh = { captured: false, release() {
    if (!held.response || !held.payload) throw new Error('The native child list was not requested.');
    for (const value of held.payload) { value.title = 'Obsolete child window'; for (const message of value.messages) message.content = 'Obsolete child window: ' + message.id; }
    if (!held.response.destroyed && !held.response.writableEnded) {
      held.writtenBody = JSON.stringify(held.payload);
      held.response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); held.response.end(held.writtenBody);
    }
  } };
  heldChildRefresh = held;
  return held;
}

function reset() {
  for (const stream of streams) stream.end();
  heldChildRefresh?.response?.destroy(); heldChildRefresh = null;
  streams.clear(); requests.length = 0; unexpected.length = 0; sequence = 0;
  parent = nativeTranscript(ROOT_ID, 'First native parent', PARENT_ENTRIES / 4);
  otherParent = nativeTranscript(OTHER_ROOT_ID, 'Other native parent', 8);
  child = nativeTranscript(CHILD_ID, 'Mount fixture', 2, ROOT_ID);
  otherChild = nativeTranscript(OTHER_CHILD_ID, 'Other native child', 2, OTHER_ROOT_ID);
  uiState = { version: 1, revision: 0, layouts: {}, editor: {}, workspaces: { [nativeWorkspace.id]: { threadId: ROOT_ID } }, fieldRevisions: {} };
}

test.beforeAll(async () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const bundle = await build({ absWorkingDir: root, stdin: { loader: 'tsx', resolveDir: root, contents: `
    import { useRef } from 'react';
    import { createRoot } from 'react-dom/client';
    import './client/styles.css';
    import './client/components/chat.css';
    import { MeasuredWindow } from './client/components/chat/MeasuredWindow';
    import { ConversationTimeline } from './client/components/chat/ConversationTimeline';
    import { conversationTimeline } from './client/components/chat/timeline';
    import { MarkdownMessage } from './client/components/chat/MarkdownMessage';
    import { TurnActions } from './client/components/chat/ThreadControls';
    import ChatPanel from './client/components/ChatPanel';
    import { hydrateUiState } from './client/ui-state';
    const mode = new URLSearchParams(location.search).get('fixture') || 'child';
    const notifications = [];
    const onNotify = message => notifications.push(message);
    const focusItems = Array.from({ length: 90 }, (_, index) => ({ id: 'focus-row-' + index, index }));
    const chooserItems = Array.from({ length: 100 }, (_, index) => ({ id: 'chooser-row-' + index, index }));
    const key = item => item.id;
    const choiceHeight = item => 64 + item.index % 4 * 19;
    const estimateChoice = item => choiceHeight(item) + 4;
    const estimateFocus = () => 96;
    function FocusFixture() {
      const scrollRef = useRef(null);
      return <main className="window-focus-frame">
        <h1>Initial focus fixture</h1><button type="button" className="button" aria-label="Outside fixture focus">Outside fixture focus</button>
        <div className="focus-fixture-scroll" ref={scrollRef} role="region" aria-label="Focused row fixture">
          <MeasuredWindow items={focusItems} itemKey={key} estimateHeight={estimateFocus} scrollRef={scrollRef}
            resetKey="initial-focus" initialEdge="start" overscan={80} renderItem={item =>
              <article className="focus-fixture-row" data-fixture-index={item.index}>
                <strong>Stored row {item.index + 1}</strong>
                {item.index === 0 ? <input autoFocus aria-label="Initially focused fixture field" defaultValue="Saved fixture draft" /> : <p>Explicit inert fixture contents.</p>}
              </article>} />
        </div>
      </main>;
    }
    function ChooserFixture() {
      const scrollRef = useRef(null);
      return <main className="window-focus-frame chat-panel chooser-fixture-panel">
        <h1>Saved conversation geometry fixture</h1>
        <div className="chat-history-list chooser-fixture-scroll" ref={scrollRef} tabIndex={0} role="region" aria-label="Variable saved rows">
          <MeasuredWindow items={chooserItems} itemKey={key} estimateHeight={estimateChoice} scrollRef={scrollRef}
            resetKey="chooser-geometry" initialEdge="start" overscan={120} renderItem={item =>
              <div className="chat-history-item" data-fixture-index={item.index} style={{ height: choiceHeight(item) }}>
                <button type="button" className="chat-history-select"><span><strong>Saved fixture {item.index + 1}</strong><small>Variable-height stored row</small></span></button>
              </div>} />
        </div>
      </main>;
    }
    function SpacingFixture({ thread, workspace }) {
      const scrollRef = useRef(null), handleRef = useRef(null);
      const rows = conversationTimeline(thread);
      return <main className="window-focus-frame spacing-fixture-panel">
        <h1>Logical timeline spacing fixture</h1>
        <div className="fixture-controls">
          <button type="button" className="button" onClick={() => handleRef.current?.jumpToKey('spacing-entry-3', 'center')}>Show adjacent activity pair</button>
          <button type="button" className="button" onClick={() => handleRef.current?.jumpToKey('spacing-entry-4', 'start')}>Align second activity</button>
          <button type="button" className="button" onClick={() => handleRef.current?.jumpToKey('turn-end:spacing-turn-1', 'start')}>Align turn boundary</button>
        </div>
        <div className="chat-conversation spacing-fixture-scroll" ref={scrollRef} tabIndex={0} role="region" aria-label="Logical spacing transcript">
          <div className="chat-conversation-content">
            <ConversationTimeline rows={rows} thread={thread} workspacePath={workspace.path} onNotify={onNotify}
              window={{ scrollRef, resetKey: 'logical-spacing', initialEdge: 'start', overscan: 0, handleRef }}
              renderMessage={({ key, message, content }) => <article className={'chat-message is-' + message.role} data-timeline-entry={key}>
                {message.role === 'user' ? <div className="chat-user-content">{content}</div> : <MarkdownMessage content={content} workspacePath={workspace.path} onNotify={onNotify} />}
              </article>}
              renderTurnEnd={(turn, ordinal) => <div className="chat-turn-boundary"><TurnActions label={'fixture turn ' + ordinal} onFork={() => {}} onRewind={() => {}} /></div>} />
          </div>
        </div>
      </main>;
    }
    fetch('/fixture-config?fixture=' + encodeURIComponent(mode)).then(response => response.json()).then(async config => {
      if (mode === 'child') await hydrateUiState(config.uiState, [config.workspace]);
      createRoot(document.getElementById('root')).render(mode === 'focus' ? <FocusFixture /> : mode === 'chooser' ? <ChooserFixture />
        : mode === 'spacing' ? <SpacingFixture {...config} /> : <main className="window-focus-frame child-fixture-frame">
          <ChatPanel workspace={config.workspace} settings={config.settings} onNotify={onNotify} onSettings={() => {}} />
        </main>);
    });
  ` }, bundle: true, write: false, outfile: 'measured-focus-fixture.js', format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent' });
  script = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  styles = bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text + `
    #root { height: 100dvh; overflow: auto; }
    .window-focus-frame { width: calc(100% - 32px); max-width: 740px; margin: 16px auto; padding: 12px; }
    .window-focus-frame h1 { margin: 0 0 12px; font-size: 15px; }
    .fixture-controls { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .focus-fixture-scroll { height: 300px; overflow: auto; overflow-anchor: none; display: flex; flex-direction: column; margin-top: 12px; }
    .focus-fixture-row { height: 96px; min-height: 96px; box-sizing: border-box; padding: 10px; margin: 0; }
    .focus-fixture-row strong, .focus-fixture-row input { display: block; }
    .focus-fixture-row input { margin-top: 8px; border: 1px solid var(--border); padding: 7px; }
    .chooser-fixture-panel { height: auto; }
    .chooser-fixture-scroll { flex: none; height: 320px; padding: 0; border: 1px solid var(--border); }
    .spacing-fixture-scroll { height: 360px; border: 1px solid var(--border); }
    .child-fixture-frame { height: calc(100dvh - 32px); padding: 0; }
  `;
  reset();
  server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://localhost'), path = url.pathname;
    const reply = (value: unknown, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
    if (path === '/') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); return; }
    if (path === '/fixture.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(script); return; }
    if (path === '/fixture.css') { response.writeHead(200, { 'Content-Type': 'text/css' }); response.end(styles); return; }
    if (path === '/fixture-config') { reply(url.searchParams.get('fixture') === 'spacing' ? { workspace, thread: transcript('spacing', 12) } : { workspace: nativeWorkspace, settings: nativeSettings, uiState }); return; }
    if (path === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    requests.push({ path, query: Object.fromEntries(url.searchParams) });
    if (path === '/api/codex/runtime') { reply(runtime); return; }
    if (path === '/api/models') { reply({ backend: 'codex-cli', connected: true, catalog: [nativeModel], models: [nativeModel.model] }); return; }
    if (path === '/api/ui-state') {
      if (request.method !== 'PATCH') { reply(uiState); return; }
      let text = '';
      request.on('data', chunk => { text += String(chunk); });
      request.on('end', () => {
        const input = JSON.parse(text) as UiStatePatch, revision = uiState.revision + 1;
        for (const change of input.changes) {
          if (change.section === 'workspace') {
            uiState.workspaces[change.workspaceId] = { ...uiState.workspaces[change.workspaceId], [change.key]: change.value };
            uiState.fieldRevisions['workspace.' + change.workspaceId + '.' + change.key] = revision;
          } else throw new Error('Unexpected fixture preference section.');
        }
        uiState.revision = revision; reply(uiState);
      });
      return;
    }
    if (path === '/api/threads') {
      if (request.method !== 'GET') { unexpected.push(request.method + ' ' + path); reply({ error: 'No native mutations in this fixture.' }, 405); return; }
      const items = url.searchParams.get('backend') === 'legacy' || url.searchParams.get('archived') === 'archived' ? [] : [parent, otherParent].map(({ messages: _messages, timeline: _timeline, native: _native, turns: _turns, ...item }) => item);
      reply({ items, hasOlder: false, hasNewer: false, olderCursor: null, newerCursor: null }); return;
    }
    const selected = [parent, otherParent, child, otherChild].find(thread => path === '/api/threads/' + thread.id);
    if (selected) { reply(selected); return; }
    const streamed = [parent, otherParent, child, otherChild].find(thread => path === '/api/threads/' + thread.id + '/events');
    if (streamed) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); response.flushHeaders(); streams.add(response);
      response.write('id: ' + (++sequence) + '\ndata: ' + JSON.stringify({ type: 'snapshot', threadId: streamed.id, thread: streamed }) + '\n\n');
      response.on('close', () => streams.delete(response)); return;
    }
    if (path === '/api/threads/' + ROOT_ID + '/agents') {
      if (heldChildRefresh && !heldChildRefresh.captured) Object.assign(heldChildRefresh, { captured: true, response, payload: structuredClone([child]) });
      else reply([child]);
      return;
    }
    if (path === '/api/threads/' + OTHER_ROOT_ID + '/agents') { reply([otherChild]); return; }
    unexpected.push((request.method || 'GET') + ' ' + path);
    reply({ error: `Unexpected measured-window fixture route: ${path}` }, 404);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.beforeEach(() => reset());
test.afterAll(async () => {
  for (const stream of streams) stream.end();
  heldChildRefresh?.response?.destroy();
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function settleReleasedRequest(page: Page, request: BrowserRequest, release: () => void) {
  // The API discards unread bodies after cancellation. Chrome can then remove
  // the response body and Playwright's Response.finished() need not settle.
  // Register before release so either completion or abort of this exact request
  // is observed, without accepting a different parent/child metadata response.
  let completed!: () => void;
  const completion = new Promise<void>(resolve => { completed = resolve; });
  const ended = (observed: BrowserRequest) => { if (observed === request) completed(); };
  page.on('requestfinished', ended); page.on('requestfailed', ended);
  try {
    const incoming = page.waitForResponse(response => response.request() === request);
    release();
    expect((await incoming).status()).toBe(200);
    await completion;
    const failure = request.failure();
    if (failure) expect(failure.errorText).toBe('net::ERR_ABORTED');
  } finally { page.off('requestfinished', ended); page.off('requestfailed', ended); }
}

async function bottomGap(scroller: Locator) {
  return scroller.evaluate(element => Math.max(0, element.scrollHeight - element.clientHeight - element.scrollTop));
}

async function rowGeometry(scroller: Locator, key: string): Promise<Geometry> {
  return scroller.evaluate((element, savedKey) => {
    const target = [...element.querySelectorAll<HTMLElement>('.measured-window-row')].find(row => row.dataset.windowKey === savedKey);
    if (!target) throw new Error(`The fixture row ${savedKey} is not mounted.`);
    const box = target.getBoundingClientRect(), style = getComputedStyle(target);
    return { top: box.top - element.getBoundingClientRect().top - element.clientTop + element.scrollTop,
      height: box.height, marginTop: parseFloat(style.marginTop) || 0, marginBottom: parseFloat(style.marginBottom) || 0 };
  }, key);
}

test('selecting a native child keeps one grouped conversation, preserves tool focus and restores the parent window', async ({ page }) => {
  const failures: string[] = []; page.on('pageerror', error => failures.push(error.message));
  await page.goto(`${origin}/?fixture=child`);
  const task = page.getByRole('article', { name: 'Subagent Mount fixture', exact: true });
  const scroller = page.getByRole('region', { name: 'Conversation messages', exact: true });
  const tail = scroller.locator(`[data-window-key="${ROOT_ID}-entry-${PARENT_ENTRIES - 1}"]`);
  await expect(task).toBeVisible();
  await expect.poll(() => streams.size).toBe(1);
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(200);
  await expect(tail).toBeInViewport();
  await expect(task.locator('.chat-activity-group, .chat-activity')).toHaveCount(0);
  await expect(page.locator('.inline-agent-conversation-scroll')).toHaveCount(0);
  expect(requests.filter(request => request.path.endsWith('/history'))).toHaveLength(0);
  const selector = task.getByRole('button', { name: 'Switch to agent Mount fixture', exact: true });
  await selector.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Parent agent', exact: true })).toBeVisible();
  await expect(page.locator('.inline-agent-conversation-scroll')).toHaveCount(0);
  await expect(scroller.locator('.chat-activity-group-toggle')).toHaveCount(2);
  await expandActivityGroups(scroller);
  const tool = scroller.locator('.chat-activity').last();
  const toolButton = tool.locator('.chat-activity-summary');
  const initialHeight = await tool.evaluate(element => element.getBoundingClientRect().height);
  const initialScrollHeight = await scroller.evaluate(element => element.scrollHeight);
  await toolButton.click();
  await expect(tool.getByText('Inspectable fixture 2 result.', { exact: false })).toBeVisible();
  await expect.poll(() => tool.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(initialHeight + 100);
  await expect.poll(() => scroller.evaluate(element => element.scrollHeight)).toBeGreaterThan(initialScrollHeight + 100);
  await expect(toolButton).toBeFocused();
  await page.getByRole('button', { name: 'Parent agent', exact: true }).click();
  await expect(task).toBeVisible();
  await expect(tail).toBeInViewport();
  // Return to the long parent and verify its measured reading anchor.
  await scroller.focus();
  await page.keyboard.press('End');
  await expect.poll(() => bottomGap(scroller)).toBeLessThanOrEqual(3);
  await scroller.evaluate(element => { element.scrollTop = Math.max(300, (element.scrollHeight - element.clientHeight) / 2); });
  await expect(page.getByRole('button', { name: /^Jump to latest/ })).toBeVisible();
  await expect(tail).toHaveCount(0);
  await expect.poll(() => scroller.locator('.measured-window-row').count()).toBeLessThan(32);
  // Start inside one visible row, away from its margins, so width reflow tests
  // the reading anchor rather than choosing a new row from a blank inter-row gap.
  await scroller.evaluate(element => {
    const pane = element.getBoundingClientRect();
    const target = [...element.querySelectorAll<HTMLElement>('.measured-window-row')].find(row => {
      const box = row.getBoundingClientRect(); return box.height > 35 && box.top >= pane.top && box.top < pane.bottom;
    })!;
    element.scrollTop += target.getBoundingClientRect().top - pane.top + 12;
  });
  await settle(page);
  const saved = await scroller.evaluate(element => {
    const top = element.getBoundingClientRect().top;
    const target = [...element.querySelectorAll<HTMLElement>('.measured-window-row')].find(row => row.getBoundingClientRect().bottom > top)!;
    return { key: target.dataset.windowKey!, offset: target.getBoundingClientRect().top - top };
  });
  await page.setViewportSize({ width: 430, height: 960 });
  await expect.poll(async () => scroller.evaluate((element, anchor) => {
    const target = [...element.querySelectorAll<HTMLElement>('.measured-window-row')].find(row => row.dataset.windowKey === anchor.key);
    return target ? Math.abs(target.getBoundingClientRect().top - element.getBoundingClientRect().top - anchor.offset) : Number.MAX_SAFE_INTEGER;
  }, saved)).toBeLessThanOrEqual(6);
  expect(requests.some(request => request.path === `/api/threads/${ROOT_ID}/agents`)).toBe(true);
  expect(requests.some(request => request.path === `/api/threads/${CHILD_ID}`)).toBe(true);
  expect(requests.filter(request => request.path.endsWith('/history') || request.path.includes('/agents/'))).toEqual([]);
  expect(child.history).toBeUndefined();
  expect(unexpected).toEqual([]);
  expect(failures).toEqual([]);
});

test('changing the native parent ignores a late child refresh and permits a fresh child read in the new scope', async ({ page }) => {
  const failures: string[] = []; page.on('pageerror', error => failures.push(error.message));
  await page.addInitScript(() => {
    // Scope validation must reject a late result even when cancellation loses a race.
    const fetch = window.fetch.bind(window);
    window.fetch = (input, init) => fetch(input, typeof input === 'string' && /\/agents$/.test(input) && init ? { ...init, signal: undefined } : init);
  });
  await page.goto(`${origin}/?fixture=child`);
  const task = page.getByRole('article', { name: 'Subagent Mount fixture', exact: true });
  const refresh = page.getByRole('button', { name: 'Refresh subagent activity', exact: true });
  await expect(task).toBeVisible();
  await expect.poll(() => streams.size).toBe(1);
  await expect(task.getByRole('button', { name: 'Switch to agent Mount fixture', exact: true })).toBeEnabled();
  await expect(task.locator('.chat-activity-group')).toHaveCount(0);
  const held = holdChildListRefresh();
  const outgoing = page.waitForRequest(request => new URL(request.url()).pathname === `/api/threads/${ROOT_ID}/agents` && request.method() === 'GET');
  await refresh.click();
  const heldRequest = await outgoing;
  await expect.poll(() => held.captured).toBe(true);
  expect(held.payload).toHaveLength(1);
  expect(held.payload![0]).toMatchObject({ id: CHILD_ID, title: 'Mount fixture', parentThreadId: ROOT_ID, rootThreadId: ROOT_ID,
    workspaceId: nativeWorkspace.id, backend: 'codex-cli', readOnly: false });
  await expect(refresh).toBeDisabled();
  await page.getByRole('button', { name: 'Conversation history', exact: true }).click();
  await page.getByRole('dialog', { name: 'Conversations', exact: true }).getByRole('button', { name: /^Other native parent/ }).click();
  const current = page.getByRole('article', { name: 'Subagent Other native child', exact: true });
  await expect(current).toBeVisible();
  await expect(task).toHaveCount(0);
  await expect(current.locator('.chat-activity-group')).toHaveCount(0);
  await expect(refresh).toBeEnabled();
  // This response belonged to the first selection. Native IDs, not invented
  // child history epochs, fence its delayed contents and loading completion.
  await settleReleasedRequest(page, heldRequest, () => held.release());
  // Inspect the exact serialized body written by the held server response.
  // It remains authoritative fixture evidence even when Chrome has discarded
  // the correctly cancelled browser body before a DevTools read can inspect it.
  expect(held.response?.writableEnded).toBe(true);
  expect(typeof held.writtenBody).toBe('string');
  const stalePayload = JSON.parse(held.writtenBody!) as Thread[];
  expect(stalePayload).toHaveLength(1);
  expect(stalePayload[0]).toMatchObject({ id: CHILD_ID, title: 'Obsolete child window', parentThreadId: ROOT_ID, rootThreadId: ROOT_ID,
    workspaceId: nativeWorkspace.id, backend: 'codex-cli', readOnly: false });
  expect(stalePayload[0].history).toBeUndefined();
  expect(stalePayload[0].messages.every(message => message.content === 'Obsolete child window: ' + message.id)).toBe(true);
  await settle(page);
  await expect(page.getByText(/Obsolete child window/)).toHaveCount(0);
  await expect(current).toBeVisible();
  await expect(refresh).toBeEnabled();
  const incoming = page.waitForResponse(response => new URL(response.url()).pathname === `/api/threads/${OTHER_ROOT_ID}/agents` && response.ok());
  await refresh.click();
  const response = await incoming;
  const payload = await response.json() as Thread[];
  expect(payload).toHaveLength(1);
  expect(payload[0]).toMatchObject({ id: OTHER_CHILD_ID, parentThreadId: OTHER_ROOT_ID, rootThreadId: OTHER_ROOT_ID,
    workspaceId: nativeWorkspace.id, backend: 'codex-cli', readOnly: false });
  expect(payload[0].history).toBeUndefined();
  await expect(refresh).toBeEnabled();
  await current.getByRole('button', { name: 'Switch to agent Other native child', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Conversation messages', exact: true }).getByText('Explicit fixture response 2.', { exact: false })).toBeVisible();
  expect(requests.some(request => request.path === `/api/threads/${OTHER_CHILD_ID}`)).toBe(true);
  expect(requests.filter(request => request.path.endsWith('/history') || request.path.includes('/agents/') || request.path.startsWith(`/api/threads/${CHILD_ID}/`))).toEqual([]);
  expect(unexpected).toEqual([]);
  expect(failures).toEqual([]);
});

test('an initially autoFocused input stays attached and focused while its row is outside the normal window', async ({ page }) => {
  await page.goto(`${origin}/?fixture=focus`);
  const scroller = page.getByRole('region', { name: 'Focused row fixture', exact: true });
  const input = page.getByRole('textbox', { name: 'Initially focused fixture field', exact: true });
  // Deliberately no focus(), click() or locator.fill() before this scroll. The
  // production effect must discover focus established during React's first commit.
  await expect(input).toBeFocused();
  await page.keyboard.press('End'); await page.keyboard.type(' remains editable');
  await expect(input).toHaveValue('Saved fixture draft remains editable');
  await scroller.evaluate(element => { element.scrollTop = 5_000; });
  await settle(page);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('Saved fixture draft remains editable');
  await expect(input).not.toBeInViewport();
  await expect(scroller.locator('[data-window-key="focus-row-0"]')).toHaveCount(1);
  await expect(scroller.locator('[data-window-key="focus-row-1"]')).toHaveCount(0);
  await expect.poll(() => scroller.locator('.measured-window-row').count()).toBeLessThan(10);
  await page.getByRole('button', { name: 'Outside fixture focus', exact: true }).focus();
  await expect(scroller.locator('[data-window-key="focus-row-0"]')).toHaveCount(0);
});

test('saved conversation rows keep their variable heights and both margins across virtual spacers', async ({ page }) => {
  await page.goto(`${origin}/?fixture=chooser`);
  const scroller = page.getByRole('region', { name: 'Variable saved rows', exact: true });
  await expect(scroller.locator('[data-window-key="chooser-row-0"]')).toBeVisible();
  const expectedTotal = Array.from({ length: 100 }, (_, index) => 64 + index % 4 * 19 + 4).reduce((sum, height) => sum + height, 0);
  async function expectGeometry() {
    await expect.poll(() => scroller.evaluate(element => element.scrollHeight)).toBe(expectedTotal);
    const geometry = await scroller.evaluate(element => [...element.querySelectorAll<HTMLElement>('.measured-window-row')].map(row => ({
      index: Number(row.dataset.fixtureIndex), top: row.getBoundingClientRect().top - element.getBoundingClientRect().top - element.clientTop + element.scrollTop,
      height: row.getBoundingClientRect().height,
    })));
    expect(geometry.length).toBeGreaterThan(2); expect(geometry.length).toBeLessThan(14);
    for (const item of geometry) {
      const expectedTop = 2 + Array.from({ length: item.index }, (_, index) => 64 + index % 4 * 19 + 4).reduce((sum, height) => sum + height, 0);
      expect(Math.abs(item.top - expectedTop)).toBeLessThanOrEqual(1);
      expect(item.height).toBe(64 + item.index % 4 * 19);
    }
  }
  await expectGeometry();
  await scroller.evaluate(element => { element.scrollTop = 4_600; });
  await expect(scroller.locator('[data-window-key="chooser-row-0"]')).toHaveCount(0);
  await expectGeometry();
});

test('group aliases retain one measured row and turn geometry after predecessor nodes unmount', async ({ page }) => {
  await page.goto(`${origin}/?fixture=spacing`);
  const scroller = page.getByRole('region', { name: 'Logical spacing transcript', exact: true });
  await page.getByRole('button', { name: 'Show adjacent activity pair', exact: true }).click();
  const group = scroller.locator('[data-window-key="spacing-entry-3"]');
  const end = scroller.locator('[data-window-key="turn-end:spacing-turn-1"]');
  await expect(group).toBeVisible(); await expect(end).toBeVisible();
  await expect(scroller.locator('[data-window-key="spacing-entry-4"]')).toHaveCount(0);
  await expect(group.locator('.chat-activity-group')).toHaveAttribute('data-timeline-entries', '["spacing-entry-3","spacing-entry-4"]');
  await settle(page);
  const beforeGroup = await rowGeometry(scroller, 'spacing-entry-3');
  const beforeEnd = await rowGeometry(scroller, 'turn-end:spacing-turn-1');
  expect(beforeEnd.top).toBeGreaterThanOrEqual(beforeGroup.top + beforeGroup.height - 1);
  await page.getByRole('button', { name: 'Align second activity', exact: true }).click();
  await expect(group).toBeVisible();
  await expect.poll(async () => Math.abs((await rowGeometry(scroller, 'spacing-entry-3')).top - beforeGroup.top)).toBeLessThanOrEqual(1);
  expect((await rowGeometry(scroller, 'spacing-entry-3')).marginTop).toBe(beforeGroup.marginTop);
  await page.getByRole('button', { name: 'Align turn boundary', exact: true }).click();
  await expect(group).toHaveCount(0); await expect(end).toBeVisible();
  await expect.poll(async () => Math.abs((await rowGeometry(scroller, 'turn-end:spacing-turn-1')).top - beforeEnd.top)).toBeLessThanOrEqual(1);
  expect((await rowGeometry(scroller, 'turn-end:spacing-turn-1')).marginTop).toBe(beforeEnd.marginTop);
  await expect.poll(() => scroller.locator('.measured-window-row').count()).toBeLessThan(14);
});
