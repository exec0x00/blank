import { createHash } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { FileEntry } from '../../shared/types';
import { HttpError } from '../errors';
import type { WorkspaceService } from '../workspaces';
import { CONTENT_HASH, UPLOAD_ID, uploadPath } from './validation';

interface Destination {
  parent: FileHandle;
  name: string;
  root: string;
  directory: string;
  namedPath: string;
}

const unsafe = () => new HttpError(403, 'The upload folder changed or contains a symbolic link. Refresh and choose a workspace folder.', 'UNSAFE_PATH');
const exists = () => new HttpError(409, 'A file or folder already exists at this path. Rename it or choose another upload location.', 'FILE_EXISTS');
const interrupted = () => new HttpError(409, 'The upload was interrupted while saving. Check the destination file before trying again.', 'UPLOAD_INTERRUPTED');
const errno = (error: unknown) => (error as NodeJS.ErrnoException)?.code;
const bound = (handle: FileHandle, name?: string) => `/proc/self/fd/${handle.fd}${name === undefined ? '' : `/${name}`}`;

function normalizedError(error: unknown): never {
  if (['ELOOP', 'ENOTDIR'].includes(errno(error) ?? '')) throw unsafe();
  if (errno(error) === 'EEXIST') throw exists();
  if (errno(error) === 'ENOENT') throw new HttpError(404, 'The destination folder no longer exists. Refresh and choose a folder.', 'FILE_NOT_FOUND');
  if (['ENOSPC', 'EDQUOT'].includes(errno(error) ?? '')) throw new HttpError(507, 'The workspace has insufficient storage for this upload.', 'UPLOAD_STORAGE_FULL');
  throw error;
}

async function openParent(workspaces: WorkspaceService, workspaceId: string, input: string): Promise<Destination> {
  const relative = uploadPath(input);
  if (process.platform !== 'linux') throw new HttpError(503, 'Secure file uploads require the Linux host used by this Space.', 'UPLOAD_HOST_UNSUPPORTED');
  const root = await workspaces.resolvePath(workspaceId, '');
  const directory = path.join(root, path.posix.dirname(relative));
  let parent: FileHandle | undefined;
  try {
    parent = await fs.open('/', constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    // Pin every component. A concurrent rename to a symlink cannot redirect subsequent filesystem calls.
    for (const component of directory.split(path.sep).filter(Boolean)) {
      const next = await fs.open(bound(parent, component), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      await parent.close(); parent = next;
    }
    if (await fs.realpath(bound(parent)) !== directory) throw unsafe();
    const name = path.posix.basename(relative);
    return { parent, root, directory, name, namedPath: bound(parent, name) };
  } catch (error) {
    await parent?.close().catch(() => undefined);
    normalizedError(error);
  }
}

async function assertUnchanged(workspaces: WorkspaceService, workspaceId: string, destination: Destination): Promise<void> {
  if (await workspaces.resolvePath(workspaceId, '') !== destination.root
    || await fs.realpath(bound(destination.parent)) !== destination.directory
    || await fs.realpath(destination.directory) !== destination.directory) throw unsafe();
  const named = await fs.lstat(destination.directory, { bigint: true });
  const pinned = await destination.parent.stat({ bigint: true });
  if (!named.isDirectory() || named.isSymbolicLink() || named.dev !== pinned.dev || named.ino !== pinned.ino) throw unsafe();
}

async function assertMissing(destination: Destination): Promise<void> {
  try {
    const stat = await fs.lstat(destination.namedPath);
    if (stat.isSymbolicLink()) throw unsafe();
    throw exists();
  } catch (error) { if (errno(error) !== 'ENOENT') throw error; }
}

export async function validateUploadDestination(workspaces: WorkspaceService, workspaceId: string, input: string): Promise<void> {
  let destination: Destination | undefined;
  try {
    destination = await openParent(workspaces, workspaceId, input);
    await assertMissing(destination);
    await assertUnchanged(workspaces, workspaceId, destination);
  } catch (error) { return normalizedError(error); }
  finally { await destination?.parent.close().catch(() => undefined); }
}

function sameFile(before: BigIntStats, after: BigIntStats): boolean {
  return before.isFile() && after.isFile() && before.dev === after.dev && before.ino === after.ino
    && before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
}

async function verifyCreatedFile(destination: Destination, size: number, sha256: string): Promise<BigIntStats> {
  let file: FileHandle | undefined;
  try {
    const named = await fs.lstat(destination.namedPath, { bigint: true });
    if (!named.isFile() || named.isSymbolicLink() || named.size !== BigInt(size)) throw interrupted();
    file = await fs.open(destination.namedPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await file.stat({ bigint: true });
    if (!sameFile(named, before)) throw interrupted();
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let total = 0;
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, size + 1 - total), total);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > size) throw interrupted();
      hash.update(buffer.subarray(0, bytesRead));
    }
    if (total !== size || hash.digest('hex') !== sha256
      || !sameFile(before, await file.stat({ bigint: true }))
      || !sameFile(before, await fs.lstat(destination.namedPath, { bigint: true }))) throw interrupted();
    return before;
  } finally { await file?.close().catch(() => undefined); }
}

function entryOf(input: string, stat: BigIntStats): FileEntry {
  return { name: path.posix.basename(input), path: input, kind: 'file', size: Number(stat.size), modifiedAt: stat.mtime.toISOString() };
}

const temporaryName = (id: string) => {
  if (!UPLOAD_ID.test(id)) throw new HttpError(400, 'Invalid upload session.', 'UPLOAD_NOT_FOUND');
  return `.codex-write-upload-${id}`;
};

/**
 * Staging and final creation use the pinned parent FD. COPYFILE_EXCL works on the native bucket
 * volume where hard links are unsupported, and never replaces a late editor/agent/terminal file.
 * The caller persists commit intent before creation. Cancellation after that point awaits the result.
 */
export async function installUploadFile(input: {
  workspaces: WorkspaceService;
  workspaceId: string;
  path: string;
  id: string;
  bytes: Buffer;
  sha256: string;
  signal: AbortSignal;
  beforeCommit: () => Promise<void>;
}): Promise<FileEntry> {
  if (!CONTENT_HASH.test(input.sha256) || createHash('sha256').update(input.bytes).digest('hex') !== input.sha256) {
    throw new HttpError(409, 'The transferred file does not match the selected file. Upload it again.', 'UPLOAD_CONTENT_MISMATCH');
  }
  let destination: Destination | undefined;
  let temporary: string | undefined;
  let file: FileHandle | undefined;
  let temporaryIdentity: BigIntStats | undefined;
  try {
    input.signal.throwIfAborted();
    destination = await openParent(input.workspaces, input.workspaceId, input.path);
    await assertMissing(destination);
    temporary = bound(destination.parent, temporaryName(input.id));
    await assertUnchanged(input.workspaces, input.workspaceId, destination);
    file = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    temporaryIdentity = await file.stat({ bigint: true });
    await file.writeFile(input.bytes);
    await file.chmod(0o644);
    input.signal.throwIfAborted();
    await assertUnchanged(input.workspaces, input.workspaceId, destination);
    await assertMissing(destination);
    await input.beforeCommit();
    // No asynchronous abort after this boundary: DELETE must report the actual saved result.
    await assertUnchanged(input.workspaces, input.workspaceId, destination);
    await fs.copyFile(bound(file), destination.namedPath, constants.COPYFILE_EXCL);
    const stat = await verifyCreatedFile(destination, input.bytes.length, input.sha256);
    await assertUnchanged(input.workspaces, input.workspaceId, destination);
    return entryOf(input.path, stat);
  } catch (error) { return normalizedError(error); }
  finally {
    if (temporary && temporaryIdentity) {
      await fs.lstat(temporary, { bigint: true }).then(async current => {
        if (current.dev === temporaryIdentity!.dev && current.ino === temporaryIdentity!.ino && current.isFile()) await fs.unlink(temporary!);
      }).catch(() => undefined);
    }
    await file?.close().catch(() => undefined);
    await destination?.parent.close().catch(() => undefined);
  }
}

/** On restart, never replay a write. Reconcile only an exact completed file from persisted intent. */
export async function recoverUploadedFile(workspaces: WorkspaceService, workspaceId: string, input: string, size: number, sha256: string): Promise<FileEntry | undefined> {
  let destination: Destination | undefined;
  try {
    destination = await openParent(workspaces, workspaceId, input);
    try { await fs.lstat(destination.namedPath); }
    catch (error) { if (errno(error) === 'ENOENT') return undefined; throw error; }
    const stat = await verifyCreatedFile(destination, size, sha256);
    await assertUnchanged(workspaces, workspaceId, destination);
    return entryOf(input, stat);
  } catch (error) { return normalizedError(error); }
  finally { await destination?.parent.close().catch(() => undefined); }
}

export async function cleanUploadTemporary(workspaces: WorkspaceService, workspaceId: string, input: string, id: string): Promise<void> {
  let destination: Destination | undefined;
  try {
    destination = await openParent(workspaces, workspaceId, input);
    const temporary = bound(destination.parent, temporaryName(id));
    const stat = await fs.lstat(temporary);
    if (!stat.isFile() || stat.isSymbolicLink()) return;
    await assertUnchanged(workspaces, workspaceId, destination);
    await fs.unlink(temporary);
  } catch { /* Missing/changed/archived folders must not authorize cleanup outside the original location. */ }
  finally { await destination?.parent.close().catch(() => undefined); }
}
