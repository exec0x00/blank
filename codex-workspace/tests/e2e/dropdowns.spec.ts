import { test, expect, type Page, type Locator } from '@playwright/test';
import type { AppSettings, CodexModelCatalog, CodexRuntimeStatus, Workspace } from '../../shared/types';

const headers = { 'X-Codex-Workspace': '1' };
const password = process.env.PLAYWRIGHT_PASSWORD || 'browser-test-workspace-password';
type NativePreferences = Pick<AppSettings, 'model' | 'reasoningEffort' | 'reasoningSummary' | 'verbosity' | 'webSearchMode' | 'autoApprove'>;
const nativeEfforts = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const models: CodexModelCatalog = { backend: 'codex-cli', connected: true,
  models: ['gpt-5.6-sol', 'gpt-5.6-cyber', 'gpt-daybreak-red-latest'],
  catalog: [['gpt-5.6-sol', 'GPT-5.6 Sol'], ['gpt-5.6-cyber', 'GPT-5.6 Cyber'], ['gpt-daybreak-red-latest', 'Daybreak Red']].map(([model, displayName]) => ({
    id: `catalog:${model}`, model, displayName, description: 'Controlled native metadata for dropdown acceptance.', hidden: model.includes('daybreak'),
    supportedReasoningEfforts: nativeEfforts.map(reasoningEffort => ({ reasoningEffort, description: '' })),
    defaultReasoningEffort: 'medium', inputModalities: ['text'], isDefault: model === 'gpt-5.6-sol',
  })) };
const runtimeMetadata: CodexRuntimeStatus = { backend: 'codex-cli', state: 'ready', version: '0.155.1', installedVersion: '0.155.1',
  startedAt: null, updatedAt: '2026-09-22T00:00:00Z', canUpdate: true, updateBlockedReason: null, error: null, activeTurns: 0,
  capabilities: { conversations: true, pagination: true, queue: true, goals: true, skills: true, plan: true, review: true, historyRevert: true } };

/** Native model/config responses are explicit browser fixtures. File, Git,
 * appearance and authentication operations still use the actual offline app. */
async function nativeMetadata(page: Page) {
  let preferences: NativePreferences = { model: 'gpt-5.6-sol', reasoningEffort: 'medium', reasoningSummary: 'auto',
    verbosity: 'low', webSearchMode: 'cached', autoApprove: false };
  const writes: Array<Partial<NativePreferences>> = [];
  await page.route('**/api/models', route => route.fulfill({ json: models }));
  await page.route('**/api/codex/runtime', route => route.fulfill({ json: runtimeMetadata }));
  await page.route('**/api/threads?**', route => route.fulfill({ json: { items: [], olderCursor: null, newerCursor: null, hasOlder: false, hasNewer: false } }));
  await page.route('**/api/bootstrap', async route => {
    const response = await route.fetch(), body = await response.json();
    body.settings = { ...body.settings, ...preferences, agentConfigured: true };
    await route.fulfill({ response, json: body });
  });
  await page.route('**/api/settings', async route => {
    if (route.request().method() === 'GET') {
      const response = await route.fetch();
      if (!response.ok()) return route.fulfill({ response });
      return route.fulfill({ response, json: { ...await response.json(), ...preferences, agentConfigured: true } });
    }
    if (route.request().method() !== 'PATCH') return route.continue();
    const patch = route.request().postDataJSON() as Partial<NativePreferences & Pick<AppSettings, 'fontSize' | 'wordWrap'>>;
    expect(Object.keys(patch).every(key => ['model', 'reasoningEffort', 'reasoningSummary', 'verbosity', 'webSearchMode', 'autoApprove', 'fontSize', 'wordWrap'].includes(key))).toBe(true);
    const { fontSize, wordWrap, ...nativePatch } = patch;
    const appearance = { ...(fontSize !== undefined ? { fontSize } : {}), ...(wordWrap !== undefined ? { wordWrap } : {}) };
    const response = Object.keys(appearance).length ? await page.request.patch('/api/settings', { headers, data: appearance }) : await page.request.get('/api/settings');
    expect(response.status()).toBe(200);
    writes.push(nativePatch); preferences = { ...preferences, ...nativePatch };
    await route.fulfill({ response, json: { ...await response.json(), ...preferences, agentConfigured: true } });
  });
  return { writes, read: () => structuredClone(preferences) };
}

async function prepare(page: Page, name: string) {
  expect((await page.request.post('/api/session', { headers, data: { password } })).status()).toBe(200);
  const response = await page.request.post('/api/workspaces', { headers, data: { name, initializeGit: true } });
  expect(response.status()).toBe(201);
  const workspace = await response.json() as Workspace;
  expect((await page.request.patch(`/api/workspaces/${workspace.id}`, { headers, data: { active: true } })).ok()).toBe(true);
  expect((await page.request.patch('/api/settings', { headers, data: { fontSize: 14, wordWrap: false } })).ok()).toBe(true);
  expect((await page.request.post(`/api/workspaces/${workspace.id}/files`, { headers, data: { path: 'menu-test.ts', kind: 'file' } })).status()).toBe(201);
  expect((await page.request.put(`/api/workspaces/${workspace.id}/file`, { headers, data: { path: 'menu-test.ts', content: 'export const dropdowns = "real file";\n' } })).ok()).toBe(true);
  return { workspace, native: await nativeMetadata(page) };
}

async function view(page: Page, name: string) {
  await expect(page.locator('.app-shell')).toBeVisible();
  const mobile = page.viewportSize()!.width < 680;
  const pane = name === 'Editor' ? 'editor' : name === 'Agent' ? 'agent' : null;
  if (!mobile && pane && await page.locator(`#${pane}-workbench`).isVisible()) return;
  const navigation = page.getByRole('navigation', { name: mobile ? 'Mobile navigation' : 'Main navigation' });
  await navigation.getByRole('button', { name: mobile && name === 'Editor' ? 'Files' : name, exact: true }).click();
}

async function openEditor(page: Page) {
  await view(page, 'Editor');
  const editor = page.getByRole('region', { name: 'Code editor', exact: true });
  await editor.getByRole('treeitem', { name: /menu-test\.ts/ }).click();
  await expect(editor.locator('.monaco-editor textarea.inputarea').first()).toBeVisible();
  return editor;
}

async function safeSurface(surface: Locator, page: Page) {
  await expect(surface).toBeVisible();
  const measurement = await surface.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const viewport = window.visualViewport;
    return {
      left: box.left, top: box.top, right: box.right, bottom: box.bottom,
      viewportLeft: viewport?.offsetLeft || 0, viewportTop: viewport?.offsetTop || 0,
      viewportWidth: viewport?.width || innerWidth, viewportHeight: viewport?.height || innerHeight,
      overflowing: document.documentElement.scrollWidth > innerWidth,
      decorations: [element, ...element.querySelectorAll('*')].map((node) => {
        const style = getComputedStyle(node);
        return { shadow: style.boxShadow, textShadow: style.textShadow, backdrop: style.backdropFilter };
      }),
    };
  });
  expect(measurement.left).toBeGreaterThanOrEqual(measurement.viewportLeft);
  expect(measurement.top).toBeGreaterThanOrEqual(measurement.viewportTop);
  expect(measurement.right).toBeLessThanOrEqual(measurement.viewportLeft + measurement.viewportWidth);
  expect(measurement.bottom).toBeLessThanOrEqual(measurement.viewportTop + measurement.viewportHeight);
  expect(measurement.overflowing).toBe(false);
  for (const decoration of measurement.decorations) expect(decoration).toEqual({ shadow: 'none', textShadow: 'none', backdrop: 'none' });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  return measurement;
}

for (const selection of [
  { label: 'max', visibleLabel: 'Max', keys: ['End', 'ArrowUp'], wire: 'max' },
  { label: 'Not sent', visibleLabel: 'Codex default', keys: ['Home'], wire: null },
]) {
test(`settings dropdown preserves the ${selection.label} draft and Escape closes the menu before the dialog`, async ({ page }) => {
  const setup = await prepare(page, 'Dropdown settings');
  await page.goto('/work');
  await expect(page.getByRole('main', { name: 'Workspace', exact: true })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+,');
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(dialog).toBeVisible();
  const effort = dialog.getByRole('combobox', { name: 'Reasoning effort', exact: true });
  await expect(effort).toBeEnabled();
  await effort.focus();
  await expect(effort).toBeFocused();
  await page.keyboard.press('ArrowDown');
  const efforts = page.getByRole('listbox', { name: 'Reasoning effort', exact: true });
  await expect(efforts).toBeVisible();
  await expect(efforts.getByRole('option')).toHaveText(['Codex default', 'Low', 'Medium', 'High', 'Xhigh', 'Max', 'Ultra']);
  for (const key of selection.keys) await page.keyboard.press(key);
  await page.keyboard.press('Enter');
  await expect(efforts).toBeHidden();
  await expect(effort).toHaveText(selection.visibleLabel);
  await expect(effort).toBeFocused();
  expect(setup.native.read().reasoningEffort).toBe('medium');
  expect(setup.native.writes).toEqual([]);
  const model = dialog.getByRole('combobox', { name: 'Default model', exact: true });
  await model.click();
  const search = page.getByRole('combobox', { name: 'Search Default model', exact: true });
  await search.fill('gpt-5.6-cyber');
  await expect(page.locator('[role="option"][data-value="gpt-5.6-cyber"]')).toBeVisible();
  await search.fill('gpt-daybreak-red-latest');
  await expect(page.locator('[role="option"][data-value="gpt-daybreak-red-latest"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox', { name: 'Default model', exact: true })).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(model).toBeFocused();
  await expect(model).toHaveText('GPT-5.6 Sol');
  await expect(effort).toHaveText(selection.visibleLabel);
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(setup.native.writes).toEqual([{ reasoningEffort: selection.wire }]);
  expect((await page.evaluate(async () => (await fetch('/api/settings')).json())).reasoningEffort).toBe(selection.wire);
  await page.reload();
  await expect(page.getByRole('main', { name: 'Workspace', exact: true })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+,');
  await expect(dialog.getByRole('combobox', { name: 'Reasoning effort', exact: true })).toHaveText(selection.visibleLabel);
});
}

test('editor commands support keyboard navigation, disabled commands, toggles, and focus return', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await prepare(page, 'Dropdown editor commands');
  await page.goto('/work');
  const editor = await openEditor(page);
  const trigger = editor.getByRole('button', { name: 'Editor options', exact: true });
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  const menu = page.getByRole('menu', { name: 'Editor options', exact: true });
  const wrap = menu.getByRole('menuitemcheckbox', { name: 'Word wrap', exact: true });
  await expect(wrap).toBeFocused();
  await expect(menu.getByRole('menuitem', { name: 'Save all files', exact: true })).toBeDisabled();
  const wasChecked = await wrap.getAttribute('aria-checked');
  await page.keyboard.press('Space');
  await expect(wrap).toHaveAttribute('aria-checked', wasChecked === 'true' ? 'false' : 'true');
  await expect(menu).toBeVisible();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Reload from disk', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.type('save');
  await expect(menu.getByRole('menuitem', { name: 'Save a copy…', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await editor.getByRole('button', { name: 'Find in file', exact: true }).click();
  await expect(menu).toBeHidden();
  expect(errors).toEqual([]);
});

test('file context actions use the shared menu and still rename a real workspace file', async ({ page }) => {
  const { workspace } = await prepare(page, 'Dropdown file actions');
  await page.goto('/work');
  await view(page, 'Editor');
  const editor = page.getByRole('region', { name: 'Code editor', exact: true });
  const file = editor.getByRole('treeitem', { name: /menu-test\.ts/ });
  await file.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Actions for menu-test.ts', exact: true });
  await expect(menu).toBeVisible();
  await safeSurface(page.locator('.cw-dropdown-surface'), page);
  await menu.getByRole('menuitem', { name: 'Rename or move', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename or move', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('New path', { exact: true }).fill('renamed-from-menu.ts');
  await dialog.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(editor.getByRole('treeitem', { name: /renamed-from-menu\.ts/ })).toBeVisible();
  const saved = await page.request.get(`/api/workspaces/${workspace.id}/file`, { params: { path: 'renamed-from-menu.ts' } });
  expect((await saved.json()).content).toBe('export const dropdowns = "real file";\n');
});

test('Git branch selection switches the real repository and retains keyboard focus', async ({ page }) => {
  const { workspace } = await prepare(page, 'Dropdown Git branches');
  const base = `/api/workspaces/${workspace.id}/git`;
  expect((await page.request.post(`${base}/stage`, { headers, data: { paths: ['menu-test.ts'] } })).ok()).toBe(true);
  expect((await page.request.post(`${base}/commit`, { headers, data: { message: 'Seed dropdown branch test' } })).ok()).toBe(true);
  expect((await page.request.post(`${base}/branch`, { headers, data: { name: 'dropdown-feature', create: true } })).ok()).toBe(true);
  expect((await page.request.post(`${base}/branch`, { headers, data: { name: 'main' } })).ok()).toBe(true);
  await page.goto('/work');
  await view(page, 'Source control');
  const trigger = page.getByRole('combobox', { name: 'Current Git branch', exact: true });
  await expect(trigger).toHaveText('main');
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('dropdown');
  await expect(page.getByRole('option', { name: 'dropdown-feature', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'dropdown-feature', exact: true })).not.toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveText('dropdown-feature');
  await expect.poll(async () => (await (await page.request.get(`${base}/status`)).json()).branch).toBe('dropdown-feature');
  await expect(trigger).toBeFocused();
});

test('Git file pages stay bounded, retry without clearing rows, and window large patches', async ({ page }) => {
  const { workspace } = await prepare(page, 'Paged Git changes');
  const base = `/api/workspaces/${workspace.id}/git`;
  const revision = 'a'.repeat(64);
  const files = Array.from({ length: 120 }, (_, index) => ({ path: `file-${String(index).padStart(3, '0')}.txt`, status: 'M', staged: false }));
  const summary = { isRepository: true, branch: 'main', ahead: 0, behind: 0, changedFileCount: 120, stagedCount: 0, changesCount: 120, conflictCount: 0, revision };
  let failedSecond = false;
  const stageBodies: unknown[] = [], pageReads: string[] = [];
  await page.route(`**${base}/**`, async route => {
    const url = new URL(route.request().url());
    const reply = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === `${base}/status`) { expect(url.searchParams.get('summary')).toBe('true'); await reply(summary); return; }
    if (url.pathname === `${base}/changes`) {
      expect(url.searchParams.get('limit')).toBe('50');
      const offset = Number(url.searchParams.get('cursor')?.split(':')[1] || 0);
      const rows = url.searchParams.get('staged') === 'true' ? [] : files.filter(file => file.path.includes(url.searchParams.get('query') || ''));
      pageReads.push(`${url.searchParams.get('staged')}:${offset}`);
      if (offset === 50 && !failedSecond) { failedSecond = true; await reply({ error: 'The next changes page is unavailable.' }, 503); return; }
      await reply({ files: rows.slice(offset, offset + 50), offset, total: rows.length, revision, ...(offset ? { previousCursor: `page:${Math.max(0, offset - 50)}` } : {}), ...(offset + 50 < rows.length ? { nextCursor: `page:${offset + 50}` } : {}) }); return;
    }
    if (url.pathname === `${base}/diff`) {
      const modified = Array.from({ length: 5000 }, (_, index) => `value${index}`).join('\n') + '\n';
      await reply({ path: url.searchParams.get('path'), original: '', modified, patch: `@@ -0,0 +1,5000 @@\n${modified.split('\n').filter(Boolean).map(line => `+${line}`).join('\n')}\n` }); return;
    }
    if (url.pathname === `${base}/stage`) { stageBodies.push(route.request().postDataJSON()); await reply(summary); return; }
    await route.continue();
  });
  await page.goto('/work'); await view(page, 'Source control');
  const changes = page.getByRole('region', { name: 'Changes', exact: true });
  await expect(changes.locator('.git-file-row')).toHaveCount(50);
  await changes.getByRole('button', { name: 'Next changes', exact: true }).click();
  await expect(changes.getByText('The next changes page is unavailable.', { exact: true })).toBeVisible();
  await expect(changes.locator('.git-file-row')).toHaveCount(50);
  await expect(changes.getByText('file-000.txt', { exact: true })).toBeVisible();
  await changes.getByRole('button', { name: 'Retry page', exact: true }).click();
  await expect(changes.getByText('file-050.txt', { exact: true })).toBeVisible();
  await expect(changes.getByText('file-000.txt', { exact: true })).toHaveCount(0);
  await expect(changes.locator('.git-file-row')).toHaveCount(50);
  await page.getByRole('searchbox', { name: 'Find changed files', exact: true }).fill('file-119');
  await expect(changes.locator('.git-file-row')).toHaveCount(1);
  await expect(changes.getByText('file-119.txt', { exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Find changed files', exact: true }).fill('');
  await expect(changes.locator('.git-file-row')).toHaveCount(50);
  await changes.locator('.git-file-main').first().click();
  const patch = page.getByRole('region', { name: 'Unified diff. Red lines were removed; green lines were added.', exact: true });
  await expect(patch.getByText('+value0', { exact: true })).toBeVisible();
  expect(await patch.locator('.git-patch-line').count()).toBeLessThan(300);
  await patch.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(patch.getByText('+value4999', { exact: true })).toBeVisible();
  expect(await patch.locator('.git-patch-line').count()).toBeLessThan(300);
  await page.getByRole('button', { name: 'Stage all changes', exact: true }).click();
  await expect.poll(() => stageBodies.length).toBe(1);
  expect(stageBodies[0]).toEqual({ all: true });
  expect(pageReads).toContain('false:50');
});

test('Git branch search fetches bounded pages and keeps keyboard focus through page navigation', async ({ page }) => {
  const { workspace } = await prepare(page, 'Paged branch picker');
  const base = `/api/workspaces/${workspace.id}/git`;
  const branches = Array.from({ length: 120 }, (_, index) => `branch-${String(index).padStart(3, '0')}`);
  const reads: { offset: number; query: string }[] = [];
  await page.route(`**${base}/branches?**`, async route => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get('query') || '';
    const offset = Number(url.searchParams.get('cursor')?.split(':')[1] || 0);
    const rows = branches.filter(branch => branch.includes(query));
    reads.push({ query, offset });
    expect(url.searchParams.get('limit')).toBe('50');
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ branches: rows.slice(offset, offset + 50), offset, total: rows.length, revision: 'b'.repeat(64), ...(offset ? { previousCursor: `page:${Math.max(0, offset - 50)}` } : {}), ...(offset + 50 < rows.length ? { nextCursor: `page:${offset + 50}` } : {}) }) });
  });
  await page.goto('/work'); await view(page, 'Source control');
  const trigger = page.getByRole('combobox', { name: 'Current Git branch', exact: true });
  await trigger.click();
  const input = page.getByRole('combobox', { name: 'Search Current Git branch', exact: true });
  await expect(page.getByRole('option')).toHaveCount(50);
  await input.press('PageDown');
  await expect(page.getByRole('option', { name: 'branch-050', exact: true })).toBeVisible();
  await expect(page.getByRole('option')).toHaveCount(50);
  await expect(input).toBeFocused();
  await input.fill('branch-119');
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option', { name: 'branch-119', exact: true })).toBeVisible();
  expect(reads).toContainEqual({ offset: 0, query: 'branch-119' });
  expect(reads).toContainEqual({ offset: 50, query: '' });
  await input.press('Escape');
  await expect(trigger).toBeFocused();
});

test('session expiry dismisses a portalled dropdown before the password gate', async ({ page }) => {
  await prepare(page, 'Dropdown session expiry');
  await page.goto('/work');
  await view(page, 'Agent');
  await page.getByRole('combobox', { name: 'Model', exact: true }).click();
  await expect(page.locator('.cw-dropdown-surface')).toBeVisible();
  expect((await page.request.delete('/api/session', { headers })).ok()).toBe(true);
  await page.evaluate(async () => {
    const response = await fetch('/api/workspaces', { headers: { 'X-Codex-Workspace': '1' } });
    if (response.status === 401) window.dispatchEvent(new CustomEvent('codex:session-expired'));
  });
  await expect(page.locator('.cw-dropdown-surface')).toHaveCount(0);
  await expect(page.getByLabel('Workspace password', { exact: true })).toBeVisible();
  await expect(page.getByRole('option')).toHaveCount(0);
});

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'desktop', width: 1600, height: 1000 },
]) {
  test(`${viewport.name} dropdowns stay visible, search correctly, and have no shadows`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await prepare(page, `Dropdown ${viewport.name}`);
    await page.goto('/work');
    await view(page, 'Agent');
    const model = page.getByRole('combobox', { name: 'Model', exact: true });
    await expect(model).toBeEnabled();
    const elapsed = await model.evaluate(async (element) => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const before = performance.now();
      (element as HTMLButtonElement).click();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return performance.now() - before;
    });
    const surface = page.locator('.cw-dropdown-surface');
    const measurements = await safeSurface(surface, page);
    await expect(surface).toHaveCSS('animation-name', 'none');
    if (viewport.name === 'phone') {
      const heights = await page.getByRole('option').evaluateAll((options) => options.map((option) => option.getBoundingClientRect().height));
      expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-dropdown.png`), animations: 'disabled' });
    await page.getByRole('combobox', { name: 'Search Model', exact: true }).fill('gpt-5.6-cyber');
    await expect(page.locator('[role="option"][data-value="gpt-5.6-cyber"]')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(model).toBeFocused();
    await expect(model).toContainText(/cyber/i);
    const editor = await openEditor(page);
    const language = editor.getByRole('combobox', { name: 'Language mode', exact: true });
    await language.click();
    await safeSurface(surface, page);
    await expect(surface).toHaveAttribute('data-side', 'top');
    await page.getByRole('combobox', { name: 'Search Language mode', exact: true }).fill('python');
    await expect(page.getByRole('option', { name: 'Python', exact: true })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(language).toHaveText('Python');
    const nativeSelects = await page.locator('select').evaluateAll((elements) => elements.filter((element) => !element.closest('.monaco-editor')).length);
    expect(nativeSelects).toBe(0);
    expect(errors).toEqual([]);
    await testInfo.attach('dropdown-measurements', { body: JSON.stringify({ viewport, firstFrameMs: elapsed, measurements, errors }, null, 2), contentType: 'application/json' });
  });
}
