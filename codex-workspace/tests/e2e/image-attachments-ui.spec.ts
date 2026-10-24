import { test, expect, type Page, type Route } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { FileAttachmentUploadJob, ImageAttachment } from '../../shared/types';

// Isolated browser tests of the actual React controls with controlled attachment
// HTTP responses. This harness never starts or substitutes a production model run.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN4bm4DAANjAVvvpjgdAAAAAElFTkSuQmCC', 'base64');
const sha256 = createHash('sha256').update(png).digest('hex');
const file = (name: string) => ({ name, mimeType: 'image/png', buffer: png });
let server: Server;
let origin: string;

test.beforeAll(async () => {
  const bundle = await build({
    stdin: { loader: 'tsx', resolveDir: process.cwd(), sourcefile: 'attachment-ui-fixture.tsx', contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { useImageAttachments, ImageAttachmentComposer, MessageImageAttachments } from './client/components/chat/ImageAttachments';
      import './client/styles.css';
      function Harness() {
        const [workspaceId, setWorkspaceId] = useState('workspace-a');
        const [draftKey, setDraftKey] = useState('$new');
        const [saved, setSaved] = useState([]);
        const [error, setError] = useState('');
        const images = useImageAttachments({ workspaceId, draftKey });
        window.imageTestController = images;
        return <main style={{ padding: 16, maxWidth: 720, margin: 'auto' }}>
          <div className="fixture-controls" aria-label="Fixture navigation">
            <button onClick={() => setWorkspaceId('workspace-a')}>Workspace A</button>
            <button onClick={() => setWorkspaceId('workspace-b')}>Workspace B</button>
            <button onClick={() => setDraftKey('$new')}>New draft</button>
            <button onClick={() => setDraftKey('thread-b')}>Thread B</button>
            <button onClick={() => { images.promoteDraft(draftKey, 'thread-created'); setDraftKey('thread-created'); }}>Promote draft</button>
            <button onClick={() => { setError(''); void images.restoreDraft(draftKey, window.imageTestRestore || []).catch(value => setError(value.message)); }}>Restore draft</button>
          </div>
          <output data-testid="image-state">{JSON.stringify({ workspaceId, draftKey, refs: images.attachmentRefs, busy: images.isBusy, hasErrors: images.hasErrors, count: images.items.length })}</output>
          {error && <p role="alert">{error}</p>}
          <form aria-label="Image composer fixture" {...images.composerProps} onSubmit={event => event.preventDefault()}>
            <label htmlFor="fixture-prompt">Message</label><textarea id="fixture-prompt" rows={3}/>
            <ImageAttachmentComposer controller={images}/>
            <button type="button" disabled={images.isBusy || images.hasErrors || !images.attachmentRefs.length} onClick={() => {
              setSaved(images.items.flatMap(item => item.attachment ? [item.attachment] : []));
              images.clearSubmitted(draftKey, images.attachmentRefs);
            }}>Acknowledge draft</button>
          </form>
          <MessageImageAttachments attachments={saved}/>
        </main>;
      }
      function App() {
        const [mounted, setMounted] = useState(true);
        return <><div className="fixture-controls">
          <button onClick={() => { document.body.dataset.workspaceLocked = 'true'; window.dispatchEvent(new Event('codex:session-locked')); }}>Lock fixture</button>
          <button onClick={() => { document.body.dataset.workspaceLocked = 'false'; window.dispatchEvent(new Event('codex:session-unlocked')); }}>Unlock fixture</button>
          <button onClick={() => setMounted(value => !value)}>Toggle fixture mount</button>
        </div>{mounted && <Harness/>}</>;
      }
      createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
    ` },
    bundle: true, write: false, outfile: '/tmp/codex-attachment-ui-fixture.js', format: 'esm', platform: 'browser', logLevel: 'silent',
  });
  const script = bundle.outputFiles!.find(output => output.path.endsWith('.js'))!.text;
  const style = bundle.outputFiles!.find(output => output.path.endsWith('.css'))!.text;
  const worker = await build({ entryPoints: ['client/uploads.worker.ts'], bundle: true, write: false,
    outdir: '/tmp/codex-photo-ui-worker', format: 'esm', platform: 'browser', splitting: true, logLevel: 'silent',
    alias: { '@huggingface/hub': path.join(process.cwd(), 'node_modules/@huggingface/hub/dist/browser/index.mjs') } });
  const workerAssets = new Map(worker.outputFiles.map(output => [path.basename(output.path), output.text]));
  server = createServer((request, response) => {
    if (request.url === '/fixture.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(script); }
    else if (request.url === '/fixture.css') { response.setHeader('Content-Type', 'text/css'); response.end(style); }
    else if (request.url === '/uploads.worker.ts') { response.setHeader('Content-Type', 'application/javascript'); response.end(workerAssets.get('uploads.worker.js')); }
    else if (workerAssets.has(request.url?.slice(1) || '')) { response.setHeader('Content-Type', 'application/javascript'); response.end(workerAssets.get(request.url!.slice(1))); }
    else if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>html,body,#root{height:auto;min-height:100%;overflow:auto}.fixture-controls{display:flex;gap:8px;flex-wrap:wrap;padding:8px}.fixture-controls button,form>button{border:1px solid var(--border);padding:8px;border-radius:6px}output{display:block;font:10px monospace;overflow-wrap:anywhere;margin:8px 0}form{border:1px solid var(--border);border-radius:10px;padding:12px}label{display:block}textarea{display:block;width:100%;background:var(--panel);border:1px solid var(--border);border-radius:6px;margin:8px 0;padding:8px}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
    } else { response.statusCode = 404; response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

interface Upload { attachment: ImageAttachment; body: Buffer; headers: Record<string, string>; promotion: { uploadId: string; sha256: string; detail: string } }
async function mockAttachments(page: Page, options: {
  upload?: (upload: Upload, route: Route) => Promise<boolean | void>;
  remove?: (route: Route) => Promise<boolean | void>;
  preview?: (route: Route) => Promise<boolean | void>;
} = {}) {
  const uploads: Upload[] = [], deletions: string[] = [];
  const jobs = new Map<string, FileAttachmentUploadJob>();
  const direct: Array<{ method: string; size: number; temporary: boolean; cookie: boolean }> = [];
  const capability = 'temporary-photo-upload-browser-fixture';
  await page.context().route('https://cas-server.xethub.hf.co/**', async route => {
    const request = route.request(), cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,x-xet-session-id,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    direct.push({ method: request.method(), size: request.postDataBuffer()?.length || 0, temporary: request.headers().authorization === `Bearer ${capability}`, cookie: !!request.headers().cookie });
    return route.fulfill({ status: request.method() === 'GET' ? 404 : 200, headers: cors, body: '' });
  });
  await page.route(`${origin}/api/workspaces/*/file-attachments/uploads`, async route => {
    const request = route.request(), body = request.postDataJSON(), workspaceId = new URL(request.url()).pathname.split('/')[3];
    expect(request.headers()['content-type']).toBe('application/json'); expect(Object.keys(body).sort()).toEqual(['mimeType', 'name', 'size']);
    expect(body.size).toBe(png.length);
    const id = randomUUID(), now = new Date().toISOString();
    const job: FileAttachmentUploadJob = { id, workspaceId, ...body, state: 'reserved', bytesProcessed: 0,
      bucket: 'alvin3y12/codex-downloads', objectPath: `imports/${id}/photo`, createdAt: now, updatedAt: now, sessionExpiresAt: new Date(Date.now() + 1800000).toISOString() };
    jobs.set(id, job); await route.fulfill({ status: 201, json: job });
  });
  await page.route(`${origin}/api/file-attachment-uploads/**`, async route => {
    const request = route.request(), segments = new URL(request.url()).pathname.split('/'), job = jobs.get(segments[3])!;
    expect(job).toBeTruthy();
    if (segments[4] === 'capability') return route.fulfill({ json: { accessToken: capability, casUrl: 'https://cas-server.xethub.hf.co', exp: Math.floor(Date.now() / 1000) + 900 } });
    if (segments[4] === 'complete') {
      expect(request.postDataJSON().sha256).toBe(sha256);
      expect(request.postDataJSON().xetHash).toMatch(/^[a-f0-9]{64}$/);
      job.state = 'ready'; job.bytesProcessed = job.size;
      job.attachment = { id: `file_${job.id.replaceAll('-', '')}`, workspaceId: job.workspaceId, name: job.name,
        mimeType: 'image/png', bytes: job.size, sha256, createdAt: job.createdAt };
    }
    return route.fulfill({ json: job });
  });
  await page.route(`${origin}/api/workspaces/*/file-attachments/file_*?*`, route => {
    expect(route.request().method()).toBe('DELETE');
    return route.fulfill({ json: { deleted: true } });
  });
  await page.route(`${origin}/api/workspaces/*/attachments**`, async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === 'POST') {
      expect(url.pathname.endsWith('/attachments/from-upload')).toBe(true);
      const promotion = request.postDataJSON() as Upload['promotion'], job = jobs.get(promotion.uploadId)!;
      expect(Object.keys(promotion).sort()).toEqual(['detail', 'sha256', 'uploadId']);
      expect(job.state).toBe('ready'); expect(promotion.sha256).toBe(sha256);
      const body = png;
      const workspaceId = decodeURIComponent(url.pathname.split('/')[3]);
      expect(job.workspaceId).toBe(workspaceId);
      const id = `att_${createHash('sha256').update(JSON.stringify([workspaceId, job.id, sha256, promotion.detail])).digest('hex').slice(0, 32)}`;
      const attachment: ImageAttachment = { id, workspaceId, name: job.name, mimeType: 'image/png', bytes: body.length,
        width: 1, height: 1, sha256: createHash('sha256').update(body).digest('hex'), detail: 'high', createdAt: job.createdAt,
        previewUrl: `/api/workspaces/${workspaceId}/attachments/${id}/content?sha256=${createHash('sha256').update(body).digest('hex')}` };
      const upload = { attachment, body, headers: request.headers(), promotion };
      uploads.push(upload);
      if (await options.upload?.(upload, route)) return;
      await route.fulfill({ status: 201, json: attachment }).catch(() => undefined);
    } else if (request.method() === 'DELETE') {
      deletions.push(url.pathname);
      if (await options.remove?.(route)) return;
      await route.fulfill({ status: 200, json: { deleted: true } });
    } else {
      if (await options.preview?.(route)) return;
      await route.fulfill({ status: 200, body: png, contentType: 'image/png', headers: { 'Cache-Control': 'no-store' } });
    }
  });
  await page.goto(origin);
  await expect(page.getByRole('button', { name: 'Attach images', exact: true })).toBeVisible();
  return { uploads, deletions, direct, jobs };
}

async function state(page: Page) {
  return JSON.parse((await page.getByTestId('image-state').textContent())!) as { workspaceId: string; draftKey: string; refs: Array<{ id: string; sha256: string }>; busy: boolean; hasErrors: boolean; count: number };
}
async function choose(page: Page, files: ReturnType<typeof file> | ReturnType<typeof file>[]) { await page.getByLabel('Choose image attachments', { exact: true }).setInputFiles(files); }

test('picker uploads actual bytes and keeps authenticated message previews after acknowledgement', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const { uploads, deletions, direct } = await mockAttachments(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Attach images', exact: true }).click();
  await (await chooser).setFiles(file('screen shot.png'));
  await expect.poll(async () => (await state(page)).refs.length).toBe(1);
  expect(uploads).toHaveLength(1);
  expect(uploads[0].body).toEqual(png);
  expect(uploads[0].headers['content-type']).toBe('application/json');
  expect(uploads[0].headers['x-codex-workspace']).toBe('1');
  expect(uploads[0].promotion).toMatchObject({ uploadId: expect.stringMatching(/^[a-f0-9-]{36}$/), sha256, detail: 'high' });
  expect(direct.some(request => request.method === 'POST' && request.size > 0)).toBe(true);
  expect(direct.every(request => request.temporary && !request.cookie)).toBe(true);
  expect((await state(page)).refs).toEqual([{ id: uploads[0].attachment.id, sha256 }]);
  const thumbnail = page.getByRole('button', { name: 'Preview screen shot.png', exact: true });
  await thumbnail.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'screen shot.png', exact: true });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 1)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(thumbnail).toBeFocused();
  await page.getByRole('button', { name: 'Acknowledge draft', exact: true }).click();
  await expect.poll(async () => (await state(page)).refs.length).toBe(0);
  expect(deletions).toEqual([]);
  await page.getByRole('button', { name: 'Open attached image screen shot.png', exact: true }).click();
  await expect(dialog).toBeVisible();
  expect(errors).toEqual([]);
});

test('file count and byte limits reject selections before any network upload', async ({ page }) => {
  const { uploads } = await mockAttachments(page);
  await choose(page, { name: 'vector.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await expect(page.getByRole('alert')).toContainText('Choose PNG');
  await choose(page, { name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(8 * 1024 * 1024 + 1) });
  await expect(page.getByRole('alert')).toContainText('up to 8 MiB');
  await choose(page, Array.from({ length: 9 }, (_, index) => file(`${index}.png`)));
  await expect(page.getByRole('alert')).toContainText('up to 8 images');
  await choose(page, Array.from({ length: 3 }, (_, index) => ({ name: `${index}.png`, mimeType: 'image/png', buffer: Buffer.alloc(6 * 1024 * 1024) })));
  await expect(page.getByRole('alert')).toContainText('up to 16 MiB');
  expect(uploads).toHaveLength(0);
  expect((await state(page)).count).toBe(0);
  await choose(page, file('valid.png'));
  await expect.poll(async () => (await state(page)).refs.length).toBe(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('photo filename admission matches staging limits before upload and preserves an accepted Unicode name', async ({ page }) => {
  const { uploads, jobs, direct } = await mockAttachments(page);
  for (const [name, notice] of [
    ['照'.repeat(100) + '.png', 'up to 255 UTF-8 bytes'],
    ['.codex-write-photo.png', 'filenames starting with .codex-write- are reserved'],
  ]) {
    await choose(page, file(name));
    await expect(page.getByRole('alert')).toContainText(notice);
    await expect(page.getByRole('alert')).toContainText('Rename the file and choose it again');
    await expect(page.getByRole('button', { name: /^Retry upload of/ })).toHaveCount(0);
    expect((await state(page)).count).toBe(0); expect((await state(page)).refs).toEqual([]);
    expect(jobs.size).toBe(0); expect(uploads).toEqual([]); expect(direct).toEqual([]);
  }
  const acceptedName = '照'.repeat(83) + 'é.png';
  expect(Buffer.byteLength(acceptedName)).toBe(255);
  await choose(page, file(acceptedName));
  await expect.poll(async () => (await state(page)).refs.length).toBe(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(jobs.size).toBe(1); expect([...jobs.values()][0].name).toBe(acceptedName);
  expect(uploads).toHaveLength(1); expect(uploads[0].attachment.name).toBe(acceptedName);
  expect(uploads[0].attachment.sha256).toBe(sha256);
});

test('text paste stays native, image paste uploads, and file drops cannot navigate away', async ({ page, context }) => {
  const { uploads } = await mockAttachments(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await page.evaluate(() => navigator.clipboard.writeText('Keep this ordinary text.'));
  await page.getByLabel('Message', { exact: true }).focus();
  await page.keyboard.press('ControlOrMeta+V');
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Keep this ordinary text.');
  const pasted = await page.getByLabel('Message', { exact: true }).evaluate((element, data) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(data)], 'clipboard.png', { type: 'image/png' }));
    const event = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, [...png]);
  expect(pasted).toBe(true);
  await expect.poll(async () => (await state(page)).refs.length).toBe(1);
  const mixed = await page.getByLabel('Message', { exact: true }).evaluate((element, data) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', 'Keep the mixed text too.');
    transfer.items.add(new File([Uint8Array.from(data)], 'mixed.png', { type: 'image/png' }));
    const event = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, [...png]);
  expect(mixed).toBe(false);
  await expect.poll(async () => (await state(page)).refs.length).toBe(2);
  const prevented = await page.getByRole('form', { name: 'Image composer fixture' }).evaluate(element => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['unsupported'], 'notes.pdf', { type: 'application/pdf' }));
    const event = new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await expect(page.getByRole('alert')).toContainText('Choose PNG');
  expect(uploads).toHaveLength(2);
  expect(page.url()).toBe(`${origin}/`);
});

test('uploads are bounded to two requests and queued or active uploads can be canceled and retried', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const { uploads } = await mockAttachments(page, { upload: async () => { await gate; } });
  await choose(page, [file('first.png'), file('second.png'), file('queued.png')]);
  await expect.poll(() => uploads.length).toBe(2);
  await expect(page.getByText('Waiting to upload…', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Acknowledge draft' })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel upload of queued.png', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel upload of first.png', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry upload of first.png', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry upload of first.png', exact: true }).click();
  await expect.poll(() => uploads.length).toBe(3);
  expect(uploads.filter(upload => upload.attachment.name === 'queued.png')).toHaveLength(0);
  release();
  await expect.poll(async () => (await state(page)).refs.length).toBe(2);
  expect((await state(page)).hasErrors).toBe(true);
  await page.getByRole('button', { name: 'Remove queued.png', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Acknowledge draft' })).toBeEnabled();
});

test('workspace and thread drafts stay separate through promotion and confirmed restoration', async ({ page }) => {
  const { uploads, deletions } = await mockAttachments(page, { remove: async route => { await route.fulfill({ status: 409, json: { error: 'Retained image.', code: 'ATTACHMENT_IN_USE' } }); return true; } });
  await choose(page, file('new-draft.png'));
  await expect.poll(async () => (await state(page)).refs.length).toBe(1);
  const newDraftRefs = (await state(page)).refs;
  await page.getByRole('button', { name: 'Thread B', exact: true }).click();
  expect((await state(page)).refs).toEqual([]);
  await choose(page, file('thread-b.png'));
  await expect.poll(async () => (await state(page)).refs.length).toBe(1);
  const threadRefs = (await state(page)).refs;
  expect(threadRefs).not.toEqual(newDraftRefs);
  await page.getByRole('button', { name: 'Workspace B', exact: true }).click();
  expect((await state(page)).refs).toEqual([]);
  await page.getByRole('button', { name: 'Workspace A', exact: true }).click();
  expect((await state(page)).refs).toEqual(threadRefs);
  await page.getByRole('button', { name: 'New draft', exact: true }).click();
  expect((await state(page)).refs).toEqual(newDraftRefs);
  await page.getByRole('button', { name: 'Promote draft', exact: true }).click();
  expect((await state(page)).draftKey).toBe('thread-created');
  expect((await state(page)).refs).toEqual(newDraftRefs);
  await page.getByRole('button', { name: 'New draft', exact: true }).click();
  expect((await state(page)).refs).toEqual([]);
  await page.getByRole('button', { name: 'Thread B', exact: true }).click();
  await page.evaluate(attachment => { (window as unknown as { imageTestRestore: ImageAttachment[] }).imageTestRestore = [attachment]; }, uploads[0].attachment);
  await page.getByRole('button', { name: 'Restore draft', exact: true }).click();
  await expect.poll(async () => (await state(page)).refs).toEqual(newDraftRefs);
  await expect.poll(() => deletions.length).toBe(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(attachment => { (window as unknown as { imageTestRestore: ImageAttachment[] }).imageTestRestore = [{ ...attachment, previewUrl: 'https://example.invalid/remote.png' }]; }, uploads[0].attachment);
  await page.getByRole('button', { name: 'Restore draft', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('restored images could not be confirmed');
  expect((await state(page)).refs).toEqual(newDraftRefs);
});

test('network errors remain visible, and preview and deletion retries use the real routes', async ({ page }) => {
  let uploadAttempts = 0, deleteAttempts = 0, failPreview = true;
  const { deletions } = await mockAttachments(page, {
    upload: async (_upload, route) => { if (++uploadAttempts <= 2) { await route.fulfill({ status: 503, json: { error: 'Upload service is restarting.' } }); return true; } },
    remove: async route => { if (++deleteAttempts === 1) { await route.fulfill({ status: 503, json: { error: 'Please retry removal.' } }); return true; } },
    preview: async route => { if (failPreview) { await route.fulfill({ status: 410, json: { error: 'Image expired.', code: 'ATTACHMENT_EXPIRED' } }); return true; } },
  });
  await choose(page, file('retry.png'));
  await expect(page.getByRole('alert')).toContainText('Upload service is restarting');
  await expect(page.getByRole('button', { name: 'Acknowledge draft' })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry upload of retry.png', exact: true }).click();
  await expect.poll(async () => (await state(page)).refs.length).toBe(1);
  await expect(page.getByText('Unavailable', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Preview retry.png', exact: true }).click();
  await expect(page.getByText('This image preview is unavailable.', { exact: true })).toBeVisible();
  failPreview = false;
  await page.getByRole('button', { name: 'Retry preview', exact: true }).click();
  await expect.poll(() => page.getByRole('dialog').locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 1)).toBe(true);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Remove retry.png', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not remove this image');
  expect((await state(page)).refs).toHaveLength(0);
  await expect(page.getByRole('button', { name: 'Acknowledge draft' })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry removing retry.png', exact: true }).click();
  await expect.poll(async () => (await state(page)).count).toBe(0);
  expect(deletions).toHaveLength(2);
  await expect(page.getByRole('button', { name: 'Attach images', exact: true })).toBeFocused();
});

test('locking and unmounting abort pending uploads, close previews, and release object URLs', async ({ page }) => {
  await page.addInitScript(() => {
    const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
    const active = new Set<string>();
    (window as unknown as { imageTestUrls: Set<string> }).imageTestUrls = active;
    URL.createObjectURL = object => { const value = originalCreate(object); active.add(value); return value; };
    URL.revokeObjectURL = value => { active.delete(value); originalRevoke(value); };
  });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const { uploads } = await mockAttachments(page, { upload: async () => { await gate; } });
  await choose(page, file('pending.png'));
  await expect.poll(() => uploads.length).toBe(1);
  await page.getByRole('button', { name: 'Preview pending.png', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(() => { document.body.dataset.workspaceLocked = 'true'; window.dispatchEvent(new Event('codex:session-locked')); });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await state(page)).count).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { imageTestUrls: Set<string> }).imageTestUrls.size)).toBe(0);
  await page.getByRole('button', { name: 'Unlock fixture', exact: true }).click();
  await choose(page, file('unmount.png'));
  await expect.poll(() => uploads.length).toBe(2);
  await page.getByRole('button', { name: 'Toggle fixture mount', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Image composer fixture' })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { imageTestUrls: Set<string> }).imageTestUrls.size)).toBe(0);
  release();
});

test('phone controls have touch targets, fit the viewport, and honor reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockAttachments(page);
  await choose(page, file('phone.png'));
  await expect.poll(async () => (await state(page)).refs.length).toBe(1);
  for (const button of await page.locator('.cw-image-composer button').all()) {
    const bounds = (await button.boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('button', { name: 'Preview phone.png', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(375);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(812);
  const decorations = await page.locator('.cw-image-composer, .cw-image-composer *, .cw-image-preview, .cw-image-preview *').evaluateAll(elements => elements.map(element => {
    const css = getComputedStyle(element);
    return { shadow: css.boxShadow, textShadow: css.textShadow, backdrop: css.backdropFilter, animation: css.animationName };
  }));
  for (const decoration of decorations) expect(decoration).toEqual({ shadow: 'none', textShadow: 'none', backdrop: 'none', animation: 'none' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
