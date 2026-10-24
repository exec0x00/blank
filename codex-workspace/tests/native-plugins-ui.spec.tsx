import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer, type Server } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, type Browser, type Page, type Route } from 'playwright-core';
import { AppDetailView, PluginDetailView, pluginInstallReason } from '../client/components/native/NativePluginsPanel';
import { browserLaunchOptions } from './browser-launch';
import { NATIVE_PLUGIN_METHODS, type NativePluginSummary, type NativePluginDetail, type NativeAppDetail } from '../shared/native-plugins';

const plugin: NativePluginSummary = {
  ref: '11111111-1111-4111-8111-111111111111', id: 'sample@owned-catalog', name: 'sample', displayName: 'Sample plugin', description: 'Research, inspect and organize project files.',
  developerName: 'Example author', marketplaceName: 'Owned catalog', marketplaceRef: '22222222-2222-4222-8222-222222222222', remotePluginId: 'remote-sample', remoteSkillsAvailable: true, version: '2.0', localVersion: null,
  installed: false, enabled: true, installPolicy: 'AVAILABLE', authPolicy: 'ON_USE', availability: 'AVAILABLE', disabledReason: null, requiresInstallReview: true,
  sourceKind: 'remote', capabilities: ['Skills', 'Project context'], keywords: [], sharing: null,
};
const pluginDetail: NativePluginDetail = { plugin, description: 'Inspect the skills and integrations before adding this plugin.', skills: [{ name: 'sample-skill', description: 'Read and summarize project documents.', enabled: true }],
  onboardingSkill: null, hooks: [], apps: [], appTemplates: [], mcpServers: [], scheduledTasks: [], shareUrl: null };
const appDetail: NativeAppDetail = { id: 'app-one', name: 'Example app', description: 'Find and update shared project records.', pluginDisplayNames: ['Sample plugin'],
  tools: Array.from({ length: 25 }, (_, index) => ({ name: `tool_${index}`, title: `Tool ${index + 1}`, description: `Public description ${index + 1}.`, enabled: index !== 1, disabledReason: index === 1 ? 'Disabled by workspace policy' : null, readOnly: index === 0 })) };
const capabilities = () => ({ experimental: true, connected: true, methods: Object.fromEntries(NATIVE_PLUGIN_METHODS.map(method => [method, { status: 'advertised', reason: null }])) });

describe('public plugin and app presentation', () => {
  it('keeps metadata enablement separate from callability, and bounds tool rows', () => {
    const html = renderToStaticMarkup(<AppDetailView detail={appDetail} runtime={{ id: 'app-one', runtimeName: 'Example app', enabled: true, callable: false }} />);
    expect(html).toContain('No callable tools in this snapshot'); expect(html).toContain('Enabled by policy'); expect(html).toContain('Disabled by workspace policy');
    expect(html).toContain('Read-only'); expect(html).toContain('Not marked read-only');
    expect(html).toContain('Tool 12'); expect(html).not.toContain('Tool 13'); expect(html).toContain('Next app tools');
    expect(html).not.toContain('Callable tools confirmed'); expect(html).not.toContain('Sign in'); expect(html).not.toContain('installUrl');
    const unknown = renderToStaticMarkup(<AppDetailView detail={appDetail} />); expect(unknown).toContain('Not verified');
  });
  it('renders hostile catalog text as text and presents native install restrictions', () => {
    const html = renderToStaticMarkup(<PluginDetailView detail={{ ...pluginDetail, description: '<script>window.unsafe = true</script>' }} />);
    expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
    expect(pluginInstallReason(plugin)).toBeNull();
    expect(pluginInstallReason({ ...plugin, availability: 'DISABLED_BY_ADMIN', disabledReason: 'plan_not_eligible' })).toBe('plan not eligible');
    expect(pluginInstallReason({ ...plugin, installPolicy: 'NOT_AVAILABLE' })).toBe('Installation is unavailable');
  });
});

describe('native plugin panel actions in Chromium', () => {
  let directory: string, server: Server, browser: Browser, page: Page, origin: string;
  let calls: Array<{ path: string; method: string; body: Record<string, unknown> | null; search: URLSearchParams }>;
  let override: ((route: Route, url: URL) => Promise<boolean>) | null;
  beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-plugins-browser-'));
    await build({ entryPoints: [path.resolve('tests/native-plugins-fixture.tsx')], outfile: path.join(directory, 'fixture.js'), bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
    server = createServer(async (req, res) => {
      if (req.url === '/fixture.js' || req.url === '/fixture.css') { res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(await fs.readFile(path.join(directory, req.url.slice(1)))); return; }
      res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }, 30_000);
  afterAll(async () => {
    await browser?.close(); server?.closeAllConnections(); if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  });
  beforeEach(async () => {
    calls = []; override = null; browser = await chromium.launch({ headless: true, ...browserLaunchOptions() });
    page = await browser.newPage({ viewport: { width: 1120, height: 900 } });
    page.setDefaultTimeout(6000);
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url()), body = route.request().postDataJSON() as Record<string, unknown> | null;
      calls.push({ path: url.pathname.replace(/^\/api/, ''), method: route.request().method(), body, search: url.searchParams });
      if (override && await override(route, url)) return;
      const suffix = url.pathname.split('/codex/')[1], other = url.pathname.includes('/workspace-two/');
      const respond = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
      if (url.pathname === '/api/codex/plugins/capabilities') return respond(capabilities());
      const catalog = { data: [{ ...plugin, displayName: other ? 'Other workspace plugin' : plugin.displayName }], marketplaces: [{ ref: plugin.marketplaceRef, name: 'owned-catalog', displayName: 'Owned catalog', local: false, pluginCount: 1 }], errors: [], featuredIds: [], nextCursor: null, total: 1 };
      if (suffix === 'plugins' || suffix === 'plugins/installed') return respond(catalog);
      if (suffix === 'plugins/search') return respond({ data: [plugin], nextCursor: null });
      if (suffix === 'plugins/read') return respond(pluginDetail);
      if (suffix === 'plugins/skill/read') return respond({ name: 'sample-skill', contents: '# Sample skill\nPublic skill instructions.', truncated: false });
      if (suffix === 'plugins/install') return respond({ authPolicy: 'ON_USE', appsNeedingAuth: [{ id: 'app-one', name: 'Example app' }] });
      if (suffix === 'plugins/uninstall') return respond({ removed: true });
      if (suffix === 'plugins/reconcile') return respond({ changedPlugins: [], failedRemotePluginIds: [], failedMaterializationRemotePluginIds: [] });
      if (suffix === 'plugins/marketplaces/add') return respond({ marketplaceName: 'Added source', alreadyAdded: false });
      if (suffix === 'plugins/marketplaces/remove') return respond({ marketplaceName: 'Owned catalog' });
      if (suffix === 'plugins/marketplaces/upgrade') return respond({ selectedMarketplaces: ['owned-catalog'], upgradedCount: 1, errors: [] });
      if (suffix === 'plugins/shares') return respond({ data: [{ plugin: { ...plugin, sharing: { remotePluginId: 'remote-sample', remoteVersion: '2.0', discoverability: 'PRIVATE', shareUrl: 'https://example.com/plugin/shared', creatorName: 'Example author', principals: [], canPublishToWorkspace: true } }, localRef: null }], nextCursor: null, total: 1 });
      if (suffix === 'plugins/shares/save') return respond({ remotePluginId: 'new-share', shareUrl: 'https://example.com/plugin/new', canPublishToWorkspace: false });
      if (suffix === 'plugins/shares/update-targets') return respond({ principals: [], discoverability: 'PRIVATE' });
      if (suffix === 'plugins/shares/checkout') return respond({ remotePluginId: 'remote-sample', pluginId: plugin.id, pluginName: plugin.name, marketplaceName: 'owned-catalog', remoteVersion: '2.0', localRef: '33333333-3333-4333-8333-333333333333', workspacePath: 'plugins/sample' });
      if (suffix === 'plugins/shares/delete') return respond({ deleted: true });
      if (suffix === 'apps') return respond({ data: [{ id: 'app-one', name: 'Example app', description: appDetail.description, accessible: true, enabled: true, pluginDisplayNames: [], developer: null, version: null, categories: [] }], nextCursor: null });
      if (suffix === 'apps/read') return respond({ apps: [appDetail], missingAppIds: [] });
      if (suffix === 'apps/installed') return respond({ apps: [{ id: 'app-one', runtimeName: 'Example app', enabled: true, callable: false }], nextCursor: null, total: 1 });
      return respond({ error: 'Unexpected browser fixture path.' }, 404);
    });
    await page.goto(origin); await page.getByRole('button', { name: 'Inspect Sample plugin', exact: true }).waitFor();
  });
  afterEach(async () => { await page?.unrouteAll({ behavior: 'wait' }); await page?.close(); await browser?.close(); });
  async function view(label: string) {
    await page.getByRole('combobox', { name: 'Plugin and app view', exact: true }).click();
    await page.getByRole('option', { name: label, exact: true }).click();
  }

  it('requires an explicit detail selection and requested native review before install, and reads actual remote skill text', async () => {
    expect(await page.getByRole('button', { name: 'Install plugin', exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Inspect Sample plugin', exact: true }).click();
    const install = page.getByRole('button', { name: 'Install plugin', exact: true }); await install.waitFor(); expect(await install.isDisabled()).toBe(true);
    await page.screenshot({ path: '/tmp/native-plugins-ui-desktop-review.png', fullPage: true });
    await page.getByRole('button', { name: 'Read sample-skill', exact: true }).click(); await page.getByText('Public skill instructions.', { exact: false }).waitFor();
    await page.getByRole('checkbox', { name: 'I reviewed this plugin’s capabilities.' }).check(); await install.click();
    await page.getByText('Plugin installed.', { exact: false }).waitFor();
    expect(calls.find(call => call.path.endsWith('/install'))?.body).toEqual({ ref: plugin.ref, reviewed: true });
    expect(calls.find(call => call.path.endsWith('/skill/read'))?.body).toEqual({ ref: plugin.ref, skillName: 'sample-skill' });
    expect(await page.getByText('needs an existing native app connection before use.', { exact: false }).count()).toBe(1);
    expect(await page.getByRole('link', { name: /sign in|connect chatgpt/i }).count()).toBe(0);
  });

  it('adds and upgrades marketplaces and requires a concrete removal choice', async () => {
    await view('Marketplaces'); await page.getByRole('button', { name: 'Remove marketplace Owned catalog' }).waitFor();
    await page.getByRole('textbox', { name: 'Repository or workspace folder' }).fill('https://github.com/example/catalog');
    await page.getByText('Repository options', { exact: true }).click(); await page.getByRole('textbox', { name: 'Branch, tag or revision' }).fill('stable');
    await page.getByRole('textbox', { name: 'Repository subfolders' }).fill('plugins\ncatalog'); await page.getByRole('button', { name: 'Add marketplace', exact: true }).click();
    await page.getByText('Added source was added.').waitFor();
    expect(calls.find(call => call.path.endsWith('/marketplaces/add'))?.body).toEqual({ source: 'https://github.com/example/catalog', refName: 'stable', sparsePaths: ['plugins', 'catalog'] });
    await page.getByRole('button', { name: 'Update all marketplaces' }).click(); await page.getByText('1 marketplace updated.').waitFor();
    expect(calls.find(call => call.path.endsWith('/marketplaces/upgrade'))?.body).toEqual({});
    await page.getByRole('button', { name: 'Remove marketplace Owned catalog' }).click(); await page.getByRole('heading', { name: 'Remove Owned catalog?' }).waitFor();
    expect(calls.some(call => call.path.endsWith('/marketplaces/remove'))).toBe(false);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click(); expect(calls.some(call => call.path.endsWith('/marketplaces/remove'))).toBe(false);
    await page.getByRole('button', { name: 'Remove marketplace Owned catalog' }).click(); await page.getByRole('button', { name: 'Remove marketplace', exact: true }).click();
    await page.getByText('Marketplace removed.', { exact: true }).waitFor(); expect(calls.find(call => call.path.endsWith('/marketplaces/remove'))?.body).toEqual({ ref: plugin.marketplaceRef });
  });

  it('uses explicit sharing recipients, native checkout, access updates and deletion confirmation', async () => {
    await view('Sharing'); await page.getByRole('button', { name: 'Manage Sample plugin' }).waitFor();
    await page.getByRole('textbox', { name: 'Plugin folder in this workspace' }).fill('plugins/sample');
    await page.getByRole('button', { name: 'Add recipient', exact: true }).click(); await page.getByRole('textbox', { name: 'Recipient 1 ID' }).fill('reader-one');
    await page.getByRole('combobox', { name: 'Recipient 1 access' }).click(); await page.getByRole('option', { name: 'Can edit', exact: true }).click();
    await page.getByRole('button', { name: 'Share plugin', exact: true }).click(); await page.getByText('Plugin saved to the native sharing service.', { exact: false }).waitFor();
    expect(calls.find(call => call.path.endsWith('/shares/save'))?.body).toEqual({ pluginPath: 'plugins/sample', discoverability: 'PRIVATE', shareTargets: [{ principalType: 'user', principalId: 'reader-one', role: 'editor' }] });
    await page.getByRole('button', { name: 'Refresh shares' }).click(); await page.getByRole('button', { name: 'Manage Sample plugin' }).click();
    await page.getByRole('button', { name: 'Update access', exact: true }).click(); await page.getByText('Sharing access updated.', { exact: false }).waitFor();
    expect(calls.find(call => call.path.endsWith('/shares/update-targets'))?.body).toEqual({ remotePluginId: 'remote-sample', discoverability: 'PRIVATE', shareTargets: [] });
    await page.getByRole('button', { name: 'Check out local copy' }).click(); await page.getByText('Local copy ready at plugins/sample.').waitFor();
    expect(calls.find(call => call.path.endsWith('/shares/checkout'))?.body).toEqual({ remotePluginId: 'remote-sample' });
    await page.getByRole('button', { name: 'Delete shared plugin', exact: true }).click(); expect(calls.some(call => call.path.endsWith('/shares/delete'))).toBe(false);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Delete shared plugin', exact: true }).click(); await page.locator('.native-plugin-confirm').getByRole('button', { name: 'Delete shared plugin', exact: true }).click();
    await page.getByText('Shared plugin deleted.', { exact: true }).waitFor(); expect(calls.find(call => call.path.endsWith('/shares/delete'))?.body).toEqual({ remotePluginId: 'remote-sample' });
  });

  it('shows real app runtime availability and pages tool metadata without inventing connection actions', async () => {
    await view('Apps and tools'); await page.getByRole('button', { name: 'Inspect app Example app' }).click();
    await page.getByText('No callable tools in this snapshot', { exact: true }).waitFor(); expect(await page.getByText('Callable tools confirmed', { exact: true }).count()).toBe(0);
    expect(await page.getByText('Tool 12', { exact: true }).count()).toBe(1); expect(await page.getByText('Tool 13', { exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Next app tools', exact: true }).click(); await page.getByText('Tool 13', { exact: true }).waitFor();
    expect(calls.filter(call => call.path.endsWith('/apps/read'))).toHaveLength(1);
    expect(calls.find(call => call.path.endsWith('/apps/installed'))?.search.get('appId')).toBe('app-one');
    expect(calls.find(call => call.path.endsWith('/apps/read'))?.body).toEqual({ appIds: ['app-one'], threadId: '01990000-0000-7000-8000-000000000001', includeTools: true });
    expect(await page.getByRole('button', { name: /connect|sign in|api key/i }).count()).toBe(0);
  });

  it('does not apply late details to a different workspace and gives failures an explicit refresh action', async () => {
    let release!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    override = async (route, url) => {
      if (url.pathname.includes('/workspace-one/') && url.pathname.endsWith('/plugins/read')) { await delayed; await route.fulfill({ contentType: 'application/json', body: JSON.stringify(pluginDetail) }).catch(() => undefined); return true; }
      return false;
    };
    await page.getByRole('button', { name: 'Inspect Sample plugin', exact: true }).click();
    await page.getByRole('button', { name: 'Switch workspace', exact: true }).click(); await page.getByRole('button', { name: 'Inspect Other workspace plugin' }).waitFor(); release();
    expect(await page.getByRole('button', { name: 'Install plugin', exact: true }).count()).toBe(0);
    override = async (route, url) => { if (url.pathname.endsWith('/plugins/read')) { await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Native catalog is temporarily unavailable.' }) }); return true; } return false; };
    await page.getByRole('button', { name: 'Inspect Other workspace plugin' }).click(); await page.getByRole('alert').getByText('Native catalog is temporarily unavailable.').waitFor();
    expect(await page.getByRole('button', { name: 'Refresh status', exact: true }).isVisible()).toBe(true);
  });

  it('keeps sharing forms inside the phone viewport with usable controls', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await view('Sharing'); await page.getByRole('button', { name: 'Add recipient', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const dimensions = await page.locator('.native-plugin-recipient').getByRole('textbox').boundingBox(); expect(dimensions?.height).toBeGreaterThanOrEqual(44);
    expect(await page.locator('.native-plugins-panel').evaluate(element => getComputedStyle(element).fontSize)).toBe('13px');
    await page.screenshot({ path: '/tmp/native-plugins-ui-mobile-review.png', fullPage: true });
  });

  it('preserves sharing drafts across views and conversation changes, while isolating workspace drafts', async () => {
    await view('Sharing'); await page.getByRole('textbox', { name: 'Plugin folder in this workspace' }).fill('plugins/unfinished-share');
    await page.getByRole('button', { name: 'Add recipient', exact: true }).click(); await page.getByRole('textbox', { name: 'Recipient 1 ID' }).fill('reader-draft');
    await view('Apps and tools'); await page.getByRole('button', { name: 'Inspect app Example app' }).waitFor();
    await page.getByRole('button', { name: 'Switch conversation', exact: true }).click();
    await page.getByRole('button', { name: 'Inspect app Example app' }).waitFor();
    expect(calls.filter(call => call.path.endsWith('/apps')).at(-1)?.search.get('threadId')).toBe('01990000-0000-7000-8000-000000000002');
    await view('Sharing'); expect(await page.getByRole('textbox', { name: 'Plugin folder in this workspace' }).inputValue()).toBe('plugins/unfinished-share');
    expect(await page.getByRole('textbox', { name: 'Recipient 1 ID' }).inputValue()).toBe('reader-draft');
    await page.getByRole('button', { name: 'Switch workspace', exact: true }).click(); await page.getByRole('button', { name: 'Inspect Other workspace plugin' }).waitFor();
    await view('Sharing'); expect(await page.getByRole('textbox', { name: 'Plugin folder in this workspace' }).inputValue()).toBe('');
    expect(await page.getByRole('textbox', { name: 'Recipient 1 ID' }).count()).toBe(0);
  });
});
