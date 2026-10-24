import { createHash } from 'node:crypto';
import { constants, promises as fs, type Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from '../errors';
import { fileIdentity, sameIdentity, sameVersion, type NativeTransferOptions, type TransferIdentity, type TransferManifest, type TransferTreeEntry } from './types';

export const MAX_TRANSFER_ENTRIES = 50_000;
export const MAX_TRANSFER_BYTES = 32 * 1024 * 1024 * 1024;
export const MAX_TRANSFER_MANIFEST_BYTES = 32 * 1024 * 1024;
export const TRANSFER_BUFFER_BYTES = 256 * 1024;
export const MAX_TRANSFER_DURATION_MS = 30 * 60 * 1000;
const MAX_PATH_BYTES = 8 * 1024 * 1024;
const MAX_DEPTH = 96;
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const WRITE_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;

export const transferErrno = (error: unknown, code: string): boolean => !!error && typeof error === 'object' && 'code' in error && error.code === code;
const within = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

export function transferConflict(message = 'Files changed while they were being transferred. Existing source files and the destination were retained for inspection.'): never {
  throw new HttpError(409, message, 'FILE_TRANSFER_CONFLICT');
}

function unsafe(): never {
  throw new HttpError(403, 'A transfer path contains an unsafe link or changed directory. Existing files were retained.', 'UNSAFE_PATH');
}

function limit(): never {
  throw new HttpError(413, 'This transfer exceeds its limit of 50,000 entries, 32 GiB of contents, 32 MiB of metadata, 96 folders deep, or 30 minutes. Transfer a smaller selection.', 'FILE_TRANSFER_LIMIT');
}

function exists(): never {
  throw new HttpError(409, 'The destination already exists. Choose another name; existing files were not overwritten.', 'FILE_EXISTS');
}

function safeName(name: string): void {
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || /[\u0000-\u001f\u007f]/.test(name)) unsafe();
}

function checkedAbsolute(root: string, value: string): void {
  if (!path.isAbsolute(root) || path.resolve(root) !== root || root === path.parse(root).root
    || !path.isAbsolute(value) || path.resolve(value) !== value || !within(root, value) || value === root
    || value.length > 4096 || /[\\\u0000-\u001f\u007f]/.test(value)) unsafe();
  for (const part of path.relative(root, value).split(path.sep)) safeName(part);
  if (path.relative(root, value).split(path.sep).length > MAX_DEPTH || Buffer.byteLength(value) > 4096) limit();
}

async function statMaybe(target: string): Promise<Stats | null> {
  try { return await fs.lstat(target); }
  catch (error) { if (transferErrno(error, 'ENOENT')) return null; throw error; }
}

/** Directory descriptor traversal prevents an exchanged symlink ancestor from escaping the owned tree. */
class Directory {
  private constructor(readonly absolute: string, readonly handle: FileHandle, readonly initial: TransferIdentity) {}
  get access(): string { return `/proc/self/fd/${this.handle.fd}`; }

  static async open(absolute: string, access = absolute): Promise<Directory> {
    let handle: FileHandle;
    try { handle = await fs.open(access, DIRECTORY_FLAGS); }
    catch (error) { if (transferErrno(error, 'ELOOP') || transferErrno(error, 'ENOTDIR')) unsafe(); throw error; }
    try {
      const stat = await handle.stat();
      if (!stat.isDirectory()) unsafe();
      const directory = new Directory(absolute, handle, fileIdentity(stat));
      await directory.check();
      return directory;
    } catch (error) { await handle.close(); throw error; }
  }

  async check(): Promise<void> {
    if (await fs.realpath(this.access) !== this.absolute) transferConflict('A folder moved during the transfer. The remaining files were retained.');
    const current = await fs.lstat(this.absolute);
    if (!current.isDirectory() || current.isSymbolicLink() || !sameIdentity(current, this.initial)) unsafe();
  }

  async close(): Promise<void> { await this.handle.close(); }
}

interface Budget { entries: number; bytes: number; pathBytes: number; manifestBytes: number; baseDepth: number; basePathBytes: number; deadline: number; checkResources?: () => Promise<void>; nextResourceCheck: number; bytesSinceResourceCheck: number }
function checkTime(budget: Budget): void { if (Date.now() > budget.deadline) limit(); }
async function checkBudget(budget: Budget, bytes = 0): Promise<void> {
  checkTime(budget);
  budget.bytesSinceResourceCheck += bytes;
  if (budget.checkResources && (Date.now() >= budget.nextResourceCheck || budget.bytesSinceResourceCheck >= 16 * 1024 * 1024)) {
    await budget.checkResources(); budget.nextResourceCheck = Date.now() + 5_000;
    budget.bytesSinceResourceCheck = 0;
    checkTime(budget);
  }
}
function reserveEntry(budget: Budget, relative: string): void {
  budget.entries++; budget.pathBytes += Buffer.byteLength(relative);
  if (budget.entries > MAX_TRANSFER_ENTRIES || budget.pathBytes > MAX_PATH_BYTES
    || relative.length > 4096 || budget.basePathBytes + Buffer.byteLength(relative) + 1 > 4096
    || budget.baseDepth + (relative ? relative.split('/').length : 0) > MAX_DEPTH) limit();
  checkTime(budget);
}

function reserveManifestEntry(budget: Budget, entry: TransferTreeEntry): void {
  const formatted = JSON.stringify(entry, null, 2);
  // The enclosing entries array adds four spaces per line. Reserve enough for
  // a destination identity and SHA-256 before either is present in the snapshot.
  budget.manifestBytes += Buffer.byteLength(formatted) + formatted.split('\n').length * 4 + 2 + 512;
  if (budget.manifestBytes > MAX_TRANSFER_MANIFEST_BYTES) limit();
}

async function names(directory: Directory, budget: Budget, options: { reserveUnder?: string; maximum?: number } = {}): Promise<string[]> {
  await directory.check();
  const children: string[] = [];
  const iterator = await fs.opendir(directory.access, { bufferSize: 64 });
  for await (const child of iterator) {
    await checkBudget(budget); safeName(child.name);
    // Pending sibling arrays count immediately, not only when the walk visits
    // them. A deep first-child chain cannot retain a fresh 50,000 names per level.
    if (options.reserveUnder !== undefined) reserveEntry(budget, options.reserveUnder ? `${options.reserveUnder}/${child.name}` : child.name);
    if (options.maximum !== undefined && children.length >= options.maximum) transferConflict('Unexpected files appeared during the transfer. They and the existing source files were retained.');
    if (children.length >= MAX_TRANSFER_ENTRIES) limit();
    children.push(child.name);
  }
  await directory.check();
  return children.sort();
}

async function withParent<T>(root: Directory, absolute: string, create: boolean, work: (parent: Directory, name: string) => Promise<T>): Promise<T> {
  checkedAbsolute(root.absolute, absolute);
  const parts = path.relative(root.absolute, absolute).split(path.sep);
  const opened: Directory[] = [];
  let parent = root;
  try {
    for (const part of parts.slice(0, -1)) {
      await parent.check();
      const access = `${parent.access}/${part}`;
      if (create && !await statMaybe(access)) {
        try { await fs.mkdir(access, { mode: 0o755 }); }
        catch (error) { if (!transferErrno(error, 'EEXIST')) throw error; }
      }
      const next = await Directory.open(path.join(parent.absolute, part), access);
      opened.push(next);
      if (next.initial.dev !== root.initial.dev) unsafe();
      parent = next;
    }
    await root.check(); await parent.check();
    return await work(parent, parts.at(-1)!);
  } finally { for (const directory of opened.reverse()) await directory.close(); }
}

function kindOf(stat: Stats): TransferTreeEntry['kind'] {
  if (stat.isSymbolicLink()) return 'symlink';
  if (stat.isDirectory()) return 'directory';
  if (stat.isFile()) return 'file';
  throw new HttpError(400, 'The selection contains a socket, device, or other special file. Close its owner and transfer ordinary files.', 'FILE_TRANSFER_SPECIAL_FILE');
}

async function snapshot(root: Directory, source: string, kind: NativeTransferOptions['kind'], budget: Budget): Promise<TransferManifest> {
  const entries: TransferTreeEntry[] = [];
  const hardLinks = new Set<string>();
  reserveEntry(budget, '');
  const walk = async (parent: Directory, name: string, relative: string): Promise<void> => {
    await checkBudget(budget);
    await parent.check();
    const access = `${parent.access}/${name}`;
    const stat = await fs.lstat(access);
    if (stat.dev !== root.initial.dev) unsafe();
    const entryKind = kindOf(stat);
    if (kind === 'move' && entryKind !== 'directory' && stat.nlink > 1) {
      const identity = `${stat.dev}:${stat.ino}`;
      if (hardLinks.has(identity)) throw new HttpError(400, 'The selection contains multiple hard-linked names for one file. Copy the selection, or move those names separately.', 'FILE_TRANSFER_HARD_LINKS');
      hardLinks.add(identity);
    }
    if (entryKind === 'file') {
      budget.bytes += stat.size;
      if (budget.bytes > MAX_TRANSFER_BYTES) limit();
    }
    const entry: TransferTreeEntry = { path: relative, kind: entryKind, source: fileIdentity(stat) };
    if (entryKind === 'symlink') {
      entry.target = await fs.readlink(access);
      if (entry.target.length > 4096 || entry.target.includes('\0')) unsafe();
    }
    reserveManifestEntry(budget, entry);
    entries.push(entry);
    if (entryKind === 'directory') {
      const directory = await Directory.open(path.join(parent.absolute, name), access);
      try {
        if (!sameIdentity(await directory.handle.stat(), entry.source)) transferConflict();
        for (const child of await names(directory, budget, { reserveUnder: relative })) await walk(directory, child, relative ? `${relative}/${child}` : child);
      } finally { await directory.close(); }
    }
    await parent.check();
    if (!sameVersion(await fs.lstat(access), entry.source)) transferConflict();
  };
  await withParent(root, source, false, (parent, name) => walk(parent, name, ''));
  return { version: 1, entries, bytes: budget.bytes };
}

async function fileHash(parent: Directory, name: string, expected: TransferIdentity, buffer: Buffer, budget: Budget): Promise<string> {
  await parent.check();
  const access = `${parent.access}/${name}`;
  const handle = await fs.open(access, READ_FLAGS);
  try {
    const before = await handle.stat();
    if (!before.isFile() || !sameVersion(before, expected)) transferConflict();
    const hash = createHash('sha256');
    let total = 0;
    while (true) {
      await checkBudget(budget);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      await checkBudget(budget, bytesRead);
      total += bytesRead;
      if (total > expected.size) transferConflict();
      hash.update(buffer.subarray(0, bytesRead));
    }
    await parent.check();
    if (total !== expected.size || !sameVersion(await handle.stat(), expected) || !sameVersion(await fs.lstat(access), expected)) transferConflict();
    return hash.digest('hex');
  } finally { await handle.close(); }
}

function childrenOf(manifest: TransferManifest): Map<string, TransferTreeEntry[]> {
  const children = new Map<string, TransferTreeEntry[]>();
  for (const entry of manifest.entries) {
    if (!entry.path) continue;
    const parent = path.posix.dirname(entry.path);
    const key = parent === '.' ? '' : parent;
    const entries = children.get(key) ?? [];
    entries.push(entry); children.set(key, entries);
  }
  return children;
}

async function copyTree(root: Directory, options: NativeTransferOptions, manifest: TransferManifest, buffer: Buffer, budget: Budget): Promise<void> {
  const children = childrenOf(manifest);
  const walk = async (from: Directory, sourceName: string, to: Directory, destinationName: string, entry: TransferTreeEntry): Promise<void> => {
    await checkBudget(budget); await from.check(); await to.check();
    const input = `${from.access}/${sourceName}`;
    const output = `${to.access}/${destinationName}`;
    const current = await fs.lstat(input);
    if (kindOf(current) !== entry.kind || !sameVersion(current, entry.source)) transferConflict();
    if (entry.kind === 'directory') {
      await fs.mkdir(output, { mode: 0o700 });
      const source = await Directory.open(path.join(from.absolute, sourceName), input);
      let destination: Directory | undefined;
      try {
        destination = await Directory.open(path.join(to.absolute, destinationName), output);
        if (!sameIdentity(await source.handle.stat(), entry.source)) transferConflict();
        for (const child of children.get(entry.path) ?? []) {
          const childName = path.posix.basename(child.path);
          await walk(source, childName, destination, childName, child);
        }
        await source.check(); await destination.check();
        if (!sameVersion(await source.handle.stat(), entry.source)) transferConflict();
        await destination.handle.chmod(entry.source.mode);
        entry.destination = fileIdentity(await destination.handle.stat());
      } finally { await source.close(); await destination?.close(); }
    } else if (entry.kind === 'symlink') {
      if (await fs.readlink(input) !== entry.target) transferConflict();
      await fs.symlink(entry.target!, output);
      entry.destination = fileIdentity(await fs.lstat(output));
    } else {
      const inputFile = await fs.open(input, READ_FLAGS);
      let outputFile: FileHandle | undefined;
      try {
        const before = await inputFile.stat();
        if (!before.isFile() || !sameVersion(before, entry.source)) transferConflict();
        outputFile = await fs.open(output, WRITE_FLAGS, entry.source.mode);
        const hash = createHash('sha256');
        let total = 0;
        while (true) {
          await checkBudget(budget);
          const { bytesRead } = await inputFile.read(buffer, 0, buffer.length, null);
          if (!bytesRead) break;
          await checkBudget(budget, bytesRead);
          total += bytesRead;
          if (total > entry.source.size) transferConflict();
          hash.update(buffer.subarray(0, bytesRead));
          let written = 0;
          while (written < bytesRead) {
            checkTime(budget);
            const result = await outputFile.write(buffer, written, bytesRead - written, null);
            if (!result.bytesWritten) throw new HttpError(507, 'Storage stopped accepting the transfer. Original files were retained.', 'FILE_TRANSFER_WRITE_FAILED');
            written += result.bytesWritten;
          }
        }
        if (total !== entry.source.size || !sameVersion(await inputFile.stat(), entry.source)) transferConflict();
        await outputFile.chmod(entry.source.mode);
        await outputFile.sync();
        entry.destination = fileIdentity(await outputFile.stat());
        entry.sha256 = hash.digest('hex');
      } finally { await inputFile.close(); await outputFile?.close(); }
    }
    await from.check(); await to.check();
    if (!sameVersion(await fs.lstat(input), entry.source) || !sameVersion(await fs.lstat(output), entry.destination!)) transferConflict();
  };
  await withParent(root, options.source, false, (from, sourceName) =>
    withParent(root, options.destination, true, (to, destinationName) => walk(from, sourceName, to, destinationName, manifest.entries[0])));
}

async function verifyTree(root: Directory, absolute: string, manifest: TransferManifest, side: 'source' | 'destination', buffer: Buffer, budget: Budget): Promise<void> {
  const children = childrenOf(manifest);
  const walk = async (parent: Directory, name: string, entry: TransferTreeEntry): Promise<void> => {
    await checkBudget(budget); await parent.check();
    const access = `${parent.access}/${name}`;
    const expected = entry[side];
    const stat = await fs.lstat(access);
    if (!expected || kindOf(stat) !== entry.kind || !sameVersion(stat, expected)) transferConflict();
    if (entry.kind === 'file') {
      if (!entry.sha256 || await fileHash(parent, name, expected, buffer, budget) !== entry.sha256) transferConflict();
    } else if (entry.kind === 'symlink') {
      if (await fs.readlink(access) !== entry.target) transferConflict();
    } else {
      const directory = await Directory.open(path.join(parent.absolute, name), access);
      try {
        if (!sameIdentity(await directory.handle.stat(), expected)) transferConflict();
        const expectedChildren = children.get(entry.path) ?? [];
        const actualNames = await names(directory, budget, { maximum: expectedChildren.length });
        const expectedNames = expectedChildren.map(child => path.posix.basename(child.path)).sort();
        if (actualNames.length !== expectedNames.length || actualNames.some((name, index) => name !== expectedNames[index])) transferConflict();
        for (const child of expectedChildren) await walk(directory, path.posix.basename(child.path), child);
      } finally { await directory.close(); }
    }
    await parent.check();
    if (!sameVersion(await fs.lstat(access), expected)) transferConflict();
  };
  await withParent(root, absolute, false, (parent, name) => walk(parent, name, manifest.entries[0]));
}

/** Delete only enumerated, still-identical leaves; never recursively remove an unchecked source tree. */
async function removeVerifiedSource(root: Directory, options: NativeTransferOptions, manifest: TransferManifest, buffer: Buffer, budget: Budget): Promise<void> {
  const children = childrenOf(manifest);
  const verifyDestinationEntry = (entry: TransferTreeEntry): Promise<void> => {
    const absolute = entry.path ? path.join(options.destination, ...entry.path.split('/')) : options.destination;
    return withParent(root, absolute, false, async (parent, name) => {
      await parent.check();
      const access = `${parent.access}/${name}`;
      const current = await fs.lstat(access);
      if (!entry.destination || kindOf(current) !== entry.kind || !sameVersion(current, entry.destination)) transferConflict();
      if (entry.kind === 'file' && await fileHash(parent, name, entry.destination, buffer, budget) !== entry.sha256) transferConflict();
      if (entry.kind === 'symlink' && await fs.readlink(access) !== entry.target) transferConflict();
      await parent.check();
    });
  };
  const walk = async (parent: Directory, name: string, entry: TransferTreeEntry): Promise<void> => {
    await checkBudget(budget); await root.check(); await parent.check();
    const access = `${parent.access}/${name}`;
    const stat = await fs.lstat(access);
    if (kindOf(stat) !== entry.kind || !sameVersion(stat, entry.source)) transferConflict();
    if (entry.kind === 'directory') {
      const directory = await Directory.open(path.join(parent.absolute, name), access);
      try {
        if (!sameIdentity(await directory.handle.stat(), entry.source)) transferConflict();
        for (const child of children.get(entry.path) ?? []) await walk(directory, path.posix.basename(child.path), child);
        await names(directory, budget, { maximum: 0 });
        await verifyDestinationEntry(entry);
        await parent.check(); await directory.check();
        const current = await fs.lstat(access);
        if (!current.isDirectory() || !sameIdentity(current, entry.source)) transferConflict();
        await fs.rmdir(access);
      } finally { await directory.close(); }
    } else {
      await verifyDestinationEntry(entry);
      if (entry.kind === 'file' && await fileHash(parent, name, entry.source, buffer, budget) !== entry.sha256) transferConflict();
      if (entry.kind === 'symlink' && await fs.readlink(access) !== entry.target) transferConflict();
      await parent.check();
      if (!sameVersion(await fs.lstat(access), entry.source)) transferConflict();
      await fs.unlink(access);
    }
  };
  await withParent(root, options.source, false, (parent, name) => walk(parent, name, manifest.entries[0]));
}

/**
 * Native no-clobber transfer for mounts without directory rename. At most one
 * 256 KiB content buffer is live. Errors retain partial destinations because a
 * terminal may have edited them; no rollback removes unknown user content.
 */
export async function transferNativeEntry(options: NativeTransferOptions): Promise<TransferManifest> {
  if (options.kind !== 'move' && options.kind !== 'copy'
    || options.deadline !== undefined && (!Number.isFinite(options.deadline) || options.deadline <= 0)) {
    throw new HttpError(400, 'Invalid file transfer options.', 'INVALID_FILE_TRANSFER');
  }
  checkedAbsolute(options.root, options.source); checkedAbsolute(options.root, options.destination);
  if (options.source === options.destination) throw new HttpError(400, 'Choose a different destination.', 'INVALID_PATH');
  if (within(options.source, options.destination) || within(options.destination, options.source)) {
    throw new HttpError(400, 'A folder cannot be transferred into itself or an ancestor.', 'INVALID_PATH');
  }
  const budget: Budget = { entries: 0, bytes: 0, pathBytes: 0, manifestBytes: 128, deadline: Math.min(options.deadline ?? Infinity, Date.now() + MAX_TRANSFER_DURATION_MS),
    baseDepth: Math.max(path.relative(options.root, options.source).split(path.sep).length, path.relative(options.root, options.destination).split(path.sep).length),
    basePathBytes: Math.max(Buffer.byteLength(options.source), Buffer.byteLength(options.destination)),
    nextResourceCheck: 0, bytesSinceResourceCheck: 0, checkResources: options.checkResources };
  const root = await Directory.open(options.root);
  try {
    await options.checkAllowed?.();
    await withParent(root, options.destination, true, async (parent, name) => { if (await statMaybe(`${parent.access}/${name}`)) exists(); });
    const manifest = await snapshot(root, options.source, options.kind, budget);
    if (options.expectedSource && !sameVersion(manifest.entries[0].source, options.expectedSource)) transferConflict();
    if (Buffer.byteLength(JSON.stringify(manifest, null, 2)) + 1 > MAX_TRANSFER_MANIFEST_BYTES) limit();
    await options.checkpoint?.('copying', manifest);
    const buffer = Buffer.allocUnsafe(TRANSFER_BUFFER_BYTES);
    await copyTree(root, options, manifest, buffer, budget);
    await verifyTree(root, options.destination, manifest, 'destination', buffer, budget);
    await verifyTree(root, options.source, manifest, 'source', buffer, budget);
    if (Buffer.byteLength(JSON.stringify(manifest, null, 2)) + 1 > MAX_TRANSFER_MANIFEST_BYTES) limit();
    await options.checkpoint?.('verifying', manifest);
    await options.verifyDurable?.(manifest);
    await options.checkAllowed?.();
    if (options.kind === 'move') {
      await options.checkpoint?.('removing', manifest);
      // A durability check can take time. Check complete trees again before any deletion.
      await verifyTree(root, options.destination, manifest, 'destination', buffer, budget);
      await verifyTree(root, options.source, manifest, 'source', buffer, budget);
      await removeVerifiedSource(root, options, manifest, buffer, budget);
    }
    await options.checkpoint?.('complete', manifest);
    return manifest;
  } catch (error) {
    if (transferErrno(error, 'EEXIST')) exists();
    if (transferErrno(error, 'ELOOP') || transferErrno(error, 'ENOTDIR')) unsafe();
    if (transferErrno(error, 'ENOENT')) transferConflict('A transfer path disappeared during the operation. Remaining source files and the destination were retained.');
    throw error;
  } finally { await root.close(); }
}
