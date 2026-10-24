import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppContext } from '../context';
import { HttpError } from '../errors';
import { clearWorkspaceRecoveryBarrier } from '../worktrees/activity';
import { RewindDirectory, isErrno } from './file-rewind-transaction-io';

/** Neither entry point initializes workspaces/agents or acquires an admission
 * gate. Trash calls them while holding its existing workspace-removal gate. */
type CleanupConfig = Pick<AppContext['config'], 'stateDir' | 'workspacesDir' | 'sessionSecret'>;
type CleanupContext = { config: CleanupConfig; store?: Pick<AppContext['store'], 'directory' | 'writeWithVersion'> };
type ObjectValue = Record<string, unknown>;
interface Snapshot { name: string; fingerprint: string; sha256: string; maximum: number }
interface ReadRecord { snapshot: Snapshot; value: unknown }
interface SignedRecord extends ReadRecord { value: ObjectValue; signature: string; envelopeDigest: string }
interface Operation {
  snapshot: Snapshot; id: string; workspaceId: string; threadId: string;
  familyIds: string[]; selectionVersion: string; state: string; blocking: boolean;
  backupId: string; beforeTurnId: string; threadUnchanged?: boolean; historyBackupDigest?: string;
}
interface JournalOwner { threadId: string; turnId: string; workspaceId?: string }
interface OwnedRecord { snapshot: Snapshot; kind: 'turn' | 'plan' | 'review' | 'latest' | 'block'; operation?: Operation }
interface Inventory {
  operations: Map<string, Operation>; owned: OwnedRecord[]; journals: Map<string, JournalOwner>;
}
interface Budget { scanned: number; readBytes: number; leaves: number; deadline: number }

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const THREAD = /^thr_[a-f0-9]{32}$/u;
const WORKSPACE = /^[a-zA-Z0-9_-]{1,128}$/u;
const TURN = /^[a-z0-9_]{1,160}$/u;
const HISTORY = /^history_[a-f0-9]{32}$/u;
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const METADATA_BYTES = 8 * 1024 * 1024;
// JsonStore pretty-prints normal records. Bound both wire bytes and the signed
// JSON value, without rejecting a legitimate value solely for indentation.
const METADATA_WIRE_BYTES = METADATA_BYTES * 4 + 4096;
const HISTORY_BYTES = 256 * 1024 * 1024;
const EXPIRED_PREVIEWS_KEY = 'file-rewind-expired-previews';
const BUDGET = Object.freeze({ scanned: 250_000, leaves: 100_000, readBytes: 1024 * 1024 * 1024, milliseconds: 60_000 });
const object = (value: unknown): value is ObjectValue => !!value && typeof value === 'object' && !Array.isArray(value);
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fingerprint = (stat: BigIntStats): string => `${stat.dev}:${stat.ino}:${stat.mode}:${stat.nlink}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
const sameNode = (a: BigIntStats, b: BigIntStats): boolean => a.dev === b.dev && a.ino === b.ino && (a.mode & 0o170000n) === (b.mode & 0o170000n);
const budget = (): Budget => ({ scanned: 0, readBytes: 0, leaves: 0, deadline: Date.now() + BUDGET.milliseconds });

function invalid(): never {
  throw new HttpError(409, 'Saved file rewind ownership failed verification. Its records and recovery files were retained for inspection.', 'FILE_REWIND_RECORD_INVALID');
}
function changed(): never {
  throw new HttpError(409, 'File rewind recovery data changed during cleanup. The remaining records were retained; retry after reviewing the change.', 'FILE_REWIND_CLEANUP_CHANGED');
}
function blocked(): never {
  throw new HttpError(409, 'An unfinished file rewind needs review before this workspace can be moved to trash or permanently deleted. Its original files and conversation backups remain saved.', 'FILE_REWIND_RECOVERY_REQUIRED');
}
function check(state: Budget): void {
  if (Date.now() > state.deadline || state.scanned > BUDGET.scanned || state.leaves > BUDGET.leaves || state.readBytes > BUDGET.readBytes) {
    throw new HttpError(413, 'File rewind cleanup reached its bounded inspection limit. Remaining recovery records were retained and deletion can be retried.', 'FILE_REWIND_CLEANUP_LIMIT');
  }
}
function nameSafe(name: string): void {
  if (!name || name === '.' || name === '..' || /[\u0000/\\]/u.test(name) || Buffer.byteLength(name) > 255) invalid();
}
function checkedWorkspace(workspaceId: string): void {
  if (!WORKSPACE.test(workspaceId)) throw new HttpError(400, 'Choose a registered workspace.', 'FILE_REWIND_SELECTION');
}
async function stateDirectory(ctx: CleanupContext): Promise<RewindDirectory | null> {
  try { return await RewindDirectory.open(path.resolve(ctx.config.stateDir)); }
  catch (error) { if (isErrno(error, 'ENOENT')) return null; throw error; }
}

/** A bounded, pinned, no-follow read associates the actual bytes with the opened
 * file. It never trusts JsonStore's path-following read for deletion authority. */
async function readJSON(directory: RewindDirectory, name: string, state: Budget, maximum = METADATA_WIRE_BYTES): Promise<ReadRecord | null> {
  nameSafe(name); check(state); await directory.check();
  let handle: Awaited<ReturnType<typeof fs.open>>;
  try { handle = await fs.open(`${directory.access}/${name}`, READ_FLAGS); }
  catch (error) {
    if (isErrno(error, 'ENOENT')) { await directory.check(); return null; }
    if (isErrno(error, 'ELOOP') || isErrno(error, 'ENOTDIR')) invalid();
    throw error;
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size < 1n || before.size > BigInt(maximum)) invalid();
    state.readBytes += Number(before.size); check(state);
    const bytes = Buffer.allocUnsafe(Number(before.size));
    for (let offset = 0; offset < bytes.length;) {
      check(state);
      const read = await handle.read(bytes, offset, Math.min(64 * 1024, bytes.length - offset), offset);
      if (!read.bytesRead) changed();
      offset += read.bytesRead;
    }
    const after = await handle.stat({ bigint: true }), named = await fs.lstat(`${directory.access}/${name}`, { bigint: true });
    if (!named.isFile() || named.isSymbolicLink() || fingerprint(before) !== fingerprint(after) || fingerprint(after) !== fingerprint(named)) changed();
    await directory.check();
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { invalid(); }
    return { value, snapshot: { name, fingerprint: fingerprint(after), sha256: createHash('sha256').update(bytes).digest('hex'), maximum } };
  } finally { await handle.close(); }
}

async function readSigned(ctx: CleanupContext, directory: RewindDirectory, name: string, state: Budget): Promise<SignedRecord | null> {
  const record = await readJSON(directory, name, state);
  if (!record) return null;
  const envelope = record.value;
  if (!object(envelope) || envelope.version !== 1 || !object(envelope.value) || typeof envelope.signature !== 'string' || !HASH.test(envelope.signature)) invalid();
  const serialized = JSON.stringify(envelope.value);
  if (Buffer.byteLength(serialized) > METADATA_BYTES) invalid();
  const expected = createHmac('sha256', ctx.config.sessionSecret).update(serialized).digest();
  if (!timingSafeEqual(Buffer.from(envelope.signature, 'hex'), expected)) invalid();
  return { snapshot: record.snapshot, value: envelope.value, signature: envelope.signature, envelopeDigest: hash(envelope) };
}

function expiredPreviewRows(record: SignedRecord): ObjectValue[] {
  const value = record.value;
  if (value.version !== 1 || !Array.isArray(value.previews) || value.previews.length > 512) invalid();
  const ids = new Set<string>();
  for (const preview of value.previews) {
    if (!object(preview) || typeof preview.id !== 'string' || !UUID.test(preview.id) || ids.has(preview.id)
      || typeof preview.threadId !== 'string' || !THREAD.test(preview.threadId)
      || typeof preview.workspaceId !== 'string' || !WORKSPACE.test(preview.workspaceId)
      || typeof preview.selectionVersion !== 'string' || !HASH.test(preview.selectionVersion)
      || typeof preview.discardedAt !== 'string' || preview.discardedAt.length > 64 || !Number.isFinite(Date.parse(preview.discardedAt))) invalid();
    ids.add(preview.id);
  }
  return value.previews as ObjectValue[];
}

function previewStore(ctx: CleanupContext): NonNullable<CleanupContext['store']> {
  if (!ctx.store || path.resolve(ctx.store.directory) !== path.resolve(ctx.config.stateDir)) {
    throw new HttpError(503, 'Shared file rewind preview cleanup is unavailable. The remaining signed records were retained for a later retry.', 'FILE_REWIND_CLEANUP_STORE_REQUIRED');
  }
  return ctx.store;
}

async function inspectExpiredPreviews(ctx: CleanupContext, directory: RewindDirectory, workspaceId: string, state: Budget, threadId?: string): Promise<void> {
  const record = await readSigned(ctx, directory, `${EXPIRED_PREVIEWS_KEY}.json`, state);
  if (record && expiredPreviewRows(record).some(row => row.workspaceId === workspaceId && (threadId === undefined || row.threadId === threadId))) previewStore(ctx);
}

/** Only the caller's original JsonStore participates in the shared JSON write
 * queue. A fresh signed no-follow read plus the store's digest guard protects
 * rows another workspace added between inspection and this queued write. */
async function pruneExpiredPreviews(ctx: CleanupContext, directory: RewindDirectory, workspaceId: string, state: Budget, threadId?: string): Promise<void> {
  const selected = (row: ObjectValue): boolean => row.workspaceId === workspaceId && (threadId === undefined || row.threadId === threadId);
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await readSigned(ctx, directory, `${EXPIRED_PREVIEWS_KEY}.json`, state);
    if (!current) return;
    const rows = expiredPreviewRows(current), retained = rows.filter(row => !selected(row));
    if (retained.length === rows.length) return;
    const store = previewStore(ctx), value = { ...current.value, previews: retained };
    const signed = { version: 1, value, signature: createHmac('sha256', ctx.config.sessionSecret).update(JSON.stringify(value)).digest('hex') };
    await directory.check(); check(state);
    try { await store.writeWithVersion(EXPIRED_PREVIEWS_KEY, signed, { expectedDigest: current.envelopeDigest }); }
    catch (error) {
      if (error instanceof HttpError && error.code === 'STATE_CONFLICT') continue;
      throw error;
    }
    await directory.check();
    const after = await readSigned(ctx, directory, `${EXPIRED_PREVIEWS_KEY}.json`, state);
    if (!after || !expiredPreviewRows(after).some(selected)) return;
  }
  changed();
}

function operation(record: SignedRecord, id?: string): Operation {
  const value = record.value, selection = value.selection, completion = value.completion;
  if (value.version !== 1 || typeof value.workspaceId !== 'string' || !WORKSPACE.test(value.workspaceId)
    || typeof value.threadId !== 'string' || !THREAD.test(value.threadId)
    || typeof value.recoveryId !== 'string' || !UUID.test(value.recoveryId) || id !== undefined && value.recoveryId !== id
    || !object(selection) || selection.planId !== value.recoveryId || typeof selection.version !== 'string' || !HASH.test(selection.version)
    || !Array.isArray(value.familyIds) || !value.familyIds.length || value.familyIds.length > 10_002
    || value.familyIds.some(item => typeof item !== 'string' || !WORKSPACE.test(item))
    || new Set(value.familyIds).size !== value.familyIds.length || !value.familyIds.includes(value.workspaceId)
    || !['pending', 'complete', 'recovery_required', 'kept_current'].includes(String(value.state)) || typeof value.blocking !== 'boolean'
    || !object(completion) || completion.workspaceId !== value.workspaceId || completion.threadId !== value.threadId
    || completion.recoveryId !== value.recoveryId || typeof completion.backupId !== 'string' || !HISTORY.test(completion.backupId)
    || typeof completion.beforeTurnId !== 'string' || !TURN.test(completion.beforeTurnId)) invalid();
  return { snapshot: record.snapshot, id: value.recoveryId, workspaceId: value.workspaceId, threadId: value.threadId,
    familyIds: value.familyIds as string[], selectionVersion: selection.version, state: String(value.state), blocking: value.blocking,
    backupId: completion.backupId, beforeTurnId: completion.beforeTurnId,
    threadUnchanged: value.threadUnchanged === true,
    ...(typeof value.historyBackupDigest === 'string' && HASH.test(value.historyBackupDigest) ? { historyBackupDigest: value.historyBackupDigest } : {}) };
}
function sameOperation(a: Operation, b: Operation): boolean {
  const family = new Set(b.familyIds);
  return a.id === b.id && a.workspaceId === b.workspaceId && a.threadId === b.threadId && a.selectionVersion === b.selectionVersion
    && a.backupId === b.backupId && a.beforeTurnId === b.beforeTurnId
    && a.familyIds.length === b.familyIds.length && a.familyIds.every(id => family.has(id));
}
function assertNonblocking(value: Operation): void { if (value.blocking || value.state === 'pending') blocked(); }

async function canonicalOperations(ctx: CleanupContext, directory: RewindDirectory, workspaceId: string, state: Budget): Promise<Map<string, Operation>> {
  const operations = new Map<string, Operation>();
  const marker = await readSigned(ctx, directory, `file-rewind-block-${workspaceId}.json`, state);
  if (marker) {
    const marked = operation(marker);
    if (!marked.familyIds.includes(workspaceId)) invalid();
    assertNonblocking(marked);
    const record = await readSigned(ctx, directory, `file-rewind-operation-${marked.id}.json`, state);
    if (!record) invalid();
    const canonical = operation(record, marked.id);
    if (!sameOperation(marked, canonical)) invalid();
    assertNonblocking(canonical); operations.set(canonical.id, canonical);
  }
  // A missing or older marker does not hide a signed pending transaction.
  for await (const entry of await fs.opendir(directory.access, { bufferSize: 16 })) {
    state.scanned++; check(state);
    const match = /^file-rewind-operation-(.+)\.json$/u.exec(entry.name);
    if (!match || !UUID.test(match[1])) continue;
    const record = await readSigned(ctx, directory, entry.name, state);
    if (!record) changed();
    const canonical = operation(record, match[1]);
    if (!canonical.familyIds.includes(workspaceId)) continue;
    assertNonblocking(canonical);
    const previous = operations.get(canonical.id);
    if (previous && previous.snapshot.sha256 !== canonical.snapshot.sha256) changed();
    operations.set(canonical.id, canonical);
  }
  await directory.check();
  return operations;
}

/** Read-only and startup-safe: call before any ordinary trash move or permanent
 * filesystem removal. Corrupt/unreadable recovery authority fails closed. */
export async function assertWorkspaceFileRewindDeletionAllowed(ctx: CleanupContext, workspaceId: string): Promise<void> {
  checkedWorkspace(workspaceId);
  const directory = await stateDirectory(ctx);
  if (!directory) return;
  try { await canonicalOperations(ctx, directory, workspaceId, budget()); }
  finally { await directory.close(); }
}

function metadataRelative(config: CleanupConfig, value: unknown): string {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value !== path.normalize(value)
    || value.length > 4096 || /[\u0000-\u001f\u007f\\]/u.test(value)) invalid();
  const base = path.resolve(config.workspacesDir), relative = path.relative(base, value);
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) invalid();
  const parts = relative.split(path.sep);
  if (parts.length > 64 || parts.some(item => !item || item === '.' || item === '..')) invalid();
  return parts.join('/');
}

/** Consult this before FileMetadataManager.initialize(), alongside the trash
 * exclusions. It reads signed state only, including canonical pending records
 * whose family markers were not saved before a crash. No live checkout is
 * opened and no link/mode is restored while its transaction is uncertain. */
export async function readFileRewindMetadataExclusions(config: CleanupConfig): Promise<readonly string[]> {
  const ctx: CleanupContext = { config }, directory = await stateDirectory(ctx);
  if (!directory) return [];
  const state = budget(), pending = new Map<string, Operation>();
  try {
    for await (const entry of await fs.opendir(directory.access, { bufferSize: 16 })) {
      state.scanned++; check(state);
      const match = /^file-rewind-(operation|block)-(.+)\.json$/u.exec(entry.name);
      if (!match || (match[1] === 'operation' ? !UUID.test(match[2]) : !WORKSPACE.test(match[2]))) continue;
      const record = await readSigned(ctx, directory, entry.name, state);
      if (!record) changed();
      const value = operation(record, match[1] === 'operation' ? match[2] : undefined);
      if (match[1] === 'block' && !value.familyIds.includes(match[2])) invalid();
      if (value.blocking || value.state === 'pending') pending.set(value.id, value);
    }
    const excluded = new Set<string>();
    for (const marked of pending.values()) {
      const canonicalRecord = await readSigned(ctx, directory, `file-rewind-operation-${marked.id}.json`, state);
      if (!canonicalRecord) invalid();
      const canonical = operation(canonicalRecord, marked.id);
      if (!sameOperation(marked, canonical)) invalid();
      const plan = await readSigned(ctx, directory, `file-rewind-plan-${marked.id}.json`, state);
      if (!plan || plan.signature !== canonical.selectionVersion || plan.value.version !== 1 || plan.value.id !== canonical.id
        || plan.value.workspaceId !== canonical.workspaceId || plan.value.threadId !== canonical.threadId
        || !object(plan.value.current) || !object(plan.value.current.repository)) invalid();
      const repository = plan.value.current.repository;
      const root = metadataRelative(config, repository.root), git = metadataRelative(config, repository.gitDirectory);
      if (root.split('/')[0] !== canonical.workspaceId || !canonical.familyIds.includes(git.split('/')[0])) invalid();
      excluded.add(root); excluded.add(git);
    }
    await directory.check();
    return [...excluded].sort();
  } finally { await directory.close(); }
}

function journalName(owner: JournalOwner): string {
  if (!THREAD.test(owner.threadId) || !TURN.test(owner.turnId)) invalid();
  const name = `thread-turn-${owner.threadId}-${owner.turnId}.json`; nameSafe(name); return name;
}
function addJournal(target: Map<string, JournalOwner>, owner: JournalOwner): void {
  const name = journalName(owner); target.set(name, owner);
  if (target.size > BUDGET.leaves) throw new HttpError(413, 'Too many saved turn journals need cleanup. The remaining records were retained.', 'FILE_REWIND_CLEANUP_LIMIT');
}

async function inventory(ctx: CleanupContext, directory: RewindDirectory, workspaceId: string, state: Budget): Promise<Inventory> {
  const operations = await canonicalOperations(ctx, directory, workspaceId, state), owned: OwnedRecord[] = [], journals = new Map<string, JournalOwner>();
  const plans = new Map<string, { threadId: string; signature: string }>();
  const latest: Array<{ snapshot: Snapshot; planId: string; version: string }> = [];
  for await (const entry of await fs.opendir(directory.access, { bufferSize: 16 })) {
    state.scanned++; check(state);
    const match = /^file-rewind-(turn|plan|review|latest|block)-(.+)\.json$/u.exec(entry.name);
    if (!match) continue;
    const kind = match[1] as OwnedRecord['kind'], id = match[2];
    if (kind === 'turn' ? !HASH.test(id) : kind === 'latest' ? !THREAD.test(id) : kind === 'block' ? !WORKSPACE.test(id) : !UUID.test(id)) continue;
    const record = await readSigned(ctx, directory, entry.name, state);
    if (!record) changed();
    const value = record.value;
    if (kind === 'latest') {
      if (typeof value.planId !== 'string' || !UUID.test(value.planId) || typeof value.version !== 'string' || !HASH.test(value.version)) invalid();
      latest.push({ snapshot: record.snapshot, planId: value.planId, version: value.version }); continue;
    }
    if (kind === 'block') {
      const marked = operation(record);
      const canonical = operations.get(marked.id);
      if (!marked.familyIds.includes(id)) invalid();
      if (id !== workspaceId && canonical?.workspaceId !== workspaceId) continue;
      if (!canonical || !sameOperation(marked, canonical)) invalid();
      assertNonblocking(marked); assertNonblocking(canonical);
      owned.push({ snapshot: record.snapshot, kind, operation: marked }); continue;
    }
    if (value.workspaceId !== workspaceId) continue;
    if (value.version !== 1) invalid();
    if (kind === 'review') {
      const canonical = operations.get(id);
      if (value.recoveryId !== id || !canonical || canonical.workspaceId !== workspaceId) invalid();
    } else {
      if (typeof value.threadId !== 'string' || !THREAD.test(value.threadId)) invalid();
      if (kind === 'turn') {
        if (typeof value.turnId !== 'string' || !TURN.test(value.turnId) || hash([value.threadId, value.turnId]) !== id) invalid();
        addJournal(journals, { threadId: value.threadId, turnId: value.turnId, workspaceId });
      } else {
        if (value.id !== id) invalid();
        plans.set(id, { threadId: value.threadId, signature: record.signature });
      }
    }
    owned.push({ snapshot: record.snapshot, kind });
  }
  for (const record of latest) {
    const threadId = record.snapshot.name.slice('file-rewind-latest-'.length, -'.json'.length);
    const canonical = operations.get(record.planId), plan = plans.get(record.planId);
    if (canonical?.workspaceId === workspaceId) {
      if (canonical.threadId !== threadId || canonical.selectionVersion !== record.version) invalid();
      owned.push({ snapshot: record.snapshot, kind: 'latest' });
    } else if (plan) {
      if (plan.threadId !== threadId || plan.signature !== record.version) invalid();
      owned.push({ snapshot: record.snapshot, kind: 'latest' });
    }
  }
  check(state); await directory.check();
  return { operations, owned, journals };
}

/** Leave authorization records in place until the exact referenced material is
 * gone. Re-reading both identity and bytes detects replacement before unlink. */
async function unlinkRecord(directory: RewindDirectory, snapshot: Snapshot, state: Budget): Promise<void> {
  const current = await readJSON(directory, snapshot.name, state, snapshot.maximum);
  if (!current) return;
  if (current.snapshot.sha256 !== snapshot.sha256 || current.snapshot.fingerprint !== snapshot.fingerprint) changed();
  await directory.check();
  const named = await fs.lstat(`${directory.access}/${snapshot.name}`, { bigint: true });
  if (fingerprint(named) !== snapshot.fingerprint || !named.isFile() || named.isSymbolicLink()) changed();
  await fs.unlink(`${directory.access}/${snapshot.name}`);
  state.leaves++; check(state); await directory.check();
}

async function historyBackup(directory: RewindDirectory, operation: Operation, journals: Map<string, JournalOwner>, state: Budget, verifySignedDigest = false): Promise<Snapshot | null> {
  const backup = await readJSON(directory, `thread-backup-${operation.backupId}.json`, state, HISTORY_BYTES);
  if (!backup) return null;
  const value = backup.value;
  if (!object(value) || value.version !== 2 || value.threadId !== operation.threadId || value.beforeTurnId !== operation.beforeTurnId
    || !object(value.record) || !object(value.record.thread) || value.record.thread.id !== operation.threadId || value.record.thread.workspaceId !== operation.workspaceId) invalid();
  if (verifySignedDigest && operation.historyBackupDigest && hash(value) !== operation.historyBackupDigest) invalid();
  if (value.record.turnJournals !== undefined) {
    if (!object(value.record.turnJournals)) invalid();
    for (const [turnId, key] of Object.entries(value.record.turnJournals)) {
      const owner = { threadId: operation.threadId, turnId, workspaceId: operation.workspaceId };
      if (key !== journalName(owner).slice(0, -'.json'.length)) invalid();
      addJournal(journals, owner);
    }
  }
  if (value.turnInputs !== undefined) {
    if (!Array.isArray(value.turnInputs)) invalid();
    for (const journal of value.turnInputs) {
      if (!object(journal) || typeof journal.turnId !== 'string' || !Array.isArray(journal.input)) invalid();
      addJournal(journals, { threadId: operation.threadId, turnId: journal.turnId, workspaceId: operation.workspaceId });
    }
  }
  return backup.snapshot;
}

async function journalSnapshot(directory: RewindDirectory, owner: JournalOwner, state: Budget): Promise<Snapshot | null> {
  const record = await readJSON(directory, journalName(owner), state, HISTORY_BYTES);
  if (!record) return null;
  if (!object(record.value) || record.value.turnId !== owner.turnId || !Array.isArray(record.value.input)
    || record.value.threadId !== undefined && record.value.threadId !== owner.threadId
    || record.value.workspaceId !== undefined && owner.workspaceId !== undefined && record.value.workspaceId !== owner.workspaceId) invalid();
  return record.snapshot;
}

/** The signed canonical operation owns exactly this UUID; the immutable native
 * identity file independently binds the directory to its thread/workspace. */
async function removeTransaction(stateRoot: RewindDirectory, operation: Operation, state: Budget, checkAllowed?: () => Promise<void>): Promise<void> {
  let base: RewindDirectory | undefined, transaction: RewindDirectory | undefined;
  const admitted = async () => { check(state); await checkAllowed?.(); check(state); };
  try {
    await admitted();
    try { base = await stateRoot.child('file-rewinds'); }
    catch (error) { if (isErrno(error, 'ENOENT')) return; throw error; }
    try { transaction = await base.child(operation.id); }
    catch (error) { if (isErrno(error, 'ENOENT')) return; throw error; }
    const identity = await readJSON(transaction, 'identity.json', state);
    if (!identity) {
      // A prior cleanup may have removed the last identity leaf before rmdir
      // failed. Without identity, only an already-empty directory is removable.
      for await (const _entry of await fs.opendir(transaction.access, { bufferSize: 1 })) invalid();
    } else {
      const value = identity.value;
      if (!object(value) || value.version !== 1 || value.id !== operation.id || value.workspaceId !== operation.workspaceId || value.threadId !== operation.threadId) invalid();
      const walk = async (directory: RewindDirectory, depth: number): Promise<void> => {
        if (depth > 32) invalid();
        await directory.check();
        for await (const entry of await fs.opendir(directory.access, { bufferSize: 16 })) {
          check(state); nameSafe(entry.name);
          if (directory === transaction && entry.name === 'identity.json') continue;
          state.scanned++; check(state); await directory.check();
          const access = `${directory.access}/${entry.name}`, before = await fs.lstat(access, { bigint: true });
          if (before.dev !== BigInt(transaction!.identity.dev)) invalid();
          if (before.isDirectory() && !before.isSymbolicLink()) {
            const child = await directory.child(entry.name);
            try {
              if (!sameNode(before, await child.handle.stat({ bigint: true }))) changed();
              await walk(child, depth + 1); await directory.check(); await child.check();
              if (!sameNode(before, await fs.lstat(access, { bigint: true }))) changed();
              await admitted();
              await fs.rmdir(access); state.leaves++; check(state);
            } finally { await child.close(); }
          } else {
            // Symlinks are leaves: unlink the owned link itself, never its target.
            // Device/socket/FIFO entries cannot be legitimate rewind payloads.
            if (!before.isFile() && !before.isSymbolicLink()) invalid();
            await directory.check();
            if (!sameNode(before, await fs.lstat(access, { bigint: true }))) changed();
            await admitted();
            await fs.unlink(access); state.leaves++; check(state);
          }
        }
        await directory.check();
      };
      await walk(transaction, 0);
      // Bucket directory iterators may observe changing offsets while leaves
      // are removed. Keep ownership evidence if a fresh bounded listing still
      // contains anything; a retry can safely drain the remaining leaves.
      for await (const entry of await fs.opendir(transaction.access, { bufferSize: 16 })) {
        state.scanned++; check(state);
        if (entry.name !== 'identity.json') changed();
      }
      await admitted(); await unlinkRecord(transaction, identity.snapshot, state);
    }
    await stateRoot.check(); await base.check(); await transaction.check();
    const named = await fs.lstat(`${base.access}/${operation.id}`);
    if (!named.isDirectory() || named.isSymbolicLink() || named.dev !== transaction.identity.dev || named.ino !== transaction.identity.ino) changed();
    await admitted();
    await fs.rmdir(`${base.access}/${operation.id}`);
    await base.check(); await stateRoot.check();
  } finally { await transaction?.close(); await base?.close(); }
}

/** Call only after confirmed permanent workspace/file-trash deletion (including
 * expiry), inside that existing removal gate. Ordinary restorable trash keeps
 * every checkpoint and recovery artifact. Never recursively rm a guessed root. */
export async function cleanupWorkspaceFileRewinds(ctx: CleanupContext, workspaceId: string): Promise<void> {
  checkedWorkspace(workspaceId);
  const directory = await stateDirectory(ctx);
  if (!directory) return;
  const state = budget();
  try {
    // Independent preflight: callers cannot skip recovery protection by omitting
    // the separate public preflight helper or by losing a family marker.
    const found = await inventory(ctx, directory, workspaceId, state);
    await inspectExpiredPreviews(ctx, directory, workspaceId, state);
    const owners = [...found.operations.values()].filter(item => item.workspaceId === workspaceId);
    const backups: Snapshot[] = [];
    for (const owner of owners) {
      const backup = await historyBackup(directory, owner, found.journals, state);
      if (backup) backups.push(backup);
    }
    const journals: Snapshot[] = [];
    for (const owner of found.journals.values()) {
      const journal = await journalSnapshot(directory, owner, state);
      if (journal) journals.push(journal);
    }
    // Validate all metadata ownership before removing any payload. Pending
    // transaction authority remains until every raw original/staged file,
    // journal and transcript backup belonging to this workspace is gone.
    for (const owner of owners) {
      const current = await readSigned(ctx, directory, owner.snapshot.name, state);
      if (!current || current.snapshot.sha256 !== owner.snapshot.sha256) changed();
      assertNonblocking(operation(current, owner.id));
      await removeTransaction(directory, owner, state);
    }
    for (const journal of journals) await unlinkRecord(directory, journal, state);
    for (const backup of backups) await unlinkRecord(directory, backup, state);
    await pruneExpiredPreviews(ctx, directory, workspaceId, state);
    // Pointer records precede their authorities so interrupted cleanup never
    // leaves a dangling latest/family marker beside an erased canonical record.
    for (const kind of ['latest', 'block', 'review', 'plan', 'turn'] as const) {
      for (const item of found.owned.filter(item => item.kind === kind)) {
        await unlinkRecord(directory, item.snapshot, state);
        if (kind === 'block' && item.operation) {
          const markerWorkspace = item.snapshot.name.slice('file-rewind-block-'.length, -'.json'.length);
          clearWorkspaceRecoveryBarrier(ctx.config.workspacesDir, markerWorkspace, item.operation.id);
        }
      }
    }
    for (const owner of owners) await unlinkRecord(directory, owner.snapshot, state);
    await directory.check();
  } finally { await directory.close(); }
}

/** Internal shared I/O for exact-thread deletion. This is intentionally not a
 * workspace cleanup wrapper: callers select and prove their own narrow scope. */
export const fileRewindCleanupInternals = { UUID, HASH, THREAD, WORKSPACE, TURN, HISTORY, HISTORY_BYTES,
  object, hash, fingerprint, budget, check, invalid, changed, blocked, checkedWorkspace, stateDirectory, readJSON, readSigned,
  operation, sameOperation, assertNonblocking, addJournal, journalName, historyBackup, journalSnapshot,
  removeTransaction, unlinkRecord, inspectExpiredPreviews, pruneExpiredPreviews };
export type { Snapshot as FileRewindCleanupSnapshot, SignedRecord as FileRewindCleanupSignedRecord,
  Operation as FileRewindCleanupOperation, JournalOwner as FileRewindCleanupJournalOwner, Budget as FileRewindCleanupBudget };
