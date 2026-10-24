import { randomUUID, createHash } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { AppContext } from '../context';
import { HttpError } from '../errors';
import { withWorkspaceFileMutation } from '../file-transfers/queue';
import { prepareRuntimeStorage } from '../runtime-storage';
import { uploadPath } from '../uploads/validation';
import { acquireWorkspaceActivity } from '../worktrees/activity';
import type { FileAttachment, FileAttachmentCopy, FileAttachmentCopyOptions } from './types';
import { attachmentChanged, attachmentHash } from './validation';
import { assertConversationWorkspaceUnfenced, conversationFileScope } from './coordination';

const FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const sameFile = (a: BigIntStats, b: BigIntStats): boolean => a.isFile() && b.isFile() && a.dev === b.dev && a.ino === b.ino
  && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
const unsafe = (): HttpError => new HttpError(403, 'The destination changed or contains a symbolic link. Choose a saved workspace folder.', 'UNSAFE_PATH');

async function openDirectory(absolute: string): Promise<FileHandle> {
  let parent = await fs.open('/', FLAGS);
  try {
    for (const part of absolute.split(path.sep).filter(Boolean)) {
      const next = await fs.open(`/proc/self/fd/${parent.fd}/${part}`, FLAGS);
      await parent.close(); parent = next;
    }
    if (await fs.realpath(`/proc/self/fd/${parent.fd}`) !== absolute) throw unsafe();
    return parent;
  } catch (error) { await parent.close(); throw error; }
}

async function verify(handle: FileHandle, expectedSize: number, expectedHash: string): Promise<BigIntStats> {
  const before = await handle.stat({ bigint: true });
  if (!before.isFile() || before.size !== BigInt(expectedSize)) throw attachmentChanged();
  const buffer = Buffer.allocUnsafe(64 * 1024), hash = createHash('sha256');
  let total = 0;
  while (total <= expectedSize) {
    const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, expectedSize + 1 - total), total);
    if (!bytesRead) break;
    total += bytesRead;
    if (total > expectedSize) throw attachmentChanged();
    hash.update(buffer.subarray(0, bytesRead));
  }
  if (total !== expectedSize || hash.digest('hex') !== expectedHash || !sameFile(before, await handle.stat({ bigint: true }))) throw attachmentChanged();
  return before;
}

/**
 * Process an owned copy outside /data, then create one durable workspace file.
 * Never overwrite a destination, execute contents, or remove a partial durable
 * output after an uncertain failure. Only this operation's scratch is cleaned.
 */
export async function copyConversationFile(ctx: AppContext, workspaceId: string, attachment: FileAttachment, original: Buffer,
  destination: string, options: FileAttachmentCopyOptions = {}): Promise<FileAttachmentCopy> {
  const relative = uploadPath(destination);
  const scope = conversationFileScope(ctx.config.stateDir);
  assertConversationWorkspaceUnfenced(scope, workspaceId);
  if (/^[a-z][a-z0-9+.-]*:/i.test(relative)) throw new HttpError(400, 'Choose a relative workspace path.', 'INVALID_PATH');
  if (attachment.workspaceId !== workspaceId || original.length !== attachment.bytes || attachmentHash(original) !== attachment.sha256) throw attachmentChanged();
  const signal = options.signal ?? new AbortController().signal;
  signal.throwIfAborted();
  const release = acquireWorkspaceActivity(ctx.config.workspacesDir, workspaceId, 'files');
  let scratchParent: FileHandle | undefined, scratch: FileHandle | undefined, parent: FileHandle | undefined, output: FileHandle | undefined;
  let scratchIdentity: BigIntStats | undefined, committed = false;
  const operationId = randomUUID(), scratchName = `.conversation-file-${operationId}.copy`;
  const intent = { workspaceId, operationId, paths: [relative] };
  let manual = false;
  try {
    await ctx.workspaces.get(workspaceId);
    const runtime = await prepareRuntimeStorage(ctx.config);
    scratchParent = await openDirectory(runtime.temporaryDir);
    const scratchPath = `/proc/self/fd/${scratchParent.fd}/${scratchName}`;
    scratch = await fs.open(scratchPath, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    scratchIdentity = await scratch.stat({ bigint: true });
    await scratch.writeFile(original); await scratch.sync();
    scratchIdentity = await verify(scratch, attachment.bytes, attachment.sha256);
    signal.throwIfAborted();
    return await withWorkspaceFileMutation(ctx.config.workspacesDir, workspaceId, async () => {
      // Destination resolution and all native writes run in the same queue as
      // editor saves, transfers and imports. Read/resolve calls do not reenter it.
      signal.throwIfAborted();
      const root = await ctx.workspaces.resolvePath(workspaceId, '');
      const destinationDirectory = path.join(root, path.posix.dirname(relative));
      parent = await openDirectory(destinationDirectory);
      const parentStat = await parent.stat({ bigint: true });
      const named = `/proc/self/fd/${parent.fd}/${path.posix.basename(relative)}`;
      const checkDestination = async () => {
        if (await ctx.workspaces.resolvePath(workspaceId, '') !== root
          || await fs.realpath(`/proc/self/fd/${parent!.fd}`) !== destinationDirectory
          || await fs.realpath(destinationDirectory) !== destinationDirectory) throw unsafe();
        const live = await fs.lstat(destinationDirectory, { bigint: true });
        if (!live.isDirectory() || live.isSymbolicLink() || live.dev !== parentStat.dev || live.ino !== parentStat.ino) throw unsafe();
      };
      await checkDestination();
      // Recheck the staged bytes before the non-interruptible create-only commit.
      await verify(scratch!, attachment.bytes, attachment.sha256);
      signal.throwIfAborted();
      await options.beforeCommit?.();
      signal.throwIfAborted();
      assertConversationWorkspaceUnfenced(scope, workspaceId);
      if (options.source !== 'agent') { manual = true; ctx.events.emit('workspace:manual-intent', { ...intent, phase: 'start' }); }
      await checkDestination();
      assertConversationWorkspaceUnfenced(scope, workspaceId);
      // COPYFILE_EXCL is supported by the native bucket; hard links need not be.
      await fs.copyFile(`/proc/self/fd/${scratch!.fd}`, named, constants.COPYFILE_EXCL);
      output = await fs.open(named, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const final = await verify(output, attachment.bytes, attachment.sha256);
      if (!sameFile(final, await fs.lstat(named, { bigint: true }))) throw attachmentChanged();
      await output.sync();
      await checkDestination();
      committed = true;
      if (options.source !== 'agent') ctx.events.emit('workspace:changed', { workspaceId, paths: [relative] });
      return { attachment, path: relative, version: attachment.sha256,
        entry: { name: path.posix.basename(relative), path: relative, kind: 'file' as const, size: attachment.bytes, modifiedAt: final.mtime.toISOString() } };
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'EEXIST') throw new HttpError(409, 'A file or folder already exists there. Choose another path.', 'FILE_EXISTS');
    if (code === 'ELOOP' || code === 'ENOTDIR') throw unsafe();
    if (code === 'ENOENT') throw new HttpError(404, 'The destination folder no longer exists.', 'FILE_NOT_FOUND');
    if (code === 'ENOSPC' || code === 'EDQUOT') throw new HttpError(507, 'Storage could not finish this copy. The original attachment remains saved.', 'FILE_ATTACHMENT_STORAGE_FULL');
    throw error;
  } finally {
    await output?.close().catch(() => undefined);
    await parent?.close().catch(() => undefined);
    if (scratch && scratchParent && scratchIdentity) {
      // Durable originals always remain. Cleanup is limited to a still-identical
      // owned scratch copy; a successful destination was verified before this.
      const named = `/proc/self/fd/${scratchParent.fd}/${scratchName}`;
      await fs.lstat(named, { bigint: true }).then(async live => {
        const pinned = await scratch!.stat({ bigint: true });
        if (live.isFile() && !live.isSymbolicLink() && sameFile(pinned, live)
          && live.dev === scratchIdentity!.dev && live.ino === scratchIdentity!.ino) await fs.unlink(named);
      }).catch(() => undefined);
    }
    await scratch?.close().catch(() => undefined);
    await scratchParent?.close().catch(() => undefined);
    if (manual) ctx.events.emit('workspace:manual-intent', { ...intent, phase: 'end', committed });
    release();
  }
}
