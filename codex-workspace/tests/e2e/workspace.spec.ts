import { test, expect, type Page, type APIRequestContext, type Route } from '@playwright/test';
import type { Workspace } from '../../shared/types';

const password = process.env.PLAYWRIGHT_PASSWORD || 'browser-test-workspace-password';
const headers = { 'X-Codex-Workspace': '1' };

async function signIn(request: APIRequestContext) {
  const response = await request.post('/api/session', { headers, data: { password } });
  expect(response.status()).toBe(200);
}
async function seed(request: APIRequestContext, name: string) {
  const response = await request.post('/api/workspaces', { headers, data: { name, initializeGit: true } });
  expect(response.status()).toBe(201);
  const workspace = await response.json() as Workspace;
  await request.patch(`/api/workspaces/${workspace.id}`, { headers, data: { active: true } });
  await request.post(`/api/workspaces/${workspace.id}/files`, { headers, data: { path: 'hello.ts', kind: 'file' } });
  await request.put(`/api/workspaces/${workspace.id}/file`, { headers, data: { path: 'hello.ts', content: 'export const greeting = "Hello from the workspace";\n' } });
  return workspace;
}
async function openView(page: Page, name: string) {
  await expect(page.locator('.app-shell')).toBeVisible();
  const mobile = page.viewportSize()!.width < 680;
  const pane = name === 'Agent' ? 'agent' : name === 'Editor' ? 'editor' : null;
  if (!mobile && pane && await page.locator(`#${pane}-workbench`).isVisible()) return;
  const navigation = page.getByRole('navigation', { name: mobile ? 'Mobile navigation' : 'Main navigation' });
  await navigation.getByRole('button', { name, exact: true }).click();
}

async function expectDark(page: Page) {
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(9, 9, 9)');
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'dark');
}

test('password gate, failed password, session persistence, and lock', async ({ page, request }) => {
  expect((await request.get('/api/workspaces')).status()).toBe(401);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => localStorage.setItem('codex.theme', 'system'));
  let releaseAssets!: () => void;
  const assetsReleased = new Promise<void>(resolve => { releaseAssets = resolve; });
  const heldAssetTypes = new Set<string>();
  let continuedAssets = 0;
  const holdAssets = async (route: Route) => {
    const type = route.request().resourceType();
    const isAsset = ['script', 'stylesheet'].includes(type);
    if (isAsset) { heldAssetTypes.add(type); await assetsReleased; }
    await route.continue();
    if (isAsset) continuedAssets++;
  };
  await page.route('**/*', holdAssets);
  try {
    await page.goto('/work', { waitUntil: 'commit' });
    await expect(page.locator('#root')).toBeAttached();
    await expect.poll(() => [...heldAssetTypes].sort()).toEqual(['script', 'stylesheet']);
    expect(continuedAssets).toBe(0);
    // The initial document must paint dark while both CSS and JavaScript are delayed.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe('rgb(9, 9, 9)');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
  } finally {
    releaseAssets();
    // Let every delayed continuation finish before disabling interception.
    // Removing the route first can auto-continue a request already held here.
    await page.unrouteAll({ behavior: 'wait' });
  }
  expect(continuedAssets).toBeGreaterThanOrEqual(2);
  await expect(page.getByLabel('Workspace password', { exact: true })).toBeVisible();
  await expectDark(page);
  await page.getByLabel('Workspace password', { exact: true }).fill('incorrect-test-password');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('incorrect');
  await page.getByLabel('Workspace password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('main', { name: 'Workspace', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('main', { name: 'Workspace', exact: true })).toBeVisible();
  await expectDark(page);
  expect(await page.evaluate(() => localStorage.getItem('codex.theme'))).toBeNull();
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await expect(page.getByLabel('Workspace password', { exact: true })).toBeVisible();
  await expectDark(page);
  expect((await page.request.get('/api/workspaces')).status()).toBe(401);
});

test('editor saves real files and terminal runs in the same workspace', async ({ page }) => {
  await signIn(page.request);
  const workspace = await seed(page.request, 'Browser editor project');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => localStorage.setItem('codex.theme', 'light'));
  await page.route('**/api/bootstrap', async route => {
    const response = await route.fetch();
    const legacy = await response.json();
    legacy.settings.theme = 'light';
    await route.fulfill({ response, json: legacy });
  });
  await page.goto('/work');
  await expectDark(page);
  await openView(page, 'Editor');
  const editor = page.getByRole('region', { name: 'Code editor' });
  await editor.getByRole('treeitem', { name: /hello\.ts/ }).click();
  const textarea = editor.locator('.monaco-editor textarea.inputarea').first();
  await expect(textarea).toBeVisible();
  await expect(editor.locator('.editor-panel')).toHaveAttribute('data-editor-theme', 'codex-dark');
  expect(await editor.locator('.monaco-editor').first().evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(17, 17, 17)');
  await textarea.focus();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.press('ControlOrMeta+KeyA');
  await page.keyboard.insertText('export const greeting = "Saved from the browser";\n');
  await page.keyboard.press('ControlOrMeta+KeyS');
  await expect.poll(async () => (await (await page.request.get(`/api/workspaces/${workspace.id}/file`, { params: { path: 'hello.ts' } })).json()).content).toBe('export const greeting = "Saved from the browser";\n');
  await openView(page, 'Terminal');
  const terminal = page.getByRole('region', { name: 'Workspace terminal' });
  await expect(terminal).toBeVisible();
  const shell = terminal.locator('.xterm-helper-textarea');
  await expect(shell).toBeAttached();
  expect(await terminal.locator('.xterm-viewport').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(17, 17, 17)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.emulateMedia({ colorScheme: 'light' });
  await expectDark(page);
  expect(await terminal.locator('.xterm-viewport').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(17, 17, 17)');
  await shell.focus();
  await page.keyboard.insertText("printf 'BROWSER_%s\\n' 'PTY_OK'; pwd");
  await page.keyboard.press('Enter');
  await expect(terminal.locator('.xterm-rows')).toContainText('BROWSER_PTY_OK');
  await expect(terminal.locator('.xterm-rows')).toContainText(workspace.path);
  await page.reload();
  await openView(page, 'Terminal');
  await expect(page.getByRole('region', { name: 'Workspace terminal' }).locator('.xterm-rows')).toContainText('BROWSER_PTY_OK');
});

test('settings, workspace switching, and repository connection screens are usable', async ({ page }) => {
  await signIn(page.request);
  await seed(page.request, 'Browser controls project');
  await page.goto('/work');
  await expect(page.getByRole('main', { name: 'Workspace', exact: true })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+,');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Color theme', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Dark|Light|System)$/ })).toHaveCount(0);
  const fontSize = page.getByLabel('Editor font size', { exact: true });
  await fontSize.focus();
  await page.keyboard.press('Home');
  for (let step = 0; step < 6; step++) await page.keyboard.press('ArrowRight');
  await expect(fontSize).toHaveValue('17');
  const wordWrap = page.getByRole('switch', { name: 'Wrap long lines', exact: true });
  if (await wordWrap.getAttribute('aria-checked') !== 'true') await wordWrap.click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expectDark(page);
  expect(await (await page.request.get('/api/settings')).json()).toMatchObject({ theme: 'dark', fontSize: 17, wordWrap: true });
  await openView(page, 'Repositories');
  await expect(page.getByRole('region', { name: 'GitHub repositories' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'GitHub repositories' })).toContainText('GitHub');
  await openView(page, 'Source control');
  const git = page.getByRole('region', { name: 'Source control', exact: true });
  await expect(git).toBeVisible();
  await expect(git).toContainText('hello.ts');
  await git.getByRole('button', { name: 'Stage all changes', exact: true }).click();
  await git.getByLabel('Commit message', { exact: true }).fill('Save a real browser commit');
  await git.getByRole('button', { name: /Commit staged/ }).click();
  await expect(git).toContainText(/working tree is clean|no changes|up to date|nothing to commit/i);
});

for (const viewport of [
  { name: 'phone', width: 390, height: 844, layout: 'mobile' },
  { name: 'tablet', width: 820, height: 1180, layout: 'tablet' },
  { name: 'laptop', width: 1280, height: 800, layout: 'laptop' },
  { name: 'desktop', width: 1600, height: 1000, layout: 'desktop' },
]) {
  test(`${viewport.name} has its intended layout with functional navigation`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await signIn(page.request);
    const preferences = await (await page.request.get('/api/ui-state')).json();
    const layoutSave = await page.request.patch('/api/ui-state', { headers, data: { revision: preferences.revision, changes: [
      { section: 'layout', profile: viewport.layout, key: 'split', value: viewport.layout === 'desktop' ? 'split' : 'focus' },
      { section: 'layout', profile: viewport.layout, key: 'sidebar', value: viewport.layout === 'desktop' ? 'expanded' : 'collapsed' },
    ] } });
    expect(layoutSave.status()).toBe(200);
    await page.goto('/work');
    await expect(page.locator(`.app-shell.layout-${viewport.layout}`)).toBeVisible();
    await openView(page, 'Agent');
    await expect(page.getByRole('region', { name: 'Agent conversation' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Message Codex' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (viewport.layout === 'mobile') await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
    if (viewport.layout === 'desktop') await expect(page.getByRole('region', { name: 'Code editor' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}.png`), fullPage: true, animations: 'disabled' });
    await openView(page, viewport.layout === 'mobile' ? 'Files' : 'Editor');
    await expect(page.getByRole('region', { name: 'Code editor' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
