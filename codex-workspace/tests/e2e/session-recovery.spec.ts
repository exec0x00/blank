import { test, expect, type Page, type Route } from '@playwright/test';

const password = process.env.PLAYWRIGHT_PASSWORD || 'browser-test-workspace-password';
const headers = { 'X-Codex-Workspace': '1' };

async function signIn(page: Page) {
  expect((await page.request.post('/api/session', { headers, data: { password } })).status()).toBe(200);
}

test('a failed server logout stays visibly locked after reload and can be retried without losing the lock', async ({ page }) => {
  await signIn(page);
  await page.goto('/work');
  await expect(page.locator('.app-shell')).toBeVisible();
  const failedLogout = async (route: Route) => {
    if (route.request().method() === 'DELETE') await route.fulfill({ status: 503, json: { error: 'Temporary logout fixture failure.' } });
    else await route.continue();
  };
  await page.route('**/api/session', failedLogout);
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await expect(page.getByLabel('Workspace password', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('server sign-out is unconfirmed');
  expect(await (await page.request.get('/api/session')).json()).toEqual({ authenticated: true });

  let bootstrapReads = 0;
  const read = (request: { url(): string }) => { if (new URL(request.url()).pathname === '/api/bootstrap') bootstrapReads++; };
  page.on('request', read);
  await page.reload();
  await expect(page.getByLabel('Workspace password', { exact: true })).toBeVisible();
  await expect(page.locator('.app-shell')).toBeHidden();
  await expect(page.getByRole('alert')).toContainText('server sign-out is unconfirmed');
  expect(bootstrapReads).toBe(0);
  page.off('request', read);

  await page.unroute('**/api/session', failedLogout);
  await page.getByRole('button', { name: 'Retry server sign-out', exact: true }).click();
  await expect(page.locator('.login-lock-notice')).toBeHidden();
  expect(await (await page.request.get('/api/session')).json()).toEqual({ authenticated: false });
  await page.reload();
  await expect(page.getByLabel('Workspace password', { exact: true })).toBeVisible();
  await page.getByLabel('Workspace password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  expect(new URL(page.url()).searchParams.has('workspace-lock')).toBe(false);
  await page.reload();
  await expect(page.locator('.app-shell')).toBeVisible();
});

test('an unreadable successful bootstrap response exposes a recoverable startup error', async ({ page }) => {
  await signIn(page);
  await page.route('**/api/bootstrap', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Starting server</html>' }));
  await page.goto('/work');
  await expect(page.getByRole('alert')).toContainText('unreadable response');
  await expect(page.locator('.app-shell')).toBeHidden();
  await page.unroute('**/api/bootstrap');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
});

test('a stalled session read times out visibly and a later retry can open the workspace', async ({ page }) => {
  await signIn(page);
  await page.clock.install();
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const stalled = async (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue();
    started(); await held;
    await route.abort().catch(() => undefined);
  };
  await page.route('**/api/session', stalled);
  try {
    await page.goto('/work');
    await entered;
    await page.clock.fastForward(30_001);
    await expect(page.getByRole('alert')).toContainText('taking too long');
  } finally { release(); await page.unroute('**/api/session', stalled); }
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
});
