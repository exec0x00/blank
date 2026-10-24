/** Standalone Chromium interactions; intentionally outside the Vitest unit suite.
 * Run: node_modules/.bin/tsx tests/native-discovery-ui.playwright.ts
 * Browser installation/library paths come from the environment. Set
 * NATIVE_DISCOVERY_UI_ARTIFACTS=1 to retain this run's screenshots and report.
 * All API responses are fixtures; no native runtime or model service is called.
 */
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, expect, type Browser, type Page } from '@playwright/test';
import { browserLaunchOptions } from './browser-launch';

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const dir = await mkdtemp(join(tmpdir(), 'codex-native-discovery-ui-'));
  const keepArtifacts = process.env.NATIVE_DISCOVERY_UI_ARTIFACTS === '1';
  const held = new Set<() => void>();
  let server: Server | undefined, browser: Browser | undefined, page: Page | undefined;
  let passed = false;
  try {
    await build({ stdin: { contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { NativeDiscoveryPanel } from './client/components/native/NativeDiscoveryPanel';
      import './client/styles.css';
      function Harness() {
        const [workspaceId, setWorkspace] = useState('workspace-a');
        const [threadId, setThread] = useState('thread-a');
        const [active, setActive] = useState(true);
        return <><nav className="proof-nav">
          <button onClick={() => setWorkspace(value => value === 'workspace-a' ? 'workspace-b' : 'workspace-a')}>Switch workspace</button>
          <button onClick={() => setThread(value => value === 'thread-a' ? 'thread-b' : 'thread-a')}>Switch conversation</button>
          <button onClick={() => setActive(value => !value)}>{active ? 'Hide panel' : 'Show panel'}</button>
        </nav><div hidden={!active}><NativeDiscoveryPanel workspaceId={workspaceId} threadId={threadId} active={active} /></div></>;
      }
      createRoot(document.getElementById('root')).render(<Harness />);
    `, resolveDir: root, loader: 'tsx' }, outfile: join(dir, 'harness.js'), bundle: true, format: 'esm', jsx: 'automatic',
      platform: 'browser', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
    await writeFile(join(dir, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/harness.css"><style>html,body,#root{height:auto;min-height:100%;overflow:visible}body{padding:24px}#root{max-width:700px;margin:auto}.proof-nav{display:flex;gap:12px;margin-bottom:16px}.proof-nav button{padding:12px;border:1px solid #424242;border-radius:8px}@media(max-width:420px){body{padding:12px}}</style></head><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>');
    server = createServer(async (req, res) => {
      const path = new URL(req.url || '/', 'http://fixture.invalid').pathname;
      const file = path === '/' ? 'index.html' : path === '/harness.js' ? 'harness.js' : path === '/harness.css' ? 'harness.css' : null;
      if (!file) { res.writeHead(404); res.end(); return; }
      try {
        const body = await readFile(join(dir, file));
        res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(body);
      } catch { res.writeHead(500); res.end('Fixture asset unavailable.'); }
    });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture address.');
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true, ...browserLaunchOptions() });
    page = await browser.newPage({ viewport: { width: 1000, height: 900 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(10_000);
    const errors: string[] = []; const requests: string[] = []; const mutations: Array<{ endpoint: string; body: any }> = [];
    let diagnosticsFail = true; let pollCount = 0; let reportUnknownImport = false; let deferredPreview: (() => void) | undefined; let deferredFeatures: (() => void) | undefined; let delayFeatures = false;
    let rootsApplied = false; let rootPaths: string[] = []; let manualRecorded = false;
    page.on('pageerror', error => errors.push(error.message));
    const waitForRelease = (expose: (release: () => void) => void) => new Promise<void>(resolve => {
      const release = () => { held.delete(release); resolve(); };
      held.add(release); expose(release);
    });
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin === origin) return route.fallback();
      errors.push('The fixture attempted an external network request.');
      return route.abort('blockedbyclient');
    });
    const native = { nativeConfirmed: true, observedAt: new Date().toISOString() };
    const oneFeature = { name: 'one', label: 'One feature', description: 'A runtime feature.', stage: 'beta', enabled: false, defaultEnabled: false, canToggle: true, blockedReason: null };
    const preview = () => ({ ...native, previewId: 'import-preview', source: 'claude', expiresAt: new Date(Date.now() + 60_000).toISOString(), excludedCount: 0, note: 'Review source and destination paths.', items: [
      { id: 'instructions', itemType: 'AGENTS_MD', label: 'Project instructions', description: 'Existing instructions.', sourcePaths: ['CLAUDE.md'], destinationPaths: ['AGENTS.md'], count: 1, allowed: true, blockedReason: null },
      { id: 'configuration', itemType: 'CONFIG', label: 'Tool configuration', description: 'Other settings.', sourcePaths: ['.claude/settings.json'], destinationPaths: ['.codex/config.toml'], count: 1, allowed: false, blockedReason: 'Provider routing is managed.' },
    ] });
    await page.route('**/api/**', async route => {
      const req = route.request(); const url = new URL(req.url()); const method = req.method(); const endpoint = url.pathname.split('/codex/discovery')[1];
      requests.push(`${method} ${url.pathname}${url.search}`);
      const body = method === 'GET' ? undefined : req.postDataJSON();
      if (body) mutations.push({ endpoint, body });
      const reply = (value: unknown) => route.fulfill({ json: value });
      if (endpoint === '/overview') return reply({ generation: 'one', runtimeState: 'ready', runtimeVersion: 'test-runtime', extraSkillRoots: rootPaths, exclusions: [{ id: 'remote', label: 'Remote environments', reason: 'Unavailable on this host.' }] });
      if (endpoint === '/features' && method === 'GET') {
        if (delayFeatures) { delayFeatures = false; await waitForRelease(release => deferredFeatures = release); return reply({ ...native, data: [{ ...oneFeature, label: 'Delayed stale feature' }], nextCursor: null }); }
        return reply({ ...native, data: url.searchParams.has('cursor') ? [{ ...oneFeature, name: 'two', label: 'Two feature' }] : [oneFeature, { ...oneFeature, name: 'blocked', label: 'Managed feature', canToggle: false, blockedReason: 'Read-only host policy.' }], nextCursor: url.searchParams.has('cursor') ? null : 'page-two' });
      }
      if (endpoint === '/features') return reply({ ...native, name: body.name, requestedEnabled: true, effectiveEnabled: false, acknowledged: true, runtimeOnly: true, message: 'Saved policy keeps this feature off.' });
      if (endpoint === '/skill-roots') {
        if (method === 'POST') { rootsApplied = true; rootPaths = body.paths; }
        return reply({ nativeConfirmed: rootsApplied, observedAt: rootsApplied ? native.observedAt : null, paths: rootPaths, runtimeOnly: true });
      }
      if (endpoint === '/import-history') {
        if (method === 'POST') { manualRecorded = true; return reply({ importId: 'manual', recorded: true, userReported: true }); }
        return reply({ ...native, data: manualRecorded ? [{ importId: 'manual', source: 'user', completedAt: native.observedAt, userReported: true, results: [] }] : [], nextCursor: null });
      }
      if (endpoint === '/imports/preview') return reply(preview());
      if (endpoint === '/imports') return reply({ operationId: 'operation', importId: null, status: 'running', results: [], startedAt: native.observedAt, updatedAt: native.observedAt, message: 'Import accepted.' });
      if (endpoint === '/imports/operation') { pollCount++; return reply({ operationId: 'operation', importId: null, status: reportUnknownImport ? 'unknown' : 'running', results: [], startedAt: native.observedAt, updatedAt: native.observedAt, message: reportUnknownImport ? 'The native operation outcome is not available.' : 'Import is still running.' }); }
      if (endpoint === '/feedback/preview') {
        if (body.reason === 'Delayed old workspace') await waitForRelease(release => deferredPreview = release);
        return reply({ previewId: 'feedback-preview', expiresAt: new Date(Date.now() + 60_000).toISOString(), files: body.files.map((path: string) => ({ path, bytes: 34 })), includeLogs: false, destination: 'OpenAI feedback service' });
      }
      if (endpoint === '/feedback') return route.fulfill({ status: 403, json: { error: 'Feedback is disabled by the current runtime.' } });
      if (endpoint === '/diagnostics') return diagnosticsFail ? route.fulfill({ status: 503, json: { error: 'Resource metrics are not available.' } }) : reply({ ...native, process: { id: 1, residentMemoryBytes: 1024, physicalFootprintBytes: null }, gauges: [] });
      if (endpoint === '/provider-capabilities') return reply({ ...native, namespaceTools: true, imageGeneration: false, webSearch: true });
      if (endpoint === '/permission-profiles' || endpoint === '/collaboration-modes' || endpoint === '/hooks') return reply({ ...native, data: [], nextCursor: null, warningCount: 0, errorCount: 0 });
      errors.push(`Unexpected API: ${method} ${url.pathname}`); return route.fulfill({ status: 500, json: { error: 'Unexpected fixture request' } });
    });

    await page.goto(origin);
    await expect(page.getByText('test-runtime')).toBeVisible();
    assert.equal(requests.length, 1, 'Only overview should load initially');
    await page.getByRole('button', { name: /^Runtime features/ }).click();
    await expect(page.getByRole('switch', { name: 'One feature' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Managed feature' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Next page of runtime features' }).click();
    await expect(page.getByRole('switch', { name: 'Two feature' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'One feature' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Previous page of runtime features' }).click();
    await page.getByRole('switch', { name: 'One feature' }).click();
    await expect(page.getByText('Saved policy keeps this feature off.')).toBeVisible();
    await expect(page.getByRole('switch', { name: 'One feature' })).toHaveAttribute('aria-checked', 'false');
    assert.deepEqual(mutations.find(item => item.endpoint === '/features')!.body, { name: 'one', enabled: true, expectedEnabled: false, threadId: 'thread-a' });

    await page.getByRole('button', { name: /^Extra skill folders Add workspace/ }).click();
    await expect(page.getByText('Extra skill folders have not been confirmed in this runtime.')).toBeVisible();
    await page.getByLabel('Workspace folders', { exact: true }).fill('../outside');
    await page.getByRole('button', { name: 'Apply skill folders' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'workspace-relative path' })).toBeVisible();
    assert.equal(mutations.filter(item => item.endpoint === '/skill-roots').length, 0);
    await page.getByLabel('Workspace folders', { exact: true }).fill('.codex/skills\nshared/skills');
    await page.getByRole('button', { name: 'Apply skill folders' }).click();
    await expect(page.getByText('Extra skill folders were acknowledged for the current runtime.')).toBeVisible();

    await page.getByRole('button', { name: /^Import into Codex/ }).click();
    await page.getByRole('button', { name: 'Preview import', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Import selected content' })).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: /^Tool configuration/ })).toBeDisabled();
    await page.getByRole('checkbox', { name: /^Project instructions/ }).check();
    await page.getByRole('button', { name: 'Hide panel' }).click();
    await page.getByRole('button', { name: 'Show panel' }).click();
    await expect(page.getByRole('checkbox', { name: /^Project instructions/ })).toBeChecked();
    await page.getByRole('button', { name: 'Import selected content' }).click();
    await expect(page.getByRole('heading', { name: 'Import in progress' })).toBeVisible();
    await page.getByRole('button', { name: 'Hide panel' }).click();
    await page.waitForTimeout(100);
    const hiddenPollCount = pollCount;
    await page.waitForTimeout(1800);
    assert.equal(pollCount, hiddenPollCount, 'Inactive mounted panels must not poll');
    await page.getByRole('button', { name: 'Show panel' }).click();
    await page.getByRole('button', { name: /^Import into Codex/ }).click();
    await page.waitForTimeout(100);
    const foldedPollCount = pollCount;
    await page.waitForTimeout(1800);
    assert.equal(pollCount, foldedPollCount, 'Closed import sections must not poll');
    reportUnknownImport = true;
    await page.getByRole('button', { name: /^Import into Codex/ }).click();
    await expect(page.getByRole('heading', { name: 'Import outcome unknown' })).toBeVisible({ timeout: 6000 });
    const stoppedPollCount = pollCount;
    await page.waitForTimeout(1700);
    assert.equal(pollCount, stoppedPollCount, 'Unknown operations stop polling');
    await page.getByText('Record an import completed elsewhere', { exact: true }).click();
    await page.getByLabel('Original workspace path').fill('CLAUDE.md');
    await expect(page.getByRole('button', { name: 'Record completed import', exact: true })).toBeDisabled();
    await page.getByRole('checkbox', { name: 'I confirm that I already completed this import.' }).check();
    await page.getByRole('button', { name: 'Record completed import', exact: true }).click();
    await expect(page.getByText('A user-reported import entry was recorded. No files were copied.')).toBeVisible();
    await expect(page.getByText('User reported', { exact: true })).toBeVisible();
    assert.deepEqual(mutations.find(item => item.endpoint === '/import-history')!.body, { itemType: 'AGENTS_MD', sourcePath: 'CLAUDE.md', targetPath: 'AGENTS.md', confirmCompleted: true });

    await page.getByRole('button', { name: /^Feedback Review/ }).click();
    await page.getByRole('combobox', { name: 'Feedback category' }).click();
    await page.getByRole('option', { name: 'Bug report', exact: true }).click();
    await page.getByLabel('What would you like to report?').fill('The list became stale.');
    await page.getByLabel('Workspace files (optional)').fill('notes/reproduction.md');
    await page.getByRole('button', { name: 'Preview feedback', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Send feedback to OpenAI' })).toBeDisabled();
    assert.equal(mutations.filter(item => item.endpoint === '/feedback').length, 0);
    await page.getByRole('checkbox', { name: 'I agree to send this report and the listed files to OpenAI.' }).check();
    await page.getByLabel('What would you like to report?').fill('Changed the report.');
    await expect(page.getByRole('button', { name: 'Send feedback to OpenAI' })).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Include a reference to the selected conversation.' }).check();
    await page.getByRole('button', { name: 'Preview feedback', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Send feedback to OpenAI' })).toBeDisabled();
    await page.getByRole('checkbox', { name: 'I agree to send this report and the listed files to OpenAI.' }).check();
    await page.getByRole('button', { name: 'Send feedback to OpenAI' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Feedback is disabled by the current runtime.' })).toBeVisible();
    assert.deepEqual(mutations.find(item => item.endpoint === '/feedback')!.body, { previewId: 'feedback-preview', consent: true, threadId: 'thread-a' });

    await page.getByLabel('What would you like to report?').fill('Delayed old workspace');
    await page.getByRole('button', { name: 'Preview feedback', exact: true }).click();
    await expect.poll(() => !!deferredPreview).toBe(true);
    await page.getByRole('button', { name: 'Switch workspace', exact: true }).click();
    deferredPreview!();
    await expect(page.getByText('test-runtime')).toBeVisible();
    await page.getByRole('button', { name: /^Feedback Review/ }).click();
    await expect(page.getByLabel('What would you like to report?')).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Send feedback to OpenAI' })).toHaveCount(0);
    delayFeatures = true;
    await page.getByRole('button', { name: /^Runtime features/ }).click();
    await expect.poll(() => !!deferredFeatures).toBe(true);
    await page.getByRole('button', { name: 'Switch conversation', exact: true }).click();
    deferredFeatures!();
    await page.getByRole('button', { name: /^Runtime features/ }).click();
    await expect(page.getByRole('switch', { name: 'One feature' })).toBeVisible();
    await expect(page.getByText('Delayed stale feature')).toHaveCount(0);
    assert.ok(requests.some(value => value.endsWith('/features?threadId=thread-b')));

    await page.getByRole('button', { name: /^Runtime & capabilities/ }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Resource metrics are not available.' })).toBeVisible();
    await expect(page.getByText('Reported unavailable', { exact: true })).toBeVisible();
    diagnosticsFail = false;
    await page.getByRole('button', { name: 'Retry resource usage' }).click();
    await expect(page.getByText('1 KiB', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole('button', { name: /^Import into Codex/ }).click();
    await page.getByRole('button', { name: 'Preview import', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Review the import' })).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Mobile layout should not overflow horizontally');
    await page.screenshot({ path: join(dir, 'mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.screenshot({ path: join(dir, 'desktop.png'), fullPage: true });
    assert.deepEqual(errors, []);
    const report = { passed: ['lazy initial read', 'bounded feature pages', 'read-only flags', 'requested versus effective feature state', 'relative folder validation', 'unconfirmed folder metadata', 'import gates', 'preserve selections when inactive', 'pause polling when panel inactive', 'pause polling when section closed', 'stop on unknown import', 'manual import confirmation and attribution', 'feedback consent', 'preview invalidation', 'visible host rejection', 'stale workspace response isolation', 'stale conversation response isolation', 'independent read failures and retries', 'mobile overflow'], requests: requests.length, screenshots: [join(dir, 'mobile.png'), join(dir, 'desktop.png')] };
    await writeFile(join(dir, 'result.json'), JSON.stringify(report, null, 2));
    passed = true;
    process.stdout.write(`Native discovery browser checks passed (${report.passed.length} checks; ${requests.length} fixture requests).\n`);
    if (keepArtifacts) process.stdout.write(`Browser artifacts: ${dir}\n`);
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: join(dir, 'failure.png'), fullPage: true }).catch(() => undefined);
    process.stderr.write(`Browser artifacts: ${dir}\n`);
    throw error;
  } finally {
    for (const release of held) release();
    await page?.close().catch(() => undefined);
    await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    if (passed && !keepArtifacts) await rm(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
