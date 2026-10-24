/** Targeted, model-free UI verification. Run with:
 * node_modules/.bin/tsx tests/native-organization-ui.playwright.ts
 * The HTTP fixture exercises browser requests; it does not claim native
 * runtime success. Backend authority is covered by native-organization.test.ts. */
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { browserLaunchOptions } from './browser-launch';

const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'native-organization-ui-'));
const revision = 'a'.repeat(64), threadId = '01990000-0000-7000-8000-000000000001';
const nativeProject = { project: { id: 'native-project', name: 'Website', roots: [{ path: '/owned/workspace' }], metadata: {}, position: 0,
  createdAt: 1, updatedAt: 2, recencyAt: null }, workspaceRoots: ['.'], revision };
const section = { id: 'native-section', name: 'Planning', appearance: null };
const queued = [0, 1].map(index => ({ id: `queued-${index}`, clientUserMessageId: `client-${index}`, prompt: `Pending ${index + 1}`,
  attachmentNames: index === 0 ? ['keep.txt'] : [], revision, editable: true }));
let queueOrder = queued.map(item => item.id);
const requests: Array<{ method: string; path: string; body: any }> = [];
const bundle = await build({ stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
  import React from 'react'; import { createRoot } from 'react-dom/client';
  import NativeOrganizationPanel from './client/components/native/NativeOrganizationPanel';
  import './client/styles.css';
  function Harness() {
    const [active, setActive] = React.useState(true);
    React.useEffect(() => { const change = event => setActive(event.detail); window.addEventListener('organization-test-visibility', change); return () => window.removeEventListener('organization-test-visibility', change); }, []);
    return <main className="org-harness"><NativeOrganizationPanel workspaceId="owned-workspace" threadId="${threadId}" active={active} /></main>;
  }
  createRoot(document.getElementById('root')).render(<Harness />);
` }, bundle: true, format: 'esm', platform: 'browser', outdir: artifacts, write: false, minify: true,
  define: { 'process.env.NODE_ENV': '"production"' } });
const js = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text, css = bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text;
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://fixture.invalid');
  if (url.pathname === '/') {
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>'); return;
  }
  if (url.pathname === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(js); return; }
  if (url.pathname === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css + '\n#root{overflow:auto}.org-harness{max-width:900px;padding:20px;margin:auto}@media(max-width:600px){.org-harness{padding:12px}}'); return; }
  let bytes = ''; for await (const chunk of req) bytes += chunk;
  const body = bytes ? JSON.parse(bytes) : undefined;
  requests.push({ method: req.method ?? 'GET', path: url.pathname, body });
  res.setHeader('Content-Type', 'application/json');
  const reply = (value: unknown) => res.end(JSON.stringify(value));
  if (url.pathname.endsWith('/queue-edit/reorder')) { queueOrder = body.queuedSubmissionIds; reply({}); return; }
  if (url.pathname.includes('/queue-edit/')) { const entry = queued.find(item => item.id === url.pathname.split('/').at(-1)); if (entry) entry.prompt = body.prompt; reply({}); return; }
  if (url.pathname.endsWith('/queue-edit')) { reply({ items: queueOrder.map(id => queued.find(item => item.id === id)), revision, nextCursor: null }); return; }
  if (url.pathname.endsWith('/organization')) { reply({ threadId, projectId: null, section: null, gitInfo: null, daybreakEnabled: null, memoryModeReadable: false, revision }); return; }
  if (url.pathname.endsWith('/codex/projects')) {
    if (req.method === 'POST') { reply({ ...nativeProject, project: { ...nativeProject.project, name: body.name } }); return; }
    reply({ data: [nativeProject], nextCursor: null, filteredCount: 0 }); return;
  }
  if (url.pathname.endsWith('/codex/projects/native-project')) { reply(nativeProject); return; }
  if (url.pathname.endsWith('/codex/thread-sections')) { reply({ data: [section], nextCursor: null, scope: 'all-native-workspaces' }); return; }
  if (url.pathname === '/api/threads') { reply({ items: [{ id: threadId, title: 'Current conversation', workspaceId: 'owned-workspace', backend: 'codex-cli' }], olderCursor: null, hasOlder: false }); return; }
  if (url.pathname === '/api/codex/memory') { reply({ v2ConsolidatedThreads: 3, v2Ready: false, minConsolidatedThreads: 20, activeTurns: 0, scope: 'all-native-workspaces' }); return; }
  if (url.pathname === '/api/codex/memory/reset') { reply({}); return; }
  res.statusCode = 404; reply({ error: 'Unexpected fixture route.' });
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture address.');
const browser = await chromium.launch({ ...browserLaunchOptions(), headless: true });
const errors: string[] = [];
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 960 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await expect(page.getByRole('heading', { name: 'Organization', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New project', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'New project', exact: true }).click();
    await page.getByLabel('Project name', { exact: true }).fill('Responsive native project');
    await page.getByLabel('Workspace folders', { exact: true }).fill('.\nfolder');
    await page.getByRole('button', { name: /^Projects/ }).click();
    await expect(page.getByLabel('Project name', { exact: true })).toBeHidden();
    await page.getByRole('button', { name: /^Projects/ }).click();
    await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('Responsive native project');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('organization-test-visibility', { detail: false })));
    await expect(page.getByRole('heading', { name: 'Organization', exact: true })).toBeHidden();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('organization-test-visibility', { detail: true })));
    await expect(page.getByLabel('Workspace folders', { exact: true })).toHaveValue('.\nfolder');
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await expect(page.getByText('Project created in Codex.', { exact: true })).toBeVisible();
    const creation = requests.filter(item => item.method === 'POST' && item.path.endsWith('/codex/projects')).at(-1)!;
    expect(creation.body.roots).toEqual(['.', 'folder']); expect(creation.body.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/);
    await page.getByRole('button', { name: 'Close project editor' }).click();
    await page.getByRole('button', { name: /^Queued messages/ }).click();
    await expect(page.getByRole('button', { name: 'Edit text', exact: true }).first()).toBeEnabled();
    await page.getByRole('button', { name: 'Edit text', exact: true }).first().click();
    const editor = page.getByLabel('Message text', { exact: true });
    await editor.fill(`Changed queued text ${width}`); await editor.press('Enter'); await editor.press('x');
    const beforeSave = requests.filter(item => item.method === 'PATCH').length;
    await expect(editor).toHaveValue(`Changed queued text ${width}\nx`);
    expect(requests.filter(item => item.method === 'PATCH')).toHaveLength(beforeSave);
    await page.getByRole('button', { name: 'Save pending text', exact: true }).click();
    await expect(page.getByText('Pending text updated in Codex.', { exact: true })).toBeVisible();
    const edit = requests.filter(item => item.method === 'PATCH').at(-1)!;
    expect(edit.body).toEqual({ prompt: `Changed queued text ${width}\nx`, expectedRevision: revision });
    await page.getByRole('button', { name: 'Move pending message 2 earlier' }).click();
    await page.getByRole('button', { name: 'Save queue order', exact: true }).click();
    await expect(page.getByText('Native queue order updated.', { exact: true })).toBeVisible();
    const reorder = requests.filter(item => item.path.endsWith('/queue-edit/reorder')).at(-1)!;
    expect(reorder.body.queuedSubmissionIds).toHaveLength(2); expect(reorder.body.expectedRevision).toBe(revision);
    await page.getByRole('button', { name: /^Memory and maintenance/ }).click();
    await page.getByLabel('Memory readiness threshold', { exact: true }).fill('0');
    await expect(page.getByRole('button', { name: 'Check native memory', exact: true })).toBeDisabled();
    await page.getByLabel('Memory readiness threshold', { exact: true }).fill('20');
    await page.getByRole('button', { name: 'Review memory reset', exact: true }).click();
    const reset = page.getByRole('button', { name: 'Reset all native memory', exact: true });
    await expect(reset).toBeDisabled();
    const resetRequests = requests.filter(item => item.path === '/api/codex/memory/reset').length;
    await page.getByLabel('Type RESET ALL MEMORY', { exact: true }).fill('RESET');
    await expect(reset).toBeDisabled(); expect(requests.filter(item => item.path === '/api/codex/memory/reset')).toHaveLength(resetRequests);
    await page.getByLabel('Type RESET ALL MEMORY', { exact: true }).fill('RESET ALL MEMORY');
    await expect(reset).toBeEnabled(); await reset.click();
    await expect(page.getByText('Codex acknowledged the native memory reset across all workspaces.', { exact: true })).toBeVisible();
    expect(requests.filter(item => item.path === '/api/codex/memory/reset').at(-1)!.body).toEqual({ confirmation: 'reset-memory-across-all-native-workspaces' });
    const overflow = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.native-organization, .native-org-section, .native-org-editor, .native-org-section-body'))
      .filter(element => element.scrollWidth > element.clientWidth + 1).map(element => ({ name: element.className, scroll: element.scrollWidth, client: element.clientWidth })));
    expect(overflow).toEqual([]);
    await page.getByRole('heading', { name: 'Organization', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(artifacts, `${width}px.png`) });
    await page.close();
  }
  expect(errors).toEqual([]);
  process.stdout.write(`Native organization browser checks passed at 1440, 390, and 320 px. Screenshots: ${artifacts}\n`);
} catch (error) {
  const page = browser.contexts().flatMap(context => context.pages())[0];
  if (page) await page.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => undefined);
  process.stderr.write(`Browser artifacts: ${artifacts}\n`); throw error;
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
}
