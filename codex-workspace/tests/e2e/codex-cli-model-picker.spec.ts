import { expect, test, type Page } from '@playwright/test';
import { build, stop } from 'esbuild';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CodexModelCatalog } from '../../shared/codex-cli';

const catalog: CodexModelCatalog = { backend: 'codex-cli', connected: true,
  models: ['native/base', 'gpt-daybreak-red-latest', 'gpt-daybreak-blue-latest'], catalog: [
    { id: 'native-base-id', model: 'native/base', displayName: 'Native base', description: 'A native description.', hidden: false,
      supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'Native high effort' }], defaultReasoningEffort: 'high', inputModalities: ['text'], isDefault: true },
    { id: 'red-catalog-id-not-the-wire-value', model: 'gpt-daybreak-red-latest', displayName: 'Daybreak Red', description: 'Native red metadata.', hidden: true,
      supportedReasoningEfforts: [{ reasoningEffort: 'native_red_effort', description: 'Native red effort' }], defaultReasoningEffort: 'native_red_effort', inputModalities: ['text', 'image'], isDefault: false },
    { id: 'blue-catalog-id', model: 'gpt-daybreak-blue-latest', displayName: 'Daybreak Blue', description: 'Native blue metadata.', hidden: true,
      supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Native low effort' }], defaultReasoningEffort: 'low', inputModalities: ['text'], isDefault: false },
  ] };
let server: Server, origin: string;

test.beforeAll(async () => {
  const built = await build({ stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
    import { useLayoutEffect, useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import ModelSelect from './client/components/chat/ModelSelect';
    import ModelOptionsFields from './client/components/chat/ModelOptionsFields';
    import { SelectMenu } from './client/components/ui/Dropdown';
    import { modelOptions, modelRequestError, reasoningOptions, modelOptionValue, parseModelOption, OMIT_MODEL_OPTION } from './client/components/chat/models';
    import './client/styles.css';
    const start = window.pickerInitial, state = window.pickerFixture;
    function Harness() {
      const [catalog, setCatalog] = useState(start.catalog), [model, setModel] = useState(start.model);
      const [prefs, setPrefs] = useState({ reasoningEffort: start.effort, reasoningSummary: null });
      const [disabled, setDisabled] = useState(false), [loading, setLoading] = useState(false);
      const options = modelOptions(catalog, model), selected = options.find(row => row.model === model);
      const error = modelRequestError(options, model, prefs);
      useLayoutEffect(() => { Object.assign(state, { setCatalog, setDisabled, setLoading }); }, []);
      return <main style={{ padding: 20, maxWidth: 520 }}>
        <label className="field-label">Model</label>
        <ModelSelect value={model} models={options} label="Model" disabled={disabled} loading={loading} ready={true}
          onRefresh={() => state.refreshes++} onValueChange={value => { state.choices.push(value); setModel(value); }} />
        <SelectMenu aria-label="Reasoning effort" value={modelOptionValue(prefs.reasoningEffort)} disabled={disabled || !catalog.connected}
          renderValue={option => option?.label ?? prefs.reasoningEffort ?? 'Codex default'}
          onValueChange={value => setPrefs(previous => ({ ...previous, reasoningEffort: parseModelOption(value) }))}
          options={[{ value: OMIT_MODEL_OPTION, label: 'Codex default' }, ...reasoningOptions(options, model).map(value => ({ value, label: value }))]} />
        <ModelOptionsFields profile={selected} value={prefs} disabled={disabled} onChange={setPrefs} />
        <output aria-label="Selected model">{model}</output>
        <output aria-label="Selected preferences">{JSON.stringify(prefs)}</output>
        {error && <p role="alert">{error}</p>}
      </main>;
    }
    createRoot(document.getElementById('root')).render(<Harness />);
  ` }, bundle: true, write: false, outfile: 'codex-cli-model-picker-fixture.js', platform: 'browser', format: 'esm', jsx: 'automatic', target: 'es2022', logLevel: 'silent' });
  stop();
  const script = built.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  const css = built.outputFiles.find(file => file.path.endsWith('.css'))!.text;
  server = createServer((request, response) => {
    const pathname = new URL(request.url || '/', 'http://fixture.invalid').pathname;
    response.setHeader('Cache-Control', 'no-store');
    if (pathname === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(script); return; }
    if (pathname === '/fixture.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html lang="en" data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => { server?.closeAllConnections(); if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

async function fixture(page: Page, input: { model?: string; effort?: string | null; connected?: boolean } = {}) {
  const errors: string[] = [], unexpected: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (!route.request().url().startsWith(origin + '/')) { unexpected.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.addInitScript(initial => {
    Object.assign(window, { pickerInitial: initial, pickerFixture: { choices: [], refreshes: 0 } });
  }, { catalog: { ...catalog, connected: input.connected ?? true }, model: input.model ?? 'native/base', effort: input.effort ?? null });
  await page.goto(origin);
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toBeVisible();
  return { errors, unexpected, choices: () => page.evaluate(() => (window as unknown as { pickerFixture: { choices: string[] } }).pickerFixture.choices) };
}
async function open(page: Page) {
  const control = page.getByRole('combobox', { name: 'Model', exact: true });
  await control.focus(); await control.press('Enter');
  const search = page.getByRole('combobox', { name: 'Search Model', exact: true });
  await expect(search).toBeFocused(); return search;
}

test('requested hidden native Red and missing Cyber keep exact identities and distinct metadata', async ({ page }) => {
  const state = await fixture(page); let search = await open(page);
  await expect(page.getByRole('option', { name: /^Daybreak Red / })).toBeVisible();
  await expect(page.getByRole('option', { name: /^Daybreak Blue / })).toHaveCount(0);
  await search.fill('gpt-daybreak-red-latest'); await search.press('Enter');
  await expect(page.getByRole('status', { name: 'Selected model' })).toHaveText('gpt-daybreak-red-latest');
  search = await open(page); await search.fill('gpt-5.6-cyber');
  await expect(page.getByRole('option', { name: /^gpt-5\.6-cyber / })).toContainText('metadata unavailable');
  await search.press('Enter');
  await expect(page.getByRole('status', { name: 'Selected model' })).toHaveText('gpt-5.6-cyber');
  expect(await state.choices()).toEqual(['gpt-daybreak-red-latest', 'gpt-5.6-cyber']);
  expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('keyboard search selects a literal ID unchanged and does not probe or alias on typing', async ({ page }) => {
  const state = await fixture(page), search = await open(page), exact = 'owner/Model:Exact+v2';
  await search.fill(exact);
  const choice = page.getByRole('option', { name: /^Use model ID / });
  await expect(choice).toHaveAttribute('data-value', exact);
  await expect(choice).toContainText('acceptance unverified');
  expect(await page.evaluate(() => (window as unknown as { pickerFixture: { refreshes: number } }).pickerFixture.refreshes)).toBe(1);
  await search.press('Enter');
  await expect(page.getByRole('status', { name: 'Selected model' })).toHaveText(exact);
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toBeFocused();
  expect(await state.choices()).toEqual([exact]); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('an existing literal effort remains visible and unchanged while only default is offered for unknown models', async ({ page }) => {
  const state = await fixture(page, { model: 'owner/initial-unknown', effort: 'retained_effort-v2' });
  await expect(page.getByRole('combobox', { name: 'Reasoning effort', exact: true })).toHaveText('retained_effort-v2');
  await expect(page.getByText('Selected effort: retained_effort-v2 (literal).', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Reasoning effort', exact: true }).click();
  await expect(page.getByRole('option')).toHaveCount(1); await expect(page.getByRole('option', { name: 'Codex default' })).toBeVisible();
  await page.keyboard.press('Escape');
  const search = await open(page); await search.fill('owner/another-unknown'); await search.press('Enter');
  await expect(page.getByRole('status', { name: 'Selected preferences' })).toHaveText('{"reasoningEffort":"retained_effort-v2","reasoningSummary":null}');
  await expect(page.getByRole('alert')).toHaveCount(0);
  const known = await open(page); await known.fill('native/base'); await known.press('Enter');
  await expect(page.getByRole('alert')).toContainText('does not offer');
  await expect(page.getByRole('status', { name: 'Selected preferences' })).toHaveText('{"reasoningEffort":"retained_effort-v2","reasoningSummary":null}');
  expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('invalid, overlong and retired text cannot become a shortened or substituted model ID', async ({ page }) => {
  const state = await fixture(page), search = await open(page);
  for (const value of ['gpt-5.5', 'owner/unknown ', 'x'.repeat(201)]) {
    await search.fill(value); await expect(search).toHaveValue(value);
    await expect(page.getByRole('option', { name: /^Use model ID / })).toHaveCount(0);
    await search.press('Enter'); expect(await state.choices()).toEqual([]);
  }
  const exact = 'x'.repeat(200); await search.fill(exact);
  await expect(page.getByRole('option', { name: /^Use model ID / })).toHaveAttribute('data-value', exact);
  await search.press('Enter'); expect(await state.choices()).toEqual([exact]);
  expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('connection and explicit disabled states prevent literal selection without losing the current value', async ({ page }) => {
  const state = await fixture(page, { model: 'owner/current', connected: false }), search = await open(page);
  await search.fill('owner/pending');
  await expect(page.getByRole('option', { name: /^Use model ID / })).toHaveAttribute('aria-disabled', 'true');
  await search.press('Enter'); expect(await state.choices()).toEqual([]);
  await expect(page.getByRole('status', { name: 'Selected model' })).toHaveText('owner/current');
  await page.evaluate(value => (window as unknown as { pickerFixture: { setCatalog(value: unknown): void } }).pickerFixture.setCatalog(value), catalog);
  await expect(page.getByRole('option', { name: /^Use model ID / })).not.toHaveAttribute('aria-disabled', 'true');
  expect(await state.choices()).toEqual([]); await search.press('Enter');
  expect(await state.choices()).toEqual(['owner/pending']);
  await page.evaluate(() => (window as unknown as { pickerFixture: { setDisabled(value: boolean): void } }).pickerFixture.setDisabled(true));
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toBeDisabled();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('a phone picker keeps an exact literal choice within the visible dropdown', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page), search = await open(page), exact = 'owner/phone-model:Literal';
  await search.fill(exact);
  const option = page.getByRole('option', { name: /^Use model ID / });
  await expect(option).toBeInViewport(); await option.click();
  await expect(page.getByRole('status', { name: 'Selected model' })).toHaveText(exact);
  expect(await state.choices()).toEqual([exact]); expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
});
