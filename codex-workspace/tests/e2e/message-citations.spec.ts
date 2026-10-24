import type { CodexCapabilities, CodexModel, CodexModelCatalog, CodexRuntimeStatus, CodexThreadState } from '../../shared/codex-cli';
import { expect, test, type Page } from '@playwright/test';
import type { AgentEvent, AppSettings, ChatMessage, FileTransferPage, Thread, WebCitation, Workspace, WorkspacePage } from '../../shared/types';
import { uiStateFixture } from './ui-state-fixture';
import { directoryPageFixture } from './directory-page-fixture';

// Preserved public source metadata and native Markdown links, delivered through
// explicit transport fixtures. Legacy conversations remain read-only; native
// items have no invented provider citation envelope or child scheduler.
test.use({ serviceWorkers: 'block' });
const sourceUrl = 'https://nodejs.org/docs/latest/api/globals.html?utm_source=openai';
const source: WebCitation = { url: sourceUrl, title: 'Global objects | Node.js v24.2.0 Documentation', startIndex: 91, endIndex: 172 };
const answer = 'Yes, `AbortSignal.timeout(delay)` returns a signal that aborts after `delay` milliseconds. ([nodejs.org](https://nodejs.org/docs/latest/api/globals.html?utm_source=openai))';
const now = '2026-09-19T16:00:00.000Z';
const capabilities: CodexCapabilities = { conversations: true, pagination: true, queue: true, goals: true, skills: true, plan: true, review: true, historyRevert: true };
const model: CodexModel = { id: 'fixture-cyber-catalog', model: 'gpt-5.6-cyber', displayName: 'Cyber fixture', description: 'Native model metadata fixture',
  hidden: false, isDefault: true, defaultReasoningEffort: 'max', inputModalities: ['text', 'image'], supportedReasoningEfforts: [{ reasoningEffort: 'max', description: 'Max' }] };
const catalog: CodexModelCatalog = { backend: 'codex-cli', connected: true, models: [model.model], catalog: [model] };
const runtime: CodexRuntimeStatus = { backend: 'codex-cli', state: 'ready', version: '0.155.1', installedVersion: '0.155.1',
  startedAt: now, updatedAt: now, canUpdate: true, updateBlockedReason: null, error: null, activeTurns: 0, capabilities };
const nativeState = (): CodexThreadState => ({ model: model.model, reasoningEffort: 'max', activeTurnId: null,
  approvals: [], questions: [], queue: [], queueCursor: null, goal: null, tokenUsage: null, diff: null, capabilities });
type FixtureSource = { url: string; readyState: number; onopen: ((event: Event) => void) | null; onmessage: ((event: MessageEvent) => void) | null; onerror: ((event: Event) => void) | null };
type FixtureWindow = Window & { __citationEvents: { sources: FixtureSource[]; emit: (id: string, event: unknown, sequence: string) => number } };
interface CitationRequest { method: string; path: string }

async function citationFixture(page: Page, delegated = false) {
  const preferences = uiStateFixture();
  const workspace: Workspace = { id: 'citation-workspace', name: 'Source workspace', path: '/data/workspaces/source', createdAt: now, updatedAt: now };
  const settings: AppSettings = { model: 'gpt-5.6-cyber', reasoningEffort: 'max', webSearchMode: 'cached', autoApprove: false, theme: 'dark', fontSize: 13, wordWrap: true, provider: 'openai', apiKeyConfigured: true, agentConfigured: true };
  const assistant: ChatMessage = { id: 'citation-assistant', role: 'assistant', content: answer, citations: [source], createdAt: now };
  const root: Thread = { id: delegated ? '0199a555-5555-7555-8555-555555555555' : 'thr_11111111111111111111111111111111', workspaceId: workspace.id,
    title: 'Check official documentation', createdAt: now, updatedAt: now, status: 'idle', backend: delegated ? 'codex-cli' : 'legacy', readOnly: !delegated,
    messages: [assistant], ...(delegated ? { native: nativeState(), nativePage: { nextCursor: null, backwardsCursor: null } } : {}) };
  const initialUi = { ...preferences.read(), revision: 1, workspaces: { [workspace.id]: { threadId: root.id } } };
  const threads = new Map([[root.id, root]]);
  const errors: string[] = [];
  const unexpected: string[] = [];
  const requests: CitationRequest[] = [];
  const navigations: Array<{ url: string; referer?: string }> = [];
  page.on('pageerror', error => errors.push(error.message));
  // Source pages are an explicit navigation boundary. Keeping this peer local
  // makes eager fetches observable without fetching external documentation.
  await page.context().route('https://nodejs.org/**', async route => {
    navigations.push({ url: route.request().url(), referer: route.request().headers().referer });
    await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Source navigation fixture</title><h1>Source document</h1>' });
  });
  let agent: Thread | undefined;
  if (delegated) {
    assistant.content = 'The native documentation task completed.'; delete assistant.citations;
    agent = { ...root, id: '0199a666-6666-7666-8666-666666666666', title: 'documentation', parentThreadId: root.id, rootThreadId: root.id,
      native: nativeState(), messages: [{ id: 'child-source-answer', role: 'assistant', content: answer, createdAt: now }] };
    threads.set(agent.id, agent);
  }
  await page.addInitScript(() => {
    const sources: FixtureSource[] = [];
    class CitationEventSource {
      static CONNECTING = 0; static OPEN = 1; static CLOSED = 2;
      CONNECTING = 0; OPEN = 1; CLOSED = 2;
      url: string; readyState = 0; withCredentials = true;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      constructor(url: string | URL) { this.url = String(url); sources.push(this); setTimeout(() => { if (this.readyState !== 2) { this.readyState = 1; this.onopen?.(new Event('open')); } }, 0); }
      close() { this.readyState = 2; }
      addEventListener() {} removeEventListener() {} dispatchEvent() { return true; }
    }
    window.EventSource = CitationEventSource as unknown as typeof EventSource;
    (window as unknown as FixtureWindow).__citationEvents = { sources, emit(id, event, sequence) {
      let delivered = 0;
      for (const source of sources) if (source.readyState === 1 && source.onmessage && source.url.includes(`/${id}/events`)) {
        source.onmessage(new MessageEvent('message', { data: JSON.stringify(event), lastEventId: sequence })); delivered++;
      }
      return delivered;
    } };
  });
  let sequence = 0;
  const waitForStream = async (threadId = root.id) => {
    if (!delegated) {
      await expect(page.getByText('Preserved conversation · Read only', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as FixtureWindow).__citationEvents.sources.length)).toBe(0);
      return;
    }
    await page.waitForFunction(id => (window as unknown as FixtureWindow).__citationEvents.sources.some(source => source.readyState === 1 && source.onmessage && source.url.includes(`/${id}/events`)), threadId);
  };
  const emit = async (event: Omit<AgentEvent, 'threadId'>, threadId = root.id) => {
    await waitForStream(threadId);
    const delivered = await page.evaluate(({ id, event, sequence }) => (window as unknown as FixtureWindow).__citationEvents.emit(id, { ...event, threadId: id }, sequence), { id: threadId, event, sequence: String(++sequence) });
    expect(delivered, 'The mounted App must have one active stream for the selected conversation.').toBe(1);
  };
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.slice('/api'.length);
    const method = route.request().method();
    requests.push({ method, path });
    if (await preferences.handle(route)) return;
    const respond = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/session') return respond({ authenticated: true });
    if (path === '/bootstrap') return respond({ workspaces: [workspace], activeWorkspaceId: workspace.id, settings, githubAccounts: [], uiState: initialUi, storage: { path: '/data', persistent: true, writable: true, bucket: 'fixture/data' } });
    if (path === '/workspaces' && route.request().method() === 'GET') {
      const limit = Number(url.searchParams.get('limit'));
      expect(Number.isSafeInteger(limit) && limit > 0 && limit <= 100, 'Workspace discovery must stay bounded.').toBe(true);
      return respond({ workspaces: [workspace], nextCursor: null, previousCursor: null, offset: 0, total: 1, revision: 'a'.repeat(64), selected: workspace } satisfies WorkspacePage);
    }
    if (path === `/workspaces/${workspace.id}` && route.request().method() === 'GET') return respond(workspace);
    if (path === `/workspaces/${workspace.id}/file-transfers/page` && route.request().method() === 'GET') {
      const limit = Number(url.searchParams.get('limit'));
      expect(Number.isSafeInteger(limit) && limit > 0 && limit <= 50, 'File operation history must stay bounded.').toBe(true);
      expect(url.searchParams.get('offset')).toBe('0');
      return respond({ items: [], offset: 0, limit, total: 0, hasMore: false } satisfies FileTransferPage);
    }
    if (path === '/codex/runtime') return respond(runtime);
    if (path === '/models') return respond(catalog);
    if (path === `/workspaces/${workspace.id}/codex/skills`) return respond({ skills: [], errors: [] });
    if (path.endsWith('/tree-page')) return respond(directoryPageFixture(new URL(route.request().url()), []));
    if (path === '/github/accounts' || path.endsWith('/terminals') || path.endsWith('/tree') || path.endsWith('/file-paths')) return respond([]);
    if (path.endsWith('/git/status')) return respond({ isRepository: false, branch: '', ahead: 0, behind: 0, files: [], branches: [] });
    if (path === '/threads') { const { messages: _messages, ...summary } = root; return respond(url.searchParams.get('backend') === root.backend ? [summary] : []); }
    const match = /^\/threads\/([^/]+)(?:\/(agents|goal|queue))?$/.exec(path);
    if (match && method === 'GET') {
      const thread = threads.get(match[1]);
      if (thread) {
        if (match[2] === 'agents') return respond([...threads.values()].filter(child => child.parentThreadId === thread.id));
        if (match[2] === 'goal') return respond({ goal: null });
        if (match[2] === 'queue') return respond({ items: [], nextCursor: null });
        return respond(thread);
      }
    }
    unexpected.push(path); return respond({ error: `Unexpected citation fixture route: ${path}` }, 404);
  });
  await page.goto('/work');
  const panel = page.getByRole('region', { name: 'Codex conversation', exact: true });
  await expect(panel).toBeVisible();
  await waitForStream();
  expect(requests).toContainEqual({ method: 'GET', path: '/bootstrap' });
  expect(requests).toContainEqual({ method: 'GET', path: `/threads/${root.id}` });
  return { panel, root, assistant, emit, waitForStream, errors, unexpected, requests, navigations, agent };
}

test('preserved source metadata survives reload, preserves Markdown, and opens safely by keyboard', async ({ page }) => {
  const fixture = await citationFixture(page);
  const response = fixture.panel.getByRole('article', { name: 'Assistant response', exact: true });
  const sources = response.getByRole('complementary', { name: 'Sources for this answer' });
  await expect(response).toBeVisible();
  await expect(fixture.panel.getByText('Preserved conversation · Read only', { exact: true })).toBeVisible();
  await expect(fixture.panel.getByRole('textbox', { name: 'Message Codex', exact: true })).toHaveCount(0);
  fixture.assistant.citations = [source, { ...source, startIndex: 0, endIndex: 3 },
    { url: 'http://127.0.0.1/private', title: 'UNSAFE_SOURCE_NOT_VISIBLE' }, { url: 'javascript:alert(1)', title: 'UNSAFE_SCRIPT_NOT_VISIBLE' }];
  await page.reload();
  await fixture.waitForStream();
  await expect(sources.getByRole('link')).toHaveCount(1);
  await expect(response.getByRole('link')).toHaveCount(2);
  await expect(response.getByText(/UNSAFE_SOURCE_NOT_VISIBLE|UNSAFE_SCRIPT_NOT_VISIBLE/)).toHaveCount(0);
  await expect(response.locator('.chat-markdown').getByRole('link', { name: 'nodejs.org', exact: true })).toHaveAttribute('href', sourceUrl);
  expect(fixture.navigations).toEqual([]);
  const link = sources.getByRole('link');
  await expect(link).toHaveAttribute('href', sourceUrl);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
  const popupPromise = page.waitForEvent('popup');
  await link.focus(); await page.keyboard.press('Enter');
  const popup = await popupPromise; await popup.waitForLoadState();
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  expect(fixture.navigations).toEqual([{ url: sourceUrl, referer: undefined }]);
  await popup.close();
  expect(fixture.requests.filter(request => request.method !== 'GET' && request.path !== '/ui-state')).toEqual([]);
  expect(fixture.errors).toEqual([]); expect(fixture.unexpected).toEqual([]);
});

test('source lists remain readable and touch accessible on narrow phones and desktop, with all sources reachable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const fixture = await citationFixture(page);
  fixture.assistant.content = `${answer} \uE200cite\uE202turn0search0\uE201`;
  fixture.assistant.citations = [source, ...Array.from({ length: 5 }, (_, index) => ({ url: `https://nodejs.org/docs/source-${index}`, title: `Reference ${index + 1}: ${'documentation '.repeat(30)}` }))];
  await page.reload(); await fixture.waitForStream();
  const sources = fixture.panel.getByRole('complementary', { name: 'Sources for this answer' });
  await expect(sources.getByRole('link')).toHaveCount(3);
  await expect(fixture.panel.getByText(/turn0search0/)).toHaveCount(0);
  const more = sources.getByRole('button', { name: 'Show 3 more sources' });
  await more.focus(); await page.keyboard.press('Enter');
  await expect(sources.getByRole('link')).toHaveCount(6);
  await expect(sources.getByRole('button', { name: 'Show fewer sources' })).toBeFocused();
  for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 1280, height: 800 }, { width: 1600, height: 960 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const geometry = await sources.locator('a, button').evaluateAll(nodes => nodes.map(node => { const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); return { width: rect.width, height: rect.height, left: rect.left, right: rect.right, shadow: style.boxShadow, backdrop: style.backdropFilter }; }));
    expect(geometry).toHaveLength(7);
    for (const item of geometry) { expect(item.height).toBeGreaterThanOrEqual(44); expect(item.width).toBeGreaterThanOrEqual(44); expect(item.left).toBeGreaterThanOrEqual(0); expect(item.right).toBeLessThanOrEqual(viewport.width); expect(item.shadow).toBe('none'); expect(item.backdrop).toBe('none'); }
    const controls = await sources.locator('a, button').all();
    await controls[0].focus();
    for (const [index, control] of controls.entries()) {
      if (index > 0) await page.keyboard.press('Tab');
      await expect(control).toBeFocused();
      await control.scrollIntoViewIfNeeded();
      expect(await control.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return !!hit && element.contains(hit);
      }), `Source control ${index + 1} must be reachable at ${viewport.width}px.`).toBe(true);
    }
    await sources.getByRole('link').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`citation-layout-${viewport.width}.png`), animations: 'disabled', fullPage: true });
  }
  await sources.getByRole('button', { name: 'Show fewer sources' }).click();
  await expect(sources.getByRole('link')).toHaveCount(3);
  expect(fixture.navigations).toEqual([]);
  expect(fixture.errors).toEqual([]); expect(fixture.unexpected).toEqual([]);
});

test('native child answers keep their actual Markdown sources inspectable inside the conversation', async ({ page }) => {
  const fixture = await citationFixture(page, true);
  const task = fixture.panel.getByRole('article', { name: 'Subagent documentation', exact: true });
  await expect(task).toBeVisible();
  const switchAgent = task.getByRole('button', { name: 'Switch to agent documentation', exact: true });
  await switchAgent.focus(); await page.keyboard.press('Enter');
  await fixture.waitForStream(fixture.agent!.id);
  await expect(fixture.panel.getByRole('button', { name: 'Conversation history', exact: true })).toHaveAttribute('aria-description', 'documentation');
  const response = fixture.panel.getByRole('region', { name: 'Conversation messages', exact: true }).getByRole('article', { name: 'Assistant response', exact: true });
  const link = response.getByRole('link', { name: 'nodejs.org', exact: true });
  await expect(response.getByText('AbortSignal.timeout(delay)', { exact: true })).toBeVisible();
  await expect(response.getByRole('complementary', { name: 'Sources for this answer' })).toHaveCount(0);
  await expect(link).toHaveAttribute('href', sourceUrl);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
  expect(fixture.requests).toContainEqual({ method: 'GET', path: `/threads/${fixture.root.id}/agents` });
  expect(fixture.requests).toContainEqual({ method: 'GET', path: `/threads/${fixture.agent!.id}` });
  await expect(page.getByRole('tab', { name: /Agents/ })).toHaveCount(0);
  await fixture.panel.getByRole('button', { name: 'Parent agent', exact: true }).focus(); await page.keyboard.press('Enter');
  await fixture.waitForStream();
  await expect(response).toContainText('The native documentation task completed.');
  await expect(link).toBeHidden();
  await switchAgent.focus(); await page.keyboard.press('Enter');
  await fixture.waitForStream(fixture.agent!.id);
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', sourceUrl);
  expect(fixture.navigations).toEqual([]);
  const popupPromise = page.waitForEvent('popup');
  await link.focus(); await page.keyboard.press('Enter');
  const popup = await popupPromise; await popup.waitForLoadState();
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  expect(fixture.navigations).toEqual([{ url: sourceUrl, referer: undefined }]);
  await popup.close();
  expect(fixture.requests.filter(request => request.method !== 'GET' && request.path !== '/ui-state')).toEqual([]);
  expect(fixture.errors).toEqual([]); expect(fixture.unexpected).toEqual([]);
});
