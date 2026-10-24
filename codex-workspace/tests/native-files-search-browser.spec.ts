import { afterEach, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { chromium, type Browser } from '@playwright/test';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { browserLaunchOptions } from './browser-launch';

let server: Server | undefined, browser: Browser | undefined, temporary: string | undefined;
afterEach(async () => {
  // Close the owned HTTP listener before Chromium: polling/keep-alive requests
  // must not keep a test server alive after a browser disconnects mid-response.
  if (server) {
    const owned = server; server = undefined;
    const closing = new Promise<void>(resolve => owned.close(() => resolve()));
    owned.closeAllConnections(); await closing;
  }
  await browser?.close(); browser = undefined;
  if (temporary) await fs.rm(temporary, { recursive: true, force: true }); temporary = undefined;
});

describe('native files/search browser interactions', () => {
  it('coordinates dirty buffers, pages results, pauses hidden observation, and handles real reference/search actions', async () => {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-native-files-browser-'));
    const bootstrap = `
      import React, { StrictMode, useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { NativeFilesSearchPanel } from ${JSON.stringify(path.resolve('client/components/native/NativeFilesSearchPanel.tsx'))};
      import { registerWorkspaceRewindGuard } from ${JSON.stringify(path.resolve('client/workspace-rewind-guard.ts'))};
      import ${JSON.stringify(path.resolve('client/styles.css'))};
      const fixture = window.nativeFilesFixture = { dirty: true, held: 0, opened: [] };
      registerWorkspaceRewindGuard('workspace-a', {
        read: () => ({ dirtyPaths: fixture.dirty ? ['dirty.txt'] : [] }),
        acquire: () => ({ dirtyPaths: [], release() {} }),
        readExternal(paths) { if (fixture.dirty && paths.includes('dirty.txt')) throw Error('Save dirty.txt before changing it.'); },
        acquireExternal() { fixture.held++; return { release() { fixture.held--; } }; }
      });
      function Fixture() {
        const [active, setActive] = useState(true);
        fixture.setActive = setActive;
        return <div style={{ height: '100%', overflow: 'auto', display: active ? 'block' : 'none' }}>
          <NativeFilesSearchPanel workspaceId="workspace-a" threadId="thread-a" active={active}
            onOpenFile={selected => fixture.opened.push(selected)} />
        </div>;
      }
      createRoot(document.getElementById('root')).render(<StrictMode><Fixture /></StrictMode>);
    `;
    await build({ stdin: { contents: bootstrap, loader: 'tsx', resolveDir: process.cwd() }, bundle: true, outfile: path.join(temporary, 'fixture.js'),
      jsx: 'automatic', platform: 'browser', format: 'esm', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
    const content = '<script>window.shouldNeverRun = true</script>\nhello file';
    const version = createHash('sha256').update(content).digest('hex');
    const rows = Array.from({ length: 45 }, (_, index) => ({ name: `file-${String(index).padStart(2, '0')}.txt`, path: `file-${String(index).padStart(2, '0')}.txt`, kind: 'file' }));
    const calls: Array<{ method: string; url: string; body: any }> = [];
    let heldWrite: ServerResponse | undefined, sessionQuery = '', references: any[] = [];
    const send = (res: ServerResponse, body: unknown, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    const handle = async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url!, 'http://fixture.local');
      if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>'); return; }
      if (url.pathname === '/fixture.js' || url.pathname === '/fixture.css') { res.writeHead(200, { 'Content-Type': url.pathname.endsWith('.js') ? 'application/javascript' : 'text/css' }); res.end(await fs.readFile(path.join(temporary!, url.pathname.slice(1)))); return; }
      let raw = ''; for await (const part of req) raw += String(part);
      const body = raw ? JSON.parse(raw) : undefined; calls.push({ method: req.method!, url: url.pathname + url.search, body });
      if (url.pathname.endsWith('/files/directory') && req.method === 'GET') {
        const next = url.searchParams.get('cursor') === 'directory-next';
        send(res, { path: '', entries: rows.slice(next ? 40 : 0, next ? 45 : 40), total: 45, nextCursor: next ? null : 'directory-next' }); return;
      }
      if (url.pathname.endsWith('/files/metadata')) { send(res, { path: url.searchParams.get('path'), kind: 'file', bytes: Buffer.byteLength(content), createdAtMs: 0, modifiedAtMs: 1, version, canReadWholeFile: true }); return; }
      if (url.pathname.endsWith('/files/content') && req.method === 'GET') { send(res, { path: url.searchParams.get('path'), bytes: Buffer.byteLength(content), dataBase64: Buffer.from(content).toString('base64'), version }); return; }
      if (url.pathname.endsWith('/files/content') && req.method === 'PUT') { heldWrite = res; return; }
      if (url.pathname.endsWith('/files/watches') && req.method === 'POST') { send(res, { id: 'watch-a', path: '', revision: 0, paths: [], truncated: false }); return; }
      if (url.pathname.endsWith('/files/watches/watch-a')) { send(res, req.method === 'GET' ? { id: 'watch-a', path: '', revision: 0, paths: [], truncated: false } : { stopped: true }); return; }
      const searchPage = { query: sessionQuery, root: '', files: [rows[0]], total: 1, nextCursor: null, truncated: false };
      if (url.pathname.endsWith('/search/sessions') && req.method === 'POST') { send(res, { ...searchPage, id: 'search-a', revision: 0, status: 'searching' }); return; }
      if (url.pathname.endsWith('/search/sessions/search-a')) {
        if (req.method === 'PATCH') { sessionQuery = body.query; send(res, { accepted: true }); }
        else send(res, req.method === 'GET' ? { ...searchPage, query: sessionQuery, id: 'search-a', revision: 1, status: 'ready' } : { stopped: true });
        return;
      }
      if (url.pathname.endsWith('/threads/search')) { send(res, { matches: [{ threadId: 'thread-a', title: 'Matched conversation', snippet: 'hello message', updatedAt: '2026-09-30T00:00:00Z' }], nextCursor: null }); return; }
      if (url.pathname.endsWith('/occurrences')) { send(res, { occurrences: [{ turnId: 'turn-a', itemId: 'item-a', snippet: 'Found hello here', matchRange: { start: 6, end: 11 }, turnCursor: 'opaque-turn' }], nextCursor: null }); return; }
      if (url.pathname.endsWith('/references/revision')) { send(res, { revision: 0 }); return; }
      if (url.pathname.endsWith('/references')) {
        if (req.method === 'POST') { references = [{ id: 'reference-a', kind: body.kind, title: body.title, text: body.text, createdAt: 1, reference: 'scoped-reference-token' }]; send(res, { outcome: 'created', reference: references[0] }, 201); }
        else if (req.method === 'DELETE') { references = []; send(res, { removed: true }); }
        else send(res, { references, revision: 0, nextCursor: null });
        return;
      }
      send(res, { error: 'Unexpected fixture route.' }, 404);
    };
    server = createServer((req, res) => { void handle(req, res).catch(error => send(res, { error: String(error) }, 500)); });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    browser = await chromium.launch(browserLaunchOptions());
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    const failures: string[] = []; page.on('pageerror', error => failures.push(error.message));
    await page.goto(origin);
    await page.getByRole('button', { name: 'Inspect file file-00.txt', exact: true }).waitFor();
    expect(await page.getByRole('button', { name: /^Inspect file / }).count()).toBe(40);
    await page.getByRole('button', { name: 'Next files', exact: true }).click();
    await page.getByRole('button', { name: 'Inspect file file-40.txt', exact: true }).waitFor();
    expect(await page.getByRole('button', { name: /^Inspect file / }).count()).toBe(5);
    await page.getByRole('button', { name: 'Previous files', exact: true }).click();
    await page.getByRole('button', { name: 'Inspect file file-00.txt', exact: true }).click();
    await page.getByLabel('Read-only preview of file-00.txt').waitFor();
    expect(await page.evaluate(() => (window as any).shouldNeverRun)).toBeUndefined();
    await page.getByRole('button', { name: 'Open in editor', exact: true }).click();
    expect(await page.evaluate(() => (window as any).nativeFilesFixture.opened)).toEqual(['file-00.txt']);
    await page.getByRole('button', { name: 'New file', exact: true }).click();
    await page.getByLabel('Workspace path', { exact: true }).fill('dirty.txt');
    await page.getByLabel('File contents', { exact: true }).fill('new contents');
    await page.getByRole('button', { name: 'Create file', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Save dirty.txt' }).waitFor();
    expect(calls.some(call => call.method === 'PUT')).toBe(false);
    await page.getByLabel('Workspace path', { exact: true }).fill('created.txt');
    await page.getByRole('button', { name: 'Create file', exact: true }).click();
    await expect.poll(() => !!heldWrite).toBe(true);
    expect(await page.evaluate(() => (window as any).nativeFilesFixture.held)).toBe(1);
    expect(await page.getByLabel('File contents', { exact: true }).isDisabled()).toBe(true);
    send(heldWrite!, { path: 'created.txt', bytes: 12, version }); heldWrite = undefined;
    await page.getByRole('status').filter({ hasText: 'File created: created.txt' }).waitFor();
    expect(await page.evaluate(() => (window as any).nativeFilesFixture.held)).toBe(0);
    expect(calls.find(call => call.method === 'PUT')?.body).toMatchObject({ expectedVersion: null, dataBase64: Buffer.from('new contents').toString('base64') });
    await page.getByRole('button', { name: 'Watch folder', exact: true }).click();
    await page.getByRole('button', { name: 'Stop watching', exact: true }).waitFor();
    await page.getByLabel('Find file or folder names').fill('file');
    await page.getByRole('button', { name: 'Start live search', exact: true }).click();
    await page.getByRole('button', { name: 'Stop live search', exact: true }).waitFor();
    await page.getByRole('button', { name: 'New file', exact: true }).click();
    await page.getByLabel('Workspace path', { exact: true }).fill('draft.txt');
    await page.getByLabel('File contents', { exact: true }).fill('preserved hidden draft');
    await page.evaluate(() => (window as any).nativeFilesFixture.setActive(false));
    await page.waitForTimeout(100);
    const polls = () => calls.filter(call => call.method === 'GET' && /(?:watches\/watch-a|sessions\/search-a)/.test(call.url)).length;
    const before = polls();
    await page.waitForTimeout(2200);
    expect(polls()).toBe(before); expect(calls.some(call => call.method === 'DELETE')).toBe(false);
    await page.evaluate(() => (window as any).nativeFilesFixture.setActive(true));
    expect(await page.getByLabel('File contents', { exact: true }).inputValue()).toBe('preserved hidden draft');
    await expect.poll(polls).toBeGreaterThan(before);
    await page.getByRole('button', { name: 'Messages', exact: true }).click();
    await page.getByLabel('Find conversation messages').fill('hello');
    await page.getByRole('button', { name: 'Search messages', exact: true }).click();
    await page.getByRole('button', { name: 'Show message matches', exact: true }).click();
    await page.locator('mark').filter({ hasText: 'hello' }).waitFor();
    await page.getByRole('button', { name: 'References', exact: true }).click();
    await page.getByText('No saved references on this page.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Add reference', exact: true }).click();
    await page.getByLabel('Title', { exact: true }).fill('Saved browser note');
    await page.getByLabel('Note', { exact: true }).fill('Reference text stays out of turn input.');
    await page.getByRole('button', { name: 'Save reference', exact: true }).click();
    await page.getByRole('heading', { name: 'Saved browser note', exact: true }).waitFor();
    expect(calls.some(call => /\/run|\/queue|\/input/.test(call.url))).toBe(false);
    await page.getByRole('button', { name: 'Remove reference', exact: true }).click();
    const confirmation = page.getByRole('group', { name: 'Confirm reference removal' }); await confirmation.waitFor();
    expect(calls.some(call => call.method === 'DELETE' && call.url.endsWith('/references'))).toBe(false);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await confirmation.getByRole('button', { name: 'Remove reference', exact: true }).click();
    await page.getByText('No saved references on this page.', { exact: true }).waitFor();
    expect(calls.find(call => call.method === 'DELETE' && call.url.endsWith('/references'))?.body).toEqual({ reference: 'scoped-reference-token' });
    expect(failures).toEqual([]);
  }, 45_000);
});
