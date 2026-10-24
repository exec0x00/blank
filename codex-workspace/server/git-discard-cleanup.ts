import { constants, promises as fs, type BigIntStats } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { AppContext } from './context';
import { HttpError } from './errors';
import type { WorkspaceArtifactCleanupRequest } from './workspace-trash/service';
import { workspaceActivityKinds, workspaceRecoveryBarrier } from './worktrees/activity';

type CleanupContext = Pick<AppContext, 'config' | 'store'>;
type BackupOwner = { workspaceId: string; createdAt: string };
type BackupName = { name: string; key: string };
type BackupReference = BackupName & BackupOwner & { bytes: number; sha256: string; version: string };
type Failure = 'unsafe' | 'ownership' | 'changed' | 'limit';

export const GIT_DISCARD_CLEANUP_LIMITS = Object.freeze({
  directoryEntries: 100_000, records: 8192, recordBytes: 80 * 1024 * 1024,
  snapshotBytes: 50 * 1024 * 1024, files: 5000, pathBytes: 512 * 1024,
  totalReadBytes: 2 * 1024 * 1024 * 1024, milliseconds: 120_000,
});
const workspaceId = /^[a-zA-Z0-9_-]{1,128}$/;
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
// JsonStore can leave its exact, still source-bearing temporary name after a
// process stops. It shares the canonical record's per-key serialization.
const backupName = new RegExp(`^(git-discard-${uuid})\\.json(?:\\.${uuid}\\.tmp)?$`);
const fingerprint = (stat: BigIntStats) => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
const sameNode = (left: BigIntStats, right: BigIntStats) => left.dev === right.dev && left.ino === right.ino;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function failure(reason: Failure = 'ownership'): HttpError {
  return new HttpError(409, reason === 'limit'
    ? 'Git discard backup cleanup reached its bounded storage limit. Remaining backups were retained for retry.'
    : 'Git discard backup ownership or storage changed. Remaining backups were retained and permanent deletion can be retried.',
  `WORKSPACE_GIT_DISCARD_CLEANUP_${reason.toUpperCase()}`);
}

function exactKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function contentBytes(value: unknown): number {
  if (typeof value !== 'string' || value.length > Math.ceil(GIT_DISCARD_CLEANUP_LIMITS.snapshotBytes / 3) * 4
    || value.length % 4 || /[^A-Za-z0-9+/=]/.test(value)) throw failure();
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  if (value.indexOf('=') !== (padding ? value.length - padding : -1)) throw failure();
  // Checking just the final quartet rejects noncanonical padding bits without
  // allocating another complete decoded/encoded 50 MiB snapshot.
  const tail = value.slice(-4);
  if (Buffer.from(tail, 'base64').toString('base64') !== tail) throw failure();
  return value.length / 4 * 3 - padding;
}

/** Validate the actual GitService backup format without initializing Git or a
 * workspace. Legacy records carry workspace/time ownership, not an invented
 * repository generation; the lifecycle's assertCurrent supplies that fence. */
function owner(value: unknown): BackupOwner {
  if (!isObject(value) || !exactKeys(value, ['workspaceId', 'createdAt', 'state', 'files'])
    || typeof value.workspaceId !== 'string' || !workspaceId.test(value.workspaceId)
    || !timestamp(value.createdAt) || typeof value.state !== 'string' || !['pending', 'ready', 'restored'].includes(value.state)
    || !Array.isArray(value.files) || !value.files.length || value.files.length > GIT_DISCARD_CLEANUP_LIMITS.files) throw failure();
  let total = 0, paths = 0;
  const seen = new Set<string>();
  for (const entry of value.files) {
    if (!isObject(entry) || !exactKeys(entry, ['path', 'before', 'after']) || typeof entry.path !== 'string'
      || !entry.path.length || entry.path.length > 4096 || entry.path.includes('\0') || path.posix.isAbsolute(entry.path)
      || entry.path.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')
      || seen.has(entry.path) || !isObject(entry.before)) throw failure();
    seen.add(entry.path); paths += Buffer.byteLength(entry.path) + 1;
    if (paths > GIT_DISCARD_CLEANUP_LIMITS.pathBytes) throw failure('limit');
    const before = entry.before;
    if (before.kind === 'missing') {
      if (!exactKeys(before, ['kind'])) throw failure();
    } else if (before.kind === 'file' || before.kind === 'symlink') {
      if (!exactKeys(before, ['kind', 'content', 'mode']) || typeof before.mode !== 'number'
        || !Number.isInteger(before.mode) || before.mode < 0 || before.mode > 0o777) throw failure();
      total += contentBytes(before.content);
      if (total > GIT_DISCARD_CLEANUP_LIMITS.snapshotBytes) throw failure('limit');
    } else throw failure();
    if (value.state === 'pending' ? 'after' in entry : typeof entry.after !== 'string' || !/^[a-f0-9]{64}$/.test(entry.after)) throw failure();
  }
  return { workspaceId: value.workspaceId, createdAt: value.createdAt };
}

class DiscardCleanupFiles {
  private readBytes = 0;
  private readonly started = Date.now();
  private constructor(private readonly ctx: CleanupContext, private readonly request: WorkspaceArtifactCleanupRequest,
    private readonly handle: Awaited<ReturnType<typeof fs.open>>, private readonly directoryStat: BigIntStats) {}

  static async open(ctx: CleanupContext, request: WorkspaceArtifactCleanupRequest): Promise<DiscardCleanupFiles> {
    const directory = path.resolve(ctx.config.stateDir);
    if (directory !== ctx.config.stateDir || path.resolve(ctx.store.directory) !== directory) throw failure('unsafe');
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      const before = await fs.lstat(directory, { bigint: true });
      if (!before.isDirectory() || before.isSymbolicLink() || await fs.realpath(directory) !== directory) throw failure('unsafe');
      handle = await fs.open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      const opened = await handle.stat({ bigint: true });
      if (!opened.isDirectory() || !sameNode(before, opened)) throw failure('changed');
      return new DiscardCleanupFiles(ctx, request, handle, opened);
    } catch (error) { await handle?.close(); throw error; }
  }

  private access(name: string): string {
    if (!backupName.test(name)) throw failure('unsafe');
    return `/proc/self/fd/${this.handle.fd}/${name}`;
  }

  async check(): Promise<void> {
    if (Date.now() - this.started > GIT_DISCARD_CLEANUP_LIMITS.milliseconds) throw failure('limit');
    const admission = workspaceActivityKinds(this.ctx.config.workspacesDir, this.request.workspaceId);
    if (!admission.exclusive || workspaceRecoveryBarrier(this.ctx.config.workspacesDir, this.request.workspaceId)
      || Object.values(admission.counts).some(count => count)) throw removalRequired();
    await this.request.assertCurrent();
    const current = await fs.lstat(this.ctx.config.stateDir, { bigint: true });
    if (!current.isDirectory() || current.isSymbolicLink() || !sameNode(current, this.directoryStat)
      || !sameNode(await this.handle.stat({ bigint: true }), this.directoryStat)
      || await fs.realpath(this.ctx.config.stateDir) !== this.ctx.config.stateDir) throw failure('changed');
  }

  async names(): Promise<BackupName[]> {
    await this.check();
    const directory = await fs.opendir(`/proc/self/fd/${this.handle.fd}`, { bufferSize: 32 });
    const names: BackupName[] = [];
    let scanned = 0;
    for await (const entry of directory) {
      if (++scanned > GIT_DISCARD_CLEANUP_LIMITS.directoryEntries) throw failure('limit');
      if (!entry.name.startsWith('git-discard-')) continue;
      const match = backupName.exec(entry.name);
      // An ambiguous source-bearing backup name is retained, not silently
      // swept or counted as a successfully completed workspace purge.
      if (!match) throw failure();
      if (names.length >= GIT_DISCARD_CLEANUP_LIMITS.records) throw failure('limit');
      names.push({ name: entry.name, key: match[1] });
    }
    await this.check();
    return names.sort((left, right) => left.name.localeCompare(right.name));
  }

  async read(entry: BackupName): Promise<BackupReference | undefined> {
    await this.check();
    const target = this.access(entry.name);
    let before: BigIntStats;
    try { before = await fs.lstat(target, { bigint: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.dev !== this.directoryStat.dev) throw failure('unsafe');
    if (before.size < 2n || before.size > BigInt(GIT_DISCARD_CLEANUP_LIMITS.recordBytes)) throw failure('limit');
    const bytes = Number(before.size);
    this.readBytes += bytes;
    if (this.readBytes > GIT_DISCARD_CLEANUP_LIMITS.totalReadBytes) throw failure('limit');
    const handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const opened = await handle.stat({ bigint: true });
      if (!opened.isFile() || opened.nlink !== 1n || fingerprint(opened) !== fingerprint(before)) throw failure('changed');
      const buffer = Buffer.allocUnsafe(bytes + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const read = await handle.read(buffer, offset, Math.min(64 * 1024, buffer.length - offset), offset);
        if (!read.bytesRead) break;
        offset += read.bytesRead;
      }
      if (offset !== bytes || fingerprint(await handle.stat({ bigint: true })) !== fingerprint(before)
        || fingerprint(await fs.lstat(target, { bigint: true })) !== fingerprint(before)) throw failure('changed');
      await this.check();
      const body = buffer.subarray(0, bytes);
      let value: unknown;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
      catch { throw failure(); }
      const ownership = owner(value);
      if (ownership.workspaceId === this.request.workspaceId && Date.parse(ownership.createdAt) > Date.parse(this.request.deletedAt)) throw failure('changed');
      return { ...entry, ...ownership, bytes, sha256: createHash('sha256').update(body).digest('hex'), version: fingerprint(before) };
    } finally { await handle.close(); }
  }

  async inventory(): Promise<BackupReference[]> {
    const owned: BackupReference[] = [], keyOwners = new Map<string, string>();
    for (const entry of await this.names()) {
      const reference = await this.read(entry);
      if (!reference) continue;
      const previous = keyOwners.get(reference.key);
      if (previous && previous !== reference.workspaceId) throw failure();
      keyOwners.set(reference.key, reference.workspaceId);
      if (reference.workspaceId === this.request.workspaceId) owned.push(reference);
    }
    return owned;
  }

  async remove(reference: BackupReference): Promise<void> {
    await this.ctx.store.mutateGuarded(reference.key, async () => {
      const current = await this.read(reference);
      if (!current) return;
      if (current.workspaceId !== reference.workspaceId || current.createdAt !== reference.createdAt
        || current.sha256 !== reference.sha256 || current.bytes !== reference.bytes || current.version !== reference.version) throw failure('changed');
      await this.check();
      const target = this.access(reference.name);
      if (fingerprint(await fs.lstat(target, { bigint: true })) !== current.version) throw failure('changed');
      // App Git writers are fenced by the caller's removal admission and the
      // actual shared JsonStore queue. Native bucket unlink is not distributed
      // CAS; detected outside edits are retained rather than retried blindly.
      await fs.unlink(target);
      await this.check();
      try { await fs.lstat(target); throw failure('changed'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    });
  }

  async close(): Promise<void> { await this.handle.close(); }
}

function removalRequired(): HttpError {
  return new HttpError(409, 'Git discard backup cleanup requires the existing exclusive workspace removal operation.',
    'WORKSPACE_GIT_DISCARD_REMOVAL_REQUIRED');
}

/** Permanent-purge leaf, including an expired ordinary trash entry. The caller
 * owns the exact lifecycle generation and removal gate; this helper never
 * initializes services, looks up a live checkout, or executes a Git command. */
export async function cleanupWorkspaceGitDiscardBackups(ctx: CleanupContext, request: WorkspaceArtifactCleanupRequest): Promise<void> {
  if (!request || typeof request.workspaceId !== 'string' || !workspaceId.test(request.workspaceId)
    || typeof request.deletionId !== 'string' || !workspaceId.test(request.deletionId)
    || request.mode !== 'trash' && request.mode !== 'permanent' || !timestamp(request.deletedAt)
    || typeof request.assertCurrent !== 'function') throw failure();
  const admission = workspaceActivityKinds(ctx.config.workspacesDir, request.workspaceId);
  if (!admission.exclusive || workspaceRecoveryBarrier(ctx.config.workspacesDir, request.workspaceId)
    || Object.values(admission.counts).some(count => count)) throw removalRequired();
  await request.assertCurrent();
  const files = await DiscardCleanupFiles.open(ctx, request);
  try {
    // Complete validation precedes any unlink; each leaf is then compared
    // again inside the real store's per-key queue. Retries need no live root.
    for (const reference of await files.inventory()) await files.remove(reference);
    if ((await files.inventory()).length) throw failure('changed');
    await files.check();
  } finally { await files.close(); }
}
