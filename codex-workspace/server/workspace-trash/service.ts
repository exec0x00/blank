import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config';
import type { JsonStore } from '../store';
import type { Workspace } from '../../shared/types';
import { HttpError } from '../errors';
import { withWorkspaceRemoval } from '../worktrees/activity';
import type { TrashSnapshot, WorkspaceDeleteResult, WorkspaceDeletionPlan, WorkspaceDeletionStatus, WorkspaceDeletionPage, WorkspaceTrashDeleteResult, WorkspaceTrashEntry, WorkspaceTrashPage, WorkspaceTrashRecord, WorkspaceTrashRegistry } from './types';
import { checkedTrashWorkspace, listTrashRecords, readTrashRecord, TRASH_ID, TRASH_RECORD_PREFIX, TRASH_RETENTION_MS, withTrashRecordCapacity, writeTrashRecord, WORKSPACE_ID } from './records';
import { isGithubWorkspace } from './classification';
import { expireFileTrash } from './retention';
import { captureTree, checkedDirectory, checkedSnapshot, checkedWorkspacePath, conflict, copyTree, errno, identity, inspectWorkspaceRoot,
  lstatMaybe, MAX_METADATA_BYTES, MAX_TRASH_ENTRIES, PinnedDirectory, readText, recoverTreeMetadata, removeTree, sameIdentity, trashStorage,
  unsafe, within, workspaceStorage } from './filesystem';
import { operationalIndexPage, operationalListChanged, operationalPageQuery, operationalRecordIds, type OperationalPageInput } from '../operational-pages';

/** Internal deletion authority. It is never accepted from an HTTP request. */
export interface WorkspaceArtifactCleanupRequest {
  readonly workspaceId: string;
  readonly deletionId: string;
  /** Original policy; this hook runs only at permanent purge for both values. */
  readonly mode: WorkspaceDeletionPlan['mode'];
  readonly deletedAt: string;
  /** Recheck between independently owned cleanup stages. Never acquire this workspace's activity gate again. */
  assertCurrent(): Promise<void>;
}

export interface WorkspaceLifecycleOptions {
  checkpointFileMetadata?: () => Promise<void>;
  /** Pure, startup-safe signed-state validation, before any archive/move or permanent purge. */
  assertWorkspaceDeletionAllowed?: (workspaceId: string) => Promise<void>;
  /** Stop exact-workspace ephemeral work only after lifecycle admission, before
   * archival or destructive work. Runs inside the caller's existing lifecycle
   * gate, must be idempotent, and must not reacquire that gate or initialize the
   * workspace service. Keep a returned admission lease through authoritative
   * publication and release it in finally. Failure preserves current bytes. */
  quiesceWorkspace?: (workspaceId: string) => Promise<void | (() => void)>;
  /** Already inside the removal gate, after workspace/file-trash bytes are gone. Must be idempotent. */
  cleanupWorkspaceArtifacts?: (request: WorkspaceArtifactCleanupRequest) => Promise<void>;
}
const queues = new Map<string, Promise<void>>();
const admitted = new Set<string>();

async function queued<T>(key: string, work: () => Promise<T>): Promise<T> {
  const before = queues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const tail = before.catch(() => undefined).then(() => barrier);
  queues.set(key, tail);
  await before.catch(() => undefined);
  try { return await work(); }
  finally { release(); if (queues.get(key) === tail) queues.delete(key); }
}

const hidden = (record: WorkspaceTrashRecord) => ['purged', 'restored', 'cancelled'].includes(record.phase);
function recovery(message: string): HttpError { return new HttpError(409, message, 'WORKSPACE_TRASH_RECOVERY'); }
function publicEntry(record: WorkspaceTrashRecord): WorkspaceTrashEntry {
  const state = record.phase === 'ready' ? 'ready' : record.phase === 'missing' ? 'missing' : 'recovery';
  return { id: record.id, workspaceId: record.workspace.id, name: record.workspace.name, deletedAt: record.deletedAt,
    expiresAt: record.expiresAt, reason: record.reason, state, canRestore: state === 'ready' && record.mode === 'trash'
      && Date.parse(record.expiresAt) > Date.now() && !record.workspace.worktree && !record.restore,
    ...(record.issue ? { issue: record.issue } : {}) };
}

/** Native files only. Ordinary trash never removes a shared Git administration directory. */
export class WorkspaceTrashService {
  private timer?: ReturnType<typeof setInterval>;
  private closing = false;
  private cleanup?: Promise<void>;
  private readonly operations = new Set<Promise<unknown>>();
  constructor(private readonly config: AppConfig, private readonly store: JsonStore, private readonly registry: WorkspaceTrashRegistry,
    private readonly options: WorkspaceLifecycleOptions = {}) {}

  private key(workspaceId: string): string { return `${this.config.workspacesDir}\0${workspaceId}`; }

  private guarded<T>(workspaceId: string, work: () => Promise<T>): Promise<T> {
    if (!WORKSPACE_ID.test(workspaceId)) throw new HttpError(404, 'Workspace not found.', 'WORKSPACE_NOT_FOUND');
    if (this.closing) return Promise.reject(new HttpError(503, 'The server is restarting. Try the workspace action again after it returns.', 'WORKSPACE_TRASH_CLOSING'));
    const pending = queued(this.key(workspaceId), async () => {
      try {
        return await withWorkspaceRemoval(this.config.workspacesDir, workspaceId, async () => {
          admitted.add(this.key(workspaceId));
          try { return await work(); } finally { admitted.delete(this.key(workspaceId)); }
        });
      } catch (error) {
        if (error instanceof HttpError && error.code === 'WORKTREE_BUSY') {
          throw new HttpError(409, 'This workspace is in use. Close its terminals and wait for agent, Git, upload and file operations to finish before deleting it.', 'WORKSPACE_BUSY');
        }
        throw error;
      }
    });
    this.operations.add(pending);
    void pending.finally(() => this.operations.delete(pending)).catch(() => undefined);
    return pending;
  }

  private async checkpoint(): Promise<void> { await this.options.checkpointFileMetadata?.(); }

  private async save(record: WorkspaceTrashRecord, changes: Partial<WorkspaceTrashRecord>): Promise<WorkspaceTrashRecord> {
    const next = { ...record, ...changes, updatedAt: new Date().toISOString() };
    await writeTrashRecord(this.config, this.store, next);
    return next;
  }

  private async entryDirectory(record: WorkspaceTrashRecord): Promise<string> {
    const base = await trashStorage(this.config);
    const directory = path.join(base, record.id);
    await checkedDirectory(base, directory);
    const owner = await readText(path.join(directory, 'owner.json'), 2048);
    let value: { version?: unknown; id?: unknown; workspaceId?: unknown };
    try { value = JSON.parse(owner); } catch { return unsafe('The workspace trash ownership record is invalid.'); }
    if (!value || value.version !== 1 || value.id !== record.id || value.workspaceId !== record.workspace.id) unsafe('The workspace trash entry no longer has its original ownership record.');
    return directory;
  }

  private async snapshot(record: WorkspaceTrashRecord): Promise<TrashSnapshot> {
    const directory = await this.entryDirectory(record);
    let value: unknown;
    try { value = JSON.parse(await readText(path.join(directory, 'snapshot.json'), MAX_METADATA_BYTES)); }
    catch (error) { if (error instanceof SyntaxError) unsafe('The saved workspace trash snapshot is invalid.'); throw error; }
    return checkedSnapshot(value);
  }

  private async fileTrashPath(workspaceId: string): Promise<string | null> {
    const base = await workspaceStorage(this.config);
    const parent = path.join(base, '.trash');
    const stat = await lstatMaybe(parent);
    if (!stat) return null;
    await checkedDirectory(base, parent);
    const target = path.join(parent, workspaceId);
    const entry = await lstatMaybe(target);
    if (!entry) return null;
    await checkedDirectory(base, target);
    return target;
  }

  private async assertIndependent(workspace: Workspace, missingOnly: boolean): Promise<void> {
    if (workspace.worktree) {
      if (missingOnly) return; // Metadata reconciliation never moves a managed checkout or its Git links.
      throw new HttpError(409, 'Use this managed worktree’s Archive or Remove action. Its shared Git metadata cannot be moved into ordinary workspace trash.', 'WORKSPACE_MANAGED_WORKTREE');
    }
    for (const other of await this.registry.registrations()) {
      if (other.id === workspace.id) continue;
      if (other.worktree?.repositoryWorkspaceId === workspace.id) {
        // Removed worktree registration metadata is intentionally retained. A
        // surviving native admin directory or nonterminal manager journal below
        // determines whether it still prevents primary repository deletion.
        const journal = path.join(this.config.stateDir, `managed-worktree-${other.worktree.id}.json`);
        let removed = false;
        try {
          const value = JSON.parse(await readText(journal, 32 * 1024)) as { phase?: unknown; repositoryWorkspaceId?: unknown; workspaceId?: unknown };
          removed = value.phase === 'removed' && value.repositoryWorkspaceId === workspace.id && value.workspaceId === other.id;
        } catch (error) { if (!errno(error, 'ENOENT')) throw error; }
        if (!removed) throw new HttpError(409, 'This repository still owns linked worktrees. Remove them with the worktree manager before deleting the primary workspace.', 'WORKSPACE_HAS_WORKTREES');
      }
      if (typeof other.path === 'string' && within(this.config.workspacesDir, other.path)
        && (within(workspace.path, other.path) || within(other.path, workspace.path))) {
        throw new HttpError(409, 'Another workspace registration shares this directory. Resolve the overlapping registrations before moving any files.', 'WORKSPACE_STORAGE_SHARED');
      }
    }
    // This also catches interrupted creations and unmanaged linked checkouts.
    for (const name of await fs.readdir(this.config.stateDir)) {
      if (!/^managed-worktree-[a-f0-9-]{36}\.json$/.test(name)) continue;
      const value = JSON.parse(await readText(path.join(this.config.stateDir, name), 32 * 1024)) as { repositoryWorkspaceId?: unknown; phase?: unknown };
      if (value.repositoryWorkspaceId === workspace.id && value.phase !== 'removed') {
        throw new HttpError(409, 'This repository still has a managed worktree or an unfinished worktree operation. Resolve it in the worktree manager before deleting the workspace.', 'WORKSPACE_HAS_WORKTREES');
      }
    }
    if (missingOnly) return;
    const git = path.join(workspace.path, '.git');
    const gitStat = await lstatMaybe(git);
    if (!gitStat) return;
    if (!gitStat.isDirectory() || gitStat.isSymbolicLink()) {
      throw new HttpError(409, 'This checkout uses linked Git metadata. Use its owning worktree manager before deleting the workspace.', 'WORKSPACE_MANAGED_WORKTREE');
    }
    await checkedDirectory(this.config.workspacesDir, git);
    const administration = path.join(git, 'worktrees');
    if (await lstatMaybe(administration)) {
      await checkedDirectory(git, administration);
      if ((await fs.readdir(administration)).length) {
        throw new HttpError(409, 'Git still records linked checkouts for this repository. Resolve them with the worktree manager before deleting the primary workspace.', 'WORKSPACE_HAS_WORKTREES');
      }
    }
  }

  private async allocate(workspace: Workspace, reason: 'deleted' | 'missing', snapshot: TrashSnapshot,
    contentIdentity?: WorkspaceTrashRecord['contentIdentity'], fileTrashIdentity?: WorkspaceTrashRecord['fileTrashIdentity'],
    mode: WorkspaceDeletionPlan['mode'] = 'trash'): Promise<WorkspaceTrashRecord> {
    return withTrashRecordCapacity(this.config, TRASH_RECORD_PREFIX, async () => {
    const base = await trashStorage(this.config);
    const id = randomUUID();
    const directory = path.join(base, id);
    // The UUID directory is the create-only allocation, never an overwriteable shared target.
    const now = new Date().toISOString();
    const record: WorkspaceTrashRecord = { version: 1, id, workspace, reason, mode, deletedAt: now,
      expiresAt: new Date(Date.parse(now) + TRASH_RETENTION_MS).toISOString(), updatedAt: now, phase: 'preparing',
      ...(contentIdentity ? { contentIdentity } : {}), ...(fileTrashIdentity ? { fileTrashIdentity } : {}) };
    const serialized = JSON.stringify(snapshot);
    if (Buffer.byteLength(serialized) > MAX_METADATA_BYTES) throw new HttpError(413, 'The workspace trash snapshot exceeds its metadata limit.', 'WORKSPACE_TRASH_LIMIT');
    const parent = await PinnedDirectory.open(base);
    let entry: PinnedDirectory | undefined;
    try {
      await parent.check();
      await fs.mkdir(`${parent.access}/${id}`, { mode: 0o700 });
      entry = await PinnedDirectory.open(directory, `${parent.access}/${id}`);
      await parent.check(); await entry.check();
      await fs.writeFile(`${entry.access}/owner.json`, JSON.stringify({ version: 1, id, workspaceId: workspace.id }), { flag: 'wx', mode: 0o600 });
      await entry.check();
      await fs.writeFile(`${entry.access}/snapshot.json`, serialized, { flag: 'wx', mode: 0o600 });
      await entry.check(); await parent.check();
      await writeTrashRecord(this.config, this.store, record, true);
    } finally { await entry?.close(); await parent.close(); }
    return record;
    });
  }

  async deletionPlan(workspaceId: string): Promise<WorkspaceDeletionPlan> {
    const registered = await this.registry.registration(workspaceId);
    if (!registered) throw new HttpError(404, 'Workspace not found.', 'WORKSPACE_NOT_FOUND');
    const workspace = checkedTrashWorkspace(this.config, registered);
    const existing = (await listTrashRecords(this.config)).find(record => record.workspace.id === workspaceId);
    if (existing && await this.registry.archivedBy(workspaceId, existing.id)) {
      return { workspaceId, mode: existing.mode, retentionDays: existing.mode === 'trash' ? 30 : null };
    }
    if (!await this.registry.active(workspaceId)) throw new HttpError(404, 'Workspace not found.', 'WORKSPACE_NOT_FOUND');
    const present = await inspectWorkspaceRoot(this.config, workspace.path);
    await this.assertIndependent(workspace, !present);
    const mode = await isGithubWorkspace(this.config, workspace) ? 'permanent' : 'trash';
    return { workspaceId, mode, retentionDays: mode === 'trash' ? 30 : null };
  }

  private async move(record: WorkspaceTrashRecord, source: string, name: 'content' | 'file-trash', expected: NonNullable<WorkspaceTrashRecord['contentIdentity']>): Promise<void> {
    const entry = await this.entryDirectory(record);
    await checkedDirectory(this.config.workspacesDir, path.dirname(source));
    const from = await PinnedDirectory.open(path.dirname(source));
    const to = await PinnedDirectory.open(entry);
    try {
      await from.check(); await to.check();
      const sourceAccess = `${from.access}/${path.basename(source)}`;
      const destination = `${to.access}/${name}`;
      const stat = await fs.lstat(sourceAccess);
      if (!stat.isDirectory() || stat.isSymbolicLink() || !sameIdentity(stat, expected)) unsafe('The workspace directory changed before it could be moved. Both locations were retained for inspection.');
      if (await lstatMaybe(destination)) unsafe('This trash destination already exists. Existing files were not overwritten.');
      await fs.rename(sourceAccess, destination);
      await from.check(); await to.check();
      const moved = await fs.lstat(destination);
      if (!moved.isDirectory() || moved.isSymbolicLink() || !sameIdentity(moved, expected)) unsafe('The moved workspace no longer matches its journal. Its contents were retained for inspection.');
    } finally { await from.close(); await to.close(); }
  }

  async trash(workspaceId: string, missingOnly = false, expectedMode?: WorkspaceDeletionPlan['mode']): Promise<WorkspaceDeleteResult | null> {
    return this.guarded(workspaceId, async () => {
      const registered = await this.registry.registration(workspaceId);
      if (!registered) throw new HttpError(404, 'Workspace not found.', 'WORKSPACE_NOT_FOUND');
      const workspace = checkedTrashWorkspace(this.config, registered);
      const plan = await this.deletionPlan(workspaceId);
      if (expectedMode !== undefined && expectedMode !== plan.mode) throw new HttpError(409, 'The workspace deletion mode changed. Review its current deletion action before continuing.', 'WORKSPACE_DELETION_CHANGED');
      if (!missingOnly && plan.mode === 'permanent' && expectedMode !== 'permanent') {
        throw new HttpError(400, 'This GitHub repository requires an explicit permanent-deletion confirmation.', 'WORKSPACE_PERMANENT_CONFIRMATION_REQUIRED');
      }
      const existing = (await listTrashRecords(this.config)).find(record => record.workspace.id === workspaceId);
      if (existing && await this.registry.archivedBy(workspaceId, existing.id)) {
        if (existing.mode === 'permanent') {
          if (existing.phase !== 'purged') {
            const checked = ['ready', 'missing', 'purging'].includes(existing.phase) ? existing : await this.reconcileRecord(existing);
            if (!['ready', 'missing', 'purging'].includes(checked.phase)) throw recovery('Permanent deletion has not safely moved the original files. They were preserved; inspect the workspace before retrying.');
            await this.purgeRecord(await this.save(checked, { phase: 'purging', issue: undefined }));
          }
          return { removed: true, mode: 'permanent', workspaceId };
        }
        if (hidden(existing)) throw new HttpError(410, 'This workspace was already deleted.', 'WORKSPACE_ALREADY_DELETED');
        return { removed: true, mode: 'trash', trash: publicEntry(existing) };
      }
      if (!await this.registry.active(workspaceId)) throw new HttpError(404, 'Workspace not found.', 'WORKSPACE_NOT_FOUND');
      const root = await inspectWorkspaceRoot(this.config, workspace.path);
      if (missingOnly && root) return null;
      await this.assertIndependent(workspace, !root);
      await this.options.assertWorkspaceDeletionAllowed?.(workspace.id);
      const release = await this.options.quiesceWorkspace?.(workspace.id);
      try {
        const stillRegistered = await this.registry.registration(workspace.id);
        if (!stillRegistered || stillRegistered.path !== workspace.path || stillRegistered.createdAt !== workspace.createdAt) {
          throw recovery('The workspace registration changed while its active sessions were stopping. Its files were retained.');
        }
        if (!await this.registry.active(workspace.id)) throw new HttpError(404, 'Workspace not found.', 'WORKSPACE_NOT_FOUND');
        const currentRoot = await inspectWorkspaceRoot(this.config, workspace.path);
        if (!!root !== !!currentRoot || root && currentRoot && !sameIdentity(currentRoot, identity(root))) {
          throw recovery('The workspace directory changed while its active sessions were stopping. Its files were retained.');
        }
        if ((await this.deletionPlan(workspace.id)).mode !== plan.mode) {
          throw new HttpError(409, 'The workspace deletion mode changed. Review its current deletion action before continuing.', 'WORKSPACE_DELETION_CHANGED');
        }
        // Ordinary file-trash keeps its original per-item 30-day deadline. Its
        // stable workspace ID reconnects it on restore; whole-workspace purge
        // stages that directory later under the same removal fence.
        const fileTrash = workspace.worktree || plan.mode === 'trash' ? null : await this.fileTrashPath(workspace.id);
        const snapshot: TrashSnapshot = { version: 1, content: root ? await captureTree(workspace.path) : null,
          fileTrash: fileTrash ? await captureTree(fileTrash) : null };
        let record = await this.allocate(workspace, root ? 'deleted' : 'missing', snapshot, root ? identity(root) : undefined,
          fileTrash ? identity(await fs.lstat(fileTrash)) : undefined, plan.mode);
        let published = false;
        try {
          // The archive fences new access before any rename. Restart metadata
          // restoration reads this exact journal/tombstone pair too.
          await this.registry.archive(record);
          published = true;
          if (root) await this.move(record, workspace.path, 'content', record.contentIdentity!);
          if (fileTrash) await this.move(record, fileTrash, 'file-trash', record.fileTrashIdentity!);
          record = await this.save(record, { phase: root ? 'ready' : 'missing',
            issue: root ? undefined : 'The original workspace directory is missing. Its saved metadata was retained, but the original files cannot be restored.' });
          await this.registry.repairSelection();
          if (record.mode === 'permanent') {
            record = await this.save(record, { phase: 'purging', issue: undefined });
            await this.purgeRecord(record);
            return { removed: true, mode: 'permanent', workspaceId };
          }
          await this.checkpoint();
          return { removed: true, mode: 'trash', trash: publicEntry(record) };
        } catch (error) {
          // The journal was committed first. Never delete either side to make an
          // incomplete move look successful; restart reconciles actual locations.
          const issue = record.phase === 'purging'
            ? 'Permanent deletion did not finish. Remaining workspace-owned data was retained for a safe retry.'
            : published
            ? 'Moving this workspace did not finish. Files in the original and trash locations were retained for recovery.'
            : 'Workspace deletion did not publish its archive. The original files were retained.';
          const latest = await readTrashRecord(this.config, record.id).catch(() => null);
          if (latest && !hidden(latest)) await this.save(latest, { phase: record.phase === 'purging' ? 'purging' : 'recovery', issue }).catch(() => undefined);
          if (published) await this.registry.repairSelection().catch(() => undefined);
          if (error instanceof HttpError) throw error;
          throw recovery(issue);
        }
      } finally { if (typeof release === 'function') release(); }
    });
  }

  /** Returns true only for corroborated ENOENT. Storage errors remain distinct. */
  async reconcileMissing(workspace: Workspace): Promise<boolean> {
    let stat;
    try { stat = await inspectWorkspaceRoot(this.config, workspace.path); }
    catch { return false; } // No lifecycle decision follows an unavailable/unsafe storage read.
    if (stat) return false;
    // A vanished directory cannot be moved. Publishing only its metadata does
    // not require stopping a PTY whose cwd is already gone, and never touches
    // surviving linked Git metadata or an active per-file trash operation.
    return queued(this.key(workspace.id), async () => {
      if (!await this.registry.active(workspace.id)) return true;
      const current = await this.registry.registration(workspace.id);
      if (!current) return true;
      const checked = checkedTrashWorkspace(this.config, current);
      if (await inspectWorkspaceRoot(this.config, checked.path)) return false;
      const mode = await isGithubWorkspace(this.config, checked) ? 'permanent' : 'trash';
      const release = await this.options.quiesceWorkspace?.(checked.id);
      try {
        const after = await this.registry.registration(checked.id);
        if (!after || !await this.registry.active(checked.id)) return true;
        if (after.path !== checked.path || after.createdAt !== checked.createdAt) {
          throw recovery('The workspace registration changed while its missing directory was being retired. Current metadata was retained.');
        }
        // A slow session close does not turn an earlier missing-directory read
        // into authority to retire a directory which has since returned.
        if (await inspectWorkspaceRoot(this.config, checked.path)) return false;
        let record = await this.allocate(checked, 'missing', { version: 1, content: null, fileTrash: null }, undefined, undefined, mode);
        await this.registry.archive(record);
        record = await this.save(record, { phase: 'missing',
          issue: mode === 'permanent' ? undefined : 'The original workspace directory is missing. Its metadata was retained, but original file contents cannot be restored.' });
        await this.registry.repairSelection();
        return true;
      } finally { if (typeof release === 'function') release(); }
    });
  }

  private async reconcileRecord(record: WorkspaceTrashRecord): Promise<WorkspaceTrashRecord> {
    if (record.phase === 'restored') { await this.cleanEntry(record); return record; }
    if (hidden(record)) return record;
    if (record.phase === 'purging') {
      // An explicit permanent-delete intent survives restart; only its owned
      // trash directory can be touched by resumed cleanup.
      return this.purgeRecord(record);
    }
    if (record.phase === 'restoring' || record.restore) {
      if (record.restore?.phase === 'copied' && (await this.registry.restoredBy(record.workspace.id, record.id)
        || await this.registry.archivedBy(record.workspace.id, record.id))) {
        return this.finishRestore(record);
      }
      return this.save(record, { phase: 'recovery', issue: 'Restoration was interrupted. The original trash copy and any copied files were retained; a partial folder was not opened as a workspace.' });
    }
    if (await this.registry.active(record.workspace.id) && !await this.registry.archivedBy(record.workspace.id, record.id)) {
      // A failed pre-archive allocation or an explicit managed-worktree reopen
      // leaves the active workspace alone. This journal cannot archive it later.
      return this.save(record, { phase: 'cancelled', issue: undefined });
    }
    const directory = await this.entryDirectory(record);
    const snapshot = await this.snapshot(record);
    const contentPath = path.join(directory, 'content');
    const content = await lstatMaybe(contentPath);
    const original = await inspectWorkspaceRoot(this.config, record.workspace.path);
    if (snapshot.content && !content && original && record.contentIdentity && sameIdentity(original, record.contentIdentity)
      && await this.registry.archivedBy(record.workspace.id, record.id)) {
      // The move never started on this same native filesystem. Roll back the
      // registration only when the original inode and full metadata agree.
      if (JSON.stringify(await captureTree(record.workspace.path)) === JSON.stringify(snapshot.content)
        && (!snapshot.fileTrash || !!await this.fileTrashPath(record.workspace.id))) {
        await this.registry.restore(record);
        return this.save(record, { phase: 'cancelled', issue: undefined });
      }
    }
    if (!content && original) {
      return this.save(record, { phase: 'recovery', issue: 'The original workspace location still contains files, but its native identity changed before the move finished. Those files were preserved; this is not a missing-file recovery.' });
    }
    const filesPresent = snapshot.content ? await recoverTreeMetadata(contentPath, snapshot.content) : false;
    if (snapshot.fileTrash) {
      const retained = path.join(directory, 'file-trash');
      if (!await lstatMaybe(retained)) {
        const originalFileTrash = await this.fileTrashPath(record.workspace.id);
        if (originalFileTrash && record.fileTrashIdentity && sameIdentity(await fs.lstat(originalFileTrash), record.fileTrashIdentity)) {
          await this.move(record, originalFileTrash, 'file-trash', record.fileTrashIdentity);
        }
      }
      if (!await recoverTreeMetadata(retained, snapshot.fileTrash)) {
        return this.save(record, { phase: 'recovery', issue: 'Some previously deleted files are missing from this workspace’s trash copy. Available contents were retained.' });
      }
    }
    if (!filesPresent) return this.save(record, { phase: 'missing', issue: 'The original workspace files are missing. Saved metadata remains available, but it cannot restore missing file contents.' });
    // A recreated original folder never counts as recovered content and is
    // never removed here. Restore will fail its exclusive mkdir visibly.
    return this.save(record, { phase: 'ready', issue: original ? 'The original location now contains a folder. It will not be overwritten during restoration.' : undefined });
  }

  async initialize(): Promise<void> {
    await trashStorage(this.config);
    for (const candidate of await listTrashRecords(this.config)) {
      if (['purged', 'cancelled'].includes(candidate.phase) || admitted.has(this.key(candidate.workspace.id))) continue;
      try {
        await this.guarded(candidate.workspace.id, async () => {
          const current = await readTrashRecord(this.config, candidate.id);
          if (current) await this.reconcileRecord(current);
        });
      } catch (error) {
        if (error instanceof HttpError && error.code === 'WORKSPACE_BUSY') continue;
        const latest = await readTrashRecord(this.config, candidate.id);
        if (latest && latest.phase !== 'purged' && latest.phase !== 'cancelled') await this.save(latest, { phase: latest.phase === 'purging' || latest.phase === 'restored' ? latest.phase : 'recovery',
          issue: 'This workspace trash entry could not be recovered safely. Existing files were retained for inspection.' });
      }
    }
    await this.registry.repairSelection();
    await this.cleanupExpired();
  }

  async list(): Promise<WorkspaceTrashEntry[]> {
    const entries: WorkspaceTrashEntry[] = [];
    for (let record of await listTrashRecords(this.config)) {
      if (hidden(record) || record.mode === 'permanent') continue;
      if (record.phase === 'ready') {
        try {
          const directory = await this.entryDirectory(record);
          const stat = await lstatMaybe(path.join(directory, 'content'));
          if (!stat) record = { ...record, phase: 'missing', issue: 'The retained workspace files are no longer present in trash. Metadata cannot restore their contents.' };
          else if (!stat.isDirectory() || stat.isSymbolicLink()) record = { ...record, phase: 'recovery', issue: 'The retained workspace directory changed. It was not followed or modified.' };
        } catch { record = { ...record, phase: 'recovery', issue: 'Workspace trash is temporarily unavailable or unsafe. No files were changed.' }; }
      }
      entries.push(publicEntry(record));
    }
    return entries;
  }

  async deletionStatuses(): Promise<WorkspaceDeletionStatus[]> {
    return (await listTrashRecords(this.config)).filter(record => record.mode === 'permanent' && !hidden(record)).map(record => ({
      id: record.id, workspaceId: record.workspace.id, name: record.workspace.name, mode: 'permanent',
      state: record.issue || record.phase === 'recovery' ? 'error' : 'pending', updatedAt: record.updatedAt,
      ...(record.issue ? { issue: record.issue } : {}),
    }));
  }

  private async *pageRecords(): AsyncGenerator<WorkspaceTrashRecord> {
    await checkedDirectory(this.config.dataDir, this.config.stateDir);
    for await (const id of operationalRecordIds(this.config.stateDir, TRASH_RECORD_PREFIX, MAX_TRASH_ENTRIES, 'WORKSPACE_TRASH_LIMIT')) {
      const record = await readTrashRecord(this.config, id);
      if (record) yield record;
    }
  }

  /** Observation only. Cleanup/recovery continue using the full strict readers. */
  async listPage(input: OperationalPageInput = {}): Promise<WorkspaceTrashPage> {
    const query = operationalPageQuery(input);
    const visible = (record: WorkspaceTrashRecord) => !hidden(record) && record.mode === 'trash'
      && (!query.q || `${record.workspace.name}\n${record.workspace.id}`.toLocaleLowerCase().includes(query.q));
    const { ids, ...page } = await operationalIndexPage(this.pageRecords(), query,
      record => visible(record) ? { id: record.id, order: record.deletedAt } : null);
    const items: WorkspaceTrashEntry[] = [];
    for (const id of ids) {
      let record = await readTrashRecord(this.config, id);
      if (!record || !visible(record)) throw operationalListChanged();
      // Match list()'s ownership and native root checks on the requested page.
      // Merely viewing an entry never reconciles or retries its deletion.
      if (record.phase === 'ready') {
        try {
          const directory = await this.entryDirectory(record);
          const stat = await lstatMaybe(path.join(directory, 'content'));
          if (!stat) record = { ...record, phase: 'missing', issue: 'The retained workspace files are no longer present in trash. Metadata cannot restore their contents.' };
          else if (!stat.isDirectory() || stat.isSymbolicLink()) record = { ...record, phase: 'recovery', issue: 'The retained workspace directory changed. It was not followed or modified.' };
        } catch { record = { ...record, phase: 'recovery', issue: 'Workspace trash is temporarily unavailable or unsafe. No files were changed.' }; }
      }
      items.push(publicEntry(record));
    }
    return { ...page, items };
  }

  async deletionStatusPage(input: OperationalPageInput = {}): Promise<WorkspaceDeletionPage> {
    const query = operationalPageQuery(input);
    const visible = (record: WorkspaceTrashRecord) => record.mode === 'permanent' && !hidden(record)
      && (!query.q || `${record.workspace.name}\n${record.workspace.id}`.toLocaleLowerCase().includes(query.q));
    const { ids, ...page } = await operationalIndexPage(this.pageRecords(), query,
      record => visible(record) ? { id: record.id, order: record.deletedAt } : null);
    const items: WorkspaceDeletionStatus[] = [];
    for (const id of ids) {
      const record = await readTrashRecord(this.config, id);
      if (!record || !visible(record)) throw operationalListChanged();
      items.push({ id: record.id, workspaceId: record.workspace.id, name: record.workspace.name, mode: 'permanent',
        state: record.issue || record.phase === 'recovery' ? 'error' : 'pending', updatedAt: record.updatedAt,
        ...(record.issue ? { issue: record.issue } : {}) });
    }
    return { ...page, items };
  }

  async retryDeletion(id: string): Promise<Extract<WorkspaceDeleteResult, { mode: 'permanent' }>> {
    const initial = await readTrashRecord(this.config, id);
    if (!initial || initial.mode !== 'permanent' || ['restored', 'cancelled'].includes(initial.phase)) throw new HttpError(404, 'Permanent deletion status not found.', 'WORKSPACE_DELETION_NOT_FOUND');
    return this.guarded(initial.workspace.id, async () => {
      let record = await readTrashRecord(this.config, id);
      if (!record || record.mode !== 'permanent' || ['restored', 'cancelled'].includes(record.phase)) throw new HttpError(404, 'Permanent deletion status not found.', 'WORKSPACE_DELETION_NOT_FOUND');
      if (record.phase === 'purged') return { removed: true, mode: 'permanent', workspaceId: record.workspace.id };
      if (!await this.registry.archivedBy(record.workspace.id, record.id)) throw recovery('A newer workspace change superseded this permanent deletion. Its current files were preserved.');
      if (!['ready', 'missing', 'purging'].includes(record.phase)) record = await this.reconcileRecord(record);
      if (!['ready', 'missing', 'purging'].includes(record.phase)) throw recovery(record.issue ?? 'The original files could not be safely moved. They were retained.');
      record = await this.save(record, { phase: 'purging', issue: undefined });
      try { await this.purgeRecord(record); }
      catch (error) {
        const latest = await readTrashRecord(this.config, record.id).catch(() => null);
        if (latest && !hidden(latest)) await this.save(latest, { phase: 'purging', issue: 'Permanent deletion did not finish. Remaining workspace-owned data was retained for another safe retry.' }).catch(() => undefined);
        if (error instanceof HttpError) throw error;
        throw recovery('Permanent deletion did not finish. Remaining files were retained for another safe retry.');
      }
      return { removed: true, mode: 'permanent', workspaceId: record.workspace.id };
    });
  }

  private restoreMarker(record: WorkspaceTrashRecord): string { return path.join(record.workspace.path, `.codex-restore-${record.id}`); }

  private async verifyRestoreMarker(record: WorkspaceTrashRecord): Promise<void> {
    if (!record.restore) unsafe();
    await checkedDirectory(this.config.workspacesDir, record.workspace.path);
    if (await readText(this.restoreMarker(record), 128) !== record.restore.token) unsafe('The partially restored folder no longer has its ownership marker. Existing contents were retained.');
  }

  private async finishRestore(record: WorkspaceTrashRecord): Promise<WorkspaceTrashRecord> {
    const acknowledgment = await this.registry.restoredBy(record.workspace.id, record.id);
    if (acknowledgment === 'previous') {
      record = await this.save(record, { phase: 'restored', issue: undefined });
      await this.cleanEntry(record);
      return record;
    }
    const alreadyActive = acknowledgment === 'current' && await this.registry.active(record.workspace.id);
    if (!alreadyActive) await this.verifyRestoreMarker(record);
    const snapshot = await this.snapshot(record);
    if (!snapshot.content) unsafe();
    if (!alreadyActive) {
    const target = await captureTree(record.workspace.path);
    const markerName = path.basename(this.restoreMarker(record));
    if (JSON.stringify(target.filter(entry => entry.path !== markerName).map(entry => entry.path === ''
      ? { ...entry, mode: snapshot.content!.find(item => item.path === '')!.mode } : entry)) !== JSON.stringify(snapshot.content)) {
      throw recovery('The restored folder changed before registration completed. Its current files and the original trash copy were retained.');
    }
    }
    if (await this.registry.archivedBy(record.workspace.id, record.id)) await this.registry.restore(record);
    const root = await PinnedDirectory.open(record.workspace.path);
    try {
      await root.check();
      const marker = `${root.access}/${path.basename(this.restoreMarker(record))}`;
      if (await lstatMaybe(marker)) {
        if (await readText(marker, 128) !== record.restore!.token) unsafe();
        await root.check();
        await fs.unlink(marker);
        await root.handle.chmod(snapshot.content.find(item => item.path === '')!.mode);
      }
    } finally { await root.close(); }
    // Capture final active paths before removing the redundant source. A
    // failed checkpoint retains both copies and its recoverable journal.
    await this.checkpoint();
    record = await this.save(record, { phase: 'restored', issue: undefined });
    try { await this.cleanEntry(record); }
    catch {
      record = await this.save(record, { issue: 'The workspace was restored. Its redundant trash copy could not be cleared yet; cleanup will retry.' });
      console.error('Workspace restoration completed; redundant trash cleanup will retry.');
    }
    return record;
  }

  async restore(id: string): Promise<Workspace> {
    const original = await readTrashRecord(this.config, id);
    if (!original || hidden(original)) throw new HttpError(404, 'Workspace trash entry not found.', 'WORKSPACE_TRASH_NOT_FOUND');
    return this.guarded(original.workspace.id, async () => {
      let record = await readTrashRecord(this.config, id);
      if (!record || hidden(record)) throw new HttpError(404, 'Workspace trash entry not found.', 'WORKSPACE_TRASH_NOT_FOUND');
      if (record.mode === 'permanent') throw new HttpError(404, 'Workspace trash entry not found.', 'WORKSPACE_TRASH_NOT_FOUND');
      if (Date.parse(record.expiresAt) <= Date.now()) throw new HttpError(410, 'This workspace trash entry has reached its 30-day expiry and cannot be restored.', 'WORKSPACE_TRASH_EXPIRED');
      if (record.phase === 'missing' || record.reason === 'missing') throw new HttpError(409, 'The original workspace files are missing. This metadata record cannot restore their contents.', 'WORKSPACE_TRASH_MISSING');
      if (record.phase !== 'ready' || record.restore) throw recovery(record.issue ?? 'This workspace trash entry requires recovery before it can be restored.');
      if (record.workspace.worktree) throw new HttpError(409, 'Restore this managed checkout through its worktree manager.', 'WORKSPACE_MANAGED_WORKTREE');
      if (!await this.registry.archivedBy(record.workspace.id, record.id)) throw recovery('A newer workspace lifecycle change superseded this trash entry. No files were changed.');
      await this.assertIndependent(record.workspace, true);
      const directory = await this.entryDirectory(record);
      const snapshot = await this.snapshot(record);
      if (!snapshot.content || !await recoverTreeMetadata(path.join(directory, 'content'), snapshot.content)) {
        throw new HttpError(409, 'The retained workspace files are incomplete. Missing file contents cannot be restored.', 'WORKSPACE_TRASH_MISSING');
      }
      checkedWorkspacePath(this.config, record.workspace.path);
      await checkedDirectory(this.config.workspacesDir, path.dirname(record.workspace.path));
      if (await lstatMaybe(record.workspace.path)) conflict();
      const originalFileTrash = snapshot.fileTrash ? await this.fileTrashPath(record.workspace.id) : null;
      if (originalFileTrash) conflict();
      record = await this.save(record, { phase: 'restoring', restore: { token: randomUUID().replace(/-/g, ''), phase: 'copying' }, issue: undefined });
      let created = false;
      try {
        // mkdir is the no-clobber commit for the root, including a competing
        // empty directory; rename cannot provide this guarantee in Node.
        const parent = await PinnedDirectory.open(path.dirname(record.workspace.path));
        let destination: PinnedDirectory | undefined;
        let destinationIdentity: WorkspaceTrashRecord['contentIdentity'];
        try {
          await parent.check();
          const access = `${parent.access}/${path.basename(record.workspace.path)}`;
          try { await fs.mkdir(access, { mode: 0o700 }); }
          catch (error) { if (errno(error, 'EEXIST')) conflict(); throw error; }
          created = true;
          destination = await PinnedDirectory.open(record.workspace.path, access);
          await parent.check(); await destination.check();
          await fs.writeFile(`${destination.access}/${path.basename(this.restoreMarker(record))}`, record.restore!.token, { flag: 'wx', mode: 0o600 });
          await destination.check();
          destinationIdentity = identity(await destination.handle.stat());
        } finally { await destination?.close(); await parent.close(); }
        await copyTree(path.join(directory, 'content'), record.workspace.path, snapshot.content, destinationIdentity);
        if (snapshot.fileTrash) {
          const base = await PinnedDirectory.open(await workspaceStorage(this.config));
          const target = path.join(this.config.workspacesDir, '.trash', record.workspace.id);
          let trashParent: PinnedDirectory | undefined;
          let targetRoot: PinnedDirectory | undefined;
          let targetIdentity: WorkspaceTrashRecord['contentIdentity'];
          try {
            await base.check();
            await fs.mkdir(`${base.access}/.trash`, { mode: 0o700 }).catch(error => { if (!errno(error, 'EEXIST')) throw error; });
            trashParent = await PinnedDirectory.open(path.dirname(target), `${base.access}/.trash`);
            await base.check(); await trashParent.check();
            try { await fs.mkdir(`${trashParent.access}/${record.workspace.id}`, { mode: 0o700 }); }
            catch (error) { if (errno(error, 'EEXIST')) conflict(); throw error; }
            targetRoot = await PinnedDirectory.open(target, `${trashParent.access}/${record.workspace.id}`);
            await trashParent.check(); await targetRoot.check();
            targetIdentity = identity(await targetRoot.handle.stat());
          } finally { await targetRoot?.close(); await trashParent?.close(); await base.close(); }
          await copyTree(path.join(directory, 'file-trash'), target, snapshot.fileTrash, targetIdentity);
          const restoredTrash = await PinnedDirectory.open(target);
          try { await restoredTrash.handle.chmod(snapshot.fileTrash.find(entry => entry.path === '')!.mode); }
          finally { await restoredTrash.close(); }
        }
        record = await this.save(record, { restore: { ...record.restore!, phase: 'copied' } });
        await this.finishRestore(record);
        const workspace = await this.registry.registration(record.workspace.id);
        if (!workspace || !await this.registry.active(workspace.id)) throw recovery('A newer workspace change superseded this restoration. Refresh the workspace list.');
        return workspace;
      } catch (error) {
        if (!created) await this.save(record, { phase: 'ready', restore: undefined, issue: undefined }).catch(() => undefined);
        else {
          const current = await readTrashRecord(this.config, id);
          if (current && !hidden(current)) await this.save(current, { phase: 'recovery',
            issue: 'Restoration did not finish. The original trash copy and any copied files were retained; existing folders were not overwritten.' }).catch(() => undefined);
        }
        if (error instanceof HttpError) throw error;
        throw recovery('Restoration did not finish. The original trash copy and any copied files were retained.');
      }
    });
  }

  private async cleanEntry(record: WorkspaceTrashRecord): Promise<void> {
    let directory: string;
    try { directory = await this.entryDirectory(record); }
    catch (error) {
      if (errno(error, 'ENOENT') && !await lstatMaybe(path.join(await trashStorage(this.config), record.id))) return;
      throw error;
    }
    // Unknown siblings are not ours to delete, even in a valid entry container.
    const names = await fs.readdir(directory);
    if (names.some(name => !['owner.json', 'snapshot.json', 'content', 'file-trash'].includes(name))) throw recovery('Unexpected files remain beside this trash entry. They were preserved for inspection.');
    for (const name of ['content', 'file-trash']) await removeTree(path.join(directory, name));
    await this.entryDirectory(record);
    const pinned = await PinnedDirectory.open(directory);
    try {
      await pinned.check();
      // Unlink the metadata leaf itself. Never truncate a possible hard-link
      // target or open a replaced pipe/device during terminal cleanup.
      await fs.unlink(`${pinned.access}/snapshot.json`).catch(error => { if (!errno(error, 'ENOENT')) throw error; });
      await pinned.check();
    } finally { await pinned.close(); }
    // Keep only a tiny ownership tombstone. It makes interrupted
    // cleanup unambiguous without leaving any workspace or file-trash bytes.
  }

  private async requireCurrentDeletion(expected: WorkspaceTrashRecord): Promise<WorkspaceTrashRecord> {
    const [latest, registration] = await Promise.all([
      readTrashRecord(this.config, expected.id), this.registry.registration(expected.workspace.id),
    ]);
    // Reusing an ID/path does not inherit an earlier workspace's deletion
    // authority. Renames/account changes preserve this captured logical birth.
    if (!latest || latest.phase !== 'purging' || latest.workspace.id !== expected.workspace.id
      || latest.workspace.path !== expected.workspace.path || latest.workspace.createdAt !== expected.workspace.createdAt
      || !registration || registration.id !== expected.workspace.id || registration.path !== expected.workspace.path
      || registration.createdAt !== expected.workspace.createdAt || latest.mode !== expected.mode || latest.deletedAt !== expected.deletedAt
      || !await this.registry.archivedBy(expected.workspace.id, expected.id) || await this.registry.active(expected.workspace.id)) {
      throw new HttpError(409, 'A newer workspace change superseded this deletion. Its current owned data was preserved.', 'WORKSPACE_ARTIFACT_CLEANUP_CHANGED');
    }
    return latest;
  }

  private async purgeRecord(record: WorkspaceTrashRecord): Promise<WorkspaceTrashRecord> {
    // Only the UUID-owned trash directory is removed. The original workspace
    // location, all account secrets and all unrelated state are out of scope.
    const current = await this.registry.archivedBy(record.workspace.id, record.id);
    let release: void | (() => void) = undefined;
    try {
      if (current) {
        // Fresh processes may not yet have rebuilt in-memory recovery barriers.
        // The pure signed-state preflight is therefore required here too, before
        // any original/file-trash/snapshot bytes are removed.
        await this.options.assertWorkspaceDeletionAllowed?.(record.workspace.id);
        await this.requireCurrentDeletion(record);
        release = await this.options.quiesceWorkspace?.(record.workspace.id);
        await this.requireCurrentDeletion(record);
        if (record.artifactCleanup?.state === 'pending' && !this.options.cleanupWorkspaceArtifacts) {
          throw new HttpError(503, 'Workspace artifact cleanup is not available yet. Remaining owned data was retained for retry.', 'WORKSPACE_ARTIFACT_CLEANUP_UNAVAILABLE');
        }
        if (this.options.cleanupWorkspaceArtifacts && record.artifactCleanup?.state !== 'complete') {
          record = await this.save(record, { artifactCleanup: { version: 1, state: 'pending', updatedAt: new Date().toISOString() } });
        }
      } else if (record.artifactCleanup?.state === 'pending') {
        // A superseded journal can clean its own UUID container, but it cannot
        // claim snapshots/backups belonging to the workspace's newer lifetime.
        record = await this.save(record, { artifactCleanup: { version: 1, state: 'superseded', updatedAt: new Date().toISOString() } });
      }
      if (!record.workspace.worktree && current) {
        const directory = await this.entryDirectory(record);
        const source = await this.fileTrashPath(record.workspace.id);
        if (source && !await lstatMaybe(path.join(directory, 'file-trash'))) {
          const original = await fs.lstat(source);
          if (record.fileTrashIdentity && !sameIdentity(original, record.fileTrashIdentity)) throw recovery('The deleted-file trash directory changed before permanent cleanup. Its contents were preserved.');
          if (!record.fileTrashIdentity) record = await this.save(record, { fileTrashIdentity: identity(original) });
          await this.requireCurrentDeletion(record);
          await this.move(record, source, 'file-trash', record.fileTrashIdentity!);
        }
      }
      await this.cleanEntry(record);
      if (current && this.options.cleanupWorkspaceArtifacts && record.artifactCleanup?.state === 'pending') {
        const expected = record;
        const assertCurrent = async () => {
          const latest = await this.requireCurrentDeletion(expected);
          if (latest.artifactCleanup?.state !== 'pending') {
            throw new HttpError(409, 'A newer workspace change superseded this artifact cleanup. Its current owned data was preserved.', 'WORKSPACE_ARTIFACT_CLEANUP_CHANGED');
          }
        };
        await assertCurrent();
        try {
          await this.options.cleanupWorkspaceArtifacts(Object.freeze({ workspaceId: record.workspace.id, deletionId: record.id,
            mode: record.mode, deletedAt: record.deletedAt, assertCurrent }));
        } catch (error) {
          if (error instanceof HttpError && error.code === 'WORKSPACE_ARTIFACT_CLEANUP_CHANGED') throw error;
          // Leaf validation errors can say "no files changed" about that leaf.
          // Owned trash payloads are already cleared at this point; do not imply
          // that the entire deletion was rolled back or leak a raw storage error.
          throw new HttpError(409, 'Remaining saved snapshots or backups could not be cleared safely. Deletion has not finished and can be retried.', 'WORKSPACE_ARTIFACT_CLEANUP_FAILED');
        }
        await assertCurrent();
        record = await this.save(record, { artifactCleanup: { version: 1, state: 'complete', updatedAt: new Date().toISOString() } });
      }
      await this.checkpoint();
      return await this.save(record, { phase: 'purged', issue: undefined });
    } finally { if (typeof release === 'function') release(); }
  }

  async purge(id: string): Promise<WorkspaceTrashDeleteResult> {
    if (!TRASH_ID.test(id)) throw new HttpError(404, 'Workspace trash entry not found.', 'WORKSPACE_TRASH_NOT_FOUND');
    const initial = await readTrashRecord(this.config, id);
    if (!initial || initial.phase === 'restored' || initial.phase === 'cancelled') throw new HttpError(404, 'Workspace trash entry not found.', 'WORKSPACE_TRASH_NOT_FOUND');
    return this.guarded(initial.workspace.id, async () => {
      let record = await readTrashRecord(this.config, id);
      if (!record || record.phase === 'restored' || record.phase === 'cancelled') throw new HttpError(404, 'Workspace trash entry not found.', 'WORKSPACE_TRASH_NOT_FOUND');
      if (record.phase === 'purged') return { deleted: true, id };
      if (await this.registry.active(record.workspace.id)) throw recovery('This workspace is active again. Its active files cannot be deleted through an old trash entry.');
      record = await this.save(record, { phase: 'purging', issue: undefined });
      try { await this.purgeRecord(record); }
      catch (error) {
        // Keep progress written by purgeRecord (including a pending artifact
        // stage) instead of replacing it with this caller's older snapshot.
        const latest = await readTrashRecord(this.config, record.id).catch(() => null);
        if (latest && !hidden(latest)) await this.save(latest, { phase: 'purging', issue: 'Permanent deletion did not finish. Remaining workspace-owned data was retained for a safe retry.' }).catch(() => undefined);
        if (error instanceof HttpError) throw error;
        throw recovery('Permanent deletion did not finish. Remaining trash files were retained for a safe retry.');
      }
      return { deleted: true, id };
    });
  }

  startCleanup(): void {
    if (this.timer || this.closing) return;
    this.timer = setInterval(() => {
      void this.cleanupExpired().catch(() => console.error('Automatic workspace trash cleanup failed. Retained entries will be retried.'));
    }, 60 * 60 * 1000);
    this.timer.unref();
  }

  async cleanupExpired(now = Date.now()): Promise<void> {
    if (this.cleanup) return this.cleanup;
    if (this.closing) return;
    const operation = async () => {
      for (const candidate of await listTrashRecords(this.config)) {
        if (['purged', 'cancelled'].includes(candidate.phase)) continue;
        if (candidate.phase !== 'restored' && candidate.mode !== 'permanent' && Date.parse(candidate.expiresAt) > now) continue;
        try {
          await this.guarded(candidate.workspace.id, async () => {
            let record = await readTrashRecord(this.config, candidate.id);
            if (!record || ['purged', 'cancelled'].includes(record.phase)) return;
            if (record.phase === 'restored') { await this.cleanEntry(record); return; }
            if (record.phase !== 'ready' && record.phase !== 'missing' && record.phase !== 'purging') record = await this.reconcileRecord(record);
            if (record.phase !== 'ready' && record.phase !== 'missing' && record.phase !== 'purging') return;
            if (await this.registry.active(record.workspace.id)) return;
            await this.purgeRecord(await this.save(record, { phase: 'purging', issue: undefined }));
          });
        } catch (error) {
          if (error instanceof HttpError && error.code === 'WORKSPACE_BUSY') continue;
          const record = await readTrashRecord(this.config, candidate.id);
          if (record && !['purged', 'cancelled'].includes(record.phase)) await this.save(record, {
            issue: 'Automatic deletion could not finish safely. Remaining files were retained and cleanup will be retried.',
          });
        }
      }
      await expireFileTrash(this.config, this.store, await this.registry.registrations(), (id, work) => this.guarded(id, work), now)
        .catch(() => console.error('Automatic per-file trash cleanup is unavailable. Existing files were retained for retry.'));
    };
    const pending = operation();
    this.cleanup = pending;
    try { await pending; } finally { if (this.cleanup === pending) this.cleanup = undefined; }
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.cleanup;
    await Promise.allSettled([...this.operations]);
  }
}
