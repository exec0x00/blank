import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import { HttpError } from '../errors';
import type { GitCheckpointIndex, GitCheckpointIndexEntry } from './types';

const DEFAULT_MAX_ENTRIES = 100_000;
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const MAX_PATH_BYTES = 4096;
const MAX_EXTENSIONS = 1024;
const EXTENDED_FLAGS = 0x6000;

interface RawIndexEntry {
  path: Buffer;
  mode: number;
  objectId: string;
  flags: number;
  extendedFlags: number;
}

function invalid(message: string): never {
  throw new HttpError(409, message, 'CHECKPOINT_INVALID_INDEX');
}

function unsupported(message: string): never {
  throw new HttpError(409, message, 'CHECKPOINT_UNSUPPORTED_INDEX');
}

function limit(message: string): never {
  throw new HttpError(413, message, 'CHECKPOINT_LIMIT');
}

function entryPath(bytes: Buffer): string {
  if (!bytes.length || !isUtf8(bytes)) invalid('The Git index contains an empty or invalid UTF-8 path.');
  const relative = bytes.toString('utf8');
  if (/[\\\u0000-\u001f\u007f]/u.test(relative) || /^[a-z]:/iu.test(relative)
    || relative.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) {
    invalid('The Git index contains a path that is not safe for checkpoint restoration.');
  }
  return relative;
}

/** Read the native index without invoking Git or following any index paths.
 * Format: https://git-scm.com/docs/gitformat-index
 * The caller retains the immutable raw bytes, including optional extensions.
 */
export function parseGitCheckpointIndex(
  bytes: Buffer | null,
  objectFormat: 'sha1' | 'sha256',
  options: { maxEntries?: number; maxBytes?: number } = {},
): Omit<GitCheckpointIndex, 'blob'> {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    limit('The Git index checkpoint limits must be nonnegative safe integers.');
  }
  if (objectFormat !== 'sha1' && objectFormat !== 'sha256') unsupported('The repository uses an unsupported Git object format.');
  if (bytes === null) return { present: false, sha256: null, bytes: 0, format: null, extensions: [], entries: [] };
  if (!Buffer.isBuffer(bytes)) invalid('The Git index is not a byte buffer.');
  if (bytes.length > maxBytes) limit('The Git index exceeds the checkpoint byte limit.');

  const objectBytes = objectFormat === 'sha1' ? 20 : 32;
  if (bytes.length < 12 + objectBytes) invalid('The Git index header or checksum is truncated.');
  if (bytes.readUInt32BE(0) !== 0x44495243) invalid('The Git index signature is invalid.');
  const payloadEnd = bytes.length - objectBytes;
  const checksum = createHash(objectFormat).update(bytes.subarray(0, payloadEnd)).digest();
  if (!checksum.equals(bytes.subarray(payloadEnd))) invalid('The Git index checksum does not match its contents.');

  const format = bytes.readUInt32BE(4);
  if (format !== 2 && format !== 3 && format !== 4) unsupported('The Git index version is not supported by checkpoints.');
  const count = bytes.readUInt32BE(8);
  if (count > maxEntries) limit('The Git index exceeds the checkpoint entry limit.');

  let offset = 12;
  let decodedPathBytes = 0;
  let previousPath: Buffer = Buffer.alloc(0);
  const rawEntries: RawIndexEntry[] = [];
  const requireBytes = (length: number) => {
    if (length > payloadEnd - offset) invalid('The Git index entry or extension is truncated.');
  };
  const terminatedPath = (maximum: number): Buffer => {
    const end = Math.min(payloadEnd, offset + maximum + 1);
    const length = bytes.subarray(offset, end).indexOf(0);
    if (length < 0) {
      if (payloadEnd - offset > maximum) limit('A Git index path exceeds the checkpoint path byte limit.');
      invalid('A Git index path is missing its terminator.');
    }
    const value = bytes.subarray(offset, offset + length);
    offset += length + 1;
    return value;
  };

  for (let index = 0; index < count; index++) {
    const start = offset;
    requireBytes(40 + objectBytes + 2);
    const mode = bytes.readUInt32BE(offset + 24);
    const objectId = bytes.subarray(offset + 40, offset + 40 + objectBytes).toString('hex');
    const flags = bytes.readUInt16BE(offset + 40 + objectBytes);
    offset += 40 + objectBytes + 2;
    let extendedFlags = 0;
    if (flags & 0x4000) {
      if (format === 2) invalid('A version 2 Git index cannot contain extended entry flags.');
      requireBytes(2);
      extendedFlags = bytes.readUInt16BE(offset);
      offset += 2;
    }

    let pathname: Buffer;
    if (format === 4) {
      // Git uses OFS_DELTA integers: a continued value is incremented before
      // shifting. The prefix length is measured in bytes, even within UTF-8.
      requireBytes(1);
      let byte = bytes[offset++];
      let strip = byte & 0x7f;
      while (byte & 0x80) {
        if (strip > previousPath.length) invalid('A compressed Git index path removes an invalid prefix.');
        requireBytes(1);
        byte = bytes[offset++];
        strip = (strip + 1) * 128 + (byte & 0x7f);
      }
      if (strip > previousPath.length) invalid('A compressed Git index path removes an invalid prefix.');
      const prefixBytes = previousPath.length - strip;
      const suffix = terminatedPath(MAX_PATH_BYTES - prefixBytes);
      pathname = prefixBytes ? Buffer.concat([previousPath.subarray(0, prefixBytes), suffix]) : suffix;
    } else {
      pathname = terminatedPath(MAX_PATH_BYTES);
      const paddedEnd = start + Math.ceil((offset - start) / 8) * 8;
      requireBytes(paddedEnd - offset);
      while (offset < paddedEnd) if (bytes[offset++] !== 0) invalid('The Git index contains nonzero entry padding.');
    }
    decodedPathBytes += pathname.length;
    if (decodedPathBytes > maxBytes) limit('The expanded Git index paths exceed the checkpoint byte limit.');
    rawEntries.push({ path: pathname, mode, objectId, flags, extendedFlags });
    previousPath = pathname;
  }

  const extensions: string[] = [];
  while (offset < payloadEnd) {
    requireBytes(8);
    if (extensions.length >= MAX_EXTENSIONS) limit('The Git index contains too many checkpoint extensions.');
    const first = bytes[offset];
    const signature = bytes.subarray(offset, offset + 4).toString('latin1');
    const length = bytes.readUInt32BE(offset + 4);
    offset += 8;
    requireBytes(length);
    if (signature === 'link') unsupported('Split Git indexes are not supported by checkpoints.');
    if (signature === 'sdir') unsupported('Sparse Git indexes are not supported by checkpoints.');
    if (first < 0x41 || first > 0x5a) unsupported('The Git index contains an unsupported required extension.');
    extensions.push(signature);
    offset += length;
  }

  // A split index can encode replacement entries with empty names. Check its
  // required extension above before interpreting ordinary entry semantics.
  const entries: GitCheckpointIndexEntry[] = [];
  let previous: RawIndexEntry | undefined;
  for (const entry of rawEntries) {
    if (entry.extendedFlags & ~EXTENDED_FLAGS) unsupported('The Git index contains unsupported extended entry flags.');
    if (entry.mode === 0o160000) unsupported('Git submodule entries are not supported by checkpoints.');
    if (entry.mode === 0o040000) unsupported('Sparse Git directory entries are not supported by checkpoints.');
    const mode = entry.mode === 0o100644 ? '100644' : entry.mode === 0o100755 ? '100755' : entry.mode === 0o120000 ? '120000' : null;
    if (!mode) invalid('The Git index contains an invalid file mode.');
    if (/^0+$/.test(entry.objectId) && !(entry.extendedFlags & 0x2000)) invalid('A Git index entry has a null object ID without intent-to-add.');
    if ((entry.flags & 0x0fff) !== Math.min(entry.path.length, 0x0fff)) invalid('A Git index path length does not match its flags.');
    const relative = entryPath(entry.path);
    const stage = (entry.flags >> 12 & 3) as 0 | 1 | 2 | 3;
    if (previous) {
      const order = Buffer.compare(previous.path, entry.path);
      if (order > 0 || order === 0 && (previous.flags >> 12 & 3) >= stage) invalid('The Git index entries are duplicated or out of order.');
    }
    entries.push({ path: relative, mode, objectId: entry.objectId, stage,
      assumeValid: !!(entry.flags & 0x8000), skipWorktree: !!(entry.extendedFlags & 0x4000),
      intentToAdd: !!(entry.extendedFlags & 0x2000), blob: null });
    previous = entry;
  }
  return { present: true, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, format, extensions, entries };
}
