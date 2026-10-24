import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import { constants, type Dir } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import express from 'express';
import type { AppContext } from '../server/context';
import { HttpError } from '../server/errors';
import { createWorkspaceRouter, type TrashEntry } from '../server/workspaces';
import { FILE_TRASH_CURSOR_IDLE_MS, FILE_TRASH_PAGE_BYTES, FILE_TRASH_SCAN_LIMIT, type FileTrashPage } from '../server/file-trash-pages';
import { TRASH_RETENTION_MS } from '../server/workspace-trash/records';
import { fixture, type TrashFixture } from './workspace-trash-fixture';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function idAt(index: number) { return `${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`; }

describe('bounded per-file trash pages and exact restoration', () => {
  let f: TrashFixture;
  const servers: Server[] = [];
  beforeEach(async () => { f = await fixture(); });
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const server of servers.splice(0)) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
    await f?.close();
  });

  async function saved(index: number, relative = `deleted-${index}.txt`, id: string = randomUUID()): Promise<TrashEntry> {
    const directory = path.join(f.config.workspacesDir, '.trash', f.workspace.id, id);
    await fs.mkdir(directory, { recursive: true });
    const deletedAt = new Date(Date.now() - index * 1000).toISOString();
    const entry: TrashEntry = { id, path: relative, kind: 'file', deletedAt, expiresAt: new Date(Date.parse(deletedAt) + TRASH_RETENTION_MS).toISOString() };
    await fs.writeFile(path.join(directory, 'metadata.json'), JSON.stringify(entry));
    await fs.writeFile(path.join(directory, 'content'), `Retained native bytes ${index}.`);
    return entry;
  }

  async function seed(count: number, makePath?: (index: number) => string): Promise<TrashEntry[]> {
    const entries: TrashEntry[] = [];
    for (let offset = 0; offset < count; offset += 16) entries.push(...await Promise.all(Array.from({ length: Math.min(16, count - offset) }, (_, index) => saved(offset + index, makePath?.(offset + index)))));
    return entries;
  }

  async function http() {
    const events = new EventEmitter();
    const app = express();
    app.use(express.json());
    app.use('/api', createWorkspaceRouter({ workspaces: f.service, events } as AppContext));
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(error instanceof HttpError ? error.status : 500).json({ error: error instanceof Error ? error.message : 'Failed', code: error instanceof HttpError ? error.code : undefined });
    });
    const server = createServer(app); servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    return { base: `http://127.0.0.1:${address.port}/api/workspaces/${f.workspace.id}`, events };
  }

  it('paginates every real entry without an eager directory array or off-page metadata reads', async () => {
    const entries = await seed(73);
    const open = fs.open.bind(fs);
    let reads = 0;
    vi.spyOn(fs, 'open').mockImplementation(async (input, flags, mode) => { if (String(input).endsWith('/metadata.json')) reads++; return open(input, flags, mode); });
    vi.spyOn(fs, 'readdir').mockRejectedValue(new Error('Paging must not materialize the native directory.'));
    const first = await f.service.listFileTrashPage(f.workspace.id);
    expect(first).toMatchObject({ previousCursor: null, hasMore: true, order: 'filesystem', unavailable: 0 });
    expect(first.items).toHaveLength(25);
    expect(reads).toBe(25);
    expect(first.scanned).toBeLessThanOrEqual(FILE_TRASH_SCAN_LIMIT);
    const seen = [...first.items.map(entry => entry.id)];
    let next = first.nextCursor;
    let second: FileTrashPage | undefined;
    while (next) {
      const before = reads;
      const page = await f.service.listFileTrashPage(f.workspace.id, { cursor: next });
      second ??= page;
      expect(reads - before).toBeLessThanOrEqual(FILE_TRASH_SCAN_LIMIT);
      expect(page.items.length).toBeLessThanOrEqual(25);
      expect(page.hasMore).toBe(Boolean(page.nextCursor));
      seen.push(...page.items.map(entry => entry.id)); next = page.nextCursor;
    }
    expect(new Set(seen).size).toBe(entries.length);
    expect([...seen].sort()).toEqual(entries.map(entry => entry.id).sort());
    const replay = await f.service.listFileTrashPage(f.workspace.id, { cursor: second!.previousCursor! });
    expect(replay.items).toEqual(first.items);
    expect(JSON.stringify(replay)).not.toContain(f.directory);
  });

  it('returns truthful sparse pages while searching and never scans all metadata in one request', async () => {
    await seed(213);
    const open = fs.open.bind(fs);
    let reads = 0;
    vi.spyOn(fs, 'open').mockImplementation(async (input, flags, mode) => { if (String(input).endsWith('/metadata.json')) reads++; return open(input, flags, mode); });
    let cursor: string | undefined;
    let pages = 0, scanned = 0;
    do {
      const before = reads;
      const page = await f.service.listFileTrashPage(f.workspace.id, { q: 'absent-pattern', cursor });
      expect(page.items).toEqual([]);
      expect(page.unavailable).toBe(0);
      expect(reads - before).toBeLessThanOrEqual(FILE_TRASH_SCAN_LIMIT);
      expect(page.scanned).toBeLessThanOrEqual(FILE_TRASH_SCAN_LIMIT);
      scanned += page.scanned; pages++; cursor = page.nextCursor ?? undefined;
      if (pages === 1) expect(page.hasMore).toBe(true);
    } while (cursor);
    expect(pages).toBeGreaterThan(1);
    expect(scanned).toBe(213);
  });

  it('counts unreadable entries without following links or suppressing healthy files', async () => {
    const valid = await saved(1);
    const root = path.join(f.config.workspacesDir, '.trash', f.workspace.id);
    const malformed = randomUUID();
    await fs.mkdir(path.join(root, malformed));
    await fs.writeFile(path.join(root, malformed, 'metadata.json'), 'not-json');
    const outside = path.join(f.directory, 'outside-entry');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'sentinel'), 'outside is unchanged');
    await fs.symlink(outside, path.join(root, randomUUID()));
    const linkedMetadata = randomUUID();
    await fs.mkdir(path.join(root, linkedMetadata));
    await fs.symlink(path.join(outside, 'sentinel'), path.join(root, linkedMetadata, 'metadata.json'));
    const invalidKind = await saved(2);
    await fs.writeFile(path.join(root, invalidKind.id, 'metadata.json'), JSON.stringify({ ...invalidKind, kind: ['file'] }));
    const page = await f.service.listFileTrashPage(f.workspace.id);
    expect(page.items).toEqual([valid]);
    expect(page.unavailable).toBe(4);
    expect(page.hasMore).toBe(false);
    expect(await fs.readFile(path.join(outside, 'sentinel'), 'utf8')).toBe('outside is unchanged');
    await expect(f.service.getTrashEntry(f.workspace.id, linkedMetadata)).rejects.toMatchObject({ code: 'WORKSPACE_TRASH_UNSAFE' });
    await expect(f.service.getTrashEntry(f.workspace.id, invalidKind.id)).rejects.toMatchObject({ code: 'FILE_TRASH_INVALID' });
  });

  it('binds opaque cursors to workspace, normalized search and page size', async () => {
    await seed(40);
    const first = await f.service.listFileTrashPage(f.workspace.id, { q: 'deleted', limit: 10 });
    const peer = await f.service.create({ name: 'Other cursor owner' });
    await expect(f.service.listFileTrashPage(peer.id, { q: 'deleted', limit: 10, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'INVALID_FILE_TRASH_CURSOR' });
    await expect(f.service.listFileTrashPage(f.workspace.id, { q: 'different', limit: 10, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'INVALID_FILE_TRASH_CURSOR' });
    await expect(f.service.listFileTrashPage(f.workspace.id, { q: 'deleted', limit: 20, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'INVALID_FILE_TRASH_CURSOR' });
    await expect(f.service.listFileTrashPage(f.workspace.id, { q: 'deleted', limit: 10, cursor: `${first.nextCursor!.slice(0, -1)}!` })).rejects.toMatchObject({ code: 'INVALID_FILE_TRASH_CURSOR' });
    expect((await f.service.listFileTrashPage(f.workspace.id, { q: ' DELETED ', limit: 10, cursor: first.nextCursor! })).items).toHaveLength(10);
  });

  it('invalidates continuation after restore and expires old/restarted cursor streams visibly', async () => {
    await seed(40);
    let first = await f.service.listFileTrashPage(f.workspace.id);
    await f.service.restoreEntry(f.workspace.id, first.items[0].id);
    await expect(f.service.listFileTrashPage(f.workspace.id, { cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'FILE_TRASH_CURSOR_STALE' });
    first = await f.service.listFileTrashPage(f.workspace.id);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + FILE_TRASH_CURSOR_IDLE_MS + 1);
    await expect(f.service.listFileTrashPage(f.workspace.id, { cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'FILE_TRASH_CURSOR_EXPIRED' });
    clock.mockRestore();
    first = await f.service.listFileTrashPage(f.workspace.id);
    const restarted = await f.restart();
    await expect(restarted.listFileTrashPage(f.workspace.id, { cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'FILE_TRASH_CURSOR_EXPIRED' });
  });

  it('applies a fixed output/cache byte budget while older history remains reachable', async () => {
    // Real metadata, deliberately long safe relative paths. The listing never
    // opens these destinations or creates their parent directories.
    const longPrefix = Array.from({ length: 17 }, () => 'x'.repeat(230)).join('/');
    await seed(355, index => `${longPrefix}/${index}.txt`);
    let oldestCursor = '';
    for (let stream = 0; stream < 3; stream++) {
      let page = await f.service.listFileTrashPage(f.workspace.id, { limit: 50 });
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(FILE_TRASH_PAGE_BYTES);
      for (let step = 1; step < 7; step++) {
        page = await f.service.listFileTrashPage(f.workspace.id, { limit: 50, cursor: page.nextCursor! });
        if (stream === 0 && step === 1) oldestCursor = page.previousCursor!;
        expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(FILE_TRASH_PAGE_BYTES);
      }
      expect(page.items.length).toBeGreaterThan(0);
    }
    await expect(f.service.listFileTrashPage(f.workspace.id, { limit: 50, cursor: oldestCursor })).rejects.toMatchObject({ code: 'FILE_TRASH_CURSOR_EXPIRED' });
    expect((await f.service.listFileTrashPage(f.workspace.id, { limit: 50 })).items).toHaveLength(50);
  });

  it('bounds live streams and closes only its own context', async () => {
    await seed(40);
    const first = await f.service.listFileTrashPage(f.workspace.id);
    const second = await f.service.listFileTrashPage(f.workspace.id, { cursor: first.nextCursor! });
    for (let index = 0; index < 8; index++) await f.service.listFileTrashPage(f.workspace.id);
    await expect(f.service.listFileTrashPage(f.workspace.id, { cursor: second.previousCursor! })).rejects.toMatchObject({ code: 'FILE_TRASH_CURSOR_EXPIRED' });
    const peer = await f.restart();
    const peerPage = await peer.listFileTrashPage(f.workspace.id);
    await f.service.closeFileTrashPages();
    await expect(f.service.listFileTrashPage(f.workspace.id)).rejects.toMatchObject({ code: 'FILE_TRASH_UNAVAILABLE' });
    expect((await peer.listFileTrashPage(f.workspace.id, { cursor: peerPage.nextCursor! })).items).toHaveLength(15);
  });

  it('drains an admitted native read and closes every owned handle before shutdown resolves', async () => {
    await seed(40);
    const gate = deferred(), entered = deferred();
    const open = fs.open.bind(fs), opendir = fs.opendir.bind(fs);
    const live = new Set<FileHandle>(), directories: Dir[] = [];
    const closed = new Set<Dir>();
    let gated = false;
    vi.spyOn(fs, 'open').mockImplementation(async (input, flags, mode) => {
      const handle = await open(input, flags, mode);
      if (typeof flags === 'number' && flags & constants.O_DIRECTORY) {
        live.add(handle);
        const close = handle.close.bind(handle);
        vi.spyOn(handle, 'close').mockImplementation(async () => { try { await close(); } finally { live.delete(handle); } });
      }
      if (!gated && String(input).endsWith('/metadata.json')) { gated = true; entered.resolve(); await gate.promise; }
      return handle;
    });
    vi.spyOn(fs, 'opendir').mockImplementation(async (...args) => {
      const directory = await opendir(...args); directories.push(directory);
      const close = directory.close.bind(directory);
      vi.spyOn(directory, 'close').mockImplementation((async () => { await close(); closed.add(directory); }) as typeof directory.close);
      return directory;
    });
    const loading = f.service.listFileTrashPage(f.workspace.id);
    await entered.promise;
    let finished = false;
    const closing = f.service.closeFileTrashPages().then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    gate.resolve();
    await loading; await closing;
    expect(live.size).toBe(0);
    expect(directories.length).toBeGreaterThan(0);
    expect(closed.size).toBe(directories.length);
  });

  it('restores an exact entry beyond the legacy 5,000-name boundary through HTTP without enumeration', async () => {
    const root = path.join(f.config.workspacesDir, '.trash', f.workspace.id);
    await fs.mkdir(root, { recursive: true });
    for (let offset = 0; offset < 5010; offset += 40) {
      await Promise.all(Array.from({ length: Math.min(40, 5010 - offset) }, (_, index) => fs.mkdir(path.join(root, idAt(offset + index)))));
    }
    const legacyOrder = await fs.readdir(root);
    const targetId = legacyOrder[5007];
    const target = await saved(7000, 'old-but-recoverable.txt', targetId);
    await expect(f.service.listTrash(f.workspace.id)).rejects.toMatchObject({ code: 'FILE_TRASH_PAGE_REQUIRED', status: 413 });
    let cursor: string | undefined;
    let scanned = 0;
    const visible: string[] = [];
    do {
      const page = await f.service.listFileTrashPage(f.workspace.id, { cursor });
      expect(page.scanned).toBeLessThanOrEqual(FILE_TRASH_SCAN_LIMIT);
      scanned += page.scanned;
      visible.push(...page.items.map(entry => entry.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(scanned).toBe(5010);
    expect(visible).toEqual([target.id]);
    const { base, events } = await http();
    const mutations: Array<{ paths?: string[] }> = [];
    events.on('workspace:manual-intent', payload => { if (payload.phase === 'start') mutations.push(payload); });
    vi.spyOn(fs, 'readdir').mockRejectedValue(new Error('Exact lookup must not enumerate trash.'));
    vi.spyOn(fs, 'opendir').mockRejectedValue(new Error('Exact lookup must not enumerate trash.'));
    expect(await f.service.getTrashEntry(f.workspace.id, target.id)).toEqual(target);
    const response = await fetch(`${base}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashId: target.id }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(target);
    expect(await fs.readFile(path.join(f.workspace.path, target.path), 'utf8')).toBe('Retained native bytes 7000.');
    expect(mutations.some(event => event.paths?.includes(target.path))).toBe(true);
  });

  it('keeps exact lookup traversal, expiry and review-path drift protection independent of pages', async () => {
    const original = await saved(1);
    await expect(f.service.getTrashEntry(f.workspace.id, '../outside')).rejects.toMatchObject({ code: 'INVALID_FILE_TRASH_ID' });
    const { base } = await http();
    const get = f.service.getTrashEntry.bind(f.service);
    let calls = 0;
    const spy = vi.spyOn(f.service, 'getTrashEntry').mockImplementation(async (workspaceId, trashId) => {
      const entry = await get(workspaceId, trashId);
      if (++calls === 1) await fs.writeFile(path.join(f.config.workspacesDir, '.trash', f.workspace.id, original.id, 'metadata.json'), JSON.stringify({ ...original, path: 'changed-path.txt' }));
      return entry;
    });
    const changed = await fetch(`${base}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashId: original.id }) });
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ code: 'VERSION_CONFLICT' });
    spy.mockRestore();
    await expect(fs.lstat(path.join(f.workspace.path, 'changed-path.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(f.config.workspacesDir, '.trash', f.workspace.id, original.id, 'content'), 'utf8')).toBe('Retained native bytes 1.');
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(original.expiresAt) + 1);
    await expect(f.service.restoreEntry(f.workspace.id, original.id)).rejects.toMatchObject({ code: 'FILE_TRASH_EXPIRED', status: 410 });
  });

  it('validates the HTTP page contract and preserves the prior valid page after a rejected cursor request', async () => {
    await seed(27);
    const { base } = await http();
    const response = await fetch(`${base}/trash/page?limit=25`);
    expect(response.status).toBe(200);
    const page = await response.json() as FileTrashPage;
    expect(page.items).toHaveLength(25);
    expect(page).toMatchObject({ previousCursor: null, hasMore: true, scanned: 25, unavailable: 0, order: 'filesystem' });
    for (const query of ['limit=51', 'limit=0', 'limit=25&limit=10', 'offset=1', 'q=%00']) {
      expect((await fetch(`${base}/trash/page?${query}`)).status).toBe(400);
    }
    const bad = await fetch(`${base}/trash/page?limit=25&cursor=malformed`);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: 'INVALID_FILE_TRASH_CURSOR' });
    const next = await fetch(`${base}/trash/page?limit=25&cursor=${encodeURIComponent(page.nextCursor!)}`);
    expect(next.status).toBe(200);
    expect((await next.json() as FileTrashPage).items).toHaveLength(2);
  });
});
