import { expect, test, type Page } from '@playwright/test';
import { build, stop } from 'esbuild';
import { fileURLToPath } from 'node:url';
import type { WorkspaceUploadProgress } from '../../client/uploads';
import type { UploadProgressFixture } from './fixtures/upload-progress-windowing';

// Browser routes serve a component fixture without starting an HTTP listener.
// Actual upload transport remains covered by uploads.spec.ts and uploader tests.
const origin = 'https://upload-progress.fixture.test';
type FixtureWindow = Window & { uploadProgressFixture: UploadProgressFixture };
let script = '', styles = '';

test.beforeAll(async () => {
  try {
    const bundle = await build({
      absWorkingDir: fileURLToPath(new URL('../..', import.meta.url)),
      entryPoints: ['tests/e2e/fixtures/upload-progress-windowing.tsx'],
      bundle: true, write: false, outfile: 'upload-progress-windowing-fixture.js',
      platform: 'browser', format: 'iife', target: 'es2022', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent',
    });
    script = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
    styles = bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text
      + '\nhtml,body,#root{height:auto;min-height:100%;overflow:auto}.upload-window-fixture{width:min(320px,100%);margin:16px auto}.upload-window-fixture>p{padding:8px;font-size:12px}.fixture-focus-target{min-height:44px;padding:8px}';
  } finally { stop(); }
});

const fileName = (index: number) => `file-${String(index).padStart(4, '0')}.txt`;
function plan(count = 1000, current = 0, batch = 'batch-a'): WorkspaceUploadProgress[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${batch}:${index}`, index, fileName: fileName(index), path: `selected-folder/${fileName(index)}`, size: 100,
    stage: index < current ? 'ready' : index === current ? 'importing' : 'queued',
    bytesUploaded: index <= current ? 100 : 0, bytesImported: index < current ? 100 : index === current ? 25 : 0,
  }));
}
async function mount(page: Page, files = plan()) {
  const unexpected: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(files => { Object.assign(window, { uploadProgressInitialFiles: files }); }, files);
  await page.route(origin + '/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en" data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>' });
    if (path === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: script });
    if (path === '/fixture.css') return route.fulfill({ contentType: 'text/css', body: styles });
    if (path !== '/favicon.ico') unexpected.push(path);
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(origin);
  await expect(progress(page)).toBeVisible();
  await expect.poll(() => rows(page).count()).toBeLessThan(25);
  return { unexpected, errors };
}
const progress = (page: Page) => page.getByRole('region', { name: 'File uploads', exact: true });
const list = (page: Page) => progress(page).getByRole('list', { name: 'Upload files', exact: true });
const rows = (page: Page) => list(page).getByRole('listitem');
const row = (page: Page, index: number) => list(page).getByRole('listitem', { name: `Upload ${fileName(index)}`, exact: true });
const summary = (page: Page) => progress(page).locator('.workspace-upload-summary');
const state = (page: Page) => page.evaluate(() => (window as unknown as FixtureWindow).uploadProgressFixture.state());
const replace = (page: Page, files: WorkspaceUploadProgress[]) => page.evaluate(files => (window as unknown as FixtureWindow).uploadProgressFixture.replace(files), files);
const patch = (page: Page, id: string, value: Partial<WorkspaceUploadProgress>) => page.evaluate(({ id, value }) => (window as unknown as FixtureWindow).uploadProgressFixture.patch(id, value), { id, value });

test('a thousand-file plan scrolls with bounded DOM and cancellation retains every real outcome', async ({ page }) => {
  const files = plan().map(file => ({ ...file, stage: 'queued' as const, bytesUploaded: 0, bytesImported: 0 }));
  const observed = await mount(page, files);
  await expect(summary(page)).toHaveText('0 of 1000 saved · 1000 waiting');
  await expect(row(page, 0)).toHaveAttribute('aria-posinset', '1');
  await expect(row(page, 0)).toHaveAttribute('aria-setsize', '1000');
  await list(page).evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(row(page, 999)).toBeInViewport();
  await expect(row(page, 0)).toHaveCount(0);
  await expect.poll(() => rows(page).count()).toBeLessThan(25);
  expect(await state(page)).toMatchObject({ total: 1000, immutable: true, ready: 0, cancelled: 0 });

  await progress(page).getByRole('button', { name: 'Cancel uploads', exact: true }).click();
  expect((await state(page)).cancelEvents).toEqual([{ batch: 'batch-a:0', total: 1000, active: 1000 }]);
  await expect(summary(page)).toHaveText('0 of 1000 saved · 1000 waiting');
  await replace(page, files.map((file, index) => ({ ...file, stage: index === 0 ? 'cancelling' : 'cancelled' })));
  await expect(progress(page).getByRole('button', { name: 'Cancel uploads', exact: true })).toBeDisabled();
  await expect(summary(page)).toHaveText('0 of 1000 saved · 1 in progress · 999 cancelled');
  await replace(page, files.map(file => ({ ...file, stage: 'cancelled' })));
  await expect(summary(page)).toHaveText('0 of 1000 saved · 1000 cancelled');
  await expect(progress(page).getByText('Saved to workspace', { exact: true })).toHaveCount(0);
  await expect(progress(page).getByRole('button', { name: 'Cancel uploads', exact: true })).toHaveCount(0);
  await expect.poll(() => rows(page).count()).toBeLessThan(25);
  expect(await state(page)).toMatchObject({ total: 1000, immutable: true, ready: 0, cancelled: 1000 });
  await progress(page).getByRole('button', { name: 'Dismiss uploads', exact: true }).click();
  await expect(progress(page)).toHaveCount(0);
  expect((await state(page)).dismissEvents).toBe(1);
  expect(observed).toEqual({ unexpected: [], errors: [] });
});

test('current transfer updates stay accurate while keyboard focus and text selection survive scrolling', async ({ page }) => {
  const observed = await mount(page, plan(1000, 300));
  await expect(row(page, 300)).toBeInViewport();
  const meter = row(page, 300).getByRole('progressbar', { name: `Saving to workspace: ${fileName(300)}`, exact: true });
  await expect(meter).toHaveAttribute('aria-valuenow', '25');
  await patch(page, 'batch-a:300', { bytesImported: 100 });
  await expect(meter).toHaveAttribute('aria-valuenow', '100');
  await expect(row(page, 300).getByText('Saved to workspace', { exact: true })).toHaveCount(0);
  await expect(summary(page)).toHaveText('300 of 1000 saved · 699 waiting · 1 in progress');

  await list(page).focus();
  await page.keyboard.press('Home');
  await expect(row(page, 0)).toBeFocused();
  await expect(row(page, 0)).toBeInViewport();
  await list(page).evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(row(page, 999)).toBeInViewport();
  await expect(row(page, 0)).toBeFocused();
  await expect(row(page, 0)).not.toBeInViewport();
  await replace(page, plan(1000, 301));
  await expect(summary(page)).toHaveText('301 of 1000 saved · 698 waiting · 1 in progress');
  await expect(row(page, 0)).toBeFocused();
  await expect(row(page, 999)).toBeInViewport();
  await progress(page).getByRole('button', { name: 'Show active upload', exact: true }).click();
  await expect(row(page, 301)).toBeInViewport();
  await expect(row(page, 301)).toHaveClass(/is-selected/);
  await expect(row(page, 301)).toHaveAttribute('aria-current', 'true');
  await row(page, 301).focus();
  await row(page, 301).locator('strong').evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    const selected = window.getSelection()!; selected.removeAllRanges(); selected.addRange(range);
  });
  await page.getByRole('button', { name: 'Fixture focus target', exact: true }).focus();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(fileName(301));
  await list(page).evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(row(page, 999)).toBeInViewport();
  await expect(row(page, 301)).toHaveCount(1);
  await expect(row(page, 301)).not.toBeInViewport();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(fileName(301));
  await expect.poll(() => rows(page).count()).toBeLessThan(25);
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await expect(row(page, 301)).toHaveCount(0);
  expect(await state(page)).toMatchObject({ total: 1000, immutable: true, ready: 301 });
  expect(observed).toEqual({ unexpected: [], errors: [] });
});

test('phone navigation reveals offscreen problems and resets cleanly for a different batch', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 850 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const files = plan(1000, 500);
  files[750] = { ...files[750], stage: 'failed', error: 'A file already exists at this path. Rename the selected file before trying again; the existing workspace file has been kept.' };
  files[751] = { ...files[751], stage: 'unconfirmed', error: 'Refresh the destination folder before retrying. The server has not confirmed the save.' };
  files[752] = { ...files[752], stage: 'cancelled' };
  const observed = await mount(page, files);
  await expect(row(page, 500)).toBeInViewport();
  await expect(summary(page)).toHaveText('500 of 1000 saved · 496 waiting · 1 in progress · 1 failed · 1 not confirmed · 1 cancelled');
  expect(await progress(page).evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  for (const name of ['Show active upload', 'Cancel uploads', 'Show upload problem']) {
    const bounds = await progress(page).getByRole('button', { name, exact: true }).boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
  }
  await progress(page).getByRole('button', { name: 'Show upload problem', exact: true }).click();
  await expect(row(page, 750)).toBeFocused();
  await expect(row(page, 750)).toBeInViewport();
  await expect(row(page, 750).getByRole('alert')).toHaveText(files[750].error!);
  await page.keyboard.press('ArrowDown');
  await expect(row(page, 751)).toBeFocused();
  await expect(row(page, 751)).toBeInViewport();
  await expect(row(page, 751).getByText('Save not confirmed', { exact: true })).toBeVisible();
  await page.keyboard.press('End');
  await expect(row(page, 999)).toBeFocused();
  await expect(row(page, 999)).toBeInViewport();
  expect(await list(page).evaluate(element => element.clientHeight <= 240)).toBe(true);
  expect(await progress(page).evaluate(element => [element, ...element.querySelectorAll('*')].every(node => {
    const style = getComputedStyle(node); return style.animationName === 'none' && style.boxShadow === 'none' && style.textShadow === 'none' && style.backdropFilter === 'none';
  }))).toBe(true);

  await page.evaluate(() => (window as unknown as FixtureWindow).uploadProgressFixture.setVisible(false));
  await expect(progress(page)).toBeHidden();
  await replace(page, plan(1000, 20, 'batch-b'));
  await page.evaluate(() => (window as unknown as FixtureWindow).uploadProgressFixture.setVisible(true));
  await expect(row(page, 20)).toBeInViewport();
  await expect(row(page, 20)).toHaveAttribute('data-upload-key', 'batch-b:20');
  await expect(row(page, 20)).toHaveClass(/is-selected/);
  await expect(list(page).locator('[data-upload-key^="batch-a:"]')).toHaveCount(0);
  await expect.poll(() => rows(page).count()).toBeLessThan(25);
  expect(await state(page)).toMatchObject({ total: 1000, immutable: true, ready: 20, cancelEvents: [] });
  expect(observed).toEqual({ unexpected: [], errors: [] });
});
