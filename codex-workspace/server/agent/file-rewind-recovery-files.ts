import { createHash } from 'node:crypto';
import { constants, promises as fs, type Stats } from 'node:fs';
import path from 'node:path';
import { HttpError } from '../errors';
import type { GitCheckpointFile } from '../git-checkpoints/types';
import { FILE_REWIND_LIMITS, RewindDirectory, isErrno, readRewindJSON, rewindIdentity,
  safeRewindAbsolute, safeRewindRelative, sameRewindVersion } from './file-rewind-transaction-io';

export const FILE_REWIND_RECOVERY_LIMITS = Object.freeze({ fileBytes: 16 * 1024 * 1024,
  defaultPageBytes: 16 * 1024, maxPageBytes: 32 * 1024, minPageBytes: 4,
  bufferBytes: 64 * 1024, milliseconds: 60_000 });
export interface FileRewindRecoveryReadInput {
  /** Trusted server configuration, never an HTTP-supplied filesystem path. */
  directory: string;
  recoveryId: string;
  workspaceId: string;
  threadId: string;
  path: string;
  side: 'original' | 'restored';
  /** UTF-8 byte position. A position within a character returns its leading byte. */
  offset?: number;
  /** Byte budget, 4 through 32,768; defaults to 16,384. */
  limit?: number;
}
export interface FileRewindRecoveryRead {
  path: string;
  side: 'original' | 'restored';
  kind: GitCheckpointFile['kind'];
  mode: number;
  bytes: number;
  sha256: string | null;
  /** Binary/invalid UTF-8 snapshots expose metadata only, never base64 payloads. */
  binary: boolean;
  text: string | null;
  totalBytes: number;
  offset: number;
  nextOffset: number | null;
}
type Snapshot = Pick<GitCheckpointFile, 'path' | 'kind' | 'mode' | 'bytes' | 'sha256'>;
interface Receipt { absolute: string; size: number; sha256: string }
interface RecoveryUnit {
  key: string;
  kind: 'workspace' | 'index';
  path: string;
  expected: Snapshot;
  desired: Snapshot;
  backup?: Receipt;
  staged?: Receipt;
}
interface MetadataRecord { value: Record<string, unknown>; stat: Stats }
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const owner = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f/\\]/.test(value);
function conflict(): never {
  throw new HttpError(409, 'This recovery snapshot is incomplete or changed. Its retained files were left untouched.', 'FILE_REWIND_RECOVERY_CONFLICT');
}
function invalid(): never {
  throw new HttpError(400, 'Choose a valid recovery file, side and bounded byte range.', 'INVALID_FILE_REWIND_RECOVERY_READ');
}
function fileLimit(): never {
  throw new HttpError(413, 'This recovery file exceeds the 16 MiB inspection limit. Its retained bytes were left untouched.', 'FILE_REWIND_RECOVERY_LIMIT');
}
function checkRange(offset: number, bytes: number): void {
  if (offset > bytes) throw new HttpError(416, 'The requested recovery position is beyond this file.', 'FILE_REWIND_RECOVERY_RANGE');
}
function checkedPath(value: unknown): string {
  if (typeof value !== 'string') conflict();
  try { return safeRewindRelative(value); } catch { conflict(); }
}
function snapshot(value: unknown, relative: string): Snapshot {
  if (!record(value) || value.path !== relative || typeof value.kind !== 'string' || !['file', 'symlink', 'missing'].includes(value.kind)
    || !Number.isInteger(value.mode) || Number(value.mode) < 0 || Number(value.mode) > 0o777
    || !Number.isSafeInteger(value.bytes) || Number(value.bytes) < 0) conflict();
  const kind = value.kind as Snapshot['kind'], bytes = value.bytes as number, mode = value.mode as number;
  if (bytes > FILE_REWIND_LIMITS.fileBytes) conflict();
  if (kind === 'missing') {
    if (bytes !== 0 || mode !== 0 || value.sha256 !== null) conflict();
    return { path: relative, kind, bytes, mode, sha256: null };
  }
  if (typeof value.sha256 !== 'string' || !SHA256.test(value.sha256)
    || kind === 'symlink' && (bytes > 4_096 || mode !== 0o777)) conflict();
  return { path: relative, kind, bytes, mode, sha256: value.sha256 };
}
function receipt(value: unknown, expected: Snapshot, absolute: string): Receipt | undefined {
  if (expected.kind === 'missing') {
    if (value !== undefined) conflict();
    return undefined;
  }
  if (!record(value) || value.absolute !== absolute || value.size !== expected.bytes || value.sha256 !== expected.sha256) conflict();
  return { absolute, size: expected.bytes, sha256: expected.sha256! };
}
async function metadata(directory: RewindDirectory, name: string): Promise<MetadataRecord> {
  const stat = await fs.lstat(`${directory.access}/${name}`);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > FILE_REWIND_LIMITS.metadataBytes) conflict();
  const value = await readRewindJSON(directory, name);
  if (!record(value) || !sameRewindVersion(rewindIdentity(await fs.lstat(`${directory.access}/${name}`)), rewindIdentity(stat))) conflict();
  return { value, stat };
}
async function recheckMetadata(directory: RewindDirectory, name: string, expected: Stats): Promise<void> {
  const stat = await fs.lstat(`${directory.access}/${name}`);
  if (!stat.isFile() || !sameRewindVersion(rewindIdentity(stat), rewindIdentity(expected))) conflict();
}
function assertOwner(value: Record<string, unknown>, input: FileRewindRecoveryReadInput): void {
  if (value.version !== 1 || value.id !== input.recoveryId || !owner(value.workspaceId) || !owner(value.threadId)
    || typeof value.createdAt !== 'string' || value.createdAt.length > 64 || !Number.isFinite(Date.parse(value.createdAt))) conflict();
  if (value.workspaceId !== input.workspaceId || value.threadId !== input.threadId) {
    throw new HttpError(403, 'This recovery record does not belong to the selected conversation.', 'FILE_REWIND_RECOVERY_SCOPE');
  }
}
function unitsFrom(manifest: Record<string, unknown>, identity: Record<string, unknown>, directory: RewindDirectory): RecoveryUnit[] {
  if (!Array.isArray(identity.paths) || identity.paths.length > FILE_REWIND_LIMITS.files || !Array.isArray(manifest.units)
    || manifest.units.length > FILE_REWIND_LIMITS.files + 1 || manifest.createdAt !== identity.createdAt) conflict();
  const paths = identity.paths.map(checkedPath), wanted = new Set(paths);
  if (wanted.size !== paths.length) conflict();
  const seen = new Set<string>(), result: RecoveryUnit[] = [];
  let indices = 0;
  for (let index = 0; index < manifest.units.length; index++) {
    const value: unknown = manifest.units[index];
    if (!record(value) || value.key !== String(index).padStart(6, '0') || typeof value.kind !== 'string' || !['workspace', 'index'].includes(value.kind)) conflict();
    const relative = checkedPath(value.path), key = value.key as string;
    if (value.kind === 'workspace') {
      if (seen.has(relative) || !wanted.has(relative) || relative !== paths[index] || indices !== 0) conflict();
      seen.add(relative);
    } else if (++indices > 1 || relative !== 'index' || index !== manifest.units.length - 1) conflict();
    const expected = snapshot(value.expected, relative), desired = snapshot(value.desired, relative);
    result.push({ key, kind: value.kind as RecoveryUnit['kind'], path: relative, expected, desired,
      backup: receipt(value.backup, expected, path.join(directory.absolute, 'before', key)),
      staged: receipt(value.staged, desired, path.join(directory.absolute, 'after', key)) });
  }
  if (seen.size !== wanted.size) conflict();
  return result;
}

/**
 * Bounded inspection of the transaction's immutable raw snapshots. Caller
 * authorizes the signed operation first. Metadata and every blob byte are
 * verified before any page is returned; paths are always derived from pinned
 * snapshot directories. Workspace paths, Git index entries and parked links
 * are never opened as content sources.
 */
export async function inspectFileRewindRecovery(input: FileRewindRecoveryReadInput): Promise<FileRewindRecoveryRead> {
  if (!record(input)) invalid();
  const offset = input.offset === undefined ? 0 : input.offset;
  const limit = input.limit === undefined ? FILE_REWIND_RECOVERY_LIMITS.defaultPageBytes : input.limit;
  if (!owner(input.workspaceId) || !owner(input.threadId) || typeof input.recoveryId !== 'string' || !UUID.test(input.recoveryId)
    || !['original', 'restored'].includes(input.side) || !Number.isSafeInteger(offset) || offset < 0
    || !Number.isSafeInteger(limit) || limit < FILE_REWIND_RECOVERY_LIMITS.minPageBytes || limit > FILE_REWIND_RECOVERY_LIMITS.maxPageBytes) invalid();
  try { safeRewindAbsolute(input.directory); safeRewindRelative(input.path); } catch { invalid(); }
  const deadline = Date.now() + FILE_REWIND_RECOVERY_LIMITS.milliseconds;
  // The deadline is checked between filesystem operations; an already blocked
  // native filesystem syscall cannot be interrupted by a JavaScript timer.
  const checkTime = (): void => {
    if (Date.now() > deadline) throw new HttpError(503, 'The recovery snapshot took too long to verify. Retry this bounded read.', 'FILE_REWIND_RECOVERY_TIMEOUT');
  };
  let base: RewindDirectory | undefined, transaction: RewindDirectory | undefined, blobs: RewindDirectory | undefined;
  try {
    base = await RewindDirectory.open(input.directory);
    transaction = await base.child(input.recoveryId);
    checkTime();
    const identity = await metadata(transaction, 'identity.json'); assertOwner(identity.value, input); checkTime();
    const manifest = await metadata(transaction, 'manifest.json'); assertOwner(manifest.value, input); checkTime();
    const unit = unitsFrom(manifest.value, identity.value, transaction).find(candidate => candidate.kind === 'workspace' && candidate.path === input.path);
    if (!unit) throw new HttpError(404, 'That file is not part of this conversation recovery record.', 'FILE_REWIND_RECOVERY_NOT_FOUND');
    const selected = input.side === 'original' ? unit.expected : unit.desired;
    if (selected.bytes > FILE_REWIND_RECOVERY_LIMITS.fileBytes) fileLimit();
    checkRange(offset, selected.bytes);
    const result: FileRewindRecoveryRead = { path: unit.path, side: input.side, kind: selected.kind, mode: selected.mode,
      bytes: selected.bytes, sha256: selected.sha256, binary: false, text: '', totalBytes: selected.bytes, offset, nextOffset: null };
    blobs = await transaction.child(input.side === 'original' ? 'before' : 'after');
    if (selected.kind === 'missing') {
      try { await fs.lstat(`${blobs.access}/${unit.key}`); conflict(); }
      catch (error) { if (!isErrno(error, 'ENOENT')) throw error; }
    } else {
      const before = await fs.lstat(`${blobs.access}/${unit.key}`);
      if (!before.isFile() || before.isSymbolicLink() || before.dev !== blobs.identity.dev || before.size !== selected.bytes) conflict();
      const handle = await fs.open(`${blobs.access}/${unit.key}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const opened = await handle.stat();
        if (!opened.isFile() || !sameRewindVersion(rewindIdentity(opened), rewindIdentity(before))) conflict();
        const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(FILE_REWIND_RECOVERY_LIMITS.bufferBytes);
        const from = Math.max(0, offset - 3), through = Math.min(selected.bytes, offset + limit + 3);
        const page = Buffer.alloc(through - from);
        const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
        let position = 0, binary = false;
        while (position < selected.bytes) {
          checkTime();
          const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, selected.bytes - position), position);
          if (!bytesRead) conflict();
          const chunk = buffer.subarray(0, bytesRead); hash.update(chunk);
          if (!binary) {
            for (const byte of chunk) if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13 || byte === 127) { binary = true; break; }
            if (!binary) { try { decoder.decode(chunk, { stream: true }); } catch { binary = true; } }
          }
          const start = Math.max(position, from), end = Math.min(position + bytesRead, through);
          if (end > start) chunk.copy(page, start - from, start - position, end - position);
          position += bytesRead;
        }
        if ((await handle.read(buffer, 0, 1, selected.bytes)).bytesRead !== 0 || hash.digest('hex') !== selected.sha256) conflict();
        if (!binary) { try { decoder.decode(); } catch { binary = true; } }
        if (!sameRewindVersion(rewindIdentity(await handle.stat()), rewindIdentity(before))
          || !sameRewindVersion(rewindIdentity(await fs.lstat(`${blobs.access}/${unit.key}`)), rewindIdentity(before))) conflict();
        if (binary) { result.binary = true; result.text = null; }
        else {
          let start = offset - from;
          while (start > 0 && (page[start] & 0xc0) === 0x80) start--;
          let end = Math.min(page.length, start + limit);
          while (end < page.length && end > start && (page[end] & 0xc0) === 0x80) end--;
          result.offset = from + start;
          result.text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(page.subarray(start, end));
          const next = from + end;
          result.nextOffset = next < selected.bytes ? next : null;
        }
      } finally { await handle.close(); }
    }
    await blobs.check(); await transaction.check(); await base.check();
    await recheckMetadata(transaction, 'identity.json', identity.stat);
    await recheckMetadata(transaction, 'manifest.json', manifest.stat);
    checkTime();
    return result;
  } catch (error) {
    if (error instanceof HttpError && (error.code?.startsWith('FILE_REWIND_RECOVERY_') || error.code === 'INVALID_FILE_REWIND_RECOVERY_READ')) throw error;
    if (isErrno(error, 'ENOENT')) throw new HttpError(404, 'The retained recovery snapshot is unavailable. Its existing files were left untouched.', 'FILE_REWIND_RECOVERY_NOT_FOUND');
    throw new HttpError(409, 'This recovery snapshot is incomplete or changed. Its retained files were left untouched.', 'FILE_REWIND_RECOVERY_CONFLICT');
  } finally { await blobs?.close(); await transaction?.close(); await base?.close(); }
}
