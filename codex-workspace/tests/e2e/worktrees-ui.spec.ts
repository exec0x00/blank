import { expect, test, type Page, type Route } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { CreatedWorktree, FileContent, ManagedWorktree, Thread, ThreadListPage, UiState, Workspace } from '../../shared/types';

// A controlled HTTP peer exercises the production switcher, manager, shared
// modal/dropdowns and API client. These test records never ship in the app.
const at = '2026-09-19T12:00:00.000Z';
const main: Workspace = { id: 'fixture-primary', name: 'Project', path: '/workspace/project', createdAt: at, updatedAt: at, githubAccountId: 'fixture-account' };
const other: Workspace = { id: 'fixture-other', name: 'Other project', path: '/workspace/other', createdAt: at, updatedAt: at };
function checkout(overrides: Partial<ManagedWorktree> = {}): ManagedWorktree {
  return { id: 'fixture-worktree', workspaceId: 'fixture-worktree-workspace', name: 'Feature checkout', path: '/workspace/feature', sourceWorkspaceId: main.id, repositoryWorkspaceId: main.id, createdAt: at, updatedAt: at, state: 'ready', branch: 'feature/ui', head: 'a'.repeat(40), dirty: false, locked: false, ...overrides };
}
function registration(record: ManagedWorktree): Workspace {
  return { id: record.workspaceId, name: record.name, path: record.path, createdAt: record.createdAt, updatedAt: record.updatedAt, githubAccountId: 'fixture-account', worktree: { id: record.id, sourceWorkspaceId: record.sourceWorkspaceId, repositoryWorkspaceId: record.repositoryWorkspaceId, gitDirectory: `/workspace/project/.git/worktrees/${record.id}`, commonDirectory: '/workspace/project/.git' } };
}
interface FixtureProps { open: boolean; workspaces: Workspace[]; activeWorkspaceId: string | null; blockSwitch: boolean; locked: boolean }
interface FixtureEvent { kind: string; id?: string; registered?: boolean }
interface FixtureState extends FixtureProps { events: FixtureEvent[]; closes: number; beforeSwitch: number }
type FixtureWindow = Window & { __worktreeFixture: { update: (patch: Partial<FixtureProps>) => void; state: () => FixtureState } };
interface RecordedRequest { method: string; path: string; query?: Record<string, string>; body?: Record<string, unknown>; marker?: string }
interface HeldResponse { response: ServerResponse; status: number; body: unknown }
interface HttpState {
  records: ManagedWorktree[];
  registrations: Workspace[];
  requests: RecordedRequest[];
  failNext?: { method: string; path: string; error: string; code?: string; status?: number };
  failReads?: { path: string; error: string; code?: string; status?: number };
  holdNext?: { method: string; path: string };
  holdReads?: string;
  held: HeldResponse[];
  creates: number;
}
let http: HttpState;
let server: Server;
let origin = '';
let script = '', styles = '';
const rootCollection = `/api/workspaces/${main.id}/worktrees`;
const rootPage = `${rootCollection}/page`;
const targetPath = `${rootCollection}/fixture-worktree`;

function reset() {
  for (const held of http?.held || []) held.response.destroy();
  const worktree = checkout();
  http = { records: [worktree], registrations: [main, other, registration(worktree)], requests: [], held: [], creates: 0 };
}
function reply(response: ServerResponse, status: number, body: unknown) {
  if (response.destroyed) return;
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body));
}
function release() {
  http.holdReads = undefined;
  for (const held of http.held.splice(0)) reply(held.response, held.status, held.body);
}
function mutations() { return http.requests.filter(request => request.method !== 'GET'); }

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
      import './client/styles.css';
      import './client/scrollbars.css';
      installScrollActivity();
      const root = createRoot(document.getElementById('root'));
      const events = [];
      let current = { open: false, workspaces: [], activeWorkspaceId: null, blockSwitch: false, locked: false };
      let closes = 0, beforeSwitch = 0;
      const update = patch => { current = { ...current, ...patch }; render(); };
      window.addEventListener('codex:before-workspace-change', event => { beforeSwitch++; event.detail.cancel = current.blockSwitch; });
      window.addEventListener('codex:session-expired', () => update({ locked: true }));
      async function onSelect(workspace) {
        events.push({ kind: 'select', id: workspace.id, registered: current.workspaces.some(item => item.id === workspace.id) });
        const before = new CustomEvent('codex:before-workspace-change', { detail: { cancel: false } });
        window.dispatchEvent(before);
        if (before.detail.cancel || current.locked) return false;
        await api('/workspaces/' + encodeURIComponent(workspace.id), json('PATCH', { active: true }));
        if (current.locked) return false;
        update({ activeWorkspaceId: workspace.id });
        return true;
      }
      function onReady(workspace) {
        events.push({ kind: 'ready', id: workspace.id });
        update({ workspaces: [...current.workspaces.filter(item => item.id !== workspace.id), workspace] });
      }
      function onArchived(id) {
        events.push({ kind: 'archived', id });
        update({ workspaces: current.workspaces.filter(item => item.id !== id) });
      }
      function render() {
        const wasLocked = document.body.dataset.workspaceLocked === 'true';
        document.body.dataset.workspaceLocked = String(current.locked);
        if (wasLocked !== current.locked) window.dispatchEvent(new CustomEvent(current.locked ? 'codex:session-locked' : 'codex:session-unlocked'));
        root.render(<React.StrictMode><main className="worktree-fixture">
          <button className="topbar-workspace" onClick={() => update({ open: true })} disabled={current.locked} title="Switch workspace">{current.workspaces.find(item => item.id === current.activeWorkspaceId)?.name || 'Workspaces'}</button>
          {current.locked && <p>Workspace is locked</p>}
          <WorkspaceSwitcher open={current.open} onClose={() => { closes++; update({ open: false }); }}
            workspaces={current.workspaces} activeWorkspaceId={current.activeWorkspaceId} currentWorkspace={current.workspaces.find(item => item.id === current.activeWorkspaceId) || null}
            onSelect={onSelect} onWorktreeWorkspaceReady={onReady} onWorktreeWorkspaceArchived={onArchived}
            onCreate={async () => false} onRename={async () => {}} onDelete={async () => false} onWorkspaceRestored={onReady} onImport={() => events.push({ kind: 'import' })} />
        </main></React.StrictMode>);
      }
      window.__worktreeFixture = { update, state: () => ({ ...current, events, closes, beforeSwitch }) };
      render();
    `, loader: 'tsx', resolveDir: root },
    bundle: true, write: false, outfile: 'worktrees-ui-fixture.js', platform: 'browser', format: 'iife', target: 'es2022', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent',
  });
  script = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  styles = bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text + '\n.worktree-fixture { padding: 24px; }';
  reset();
  server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://fixture.invalid');
    const path = url.pathname;
    if (path === '/') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); return; }
    if (path === '/fixture.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(script); return; }
    if (path === '/fixture.css') { response.writeHead(200, { 'Content-Type': 'text/css' }); response.end(styles); return; }
    if (path === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    let body: Record<string, unknown> | undefined;
    if (request.method !== 'GET') {
      let bytes = ''; for await (const chunk of request) bytes += String(chunk);
      try { body = bytes ? JSON.parse(bytes) as Record<string, unknown> : undefined; }
      catch { reply(response, 400, { error: 'Invalid fixture JSON.' }); return; }
    }
    const method = request.method || 'GET';
    http.requests.push({ method, path, body, marker: request.headers['x-codex-workspace'] as string | undefined, ...(method === 'GET' ? { query: Object.fromEntries(url.searchParams) } : {}) });
    const respond = (status: number, value: unknown) => {
      if (method === 'GET' && http.holdReads === path) http.held.push({ response, status, body: structuredClone(value) });
      else if (http.holdNext?.method === method && http.holdNext.path === path) { http.holdNext = undefined; http.held.push({ response, status, body: structuredClone(value) }); }
      else reply(response, status, value);
    };
    if (method === 'GET' && http.failReads?.path === path) { respond(http.failReads.status || 503, { error: http.failReads.error, code: http.failReads.code }); return; }
    if (http.failNext?.method === method && http.failNext.path === path) {
      const failure = http.failNext; http.failNext = undefined;
      respond(failure.status || 409, { error: failure.error, code: failure.code }); return;
    }
    if (method === 'GET' && path === '/api/workspaces') {
      const query = (url.searchParams.get('query') || '').trim().toLowerCase();
      const limit = Number(url.searchParams.get('limit') || 40), offset = Number(url.searchParams.get('cursor') || 0);
      const available = http.registrations.filter(workspace => !workspace.worktree || http.records.some(record => record.workspaceId === workspace.id && record.state !== 'archived' && !record.removalPending));
      const matches = available.filter(workspace => `${workspace.name} ${workspace.path}`.toLowerCase().includes(query));
      respond(200, { workspaces: matches.slice(offset, offset + limit), offset, total: matches.length, nextCursor: offset + limit < matches.length ? String(offset + limit) : null, previousCursor: offset ? String(Math.max(0, offset - limit)) : null }); return;
    }
    const match = /^\/api\/workspaces\/([^/]+)\/worktrees(?:\/([^/]+)(?:\/(open|archive))?)?$/.exec(path);
    if (match) {
      const sourceId = decodeURIComponent(match[1]), id = match[2] && decodeURIComponent(match[2]), action = match[3];
      const source = http.registrations.find(item => item.id === sourceId);
      if (!source) { respond(404, { error: 'Fixture source workspace was not found.' }); return; }
      if (source.worktree && !http.records.some(record => record.id === source.worktree!.id)) { respond(404, { error: 'This source checkout has been removed.' }); return; }
      const repositoryId = source.worktree?.repositoryWorkspaceId || source.id;
      if (id === 'page' && method === 'GET') {
        const limit = Number(url.searchParams.get('limit') || 25), requestedOffset = Number(url.searchParams.get('offset') || 0);
        const query = (url.searchParams.get('q') || '').trim().toLowerCase();
        const matches = http.records.filter(item => item.repositoryWorkspaceId === repositoryId && `${item.name} ${item.branch || ''} ${item.path}`.toLowerCase().includes(query));
        const offset = Math.min(requestedOffset, matches.length ? Math.floor((matches.length - 1) / limit) * limit : 0);
        const repository = http.registrations.find(item => item.id === repositoryId)!;
        const family = http.registrations.filter(item => item.id === repositoryId || item.worktree?.repositoryWorkspaceId === repositoryId && http.records.some(record => record.workspaceId === item.id && record.state === 'ready' && !record.removalPending));
        const sourceIds = [...new Set([repositoryId, url.searchParams.get('sourceWorkspaceId') || sourceId, ...family.map(item => item.id)])];
        const sources = sourceIds.map(id => family.find(item => item.id === id)).filter((item): item is Workspace => !!item).slice(0, 3);
        respond(200, { items: matches.slice(offset, offset + limit), offset, limit, total: matches.length, hasMore: offset + limit < matches.length, repository, sources }); return;
      }
      if (!id && method === 'GET') { respond(200, http.records.filter(item => item.repositoryWorkspaceId === repositoryId)); return; }
      if (!id && method === 'POST') {
        const input = body || {};
        const suffix = ++http.creates;
        const worktree = checkout({ id: `fixture-created-${suffix}`, workspaceId: `fixture-created-workspace-${suffix}`, name: String(input.name || input.branch || `Detached ${suffix}`), path: `/workspace/created-${suffix}`, sourceWorkspaceId: source.id, repositoryWorkspaceId: repositoryId, branch: typeof input.branch === 'string' ? input.branch : undefined });
        const workspace = registration(worktree);
        http.records.push(worktree); http.registrations.push(workspace);
        const result: CreatedWorktree = { workspace, worktree };
        respond(201, result); return;
      }
      const item = http.records.find(record => record.id === id && record.repositoryWorkspaceId === repositoryId);
      if (!item) { respond(404, { error: 'The worktree no longer exists.', code: 'WORKTREE_NOT_FOUND' }); return; }
      if (item.removalPending && method === 'POST' && (action === 'open' || action === 'archive')) {
        respond(409, { error: 'The checkout was already removed. Finish its saved cleanup before continuing.', code: 'WORKTREE_REMOVAL_PENDING' }); return;
      }
      if (method === 'POST' && action === 'archive') { item.state = 'archived'; item.updatedAt = '2026-09-19T12:01:00.000Z'; respond(200, item); return; }
      if (method === 'POST' && action === 'open') {
        item.state = 'ready'; item.updatedAt = '2026-09-19T12:02:00.000Z';
        const saved = http.registrations.find(workspace => workspace.id === item.workspaceId)!;
        respond(200, saved); return;
      }
      if (method === 'DELETE' && !action) { http.records = http.records.filter(record => record.id !== item.id); respond(200, { removed: true, workspaceId: item.workspaceId }); return; }
    }
    if (method === 'PATCH' && /^\/api\/workspaces\/[^/]+$/.test(path)) {
      const item = http.registrations.find(workspace => path === `/api/workspaces/${workspace.id}`);
      if (item) { respond(200, item); return; }
    }
    respond(500, { error: `Unexpected worktree fixture route: ${method} ${path}` });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => { release(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
test.beforeEach(() => reset());

async function update(page: Page, patch: Partial<FixtureProps>) { await page.evaluate(value => (window as unknown as FixtureWindow).__worktreeFixture.update(value), patch); }
async function state(page: Page) { return page.evaluate(() => (window as unknown as FixtureWindow).__worktreeFixture.state()); }
async function mount(page: Page, patch: Partial<FixtureProps> = {}) {
  await page.goto(origin);
  await update(page, { workspaces: [main, ...(http.records[0] ? [registration(http.records[0])] : [])], activeWorkspaceId: main.id, ...patch });
  await page.locator('button:is([title="Switch workspace"], [data-tooltip-title="Switch workspace"])').click();
}
async function manage(page: Page, name = main.name) {
  await page.getByRole('button', { name: `Manage worktrees for ${name}`, exact: true }).click();
  await expect(page.getByRole('region', { name: `Worktrees for ${name}`, exact: true })).toBeVisible();
}
async function menu(page: Page, name = 'Feature checkout') { await page.getByRole('button', { name: `Actions for worktree ${name}`, exact: true }).click(); }
async function confirmRemoval(page: Page) {
  await menu(page);
  await page.getByRole('menuitem', { name: /^Remove worktree/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Remove Feature checkout?', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('creates through the real API client, registers before the dirty guard, and switches only after the guard accepts', async ({ page }, testInfo) => {
  http.records = [];
  await mount(page, { blockSwitch: true }); await manage(page);
  await expect(page.getByText('No worktrees yet.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'New worktree', exact: true }).click();
  await page.getByLabel('New branch name', { exact: true }).fill('feature/new-ui');
  await page.getByLabel('Workspace name optional', { exact: true }).fill('New UI');
  await page.getByLabel('Start from optional', { exact: true }).fill('main');
  await page.getByRole('button', { name: 'Create worktree', exact: true }).click();
  await expect(page.getByText('Your current workspace is still open.', { exact: false })).toBeVisible();
  const current = await state(page);
  expect(current.activeWorkspaceId).toBe(main.id);
  expect(current.closes).toBe(0);
  expect(current.beforeSwitch).toBe(1);
  expect(current.events).toEqual([{ kind: 'ready', id: 'fixture-created-workspace-1' }, { kind: 'select', id: 'fixture-created-workspace-1', registered: true }]);
  expect(current.workspaces.find(item => item.id === 'fixture-created-workspace-1')?.githubAccountId).toBe('fixture-account');
  expect(mutations()).toEqual([{ method: 'POST', path: rootCollection, marker: '1', body: { name: 'New UI', branch: 'feature/new-ui', createBranch: true, base: 'main' } }]);
  await page.screenshot({ path: testInfo.outputPath('worktrees-desktop.png'), animations: 'disabled' });
  await update(page, { blockSwitch: false });
  await page.getByRole('button', { name: 'Open New UI', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await state(page)).activeWorkspaceId).toBe('fixture-created-workspace-1');
  expect(mutations().slice(-2)).toEqual([
    { method: 'POST', path: `${rootCollection}/fixture-created-1/open`, marker: '1', body: {} },
    { method: 'PATCH', path: '/api/workspaces/fixture-created-workspace-1', marker: '1', body: { active: true } },
  ]);
  expect(http.requests.some(request => request.path.includes('/ui-state') || request.path.includes('/threads'))).toBe(false);
});

test('keeps a rejected create draft, uses only relevant branch fields, and prevents duplicate submissions while loading', async ({ page }) => {
  await mount(page, { blockSwitch: true }); await manage(page);
  await page.getByRole('button', { name: 'New worktree', exact: true }).click();
  await page.getByLabel('New branch name', { exact: true }).fill('feature/already-used');
  await page.getByLabel('Start from optional', { exact: true }).fill('main');
  await page.getByLabel('Workspace name optional', { exact: true }).fill('Keep my draft');
  http.failNext = { method: 'POST', path: rootCollection, error: 'That branch is already checked out in another workspace.', code: 'BRANCH_IN_USE' };
  await page.getByRole('button', { name: 'Create worktree', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('already checked out');
  await expect(page.getByLabel('Workspace name optional', { exact: true })).toHaveValue('Keep my draft');
  expect((await state(page)).events).toEqual([]);
  const type = page.getByRole('combobox', { name: 'Checkout type', exact: true });
  await type.focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(type).toContainText('Existing branch');
  await expect(page.getByLabel('Start from optional', { exact: true })).toHaveCount(0);
  await page.getByLabel('Existing branch name', { exact: true }).fill('release');
  http.holdNext = { method: 'POST', path: rootCollection };
  await page.getByRole('button', { name: 'Create worktree', exact: true }).click();
  await expect.poll(() => http.held.length).toBe(1);
  await expect(page.getByRole('button', { name: 'All workspaces', exact: true })).toBeDisabled();
  await page.locator('.worktree-create').evaluate(element => { const form = element as HTMLFormElement; form.requestSubmit(); form.requestSubmit(); });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Your workspaces', exact: true })).toBeVisible();
  expect(mutations()).toHaveLength(2);
  expect(mutations()[1].body).toEqual({ name: 'Keep my draft', branch: 'release' });
  release();
  await expect(page.getByRole('button', { name: 'New worktree', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'New worktree', exact: true }).click();
  await type.click(); await page.getByRole('option', { name: /^Detached checkout/ }).click();
  await page.getByLabel('Start from optional', { exact: true }).fill('v2.0.0');
  await page.getByLabel('Workspace name optional', { exact: true }).fill('Inspect release');
  await page.getByRole('button', { name: 'Create worktree', exact: true }).click();
  await expect(page.locator('.worktree-list')).toContainText('Detached · aaaaaaaa');
  expect(mutations().at(-1)?.body).toEqual({ name: 'Inspect release', base: 'v2.0.0' });
  await expect(page.locator('select')).toHaveCount(0);
});

test('a failed active-workspace save retains the created checkout and retries opening it without creating another', async ({ page }) => {
  await mount(page); await manage(page);
  await page.getByRole('button', { name: 'New worktree', exact: true }).click();
  await page.getByLabel('New branch name', { exact: true }).fill('feature/saved-checkout');
  http.failNext = { method: 'PATCH', path: '/api/workspaces/fixture-created-workspace-1', error: 'The workspace selection could not be saved.', status: 503 };
  await page.getByRole('button', { name: 'Create worktree', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('was created. Switching failed: The workspace selection could not be saved.');
  expect((await state(page)).activeWorkspaceId).toBe(main.id);
  expect((await state(page)).workspaces.some(workspace => workspace.id === 'fixture-created-workspace-1')).toBe(true);
  await expect(page.locator('.worktree-create')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open feature/saved-checkout', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await state(page)).activeWorkspaceId).toBe('fixture-created-workspace-1');
  expect(http.creates).toBe(1);
  expect(mutations().filter(request => request.path === rootCollection)).toHaveLength(1);
});

test('archives and reopens the same workspace without changing its account or creating a conversation', async ({ page }) => {
  await mount(page); await manage(page); await menu(page);
  await page.getByRole('menuitem', { name: /^Archive worktree/ }).click();
  await expect(page.getByRole('button', { name: 'Reopen Feature checkout', exact: true })).toBeEnabled();
  expect((await state(page)).workspaces.map(item => item.id)).toEqual([main.id]);
  expect((await state(page)).activeWorkspaceId).toBe(main.id);
  expect(mutations()[0]).toEqual({ method: 'POST', path: `${targetPath}/archive`, marker: '1', body: {} });
  await page.getByRole('button', { name: 'All workspaces', exact: true }).click();
  await expect(page.locator('.workspace-list')).not.toContainText('Feature checkout');
  await manage(page);
  await page.getByRole('button', { name: 'Reopen Feature checkout', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const reopened = (await state(page)).workspaces.find(item => item.id === 'fixture-worktree-workspace');
  expect(reopened).toEqual(registration(checkout()));
  expect((await state(page)).activeWorkspaceId).toBe(reopened!.id);
  expect((await state(page)).events).toEqual([
    { kind: 'archived', id: reopened!.id }, { kind: 'ready', id: reopened!.id }, { kind: 'select', id: reopened!.id, registered: true },
  ]);
  expect(http.requests.some(request => request.path.includes('/threads') || request.path.includes('/ui-state'))).toBe(false);
});

test('requires an explicit removal confirmation and surfaces busy or newly dirty server refusals without removing the workspace', async ({ page }) => {
  await mount(page); await manage(page);
  let dialog = await confirmRemoval(page);
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  expect(mutations()).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Your workspaces', exact: true })).toBeVisible();
  expect(mutations()).toEqual([]);
  dialog = await confirmRemoval(page);
  http.failNext = { method: 'DELETE', path: targetPath, error: 'An active terminal is using this repository. Close it before removing a worktree.', code: 'WORKTREE_BUSY' };
  await dialog.getByRole('button', { name: 'Remove worktree', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('active terminal');
  expect((await state(page)).events).toEqual([]);
  expect((await state(page)).workspaces).toHaveLength(2);
  await expect(dialog.getByRole('button', { name: 'Remove worktree', exact: true })).toBeEnabled();
  http.failNext = { method: 'DELETE', path: targetPath, error: 'This checkout has local or ignored files. Its files were preserved.', code: 'WORKTREE_DIRTY' };
  http.records[0].dirty = true;
  await dialog.getByRole('button', { name: 'Remove worktree', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('local or ignored files');
  await expect(page.locator('.worktree-list')).toContainText('Local files');
  expect((await state(page)).events).toEqual([]);
  expect(mutations()).toEqual([
    { method: 'DELETE', path: targetPath, marker: '1' }, { method: 'DELETE', path: targetPath, marker: '1' },
  ]);
  await menu(page);
  await expect(page.getByRole('menuitem', { name: /^Remove worktree/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  http.records[0].dirty = false;
  await page.getByRole('button', { name: 'Refresh worktrees', exact: true }).click();
  await page.getByRole('button', { name: 'All workspaces', exact: true }).click();
  await page.getByRole('button', { name: 'Actions for Feature checkout', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Worktrees/ }).click();
  dialog = await confirmRemoval(page);
  await dialog.getByRole('button', { name: 'Remove worktree', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.worktree-list')).not.toContainText('Feature checkout');
  expect((await state(page)).events).toEqual([{ kind: 'archived', id: 'fixture-worktree-workspace' }]);
  expect((await state(page)).workspaces.map(item => item.id)).toEqual([main.id]);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(http.requests.at(-1)?.path).toBe(rootPage);
  await expect(page.getByRole('button', { name: 'All workspaces', exact: true })).toBeFocused();
});

test('a removed worktree returns focus through its parent dialog without replacing a control chosen during refresh', async ({ page }) => {
  await mount(page); await manage(page);
  const confirmation = await confirmRemoval(page);
  http.holdReads = rootPage;
  try {
    await confirmation.getByRole('button', { name: 'Remove worktree', exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await expect.poll(() => http.held.length).toBeGreaterThan(0);
    const parent = page.getByRole('dialog', { name: 'Your workspaces', exact: true });
    await expect(parent).toBeFocused();
    const search = parent.getByRole('searchbox', { name: 'Search worktrees', exact: true });
    const originalSearch = (await search.elementHandle())!;
    await search.focus();
    release();
    await expect(parent.getByRole('region', { name: 'Worktrees for Project', exact: true })).toHaveAttribute('aria-busy', 'false');
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(search).toBeFocused();
    expect(await originalSearch.evaluate(element => element.isConnected && document.activeElement === element)).toBe(true);
    await expect(parent.getByRole('button', { name: 'All workspaces', exact: true })).not.toBeFocused();
    expect(mutations()).toEqual([{ method: 'DELETE', path: targetPath, marker: '1' }]);
  } finally { release(); }
});

test('protects the current checkout and Git-locked files, and makes recovery problems readable', async ({ page }) => {
  const locked = checkout({ id: 'fixture-locked', workspaceId: 'fixture-locked-workspace', name: 'Locked checkout', locked: true });
  const recovery = checkout({ id: 'fixture-recovery', workspaceId: 'fixture-recovery-workspace', name: 'Recovered checkout', state: 'recovery', dirty: undefined, locked: undefined, branch: undefined, head: undefined, issue: 'The checkout needs its workspace registration restored. Existing files were preserved.' });
  http.records.push(locked, recovery); http.registrations.push(registration(locked), registration(recovery));
  await mount(page, { activeWorkspaceId: 'fixture-worktree-workspace' }); await manage(page, 'Feature checkout');
  await expect(page.locator('.worktree-primary')).toContainText('Main checkout');
  await menu(page);
  await expect(page.getByRole('menuitem', { name: /^Archive worktree/ })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: /^Remove worktree/ })).toBeDisabled();
  await expect(page.getByText('Switch to another workspace first.', { exact: true }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await menu(page, locked.name);
  await expect(page.getByRole('menuitem', { name: /^Remove worktree/ })).toBeDisabled();
  await expect(page.getByText('This checkout is locked in Git.', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  const row = page.locator('[data-worktree-id="fixture-recovery"]');
  await expect(row).toContainText('Branch unavailable');
  await expect(row).toContainText(recovery.issue!);
  await expect(row).not.toContainText('Clean');
  http.failNext = { method: 'POST', path: `${rootCollection}/fixture-recovery/open`, error: 'Git links could not be validated. Existing files were preserved.', code: 'UNSAFE_WORKTREE' };
  await page.getByRole('button', { name: 'Recover Recovered checkout', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('could not be validated');
  expect((await state(page)).events).toEqual([]);
  expect(mutations()).toHaveLength(1);
  http.records[0] = { ...http.records[0], state: 'recovery', issue: 'Open this checkout to restore its registration.' };
  await update(page, { blockSwitch: true });
  await page.getByRole('button', { name: 'Refresh worktrees', exact: true }).click();
  await page.getByRole('button', { name: 'Recover Feature checkout', exact: true }).click();
  await expect(page.locator('[data-worktree-id="fixture-worktree"] .worktree-state')).toHaveText('Ready');
  expect(mutations().at(-1)).toEqual({ method: 'POST', path: `${targetPath}/open`, marker: '1', body: {} });
  expect((await state(page)).activeWorkspaceId).toBe('fixture-worktree-workspace');
  expect((await state(page)).workspaces.filter(workspace => workspace.id === 'fixture-worktree-workspace')).toHaveLength(1);
});

test('invalidates reviewed removal details when a newer list reports a changed commit', async ({ page }) => {
  await mount(page); await manage(page);
  const dialog = await confirmRemoval(page);
  http.records[0] = { ...http.records[0], head: 'b'.repeat(40), updatedAt: '2026-09-19T14:00:00.000Z' };
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('This checkout changed. Review its current state before removing it.', { exact: true })).toBeVisible();
  expect(mutations()).toEqual([]);
});

test('failed cleanup after native removal offers an explicitly confirmed Finish removal and never reopens the removed checkout', async ({ page }) => {
  await mount(page); await manage(page);
  const initial = await confirmRemoval(page);
  http.records[0] = { ...http.records[0], state: 'recovery', removalPending: true, branch: undefined, head: undefined,
    dirty: undefined, locked: undefined, updatedAt: '2026-09-19T12:03:00.000Z', issue: 'Native removal finished. Retained snapshots and backups still need cleanup.' };
  http.failNext = { method: 'DELETE', path: targetPath, error: 'The checkout was removed, but saved cleanup did not finish.', code: 'WORKTREE_ARTIFACT_CLEANUP_FAILED' };
  await initial.getByRole('button', { name: 'Remove worktree', exact: true }).click();
  await expect(initial).toHaveCount(0);
  const row = page.locator('[data-worktree-id="fixture-worktree"]');
  await expect(row.locator('.worktree-state')).toHaveText('Removal pending');
  await expect(row).toContainText('The original checkout has been removed.');
  await expect(row).not.toContainText('Clean');
  await expect(row.getByRole('button', { name: /^(Open|Reopen|Recover) / })).toHaveCount(0);
  const finish = row.getByRole('button', { name: 'Finish removal of Feature checkout', exact: true });
  await expect(finish).toBeEnabled();
  expect(mutations()).toHaveLength(1); expect((await state(page)).events).toEqual([]);
  await menu(page);
  await expect(page.getByRole('menuitem', { name: /^Archive worktree/ })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: /^Finish removal/ })).toBeEnabled();
  await page.keyboard.press('Escape');
  await finish.click();
  let confirmation = page.getByRole('dialog', { name: 'Finish removing Feature checkout?', exact: true });
  await expect(confirmation).toContainText('checkout was already removed');
  await expect(confirmation).toContainText('Any remaining snapshots and backups');
  await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  expect(mutations()).toHaveLength(1);
  await page.keyboard.press('Escape'); await expect(confirmation).toHaveCount(0);
  expect(mutations()).toHaveLength(1);
  await finish.click();
  http.records[0] = { ...http.records[0], updatedAt: '2026-09-19T12:04:00.000Z', issue: 'The remaining cleanup is temporarily unavailable. Saved backups were retained.' };
  http.failNext = { method: 'DELETE', path: targetPath, error: 'Saved-artifact cleanup is temporarily unavailable.', code: 'WORKSPACE_ARTIFACT_CLEANUP_UNAVAILABLE', status: 503 };
  await confirmation.getByRole('button', { name: 'Finish removal', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  await expect(finish).toBeEnabled();
  expect(mutations()).toHaveLength(2); expect((await state(page)).events).toEqual([]);
  await page.getByRole('button', { name: 'Refresh worktrees', exact: true }).click();
  await expect(finish).toBeEnabled();
  expect(mutations()).toHaveLength(2);
  await finish.click();
  confirmation = page.getByRole('dialog', { name: 'Finish removing Feature checkout?', exact: true });
  http.holdNext = { method: 'DELETE', path: targetPath };
  try {
    const submit = confirmation.getByRole('button', { name: 'Finish removal', exact: true });
    await submit.click();
    await expect.poll(() => http.held.length).toBe(1);
    await expect(confirmation).toContainText('Finishing removal…');
    await expect(submit).toBeDisabled();
    await submit.evaluate(element => { const button = element as HTMLButtonElement; button.click(); button.click(); });
    await page.keyboard.press('Escape'); await expect(confirmation).toBeVisible();
    expect(mutations()).toHaveLength(3);
    release();
    await expect(confirmation).toHaveCount(0); await expect(row).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Feature checkout removal is complete.' })).toBeVisible();
    expect((await state(page)).events).toEqual([{ kind: 'archived', id: 'fixture-worktree-workspace' }]);
    expect((await state(page)).workspaces.map(workspace => workspace.id)).toEqual([main.id]);
    expect(mutations()).toEqual(Array.from({ length: 3 }, () => ({ method: 'DELETE', path: targetPath, marker: '1' })));
  } finally { release(); }
});

test('changing the removal receipt invalidates Finish removal confirmation and preserves ordinary recovery and Archive', async ({ page }) => {
  http.records[0] = checkout({ state: 'recovery', removalPending: true, dirty: undefined, locked: undefined, issue: 'Saved worktree state needs attention.' });
  await mount(page, { blockSwitch: true }); await manage(page);
  await page.getByRole('button', { name: 'Finish removal of Feature checkout', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Finish removing Feature checkout?', exact: true });
  await expect(confirmation).toBeVisible();
  // The receipt alone changes; the reviewed timestamp, state and issue remain
  // identical, so a stale destructive confirmation must still be invalidated.
  http.records[0] = { ...http.records[0], removalPending: undefined };
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByText('This checkout changed. Review its current state before removing it.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Finish removal of Feature checkout', exact: true })).toHaveCount(0);
  const recover = page.getByRole('button', { name: 'Recover Feature checkout', exact: true });
  await expect(recover).toBeEnabled();
  expect(mutations()).toEqual([]);
  await menu(page);
  await expect(page.getByRole('menuitem', { name: /^Remove worktree/ })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: /^Archive worktree/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await recover.click();
  await expect(page.locator('[data-worktree-id="fixture-worktree"] .worktree-state')).toHaveText('Ready');
  await menu(page);
  await expect(page.getByRole('menuitem', { name: /^Archive worktree/ })).toBeEnabled();
  await page.getByRole('menuitem', { name: /^Archive worktree/ }).click();
  await expect(page.getByRole('button', { name: 'Reopen Feature checkout', exact: true })).toBeEnabled();
  expect(mutations()).toEqual([
    { method: 'POST', path: `${targetPath}/open`, marker: '1', body: {} },
    { method: 'POST', path: `${targetPath}/archive`, marker: '1', body: {} },
  ]);
});

test('ignores late reads from a previous repository and shows retryable list failures without inventing an empty result', async ({ page }) => {
  const another = checkout({ id: 'fixture-other-worktree', workspaceId: 'fixture-other-checkout', name: 'Other branch', repositoryWorkspaceId: other.id, sourceWorkspaceId: other.id });
  http.records.push(another); http.registrations.push(registration(another));
  await mount(page, { workspaces: [main, other] });
  http.holdReads = rootPage;
  await manage(page);
  await expect.poll(() => http.held.length).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'New worktree', exact: true })).toBeDisabled();
  await expect(page.getByText('No worktrees yet.', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'All workspaces', exact: true }).click();
  await update(page, { activeWorkspaceId: other.id });
  http.failReads = { path: `/api/workspaces/${other.id}/worktrees/page`, error: 'The repository is temporarily unavailable.', status: 503 };
  await manage(page, other.name);
  release();
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  await expect(page.getByText('Feature checkout', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New worktree', exact: true })).toBeDisabled();
  http.failReads = undefined;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('.worktree-list')).toContainText('Other branch');
  await expect(page.locator('.worktree-list')).not.toContainText('Feature checkout');
  expect(mutations()).toEqual([]);
});

test('a delayed create cannot register, select, or reopen a dialog after locking; unlock discovers the saved checkout', async ({ page }) => {
  await mount(page); await manage(page);
  await page.getByRole('button', { name: 'New worktree', exact: true }).click();
  await page.getByLabel('New branch name', { exact: true }).fill('feature/late');
  http.holdNext = { method: 'POST', path: rootCollection };
  await page.getByRole('button', { name: 'Create worktree', exact: true }).click();
  await expect.poll(() => http.held.length).toBe(1);
  await update(page, { locked: true });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  release();
  expect((await state(page)).events).toEqual([]);
  expect((await state(page)).activeWorkspaceId).toBe(main.id);
  await update(page, { locked: false });
  await expect(page.locator('.worktree-list')).toContainText('feature/late');
  expect((await state(page)).events).toEqual([]);
  await page.getByRole('button', { name: 'Open feature/late', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await state(page)).workspaces.find(item => item.id === 'fixture-created-workspace-1')?.worktree?.id).toBe('fixture-created-1');
  expect(http.creates).toBe(1);
});

test('expired authentication hides the manager and stops actions until the session unlocks', async ({ page }) => {
  await mount(page);
  http.failReads = { path: rootPage, error: 'Unlock the workspace to continue.', code: 'AUTH_REQUIRED', status: 401 };
  await page.getByRole('button', { name: 'Manage worktrees for Project', exact: true }).click();
  await expect(page.getByText('Workspace is locked', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(mutations()).toEqual([]);
  http.failReads = undefined;
  await update(page, { locked: false });
  await expect(page.getByRole('button', { name: 'Open Feature checkout', exact: true })).toBeEnabled();
});

test('topbar menus, touch controls, nested confirmation focus and activity scrollbars work on narrow screens', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 780 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  for (let index = 1; index < 11; index++) http.records.push(checkout({ id: `fixture-many-${index}`, workspaceId: `fixture-many-workspace-${index}`, name: `Checkout ${index} with a readable long name`, branch: `feature/a-long-branch-name-${index}`, path: `/workspace/a-long-project-name/checkouts/feature-${index}` }));
  await mount(page);
  await page.getByRole('button', { name: 'Actions for Project', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: /^Worktrees/ }).press('Enter');
  await expect(page.getByRole('button', { name: 'All workspaces', exact: true })).toBeFocused();
  const modal = page.getByRole('dialog', { name: 'Your workspaces', exact: true });
  const scroller = page.locator('.worktree-list');
  await expect(page.getByRole('button', { name: 'New worktree', exact: true })).toBeEnabled();
  expect(await modal.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const width = (await scroller.boundingBox())!.width;
  await scroller.hover(); await page.mouse.wheel(0, 360);
  await expect(scroller).toHaveAttribute('data-scroll-active', 'true');
  await expect(scroller).not.toHaveAttribute('data-scroll-active', 'true', { timeout: 3_000 });
  expect((await scroller.boundingBox())!.width).toBe(width);
  await scroller.evaluate(element => { element.scrollTop = 0; });
  await page.locator('[data-worktree-id="fixture-worktree"]').scrollIntoViewIfNeeded();
  const dialog = await confirmRemoval(page);
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Remove worktree', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(modal).toBeVisible();
  await expect(page.getByRole('button', { name: 'Actions for worktree Feature checkout', exact: true })).toBeFocused();
  for (const button of await modal.locator('button:visible').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await modal.evaluate(element => [...element.querySelectorAll('*')].every(child => { const style = getComputedStyle(child); return style.boxShadow === 'none' && style.backdropFilter === 'none'; }))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('worktrees-phone.png') });
  await page.getByRole('button', { name: 'New worktree', exact: true }).click();
  const select = page.getByRole('combobox', { name: 'Checkout type', exact: true });
  await select.click();
  const surface = page.locator('.cw-dropdown-surface');
  const box = (await surface.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(360); expect(box.y + box.height).toBeLessThanOrEqual(780);
  await page.keyboard.press('Escape');
  await expect(select).toBeFocused();
  await expect(modal).toBeVisible();
  expect(mutations()).toEqual([]);
});

function manyCheckouts(count: number) {
  http.records = Array.from({ length: count }, (_, index) => checkout({ id: `paged-checkout-${index}`, workspaceId: `paged-workspace-${index}`,
    name: `Paged checkout ${String(index).padStart(3, '0')}`, branch: `paging/branch-${index}`, path: `/workspace/paged/${index}` }));
  http.registrations = [main, other, ...http.records.map(registration)];
}

test('requests separate worktree pages, bounds mounted cards, and retains the last page when the next read fails', async ({ page }) => {
  manyCheckouts(120);
  await mount(page);
  // StrictMode can cancel its first read after headers arrive. This Playwright
  // release does not settle Response.finished() on requestfailed, so select an
  // actually completed request before reading and checking the returned page.
  const initialResponse = page.waitForEvent('requestfinished', request => new URL(request.url()).pathname === rootPage
    && request.method() === 'GET').then(async request => {
    const response = await request.response();
    expect(response?.ok()).toBe(true);
    return response!.json() as Promise<{ items: ManagedWorktree[]; total: number }>;
  });
  await manage(page);
  const initial = await initialResponse;
  expect(initial.items).toHaveLength(25); expect(initial.total).toBe(120);
  await expect(page.locator('[data-worktree-id="paged-checkout-0"]')).toBeVisible();
  await expect.poll(() => page.locator('.worktree-item').count()).toBeLessThan(12);
  expect(http.requests.filter(request => request.method === 'GET' && request.path === rootCollection)).toEqual([]);
  const next = page.getByRole('button', { name: 'Next worktrees', exact: true });
  await next.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('[data-worktree-id="paged-checkout-25"]')).toBeVisible();
  await expect(next).toBeFocused();
  expect(http.requests.filter(request => request.path === rootPage).at(-1)?.query).toMatchObject({ offset: '25', limit: '25' });
  http.failNext = { method: 'GET', path: rootPage, error: 'The next worktree page is temporarily unavailable.', status: 503 };
  await next.click();
  await expect(page.getByRole('alert')).toContainText('next worktree page is temporarily unavailable');
  await expect(page.locator('[data-worktree-id="paged-checkout-25"]')).toBeVisible();
  await expect(page.locator('[data-worktree-id="paged-checkout-50"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('[data-worktree-id="paged-checkout-50"]')).toBeVisible();
  expect(http.requests.filter(request => request.path === rootPage).at(-1)?.query?.offset).toBe('50');
  await page.getByRole('searchbox', { name: 'Search worktrees', exact: true }).fill('Paged checkout 117');
  await expect(page.locator('[data-worktree-id="paged-checkout-50"]')).toHaveCount(0);
  await expect(page.locator('[data-worktree-id="paged-checkout-117"]')).toBeVisible();
  await expect(page.locator('.worktree-item')).toHaveCount(1);
  expect(http.requests.filter(request => request.path === rootPage).at(-1)?.query).toMatchObject({ offset: '0', q: 'Paged checkout 117' });
  expect(mutations()).toEqual([]);
});

test('keeps the exact current checkout and primary metadata when both are outside the first workspace page', async ({ page }) => {
  manyCheckouts(90);
  const selected = registration(http.records[80]);
  await mount(page, { workspaces: [selected], activeWorkspaceId: selected.id, blockSwitch: true });
  await manage(page, selected.name);
  await expect(page.locator('.worktree-primary')).toContainText(main.name);
  await expect(page.locator('[data-worktree-id="paged-checkout-80"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'New worktree', exact: true }).click();
  await expect(page.locator('.worktree-field').filter({ has: page.getByLabel('Start from optional', { exact: true }) })).toContainText(selected.name);
  await page.getByLabel('New branch name', { exact: true }).fill('paging/from-exact-current');
  await page.getByRole('button', { name: 'Create worktree', exact: true }).click();
  await expect(page.getByText('Your current workspace is still open.', { exact: false })).toBeVisible();
  expect(mutations()).toEqual([{ method: 'POST', path: `/api/workspaces/${selected.id}/worktrees`, marker: '1', body: { branch: 'paging/from-exact-current', createBranch: true } }]);
  expect((await state(page)).activeWorkspaceId).toBe(selected.id);
});

test('supports keyboard paging and virtualized card scrolling on a phone without changing navigation or issuing mutations', async ({ page }) => {
  manyCheckouts(80);
  await page.setViewportSize({ width: 390, height: 844 });
  await mount(page); await manage(page);
  const scroller = page.getByRole('list', { name: 'Repository worktrees', exact: true });
  await expect(page.locator('[data-worktree-id="paged-checkout-0"]')).toBeVisible();
  await scroller.focus(); await page.keyboard.press('End');
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect.poll(() => page.locator('.worktree-item').count()).toBeLessThan(12);
  const next = page.getByRole('button', { name: 'Next worktrees', exact: true });
  await next.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('[data-worktree-id="paged-checkout-25"]')).toBeVisible();
  expect((await next.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(next).toBeFocused();
  await page.getByRole('button', { name: 'Previous worktrees', exact: true }).click();
  await expect(page.locator('[data-worktree-id="paged-checkout-0"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'All workspaces', exact: true })).toBeEnabled();
  expect(await page.getByRole('dialog', { name: 'Your workspaces', exact: true }).evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(mutations()).toEqual([]);
});

const appHeaders = { 'X-Codex-Workspace': '1' };
const committedFile = 'export const retained = true;\n';

function requireLocalApp(baseURL: string | undefined) {
  if (!baseURL || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname)) throw new Error('The App worktree regressions require a local test server.');
}

async function preservedAppConversation(page: Page, workspace: Workspace, title: string, content = committedFile): Promise<Thread> {
  const config = test.info().config;
  const servers = Array.isArray(config.webServer) ? config.webServer : [config.webServer];
  const configured = process.env.PLAYWRIGHT_DATA_DIR || servers.find(server => server?.env?.DATA_DIR)?.env?.DATA_DIR
    || (typeof config.metadata.codexBrowserServerDataDir === 'string' ? config.metadata.codexBrowserServerDataDir : undefined);
  if (!configured) throw new Error('Provide the owned test server PLAYWRIGHT_DATA_DIR before seeding a preserved conversation.');
  const storageResponse = await page.request.get('/api/storage'); expect(storageResponse.status()).toBe(200);
  const endpoint = new URL(storageResponse.url()), storage = await storageResponse.json() as { path: string; persistent: boolean };
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) || storage.persistent !== false) {
    throw new Error('Preserved worktree conversations require an owned nonpersistent loopback test server.');
  }
  const root = await fs.realpath(configured), temporary = await fs.realpath(os.tmpdir());
  const relativeRoot = path.relative(temporary, root);
  if (!relativeRoot || relativeRoot.startsWith('..') || path.isAbsolute(relativeRoot)
    || !relativeRoot.split(path.sep)[0].startsWith('codex-') || root !== await fs.realpath(storage.path)) {
    throw new Error('The supplied fixture root does not match the owned temporary server.');
  }
  // Linked checkouts have their own managed path; they are not ordinary
  // workspaces/<id> directories. Check the actual registered path and bytes.
  const canonicalWorkspace = await fs.realpath(workspace.path), relativeWorkspace = path.relative(root, canonicalWorkspace);
  const file = path.join(canonicalWorkspace, 'keep.ts');
  if (canonicalWorkspace !== workspace.path || !relativeWorkspace || relativeWorkspace.startsWith('..') || path.isAbsolute(relativeWorkspace)
    || await fs.realpath(file) !== file || await fs.readFile(file, 'utf8') !== content) {
    throw new Error('The real checkout files do not match this fixture server.');
  }
  const registered = await page.request.get(`/api/workspaces/${workspace.id}`); expect(registered.status()).toBe(200);
  expect(await registered.json()).toMatchObject({ id: workspace.id, path: canonicalWorkspace, createdAt: workspace.createdAt });
  expect((await readAppFile(page, workspace)).content).toBe(content);
  const stateDir = path.join(root, 'codex-workspace', 'state');
  if (await fs.realpath(stateDir) !== stateDir) throw new Error('The owned fixture state directory must not be redirected.');
  const timestamp = new Date().toISOString(), id = `thr_${randomUUID().replaceAll('-', '')}`;
  const summary = { id, workspaceId: workspace.id, title, createdAt: timestamp, updatedAt: timestamp, status: 'idle' as const };
  const thread: Thread = { ...summary, messages: [], turns: [] };
  // Persist canonical legacy records, then let the real server authorize all
  // reads and UI selections. This fixture never starts or impersonates a CLI.
  await fs.writeFile(path.join(stateDir, `thread-${id}.json`), JSON.stringify({ thread, input: [], revision: 1 }) + '\n', { flag: 'wx', mode: 0o600 });
  await fs.writeFile(path.join(stateDir, `thread-summary-${id}.json`), JSON.stringify(summary) + '\n', { flag: 'wx', mode: 0o600 });
  const response = await page.request.get(`/api/threads/${id}`); expect(response.status()).toBe(200);
  const canonical = await response.json() as Thread;
  expect(canonical).toMatchObject({ id, workspaceId: workspace.id, title, backend: 'legacy', readOnly: true });
  const list = await page.request.get('/api/threads', { params: { workspaceId: workspace.id, backend: 'legacy', limit: 60 } });
  expect(list.status()).toBe(200);
  expect((await list.json() as ThreadListPage).items).toContainEqual(expect.objectContaining({ id, workspaceId: workspace.id, backend: 'legacy', readOnly: true }));
  return canonical;
}

async function readAppFile(page: Page, workspace: Workspace): Promise<FileContent> {
  const response = await page.request.get(`/api/workspaces/${workspace.id}/file`, { params: { path: 'keep.ts' } });
  expect(response.status()).toBe(200);
  return response.json();
}

async function appEditor(page: Page) {
  const editor = page.getByRole('region', { name: 'Code editor', exact: true });
  // The main Editor action toggles a mounted pane. Navigation must not hide an
  // editor that is already visible after restoring this workspace's layout.
  if (!await editor.isVisible()) await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('button', { name: 'Editor', exact: true }).click();
  await expect(editor).toBeVisible();
  return editor;
}

async function editAppFile(page: Page, content: string) {
  const editor = await appEditor(page);
  const textarea = editor.locator('.monaco-editor textarea.inputarea').first();
  await expect(textarea).toBeVisible();
  await textarea.focus();
  await page.keyboard.press('ControlOrMeta+KeyA');
  await page.keyboard.insertText(content);
  await expect(page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
}

async function saveAppFile(page: Page, workspace: Workspace, content: string) {
  const save = page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true });
  await save.click();
  await expect.poll(async () => (await readAppFile(page, workspace)).content).toBe(content);
  await expect(save).toBeDisabled();
}

test('@app creates, archives and reopens a native worktree through the top bar while preserving files, tabs and conversations', async ({ page, baseURL }, testInfo) => {
  requireLocalApp(baseURL);
  const password = process.env.PLAYWRIGHT_PASSWORD || 'browser-test-workspace-password';
  await page.setViewportSize({ width: 1440, height: 960 });
  expect((await page.request.post('/api/session', { headers: appHeaders, data: { password } })).status()).toBe(200);
  const sourceResponse = await page.request.post('/api/workspaces', { headers: appHeaders, data: { name: 'App worktree lifecycle source', initializeGit: true } });
  expect(sourceResponse.status()).toBe(201);
  const source = await sourceResponse.json() as Workspace;
  expect((await page.request.put(`/api/workspaces/${source.id}/file`, { headers: appHeaders, data: { path: 'keep.ts', content: committedFile } })).status()).toBe(200);
  expect((await page.request.post(`/api/workspaces/${source.id}/git/stage`, { headers: appHeaders, data: { paths: ['keep.ts'] } })).status()).toBe(200);
  expect((await page.request.post(`/api/workspaces/${source.id}/git/commit`, { headers: appHeaders, data: { message: 'Seed the native App worktree lifecycle' } })).status()).toBe(200);
  const sourceThread = await preservedAppConversation(page, source, 'Primary checkout notes');
  const preferences = await (await page.request.get('/api/ui-state')).json() as UiState;
  expect((await page.request.patch('/api/ui-state', { headers: appHeaders, data: { revision: preferences.revision, changes: [
    { section: 'layout', profile: 'desktop', key: 'view', value: 'editor' },
    { section: 'layout', profile: 'desktop', key: 'split', value: 'focus' },
    { section: 'workspace', workspaceId: source.id, key: 'threadId', value: sourceThread.id },
    { section: 'workspace', workspaceId: source.id, key: 'tabs', value: { paths: ['keep.ts'], active: 'keep.ts' } },
  ] } })).status()).toBe(200);
  expect((await page.request.patch(`/api/workspaces/${source.id}`, { headers: appHeaders, data: { active: true } })).status()).toBe(200);

  const errors: string[] = [];
  const mutations: RecordedRequest[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET' && (path.includes('/worktrees') || path === '/api/threads')) mutations.push({ method: request.method(), path, body: request.postData() ? request.postDataJSON() as Record<string, unknown> : undefined, marker: request.headers()['x-codex-workspace'] });
  });
  await page.goto('/work');
  const topbar = page.locator('.topbar-workspace');
  await expect(topbar).toHaveText(source.name);
  const editor = await appEditor(page);
  await expect(editor.getByRole('tab', { name: 'keep.ts', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(editor.locator('.view-lines').first()).toContainText('retained = true');
  await topbar.click(); await manage(page, source.name);
  await page.getByRole('button', { name: 'New worktree', exact: true }).click();
  await page.getByLabel('New branch name', { exact: true }).fill('feature/app-lifecycle');
  await page.getByLabel('Workspace name optional', { exact: true }).fill('App lifecycle checkout');
  const createdResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/workspaces/${source.id}/worktrees` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create worktree', exact: true }).click();
  const creation = await createdResponse;
  expect(creation.status()).toBe(201);
  const linked = await creation.json() as CreatedWorktree;
  expect(linked.workspace.worktree).toMatchObject({ id: linked.worktree.id, sourceWorkspaceId: source.id, repositoryWorkspaceId: source.id });
  expect(linked.workspace.id).not.toBe(source.id);
  expect(linked.workspace.path).not.toBe(source.path);
  await expect(topbar).toHaveText(linked.workspace.name);
  await expect(page.getByRole('dialog', { name: 'Your workspaces', exact: true })).toHaveCount(0);
  expect((await readAppFile(page, linked.workspace)).content).toBe(committedFile);
  await editor.getByRole('treeitem', { name: 'keep.ts', exact: true }).click();
  const checkoutContent = 'export const retained = "saved in the linked checkout";\n';
  await editAppFile(page, checkoutContent);
  await saveAppFile(page, linked.workspace, checkoutContent);
  expect((await readAppFile(page, source)).content).toBe(committedFile);

  const linkedThread = await preservedAppConversation(page, linked.workspace, 'Linked checkout notes', checkoutContent);
  const beforeThread = await (await page.request.get('/api/ui-state')).json() as UiState;
  expect((await page.request.patch('/api/ui-state', { headers: appHeaders, data: { revision: beforeThread.revision, changes: [
    { section: 'workspace', workspaceId: linked.workspace.id, key: 'threadId', value: linkedThread.id },
  ] } })).status()).toBe(200);
  await expect.poll(async () => (await (await page.request.get('/api/ui-state')).json() as UiState).workspaces[linked.workspace.id]?.tabs).toEqual({ paths: ['keep.ts'], active: 'keep.ts' });
  await page.reload();
  await expect(topbar).toHaveText(linked.workspace.name);
  await expect(editor.getByRole('tab', { name: 'keep.ts', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(editor.locator('.view-lines').first()).toContainText('saved in the linked checkout');
  const savedUi = await (await page.request.get('/api/ui-state')).json() as UiState;
  expect(savedUi.workspaces[linked.workspace.id]).toMatchObject({ threadId: linkedThread.id, tabs: { paths: ['keep.ts'], active: 'keep.ts' } });

  await topbar.click();
  const switcher = page.getByRole('dialog', { name: 'Your workspaces', exact: true });
  if (await switcher.getByLabel('Find a workspace', { exact: true }).count()) await switcher.getByLabel('Find a workspace', { exact: true }).fill(source.name);
  await switcher.locator('.workspace-select').filter({ hasText: source.name }).click();
  await expect(topbar).toHaveText(source.name);
  await expect(editor.locator('.view-lines').first()).toContainText('retained = true');
  await topbar.click(); await manage(page, source.name); await menu(page, linked.workspace.name);
  await page.getByRole('menuitem', { name: /^Archive worktree/ }).click();
  await expect(page.getByRole('button', { name: `Reopen ${linked.workspace.name}`, exact: true })).toBeEnabled();
  await expect(topbar).toHaveText(source.name);
  expect((await (await page.request.get('/api/workspaces')).json() as Workspace[]).some(workspace => workspace.id === linked.workspace.id)).toBe(false);
  await page.getByRole('button', { name: 'All workspaces', exact: true }).click();
  await expect(switcher.locator('.workspace-list')).not.toContainText(linked.workspace.name);
  await manage(page, source.name);
  await page.getByRole('button', { name: `Reopen ${linked.workspace.name}`, exact: true }).click();
  await expect(topbar).toHaveText(linked.workspace.name);
  await expect(switcher).toHaveCount(0);
  await expect(editor.getByRole('tab', { name: 'keep.ts', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(editor.locator('.view-lines').first()).toContainText('saved in the linked checkout');
  expect((await readAppFile(page, linked.workspace)).content).toBe(checkoutContent);
  expect((await readAppFile(page, source)).content).toBe(committedFile);
  const restored = await (await page.request.get(`/api/workspaces/${source.id}/worktrees`)).json() as ManagedWorktree[];
  expect(restored).toHaveLength(1);
  expect(restored[0]).toMatchObject({ id: linked.worktree.id, workspaceId: linked.workspace.id, branch: 'feature/app-lifecycle', state: 'ready', dirty: true });
  const threads = await (await page.request.get('/api/threads', { params: { workspaceId: linked.workspace.id, backend: 'legacy' } })).json() as ThreadListPage;
  expect(threads.items.map(thread => thread.id)).toEqual([linkedThread.id]);
  const afterReopen = await (await page.request.get('/api/ui-state')).json() as UiState;
  expect(afterReopen.workspaces[source.id]).toEqual(savedUi.workspaces[source.id]);
  expect(afterReopen.workspaces[linked.workspace.id]).toEqual(savedUi.workspaces[linked.workspace.id]);
  expect(mutations).toEqual([
    { method: 'POST', path: `/api/workspaces/${source.id}/worktrees`, marker: '1', body: { name: linked.workspace.name, branch: 'feature/app-lifecycle', createBranch: true } },
    { method: 'POST', path: `/api/workspaces/${source.id}/worktrees/${linked.worktree.id}/archive`, marker: '1', body: {} },
    { method: 'POST', path: `/api/workspaces/${source.id}/worktrees/${linked.worktree.id}/open`, marker: '1', body: {} },
  ]);
  expect(errors).toEqual([]);
  await testInfo.attach('native-worktree-lifecycle', { body: JSON.stringify({ sourceWorkspaceId: source.id, linkedWorkspaceId: linked.workspace.id, worktreeId: linked.worktree.id, preservedThreadId: linkedThread.id, sourceFile: committedFile, linkedFile: checkoutContent, mutations }), contentType: 'application/json' });
  await page.screenshot({ path: testInfo.outputPath('native-worktree-lifecycle.png'), animations: 'disabled' });
});

test('@app the real App rejects an activation response spanning lock and unlock, then permits a fresh guarded switch', async ({ page, baseURL }, testInfo) => {
  // This case uses the configured built application and its native Git backend.
  // Only delivery of one already-applied PATCH response is delayed.
  requireLocalApp(baseURL);
  const password = process.env.PLAYWRIGHT_PASSWORD || 'browser-test-workspace-password';
  const headers = { 'X-Codex-Workspace': '1' };
  await page.setViewportSize({ width: 1440, height: 960 });
  expect((await page.request.post('/api/session', { headers, data: { password } })).status()).toBe(200);
  const createdSource = await page.request.post('/api/workspaces', { headers, data: { name: 'App worktree lock source', initializeGit: true } });
  expect(createdSource.status()).toBe(201);
  const source = await createdSource.json() as Workspace;
  expect((await page.request.put(`/api/workspaces/${source.id}/file`, { headers, data: { path: 'keep.ts', content: 'export const retained = true;\n' } })).status()).toBe(200);
  expect((await page.request.post(`/api/workspaces/${source.id}/git/stage`, { headers, data: { paths: ['keep.ts'] } })).status()).toBe(200);
  expect((await page.request.post(`/api/workspaces/${source.id}/git/commit`, { headers, data: { message: 'Seed the worktree activation regression' } })).status()).toBe(200);
  const createdCheckout = await page.request.post(`/api/workspaces/${source.id}/worktrees`, { headers, data: { name: 'App lock race checkout', branch: 'feature/lock-cycle', createBranch: true } });
  expect(createdCheckout.status()).toBe(201);
  const linked = await createdCheckout.json() as CreatedWorktree;
  const sourceThread = await preservedAppConversation(page, source, 'Primary checkout lock notes');
  const linkedThread = await preservedAppConversation(page, linked.workspace, 'Linked checkout lock notes');
  const previousUi = await (await page.request.get('/api/ui-state')).json() as UiState;
  const preferenceSave = await page.request.patch('/api/ui-state', { headers, data: { revision: previousUi.revision, changes: [
    { section: 'layout', profile: 'desktop', key: 'view', value: 'editor' },
    { section: 'layout', profile: 'desktop', key: 'split', value: 'focus' },
    { section: 'workspace', workspaceId: source.id, key: 'threadId', value: sourceThread.id },
    { section: 'workspace', workspaceId: source.id, key: 'tabs', value: { paths: ['keep.ts'], active: 'keep.ts' } },
    { section: 'workspace', workspaceId: linked.workspace.id, key: 'threadId', value: linkedThread.id },
    { section: 'workspace', workspaceId: linked.workspace.id, key: 'tabs', value: { paths: ['keep.ts'], active: 'keep.ts' } },
  ] } });
  expect(preferenceSave.status()).toBe(200);
  const preferences = await preferenceSave.json() as UiState;
  expect((await page.request.patch(`/api/workspaces/${source.id}`, { headers, data: { active: true } })).status()).toBe(200);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let activationApplied = false, intercepted = false;
  let releaseActivation!: () => void;
  const continuation = new Promise<void>(resolve => { releaseActivation = resolve; });
  const activationPath = `/api/workspaces/${linked.workspace.id}`;
  const pattern = `**${activationPath}`;
  // Exercise the generation fence even when transport cancellation loses a
  // race: this one already-applied activation still reaches the client after
  // lock/unlock. Other requests retain their ordinary AbortSignal behavior.
  await page.addInitScript(activationPath => {
    const fetch = window.fetch.bind(window);
    const delivery = { intercepted: false, aborted: false, delivered: false };
    Object.assign(window, { __worktreeActivationDelivery: delivery });
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (!delivery.intercepted && url.pathname === activationPath && init?.method === 'PATCH') {
        delivery.intercepted = true;
        init.signal?.addEventListener('abort', () => { delivery.aborted = true; }, { once: true });
        const response = await fetch(input, { ...init, signal: undefined });
        delivery.delivered = true;
        return response;
      }
      return fetch(input, init);
    };
  }, activationPath);
  const intercept = async (route: Route) => {
    if (!intercepted && route.request().method() === 'PATCH' && route.request().postDataJSON()?.active === true) {
      intercepted = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      activationApplied = true;
      await continuation;
      await route.fulfill({ response });
    } else await route.continue();
  };
  await page.route(pattern, intercept);
  try {
    await page.goto('/work');
    const topbar = page.locator('.topbar-workspace');
    await expect(topbar).toHaveText(source.name);
    const editor = await appEditor(page);
    await expect(editor.getByRole('tab', { name: 'keep.ts', exact: true })).toHaveAttribute('aria-selected', 'true');
    const retainedEdit = 'export const retained = "saved before the lock race";\n';
    await editAppFile(page, retainedEdit);
    await topbar.click(); await manage(page, source.name);
    // The real Monaco buffer and useDocuments guard must reject this switch;
    // no replacement component callback or injected cancel event is involved.
    const confirmations: Array<{ type: string; message: string }> = [];
    page.once('dialog', async dialog => { confirmations.push({ type: dialog.type(), message: dialog.message() }); await dialog.dismiss(); });
    await page.getByRole('button', { name: `Open ${linked.workspace.name}`, exact: true }).click();
    await expect(page.getByText('Your current workspace is still open.', { exact: false })).toBeVisible();
    expect(confirmations).toEqual([{ type: 'confirm', message: 'This workspace has 1 unsaved file. Switch workspaces and discard those edits?' }]);
    expect(activationApplied).toBe(false);
    await expect(topbar).toHaveText(source.name);
    expect((await readAppFile(page, source)).content).toBe(committedFile);
    await page.getByRole('dialog', { name: 'Your workspaces', exact: true }).getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(editor.locator('.view-lines').first()).toContainText('saved before the lock race');
    await saveAppFile(page, source, retainedEdit);
    await topbar.click(); await manage(page, source.name);
    await page.getByRole('button', { name: `Open ${linked.workspace.name}`, exact: true }).click();
    await expect.poll(() => activationApplied).toBe(true);
    expect((await page.request.delete('/api/session', { headers })).status()).toBe(200);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('codex:session-expired')));
    await expect(page.getByLabel('Workspace password', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __worktreeActivationDelivery: { aborted: boolean } }).__worktreeActivationDelivery.aborted)).toBe(true);
    await page.getByLabel('Workspace password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByLabel('Workspace password', { exact: true })).toHaveCount(0);
    await expect(topbar).toHaveText(source.name);
    await expect(editor.locator('.view-lines').first()).toContainText('saved before the lock race');
    const completed = page.waitForResponse(response => new URL(response.url()).pathname === activationPath && response.request().method() === 'PATCH');
    releaseActivation(); await completed;
    await expect.poll(() => page.evaluate(() => (window as unknown as { __worktreeActivationDelivery: { delivered: boolean } }).__worktreeActivationDelivery.delivered)).toBe(true);
    // Observe React after the delayed callback and its finally block run.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(topbar).toHaveText(source.name);
    await expect(page.getByRole('dialog', { name: 'Your workspaces', exact: true })).toHaveCount(0);
    const afterUnlock = await (await page.request.get('/api/ui-state')).json() as UiState;
    expect(afterUnlock.workspaces[source.id]).toEqual(preferences.workspaces[source.id]);
    expect(afterUnlock.workspaces[linked.workspace.id]).toEqual(preferences.workspaces[linked.workspace.id]);
    await topbar.click(); await manage(page, source.name);
    await page.getByRole('button', { name: `Open ${linked.workspace.name}`, exact: true }).click();
    await expect(topbar).toHaveText(linked.workspace.name);
    await expect(page.getByRole('dialog', { name: 'Your workspaces', exact: true })).toHaveCount(0);
    await expect(editor.locator('.view-lines').first()).toContainText('retained = true');
    expect((await readAppFile(page, source)).content).toBe(retainedEdit);
    expect((await (await page.request.get(`/api/workspaces/${source.id}/worktrees`)).json() as ManagedWorktree[]).map(worktree => worktree.workspaceId)).toEqual([linked.workspace.id]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('native-worktree-lock-cycle.png'), animations: 'disabled' });
  } finally { releaseActivation(); await page.unroute(pattern, intercept); }
});
