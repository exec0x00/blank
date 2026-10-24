import { expect, test, type Locator, type Page } from '@playwright/test';
import type { UiState, Workspace, WorkspaceFilePage } from '../../shared/types';

const headers = { 'X-Codex-Workspace': '1' };
const password = process.env.PLAYWRIGHT_PASSWORD || 'browser-test-workspace-password';
const name = 'large.log';
const tailMarker = 'UNIQUE LARGE FILE TAIL 7cf299';
const source = Buffer.from(`Original first line.\n${('unchanged row ' + '.'.repeat(82) + '\n').repeat(64000)}${tailMarker}\n`, 'utf8');

async function createWorkspace(page: Page, label: string, large = true) {
  const created = await page.request.post('/api/workspaces', { headers, data: { name: `Paged editor ${label} ${Date.now()}`, initializeGit: false } });
  expect(created.status()).toBe(201); const workspace = await created.json() as Workspace;
  if (large) {
    // Fixture setup uses the existing bounded raw API. Browser uploads continue
    // to use the direct public-bucket workflow, independently covered elsewhere.
    const upload = await page.request.put(`/api/workspaces/${workspace.id}/upload`, { params: { path: name }, headers: { ...headers, 'Content-Type': 'application/octet-stream' }, data: source });
    expect(upload.status()).toBe(201);
  }
  expect((await page.request.post(`/api/workspaces/${workspace.id}/files`, { headers, data: { path: 'small.ts', kind: 'file' } })).status()).toBe(201);
  expect((await page.request.put(`/api/workspaces/${workspace.id}/file`, { headers, data: { path: 'small.ts', content: `export const owner = ${JSON.stringify(label)};\n` } })).ok()).toBe(true);
  return workspace;
}

async function prepare(page: Page, label: string) {
  expect((await page.request.post('/api/session', { headers, data: { password } })).ok()).toBe(true);
  const workspace = await createWorkspace(page, label);
  expect((await page.request.patch(`/api/workspaces/${workspace.id}`, { headers, data: { active: true } })).ok()).toBe(true);
  const width = page.viewportSize()!.width;
  const profile = width >= 1360 ? 'desktop' : width >= 1000 ? 'laptop' : width >= 680 ? 'tablet' : 'mobile';
  const state = await (await page.request.get('/api/ui-state')).json() as UiState;
  expect((await page.request.patch('/api/ui-state', { headers, data: { revision: state.revision, changes: [
    { section: 'layout', profile, key: 'view', value: 'editor' }, { section: 'layout', profile, key: 'split', value: 'focus' },
  ] } })).ok()).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/work');
  const editor = page.getByRole('region', { name: 'Code editor', exact: true });
  await editor.getByRole('treeitem', { name, exact: true }).click();
  const paged = editor.getByRole('region', { name: `Paged editor for ${name}`, exact: true });
  await expect(paged.locator('.monaco-editor textarea.inputarea').first()).toBeVisible();
  await expect(paged).toHaveAttribute('data-page-start', '0');
  return { workspace, editor, paged };
}

async function edit(page: Page, editor: Locator, value: string) {
  const input = editor.locator('.monaco-editor textarea.inputarea').first(); await input.focus();
  await page.keyboard.press('ControlOrMeta+KeyA'); await page.keyboard.insertText(value);
}

async function readPage(page: Page, workspace: Workspace, offset = 0) {
  const response = await page.request.get(`/api/workspaces/${workspace.id}/file-page`, { params: { path: name, offset } });
  expect(response.ok()).toBe(true); return response.json() as Promise<WorkspaceFilePage>;
}

async function readBytes(page: Page, workspace: Workspace) {
  const response = await page.request.get(`/api/workspaces/${workspace.id}/download`, { params: { path: name } });
  expect(response.ok()).toBe(true); return response.body();
}

async function switchWorkspace(page: Page, workspace: Workspace) {
  await page.locator('.topbar-workspace').click();
  const dialog = page.getByRole('dialog', { name: 'Your workspaces', exact: true });
  const search = dialog.getByLabel('Find a workspace', { exact: true });
  if (await search.count()) await search.fill(workspace.name);
  await dialog.locator('.workspace-select').filter({ hasText: workspace.name }).click();
  await expect(dialog).toBeHidden(); await expect(page.locator('.topbar-workspace')).toHaveText(workspace.name);
}

test('loads a bounded page, preserves dirty tabs, and saves through the main top bar without touching unseen bytes', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const { workspace, editor, paged } = await prepare(page, 'dirty preservation');
  const writes: string[] = []; page.on('request', request => { if (request.method() === 'PUT') writes.push(new URL(request.url()).pathname); });
  const original = await readPage(page, workspace);
  expect(Buffer.byteLength(original.content, 'utf8')).toBeLessThanOrEqual(256 * 1024);
  expect(original.byteEnd).toBeLessThan(source.byteLength);
  await expect(paged.locator('.monaco-editor')).toHaveCount(1);
  await expect(paged).toContainText('Full-file diagnostics unavailable');
  const draft = 'Edited first page, with UTF-8 😺.\n';
  await edit(page, paged, draft);
  await expect(paged.getByRole('button', { name: 'Next file page', exact: true })).toBeDisabled();
  await editor.getByRole('treeitem', { name: 'small.ts', exact: true }).click();
  await expect(editor.locator('.large-file-editor')).toHaveCount(0);
  await editor.getByRole('tab', { name, exact: true }).click();
  await expect(paged.locator('.view-lines')).toContainText('Edited first page');
  await expect(paged.locator('.editor-save-state')).toHaveText('Unsaved page');
  const save = page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeEnabled();
  const written = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith(`/workspaces/${workspace.id}/file-range`));
  await save.click(); expect((await written).ok()).toBe(true);
  await expect(save).toBeDisabled(); await expect(paged.locator('.editor-save-state')).toHaveText('Saved page');
  expect(await readBytes(page, workspace)).toEqual(Buffer.concat([Buffer.from(draft), source.subarray(original.byteEnd)]));
  expect(writes.filter(path => path.endsWith(`/workspaces/${workspace.id}/file-range`))).toHaveLength(1);
  // Browser requests exclude API fixture setup; this save must never issue a
  // whole-file replacement for either the loaded page or the untouched tab.
  expect(writes.filter(path => path.endsWith(`/workspaces/${workspace.id}/file`))).toHaveLength(0);
  await paged.getByRole('button', { name: 'Next file page', exact: true }).click();
  await expect(paged).toHaveAttribute('data-page-start', String(Buffer.byteLength(draft)));
  await expect(paged.locator('.monaco-editor')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('retains a conflicting page and applies it only after reviewing the current matching range', async ({ page }) => {
  const { workspace, paged } = await prepare(page, 'review conflict');
  const original = await readPage(page, workspace);
  const draft = 'My reviewed replacement page.\n'; await edit(page, paged, draft);
  const remoteContent = original.content.replace('Original first line.', 'External first line.');
  expect(Buffer.byteLength(remoteContent)).toBe(Buffer.byteLength(original.content));
  const external = await page.request.put(`/api/workspaces/${workspace.id}/file-range`, { headers, data: { path: name, pageToken: original.pageToken, content: remoteContent } });
  expect(external.ok()).toBe(true);
  await page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(paged.locator('.large-file-conflict')).toBeVisible();
  await expect(paged.locator('.view-lines')).toContainText('My reviewed replacement');
  await expect(paged.getByRole('button', { name: 'Next file page', exact: true })).toBeDisabled();
  expect((await readBytes(page, workspace)).subarray(0, Buffer.byteLength(remoteContent))).toEqual(Buffer.from(remoteContent));
  await paged.getByRole('button', { name: 'Review current range', exact: true }).click();
  const apply = paged.getByRole('button', { name: 'Apply reviewed page', exact: true });
  await expect(apply).toBeVisible(); await expect(paged.locator('.monaco-diff-editor')).toBeVisible();
  page.once('dialog', dialog => dialog.accept()); await apply.click();
  await expect(paged.locator('.large-file-conflict')).toHaveCount(0);
  await expect(paged.locator('.editor-save-state')).toHaveText('Saved page');
  expect(await readBytes(page, workspace)).toEqual(Buffer.concat([Buffer.from(draft), source.subarray(original.byteEnd)]));
});

test('reports a failed page read, retries it, and ignores an old workspace response after switching', async ({ page }) => {
  const { workspace, paged } = await prepare(page, 'read failures');
  const second = await createWorkspace(page, 'second workspace', false);
  const first = await readPage(page, workspace);
  const endpoint = `**/api/workspaces/${workspace.id}/file-page?**`;
  await page.route(endpoint, route => new URL(route.request().url()).searchParams.has('cursor')
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Page storage temporarily unavailable.' }) }) : route.continue());
  await paged.getByRole('button', { name: 'Next file page', exact: true }).click();
  await expect(paged.getByRole('alert').filter({ hasText: 'Page storage temporarily unavailable.' })).toBeVisible();
  await expect(paged).toHaveAttribute('data-page-start', '0'); await expect(paged.locator('.view-lines')).toContainText('Original first line');
  await page.unroute(endpoint);
  await paged.getByRole('button', { name: 'Retry page', exact: true }).click();
  await expect(paged).toHaveAttribute('data-page-start', String(first.byteEnd));
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let held = false;
  await page.route(endpoint, async route => { const response = await route.fetch(); held = true; await gate; await route.fulfill({ response }).catch(() => undefined); });
  try {
    await paged.getByRole('button', { name: 'Next file page', exact: true }).click(); await expect.poll(() => held).toBe(true);
    await switchWorkspace(page, second);
    const editor = page.getByRole('region', { name: 'Code editor', exact: true });
    await editor.getByRole('treeitem', { name: 'small.ts', exact: true }).click();
    await expect(editor.locator('.view-lines')).toContainText('second workspace'); release();
    await page.waitForTimeout(100);
    await expect(editor.locator('.large-file-editor')).toHaveCount(0); await expect(editor.locator('.view-lines')).toContainText('second workspace');
  } finally { release(); await page.unroute(endpoint); }
});

test('searches saved text in bounded sections and uses honest byte and global line navigation', async ({ page }) => {
  const { paged } = await prepare(page, 'search navigation');
  await paged.locator('.monaco-editor textarea.inputarea').focus(); await page.keyboard.press('ControlOrMeta+KeyF');
  const find = page.getByRole('dialog', { name: 'Find in large file', exact: true }); await expect(find).toBeVisible();
  await find.getByLabel('Find text', { exact: true }).fill(tailMarker);
  await find.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(find.locator('.large-file-search-progress')).toBeVisible();
  for (let attempts = 0; attempts < 5 && await find.getByRole('button', { name: 'Search next section', exact: true }).isVisible(); attempts += 1) {
    const previous = await find.locator('.large-file-search-progress').textContent();
    await find.getByRole('button', { name: 'Search next section', exact: true }).click();
    await expect(find.locator('.large-file-search-progress')).not.toHaveText(previous!);
  }
  await expect(find.locator('.large-file-search-progress')).toContainText('End of file reached');
  const result = find.locator('.large-file-search-results > button').filter({ hasText: tailMarker }); await expect(result).toHaveCount(1); await result.click();
  await expect(find).toBeHidden(); await expect(paged.locator('.view-lines')).toContainText(tailMarker);
  await expect(paged.locator('.large-file-range')).toContainText('Global lines unknown');
  await paged.locator('.monaco-editor textarea.inputarea').focus(); await page.keyboard.press('ControlOrMeta+KeyG');
  const navigate = page.getByRole('dialog', { name: 'Go to position in large file', exact: true });
  await navigate.getByRole('combobox', { name: 'Position type', exact: true }).click();
  await page.getByRole('option', { name: /Global line/ }).click();
  await navigate.getByLabel('Global line number', { exact: true }).fill('12');
  await navigate.getByRole('button', { name: 'Go to position', exact: true }).click();
  await expect(paged.locator('.large-file-position')).toContainText('Ln 12, Col 1');
  await expect(paged.locator('.monaco-editor')).toHaveCount(1);
});

test('keeps a dirty page through locking and a native rename without using its old range token', async ({ page }) => {
  const { workspace, editor, paged } = await prepare(page, 'move and lock');
  const writes: string[] = []; page.on('request', request => { if (request.method() === 'PUT' && request.url().includes('/file-range')) writes.push(request.url()); });
  const draft = 'Retained edited page after moving.\n'; await edit(page, paged, draft);
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await page.getByLabel('Workspace password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(paged.locator('.view-lines')).toContainText('Retained edited page');
  const item = editor.getByRole('treeitem', { name, exact: true }); await item.focus(); await page.keyboard.press('F2');
  const rename = page.getByRole('dialog', { name: 'Rename or move', exact: true });
  await rename.locator('input').fill('moved-large.log');
  await rename.getByRole('button', { name: /Move|Rename/ }).last().click();
  const moved = editor.getByRole('region', { name: 'Paged editor for moved-large.log', exact: true });
  await expect(moved.locator('.view-lines')).toContainText('Retained edited page');
  await expect(moved.locator('.large-file-conflict')).toContainText('moved');
  await page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.toast-stack')).toContainText('Review the current file range before applying your edited page.');
  expect(writes).toEqual([]);
  const onDisk = await page.request.get(`/api/workspaces/${workspace.id}/file-page`, { params: { path: 'moved-large.log' } });
  expect(onDisk.ok()).toBe(true); expect((await onDisk.json() as WorkspaceFilePage).content).toContain('Original first line.');
  const movedBytes = await page.request.get(`/api/workspaces/${workspace.id}/download`, { params: { path: 'moved-large.log' } });
  expect(movedBytes.ok()).toBe(true); expect(await movedBytes.body()).toEqual(source);
  expect(writes).toEqual([]);
});

test.describe('phone paged editor', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('offers touch page controls and top-bar saving without horizontal layout overflow', async ({ page }) => {
    const { paged } = await prepare(page, 'phone controls');
    for (const button of [paged.getByRole('button', { name: 'Next file page', exact: true }), paged.getByRole('button', { name: 'Go to…', exact: true })]) {
      const bounds = await button.boundingBox(); expect(bounds!.width).toBeGreaterThanOrEqual(44); expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    await paged.getByRole('button', { name: 'Next file page', exact: true }).click();
    await expect(paged).not.toHaveAttribute('data-page-start', '0');
    await edit(page, paged, 'Phone page edit.\n');
    const save = page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true }); await expect(save).toBeEnabled(); await save.click();
    await expect(paged.locator('.editor-save-state')).toHaveText('Saved page');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await paged.evaluate(element => [element, ...element.querySelectorAll('*')].every(node => {
      const style = getComputedStyle(node); return style.boxShadow === 'none' && style.textShadow === 'none' && style.backdropFilter === 'none';
    }))).toBe(true);
  });
});
