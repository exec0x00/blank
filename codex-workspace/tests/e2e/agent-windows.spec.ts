import { expect, test, type Page } from '@playwright/test';
import type { Bootstrap, FileContent, Thread, UiState, Workspace } from '../../shared/types';
import type { CodexCapabilities, CodexRuntimeStatus } from '../../shared/codex-cli';
import { uiStateFixture } from './ui-state-fixture';

const password = process.env.PLAYWRIGHT_PASSWORD || 'browser-test-workspace-password';
const headers = { 'X-Codex-Workspace': '1' };
const rootId = '0199ac01-0000-7000-8000-000000000001', childId = '0199ac01-0000-7000-8000-000000000002';
const stamp = '2026-09-23T12:00:00.000Z', model = 'native-window-fixture';
const capabilities: CodexCapabilities = { conversations: true, pagination: true, queue: true, goals: true, skills: false, plan: true, review: true, historyRevert: true };

async function prepare(page: Page) {
  expect((await page.request.post('/api/session', { headers, data: { password } })).ok()).toBe(true);
  const response = await page.request.post('/api/workspaces', { headers, data: { name: 'Agent window proof ' + Date.now() } });
  expect(response.status()).toBe(201);
  const workspace = await response.json() as Workspace;
  expect((await page.request.patch('/api/workspaces/' + workspace.id, { headers, data: { active: true } })).ok()).toBe(true);
  expect((await page.request.post(`/api/workspaces/${workspace.id}/files`, { headers, data: { path: 'window.ts', kind: 'file' } })).ok()).toBe(true);
  expect((await page.request.put(`/api/workspaces/${workspace.id}/file`, { headers, data: { path: 'window.ts', content: 'export const source = "saved on disk";\n' } })).ok()).toBe(true);
  const state: UiState = { version: 1, revision: 1, layouts: { desktop: { view: 'agent', split: 'split' } }, editor: {},
    workspaces: { [workspace.id]: { threadId: rootId, tabs: { paths: ['window.ts'], active: 'window.ts' } } }, fieldRevisions: {} };
  const ui = uiStateFixture(state);
  const root: Thread = { id: rootId, workspaceId: workspace.id, backend: 'codex-cli', title: 'Main window agent', status: 'idle', createdAt: stamp, updatedAt: stamp,
    messages: [{ id: 'user', role: 'user', content: 'Existing native history.', createdAt: stamp }],
    native: { model, reasoningEffort: 'medium', activeTurnId: null, approvals: [], questions: [], queue: [], queueCursor: null, goal: null, tokenUsage: null, diff: null, capabilities },
    nativePage: { nextCursor: null, backwardsCursor: null } };
  const child: Thread = { ...structuredClone(root), id: childId, parentThreadId: rootId, title: 'Child window agent' };
  const runtime: CodexRuntimeStatus = { backend: 'codex-cli', state: 'ready', version: '0.155.1', installedVersion: '0.155.1',
    startedAt: stamp, updatedAt: stamp, canUpdate: true, updateBlockedReason: null, error: null, activeTurns: 0, capabilities };
  const nativeWrites: string[] = [], activeWrites: string[] = [];
  await page.context().addInitScript(() => {
    class Source extends EventTarget {
      static CLOSED = 2; readyState = 0; onopen: (() => void) | null = null; onmessage = null; onerror = null;
      constructor() { super(); setTimeout(() => { if (this.readyState !== 2) { this.readyState = 1; this.onopen?.(); } }, 0); }
      close() { this.readyState = 2; }
    }
    Object.assign(window, { EventSource: Source });
  });
  await page.context().route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.slice(4), method = request.method();
    const reply = (value: unknown) => route.fulfill({ status: 200, json: value });
    if (await ui.handle(route)) return;
    if (path === '/bootstrap') {
      const result = await route.fetch(), data = await result.json() as Bootstrap;
      return reply({ ...data, uiState: ui.read(), settings: { ...data.settings, agentConfigured: true, model, reasoningEffort: 'medium' } });
    }
    if (path === '/codex/runtime') return reply(runtime);
    if (path === '/models') return reply({ backend: 'codex-cli', connected: true, catalog: [{ id: model, model, displayName: 'Window fixture', description: '', hidden: false,
      isDefault: true, inputModalities: ['text'], defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Native medium' }] }], models: [model] });
    if (path === '/threads' || path.startsWith('/threads/')) {
      if (method !== 'GET') { nativeWrites.push(method + ' ' + path); return route.fulfill({ status: 409, json: { error: 'Navigation cannot mutate native history.' } }); }
      if (path === '/threads') return reply({ items: [root], hasOlder: false, hasNewer: false, olderCursor: null, newerCursor: null });
      if (path === '/threads/' + rootId) return reply(root);
      if (path === '/threads/' + childId) return reply(child);
      if (path === '/threads/' + rootId + '/agents') return reply([child]);
      if (path === '/threads/' + childId + '/agents') return reply([]);
      if (path.endsWith('/queue')) return reply({ items: [], nextCursor: null });
      return route.fulfill({ status: 404, json: { error: 'Unknown native fixture read.' } });
    }
    if (/^\/workspaces\/[^/]+$/.test(path) && method === 'PATCH' && request.postDataJSON()?.active) activeWrites.push(path);
    return route.continue();
  });
  return { workspace, ui, nativeWrites, activeWrites };
}

async function edit(page: Page, content: string) {
  const input = page.locator('#editor-workbench .monaco-editor textarea.inputarea').first();
  await expect(input).toBeVisible(); await input.focus();
  await page.keyboard.press('ControlOrMeta+KeyA'); await page.keyboard.insertText(content);
  await expect(page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
}

test('agent and editor windows keep their selection, dirty buffers, drafts and the original PTY', async ({ page }) => {
  const app = await prepare(page), errors: string[] = [], sockets: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => { if (socket.url().includes('/ws/terminal')) sockets.push(socket.url()); });
  await page.goto('/work');
  const editor = page.locator('#editor-workbench'), chat = page.locator('#agent-workbench');
  await expect(editor.locator('.view-lines').first()).toContainText('saved on disk');
  await edit(page, 'export const source = "unsaved in the original window";\n');
  await chat.getByRole('textbox', { name: 'Message Codex', exact: true }).fill('Keep this unsent original draft.');
  await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('button', { name: 'Terminal', exact: true }).click();
  const terminal = page.locator('.terminal-surface:not([hidden])');
  await expect(terminal).toHaveAttribute('data-connection', 'connected');
  const terminalNode = await terminal.elementHandle(), editorNode = await editor.locator('.monaco-editor').first().elementHandle();
  const socketCount = sockets.length;
  await chat.getByRole('button', { name: 'Switch to agent Child window agent', exact: true }).click();
  await expect(chat.getByRole('button', { name: 'Conversation history', exact: true })).toHaveAttribute('aria-description', 'Child window agent');
  await expect(chat.getByRole('textbox', { name: 'Message Codex', exact: true })).toHaveValue('');
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Open editor in new window', exact: true }).click();
  const popup = await popupPromise;
  popup.on('pageerror', error => errors.push(error.message));
  await expect(popup).toHaveURL(new RegExp('workspace=' + app.workspace.id + '&thread=' + childId + '&view=editor'));
  await expect(popup.locator('#editor-workbench')).toBeVisible(); await expect(popup.locator('#agent-workbench')).toBeHidden();
  await expect(popup.locator('#editor-workbench .view-lines').first()).toContainText('saved on disk');
  await expect(editor.locator('.view-lines').first()).toContainText('unsaved in the original window');
  expect(await editorNode!.evaluate(node => node.isConnected)).toBe(true);
  expect(await terminalNode!.evaluate(node => node.isConnected)).toBe(true); expect(sockets).toHaveLength(socketCount);
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await edit(popup, 'export const source = "saved by the editor window";\n');
  await popup.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor.locator('.editor-conflict-banner')).toContainText('This file changed on disk.');
  await expect(editor.locator('.view-lines').first()).toContainText('unsaved in the original window');
  const disk = await (await page.request.get(`/api/workspaces/${app.workspace.id}/file?path=window.ts`)).json() as FileContent;
  expect(disk.content).toContain('saved by the editor window');
  await chat.getByRole('button', { name: 'Parent agent', exact: true }).click();
  await expect(chat.getByRole('textbox', { name: 'Message Codex', exact: true })).toHaveValue('Keep this unsent original draft.');
  await popup.reload();
  await expect(popup.locator('#editor-workbench')).toBeVisible(); await expect(popup.locator('#agent-workbench')).toBeHidden();
  await popup.getByRole('button', { name: 'Agent', exact: true }).last().click();
  await expect(popup.getByRole('button', { name: 'Conversation history', exact: true })).toHaveAttribute('aria-description', 'Child window agent');
  await expect(chat.getByRole('button', { name: 'Conversation history', exact: true })).toHaveAttribute('aria-description', 'Main window agent');
  expect(app.activeWrites).toEqual([]); expect(app.nativeWrites).toEqual([]);
  expect(app.ui.read().layouts.desktop).toMatchObject({ view: 'agent', split: 'split' });
  expect(sockets).toHaveLength(socketCount); expect(errors).toEqual([]);
  // End with a clean buffer so the final shared-session lock is an explicit UI action.
  await editor.getByRole('button', { name: 'Use disk version', exact: true }).click();
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await expect(page.getByLabel('Workspace password', { exact: true })).toBeVisible();
  await expect(popup.getByLabel('Workspace password', { exact: true })).toBeVisible();
  await popup.close();
});

test('invalid workspace links never mount an unrelated saved workspace', async ({ page }) => {
  const app = await prepare(page);
  for (const link of [
    { workspaceId: '..%2Foutside', error: 'This workspace link is invalid.' },
    { workspaceId: '9d862060-fffc-4000-8000-000000000000', error: 'The workspace in this link is no longer available.' },
  ]) {
    const url = '/work?workspace=' + link.workspaceId + '&thread=' + childId + '&view=agent';
    await page.goto(url);
    await expect(page.getByRole('alert').filter({ hasText: link.error })).toBeVisible();
    await page.getByRole('button', { name: 'Choose workspace', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Your workspaces', exact: true });
    const listStatus = dialog.getByRole('status').filter({ hasText: /^(Checking workspaces…|All workspaces)$/ });
    await expect(listStatus).toHaveText('All workspaces');
    await dialog.getByRole('button', { name: 'Refresh workspaces', exact: true }).click();
    await expect(listStatus).toHaveText('All workspaces');
    await expect(page.locator('#agent-workbench, #editor-workbench')).toHaveCount(0);
    expect(new URL(page.url()).search).toBe(new URL(url, 'http://fixture.test').search);
  }
  expect(app.nativeWrites).toEqual([]); expect(app.activeWrites).toEqual([]);
});
