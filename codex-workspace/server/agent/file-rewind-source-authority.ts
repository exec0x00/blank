import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { Workspace } from '../../shared/types';
import type { AppContext } from '../context';
import { HttpError } from '../errors';
import type { GitCheckpointRepository } from '../git-checkpoints/types';
import { isGitCheckpointRepository } from '../git-checkpoints/identity-contract';
import { listTrashRecords, matchingTrashArchive, matchingTrashRestore, trashRestoreKey } from '../workspace-trash/records';
import { readWorktreeRecord } from '../worktrees/records';

const refused = () => new HttpError(409, 'The original conversation cannot be repaired under the current deletion or workspace ownership records. Recovery copies were retained.', 'FILE_REWIND_SOURCE_REPAIR_REFUSED');

/** Used only by an exact signed pending rewind's missing-key storage repair.
 * It must not initialize a workspace or read the queued canonical thread key. */
export async function assertRewindSourceRepairAllowed(ctx: AppContext, input: {
  threadId: string; workspaceId: string; repository: GitCheckpointRepository;
}): Promise<void> {
  if (!/^thr_[a-f0-9]{32}$/u.test(input.threadId) || !/^[a-zA-Z0-9_-]{1,128}$/u.test(input.workspaceId) || !isGitCheckpointRepository(input.repository)) throw refused();
  try { await fs.lstat(path.join(ctx.config.stateDir, `thread-deleted-${input.threadId}.json`)); throw refused(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const workspace = await ctx.store.read<Workspace | null>(`workspace-record-${input.workspaceId}`, null);
  const generation = input.repository.generation;
  if (!workspace || workspace.id !== input.workspaceId || !generation || generation.workspaceId !== input.workspaceId
    || workspace.createdAt !== generation.workspaceCreatedAt || workspace.path !== input.repository.root
    || !path.isAbsolute(workspace.path) || path.resolve(workspace.path) !== workspace.path
    || !workspace.path.startsWith(`${path.resolve(ctx.config.workspacesDir)}${path.sep}`)
    || (workspace.worktree?.id ?? null) !== generation.worktreeId) throw refused();
  const primary = generation.repositoryWorkspaceId === workspace.id ? workspace
    : await ctx.store.read<Workspace | null>(`workspace-record-${generation.repositoryWorkspaceId}`, null);
  if (!primary || primary.id !== generation.repositoryWorkspaceId || primary.createdAt !== generation.repositoryWorkspaceCreatedAt
    || primary.worktree || path.join(primary.path, '.git') !== input.repository.commonDirectory) throw refused();
  const archivedRecord = await ctx.store.readWithVersion<unknown>(`workspace-archived-${workspace.id}`, null);
  const archived = archivedRecord.value;
  if (archivedRecord.version !== undefined) {
    if (matchingTrashArchive(archived, workspace.id)) {
      if (!matchingTrashRestore(await ctx.store.read<unknown>(trashRestoreKey(workspace.id, archived.trashId), null), workspace.id, archived.trashId)) throw refused();
    } else {
      const marker = archived as { id?: unknown; kind?: unknown; generation?: unknown };
      if (!marker || marker.id !== workspace.id || marker.kind !== 'managed-worktree' || typeof marker.generation !== 'string' || !/^[a-f0-9]{32}$/u.test(marker.generation)) throw refused();
      const restored = await ctx.store.read<{ version?: unknown; id?: unknown; generation?: unknown } | null>(`workspace-restored-${workspace.id}-${marker.generation}`, null);
      if (!restored || restored.version !== 1 || restored.id !== workspace.id || restored.generation !== marker.generation) throw refused();
    }
  }
  for (const deletion of await listTrashRecords(ctx.config)) {
    if (deletion.workspace.id !== workspace.id || deletion.workspace.createdAt !== workspace.createdAt || deletion.workspace.path !== workspace.path) continue;
    if (deletion.phase === 'purging' || deletion.phase === 'purged'
      || deletion.artifactCleanup?.state === 'pending' || deletion.artifactCleanup?.state === 'complete'
      || !['restored', 'cancelled'].includes(deletion.phase)) throw refused();
  }
  if (workspace.worktree) {
    const worktree = await readWorktreeRecord(ctx, workspace.worktree.id);
    if (!worktree || worktree.workspaceId !== workspace.id || worktree.phase !== 'ready' || worktree.path !== workspace.path
      || worktree.gitDirectory !== input.repository.gitDirectory || worktree.commonDirectory !== input.repository.commonDirectory
      || worktree.repositoryWorkspaceId !== generation.repositoryWorkspaceId
      || workspace.worktree.gitDirectory !== worktree.gitDirectory || workspace.worktree.commonDirectory !== worktree.commonDirectory
      || workspace.worktree.repositoryWorkspaceId !== worktree.repositoryWorkspaceId || workspace.worktree.sourceWorkspaceId !== worktree.sourceWorkspaceId) throw refused();
  }
}
