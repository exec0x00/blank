import { blockUnmatchedTransferNetwork, nativeTransferMetadata } from './native-transfer-fixture';
import { changeReviewPageFixture } from './change-review-fixture';
import { expect, test, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import type { AppSettings, FileEntry, UploadJob, Workspace } from '../../shared/types';
import { uiStateFixture } from './ui-state-fixture';
import { directoryPageFixture } from './directory-page-fixture';
import { browserLaunchOptions } from '../browser-launch';

// The real app, upload worker, WASM chunking, hashing, and SDK run in Chromium.
// Only authenticated control responses and external CAS responses are fixtures.
// This does not establish provider CORS support; the coordinator's separate live
// CAS/publication/readback proof must pass with ordinary browser security.
test.use({ serviceWorkers: 'block', launchOptions: { ...browserLaunchOptions(), ignoreDefaultArgs: ['--disable-popup-blocking'] } });
test.beforeEach(({ context, baseURL }) => blockUnmatchedTransferNetwork(context, baseURL));

const cas = 'https://cas-server-direct.xethub.hf.co';
const capability = 'temporary-CAS-capability-browser-fixture';
const initialContent = 'Keep this editor buffer.\n';

async function fixture(page: Page, options: { blockCas?: boolean; holdCapability?: boolean; holdImport?: boolean } = {}) {
  const workspace: Workspace = { id: 'upload-workspace', name: 'Upload project', path: '/data/workspaces/upload-project', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
  const settings: AppSettings = { model: 'gpt-5.6-cyber', reasoningEffort: 'high', autoApprove: false, theme: 'dark', fontSize: 13, wordWrap: false, provider: 'openai', apiKeyConfigured: false, agentConfigured: true };
  const jobs = new Map<string, UploadJob>();
  const contents = new Map<string, Buffer>();
  const hashes = new Map<string, string>();
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const direct: Array<{ method: string; path: string; bytes: number; usesTemporaryCapability: boolean; cookie?: string }> = [];
  const control = { capabilityWaiting: false, releaseCapability: undefined as (() => void) | undefined };
  let authenticated = true;
  const uiState = uiStateFixture();

  await page.addInitScript(() => { localStorage.setItem('codex.view', 'editor'); localStorage.setItem('codex.split', 'focus'); localStorage.setItem('codex.sidebar', 'collapsed'); });
  await page.context().route(`${cas}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,x-xet-session-id,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    direct.push({ method: request.method(), path: url.pathname, bytes: request.postDataBuffer()?.byteLength || 0,
      usesTemporaryCapability: request.headers().authorization === `Bearer ${capability}`, cookie: request.headers().cookie });
    if (options.blockCas) return route.abort('failed');
    await route.fulfill({ status: request.method() === 'GET' ? 404 : 200, headers: cors, body: '' });
  });
  await page.route('**/api/**', async route => {
    const request = route.request(); const url = new URL(request.url());
    const path = url.pathname.slice(4); const method = request.method();
    const body = request.postData() ? request.postDataJSON() as Record<string, unknown> : undefined;
    calls.push({ method, path, body });
    const respond = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/session') { if (method === 'DELETE') authenticated = false; if (method === 'POST') authenticated = true; return respond({ authenticated }); }
    if (!authenticated) return respond({ error: 'Workspace locked.', code: 'AUTH_REQUIRED' }, 401);
    if (await uiState.handle(route)) return;
    if (path === '/bootstrap') return respond({ uiState: uiState.read(), workspaces: [workspace], activeWorkspaceId: workspace.id, settings, githubAccounts: [], storage: { path: '/data', persistent: true, bucket: 'alvin3y12/data', writable: true } });
    if (path === `/workspaces/${workspace.id}/tree-page` || path === `/workspaces/${workspace.id}/tree`) {
      const folder = url.searchParams.get('path') || '';
      const entries: FileEntry[] = folder === '' ? [{ name: 'incoming', path: 'incoming', kind: 'directory' }, { name: 'open.txt', path: 'open.txt', kind: 'file', size: initialContent.length }] : [];
      for (const job of jobs.values()) if (job.state === 'ready' && (job.path.includes('/') ? job.path.slice(0, job.path.lastIndexOf('/')) : '') === folder) entries.push(job.entry!);
      return respond(path.endsWith('/tree-page') ? directoryPageFixture(url, entries) : entries);
    }
    if (path === `/workspaces/${workspace.id}/tree-entry`) {
      const requested = url.searchParams.get('path');
      if (requested === 'incoming') return respond({ name: 'incoming', path: 'incoming', kind: 'directory' });
      if (requested === 'open.txt') return respond({ name: 'open.txt', path: 'open.txt', kind: 'file', size: initialContent.length });
      const uploaded = [...jobs.values()].find(job => job.state === 'ready' && job.path === requested)?.entry;
      return uploaded ? respond(uploaded) : respond({ error: 'File not found.', code: 'FILE_NOT_FOUND' }, 404);
    }
    if (path === `/workspaces/${workspace.id}/file`) {
      if (method !== 'GET') return respond({ error: 'Unexpected editor overwrite.' }, 500);
      return respond({ path: 'open.txt', content: initialContent, size: initialContent.length, version: 'saved-editor-version', language: 'plaintext' });
    }
    if (path === '/uploads/status') return respond({ enabled: true, ready: true, state: 'ready', bucket: 'alvin3y12/codex-downloads', maxFileBytes: 25 * 1024 * 1024, maxActiveSessions: 8, maxConcurrency: 2, sessionTtlMs: 1_800_000, unknownTimestampCount: 0 });
    if (path === `/workspaces/${workspace.id}/uploads` && method === 'POST') {
      if (String(body?.path).endsWith('existing.txt')) return respond({ error: 'A file already exists.', code: 'FILE_EXISTS' }, 409);
      const id = randomUUID(); const now = new Date().toISOString(); const target = String(body?.path);
      const job: UploadJob = { id, workspaceId: workspace.id, path: target, fileName: target.split('/').at(-1)!, size: Number(body?.size),
        state: 'reserved', bucket: 'alvin3y12/codex-downloads', objectPath: `imports/${id}/staged-file`, bytesProcessed: 0,
        createdAt: now, updatedAt: now, sessionExpiresAt: new Date(Date.now() + 1_800_000).toISOString() };
      jobs.set(id, job); return respond(job, 201);
    }
    const match = /^\/uploads\/([a-f0-9-]+)(\/capability|\/complete)?$/.exec(path);
    if (match) {
      const job = jobs.get(match[1]); if (!job) return respond({ error: 'Upload not found.' }, 404);
      if (match[2] === '/capability') {
        if (options.holdCapability) { control.capabilityWaiting = true; await new Promise<void>(resolve => { control.releaseCapability = resolve; }); }
        return respond({ accessToken: capability, casUrl: cas, exp: Math.floor(Date.now() / 1000) + 900 }).catch(() => undefined);
      }
      if (match[2] === '/complete') {
        expect(body?.xetHash).toMatch(/^[a-f0-9]{64}$/);
        expect(body?.sha256).toBe(createHash('sha256').update(contents.get(job.fileName)!).digest('hex'));
        hashes.set(job.id, String(body?.sha256));
        Object.assign(job, { state: options.holdImport ? 'importing' : 'ready', bytesProcessed: options.holdImport ? Math.floor(job.size / 2) : job.size,
          version: body?.sha256, entry: { name: job.fileName, path: job.path, kind: 'file', size: job.size }, expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
        return respond(job, 202);
      }
      if (method === 'DELETE' && job.state !== 'ready') job.state = 'cancelled';
      return respond(job);
    }
    if (path.endsWith('/git/status')) return respond({ isRepository: false, branch: '', ahead: 0, behind: 0, files: [], branches: [] });
    if (path === `/workspaces/${workspace.id}/rewind-recovery` && method === 'GET') return respond({ workspaceId: workspace.id, recovery: null });
    const nativeMetadata = nativeTransferMetadata(path, method, settings);
    if (nativeMetadata !== undefined) return respond(nativeMetadata);
    if (path === '/settings') return respond(settings);
    if (path === '/changes') return respond(changeReviewPageFixture(url));
    if (path === '/github/accounts' || /\/(terminals|trash|file-paths|workflows)$/.test(path)) return respond([]);
    return respond({ error: `Unexpected fixture request: ${method} ${path}` }, 404);
  });
  await page.goto('/work');
  const editor = page.getByRole('region', { name: 'Code editor', exact: true });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('treeitem', { name: /incoming/ })).toBeVisible();

  const upload = async (files: Array<{ name: string; content: Buffer }>, folder = 'incoming') => {
    for (const file of files) contents.set(file.name, file.content);
    if (folder) await editor.getByRole('treeitem', { name: new RegExp(folder) }).click();
    const chooser = page.waitForEvent('filechooser');
    await editor.getByRole('button', { name: 'Upload files', exact: true }).click();
    await (await chooser).setFiles(files.map(file => ({ name: file.name, mimeType: 'application/octet-stream', buffer: file.content })));
  };
  return { editor, jobs, calls, direct, control, hashes, upload,
    finishImports() { for (const job of jobs.values()) if (job.state === 'importing') { job.state = 'ready'; job.bytesProcessed = job.size; } },
  };
}

test('real SDK worker uploads to the chosen folder, confirms import, and preserves an unrelated dirty buffer', async ({ page }) => {
  const app = await fixture(page, { holdImport: true });
  await app.editor.getByRole('treeitem', { name: /open.txt/ }).click();
  const input = app.editor.locator('.monaco-editor textarea.inputarea').first();
  await expect(input).toBeVisible(); await input.focus(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('Unsaved marker');
  const name = 'report café 你好.txt'; const content = Buffer.from('\uFEFFBrowser upload\r\nUnicode café 你好\r\n');
  await app.upload([{ name, content }]);
  const progress = app.editor.getByRole('region', { name: 'File uploads' });
  await expect(progress.getByText('Saving to workspace', { exact: true })).toBeVisible();
  await expect(progress.getByText('Saved to workspace', { exact: true })).toHaveCount(0);
  expect(app.calls.find(call => call.path === '/workspaces/upload-workspace/uploads')?.body).toEqual({ path: `incoming/${name}`, size: content.byteLength });
  expect(app.direct.some(request => request.method === 'POST' && request.path.includes('/xorbs/') && request.bytes > 0)).toBe(true);
  expect(app.direct.every(request => request.usesTemporaryCapability && !request.cookie)).toBe(true);
  expect(app.calls.some(call => call.method === 'PUT' && call.path.endsWith('/upload'))).toBe(false);
  app.finishImports();
  await expect(progress.getByText('Saved to workspace', { exact: true })).toBeVisible();
  await expect(app.editor.locator('.monaco-editor .view-lines').first()).toContainText('Unsaved marker');
  await expect(app.editor.getByRole('treeitem', { name: new RegExp('report café') })).toBeVisible();
});

test('blocked direct network requests stay visible as failed uploads and never finalize', async ({ page }) => {
  const app = await fixture(page, { blockCas: true });
  await app.upload([{ name: 'blocked.txt', content: Buffer.from('Not transmitted through the app server.') }]);
  const progress = app.editor.getByRole('region', { name: 'File uploads' });
  await expect(progress.getByText('Upload failed', { exact: true })).toBeVisible();
  await expect(progress.getByRole('alert')).toContainText('browser could not reach Hugging Face');
  expect(app.calls.some(call => call.path.endsWith('/complete'))).toBe(false);
  expect(app.calls.some(call => call.method === 'DELETE' && call.path.startsWith('/uploads/'))).toBe(true);
  await expect(progress.getByText('0 of 1 saved', { exact: true })).toBeVisible();
});

test('cancelling a file awaiting its capability also cancels queued files and stops the worker', async ({ page }) => {
  const app = await fixture(page, { holdCapability: true });
  try {
    await app.upload([{ name: 'first.txt', content: Buffer.from('first') }, { name: 'second.txt', content: Buffer.from('second') }]);
    await expect.poll(() => app.control.capabilityWaiting).toBe(true);
    const progress = app.editor.getByRole('region', { name: 'File uploads' });
    await progress.getByRole('button', { name: 'Cancel uploads', exact: true }).click();
    await expect(progress.getByText('Cancelled', { exact: true })).toHaveCount(2);
    expect(app.jobs.size).toBe(1);
    expect(app.direct).toHaveLength(0);
    expect(app.calls.some(call => call.path.endsWith('/complete'))).toBe(false);
  } finally { app.control.releaseCapability?.(); }
});

test('a conflicting filename fails independently while another selected file is saved', async ({ page }) => {
  const app = await fixture(page);
  await app.upload([{ name: 'existing.txt', content: Buffer.from('Existing file stays unchanged.') }, { name: 'new.txt', content: Buffer.from('New file.') }]);
  const progress = app.editor.getByRole('region', { name: 'File uploads' });
  await expect(progress.getByText('1 of 2 saved', { exact: true })).toBeVisible();
  await expect(progress.getByRole('listitem', { name: 'Upload existing.txt', exact: true }).getByRole('alert')).toContainText('already exists');
  await expect(progress.getByRole('listitem', { name: 'Upload new.txt', exact: true }).getByText('Saved to workspace', { exact: true })).toBeVisible();
  expect(app.jobs.size).toBe(1);
});

test('an upload cannot replace an edited file with unsaved changes', async ({ page }) => {
  const app = await fixture(page);
  await app.editor.getByRole('treeitem', { name: /open.txt/ }).click();
  const input = app.editor.locator('.monaco-editor textarea.inputarea').first();
  await expect(input).toBeVisible(); await input.focus(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText('Unsaved marker');
  await app.upload([{ name: 'open.txt', content: Buffer.from('Incoming overwrite attempt.') }], '');
  const progress = app.editor.getByRole('region', { name: 'File uploads' });
  await expect(progress.getByRole('alert')).toContainText('Save or close the edited file');
  await expect(app.editor.locator('.monaco-editor .view-lines').first()).toContainText('Unsaved marker');
  expect(app.jobs.size).toBe(0);
  expect(app.direct).toHaveLength(0);
});
