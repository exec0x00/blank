import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import type { Workspace } from '../shared/types';
import type { AppContext } from './context';
import { HttpError } from './errors';
import { runGit, type GitOptions, type GitResult } from './git';
import type { CreatedWorktree, CreateWorktreeInput, ManagedWorktree, ManagedWorktreePage, WorktreeRecord } from './worktrees/types';
import { directoryUnder, missing, regularMetadata, unsafeWorktree, within, workspaceStorage } from './worktrees/paths';
import { listWorktreeRecords, MAX_WORKTREE_RECORDS, readWorktreeRecord, WORKTREE_RECORD_PREFIX, writeWorktreeRecord, writeWorktreeRemovalRecord } from './worktrees/records';
import { assertGitIdentity, GIT_IDENTITY_ARGS, inspectOwnedWorktree, inspectWorkspaceRepository, worktreeMetadata, type RepositoryIdentity } from './worktrees/validation';
import { acquireWorkspaceActivity, withWorkspaceRemoval } from './worktrees/activity';
import { operationalIndexPage, operationalListChanged, operationalPageQuery, operationalRecordIds, parseOperationalPageQuery, type OperationalPageInput } from './operational-pages';

export type { CreatedWorktree, CreateWorktreeInput, ManagedWorktree, WorkspaceWorktree } from './worktrees/types';

const MAX_REPOSITORY_WORKTREES = 200;
const repositoryQueues = new Map<string, Promise<void>>();
const activeCreations = new Set<string>();
const services = new WeakMap<AppContext, WorktreeService>();
const ARTIFACT_CLEANUP_ISSUE = 'The native checkout was removed. Saved snapshots or backups still need cleanup; retry Remove to finish.';
const REMOVAL_CONFIRMATION_ISSUE = 'The native checkout and owned artifacts were removed. Final metadata confirmation still needs to finish; retry Remove.';
const createSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  branch: z.string().min(1).max(255).optional(),
  createBranch: z.boolean().optional(),
  base: z.string().min(1).max(255).optional(),
}).strict();

interface NativeWorktree { path: string; head?: string; branch?: string; locked: boolean; prunable: boolean }
export interface WorktreePageInput extends OperationalPageInput { sourceWorkspaceId?: string }

function createInput(value: unknown): CreateWorktreeInput {
  const result = createSchema.safeParse(value);
  if (!result.success) throw new HttpError(400, 'Provide a worktree name, an existing branch, or a new branch and base ref. Paths and force options are not accepted.', 'INVALID_WORKTREE');
  const input = result.data;
  if (input.name && /[\u0000-\u001f\u007f]/.test(input.name)
    || input.branch && (input.branch.startsWith('-') || input.branch === 'HEAD' || /[\u0000-\u0020\u007f~^:?*\[\\]/.test(input.branch) || input.branch.includes('@{'))
    || input.base && (input.base.startsWith('-') || /[\u0000-\u0020\u007f:?*\[\\]/.test(input.base) || input.base.includes('..'))
    || input.createBranch === true && !input.branch
    || input.branch && input.createBranch !== true && input.base !== undefined) {
    throw new HttpError(400, 'Choose a valid branch and base. An existing branch already determines its checkout commit.', 'INVALID_WORKTREE');
  }
  return input;
}

function sameRegistration(workspace: Workspace, record: WorktreeRecord): boolean {
  const metadata = workspace.worktree;
  return workspace.id === record.workspaceId && workspace.path === record.path && metadata?.id === record.id
    && metadata.sourceWorkspaceId === record.sourceWorkspaceId && metadata.repositoryWorkspaceId === record.repositoryWorkspaceId
    && metadata.commonDirectory === record.commonDirectory && metadata.gitDirectory === record.gitDirectory;
}

function registration(record: WorktreeRecord): Workspace {
  return {
    id: record.workspaceId, name: record.name, path: record.path, createdAt: record.createdAt, updatedAt: record.updatedAt,
    ...(record.githubAccountId ? { githubAccountId: record.githubAccountId } : {}), worktree: worktreeMetadata(record),
  };
}

function parseNativeList(bytes: Buffer): NativeWorktree[] {
  let contents: string;
  try { contents = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new HttpError(409, 'A Git worktree path uses an unsupported encoding.', 'UNSAFE_WORKTREE'); }
  const entries: NativeWorktree[] = [];
  for (const block of contents.split('\0\0')) {
    if (!block) continue;
    const item: NativeWorktree = { path: '', locked: false, prunable: false };
    for (const field of block.split('\0')) {
      if (field.startsWith('worktree ')) item.path = field.slice(9);
      else if (field.startsWith('HEAD ')) item.head = field.slice(5);
      else if (field.startsWith('branch refs/heads/')) item.branch = field.slice(18);
      else if (field === 'locked' || field.startsWith('locked ')) item.locked = true;
      else if (field === 'prunable' || field.startsWith('prunable ')) item.prunable = true;
    }
    if (!item.path || item.head !== undefined && !/^[a-f0-9]{40,64}$/.test(item.head)) continue;
    entries.push(item);
  }
  return entries;
}

async function queued<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = repositoryQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const holding = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => holding);
  repositoryQueues.set(key, tail);
  await previous.catch(() => undefined);
  try { return await operation(); }
  finally {
    release();
    if (repositoryQueues.get(key) === tail) repositoryQueues.delete(key);
  }
}

/** Ordinary Git/filesystem operations on the hosting platform's native data volume. */
export class WorktreeService {
  private initializing?: Promise<void>;
  private startupError?: HttpError;
  private closing = false;
  private readonly controller = new AbortController();
  private readonly operations = new Set<Promise<unknown>>();

  constructor(private readonly ctx: AppContext) {}

  private git(cwd: string, args: string[], options: GitOptions = {}): Promise<GitResult> {
    return runGit(cwd, args, { ...options, signal: this.controller.signal });
  }

  private operation<T>(work: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new HttpError(503, 'The server is restarting. Try this worktree operation again after it returns.', 'WORKTREES_CLOSING'));
    const pending = work();
    this.operations.add(pending);
    void pending.finally(() => this.operations.delete(pending)).catch(() => undefined);
    return pending;
  }

  async close(): Promise<void> {
    this.closing = true;
    this.controller.abort(new Error('Server shutdown.'));
    await this.initializing;
    await Promise.allSettled([...this.operations]);
  }

  create(workspaceId: string, value: unknown): Promise<CreatedWorktree> { return this.operation(() => this.createWorktree(workspaceId, value)); }
  list(workspaceId: string): Promise<ManagedWorktree[]> { return this.operation(() => this.listWorktrees(workspaceId)); }
  listPage(workspaceId: string, input: WorktreePageInput = {}): Promise<ManagedWorktreePage> { return this.operation(() => this.listWorktreesPage(workspaceId, input)); }
  open(workspaceId: string, id: string): Promise<Workspace> { return this.operation(() => this.openWorktree(workspaceId, id)); }
  archive(workspaceId: string, id: string): Promise<ManagedWorktree> { return this.operation(() => this.archiveWorktree(workspaceId, id)); }
  remove(workspaceId: string, id: string): Promise<{ removed: true; workspaceId: string }> { return this.operation(() => this.removeWorktree(workspaceId, id)); }

  initialize(): Promise<void> {
    if (!this.initializing) this.initializing = this.recover().catch(() => {
      // A corrupt optional worktree journal must not prevent the rest of the
      // application from starting. Its next worktree request gets a visible error.
      this.startupError = new HttpError(409, 'Saved worktrees could not be recovered safely. Existing files were left unchanged; inspect the managed worktree records before continuing.', 'WORKTREE_RECOVERY');
    });
    return this.initializing;
  }

  private key(repositoryWorkspaceId: string): string { return `${this.ctx.config.workspacesDir}:${repositoryWorkspaceId}`; }

  private async recover(): Promise<void> {
    await this.ctx.workspaces.initialize();
    await workspaceStorage(this.ctx);
    for (const original of await listWorktreeRecords(this.ctx)) {
      await queued(this.key(original.repositoryWorkspaceId), async () => {
        const record = await readWorktreeRecord(this.ctx, original.id);
        if (!record) return;
        // No unfinished creation is reset or deleted at startup. Recovery is an
        // explicit Open action after the same native ownership checks as creation.
        if (record.phase === 'creating' && !activeCreations.has(record.id)) {
          await writeWorktreeRecord(this.ctx, { ...record, phase: 'recovery', updatedAt: new Date().toISOString(), issue: 'Creation was interrupted. Existing files were preserved and can be inspected before reopening.' });
          return;
        }
        if (record.removal) {
          // A completed removal is terminal. A later file at the same pathname
          // cannot revive its registration or authorize another artifact pass.
          if (record.phase === 'removed') return;
          try {
            const family = await this.removalFamily(record);
            await this.withRemovalFamily(family, async () => {
              await this.removalPreflight(family);
              await this.requireRemovalJournal(record);
              if (await this.nativePathsAbsent(record)) {
                const confirmed = await this.confirmNativeRemoval(record);
                await this.finishArtifactRemoval(confirmed);
              } else if (record.removal?.nativeRemovedAt) this.removalChanged();
              else await this.recoverNativeRemoval(record);
            });
          } catch {
            // Cleanup can be retried from this row. An unavailable/unsafe leaf
            // does not make unrelated worktrees unusable or authorize replaying
            // native Git removal after its checkout has already disappeared.
            await this.noteRemovalFailure(record);
          }
          return;
        }
        if (record.phase === 'removing' || record.phase === 'removed') {
          // Existing removal-only records predate artifact opt-in. Do not infer
          // authority to sweep saved data from an old metadata archive alone.
          await this.recoverNativeRemoval(record);
        }
      });
    }
  }

  private async ready(): Promise<void> {
    await this.initialize();
    if (this.startupError) throw this.startupError;
  }

  private async activeRegistration(id: string): Promise<Workspace | null> {
    try { return await this.ctx.workspaces.get(id); }
    catch (error) { if (error instanceof HttpError && error.code === 'WORKSPACE_NOT_FOUND') return null; throw error; }
  }

  private async retainedRegistration(id: string): Promise<Workspace | null> {
    try { return await this.ctx.workspaces.getRegistration(id, { includeArchived: true }); }
    catch (error) { if (error instanceof HttpError && error.code === 'WORKSPACE_NOT_FOUND') return null; throw error; }
  }

  private async recoverNativeRemoval(record: WorktreeRecord): Promise<void> {
    const root = await lstat(record.path).catch(error => { if (missing(error)) return null; throw error; });
    const admin = record.gitDirectory ? await lstat(record.gitDirectory).catch(error => { if (missing(error)) return null; throw error; }) : null;
    if (root && (!root.isDirectory() || root.isSymbolicLink()) || admin && (!admin.isDirectory() || admin.isSymbolicLink())) return;
    if (root) await directoryUnder(this.ctx.config.workspacesDir, record.path);
    if (admin && record.gitDirectory) await directoryUnder(this.ctx.config.workspacesDir, record.gitDirectory);
    const exists = (file: string) => lstat(file).then(() => true).catch(error => { if (missing(error)) return false; throw error; });
    if (root && await exists(path.join(record.path, '.git')) || admin && record.gitDirectory && await exists(path.join(record.gitDirectory, 'gitdir'))) return;
    const retained = await this.retainedRegistration(record.workspaceId);
    if (retained && !sameRegistration(retained, record)) return;
    if (record.removal && !retained) this.removalChanged();
    const release = await this.ctx.workspaces.quiesceWorkspace(record.workspaceId);
    try {
      if (JSON.stringify(await readWorktreeRecord(this.ctx, record.id)) !== JSON.stringify(record)) this.removalChanged();
      const afterQuiescence = await this.retainedRegistration(record.workspaceId);
      if (retained && (!afterQuiescence || !sameRegistration(afterQuiescence, record)
        || afterQuiescence.createdAt !== retained.createdAt)) this.removalChanged();
      const currentRoot = await lstat(record.path).catch(error => { if (missing(error)) return null; throw error; });
      const currentAdmin = record.gitDirectory ? await lstat(record.gitDirectory).catch(error => { if (missing(error)) return null; throw error; }) : null;
      if (!!currentRoot !== !!root || !!currentAdmin !== !!admin
        || currentRoot && root && (currentRoot.dev !== root.dev || currentRoot.ino !== root.ino || !currentRoot.isDirectory() || currentRoot.isSymbolicLink())
        || currentAdmin && admin && (currentAdmin.dev !== admin.dev || currentAdmin.ino !== admin.ino || !currentAdmin.isDirectory() || currentAdmin.isSymbolicLink())) this.removalChanged();
      if (currentRoot && await exists(path.join(record.path, '.git')) || currentAdmin && record.gitDirectory && await exists(path.join(record.gitDirectory, 'gitdir'))) this.removalChanged();
      if (retained && await this.activeRegistration(record.workspaceId)) await this.ctx.workspaces.remove(record.workspaceId);
      // Residual/native metadata directories cannot make this a live checkout.
      // Preserve their bytes and all artifacts until native absence is proven.
      const phase = root || admin ? 'recovery' as const : 'removed' as const;
      if (record.phase !== phase) {
        const next: WorktreeRecord = { ...record, phase, updatedAt: new Date().toISOString(),
          issue: phase === 'recovery' ? 'Removal finished its Git links, but residual directories or files remain. They and saved artifacts were preserved for inspection.' : undefined };
        if (record.removal) {
          if (phase === 'removed') this.removalChanged();
          const archive = await this.ctx.workspaces.getWorktreeArchive(record.workspaceId);
          if (record.removal.archiveGeneration && record.removal.archiveGeneration !== archive.generation) this.removalChanged();
          next.removal = { ...record.removal, archiveGeneration: archive.generation };
          await writeWorktreeRemovalRecord(this.ctx, record, next);
        } else await writeWorktreeRecord(this.ctx, next);
      }
    } finally { if (typeof release === 'function') release(); }
  }

  private async noteRemovalFailure(expected: WorktreeRecord): Promise<void> {
    if (!expected.removal) return;
    try {
      const current = await readWorktreeRecord(this.ctx, expected.id);
      if (!current?.removal || current.phase === 'removed' || current.removal.deletionId !== expected.removal.deletionId
        || current.removal.deletedAt !== expected.removal.deletedAt || current.workspaceId !== expected.workspaceId
        || current.createdAt !== expected.createdAt || current.path !== expected.path || current.gitDirectory !== expected.gitDirectory
        || current.commonDirectory !== expected.commonDirectory || current.repositoryWorkspaceId !== expected.repositoryWorkspaceId) return;
      await writeWorktreeRemovalRecord(this.ctx, current, { ...current, updatedAt: new Date().toISOString(),
        issue: current.removal.artifactCleanup === 'complete' ? REMOVAL_CONFIRMATION_ISSUE : current.removal.nativeRemovedAt ? ARTIFACT_CLEANUP_ISSUE
          : 'Removal did not finish. Remaining checkout files and saved artifacts were retained; inspect before retrying.' });
    } catch { /* Never overwrite a later lifecycle merely to attach a warning. */ }
  }

  private removalChanged(): never {
    throw new HttpError(409, 'This removal no longer owns the workspace’s current artifacts. They were retained; refresh and inspect the worktree.', 'WORKSPACE_ARTIFACT_CLEANUP_CHANGED');
  }

  private async requireRemovalJournal(expected: WorktreeRecord): Promise<WorktreeRecord> {
    const current = await readWorktreeRecord(this.ctx, expected.id);
    if (!current || JSON.stringify(current) !== JSON.stringify(expected)) this.removalChanged();
    return current;
  }

  private async nativePathsAbsent(record: WorktreeRecord): Promise<boolean> {
    if (!record.gitDirectory) return false;
    const base = await workspaceStorage(this.ctx);
    const absent = async (file: string): Promise<boolean> => {
      if (base === file || !within(base, file)) this.removalChanged();
      let current = base;
      const parts = path.relative(base, file).split(path.sep);
      for (let index = 0; index < parts.length; index++) {
        current = path.join(current, parts[index]);
        const entry = await lstat(current).catch(error => { if (missing(error)) return null; throw error; });
        if (!entry) return true;
        if (index < parts.length - 1 && (!entry.isDirectory() || entry.isSymbolicLink())) this.removalChanged();
      }
      return false;
    };
    // A missing leaf through a replaced/dangling parent alias is not proof that
    // the previously validated native checkout and administration are gone.
    return await absent(record.path) && await absent(record.gitDirectory);
  }

  private async confirmNativeRemoval(record: WorktreeRecord): Promise<WorktreeRecord> {
    await this.requireRemovalJournal(record);
    if (!record.removal || !await this.nativePathsAbsent(record)) this.removalChanged();
    if (record.removal.nativeRemovedAt) return record;
    const confirmed: WorktreeRecord = { ...record, phase: 'removing',
      removal: { ...record.removal, nativeRemovedAt: new Date().toISOString() }, updatedAt: new Date().toISOString() };
    await writeWorktreeRemovalRecord(this.ctx, record, confirmed);
    return confirmed;
  }

  private async removalFamily(record: WorktreeRecord, requestedSource?: string): Promise<string[]> {
    return [...new Set([
      record.repositoryWorkspaceId, record.sourceWorkspaceId, record.workspaceId,
      ...(requestedSource ? [requestedSource] : []),
      ...(await listWorktreeRecords(this.ctx)).filter(member => member.repositoryWorkspaceId === record.repositoryWorkspaceId
        && member.phase !== 'removed').map(member => member.workspaceId),
    ])].sort();
  }

  private withRemovalFamily<T>(ids: string[], operation: () => Promise<T>): Promise<T> {
    const fenced = (index: number): Promise<T> => index >= ids.length ? operation()
      : withWorkspaceRemoval(this.ctx.config.workspacesDir, ids[index], () => fenced(index + 1));
    return fenced(0);
  }

  private async removalPreflight(ids: string[]): Promise<void> {
    // Activity/recovery leases may not have been reconstructed during startup.
    // Read the durable signed authority while all family admissions are fenced.
    for (const id of ids) await this.ctx.workspaces.assertWorkspaceDeletionAllowed(id);
  }

  private async requireArtifactAuthority(expected: WorktreeRecord): Promise<void> {
    const current = await this.requireRemovalJournal(expected);
    const proof = current.removal;
    if (current.phase !== 'artifact-cleanup' || !proof?.nativeRemovedAt || !proof.archiveGeneration
      || !await this.nativePathsAbsent(current) || await this.activeRegistration(current.workspaceId)) this.removalChanged();
    const retained = await this.retainedRegistration(current.workspaceId);
    if (!retained || !sameRegistration(retained, current) || retained.createdAt !== current.createdAt) this.removalChanged();
    const archived = await this.ctx.workspaces.getWorktreeArchive(current.workspaceId).catch(() => this.removalChanged());
    if (archived.generation !== proof.archiveGeneration) this.removalChanged();
  }

  private async finishArtifactRemoval(record: WorktreeRecord): Promise<WorktreeRecord> {
    await this.requireRemovalJournal(record);
    if (!record.removal?.nativeRemovedAt || !await this.nativePathsAbsent(record)) this.removalChanged();
    const retained = await this.retainedRegistration(record.workspaceId);
    if (!retained || !sameRegistration(retained, record) || retained.createdAt !== record.createdAt) this.removalChanged();
    const release = await this.ctx.workspaces.quiesceWorkspace(record.workspaceId);
    try {
      await this.requireRemovalJournal(record);
      if (!await this.nativePathsAbsent(record)) this.removalChanged();
      const currentRegistration = await this.retainedRegistration(record.workspaceId);
      if (!currentRegistration || !sameRegistration(currentRegistration, record) || currentRegistration.createdAt !== record.createdAt) this.removalChanged();
      if (record.removal.archiveGeneration && await this.activeRegistration(record.workspaceId)) this.removalChanged();
      if (await this.activeRegistration(record.workspaceId)) await this.ctx.workspaces.remove(record.workspaceId);
      const archive = await this.ctx.workspaces.getWorktreeArchive(record.workspaceId).catch(() => this.removalChanged());
      if (record.removal.archiveGeneration && record.removal.archiveGeneration !== archive.generation) this.removalChanged();
      if (record.phase !== 'artifact-cleanup' || !record.removal.archiveGeneration) {
        const pending: WorktreeRecord = { ...record, phase: 'artifact-cleanup', issue: ARTIFACT_CLEANUP_ISSUE,
          removal: { ...record.removal, archiveGeneration: archive.generation }, updatedAt: new Date().toISOString() };
        await writeWorktreeRemovalRecord(this.ctx, record, pending);
        record = pending;
      }
      await this.requireArtifactAuthority(record);
      if (record.removal!.artifactCleanup === 'pending') {
        const expected = record;
        try {
          await this.ctx.workspaces.cleanupWorkspaceArtifacts(Object.freeze({
            workspaceId: record.workspaceId, deletionId: record.removal!.deletionId,
            mode: 'permanent' as const, deletedAt: record.removal!.deletedAt,
            assertCurrent: () => this.requireArtifactAuthority(expected),
          }));
        } catch (error) {
          if (error instanceof HttpError && ['WORKSPACE_ARTIFACT_CLEANUP_CHANGED', 'WORKSPACE_ARTIFACT_CLEANUP_UNAVAILABLE', 'FILE_REWIND_RECOVERY_REQUIRED'].includes(error.code ?? '')) throw error;
          throw new HttpError(409, 'The native checkout was removed, but saved-artifact cleanup did not finish. Remaining snapshots and backups were retained; retry Remove.', 'WORKTREE_ARTIFACT_CLEANUP_FAILED');
        }
        await this.requireArtifactAuthority(record);
        const complete: WorktreeRecord = { ...record, removal: { ...record.removal!, artifactCleanup: 'complete' }, updatedAt: new Date().toISOString() };
        await writeWorktreeRemovalRecord(this.ctx, record, complete);
        record = complete;
      }
      await this.requireArtifactAuthority(record);
      try { await this.ctx.workspaces.checkpointMetadataForRecovery(); }
      catch {
        throw new HttpError(409, REMOVAL_CONFIRMATION_ISSUE, 'WORKTREE_REMOVAL_CONFIRMATION_FAILED');
      }
      await this.requireArtifactAuthority(record);
      const complete: WorktreeRecord = { ...record, phase: 'removed', updatedAt: new Date().toISOString(), issue: undefined };
      await writeWorktreeRemovalRecord(this.ctx, record, complete);
      return complete;
    } finally { if (typeof release === 'function') release(); }
  }

  private async source(workspaceId: string, includeArchived = false): Promise<{ workspace: Workspace; identity: RepositoryIdentity }> {
    const workspace = await this.ctx.workspaces.getRegistration(workspaceId, { includeArchived });
    const identity = (await inspectWorkspaceRepository(this.ctx, workspace))!;
    assertGitIdentity(identity, (await this.git(identity.root, GIT_IDENTITY_ARGS)).stdout);
    return { workspace, identity };
  }

  private async owned(workspaceId: string, id: string, includeArchived = false): Promise<{ record: WorktreeRecord; source: RepositoryIdentity; identity: RepositoryIdentity }> {
    const { identity: source } = await this.source(workspaceId, includeArchived);
    const record = await readWorktreeRecord(this.ctx, id);
    if (!record || record.phase === 'removed' || record.repositoryWorkspaceId !== source.repositoryWorkspace.id || record.commonDirectory !== source.commonDirectory) {
      throw new HttpError(404, 'This managed worktree does not belong to the selected repository.', 'WORKTREE_NOT_FOUND');
    }
    if (record.phase === 'artifact-cleanup' || record.removal?.nativeRemovedAt) {
      throw new HttpError(409, ARTIFACT_CLEANUP_ISSUE, 'WORKTREE_REMOVAL_PENDING');
    }
    const identity = await inspectOwnedWorktree(this.ctx, record);
    assertGitIdentity(identity, (await this.git(identity.root, GIT_IDENTITY_ARGS)).stdout);
    const native = parseNativeList((await this.git(source.root, ['worktree', 'list', '--porcelain', '-z'], { outputLimit: 1024 * 1024 })).stdout);
    if (!native.some(entry => entry.path === record.path && !entry.prunable)) unsafeWorktree('Git no longer lists this checkout as a live worktree of the selected repository.');
    return { record, source, identity };
  }

  private async mutation<T>(ids: string[], operation: () => Promise<T>, exclusiveRemoval = false): Promise<T> {
    const operationId = randomUUID();
    const workspaceIds = [...new Set(ids)];
    const release: Array<() => void> = [];
    try {
      if (!exclusiveRemoval) for (const workspaceId of workspaceIds) release.push(acquireWorkspaceActivity(this.ctx.config.workspacesDir, workspaceId, 'worktree'));
      for (const workspaceId of workspaceIds) this.ctx.events.emit('workspace:manual-intent', { workspaceId, operationId, phase: 'start' });
      const result = await operation();
      for (const workspaceId of workspaceIds) this.ctx.events.emit('workspace:changed', { workspaceId });
      return result;
    } finally {
      for (const workspaceId of workspaceIds) this.ctx.events.emit('workspace:manual-intent', { workspaceId, operationId, phase: 'end' });
      for (const done of release) done();
    }
  }

  private async localFiles(identity: RepositoryIdentity): Promise<boolean> {
    // Removal cannot trust repository settings that deliberately ignore changed
    // stat fields, executable bits, differently cased files, or directory scans.
    const strict = ['-c', 'core.ignoreStat=false', '-c', 'core.trustctime=true', '-c', 'core.checkStat=default',
      '-c', 'core.fileMode=true', '-c', 'core.ignoreCase=false', '-c', 'core.untrackedCache=false'];
    const status = await this.git(identity.root, [...strict, 'status', '--porcelain=v1', '-z', '--untracked-files=normal', '--ignore-submodules=all']);
    if (status.stdout.length) return true;
    const ignored = await this.git(identity.root, [...strict, 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '--no-empty-directory', '-z']);
    return ignored.stdout.length > 0;
  }

  private async removable(identity: RepositoryIdentity): Promise<void> {
    if (await regularMetadata(path.join(identity.gitDirectory, 'locked'), true)) throw new HttpError(409, 'This worktree is locked in Git. Unlock it from the terminal before removing it, or archive it to keep all files.', 'WORKTREE_LOCKED');
    // Git status deliberately hides these index flags. Refuse them instead of
    // assuming that a clean status guarantees unchanged user files.
    const flags = await this.git(identity.root, ['ls-files', '--stage', '-v', '-z']);
    const entries = flags.stdout.toString('utf8').split('\0');
    if (entries.some(entry => entry && (entry[0] === 'S' || /^[a-z]$/.test(entry[0])))) {
      throw new HttpError(409, 'This checkout has skip-worktree or assume-unchanged files. Clear those index flags before removing it, or archive it to preserve the checkout.', 'WORKTREE_INDEX_FLAGS');
    }
    // Do not enter nested repositories whose configured filters have not been
    // admitted by this manager. Native Git can manage them from the terminal.
    if (entries.some(entry => /^. 160000 /.test(entry))) throw new HttpError(409, 'This checkout includes submodules. Archive it to preserve nested checkouts, or inspect removal with Git in the terminal.', 'WORKTREE_SUBMODULES');
    if (await this.localFiles(identity)) throw new HttpError(409, 'This worktree contains changed, untracked, or ignored files. Commit or move them before removing it, or archive it to preserve everything.', 'WORKTREE_DIRTY');
    const head = (await this.git(identity.root, ['rev-parse', '--verify', 'HEAD'])).stdout.toString('utf8').trim();
    await this.verifyContents(identity, head);
    const saved = await this.git(identity.root, ['for-each-ref', `--contains=${head}`, '--format=%(refname)', 'refs/heads', 'refs/tags', 'refs/remotes']);
    if (!saved.stdout.length) throw new HttpError(409, 'Save this worktree’s detached commit on a branch before removing the checkout. Archiving also preserves it.', 'WORKTREE_UNSAVED_COMMITS');
  }

  /** An ordinary status may accept cached size/mtime even after bytes changed.
   * A new HEAD index has no working-file stat cache, so status rehashes actual
   * contents while preserving Git's built-in EOL/text normalization. The live
   * index is never refreshed, replaced or used as this proof's starting point.
   */
  private async verifyContents(identity: RepositoryIdentity, head: string): Promise<void> {
    const staged = await this.git(identity.root, ['diff', '--cached', '--quiet', '--no-ext-diff', '--no-textconv',
      '--ignore-submodules=none', '--submodule=short', head, '--'], { allowFailure: true });
    if (staged.code === 1) throw new HttpError(409, 'This worktree contains staged changes. Commit or preserve them before removing it.', 'WORKTREE_DIRTY');
    if (staged.code !== 0) throw new HttpError(409, 'Git could not verify this checkout’s index. Existing files were preserved; inspect them or use Archive.', 'WORKTREE_CLEAN_CHECK');
    const runtime = this.ctx.config.runtimeDir;
    await mkdir(runtime, { recursive: true, mode: 0o700 });
    await directoryUnder(path.dirname(runtime), runtime);
    const directory = await mkdtemp(path.join(runtime, 'worktree-inspect-'));
    const owner = await lstat(directory);
    const index = path.join(directory, 'index');
    const settings = ['--work-tree=.', '-c', 'core.sparseCheckout=false', '-c', 'index.sparse=false',
      '-c', 'core.splitIndex=false', '-c', 'core.ignoreStat=false', '-c', 'core.trustctime=true',
      '-c', 'core.checkStat=default', '-c', 'core.fileMode=true', '-c', 'core.ignoreCase=false', '-c', 'core.untrackedCache=false'];
    try {
      await this.git(identity.root, [...settings, 'read-tree', '--no-sparse-checkout', head], { temporaryIndex: index });
      const result = await this.git(identity.root, [...settings, 'status', '--porcelain=v1', '-z', '--untracked-files=no', '--ignore-submodules=all'], {
        temporaryIndex: index, allowFailure: true,
      });
      const readFailure = /(?:^|\n)\s*(?:fatal|error):|\b(?:unable to|could not|cannot) (?:read|open|access|stat|lstat)\b|permission denied|input\/output error/i.test(result.stderr.toString('utf8'));
      if (result.code !== 0 || readFailure) throw new HttpError(409, 'Git could not verify this checkout’s current contents. Existing files were preserved; inspect them or use Archive.', 'WORKTREE_CLEAN_CHECK');
      if (result.stdout.length) throw new HttpError(409, 'Current file contents differ from the committed checkout, even though Git’s cached status looked clean. Commit or move the files, or archive the worktree to preserve them.', 'WORKTREE_DIRTY');
    } finally {
      const current = await lstat(directory).catch(error => { if (missing(error)) return null; throw error; });
      if (current?.isDirectory() && !current.isSymbolicLink() && current.dev === owner.dev && current.ino === owner.ino) {
        await directoryUnder(runtime, directory);
        for (const name of ['index', 'index.lock']) await unlink(path.join(directory, name)).catch(error => { if (!missing(error)) throw error; });
        // Never recursively remove unexpected files from even this private
        // scratch directory; external writes remain intact.
        await rmdir(directory).catch(error => { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOTEMPTY') && !missing(error)) throw error; });
      }
    }
  }

  private async createWorktree(workspaceId: string, value: unknown): Promise<CreatedWorktree> {
    const input = createInput(value);
    await this.ready();
    const before = await this.source(workspaceId);
    return queued(this.key(before.identity.repositoryWorkspace.id), async () => {
      const { workspace: source, identity } = await this.source(workspaceId);
      const records = await listWorktreeRecords(this.ctx);
      if (records.filter(record => record.repositoryWorkspaceId === identity.repositoryWorkspace.id && record.phase !== 'removed').length >= MAX_REPOSITORY_WORKTREES) {
        throw new HttpError(413, 'This repository already has 200 managed worktrees. Remove an unused clean checkout before creating another.', 'WORKTREE_LIMIT');
      }
      if (input.branch) {
        const checked = await this.git(identity.root, ['check-ref-format', '--branch', input.branch], { allowFailure: true });
        if (checked.code !== 0 || checked.stdout.toString('utf8').trim() !== input.branch) throw new HttpError(400, 'Choose a valid literal Git branch name.', 'INVALID_BRANCH');
      }
      const revision = input.branch && !input.createBranch ? `refs/heads/${input.branch}` : input.base ?? 'HEAD';
      const resolved = await this.git(identity.root, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`], { allowFailure: true });
      const head = resolved.stdout.toString('utf8').trim();
      if (resolved.code !== 0 || !/^[a-f0-9]{40,64}$/.test(head)) throw new HttpError(409, 'Choose an existing commit or branch. The source repository needs at least one commit.', 'WORKTREE_BASE_NOT_FOUND');
      const id = randomUUID();
      const now = new Date().toISOString();
      let record: WorktreeRecord = {
        version: 1, id, workspaceId: id, name: input.name ?? `${source.name} · ${input.branch ?? 'worktree'}`.slice(0, 100),
        path: path.join(this.ctx.config.workspacesDir, id), sourceWorkspaceId: source.id, sourcePath: source.path,
        repositoryWorkspaceId: identity.repositoryWorkspace.id, repositoryPath: identity.repositoryWorkspace.path,
        commonDirectory: identity.commonDirectory, createdAt: now, updatedAt: now, phase: 'creating', expectedHead: head,
        ...(input.branch ? { initialBranch: input.branch } : {}), createdBranch: input.createBranch === true,
        ...(source.githubAccountId ? { githubAccountId: source.githubAccountId } : {}),
      };
      activeCreations.add(id);
      try {
        await writeWorktreeRecord(this.ctx, record);
        await mkdir(record.path, { recursive: false, mode: 0o700 });
        return await this.mutation([workspaceId, id], async () => {
          try {
            const branchArgs = input.branch ? input.createBranch ? ['--no-track', '-b', input.branch] : [] : ['--detach'];
            await this.git(identity.root, ['-c', 'worktree.useRelativePaths=false', 'worktree', 'add', '--no-checkout', ...branchArgs, '--', record.path, input.branch && !input.createBranch ? input.branch : head], { timeout: 120_000 });
            const linked = await inspectOwnedWorktree(this.ctx, record);
            record = { ...record, gitDirectory: linked.gitDirectory, updatedAt: new Date().toISOString() };
            await writeWorktreeRecord(this.ctx, record);
            if ((await this.git(linked.root, ['rev-parse', '--verify', 'HEAD'])).stdout.toString('utf8').trim() !== head) {
              throw new HttpError(409, 'The selected branch moved while the worktree was being created. Its checkout was preserved for inspection.', 'WORKTREE_BASE_CHANGED');
            }
            // Only the destination config is written. Do not enable or change
            // extensions.worktreeConfig in the source repository.
            await this.git(linked.root, ['config', '--file', path.join(linked.gitDirectory, 'config.worktree'), 'core.worktree', linked.root]);
            // Filling an empty index, then checkout-index without --force,
            // preserves any file that appeared in this new path concurrently.
            const pin = ['--work-tree=.', '-c', 'core.sparseCheckout=false'];
            await this.git(linked.root, [...pin, 'read-tree', head]);
            await this.git(linked.root, [...pin, 'checkout-index', '--all'], { timeout: 120_000 });
            const checked = await inspectOwnedWorktree(this.ctx, record);
            assertGitIdentity(checked, (await this.git(checked.root, GIT_IDENTITY_ARGS)).stdout);
            if ((await this.git(checked.root, ['rev-parse', '--verify', 'HEAD'])).stdout.toString('utf8').trim() !== head) {
              throw new HttpError(409, 'The selected branch moved while the worktree was being created. Its checkout was preserved for inspection.', 'WORKTREE_BASE_CHANGED');
            }
            record = { ...record, phase: 'ready', updatedAt: new Date().toISOString() };
            // The completed journal is committed before the workspace record.
            // A registration failure can never publish a partly checked-out tree.
            await writeWorktreeRecord(this.ctx, record);
            const workspace = await this.publish(record);
            return { workspace, worktree: this.summary(record, { state: 'ready', head, ...(input.branch ? { branch: input.branch } : {}), dirty: false, locked: false }) };
          } catch (error) {
            await this.rollback(record).catch(() => undefined);
            if (error instanceof HttpError && /already (?:checked out|used by worktree)/i.test(error.message)) throw new HttpError(409, 'This branch is already checked out. Open its existing worktree or create a new branch.', 'WORKTREE_BRANCH_IN_USE');
            if (error instanceof HttpError && /a branch named .+ already exists/i.test(error.message)) throw new HttpError(409, 'This branch already exists. Choose the existing-branch option or a different new branch name.', 'WORKTREE_BRANCH_EXISTS');
            throw error;
          }
        });
      } finally { activeCreations.delete(id); }
    });
  }

  private async publish(record: WorktreeRecord): Promise<Workspace> {
    const existing = await this.activeRegistration(record.workspaceId);
    if (existing) {
      if (!sameRegistration(existing, record)) unsafeWorktree('Another workspace already owns this registration.');
      return existing;
    }
    try { return await this.ctx.workspaces.registerWorktree(registration(record)); }
    catch (error) {
      // An overlapping, explicitly requested Open may have published the same
      // complete registration. It must never trigger destructive rollback.
      const current = await this.activeRegistration(record.workspaceId);
      if (current && sameRegistration(current, record)) return current;
      throw error;
    }
  }

  private async rollback(record: WorktreeRecord): Promise<void> {
    if (this.closing) {
      await writeWorktreeRecord(this.ctx, { ...record, phase: 'recovery', updatedAt: new Date().toISOString(), issue: 'Creation was interrupted by a server restart. Existing files and any created branch were preserved.' });
      return;
    }
    let removed = false;
    // Once any workspace registration exists, preserve it and its checkout even
    // if the caller observed a storage error after the registration committed.
    if (!(await this.retainedRegistration(record.workspaceId))) {
      const root = await lstat(record.path).catch(error => { if (missing(error)) return null; throw error; });
      if (!root) removed = true;
      else if (root.isDirectory() && !root.isSymbolicLink()) {
        await directoryUnder(this.ctx.config.workspacesDir, record.path);
        if ((await readdir(record.path)).length === 0) { await rmdir(record.path); removed = true; }
        else {
          try {
            const identity = await inspectOwnedWorktree(this.ctx, record);
            assertGitIdentity(identity, (await this.git(identity.root, GIT_IDENTITY_ARGS)).stdout);
            const primary = (await inspectWorkspaceRepository(this.ctx, identity.repositoryWorkspace))!;
            assertGitIdentity(primary, (await this.git(primary.root, GIT_IDENTITY_ARGS)).stdout);
            const head = (await this.git(identity.root, ['rev-parse', '--verify', 'HEAD'])).stdout.toString('utf8').trim();
            if (head === record.expectedHead) {
              await this.removable(identity);
              await this.git(identity.repositoryWorkspace.path, ['worktree', 'remove', '--', record.path], { timeout: 120_000 });
              removed = true;
            }
          } catch { /* Dirty, incomplete, locked or changed checkout: keep it for recovery. */ }
        }
      }
    }
    if (removed) {
      // Git can fail after allocating administration data but before finishing
      // the checkout's .git file. Keep such a native orphan visible for repair.
      const repository = await this.ctx.workspaces.getRegistration(record.repositoryWorkspaceId, { includeArchived: true });
      const source = (await inspectWorkspaceRepository(this.ctx, repository))!;
      const native = parseNativeList((await this.git(source.root, ['worktree', 'list', '--porcelain', '-z'])).stdout);
      if (native.some(entry => entry.path === record.path)) removed = false;
    }
    await writeWorktreeRecord(this.ctx, {
      ...record, phase: removed ? 'removed' : 'recovery', updatedAt: new Date().toISOString(),
      ...(removed ? { issue: undefined } : { issue: 'Creation did not finish. Existing files and any created branch were preserved; open the checkout to inspect it.' }),
    });
  }

  private summary(record: WorktreeRecord, detail: Partial<ManagedWorktree>): ManagedWorktree {
    return {
      id: record.id, workspaceId: record.workspaceId, name: record.name, path: record.path,
      sourceWorkspaceId: record.sourceWorkspaceId, repositoryWorkspaceId: record.repositoryWorkspaceId,
      createdAt: record.createdAt, updatedAt: record.updatedAt, state: 'recovery', ...detail,
    };
  }

  private async listWorktrees(workspaceId: string): Promise<ManagedWorktree[]> {
    await this.ready();
    const { identity } = await this.source(workspaceId, true);
    return queued(this.key(identity.repositoryWorkspace.id), async () => {
      const source = (await this.source(workspaceId, true)).identity;
      const native = parseNativeList((await this.git(source.root, ['worktree', 'list', '--porcelain', '-z'], { outputLimit: 1024 * 1024 })).stdout);
      const records = (await listWorktreeRecords(this.ctx)).filter(record => record.repositoryWorkspaceId === source.repositoryWorkspace.id && record.phase !== 'removed');
      if (records.length > MAX_REPOSITORY_WORKTREES) throw new HttpError(413, 'This repository has too many managed worktree records.', 'WORKTREE_LIMIT');
      const output: ManagedWorktree[] = [];
      for (const record of records) {
        if (record.removal?.nativeRemovedAt) {
          output.push(this.summary(record, { state: 'recovery', removalPending: true,
            issue: record.issue ?? (record.removal.artifactCleanup === 'complete' ? REMOVAL_CONFIRMATION_ISSUE : ARTIFACT_CLEANUP_ISSUE) }));
          continue;
        }
        const item = native.find(entry => entry.path === record.path);
        try {
          if (record.commonDirectory !== source.commonDirectory) unsafeWorktree();
          const checked = await inspectOwnedWorktree(this.ctx, record);
          assertGitIdentity(checked, (await this.git(checked.root, GIT_IDENTITY_ARGS)).stdout);
          if (!item || item.prunable) unsafeWorktree();
          const active = await this.activeRegistration(record.workspaceId);
          const retained = active ?? await this.retainedRegistration(record.workspaceId);
          if (retained && !sameRegistration(retained, record)) unsafeWorktree();
          const state = record.phase === 'creating' || record.phase === 'removing' || record.phase === 'recovery' || !retained
            ? 'recovery' : active ? 'ready' : 'archived';
          output.push(this.summary(record, {
            state, name: retained?.name ?? record.name, ...(item.head ? { head: item.head } : {}), ...(item.branch ? { branch: item.branch } : {}),
            dirty: await this.localFiles(checked), locked: item.locked,
            ...(state === 'recovery' ? { issue: record.issue ?? 'This checkout needs an explicit Open to recover its workspace registration. Existing files were preserved.' } : {}),
          }));
        } catch (error) {
          output.push(this.summary(record, {
            state: missing(error) ? 'missing' : 'recovery',
            issue: missing(error) ? 'The checkout or its source Git metadata is missing. Existing registrations and files were preserved.' : 'The checkout could not be validated safely. Inspect its source repository and Git links before opening or removing it.',
          }));
        }
      }
      return output;
    });
  }

  private async listWorktreesPage(workspaceId: string, input: WorktreePageInput): Promise<ManagedWorktreePage> {
    const query = operationalPageQuery(input);
    if (input.sourceWorkspaceId !== undefined && (typeof input.sourceWorkspaceId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.sourceWorkspaceId))) {
      throw new HttpError(400, 'Choose a valid source workspace for this repository.', 'INVALID_OPERATIONAL_PAGE');
    }
    await this.ready();
    const { identity } = await this.source(workspaceId, true);
    return queued(this.key(identity.repositoryWorkspace.id), async () => {
      const source = (await this.source(workspaceId, true)).identity;
      const repository = source.repositoryWorkspace;
      const native = parseNativeList((await this.git(source.root, ['worktree', 'list', '--porcelain', '-z'], { outputLimit: 1024 * 1024 })).stdout);
      const nativeByPath = new Map(native.map(item => [item.path, item]));
      const family: Array<{ id: string; workspaceId: string }> = [];
      const matches = async (record: WorktreeRecord): Promise<boolean> => {
        if (record.repositoryWorkspaceId !== repository.id || record.phase === 'removed') return false;
        if (!query.q) return true;
        const retained = await this.retainedRegistration(record.workspaceId);
        return `${retained?.name ?? record.name}\n${record.path}\n${nativeByPath.get(record.path)?.branch ?? record.initialBranch ?? ''}`.toLocaleLowerCase().includes(query.q);
      };
      const readRecords = async function* (service: WorktreeService): AsyncGenerator<WorktreeRecord> {
        await directoryUnder(service.ctx.config.dataDir, service.ctx.config.stateDir);
        for await (const id of operationalRecordIds(service.ctx.config.stateDir, WORKTREE_RECORD_PREFIX, MAX_WORKTREE_RECORDS, 'WORKTREE_LIMIT')) {
          const record = await readWorktreeRecord(service.ctx, id);
          if (!record) continue;
          if (record.repositoryWorkspaceId === repository.id && record.phase !== 'removed') {
            if (family.length >= MAX_REPOSITORY_WORKTREES) throw new HttpError(413, 'This repository has too many managed worktree records.', 'WORKTREE_LIMIT');
            family.push({ id: record.id, workspaceId: record.workspaceId });
          }
          if (await matches(record)) yield record;
        }
      };
      const { ids, ...page } = await operationalIndexPage(readRecords(this), query,
        record => ({ id: record.id, order: record.createdAt }), false);
      const items: ManagedWorktree[] = [];
      for (const id of ids) {
        const record = await readWorktreeRecord(this.ctx, id);
        if (!record || !await matches(record)) throw operationalListChanged();
        if (record.removal?.nativeRemovedAt) {
          items.push(this.summary(record, { state: 'recovery', removalPending: true,
            issue: record.issue ?? (record.removal.artifactCleanup === 'complete' ? REMOVAL_CONFIRMATION_ISSUE : ARTIFACT_CLEANUP_ISSUE) }));
          continue;
        }
        const item = nativeByPath.get(record.path);
        try {
          if (record.commonDirectory !== source.commonDirectory) unsafeWorktree();
          const checked = await inspectOwnedWorktree(this.ctx, record);
          assertGitIdentity(checked, (await this.git(checked.root, GIT_IDENTITY_ARGS)).stdout);
          if (!item || item.prunable) unsafeWorktree();
          const active = await this.activeRegistration(record.workspaceId);
          const retained = active ?? await this.retainedRegistration(record.workspaceId);
          if (retained && !sameRegistration(retained, record)) unsafeWorktree();
          const state = record.phase === 'creating' || record.phase === 'removing' || record.phase === 'recovery' || !retained
            ? 'recovery' : active ? 'ready' : 'archived';
          items.push(this.summary(record, {
            state, name: retained?.name ?? record.name, ...(item.head ? { head: item.head } : {}), ...(item.branch ? { branch: item.branch } : {}),
            dirty: await this.localFiles(checked), locked: item.locked,
            ...(state === 'recovery' ? { issue: record.issue ?? 'This checkout needs an explicit Open to recover its workspace registration. Existing files were preserved.' } : {}),
          }));
        } catch (error) {
          items.push(this.summary(record, {
            state: missing(error) ? 'missing' : 'recovery',
            issue: missing(error) ? 'The checkout or its source Git metadata is missing. Existing registrations and files were preserved.' : 'The checkout could not be validated safely. Inspect its source repository and Git links before opening or removing it.',
          }));
        }
      }
      const sources: Workspace[] = [];
      const addSource = async (id: string | undefined): Promise<void> => {
        if (!id || sources.some(item => item.id === id) || sources.length >= 3) return;
        let workspace: Workspace;
        try { workspace = await this.ctx.workspaces.getAvailable(id); }
        catch (error) { if (error instanceof HttpError && ['WORKSPACE_NOT_FOUND', 'WORKSPACE_DIRECTORY_MISSING'].includes(error.code ?? '')) return; throw error; }
        if (id === repository.id) {
          if (workspace.worktree || workspace.path !== repository.path) return;
        } else {
          const member = family.find(item => item.workspaceId === id);
          if (!member) return;
          const record = await readWorktreeRecord(this.ctx, member.id);
          if (!record || record.phase !== 'ready' || record.commonDirectory !== source.commonDirectory || !sameRegistration(workspace, record)) return;
        }
        sources.push(workspace);
      };
      // A bounded exact set suffices when a destructive action excludes one
      // checkout. Never infer eligibility from the first workspace-list page.
      await addSource(repository.id);
      await addSource(input.sourceWorkspaceId ?? workspaceId);
      for (const member of family) {
        if (sources.length >= 2) break;
        await addSource(member.workspaceId);
      }
      return { ...page, items, repository, sources };
    });
  }

  private async openWorktree(workspaceId: string, id: string): Promise<Workspace> {
    await this.ready();
    const before = await this.source(workspaceId, true);
    return queued(this.key(before.identity.repositoryWorkspace.id), async () => {
      const candidate = await readWorktreeRecord(this.ctx, id);
      if (!candidate) throw new HttpError(404, 'Managed worktree not found.', 'WORKTREE_NOT_FOUND');
      const retained = await this.retainedRegistration(candidate.workspaceId);
      const active = await this.activeRegistration(candidate.workspaceId);
      // Capture the exact archive being restored before slow native validation.
      // A later archive invalidates this generation instead of reviving the ID.
      const archived = retained && !active ? await this.ctx.workspaces.getWorktreeArchive(candidate.workspaceId) : undefined;
      let { record } = await this.owned(workspaceId, id, true);
      if (activeCreations.has(id)) throw new HttpError(409, 'This worktree is still being created. Wait for creation to finish.', 'WORKTREE_BUSY');
      if (retained && !sameRegistration(retained, record)) unsafeWorktree();
      let workspace: Workspace;
      if (active) {
        const current = await this.activeRegistration(record.workspaceId);
        if (!current) throw new HttpError(409, 'This worktree was archived while it was being opened. Refresh before explicitly restoring it.', 'WORKSPACE_ARCHIVED');
        if (!sameRegistration(current, record)) unsafeWorktree('The workspace registration changed while the checkout was being opened.');
        workspace = current;
      }
      else if (retained && archived) workspace = await this.ctx.workspaces.restoreWorktree(retained, archived.generation);
      else {
        // An interrupted creation may not have persisted the admin path yet.
        const identity = await inspectOwnedWorktree(this.ctx, record);
        record = { ...record, gitDirectory: identity.gitDirectory };
        await writeWorktreeRecord(this.ctx, record);
        workspace = await this.publish(record);
      }
      const opened: WorktreeRecord = { ...record, phase: 'ready', name: workspace.name, updatedAt: new Date().toISOString(), issue: undefined };
      // A validated explicit Open can cancel an unsuccessful native removal;
      // confirmed native removal is rejected by owned() and cannot be revived.
      delete opened.removal;
      if (record.removal) await writeWorktreeRemovalRecord(this.ctx, record, opened);
      else await writeWorktreeRecord(this.ctx, opened);
      record = opened;
      const current = await this.activeRegistration(record.workspaceId);
      if (!current) throw new HttpError(409, 'A later workspace archive superseded this Open action. Refresh before restoring it.', 'WORKSPACE_ARCHIVED');
      if (!sameRegistration(current, record)) unsafeWorktree('The workspace registration changed while the checkout was being opened.');
      this.ctx.events.emit('workspace:changed', { workspaceId: workspace.id });
      return current;
    });
  }

  private async archiveWorktree(workspaceId: string, id: string): Promise<ManagedWorktree> {
    await this.ready();
    const before = await this.source(workspaceId);
    return queued(this.key(before.identity.repositoryWorkspace.id), async () => {
      const { record } = await this.owned(workspaceId, id);
      const retained = await this.retainedRegistration(record.workspaceId);
      if (retained && !sameRegistration(retained, record)) unsafeWorktree();
      const release = await this.ctx.workspaces.quiesceWorkspace(record.workspaceId);
      try {
        if (JSON.stringify(await readWorktreeRecord(this.ctx, record.id)) !== JSON.stringify(record)) this.removalChanged();
        const afterQuiescence = await this.retainedRegistration(record.workspaceId);
        if (retained && (!afterQuiescence || !sameRegistration(afterQuiescence, record)
          || afterQuiescence.createdAt !== retained.createdAt)) this.removalChanged();
        // Archive preserves checkout bytes, but a replaced native checkout must
        // not inherit the registration which was reviewed before session close.
        await inspectOwnedWorktree(this.ctx, record);
        if (await this.activeRegistration(record.workspaceId)) await this.ctx.workspaces.remove(record.workspaceId);
        const archived: WorktreeRecord = { ...record, phase: 'archived', updatedAt: new Date().toISOString(), issue: undefined };
        delete archived.removal;
        if (record.removal) await writeWorktreeRemovalRecord(this.ctx, record, archived);
        else await writeWorktreeRecord(this.ctx, archived);
        this.ctx.events.emit('workspace:changed', { workspaceId: record.workspaceId });
        return this.summary(archived, { state: 'archived' });
      } finally { if (typeof release === 'function') release(); }
    });
  }

  private async removeWorktree(workspaceId: string, id: string): Promise<{ removed: true; workspaceId: string }> {
    await this.ready();
    const before = await this.source(workspaceId);
    return queued(this.key(before.identity.repositoryWorkspace.id), async () => {
      const candidate = await readWorktreeRecord(this.ctx, id);
      if (candidate?.removal && candidate.phase !== 'removed'
        && candidate.repositoryWorkspaceId === before.identity.repositoryWorkspace.id && candidate.commonDirectory === before.identity.commonDirectory
        && (candidate.removal.nativeRemovedAt || await this.nativePathsAbsent(candidate))) {
        const family = await this.removalFamily(candidate, workspaceId);
        return this.withRemovalFamily(family, () => this.mutation([workspaceId, candidate.workspaceId], async () => {
          try {
            await this.removalPreflight(family);
            const currentSource = (await this.source(workspaceId, true)).identity;
            if (currentSource.commonDirectory !== candidate.commonDirectory || currentSource.repositoryWorkspace.id !== candidate.repositoryWorkspaceId) this.removalChanged();
            const confirmed = await this.confirmNativeRemoval(candidate);
            await this.finishArtifactRemoval(confirmed);
            return { removed: true as const, workspaceId: candidate.workspaceId };
          } catch (error) {
            await this.noteRemovalFailure(candidate);
            throw error;
          }
        }, true));
      }
      const { record } = await this.owned(workspaceId, id);
      if (record.workspaceId === workspaceId || await this.ctx.store.read<string | null>('active-workspace', null) === record.workspaceId) {
        throw new HttpError(409, 'Switch to another workspace before removing this checkout. You can archive the current workspace without deleting its files.', 'WORKTREE_ACTIVE');
      }
      const retained = await this.retainedRegistration(record.workspaceId);
      if (retained && !sameRegistration(retained, record)) unsafeWorktree();
      const artifacts = this.ctx.workspaces.hasWorkspaceArtifactCleanup();
      if (artifacts && (!retained || retained.createdAt !== record.createdAt)) {
        throw new HttpError(409, 'Recover this worktree’s registration before permanent removal so its saved artifacts can be identified safely.', 'WORKTREE_REGISTRATION_REQUIRED');
      }
      const familyIds = await this.removalFamily(record, workspaceId);
      // All registered checkouts share this common directory. Fence sibling and
      // primary admissions as well so a native shell there cannot move the
      // worktree or mutate its Git administration while removal is in flight.
      return this.withRemovalFamily(familyIds, () => this.mutation([workspaceId, record.workspaceId], async () => {
        await this.removalPreflight(familyIds);
        const currentSource = (await this.source(workspaceId, true)).identity;
        if (currentSource.commonDirectory !== record.commonDirectory || currentSource.repositoryWorkspace.id !== record.repositoryWorkspaceId) unsafeWorktree();
        const current = await inspectOwnedWorktree(this.ctx, record);
        assertGitIdentity(current, (await this.git(current.root, GIT_IDENTITY_ARGS)).stdout);
        await this.removable(current);
        // Family leases fence shared Git state, but only the checkout being
        // removed owns the browser sessions which must stop. A browser close
        // failure occurs before a new removal journal or native Git mutation.
        const release = await this.ctx.workspaces.quiesceWorkspace(record.workspaceId);
        try {
          const currentRecord = await readWorktreeRecord(this.ctx, record.id);
          if (!currentRecord || JSON.stringify(currentRecord) !== JSON.stringify(record)) this.removalChanged();
          const registeredAfterQuiescence = await this.retainedRegistration(record.workspaceId);
          if (retained && (!registeredAfterQuiescence || !sameRegistration(registeredAfterQuiescence, record)
            || registeredAfterQuiescence.createdAt !== retained.createdAt)) this.removalChanged();
          const createdAt = new Date().toISOString();
          const existingArchive = artifacts && !await this.activeRegistration(record.workspaceId)
            ? await this.ctx.workspaces.getWorktreeArchive(record.workspaceId) : undefined;
          const removing: WorktreeRecord = { ...record, phase: 'removing', updatedAt: createdAt,
            ...(artifacts ? { removal: record.removal ?? { version: 1, deletionId: randomUUID(), deletedAt: createdAt,
              ...(existingArchive ? { archiveGeneration: existingArchive.generation } : {}), artifactCleanup: 'pending' } } : {}) };
          if (record.removal && !artifacts) {
            throw new HttpError(503, 'Saved-artifact cleanup is unavailable. The checkout and remaining artifacts were retained for retry.', 'WORKSPACE_ARTIFACT_CLEANUP_UNAVAILABLE');
          }
          if (removing.removal) await writeWorktreeRemovalRecord(this.ctx, record, removing);
          else await writeWorktreeRecord(this.ctx, removing);
          try {
            // Git rechecks dirty/untracked files itself. Never --force and never
            // recursively delete a directory as a fallback for Git failure.
            const checked = await inspectOwnedWorktree(this.ctx, removing);
            assertGitIdentity(checked, (await this.git(checked.root, GIT_IDENTITY_ARGS)).stdout);
            await this.removable(checked);
            if (removing.removal) await this.requireRemovalJournal(removing);
            await this.git(currentSource.root, ['worktree', 'remove', '--', record.path], { timeout: 120_000 });
          } catch (error) {
            // A timed-out/cancelled command may already have removed files. Keep
            // removal intent for startup recovery instead of claiming it is ready.
            const interrupted: WorktreeRecord = { ...removing, updatedAt: new Date().toISOString(), issue: 'Removal was interrupted. Remaining files, Git metadata and saved artifacts were preserved for inspection.' };
            await (removing.removal ? writeWorktreeRemovalRecord(this.ctx, removing, interrupted) : writeWorktreeRecord(this.ctx, interrupted)).catch(() => undefined);
            throw error;
          }
          if (removing.removal) {
            try {
              const confirmed = await this.confirmNativeRemoval(removing);
              await this.finishArtifactRemoval(confirmed);
            } catch (error) {
              await this.noteRemovalFailure(removing);
              throw error;
            }
            return { removed: true as const, workspaceId: record.workspaceId };
          }
          await writeWorktreeRecord(this.ctx, { ...removing, phase: 'removed', updatedAt: new Date().toISOString(), issue: undefined });
          if (await this.activeRegistration(record.workspaceId)) await this.ctx.workspaces.remove(record.workspaceId);
          return { removed: true, workspaceId: record.workspaceId };
        } finally { if (typeof release === 'function') release(); }
      }, true));
    });
  }
}

export function getWorktreeService(ctx: AppContext): WorktreeService {
  let service = services.get(ctx);
  if (!service) { service = new WorktreeService(ctx); services.set(ctx, service); }
  return service;
}

export async function initializeWorktrees(ctx: AppContext): Promise<void> { await getWorktreeService(ctx).initialize(); }
export async function shutdownWorktrees(ctx: AppContext): Promise<void> { await services.get(ctx)?.close(); }

export function createWorktreeRouter(ctx: AppContext): Router {
  const router = Router();
  const service = getWorktreeService(ctx);
  const emptyBody = (body: unknown) => {
    if (body !== undefined && (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)) throw new HttpError(400, 'This operation takes no options. Forced removal is not supported.', 'INVALID_WORKTREE');
  };
  router.get('/workspaces/:id/worktrees', async (req, res) => { res.json(await service.list(req.params.id)); });
  router.get('/workspaces/:id/worktrees/page', async (req, res) => {
    const { sourceWorkspaceId, ...input } = req.query;
    if (sourceWorkspaceId !== undefined && typeof sourceWorkspaceId !== 'string') throw new HttpError(400, 'Choose a valid source workspace for this repository.', 'INVALID_OPERATIONAL_PAGE');
    res.json(await service.listPage(req.params.id, { ...parseOperationalPageQuery(input), ...(sourceWorkspaceId === undefined ? {} : { sourceWorkspaceId }) }));
  });
  router.post('/workspaces/:id/worktrees', async (req, res) => { res.status(201).json(await service.create(req.params.id, req.body ?? {})); });
  router.post('/workspaces/:id/worktrees/:worktreeId/open', async (req, res) => { emptyBody(req.body); res.json(await service.open(req.params.id, req.params.worktreeId)); });
  router.post('/workspaces/:id/worktrees/:worktreeId/archive', async (req, res) => { emptyBody(req.body); res.json(await service.archive(req.params.id, req.params.worktreeId)); });
  router.delete('/workspaces/:id/worktrees/:worktreeId', async (req, res) => { emptyBody(req.body); res.json(await service.remove(req.params.id, req.params.worktreeId)); });
  return router;
}
