import { expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, type ServerResponse } from 'node:http';
import { chromium, type Browser } from '@playwright/test';
import type { NativeMcpElicitation, NativeMcpState } from '../shared/native-mcp';
import { browserLaunchOptions } from './browser-launch';

/** Opt-in real browser check over controlled presentation DTOs. No installer,
 * native MCP server, tool, credential keyring, or model endpoint is invoked. */
it.skipIf(process.env.CODEX_MCP_BROWSER_TEST !== '1')('renders explicit MCP forms, preserves nonsecret drafts, clears passwords, and never resubmits a surrounding tool', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-mcp-browser-'));
  const clients = new Set<ServerResponse>(), actions: Array<{ route: string; body: Record<string, unknown> }> = [];
  const THREAD = '01990000-0000-7000-8000-000000000001';
  const CHILD = '01990000-0000-7000-8000-000000000002';
  let stateReads = 0, toolCalls = 0, toolResponse: ServerResponse | undefined;
  const form = { field: { key: '', label: 'Inputs', kind: 'object' as const, required: true, fields: [
    { key: 'details', label: 'Details', kind: 'string' as const, required: true, maxLength: 100 },
    { key: 'secret', label: 'Secret', kind: 'string' as const, required: true, secret: true },
  ] }, unavailableReason: null };
  const pending = (id: string): NativeMcpElicitation => ({ id, threadId: THREAD, serverName: 'Fixture server', mode: 'form', title: 'Provide details', message: 'Choose what to send.', form,
    unavailableReason: null, expiresAt: '2099-01-01T00:00:00Z' });
  const state: NativeMcpState = { connected: true, capabilities: { inventory: true, reload: true, oauth: true, resources: true, tools: true, events: true, elicitation: true, verification: false }, requests: [{ ...pending('11111111-1111-4111-8111-111111111111'), threadId: CHILD, threadTitle: 'Research agent' }], subscriptions: [], notices: [] };
  const changed = () => { for (const response of clients) response.write('event: changed\ndata: {}\n\n'); };
  const serverDto = { id: '22222222-2222-4222-8222-222222222222', name: 'Fixture server', status: 'connected', authentication: 'unsupported', origin: null, description: null, toolCount: 1, resourceCount: 0, templateCount: 0, canStream: false, toolError: null };
  const send = (res: ServerResponse, body: unknown) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  await build({ entryPoints: [path.resolve('tests/native-mcp-ui.fixture.tsx')], bundle: true, outfile: path.join(directory, 'fixture.js'), platform: 'browser', format: 'esm', jsx: 'automatic', logLevel: 'silent' });
  const server = createServer((req, res) => { void (async () => {
    const url = new URL(req.url || '/', 'http://fixture.invalid');
    if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body style="overflow:auto"><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>'); return; }
    if (url.pathname === '/fixture.js' || url.pathname === '/fixture.css') { res.setHeader('Content-Type', url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(await fs.readFile(path.join(directory, path.basename(url.pathname)))); return; }
    if (url.pathname.endsWith('/events')) { res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'Cache-Control': 'no-store' }); res.write('event: changed\ndata: {}\n\n'); clients.add(res); res.once('close', () => clients.delete(res)); return; }
    if (url.pathname.endsWith('/state')) { stateReads++; send(res, state); return; }
    let body: Record<string, unknown> = {};
    if (req.method === 'POST') { const chunks: Buffer[] = []; let bytes = 0; for await (const chunk of req) { bytes += chunk.length; if (bytes > 32_768) throw new Error('Fixture input too large.'); chunks.push(chunk); } body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); actions.push({ route: url.pathname, body }); }
    if (url.pathname.endsWith('/inventory')) { send(res, { servers: [serverDto], nextCursor: null, checkedAt: '2026-09-30T00:00:00Z' }); return; }
    if (url.pathname.endsWith('/catalog')) { send(res, { tools: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Search documents', description: 'Search documents with explicit server input.', readOnly: true, destructive: false,
      form: { field: { key: '', label: 'Inputs', kind: 'object', required: true, fields: [{ key: 'query', label: 'Query', kind: 'string', required: true }] }, unavailableReason: null } }], resources: [], total: 1, nextOffset: null }); return; }
    if (url.pathname.endsWith('/tool')) { toolCalls++; toolResponse = res; state.requests = [pending('44444444-4444-4444-8444-444444444444')]; changed(); return; }
    if (url.pathname.endsWith('/respond')) {
      state.requests = []; send(res, { accepted: true }); changed();
      if (toolResponse) { send(toolResponse, { content: [{ kind: 'text', text: 'Completed after input.' }], isError: false, truncated: false }); toolResponse = undefined; }
      return;
    }
    res.writeHead(404); res.end();
  })().catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture address.');
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true, ...browserLaunchOptions() });
    const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.getByRole('button', { name: /Fixture server needs your input/ }).click();
    let requestDialog = page.getByRole('dialog', { name: 'Provide details' });
    await requestDialog.getByLabel('Details', { exact: false }).fill('Retain this draft');
    await requestDialog.getByLabel('Secret', { exact: false }).fill('fixture-secret-once');
    await requestDialog.getByRole('button', { name: 'Close dialog' }).click();
    await page.getByRole('button', { name: /Fixture server needs your input/ }).click();
    requestDialog = page.getByRole('dialog', { name: 'Provide details' });
    expect(await requestDialog.getByLabel('Details', { exact: false }).inputValue()).toBe('Retain this draft');
    expect(await requestDialog.getByLabel('Secret', { exact: false }).inputValue()).toBe('');
    expect(actions.filter(action => action.route.endsWith('/respond'))).toEqual([]);
    await requestDialog.getByLabel('Secret', { exact: false }).fill('fixture-secret-explicit');
    await requestDialog.getByRole('button', { name: 'Send answers' }).click();
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    expect(actions.filter(action => action.route.endsWith('/respond'))[0].body).toEqual({ threadId: CHILD, action: 'accept', content: { details: 'Retain this draft', secret: 'fixture-secret-explicit' }, confirmed: true });
    expect(await page.locator('body').getAttribute('data-outer-submits')).toBeNull();
    await page.getByRole('button', { name: 'Check connections' }).click();
    await page.getByRole('button', { name: '1 tools' }).click();
    await page.getByRole('button', { name: 'Open tool' }).click();
    const toolDialog = page.getByRole('dialog', { name: 'Search documents' });
    await toolDialog.getByLabel('Query', { exact: false }).fill('needs server input');
    await toolDialog.getByRole('button', { name: 'Run tool' }).click();
    await toolDialog.getByRole('button', { name: /Fixture server needs your input/ }).click();
    requestDialog = page.getByRole('dialog', { name: 'Provide details' });
    await requestDialog.getByLabel('Details', { exact: false }).fill('Only this answer');
    await requestDialog.getByLabel('Secret', { exact: false }).fill('fixture-secret-for-native');
    await requestDialog.getByRole('button', { name: 'Send answers' }).click();
    await toolDialog.getByText('Completed after input.', { exact: true }).waitFor();
    expect(toolCalls).toBe(1); expect(await page.locator('body').getAttribute('data-outer-submits')).toBeNull();
    await page.evaluate(() => document.getElementById('fixture-toggle')?.click());
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    await page.waitForTimeout(100); const pausedReads = stateReads; await page.waitForTimeout(250); expect(stateReads).toBe(pausedReads);
    await page.evaluate(() => document.getElementById('fixture-toggle')?.click());
    await toolDialog.waitFor(); expect(await toolDialog.getByLabel('Query', { exact: false }).inputValue()).toBe('needs server input');
    for (const width of [900, 320]) {
      await page.setViewportSize({ width, height: 800 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const bounds = await toolDialog.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: path.join(directory, `mcp-${width}.png`), animations: 'disabled' });
    }
    expect(errors).toEqual([]);
    console.log(`Native MCP browser proof: ${directory}`);
  } finally {
    await browser?.close(); for (const client of clients) client.destroy(); server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await fs.rm(path.join(directory, 'fixture.js'), { force: true }); await fs.rm(path.join(directory, 'fixture.css'), { force: true });
  }
}, 90_000);

it.skipIf(process.env.CODEX_MCP_BROWSER_TEST !== '1')('shows request-shelf loading failures and recovers through Refresh without enabling stale answers', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-mcp-shelf-browser-'));
  const clients = new Set<ServerResponse>();
  let failure = true, reads = 0, mutations = 0, holdReads = false;
  const heldReads: ServerResponse[] = [];
  const state: NativeMcpState = { connected: true, capabilities: { inventory: true, reload: true, oauth: false, resources: true, tools: true, events: false, elicitation: true, verification: false }, requests: [], subscriptions: [], notices: [] };
  const changed = () => { for (const response of clients) response.write('event: changed\ndata: {}\n\n'); };
  const sendState = (res: ServerResponse) => { res.writeHead(failure ? 503 : 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(failure ? { error: 'MCP request lookup failed in this fixture.', code: 'FIXTURE_UNAVAILABLE' } : state)); };
  await build({ entryPoints: [path.resolve('tests/native-mcp-ui.fixture.tsx')], bundle: true, outfile: path.join(directory, 'fixture.js'), platform: 'browser', format: 'esm', jsx: 'automatic', logLevel: 'silent' });
  const server = createServer((req, res) => { void (async () => {
    const url = new URL(req.url || '/', 'http://fixture.invalid');
    if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>'); return; }
    if (url.pathname === '/fixture.js' || url.pathname === '/fixture.css') { res.setHeader('Content-Type', url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(await fs.readFile(path.join(directory, path.basename(url.pathname)))); return; }
    if (url.pathname.endsWith('/events')) { res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'Cache-Control': 'no-store' }); res.write('event: heartbeat\ndata: {}\n\n'); clients.add(res); res.once('close', () => clients.delete(res)); return; }
    if (url.pathname.endsWith('/state')) { reads++; if (holdReads) heldReads.push(res); else sendState(res); return; }
    if (req.method === 'POST') mutations++;
    res.writeHead(404); res.end();
  })().catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture address.');
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true, ...browserLaunchOptions() });
    const page = await browser.newPage({ viewport: { width: 800, height: 700 } });
    page.setDefaultTimeout(10_000);
    await page.goto(`http://127.0.0.1:${address.port}/?view=requests`);
    const shelf = page.getByRole('region', { name: 'MCP requests' });
    const refreshToSuccess = async () => {
      // Keep the visible failure until a natural click has dispatched (or
      // queued behind) a state read. Neither SSE startup nor polling can
      // recover the fixture early and detach the button under Playwright.
      holdReads = true;
      try {
        await shelf.getByRole('button', { name: 'Refresh', exact: true }).click();
        await vi.waitFor(() => expect(heldReads.length).toBeGreaterThan(0));
        failure = false;
      } finally {
        holdReads = false;
        for (const response of heldReads.splice(0)) sendState(response);
      }
    };
    await shelf.getByText('MCP request lookup failed in this fixture.', { exact: false }).waitFor();
    expect(await shelf.getByRole('button', { name: 'Refresh', exact: true }).isEnabled()).toBe(true);
    expect(await page.locator('.native-mcp-request-trigger').count()).toBe(0);
    await page.getByRole('button', { name: 'Toggle MCP', exact: true }).click();
    await shelf.waitFor({ state: 'hidden' });
    const resumeReads = reads;
    await page.getByRole('button', { name: 'Toggle MCP', exact: true }).click();
    await vi.waitFor(() => expect(reads).toBeGreaterThanOrEqual(resumeReads + 2));
    await shelf.getByText('MCP request lookup failed in this fixture.', { exact: false }).waitFor();
    const previousReads = reads;
    await refreshToSuccess();
    await shelf.waitFor({ state: 'hidden' }); expect(reads).toBeGreaterThan(previousReads);
    failure = true;
    const conversationReads = reads;
    await page.getByRole('button', { name: 'Change conversation', exact: true }).click();
    await vi.waitFor(() => expect(reads).toBeGreaterThanOrEqual(conversationReads + 2));
    await shelf.getByText('MCP request lookup failed in this fixture.', { exact: false }).waitFor();
    state.requests = [{ id: '66666666-6666-4666-8666-666666666666', threadId: '01990000-0000-7000-8000-000000000002', serverName: 'Fixture server', mode: 'form', title: 'Provide details', message: 'Review this request.', unavailableReason: null, expiresAt: '2099-01-01T00:00:00Z', form: { field: { key: '', label: 'Inputs', kind: 'object', required: true, fields: [] }, unavailableReason: null } }];
    await refreshToSuccess();
    await shelf.getByRole('button', { name: /Fixture server needs your input/ }).waitFor();
    failure = true; changed();
    await shelf.getByText('MCP request lookup failed in this fixture.', { exact: false }).waitFor();
    await shelf.getByRole('button', { name: /Fixture server needs your input/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Provide details' });
    expect(await dialog.getByRole('button', { name: 'Send answers', exact: true }).isDisabled()).toBe(true);
    expect(await dialog.getByRole('button', { name: 'Decline', exact: true }).isDisabled()).toBe(true);
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    state.requests = [];
    await refreshToSuccess();
    await shelf.waitFor({ state: 'hidden' }); expect(mutations).toBe(0);
  } finally {
    await browser?.close(); for (const client of clients) client.destroy(); server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await fs.rm(directory, { force: true, recursive: true });
  }
}, 60_000);
