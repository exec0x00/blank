import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { AppSettings, FileAttachmentUploadJob, ImageAttachment, Thread, UiState, Workspace } from '../../shared/types';
import type { CodexCapabilities, CodexGoal, CodexModel, CodexQueueEntry, CodexRuntimeStatus, CodexThreadState } from '../../shared/codex-cli';
import type { NativeMcpState } from '../../shared/native-mcp';
import { uiStateFixture } from './ui-state-fixture';

// The actual ChatPanel, controls, history renderer and attachment worker run.
// Native REST/SSE DTOs and external CAS are controlled transport boundaries.
// No CLI process, provider, live HF request or simulated model run is invoked.
test.use({ serviceWorkers: 'block' });
const workspaceId = '11111111-1111-4111-8111-111111111111';
const rootId = '0199a111-1111-7111-8111-111111111111';
const otherId = '0199a222-2222-7222-8222-222222222222';
const childId = '0199a333-3333-7333-8333-333333333333';
const turnId = '0199a444-4444-7444-8444-444444444444';
const secondTurnId = '0199a555-5555-7555-8555-555555555555';
const legacyId = 'thr_preserved_previous_runtime';
const stamp = '2026-09-22T12:00:00.000Z';
const capabilities: CodexCapabilities = { conversations: true, pagination: true, queue: true, goals: true, skills: true, plan: true, review: true, historyRevert: true };
const model: CodexModel = { id: 'catalog-id-is-not-the-wire-model', model: 'native-literal-wire', displayName: 'Native model label', description: 'Native catalog fixture',
  hidden: false, isDefault: true, inputModalities: ['text', 'image'], defaultReasoningEffort: 'medium',
  supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Native medium' }, { reasoningEffort: 'xhigh', description: 'Native xhigh' }] };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN4bm4DAANjAVvvpjgdAAAAAElFTkSuQmCC', 'base64');
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const fixtureErrors = new WeakMap<Page, string[]>();
let server: Server | undefined, origin: string;

test.beforeAll(async () => {
  const fixture = await build({ stdin: { loader: 'tsx', resolveDir: process.cwd(), sourcefile: 'native-chat-harness.tsx', contents: [
    "import React from 'react';",
    "import { createRoot } from 'react-dom/client';",
    "import ChatPanel from './client/components/ChatPanel';",
    "import { api } from './client/api';",
    "import { hydrateUiState } from './client/ui-state';",
    "import { installInputMotion } from './client/input-motion';",
    "import './client/input-motion.css';",
    "installInputMotion();",
    "import './client/styles.css';",
    "const data = await api('/__fixture-bootstrap');",
    "await hydrateUiState(data.uiState, [data.workspace]);",
    "window.nativeChatNotices = [];",
    "createRoot(document.getElementById('root')).render(<React.StrictMode><ChatPanel workspace={data.workspace} settings={data.settings}",
    "onSettings={section => { document.body.dataset.openedSettings = section; }}",
    "onNotify={(message,kind) => window.nativeChatNotices.push({message,kind})}/></React.StrictMode>);",
  ].join('\n') }, bundle: true, write: false, outfile: '/tmp/codex-native-chat-fixture.js', format: 'esm', platform: 'browser', logLevel: 'silent' });
  const script = fixture.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  const style = fixture.outputFiles.find(file => file.path.endsWith('.css'))!.text;
  const worker = await build({ entryPoints: ['client/uploads.worker.ts'], bundle: true, write: false, outdir: '/tmp/codex-native-chat-worker',
    format: 'esm', platform: 'browser', splitting: true, logLevel: 'silent',
    alias: { '@huggingface/hub': path.join(process.cwd(), 'node_modules/@huggingface/hub/dist/browser/index.mjs') } });
  const workers = new Map(worker.outputFiles.map(file => [path.basename(file.path), file.text]));
  server = createServer((request, response) => {
    if (request.url === '/fixture.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(script); }
    else if (request.url === '/fixture.css') { response.setHeader('Content-Type', 'text/css'); response.end(style); }
    else if (request.url === '/uploads.worker.ts') { response.setHeader('Content-Type', 'application/javascript'); response.end(workers.get('uploads.worker.js')); }
    else if (workers.has(request.url?.slice(1) || '')) { response.setHeader('Content-Type', 'application/javascript'); response.end(workers.get(request.url!.slice(1))); }
    else if (['/', '/work', '/work/'].includes(new URL(request.url || '/', 'http://127.0.0.1').pathname)) {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}#root{max-width:960px;margin:auto}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
    } else { response.statusCode = 404; response.end(); }
  });
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
});
test.afterAll(async () => { if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); } });
test.afterEach(async ({ page }) => { expect(fixtureErrors.get(page) ?? []).toEqual([]); });

function state(patch: Partial<CodexThreadState> = {}): CodexThreadState {
  return { model: model.model, reasoningEffort: 'medium', activeTurnId: null, approvals: [], questions: [], queue: [], queueCursor: null,
    goal: null, tokenUsage: null, diff: null, capabilities: { ...capabilities }, ...patch };
}
function nativeThread(id = rootId, title = 'Native conversation'): Thread {
  return { id, workspaceId, title, backend: 'codex-cli', readOnly: false, createdAt: stamp, updatedAt: stamp, status: 'idle',
    messages: [{ id: 'native-public-user', role: 'user', content: 'Saved native user message.', createdAt: stamp, turnId }],
    turns: [{ id: turnId, userMessageId: 'native-public-user', startedAt: stamp, completedAt: stamp, status: 'completed', messageIds: ['native-public-user'] }],
    native: state(), nativePage: { nextCursor: null, backwardsCursor: null } };
}

async function fixture(page: Page, options: { busy?: boolean; legacySelected?: boolean; emptySelected?: boolean; installing?: boolean; lostRun?: boolean; children?: boolean; unreadableThread?: boolean;
  minimalQueueAck?: boolean; badQueueAck?: 'thread' | 'client' | 'missing'; unmaterialized?: boolean; directThread?: string } = {}) {
  const errors: string[] = []; fixtureErrors.set(page, errors); page.on('pageerror', error => errors.push(error.message));
  const workspace: Workspace = { id: workspaceId, name: 'Native chat workspace', path: '/data/workspaces/' + workspaceId, createdAt: stamp, updatedAt: stamp };
  const settings: AppSettings = { model: model.model, reasoningEffort: 'medium', reasoningSummary: 'auto', autoApprove: false, theme: 'dark',
    fontSize: 13, wordWrap: true, provider: 'openai', apiKeyConfigured: false, agentConfigured: true };
  const root = nativeThread(), other = nativeThread(otherId, 'Other native conversation'), child = nativeThread(childId, 'Native child');
  child.parentThreadId = rootId; child.rootThreadId = rootId;
  const legacy: Thread = { id: legacyId, workspaceId, title: 'Preserved conversation', backend: 'legacy', readOnly: true, createdAt: stamp, updatedAt: stamp,
    status: 'running', messages: [{ id: 'old-user', role: 'user', content: 'Old custom conversation stays saved.', createdAt: stamp }],
    pendingApproval: { id: 'old-approval', threadId: legacyId, tool: 'run_command', description: 'Old approval must not become native.', command: 'old-command' } };
  if (options.busy) { root.status = 'running'; root.native!.activeTurnId = turnId; }
  if (options.unmaterialized) {
    root.messages = []; root.turns = []; root.native!.loaded = false;
    root.nativePage = { nextCursor: null, backwardsCursor: null, unavailable: 'not-materialized' };
  }
  const threads = new Map([[rootId, root], [otherId, other], [legacyId, legacy], [childId, child]]);
  const runtime: CodexRuntimeStatus = { backend: 'codex-cli', state: options.installing ? 'installing' : 'ready', version: '0.155.1',
    installedVersion: '0.155.1', startedAt: stamp, updatedAt: stamp, canUpdate: true, updateBlockedReason: null, error: null, activeTurns: options.busy ? 1 : 0, capabilities: { ...capabilities } };
  const ui = uiStateFixture(), initialUi: UiState = { ...ui.read(), revision: 1, workspaces: { [workspaceId]: { threadId: options.legacySelected ? legacyId : options.emptySelected ? null : rootId } }, fieldRevisions: {} };
  const calls: Array<{ method: string; path: string; search: string; body: Record<string, unknown> | undefined }> = [];
  const queueReplies: Array<Record<string, unknown>> = [];
  const jobs = new Map<string, FileAttachmentUploadJob>(), images = new Map<string, ImageAttachment>(), contents = new Map<string, Buffer>();
  const pages = new Map<string, { items: CodexQueueEntry[]; nextCursor: string | null }>();
  const historyPages = new Map<string, Thread>();
  const controls = { loseRun: !!options.lostRun, failQueue: false, rejectAnswer: false, goalClearFalse: false, turn: 0 };
  const mcp: NativeMcpState = { connected: true, capabilities: { inventory: true, reload: true, oauth: false, resources: true, tools: true, events: true, elicitation: true, verification: false },
    requests: [], subscriptions: [], notices: [] };
  let queueGate: { entered: boolean; release: () => void; promise: Promise<void> } | null = null;
  let goalClearGate: { entered: boolean; release: () => void; promise: Promise<void> } | null = null;
  let threadReadGate: { id: string; entered: boolean; release: () => void; promise: Promise<void> } | null = null;
  await page.context().addInitScript(() => {
    const sources: Array<{ url: string; readyState: number; onmessage: ((event: MessageEvent) => void) | null }> = [];
    class Source extends EventTarget {
      static CLOSED = 2; static OPEN = 1; static CONNECTING = 0;
      readyState = 0; onmessage: ((event: MessageEvent) => void) | null = null; onopen: (() => void) | null = null; onerror = null;
      constructor(readonly url: string) { super(); sources.push(this); setTimeout(() => { if (this.readyState !== 2) { this.readyState = 1; this.onopen?.(); } }, 0); }
      close() { this.readyState = 2; }
    }
    Object.assign(window, { EventSource: Source, nativeChatSources: sources, nativeChatEmit(thread: unknown, id: string) {
      for (const source of sources) if (source.readyState === 1 && source.url.includes('/threads/' + id + '/events')) {
        source.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'snapshot', threadId: id, thread }), lastEventId: crypto.randomUUID() }));
      }
    } });
  });
  await page.context().route('https://**/*', route => { errors.push('Unexpected external request.'); return route.abort(); });
  await page.context().route('https://cas-server.xethub.hf.co/**', route => {
    const request = route.request(), headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,x-xet-session-id,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    expect(request.headers().authorization).toBe('Bearer temporary-native-chat-fixture'); expect(request.headers().cookie).toBeUndefined();
    return route.fulfill({ status: request.method() === 'GET' ? 404 : 200, headers, body: '' });
  });
  await page.context().route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), pathname = url.pathname.slice(4), method = request.method();
    const body = request.postData() ? request.postDataJSON() as Record<string, unknown> : undefined;
    calls.push({ method, path: pathname, search: url.search, body });
    const reply = (value: unknown, status = 200) => route.fulfill({ status, json: value });
    if (pathname === '/__fixture-bootstrap') return reply({ workspace, settings, uiState: initialUi });
    if (await ui.handle(route)) return;
    if (pathname === '/codex/runtime') return reply(runtime);
    const mcpBase = '/workspaces/' + workspaceId + '/native/mcp';
    if (pathname === mcpBase + '/state') {
      expect(url.searchParams.get('threadId')).toBe(rootId);
      return reply(mcp);
    }
    if (pathname.startsWith(mcpBase + '/requests/') && pathname.endsWith('/respond')) {
      expect(method).toBe('POST');
      const id = pathname.slice((mcpBase + '/requests/').length, -'/respond'.length), request = mcp.requests.find(item => item.id === id);
      expect(request).toBeDefined(); expect(body!.threadId).toBe(request!.threadId);
      expect(['accept', 'decline', 'cancel']).toContain(body!.action); expect(body!.confirmed).toBe(body!.action === 'accept');
      mcp.requests = mcp.requests.filter(item => item.id !== id);
      return reply({ accepted: true });
    }
    if (pathname === '/models') return reply({ backend: 'codex-cli', connected: runtime.state === 'ready', catalog: [model], models: [model.model] });
    if (pathname === '/workspaces/' + workspaceId + '/codex/skills') return reply({ skills: [{ name: 'Native review', description: 'Native skill fixture', path: '/data/home/.codex/skills/native-review/SKILL.md', enabled: true, scope: 'user' }], errors: [] });
    if (pathname === '/threads') {
      if (method === 'POST') {
        expect(Object.keys(body!).sort()).toEqual(['model', 'workspaceId']); expect(body!.workspaceId).toBe(workspaceId); expect(body!.model).toBe(model.model);
        const created = nativeThread('0199b000-0000-7000-8000-' + String(++controls.turn).padStart(12, '0'), 'New native conversation'); created.messages = []; created.turns = [];
        created.native!.loaded = true; created.nativePage = { nextCursor: null, backwardsCursor: null, unavailable: 'not-materialized' };
        threads.set(created.id, created); return reply(created, 201);
      }
      expect(['active', 'archived']).toContain(url.searchParams.get('archived'));
      const backend = url.searchParams.get('backend') ?? 'codex-cli';
      if (runtime.state !== 'ready' && backend === 'codex-cli') return reply({ error: 'Codex is still starting.' }, 503);
      const items = [...threads.values()].filter(thread => !thread.parentThreadId && thread.backend === backend
        && (!!thread.archivedAt === (url.searchParams.get('archived') === 'archived')))
        .map(({ messages: _messages, native: _native, ...thread }) => thread);
      return reply({ items, olderCursor: null, newerCursor: null, hasOlder: false, hasNewer: false });
    }
    if (pathname.endsWith('/git/status')) return reply({ isRepository: true, branch: 'main', files: [{ path: 'source.ts', status: 'M', staged: false }], branches: ['main'], ahead: 0, behind: 0 });
    if (pathname === '/workspaces/' + workspaceId + '/file-attachments/uploads') {
      expect(method).toBe('POST'); expect(Object.keys(body!).sort()).toEqual(['mimeType', 'name', 'size']);
      const id = randomUUID(), createdAt = new Date().toISOString();
      const job: FileAttachmentUploadJob = { id, workspaceId, name: String(body!.name), mimeType: String(body!.mimeType), size: Number(body!.size),
        state: 'reserved', bytesProcessed: 0, bucket: 'alvin3y12/codex-downloads', objectPath: 'imports/' + id + '/' + body!.name,
        createdAt, updatedAt: createdAt, sessionExpiresAt: new Date(Date.now() + 1_800_000).toISOString() };
      jobs.set(id, job); return reply(job, 201);
    }
    const upload = /^\/file-attachment-uploads\/([^/]+)(?:\/(capability|complete))?$/.exec(pathname);
    if (upload) {
      const job = jobs.get(upload[1])!;
      if (upload[2] === 'capability') return reply({ accessToken: 'temporary-native-chat-fixture', casUrl: 'https://cas-server.xethub.hf.co', exp: Math.floor(Date.now() / 1000) + 900 });
      if (upload[2] === 'complete') {
        expect(body!.sha256).toBe(digest(contents.get(job.name)!));
        job.state = 'ready'; job.bytesProcessed = job.size; job.attachment = { id: 'file_' + job.id.replaceAll('-', ''), workspaceId, name: job.name, mimeType: job.mimeType, bytes: job.size, createdAt: job.createdAt, sha256: String(body!.sha256) };
      }
      return reply(job);
    }
    if (pathname.endsWith('/attachments/from-upload')) {
      expect(Object.keys(body!).sort()).toEqual(['detail', 'sha256', 'uploadId']); const job = jobs.get(String(body!.uploadId))!;
      expect(job.state).toBe('ready'); expect(body!.sha256).toBe(digest(png));
      const id = 'att_' + job.id.replaceAll('-', '');
      const image: ImageAttachment = { id, workspaceId, name: job.name, mimeType: 'image/png', width: 1, height: 1, bytes: png.length, sha256: digest(png),
        detail: 'high', createdAt: job.createdAt, previewUrl: '/api/workspaces/' + workspaceId + '/attachments/' + id + '/content?sha256=' + digest(png) };
      images.set(id, image); return reply(image, 201);
    }
    if (/\/file-attachments\/file_[a-f0-9]{32}$/.test(pathname) && method === 'DELETE') return reply({ deleted: true });
    if (/\/attachments\/att_[a-f0-9]{32}\/content$/.test(pathname)) return route.fulfill({ contentType: 'image/png', body: png });
    const match = /^\/threads\/([^/]+)(?:\/(agents|run|input|queue|approval|answer|goal|fork|revert|archive|unarchive|compact|stop|review|history)(?:\/([^/]+)(?:\/(resume))?)?)?$/.exec(pathname);
    if (match) {
      const selected = threads.get(match[1]); if (!selected) return reply({ error: 'Unknown fixture conversation.' }, 404);
      if (selected.backend === 'legacy' && method !== 'GET') { errors.push('Legacy mutation attempted.'); return reply({ error: 'Read only.' }, 409); }
      if (!match[2]) {
        if (options.unreadableThread && method === 'GET') return reply({ error: 'This saved conversation could not be read.' }, 503);
        if (threadReadGate && method === 'GET' && selected.id === threadReadGate.id) {
          const held = threadReadGate; threadReadGate = null; held.entered = true; await held.promise;
          return reply(selected).catch(() => undefined);
        }
        if (method === 'PATCH') selected.title = String(body!.title); return reply(selected);
      }
      if (match[2] === 'agents') return reply(options.children && selected.id === rootId ? [child] : []);
      if (match[2] === 'run' || match[2] === 'input') {
        expect(Object.keys(body!).some(key => ['verbosity', 'maxOutputTokens', 'interrupt'].includes(key))).toBe(false);
        if (controls.loseRun) { controls.loseRun = false; return route.abort('failed'); }
        const acceptedTurn = match[2] === 'input' ? selected.native!.activeTurnId ?? turnId : turnId;
        if (body!.expectedTurnId) expect(body!.expectedTurnId).toBe(acceptedTurn);
        selected.status = 'running'; selected.native!.activeTurnId = acceptedTurn;
        return reply({ threadId: selected.id, turnId: acceptedTurn }, 202);
      }
      if (match[2] === 'queue' && method === 'GET') return reply(pages.get(url.searchParams.get('cursor') || '') ?? { items: selected.native!.queue, nextCursor: null });
      if (match[2] === 'queue' && method === 'POST' && !match[3]) {
        if (controls.failQueue) { controls.failQueue = false; return reply({ error: 'Native queue rejected this request.' }, 503); }
        expect(Object.keys(body!).every(key => ['prompt', 'attachments', 'fileAttachments', 'clientUserMessageId'].includes(key))).toBe(true);
        const queuedSubmission: CodexQueueEntry = { id: randomUUID(), clientUserMessageId: String(body!.clientUserMessageId), prompt: String(body!.prompt),
          attachmentNames: [...(body!.attachments ? ['native-photo.png'] : []), ...(body!.fileAttachments ? ['native-notes.txt'] : [])] };
        selected.native!.queue.push(queuedSubmission);
        const acknowledged: Record<string, unknown> = options.minimalQueueAck || options.badQueueAck
          ? { id: queuedSubmission.id, clientUserMessageId: queuedSubmission.clientUserMessageId } : { ...queuedSubmission };
        if (options.badQueueAck === 'client') acknowledged.clientUserMessageId = randomUUID();
        if (options.badQueueAck === 'missing') delete acknowledged.id;
        const acknowledgment = { threadId: options.badQueueAck === 'thread' ? otherId : selected.id, queuedSubmission: acknowledged };
        queueReplies.push(acknowledgment);
        const held = queueGate; queueGate = null;
        if (held) { held.entered = true; await held.promise; return reply(acknowledgment, 202).catch(() => undefined); }
        return reply(acknowledgment, 202);
      }
      if (match[2] === 'queue' && match[3]) {
        selected.native!.queue = selected.native!.queue.filter(item => item.id !== match[3]);
        if (method === 'DELETE') return reply({ deleted: true });
        if (match[4] === 'resume') { selected.status = 'running'; selected.native!.activeTurnId = turnId; return reply({ threadId: selected.id, turnId }, 202); }
      }
      if (match[2] === 'approval') { selected.native!.approvals = selected.native!.approvals.filter(item => item.id !== body!.approvalId); return reply({ accepted: true }); }
      if (match[2] === 'answer') {
        if (controls.rejectAnswer) return reply({ error: 'Untrusted error echoed synthetic-secret-answer-never-cache.' }, 409);
        selected.native!.questions = selected.native!.questions.filter(item => item.id !== body!.requestId); return reply({ accepted: true });
      }
      if (match[2] === 'goal') {
        if (method === 'DELETE') {
          if (controls.goalClearFalse) return reply({ cleared: false });
          selected.native!.goal = null;
          const held = goalClearGate; goalClearGate = null;
          if (held) { held.entered = true; await held.promise; return reply({ cleared: true }).catch(() => undefined); }
          return reply({ cleared: true });
        }
        else if (method !== 'GET') {
          const old = selected.native!.goal, time = Math.floor(Date.now() / 1000);
          selected.native!.goal = { threadId: selected.id, objective: String(body!.objective ?? old?.objective), status: (body!.status ?? old?.status ?? 'active') as CodexGoal['status'],
            tokenBudget: body!.tokenBudget == null ? old?.tokenBudget ?? null : Number(body!.tokenBudget), tokensUsed: old?.tokensUsed ?? 0, timeUsedSeconds: 0, createdAt: old?.createdAt ?? time, updatedAt: time };
        }
        return reply({ goal: selected.native!.goal });
      }
      if (match[2] === 'revert') { expect(Object.keys(body!)).toEqual(['beforeTurnId']); selected.messages = []; selected.turns = []; return reply(selected); }
      if (match[2] === 'fork') { const fork = nativeThread('0199f000-0000-7000-8000-000000000001', 'Native fork'); threads.set(fork.id, fork); return reply(fork); }
      if (match[2] === 'archive') { selected.archivedAt = stamp; return reply(selected); }
      if (match[2] === 'unarchive') { delete selected.archivedAt; return reply(selected); }
      if (match[2] === 'stop') { selected.status = 'interrupted'; selected.native!.activeTurnId = null; return reply({ stopped: true }); }
      if (match[2] === 'compact' || match[2] === 'review') return reply({});
      if (match[2] === 'history') return reply(historyPages.get(url.searchParams.get('before') ?? url.searchParams.get('after') ?? '') ?? selected);
    }
    errors.push(method + ' ' + pathname); return reply({ error: 'Unexpected native UI fixture request.' }, 404);
  });
  const emit = (selected = root) => page.evaluate(thread => (window as unknown as { nativeChatEmit: (thread: Thread, id: string) => void }).nativeChatEmit(thread, thread.id), selected);
  await page.goto(origin + (options.directThread ? '/?workspace=' + workspaceId + '&thread=' + options.directThread + '&view=agent' : ''));
  const panel = page.getByRole('region', { name: 'Codex conversation', exact: true }), composer = panel.getByRole('textbox', { name: 'Message Codex', exact: true });
  await expect(panel).toBeVisible();
  if ((!options.installing || options.legacySelected) && !options.emptySelected && !options.unreadableThread && !options.unmaterialized) await expect(panel.getByRole('region', { name: 'Conversation messages' })).toContainText(options.legacySelected ? 'Old custom conversation' : 'Saved native user message');
  if (!options.installing && !options.legacySelected && !options.emptySelected && !options.unreadableThread) await page.waitForFunction(id => (window as unknown as { nativeChatSources: Array<{ url: string; readyState: number }> }).nativeChatSources.some(source => source.readyState === 1 && source.url.includes('/threads/' + id + '/events')), options.directThread ?? rootId);
  return { root, other, child, legacy, runtime, threads, calls, queueReplies, controls, mcp, pages, historyPages, jobs, images, emit, panel, composer,
    holdThreadRead(id = rootId) {
      let release!: () => void;
      const pending = { id, entered: false, release: () => release(), promise: new Promise<void>(resolve => { release = resolve; }) };
      threadReadGate = pending; return pending;
    },
    holdQueue() {
      let release!: () => void;
      const pending = { entered: false, release: () => release(), promise: new Promise<void>(resolve => { release = resolve; }) };
      queueGate = pending; return pending;
    },
    holdGoalClear() {
      let release!: () => void;
      const pending = { entered: false, release: () => release(), promise: new Promise<void>(resolve => { release = resolve; }) };
      goalClearGate = pending; return pending;
    },
    async attach() {
      contents.set('native-photo.png', png); contents.set('native-notes.txt', Buffer.from('Native attachment original.'));
      await panel.getByLabel('Choose file attachments', { exact: true }).setInputFiles([...contents].map(([name, bytes]) => ({ name, buffer: bytes, mimeType: name.endsWith('.png') ? 'image/png' : 'text/plain' })));
    } };
}

test('runtime startup keeps an unsent draft and only native readiness permits a new turn', async ({ page }) => {
  const app = await fixture(page, { installing: true, emptySelected: true });
  await expect(app.panel.getByText('Installing Codex…', { exact: true })).toBeVisible();
  await expect(app.panel.getByRole('button', { name: 'New conversation', exact: true })).toBeDisabled();
  await app.composer.fill('Keep this draft while Codex starts.');
  await app.composer.press('Control+Enter');
  expect(app.calls.filter(call => /\/(run|input|queue)$/.test(call.path))).toEqual([]);
  await app.panel.getByRole('button', { name: 'Agent settings', exact: true }).click();
  expect(await page.locator('body').getAttribute('data-opened-settings')).toBe('agent');
  app.runtime.state = 'ready';
  await app.panel.getByRole('button', { name: 'Check status', exact: true }).click();
  await expect(app.panel.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await expect(app.composer).toHaveValue('Keep this draft while Codex starts.');
  await app.composer.press('Control+Enter');
  await expect.poll(() => app.calls.filter(call => call.path.endsWith('/run')).length).toBe(1);
  const created = app.calls.find(call => call.method === 'POST' && call.path === '/threads')!;
  expect(created.body).toEqual({ workspaceId, model: model.model });
  expect(app.calls.find(call => call.path.endsWith('/run'))!.body?.prompt).toBe('Keep this draft while Codex starts.');
  await expect(app.composer).toHaveValue('');
});

test('startup waits for native readiness before reopening a selected conversation and keeps its draft', async ({ page }) => {
  const app = await fixture(page, { installing: true });
  await expect(app.panel.getByText('Installing Codex…', { exact: true })).toBeVisible();
  await app.composer.fill('Keep the selected thread and its unsent draft.');
  expect(app.calls.filter(call => call.method === 'GET' && (call.path === '/threads' || call.path === '/threads/' + rootId))).toEqual([]);
  await expect(app.panel.locator('.chat-run-error')).toHaveCount(0);
  app.runtime.state = 'ready';
  await app.panel.getByRole('button', { name: 'Check status', exact: true }).click();
  await expect(app.panel.getByRole('region', { name: 'Conversation messages' })).toContainText('Saved native user message.');
  await expect(app.composer).toHaveValue('Keep the selected thread and its unsent draft.');
  await expect(app.panel.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  expect(app.calls.filter(call => call.method !== 'GET' && call.path.startsWith('/threads'))).toEqual([]);
});

test('a transient runtime status failure preserves the selected stream, draft, and confirmed native readiness', async ({ page }) => {
  const app = await fixture(page); await app.emit();
  await app.composer.fill('Keep this draft while the status request reconnects.');
  await expect(app.panel.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  const beforeReads = app.calls.filter(call => call.method === 'GET' && call.path === '/threads/' + rootId).length;
  const streams = () => page.evaluate(() => (window as unknown as { nativeChatSources: Array<{ readyState: number }> }).nativeChatSources.map(source => source.readyState));
  const beforeStreams = await streams();
  await page.route('**/api/codex/runtime', route => route.abort('failed'));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('codex:runtime-changed')));
  await expect(app.panel.locator('.chat-runtime-notice')).toContainText('Reconnecting…');
  await expect(app.panel.locator('.chat-runtime-notice')).not.toContainText('Codex needs attention');
  await expect(app.panel.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await expect(app.panel.getByRole('region', { name: 'Conversation messages' })).toContainText('Saved native user message.');
  expect(await streams()).toEqual(beforeStreams);
  expect(app.calls.filter(call => call.method === 'GET' && call.path === '/threads/' + rootId)).toHaveLength(beforeReads);
  await page.unroute('**/api/codex/runtime');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('codex:runtime-changed')));
  await expect(app.panel.locator('.chat-runtime-notice')).toHaveCount(0);
  await expect(app.composer).toHaveValue('Keep this draft while the status request reconnects.');
  expect(app.calls.filter(call => call.method !== 'GET' && call.path.startsWith('/threads'))).toEqual([]);
  app.runtime.state = 'error'; app.runtime.error = 'The official native process exited.';
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('codex:runtime-changed')));
  await expect(app.panel.locator('.chat-runtime-notice')).toContainText('The official native process exited.');
  await expect(app.panel.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
});

test('an obsolete pending status reply cannot replace a newer successful readiness check', async ({ page }) => {
  const app = await fixture(page); await app.emit(); await app.composer.fill('Retain the selected native conversation.');
  let release!: () => void, entered = false, held = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/codex/runtime', async route => {
    if (held) return route.fulfill({ status: 200, json: app.runtime });
    held = true; entered = true; await gate;
    await route.fulfill({ status: 200, json: { ...app.runtime, state: 'installing' } }).catch(() => undefined);
  });
  try {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('codex:runtime-changed')));
    await expect.poll(() => entered).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('codex:runtime-changed')));
    await expect(app.panel.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
    release();
    await page.waitForTimeout(50);
    await expect(app.panel.locator('.chat-runtime-notice')).toHaveCount(0);
    await expect(app.composer).toHaveValue('Retain the selected native conversation.');
    expect(app.calls.filter(call => call.method !== 'GET' && call.path.startsWith('/threads'))).toEqual([]);
  } finally { release(); await page.unroute('**/api/codex/runtime'); }
});

test('loading native model metadata stays neutral and a failed first fetch recovers automatically', async ({ page }) => {
  let release!: () => void, reads = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/models', async route => {
    const read = ++reads;
    if (read === 1) { await gate; return route.abort('failed').catch(() => undefined); }
    return route.fulfill({ status: 200, json: { backend: 'codex-cli', connected: true, catalog: [model], models: [model.model] } });
  });
  try {
    const app = await fixture(page); await app.emit();
    await app.composer.fill('Keep this draft while native metadata loads.');
    await expect(app.panel.getByText('Loading Codex models…', { exact: true })).toBeVisible();
    await expect(app.panel.locator('.chat-inline-error').filter({ hasText: 'Loading Codex models' })).toHaveCount(0);
    release();
    await expect.poll(() => reads).toBeGreaterThan(1);
    await expect(app.panel.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
    await expect(app.composer).toHaveValue('Keep this draft while native metadata loads.');
    expect(app.calls.filter(call => call.method !== 'GET' && call.path.startsWith('/threads'))).toEqual([]);
  } finally { release(); await page.unroute('**/api/models'); }
});

test('a stalled conversation list cannot disable the composer indefinitely or apply its late response', async ({ page }) => {
  await page.clock.install();
  let release!: () => void, hold = true, reads = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const listing = (url: URL) => url.pathname === '/api/threads';
  await page.route(listing, async route => {
    reads++;
    if (hold) await gate;
    await route.fallback().catch(() => undefined);
  });
  try {
    const app = await fixture(page); await app.emit();
    await expect(app.composer).toBeDisabled();
    const before = reads;
    await page.clock.fastForward(35_010);
    await expect(app.composer).toBeEnabled();
    await app.composer.fill('Keep this draft through a delayed conversation listing.');
    hold = false; release();
    await page.clock.fastForward(5010);
    await expect.poll(() => reads).toBeGreaterThan(before);
    await expect(app.panel.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
    await expect(app.composer).toHaveValue('Keep this draft through a delayed conversation listing.');
    await expect(app.panel.getByRole('region', { name: 'Conversation messages' })).toContainText('Saved native user message.');
    expect(app.calls.filter(call => call.method !== 'GET' && call.path.startsWith('/threads'))).toEqual([]);
  } finally { release(); await page.unroute(listing); }
});

test('New conversation stays local until first Send creates exactly one native thread and turn', async ({ page }) => {
  const app = await fixture(page);
  await app.composer.fill('Keep the existing conversation draft.');
  const mutations = () => app.calls.filter(call => call.method !== 'GET' && (call.path === '/threads' || call.path.startsWith('/threads/')));
  await app.panel.getByRole('button', { name: 'New conversation', exact: true }).click();
  await expect(app.panel.locator('.chat-header-context')).toContainText('New conversation');
  await expect(app.composer).toHaveValue('');
  await page.waitForTimeout(100);
  expect(mutations()).toEqual([]);
  await app.composer.fill('Create the real native thread only for this first message.');
  await expect(app.panel.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await app.composer.press('Control+Enter');
  await expect.poll(() => app.calls.filter(call => call.path.endsWith('/run')).length).toBe(1);
  await expect(app.composer).toHaveValue('');
  const created = [...app.threads.values()].find(thread => thread.id.startsWith('0199b000'))!;
  expect(created).toBeDefined();
  expect(mutations().map(call => ({ method: call.method, path: call.path }))).toEqual([
    { method: 'POST', path: '/threads' }, { method: 'POST', path: '/threads/' + created.id + '/run' },
  ]);
  expect(mutations()[0].body).toEqual({ workspaceId, model: model.model });
  expect(mutations()[1].body?.prompt).toBe('Create the real native thread only for this first message.');
  await app.panel.getByRole('button', { name: 'Conversation history', exact: true }).click();
  await page.getByRole('dialog', { name: 'Conversations', exact: true }).getByRole('button', { name: /^Native conversation / }).click();
  await expect(app.composer).toHaveValue('Keep the existing conversation draft.');
});

test('conversation navigation keeps names, archive state, and per-thread drafts together without deleting history', async ({ page }) => {
  const app = await fixture(page);
  const title = 'Named navigation conversation';
  const draft = 'Keep this draft through rename, archive, and conversation switching.';
  await app.composer.fill(draft);
  await app.panel.getByRole('button', { name: 'Conversation actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rename conversation', exact: true }).click();
  const rename = page.getByRole('dialog', { name: 'Rename conversation', exact: true });
  await rename.getByRole('textbox', { name: 'Conversation name', exact: true }).fill(title);
  await rename.getByRole('button', { name: 'Save name', exact: true }).click();
  const trigger = app.panel.getByRole('button', { name: 'Conversation history', exact: true });
  await expect(trigger).toHaveAttribute('aria-description', title);
  await expect(app.composer).toHaveValue(draft);
  await app.panel.getByRole('button', { name: 'Conversation actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Archive conversation', exact: true }).click();
  await expect(app.panel.getByText('This conversation is archived.', { exact: true })).toBeVisible();
  await expect(app.composer).toHaveCount(0);
  await trigger.click();
  const history = page.getByRole('dialog', { name: 'Conversations', exact: true });
  await expect(history.getByRole('button', { name: 'Archived', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(history.locator(`[data-conversation-id="${rootId}"]`)).toContainText('Archived');
  await page.keyboard.press('Escape');
  await app.panel.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(app.panel.getByText('This conversation is archived.', { exact: true })).toHaveCount(0);
  await expect(app.composer).toBeEnabled();
  await expect(app.composer).toHaveValue(draft);
  await trigger.click();
  await expect(history.getByRole('button', { name: 'Active', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await history.getByRole('button', { name: /Other native conversation/ }).click();
  await expect(app.composer).toHaveValue('');
  await trigger.click();
  await history.getByRole('searchbox', { name: 'Search conversations', exact: true }).fill('Named navigation');
  await history.getByRole('button', { name: new RegExp(title) }).click();
  await expect(app.composer).toHaveValue(draft);
  await expect(trigger).toHaveAttribute('aria-description', title);
  const mutations = app.calls.filter(call => call.method !== 'GET' && call.path.startsWith('/threads/'));
  expect(mutations.map(call => [call.method, call.path, call.body])).toEqual([
    ['PATCH', '/threads/' + rootId, { title }], ['POST', '/threads/' + rootId + '/archive', {}], ['POST', '/threads/' + rootId + '/unarchive', {}],
  ]);
});

test('native run sends literal model settings and Enter remains a newline', async ({ page }) => {
  const app = await fixture(page);
  await expect(app.panel.getByRole('combobox', { name: 'Model', exact: true })).toContainText('Native model label');
  await app.composer.fill('First line'); await app.composer.press('Enter'); await app.composer.pressSequentially('Second line');
  await expect(app.composer).toHaveValue('First line\nSecond line');
  expect(app.calls.filter(call => call.path.endsWith('/run'))).toEqual([]);
  await app.panel.getByRole('button', { name: 'Model options', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Model options', exact: true });
  await expect(dialog.getByRole('combobox', { name: 'Public reasoning summary', exact: true })).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Response verbosity', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('textbox', { name: 'Output token budget', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await app.composer.press('Control+Enter');
  await expect.poll(() => app.calls.filter(call => call.path.endsWith('/run')).length).toBe(1);
  expect(app.calls.find(call => call.path.endsWith('/run'))!.body).toEqual({ prompt: 'First line\nSecond line', mode: 'agent',
    model: model.model, reasoningEffort: 'medium', reasoningSummary: 'auto', permissionMode: 'ask', skillIds: [], clientUserMessageId: expect.any(String) });
  await expect(app.composer).toHaveValue('');
});

test('an unknown HTTP outcome keeps the draft and correlation ID without automatic replay', async ({ page }) => {
  const app = await fixture(page, { lostRun: true });
  await app.composer.fill('Only explicit retry may resend this message.'); await app.composer.press('Control+Enter');
  await expect(app.panel.locator('.chat-composer-error')).toBeVisible();
  await expect(app.composer).toHaveValue('Only explicit retry may resend this message.');
  await page.waitForTimeout(100);
  const first = app.calls.filter(call => call.path.endsWith('/run')); expect(first).toHaveLength(1);
  await app.composer.press('Control+Enter');
  await expect.poll(() => app.calls.filter(call => call.path.endsWith('/run')).length).toBe(2);
  const calls = app.calls.filter(call => call.path.endsWith('/run'));
  expect(calls[1].body).toEqual(calls[0].body);
  await expect(app.composer).toHaveValue('');
});

test('native skill selection sends its actual path and turn-bound guidance keeps an uncertain message identity', async ({ page }) => {
  const app = await fixture(page, { lostRun: true });
  await app.panel.getByRole('combobox', { name: 'Add a skill', exact: true }).click();
  await page.getByRole('option', { name: /Native review/ }).click();
  await app.composer.fill('Use the explicitly selected native skill.');
  await app.composer.press('Control+Enter');
  await expect(app.panel.locator('.chat-composer-error')).toBeVisible();
  expect(app.calls.find(call => call.path.endsWith('/run'))!.body!.skillIds).toEqual(['/data/home/.codex/skills/native-review/SKILL.md']);
  await app.panel.getByRole('button', { name: 'Remove Native review skill', exact: true }).click();
  await app.composer.fill('Keep the same uncertain text after the native turn changes.');
  app.controls.loseRun = true; await app.composer.press('Control+Enter');
  await expect.poll(() => app.calls.filter(call => call.path.endsWith('/run')).length).toBe(2);
  await expect(app.panel.locator('.chat-composer-error')).toBeVisible();
  const original = app.calls.filter(call => call.path.endsWith('/run'))[1].body!;
  app.root.status = 'running'; app.root.native!.activeTurnId = secondTurnId; await app.emit();
  await expect(app.panel.getByRole('button', { name: 'Send guidance', exact: true })).toBeEnabled();
  expect(app.calls.filter(call => call.path.endsWith('/input'))).toEqual([]);
  await app.composer.press('Control+Enter');
  await expect.poll(() => app.calls.filter(call => call.path.endsWith('/input')).length).toBe(1);
  const guidance = app.calls.find(call => call.path.endsWith('/input'))!.body!;
  expect(guidance.clientUserMessageId).toBe(original.clientUserMessageId);
  expect(guidance.expectedTurnId).toBe(secondTurnId);
});

test('interrupt requests identify the currently reported native turn', async ({ page }) => {
  const app = await fixture(page, { busy: true });
  await app.panel.getByRole('button', { name: 'Stop response', exact: true }).click();
  await expect.poll(() => app.calls.filter(call => call.path.endsWith('/stop')).length).toBe(1);
  expect(app.calls.find(call => call.path.endsWith('/stop'))!.body).toEqual({ expectedTurnId: turnId });
});

test('native steer and queue use their own acknowledgments and pending input stays out of history', async ({ page }) => {
  const app = await fixture(page, { busy: true });
  await app.composer.fill('Guide the active turn.'); await app.composer.press('Control+Enter');
  await expect.poll(() => app.calls.filter(call => call.path.endsWith('/input')).length).toBe(1);
  expect(app.calls.find(call => call.path.endsWith('/input'))!.body).toEqual({ prompt: 'Guide the active turn.', expectedTurnId: turnId, clientUserMessageId: expect.any(String) });
  await expect(app.composer).toHaveValue('');
  await app.composer.fill('A separate future message.'); await app.composer.press('Shift+Enter');
  await expect.poll(() => app.root.native!.queue.length).toBe(1);
  const queued = app.root.native!.queue[0];
  expect(app.calls.find(call => call.path.endsWith('/queue') && call.method === 'POST')!.body).toEqual({ prompt: queued.prompt, clientUserMessageId: queued.clientUserMessageId });
  const row = app.panel.locator('[data-submission-id="' + queued.id + '"]');
  await expect(row).toContainText(queued.prompt);
  await expect(row).not.toContainText(model.model); await expect(row).not.toContainText('Held');
  await expect(app.panel.getByRole('region', { name: 'Conversation messages', exact: true })).not.toContainText(queued.prompt);
  await row.getByRole('button', { name: /^Cancel/ }).click();
  await expect(row).toHaveCount(0);
  expect(app.calls.filter(call => call.method === 'DELETE').map(call => call.path)).toEqual(['/threads/' + rootId + '/queue/' + queued.id]);
});

test('a minimal native queue acknowledgment clears the accepted draft before a separate queue refresh', async ({ page }) => {
  const app = await fixture(page, { busy: true, minimalQueueAck: true }), held = app.holdThreadRead();
  try {
    await app.composer.fill('A queued preview comes from the native read.');
    await app.composer.press('Shift+Enter');
    await expect.poll(() => app.queueReplies.length).toBe(1);
    const queued = app.root.native!.queue[0];
    expect(app.queueReplies[0]).toEqual({ threadId: rootId, queuedSubmission: { id: queued.id, clientUserMessageId: queued.clientUserMessageId } });
    await expect(app.composer).toHaveValue('');
    await expect.poll(() => held.entered).toBe(true);
    await expect(app.panel.locator('[data-submission-id="' + queued.id + '"]')).toHaveCount(0);
    held.release();
    await expect(app.panel.locator('[data-submission-id="' + queued.id + '"]')).toContainText(queued.prompt);
    await expect(app.panel.getByRole('region', { name: 'Conversation messages', exact: true })).not.toContainText(queued.prompt);
    expect(app.calls.filter(call => call.method === 'POST' && call.path.endsWith('/queue'))).toHaveLength(1);
    const submittedAt = app.calls.findIndex(call => call.method === 'POST' && call.path.endsWith('/queue'));
    expect(app.calls.slice(submittedAt + 1).some(call => call.method === 'GET' && call.path === '/threads/' + rootId)).toBe(true);
  } finally { held.release(); }
});

for (const badQueueAck of ['thread', 'client', 'missing'] as const) test('an unconfirmed queue acknowledgment preserves the draft without replay: ' + badQueueAck, async ({ page }) => {
  const app = await fixture(page, { busy: true, badQueueAck });
  await app.composer.fill('Keep this draft until its native receipt matches.');
  await app.composer.press('Shift+Enter');
  await expect(app.panel.locator('.chat-composer-error')).toContainText('did not confirm');
  await expect(app.composer).toHaveValue('Keep this draft until its native receipt matches.');
  await page.waitForTimeout(100);
  expect(app.calls.filter(call => call.method === 'POST' && call.path.endsWith('/queue'))).toHaveLength(1);
  expect(app.calls.filter(call => call.method === 'POST' && /\/(run|input)$/.test(call.path))).toEqual([]);
});

test('an unloaded unmaterialized native thread keeps its draft and offers a fresh local conversation', async ({ page }) => {
  const app = await fixture(page, { unmaterialized: true });
  const notice = app.panel.locator('.chat-connection');
  await expect(notice).toContainText('New');
  await app.composer.fill('Preserve this draft for the unresumable native metadata.');
  await expect(app.panel.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  await app.composer.press('Control+Enter');
  expect(app.calls.filter(call => call.method !== 'GET' && call.path.startsWith('/threads/'))).toEqual([]);
  await notice.getByRole('button', { name: 'New conversation', exact: true }).click();
  await expect(app.composer).toBeVisible();
  await app.composer.fill('A new local draft can be sent explicitly.');
  await expect(app.panel.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await page.waitForTimeout(80);
  expect(app.calls.filter(call => call.method !== 'GET' && (call.path === '/threads' || call.path.startsWith('/threads/')))).toEqual([]);
  await app.panel.getByRole('button', { name: 'Conversation history', exact: true }).click();
  await page.getByRole('dialog', { name: 'Conversations', exact: true }).getByRole('button', { name: /^Native conversation / }).click();
  await expect(app.composer).toHaveValue('Preserve this draft for the unresumable native metadata.');
  await expect(app.panel.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
});

test('unsupported native plan and queue controls stay absent without swallowing Shift Enter', async ({ page }) => {
  const app = await fixture(page, { busy: true });
  app.root.native!.capabilities = { ...capabilities, plan: false, queue: false, goals: false }; await app.emit();
  await expect(app.panel.getByRole('button', { name: 'Plan', exact: true })).toHaveCount(0);
  await expect(app.panel.getByRole('button', { name: 'Queue message for next turn', exact: true })).toHaveCount(0);
  await app.composer.fill('Keep typing'); await app.composer.press('Shift+Enter');
  await expect(app.composer).toHaveValue('Keep typing\n');
  expect(app.calls.filter(call => call.path.endsWith('/queue') && call.method === 'POST')).toEqual([]);
});

test('only offered approval decisions are sent and secret question answers never become cached drafts', async ({ page }) => {
  const app = await fixture(page, { busy: true });
  app.root.native!.approvals = [{ id: 'native-approval', threadId: rootId, turnId, itemId: 'native-command',
    kind: 'command', title: 'Native command approval', description: 'Inspect the saved project.', command: 'pwd',
    decisions: ['acceptForSession', 'decline'], createdAt: stamp }];
  await app.emit();
  await app.panel.locator('.chat-approval').getByRole('button', { name: 'Review', exact: true }).click();
  const approval = page.getByRole('dialog', { name: 'Native command approval', exact: true });
  await expect(approval.getByRole('button', { name: 'Allow once', exact: true })).toHaveCount(0);
  await approval.getByRole('button', { name: 'Allow for this session', exact: true }).click();
  await expect.poll(() => app.calls.filter(call => call.path.endsWith('/approval')).length).toBe(1);
  expect(app.calls.find(call => call.path.endsWith('/approval'))!.body).toEqual({ approvalId: 'native-approval', decision: 'acceptForSession' });
  app.root.native!.questions = [{ id: 'native-question', threadId: rootId, turnId, itemId: 'native-input', isBlocking: true,
    questions: [{ id: 'secret', header: 'Secret code', question: 'Enter the secret response.', isSecret: true, isOther: false, options: null },
      { id: 'choice', header: 'Choice', question: 'Choose the offered value.', isSecret: false, isOther: false, options: [{ label: 'First choice', description: 'Native offered value.' }] }] }];
  await app.emit();
  await app.panel.locator('.chat-question').getByRole('button', { name: 'Answer', exact: true }).click();
  const question = page.getByRole('dialog', { name: 'Questions from Codex', exact: true }), secret = question.getByLabel('Your answer for Secret code', { exact: true });
  await expect(secret).toHaveAttribute('type', 'password');
  await expect(question.getByText('Something else', { exact: true })).toHaveCount(0);
  await secret.fill('synthetic-secret-answer-never-cache');
  await expect(secret).toHaveAttribute('data-private-input', 'true');
  await expect(secret).not.toHaveAttribute('data-input-motion-active', 'true');
  await expect(page.locator('.cw-input-motion-layer:not([hidden])')).toHaveCount(0);
  await question.getByRole('button', { name: 'Next question', exact: true }).click();
  await question.getByRole('radio', { name: /First choice/ }).check();
  expect(await page.content()).not.toContain('synthetic-secret-answer-never-cache');
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain('synthetic-secret-answer-never-cache');
  app.controls.rejectAnswer = true;
  await question.getByRole('button', { name: 'Send answers', exact: true }).click();
  await expect(question.getByRole('alert')).toContainText('The answer could not be confirmed');
  expect(await page.content()).not.toContain('synthetic-secret-answer-never-cache');
  await expect(secret).toHaveValue('');
  const reply = app.calls.find(call => call.path.endsWith('/answer'))!;
  expect(reply.body).toEqual({ requestId: 'native-question', answers: { secret: { answers: ['synthetic-secret-answer-never-cache'] }, choice: { answers: ['First choice'] } } });
  await question.getByRole('button', { name: 'Back', exact: true }).click();
  await secret.fill('synthetic-secret-answer-never-cache');
  await page.evaluate(() => { document.body.dataset.workspaceLocked = 'true'; window.dispatchEvent(new Event('codex:session-locked')); });
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  await page.evaluate(() => { document.body.dataset.workspaceLocked = 'false'; window.dispatchEvent(new Event('codex:session-unlocked')); });
  await app.panel.locator('.chat-question').getByRole('button', { name: 'Answer', exact: true }).click();
  await expect(secret).toHaveValue('');
});

test('native child requests use the child thread endpoints and expose no custom lifecycle controls', async ({ page }) => {
  const app = await fixture(page, { children: true });
  app.child.native!.approvals = [{ id: 'child-approval', threadId: childId, turnId, itemId: 'child-item', kind: 'fileChange',
    title: 'Native child file change', description: 'Apply the native child change.', decisions: ['accept', 'cancel'], createdAt: stamp }];
  await app.panel.getByRole('button', { name: 'Refresh subagent activity', exact: true }).click();
  const child = app.panel.getByRole('article', { name: 'Subagent Native child', exact: true });
  await child.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('dialog', { name: 'Native child file change', exact: true }).getByRole('button', { name: 'Allow once', exact: true }).click();
  await expect.poll(() => app.calls.filter(call => call.path === '/threads/' + childId + '/approval').length).toBe(1);
  expect(app.calls.find(call => call.path === '/threads/' + childId + '/approval')!.body).toEqual({ approvalId: 'child-approval', decision: 'accept' });
  await expect(child.getByRole('button', { name: /Close agent|Resume agent|Stop response/ })).toHaveCount(0);
  expect(app.calls.filter(call => call.method !== 'GET' && call.path.includes('/agents'))).toEqual([]);
});

test('explicit root and child request checks report failures inside the dialog and join an existing child refresh', async ({ page }) => {
  const app = await fixture(page, { children: true });
  app.root.native!.approvals = [{ id: 'root-check', threadId: rootId, turnId, itemId: 'root-item', kind: 'command',
    title: 'Check root request', description: 'Review the pending root command.', command: 'pwd', decisions: ['accept', 'decline'], createdAt: stamp }];
  app.child.native!.approvals = [{ id: 'child-check', threadId: childId, turnId, itemId: 'child-item', kind: 'fileChange',
    title: 'Check child request', description: 'Review the pending child change.', decisions: ['accept', 'decline'], createdAt: stamp }];
  await app.emit();
  await app.panel.getByRole('button', { name: 'Refresh subagent activity', exact: true }).click();
  const child = app.panel.getByRole('article', { name: 'Subagent Native child', exact: true });
  await expect(child.getByRole('button', { name: 'Review', exact: true })).toBeVisible();
  await app.panel.locator('.chat-pending-requests .chat-approval').getByRole('button', { name: 'Review', exact: true }).click();
  const rootDialog = page.getByRole('dialog', { name: 'Check root request', exact: true });
  const rootRoute = '**/api/threads/' + rootId;
  await page.route(rootRoute, route => route.fulfill({ status: 503, json: { error: 'The root request status could not be checked.' } }));
  await rootDialog.getByRole('button', { name: 'Check request', exact: true }).click();
  await expect(rootDialog.getByRole('alert')).toContainText('The root request status could not be checked.');
  await rootDialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.unroute(rootRoute);

  let entered = 0, release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/threads/' + rootId + '/agents', async route => {
    entered++; await held;
    await route.fulfill({ status: 503, json: { error: 'The child request status could not be checked.' } }).catch(() => undefined);
  });
  try {
    await app.panel.getByRole('button', { name: 'Refresh subagent activity', exact: true }).click();
    await expect.poll(() => entered).toBe(1);
    await child.getByRole('button', { name: 'Review', exact: true }).click();
    const childDialog = page.getByRole('dialog', { name: 'Check child request', exact: true });
    await childDialog.getByRole('button', { name: 'Check request', exact: true }).click();
    await expect(childDialog.getByRole('button', { name: 'Check request', exact: true })).toBeDisabled();
    expect(entered).toBe(1);
    release();
    await expect(childDialog.getByRole('alert')).toContainText('The child request status could not be checked.');
    await expect(childDialog.getByRole('button', { name: 'Allow once', exact: true })).toBeEnabled();
    expect(app.calls.filter(call => call.path.endsWith('/approval'))).toHaveLength(0);
  } finally { release(); }
});

test('advertised MCP requests appear in the composer shelf and descendant answers use the owning thread', async ({ page }) => {
  const app = await fixture(page, { children: true });
  expect(app.calls.filter(call => call.path.includes('/native/mcp/'))).toEqual([]);
  app.mcp.requests = [
    { id: 'mcp-root', threadId: rootId, serverName: 'parent-mcp', mode: 'form', title: 'Review parent context', message: 'Choose the context for this request.',
      unavailableReason: null, expiresAt: '2027-09-30T12:00:00Z', form: { unavailableReason: null, field: { key: '', label: 'Request fields', kind: 'object', required: true,
        additionalProperties: false, fields: [{ key: 'scope', label: 'Scope', kind: 'string', required: true, minLength: 1, maxLength: 200 }] } } },
    { id: 'mcp-child', threadId: childId, threadTitle: 'Native child', serverName: 'child-mcp', mode: 'form', title: 'Review child context', message: 'Choose the context for the child request.',
      unavailableReason: null, expiresAt: '2027-09-30T12:00:00Z', form: { unavailableReason: null, field: { key: '', label: 'Request fields', kind: 'object', required: true,
        additionalProperties: false, fields: [{ key: 'scope', label: 'Scope', kind: 'string', required: true, minLength: 1, maxLength: 200 }] } } },
  ];
  app.root.native!.capabilities.mcpRequests = true; await app.emit();
  const shelf = app.panel.locator('.chat-pending-requests').getByRole('region', { name: 'MCP requests', exact: true });
  await expect(shelf).toBeVisible();
  await expect(shelf.getByRole('button', { name: /parent-mcp needs your input/ })).toBeVisible();
  await expect(shelf.getByRole('button', { name: /child-mcp needs your input/ })).toContainText('Native child');
  await expect(app.panel.getByRole('region', { name: 'MCP requests', exact: true })).toHaveCount(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(app.calls.filter(call => call.method === 'POST' && call.path.includes('/native/mcp/'))).toEqual([]);
  await shelf.getByRole('button', { name: /child-mcp needs your input/ }).click();
  const childDialog = page.getByRole('dialog', { name: 'Review child context', exact: true });
  await childDialog.getByRole('textbox', { name: /^Scope/ }).fill('Use only public context.');
  await childDialog.getByRole('button', { name: 'Send answers', exact: true }).click();
  await expect(childDialog).toHaveCount(0);
  await expect(shelf.getByRole('button', { name: /child-mcp needs your input/ })).toHaveCount(0);
  await expect(shelf.getByRole('button', { name: /parent-mcp needs your input/ })).toBeVisible();
  const childReply = app.calls.find(call => call.path.endsWith('/native/mcp/requests/mcp-child/respond'));
  expect(childReply?.body).toEqual({ threadId: childId, action: 'accept', content: { scope: 'Use only public context.' }, confirmed: true });
  await shelf.getByRole('button', { name: /parent-mcp needs your input/ }).click();
  await page.getByRole('dialog', { name: 'Review parent context', exact: true }).getByRole('button', { name: 'Cancel request', exact: true }).click();
  await expect(shelf).toHaveCount(0);
  expect(app.calls.find(call => call.path.endsWith('/native/mcp/requests/mcp-root/respond'))?.body)
    .toEqual({ threadId: rootId, action: 'cancel', content: null, confirmed: false });
});

test('agent switching, browser history and a separate child window preserve independent unsent drafts', async ({ page }) => {
  const app = await fixture(page, { children: true });
  await app.composer.fill('Unsent main-agent draft.');
  await app.panel.getByRole('button', { name: 'Switch to agent Native child', exact: true }).click();
  await expect(app.panel.getByRole('button', { name: 'Conversation history', exact: true })).toHaveAttribute('aria-description', 'Native child');
  await expect(app.composer).toHaveValue('');
  await app.composer.fill('Unsent child-agent draft.');
  await expect(page).toHaveURL(new RegExp('thread=' + childId));
  await app.panel.getByRole('combobox', { name: 'Switch agent', exact: true }).click();
  await page.getByRole('option', { name: /Native conversation/ }).click();
  await expect(app.composer).toHaveValue('Unsent main-agent draft.');
  await page.goBack();
  await expect(app.panel.getByRole('button', { name: 'Conversation history', exact: true })).toHaveAttribute('aria-description', 'Native child');
  await expect(app.composer).toHaveValue('Unsent child-agent draft.');
  await app.panel.getByRole('button', { name: 'Parent agent', exact: true }).click();
  await expect(app.composer).toHaveValue('Unsent main-agent draft.');
  const link = app.panel.getByRole('link', { name: 'Open agent Native child in new window', exact: true });
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  const popupPromise = page.waitForEvent('popup');
  await link.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(origin + '/work?workspace=' + workspaceId + '&thread=' + childId + '&view=agent');
  await expect(popup.getByRole('button', { name: 'Conversation history', exact: true })).toHaveAttribute('aria-description', 'Native child');
  await expect(popup.getByRole('textbox', { name: 'Message Codex', exact: true })).toHaveValue('');
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await popup.getByRole('textbox', { name: 'Message Codex', exact: true }).fill('Independent window draft.');
  await expect(app.composer).toHaveValue('Unsent main-agent draft.');
  await popup.getByRole('button', { name: 'Parent agent', exact: true }).click();
  await expect(popup.getByRole('textbox', { name: 'Message Codex', exact: true })).toHaveValue('');
  await expect(app.composer).toHaveValue('Unsent main-agent draft.');
  expect(app.calls.filter(call => call.method !== 'GET' && !call.path.startsWith('/ui-state'))).toEqual([]);
  await popup.close();
});

test('a directly linked native child resolves its family and supports keyboard switching on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const app = await fixture(page, { children: true, directThread: childId });
  const picker = app.panel.getByRole('combobox', { name: 'Switch agent', exact: true });
  await expect(picker).toBeEnabled();
  await picker.focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Home'); await page.keyboard.press('Enter');
  await expect(app.panel.getByRole('button', { name: 'Conversation history', exact: true })).toHaveAttribute('aria-description', 'Native conversation');
  await expect(app.panel.getByRole('button', { name: 'Switch to agent Native child', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await app.panel.getByRole('link', { name: 'Open agent in new window', exact: true }).focus();
  await expect(app.panel.getByRole('link', { name: 'Open agent in new window', exact: true })).toBeFocused();
  expect(app.calls.some(call => call.method !== 'GET' && call.path !== '/ui-state')).toBe(false);
});

test('a stale child response and a foreign-workspace conversation cannot replace the selected agent', async ({ page }) => {
  const app = await fixture(page, { children: true });
  await app.composer.fill('Keep this main draft.');
  const held = app.holdThreadRead(childId);
  await app.panel.getByRole('button', { name: 'Switch to agent Native child', exact: true }).click();
  await expect.poll(() => held.entered).toBe(true);
  await page.goBack();
  await expect(app.composer).toHaveValue('Keep this main draft.');
  held.release();
  await expect(app.panel.getByRole('button', { name: 'Conversation history', exact: true })).toHaveAttribute('aria-description', 'Native conversation');
  app.other.workspaceId = 'different-workspace';
  await page.evaluate(({ workspaceId, otherId }) => {
    history.pushState(null, '', '?workspace=' + workspaceId + '&thread=' + otherId);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, { workspaceId, otherId });
  await expect(app.panel.getByRole('alert').filter({ hasText: 'The conversation did not match this workspace.' })).toBeVisible();
  await expect(app.panel.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  expect(await page.evaluate(id => (window as unknown as { nativeChatSources: Array<{ url: string }> }).nativeChatSources.some(source => source.url.includes('/threads/' + id + '/events')), otherId)).toBe(false);
  await page.goBack();
  await expect(app.composer).toHaveValue('Keep this main draft.');
  await page.waitForFunction(id => (window as unknown as { nativeChatSources: Array<{ url: string; readyState: number }> }).nativeChatSources.some(source => source.readyState === 1 && source.url.includes('/threads/' + id + '/events')), rootId);
  await app.emit({ ...app.root, workspaceId: 'different-workspace', title: 'Foreign snapshot', messages: [{ id: 'foreign', role: 'assistant', content: 'Do not display a foreign snapshot.', createdAt: stamp }] });
  await expect(app.panel.getByRole('alert').filter({ hasText: 'A conversation update did not match this workspace.' })).toBeVisible();
  await expect(app.panel.getByRole('region', { name: 'Conversation messages', exact: true })).not.toContainText('Do not display a foreign snapshot.');
  await expect(app.composer).toHaveValue('Keep this main draft.');
});

test('native usage stays unknown until reported and compaction uses no custom context endpoint', async ({ page }) => {
  const app = await fixture(page);
  await app.panel.getByRole('button', { name: 'Context and usage', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Context and usage', exact: true });
  await expect(dialog).toContainText('Codex has not reported the current context');
  await expect(dialog).not.toContainText('Reported requests'); await expect(dialog).not.toContainText('Estimated');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  app.root.native!.tokenUsage = { contextTokens: 8192, modelContextWindow: 32768, reportedAt: new Date().toISOString(),
    total: { totalTokens: 12345, inputTokens: 12000, outputTokens: 345, cachedInputTokens: 1000, cacheWriteInputTokens: 0, reasoningOutputTokens: 245 } };
  await app.emit();
  await app.panel.getByRole('button', { name: 'Context and usage', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Context and usage', exact: true });
  await expect(dialog.getByText('8,192', { exact: true })).toBeVisible();
  await expect(dialog).toContainText('Last reported context');
  await expect(dialog.locator('time')).toHaveAttribute('datetime', app.root.native!.tokenUsage!.reportedAt);
  await expect(dialog.getByRole('cell', { name: '12,345', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Compact context', exact: true }).click();
  await expect.poll(() => app.calls.filter(call => call.path.endsWith('/compact')).length).toBe(1);
  expect(app.calls.find(call => call.path.endsWith('/compact'))!.body).toEqual({});
  expect(app.calls.some(call => call.path.includes('context-details'))).toBe(false);
});

test('context refresh preserves newer live reports and rewind invalidation, with independent thread values', async ({ page }) => {
  const app = await fixture(page);
  app.root.native!.tokenUsage = { contextTokens: 8192, modelContextWindow: 32768, reportedAt: stamp,
    total: { totalTokens: 12345, inputTokens: 12000, outputTokens: 345, cachedInputTokens: 1000, cacheWriteInputTokens: 0, reasoningOutputTokens: 245 } };
  await app.emit();
  let held: { snapshot: Thread; entered: boolean; release: () => void; promise: Promise<void> } | null = null;
  const hold = () => {
    let release!: () => void;
    const pending = { snapshot: structuredClone(app.root), entered: false, release: () => release(), promise: new Promise<void>(resolve => { release = resolve; }) };
    held = pending; return pending;
  };
  await page.route('**/api/threads/' + rootId, async route => {
    if (route.request().method() !== 'GET' || !held) return route.fallback();
    const pending = held; held = null; pending.entered = true; await pending.promise;
    return route.fulfill({ json: pending.snapshot }).catch(() => undefined);
  });
  const olderReport = hold();
  await app.panel.getByRole('button', { name: 'Context and usage', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Context and usage', exact: true });
  await expect.poll(() => olderReport.entered).toBe(true);
  app.root.native!.tokenUsage = { ...app.root.native!.tokenUsage!, contextTokens: 9000, reportedAt: '2026-09-30T12:01:00.000Z' };
  await app.emit(); await expect(dialog.locator('.chat-context-value strong')).toHaveText('9,000');
  olderReport.release(); await expect(dialog.locator('.chat-context-refresh')).toContainText('Reported conversation data');
  await expect(dialog.locator('.chat-context-value strong')).toHaveText('9,000');

  const beforeRewind = hold();
  await dialog.getByRole('button', { name: 'Refresh context details', exact: true }).click();
  await expect.poll(() => beforeRewind.entered).toBe(true);
  app.root.native!.tokenUsage = null; await app.emit();
  await expect(dialog.locator('.chat-context-value strong')).toHaveText('Not reported');
  beforeRewind.release(); await expect(dialog.locator('.chat-context-refresh')).toContainText('Reported conversation data');
  await expect(dialog.locator('.chat-context-value strong')).toHaveText('Not reported');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();

  app.other.native!.tokenUsage = { ...olderReport.snapshot.native!.tokenUsage!, contextTokens: 3333 };
  await app.panel.getByRole('button', { name: 'Conversation history', exact: true }).click();
  await page.getByRole('dialog', { name: 'Conversations', exact: true }).getByRole('button', { name: /Other native conversation/ }).click();
  await expect(app.panel.locator('.chat-header-context')).toContainText('Other native conversation');
  await app.panel.getByRole('button', { name: 'Context and usage', exact: true }).click();
  await expect(dialog.locator('.chat-context-value strong')).toHaveText('3,333');
  await expect(dialog).not.toContainText('9,000');
});

test('native goals use POST and PATCH without a fake budget clear or scheduler options', async ({ page }) => {
  const app = await fixture(page);
  await app.panel.getByRole('button', { name: 'Conversation actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Set a goal', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Create goal', exact: true });
  await create.getByRole('textbox', { name: 'Objective', exact: true }).fill('Complete the native fixture objective.');
  await create.getByRole('textbox', { name: 'Token budget', exact: true }).fill('5000');
  await create.getByRole('button', { name: 'Create goal', exact: true }).click();
  await expect(create).toHaveCount(0);
  expect(app.calls.find(call => call.path.endsWith('/goal') && call.method === 'POST')!.body).toEqual({ objective: 'Complete the native fixture objective.', status: 'active', tokenBudget: 5000 });
  const goal = app.panel.getByRole('region', { name: 'Conversation goal', exact: true });
  await goal.getByRole('button', { name: 'Pause', exact: true }).click();
  await goal.getByRole('button', { name: 'Resume', exact: true }).click();
  const resume = page.getByRole('dialog', { name: 'Resume goal', exact: true });
  await expect(resume.getByRole('checkbox')).toHaveCount(0);
  await resume.getByRole('button', { name: 'Resume goal', exact: true }).click();
  await expect(resume).toHaveCount(0);
  expect(app.calls.filter(call => call.path.endsWith('/goal') && call.method === 'PATCH').map(call => call.body)).toEqual([{ status: 'paused' }, { status: 'active' }]);
  expect(app.root.native!.goal!.tokenBudget).toBe(5000);
  await goal.getByRole('button', { name: 'Goal actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit goal', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit goal', exact: true });
  await edit.getByRole('textbox', { name: 'Objective', exact: true }).fill('Updated native objective.');
  await edit.getByRole('button', { name: 'Save goal', exact: true }).click();
  await expect(edit).toHaveCount(0);
  expect(app.calls.filter(call => call.path.endsWith('/goal') && call.method === 'PATCH').at(-1)!.body).toEqual({ objective: 'Updated native objective.' });
  app.controls.goalClearFalse = true;
  await goal.getByRole('button', { name: 'Goal actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Clear goal', exact: true }).click();
  const clear = page.getByRole('dialog', { name: 'Clear goal?', exact: true });
  await clear.getByRole('button', { name: 'Clear goal', exact: true }).click();
  await expect(clear.getByRole('alert')).toContainText('did not confirm clearing');
  await expect(goal).toContainText('Updated native objective.');
  expect(app.calls.filter(call => call.path.endsWith('/goal') && call.method === 'GET')).toHaveLength(1);
  app.controls.goalClearFalse = false;
  await clear.getByRole('button', { name: 'Clear goal', exact: true }).click();
  await expect(clear).toHaveCount(0); await expect(goal).toHaveCount(0);
});

test('native conversation revert preserves the current draft and offers no workspace restore action', async ({ page }) => {
  const app = await fixture(page);
  await app.composer.fill('Keep this unsent draft across history revert.');
  await app.panel.getByRole('button', { name: 'Actions for this turn', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Revert conversation from here/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Revert conversation', exact: true });
  await expect(dialog).toContainText('Workspace files, Git history and terminal commands stay as they are');
  await expect(dialog.getByRole('radio')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Revert conversation', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(app.composer).toHaveValue('Keep this unsent draft across history revert.');
  expect(app.calls.find(call => call.path.endsWith('/revert'))!.body).toEqual({ beforeTurnId: turnId });
  expect(app.calls.some(call => /rewind|changes|workflows|auto-name/.test(call.path))).toBe(false);
});

test('native review and fork call the official conversation routes without a custom title job', async ({ page }) => {
  const app = await fixture(page);
  await app.panel.getByRole('button', { name: 'Conversation actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Review code', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review code', exact: true });
  await review.getByRole('button', { name: 'Start review', exact: true }).click();
  await expect(review).toHaveCount(0);
  expect(app.calls.find(call => call.path.endsWith('/review'))!.body).toEqual({ target: { type: 'uncommittedChanges' } });
  await app.panel.getByRole('button', { name: 'Actions for this turn', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Fork from here/ }).click();
  await expect(app.panel.locator('.chat-header-context')).toContainText('Native fork');
  expect(app.calls.find(call => call.path.endsWith('/fork'))!.body).toEqual({ lastTurnId: turnId });
  expect(app.calls.some(call => call.path.includes('auto-name'))).toBe(false);
});

test('a confirmed clear of the captured native goal cannot erase a newer streamed goal', async ({ page }) => {
  const app = await fixture(page);
  const now = Math.floor(Date.now() / 1000);
  app.root.native!.goal = { threadId: rootId, objective: 'The original goal.', status: 'paused', tokenBudget: 5000,
    tokensUsed: 10, timeUsedSeconds: 1, createdAt: now, updatedAt: now }; await app.emit();
  const goal = app.panel.getByRole('region', { name: 'Conversation goal', exact: true }), held = app.holdGoalClear();
  try {
    await goal.getByRole('button', { name: 'Goal actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Clear goal', exact: true }).click();
    const clear = page.getByRole('dialog', { name: 'Clear goal?', exact: true });
    await clear.getByRole('button', { name: 'Clear goal', exact: true }).click();
    await expect.poll(() => held.entered).toBe(true);
    app.root.native!.goal = { threadId: rootId, objective: 'Keep the newer native goal.', status: 'paused', tokenBudget: 6000,
      tokensUsed: 0, timeUsedSeconds: 0, createdAt: now + 1, updatedAt: now + 1 }; await app.emit();
    held.release();
    await expect(clear).toHaveCount(0); await expect(goal).toContainText('Keep the newer native goal.');
    expect(app.calls.filter(call => call.path.endsWith('/goal') && call.method === 'DELETE')).toHaveLength(1);
  } finally { held.release(); }
});

test('previous conversations stay readable during CLI startup and list sources never share cursors', async ({ page }) => {
  const app = await fixture(page, { legacySelected: true, installing: true });
  await expect(app.panel.getByText('Preserved conversation · Read only', { exact: true })).toBeVisible();
  await expect(app.composer).toHaveCount(0);
  await expect(app.panel.getByRole('button', { name: 'Conversation actions', exact: true })).toHaveCount(0);
  await expect(app.panel.locator('.chat-approval')).toHaveCount(0);
  expect(app.calls.filter(call => call.method !== 'GET' && call.path.startsWith('/threads/' + legacyId))).toEqual([]);
  await app.panel.locator('.chat-thread-picker').click();
  const history = page.getByRole('dialog', { name: 'Conversations', exact: true });
  await expect(history.getByRole('combobox', { name: 'Conversation source', exact: true })).toContainText('Preserved history');
  await expect.poll(() => app.calls.some(call => call.path === '/threads' && call.search.includes('backend=legacy'))).toBe(true);
  app.runtime.state = 'ready';
  await history.getByRole('combobox', { name: 'Conversation source', exact: true }).click();
  await page.getByRole('option', { name: 'Current conversations', exact: true }).click();
  await expect(history.getByRole('button', { name: /Native conversation/ })).toBeVisible();
  const listRequests = app.calls.filter(call => call.method === 'GET' && call.path === '/threads');
  expect(listRequests.every(call => !call.search.includes('archived=all'))).toBe(true);
  expect(listRequests.filter(call => call.search.includes('backend=legacy')).every(call => !/[?&](before|after)=/.test(call.search))).toBe(true);
});

test('a failed saved-thread read never treats an unknown legacy selection as a native writable thread', async ({ page }) => {
  const app = await fixture(page, { legacySelected: true, unreadableThread: true });
  await expect(app.panel.getByRole('alert').filter({ hasText: 'This saved conversation could not be read.' })).toBeVisible();
  await app.composer.fill('Keep this local draft until the conversation is known.');
  await expect(app.panel.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  await app.composer.press('Control+Enter');
  expect(app.calls.filter(call => call.method !== 'GET' && call.path.startsWith('/threads/' + legacyId))).toEqual([]);
  await expect(app.composer).toHaveValue('Keep this local draft until the conversation is known.');
});

test('photos and general files retain exact refs across native queue rejection and accepted queue cleanup', async ({ page }) => {
  const app = await fixture(page, { busy: true });
  await app.attach();
  await expect(app.panel.getByRole('list', { name: 'Images attached to this message', exact: true })).toContainText('Ready');
  await expect(app.panel.getByRole('list', { name: 'Files attached to this message', exact: true })).toContainText('Ready');
  app.controls.failQueue = true;
  await app.composer.fill('Keep both attachment originals.'); await app.composer.press('Shift+Enter');
  await expect(app.panel.locator('.chat-composer-error')).toContainText('Native queue rejected this request');
  await expect(app.composer).toHaveValue('Keep both attachment originals.');
  await expect(app.panel.getByRole('list', { name: 'Images attached to this message', exact: true })).toContainText('Ready');
  await app.composer.press('Shift+Enter');
  await expect.poll(() => app.root.native!.queue.length).toBe(1);
  const attempts = app.calls.filter(call => call.method === 'POST' && call.path.endsWith('/queue'));
  expect(attempts).toHaveLength(2); expect(attempts[1].body).toEqual(attempts[0].body);
  const image = [...app.images.values()][0], file = [...app.jobs.values()].find(job => job.name === 'native-notes.txt')!.attachment!;
  expect(attempts[1].body!.attachments).toEqual([{ id: image.id, sha256: digest(png) }]);
  expect(attempts[1].body!.fileAttachments).toEqual([{ id: file.id, sha256: file.sha256 }]);
  expect(app.jobs.size).toBe(2);
  await expect(app.panel.getByRole('list', { name: 'Images attached to this message', exact: true })).toHaveCount(0);
  await expect(app.panel.getByRole('region', { name: 'Conversation messages', exact: true })).not.toContainText('Keep both attachment originals.');
});

test('native queue pages use opaque cursors and only an explicit start calls queue start', async ({ page }) => {
  const app = await fixture(page, { busy: true });
  const first: CodexQueueEntry = { id: randomUUID(), clientUserMessageId: randomUUID(), prompt: 'First native queued message.', attachmentNames: [] };
  const next: CodexQueueEntry = { id: randomUUID(), clientUserMessageId: randomUUID(), prompt: 'Second native queued message.', attachmentNames: ['second.txt'] };
  const cursor = 'opaque/native+queue==';
  app.root.native!.queue = [first]; app.root.native!.queueCursor = cursor;
  app.pages.set(cursor, { items: [next], nextCursor: null }); await app.emit();
  const pending = app.panel.getByRole('region', { name: 'Pending messages', exact: true });
  await pending.getByRole('button', { name: 'Next queued messages', exact: true }).click();
  await expect(pending).toContainText(next.prompt);
  await expect(pending).not.toContainText(first.prompt);
  const request = app.calls.find(call => call.method === 'GET' && call.path.endsWith('/queue'))!;
  expect(new URLSearchParams(request.search).get('cursor')).toBe(cursor);
  await pending.getByRole('button', { name: 'Previous queued messages', exact: true }).click();
  await expect(pending).toContainText(first.prompt);
  app.root.status = 'idle'; app.root.native!.activeTurnId = null; app.root.native!.queueCursor = null; await app.emit();
  await expect(pending.getByRole('button', { name: /^Start queued turn/ })).toBeEnabled();
  expect(app.calls.filter(call => call.path.endsWith('/resume'))).toEqual([]);
  await pending.getByRole('button', { name: /^Start queued turn/ }).click();
  await expect.poll(() => app.calls.filter(call => call.path.endsWith('/resume')).length).toBe(1);
  expect(app.calls.find(call => call.path.endsWith('/resume'))!.path).toBe('/threads/' + rootId + '/queue/' + first.id + '/resume');
});

test('a late native queue acknowledgment cannot erase another conversation draft or replay itself', async ({ page }) => {
  const app = await fixture(page, { busy: true }), held = app.holdQueue();
  try {
    await app.composer.fill('The original native thread owns this request.'); await app.composer.press('Shift+Enter');
    await expect.poll(() => held.entered).toBe(true);
    await app.panel.getByRole('button', { name: 'Conversation history', exact: true }).click();
    await page.getByRole('dialog', { name: 'Conversations', exact: true }).getByRole('button', { name: /Other native conversation/ }).click();
    await expect(app.panel.locator('.chat-header-context')).toContainText('Other native conversation');
    await app.composer.fill('Keep the newly selected conversation draft.');
    held.release();
    await expect(app.composer).toHaveValue('Keep the newly selected conversation draft.');
    await expect(app.panel.getByRole('region', { name: 'Conversation messages', exact: true })).not.toContainText('The original native thread owns this request.');
    expect(app.calls.filter(call => call.method === 'POST' && call.path.endsWith('/queue'))).toHaveLength(1);
    expect(app.other.native!.queue).toEqual([]);
  } finally { held.release(); }
});

test('an empty native public page retains its real older cursor without claiming an empty history', async ({ page }) => {
  const app = await fixture(page);
  const cursor = 'opaque/native+history==';
  const earlier = nativeThread();
  earlier.messages = [{ id: 'older-native-item', role: 'user', content: 'An earlier native item.', createdAt: stamp, turnId: secondTurnId }];
  earlier.turns = [{ id: secondTurnId, userMessageId: 'older-native-item', startedAt: stamp, completedAt: stamp, status: 'completed', messageIds: ['older-native-item'] }];
  earlier.nativePage = { nextCursor: null, backwardsCursor: 'opaque-return-to-newer' };
  app.historyPages.set(cursor, earlier);
  app.root.messages = []; app.root.turns = []; app.root.nativePage = { nextCursor: cursor, backwardsCursor: null };
  await page.reload();
  await expect(app.panel.getByRole('heading', { name: 'What are we building?', exact: true })).toHaveCount(0);
  // The empty viewport is already at its older edge. Native paging can finish
  // between observing the button and clicking it, so assert the actual read.
  await expect.poll(() => app.calls.some(call => call.path.endsWith('/history'))).toBe(true);
  await expect(app.panel.getByRole('region', { name: 'Conversation messages', exact: true })).toContainText('An earlier native item.');
  const request = app.calls.find(call => call.path.endsWith('/history'))!;
  expect(new URLSearchParams(request.search).get('before')).toBe(cursor);
  expect(app.root.history).toBeUndefined(); expect(earlier.history).toBeUndefined();
});

test('native phone controls remain reachable with touch targets and reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  const app = await fixture(page);
  await app.composer.fill('Native phone draft.');
  for (const control of [app.panel.getByRole('button', { name: 'New conversation', exact: true }), app.panel.getByRole('combobox', { name: 'Model', exact: true }),
    app.panel.getByRole('combobox', { name: 'Permissions', exact: true }), app.panel.getByRole('button', { name: 'Attach files', exact: true })]) {
    const bounds = await control.boundingBox(); expect(bounds!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(app.panel.getByRole('button', { name: 'Send message', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const surfaces = await app.panel.locator('.chat-header, .chat-composer, .chat-compose-area').evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element); return { shadow: style.boxShadow, backdrop: style.backdropFilter };
  }));
  expect(surfaces.every(value => value.shadow === 'none' && value.backdrop === 'none')).toBe(true);
});


test('response activity follows actual text, preserves streamed response controls, and never replays saved text', async ({ page, context }) => {
  const app = await fixture(page, { busy: true });
  app.root.turns![0].status = 'running';
  delete app.root.turns![0].completedAt;
  const content = 'Saved response.\n\n```text\n' + 'A long code line '.repeat(60) + '\n```';
  app.root.messages.push({ id: 'response-motion-item', role: 'assistant', turnId, createdAt: stamp, content });
  app.root.turns![0].messageIds.push('response-motion-item');
  await app.emit();
  const response = app.panel.getByRole('article', { name: 'Assistant response', exact: true });
  const status = app.panel.locator('.chat-response-activity');
  await expect(response).toContainText('Saved response.');
  await expect(status).toHaveAttribute('data-response-state', 'waiting');
  await expect(status).toHaveText('Working');
  expect(await response.evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
  const code = response.getByRole('button', { name: 'Copy', exact: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const codeIdentity = await code.elementHandle();
  await code.click();
  await expect(response.getByRole('button', { name: 'Copied to clipboard', exact: true })).toBeFocused();
  const codeArea = response.locator('pre');
  const scroll = await codeArea.evaluate(node => { node.scrollLeft = 130; return node.scrollLeft; });
  expect(scroll).toBeGreaterThan(0);
  await response.evaluate(node => {
    const observer = new MutationObserver(() => {
      if (node.textContent?.includes('Actual')) {
        node.setAttribute('data-first-response-chunk', String(node.textContent.includes('Actual incoming words are visible together.')));
        observer.disconnect();
      }
    });
    observer.observe(node, { subtree: true, childList: true, characterData: true });
  });
  app.root.messages.at(-1)!.content += '\n\nActual incoming words are visible together.';
  await app.emit();
  await expect(response).toContainText('Actual incoming words are visible together.');
  await expect(response).toHaveAttribute('data-first-response-chunk', 'true');
  await expect(status).toHaveText('Responding');
  await expect(status).toHaveAttribute('data-response-state', 'receiving');
  expect(await codeIdentity!.evaluate(node => node.isConnected && document.activeElement === node)).toBe(true);
  await expect(response.getByRole('button', { name: 'Copied to clipboard', exact: true })).toBeVisible();
  expect(await codeArea.evaluate(node => node.scrollLeft)).toBe(scroll);
  await expect(status.locator('.arc-activity-pulse')).toHaveCount(1);
  expect(await response.evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.effect instanceof KeyframeEffect && (animation.effect.target as Element)?.matches('.chat-markdown, .chat-markdown *')).length)).toBe(0);
  app.root.messages.at(-1)!.content = app.root.messages.at(-1)!.content.replace('```text\n', '```text\nNew code bytes ');
  await app.emit();
  await expect(codeArea).toContainText('New code bytes');
  await expect(response.getByRole('button', { name: 'Copy', exact: true })).toBeFocused();
  expect(await codeIdentity!.evaluate(node => node.isConnected && document.activeElement === node)).toBe(true);
  expect(await codeArea.evaluate(node => node.scrollLeft)).toBe(scroll);
  app.root.status = 'idle'; app.root.native!.activeTurnId = null; app.root.turns![0].status = 'completed';
  await app.emit();
  await expect(status).toHaveCount(0);
  await expect(response).toContainText('Actual incoming words are visible together.');
});

test('response activity stays singular across thinking, reconnect, approval and reduced motion', async ({ page }) => {
  const app = await fixture(page, { busy: true });
  app.root.turns![0].status = 'running'; delete app.root.turns![0].completedAt;
  await app.emit();
  const pulse = app.panel.locator('.arc-activity-pulse');
  await expect(pulse).toHaveCount(1);
  await expect(pulse).toHaveAttribute('data-active', 'true');
  await expect.poll(() => pulse.evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(3);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(pulse).toHaveAttribute('data-active', 'false');
  expect(await pulse.evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(pulse).toHaveAttribute('data-active', 'true');
  // Headless tabs do not consistently publish a visibility transition when a
  // second tab opens, so supply that platform event explicitly.
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(pulse).toHaveAttribute('data-active', 'false');
  expect(await pulse.evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
  await page.evaluate(() => { Reflect.deleteProperty(document, 'hidden'); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(pulse).toHaveAttribute('data-active', 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await pulse.evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => pulse.evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(3);
  app.root.messages.push({ id: 'public-thinking-motion', role: 'assistant', turnId, createdAt: stamp, content: '',
    reasoningSummary: [{ id: 'public-thinking-summary', summaryIndex: 0, text: 'Checking the provided file.', status: 'streaming' }] });
  app.root.turns![0].messageIds.push('public-thinking-motion');
  await app.emit();
  await expect(app.panel.locator('.chat-response-activity')).toHaveCount(0);
  await expect(app.panel.locator('.chat-activity-group.is-current')).toHaveCount(1);
  await expect(pulse).toHaveCount(1);
  await expect(pulse).toHaveAttribute('data-active', 'true');
  await page.evaluate(() => {
    const sources = (window as unknown as { nativeChatSources: Array<{ readyState: number; onerror?: () => void }> }).nativeChatSources;
    for (const source of sources) if (source.readyState === 1) source.onerror?.();
  });
  await expect(pulse).toHaveAttribute('data-active', 'false');
  await expect(app.panel.getByText('Reconnecting conversation updates…', { exact: true })).toBeVisible();
  await app.emit();
  await expect(pulse).toHaveAttribute('data-active', 'true');
  app.root.status = 'awaiting_input';
  await app.emit();
  await expect(app.panel.locator('.chat-response-activity')).toHaveText('Waiting for your answer');
  await expect(pulse).toHaveCount(1);
  await expect(pulse).toHaveAttribute('data-active', 'false');
  expect(await pulse.evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
});

test('streamed response updates preserve composer selection, IME input and the current read position', async ({ page }) => {
  const app = await fixture(page, { busy: true });
  app.root.turns![0].status = 'running'; delete app.root.turns![0].completedAt;
  app.root.messages.push({ id: 'long-response-motion', role: 'assistant', turnId, createdAt: stamp,
    content: Array.from({ length: 40 }, (_, index) => `Paragraph ${index} stays readable while more text arrives.`).join('\n\n') });
  app.root.turns![0].messageIds.push('long-response-motion');
  await app.emit();
  const transcript = app.panel.getByRole('region', { name: 'Conversation messages', exact: true });
  await expect(transcript).toContainText('Paragraph 39');
  await transcript.evaluate(node => { node.scrollTop = 250; node.dispatchEvent(new Event('scroll')); });
  await expect(app.panel.getByRole('button', { name: /Jump to latest/ })).toBeVisible();
  await expect(app.panel.locator('.arc-activity-pulse')).toHaveAttribute('data-active', 'false');
  await app.composer.fill('draft stays selectable');
  await app.composer.press('ControlOrMeta+A');
  const selection = await app.composer.evaluate(node => [(node as HTMLTextAreaElement).selectionStart, (node as HTMLTextAreaElement).selectionEnd]);
  const scroll = await transcript.evaluate(node => node.scrollTop);
  app.root.messages.at(-1)!.content += '\n\nNewest actual response text.';
  await app.emit();
  await expect(app.composer).toHaveValue('draft stays selectable');
  expect(await app.composer.evaluate(node => [(node as HTMLTextAreaElement).selectionStart, (node as HTMLTextAreaElement).selectionEnd])).toEqual(selection);
  await expect.poll(() => transcript.evaluate(node => node.scrollTop)).toBeCloseTo(scroll, 0);
  const calls = app.calls.filter(call => call.path.endsWith('/steer') || call.path.endsWith('/queue')).length;
  await app.composer.dispatchEvent('compositionstart', { data: '' });
  await app.composer.evaluate(node => {
    const event = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true, cancelable: true });
    node.dispatchEvent(event);
    if (event.defaultPrevented) throw new Error('The composing Enter was intercepted.');
  });
  await page.keyboard.insertText('日本語');
  await app.composer.dispatchEvent('compositionend', { data: '日本語' });
  await expect(app.composer).toHaveValue('日本語');
  expect(app.calls.filter(call => call.path.endsWith('/steer') || call.path.endsWith('/queue')).length).toBe(calls);
  await expect(app.composer).toBeFocused();
});
