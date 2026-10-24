import { lstat, opendir } from 'node:fs/promises';
import path from 'node:path';
import type { Workspace } from '../../shared/types';
import type { AppContext } from '../context';
import { HttpError } from '../errors';
import type { WorktreeRecord, WorkspaceWorktree } from './types';
import { checkedWorktreeRecord, readWorktreeRecord } from './records';
import { directoryUnder, metadataPath, missing, readMetadata, regularMetadata, unsafeWorktree, workspaceRoot } from './paths';

export interface RepositoryIdentity {
  root: string;
  gitDirectory: string;
  commonDirectory: string;
  repositoryWorkspace: Workspace;
}

/** Git writes refs and reflogs through their parent directories. Proving only
 * the top-level refs directory does not prevent a nested branch alias escape.
 * Enumerate existing entries, rather than probing every possible object shard.
 */
async function rejectMetadataAliases(root: string, relativeDirectories: string[]): Promise<void> {
  let entries = 0;
  const pending: string[] = [];
  for (const relative of relativeDirectories) {
    const target = path.join(root, relative);
    const stat = await lstat(target).catch(error => { if (missing(error)) return null; throw error; });
    if (!stat) continue;
    if (!stat.isDirectory() || stat.isSymbolicLink()) unsafeWorktree('Git reference and object metadata directories cannot be symbolic links.');
    pending.push(await directoryUnder(root, target));
  }
  while (pending.length) {
    const current = pending.pop()!;
    for await (const entry of await opendir(current)) {
      if (++entries > 20_000 || path.relative(root, current).split(path.sep).length > 64) throw new HttpError(413, 'The Git reference metadata exceeds its safe inspection limit.', 'GIT_METADATA_LIMIT');
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) unsafeWorktree('Git references and reflogs cannot point outside their repository through symbolic links.');
      if (entry.isDirectory()) pending.push(await directoryUnder(root, target));
      else if (!entry.isFile()) {
        const stat = await lstat(target);
        if (stat.isDirectory() && !stat.isSymbolicLink()) pending.push(await directoryUnder(root, target));
        else if (!stat.isFile() || stat.isSymbolicLink()) unsafeWorktree('Git metadata contains an unsupported file type.');
      }
    }
  }
}

async function objectDirectories(common: string): Promise<void> {
  const objects = path.join(common, 'objects');
  let count = 0;
  for await (const entry of await opendir(objects)) {
    if (++count > 1024) throw new HttpError(413, 'The Git object directory exceeds its safe inspection limit.', 'GIT_METADATA_LIMIT');
    if (entry.isSymbolicLink()) unsafeWorktree('Git object directories cannot point outside their repository.');
    if (entry.isDirectory()) await directoryUnder(common, path.join(objects, entry.name));
    else if (!entry.isFile()) {
      const stat = await lstat(path.join(objects, entry.name));
      if (stat.isDirectory() && !stat.isSymbolicLink()) await directoryUnder(common, path.join(objects, entry.name));
      else if (!stat.isFile() || stat.isSymbolicLink()) unsafeWorktree('Git object metadata contains an unsupported file type.');
    }
  }
}

async function commonMetadata(root: string): Promise<string> {
  const common = await directoryUnder(root, path.join(root, '.git'));
  await Promise.all([
    regularMetadata(path.join(common, 'HEAD')),
    regularMetadata(path.join(common, 'config')),
    regularMetadata(path.join(common, 'index'), true),
    regularMetadata(path.join(common, 'packed-refs'), true),
    regularMetadata(path.join(common, 'config.worktree'), true),
    directoryUnder(common, path.join(common, 'objects')),
    directoryUnder(common, path.join(common, 'refs')),
  ]);
  await rejectMetadataAliases(common, ['refs', 'logs', 'objects/pack', 'objects/info', 'reftable']);
  await objectDirectories(common);
  // A registered primary repository must own its common directory. Do not
  // silently admit a converted/separate-git-dir checkout or external objects.
  if (await lstat(path.join(common, 'commondir')).catch(error => { if (missing(error)) return null; throw error; })) unsafeWorktree('The source repository cannot redirect its Git common directory.');
  const info = path.join(common, 'objects', 'info');
  if (await lstat(info).catch(error => { if (missing(error)) return null; throw error; })) {
    await directoryUnder(common, info);
    for (const name of ['alternates', 'http-alternates']) {
      const file = path.join(info, name);
      if (await regularMetadata(file, true) && (await readMetadata(file)).trim()) unsafeWorktree('Repositories with external object stores cannot create or manage worktrees here.');
    }
  }
  return common;
}

export async function inspectPrimaryRepository(ctx: AppContext, workspace: Workspace): Promise<RepositoryIdentity> {
  if (workspace.worktree) unsafeWorktree('The managed worktree source must resolve to its registered primary repository.');
  const root = await workspaceRoot(ctx, workspace.path);
  const commonDirectory = await commonMetadata(root);
  return { root, gitDirectory: commonDirectory, commonDirectory, repositoryWorkspace: workspace };
}

/** Inspect the native forward link, common-dir link, and exact checkout backlink. */
export async function inspectOwnedWorktree(ctx: AppContext, input: WorktreeRecord): Promise<RepositoryIdentity> {
  const record = checkedWorktreeRecord(ctx, input, input.id);
  const repository = await ctx.workspaces.getRegistration(record.repositoryWorkspaceId, { includeArchived: true });
  if (repository.path !== record.repositoryPath || repository.id === record.workspaceId) unsafeWorktree('The registered source repository no longer matches this worktree.');
  const primary = await inspectPrimaryRepository(ctx, repository);
  if (primary.commonDirectory !== record.commonDirectory) unsafeWorktree();
  const root = await workspaceRoot(ctx, record.path);
  const gitFile = path.join(root, '.git');
  const gitDirectory = metadataPath(await readMetadata(gitFile), root, 'gitdir: ');
  const adminRoot = path.join(primary.commonDirectory, 'worktrees');
  if (path.dirname(gitDirectory) !== adminRoot || record.gitDirectory !== undefined && gitDirectory !== record.gitDirectory) unsafeWorktree('The worktree Git directory is outside its registered repository.');
  await directoryUnder(primary.commonDirectory, gitDirectory);
  const commonDirectory = metadataPath(await readMetadata(path.join(gitDirectory, 'commondir')), gitDirectory);
  if (commonDirectory !== primary.commonDirectory) unsafeWorktree('The worktree common directory no longer matches its source repository.');
  const backlink = metadataPath(await readMetadata(path.join(gitDirectory, 'gitdir')), gitDirectory);
  if (backlink !== gitFile) unsafeWorktree('The worktree administration directory belongs to another checkout.');
  await Promise.all([
    regularMetadata(path.join(gitDirectory, 'HEAD')),
    regularMetadata(path.join(gitDirectory, 'index'), true),
    regularMetadata(path.join(gitDirectory, 'config.worktree'), true),
    regularMetadata(path.join(gitDirectory, 'locked'), true),
  ]);
  await rejectMetadataAliases(gitDirectory, ['refs', 'logs']);
  return { root, gitDirectory, commonDirectory, repositoryWorkspace: repository };
}

export function worktreeMetadata(record: WorktreeRecord): WorkspaceWorktree {
  if (!record.gitDirectory) unsafeWorktree('The worktree has not finished creating its Git metadata.');
  return {
    id: record.id,
    sourceWorkspaceId: record.sourceWorkspaceId,
    repositoryWorkspaceId: record.repositoryWorkspaceId,
    gitDirectory: record.gitDirectory,
    commonDirectory: record.commonDirectory,
  };
}

export async function inspectWorkspaceRepository(ctx: AppContext, workspace: Workspace, required = true): Promise<RepositoryIdentity | null> {
  const root = await workspaceRoot(ctx, workspace.path);
  const metadata = await lstat(path.join(root, '.git')).catch(error => { if (missing(error)) return null; throw error; });
  if (!metadata) {
    if (workspace.worktree) unsafeWorktree('This managed checkout is missing its Git link. Its files were left unchanged.');
    if (required) throw new HttpError(409, 'Initialize this folder as a Git repository first.', 'NOT_A_REPOSITORY');
    return null;
  }
  if (metadata.isDirectory() && !metadata.isSymbolicLink() && !workspace.worktree) return inspectPrimaryRepository(ctx, workspace);
  if (!metadata.isFile() || metadata.isSymbolicLink() || !workspace.worktree) {
    throw new HttpError(409, 'Only this workspace’s own repository or a registered managed worktree can be used by Git.', 'EXTERNAL_GIT_DIRECTORY');
  }
  const record = await readWorktreeRecord(ctx, workspace.worktree.id);
  if (!record || record.workspaceId !== workspace.id || record.path !== workspace.path || record.phase === 'removed' || record.phase === 'creating') unsafeWorktree('This checkout does not have a completed managed worktree registration.');
  const expected = worktreeMetadata(record);
  for (const key of Object.keys(expected) as Array<keyof WorkspaceWorktree>) if (workspace.worktree[key] !== expected[key]) unsafeWorktree('The workspace and its worktree ownership records disagree.');
  return inspectOwnedWorktree(ctx, record);
}

/** Call after structural inspection; none of Git's selectors may redirect cwd. */
export function assertGitIdentity(identity: RepositoryIdentity, output: Buffer | string): void {
  const lines = String(output).replace(/\n$/, '').split('\n');
  if (lines.length !== 3 || lines[0] !== identity.root || lines[1] !== identity.gitDirectory || lines[2] !== identity.commonDirectory) {
    unsafeWorktree('Git resolved this checkout to a different repository or working directory. Its files were left unchanged.');
  }
}

export const GIT_IDENTITY_ARGS = ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir'];
