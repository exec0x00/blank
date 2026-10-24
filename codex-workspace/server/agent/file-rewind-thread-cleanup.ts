import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppContext } from '../context';
import { HttpError } from '../errors';
import { cleanupThreadGitCheckpoints } from '../git-checkpoints';
import { cleanupStateCasForThreads, discoverStateCasThreadIds } from '../state-cas-cleanup';
import { clearWorkspaceRecoveryBarrier } from '../worktrees/activity';
import { RewindDirectory, isErrno } from './file-rewind-transaction-io';
import { fileRewindCleanupInternals as io, type FileRewindCleanupBudget as Budget,
  type FileRewindCleanupJournalOwner as JournalOwner, type FileRewindCleanupOperation as Operation,
  type FileRewindCleanupSnapshot as Snapshot } from './file-rewind-cleanup';

export interface ThreadFileRewindCleanupInput { workspaceId: string; threadId: string }
type ObjectValue = Record<string, unknown>;
interface OwnedLeaf { snapshot: Snapshot; kind: 'turn' | 'plan' | 'review' | 'latest' | 'block'; operation?: Operation }
interface SignedInventory {
  operations: Map<string, Operation>; selected: Map<string, Operation>; leaves: OwnedLeaf[];
  journals: Map<string, JournalOwner>;
}
interface SourceInventory {
  canonical: Snapshot | null; backups: Map<string, Snapshot>; journals: Map<string, JournalOwner>;
  ownedReferences: Set<string>; foreignReferences: Set<string>; foreignBackups: Set<string>;
}
const BACKUP = /^thread-backup-history_[a-f0-9]{32}$/u;
const FULL_THREAD = /^thread-(thr_[a-f0-9]{32})\.json$/u;
const CHECKPOINT = /^gcp_[a-f0-9]{32}$/u;

// Declared never-returning functions keep TypeScript control-flow narrowing at
// each validated boundary; inferred methods on an exported I/O object do not.
function invalid(): never { return io.invalid(); }
function changed(): never { return io.changed(); }
function blocked(): never { return io.blocked(); }

function referenced(): never {
  throw new HttpError(409, 'Another saved conversation still references this conversation’s rewind data. The shared source files were retained; review that reference before deleting this conversation.', 'FILE_REWIND_REFERENCED');
}
function settled(operation: Operation): void {
  io.assertNonblocking(operation);
  // A failed operation can be settled only when the signed record proves that
  // its original transcript was retained/restored and no recovery block remains.
  if (operation.state === 'recovery_required' && operation.threadUnchanged !== true) blocked();
}
function selected(owner: { workspaceId: string; threadId: string }, input: ThreadFileRewindCleanupInput): boolean {
  if (owner.threadId === input.threadId && owner.workspaceId !== input.workspaceId) invalid();
  return owner.threadId === input.threadId && owner.workspaceId === input.workspaceId;
}
function owner(value: ObjectValue): { workspaceId: string; threadId: string } {
  if (typeof value.workspaceId !== 'string' || !io.WORKSPACE.test(value.workspaceId)
    || typeof value.threadId !== 'string' || !io.THREAD.test(value.threadId)) invalid();
  return { workspaceId: value.workspaceId, threadId: value.threadId };
}

function checkpointReference(value: unknown, origin: { workspaceId: string; threadId: string }, input: ThreadFileRewindCleanupInput): void {
  if (!io.object(value) || value.version !== 1 || typeof value.id !== 'string' || !CHECKPOINT.test(value.id)
    || typeof value.workspaceId !== 'string' || !io.WORKSPACE.test(value.workspaceId)
    || typeof value.threadId !== 'string' || !io.THREAD.test(value.threadId)
    || typeof value.turnId !== 'string' || !io.TURN.test(value.turnId)
    || !['before', 'after', 'backup'].includes(String(value.phase))
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.manifestHash !== 'string' || !io.HASH.test(value.manifestHash)) invalid();
  const reference = { workspaceId: value.workspaceId, threadId: value.threadId };
  if (selected(reference, input) && !selected(origin, input)) referenced();
  // Production plans and turn captures are owned by one exact thread. A record
  // referring outside that scope is not permission to delete the other owner.
  if (reference.workspaceId !== origin.workspaceId || reference.threadId !== origin.threadId) invalid();
}

function planReferences(value: ObjectValue, origin: { workspaceId: string; threadId: string }, input: ThreadFileRewindCleanupInput): void {
  checkpointReference(value.target, origin, input);
  if (!io.object(value.restore) || !Array.isArray(value.restore.files) || !Array.isArray(value.restore.index)
    || value.restore.files.length > 5000 || value.restore.index.length > 5000) invalid();
  for (const row of [...value.restore.files, ...value.restore.index]) {
    if (!io.object(row)) invalid();
    checkpointReference(row.checkpoint, origin, input);
  }
}

async function signedInventory(ctx: AppContext, directory: RewindDirectory, input: ThreadFileRewindCleanupInput, state: Budget): Promise<SignedInventory> {
  const operations = new Map<string, Operation>(), picked = new Map<string, Operation>(), leaves: OwnedLeaf[] = [];
  const markers: Array<{ workspaceId: string; operation: Operation }> = [];
  const plans = new Map<string, { workspaceId: string; threadId: string; signature: string }>();
  const latest: Array<{ snapshot: Snapshot; threadId: string; planId: string; version: string }> = [];
  const reviews: Array<{ snapshot: Snapshot; id: string; workspaceId: string }> = [];
  const journals = new Map<string, JournalOwner>();
  for await (const entry of await fs.opendir(directory.access, { bufferSize: 16 })) {
    state.scanned++; io.check(state);
    const match = /^file-rewind-(operation|turn|plan|review|latest|block)-(.+)\.json$/u.exec(entry.name);
    if (!match) continue;
    const kind = match[1], id = match[2];
    if (kind === 'turn' ? !io.HASH.test(id) : kind === 'latest' ? !io.THREAD.test(id) : kind === 'block' ? !io.WORKSPACE.test(id) : !io.UUID.test(id)) continue;
    const record = await io.readSigned(ctx, directory, entry.name, state);
    if (!record) changed();
    const value = record.value;
    if (kind === 'operation' || kind === 'block') {
      const operation = io.operation(record, kind === 'operation' ? id : undefined);
      if (value.historyBackupDigest !== undefined && (typeof value.historyBackupDigest !== 'string' || !io.HASH.test(value.historyBackupDigest))) invalid();
      if (selected(operation, input)) settled(operation);
      if (kind === 'block') {
        if (!operation.familyIds.includes(id)) invalid();
        markers.push({ workspaceId: id, operation });
      } else {
        operations.set(id, operation);
        if (selected(operation, input)) picked.set(id, operation);
      }
      continue;
    }
    if (kind === 'latest') {
      if (typeof value.planId !== 'string' || !io.UUID.test(value.planId) || typeof value.version !== 'string' || !io.HASH.test(value.version)) invalid();
      latest.push({ snapshot: record.snapshot, threadId: id, planId: value.planId, version: value.version }); continue;
    }
    if (kind === 'review') {
      if (value.version !== 1 || value.recoveryId !== id || typeof value.workspaceId !== 'string' || !io.WORKSPACE.test(value.workspaceId)) invalid();
      reviews.push({ snapshot: record.snapshot, id, workspaceId: value.workspaceId }); continue;
    }
    const origin = owner(value);
    if (value.version !== 1) invalid();
    if (kind === 'plan') {
      if (value.id !== id) invalid();
      planReferences(value, origin, input);
      plans.set(id, { ...origin, signature: record.signature });
    } else {
      if (typeof value.turnId !== 'string' || !io.TURN.test(value.turnId) || io.hash([origin.threadId, value.turnId]) !== id) invalid();
      for (const phase of ['before', 'after'] as const) {
        const capture = value[phase];
        if (phase === 'after' && capture === undefined) continue;
        if (!io.object(capture) || !['ready', 'unavailable'].includes(String(capture.status))) invalid();
        if (capture.status === 'ready') checkpointReference(capture.checkpoint, origin, input);
      }
      if (selected(origin, input)) io.addJournal(journals, { ...origin, turnId: value.turnId });
    }
    if (selected(origin, input)) leaves.push({ snapshot: record.snapshot, kind: kind as 'turn' | 'plan' });
  }
  for (const marker of markers) {
    if (!selected(marker.operation, input)) continue;
    const canonical = picked.get(marker.operation.id);
    if (!canonical || !io.sameOperation(marker.operation, canonical)) invalid();
    settled(marker.operation); settled(canonical);
    leaves.push({ snapshot: marker.operation.snapshot, kind: 'block', operation: marker.operation });
  }
  for (const review of reviews) {
    const canonical = operations.get(review.id);
    // A workspace-only orphan review cannot authorize exact-thread deletion.
    // Preserve it; never guess its thread from another record's filename.
    if (!canonical) continue;
    if (canonical.workspaceId !== review.workspaceId) invalid();
    if (selected(canonical, input)) leaves.push({ snapshot: review.snapshot, kind: 'review' });
  }
  for (const pointer of latest) {
    const canonical = operations.get(pointer.planId), plan = plans.get(pointer.planId), target = canonical ?? plan;
    if (pointer.threadId !== input.threadId) {
      if (target && selected(target, input)) referenced();
      continue;
    }
    if (target && (!selected(target, input) || target.threadId !== pointer.threadId
      || ('selectionVersion' in target ? target.selectionVersion : target.signature) !== pointer.version)) invalid();
    // The canonical thread checked by the caller supplies workspace authority
    // for its own signed stale pointer after an earlier partial cleanup.
    leaves.push({ snapshot: pointer.snapshot, kind: 'latest' });
  }
  await directory.check();
  return { operations, selected: picked, leaves, journals };
}

/** References are only the documented structural fields. A quoted filename in
 * model/tool content, forkedFrom, and shared reviewSnapshots are not rewind
 * storage references. Engine.fork creates its own turn-journal keys. */
function sourceReferences(value: unknown, expectedThreadId: string, input: ThreadFileRewindCleanupInput, found: SourceInventory, state: Budget): void {
  if (!io.object(value) || !io.object(value.thread) || value.thread.id !== expectedThreadId
    || typeof value.thread.workspaceId !== 'string' || !io.WORKSPACE.test(value.thread.workspaceId)) invalid();
  const owned = selected({ workspaceId: value.thread.workspaceId, threadId: expectedThreadId }, input);
  const references = owned ? found.ownedReferences : found.foreignReferences;
  if (value.historyBackups !== undefined) {
    if (!Array.isArray(value.historyBackups) || value.historyBackups.length > 32_768) invalid();
    for (const key of value.historyBackups) {
      if (typeof key !== 'string' || !BACKUP.test(key)) invalid();
      references.add(`${key}.json`);
    }
  }
  if (value.turnJournals !== undefined) {
    if (!io.object(value.turnJournals) || Object.keys(value.turnJournals).length > 32_768) invalid();
    for (const [turnId, key] of Object.entries(value.turnJournals)) {
      if (!io.TURN.test(turnId) || typeof key !== 'string') invalid();
      const expected = io.journalName({ threadId: expectedThreadId, turnId });
      if (`${key}.json` !== expected) {
        if (key.startsWith(`thread-turn-${input.threadId}-`)) referenced();
        invalid();
      }
      references.add(expected);
      if (owned) io.addJournal(found.journals, { ...input, turnId });
    }
  }
  if (owned && value.pendingJournal !== undefined) {
    if (!io.object(value.pendingJournal) || typeof value.pendingJournal.turnId !== 'string' || !Array.isArray(value.pendingJournal.input)) invalid();
    io.addJournal(found.journals, { ...input, turnId: value.pendingJournal.turnId });
  }
  state.scanned++; io.check(state);
}

async function sources(ctx: AppContext, directory: RewindDirectory, input: ThreadFileRewindCleanupInput, state: Budget,
  signed: SignedInventory): Promise<SourceInventory> {
  const found: SourceInventory = { canonical: null, backups: new Map(), journals: new Map(signed.journals), ownedReferences: new Set(), foreignReferences: new Set(), foreignBackups: new Set() };
  for await (const entry of await fs.opendir(directory.access, { bufferSize: 16 })) {
    state.scanned++; io.check(state);
    const full = FULL_THREAD.exec(entry.name), backup = BACKUP.test(entry.name.slice(0, -5)) && entry.name.endsWith('.json');
    if (!full && !backup) continue;
    const record = await io.readJSON(directory, entry.name, state, io.HISTORY_BYTES);
    if (!record) changed();
    if (full) {
      sourceReferences(record.value, full[1], input, found, state);
      if (full[1] === input.threadId) found.canonical = record.snapshot;
    } else {
      const value = record.value;
      if (!io.object(value) || ![1, 2].includes(value.version as number) || typeof value.threadId !== 'string' || !io.THREAD.test(value.threadId)) invalid();
      sourceReferences(value.record, value.threadId, input, found, state);
      if (value.threadId === input.threadId) {
        found.backups.set(entry.name, record.snapshot);
        if (value.turnInputs !== undefined) {
          if (!Array.isArray(value.turnInputs) || value.turnInputs.length > 32_768) invalid();
          for (const journal of value.turnInputs) {
            if (!io.object(journal) || typeof journal.turnId !== 'string' || !Array.isArray(journal.input)) invalid();
            io.addJournal(found.journals, { ...input, turnId: journal.turnId });
          }
        }
      } else found.foreignBackups.add(entry.name);
    }
  }
  for (const operation of signed.selected.values()) {
    const snapshot = await io.historyBackup(directory, operation, found.journals, state, true);
    if (snapshot) {
      const previous = found.backups.get(snapshot.name);
      if (previous && previous.sha256 !== snapshot.sha256) changed();
      found.backups.set(snapshot.name, snapshot);
    }
  }
  return found;
}

function assertUnreferenced(found: SourceInventory): void {
  for (const key of found.foreignReferences) if (found.backups.has(key) || found.journals.has(key)) referenced();
  // Engine.remove may later idempotently delete its current historyBackups.
  // Refuse a source that would turn that step into deletion of another owner.
  for (const key of found.ownedReferences) if (found.foreignBackups.has(key)) referenced();
}

async function assertNoUnownedTransaction(directory: RewindDirectory, input: ThreadFileRewindCleanupInput, known: ReadonlyMap<string, Operation>, state: Budget): Promise<void> {
  let base: RewindDirectory;
  try { base = await directory.child('file-rewinds'); }
  catch (error) { if (isErrno(error, 'ENOENT')) return; throw error; }
  try {
    for await (const entry of await fs.opendir(base.access, { bufferSize: 16 })) {
      state.scanned++; io.check(state);
      if (!io.UUID.test(entry.name) || known.has(entry.name)) continue;
      const transaction = await base.child(entry.name);
      try {
        const record = await io.readJSON(transaction, 'identity.json', state);
        if (!record) {
          // An empty creation has no source bytes. Any unattributed nonempty
          // recovery directory needs inspection instead of a false success.
          for await (const _entry of await fs.opendir(transaction.access, { bufferSize: 1 })) invalid();
          continue;
        }
        const value = record.value;
        if (!io.object(value) || value.version !== 1 || value.id !== entry.name) invalid();
        if (selected(owner(value), input)) invalid();
      } finally { await transaction.close(); }
    }
  } finally { await base.close(); }
}

async function assertTransactionOwnership(directory: RewindDirectory, selected: ReadonlyMap<string, Operation>, state: Budget): Promise<void> {
  if (!selected.size) return;
  let base: RewindDirectory;
  try { base = await directory.child('file-rewinds'); }
  catch (error) { if (isErrno(error, 'ENOENT')) return; throw error; }
  try {
    for (const operation of selected.values()) {
      let transaction: RewindDirectory;
      try { transaction = await base.child(operation.id); }
      catch (error) { if (isErrno(error, 'ENOENT')) continue; throw error; }
      try {
        const record = await io.readJSON(transaction, 'identity.json', state);
        if (!record) {
          for await (const _entry of await fs.opendir(transaction.access, { bufferSize: 1 })) invalid();
          continue;
        }
        const value = record.value;
        if (!io.object(value) || value.version !== 1 || value.id !== operation.id
          || value.workspaceId !== operation.workspaceId || value.threadId !== operation.threadId) invalid();
      } finally { await transaction.close(); }
    }
  } finally { await base.close(); }
}

/** Exact-thread deletion leaf. Engine must already have stopped/drained this
 * thread and its selected child family, naming, queues and history maintenance.
 * Call before canonical source/ownership records disappear. This function does
 * not delete working files, initialize services, sweep a workspace, or acquire
 * workspace/file activity. Do not invoke it inside the thread key's JsonStore
 * queue: the CAS leaf enters that queue itself for exact source-copy cleanup. */
export async function cleanupThreadFileRewinds(ctx: AppContext, input: ThreadFileRewindCleanupInput): Promise<void> {
  input = { workspaceId: input.workspaceId, threadId: input.threadId };
  io.checkedWorkspace(input.workspaceId);
  if (!io.THREAD.test(input.threadId) || path.resolve(ctx.store.directory) !== path.resolve(ctx.config.stateDir)) invalid();
  const directory = await io.stateDirectory(ctx);
  if (!directory) return;
  const state = io.budget();
  try {
    const signed = await signedInventory(ctx, directory, input, state);
    await io.inspectExpiredPreviews(ctx, directory, input.workspaceId, state, input.threadId);
    const source = await sources(ctx, directory, input, state, signed);
    // The normal engine supplies the canonical owner until this leaf finishes.
    // Without it, signed rewind records/backups still prove safe retry scope;
    // an orphan pointer alone does not invent workspace ownership.
    if (!source.canonical && !source.backups.size && !signed.selected.size && !signed.leaves.some(row => row.kind === 'turn' || row.kind === 'plan')) {
      if (signed.leaves.length) invalid();
    }
    const checkAllowed = async () => {
      io.check(state); await directory.check();
      const name = `thread-${input.threadId}.json`;
      const observed = await fs.lstat(`${directory.access}/${name}`, { bigint: true }).catch(error => { if (isErrno(error, 'ENOENT')) return null; throw error; });
      if (source.canonical ? !observed || io.fingerprint(observed) !== source.canonical.fingerprint : observed !== null) changed();
    };
    await checkAllowed();
    await discoverStateCasThreadIds(ctx.config, { workspaceId: input.workspaceId, threadIds: [input.threadId], checkAllowed,
      onVerifiedSource: (id, workspaceId, value) => {
        if (!io.object(value) || !io.object(value.thread) || value.thread.workspaceId !== workspaceId) invalid();
        sourceReferences(value, id, input, source, state);
      } });
    assertUnreferenced(source);
    await assertNoUnownedTransaction(directory, input, signed.operations, state);
    await assertTransactionOwnership(directory, signed.selected, state);
    const journals: Snapshot[] = [];
    for (const owner of source.journals.values()) {
      const record = await io.journalSnapshot(directory, owner, state);
      if (record) journals.push(record);
    }
    await checkAllowed();
    // Ownership and survivor checks precede every destructive subsystem. These
    // leaves retain their own retry proofs; canonical thread/operation authority
    // remains until all source-bearing recovery and checkpoint copies are gone.
    await cleanupStateCasForThreads(ctx.config, { workspaceId: input.workspaceId, threadIds: [input.threadId], checkAllowed,
      withSourceMutation: (key, operation) => ctx.store.mutateGuarded(key, operation) });
    await checkAllowed();
    await cleanupThreadGitCheckpoints(ctx.config, input.workspaceId, input.threadId);
    for (const operation of signed.selected.values()) {
      await checkAllowed();
      const current = await io.readSigned(ctx, directory, operation.snapshot.name, state);
      if (!current || current.snapshot.sha256 !== operation.snapshot.sha256) changed();
      settled(io.operation(current, operation.id));
      await io.removeTransaction(directory, operation, state, checkAllowed);
    }
    const remove = (snapshot: Snapshot) => ctx.store.mutateGuarded(snapshot.name.slice(0, -5), async () => {
      await checkAllowed(); await io.unlinkRecord(directory, snapshot, state);
    });
    for (const journal of journals) await remove(journal);
    for (const backup of source.backups.values()) await remove(backup);
    await io.pruneExpiredPreviews(ctx, directory, input.workspaceId, state, input.threadId);
    for (const kind of ['latest', 'block', 'review', 'plan', 'turn'] as const) {
      for (const leaf of signed.leaves.filter(row => row.kind === kind)) {
        await remove(leaf.snapshot);
        if (kind === 'block' && leaf.operation) {
          const workspaceId = leaf.snapshot.name.slice('file-rewind-block-'.length, -5);
          clearWorkspaceRecoveryBarrier(ctx.config.workspacesDir, workspaceId, leaf.operation.id);
        }
      }
    }
    for (const operation of signed.selected.values()) await remove(operation.snapshot);
    await checkAllowed();
  } finally { await directory.close(); }
}
