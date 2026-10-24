import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { promises as fs, type Dir, type Dirent, type BigIntStats } from 'node:fs';
import path from 'node:path';
import type { TrashEntry } from './workspaces';
import { HttpError } from './errors';
import { errno, PinnedDirectory, readText } from './workspace-trash/filesystem';
import { TRASH_ID, TRASH_RETENTION_MS } from './workspace-trash/records';

export interface FileTrashPageInput { limit?: number; cursor?: string; q?: string }
export interface FileTrashPage {
  items: TrashEntry[];
  previousCursor: string | null;
  nextCursor: string | null;
  hasMore: boolean;
  scanned: number;
  unavailable: number;
  order: 'filesystem';
}

export const FILE_TRASH_SCAN_LIMIT = 100;
export const FILE_TRASH_PAGE_BYTES = 256 * 1024;
export const FILE_TRASH_CACHE_BYTES = 4 * 1024 * 1024;
export const FILE_TRASH_CURSOR_IDLE_MS = 2 * 60 * 1000;
const MAX_SESSIONS = 8;
const MAX_REPLAY_PAGES = 8;
const MAX_REQUESTS = 8;
const MAX_METADATA_BYTES = 32 * 1024;
const READ_BUDGET_MS = 15_000;

const invalidPage = () => new HttpError(400, 'Use a file-trash page size from 1 to 50 and a readable search of at most 160 characters.', 'INVALID_FILE_TRASH_PAGE');
const invalidCursor = () => new HttpError(400, 'This trash page does not match the selected workspace or search. Start from the first page.', 'INVALID_FILE_TRASH_CURSOR');
const expiredCursor = () => new HttpError(409, 'This trash page is no longer available. Start from the first page.', 'FILE_TRASH_CURSOR_EXPIRED');
const staleCursor = () => new HttpError(409, 'The file trash changed. Start from the first page to see its current entries.', 'FILE_TRASH_CURSOR_STALE');
const unavailable = () => new HttpError(503, 'File trash could not be read safely. Its contents were retained; try again.', 'FILE_TRASH_UNAVAILABLE');
const busy = () => new HttpError(503, 'Too many file-trash pages are loading. Try again shortly.', 'FILE_TRASH_PAGE_BUSY');
const missing = () => new HttpError(404, 'The trash entry could not be found.', 'FILE_TRASH_NOT_FOUND');

export function validFileTrashId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !TRASH_ID.test(id)) throw new HttpError(400, 'Invalid trash entry.', 'INVALID_FILE_TRASH_ID');
}

/** Read exactly one UUID entry without enumeration or following any entry/metadata link. */
export async function readFileTrashEntry(root: PinnedDirectory, id: string, validatePath: (value: unknown) => string): Promise<TrashEntry> {
  validFileTrashId(id);
  let entry: PinnedDirectory | undefined;
  try {
    await root.check();
    entry = await PinnedDirectory.open(path.join(root.absolute, id), `${root.access}/${id}`);
    await root.check(); await entry.check();
    const raw = JSON.parse(await readText(`${entry.access}/metadata.json`, MAX_METADATA_BYTES)) as Partial<TrashEntry> | null;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.id !== id
      || raw.kind !== 'file' && raw.kind !== 'directory' || typeof raw.deletedAt !== 'string' || raw.deletedAt.length > 64
      || !Number.isFinite(Date.parse(raw.deletedAt))) throw new HttpError(409, 'The saved trash entry metadata is invalid. Its files were retained.', 'FILE_TRASH_INVALID');
    const relative = validatePath(raw.path);
    const content = await fs.lstat(`${entry.access}/content`);
    if (raw.kind === 'directory' ? !content.isDirectory() || content.isSymbolicLink() : !content.isFile() && !content.isSymbolicLink()) {
      throw new HttpError(409, 'The saved trash content no longer matches its metadata. It was retained for inspection.', 'FILE_TRASH_INVALID');
    }
    const expiry = Date.parse(raw.deletedAt) + TRASH_RETENTION_MS;
    if (!Number.isFinite(expiry) || Number.isNaN(new Date(expiry).getTime())) throw new HttpError(409, 'The saved trash entry date is invalid.', 'FILE_TRASH_INVALID');
    await entry.check(); await root.check();
    return { id, path: relative, kind: raw.kind as TrashEntry['kind'], deletedAt: raw.deletedAt, expiresAt: new Date(expiry).toISOString() };
  } catch (error) {
    if (errno(error, 'ENOENT')) throw missing();
    if (error instanceof SyntaxError) throw new HttpError(409, 'The saved trash entry metadata is invalid. Its files were retained.', 'FILE_TRASH_INVALID');
    throw error;
  } finally { await entry?.close(); }
}

export async function getFileTrashEntry(directory: string, id: string, validatePath: (value: unknown) => string): Promise<TrashEntry> {
  validFileTrashId(id);
  const root = await PinnedDirectory.open(directory);
  try { return await readFileTrashEntry(root, id, validatePath); }
  finally { await root.close(); }
}

/** Compatibility callers get a complete small list or an explicit limit error,
 * never a truncated history that doubles as an authorization/restore lookup. */
export async function legacyFileTrashList(directory: string, validatePath: (value: unknown) => string): Promise<TrashEntry[]> {
  const root = await PinnedDirectory.open(directory);
  const entries: TrashEntry[] = [];
  let scanned = 0, bytes = 0;
  const pageRequired = () => new HttpError(413, 'This file trash is too large for the legacy list. Use the paged Recently deleted view.', 'FILE_TRASH_PAGE_REQUIRED');
  try {
    const iterator = await fs.opendir(root.access, { bufferSize: 32 });
    for await (const child of iterator) {
      if (++scanned > 5000) throw pageRequired();
      if (!TRASH_ID.test(child.name)) continue;
      let entry: TrashEntry;
      try { entry = await readFileTrashEntry(root, child.name, validatePath); }
      catch { continue; }
      bytes += Buffer.byteLength(JSON.stringify(entry)) + 1;
      if (bytes > 2 * 1024 * 1024) throw pageRequired();
      entries.push(entry);
    }
    await root.check();
    return entries.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  } finally { await root.close(); }
}

export function fileTrashPageInput(input: Record<string, unknown>): FileTrashPageInput {
  if (Object.keys(input).some(key => !['limit', 'cursor', 'q'].includes(key))
    || Object.values(input).some(value => typeof value !== 'string')) throw invalidPage();
  const limit = input.limit === undefined ? 25 : typeof input.limit === 'string' && /^[1-9][0-9]?$/.test(input.limit) ? Number(input.limit) : NaN;
  const result = { limit, cursor: input.cursor as string | undefined, q: input.q as string | undefined };
  checkedInput(result);
  return result;
}

function checkedInput(input: FileTrashPageInput): { limit: number; cursor?: string; q: string } {
  const limit = input.limit ?? 25;
  const q = input.q ?? '';
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || typeof q !== 'string' || q.length > 160 || /[\u0000-\u001f\u007f]/.test(q)
    || input.cursor !== undefined && (typeof input.cursor !== 'string' || !input.cursor || input.cursor.length > 1200)) throw invalidPage();
  return { limit, cursor: input.cursor, q: q.trim().toLowerCase() };
}

const fingerprint = (stat: BigIntStats) => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
const scopeFor = (workspaceId: string, limit: number, q: string) => createHash('sha256').update(JSON.stringify({ workspaceId, limit, q })).digest('base64url');
interface Cursor { version: 1; id: string; step: number; scope: string }
interface CachedPage { value: FileTrashPage; bytes: number; used: number }
interface CursorState {
  id: string;
  workspaceId: string;
  directory: string;
  scope: string;
  limit: number;
  q: string;
  version: string;
  root?: PinnedDirectory;
  iterator?: Dir;
  pending?: Dirent;
  nextStep: number;
  eof: boolean;
  stale: boolean;
  disposed: boolean;
  pins: number;
  touched: number;
  pages: Map<number, CachedPage>;
  queue: Promise<void>;
}

/** A bounded, context-owned native stream. No full history/index is built.
 * Replays cover only recent pages; the exact restore path always rereads its UUID. */
export class FileTrashPager {
  private readonly states = new Map<string, CursorState>();
  private readonly requests = new Map<string, Promise<FileTrashPage>>();
  private admission: Promise<void> = Promise.resolve();
  private cachedBytes = 0;
  private used = 0;
  private closing = false;
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly secret: string) {}

  private sign(encoded: string): string { return createHmac('sha256', this.secret).update('file-trash-page-v1\0').update(encoded).digest('base64url'); }
  private encode(state: CursorState, step: number): string {
    const encoded = Buffer.from(JSON.stringify({ version: 1, id: state.id, step, scope: state.scope })).toString('base64url');
    return `${encoded}.${this.sign(encoded)}`;
  }
  private decode(value: string, scope: string): Cursor {
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) throw invalidCursor();
    const [encoded, signature] = value.split('.');
    const expected = Buffer.from(this.sign(encoded)), supplied = Buffer.from(signature);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw invalidCursor();
    let cursor: Cursor;
    try { cursor = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Cursor; }
    catch { throw invalidCursor(); }
    if (!cursor || cursor.version !== 1 || typeof cursor.id !== 'string' || !/^[a-f0-9]{32}$/.test(cursor.id) || cursor.scope !== scope
      || !Number.isSafeInteger(cursor.step) || cursor.step < 0) throw invalidCursor();
    return cursor;
  }

  invalidate(workspaceId: string): void {
    for (const state of this.states.values()) if (state.workspaceId === workspaceId) state.stale = true;
  }

  private async releaseHandles(state: CursorState): Promise<void> {
    const iterator = state.iterator, root = state.root;
    state.iterator = undefined; state.root = undefined;
    await Promise.allSettled([iterator?.close(), root?.close()]);
  }

  private async dispose(state: CursorState): Promise<void> {
    if (state.disposed) return;
    state.disposed = true;
    this.states.delete(state.id);
    for (const cached of state.pages.values()) this.cachedBytes -= cached.bytes;
    state.pages.clear();
    await this.releaseHandles(state);
  }

  private async sweep(): Promise<void> {
    const now = Date.now();
    for (const state of this.states.values()) {
      if (!state.pins && (state.stale || now - state.touched >= FILE_TRASH_CURSOR_IDLE_MS)) await this.dispose(state);
    }
  }

  private async create(workspaceId: string, directory: string, scope: string, limit: number, q: string): Promise<CursorState> {
    const before = this.admission;
    let release!: () => void;
    this.admission = new Promise<void>(resolve => { release = resolve; });
    await before.catch(() => undefined);
    try {
      if (this.closing) throw unavailable();
      await this.sweep();
      while (this.states.size >= MAX_SESSIONS) {
        const oldest = [...this.states.values()].filter(state => !state.pins).sort((a, b) => a.touched - b.touched)[0];
        if (!oldest) throw busy();
        await this.dispose(oldest);
      }
      const root = await PinnedDirectory.open(directory);
      let iterator: Dir | undefined;
      try {
        const version = fingerprint(await root.handle.stat({ bigint: true }));
        iterator = await fs.opendir(root.access, { bufferSize: 32 });
        await root.check();
        if (fingerprint(await root.handle.stat({ bigint: true })) !== version) throw staleCursor();
        const state: CursorState = { id: randomUUID().replace(/-/g, ''), workspaceId, directory, scope, limit, q, version,
          root, iterator, nextStep: 0, eof: false, stale: false, disposed: false, pins: 1,
          touched: Date.now(), pages: new Map(), queue: Promise.resolve() };
        this.states.set(state.id, state);
        if (!this.timer) { this.timer = setInterval(() => { void this.sweep().catch(() => undefined); }, 15_000); this.timer.unref(); }
        return state;
      } catch (error) { await iterator?.close().catch(() => undefined); await root.close(); throw error; }
    } finally { release(); }
  }

  private async fresh(state: CursorState): Promise<void> {
    if (state.disposed) throw expiredCursor();
    if (state.stale) throw staleCursor();
    if (Date.now() - state.touched >= FILE_TRASH_CURSOR_IDLE_MS) throw expiredCursor();
    let temporary: PinnedDirectory | undefined;
    try {
      const root = state.root ?? (temporary = await PinnedDirectory.open(state.directory));
      await root.check();
      if (fingerprint(await root.handle.stat({ bigint: true })) !== state.version) throw staleCursor();
    } catch (error) {
      if (error instanceof HttpError || errno(error, 'ENOENT') || errno(error, 'ENOTDIR') || errno(error, 'ELOOP')) throw staleCursor();
      throw unavailable();
    } finally { await temporary?.close(); }
  }

  private remember(state: CursorState, step: number, value: FileTrashPage): void {
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (bytes > FILE_TRASH_PAGE_BYTES) throw new HttpError(413, 'This trash page exceeds its metadata limit.', 'FILE_TRASH_PAGE_LIMIT');
    state.pages.set(step, { value, bytes, used: ++this.used });
    this.cachedBytes += bytes;
    while (state.pages.size > MAX_REPLAY_PAGES) {
      const [oldStep, cached] = [...state.pages.entries()].sort((a, b) => a[1].used - b[1].used)[0];
      state.pages.delete(oldStep); this.cachedBytes -= cached.bytes;
    }
    while (this.cachedBytes > FILE_TRASH_CACHE_BYTES) {
      let oldest: { state: CursorState; step: number; page: CachedPage } | undefined;
      for (const candidate of this.states.values()) for (const [position, page] of candidate.pages) {
        if (!oldest || page.used < oldest.page.used) oldest = { state: candidate, step: position, page };
      }
      if (!oldest) break;
      oldest.state.pages.delete(oldest.step); this.cachedBytes -= oldest.page.bytes;
    }
  }

  private async scan(state: CursorState, step: number, validatePath: (value: unknown) => string): Promise<FileTrashPage> {
    await this.fresh(state);
    state.touched = Date.now();
    const cached = state.pages.get(step);
    if (cached) { cached.used = ++this.used; return structuredClone(cached.value); }
    if (step !== state.nextStep || state.eof || !state.root || !state.iterator) throw expiredCursor();
    const items: TrashEntry[] = [];
    let scanned = 0, unreadable = 0, bytes = 2048;
    const deadline = Date.now() + READ_BUDGET_MS;
    // Reserve one directory-name read for lookahead. Metadata reads never
    // exceed the scan budget, even for sparse searches or unreadable entries.
    while (scanned < FILE_TRASH_SCAN_LIMIT - 1 && items.length < state.limit && Date.now() < deadline) {
      const child = state.pending ?? await state.iterator.read();
      state.pending = undefined;
      if (!child) { state.eof = true; break; }
      scanned++;
      if (!TRASH_ID.test(child.name)) continue;
      let entry: TrashEntry;
      try { entry = await readFileTrashEntry(state.root, child.name, validatePath); }
      catch { unreadable++; continue; }
      if (state.q && !entry.path.toLowerCase().includes(state.q)) continue;
      const size = Buffer.byteLength(JSON.stringify(entry)) + 1;
      if (bytes + size > FILE_TRASH_PAGE_BYTES && items.length) { state.pending = child; break; }
      bytes += size; items.push(entry);
    }
    if (!state.eof && !state.pending) {
      state.pending = await state.iterator.read() ?? undefined;
      if (!state.pending) state.eof = true;
    }
    await this.fresh(state);
    const result: FileTrashPage = { items, previousCursor: step ? this.encode(state, step - 1) : null,
      nextCursor: state.eof ? null : this.encode(state, step + 1), hasMore: !state.eof,
      scanned, unavailable: unreadable, order: 'filesystem' };
    state.nextStep++;
    this.remember(state, step, result);
    if (state.eof) await this.releaseHandles(state);
    return structuredClone(result);
  }

  page(workspaceId: string, directory: string, input: FileTrashPageInput, validatePath: (value: unknown) => string): Promise<FileTrashPage> {
    if (this.closing) return Promise.reject(unavailable());
    const query = checkedInput(input);
    const scope = scopeFor(workspaceId, query.limit, query.q);
    const cursor = query.cursor ? this.decode(query.cursor, scope) : undefined;
    const key = `${scope}:${query.cursor ?? 'first'}`;
    const existing = this.requests.get(key);
    if (existing) return existing.then(value => structuredClone(value));
    if (this.requests.size >= MAX_REQUESTS) return Promise.reject(busy());
    const operation = async (): Promise<FileTrashPage> => {
      const state = cursor ? this.states.get(cursor.id) : await this.create(workspaceId, directory, scope, query.limit, query.q);
      if (!state) throw expiredCursor();
      if (state.scope !== scope || state.workspaceId !== workspaceId || state.directory !== directory) throw invalidCursor();
      if (cursor) state.pins++;
      const work = state.queue.catch(() => undefined).then(() => this.scan(state, cursor?.step ?? 0, validatePath));
      state.queue = work.then(() => undefined, () => undefined);
      try { return await work; }
      catch (error) {
        // A consumed native iterator cannot be rewound after a failed read.
        // Invalidate it visibly instead of skipping records on retry.
        await this.dispose(state);
        throw error;
      } finally { state.pins--; state.touched = Date.now(); }
    };
    const pending = operation();
    this.requests.set(key, pending);
    void pending.finally(() => { if (this.requests.get(key) === pending) this.requests.delete(key); }).catch(() => undefined);
    return pending.then(value => structuredClone(value));
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await Promise.allSettled([...this.requests.values()]);
    for (const state of this.states.values()) await this.dispose(state);
  }
}
