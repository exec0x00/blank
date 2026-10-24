import { changeReviewPageFixture } from './change-review-fixture';
import { expect, test, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import type { AppSettings, DownloadJob, FileAttachment, FileAttachmentUploadJob, ImageAttachment, Thread, ThreadListPage, Workspace, WorkspacePage } from '../../shared/types';
import type { CodexCapabilities, CodexModel, CodexQueueEntry, CodexRuntimeStatus, CodexThreadState } from '../../shared/codex-cli';
import { uiStateFixture } from './ui-state-fixture';
import { browserLaunchOptions } from '../browser-launch';

// The actual composer, HF SDK worker, hashing and direct requests run in Chromium.
// Authenticated control responses and CAS/public-bucket responses are fixtures;
// this suite never starts a model or substitutes an assistant answer.
test.use({ serviceWorkers: 'block', launchOptions: { ...browserLaunchOptions(), ignoreDefaultArgs: ['--disable-popup-blocking'] } });
const fixtureFailures = new WeakMap<Page, string[]>();
test.afterEach(async ({ page }) => {
  expect(fixtureFailures.get(page) ?? [], 'Unexpected API requests or uncaught browser errors').toEqual([]);
});
const cas = 'https://cas-server.xethub.hf.co';
const temporaryCapability = 'temporary-chat-upload-browser-fixture';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN4bm4DAANjAVvvpjgdAAAAAElFTkSuQmCC', 'base64');
const hash = (content: Buffer) => createHash('sha256').update(content).digest('hex');
const capabilities: CodexCapabilities = { conversations: true, pagination: true, queue: true, goals: true, skills: true, plan: true, review: true, historyRevert: true };
const nativeModel: CodexModel = { id: 'attachment-native-catalog-entry', model: 'gpt-5.6-sol', displayName: 'Sol', description: 'Controlled native catalog row for attachment UI tests.',
  hidden: false, isDefault: true, inputModalities: ['text', 'image'], defaultReasoningEffort: 'high',
  supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'High' }] };
function nativeState(): CodexThreadState {
  return { model: nativeModel.model, reasoningEffort: 'high', activeTurnId: null, approvals: [], questions: [], queue: [], queueCursor: null,
    goal: null, tokenUsage: null, diff: null, capabilities: { ...capabilities } };
}

async function fixture(page: Page, options: { holdImport?: boolean; holdCapability?: boolean; blockCas?: boolean; blockDownloadFetch?: boolean } = {}) {
  const failures: string[] = [];
  fixtureFailures.set(page, failures);
  page.on('pageerror', error => failures.push(`Browser error: ${error.message}`));
  const workspace: Workspace = { id: 'chat-file-workspace', name: 'Attachment project', path: '/data/workspaces/attachments', createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z' };
  const settings: AppSettings = { model: nativeModel.model, reasoningEffort: 'high', autoApprove: false, theme: 'dark', fontSize: 13, wordWrap: false, provider: 'openai', apiKeyConfigured: false, agentConfigured: true };
  const runtime: CodexRuntimeStatus = { backend: 'codex-cli', state: 'ready', version: '0.155.1', installedVersion: '0.155.1', startedAt: workspace.createdAt,
    updatedAt: workspace.updatedAt, canUpdate: true, updateBlockedReason: null, error: null, activeTurns: 0, capabilities: { ...capabilities } };
  const threads: Thread[] = ['First conversation', 'Second conversation'].map((title, index) => ({ id: `thread-${index + 1}`, workspaceId: workspace.id, title,
    backend: 'codex-cli', readOnly: false, native: nativeState(), nativePage: { nextCursor: null, backwardsCursor: null },
    status: 'idle', messages: [], turns: [], createdAt: workspace.createdAt, updatedAt: workspace.updatedAt }));
  const jobs = new Map<string, FileAttachmentUploadJob>(), attachments = new Map<string, FileAttachment>(), images = new Map<string, ImageAttachment>();
  const contents = new Map<string, Buffer>(), downloads = new Map<string, DownloadJob>();
  const calls: Array<{ path: string; method: string; body: unknown }> = [], runs: Record<string, unknown>[] = [];
  const direct: Array<{ method: string; path: string; size: number; temporary: boolean; cookie?: string }> = [];
  const controls = { holdImport: !!options.holdImport, holdCapability: !!options.holdCapability, capabilityWaiting: 0, capabilityWaiters: [] as Array<() => void> };
  const uiState = uiStateFixture();
  let authenticated = true;

  await page.addInitScript(({ blockFetch }) => {
    localStorage.setItem('codex.view', 'agent'); localStorage.setItem('codex.split', 'focus');
    class FixtureEventSource extends EventTarget {
      static CONNECTING = 0; static OPEN = 1; static CLOSED = 2;
      CONNECTING = 0; OPEN = 1; CLOSED = 2; readyState = 0; withCredentials = true;
      onopen: ((event: Event) => void) | null = null; onmessage: ((event: MessageEvent) => void) | null = null; onerror: ((event: Event) => void) | null = null;
      constructor(readonly url: string) { super(); sources.push(this); setTimeout(() => { if (this.readyState !== 2) { this.readyState = 1; this.onopen?.(new Event('open')); } }, 0); }
      close() { this.readyState = 2; }
    }
    const sources: FixtureEventSource[] = [];
    Object.assign(window, { EventSource: FixtureEventSource, __chatFileFixture: {
      snapshot(thread: unknown, id: string) { for (const source of sources) if (source.readyState !== 2 && source.url.includes(`/threads/${id}/events`)) source.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ type: 'snapshot', threadId: id, thread }), lastEventId: crypto.randomUUID() })); },
    } });
    if (blockFetch) {
      const native = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        return url.startsWith('https://huggingface.co/buckets/') ? Promise.reject(new TypeError('Browser blocked public-bucket fetch.')) : native(input, init);
      };
    }
  }, { blockFetch: !!options.blockDownloadFetch });
  const emit = (thread: Thread) => page.evaluate(value => {
    (window as unknown as { __chatFileFixture: { snapshot: (thread: Thread, id: string) => void } }).__chatFileFixture.snapshot(value, value.id);
  }, thread);
  const ready = (job: FileAttachmentUploadJob) => {
    const attachment: FileAttachment = { id: `file_${job.id.replaceAll('-', '')}`, workspaceId: job.workspaceId, name: job.name, mimeType: job.mimeType, bytes: job.size, sha256: hash(contents.get(job.name)!), createdAt: job.createdAt };
    Object.assign(job, { state: 'ready', bytesProcessed: job.size, attachment }); attachments.set(attachment.id, attachment); return job;
  };
  await page.context().route('https://**/*', route => { failures.push('Unexpected external request outside the controlled attachment transports.'); return route.abort(); });
  await page.context().route(`${cas}/**`, async route => {
    const request = route.request(), url = new URL(request.url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,x-xet-session-id,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    direct.push({ method: request.method(), path: url.pathname, size: request.postDataBuffer()?.byteLength || 0, temporary: request.headers().authorization === `Bearer ${temporaryCapability}`, cookie: request.headers().cookie });
    if (options.blockCas) return route.abort('failed');
    return route.fulfill({ status: request.method() === 'GET' ? 404 : 200, headers: cors, body: '' });
  });
  await page.context().route('https://huggingface.co/buckets/alvin3y12/codex-downloads/resolve/**', route => route.fulfill({
    status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="attached-file.txt"' }, body: Buffer.from('Public download fixture'),
  }));
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.slice(4), method = request.method();
    const raw = request.postDataBuffer();
    const body = raw ? request.headers()['content-type'] === 'application/octet-stream' ? raw : request.postDataJSON() as Record<string, unknown> : undefined;
    calls.push({ path, method, body });
    const respond = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/session') { if (method === 'DELETE') authenticated = false; if (method === 'POST') authenticated = true; return respond({ authenticated }); }
    if (!authenticated) return respond({ error: 'Workspace locked.', code: 'AUTH_REQUIRED' }, 401);
    if (await uiState.handle(route)) return;
    if (path === '/bootstrap') return respond({ uiState: uiState.read(), workspaces: [workspace], activeWorkspaceId: workspace.id, settings, githubAccounts: [], storage: { path: '/data', persistent: true, bucket: 'alvin3y12/data', writable: true } });
    if (path === '/workspaces' && method === 'GET') return respond({ workspaces: [workspace], offset: 0, total: 1, revision: 'attachment-workspaces', nextCursor: null, previousCursor: null } satisfies WorkspacePage);
    if (path === `/workspaces/${workspace.id}` && method === 'GET') return respond(workspace);
    if (path === '/settings') return respond(settings);
    if (path === `/workspaces/${workspace.id}/rewind-recovery` && method === 'GET') return respond({ workspaceId: workspace.id, recovery: null });
    if (path === '/codex/runtime') return respond(runtime);
    if (path === '/models') return respond({ backend: 'codex-cli', connected: true, models: [nativeModel.model], catalog: [nativeModel] });
    if (path.endsWith('/codex/skills')) return respond({ skills: [], errors: [] });
    if (path === '/skills') return respond({ skills: [], issues: [] });
    if (path === '/threads') {
      if (method === 'POST') { const thread: Thread = { ...threads[0], id: randomUUID(), title: 'New conversation', messages: [], turns: [], native: nativeState() }; threads.push(thread); return respond(thread, 201); }
      expect(url.searchParams.get('backend')).toBe('codex-cli');
      const items = threads.map(({ messages: _messages, native: _native, ...summary }) => summary);
      return respond({ items, olderCursor: null, newerCursor: null, hasOlder: false, hasNewer: false,
        selected: items.find(thread => thread.id === url.searchParams.get('selectedId')) } satisfies ThreadListPage);
    }
    if (path === `/workspaces/${workspace.id}/file-attachments/uploads`) {
      const input = body as { name: string; size: number; mimeType: string }, id = randomUUID(), now = new Date().toISOString();
      const job: FileAttachmentUploadJob = { id, workspaceId: workspace.id, ...input, state: 'reserved', bytesProcessed: 0, bucket: 'alvin3y12/codex-downloads', objectPath: `imports/${id}/staged-file`, createdAt: now, updatedAt: now, sessionExpiresAt: new Date(Date.now() + 1_800_000).toISOString() };
      jobs.set(id, job); return respond(job, 201);
    }
    const upload = /^\/file-attachment-uploads\/([^/]+)(\/capability|\/complete)?$/.exec(path);
    if (upload) {
      const job = jobs.get(upload[1]); if (!job) return respond({ error: 'Upload not found.' }, 404);
      if (upload[2] === '/capability') {
        if (controls.holdCapability) { controls.capabilityWaiting++; await new Promise<void>(resolve => controls.capabilityWaiters.push(resolve)); }
        return respond({ accessToken: temporaryCapability, casUrl: cas, exp: Math.floor(Date.now() / 1000) + 900 }).catch(() => undefined);
      }
      if (upload[2] === '/complete') {
        const proof = body as { sha256: string; xetHash: string };
        expect(proof.sha256).toBe(hash(contents.get(job.name)!)); expect(proof.xetHash).toMatch(/^[a-f0-9]{64}$/);
        if (controls.holdImport) Object.assign(job, { state: 'importing', bytesProcessed: Math.floor(job.size / 2) }); else ready(job);
        return respond(job, 202);
      }
      if (method === 'DELETE' && job.state !== 'ready') job.state = 'cancelled';
      return respond(job);
    }
    const file = /^\/workspaces\/[^/]+\/file-attachments\/([^/]+)(\/inspect|\/downloads)?$/.exec(path);
    if (file) {
      const attachment = attachments.get(file[1]); if (!attachment) return respond({ error: 'Attachment not found.' }, 404);
      if (file[2] === '/inspect') {
        expect(url.searchParams.get('sha256')).toBe(attachment.sha256);
        const content = contents.get(attachment.name)!;
        return respond({ attachment, format: 'utf8', offset: 0, bytesRead: content.byteLength, totalBytes: content.byteLength, truncated: false, content: content.toString('utf8') });
      }
      if (file[2] === '/downloads') {
        expect(body).toEqual({ sha256: attachment.sha256 });
        const id = randomUUID(), now = new Date().toISOString();
        const job: DownloadJob = { id, workspaceId: attachment.workspaceId, fileName: attachment.name, path: attachment.name, size: attachment.bytes, mimeType: 'application/octet-stream', state: 'ready', bytesProcessed: attachment.bytes,
          createdAt: now, updatedAt: now, version: attachment.sha256, source: { type: 'attachment', id: attachment.id, sha256: attachment.sha256 }, expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          url: `https://huggingface.co/buckets/alvin3y12/codex-downloads/resolve/exports/${id}/${encodeURIComponent(attachment.name)}?download=true` };
        downloads.set(id, job); return respond(job, 202);
      }
      if (method === 'DELETE') { attachments.delete(attachment.id); return respond({ deleted: true }); }
    }
    if (/^\/downloads\//.test(path)) return respond(downloads.get(path.split('/')[2]));
    if (path === '/downloads/status') return respond({ enabled: true, ready: true, state: 'ready', unknownTimestampCount: 0 });
    if (path === `/workspaces/${workspace.id}/attachments/from-upload` && method === 'POST') {
      expect(request.headers()['content-type']).toBe('application/json');
      const promotion = body as { uploadId: string; sha256: string; detail: string }, job = jobs.get(promotion.uploadId)!;
      expect(Object.keys(promotion).sort()).toEqual(['detail', 'sha256', 'uploadId']);
      expect(job).toMatchObject({ workspaceId: workspace.id, state: 'ready' });
      expect(promotion.sha256).toBe(hash(png)); expect(job.attachment?.sha256).toBe(hash(png));
      const id = `att_${hash(Buffer.from(JSON.stringify([workspace.id, job.id, promotion.sha256, promotion.detail]))).slice(0, 32)}`, name = job.name;
      const attachment: ImageAttachment = { id, workspaceId: workspace.id, name, mimeType: 'image/png', bytes: png.length, width: 1, height: 1, sha256: hash(png), createdAt: job.createdAt, detail: 'high', previewUrl: `/api/workspaces/${workspace.id}/attachments/${id}/content?sha256=${hash(png)}` };
      images.set(id, attachment); return respond(attachment);
    }
    if (path.includes('/attachments/') && path.endsWith('/content')) return route.fulfill({ status: 200, contentType: 'image/png', body: png });
    const threadMatch = /^\/threads\/([^/]+)(?:\/(\w+))?$/.exec(path);
    if (threadMatch) {
      const thread = threads.find(value => value.id === threadMatch[1]); if (!thread) return respond({ error: 'Thread not found.' }, 404);
      if (threadMatch[2] === 'agents') return respond([]);
      if (threadMatch[2] === 'queue') {
        if (method === 'GET') return respond({ items: thread.native!.queue, nextCursor: null });
        const input = body as { prompt: string; clientUserMessageId: string; fileAttachments?: Array<{ id: string; sha256: string }>; attachments?: Array<{ id: string; sha256: string }> };
        const pending: CodexQueueEntry = { id: randomUUID(), clientUserMessageId: input.clientUserMessageId, prompt: input.prompt,
          attachmentNames: [...(input.fileAttachments?.map(ref => attachments.get(ref.id)!.name) ?? []), ...(input.attachments?.map(ref => images.get(ref.id)!.name) ?? [])] };
        thread.native!.queue.push(pending);
        await respond({ threadId: thread.id, queuedSubmission: pending }, 202); await emit(thread); return;
      }
      if (threadMatch[2] === 'run' || threadMatch[2] === 'input') {
        const input = body as { prompt: string; clientUserMessageId: string; expectedTurnId?: string; fileAttachments?: Array<{ id: string; sha256: string }>; attachments?: Array<{ id: string; sha256: string }> };
        expect(input.clientUserMessageId).toMatch(/^[a-f0-9-]{36}$/);
        const turnId = threadMatch[2] === 'input' ? thread.native!.activeTurnId! : randomUUID();
        if (threadMatch[2] === 'input') expect(input.expectedTurnId).toBe(turnId);
        runs.push({ threadId: thread.id, ...input });
        // This is a native-shaped acceptance/snapshot fixture, not a CLI run or
        // a fabricated assistant response. Keep the real submitted user refs.
        thread.messages.push({ id: input.clientUserMessageId, role: 'user', content: input.prompt, turnId, createdAt: new Date().toISOString(),
          fileAttachments: input.fileAttachments?.map(ref => attachments.get(ref.id)!), attachments: input.attachments?.map(ref => images.get(ref.id)!) });
        thread.status = 'running'; thread.native!.activeTurnId = turnId;
        await respond({ threadId: thread.id, turnId }, 202); await emit(thread); return;
      }
      return respond(thread);
    }
    if (path.endsWith('/git/status')) return respond({ isRepository: false, branch: '', ahead: 0, behind: 0, files: [], branches: [] });
    if (path === '/changes') return respond(changeReviewPageFixture(url));
    if (['/github/accounts'].includes(path) || /\/(tree|file-paths|terminals|workflows|trash)$/.test(path)) return respond([]);
    failures.push(`${method} ${path}`);
    return respond({ error: `Unexpected fixture request ${method} ${path}` }, 404);
  });
  await page.goto('/work');
  const panel = page.getByRole('region', { name: 'Codex conversation', exact: true });
  await expect(panel).toBeVisible(); await expect(panel.getByRole('button', { name: 'Attach files', exact: true })).toBeEnabled();
  const choose = async (files: Array<{ name: string; content: Buffer; mimeType?: string }>) => {
    for (const file of files) contents.set(file.name, file.content);
    await panel.getByLabel('Choose file attachments', { exact: true }).setInputFiles(files.map(file => ({ name: file.name, buffer: file.content, mimeType: file.mimeType || 'text/plain' })));
  };
  const switchThread = async (title: string) => {
    await panel.locator('button:is([title="Conversation history"], [data-tooltip-title="Conversation history"])').click();
    await page.getByRole('dialog', { name: 'Conversations', exact: true }).locator('.chat-history-select').filter({ hasText: title }).click();
    await expect(panel.locator('button:is([title="Conversation history"], [data-tooltip-title="Conversation history"])')).toContainText(title);
    await expect(panel.getByRole('button', { name: 'Attach files', exact: true })).toBeEnabled();
  };
  return { panel, choose, switchThread, calls, jobs, runs, direct, contents, attachments, downloads, controls,
    finishImports() { controls.holdImport = false; for (const job of jobs.values()) if (job.state === 'importing') ready(job); },
    releaseCapabilities() { controls.holdCapability = false; for (const resolve of controls.capabilityWaiters.splice(0)) resolve(); },
  };
}

test('mixed files and photos retain previews and only committed refs enter a real composer request', async ({ page }) => {
  const app = await fixture(page, { holdImport: true });
  const composer = app.panel.getByRole('textbox', { name: 'Message Codex' });
  await composer.fill('Inspect both attachments.');
  const text = Buffer.from('Actual UTF-8 file contents: café 你好\n<script>window.untrusted = true</script>');
  await app.choose([{ name: 'notes café.txt', content: text }, { name: 'reference.png', content: png, mimeType: 'image/png' }]);
  const card = app.panel.getByRole('listitem', { name: 'Attachment notes café.txt', exact: true });
  const verifying = card.getByRole('progressbar', { name: 'Verifying file: notes café.txt', exact: true });
  const importedBytes = Math.floor(text.byteLength / 2);
  await expect(verifying).toBeVisible();
  await expect(verifying).toHaveAttribute('aria-valuenow', String(Math.floor(importedBytes / text.byteLength * 100)));
  await expect(verifying).toHaveAttribute('aria-valuetext', `${importedBytes} B of ${text.byteLength} B`);
  await expect(card.getByText('Ready', { exact: true })).toHaveCount(0);
  await expect(app.panel.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  await composer.press('Control+Enter');
  await expect(composer).toHaveValue('Inspect both attachments.');
  expect(app.runs).toHaveLength(0);
  await expect(app.panel.getByRole('button', { name: 'Preview reference.png', exact: true })).toBeVisible();
  expect(app.direct.some(value => value.method === 'POST' && value.size > 0)).toBe(true);
  expect(app.direct.every(value => value.temporary && !value.cookie)).toBe(true);
  app.finishImports(); await expect(card.getByText('Ready', { exact: true })).toBeVisible();
  await expect(verifying).toHaveCount(0);
  await expect(app.panel.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  await composer.press('Control+Enter');
  await expect.poll(() => app.runs.length).toBe(1);
  expect(app.runs[0]).toMatchObject({ prompt: 'Inspect both attachments.', fileAttachments: [{ id: expect.stringMatching(/^file_/), sha256: hash(text) }], attachments: [{ id: expect.stringMatching(/^att_/), sha256: hash(png) }] });
  expect(JSON.stringify(app.runs)).not.toContain('Actual UTF-8');
  await expect(app.panel.getByRole('list', { name: 'Files attached to this message', exact: true })).toHaveCount(0);
  await expect(app.panel.getByRole('button', { name: 'Inspect attached file notes café.txt', exact: true })).toBeVisible();
  await app.panel.getByRole('button', { name: 'Inspect attached file notes café.txt', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'notes café.txt', exact: true });
  await expect(dialog.getByLabel('Attached file text', { exact: true })).toHaveText(text.toString());
  expect(await page.evaluate(() => (window as unknown as { untrusted?: boolean }).untrusted)).toBeUndefined();
  await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Inspect attached file notes café.txt', exact: true })).toBeVisible();
});

test('changing conversations pauses the original file and rejects a late picker result for another draft', async ({ page }) => {
  const app = await fixture(page, { holdCapability: true });
  try {
    await app.choose([{ name: 'original.txt', content: Buffer.from('Retain this unsent file.') }]);
    await expect.poll(() => app.controls.capabilityWaiting).toBe(1);
    await app.switchThread('Second conversation');
    await expect(app.panel.getByRole('list', { name: 'Files attached to this message', exact: true })).toHaveCount(0);
    app.releaseCapabilities();
    await expect.poll(() => [...app.jobs.values()][0]?.state).toBe('cancelled');
    await app.switchThread('First conversation');
    await expect(app.panel.getByText('Paused', { exact: true })).toBeVisible();
    await app.panel.getByRole('button', { name: 'Retry upload of original.txt', exact: true }).click();
    await expect(app.panel.getByRole('listitem', { name: 'Attachment original.txt', exact: true }).getByText('Ready', { exact: true })).toBeVisible();
    const pending = page.waitForEvent('filechooser'); await app.panel.getByRole('button', { name: 'Attach files', exact: true }).click(); const chooser = await pending;
    await app.switchThread('Second conversation');
    await chooser.setFiles({ name: 'wrong-thread.txt', mimeType: 'text/plain', buffer: Buffer.from('Do not attach here.') });
    await expect(app.panel.getByRole('list', { name: 'Files attached to this message', exact: true })).toHaveCount(0);
    expect(app.calls.filter(call => call.path.endsWith('/file-attachments/uploads')).map(call => (call.body as { name: string }).name)).toEqual(['original.txt', 'original.txt']);
  } finally { app.releaseCapabilities(); }
});

test('lock aborts upload activity while preserving the text draft and paused file for an explicit retry', async ({ page }) => {
  const app = await fixture(page, { holdCapability: true });
  try {
    const prompt = app.panel.getByRole('textbox', { name: 'Message Codex' }); await prompt.fill('Retain this draft through lock.');
    await app.choose([{ name: 'locked.txt', content: Buffer.from('The local file is still available.') }]);
    await expect.poll(() => app.controls.capabilityWaiting).toBe(1);
    await page.evaluate(() => { document.body.dataset.workspaceLocked = 'true'; window.dispatchEvent(new Event('codex:session-locked')); });
    await expect(app.panel.getByRole('list', { name: 'Files attached to this message', exact: true })).toHaveCount(0);
    app.releaseCapabilities();
    await page.evaluate(() => { document.body.dataset.workspaceLocked = 'false'; window.dispatchEvent(new Event('codex:session-unlocked')); });
    await expect(prompt).toHaveValue('Retain this draft through lock.');
    await expect(app.panel.getByText('Paused', { exact: true })).toBeVisible();
    await expect(app.panel.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
    await app.panel.getByRole('button', { name: 'Retry upload of locked.txt', exact: true }).click();
    await expect(app.panel.getByRole('listitem', { name: 'Attachment locked.txt', exact: true }).getByText('Ready', { exact: true })).toBeVisible();
    expect(app.runs).toEqual([]);
  } finally { app.releaseCapabilities(); }
});

test('direct upload failures remain visible, block Send, and never proxy or finalize file bytes', async ({ page }) => {
  const app = await fixture(page, { blockCas: true });
  const composer = app.panel.getByRole('textbox', { name: 'Message Codex' });
  await composer.fill('Keep this attached-file prompt.');
  await app.choose([{ name: 'blocked.txt', content: Buffer.from('No app server file-body upload.') }]);
  const card = app.panel.getByRole('listitem', { name: 'Attachment blocked.txt', exact: true });
  await expect(card.getByRole('alert')).toContainText('browser could not reach Hugging Face');
  await expect(app.panel.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  await composer.press('Control+Enter');
  await expect(composer).toHaveValue('Keep this attached-file prompt.');
  expect(app.runs).toHaveLength(0);
  expect(app.calls.some(call => call.path.endsWith('/complete'))).toBe(false);
  expect(app.calls.some(call => Buffer.isBuffer(call.body))).toBe(false);
  await card.getByRole('button', { name: 'Remove blocked.txt', exact: true }).click();
  await expect(card).toHaveCount(0);
});

test('mixed paste keeps normal text insertion available and composer drops attach individual files', async ({ page }) => {
  const app = await fixture(page);
  const prompt = app.panel.getByRole('textbox', { name: 'Message Codex' }); await prompt.fill('Keep my typed draft.');
  const pasted = 'Pasted file contents.'; app.contents.set('pasted.txt', Buffer.from(pasted));
  const prevented = await prompt.evaluate((textarea, content) => {
    const data = new DataTransfer(); data.setData('text/plain', 'ordinary clipboard text'); data.items.add(new File([content], 'pasted.txt', { type: 'text/plain' }));
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }); textarea.dispatchEvent(event); return event.defaultPrevented;
  }, pasted);
  expect(prevented).toBe(false);
  await expect(prompt).toHaveValue('Keep my typed draft.');
  await expect(app.panel.getByRole('listitem', { name: 'Attachment pasted.txt', exact: true }).getByText('Ready', { exact: true })).toBeVisible();
  const dropped = 'Dropped file contents.'; app.contents.set('dropped.txt', Buffer.from(dropped));
  const dropPrevented = await app.panel.locator('form.chat-composer').evaluate((form, content) => {
    const data = new DataTransfer(); data.items.add(new File([content], 'dropped.txt', { type: 'text/plain' }));
    const enter = new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: data }); form.dispatchEvent(enter);
    const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }); form.dispatchEvent(event); return event.defaultPrevented;
  }, dropped);
  expect(dropPrevented).toBe(true);
  await expect(app.panel.getByRole('listitem', { name: 'Attachment dropped.txt', exact: true }).getByText('Ready', { exact: true })).toBeVisible();
  await expect(prompt).toHaveValue('Keep my typed draft.');
  expect(app.runs).toEqual([]);
});

test('phone file cards use public download fallback without claiming the browser saved the file', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const app = await fixture(page, { blockDownloadFetch: true });
  await app.choose([{ name: 'phone report.txt', content: Buffer.from('Public download fixture') }]);
  await expect(app.panel.getByRole('listitem', { name: 'Attachment phone report.txt', exact: true }).getByText('Ready', { exact: true })).toBeVisible();
  await app.panel.getByRole('button', { name: 'Send message', exact: true }).click();
  await app.panel.getByRole('button', { name: 'Download file phone report.txt', exact: true }).click();
  const tray = page.getByRole('complementary', { name: 'File downloads' });
  await expect(tray).toContainText('Download requested');
  const link = tray.getByRole('link', { name: 'Download file', exact: true });
  await expect(link).toHaveAttribute('href', /^https:\/\/huggingface.co\/buckets\/alvin3y12\/codex-downloads\/resolve\/exports\//);
  await expect(tray).not.toContainText('Saved to your selected file');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const size = await app.panel.getByRole('button', { name: 'Download file phone report.txt', exact: true }).boundingBox();
  expect(size!.width).toBeGreaterThanOrEqual(44); expect(size!.height).toBeGreaterThanOrEqual(44);
  for (const job of app.downloads.values()) Object.assign(job, { state: 'expired', url: undefined });
  await page.reload();
  await page.getByRole('complementary', { name: 'File downloads' }).getByRole('button', { name: 'Prepare again', exact: true }).click();
  await expect.poll(() => app.calls.filter(call => /\/file-attachments\/[^/]+\/downloads$/.test(call.path)).length).toBe(2);
  expect(app.calls.some(call => call.path === '/workspaces/chat-file-workspace/downloads')).toBe(false);
});
