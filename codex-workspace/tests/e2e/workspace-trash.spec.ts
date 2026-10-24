import { expect, test, type Page } from '@playwright/test';
import type { Bootstrap, TerminalSession, UiLayoutProfile, UiState, Workspace, WorkspaceDeleteResult, WorkspaceDeletionPlan, WorkspaceDeletionStatus, WorkspaceTrashEntry, WorkspacePage } from '../../shared/types';

const password = process.env.PLAYWRIGHT_PASSWORD || 'browser-test-workspace-password';
const headers = { 'X-Codex-Workspace': '1' };
const saved = 'export const status = "saved file";\n';
const unsaved = 'export const status = "keep my unsaved workspace edits";\n';

function operationalPage<T extends { name: string; workspaceId: string }>(items: T[], url: URL) {
  const query = (url.searchParams.get('q') || '').trim().toLowerCase();
  const limit = Number(url.searchParams.get('limit') || 25);
  const matches = items.filter(item => `${item.name} ${item.workspaceId}`.toLowerCase().includes(query));
  const offset = Math.min(Number(url.searchParams.get('offset') || 0), matches.length ? Math.floor((matches.length - 1) / limit) * limit : 0);
  return { items: matches.slice(offset, offset + limit), offset, limit, total: matches.length, hasMore: offset + limit < matches.length };
}

function withoutWorkspace(payload: Workspace[] | WorkspacePage, id: string): Workspace[] | WorkspacePage {
  if (Array.isArray(payload)) return payload.filter(workspace => workspace.id !== id);
  const { selected, ...rest } = payload;
  const workspaces = payload.workspaces.filter(workspace => workspace.id !== id);
  return { ...rest, workspaces, ...(payload.total === undefined ? {} : { total: Math.max(0, payload.total - (payload.workspaces.length - workspaces.length)) }),
    ...(selected && selected.id !== id ? { selected } : {}) };
}


async function create(page: Page, label: string) {
  const response = await page.request.post('/api/workspaces', { headers, data: { name: `Trash ${label} ${Date.now()}` } });
  expect(response.status()).toBe(201);
  const workspace = await response.json() as Workspace;
  expect((await page.request.post(`/api/workspaces/${workspace.id}/files`, { headers, data: { path: 'preserved.ts', kind: 'file' } })).ok()).toBe(true);
  expect((await page.request.put(`/api/workspaces/${workspace.id}/file`, { headers, data: { path: 'preserved.ts', content: saved } })).ok()).toBe(true);
  return workspace;
}

async function prepare(page: Page, label: string, options: { phone?: boolean; split?: boolean } = {}) {
  if (options.phone) await page.setViewportSize({ width: 390, height: 844 });
  expect((await page.request.post('/api/session', { headers, data: { password } })).status()).toBe(200);
  const current = await create(page, `${label} current`);
  const other = await create(page, `${label} other`);
  expect((await page.request.patch(`/api/workspaces/${current.id}`, { headers, data: { active: true } })).ok()).toBe(true);
  const profile: UiLayoutProfile = options.phone ? 'mobile' : 'desktop';
  const state = await (await page.request.get('/api/ui-state')).json() as UiState;
  expect((await page.request.patch('/api/ui-state', { headers, data: { revision: state.revision, changes: [
    { section: 'layout', profile, key: 'view', value: 'editor' },
    { section: 'layout', profile, key: 'split', value: options.split ? 'split' : 'focus' },
  ] } })).ok()).toBe(true);
  await page.goto('/work');
  await expect(page.locator('.topbar-workspace')).toHaveText(current.name);
  return { current, other };
}

async function edit(page: Page) {
  const editor = page.locator('#editor-workbench');
  await editor.getByRole('treeitem', { name: 'preserved.ts', exact: true }).click();
  const input = editor.locator('.monaco-editor textarea.inputarea').first();
  await expect(input).toBeVisible();
  await input.focus(); await page.keyboard.press('ControlOrMeta+KeyA'); await page.keyboard.insertText(unsaved);
  await expect(page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  return editor.locator('.monaco-editor').first().elementHandle();
}

async function switcher(page: Page) {
  await page.locator('.topbar-workspace').click();
  const dialog = page.getByRole('dialog', { name: 'Your workspaces', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function row(page: Page, workspace: Workspace) {
  const dialog = page.getByRole('dialog', { name: 'Your workspaces', exact: true });
  const search = dialog.getByLabel('Find a workspace', { exact: true });
  if (await search.count()) await search.fill(workspace.name);
  return dialog.locator('.workspace-list-item').filter({ hasText: workspace.name });
}

async function beginTrash(page: Page, workspace: Workspace) {
  const item = await row(page, workspace);
  await item.getByRole('button', { name: `Delete ${workspace.name}`, exact: true }).click();
  await expect(item.locator('.workspace-trash-confirm')).toBeVisible();
  return item;
}

const trashRow = (page: Page, workspace: Workspace) => page.locator('.workspace-trash-item').filter({ has: page.getByText(workspace.name, { exact: true }) });

test('phone workspace trash restores saved files without changing the dirty workspace and confirms permanent deletion', async ({ page }) => {
  const { current, other } = await prepare(page, 'phone controls', { phone: true });
  const editorNode = await edit(page);
  await switcher(page);
  const target = await beginTrash(page, other);
  await target.getByRole('button', { name: 'Move to trash', exact: true }).click();
  await expect(target).toHaveCount(0);
  await page.getByRole('button', { name: 'Workspace trash', exact: true }).click();
  const item = trashRow(page, other);
  await expect(page.locator('.workspace-trash-intro')).toContainText('permanently deleted after 30 days');
  await expect(item).toContainText('Files saved in trash');
  await expect(item.locator('.workspace-trash-expiry')).toContainText('Permanently deleted on');
  await item.getByRole('button', { name: `Restore ${other.name}`, exact: true }).click();
  await expect(item).toHaveCount(0);
  await expect(page.locator('.topbar-workspace')).toHaveText(current.name);
  expect(await editorNode!.evaluate(node => node.isConnected)).toBe(true);
  expect((await (await page.request.get(`/api/workspaces/${other.id}/file`, { params: { path: 'preserved.ts' } })).json()).content).toBe(saved);
  await page.getByRole('button', { name: 'All workspaces', exact: true }).click();
  const restored = await beginTrash(page, other);
  await restored.getByRole('button', { name: 'Move to trash', exact: true }).click();
  await expect(restored).toHaveCount(0);
  await page.getByRole('button', { name: 'Workspace trash', exact: true }).click();
  await item.getByRole('button', { name: `Permanently delete ${other.name}`, exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: `Permanently delete ${other.name}?`, exact: true });
  await expect(confirmation).toContainText('This cannot be undone.');
  await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirmation).toBeHidden();
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: `Permanently delete ${other.name}`, exact: true }).click();
  await confirmation.getByRole('button', { name: 'Permanently delete', exact: true }).click();
  await expect(confirmation).toBeHidden(); await expect(item).toHaveCount(0);
  await page.getByRole('dialog', { name: 'Workspace trash', exact: true }).getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.locator('#editor-workbench .view-lines').first()).toContainText('keep my unsaved workspace edits');
  await expect(page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('moving the current workspace to trash runs the unsaved-buffer guard before sending a delete', async ({ page }) => {
  const { current } = await prepare(page, 'dirty guard');
  const editorNode = await edit(page);
  let deletes = 0;
  page.on('request', request => { if (request.method() === 'DELETE' && new URL(request.url()).pathname === `/api/workspaces/${current.id}`) deletes++; });
  await switcher(page); const item = await beginTrash(page, current);
  page.once('dialog', dialog => dialog.dismiss());
  await item.getByRole('button', { name: 'Move to trash', exact: true }).click();
  await expect(item.getByRole('button', { name: 'Move to trash', exact: true })).toBeEnabled();
  expect(deletes).toBe(0);
  expect(await editorNode!.evaluate(node => node.isConnected)).toBe(true);
  await expect(page.locator('#editor-workbench .view-lines').first()).toContainText('keep my unsaved workspace edits');
  page.once('dialog', dialog => dialog.accept());
  await item.getByRole('button', { name: 'Move to trash', exact: true }).click();
  await expect(item).toHaveCount(0);
  expect(deletes).toBe(1);
  const data = await (await page.request.get('/api/bootstrap')).json() as Bootstrap;
  expect(data.workspaces.some(workspace => workspace.id === current.id)).toBe(false);
  expect(data.activeWorkspaceId === null || data.activeWorkspace?.id === data.activeWorkspaceId).toBe(true);
  expect(data.activeWorkspaceId).not.toBe(current.id);
});

test('external workspace deletion retires active navigation while preserving mounted editor buffers and chat drafts for restoration', async ({ page }) => {
  const { current } = await prepare(page, 'external removal', { split: true });
  const editorNode = await edit(page);
  const draft = page.locator('#agent-workbench .chat-composer textarea');
  await draft.fill('Keep this unsent message while the project is in trash.');
  const chatNode = await page.locator('#agent-workbench .chat-panel').elementHandle();
  const deleted = await page.request.delete(`/api/workspaces/${current.id}`, { headers });
  expect(deleted.status()).toBe(200);
  const result = await deleted.json() as WorkspaceDeleteResult;
  expect(result.mode).toBe('trash');
  if (result.mode !== 'trash') throw new Error('Expected a recoverable ordinary workspace.');
  expect(result.trash.canRestore).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.workspace-recovery-banner')).toContainText(`${current.name} is no longer available.`);
  await expect(page.locator('.topbar-workspace')).toHaveText('Recover open files');
  expect(await editorNode!.evaluate(node => node.isConnected)).toBe(true);
  expect(await chatNode!.evaluate(node => node.isConnected)).toBe(true);
  await expect(draft).toHaveValue('Keep this unsent message while the project is in trash.');
  await expect(page.locator('#editor-workbench .view-lines').first()).toContainText('keep my unsaved workspace edits');
  await switcher(page);
  await expect(await row(page, current)).toHaveCount(0);
  await expect(page.locator('.workspace-list-item.is-current')).toHaveCount(0);
  await page.getByRole('dialog', { name: 'Your workspaces', exact: true }).getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Open workspace trash', exact: true }).click();
  await trashRow(page, current).getByRole('button', { name: `Restore ${current.name}`, exact: true }).click();
  await expect(page.locator('.workspace-recovery-banner')).toHaveCount(0);
  await expect(page.locator('.topbar-workspace')).toHaveText(current.name);
  await page.getByRole('dialog', { name: 'Workspace trash', exact: true }).getByRole('button', { name: 'Close dialog', exact: true }).click();
  expect(await editorNode!.evaluate(node => node.isConnected)).toBe(true);
  expect(await chatNode!.evaluate(node => node.isConnected)).toBe(true);
  await expect(draft).toHaveValue('Keep this unsent message while the project is in trash.');
  await expect(page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
});

test('failed reconciliation keeps navigation intact and verified missing roots have no false restore action', async ({ page }) => {
  const { current, other } = await prepare(page, 'missing files');
  const editorNode = await edit(page);
  let failed = true;
  const missing: WorkspaceTrashEntry = { id: `missing-${current.id}`, workspaceId: current.id, name: current.name, deletedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), reason: 'missing', state: 'missing', canRestore: false };
  await page.route(url => url.pathname === '/api/workspaces', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    if (failed) return route.fulfill({ status: 503, json: { error: 'Storage is temporarily unavailable.' } });
    const response = await route.fetch();
    const workspaces = await response.json() as Workspace[] | WorkspacePage;
    await route.fulfill({ response, json: withoutWorkspace(workspaces, current.id) });
  });
  await page.route(`**/api/workspaces/${current.id}`, route => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({ status: failed ? 503 : 404, json: failed ? { error: 'Storage is temporarily unavailable.' } : { error: 'This workspace directory is missing.', code: 'WORKSPACE_NOT_FOUND' } });
  });
  await page.route(url => url.pathname === '/api/workspace-trash/page', route => route.fulfill({ json: operationalPage([missing], new URL(route.request().url())) }));
  await switcher(page);
  await expect(page.getByRole('alert').filter({ hasText: 'Storage is temporarily unavailable.' })).toBeVisible();
  await expect(await row(page, current)).toBeVisible();
  await expect(page.locator('.workspace-recovery-banner')).toHaveCount(0);
  failed = false;
  await page.getByRole('button', { name: 'Refresh workspaces', exact: true }).click();
  await expect(await row(page, current)).toHaveCount(0);
  await expect(page.locator('.workspace-recovery-banner')).toBeVisible();
  await page.getByRole('button', { name: 'Workspace trash', exact: true }).click();
  const item = trashRow(page, current);
  await expect(item).toContainText('Original files are missing');
  await expect(item.getByRole('button', { name: `Restore ${current.name}`, exact: true })).toBeDisabled();
  expect(await editorNode!.evaluate(node => node.isConnected)).toBe(true);
  await page.getByRole('button', { name: 'All workspaces', exact: true }).click();
  const next = await row(page, other);
  page.once('dialog', dialog => dialog.dismiss());
  await next.locator('.workspace-select').click();
  await expect(page.locator('.workspace-recovery-banner')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Your workspaces', exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await next.locator('.workspace-select').click();
  await expect(page.locator('.topbar-workspace')).toHaveText(other.name);
  await expect(page.locator('.workspace-recovery-banner')).toHaveCount(0);
});

test('a stale workspace listing cannot put a deleted workspace back in navigation', async ({ page }) => {
  const { other } = await prepare(page, 'stale list');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let held = false;
  await page.route(url => url.pathname === '/api/workspaces', async route => {
    if (route.request().method() !== 'GET' || held) return route.continue();
    held = true;
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response }).catch(() => undefined);
  });
  try {
    await switcher(page);
    await expect.poll(() => held).toBe(true);
    const item = await beginTrash(page, other);
    await item.getByRole('button', { name: 'Move to trash', exact: true }).click();
    await expect(item).toHaveCount(0);
    release();
    await page.getByRole('dialog', { name: 'Your workspaces', exact: true }).getByLabel('Find a workspace', { exact: true }).fill('');
    await page.getByRole('button', { name: 'Refresh workspaces', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'All workspaces' })).toBeVisible();
    await expect(item).toHaveCount(0);
  } finally { release(); }
});

test('a delayed delete response from a locked session cannot change the newly selected workspace', async ({ page }) => {
  const { current, other } = await prepare(page, 'stale deletion');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let deleted = false;
  await page.route(`**/api/workspaces/${current.id}`, async route => {
    if (route.request().method() !== 'DELETE') return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(200); deleted = true;
    await gate;
    await route.fulfill({ response }).catch(() => undefined);
  });
  try {
    await switcher(page); const item = await beginTrash(page, current);
    await item.getByRole('button', { name: 'Move to trash', exact: true }).click();
    await expect.poll(() => deleted).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('codex:session-expired')));
    await page.getByLabel('Workspace password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.locator('.workspace-recovery-banner')).toBeVisible();
    await switcher(page); await (await row(page, other)).locator('.workspace-select').click();
    await expect(page.locator('.topbar-workspace')).toHaveText(other.name);
    release();
    await switcher(page);
    await expect(await row(page, current)).toHaveCount(0);
    await page.getByRole('dialog', { name: 'Your workspaces', exact: true }).getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(page.locator('.topbar-workspace')).toHaveText(other.name);
    await expect(page.locator('.workspace-recovery-banner')).toHaveCount(0);
  } finally { release(); }
});

test('a changed GitHub deletion plan requires a new permanent local deletion confirmation and never promises restoration', async ({ page }) => {
  const { current, other } = await prepare(page, 'GitHub deletion plan');
  let mode: WorkspaceDeletionPlan['mode'] = 'trash';
  let removed = false;
  const submittedModes: string[] = [];
  // The server owns classification; this controlled change exercises the UI
  // contract without deriving GitHub provenance from a saved account selection.
  await page.route(`**/api/workspaces/${other.id}/deletion`, route => route.fulfill({ json: { workspaceId: other.id, mode, retentionDays: mode === 'trash' ? 30 : null } satisfies WorkspaceDeletionPlan }));
  await page.route(`**/api/workspaces/${other.id}`, async route => {
    if (route.request().method() !== 'DELETE') return route.continue();
    const input = route.request().postDataJSON() as { expectedMode: string };
    submittedModes.push(input.expectedMode);
    if (input.expectedMode === 'trash') {
      mode = 'permanent';
      await route.fulfill({ status: 409, json: { error: 'Deletion options changed. Review them again before deleting.', code: 'WORKSPACE_DELETION_CHANGED' } });
      return;
    }
    expect(input.expectedMode).toBe('permanent');
    removed = true;
    await route.fulfill({ json: { removed: true, mode: 'permanent', workspaceId: other.id } satisfies WorkspaceDeleteResult });
  });
  await page.route(url => url.pathname === '/api/workspaces', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const workspaces = await response.json() as Workspace[] | WorkspacePage;
    await route.fulfill({ response, json: removed ? withoutWorkspace(workspaces, other.id) : workspaces });
  });
  await switcher(page);
  const item = await beginTrash(page, other);
  await expect(item.locator('.workspace-trash-confirm')).toContainText('restored for 30 days');
  await item.getByRole('button', { name: 'Move to trash', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Deletion options changed.' })).toBeVisible();
  await expect(item.getByRole('button', { name: 'Move to trash', exact: true })).toHaveCount(0);
  expect(submittedModes).toEqual(['trash']);
  expect(removed).toBe(false);
  await item.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(item.locator('.workspace-trash-confirm')).toContainText('its local files');
  await expect(item.locator('.workspace-trash-confirm')).toContainText('this cannot be undone');
  await expect(item.locator('.workspace-trash-confirm')).toContainText('The repository on GitHub will remain.');
  await expect(item.locator('.workspace-trash-confirm')).not.toContainText('restored for 30 days');
  expect(submittedModes).toEqual(['trash']);
  await item.getByRole('button', { name: 'Delete workspace permanently', exact: true }).click();
  await expect(item).toHaveCount(0);
  expect(submittedModes).toEqual(['trash', 'permanent']);
  await expect(page.locator('.topbar-workspace')).toHaveText(current.name);
  await expect(page.getByRole('status').filter({ hasText: 'Local workspace deleted permanently. The GitHub repository is unchanged.' })).toBeVisible();
  await page.getByRole('button', { name: 'Workspace trash', exact: true }).click();
  await expect(trashRow(page, other)).toHaveCount(0);
});

test('unavailable workspaces keep real terminal sessions reachable and closable without creating replacement shells', async ({ page }) => {
  await page.addInitScript(() => {
    const sockets: WebSocket[] = [];
    (window as unknown as { __workspaceTrashSockets: WebSocket[] }).__workspaceTrashSockets = sockets;
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (String(url).includes('/ws/terminal?')) sockets.push(this);
      }
    };
  });
  const sockets: string[] = [];
  page.on('websocket', socket => { if (socket.url().includes('/ws/terminal?')) sockets.push(socket.url()); });
  const { current } = await prepare(page, 'retained terminals');
  const navigation = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  await navigation.getByRole('button', { name: 'Terminal', exact: true }).click();
  const terminal = page.getByRole('region', { name: 'Workspace terminal', exact: true });
  const surface = terminal.locator('.terminal-surface:not([hidden])');
  await expect(surface).toHaveAttribute('data-connection', 'connected');
  const terminalNode = await surface.elementHandle();
  const before = await (await page.request.get(`/api/workspaces/${current.id}/terminals`)).json() as TerminalSession[];
  expect(before).toHaveLength(1);
  await surface.getByLabel('Terminal input', { exact: true }).focus();
  await page.keyboard.insertText("printf 'TRASH_%s\\n' 'TERMINAL_ALIVE'"); await page.keyboard.press('Enter');
  await expect(surface.locator('.xterm-rows')).toContainText('TRASH_TERMINAL_ALIVE');

  await page.route(url => url.pathname === '/api/workspaces', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const workspaces = await response.json() as Workspace[] | WorkspacePage;
    await route.fulfill({ response, json: withoutWorkspace(workspaces, current.id) });
  });
  await page.route(`**/api/workspaces/${current.id}`, route => route.request().method() === 'GET'
    ? route.fulfill({ status: 404, json: { error: 'The workspace registration is no longer available.', code: 'WORKSPACE_NOT_FOUND' } }) : route.continue());
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.workspace-recovery-banner')).toBeVisible();
  await expect(terminal).toBeVisible();
  await expect(terminal.getByRole('button', { name: 'New terminal', exact: true })).toBeDisabled();
  expect(await terminalNode!.evaluate(node => node.isConnected)).toBe(true);
  await navigation.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(terminal).toBeHidden();
  await navigation.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(terminal).toBeVisible();
  expect(await terminalNode!.evaluate(node => node.isConnected)).toBe(true);
  expect(sockets).toHaveLength(1);

  await page.evaluate(() => (window as unknown as { __workspaceTrashSockets: WebSocket[] }).__workspaceTrashSockets[0].close(4000, 'Test recovery reconnect'));
  await expect.poll(() => sockets.length).toBe(2);
  const reconnect = new URL(sockets[1]);
  expect(reconnect.searchParams.get('existingOnly')).toBe('1');
  expect(reconnect.searchParams.get('sessionId')).toBe(before[0].id);
  expect(reconnect.searchParams.has('new')).toBe(false);
  await expect(surface).toHaveAttribute('data-connection', 'connected');
  const retained = await (await page.request.get(`/api/workspaces/${current.id}/terminals`, { params: { existingOnly: '1' } })).json() as TerminalSession[];
  expect(retained.map(session => session.id)).toEqual([before[0].id]);
  await terminal.getByRole('button', { name: `Close ${retained[0].title}`, exact: true }).click();
  await expect(terminal).toBeHidden();
  await expect(terminal.locator('.terminal-panel')).toHaveCount(0);
  await navigation.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(terminal).toBeVisible();
  await expect(terminal).toContainText('No retained terminals.');
  await expect(terminal.getByRole('button', { name: 'New terminal', exact: true })).toBeDisabled();
  expect(sockets).toHaveLength(2);
  expect(await (await page.request.get(`/api/workspaces/${current.id}/terminals`, { params: { existingOnly: '1' } })).json()).toEqual([]);
  await terminal.getByRole('button', { name: 'Close terminal view', exact: true }).click();
  await expect(terminal.locator('.terminal-panel')).toHaveCount(0);
});

test('unfinished permanent deletions stay separate from usable trash and retry their exact saved operation', async ({ page }) => {
  const { current, other } = await prepare(page, 'deletion status');
  const removed = await page.request.delete(`/api/workspaces/${other.id}`, { headers, data: { expectedMode: 'trash' } });
  expect(removed.status()).toBe(200);
  const deletion: WorkspaceDeletionStatus = { id: `journal-${other.id}`, workspaceId: `permanent-${other.id}`, name: 'GitHub cleanup needing attention', mode: 'permanent', state: 'error', updatedAt: new Date().toISOString(), issue: 'Some local files could not be removed.' };
  let statuses = [deletion];
  let statusUnavailable = true;
  let trashUnavailable = false;
  let attempts = 0;
  const requests: Array<{ path: string; method: string; body: unknown }> = [];
  let genericDeletes = 0;
  page.on('request', request => { if (request.method() === 'DELETE' && new URL(request.url()).pathname === `/api/workspaces/${deletion.workspaceId}`) genericDeletes++; });
  await page.route(url => url.pathname === '/api/workspace-trash/page', route => trashUnavailable ? route.fulfill({ status: 503, json: { error: 'Trash refresh is temporarily unavailable.' } }) : route.continue());
  await page.route(url => url.pathname === '/api/workspace-deletions/page', route => statusUnavailable ? route.fulfill({ status: 503, json: { error: 'Permanent deletion status is temporarily unavailable.' } }) : route.fulfill({ json: operationalPage(statuses, new URL(route.request().url())) }));
  await page.route(`**/api/workspace-deletions/${deletion.id}/retry`, async route => {
    requests.push({ path: new URL(route.request().url()).pathname, method: route.request().method(), body: route.request().postDataJSON() });
    if (++attempts === 1) { await route.fulfill({ status: 409, json: { error: 'Close the retained terminal before retrying this deletion.', code: 'WORKSPACE_BUSY' } }); return; }
    statuses = [];
    await route.fulfill({ json: { removed: true, mode: 'permanent', workspaceId: deletion.workspaceId } satisfies WorkspaceDeleteResult });
  });
  await switcher(page);
  await page.getByRole('button', { name: 'Workspace trash', exact: true }).click();
  const ordinary = trashRow(page, other);
  const permanent = page.getByRole('region', { name: 'Permanent deletions', exact: true });
  await expect(permanent.getByRole('alert')).toContainText('Permanent deletion status is temporarily unavailable.');
  await expect(ordinary).toBeVisible();
  await expect(ordinary.getByRole('button', { name: `Restore ${other.name}`, exact: true })).toBeEnabled();

  statusUnavailable = false; trashUnavailable = true;
  await page.getByRole('button', { name: 'Refresh workspace trash', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Trash refresh is temporarily unavailable.' })).toBeVisible();
  await expect(ordinary).toBeVisible();
  const item = permanent.locator('.workspace-permanent-deletion-item').filter({ hasText: deletion.name });
  await expect(item).toContainText('Permanent deletion needs attention');
  await expect(item).toContainText('Local files may remain');
  await expect(item.getByRole('button', { name: /^Restore/ })).toHaveCount(0);
  const retry = item.getByRole('button', { name: `Retry permanent deletion of ${deletion.name}`, exact: true });
  await retry.click();
  await expect(permanent.getByRole('alert')).toContainText('Close the retained terminal before retrying this deletion.');
  await expect(item).toBeVisible(); await expect(retry).toBeEnabled();
  await expect(ordinary).toBeVisible();
  await retry.click();
  await expect(item).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: `${deletion.name} was deleted permanently from local storage.` })).toBeVisible();
  expect(requests).toEqual([
    { path: `/api/workspace-deletions/${deletion.id}/retry`, method: 'POST', body: {} },
    { path: `/api/workspace-deletions/${deletion.id}/retry`, method: 'POST', body: {} },
  ]);
  expect(genericDeletes).toBe(0);
  await expect(page.locator('.topbar-workspace')).toHaveText(current.name);
  await ordinary.getByRole('button', { name: `Restore ${other.name}`, exact: true }).click();
  await expect(ordinary).toHaveCount(0);
  expect((await (await page.request.get(`/api/workspaces/${other.id}/file`, { params: { path: 'preserved.ts' } })).json()).content).toBe(saved);
});

test('a stale permanent-deletion retry cannot affect a later workspace or a newer deletion record', async ({ page }) => {
  const { current, other } = await prepare(page, 'deletion retry generation');
  const old: WorkspaceDeletionStatus = { id: `old-journal-${other.id}`, workspaceId: other.id, name: 'Earlier confirmed deletion', mode: 'permanent', state: 'pending', updatedAt: new Date().toISOString() };
  const newer: WorkspaceDeletionStatus = { ...old, id: `new-journal-${other.id}`, name: 'Newer deletion needing attention', state: 'error', issue: 'Review this separate saved operation.' };
  let statuses = [old];
  const retries: string[] = [];
  let genericDeletes = 0;
  page.on('request', request => { if (request.method() === 'DELETE' && new URL(request.url()).pathname === `/api/workspaces/${other.id}`) genericDeletes++; });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(url => url.pathname === '/api/workspace-deletions/page', route => route.fulfill({ json: operationalPage(statuses, new URL(route.request().url())) }));
  await page.route(`**/api/workspace-deletions/${old.id}/retry`, async route => {
    retries.push(new URL(route.request().url()).pathname);
    await gate;
    await route.fulfill({ json: { removed: true, mode: 'permanent', workspaceId: other.id } satisfies WorkspaceDeleteResult }).catch(() => undefined);
  });
  try {
    await switcher(page); await page.getByRole('button', { name: 'Workspace trash', exact: true }).click();
    await page.getByRole('button', { name: `Retry permanent deletion of ${old.name}`, exact: true }).click();
    await expect.poll(() => retries.length).toBe(1);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('codex:session-expired')));
    statuses = [newer];
    await page.getByLabel('Workspace password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.locator('.topbar-workspace')).toHaveText(current.name);
    await switcher(page); await (await row(page, other)).locator('.workspace-select').click();
    await expect(page.locator('.topbar-workspace')).toHaveText(other.name);
    await switcher(page); await page.getByRole('button', { name: 'Workspace trash', exact: true }).click();
    const fresh = page.locator('.workspace-permanent-deletion-item').filter({ hasText: newer.name });
    await expect(fresh).toBeVisible();
    release();
    await page.getByRole('button', { name: 'Refresh workspace trash', exact: true }).click();
    await expect(fresh.getByRole('button', { name: `Retry permanent deletion of ${newer.name}`, exact: true })).toBeEnabled();
    await expect(fresh).toContainText('Review this separate saved operation.');
    await expect(page.getByRole('status').filter({ hasText: `${old.name} was deleted permanently` })).toHaveCount(0);
    await expect(page.locator('.topbar-workspace')).toHaveText(other.name);
    expect(retries).toEqual([`/api/workspace-deletions/${old.id}/retry`]);
    expect(genericDeletes).toBe(0);
  } finally { release(); }
});

function manyTrashEntries(count: number): WorkspaceTrashEntry[] {
  const deletedAt = new Date().toISOString(), expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  return Array.from({ length: count }, (_, index) => ({ id: `fixture-trash-journal-${index}`, workspaceId: `fixture-deleted-workspace-${index}`,
    name: `Archived project ${String(index).padStart(3, '0')}`, deletedAt, expiresAt, reason: 'deleted', state: 'ready', canRestore: true }));
}

test('pages and searches trash and permanent statuses independently with bounded phone cards and keyboard controls', async ({ page }) => {
  const { current } = await prepare(page, 'paged status lists', { phone: true });
  const trash = manyTrashEntries(110);
  const permanent: WorkspaceDeletionStatus[] = Array.from({ length: 80 }, (_, index) => ({ id: `fixture-permanent-journal-${index}`,
    workspaceId: `fixture-permanent-workspace-${index}`, name: `Permanent project ${String(index).padStart(3, '0')}`, mode: 'permanent',
    state: 'error', updatedAt: new Date().toISOString(), issue: 'Retained local files need an explicit retry.' }));
  const delivered: Array<{ collection: string; offset: number; count: number; limit: number; q: string }> = [];
  const mutations: string[] = [];
  page.on('request', request => { if (request.method() !== 'GET' && /^\/api\/workspace-(trash|deletions)/.test(new URL(request.url()).pathname)) mutations.push(request.url()); });
  await page.route(url => url.pathname === '/api/workspace-trash/page', route => {
    const url = new URL(route.request().url()), result = operationalPage(trash, url);
    delivered.push({ collection: 'trash', offset: result.offset, count: result.items.length, limit: result.limit, q: url.searchParams.get('q') || '' });
    return route.fulfill({ json: result });
  });
  await page.route(url => url.pathname === '/api/workspace-deletions/page', route => {
    const url = new URL(route.request().url()), result = operationalPage(permanent, url);
    delivered.push({ collection: 'permanent', offset: result.offset, count: result.items.length, limit: result.limit, q: url.searchParams.get('q') || '' });
    return route.fulfill({ json: result });
  });
  await switcher(page); await page.getByRole('button', { name: 'Workspace trash', exact: true }).click();
  await expect(page.locator('.workspace-trash-item').filter({ hasText: trash[0].name })).toBeVisible();
  await expect.poll(() => page.locator('.workspace-trash-item').count()).toBeLessThan(12);
  await expect.poll(() => page.locator('.workspace-permanent-deletion-item').count()).toBeLessThan(12);
  expect(delivered.some(item => item.collection === 'trash' && item.count === 25)).toBe(true);
  expect(delivered.some(item => item.collection === 'permanent' && item.count === 25)).toBe(true);
  const nextTrash = page.getByRole('button', { name: 'Next workspace trash', exact: true });
  await nextTrash.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.workspace-trash-item').filter({ hasText: trash[25].name })).toBeVisible();
  await expect(page.locator('.workspace-trash-item').filter({ hasText: trash[0].name })).toHaveCount(0);
  await expect(nextTrash).toBeFocused();
  expect((await nextTrash.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: 'Next permanent deletions', exact: true }).click();
  await expect(page.locator('.workspace-permanent-deletion-item').filter({ hasText: permanent[25].name })).toBeVisible();
  await expect(page.locator('.workspace-trash-item').filter({ hasText: trash[25].name })).toBeAttached();
  await page.getByRole('searchbox', { name: 'Search workspace trash', exact: true }).fill(trash[105].name);
  await expect(page.locator('.workspace-trash-item')).toHaveCount(1);
  await expect(page.locator('.workspace-trash-item')).toContainText(trash[105].name);
  await page.getByRole('searchbox', { name: 'Search permanent deletions', exact: true }).fill(permanent[79].name);
  const retained = page.locator('.workspace-permanent-deletion-item');
  await expect(retained).toHaveCount(1); await expect(retained).toContainText(permanent[79].name);
  await expect(retained.getByRole('button', { name: /^Restore/ })).toHaveCount(0);
  expect(delivered.every(item => item.count <= 25 && item.limit === 25)).toBe(true);
  expect(delivered.some(item => item.collection === 'trash' && item.q === trash[105].name && item.offset === 0)).toBe(true);
  expect(delivered.some(item => item.collection === 'permanent' && item.q === permanent[79].name && item.offset === 0)).toBe(true);
  expect(mutations).toEqual([]);
  await expect(page.locator('.topbar-workspace')).toHaveText(current.name);
  expect(await page.getByRole('dialog', { name: 'Workspace trash', exact: true }).evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
});

test('an older trash page cannot replace a newer search or trigger recovery after its request is cancelled', async ({ page }) => {
  await prepare(page, 'late trash page');
  const trash = manyTrashEntries(80);
  let release!: () => void, held = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const mutations: string[] = [];
  page.on('request', request => { if (request.method() !== 'GET' && /^\/api\/workspace-(trash|deletions)/.test(new URL(request.url()).pathname)) mutations.push(request.url()); });
  await page.route(url => url.pathname === '/api/workspace-trash/page', async route => {
    const url = new URL(route.request().url()), result = operationalPage(trash, url);
    if (url.searchParams.get('offset') === '25' && !url.searchParams.has('q')) { held = true; await gate; }
    await route.fulfill({ json: result }).catch(() => undefined);
  });
  await page.route(url => url.pathname === '/api/workspace-deletions/page', route => route.fulfill({ json: operationalPage([], new URL(route.request().url())) }));
  try {
    await switcher(page); await page.getByRole('button', { name: 'Workspace trash', exact: true }).click();
    await expect(page.locator('.workspace-trash-item').filter({ hasText: trash[0].name })).toBeVisible();
    await page.getByRole('button', { name: 'Next workspace trash', exact: true }).click();
    await expect.poll(() => held).toBe(true);
    await page.getByRole('searchbox', { name: 'Search workspace trash', exact: true }).fill(trash[77].name);
    await expect(page.locator('.workspace-trash-item')).toHaveCount(1);
    await expect(page.locator('.workspace-trash-item')).toContainText(trash[77].name);
    release();
    await expect(page.locator('.workspace-trash-item').filter({ hasText: trash[25].name })).toHaveCount(0);
    await page.getByRole('button', { name: 'Refresh workspace trash', exact: true }).click();
    await expect(page.locator('.workspace-trash-item')).toHaveCount(1);
    await expect(page.locator('.workspace-trash-item')).toContainText(trash[77].name);
    expect(mutations).toEqual([]);
  } finally { release(); }
});

test('healthy trash remains usable while permanent statuses load and restores keyboard focus after its own refresh completes', async ({ page }) => {
  const { other } = await prepare(page, 'independent page readiness');
  const removal = await page.request.delete(`/api/workspaces/${other.id}`, { headers, data: { expectedMode: 'trash' } });
  expect(removal.status()).toBe(200);
  const result = await removal.json() as WorkspaceDeleteResult;
  if (result.mode !== 'trash') throw new Error('Expected a real recoverable workspace.');
  const remaining = { ...manyTrashEntries(1)[0], name: 'Another saved workspace' };
  let records = [result.trash, remaining], restored = false, refreshing = false, statusHeld = false;
  let releaseStatus!: () => void, releaseRefresh!: () => void;
  const statusGate = new Promise<void>(resolve => { releaseStatus = resolve; });
  const refreshGate = new Promise<void>(resolve => { releaseRefresh = resolve; });
  await page.route(url => url.pathname === '/api/workspace-trash/page', async route => {
    if (restored) { refreshing = true; await refreshGate; }
    await route.fulfill({ json: operationalPage(records, new URL(route.request().url())) }).catch(() => undefined);
  });
  await page.route(url => url.pathname === '/api/workspace-deletions/page', async route => {
    statusHeld = true; await statusGate;
    await route.fulfill({ json: operationalPage([], new URL(route.request().url())) }).catch(() => undefined);
  });
  await page.route(`**/api/workspace-trash/${result.trash.id}/restore`, async route => {
    const response = await route.fetch(); expect(response.status()).toBe(200);
    restored = true; records = [remaining];
    await route.fulfill({ response });
  });
  try {
    await switcher(page); await page.getByRole('button', { name: 'Workspace trash', exact: true }).click();
    await expect.poll(() => statusHeld).toBe(true);
    const restore = page.getByRole('button', { name: `Restore ${other.name}`, exact: true });
    await expect(restore).toBeEnabled(); await restore.focus(); await page.keyboard.press('Enter');
    await expect.poll(() => refreshing).toBe(true);
    releaseRefresh();
    const nextAction = page.getByRole('button', { name: `Permanently delete ${remaining.name}`, exact: true });
    await expect(nextAction).toBeEnabled(); await expect(nextAction).toBeFocused();
    await expect(page.getByRole('region', { name: 'Permanent deletions', exact: true })).toContainText('Loading permanent deletion status');
    expect((await (await page.request.get(`/api/workspaces/${other.id}/file`, { params: { path: 'preserved.ts' } })).json()).content).toBe(saved);
  } finally { releaseStatus(); releaseRefresh(); }
});

test('finishing the last deletion on a later page keeps earlier statuses reachable when the follow-up read fails', async ({ page }) => {
  await prepare(page, 'empty later status page');
  let statuses: WorkspaceDeletionStatus[] = Array.from({ length: 26 }, (_, index) => ({ id: `last-page-journal-${index}`,
    workspaceId: `last-page-workspace-${index}`, name: `Saved permanent deletion ${String(index).padStart(3, '0')}`,
    mode: 'permanent', state: 'error', updatedAt: new Date().toISOString(), issue: 'A saved deletion needs attention.' }));
  const target = statuses[25];
  let completed = false;
  const retries: string[] = [];
  await page.route(url => url.pathname === '/api/workspace-trash/page', route => route.fulfill({ json: operationalPage([], new URL(route.request().url())) }));
  await page.route(url => url.pathname === '/api/workspace-deletions/page', route => {
    const url = new URL(route.request().url());
    if (completed && url.searchParams.get('offset') === '25') return route.fulfill({ status: 503, json: { error: 'The remaining statuses could not be refreshed.' } });
    return route.fulfill({ json: operationalPage(statuses, url) });
  });
  await page.route(`**/api/workspace-deletions/${target.id}/retry`, route => {
    retries.push(new URL(route.request().url()).pathname); completed = true; statuses = statuses.filter(item => item.id !== target.id);
    return route.fulfill({ json: { removed: true, mode: 'permanent', workspaceId: target.workspaceId } satisfies WorkspaceDeleteResult });
  });
  await switcher(page); await page.getByRole('button', { name: 'Workspace trash', exact: true }).click();
  await page.getByRole('button', { name: 'Next permanent deletions', exact: true }).click();
  await page.getByRole('button', { name: `Retry permanent deletion of ${target.name}`, exact: true }).click();
  const section = page.getByRole('region', { name: 'Permanent deletions', exact: true });
  await expect(section.getByRole('alert')).toContainText('remaining statuses could not be refreshed');
  await expect(section).toContainText('This page is empty. Choose Previous or refresh the list.');
  await expect(section).not.toContainText('No unfinished permanent deletions.');
  await section.getByRole('button', { name: 'Previous permanent deletions', exact: true }).click();
  await expect(section.locator('.workspace-permanent-deletion-item').filter({ hasText: statuses[0].name })).toBeVisible();
  expect(retries).toEqual([`/api/workspace-deletions/${target.id}/retry`]);
});
