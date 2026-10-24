import { createHash, randomUUID } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { HttpError } from '../errors';
import type { DurableFileReceipt } from '../file-transfers/durability';
import type { GitCheckpointFile, GitCheckpointIdentity, GitCheckpointIndex, GitCheckpointRepository } from '../git-checkpoints/types';
import { FILE_REWIND_LIMITS, RewindDirectory, hashBytes, isErrno, missingRewindFile,
  observeRewindPath, readRewindEntry, readRewindJSON, receiptFor, rewindConflict, rewindIdentity,
  rewindLimit, rewindParent, rewindUnsafe, safeRewindAbsolute, safeRewindRelative, sameRewindIdentity,
  sameRewindState, sameRewindVersion, validateRewindFile, withinRewind, writeRewindFile,
  type RewindIOChecks, type RewindParent } from './file-rewind-transaction-io';

export { FILE_REWIND_LIMITS } from './file-rewind-transaction-io';
export interface FileRewindMetadataExpectation {
  absolute: string;
  kind: GitCheckpointFile['kind'];
  mode: number;
  bytes: number;
  sha256: string | null;
  /** Raw link target; never dereference it while checking metadata. */
  linkTargetBase64?: string;
}
export interface FileRewindTransactionOptions {
  /** Dedicated ordinary durable directory under stateDir, outside the checkout. */
  directory: string;
  requireDurableReceipt?: boolean;
  verifyDurable?: (receipts: readonly DurableFileReceipt[]) => Promise<void>;
  verifyAbsent?: (absolutePaths: readonly string[]) => Promise<void>;
  /** Capture and durably verify actual native link/mode metadata, including omissions. */
  verifyMetadata?: (entries: readonly FileRewindMetadataExpectation[]) => Promise<void>;
  /** Caller holds history maintenance plus exclusive workspace/repository admission. */
  checkAllowed: () => Promise<void>;
  checkResources?: () => Promise<void>;
  signal?: AbortSignal;
}
export interface FileRewindPathPlan {
  expected: GitCheckpointFile;
  restore: GitCheckpointFile;
  /** Immutable, already authorized checkpoint bytes; symlink bytes are its target. */
  readRestore: () => Promise<Buffer>;
}
export interface FileRewindTransactionPlan {
  id?: string;
  workspaceId: string;
  threadId: string;
  repository: GitCheckpointRepository;
  files: FileRewindPathPlan[];
  index?: {
    expected: GitCheckpointIndex;
    /** Selectively rebuilt index retaining all unrelated current staging. Never a blind historical index. */
    restore: Buffer | null;
    /** All restored changed-path staged objects, including objects currently stored in packs. */
    objects?: Array<{ objectId: string; bytes: Buffer }>;
  };
}
export type FileRewindTransactionState = 'preparing' | 'prepared' | 'applying' | 'applied' | 'rolling_back'
  | 'rolled_back' | 'complete' | 'recovery_required';
export interface FileRewindTransactionStatus {
  id: string;
  workspaceId: string;
  threadId: string;
  state: FileRewindTransactionState;
  createdAt: string;
  updatedAt: string;
  paths: string[];
  appliedPaths: string[];
  indexChanged: boolean;
  backupsRetained: boolean;
  issues: string[];
  /** A restarted process reports evidence only. It never replays filesystem mutations. */
  automaticRecovery: false;
}
export class FileRewindTransactionError extends HttpError {
  constructor(message: string, readonly transaction: FileRewindTransactionStatus, readonly originalCode?: string) {
    super(transaction.state === 'recovery_required' ? 409 : 422, message,
      transaction.state === 'recovery_required' ? 'FILE_REWIND_RECOVERY_REQUIRED' : 'FILE_REWIND_FAILED');
    this.name = 'FileRewindTransactionError';
  }
}
interface Unit {
  key: string;
  kind: 'workspace' | 'index';
  path: string;
  expected: GitCheckpointFile;
  desired: GitCheckpointFile;
  backup?: DurableFileReceipt;
  staged?: DurableFileReceipt;
  phase: 'pending' | 'parking' | 'parked' | 'installing' | 'applied' | 'restored';
  parked?: GitCheckpointFile;
  applied?: GitCheckpointFile;
}
interface ObjectMaterial { objectId: string; bytes: number; rawSha256: string; receipt: DurableFileReceipt; name: string }
interface CreatedDirectory { path: string; identity: GitCheckpointIdentity }
interface StoredManifest {
  version: 1; id: string; workspaceId: string; threadId: string; createdAt: string;
  repository: GitCheckpointRepository; units: Unit[]; objects: ObjectMaterial[];
  limitations: string[];
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const validOwner = (value: string): boolean => typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f/\\]/.test(value);
const statusValues = new Set<FileRewindTransactionState>(['preparing', 'prepared', 'applying', 'applied', 'rolling_back', 'rolled_back', 'complete', 'recovery_required']);
const changesStoredMetadata = (before: GitCheckpointFile, after: GitCheckpointFile): boolean => before.kind === 'symlink' || after.kind === 'symlink'
  || before.kind === 'file' && before.mode !== 0o644 || after.kind === 'file' && after.mode !== 0o644;
const cloneFile = (file: GitCheckpointFile): GitCheckpointFile => ({ ...file, identity: file.identity && { ...file.identity } });
const safeIssue = (error: unknown): string => error instanceof HttpError && error.code?.startsWith('FILE_REWIND_')
  ? error.message.slice(0, 700) : 'The rewind could not finish its storage or identity checks. Inspect the retained recovery files before retrying.';

function checkIndex(bytes: Buffer, repository: GitCheckpointRepository): void {
  const digestBytes = repository.objectFormat === 'sha256' ? 32 : 20;
  if (bytes.length > FILE_REWIND_LIMITS.fileBytes || bytes.length < 12 + digestBytes
    || bytes.toString('ascii', 0, 4) !== 'DIRC' || ![2, 3, 4].includes(bytes.readUInt32BE(4))
    || bytes.readUInt32BE(8) > 50_000) rewindUnsafe();
  const digest = createHash(repository.objectFormat).update(bytes.subarray(0, -digestBytes)).digest();
  if (!digest.equals(bytes.subarray(-digestBytes))) rewindConflict('The prepared Git index failed its checksum check. The current index was retained.');
}

/**
 * File/index rewind is a guarded transaction, not a Git reset. The caller
 * supplies only agent-attributed paths and a selective index. Every original
 * and requested byte sequence is durably copied before mutation. Current
 * entries are parked (never destroyed) before O_EXCL installation; unknown
 * path claims and rollback conflicts keep both versions for inspection.
 *
 * Node has no atomic compare-and-rename primitive. A writer bypassing app/Git
 * admission can still race the final path syscall. Parking retains that raced
 * entry; post-move checks stop and expose recovery rather than silently erasing
 * it. No HEAD, refs, hooks, network, clean, checkout, or subprocess is involved.
 */
export class FileRewindTransaction implements RewindIOChecks {
  private id: string = randomUUID();
  private workspaceId = '';
  private threadId = '';
  private state: FileRewindTransactionState = 'preparing';
  private createdAt = new Date().toISOString();
  private updatedAt = this.createdAt;
  private issues: string[] = [];
  private repository?: GitCheckpointRepository;
  private units: Unit[] = [];
  private objects: ObjectMaterial[] = [];
  private createdDirectories: CreatedDirectory[] = [];
  private pins: RewindDirectory[] = [];
  private base?: RewindDirectory;
  private transaction?: RewindDirectory;
  private before?: RewindDirectory;
  private after?: RewindDirectory;
  private parked?: RewindDirectory;
  private events?: RewindDirectory;
  private objectStage?: RewindDirectory;
  private root?: RewindDirectory;
  private git?: RewindDirectory;
  private common?: RewindDirectory;
  private lock?: { handle: FileHandle; state: GitCheckpointFile };
  private sequence = 0;
  private reservedBytes = 0;
  private deadline = Date.now() + FILE_REWIND_LIMITS.milliseconds;
  private nextResourceCheck = 0;
  private storedPayload = false;
  private incompleteObjects = new Set<string>();
  private verifiedObjects = new Map<string, GitCheckpointFile>();
  private incompleteIndexLock = false;
  private commitEntered = false;
  private rollbackAttempted = false;
  private closed = false;
  private busy = false;
  private ignoringCancellation = false;

  constructor(private readonly options: FileRewindTransactionOptions) {
    safeRewindAbsolute(options.directory);
    if (typeof options.checkAllowed !== 'function' || options.requireDurableReceipt && (!options.verifyDurable || !options.verifyAbsent)) {
      throw new HttpError(503, 'File rewind needs verified durable storage, deletion receipts and exclusive workspace admission.', 'FILE_REWIND_DURABILITY_REQUIRED');
    }
  }

  status(): FileRewindTransactionStatus {
    return { id: this.id, workspaceId: this.workspaceId, threadId: this.threadId, state: this.state,
      createdAt: this.createdAt, updatedAt: this.updatedAt,
      paths: this.units.filter(unit => unit.kind === 'workspace').map(unit => unit.path),
      appliedPaths: this.units.filter(unit => unit.kind === 'workspace' && unit.phase === 'applied').map(unit => unit.path),
      indexChanged: this.units.some(unit => unit.kind === 'index' && unit.phase === 'applied'),
      backupsRetained: this.storedPayload, issues: [...this.issues], automaticRecovery: false };
  }

  /** Used by bounded reads/writes; never treats directory byte size as RAM. */
  async check(): Promise<void> {
    if (this.closed) throw new HttpError(409, 'This file rewind transaction is closed.', 'FILE_REWIND_CLOSED');
    if (!this.ignoringCancellation) this.options.signal?.throwIfAborted();
    if (Date.now() > this.deadline) rewindLimit();
    if (Date.now() >= this.nextResourceCheck) {
      await this.options.checkResources?.(); this.nextResourceCheck = Date.now() + 1_000;
    }
  }
  private async allowed(): Promise<void> {
    await this.check(); await this.options.checkAllowed();
    await this.root?.check(); await this.git?.check(); await this.common?.check();
    await this.transaction?.check(); await this.parked?.check();
  }
  private reserve(bytes: number): void {
    this.reservedBytes += bytes;
    if (!Number.isSafeInteger(bytes) || bytes < 0 || this.reservedBytes > FILE_REWIND_LIMITS.totalBytes) rewindLimit();
  }
  private async durable(receipts: readonly DurableFileReceipt[]): Promise<void> {
    await this.check();
    if (receipts.length) await this.options.verifyDurable?.(receipts);
    await this.check();
  }
  private async pin(directory: RewindDirectory): Promise<RewindDirectory> { this.pins.push(directory); return directory; }
  private async event(type: string, detail: Record<string, unknown> = {}): Promise<void> {
    if (!this.events || ++this.sequence > FILE_REWIND_LIMITS.events) rewindLimit();
    this.updatedAt = new Date().toISOString();
    const { paths: _paths, appliedPaths: _appliedPaths, ...status } = this.status();
    const bytes = Buffer.from(JSON.stringify({ version: 1, id: this.id, sequence: this.sequence, at: this.updatedAt,
      type, state: this.state, ...detail, status,
      appliedKeys: this.units.filter(unit => unit.kind === 'workspace' && unit.phase === 'applied').map(unit => unit.key) }) + '\n');
    if (bytes.length > FILE_REWIND_LIMITS.metadataBytes) rewindLimit();
    const name = `${String(this.sequence).padStart(8, '0')}.json`;
    await writeRewindFile(this.events, name, bytes, 0o600, this); await this.events.sync();
    await this.durable([receiptFor(this.events, name, bytes)]);
  }
  private failure(error: unknown): FileRewindTransactionError {
    const message = this.state === 'rolled_back'
      ? 'The file rewind did not finish. Its own applied changes were rolled back; retained backups can be inspected.'
      : 'The file rewind needs recovery. Current paths, displaced originals and durable backups were retained; no automatic replay will run.';
    return new FileRewindTransactionError(message, this.status(), error instanceof HttpError ? error.code : undefined);
  }
  private async recordFailure(error: unknown): Promise<void> {
    this.state = 'recovery_required';
    const issue = safeIssue(error);
    if (!this.issues.includes(issue)) this.issues.push(issue);
    this.issues = this.issues.slice(-12);
    await this.event('recovery_required', { issue }).catch(() => undefined);
  }

  async prepare(plan: FileRewindTransactionPlan): Promise<FileRewindTransactionStatus> {
    if (this.busy || this.transaction || this.closed) throw new HttpError(409, 'This rewind is already prepared or closed.', 'FILE_REWIND_STATE');
    if (!validOwner(plan.workspaceId) || !validOwner(plan.threadId) || plan.id !== undefined && !UUID.test(plan.id)
      || !Array.isArray(plan.files) || plan.files.length > FILE_REWIND_LIMITS.files) rewindUnsafe();
    for (const absolute of [plan.repository.root, plan.repository.gitDirectory, plan.repository.commonDirectory]) safeRewindAbsolute(absolute);
    if (!['sha1', 'sha256'].includes(plan.repository.objectFormat) || withinRewind(plan.repository.root, this.options.directory)) rewindUnsafe();
    const names = new Set<string>();
    for (const file of plan.files) {
      validateRewindFile(file.expected, true); validateRewindFile(file.restore, false);
      if (file.expected.path !== file.restore.path || names.has(file.expected.path) || typeof file.readRestore !== 'function') rewindUnsafe();
      names.add(file.expected.path);
      if (this.options.requireDurableReceipt && !this.options.verifyMetadata && changesStoredMetadata(file.expected, file.restore)) {
        throw new HttpError(503, 'This native rewind changes link or permission metadata. Durable filesystem metadata verification is required before it can run.', 'FILE_REWIND_METADATA_REQUIRED');
      }
      if (this.options.requireDurableReceipt && !this.options.verifyAbsent
        && (file.restore.kind === 'missing' && file.expected.kind === 'file' || file.expected.kind === 'missing' && file.restore.kind === 'file')) {
        throw new HttpError(503, 'Persistent file deletion or rollback of a new file needs a verified absence receipt before rewind can run.', 'FILE_REWIND_DURABILITY_REQUIRED');
      }
    }
    const parents = new Set<string>();
    for (const relative of names) {
      const parts = relative.split('/');
      for (let index = 1; index < parts.length; index++) {
        const parent = parts.slice(0, index).join('/');
        if (names.has(parent)) rewindUnsafe();
        parents.add(parent);
      }
    }
    if (parents.size > FILE_REWIND_LIMITS.directories) rewindLimit();
    if (plan.index?.restore) checkIndex(plan.index.restore, plan.repository);
    if (this.options.requireDurableReceipt && plan.index && !this.options.verifyAbsent
      && (plan.index.restore === null && plan.index.expected.present || plan.index.restore !== null && !plan.index.expected.present)) {
      throw new HttpError(503, 'Persistent index deletion or rollback of a new index needs a verified absence receipt before rewind can run.', 'FILE_REWIND_DURABILITY_REQUIRED');
    }
    this.id = plan.id ?? this.id; this.workspaceId = plan.workspaceId; this.threadId = plan.threadId;
    this.repository = structuredClone(plan.repository); this.busy = true;
    try {
      await this.allowed();
      this.root = await this.pin(await RewindDirectory.open(plan.repository.root, undefined, plan.repository.rootIdentity));
      this.git = await this.pin(await RewindDirectory.open(plan.repository.gitDirectory, undefined, plan.repository.gitIdentity));
      this.common = await this.pin(await RewindDirectory.open(plan.repository.commonDirectory, undefined, plan.repository.commonIdentity));
      const parent = await RewindDirectory.open(path.dirname(this.options.directory));
      try {
        try { this.base = await this.pin(await parent.child(path.basename(this.options.directory))); }
        catch (error) { if (!isErrno(error, 'ENOENT')) throw error; this.base = await this.pin(await parent.child(path.basename(this.options.directory), true)); await parent.sync(); }
      } finally { await parent.close(); }
      if (this.base.identity.dev !== this.root.identity.dev || this.base.identity.dev !== this.git.identity.dev || this.base.identity.dev !== this.common.identity.dev) {
        throw new HttpError(409, 'The recovery store and checkout need the same native filesystem for safe original retention.', 'FILE_REWIND_FILESYSTEM');
      }
      // Creation is exclusive. A repeated id is not treated as permission to
      // overwrite or replay a prior transaction after a lost HTTP response.
      this.transaction = await this.pin(await this.base.child(this.id, true));
      const identityBytes = Buffer.from(JSON.stringify({ version: 1, id: this.id, workspaceId: this.workspaceId,
        threadId: this.threadId, createdAt: this.createdAt, paths: plan.files.map(file => file.expected.path) }) + '\n');
      if (identityBytes.length > FILE_REWIND_LIMITS.metadataBytes) rewindLimit();
      await writeRewindFile(this.transaction, 'identity.json', identityBytes, 0o600, this);
      await this.transaction.sync(); await this.base.sync();
      await this.durable([receiptFor(this.transaction, 'identity.json', identityBytes)]);
      this.before = await this.pin(await this.transaction.child('before', true));
      this.after = await this.pin(await this.transaction.child('after', true));
      this.parked = await this.pin(await this.transaction.child('parked', true));
      this.events = await this.pin(await this.transaction.child('events', true));
      this.objectStage = await this.pin(await this.transaction.child('objects', true));
      await this.transaction.sync(); await this.base.sync();
      const receipts: DurableFileReceipt[] = [];
      for (const file of plan.files) {
        await this.allowed();
        const observed = await observeRewindPath(this.root, file.expected.path, this);
        if (!sameRewindState(observed.state, file.expected)) rewindConflict();
        const bytes = file.restore.kind === 'missing' ? null : await file.readRestore();
        const unit = await this.stageUnit('workspace', file.expected.path, observed.state, file.restore, observed.bytes, bytes);
        this.units.push(unit);
        if (unit.backup) receipts.push(unit.backup);
        if (unit.staged) receipts.push(unit.staged);
      }
      if (plan.index) {
        await this.allowed();
        const observed = await readRewindEntry(this.git, 'index', 'index', this);
        if (observed.state.kind === 'symlink' || (observed.state.kind !== 'missing') !== plan.index.expected.present
          || observed.state.sha256 !== plan.index.expected.sha256 || observed.state.bytes !== plan.index.expected.bytes) rewindConflict('The Git index changed after the rewind preview. All current staging was retained.');
        const restore = plan.index.restore === null ? missingRewindFile('index')
          : { path: 'index', kind: 'file' as const, mode: observed.state.kind === 'missing' ? 0o644 : observed.state.mode,
            bytes: plan.index.restore.length, sha256: hashBytes(plan.index.restore), blob: null, tracked: false };
        if (this.options.requireDurableReceipt && !this.options.verifyMetadata && changesStoredMetadata(observed.state, restore)) {
          throw new HttpError(503, 'This native Git index rewind needs durable permission metadata verification before it can run.', 'FILE_REWIND_METADATA_REQUIRED');
        }
        const unit = await this.stageUnit('index', 'index', observed.state, restore, observed.bytes, plan.index.restore);
        this.units.push(unit);
        if (unit.backup) receipts.push(unit.backup);
        if (unit.staged) receipts.push(unit.staged);
        await this.stageObjects(plan.index.objects ?? [], receipts);
      }
      const manifest: StoredManifest = { version: 1, id: this.id, workspaceId: this.workspaceId, threadId: this.threadId,
        createdAt: this.createdAt, repository: this.repository!, units: this.units, objects: this.objects,
        limitations: ['Only the explicitly previewed agent-attributed paths are eligible.',
          'No HEAD or branch reset is performed. Unrelated staging must remain in the supplied selective index.',
          'External writers bypassing app/Git locks can race the final syscall; displaced entries are retained for recovery.',
          'No automatic destructive startup replay or backup deletion.'] };
      const manifestBytes = Buffer.from(JSON.stringify(manifest) + '\n');
      if (manifestBytes.length > FILE_REWIND_LIMITS.metadataBytes) rewindLimit();
      await writeRewindFile(this.transaction, 'manifest.json', manifestBytes, 0o600, this);
      await this.before.sync(); await this.after.sync(); await this.objectStage.sync(); await this.transaction.sync();
      receipts.push(receiptFor(this.transaction, 'manifest.json', manifestBytes));
      await this.durable(receipts); await this.validatePending();
      this.state = 'prepared'; await this.event('prepared');
      return this.status();
    } catch (error) { if (this.transaction) await this.recordFailure(error); throw this.transaction ? this.failure(error) : error; }
    finally { this.busy = false; }
  }

  private async stageUnit(kind: Unit['kind'], relative: string, expected: GitCheckpointFile, desired: GitCheckpointFile,
    original: Buffer | null, restored: Buffer | null): Promise<Unit> {
    const key = String(this.units.length).padStart(6, '0');
    const unit: Unit = { key, kind, path: relative, expected: cloneFile(expected), desired: cloneFile(desired), phase: 'pending' };
    if (original) {
      this.reserve(original.length);
      await writeRewindFile(this.before!, key, original, 0o600, this);
      this.storedPayload = true;
      unit.backup = receiptFor(this.before!, key, original);
    }
    if (desired.kind !== 'missing') {
      if (!Buffer.isBuffer(restored) || restored.length !== desired.bytes || hashBytes(restored) !== desired.sha256
        || desired.kind === 'symlink' && (restored.includes(0) || restored.length > 4_096)) rewindConflict('A checkpoint blob failed verification. The workspace was retained.');
      this.reserve(restored.length);
      await writeRewindFile(this.after!, key, restored, 0o600, this);
      this.storedPayload = true;
      unit.staged = receiptFor(this.after!, key, restored);
    } else if (restored !== null) rewindUnsafe();
    return unit;
  }

  private async stageObjects(materials: Array<{ objectId: string; bytes: Buffer }>, receipts: DurableFileReceipt[]): Promise<void> {
    if (materials.length > FILE_REWIND_LIMITS.files * 3) rewindLimit();
    const seen = new Set<string>(), algorithm = this.repository!.objectFormat;
    for (const material of materials) {
      await this.check();
      if (!Buffer.isBuffer(material.bytes) || material.bytes.length > FILE_REWIND_LIMITS.fileBytes
        || !new RegExp(`^[a-f0-9]{${algorithm === 'sha256' ? 64 : 40}}$`).test(material.objectId)) rewindUnsafe();
      const header = Buffer.from(`blob ${material.bytes.length}\0`);
      if (createHash(algorithm).update(header).update(material.bytes).digest('hex') !== material.objectId) rewindConflict('A historical staged object failed its Git hash check. The current index was retained.');
      if (seen.has(material.objectId)) continue;
      seen.add(material.objectId); this.reserve(material.bytes.length);
      const compressed = deflateSync(Buffer.concat([header, material.bytes]));
      if (compressed.length > FILE_REWIND_LIMITS.fileBytes) rewindLimit();
      const name = String(this.objects.length).padStart(6, '0');
      await writeRewindFile(this.objectStage!, name, compressed, 0o444, this);
      this.storedPayload = true;
      const receipt = receiptFor(this.objectStage!, name, compressed);
      this.objects.push({ objectId: material.objectId, bytes: material.bytes.length, rawSha256: hashBytes(material.bytes), receipt, name }); receipts.push(receipt);
    }
  }

  private async observed(unit: Unit): Promise<GitCheckpointFile> {
    return unit.kind === 'index' ? (await readRewindEntry(this.git!, 'index', 'index', this)).state
      : (await observeRewindPath(this.root!, unit.path, this)).state;
  }
  private async validatePending(): Promise<void> {
    await this.allowed();
    for (const unit of this.units) if (!sameRewindState(await this.observed(unit), unit.expected)) rewindConflict();
  }
  private async parentFor(unit: Unit, create: boolean): Promise<RewindParent | undefined> {
    if (unit.kind === 'index') return { directory: this.git!, name: 'index', close: async () => undefined };
    return rewindParent(this.root!, unit.path, { create,
      beforeCreate: async relative => { await this.allowed(); await this.event('directory_intent', { path: relative }); },
      created: async (relative, identity) => { this.createdDirectories.push({ path: relative, identity }); await this.event('directory_created', { path: relative, identity }); },
    });
  }
  private async readStaged(unit: Unit, original = false): Promise<Buffer | null> {
    const expected = original ? unit.backup : unit.staged;
    if (!expected) return null;
    const data = await readRewindEntry(original ? this.before! : this.after!, unit.key, unit.key, this);
    if (data.state.kind !== 'file' || data.state.bytes !== expected.size || data.state.sha256 !== expected.sha256) rewindConflict('A recovery copy changed. Existing workspace files were retained.');
    return data.bytes;
  }

  private async acquireIndexLock(): Promise<void> {
    await this.allowed();
    await this.event('index_lock_intent');
    const bytes = Buffer.from(`codex-file-rewind ${this.id}\n`);
    let handle: FileHandle;
    try { handle = await fs.open(`${this.git!.access}/index.lock`, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
    catch (error) {
      if (isErrno(error, 'EEXIST') || isErrno(error, 'ELOOP')) throw new HttpError(409, 'Another Git operation has an index lock. Its lock and staging were retained.', 'FILE_REWIND_GIT_LOCKED');
      throw error;
    }
    this.incompleteIndexLock = true;
    try {
      await handle.writeFile(bytes); await handle.sync();
      const identity = rewindIdentity(await handle.stat());
      this.lock = { handle, state: { path: 'index.lock', kind: 'file', mode: 0o600, bytes: bytes.length, sha256: hashBytes(bytes), blob: null, tracked: false, identity } };
      this.incompleteIndexLock = false;
      await this.git!.sync(); await this.checkIndexLock();
      await this.durable([receiptFor(this.git!, 'index.lock', bytes)]);
      await this.event('index_lock_acquired');
    } catch (error) { if (!this.lock) await handle.close(); throw error; }
  }
  private async checkIndexLock(): Promise<void> {
    if (!this.lock) rewindConflict('The rewind no longer owns the Git index lock. Current files and backups were retained.');
    const actual = await readRewindEntry(this.git!, 'index.lock', 'index.lock', this);
    if (!sameRewindState(actual.state, this.lock.state)) rewindConflict('The Git index lock changed. It was retained for its owner.');
  }
  private async releaseIndexLock(): Promise<void> {
    if (!this.lock) return;
    await this.checkIndexLock(); await this.git!.check();
    const expected = this.lock.state.identity!;
    if (!sameRewindVersion(rewindIdentity(await fs.lstat(`${this.git!.access}/index.lock`)), expected)) rewindConflict();
    await fs.unlink(`${this.git!.access}/index.lock`);
    await this.lock.handle.close(); this.lock = undefined; await this.git!.sync();
    await this.options.verifyAbsent?.([path.join(this.git!.absolute, 'index.lock')]);
  }

  private async installObjects(): Promise<void> {
    if (!this.objects.length) return;
    const objects = await this.common!.child('objects');
    try {
      for (const material of this.objects) {
        await this.allowed(); await this.checkIndexLock();
        const staged = await readRewindEntry(this.objectStage!, material.name, material.name, this);
        if (staged.state.kind !== 'file' || staged.state.sha256 !== material.receipt.sha256 || staged.state.bytes !== material.receipt.size) rewindConflict('A staged Git recovery object changed. The index was retained.');
        let directory: RewindDirectory;
        try { directory = await objects.child(material.objectId.slice(0, 2)); }
        catch (error) {
          if (!isErrno(error, 'ENOENT')) throw error;
          await this.event('object_directory_intent', { prefix: material.objectId.slice(0, 2) });
          try { directory = await objects.child(material.objectId.slice(0, 2), true); }
          catch (createError) { if (!isErrno(createError, 'EEXIST')) throw createError; directory = await objects.child(material.objectId.slice(0, 2)); }
          await objects.sync();
        }
        try {
          const name = material.objectId.slice(2);
          let existing = await readRewindEntry(directory, name, name, this);
          if (existing.state.kind === 'missing') {
            await this.event('object_intent', { objectId: material.objectId });
            this.incompleteObjects.add(material.objectId);
            // Publish a complete, verified immutable object without replacement.
            // A partial loose object can shadow a valid packed object, so no
            // streaming-to-final-name fallback is allowed on a native mount
            // which cannot perform this no-clobber operation.
            let published = false;
            try { await fs.link(`${this.objectStage!.access}/${material.name}`, `${directory.access}/${name}`); published = true; }
            catch (error) {
              if (isErrno(error, 'EEXIST')) this.incompleteObjects.delete(material.objectId);
              else if (['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV', 'ENOSYS', 'EINVAL'].some(code => isErrno(error, code))) {
                this.incompleteObjects.delete(material.objectId);
                throw new HttpError(409, 'The native filesystem cannot safely publish a missing historical Git object without replacement. Files and the index were retained.', 'FILE_REWIND_OBJECT_STORAGE');
              } else throw error;
            }
            await directory.sync();
            existing = await readRewindEntry(directory, name, name, this);
            if (published && (existing.state.kind !== 'file' || existing.state.bytes !== material.receipt.size || existing.state.sha256 !== material.receipt.sha256)) rewindConflict();
          }
          if (existing.state.kind !== 'file' || !existing.bytes) rewindUnsafe();
          let inflated: Buffer;
          try { inflated = inflateSync(existing.bytes, { maxOutputLength: FILE_REWIND_LIMITS.fileBytes + 128 }); }
          catch { rewindConflict('A live Git object is invalid. It was not overwritten and the index was retained.'); }
          const header = Buffer.from(`blob ${material.bytes}\0`);
          if (!inflated.subarray(0, header.length).equals(header) || inflated.length !== material.bytes + header.length
            || hashBytes(inflated.subarray(header.length)) !== material.rawSha256
            || createHash(this.repository!.objectFormat).update(inflated).digest('hex') !== material.objectId) rewindConflict('A live Git object does not match its name. It was not overwritten and the index was retained.');
          this.incompleteObjects.delete(material.objectId);
          await this.durable([receiptFor(directory, name, existing.bytes)]);
          if (!sameRewindState((await readRewindEntry(directory, name, name, this)).state, existing.state)) rewindConflict('A Git object changed during its durability check. The current index was retained.');
          this.verifiedObjects.set(material.objectId, cloneFile(existing.state));
          await this.event('object_verified', { objectId: material.objectId });
        } finally { await directory.close(); }
      }
    } finally { await objects.close(); }
  }
  private async verifyObjects(): Promise<void> {
    if (!this.verifiedObjects.size) return;
    const objects = await this.common!.child('objects');
    try {
      for (const [objectId, expected] of this.verifiedObjects) {
        const directory = await objects.child(objectId.slice(0, 2));
        try {
          const actual = await readRewindEntry(directory, objectId.slice(2), objectId.slice(2), this);
          if (!sameRewindState(actual.state, expected)) rewindConflict('A historical Git object changed before index verification finished. Recovery copies were retained.');
        } finally { await directory.close(); }
      }
    } finally { await objects.close(); }
  }

  async apply(): Promise<FileRewindTransactionStatus> {
    if (this.busy || this.state !== 'prepared') throw new HttpError(409, 'Prepare the exact rewind before applying it.', 'FILE_REWIND_STATE');
    this.busy = true;
    try {
      this.state = 'applying'; await this.event('applying');
      await this.acquireIndexLock(); await this.validatePending();
      await this.installObjects();
      for (const unit of this.units) await this.applyUnit(unit);
      await this.verifyApplied();
      await this.verifyMetadata(false); await this.verifyApplied();
      this.state = 'applied'; await this.event('applied');
      return this.status();
    } catch (error) {
      this.issues.push(safeIssue(error));
      try { await this.rollbackInternal(); } catch (rollbackError) { await this.recordFailure(rollbackError); }
      throw this.failure(error);
    } finally { this.busy = false; }
  }

  private async applyUnit(unit: Unit): Promise<void> {
    await this.allowed(); await this.checkIndexLock();
    if (unit.kind === 'index') await this.verifyObjects();
    const desiredBytes = await this.readStaged(unit);
    // Verify the durable backup again immediately before moving the original.
    await this.readStaged(unit, true);
    if (!sameRewindState(await this.observed(unit), unit.expected)) rewindConflict();
    const parent = await this.parentFor(unit, unit.desired.kind !== 'missing');
    if (!parent) {
      if (unit.expected.kind !== 'missing' || unit.desired.kind !== 'missing') rewindConflict();
      unit.applied = missingRewindFile(unit.path); unit.phase = 'applied'; await this.event('path_applied', { key: unit.key, applied: unit.applied }); return;
    }
    try {
      const access = `${parent.directory.access}/${parent.name}`;
      if (unit.expected.kind !== 'missing') {
        unit.phase = 'parking'; await this.event('park_intent', { key: unit.key });
        await this.allowed(); await this.checkIndexLock();
        const current = await readRewindEntry(parent.directory, parent.name, unit.path, this);
        if (!sameRewindState(current.state, unit.expected)) rewindConflict();
        if ((await readRewindEntry(this.parked!, unit.key, unit.key, this)).state.kind !== 'missing') rewindConflict();
        await parent.directory.check(); await this.parked!.check();
        if (!sameRewindVersion(rewindIdentity(await fs.lstat(access)), unit.expected.identity!)) rewindConflict();
        await fs.rename(access, `${this.parked!.access}/${unit.key}`);
        // Rename changes ctime but not the identity, mode, mtime or file bytes.
        const displaced = await readRewindEntry(this.parked!, unit.key, unit.path, this);
        unit.parked = displaced.state; unit.phase = 'parked';
        if (!sameRewindState(displaced.state, unit.expected, true, true)) rewindConflict('A concurrent writer changed the file during rewind. Its displaced version was retained in recovery storage.');
        await parent.directory.sync(); await this.parked!.sync();
        await this.event('parked', { key: unit.key, parked: unit.parked });
      }
      unit.phase = 'installing'; await this.event('install_intent', { key: unit.key });
      await this.allowed(); await this.checkIndexLock(); await parent.directory.check();
      if ((await readRewindEntry(parent.directory, parent.name, unit.path, this)).state.kind !== 'missing') rewindConflict('A new file claimed a rewind destination. Its contents and the displaced original were retained.');
      if (unit.desired.kind === 'file') unit.applied = { ...await writeRewindFile(parent.directory, parent.name, desiredBytes!, unit.desired.mode, this), path: unit.path };
      else if (unit.desired.kind === 'symlink') {
        await fs.symlink(desiredBytes!, `${parent.directory.access}/${parent.name}`);
        unit.applied = (await readRewindEntry(parent.directory, parent.name, unit.path, this)).state;
      } else unit.applied = missingRewindFile(unit.path);
      if (!sameRewindState(unit.applied, unit.desired, false)) rewindConflict();
      unit.phase = 'applied'; await parent.directory.sync();
      await this.event('path_applied', { key: unit.key, applied: unit.applied });
      if (unit.applied.kind === 'file') await this.durable([receiptFor(parent.directory, parent.name, desiredBytes!)]);
      else if (unit.applied.kind === 'missing' && unit.expected.kind === 'file') await this.options.verifyAbsent?.([path.join(parent.directory.absolute, parent.name)]);
      if (!sameRewindState(await this.observed(unit), unit.applied)) rewindConflict();
    } finally { await parent.close(); }
  }

  private async verifyApplied(): Promise<void> {
    await this.allowed(); await this.checkIndexLock();
    for (const unit of this.units) if (!unit.applied || !sameRewindState(await this.observed(unit), unit.applied)) rewindConflict();
    await this.verifyObjects();
  }
  private async verifyMetadata(original: boolean): Promise<void> {
    if (!this.options.verifyMetadata) return;
    const entries: FileRewindMetadataExpectation[] = [];
    for (const unit of this.units) {
      if (original && unit.phase !== 'restored' || !original && unit.phase !== 'applied') continue;
      const state = original ? unit.expected : unit.desired;
      entries.push({ absolute: path.join(unit.kind === 'workspace' ? this.root!.absolute : this.git!.absolute, unit.path),
        kind: state.kind, mode: state.mode, bytes: state.bytes, sha256: state.sha256,
        ...(state.kind === 'symlink' ? { linkTargetBase64: (await this.readStaged(unit, original))!.toString('base64') } : {}) });
    }
    await this.options.verifyMetadata(entries);
  }

  /** Call only after the conversation update has durably succeeded. No backups are deleted. */
  async commit(): Promise<FileRewindTransactionStatus> {
    if (this.busy || this.state !== 'applied') throw new HttpError(409, 'Only a verified applied rewind can be committed.', 'FILE_REWIND_STATE');
    this.busy = true; this.commitEntered = true;
    try {
      await this.verifyApplied(); await this.event('commit_intent');
      await this.releaseIndexLock(); this.state = 'complete'; await this.event('complete');
      return this.status();
    } catch (error) { await this.recordFailure(error); throw this.failure(error); }
    finally { this.busy = false; }
  }

  async rollback(): Promise<FileRewindTransactionStatus> {
    if (this.busy || this.commitEntered || this.rollbackAttempted || !['prepared', 'applied'].includes(this.state) || !this.transaction) {
      throw new HttpError(409, 'This rewind cannot be rolled back automatically. Inspect its retained recovery record.', 'FILE_REWIND_STATE');
    }
    this.busy = true;
    try { await this.rollbackInternal(); return this.status(); }
    catch (error) { await this.recordFailure(error); throw this.failure(error); }
    finally { this.busy = false; }
  }
  private async rollbackInternal(): Promise<void> {
    if (this.rollbackAttempted || this.commitEntered) throw new HttpError(409, 'A settled or committed rewind cannot be replayed.', 'FILE_REWIND_STATE');
    this.rollbackAttempted = true;
    this.ignoringCancellation = true;
    // Failure handling has its own bounded window so an expired apply deadline
    // does not force an otherwise safe rollback to stop before its first read.
    this.deadline = Date.now() + FILE_REWIND_LIMITS.milliseconds;
    this.state = 'rolling_back';
    const failures: string[] = this.incompleteObjects.size
      ? ['A newly appended Git object could not be fully verified. Its bytes were retained and need inspection before that object can be used.'] : [];
    if (this.incompleteIndexLock) failures.push('An index lock was created but its contents could not be verified. Its retained lock requires inspection before Git can continue.');
    try {
      await this.event('rollback_intent');
      for (const unit of [...this.units].reverse()) {
        if (unit.phase === 'pending' || unit.phase === 'restored') continue;
        try { await this.rollbackUnit(unit); }
        catch (error) { failures.push(safeIssue(error)); await this.event('path_recovery_required', { key: unit.key, issue: safeIssue(error) }).catch(() => undefined); }
      }
      // Remove only empty directories whose inode was created by this
      // transaction. Never recursively clear a folder or a user's new entry.
      for (const created of [...this.createdDirectories].reverse()) {
        try {
          const parent = await rewindParent(this.root!, created.path);
          if (!parent) continue;
          try {
            const entry = await fs.lstat(`${parent.directory.access}/${parent.name}`);
            if (!entry.isDirectory() || !sameRewindIdentity(entry, created.identity)) rewindConflict();
            await parent.directory.check();
            await fs.rmdir(`${parent.directory.access}/${parent.name}`); await parent.directory.sync();
          } finally { await parent.close(); }
        } catch (error) { if (!isErrno(error, 'ENOENT') && !isErrno(error, 'ENOTEMPTY') && !isErrno(error, 'EEXIST')) failures.push(safeIssue(error)); }
      }
      try { await this.verifyMetadata(true); } catch (error) { failures.push(safeIssue(error)); }
      // A conflicting manual edit is preserved, but an unchanged owned lock
      // can still be released so normal Git inspection is not needlessly blocked.
      try { await this.releaseIndexLock(); } catch (error) { failures.push(safeIssue(error)); }
      if (failures.length) {
        this.issues.push(...failures); this.issues = [...new Set(this.issues)].slice(-12);
        this.state = 'recovery_required'; await this.event('recovery_required');
        return;
      }
      this.state = 'rolled_back'; await this.event('rolled_back');
    } finally { this.ignoringCancellation = false; }
  }

  private async rollbackUnit(unit: Unit): Promise<void> {
    await this.allowed();
    if (this.lock) await this.checkIndexLock();
    const current = await this.observed(unit);
    const displaced = await readRewindEntry(this.parked!, unit.key, unit.path, this);
    // A failed rename may have happened before a result was journaled. Exact
    // original identity/bytes in the owned parking slot is sufficient evidence;
    // a differing displaced file is never substituted or deleted automatically.
    if (displaced.state.kind !== 'missing') {
      if (!sameRewindState(displaced.state, unit.expected, true, true)) rewindConflict('A displaced file contains an unpreviewed edit. Both its recovery copy and the current path were retained.');
      unit.parked = displaced.state;
    }
    if (unit.expected.kind !== 'missing' && !unit.parked) {
      if (sameRewindState(current, unit.expected)) { unit.phase = 'restored'; await this.event('path_unchanged', { key: unit.key }); return; }
      rewindConflict('The original path and its parking record do not match. Recovery copies were retained.');
    }
    if (unit.applied) {
      if (!sameRewindState(current, unit.applied)) rewindConflict('A file was edited after rewind applied it. The edit was kept; its original remains in recovery storage.');
    } else if (current.kind !== 'missing') rewindConflict('An unfinished rewind destination contains unconfirmed bytes. It was kept for inspection.');
    await this.readStaged(unit, true);
    const parent = await this.parentFor(unit, unit.expected.kind !== 'missing');
    if (!parent) { unit.phase = 'restored'; await this.event('path_restored', { key: unit.key }); return; }
    try {
      const access = `${parent.directory.access}/${parent.name}`;
      await this.event('rollback_path_intent', { key: unit.key });
      if (current.kind !== 'missing') {
        // Retain even the exact bytes written by this transaction. This avoids
        // destructive unlink races and keeps a useful before/after audit trail.
        const rollbackName = `${unit.key}-reversed`;
        if ((await readRewindEntry(this.parked!, rollbackName, rollbackName, this)).state.kind !== 'missing') rewindConflict();
        const latest = await readRewindEntry(parent.directory, parent.name, unit.path, this);
        if (!unit.applied || !sameRewindState(latest.state, unit.applied)) rewindConflict();
        await parent.directory.check(); await this.parked!.check();
        if (!sameRewindVersion(rewindIdentity(await fs.lstat(access)), unit.applied.identity!)) rewindConflict();
        await fs.rename(access, `${this.parked!.access}/${rollbackName}`);
        const parkedApplied = await readRewindEntry(this.parked!, rollbackName, unit.path, this);
        if (!sameRewindState(parkedApplied.state, unit.applied, true, true)) rewindConflict('A concurrent edit arrived during rollback. Its displaced bytes were retained for recovery.');
        await this.parked!.sync();
      }
      const restoreBytes = await this.readStaged(unit, true);
      if ((await readRewindEntry(parent.directory, parent.name, unit.path, this)).state.kind !== 'missing') rewindConflict();
      let restored: GitCheckpointFile;
      if (unit.expected.kind === 'file') restored = { ...await writeRewindFile(parent.directory, parent.name, restoreBytes!, unit.expected.mode, this), path: unit.path };
      else if (unit.expected.kind === 'symlink') {
        await fs.symlink(restoreBytes!, access);
        restored = (await readRewindEntry(parent.directory, parent.name, unit.path, this)).state;
      } else restored = missingRewindFile(unit.path);
      if (!sameRewindState(restored, unit.expected, false)) rewindConflict();
      await parent.directory.sync();
      if (restored.kind === 'file') await this.durable([receiptFor(parent.directory, parent.name, restoreBytes!)]);
      else if (restored.kind === 'missing' && current.kind === 'file') await this.options.verifyAbsent?.([path.join(parent.directory.absolute, parent.name)]);
      if (!sameRewindState(await this.observed(unit), restored)) rewindConflict();
      unit.phase = 'restored'; await this.event('path_restored', { key: unit.key, restored });
    } finally { await parent.close(); }
  }

  /** Closing descriptors never replays a transaction or sweeps retained files. */
  async close(): Promise<void> {
    if (this.closed) return;
    if (this.busy) throw new HttpError(409, 'Wait for the active rewind operation before closing it.', 'FILE_REWIND_STATE');
    if (this.lock) {
      if (this.state === 'complete' || this.state === 'rolled_back') await this.releaseIndexLock();
      else await this.lock.handle.close();
      this.lock = undefined;
    }
    this.closed = true;
    const results = await Promise.allSettled([...this.pins].reverse().map(pin => pin.close()));
    this.pins = [];
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }
}

/** Read-only startup/status inspection. Incomplete records always remain visible. */
export async function listFileRewindTransactions(directory: string, options: { workspaceId?: string; threadId?: string; limit?: number } = {}): Promise<FileRewindTransactionStatus[]> {
  safeRewindAbsolute(directory);
  const limit = Math.max(1, Math.min(100, Number.isSafeInteger(options.limit) ? options.limit! : 30));
  let base: RewindDirectory;
  try { base = await RewindDirectory.open(directory); }
  catch (error) { if (isErrno(error, 'ENOENT')) return []; throw error; }
  const results: FileRewindTransactionStatus[] = [];
  try {
    const entries = await fs.opendir(base.access, { bufferSize: 16 });
    let scanned = 0;
    for await (const entry of entries) {
      if (++scanned > 2_000) throw new HttpError(413, 'The file rewind recovery directory exceeds the bounded inspection limit. Review its retained records before creating more.', 'FILE_REWIND_RECOVERY_LIMIT');
      if (!UUID.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
      let transaction: RewindDirectory | undefined, events: RewindDirectory | undefined;
      try {
        transaction = await base.child(entry.name);
        let parsed: Partial<StoredManifest>;
        try { parsed = await readRewindJSON(transaction, 'manifest.json') as Partial<StoredManifest>; }
        catch (error) {
          if (!isErrno(error, 'ENOENT')) throw error;
          const identity = await readRewindJSON(transaction, 'identity.json') as Partial<StoredManifest> & { paths?: string[] };
          if (identity.version !== 1 || identity.id !== entry.name || !validOwner(identity.workspaceId ?? '') || !validOwner(identity.threadId ?? '')
            || !Array.isArray(identity.paths) || identity.paths.length > FILE_REWIND_LIMITS.files || typeof identity.createdAt !== 'string') rewindUnsafe();
          if (options.workspaceId && identity.workspaceId !== options.workspaceId || options.threadId && identity.threadId !== options.threadId) continue;
          results.push({ id: entry.name, workspaceId: identity.workspaceId!, threadId: identity.threadId!, state: 'recovery_required',
            createdAt: identity.createdAt, updatedAt: identity.createdAt, paths: identity.paths.map(safeRewindRelative), appliedPaths: [],
            indexChanged: false, backupsRetained: false, issues: ['Preparation stopped before a complete rewind manifest was durable. No path mutation is authorized from this record.'], automaticRecovery: false });
          results.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
          if (results.length > limit) results.length = limit;
          continue;
        }
        if (parsed.version !== 1 || parsed.id !== entry.name || !validOwner(parsed.workspaceId ?? '') || !validOwner(parsed.threadId ?? '')
          || !Array.isArray(parsed.units) || parsed.units.length > FILE_REWIND_LIMITS.files + 1 || typeof parsed.createdAt !== 'string') rewindUnsafe();
        if (options.workspaceId && parsed.workspaceId !== options.workspaceId || options.threadId && parsed.threadId !== options.threadId) continue;
        const paths = parsed.units.filter(unit => unit.kind === 'workspace').map(unit => safeRewindRelative(unit.path));
        let result: FileRewindTransactionStatus = { id: entry.name, workspaceId: parsed.workspaceId!, threadId: parsed.threadId!,
          state: 'recovery_required', createdAt: parsed.createdAt, updatedAt: parsed.createdAt, paths, appliedPaths: [], indexChanged: false,
          backupsRetained: parsed.units.some(unit => !!unit.backup || !!unit.staged), issues: ['An unfinished recovery record is present. Inspect retained files; startup will not replay it.'], automaticRecovery: false };
        events = await transaction.child('events');
        const names = await fs.opendir(events.access, { bufferSize: 16 });
        let newest = '', eventCount = 0;
        for await (const candidate of names) {
          if (++eventCount > FILE_REWIND_LIMITS.events) rewindLimit();
          if (candidate.isFile() && !candidate.isSymbolicLink() && /^\d{8}\.json$/.test(candidate.name) && candidate.name > newest) newest = candidate.name;
        }
        if (newest) {
          const event = await readRewindJSON(events, newest) as { id?: string; status?: Omit<FileRewindTransactionStatus, 'paths' | 'appliedPaths'>; appliedKeys?: string[] };
          const status = event.status;
          if (event.id === entry.name && status?.id === entry.name && status.workspaceId === parsed.workspaceId && status.threadId === parsed.threadId
            && statusValues.has(status.state) && typeof status.updatedAt === 'string' && Array.isArray(event.appliedKeys)
            && event.appliedKeys.length <= paths.length && event.appliedKeys.every(key => parsed.units!.some(unit => unit.kind === 'workspace' && unit.key === key)) && Array.isArray(status.issues)) {
            result = { ...result, state: status.state, updatedAt: status.updatedAt,
              appliedPaths: event.appliedKeys.map(key => parsed.units!.find(unit => unit.kind === 'workspace' && unit.key === key)!.path),
              indexChanged: status.indexChanged === true, issues: status.issues.filter(issue => typeof issue === 'string').slice(0, 12).map(issue => issue.slice(0, 700)) };
          }
        }
        results.push(result); results.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
        if (results.length > limit) results.length = limit;
      } catch (error) {
        // Corrupt/partial records are never executed. Records with a readable
        // manifest still surfaced above; unreadable records fail the status
        // request instead of silently hiding a possibly unfinished mutation.
        throw new HttpError(409, 'A file rewind recovery record is incomplete or unreadable. Retained transaction directories require inspection.', 'FILE_REWIND_RECOVERY_RECORD');
      } finally { await events?.close(); await transaction?.close(); }
    }
    return results;
  } finally { await base.close(); }
}
