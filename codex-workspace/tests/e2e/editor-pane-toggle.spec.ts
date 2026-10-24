import { expect, test, type Page } from '@playwright/test';
import type { FileContent, UiLayoutProfile, UiState, Workspace } from '../../shared/types';

const password = process.env.PLAYWRIGHT_PASSWORD || 'browser-test-workspace-password';
const headers = { 'X-Codex-Workspace': '1' };
const original = 'export const value = "saved";\n';
const unsaved = 'export const value = "retained while the editor is hidden";\n';
const companionUnsaved = 'export const value = "another unsaved buffer";\n';

async function prepare(page: Page, viewport: { width: number; height: number; profile: UiLayoutProfile }, split = false, view: 'agent' | 'editor' = 'editor') {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  expect((await page.request.post('/api/session', { headers, data: { password } })).status()).toBe(200);
  const response = await page.request.post('/api/workspaces', { headers, data: { name: `Editor toggle ${viewport.profile} ${Date.now()}` } });
  expect(response.status()).toBe(201);
  const workspace = await response.json() as Workspace;
  expect((await page.request.patch(`/api/workspaces/${workspace.id}`, { headers, data: { active: true } })).ok()).toBe(true);
  for (const path of ['toggle.ts', 'companion.ts']) {
    expect((await page.request.post(`/api/workspaces/${workspace.id}/files`, { headers, data: { path, kind: 'file' } })).ok()).toBe(true);
    expect((await page.request.put(`/api/workspaces/${workspace.id}/file`, { headers, data: { path, content: original } })).ok()).toBe(true);
  }
  const state = await (await page.request.get('/api/ui-state')).json() as UiState;
  expect((await page.request.patch('/api/ui-state', { headers, data: { revision: state.revision, changes: [
    { section: 'layout', profile: viewport.profile, key: 'view', value: view },
    { section: 'layout', profile: viewport.profile, key: 'split', value: split ? 'split' : 'focus' },
  ] } })).ok()).toBe(true);
  await page.goto('/work');
  await expect(page.locator('.app-shell')).toBeVisible();
  return workspace;
}

async function savedLayout(page: Page, profile: UiLayoutProfile) {
  const response = await page.request.get('/api/ui-state');
  expect(response.ok()).toBe(true);
  return ((await response.json()) as UiState).layouts[profile];
}

async function savedFile(page: Page, workspace: Workspace, path = 'toggle.ts') {
  const response = await page.request.get(`/api/workspaces/${workspace.id}/file`, { params: { path } });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as FileContent).content;
}

async function edit(page: Page, content = unsaved) {
  const input = page.locator('#editor-workbench .monaco-editor textarea.inputarea').first();
  await expect(input).toBeVisible();
  await input.focus();
  await page.keyboard.press('ControlOrMeta+KeyA');
  await page.keyboard.insertText(content);
  await expect(page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
}

for (const viewport of [
  { width: 1440, height: 960, profile: 'desktop' as const },
  { width: 1280, height: 850, profile: 'laptop' as const },
]) {
  test(`${viewport.profile} Editor rail toggle preserves mounted buffers, drafts and PTY sessions and saves its layout`, async ({ page }) => {
    const errors: string[] = [];
    const terminalSockets: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('websocket', socket => { if (socket.url().includes('/ws/terminal')) terminalSockets.push(socket.url()); });
    // The selected view is Agent; the Editor button must still represent the visible pane.
    const workspace = await prepare(page, viewport, true, 'agent');
    const navigation = page.getByRole('navigation', { name: 'Main navigation', exact: true });
    const toggle = navigation.getByRole('button', { name: 'Editor', exact: true });
    const agent = page.locator('#agent-workbench');
    const editor = page.locator('#editor-workbench');
    const save = page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true });
    const draft = agent.locator('.chat-composer textarea');
    await expect(agent).toBeVisible();
    await expect(editor).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveAttribute('aria-controls', 'editor-workbench');
    await expect(toggle).toHaveAttribute('data-tooltip-title', 'Hide editor');
    await expect(toggle).toHaveAttribute('title', '');
    await toggle.focus();
    await expect(page.getByRole('tooltip')).toHaveText('Hide editor');
    await expect(toggle).toHaveAccessibleName('Editor');
    await expect(toggle).toHaveAccessibleDescription('Hide editor');
    await expect(toggle).toHaveClass(/active/);
    expect(await toggle.getAttribute('aria-current')).toBeNull();

    await editor.getByRole('treeitem', { name: 'companion.ts', exact: true }).click();
    await edit(page, companionUnsaved);
    await editor.getByRole('treeitem', { name: 'toggle.ts', exact: true }).click();
    await edit(page);
    await draft.fill('Keep this unsent draft while the editor is hidden.');
    const editorNode = await editor.locator('.monaco-editor').first().elementHandle();
    const conversationNode = await agent.locator('.chat-panel').elementHandle();

    await navigation.getByRole('button', { name: 'Terminal', exact: true }).click();
    const terminal = page.locator('.terminal-dock');
    const terminalSurface = terminal.locator('.terminal-surface:not([hidden])');
    await expect(terminalSurface).toHaveAttribute('data-connection', 'connected');
    const terminalNode = await terminalSurface.elementHandle();
    expect(terminalSockets).toHaveLength(1);

    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(editor).toBeHidden();
    await expect(agent).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).toHaveAttribute('data-tooltip-title', 'Show editor');
    await expect(toggle).toHaveAttribute('title', '');
    await expect(toggle).not.toHaveClass(/active/);
    await expect(save).toHaveCount(0);
    await expect(terminal).toBeVisible();
    expect(await editorNode!.evaluate(node => node.isConnected)).toBe(true);
    expect(await conversationNode!.evaluate(node => node.isConnected)).toBe(true);
    expect(await terminalNode!.evaluate(node => node.isConnected)).toBe(true);
    await expect(draft).toHaveValue('Keep this unsent draft while the editor is hidden.');
    await expect.poll(() => savedLayout(page, viewport.profile)).toMatchObject({ view: 'agent', split: 'focus' });
    expect(await savedFile(page, workspace)).toBe(original);
    expect(await savedFile(page, workspace, 'companion.ts')).toBe(original);

    await toggle.press('Enter');
    await expect(agent).toBeVisible();
    await expect(editor).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveAttribute('data-tooltip-title', 'Hide editor');
    await expect(toggle).toHaveClass(/active/);
    await expect(editor.getByRole('tab', { name: 'companion.ts', exact: true })).toBeVisible();
    await expect(editor.getByRole('tab', { name: 'toggle.ts', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(editor.locator('.view-lines').first()).toContainText('retained while the editor is hidden');
    await expect(save).toBeEnabled();
    expect(await editorNode!.evaluate(node => node.isConnected)).toBe(true);
    expect(await terminalNode!.evaluate(node => node.isConnected)).toBe(true);
    expect(terminalSockets).toHaveLength(1);
    await expect.poll(() => savedLayout(page, viewport.profile)).toMatchObject({ view: 'editor', split: 'split' });
    await expect.poll(async () => {
      const [left, centre, right] = await Promise.all([
        agent.boundingBox(), editor.locator('.editor-main').boundingBox(), editor.locator('.editor-sidebar').boundingBox(),
      ]);
      return Boolean(left && centre && right && left.x + left.width <= centre.x + 1 && centre.x + centre.width <= right.x + 1);
    }).toBe(true);

    await save.click();
    await expect.poll(() => savedFile(page, workspace)).toBe(unsaved);
    await expect(save).toBeDisabled();
    await expect(save).not.toHaveAttribute('aria-busy', 'true');
    await editor.getByRole('tab', { name: 'companion.ts', exact: true }).click();
    await expect(editor.locator('.view-lines').first()).toContainText('another unsaved buffer');
    await expect(save).toBeEnabled();
    await save.click();
    await expect.poll(() => savedFile(page, workspace, 'companion.ts')).toBe(companionUnsaved);
    await expect(save).toBeDisabled();
    await expect(save).not.toHaveAttribute('aria-busy', 'true');
    await draft.fill('');

    await toggle.click();
    await expect.poll(() => savedLayout(page, viewport.profile)).toMatchObject({ view: 'agent', split: 'focus' });
    await page.reload();
    await expect(agent).toBeVisible();
    await expect(editor).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(editor.getByRole('tab', { name: 'toggle.ts', exact: true })).toBeVisible();
    await expect(editor.getByRole('tab', { name: 'companion.ts', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(editor.locator('.view-lines').first()).toContainText('another unsaved buffer');
    await expect.poll(() => savedLayout(page, viewport.profile)).toMatchObject({ view: 'editor', split: 'split' });
    await page.reload();
    await expect(agent).toBeVisible();
    await expect(editor).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
  });
}

test('top-bar layout, command and file navigation reopen the mounted editor', async ({ page }) => {
  await prepare(page, { width: 1280, height: 850, profile: 'laptop' });
  const editor = page.locator('#editor-workbench');
  const agent = page.locator('#agent-workbench');
  const toggle = page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('button', { name: 'Editor', exact: true });
  await editor.getByRole('treeitem', { name: 'toggle.ts', exact: true }).click();
  await edit(page);
  const editorNode = await editor.locator('.monaco-editor').first().elementHandle();
  await toggle.click();
  await expect(editor).toBeHidden();
  const topbar = page.locator('.app-topbar');
  await topbar.getByRole('button', { name: 'Show editor and agent side by side', exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(agent).toBeVisible();
  await expect(editor.locator('.view-lines').first()).toContainText('retained while the editor is hidden');

  await topbar.getByRole('button', { name: 'Focus on one panel', exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(agent).toBeVisible();
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.keyboard.press('ControlOrMeta+KeyK');
    const commands = page.getByRole('dialog', { name: 'Go anywhere', exact: true });
    await commands.getByRole('combobox', { name: 'Search actions', exact: true }).fill('Go to editor');
    await commands.getByRole('option', { name: 'Go to editor', exact: true }).click();
    await expect(commands).toBeHidden();
    await expect(editor).toBeVisible();
  }
  await toggle.click();
  await expect(editor).toBeHidden();
  await page.keyboard.press('ControlOrMeta+KeyP');
  const files = page.getByRole('dialog', { name: 'Go to file', exact: true });
  await expect(files).toBeVisible();
  await files.getByRole('option', { name: /toggle\.ts/ }).click();
  await expect(files).toBeHidden();
  await expect(editor).toBeVisible();
  await expect(editor.locator('.view-lines').first()).toContainText('retained while the editor is hidden');
  expect(await editorNode!.evaluate(node => node.isConnected)).toBe(true);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => savedLayout(page, 'laptop')).toMatchObject({ view: 'editor', split: 'focus' });
});

test('tablet Editor rail toggle restores the existing buffer and keeps the Agent draft', async ({ page }) => {
  await prepare(page, { width: 820, height: 1180, profile: 'tablet' });
  const editor = page.locator('#editor-workbench');
  const agent = page.locator('#agent-workbench');
  const toggle = page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('button', { name: 'Editor', exact: true });
  await editor.getByRole('treeitem', { name: 'toggle.ts', exact: true }).click();
  await edit(page);
  const editorNode = await editor.locator('.monaco-editor').first().elementHandle();
  await toggle.click();
  await expect(editor).toBeHidden();
  await expect(agent).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  const draft = agent.locator('.chat-composer textarea');
  await draft.fill('Tablet draft is retained.');
  await toggle.click();
  await expect(editor).toBeVisible();
  await expect(agent).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(editor.locator('.view-lines').first()).toContainText('retained while the editor is hidden');
  expect(await editorNode!.evaluate(node => node.isConnected)).toBe(true);
  await toggle.click();
  await expect(draft).toHaveValue('Tablet draft is retained.');
  await expect.poll(() => savedLayout(page, 'tablet')).toMatchObject({ view: 'agent', split: 'focus' });
});

test('phone Files remains ordinary navigation and preserves the editor on repeated taps', async ({ page }) => {
  await prepare(page, { width: 390, height: 844, profile: 'mobile' }, false, 'agent');
  const navigation = page.getByRole('navigation', { name: 'Mobile navigation', exact: true });
  const files = navigation.getByRole('button', { name: 'Files', exact: true });
  const agent = page.locator('#agent-workbench');
  const editor = page.locator('#editor-workbench');
  const draft = agent.locator('.chat-composer textarea');
  await draft.fill('Phone draft is retained.');
  await files.click();
  await editor.getByRole('treeitem', { name: 'toggle.ts', exact: true }).click();
  await edit(page);
  const editorNode = await editor.locator('.monaco-editor').first().elementHandle();
  await files.click();
  await files.click();
  await expect(editor).toBeVisible();
  await expect(agent).toBeHidden();
  await expect(files).toHaveAttribute('aria-current', 'page');
  expect(await files.getAttribute('aria-pressed')).toBeNull();
  await navigation.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(draft).toHaveValue('Phone draft is retained.');
  await expect(editor).toBeHidden();
  await files.click();
  await expect(editor.locator('.view-lines').first()).toContainText('retained while the editor is hidden');
  expect(await editorNode!.evaluate(node => node.isConnected)).toBe(true);
  await expect.poll(() => savedLayout(page, 'mobile')).toMatchObject({ view: 'editor', split: 'focus' });
});
