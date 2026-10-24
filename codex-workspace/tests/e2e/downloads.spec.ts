import { blockUnmatchedTransferNetwork, nativeTransferMetadata } from './native-transfer-fixture';
import { changeReviewPageFixture } from './change-review-fixture';
import { expect, test, type Page } from '@playwright/test';
import { uiStateFixture } from './ui-state-fixture';
import { directoryPageFixture } from './directory-page-fixture';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { AppSettings, DownloadJob, Workspace } from '../../shared/types';
import { browserLaunchOptions } from '../browser-launch';

// Keep browser CORS, local-network restrictions and popup blocking enabled.
test.use({ launchOptions: { ...browserLaunchOptions(), ignoreDefaultArgs: ['--disable-popup-blocking'] } });
test.beforeEach(({ context, baseURL }) => blockUnmatchedTransferNetwork(context, baseURL));

// The authenticated application/editor run normally. Only the server download
// jobs and external bucket boundary are fixtures; real bucket CORS is also
// verified by the deployment round-trip check, never assumed by these tests.
const originalName = 'report café 你好.txt';
const originalBytes = Buffer.from('\uFEFFSaved file\r\nUnicode café 你好\r\n', 'utf8');
const memoryLimit = 32 * 1024 * 1024;

type FixtureSource = { url: string; readyState: number; onerror: ((event: Event) => void) | null; dispatchEvent: (event: Event) => boolean; close: () => void };
type BrowserFixture = {
  sources: FixtureSource[];
  bucketFetches: Array<{ url: string; credentials?: RequestCredentials }>;
  stream?: { pickerAt: number; pickerName: string; createAt: number; writes: number; bytes: number; closed: boolean; aborted: boolean };
};
declare global { interface Window { __downloadBrowserFixture: BrowserFixture } }

async function fixture(page: Page, options: { size?: number; nativeStream?: boolean; noPicker?: boolean; slowStream?: boolean; blockBucketFetch?: boolean } = {}) {
  const workspace: Workspace = { id: 'download-workspace', name: 'Download project', path: '/data/workspaces/download-project', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
  const settings: AppSettings = { model: 'gpt-5.6-cyber', reasoningEffort: 'high', autoApprove: false, theme: 'dark', fontSize: 13, wordWrap: false, provider: 'openai', apiKeyConfigured: false, agentConfigured: true };
  const jobs = new Map<string, DownloadJob>();
  const posts: Array<{ path: string; expectedVersion?: string }> = [];
  const cancelled: string[] = [];
  const requests: string[] = [];
  const bucketRequests: Array<{ url: string; authorization?: string; cookie?: string }> = [];
  let authenticated = true;
  let updateSequence = 0;
  let rejectNext: { message: string; code: string; status: number } | undefined;
  let releasePost: (() => void) | undefined;
  let holdPost = false;
  const size = options.size ?? originalBytes.byteLength;

  await page.addInitScript(({ nativeStream, noPicker, size, slowStream, blockBucketFetch }) => {
    localStorage.setItem('codex.view', 'editor');
    localStorage.setItem('codex.split', 'focus');
    localStorage.setItem('codex.sidebar', 'collapsed');
    const state: BrowserFixture = { sources: [], bucketFetches: [] };
    window.__downloadBrowserFixture = state;
    const NativeSource = window.EventSource;
    class DownloadEventSource extends EventTarget {
      static CONNECTING = 0; static OPEN = 1; static CLOSED = 2;
      CONNECTING = 0; OPEN = 1; CLOSED = 2;
      url: string; readyState = 0; withCredentials = true;
      onopen: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      constructor(url: string | URL) {
        super(); this.url = String(url); state.sources.push(this);
        setTimeout(() => { if (this.readyState !== 2) { this.readyState = 1; this.onopen?.(new Event('open')); } }, 0);
      }
      close() { this.readyState = 2; }
    }
    window.EventSource = new Proxy(NativeSource, { construct(target, args) { return String(args[0]).includes('/downloads/') ? new DownloadEventSource(args[0]) : new target(args[0], args[1]); } });
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith('https://huggingface.co/buckets/')) return originalFetch(input, init);
      state.bucketFetches.push({ url, credentials: init?.credentials });
      if (blockBucketFetch) throw new TypeError('Failed to fetch');
      if (!nativeStream) return originalFetch(input, init);
      let sent = 0;
      const body = new ReadableStream<Uint8Array>({ pull(controller) {
        if (init?.signal?.aborted) { controller.error(new DOMException('Aborted', 'AbortError')); return; }
        if (sent >= size) { controller.close(); return; }
        const count = Math.min(64 * 1024, size - sent); sent += count;
        controller.enqueue(new Uint8Array(count).fill(65));
      } });
      return new Response(body, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(size) } });
    };
    if (nativeStream) {
      state.stream = { pickerAt: 0, pickerName: '', createAt: 0, writes: 0, bytes: 0, closed: false, aborted: false };
      Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async (options: { suggestedName: string }) => {
        state.stream!.pickerAt = performance.now(); state.stream!.pickerName = options.suggestedName;
        return { createWritable: async () => {
          state.stream!.createAt = performance.now();
          return { write: async (chunk: Uint8Array) => { state.stream!.writes++; state.stream!.bytes += chunk.byteLength; if (!chunk.every(byte => byte === 65)) throw new Error('Unexpected streamed bytes'); if (slowStream) await new Promise(resolve => setTimeout(resolve, 10)); }, close: async () => { state.stream!.closed = true; }, abort: async () => { state.stream!.aborted = true; } };
        } };
      } });
    } else if (noPicker !== false) Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
  }, { nativeStream: Boolean(options.nativeStream), noPicker: options.noPicker, size, slowStream: Boolean(options.slowStream), blockBucketFetch: Boolean(options.blockBucketFetch) });

  await page.context().route('https://huggingface.co/buckets/alvin3y12/codex-downloads/resolve/**', async route => {
    const headers = route.request().headers();
    bucketRequests.push({ url: route.request().url(), authorization: headers.authorization, cookie: headers.cookie });
    await route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'text/plain; charset=utf-8', 'content-disposition': 'attachment; filename="bucket-encoded-name.txt"' }, body: originalBytes });
  });
  const uiState = uiStateFixture();
  await page.route('**/api/**', async route => {
    const request = route.request(); const url = new URL(request.url());
    const pathname = url.pathname.slice(4); const method = request.method();
    const body = request.postData() ? request.postDataJSON() : undefined;
    requests.push(`${method} ${pathname}`);
    const respond = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (pathname === '/session') { if (method === 'DELETE') authenticated = false; if (method === 'POST') authenticated = true; return respond({ authenticated }); }
    if (!authenticated) return respond({ error: 'Workspace locked.', code: 'AUTH_REQUIRED' }, 401);
    if (await uiState.handle(route)) return;
    if (pathname === '/bootstrap') return respond({ uiState: uiState.read(), workspaces: [workspace], activeWorkspaceId: workspace.id, settings, githubAccounts: [], storage: { path: '/data', persistent: true, bucket: 'alvin3y12/data', writable: true } });
    if (pathname === `/workspaces/${workspace.id}` && method === 'GET') return respond(workspace);
    if (pathname === `/workspaces/${workspace.id}/tree-page`) return respond(directoryPageFixture(url, [{ name: originalName, path: originalName, kind: 'file', size }]));
    if (pathname === `/workspaces/${workspace.id}/tree-entry`) return url.searchParams.get('path') === originalName
      ? respond({ name: originalName, path: originalName, kind: 'file', size }) : respond({ error: 'File not found.', code: 'FILE_NOT_FOUND' }, 404);
    if (pathname === `/workspaces/${workspace.id}/tree`) return respond([{ name: originalName, path: originalName, kind: 'file', size }]);
    if (pathname === `/workspaces/${workspace.id}/file`) return respond({ path: originalName, content: originalBytes.toString('utf8'), size, version: 'saved-version-fixture', language: 'plaintext' });
    if (pathname === `/workspaces/${workspace.id}/downloads` && method === 'POST') {
      posts.push(body);
      if (holdPost) { holdPost = false; await new Promise<void>(resolve => { releasePost = resolve; }); }
      if (rejectNext) { const failure = rejectNext; rejectNext = undefined; return respond({ error: failure.message, code: failure.code }, failure.status); }
      const id = randomUUID(); const now = new Date(Date.now() + updateSequence++).toISOString();
      const job: DownloadJob = { id, workspaceId: workspace.id, path: body.path, fileName: originalName, mimeType: 'text/plain', size, state: 'queued', bytesProcessed: 0, createdAt: now, updatedAt: now, version: body.expectedVersion || 'saved-version-fixture' };
      jobs.set(id, job); return respond(job, 202);
    }
    const jobMatch = /^\/downloads\/([a-f0-9-]+)$/.exec(pathname);
    if (jobMatch) {
      const job = jobs.get(jobMatch[1]); if (!job) return respond({ error: 'Download not found.', code: 'DOWNLOAD_NOT_FOUND' }, 404);
      if (method === 'DELETE') { cancelled.push(job.id); job.state = 'cancelled'; job.updatedAt = new Date(Date.now() + updateSequence++).toISOString(); }
      return respond(job);
    }
    if (pathname === '/downloads/status') return respond({ enabled: true, ready: true, state: 'ready', unknownTimestampCount: 0 });
    if (pathname.endsWith('/git/status')) return respond({ isRepository: false, branch: '', ahead: 0, behind: 0, files: [], branches: [] });
    if (pathname === `/workspaces/${workspace.id}/rewind-recovery` && method === 'GET') return respond({ workspaceId: workspace.id, recovery: null });
    const nativeMetadata = nativeTransferMetadata(pathname, method, settings);
    if (nativeMetadata !== undefined) return respond(nativeMetadata);
    if (pathname === '/settings') return respond(settings);
    if (pathname === '/changes') return respond(changeReviewPageFixture(url));
    if (pathname === '/github/accounts' || /\/(terminals|trash|file-paths|workflows)$/.test(pathname)) return respond([]);
    return respond({ error: `Unexpected fixture request: ${method} ${pathname}` }, 404);
  });
  await page.goto('/work');
  await expect(page.getByRole('region', { name: 'Code editor', exact: true })).toBeVisible();
  const editor = page.getByRole('region', { name: 'Code editor', exact: true });
  await editor.getByRole('treeitem', { name: new RegExp('report café') }).click();
  await expect(editor.locator('.monaco-editor textarea.inputarea').first()).toBeVisible();
  const start = async () => {
    await editor.getByRole('button', { name: 'Editor options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Download saved file', exact: true }).click();
  };
  const latest = () => [...jobs.values()].at(-1)!;
  const update = async (patch: Partial<DownloadJob>, emit = true) => {
    const current = latest();
    const now = new Date(Date.now() + ++updateSequence).toISOString();
    Object.assign(current, patch, { updatedAt: now });
    if (current.state === 'ready') {
      current.url ||= `https://huggingface.co/buckets/alvin3y12/codex-downloads/resolve/exports/${current.id}/${encodeURIComponent(originalName)}?download=true`;
      current.uploadedAt ||= now; current.expiresAt ||= new Date(Date.now() + 86_400_000).toISOString();
    }
    if (emit) await page.evaluate(job => window.__downloadBrowserFixture.sources.filter(source => source.readyState !== 2 && source.url.includes(`/${job.id}/events`)).forEach(source => source.dispatchEvent(new MessageEvent('download', { data: JSON.stringify(job) }))), current);
  };
  const waitForJob = async () => { await expect.poll(() => jobs.size).toBeGreaterThan(0); await expect.poll(() => page.evaluate(() => window.__downloadBrowserFixture.sources.filter(source => source.readyState !== 2).length)).toBeGreaterThan(0); };
  return { workspace, editor, start, latest, update, waitForJob, posts, cancelled, requests, bucketRequests,
    reject(message: string, code = 'DOWNLOADS_UNAVAILABLE', status = 503) { rejectNext = { message, code, status }; },
    holdNextPost() { holdPost = true; }, releasePost() { releasePost?.(); },
  };
}

test('saved-file download shows measured progress, uses bucket bytes, and preserves Unicode filenames', async ({ page }) => {
  const app = await fixture(page);
  const input = app.editor.locator('.monaco-editor textarea.inputarea').first();
  await input.focus(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('Unsaved edit');
  await app.start(); await app.waitForJob();
  const tray = page.getByRole('complementary', { name: 'File downloads' });
  await expect(tray.getByText('Unsaved editor changes are not included.')).toBeVisible();
  expect(app.posts).toEqual([{ path: originalName, expectedVersion: 'saved-version-fixture' }]);
  await app.update({ state: 'snapshotting', bytesProcessed: 10 });
  await expect(tray.getByRole('progressbar', { name: 'Preparing saved file' })).toHaveAttribute('aria-valuenow', String(Math.floor(10 / originalBytes.length * 100)));
  await app.update({ state: 'uploading', bytesProcessed: 5 });
  await expect(tray.getByRole('progressbar', { name: 'Uploading to download bucket' })).toHaveAttribute('aria-valuenow', String(Math.floor(5 / originalBytes.length * 100)));
  const downloaded = page.waitForEvent('download');
  await app.update({ state: 'ready', bytesProcessed: originalBytes.length });
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe(originalName);
  expect(await readFile((await download.path())!)).toEqual(originalBytes);
  await expect(tray.getByText('Download sent to browser', { exact: true })).toBeVisible();
  expect(app.bucketRequests).toHaveLength(1);
  expect(app.bucketRequests[0].authorization).toBeUndefined(); expect(app.bucketRequests[0].cookie).toBeUndefined();
  expect(app.requests.some(request => request.includes('/download?') || request.startsWith('PUT '))).toBe(false);
  expect(await page.evaluate(() => window.__downloadBrowserFixture.bucketFetches[0].credentials)).toBe('omit');
  const cached = await page.evaluate(() => sessionStorage.getItem('codex.download-job-ids'));
  expect(cached).toBe(JSON.stringify([app.latest().id]));
});

test('the first click gives feedback immediately and cancelling a pending request cancels the eventual server job', async ({ page }) => {
  const app = await fixture(page); app.holdNextPost();
  await app.start();
  const tray = page.getByRole('complementary', { name: 'File downloads' });
  await expect(tray.getByText('Preparing download…', { exact: true })).toBeVisible();
  await tray.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(tray.getByText('Cancelling preparation…', { exact: true })).toBeVisible();
  app.releasePost();
  await expect.poll(() => app.cancelled.length).toBe(1);
  await expect(tray.getByText('Download cancelled', { exact: true })).toBeVisible();
  expect(app.bucketRequests).toHaveLength(0);
});

test('a failed bucket preparation can be retried without rewriting the source file', async ({ page }) => {
  const app = await fixture(page); app.reject('The download bucket is checking expired files.', 'DOWNLOAD_CLEANUP_PENDING');
  await app.start();
  const tray = page.getByRole('complementary', { name: 'File downloads' });
  await expect(tray.getByRole('alert')).toContainText('checking expired files');
  await tray.getByRole('button', { name: 'Prepare again' }).click(); await app.waitForJob();
  const downloaded = page.waitForEvent('download'); await app.update({ state: 'ready' });
  expect(await readFile((await (await downloaded).path())!)).toEqual(originalBytes);
  expect(app.posts).toHaveLength(2);
  expect(app.requests.some(request => request.startsWith('PUT '))).toBe(false);
});

test('version conflicts remain visible and do not silently export different bytes', async ({ page }) => {
  const app = await fixture(page); app.reject('The saved file changed.', 'VERSION_CONFLICT', 409);
  await app.start();
  const tray = page.getByRole('complementary', { name: 'File downloads' });
  await expect(tray.getByRole('alert')).toContainText('Reload the file in the editor');
  await expect(tray.getByRole('button', { name: 'Prepare again' })).toHaveCount(0);
  expect(app.bucketRequests).toHaveLength(0);
});

test('locking hides public links, closes the stream, and unlocking recovers a ready job without auto-saving', async ({ page }) => {
  const app = await fixture(page); await app.start(); await app.waitForJob();
  if (!await page.getByRole('button', { name: 'Lock workspace', exact: true }).isVisible()) await page.getByRole('button', { name: 'Expand navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await expect(page.getByLabel('Workspace password', { exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'File downloads' })).toHaveCount(0);
  await expect(page.locator('a[href^="https://huggingface.co/buckets/"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__downloadBrowserFixture.sources.every(source => source.readyState === 2))).toBe(true);
  await app.update({ state: 'ready' });
  await page.getByLabel('Workspace password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const tray = page.getByRole('complementary', { name: 'File downloads' });
  await expect(tray.getByText('Ready to save', { exact: true })).toBeVisible();
  expect(app.bucketRequests).toHaveLength(0);
  const downloaded = page.waitForEvent('download'); await tray.getByRole('button', { name: 'Save file', exact: true }).click();
  expect(await readFile((await (await downloaded).path())!)).toEqual(originalBytes);
});

test('lost event streams reconcile from the authenticated job snapshot', async ({ page }) => {
  const app = await fixture(page); await app.start(); await app.waitForJob();
  await page.evaluate(() => window.__downloadBrowserFixture.sources.forEach(source => { if (source.readyState !== 2) { source.readyState = 0; source.onerror?.(new Event('error')); } }));
  await expect(page.getByText('Reconnecting… Preparation continues on the server.')).toBeVisible();
  const downloaded = page.waitForEvent('download'); await app.update({ state: 'ready' }, false);
  expect(await readFile((await (await downloaded).path())!)).toEqual(originalBytes);
  expect(app.requests.some(request => request === `GET /downloads/${app.latest().id}`)).toBe(true);
});

test('large downloads stream each chunk to a chosen file without creating a large Blob', async ({ page }) => {
  const size = memoryLimit + 128 * 1024;
  const app = await fixture(page, { size, nativeStream: true }); await app.start(); await app.waitForJob();
  expect(await page.evaluate(() => window.__downloadBrowserFixture.stream?.pickerName)).toBe(originalName);
  expect(await page.evaluate(() => window.__downloadBrowserFixture.stream?.createAt)).toBe(0);
  await app.update({ state: 'ready' });
  await expect(page.getByText('File saved', { exact: true })).toBeVisible();
  const stream = await page.evaluate(() => window.__downloadBrowserFixture.stream!);
  expect(stream.bytes).toBe(size); expect(stream.writes).toBe(size / (64 * 1024)); expect(stream.closed).toBe(true); expect(stream.aborted).toBe(false);
  expect(stream.pickerAt).toBeLessThan(stream.createAt);
  expect(app.bucketRequests).toHaveLength(0); // Stream fixture provides bytes at the fetch boundary.
});

test('stopping a streamed save aborts the writable file and keeps a retry available', async ({ page }) => {
  const size = memoryLimit + 128 * 1024;
  const app = await fixture(page, { size, nativeStream: true, slowStream: true }); await app.start(); await app.waitForJob();
  await app.update({ state: 'ready' });
  const tray = page.getByRole('complementary', { name: 'File downloads' });
  await expect(tray.getByText('Saving from Hugging Face', { exact: true })).toBeVisible();
  await tray.getByRole('button', { name: 'Stop saving', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__downloadBrowserFixture.stream?.aborted)).toBe(true);
  const stream = await page.evaluate(() => window.__downloadBrowserFixture.stream!);
  expect(stream.closed).toBe(false); expect(stream.bytes).toBeLessThan(size);
  await expect(tray.getByRole('button', { name: 'Save file', exact: true })).toBeVisible();
  expect(app.cancelled).toHaveLength(0); // The prepared snapshot remains available.
});

test('unsupported large-file saving goes directly to the browser download manager', async ({ page }) => {
  // A small boundary fixture stands in for a large response. The important
  // browser assertion is that no fetch/Blob buffer is created for this branch.
  const app = await fixture(page, { size: memoryLimit + 1, noPicker: true }); await app.start(); await app.waitForJob();
  const downloaded = page.waitForEvent('download'); await app.update({ state: 'ready' });
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('bucket-encoded-name.txt');
  expect(await readFile((await download.path())!)).toEqual(originalBytes);
  expect(await page.evaluate(() => window.__downloadBrowserFixture.bucketFetches)).toEqual([]);
  await expect(page.getByText(/browser may encode the filename/)).toBeVisible();
});

test.describe('blocked browser fetch', () => {
  test('a blocked fetch falls back to a real native download and native retries avoid the failed fetch', async ({ page }) => {
    const app = await fixture(page, { blockBucketFetch: true }); await app.start(); await app.waitForJob();
    const downloaded = page.waitForEvent('download'); await app.update({ state: 'ready' });
    const download = await downloaded;
    expect(await readFile((await download.path())!)).toEqual(originalBytes);
    expect(download.suggestedFilename()).toBe('bucket-encoded-name.txt');
    const tray = page.getByRole('complementary', { name: 'File downloads' });
    await expect(tray.getByText('Download requested', { exact: true })).toBeVisible();
    await expect(tray.getByText('File saved', { exact: true })).toHaveCount(0);
    await expect(tray.getByRole('alert')).toHaveCount(0);
    await expect(tray.getByRole('button', { name: /Save file|Save again/ })).toHaveCount(0);
    const link = tray.getByRole('link', { name: 'Download file', exact: true });
    await expect(link).toHaveAttribute('href', app.latest().url!);
    const repeated = page.waitForEvent('download'); await link.click();
    expect(await readFile((await (await repeated).path())!)).toEqual(originalBytes);
    expect(await page.evaluate(() => window.__downloadBrowserFixture.bucketFetches.length)).toBe(1);
    expect(app.posts).toHaveLength(1);
  });

  test('a blocked automatic handoff leaves an explicit native link that can save the file', async ({ page }) => {
    await page.addInitScript(() => {
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        // Reproduce iframe/popup blocking of automatic handoff only; a real
        // pointer click on the visible link still uses native browser navigation.
        if (this.href.startsWith('https://huggingface.co/buckets/') && !this.textContent?.trim()) return;
        click.call(this);
      };
    });
    const app = await fixture(page, { blockBucketFetch: true }); await app.start(); await app.waitForJob();
    await app.update({ state: 'ready' });
    const tray = page.getByRole('complementary', { name: 'File downloads' });
    await expect(tray.getByText('Download requested', { exact: true })).toBeVisible();
    await expect(tray.getByText('File saved', { exact: true })).toHaveCount(0);
    expect(app.bucketRequests).toHaveLength(0);
    const downloaded = page.waitForEvent('download'); await tray.getByRole('link', { name: 'Download file', exact: true }).click();
    expect(await readFile((await (await downloaded).path())!)).toEqual(originalBytes);
    expect(await page.evaluate(() => window.__downloadBrowserFixture.bucketFetches.length)).toBe(1);
    expect(app.bucketRequests).toHaveLength(1);
  });
});

test('a reload restores pending jobs, reconnects, and leaves saving under user control', async ({ page }) => {
  const app = await fixture(page); await app.start(); await app.waitForJob();
  await page.reload();
  const tray = page.getByRole('complementary', { name: 'File downloads' });
  await expect(tray.getByText('Preparing download…', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__downloadBrowserFixture.sources.filter(source => source.readyState !== 2).length)).toBe(1);
  await page.evaluate(() => window.__downloadBrowserFixture.sources.forEach(source => { source.readyState = 0; source.onerror?.(new Event('error')); }));
  await app.update({ state: 'ready' }, false);
  await expect(tray.getByText('Ready to save', { exact: true })).toBeVisible();
  expect(app.posts).toHaveLength(1); expect(app.bucketRequests).toHaveLength(0);
  const downloaded = page.waitForEvent('download'); await tray.getByRole('button', { name: 'Save file', exact: true }).click();
  expect(await readFile((await (await downloaded).path())!)).toEqual(originalBytes);
});

test('a large active download batch windows transfer rows while keeping cancellation usable', async ({ page }) => {
  const app = await fixture(page);
  for (let index = 0; index < 40; index++) await app.start();
  await expect.poll(() => app.posts.length).toBe(40);
  const tray = page.getByRole('complementary', { name: 'File downloads', exact: true });
  await expect(tray.getByText('40 active', { exact: true })).toBeVisible();
  expect(await tray.locator('.download-item').count()).toBeLessThan(12);
  const list = tray.getByRole('list', { name: 'Download transfers', exact: true });
  await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(tray.locator('.download-item').last().getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  expect(await tray.locator('.download-item').count()).toBeLessThan(12);
  await tray.locator('.download-item').last().getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect.poll(() => app.cancelled.length).toBe(1);
  await expect(tray.getByText('39 active', { exact: true })).toBeVisible();
  expect(app.posts).toHaveLength(40);
});

test('a bucket object deleted after preparation becomes expired and can be prepared again', async ({ page }) => {
  const app = await fixture(page); await app.start(); await app.waitForJob();
  await page.route('https://huggingface.co/buckets/alvin3y12/codex-downloads/resolve/**', route => route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: 'Not found' }));
  await app.update({ state: 'ready' });
  const tray = page.getByRole('complementary', { name: 'File downloads' });
  await expect(tray.getByText('Download expired', { exact: true })).toBeVisible();
  await expect(tray.getByRole('button', { name: 'Prepare again' })).toBeVisible();
  await expect(tray.getByRole('link')).toHaveCount(0);
});

test('expired or unsafe links never become clickable downloads', async ({ page }) => {
  const app = await fixture(page); await app.start(); await app.waitForJob();
  await app.update({ state: 'expired', error: { code: 'DOWNLOAD_EXPIRED', message: 'This download expired.' } });
  const tray = page.getByRole('complementary', { name: 'File downloads' });
  await expect(tray.getByText('Download expired', { exact: true })).toBeVisible();
  await expect(tray.getByRole('link')).toHaveCount(0);
  await tray.getByRole('button', { name: 'Prepare again' }).click();
  await expect.poll(() => app.posts.length).toBe(2); await app.waitForJob();
  await app.update({ state: 'ready', url: 'javascript:alert(document.cookie)' });
  await expect(tray.getByRole('alert')).toContainText('invalid download link');
  await expect(tray.getByRole('link')).toHaveCount(0);
  expect(app.bucketRequests).toHaveLength(0);
});

test('the phone download tray stays on screen with full touch targets', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const app = await fixture(page); await app.start(); await app.waitForJob();
  const tray = page.getByRole('complementary', { name: 'File downloads' });
  const bounds = await tray.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  const cancel = await tray.getByRole('button', { name: 'Cancel', exact: true }).boundingBox();
  expect(cancel!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('download-phone.png'), fullPage: true, animations: 'disabled' });
});
