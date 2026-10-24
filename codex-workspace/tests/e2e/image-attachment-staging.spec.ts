import { expect, test, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import type { FileAttachmentUploadJob, ImageAttachment } from '../../shared/types';
import type { CodexCapabilities, CodexModel, CodexRuntimeStatus } from '../../shared/codex-cli';
import { gitRewindFixture, type GitRewindFixture } from './git-rewind-fixture';

// Actual App, photo hook, shared HF worker and hashing in Chromium. Only the
// external CAS and explicit REST transport boundary are controlled. Backend
// image-attachment-staging.test.ts separately verifies real files and routes.
// This is deliberately not a live HF or model-provider acceptance claim.
test.use({ serviceWorkers: 'block' });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN4bm4DAANjAVvvpjgdAAAAAElFTkSuQmCC', 'base64');
const digest = createHash('sha256').update(png).digest('hex');
const fixtures = new Map<Page, { base: GitRewindFixture; failures: string[]; release(): void }>();

async function fixture(page: Page, options: { holdImport?: boolean; holdPromotion?: boolean; loseFirstReply?: boolean; invalidReply?: boolean } = {}) {
  const base = await gitRewindFixture(page), failures: string[] = [];
  // Reuse only the shared workspace/editor transport fixture. These composer
  // threads use the current native DTO; no legacy-runtime mutation is enabled.
  const capabilities: CodexCapabilities = { conversations: true, pagination: true, queue: true, goals: true, skills: true, plan: true, review: true, historyRevert: true };
  const model: CodexModel = { id: 'native-photo-catalog-row', model: 'fixture-rewind-model', displayName: 'Photo fixture model',
    description: 'Controlled native catalog row, not a provider capability claim.', hidden: false, isDefault: true,
    inputModalities: ['text', 'image'], defaultReasoningEffort: 'max', supportedReasoningEfforts: [{ reasoningEffort: 'max', description: 'Maximum' }] };
  const runtime: CodexRuntimeStatus = { backend: 'codex-cli', state: 'ready', version: '0.155.1', installedVersion: '0.155.1', startedAt: base.workspace.createdAt,
    updatedAt: base.workspace.updatedAt, canUpdate: true, updateBlockedReason: null, error: null, activeTurns: 0, capabilities };
  for (const thread of [base.root, base.otherThread, base.remoteThread]) {
    thread.backend = 'codex-cli'; thread.readOnly = false;
    thread.native = { model: model.model, reasoningEffort: 'max', activeTurnId: null, approvals: [], questions: [], queue: [], queueCursor: null,
      goal: null, tokenUsage: null, diff: null, capabilities: { ...capabilities } };
    thread.nativePage = { nextCursor: null, backwardsCursor: null };
  }
  await page.route('**/api/codex/runtime', route => route.fulfill({ json: runtime }));
  await page.route('**/api/models', route => route.fulfill({ json: { backend: 'codex-cli', connected: true, catalog: [model], models: [model.model] } }));
  await page.route('**/api/workspaces/*/codex/skills', route => route.fulfill({ json: { skills: [], errors: [] } }));
  const jobs = new Map<string, FileAttachmentUploadJob>(), images = new Map<string, ImageAttachment>();
  const controls = { holdImport: !!options.holdImport, holdPromotion: !!options.holdPromotion, lostReply: !!options.loseFirstReply, held: 0 };
  const waiters: Array<() => void> = [], genericDeletes: string[] = [], modelSubmissions: Record<string, unknown>[] = [];
  const appBodies: Array<{ path: string; body: Record<string, unknown> }> = [];
  const promotions: Array<{ workspaceId: string; body: { uploadId: string; sha256: string; detail: 'high' } }> = [];
  const direct: Array<{ method: string; bytes: number; temporary: boolean; cookie: boolean }> = [];
  const capability = 'temporary-real-worker-photo-fixture';
  const makeReady = (job: FileAttachmentUploadJob) => {
    job.state = 'ready'; job.bytesProcessed = job.size;
    job.attachment = { id: `file_${job.id.replaceAll('-', '')}`, workspaceId: job.workspaceId, name: job.name, mimeType: 'image/png',
      bytes: job.size, sha256: digest, createdAt: job.createdAt };
  };
  const release = () => { controls.holdPromotion = false; for (const done of waiters.splice(0)) done(); };
  fixtures.set(page, { base, failures, release });
  page.on('pageerror', error => failures.push(error.message));
  await page.context().route('https://**/*', route => { failures.push('Unexpected external request outside the controlled photo upload.'); return route.abort(); });
  await page.context().route('https://cas-server.xethub.hf.co/**', async route => {
    const request = route.request(), cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,x-xet-session-id,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    direct.push({ method: request.method(), bytes: request.postDataBuffer()?.length || 0,
      temporary: request.headers().authorization === `Bearer ${capability}`, cookie: !!request.headers().cookie });
    return route.fulfill({ status: request.method() === 'GET' ? 404 : 200, headers: cors, body: '' });
  });
  await page.route(url => /^\/api\/(?:file-attachment-uploads(?:\/|$)|workspaces\/[^/]+\/(?:file-attachments|attachments)(?:\/|$))/.test(url.pathname), async route => {
    const request = route.request(), url = new URL(request.url()), pathname = url.pathname.slice(4), method = request.method();
    const respond = (value: unknown, status = 200) => route.fulfill({ status, json: value }).catch(() => undefined);
    let body: Record<string, unknown> = {};
    if (method === 'POST') {
      expect(request.headers()['content-type']).toBe('application/json');
      const encoded = request.postDataBuffer();
      body = encoded ? request.postDataJSON() : {}; appBodies.push({ path: pathname, body });
      expect(encoded?.includes(png) ?? false).toBe(false);
      expect(JSON.stringify(body)).not.toContain(png.toString('base64'));
    }
    if (pathname === '/file-attachment-uploads/status') return respond({ enabled: true, ready: true, maxFileBytes: 25 * 1024 * 1024, maxPerMessage: 8, maxMessageBytes: 50 * 1024 * 1024 });
    const reserve = /^\/workspaces\/([^/]+)\/file-attachments\/uploads$/.exec(pathname);
    if (reserve) {
      expect(Object.keys(body).sort()).toEqual(['mimeType', 'name', 'size']); expect(body.size).toBe(png.length);
      const id = randomUUID(), now = new Date().toISOString();
      const job: FileAttachmentUploadJob = { id, workspaceId: reserve[1], name: String(body.name), size: Number(body.size), mimeType: String(body.mimeType),
        state: 'reserved', bytesProcessed: 0, bucket: 'alvin3y12/codex-downloads', objectPath: `imports/${id}/photo`,
        createdAt: now, updatedAt: now, sessionExpiresAt: new Date(Date.now() + 1800000).toISOString() };
      jobs.set(id, job); return respond(job, 201);
    }
    const upload = /^\/file-attachment-uploads\/([^/]+)(?:\/(capability|complete))?$/.exec(pathname);
    if (upload) {
      const job = jobs.get(upload[1]); if (!job) return respond({ error: 'Unknown controlled upload.' }, 404);
      if (upload[2] === 'capability') return respond({ accessToken: capability, casUrl: 'https://cas-server.xethub.hf.co', exp: Math.floor(Date.now() / 1000) + 900 });
      if (upload[2] === 'complete') {
        expect(body.sha256).toBe(digest); expect(body.xetHash).toMatch(/^[a-f0-9]{64}$/);
        if (controls.holdImport) { job.state = 'importing'; job.bytesProcessed = Math.floor(job.size / 2); } else makeReady(job);
      }
      if (method === 'DELETE' && job.state !== 'ready') job.state = 'cancelled';
      return respond(job);
    }
    const promotion = /^\/workspaces\/([^/]+)\/attachments\/from-upload$/.exec(pathname);
    if (promotion) {
      expect(Object.keys(body).sort()).toEqual(['detail', 'sha256', 'uploadId']);
      const job = jobs.get(String(body.uploadId))!;
      expect(job).toMatchObject({ workspaceId: promotion[1], state: 'ready' }); expect(body.sha256).toBe(digest);
      promotions.push({ workspaceId: promotion[1], body: body as { uploadId: string; sha256: string; detail: 'high' } });
      const key = JSON.stringify([promotion[1], job.id, digest, body.detail]);
      let image = images.get(key);
      if (!image) {
        const id = `att_${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
        image = { id, workspaceId: job.workspaceId, name: job.name, mimeType: 'image/png', bytes: job.size, width: 1, height: 1,
          sha256: digest, detail: 'high', createdAt: job.createdAt, previewUrl: `/api/workspaces/${job.workspaceId}/attachments/${id}/content?sha256=${digest}` };
        images.set(key, image);
      }
      if (controls.holdPromotion) { controls.held++; await new Promise<void>(resolve => waiters.push(resolve)); }
      if (controls.lostReply) { controls.lostReply = false; await route.abort('failed').catch(() => undefined); return; }
      return respond(options.invalidReply ? { ...image, sha256: 'f'.repeat(64), previewUrl: 'https://other.invalid/not-this-photo' } : image, 201);
    }
    if (/\/file-attachments\/file_[a-f0-9]{32}$/.test(pathname) && method === 'DELETE') {
      expect(promotions.length).toBeGreaterThan(0); genericDeletes.push(pathname); return respond({ deleted: true });
    }
    if (/\/attachments\/att_[a-f0-9]{32}\/content$/.test(pathname) && method === 'GET') return route.fulfill({ status: 200, contentType: 'image/png', body: png });
    if (/\/attachments\/att_[a-f0-9]{32}$/.test(pathname) && method === 'DELETE') return respond({ deleted: true });
    failures.push(`${method} ${pathname}`); return respond({ error: 'Unexpected controlled photo route.' }, 404);
  });
  await page.route('**/api/threads/*/run', async route => {
    const body = route.request().postDataJSON();
    expect(body.clientUserMessageId).toMatch(/^[a-f0-9-]{36}$/); expect(body.model).toBe(model.model);
    expect(body.reasoningEffort).toBe('max');
    modelSubmissions.push(body);
    // Observe explicit composer serialization without starting a model or
    // manufacturing a model response.
    await route.fulfill({ status: 503, json: { error: 'Controlled no-model boundary.' } });
  });
  await page.goto('/work');
  const panel = page.getByRole('region', { name: 'Codex conversation', exact: true });
  await expect(panel.getByRole('button', { name: 'Attach files', exact: true })).toBeEnabled();
  return { base, panel, controls, jobs, images, direct, appBodies, promotions, genericDeletes, modelSubmissions, release,
    choose: (name: string) => panel.getByLabel('Choose file attachments', { exact: true }).setInputFiles({ name, mimeType: 'image/png', buffer: png }),
    finishImports() { controls.holdImport = false; for (const job of jobs.values()) if (job.state === 'importing') makeReady(job); },
  };
}

test.afterEach(async ({ page }) => {
  const current = fixtures.get(page); fixtures.delete(page); current?.release(); current?.base.releaseAll();
  if (current) { expect(current.failures).toEqual([]); expect(current.base.unexpected).toEqual([]); expect(current.base.pageErrors).toEqual([]); }
});

test('photos use actual worker CAS bytes and JSON-only promotion before explicit image-reference submission', async ({ page }) => {
  const app = await fixture(page, { holdImport: true });
  await app.choose('direct-photo.png');
  await expect(app.panel.getByRole('progressbar', { name: 'Verifying photo: direct-photo.png', exact: true })).toBeVisible();
  expect(app.promotions).toEqual([]); expect(app.genericDeletes).toEqual([]); expect(app.modelSubmissions).toEqual([]);
  await expect(app.panel.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  app.finishImports();
  await expect(app.panel.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  expect(app.promotions).toHaveLength(1); expect(app.genericDeletes).toHaveLength(1);
  expect(app.direct.some(request => request.method === 'POST' && request.bytes > 0)).toBe(true);
  expect(app.direct.every(request => request.temporary && !request.cookie)).toBe(true);
  expect(app.appBodies.some(request => /\/attachments$/.test(request.path))).toBe(false);
  expect(app.modelSubmissions).toEqual([]);
  await app.panel.getByRole('button', { name: 'Preview direct-photo.png', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'direct-photo.png', exact: true });
  await expect.poll(() => preview.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 1)).toBe(true);
  await page.keyboard.press('Escape');
  await app.panel.getByRole('textbox', { name: 'Message Codex', exact: true }).press('Control+Enter');
  await expect.poll(() => app.modelSubmissions.length).toBe(1);
  const image = [...app.images.values()][0];
  expect(app.modelSubmissions[0].attachments).toEqual([{ id: image.id, sha256: digest }]);
  expect(app.modelSubmissions[0].fileAttachments ?? []).toEqual([]);
  expect(JSON.stringify(app.modelSubmissions[0])).not.toContain(png.toString('base64'));
});

test('a lost promotion reply retries the exact upload without a second reservation or conversion identity', async ({ page }) => {
  const app = await fixture(page, { loseFirstReply: true });
  await app.choose('lost-reply.png');
  await expect(app.panel.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  expect(app.jobs.size).toBe(1); expect(app.images.size).toBe(1); expect(app.promotions).toHaveLength(2);
  expect(app.promotions[1]).toEqual(app.promotions[0]); expect(app.genericDeletes).toHaveLength(1);
  expect(app.modelSubmissions).toEqual([]);
});

test('cancelled promotion stays out of the draft until retry checks the same uploaded photo', async ({ page }) => {
  const app = await fixture(page, { holdPromotion: true });
  try {
    await app.choose('cancelled-photo.png'); await expect.poll(() => app.controls.held).toBe(1);
    expect(app.genericDeletes).toEqual([]);
    await app.panel.getByRole('button', { name: 'Cancel upload of cancelled-photo.png', exact: true }).click();
    await expect(app.panel.getByRole('alert')).toContainText('Retry checks the same uploaded file');
    app.release();
    await expect(app.panel.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
    expect(app.genericDeletes).toEqual([]); expect(app.modelSubmissions).toEqual([]);
    await app.panel.getByRole('button', { name: 'Retry upload of cancelled-photo.png', exact: true }).click();
    await expect(app.panel.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
    expect(app.jobs.size).toBe(1); expect(app.images.size).toBe(1); expect(app.promotions).toHaveLength(2);
    expect(app.promotions[1]).toEqual(app.promotions[0]); expect(app.genericDeletes).toHaveLength(1);
  } finally { app.release(); }
});

test('an invalid promoted reference remains unconfirmed and retains its original generic upload', async ({ page }) => {
  const app = await fixture(page, { invalidReply: true });
  await app.choose('unconfirmed-photo.png');
  await expect(app.panel.getByRole('alert')).toContainText('Could not confirm photo preparation');
  await expect(app.panel.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  expect(app.jobs.size).toBe(1); expect(app.genericDeletes).toEqual([]); expect(app.modelSubmissions).toEqual([]);
});

test('a late promotion response cannot populate a different workspace or submit its source', async ({ page }) => {
  const app = await fixture(page, { holdPromotion: true });
  try {
    await app.choose('old-workspace.png'); await expect.poll(() => app.controls.held).toBe(1);
    await page.locator('.topbar-workspace').click();
    const picker = page.getByRole('dialog', { name: 'Your workspaces', exact: true });
    await picker.getByLabel('Find a workspace', { exact: true }).fill(app.base.otherWorkspace.name);
    await picker.locator('.workspace-select').filter({ hasText: app.base.otherWorkspace.name }).click();
    await expect(picker).toBeHidden(); await expect(page.locator('.topbar-workspace')).toHaveText(app.base.otherWorkspace.name);
    app.release();
    await expect(page.getByRole('button', { name: 'Preview old-workspace.png', exact: true })).toHaveCount(0);
    expect(app.genericDeletes).toEqual([]); expect(app.modelSubmissions).toEqual([]);
  } finally { app.release(); }
});
