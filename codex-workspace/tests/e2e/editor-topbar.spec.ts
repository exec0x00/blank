import { expect, test, type APIRequestContext, type Locator, type Page, type Route } from '@playwright/test';
import type { FileContent, UiState, Workspace } from '../../shared/types';
import type { EditorActionDetail } from '../../client/components/editor/editor-actions';

const password = process.env.PLAYWRIGHT_PASSWORD || 'browser-test-workspace-password';
const headers = { 'X-Codex-Workspace': '1' };
const original = 'export const first = "saved";\nexport const second = 2;\nexport const third = 3;\n';
type CapturedAction = { type: string; detail: EditorActionDetail };
type CapturedWindow = Window & { __editorActions: CapturedAction[] };

async function signIn(request: APIRequestContext) {
  expect((await request.post('/api/session', { headers, data: { password } })).status()).toBe(200);
}

async function createWorkspace(request: APIRequestContext, label: string, fileName = 'hello.ts') {
  const response = await request.post('/api/workspaces', { headers, data: { name: `Toolbar ${label} ${Date.now()}` } });
  expect(response.status()).toBe(201);
  const workspace = await response.json() as Workspace;
  expect((await request.post(`/api/workspaces/${workspace.id}/files`, { headers, data: { path: fileName, kind: 'file' } })).ok()).toBe(true);
  expect((await request.put(`/api/workspaces/${workspace.id}/file`, { headers, data: { path: fileName, content: original } })).ok()).toBe(true);
  return workspace;
}

async function selectInitialWorkspace(page: Page, workspace: Workspace, view: 'agent' | 'editor' = 'editor') {
  expect((await page.request.patch(`/api/workspaces/${workspace.id}`, { headers, data: { active: true } })).ok()).toBe(true);
  const width = page.viewportSize()!.width;
  const profile = width >= 1360 ? 'desktop' : width >= 1000 ? 'laptop' : width >= 680 ? 'tablet' : 'mobile';
  const preferences = await (await page.request.get('/api/ui-state')).json();
  const response = await page.request.patch('/api/ui-state', { headers, data: { revision: preferences.revision, changes: [
    { section: 'layout', profile, key: 'view', value: view },
    { section: 'layout', profile, key: 'split', value: 'focus' },
    { section: 'layout', profile, key: 'sidebar', value: 'expanded' },
  ] } });
  expect(response.ok()).toBe(true);
}

async function readFile(page: Page, workspace: Workspace, path = 'hello.ts'): Promise<FileContent> {
  const response = await page.request.get(`/api/workspaces/${workspace.id}/file`, { params: { path } });
  expect(response.status()).toBe(200);
  return response.json();
}

async function editFile(page: Page, content: string) {
  const textarea = page.getByRole('region', { name: 'Code editor', exact: true }).locator('.monaco-editor textarea.inputarea').first();
  await expect(textarea).toBeVisible();
  await textarea.focus();
  await page.keyboard.press('ControlOrMeta+KeyA');
  await page.keyboard.insertText(content);
}

async function openFromTree(page: Page, name = 'hello.ts') {
  const editor = page.getByRole('region', { name: 'Code editor', exact: true });
  await editor.getByRole('treeitem', { name, exact: true }).click();
  await expect(editor.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(editor.locator('.monaco-editor textarea.inputarea').first()).toBeVisible();
}

async function switchWorkspace(page: Page, workspace: Workspace) {
  await page.locator('.topbar-workspace').click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('list', { name: 'Workspaces', exact: true }) });
  if (await dialog.getByLabel('Find a workspace', { exact: true }).count()) await dialog.getByLabel('Find a workspace', { exact: true }).fill(workspace.name);
  await dialog.locator('.workspace-select').filter({ hasText: workspace.name }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.topbar-workspace')).toHaveText(workspace.name);
}

async function captureActions(page: Page) {
  await page.addInitScript(() => {
    const target = window as unknown as CapturedWindow;
    target.__editorActions = [];
    for (const type of ['codex:save-file', 'codex:quick-open', 'codex:toggle-explorer']) {
      window.addEventListener(type, event => target.__editorActions.push({ type, detail: (event as CustomEvent<EditorActionDetail>).detail }));
    }
  });
}

async function lastAction(page: Page, type: string): Promise<EditorActionDetail> {
  const action = await page.evaluate(type => (window as unknown as CapturedWindow).__editorActions.filter(action => action.type === type).at(-1), type);
  expect(action).toBeTruthy();
  return action!.detail;
}

async function replayAction(page: Page, type: string, detail: EditorActionDetail) {
  await page.evaluate(async ({ type, detail }) => {
    window.dispatchEvent(new CustomEvent(type, { detail }));
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  }, { type, detail });
}

async function expectNeutralFilePicker(dialog: Locator) {
  await expect(dialog).toHaveCSS('opacity', '1');
  await expect(dialog.getByRole('option').first()).toBeVisible();
  const appearance = await dialog.evaluate(element => {
    const surface = getComputedStyle(element);
    const backdrop = getComputedStyle(element, '::backdrop');
    const selected = getComputedStyle(element.querySelector('[role="option"][aria-selected="true"]')!);
    const icon = getComputedStyle(element.querySelector('.editor-file-icon')!);
    return {
      surface: surface.backgroundColor,
      backdrop: backdrop.backgroundColor,
      selected: selected.backgroundColor,
      icon: icon.color,
      effects: [surface, backdrop].map(style => ({
        image: style.backgroundImage, filter: style.filter,
        backdropFilter: style.backdropFilter, shadow: style.boxShadow,
      })),
    };
  });
  for (const [part, color] of Object.entries({ surface: appearance.surface, backdrop: appearance.backdrop, selected: appearance.selected, icon: appearance.icon })) {
    expect(color, `${part} should use a neutral color`).toMatch(/^rgba?\([\d.,\s]+\)$/);
    const channels = color.match(/[\d.]+/g)!.map(Number);
    expect(new Set(channels.slice(0, 3)).size, `${part} should have equal red, green, and blue channels`).toBe(1);
    if (part !== 'backdrop') expect(channels[3] ?? 1, `${part} should be opaque`).toBe(1);
  }
  for (const effects of appearance.effects) expect(effects).toEqual({ image: 'none', filter: 'none', backdropFilter: 'none', shadow: 'none' });
}

test('existing top bar controls the real editor through busy saves, failures, and version conflicts', async ({ page }) => {
  await signIn(page.request);
  const workspace = await createWorkspace(page.request, 'save states');
  await selectInitialWorkspace(page, workspace);
  await page.goto('/work');
  const topbar = page.locator('.app-topbar');
  const save = topbar.getByRole('button', { name: 'Save', exact: true });
  const editor = page.getByRole('region', { name: 'Code editor', exact: true });
  await expect(topbar.getByRole('button', { name: 'Go to file', exact: true })).toBeVisible();
  await expect(editor.locator('.editor-header')).toHaveCount(0);
  await expect(save).toBeDisabled();
  await openFromTree(page);
  await expect(save).toBeDisabled();

  const local = 'export const first = "saved from the top bar";\n';
  await editFile(page, local);
  await expect(save).toBeEnabled();
  const fileUrl = `**/api/workspaces/${workspace.id}/file`;
  await page.route(fileUrl, route => route.request().method() === 'PUT'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Storage temporarily unavailable.' }) })
    : route.continue());
  await save.click();
  await expect(page.getByRole('alert').filter({ hasText: 'Storage temporarily unavailable.' })).toBeVisible();
  await expect(save).toBeEnabled();
  expect((await readFile(page, workspace)).content).toBe(original);
  await expect(editor.locator('.view-lines').first()).toContainText('saved from the top bar');
  await page.unroute(fileUrl);

  let releaseSave!: () => void;
  const gate = new Promise<void>(resolve => { releaseSave = resolve; });
  let saveStarted = false;
  await page.route(fileUrl, async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    const response = await route.fetch();
    saveStarted = true;
    await gate;
    await route.fulfill({ response });
  });
  try {
    await save.click();
    await expect.poll(() => saveStarted).toBe(true);
    await expect(save).toBeDisabled();
    await expect(save).toHaveAttribute('aria-busy', 'true');
    releaseSave();
    await expect.poll(async () => (await readFile(page, workspace)).content).toBe(local);
    await expect(editor.locator('.editor-save-state')).toContainText('Saved');
    await expect(save).toBeDisabled();
  } finally { releaseSave(); await page.unroute(fileUrl); }

  await editFile(page, 'export const first = "unsaved local version";\n');
  const saved = await readFile(page, workspace);
  const external = 'export const first = "external disk version";\n';
  expect((await page.request.put(`/api/workspaces/${workspace.id}/file`, { headers, data: { path: 'hello.ts', content: external, expectedVersion: saved.version } })).ok()).toBe(true);
  const rejectedSave = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith(`/workspaces/${workspace.id}/file`) && response.status() === 409);
  await save.click();
  await rejectedSave;
  await expect(editor.locator('.editor-conflict-banner')).toBeVisible();
  await expect(editor.locator('.view-lines').first()).toContainText('unsaved local version');
  expect((await readFile(page, workspace)).content).toBe(external);
  await expect(save).toBeEnabled();
  page.once('dialog', dialog => dialog.accept());
  await editor.getByRole('button', { name: 'Use disk version', exact: true }).click();
  await expect(save).toBeDisabled();
  await expect(editor.locator('.view-lines').first()).toContainText('external disk version');

  await topbar.getByRole('button', { name: 'Hide files', exact: true }).click();
  await expect(editor.locator('.editor-sidebar')).toBeHidden();
  await topbar.getByRole('button', { name: 'Show files', exact: true }).click();
  await expect(editor.locator('.editor-sidebar')).toBeVisible();

  await topbar.getByRole('button', { name: 'Show editor and agent side by side', exact: true }).click();
  const agent = page.getByRole('region', { name: 'Agent conversation', exact: true });
  await expect(agent).toBeVisible();
  await expect(editor.locator('.editor-main')).toBeVisible();
  await expect(editor.locator('.editor-sidebar')).toBeVisible();
  await expect.poll(async () => {
    const [conversation, panel, code, explorer] = await Promise.all([
      agent.boundingBox(), editor.locator('.editor-panel').boundingBox(),
      editor.locator('.editor-main').boundingBox(), editor.locator('.editor-sidebar').boundingBox(),
    ]);
    return Boolean(conversation && panel && code && explorer
      && conversation.x + conversation.width <= panel.x + 1
      && code.x + code.width <= explorer.x + 1
      && Math.abs(explorer.x + explorer.width - panel.x - panel.width) <= 1);
  }).toBe(true);
  expect(await editor.locator('.editor-body').evaluate(body => [...body.children].map(child => child.classList.contains('editor-main') ? 'editor' : child.getAttribute('role') === 'separator' ? 'splitter' : child.classList.contains('editor-sidebar') ? 'explorer' : 'other'))).toEqual(['editor', 'splitter', 'explorer']);
  const agentSplitter = page.getByRole('separator', { name: 'Resize agent and editor', exact: true });
  const explorerSplitter = editor.getByRole('separator', { name: 'Resize editor and explorer', exact: true });
  for (const splitter of [agentSplitter, explorerSplitter]) {
    await expect(splitter).toBeVisible();
    await expect(splitter).toHaveAttribute('aria-orientation', 'vertical');
    await expect(splitter).toHaveAttribute('tabindex', '0');
    await expect(splitter).not.toHaveAttribute('aria-disabled', 'true');
    const range = await splitter.evaluate(element => ({
      min: Number(element.getAttribute('aria-valuemin')), max: Number(element.getAttribute('aria-valuemax')), value: Number(element.getAttribute('aria-valuenow')),
      controls: element.getAttribute('aria-controls')?.split(' ').map(id => Boolean(document.getElementById(id)?.getClientRects().length)),
    }));
    expect(range.min).toBeGreaterThan(0);
    expect(range.max).toBeGreaterThan(range.min);
    expect(range.value).toBeGreaterThanOrEqual(range.min);
    expect(range.value).toBeLessThanOrEqual(range.max);
    expect(range.controls).toEqual([true, true]);
  }
  await explorerSplitter.press('Home');
  const explorerMinimum = Number(await explorerSplitter.getAttribute('aria-valuemin'));
  await expect(explorerSplitter).toHaveAttribute('aria-valuenow', String(explorerMinimum));
  await explorerSplitter.press('ArrowLeft');
  const explorerWidth = explorerMinimum + 16;
  await expect(explorerSplitter).toBeFocused();
  await expect(explorerSplitter).toHaveAttribute('aria-valuenow', String(explorerWidth));
  await expect.poll(async () => Math.round((await editor.locator('.editor-sidebar').boundingBox())!.width)).toBe(explorerWidth);
  await expect.poll(async () => ((await (await page.request.get('/api/ui-state')).json()) as UiState).layouts.desktop?.explorerWidth).toBe(explorerWidth);
  await page.reload();
  await expect(agent).toBeVisible();
  await expect(explorerSplitter).toHaveAttribute('aria-valuenow', String(explorerWidth));
  await expect.poll(async () => Math.round((await editor.locator('.editor-sidebar').boundingBox())!.width)).toBe(explorerWidth);
});

test('Go to file queues once for the first lazy editor and binds to its actual controller', async ({ page }) => {
  await signIn(page.request);
  const workspace = await createWorkspace(page.request, 'first lazy mount');
  await selectInitialWorkspace(page, workspace, 'agent');
  await captureActions(page);
  let releaseImport!: () => void;
  const gate = new Promise<void>(resolve => { releaseImport = resolve; });
  let importsHeld = 0;
  const editorChunk = /\/(?:assets\/EditorPanel-[^/]+\.js|client\/components\/EditorPanel\.tsx)(?:\?.*)?$/;
  await page.route(editorChunk, async route => { importsHeld += 1; await gate; await route.continue(); });
  try {
    await page.goto('/work');
    await expect(page.getByRole('textbox', { name: 'Message Codex', exact: true })).toBeVisible();
    await expect(page.locator('.editor-panel')).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+KeyP');
    await expect.poll(() => importsHeld).toBeGreaterThan(0);
    await expect(page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    releaseImport();
    const dialog = page.getByRole('dialog', { name: 'Go to file', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'Find a file by name or path', exact: true })).toBeFocused();
    await expectNeutralFilePicker(dialog);
    const actions = await page.evaluate(() => (window as unknown as CapturedWindow).__editorActions.filter(action => action.type === 'codex:quick-open'));
    expect(actions).toHaveLength(1);
    expect(actions[0].detail).toMatchObject({ workspaceId: workspace.id, editorInstanceId: expect.any(String), generation: expect.any(Number) });
    await dialog.getByRole('option', { name: /hello\.ts/ }).click();
    const editor = page.getByRole('region', { name: 'Code editor', exact: true });
    await expect(editor.getByRole('tab', { name: 'hello.ts', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(editor.locator('.view-lines').first()).toContainText('export const first');
  } finally { releaseImport(); await page.unroute(editorChunk); }
});

test('lazy editor actions stay in their workspace and preserve scoped line and column navigation', async ({ page }) => {
  await signIn(page.request);
  const first = await createWorkspace(page.request, 'lazy first', 'first.ts');
  const second = await createWorkspace(page.request, 'lazy second', 'second.ts');
  await selectInitialWorkspace(page, first, 'agent');
  await captureActions(page);
  let releaseImport!: () => void;
  const gate = new Promise<void>(resolve => { releaseImport = resolve; });
  let importsHeld = 0;
  const editorChunk = /\/(?:assets\/EditorPanel-[^/]+\.js|client\/components\/EditorPanel\.tsx)(?:\?.*)?$/;
  await page.route(editorChunk, async (route: Route) => { importsHeld += 1; await gate; await route.continue(); });
  try {
    await page.goto('/work');
    await expect(page.getByRole('textbox', { name: 'Message Codex', exact: true })).toBeVisible();
    await expect(page.locator('.editor-panel')).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+KeyP');
    await expect.poll(() => importsHeld).toBeGreaterThan(0);
    await expect(page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await switchWorkspace(page, second);
    releaseImport();
    const editor = page.getByRole('region', { name: 'Code editor', exact: true });
    await expect(editor.getByRole('treeitem', { name: 'second.ts', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Go to file', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as CapturedWindow).__editorActions.filter(action => action.type === 'codex:quick-open').length)).toBe(0);

    await page.locator('.app-topbar').getByRole('button', { name: 'Go to file', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Go to file', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('option', { name: /second\.ts/ }).click();
    await expect(editor.getByRole('tab', { name: 'second.ts', exact: true })).toHaveAttribute('aria-selected', 'true');
    const scope = await lastAction(page, 'codex:quick-open');
    expect(scope.workspaceId).toBe(second.id);
    expect(scope.editorInstanceId).toEqual(expect.any(String));
    expect(scope.generation).toEqual(expect.any(Number));
    await replayAction(page, 'codex:open-file', { ...scope, path: 'second.ts', line: 3, column: 8 });
    await expect(editor.getByRole('button', { name: 'Ln 3, Col 8', exact: true })).toBeVisible();
    await expect(page.locator('.editor-header')).toHaveCount(0);
  } finally { releaseImport(); await page.unroute(editorChunk); }
});

test('Save rejects old workspaces, remounted editors, and pre-lock commands without losing dirty buffers', async ({ page }) => {
  await signIn(page.request);
  const first = await createWorkspace(page.request, 'scope first');
  const second = await createWorkspace(page.request, 'scope second');
  expect((await page.request.post(`/api/workspaces/${first.id}/files`, { headers, data: { path: 'other.ts', kind: 'file' } })).ok()).toBe(true);
  expect((await page.request.put(`/api/workspaces/${first.id}/file`, { headers, data: { path: 'other.ts', content: original } })).ok()).toBe(true);
  await selectInitialWorkspace(page, first);
  await captureActions(page);
  await page.goto('/work');
  const topbar = page.locator('.app-topbar');
  const save = topbar.getByRole('button', { name: 'Save', exact: true });
  const editor = page.getByRole('region', { name: 'Code editor', exact: true });
  await openFromTree(page);
  await editFile(page, 'export const value = "first saved";\n');
  await save.click();
  await expect.poll(async () => (await readFile(page, first)).content).toContain('first saved');
  await expect(save).toBeDisabled();
  const firstScope = await lastAction(page, 'codex:save-file');

  await openFromTree(page, 'other.ts');
  await editor.getByRole('tab', { name: 'hello.ts', exact: true }).click();
  const beforeTabSwitch = (await readFile(page, first)).content;
  const pendingSave = 'export const value = "first saved after tab switch";\n';
  await editFile(page, pendingSave);
  await expect(save).toBeEnabled();
  await save.evaluate(async button => {
    (button as HTMLButtonElement).click();
    document.querySelector<HTMLButtonElement>('.editor-tabbar button[role="tab"]:is([title="other.ts"], [data-tooltip-title="other.ts"])')!.click();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await expect(editor.getByRole('tab', { name: 'other.ts', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect((await readFile(page, first)).content).toBe(beforeTabSwitch);
  expect((await readFile(page, first, 'other.ts')).content).toBe(original);
  await editor.getByRole('tab', { name: 'hello.ts', exact: true }).click();
  await expect(editor.locator('.view-lines').first()).toContainText('first saved after tab switch');
  await save.click();
  await expect.poll(async () => (await readFile(page, first)).content).toBe(pendingSave);
  await expect(save).toBeDisabled();

  await switchWorkspace(page, second);
  await expect(save).toBeDisabled();
  await openFromTree(page);
  await editFile(page, 'export const value = "second unsaved";\n');
  await expect(save).toBeEnabled();
  await replayAction(page, 'codex:save-file', firstScope);
  expect((await readFile(page, second)).content).toBe(original);
  expect((await readFile(page, first)).content).toContain('first saved');
  await expect(editor.locator('.editor-save-state')).toContainText('Unsaved changes');
  await save.click();
  await expect.poll(async () => (await readFile(page, second)).content).toContain('second unsaved');
  await expect(save).toBeDisabled();
  const beforeLock = await lastAction(page, 'codex:save-file');

  await editFile(page, 'export const value = "retained across lock";\n');
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await expect(page.getByLabel('Workspace password', { exact: true })).toBeVisible();
  await replayAction(page, 'codex:save-file', beforeLock);
  expect((await page.request.get(`/api/workspaces/${second.id}/file`, { params: { path: 'hello.ts' } })).status()).toBe(401);
  await page.getByLabel('Workspace password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(editor.locator('.view-lines').first()).toContainText('retained across lock');
  await expect(save).toBeEnabled();
  await replayAction(page, 'codex:save-file', beforeLock);
  expect((await readFile(page, second)).content).toContain('second unsaved');
  await expect(editor.locator('.editor-save-state')).toContainText('Unsaved changes');
  await save.click();
  await expect.poll(async () => (await readFile(page, second)).content).toContain('retained across lock');
  const afterLock = await lastAction(page, 'codex:save-file');
  expect(afterLock.editorInstanceId).toBe(beforeLock.editorInstanceId);
  expect(afterLock.generation).toBeGreaterThan(beforeLock.generation!);
  await expect(save).toBeDisabled();

  await switchWorkspace(page, first);
  await expect(editor.getByRole('tab', { name: 'hello.ts', exact: true })).toHaveAttribute('aria-selected', 'true');
  await editFile(page, 'export const value = "new mount unsaved";\n');
  await expect(save).toBeEnabled();
  await replayAction(page, 'codex:save-file', firstScope);
  expect((await readFile(page, first)).content).toContain('first saved');
  await expect(editor.locator('.view-lines').first()).toContainText('new mount unsaved');
  await save.click();
  await expect.poll(async () => (await readFile(page, first)).content).toContain('new mount unsaved');
  expect((await lastAction(page, 'codex:save-file')).editorInstanceId).not.toBe(firstScope.editorInstanceId);
});

test.describe('phone top bar', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('keeps file opening and saving direct while explorer navigation uses the workspace menu', async ({ page }) => {
    await signIn(page.request);
    const workspace = await createWorkspace(page.request, 'phone');
    await selectInitialWorkspace(page, workspace);
    await page.goto('/work');
    const editor = page.getByRole('region', { name: 'Code editor', exact: true });
    const topbar = page.locator('.app-topbar');
    const quick = topbar.getByRole('button', { name: 'Go to file', exact: true });
    const save = topbar.getByRole('button', { name: 'Save', exact: true });
    await expect(quick).toBeVisible();
    await expect(save).toBeDisabled();
    await expect(editor.locator('.editor-header')).toHaveCount(0);
    for (const control of [quick, save]) {
      const bounds = await control.boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
    }
    await quick.click();
    const dialog = page.getByRole('dialog', { name: 'Go to file', exact: true });
    await expectNeutralFilePicker(dialog);
    await dialog.getByRole('option', { name: /hello\.ts/ }).click();
    await expect(editor.locator('.editor-main')).toBeVisible();
    await expect(editor.locator('.editor-sidebar')).toBeHidden();
    await editFile(page, 'export const phone = "saved from the top bar";\n');
    await expect(save).toBeEnabled();
    await save.click();
    await expect.poll(async () => (await readFile(page, workspace)).content).toContain('saved from the top bar');
    await expect(save).toBeDisabled();
    await topbar.getByRole('button', { name: 'Workspace actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Show files', exact: true }).click();
    await expect(editor.locator('.editor-sidebar')).toBeVisible();
    await expect(editor.locator('.editor-main')).toBeHidden();
    await editor.getByRole('treeitem', { name: 'hello.ts', exact: true }).click();
    await expect(editor.locator('.editor-main')).toBeVisible();
    await expect(editor.getByRole('button', { name: 'Show files', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
