import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { AppContext } from '../context';
import { HttpError } from '../errors';
import type { WorktreeRecord } from './types';
import { directoryUnder, missing, normalizedPath, readMetadata, unsafeWorktree, WORKSPACE_ID, WORKTREE_ID } from './paths';

export const WORKTREE_RECORD_PREFIX = 'managed-worktree-';
export const MAX_WORKTREE_RECORDS = 10_000;

export function worktreeRecordKey(id: string): string {
  if (!WORKTREE_ID.test(id)) throw new HttpError(404, 'Managed worktree not found.', 'WORKTREE_NOT_FOUND');
  return `${WORKTREE_RECORD_PREFIX}${id}`;
}

export function checkedWorktreeRecord(ctx: AppContext, value: unknown, expectedId?: string): WorktreeRecord {
  const record = value as Partial<WorktreeRecord> | null;
  if (!record || typeof record !== 'object' || Array.isArray(record) || record.version !== 1
    || typeof record.id !== 'string' || !WORKTREE_ID.test(record.id) || expectedId !== undefined && record.id !== expectedId
    || typeof record.workspaceId !== 'string' || !WORKSPACE_ID.test(record.workspaceId)
    || typeof record.sourceWorkspaceId !== 'string' || !WORKSPACE_ID.test(record.sourceWorkspaceId)
    || typeof record.repositoryWorkspaceId !== 'string' || !WORKSPACE_ID.test(record.repositoryWorkspaceId)
    || typeof record.name !== 'string' || !record.name.trim() || record.name.length > 100 || /[\u0000-\u001f\u007f]/.test(record.name)
    || !normalizedPath(record.path) || record.path !== path.join(ctx.config.workspacesDir, record.id)
    || !normalizedPath(record.sourcePath) || !normalizedPath(record.repositoryPath)
    || record.commonDirectory !== path.join(record.repositoryPath, '.git')
    || record.gitDirectory !== undefined && (!normalizedPath(record.gitDirectory)
      || path.dirname(record.gitDirectory) !== path.join(record.commonDirectory, 'worktrees'))
    || typeof record.expectedHead !== 'string' || !/^[a-f0-9]{40,64}$/.test(record.expectedHead)
    || typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))
    || typeof record.updatedAt !== 'string' || !Number.isFinite(Date.parse(record.updatedAt))
    || !['creating', 'ready', 'archived', 'removing', 'artifact-cleanup', 'removed', 'recovery'].includes(String(record.phase))
    || typeof record.createdBranch !== 'boolean'
    || record.initialBranch !== undefined && (typeof record.initialBranch !== 'string' || !record.initialBranch || record.initialBranch.length > 255 || /[\u0000-\u001f\u007f]/.test(record.initialBranch))
    || record.githubAccountId !== undefined && (typeof record.githubAccountId !== 'string' || !WORKSPACE_ID.test(record.githubAccountId))
    || record.issue !== undefined && (typeof record.issue !== 'string' || record.issue.length > 600)) {
    unsafeWorktree('Saved worktree ownership is invalid. Existing files were left unchanged.');
  }
  if (record.removal !== undefined) {
    const proof = record.removal;
    if (!proof || typeof proof !== 'object' || Array.isArray(proof) || proof.version !== 1
      || typeof proof.deletionId !== 'string' || !WORKTREE_ID.test(proof.deletionId)
      || typeof proof.deletedAt !== 'string' || proof.deletedAt.length > 64 || !Number.isFinite(Date.parse(proof.deletedAt))
      || proof.nativeRemovedAt !== undefined && (typeof proof.nativeRemovedAt !== 'string' || proof.nativeRemovedAt.length > 64 || !Number.isFinite(Date.parse(proof.nativeRemovedAt)))
      || proof.archiveGeneration !== undefined && (typeof proof.archiveGeneration !== 'string' || !/^[a-f0-9]{32}$/.test(proof.archiveGeneration))
      || !['pending', 'complete'].includes(proof.artifactCleanup)
      || !record.gitDirectory || record.workspaceId !== record.id || record.workspaceId === record.repositoryWorkspaceId || record.workspaceId === record.sourceWorkspaceId
      || !['removing', 'artifact-cleanup', 'removed', 'recovery'].includes(record.phase!)
      || (record.phase === 'artifact-cleanup' || proof.artifactCleanup === 'complete') && (!proof.nativeRemovedAt || !proof.archiveGeneration)
      || record.phase === 'removed' && proof.artifactCleanup !== 'complete') {
      unsafeWorktree('Saved permanent worktree removal ownership is invalid. Current files and artifacts were retained.');
    }
  } else if (record.phase === 'artifact-cleanup') {
    unsafeWorktree('Saved artifact cleanup has no permanent worktree removal authority. Existing artifacts were retained.');
  }
  return record as WorktreeRecord;
}

export async function readWorktreeRecord(ctx: AppContext, id: string): Promise<WorktreeRecord | null> {
  const key = worktreeRecordKey(id);
  // Ordinary JSON is durable and inspectable. Never follow a replaced state-file symlink.
  let contents: string;
  try {
    await directoryUnder(ctx.config.dataDir, ctx.config.stateDir);
    contents = await readMetadata(path.join(ctx.config.stateDir, `${key}.json`), 32 * 1024);
  }
  catch (error) { if (missing(error)) return null; throw error; }
  try { return checkedWorktreeRecord(ctx, JSON.parse(contents), id); }
  catch (error) {
    if (error instanceof SyntaxError) unsafeWorktree('Saved worktree ownership is not valid JSON. Existing files were left unchanged.');
    throw error;
  }
}

export async function writeWorktreeRecord(ctx: AppContext, record: WorktreeRecord): Promise<void> {
  checkedWorktreeRecord(ctx, record, record.id);
  await directoryUnder(ctx.config.dataDir, ctx.config.stateDir);
  await ctx.store.write(worktreeRecordKey(record.id), record);
}

/** Removal transitions must not overwrite a newer archive/Open/removal lifetime. */
export async function writeWorktreeRemovalRecord(ctx: AppContext, expected: WorktreeRecord, next: WorktreeRecord): Promise<void> {
  checkedWorktreeRecord(ctx, next, expected.id);
  await directoryUnder(ctx.config.dataDir, ctx.config.stateDir);
  await ctx.store.update<WorktreeRecord | null>(worktreeRecordKey(expected.id), null, current => {
    if (!current || JSON.stringify(checkedWorktreeRecord(ctx, current, expected.id)) !== JSON.stringify(expected)) {
      throw new HttpError(409, 'A newer worktree change superseded this removal. Its current data and artifacts were retained.', 'WORKSPACE_ARTIFACT_CLEANUP_CHANGED');
    }
    return next;
  });
}

export async function listWorktreeRecords(ctx: AppContext): Promise<WorktreeRecord[]> {
  const entries = await readdir(ctx.config.stateDir, { withFileTypes: true }).catch(error => {
    if (missing(error)) return [];
    throw error;
  });
  const names = entries.map(entry => entry.name).filter(name => name.startsWith(WORKTREE_RECORD_PREFIX) && name.endsWith('.json'));
  if (names.length > MAX_WORKTREE_RECORDS) throw new HttpError(413, 'The managed worktree registry exceeds its record limit.', 'WORKTREE_LIMIT');
  const records: WorktreeRecord[] = [];
  for (let start = 0; start < names.length; start += 12) {
    const batch = await Promise.all(names.slice(start, start + 12).map(name => readWorktreeRecord(ctx, name.slice(WORKTREE_RECORD_PREFIX.length, -5))));
    for (const record of batch) if (record) records.push(record);
  }
  return records.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}
