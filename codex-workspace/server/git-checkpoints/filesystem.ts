import { constants, type Stats } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { HttpError } from '../errors';
import type { GitCheckpointFile, GitCheckpointFileIdentity, GitCheckpointIdentity } from './types';

const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
export const digest = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
export const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
export function changed(): never { throw new HttpError(409, 'Files or repository metadata changed while their checkpoint was being read. No files were restored.', 'CHECKPOINT_CHANGED'); }
export function unsafe(): never { throw new HttpError(409, 'The checkpoint contains an unsafe filesystem path or alias. No files were changed.', 'CHECKPOINT_UNSAFE_PATH'); }
export function limit(): never { throw new HttpError(413, 'This repository exceeds the bounded file checkpoint budget. Conversation history remains available.', 'CHECKPOINT_LIMIT'); }
export function relativePath(value: string, metadata = false): string {
  if (typeof value !== 'string' || !value || value.length > 4096 || Buffer.byteLength(value) > 4096 || /[\\\u0000-\u001f\u007f]/.test(value) || /^[a-z]:/i.test(value)
    || path.posix.isAbsolute(value) || value.split('/').length > 64
    || value.split('/').some(part => !part || part === '.' || part === '..' || !metadata && part.toLowerCase() === '.git')) unsafe();
  return value;
}
export const identity = (stat: Stats): GitCheckpointIdentity => ({ dev: stat.dev, ino: stat.ino });
export const fileIdentity = (stat: Stats): GitCheckpointFileIdentity => ({ ...identity(stat), size: stat.size, mode: stat.mode & 0o777, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs });
export const sameIdentity = (a: GitCheckpointIdentity, b: GitCheckpointIdentity): boolean => a.dev === b.dev && a.ino === b.ino;
export const sameFile = (a: GitCheckpointFileIdentity, b: GitCheckpointFileIdentity): boolean => sameIdentity(a, b)
  && a.size === b.size && a.mode === b.mode && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

/** Every traversal uses pinned directory descriptors; exchanged ancestor symlinks are never followed. */
export class CheckpointDirectory {
  private constructor(readonly absolute: string, readonly handle: FileHandle, readonly initial: GitCheckpointIdentity) {}
  get access(): string { return `/proc/self/fd/${this.handle.fd}`; }
  static async open(absolute: string, access = absolute): Promise<CheckpointDirectory> {
    if (!path.isAbsolute(absolute) || path.resolve(absolute) !== absolute || absolute.includes('\0')) unsafe();
    let handle: FileHandle;
    try { handle = await fs.open(access, DIRECTORY_FLAGS); }
    catch (error) { if (['ELOOP', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) unsafe(); throw error; }
    try {
      const stat = await handle.stat();
      if (!stat.isDirectory()) unsafe();
      const directory = new CheckpointDirectory(absolute, handle, identity(stat));
      await directory.check();
      return directory;
    } catch (error) { await handle.close(); throw error; }
  }
  static async absolute(absolute: string, create = false): Promise<CheckpointDirectory> {
    if (!path.isAbsolute(absolute) || path.resolve(absolute) !== absolute || absolute.length > 4096) unsafe();
    let current = await CheckpointDirectory.open(path.parse(absolute).root);
    try {
      for (const name of path.relative(current.absolute, absolute).split(path.sep).filter(Boolean)) {
        const next = await current.child(name, create);
        await current.close(); current = next;
      }
      return current;
    } catch (error) { await current.close(); throw error; }
  }
  async check(): Promise<void> {
    if (await fs.realpath(this.access) !== this.absolute) changed();
    const stat = await fs.lstat(this.absolute);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !sameIdentity(stat, this.initial)) changed();
  }
  async child(name: string, create = false): Promise<CheckpointDirectory> {
    if (name.includes('/') || name === '.' || name === '..' || !name || name.includes('\0')) unsafe();
    await this.check();
    const access = `${this.access}/${name}`;
    if (create) await fs.mkdir(access, { mode: 0o700 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
    const next = await CheckpointDirectory.open(path.join(this.absolute, name), access);
    try { await this.check(); return next; }
    catch (error) { await next.close(); throw error; }
  }
  async withParent<T>(relative: string, create: boolean, work: (parent: CheckpointDirectory, name: string) => Promise<T>): Promise<T> {
    relativePath(relative, true);
    const opened: CheckpointDirectory[] = [];
    let current: CheckpointDirectory = this;
    const parts = relative.split('/');
    try {
      for (const name of parts.slice(0, -1)) { current = await current.child(name, create); opened.push(current); }
      await this.check(); await current.check();
      return await work(current, parts.at(-1)!);
    } finally { for (const directory of opened.reverse()) await directory.close(); }
  }
  async close(): Promise<void> { await this.handle.close(); }
}

export async function readRegular(root: CheckpointDirectory, relative: string, maximum: number): Promise<Buffer | null> {
  return root.withParent(relative, false, async (parent, name) => {
    let handle: FileHandle;
    try { handle = await fs.open(`${parent.access}/${name}`, READ_FLAGS); }
    catch (error) { if (missing(error)) return null; if ((error as NodeJS.ErrnoException).code === 'ELOOP') unsafe(); throw error; }
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1) unsafe();
      if (stat.size > maximum) limit();
      const bytes = await readHandle(handle, stat.size, maximum);
      if (!sameFile(fileIdentity(stat), fileIdentity(await handle.stat()))) changed();
      await root.check(); await parent.check();
      const after = await fs.lstat(`${parent.access}/${name}`);
      if (!after.isFile() || !sameFile(fileIdentity(stat), fileIdentity(after))) changed();
      return bytes;
    } finally { await handle.close(); }
  });
}
async function readHandle(handle: FileHandle, length: number, maximum: number): Promise<Buffer> {
  const bytes = Buffer.alloc(Math.min(length + 1, maximum + 1));
  let total = 0;
  while (total < bytes.length) {
    const { bytesRead } = await handle.read(bytes, total, Math.min(256 * 1024, bytes.length - total), null);
    if (!bytesRead) break;
    total += bytesRead;
  }
  if (total > maximum) limit();
  if (total !== length) changed();
  return bytes.subarray(0, total);
}

export async function readWorkingFile(root: CheckpointDirectory, relative: string, tracked: boolean, maximum: number): Promise<{ entry: GitCheckpointFile; bytes: Buffer | null }> {
  relativePath(relative);
  try {
    return await root.withParent(relative, false, async (parent, name) => {
      const access = `${parent.access}/${name}`;
      const stat = await fs.lstat(access).catch(error => { if (missing(error)) return null; throw error; });
      if (!stat) return { entry: { path: relative, kind: 'missing', mode: 0, bytes: 0, sha256: null, blob: null, tracked }, bytes: null };
      if (!stat.isFile() && !stat.isSymbolicLink()) throw new HttpError(409, 'Nested repositories, submodules and special files cannot be captured by file checkpoints.', 'CHECKPOINT_UNSUPPORTED_FILE');
      if (stat.mode & 0o7000) throw new HttpError(409, 'Files with special permission bits need manual Git recovery; this checkpoint preserves ordinary permission bits only.', 'CHECKPOINT_UNSUPPORTED_MODE');
      if (stat.nlink !== 1) throw new HttpError(409, 'Hard-linked files require manual Git recovery; a checkpoint would not preserve their link relationship.', 'CHECKPOINT_HARD_LINK');
      if (stat.size > maximum) limit();
      let bytes: Buffer;
      if (stat.isSymbolicLink()) bytes = await fs.readlink(access, { encoding: 'buffer' });
      else {
        const handle = await fs.open(access, READ_FLAGS);
        try {
          const opened = await handle.stat();
          if (!opened.isFile() || !sameFile(fileIdentity(stat), fileIdentity(opened))) changed();
          bytes = await readHandle(handle, opened.size, maximum);
          if (!sameFile(fileIdentity(stat), fileIdentity(await handle.stat()))) changed();
        } finally { await handle.close(); }
      }
      if (bytes.length > maximum) limit();
      await root.check(); await parent.check();
      const after = await fs.lstat(access);
      if (!sameFile(fileIdentity(stat), fileIdentity(after)) || after.isSymbolicLink() !== stat.isSymbolicLink()) changed();
      return { entry: { path: relative, kind: stat.isSymbolicLink() ? 'symlink' : 'file', mode: stat.mode & 0o777,
        bytes: bytes.length, sha256: digest(bytes), blob: null, tracked, identity: fileIdentity(stat) }, bytes };
    });
  } catch (error) {
    // Only genuinely absent ancestors are missing. Symlink/non-directory ancestors fail closed.
    if (missing(error)) return { entry: { path: relative, kind: 'missing', mode: 0, bytes: 0, sha256: null, blob: null, tracked }, bytes: null };
    throw error;
  }
}

export async function verifyWorkingIdentity(root: CheckpointDirectory, entry: GitCheckpointFile): Promise<void> {
  try {
    await root.withParent(entry.path, false, async (parent, name) => {
      const stat = await fs.lstat(`${parent.access}/${name}`).catch(error => { if (missing(error)) return null; throw error; });
      if (entry.kind === 'missing') { if (stat) changed(); return; }
      if (!stat || !entry.identity || !sameFile(fileIdentity(stat), entry.identity)
        || stat.isSymbolicLink() !== (entry.kind === 'symlink') || stat.isFile() !== (entry.kind === 'file')) changed();
      await parent.check();
    });
  } catch (error) { if (entry.kind === 'missing' && missing(error)) return; throw error; }
}

/** Exclusive writes only. Immutable Git objects and metadata are never overwritten. */
export async function writeExclusive(root: CheckpointDirectory, relative: string, bytes: Buffer | string): Promise<void> {
  await root.withParent(relative, true, async (parent, name) => {
    const file = await fs.open(`${parent.access}/${name}`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(bytes); await file.sync(); }
    finally { await file.close(); }
    await parent.check(); await root.check();
  });
}
