import { createHash, randomUUID } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from '../errors';
import type { DownloadSource } from './snapshot';

/** Only small, already authenticated generated assets use this in-memory entry point. */
export const MAX_BUFFER_DOWNLOAD_BYTES = 8 * 1024 * 1024;
const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const same = (a: BigIntStats, b: BigIntStats) => a.isFile() && b.isFile() && a.dev === b.dev && a.ino === b.ino
  && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
const changed = () => new HttpError(409, 'The verified image changed while preparing its download. Try again.', 'DOWNLOAD_FILE_CHANGED');

async function openDirectory(absolute: string): Promise<FileHandle> {
  let handle = await fs.open('/', DIRECTORY_FLAGS);
  try {
    for (const part of absolute.split(path.sep).filter(Boolean)) {
      const next = await fs.open(`/proc/self/fd/${handle.fd}/${part}`, DIRECTORY_FLAGS);
      await handle.close(); handle = next;
    }
    if (await fs.realpath(`/proc/self/fd/${handle.fd}`) !== absolute) throw changed();
    return handle;
  } catch (error) { await handle.close(); throw error; }
}

/** The directory is DownloadService's existing owned scratch, never a client path.
 * The returned source owns just its one temporary file and its two descriptors. */
export async function stageBufferDownloadSource(directory: string, input: Buffer, expectedSha256: string,
  signal?: AbortSignal): Promise<DownloadSource> {
  signal?.throwIfAborted();
  if (!Buffer.isBuffer(input) || !input.length || input.length > MAX_BUFFER_DOWNLOAD_BYTES) {
    throw new HttpError(413, 'Generated-image downloads must be 8 MiB or smaller.', 'DOWNLOAD_TOO_LARGE');
  }
  // Own these bytes before the first asynchronous filesystem operation.
  const bytes = Buffer.from(input);
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || createHash('sha256').update(bytes).digest('hex') !== expectedSha256) throw changed();
  let parent: FileHandle | undefined, handle: FileHandle | undefined, created: BigIntStats | undefined;
  const name = `${randomUUID()}.generated-image-source`;
  let transferred = false;
  const cleanup = async () => {
    if (parent && handle && created) {
      const named = `/proc/self/fd/${parent.fd}/${name}`;
      await fs.lstat(named, { bigint: true }).then(async live => {
        const pinned = await handle!.stat({ bigint: true });
        if (live.isFile() && !live.isSymbolicLink() && same(live, pinned)
          && live.dev === created!.dev && live.ino === created!.ino) await fs.unlink(named);
      }).catch(() => undefined);
    }
    await Promise.allSettled([handle?.close(), parent?.close()]);
  };
  try {
    parent = await openDirectory(directory);
    signal?.throwIfAborted();
    handle = await fs.open(`/proc/self/fd/${parent.fd}/${name}`, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    created = await handle.stat({ bigint: true });
    for (let offset = 0; offset < bytes.length;) {
      signal?.throwIfAborted();
      const written = await handle.write(bytes, offset, Math.min(64 * 1024, bytes.length - offset), offset);
      if (!written.bytesWritten) throw new HttpError(507, 'Temporary storage could not prepare this image.', 'DOWNLOAD_STORAGE_FULL');
      offset += written.bytesWritten;
    }
    await handle.sync();
    await handle.chmod(0o400);
    const stat = await handle.stat({ bigint: true }), digest = createHash('sha256'), buffer = Buffer.allocUnsafe(64 * 1024);
    let total = 0;
    while (total <= bytes.length) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, bytes.length + 1 - total), total);
      if (!bytesRead) break;
      total += bytesRead; digest.update(buffer.subarray(0, bytesRead));
    }
    if (total !== bytes.length || digest.digest('hex') !== expectedSha256
      || !same(stat, await handle.stat({ bigint: true }))
      || !same(stat, await fs.lstat(`/proc/self/fd/${parent.fd}/${name}`, { bigint: true }))
      || await fs.realpath(`/proc/self/fd/${parent.fd}`) !== directory) throw changed();
    signal?.throwIfAborted();
    let closing: Promise<void> | undefined;
    transferred = true;
    return { parent, handle, name, stat, size: bytes.length, close: () => closing ??= cleanup() };
  } finally { if (!transferred) await cleanup(); }
}
