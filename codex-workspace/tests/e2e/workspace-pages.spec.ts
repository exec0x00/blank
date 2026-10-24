import { expect, test, type Page } from '@playwright/test';
import type { Bootstrap, UiState, Workspace, WorkspaceDeleteResult } from '../../shared/types';

const password = process.env.PLAYWRIGHT_PASSWORD || 'browser-test-workspace-password';
const headers = { 'X-Codex-Workspace': '1' };

async function prepare(page: Page) {
  expect((await page.request.post('/api/session', { headers, data: { password } })).status()).toBe(200);
  const prefix = `Workspace pages ${Date.now()}`;
  const workspaces: Workspace[] = [];
  for (let start = 0; start < 47; start += 4) {
    workspaces.push(...await Promise.all(Array.from({ length: Math.min(4, 47 - start) }, async (_, index) => {
      const response = await page.request.post('/api/workspaces', { headers, data: { name: `${prefix} ${String(start + index).padStart(3, '0')}`, initializeGit: false } });
      expect(response.status()).toBe(201);
      return await response.json() as Workspace;
    })));
  }
  const current = workspaces.at(-1)!;
  expect((await page.request.patch(`/api/workspaces/${current.id}`, { headers, data: { active: true } })).status()).toBe(200);
  expect((await page.request.post(`/api/workspaces/${current.id}/files`, { headers, data: { path: 'retained.ts', kind: 'file' } })).status()).toBe(201);
  expect((await page.request.put(`/api/workspaces/${current.id}/file`, { headers, data: { path: 'retained.ts', content: 'export const saved = true;\n' } })).ok()).toBe(true);
  const state = await (await page.request.get('/api/ui-state')).json() as UiState;
  expect((await page.request.patch('/api/ui-state', { headers, data: { revision: state.revision, changes: [
    { section: 'layout', profile: 'desktop', key: 'view', value: 'editor' },
    { section: 'layout', profile: 'desktop', key: 'split', value: 'split' },
  ] } })).ok()).toBe(true);
  const boot = await (await page.request.get('/api/bootstrap')).json() as Bootstrap;
  expect(boot.workspaces.length).toBeLessThanOrEqual(40);
  expect(boot.activeWorkspaceId).toBe(current.id);
  expect(boot.activeWorkspace?.id).toBe(current.id);
  expect(boot.workspaces.some(workspace => workspace.id === current.id)).toBe(false);
  return { prefix, workspaces, current };
}

test('workspace pages preserve an off-page editor, draft and terminal across search, refresh, lock and exact recovery', async ({ page }) => {
  test.setTimeout(180_000);
  const { prefix, workspaces, current } = await prepare(page);
  const listRequests: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/workspaces') listRequests.push(url.search);
  });
  await page.goto('/work');
  await expect(page.locator('.topbar-workspace')).toHaveText(current.name);
  const editor = page.locator('#editor-workbench');
  await editor.getByRole('treeitem', { name: 'retained.ts', exact: true }).click();
  const input = editor.locator('.monaco-editor textarea.inputarea').first();
  await input.focus(); await page.keyboard.press('ControlOrMeta+KeyA');
  await page.keyboard.insertText('export const saved = "keep the off-page unsaved buffer";\n');
  const editorNode = await editor.locator('.monaco-editor').first().elementHandle();
  const draft = page.locator('#agent-workbench .chat-composer textarea');
  await draft.fill('Keep this off-page conversation draft.');
  const chatNode = await page.locator('#agent-workbench .chat-panel').elementHandle();
  await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('button', { name: 'Terminal', exact: true }).click();
  const terminal = page.locator('.terminal-surface:not([hidden])');
  await expect(terminal).toHaveAttribute('data-connection', 'connected');
  const terminalNode = await terminal.elementHandle();
  const terminalTab = await page.locator('.terminal-tabs [role="tab"][aria-selected="true"]').getAttribute('id');

  await page.locator('.topbar-workspace').click();
  const dialog = page.getByRole('dialog', { name: 'Your workspaces', exact: true });
  const search = dialog.getByLabel('Find a workspace', { exact: true });
  const rows = dialog.locator('.workspace-list-item');
  await expect(dialog.getByRole('button', { name: 'Refresh workspaces', exact: true })).toBeEnabled();
  expect(await rows.count()).toBeLessThanOrEqual(41);
  await expect(rows.filter({ hasText: current.name })).toContainText('Current workspace');
  await search.fill(prefix);
  await expect(dialog.locator('.workspace-pagination')).toContainText('1–40 of 47');
  await dialog.getByRole('button', { name: 'Next workspaces', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog.locator('.workspace-pagination')).toContainText('41–47 of 47');
  await expect(dialog.getByRole('list', { name: 'Workspaces', exact: true })).toBeFocused();
  expect(await rows.count()).toBe(7);
  await dialog.getByRole('button', { name: 'Previous workspaces', exact: true }).click();
  await expect(dialog.locator('.workspace-pagination')).toContainText('1–40 of 47');

  let release!: () => void;
  let requested!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const seen = new Promise<void>(resolve => { requested = resolve; });
  const oldQuery = workspaces[41].name;
  const newQuery = workspaces[42].name;
  await page.route('**/api/workspaces?*', async route => {
    if (new URL(route.request().url()).searchParams.get('query') !== oldQuery) return route.continue();
    const response = await route.fetch(); requested(); await held;
    await route.fulfill({ response });
  });
  try {
    await search.fill(oldQuery); await seen;
    await search.fill(newQuery);
    await expect(rows).toHaveCount(1); await expect(rows).toContainText(newQuery);
    release();
    await expect(rows).toHaveCount(1); await expect(rows).toContainText(newQuery);
  } finally { release(); await page.unroute('**/api/workspaces?*'); }

  await page.setViewportSize({ width: 390, height: 844 });
  await search.fill(prefix);
  await expect(dialog.locator('.workspace-pagination')).toContainText('1–40 of 47');
  await dialog.getByRole('button', { name: 'Next workspaces', exact: true }).click();
  await expect(dialog.locator('.workspace-pagination')).toContainText('41–47 of 47');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 960 });
  expect(await editorNode!.evaluate(node => node.isConnected)).toBe(true);
  expect(await chatNode!.evaluate(node => node.isConnected)).toBe(true);
  expect(await terminalNode!.evaluate(node => node.isConnected)).toBe(true);
  await expect(draft).toHaveValue('Keep this off-page conversation draft.');
  await expect(page.locator('.workspace-recovery-banner')).toHaveCount(0);

  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await page.getByLabel('Workspace password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('.topbar-workspace')).toHaveText(current.name);
  await expect(page.locator('.login-screen')).toHaveCount(0);
  expect(await editorNode!.evaluate(node => node.isConnected)).toBe(true);
  expect(await chatNode!.evaluate(node => node.isConnected)).toBe(true);
  expect(await terminalNode!.evaluate(node => node.isConnected)).toBe(true);
  await expect(page.locator('.terminal-tabs [role="tab"][aria-selected="true"]')).toHaveAttribute('id', terminalTab!);
  await expect(draft).toHaveValue('Keep this off-page conversation draft.');
  await expect(editor.locator('.view-lines').first()).toContainText('keep the off-page unsaved buffer');
  await expect(page.locator('.workspace-recovery-banner')).toHaveCount(0);

  await page.locator('.topbar-workspace').click();
  await expect(dialog.getByRole('button', { name: 'Refresh workspaces', exact: true })).toBeEnabled();
  await page.route(`**/api/workspaces/${current.id}`, route => route.request().method() === 'GET'
    ? route.fulfill({ status: 503, json: { error: 'Selected workspace storage is temporarily unavailable.', code: 'WORKSPACE_UNAVAILABLE' } }) : route.continue());
  await dialog.getByRole('button', { name: 'Refresh workspaces', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Selected workspace storage is temporarily unavailable.');
  await expect(page.locator('.workspace-recovery-banner')).toHaveCount(0);
  await expect(page.locator('.topbar-workspace')).toHaveText(current.name);
  expect(await editorNode!.evaluate(node => node.isConnected)).toBe(true);
  await page.unroute(`**/api/workspaces/${current.id}`);
  await dialog.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await search.fill(workspaces[43].name);
  await expect(rows).toHaveCount(1);
  page.once('dialog', confirmation => confirmation.dismiss());
  await rows.locator('.workspace-select').click();
  await expect(dialog).toBeVisible(); await expect(page.locator('.topbar-workspace')).toHaveText(current.name);
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.locator('.terminal-tab-close').click();
  await expect(page.locator('.terminal-panel')).toHaveCount(0);

  let response: { status: number; body: WorkspaceDeleteResult | { code?: string } } | undefined;
  // The tab is gone before the host can verify that its shell has ended.
  // Preserve that safety fence, and reject every other deletion failure.
  await expect.poll(async () => {
    const removed = await page.request.delete(`/api/workspaces/${current.id}`, { headers, data: { expectedMode: 'trash' } });
    response = { status: removed.status(), body: await removed.json() };
    return response.status === 409 && 'code' in response.body && response.body.code === 'WORKSPACE_BUSY';
  }, { message: 'The closed terminal lease must settle before the reviewed deletion.' }).toBe(false);
  expect(response?.status, JSON.stringify(response?.body)).toBe(200);
  const deleted = response!.body as WorkspaceDeleteResult;
  if (deleted.mode !== 'trash') throw new Error('Expected ordinary workspace trash.');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.workspace-recovery-banner')).toContainText(`${current.name} is no longer available.`);
  expect(await editorNode!.evaluate(node => node.isConnected)).toBe(true);
  expect(await chatNode!.evaluate(node => node.isConnected)).toBe(true);
  await expect(draft).toHaveValue('Keep this off-page conversation draft.');
  expect((await page.request.post(`/api/workspace-trash/${deleted.trash.id}/restore`, { headers, data: {} })).status()).toBe(200);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.workspace-recovery-banner')).toHaveCount(0);
  await expect(page.locator('.topbar-workspace')).toHaveText(current.name);
  expect(await editorNode!.evaluate(node => node.isConnected)).toBe(true);
  await expect(draft).toHaveValue('Keep this off-page conversation draft.');
  expect(listRequests.length).toBeGreaterThan(5);
  expect(listRequests.every(query => new URLSearchParams(query).get('limit') === '40')).toBe(true);
  expect(errors).toEqual([]);
});
