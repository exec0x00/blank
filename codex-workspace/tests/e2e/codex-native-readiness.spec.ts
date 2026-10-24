import { expect, test, type APIResponse, type Page, type Route } from '@playwright/test';
import type { AppSettings, CodexModelCatalog, CodexRuntimeStatus, UiState, Workspace } from '../../shared/types';

const password = process.env.PLAYWRIGHT_PASSWORD || 'browser-test-workspace-password';
const headers = { 'X-Codex-Workspace': '1' };
const DEFAULT_MODEL = 'native-readiness/default', OTHER_MODEL = 'native-readiness/other';
type NativePreferences = Pick<AppSettings, 'model' | 'reasoningEffort' | 'reasoningSummary' | 'verbosity' | 'webSearchMode' | 'autoApprove' | 'agentConfigured'>;
const preferences = (model = DEFAULT_MODEL): NativePreferences => ({ model, reasoningEffort: 'high', reasoningSummary: 'auto', verbosity: null,
  webSearchMode: undefined, autoApprove: false, agentConfigured: !!model });
function status(state: CodexRuntimeStatus['state']): CodexRuntimeStatus {
  return { backend: 'codex-cli', state, version: state === 'ready' ? '0.155.1' : null, installedVersion: state === 'ready' ? '0.155.1' : null,
    startedAt: null, updatedAt: '2026-09-22T15:00:00Z', canUpdate: state === 'ready', updateBlockedReason: null, error: null, activeTurns: 0,
    capabilities: { conversations: true, pagination: true, queue: true, goals: true, skills: true, plan: true, review: true, historyRevert: true } };
}
function catalog(ready: boolean): CodexModelCatalog {
  const data = [['catalog-first-decoy', 'native-readiness/first-decoy', 'First catalog entry'], ['catalog-default', DEFAULT_MODEL, 'Installed Codex default'], ['catalog-other', OTHER_MODEL, 'New session model']];
  return { backend: 'codex-cli', connected: ready, models: ready ? data.map(row => row[1]) : [], catalog: ready ? data.map(([id, model, displayName]) => ({
    id, model, displayName, description: 'Native metadata fixture; no model request is made.', hidden: false,
    supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'More reasoning' }, { reasoningEffort: 'low', description: 'Less reasoning' }],
    defaultReasoningEffort: 'high', inputModalities: ['text'], isDefault: model === DEFAULT_MODEL,
  })) : [] };
}
const reply = (route: Route, value: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
let pendingReleases: Array<() => void> = [];
test.beforeEach(() => { pendingReleases = []; });
test.afterEach(async ({ page }) => { for (const release of pendingReleases) release(); await page.unrouteAll({ behavior: 'wait' }); });
function deferred() {
  let release!: () => void, arrive!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; }), arrived = new Promise<void>(resolve => { arrive = resolve; });
  pendingReleases.push(release); return { pending, arrived, release, arrive };
}

/** Actual App, session, workspace, appearance persistence and server assets.
 * Only native runtime/config/catalog/list metadata is controlled at HTTP edges.
 * No native turn, model answer, installation or provider call is simulated. */
async function prepare(page: Page, installing = false) {
  await page.setViewportSize({ width: 1440, height: 960 });
  expect((await page.request.post('/api/session', { headers, data: { password } })).status()).toBe(200);
  expect((await page.request.patch('/api/settings', { headers, data: { fontSize: 13, wordWrap: true } })).ok()).toBe(true);
  const created = await page.request.post('/api/workspaces', { headers, data: { name: `Native readiness ${Date.now()}`, initializeGit: false } });
  expect(created.status()).toBe(201); const workspace = await created.json() as Workspace;
  expect((await page.request.patch(`/api/workspaces/${workspace.id}`, { headers, data: { active: true } })).ok()).toBe(true);
  const saved = await (await page.request.get('/api/ui-state')).json() as UiState;
  expect((await page.request.patch('/api/ui-state', { headers, data: { revision: saved.revision, changes: [
    { section: 'layout', profile: 'desktop', key: 'view', value: 'agent' }, { section: 'layout', profile: 'desktop', key: 'split', value: 'focus' },
  ] } })).ok()).toBe(true);
  const control = { runtime: installing ? 'installing' as CodexRuntimeStatus['state'] : 'ready' as CodexRuntimeStatus['state'],
    bootstrap: preferences(installing ? '' : DEFAULT_MODEL), current: preferences(), reads: 0, runtimeReads: 0,
    patches: [] as Record<string, unknown>[], agentWrites: [] as string[], errors: [] as string[] };
  let settingsRead: ((route: Route, value: AppSettings, response: APIResponse) => Promise<unknown>) | undefined;
  page.on('pageerror', error => control.errors.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    if (method !== 'GET' && (path.startsWith('/api/threads') || path === '/api/codex/runtime/update' || path === '/api/model-probes')) {
      control.agentWrites.push(`${method} ${path}`);
      return route.fulfill({ status: 503, json: { error: 'Readiness verification does not authorize agent execution or installation.' } });
    }
    if (method === 'GET' && path === '/api/codex/runtime') { control.runtimeReads++; return reply(route, status(control.runtime)); }
    if (method === 'GET' && path === '/api/models') return reply(route, catalog(control.runtime === 'ready'));
    if (method === 'GET' && path === '/api/threads') return reply(route, { items: [], olderCursor: null, newerCursor: null, hasOlder: false, hasNewer: false });
    if (method === 'GET' && path.endsWith('/codex/skills')) return reply(route, { skills: [], errors: [] });
    if (method === 'GET' && path === '/api/bootstrap') {
      const response = await route.fetch(); if (!response.ok()) return route.fulfill({ response });
      const data = await response.json(); return route.fulfill({ response, json: { ...data, settings: { ...data.settings, ...control.bootstrap } } });
    }
    if (method === 'GET' && path === '/api/settings') {
      // Authorize through the real route before holding a previously authorized
      // response; later logout is allowed to race that response on the wire.
      const response = await route.fetch(); if (!response.ok()) return route.fulfill({ response });
      control.reads++; const value = { ...await response.json(), ...control.current } as AppSettings;
      return settingsRead ? settingsRead(route, value, response) : route.fulfill({ response, json: value });
    }
    if (method === 'PATCH' && path === '/api/settings') {
      const patch = request.postDataJSON() as Record<string, unknown>; control.patches.push(patch);
      const appearance = Object.fromEntries(Object.entries(patch).filter(([key]) => key === 'fontSize' || key === 'wordWrap'));
      // Appearance is persisted by the actual server. Native config choices are
      // metadata-only fixture responses; the test server never starts Codex.
      const response = Object.keys(appearance).length ? await route.fetch({ postData: appearance }) : await route.fetch({ method: 'GET', postData: undefined });
      if (!response.ok()) return route.fulfill({ response });
      const body = await response.json();
      control.current = { ...control.current, ...Object.fromEntries(Object.entries(patch).filter(([key]) => key !== 'fontSize' && key !== 'wordWrap')) };
      return route.fulfill({ response, json: { ...body, ...control.current } });
    }
    return route.continue();
  });
  return { control, workspace, onSettingsRead(handler: typeof settingsRead) { settingsRead = handler; },
    async open() { await page.goto('/work'); await expect(page.locator('.app-shell')).toBeVisible(); await expect(page.locator('#agent-workbench .chat-composer textarea')).toBeVisible(); },
    async refresh() { await page.evaluate(() => window.dispatchEvent(new CustomEvent('codex:runtime-changed'))); },
  };
}
const agentModel = (page: Page) => page.locator('#agent-workbench').getByRole('combobox', { name: 'Model', exact: true });
const settingsDialog = (page: Page) => page.getByRole('dialog', { name: 'Settings', exact: true });
async function openSettings(page: Page) { await page.getByRole('complementary', { name: 'Workspace navigation', exact: true }).getByRole('button', { name: 'Settings', exact: true }).click(); await expect(settingsDialog(page)).toBeVisible(); }
async function openSettingsCategory(page: Page, category: 'agent' | 'tools' | 'appearance') {
  const dialog = settingsDialog(page), picker = dialog.getByRole('combobox', { name: 'Settings category', exact: true });
  const labels = { agent: 'Model & responses', tools: 'Tools & permissions', appearance: 'Appearance' };
  if (await picker.isVisible()) {
    await picker.click();
    await page.getByRole('listbox', { name: 'Settings category', exact: true }).locator(`[role="option"][data-value="${category}"]`).click();
  } else await dialog.getByRole('button', { name: labels[category], exact: true }).click();
  await expect(dialog.locator(`#settings-panel-${category}`)).toBeVisible();
}
async function select(page: Page, name: string, value: string) {
  await settingsDialog(page).getByRole('combobox', { name, exact: true }).click();
  await page.locator(`[role="option"][data-value="${value}"]`).click();
}

test('App refreshes the actual native default after installation without opening Settings or replacing the draft', async ({ page }) => {
  const data = await prepare(page, true); await data.open();
  await expect.poll(() => data.control.runtimeReads).toBeGreaterThan(0); expect(data.control.reads).toBe(0);
  const draft = page.locator('#agent-workbench .chat-composer textarea'); await draft.fill('Keep the draft while Codex becomes ready.');
  await draft.evaluate(node => { (window as unknown as { readinessDraft?: Element }).readinessDraft = node; });
  await expect(agentModel(page)).toContainText('Choose a model'); await expect(settingsDialog(page)).toHaveCount(0);
  data.control.runtime = 'ready';
  await expect.poll(() => data.control.reads).toBeGreaterThan(0); await expect(agentModel(page)).toContainText('Installed Codex default');
  await expect(agentModel(page)).not.toContainText('First catalog entry');
  await expect(draft).toHaveValue('Keep the draft while Codex becomes ready.');
  expect(await draft.evaluate(node => (window as unknown as { readinessDraft?: Element }).readinessDraft === node)).toBe(true);
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled(); await expect(settingsDialog(page)).toHaveCount(0);
  expect(data.control.agentWrites).toEqual([]); expect(data.control.errors).toEqual([]);
});

test('a native readiness refresh cannot overwrite a newer successful appearance save', async ({ page }) => {
  const data = await prepare(page); await data.open(); await expect(agentModel(page)).toContainText('Installed Codex default');
  const held = deferred(); let completed!: () => void; const completedReply = new Promise<void>(resolve => { completed = resolve; });
  data.onSettingsRead(async (route, value, response) => { held.arrive(); await held.pending; try { await route.fulfill({ response, json: value }); } finally { completed(); } });
  await data.refresh(); await held.arrived; await openSettings(page); await openSettingsCategory(page, 'appearance');
  const size = settingsDialog(page).getByLabel('Editor font size', { exact: true }); await expect(size).toHaveValue('13'); await size.focus(); await size.press('ArrowRight');
  await settingsDialog(page).getByRole('button', { name: 'Save changes', exact: true }).click(); await expect(settingsDialog(page)).toHaveCount(0);
  expect((await (await page.request.get('/api/settings')).json()).fontSize).toBe(14);
  held.release(); await completedReply;
  await expect(page.locator('html')).toHaveCSS('--editor-font-size', '14px');
  await openSettings(page); await openSettingsCategory(page, 'appearance');
  await expect(settingsDialog(page).getByLabel('Editor font size', { exact: true })).toHaveValue('14');
  expect(data.control.patches).toEqual([{ fontSize: 14 }]); expect(data.control.agentWrites).toEqual([]); expect(data.control.errors).toEqual([]);
});

test('a readiness response from a previous real session cannot replace preferences after lock and unlock', async ({ page }) => {
  const data = await prepare(page, true), held = deferred(); let completed!: () => void;
  const completedReply = new Promise<void>(resolve => { completed = resolve; });
  data.control.runtime = 'ready';
  data.onSettingsRead(async (route, value, response) => { held.arrive(); await held.pending; try { await route.fulfill({ response, json: value }); } finally { completed(); } });
  await data.open(); await held.arrived;
  const draft = page.locator('#agent-workbench .chat-composer textarea'); await draft.fill('This draft survives the session transition.');
  await page.getByRole('complementary', { name: 'Workspace navigation', exact: true }).getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await expect(page.getByLabel('Workspace password', { exact: true })).toBeVisible();
  data.control.bootstrap = preferences(OTHER_MODEL); data.control.current = preferences(OTHER_MODEL); data.onSettingsRead(undefined);
  await page.getByLabel('Workspace password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible(); await expect(agentModel(page)).toContainText('New session model');
  held.release(); await completedReply;
  await expect(agentModel(page)).toContainText('New session model'); await expect(draft).toHaveValue('This draft survives the session transition.');
  expect((await (await page.request.get('/api/session')).json()).authenticated).toBe(true);
  expect(data.control.agentWrites).toEqual([]); expect(data.control.errors).toEqual([]);
});

test('Settings uses Codex default for absent web search and refreshes only untouched native and appearance fields', async ({ page }) => {
  const data = await prepare(page); await data.open(); await openSettings(page); await openSettingsCategory(page, 'tools');
  const dialog = settingsDialog(page); await expect(dialog.getByRole('combobox', { name: 'Web search', exact: true })).toContainText('Codex default');
  await expect(dialog.getByRole('combobox', { name: 'Default permissions', exact: true })).toContainText('On request');
  await select(page, 'Web search', 'live'); await openSettingsCategory(page, 'appearance');
  const font = dialog.getByLabel('Editor font size', { exact: true }); await font.focus(); await font.press('ArrowRight');
  expect((await page.request.patch('/api/settings', { headers, data: { fontSize: 18, wordWrap: false } })).ok()).toBe(true);
  data.control.current = { ...preferences(OTHER_MODEL), reasoningEffort: 'low', reasoningSummary: 'none', verbosity: 'medium', webSearchMode: 'cached', autoApprove: true };
  await data.refresh(); await expect.poll(() => data.control.reads).toBeGreaterThan(0);
  await expect(font).toHaveValue('14'); await expect(dialog.getByRole('switch', { name: 'Wrap long lines', exact: true })).toHaveAttribute('aria-checked', 'false');
  await openSettingsCategory(page, 'agent');
  await expect(dialog.getByRole('combobox', { name: 'Default model', exact: true })).toContainText('New session model');
  await expect(dialog.getByRole('combobox', { name: 'Reasoning effort', exact: true })).toContainText('Low');
  await expect(dialog.getByRole('combobox', { name: 'Public reasoning summary', exact: true })).toContainText('Off');
  await expect(dialog.getByRole('group', { name: 'Response detail', exact: true }).getByRole('button', { name: 'Balanced', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await openSettingsCategory(page, 'tools');
  await expect(dialog.getByRole('combobox', { name: 'Default permissions', exact: true })).toContainText('Full access');
  await expect(dialog.getByRole('combobox', { name: 'Web search', exact: true })).toContainText('Live search');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(data.control.patches).toEqual([{ webSearchMode: 'live', fontSize: 14 }]);
  expect((await (await page.request.get('/api/settings')).json()).fontSize).toBe(14);
  expect(data.control.agentWrites).toEqual([]); expect(data.control.errors).toEqual([]);
});
