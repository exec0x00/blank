import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config';
import type { JsonStore } from '../store';
import type { Workspace } from '../../shared/types';
import { HttpError } from '../errors';
import { checkedDirectory, errno, identity, lstatMaybe, MAX_TRASH_ENTRIES, PinnedDirectory, readText, removeTree, unsafe, workspaceStorage } from './filesystem';
import { TRASH_ID, TRASH_RETENTION_MS, withTrashRecordCapacity, WORKSPACE_ID } from './records';

const PREFIX = 'file-trash-expiry-';
export const fileTrashIssueKey = (workspaceId: string) => `workspace-trash-cleanup-issue-${workspaceId}`;
interface ExpiryRecord { version: 1; id: string; workspaceId: string; deletedAt: string; phase: 'purging' | 'purged'; issue?: string }

function checked(value: unknown, expectedId?: string): ExpiryRecord {
  const record = value as Partial<ExpiryRecord> | null;
  if (!record || record.version !== 1 || typeof record.id !== 'string' || !TRASH_ID.test(record.id)
    || expectedId !== undefined && record.id !== expectedId || typeof record.workspaceId !== 'string' || !WORKSPACE_ID.test(record.workspaceId)
    || typeof record.deletedAt !== 'string' || !Number.isFinite(Date.parse(record.deletedAt)) || !['purging', 'purged'].includes(String(record.phase))
    || record.issue !== undefined && (typeof record.issue !== 'string' || record.issue.length > 600)) unsafe('The per-file trash expiry journal is invalid.');
  return record as ExpiryRecord;
}

async function records(config: AppConfig): Promise<ExpiryRecord[]> {
  if (!await lstatMaybe(config.stateDir)) return [];
  await checkedDirectory(config.dataDir, config.stateDir);
  const names = (await fs.readdir(config.stateDir)).filter(name => name.startsWith(PREFIX) && name.endsWith('.json'));
  if (names.length > MAX_TRASH_ENTRIES) throw new HttpError(413, 'Per-file expiry journals exceed their record limit.', 'WORKSPACE_TRASH_LIMIT');
  const result: ExpiryRecord[] = [];
  for (const name of names) {
    let value: unknown;
    try { value = JSON.parse(await readText(path.join(config.stateDir, name), 4096)); }
    catch (error) { if (errno(error, 'ENOENT')) continue; throw error; }
    result.push(checked(value, name.slice(PREFIX.length, -5)));
  }
  return result;
}

/** The metadata restorer consults intent, including deletion interrupted before completion. */
export async function readFileTrashExpiryExclusions(config: AppConfig): Promise<string[]> {
  return (await records(config)).map(record => `.trash/${record.workspaceId}/${record.id}`);
}

async function save(config: AppConfig, store: JsonStore, record: ExpiryRecord): Promise<void> {
  checked(record, record.id);
  await checkedDirectory(config.dataDir, config.stateDir);
  const file = path.join(config.stateDir, `${PREFIX}${record.id}.json`);
  if (await lstatMaybe(file)) checked(JSON.parse(await readText(file, 4096)), record.id);
  await store.update<ExpiryRecord | null>(`${PREFIX}${record.id}`, null, previous => {
    if (previous) {
      const old = checked(previous, record.id);
      if (old.workspaceId !== record.workspaceId || old.deletedAt !== record.deletedAt) unsafe();
    }
    return record;
  });
}

async function purge(config: AppConfig, store: JsonStore, record: ExpiryRecord): Promise<void> {
  const root = path.join(await workspaceStorage(config), '.trash');
  const parentPath = path.join(root, record.workspaceId);
  if (!await lstatMaybe(parentPath)) { await save(config, store, { ...record, phase: 'purged', issue: undefined }); return; }
  await checkedDirectory(config.workspacesDir, parentPath);
  const target = path.join(parentPath, record.id);
  if (!await lstatMaybe(target)) { await save(config, store, { ...record, phase: 'purged', issue: undefined }); return; }
  await checkedDirectory(parentPath, target);
  const parent = await PinnedDirectory.open(parentPath);
  const entry = await PinnedDirectory.open(target, `${parent.access}/${record.id}`);
  try {
    await parent.check(); await entry.check();
    if ((await fs.readdir(entry.access)).some(name => !['metadata.json', 'content'].includes(name))) unsafe('Unexpected files remain in the expired trash entry. They were preserved.');
    const metadataPath = `${entry.access}/metadata.json`;
    if (await lstatMaybe(metadataPath)) {
      const metadata = JSON.parse(await readText(metadataPath, 32 * 1024)) as { id?: unknown; deletedAt?: unknown };
      if (metadata.id !== record.id || metadata.deletedAt !== record.deletedAt) unsafe('The expired file trash ownership changed. Its contents were preserved.');
    }
    const content = await lstatMaybe(`${entry.access}/content`);
    if (content?.isDirectory() && !content.isSymbolicLink()) await removeTree(path.join(target, 'content'), identity(content));
    else if (content) { await entry.check(); await fs.unlink(`${entry.access}/content`); }
    // Content goes first; the independent journal survives either unlink.
    await entry.check();
    await fs.unlink(metadataPath).catch(error => { if (!errno(error, 'ENOENT')) throw error; });
    await parent.check(); await entry.check();
    await fs.rmdir(`${parent.access}/${record.id}`);
    await save(config, store, { ...record, phase: 'purged', issue: undefined });
  } finally { await entry.close(); await parent.close(); }
}

/** Existing per-file trash uses its original deletedAt; migration never resets retention. */
export async function expireFileTrash(config: AppConfig, store: JsonStore, workspaces: Workspace[],
  guarded: <T>(id: string, work: () => Promise<T>) => Promise<T>, now: number): Promise<void> {
  const known = await records(config);
  const base = await workspaceStorage(config);
  const root = path.join(base, '.trash');
  if (!await lstatMaybe(root)) return;
  await checkedDirectory(base, root);
  for (const workspace of workspaces) {
    if (!WORKSPACE_ID.test(workspace.id)) continue;
    let issue: string | undefined;
    const report = async () => {
      issue = 'Some expired file trash could not be deleted safely. Those files were retained and cleanup will retry.';
      await store.write(fileTrashIssueKey(workspace.id), { workspaceId: workspace.id, issue, updatedAt: new Date().toISOString() });
    };
    try {
      await guarded(workspace.id, async () => {
        const directory = path.join(root, workspace.id);
        const pending = known.filter(record => record.workspaceId === workspace.id && record.phase === 'purging');
        for (const record of pending) {
          try { await purge(config, store, record); }
          catch { await save(config, store, { ...record, issue: 'Automatic deletion was interrupted. Remaining files were retained for retry.' }); await report(); }
        }
        if (!await lstatMaybe(directory)) return;
        await checkedDirectory(root, directory);
        const names = await fs.readdir(directory);
        if (names.length > MAX_TRASH_ENTRIES) throw new HttpError(413, 'Per-file trash exceeds its cleanup entry limit.', 'WORKSPACE_TRASH_LIMIT');
        for (const name of names) {
          if (!TRASH_ID.test(name) || known.some(record => record.id === name)) continue;
          try {
            const entry = path.join(directory, name);
            await checkedDirectory(directory, entry);
            const metadata = JSON.parse(await readText(path.join(entry, 'metadata.json'), 32 * 1024)) as { id?: unknown; path?: unknown; kind?: unknown; deletedAt?: unknown };
            if (!metadata || metadata.id !== name || !['file', 'directory'].includes(String(metadata.kind))
              || typeof metadata.path !== 'string' || !metadata.path || metadata.path.length > 4096
              || path.posix.isAbsolute(metadata.path) || metadata.path.includes('\\') || metadata.path.split('/').includes('..')
              || typeof metadata.deletedAt !== 'string' || !Number.isFinite(Date.parse(metadata.deletedAt))) continue;
            if (Date.parse(metadata.deletedAt) + TRASH_RETENTION_MS > now) continue;
            if (known.length >= MAX_TRASH_ENTRIES) throw new HttpError(413, 'Per-file expiry history has reached its safe record limit. This entry was retained.', 'WORKSPACE_TRASH_LIMIT');
            const intent: ExpiryRecord = { version: 1, id: name, workspaceId: workspace.id, deletedAt: metadata.deletedAt, phase: 'purging' };
            await withTrashRecordCapacity(config, PREFIX, () => save(config, store, intent));
            known.push(intent);
            try { await purge(config, store, intent); }
            catch { await save(config, store, { ...intent, issue: 'Automatic deletion was interrupted. Remaining files were retained for retry.' }); await report(); }
          } catch { await report(); }
        }
      });
      if (!issue) await store.write(fileTrashIssueKey(workspace.id), null);
    } catch (error) {
      if (error instanceof HttpError && error.code === 'WORKSPACE_BUSY') continue;
      await report();
    }
  }
}
