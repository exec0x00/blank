import { randomUUID } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config';
import { HttpError } from '../errors';
import type { JsonStore } from '../store';
import { FILE_METADATA_KEY } from '../file-metadata';
import { assessHostAdmission, observeHostResources } from '../host-resources';
import { transferNativeEntry, transferErrno, MAX_TRANSFER_MANIFEST_BYTES, MAX_TRANSFER_DURATION_MS } from './filesystem';
import { captureDurableReceipt, PublicBucketVerifier } from './durability';
import type { FileTransferPage, FileTransferStatus, NativeTransferOptions, StoredFileTransfer, TransferKind, TransferManifest, TransferPhase } from './types';
import { operationalIndexPage, operationalListChanged, operationalPageQuery, operationalRecordIds, type OperationalPageInput } from '../operational-pages';

const PREFIX = 'file-transfer-';
const RECORD = /^file-transfer-([a-f0-9-]{36})\.json$/;
const MAX_RECORDS = 512;
const MAX_RECORD_BYTES = 32 * 1024;
const active = new Set<string>();
const admitted = new Set<symbol>();
const plannedCacheBytes = new Map<symbol, number>();
const recordKey = (id: string) => `${PREFIX}${id}`;
const manifestKey = (id: string) => `${PREFIX}tree-${id}`;
const activeKey = (config: Pick<AppConfig, 'stateDir'>, id: string) => `${config.stateDir}\0${id}`;

function validRelative(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 && Buffer.byteLength(value) <= 4096
    && !/[\\\u0000-\u001f\u007f]/.test(value) && !path.posix.isAbsolute(value)
    && value.split('/').every(part => part !== '' && part !== '.' && part !== '..') && !/^[a-z]:/i.test(value);
}

function checkedRecord(value: unknown, id: string): StoredFileTransfer {
  const record = value as StoredFileTransfer | null;
  if (!record || record.version !== 1 || record.id !== id || typeof record.workspaceId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(record.workspaceId)
    || !['copy', 'move'].includes(record.kind) || !validRelative(record.path) || !validRelative(record.newPath)
    || !['copying', 'verifying', 'removing', 'complete', 'interrupted'].includes(record.phase)
    || typeof record.createdAt !== 'string' || typeof record.updatedAt !== 'string'
    || !Number.isFinite(Date.parse(record.createdAt)) || !Number.isFinite(Date.parse(record.updatedAt))
    || record.issue !== undefined && (typeof record.issue !== 'string' || record.issue.length > 1024)
    || record.interruptedPhase !== undefined && !['copying', 'verifying', 'removing'].includes(record.interruptedPhase)) {
    throw new HttpError(409, 'A saved file transfer record is invalid. Its files were left unchanged.', 'FILE_TRANSFER_STATE_INVALID');
  }
  return record;
}

async function stateDirectory(config: Pick<AppConfig, 'stateDir'>): Promise<void> {
  const resolved = path.resolve(config.stateDir);
  const stat = await fs.lstat(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(resolved) !== resolved) {
    throw new HttpError(403, 'File transfer recovery storage is not a safe directory.', 'UNSAFE_PATH');
  }
}

async function readRecord(config: Pick<AppConfig, 'stateDir'>, id: string): Promise<StoredFileTransfer | null> {
  const filename = path.join(config.stateDir, `${recordKey(id)}.json`);
  let handle;
  try { handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if (transferErrno(error, 'ENOENT')) return null; throw error; }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_RECORD_BYTES) throw new HttpError(409, 'Saved file transfer metadata exceeds its limit.', 'FILE_TRANSFER_STATE_INVALID');
    const buffer = Buffer.alloc(before.size + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
      if (!bytesRead) break;
      total += bytesRead;
    }
    const after = await handle.stat();
    if (total !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
      throw new HttpError(409, 'A saved file transfer record changed. Refresh before continuing.', 'FILE_TRANSFER_STATE_INVALID');
    }
    let value: unknown;
    try { value = JSON.parse(buffer.subarray(0, total).toString('utf8')); }
    catch { throw new HttpError(409, 'A saved file transfer record is not valid JSON. Its files were retained.', 'FILE_TRANSFER_STATE_INVALID'); }
    return checkedRecord(value, id);
  } finally { await handle.close(); }
}

async function records(config: Pick<AppConfig, 'stateDir'>): Promise<StoredFileTransfer[]> {
  await stateDirectory(config);
  const result: StoredFileTransfer[] = [];
  let scanned = 0;
  const deadline = Date.now() + 30_000;
  const directory = await fs.opendir(config.stateDir, { bufferSize: 64 });
  for await (const entry of directory) {
    if (++scanned > 250_000 || Date.now() > deadline) {
      throw new HttpError(503, 'File transfer recovery metadata could not be scanned within its limit. Files were left unchanged; try again shortly.', 'FILE_TRANSFER_SCAN_LIMIT');
    }
    const match = RECORD.exec(entry.name);
    if (!match) continue;
    if (result.length >= MAX_RECORDS) throw new HttpError(429, 'Too many unfinished file transfers remain. Inspect their source and destination files before trying again.', 'FILE_TRANSFER_RECOVERY_FULL');
    if (entry.isSymbolicLink() || !entry.isFile()) throw new HttpError(409, 'A saved file transfer record is not a regular file. Its files were left unchanged.', 'FILE_TRANSFER_STATE_INVALID');
    const record = await readRecord(config, match[1]);
    if (record) result.push(record);
  }
  return result;
}

function publicRecord(config: Pick<AppConfig, 'stateDir'>, record: StoredFileTransfer): FileTransferStatus {
  const running = active.has(activeKey(config, record.id));
  const interrupted = 'This transfer did not finish. Inspect both paths before deleting anything; the app will not automatically remove or overwrite either location.';
  return {
    id: record.id, workspaceId: record.workspaceId, kind: record.kind, path: record.path, newPath: record.newPath,
    state: running ? 'running' : 'interrupted', phase: ['copying', 'verifying', 'removing'].includes(record.phase)
      ? record.phase as FileTransferStatus['phase'] : record.interruptedPhase ?? 'verifying',
    createdAt: record.createdAt, updatedAt: record.updatedAt,
    ...(!running ? { issue: record.issue ?? interrupted } : {}),
  };
}

/** Recovery is intentionally observational: a restart cannot authorize more source deletions. */
export async function listWorkspaceFileTransfers(config: Pick<AppConfig, 'stateDir'>, workspaceId: string): Promise<FileTransferStatus[]> {
  return (await records(config)).filter(record => record.workspaceId === workspaceId && record.phase !== 'complete')
    .map(record => publicRecord(config, record)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Public observation stays bounded; recovery and transfer admission retain
 * their strict full-journal semantics and never run from this read path. */
export async function listWorkspaceFileTransfersPage(config: Pick<AppConfig, 'stateDir'>, workspaceId: string,
  input: OperationalPageInput = {}): Promise<FileTransferPage> {
  const query = operationalPageQuery(input);
  await stateDirectory(config);
  const visible = (record: StoredFileTransfer) => record.workspaceId === workspaceId && record.phase !== 'complete'
    && (!query.q || `${record.kind}\n${record.path}\n${record.newPath}`.toLocaleLowerCase().includes(query.q));
  const readPageRecord = async (id: string): Promise<StoredFileTransfer | null> => {
    try { return await readRecord(config, id); }
    catch (error) {
      if (transferErrno(error, 'ELOOP')) throw new HttpError(409, 'A saved file transfer record is not a regular file. Its files were left unchanged.', 'FILE_TRANSFER_STATE_INVALID');
      throw error;
    }
  };
  const readRecords = async function* (): AsyncGenerator<StoredFileTransfer> {
    for await (const id of operationalRecordIds(config.stateDir, PREFIX, MAX_RECORDS, 'FILE_TRANSFER_RECOVERY_FULL', id => /^[a-f0-9-]{36}$/.test(id), 429)) {
      const record = await readPageRecord(id);
      if (record) yield record;
    }
  };
  const { ids, ...page } = await operationalIndexPage(readRecords(), query,
    record => visible(record) ? { id: record.id, order: record.createdAt } : null);
  const items: FileTransferStatus[] = [];
  for (const id of ids) {
    const record = await readPageRecord(id);
    if (!record || !visible(record)) throw operationalListChanged();
    items.push(publicRecord(config, record));
  }
  return { ...page, items };
}

/** Startup records interruption honestly, without touching a source or destination tree. */
export async function recoverFileTransfers(config: Pick<AppConfig, 'stateDir'>, store: JsonStore): Promise<void> {
  for (const record of await records(config)) {
    if (record.phase === 'complete' || record.phase === 'interrupted' || active.has(activeKey(config, record.id))) continue;
    await store.update<StoredFileTransfer | null>(recordKey(record.id), null, value => {
      if (!value) return null;
      const current = checkedRecord(value, record.id);
      if (current.phase === 'complete' || current.phase === 'interrupted') return current;
      return { ...current, phase: 'interrupted', interruptedPhase: current.phase, updatedAt: new Date().toISOString(),
        issue: 'The instance restarted during this transfer. Source and destination files were retained without automatic cleanup. Inspect both paths before continuing.' };
    });
  }
}

export interface WorkspaceEntryTransferOptions {
  workspaceId: string;
  path: string;
  newPath: string;
  root: string;
  source: string;
  destination: string;
  kind: TransferKind;
  expectedSource?: NativeTransferOptions['expectedSource'];
  checkAllowed?: () => Promise<void>;
  checkpointFileMetadata?: () => Promise<void>;
  verifyDurable?: NativeTransferOptions['verifyDurable'];
}

/** Small durable journal plus a verified tree manifest; no duplicate payload staging under /data. */
export async function transferWorkspaceEntry(config: AppConfig, store: JsonStore, options: WorkspaceEntryTransferOptions): Promise<void> {
  if (admitted.size >= 2) throw new HttpError(429, 'Two file transfers are already running. Wait for one to finish.', 'FILE_TRANSFER_BUSY');
  const admission = Symbol('file-transfer');
  admitted.add(admission);
  try { await performWorkspaceTransfer(config, store, options, admission); }
  finally { plannedCacheBytes.delete(admission); admitted.delete(admission); }
}

async function performWorkspaceTransfer(config: AppConfig, store: JsonStore, options: WorkspaceEntryTransferOptions, admission: symbol): Promise<void> {
  const deadline = Date.now() + MAX_TRANSFER_DURATION_MS;
  const requireDurability = config.requirePersistentData;
  if (requireDurability && !options.checkpointFileMetadata) {
    throw new HttpError(503, 'Durable file metadata capture is unavailable. Source files were retained.', 'FILE_TRANSFER_DURABILITY_UNAVAILABLE');
  }
  const checkResources = async (estimatedAdditionalBytes = 256 * 1024 * 1024) => {
    if (!config.production && !config.requirePersistentData) return;
    const admission = assessHostAdmission(await observeHostResources(config), { estimatedAdditionalBytes });
    if (!admission.allowed) throw new HttpError(503, 'There is not enough confirmed instance memory headroom for this transfer. Source files were retained; wait for other work to finish.', 'FILE_TRANSFER_RESOURCES');
  };
  await checkResources();
  await stateDirectory(config);
  const previous = await records(config);
  if (previous.filter(record => record.phase !== 'complete').length >= MAX_RECORDS - 1) {
    throw new HttpError(429, 'File transfer recovery is full. Inspect unfinished transfers before starting another.', 'FILE_TRANSFER_RECOVERY_FULL');
  }
  // Completed summaries are disposable; interrupted manifests must remain recoverable.
  for (const completed of previous.filter(record => record.phase === 'complete')) {
    await store.delete(manifestKey(completed.id));
    await store.delete(recordKey(completed.id));
  }
  const id = randomUUID();
  const key = activeKey(config, id);
  const now = new Date().toISOString();
  let record: StoredFileTransfer = { version: 1, id, workspaceId: options.workspaceId, kind: options.kind,
    path: options.path, newPath: options.newPath, phase: 'copying', createdAt: now, updatedAt: now };
  checkedRecord(record, id);
  active.add(key);
  let saved = false;
  const save = async (phase: TransferPhase, issue?: string): Promise<void> => {
    const next: StoredFileTransfer = { ...record, phase, updatedAt: new Date().toISOString(), ...(issue ? { issue } : {}),
      ...(phase === 'interrupted' && record.phase !== 'complete' && record.phase !== 'interrupted' ? { interruptedPhase: record.phase } : {}) };
    await store.update<StoredFileTransfer | null>(recordKey(id), null, current => {
      if (saved ? JSON.stringify(current) !== JSON.stringify(record) : current !== null) {
        throw new HttpError(409, 'File transfer recovery metadata changed. Remaining files were retained.', 'FILE_TRANSFER_STATE_INVALID');
      }
      return next;
    });
    saved = true; record = next;
  };
  let manifestSaved = false;
  let copyingStarted = false;
  let verifier: PublicBucketVerifier | undefined;
  const confirmMetadata = async (keys: string[]): Promise<void> => {
    if (!requireDurability) return;
    verifier ??= new PublicBucketVerifier(config, { checkResources, deadline });
    const receipts = [];
    for (const key of keys) receipts.push(await captureDurableReceipt(config, path.join(config.stateDir, `${key}.json`), MAX_TRANSFER_MANIFEST_BYTES));
    await verifier.verify(receipts);
  };
  try {
    await save('copying');
    await transferNativeEntry({ root: options.root, source: options.source, destination: options.destination, kind: options.kind,
      expectedSource: options.expectedSource,
      deadline,
      checkAllowed: options.checkAllowed, checkResources,
      verifyDurable: async manifest => {
        if (requireDurability) {
          verifier ??= new PublicBucketVerifier(config, { checkResources, deadline });
          await verifier.verify(manifest.entries.filter(entry => entry.kind === 'file').map(entry => ({
            absolute: entry.path ? path.join(options.destination, ...entry.path.split('/')) : options.destination,
            size: entry.source.size, sha256: entry.sha256!,
          })));
          await confirmMetadata([manifestKey(id), recordKey(id), FILE_METADATA_KEY]);
        }
        await options.verifyDurable?.(manifest);
      },
      checkpoint: async (phase, manifest) => {
        if (phase === 'copying') {
          // Native/FUSE cache pages count toward the instance total too. The
          // source and destination may both become resident despite our small buffer.
          // Reserve synchronously before the awaited observation so two large
          // transfers cannot both admit against the same unreserved snapshot.
          plannedCacheBytes.set(admission, (manifest?.bytes ?? 0) * 2);
          await checkResources(256 * 1024 * 1024 + [...plannedCacheBytes.values()].reduce((total, bytes) => total + bytes, 0));
          copyingStarted = true;
        }
        if (phase === 'verifying' && manifest) {
          if (Buffer.byteLength(JSON.stringify(manifest, null, 2)) + 1 > MAX_TRANSFER_MANIFEST_BYTES) throw new HttpError(413, 'File transfer recovery metadata exceeds its limit.', 'FILE_TRANSFER_LIMIT');
          await store.update<TransferManifest | null>(manifestKey(id), null, current => {
            if (current !== null) throw new HttpError(409, 'File transfer recovery metadata already exists.', 'FILE_TRANSFER_STATE_INVALID');
            return manifest;
          });
          manifestSaved = true;
          await options.checkpointFileMetadata?.();
        }
        if (phase === 'complete' && options.kind === 'move') {
          if (requireDurability && manifest) {
            verifier = new PublicBucketVerifier(config, { checkResources, deadline });
            await verifier.verifyAbsent(manifest.entries.filter(entry => entry.kind === 'file')
              .map(entry => entry.path ? path.join(options.source, ...entry.path.split('/')) : options.source));
          }
          await options.checkpointFileMetadata?.();
          await confirmMetadata([FILE_METADATA_KEY]);
        }
        if (phase !== 'copying') await save(phase);
        if (phase === 'removing') await confirmMetadata([recordKey(id)]);
      },
    });
    // Successful transfers do not accumulate manifests containing every file name.
    if (manifestSaved) await store.delete(manifestKey(id)).catch(() => undefined);
    await store.delete(recordKey(id)).catch(() => undefined);
  } catch (error) {
    const removing = record.phase === 'removing';
    const message = removing
      ? 'The move did not finish. The verified destination and any remaining source files were retained. Inspect both paths before continuing.'
      : 'The transfer stopped before source removal. Original files were retained; a partial destination may exist. Inspect both paths before trying again.';
    if (saved && !copyingStarted) {
      // No destination leaf or source deletion was attempted. Validation-only
      // failures have no payload to recover and must not fill the journal quota.
      try {
        if (JSON.stringify(await store.read<StoredFileTransfer | null>(recordKey(id), null)) === JSON.stringify(record)) await store.delete(recordKey(id));
      } catch { /* Retain edited or unreadable recovery metadata for inspection. */ }
    } else if (saved && record.phase !== 'complete') await save('interrupted', message).catch(() => undefined);
    if (error instanceof HttpError) {
      if (removing) throw new HttpError(error.status, message, error.code);
      throw error;
    }
    if (transferErrno(error, 'ENOSPC') || transferErrno(error, 'EDQUOT')) throw new HttpError(507, message, 'FILE_TRANSFER_NO_SPACE');
    throw new HttpError(500, message, 'FILE_TRANSFER_FAILED');
  } finally { active.delete(key); }
}
