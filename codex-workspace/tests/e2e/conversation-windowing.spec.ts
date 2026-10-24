import type { CodexCapabilities, CodexModelCatalog, CodexRuntimeStatus, CodexThreadState } from '../../shared/codex-cli';
import { projectNativeThread } from '../../server/codex-cli/projection';
import { expect, test, type Page, type Response } from '@playwright/test';
import { build } from 'esbuild';
import { createHmac } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { AgentEvent, AppSettings, ChatMessage, ConversationTimelineEntry, ImageAttachment, Thread, ThreadSummary, ThreadTurn, ToolActivity, Workspace } from '../../shared/types';

// The production ChatPanel talks to a controlled HTTP/SSE peer. These generated,
// explicitly labelled browser fixtures are neither provider calls nor product answers.
const at = '2026-09-20T12:00:00.000Z';
const LONG_THREAD = 'thr_11111111111111111111111111111111';
const OTHER_THREAD = 'thr_22222222222222222222222222222222';
const NATIVE_THREAD = '0199a111-1111-7111-8111-111111111111';
const NATIVE_OTHER = '0199a222-2222-7222-8222-222222222222';
const NATIVE_TURN = '0199a333-3333-7333-8333-333333333333';
const PAGE_SIZE = 40;
const STORED_ENTRIES = 720;
const workspace: Workspace = { id: 'window-workspace', name: 'Windowing fixture', path: '/workspace/windowing', createdAt: at, updatedAt: at };
const settings: AppSettings = { model: 'gpt-5.6-sol', reasoningEffort: 'max', autoApprove: false, theme: 'dark', fontSize: 13,
  wordWrap: true, provider: 'openai', apiKeyConfigured: false, agentConfigured: true };
const capabilities: CodexCapabilities = { conversations: true, pagination: true, queue: true, goals: true, skills: true, plan: true, review: true, historyRevert: true };
const catalog: CodexModelCatalog = { backend: 'codex-cli', connected: true, models: [settings.model], catalog: [{ id: 'fixture-sol-catalog-id', model: settings.model,
  displayName: 'Sol fixture', description: 'Native metadata fixture', hidden: false, isDefault: true, inputModalities: ['text', 'image'],
  defaultReasoningEffort: 'max', supportedReasoningEfforts: [{ reasoningEffort: 'max', description: 'Max' }] }] };
const runtime: CodexRuntimeStatus = { backend: 'codex-cli', state: 'ready', version: '0.155.1', installedVersion: '0.155.1',
  startedAt: at, updatedAt: at, canUpdate: true, updateBlockedReason: null, error: null, activeTurns: 0, capabilities };
const newNativeState = (): CodexThreadState => ({ model: settings.model, reasoningEffort: 'max', activeTurnId: null,
  approvals: [], questions: [], queue: [], queueCursor: null, goal: null, tokenUsage: null, diff: null, capabilities });
let nativeMode = false, nativeLatest = 100, nativeEmpty = false, nativeState = newNativeState();
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN4bm4DAANjAVvvpjgdAAAAAElFTkSuQmCC', 'base64');

type StoredThread = { thread: Thread; epoch: string; revision: number };
type EntryInput<T = ConversationTimelineEntry> = T extends ConversationTimelineEntry ? Omit<T, 'sequence' | 'revision'> : never;
type RequestRecord = { method: string; path: string; query: Record<string, string>; body?: Record<string, unknown> };
type Delivery = { path: string; transport: 'http' | 'sse'; thread: Thread; bytes: number };
type HeldPage = {
  threadId: string;
  captured: boolean;
  response?: ServerResponse;
  request?: RequestRecord;
  payload?: Thread;
  release: (mutate?: (payload: Thread) => void) => void;
  fail: () => void;
};
type Anchor = { key: string; offset: number };

let server: Server, origin = '', script = '', styles = '', eventSequence = 0;
let delayedImages = false, nextHeldPage: HeldPage | undefined;
const records = new Map<string, StoredThread>();
const streams = new Map<ServerResponse, string>();
const imageResponses = new Set<ServerResponse>();
const heldPages = new Set<HeldPage>();
const queuedLatestPages: HeldPage[] = [];
const requests: RequestRecord[] = [];
const deliveries: Delivery[] = [];

function fixtureUiState() {
  return { version: 1, revision: 1, layouts: {}, editor: {}, workspaces: { [workspace.id]: { threadId: nativeMode ? NATIVE_THREAD : LONG_THREAD } }, fieldRevisions: {} };
}
const nativeItemId = (index: number) => `native-item-${index}`;
const nativeCursor = (index: number) => `opaque native /+ cursor:${nativeItemId(index)}`;
function nativeView(indices: number[], id = NATIVE_THREAD): Thread {
  const state = id === NATIVE_THREAD ? nativeState : newNativeState();
  const result = projectNativeThread({ id, name: id === NATIVE_THREAD ? 'Native window fixture' : 'Independent native fixture',
    createdAt: Date.parse(at) / 1000, updatedAt: Date.parse(at) / 1000, status: { type: state.activeTurnId ? 'active' : 'idle' },
    turns: [{ id: NATIVE_TURN, status: state.activeTurnId ? 'inProgress' : 'completed', startedAt: Date.parse(at) / 1000,
      ...(state.activeTurnId ? {} : { completedAt: Date.parse(at) / 1000 }) }] }, indices.map(index => ({ turnId: NATIVE_TURN, item: {
      type: 'agentMessage', id: nativeItemId(index), text: `Native stored item ${index}.\n\n${Array.from({ length: 16 }, (_, paragraph) =>
        `Recorded paragraph ${paragraph + 1} of item ${index} is explicit browser fixture text. It gives this native item enough height to test real viewport anchors, selection, focus and reflow without fabricating history totals.`).join('\n\n')}`,
    } })), workspace.id, state);
  return { ...result, nativePage: { nextCursor: indices.length && indices[0] > 1 ? nativeCursor(indices[0]) : null,
    backwardsCursor: indices.length ? nativeCursor(indices.at(-1)!) : null } };
}
function nativePage(index = nativeLatest, id = NATIVE_THREAD, direction: 'older' | 'newer' = 'older') {
  const result = nativeView(nativeEmpty && id === NATIVE_THREAD ? [] : [index], id);
  if (direction === 'newer') result.nativePage = { nextCursor: index < nativeLatest ? nativeCursor(index) : null, backwardsCursor: nativeCursor(index) };
  return result;
}
function nativeEmit(event: Omit<AgentEvent, 'threadId'>, id = NATIVE_THREAD) {
  const body = `id: ${++eventSequence}\ndata: ${JSON.stringify({ ...event, threadId: id })}\n\n`;
  for (const [stream, owner] of streams) if (owner === id && !stream.destroyed) stream.write(body);
}
function nativeSnapshot() { nativeEmit({ type: 'snapshot', thread: nativePage() }); }
function nativeAdvance(count = 1, broadcast = true) { nativeLatest += count; if (broadcast) nativeSnapshot(); }
function nativeWindowLimit() { nativeEmit({ type: 'error', streamOnly: true, code: 'NATIVE_VIEW_WINDOW_LIMIT', error: 'The native public view needs a smaller history window.' }); }
function capture(held: HeldPage, response: ServerResponse, recorded: RequestRecord, payload: Thread) {
  Object.assign(held, { captured: true, response, request: recorded, payload });
}
function nativeRoute(method: string, pathname: string, url: URL, body: Record<string, unknown> | undefined, recorded: RequestRecord, response: ServerResponse): boolean {
  if (pathname === '/api/threads') { reply(response, [summary(nativePage()), summary(nativePage(1, NATIVE_OTHER))]); return true; }
  const match = /^\/api\/threads\/([^/]+)(?:\/(.+))?$/.exec(pathname);
  if (!match) return false;
  const id = match[1], action = match[2];
  if (id !== NATIVE_THREAD && id !== NATIVE_OTHER) { reply(response, { error: 'Unknown native fixture.' }, 404); return true; }
  if (!action && method === 'GET') {
    const payload = nativePage(id === NATIVE_THREAD ? nativeLatest : 1, id);
    const heldIndex = queuedLatestPages.findIndex(held => held.threadId === id);
    if (heldIndex >= 0) capture(queuedLatestPages.splice(heldIndex, 1)[0], response, recorded, payload);
    else deliver(response, pathname, payload);
    return true;
  }
  if (action === 'history') {
    const before = url.searchParams.get('before'), after = url.searchParams.get('after');
    const token = before || after || '', index = /^opaque native \/\+ cursor:native-item-(\d+)$/.exec(token);
    if (!index || Boolean(before) === Boolean(after) || Number(url.searchParams.get('limit')) !== 40) { reply(response, { error: 'Use a native opaque cursor and bounded page.' }, 400); return true; }
    const next = Math.max(1, Math.min(nativeLatest, Number(index[1]) + (before ? -1 : 1)));
    const payload = nativePage(next, id, before ? 'older' : 'newer');
    // One official item per body page. No public totals, epochs or absolute ordinals.
    if (before && nextHeldPage?.threadId === id) { const held = nextHeldPage; nextHeldPage = undefined; capture(held, response, recorded, payload); }
    else deliver(response, pathname, payload);
    return true;
  }
  if (action === 'events') {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); response.flushHeaders();
    streams.set(response, id);
    response.write(`id: ${++eventSequence}\ndata: ${JSON.stringify({ type: 'snapshot', threadId: id, thread: nativePage(id === NATIVE_THREAD ? nativeLatest : 1, id) })}\n\n`);
    response.on('close', () => streams.delete(response)); return true;
  }
  if (action === 'agents') { reply(response, []); return true; }
  if (action === 'goal') { reply(response, { goal: null }); return true; }
  if (action === 'queue') { reply(response, { items: [], nextCursor: null }); return true; }
  if (action === 'revert' && method === 'POST') {
    if (body?.beforeTurnId !== NATIVE_TURN) { reply(response, { error: 'Unknown native turn.' }, 409); return true; }
    nativeEmpty = true; reply(response, nativePage()); return true;
  }
  if (action === 'approval' && method === 'POST') {
    if (body?.approvalId !== nativeState.approvals[0]?.id || body?.decision !== 'accept') { reply(response, { error: 'Unknown native approval.' }, 409); return true; }
    nativeState.approvals = []; reply(response, { accepted: true }); nativeSnapshot(); return true;
  }
  if (action === 'answer' && method === 'POST') {
    if (body?.requestId !== nativeState.questions[0]?.id) { reply(response, { error: 'Unknown native question.' }, 409); return true; }
    nativeState.questions = []; reply(response, { accepted: true }); nativeSnapshot(); return true;
  }
  reply(response, { error: 'Unexpected native fixture request.' }, 404); return true;
}

function attachment(ordinal: number): ImageAttachment {
  const id = `att_${ordinal.toString(16).padStart(32, '0')}`;
  const sha256 = 'a'.repeat(64);
  return { id, sha256, workspaceId: workspace.id, name: `fixture-image-${ordinal}.png`, mimeType: 'image/png', bytes: pixel.length,
    width: 1, height: 1, detail: 'high', createdAt: at,
    previewUrl: `/api/workspaces/${workspace.id}/attachments/${id}/content?sha256=${sha256}` };
}

function makeStoredThread(id: string, turns: number, title: string): StoredThread {
  const messages: ChatMessage[] = [];
  const entries: ConversationTimelineEntry[] = [];
  const recordedTurns: ThreadTurn[] = [];
  for (let ordinal = 1; ordinal <= turns; ordinal++) {
    const turnId = `${id}-turn-${ordinal}`;
    const userId = `${id}-user-${ordinal}`, assistantId = `${id}-assistant-${ordinal}`;
    const firstSequence = entries.length + 1;
    const firstText = `Stored browser fixture ${ordinal}. The recorded file can be inspected through [fixture source](fixture-${ordinal}.ts).\n\n`;
    const secondText = ordinal % 3 === 0
      ? `Fixture result ${ordinal}.\n\n\`\`\`typescript\n${Array.from({ length: 2 + ordinal % 7 }, (_, index) => `const fixture${index} = ${ordinal + index};`).join('\n')}\n\`\`\`\n\nThis code block is stored test data.`
      : ordinal % 3 === 1
        ? `Fixture result ${ordinal}.\n\n| Recorded item | Value |\n| --- | --- |\n${Array.from({ length: 2 + ordinal % 4 }, (_, index) => `| Fixture ${index} | ${ordinal + index} |`).join('\n')}\n\nThe table deliberately changes this row's height.`
        : `Fixture result ${ordinal}.\n\n${Array.from({ length: 1 + ordinal % 5 }, (_, index) => `Paragraph ${index + 1} contains stored browser fixture text for resize and scroll anchoring. Its wrapping changes with the available conversation width.`).join('\n\n')}`;
    const activities: ToolActivity[] = ['source', 'result'].map((part, index) => ({ id: `${id}-tool-${ordinal}-${part}`, name: 'read_file',
      input: JSON.stringify({ path: `fixture-${ordinal}-${part}.ts` }),
      output: JSON.stringify({ path: `fixture-${ordinal}-${part}.ts`, content: `Inspectable fixture ${ordinal} ${part}.\n${'Stored file line.\n'.repeat(2 + (ordinal + index) % 6)}`, version: 'fixture-version' }),
      status: 'completed', startedAt: at, completedAt: at }));
    const user: ChatMessage = { id: userId, role: 'user', content: `Stored request ${ordinal}: inspect fixture-${ordinal}.ts.`, createdAt: at, turnId,
      ordinal: messages.length + 1, ...(ordinal % 4 === 0 ? { attachments: [attachment(ordinal)] } : {}) };
    const assistant: ChatMessage = { id: assistantId, role: 'assistant', content: firstText + secondText, createdAt: at, turnId,
      ordinal: messages.length + 2, activities, reasoningSummary: [{ id: `${id}-summary-${ordinal}`, summaryIndex: 0, text: `Public fixture summary ${ordinal}: inspect the stored inputs before presenting the recorded result.`, status: 'complete' }] };
    messages.push(user, assistant);
    const add = (entry: EntryInput) => entries.push({ ...entry, sequence: entries.length + 1, revision: entries.length + 1 });
    add({ id: `${id}-entry-${firstSequence}`, kind: 'message', messageId: userId });
    add({ id: `${id}-entry-${firstSequence + 1}`, kind: 'text', messageId: assistantId, text: firstText, startOffset: 0 });
    add({ id: `${id}-entry-${firstSequence + 2}`, kind: 'reasoning', messageId: assistantId, summaryId: `${id}-summary-${ordinal}`, text: assistant.reasoningSummary![0].text, status: 'complete' });
    add({ id: `${id}-entry-${firstSequence + 3}`, kind: 'activity', messageId: assistantId, activityId: activities[0].id });
    add({ id: `${id}-entry-${firstSequence + 4}`, kind: 'text', messageId: assistantId, text: secondText, startOffset: firstText.length });
    add({ id: `${id}-entry-${firstSequence + 5}`, kind: 'activity', messageId: assistantId, activityId: activities[1].id });
    recordedTurns.push({ id: turnId, userMessageId: userId, messageIds: [userId, assistantId], startedAt: at, completedAt: at, status: 'completed', ordinal, firstSequence, lastSequence: entries.length });
  }
  return { epoch: `${id}-epoch-1`, revision: entries.length, thread: { id, workspaceId: workspace.id, title, createdAt: at, backend: 'legacy', readOnly: true,
    updatedAt: id === LONG_THREAD ? '2026-09-20T12:02:00.000Z' : at, status: 'idle', permissionMode: 'ask', goal: null,
    messages, turns: recordedTurns, timeline: { version: 1, revision: entries.length, nextSequence: entries.length + 1, entries } } };
}

function cursor(stored: StoredThread, boundary: number) {
  const payload = Buffer.from(JSON.stringify({ id: stored.thread.id, epoch: stored.epoch, boundary })).toString('base64url');
  return `${payload}.${cursorSignature(payload)}`;
}

function cursorSignature(payload: string) {
  // This fixed local fixture authority is not an application credential.
  return createHmac('sha256', 'explicit-windowing-fixture-cursor-authority').update(payload).digest('base64url');
}

function readCursor(value: string): { id?: string; epoch?: string; boundary?: number } {
  const parts = value.split('.');
  if (parts.length !== 2 || parts[1] !== cursorSignature(parts[0])) throw new Error('Invalid fixture cursor signature.');
  return JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as { id?: string; epoch?: string; boundary?: number };
}

function pageOf(stored: StoredThread, direction: 'latest' | 'before' | 'after' = 'latest', boundary = 0, limit = PAGE_SIZE): Thread {
  const full = stored.thread, all = full.timeline!.entries;
  const entries = direction === 'after' ? all.filter(entry => entry.sequence > boundary).slice(0, limit)
    : (direction === 'before' ? all.filter(entry => entry.sequence < boundary) : all).slice(-limit);
  const messageIds = new Set(entries.map(entry => entry.messageId));
  const activityIds = new Set(entries.flatMap(entry => entry.kind === 'activity' ? [entry.activityId] : []));
  const turnIds = new Set(full.messages.filter(message => messageIds.has(message.id)).map(message => message.turnId));
  const oldestSequence = entries[0]?.sequence ?? null, newestSequence = entries.at(-1)?.sequence ?? null;
  const latestSequence = all.at(-1)?.sequence ?? 0;
  const hasOlder = oldestSequence !== null && all.some(entry => entry.sequence < oldestSequence);
  const hasNewer = newestSequence !== null && newestSequence < latestSequence;
  return structuredClone({ ...full,
    messages: full.messages.filter(message => messageIds.has(message.id)).map(message => ({ ...message,
      ...(message.activities ? { activities: message.activities.filter(activity => activityIds.has(activity.id)) } : {}) })),
    turns: full.turns?.filter(turn => turnIds.has(turn.id)), timeline: { ...full.timeline!, entries },
    history: { version: 1 as const, epoch: stored.epoch, revision: stored.revision, oldestSequence, newestSequence, latestSequence,
      olderCursor: hasOlder ? cursor(stored, oldestSequence!) : null, newerCursor: newestSequence !== null ? cursor(stored, newestSequence) : null,
      hasOlder, hasNewer, totalMessages: full.messages.length } });
}

function summary(thread: Thread): ThreadSummary {
  const { id, workspaceId, title, createdAt, updatedAt, status, archivedAt, backend, readOnly } = thread;
  return { id, workspaceId, title, createdAt, updatedAt, status, backend, readOnly, ...(archivedAt ? { archivedAt } : {}) };
}

function reply(response: ServerResponse, value: unknown, status = 200) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

function deliver(response: ServerResponse, path: string, value: Thread) {
  deliveries.push({ path, transport: 'http', thread: structuredClone(value), bytes: Buffer.byteLength(JSON.stringify(value)) });
  reply(response, value);
}

function heldPage(threadId: string): HeldPage {
  const held: HeldPage = {
    threadId, captured: false,
    release(mutate) {
      if (!held.response || !held.payload || !held.request) throw new Error('The browser has not requested the held page.');
      mutate?.(held.payload);
      deliver(held.response, held.request.path, held.payload);
      heldPages.delete(held);
    },
    fail() {
      if (!held.response) throw new Error('The browser has not requested the held page.');
      reply(held.response, { error: 'Fixture history page failed. Retry the saved page.' }, 503);
      heldPages.delete(held);
    },
  };
  heldPages.add(held);
  return held;
}

function holdOlder(threadId = LONG_THREAD): HeldPage {
  if (nextHeldPage) throw new Error('A fixture page is already waiting to be requested.');
  return nextHeldPage = heldPage(threadId);
}

function holdLatest(threadId = LONG_THREAD): HeldPage {
  const held = heldPage(threadId);
  queuedLatestPages.push(held);
  return held;
}

function releaseImages() {
  delayedImages = false;
  for (const response of imageResponses) if (!response.destroyed && !response.writableEnded) {
    response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }); response.end(pixel);
  }
  imageResponses.clear();
}

function poisonPage(payload: Thread) {
  for (const entry of payload.timeline!.entries) if (entry.kind === 'text') entry.text = `Obsolete buffered page: ${entry.id}`;
  for (const message of payload.messages) message.content = `Obsolete buffered page: ${message.id}`;
}

function reset() {
  for (const stream of streams.keys()) stream.end();
  streams.clear();
  for (const held of heldPages) held.response?.destroy();
  heldPages.clear(); nextHeldPage = undefined; queuedLatestPages.length = 0;
  releaseImages(); records.clear(); requests.length = 0; deliveries.length = 0; eventSequence = 0;
  nativeMode = false; nativeLatest = 100; nativeEmpty = false; nativeState = newNativeState();
  records.set(LONG_THREAD, makeStoredThread(LONG_THREAD, STORED_ENTRIES / 6, 'Long stored fixture'));
  records.set(OTHER_THREAD, makeStoredThread(OTHER_THREAD, 3, 'Independent stored fixture'));
}

test.beforeAll(async () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const bundle = await build({ absWorkingDir: root, stdin: { contents: `
    import { createRoot } from 'react-dom/client';
    import ChatPanel from './client/components/ChatPanel';
    import { hydrateUiState } from './client/ui-state';
    import './client/styles.css';
    const notifications = [], openedFiles = [];
    window.__windowFixture = { notifications, openedFiles };
    fetch('/fixture-config').then(response => response.json()).then(async ({ workspace, settings, uiState }) => {
      await hydrateUiState(uiState, [workspace]);
      createRoot(document.getElementById('root')).render(<main className="windowing-test-frame">
        <ChatPanel workspace={workspace} settings={settings} onSettings={() => {}}
          onNotify={message => notifications.push(message)} onOpenFile={path => openedFiles.push(path)} />
      </main>);
    });
  `, loader: 'tsx', resolveDir: root }, bundle: true, write: false, outfile: 'windowing-fixture.js', format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent' });
  script = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  styles = bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text
    + '\n#root { height: 100dvh; overflow: hidden; } .windowing-test-frame { height: 100%; max-width: 790px; min-width: 0; margin: 0 auto; display: flex; }';
  reset();
  server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://localhost'), path = url.pathname;
    if (path === '/') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); return; }
    if (path === '/fixture.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(script); return; }
    if (path === '/fixture.css') { response.writeHead(200, { 'Content-Type': 'text/css' }); response.end(styles); return; }
    if (path === '/fixture-config') { reply(response, { workspace, settings, uiState: fixtureUiState() }); return; }
    if (path === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    let body: Record<string, unknown> | undefined;
    if (request.method !== 'GET') {
      let raw = '';
      for await (const chunk of request) raw += String(chunk);
      try { body = raw ? JSON.parse(raw) as Record<string, unknown> : undefined; } catch { reply(response, { error: 'Invalid fixture request.' }, 400); return; }
    }
    const recorded: RequestRecord = { method: request.method || 'GET', path, query: Object.fromEntries(url.searchParams), body };
    requests.push(recorded);
    if (path === '/api/codex/runtime') { reply(response, runtime); return; }
    if (path === '/api/models') { reply(response, catalog); return; }
    if (nativeMode && nativeRoute(request.method || 'GET', path, url, body, recorded, response)) return;
    if (path === '/api/threads') {
      const query = (url.searchParams.get('query') || '').toLowerCase(), visibility = url.searchParams.get('archived');
      const items = [...records.values()].map(stored => summary(stored.thread)).filter(item => url.searchParams.get('backend') === 'legacy' && item.title.toLowerCase().includes(query)
        && (Boolean(item.archivedAt) === (visibility === 'archived')))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const selectedId = url.searchParams.get('selectedId') || url.searchParams.get('selectedThreadId') || url.searchParams.get('selected');
      reply(response, { items: items.slice(0, PAGE_SIZE), olderCursor: null, newerCursor: null, hasOlder: false, hasNewer: false,
        ...(selectedId && records.has(selectedId) ? { selected: summary(records.get(selectedId)!.thread) } : {}) }); return;
    }
    if (/^\/api\/workspaces\/[^/]+\/attachments\/[^/]+\/content$/.test(path)) {
      if (delayedImages) { imageResponses.add(response); response.on('close', () => imageResponses.delete(response)); }
      else { response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }); response.end(pixel); }
      return;
    }
    const match = /^\/api\/threads\/([^/]+)(?:\/(.+))?$/.exec(path);
    if (match) {
      const stored = records.get(decodeURIComponent(match[1])), action = match[2];
      if (!stored) { reply(response, { error: 'Fixture thread was not found.' }, 404); return; }
      if (!action && request.method === 'GET') {
        const index = queuedLatestPages.findIndex(held => held.threadId === stored.thread.id);
        if (index >= 0) {
          const [held] = queuedLatestPages.splice(index, 1);
          Object.assign(held, { captured: true, response, request: recorded, payload: pageOf(stored) });
        } else deliver(response, path, pageOf(stored));
        return;
      }
      if (action === 'history') {
        const before = url.searchParams.get('before'), after = url.searchParams.get('after'), limit = Number(url.searchParams.get('limit') || PAGE_SIZE);
        if (Boolean(before) === Boolean(after) || !Number.isInteger(limit) || limit < 1 || limit > PAGE_SIZE) { reply(response, { error: 'Use one opaque cursor and a bounded history page.' }, 400); return; }
        let decoded: { id?: string; epoch?: string; boundary?: number };
        try { decoded = readCursor((before || after)!); } catch { reply(response, { error: 'Invalid fixture history cursor.' }, 400); return; }
        if (decoded.id !== stored.thread.id || decoded.epoch !== stored.epoch || typeof decoded.boundary !== 'number') { reply(response, { error: 'Fixture history changed. Open recent messages.' }, 409); return; }
        const payload = pageOf(stored, before ? 'before' : 'after', decoded.boundary, limit);
        if (before && nextHeldPage?.threadId === stored.thread.id) {
          const held = nextHeldPage; nextHeldPage = undefined;
          Object.assign(held, { captured: true, response, request: recorded, payload });
        } else deliver(response, path, payload);
        return;
      }
      // Preserved histories have no live stream or actionable old callbacks.
    }
    if (path === `/api/workspaces/${workspace.id}/codex/skills`) { reply(response, { skills: [], errors: [] }); return; }
    if (path === '/api/session') { reply(response, { authenticated: true }); return; }
    if (path === '/api/ui-state') { reply(response, fixtureUiState()); return; }
    reply(response, { error: `Unexpected windowing fixture route: ${path}` }, 404);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.beforeEach(() => reset());
test.afterAll(async () => {
  for (const stream of streams.keys()) stream.end();
  for (const held of heldPages) held.response?.destroy();
  releaseImages(); server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

function conversation(page: Page) { return page.locator('.chat-conversation'); }
function rows(page: Page) { return conversation(page).locator('.measured-window-row'); }
function latestRequestCount() { return requests.filter(request => request.method === 'GET' && request.path === `/api/threads/${nativeMode ? NATIVE_THREAD : LONG_THREAD}`).length; }

function latestResponse(page: Page) {
  return page.waitForResponse(response => new URL(response.url()).pathname === `/api/threads/${nativeMode ? NATIVE_THREAD : LONG_THREAD}` && response.request().method() === 'GET');
}

async function expectNoLatestRequest(page: Page, action?: () => void | Promise<void>) {
  // This short negative network observation spans the SSE batching timer and
  // subsequent render frames without hiding an unexpected request in a sleep.
  const next = page.waitForRequest(request => new URL(request.url()).pathname === `/api/threads/${nativeMode ? NATIVE_THREAD : LONG_THREAD}` && request.method() === 'GET', { timeout: 400 })
    .then(() => true, error => {
      if (error instanceof Error && error.name === 'TimeoutError') return false;
      throw error;
    });
  await action?.();
  expect(await next).toBe(false);
}

async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function mount(page: Page): Promise<Thread> {
  const initial = page.waitForResponse(response => new URL(response.url()).pathname === `/api/threads/${LONG_THREAD}` && response.request().method() === 'GET');
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('region', { name: 'Codex conversation', exact: true })).toBeVisible();
  const payload = await (await initial).json() as Thread;
  await expect(page.getByText('Preserved conversation · Read only', { exact: true })).toBeVisible();
  expect(streams.size).toBe(0);
  await expect(conversation(page).locator(`[data-window-key="${LONG_THREAD}-entry-${STORED_ENTRIES}"]`)).toHaveCount(1);
  await settle(page);
  return payload;
}

async function anchor(page: Page): Promise<Anchor> {
  return conversation(page).evaluate(element => {
    const pane = element.getBoundingClientRect();
    const candidates = [...element.querySelectorAll<HTMLElement>('.measured-window-row[data-window-key]')];
    const first = candidates.find(item => { const box = item.getBoundingClientRect(); return box.height > 0 && box.bottom > pane.top + 4 && box.top < pane.bottom; });
    if (!first) throw new Error('No mounted transcript row intersects the viewport.');
    return { key: first.dataset.windowKey!, offset: first.getBoundingClientRect().top - pane.top };
  });
}

async function offset(page: Page, key: string) {
  return conversation(page).evaluate((element, savedKey) => {
    const target = [...element.querySelectorAll<HTMLElement>('.measured-window-row')].find(item => item.dataset.windowKey === savedKey);
    return target ? target.getBoundingClientRect().top - element.getBoundingClientRect().top : null;
  }, key);
}

async function expectAnchored(page: Page, saved: Anchor, tolerance = 4) {
  await expect.poll(async () => { const actual = await offset(page, saved.key); return actual === null ? Number.MAX_SAFE_INTEGER : Math.abs(actual - saved.offset); }).toBeLessThanOrEqual(tolerance);
}

async function beginOlder(page: Page) {
  const held = holdOlder();
  await conversation(page).evaluate(element => { element.scrollTop = 96; });
  await expect.poll(() => held.captured).toBe(true);
  await settle(page);
  return { held, saved: await anchor(page) };
}

async function prepend(page: Page) {
  const { held, saved } = await beginOlder(page);
  const completed = page.waitForResponse(response => new URL(response.url()).pathname === held.request!.path && new URL(response.url()).searchParams.get('before') === held.request!.query.before);
  held.release(); await completed;
  await expect.poll(() => conversation(page).evaluate(element => element.scrollTop)).toBeGreaterThan(300);
  await expectAnchored(page, saved);
  return held.payload!;
}

function assertBounded(payload: Thread) {
  const entries = payload.timeline!.entries;
  expect(entries.length).toBeGreaterThan(0); expect(entries.length).toBeLessThanOrEqual(PAGE_SIZE);
  expect(entries.map(entry => entry.sequence)).toEqual([...entries].sort((a, b) => a.sequence - b.sequence).map(entry => entry.sequence));
  expect(new Set(entries.map(entry => entry.id)).size).toBe(entries.length);
  const messageIds = new Set(entries.map(entry => entry.messageId));
  expect(payload.messages.every(message => messageIds.has(message.id))).toBe(true);
  expect([...messageIds].every(id => payload.messages.some(message => message.id === id))).toBe(true);
}

test('loads preserved bounded HTTP pages and actually unmounts both ends of a long mixed-height transcript', async ({ page }) => {
  const failures: string[] = []; page.on('pageerror', error => failures.push(error.message));
  const observed: Promise<Thread>[] = [];
  const observe = (response: Response) => {
    if (/\/api\/threads\/[^/]+(?:\/history)?$/.test(new URL(response.url()).pathname) && response.request().method() === 'GET' && response.ok()) observed.push(response.json() as Promise<Thread>);
  };
  page.on('response', observe);
  const initial = await mount(page);
  assertBounded(initial);
  expect(initial.history).toMatchObject({ oldestSequence: 681, newestSequence: 720, latestSequence: 720, hasOlder: true, hasNewer: false, totalMessages: 240 });
  expect(requests.filter(request => request.path.endsWith('/history'))).toHaveLength(0);
  expect(initial.messages.some(message => message.id.endsWith('-user-1'))).toBe(false);
  await expect(conversation(page).getByText('Stored request 1: inspect fixture-1.ts.', { exact: true })).toHaveCount(0);
  await expect.poll(() => rows(page).count()).toBeLessThan(50);
  const mountedHeights = await rows(page).evaluateAll(elements => elements.map(element => Math.round(element.getBoundingClientRect().height)));
  expect(new Set(mountedHeights).size).toBeGreaterThan(3);
  const latestKey = `${LONG_THREAD}-entry-720`;
  for (let index = 0; index < 6; index++) {
    const loaded = await prepend(page); assertBounded(loaded);
    expect(loaded.history!.newestSequence).toBe(680 - index * PAGE_SIZE);
    await expect.poll(() => rows(page).count()).toBeLessThan(50);
  }
  await expect(conversation(page).locator(`[data-window-key="${latestKey}"]`)).toHaveCount(0);
  await expect(conversation(page).getByText('Stored request 120: inspect fixture-120.ts.', { exact: true })).toHaveCount(0);
  expect(requests.filter(request => request.path.endsWith('/history')).every(request => Number(request.query.limit) === PAGE_SIZE && !!request.query.before)).toBe(true);
  const parsed = await Promise.all(observed);
  expect(parsed.length).toBeGreaterThanOrEqual(7);
  for (const payload of parsed) assertBounded(payload);
  expect(deliveries.some(delivery => delivery.transport === 'sse')).toBe(false);
  expect(requests.some(request => request.path.endsWith('/events'))).toBe(false);
  expect(Math.max(...deliveries.map(delivery => delivery.bytes))).toBeLessThan(Buffer.byteLength(JSON.stringify(records.get(LONG_THREAD)!.thread)) / 5);
  expect(failures).toEqual([]);
});

test('keeps the same reading anchor through prepend, delayed image decode and width reflow', async ({ page }) => {
  delayedImages = true;
  await page.setViewportSize({ width: 1100, height: 850 });
  await mount(page);
  await expect.poll(() => imageResponses.size).toBeGreaterThan(0);
  await conversation(page).evaluate(element => { element.scrollTop = Math.max(300, element.scrollTop - 300); });
  await settle(page);
  const imageAnchor = await anchor(page);
  await expect.poll(() => conversation(page).locator('img').count()).toBeGreaterThan(0);
  releaseImages();
  await expect.poll(() => conversation(page).locator('img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await expectAnchored(page, imageAnchor);
  await prepend(page);
  const resizeAnchor = await anchor(page);
  await page.setViewportSize({ width: 590, height: 850 });
  await expectAnchored(page, resizeAnchor, 6);
  expect(await conversation(page).evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
});

test('rejects an older page that arrives after switching to another saved conversation', async ({ page }) => {
  await mount(page);
  const { held } = await beginOlder(page);
  await expect(page.getByRole('textbox', { name: 'Message Codex', exact: true })).toHaveCount(0);
  await page.locator('button:is([title="Conversation history"], [data-tooltip-title="Conversation history"])').click();
  await page.getByRole('combobox', { name: 'Conversation source', exact: true }).click();
  await page.getByRole('option', { name: 'Preserved history Read only', exact: true }).click();
  await page.locator('.chat-history-select').filter({ hasText: 'Independent stored fixture' }).click();
  await expect(page.locator('.chat-thread-picker strong')).toHaveText('Independent stored fixture');
  await expect(conversation(page).locator(`[data-window-key^="${OTHER_THREAD}-entry-"]`).first()).toBeVisible();
  const selectedKeys = await rows(page).evaluateAll(elements => elements.map(element => element.getAttribute('data-window-key')));
  held.release(poisonPage); await settle(page);
  await expect(conversation(page).getByText(/Obsolete buffered page/)).toHaveCount(0);
  await expect(conversation(page).locator(`[data-window-key^="${LONG_THREAD}-entry-"]`)).toHaveCount(0);
  expect(await rows(page).evaluateAll(elements => elements.map(element => element.getAttribute('data-window-key')))).toEqual(selectedKeys);
  await page.locator('button:is([title="Conversation history"], [data-tooltip-title="Conversation history"])').click();
  await page.locator('.chat-history-select').filter({ hasText: 'Long stored fixture' }).click();
  await expect(page.getByText('Preserved conversation · Read only', { exact: true })).toBeVisible();
  expect(requests.filter(request => request.method !== 'GET' && request.path !== '/api/ui-state')).toEqual([]);
});

test('retains native text selection and focused controls when their rows leave the normal viewport', async ({ page }) => {
  await mount(page);
  const selection = await conversation(page).evaluate(element => {
    const pane = element.getBoundingClientRect();
    const paragraphs = [...element.querySelectorAll<HTMLElement>('.measured-window-row .chat-markdown p')];
    const paragraph = paragraphs.reverse().find(item => { const box = item.getBoundingClientRect(); return box.top >= pane.top && box.bottom <= pane.bottom; });
    if (!paragraph) throw new Error('No visible fixture paragraph is available for selection.');
    const range = document.createRange(); range.selectNodeContents(paragraph);
    const selected = window.getSelection()!; selected.removeAllRanges(); selected.addRange(range);
    return { key: paragraph.closest<HTMLElement>('[data-window-key]')!.dataset.windowKey!, text: selected.toString() };
  });
  await settle(page);
  await conversation(page).evaluate(element => { element.scrollTop = 350; });
  await settle(page);
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(selection.text);
  await expect(conversation(page).locator(`[data-window-key="${selection.key}"]`)).toHaveCount(1);
  await expect(conversation(page).locator(`[data-window-key="${selection.key}"]`)).not.toBeInViewport();
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await settle(page);
  const copy = conversation(page).getByRole('button', { name: 'Copy response', exact: true }).first();
  // Focusing may load earlier rows, changing which copy button is first.
  // Keep the exact original row and control identity throughout the interaction.
  const focusedKey = await copy.evaluate(element => element.closest<HTMLElement>('[data-window-key]')!.dataset.windowKey!);
  const focusedCopy = conversation(page).locator(`[data-window-key="${focusedKey}"]`).getByRole('button', { name: 'Copy response', exact: true });
  const originalControl = (await focusedCopy.elementHandle())!;
  await focusedCopy.focus();
  await expect(focusedCopy).toBeFocused();
  await conversation(page).evaluate(element => { element.scrollTop = Math.max(300, element.scrollHeight - element.clientHeight - 500); });
  await settle(page);
  await expect(focusedCopy).toBeFocused();
  expect(await originalControl.evaluate(element => element.isConnected && document.activeElement === element)).toBe(true);
  await expect.poll(() => rows(page).count()).toBeLessThan(50);
  await page.getByRole('button', { name: 'Conversation history', exact: true }).focus();
  await settle(page);
  await expect(conversation(page).locator(`[data-window-key="${focusedKey}"]`)).toHaveCount(0);
});

test('shows paging failures without losing the current viewport and retries the same cursor', async ({ page }) => {
  await mount(page);
  const { held, saved } = await beginOlder(page);
  held.fail();
  const error = conversation(page).getByRole('alert');
  await expect(error).toContainText('Fixture history page failed.');
  await expectAnchored(page, saved);
  const retryResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/history') && response.ok());
  await error.getByRole('button', { name: 'Retry', exact: true }).click();
  const retried = await retryResponse;
  expect(new URL(retried.url()).searchParams.get('before')).toBe(held.request!.query.before);
  assertBounded(await retried.json() as Thread);
  await expect(error).toHaveCount(0);
  await expect.poll(() => conversation(page).evaluate(element => element.scrollTop)).toBeGreaterThan(300);
  await expectAnchored(page, saved);
});

test('supports phone keyboard navigation and a reachable latest action with reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 850 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(page);
  expect(await page.locator('.chat-panel').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const initialTop = await conversation(page).evaluate(element => element.scrollTop);
  await conversation(page).focus(); await page.keyboard.press('PageUp');
  await expect.poll(() => conversation(page).evaluate(element => element.scrollTop)).toBeLessThan(initialTop - 50);
  for (let index = 0; index < 3; index++) await prepend(page);
  const latest = page.getByRole('button', { name: /Jump to latest/ });
  await expect(latest).toBeInViewport();
  const buttonBounds = await latest.boundingBox(); expect(buttonBounds!.height).toBeGreaterThanOrEqual(44);
  expect(await conversation(page).evaluate(element => [element, ...element.querySelectorAll('.measured-window-row, .chat-markdown, .chat-activity-summary')].every(node => {
    const style = getComputedStyle(node); return style.scrollBehavior !== 'smooth' && style.animationName === 'none' && style.boxShadow === 'none' && style.textShadow === 'none' && style.backdropFilter === 'none';
  }))).toBe(true);
  await latest.focus(); await page.keyboard.press('Enter');
  await expect(conversation(page).locator(`[data-window-key="${LONG_THREAD}-entry-720"]`)).toBeInViewport();
  await expect(page.getByRole('textbox', { name: 'Message Codex', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toHaveCount(0);
  await expect.poll(() => rows(page).count()).toBeLessThan(50);
});

// The former custom-engine epoch rewind and cursorless-stream cases below are
// migrated to actual native snapshot, history-only revert and window-limit
// contracts. Native body pages contain one official item; no fake native totals,
// signed epochs, billing estimates or legacy callback payloads are supplied.
async function mountNative(page: Page) {
  nativeMode = true;
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Conversation history', exact: true })).toContainText('Native window fixture');
  await expect(conversation(page).getByText('Native stored item 100.', { exact: true })).toBeVisible();
  await expect.poll(() => [...streams.values()].filter(id => id === NATIVE_THREAD).length).toBe(1);
  await settle(page);
  const loaded = deliveries.find(delivery => delivery.thread.backend === 'codex-cli')!.thread;
  expect(loaded.messages).toHaveLength(1);
  expect(loaded.history).toBeUndefined();
  expect(loaded.messages.every(message => message.ordinal === undefined)).toBe(true);
}
async function beginNativeOlder(page: Page) {
  const held = holdOlder(NATIVE_THREAD);
  await conversation(page).evaluate(element => { element.scrollTop = 0; });
  await expect.poll(() => held.captured).toBe(true);
  await settle(page);
  return { held, saved: await anchor(page) };
}
async function nativeOlder(page: Page) {
  const { held, saved } = await beginNativeOlder(page);
  const complete = page.waitForResponse(response => response.url().includes('/history?') && response.ok());
  held.release(); await complete;
  expect(held.payload!.messages).toHaveLength(1);
  expect(held.payload!.history).toBeUndefined();
  await expectAnchored(page, saved);
  return saved;
}
async function startNativeRefill(page: Page) {
  const held = holdLatest(NATIVE_THREAD);
  nativeAdvance(1, false); nativeWindowLimit();
  const notice = page.locator('.chat-connection');
  await expect(notice).toContainText('The native public view needs a smaller history window.');
  await expect.poll(() => [...streams.values()].filter(id => id === NATIVE_THREAD).length).toBe(0);
  await expectNoLatestRequest(page);
  expect(held.captured).toBe(false);
  await notice.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await expect.poll(() => held.captured).toBe(true);
  expect(held.payload!.messages).toHaveLength(1);
  expect(held.payload!.history).toBeUndefined();
  return held;
}

// The UI's native revert control requires a genuinely available user item.
// The snapshot supplies that official item alongside the current answer; body
// pagination still remains one item and cannot invent a missing user item.
function nativeUserSnapshot() {
  const view = projectNativeThread({ id: NATIVE_THREAD, name: 'Native window fixture', createdAt: Date.parse(at) / 1000,
    updatedAt: Date.parse(at) / 1000, status: { type: 'idle' }, turns: [{ id: NATIVE_TURN, status: 'completed', startedAt: Date.parse(at) / 1000, completedAt: Date.parse(at) / 1000 }] },
  [{ turnId: NATIVE_TURN, item: { id: 'native-real-user-item', type: 'userMessage', content: [{ type: 'text', text: 'Saved native request.', text_elements: [] }] } }], workspace.id, nativeState);
  const answer = nativePage();
  view.messages.push(...answer.messages);
  view.timeline!.entries.push(...answer.timeline!.entries.map((entry, index) => ({ ...entry, sequence: index + 2 })));
  view.timeline!.nextSequence = view.timeline!.entries.length + 1;
  view.turns![0].messageIds.push(...answer.messages.map(message => message.id));
  nativeEmit({ type: 'snapshot', thread: { ...view, nativePage: answer.nativePage } });
}

test('native conversation-only revert rejects an obsolete in-flight page and preserves the current draft', async ({ page }) => {
  await mountNative(page);
  nativeUserSnapshot();
  await expect(conversation(page).getByRole('button', { name: 'Actions for this turn', exact: true })).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Message Codex', exact: true }).fill('This draft belongs to the current conversation.');
  const { held } = await beginNativeOlder(page);
  await conversation(page).getByRole('button', { name: 'Actions for this turn', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Revert conversation from here/ }).click();
  await page.getByRole('dialog', { name: 'Revert conversation', exact: true }).getByRole('button', { name: 'Revert conversation', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Revert conversation', exact: true })).toHaveCount(0);
  expect(nativeEmpty).toBe(true);
  held.release(poisonPage); await settle(page);
  await expect(conversation(page).getByText(/Obsolete buffered page|Native stored item/)).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message Codex', exact: true })).toHaveValue('This draft belongs to the current conversation.');
  expect(requests.find(request => request.path.endsWith('/revert'))!.body).toEqual({ beforeTurnId: NATIVE_TURN });
  expect(requests.some(request => /rewind|checkpoint|changes/.test(request.path))).toBe(false);
});

test('native snapshots keep the reading anchor while approvals and questions remain beside the composer', async ({ page }) => {
  await mountNative(page);
  await nativeOlder(page);
  await page.getByRole('textbox', { name: 'Message Codex', exact: true }).fill('A draft stays intact while native updates arrive.');
  const reading = await anchor(page);
  nativeState.activeTurnId = NATIVE_TURN;
  nativeAdvance(3);
  await expect(page.getByRole('button', { name: /Jump to latest/ })).toBeVisible();
  await expectAnchored(page, reading);
  nativeState.approvals = [{ id: 'native-fixture-approval', threadId: NATIVE_THREAD, turnId: NATIVE_TURN, itemId: 'native-command-item', kind: 'command',
    title: 'Run this command?', description: 'Approve this explicit native fixture action.', command: 'printf fixture', decisions: ['accept', 'decline'], createdAt: at }];
  nativeSnapshot();
  const pending = page.locator('.chat-pending-requests');
  await expect(pending.getByRole('button', { name: 'Review', exact: true })).toBeInViewport();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(pending.getByRole('button', { name: 'Allow once', exact: true })).toHaveCount(0);
  expect(await pending.evaluate(element => element.closest('.chat-conversation') === null)).toBe(true);
  await expectAnchored(page, reading);
  await pending.getByRole('button', { name: 'Review', exact: true }).click();
  const approvalDialog = page.getByRole('dialog', { name: 'Run this command?', exact: true });
  await expect(approvalDialog.getByRole('button', { name: 'Allow once', exact: true })).toBeInViewport();
  expect(requests.filter(request => request.path.endsWith('/approval'))).toHaveLength(0);
  await approvalDialog.getByRole('button', { name: 'Allow once', exact: true }).click();
  await expect.poll(() => requests.some(request => request.path.endsWith('/approval') && request.body?.approvalId === 'native-fixture-approval' && request.body?.decision === 'accept')).toBe(true);
  await expect(approvalDialog).toHaveCount(0);
  await expectAnchored(page, reading);
  nativeState.questions = [{ id: 'native-fixture-question', threadId: NATIVE_THREAD, turnId: NATIVE_TURN, itemId: 'native-question-item', isBlocking: true,
    questions: [{ id: 'fixture-choice', header: 'Fixture choice', question: 'Which native fixture should continue?', isOther: false, isSecret: false,
      options: [{ label: 'First fixture', description: 'Continue the first recorded case.' }, { label: 'Second fixture', description: 'Continue the second recorded case.' }] }] }];
  nativeSnapshot();
  await expect(pending.getByRole('button', { name: 'Answer', exact: true })).toBeInViewport();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expectAnchored(page, reading);
  await pending.getByRole('button', { name: 'Answer', exact: true }).click();
  const questionDialog = page.getByRole('dialog', { name: 'A question from Codex', exact: true });
  await expect(questionDialog.getByRole('radio', { name: /First fixture/ })).toBeInViewport();
  await expect(questionDialog.getByRole('radio', { name: /First fixture/ })).not.toBeChecked();
  await expect(questionDialog.getByRole('button', { name: 'Send answer', exact: true })).toBeDisabled();
  await questionDialog.getByRole('radio', { name: /First fixture/ }).check();
  await questionDialog.getByRole('button', { name: 'Send answer', exact: true }).click();
  await expect.poll(() => requests.filter(request => request.path.endsWith('/answer')).length).toBe(1);
  expect(requests.find(request => request.path.endsWith('/answer'))!.body).toEqual({ requestId: 'native-fixture-question', answers: { 'fixture-choice': { answers: ['First fixture'] } } });
  await expect(questionDialog).toHaveCount(0);
  await expectAnchored(page, reading);
  const before = latestRequestCount();
  await page.getByRole('button', { name: /Jump to latest/ }).click();
  await expect.poll(latestRequestCount).toBeGreaterThan(before);
  await expect(conversation(page).getByText('Native stored item 103.', { exact: true })).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: 'Message Codex', exact: true })).toHaveValue('A draft stays intact while native updates arrive.');
  await expect.poll(() => rows(page).count()).toBeLessThan(50);
});

for (const interaction of ['selected text', 'focused copy control'] as const) {
  test(`keeps ${interaction} through a disjoint native reconnect without replacing the inspected DOM`, async ({ page }) => {
    await mountNative(page);
    const copy = conversation(page).getByRole('button', { name: 'Copy response', exact: true }).last();
    const owner = copy.locator('xpath=ancestor::*[contains(@class,"measured-window-row")][1]');
    const originalRow = (await owner.elementHandle())!, originalControl = (await copy.elementHandle())!;
    const paragraph = owner.locator('.chat-markdown p').last();
    const originalParagraph = (await paragraph.elementHandle())!;
    let selectedText = '';
    if (interaction === 'selected text') selectedText = await paragraph.evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); return selection.toString();
    });
    else await copy.focus();
    await settle(page);
    await conversation(page).evaluate(element => { element.scrollTop = element.scrollHeight; });
    await settle(page);
    const opened = requests.filter(request => request.path === `/api/threads/${NATIVE_THREAD}/events`).length;
    nativeAdvance(30, false);
    for (const [stream, id] of streams) if (id === NATIVE_THREAD) stream.end();
    await expect.poll(() => requests.filter(request => request.path === `/api/threads/${NATIVE_THREAD}/events`).length, { timeout: 10000 }).toBeGreaterThan(opened);
    expect(await originalRow.evaluate(element => element.isConnected)).toBe(true);
    if (interaction === 'selected text') {
      await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(selectedText);
      expect(await originalParagraph.evaluate(element => element.isConnected && !!window.getSelection()?.anchorNode && element.contains(window.getSelection()!.anchorNode))).toBe(true);
    } else {
      expect(await originalControl.evaluate(element => element.isConnected && document.activeElement === element)).toBe(true);
    }
    await expect(page.getByRole('button', { name: /Jump to latest/ })).toBeVisible();
    await page.getByRole('button', { name: /Jump to latest/ }).click();
    await expect(conversation(page).getByText('Native stored item 130.', { exact: true })).toHaveCount(1);
    expect(await originalRow.evaluate(element => element.isConnected)).toBe(false);
    await expect.poll(() => rows(page).count()).toBeLessThan(50);
  });
}

test('native window-limit failure waits for one explicit bounded reconnect without automatic replay', async ({ page }) => {
  await mountNative(page);
  const before = latestRequestCount(), first = await startNativeRefill(page), unexpected = holdLatest(NATIVE_THREAD);
  nativeAdvance(1, false); nativeWindowLimit();
  await expectNoLatestRequest(page);
  expect(latestRequestCount()).toBe(before + 1);
  expect(unexpected.captured).toBe(false);
  const response = latestResponse(page); first.release(); await response;
  await expect.poll(() => [...streams.values()].filter(id => id === NATIVE_THREAD).length).toBe(1);
  await expect(conversation(page).getByText('Native stored item 102.', { exact: true })).toHaveCount(1);
  await expectNoLatestRequest(page);
  expect(latestRequestCount()).toBe(before + 1);
  expect(unexpected.captured).toBe(false);
  expect(requests.filter(request => request.method !== 'GET' && request.path !== '/api/ui-state')).toEqual([]);
});

test('a failed native reconnect stays visible and requires an explicit reload', async ({ page }) => {
  await mountNative(page);
  const before = latestRequestCount(), first = await startNativeRefill(page), retry = holdLatest(NATIVE_THREAD);
  nativeAdvance(1, false); first.fail();
  const error = conversation(page).locator('.chat-run-error[role="alert"]');
  await expect(error).toContainText('Fixture history page failed.');
  await expectNoLatestRequest(page, () => nativeWindowLimit());
  expect(latestRequestCount()).toBe(before + 1); expect(retry.captured).toBe(false);
  await error.getByRole('button', { name: 'Reload conversation', exact: true }).click();
  await expect.poll(() => retry.captured).toBe(true);
  const response = latestResponse(page); retry.release(); await response;
  await expect(error).toHaveCount(0);
  await expect(conversation(page).getByText('Native stored item 102.', { exact: true })).toHaveCount(1);
  await expectNoLatestRequest(page);
  expect(latestRequestCount()).toBe(before + 2);
});

for (const fence of ['switching conversations', 'locking the workspace'] as const) {
  test(`rejects a late native reconnect response when ${fence}`, async ({ page }) => {
    await mountNative(page);
    const before = latestRequestCount(), first = await startNativeRefill(page), queued = holdLatest(NATIVE_THREAD);
    nativeAdvance(1, false); nativeWindowLimit();
    if (fence === 'switching conversations') {
      await page.getByRole('button', { name: 'Conversation history', exact: true }).click();
      await page.locator('.chat-history-select').filter({ hasText: 'Independent native fixture' }).click();
      await expect(page.locator('.chat-thread-picker strong')).toHaveText('Independent native fixture');
      await expect(conversation(page).getByText('Native stored item 1.', { exact: true })).toBeVisible();
    } else {
      await page.evaluate(() => { document.body.dataset.workspaceLocked = 'true'; window.dispatchEvent(new CustomEvent('codex:session-locked')); });
      await expect.poll(() => [...streams.values()].filter(id => id === NATIVE_THREAD).length).toBe(0);
    }
    await expectNoLatestRequest(page, () => first.release(poisonPage));
    expect(queued.captured).toBe(false); expect(latestRequestCount()).toBe(before + 1);
    await expect(conversation(page).getByText(/Obsolete buffered page/)).toHaveCount(0);
  });
}
