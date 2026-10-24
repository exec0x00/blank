import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';
import express from 'express';
import { JsonStore } from '../server/store';
import { createApplication } from '../server/index';
import { loadConfig } from '../server/config';
import { measureApiTime } from '../server/performance';

let directory: string;
let store: JsonStore;
const applications: Awaited<ReturnType<typeof createApplication>>[] = [];
const servers: Server[] = [];

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-api-performance-'));
  store = new JsonStore(path.join(directory, 'state'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(applications.splice(0).map(application => application.close()));
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close(error => error ? reject(error) : resolve());
  })));
  await store.flush().catch(() => undefined);
  await fs.rm(directory, { recursive: true, force: true });
});

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function contentReads(spy: { mock: { calls: unknown[][] } }, file: string): number {
  return spy.mock.calls.filter(call => String(call[0]) === file).length;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function application() {
  const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: directory, WORKSPACE_PASSWORD: 'performance-test-password',
    SESSION_SECRET: 'performance-test-session-secret-at-least-32', ENCRYPTION_KEY: 'performance-test-encryption-key-at-least-32' });
  const runtime = await createApplication(config);
  applications.push(runtime);
  const base = await listen(runtime.server);
  const response = await fetch(`${base}/api/session`, { method: 'POST',
    headers: { 'X-Codex-Workspace': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: config.password }) });
  expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie')!.split(';')[0];
  const request = (route: string) => fetch(`${base}/api${route}`, { headers: { Cookie: cookie } });
  return { ...runtime, base, request };
}

describe('state reads on interactive API paths', () => {
  it('reuses unchanged contents, coalesces overlapping reads, and returns isolated values', async () => {
    const file = path.join(store.directory, 'workspaces.json');
    await store.write('workspaces', [{ id: 'project', preferences: { tab: 'first' } }]);
    await new Promise(resolve => setTimeout(resolve, 2_050));
    const reads = vi.spyOn(fs, 'readFile');
    const results = await Promise.all(Array.from({ length: 20 }, () => store.read('workspaces', [] as { id: string; preferences: { tab: string } }[])));
    expect(contentReads(reads, file)).toBe(1);
    results[0][0].preferences.tab = 'changed in one consumer';
    expect(results[1][0].preferences.tab).toBe('first');
    for (let i = 0; i < 10; i++) expect(await store.read('workspaces', null)).toEqual([{ id: 'project', preferences: { tab: 'first' } }]);
    expect(contentReads(reads, file)).toBe(1);
  });

  it('observes an external same-size edit even when its mtime is restored', async () => {
    const file = path.join(store.directory, 'settings.json');
    await store.write('settings', { theme: 'dark' });
    const fixedSeconds = 1_700_000_000;
    await fs.utimes(file, fixedSeconds, fixedSeconds);
    expect(await store.read('settings', null)).toEqual({ theme: 'dark' });
    const before = await fs.stat(file, { bigint: true });
    await fs.writeFile(file, JSON.stringify({ theme: 'blue' }, null, 2) + '\n');
    await fs.utimes(file, fixedSeconds, fixedSeconds);
    const after = await fs.stat(file, { bigint: true });
    expect(after.size).toBe(before.size);
    expect(after.mtimeNs).toBe(before.mtimeNs);
    // A real filesystem may retain the same ctime for both writes in one tick.
    // Correctness must not depend on an artificially delayed external writer.
    expect(await store.read('settings', null)).toEqual({ theme: 'blue' });
    await store.update('settings', { theme: 'fallback' }, current => ({ ...current, fontSize: 16 }));
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ theme: 'blue', fontSize: 16 });
  });

  it('never promotes bytes read in an ambiguous timestamp tick into a later cache hit', async () => {
    const file = path.join(store.directory, 'settings.json');
    await store.write('settings', { theme: 'dark' });
    const original = await fs.stat(file, { bigint: true });
    const stat = fs.stat.bind(fs);
    // Deterministically reproduce the identical ctime observed on this host
    // during rapid same-size writes. The underlying file still changes for real.
    vi.spyOn(fs, 'stat').mockImplementation((async (...args: Parameters<typeof fs.stat>) =>
      String(args[0]) === file ? original : stat(...args)) as typeof fs.stat);
    expect(await store.read('settings', null)).toEqual({ theme: 'dark' });
    await fs.writeFile(file, JSON.stringify({ theme: 'blue' }, null, 2) + '\n');
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 3_000);
    expect(await store.read('settings', null)).toEqual({ theme: 'blue' });
  });

  it('sees another store replacing a file, external deletion, and recreation immediately', async () => {
    const second = new JsonStore(store.directory);
    await store.write('settings', { selected: 1 });
    expect(await store.read('settings', null)).toEqual({ selected: 1 });
    await second.write('settings', { selected: 2 });
    expect(await store.read('settings', null)).toEqual({ selected: 2 });
    await fs.unlink(path.join(store.directory, 'settings.json'));
    expect(await store.read('settings', { selected: 3 })).toEqual({ selected: 3 });
    await second.write('settings', { selected: 4 });
    expect(await store.read('settings', null)).toEqual({ selected: 4 });
  });

  it('fails closed on externally corrupted warm state, then recovers after repair', async () => {
    const file = path.join(store.directory, 'settings.json');
    await store.write('settings', { theme: 'dark' });
    await store.read('settings', null);
    await fs.writeFile(file, '{"theme":');
    await expect(store.read('settings', { theme: 'default' })).rejects.toThrow();
    await expect(store.update('settings', { theme: '' }, () => ({ theme: 'overwrite' }))).rejects.toThrow();
    expect(await fs.readFile(file, 'utf8')).toBe('{"theme":');
    await fs.writeFile(file, '{"theme":"repaired"}');
    expect(await store.read('settings', null)).toEqual({ theme: 'repaired' });
  });

  it('never returns a cached value ahead of an already queued write', async () => {
    await store.write('settings', { version: 'old' });
    await store.read('settings', null);
    const started = gate();
    const finish = gate();
    const updating = store.update('settings', { version: '' }, async () => {
      started.resolve();
      await finish.promise;
      return { version: 'durable' };
    });
    await started.promise;
    let returned = false;
    const read = store.read('settings', null).then(value => { returned = true; return value; });
    await new Promise(resolve => setImmediate(resolve));
    expect(returned).toBe(false);
    finish.resolve();
    await updating;
    expect(await read).toEqual({ version: 'durable' });
    expect(await new JsonStore(store.directory).read('settings', null)).toEqual({ version: 'durable' });
  });

  it('keeps an external edit made during an async update and lets the next update recover', async () => {
    const file = path.join(store.directory, 'settings.json');
    await store.write('settings', { theme: 'dark' });
    const started = gate();
    const finish = gate();
    const updating = store.update('settings', { theme: '' }, async current => {
      started.resolve();
      await finish.promise;
      return { ...current, fontSize: 14 };
    });
    await started.promise;
    await fs.writeFile(file, JSON.stringify({ theme: 'external', fontSize: 19 }));
    const rejected = expect(updating).rejects.toMatchObject({ status: 409, code: 'STATE_CONFLICT' });
    finish.resolve();
    await rejected;
    expect(await store.read('settings', null)).toEqual({ theme: 'external', fontSize: 19 });
    await store.update('settings', {}, current => ({ ...current, wordWrap: true }));
    expect(await new JsonStore(store.directory).read('settings', null)).toEqual({ theme: 'external', fontSize: 19, wordWrap: true });
    expect(await fs.readdir(store.directory)).toEqual(['settings.json']);
  });

  it('compares current bytes before committing even if external-edit metadata aliases', async () => {
    const file = path.join(store.directory, 'settings.json');
    await store.write('settings', { theme: 'dark' });
    const original = await fs.stat(file, { bigint: true });
    const stat = fs.stat.bind(fs);
    vi.spyOn(fs, 'stat').mockImplementation((async (...args: Parameters<typeof fs.stat>) =>
      String(args[0]) === file ? original : stat(...args)) as typeof fs.stat);
    const started = gate();
    const finish = gate();
    const updating = store.update('settings', { theme: '' }, async current => {
      started.resolve();
      await finish.promise;
      return { ...current, fontSize: 14 };
    });
    await started.promise;
    await fs.writeFile(file, JSON.stringify({ theme: 'blue' }, null, 2) + '\n');
    const rejected = expect(updating).rejects.toMatchObject({ status: 409, code: 'STATE_CONFLICT' });
    finish.resolve();
    await rejected;
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ theme: 'blue' });
  });

  it('does not reuse an older load after a completed write', async () => {
    const file = path.join(store.directory, 'settings.json');
    await store.write('settings', { revision: 1 });
    const started = gate();
    const finish = gate();
    const readFile = fs.readFile.bind(fs);
    let paused = false;
    vi.spyOn(fs, 'readFile').mockImplementation((async (...args: Parameters<typeof fs.readFile>) => {
      const value = await readFile(...args);
      if (String(args[0]) === file && !paused) {
        paused = true;
        started.resolve();
        await finish.promise;
      }
      return value;
    }) as typeof fs.readFile);
    const earlier = store.read('settings', null);
    await started.promise;
    await store.write('settings', { revision: 2 });
    expect(await store.read('settings', null)).toEqual({ revision: 2 });
    finish.resolve();
    await earlier;
    expect(await store.read('settings', null)).toEqual({ revision: 2 });
  });

  it('limits retained records and avoids retaining large conversation or metadata files', async () => {
    const reads = vi.spyOn(fs, 'readFile');
    const large = { text: 'a'.repeat(1024 * 1024) };
    await store.write('large-thread', large);
    for (let index = 0; index <= 256; index++) await store.write(`record-${index}`, { index });
    await new Promise(resolve => setTimeout(resolve, 2_050));
    for (let index = 0; index <= 256; index++) await store.read(`record-${index}`, null);
    const first = path.join(store.directory, 'record-0.json');
    expect(contentReads(reads, first)).toBe(1);
    expect(await store.read('record-0', null)).toEqual({ index: 0 });
    expect(contentReads(reads, first)).toBe(2);
    expect(await store.read('large-thread', null)).toEqual(large);
    expect(await store.read('large-thread', null)).toEqual(large);
    expect(contentReads(reads, path.join(store.directory, 'large-thread.json'))).toBe(2);
  });
});

describe('real authenticated API hot paths', () => {
  it('serves warm bootstrap without rereading contents, while still observing external preferences', async () => {
    const app = await application();
    await app.ctx.store.write('settings', { fontSize: 14 });
    await app.ctx.store.write('github-accounts', []);
    await new Promise(resolve => setTimeout(resolve, 2_050));
    expect((await app.request('/bootstrap')).status).toBe(200);
    const reads = vi.spyOn(fs, 'readFile');
    for (let i = 0; i < 8; i++) {
      const response = await app.request('/bootstrap');
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('server-timing')).toMatch(/^app;dur=\d+\.\d{3}$/);
      expect((await response.json()).settings.fontSize).toBe(14);
    }
    const stateReads = reads.mock.calls.filter(call => String(call[0]).startsWith(app.ctx.config.stateDir));
    expect(stateReads).toHaveLength(0);
    await fs.writeFile(path.join(app.ctx.config.stateDir, 'settings.json'), JSON.stringify({ fontSize: 19 }));
    expect((await (await app.request('/bootstrap')).json()).settings.fontSize).toBe(19);
    expect((await fetch(`${app.base}/api/bootstrap`)).status).toBe(401);
  });

  it('lists a folder with bounded concurrent metadata and keeps safe link behavior', async () => {
    const app = await application();
    const workspace = await app.ctx.workspaces.create({ name: 'Directory latency test' });
    await Promise.all(Array.from({ length: 48 }, (_, index) => fs.writeFile(path.join(workspace.path, `file-${index}.txt`), `value ${index}`)));
    await fs.mkdir(path.join(workspace.path, 'nested'));
    await fs.symlink('nested', path.join(workspace.path, 'internal-link'));
    await fs.symlink(directory, path.join(workspace.path, 'outside-link'));
    const lstat = fs.lstat.bind(fs);
    let active = 0;
    let maximum = 0;
    vi.spyOn(fs, 'lstat').mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
      if (path.dirname(String(args[0])) !== workspace.path) return lstat(...args);
      active++;
      maximum = Math.max(maximum, active);
      try {
        // A small delay represents a metadata round trip, without replacing the
        // real filesystem result or making the test depend on machine speed.
        await new Promise(resolve => setTimeout(resolve, 3));
        return await lstat(...args);
      } finally { active--; }
    }) as typeof fs.lstat);
    const response = await app.request(`/workspaces/${workspace.id}/tree`);
    expect(response.status).toBe(200);
    const entries = await response.json();
    expect(entries).toHaveLength(51);
    expect(entries.find((entry: { name: string }) => entry.name === 'internal-link')).toMatchObject({ kind: 'directory', isSymlink: true });
    expect(entries.find((entry: { name: string }) => entry.name === 'outside-link')).toMatchObject({ isSymlink: true });
    expect(entries.filter((entry: { name: string }) => entry.name.startsWith('file-')).slice(0, 12).map((entry: { name: string }) => entry.name))
      .toEqual(Array.from({ length: 12 }, (_, index) => `file-${index}.txt`));
    expect(maximum).toBeGreaterThan(1);
    expect(maximum).toBeLessThanOrEqual(16);
    expect((await app.request(`/workspaces/${workspace.id}/tree?path=outside-link`)).status).toBe(403);
    expect((await app.request(`/workspaces/${workspace.id}/file?path=file-0.txt`)).status).toBe(200);
  });
});

describe('API timing without buffering', () => {
  it('keeps numeric processing timing on ordinary, explicit-header, error, and streaming responses', async () => {
    const app = express();
    app.use(measureApiTime);
    app.get('/json', (_req, res) => { res.setHeader('Server-Timing', 'fixture;dur=1'); res.json({ okay: true }); });
    app.get('/explicit', (_req, res) => { res.writeHead(201, 'Created', { 'Content-Type': 'text/plain', 'Server-Timing': 'fixture;dur=1' }); res.end('created'); });
    app.get('/raw', (_req, res) => { res.writeHead(200, ['Content-Type', 'text/plain', 'Server-Timing', 'fixture;dur=1']); res.end('okay'); });
    app.get('/error', (_req, res) => { res.status(409).json({ error: 'Conflict' }); });
    const finish = gate();
    app.get('/events', (_req, res) => {
      res.type('text/event-stream');
      res.flushHeaders();
      res.write('data: first\n\n');
      void finish.promise.then(() => res.end('data: done\n\n'));
    });
    const server = createServer(app);
    servers.push(server);
    const base = await listen(server);
    for (const route of ['/json', '/explicit', '/raw', '/error']) {
      const response = await fetch(`${base}${route}`);
      expect(response.headers.get('server-timing')).toMatch(/app;dur=\d+\.\d{3}(?:$|,)/);
      if (route !== '/error') expect(response.headers.get('server-timing')).toContain('fixture;dur=1');
      await response.text();
    }
    const response = await fetch(`${base}/events`);
    expect(response.headers.get('server-timing')).toMatch(/^app;dur=\d+\.\d{3}$/);
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe('data: first\n\n');
    finish.resolve();
    const last = await reader.read();
    expect(new TextDecoder().decode(last.value)).toBe('data: done\n\n');
    expect((await reader.read()).done).toBe(true);
  });
});
