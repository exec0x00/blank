import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { closeSync, constants, mkdirSync, openSync, readdirSync, renameSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { atomicRenameAvailability, renameNoReplace } from '../server/native-atomic-rename';

const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;

it('reports explicit platform availability and requires the actual built binding on Linux', () => {
  expect(atomicRenameAvailability()).toEqual(process.platform === 'linux'
    ? { available: true } : { available: false, reason: 'unsupported_platform' });
});

describe.skipIf(process.platform !== 'linux')('native no-replace publication on owned temporary fixtures', () => {
  let root: string, from: string, to: string;
  const descriptors = new Set<number>();
  const extraDirectories = new Set<string>();
  function openDirectory(directory: string) {
    const fd = openSync(directory, directoryFlags); descriptors.add(fd); return fd;
  }
  function closeDescriptor(fd: number) { closeSync(fd); descriptors.delete(fd); }
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-native-rename-'));
    from = path.join(root, 'prepared'); to = path.join(root, 'destination');
    await Promise.all([fs.mkdir(from), fs.mkdir(to)]);
    expect(atomicRenameAvailability()).toEqual({ available: true });
  });
  afterEach(async () => {
    for (const fd of descriptors) closeSync(fd);
    descriptors.clear();
    await fs.rm(root, { recursive: true, force: true });
    for (const directory of extraDirectories) await fs.rm(directory, { recursive: true, force: true });
    extraDirectories.clear();
  });

  it('publishes the exact completed inode, mode and bytes asynchronously into absence', async () => {
    const bytes = Buffer.alloc(512 * 1024, 0xa7), source = path.join(from, 'prepared.json'), destination = path.join(to, 'state.json');
    bytes.write('Complete before publication.');
    const handle = await fs.open(source, 'wx', 0o600);
    await handle.writeFile(bytes); await handle.sync(); await handle.close();
    const before = await fs.lstat(source, { bigint: true });
    let completed = false;
    const operation = renameNoReplace(openDirectory(from), 'prepared.json', openDirectory(to), 'state.json');
    void operation.then(() => { completed = true; }, () => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);
    await operation;
    const after = await fs.lstat(destination, { bigint: true });
    expect({ dev: after.dev, ino: after.ino, size: after.size, mode: after.mode }).toEqual({ dev: before.dev, ino: before.ino, size: before.size, mode: before.mode });
    expect(await fs.readFile(destination)).toEqual(bytes);
    await expect(fs.lstat(source)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['file', 'directory', 'symlink'] as const)('never replaces an existing destination %s', async kind => {
    await fs.writeFile(path.join(from, 'candidate'), 'Requested replacement.');
    const destination = path.join(to, 'occupied');
    if (kind === 'file') await fs.writeFile(destination, 'Keep this concurrent writer.');
    else if (kind === 'directory') { await fs.mkdir(destination); await fs.writeFile(path.join(destination, 'child'), 'Preserve child.'); }
    else await fs.symlink('../not-present', destination);
    const before = await fs.lstat(destination, { bigint: true });
    await expect(renameNoReplace(openDirectory(from), 'candidate', openDirectory(to), 'occupied')).rejects.toMatchObject({ code: 'EEXIST', errno: -17, syscall: 'renameat2' });
    expect(await fs.readFile(path.join(from, 'candidate'), 'utf8')).toBe('Requested replacement.');
    const after = await fs.lstat(destination, { bigint: true });
    expect({ ino: after.ino, mode: after.mode, size: after.size }).toEqual({ ino: before.ino, mode: before.mode, size: before.size });
    if (kind === 'file') expect(await fs.readFile(destination, 'utf8')).toBe('Keep this concurrent writer.');
    else if (kind === 'directory') expect(await fs.readFile(path.join(destination, 'child'), 'utf8')).toBe('Preserve child.');
    else expect(await fs.readlink(destination)).toBe('../not-present');
  });

  it('pins directory handles before JS closes and reuses their original descriptor numbers', async () => {
    const sourceFd = openDirectory(from), destinationFd = openDirectory(to);
    await fs.writeFile(path.join(from, 'candidate'), 'From the pinned source.');
    const operation = renameNoReplace(sourceFd, 'candidate', destinationFd, 'published');
    closeDescriptor(sourceFd); closeDescriptor(destinationFd);
    const movedFrom = path.join(root, 'old-source'), movedTo = path.join(root, 'old-destination');
    renameSync(from, movedFrom); renameSync(to, movedTo);
    mkdirSync(from); mkdirSync(to);
    // These new handles may occupy the old numbers; queued work must retain
    // its own duplicates and cannot resolve the replacement directory names.
    openDirectory(from); openDirectory(to);
    await operation;
    expect(await fs.readFile(path.join(movedTo, 'published'), 'utf8')).toBe('From the pinned source.');
    expect(await fs.readdir(from)).toEqual([]); expect(await fs.readdir(to)).toEqual([]);
    expect(await fs.readdir(movedFrom)).toEqual([]);
  });

  it('does not resurrect a closed destination descriptor by duplicating the source into its free slot', async () => {
    const sourceFd = openDirectory(from), closedFd = openDirectory(to);
    closeDescriptor(closedFd);
    await fs.writeFile(path.join(from, 'candidate'), 'Must remain here.');
    await expect(renameNoReplace(sourceFd, 'candidate', closedFd, 'other')).rejects.toMatchObject({ code: 'EBADF' });
    expect(await fs.readFile(path.join(from, 'candidate'), 'utf8')).toBe('Must remain here.');
    expect(await fs.readdir(to)).toEqual([]);
    await expect(fs.lstat(path.join(from, 'other'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects closed source and non-directory handles without changing files', async () => {
    // Open the destination first so it cannot reuse the intentionally closed fd.
    const destination = openDirectory(to), invalid = openDirectory(from); closeDescriptor(invalid);
    await expect(renameNoReplace(invalid, 'candidate', destination, 'published')).rejects.toMatchObject({ code: 'EBADF', syscall: 'fcntl' });
    const file = await fs.open(path.join(root, 'ordinary-file'), 'wx');
    try { await expect(renameNoReplace(file.fd, 'candidate', destination, 'published')).rejects.toMatchObject({ code: 'ENOTDIR', syscall: 'fstat' }); }
    finally { await file.close(); }
    expect(await fs.readdir(to)).toEqual([]);
  });

  it.each(['', '.', '..', '../escape', 'nested/file', 'bad\0name', 'a'.repeat(256), 'é'.repeat(128)])('rejects invalid basenames without filesystem mutation: %j', async name => {
    await fs.writeFile(path.join(from, 'candidate'), 'Preserve.');
    const sourceFd = openDirectory(from), destinationFd = openDirectory(to);
    await expect(renameNoReplace(sourceFd, 'candidate', destinationFd, name)).rejects.toMatchObject({ code: 'ERR_INVALID_ARG_VALUE' });
    await expect(renameNoReplace(sourceFd, name, destinationFd, 'published')).rejects.toMatchObject({ code: 'ERR_INVALID_ARG_VALUE' });
    expect(await fs.readFile(path.join(from, 'candidate'), 'utf8')).toBe('Preserve.');
    expect(await fs.readdir(to)).toEqual([]);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31])('rejects invalid numeric descriptors: %s', async fd => {
    const destination = openDirectory(to);
    await expect(renameNoReplace(fd, 'candidate', destination, 'published')).rejects.toMatchObject({ code: 'ERR_INVALID_ARG_VALUE' });
    await expect(renameNoReplace(destination, 'candidate', fd, 'published')).rejects.toMatchObject({ code: 'ERR_INVALID_ARG_VALUE' });
    expect(await fs.readdir(to)).toEqual([]);
  });

  it('supports UTF-8 names and the 255-byte basename boundary', async () => {
    const source = '完成.json', destination = 'a'.repeat(255);
    await fs.writeFile(path.join(from, source), 'Exact UTF-8 name.');
    await renameNoReplace(openDirectory(from), source, openDirectory(to), destination);
    expect(await fs.readFile(path.join(to, destination), 'utf8')).toBe('Exact UTF-8 name.');
  });

  it('returns ENOENT without manufacturing a destination when the source is missing', async () => {
    await expect(renameNoReplace(openDirectory(from), 'missing', openDirectory(to), 'published')).rejects.toMatchObject({ code: 'ENOENT', errno: -2, syscall: 'renameat2' });
    expect(await fs.readdir(to)).toEqual([]);
  });

  it('fails across distinct filesystems without a copy fallback', async context => {
    const sourceDevice = (await fs.stat(from)).dev;
    let other: string | undefined;
    for (const base of ['/dev/shm', '/tmp', '/var/tmp']) {
      try {
        if ((await fs.stat(base)).dev === sourceDevice) continue;
        other = await fs.mkdtemp(path.join(base, 'codex-native-rename-')); extraDirectories.add(other); break;
      } catch { /* Only owned fixtures on an existing, writable temporary backing. */ }
    }
    if (!other) {
      context.skip('No distinct writable temporary filesystem is available for the real EXDEV fixture.');
      return;
    }
    expect((await fs.stat(other)).dev).not.toBe(sourceDevice);
    await fs.writeFile(path.join(from, 'candidate'), 'Never copy this after EXDEV.');
    await expect(renameNoReplace(openDirectory(from), 'candidate', openDirectory(other), 'published')).rejects.toMatchObject({ code: 'EXDEV', errno: -18, syscall: 'renameat2' });
    expect(await fs.readFile(path.join(from, 'candidate'), 'utf8')).toBe('Never copy this after EXDEV.');
    expect(await fs.readdir(other)).toEqual([]);
  });

  it('closes owned duplicates after both worker failures and successes', async () => {
    const sourceFd = openDirectory(from), destinationFd = openDirectory(to);
    await fs.writeFile(path.join(to, 'occupied'), 'Preserve.');
    const before = readdirSync('/proc/self/fd').length;
    for (let index = 0; index < 24; index++) {
      const leaf = `candidate-${index}`; await fs.writeFile(path.join(from, leaf), 'Complete.');
      await expect(renameNoReplace(sourceFd, leaf, destinationFd, 'occupied')).rejects.toMatchObject({ code: 'EEXIST' });
      await renameNoReplace(sourceFd, leaf, destinationFd, leaf);
    }
    expect(readdirSync('/proc/self/fd').length).toBeLessThanOrEqual(before + 2);
    expect(await fs.readFile(path.join(to, 'occupied'), 'utf8')).toBe('Preserve.');
  });
});
