import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import type { FileContent, FileTrashPage, UiState, Workspace } from '../../shared/types';

const headers = { 'X-Codex-Workspace': '1' };
const password = process.env.PLAYWRIGHT_PASSWORD || 'browser-test-workspace-password';
const retention = 30 * 24 * 60 * 60 * 1000;

async function signIn(page: Page) {
  expect((await page.request.post('/api/session', { headers, data: { password } })).status()).toBe(200);
}

async function writeNewFile(page: Page, workspace: Workspace, path: string, content: string) {
  expect((await page.request.post(`/api/workspaces/${workspace.id}/files`, { headers, data: { path, kind: 'file' } })).status()).toBe(201);
  expect((await page.request.put(`/api/workspaces/${workspace.id}/file`, { headers, data: { path, content } })).ok()).toBe(true);
}

async function create(page: Page, label: string, files: Record<string, string>) {
  const response = await page.request.post('/api/workspaces', { headers, data: { name: `File trash ${label} ${Date.now()}`, initializeGit: false } });
  expect(response.status()).toBe(201);
  const workspace = await response.json() as Workspace;
  await writeNewFile(page, workspace, 'keep.ts', 'export const kept = "saved";');
  for (const [path, content] of Object.entries(files)) {
    await writeNewFile(page, workspace, path, content);
    expect((await page.request.delete(`/api/workspaces/${workspace.id}/file`, { headers, params: { path } })).ok()).toBe(true);
  }
  return workspace;
}

async function start(page: Page, workspace: Workspace, clock?: Date) {
  expect((await page.request.patch(`/api/workspaces/${workspace.id}`, { headers, data: { active: true } })).ok()).toBe(true);
  const width = page.viewportSize()!.width;
  const profile = width >= 1360 ? 'desktop' : width >= 1000 ? 'laptop' : width >= 680 ? 'tablet' : 'mobile';
  const state = await (await page.request.get('/api/ui-state')).json() as UiState;
  expect((await page.request.patch('/api/ui-state', { headers, data: { revision: state.revision, changes: [
    { section: 'layout', profile, key: 'view', value: 'editor' },
    { section: 'layout', profile, key: 'split', value: 'focus' },
  ] } })).ok()).toBe(true);
  if (clock) await page.clock.install({ time: clock });
  await page.goto('/work');
  await expect(page.locator('.topbar-workspace')).toHaveText(workspace.name);
  await expect(page.locator('#editor-workbench .editor-panel')).toBeVisible();
}

async function readTrashPage(page: Page, workspace: Workspace, cursor?: string) {
  const response = await page.request.get(`/api/workspaces/${workspace.id}/trash/page`, { params: { limit: '25', ...(cursor ? { cursor } : {}) } });
  expect(response.ok()).toBe(true);
  return response.json() as Promise<FileTrashPage>;
}

async function entries(page: Page, workspace: Workspace) {
  return (await readTrashPage(page, workspace)).items;
}

async function contents(page: Page, workspace: Workspace, path: string) {
  const response = await page.request.get(`/api/workspaces/${workspace.id}/file`, { params: { path } });
  expect(response.ok()).toBe(true);
  return (await response.json() as FileContent).content;
}

async function openTrash(page: Page) {
  await page.locator('#editor-workbench').getByRole('button', { name: 'Recently deleted', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Recently deleted', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

const row = (dialog: Locator, path: string) => dialog.locator('.editor-trash-entry').filter({ has: dialog.page().getByText(path, { exact: true }) });

async function switchWorkspace(page: Page, workspace: Workspace) {
  await page.locator('.topbar-workspace').click();
  const dialog = page.getByRole('dialog', { name: 'Your workspaces', exact: true });
  const search = dialog.getByLabel('Find a workspace', { exact: true });
  if (await search.count()) await search.fill(workspace.name);
  await dialog.locator('.workspace-select').filter({ hasText: workspace.name }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.topbar-workspace')).toHaveText(workspace.name);
}

async function lockAndUnlock(page: Page) {
  // Exercise the same authenticated-session expiry event that closes active dialogs.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('codex:session-expired')));
  await expect(page.getByLabel('Workspace password', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Recently deleted', exact: true })).toHaveCount(0);
  await page.getByLabel('Workspace password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('#editor-workbench .editor-panel')).toBeVisible();
}

test('Recently deleted shows real deadlines and keeps healthy files restorable through slow or failed cleanup checks', async ({ page }) => {
  await signIn(page);
  const workspace = await create(page, 'cleanup status', { 'healthy.txt': 'Exact recovered contents', 'remaining.txt': 'Still recoverable' });
  const savedEntries = await entries(page, workspace);
  const healthy = savedEntries.find(entry => entry.path === 'healthy.txt')!;
  expect(Date.parse(healthy.expiresAt) - Date.parse(healthy.deletedAt)).toBe(retention);
  expect(Date.parse(healthy.expiresAt)).toBeGreaterThan(Date.now());
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let result: 'warning' | 'failure' | 'ok' = 'warning';
  const statusUrl = `**/api/workspaces/${workspace.id}/trash-status`;
  await page.route(statusUrl, async route => {
    await gate;
    if (result === 'failure') return route.fulfill({ status: 503, json: { error: 'Cleanup status is temporarily unavailable.' } });
    await route.fulfill({ json: { issue: result === 'warning' ? 'One expired item could not be removed. Other deleted files remain available.' : null } });
  });
  try {
    await start(page, workspace);
    const dialog = await openTrash(page);
    const healthyRow = row(dialog, 'healthy.txt');
    await expect(dialog).toContainText('permanently deleted after 30 days');
    await expect(healthyRow.getByRole('button', { name: 'Restore', exact: true })).toBeEnabled();
    await expect(healthyRow.locator('.editor-trash-expiry')).toContainText('Permanently deleted on');
    await expect(healthyRow.locator('.editor-trash-expiry time')).toHaveAttribute('datetime', healthy.expiresAt);
    await expect(dialog.getByRole('status').filter({ hasText: 'Checking automatic cleanup' })).toBeVisible();
    release();
    const warning = dialog.locator('.editor-trash-warning');
    await expect(warning).toContainText('One expired item could not be removed.');
    expect((await warning.boundingBox())!.y).toBeLessThan((await healthyRow.boundingBox())!.y);
    await expect(healthyRow.getByRole('button', { name: 'Restore', exact: true })).toBeEnabled();

    result = 'failure';
    await warning.getByRole('button', { name: 'Retry cleanup status', exact: true }).click();
    await expect(warning).toContainText('Could not check automatic cleanup');
    await expect(warning).toContainText('Cleanup status is temporarily unavailable.');
    await expect(healthyRow.getByRole('button', { name: 'Restore', exact: true })).toBeEnabled();
    result = 'ok';
    await warning.getByRole('button', { name: 'Retry cleanup status', exact: true }).click();
    await expect(warning).toHaveCount(0);
    await healthyRow.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(healthyRow).toHaveCount(0);
    expect(await contents(page, workspace, 'healthy.txt')).toBe('Exact recovered contents');
    await expect(row(dialog, 'remaining.txt').getByRole('button', { name: 'Restore', exact: true })).toBeEnabled();
  } finally { release(); await page.unroute(statusUrl); }
});

test('expiry disables Restore while Recently deleted stays open and server expiry errors remain visible', async ({ page }) => {
  await signIn(page);
  const workspace = await create(page, 'expiry clock', { 'expired.txt': 'Past recovery window', 'soon.txt': 'Deadline passes while open', 'server.txt': 'Server decides expiry' });
  const savedPage = await readTrashPage(page, workspace);
  const savedEntries = savedPage.items;
  const now = Date.now();
  const expiredAt = new Date(now - 60_000).toISOString();
  const soonAt = new Date(now + 60_000).toISOString();
  const serverAt = new Date(now + 24 * 60 * 60 * 1000).toISOString();
  const deadlines: Record<string, string> = { 'expired.txt': expiredAt, 'soon.txt': soonAt, 'server.txt': serverAt };
  const restored: string[] = [];
  await page.route(`**/api/workspaces/${workspace.id}/trash/page?*`, route => route.fulfill({ json: {
    ...savedPage,
    items: savedEntries.filter(entry => !restored.includes(entry.id)).map(entry => ({ ...entry, expiresAt: deadlines[entry.path], deletedAt: new Date(Date.parse(deadlines[entry.path]) - retention).toISOString() })),
  } }));
  await page.route(`**/api/workspaces/${workspace.id}/restore`, route => {
    restored.push(route.request().postDataJSON().trashId);
    return route.fulfill({ status: 410, json: { code: 'FILE_TRASH_EXPIRED', error: 'This file trash entry has reached its 30-day expiry and cannot be restored.' } });
  });
  await start(page, workspace, new Date(now));
  const dialog = await openTrash(page);
  await expect(row(dialog, 'expired.txt').getByRole('button', { name: 'Restore', exact: true })).toBeDisabled();
  await expect(row(dialog, 'expired.txt').locator('.editor-trash-expiry')).toContainText('Expired on');
  await expect(row(dialog, 'expired.txt').locator('.editor-trash-expiry time')).toHaveAttribute('datetime', expiredAt);
  const soon = row(dialog, 'soon.txt');
  await expect(soon.getByRole('button', { name: 'Restore', exact: true })).toBeEnabled();
  await page.clock.fastForward(61_000);
  await expect(soon.getByRole('button', { name: 'Restore', exact: true })).toBeDisabled();
  await expect(soon.locator('.editor-trash-expiry')).toContainText('Expired on');
  expect(restored).toEqual([]);
  await row(dialog, 'server.txt').getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('has reached its 30-day expiry');
  await expect(row(dialog, 'server.txt')).toHaveCount(0);
  expect(restored).toEqual([savedEntries.find(entry => entry.path === 'server.txt')!.id]);
  expect((await page.request.get(`/api/workspaces/${workspace.id}/file`, { params: { path: 'server.txt' } })).status()).toBe(404);
});

test('restore conflicts preserve the current saved file and its unsaved editor buffer', async ({ page }) => {
  await signIn(page);
  const workspace = await create(page, 'conflict', { 'recover.ts': 'export const version = "deleted saved file";' });
  const original = (await entries(page, workspace))[0];
  const replacement = 'export const version = "replacement on disk";';
  const dirty = 'export const version = "unsaved replacement buffer";';
  await writeNewFile(page, workspace, 'recover.ts', replacement);
  await start(page, workspace);
  const editor = page.locator('#editor-workbench');
  await editor.getByRole('treeitem', { name: 'recover.ts', exact: true }).click();
  const input = editor.locator('.monaco-editor textarea.inputarea').first();
  await expect(input).toBeVisible();
  await input.focus(); await page.keyboard.press('ControlOrMeta+KeyA'); await page.keyboard.insertText(dirty);
  const dialog = await openTrash(page);
  const rejected = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/workspaces/${workspace.id}/restore`));
  await row(dialog, 'recover.ts').getByRole('button', { name: 'Restore', exact: true }).click();
  expect((await rejected).status()).toBe(409);
  await expect(dialog.getByRole('alert')).toContainText('A file already exists at the original path.');
  await expect(row(dialog, 'recover.ts').getByRole('button', { name: 'Restore', exact: true })).toBeEnabled();
  expect(await contents(page, workspace, 'recover.ts')).toBe(replacement);
  expect((await entries(page, workspace)).some(entry => entry.id === original.id)).toBe(true);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(editor.locator('.view-lines').first()).toContainText('unsaved replacement buffer');
  await expect(page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
});

test('Recently deleted pages real files with bounded rows, usable sparse pages and recovery after failure or lock', async ({ page }) => {
  await signIn(page);
  const files = Object.fromEntries(Array.from({ length: 27 }, (_, index) => [`deleted-${String(index).padStart(2, '0')}.txt`, `Exact saved contents ${index}`]));
  const workspace = await create(page, 'bounded pages', files);
  const pageUrl = `**/api/workspaces/${workspace.id}/trash/page?*`;
  let sparseFirst = true;
  let failNext = false;
  let staleNext = false;
  let holdNext = false;
  let heldStarted = false;
  let heldFinished = false;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requests: Array<{ limit: string | null; cursor: string | null }> = [];
  let legacyReads = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === `/api/workspaces/${workspace.id}/trash`) legacyReads += 1; });
  await page.route(pageUrl, async route => {
    const query = new URL(route.request().url()).searchParams;
    const cursor = query.get('cursor');
    requests.push({ limit: query.get('limit'), cursor });
    if (cursor && failNext) {
      failNext = false;
      return route.fulfill({ status: 503, json: { error: 'The next trash page is temporarily unavailable.' } });
    }
    if (cursor && staleNext) {
      staleNext = false;
      return route.fulfill({ status: 409, json: { code: 'FILE_TRASH_CURSOR_STALE', error: 'The deleted file list changed.' } });
    }
    const response = await route.fetch();
    const body = await response.json() as FileTrashPage;
    if (!cursor && sparseFirst) {
      sparseFirst = false;
      return route.fulfill({ response, json: { ...body, items: [], unavailable: body.scanned } });
    }
    if (cursor && holdNext) {
      holdNext = false;
      heldStarted = true;
      await gate;
      try { await route.fulfill({ response, json: { ...body, items: body.items.map(entry => ({ ...entry, path: 'stale-page-after-lock.txt' })) } }); }
      catch { /* The old page request is expected to be cancelled when locking. */ }
      heldFinished = true;
      return;
    }
    await route.fulfill({ response });
  });
  try {
    await start(page, workspace);
    let dialog = await openTrash(page);
    const navigation = () => dialog.getByRole('navigation', { name: 'Deleted file pages', exact: true });
    const renderedPaths = () => dialog.locator('.editor-trash-entry strong').allTextContents();
    await expect(dialog).toContainText('No recoverable files on this page');
    await expect(dialog).not.toContainText('Nothing in the trash');
    await expect(dialog.locator('.editor-trash-page-note')).toContainText('could not be read');
    await expect(navigation().getByRole('button', { name: 'Next trash page', exact: true })).toBeEnabled();
    await navigation().getByRole('button', { name: 'Next trash page', exact: true }).click();
    await expect(dialog.locator('.editor-trash-entry')).toHaveCount(2);
    const secondPaths = await renderedPaths();
    await expect(navigation().getByRole('button', { name: 'Next trash page', exact: true })).toBeDisabled();
    await navigation().getByRole('button', { name: 'Previous trash page', exact: true }).click();
    await expect(dialog.locator('.editor-trash-entry')).toHaveCount(25);
    const firstPaths = await renderedPaths();
    expect(new Set([...firstPaths, ...secondPaths])).toEqual(new Set(Object.keys(files)));
    await expect(navigation().getByRole('button', { name: 'Previous trash page', exact: true })).toBeDisabled();

    failNext = true;
    await navigation().getByRole('button', { name: 'Next trash page', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('The next trash page is temporarily unavailable.');
    expect(await renderedPaths()).toEqual(firstPaths);
    await expect(dialog.locator('.editor-trash-entry')).toHaveCount(25);
    await dialog.getByRole('button', { name: 'Retry loading deleted files', exact: true }).click();
    await expect(dialog.locator('.editor-trash-entry')).toHaveCount(2);
    expect(await renderedPaths()).toEqual(secondPaths);
    await expect(navigation().locator('.editor-trash-page-caption')).toHaveText('Page 2');

    const recoveredPath = secondPaths[0];
    await row(dialog, recoveredPath).getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(row(dialog, recoveredPath)).toHaveCount(0);
    expect(await contents(page, workspace, recoveredPath)).toBe(files[recoveredPath]);
    await expect(navigation().locator('.editor-trash-page-caption')).toHaveText('Page 1');
    await expect(dialog.locator('.editor-trash-entry')).toHaveCount(25);
    await navigation().getByRole('button', { name: 'Next trash page', exact: true }).click();
    await expect(dialog.locator('.editor-trash-entry')).toHaveCount(1);
    await expect(row(dialog, recoveredPath)).toHaveCount(0);
    await navigation().getByRole('button', { name: 'Previous trash page', exact: true }).click();
    await expect(dialog.locator('.editor-trash-entry')).toHaveCount(25);

    staleNext = true;
    await navigation().getByRole('button', { name: 'Next trash page', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Start from the first page to continue.');
    await expect(navigation().getByRole('button', { name: 'Next trash page', exact: true })).toBeDisabled();
    await expect(dialog.locator('.editor-trash-entry')).toHaveCount(25);
    await dialog.getByRole('button', { name: 'Reload deleted files from first page', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(navigation().locator('.editor-trash-page-caption')).toHaveText('Page 1');

    holdNext = true;
    await navigation().getByRole('button', { name: 'Next trash page', exact: true }).click();
    await expect.poll(() => heldStarted).toBe(true);
    await lockAndUnlock(page);
    dialog = await openTrash(page);
    await expect(dialog.locator('.editor-trash-entry')).toHaveCount(25);
    await expect(navigation().locator('.editor-trash-page-caption')).toHaveText('Page 1');
    await expect(navigation().getByRole('button', { name: 'Previous trash page', exact: true })).toBeDisabled();
    release();
    await expect.poll(() => heldFinished).toBe(true);
    await expect(row(dialog, 'stale-page-after-lock.txt')).toHaveCount(0);
    await expect(dialog.locator('.editor-trash-entry')).toHaveCount(25);
    expect(requests.every(request => request.limit === '25')).toBe(true);
    expect(requests.some(request => request.cursor !== null)).toBe(true);
    expect(legacyReads).toBe(0);
  } finally { release(); await page.unroute(pageUrl); }
});

test('late trash reads and restore responses cannot cross workspace, unmount or lock boundaries', async ({ page }) => {
  await signIn(page);
  const first = await create(page, 'late first', { 'first-trash.txt': 'First workspace contents' });
  const second = await create(page, 'late second', { 'second-trash.txt': 'Second workspace contents' });
  await start(page, first);
  const firstEditor = await page.locator('#editor-workbench .editor-panel').elementHandle();
  const releases: Array<() => void> = [];
  const urls: string[] = [];
  const holdReads = async (workspace: Workspace, oldPath: string) => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    releases.push(release);
    const counts = { started: 0, finished: 0 };
    for (const suffix of ['trash/page', 'trash-status']) {
      const url = `**/api/workspaces/${workspace.id}/${suffix}${suffix === 'trash/page' ? '?*' : ''}`;
      urls.push(url);
      let seen = false;
      await page.route(url, async (route: Route) => {
        if (seen) return route.continue();
        seen = true;
        const response = await route.fetch();
        const body = suffix === 'trash/page' ? await response.json() as FileTrashPage : null;
        const late = body ? { ...body, items: body.items.map(entry => ({ ...entry, path: oldPath })) } : { issue: `Stale cleanup warning for ${oldPath}` };
        counts.started += 1;
        await gate;
        try { await route.fulfill({ response, json: late }); } catch { /* Cancellation is expected when the dialog loses its scope. */ }
        counts.finished += 1;
      });
    }
    return { counts, release };
  };
  try {
    const previousWorkspace = await holdReads(first, 'stale-first-workspace.txt');
    let dialog = await openTrash(page);
    await expect.poll(() => previousWorkspace.counts.started).toBe(2);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await switchWorkspace(page, second);
    expect(await firstEditor!.evaluate(element => element.isConnected)).toBe(false);
    dialog = await openTrash(page);
    await expect(row(dialog, 'second-trash.txt')).toBeVisible();
    previousWorkspace.release();
    await expect.poll(() => previousWorkspace.counts.finished).toBe(2);
    await expect(row(dialog, 'stale-first-workspace.txt')).toHaveCount(0);
    await expect(dialog.locator('.editor-trash-warning')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();

    const beforeLock = await holdReads(second, 'stale-before-lock.txt');
    await openTrash(page);
    await expect.poll(() => beforeLock.counts.started).toBe(2);
    await lockAndUnlock(page);
    dialog = await openTrash(page);
    await expect(row(dialog, 'second-trash.txt')).toBeVisible();
    beforeLock.release();
    await expect.poll(() => beforeLock.counts.finished).toBe(2);
    await expect(row(dialog, 'stale-before-lock.txt')).toHaveCount(0);
    await expect(dialog.locator('.editor-trash-warning')).toHaveCount(0);

    let releaseRestore!: () => void;
    const gate = new Promise<void>(resolve => { releaseRestore = resolve; });
    releases.push(releaseRestore);
    let restoreStarted = false;
    let restoreFinished = false;
    const restoreUrl = `**/api/workspaces/${second.id}/restore`;
    urls.push(restoreUrl);
    await page.route(restoreUrl, async route => {
      const response = await route.fetch();
      restoreStarted = true;
      await gate;
      try { await route.fulfill({ response }); } catch { /* The lock aborts the client request after the server mutation. */ }
      restoreFinished = true;
    });
    await row(dialog, 'second-trash.txt').getByRole('button', { name: 'Restore', exact: true }).click();
    await expect.poll(() => restoreStarted).toBe(true);
    expect(await contents(page, second, 'second-trash.txt')).toBe('Second workspace contents');
    await lockAndUnlock(page);
    dialog = await openTrash(page);
    await expect(dialog).toContainText('Nothing in the trash');
    releaseRestore();
    await expect.poll(() => restoreFinished).toBe(true);
    await expect(dialog).toContainText('Nothing in the trash');
    await expect(page.locator('.toast-stack')).not.toContainText('Restored second-trash.txt.');
    await expect(page.locator('.topbar-workspace')).toHaveText(second.name);
  } finally {
    for (const release of releases) release();
    for (const url of urls) await page.unroute(url);
  }
});
