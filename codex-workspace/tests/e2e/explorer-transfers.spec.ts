import { expect, test, type Locator, type Page } from '@playwright/test';
import type { DirectoryPage, FileContent, FileEntry, FileTransferPage, FileTransferStatus, UiState, Workspace } from '../../shared/types';

const headers = { 'X-Codex-Workspace': '1' };
const password = process.env.PLAYWRIGHT_PASSWORD || 'browser-test-workspace-password';
const savedText = 'export const transfer = "saved on disk";';
const editedText = 'export const transfer = "unsaved editor text";';

async function createWorkspace(page: Page, label: string) {
  const response = await page.request.post('/api/workspaces', { headers, data: { name: `Transfers ${label} ${Date.now()}`, initializeGit: false } });
  expect(response.status()).toBe(201);
  const workspace = await response.json() as Workspace;
  for (const path of ['source', 'source/nested', 'source/nested/empty', 'destination', 'destination/chosen', 'elsewhere']) {
    expect((await page.request.post(`/api/workspaces/${workspace.id}/files`, { headers, data: { path, kind: 'directory' } })).status()).toBe(201);
  }
  for (const path of ['source/draft.ts', 'source/nested/child.ts']) {
    expect((await page.request.post(`/api/workspaces/${workspace.id}/files`, { headers, data: { path, kind: 'file' } })).status()).toBe(201);
    expect((await page.request.put(`/api/workspaces/${workspace.id}/file`, { headers, data: { path, content: savedText } })).ok()).toBe(true);
  }
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
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/work');
  const editor = page.getByRole('region', { name: 'Code editor', exact: true });
  const tree = editor.getByRole('tree', { name: `${workspace.name} files`, exact: true });
  await expect(tree.locator('[data-tree-path="source"]')).toBeVisible();
  await tree.locator('[data-tree-path="source"]').click();
  await tree.locator('[data-tree-path="destination"]').click();
  await expect(tree.locator('[data-tree-path="destination/chosen"]')).toBeVisible();
  return { workspace, editor, tree };
}

async function edit(page: Page, editor: Locator, text = editedText) {
  const input = editor.locator('.monaco-editor textarea.inputarea').first();
  await expect(input).toBeVisible(); await input.focus();
  await page.keyboard.press('ControlOrMeta+KeyA'); await page.keyboard.insertText(text);
}

async function contents(page: Page, workspace: Workspace, path: string) {
  const response = await page.request.get(`/api/workspaces/${workspace.id}/file`, { params: { path } });
  expect(response.ok()).toBe(true);
  return (await response.json() as FileContent).content;
}

async function treeEntries(page: Page, workspace: Workspace, path: string) {
  const response = await page.request.get(`/api/workspaces/${workspace.id}/tree`, { params: { path } });
  expect(response.ok()).toBe(true);
  return response.json() as Promise<FileEntry[]>;
}

async function switchWorkspace(page: Page, workspace: Workspace) {
  await page.locator('.topbar-workspace').click();
  const dialog = page.getByRole('dialog', { name: 'Your workspaces', exact: true });
  const search = dialog.getByLabel('Find a workspace', { exact: true });
  if (await search.count()) await search.fill(workspace.name);
  await dialog.locator('.workspace-select').filter({ hasText: workspace.name }).click();
  await expect(dialog).toBeHidden(); await expect(page.locator('.topbar-workspace')).toHaveText(workspace.name);
}

// The payload uses native browser directory/file handles (OPFS), exercising real
// asynchronous values()/getFile() methods. Only attachment to DataTransferItem is
// adapted because automation cannot initiate a physical operating-system drag.
async function dropNativeFolder(target: Locator, folderName: string, withFile = false) {
  const captured = await target.evaluate(async (element, options) => {
    const root = await navigator.storage.getDirectory();
    const folder = await root.getDirectoryHandle(options.folderName, { create: true });
    const nested = await folder.getDirectoryHandle('nested', { create: true });
    await nested.getDirectoryHandle('empty', { create: true });
    if (options.withFile) {
      const file = await nested.getFileHandle('from-browser.txt', { create: true });
      const writer = await file.createWritable(); await writer.write('Exact native browser file contents.'); await writer.close();
    }
    const data = new DataTransfer();
    const item = data.items.add(new File([], options.folderName))!;
    let captures = 0;
    Object.defineProperty(item, 'getAsFileSystemHandle', { value: () => { captures++; return Promise.resolve(folder); } });
    // Chromium creates a fresh wrapper on each DataTransferItemList access.
    // Keep the adapted item stable so the app receives the native OPFS handle.
    Object.defineProperty(data, 'items', { value: [item] });
    element.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
    return captures;
  }, { folderName, withFile });
  expect(captured).toBe(1);
}

test('dragging an edited file moves saved bytes to the hovered folder and keeps its unsaved Monaco buffer', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const { workspace, editor, tree } = await prepare(page, 'move dirty');
  const source = tree.locator('[data-tree-path="source/draft.ts"]');
  const target = tree.locator('[data-tree-path="destination/chosen"]');
  await source.click(); await edit(page, editor);
  // Selection deliberately points elsewhere; drag targeting must ignore it.
  await tree.locator('[data-tree-path="elsewhere"]').click();
  await source.dragTo(target);
  const moved = tree.locator('[data-tree-path="destination/chosen/draft.ts"]');
  await expect(moved).toBeVisible(); await expect(source).toHaveCount(0);
  await expect(editor.getByRole('tab', { name: 'draft.ts', exact: true })).toHaveAttribute('data-tooltip-title', 'destination/chosen/draft.ts');
  await expect(editor.locator('.view-lines').first()).toContainText('unsaved editor text');
  await expect(moved.locator('.editor-dirty-dot')).toBeVisible();
  expect(await contents(page, workspace, 'destination/chosen/draft.ts')).toBe(savedText);
  expect((await page.request.get(`/api/workspaces/${workspace.id}/file`, { params: { path: 'source/draft.ts' } })).status()).toBe(404);
  expect((await page.request.get(`/api/workspaces/${workspace.id}/file`, { params: { path: 'elsewhere/draft.ts' } })).status()).toBe(404);
  await page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => contents(page, workspace, 'destination/chosen/draft.ts')).toBe(editedText);
  await expect(moved.locator('.editor-dirty-dot')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('modifier-drag copies a folder including empty descendants using saved contents and preserves original edits', async ({ page }) => {
  const { workspace, editor, tree } = await prepare(page, 'copy tree');
  const source = tree.locator('[data-tree-path="source/nested"]');
  await source.click(); await tree.locator('[data-tree-path="source/nested/child.ts"]').click(); await edit(page, editor);
  await page.keyboard.down('Control');
  try { await source.dragTo(tree.locator('[data-tree-path="destination/chosen"]')); }
  finally { await page.keyboard.up('Control'); }
  await expect(tree.locator('[data-tree-path="destination/chosen/nested"]')).toBeVisible();
  expect(await contents(page, workspace, 'source/nested/child.ts')).toBe(savedText);
  expect(await contents(page, workspace, 'destination/chosen/nested/child.ts')).toBe(savedText);
  expect(await treeEntries(page, workspace, 'destination/chosen/nested/empty')).toEqual([]);
  await expect(source).toHaveAttribute('aria-expanded', 'true');
  await expect(editor.getByRole('tab', { name: 'child.ts', exact: true })).toHaveAttribute('data-tooltip-title', 'source/nested/child.ts');
  await expect(editor.locator('.view-lines').first()).toContainText('unsaved editor text');
});

test('keyboard Cut Copy and Paste respect folder targets and a conflicting paste never replaces existing bytes', async ({ page }) => {
  const { workspace, tree } = await prepare(page, 'keyboard');
  const source = tree.locator('[data-tree-path="source/draft.ts"]');
  const destination = tree.locator('[data-tree-path="destination/chosen"]');
  await source.focus(); await page.keyboard.press('ControlOrMeta+KeyC');
  await destination.focus(); await page.keyboard.press('ControlOrMeta+KeyV');
  await expect(tree.locator('[data-tree-path="destination/chosen/draft.ts"]')).toBeVisible();
  const retained = 'Newer destination content stays safe.';
  expect((await page.request.put(`/api/workspaces/${workspace.id}/file`, { headers, data: { path: 'destination/chosen/draft.ts', content: retained } })).ok()).toBe(true);
  await destination.focus(); await page.keyboard.press('ControlOrMeta+KeyV');
  await expect(page.locator('.editor-transfer-notice[role="alert"]')).toContainText(/exist/i);
  expect(await contents(page, workspace, 'destination/chosen/draft.ts')).toBe(retained);
  expect(await contents(page, workspace, 'source/draft.ts')).toBe(savedText);
  const folder = tree.locator('[data-tree-path="source/nested"]');
  await folder.focus(); await page.keyboard.press('ControlOrMeta+KeyX');
  await destination.focus(); await page.keyboard.press('ControlOrMeta+KeyV');
  await expect(tree.locator('[data-tree-path="destination/chosen/nested"]')).toBeVisible();
  await expect(folder).toHaveCount(0); await expect(page.locator('.editor-clipboard')).toHaveCount(0);
  expect(await contents(page, workspace, 'destination/chosen/nested/child.ts')).toBe(savedText);
});

test('an unconfirmed move retains the original dirty buffer and reports both filesystem locations', async ({ page }) => {
  const { workspace, editor, tree } = await prepare(page, 'uncertain result');
  await tree.locator('[data-tree-path="source/draft.ts"]').click(); await edit(page, editor);
  await page.route(`**/api/workspaces/${workspace.id}/rename`, async route => {
    const real = await route.fetch(); expect(real.ok()).toBe(true);
    // Model a lost success response after a real verified filesystem move.
    await route.fulfill({ status: 500, json: { error: 'The transfer response was interrupted.', code: 'FILE_TRANSFER_FAILED' } });
  });
  await tree.locator('[data-tree-path="source/draft.ts"]').dragTo(tree.locator('[data-tree-path="destination/chosen"]'));
  const warning = editor.locator('.editor-transfer-notice[role="alert"]');
  await expect(warning).toContainText('source/draft.ts'); await expect(warning).toContainText('destination/chosen/draft.ts');
  await expect(editor.getByRole('tab', { name: 'draft.ts', exact: true })).toHaveAttribute('data-tooltip-title', 'source/draft.ts');
  await expect(editor.locator('.view-lines').first()).toContainText('unsaved editor text');
  await expect(editor.locator('.editor-conflict-banner')).toContainText('Your editor buffer is safe');
  expect(await contents(page, workspace, 'destination/chosen/draft.ts')).toBe(savedText);
});

test('a transfer holds affected saves and a late move confirmation cannot change the next workspace', async ({ page }) => {
  const { workspace, editor, tree } = await prepare(page, 'late first');
  const next = await createWorkspace(page, 'late next');
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let started = false; let finished = false; let oldWrites = 0;
  page.on('request', request => { if (request.method() === 'PUT' && request.url().includes(`/workspaces/${workspace.id}/file`)) oldWrites++; });
  const url = `**/api/workspaces/${workspace.id}/rename`;
  await page.route(url, async route => {
    const response = await route.fetch(); expect(response.ok()).toBe(true); started = true;
    await gate; try { await route.fulfill({ response }); } catch { /* Switching aborts this request. */ } finished = true;
  });
  try {
    await tree.locator('[data-tree-path="source/draft.ts"]').click();
    await tree.locator('[data-tree-path="source/draft.ts"]').dragTo(tree.locator('[data-tree-path="destination/chosen"]'));
    await expect.poll(() => started).toBe(true);
    await edit(page, editor);
    await expect(page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await page.keyboard.press('ControlOrMeta+KeyS'); expect(oldWrites).toBe(0);
    page.once('dialog', dialog => dialog.accept());
    await switchWorkspace(page, next);
    release(); await expect.poll(() => finished).toBe(true);
    await expect(page.locator('.topbar-workspace')).toHaveText(next.name);
    await expect(page.locator('.editor-transfer-notice')).toHaveCount(0);
    await expect(page.locator('.toast-stack')).not.toContainText('Moved to destination/chosen/draft.ts');
    expect(await contents(page, next, 'source/draft.ts')).toBe(savedText);
  } finally { release(); await page.unroute(url); }
});

test('locking during a move fences the late response and preserves the dirty buffer when the session resumes', async ({ page }) => {
  const { workspace, editor, tree } = await prepare(page, 'lock response');
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let started = false; let finished = false;
  const url = `**/api/workspaces/${workspace.id}/rename`;
  await page.route(url, async route => {
    const response = await route.fetch(); expect(response.ok()).toBe(true); started = true;
    await gate; try { await route.fulfill({ response }); } catch { /* Locking aborts the old request. */ } finished = true;
  });
  try {
    await tree.locator('[data-tree-path="source/draft.ts"]').click(); await edit(page, editor);
    await tree.locator('[data-tree-path="source/draft.ts"]').dragTo(tree.locator('[data-tree-path="destination/chosen"]'));
    await expect.poll(() => started).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('codex:session-expired')));
    await expect(page.getByLabel('Workspace password', { exact: true })).toBeVisible();
    release(); await expect.poll(() => finished).toBe(true);
    await page.getByLabel('Workspace password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(editor).toBeVisible();
    await expect(editor.getByRole('tab', { name: 'draft.ts', exact: true })).toHaveAttribute('data-tooltip-title', 'source/draft.ts');
    await expect(editor.locator('.view-lines').first()).toContainText('unsaved editor text');
    await expect(editor.locator('.editor-conflict-banner')).toContainText('Your editor buffer is safe');
    await expect(page.locator('.toast-stack')).not.toContainText('Moved to destination/chosen/draft.ts');
    expect(await contents(page, workspace, 'destination/chosen/draft.ts')).toBe(savedText);
  } finally { release(); await page.unroute(url); }
});

test('saved interrupted-operation status exposes both paths and refresh failures keep healthy files usable', async ({ page }) => {
  const { workspace, editor, tree } = await prepare(page, 'recovery status');
  let unavailable = false;
  const now = new Date().toISOString();
  const url = (url: URL) => url.pathname === `/api/workspaces/${workspace.id}/file-transfers/page`;
  await page.route(url, route => unavailable
    ? route.fulfill({ status: 503, json: { error: 'File operation history is temporarily unavailable.', code: 'FILE_TRANSFER_SCAN_LIMIT' } })
    : route.fulfill({ json: { items: [{ id: 'retained-transfer', workspaceId: workspace.id, kind: 'move', path: 'source/nested', newPath: 'destination/chosen/nested', state: 'interrupted', phase: 'verifying', createdAt: now, updatedAt: now, issue: 'The saved copy could not be verified. Inspect both locations before retrying.' }], offset: 0, limit: 25, total: 1, hasMore: false } }));
  await page.reload();
  await editor.getByRole('button', { name: '1 interrupted file operation', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'File operations', exact: true });
  await expect(dialog).toContainText('source/nested'); await expect(dialog).toContainText('destination/chosen/nested');
  await expect(dialog.getByRole('button', { name: /delete|retry|remove/i })).toHaveCount(0);
  unavailable = true;
  await dialog.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(dialog).toContainText('temporarily unavailable');
  await expect(dialog).toContainText('source/nested');
  await dialog.getByRole('button', { name: 'Inspect source', exact: true }).click();
  await expect(dialog).toBeHidden(); await expect(tree.locator('[data-tree-path="source/nested"]')).toBeVisible();
  await tree.locator('[data-tree-path="source/draft.ts"]').click();
  await expect(editor.locator('.view-lines').first()).toContainText('saved on disk');
  expect(await contents(page, workspace, 'source/draft.ts')).toBe(savedText);
});

function retainedOperations(workspace: Workspace, count: number): FileTransferStatus[] {
  const now = new Date().toISOString();
  return Array.from({ length: count }, (_, index): FileTransferStatus => ({ id: `operation-${workspace.id.slice(0, 8)}-${index}`, workspaceId: workspace.id,
    kind: index % 2 ? 'copy' : 'move', path: `source/retained-${index}.txt`, newPath: `destination/chosen/retained-${index}.txt`,
    state: 'interrupted', phase: 'verifying', createdAt: now, updatedAt: now, issue: 'Both saved paths remain available for inspection.' }));
}

function operationPage(items: FileTransferStatus[], url: URL): FileTransferPage {
  const limit = Number(url.searchParams.get('limit') || 25), query = (url.searchParams.get('q') || '').trim().toLowerCase();
  const matches = items.filter(item => `${item.kind} ${item.path} ${item.newPath}`.toLowerCase().includes(query));
  const offset = Math.min(Number(url.searchParams.get('offset') || 0), matches.length ? Math.floor((matches.length - 1) / limit) * limit : 0);
  return { items: matches.slice(offset, offset + limit), offset, limit, total: matches.length, hasMore: offset + limit < matches.length };
}

async function openFileOperations(page: Page, editor: Locator) {
  await editor.getByRole('button', { name: 'File actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'File operations', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'File operations', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('file operations requests bounded pages and server searches while Inspect preserves an unsaved editor buffer', async ({ page }) => {
  const { workspace, editor, tree } = await prepare(page, 'paged history');
  await tree.locator('[data-tree-path="source/draft.ts"]').click(); await edit(page, editor);
  const model = await editor.locator('.monaco-editor').first().elementHandle();
  const records = retainedOperations(workspace, 121);
  records[120] = { ...records[120], path: 'source/draft.ts', newPath: 'destination/chosen/draft.ts' };
  const reads: Array<{ offset: number; q: string; count: number; limit: number }> = [];
  const legacyReads: string[] = [], mutations: string[] = [];
  let failPage = false;
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path === `/api/workspaces/${workspace.id}/file-transfers`) legacyReads.push(path);
    if (request.method() !== 'GET' && [`/api/workspaces/${workspace.id}/rename`, `/api/workspaces/${workspace.id}/copy`].includes(path)) mutations.push(path);
  });
  await page.route(url => url.pathname === `/api/workspaces/${workspace.id}/file-transfers/page`, route => {
    const url = new URL(route.request().url()), response = operationPage(records, url);
    reads.push({ offset: response.offset, q: url.searchParams.get('q') || '', count: response.items.length, limit: response.limit });
    if (failPage && response.offset === 50) { failPage = false; return route.fulfill({ status: 503, json: { error: 'The next operation page is temporarily unavailable.' } }); }
    return route.fulfill({ json: response });
  });
  const dialog = await openFileOperations(page, editor);
  await expect(dialog.locator(`[data-file-transfer-id="${records[0].id}"]`)).toBeVisible();
  await expect(editor.locator('.editor-transfers-status')).toHaveText('121 unfinished file operations');
  await expect.poll(() => dialog.locator('.editor-file-transfer').count()).toBeLessThan(10);
  const next = dialog.getByRole('button', { name: 'Next file operations', exact: true });
  await next.focus(); await page.keyboard.press('Enter');
  await expect(dialog.locator(`[data-file-transfer-id="${records[25].id}"]`)).toBeVisible();
  await expect(dialog.locator(`[data-file-transfer-id="${records[0].id}"]`)).toHaveCount(0);
  await expect(next).toBeFocused();
  failPage = true; await next.click();
  await expect(dialog.locator('.file-transfer-read-error')).toContainText('next operation page is temporarily unavailable');
  await expect(dialog.locator(`[data-file-transfer-id="${records[25].id}"]`)).toBeVisible();
  await dialog.getByRole('button', { name: 'Retry loading', exact: true }).click();
  await expect(dialog.locator(`[data-file-transfer-id="${records[50].id}"]`)).toBeVisible();
  await dialog.getByRole('searchbox', { name: 'Search file operations', exact: true }).fill('source/draft.ts');
  await expect(dialog.locator(`[data-file-transfer-id="${records[50].id}"]`)).toHaveCount(0);
  await expect(dialog.locator('.editor-file-transfer')).toHaveCount(1);
  await expect(dialog).toContainText('destination/chosen/draft.ts');
  expect(reads.every(read => read.limit === 25 && read.count <= 25)).toBe(true);
  expect(reads.some(read => read.offset === 25)).toBe(true);
  expect(reads.some(read => read.offset === 0 && read.q === 'source/draft.ts' && read.count === 1)).toBe(true);
  await dialog.getByRole('button', { name: 'Inspect source', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await model!.evaluate(element => element.isConnected)).toBe(true);
  await expect(editor.locator('.view-lines').first()).toContainText('unsaved editor text');
  await expect(page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await expect(editor.locator('.editor-transfers-status')).toHaveText('121 unfinished file operations');
  expect(await contents(page, workspace, 'source/draft.ts')).toBe(savedText);
  expect(legacyReads).toEqual([]); expect(mutations).toEqual([]);
});

test('a malformed foreign operation page leaves the last validated paths inspectable and retries only the status read', async ({ page }) => {
  const { workspace, editor, tree } = await prepare(page, 'invalid status scope');
  const records = retainedOperations(workspace, 1);
  records[0] = { ...records[0], path: 'source/nested', newPath: 'destination/chosen/nested' };
  let foreign = false;
  const methods: string[] = [];
  await page.route(url => url.pathname === `/api/workspaces/${workspace.id}/file-transfers/page`, route => {
    methods.push(route.request().method());
    const result = operationPage(records, new URL(route.request().url()));
    if (foreign) result.items = [{ ...records[0], workspaceId: 'another-workspace', path: 'foreign/private.txt' }];
    return route.fulfill({ json: result });
  });
  const dialog = await openFileOperations(page, editor);
  await expect(dialog).toContainText('source/nested');
  foreign = true;
  await dialog.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(dialog.locator('.file-transfer-read-error')).toContainText('unreadable file operation page');
  await expect(dialog).not.toContainText('foreign/private.txt');
  await expect(dialog).toContainText('source/nested');
  foreign = false;
  await dialog.getByRole('button', { name: 'Retry loading', exact: true }).click();
  await expect(dialog.locator('.file-transfer-read-error')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Inspect source', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(tree.locator('[data-tree-path="source/nested"]')).toBeVisible();
  expect(methods.length).toBeGreaterThanOrEqual(3); expect(methods.every(method => method === 'GET')).toBe(true);
});

test('phone operation paging ignores an older search and a status response spanning lock and workspace selection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { workspace, editor } = await prepare(page, 'phone status scope');
  const another = await createWorkspace(page, 'later status workspace');
  const records = retainedOperations(workspace, 60);
  records[58] = { ...records[58], path: 'source/nested', newPath: 'destination/chosen/nested' };
  const fresh = retainedOperations(another, 1);
  fresh[0] = { ...fresh[0], path: 'elsewhere', newPath: 'destination/later-workspace' };
  let releaseSearch!: () => void, releaseRefresh!: () => void;
  const searchGate = new Promise<void>(resolve => { releaseSearch = resolve; });
  const refreshGate = new Promise<void>(resolve => { releaseRefresh = resolve; });
  let searchHeld = false, holdRefresh = false, refreshHeld = false, refreshDelivered = false;
  await page.route(url => url.pathname === `/api/workspaces/${workspace.id}/file-transfers/page`, async route => {
    const url = new URL(route.request().url()), response = operationPage(records, url);
    if (url.searchParams.get('q') === 'retained-59') { searchHeld = true; await searchGate; }
    const held = holdRefresh && url.searchParams.get('q') === 'source/nested';
    if (held) { holdRefresh = false; refreshHeld = true; await refreshGate; }
    await route.fulfill({ json: response }).catch(() => undefined);
    if (held) refreshDelivered = true;
  });
  await page.route(url => url.pathname === `/api/workspaces/${another.id}/file-transfers/page`, route => route.fulfill({ json: operationPage(fresh, new URL(route.request().url())) }));
  try {
    let dialog = await openFileOperations(page, editor);
    await expect(dialog.locator(`[data-file-transfer-id="${records[0].id}"]`)).toBeVisible();
    const next = dialog.getByRole('button', { name: 'Next file operations', exact: true });
    await next.focus(); await page.keyboard.press('Enter');
    await expect(dialog.locator(`[data-file-transfer-id="${records[25].id}"]`)).toBeVisible();
    await expect(next).toBeFocused(); expect((await next.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const search = dialog.getByRole('searchbox', { name: 'Search file operations', exact: true });
    await search.fill('retained-59'); await expect.poll(() => searchHeld).toBe(true);
    await search.fill('source/nested');
    await expect(dialog.locator('.editor-file-transfer')).toHaveCount(1);
    await expect(dialog).toContainText('source/nested');
    releaseSearch();
    await expect(dialog).not.toContainText('retained-59.txt');
    holdRefresh = true;
    await dialog.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect.poll(() => refreshHeld).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('codex:session-expired')));
    await expect(dialog).toBeHidden();
    await page.getByLabel('Workspace password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.locator('.topbar-workspace')).toHaveText(workspace.name);
    await switchWorkspace(page, another);
    dialog = await openFileOperations(page, page.getByRole('region', { name: 'Code editor', exact: true }));
    await expect(dialog).toContainText('destination/later-workspace');
    releaseRefresh(); await expect.poll(() => refreshDelivered).toBe(true);
    await expect(dialog).not.toContainText('source/nested');
    await expect(dialog.getByRole('searchbox', { name: 'Search file operations', exact: true })).toHaveValue('');
    await expect(page.locator('.topbar-workspace')).toHaveText(another.name);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  } finally { releaseSearch(); releaseRefresh(); }
});

test('Inspect reports a missing destination and focuses an off-page native source without replacing a dirty editor model', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { workspace, editor, tree } = await prepare(page, 'exact inspect target');
  const paths = Array.from({ length: 225 }, (_, index) => `source/inspect-${String(index).padStart(3, '0')}.txt`);
  for (let offset = 0; offset < paths.length; offset += 4) await Promise.all(paths.slice(offset, offset + 4).map(async path => {
    expect((await page.request.post(`/api/workspaces/${workspace.id}/files`, { headers, data: { path, kind: 'file' } })).status()).toBe(201);
  }));
  // Start with a fresh native directory lease after fixture creation. No dirty
  // model exists yet, and every inspected path below comes from the real host.
  await page.reload();
  await expect(tree.locator('[data-tree-path="source"]')).toBeVisible();
  const firstResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === `/api/workspaces/${workspace.id}/tree-page` && url.searchParams.get('path') === 'source' && !url.searchParams.has('cursor');
  });
  await tree.locator('[data-tree-path="source"]').click();
  const first = await (await firstResponse).json() as DirectoryPage;
  expect(first.entries).toHaveLength(100); expect(first.nextCursor).toBeTruthy();
  await page.locator('.app-topbar').getByRole('button', { name: 'Go to file', exact: true }).click();
  const quick = page.getByRole('dialog', { name: 'Go to file', exact: true });
  await quick.getByRole('combobox', { name: 'Find a file by name or path', exact: true }).fill('draft.ts');
  await quick.getByRole('option').filter({ hasText: 'draft.ts' }).click();
  await edit(page, editor);
  const model = await editor.locator('.monaco-editor').first().elementHandle();
  const secondResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === `/api/workspaces/${workspace.id}/tree-page` && url.searchParams.get('path') === 'source' && url.searchParams.get('cursor') === first.nextCursor;
  });
  await tree.getByRole('button', { name: 'Load more in source', exact: true }).click();
  const second = await (await secondResponse).json() as DirectoryPage;
  expect(second.entries).toHaveLength(100);
  const loaded = new Set([...first.entries, ...second.entries].map(entry => entry.path));
  loaded.add('source/draft.ts');
  const targetPath = paths.find(path => !loaded.has(path));
  if (!targetPath) throw new Error('The native fixture must include a target outside both loaded directory pages.');
  const targetName = targetPath.split('/').at(-1)!;
  const missingPath = 'destination/chosen/not-published-inspect.txt';
  await expect(tree).toHaveAttribute('data-tree-windowed', 'true');
  await tree.evaluate(element => { element.scrollTop = 0; });
  await expect(tree.locator(`[data-tree-path="${targetPath}"]`)).toHaveCount(0);
  const status = { ...retainedOperations(workspace, 1)[0], path: targetPath, newPath: missingPath };
  await page.route(url => url.pathname === `/api/workspaces/${workspace.id}/file-transfers/page`, route => route.fulfill({ json: operationPage([status], new URL(route.request().url())) }));
  const inspected: string[] = [], continuations: string[] = [], openedTarget: string[] = [], mutations: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === `/api/workspaces/${workspace.id}/tree-entry`) inspected.push(url.searchParams.get('path') || '');
    if (url.pathname === `/api/workspaces/${workspace.id}/tree-page` && url.searchParams.has('cursor')) continuations.push(request.url());
    if (url.searchParams.get('path') === targetPath && ['file', 'file-info', 'file-page'].some(route => url.pathname === `/api/workspaces/${workspace.id}/${route}`)) openedTarget.push(request.url());
    if (request.method() !== 'GET' && url.pathname.startsWith(`/api/workspaces/${workspace.id}/`)) mutations.push(request.url());
  });
  const dialog = await openFileOperations(page, editor);
  await expect(dialog).toContainText(targetPath);
  const missingResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === `/api/workspaces/${workspace.id}/tree-entry` && url.searchParams.get('path') === missingPath;
  });
  await dialog.getByRole('button', { name: 'Inspect destination', exact: true }).click();
  expect((await missingResponse).status()).toBe(404);
  await expect(dialog.locator('.file-transfer-inspect-error')).toContainText(`${missingPath} is unavailable`);
  await expect(dialog).toBeVisible();
  await expect(editor.getByRole('tab', { name: 'draft.ts', exact: true })).toHaveAttribute('aria-selected', 'true');
  await dialog.getByRole('button', { name: 'Inspect source', exact: true }).click();
  await expect(dialog).toBeHidden();
  const target = tree.locator(`[data-tree-path="${targetPath}"]`);
  await expect(target).toHaveAttribute('aria-selected', 'true');
  await expect(target).toBeFocused();
  await expect(target).toBeInViewport();
  await expect(target).not.toHaveAttribute('aria-current', 'true');
  await expect.poll(() => tree.locator('[data-tree-path]').count()).toBeLessThan(80);
  await expect(editor.getByRole('tab', { name: 'draft.ts', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(editor.getByRole('tab', { name: targetName, exact: true })).toHaveCount(0);
  await expect(editor.locator('.view-lines').first()).toContainText('unsaved editor text');
  await expect(page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  expect(await model!.evaluate(element => element.isConnected)).toBe(true);
  expect(inspected).toContain(missingPath); expect(inspected).toContain(targetPath);
  expect(continuations).toEqual([]); expect(openedTarget).toEqual([]); expect(mutations).toEqual([]);
  expect(await contents(page, workspace, 'source/draft.ts')).toBe(savedText);
});

test('dropped native folder handles preserve empty nested folders in the actual hovered destination', async ({ page }) => {
  const { workspace, editor, tree } = await prepare(page, 'native empty folder');
  await tree.locator('[data-tree-path="elsewhere"]').click();
  await dropNativeFolder(tree.locator('[data-tree-path="destination/chosen"]'), 'dropped-project');
  await expect(editor.locator('.editor-upload-notice')).toContainText('Created 3 folders');
  expect(await treeEntries(page, workspace, 'destination/chosen/dropped-project/nested/empty')).toEqual([]);
  expect((await treeEntries(page, workspace, 'elsewhere')).some(entry => entry.name === 'dropped-project')).toBe(false);
  expect((await treeEntries(page, workspace, '')).some(entry => entry.name === 'dropped-project')).toBe(false);
});

test('nested native folder files retain their complete upload paths and a service failure is never reported complete', async ({ page }) => {
  const { workspace, editor, tree } = await prepare(page, 'folder upload failure');
  await page.route('**/api/uploads/status', route => route.fulfill({ json: { enabled: false, ready: false, error: { code: 'UPLOADS_UNAVAILABLE', message: 'Upload service is unavailable for this check.' } } }));
  const rawUploads: string[] = []; page.on('request', request => { if (request.url().includes(`/workspaces/${workspace.id}/upload?`)) rawUploads.push(request.url()); });
  await dropNativeFolder(tree.locator('[data-tree-path="destination/chosen"]'), 'file-project', true);
  const progress = editor.getByRole('region', { name: 'File uploads' });
  await expect(progress.getByText('Upload failed', { exact: true })).toBeVisible();
  await expect(progress.locator('strong')).toHaveAttribute('data-tooltip-title', 'destination/chosen/file-project/nested/from-browser.txt');
  await expect(progress.getByText('0 of 1 saved', { exact: true })).toBeVisible();
  await expect(progress.getByText('Saved to workspace', { exact: true })).toHaveCount(0);
  await expect(editor.locator('.editor-upload-notice')).toContainText('saved 0 of 1 files');
  expect(await treeEntries(page, workspace, 'destination/chosen/file-project/nested/empty')).toEqual([]);
  expect(rawUploads).toEqual([]);
});

test('unsupported directory drops show working file and folder alternatives without mutating the workspace', async ({ page }) => {
  const { workspace, editor, tree } = await prepare(page, 'drop fallback');
  await tree.locator('[data-tree-path="destination/chosen"]').evaluate(element => {
    const data = new DataTransfer(), item = data.items.add(new File([], 'unreadable-folder'))!;
    Object.defineProperty(item, 'getAsFileSystemHandle', { value: async () => null });
    Object.defineProperty(item, 'webkitGetAsEntry', { value: () => null });
    Object.defineProperty(item, 'getAsFile', { value: () => null });
    Object.defineProperty(data, 'items', { value: [item] });
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
  });
  const notice = editor.locator('.editor-upload-notice[role="alert"]');
  await expect(notice).toContainText('Use Upload folder or Upload files');
  await expect(notice.getByRole('button', { name: 'Upload files', exact: true })).toBeEnabled();
  await expect(notice.getByRole('button', { name: 'Upload folder', exact: true })).toBeEnabled();
  expect(await treeEntries(page, workspace, 'destination/chosen')).toEqual([]);
});

test.describe('phone explorer transfers', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('touch menus copy and paste a file without requiring drag gestures', async ({ page }) => {
    const { workspace, editor, tree } = await prepare(page, 'touch copy');
    await tree.getByRole('button', { name: 'Actions for draft.ts', exact: true }).tap();
    await page.getByRole('menu', { name: 'Actions for draft.ts', exact: true }).getByRole('menuitem', { name: 'Copy Saved contents only', exact: true }).tap();
    const destination = tree.locator('[data-tree-path="destination/chosen"]');
    await destination.tap();
    const paste = editor.locator('.editor-clipboard').getByRole('button', { name: 'Paste into chosen', exact: true });
    const bounds = await paste.boundingBox(); expect(bounds!.height).toBeGreaterThanOrEqual(44);
    await paste.tap();
    await expect(tree.locator('[data-tree-path="destination/chosen/draft.ts"]')).toBeVisible();
    expect(await contents(page, workspace, 'destination/chosen/draft.ts')).toBe(savedText);
    await expect(tree.locator('[data-tree-path="source/draft.ts"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
