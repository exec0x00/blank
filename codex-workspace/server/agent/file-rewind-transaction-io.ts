import { createHash } from 'node:crypto';
import { constants, promises as fs, type Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from '../errors';
import type { DurableFileReceipt } from '../file-transfers/durability';
import type { GitCheckpointFile, GitCheckpointFileIdentity, GitCheckpointIdentity } from '../git-checkpoints/types';

export const FILE_REWIND_LIMITS = Object.freeze({ files: 1_000, directories: 1_000, fileBytes: 32 * 1024 * 1024,
  totalBytes: 256 * 1024 * 1024, metadataBytes: 4 * 1024 * 1024, events: 30_100,
  bufferBytes: 256 * 1024, milliseconds: 15 * 60 * 1000 });
const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const CREATE_FLAGS = constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
export const isErrno = (error: unknown, code: string): boolean => !!error && typeof error === 'object' && 'code' in error && error.code === code;
export const hashBytes = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export function rewindConflict(message = 'Files changed after the rewind preview. Their current contents and the rewind backups were retained.'): never {
  throw new HttpError(409, message, 'FILE_REWIND_CONFLICT');
}
export function rewindUnsafe(): never {
  throw new HttpError(409, 'A rewind path changed or contains an unsafe link. Existing files were retained.', 'FILE_REWIND_UNSAFE_PATH');
}
export function rewindLimit(): never {
  throw new HttpError(413, 'This file rewind exceeds the bounded recovery limit. Rewind a smaller set of changes.', 'FILE_REWIND_LIMIT');
}
export function safeRewindName(value: string): void {
  if (!value || value === '.' || value === '..' || value.includes('/') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) rewindUnsafe();
}
export function safeRewindRelative(value: string): string {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 4_096 || value.startsWith('/')
    || value.split('/').length > 96 || value.split('/').some(part => part.toLowerCase() === '.git')) rewindUnsafe();
  for (const part of value.split('/')) safeRewindName(part);
  return value;
}
export function safeRewindAbsolute(value: string): void {
  if (!path.isAbsolute(value) || path.resolve(value) !== value || value === path.parse(value).root
    || Buffer.byteLength(value) > 4_096 || /[\\\u0000-\u001f\u007f]/.test(value)) rewindUnsafe();
}
export const withinRewind = (root: string, value: string): boolean => {
  const relative = path.relative(root, value);
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
export function rewindIdentity(stat: Stats): GitCheckpointFileIdentity {
  return { dev: stat.dev, ino: stat.ino, size: stat.size, mode: stat.mode & 0o777,
    mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
}
export function sameRewindIdentity(actual: Pick<Stats, 'dev' | 'ino'>, expected: GitCheckpointIdentity): boolean {
  return actual.dev === expected.dev && actual.ino === expected.ino;
}
export function sameRewindVersion(actual: GitCheckpointFileIdentity, expected: GitCheckpointFileIdentity, ignoreCtime = false): boolean {
  return sameRewindIdentity(actual, expected) && actual.size === expected.size && actual.mode === expected.mode
    && actual.mtimeMs === expected.mtimeMs && (ignoreCtime || actual.ctimeMs === expected.ctimeMs);
}
export function sameRewindState(actual: GitCheckpointFile, expected: GitCheckpointFile, identity = true, ignoreCtime = false): boolean {
  return actual.kind === expected.kind && (actual.kind === 'missing' || actual.mode === expected.mode
    && actual.bytes === expected.bytes && actual.sha256 === expected.sha256
    && (!identity || !!actual.identity && !!expected.identity && sameRewindVersion(actual.identity, expected.identity, ignoreCtime)));
}
export function missingRewindFile(relative: string): GitCheckpointFile {
  return { path: relative, kind: 'missing', mode: 0, bytes: 0, sha256: null, blob: null, tracked: false };
}
export function validateRewindFile(file: GitCheckpointFile, identity: boolean): void {
  safeRewindRelative(file.path);
  if (!['file', 'symlink', 'missing'].includes(file.kind) || !Number.isSafeInteger(file.bytes) || file.bytes < 0
    || file.bytes > FILE_REWIND_LIMITS.fileBytes || !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777) rewindLimit();
  if (file.kind === 'missing') {
    if (file.bytes !== 0 || file.sha256 !== null || file.blob !== null || file.identity) rewindUnsafe();
    return;
  }
  if (!file.sha256 || !/^[a-f0-9]{64}$/.test(file.sha256) || file.kind === 'symlink' && (file.bytes > 4_096 || file.mode !== 0o777)) rewindUnsafe();
  if (identity && (!file.identity || !Object.values(file.identity).every(Number.isFinite)
    || file.identity.dev < 0 || file.identity.ino < 0 || file.identity.size !== file.bytes || file.identity.mode !== file.mode)) rewindUnsafe();
}

/** A descriptor remains tied to its original canonical directory after an ancestor replacement. */
export class RewindDirectory {
  private constructor(readonly absolute: string, readonly handle: FileHandle, readonly identity: GitCheckpointIdentity) {}
  get access(): string { return `/proc/self/fd/${this.handle.fd}`; }
  static async open(absolute: string, access = absolute, expected?: GitCheckpointIdentity): Promise<RewindDirectory> {
    safeRewindAbsolute(absolute);
    let handle: FileHandle;
    try { handle = await fs.open(access, DIRECTORY_FLAGS); }
    catch (error) { if (isErrno(error, 'ELOOP') || isErrno(error, 'ENOTDIR')) rewindUnsafe(); throw error; }
    try {
      const stat = await handle.stat();
      if (!stat.isDirectory() || expected && !sameRewindIdentity(stat, expected)) rewindUnsafe();
      const directory = new RewindDirectory(absolute, handle, { dev: stat.dev, ino: stat.ino });
      await directory.check();
      return directory;
    } catch (error) { await handle.close(); throw error; }
  }
  async check(): Promise<void> {
    try {
      const stat = await fs.lstat(this.absolute);
      if (!stat.isDirectory() || stat.isSymbolicLink() || !sameRewindIdentity(stat, this.identity)
        || !sameRewindIdentity(await this.handle.stat(), this.identity)
        || await fs.realpath(this.access) !== this.absolute || await fs.realpath(this.absolute) !== this.absolute) rewindUnsafe();
    } catch (error) { if (isErrno(error, 'ENOENT') || isErrno(error, 'ENOTDIR') || isErrno(error, 'ELOOP')) rewindUnsafe(); throw error; }
  }
  async child(name: string, create = false, mode = 0o700): Promise<RewindDirectory> {
    safeRewindName(name); await this.check();
    if (create) await fs.mkdir(`${this.access}/${name}`, { mode });
    const child = await RewindDirectory.open(path.join(this.absolute, name), `${this.access}/${name}`);
    if (child.identity.dev !== this.identity.dev) { await child.close(); rewindUnsafe(); }
    return child;
  }
  async sync(): Promise<void> {
    await this.check();
    try { await this.handle.sync(); }
    catch (error) {
      // Native bucket FUSE need not implement directory fsync. File readback and
      // the caller's required public receipts remain the durability barrier.
      if (!isErrno(error, 'EINVAL') && !isErrno(error, 'ENOTSUP') && !isErrno(error, 'EOPNOTSUPP')) throw error;
    }
  }
  async close(): Promise<void> { await this.handle.close(); }
}

export interface RewindParent { directory: RewindDirectory; name: string; close(): Promise<void> }
export async function rewindParent(root: RewindDirectory, relative: string, options: {
  create?: boolean;
  beforeCreate?: (relative: string) => Promise<void>;
  created?: (relative: string, identity: GitCheckpointIdentity) => Promise<void>;
} = {}): Promise<RewindParent | undefined> {
  safeRewindRelative(relative);
  const opened: RewindDirectory[] = [];
  let current = root;
  try {
    const parts = relative.split('/');
    for (let index = 0; index < parts.length - 1; index++) {
      await current.check();
      const part = parts[index];
      let child: RewindDirectory;
      try { child = await current.child(part); }
      catch (error) {
        if (!isErrno(error, 'ENOENT')) throw error;
        if (!options.create) { for (const directory of opened.reverse()) await directory.close(); return undefined; }
        const createdRelative = parts.slice(0, index + 1).join('/');
        await options.beforeCreate?.(createdRelative); await current.check();
        // EEXIST is a concurrent claim, including a newly created ordinary
        // directory. Do not silently adopt a directory absent from the preview.
        child = await current.child(part, true, 0o755);
        opened.push(child);
        await current.sync();
        await options.created?.(createdRelative, child.identity);
        current = child;
        continue;
      }
      opened.push(child); current = child;
    }
    await root.check(); await current.check();
    return { directory: current, name: parts.at(-1)!, close: async () => { for (const directory of opened.reverse()) await directory.close(); } };
  } catch (error) { for (const directory of opened.reverse()) await directory.close(); throw error; }
}

export interface RewindIOChecks { check(): Promise<void> }
export interface ObservedRewindFile { state: GitCheckpointFile; bytes: Buffer | null }
export async function readRewindEntry(parent: RewindDirectory, name: string, relative: string, checks: RewindIOChecks): Promise<ObservedRewindFile> {
  safeRewindName(name); await checks.check(); await parent.check();
  const access = `${parent.access}/${name}`;
  let before: Stats;
  try { before = await fs.lstat(access); }
  catch (error) { if (isErrno(error, 'ENOENT')) return { state: missingRewindFile(relative), bytes: null }; throw error; }
  if (before.dev !== parent.identity.dev || !before.isFile() && !before.isSymbolicLink()) rewindUnsafe();
  const identity = rewindIdentity(before);
  if (!Number.isSafeInteger(before.size) || before.size > FILE_REWIND_LIMITS.fileBytes || before.size < 0) rewindLimit();
  let bytes: Buffer;
  if (before.isSymbolicLink()) {
    bytes = await fs.readlink(access, { encoding: 'buffer' });
    if (bytes.length > 4_096 || bytes.includes(0)) rewindUnsafe();
  } else {
    const handle = await fs.open(access, READ_FLAGS);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || !sameRewindVersion(rewindIdentity(stat), identity)) rewindConflict();
      bytes = Buffer.allocUnsafe(before.size);
      let offset = 0;
      while (offset < bytes.length) {
        await checks.check();
        const { bytesRead } = await handle.read(bytes, offset, Math.min(FILE_REWIND_LIMITS.bufferBytes, bytes.length - offset), offset);
        if (!bytesRead) rewindConflict();
        offset += bytesRead;
      }
      const tail = Buffer.allocUnsafe(1);
      if ((await handle.read(tail, 0, 1, bytes.length)).bytesRead || !sameRewindVersion(rewindIdentity(await handle.stat()), identity)) rewindConflict();
    } finally { await handle.close(); }
  }
  await parent.check();
  if (bytes.length !== before.size || !sameRewindVersion(rewindIdentity(await fs.lstat(access)), identity)) rewindConflict();
  return { state: { path: relative, kind: before.isSymbolicLink() ? 'symlink' : 'file', mode: before.mode & 0o777,
    bytes: bytes.length, sha256: hashBytes(bytes), blob: null, tracked: false, identity }, bytes };
}

export async function observeRewindPath(root: RewindDirectory, relative: string, checks: RewindIOChecks): Promise<ObservedRewindFile> {
  const parent = await rewindParent(root, relative);
  if (!parent) return { state: missingRewindFile(relative), bytes: null };
  try { return await readRewindEntry(parent.directory, parent.name, relative, checks); }
  finally { await parent.close(); }
}

export async function writeRewindFile(parent: RewindDirectory, name: string, bytes: Buffer, mode: number, checks: RewindIOChecks): Promise<GitCheckpointFile> {
  safeRewindName(name); await checks.check(); await parent.check();
  const handle = await fs.open(`${parent.access}/${name}`, CREATE_FLAGS, 0o600);
  try {
    for (let offset = 0; offset < bytes.length;) {
      await checks.check();
      const { bytesWritten } = await handle.write(bytes, offset, Math.min(FILE_REWIND_LIMITS.bufferBytes, bytes.length - offset), offset);
      if (!bytesWritten) throw new HttpError(507, 'Storage stopped accepting a rewind file. Backups were retained.', 'FILE_REWIND_WRITE_FAILED');
      offset += bytesWritten;
    }
    await handle.chmod(mode); await handle.sync();
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== bytes.length || (stat.mode & 0o777) !== mode) rewindConflict();
    // Read from the still-open descriptor so even a mode-000 destination can be
    // checked before close. Later inaccessible states fail closed, not chmodded.
    const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(FILE_REWIND_LIMITS.bufferBytes);
    let offset = 0;
    while (offset < bytes.length) {
      await checks.check();
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, bytes.length - offset), offset);
      if (!bytesRead) rewindConflict();
      hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
    }
    const sha256 = hash.digest('hex');
    if (sha256 !== hashBytes(bytes)) rewindConflict();
    await parent.check();
    const identity = rewindIdentity(await handle.stat());
    if (!sameRewindVersion(rewindIdentity(await fs.lstat(`${parent.access}/${name}`)), identity)) rewindConflict();
    return { path: name, kind: 'file', mode, bytes: bytes.length, sha256, blob: null, tracked: false, identity };
  } finally { await handle.close(); }
}

export function receiptFor(parent: RewindDirectory, name: string, bytes: Buffer): DurableFileReceipt {
  safeRewindName(name);
  return { absolute: path.join(parent.absolute, name), size: bytes.length, sha256: hashBytes(bytes) };
}

export async function readRewindJSON(parent: RewindDirectory, name: string, maximum = FILE_REWIND_LIMITS.metadataBytes): Promise<unknown> {
  const handle = await fs.open(`${parent.access}/${name}`, READ_FLAGS);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maximum) rewindLimit();
    const buffer = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) rewindConflict();
      offset += bytesRead;
    }
    if (!sameRewindVersion(rewindIdentity(await handle.stat()), rewindIdentity(before))
      || !sameRewindVersion(rewindIdentity(await fs.lstat(`${parent.access}/${name}`)), rewindIdentity(before))) rewindConflict();
    await parent.check();
    return JSON.parse(buffer.toString('utf8'));
  } finally { await handle.close(); }
}
