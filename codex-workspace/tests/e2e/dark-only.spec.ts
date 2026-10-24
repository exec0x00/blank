import { test, expect, type Page } from '@playwright/test';
import type { AppSettings, CodexModelCatalog, CodexRuntimeStatus } from '../../shared/types';

const password = process.env.PLAYWRIGHT_PASSWORD || 'browser-test-workspace-password';
const headers = { 'X-Codex-Workspace': '1' };
type Preferences = Pick<AppSettings, 'model' | 'reasoningEffort' | 'reasoningSummary' | 'verbosity' | 'webSearchMode' | 'autoApprove' | 'fontSize' | 'wordWrap'>;
type NativePreferences = Omit<Preferences, 'fontSize' | 'wordWrap'>;
type ObservedWindow = Window & { settingsEvents: AppSettings[] };

function appearance(settings: Pick<AppSettings, 'fontSize' | 'wordWrap'>) {
  return { fontSize: settings.fontSize, wordWrap: settings.wordWrap };
}

const efforts = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const nativeCatalog: CodexModelCatalog = { backend: 'codex-cli', connected: true, models: ['gpt-5.6-sol', 'gpt-daybreak-red-latest'],
  catalog: [['gpt-5.6-sol', 'GPT-5.6 Sol'], ['gpt-daybreak-red-latest', 'Daybreak Red']].map(([model, displayName]) => ({
    id: `catalog:${model}`, model, displayName, description: 'Controlled native metadata for appearance acceptance.', hidden: model.includes('daybreak'),
    supportedReasoningEfforts: efforts.map(reasoningEffort => ({ reasoningEffort, description: '' })), defaultReasoningEffort: 'medium',
    inputModalities: ['text'], isDefault: model === 'gpt-5.6-sol',
  })) };
const runtimeMetadata: CodexRuntimeStatus = { backend: 'codex-cli', state: 'ready', version: '0.155.1', installedVersion: '0.155.1',
  startedAt: null, updatedAt: '2026-09-22T00:00:00Z', canUpdate: true, updateBlockedReason: null, error: null, activeTurns: 0,
  capabilities: { conversations: true, pagination: true, queue: true, goals: true, skills: true, plan: true, review: true, historyRevert: true } };

async function expectDark(page: Page) {
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'dark');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#090909');
  expect(await page.evaluate(() => ({
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    background: getComputedStyle(document.body).backgroundColor,
  }))).toEqual({ colorScheme: 'dark', background: 'rgb(9, 9, 9)' });
}

async function openSettingsCategory(page: Page, category: 'agent' | 'tools' | 'appearance') {
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  const picker = dialog.getByRole('combobox', { name: 'Settings category', exact: true });
  const labels = { agent: 'Model & responses', tools: 'Tools & permissions', appearance: 'Appearance' };
  if (await picker.isVisible()) {
    await picker.click();
    await page.getByRole('listbox', { name: 'Settings category', exact: true }).locator(`[role="option"][data-value="${category}"]`).click();
  } else await dialog.getByRole('button', { name: labels[category], exact: true }).click();
  await expect(dialog.locator(`#settings-panel-${category}`)).toBeVisible();
}

for (const layout of [
  { name: 'desktop', width: 1440, height: 960, legacyTheme: 'light' },
  { name: 'phone', width: 390, height: 844, legacyTheme: 'system' },
]) {
  test(`${layout.name} keeps settings dark through legacy responses while saving every remaining preference`, async ({ page }) => {
    await page.setViewportSize(layout);
    await page.emulateMedia({ colorScheme: 'light' });
    expect((await page.request.post('/api/session', { headers, data: { password } })).status()).toBe(200);
    const original = await (await page.request.get('/api/settings')).json() as AppSettings;
    const initial: Preferences = { model: 'gpt-5.6-sol', reasoningEffort: 'medium', reasoningSummary: null, verbosity: null, webSearchMode: 'cached', autoApprove: false, fontSize: 14, wordWrap: false };
    expect((await page.request.patch('/api/settings', { headers, data: appearance(initial) })).status()).toBe(200);
    let nativePreferences: NativePreferences = { model: initial.model, reasoningEffort: initial.reasoningEffort,
      reasoningSummary: initial.reasoningSummary, verbosity: initial.verbosity, webSearchMode: initial.webSearchMode, autoApprove: initial.autoApprove };
    const submitted: Array<Partial<Preferences>> = [], appearanceWrites: Array<Partial<ReturnType<typeof appearance>>> = [];
    const upstreamThemes: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(legacyTheme => {
      localStorage.setItem('codex.theme', legacyTheme);
      const observed = window as unknown as ObservedWindow;
      observed.settingsEvents = [];
      window.addEventListener('codex:settings-changed', event => {
        observed.settingsEvents.push((event as CustomEvent<AppSettings>).detail);
      });
    }, layout.legacyTheme);
    // Native configuration is an explicit HTTP response fixture. Appearance
    // still uses the real store and authenticated API on an offline app.
    await page.route('**/api/models', route => route.fulfill({ json: nativeCatalog }));
    await page.route('**/api/codex/runtime', route => route.fulfill({ json: runtimeMetadata }));
    await page.route('**/api/threads?**', route => route.fulfill({ json: { items: [], olderCursor: null, newerCursor: null, hasOlder: false, hasNewer: false } }));
    await page.route('**/api/bootstrap', async route => {
      const response = await route.fetch();
      const bootstrap = await response.json();
      bootstrap.settings = { ...bootstrap.settings, ...nativePreferences, agentConfigured: true, theme: layout.legacyTheme };
      await route.fulfill({ response, json: bootstrap });
    });
    await page.route('**/api/settings', async route => {
      if (route.request().method() === 'GET') {
        const response = await route.fetch();
        if (!response.ok()) return route.fulfill({ response });
        return route.fulfill({ response, json: { ...await response.json(), ...nativePreferences, agentConfigured: true } });
      }
      if (route.request().method() !== 'PATCH') return route.continue();
      const patch = route.request().postDataJSON() as Partial<Preferences>;
      expect(Object.keys(patch).every(key => ['model', 'reasoningEffort', 'reasoningSummary', 'verbosity', 'webSearchMode', 'autoApprove', 'fontSize', 'wordWrap'].includes(key))).toBe(true);
      submitted.push(patch);
      const { fontSize, wordWrap, ...nativePatch } = patch;
      const appearancePatch = { ...(fontSize !== undefined ? { fontSize } : {}), ...(wordWrap !== undefined ? { wordWrap } : {}) };
      const response = Object.keys(appearancePatch).length
        ? await page.request.patch('/api/settings', { headers, data: appearancePatch })
        : await page.request.get('/api/settings');
      expect(response.status()).toBe(200);
      if (Object.keys(appearancePatch).length) appearanceWrites.push(appearancePatch);
      const saved = await response.json();
      upstreamThemes.push(saved.theme);
      nativePreferences = { ...nativePreferences, ...nativePatch };
      await route.fulfill({ response, json: { ...saved, ...nativePreferences, agentConfigured: true, theme: layout.legacyTheme } });
    });

    try {
      await page.goto('/work');
      await expect(page.getByRole('main', { name: 'Workspace', exact: true })).toBeVisible();
      await expectDark(page);
      expect(await page.evaluate(() => localStorage.getItem('codex.theme'))).toBeNull();
      await page.keyboard.press('ControlOrMeta+,');
      const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('combobox', { name: 'Default model', exact: true }).click();
      await page.getByRole('combobox', { name: 'Search Default model', exact: true }).fill('gpt-daybreak-red-latest');
      await page.locator('[role="option"][data-value="gpt-daybreak-red-latest"]').click();
      await dialog.getByRole('combobox', { name: 'Reasoning effort', exact: true }).click();
      const effortOptions = page.getByRole('listbox', { name: 'Reasoning effort', exact: true });
      await expect(effortOptions.getByRole('option')).toHaveText([/^Codex default/, 'Low', 'Medium', 'High', 'Xhigh', 'Max', 'Ultra']);
      await expect(effortOptions.getByRole('option', { name: /^Codex default/ })).toHaveAttribute('data-value', '$omit');
      await effortOptions.getByRole('option', { name: 'Max', exact: true }).click();
      await dialog.getByRole('combobox', { name: 'Public reasoning summary', exact: true }).click();
      await page.getByRole('listbox', { name: 'Public reasoning summary', exact: true }).getByRole('option', { name: 'detailed', exact: true }).click();
      await dialog.getByRole('group', { name: 'Response detail', exact: true }).getByRole('button', { name: 'Detailed', exact: true }).click();
      await expect(dialog.getByRole('textbox', { name: 'Output token budget', exact: true })).toHaveCount(0);
      await openSettingsCategory(page, 'tools');
      await dialog.getByRole('combobox', { name: 'Web search', exact: true }).click();
      await page.locator('[role="option"][data-value="live"]').click();
      await dialog.getByRole('combobox', { name: 'Default permissions', exact: true }).click();
      await page.locator('[role="option"][data-value="full-access"]').click();
      await openSettingsCategory(page, 'appearance');
      await expect(dialog.getByRole('group', { name: 'Color theme', exact: true })).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: /^(Dark|Light|System)$/ })).toHaveCount(0);
      await expect(dialog.getByRole('combobox', { name: /theme/i })).toHaveCount(0);
      const font = dialog.getByRole('slider', { name: 'Editor font size', exact: true });
      await font.focus();
      await page.keyboard.press('Home');
      for (let step = 0; step < 8; step++) await page.keyboard.press('ArrowRight');
      await expect(font).toHaveValue('19');
      await dialog.getByRole('switch', { name: 'Wrap long lines', exact: true }).click();
      await expect(dialog.getByRole('switch', { name: 'Wrap long lines', exact: true })).toBeChecked();
      await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(dialog).toBeHidden();
      const updated: Preferences = { model: 'gpt-daybreak-red-latest', reasoningEffort: 'max', reasoningSummary: 'detailed', verbosity: 'high', webSearchMode: 'live', autoApprove: true, fontSize: 19, wordWrap: true };
      expect(submitted).toEqual([updated]);
      expect(appearanceWrites).toEqual([{ fontSize: 19, wordWrap: true }]);
      expect(upstreamThemes).toEqual(['dark']);
      expect(await (await page.request.get('/api/settings')).json()).toMatchObject({ ...appearance(updated), theme: 'dark' });
      expect(await page.evaluate(async () => (await fetch('/api/settings')).json())).toMatchObject({ ...updated, theme: 'dark' });
      await expect.poll(() => page.evaluate(() => (window as unknown as ObservedWindow).settingsEvents.at(-1))).toMatchObject({ ...updated, theme: 'dark' });
      await expectDark(page);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--editor-font-size'))).toBe('19px');

      await page.reload();
      await expect(page.getByRole('main', { name: 'Workspace', exact: true })).toBeVisible();
      await page.keyboard.press('ControlOrMeta+,');
      await expect(dialog.getByRole('combobox', { name: 'Default model', exact: true })).toHaveText('Daybreak Red');
      await expect(dialog.getByRole('combobox', { name: 'Reasoning effort', exact: true })).toHaveText('Max');
      await expect(dialog.getByRole('combobox', { name: 'Public reasoning summary', exact: true })).toHaveText('detailed');
      await expect(dialog.getByRole('group', { name: 'Response detail', exact: true }).getByRole('button', { name: 'Detailed', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(dialog.getByRole('textbox', { name: 'Output token budget', exact: true })).toHaveCount(0);
      await openSettingsCategory(page, 'tools');
      await expect(dialog.getByRole('combobox', { name: 'Web search', exact: true })).toHaveText('Live search');
      await expect(dialog.getByRole('combobox', { name: 'Default permissions', exact: true })).toHaveText('Full access');
      await openSettingsCategory(page, 'appearance');
      await expect(font).toHaveValue('19');
      await expect(dialog.getByRole('switch', { name: 'Wrap long lines', exact: true })).toBeChecked();
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.emulateMedia({ colorScheme: 'light' });
      await expectDark(page);
      const observed = await page.evaluate(() => (window as unknown as ObservedWindow).settingsEvents);
      expect(observed.length).toBeGreaterThan(0);
      expect(observed.every(value => value.theme === 'dark')).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      expect((await page.request.patch('/api/settings', { headers, data: appearance(original) })).status()).toBe(200);
    }
  });
}
