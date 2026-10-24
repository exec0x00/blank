import { constants, promises as fs, type BigIntStats } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { AppContext } from '../context';
import { HttpError } from '../errors';
import type { WorkspaceArtifactCleanupRequest } from '../workspace-trash/service';

export const WORKSPACE_CONVERSATION_CLEANUP_LIMITS = Object.freeze({ directoryEntries: 100_000,
  records: 32_768, recordBytes: 32 * 1024 * 1024, aggregateBytes: 128 * 1024 * 1024,
  receiptBytes: 8 * 1024 * 1024, totalReadBytes: 2 * 1024 * 1024 * 1024, milliseconds: 120_000 });
const keyPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,180}$/;
const fingerprint = (s: BigIntStats) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
const sameNode = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino;
export const cleanupDigest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const conversationCleanupFailure = (reason: 'unsafe' | 'changed' | 'ownership' | 'limit' = 'ownership'): HttpError => new HttpError(409,
  reason === 'limit' ? 'Saved conversation cleanup reached its bounded storage limit. Remaining data was retained for retry.'
    : 'Saved conversation ownership or storage changed. Remaining data was retained and permanent deletion can be retried.',
  `WORKSPACE_CONVERSATION_CLEANUP_${reason.toUpperCase()}`);
export interface CleanupFile { key: string; value: unknown; sha256: string; digest: string; bytes: number; version: string }
export interface CleanupFileReference { key: string; sha256: string; bytes: number }

/** Leaf access stays relative to this open descriptor. The public bucket is not
 * a distributed CAS filesystem: an uncooperative outside writer can still race
 * the final name check. App writers are fenced and share the actual JsonStore
 * queue; detected outside edits are never silently discarded. */
export class ConversationCleanupFiles {
  private reads = 0;
  private readonly started = Date.now();
  private constructor(private readonly ctx: AppContext, readonly request: WorkspaceArtifactCleanupRequest,
    private readonly handle: Awaited<ReturnType<typeof fs.open>>, private readonly directoryStat: BigIntStats) {}

  static async open(ctx: AppContext, request: WorkspaceArtifactCleanupRequest): Promise<ConversationCleanupFiles> {
    const directory = path.resolve(ctx.config.stateDir);
    if (directory !== ctx.config.stateDir || path.resolve(ctx.store.directory) !== directory) throw conversationCleanupFailure('unsafe');
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      const before = await fs.lstat(directory, { bigint: true });
      if (!before.isDirectory() || before.isSymbolicLink() || await fs.realpath(directory) !== directory) throw conversationCleanupFailure('unsafe');
      handle = await fs.open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      const opened = await handle.stat({ bigint: true });
      if (!opened.isDirectory() || !sameNode(before, opened)) throw conversationCleanupFailure('changed');
      return new ConversationCleanupFiles(ctx, request, handle, opened);
    } catch (error) { await handle?.close(); throw error; }
  }

  private access(key: string): string {
    if (!keyPattern.test(key)) throw conversationCleanupFailure('unsafe');
    return `/proc/self/fd/${this.handle.fd}/${key}.json`;
  }

  async check(): Promise<void> {
    if (Date.now() - this.started > WORKSPACE_CONVERSATION_CLEANUP_LIMITS.milliseconds) throw conversationCleanupFailure('limit');
    const current = await fs.lstat(this.ctx.config.stateDir, { bigint: true });
    if (!current.isDirectory() || current.isSymbolicLink() || !sameNode(current, this.directoryStat)
      || !sameNode(await this.handle.stat({ bigint: true }), this.directoryStat)
      || await fs.realpath(this.ctx.config.stateDir) !== this.ctx.config.stateDir) throw conversationCleanupFailure('changed');
  }

  async inventory(): Promise<string[]> {
    await this.check();
    const directory = await fs.opendir(`/proc/self/fd/${this.handle.fd}`, { bufferSize: 32 }), keys: string[] = [];
    let count = 0;
    for await (const entry of directory) {
      if (++count > WORKSPACE_CONVERSATION_CLEANUP_LIMITS.directoryEntries) throw conversationCleanupFailure('limit');
      // JsonStore's interrupted write files can contain whole histories. Until
      // their ownership is explicitly recoverable, never call a purge complete
      // while silently leaving one of these source-bearing temporary records.
      if (/^(?:thread-[a-zA-Z0-9_-]+|agent-thr_[a-f0-9]{32}|agent-changes|review-snapshot-[a-zA-Z0-9_-]+)\.json\.[a-f0-9-]{36}\.tmp$/.test(entry.name)) throw conversationCleanupFailure();
      if (/^\.conversation-cleanup-[a-f0-9-]{36}\.tmp$/.test(entry.name)) throw conversationCleanupFailure();
      if (!entry.name.endsWith('.json')) continue;
      const key = entry.name.slice(0, -5);
      if (keyPattern.test(key)) keys.push(key);
    }
    await this.check();
    return keys.sort();
  }

  async read(key: string, limit: number = WORKSPACE_CONVERSATION_CLEANUP_LIMITS.recordBytes): Promise<CleanupFile | undefined> {
    await this.check();
    const file = this.access(key);
    let before: BigIntStats;
    try { before = await fs.lstat(file, { bigint: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.dev !== this.directoryStat.dev) throw conversationCleanupFailure('unsafe');
    if (before.size < 2n || before.size > BigInt(limit)) throw conversationCleanupFailure('limit');
    const bytes = Number(before.size);
    this.reads += bytes;
    if (this.reads > WORKSPACE_CONVERSATION_CLEANUP_LIMITS.totalReadBytes) throw conversationCleanupFailure('limit');
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const opened = await handle.stat({ bigint: true });
      if (!opened.isFile() || fingerprint(opened) !== fingerprint(before)) throw conversationCleanupFailure('changed');
      const buffer = Buffer.allocUnsafe(bytes + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const read = await handle.read(buffer, offset, Math.min(buffer.length - offset, 64 * 1024), offset);
        if (!read.bytesRead) break;
        offset += read.bytesRead;
      }
      if (offset !== bytes || fingerprint(await handle.stat({ bigint: true })) !== fingerprint(before)
        || fingerprint(await fs.lstat(file, { bigint: true })) !== fingerprint(before)) throw conversationCleanupFailure('changed');
      await this.check();
      let value: unknown;
      try { value = JSON.parse(buffer.subarray(0, bytes).toString('utf8')); }
      catch { throw conversationCleanupFailure(); }
      return { key, value, bytes, version: fingerprint(before), digest: cleanupDigest(value),
        sha256: createHash('sha256').update(buffer.subarray(0, bytes)).digest('hex') };
    } finally { await handle.close(); }
  }

  async remove(reference: CleanupFileReference): Promise<void> {
    await this.ctx.store.mutateGuarded(reference.key, async () => {
      const current = await this.read(reference.key);
      if (!current) return;
      if (current.sha256 !== reference.sha256 || current.bytes !== reference.bytes) throw conversationCleanupFailure('changed');
      await this.request.assertCurrent(); await this.check();
      if (fingerprint(await fs.lstat(this.access(reference.key), { bigint: true })) !== current.version) throw conversationCleanupFailure('changed');
      await fs.unlink(this.access(reference.key));
      await this.check();
      try { await fs.lstat(this.access(reference.key)); throw conversationCleanupFailure('changed'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    });
  }

  async update(key: string, limit: number, transform: (current: unknown | undefined) => unknown | Promise<unknown>): Promise<void> {
    await this.ctx.store.mutateGuarded(key, async () => {
      const before = await this.read(key, limit), next = await transform(before?.value);
      if (next === undefined) return;
      if (before && cleanupDigest(next) === before.digest) return;
      const bytes = Buffer.from(JSON.stringify(next, null, 2) + '\n');
      if (bytes.length > limit) throw conversationCleanupFailure('limit');
      await this.request.assertCurrent(); await this.check();
      const temporary = `/proc/self/fd/${this.handle.fd}/.conversation-cleanup-${randomUUID()}.tmp`;
      let file: Awaited<ReturnType<typeof fs.open>> | undefined;
      let created = false;
      try {
        file = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        created = true; await file.writeFile(bytes); await file.close(); file = undefined;
        const current = await this.read(key, limit);
        if (current?.sha256 !== before?.sha256 || current?.version !== before?.version) throw conversationCleanupFailure('changed');
        await this.request.assertCurrent(); await this.check();
        const final = await this.read(key, limit);
        if (final?.sha256 !== before?.sha256 || final?.version !== before?.version) throw conversationCleanupFailure('changed');
        await fs.rename(temporary, this.access(key)); created = false;
        const installed = await this.read(key, limit);
        if (!installed || installed.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw conversationCleanupFailure('changed');
      } finally {
        await file?.close();
        if (created) await fs.unlink(temporary).catch(() => undefined);
      }
    });
  }

  async close(): Promise<void> { await this.handle.close(); }
}
