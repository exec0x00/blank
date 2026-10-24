import fs from 'node:fs/promises';
import { constants, type BigIntStats } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { encryptBuffer, decryptBuffer } from './crypto';
import { HttpError } from './errors';
import { publishConditionalJson, readConditionalJsonSource, recoverConditionalJsonKey, STATE_CAS_LIMITS, type ConditionalJsonRecoveryInput } from './store-conditional';

// State is often consulted several times by one editor request. Keep small JSON
// records in memory, but validate their filesystem identity on *every* read:
// fs.watch is not reliable on all native bucket volumes or for terminal writes.
const MAX_CACHED_RECORDS = 256;
const MAX_CACHED_BYTES = 16 * 1024 * 1024;
const MAX_CACHED_RECORD_BYTES = 1024 * 1024;
// Some filesystems reuse timestamps for several writes in one clock tick,
// including nanosecond-looking ctimes. Admit a snapshot only after that window
// has passed; merely waiting before *using* a recent snapshot is not sufficient.
const TIMESTAMP_SETTLE_MS = 2_000;
interface Version { fingerprint: string; settled: boolean }
interface Snapshot { version: string; serialized: string; bytes: number; settled: boolean }
export interface JsonStoreReadVersion<T> { value: T; version?: string }
export interface JsonStoreWriteVersion { version: string }
export interface JsonStoreWriteVersionOptions { expectedDigest?: string }
interface RequestedWriteVersion { version?: string; expectedDigest?: string }
const versionFingerprint = (stat: BigIntStats) => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
const sameFileNode = (left: BigIntStats, right: BigIntStats) => left.dev === right.dev && left.ino === right.ino;

function stateConflict(): HttpError {
  return new HttpError(409, 'Saved workspace state changed outside the app. Refresh and try again.', 'STATE_CONFLICT');
}

// The bucket is public by request: all normal state/files are ordinary JSON/text.
// Writes are serialized per key, replaced only after a complete temporary write.
export class JsonStore {
  private queues = new Map<string, Promise<unknown>>();
  private reads = new Map<string, Promise<Snapshot | undefined>>();
  private cache = new Map<string, Snapshot>();
  private cachedBytes = 0;
  // Versioned callers pass their own immutable clone through the existing
  // write() seam. A request belongs to that exact object, not a mutable caller
  // reference or whichever operation most recently wrote a storage key.
  private writeVersions = new WeakMap<object, RequestedWriteVersion>();
  constructor(public readonly directory: string) {}

  private filename(key: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,180}$/.test(key)) throw new Error('Invalid storage key.');
    return path.join(this.directory, `${key}.json`);
  }

  async read<T>(key: string, fallback: T): Promise<T> {
    const file = this.filename(key);
    const pending = this.queues.get(key);
    if (pending) await pending.catch(() => undefined);
    return this.readDirect(file, fallback);
  }

  /** Returns the identity observed with these exact parsed bytes. Callers must
   * not independently stat a pathname later to manufacture this association. */
  async readWithVersion<T>(key: string, fallback: T): Promise<JsonStoreReadVersion<T>> {
    const file = this.filename(key), pending = this.queues.get(key);
    if (pending) await pending.catch(() => undefined);
    const snapshot = await this.snapshot(file);
    return snapshot ? { value: JSON.parse(snapshot.serialized) as T, version: snapshot.version }
      : { value: structuredClone(fallback) };
  }

  private async readDirect<T>(file: string, fallback: T): Promise<T> {
    const snapshot = await this.snapshot(file);
    // Parse per consumer so nobody can mutate another reader's cached state.
    return snapshot ? JSON.parse(snapshot.serialized) as T : structuredClone(fallback);
  }

  private async version(file: string): Promise<Version | undefined> {
    try {
      const stat = await fs.stat(file, { bigint: true });
      return {
        fingerprint: `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`,
        settled: stat.ctimeNs > 0n && Number(stat.ctimeNs / 1_000_000n) < Date.now() - TIMESTAMP_SETTLE_MS,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  private evict(file: string): void {
    const previous = this.cache.get(file);
    if (previous) this.cachedBytes -= previous.bytes;
    this.cache.delete(file);
  }

  private invalidate(file: string): void {
    this.evict(file);
    // A reader that started before a write may finish, but must not repopulate
    // the cache or be reused by readers after that write's completion barrier.
    this.reads.delete(file);
  }

  private remember(file: string, snapshot: Snapshot | undefined): void {
    this.evict(file);
    if (!snapshot?.settled || snapshot.bytes > MAX_CACHED_RECORD_BYTES) return;
    this.cache.set(file, snapshot);
    this.cachedBytes += snapshot.bytes;
    while (this.cache.size > MAX_CACHED_RECORDS || this.cachedBytes > MAX_CACHED_BYTES) {
      this.evict(this.cache.keys().next().value!);
    }
  }

  private snapshot(file: string): Promise<Snapshot | undefined> {
    const pending = this.reads.get(file);
    if (pending) return pending;
    const loading = this.loadSnapshot(file).then(snapshot => {
      if (this.reads.get(file) === loading) this.remember(file, snapshot);
      return snapshot;
    }).finally(() => { if (this.reads.get(file) === loading) this.reads.delete(file); });
    this.reads.set(file, loading);
    return loading;
  }

  private async loadSnapshot(file: string, fresh = false): Promise<Snapshot | undefined> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await this.version(file);
      if (before === undefined) return undefined;
      const cached = this.cache.get(file);
      if (!fresh && before.settled && cached?.version === before.fingerprint) return cached;
      let serialized: string;
      try { serialized = await fs.readFile(file, 'utf8'); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      // Never associate bytes from one version with another version's stat.
      // Replacement, same-size edits, and restored mtimes all invalidate it.
      const after = await this.version(file);
      if (after?.fingerprint !== before.fingerprint) continue;
      return { version: before.fingerprint, serialized, bytes: Buffer.byteLength(serialized, 'utf8'), settled: before.settled && after.settled };
    }
    throw stateConflict();
  }

  private enqueue<T>(key: string, work: () => Promise<T>): Promise<T> {
    const prior = this.queues.get(key) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(work);
    this.queues.set(key, next);
    void next.finally(() => { if (this.queues.get(key) === next) this.queues.delete(key); }).catch(() => undefined);
    return next;
  }

  /** Compose a pinned lifecycle mutation with this store's normal per-key
   * serialization. The callback runs exactly once and owns its safe I/O. */
  mutateGuarded<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const file = this.filename(key);
    return this.enqueue(key, async () => {
      this.invalidate(file);
      try { return await operation(); }
      finally { this.invalidate(file); }
    });
  }

  private async writeDirect(file: string, value: unknown, expected?: { snapshot: Snapshot | undefined }, receipt?: RequestedWriteVersion): Promise<void> {
    const serialized = JSON.stringify(value, null, 2);
    if (serialized === undefined) throw new Error('Storage values must be valid JSON.');
    if (receipt?.expectedDigest !== undefined && Buffer.byteLength(serialized + '\n') > STATE_CAS_LIMITS.bytes) throw new HttpError(413,
      'The conditional state record exceeds its bounded recovery limit. Its existing contents were retained.', 'STATE_CAS_LIMIT');
    let target = file;
    let directoryHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
    let directoryStat: BigIntStats | undefined;
    let directoryPath: string | undefined;
    if (receipt) {
      // Only this new receipt path is stricter; ordinary read/write/update
      // formats and behavior remain unchanged. Thread storage already exists
      // before a conversation can be admitted.
      try {
        directoryPath = path.resolve(this.directory);
        const named = await fs.lstat(directoryPath, { bigint: true });
        if (!named.isDirectory() || named.isSymbolicLink() || await fs.realpath(directoryPath) !== directoryPath) throw stateConflict();
        directoryHandle = await fs.open(directoryPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        directoryStat = await directoryHandle.stat({ bigint: true });
        if (!directoryStat.isDirectory() || !sameFileNode(named, directoryStat)) throw stateConflict();
        target = `/proc/self/fd/${directoryHandle.fd}/${path.basename(file)}`;
      } catch (error) { await directoryHandle?.close().catch(() => undefined); throw error; }
    }
    const temporary = `${target}.${randomUUID()}.tmp`;
    this.invalidate(file);
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    let receiptHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
    let temporaryExists = false;
    try {
      try { handle = await fs.open(temporary, 'wx', 0o600); }
      catch (error) {
        if (receipt) throw error;
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await fs.mkdir(this.directory, { recursive: true });
        handle = await fs.open(temporary, 'wx', 0o600);
      }
      temporaryExists = true;
      await handle.writeFile(serialized + '\n');
      const written = receipt ? await handle.stat({ bigint: true }) : undefined;
      await handle.close();
      handle = undefined;
      if (receipt) {
        // Close the writer before rename, as the normal store path does. Retain
        // a verified read handle across rename so bucket close/flush behavior
        // is unchanged and a replacement pathname cannot supply our receipt.
        receiptHandle = await fs.open(temporary, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const opened = await receiptHandle.stat({ bigint: true });
        if (!written || !opened.isFile() || opened.nlink !== 1n || !sameFileNode(written, opened)
          || versionFingerprint(written) !== versionFingerprint(opened) || opened.size !== BigInt(Buffer.byteLength(serialized + '\n'))) throw stateConflict();
      }
      // An async updater must not overwrite a terminal edit made since its read.
      if (expected) {
        if (receipt) {
          const current = await readConditionalJsonSource(this.directory, path.basename(file).slice(0, -5));
          if (current?.version !== expected.snapshot?.version || current?.serialized !== expected.snapshot?.serialized) throw stateConflict();
        } else {
          if ((await this.version(file))?.fingerprint !== expected.snapshot?.version) throw stateConflict();
          // Compare actual bytes as well: mutation correctness never relies on
          // cache admission or on a filesystem's claimed timestamp precision.
          if (expected.snapshot && await fs.readFile(file, 'utf8') !== expected.snapshot.serialized) throw stateConflict();
        }
      }
      if (receipt && expected?.snapshot && directoryHandle && directoryStat && directoryPath) {
        // Retain cleanup ownership until the actual move is confirmed, even if
        // a native adapter throws after doing the move. A later claim on the
        // relinquished temporary name must not be removed by normal cleanup.
        const checkDirectory = async () => {
          const current = await fs.lstat(directoryPath!, { bigint: true });
          if (!current.isDirectory() || current.isSymbolicLink() || !sameFileNode(current, directoryStat!)
            || await fs.realpath(directoryPath!) !== directoryPath) throw stateConflict();
          const key = path.basename(file).slice(0, -5);
          if (/^thread-thr_[a-f0-9]{32}$/.test(key)) {
            try { await fs.lstat(`${target.slice(0, target.lastIndexOf('/'))}/thread-deleted-${key.slice(7)}.json`); throw stateConflict(); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
          }
        };
        const published = await publishConditionalJson({ key: path.basename(file).slice(0, -5),
          access: `/proc/self/fd/${directoryHandle.fd}`, directory: directoryPath, temporary,
          expected: expected.snapshot, serialized: serialized + '\n', checkDirectory,
          onTemporaryMoved: () => { temporaryExists = false; } });
        receipt.version = published.version;
        return;
      }
      await fs.rename(temporary, target);
      temporaryExists = false;
      if (receipt && receiptHandle) {
        const owned = await receiptHandle.stat({ bigint: true }), named = await fs.lstat(target, { bigint: true });
        if (!owned.isFile() || owned.nlink !== 1n || !named.isFile() || named.isSymbolicLink()
          || versionFingerprint(owned) !== versionFingerprint(named)
          || !written || owned.dev !== written.dev || owned.ino !== written.ino || owned.size !== written.size || owned.mtimeNs !== written.mtimeNs) throw stateConflict();
        // Rename itself can change ctime. An in-place external edit that restores
        // size/mtime must therefore be detected with bytes, not explained away
        // as rename metadata. Verify with constant extra memory on this write
        // path; conversation-detail reads never scan descendant histories.
        const expectedHash = createHash('sha256').update(serialized).update('\n').digest('hex');
        const actualHash = createHash('sha256'), buffer = Buffer.allocUnsafe(64 * 1024);
        let position = 0;
        while (position < Number(owned.size)) {
          const { bytesRead } = await receiptHandle.read(buffer, 0, Math.min(buffer.length, Number(owned.size) - position), position);
          if (!bytesRead) throw stateConflict();
          actualHash.update(buffer.subarray(0, bytesRead)); position += bytesRead;
        }
        const verified = await receiptHandle.stat({ bigint: true }), installed = await fs.lstat(target, { bigint: true });
        const currentDirectory = await fs.lstat(directoryPath!, { bigint: true });
        if (actualHash.digest('hex') !== expectedHash || versionFingerprint(verified) !== versionFingerprint(owned)
          || !installed.isFile() || installed.isSymbolicLink() || versionFingerprint(installed) !== versionFingerprint(verified)
          || !currentDirectory.isDirectory() || currentDirectory.isSymbolicLink() || !sameFileNode(currentDirectory, directoryStat!)
          || await fs.realpath(directoryPath!) !== directoryPath) throw stateConflict();
        // Rename can change ctime, so only the post-rename fingerprint is valid.
        receipt.version = versionFingerprint(verified);
      }
    } finally {
      if (handle) await handle.close().catch(() => undefined);
      await receiptHandle?.close().catch(() => undefined);
      if (temporaryExists) await fs.rm(temporary, { force: true }).catch(() => undefined);
      await directoryHandle?.close().catch(() => undefined);
      this.invalidate(file);
    }
  }

  write<T>(key: string, value: T): Promise<void> {
    const file = this.filename(key);
    const receipt = value && typeof value === 'object' ? this.writeVersions.get(value) : undefined;
    const snapshot = structuredClone(value);
    return this.enqueue(key, async () => {
      let expected: { snapshot: Snapshot | undefined } | undefined;
      if (receipt?.expectedDigest !== undefined) {
        // This digest identifies the complete logical JSON value, not its
        // whitespace or a later independent pathname observation. Both the
        // comparison and the guarded replacement stay inside the same queue.
        const current = await readConditionalJsonSource(this.directory, key);
        let digest: string | undefined;
        if (current) {
          try { digest = createHash('sha256').update(JSON.stringify(JSON.parse(current.serialized))).digest('hex'); }
          catch { throw stateConflict(); }
        }
        if (digest !== receipt.expectedDigest) throw stateConflict();
        expected = { snapshot: current };
      }
      await this.writeDirect(file, snapshot, expected, receipt);
    });
  }

  /** The clone is taken synchronously before write() enqueues its operation.
   * Metadata prepared in the same synchronous section can therefore be paired
   * with this operation's receipt even while a live record continues changing.
   * Keeping write() as the actual writer also preserves explicit before/after
   * failure injection and instrumentation on the existing storage API. */
  async writeWithVersion<T extends object>(key: string, value: T, options: JsonStoreWriteVersionOptions = {}): Promise<JsonStoreWriteVersion> {
    if (options.expectedDigest !== undefined && !/^[a-f0-9]{64}$/.test(options.expectedDigest)) throw new TypeError('Expected JSON digest must be a SHA-256 hexadecimal string.');
    const snapshot = structuredClone(value), receipt: RequestedWriteVersion = { expectedDigest: options.expectedDigest };
    this.writeVersions.set(snapshot, receipt);
    try {
      await this.write(key, snapshot);
      if (!receipt.version) throw stateConflict();
      return { version: receipt.version };
    } finally { this.writeVersions.delete(snapshot); }
  }

  /** Only a caller holding exact signed pending-rewind authority may invoke
   * this. The callback must not read this same key through JsonStore while its
   * per-key queue is held; source existence/content checks belong to the helper. */
  recoverConditionalKey(key: string, input: ConditionalJsonRecoveryInput): Promise<boolean> {
    return this.mutateGuarded(key, () => recoverConditionalJsonKey(this.directory, key, input));
  }

  update<T>(key: string, fallback: T, updater: (current: T) => T | Promise<T>): Promise<T> {
    const file = this.filename(key);
    return this.enqueue(key, async () => {
      // Updaters always see real current bytes, even when a read cache is warm.
      const snapshot = await this.loadSnapshot(file, true);
      const current = snapshot ? JSON.parse(snapshot.serialized) as T : structuredClone(fallback);
      const next = await updater(current);
      await this.writeDirect(file, next, { snapshot });
      return structuredClone(next);
    });
  }

  delete(key: string): Promise<void> {
    const file = this.filename(key);
    return this.enqueue(key, async () => {
      this.invalidate(file);
      try { await fs.rm(file, { force: true }); }
      finally { this.invalidate(file); }
    });
  }

  async flush(): Promise<void> {
    // Shutdown must still wait for the other keys when one write fails. A
    // fail-fast Promise.all could let process exit interrupt their publication.
    const results = await Promise.allSettled([...this.queues.values()]);
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason);
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, 'Some workspace state could not be saved.');
  }
}

export class SecretStore {
  constructor(private store: JsonStore, private encryptionKey: string) {}

  async get(name: string): Promise<string | undefined> {
    const all = await this.store.read<Record<string, string>>('protected-credentials', {});
    const value = all[name];
    if (!value) return undefined;
    return decryptBuffer(Buffer.from(value, 'base64'), this.encryptionKey).toString('utf8');
  }

  async set(name: string, value: string): Promise<void> {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(name)) throw new Error('Invalid credential name.');
    const protectedValue = encryptBuffer(Buffer.from(value), this.encryptionKey).toString('base64');
    await this.store.update<Record<string, string>>('protected-credentials', {}, current => ({ ...current, [name]: protectedValue }));
  }

  async delete(name: string): Promise<void> {
    await this.store.update<Record<string, string>>('protected-credentials', {}, current => { delete current[name]; return current; });
  }
}
