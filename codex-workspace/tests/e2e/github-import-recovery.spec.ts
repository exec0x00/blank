import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import type { GithubImportRecovery } from '../../shared/types';

// A controlled HTTP peer exercises the actual panel, fetch requests, and
// cancellation. These explicit status/account records are test fixtures only.
const origin = 'http://github-import-recovery.test';
const recoveryPath = '/api/github/imports/recovery';
const recovery: GithubImportRecovery = {
  workspaceId: 'fixture-workspace-id', workspaceName: 'Interrupted project', stageId: 'fixture-private-stage-id',
  reason: 'Import did not finish. Existing workspace files were retained; inspect the workspace before retrying.',
};
const repo = { id: 1, name: 'project', fullName: 'fixture-owner/project', description: 'A repository control fixture.', private: true, defaultBranch: 'main', updatedAt: '2026-09-20T00:00:00.000Z', url: 'https://github.com/fixture-owner/project' };
type FixtureWindow = Window & { githubRecoveryFixture: {
  mounted(show: boolean): void; lock(): void; unlock(): void;
  state(): { events: Array<{ kind: string; value: unknown }>; aborted: boolean[] };
} };
interface HeldResponse { release(): void; done: Promise<void> }
interface HttpState {
  recovery: unknown;
  error?: { status: number; error: string };
  hold: boolean;
  held: HeldResponse[];
  requests: Array<{ path: string; method: string; marker?: string }>;
}
let script = '', styles = '';

test.beforeAll(async () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const bundled = await build({
    absWorkingDir: root, entryPoints: ['tests/e2e/fixtures/github-import-recovery.tsx'],
    bundle: true, write: false, outfile: 'github-import-recovery-fixture.js',
    platform: 'browser', format: 'iife', target: 'es2022', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent',
  });
  script = bundled.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  styles = bundled.outputFiles.find(file => file.path.endsWith('.css'))!.text + '\n#root { overflow: auto; }';
});

async function fixture(page: Page, initial: Partial<HttpState> = {}) {
  const state: HttpState = { recovery: [recovery], hold: false, held: [], requests: [], ...initial };
  await page.route(origin + '/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en" data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>' });
    if (path === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: script });
    if (path === '/fixture.css') return route.fulfill({ contentType: 'text/css', body: styles });
    state.requests.push({ path, method: request.method(), marker: request.headers()['x-codex-workspace'] });
    if (path === '/api/github/accounts') {
      const account = { id: 'fixture-account', name: 'Fixture account', login: 'fixture-owner', avatarUrl: '', createdAt: '2026-09-20T00:00:00.000Z' };
      return route.fulfill({ json: { accounts: [account], offset: 0, total: 1, nextCursor: null, previousCursor: null, revision: 'fixture-accounts', ...(new URL(request.url()).searchParams.has('selectedId') ? { selected: account } : {}) } });
    }
    if (path === '/api/github/accounts/fixture-account/repos') return route.fulfill({ json: { repositories: [repo], nextCursor: null, previousCursor: null, page: 1, scanned: 1, hasMore: false, searchComplete: true } });
    if (path === '/api/github/import') return route.fulfill({ status: 409, json: { error: 'Import was interrupted. Existing files were retained.' } });
    if (path === recoveryPath) {
      const status = state.error?.status || 200;
      const body = JSON.stringify(state.error ? { error: state.error.error } : state.recovery);
      if (state.hold) {
        let release!: () => void, complete!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const done = new Promise<void>(resolve => { complete = resolve; });
        state.held.push({ release, done });
        await gate;
        try { await route.fulfill({ status, contentType: 'application/json', body }); }
        catch { /* The component deliberately aborts held requests on lock/unmount. */ }
        finally { complete(); }
        return;
      }
      return route.fulfill({ status, contentType: 'application/json', body });
    }
    return route.fulfill({ status: 404, json: { error: 'Unexpected fixture request.' } });
  });
  await page.goto(origin);
  await expect(page.getByRole('link', { name: repo.fullName, exact: true })).toBeVisible();
  return {
    state,
    release: async () => {
      const held = state.held.splice(0);
      for (const response of held) response.release();
      await Promise.all(held.map(response => response.done));
    },
  };
}

const status = (page: Page) => page.getByRole('region', { name: 'Import recovery status', exact: true });
const observed = (page: Page) => page.evaluate(() => (window as unknown as FixtureWindow).githubRecoveryFixture.state());

test('recovery shows the actual workspace and safe reason, refreshes real status, and leaves repository controls usable', async ({ page }) => {
  const http = await fixture(page);
  const notice = status(page);
  await expect(notice).toContainText(recovery.workspaceName);
  await expect(notice).toContainText(recovery.reason);
  const markup = await notice.evaluate(element => element.outerHTML);
  expect(markup).not.toContain(recovery.stageId);
  expect(markup).not.toContain(recovery.workspaceId);
  await expect(page.getByRole('complementary', { name: 'Connected GitHub accounts' })).toContainText('Fixture account');
  await expect(page.getByRole('searchbox', { name: 'Search your repositories', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Import ' + repo.fullName, exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(repo.fullName);
  await page.getByRole('button', { name: 'Cancel import', exact: true }).click();
  http.state.recovery = [];
  await notice.getByRole('button', { name: 'Refresh import status', exact: true }).click();
  await expect(notice).toHaveCount(0);
  expect(http.state.requests.filter(request => request.path === recoveryPath)).toHaveLength(2);
  expect(http.state.requests.filter(request => request.path.startsWith('/api/')).every(request => request.marker === '1' && request.method === 'GET')).toBe(true);
  expect((await observed(page)).events).toEqual([]);
});

test('failed or malformed status stays visible without masking accounts, and a failed import reloads its real recovery status', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const http = await fixture(page, { error: { status: 503, error: 'Internal failure at /tmp/private-stage/fixture-private-stage-id' } });
  const notice = status(page);
  await expect(notice.getByRole('alert')).toHaveText('Could not check interrupted imports. Refresh to try again.');
  expect(await notice.innerText()).not.toMatch(/\/tmp\/|fixture-private-stage-id/);
  await expect(page.getByRole('button', { name: 'Import ' + repo.fullName, exact: true })).toBeEnabled();
  const refresh = notice.getByRole('button', { name: 'Refresh import status', exact: true });
  expect((await refresh.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  http.state.error = undefined;
  http.state.recovery = { unexpected: 'response' };
  const malformedResponse = page.waitForResponse(response => response.url() === origin + recoveryPath);
  await refresh.click();
  await malformedResponse;
  await expect(notice).toHaveAttribute('aria-busy', 'false');
  await expect(notice.getByRole('alert')).toBeVisible();
  http.state.recovery = [recovery];
  await page.getByRole('button', { name: 'Import ' + repo.fullName, exact: true }).click();
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('Import was interrupted. Existing files were retained.');
  await expect(notice).toContainText(recovery.workspaceName);
  await expect(notice).toContainText(recovery.reason);
  await expect(notice.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel import', exact: true }).click();
  expect((await observed(page)).events).toEqual([]);
  expect(http.state.requests.filter(request => request.method !== 'GET').map(request => request.path)).toEqual(['/api/github/import']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('lock and unmount abort pending status reads and late results cannot replace fresh status', async ({ page }) => {
  const http = await fixture(page, { hold: true });
  const notice = status(page);
  try {
    await expect.poll(() => http.state.held.length).toBe(1);
    await page.evaluate(() => (window as unknown as FixtureWindow).githubRecoveryFixture.lock());
    await expect(notice).toHaveCount(0);
    await expect.poll(async () => (await observed(page)).aborted.at(-1)).toBe(true);
    await http.release();
    http.state.hold = false;
    http.state.recovery = [{ ...recovery, workspaceName: 'Status after unlock' }];
    await page.evaluate(() => (window as unknown as FixtureWindow).githubRecoveryFixture.unlock());
    await expect(notice).toContainText('Status after unlock');
    await expect(notice).not.toContainText(recovery.workspaceName);

    http.state.hold = true;
    await notice.getByRole('button', { name: 'Refresh import status', exact: true }).click();
    await expect.poll(() => http.state.held.length).toBe(1);
    await page.evaluate(() => (window as unknown as FixtureWindow).githubRecoveryFixture.mounted(false));
    await expect(notice).toHaveCount(0);
    await expect.poll(async () => (await observed(page)).aborted.at(-1)).toBe(true);
    await http.release();
    http.state.hold = false;
    http.state.recovery = [{ ...recovery, workspaceName: 'Status after reopening' }];
    await page.evaluate(() => (window as unknown as FixtureWindow).githubRecoveryFixture.lock());
    const readsBeforeMount = http.state.requests.filter(request => request.path === recoveryPath).length;
    await page.evaluate(() => (window as unknown as FixtureWindow).githubRecoveryFixture.mounted(true));
    await expect(page.getByRole('region', { name: 'Repository browser', exact: true })).toBeVisible();
    await expect(notice).toHaveCount(0);
    expect(http.state.requests.filter(request => request.path === recoveryPath)).toHaveLength(readsBeforeMount);
    await page.evaluate(() => (window as unknown as FixtureWindow).githubRecoveryFixture.unlock());
    await expect(notice).toContainText('Status after reopening');
    await expect(notice).not.toContainText('Status after unlock');
    expect((await observed(page)).events).toEqual([]);
  } finally { await http.release(); }
});
