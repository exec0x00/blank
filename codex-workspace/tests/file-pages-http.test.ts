import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import { AuthService } from '../server/auth';
import { HttpError } from '../server/errors';
import { createFilePagesRouter, initializeFilePages, shutdownFilePages } from '../server/file-pages';
import { fileSaveRecords } from '../server/file-pages/recovery';
import { createWorkspaceRouter } from '../server/workspaces';
import { PAGE_BYTES } from '../server/file-pages/limits';
import { filePagesFixture, repeatedFile, digestFile, deferred, type FilePagesFixture } from './file-pages-fixture';

describe('authenticated paged-file HTTP contract', () => {
  let fixture: FilePagesFixture;
  let server: Server;
  let auth: AuthService;
  let origin: string;
  let cookie: string;
  beforeEach(async () => {
    fixture = await filePagesFixture();
    auth = new AuthService(fixture.ctx); await auth.initialize();
    await initializeFilePages(fixture.ctx);
    const app = express();
    app.use('/api', auth.protectMutations);
    app.use('/api/session', express.json({ limit: '4kb' }));
    app.use('/api', auth.router(), auth.requireSession, express.json({ limit: '8mb' }));
    app.use('/api', createFilePagesRouter(fixture.ctx), createWorkspaceRouter(fixture.ctx));
    const handleError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
      if (error instanceof HttpError) { res.status(error.status).json({ error: error.message, code: error.code }); return; }
      res.status(500).json({ error: 'Unexpected test failure.' });
    };
    app.use(handleError);
    server = createServer(app);
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('The fixture did not listen.');
    origin = `http://127.0.0.1:${address.port}`;
    const login = await fetch(`${origin}/api/session`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Codex-Workspace': '1' }, body: JSON.stringify({ password: fixture.config.password }) });
    expect(login.status).toBe(200);
    cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    await login.arrayBuffer();
  });

  afterEach(async () => {
    const pagesClosed = shutdownFilePages(fixture.ctx);
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); });
    await pagesClosed;
    vi.restoreAllMocks();
    await auth.close(); await fixture.close();
  });

  function endpoint(route: string): string { return `${origin}/api/workspaces/${fixture.workspace.id}/${route}`; }
  function headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Cookie: cookie, Origin: origin, 'X-Codex-Workspace': '1', 'Content-Type': 'application/json', ...extra };
  }

  it('gates every read/search/save/recovery route and rejects cross-origin saves', async () => {
    await fs.writeFile(path.join(fixture.workspace.path, 'file.txt'), 'original');
    for (const route of ['file-info?path=file.txt', 'file-page?path=file.txt', 'file-recoveries']) {
      const response = await fetch(endpoint(route));
      expect(response.status).toBe(401); await response.arrayBuffer();
    }
    for (const [route, method] of [['file-search', 'POST'], ['file-range', 'PUT']]) {
      const response = await fetch(endpoint(route!), { method, headers: { ...headers(), Cookie: '' }, body: '{}' });
      expect(response.status).toBe(401); await response.arrayBuffer();
    }
    const pageResponse = await fetch(endpoint('file-page?path=file.txt'), { headers: headers() });
    const page = await pageResponse.json() as { pageToken: string };
    const forbidden = await fetch(endpoint('file-range'), { method: 'PUT', headers: headers({ Origin: 'https://another.example' }),
      body: JSON.stringify({ path: 'file.txt', pageToken: page.pageToken, content: 'cross-origin write' }) });
    expect(forbidden.status).toBe(403); await forbidden.arrayBuffer();
    expect(await fs.readFile(path.join(fixture.workspace.path, 'file.txt'), 'utf8')).toBe('original');
  });

  it('keeps legacy whole-file reads bounded and serves small real pages with precise range saves', async () => {
    const absolute = path.join(fixture.workspace.path, 'big.txt');
    await repeatedFile(absolute, 6 * 1024 * 1024);
    const legacy = await fetch(endpoint('file?path=big.txt'), { headers: headers() });
    expect(legacy.status).toBe(413); await legacy.arrayBuffer();
    const metadata = await fetch(endpoint('file-info?path=big.txt'), { headers: headers() });
    const info = await metadata.json() as { version: string; size: number; content?: string };
    expect(info.size).toBe(6 * 1024 * 1024); expect(info.content).toBeUndefined();
    const response = await fetch(endpoint(`file-page?path=big.txt&version=${info.version}`), { headers: headers() });
    const page = await response.json() as { pageToken: string; content: string; byteStart: number; byteEnd: number; version: string };
    expect(response.status).toBe(200); expect(Buffer.byteLength(page.content)).toBeLessThanOrEqual(PAGE_BYTES);
    const replacement = 'HTTP range edit 🧪\r\n';
    const expected = await digestFile(absolute, { start: page.byteStart, end: page.byteEnd, replacement });
    const saved = await fetch(endpoint('file-range'), { method: 'PUT', headers: headers(),
      body: JSON.stringify({ path: 'big.txt', pageToken: page.pageToken, content: replacement }) });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ content: replacement, byteStart: page.byteStart, byteEnd: page.byteStart + Buffer.byteLength(replacement) });
    expect(await digestFile(absolute)).toBe(expected);
    const stale = await fetch(endpoint('file-range'), { method: 'PUT', headers: headers(),
      body: JSON.stringify({ path: 'big.txt', pageToken: page.pageToken, content: 'stale' }) });
    expect(stale.status).toBe(409); expect(await stale.json()).toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('rejects malformed bounds and traversal before reading a source', async () => {
    for (const route of ['file-info?path=../outside', 'file-info?path=a&path=b', 'file-page?path=x&offset=NaN',
      'file-page?path=x&offset=9007199254740992', 'file-page?path=x&version=wrong']) {
      const response = await fetch(endpoint(route), { headers: headers() });
      expect(response.status).toBe(400); await response.arrayBuffer();
    }
    const response = await fetch(endpoint('file-search'), { method: 'POST', headers: headers(), body: '[]' });
    expect(response.status).toBe(400); await response.arrayBuffer();
  });

  it('tracks an admitted save after its HTTP client disconnects and drains before shutdown resolves', async () => {
    const absolute = path.join(fixture.workspace.path, 'disconnect.txt');
    await fs.writeFile(absolute, 'original');
    const response = await fetch(endpoint('file-page?path=disconnect.txt'), { headers: headers() });
    const page = await response.json() as { pageToken: string };
    const entered = deferred(); const release = deferred();
    const open = fs.open.bind(fs);
    let held = false;
    vi.spyOn(fs, 'open').mockImplementation(async (filename, flags, mode) => {
      const handle = await open(filename, flags, mode);
      if (String(filename).includes('/.codex-recovery-')) {
        const write = handle.write;
        handle.write = (async (...args: unknown[]) => {
          const result = await Reflect.apply(write, handle, args);
          if (!held) { held = true; entered.resolve(); await release.promise; }
          return result;
        }) as FileHandle['write'];
      }
      return handle;
    });
    const controller = new AbortController();
    const request = fetch(endpoint('file-range'), { method: 'PUT', headers: headers(), signal: controller.signal,
      body: JSON.stringify({ path: 'disconnect.txt', pageToken: page.pageToken, content: 'disconnected edit' }) });
    const disconnected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await entered.promise;
    let closed: Promise<void> | undefined;
    try {
      controller.abort(); await disconnected;
      server.closeAllConnections();
      let drained = false;
      closed = shutdownFilePages(fixture.ctx).then(() => { drained = true; });
      await new Promise<void>(resolve => { setImmediate(resolve); });
      expect(drained).toBe(false);
      expect(await fs.readFile(absolute, 'utf8')).toBe('original');
    } finally { release.resolve(); await closed; }
    expect(await fs.readFile(absolute, 'utf8')).toBe('original');
    const [record] = await fileSaveRecords(fixture.ctx);
    expect(record).toMatchObject({ phase: 'interrupted', completeCopy: false });
    expect(await fs.readFile(path.join(fixture.workspace.path, record!.recoveryPath), 'utf8')).toBe('disconnected edit');
    expect((await fs.readdir(fixture.workspace.path)).some(name => name.startsWith('.codex-write-'))).toBe(false);
  });
});
