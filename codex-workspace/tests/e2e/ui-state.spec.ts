import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Thread, UiState, UiStateChange, Workspace } from '../../shared/types';
import { extraBrowserContext, type OwnedBrowserContext } from '../browser-context';

const password = process.env.PLAYWRIGHT_PASSWORD || 'browser-test-workspace-password';
const headers = { 'X-Codex-Workspace': '1' };


async function preservedConversation(request: APIRequestContext, workspace: Workspace, title: string): Promise<Thread> {
  const config = test.info().config;
  const servers = Array.isArray(config.webServer) ? config.webServer : [config.webServer];
  const configured = process.env.PLAYWRIGHT_DATA_DIR || servers.find(server => server?.env?.DATA_DIR)?.env?.DATA_DIR
    || (typeof config.metadata.codexBrowserServerDataDir === 'string' ? config.metadata.codexBrowserServerDataDir : undefined);
  if (!configured) throw new Error('Provide the owned test server PLAYWRIGHT_DATA_DIR before seeding a preserved conversation.');
  const storage = await request.get('/api/storage'); expect(storage.status()).toBe(200);
  const target = new URL(storage.url()), info = await storage.json() as { path: string; persistent: boolean };
  if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || info.persistent !== false) {
    throw new Error('Preserved-conversation fixtures require an owned nonpersistent loopback test server.');
  }
  const root = await fs.realpath(configured), temporary = await fs.realpath(os.tmpdir());
  const relative = path.relative(temporary, root);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !relative.split(path.sep)[0].startsWith('codex-')
    || root !== await fs.realpath(info.path)) throw new Error('The supplied fixture root does not match an owned temporary server.');
  if (await fs.realpath(workspace.path) !== path.join(root, 'workspaces', workspace.id)
    || await fs.readFile(path.join(workspace.path, 'alpha.ts'), 'utf8') !== 'export const source = "saved alpha.ts";\n') {
    throw new Error('The real workspace files do not match this fixture server.');
  }
  const stateDir = path.join(root, 'codex-workspace', 'state');
  if (await fs.realpath(stateDir) !== stateDir) throw new Error('The owned fixture state directory must not be redirected.');
  const timestamp = new Date().toISOString(), id = `thr_${randomUUID().replaceAll('-', '')}`;
  const summary = { id, workspaceId: workspace.id, title, createdAt: timestamp, updatedAt: timestamp, status: 'idle' as const };
  const thread: Thread = { ...summary, messages: [{ id: `preserved_${randomUUID().replaceAll('-', '')}`, role: 'user', content: 'Preserved interface-persistence fixture.', createdAt: timestamp }], turns: [] };
  // Real canonical records, exclusively created in the verified owned state
  // root. The browser cannot authorize these IDs by returning a fake list.
  await fs.writeFile(path.join(stateDir, `thread-${id}.json`), JSON.stringify({ thread, input: [], revision: 1 }) + '\n', { flag: 'wx', mode: 0o600 });
  await fs.writeFile(path.join(stateDir, `thread-summary-${id}.json`), JSON.stringify(summary) + '\n', { flag: 'wx', mode: 0o600 });
  const response = await request.get(`/api/threads/${id}`); expect(response.status()).toBe(200);
  const canonical = await response.json() as Thread;
  expect(canonical).toMatchObject({ id, workspaceId: workspace.id, title, backend: 'legacy', readOnly: true });
  return canonical;
}
async function login(request: APIRequestContext) {
  expect((await request.post('/api/session', { headers, data: { password } })).status()).toBe(200);
}
async function saved(request: APIRequestContext) {
  const response = await request.get('/api/ui-state');
  expect(response.status()).toBe(200);
  return response.json() as Promise<UiState>;
}
async function saveSelections(request: APIRequestContext, changes: UiStateChange[]) {
  const state = await saved(request);
  const response = await request.patch('/api/ui-state', { headers, data: { revision: state.revision, changes } });
  expect(response.status()).toBe(200);
}
async function prepare(page: Page, name: string) {
  await login(page.request);
  const response = await page.request.post('/api/workspaces', { headers, data: { name } });
  expect(response.status()).toBe(201);
  const workspace = await response.json() as Workspace;
  expect((await page.request.patch(`/api/workspaces/${workspace.id}`, { headers, data: { active: true } })).status()).toBe(200);
  for (const file of ['alpha.ts', 'beta.ts']) {
    expect((await page.request.post(`/api/workspaces/${workspace.id}/files`, { headers, data: { path: file, kind: 'file' } })).status()).toBe(201);
    expect((await page.request.put(`/api/workspaces/${workspace.id}/file`, { headers, data: { path: file, content: `export const source = "saved ${file}";\n` } })).status()).toBe(200);
  }
  await saveSelections(page.request, [{ section: 'layout', profile: 'desktop', key: 'view', value: 'editor' }, { section: 'layout', profile: 'desktop', key: 'split', value: 'focus' }]);
  return workspace;
}
async function navigate(page: Page, view: string) {
  await expect(page.locator('.app-shell')).toBeVisible();
  if (view === 'Agent' && page.viewportSize()!.width >= 680 && await page.locator('#agent-workbench').isVisible()) return;
  if (view === 'Editor' && page.viewportSize()!.width >= 680 && await page.locator('#editor-workbench').isVisible()) {
    // Command navigation can select an already visible editor without hiding it.
    await page.keyboard.press('ControlOrMeta+KeyK');
    await page.getByRole('dialog', { name: 'Go anywhere', exact: true }).getByRole('option', { name: 'Go to editor', exact: true }).click();
    return;
  }
  const navigation = page.getByRole('navigation', { name: page.viewportSize()!.width < 680 ? 'Mobile navigation' : 'Main navigation' });
  await navigation.getByRole('button', { name: view, exact: true }).click();
}

async function expectIconSidebar(page: Page) {
  const rail = page.getByRole('complementary', { name: 'Workspace navigation', exact: true });
  await expect(rail).toBeVisible();
  expect((await rail.boundingBox())!.width).toBeLessThanOrEqual(80);
  await expect(page.getByRole('button', { name: /^(Expand|Collapse) navigation$/ })).toHaveCount(0);
  await expect(rail.locator('.sidebar-workspace, .sidebar-new-thread')).toHaveCount(0);
  const agent = rail.getByRole('button', { name: 'Agent', exact: true });
  await expect(agent).toHaveAccessibleName('Agent');
  await expect(agent).toHaveText('');
  await expect(page.locator('.topbar-workspace')).toBeVisible();
}

test('a fresh browser restores server-backed workspace, root thread, tabs and editor options with independent phone navigation', async ({ page, browser, baseURL }) => {
  const workspace = await prepare(page, 'Persisted interface');
  // Old devices may retain this value; the current icon-only navigation ignores it.
  await saveSelections(page.request, [{ section: 'layout', profile: 'desktop', key: 'sidebar', value: 'expanded' }]);
  const firstThread = await preservedConversation(page.request, workspace, 'Chosen conversation');
  await preservedConversation(page.request, workspace, 'Another conversation');
  await page.goto('/work');
  await expectIconSidebar(page);
  expect((await saved(page.request)).layouts.desktop?.sidebar).toBe('expanded');
  const editor = page.getByRole('region', { name: 'Code editor', exact: true });
  await editor.getByRole('treeitem', { name: /alpha\.ts/ }).click();
  await editor.getByRole('treeitem', { name: /beta\.ts/ }).click();
  await expect(editor.getByRole('tab', { name: 'beta.ts', exact: true })).toHaveAttribute('aria-selected', 'true');
  await editor.getByRole('button', { name: 'Editor options', exact: true }).click();
  const minimap = page.getByRole('menuitemcheckbox', { name: 'Minimap', exact: true });
  if (await minimap.getAttribute('aria-checked') !== 'true') await minimap.click();
  await page.keyboard.press('Escape');
  await navigate(page, 'Agent');
  const chat = page.getByRole('region', { name: 'Codex conversation', exact: true });
  await chat.locator('button:is([title="Conversation history"], [data-tooltip-title="Conversation history"])').click();
  const history = page.getByRole('dialog', { name: 'Conversations', exact: true });
  await history.getByRole('combobox', { name: 'Conversation source', exact: true }).click();
  await page.getByRole('option').filter({ hasText: 'Preserved history' }).click();
  await history.locator('.chat-history-select').filter({ hasText: 'Chosen conversation' }).click();
  await navigate(page, 'Editor');
  await expect.poll(async () => (await saved(page.request)).workspaces[workspace.id]).toMatchObject({ threadId: firstThread.id, tabs: { paths: ['alpha.ts', 'beta.ts'], active: 'beta.ts' } });
  await expect.poll(async () => (await saved(page.request)).editor.minimap).toBe(true);

  // The original client has finished its assertions. Keep at most two real
  // Chromium processes while the restored desktop and phone remain concurrent.
  if (process.env.CODEX_BROWSER_LOW_THREADS === '1') await browser.close();
  const freshClient = await extraBrowserContext(browser, { baseURL, viewport: { width: 1440, height: 960 } });
  let phoneClient: OwnedBrowserContext | undefined;
  try {
    phoneClient = await extraBrowserContext(browser, { baseURL, viewport: { width: 390, height: 844 } });
    const fresh = freshClient.context;
    const phone = phoneClient.context;
    const restored = await fresh.newPage();
    await restored.goto('/work');
    await expect(restored.getByLabel('Workspace password', { exact: true })).toBeVisible();
    expect(await restored.evaluate(() => localStorage.getItem('codex:ui-state:v1'))).toBeNull();
    await restored.getByLabel('Workspace password', { exact: true }).fill(password);
    await restored.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(restored.locator('.topbar-workspace')).toHaveText(workspace.name);
    await expectIconSidebar(restored);
    const restoredEditor = restored.getByRole('region', { name: 'Code editor', exact: true });
    await expect(restoredEditor).toBeVisible();
    await expect(restoredEditor.getByRole('tab', { name: 'alpha.ts', exact: true })).toBeVisible();
    await expect(restoredEditor.getByRole('tab', { name: 'beta.ts', exact: true })).toHaveAttribute('aria-selected', 'true');
    await restoredEditor.getByRole('button', { name: 'Editor options', exact: true }).click();
    await expect(restored.getByRole('menuitemcheckbox', { name: 'Minimap', exact: true })).toHaveAttribute('aria-checked', 'true');
    await restored.keyboard.press('Escape');
    await navigate(restored, 'Agent');
    await expect(restored.locator('button:is([title="Conversation history"], [data-tooltip-title="Conversation history"])')).toContainText('Chosen conversation');
    await navigate(restored, 'Editor');
    await login(phone.request);
    const mobile = await phone.newPage();
    await mobile.goto('/work');
    await navigate(mobile, 'Repos');
    await expect(mobile.getByRole('region', { name: 'GitHub repositories' })).toBeVisible();
    await expect.poll(async () => (await saved(phone.request)).layouts.mobile?.view).toBe('github');
    expect((await saved(phone.request)).layouts.desktop?.view).toBe('editor');
    expect((await saved(phone.request)).layouts.desktop?.sidebar).toBe('expanded');
    await restored.reload();
    await expect(restored.getByRole('region', { name: 'Code editor', exact: true })).toBeVisible();
  } finally {
    try { await phoneClient?.close(); }
    finally { await freshClient.close(); }
  }
});

test('temporary restore failures retain saved paths and retry without clearing the active file', async ({ page }) => {
  const workspace = await prepare(page, 'Restore retry');
  const selection = { paths: ['alpha.ts', 'beta.ts'], active: 'beta.ts' };
  await saveSelections(page.request, [{ section: 'workspace', workspaceId: workspace.id, key: 'tabs', value: selection }]);
  let unavailable = true;
  let rejectedReads = 0;
  await page.route(`**/api/workspaces/${workspace.id}/file?**`, async route => {
    if (unavailable && new URL(route.request().url()).searchParams.get('path') === 'beta.ts') {
      rejectedReads += 1;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary storage outage.' }) });
    } else await route.continue();
  });
  await page.goto('/work');
  const editor = page.getByRole('region', { name: 'Code editor', exact: true });
  await expect(editor.getByRole('tab', { name: 'alpha.ts', exact: true })).toBeVisible();
  await expect.poll(() => rejectedReads).toBeGreaterThanOrEqual(2);
  expect((await saved(page.request)).workspaces[workspace.id].tabs).toEqual(selection);
  unavailable = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(editor.getByRole('tab', { name: 'beta.ts', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect((await saved(page.request)).workspaces[workspace.id].tabs).toEqual(selection);
});

test('unlock preserves dirty buffers when another browser changes the saved active workspace', async ({ page, browser, baseURL }) => {
  const workspace = await prepare(page, 'Dirty workspace retained');
  await page.goto('/work');
  const editor = page.getByRole('region', { name: 'Code editor', exact: true });
  await editor.getByRole('treeitem', { name: /alpha\.ts/ }).click();
  const textarea = editor.locator('.monaco-editor textarea.inputarea').first();
  await expect(textarea).toBeVisible(); await textarea.focus();
  await page.keyboard.press('ControlOrMeta+KeyA'); await page.keyboard.insertText('export const UNSAVED_KEEP_ME = true;\n');
  await expect(editor.getByRole('button', { name: 'Close alpha.ts (unsaved)', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await expect(page.getByLabel('Workspace password', { exact: true })).toBeVisible();
  const otherClient = await extraBrowserContext(browser, { baseURL });
  const other = otherClient.context;
  try {
    await login(other.request);
    const created = await other.request.post('/api/workspaces', { headers, data: { name: 'Other browser active workspace' } });
    expect(created.status()).toBe(201);
    const second = await created.json() as Workspace;
    await other.request.patch(`/api/workspaces/${second.id}`, { headers, data: { active: true } });
    await page.getByLabel('Workspace password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.locator('.topbar-workspace')).toHaveText(workspace.name);
    await expect(editor.getByRole('button', { name: 'Close alpha.ts (unsaved)', exact: true })).toBeVisible();
    await expect(editor.locator('.view-lines').first()).toContainText('UNSAVED_KEEP_ME');
    const file = await (await page.request.get(`/api/workspaces/${workspace.id}/file`, { params: { path: 'alpha.ts' } })).json();
    expect(file.content).toContain('saved alpha.ts');
    expect(JSON.stringify(await saved(page.request))).not.toContain('UNSAVED_KEEP_ME');
  } finally { await otherClient.close(); }
});
