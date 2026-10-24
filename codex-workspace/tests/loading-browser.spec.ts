import { expect, test, type Page, type Route } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import type { CodexModelCatalog, CodexRuntimeStatus, Thread, UiState, Workspace } from '../shared/types';

// The real app, session service and test-owned workspaces run. Native DTOs are
// explicit fixtures at their HTTP boundary; no CLI/provider/model call runs.
const headers = { 'X-Codex-Workspace': '1' };
const threadId = '0199a111-1111-7111-8111-111111111111';
const at = '2026-09-30T12:00:00.000Z';
const capabilities = { conversations: true, pagination: true, queue: true, goals: true, skills: true, plan: true, review: true, historyRevert: true };

function gate() {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  return { held, release };
}
async function signIn(page: Page) {
  expect((await page.request.post('/api/session', { headers, data: { password: 'loading-fixture-password' } })).status()).toBe(200);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
}
async function prepareConversation(page: Page, options: { holdThread?: ReturnType<typeof gate>; failure?: boolean } = {}) {
  await signIn(page);
  const create = await page.request.post('/api/workspaces', { headers, data: { name: 'Opening state fixture', initializeGit: false } });
  expect(create.status()).toBe(201);
  const workspace = await create.json() as Workspace;
  expect((await page.request.patch(`/api/workspaces/${workspace.id}`, { headers, data: { active: true } })).ok()).toBe(true);
  const saved = await (await page.request.get('/api/ui-state')).json() as UiState;
  expect((await page.request.patch('/api/ui-state', { headers, data: { revision: saved.revision, changes: [
    { section: 'layout', profile: 'desktop', key: 'view', value: 'agent' },
    { section: 'layout', profile: 'desktop', key: 'split', value: 'focus' },
  ] } })).ok()).toBe(true);
  const thread: Thread = { id: threadId, workspaceId: workspace.id, title: 'Saved loading fixture', backend: 'codex-cli', status: 'idle',
    createdAt: at, updatedAt: at, messages: [{ id: 'saved-user', role: 'user', createdAt: at,
      content: 'Saved transcript fixture. Keep this real displayed row during reconnect.' }], nativePage: { nextCursor: null, backwardsCursor: null },
    native: { model: 'loading-fixture-model', reasoningEffort: 'high', activeTurnId: null, approvals: [], questions: [], queue: [], queueCursor: null,
      goal: null, tokenUsage: null, diff: null, capabilities } };
  const runtime: CodexRuntimeStatus = { backend: 'codex-cli', state: 'ready', version: '0.159.2', installedVersion: '0.159.2', startedAt: at,
    updatedAt: at, canUpdate: true, updateBlockedReason: null, error: null, activeTurns: 0, capabilities };
  const models: CodexModelCatalog = { backend: 'codex-cli', connected: true, models: ['loading-fixture-model'], catalog: [{ id: 'loading-fixture-model',
    model: 'loading-fixture-model', displayName: 'Loading fixture model', description: 'Metadata fixture only.', hidden: false, isDefault: true,
    defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'High' }], inputModalities: ['text'] }] };
  const reads = { thread: 0, list: 0 };
  const controls = { threadGate: options.holdThread, listGate: undefined as ReturnType<typeof gate> | undefined, fail: !!options.failure };
  await page.addInitScript(() => {
    const Original = window.EventSource;
    class SavedSource extends EventTarget {
      static OPEN = 1; static CONNECTING = 0;
      readyState = 0; onmessage = null; onerror = null; onopen: (() => void) | null = null;
      constructor(readonly url: string) { super(); setTimeout(() => { if (this.readyState !== 2) { this.readyState = 1; this.onopen?.(); } }, 0); }
      close() { this.readyState = 2; }
    }
    window.EventSource = new Proxy(Original, { construct(target, args) {
      return String(args[0]).includes('/api/threads/') ? new SavedSource(String(args[0])) : Reflect.construct(target, args);
    } });
  });
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    if (path === '/api/codex/runtime') return route.fulfill({ json: runtime });
    if (path === '/api/models') return route.fulfill({ json: models });
    if (path === '/api/settings' && method === 'GET') {
      const response = await route.fetch();
      return route.fulfill({ response, json: { ...await response.json(), model: models.models[0], reasoningEffort: 'high', agentConfigured: true } });
    }
    if (path === '/api/threads' && method === 'GET') {
      reads.list++; await controls.listGate?.held;
      return route.fulfill({ json: url.searchParams.get('archived') === 'archived' ? [] : [thread] });
    }
    if (path.startsWith('/api/threads/')) {
      if (method !== 'GET') return route.fulfill({ status: 409, json: { error: 'This loading fixture never runs a model.' } });
      if (path.endsWith('/agents')) return route.fulfill({ json: [] });
      if (path.endsWith('/queue')) return route.fulfill({ json: { items: [], nextCursor: null } });
      if (path.endsWith('/goal')) return route.fulfill({ json: { goal: null } });
      reads.thread++; await controls.threadGate?.held;
      return controls.fail ? route.fulfill({ status: 400, json: { error: 'The saved conversation could not open. Fixture failure.' } }) : route.fulfill({ json: thread });
    }
    return route.continue();
  });
  await page.goto(`/work?workspace=${workspace.id}&thread=${threadId}&view=agent`);
  return { workspace, thread, reads, controls };
}

for (const width of [1440, 800, 390, 320]) {
  test(`${width}px minimal workspace boot screen keeps phase status accessible and resolves on the actual response`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: width === 320 ? 'reduce' : 'no-preference' });
    await signIn(page);
    const held = gate();
    await page.route('**/api/bootstrap', async route => { await held.held; await route.continue(); });
    try {
      await page.goto('/work');
      const opening = page.locator('.arc-workspace-opening');
      await expect(opening).toBeVisible();
      const boot = opening.locator('.arc-opening-boot'), track = opening.locator('.arc-opening-track');
      await expect(boot).toHaveAttribute('aria-busy', 'true');
      await expect(opening.getByRole('status')).toContainText('Opening your workspace');
      await expect(opening.getByRole('status')).toHaveCSS('clip-path', 'inset(50%)');
      await expect(track).toHaveAttribute('aria-hidden', 'true');
      await expect(opening.locator('header, h1, .arc-skeleton, .arc-opening-preview, button, a, input, textarea, [tabindex], [aria-valuenow]')).toHaveCount(0);
      await expect(track.locator('span')).toHaveCSS('animation-name', width === 320 ? 'none' : 'arc-boot-progress');
      await expect(opening).toHaveCSS('background-color', 'rgb(0, 0, 0)');
      const markBox = (await opening.getByRole('img', { name: 'Arc Workspace', exact: true }).boundingBox())!;
      const bootBox = (await boot.boundingBox())!, trackBox = (await track.boundingBox())!;
      expect(markBox.width).toBe(56); expect(trackBox.width).toBe(144); expect(trackBox.height).toBe(3);
      expect(bootBox.x + bootBox.width / 2).toBeCloseTo(width / 2, 0);
      expect(bootBox.y + bootBox.height / 2).toBeCloseTo(844 / 2, 0);
      expect(trackBox.y).toBeGreaterThan(markBox.y + markBox.height);
      await noOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`boot-opening-${width}.png`) });
    } finally { held.release(); }
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.locator('.arc-workspace-opening')).toHaveCount(0);
  });
}

test('bootstrap read failures show a concise retry instead of an indefinitely moving boot track', async ({ page }, testInfo) => {
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/bootstrap', route => route.fulfill({ status: 503, json: { error: 'The saved workspace could not be read. Please try again.' } }));
  await page.goto('/work');
  const boot = page.locator('.arc-opening-boot');
  await expect(boot.getByRole('alert')).toContainText('The saved workspace could not be read.');
  await expect(boot).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.arc-opening-track')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '14px');
  const retry = boot.getByRole('button', { name: 'Try again', exact: true });
  expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await retry.focus(); await expect(retry).toBeFocused();
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('boot-read-error-phone.png') });
  await page.unroute('**/api/bootstrap');
  await retry.press('Enter');
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('.arc-workspace-opening')).toHaveCount(0);
});

test('first conversation load is a skeleton, while refresh preserves the same transcript node, draft, focus and scroll', async ({ page }, testInfo) => {
  const first = gate();
  const fixture = await prepareConversation(page, { holdThread: first });
  try {
    const loading = page.locator('#agent-workbench [data-loading="conversation"]');
    await expect(loading).toBeVisible();
    await expect(loading.getByRole('status')).toHaveText('Opening your conversation…');
    await expect(page.getByRole('article', { name: 'Assistant response' })).toHaveCount(0);
    await expect(loading.locator('button, input, textarea, [tabindex]')).toHaveCount(0);
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath('conversation-opening.png') });
  } finally { first.release(); fixture.controls.threadGate = undefined; }
  const message = page.getByText(fixture.thread.messages[0].content, { exact: true });
  await expect(message).toBeVisible();
  await expect(page.locator('#agent-workbench [data-loading="conversation"]')).toHaveCount(0);
  const composer = page.locator('.chat-composer textarea');
  await expect(composer).toBeEnabled();
  await composer.fill('Unsent draft stays here during reconnect.');
  const before = await message.boundingBox();
  await message.evaluate(element => { (window as unknown as { heldMessage: Element }).heldMessage = element; });
  const refresh = gate(); fixture.controls.threadGate = refresh; fixture.controls.listGate = refresh;
  const reads = fixture.reads.thread;
  try {
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => fixture.reads.thread).toBeGreaterThan(reads);
    await expect(message).toBeVisible();
    await expect(page.locator('#agent-workbench [data-loading="conversation"]')).toHaveCount(0);
    await expect(composer).toHaveValue('Unsent draft stays here during reconnect.');
    await expect(composer).toBeFocused();
    expect(await message.evaluate(element => element === (window as unknown as { heldMessage: Element }).heldMessage)).toBe(true);
    expect((await message.boundingBox())!.y).toBeCloseTo(before!.y, 0);
  } finally { refresh.release(); fixture.controls.threadGate = undefined; fixture.controls.listGate = undefined; }
});

test('failed conversation loading shows the actual retry error and no indefinitely animated skeleton', async ({ page }) => {
  const fixture = await prepareConversation(page, { failure: true });
  await expect(page.getByRole('alert').filter({ hasText: 'Fixture failure.' })).toBeVisible();
  await expect(page.locator('#agent-workbench [data-loading="conversation"]')).toHaveCount(0);
  fixture.controls.fail = false;
  await page.getByRole('button', { name: 'Reload conversation', exact: true }).click();
  await expect(page.getByText(fixture.thread.messages[0].content, { exact: true })).toBeVisible();
  await expect(page.locator('#agent-workbench [data-loading="conversation"]')).toHaveCount(0);
});

test('empty conversation history has a scoped skeleton and keeps search focus when results resolve', async ({ page }) => {
  const fixture = await prepareConversation(page);
  await expect(page.getByText(fixture.thread.messages[0].content, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Conversation history', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Conversations', exact: true });
  await expect(dialog.getByRole('button', { name: 'Saved loading fixture', exact: false })).toBeVisible();
  const held = gate(); fixture.controls.listGate = held;
  try {
    await dialog.getByRole('button', { name: 'Archived', exact: true }).click();
    const search = dialog.getByRole('searchbox', { name: 'Search conversations', exact: true });
    await search.focus();
    await expect(dialog.locator('[data-loading="list"]')).toBeVisible();
    await expect(dialog.locator('[data-loading="list"] button')).toHaveCount(0);
    await expect(search).toBeFocused();
  } finally { held.release(); fixture.controls.listGate = undefined; }
  await expect(dialog.getByText('No archived conversations', { exact: true })).toBeVisible();
  await expect(dialog.locator('[data-loading="list"]')).toHaveCount(0);
  await expect(dialog.getByRole('searchbox', { name: 'Search conversations', exact: true })).toBeFocused();
});

test('workspace selection keeps existing panes while its real mutation is pending', async ({ page }) => {
  const fixture = await prepareConversation(page);
  const message = page.getByText(fixture.thread.messages[0].content, { exact: true });
  await expect(message).toBeVisible();
  const created = await page.request.post('/api/workspaces', { headers, data: { name: 'Next opening fixture', initializeGit: false } });
  const next = await created.json() as Workspace;
  const held = gate();
  const holdSelection = async (route: Route) => { if (route.request().method() === 'PATCH') await held.held; await route.continue(); };
  await page.route(`**/api/workspaces/${next.id}`, holdSelection);
  try {
    await page.getByRole('button', { name: /Switch workspace\. Current workspace:/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Your workspaces', exact: true });
    await dialog.locator('.workspace-select').filter({ hasText: 'Next opening fixture' }).click();
    await expect(page.locator('.topbar-workspace')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('main[aria-label="Workspace"]')).toHaveAttribute('aria-busy', 'true');
    await expect(message).toBeAttached();
    await expect(page.locator('.arc-workspace-opening')).toHaveCount(0);
  } finally { held.release(); }
  await expect(page.locator('.topbar-workspace > span')).toHaveText('Next opening fixture');
  await expect(page.locator('.topbar-workspace')).not.toHaveAttribute('aria-busy', 'true');
});

test('bootstrap startup page preserves truthful readiness, minimal layout, reduced motion and real failure retry', async ({ page }, testInfo) => {
  // Capture responses from the actual Python status listener without starting
  // maintenance, a native runtime, or reading any persisted application state.
  const pages = JSON.parse(execFileSync('python3', ['-c', `
import importlib.util,json,sys,types,urllib.request,urllib.error
spaces=types.ModuleType('spaces'); spaces.GPU=lambda **kw: lambda fn: fn; sys.modules['spaces']=spaces
spec=importlib.util.spec_from_file_location('loading_bootstrap_fixture','app.py'); app=importlib.util.module_from_spec(spec); spec.loader.exec_module(app)
server=app.BootstrapServer('127.0.0.1',0); server.resume()
base='http://127.0.0.1:'+str(server.server.server_address[1])
def read(path):
 try: response=urllib.request.urlopen(base+path,timeout=2)
 except urllib.error.HTTPError as error: response=error
 with response: return {'status':response.status,'headers':dict(response.headers),'body':response.read().decode()}
try:
 server.set_phase('launching'); opening=read('/work'); root=read('/')
 server.set_phase('failed'); failed=read('/work')
 print(json.dumps({'opening':opening,'root':root,'failed':failed}))
finally: server.close()
`], { cwd: process.cwd(), encoding: 'utf8' })) as Record<'root' | 'opening' | 'failed', { status: number; headers: Record<string, string>; body: string }>;
  expect(pages.root.status).toBe(200); expect(pages.root.body).toBe('status: ok');
  expect(pages.opening.status).toBe(503); expect(pages.opening.headers['Retry-After']).toBe('3');
  let failed = false;
  await page.route('**/opening-fixture', route => route.fulfill({ status: 503, body: pages[failed ? 'failed' : 'opening'].body,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': pages.opening.headers['Content-Security-Policy'] } }));
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/opening-fixture');
  const boot = page.locator('.arc-opening-boot'), track = page.locator('.arc-opening-track');
  await expect(boot).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('img', { name: 'Arc Workspace', exact: true })).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await expect(page.locator('header, h1, a, .preview, [aria-valuenow]')).toHaveCount(0);
  await expect(track).toBeVisible();
  await expect(track).toHaveAttribute('aria-hidden', 'true');
  await expect(track.locator('span')).toHaveCSS('animation-name', 'arc-boot-progress');
  const desktopBoot = (await boot.boundingBox())!;
  expect(desktopBoot.x + desktopBoot.width / 2).toBeCloseTo(720, 0);
  expect(desktopBoot.y + desktopBoot.height / 2).toBeCloseTo(480, 0);
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('minimal-bootstrap-desktop.png') });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/opening-fixture');
  await expect(page.getByRole('status')).toContainText('Saved workspace state is being opened.');
  await expect(page.getByRole('status')).toHaveCSS('clip-path', 'inset(50%)');
  await expect(track.locator('span')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('meta[http-equiv="refresh"]')).toHaveAttribute('content', '3');
  expect((await track.boundingBox())!.height).toBe(3);
  const phoneBoot = (await boot.boundingBox())!;
  expect(phoneBoot.x + phoneBoot.width / 2).toBeCloseTo(160, 0);
  expect(phoneBoot.y + phoneBoot.height / 2).toBeCloseTo(422, 0);
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('minimal-bootstrap-phone.png') });
  failed = true;
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Workspace startup failed');
  await expect(boot).toHaveAttribute('aria-busy', 'false');
  await expect(track).toHaveCount(0);
  const retry = page.getByRole('link', { name: 'Try again', exact: true });
  expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await retry.focus(); await expect(retry).toBeFocused();
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('minimal-bootstrap-failure-phone.png') });
  failed = false;
  await retry.click();
  await expect(page.getByRole('status')).toContainText('Saved workspace state is being opened.');
  await expect(track).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
