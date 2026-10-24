import { ApiError } from '../../api';
import type { DirectoryPage, FileEntry } from '../../../shared/types';

export const EXPLORER_PAGE_SIZE = 100;
export interface DirectoryPagingState { nextCursor: string | null; snapshot: string; stale?: boolean }
export interface DirectoryTreeState {
  tree: Record<string, FileEntry[]>;
  paging: Record<string, DirectoryPagingState>;
  loading: ReadonlySet<string>;
  errors: Record<string, string>;
}
interface Options {
  page: (path: string, options: { cursor?: string; snapshot?: string; signal: AbortSignal }) => Promise<DirectoryPage>;
  entry: (path: string, signal: AbortSignal) => Promise<FileEntry>;
  canRead?: () => boolean;
}
interface Request { controller: AbortController; promise: Promise<void>; kind: 'first' | 'more' }
interface Waiter { signal: AbortSignal; start: () => void; cancel: () => void }
const emptyState = (): DirectoryTreeState => ({ tree: {}, paging: {}, loading: new Set(), errors: {} });
const own = <T>(record: Record<string, T>, key: string): T | undefined => Object.hasOwn(record, key) ? record[key] : undefined;
const parentPath = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
const within = (value: string, parent: string) => value === parent || value.startsWith(`${parent}/`);
const cancelled = () => new DOMException('Folder loading cancelled.', 'AbortError');
const message = (error: unknown) => error instanceof Error ? error.message : 'This folder could not be loaded.';

export function directoryAncestors(path: string): string[] {
  const parts = path.split('/');
  return ['', ...parts.slice(0, -1).map((_part, index) => parts.slice(0, index + 1).join('/'))];
}

/** Check only upload root names, with bounded concurrency, rather than listing their destination. */
export async function findDirectoryEntries(directory: string, names: ReadonlySet<string>, read: (path: string, signal: AbortSignal) => Promise<FileEntry>, signal: AbortSignal): Promise<FileEntry[]> {
  const pending = [...names];
  if (pending.length > 10_000 || pending.some(name => !name || /[\/\\\u0000-\u001f\u007f]/.test(name) || name === '.' || name === '..')) {
    throw new Error('The destination names could not be checked.');
  }
  const entries: FileEntry[] = [];
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    for (;;) {
      if (signal.aborted) throw cancelled();
      const name = pending[index++];
      if (name === undefined) return;
      const path = directory ? `${directory}/${name}` : name;
      try {
        const entry = await read(path, signal);
        if (signal.aborted) throw cancelled();
        if (!validEntry(entry, directory) || entry.path !== path) throw new Error('The destination folder could not be checked.');
        entries.push(entry);
      } catch (error) {
        if (signal.aborted) throw cancelled();
        if (!(error instanceof ApiError) || error.status !== 404 || error.code !== 'FILE_NOT_FOUND') throw error;
      }
    }
  }));
  return entries;
}

function validEntry(entry: FileEntry, directory: string): boolean {
  return !!entry && typeof entry.name === 'string' && entry.name.length > 0 && entry.name.length <= 255
    && !/[\/\\\u0000-\u001f\u007f]/.test(entry.name) && !['.', '..', '.git'].includes(entry.name)
    && !entry.name.startsWith('.codex-write-') && entry.path === (directory ? `${directory}/${entry.name}` : entry.name)
    && (entry.kind === 'file' || entry.kind === 'directory') && (entry.isSymlink === undefined || typeof entry.isSymlink === 'boolean');
}

function validPage(page: DirectoryPage, directory: string): boolean {
  return !!page && page.path === directory && page.order === 'filesystem' && Array.isArray(page.entries)
    && page.entries.length <= 200 && page.entries.every(entry => validEntry(entry, directory))
    && new Set(page.entries.map(entry => entry.path)).size === page.entries.length
    && /^[a-zA-Z0-9_-]{43}$/.test(page.snapshot)
    && (page.nextCursor === null || /^[a-zA-Z0-9_-]{32}$/.test(page.nextCursor))
    && (page.unchanged === undefined || (page.unchanged === true && page.entries.length === 0 && page.nextCursor === null));
}

/**
 * Request and cache ownership is independent of a mounted tree row. Collapsing,
 * hiding, or windowing a row cannot drop loaded pages or mutate another workspace.
 */
export class DirectoryPageCache {
  private state = emptyState();
  private listeners = new Set<() => void>();
  private requests = new Map<string, Request>();
  private lookups = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  private inspections = new Set<AbortController>();
  private waiters: Waiter[] = [];
  private running = 0;
  private generation = 0;
  private directoryRevisions = new Map<string, number>();
  private failedKinds = new Map<string, Request['kind']>();
  private preservedPaths: readonly string[] = [];
  private focusedPath: string | null = null;
  private active = true;

  constructor(private readonly options: Options) {}

  readonly getSnapshot = () => this.state;
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit(next: DirectoryTreeState) { this.state = next; for (const listener of this.listeners) listener(); }
  private available() { return this.active && this.options.canRead?.() !== false; }
  private revision(path: string) { return this.directoryRevisions.get(path) ?? 0; }

  setActive(active: boolean) { this.active = active; if (!active) this.cancel(); }
  preservePaths(paths: readonly (string | null | undefined)[]) { this.preservedPaths = paths.filter((path): path is string => !!path).slice(0, 8); }
  focusPath(path: string) { this.focusedPath = path; }
  private pinned(): Set<string> {
    const result = new Set<string>();
    for (const path of [...this.preservedPaths, this.focusedPath]) if (path) {
      for (const parent of directoryAncestors(path)) if (parent) result.add(parent);
      result.add(path);
    }
    return result;
  }

  /** Bound filesystem work even when keyboard '*' expands many loaded folders. */
  private async scheduled<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    if (signal.aborted) throw cancelled();
    if (this.running >= 4 || this.waiters.length) await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { signal, start: () => { this.running += 1; signal.removeEventListener('abort', waiter.cancel); resolve(); },
        cancel: () => { this.waiters = this.waiters.filter(value => value !== waiter); reject(cancelled()); } };
      signal.addEventListener('abort', waiter.cancel, { once: true });
      this.waiters.push(waiter);
    }); else this.running += 1;
    try { if (signal.aborted) throw cancelled(); return await operation(); }
    finally { this.running -= 1; this.resumeQueue(); }
  }

  private resumeQueue() {
    while (this.running < 4 && this.waiters.length) {
      const next = this.waiters.shift()!;
      if (next.signal.aborted) { next.cancel(); continue; }
      next.start();
    }
  }

  private loading(path: string, enabled: boolean) {
    const loading = new Set(this.state.loading);
    if (enabled) loading.add(path); else loading.delete(path);
    this.emit({ ...this.state, loading });
  }

  private clearError(path: string) {
    if (!Object.hasOwn(this.state.errors, path)) return;
    const errors = { ...this.state.errors }; delete errors[path];
    this.emit({ ...this.state, errors });
  }

  cancel() {
    this.generation += 1;
    for (const request of this.requests.values()) request.controller.abort();
    for (const request of this.lookups.values()) request.controller.abort();
    for (const controller of this.inspections) controller.abort();
    this.requests.clear(); this.lookups.clear();
    this.inspections.clear();
    this.emit({ ...this.state, loading: new Set() });
  }

  reset() {
    this.cancel(); this.directoryRevisions.clear(); this.failedKinds.clear(); this.focusedPath = null; this.preservedPaths = [];
    this.emit(emptyState());
  }

  readonly loadDirectory = async (path: string, refresh = false): Promise<void> => {
    if (!this.available()) return;
    const pending = this.requests.get(path);
    if (pending) return pending.promise;
    if (!refresh && own(this.state.tree, path) && own(this.state.paging, path) && !own(this.state.paging, path)?.stale) return;
    return this.read(path, 'first', false);
  };

  readonly loadMore = async (path: string): Promise<void> => {
    if (!this.available()) return;
    const pending = this.requests.get(path);
    if (pending) return pending.promise;
    const paging = own(this.state.paging, path);
    if (paging?.stale) return this.read(path, 'first', true);
    if (!paging?.nextCursor) return;
    return this.read(path, 'more', false);
  };

  readonly retry = async (path: string): Promise<void> => {
    if (!this.available()) return;
    const pending = this.requests.get(path);
    if (pending) return pending.promise;
    const paging = own(this.state.paging, path);
    const failed = this.failedKinds.get(path);
    return this.read(path, failed === 'more' && paging?.nextCursor && !paging.stale ? 'more' : 'first', Boolean(paging?.stale) || !failed);
  };

  private read(path: string, kind: Request['kind'], reset: boolean): Promise<void> {
    const controller = new AbortController();
    const generation = this.generation;
    const before = own(this.state.paging, path);
    const request: Request = { controller, kind, promise: Promise.resolve() };
    this.requests.set(path, request);
    this.failedKinds.delete(path);
    const current = () => this.available() && !controller.signal.aborted && this.generation === generation && this.requests.get(path) === request;
    const cursor = kind === 'more' ? before?.nextCursor ?? undefined : undefined;
    const snapshot = kind === 'first' && !reset && !before?.stale ? before?.snapshot || undefined : undefined;
    this.loading(path, true); this.clearError(path);
    request.promise = (async () => {
      try {
        const page = await this.scheduled(controller.signal, () => this.options.page(path, { cursor, snapshot, signal: controller.signal }));
        if (!current()) return;
        if (!validPage(page, path) || (page.unchanged && page.snapshot !== snapshot)
          || (kind === 'more' && (page.unchanged || page.snapshot !== before?.snapshot))) {
          throw new Error('The server returned an unreadable folder page. Refresh this folder.');
        }
        if (page.unchanged) return;
        const oldEntries = own(this.state.tree, path) ?? [];
        const pins = this.pinned();
        const retained = kind === 'more' ? oldEntries : oldEntries.filter(entry => pins.has(entry.path));
        const entries = [...(kind === 'more' ? retained : page.entries)];
        const seen = new Set(entries.map(entry => entry.path));
        for (const entry of kind === 'more' ? page.entries : retained) if (!seen.has(entry.path)) { entries.push(entry); seen.add(entry.path); }
        this.directoryRevisions.set(path, this.revision(path) + 1);
        this.emit({ ...this.state, tree: { ...this.state.tree, [path]: entries },
          paging: { ...this.state.paging, [path]: { snapshot: page.snapshot, nextCursor: page.nextCursor } } });
        // Revalidate only the few focused/active entries retained outside this page.
        // A deleted pinned file must not survive every periodic refresh forever.
        if (kind === 'first') {
          const pagePaths = new Set(page.entries.map(entry => entry.path));
          for (const pin of pins) if (parentPath(pin) === path && !pagePaths.has(pin)) void this.lookup(pin, true);
        }
      } catch (error) {
        if (!current()) return;
        this.failedKinds.set(path, kind);
        const stale = error instanceof ApiError && error.code === 'DIRECTORY_PAGE_STALE';
        const paging = own(this.state.paging, path);
        this.emit({ ...this.state, errors: { ...this.state.errors, [path]: message(error) },
          ...(stale && paging ? { paging: { ...this.state.paging, [path]: { ...paging, stale: true } } } : {}) });
      } finally {
        if (current()) { this.requests.delete(path); this.loading(path, false); }
      }
    })();
    return request.promise;
  }

  private async lookup(path: string, force = false, attempt = 0): Promise<void> {
    if (!this.available()) return;
    const directory = parentPath(path);
    if (!force && own(this.state.tree, directory)?.some(entry => entry.path === path)) return;
    const pending = this.lookups.get(path);
    if (pending) {
      if (!force) return pending.promise;
      pending.controller.abort(); this.lookups.delete(path);
    }
    const controller = new AbortController();
    const generation = this.generation;
    const revision = this.revision(directory);
    const request = { controller, promise: Promise.resolve() };
    this.lookups.set(path, request);
    const sameScope = () => this.available() && !controller.signal.aborted && this.generation === generation && this.lookups.get(path) === request;
    const current = () => sameScope() && revision === this.revision(directory);
    request.promise = (async () => {
      let refreshLookup = false;
      try {
        const entry = await this.scheduled(controller.signal, () => this.options.entry(path, controller.signal));
        if (!current()) { refreshLookup = sameScope() && attempt < 2; return; }
        if (!validEntry(entry, directory) || entry.path !== path) throw new Error('The requested file could not be revealed.');
        const entries = [...(own(this.state.tree, directory) ?? [])];
        const index = entries.findIndex(item => item.path === path);
        if (index === -1) entries.push(entry); else entries[index] = entry;
        this.emit({ ...this.state, tree: { ...this.state.tree, [directory]: entries } });
      } catch (error) {
        if (!current()) { refreshLookup = sameScope() && attempt < 2; return; }
        if (error instanceof ApiError && error.status === 404) {
          const entries = own(this.state.tree, directory);
          if (entries?.some(entry => entry.path === path)) this.emit({ ...this.state, tree: { ...this.state.tree, [directory]: entries.filter(entry => entry.path !== path) } });
        } else this.emit({ ...this.state, errors: { ...this.state.errors, [directory]: message(error) } });
      } finally {
        if (this.lookups.get(path) === request) this.lookups.delete(path);
        if (refreshLookup) await this.lookup(path, true, attempt + 1);
      }
    })();
    return request.promise;
  }

  /** Reveal a known path directly; never chase cursors until it happens to appear. */
  readonly revealPath = async (path: string): Promise<void> => {
    if (!this.available() || !path || path.length > 4096 || path.split('/').length > 128) return;
    const generation = this.generation;
    const directories = directoryAncestors(path);
    await Promise.all(directories.map(async directory => {
      await this.loadDirectory(directory);
      if (!this.available() || this.generation !== generation) return;
      const next = directory ? path.slice(directory.length + 1).split('/')[0] : path.split('/')[0];
      await this.lookup(directory ? `${directory}/${next}` : next);
    }));
  };

  /**
   * Resolve an explicit Inspect target without opening a document. Cached rows
   * never prove existence: verify the exact entry, load bounded ancestor pages,
   * and verify again before publishing the row to be selected by the caller.
   */
  readonly revealEntry = async (path: string, signal?: AbortSignal): Promise<FileEntry | null> => {
    if (!path || path.length > 4096 || path.split('/').length > 128 || /^[a-z]:/i.test(path)
      || /[\\\u0000-\u001f\u007f]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..' || part === '.git' || part.startsWith('.codex-write-'))) {
      throw new ApiError('Choose a file or folder inside this workspace.', 400, 'INVALID_PATH');
    }
    if (!this.available() || signal?.aborted) throw cancelled();
    const controller = new AbortController();
    const generation = this.generation;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    this.inspections.add(controller);
    const current = () => this.available() && !controller.signal.aborted && generation === this.generation;
    const check = () => { if (!current()) throw cancelled(); };
    const wait = <T>(promise: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
      const stop = () => reject(cancelled());
      controller.signal.addEventListener('abort', stop, { once: true });
      if (controller.signal.aborted) stop();
      promise.then(value => { controller.signal.removeEventListener('abort', stop); resolve(value); },
        error => { controller.signal.removeEventListener('abort', stop); reject(error); });
    });
    const readEntry = async (target: string) => {
      check();
      const result = await wait(this.scheduled(controller.signal, () => this.options.entry(target, controller.signal)));
      check();
      if (!validEntry(result, parentPath(target)) || result.path !== target) throw new Error('The server returned an unreadable file or folder.');
      return result;
    };
    try {
      await readEntry(path);
      const ancestors: FileEntry[] = [];
      for (const directory of directoryAncestors(path)) {
        check();
        // A shared page request may finish for another visible consumer; an
        // aborted Inspect starts no further ancestor work and cannot publish rows.
        await wait(this.loadDirectory(directory, Boolean(own(this.state.errors, directory))));
        check();
        const error = own(this.state.errors, directory);
        if (error) throw new Error(error);
        const next = directory ? path.slice(directory.length + 1).split('/')[0] : path.split('/')[0];
        const childPath = directory ? `${directory}/${next}` : next;
        if (childPath === path) continue;
        const cached = own(this.state.tree, directory)?.find(entry => entry.path === childPath);
        const child = cached?.kind === 'directory' && !cached.isSymlink ? cached : await readEntry(childPath);
        if (child.kind !== 'directory' || child.isSymlink) throw new ApiError('Choose a path without symbolic links in its parent folders.', 403, 'UNSAFE_PATH');
        ancestors.push(child);
      }
      const entry = await readEntry(path);
      check();
      const tree = { ...this.state.tree };
      for (const item of [...ancestors, entry]) {
        const directory = parentPath(item.path);
        const entries = [...(own(tree, directory) ?? [])];
        const index = entries.findIndex(previous => previous.path === item.path);
        if (index === -1) entries.push(item); else entries[index] = item;
        tree[directory] = entries;
      }
      this.emit({ ...this.state, tree });
      return entry;
    } catch (error) {
      check();
      if (error instanceof ApiError && error.status === 404 && error.code === 'FILE_NOT_FOUND') {
        const directory = parentPath(path);
        const entries = own(this.state.tree, directory);
        if (entries?.some(entry => entry.path === path)) this.emit({ ...this.state, tree: { ...this.state.tree, [directory]: entries.filter(entry => entry.path !== path) } });
        return null;
      }
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
      this.inspections.delete(controller);
    }
  };

  /** Keep loaded subtree rows while invalidating cursors bound to the old names. */
  remapMovedEntry(entry: FileEntry, newPath: string) {
    this.cancel();
    const oldPath = entry.path;
    const remap = (value: string) => within(value, oldPath) ? newPath + value.slice(oldPath.length) : value;
    const tree: Record<string, FileEntry[]> = Object.fromEntries(Object.entries(this.state.tree).map(([directory, entries]) => [remap(directory), entries
      .filter(child => child.path !== oldPath).map(child => within(child.path, oldPath) ? { ...child, path: remap(child.path), name: remap(child.path).split('/').at(-1)! } : child)]));
    const parent = parentPath(newPath);
    if (Object.hasOwn(tree, parent)) tree[parent] = [...tree[parent].filter(child => child.path !== newPath), { ...entry, path: newPath, name: newPath.split('/').at(-1)! }];
    const paging: Record<string, DirectoryPagingState> = Object.fromEntries(Object.entries(this.state.paging).map(([directory, value]) => {
      const changed = within(directory, oldPath) || directory === parentPath(oldPath) || directory === parent;
      return [remap(directory), changed ? { ...value, nextCursor: null, snapshot: '', stale: true } : value];
    }));
    this.directoryRevisions.clear();
    this.failedKinds = new Map([...this.failedKinds].map(([directory, kind]) => [remap(directory), kind]));
    this.preservedPaths = this.preservedPaths.map(remap);
    if (this.focusedPath) this.focusedPath = remap(this.focusedPath);
    this.emit({ ...this.state, tree, paging, errors: Object.fromEntries(Object.entries(this.state.errors).map(([directory, value]) => [remap(directory), value])) });
  }
}
