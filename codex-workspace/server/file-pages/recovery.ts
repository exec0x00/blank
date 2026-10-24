import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppContext } from '../context';
import { HttpError } from '../errors';
import { MAX_RANGE_SAVE_FILE_BYTES, MAX_PAGE_BYTES } from './limits';
import { errno } from './source';
import { filePagePath } from './validation';
import type { WorkspaceFileRecovery } from './types';

const PREFIX = 'file-page-save-';
const NAME = /^file-page-save-([a-f0-9-]{36})\.json$/;
export const MAX_RECOVERY_RECORDS = 128;
export const MAX_RECOVERY_RECORD_BYTES = 32 * 1024;
export interface FileSaveRecord {
  format: 1;
  id: string;
  workspaceId: string;
  path: string;
  canonicalPath: string;
  recoveryPath: string;
  originalVersion: string;
  size: number;
  sha256?: string;
  recoveryIdentity?: string;
  /** An interrupted install is observable, never replayed or removed at startup. */
  installName?: string;
  completeCopy: boolean;
  phase: WorkspaceFileRecovery['phase'];
  createdAt: string;
  issue?: string;
}

export const recoveryKey = (id: string): string => `${PREFIX}${id}`;
export const recoveryRecordPath = (ctx: AppContext, id: string): string => path.join(ctx.config.stateDir, `${recoveryKey(id)}.json`);
const active = new Set<string>();
const activityKey = (ctx: AppContext, id: string): string => `${ctx.config.stateDir}\0${id}`;
export function recoveryActive(ctx: AppContext, id: string): () => void {
  const key = activityKey(ctx, id); active.add(key);
  return () => active.delete(key);
}

function invalid(): never { throw new HttpError(409, 'File save recovery metadata is invalid. Existing files were retained.', 'FILE_RECOVERY_INVALID'); }
function checkedRecord(value: unknown, id: string): FileSaveRecord {
  const record = value as FileSaveRecord;
  if (!record || record.format !== 1 || record.id !== id || !/^[a-f0-9-]{36}$/.test(record.id)
    || typeof record.workspaceId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(record.workspaceId)
    || typeof record.originalVersion !== 'string' || !/^[a-f0-9]{64}$/.test(record.originalVersion)
    || !Number.isSafeInteger(record.size) || record.size < 0 || record.size > MAX_RANGE_SAVE_FILE_BYTES + MAX_PAGE_BYTES
    || typeof record.completeCopy !== 'boolean' || !['preparing', 'ready', 'committing', 'confirming', 'complete', 'interrupted'].includes(record.phase)
    || typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))
    || record.sha256 !== undefined && (typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256))
    || record.recoveryIdentity !== undefined && (typeof record.recoveryIdentity !== 'string' || record.recoveryIdentity.length > 512)
    || record.installName !== undefined && (typeof record.installName !== 'string' || !/^\.codex-write-[a-f0-9-]{36}$/.test(record.installName))
    || record.issue !== undefined && (typeof record.issue !== 'string' || record.issue.length > 8192)) invalid();
  for (const field of ['path', 'canonicalPath', 'recoveryPath'] as const) {
    try { if (filePagePath(record[field]) !== record[field]) invalid(); } catch { invalid(); }
  }
  if (path.posix.dirname(record.recoveryPath) !== path.posix.dirname(record.canonicalPath)
    || path.posix.basename(record.recoveryPath) !== `.codex-recovery-${id}.recovery`) invalid();
  if (record.completeCopy && (!record.sha256 || !record.recoveryIdentity)) invalid();
  return record;
}

async function stateDirectory(ctx: AppContext): Promise<void> {
  const absolute = path.resolve(ctx.config.stateDir);
  const stat = await fs.lstat(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(absolute) !== absolute) invalid();
}

async function readRecord(ctx: AppContext, id: string): Promise<FileSaveRecord> {
  const handle = await fs.open(recoveryRecordPath(ctx, id), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(MAX_RECOVERY_RECORD_BYTES)) invalid();
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (offset !== Number(before.size) || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) invalid();
    let value: unknown;
    try { value = JSON.parse(bytes.subarray(0, offset).toString('utf8')); } catch { return invalid(); }
    return checkedRecord(value, id);
  } finally { await handle.close(); }
}

/** Startup/listing only observes recovery records. It never reapplies edits or removes files. */
export async function fileSaveRecords(ctx: AppContext, signal?: AbortSignal): Promise<FileSaveRecord[]> {
  signal?.throwIfAborted();
  try { await stateDirectory(ctx); }
  catch (error) { if (errno(error, 'ENOENT')) return []; throw error; }
  const records: FileSaveRecord[] = [];
  signal?.throwIfAborted();
  const directory = await fs.opendir(ctx.config.stateDir, { bufferSize: 64 });
  const deadline = Date.now() + 30_000;
  let scanned = 0;
  for await (const entry of directory) {
    signal?.throwIfAborted();
    if (++scanned > 250_000 || Date.now() > deadline) throw new HttpError(503, 'File recovery metadata could not be scanned in time. Existing files were retained.', 'FILE_RECOVERY_BUSY');
    const match = NAME.exec(entry.name);
    if (!match) continue;
    if (records.length >= MAX_RECOVERY_RECORDS) throw new HttpError(429, 'Too many file recovery copies are retained. Inspect those copies before saving another large file.', 'FILE_RECOVERY_FULL');
    if (!entry.isFile() || entry.isSymbolicLink()) invalid();
    try { records.push(await readRecord(ctx, match[1]!)); }
    catch (error) { if (!errno(error, 'ENOENT')) throw error; }
  }
  signal?.throwIfAborted();
  return records;
}

export async function writeSaveRecord(ctx: AppContext, record: FileSaveRecord, first = false): Promise<void> {
  checkedRecord(record, record.id);
  await stateDirectory(ctx);
  // Normal state is small ordinary JSON. Refuse a foreign or oversized record
  // before allowing JsonStore to read it for its serialized update.
  const existing = await readRecord(ctx, record.id).catch(error => { if (errno(error, 'ENOENT')) return null; throw error; });
  if (first ? existing !== null : existing?.id !== record.id) invalid();
  await ctx.store.update<FileSaveRecord | null>(recoveryKey(record.id), null, current => {
    if (JSON.stringify(current) !== JSON.stringify(existing)) invalid();
    return record;
  });
}

export async function listFileRecoveries(ctx: AppContext, workspaceId: string, signal?: AbortSignal): Promise<WorkspaceFileRecovery[]> {
  signal?.throwIfAborted();
  await ctx.workspaces.get(workspaceId);
  return (await fileSaveRecords(ctx, signal)).filter(record => record.workspaceId === workspaceId).map(record => {
    const running = active.has(activityKey(ctx, record.id));
    return { id: record.id, workspaceId, path: record.path, recoveryPath: record.recoveryPath, completeCopy: record.completeCopy,
      state: running ? 'running' as const : 'retained' as const, phase: record.phase, createdAt: record.createdAt,
      issue: record.issue ?? (running ? null : record.completeCopy
        ? 'A full edited copy was retained after an interrupted save. Compare it with the original before making changes.'
        : 'The instance stopped while preparing this recovery copy. It may be incomplete; the app will not apply it automatically.') };
  });
}
