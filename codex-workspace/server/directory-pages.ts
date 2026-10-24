import { createHmac, randomBytes } from 'node:crypto';
import nativeFs, { constants, type BigIntStats, type Dir, type Dirent, type FSWatcher } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import type { FileEntry } from '../shared/types';
import type { AppContext } from './context';
import { HttpError } from './errors';

export const DIRECTORY_PAGE_SIZE = 100;
export const MAX_DIRECTORY_PAGE_SIZE = 200;
export interface DirectoryPage {
  path: string;
  entries: FileEntry[];
  nextCursor: string | null;
  snapshot: string;
  order: 'filesystem';
  unchanged?: true;
}
const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const CURSOR_PATTERN = /^[a-zA-Z0-9_-]{32}$/;
const SNAPSHOT_PATTERN = /^[a-zA-Z0-9_-]{43}$/;
const nameCollator = new Intl.Collator(undefined, { numeric: true });

interface BoundDirectory { handle: FileHandle; absolute: string; stat: BigIntStats }
interface PageInput { path?: string; cursor?: string; limit?: number; snapshot?: string }
type DirectoryContext = Pick<AppContext, 'workspaces'> & Partial<Pick<AppContext, 'events'>>;
interface Lease {
  id: string;
  workspaceId: string;
  path: string;
  limit: number;
  snapshot: string;
  fingerprint: string;
  invalidated: boolean;
  watcher?: FSWatcher;
  directory: BoundDirectory;
  iterator?: Dir;
  pending?: Dirent;
  nextCursor: string | null;
  previousCursor?: string;
  previousPage?: DirectoryPage;
  inFlight?: { cursor: string; result: Promise<DirectoryPage> };
  preparing?: boolean;
  touched: number;
  closed: boolean;
}

function relativePath(input: unknown, allowRoot = true): string {
  if (typeof input !== 'string' || input.length > 4096 || /[\\\u0000-\u001f\u007f]/.test(input)
    || path.posix.isAbsolute(input) || /^[a-z]:/i.test(input)) {
    throw new HttpError(400, 'Use a relative path inside this workspace.', 'INVALID_PATH');
  }
  const parts = input ? input.split('/') : [];
  if ((!allowRoot && !parts.length) || parts.length > 128
    || parts.some(part => !part || part === '.' || part === '..' || Buffer.byteLength(part) > 255
      || part === '.git' || part.startsWith('.codex-write-'))) {
    throw new HttpError(400, 'Choose a file or folder inside this workspace.', 'INVALID_PATH');
  }
  return input;
}

function stale(): HttpError {
  return new HttpError(409, 'This folder changed or its page expired. Refresh the folder to continue.', 'DIRECTORY_PAGE_STALE');
}

function filesystemError(error: unknown): never {
  if (error instanceof HttpError) throw error;
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT') throw new HttpError(404, 'File or folder not found.', 'FILE_NOT_FOUND');
  if (code === 'ELOOP' || code === 'ENOTDIR') throw new HttpError(403, 'Choose a real folder without symbolic links in its path.', 'UNSAFE_PATH');
  if (code === 'EACCES' || code === 'EPERM') throw new HttpError(403, 'This folder is not readable by the workspace.', 'DIRECTORY_UNREADABLE');
  throw new HttpError(503, 'The folder could not be read. Retry when storage is available.', 'DIRECTORY_READ_FAILED');
}

/**
 * Walk already-open directory descriptors, as the download/transfer services do.
 * These are ordinary Linux /proc paths; no mounts or sandbox processes are used.
 * O_NOFOLLOW on every component prevents an ancestor replacement from redirecting
 * enumeration outside the validated workspace.
 */
async function openAbsoluteDirectory(absolute: string): Promise<BoundDirectory> {
  let handle: FileHandle | undefined;
  try {
    handle = await fs.open('/', DIRECTORY_FLAGS);
    for (const part of absolute.split(path.sep).filter(Boolean)) {
      const next = await fs.open(`/proc/self/fd/${handle.fd}/${part}`, DIRECTORY_FLAGS);
      await handle.close();
      handle = next;
    }
    return { handle, absolute, stat: await handle.stat({ bigint: true }) };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    return filesystemError(error);
  }
}

function entryFromDirent(relative: string, child: Dirent): FileEntry | undefined {
  if (child.name === '.git' || child.name.startsWith('.codex-write-') || /[\\\u0000-\u001f\u007f]/.test(child.name)) return;
  if (!child.isDirectory() && !child.isFile() && !child.isSymbolicLink()) return;
  // Symlinks are visible but never followed while enumerating or identifying a drop target.
  return { name: child.name, path: relative ? `${relative}/${child.name}` : child.name,
    kind: child.isDirectory() ? 'directory' : 'file', ...(child.isSymbolicLink() ? { isSymlink: true } : {}) };
}

function compareEntries(left: FileEntry, right: FileEntry): number {
  return left.kind !== right.kind ? (left.kind === 'directory' ? -1 : 1) : nameCollator.compare(left.name, right.name);
}

/** A bounded collection of forward-only native directory streams, never a full-directory index. */
export class DirectoryPageService {
  private readonly secret = randomBytes(32);
  private readonly leases = new Map<string, Lease>();
  private readonly cursors = new Map<string, Lease>();
  private readonly snapshots = new Map<string, Lease>();
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly idleMs: number;
  private readonly maxLeases: number;
  private readonly now: () => number;
  private active = 0;
  private readonly pendingOperations = new Set<Promise<unknown>>();
  private closed = false;

  constructor(private readonly ctx: DirectoryContext, options: { idleMs?: number; maxLeases?: number; now?: () => number } = {}) {
    this.idleMs = options.idleMs ?? 5 * 60_000;
    this.maxLeases = options.maxLeases ?? 64;
    this.now = options.now ?? Date.now;
    this.timer = setInterval(() => { void this.cleanup(); }, Math.min(this.idleMs, 30_000));
    this.timer.unref();
    ctx.events?.on('workspace:changed', this.onWorkspaceMutation);
    ctx.events?.on('workspace:manual-intent', this.onWorkspaceMutation);
  }

  private readonly onWorkspaceMutation = (event: unknown): void => {
    if (!event || typeof event !== 'object' || !('workspaceId' in event) || typeof event.workspaceId !== 'string') return;
    // Intent starts and ends both invalidate: a lease may have been opened while
    // a longer import/move was running. No per-file or unbounded mutation log.
    for (const lease of this.leases.values()) if (lease.workspaceId === event.workspaceId) lease.invalidated = true;
  };

  private fingerprint(workspaceId: string, relative: string, stat: BigIntStats): string {
    return createHmac('sha256', this.secret)
      .update(JSON.stringify([workspaceId, relative, stat.dev.toString(), stat.ino.toString(), stat.mtimeNs.toString(), stat.ctimeNs.toString(),
        stat.birthtimeNs.toString(), stat.size.toString(), stat.nlink.toString(), stat.mode.toString()]))
      .digest('base64url');
  }

  private observe(lease: Lease): void {
    try {
      // Watch the pinned inode, not a path that can be swapped for a symlink.
      // Kernel notifications catch local changes even when mtime/ctime repeat.
      const watcher = nativeFs.watch(`/proc/self/fd/${lease.directory.handle.fd}`, { persistent: false }, () => { lease.invalidated = true; });
      lease.watcher = watcher;
      watcher.on('error', () => { lease.invalidated = true; });
      watcher.on('close', () => { if (!lease.closed) lease.invalidated = true; });
    } catch {
      // Some remote filesystems do not support native watching. Metadata and app
      // mutation signals still apply; an external change that exposes neither
      // cannot be detected without a full scan or a filesystem snapshot.
    }
  }

  private async directory(workspaceId: string, relative: string): Promise<BoundDirectory> {
    // Resolve through the authoritative service for registration/archive checks,
    // then require the lexical path and bind each component without following links.
    const root = await this.ctx.workspaces.resolvePath(workspaceId, '');
    const absolute = await this.ctx.workspaces.resolvePath(workspaceId, relative);
    if (absolute !== path.join(root, relative)) throw new HttpError(403, 'Choose a folder without symbolic links in its path.', 'UNSAFE_PATH');
    return openAbsoluteDirectory(absolute);
  }

  private async admit<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) throw new HttpError(503, 'Directory paging is restarting. Retry shortly.', 'DIRECTORY_READ_FAILED');
    if (this.active >= 16) throw new HttpError(429, 'Several folders are loading. Retry this folder shortly.', 'DIRECTORY_READ_BUSY');
    this.active += 1;
    const pending = operation();
    this.pendingOperations.add(pending);
    try { return await pending; }
    catch (error) { return filesystemError(error); }
    finally { this.active -= 1; this.pendingOperations.delete(pending); }
  }

  private async closeStream(lease: Lease): Promise<void> {
    const iterator = lease.iterator;
    lease.iterator = undefined;
    await iterator?.close().catch(() => undefined);
    await lease.directory.handle.close().catch(() => undefined);
  }

  private async discard(lease: Lease): Promise<void> {
    if (lease.closed) return;
    lease.closed = true;
    this.leases.delete(lease.id);
    this.snapshots.delete(lease.snapshot);
    lease.watcher?.close();
    lease.watcher = undefined;
    if (lease.nextCursor) this.cursors.delete(lease.nextCursor);
    if (lease.previousCursor) this.cursors.delete(lease.previousCursor);
    await this.closeStream(lease);
  }

  async cleanup(): Promise<void> {
    const cutoff = this.now() - this.idleMs;
    for (const lease of this.leases.values()) {
      if (!lease.inFlight && !lease.preparing && lease.touched < cutoff) await this.discard(lease);
    }
  }

  private async reserve(lease: Lease): Promise<void> {
    await this.cleanup();
    while (this.leases.size >= this.maxLeases) {
      const victim = [...this.leases.values()].filter(item => !item.inFlight && !item.preparing).sort((a, b) => a.touched - b.touched)[0];
      if (!victim) throw new HttpError(429, 'Several folders are loading. Retry this folder shortly.', 'DIRECTORY_READ_BUSY');
      await this.discard(victim);
    }
    this.leases.set(lease.id, lease);
    this.snapshots.set(lease.snapshot, lease);
  }

  private async validate(lease: Lease): Promise<void> {
    if (lease.closed || lease.invalidated || this.now() - lease.touched > this.idleMs) { await this.discard(lease); throw stale(); }
    let current: BoundDirectory | undefined;
    try {
      current = await this.directory(lease.workspaceId, lease.path);
      // Allow already queued native notifications through the event loop before
      // trusting metadata. This is not a delay to wait for a timestamp tick.
      await new Promise<void>(resolve => setImmediate(resolve));
      if (lease.closed || lease.invalidated || this.fingerprint(lease.workspaceId, lease.path, current.stat) !== lease.fingerprint) throw stale();
    } catch (error) {
      await this.discard(lease);
      if (error instanceof HttpError && error.code === 'WORKSPACE_NOT_FOUND') throw error;
      throw stale();
    } finally { await current?.handle.close().catch(() => undefined); }
    if (lease.closed || lease.invalidated) { await this.discard(lease); throw stale(); }
  }

  async read(workspaceId: string, input: PageInput = {}): Promise<DirectoryPage> {
    const relative = relativePath(input.path ?? '');
    const limit = input.limit ?? DIRECTORY_PAGE_SIZE;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_DIRECTORY_PAGE_SIZE) {
      throw new HttpError(400, `Choose a page size between 1 and ${MAX_DIRECTORY_PAGE_SIZE}.`, 'INVALID_DIRECTORY_PAGE');
    }
    if ((input.cursor !== undefined && !CURSOR_PATTERN.test(input.cursor))
      || (input.snapshot !== undefined && !SNAPSHOT_PATTERN.test(input.snapshot)) || (input.cursor && input.snapshot)) {
      throw new HttpError(400, 'The directory page request is invalid.', 'INVALID_DIRECTORY_PAGE');
    }
    return this.admit(async () => {
      if (input.cursor) {
        const lease = this.cursors.get(input.cursor);
        if (!lease || lease.workspaceId !== workspaceId || lease.path !== relative || lease.limit !== limit) throw stale();
        if (lease.inFlight?.cursor === input.cursor) return lease.inFlight.result;
        if (lease.inFlight) throw new HttpError(409, 'This folder page is already loading. Retry shortly.', 'DIRECTORY_PAGE_BUSY');
        if (lease.previousCursor === input.cursor && lease.previousPage) {
          await this.validate(lease);
          lease.touched = this.now();
          return lease.previousPage;
        }
        if (lease.nextCursor !== input.cursor) throw stale();
        const result = this.advance(lease, input.cursor);
        lease.inFlight = { cursor: input.cursor, result };
        try { return await result; }
        finally { lease.inFlight = undefined; }
      }

      if (input.snapshot) {
        const previous = this.snapshots.get(input.snapshot);
        if (previous && previous.workspaceId === workspaceId && previous.path === relative && previous.limit === limit) {
          try {
            // Do not close a stream from an overlapping conditional probe while
            // a continuation is still reading it.
            if (previous.inFlight) await previous.inFlight.result;
            await this.validate(previous);
            previous.touched = this.now();
            return { path: relative, entries: [], nextCursor: null, snapshot: previous.snapshot, order: 'filesystem', unchanged: true };
          } catch (error) {
            if (!(error instanceof HttpError) || error.code !== 'DIRECTORY_PAGE_STALE') throw error;
            // Invalidated/expired snapshots always get a new nonce, even if the
            // filesystem reports exactly the same timestamp tuple again.
          }
        }
      }
      const directory = await this.directory(workspaceId, relative);
      const id = randomBytes(24).toString('base64url');
      const fingerprint = this.fingerprint(workspaceId, relative, directory.stat);
      const snapshot = createHmac('sha256', this.secret).update(id).update(fingerprint).digest('base64url');
      const lease: Lease = { id, workspaceId, path: relative, limit, snapshot, fingerprint, invalidated: false,
        directory, nextCursor: null, touched: this.now(), closed: false, preparing: true };
      try {
        await this.reserve(lease);
        this.observe(lease);
        lease.iterator = await fs.opendir(`/proc/self/fd/${directory.handle.fd}`, { bufferSize: 32 });
        const result = this.advance(lease);
        lease.inFlight = { cursor: '', result };
        lease.preparing = false;
        try { return await result; }
        finally { lease.inFlight = undefined; }
      } catch (error) { await this.discard(lease); throw error; }
    });
  }

  private async advance(lease: Lease, cursor?: string): Promise<DirectoryPage> {
    try {
      await this.validate(lease);
      if (!lease.iterator) throw stale();
      const entries: FileEntry[] = [];
      let ended = false;
      // Filtering reserved/special entries must not turn one request into a full scan.
      // The native iterator has a 32-entry buffer and at most 4*limit+1 reads per page.
      for (let scanned = 0; scanned < lease.limit * 4 && entries.length < lease.limit; scanned += 1) {
        const child = lease.pending ?? await lease.iterator.read();
        lease.pending = undefined;
        if (!child) { ended = true; break; }
        const entry = entryFromDirent(lease.path, child);
        if (entry) entries.push(entry);
      }
      if (!ended) {
        const next = await lease.iterator.read();
        if (next) lease.pending = next;
        else ended = true;
      }
      await this.validate(lease);
      entries.sort(compareEntries);
      const nextCursor = ended ? null : randomBytes(24).toString('base64url');
      const page: DirectoryPage = { path: lease.path, entries, nextCursor, snapshot: lease.snapshot, order: 'filesystem' };
      if (lease.previousCursor) this.cursors.delete(lease.previousCursor);
      if (lease.nextCursor) this.cursors.delete(lease.nextCursor);
      lease.nextCursor = nextCursor;
      lease.previousCursor = cursor;
      lease.previousPage = cursor ? page : undefined;
      lease.touched = this.now();
      if (cursor) this.cursors.set(cursor, lease);
      if (nextCursor) this.cursors.set(nextCursor, lease);
      if (ended) {
        await this.closeStream(lease);
        // Completed small folders retain only their bounded snapshot/watch lease
        // so an unchanged probe cannot miss a same-tick native mutation.
      }
      if (lease.invalidated) { await this.discard(lease); throw stale(); }
      return page;
    } catch (error) { await this.discard(lease); throw error; }
  }

  /** Direct lookup supports reveal and upload collision checks without walking pages. */
  async entry(workspaceId: string, input: string): Promise<FileEntry> {
    const relative = relativePath(input, false);
    const parent = path.posix.dirname(relative);
    const name = path.posix.basename(relative);
    return this.admit(async () => {
      const directory = await this.directory(workspaceId, parent === '.' ? '' : parent);
      try {
        const stat = await fs.lstat(`/proc/self/fd/${directory.handle.fd}/${name}`);
        if (!stat.isFile() && !stat.isDirectory() && !stat.isSymbolicLink()) throw new HttpError(400, 'This entry is not a file or folder.', 'INVALID_FILE_TYPE');
        // Check the parent after lookup too, so a renamed/replaced folder cannot
        // disclose a stale result under its previous workspace-relative name.
        const current = await this.directory(workspaceId, parent === '.' ? '' : parent);
        try { if (current.stat.dev !== directory.stat.dev || current.stat.ino !== directory.stat.ino) throw stale(); }
        finally { await current.handle.close(); }
        return { name, path: relative, kind: stat.isDirectory() ? 'directory' : 'file', size: stat.size,
          modifiedAt: stat.mtime.toISOString(), ...(stat.isSymbolicLink() ? { isSymlink: true } : {}) };
      } finally { await directory.handle.close(); }
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.timer);
    this.ctx.events?.off('workspace:changed', this.onWorkspaceMutation);
    this.ctx.events?.off('workspace:manual-intent', this.onWorkspaceMutation);
    // Active reads finish before their descriptors are closed.
    await Promise.allSettled([...this.pendingOperations]);
    await Promise.all([...this.leases.values()].map(lease => this.discard(lease)));
  }
}

const services = new WeakMap<AppContext, DirectoryPageService>();
function serviceFor(ctx: AppContext): DirectoryPageService {
  let service = services.get(ctx);
  if (!service) { service = new DirectoryPageService(ctx); services.set(ctx, service); }
  return service;
}

function queryValue(value: unknown): string | undefined {
  if (value === undefined) return;
  if (typeof value !== 'string') throw new HttpError(400, 'Use one value for each directory query parameter.', 'INVALID_DIRECTORY_PAGE');
  return value;
}

export function createDirectoryPagesRouter(ctx: AppContext): Router {
  const router = Router();
  const service = serviceFor(ctx);
  router.get('/workspaces/:id/tree-page', async (req, res) => {
    const value = queryValue(req.query.limit);
    if (value !== undefined && !/^[1-9]\d{0,2}$/.test(value)) throw new HttpError(400, 'The directory page size is invalid.', 'INVALID_DIRECTORY_PAGE');
    res.setHeader('Cache-Control', 'no-store');
    res.json(await service.read(req.params.id, { path: queryValue(req.query.path), cursor: queryValue(req.query.cursor),
      snapshot: queryValue(req.query.snapshot), limit: value === undefined ? undefined : Number(value) }));
  });
  router.get('/workspaces/:id/tree-entry', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await service.entry(req.params.id, queryValue(req.query.path) ?? ''));
  });
  return router;
}

export async function closeDirectoryPages(ctx: AppContext): Promise<void> {
  const service = services.get(ctx);
  services.delete(ctx);
  await service?.close();
}
