import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nativeFs, { Dir, type BigIntStats, type FSWatcher } from 'node:fs';
import fs from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { DirectoryPageService, MAX_DIRECTORY_PAGE_SIZE } from '../server/directory-pages';
import { loadConfig } from '../server/config';
import { JsonStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import type { Workspace } from '../shared/types';

describe('bounded native directory pages', () => {
  let temporary: string;
  let workspaces: WorkspaceService;
  let workspace: Workspace;
  let events: EventEmitter;
  const services: DirectoryPageService[] = [];

  beforeEach(async () => {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-directory-pages-'));
    const config = loadConfig({ DATA_DIR: temporary, WORKSPACE_PASSWORD: 'directory-page-test-password', SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'k'.repeat(64) });
    workspaces = new WorkspaceService(config, new JsonStore(config.stateDir));
    await workspaces.initialize();
    workspace = await workspaces.create({ name: 'Paged directory' });
    events = new EventEmitter();
  });

  afterEach(async () => {
    await Promise.all(services.splice(0).map(service => service.close()));
    vi.restoreAllMocks();
    await fs.rm(temporary, { recursive: true, force: true });
  });

  function service(options?: ConstructorParameters<typeof DirectoryPageService>[1]) {
    const instance = new DirectoryPageService({ workspaces, events }, options);
    services.push(instance);
    return instance;
  }

  async function files(count: number, directory = workspace.path, prefix = 'file-') {
    const names = Array.from({ length: count }, (_, index) => `${prefix}${String(index).padStart(4, '0')}.txt`);
    for (let offset = 0; offset < names.length; offset += 16) await Promise.all(names.slice(offset, offset + 16).map(name => fs.writeFile(path.join(directory, name), '')));
    return names;
  }

  function freezeDirectoryMetadata() {
    // Model a filesystem whose timestamps/size/link count repeat across native
    // writes. Descriptor identity and all real I/O/notifications remain intact.
    const captured = new Map<string, Pick<BigIntStats, 'mtimeNs' | 'ctimeNs' | 'birthtimeNs' | 'size' | 'nlink' | 'mode'>>();
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode);
      const stat = handle.stat.bind(handle);
      vi.spyOn(handle, 'stat').mockImplementation(async options => {
        const value = await stat(options);
        if (typeof value.dev === 'bigint' && value.isDirectory()) {
          const directory = value as BigIntStats;
          const key = `${directory.dev}:${directory.ino}`;
          let initial = captured.get(key);
          if (!initial) {
            initial = { mtimeNs: directory.mtimeNs, ctimeNs: directory.ctimeNs, birthtimeNs: directory.birthtimeNs,
              size: directory.size, nlink: directory.nlink, mode: directory.mode };
            captured.set(key, initial);
          }
          Object.assign(directory, initial);
        }
        return value;
      });
      return handle;
    });
  }

  it('reads only one native page on first load, then visits every entry once without full-directory reads', async () => {
    const names = await files(257);
    const instance = service();
    const wholeDirectory = vi.spyOn(fs, 'readdir').mockRejectedValue(new Error('Whole-directory reads are forbidden in this test.'));
    const reads = vi.spyOn(Dir.prototype, 'read');
    const opened = vi.spyOn(fs, 'opendir');
    let page = await instance.read(workspace.id, { limit: 17 });
    expect(page.entries).toHaveLength(17);
    expect(page.nextCursor).toMatch(/^[a-zA-Z0-9_-]{32}$/);
    expect(page.snapshot).toMatch(/^[a-zA-Z0-9_-]{43}$/);
    expect(page.order).toBe('filesystem');
    expect(reads.mock.calls.length).toBeLessThanOrEqual(18);
    expect(opened.mock.calls[0]?.[1]).toEqual({ bufferSize: 32 });
    const visited = page.entries.map(entry => entry.path);
    const snapshot = page.snapshot;
    while (page.nextCursor) {
      const before = reads.mock.calls.length;
      page = await instance.read(workspace.id, { limit: 17, cursor: page.nextCursor });
      expect(reads.mock.calls.length - before).toBeLessThanOrEqual(18);
      expect(page.entries.length).toBeLessThanOrEqual(17);
      expect(page.snapshot).toBe(snapshot);
      visited.push(...page.entries.map(entry => entry.path));
    }
    expect(new Set(visited).size).toBe(names.length);
    expect([...visited].sort()).toEqual(names.sort());
    expect(wholeDirectory).not.toHaveBeenCalled();
  });

  it('retains useful natural folder-first ordering within a page', async () => {
    await fs.mkdir(path.join(workspace.path, 'folder10'));
    await fs.mkdir(path.join(workspace.path, 'folder2'));
    await fs.writeFile(path.join(workspace.path, 'file10.txt'), '');
    await fs.writeFile(path.join(workspace.path, 'file2.txt'), '');
    const page = await service().read(workspace.id);
    expect(page.entries.map(entry => entry.name)).toEqual(['folder2', 'folder10', 'file2.txt', 'file10.txt']);
    expect(page.nextCursor).toBeNull();
  });

  it('conditional refresh does not enumerate again or consume the current continuation', async () => {
    await files(35);
    const instance = service();
    const first = await instance.read(workspace.id, { limit: 10 });
    const reads = vi.spyOn(Dir.prototype, 'read');
    const opened = vi.spyOn(fs, 'opendir');
    const unchanged = await instance.read(workspace.id, { limit: 10, snapshot: first.snapshot });
    expect(unchanged).toEqual({ path: '', entries: [], nextCursor: null, snapshot: first.snapshot, order: 'filesystem', unchanged: true });
    expect(reads).not.toHaveBeenCalled();
    expect(opened).not.toHaveBeenCalled();
    const next = await instance.read(workspace.id, { limit: 10, cursor: first.nextCursor! });
    expect(next.entries).toHaveLength(10);
    expect(next.entries.some(entry => first.entries.some(previous => previous.path === entry.path))).toBe(false);
  });

  it('retries and concurrent duplicate requests return the same continuation without skipping files', async () => {
    await files(31);
    const instance = service();
    const first = await instance.read(workspace.id, { limit: 10 });
    const [second, concurrent] = await Promise.all([
      instance.read(workspace.id, { limit: 10, cursor: first.nextCursor! }),
      instance.read(workspace.id, { limit: 10, cursor: first.nextCursor! }),
    ]);
    expect(concurrent).toEqual(second);
    const reads = vi.spyOn(Dir.prototype, 'read');
    expect(await instance.read(workspace.id, { limit: 10, cursor: first.nextCursor! })).toEqual(second);
    expect(reads).not.toHaveBeenCalled();
    const third = await instance.read(workspace.id, { limit: 10, cursor: second.nextCursor! });
    await expect(instance.read(workspace.id, { limit: 10, cursor: first.nextCursor! })).rejects.toMatchObject({ status: 409, code: 'DIRECTORY_PAGE_STALE' });
    const last = await instance.read(workspace.id, { limit: 10, cursor: third.nextCursor! });
    expect(last.entries).toHaveLength(1);
    expect(last.nextCursor).toBeNull();
    expect(await instance.read(workspace.id, { limit: 10, cursor: third.nextCursor! })).toEqual(last);
  });

  it('binds cursors to workspace, directory and page size', async () => {
    await files(25);
    await fs.mkdir(path.join(workspace.path, 'nested'));
    const other = await workspaces.create({ name: 'Different workspace' });
    const instance = service();
    const first = await instance.read(workspace.id, { limit: 5 });
    await expect(instance.read(other.id, { limit: 5, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'DIRECTORY_PAGE_STALE' });
    await expect(instance.read(workspace.id, { path: 'nested', limit: 5, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'DIRECTORY_PAGE_STALE' });
    await expect(instance.read(workspace.id, { limit: 6, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'DIRECTORY_PAGE_STALE' });
    expect((await instance.read(workspace.id, { limit: 5, cursor: first.nextCursor! })).entries).toHaveLength(5);
  });

  it('invalidates a changed folder instead of joining pages from different directory contents', async () => {
    await files(25);
    const instance = service();
    const first = await instance.read(workspace.id, { limit: 5 });
    await fs.writeFile(path.join(workspace.path, 'new-file.txt'), 'new');
    await expect(instance.read(workspace.id, { limit: 5, cursor: first.nextCursor! })).rejects.toMatchObject({ status: 409, code: 'DIRECTORY_PAGE_STALE' });
    const fresh = await instance.read(workspace.id, { limit: 5, snapshot: first.snapshot });
    expect(fresh.unchanged).toBeUndefined();
    expect(fresh.snapshot).not.toBe(first.snapshot);
    expect(await instance.entry(workspace.id, 'new-file.txt')).toMatchObject({ name: 'new-file.txt', path: 'new-file.txt', size: 3 });
  });

  it.each(['create', 'delete', 'rename'] as const)('invalidates native %s when all mutable directory stat fields repeat', async operation => {
    await files(12);
    freezeDirectoryMetadata();
    const instance = service();
    const first = await instance.read(workspace.id, { limit: 2 });
    if (operation === 'create') await fs.writeFile(path.join(workspace.path, 'new-native.txt'), 'new');
    else if (operation === 'delete') await fs.unlink(path.join(workspace.path, 'file-0008.txt'));
    else await fs.rename(path.join(workspace.path, 'file-0008.txt'), path.join(workspace.path, 'renamed-native.txt'));
    const reads = vi.spyOn(Dir.prototype, 'read');
    await expect(instance.read(workspace.id, { limit: 2, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'DIRECTORY_PAGE_STALE' });
    expect(reads).not.toHaveBeenCalled();
    const fresh = await instance.read(workspace.id, { limit: 2, snapshot: first.snapshot });
    expect(fresh.unchanged).toBeUndefined();
    expect(fresh.snapshot).not.toBe(first.snapshot);
  });

  it('retains observation for a completed small directory and rejects a false unchanged response', async () => {
    freezeDirectoryMetadata();
    const instance = service();
    const first = await instance.read(workspace.id);
    expect(first.entries).toEqual([]);
    expect(first.nextCursor).toBeNull();
    expect((await instance.read(workspace.id, { snapshot: first.snapshot })).unchanged).toBe(true);
    await fs.writeFile(path.join(workspace.path, 'after-empty-page.txt'), 'created');
    const fresh = await instance.read(workspace.id, { snapshot: first.snapshot });
    expect(fresh.unchanged).toBeUndefined();
    expect(fresh.snapshot).not.toBe(first.snapshot);
    expect(fresh.entries).toContainEqual(expect.objectContaining({ path: 'after-empty-page.txt' }));
  });

  it('invalidates a cached final-page retry when native metadata does not advance', async () => {
    await files(3);
    freezeDirectoryMetadata();
    const instance = service();
    const first = await instance.read(workspace.id, { limit: 2 });
    const last = await instance.read(workspace.id, { limit: 2, cursor: first.nextCursor! });
    expect(last.nextCursor).toBeNull();
    await fs.unlink(path.join(workspace.path, last.entries[0].path));
    await expect(instance.read(workspace.id, { limit: 2, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'DIRECTORY_PAGE_STALE' });
  });

  it.each(['changed', 'intent-start', 'intent-end'] as const)('uses the application %s mutation signal when native watching is unavailable and metadata repeats', async signal => {
    await files(6);
    freezeDirectoryMetadata();
    vi.spyOn(nativeFs, 'watch').mockImplementation(() => { throw Object.assign(new Error('This filesystem cannot be watched.'), { code: 'ENOSYS' }); });
    const instance = service();
    const first = await instance.read(workspace.id, { limit: 2 });
    if (signal === 'intent-start') events.emit('workspace:manual-intent', { workspaceId: workspace.id, operationId: 'owned-write', phase: 'start', paths: ['owned.txt'] });
    await workspaces.createEntry(workspace.id, 'owned.txt', 'file');
    if (signal === 'changed') events.emit('workspace:changed', { workspaceId: workspace.id, paths: ['owned.txt'] });
    if (signal === 'intent-end') events.emit('workspace:manual-intent', { workspaceId: workspace.id, operationId: 'owned-write', phase: 'end', paths: ['owned.txt'] });
    await expect(instance.read(workspace.id, { limit: 2, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'DIRECTORY_PAGE_STALE' });
    const fresh = await instance.read(workspace.id, { limit: 2, snapshot: first.snapshot });
    expect(fresh.unchanged).toBeUndefined();
    expect(fresh.snapshot).not.toBe(first.snapshot);
    expect(await instance.entry(workspace.id, 'owned.txt')).toMatchObject({ path: 'owned.txt', kind: 'file' });
  });

  it('keeps unrelated workspace mutation signals from invalidating a current cursor', async () => {
    await files(6);
    const instance = service();
    const first = await instance.read(workspace.id, { limit: 2 });
    events.emit('workspace:changed', { workspaceId: 'another-workspace' });
    const second = await instance.read(workspace.id, { limit: 2, cursor: first.nextCursor! });
    expect(second.entries).toHaveLength(2);
    expect(second.snapshot).toBe(first.snapshot);
  });

  it('does not resurrect an evicted conditional snapshot solely because directory metadata is identical', async () => {
    await fs.mkdir(path.join(workspace.path, 'other'));
    freezeDirectoryMetadata();
    const instance = service({ maxLeases: 1 });
    const first = await instance.read(workspace.id);
    await instance.read(workspace.id, { path: 'other' });
    const fresh = await instance.read(workspace.id, { snapshot: first.snapshot });
    expect(fresh.unchanged).toBeUndefined();
    expect(fresh.snapshot).not.toBe(first.snapshot);
    expect(fresh.entries).toEqual(first.entries);
  });

  it('invalidates after observation fails and closes every watcher/listener within the lease cap', async () => {
    await files(6);
    const watchers: FSWatcher[] = [];
    const watch = nativeFs.watch.bind(nativeFs);
    vi.spyOn(nativeFs, 'watch').mockImplementation((...args: Parameters<typeof nativeFs.watch>) => {
      const watcher = watch(...args);
      vi.spyOn(watcher, 'close');
      watchers.push(watcher);
      return watcher;
    });
    const instance = service({ maxLeases: 1 });
    const first = await instance.read(workspace.id, { limit: 2 });
    watchers[0].emit('error', new Error('The native watch was lost.'));
    await expect(instance.read(workspace.id, { limit: 2, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'DIRECTORY_PAGE_STALE' });
    expect(watchers[0].close).toHaveBeenCalledTimes(1);
    await instance.read(workspace.id, { limit: 2 });
    await instance.read(workspace.id, { limit: 2 });
    expect(watchers[1].close).toHaveBeenCalledTimes(1);
    expect(watchers[2].close).not.toHaveBeenCalled();
    expect(events.listenerCount('workspace:changed')).toBe(1);
    expect(events.listenerCount('workspace:manual-intent')).toBe(1);
    await instance.close();
    expect(watchers[2].close).toHaveBeenCalledTimes(1);
    expect(events.listenerCount('workspace:changed')).toBe(0);
    expect(events.listenerCount('workspace:manual-intent')).toBe(0);
  });

  it('does not scan hidden entries without a per-request bound', async () => {
    await files(50, workspace.path, '.codex-write-');
    const reads = vi.spyOn(Dir.prototype, 'read');
    const page = await service().read(workspace.id, { limit: 2 });
    expect(page.entries).toEqual([]);
    expect(page.nextCursor).not.toBeNull();
    expect(reads.mock.calls.length).toBeLessThanOrEqual(9);
  });

  it('reveals a named entry directly without consuming or enumerating directory pages', async () => {
    await fs.mkdir(path.join(workspace.path, 'many'));
    await files(101, path.join(workspace.path, 'many'));
    const instance = service();
    const reads = vi.spyOn(Dir.prototype, 'read');
    const opened = vi.spyOn(fs, 'opendir');
    expect(await instance.entry(workspace.id, 'many/file-0100.txt')).toMatchObject({ name: 'file-0100.txt', path: 'many/file-0100.txt', kind: 'file', size: 0 });
    expect(reads).not.toHaveBeenCalled();
    expect(opened).not.toHaveBeenCalled();
    await expect(instance.entry(workspace.id, 'many/absent.txt')).rejects.toMatchObject({ status: 404, code: 'FILE_NOT_FOUND' });
  });

  it('shows final symlinks but rejects traversal through either internal or external symlink folders', async () => {
    await fs.mkdir(path.join(workspace.path, 'real'));
    await fs.writeFile(path.join(workspace.path, 'real/inside.txt'), 'inside');
    const outside = path.join(temporary, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'private.txt'), 'private');
    await fs.symlink('real', path.join(workspace.path, 'internal-link'));
    await fs.symlink(outside, path.join(workspace.path, 'external-link'));
    const instance = service();
    expect((await instance.read(workspace.id)).entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'internal-link', isSymlink: true }), expect.objectContaining({ name: 'external-link', isSymlink: true }),
    ]));
    expect(await instance.entry(workspace.id, 'external-link')).toMatchObject({ isSymlink: true });
    for (const name of ['internal-link', 'external-link']) {
      await expect(instance.read(workspace.id, { path: name })).rejects.toMatchObject({ status: 403, code: 'UNSAFE_PATH' });
      await expect(instance.entry(workspace.id, `${name}/private.txt`)).rejects.toMatchObject({ status: 403, code: 'UNSAFE_PATH' });
    }
  });

  it('uses the bound descriptor if a directory is replaced just before opendir, then rejects its stale name', async () => {
    const original = path.join(workspace.path, 'source');
    const outside = path.join(temporary, 'outside');
    await fs.mkdir(original); await files(5, original);
    await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'private-marker'), 'private');
    const open = fs.opendir.bind(fs);
    const requested: string[] = [];
    vi.spyOn(fs, 'opendir').mockImplementationOnce(async (directory, options) => {
      requested.push(String(directory));
      await fs.rename(original, path.join(workspace.path, 'moved'));
      await fs.symlink(outside, original);
      return open(directory, options);
    });
    await expect(service().read(workspace.id, { path: 'source', limit: 2 })).rejects.toMatchObject({ code: 'DIRECTORY_PAGE_STALE' });
    expect(requested[0]).toMatch(/^\/proc\/self\/fd\/\d+$/);
    expect(await fs.readFile(path.join(outside, 'private-marker'), 'utf8')).toBe('private');
  });

  it('closes native streams on idle expiry, capacity eviction and shutdown', async () => {
    let now = 1000;
    await files(5);
    await fs.mkdir(path.join(workspace.path, 'other'));
    await files(5, path.join(workspace.path, 'other'));
    const opened: Dir[] = [];
    const open = fs.opendir.bind(fs);
    vi.spyOn(fs, 'opendir').mockImplementation(async (directory, options) => { const iterator = await open(directory, options); opened.push(iterator); return iterator; });
    const instance = service({ now: () => now, idleMs: 100, maxLeases: 1 });
    const first = await instance.read(workspace.id, { limit: 2 });
    const second = await instance.read(workspace.id, { path: 'other', limit: 2 });
    await expect(Promise.resolve().then(() => opened[0].read())).rejects.toMatchObject({ code: 'ERR_DIR_CLOSED' });
    await expect(instance.read(workspace.id, { limit: 2, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'DIRECTORY_PAGE_STALE' });
    now += 101;
    await instance.cleanup();
    await expect(Promise.resolve().then(() => opened[1].read())).rejects.toMatchObject({ code: 'ERR_DIR_CLOSED' });
    await expect(instance.read(workspace.id, { path: 'other', limit: 2, cursor: second.nextCursor! })).rejects.toMatchObject({ code: 'DIRECTORY_PAGE_STALE' });
    await instance.read(workspace.id, { limit: 2 });
    await instance.close();
    await expect(Promise.resolve().then(() => opened[2].read())).rejects.toMatchObject({ code: 'ERR_DIR_CLOSED' });
  });

  it.each(['../outside', '/etc', 'some/../outside', 'some//child', 'some\\child', './some', '.git', '.codex-write-secret', 'bad\0name'])(
    'rejects an unsafe directory path before enumeration: %j', async input => {
      const opened = vi.spyOn(fs, 'opendir');
      await expect(service().read(workspace.id, { path: input })).rejects.toMatchObject({ status: 400 });
      expect(opened).not.toHaveBeenCalled();
    },
  );

  it('bounds and validates page parameters', async () => {
    const instance = service();
    for (const limit of [0, -1, 1.5, NaN, Infinity, MAX_DIRECTORY_PAGE_SIZE + 1]) {
      await expect(instance.read(workspace.id, { limit })).rejects.toMatchObject({ status: 400, code: 'INVALID_DIRECTORY_PAGE' });
    }
    await expect(instance.read(workspace.id, { cursor: '../file' })).rejects.toMatchObject({ status: 400 });
    await expect(instance.read(workspace.id, { snapshot: 'not-a-snapshot' })).rejects.toMatchObject({ status: 400 });
    await expect(instance.read(workspace.id, { cursor: 'x'.repeat(32), snapshot: 's'.repeat(43) })).rejects.toMatchObject({ status: 400 });
  });
});
