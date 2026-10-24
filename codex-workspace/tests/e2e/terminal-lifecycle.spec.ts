import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { TerminalSession, Workspace } from '../../shared/types';

const password = process.env.PLAYWRIGHT_PASSWORD || 'browser-test-workspace-password';
const headers = { 'X-Codex-Workspace': '1' };
const terminalRegion = (page: Page) => page.getByRole('region', { name: 'Terminal sessions and output', exact: true });
const terminalNavigation = (page: Page) => page.getByRole('navigation', { name: page.viewportSize()!.width < 680 ? 'Mobile navigation' : 'Main navigation' }).getByRole('button', { name: 'Terminal', exact: true });

async function createWorkspace(request: APIRequestContext, name: string): Promise<Workspace> {
  const result = await request.post('/api/workspaces', { headers, data: { name: `${name} ${Date.now()}`, initializeGit: false } });
  expect(result.status()).toBe(201);
  return result.json();
}

async function start(page: Page, name: string): Promise<Workspace> {
  expect((await page.request.post('/api/session', { headers, data: { password } })).status()).toBe(200);
  const workspace = await createWorkspace(page.request, name);
  await page.request.patch(`/api/workspaces/${workspace.id}`, { headers, data: { active: true } });
  const width = page.viewportSize()!.width;
  const profile = width >= 1360 ? 'desktop' : width >= 1000 ? 'laptop' : width >= 680 ? 'tablet' : 'mobile';
  const state = await (await page.request.get('/api/ui-state')).json();
  expect((await page.request.patch('/api/ui-state', { headers, data: { revision: state.revision, changes: [
    { section: 'layout', profile, key: 'view', value: 'editor' },
    { section: 'layout', profile, key: 'split', value: width >= 1360 ? 'split' : 'focus' },
  ] } })).ok()).toBe(true);
  return workspace;
}

async function sessions(page: Page, workspace: Workspace): Promise<TerminalSession[]> {
  const response = await page.request.get(`/api/workspaces/${workspace.id}/terminals`);
  expect(response.status()).toBe(200);
  return response.json();
}

async function open(page: Page) {
  await terminalNavigation(page).click();
  const panel = terminalRegion(page);
  await expect(panel.locator('.terminal-surface:not([hidden])')).toHaveAttribute('data-connection', 'connected');
  await expect(panel.getByRole('tab')).toHaveCount(1);
  return panel;
}

async function write(page: Page, source: string) {
  await terminalRegion(page).locator('.terminal-surface:not([hidden]) .xterm-helper-textarea').focus();
  await page.keyboard.insertText(source);
  await page.keyboard.press('Enter');
}

function observe(page: Page) {
  const errors: string[] = [];
  const sockets: { closed: boolean }[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /Could not open terminal|Cannot update a component|Cannot read properties of undefined.*key/.test(message.text())) errors.push(message.text());
  });
  page.on('websocket', socket => {
    if (!socket.url().includes('/ws/terminal')) return;
    const record = { closed: false };
    sockets.push(record);
    socket.on('close', () => { record.closed = true; });
  });
  return { errors, sockets };
}

async function unlock(page: Page) {
  await expect(page.getByLabel('Workspace password', { exact: true })).toBeVisible();
  await page.getByLabel('Workspace password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Workspace password', { exact: true })).toBeHidden();
}

for (const width of [1440, 390]) {
  test(`closing the last terminal at ${width}px hides it, preserves drafts, and reopens one fresh shell`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const observed = observe(page);
    const workspace = await start(page, `Terminal close last ${width}`);
    await page.request.post(`/api/workspaces/${workspace.id}/files`, { headers, data: { path: 'draft.txt', kind: 'file' } });
    await page.request.put(`/api/workspaces/${workspace.id}/file`, { headers, data: { path: 'draft.txt', content: 'saved content\n' } });
    await page.goto('/work');
    const editor = page.getByRole('region', { name: 'Code editor', exact: true });
    await editor.getByRole('treeitem', { name: 'draft.txt', exact: true }).click();
    const input = editor.locator('.monaco-editor textarea.inputarea').first();
    await expect(input).toBeVisible();
    await input.focus();
    await page.keyboard.press('ControlOrMeta+KeyA');
    await page.keyboard.insertText('unsaved draft survives terminal close');
    await expect(page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
    const editorNode = await editor.locator('.monaco-editor').first().elementHandle();
    if (width >= 1360) await page.getByRole('textbox', { name: 'Message Codex', exact: true }).fill('Unsent conversation draft');

    const panel = await open(page);
    const original = (await sessions(page, workspace))[0];
    await panel.getByRole('button', { name: `Close ${original.title}`, exact: true }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Workspace terminal', exact: true })).toBeHidden();
    await expect(page.locator('.panel-failure')).toHaveCount(0);
    await expect.poll(() => sessions(page, workspace)).toEqual([]);
    await expect.poll(() => observed.sockets.filter(socket => !socket.closed).length).toBe(0);
    expect(await page.evaluate(id => localStorage.getItem(`codex.terminal.${id}`), workspace.id)).toBeNull();
    await expect(editor.locator('.view-lines').first()).toContainText('unsaved draft survives terminal close');
    expect(await editorNode!.evaluate(node => node.isConnected)).toBe(true);
    if (width >= 1360) await expect(page.getByRole('textbox', { name: 'Message Codex', exact: true })).toHaveValue('Unsent conversation draft');
    const saved = await (await page.request.get(`/api/workspaces/${workspace.id}/file`, { params: { path: 'draft.txt' } })).json();
    expect(saved.content).toBe('saved content\n');

    await page.evaluate(() => { window.dispatchEvent(new Event('online')); window.dispatchEvent(new CustomEvent('codex:session-unlocked')); });
    await page.waitForTimeout(300);
    expect(observed.sockets).toHaveLength(1);
    expect(await sessions(page, workspace)).toEqual([]);
    await open(page);
    const reopened = await sessions(page, workspace);
    expect(reopened).toHaveLength(1);
    expect(reopened[0].id).not.toBe(original.id);
    expect(reopened[0].pid).not.toBe(original.pid);
    expect(observed.sockets).toHaveLength(2);
    await write(page, "printf 'REOPEN_%s\\n' 'WORKS'");
    await expect(panel.locator('.terminal-surface:not([hidden]) .xterm-rows')).toContainText('REOPEN_WORKS');
    expect(observed.errors).toEqual([]);
  });
}

test('a close pending during lock/unlock cannot reopen its deleted shell', async ({ page }) => {
  const observed = observe(page);
  const workspace = await start(page, 'Terminal close while locked');
  await page.goto('/work');
  const panel = await open(page);
  const original = (await sessions(page, workspace))[0];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let deleted = false;
  await page.route(`**/api/terminals/${original.id}`, async route => {
    const response = await route.fetch();
    deleted = true;
    await gate;
    await route.fulfill({ response });
  });
  try {
    await panel.getByRole('button', { name: `Close ${original.title}`, exact: true }).click();
    await expect.poll(() => deleted).toBe(true);
    await expect(panel.getByRole('button', { name: `Close ${original.title}`, exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
    await unlock(page);
    expect(await sessions(page, workspace)).toEqual([]);
    expect(observed.sockets).toHaveLength(1);
    release();
    await expect(panel).toHaveCount(0);
    await open(page);
    expect(await sessions(page, workspace)).toHaveLength(1);
    expect(observed.sockets).toHaveLength(2);
    expect(observed.errors).toEqual([]);
  } finally { release(); await page.unroute(`**/api/terminals/${original.id}`); }
});

test('a late close response from the old workspace leaves the new workspace terminal intact', async ({ page }) => {
  const observed = observe(page);
  const first = await start(page, 'Terminal closing workspace');
  const second = await createWorkspace(page.request, 'Terminal retained workspace');
  await page.request.patch(`/api/workspaces/${first.id}`, { headers, data: { active: true } });
  await page.goto('/work');
  const panel = await open(page);
  const original = (await sessions(page, first))[0];
  const pendingCloseResponse = page.waitForResponse(response => response.request().method() === 'DELETE' && response.url().endsWith(`/api/terminals/${original.id}`));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let deleted = false;
  await page.route(`**/api/terminals/${original.id}`, async route => {
    const response = await route.fetch();
    deleted = true;
    await gate;
    await route.fulfill({ response });
  });
  try {
    await panel.getByRole('button', { name: `Close ${original.title}`, exact: true }).click();
    await expect.poll(() => deleted).toBe(true);
    await page.locator('.topbar-workspace').click();
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('list', { name: 'Workspaces', exact: true }) });
    if (await dialog.getByLabel('Find a workspace', { exact: true }).count()) await dialog.getByLabel('Find a workspace', { exact: true }).fill(second.name);
    await dialog.locator('.workspace-select').filter({ hasText: second.name }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.topbar-workspace')).toHaveText(second.name);
    await expect(panel.locator('.terminal-surface:not([hidden])')).toHaveAttribute('data-connection', 'connected');
    const retained = (await sessions(page, second))[0];
    release();
    await (await pendingCloseResponse).finished();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect.poll(() => sessions(page, first)).toEqual([]);
    await write(page, 'pwd');
    await expect(panel.locator('.terminal-surface:not([hidden]) .xterm-rows')).toContainText(second.path);
    expect((await sessions(page, second))[0].id).toBe(retained.id);
    expect(observed.sockets).toHaveLength(2);
    expect(observed.errors).toEqual([]);
  } finally { release(); await page.unroute(`**/api/terminals/${original.id}`); }
});

test('closing one of two tabs preserves the other, and a natural exit keeps its output and new-shell control', async ({ page }) => {
  const observed = observe(page);
  const workspace = await start(page, 'Terminal natural exit');
  await page.goto('/work');
  const panel = await open(page);
  const first = (await sessions(page, workspace))[0];
  const firstRows = await panel.locator('.xterm-rows').elementHandle();
  await panel.getByRole('button', { name: 'New terminal', exact: true }).click();
  await expect(panel.getByRole('tab')).toHaveCount(2);
  await expect(panel.locator('.terminal-surface:not([hidden])')).toHaveAttribute('data-connection', 'connected');
  const second = (await sessions(page, workspace)).find(session => session.id !== first.id)!;
  await panel.getByRole('button', { name: `Close ${second.title}`, exact: true }).click();
  await expect(panel.getByRole('tab')).toHaveCount(1);
  await expect(panel.locator('.terminal-surface:not([hidden])')).toHaveAttribute('data-connection', 'connected');
  expect(await firstRows!.evaluate(node => node.isConnected)).toBe(true);
  expect((await sessions(page, workspace))[0].id).toBe(first.id);
  expect(observed.sockets).toHaveLength(2);
  await write(page, 'exit 7');
  await expect(panel.locator('.terminal-surface:not([hidden])')).toHaveAttribute('data-connection', 'closed');
  await expect(panel.locator('.xterm-rows')).toContainText('[Process exited with code 7]');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: 'New terminal', exact: true })).toHaveText('New shell');
  await panel.getByRole('button', { name: 'New terminal', exact: true }).click();
  await expect(panel.getByRole('tab')).toHaveCount(2);
  await expect(panel.locator('.terminal-surface:not([hidden])')).toHaveAttribute('data-connection', 'connected');
  expect(observed.sockets).toHaveLength(3);
  expect(observed.errors).toEqual([]);
});
