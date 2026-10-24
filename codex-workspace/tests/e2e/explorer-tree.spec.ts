import { expect, test, type Locator, type Page } from '@playwright/test';
import type { FileContent, UiState, Workspace } from '../../shared/types';

const headers = { 'X-Codex-Workspace': '1' };
const password = process.env.PLAYWRIGHT_PASSWORD || 'browser-test-workspace-password';
const source = 'export const app = "saved source";\n';

async function prepare(page: Page, name: string) {
  expect((await page.request.post('/api/session', { headers, data: { password } })).status()).toBe(200);
  const created = await page.request.post('/api/workspaces', { headers, data: { name: `Explorer ${name} ${Date.now()}`, initializeGit: false } });
  expect(created.status()).toBe(201);
  const workspace = await created.json() as Workspace;
  for (const path of ['assets', 'src', 'src/components']) {
    expect((await page.request.post(`/api/workspaces/${workspace.id}/files`, { headers, data: { path, kind: 'directory' } })).status()).toBe(201);
  }
  for (const [path, content] of Object.entries({
    'README.md': '# Explorer test\n',
    'package.json': '{"name":"explorer-test"}\n',
    'src/app.tsx': source,
    'src/components/button.tsx': 'export const button = "nested source";\n',
  })) {
    expect((await page.request.post(`/api/workspaces/${workspace.id}/files`, { headers, data: { path, kind: 'file' } })).status()).toBe(201);
    expect((await page.request.put(`/api/workspaces/${workspace.id}/file`, { headers, data: { path, content } })).ok()).toBe(true);
  }
  expect((await page.request.patch(`/api/workspaces/${workspace.id}`, { headers, data: { active: true } })).ok()).toBe(true);
  const width = page.viewportSize()!.width;
  const profile = width >= 1360 ? 'desktop' : width >= 1000 ? 'laptop' : width >= 680 ? 'tablet' : 'mobile';
  const state = await (await page.request.get('/api/ui-state')).json() as UiState;
  expect((await page.request.patch('/api/ui-state', { headers, data: { revision: state.revision, changes: [
    { section: 'layout', profile, key: 'view', value: 'editor' },
    { section: 'layout', profile, key: 'split', value: 'focus' },
  ] } })).ok()).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/work');
  const editor = page.getByRole('region', { name: 'Code editor', exact: true });
  const tree = editor.getByRole('tree', { name: `${workspace.name} files`, exact: true });
  await expect(tree.getByRole('treeitem', { name: 'src', exact: true })).toBeVisible();
  return { workspace, editor, tree };
}

async function edit(page: Page, editor: Locator, content: string) {
  const input = editor.locator('.monaco-editor textarea.inputarea').first();
  await expect(input).toBeVisible();
  await input.focus();
  await page.keyboard.press('ControlOrMeta+KeyA');
  await page.keyboard.insertText(content);
}

async function readFile(page: Page, workspace: Workspace, path: string) {
  const response = await page.request.get(`/api/workspaces/${workspace.id}/file`, { params: { path } });
  expect(response.ok()).toBe(true);
  return response.json() as Promise<FileContent>;
}

test('the guided tree supports one tab stop, keyboard traversal, typeahead, menus and unsaved files', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const { editor, tree } = await prepare(page, 'keyboard');
  const assets = tree.getByRole('treeitem', { name: 'assets', exact: true });
  const src = tree.getByRole('treeitem', { name: 'src', exact: true });
  const components = tree.getByRole('treeitem', { name: 'components', exact: true });
  const button = tree.getByRole('treeitem', { name: 'button.tsx', exact: true });
  const app = tree.getByRole('treeitem', { name: 'app.tsx', exact: true });
  await expect(tree.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1);
  await expect(tree.locator('.editor-tree-menu:not([tabindex="-1"])')).toHaveCount(0);
  await editor.getByRole('button', { name: 'Refresh files', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(assets).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(src).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(src).toHaveAttribute('aria-expanded', 'true');
  await expect(components).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(components).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(button).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('aria-level', '3');
  await expect(button).toHaveAttribute('aria-posinset', '1');
  await expect(button).toHaveAttribute('aria-setsize', '1');
  await page.keyboard.press('ArrowLeft');
  await expect(components).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(components).toHaveAttribute('aria-expanded', 'false');
  await expect(button).toHaveCount(0);
  await page.keyboard.press('ArrowLeft');
  await expect(src).toBeFocused();
  await page.keyboard.press('Home');
  await expect(assets).toBeFocused();
  await page.keyboard.press('End');
  await expect(tree.getByRole('treeitem', { name: 'README.md', exact: true })).toBeFocused();
  await page.keyboard.type('pack');
  const packageFile = tree.getByRole('treeitem', { name: 'package.json', exact: true });
  await expect(packageFile).toBeFocused();
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Actions for package.json', exact: true });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Rename or move', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(packageFile).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(editor.getByRole('button', { name: 'Upload files', exact: true })).toBeFocused();

  await app.click();
  await edit(page, editor, 'export const app = "unsaved source";\n');
  await expect(app).toHaveAttribute('aria-current', 'true');
  await expect(app).toHaveAttribute('aria-description', 'File. Unsaved changes');
  await expect(app.locator('.editor-dirty-dot')).toBeVisible();
  await components.click();
  await expect(button).toBeVisible();
  await expect(app).toHaveAttribute('aria-selected', 'false');
  await expect(app).toHaveAttribute('aria-current', 'true');
  await expect(tree.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1);

  const geometry = await Promise.all([src, components, button].map(item => item.boundingBox()));
  expect(geometry[1]!.x - geometry[0]!.x).toBe(20);
  expect(geometry[2]!.x - geometry[1]!.x).toBe(20);
  expect(await tree.locator('.editor-tree-guides > span').first().evaluate(guide => getComputedStyle(guide).borderInlineStartWidth)).toBe('1px');
  expect(await tree.locator('.editor-file-icon').evaluateAll(icons => icons.every(icon => {
    const rgb = getComputedStyle(icon).color.match(/\d+/g)?.slice(0, 3);
    return rgb?.length === 3 && rgb.every(value => value === rgb[0]);
  }))).toBe(true);
  expect(await tree.evaluate(node => [node, ...node.querySelectorAll('*')].every(element => {
    const style = getComputedStyle(element);
    return style.boxShadow === 'none' && style.textShadow === 'none' && style.backdropFilter === 'none' && Number.parseFloat(style.transitionDuration) === 0;
  }))).toBe(true);
  await testInfo.attach('explorer-desktop', { body: await editor.locator('.editor-sidebar').screenshot(), contentType: 'image/png' });
  await editor.getByRole('button', { name: 'Collapse folders', exact: true }).click();
  await expect(app).toHaveCount(0);
  await expect(src).toHaveAttribute('aria-expanded', 'false');
  await expect(src).toHaveAttribute('tabindex', '0');
  await expect(editor.locator('.view-lines').first()).toContainText('unsaved source');
  expect(errors).toEqual([]);
});

test('tree actions create folders and files and rename, trash and restore real saved contents', async ({ page }) => {
  const { workspace, editor, tree } = await prepare(page, 'operations');
  const src = tree.getByRole('treeitem', { name: 'src', exact: true });
  await src.click();
  await src.click({ button: 'right' });
  await page.getByRole('menu', { name: 'Actions for src', exact: true }).getByRole('menuitem', { name: 'New folder here', exact: true }).click();
  const folderDialog = page.getByRole('dialog', { name: 'Create folder', exact: true });
  await expect(folderDialog.getByLabel('Folder path', { exact: true })).toHaveValue('src/');
  await folderDialog.getByLabel('Folder path', { exact: true }).fill('src/created');
  await folderDialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(folderDialog).toBeHidden();
  const folder = tree.getByRole('treeitem', { name: 'created', exact: true });
  await expect(folder).toHaveAttribute('aria-expanded', 'true');
  await expect(tree.getByRole('status').filter({ hasText: 'Empty folder' })).toBeVisible();
  await tree.getByRole('button', { name: 'Actions for created', exact: true }).click();
  await page.getByRole('menu', { name: 'Actions for created', exact: true }).getByRole('menuitem', { name: 'New file here', exact: true }).click();
  const fileDialog = page.getByRole('dialog', { name: 'Create file', exact: true });
  await expect(fileDialog.getByLabel('File path', { exact: true })).toHaveValue('src/created/');
  await fileDialog.getByLabel('File path', { exact: true }).fill('src/created/real.ts');
  await fileDialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(fileDialog).toBeHidden();
  // Keep exact bytes independent of the new Monaco model's platform-default EOL.
  const content = 'export const created = "saved through the explorer";';
  await edit(page, editor, content);
  await page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await readFile(page, workspace, 'src/created/real.ts')).content).toBe(content);

  const original = tree.getByRole('treeitem', { name: 'real.ts', exact: true });
  await original.focus();
  await page.keyboard.press('F2');
  const rename = page.getByRole('dialog', { name: 'Rename or move', exact: true });
  await rename.getByLabel('New path', { exact: true }).fill('src/created/renamed.ts');
  await rename.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(rename).toBeHidden();
  const renamed = tree.getByRole('treeitem', { name: 'renamed.ts', exact: true });
  await expect(renamed).toBeVisible();
  await expect(original).toHaveCount(0);
  await expect(editor.getByRole('tab', { name: 'renamed.ts', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect((await readFile(page, workspace, 'src/created/renamed.ts')).content).toBe(content);
  await renamed.focus();
  page.once('dialog', dialog => dialog.accept());
  await page.keyboard.press('Delete');
  await expect(renamed).toHaveCount(0);
  expect((await page.request.get(`/api/workspaces/${workspace.id}/file`, { params: { path: 'src/created/renamed.ts' } })).status()).toBe(404);
  await expect(tree.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1);
  await expect(folder).toHaveAttribute('tabindex', '0');
  await editor.getByRole('button', { name: 'Recently deleted', exact: true }).click();
  const trash = page.getByRole('dialog', { name: 'Recently deleted', exact: true });
  await trash.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(trash).toContainText('Nothing in the trash');
  await trash.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(renamed).toBeVisible();
  expect((await readFile(page, workspace, 'src/created/renamed.ts')).content).toBe(content);
  await folder.focus();
  await page.keyboard.press('F2');
  await rename.getByLabel('New path', { exact: true }).fill('src/moved');
  await rename.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(rename).toBeHidden();
  await expect(tree.getByRole('treeitem', { name: 'moved', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(tree.locator('[data-tree-path="src/moved/renamed.ts"]')).toBeVisible();
  expect((await readFile(page, workspace, 'src/moved/renamed.ts')).content).toBe(content);
});

test('lazy folder loading exposes failures and Retry retains cached children during refresh errors', async ({ page }) => {
  const { workspace, editor, tree } = await prepare(page, 'recovery');
  const folderUrl = `**/api/workspaces/${workspace.id}/tree-page?path=src&*`;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(folderUrl, async route => {
    await gate;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Folder temporarily unavailable.' }) });
  });
  try {
    await tree.getByRole('treeitem', { name: 'src', exact: true }).click();
    await expect(tree.getByRole('status').filter({ hasText: 'Loading…' })).toBeVisible();
    release();
    await expect(tree.getByRole('alert')).toContainText('Folder temporarily unavailable.');
  } finally { release(); await page.unroute(folderUrl); }
  await tree.getByRole('button', { name: 'Retry loading src', exact: true }).click();
  const app = tree.getByRole('treeitem', { name: 'app.tsx', exact: true });
  await expect(app).toBeVisible();
  await expect(tree.getByRole('alert')).toHaveCount(0);
  await page.route(folderUrl, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Refresh temporarily unavailable.' }) }));
  await editor.getByRole('button', { name: 'Refresh files', exact: true }).click();
  await expect(tree.getByRole('alert')).toContainText('Refresh temporarily unavailable.');
  await expect(app).toBeVisible();
  await page.unroute(folderUrl);
  await tree.getByRole('button', { name: 'Retry loading src', exact: true }).click();
  await expect(tree.getByRole('alert')).toHaveCount(0);
  await app.click();
  await expect(editor.locator('.view-lines').first()).toContainText('saved source');
});

test('editor tabs distinguish duplicate names, support arrow navigation, and reveal the current unsaved file', async ({ page }, testInfo) => {
  const { workspace, editor, tree } = await prepare(page, 'editor navigation');
  expect((await page.request.post(`/api/workspaces/${workspace.id}/files`, { headers, data: { path: 'src/components/app.tsx', kind: 'file' } })).status()).toBe(201);
  expect((await page.request.put(`/api/workspaces/${workspace.id}/file`, { headers, data: { path: 'src/components/app.tsx', content: 'export const other = "second file";\n' } })).ok()).toBe(true);
  await tree.getByRole('treeitem', { name: 'src', exact: true }).click();
  await tree.locator('[data-tree-path="src/app.tsx"]').click();
  await edit(page, editor, 'export const app = "keep this unsaved buffer";\n');
  await tree.getByRole('treeitem', { name: 'components', exact: true }).click();
  await tree.locator('[data-tree-path="src/components/app.tsx"]').click();
  const first = editor.locator('[role="tab"][aria-description^="src/app.tsx"]');
  const second = editor.locator('[role="tab"][aria-description^="src/components/app.tsx"]');
  await expect(first).toHaveAccessibleName('app.tsx');
  await expect(second).toHaveAccessibleName('app.tsx');
  await expect(first.locator('.editor-tab-directory')).toHaveText('src');
  await expect(second.locator('.editor-tab-directory')).toHaveText('src/components');
  await expect(editor.locator('.editor-tabbar [role="tab"][tabindex="0"]')).toHaveCount(1);
  await second.focus();
  await second.press('ArrowLeft');
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await expect(editor.locator('.view-lines').first()).toContainText('keep this unsaved buffer');
  await first.press('End');
  await expect(second).toBeFocused();
  await expect(editor.locator('.view-lines').first()).toContainText('second file');
  await second.press('Home');
  await expect(first).toBeFocused();
  await editor.getByRole('button', { name: 'Collapse folders', exact: true }).click();
  await expect(tree.locator('[data-tree-path="src/app.tsx"]')).toHaveCount(0);
  await editor.getByRole('button', { name: 'Reveal src/app.tsx in Files', exact: true }).click();
  const revealed = tree.locator('[data-tree-path="src/app.tsx"]');
  await expect(revealed).toBeVisible();
  await expect(revealed).toBeFocused();
  await expect(revealed).toHaveAttribute('aria-selected', 'true');
  await expect(revealed.locator('.editor-dirty-dot')).toBeVisible();
  expect((await readFile(page, workspace, 'src/app.tsx')).content).toBe(source);
  await expect(editor.locator('.view-lines').first()).toContainText('keep this unsaved buffer');
  await testInfo.attach('editor-and-explorer-desktop', { body: await editor.screenshot(), contentType: 'image/png' });
});

test('initial directory and file reads use skeletons while refreshes retain actual content', async ({ page }) => {
  const { workspace, editor, tree } = await prepare(page, 'loading');
  const rootUrl = `**/api/workspaces/${workspace.id}/tree-page?path=&*`;
  let releaseTree!: () => void;
  let treeGate = new Promise<void>(resolve => { releaseTree = resolve; });
  await page.route(rootUrl, async route => { await treeGate; await route.continue(); });
  try {
    await page.reload();
    await expect(tree).toHaveAttribute('aria-busy', 'true');
    await expect(tree.getByRole('status')).toHaveText('Loading files…');
    await expect(tree.locator('.arc-list-skeleton')).toBeVisible();
    await expect(tree.getByRole('treeitem')).toHaveCount(0);
    await expect(editor.locator('.editor-explorer-empty')).toHaveCount(0);
    releaseTree();
    await expect(tree.getByRole('treeitem', { name: 'README.md', exact: true })).toBeVisible();
    await expect(tree.locator('.arc-list-skeleton')).toHaveCount(0);
  } finally { releaseTree(); await page.unrouteAll({ behavior: 'wait' }); }

  const fileUrl = `**/api/workspaces/${workspace.id}/file?path=README.md`;
  let releaseFile!: () => void;
  const fileGate = new Promise<void>(resolve => { releaseFile = resolve; });
  await page.route(fileUrl, async route => { await fileGate; await route.continue(); });
  try {
    await tree.getByRole('treeitem', { name: 'README.md', exact: true }).click();
    await expect(editor.locator('.arc-editor-skeleton')).toBeVisible();
    await expect(editor.locator('.arc-editor-skeleton').getByRole('status')).toHaveText('Opening file…');
    releaseFile();
    await expect(editor.locator('.view-lines').first()).toContainText('Explorer test');
  } finally { releaseFile(); await page.unrouteAll({ behavior: 'wait' }); }

  treeGate = new Promise<void>(resolve => { releaseTree = resolve; });
  await page.route(rootUrl, async route => { await treeGate; await route.continue(); });
  try {
    await editor.getByRole('button', { name: 'Refresh files', exact: true }).click();
    await expect(tree).toHaveAttribute('aria-busy', 'true');
    await expect(tree.getByRole('treeitem', { name: 'README.md', exact: true })).toBeVisible();
    await expect(tree.locator('.arc-list-skeleton')).toHaveCount(0);
    await expect(editor.locator('.view-lines').first()).toContainText('Explorer test');
  } finally { releaseTree(); await page.unrouteAll({ behavior: 'wait' }); }
});

test.describe('phone explorer', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('keeps touch menus and files/editor navigation usable with a dirty nested file', async ({ page }, testInfo) => {
    const { editor, tree } = await prepare(page, 'phone');
    const src = tree.getByRole('treeitem', { name: 'src', exact: true });
    await src.tap();
    const app = tree.getByRole('treeitem', { name: 'app.tsx', exact: true });
    for (const target of [src, app, tree.getByRole('button', { name: 'Actions for app.tsx', exact: true })]) {
      const bounds = await target.boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
    }
    await app.tap();
    await expect(editor.locator('.editor-main')).toBeVisible();
    await expect(editor.locator('.editor-sidebar')).toBeHidden();
    await edit(page, editor, 'export const app = "unsaved on phone";\n');
    await editor.getByRole('button', { name: 'Show files', exact: true }).tap();
    await expect(editor.locator('.editor-sidebar')).toBeVisible();
    await expect(editor.locator('.editor-main')).toBeHidden();
    await expect(app).toHaveAttribute('aria-current', 'true');
    await expect(app.locator('.editor-dirty-dot')).toBeVisible();
    await tree.getByRole('button', { name: 'Actions for app.tsx', exact: true }).tap();
    const menu = page.getByRole('menu', { name: 'Actions for app.tsx', exact: true });
    await expect(menu).toBeVisible();
    const bounds = await page.locator('.cw-dropdown-surface').boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await page.keyboard.press('Escape');
    await testInfo.attach('explorer-phone', { body: await editor.locator('.editor-sidebar').screenshot(), contentType: 'image/png' });
    await editor.getByRole('button', { name: 'Back to editor', exact: true }).tap();
    await expect(editor.locator('.view-lines').first()).toContainText('unsaved on phone');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
