import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config';
import type { JsonStore } from '../store';
import type { Workspace } from '../../shared/types';
import type { WorkspaceTrashRecord } from './types';
import { checkedDirectory, checkedWorkspacePath, errno, MAX_RECORD_BYTES, MAX_TRASH_ENTRIES, normalized, readText, TRASH_DIRECTORY, unsafe } from './filesystem';
import { HttpError } from '../errors';
import { readFileTrashExpiryExclusions } from './retention';

export const TRASH_RECORD_PREFIX = 'workspace-trash-record-';
export const TRASH_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const WORKSPACE_ID = /^[a-zA-Z0-9_-]{1,128}$/;
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const capacityQueues = new Map<string, Promise<void>>();

/** Shared by service instances, so different workspace mutations cannot race
 * past the history bound and produce a registry its startup reader rejects. */
export async function withTrashRecordCapacity<T>(config: AppConfig, prefix: typeof TRASH_RECORD_PREFIX | 'file-trash-expiry-', create: () => Promise<T>): Promise<T> {
  const key = `${config.stateDir}\0${prefix}`;
  const before = capacityQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const tail = before.catch(() => undefined).then(() => barrier);
  capacityQueues.set(key, tail);
  await before.catch(() => undefined);
  try {
    await checkedDirectory(config.dataDir, config.stateDir);
    const count = (await fs.readdir(config.stateDir)).filter(name => name.startsWith(prefix) && name.endsWith('.json')).length;
    if (count >= MAX_TRASH_ENTRIES) throw new HttpError(413, 'Trash history has reached its safe record limit. Existing files were retained.', 'WORKSPACE_TRASH_LIMIT');
    return await create();
  } finally { release(); if (capacityQueues.get(key) === tail) capacityQueues.delete(key); }
}

export function trashRecordKey(id: string): string {
  if (!TRASH_ID.test(id)) throw new HttpError(404, 'Workspace trash entry not found.', 'WORKSPACE_TRASH_NOT_FOUND');
  return `${TRASH_RECORD_PREFIX}${id}`;
}

export function trashRestoreKey(workspaceId: string, trashId: string): string {
  if (!WORKSPACE_ID.test(workspaceId) || !TRASH_ID.test(trashId)) unsafe();
  return `workspace-untrash-${workspaceId}-${trashId.replace(/-/g, '')}`;
}

export function matchingTrashArchive(value: unknown, workspaceId: string, trashId?: string): value is { id: string; kind: 'workspace-trash'; trashId: string; archivedAt: string } {
  const marker = value as { id?: unknown; kind?: unknown; trashId?: unknown; archivedAt?: unknown } | null;
  return !!marker && marker.id === workspaceId && marker.kind === 'workspace-trash' && typeof marker.trashId === 'string'
    && TRASH_ID.test(marker.trashId) && (trashId === undefined || marker.trashId === trashId) && typeof marker.archivedAt === 'string';
}

export function matchingTrashRestore(value: unknown, workspaceId: string, trashId: string): boolean {
  const restored = value as { id?: unknown; trashId?: unknown; version?: unknown } | null;
  return !!restored && restored.version === 1 && restored.id === workspaceId && restored.trashId === trashId;
}

function matchingManagedMissingArchive(value: unknown, workspaceId: string, trashId: string): boolean {
  const marker = value as { id?: unknown; kind?: unknown; trashId?: unknown; generation?: unknown } | null;
  return !!marker && marker.id === workspaceId && marker.kind === 'managed-worktree' && marker.trashId === trashId
    && marker.generation === trashId.replace(/-/g, '');
}

export function checkedTrashWorkspace(config: AppConfig, value: unknown): Workspace {
  const record = value as Partial<Workspace> | null;
  if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.id !== 'string' || !WORKSPACE_ID.test(record.id)
    || typeof record.name !== 'string' || !record.name.trim() || record.name.length > 100 || /[\u0000-\u001f\u007f]/.test(record.name)
    || !normalized(record.path) || typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))
    || typeof record.updatedAt !== 'string' || !Number.isFinite(Date.parse(record.updatedAt))
    || record.githubAccountId !== undefined && (typeof record.githubAccountId !== 'string' || !WORKSPACE_ID.test(record.githubAccountId))) unsafe('The saved workspace identity is invalid. No files were moved.');
  checkedWorkspacePath(config, record.path);
  // Persist only known public fields. Credentials or arbitrary metadata are never copied.
  const workspace: Workspace = { id: record.id, name: record.name, path: record.path, createdAt: record.createdAt, updatedAt: record.updatedAt,
    ...(record.githubAccountId ? { githubAccountId: record.githubAccountId } : {}) };
  if (record.source !== undefined) {
    if (!record.source || record.source.kind !== 'github' || typeof record.source.fullName !== 'string'
      || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(record.source.fullName)) unsafe('The saved repository import provenance is invalid.');
    workspace.source = { kind: 'github', fullName: record.source.fullName };
  }
  if (record.worktree !== undefined) {
    const tree = record.worktree;
    if (!tree || typeof tree !== 'object' || tree.id !== record.id
      || [tree.id, tree.sourceWorkspaceId, tree.repositoryWorkspaceId].some(id => typeof id !== 'string' || !WORKSPACE_ID.test(id))
      || !normalized(tree.commonDirectory) || !normalized(tree.gitDirectory)) unsafe('The saved managed-worktree identity is invalid.');
    workspace.worktree = { id: tree.id, sourceWorkspaceId: tree.sourceWorkspaceId, repositoryWorkspaceId: tree.repositoryWorkspaceId,
      commonDirectory: tree.commonDirectory, gitDirectory: tree.gitDirectory };
  }
  return workspace;
}

export function checkedTrashRecord(config: AppConfig, value: unknown, expectedId?: string): WorkspaceTrashRecord {
  const record = value as Partial<WorkspaceTrashRecord> | null;
  const nativeIdentity = (value: unknown): boolean => {
    const identity = value as { dev?: unknown; ino?: unknown } | null;
    return !!identity && typeof identity.dev === 'number' && Number.isFinite(identity.dev) && typeof identity.ino === 'number' && Number.isFinite(identity.ino);
  };
  if (!record || typeof record !== 'object' || Array.isArray(record) || record.version !== 1
    || typeof record.id !== 'string' || !TRASH_ID.test(record.id) || expectedId !== undefined && record.id !== expectedId
    || typeof record.deletedAt !== 'string' || !Number.isFinite(Date.parse(record.deletedAt))
    || typeof record.expiresAt !== 'string' || Date.parse(record.expiresAt) !== Date.parse(record.deletedAt) + TRASH_RETENTION_MS
    || typeof record.updatedAt !== 'string' || !Number.isFinite(Date.parse(record.updatedAt))
    || !['deleted', 'missing'].includes(String(record.reason))
    || !['trash', 'permanent'].includes(String(record.mode))
    || !['preparing', 'ready', 'missing', 'restoring', 'restored', 'purging', 'purged', 'recovery', 'cancelled'].includes(String(record.phase))
    || record.contentIdentity !== undefined && !nativeIdentity(record.contentIdentity)
    || record.fileTrashIdentity !== undefined && !nativeIdentity(record.fileTrashIdentity)
    || record.restore !== undefined && (!record.restore || typeof record.restore.token !== 'string'
      || !/^[a-f0-9]{32}$/.test(record.restore.token) || !['copying', 'copied'].includes(record.restore.phase))
    || record.artifactCleanup !== undefined && (!record.artifactCleanup || typeof record.artifactCleanup !== 'object'
      || Array.isArray(record.artifactCleanup) || record.artifactCleanup.version !== 1
      || !['pending', 'complete', 'superseded'].includes(record.artifactCleanup.state)
      || typeof record.artifactCleanup.updatedAt !== 'string' || !Number.isFinite(Date.parse(record.artifactCleanup.updatedAt)))
    || record.issue !== undefined && (typeof record.issue !== 'string' || record.issue.length > 600)) unsafe('The saved workspace trash journal is invalid. Existing files were retained.');
  return { ...record, workspace: checkedTrashWorkspace(config, record.workspace) } as WorkspaceTrashRecord;
}

async function jsonFile(file: string, maxBytes = MAX_RECORD_BYTES): Promise<unknown | null> {
  let contents: string;
  try { contents = await readText(file, maxBytes); }
  catch (error) { if (errno(error, 'ENOENT')) return null; throw error; }
  try { return JSON.parse(contents); }
  catch { return unsafe('The saved workspace trash journal is not valid JSON.'); }
}

export async function readTrashRecord(config: AppConfig, id: string): Promise<WorkspaceTrashRecord | null> {
  const key = trashRecordKey(id);
  await checkedDirectory(config.dataDir, config.stateDir);
  const record = await jsonFile(path.join(config.stateDir, `${key}.json`));
  return record === null ? null : checkedTrashRecord(config, record, id);
}

export async function listTrashRecords(config: AppConfig): Promise<WorkspaceTrashRecord[]> {
  try { await fs.lstat(config.stateDir); }
  catch (error) { if (errno(error, 'ENOENT')) return []; throw error; }
  await checkedDirectory(config.dataDir, config.stateDir);
  const names = (await fs.readdir(config.stateDir)).filter(name => name.startsWith(TRASH_RECORD_PREFIX) && name.endsWith('.json'));
  if (names.length > MAX_TRASH_ENTRIES) throw new HttpError(413, 'The saved workspace trash exceeds its record limit.', 'WORKSPACE_TRASH_LIMIT');
  const records: WorkspaceTrashRecord[] = [];
  for (const name of names) {
    const record = await readTrashRecord(config, name.slice(TRASH_RECORD_PREFIX.length, -5));
    if (record) records.push(record);
  }
  return records.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt) || a.id.localeCompare(b.id));
}

export async function writeTrashRecord(config: AppConfig, store: JsonStore, record: WorkspaceTrashRecord, create = false): Promise<void> {
  const safe = checkedTrashRecord(config, record, record.id);
  const serialized = JSON.stringify(safe);
  if (Buffer.byteLength(serialized) > MAX_RECORD_BYTES) unsafe('The workspace trash journal exceeds its size limit.');
  await checkedDirectory(config.dataDir, config.stateDir);
  const current = await readTrashRecord(config, record.id);
  if (create ? current !== null : current === null) unsafe('The workspace trash journal changed before it could be saved.');
  await store.update<WorkspaceTrashRecord | null>(trashRecordKey(record.id), null, previous => {
    if (create) { if (previous !== null) unsafe('This trash identity is already in use. No files were overwritten.'); }
    else {
      const checked = checkedTrashRecord(config, previous, record.id);
      if (checked.workspace.id !== record.workspace.id || checked.workspace.path !== record.workspace.path || checked.deletedAt !== record.deletedAt) unsafe();
    }
    return safe;
  });
}

/** Read-only, called before native POSIX metadata restoration. No directory is created here. */
export async function readWorkspaceTrashMetadataExclusions(config: AppConfig): Promise<string[]> {
  const excluded = new Set<string>(await readFileTrashExpiryExclusions(config));
  for (const record of await listTrashRecords(config)) {
    if (['purging', 'purged', 'restored', 'cancelled'].includes(record.phase)) excluded.add(`${TRASH_DIRECTORY}/${record.id}`);
    const marker = await jsonFile(path.join(config.stateDir, `workspace-archived-${record.workspace.id}.json`), MAX_RECORD_BYTES);
    const managed = matchingManagedMissingArchive(marker, record.workspace.id, record.id);
    if (!matchingTrashArchive(marker, record.workspace.id, record.id) && !managed) continue;
    const generation = record.id.replace(/-/g, '');
    const acknowledgment = await jsonFile(path.join(config.stateDir, `${managed
      ? `workspace-restored-${record.workspace.id}-${generation}` : trashRestoreKey(record.workspace.id, record.id)}.json`), 4096);
    const restored = managed
      ? !!acknowledgment && typeof acknowledgment === 'object' && (acknowledgment as { version?: unknown }).version === 1
        && (acknowledgment as { id?: unknown }).id === record.workspace.id && (acknowledgment as { generation?: unknown }).generation === generation
      : matchingTrashRestore(acknowledgment, record.workspace.id, record.id);
    if (!restored) {
      excluded.add(path.relative(config.workspacesDir, record.workspace.path).split(path.sep).join('/'));
      if (record.fileTrashIdentity) excluded.add(`.trash/${record.workspace.id}`);
    }
  }
  return [...excluded].sort();
}
