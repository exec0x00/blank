import { expect, test, type Page } from '@playwright/test';
import type { DirectoryPage, UiState, Workspace } from '../../shared/types';

const headers = { 'X-Codex-Workspace': '1' };
const password = process.env.PLAYWRIGHT_PASSWORD || 'browser-test-workspace-password';

async function prepare(page: Page) {
  expect((await page.request.post('/api/session', { headers, data: { password } })).ok()).toBe(true);
  const response = await page.request.post('/api/workspaces', { headers, data: { name: `Explorer pages ${Date.now()}`, initializeGit: false } });
  expect(response.status()).toBe(201);
  const workspace = await response.json() as Workspace;
  expect((await page.request.post(`/api/workspaces/${workspace.id}/files`, { headers, data: { path: 'many', kind: 'directory' } })).status()).toBe(201);
  const paths = Array.from({ length: 225 }, (_, index) => `many/file-${String(index).padStart(3, '0')}.txt`);
  for (let offset = 0; offset < paths.length; offset += 4) await Promise.all(paths.slice(offset, offset + 4).map(async path => {
    expect((await page.request.post(`/api/workspaces/${workspace.id}/files`, { headers, data: { path, kind: 'file' } })).status()).toBe(201);
  }));
  expect((await page.request.patch(`/api/workspaces/${workspace.id}`, { headers, data: { active: true } })).ok()).toBe(true);
  const width = page.viewportSize()!.width;
  const profile = width >= 1360 ? 'desktop' : width >= 1000 ? 'laptop' : width >= 680 ? 'tablet' : 'mobile';
  const state = await (await page.request.get('/api/ui-state')).json() as UiState;
  expect((await page.request.patch('/api/ui-state', { headers, data: { revision: state.revision, changes: [
    { section: 'layout', profile, key: 'view', value: 'editor' }, { section: 'layout', profile, key: 'split', value: 'focus' },
  ] } })).ok()).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/work');
  const editor = page.getByRole('region', { name: 'Code editor', exact: true });
  const tree = editor.getByRole('tree', { name: `${workspace.name} files`, exact: true });
  await expect(tree.getByRole('treeitem', { name: 'many', exact: true })).toBeVisible();
  return { workspace, paths, editor, tree };
}

test('large folders page on demand, reveal unseen files, window loaded rows and recover a changed cursor', async ({ page }) => {
  test.setTimeout(120_000);
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  const { workspace, paths, editor, tree } = await prepare(page);
  const continuationRequests: string[] = [];
  const wholeDirectoryRequests: string[] = [];
  const fileMutationRequests: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === `/api/workspaces/${workspace.id}/tree`) wholeDirectoryRequests.push(request.url());
    if (url.pathname === `/api/workspaces/${workspace.id}/tree-page` && url.searchParams.has('cursor')) continuationRequests.push(request.url());
    if (request.method() === 'POST' && /\/(?:uploads|files|rename)$/.test(url.pathname)) fileMutationRequests.push(request.url());
  });
  const firstResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === `/api/workspaces/${workspace.id}/tree-page` && url.searchParams.get('path') === 'many';
  });
  await tree.getByRole('treeitem', { name: 'many', exact: true }).click();
  const first = await (await firstResponse).json() as DirectoryPage;
  expect(first.entries).toHaveLength(100);
  await expect(tree.locator('[data-tree-path^="many/"]')).toHaveCount(100);
  await expect(tree.locator('[data-tree-path^="many/"]').first()).toHaveAttribute('aria-setsize', '-1');
  expect(continuationRequests).toHaveLength(0);

  const firstPaths = new Set(first.entries.map(entry => entry.path));
  const unseen = paths.find(path => !firstPaths.has(path))!;
  const name = unseen.split('/').at(-1)!;
  await page.locator('.app-topbar').getByRole('button', { name: 'Go to file', exact: true }).click();
  const quick = page.getByRole('dialog', { name: 'Go to file', exact: true });
  await quick.getByRole('combobox', { name: 'Find a file by name or path', exact: true }).fill(name);
  await quick.getByRole('option').filter({ hasText: name }).click();
  await expect(editor.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
  if (page.viewportSize()!.width <= 640) await editor.getByRole('button', { name: 'Show files', exact: true }).click();
  const revealed = tree.locator(`[data-tree-path="${unseen}"]`);
  await expect(revealed).toHaveAttribute('aria-current', 'true');
  await expect(revealed).toBeInViewport();
  expect(continuationRequests).toHaveLength(0);

  const more = tree.getByRole('button', { name: 'Load more in many', exact: true });
  const secondResponse = page.waitForResponse(response => new URL(response.url()).searchParams.get('cursor') === first.nextCursor);
  await expect(more).not.toHaveAttribute('aria-disabled', 'true');
  await more.focus();
  await page.keyboard.press('Enter');
  const second = await (await secondResponse).json() as DirectoryPage;
  expect(second.entries).toHaveLength(100);
  const loaded = new Set([...firstPaths, unseen, ...second.entries.map(entry => entry.path)]);
  await expect(tree).toHaveAttribute('data-tree-windowed', 'true');
  expect(await tree.locator('[data-tree-path]').count()).toBeLessThan(80);
  const newlyLoaded = second.entries.find(entry => !firstPaths.has(entry.path) && entry.path !== unseen)!;
  await expect(tree.locator(`[data-tree-path="${newlyLoaded.path}"]`)).toBeFocused();
  await expect(tree.locator('button[tabindex="0"]')).toHaveCount(1);
  expect(continuationRequests).toHaveLength(1);

  // A momentarily visible windowing gap during a fast scroll must never become
  // an implicit workspace-root drop target.
  await tree.locator('.editor-tree-window-gap').first().evaluate(element => {
    const data = new DataTransfer();
    data.items.add(new File(['must not upload'], 'misplaced.txt', { type: 'text/plain' }));
    element.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
  });
  await expect(page.getByText('Wait for the folder list to finish scrolling before dropping.', { exact: true })).toBeVisible();
  expect(fileMutationRequests).toHaveLength(0);

  // The continuation control is intentionally outside the rendered window
  // after focus moves to the first newly loaded file. Keyboard navigation must
  // bring it back without requesting another page.
  await tree.locator(`[data-tree-path="${newlyLoaded.path}"]`).press('End');
  await expect(more).toBeFocused();
  await expect(tree.locator('.editor-tree-more')).toContainText(`${loaded.size} loaded`);

  const folder = tree.getByRole('treeitem', { name: 'many', exact: true });
  await more.press('Home');
  await expect(folder).toBeFocused();
  await folder.press('Enter');
  await expect(tree.locator('[data-tree-path^="many/"]')).toHaveCount(0);
  await folder.press('Enter');
  await folder.press('End');
  await expect(tree.locator('.editor-tree-more')).toContainText(`${loaded.size} loaded`);
  await expect(more).not.toHaveAttribute('aria-disabled', 'true');
  expect(continuationRequests).toHaveLength(1);

  // Change the real directory immediately before the next continuation reaches
  // the server. Periodic refresh cannot race ahead of this in-flight page.
  let changed = false;
  const routePattern = `**/api/workspaces/${workspace.id}/tree-page?**`;
  await page.route(routePattern, async route => {
    if (!changed && new URL(route.request().url()).searchParams.get('cursor') === second.nextCursor) {
      changed = true;
      expect((await page.request.post(`/api/workspaces/${workspace.id}/files`, { headers, data: { path: 'many/new-after-page.txt', kind: 'file' } })).status()).toBe(201);
    }
    await route.continue();
  });
  await expect(more).not.toHaveAttribute('aria-disabled', 'true');
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(tree.getByRole('alert')).toContainText('changed');
  expect(changed).toBe(true);
  await tree.getByRole('button', { name: 'Retry loading many', exact: true }).click();
  await expect(tree.getByRole('alert')).toHaveCount(0);
  await expect(revealed).toHaveAttribute('aria-current', 'true');
  await expect(more).toBeVisible();
  await page.unroute(routePattern);
  expect(wholeDirectoryRequests).toHaveLength(0);
  expect(browserErrors).toEqual([]);
});
