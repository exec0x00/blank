import { expect, test, type Page, type Route } from '@playwright/test';
import { build, stop } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { AppSettings, CodexModelCatalog, CodexRuntimeStatus, CodexSkillList } from '../../shared/types';
import type { CodexConfigValue, CodexNativeSettings, CodexNativeSettingsPatch } from '../../shared/codex-cli';
import type { SettingsTab } from '../../client/components/SettingsDialog';
import { configAt, schemaFields, setConfigAt, type ConfigSchema } from '../../client/components/settings/configuration';

const settings: AppSettings = { model: 'wire/base', reasoningEffort: null, reasoningSummary: 'auto', verbosity: null,
  webSearchMode: 'cached', autoApprove: false, fastMode: true, theme: 'dark', fontSize: 13, wordWrap: true, provider: 'openai', apiKeyConfigured: false, agentConfigured: true };
const runtime = (): CodexRuntimeStatus => ({ backend: 'codex-cli', state: 'ready', version: '0.155.1', installedVersion: '0.155.1',
  startedAt: '2026-09-22T13:00:00Z', updatedAt: '2026-09-22T13:00:00Z', canUpdate: true, updateBlockedReason: null, error: null, activeTurns: 0,
  capabilities: { conversations: true, pagination: true, queue: true, goals: true, skills: true, plan: true, review: true, historyRevert: true } });
const catalog = (): CodexModelCatalog => ({ backend: 'codex-cli', connected: true, models: ['wire/base', 'owner/model:literal'], catalog: [
  { id: 'catalog-base', model: 'wire/base', displayName: 'Default Codex model', description: 'Native base model', hidden: false,
    supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'More reasoning' }], defaultReasoningEffort: 'high', inputModalities: ['text', 'image'], isDefault: true,
    contextWindow: 872_000, maximumContextWindow: 872_000, officialMaximumContextWindow: 1_050_000 },
  { id: 'catalog-identity-is-not-the-wire-value', model: 'owner/model:literal', displayName: 'Research model', description: 'Exact native model value', hidden: false,
    supportedReasoningEfforts: [{ reasoningEffort: 'opaque_max', description: 'Literal declared effort' }], defaultReasoningEffort: 'opaque_max', inputModalities: ['text'], isDefault: false,
    contextWindow: 400_000, maximumContextWindow: 400_000 },
] });
function nativeSettings(): CodexNativeSettings {
  const schema = JSON.parse(readFileSync(new URL('../../server/codex-cli/official-config.schema.json', import.meta.url), 'utf8')) as Record<string, unknown>;
  const config = { model: settings.model, model_reasoning_summary: 'auto', web_search: 'cached', approval_policy: 'on-request', service_tier: 'fast' };
  const lockedKeys = [{ key: 'model_provider', reason: 'The model service is managed by the host.' }, { key: 'model_providers', reason: 'The model service is managed by the host.' },
    { key: 'openai_base_url', reason: 'The model service is managed by the host.' }, { key: 'features.browser_use', reason: 'This native interface is unavailable in this website.' }];
  return { backend: 'codex-cli', config, userConfig: structuredClone(config), version: 'native-version-1', schema,
    schemaSource: { url: 'https://developers.openai.com/codex/config-schema.json', retrievedAt: '2026-09-23', sha256: 'fixture-schema', runtimeVersion: '0.155.1' },
    editableKeys: Object.keys(schema.properties as Record<string, unknown>).filter(key => !lockedKeys.some(row => row.key === key)).sort(), lockedKeys,
    maxConcurrentAgentsKey: 'agents.max_concurrent_threads_per_session', documentationUrl: 'https://developers.openai.com/codex/config-reference/', models: catalog().catalog,
    modelContext: { model: settings.model, maximum: 872_000, officialMaximum: 1_050_000, configured: null, effective: 872_000, autoCompactTokenLimit: 784_800, defaultAutoCompactTokenLimit: 784_800, source: 'native' },
    mcpEnvironment: [], restartRequired: false, settings: { ...settings, modelContextWindow: 872_000, autoCompactTokenLimit: 784_800 } };
}
function skills(workspace = 'one', count = 65): CodexSkillList {
  return { skills: Array.from({ length: count }, (_, index) => ({ name: `Skill ${String(index).padStart(3, '0')}`, description: `Native skill ${index} for ${workspace}`,
    path: `/workspace/${workspace}/.agents/skills/skill-${index}/SKILL.md`, scope: index % 2 ? 'user' : 'repo', enabled: index !== 1 })),
    errors: [{ path: `/workspace/${workspace}/.agents/skills/invalid/SKILL.md`, message: 'The skill description is missing.' }] };
}
interface FixtureWindow extends Window { cliSettingsFixture: { selected: Array<{ path: string; name: string }>; managed: number;
  setWorkspace(value: string): void; setDraftKey(value: string): void; setOpen(value: boolean): void } }
let server: Server, origin = '';

test.beforeAll(async () => {
  const built = await build({ stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
    import { StrictMode, useLayoutEffect, useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import SettingsDialog from './client/components/SettingsDialog';
    import { SkillPicker } from './client/components/chat/SkillPicker';
    import ModelOptionsFields from './client/components/chat/ModelOptionsFields';
    import { api, json } from './client/api';
    import './client/styles.css';
    const config = window.cliSettingsInitial, fixture = window.cliSettingsFixture;
    function Harness() {
      const [value, setValue] = useState(config.settings), [open, setOpen] = useState(true), [workspaceId, setWorkspace] = useState('one');
      const [draftKey, setDraftKey] = useState('draft-one'), [selectedIds, setSelectedIds] = useState([]), [options, setOptions] = useState({ reasoningEffort: null, reasoningSummary: null });
      useLayoutEffect(() => { Object.assign(fixture, { setWorkspace, setDraftKey, setOpen }); }, []);
      return <main style={{ padding: 20 }}>
        {config.mode === 'picker' ? <><label>Message<textarea aria-label="Message" defaultValue="Keep this draft" /></label>
          <SkillPicker workspaceId={workspaceId} draftKey={draftKey} selectedIds={selectedIds} locked={false}
            onSelect={skill => { fixture.selected.push(skill); setSelectedIds(previous => [...previous, skill.path]); }} onManage={() => fixture.managed++} />
          <ModelOptionsFields value={options} onChange={setOptions} /><output aria-label="Selected skills">{selectedIds.join(String.fromCharCode(10))}</output></>
          : <><button type="button" onClick={() => setOpen(true)}>Open settings</button><SettingsDialog open={open} onClose={() => setOpen(false)} settings={value} workspaceId={workspaceId} initialTab={config.tab}
            onSave={async patch => { setValue(await api('/settings', json('PATCH', patch))); }}
            onLogout={async () => { await api('/session', json('DELETE', {})); document.body.dataset.workspaceLocked = 'true'; window.dispatchEvent(new Event('codex:session-locked')); setOpen(false); }} /></>}
      </main>;
    }
    createRoot(document.getElementById('root')).render(<StrictMode><Harness /></StrictMode>);
  ` }, bundle: true, write: false, outfile: 'codex-cli-settings-fixture.js', platform: 'browser', format: 'esm', target: 'es2022', jsx: 'automatic', logLevel: 'silent' });
  stop();
  const script = built.outputFiles.find(file => file.path.endsWith('.js'))!.text, css = built.outputFiles.find(file => file.path.endsWith('.css'))!.text;
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
test.afterAll(async () => { if (!server) return; server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
const reply = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
async function fixture(page: Page, config: { mode?: 'settings' | 'picker'; tab?: SettingsTab; settings?: Partial<AppSettings> } = {}) {
  const initialSettings = { ...settings, ...config.settings };
  await page.addInitScript(value => { Object.assign(window, { cliSettingsInitial: value, cliSettingsFixture: { selected: [], managed: 0 } }); }, { settings: initialSettings, mode: config.mode ?? 'settings', tab: config.tab ?? 'agent' });
  const requests: Array<{ method: string; path: string; body?: unknown }> = [], failures: string[] = [];
  let status = runtime(), models = catalog(), native = nativeSettings(), storedSettings: AppSettings = initialSettings, nativeRevision = 1;
  let updateHandler: ((route: Route) => Promise<unknown>) | undefined, restartHandler: ((route: Route) => Promise<unknown>) | undefined;
  let nativeSaveHandler: ((route: Route) => Promise<unknown>) | undefined, nativeReadHandler: ((route: Route) => Promise<unknown>) | undefined;
  let mcpCheckHandler: ((route: Route) => Promise<unknown>) | undefined;
  let readSkills: ((route: Route, workspace: string) => Promise<unknown>) | undefined;
  let writeSkills: ((route: Route, workspace: string) => Promise<unknown>) | undefined;
  let saveSettings: ((route: Route) => Promise<unknown>) | undefined;
  const lists = new Map<string, CodexSkillList>();
  page.on('pageerror', error => failures.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.slice(4), method = request.method();
    const body = request.postData() ? request.postDataJSON() : undefined;
    requests.push({ method, path, ...(body === undefined ? {} : { body }) });
    if (path === '/codex/runtime' && method === 'GET') return reply(route, status);
    if (path === '/codex/runtime/update' && method === 'POST') return updateHandler ? updateHandler(route) : reply(route, status, 202);
    if (path === '/codex/runtime/restart' && method === 'POST') return restartHandler ? restartHandler(route) : reply(route, status, 202);
    if (path === '/models') return reply(route, models);
    if (path === '/settings' && method === 'PATCH') {
      if (saveSettings) return saveSettings(route);
      storedSettings = { ...storedSettings, ...body }; return reply(route, storedSettings);
    }
    if (path === '/settings/native' && method === 'GET') return nativeReadHandler ? nativeReadHandler(route) : reply(route, native);
    if (path === '/settings/native' && method === 'PATCH') {
      if (nativeSaveHandler) return nativeSaveHandler(route);
      const patch = body as CodexNativeSettingsPatch;
      if (patch.expectedVersion !== native.version) return reply(route, { error: 'Native settings changed since this form was opened. Refresh before saving.' }, 409);
      for (const edit of patch.edits) { if (edit.value === null) delete native.userConfig[edit.keyPath]; else native.userConfig[edit.keyPath] = edit.value; }
      native.config = structuredClone(native.userConfig); native.version = 'native-version-' + (++nativeRevision);
      const selectedModel = String(native.config.model ?? settings.model), metadata = native.models.find(model => model.model === selectedModel);
      const context = Number(native.config.model_context_window ?? metadata?.maximumContextWindow ?? 0) || null;
      storedSettings = { ...storedSettings, ...patch.preferences, model: selectedModel,
        reasoningEffort: typeof native.config.model_reasoning_effort === 'string' ? native.config.model_reasoning_effort : null,
        reasoningSummary: typeof native.config.model_reasoning_summary === 'string' ? native.config.model_reasoning_summary as AppSettings['reasoningSummary'] : null,
        verbosity: typeof native.config.model_verbosity === 'string' ? native.config.model_verbosity as AppSettings['verbosity'] : null,
        serviceTier: typeof native.config.service_tier === 'string' ? native.config.service_tier : null,
        fastMode: native.config.service_tier == null || ['fast', 'priority', 'ultrafast'].includes(String(native.config.service_tier)), autoApprove: native.config.approval_policy === 'never',
        modelContextWindow: context, autoCompactTokenLimit: typeof native.config.model_auto_compact_token_limit === 'number' ? native.config.model_auto_compact_token_limit : context ? Math.floor(context * .9) : null,
        maxConcurrentAgents: typeof native.config.agents === 'object' && native.config.agents !== null && !Array.isArray(native.config.agents) && typeof native.config.agents.max_concurrent_threads_per_session === 'number' ? native.config.agents.max_concurrent_threads_per_session : null };
      native.settings = storedSettings;
      native.modelContext = { ...native.modelContext, model: selectedModel, maximum: metadata?.maximumContextWindow ?? null, officialMaximum: metadata?.officialMaximumContextWindow ?? null,
        configured: typeof native.config.model_context_window === 'number' ? native.config.model_context_window : null, effective: context,
        autoCompactTokenLimit: storedSettings.autoCompactTokenLimit ?? null, defaultAutoCompactTokenLimit: context ? Math.floor(context * .9) : null };
      for (const entry of patch.mcpEnvironment ?? []) {
        native.mcpEnvironment = native.mcpEnvironment.filter(variable => variable.name !== entry.name);
        if (entry.value !== null) native.mcpEnvironment.push({ name: entry.name });
        native.restartRequired = true;
      }
      return reply(route, native);
    }
    if (path === '/settings/native/mcp/check' && method === 'POST') return mcpCheckHandler ? mcpCheckHandler(route) : reply(route, { servers: [], checkedAt: '2026-09-23T10:00:00Z', nextCursor: null, restartRequired: native.restartRequired });
    if (path === '/session' && method === 'DELETE') return reply(route, { authenticated: false });
    const match = /^\/workspaces\/([^/]+)\/codex\/skills$/.exec(path);
    if (match) {
      if (!lists.has(match[1])) lists.set(match[1], skills(match[1]));
      if (method === 'GET') return readSkills ? readSkills(route, match[1]) : reply(route, lists.get(match[1]));
      if (method === 'PATCH') {
        if (writeSkills) return writeSkills(route, match[1]);
        const selected = lists.get(match[1])!.skills.find(skill => skill.path === body.path);
        if (!selected) return reply(route, { error: 'This native skill no longer exists.' }, 409);
        selected.enabled = body.enabled; return reply(route, { ok: true });
      }
    }
    return reply(route, { error: `Unexpected fixture request: ${method} ${path}` }, 404);
  });
  return { requests, failures, lists, setRuntime(value: CodexRuntimeStatus) { status = value; }, setModels(value: CodexModelCatalog) { models = value; native.models = value.catalog; },
    getNative() { return structuredClone(native); }, setNative(value: CodexNativeSettings) { native = value; }, onNativeSave(handler: typeof nativeSaveHandler) { nativeSaveHandler = handler; }, onNativeRead(handler: typeof nativeReadHandler) { nativeReadHandler = handler; }, onRestart(handler: typeof restartHandler) { restartHandler = handler; }, onMcpCheck(handler: typeof mcpCheckHandler) { mcpCheckHandler = handler; },
    onUpdate(handler: typeof updateHandler) { updateHandler = handler; }, onSkillRead(handler: typeof readSkills) { readSkills = handler; }, onSkillWrite(handler: typeof writeSkills) { writeSkills = handler; }, onSave(handler: typeof saveSettings) { saveSettings = handler; },
    async open() { await page.goto(origin); await expect(config.mode === 'picker' ? page.getByRole('textbox', { name: 'Message', exact: true }) : page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible(); },
  };
}
const runtimeCard = (page: Page) => page.getByRole('region', { name: 'Codex CLI', exact: true });
async function choose(page: Page, name: string, value: string) {
  await page.getByRole('combobox', { name, exact: true }).click();
  await page.locator(`[role="option"][data-value=${JSON.stringify(value)}]`).click();
}
const categoryLabels: Record<SettingsTab, string> = {
  agent: 'Model & responses', context: 'Context & agents', tools: 'Tools & permissions', mcp: 'MCP servers',
  skills: 'Skills', appearance: 'Appearance', runtime: 'Codex updates', advanced: 'More settings',
};
async function navigate(page: Page, category: SettingsTab) {
  if (await page.getByRole('combobox', { name: 'Settings category', exact: true }).isVisible()) {
    await choose(page, 'Settings category', category);
  } else {
    await page.getByRole('navigation', { name: 'Settings categories', exact: true }).getByRole('button', { name: categoryLabels[category], exact: true }).click();
  }
  await expect(page.locator(`#settings-panel-${category}`)).toBeVisible();
}

test('native settings expose supported settings and actual runtime state without provider controls', async ({ page }) => {
  const data = await fixture(page); await data.open();
  const nav = page.getByRole('navigation', { name: 'Settings categories' });
  await expect(nav.getByRole('button')).toHaveText([...Object.values(categoryLabels), 'Lock workspace']);
  await expect(page.getByRole('button', { name: /Sign in|Connect ChatGPT|Change provider|Set API key/i })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Response speed', exact: true })).toHaveText('Fast');
  await navigate(page, 'runtime');
  await expect(runtimeCard(page)).toContainText('Version 0.155.1');
  await expect(page.getByRole('button', { name: 'Update Codex', exact: true })).toBeEnabled();
  expect(data.requests.every(request => request.method === 'GET' && ['/models', '/codex/runtime', '/settings/native'].includes(request.path))).toBe(true);
  expect(data.failures).toEqual([]);
});

test('Ultrafast survives model switches, unrelated saves, reopening and reloads for models without tier metadata', async ({ page }) => {
  const data = await fixture(page), models = catalog();
  models.models.push('gpt-6-sol', 'future/model:2040');
  models.catalog.push({ ...models.catalog[0], id: 'six-sol', model: 'gpt-6-sol', displayName: 'GPT-6 Sol', isDefault: false,
    serviceTiers: [{ id: 'fast', name: 'Fast', description: '' }] },
  { ...models.catalog[1], id: 'future-model', model: 'future/model:2040', displayName: 'Future model', serviceTiers: [] });
  data.setModels(models); await data.open();
  const speed = page.getByRole('combobox', { name: 'Response speed', exact: true });
  const save = page.getByRole('button', { name: 'Save changes', exact: true });
  const closed = () => expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
  const writes = () => data.requests.filter(request => request.path === '/settings/native' && request.method === 'PATCH').map(request => request.body as CodexNativeSettingsPatch);
  await choose(page, 'Default model', 'gpt-6-sol');
  await speed.click();
  await expect(page.getByRole('listbox').getByRole('option')).toHaveText(['Auto', 'Standard', 'Flex', 'Scale', 'Priority', 'Fast', 'Ultrafast']);
  await page.getByRole('option', { name: 'Ultrafast', exact: true }).click();
  await choose(page, 'Default model', 'future/model:2040');
  await expect(speed).toHaveText('Ultrafast');
  await save.click(); await closed();
  expect(writes()[0].edits).toEqual([{ keyPath: 'model', value: 'future/model:2040' }, { keyPath: 'service_tier', value: 'ultrafast' }]);

  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await expect(speed).toHaveText('Ultrafast');
  await navigate(page, 'appearance');
  await page.getByRole('switch', { name: 'Wrap long lines', exact: true }).click();
  await save.click(); await closed();
  expect(data.requests.filter(request => request.path === '/settings').at(-1)?.body).toEqual({ wordWrap: false });
  expect(data.getNative().config.service_tier).toBe('ultrafast');

  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await expect(speed).toHaveText('Ultrafast');
  await page.getByRole('button', { name: 'Reload settings', exact: true }).click();
  await expect(speed).toBeEnabled(); await expect(speed).toHaveText('Ultrafast');
  await choose(page, 'Default model', 'gpt-6-sol');
  await save.click(); await closed();
  expect(writes()[1].edits).toEqual([{ keyPath: 'model', value: 'gpt-6-sol' }]);
  expect(data.getNative().config.service_tier).toBe('ultrafast');

  await page.reload(); await expect(speed).toBeEnabled(); await expect(speed).toHaveText('Ultrafast');
  await choose(page, 'Response speed', 'priority'); await save.click(); await closed();
  expect(writes().at(-1)?.edits).toEqual([{ keyPath: 'service_tier', value: 'priority' }]);
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await expect(speed).toHaveText('Priority');
  await choose(page, 'Response speed', 'default'); await save.click(); await closed();
  expect(writes().at(-1)?.edits).toEqual([{ keyPath: 'service_tier', value: 'default' }]);
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await expect(speed).toHaveText('Standard');
  expect(JSON.stringify(data.requests.filter(request => request.method === 'PATCH'))).not.toContain('fastMode');
  expect(data.failures).toEqual([]);
});

for (const tier of ['fast', 'future/provider-tier']) test(`unrelated saves retain the exact saved ${tier} tier`, async ({ page }) => {
  const data = await fixture(page, { settings: { serviceTier: tier, fastMode: false } }), native = data.getNative();
  native.config.service_tier = tier; native.userConfig.service_tier = tier;
  native.settings = { ...native.settings, serviceTier: tier, fastMode: false }; data.setNative(native);
  await data.open();
  const speed = page.getByRole('combobox', { name: 'Response speed', exact: true }), label = tier === 'fast' ? 'Fast' : tier;
  await expect(speed).toBeEnabled(); await expect(speed).toHaveText(label);
  await speed.click(); await expect(page.getByRole('option', { name: 'Ultrafast', exact: true })).toBeEnabled(); await page.keyboard.press('Escape');
  await choose(page, 'Public reasoning summary', 'none');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
  const write = data.requests.find(request => request.path === '/settings/native' && request.method === 'PATCH')!.body as CodexNativeSettingsPatch;
  expect(write.edits).toEqual([{ keyPath: 'model_reasoning_summary', value: 'none' }]);
  expect(data.getNative().config.service_tier).toBe(tier);
  await page.getByRole('button', { name: 'Open settings', exact: true }).click(); await expect(speed).toHaveText(label);
  await navigate(page, 'appearance'); await page.getByRole('switch', { name: 'Wrap long lines', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
  expect(data.requests.filter(request => request.path === '/settings').at(-1)?.body).toEqual({ wordWrap: false });
  await page.reload(); await expect(speed).toBeEnabled(); await expect(speed).toHaveText(label);
  expect(data.getNative().config.service_tier).toBe(tier);
  expect(JSON.stringify(data.requests.filter(request => request.method === 'PATCH'))).not.toContain('fastMode');
  expect(data.failures).toEqual([]);
});

test('Update Codex posts once, polls accepted progress and shows only the actual new version', async ({ page }) => {
  const data = await fixture(page, { tab: 'runtime' }); await data.open();
  await expect(runtimeCard(page)).toContainText('Version 0.155.1');
  data.onUpdate(async route => { const value = { ...runtime(), state: 'updating' as const, canUpdate: false }; data.setRuntime(value); return reply(route, value, 202); });
  const button = page.getByRole('button', { name: 'Update Codex', exact: true });
  await button.click(); await expect(button).toBeDisabled(); await expect(runtimeCard(page).getByRole('status')).toHaveText('Updating');
  await button.dispatchEvent('click');
  await expect.poll(() => data.requests.filter(request => request.path === '/codex/runtime').length).toBeGreaterThan(2);
  await expect(runtimeCard(page)).toContainText('Version 0.155.1');
  data.setRuntime({ ...runtime(), version: '0.156.0', installedVersion: '0.156.0' });
  await expect(runtimeCard(page)).toContainText('Version 0.156.0'); await expect(button).toBeEnabled();
  expect(data.requests.filter(request => request.path === '/codex/runtime/update')).toEqual([{ method: 'POST', path: '/codex/runtime/update', body: {} }]);
  expect(data.failures).toEqual([]);
});

test('runtime refusals and native update blocking stay visible without inventing a successful version', async ({ page }) => {
  const data = await fixture(page, { tab: 'runtime' }); data.onUpdate(route => reply(route, { error: 'A Codex turn is still running.' }, 409)); await data.open();
  await page.getByRole('button', { name: 'Update Codex', exact: true }).click();
  await expect(runtimeCard(page).getByRole('alert')).toContainText('A Codex turn is still running.');
  await expect(runtimeCard(page)).toContainText('Version 0.155.1');
  data.setRuntime({ ...runtime(), canUpdate: false, activeTurns: 1, updateBlockedReason: 'Finish the active turn before updating Codex.' });
  await page.getByRole('button', { name: 'Refresh Codex status' }).click();
  await expect(runtimeCard(page)).toContainText('Finish the active turn');
  await expect(page.getByRole('button', { name: 'Update Codex', exact: true })).toBeDisabled();
  expect(data.requests.filter(request => request.method === 'POST')).toHaveLength(1);
});

test('native model identities, literal effort, summary and global verbosity reach the exact settings payload', async ({ page }) => {
  const data = await fixture(page); await data.open();
  await page.getByRole('combobox', { name: 'Default model', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search Default model', exact: true }).fill('Research');
  const model = page.getByRole('option', { name: /Research model/ });
  await expect(model).toHaveAttribute('data-value', 'owner/model:literal'); await model.click();
  await choose(page, 'Reasoning effort', 'opaque_max'); await choose(page, 'Public reasoning summary', 'none');
  await page.getByRole('group', { name: 'Response detail', exact: true }).getByRole('button', { name: 'Detailed', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Detailed', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(data.requests.filter(request => request.method !== 'GET')).toHaveLength(0);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
  expect(data.requests.filter(request => request.path === '/settings/native' && request.method === 'PATCH')).toEqual([{ method: 'PATCH', path: '/settings/native', body: {
    expectedVersion: 'native-version-1', edits: [{ keyPath: 'model', value: 'owner/model:literal' }, { keyPath: 'model_reasoning_effort', value: 'opaque_max' }, { keyPath: 'model_reasoning_summary', value: 'none' }, { keyPath: 'model_verbosity', value: 'high' }],
  } }]);
  expect(data.requests.filter(request => request.path === '/settings')).toEqual([{ method: 'PATCH', path: '/settings', body: {} }]);
  expect(data.requests.some(request => /model-profiles|model-probes/.test(request.path))).toBe(false);
});

test('appearance drafts survive tab changes, rejected saves and discard cancellation independently of model availability', async ({ page }) => {
  const data = await fixture(page); data.setModels({ backend: 'codex-cli', catalog: [], models: [], connected: false });
  data.onSave(route => reply(route, { error: 'The settings could not be saved.' }, 503)); await data.open();
  await navigate(page, 'appearance');
  await page.getByRole('group', { name: 'Font size presets', exact: true }).getByRole('button', { name: /Compact/ }).click();
  const size = page.getByLabel('Editor font size', { exact: true }); await expect(size).toHaveValue('12');
  await size.focus(); await size.press('ArrowRight'); await size.press('ArrowRight');
  await page.getByRole('switch', { name: 'Wrap long lines', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('unsaved settings');
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await navigate(page, 'skills'); await expect(page.getByRole('region', { name: 'Codex skills' })).toBeVisible();
  await navigate(page, 'appearance'); await expect(size).toHaveValue('14');
  await expect(page.getByRole('switch', { name: 'Wrap long lines' })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('could not be saved');
  await expect(size).toHaveValue('14'); data.onSave(undefined); await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
  expect(data.requests.filter(request => request.path === '/settings').map(request => request.body)).toEqual([{ fontSize: 14, wordWrap: false }, { fontSize: 14, wordWrap: false }]);
});

test('skills use native absolute paths, bounded rows, local search and acknowledged enablement', async ({ page }) => {
  const data = await fixture(page, { tab: 'skills' }); await data.open();
  const panel = page.getByRole('region', { name: 'Codex skills' }), rows = panel.getByRole('list', { name: 'Available skills' }).getByRole('listitem');
  await expect(rows).toHaveCount(30); const reads = data.requests.filter(request => request.path.endsWith('/codex/skills')).length;
  await panel.getByRole('searchbox', { name: 'Search skills' }).fill('Skill 064'); await expect(rows).toHaveCount(1);
  expect(data.requests.filter(request => request.path.endsWith('/codex/skills'))).toHaveLength(reads);
  const toggle = panel.getByRole('switch', { name: 'Skill 064', exact: true }); await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click(); await expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(data.requests.filter(request => request.method === 'PATCH')).toEqual([{ method: 'PATCH', path: '/workspaces/one/codex/skills', body: { path: '/workspace/one/.agents/skills/skill-64/SKILL.md', enabled: false } }]);
  await panel.getByText('1 skill could not be read', { exact: true }).click(); await expect(panel).toContainText('The skill description is missing.');
  await expect(panel.getByText(/Install|Import|marketplace|revision/i)).toHaveCount(0);
  expect(data.failures).toEqual([]);
});

test('late skill mutation replies cannot replace another workspace list', async ({ page }) => {
  const data = await fixture(page, { tab: 'skills' }); let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  data.onSkillWrite(async route => { await held; return reply(route, { ok: true }); }); await data.open();
  const panel = page.getByRole('region', { name: 'Codex skills' });
  await panel.getByRole('switch', { name: 'Skill 000', exact: true }).click(); await expect(panel.getByRole('switch', { name: 'Skill 000', exact: true })).toBeDisabled();
  await page.evaluate(() => (window as unknown as FixtureWindow).cliSettingsFixture.setWorkspace('two'));
  await expect(panel).toContainText('/workspace/two/.agents/skills/skill-0/SKILL.md'); release();
  await expect(panel.getByRole('switch', { name: 'Skill 000', exact: true })).toBeEnabled();
  await expect(panel).not.toContainText('/workspace/one/');
  expect(data.requests.filter(request => request.method === 'PATCH')).toHaveLength(1);
  expect(data.failures).toEqual([]);
});

test('skill failures remain visible and do not optimistically enable an unavailable skill', async ({ page }) => {
  const data = await fixture(page, { tab: 'skills' }); data.onSkillWrite(route => reply(route, { error: 'Codex refused this skill change.' }, 409)); await data.open();
  const panel = page.getByRole('region', { name: 'Codex skills' }), toggle = panel.getByRole('switch', { name: 'Skill 001', exact: true });
  await expect(toggle).toHaveAttribute('aria-checked', 'false'); await toggle.click(); await expect(panel.getByRole('alert')).toContainText('Codex refused this skill change.');
  await expect(toggle).toHaveAttribute('aria-checked', 'false'); await expect(toggle).toBeEnabled();
});

test('the composer picker selects native skill paths and keeps per-turn options limited to summaries', async ({ page }) => {
  const data = await fixture(page, { mode: 'picker' }); data.lists.set('one', skills('one', 1000)); await data.open();
  expect(data.requests).toHaveLength(0);
  await page.getByRole('combobox', { name: 'Add a skill', exact: true }).click(); await expect(page.getByRole('option')).toHaveCount(31);
  await page.getByPlaceholder('Find a skill…').fill('Skill 999');
  const choice = page.getByRole('option', { name: /Skill 999/ }); await expect(choice).toHaveAttribute('data-value', '/workspace/one/.agents/skills/skill-999/SKILL.md'); await choice.click();
  await expect(page.getByRole('status', { name: 'Selected skills' })).toContainText('/workspace/one/.agents/skills/skill-999/SKILL.md');
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).cliSettingsFixture.selected.map(skill => ({ name: skill.name, path: skill.path })))).toEqual([{ name: 'Skill 999', path: '/workspace/one/.agents/skills/skill-999/SKILL.md' }]);
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Keep this draft');
  await expect(page.getByRole('combobox', { name: 'Public reasoning summary', exact: true })).toBeVisible();
  await expect(page.getByText(/Response verbosity|Output token budget/)).toHaveCount(0);
  expect(data.requests.every(request => request.method === 'GET' && request.path === '/workspaces/one/codex/skills')).toBe(true);
});

for (const width of [320, 390, 820, 1440]) test(`native settings remain opaque, keyboard usable and within ${width}px layout`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: width <= 390 ? 844 : 960 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  const data = await fixture(page); await data.open(); const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  const mobileCategory = page.getByRole('combobox', { name: 'Settings category', exact: true });
  if (width <= 760) await expect(mobileCategory).toBeVisible(); else await expect(mobileCategory).toHaveCount(0);
  const assertFits = async () => {
    for (const element of [page.locator('.settings-content'), dialog]) {
      const bounds = await element.evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth, left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right }));
      expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1); expect(bounds.left).toBeGreaterThanOrEqual(-1); expect(bounds.right).toBeLessThanOrEqual(width + 1);
    }
  };
  await expect(page.getByRole('button', { name: 'Detailed', exact: true })).toBeEnabled(); await assertFits();
  if (width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`codex-model-responses-${width}.png`), fullPage: true });
  const speed = page.getByRole('combobox', { name: 'Response speed', exact: true });
  await speed.scrollIntoViewIfNeeded(); await speed.click();
  const ultrafast = page.getByRole('option', { name: 'Ultrafast', exact: true }); await expect(ultrafast).toBeEnabled();
  if (width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`codex-response-speed-options-${width}.png`), fullPage: true });
  await ultrafast.click(); await expect(speed).toHaveText('Ultrafast'); await assertFits();
  if (width <= 390) expect((await speed.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: 'Reload settings', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(speed).toBeEnabled(); await expect(speed).toHaveText('Fast');
  await navigate(page, 'context');
  await expect(page.getByRole('button', { name: '8 agents', exact: true })).toBeEnabled(); await assertFits();
  if (width === 390 || width === 1440) {
    await page.screenshot({ path: testInfo.outputPath(`codex-context-agents-${width}.png`), fullPage: true });
    await page.getByRole('switch', { name: 'Use recommended threshold (90%)', exact: true }).scrollIntoViewIfNeeded();
    await assertFits(); await page.screenshot({ path: testInfo.outputPath(`codex-context-compaction-${width}.png`), fullPage: true });
  }
  await navigate(page, 'runtime');
  const update = page.getByRole('button', { name: 'Update Codex', exact: true }); await expect(update).toBeEnabled();
  await update.focus(); await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'Restart Codex', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'Refresh Codex status' })).toBeFocused();
  const geometry = await runtimeCard(page).evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth, shadow: getComputedStyle(element).boxShadow, backdrop: getComputedStyle(element).backdropFilter, background: getComputedStyle(element).backgroundColor }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1); expect(geometry.shadow).toBe('none'); expect(geometry.backdrop).toBe('none'); expect(geometry.background).not.toBe('rgba(0, 0, 0, 0)');
  if (width <= 390) expect((await update.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await assertFits();
  await expect(dialog).toBeInViewport(); await page.screenshot({ path: testInfo.outputPath(`codex-settings-${width}.png`), fullPage: true }); expect(data.failures).toEqual([]);
});

test('response speed, concurrent agents and context controls save one native draft with the real model maximum', async ({ page }) => {
  const data = await fixture(page); await data.open();
  await choose(page, 'Response speed', 'default');
  await navigate(page, 'context');
  await expect(page.getByRole('switch', { name: 'Use model maximum', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Context window (tokens)', { exact: true })).toHaveValue('872000');
  await expect(page.getByLabel('Compaction threshold (tokens)', { exact: true })).toHaveValue('784800');
  await expect(page.getByRole('switch', { name: 'Use recommended threshold (90%)', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('The published API maximum is 1,050,000 tokens.', { exact: false })).toBeVisible();
  await page.getByLabel('Maximum concurrent agents', { exact: true }).fill('8');
  await page.getByRole('switch', { name: 'Use model maximum', exact: true }).click();
  await page.getByLabel('Context window (tokens)', { exact: true }).fill('200000');
  await expect(page.getByLabel('Compaction threshold (tokens)', { exact: true })).toHaveValue('180000');
  const slider = page.getByRole('slider', { name: 'Auto-compaction percentage', exact: true }); await slider.focus(); await slider.press('ArrowLeft');
  await expect(page.getByLabel('Compaction threshold (tokens)', { exact: true })).toHaveValue('178000');
  expect(data.requests.filter(request => request.method !== 'GET')).toHaveLength(0);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
  const write = data.requests.find(request => request.path === '/settings/native' && request.method === 'PATCH')!.body as CodexNativeSettingsPatch;
  expect(write).toEqual({ expectedVersion: 'native-version-1', edits: [
    { keyPath: 'agents', value: { max_concurrent_threads_per_session: 8 } }, { keyPath: 'model_auto_compact_token_limit', value: 178000 },
    { keyPath: 'model_context_window', value: 200000 }, { keyPath: 'service_tier', value: 'default' },
  ] });
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Response speed', exact: true })).toHaveText('Standard');
  await navigate(page, 'context');
  await expect(page.getByLabel('Maximum concurrent agents', { exact: true })).toHaveValue('8');
  await expect(page.getByLabel('Context window (tokens)', { exact: true })).toHaveValue('200000');
  await expect(page.getByLabel('Compaction threshold (tokens)', { exact: true })).toHaveValue('178000');
  expect(data.failures).toEqual([]);
});

test('context bounds reject overcapacity and current GPT-6 Sol catalog choices retain exact model and effort values', async ({ page }) => {
  const data = await fixture(page), models = catalog();
  models.models.push('gpt-6-sol'); models.catalog.push({ ...models.catalog[0], id: 'native-six-sol', model: 'gpt-6-sol', displayName: 'GPT-6 Sol', isDefault: false,
    supportedReasoningEfforts: [{ reasoningEffort: 'max', description: 'Maximum reasoning' }], defaultReasoningEffort: 'max' });
  data.setModels(models); await data.open();
  await navigate(page, 'context');
  await page.getByRole('switch', { name: 'Use model maximum', exact: true }).click(); await page.getByLabel('Context window (tokens)', { exact: true }).fill('1050000');
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  await expect(page.getByText('This Codex catalog supports at most 872,000 context tokens for this model.', { exact: true })).toBeVisible();
  await navigate(page, 'agent');
  await page.getByRole('combobox', { name: 'Default model', exact: true }).click(); await page.getByRole('combobox', { name: 'Search Default model', exact: true }).fill('GPT-6 Sol');
  await page.locator('[role="option"][data-value="gpt-6-sol"]').click(); await choose(page, 'Reasoning effort', 'max');
  await navigate(page, 'context');
  await expect(page.getByRole('switch', { name: 'Use model maximum', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled(); await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  const write = data.requests.find(request => request.path === '/settings/native' && request.method === 'PATCH')!.body as CodexNativeSettingsPatch;
  expect(write.edits).toEqual([{ keyPath: 'model', value: 'gpt-6-sol' }, { keyPath: 'model_reasoning_effort', value: 'max' }]);
  expect(data.failures).toEqual([]);
});

test('response detail buttons save literal values and Default removes only the verbosity override', async ({ page }) => {
  const data = await fixture(page, { settings: { verbosity: 'high' } }), native = data.getNative();
  native.config.model_verbosity = 'high'; native.userConfig.model_verbosity = 'high'; data.setNative(native); await data.open();
  const writes = () => data.requests.filter(request => request.path === '/settings/native' && request.method === 'PATCH').map(request => request.body);
  const choices = [{ label: 'Concise', value: 'low', key: 'Space' }, { label: 'Balanced', value: 'medium', key: 'Enter' }, { label: 'Default', value: null, key: 'Space' }];
  for (const [index, choice] of choices.entries()) {
    const button = page.getByRole('group', { name: 'Response detail', exact: true }).getByRole('button', { name: choice.label, exact: true });
    await button.focus(); await button.press(choice.key); await expect(button).toHaveAttribute('aria-pressed', 'true');
    await navigate(page, 'tools'); await navigate(page, 'agent'); await expect(button).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
    expect(writes()[index]).toEqual({ expectedVersion: `native-version-${index + 1}`, edits: [{ keyPath: 'model_verbosity', value: choice.value }] });
    await page.getByRole('button', { name: 'Open settings', exact: true }).click(); await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  expect(data.getNative().userConfig).not.toHaveProperty('model_verbosity');
  expect(data.getNative().userConfig.model_reasoning_summary).toBe('auto'); expect(data.failures).toEqual([]);
});

test('managed response defaults reset only editable keys and retain disabled controls', async ({ page }) => {
  for (const managedKey of ['model_verbosity', 'model_reasoning_summary'] as const) {
    const currentPage = managedKey === 'model_verbosity' ? page : await page.context().newPage();
    try {
      const savedPreferences = { verbosity: 'high' as const, reasoningSummary: 'detailed' as const };
      const data = await fixture(currentPage, { settings: savedPreferences }), native = data.getNative();
      Object.assign(native.userConfig, { model_verbosity: 'high', model_reasoning_summary: 'detailed' });
      native.config = structuredClone(native.userConfig); native.settings = { ...native.settings, ...savedPreferences };
      native.editableKeys = native.editableKeys.filter(key => key !== managedKey);
      native.lockedKeys.push({ key: managedKey, reason: 'This response preference is managed by the host.' });
      data.setNative(native); await data.open();
      const responses = currentPage.getByRole('region', { name: 'Response preferences', exact: true });
      const details = responses.getByRole('group', { name: 'Response detail', exact: true });
      const summary = responses.getByRole('combobox', { name: 'Public reasoning summary', exact: true });
      const defaults = responses.getByRole('button', { name: 'Use defaults', exact: true });
      const assertManaged = async () => {
        if (managedKey === 'model_verbosity') {
          for (const label of ['Default', 'Concise', 'Balanced', 'Detailed']) await expect(details.getByRole('button', { name: label, exact: true })).toBeDisabled();
          await expect(details.getByRole('button', { name: 'Detailed', exact: true })).toHaveAttribute('aria-pressed', 'true');
          await expect(summary).toBeEnabled();
        } else {
          await expect(summary).toBeDisabled(); await expect(summary).toHaveText('detailed');
          await expect(details.getByRole('button', { name: 'Default', exact: true })).toBeEnabled();
        }
      };
      await assertManaged(); await expect(defaults).toBeEnabled(); await defaults.click();
      await assertManaged(); await expect(defaults).toBeDisabled();
      if (managedKey === 'model_verbosity') await expect(summary).toHaveText('Codex default');
      else await expect(details.getByRole('button', { name: 'Default', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await currentPage.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(currentPage.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
      const editableKey = managedKey === 'model_verbosity' ? 'model_reasoning_summary' : 'model_verbosity';
      expect(data.requests.filter(request => request.path === '/settings/native' && request.method === 'PATCH')).toEqual([{ method: 'PATCH', path: '/settings/native', body: {
        expectedVersion: 'native-version-1', edits: [{ keyPath: editableKey, value: null }],
      } }]);
      expect(data.requests.filter(request => request.path === '/settings')).toEqual([{ method: 'PATCH', path: '/settings', body: {} }]);
      expect(data.getNative().userConfig[managedKey]).toBe(managedKey === 'model_verbosity' ? 'high' : 'detailed');
      expect(data.getNative().userConfig).not.toHaveProperty(editableKey);
      await currentPage.getByRole('button', { name: 'Open settings', exact: true }).click();
      await assertManaged(); await expect(defaults).toBeDisabled(); expect(data.failures).toEqual([]);
    } finally {
      if (currentPage !== page) await currentPage.close();
    }
  }
});

test('short laptop footer stays accessible while long settings categories scroll', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 650 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  const data = await fixture(page, { tab: 'context' }); await data.open();
  const content = page.locator('.settings-content'), close = page.getByRole('button', { name: 'Close', exact: true }), save = page.getByRole('button', { name: 'Save changes', exact: true });
  await page.getByRole('button', { name: '8 agents', exact: true }).click();
  const assertFooter = async () => {
    await expect(close).toBeInViewport({ ratio: 1 }); await expect(close).toBeEnabled();
    await expect(save).toBeInViewport({ ratio: 1 }); await expect(save).toBeEnabled();
    for (const button of [close, save]) {
      const bounds = await button.boundingBox(); expect(bounds).not.toBeNull();
      expect(bounds!.y).toBeGreaterThanOrEqual(0); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(650);
    }
  };
  await assertFooter(); const footerTop = (await save.boundingBox())!.y;
  expect(await content.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await page.getByRole('slider', { name: 'Auto-compaction percentage', exact: true }).scrollIntoViewIfNeeded();
  expect(await content.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await assertFooter(); expect(Math.abs((await save.boundingBox())!.y - footerTop)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('codex-settings-short-laptop-context.png'), fullPage: true });
  await navigate(page, 'advanced'); await choose(page, 'Settings group', 'memory'); await choose(page, 'Settings section', '$all');
  expect(await content.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await page.locator('.native-option-row').last().scrollIntoViewIfNeeded();
  expect(await content.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await assertFooter(); expect(Math.abs((await save.boundingBox())!.y - footerTop)).toBeLessThanOrEqual(1);
  await close.focus(); await page.keyboard.press('Tab'); await expect(save).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('codex-settings-short-laptop-more.png'), fullPage: true });
  await page.keyboard.press('Enter'); await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
  expect(data.requests.find(request => request.path === '/settings/native' && request.method === 'PATCH')?.body).toEqual({ expectedVersion: 'native-version-1', edits: [
    { keyPath: 'agents', value: { max_concurrent_threads_per_session: 8 } },
  ] });
  expect(data.failures).toEqual([]);
});

test('agent and context presets remain exact through keyboard sliders, navigation and reopening', async ({ page }) => {
  const data = await fixture(page, { tab: 'context', settings: { maxConcurrentAgents: 3 } }), native = data.getNative();
  const adjacent = { max_depth: 2, researcher: { config_file: '/workspace/researcher.toml' } };
  native.config.agents = { ...adjacent, max_concurrent_threads_per_session: 3 };
  native.userConfig.agents = structuredClone(native.config.agents); data.setNative(native); await data.open();
  await page.getByRole('button', { name: '4 agents', exact: true }).click();
  const agents = page.getByRole('slider', { name: 'Concurrent agent quick limit', exact: true });
  await agents.focus(); await agents.press('ArrowRight'); await expect(page.getByLabel('Maximum concurrent agents', { exact: true })).toHaveValue('5');
  await page.getByRole('button', { name: 'Use 50% of model context', exact: true }).click();
  await expect(page.getByLabel('Context window (tokens)', { exact: true })).toHaveValue('436000');
  const context = page.getByRole('slider', { name: 'Context window size', exact: true });
  await context.focus(); await context.press('ArrowRight'); await expect(page.getByLabel('Context window (tokens)', { exact: true })).toHaveValue('436001');
  await expect(page.getByLabel('Compaction threshold (tokens)', { exact: true })).toHaveValue('392400');
  await context.press('ArrowLeft'); await page.getByRole('button', { name: 'Compact at 95% of context', exact: true }).click();
  await expect(page.getByLabel('Compaction threshold (tokens)', { exact: true })).toHaveValue('414200');
  const compaction = page.getByRole('slider', { name: 'Auto-compaction percentage', exact: true });
  await compaction.focus(); await compaction.press('ArrowLeft');
  await expect(page.getByLabel('Compaction threshold (tokens)', { exact: true })).toHaveValue('409840');
  await navigate(page, 'appearance'); await navigate(page, 'context');
  await expect(page.getByLabel('Maximum concurrent agents', { exact: true })).toHaveValue('5');
  await expect(page.getByLabel('Context window (tokens)', { exact: true })).toHaveValue('436000');
  await expect(page.getByLabel('Compaction threshold (tokens)', { exact: true })).toHaveValue('409840');
  expect(data.requests.filter(request => request.method !== 'GET')).toHaveLength(0);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
  expect(data.requests.find(request => request.path === '/settings/native' && request.method === 'PATCH')?.body).toEqual({ expectedVersion: 'native-version-1', edits: [
    { keyPath: 'agents', value: { ...adjacent, max_concurrent_threads_per_session: 5 } },
    { keyPath: 'model_auto_compact_token_limit', value: 409840 }, { keyPath: 'model_context_window', value: 436000 },
  ] });
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await expect(page.getByLabel('Maximum concurrent agents', { exact: true })).toHaveValue('5');
  await expect(page.getByLabel('Context window (tokens)', { exact: true })).toHaveValue('436000');
  await expect(page.getByLabel('Compaction threshold (tokens)', { exact: true })).toHaveValue('409840');
  await expect(page.getByRole('switch', { name: 'Use recommended threshold (90%)', exact: true })).toHaveAttribute('aria-checked', 'false');
  expect(data.failures).toEqual([]);
});

test('large custom concurrency stays unchanged and individual resets retain adjacent native preferences', async ({ page }) => {
  const data = await fixture(page, { tab: 'context', settings: { maxConcurrentAgents: 512, modelContextWindow: 200000, autoCompactTokenLimit: 150000 } });
  const native = data.getNative(), adjacent = { enabled: true, max_depth: 2, researcher: { config_file: '/workspace/researcher.toml' } };
  Object.assign(native.userConfig, { agents: { ...adjacent, max_concurrent_threads_per_session: 512 }, model_context_window: 200000, model_auto_compact_token_limit: 150000 });
  native.config = structuredClone(native.userConfig); data.setNative(native); await data.open();
  await expect(page.getByLabel('Maximum concurrent agents', { exact: true })).toHaveValue('512');
  await expect(page.getByRole('slider', { name: 'Concurrent agent quick limit', exact: true })).toHaveCount(0);
  await expect(page.getByText('Your custom limit is outside the quick range.', { exact: false })).toBeVisible();
  await navigate(page, 'agent'); await navigate(page, 'context');
  await expect(page.getByLabel('Maximum concurrent agents', { exact: true })).toHaveValue('512');
  await page.getByRole('button', { name: 'Reset compaction threshold to 90%', exact: true }).click();
  await expect(page.getByLabel('Compaction threshold (tokens)', { exact: true })).toHaveValue('180000');
  await expect(page.getByRole('switch', { name: 'Use recommended threshold (90%)', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
  const writes = () => data.requests.filter(request => request.path === '/settings/native' && request.method === 'PATCH').map(request => request.body);
  expect(writes()[0]).toEqual({ expectedVersion: 'native-version-1', edits: [{ keyPath: 'model_auto_compact_token_limit', value: null }] });
  expect(data.getNative().userConfig.agents).toEqual({ ...adjacent, max_concurrent_threads_per_session: 512 });
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await expect(page.getByLabel('Maximum concurrent agents', { exact: true })).toHaveValue('512');
  await page.getByRole('button', { name: 'Reset concurrent agents to Codex default', exact: true }).click();
  await expect(page.getByLabel('Maximum concurrent agents', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Use Codex default for concurrent agents', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Context window (tokens)', { exact: true })).toHaveValue('200000');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
  expect(writes()[1]).toEqual({ expectedVersion: 'native-version-2', edits: [{ keyPath: 'agents', value: adjacent }] });
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await page.getByRole('button', { name: 'Use maximum model context', exact: true }).click();
  await expect(page.getByLabel('Context window (tokens)', { exact: true })).toHaveValue('872000');
  await expect(page.getByLabel('Compaction threshold (tokens)', { exact: true })).toHaveValue('784800');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
  expect(writes()[2]).toEqual({ expectedVersion: 'native-version-3', edits: [{ keyPath: 'model_context_window', value: null }] });
  expect(data.getNative().userConfig.agents).toEqual(adjacent); expect(data.failures).toEqual([]);
});

test('native option groups, friendly search and customized filters edit only the selected overrides', async ({ page }) => {
  const data = await fixture(page, { tab: 'advanced' }), native = data.getNative();
  Object.assign(native.userConfig, { agents: { enabled: true, max_depth: 2 }, memories: { generate_memories: true, max_rollouts_per_startup: 32 } });
  native.config = { ...structuredClone(native.userConfig), memories: { generate_memories: true, max_rollouts_per_startup: 32, use_memories: true } };
  data.setNative(native); await data.open();
  const panel = page.getByRole('region', { name: 'Official Codex settings', exact: true }), search = page.getByRole('searchbox', { name: 'Search Codex settings', exact: true });
  await expect(panel.getByRole('button', { name: 'Browse Memory & history', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Settings group', exact: true })).toHaveText('Browse categories');
  await expect(panel.locator('.native-option-row')).toHaveCount(0);
  await expect(panel.locator('.native-structured-editor')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Browse Memory & history', exact: true }).click(); await choose(page, 'Settings section', '$all');
  const memory = page.getByRole('region', { name: 'Memory & history', exact: true });
  await expect(memory).toBeVisible(); await expect(memory.getByRole('switch', { name: 'Use memories', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Customized only', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Customized only', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(memory.locator('.native-option-row')).toHaveCount(2);
  await expect(memory.getByRole('switch', { name: 'Use memories', exact: true })).toHaveCount(0);
  const generate = memory.getByRole('switch', { name: 'Generate memories', exact: true }); await generate.focus(); await generate.press('Space');
  await expect(generate).toHaveAttribute('aria-checked', 'false');
  const passes = memory.getByRole('slider', { name: 'Conversations processed per memory pass slider', exact: true });
  await passes.focus(); await passes.press('ArrowRight'); await expect(memory.getByLabel('Conversations processed per memory pass', { exact: true })).toHaveValue('33');
  await page.getByRole('button', { name: 'Customized only', exact: true }).click();
  await choose(page, 'Settings group', '$recommended'); await search.fill('Tool output token budget');
  await expect(page.getByRole('combobox', { name: 'Settings group', exact: true })).toHaveText('All categories');
  await expect(page.getByRole('region', { name: 'Context & compaction', exact: true })).toBeVisible();
  await page.getByLabel('Tool output token budget', { exact: true }).fill('2400');
  await page.getByRole('button', { name: 'Increase Tool output token budget', exact: true }).click();
  await expect(page.getByLabel('Tool output token budget', { exact: true })).toHaveValue('2401');
  await page.getByRole('button', { name: 'Decrease Tool output token budget', exact: true }).click();
  await search.fill(''); await choose(page, 'Settings group', 'agents'); await choose(page, 'Settings section', 'agents-delegation');
  const agentGroup = page.getByRole('region', { name: 'Agents & goals', exact: true });
  await agentGroup.getByRole('switch', { name: 'Allow delegated agents', exact: true }).click();
  await choose(page, 'Settings section', 'agents-roles');
  await expect(agentGroup.getByRole('textbox', { name: 'Agents', exact: true })).toHaveCount(0);
  await agentGroup.locator('.native-option-row').filter({ has: page.locator('#codex-option-agents-label') }).getByText('Edit structured option', { exact: true }).click();
  await expect(agentGroup.getByRole('textbox', { name: 'Agents', exact: true })).toBeVisible();
  expect(JSON.parse(await agentGroup.getByRole('textbox', { name: 'Agents', exact: true }).inputValue())).toEqual({ enabled: false, max_depth: 2 });
  expect(data.requests.filter(request => request.method !== 'GET')).toHaveLength(0);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
  expect(data.requests.find(request => request.path === '/settings/native' && request.method === 'PATCH')?.body).toEqual({ expectedVersion: 'native-version-1', edits: [
    { keyPath: 'agents', value: { enabled: false, max_depth: 2 } },
    { keyPath: 'memories', value: { generate_memories: false, max_rollouts_per_startup: 33 } },
    { keyPath: 'tool_output_token_limit', value: 2400 },
  ] });
  expect(data.failures).toEqual([]);
});

test('More settings opens a category directory and supports keyboard section browsing and global search', async ({ page }) => {
  const data = await fixture(page, { tab: 'advanced' }); await data.open();
  const panel = page.getByRole('region', { name: 'Official Codex settings', exact: true });
  const rows = panel.locator('.native-option-row'), search = panel.getByRole('searchbox', { name: 'Search Codex settings', exact: true });
  const terminal = panel.getByRole('button', { name: 'Browse Native terminal', exact: true });
  await expect(terminal).toBeVisible(); await expect(rows).toHaveCount(0);
  await terminal.focus(); await terminal.press('Enter');
  await expect(panel.getByRole('combobox', { name: 'Settings group', exact: true })).toHaveText('Native terminal');
  await expect(panel.getByRole('combobox', { name: 'Settings section', exact: true })).toHaveText('Choose a section');
  await expect(rows).toHaveCount(0);
  const editing = panel.getByRole('button', { name: 'Browse Text editing shortcuts', exact: true });
  await editing.focus(); await editing.press('Space');
  await expect(panel.getByRole('combobox', { name: 'Settings section', exact: true })).toHaveText('Text editing shortcuts');
  await expect(rows.first()).toBeVisible();
  const paths = await rows.evaluateAll(elements => elements.map(element => element.getAttribute('data-setting-path')!));
  expect(paths).toHaveLength(16);
  expect(paths.every(path => path.startsWith('tui.keymap.editor.'))).toBe(true);
  await expect(panel.locator('.native-setting-details')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Show technical details', exact: true }).click();
  await expect(panel.locator('.native-setting-details')).toHaveCount(16);
  const firstDetails = rows.first().locator('.native-setting-details'); await firstDetails.getByText('Technical details', { exact: true }).click();
  await expect(firstDetails.locator('code')).toHaveText(paths[0]);
  await panel.getByRole('button', { name: 'Show technical details', exact: true }).click(); await expect(panel.locator('.native-setting-details')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Next codex settings', exact: true }).click(); await expect(rows).toHaveCount(1);
  const lastPage = await rows.evaluateAll(elements => elements.map(element => element.getAttribute('data-setting-path')!));
  expect(lastPage[0]).toMatch(/^tui\.keymap\.editor\./); expect(paths).not.toContain(lastPage[0]);
  await search.fill('tool_output_token_limit');
  await expect(panel.getByRole('combobox', { name: 'Settings group', exact: true })).toHaveText('All categories');
  await expect(panel.getByLabel('Tool output token budget', { exact: true })).toBeVisible();
  await expect(panel.getByRole('region', { name: 'Context & compaction', exact: true })).toBeVisible();
  await search.fill(''); await expect(panel.getByRole('combobox', { name: 'Settings group', exact: true })).toHaveText('All categories');
  const back = panel.getByRole('button', { name: 'All categories', exact: true });
  await back.focus(); await back.press('Enter');
  await expect(search).toHaveValue(''); await expect(terminal).toBeVisible(); await expect(rows).toHaveCount(0);
  await terminal.click(); await expect(panel.getByRole('combobox', { name: 'Settings section', exact: true })).toHaveText('Choose a section');
  await expect(rows).toHaveCount(0);
  await back.focus(); await back.press('Space'); await expect(terminal).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  expect(data.requests.filter(request => request.method !== 'GET')).toHaveLength(0); expect(data.failures).toEqual([]);
});

test('More settings quick views and bounded pages preserve an exact draft through filter resets', async ({ page }) => {
  const data = await fixture(page, { tab: 'advanced' }), native = data.getNative();
  native.userConfig.memories = { generate_memories: true, max_rollouts_per_startup: 32 };
  native.config = { ...structuredClone(native.userConfig), memories: { ...native.userConfig.memories, use_memories: true } };
  data.setNative(native); await data.open();
  const panel = page.getByRole('region', { name: 'Official Codex settings', exact: true });
  const rows = panel.locator('.native-option-row'), paths = () => rows.evaluateAll(elements => elements.map(element => element.getAttribute('data-setting-path')!));
  const search = panel.getByRole('searchbox', { name: 'Search Codex settings', exact: true });
  const back = panel.getByRole('button', { name: 'All categories', exact: true });
  await panel.getByRole('button', { name: 'Frequently used', exact: true }).click();
  await expect(rows.first()).toBeVisible(); expect(await rows.count()).toBeLessThanOrEqual(16);
  await expect(panel.locator('.native-structured-editor')).toHaveCount(0);
  await back.click(); await panel.getByRole('button', { name: 'Customized settings', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Customized only', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByRole('switch', { name: 'Generate memories', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(panel.getByRole('switch', { name: 'Use memories', exact: true })).toHaveCount(0);
  await search.fill('memories.use_memories');
  await expect(panel.getByRole('button', { name: 'Customized only', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(panel.getByRole('switch', { name: 'Use memories', exact: true })).toHaveAttribute('aria-checked', 'true');
  await back.click(); await panel.getByRole('button', { name: 'All options', exact: true }).click();
  await expect(rows).toHaveCount(16); const firstPage = await paths();
  const next = panel.getByRole('button', { name: 'Next codex settings', exact: true });
  await expect(next).toHaveAttribute('aria-disabled', 'false'); await next.click();
  await expect(rows).toHaveCount(16); const secondPage = await paths();
  expect(secondPage).not.toEqual(firstPage); expect(secondPage.some(path => firstPage.includes(path))).toBe(false);
  await panel.getByRole('button', { name: 'Previous codex settings', exact: true }).click();
  await expect.poll(paths).toEqual(firstPage);
  await search.fill('tool_output_token_limit'); await panel.getByLabel('Tool output token budget', { exact: true }).fill('2500');
  await back.click(); await panel.getByRole('button', { name: 'Browse Native terminal', exact: true }).click();
  await panel.getByRole('button', { name: 'Browse Global shortcuts', exact: true }).click();
  await expect(rows.first()).toBeVisible(); await back.click();
  await panel.getByRole('button', { name: 'Frequently used', exact: true }).click();
  await expect(panel.getByLabel('Tool output token budget', { exact: true })).toHaveValue('2500');
  await search.fill('no matching native setting fixture 582671');
  await expect(rows).toHaveCount(0); await panel.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(search).toHaveValue(''); await expect(rows).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Browse Native terminal', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Customized settings', exact: true }).click();
  await expect(panel.getByLabel('Tool output token budget', { exact: true })).toHaveValue('2500');
  expect(data.requests.filter(request => request.method !== 'GET')).toHaveLength(0);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
  expect(data.requests.filter(request => request.path === '/settings/native' && request.method === 'PATCH').map(request => request.body)).toEqual([
    { expectedVersion: 'native-version-1', edits: [{ keyPath: 'tool_output_token_limit', value: 2500 }] },
  ]);
  expect(data.getNative().userConfig.memories).toEqual({ generate_memories: true, max_rollouts_per_startup: 32 });
  expect(data.failures).toEqual([]);
});

test('More settings customization filtering restarts at the first page after browsing later pages', async ({ page }) => {
  const data = await fixture(page, { tab: 'advanced' }), native = data.getNative();
  const features = schemaFields(native.schema as ConfigSchema, native.editableKeys).filter(field => field.path.startsWith('features.') && field.kind === 'boolean'
    && !native.lockedKeys.some(locked => field.path === locked.key || field.path.startsWith(`${locked.key}.`))).slice(0, 20);
  expect(features).toHaveLength(20);
  for (const field of features) native.userConfig = setConfigAt(native.userConfig, field.path, false);
  native.config = structuredClone(native.userConfig); data.setNative(native); await data.open();
  const panel = page.getByRole('region', { name: 'Official Codex settings', exact: true });
  const rows = panel.locator('.native-option-row'), paths = () => rows.evaluateAll(elements => elements.map(element => element.getAttribute('data-setting-path')!));
  const pages = panel.getByRole('navigation', { name: 'Codex settings pages', exact: true }), range = pages.getByRole('status');
  await panel.getByRole('button', { name: 'Customized settings', exact: true }).click();
  await expect(rows).toHaveCount(16); await expect(range).toHaveText(/^1–16 of (?:2\d|3[01])$/);
  const firstCustomizedPage = await paths(), firstRange = await range.innerText();
  expect(firstCustomizedPage.every(path => configAt(native.userConfig, path) !== undefined)).toBe(true);
  await panel.getByRole('button', { name: 'All categories', exact: true }).click();
  await panel.getByRole('button', { name: 'All options', exact: true }).click();
  for (let index = 0; index < 4; index++) await pages.getByRole('button', { name: 'Next codex settings', exact: true }).click();
  await expect(range).toHaveText(/^65–80 of \d+$/);
  await panel.getByRole('button', { name: 'Customized only', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Customized only', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(range).toHaveText(firstRange); await expect(rows).toHaveCount(16); await expect.poll(paths).toEqual(firstCustomizedPage);
  await expect(pages.getByRole('button', { name: 'Previous codex settings', exact: true })).toHaveAttribute('aria-disabled', 'true');
  expect(data.requests.filter(request => request.method !== 'GET')).toHaveLength(0); expect(data.failures).toEqual([]);
});

test('More settings keeps backward keyboard focus visible while scrolling desktop results', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 650 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  const data = await fixture(page, { tab: 'advanced' }); await data.open();
  const panel = page.getByRole('region', { name: 'Official Codex settings', exact: true }), content = page.locator('.settings-content');
  await panel.getByRole('button', { name: 'Browse Native terminal', exact: true }).click();
  await panel.getByRole('button', { name: 'Browse Text editing shortcuts', exact: true }).click();
  const last = panel.locator('.native-option-row').last(), lastSummary = last.locator('.native-structured-editor > summary');
  await last.scrollIntoViewIfNeeded(); await lastSummary.focus(); await expect(lastSummary).toBeFocused();
  for (let index = 0; index < 5; index++) {
    await page.keyboard.press('Shift+Tab');
    const focus = await content.evaluate(element => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) throw new Error('No keyboard focus target.');
      const bounds = element.getBoundingClientRect(), target = active.getBoundingClientRect();
      const x = target.left + target.width / 2, y = target.top + target.height / 2, hit = document.elementFromPoint(x, y);
      return { path: active.closest('[data-setting-path]')?.getAttribute('data-setting-path') ?? null, x, y,
        inside: x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom,
        unobscured: hit === active || active.contains(hit) };
    });
    expect(focus.path, JSON.stringify(focus)).not.toBeNull();
    expect(focus.inside, JSON.stringify(focus)).toBe(true); expect(focus.unobscured, JSON.stringify(focus)).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath('more-settings-desktop-keyboard-focus.png'), fullPage: true });
  expect(data.requests.filter(request => request.method !== 'GET')).toHaveLength(0); expect(data.failures).toEqual([]);
});

test('More settings directory navigation preserves invalid field JSON and unapplied configuration JSON', async ({ page }) => {
  const data = await fixture(page, { tab: 'advanced' }); await data.open();
  const panel = page.getByRole('region', { name: 'Official Codex settings', exact: true });
  const search = panel.getByRole('searchbox', { name: 'Search Codex settings', exact: true });
  const back = panel.getByRole('button', { name: 'All categories', exact: true });
  const save = page.getByRole('button', { name: 'Save changes', exact: true });
  await search.fill('approval_policy');
  const policyRow = panel.locator('.native-option-row[data-setting-path="approval_policy"]');
  await policyRow.getByText('Edit structured option', { exact: true }).click();
  const policy = policyRow.getByRole('textbox', { name: 'Approval policy', exact: true });
  await policy.fill('{'); await expect(save).toBeDisabled();
  await panel.locator('.native-subsection[data-settings-section="tools-approvals"] > summary').click(); await expect(policy).toBeHidden();
  await panel.getByRole('button', { name: 'Review unfinished option', exact: true }).click();
  await expect(search).toHaveValue('approval_policy'); await expect(policy).toBeVisible(); await expect(policy).toHaveValue('{');
  await policyRow.getByText('Edit structured option', { exact: true }).click(); await expect(policy).toBeHidden();
  await panel.getByRole('button', { name: 'Review unfinished option', exact: true }).click();
  await expect(search).toHaveValue('approval_policy'); await expect(policy).toBeVisible(); await expect(policy).toHaveValue('{');
  await back.click(); await panel.getByRole('button', { name: 'Browse Native terminal', exact: true }).click();
  await panel.getByRole('button', { name: 'Browse Global shortcuts', exact: true }).click();
  await panel.getByRole('button', { name: 'Review unfinished option', exact: true }).click();
  await expect(policy).toHaveValue('{'); await expect(save).toBeDisabled();
  await policy.fill('"on-request"');
  await panel.getByRole('button', { name: 'Advanced JSON', exact: true }).click();
  const editor = panel.getByRole('textbox', { name: 'Advanced Codex configuration JSON', exact: true });
  const original = JSON.parse(await editor.inputValue()) as Record<string, CodexConfigValue>;
  await editor.fill('{'); await panel.getByRole('button', { name: 'Browse options', exact: true }).click();
  await back.click(); await panel.getByRole('button', { name: 'Browse Memory & history', exact: true }).click();
  await choose(page, 'Settings section', 'memory-usage'); await expect(save).toBeDisabled();
  await panel.getByRole('button', { name: 'Review JSON draft', exact: true }).click(); await expect(editor).toHaveValue('{');
  await editor.fill(JSON.stringify({ ...original, tool_output_token_limit: 3210 })); await expect(save).toBeDisabled();
  await panel.getByRole('button', { name: 'Apply JSON to draft', exact: true }).click(); await expect(save).toBeEnabled();
  await panel.getByRole('button', { name: 'Browse options', exact: true }).click(); await back.click();
  await panel.getByRole('button', { name: 'Browse Context & compaction', exact: true }).click();
  await choose(page, 'Settings section', 'context-capacity');
  await expect(panel.getByLabel('Tool output token budget', { exact: true })).toHaveValue('3210');
  expect(data.requests.filter(request => request.method !== 'GET')).toHaveLength(0);
  await save.click(); await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
  expect(data.requests.filter(request => request.path === '/settings/native' && request.method === 'PATCH').map(request => request.body)).toEqual([
    { expectedVersion: 'native-version-1', edits: [{ keyPath: 'tool_output_token_limit', value: 3210 }] },
  ]);
  expect(data.failures).toEqual([]);
});

for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1366, height: 650 }, { width: 1440, height: 960 }]) {
  test(`More settings directory, sections and results fit ${viewport.width}×${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport); await page.emulateMedia({ reducedMotion: 'reduce' });
    const data = await fixture(page, { tab: 'advanced' }); await data.open();
    const panel = page.getByRole('region', { name: 'Official Codex settings', exact: true }), content = page.locator('.settings-content');
    const footer = page.getByRole('button', { name: 'Save changes', exact: true });
    const assertLayout = async () => {
      for (const area of [panel, content]) {
        const geometry = await area.evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
        expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
      }
      await expect(footer).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeInViewport({ ratio: 1 });
      expect(await panel.locator('.native-option-row').count()).toBeLessThanOrEqual(16);
    };
    const terminal = panel.getByRole('button', { name: 'Browse Native terminal', exact: true });
    await expect(terminal).toBeVisible(); await assertLayout();
    if (viewport.width < 400) {
      await expect(page.getByRole('combobox', { name: 'Settings category', exact: true })).toBeVisible();
      expect((await terminal.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: testInfo.outputPath(`more-settings-directory-${viewport.width}.png`), fullPage: true });
    await terminal.click(); const editing = panel.getByRole('button', { name: 'Browse Text editing shortcuts', exact: true });
    await expect(editing).toBeVisible(); await assertLayout();
    if (viewport.width < 400) expect((await editing.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath(`more-settings-sections-${viewport.width}.png`), fullPage: true });
    await editing.click(); await expect(panel.locator('.native-option-row').first()).toBeVisible(); await assertLayout();
    await panel.locator('.native-option-row').last().scrollIntoViewIfNeeded(); await assertLayout();
    await page.screenshot({ path: testInfo.outputPath(`more-settings-results-${viewport.width}.png`), fullPage: true });
    await panel.getByRole('button', { name: 'All categories', exact: true }).click();
    await expect(terminal).toBeVisible(); await expect(panel.locator('.native-option-row')).toHaveCount(0); await assertLayout();
    expect(data.requests.filter(request => request.method !== 'GET')).toHaveLength(0); expect(data.failures).toEqual([]);
  });
}

test('MCP forms persist stdio and HTTP references without exposing private values and offer a real restart', async ({ page }) => {
  const data = await fixture(page, { tab: 'mcp' }); await data.open();
  await page.getByRole('textbox', { name: 'New MCP server name', exact: true }).fill('research'); await choose(page, 'New MCP server transport', 'http');
  await page.getByRole('button', { name: 'Add server', exact: true }).click();
  await page.getByLabel('Server URL', { exact: true }).fill('https://mcp.example.test/mcp?project_ref=demo&read_only=true');
  await page.getByLabel('Bearer token variable', { exact: true }).fill('MCP_RESEARCH_TOKEN');
  await page.getByRole('button', { name: 'Add header reference', exact: true }).click();
  await page.getByLabel('HTTP header references name 1', { exact: true }).fill('X-Project-Key');
  await page.getByLabel('HTTP header references source 1', { exact: true }).fill('MCP_RESEARCH_TOKEN');
  await page.getByText('Tools and timeouts', { exact: true }).click();
  await page.getByLabel('Startup timeout (seconds)', { exact: true }).fill('15'); await page.getByLabel('Tool timeout (seconds)', { exact: true }).fill('60');
  await page.getByLabel('Allowed tools', { exact: true }).fill('read\nsearch'); await page.getByLabel('Blocked tools', { exact: true }).fill('delete');
  await page.getByRole('switch', { name: 'Require this server', exact: true }).click();
  await page.getByLabel('Variable name', { exact: true }).fill('MCP_RESEARCH_TOKEN'); await page.getByLabel('Private value', { exact: true }).fill('fixture-private-value');
  await page.getByRole('button', { name: 'Add private variable', exact: true }).click();
  await expect(page.getByLabel('Private value', { exact: true })).toHaveValue('');
  await page.getByLabel('Variable name', { exact: true }).fill('DATABASE_URL'); await page.getByLabel('Private value', { exact: true }).fill('fixture-database-address');
  await page.getByRole('button', { name: 'Add private variable', exact: true }).click();
  await page.getByRole('textbox', { name: 'New MCP server name', exact: true }).fill('local'); await choose(page, 'New MCP server transport', 'stdio');
  await page.getByRole('button', { name: 'Add server', exact: true }).click(); await page.getByLabel('Command', { exact: true }).fill('npx');
  await page.getByLabel('Arguments', { exact: true }).fill('--yes\n@fixture/mcp-server');
  await page.getByRole('button', { name: 'Add environment reference', exact: true }).click(); await page.getByLabel('Environment references name 1', { exact: true }).fill('MCP_RESEARCH_TOKEN');
  await page.getByRole('button', { name: 'Add environment reference', exact: true }).click(); await page.getByLabel('Environment references name 2', { exact: true }).fill('DATABASE_URL');
  await page.getByRole('switch', { name: 'Enable local', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check connections', exact: true })).toBeDisabled();
  expect(await page.locator('body').textContent()).not.toContain('fixture-private-value');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Settings saved. Restart Codex to load the updated configuration.', { exact: true })).toBeVisible();
  await expect(page.locator('#settings-panel-runtime')).toBeVisible();
  const write = data.requests.find(request => request.path === '/settings/native' && request.method === 'PATCH')!.body as CodexNativeSettingsPatch;
  expect(write.mcpEnvironment).toEqual([{ name: 'MCP_RESEARCH_TOKEN', value: 'fixture-private-value' }, { name: 'DATABASE_URL', value: 'fixture-database-address' }]);
  const savedServers = write.edits.find(edit => edit.keyPath === 'mcp_servers')!.value as Record<string, Record<string, CodexConfigValue>>;
  expect(savedServers.local).toEqual({ command: 'npx', enabled: false, args: ['--yes', '@fixture/mcp-server'], env_vars: ['MCP_RESEARCH_TOKEN', 'DATABASE_URL'] });
  expect(savedServers.research).toMatchObject({ url: 'https://mcp.example.test/mcp?project_ref=demo&read_only=true', bearer_token_env_var: 'MCP_RESEARCH_TOKEN', env_http_headers: { 'X-Project-Key': 'MCP_RESEARCH_TOKEN' }, required: true,
    startup_timeout_sec: 15, tool_timeout_sec: 60, enabled_tools: ['read', 'search'], disabled_tools: ['delete'] });
  expect(JSON.stringify(savedServers)).not.toContain('fixture-private-value');
  data.onRestart(route => { const restarting = { ...runtime(), state: 'updating' as const, canUpdate: false }; data.setRuntime(restarting); return reply(route, restarting, 202); });
  await page.getByRole('button', { name: 'Restart Codex', exact: true }).click(); await expect(runtimeCard(page)).toContainText('Restarting');
  data.setNative({ ...data.getNative(), restartRequired: false }); data.setRuntime(runtime());
  await expect(runtimeCard(page).locator('.codex-runtime-state')).toHaveText('Ready');
  await expect(page.getByText('Codex is ready with the saved configuration.', { exact: true })).toBeVisible();
  expect(data.requests.filter(request => request.path === '/codex/runtime/restart')).toEqual([{ path: '/codex/runtime/restart', method: 'POST', body: {} }]);
  expect(data.requests.filter(request => request.path === '/codex/runtime/update')).toHaveLength(0);
  expect(data.failures).toEqual([]);
});

test('official schema controls and advanced JSON preserve drafts and reject edits to managed options', async ({ page }) => {
  const data = await fixture(page, { tab: 'advanced' }); await data.open();
  const search = page.getByRole('searchbox', { name: 'Search Codex settings', exact: true }); await search.fill('features.browser_use');
  await expect(page.locator('.native-option-row[data-setting-path="features.browser_use"]')).toHaveCount(0);
  await search.fill('agents.enabled'); await expect(page.getByRole('combobox', { name: 'Allow delegated agents', exact: true })).toHaveText('Codex default');
  await search.fill('memories.generate_memories'); await choose(page, 'Generate memories', 'true');
  await search.fill('tool_output_token_limit'); await page.getByLabel('Tool output token budget', { exact: true }).fill('2400');
  await page.getByRole('button', { name: 'Advanced JSON', exact: true }).click(); const editor = page.getByRole('textbox', { name: 'Advanced Codex configuration JSON', exact: true });
  const valid = JSON.parse(await editor.inputValue()) as Record<string, CodexConfigValue>;
  expect(valid.memories).toEqual({ generate_memories: true }); expect(valid.tool_output_token_limit).toBe(2400);
  await editor.fill(JSON.stringify({ ...valid, features: { browser_use: true } })); await page.getByRole('button', { name: 'Apply JSON to draft', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('features.browser_use'); await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  await editor.fill('{'); await navigate(page, 'appearance'); await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('unsaved settings'); await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await navigate(page, 'advanced'); await expect(editor).toHaveValue('{');
  await editor.fill(JSON.stringify({ ...valid, model_provider: 'somewhere-else' })); await page.getByRole('button', { name: 'Apply JSON to draft', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('model_provider');
  await page.getByRole('button', { name: 'Reset JSON editor', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click(); await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
  const write = data.requests.find(request => request.path === '/settings/native' && request.method === 'PATCH')!.body as CodexNativeSettingsPatch;
  expect(write.edits).toEqual([{ keyPath: 'memories', value: { generate_memories: true } }, { keyPath: 'tool_output_token_limit', value: 2400 }]);
  expect(data.failures).toEqual([]);
});

test('native revision conflicts preserve the draft until the user chooses to reload it', async ({ page }) => {
  const data = await fixture(page); data.onNativeSave(route => reply(route, { error: 'Native settings changed since this form was opened. Refresh before saving.' }, 409)); await data.open();
  await choose(page, 'Response speed', 'default'); await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Native settings changed'); await expect(page.getByRole('combobox', { name: 'Response speed', exact: true })).toHaveText('Standard');
  await page.getByRole('button', { name: 'Reload settings', exact: true }).click(); await expect(page.getByText('You have unsaved settings.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click(); await expect(page.getByRole('combobox', { name: 'Response speed', exact: true })).toHaveText('Standard');
  await page.getByRole('button', { name: 'Reload settings', exact: true }).click(); await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Response speed', exact: true })).toHaveText('Fast');
  expect(data.requests.filter(request => request.method === 'PATCH' && request.path === '/settings/native')).toHaveLength(1);
  expect(data.failures).toEqual([]);
});

test('MCP checks show native failures and appearance remains savable while native configuration is unavailable', async ({ page }) => {
  const data = await fixture(page, { tab: 'mcp' });
  data.onMcpCheck(route => reply(route, { servers: [{ name: 'unavailable', authStatus: 'unsupported', connectionStatus: 'failed', error: 'The server could not be initialized.', toolCount: 0, resourceCount: 0, resourceTemplateCount: 0 }], checkedAt: '2026-09-23T10:00:00Z', nextCursor: null, restartRequired: false }));
  await data.open(); await page.getByRole('button', { name: 'Check connections', exact: true }).click();
  await expect(page.locator('.mcp-connection-results')).toContainText('Failed'); await expect(page.locator('.mcp-connection-results')).toContainText('The server could not be initialized.');
  data.onNativeRead(route => reply(route, { error: 'Codex is restarting.' }, 503)); await page.getByRole('button', { name: 'Reload settings', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Codex is restarting.'); await navigate(page, 'appearance');
  await page.getByRole('switch', { name: 'Wrap long lines', exact: true }).click(); await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0); expect(data.requests.filter(request => request.path === '/settings' && request.method === 'PATCH').at(-1)?.body).toEqual({ wordWrap: false });
});

test('MCP and schema editors fit a phone and retain drafts during tab changes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 }); const data = await fixture(page, { tab: 'mcp' }); await data.open();
  await page.getByRole('textbox', { name: 'New MCP server name', exact: true }).fill('phone-server'); await choose(page, 'New MCP server transport', 'http');
  await page.getByRole('button', { name: 'Add server', exact: true }).click(); await page.getByLabel('Server URL', { exact: true }).fill('https://mcp.example.test/mcp');
  await page.getByRole('button', { name: 'Add header reference', exact: true }).click(); await page.getByLabel('HTTP header references name 1', { exact: true }).fill('Authorization');
  await page.getByLabel('HTTP header references source 1', { exact: true }).fill('MCP_PHONE_TOKEN');
  const content = page.locator('.settings-content'); const geometry = await content.evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth })); expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
  await page.screenshot({ path: testInfo.outputPath('codex-mcp-phone.png'), fullPage: true });
  await navigate(page, 'advanced'); await page.getByRole('button', { name: 'Advanced JSON', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Advanced Codex configuration JSON', exact: true })).toHaveValue(/MCP_PHONE_TOKEN/);
  await navigate(page, 'mcp'); await expect(page.getByLabel('Server URL', { exact: true })).toHaveValue('https://mcp.example.test/mcp');
  expect(data.failures).toEqual([]);
});

test('runtime refresh preserves an unfinished private draft and locking clears it', async ({ page }) => {
  const data = await fixture(page, { tab: 'mcp' }); await data.open();
  await page.getByLabel('Variable name', { exact: true }).fill('MCP_DRAFT_TOKEN'); await page.getByLabel('Private value', { exact: true }).fill('fixture-unsaved-private-value');
  const reads = data.requests.filter(request => request.path === '/settings/native' && request.method === 'GET').length;
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('codex:runtime-changed')));
  await expect(page.getByText('Codex changed while you were editing. Reload before saving.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Private value', { exact: true })).toHaveValue('fixture-unsaved-private-value');
  expect(data.requests.filter(request => request.path === '/settings/native' && request.method === 'GET')).toHaveLength(reads);
  expect(await page.locator('body').textContent()).not.toContain('fixture-unsaved-private-value');
  await page.evaluate(() => { document.body.dataset.workspaceLocked = 'true'; window.dispatchEvent(new Event('codex:session-locked')); });
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
  await page.evaluate(() => { delete document.body.dataset.workspaceLocked; window.dispatchEvent(new Event('codex:session-unlocked')); });
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible(); await expect(page.getByLabel('Private value', { exact: true })).toHaveValue('');
  expect(data.requests.filter(request => request.method === 'PATCH')).toHaveLength(0);
  expect(data.failures).toEqual([]);
});

test('JSON fields follow later edits made through the curated controls', async ({ page }) => {
  const data = await fixture(page, { tab: 'advanced' }); await data.open();
  await page.getByRole('searchbox', { name: 'Search Codex settings', exact: true }).fill('approval_policy');
  await page.getByText('Edit structured option', { exact: true }).click();
  const policy = page.getByRole('textbox', { name: 'Approval policy', exact: true });
  await policy.fill(JSON.stringify({ granular: { sandbox_approval: true, rules: true, mcp_elicitations: true, request_permissions: true, skill_approval: true } }));
  await expect(policy).toBeVisible();
  await navigate(page, 'tools');
  await expect(page.getByRole('combobox', { name: 'Default permissions', exact: true })).toContainText('Advanced approval policy');
  await choose(page, 'Default permissions', 'full-access'); await navigate(page, 'advanced');
  await expect(policy).toHaveValue('"never"'); await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  const write = data.requests.find(request => request.path === '/settings/native' && request.method === 'PATCH')!.body as CodexNativeSettingsPatch;
  expect(write.edits).toEqual([{ keyPath: 'approval_policy', value: 'never' }]); expect(data.failures).toEqual([]);
});
