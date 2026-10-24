import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import type { DownloadJob, GeneratedImageMetadata, ToolActivity } from '../../shared/types';
import type { GeneratedImageScope } from '../../client/components/chat/GeneratedImageCard';

// Isolated UI/transport proofs only. Real generation, immutable storage, native
// byte inspection and create-only filesystem behavior have server tests. The
// actual Monaco bridge is exercised in generated-images-editor.spec.ts.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jgZkAAAAASUVORK5CYII=', 'base64');
const image: GeneratedImageMetadata = { id: `img_${'a'.repeat(64)}`, sha256: 'b'.repeat(64), workspaceId: 'image-workspace', threadId: 'image-owner', messageId: 'image-message', runId: 'image-run', itemId: 'ig_fixture',
  state: 'completed', mimeType: 'image/png', bytes: png.length, width: 1, height: 1, createdAt: '2026-09-20T12:00:00.000Z', revisedPrompt: 'A small white circle on a dark background.',
  previewUrl: `/api/workspaces/image-workspace/generated-images/img_${'a'.repeat(64)}/content?sha256=${'b'.repeat(64)}` };
const scope: GeneratedImageScope = { workspaceId: image.workspaceId, threadId: 'image-explicit-fork', locked: false, executionBlocked: false };
const activity: ToolActivity = { id: 'image-activity', name: 'generate_image', input: '{"prompt":"Draw a circle."}', output: '{"status":"completed","notice":"The image is saved."}', generatedImage: image, status: 'completed', startedAt: image.createdAt };
interface Props { image: GeneratedImageMetadata; scope?: GeneratedImageScope; status?: ToolActivity['status']; hidden?: boolean; paneWidth?: number }
interface FixtureWindow extends Window {
  __generatedImageUI: {
    render(props: Props): void;
    notifications: Array<{ message: string; kind?: string }>;
    dirty: Record<string, string[]>;
    frozen: Record<string, boolean>;
    refreshed: string[];
    fetched: Array<{ url: string; credentials?: RequestCredentials }>;
    lock(): void;
    unlock(): void;
  };
}
type SaveMode = 'complete' | 'exists' | 'lost' | 'foreign';
interface Gate { started: boolean; release(): void; wait: Promise<void> }
let script = '', styles = '';

test.beforeAll(async () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const output = await build({ absWorkingDir: root, stdin: { loader: 'tsx', resolveDir: root, contents: `
    import { createRoot } from 'react-dom/client';
    import { ActivityCard } from './client/components/chat/ActivityCard';
    import DownloadProgress from './client/components/DownloadProgress';
    import { registerWorkspaceRewindGuard } from './client/workspace-rewind-guard';
    import './client/styles.css';
    import './client/components/chat.css';
    import './client/scrollbars.css';
    const root = createRoot(document.getElementById('root'));
    const state = { notifications: [], dirty: {}, frozen: {}, refreshed: [], fetched: [] };
    for (const workspaceId of ['image-workspace', 'other-workspace']) {
      state.dirty[workspaceId] = [];
      const check = paths => {
        if (state.frozen[workspaceId]) throw new Error('Wait for the current file operation to finish.');
        if (state.dirty[workspaceId].some(dirty => paths.some(path => path === dirty || path.startsWith(dirty + '/') || dirty.startsWith(path + '/')))) throw new Error('Save or close the unsaved destination before copying this image.');
      };
      const acquire = paths => { check(paths); state.frozen[workspaceId] = true; return { release(options) { state.frozen[workspaceId] = false; if (options?.refresh) state.refreshed.push(workspaceId); } }; };
      registerWorkspaceRewindGuard(workspaceId, { read: () => ({ dirtyPaths: state.dirty[workspaceId] }), acquire: () => ({ ...acquire([]), dirtyPaths: state.dirty[workspaceId] }), readExternal: check, acquireExternal: acquire });
    }
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith('https://huggingface.co/buckets/')) { state.fetched.push({ url, credentials: init?.credentials }); return Promise.reject(new TypeError('Fixture: public bucket fetch blocked by browser policy')); }
      return realFetch(input, init);
    };
    window.__generatedImageUI = { ...state, render(props) {
      const activity = { ...${JSON.stringify(activity)}, generatedImage: props.image, status: props.status || 'completed' };
      root.render(<main className="generated-image-fixture" style={{maxWidth: props.paneWidth || 680}}>
        <p>Text before image activity.</p>
        {!props.hidden && <ActivityCard activity={activity} generatedImageScope={props.scope} onNotify={(message, kind) => state.notifications.push({ message, kind })} />}
        <p>Text after image activity.</p><button type="button">After image</button>
        <DownloadProgress active={!props.scope?.locked} />
      </main>);
    }, lock() { document.body.dataset.workspaceLocked = 'true'; window.dispatchEvent(new CustomEvent('codex:session-locked')); },
    unlock() { document.body.dataset.workspaceLocked = 'false'; window.dispatchEvent(new CustomEvent('codex:session-unlocked')); } };
  ` }, bundle: true, write: false, outfile: 'generated-images-fixture.js', format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent' });
  script = output.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  styles = output.outputFiles.find(file => file.path.endsWith('.css'))!.text + '\n#root{overflow:auto}.generated-image-fixture{width:100%;padding:16px;margin:12px auto}.generated-image-fixture>p{margin:12px 0}.generated-image-fixture>button{min-height:44px;padding:8px}';
});

async function update(page: Page, props: Partial<Props> = {}) {
  await page.evaluate(value => (window as unknown as FixtureWindow).__generatedImageUI.render(value), { image, scope, ...props });
}

async function mount(page: Page, options: { previewFailure?: boolean; previewHeld?: boolean } = {}) {
  const calls: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
  const previewRequests: string[] = [];
  let previewFailure = !!options.previewFailure, saveMode: SaveMode = 'complete';
  let nextGate: Gate | undefined;
  const gates: Gate[] = [];
  function gate(): Gate {
    let release!: () => void;
    const value = { started: false, release: () => release(), wait: new Promise<void>(resolve => { release = resolve; }) };
    gates.push(value); return value;
  }
  const previewGate = options.previewHeld ? gate() : undefined;
  const fileName = `generated-image-${image.id.slice(4, 16)}.png`;
  const jobId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const bucketUrl = `https://huggingface.co/buckets/alvin3y12/codex-downloads/resolve/exports/${jobId}/${fileName}?download=true`;
  await page.context().route('https://huggingface.co/buckets/alvin3y12/codex-downloads/resolve/**', route => route.fulfill({ status: 200, contentType: 'image/png', headers: { 'content-disposition': `attachment; filename="${fileName}"` }, body: png }));
  await page.route('https://generated-image.test/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' });
    if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204, body: '' });
    if (url.pathname.endsWith('/content')) {
      previewRequests.push(request.url());
      if (previewGate) { previewGate.started = true; await previewGate.wait; }
      return previewFailure ? route.fulfill({ status: 403, json: { error: 'Preview unavailable.' } }) : route.fulfill({ contentType: 'image/png', body: png });
    }
    const body = request.postData() ? request.postDataJSON() as Record<string, unknown> : undefined;
    calls.push({ method: request.method(), path: url.pathname, body });
    if (url.pathname.endsWith('/save') && body) {
      const pending = nextGate; nextGate = undefined;
      const mode = saveMode; saveMode = 'complete';
      if (pending) { pending.started = true; await pending.wait; }
      if (mode === 'lost') return route.abort('failed');
      if (mode === 'exists') return route.fulfill({ status: 409, json: { error: 'A file already exists at this path. Choose a new name.', code: 'FILE_EXISTS' } });
      const path = mode === 'foreign' ? 'unrequested.png' : String(body.path);
      return route.fulfill({ status: 201, json: { image, path, version: image.sha256, entry: { path, name: path.split('/').at(-1), kind: 'file', size: image.bytes } } });
    }
    if (url.pathname.endsWith('/download')) {
      const job: DownloadJob = { id: jobId, workspaceId: image.workspaceId, fileName, path: fileName, mimeType: 'image/png', size: image.bytes,
        state: 'ready', bytesProcessed: image.bytes, createdAt: image.createdAt, updatedAt: image.createdAt, uploadedAt: image.createdAt,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(), version: image.sha256, url: bucketUrl, source: { type: 'generated_image', id: image.id, sha256: image.sha256 } };
      return route.fulfill({ status: 202, json: job });
    }
    return route.fulfill({ status: 404, json: { error: `Unexpected generated-image fixture route: ${url.pathname}` } });
  });
  await page.goto('https://generated-image.test/');
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: script });
  await update(page);
  return { calls, previewRequests, bucketUrl,
    preview: (failed: boolean) => { previewFailure = failed; },
    releasePreview: () => previewGate?.release(),
    failSave: (mode: SaveMode) => { saveMode = mode; },
    holdSave: () => { nextGate = gate(); return nextGate; },
    releaseAll: () => gates.forEach(value => value.release()),
  };
}

const saveDialog = (page: Page) => page.getByRole('dialog', { name: 'Save image to workspace', exact: true });
async function choosePath(page: Page, path: string) {
  await page.getByRole('button', { name: 'Save to workspace', exact: true }).click();
  const dialog = saveDialog(page);
  await dialog.getByRole('textbox', { name: 'Workspace file path', exact: true }).fill(path);
  return dialog;
}

test('authenticated preview exposes honest loading/failure/retry and keeps the activity between its surrounding text', async ({ page }) => {
  const fixture = await mount(page, { previewFailure: true, previewHeld: true });
  await expect(page.getByText('Loading image…', { exact: true })).toBeVisible();
  fixture.releasePreview();
  await expect(page.getByRole('alert')).toContainText('preview could not be loaded');
  fixture.preview(false);
  await page.getByRole('button', { name: 'Retry preview', exact: true }).click();
  await expect(page.locator('.cw-generated-image-preview')).toHaveClass(/is-ready/);
  await expect(page.getByRole('img')).toHaveAttribute('src', image.previewUrl);
  expect(fixture.previewRequests).toHaveLength(2);
  expect(fixture.previewRequests.every(url => url === `https://generated-image.test${image.previewUrl}`)).toBe(true);
  const text = await page.locator('main').innerText();
  expect(text.indexOf('Text before image')).toBeLessThan(text.indexOf('Download'));
  expect(text.indexOf('Save to workspace')).toBeLessThan(text.indexOf('Text after image'));
});

test('foreign metadata and running activities never request image bytes, and locking removes the completed preview', async ({ page }) => {
  const fixture = await mount(page);
  await expect(page.locator('.cw-generated-image-preview')).toHaveClass(/is-ready/);
  const before = fixture.previewRequests.length;
  await update(page, { image: { ...image, previewUrl: 'https://untrusted.example/image.png' } });
  await expect(page.getByRole('alert')).toContainText('could not be verified');
  await expect(page.locator('img')).toHaveCount(0);
  await update(page, { scope: { ...scope, workspaceId: 'other-workspace' } });
  await expect(page.locator('img')).toHaveCount(0);
  await update(page, { status: 'running' });
  await expect(page.locator('.chat-activity-summary')).toContainText('Generating image');
  await expect(page.locator('img')).toHaveCount(0);
  expect(fixture.previewRequests).toHaveLength(before);
  await update(page);
  await expect(page.getByRole('img')).toBeVisible();
  await page.evaluate(() => (window as unknown as FixtureWindow).__generatedImageUI.lock());
  await expect(page.locator('.cw-generated-image')).toHaveCount(0);
});

test('save is explicit, uses the original owner on a fork, and retains dirty buffers behind the real workspace registry', async ({ page }) => {
  const fixture = await mount(page);
  await page.evaluate(() => { (window as unknown as FixtureWindow).__generatedImageUI.dirty['image-workspace'] = ['images/circle.png']; });
  const dialog = await choosePath(page, 'images/circle.png');
  await dialog.getByRole('button', { name: 'Save image', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('unsaved destination');
  expect(fixture.calls).toEqual([]);
  await dialog.getByRole('textbox', { name: 'Workspace file path', exact: true }).fill('images/new-circle.png');
  const pending = fixture.holdSave();
  await dialog.getByRole('button', { name: 'Save image', exact: true }).click();
  await expect.poll(() => pending.started).toBe(true);
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).__generatedImageUI.frozen['image-workspace'])).toBe(true);
  expect(await page.evaluate(() => !!(window as unknown as FixtureWindow).__generatedImageUI.frozen['other-workspace'])).toBe(false);
  pending.release();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Saved to', { exact: false })).toContainText('images/new-circle.png');
  expect(fixture.calls).toEqual([{ method: 'POST', path: `/api/workspaces/${image.workspaceId}/generated-images/${image.id}/save`, body: { sha256: image.sha256, path: 'images/new-circle.png', threadId: image.threadId } }]);
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).__generatedImageUI.dirty['image-workspace'])).toEqual(['images/circle.png']);
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).__generatedImageUI.refreshed)).toEqual(['image-workspace']);
});

test('lost, conflicting and foreign save responses keep the chosen path and never imply success', async ({ page }) => {
  const fixture = await mount(page);
  for (const mode of ['exists', 'lost', 'foreign'] as const) {
    const path = `images/${mode}.png`;
    const dialog = await choosePath(page, path);
    fixture.failSave(mode);
    await dialog.getByRole('button', { name: 'Save image', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(mode === 'exists' ? 'already exists' : 'could not be confirmed');
    await expect(dialog.getByRole('textbox', { name: 'Workspace file path', exact: true })).toHaveValue(path);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await update(page, { hidden: true });
    await expect(page.locator('.cw-generated-image')).toHaveCount(0);
    await update(page);
    await page.getByRole('button', { name: 'Save to workspace', exact: true }).click();
    await expect(saveDialog(page).getByRole('textbox', { name: 'Workspace file path', exact: true })).toHaveValue(path);
    await saveDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  expect(fixture.calls).toHaveLength(3);
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).__generatedImageUI.notifications.filter(item => item.kind === 'success'))).toEqual([]);
  await expect(page.getByText(/^Saved to/)).toHaveCount(0);
});

test('workspace switches and locks fence late save receipts without affecting a different workspace', async ({ page }) => {
  const fixture = await mount(page);
  const dialog = await choosePath(page, 'images/original.png');
  const pending = fixture.holdSave();
  await dialog.getByRole('button', { name: 'Save image', exact: true }).click();
  await expect.poll(() => pending.started).toBe(true);
  const otherImage = { ...image, workspaceId: 'other-workspace', previewUrl: image.previewUrl.replace('image-workspace', 'other-workspace') };
  await update(page, { image: otherImage, scope: { ...scope, workspaceId: 'other-workspace', threadId: 'other-view' } });
  await expect(dialog).toBeHidden();
  pending.release();
  await expect.poll(() => page.evaluate(() => (window as unknown as FixtureWindow).__generatedImageUI.refreshed.length)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).__generatedImageUI.refreshed)).toEqual(['image-workspace']);
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).__generatedImageUI.notifications)).toEqual([]);
  await expect(page.getByText(/^Saved to/)).toHaveCount(0);
  await update(page);
  await expect(page.getByText(/^Saved to/)).toContainText('images/original.png');
  const lockDialog = await choosePath(page, 'images/before-lock.png');
  const locked = fixture.holdSave();
  await lockDialog.getByRole('button', { name: 'Save image', exact: true }).click();
  await expect.poll(() => locked.started).toBe(true);
  await page.evaluate(() => (window as unknown as FixtureWindow).__generatedImageUI.lock());
  locked.release();
  await expect.poll(() => page.evaluate(() => (window as unknown as FixtureWindow).__generatedImageUI.refreshed.length)).toBe(2);
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).__generatedImageUI.notifications)).toEqual([]);
  await expect(page.locator('img')).toHaveCount(0);
});

test('download uses the public job path and keeps a real native action when browser fetch is blocked', async ({ page }) => {
  const fixture = await mount(page);
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const tray = page.getByRole('complementary', { name: 'File downloads', exact: true });
  await expect(tray.getByText('Download requested', { exact: true })).toBeVisible();
  const link = tray.getByRole('link', { name: 'Download file', exact: true });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', fixture.bucketUrl);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(tray.getByText('File saved', { exact: true })).toHaveCount(0);
  expect(fixture.calls).toEqual([{ method: 'POST', path: `/api/workspaces/${image.workspaceId}/generated-images/${image.id}/download`, body: { sha256: image.sha256 } }]);
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).__generatedImageUI.fetched)).toEqual([{ url: fixture.bucketUrl, credentials: 'omit' }]);
  expect(fixture.calls.some(call => call.path.endsWith('/content'))).toBe(false);
});

test('keyboard, phone and split-pane layouts keep visible controls, bounded previews and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(page);
  for (const width of [1440, 1100, 768, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await update(page, { paneWidth: width > 1000 ? 380 : width });
    const card = page.locator('.cw-generated-image');
    await expect(card).toBeVisible();
    expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    for (const button of await card.getByRole('button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await card.locator('.cw-generated-image-preview').boundingBox())!.height).toBeLessThanOrEqual(width <= 600 ? 340 : 440);
    const save = page.getByRole('button', { name: 'Save to workspace', exact: true });
    await save.focus(); await page.keyboard.press('Enter');
    const dialog = saveDialog(page), input = dialog.getByRole('textbox', { name: 'Workspace file path', exact: true });
    await expect(input).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(save).toBeFocused();
    const style = await card.evaluate(element => ({ shadow: getComputedStyle(element).boxShadow, backdrop: getComputedStyle(element).backdropFilter }));
    expect(style).toEqual({ shadow: 'none', backdrop: 'none' });
  }
  await update(page, { scope: { ...scope, executionBlocked: true } });
  await expect(page.getByRole('button', { name: 'Save to workspace', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeEnabled();
});
