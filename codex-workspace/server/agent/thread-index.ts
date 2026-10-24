import fs from 'node:fs/promises';
import { constants, type BigIntStats, type Dirent } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { ThreadListPage, ThreadSummary } from '../../shared/types';
import type { AppContext } from '../context';
import { HttpError } from '../errors';
import { JsonStore } from '../store';
import type { ThreadContextMetadataRecoveryInput, ThreadContextMetadataRecoveryResult } from '../../shared/legacy-types';
import { THREAD_LIST_LIMITS, ThreadPageIndex, type ThreadIndexPageInput, type ThreadMetadataInput } from './thread-pages';

export type { ThreadIndexPageInput } from './thread-pages';

const validId = (value: unknown): value is string => typeof value === 'string' && /^thr_[a-f0-9]{32}$/.test(value);
const statuses = new Set(['idle', 'running', 'awaiting_approval', 'awaiting_input', 'compacting', 'error', 'interrupted']);
const summaryKey = (id: string) => `thread-summary-${id}`;
const deletedKey = (id: string) => `thread-deleted-${id}`;
const fullKey = (id: string) => `thread-${id}`;
// Independent indexes/stores in this process may share a state directory. The
// compatibility cache has one publication queue; per-thread records remain its
// authority, including when another process edits the same durable namespace.
const compatibilityPublications = new Map<string, Promise<void>>();
const fingerprint = (stat: BigIntStats) => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const date = (value: unknown): value is string => typeof value === 'string' && value.length >= 20 && value.length <= 40 && Number.isFinite(Date.parse(value));
const text = (value: unknown, max = 512): value is string => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
// Native filesystems can reuse timestamp values within a short write window.
// A fingerprint becomes reusable only after a read outside that window.
const settledVersion = (version: string) => {
  const ctime = BigInt(version.slice(version.lastIndexOf(':') + 1));
  return ctime > 0n && Number(ctime / 1_000_000n) < Date.now() - 2_000;
};

export interface ThreadIndexWarning { threadId?: string; code: string; message: string }
export interface ThreadIndexStatus { warnings: ThreadIndexWarning[]; repaired: number }
/** Limits also make recovery behavior testable without creating gigabytes of state. */
export interface ThreadIndexOptions {
  maxDirectoryEntries?: number;
  maxRepairsPerPass?: number;
  maxRepairBytesPerPass?: number;
  maxFullRecordBytes?: number;
  maxPageMetadataBytes?: number;
  /** Observe an existing bounded full-record recovery read after its matching
   * summary source is committed. Treat the detached record as read-only: copy
   * bounded metadata synchronously, do not retain it or request another history
   * read, and recheck this receipt before writing any derived state. */
  onReconciledRecord?: (record: unknown, readVersion: string) => void | Promise<void>;
}
interface Limits { entries: number; repairs: number; repairBytes: number; fullBytes: number }
interface SummaryRecord { version: 1; summary: ThreadSummary; source?: string }
interface Tombstone { version: 1; id: string; deletedAt: string }
type RecordKind = 'summary' | 'conversation' | 'deletion marker' | 'compatibility index';
type ReadResult = { kind: 'missing'; readBytes?: number } | { kind: 'invalid'; readBytes?: number } | { kind: 'value'; value: unknown; version: string; bytes: number; readBytes: number };
interface Inventory { full: Set<string>; summaries: Set<string>; deleted: Set<string>; unsafe: Set<string>; complete: boolean }

/** Copy only public summary fields. Conversations, model inputs and credentials
 * can never accidentally become part of the small enumeration records. */
function normalizeSummary(value: unknown, expectedId?: string): ThreadSummary | undefined {
  if (!object(value) || !validId(value.id) || expectedId && value.id !== expectedId
    || typeof value.workspaceId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,179}$/.test(value.workspaceId)
    || !text(value.title, 4_096) || !date(value.createdAt) || !date(value.updatedAt)
    || typeof value.status !== 'string' || !statuses.has(value.status)) return;
  const result: ThreadSummary = { id: value.id, workspaceId: value.workspaceId, title: value.title,
    createdAt: value.createdAt, updatedAt: value.updatedAt, status: value.status as ThreadSummary['status'] };
  for (const key of ['parentThreadId', 'rootThreadId'] as const) {
    if (value[key] !== undefined) { if (!validId(value[key])) return; result[key] = value[key]; }
  }
  for (const key of ['taskName', 'agentRole'] as const) {
    if (value[key] !== undefined) { if (!text(value[key])) return; result[key] = value[key]; }
  }
  if (value.archivedAt !== undefined) { if (!date(value.archivedAt)) return; result.archivedAt = value.archivedAt; }
  if (value.forkedFrom !== undefined) {
    const fork = value.forkedFrom;
    if (!object(fork) || !validId(fork.threadId) || fork.turnId !== undefined && (typeof fork.turnId !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(fork.turnId))) return;
    result.forkedFrom = { threadId: fork.threadId, ...(fork.turnId !== undefined ? { turnId: fork.turnId } : {}) };
  }
  return result;
}

/** Each identity owns its summary and permanent deletion marker. The historical
 * thread-index array is only a cache for older consumers: replacing it cannot
 * remove conversations or resurrect deleted ones. No history is merged/replayed. */
export class ThreadIndex {
  private readonly limits: Limits;
  private readonly onReconciledRecord?: ThreadIndexOptions['onReconciledRecord'];
  private readonly warnings = new Map<string, ThreadIndexWarning>();
  private readonly deleted = new Set<string>();
  private readonly attempted = new Map<string, string>();
  private readonly pendingStartup = new Set<string>();
  private readonly operations = new Map<string, Promise<unknown>>();
  private repaired = 0;
  private initialized?: Promise<void>;
  private refreshing?: Promise<ThreadSummary[]>;
  private scannedStartup = false;
  private compatibilityDirty = false;
  private readonly pages: ThreadPageIndex;
  private pageCacheError?: HttpError;
  private pageRecoveryPending = false;
  private pageMutation = 0;
  private readonly localPageChanges = new Map<string, { mutation: number; record?: SummaryRecord }>();
  private pageReconciledAt = -Infinity;
  private knownPageSummaries = new Set<string>();
  private knownPageFull = new Set<string>();
  private snapshotQueue: Promise<unknown> = Promise.resolve();
  private snapshotActive = false;

  constructor(private readonly ctx: AppContext, options: ThreadIndexOptions = {}) {
    const limit = (value: number | undefined, fallback: number) => Number.isSafeInteger(value) && value! > 0 ? value! : fallback;
    this.limits = { entries: limit(options.maxDirectoryEntries, 100_000), repairs: limit(options.maxRepairsPerPass, 64),
      repairBytes: limit(options.maxRepairBytesPerPass, 128 * 1024 * 1024), fullBytes: limit(options.maxFullRecordBytes, 32 * 1024 * 1024) };
    this.pages = new ThreadPageIndex(ctx.config.sessionSecret, this.limits.entries, limit(options.maxPageMetadataBytes, THREAD_LIST_LIMITS.metadataBytes));
    this.onReconciledRecord = options.onReconciledRecord;
    if (path.resolve(ctx.store.directory) !== path.resolve(ctx.config.stateDir)) throw new HttpError(500, 'Conversation storage configuration is inconsistent.', 'THREAD_INDEX_CONFIG');
  }

  status(): ThreadIndexStatus { return { warnings: [...this.warnings.values()].map(value => ({ ...value })), repaired: this.repaired }; }

  initialize(): Promise<void> {
    this.initialized ??= this.refresh().then(() => undefined).catch(error => { this.initialized = undefined; throw error; });
    return this.initialized;
  }

  /** Wait for admitted metadata work without initializing, scanning or repairing
   * anything. Lifecycle callers must fence their writers first. A second barrier
   * includes continuations of an initialization that was already in flight;
   * unrelated newly arriving work does not keep this observer looping forever. */
  async drain(): Promise<void> {
    const admitted = () => [this.initialized, this.refreshing, this.snapshotQueue,
      ...this.operations.values(), compatibilityPublications.get(path.resolve(this.ctx.config.stateDir))];
    await Promise.allSettled(admitted());
    await Promise.allSettled(admitted());
  }

  async list(): Promise<ThreadSummary[]> {
    await this.initialize();
    return structuredClone(await this.refresh());
  }

  async page(input: ThreadIndexPageInput = {}): Promise<ThreadListPage> {
    // Reject malformed filters/cursors before doing any filesystem work.
    const query = this.pages.query(input);
    const alreadyInitialized = !!this.initialized;
    await this.initialize();
    if (!alreadyInitialized) {
      this.requireCompletePageIndex();
      return this.pages.page(query);
    }
    return this.snapshot(async () => {
      if (this.pageCacheError || this.pageRecoveryPending || this.pendingStartup.size || performance.now() - this.pageReconciledAt >= THREAD_LIST_LIMITS.reconcileMs) {
        await this.collect(true);
        this.requireCompletePageIndex();
      }
      // A reconciled sort/search projection may reuse fingerprints. Its visible
      // rows still need canonical bytes, including when timestamps collide.
      await this.validatePage(query);
      this.requireCompletePageIndex();
      return this.pages.page(query);
    });
  }

  private requireCompletePageIndex(): void {
    if (this.pageCacheError) throw this.pageCacheError;
    if (this.pageRecoveryPending) throw new HttpError(503, 'Conversation metadata recovery is still in progress. Retry the conversation list to continue recovery.', 'THREAD_INDEX_RECOVERY_PENDING');
  }

  async upsert(value: ThreadSummary): Promise<void> {
    const summary = normalizeSummary(value);
    if (!summary) throw new HttpError(400, 'Conversation summary is invalid.', 'THREAD_SUMMARY_INVALID');
    await this.exclusive(summary.id, async () => {
      await this.directory(true);
      if (await this.readDeletion(summary.id)) throw this.deletedError();
      const source = await this.sourceVersion(summary.id);
      const record: SummaryRecord = { version: 1, summary, ...(source ? { source: source.version } : {}) };
      try { await this.ctx.store.write(summaryKey(summary.id), record); }
      catch { throw new HttpError(503, 'Conversation summary could not be saved. The full conversation is preserved for recovery.', 'THREAD_INDEX_WRITE'); }
      // Another runtime can delete the thread while the summary is being saved.
      // Its durable marker wins, including over an already queued old write.
      if (await this.readDeletion(summary.id)) throw this.deletedError();
      this.pageMutation++;
      if (this.snapshotActive) this.localPageChanges.set(summary.id, { mutation: this.pageMutation, record });
      try { this.pages.set(summary, undefined, record.source); }
      catch (error) { this.invalidatePages(error); }
      this.knownPageSummaries.add(summary.id);
      await this.updateCompatibility(summary);
    });
  }

  /** Recover one stale context projection without initialization or a namespace
   * scan. The canonical bytes and receipt are re-read under source admission;
   * neither cached counters nor an old summary acquire a newer stat identity. */
  async recoverContextMetadata(input: ThreadContextMetadataRecoveryInput): Promise<ThreadContextMetadataRecoveryResult> {
    this.requireId(input.threadId);
    const unavailable = (readBytes = 0): ThreadContextMetadataRecoveryResult => ({ recovered: false, readBytes });
    if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1 || typeof input.source !== 'string'
      || !/^\d+:\d+:\d+:\d+:\d+$/.test(input.source) || input.source.length > 300) return unavailable();
    const maximum = Math.min(input.maxBytes, this.limits.fullBytes, this.limits.repairBytes), id = input.threadId;
    const identity = (summary: ThreadSummary) => summary.id === id && summary.workspaceId === input.workspaceId
      && summary.parentThreadId === input.parentThreadId && summary.rootThreadId === input.rootThreadId;
    return this.exclusive(id, async () => {
      let handle: Awaited<ReturnType<typeof fs.open>> | undefined, pinnedStore: JsonStore | undefined, readBytes = 0;
      try {
        if (!await this.directory(false)) return unavailable();
        const directory = path.resolve(this.ctx.config.stateDir), before = await fs.lstat(directory, { bigint: true });
        if (!before.isDirectory() || before.isSymbolicLink() || await fs.realpath(directory) !== directory) return unavailable();
        handle = await fs.open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        const opened = await handle.stat({ bigint: true });
        if (!opened.isDirectory() || opened.dev !== before.dev || opened.ino !== before.ino) return unavailable();
        const access = `/proc/self/fd/${handle.fd}`;
        pinnedStore = new JsonStore(access);
        const readPinned = (key: string, maximum: number, kind: RecordKind) => this.read(key, maximum, kind, id, access, true);
        const current = async () => {
          const named = await fs.lstat(directory, { bigint: true });
          return named.isDirectory() && !named.isSymbolicLink() && named.dev === opened.dev && named.ino === opened.ino
            && await fs.realpath(directory) === directory;
        };
        const deleted = async () => this.deleted.has(id)
          || (await readPinned(deletedKey(id), 4096, 'deletion marker')).kind !== 'missing';
        const source = async () => {
          const value = await fs.lstat(path.join(access, `${fullKey(id)}.json`), { bigint: true });
          return value.isFile() && !value.isSymbolicLink() && value.nlink === 1n && value.size > 0n
            ? { version: fingerprint(value), bytes: value.size } : undefined;
        };
        return await this.ctx.store.mutateGuarded(fullKey(id), async () => {
          if (!await current() || await deleted()) return unavailable();
          const initial = await source();
          if (!initial || initial.version !== input.source || initial.bytes > BigInt(maximum)) return unavailable();
          const oldSummary = await readPinned(summaryKey(id), 32 * 1024, 'summary');
          const old = oldSummary.kind === 'value' ? this.summaryRecord(oldSummary.value, id) : undefined;
          if (!old || !identity(old.summary)) return unavailable();
          // Reserve conservatively if a read fails after consuming bytes. A
          // successful bounded read reports its exact cost to the request budget.
          readBytes = maximum + 1;
          const full = await readPinned(fullKey(id), maximum, 'conversation');
          readBytes = full.readBytes ?? readBytes;
          if (full.kind !== 'value' || full.version !== input.source || !object(full.value)
            || !object(full.value.thread) || !Array.isArray(full.value.thread.messages) || !Array.isArray(full.value.input)
            || !Number.isSafeInteger(full.value.revision) || Number(full.value.revision) < 0) return unavailable(readBytes);
          const summary = normalizeSummary(full.value.thread, id);
          if (!summary || !identity(summary)) return unavailable(readBytes);
          const valid = async () => await current() && !await deleted() && (await source())?.version === full.version;
          if (!await valid()) return unavailable(readBytes);
          const repaired: SummaryRecord = { version: 1, summary, source: full.version };
          const published = await this.ctx.store.mutateGuarded(summaryKey(id), async () => {
            const latest = await readPinned(summaryKey(id), 32 * 1024, 'summary');
            if (latest.kind !== 'value' || oldSummary.kind !== 'value' || latest.version !== oldSummary.version
              || JSON.stringify(latest.value) !== JSON.stringify(oldSummary.value) || !await valid()) return false;
            await pinnedStore!.write(summaryKey(id), repaired);
            return await valid();
          });
          if (!published) return unavailable(readBytes);
          this.pageMutation++;
          if (this.snapshotActive) this.localPageChanges.set(id, { mutation: this.pageMutation, record: repaired });
          try { this.pages.set(summary, undefined, full.version); }
          catch (error) { this.invalidatePages(error); }
          this.knownPageSummaries.add(id); this.knownPageFull.add(id);
          this.pendingStartup.delete(id); this.attempted.delete(id); this.repaired++;
          // Same immutable-read hook as startup recovery, with pinned checks
          // replacing its pathname checks. It does not read the source again.
          if (this.onReconciledRecord && await valid()) await this.onReconciledRecord(full.value, full.version);
          return await valid() ? { recovered: true, readBytes } : unavailable(readBytes);
        });
      } catch { return unavailable(readBytes); }
      finally { await pinnedStore?.flush().catch(() => undefined); await handle?.close().catch(() => undefined); }
    });
  }

  /** Call before deleting the full record, journals or any aggregate entry.
   * Markers are permanent: thread IDs are never reused, even for a newer write. */
  async markDeleted(threadId: string): Promise<void> {
    this.requireId(threadId);
    await this.exclusive(threadId, async () => {
      await this.directory(true);
      const key = deletedKey(threadId);
      const previous = await this.read(key, 4_096, 'deletion marker', threadId);
      if (previous.kind !== 'value' || !this.tombstone(previous.value, threadId)) {
        const marker: Tombstone = { version: 1, id: threadId, deletedAt: new Date().toISOString() };
        try { await this.ctx.store.write(key, marker); }
        catch { throw new HttpError(503, 'The conversation deletion marker could not be saved. No conversation files were removed.', 'THREAD_DELETE_PERSISTENCE'); }
      }
      // Verify the completed storage write before callers are allowed to remove
      // the recoverable full conversation. Never rely on the in-memory set here.
      const saved = await this.read(key, 4_096, 'deletion marker', threadId);
      if (saved.kind !== 'value' || !this.tombstone(saved.value, threadId)) throw new HttpError(503, 'The conversation deletion marker could not be verified. No conversation files were removed.', 'THREAD_DELETE_PERSISTENCE');
      this.deleted.add(threadId);
      this.pages.delete(threadId);
      this.pageMutation++;
      if (this.snapshotActive) this.localPageChanges.set(threadId, { mutation: this.pageMutation });
      try { await this.ctx.store.delete(summaryKey(threadId)); }
      catch { this.warn('THREAD_INDEX_CLEANUP', 'A deleted conversation summary could not be removed. Its deletion marker still prevents recovery.', threadId); }
      await this.updateCompatibility(undefined, threadId);
    });
  }

  async isDeleted(threadId: string): Promise<boolean> {
    this.requireId(threadId);
    if (this.deleted.has(threadId)) return true;
    if (!await this.directory(false)) return false;
    return this.readDeletion(threadId);
  }

  /** Internal callers already checked the directory once for their batch. */
  private async readDeletion(threadId: string): Promise<boolean> {
    if (this.deleted.has(threadId)) return true;
    const record = await this.read(deletedKey(threadId), 4_096, 'deletion marker', threadId);
    if (record.kind === 'missing') return false;
    // An unreadable/corrupt marker is never interpreted as permission to restore
    // a thread. Diagnose it without following symlinks or exposing record bytes.
    if (record.kind !== 'value' || !this.tombstone(record.value, threadId)) this.warn('THREAD_INDEX_TOMBSTONE_INVALID', 'A conversation deletion marker is damaged or unsafe. Recovery of this conversation is disabled.', threadId);
    this.deleted.add(threadId);
    this.pages.delete(threadId);
    return true;
  }

  /** A permanent marker observed in a directory snapshot remains authoritative
   * even if its leaf disappears before the bounded diagnostic read completes. */
  private async observeDeletionMarkers(ids: ReadonlySet<string>): Promise<void> {
    const observed = [...ids].filter(id => !this.deleted.has(id));
    for (const id of observed) { this.deleted.add(id); this.pages.delete(id); }
    for (let start = 0; start < observed.length; start += 8) {
      await Promise.all(observed.slice(start, start + 8).map(async id => {
        // Do not call readDeletion after pinning: its positive fast path would
        // skip diagnostics for malformed, unsafe, or subsequently missing leaves.
        const record = await this.read(deletedKey(id), 4_096, 'deletion marker', id);
        if (record.kind !== 'value' || !this.tombstone(record.value, id)) {
          this.warn('THREAD_INDEX_TOMBSTONE_INVALID', 'A conversation deletion marker is damaged or unsafe. Recovery of this conversation is disabled.', id);
        }
      }));
    }
  }

  private tombstone(value: unknown, id: string): value is Tombstone { return object(value) && value.version === 1 && value.id === id && date(value.deletedAt); }
  private requireId(id: string): void { if (!validId(id)) throw new HttpError(400, 'Conversation identity is invalid.', 'THREAD_ID_INVALID'); }
  private deletedError(): HttpError { return new HttpError(409, 'This conversation was deleted.', 'THREAD_DELETED'); }

  private warn(code: string, message: string, threadId?: string): void {
    const key = `${code}:${threadId ?? ''}:${message}`;
    if (this.warnings.has(key)) return;
    if (this.warnings.size >= 100) {
      const overflow = { code: 'THREAD_INDEX_WARNING_LIMIT', message: 'Additional conversation storage warnings were omitted. Inspect saved state before retrying recovery.' };
      this.warnings.set('overflow', overflow); return;
    }
    const warning: ThreadIndexWarning = { code, message, ...(threadId ? { threadId } : {}) };
    this.warnings.set(key, warning);
    this.ctx.events.emit('thread-index:warning', { ...warning });
    console.warn('[thread-index]', warning);
  }

  private exclusive<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const next = (this.operations.get(id) ?? Promise.resolve()).catch(() => undefined).then(operation);
    this.operations.set(id, next);
    void next.finally(() => { if (this.operations.get(id) === next) this.operations.delete(id); }).catch(() => undefined);
    return next;
  }

  /** Refuse directory symlinks as well as leaf symlinks. The native data mount is
   * supplied by hosting; this code only checks/creates ordinary state folders. */
  private async directory(create: boolean): Promise<boolean> {
    const data = path.resolve(this.ctx.config.dataDir), state = path.resolve(this.ctx.config.stateDir);
    const relative = path.relative(data, state);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new HttpError(500, 'Conversation state must be stored inside the configured data directory.', 'THREAD_INDEX_CONFIG');
    let current = data;
    for (const component of ['', ...relative.split(path.sep)]) {
      if (component) current = path.join(current, component);
      let stat;
      try { stat = await fs.lstat(current); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new HttpError(503, 'Conversation storage is unavailable.', 'THREAD_INDEX_STORAGE');
        if (!create) return false;
        try { await fs.mkdir(current); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new HttpError(503, 'Conversation storage could not be created.', 'THREAD_INDEX_STORAGE'); }
        try { stat = await fs.lstat(current); }
        catch { throw new HttpError(503, 'Conversation storage could not be verified.', 'THREAD_INDEX_STORAGE'); }
      }
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        this.warn('THREAD_INDEX_UNSAFE_DIRECTORY', 'Conversation storage contains an unsafe directory. Recovery did not follow it.');
        throw new HttpError(503, 'Conversation storage contains an unsafe directory.', 'THREAD_INDEX_UNSAFE_DIRECTORY');
      }
    }
    return true;
  }

  private async read(key: string, maxBytes: number, kind: RecordKind, threadId?: string, accessDirectory = this.ctx.config.stateDir, singleLink = false): Promise<ReadResult> {
    const filename = path.join(accessDirectory, `${key}.json`);
    let readBytes = 0;
    // Full histories consume the repair byte budget once. Retry a changed full
    // record on the next request instead of multiplying that cost in one pass.
    for (let attempt = 0; attempt < (kind === 'conversation' ? 1 : 3); attempt++) {
      let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
      try {
        const before = await fs.lstat(filename, { bigint: true });
        if (!before.isFile() || before.isSymbolicLink() || singleLink && before.nlink !== 1n) {
          this.warn('THREAD_INDEX_UNSAFE_RECORD', `A saved ${kind} is not a regular file and was not followed.`, threadId); return { kind: 'invalid' };
        }
        if (before.size > BigInt(maxBytes)) {
          this.warn('THREAD_INDEX_RECORD_LIMIT', `A saved ${kind} exceeds the recovery size limit and was left untouched.`, threadId); return { kind: 'invalid' };
        }
        // O_NONBLOCK also prevents a regular file -> FIFO race from hanging.
        handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const opened = await handle.stat({ bigint: true });
        if (!opened.isFile() || singleLink && opened.nlink !== 1n || fingerprint(opened) !== fingerprint(before)) continue;
        const chunks: Buffer[] = [];
        let total = 0;
        while (total <= maxBytes) {
          const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - total));
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
          if (!bytesRead) break;
          chunks.push(buffer.subarray(0, bytesRead)); total += bytesRead; readBytes += bytesRead;
        }
        if (total > maxBytes) { this.warn('THREAD_INDEX_RECORD_LIMIT', `A saved ${kind} exceeds the recovery size limit and was left untouched.`, threadId); return { kind: 'invalid', readBytes }; }
        const after = await handle.stat({ bigint: true }), visible = await fs.lstat(filename, { bigint: true });
        if (singleLink && (after.nlink !== 1n || visible.nlink !== 1n)
          || fingerprint(after) !== fingerprint(before) || fingerprint(visible) !== fingerprint(before)) continue;
        let value: unknown;
        try { value = JSON.parse(Buffer.concat(chunks, total).toString('utf8')); }
        catch { this.warn('THREAD_INDEX_MALFORMED', `A saved ${kind} contains invalid JSON and cannot be used for enumeration.`, threadId); return { kind: 'invalid', readBytes }; }
        return { kind: 'value', value, version: fingerprint(after), bytes: total, readBytes };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') { if (!handle) return { kind: 'missing' }; continue; }
        if (code === 'ELOOP') { this.warn('THREAD_INDEX_UNSAFE_RECORD', `A saved ${kind} is a symbolic link and was not followed.`, threadId); return { kind: 'invalid' }; }
        this.warn('THREAD_INDEX_READ_FAILED', `A saved ${kind} could not be read. Its contents were left untouched.`, threadId);
        throw new HttpError(503, 'Saved conversation state could not be read. Retry when storage is available.', 'THREAD_INDEX_STORAGE');
      } finally { await handle?.close().catch(() => undefined); }
    }
    this.warn('THREAD_INDEX_CHANGING', `A saved ${kind} changed during recovery. Retry after its writer finishes.`, threadId);
    throw new HttpError(409, 'Saved conversation state changed during recovery. Retry.', 'THREAD_INDEX_CONFLICT');
  }

  private async sourceVersion(id: string): Promise<{ version: string; bytes: number } | undefined> {
    try {
      const stat = await fs.lstat(path.join(this.ctx.config.stateDir, `${fullKey(id)}.json`), { bigint: true });
      if (!stat.isFile() || stat.isSymbolicLink()) { this.warn('THREAD_INDEX_UNSAFE_RECORD', 'A saved conversation is not a regular file and was not followed.', id); throw new HttpError(503, 'The saved conversation file is unsafe.', 'THREAD_INDEX_UNSAFE_RECORD'); }
      return { version: fingerprint(stat), bytes: Number(stat.size) };
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; if (error instanceof HttpError) throw error; throw new HttpError(503, 'Conversation storage is unavailable.', 'THREAD_INDEX_STORAGE'); }
  }

  private async inventory(): Promise<Inventory> {
    const result: Inventory = { full: new Set(), summaries: new Set(), deleted: new Set(), unsafe: new Set(), complete: true };
    if (!await this.directory(false)) return result;
    let count = 0;
    try {
      for await (const entry of await fs.opendir(this.ctx.config.stateDir)) {
        if (++count > this.limits.entries) {
          result.complete = false;
          this.warn('THREAD_INDEX_SCAN_LIMIT', 'The conversation storage scan reached its entry limit. The returned list may be incomplete; no files were removed.'); break;
        }
        const match = /^(thread-summary|thread-deleted|thread)-(thr_[a-f0-9]{32})\.json$/.exec(entry.name);
        if (!match) {
          if (/^(?:thread-summary-|thread-deleted-|thread-thr_)/.test(entry.name) && !entry.name.endsWith('.tmp')) this.warn('THREAD_INDEX_UNSAFE_NAME', 'A conversation storage entry has an invalid identity and was ignored.');
          continue;
        }
        const [, prefix, id] = match;
        const target = prefix === 'thread' ? result.full : prefix === 'thread-summary' ? result.summaries : result.deleted;
        target.add(id);
        if (this.unsafeEntry(entry)) {
          this.warn('THREAD_INDEX_UNSAFE_RECORD', `A saved ${prefix === 'thread-deleted' ? 'deletion marker' : prefix === 'thread-summary' ? 'summary' : 'conversation'} is not a regular file and was not followed.`, id);
          if (prefix !== 'thread-deleted') result.unsafe.add(id);
        }
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(503, 'Conversation storage could not be enumerated.', 'THREAD_INDEX_STORAGE');
    }
    return result;
  }

  private unsafeEntry(entry: Dirent): boolean {
    // Some native filesystems report an unknown type; lstat/open validate those.
    return entry.isSymbolicLink() || entry.isDirectory() || entry.isFIFO() || entry.isSocket() || entry.isBlockDevice() || entry.isCharacterDevice();
  }

  private refresh(usePageCache = false): Promise<ThreadSummary[]> {
    if (this.refreshing) return this.refreshing;
    const pending = this.snapshot(() => this.collect(usePageCache)).finally(() => { if (this.refreshing === pending) this.refreshing = undefined; });
    this.refreshing = pending; return pending;
  }

  /** Full internal lists never join a cached browser-page operation. Serializing
   * metadata publication also prevents a slower old pass from erasing a newer
   * page validation or completed local rename. Full records retain per-id locks. */
  private snapshot<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.snapshotQueue.catch(() => undefined).then(async () => {
      this.snapshotActive = true;
      try { return await operation(); }
      catch (error) { this.pageReconciledAt = -Infinity; throw error; }
      finally { this.snapshotActive = false; this.localPageChanges.clear(); }
    });
    this.snapshotQueue = next;
    return next;
  }

  /** A namespace change does not invalidate every summary. Fingerprints are
   * checked independently, including in-place edits that do not change the
   * directory stamp; only changed or recently written records are reopened. */
  private async pagedSummary(id: string): Promise<ReadResult> {
    const cached = this.pages.get(id);
    if (cached?.version && cached.cacheable) {
      try {
        const stat = await fs.lstat(path.join(this.ctx.config.stateDir, `${summaryKey(id)}.json`), { bigint: true });
        if (stat.isFile() && !stat.isSymbolicLink() && fingerprint(stat) === cached.version && settledVersion(cached.version)) {
          return { kind: 'value', value: { version: 1, summary: cached.summary, ...(cached.source ? { source: cached.source } : {}) },
            version: cached.version, bytes: cached.bytes, readBytes: 0 };
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
        throw new HttpError(503, 'Saved conversation state could not be read. Retry when storage is available.', 'THREAD_INDEX_STORAGE');
      }
    }
    return this.read(summaryKey(id), 32 * 1024, 'summary', id);
  }

  private invalidatePages(error: unknown): void {
    this.pages.clear();
    this.pageReconciledAt = -Infinity;
    this.pageCacheError = error instanceof HttpError ? error : new HttpError(503, 'The conversation metadata index could not be refreshed.', 'THREAD_INDEX_STORAGE');
  }

  private summaryRecord(value: unknown, id: string): SummaryRecord | undefined {
    const envelope = object(value) && value.version === 1 && 'summary' in value ? value : undefined;
    const summary = normalizeSummary(envelope ? envelope.summary : value, id);
    if (!summary) { this.warn('THREAD_INDEX_INVALID_SUMMARY', 'A saved conversation summary has invalid fields. Recovery will use its full record where available.', id); return; }
    return { version: 1, summary, ...(typeof envelope?.source === 'string' && envelope.source.length <= 512 ? { source: envelope.source } : {}) };
  }

  /** Browser metadata may lag an external, off-screen in-place edit by at most
   * the short reconciliation interval. Visible/selected rows and a fresh marker
   * namespace are checked every request. No watcher or directory timestamp is
   * trusted as proof that existing files or permanent markers did not change. */
  private async validatePage(query: ReturnType<ThreadPageIndex['query']>): Promise<void> {
    const mutation = this.pageMutation, checked = new Set<string>();
    if (!await this.directory(false)) { await this.collect(true); return; }
    let repair = false;
    const changedLocally = (id: string) => (this.localPageChanges.get(id)?.mutation ?? -1) > mutation;
    const update = async (id: string) => {
      if (this.deleted.has(id)) { this.pages.delete(id); checked.add(id); return; }
      const readMutation = this.pageMutation;
      // This bounded set is displayed now. Even a settled fingerprint cannot
      // prove its bytes unchanged on a filesystem with coarse timestamps.
      const value = await this.read(summaryKey(id), 32 * 1024, 'summary', id);
      checked.add(id);
      if ((this.localPageChanges.get(id)?.mutation ?? -1) > readMutation || this.deleted.has(id)) return;
      const record = value.kind === 'value' ? this.summaryRecord(value.value, id) : undefined;
      if (!record || value.kind !== 'value') {
        this.pages.delete(id);
        if (this.knownPageFull.has(id)) repair = true;
        return;
      }
      try { this.pages.set(record.summary, value.version, record.source, settledVersion(value.version)); }
      catch (error) { this.invalidatePages(error); throw this.pageCacheError; }
    };
    const batch = async (ids: string[]) => {
      for (let start = 0; start < ids.length; start += 8) {
        // Drain sibling reads before releasing the snapshot queue on failure;
        // otherwise an old read could publish after a subsequent rename/page.
        const results = await Promise.allSettled(ids.slice(start, start + 8).map(update));
        for (const result of results) if (result.status === 'rejected') throw result.reason;
      }
    };
    const visible = () => {
      const page = this.pages.page(query);
      return new Set([...page.items.map(item => item.id), ...(query.selectedId && !this.deleted.has(query.selectedId)
        && (this.pages.get(query.selectedId) || this.knownPageSummaries.has(query.selectedId)) ? [query.selectedId] : [])]);
    };
    // Reordering or deleting a visible row can expose another row. Bound that
    // work and ask for a retry during sustained churn instead of returning an
    // unvalidated replacement or looping without an I/O budget.
    for (let round = 0; round < 3; round++) {
      await batch([...visible()].filter(id => !checked.has(id)));
      const inventory = await this.inventory();
      await this.observeDeletionMarkers(inventory.deleted);
      if (!inventory.complete) {
        this.invalidatePages(new HttpError(503, 'The conversation storage scan reached its entry limit. The conversation list cannot be paged completely.', 'THREAD_INDEX_SCAN_LIMIT'));
        throw this.pageCacheError;
      }
      for (const id of this.pages.ids()) {
        if (this.deleted.has(id) || inventory.unsafe.has(id)) this.pages.delete(id);
        else if (!inventory.summaries.has(id) && !changedLocally(id)) {
          this.pages.delete(id);
          if (inventory.full.has(id)) repair = true;
        }
      }
      for (const id of inventory.full) if (!this.knownPageFull.has(id) && !inventory.summaries.has(id) && !inventory.unsafe.has(id) && !this.deleted.has(id)) repair = true;
      const added = [...inventory.summaries].filter(id => !this.knownPageSummaries.has(id) && !this.deleted.has(id) && !inventory.unsafe.has(id));
      this.knownPageSummaries = inventory.summaries; this.knownPageFull = inventory.full;
      if (repair) {
        await this.collect(true); this.requireCompletePageIndex();
        repair = false; checked.clear(); continue;
      }
      if (added.length) { await batch(added); continue; }
      if (![...visible()].some(id => !checked.has(id))) return;
    }
    throw new HttpError(409, 'The conversation list changed while its page was being read. Retry this page.', 'THREAD_INDEX_CONFLICT');
  }

  private publishPages(summaries: Map<string, SummaryRecord>, versions: Map<string, { version: string; cacheable: boolean; freshlyRead?: boolean }>, mutation: number, inventory: Inventory, complete: boolean): void {
    // Own updates that completed while the scan awaited I/O win over its old
    // snapshot. Markers also win when deletion overlaps cache publication.
    for (const [id, change] of this.localPageChanges) if (change.mutation > mutation) {
      if (change.record) { summaries.set(id, change.record); versions.delete(id); }
      else summaries.delete(id);
    }
    const values: ThreadMetadataInput[] = [];
    for (const [id, record] of summaries) if (!this.deleted.has(id)) values.push({ summary: record.summary, source: record.source, ...versions.get(id) });
    try {
      if (!complete) throw new HttpError(503, 'The conversation storage scan reached its entry limit. The conversation list cannot be paged completely.', 'THREAD_INDEX_SCAN_LIMIT');
      this.pages.reconcile(values); this.pageCacheError = undefined;
      this.pageReconciledAt = performance.now();
      this.knownPageSummaries = inventory.summaries; this.knownPageFull = inventory.full;
    } catch (error) { this.invalidatePages(error); }
    this.localPageChanges.clear();
  }

  /** The receipt belongs to the bytes already read above, never to a later
   * pathname stat. These final checks can retire it, but cannot replace it with
   * a new identity and accidentally bless stale accounting. */
  private async notifyReconciledRecord(id: string, record: unknown, readVersion: string): Promise<void> {
    if (!this.onReconciledRecord || await this.readDeletion(id)) return;
    if ((await this.sourceVersion(id))?.version !== readVersion) return;
    try { await this.onReconciledRecord(record, readVersion); }
    catch { this.warn('THREAD_INDEX_RECOVERY_CALLBACK', 'Derived conversation metadata could not be refreshed. The saved conversation was left unchanged.', id); }
  }

  private async collect(usePageCache = false): Promise<ThreadSummary[]> {
    const mutation = this.pageMutation, versions = new Map<string, { version: string; cacheable: boolean; freshlyRead?: boolean }>();
    const inventory = await this.inventory(), summaries = new Map<string, SummaryRecord>();
    if (!this.scannedStartup) { for (const id of inventory.full) this.pendingStartup.add(id); this.scannedStartup = true; }
    await this.observeDeletionMarkers(inventory.deleted);
    const ids = [...inventory.summaries].filter(id => !inventory.unsafe.has(id) && !this.deleted.has(id));
    for (let start = 0; start < ids.length; start += 8) {
      await Promise.all(ids.slice(start, start + 8).map(async id => {
        const record = usePageCache ? await this.pagedSummary(id) : await this.read(summaryKey(id), 32 * 1024, 'summary', id);
        if (record.kind !== 'value') return;
        // Accept early flat summary records, while new envelopes retain a cheap
        // full-file identity to avoid rereading unchanged history on restart.
        const summary = this.summaryRecord(record.value, id);
        if (!summary) return;
        summaries.set(id, summary);
        versions.set(id, { version: record.version, cacheable: settledVersion(record.version), freshlyRead: record.readBytes > 0 });
      }));
    }
    let repairs = 0, bytes = 0, deferred = false;
    for (const id of inventory.full) {
      if (inventory.unsafe.has(id) || this.deleted.has(id)) { this.pendingStartup.delete(id); continue; }
      if (summaries.has(id) && !this.pendingStartup.has(id)) continue;
      const source = await this.sourceVersion(id);
      if (!source) { this.pendingStartup.delete(id); continue; }
      if (summaries.get(id)?.source === source.version || this.attempted.get(id) === source.version) { this.pendingStartup.delete(id); continue; }
      if (repairs >= this.limits.repairs || bytes >= this.limits.repairBytes
        || bytes > 0 && source.bytes <= this.limits.repairBytes && source.bytes > this.limits.repairBytes - bytes) { deferred = true; break; }
      repairs++;
      const full = await this.read(fullKey(id), Math.min(this.limits.fullBytes, this.limits.repairBytes - bytes), 'conversation', id);
      bytes += full.readBytes ?? 0;
      this.attempted.set(id, source.version); this.pendingStartup.delete(id);
      if (full.kind !== 'value') continue;
      const summary = object(full.value) && object(full.value.thread) && Array.isArray(full.value.thread.messages) && Array.isArray(full.value.input)
        ? normalizeSummary(full.value.thread, id) : undefined;
      if (!summary) { this.warn('THREAD_INDEX_INVALID_CONVERSATION', 'A saved conversation has invalid fields or a mismatched identity and was left untouched.', id); continue; }
      this.attempted.delete(id);
      if (await this.readDeletion(id)) { summaries.delete(id); continue; }
      const repaired: SummaryRecord = { version: 1, summary, source: full.version };
      versions.delete(id);
      // Recovery never writes the full record. A full save followed by a crashed
      // index update is repaired without replaying tools or altering live runs.
      await this.exclusive(id, async () => {
        if (await this.readDeletion(id)) return;
        if ((await this.sourceVersion(id))?.version !== full.version) {
          this.pendingStartup.add(id); deferred = true; return;
        }
        const current = await this.read(summaryKey(id), 32 * 1024, 'summary', id);
        if (current.kind === 'value') {
          const candidate = this.summaryRecord(current.value, id);
          // A concurrent writer may already have published the summary for this
          // exact full-file identity. Its metadata wins even when timestamps
          // tie, as can happen for a rename within the same clock tick.
          if (candidate && (candidate.source === full.version || Date.parse(candidate.summary.updatedAt) > Date.parse(summary.updatedAt))) {
            summaries.set(id, candidate); versions.set(id, { version: current.version, cacheable: settledVersion(current.version), freshlyRead: true });
            if (candidate.source === full.version) await this.notifyReconciledRecord(id, full.value, full.version);
            return;
          }
        }
        try { await this.ctx.store.write(summaryKey(id), repaired); }
        catch { this.warn('THREAD_INDEX_REPAIR_FAILED', 'A conversation was found, but its summary could not be saved. Its full history was left untouched.', id); summaries.set(id, repaired); this.attempted.delete(id); this.pendingStartup.add(id); return; }
        summaries.set(id, repaired); versions.delete(id); this.repaired++;
        await this.notifyReconciledRecord(id, full.value, full.version);
      });
    }
    if (deferred) this.warn('THREAD_INDEX_REPAIR_DEFERRED', 'Conversation recovery reached its per-pass limit. Remaining records will be checked on subsequent list requests.');
    // Re-enumerate after all reads/repairs so a marker published during this
    // pass is observed before displaying its summary. Native missing-path probes
    // can each require a remote round trip; a complete fresh namespace snapshot
    // establishes absence for list display without a probe per live thread.
    // Direct access and every mutation/recovery-write check remain unchanged.
    const finalInventory = await this.inventory();
    await this.observeDeletionMarkers(finalInventory.deleted);
    const result: ThreadSummary[] = [];
    const candidates = [...summaries.values()];
    for (let start = 0; start < candidates.length; start += 8) {
      const batch = await Promise.all(candidates.slice(start, start + 8).map(async item => {
        if (this.deleted.has(item.summary.id)) return;
        // A scan stopped by its budget cannot prove a marker absent. Preserve
        // authoritative per-candidate reads in that bounded fallback case.
        if (!finalInventory.complete && await this.readDeletion(item.summary.id)) return;
        return item.summary;
      }));
      for (const item of batch) if (item) result.push(item);
    }
    result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    if (!usePageCache) await this.replaceCompatibility(result);
    this.publishPages(summaries, versions, mutation, finalInventory, inventory.complete && finalInventory.complete);
    this.pageRecoveryPending = deferred || this.pendingStartup.size > 0;
    // Own deletion can complete while the derived compatibility cache is saved.
    return result.filter(item => !this.deleted.has(item.id));
  }

  private async compatibility(): Promise<ThreadSummary[]> {
    const current = await this.read('thread-index', 16 * 1024 * 1024, 'compatibility index');
    if (current.kind !== 'value') { this.compatibilityDirty = current.kind === 'invalid'; return []; }
    if (!Array.isArray(current.value)) { this.compatibilityDirty = true; this.warn('THREAD_INDEX_INVALID_CACHE', 'The legacy conversation index has an invalid format. Per-conversation records remain authoritative.'); return []; }
    const valid = current.value.map(value => normalizeSummary(value));
    if (valid.some(value => !value)) { this.compatibilityDirty = true; this.warn('THREAD_INDEX_INVALID_CACHE', 'Invalid entries in the legacy conversation index were ignored. Per-conversation records remain authoritative.'); }
    return valid.filter((value): value is ThreadSummary => !!value);
  }

  private async compatibilityWithoutDeleted(items: ThreadSummary[]): Promise<ThreadSummary[]> {
    const inventory = await this.inventory();
    await this.observeDeletionMarkers(inventory.deleted);
    if (!inventory.complete) {
      // A truncated namespace cannot establish marker absence. Check exactly
      // the candidate identities instead, without reading any full history.
      for (let start = 0; start < items.length; start += 8) {
        const results = await Promise.allSettled(items.slice(start, start + 8).map(item => this.readDeletion(item.id)));
        for (const result of results) if (result.status === 'rejected') throw result.reason;
      }
    }
    return items.filter(item => !this.deleted.has(item.id));
  }

  private async canonicalCompatibilitySummary(id: string): Promise<ThreadSummary | undefined> {
    if (this.deleted.has(id)) return;
    const record = await this.read(summaryKey(id), 32 * 1024, 'summary', id);
    return record.kind === 'value' ? this.summaryRecord(record.value, id)?.summary : undefined;
  }

  private publishCompatibility(build: (current: ThreadSummary[]) => Promise<ThreadSummary[]>): Promise<void> {
    const key = path.resolve(this.ctx.config.stateDir);
    const pending = (compatibilityPublications.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      if (!await this.directory(false)) return;
      const current = await this.compatibility();
      let next = await build(current), written = JSON.stringify(current);
      next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
      for (let attempt = 0; attempt < 3; attempt++) {
        next = (await this.compatibilityWithoutDeleted(next)).filter(item => !this.deleted.has(item.id));
        const serialized = JSON.stringify(next);
        if (this.compatibilityDirty || serialized !== written) {
          await this.ctx.store.write('thread-index', next);
          written = serialized;
        }
        // A marker may commit while storage awaits the write. Repair that
        // publication before releasing the queue to deletion or peer writers.
        const checked = (await this.compatibilityWithoutDeleted(next)).filter(item => !this.deleted.has(item.id));
        if (checked.length === next.length) { this.compatibilityDirty = false; return; }
        next = checked;
      }
      throw new HttpError(409, 'Conversation deletion changed the compatibility index during publication. Retry.', 'THREAD_INDEX_CONFLICT');
    });
    compatibilityPublications.set(key, pending);
    void pending.finally(() => { if (compatibilityPublications.get(key) === pending) compatibilityPublications.delete(key); }).catch(() => undefined);
    return pending.catch(() => {
      this.compatibilityDirty = true;
      this.warn('THREAD_INDEX_CACHE_WRITE', 'The compatibility conversation index could not be refreshed. Per-conversation records remain saved.');
    });
  }

  private updateCompatibility(summary?: ThreadSummary, removedId?: string): Promise<void> {
    return this.publishCompatibility(async current => {
      const records = new Map(current.filter(item => item.id !== (summary?.id ?? removedId)).map(item => [item.id, item]));
      if (summary) {
        // An independently committed same-id update may already supersede the
        // value that waited for this queue. Its small canonical record wins.
        const latest = await this.canonicalCompatibilitySummary(summary.id);
        if (latest) records.set(latest.id, latest);
      }
      return [...records.values()];
    });
  }

  private replaceCompatibility(summaries: ThreadSummary[]): Promise<void> {
    return this.publishCompatibility(async current => {
      const records = new Map(summaries.map(item => [item.id, item]));
      const changed = current.filter(peer => {
        const candidate = records.get(peer.id);
        return !candidate || JSON.stringify(candidate) !== JSON.stringify(peer);
      });
      if (changed.length) {
        const inventory = await this.inventory();
        await this.observeDeletionMarkers(inventory.deleted);
        for (let start = 0; start < changed.length; start += 8) {
          const results = await Promise.allSettled(changed.slice(start, start + 8).map(async peer => {
            // A list snapshot may predate a peer creation or same-tick rename.
            // Preserve independently saved summaries, never aggregate ghosts;
            // a complete namespace avoids one missing-path probe per ghost.
            const latest = !inventory.complete || inventory.summaries.has(peer.id) ? await this.canonicalCompatibilitySummary(peer.id) : undefined;
            if (latest) records.set(latest.id, latest);
          }));
          for (const result of results) if (result.status === 'rejected') throw result.reason;
        }
      }
      return [...records.values()];
    });
  }
}
