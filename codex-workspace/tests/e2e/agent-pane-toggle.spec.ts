import { expect, test, type Page } from '@playwright/test';
import type { CodexModelCatalog, CodexRuntimeStatus, UiLayoutProfile, UiState, Workspace } from '../../shared/types';

const password = process.env.PLAYWRIGHT_PASSWORD || 'browser-test-workspace-password';
const headers = { 'X-Codex-Workspace': '1' };
const original = 'export const value = "saved";\n';


// Layout/site coverage uses native read metadata only. Session, workspaces,
// files, Monaco, PTYs and layout persistence still use the actual test server.
// No turn is started and no provider/model answer is mocked.
const agentWrites = new WeakMap<Page, string[]>();
async function nativeReadMetadata(page: Page) {
  const writes: string[] = []; agentWrites.set(page, writes);
  const runtime: CodexRuntimeStatus = { backend: 'codex-cli', state: 'ready', version: '0.155.1', installedVersion: '0.155.1',
    startedAt: null, updatedAt: '2026-09-22T15:00:00Z', canUpdate: true, updateBlockedReason: null, error: null, activeTurns: 0,
    capabilities: { conversations: true, pagination: true, queue: true, goals: true, skills: true, plan: true, review: true, historyRevert: true } };
  const models: CodexModelCatalog = { backend: 'codex-cli', connected: true, models: ['native-pane-model'], catalog: [{
    id: 'native-pane-catalog-id', model: 'native-pane-model', displayName: 'Native layout fixture', description: 'Read-only metadata for site layout verification.',
    hidden: false, supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'Native fixture effort' }], defaultReasoningEffort: 'high', inputModalities: ['text'], isDefault: true,
  }] };
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== 'GET' && (path.startsWith('/api/threads') || path === '/api/codex/runtime/update')) {
      writes.push(`${request.method()} ${path}`);
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'The pane layout test does not authorize agent execution.' }) });
    }
    if (request.method() !== 'GET') return route.continue();
    if (path === '/api/codex/runtime') return route.fulfill({ json: runtime });
    if (path === '/api/models') return route.fulfill({ json: models });
    if (path === '/api/threads') return route.fulfill({ json: { items: [], olderCursor: null, newerCursor: null, hasOlder: false, hasNewer: false } });
    if (path === '/api/settings') {
      const response = await route.fetch();
      if (!response.ok()) return route.fulfill({ response });
      return route.fulfill({ response, json: { ...await response.json(), model: 'native-pane-model', reasoningEffort: null,
        reasoningSummary: null, verbosity: null, agentConfigured: true } });
    }
    return route.continue();
  });
}
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'wait' }); expect(agentWrites.get(page) ?? []).toEqual([]); });

async function prepare(page: Page, width: number, height: number, profile: UiLayoutProfile, split: boolean) {
  await page.setViewportSize({ width, height });
  expect((await page.request.post('/api/session', { headers, data: { password } })).status()).toBe(200);
  const created = await page.request.post('/api/workspaces', { headers, data: { name: `Agent toggle ${profile} ${Date.now()}` } });
  expect(created.status()).toBe(201);
  const workspace = await created.json() as Workspace;
  expect((await page.request.patch(`/api/workspaces/${workspace.id}`, { headers, data: { active: true } })).ok()).toBe(true);
  expect((await page.request.post(`/api/workspaces/${workspace.id}/files`, { headers, data: { path: 'toggle.ts', kind: 'file' } })).ok()).toBe(true);
  expect((await page.request.put(`/api/workspaces/${workspace.id}/file`, { headers, data: { path: 'toggle.ts', content: original } })).ok()).toBe(true);
  const saved = await (await page.request.get('/api/ui-state')).json() as UiState;
  expect((await page.request.patch('/api/ui-state', { headers, data: { revision: saved.revision, changes: [
    // Reproduce the bug even when the editor is the selected view in a split.
    { section: 'layout', profile, key: 'view', value: split ? 'editor' : 'agent' },
    { section: 'layout', profile, key: 'split', value: split ? 'split' : 'focus' },
  ] } })).ok()).toBe(true);
  await nativeReadMetadata(page);
  await page.goto('/work');
  await expect(page.locator('.app-shell')).toBeVisible();
  // Source-backed test servers may compile lazy panes on the first visit.
  // Begin the unchanged layout assertions only after those panes are ready.
  await expect(page.locator('#agent-workbench .chat-panel')).toBeVisible({ timeout: 45_000 });
  if (split) await expect(page.locator('#editor-workbench').getByRole('treeitem', { name: 'toggle.ts', exact: true })).toBeVisible({ timeout: 45_000 });
  return workspace;
}

async function savedLayout(page: Page, profile: UiLayoutProfile) {
  return ((await (await page.request.get('/api/ui-state')).json()) as UiState).layouts[profile];
}

for (const viewport of [
  { width: 1440, height: 960, profile: 'desktop' as const },
  { width: 1280, height: 850, profile: 'laptop' as const },
]) {
  test(`${viewport.profile} Agent icon hides and restores live panes, retains drafts and editor buffers, and restores its saved layout`, async ({ page }) => {
    const errors: string[] = [];
    const terminalSockets: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('websocket', socket => { if (socket.url().includes('/ws/terminal')) terminalSockets.push(socket.url()); });
    const workspace = await prepare(page, viewport.width, viewport.height, viewport.profile, true);
    const rail = page.getByRole('navigation', { name: 'Main navigation', exact: true });
    const toggle = rail.getByRole('button', { name: 'Agent', exact: true });
    const agent = page.locator('#agent-workbench');
    const editor = page.locator('#editor-workbench');
    const draft = agent.locator('.chat-composer textarea');
    await expect(agent).toBeVisible(); await expect(editor).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await editor.getByRole('treeitem', { name: 'toggle.ts', exact: true }).click();
    const input = editor.locator('.monaco-editor textarea.inputarea').first();
    await expect(input).toBeVisible();
    await input.focus(); await page.keyboard.press('ControlOrMeta+KeyA');
    const unsaved = 'export const value = "retained while Codex is hidden";\n';
    await page.keyboard.insertText(unsaved);
    await expect(page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
    await draft.fill('Keep this unsent conversation draft.');
    const conversationNode = await agent.locator('.chat-panel').elementHandle();
    const editorNode = await editor.locator('.monaco-editor').first().elementHandle();

    await rail.getByRole('button', { name: 'Terminal', exact: true }).click();
    const terminal = page.locator('.terminal-dock');
    const terminalSurface = terminal.locator('.terminal-surface:not([hidden])');
    await expect(terminalSurface).toHaveAttribute('data-connection', 'connected');
    const terminalNode = await terminalSurface.elementHandle();
    expect(terminalSockets).toHaveLength(1);

    await toggle.click();
    await expect(agent).toBeHidden(); await expect(editor).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).not.toHaveClass(/active/);
    await expect(terminal).toBeVisible();
    await expect(draft).toHaveValue('Keep this unsent conversation draft.');
    expect(await conversationNode!.evaluate(node => node.isConnected)).toBe(true);
    expect(await editorNode!.evaluate(node => node.isConnected)).toBe(true);
    expect(await terminalNode!.evaluate(node => node.isConnected)).toBe(true);
    await expect(editor.locator('.view-lines').first()).toContainText('retained while Codex is hidden');
    await expect.poll(() => savedLayout(page, viewport.profile)).toMatchObject({ view: 'editor', split: 'focus' });

    await toggle.click();
    await expect(agent).toBeVisible(); await expect(editor).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveClass(/active/);
    await expect(draft).toHaveValue('Keep this unsent conversation draft.');
    expect(await editorNode!.evaluate(node => node.isConnected)).toBe(true);
    expect(await terminalNode!.evaluate(node => node.isConnected)).toBe(true);
    expect(terminalSockets).toHaveLength(1);
    const [left, centre] = await Promise.all([agent.boundingBox(), editor.boundingBox()]);
    expect(left!.x + left!.width).toBeLessThanOrEqual(centre!.x + 1);
    await expect(editor.locator('.editor-sidebar')).toBeVisible();
    expect((await (await page.request.get(`/api/workspaces/${workspace.id}/file`, { params: { path: 'toggle.ts' } })).json()).content).toBe(original);

    // Commands remain repeatable navigation; the rail controls pane visibility.
    await toggle.click();
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.keyboard.press('ControlOrMeta+KeyK');
      const commands = page.getByRole('dialog', { name: 'Go anywhere', exact: true });
      await commands.getByRole('combobox', { name: 'Search actions', exact: true }).fill('Go to agent');
      await commands.getByRole('option', { name: 'Go to agent', exact: true }).click();
      await expect(agent).toBeVisible(); await expect(editor).toBeHidden();
    }
    await toggle.click(); await expect(agent).toBeHidden();
    await toggle.click(); await expect(agent).toBeVisible(); await expect(editor).toBeVisible();
    await expect(draft).toHaveValue('Keep this unsent conversation draft.');

    await page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await draft.fill('');
    await toggle.click();
    await expect.poll(() => savedLayout(page, viewport.profile)).toMatchObject({ view: 'editor', split: 'focus' });
    await page.reload();
    await expect(agent).toBeHidden(); await expect(editor).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(editor.getByRole('tab', { name: 'toggle.ts', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(editor.locator('.view-lines').first()).toContainText('retained while Codex is hidden');
    await toggle.click();
    await expect.poll(() => savedLayout(page, viewport.profile)).toMatchObject({ view: 'agent', split: 'split' });
    await page.reload();
    await expect(agent).toBeVisible(); await expect(editor).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
  });
}

test('tablet main-rail Agent toggles between Codex and Editor without losing the unsent draft', async ({ page }) => {
  await prepare(page, 820, 1180, 'tablet', false);
  const agent = page.locator('#agent-workbench');
  const editor = page.locator('#editor-workbench');
  const toggle = page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('button', { name: 'Agent', exact: true });
  const draft = agent.locator('.chat-composer textarea');
  await draft.fill('Tablet draft stays here.');
  await toggle.click();
  await expect(agent).toBeHidden(); await expect(editor).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(agent).toBeVisible(); await expect(editor).toBeHidden();
  await expect(draft).toHaveValue('Tablet draft stays here.');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => savedLayout(page, 'tablet')).toMatchObject({ view: 'agent', split: 'focus' });
});

test('phone Agent remains ordinary bottom navigation when tapped repeatedly', async ({ page }) => {
  await prepare(page, 390, 844, 'mobile', false);
  const navigation = page.getByRole('navigation', { name: 'Mobile navigation', exact: true });
  const button = navigation.getByRole('button', { name: 'Agent', exact: true });
  const agent = page.locator('#agent-workbench');
  const editor = page.locator('#editor-workbench');
  const draft = agent.locator('.chat-composer textarea');
  await draft.fill('Phone draft is still here.');
  await button.click(); await button.click();
  await expect(agent).toBeVisible(); await expect(editor).toBeHidden();
  expect(await button.getAttribute('aria-pressed')).toBeNull();
  await navigation.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(editor).toBeVisible();
  await button.click(); await button.click();
  await expect(agent).toBeVisible(); await expect(editor).toBeHidden();
  await expect(draft).toHaveValue('Phone draft is still here.');
  await expect.poll(() => savedLayout(page, 'mobile')).toMatchObject({ view: 'agent', split: 'focus' });
});
