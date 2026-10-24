/** Real composer interactions against owned HTTP fixtures; no native/model process. */
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer, type ServerResponse } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { browserLaunchOptions } from './browser-launch';
import type { Thread, UiState } from '../shared/types';
import { SERVICE_TIERS } from '../shared/service-tiers';

const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'composer-tier-browser-'));
const id = '01990000-0000-7000-8000-000000000101', turnId = '01990000-0000-7000-8000-000000000201';
const capabilities = { conversations: true, pagination: true, queue: true, goals: false, skills: false, plan: false, review: false, historyRevert: false };
const workspace = { id: 'owned', name: 'Owned fixture', path: '/tmp/composer-tier-fixture', createdAt: '2026-10-03T00:00:00Z' };
const settings = { model: 'native/first', reasoningEffort: null, reasoningSummary: null, serviceTier: 'priority',
  provider: 'openai', autoApprove: false, theme: 'dark', fontSize: 13, wordWrap: false, apiKeyConfigured: true };
let ui: UiState = { version: 1, revision: 0, layouts: {}, editor: {}, workspaces: {}, fieldRevisions: {} };
let thread: Thread | undefined, rejection = false;
const events = new Set<ServerResponse>(), requests: Array<{ method: string; path: string; body: any }> = [], errors: string[] = [];
const endpoint = `/api/workspaces/owned/codex/threads/${id}/current-turn-settings`;
function snapshot() { for (const res of events) res.write(`data: ${JSON.stringify({ type: 'snapshot', threadId: id, thread })}\n\n`); }
const bundle = await build({ stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
  import React from 'react'; import { createRoot } from 'react-dom/client';
  import ChatPanel from './client/components/ChatPanel';
  import { hydrateUiState } from './client/ui-state';
  import './client/styles.css';
  const workspace = ${JSON.stringify(workspace)};
  await hydrateUiState(undefined, [workspace]);
  window.dispatchEvent(new Event('codex:session-unlocked'));
  createRoot(document.getElementById('root')).render(<ChatPanel workspace={workspace} settings={${JSON.stringify(settings)}} onSettings={() => {}} onNotify={() => {}} />);
` }, bundle: true, write: false, outdir: artifacts, format: 'esm', platform: 'browser', minify: true,
  define: { 'process.env.NODE_ENV': '"production"' } });
const js = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text;
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://fixture.invalid');
  if (!url.pathname.startsWith('/api/')) {
    if (url.pathname === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(js); return; }
    if (url.pathname === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css + '\nhtml,body,#root{height:100%;margin:0}'); return; }
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script>'); return;
  }
  if (url.pathname.endsWith('/events')) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    events.add(res); snapshot(); req.on('close', () => events.delete(res)); return;
  }
  let text = ''; for await (const bytes of req) text += bytes;
  const body = text ? JSON.parse(text) : undefined;
  requests.push({ method: req.method ?? 'GET', path: url.pathname, body });
  const send = (value: unknown, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
  if (url.pathname === '/api/ui-state') {
    if (req.method === 'PATCH') {
      ui = structuredClone(ui); ui.revision++;
      for (const change of body.changes) {
        const old = ui.workspaces[change.workspaceId] ?? {};
        if (change.key === 'serviceTier') ui.workspaces[change.workspaceId] = { ...old,
          serviceTiers: { ...old.serviceTiers, [change.threadId ?? 'draft']: change.value } };
        else ui.workspaces[change.workspaceId] = { ...old, [change.key]: change.value };
        ui.fieldRevisions[`workspace.${change.workspaceId}.${change.key}${change.key === 'serviceTier' ? '.' + (change.threadId ?? 'draft') : ''}`] = ui.revision;
      }
    }
    send(ui); return;
  }
  if (url.pathname === '/api/codex/runtime') { send({ backend: 'codex-cli', state: 'ready', version: 'fixture', installedVersion: 'fixture',
    startedAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z', canUpdate: !thread?.native?.activeTurnId,
    updateBlockedReason: null, error: null, activeTurns: thread?.native?.activeTurnId ? 1 : 0, capabilities }); return; }
  if (url.pathname === '/api/models') {
    send({ backend: 'codex-cli', connected: true, models: ['native/first', 'future/model'], catalog: ['native/first', 'future/model'].map((model, index) => ({
      id: model, model, displayName: index ? 'Future model' : 'First model', description: 'Native catalogue fixture', hidden: false, isDefault: index === 0,
      defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Low' }], inputModalities: ['text'], serviceTiers: [],
    })) }); return;
  }
  if (url.pathname === '/api/threads') {
    if (req.method === 'POST') {
      thread = { id, workspaceId: 'owned', backend: 'codex-cli', title: 'Owned conversation', createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z', status: 'idle', messages: [],
        native: { loaded: true, model: body.model, reasoningEffort: null, activeTurnId: null, requestedServiceTier: body.serviceTier,
          approvals: [], questions: [], queue: [], queueCursor: null, goal: null, tokenUsage: null, diff: null, capabilities } };
      send(thread, 201);
    } else send(thread ? [thread] : []);
    return;
  }
  if (url.pathname === `/api/threads/${id}`) { send(thread); return; }
  if (url.pathname === `/api/threads/${id}/agents`) { send([]); return; }
  if (url.pathname === `/api/threads/${id}/run`) {
    thread!.status = 'running'; thread!.native!.activeTurnId = turnId;
    send({ threadId: id, turnId, clientUserMessageId: body.clientUserMessageId }, 202); snapshot(); return;
  }
  if (url.pathname === `/api/threads/${id}/input`) {
    send({ threadId: id, turnId, clientUserMessageId: body.clientUserMessageId }, 202); return;
  }
  if (url.pathname === `/api/threads/${id}/queue`) {
    if (req.method === 'POST') send({ threadId: id, queuedSubmission: { id: 'queued-fixture', clientUserMessageId: body.clientUserMessageId }, clientUserMessageId: body.clientUserMessageId }, 202);
    else send({ items: [], nextCursor: null });
    return;
  }
  if (url.pathname === endpoint) {
    if (req.method === 'PATCH') {
      if (rejection) send({ code: 'CODEX_RPC_REJECTED', error: 'The native provider rejected Ultrafast.' }, 422);
      else send({ scope: 'current-turn', threadId: id, turnId, status: 'applied' });
    } else send({ scope: 'current-turn', threadId: id, activeTurnId: turnId, generation: 'browser-generation', canRequest: true, currentValuesReadable: false, models: [] });
    return;
  }
  send({ error: 'Unexpected fixture route: ' + url.pathname }, 404);
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address(); if (!address || typeof address === 'string') throw new Error('Owned fixture address missing');
const browser = await chromium.launch({ ...browserLaunchOptions(), headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
page.on('pageerror', error => errors.push(error.message));
const tier = page.getByRole('combobox', { name: 'Service tier', exact: true });
async function choose(label: string, value: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: new RegExp('^' + value + '(?: |$)') }).click();
}
try {
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await expect(tier).toBeEnabled(); await expect(tier).toHaveText('Priority');
  await tier.click();
  for (const option of SERVICE_TIERS) await expect(page.getByRole('option', { name: new RegExp('^' + option.name + '(?: |$)') })).toBeVisible();
  await page.keyboard.press('Escape');
  await choose('Service tier', 'Fast');
  await choose('Model', 'Future model'); await expect(tier).toHaveText('Fast');
  await page.getByRole('textbox', { name: 'Message Codex' }).fill('Owned synthetic prompt');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => requests.some(item => item.path.endsWith('/run'))).toBe(true);
  expect(requests.find(item => item.path === '/api/threads' && item.method === 'POST')!.body.serviceTier).toBe('fast');
  expect(requests.find(item => item.path.endsWith('/run'))!.body).toMatchObject({ model: 'future/model', serviceTier: 'fast' });
  await expect(page.getByRole('button', { name: 'Stop response' })).toBeVisible();
  await expect(tier).toBeEnabled();
  await choose('Service tier', 'Priority');
  await expect(page.getByRole('status').filter({ hasText: 'Codex accepted the service tier' })).toBeVisible();
  expect(requests.filter(item => item.path === endpoint && item.method === 'PATCH').at(-1)!.body)
    .toEqual({ expectedTurnId: turnId, expectedGeneration: 'browser-generation', serviceTier: 'priority' });
  rejection = true;
  await choose('Service tier', 'Ultrafast');
  await expect(page.getByRole('alert').filter({ hasText: 'The native provider rejected Ultrafast.' })).toBeVisible();
  await expect(tier).toHaveText('Ultrafast');
  expect(requests.filter(item => item.path === endpoint && item.method === 'PATCH')).toHaveLength(2);
  await page.getByRole('textbox', { name: 'Message Codex' }).fill('Owned queued prompt');
  await page.getByRole('button', { name: 'Queue message for next turn', exact: true }).click();
  await expect.poll(() => requests.some(item => item.path.endsWith('/queue') && item.method === 'POST')).toBe(true);
  expect(requests.find(item => item.path.endsWith('/queue') && item.method === 'POST')!.body.serviceTier).toBe('ultrafast');
  await expect.poll(() => ui.workspaces.owned?.serviceTiers?.[id]).toBe('ultrafast');
  await page.reload(); await expect(tier).toHaveText('Ultrafast');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(tier).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Reasoning effort', exact: true })).toBeVisible();
  expect((await page.getByRole('combobox', { name: 'Model', exact: true }).boundingBox())!.width).toBeGreaterThanOrEqual(90);
  expect((await tier.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await tier.click();
  for (const option of SERVICE_TIERS) await expect(page.getByRole('option', { name: new RegExp('^' + option.name + '(?: |$)') })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(artifacts, 'composer-tier-mobile.png') });
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(tier).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // A reconnect can report a busy thread before its turn ID arrives. The
  // existing steering fallback must still satisfy the strict /input schema.
  thread!.native!.activeTurnId = null; snapshot();
  await choose('Service tier', 'Scale');
  await expect(page.getByRole('alert').filter({ hasText: 'Codex has not reported an active turn' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Message Codex' }).fill('Guidance during a turn-ID handoff');
  await page.getByRole('button', { name: 'Send guidance', exact: true }).click();
  await expect.poll(() => requests.some(item => item.path.endsWith('/input'))).toBe(true);
  expect(requests.find(item => item.path.endsWith('/input'))!.body).not.toHaveProperty('serviceTier');
  expect(requests.find(item => item.path.endsWith('/input'))!.body).not.toHaveProperty('expectedTurnId');
  expect(requests.some(item => item.path === '/api/settings' || item.path.includes('/config/'))).toBe(false);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ status: 'passed', artifacts, mutationPaths: requests.filter(item => item.method === 'POST' || item.method === 'PATCH').map(item => item.path) }));
} finally {
  await browser.close(); for (const event of events) event.end();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
