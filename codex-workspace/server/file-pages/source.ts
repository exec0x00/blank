import { createHash } from 'node:crypto';
import { constants, promises as fs, type BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { AppContext } from '../context';
import { HttpError } from '../errors';
import { FILE_PAGE_READ_BYTES } from './limits';
import { conflict, filePagePath } from './validation';

const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const DIRECTORY_FLAGS = READ_FLAGS | constants.O_DIRECTORY;
export const CREATE_FLAGS = constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
export const errno = (error: unknown, code: string): boolean => !!error && typeof error === 'object' && 'code' in error && error.code === code;
const inside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return !!relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

function unsafe(): never {
  throw new HttpError(403, 'The file path contains an unsafe link or changed directory. Refresh before continuing.', 'UNSAFE_PATH');
}

export function nativeFileError(error: unknown, opened = false): never {
  if (error instanceof HttpError) throw error;
  if (errno(error, 'ENOENT')) {
    if (opened) conflict('This file was moved or deleted. Keep your edits and reopen the current file.');
    throw new HttpError(404, 'File not found.', 'FILE_NOT_FOUND');
  }
  if (errno(error, 'ELOOP') || errno(error, 'ENOTDIR')) unsafe();
  if (errno(error, 'EACCES') || errno(error, 'EPERM')) throw new HttpError(403, 'The host does not allow access to this file.', 'FILE_PERMISSION_DENIED');
  if (errno(error, 'ENOSPC') || errno(error, 'EDQUOT')) throw new HttpError(507, 'There is not enough storage space to save this file. Keep your edits and free space before retrying.', 'FILE_STORAGE_FULL');
  throw error;
}

export function nativeIdentity(stat: BigIntStats): string {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.mode].map(String).join(':');
}

export class FileDirectory {
  private constructor(readonly absolute: string, readonly handle: FileHandle, readonly initial: BigIntStats) {}
  get access(): string { return `/proc/self/fd/${this.handle.fd}`; }

  static async open(absolute: string, access = absolute): Promise<FileDirectory> {
    const handle = await fs.open(access, DIRECTORY_FLAGS);
    try {
      const stat = await handle.stat({ bigint: true });
      if (!stat.isDirectory()) unsafe();
      const directory = new FileDirectory(absolute, handle, stat);
      await directory.check();
      return directory;
    } catch (error) { await handle.close(); throw error; }
  }

  async check(): Promise<void> {
    if (await fs.realpath(this.access) !== this.absolute) conflict('A parent folder moved. Keep your edits and reopen the file.');
    const current = await fs.lstat(this.absolute, { bigint: true });
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== this.initial.dev || current.ino !== this.initial.ino) unsafe();
  }
}

/** Each request pins descriptors; nothing keeps giant file handles or file bodies in a cache. */
export class FileSource {
  readonly path: string;
  readonly size: number;
  readonly version: string;
  readonly binding: string;
  readonly canonicalPath: string;
  readonly sourceIdentity: string;
  get parent(): FileDirectory { return this.directories[this.directories.length - 1]!; }
  get access(): string { return `${this.parent.access}/${path.basename(this.absolute)}`; }

  private constructor(private readonly ctx: AppContext, readonly workspaceId: string, relative: string,
    readonly absolute: string, readonly root: string, private readonly directories: FileDirectory[],
    readonly handle: FileHandle, readonly initial: BigIntStats, readonly signal?: AbortSignal) {
    this.path = relative;
    this.size = Number(initial.size);
    this.sourceIdentity = nativeIdentity(initial);
    this.canonicalPath = path.relative(root, absolute).split(path.sep).join('/');
    this.binding = createHash('sha256').update(JSON.stringify([workspaceId, this.path, this.canonicalPath,
      String(directories[0]!.initial.dev), String(directories[0]!.initial.ino)])).digest('hex');
    this.version = createHash('sha256').update(`file-page-v1\0${this.binding}\0${this.sourceIdentity}`).digest('hex');
  }

  static async open(ctx: AppContext, workspaceId: string, input: unknown, expectedVersion?: string, signal?: AbortSignal): Promise<FileSource> {
    signal?.throwIfAborted();
    const relative = filePagePath(input);
    if (process.platform !== 'linux') throw new HttpError(503, 'Secure file paging requires the Linux host used by this Space.', 'FILE_PAGES_HOST_UNSUPPORTED');
    const directories: FileDirectory[] = [];
    let handle: FileHandle | undefined;
    try {
      const root = await ctx.workspaces.resolvePath(workspaceId, '');
      signal?.throwIfAborted();
      const absolute = await ctx.workspaces.resolvePath(workspaceId, relative);
      signal?.throwIfAborted();
      if (!inside(root, absolute)) unsafe();
      const parts = path.relative(root, absolute).split(path.sep);
      if (parts.length > 96) throw new HttpError(400, 'This file is nested too deeply.', 'INVALID_PATH');
      directories.push(await FileDirectory.open(root));
      for (const name of parts.slice(0, -1)) {
        signal?.throwIfAborted();
        const parent = directories[directories.length - 1]!;
        await parent.check();
        signal?.throwIfAborted();
        directories.push(await FileDirectory.open(path.join(parent.absolute, name), `${parent.access}/${name}`));
      }
      signal?.throwIfAborted();
      const parent = directories[directories.length - 1]!;
      await parent.check();
      signal?.throwIfAborted();
      const access = `${parent.access}/${parts[parts.length - 1]}`;
      const named = await fs.lstat(access, { bigint: true });
      if (!named.isFile() || named.isSymbolicLink()) throw new HttpError(400, 'Choose a regular file.', 'NOT_A_FILE');
      signal?.throwIfAborted();
      handle = await fs.open(access, READ_FLAGS);
      signal?.throwIfAborted();
      const stat = await handle.stat({ bigint: true });
      if (!stat.isFile()) throw new HttpError(400, 'Choose a regular file.', 'NOT_A_FILE');
      if (nativeIdentity(named) !== nativeIdentity(stat)) conflict('The file changed while it was opening. Reopen it before continuing.');
      if (stat.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new HttpError(413, 'This file is too large to address safely in the browser.', 'FILE_TOO_LARGE');
      const source = new FileSource(ctx, workspaceId, relative, absolute, root, directories, handle, stat, signal);
      if (expectedVersion !== undefined && expectedVersion !== source.version) conflict();
      await source.check();
      return source;
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await Promise.allSettled(directories.map(directory => directory.handle.close()));
      if (expectedVersion !== undefined && (errno(error, 'ENOENT') || error instanceof HttpError && error.status === 404)) conflict();
      return nativeFileError(error);
    }
  }

  /** Metadata, path identity, and both live and pinned descriptors must still agree. */
  async check(): Promise<void> {
    try {
      this.signal?.throwIfAborted();
      for (const directory of this.directories) { this.signal?.throwIfAborted(); await directory.check(); }
      this.signal?.throwIfAborted();
      if (await this.ctx.workspaces.resolvePath(this.workspaceId, '') !== this.root
        || await this.ctx.workspaces.resolvePath(this.workspaceId, this.path) !== this.absolute
        || await fs.realpath(`/proc/self/fd/${this.handle.fd}`) !== this.absolute) conflict();
      const [pinned, current] = await Promise.all([this.handle.stat({ bigint: true }), fs.lstat(this.access, { bigint: true })]);
      this.signal?.throwIfAborted();
      if (!pinned.isFile() || !current.isFile() || current.isSymbolicLink()
        || nativeIdentity(pinned) !== this.sourceIdentity || nativeIdentity(current) !== this.sourceIdentity) conflict();
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) conflict('This file or its workspace was moved or deleted. Keep your edits and reopen the current file.');
      nativeFileError(error, true);
    }
  }

  async read(offset: number, length: number): Promise<Buffer> {
    this.signal?.throwIfAborted();
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > this.size || !Number.isSafeInteger(length)
      || length < 0 || length > FILE_PAGE_READ_BYTES) throw new Error('File page read exceeds its bounded window.');
    const bytes = Buffer.allocUnsafe(Math.min(length, this.size - offset));
    let read = 0;
    while (read < bytes.length) {
      this.signal?.throwIfAborted();
      const result = await this.handle.read(bytes, read, bytes.length - read, offset + read);
      this.signal?.throwIfAborted();
      if (!result.bytesRead) conflict('The file was truncated while reading. Reload it before continuing.');
      read += result.bytesRead;
    }
    return bytes;
  }

  async close(): Promise<void> {
    await this.handle.close().catch(() => undefined);
    await Promise.allSettled(this.directories.map(directory => directory.handle.close()));
  }
}
