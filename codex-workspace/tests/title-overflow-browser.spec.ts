import { expect, test, type Locator, type Page } from '@playwright/test';
import type { CodexModelCatalog, CodexRuntimeStatus, Thread, UiLayoutProfile, UiState, Workspace } from '../shared/types';

const headers = { 'X-Codex-Workspace': '1' };
const chatTitle = 'Release readiness — repair conversation reconnects, retain draft files, and review deployment details for 東京workspace';
const otherTitle = 'Internationalization_工程讨论_ממשקמשתמש_verylongunbrokenconversationidentifier_20260930_review';
const workspaceTitle = 'Arc delivery — 東京工程_ממשק_workspace_with_a_long_unbroken_identifier_20260930';
const fileName = 'release_reconnect_and_persistent_workspace_acceptance_東京_ממשק_20260930_review.md';
const terminalTitle = 'Development_shell_for_release_reconnect_and_persistence_東京_ממשק_20260930';
const modelTitle = 'Long catalog model label for 東京 internationalized workspace review';
const projectTitle = 'Release organization — native_configuration_for_' + 'workspace_review_'.repeat(8);
const rootId = '0199a111-1111-7111-8111-111111111111';
const otherId = '0199a222-2222-7222-8222-222222222222';
const stamp = '2026-09-30T12:00:00.000Z';
const capabilities = { conversations: true, pagination: true, queue: true, goals: true, skills: true, plan: true, review: true, historyRevert: true };

async function ellipsis(label: Locator, fullText: string, clipped = true) {
  await expect(label).toHaveText(fullText);
  await expect(label).toHaveCSS('text-overflow', 'ellipsis');
  await expect(label).toHaveCSS('white-space', 'nowrap');
  const box = await label.evaluate(element => {
    const html = element as HTMLElement, rect = html.getBoundingClientRect(), style = getComputedStyle(html);
    return { client: html.clientWidth, scroll: html.scrollWidth, height: rect.height, lineHeight: parseFloat(style.lineHeight), overflow: style.overflowX, display: style.display };
  });
  expect(box.client).toBeGreaterThan(12);
  expect(['hidden', 'clip']).toContain(box.overflow);
  expect(box.display).not.toBe('flex');
  expect(box.display).not.toBe('inline-flex');
  if (Number.isFinite(box.lineHeight)) expect(box.height).toBeLessThanOrEqual(box.lineHeight + 2);
  if (clipped) expect(box.scroll).toBeGreaterThan(box.client + 3);
}

async function within(child: Locator, parent: Locator) {
  const a = await child.boundingBox(), b = await parent.boundingBox();
  expect(a).not.toBeNull(); expect(b).not.toBeNull();
  expect(a!.x).toBeGreaterThanOrEqual(b!.x - 1);
  expect(a!.x + a!.width).toBeLessThanOrEqual(b!.x + b!.width + 1);
}

async function noPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}

async function prepare(page: Page, profile: UiLayoutProfile) {
  expect((await page.request.post('/api/session', { headers, data: { password: 'title-overflow-fixture-password' } })).status()).toBe(200);
  const create = await page.request.post('/api/workspaces', { headers, data: { name: workspaceTitle } });
  expect(create.status()).toBe(201);
  const workspace = await create.json() as Workspace;
  expect((await page.request.patch(`/api/workspaces/${workspace.id}`, { headers, data: { active: true } })).ok()).toBe(true);
  expect((await page.request.post(`/api/workspaces/${workspace.id}/files`, { headers, data: { path: fileName, kind: 'file' } })).ok()).toBe(true);
  const fileContents = '# Full file content stays readable\n\n' + 'workspace-review-content-'.repeat(35) + '\n';
  expect((await page.request.put(`/api/workspaces/${workspace.id}/file`, { headers, data: { path: fileName, content: fileContents } })).ok()).toBe(true);
  const ui = await (await page.request.get('/api/ui-state')).json() as UiState;
  expect((await page.request.patch('/api/ui-state', { headers, data: { revision: ui.revision, changes: [
    { section: 'layout', profile, key: 'view', value: 'agent' },
    { section: 'layout', profile, key: 'split', value: profile === 'desktop' || profile === 'laptop' ? 'split' : 'focus' },
  ] } })).ok()).toBe(true);
  const makeThread = (id: string, title: string): Thread => ({ id, workspaceId: workspace.id, title, backend: 'codex-cli', status: 'idle',
    createdAt: stamp, updatedAt: stamp, messages: [{ id: 'saved-' + id, role: 'user', content: 'Saved conversation content remains complete.', createdAt: stamp }],
    nativePage: { nextCursor: null, backwardsCursor: null }, native: { model: 'overflow-fixture-model', reasoningEffort: 'high', activeTurnId: null,
      approvals: [], questions: [], queue: [], queueCursor: null, goal: null, tokenUsage: null, diff: null, capabilities },
  });
  const threads = [makeThread(rootId, chatTitle), makeThread(otherId, otherTitle)];
  const runtime: CodexRuntimeStatus = { backend: 'codex-cli', state: 'ready', version: '0.155.1', installedVersion: '0.155.1', startedAt: null,
    updatedAt: stamp, canUpdate: true, updateBlockedReason: null, error: null, activeTurns: 0, capabilities };
  const models: CodexModelCatalog = { backend: 'codex-cli', connected: true, models: ['overflow-fixture-model'], catalog: [{ id: 'overflow-fixture-model',
    model: 'overflow-fixture-model', displayName: modelTitle, description: 'Layout metadata fixture.', hidden: false,
    isDefault: true, defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'High' }], inputModalities: ['text'] }] };
  const actions: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
  let selectedThreadId = rootId;
  const projectFixture = { project: { id: 'overflow-project', name: projectTitle, roots: [{ path: workspace.path }], metadata: {}, position: 0, createdAt: 1, updatedAt: 1, recencyAt: null }, workspaceRoots: ['.'], revision: 'fixture-project-revision' };
  await page.routeWebSocket('**/ws/terminal?**', socket => {
    const server = socket.connectToServer();
    server.onMessage(message => {
      if (typeof message === 'string') {
        const event = JSON.parse(message);
        if (event.type === 'ready') {
          event.session.title = terminalTitle;
          if (event.sessions) for (const session of event.sessions) session.title = terminalTitle;
          socket.send(JSON.stringify(event)); return;
        }
      }
      socket.send(message);
    });
  });
  await page.addInitScript(() => {
    // Only the saved native conversation transport is a fixture. Files, layout,
    // workspace actions, Monaco, and terminal sessions use the actual site API.
    const OriginalSource = window.EventSource;
    class SavedSource extends EventTarget {
      static CLOSED = 2; static OPEN = 1; static CONNECTING = 0;
      readyState = 0; onmessage = null; onerror = null; onopen: (() => void) | null = null;
      constructor(readonly url: string) { super(); setTimeout(() => { if (this.readyState !== 2) { this.readyState = 1; this.onopen?.(); } }, 0); }
      close() { this.readyState = 2; }
    }
    window.EventSource = new Proxy(OriginalSource, { construct(target, args) {
      return String(args[0]).includes('/api/threads/') ? new SavedSource(String(args[0])) : Reflect.construct(target, args);
    } });
  });
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    if (path === '/api/ui-state') {
      // Native thread IDs belong to the metadata fixture. Keep every actual
      // layout/editor preference on the real server and inject only selection.
      let response;
      if (method === 'PATCH') {
        const input = request.postDataJSON();
        for (const change of input.changes) if (change.section === 'workspace' && change.key === 'threadId') selectedThreadId = change.value;
        const changes = input.changes.filter((change: { section: string; key: string }) => change.section !== 'workspace' || change.key !== 'threadId');
        response = changes.length ? await route.fetch({ postData: { ...input, changes } }) : await page.request.get(url.toString());
      } else response = await route.fetch();
      const saved = await response.json() as UiState;
      return route.fulfill({ response, json: { ...saved, workspaces: { ...saved.workspaces, [workspace.id]: { ...saved.workspaces[workspace.id], threadId: selectedThreadId } } } });
    }
    if (path === '/api/codex/runtime') return route.fulfill({ json: runtime });
    if (path === '/api/models') return route.fulfill({ json: models });
    if (path === '/api/settings' && method === 'GET') {
      const response = await route.fetch();
      return route.fulfill({ response, json: { ...await response.json(), model: 'overflow-fixture-model', reasoningEffort: 'high', agentConfigured: true } });
    }
    if (path === '/api/threads' && method === 'GET') return route.fulfill({ json: { items: threads, olderCursor: null, newerCursor: null, hasOlder: false, hasNewer: false } });
    if (path.startsWith('/api/threads/')) {
      const selected = threads.find(thread => path.startsWith('/api/threads/' + thread.id));
      if (method !== 'GET') {
        const body = request.postDataJSON() as Record<string, unknown>; actions.push({ path, method, body });
        if (method === 'PATCH' && selected && typeof body.title === 'string') { selected.title = body.title; return route.fulfill({ json: selected }); }
        return route.fulfill({ status: 409, json: { error: 'This layout fixture does not execute native turns.' } });
      }
      if (path.endsWith('/agents')) return route.fulfill({ json: [] });
      if (path.endsWith('/queue')) return route.fulfill({ json: { items: [], nextCursor: null } });
      if (selected) return route.fulfill({ json: selected });
    }
    if (path === '/api/codex/plugins/capabilities') return route.fulfill({ json: { connected: false, methods: {} } });
    if (path === `/api/workspaces/${workspace.id}/native/files/directory`) return route.fulfill({ json: { path: '', entries: [{ path: fileName, name: fileName, kind: 'file' }], total: 1, nextCursor: null } });
    if (path === `/api/workspaces/${workspace.id}/codex/projects`) return route.fulfill({ json: { data: [projectFixture], nextCursor: null, filteredCount: 0 } });
    if (path === `/api/workspaces/${workspace.id}/codex/projects/overflow-project`) return route.fulfill({ json: projectFixture });
    if (path === '/api/codex/thread-sections') return route.fulfill({ json: { data: [], nextCursor: null, scope: 'all-native-workspaces' } });
    if (path.endsWith('/organization')) return route.fulfill({ json: { threadId: selectedThreadId, projectId: 'overflow-project', section: null, gitInfo: null, daybreakEnabled: null, memoryModeReadable: false, revision: 'fixture-organization-revision' } });
    if (path === `/api/workspaces/${workspace.id}/terminals` && (method === 'GET' || method === 'POST')) {
      const response = await route.fetch(), body = await response.json();
      const rename = (session: Record<string, unknown>) => ({ ...session, title: terminalTitle });
      return route.fulfill({ response, json: Array.isArray(body) ? body.map(rename) : body.sessions ? { ...body, sessions: body.sessions.map(rename) } : rename(body) });
    }
    if (path.includes('/terminals/') && method === 'DELETE') actions.push({ path, method });
    return route.continue();
  });
  await page.goto('/work');
  await expect(page.locator('.chat-header-context strong')).toHaveText(chatTitle, { timeout: 45_000 });
  return { workspace, actions, fileContents };
}

for (const viewport of [
  { width: 1440, height: 960, profile: 'desktop' as const },
  { width: 1100, height: 850, profile: 'laptop' as const },
  { width: 800, height: 900, profile: 'tablet' as const },
  { width: 390, height: 844, profile: 'mobile' as const },
]) {
  test(`${viewport.width}px titles end in ellipses while history, file, rename and terminal actions keep their source`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const app = await prepare(page, viewport.profile);
    await ellipsis(page.locator('.topbar-workspace > span'), workspaceTitle);
    const header = page.locator('.conversation-header');
    await ellipsis(header.locator('.chat-header-context strong'), chatTitle);
    await within(header.getByRole('button', { name: 'Conversation actions', exact: true }), header);
    await expect(header.getByRole('button', { name: 'Conversation history', exact: true })).toHaveAttribute('aria-description', chatTitle);
    const model = page.getByRole('combobox', { name: 'Model', exact: true });
    await ellipsis(model.locator('.cw-select-value > span'), modelTitle);
    await expect(model).toHaveAttribute('aria-description', modelTitle);
    await model.click();
    const optionLabel = page.getByRole('option').filter({ hasText: modelTitle }).locator('.cw-dropdown-label');
    await ellipsis(optionLabel, modelTitle);
    await optionLabel.hover();
    await expect(page.getByRole('tooltip')).toHaveText(modelTitle);
    await page.keyboard.press('Escape');
    await noPageOverflow(page);

    await page.locator('.topbar-workspace').click();
    const workspaces = page.getByRole('dialog', { name: 'Your workspaces', exact: true });
    await expect(workspaces).toBeVisible();
    const currentRow = workspaces.locator('.workspace-list-item.is-current');
    await ellipsis(currentRow.locator('.workspace-item-label > strong'), workspaceTitle);
    await within(currentRow.getByRole('button', { name: `Delete ${workspaceTitle}`, exact: true }), currentRow);
    await currentRow.locator('.workspace-select').click();
    await expect(workspaces).toBeHidden();
    await expect(page.locator('.topbar-workspace')).toHaveAttribute('aria-label', `Switch workspace. Current workspace: ${workspaceTitle}`);

    await page.getByRole('button', { name: 'Conversation history', exact: true }).click();
    const history = page.getByRole('dialog', { name: 'Conversations', exact: true });
    await ellipsis(history.locator(`[data-conversation-id="${otherId}"] strong`), otherTitle);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`history-${viewport.width}.png`) });
    await history.locator(`[data-conversation-id="${otherId}"]`).click();
    await expect(page.getByRole('button', { name: 'Conversation history', exact: true })).toHaveAttribute('aria-description', otherTitle);
    await page.getByRole('button', { name: 'Conversation actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Rename conversation', exact: true }).click();
    const rename = page.getByRole('dialog', { name: 'Rename conversation', exact: true });
    await expect(rename.getByRole('textbox')).toHaveValue(otherTitle);
    await rename.getByRole('textbox').fill(otherTitle + '_renamed');
    await rename.getByRole('button', { name: 'Save name', exact: true }).click();
    await expect.poll(() => app.actions.find(action => action.method === 'PATCH' && action.path === '/api/threads/' + otherId)?.body?.title).toBe(otherTitle + '_renamed');

    const editor = page.locator('#editor-workbench');
    if (!await editor.isVisible()) await page.getByRole('navigation', { name: viewport.profile === 'mobile' ? 'Mobile navigation' : 'Main navigation', exact: true }).getByRole('button', { name: viewport.profile === 'mobile' ? 'Files' : 'Editor', exact: true }).click();
    await expect(editor).toBeVisible();
    await page.getByRole('button', { name: 'Go to file', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Go to file', exact: true });
    const file = picker.getByRole('option').filter({ hasText: fileName });
    await ellipsis(file.locator('strong'), fileName);
    await file.click();
    const tab = editor.getByRole('tab', { name: fileName, exact: true });
    await expect(tab).toHaveAttribute('aria-description', fileName);
    await ellipsis(tab.locator('span').first(), fileName);
    await expect(editor.locator('.monaco-editor textarea.inputarea').first()).toBeVisible({ timeout: 45_000 });
    await within(editor.getByRole('button', { name: `Close ${fileName}`, exact: true }), editor.locator('.editor-tabbar'));
    expect((await (await page.request.get(`/api/workspaces/${app.workspace.id}/file`, { params: { path: fileName } })).json()).content).toBe(app.fileContents);
    await noPageOverflow(page);

    if (viewport.profile === 'mobile') {
      await page.getByRole('button', { name: 'Workspace actions', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Workspace tools', exact: true }).click();
    } else await page.getByRole('button', { name: 'Workspace tools', exact: true }).click();
    const tools = page.getByRole('dialog', { name: 'Workspace tools', exact: true });
    await tools.getByRole('tab', { name: 'Organization', exact: true }).click();
    const project = tools.locator('.native-org-list-select').filter({ hasText: projectTitle });
    await ellipsis(project.locator('strong'), projectTitle);
    await within(tools.getByRole('button', { name: `Delete project ${projectTitle}`, exact: true }), tools);
    await project.click();
    await expect(tools.getByRole('textbox', { name: 'Project name', exact: true })).toHaveValue(projectTitle);
    const projectSelect = tools.getByRole('combobox', { name: 'Conversation project', exact: true });
    await ellipsis(projectSelect.locator('.cw-select-value'), projectTitle);
    await expect(projectSelect).toHaveAttribute('aria-description', projectTitle);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`native-labels-${viewport.width}.png`) });
    await tools.getByRole('tab', { name: 'Files & search', exact: true }).click();
    const nativeFile = tools.getByRole('button', { name: `Inspect file ${fileName}`, exact: true });
    await ellipsis(nativeFile.locator('.text-ellipsis'), fileName, viewport.width < 1100);
    await tools.getByRole('button', { name: `Open ${fileName} in editor`, exact: true }).click();
    await expect(tools).toBeHidden();
    await expect(editor.getByRole('tab', { name: fileName, exact: true })).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('navigation', { name: viewport.profile === 'mobile' ? 'Mobile navigation' : 'Main navigation', exact: true }).getByRole('button', { name: 'Terminal', exact: true }).click();
    const terminals = page.locator('.terminal-panel');
    await expect(terminals).toBeVisible();
    const terminal = terminals.getByRole('tab', { name: terminalTitle, exact: true });
    await expect(terminal).toBeVisible({ timeout: 30_000 });
    await ellipsis(terminal.locator('.terminal-tab-title'), terminalTitle);
    await within(terminals.getByRole('button', { name: `Close ${terminalTitle}`, exact: true }), terminals.locator('.terminal-tabs'));
    const sessionId = (await terminal.getAttribute('id'))!.replace('terminal-tab-', '');
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`titles-${viewport.width}.png`) });
    await terminals.getByRole('button', { name: `Close ${terminalTitle}`, exact: true }).click();
    await expect.poll(() => app.actions.some(action => action.method === 'DELETE' && action.path.endsWith('/terminals/' + sessionId))).toBe(true);
    await noPageOverflow(page);
    expect(errors).toEqual([]);
  });
}
