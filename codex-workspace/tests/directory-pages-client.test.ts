import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../client/api';
import { DirectoryPageCache, findDirectoryEntries } from '../client/components/editor/directory-pages';
import { treeWindowIndices } from '../client/components/editor/tree-window';
import type { DirectoryPage, FileEntry } from '../shared/types';

const snapshot = 's'.repeat(43);
const cursor = (character: string) => character.repeat(32);
const entry = (path: string, kind: FileEntry['kind'] = 'file'): FileEntry => ({ path, name: path.split('/').at(-1)!, kind });
const page = (path: string, paths: string[], nextCursor: string | null, revision = snapshot): DirectoryPage => ({
  path, entries: paths.map(path => entry(path)), nextCursor, snapshot: revision, order: 'filesystem',
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe('workspace-scoped explorer paging', () => {
  it('requests one page initially, appends on demand and preserves pages when reopening or revalidating', async () => {
    const read = vi.fn(async (_path: string, options: { cursor?: string; snapshot?: string }) => {
      if (options.snapshot) return { ...page('', [], null), unchanged: true as const };
      return options.cursor ? page('', ['later.txt'], cursor('b')) : page('', ['first.txt'], cursor('a'));
    });
    const cache = new DirectoryPageCache({ page: read, entry: async path => entry(path) });
    await cache.loadDirectory('');
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(1);
    expect(cache.getSnapshot().tree[''].map(entry => entry.path)).toEqual(['first.txt']);
    await cache.loadMore('');
    expect(read).toHaveBeenCalledTimes(2);
    expect(cache.getSnapshot().tree[''].map(entry => entry.path)).toEqual(['first.txt', 'later.txt']);
    await cache.loadDirectory(''); // Collapsing and reopening uses the same cache.
    expect(read).toHaveBeenCalledTimes(2);
    await cache.loadDirectory('', true);
    expect(read).toHaveBeenCalledTimes(3);
    expect(cache.getSnapshot().tree[''].map(entry => entry.path)).toEqual(['first.txt', 'later.txt']);
    expect(cache.getSnapshot().paging[''].nextCursor).toBe(cursor('b'));
    expect(cache.getSnapshot().loading.size).toBe(0);
  });

  it('deduplicates an on-demand page against a directly revealed entry', async () => {
    const cache = new DirectoryPageCache({
      page: async (_path, options) => options.cursor ? page('', ['far.txt', 'last.txt'], null) : page('', ['first.txt'], cursor('a')),
      entry: async path => entry(path),
    });
    await cache.loadDirectory('');
    await cache.revealPath('far.txt');
    await cache.loadMore('');
    expect(cache.getSnapshot().tree[''].map(entry => entry.path)).toEqual(['first.txt', 'far.txt', 'last.txt']);
    expect(cache.getSnapshot().paging[''].nextCursor).toBeNull();
  });

  it('reveals a nested file through exact lookups without requesting earlier continuation pages', async () => {
    const read = vi.fn(async (path: string) => path === '' ? page('', ['unrelated.txt'], cursor('a')) : page(path, [`${path}/first.txt`], cursor('b')));
    const lookup = vi.fn(async (path: string) => entry(path, path === 'many' || path === 'many/nested' ? 'directory' : 'file'));
    const cache = new DirectoryPageCache({ page: read, entry: lookup });
    await cache.revealPath('many/nested/last.txt');
    expect(read).toHaveBeenCalledTimes(3);
    expect(read.mock.calls.map(call => call[0]).sort()).toEqual(['', 'many', 'many/nested']);
    expect(lookup.mock.calls.map(call => call[0]).sort()).toEqual(['many', 'many/nested', 'many/nested/last.txt']);
    expect(cache.getSnapshot().tree['many/nested']).toContainEqual(entry('many/nested/last.txt'));
  });

  it('keeps loaded entries on a transient continuation failure and retries the same cursor', async () => {
    let fail = true;
    const read = vi.fn(async (_path: string, options: { cursor?: string }) => {
      if (!options.cursor) return page('', ['first.txt'], cursor('a'));
      if (fail) throw new ApiError('Storage is temporarily unavailable.', 503, 'DIRECTORY_READ_FAILED');
      return page('', ['next.txt'], null);
    });
    const cache = new DirectoryPageCache({ page: read, entry: async path => entry(path) });
    await cache.loadDirectory('');
    await cache.loadMore('');
    expect(cache.getSnapshot().errors['']).toContain('temporarily unavailable');
    expect(cache.getSnapshot().tree['']).toEqual([entry('first.txt')]);
    expect(cache.getSnapshot().paging[''].nextCursor).toBe(cursor('a'));
    fail = false;
    await cache.retry('');
    expect(read.mock.calls.at(-1)?.[1].cursor).toBe(cursor('a'));
    expect(cache.getSnapshot().errors['']).toBeUndefined();
    expect(cache.getSnapshot().tree['']).toEqual([entry('first.txt'), entry('next.txt')]);
  });

  it('requires a fresh first page after snapshot invalidation, preserving the active file directly', async () => {
    let changed = false;
    const lookup = vi.fn(async (path: string) => entry(path));
    const read = vi.fn(async (_path: string, options: { cursor?: string; snapshot?: string }) => {
      if (options.cursor) throw new ApiError('Folder changed. Refresh it.', 409, 'DIRECTORY_PAGE_STALE');
      return changed ? page('', ['new-first.txt'], cursor('n'), 'n'.repeat(43)) : page('', ['active.txt'], cursor('a'));
    });
    const cache = new DirectoryPageCache({ page: read, entry: lookup });
    cache.preservePaths(['active.txt']);
    await cache.loadDirectory('');
    changed = true;
    await cache.loadMore('');
    expect(cache.getSnapshot().paging[''].stale).toBe(true);
    expect(cache.getSnapshot().tree['']).toEqual([entry('active.txt')]);
    await cache.retry('');
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
    expect(read.mock.calls.at(-1)?.[1]).toMatchObject({ cursor: undefined, snapshot: undefined });
    expect(cache.getSnapshot().tree[''].map(entry => entry.path)).toEqual(['new-first.txt', 'active.txt']);
    expect(cache.getSnapshot().paging[''].snapshot).toBe('n'.repeat(43));
    expect(cache.getSnapshot().paging[''].stale).toBeUndefined();
  });

  it('removes a deleted focused entry when refreshing its parent instead of retaining a ghost row', async () => {
    let refreshed = false;
    const cache = new DirectoryPageCache({
      page: async () => refreshed ? page('', ['remaining.txt'], null, 'n'.repeat(43)) : page('', ['deleted.txt'], cursor('a')),
      entry: async () => { throw new ApiError('File not found.', 404, 'FILE_NOT_FOUND'); },
    });
    await cache.loadDirectory('');
    cache.focusPath('deleted.txt');
    refreshed = true;
    await cache.loadDirectory('', true);
    await vi.waitFor(() => expect(cache.getSnapshot().tree['']).toEqual([entry('remaining.txt')]));
  });

  it('ignores late pages after reset, unmount or workspace replacement', async () => {
    const old = deferred<DirectoryPage>();
    let fresh = false;
    const cache = new DirectoryPageCache({ page: async () => fresh ? page('', ['new-workspace.txt'], null) : old.promise, entry: async path => entry(path) });
    const reading = cache.loadDirectory('');
    cache.setActive(false);
    cache.reset();
    cache.setActive(true);
    fresh = true;
    await cache.loadDirectory('');
    old.resolve(page('', ['old-workspace.txt'], cursor('a')));
    await reading;
    expect(cache.getSnapshot().tree['']).toEqual([entry('new-workspace.txt')]);
    expect(cache.getSnapshot().loading.size).toBe(0);
  });

  it('cannot commit late responses while locked, and resumes with normal refresh after unlock', async () => {
    let locked = false;
    const waiting = deferred<DirectoryPage>();
    const read = vi.fn(async () => waiting.promise);
    const cache = new DirectoryPageCache({ page: read, entry: async path => entry(path), canRead: () => !locked });
    const reading = cache.loadDirectory('');
    locked = true; cache.cancel();
    waiting.resolve(page('', ['must-not-return.txt'], null));
    await reading;
    await cache.loadDirectory('', true);
    expect(read).toHaveBeenCalledTimes(1);
    expect(cache.getSnapshot().tree['']).toBeUndefined();
    locked = false;
    await cache.loadDirectory('', true);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('keeps a remapped subtree but fences old requests and invalidates path-bound cursors', async () => {
    const late = deferred<DirectoryPage>();
    let more = false;
    const cache = new DirectoryPageCache({
      page: async (path, options) => options.cursor && more ? late.promise : { ...page(path, path ? [`${path}/draft.ts`] : ['old'], cursor('a')), entries: path ? [entry(`${path}/draft.ts`)] : [entry('old', 'directory')] },
      entry: async path => entry(path),
    });
    await cache.loadDirectory(''); await cache.loadDirectory('old');
    more = true;
    const request = cache.loadMore('old');
    cache.remapMovedEntry(entry('old', 'directory'), 'renamed');
    late.resolve(page('old', ['old/late.txt'], null));
    await request;
    expect(cache.getSnapshot().tree['old']).toBeUndefined();
    expect(cache.getSnapshot().tree['renamed']).toEqual([entry('renamed/draft.ts')]);
    expect(cache.getSnapshot().tree['']).toEqual([entry('renamed', 'directory')]);
    expect(cache.getSnapshot().paging['renamed']).toMatchObject({ nextCursor: null, snapshot: '', stale: true });
  });

  it('bounds simultaneous directory reads and cancels queued reads without starting them', async () => {
    const pending: ReturnType<typeof deferred<DirectoryPage>>[] = [];
    let running = 0; let maximum = 0;
    const read = vi.fn(async (path: string) => {
      running += 1; maximum = Math.max(maximum, running);
      const wait = deferred<DirectoryPage>(); pending.push(wait);
      try { return await wait.promise; } finally { running -= 1; }
    });
    const cache = new DirectoryPageCache({ page: read, entry: async path => entry(path) });
    const requests = Array.from({ length: 20 }, (_, index) => cache.loadDirectory(`folder-${index}`));
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(4));
    expect(maximum).toBe(4);
    cache.cancel();
    pending.forEach((wait, index) => wait.resolve(page(`folder-${index}`, [], null)));
    await Promise.all(requests);
    expect(read).toHaveBeenCalledTimes(4);
    expect(cache.getSnapshot().loading.size).toBe(0);
    expect(cache.getSnapshot().tree).toEqual({});
  });

  it('rejects a malformed response without introducing paths outside its requested directory', async () => {
    const cache = new DirectoryPageCache({ page: async () => page('folder', ['elsewhere/file.txt'], null), entry: async path => entry(path) });
    await cache.loadDirectory('folder');
    expect(cache.getSnapshot().tree['folder']).toBeUndefined();
    expect(cache.getSnapshot().errors['folder']).toContain('unreadable folder page');
  });
});

describe('explicit explorer Inspect resolution', () => {
  it('makes an exact unseen target and its ancestors available without walking continuation pages', async () => {
    const read = vi.fn(async (path: string, _options: { cursor?: string }) => page(path, [path ? `${path}/first.txt` : 'unrelated.txt'], cursor('a')));
    const lookup = vi.fn(async (path: string) => ({ ...entry(path, path === 'many' || path === 'many/nested' ? 'directory' : 'file'), size: 42 }));
    const cache = new DirectoryPageCache({ page: read, entry: lookup });
    const target = await cache.revealEntry('many/nested/last.txt');
    expect(target).toEqual({ ...entry('many/nested/last.txt'), size: 42 });
    expect(cache.getSnapshot().tree['']).toContainEqual({ ...entry('many', 'directory'), size: 42 });
    expect(cache.getSnapshot().tree['many']).toContainEqual({ ...entry('many/nested', 'directory'), size: 42 });
    expect(cache.getSnapshot().tree['many/nested']).toContainEqual(target);
    expect(read.mock.calls.map(call => call[0])).toEqual(['', 'many', 'many/nested']);
    expect(read.mock.calls.every(call => call[1].cursor === undefined)).toBe(true);
    expect(lookup.mock.calls.filter(call => call[0] === 'many/nested/last.txt')).toHaveLength(2);
    expect(cache.getSnapshot().paging['many/nested'].nextCursor).toBe(cursor('a'));
  });

  it('verifies a cached target freshly and reports a deleted file instead of selecting a ghost row', async () => {
    const read = vi.fn(async () => page('', ['gone.txt'], cursor('a')));
    const lookup = vi.fn(async () => { throw new ApiError('File not found.', 404, 'FILE_NOT_FOUND'); });
    const cache = new DirectoryPageCache({ page: read, entry: lookup });
    await cache.loadDirectory('');
    expect(await cache.revealEntry('gone.txt')).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(cache.getSnapshot().tree['']).toEqual([]);
  });

  it('keeps unavailable storage and a lost workspace distinct from a proven missing file', async () => {
    for (const failure of [new ApiError('Workspace is missing.', 404, 'WORKSPACE_NOT_FOUND'), new ApiError('Storage unavailable.', 503, 'DIRECTORY_READ_FAILED'), new ApiError('Unsafe path.', 403, 'UNSAFE_PATH')]) {
      const read = vi.fn(async () => page('', [], null));
      const cache = new DirectoryPageCache({ page: read, entry: async () => { throw failure; } });
      await expect(cache.revealEntry('target.txt')).rejects.toBe(failure);
      expect(read).not.toHaveBeenCalled();
    }
  });

  it('reports an ancestor-page failure without claiming that the entry has been revealed', async () => {
    const cache = new DirectoryPageCache({ page: async () => { throw new ApiError('Folder cannot be read.', 503, 'DIRECTORY_READ_FAILED'); }, entry: async path => entry(path) });
    await expect(cache.revealEntry('target.txt')).rejects.toThrow('Folder cannot be read.');
    expect(cache.getSnapshot().tree['']).toBeUndefined();
  });

  it('cancels immediately and ignores a late exact-entry response after a superseding Inspect', async () => {
    const late = deferred<FileEntry>();
    const controller = new AbortController();
    const cache = new DirectoryPageCache({ page: async () => page('', ['keep.txt'], null), entry: async path => path === 'old.txt' ? late.promise : entry(path) });
    const previous = cache.revealEntry('old.txt', controller.signal);
    const cancelled = expect(previous).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await cancelled;
    expect(await cache.revealEntry('current.txt')).toEqual(entry('current.txt'));
    late.resolve(entry('old.txt'));
    await Promise.resolve();
    expect(cache.getSnapshot().tree['']).toEqual([entry('keep.txt'), entry('current.txt')]);
  });

  it('cancels an Inspect during an ancestor read without cancelling an existing visible consumer', async () => {
    const pendingPage = deferred<DirectoryPage>();
    const controller = new AbortController();
    const read = vi.fn(async () => pendingPage.promise);
    const lookup = vi.fn(async (path: string) => entry(path));
    const cache = new DirectoryPageCache({ page: read, entry: lookup });
    const load = vi.spyOn(cache, 'loadDirectory');
    const visible = cache.loadDirectory('');
    const inspecting = cache.revealEntry('other.txt', controller.signal);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    const cancelled = expect(inspecting).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await cancelled;
    pendingPage.resolve(page('', ['visible.txt'], null));
    await visible;
    expect(cache.getSnapshot().tree['']).toEqual([entry('visible.txt')]);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('does not publish the old workspace target after a cache reset', async () => {
    const late = deferred<FileEntry>();
    let reset = false;
    const cache = new DirectoryPageCache({ page: async () => page('', ['new-workspace.txt'], null), entry: async path => reset ? entry(path) : late.promise });
    const inspecting = cache.revealEntry('old-workspace.txt');
    const cancelled = expect(inspecting).rejects.toMatchObject({ name: 'AbortError' });
    cache.reset(); reset = true;
    await cancelled;
    await cache.loadDirectory('');
    late.resolve(entry('old-workspace.txt'));
    await Promise.resolve();
    expect(cache.getSnapshot().tree['']).toEqual([entry('new-workspace.txt')]);
  });

  it('checks again after parent loading so a file deleted during Inspect is reported missing', async () => {
    let reads = 0;
    const cache = new DirectoryPageCache({
      page: async () => page('', ['removed-mid-inspect.txt'], null),
      entry: async path => { if (++reads === 1) return entry(path); throw new ApiError('File not found.', 404, 'FILE_NOT_FOUND'); },
    });
    expect(await cache.revealEntry('removed-mid-inspect.txt')).toBeNull();
    expect(cache.getSnapshot().tree['']).toEqual([]);
  });
});

describe('bounded folder-upload collision checks', () => {
  it('checks only named roots, treats missing entries as available, and keeps symlink collisions visible', async () => {
    const read = vi.fn(async (path: string) => {
      if (path === 'destination/missing') throw new ApiError('File not found.', 404, 'FILE_NOT_FOUND');
      return { ...entry(path), isSymlink: true };
    });
    const result = await findDirectoryEntries('destination', new Set(['existing', 'missing']), read, new AbortController().signal);
    expect(read.mock.calls.map(call => call[0]).sort()).toEqual(['destination/existing', 'destination/missing']);
    expect(result).toEqual([{ ...entry('destination/existing'), isSymlink: true }]);
  });

  it('propagates unreadable destinations and lost workspaces before upload creation', async () => {
    for (const error of [new ApiError('Workspace not found.', 404, 'WORKSPACE_NOT_FOUND'), new ApiError('Permission denied.', 403, 'UNSAFE_PATH')]) {
      await expect(findDirectoryEntries('destination', new Set(['folder']), async () => { throw error; }, new AbortController().signal)).rejects.toBe(error);
    }
  });
});

describe('windowed explorer rows', () => {
  it('renders a bounded window of a large loaded tree with focused and active rows retained', () => {
    const offsets = Array.from({ length: 10_001 }, (_, index) => index * 36);
    const rows = treeWindowIndices(offsets, 4_000 * 36, 720, [0, 500, 9_999]);
    expect(rows.length).toBeLessThan(40);
    expect(rows).toEqual(expect.arrayContaining([0, 500, 4_000, 4_019, 9_999]));
    expect(rows).not.toContain(2_000);
  });

  it('includes taller status rows without mounting all intervening loaded rows', () => {
    const offsets = [0];
    for (let index = 0; index < 1_000; index += 1) offsets.push(offsets.at(-1)! + (index === 600 ? 120 : 46));
    const rows = treeWindowIndices(offsets, offsets[600] + 100, 460, [5]);
    expect(rows).toContain(600);
    expect(rows).toContain(610);
    expect(rows).toContain(5);
    expect(rows.length).toBeLessThan(30);
  });

  it('retains ordinary small-tree layout and handles an empty tree', () => {
    expect(treeWindowIndices([0, 36, 72], 500, 720)).toEqual([0, 1]);
    expect(treeWindowIndices([0], 0, 720)).toEqual([]);
  });
});
