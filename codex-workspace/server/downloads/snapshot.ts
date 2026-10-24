import { createHash } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceService } from '../workspaces';
import { HttpError } from '../errors';

export const SNAPSHOT_CHUNK_BYTES = 256 * 1024;
export const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024 * 1024;

export interface DownloadSource {
  handle: FileHandle;
  parent: FileHandle;
  name: string;
  stat: BigIntStats;
  size: number;
  close(): Promise<void>;
}

const changed = () => new HttpError(409, 'This file changed while its download was being prepared. Save it and try again.', 'DOWNLOAD_FILE_CHANGED');
const unsafe = () => new HttpError(403, 'The file path changed or points outside this workspace. Refresh and try again.', 'UNSAFE_PATH');

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function equalVersion(a: BigIntStats, b: BigIntStats): boolean {
  return a.isFile() && b.isFile() && a.dev === b.dev && a.ino === b.ino && a.size === b.size
    && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

function normalizeError(error: unknown): never {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ELOOP' || code === 'ENOTDIR') throw unsafe();
  if (code === 'ENOENT') throw new HttpError(404, 'The selected file no longer exists.', 'FILE_NOT_FOUND');
  throw error;
}

/** Recheck a trusted server-supplied descriptor without accepting or reopening a caller path. */
export async function validateDownloadSource(source: DownloadSource): Promise<void> {
  if (!Number.isSafeInteger(source.size) || source.size < 0 || source.size > MAX_DOWNLOAD_BYTES) {
    throw new HttpError(413, 'This file exceeds the 20 GB download limit.', 'DOWNLOAD_TOO_LARGE');
  }
  if (typeof source.name !== 'string' || !source.name || source.name === '.' || source.name === '..'
    || /[\\/\u0000-\u001f\u007f]/.test(source.name) || Buffer.byteLength(source.name) > 255
    || !source.stat.isFile() || source.stat.size !== BigInt(source.size)) throw changed();
  try {
    const [file, parent, named] = await Promise.all([
      source.handle.stat({ bigint: true }), source.parent.stat({ bigint: true }),
      fs.lstat(`/proc/self/fd/${source.parent.fd}/${source.name}`, { bigint: true }),
    ]);
    if (!parent.isDirectory() || !equalVersion(source.stat, file) || !equalVersion(source.stat, named)) throw changed();
  } catch (error) { normalizeError(error); }
}

/**
 * Bind every directory component with O_NOFOLLOW, using Linux's already available /proc FD paths
 * as openat-style paths. Merely adding O_NOFOLLOW to the final filename does not stop a parent
 * directory being replaced with a symlink between WorkspaceService validation and open().
 * This neither mounts a filesystem nor reads bytes from a source before it has been validated.
 */
export async function openDownloadSource(workspaces: WorkspaceService, workspaceId: string, relativePath: string): Promise<DownloadSource> {
  const [root, target] = await Promise.all([
    workspaces.resolvePath(workspaceId, ''), workspaces.resolvePath(workspaceId, relativePath),
  ]);
  if (!within(root, target)) throw new HttpError(400, 'Choose a regular file inside this workspace.', 'NOT_A_FILE');
  if (process.platform !== 'linux') {
    throw new HttpError(503, 'Secure file downloads require the Linux host used by this Space.', 'DOWNLOAD_HOST_UNSUPPORTED');
  }
  let directory: FileHandle | undefined;
  let file: FileHandle | undefined;
  try {
    directory = await fs.open('/', constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const parts = path.resolve(target).split(path.sep).filter(Boolean);
    const name = parts.pop()!;
    for (const part of parts) {
      const next = await fs.open(`/proc/self/fd/${directory.fd}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      await directory.close();
      directory = next;
    }
    const boundPath = `/proc/self/fd/${directory.fd}/${name}`;
    const before = await fs.lstat(boundPath, { bigint: true });
    if (!before.isFile()) throw new HttpError(400, 'Only regular files can be downloaded.', 'NOT_A_FILE');
    file = await fs.open(boundPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat({ bigint: true });
    if (!equalVersion(before, stat)) throw changed();
    if (stat.size > BigInt(MAX_DOWNLOAD_BYTES)) throw new HttpError(413, 'This file exceeds the 20 GB download limit.', 'DOWNLOAD_TOO_LARGE');
    const finalRealPath = await fs.realpath(`/proc/self/fd/${file.fd}`);
    if (!within(root, finalRealPath) || finalRealPath !== target) throw unsafe();
    const parent = directory;
    const handle = file;
    let closed = false;
    return {
      handle, parent, name, stat, size: Number(stat.size),
      async close() {
        if (closed) return;
        closed = true;
        await Promise.allSettled([handle.close(), parent.close()]);
      },
    };
  } catch (error) {
    await Promise.allSettled([file?.close(), directory?.close()]);
    normalizeError(error);
  }
}

/** Copy and hash one immutable snapshot using a fixed buffer, including version checks on both ends. */
export async function snapshotDownloadSource(input: {
  source: DownloadSource;
  destination: string;
  expectedVersion?: string;
  signal: AbortSignal;
  onProgress?: (bytes: number) => void;
}): Promise<{ version: string; size: number }> {
  const { source, destination, signal } = input;
  let output: FileHandle | undefined;
  try {
    signal.throwIfAborted();
    if (!Number.isSafeInteger(source.size) || source.size < 0 || source.size > MAX_DOWNLOAD_BYTES
      || source.stat.size !== BigInt(source.size)) throw changed();
    if (!equalVersion(source.stat, await source.handle.stat({ bigint: true }))) throw changed();
    output = await fs.open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const buffer = Buffer.allocUnsafe(SNAPSHOT_CHUNK_BYTES);
    const hash = createHash('sha256');
    let total = 0;
    while (true) {
      signal.throwIfAborted();
      const { bytesRead } = await source.handle.read(buffer, 0, buffer.length, total);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > source.size || total > MAX_DOWNLOAD_BYTES) throw changed();
      hash.update(buffer.subarray(0, bytesRead));
      let written = 0;
      while (written < bytesRead) {
        signal.throwIfAborted();
        const part = await output.write(buffer, written, bytesRead - written, null);
        if (part.bytesWritten === 0) throw new HttpError(507, 'The instance has insufficient temporary storage for this download.', 'DOWNLOAD_STORAGE_FULL');
        written += part.bytesWritten;
      }
      input.onProgress?.(total);
    }
    signal.throwIfAborted();
    const version = hash.digest('hex');
    if (input.expectedVersion && input.expectedVersion !== version) {
      throw new HttpError(409, 'The saved file differs from the version selected for download. Refresh it and try again.', 'VERSION_CONFLICT');
    }
    // Native bucket volumes and some host filesystems can reuse timestamps for multiple writes in
    // one tick. A second bounded pass proves the captured bytes still match the bound source; stat
    // checks alone would accept a mixed snapshot after a same-size write with unchanged timestamps.
    const verified = createHash('sha256');
    let verifiedBytes = 0;
    while (true) {
      signal.throwIfAborted();
      const { bytesRead } = await source.handle.read(buffer, 0, buffer.length, verifiedBytes);
      if (bytesRead === 0) break;
      verifiedBytes += bytesRead;
      if (verifiedBytes > source.size) throw changed();
      verified.update(buffer.subarray(0, bytesRead));
    }
    const [after, named] = await Promise.all([
      source.handle.stat({ bigint: true }), fs.lstat(`/proc/self/fd/${source.parent.fd}/${source.name}`, { bigint: true }),
    ]);
    if (total !== source.size || verifiedBytes !== total || verified.digest('hex') !== version
      || !equalVersion(source.stat, after) || !equalVersion(source.stat, named)) throw changed();
    await output.close();
    output = undefined;
    // read-only after completion; Node openAsBlob additionally checks for modifications on every read.
    await fs.chmod(destination, 0o400);
    return { version, size: total };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOSPC') {
      throw new HttpError(507, 'The instance has insufficient temporary storage for this download.', 'DOWNLOAD_STORAGE_FULL');
    }
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') throw changed();
    throw error;
  } finally {
    await output?.close().catch(() => undefined);
    await source.close();
  }
}
