import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import type { NativeProcessSession, NativeBackgroundTerminal } from '../shared/native-processes';

const origin = 'http://native-processes.test';
const threadId = '01990000-0000-7000-8000-000000000001';
type FixtureWindow = Window & { nativeTasksFixture: {
  scope(workspace: string, thread?: string): void; active(value: boolean): void; lock(): void; unlock(): void;
  state(): { changed: string[]; aborted: boolean[] };
} };
interface CapturedRequest { path: string; query: string; method: string; body: Record<string, unknown> | null; marker?: string }
interface HttpState {
  sessions: NativeProcessSession[];
  requests: CapturedRequest[];
  listFailure: boolean;
  actionFailure?: string;
  holdStart: boolean;
  held: Array<() => void>;
  background: NativeBackgroundTerminal[];
}
let script = '', styles = '';
test.beforeAll(async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const result = await build({ absWorkingDir: root, entryPoints: ['tests/native-processes-browser-fixture.tsx'],
    bundle: true, write: false, outfile: 'fixture.js', platform: 'browser', format: 'iife', target: 'es2022', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent' });
  script = result.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  styles = result.outputFiles.find(file => file.path.endsWith('.css'))!.text + '\n.fixture-native-task-body{padding:24px;overflow:auto;min-height:0}.modal{max-width:760px}';
});

async function fixture(page: Page, patch: Partial<HttpState> = {}) {
  const state: HttpState = { sessions: [], requests: [], listFailure: false, holdStart: false, held: [], background: [
    { itemId: 'native-item-one', processId: '42', command: 'python3 -m http.server', cwd: '/workspace/one', osPid: 123, cpuPercent: 0.2, rssKb: '2048' },
  ], ...patch };
  await page.route(origin + '/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en" data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>' });
    if (path === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: script });
    if (path === '/fixture.css') return route.fulfill({ contentType: 'text/css', body: styles });
    const body = request.postData() ? request.postDataJSON() as Record<string, unknown> : null;
    state.requests.push({ path, query: url.search, method, body, marker: request.headers()['x-codex-workspace'] });
    const workspace = /^\/api\/workspaces\/([^/]+)/.exec(path)?.[1];
    if (path.endsWith('/native/processes') && method === 'GET') return route.fulfill({ status: state.listFailure ? 503 : 200,
      json: state.listFailure ? { error: 'Native task status is temporarily unavailable.' } : {
        sessions: state.sessions.filter(session => session.workspaceId === workspace), generation: 'fixture-generation', maxActive: 4,
        capabilities: { command: true, process: true, shell: true, background: true },
      } });
    if (path.endsWith('/native/processes') && method === 'POST') {
      if (state.actionFailure) return route.fulfill({ status: 409, json: { error: state.actionFailure } });
      const id = `12345678-1234-4123-8123-${String(state.sessions.length + 1).padStart(12, '0')}`;
      const session: NativeProcessSession = { id, workspaceId: workspace!, generation: 'fixture-generation', command: String(body!.command),
        kind: body!.kind as 'command' | 'process', tty: body!.tty === true, state: 'running', stdinOpen: true, rows: 24, cols: 100,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), exitCode: null, error: null, outputLimited: false, latestSequence: 1 };
      state.sessions.push(session);
      if (state.holdStart) await new Promise<void>(resolve => state.held.push(resolve));
      try { return await route.fulfill({ status: 202, json: session }); } catch { return; }
    }
    const selected = state.sessions.find(session => path.includes(`/processes/${session.id}`));
    if (selected && path.endsWith('/output')) {
      const after = Number(url.searchParams.get('after') || '0');
      return route.fulfill({ json: { session: selected, chunks: after < 1 ? [{ sequence: 1, stream: 'stdout', text: `ready: ${selected.command}\n` }] : [],
        nextSequence: 1, oldestSequence: 1, latestSequence: 1, hasMore: false, truncatedBefore: false } });
    }
    if (selected && path.endsWith('/input')) { if (body!.closeStdin) selected.stdinOpen = false; return route.fulfill({ json: selected }); }
    if (selected && path.endsWith('/resize')) { selected.rows = Number(body!.rows); selected.cols = Number(body!.cols); return route.fulfill({ json: selected }); }
    if (selected && path.endsWith('/stop')) { selected.state = 'exited'; selected.exitCode = 0; selected.stdinOpen = false; return route.fulfill({ json: selected }); }
    if (selected && method === 'DELETE') { state.sessions = state.sessions.filter(value => value !== selected); return route.fulfill({ json: { removed: true } }); }
    if (path.endsWith('/native/shell')) return route.fulfill({ status: 202, json: { accepted: true, threadId, generation: 'fixture-generation' } });
    if (path.endsWith('/background-terminals') && method === 'GET') return route.fulfill({ json: { data: state.background, nextCursor: null, generation: 'fixture-generation' } });
    if (path.endsWith('/background-terminals/stop-all')) { state.background = []; return route.fulfill({ json: { requested: true } }); }
    if (path.endsWith('/background-terminals/42/stop')) { state.background = state.background.filter(item => item.processId !== '42'); return route.fulfill({ json: { terminated: true } }); }
    return route.fulfill({ status: 404, json: { error: 'Unexpected task fixture route.' } });
  });
  await page.goto(origin);
  await expect(page.getByRole('dialog', { name: 'Tasks' })).toBeVisible();
  if (!state.listFailure) await expect(page.getByRole('combobox', { name: 'Task kind', exact: true })).toBeEnabled();
  return state;
}

test('runs an explicit command with multiline editing, ordered output, real input/resize and stop controls', async ({ page }) => {
  const state = await fixture(page), command = page.getByRole('textbox', { name: 'Command', exact: true });
  await command.fill('printf first'); await command.press('Enter'); await command.press('End'); await command.type('printf second');
  expect(state.requests.filter(request => request.method === 'POST')).toEqual([]);
  await page.getByRole('checkbox', { name: 'Interactive input (PTY)' }).check();
  await command.press('Control+Enter');
  await expect(page.getByLabel('Task output log')).toContainText('ready: printf first\nprintf second');
  const commandDetails = page.locator('.native-processes-command');
  await commandDetails.getByText('Full command', { exact: true }).click();
  await expect(commandDetails.locator('pre')).toHaveText('printf first\nprintf second');
  await expect(commandDetails.locator('pre')).toHaveCSS('white-space', 'pre-wrap');
  expect(state.requests.find(request => request.path.endsWith('/native/processes') && request.method === 'POST')?.body).toEqual({
    kind: 'command', command: 'printf first\nprintf second', tty: true, timeoutMs: 60000,
  });
  await page.getByRole('textbox', { name: 'Send input', exact: true }).fill('hello');
  await page.getByRole('button', { name: 'Send input', exact: true }).click();
  await expect.poll(() => state.requests.filter(request => request.path.endsWith('/input')).length).toBe(1);
  expect(state.requests.find(request => request.path.endsWith('/input'))?.body).toMatchObject({ text: 'hello\r', generation: 'fixture-generation' });
  await page.getByRole('spinbutton', { name: 'Columns', exact: true }).fill('120');
  await page.getByRole('spinbutton', { name: 'Rows', exact: true }).fill('31');
  await page.getByRole('button', { name: 'Resize input terminal', exact: true }).click();
  await expect.poll(() => state.requests.filter(request => request.path.endsWith('/resize')).length).toBe(1);
  expect(state.requests.find(request => request.path.endsWith('/resize'))?.body).toMatchObject({ rows: 31, cols: 120 });
  await page.getByRole('button', { name: 'Stop task', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Exited · 0' })).toBeVisible();
  await page.getByRole('button', { name: /Remove task printf first/ }).click();
  await expect(page.getByText('No tasks in this workspace.', { exact: true })).toBeVisible();
  expect(state.requests.filter(request => request.path.startsWith('/api/')).every(request => request.marker === '1')).toBe(true);
});

test('uses the native conversation command and exact selected background job controls', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('combobox', { name: 'Task kind', exact: true }).click();
  await page.getByRole('option', { name: /Conversation command/ }).click();
  await page.getByRole('textbox', { name: 'Command', exact: true }).fill('git status --short');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Follow its output in the conversation.' })).toBeVisible();
  expect(state.requests.find(request => request.path.endsWith('/native/shell'))).toMatchObject({
    path: `/api/workspaces/one/threads/${threadId}/native/shell`, body: { generation: 'fixture-generation', command: 'git status --short', timeoutMs: 60000 },
  });
  await page.getByRole('button', { name: 'Stop background task python3 -m http.server', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Background task terminated.' })).toBeVisible();
  expect(state.requests.find(request => request.path.endsWith('/background-terminals/42/stop'))?.body).toEqual({ generation: 'fixture-generation', itemId: 'native-item-one' });
  expect(state.sessions).toEqual([]);
});

test('aborts a pending launch on workspace change and refuses late response state or mutation replay', async ({ page }) => {
  const state = await fixture(page, { holdStart: true });
  await page.getByRole('textbox', { name: 'Command', exact: true }).fill('printf old-workspace');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect.poll(() => state.held.length).toBe(1);
  await page.evaluate(() => (window as unknown as FixtureWindow).nativeTasksFixture.scope('two'));
  state.holdStart = false; for (const release of state.held.splice(0)) release();
  await expect(page.getByRole('textbox', { name: 'Command', exact: true })).toHaveValue('');
  await expect(page.getByText('No tasks in this workspace.', { exact: true })).toBeVisible();
  await expect(page.getByText('printf old-workspace', { exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Command', exact: true }).fill('printf new-workspace');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByLabel('Task output log')).toContainText('ready: printf new-workspace');
  const observed = await page.evaluate(() => (window as unknown as FixtureWindow).nativeTasksFixture.state());
  expect(observed.changed).toEqual(['two']); expect(observed.aborted.some(Boolean)).toBe(true);
  expect(state.requests.filter(request => request.method === 'POST').map(request => request.path)).toEqual(['/api/workspaces/one/native/processes', '/api/workspaces/two/native/processes']);
  await page.evaluate(() => (window as unknown as FixtureWindow).nativeTasksFixture.lock());
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => (window as unknown as FixtureWindow).nativeTasksFixture.unlock());
  await expect(page.getByLabel('Task output log')).toContainText('ready: printf new-workspace');
  expect(state.requests.filter(request => request.method === 'POST')).toHaveLength(2);
});

test('shows unavailable status honestly, retries reads, and fits phone controls without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page, { listFailure: true });
  await expect(page.getByRole('alert')).toContainText('Native task status is temporarily unavailable.');
  await expect(page.getByText('No tasks in this workspace.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
  state.listFailure = false; await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(page.getByText('No tasks in this workspace.', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Command', exact: true }).fill('printf phone');
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
  expect((await page.getByRole('button', { name: 'Run', exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.requests.every(request => request.method === 'GET')).toBe(true);
});

test('suspends hidden polling and resumes from retained output without clearing the task draft', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('textbox', { name: 'Command', exact: true }).fill('printf active-task');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByLabel('Task output log')).toContainText('ready: printf active-task');
  await page.getByRole('textbox', { name: 'Command', exact: true }).fill('draft for the next task');
  await page.evaluate(() => (window as unknown as FixtureWindow).nativeTasksFixture.active(false));
  await page.waitForTimeout(100);
  const before = state.requests.length;
  await page.waitForTimeout(3300);
  expect(state.requests).toHaveLength(before);
  await page.evaluate(() => (window as unknown as FixtureWindow).nativeTasksFixture.active(true));
  await expect(page.getByRole('textbox', { name: 'Command', exact: true })).toHaveValue('draft for the next task');
  await expect(page.getByLabel('Task output log')).toContainText('ready: printf active-task');
  await expect.poll(() => state.requests.slice(before).filter(request => request.path.endsWith('/output')).length).toBeGreaterThan(0);
  expect(state.requests.slice(before).find(request => request.path.endsWith('/output'))?.query).toBe('?after=1');
  expect(state.requests.filter(request => request.method === 'POST')).toHaveLength(1);
  expect(state.sessions[0].state).toBe('running');
});

test('keeps an action rejection visible after successful status refresh and never retries the mutation', async ({ page }) => {
  const state = await fixture(page, { actionFailure: 'Native execution is unavailable for this command.' });
  await page.getByRole('textbox', { name: 'Command', exact: true }).fill('printf rejected');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(state.actionFailure!);
  const loaded = page.waitForResponse(response => response.request().method() === 'GET' && response.url().endsWith('/native/processes'));
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click(); await loaded;
  await expect(page.getByRole('alert')).toContainText(state.actionFailure!);
  await expect(page.getByRole('textbox', { name: 'Command', exact: true })).toHaveValue('printf rejected');
  expect(state.requests.filter(request => request.method === 'POST')).toHaveLength(1);
  expect(state.sessions).toEqual([]);
});
