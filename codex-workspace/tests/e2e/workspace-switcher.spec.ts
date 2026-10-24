import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { Workspace, WorkspaceDeletionPlan } from '../../shared/types';

// Production components use an isolated in-memory HTTP peer. No user workspace
// or application server is read, created, deleted, or reset by these tests.
const at = '2026-09-30T12:00:00.000Z';
const records = (): Workspace[] => Array.from({ length: 86 }, (_, index) => ({
  id: `picker-${index}`, name: `Fixture ${String(index).padStart(3, '0')}`, path: `/fixture/workspaces/${index}`,
  createdAt: at, updatedAt: at,
  ...(index === 1 ? { source: { kind: 'github' as const, fullName: 'fixture/repository' } } : {}),
  // An editable account selection alone must never imply repository provenance.
  ...(index === 2 ? { githubAccountId: 'fixture-account' } : {}),
  ...(index === 3 ? { worktree: { id: 'fixture-checkout', sourceWorkspaceId: 'picker-1', repositoryWorkspaceId: 'picker-1', gitDirectory: '/fixture/.git/worktrees/checkout', commonDirectory: '/fixture/.git' } } : {}),
}));
interface RequestRecord { method: string; path: string; query: Record<string, string>; body?: Record<string, unknown> }
interface FixtureState { workspaces: Workspace[]; requests: RequestRecord[]; holdCreate: boolean; heldCreate?: ServerResponse; failPlan?: string }
interface BrowserState { activeWorkspaceId: string; closes: number; events: Array<{ kind: string; id?: string; name?: string; initializeGit?: boolean; mode?: string }> }
type FixtureWindow = Window & { workspacePickerFixture: { state: () => BrowserState; update: (patch: { blockChanges?: boolean }) => void } };
let http: FixtureState;
let server: Server;
let origin = '';
let script = '', styles = '';

function reply(response: ServerResponse, status: number, body: unknown) {
  if (response.destroyed) return;
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
function snapshot(page: Page) { return page.evaluate(() => (window as unknown as FixtureWindow).workspacePickerFixture.state()); }
function update(page: Page, patch: { blockChanges?: boolean }) { return page.evaluate(patch => (window as unknown as FixtureWindow).workspacePickerFixture.update(patch), patch); }
function dialog(page: Page) { return page.getByRole('dialog', { name: 'Your workspaces', exact: true }); }
async function open(page: Page) {
  await page.getByRole('button', { name: 'Open workspaces', exact: true }).click();
  await expect(dialog(page).getByRole('button', { name: 'Refresh workspaces', exact: true })).toBeEnabled();
}

test.beforeAll(async () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const bundle = await build({
    absWorkingDir: root,
    stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import WorkspaceSwitcher from './client/components/WorkspaceSwitcher';
      import { api, json } from './client/api';
      import { installScrollActivity } from './client/scroll-activity';
      import { installTooltips } from './client/tooltips';
      import './client/styles.css';
      import './client/scrollbars.css';
      import './client/tooltips.css';
      installScrollActivity(); installTooltips();
      const root = createRoot(document.getElementById('root'));
      const events = [];
      let closes = 0;
      let current = { open: false, workspaces: [], activeWorkspaceId: 'picker-85', blockChanges: false };
      const update = patch => { current = { ...current, ...patch }; render(); };
      async function onCreate(name, initializeGit) {
        events.push({ kind: 'create', name, initializeGit });
        if (current.blockChanges) return false;
        const workspace = await api('/workspaces', json('POST', { name, initializeGit }));
        update({ workspaces: [...current.workspaces, workspace], activeWorkspaceId: workspace.id });
        return true;
      }
      async function onSelect(workspace) {
        events.push({ kind: 'select', id: workspace.id });
        if (current.blockChanges) return false;
        await api('/workspaces/' + encodeURIComponent(workspace.id), json('PATCH', { active: true }));
        update({ activeWorkspaceId: workspace.id });
        return true;
      }
      async function onDelete(workspace, plan) {
        events.push({ kind: 'delete', id: workspace.id, mode: plan.mode });
        if (current.blockChanges) return false;
        await api('/workspaces/' + encodeURIComponent(workspace.id), json('DELETE', { expectedMode: plan.mode }));
        update({ workspaces: current.workspaces.filter(item => item.id !== workspace.id) });
        return true;
      }
      function render() {
        root.render(<React.StrictMode><main style={{ padding: 24 }}>
          <button className="button" onClick={() => update({ open: true })}>Open workspaces</button>
          <textarea aria-label="Retained editor draft" defaultValue="Unsaved editor work" />
          <WorkspaceSwitcher open={current.open} onClose={() => { closes++; update({ open: false }); }}
            workspaces={current.workspaces} workspacePage={{ offset: 0, total: current.workspaces.length, nextCursor: '40', previousCursor: null }}
            currentWorkspace={current.workspaces.find(item => item.id === current.activeWorkspaceId) || null} activeWorkspaceId={current.activeWorkspaceId}
            onSelect={onSelect} onCreate={onCreate} onDelete={onDelete} onRename={async () => undefined}
            onImport={() => events.push({ kind: 'import' })} onWorkspaceRestored={() => undefined}
            onWorktreeWorkspaceReady={() => undefined} onWorktreeWorkspaceArchived={() => undefined} />
        </main></React.StrictMode>);
      }
      window.workspacePickerFixture = { update, state: () => ({ ...current, closes, events }) };
      api('/fixture/seed').then(workspaces => update({ workspaces }));
    `, loader: 'tsx', resolveDir: root },
    bundle: true, write: false, outfile: 'workspace-picker-fixture.js', platform: 'browser', format: 'iife', target: 'es2022', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent',
  });
  script = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  styles = bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text;
  server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://fixture.invalid');
    const path = url.pathname;
    if (path === '/work') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); return; }
    if (path === '/fixture.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(script); return; }
    if (path === '/fixture.css') { response.writeHead(200, { 'Content-Type': 'text/css' }); response.end(styles); return; }
    if (path === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    if (path === '/api/fixture/seed') { reply(response, 200, http.workspaces); return; }
    const method = request.method || 'GET';
    let body: Record<string, unknown> | undefined;
    if (method !== 'GET') {
      let bytes = ''; for await (const chunk of request) bytes += String(chunk);
      body = bytes ? JSON.parse(bytes) as Record<string, unknown> : undefined;
    }
    http.requests.push({ method, path, query: Object.fromEntries(url.searchParams), body });
    if (path === '/api/workspaces' && method === 'GET') {
      const query = (url.searchParams.get('query') || '').toLowerCase();
      const limit = Number(url.searchParams.get('limit') || 40), offset = Number(url.searchParams.get('cursor') || 0);
      const matches = http.workspaces.filter(workspace => `${workspace.name} ${workspace.path}`.toLowerCase().includes(query));
      reply(response, 200, { workspaces: matches.slice(offset, offset + limit), offset, total: matches.length, nextCursor: offset + limit < matches.length ? String(offset + limit) : null, previousCursor: offset ? String(Math.max(0, offset - limit)) : null }); return;
    }
    if (path === '/api/workspaces' && method === 'POST') {
      if (http.holdCreate) { http.heldCreate = response; return; }
      const workspace: Workspace = { id: 'fixture-created', name: String(body?.name), path: '/fixture/created', createdAt: at, updatedAt: at };
      http.workspaces.push(workspace); reply(response, 201, workspace); return;
    }
    const match = /^\/api\/workspaces\/([^/]+)(\/deletion)?$/.exec(path);
    if (match) {
      const workspace = http.workspaces.find(item => item.id === match[1]);
      if (!workspace) { reply(response, 404, { error: 'Fixture workspace does not exist.' }); return; }
      if (match[2] && method === 'GET') {
        if (http.failPlan) { reply(response, 503, { error: http.failPlan }); return; }
        const mode = workspace.source?.kind === 'github' ? 'permanent' : 'trash';
        const plan: WorkspaceDeletionPlan = { workspaceId: workspace.id, mode, retentionDays: mode === 'trash' ? 30 : null };
        reply(response, 200, plan); return;
      }
      if (method === 'DELETE') { http.workspaces = http.workspaces.filter(item => item.id !== workspace.id); reply(response, 200, { deleted: true }); return; }
      if (method === 'PATCH') { reply(response, 200, workspace); return; }
    }
    reply(response, 404, { error: 'No route in isolated fixture.' });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
test.beforeEach(async ({ page }) => {
  http?.heldCreate?.destroy();
  http = { workspaces: records(), requests: [], holdCreate: false };
  await page.goto(`${origin}/work`);
  await expect(page.getByRole('button', { name: 'Open workspaces', exact: true })).toBeVisible();
});

for (const viewport of [{ name: 'desktop', width: 1440, height: 960 }, { name: 'phone', width: 390, height: 844 }]) {
  test(`${viewport.name}: actions precede search and the list retains its query, page and scroll through create and reopen`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await open(page);
    const picker = dialog(page);
    const search = picker.getByLabel('Find a workspace', { exact: true });
    const list = picker.getByRole('list', { name: 'Workspaces', exact: true });
    await expect(search).toBeFocused();
    const actions = await picker.getByRole('group', { name: 'Manage workspaces', exact: true }).boundingBox();
    const searchBox = await search.boundingBox(), listBox = await list.boundingBox();
    expect(actions!.y + actions!.height).toBeLessThan(searchBox!.y);
    expect(searchBox!.y + searchBox!.height).toBeLessThan(listBox!.y);
    expect(await list.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await expect(picker.locator('button button')).toHaveCount(0);
    await search.fill('Fixture');
    await expect(picker.locator('.workspace-pagination')).toContainText('1–40 of 86');
    await picker.getByRole('button', { name: 'Next workspaces', exact: true }).click();
    await expect(picker.locator('.workspace-pagination')).toContainText('41–80 of 86');
    await list.evaluate(element => { element.scrollTop = 184; });
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(184);
    const listNode = await list.elementHandle();
    await picker.getByRole('button', { name: 'Create workspace', exact: true }).click();
    const create = page.getByRole('dialog', { name: 'Create workspace', exact: true });
    await expect(create.getByLabel('Workspace name', { exact: true })).toBeFocused();
    await create.getByLabel('Workspace name', { exact: true }).fill('Keep this project name');
    await create.getByRole('button', { name: 'Back to workspaces', exact: true }).click();
    await expect(search).toHaveValue('Fixture');
    await expect(picker.locator('.workspace-pagination')).toContainText('41–80 of 86');
    expect(await listNode!.evaluate(node => node.isConnected)).toBe(true);
    expect(await list.evaluate(element => element.scrollTop)).toBe(184);
    await expect(picker.getByRole('button', { name: 'Create workspace', exact: true })).toBeFocused();
    await picker.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await expect(create.getByLabel('Workspace name', { exact: true })).toHaveValue('Keep this project name');
    await page.keyboard.press('Escape');
    await expect(picker).toBeVisible();
    expect(await list.evaluate(element => element.scrollTop)).toBe(184);
    await picker.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await create.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(search).toHaveValue('Fixture');
    await picker.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await open(page);
    await expect(search).toHaveValue('Fixture');
    await expect(picker.locator('.workspace-pagination')).toContainText('41–80 of 86');
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(184);
    await expect(picker.locator('.workspace-select[aria-current="true"]')).toContainText('Fixture 085');
    expect(await picker.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    if (viewport.name === 'phone') {
      expect((await picker.locator('.workspace-delete-action').first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect((await picker.getByRole('button', { name: 'Create workspace', exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: testInfo.outputPath(`workspace-manager-${viewport.name}.png`), animations: 'disabled' });
    expect(http.requests.filter(request => request.method !== 'GET')).toEqual([]);
  });
}

test('search Enter and row arrow navigation switch directly while declined callbacks retain the draft', async ({ page }) => {
  await page.getByLabel('Retained editor draft').fill('Keep this unsaved editor buffer');
  await open(page);
  const picker = dialog(page), search = picker.getByLabel('Find a workspace', { exact: true });
  await search.fill('Fixture 007');
  await expect(picker.locator('.workspace-list-item')).toHaveCount(1);
  await search.press('Enter');
  await expect(picker).toBeHidden();
  expect((await snapshot(page)).activeWorkspaceId).toBe('picker-7');
  await open(page);
  await search.fill('Fixture 00');
  await expect(picker.locator('.workspace-list-item')).toHaveCount(10);
  await search.press('ArrowDown');
  await expect(picker.locator('.workspace-select').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(picker.locator('.workspace-select').nth(1)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(picker.locator('.workspace-select').first()).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(search).toBeFocused();
  await search.press('ArrowDown');
  await page.keyboard.press('End');
  await expect(picker.locator('.workspace-select').last()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(picker).toBeHidden();
  expect((await snapshot(page)).activeWorkspaceId).toBe('picker-9');
  await update(page, { blockChanges: true });
  await open(page);
  await search.fill('Fixture 004');
  await expect(picker.locator('.workspace-list-item')).toHaveCount(1);
  await search.press('Enter');
  await expect(picker).toBeVisible();
  await expect(search).toHaveValue('Fixture 004');
  expect((await snapshot(page)).activeWorkspaceId).toBe('picker-9');
  await expect(page.getByLabel('Retained editor draft')).toHaveValue('Keep this unsaved editor buffer');
});

test('creation validates the name, shows progress, retains failures and waits for the parent guard', async ({ page }) => {
  await open(page);
  await dialog(page).getByRole('button', { name: 'Create workspace', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Create workspace', exact: true });
  const name = create.getByLabel('Workspace name', { exact: true });
  const submit = create.getByRole('button', { name: 'Create workspace', exact: true });
  await expect(submit).toBeDisabled();
  await name.fill('   '); await expect(submit).toBeDisabled();
  await name.fill('  A new project  ');
  await create.getByRole('checkbox', { name: /Initialize a Git repository/ }).uncheck();
  await update(page, { blockChanges: true });
  await submit.click();
  await expect(create).toBeVisible();
  expect(http.requests.filter(request => request.method === 'POST')).toEqual([]);
  await expect(name).toHaveValue('  A new project  ');
  await update(page, { blockChanges: false });
  http.holdCreate = true;
  await submit.click();
  await expect.poll(() => !!http.heldCreate).toBe(true);
  await expect(create.getByRole('button', { name: 'Creating workspace…', exact: true })).toBeDisabled();
  await expect(name).toBeDisabled();
  await page.keyboard.press('Escape');
  await create.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(create).toBeVisible();
  expect(http.requests.find(request => request.method === 'POST')?.body).toEqual({ name: 'A new project', initializeGit: false });
  reply(http.heldCreate!, 409, { error: 'A workspace with this name is already being created.' });
  http.heldCreate = undefined; http.holdCreate = false;
  await expect(create.getByRole('alert')).toContainText('already being created');
  await expect(name).toBeEnabled();
  await expect(name).toHaveValue('  A new project  ');
  await submit.click();
  await expect(create).toBeHidden();
  expect((await snapshot(page)).activeWorkspaceId).toBe('fixture-created');
});

test('visible deletion uses verified ordinary and repository plans, with keyboard cancel and parent guards', async ({ page }) => {
  await open(page);
  const picker = dialog(page), search = picker.getByLabel('Find a workspace', { exact: true });
  await search.fill('Fixture 002');
  const row = picker.locator('.workspace-list-item');
  const remove = row.getByRole('button', { name: 'Delete Fixture 002', exact: true });
  await expect(remove).toBeEnabled();
  await remove.focus(); await page.keyboard.press('Enter');
  const confirmation = row.getByRole('group', { name: 'Confirm deletion of Fixture 002', exact: true });
  await expect(confirmation).toContainText('restored for 30 days');
  await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  expect(http.requests.filter(request => request.method === 'DELETE')).toEqual([]);
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(remove).toBeFocused();
  await remove.click();
  await update(page, { blockChanges: true });
  await confirmation.getByRole('button', { name: 'Move to trash', exact: true }).click();
  await expect(confirmation).toBeVisible();
  expect(http.requests.filter(request => request.method === 'DELETE')).toEqual([]);
  await update(page, { blockChanges: false });
  await confirmation.getByRole('button', { name: 'Move to trash', exact: true }).click();
  await expect(row).toHaveCount(0);
  expect(http.requests.find(request => request.method === 'DELETE')?.body).toEqual({ expectedMode: 'trash' });
  await search.fill('Fixture 001');
  await row.getByRole('button', { name: 'Delete Fixture 001', exact: true }).click();
  await expect(row.locator('.workspace-trash-confirm')).toContainText('The repository on GitHub will remain.');
  await expect(row.getByRole('button', { name: 'Move to trash', exact: true })).toHaveCount(0);
  await row.getByRole('button', { name: 'Delete workspace permanently', exact: true }).click();
  await expect(row).toHaveCount(0);
  expect(http.requests.filter(request => request.method === 'DELETE').map(request => request.body)).toEqual([{ expectedMode: 'trash' }, { expectedMode: 'permanent' }]);
});

test('failed deletion checks cannot delete, and managed checkouts retain their worktree removal flow', async ({ page }) => {
  await open(page);
  const picker = dialog(page), search = picker.getByLabel('Find a workspace', { exact: true });
  await search.fill('Fixture 005');
  http.failPlan = 'The workspace classification is temporarily unavailable.';
  await picker.getByRole('button', { name: 'Delete Fixture 005', exact: true }).click();
  await expect(picker.getByRole('alert')).toContainText('classification is temporarily unavailable');
  await expect(picker.getByRole('button', { name: 'Move to trash', exact: true })).toHaveCount(0);
  await expect(picker.getByRole('button', { name: 'Delete workspace permanently', exact: true })).toHaveCount(0);
  expect(http.requests.filter(request => request.method === 'DELETE')).toEqual([]);
  await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
  await search.fill('Fixture 003');
  await picker.getByRole('button', { name: 'Manage removal of Fixture 003', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Worktrees for Fixture 003', exact: true })).toBeVisible();
  expect(http.requests.filter(request => request.path === '/api/workspaces/picker-3/deletion')).toEqual([]);
  expect(http.requests.filter(request => request.method === 'DELETE')).toEqual([]);
});


test('an empty account keeps creation and import above search with a clear first-workspace state', async ({ page }) => {
  http.workspaces = [];
  await page.reload();
  await open(page);
  const picker = dialog(page);
  await expect(picker.getByRole('button', { name: 'Create workspace', exact: true })).toBeVisible();
  await expect(picker.getByRole('button', { name: 'Import from GitHub', exact: true })).toBeVisible();
  await expect(picker.getByLabel('Find a workspace', { exact: true })).toBeFocused();
  await expect(picker.getByRole('list', { name: 'Workspaces', exact: true })).toContainText('Start your first workspace');
  await expect(picker.getByLabel('Workspace name', { exact: true })).toHaveCount(0);
  await picker.getByRole('button', { name: 'Create workspace', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Create workspace', exact: true });
  await expect(create.getByLabel('Workspace name', { exact: true })).toBeFocused();
  await create.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(picker).toBeVisible();
  expect(http.requests.filter(request => request.method !== 'GET')).toEqual([]);
});
