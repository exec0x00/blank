import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import type { GithubAccount, GithubRepo, GithubRepoPage } from '../../shared/types';

const origin = 'http://github-lists.test';
const accounts: GithubAccount[] = Array.from({ length: 70 }, (_, index) => ({ id: `gh_${index + 1}`, login: `account-${String(index + 1).padStart(3, '0')}`,
  name: `Person ${index + 1}`, avatarUrl: '', createdAt: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString() }));
const repository = (id: number, fullName = `organization/project-${id}`): GithubRepo => ({ id, name: fullName.split('/')[1], fullName,
  description: `Repository fixture ${id}`, private: true, defaultBranch: 'main', updatedAt: '2026-09-20T00:00:00Z', url: `https://github.com/${fullName}` });
type FixtureWindow = Window & { githubListsFixture: {
  selected(id: string, scope?: string): void; show(value: boolean): void; lock(): void; unlock(): void;
  state(): { selected: string; events: Array<{ kind: string; value: unknown }>; signals: Array<{ path: string; aborted: boolean }> };
} };
interface State {
  requests: Array<{ path: string; query: string; cursor: string; selectedId: string; paged: string; limit: string }>;
  hold?: (url: URL) => boolean;
  held: Array<{ release(): void; done: Promise<void> }>;
  fail?: (url: URL) => boolean;
}
let script = '', css = '';

test.beforeAll(async () => {
  const bundled = await build({ absWorkingDir: fileURLToPath(new URL('../..', import.meta.url)), entryPoints: ['tests/e2e/fixtures/github-lists.tsx'],
    bundle: true, write: false, outfile: 'github-lists.js', platform: 'browser', format: 'iife', target: 'es2022', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent' });
  script = bundled.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  css = bundled.outputFiles.find(file => file.path.endsWith('.css'))!.text + '\n#root { overflow: auto; }';
});

function repoPage(query: string, page: number): GithubRepoPage {
  let repositories: GithubRepo[];
  let hasMore: boolean;
  if (!query) { repositories = Array.from({ length: 30 }, (_, index) => repository((page - 1) * 30 + index + 1)); hasMore = page < 2; }
  else if (query === 'billing') { repositories = page === 4 ? [repository(104, 'organization/billing-private')] : []; hasMore = page < 4; }
  else { repositories = []; hasMore = page < 3; }
  return { repositories, page, scanned: page * 30, nextCursor: hasMore ? `repo-${page + 1}` : null,
    previousCursor: page > 1 ? `repo-${page - 1}` : null, hasMore, searchComplete: !hasMore };
}

async function fixture(page: Page, initial: Partial<State> = {}, mode = '') {
  const state: State = { requests: [], held: [], ...initial };
  await page.route(origin + '/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en" data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>' });
    if (url.pathname === '/fixture.css') return route.fulfill({ contentType: 'text/css', body: css });
    if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: script });
    const query = url.searchParams.get('query') || '';
    const cursor = url.searchParams.get('cursor') || '';
    state.requests.push({ path: url.pathname, query, cursor, selectedId: url.searchParams.get('selectedId') || '', paged: url.searchParams.get('paged') || '', limit: url.searchParams.get('limit') || '' });
    let body: unknown;
    if (url.pathname === '/api/github/imports/recovery') body = [];
    else if (url.pathname === '/api/github/accounts') {
      const matching = accounts.filter(account => `${account.login} ${account.name}`.toLowerCase().includes(query.toLowerCase()));
      const offset = Number(cursor.replace('accounts-', '') || 0);
      const limit = Number(url.searchParams.get('limit') || 24);
      const selected = accounts.find(account => account.id === url.searchParams.get('selectedId'));
      body = { accounts: matching.slice(offset, offset + limit), total: matching.length, offset, revision: 'fixture-account-revision',
        nextCursor: offset + limit < matching.length ? `accounts-${offset + limit}` : null,
        previousCursor: offset > 0 ? `accounts-${Math.max(0, offset - limit)}` : null, ...(selected ? { selected } : {}) };
    } else if (/^\/api\/github\/accounts\/gh_\d+\/repos$/.test(url.pathname)) body = repoPage(query, Number(cursor.replace('repo-', '') || 1));
    else return route.fulfill({ status: 404, json: { error: 'Unexpected list fixture request.' } });
    const status = state.fail?.(url) ? 503 : 200;
    const response = status === 200 ? body : { error: 'This fixture page is temporarily unavailable.' };
    if (state.hold?.(url)) {
      let release!: () => void, finish!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      const done = new Promise<void>(resolve => { finish = resolve; });
      state.held.push({ release, done });
      await held;
      try { await route.fulfill({ status, json: response }); }
      catch { /* Aborted requests are expected when a query, scope or session changes. */ }
      finally { finish(); }
      return;
    }
    return route.fulfill({ status, json: response });
  });
  await page.goto(origin + (mode ? `/?mode=${mode}` : '/'));
  return { state, release: async () => {
    const held = state.held.splice(0); for (const item of held) item.release(); await Promise.all(held.map(item => item.done));
  } };
}

const panel = (page: Page) => page.getByRole('region', { name: 'Repository browser' });
const accountPane = (page: Page) => page.getByRole('complementary', { name: 'Connected GitHub accounts' });
const repoSearch = (page: Page) => page.getByRole('searchbox', { name: 'Search your repositories', exact: true });
const repoRequests = (state: State, query: string) => state.requests.filter(request => request.path.endsWith('/repos') && request.query === query);

test('account pages replace rows and exact selected metadata survives paging and server search', async ({ page }) => {
  const http = await fixture(page);
  await expect(accountPane(page).locator('.github-account')).toHaveCount(24);
  await expect(panel(page).locator('.github-repo-title')).toContainText('@account-001');
  await page.getByRole('button', { name: 'Next github accounts', exact: true }).click();
  await expect(accountPane(page).locator('.github-account').first()).toContainText('Person 25');
  await expect(accountPane(page).locator('.github-account')).toHaveCount(24);
  await expect(accountPane(page).getByText('Person 1', { exact: true })).toHaveCount(0);
  await expect(panel(page).locator('.github-repo-title')).toContainText('@account-001');
  await page.getByRole('searchbox', { name: 'Search GitHub accounts' }).fill('account-070');
  await expect(accountPane(page).locator('.github-account')).toHaveCount(1);
  await accountPane(page).locator('.github-account').click();
  await expect(panel(page).locator('.github-repo-title')).toContainText('@account-070');
  await page.getByRole('searchbox', { name: 'Search GitHub accounts' }).fill('');
  await expect(accountPane(page).locator('.github-account')).toHaveCount(24);
  await expect(panel(page).locator('.github-repo-title')).toContainText('@account-070');
  const requests = http.state.requests.filter(request => request.path === '/api/github/accounts');
  expect(requests.every(request => request.paged === '1' && request.limit === '24')).toBe(true);
  expect(requests.some(request => request.selectedId === 'gh_70' && request.query === '')).toBe(true);
});

test('the shared account selector resolves an off-page saved account and uses bounded keyboard paging', async ({ page }) => {
  await fixture(page, {}, 'selector');
  const selector = page.getByRole('combobox', { name: 'GitHub account fixture' });
  await expect(selector).toHaveText('@account-070');
  await selector.click();
  await expect(page.getByRole('option')).toHaveCount(25);
  await expect(page.getByRole('option', { name: /account-001/ })).toBeEnabled();
  await page.keyboard.press('PageDown');
  await expect(page.getByRole('option', { name: /account-025/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /account-001/ })).toHaveCount(0);
  await page.getByRole('combobox', { name: /Search GitHub account fixture/ }).fill('account-068');
  await expect(page.getByRole('option', { name: /account-068/ })).toBeEnabled();
  await page.getByRole('option', { name: /account-068/ }).click();
  await expect(selector).toHaveText('@account-068');
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).githubListsFixture.state().selected)).toBe('gh_68');
});

test('repository pages replace thirty rows and page failures retain the last usable result before retry', async ({ page }) => {
  const http = await fixture(page, { fail: url => url.pathname.endsWith('/repos') && url.searchParams.get('cursor') === 'repo-2' });
  await expect(panel(page).locator('.github-repo')).toHaveCount(30);
  await page.getByRole('button', { name: 'Next repository page' }).click();
  await expect(panel(page).getByRole('alert')).toContainText('temporarily unavailable');
  await expect(page.getByRole('link', { name: 'organization/project-1', exact: true })).toBeVisible();
  await expect(panel(page).locator('.github-repo')).toHaveCount(30);
  http.state.fail = undefined;
  await panel(page).getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('link', { name: 'organization/project-31', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'organization/project-1', exact: true })).toHaveCount(0);
  await expect(panel(page).locator('.github-repo')).toHaveCount(30);
  await expect(page.getByRole('button', { name: 'Next repository page' })).toHaveAttribute('aria-disabled', 'true');
});

test('sparse repository searches continue automatically and never call a partial empty batch no results', async ({ page }) => {
  const http = await fixture(page, { hold: url => url.pathname.endsWith('/repos') && url.searchParams.get('query') === 'billing' && url.searchParams.get('cursor') === 'repo-2' });
  await expect(repoSearch(page)).toBeVisible(); await repoSearch(page).fill('billing');
  await expect.poll(() => http.state.held.length).toBe(1);
  await expect(panel(page).getByRole('heading', { name: 'No matching repositories', exact: true })).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'Pause search' })).toBeVisible();
  http.state.hold = undefined; await http.release();
  await expect(page.getByRole('link', { name: 'organization/billing-private', exact: true })).toBeVisible();
  await expect(panel(page).locator('.github-repo')).toHaveCount(1);
  expect(repoRequests(http.state, 'billing').map(request => request.cursor)).toEqual(['', 'repo-2', 'repo-3', 'repo-4']);
  await expect(panel(page).locator('.github-pagination')).toContainText('Search complete');
});

test('search pause cancels a pending batch and resumes its exact continuation without premature completion', async ({ page }) => {
  const http = await fixture(page, { hold: url => url.pathname.endsWith('/repos') && url.searchParams.get('query') === 'missing' && url.searchParams.get('cursor') === 'repo-2' });
  await expect(repoSearch(page)).toBeVisible(); await repoSearch(page).fill('missing');
  await expect.poll(() => http.state.held.length).toBe(1);
  await page.getByRole('button', { name: 'Pause search' }).click();
  await expect(page.getByRole('button', { name: 'Continue search' })).toBeVisible();
  await expect(panel(page).getByRole('heading', { name: 'No matching repositories', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).githubListsFixture.state().signals.some(item => item.path.includes('repo-2') && item.aborted))).toBe(true);
  http.state.hold = undefined; await http.release();
  expect(repoRequests(http.state, 'missing')).toHaveLength(2);
  await page.getByRole('button', { name: 'Continue search' }).click();
  await expect(panel(page).getByRole('heading', { name: 'No matching repositories', exact: true })).toBeVisible();
  expect(repoRequests(http.state, 'missing').map(request => request.cursor)).toEqual(['', 'repo-2', 'repo-2', 'repo-3']);
});

test('changed searches and locked sessions ignore delayed repository responses and stop discovery', async ({ page }) => {
  const http = await fixture(page, { hold: url => url.pathname.endsWith('/repos') && url.searchParams.get('query') === 'billing' && url.searchParams.get('cursor') === 'repo-4' });
  await expect(repoSearch(page)).toBeVisible(); await repoSearch(page).fill('billing');
  await expect.poll(() => http.state.held.length).toBe(1);
  await repoSearch(page).fill('missing');
  await expect(panel(page).getByRole('heading', { name: 'No matching repositories', exact: true })).toBeVisible();
  await page.evaluate(() => (window as unknown as FixtureWindow).githubListsFixture.lock());
  http.state.hold = undefined; await http.release();
  await expect(page.getByRole('link', { name: 'organization/billing-private', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).githubListsFixture.state().signals.some(item => item.path.includes('query=billing') && item.path.includes('repo-4') && item.aborted))).toBe(true);
});

test('hiding the repository pane stops automatic discovery and restoring it resumes the same batch', async ({ page }) => {
  const http = await fixture(page, { hold: url => url.pathname.endsWith('/repos') && url.searchParams.get('query') === 'billing' && url.searchParams.get('cursor') === 'repo-2' });
  await expect(repoSearch(page)).toBeVisible(); await repoSearch(page).fill('billing');
  await expect.poll(() => http.state.held.length).toBe(1);
  await page.evaluate(() => (window as unknown as FixtureWindow).githubListsFixture.show(false));
  await expect.poll(() => page.evaluate(() => (window as unknown as FixtureWindow).githubListsFixture.state().signals.some(item => item.path.includes('repo-2') && item.aborted))).toBe(true);
  http.state.hold = undefined; await http.release();
  expect(repoRequests(http.state, 'billing')).toHaveLength(2);
  await page.evaluate(() => (window as unknown as FixtureWindow).githubListsFixture.show(true));
  await expect(page.getByRole('link', { name: 'organization/billing-private', exact: true })).toBeVisible();
  expect(repoRequests(http.state, 'billing').map(request => request.cursor)).toEqual(['', 'repo-2', 'repo-2', 'repo-3', 'repo-4']);
});

test('an exact account selection remains scoped while an older account page completes late', async ({ page }) => {
  const http = await fixture(page, { hold: url => url.pathname === '/api/github/accounts' && url.searchParams.get('selectedId') === 'gh_70' }, 'selector');
  await expect.poll(() => http.state.held.length).toBe(1);
  await page.evaluate(() => (window as unknown as FixtureWindow).githubListsFixture.selected('gh_10', 'workspace-two'));
  const selector = page.getByRole('combobox', { name: 'GitHub account fixture' });
  await expect(selector).toHaveText('@account-010');
  http.state.hold = undefined; await http.release();
  await expect(selector).toHaveText('@account-010');
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).githubListsFixture.state().signals.some(item => item.path.includes('selectedId=gh_70') && item.aborted))).toBe(true);
});

test('phone account paging and repository search controls fit the viewport with touch targets', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const http = await fixture(page, { hold: url => url.pathname.endsWith('/repos') && url.searchParams.get('query') === 'missing' && url.searchParams.get('cursor') === 'repo-2' });
  await expect(accountPane(page).locator('.github-account')).toHaveCount(24);
  const next = page.getByRole('button', { name: 'Next github accounts', exact: true });
  await next.scrollIntoViewIfNeeded(); await next.click();
  await expect(accountPane(page).locator('.github-account').first()).toContainText('Person 25');
  await repoSearch(page).fill('missing');
  await expect.poll(() => http.state.held.length).toBe(1);
  const pause = page.getByRole('button', { name: 'Pause search' });
  await pause.scrollIntoViewIfNeeded();
  const bounds = await pause.boundingBox(); expect(bounds?.height).toBeGreaterThanOrEqual(44);
  await pause.click(); http.state.hold = undefined; await http.release();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect(accountPane(page).locator('.github-account')).toHaveCount(24);
});
