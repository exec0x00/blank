/** Model-free current-turn form verification; pairs with native-turn-controls.test.ts. */
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { browserLaunchOptions } from './browser-launch';

const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'native-turn-controls-ui-'));
const threadId = '01990000-0000-7000-8000-000000000101', turnId = '01990000-0000-7000-8000-000000000201';
const generation = 'turn-browser-generation', endpoint = `/api/workspaces/owned/codex/threads/${threadId}/current-turn-settings`;
let mode: 'active' | 'targetUnavailable' | 'rejected' | 'providerRejected' = 'active', idle = false;
const requests: Array<{ method: string; path: string; body?: unknown }> = [];
const bundle = await build({ stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
  import React from 'react'; import { createRoot } from 'react-dom/client';
  import { NativeCurrentTurnControls } from './client/components/native/NativeOrganizationPanel';
  import './client/styles.css';
  createRoot(document.getElementById('root')).render(<main style={{padding:16,maxWidth:760,margin:'auto'}}><NativeCurrentTurnControls workspaceId="owned" threadId="${threadId}" /></main>);
` }, bundle: true, write: false, outdir: artifacts, format: 'esm', platform: 'browser', minify: true, define: { 'process.env.NODE_ENV': '"production"' } });
const js = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text, css = bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text;
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://fixture.invalid');
  if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script>'); return; }
  if (url.pathname === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(js); return; }
  if (url.pathname === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css + '\n#root{overflow:auto}'); return; }
  let text = ''; for await (const bytes of req) text += bytes;
  const body = text ? JSON.parse(text) : undefined; requests.push({ method: req.method ?? 'GET', path: url.pathname, body });
  res.setHeader('Content-Type', 'application/json');
  if (url.pathname !== endpoint) { res.statusCode = 404; res.end('{"error":"Unexpected fixture route"}'); return; }
  if (req.method === 'PATCH') {
    if (mode === 'rejected') { idle = true; res.statusCode = 501; res.end(JSON.stringify({ code: 'CODEX_METHOD_UNAVAILABLE', error: 'Native current-turn updates are unavailable.' })); return; }
    if (mode === 'providerRejected') { res.statusCode = 422; res.end(JSON.stringify({ error: 'The provider rejected service tier ultrafast for this request.' })); return; }
    if (mode === 'targetUnavailable') idle = true;
    res.end(JSON.stringify({ scope: 'current-turn', threadId, turnId, status: mode === 'active' ? 'applied' : 'targetUnavailable' })); return;
  }
  res.end(JSON.stringify({ scope: 'current-turn', threadId, activeTurnId: idle ? null : turnId, generation, canRequest: !idle,
    unavailableReason: idle ? mode === 'rejected' ? 'Native current-turn updates are unavailable.' : 'There is no running native turn to update.' : null,
    currentValuesReadable: false, models: [
      { id: 'first', model: 'native/first', displayName: 'First native model', reasoningEfforts: ['max', 'ultra'], serviceTiers: [{ id: 'fast', name: 'Fast' }] },
      { id: 'six-sol', model: 'gpt-6-sol', displayName: 'GPT-6 Sol', reasoningEfforts: ['max', 'ultra'], serviceTiers: [{ id: 'fast', name: 'Fast' }] },
      { id: 'future', model: 'future/model:2040', displayName: 'Future model', reasoningEfforts: ['max', 'ultra'], serviceTiers: [] },
    ] }));
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing owned fixture address.');
const browser = await chromium.launch({ ...browserLaunchOptions(), headless: true });
const page = await browser.newPage({ viewport: { width: 320, height: 960 }, reducedMotion: 'reduce' }), errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
async function choose(label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: new RegExp('^' + option) }).click();
}
try {
  await page.goto(`http://127.0.0.1:${address.port}/`);
  const apply = page.getByRole('button', { name: 'Apply to current turn', exact: true });
  await expect(apply).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Current-turn model', exact: true })).toHaveText('Leave unchanged');
  await choose('Current-turn model', 'First native model');
  await choose('Current-turn reasoning effort', 'ultra');
  await choose('Current-turn service tier', 'Clear requested tier');
  expect(requests.filter(request => request.method === 'PATCH')).toHaveLength(0);
  await apply.click();
  await expect(page.locator('[data-native-turn-status="applied"]')).toBeVisible();
  expect(requests.filter(request => request.method === 'PATCH').at(-1)!.body).toEqual({ expectedTurnId: turnId, expectedGeneration: generation, model: 'native/first', effort: 'ultra', serviceTier: null });
  await expect(apply).toBeDisabled();
  await choose('Current-turn model', 'GPT-6 Sol');
  await choose('Current-turn service tier', 'Ultrafast');
  await choose('Current-turn model', 'Future model');
  await expect(page.getByRole('combobox', { name: 'Current-turn service tier', exact: true })).toHaveText('Ultrafast');
  await expect(apply).toBeEnabled(); await apply.click();
  await expect(page.locator('[data-native-turn-status="applied"]')).toBeVisible();
  expect(requests.filter(request => request.method === 'PATCH').at(-1)!.body).toEqual({ expectedTurnId: turnId, expectedGeneration: generation, model: 'future/model:2040', serviceTier: 'ultrafast' });
  await expect(apply).toBeDisabled();
  mode = 'providerRejected';
  await choose('Current-turn service tier', 'Ultrafast'); await apply.click();
  await expect(page.getByText('The provider rejected service tier ultrafast for this request.', { exact: true })).toBeVisible();
  await expect(page.locator('[data-native-turn-status="applied"]')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Current-turn service tier', exact: true })).toHaveText('Ultrafast');
  expect(requests.filter(request => request.method === 'PATCH').at(-1)!.body).toEqual({ expectedTurnId: turnId, expectedGeneration: generation, serviceTier: 'ultrafast' });
  mode = 'active';
  await choose('Current-turn service tier', 'Fast'); await apply.click();
  await expect(page.locator('[data-native-turn-status="applied"]')).toBeVisible();
  expect(requests.filter(request => request.method === 'PATCH').at(-1)!.body).toEqual({ expectedTurnId: turnId, expectedGeneration: generation, serviceTier: 'fast' });
  await expect(apply).toBeDisabled();
  mode = 'targetUnavailable';
  await choose('Current-turn public reasoning summary', 'Detailed'); await apply.click();
  await expect(page.locator('[data-native-turn-status="targetUnavailable"]')).toBeVisible();
  await expect(page.getByText('There is no running native turn to update.', { exact: true })).toBeVisible();
  expect(requests.filter(request => request.method === 'PATCH').at(-1)!.body).toEqual({ expectedTurnId: turnId, expectedGeneration: generation, summary: 'detailed' });
  await expect(page.locator('[data-native-turn-status="applied"]')).toHaveCount(0);
  expect(await apply.count()).toBe(0);
  mode = 'rejected'; idle = false; await page.reload();
  await choose('Current-turn approval reviewer', 'You'); await apply.click();
  await expect(page.getByText('Native current-turn updates are unavailable.', { exact: true }).first()).toBeVisible();
  await expect(apply).toHaveCount(0);
  expect(requests.every(request => request.path === endpoint)).toBe(true);
  expect(await page.evaluate(() => document.querySelector('.native-organization')!.scrollWidth > document.querySelector('.native-organization')!.clientWidth + 1)).toBe(false);
  expect(errors).toEqual([]);
  await page.screenshot({ path: path.join(artifacts, '320px.png') });
  process.stdout.write(`Current-turn UI checks passed: Ultrafast across models, exact tier requests and errors, native statuses, idle/unavailable handling, 320 px layout. Artifacts: ${artifacts}\n`);
} catch (error) {
  await page.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => undefined); process.stderr.write(`Browser artifacts: ${artifacts}\n`); throw error;
} finally {
  await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
}
