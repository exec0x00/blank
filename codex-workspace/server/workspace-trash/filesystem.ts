import { constants, type Stats } from 'node:fs';
import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from '../config';
import { HttpError } from '../errors';
import type { NativeIdentity, TreeMetadataEntry, TrashSnapshot } from './types';

export const TRASH_DIRECTORY = '.workspace-trash';
export const MAX_TRASH_ENTRIES = 10_000;
export const MAX_TREE_ENTRIES = 100_000;
export const MAX_TREE_BYTES = 16 * 1024 * 1024 * 1024;
export const MAX_METADATA_BYTES = 32 * 1024 * 1024;
export const MAX_RECORD_BYTES = 32 * 1024;
const MAX_DEPTH = 64;
const OPERATION_MS = 120_000;
const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

export const errno = (error: unknown, code: string): boolean => !!error && typeof error === 'object' && 'code' in error && error.code === code;
export const identity = (stat: Stats): NativeIdentity => ({ dev: stat.dev, ino: stat.ino });
export const sameIdentity = (stat: Stats, expected: NativeIdentity): boolean => stat.dev === expected.dev && stat.ino === expected.ino;
export const normalized = (value: unknown): value is string => typeof value === 'string' && value.length > 1 && value.length <= 4096
  && path.isAbsolute(value) && path.resolve(value) === value && !/[\u0000-\u001f\u007f]/.test(value);
export const within = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

export function unsafe(message = 'Workspace trash contains an unsafe or changed storage path. Existing files were left unchanged.'): never {
  throw new HttpError(409, message, 'WORKSPACE_TRASH_UNSAFE');
}

export function limit(message = 'This workspace exceeds the bounded trash operation limit. Existing files were retained.'): never {
  throw new HttpError(413, message, 'WORKSPACE_TRASH_LIMIT');
}

export function conflict(): never {
  throw new HttpError(409, 'The original workspace location already exists. Its files and the trash copy were retained; move the conflicting folder before restoring.', 'WORKSPACE_RESTORE_CONFLICT');
}

export async function lstatMaybe(target: string): Promise<Stats | null> {
  try { return await fs.lstat(target); }
  catch (error) { if (errno(error, 'ENOENT')) return null; throw error; }
}

/** Native descriptor paths pin traversal to directories already checked with NOFOLLOW. */
export class PinnedDirectory {
  private constructor(readonly absolute: string, readonly handle: FileHandle) {}
  get access(): string { return `/proc/self/fd/${this.handle.fd}`; }

  static async open(absolute: string, access = absolute): Promise<PinnedDirectory> {
    let handle: FileHandle;
    try { handle = await fs.open(access, DIRECTORY_FLAGS); }
    catch (error) {
      if (errno(error, 'ELOOP') || errno(error, 'ENOTDIR')) unsafe();
      throw error;
    }
    const directory = new PinnedDirectory(absolute, handle);
    try {
      if (!(await handle.stat()).isDirectory()) unsafe();
      await directory.check();
      return directory;
    } catch (error) { await handle.close(); throw error; }
  }

  async check(): Promise<void> {
    if (await fs.realpath(this.access) !== this.absolute) unsafe('A directory moved during the trash operation. Existing files were retained for recovery.');
  }

  async close(): Promise<void> { await this.handle.close(); }
}

/** Check every component, including storage roots. ENOENT alone never validates a parent. */
export async function checkedDirectory(root: string, target: string): Promise<string> {
  if (!normalized(root) || !normalized(target) || !within(root, target)) unsafe();
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || await fs.realpath(root) !== root) unsafe();
  let current = root;
  for (const name of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, name);
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) unsafe();
  }
  if (await fs.realpath(target) !== target) unsafe();
  return target;
}

export async function workspaceStorage(config: AppConfig): Promise<string> {
  if (config.dataDir === config.workspacesDir || !within(config.dataDir, config.workspacesDir)) unsafe();
  return checkedDirectory(config.dataDir, config.workspacesDir);
}

export async function trashStorage(config: AppConfig): Promise<string> {
  const base = await workspaceStorage(config);
  const parent = await PinnedDirectory.open(base);
  try {
    await parent.check();
    const target = path.join(base, TRASH_DIRECTORY);
    await fs.mkdir(`${parent.access}/${TRASH_DIRECTORY}`, { mode: 0o700 }).catch(error => { if (!errno(error, 'EEXIST')) throw error; });
    await checkedDirectory(base, target);
    await parent.check();
    return target;
  } finally { await parent.close(); }
}

export function checkedWorkspacePath(config: AppConfig, target: string): string {
  const base = config.workspacesDir;
  if (!normalized(target) || target === base || !within(base, target)) unsafe('The workspace is outside its owned storage directory. No files were moved.');
  if (path.dirname(target) !== base) unsafe('Only independent workspace roots can be moved to trash. Nested registrations must be resolved first.');
  const first = path.relative(base, target).split(path.sep)[0];
  if (first.startsWith('.') || target.length > 4096) unsafe('Internal storage directories cannot be moved to workspace trash.');
  return target;
}

/** Confirm a missing leaf twice under a still-present, unchanged parent. */
export async function inspectWorkspaceRoot(config: AppConfig, target: string): Promise<Stats | null> {
  checkedWorkspacePath(config, target);
  const base = await workspaceStorage(config);
  await checkedDirectory(base, path.dirname(target));
  const parent = await PinnedDirectory.open(path.dirname(target));
  try {
    await parent.check();
    const access = `${parent.access}/${path.basename(target)}`;
    const stat = await lstatMaybe(access);
    if (stat) {
      if (!stat.isDirectory() || stat.isSymbolicLink()) unsafe('The workspace root is a link or a non-directory. It was not classified as deleted.');
      await checkedDirectory(base, target);
      await parent.check();
      return stat;
    }
    // A directory listing corroborates ENOENT. EIO, EACCES and all other errors propagate.
    const children = await fs.readdir(parent.access);
    await parent.check();
    const second = await lstatMaybe(access);
    if (second || children.includes(path.basename(target))) {
      if (!second || !second.isDirectory() || second.isSymbolicLink()) unsafe('The workspace directory changed while its availability was checked.');
      await checkedDirectory(base, target);
      return second;
    }
    await parent.check();
    return null;
  } finally { await parent.close(); }
}

export async function readText(target: string, maxBytes: number): Promise<string> {
  let handle: FileHandle;
  try { handle = await fs.open(target, READ_FLAGS); }
  catch (error) { if (errno(error, 'ELOOP') || errno(error, 'ENOTDIR')) unsafe(); throw error; }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) unsafe('Saved trash metadata is invalid or exceeds its size limit.');
    const bytes = Buffer.alloc(Math.min(stat.size + 1, maxBytes + 1));
    let total = 0;
    while (total < bytes.length) {
      const result = await handle.read(bytes, total, bytes.length - total, null);
      if (!result.bytesRead) break;
      total += result.bytesRead;
    }
    const after = await handle.stat();
    if (total !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) unsafe('Trash metadata changed during the operation.');
    const latest = await fs.lstat(target);
    if (!latest.isFile() || latest.isSymbolicLink() || !sameIdentity(latest, identity(stat))) unsafe();
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, total)); }
    catch { return unsafe('Trash metadata is not valid UTF-8.'); }
  } finally { await handle.close(); }
}

interface Budget { entries: number; bytes: number; deadline: number }
function budget(): Budget { return { entries: 0, bytes: 0, deadline: Date.now() + OPERATION_MS }; }
function checkBudget(state: Budget, relative: string, bytes = 0): void {
  state.entries++;
  state.bytes += bytes;
  if (state.entries > MAX_TREE_ENTRIES || state.bytes > MAX_TREE_BYTES || Date.now() > state.deadline
    || relative.length > 4096 || relative.split('/').length > MAX_DEPTH) limit();
}
function nameSafe(name: string): void {
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || /[\u0000-\u001f\u007f]/.test(name)) unsafe('A workspace file name cannot be represented safely in trash metadata.');
}

export async function captureTree(absolute: string): Promise<TreeMetadataEntry[]> {
  const state = budget();
  const entries: TreeMetadataEntry[] = [];
  const device = (await fs.lstat(absolute)).dev;
  const walk = async (directory: PinnedDirectory, relative: string): Promise<void> => {
    await directory.check();
    checkBudget(state, relative);
    entries.push({ path: relative, kind: 'directory', mode: (await directory.handle.stat()).mode & 0o7777 });
    for (const name of await fs.readdir(directory.access)) {
      nameSafe(name);
      await directory.check();
      const childPath = relative ? `${relative}/${name}` : name;
      const access = `${directory.access}/${name}`;
      const stat = await fs.lstat(access);
      if (stat.dev !== device) unsafe('The workspace crosses a filesystem boundary. Its contents were not moved to trash.');
      if (stat.isSymbolicLink()) {
        const target = await fs.readlink(access);
        if (target.length > 4096 || target.includes('\0')) unsafe();
        checkBudget(state, childPath);
        entries.push({ path: childPath, kind: 'symlink', mode: stat.mode & 0o7777, target });
      } else if (stat.isDirectory()) {
        const child = await PinnedDirectory.open(path.join(directory.absolute, name), access);
        try { await walk(child, childPath); } finally { await child.close(); }
      } else if (stat.isFile()) {
        checkBudget(state, childPath, stat.size);
        entries.push({ path: childPath, kind: 'file', mode: stat.mode & 0o7777, size: stat.size });
      } else unsafe('The workspace contains a socket, device or another special file. Close its owner before moving it to trash.');
    }
    await directory.check();
  };
  const root = await PinnedDirectory.open(absolute);
  try { await walk(root, ''); } finally { await root.close(); }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export function checkedSnapshot(value: unknown): TrashSnapshot {
  const input = value as Partial<TrashSnapshot> | null;
  if (!input || input.version !== 1) unsafe('The saved trash snapshot is invalid.');
  const check = (tree: unknown): TreeMetadataEntry[] | null => {
    if (tree === null) return null;
    if (!Array.isArray(tree) || !tree.length || tree.length > MAX_TREE_ENTRIES) unsafe('The saved trash snapshot exceeds its entry limit.');
    const state = budget();
    const paths = new Map<string, TreeMetadataEntry>();
    for (const entry of tree as TreeMetadataEntry[]) {
      if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string'
        || entry.path.startsWith('/') || entry.path.includes('\\') || entry.path.split('/').includes('..')
        || entry.path !== '' && path.posix.normalize(entry.path) !== entry.path || /[\u0000-\u001f\u007f]/.test(entry.path)
        || !['directory', 'file', 'symlink'].includes(entry.kind) || !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o7777
        || entry.kind === 'file' && (!Number.isSafeInteger(entry.size) || entry.size! < 0)
        || entry.kind === 'symlink' && (typeof entry.target !== 'string' || entry.target.length > 4096 || entry.target.includes('\0'))
        || paths.has(entry.path)) unsafe('The saved trash snapshot is invalid.');
      checkBudget(state, entry.path, entry.kind === 'file' ? entry.size : 0);
      paths.set(entry.path, entry);
    }
    if (paths.get('')?.kind !== 'directory') unsafe();
    for (const entry of paths.values()) {
      if (!entry.path) continue;
      const parent = path.posix.dirname(entry.path);
      if (paths.get(parent === '.' ? '' : parent)?.kind !== 'directory') unsafe('The saved trash snapshot has an unsafe parent path.');
    }
    return tree;
  };
  return { version: 1, content: check(input.content), fileTrash: check(input.fileTrash) };
}

/** Rebuild only captured POSIX metadata. Regular file contents are never fabricated. */
export async function recoverTreeMetadata(absolute: string, snapshot: TreeMetadataEntry[]): Promise<boolean> {
  const stat = await lstatMaybe(absolute);
  if (!stat) {
    // The native bucket omits entirely empty directory trees. This exception
    // requires a pre-move snapshot proving that no regular file bytes existed.
    if (snapshot.some(entry => entry.kind === 'file')) return false;
    const parent = await PinnedDirectory.open(path.dirname(absolute));
    try { await parent.check(); await fs.mkdir(`${parent.access}/${path.basename(absolute)}`, { mode: 0o700 }); await parent.check(); }
    finally { await parent.close(); }
  } else if (!stat.isDirectory() || stat.isSymbolicLink()) unsafe();
  const root = await PinnedDirectory.open(absolute);
  const withParent = async <T>(relative: string, work: (parent: PinnedDirectory, name: string) => Promise<T>): Promise<T> => {
    const parts = relative.split('/');
    let current = root;
    const opened: PinnedDirectory[] = [];
    try {
      for (const name of parts.slice(0, -1)) {
        await current.check();
        const child = await PinnedDirectory.open(path.join(current.absolute, name), `${current.access}/${name}`);
        opened.push(child); current = child;
      }
      await root.check(); await current.check();
      return await work(current, parts.at(-1)!);
    } finally { for (const directory of opened.reverse()) await directory.close(); }
  };
  try {
  for (const entry of [...snapshot].sort((a, b) => a.path.split('/').length - b.path.split('/').length)) {
    if (!entry.path) continue;
    const retained = await withParent(entry.path, async (parent, name) => {
    const target = `${parent.access}/${name}`;
    const present = await lstatMaybe(target);
    if (entry.kind === 'directory') {
      if (!present) { await parent.check(); await fs.mkdir(target, { mode: 0o700 }); }
      else if (!present.isDirectory() || present.isSymbolicLink()) unsafe();
    } else if (entry.kind === 'symlink') {
      if (!present) { await parent.check(); await fs.symlink(entry.target!, target); }
      else if (!present.isSymbolicLink() || await fs.readlink(target) !== entry.target) unsafe('A retained trash link changed. Its current target was preserved.');
    } else if (!present) return false;
    else if (!present.isFile() || present.isSymbolicLink() || present.size !== entry.size) unsafe('A retained trash file changed. Its current contents were preserved.');
    else {
      const file = await fs.open(target, READ_FLAGS);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || !sameIdentity(stat, identity(present))) unsafe();
        await parent.check();
        if ((stat.mode & 0o7777) !== entry.mode) {
          if (stat.nlink > 1) unsafe('A trash file shares its inode with another path. Its permissions were not changed.');
          await file.chmod(entry.mode);
        }
      } finally { await file.close(); }
    }
    await parent.check();
    return true;
    });
    if (!retained) return false;
  }
  for (const entry of snapshot.filter(entry => entry.kind === 'directory').sort((a, b) => b.path.split('/').length - a.path.split('/').length)) {
    if (!entry.path) {
      await root.check();
      if (((await root.handle.stat()).mode & 0o7777) !== entry.mode) await root.handle.chmod(entry.mode);
    } else await withParent(entry.path, async (parent, name) => {
      const directory = await PinnedDirectory.open(path.join(parent.absolute, name), `${parent.access}/${name}`);
      try { await parent.check(); await directory.check(); if (((await directory.handle.stat()).mode & 0o7777) !== entry.mode) await directory.handle.chmod(entry.mode); }
      finally { await directory.close(); }
    });
  }
  return true;
  } finally { await root.close(); }
}

/** Copies into an exclusively allocated root; every leaf is create-only too. */
export async function copyTree(source: string, destination: string, snapshot: TreeMetadataEntry[], expectedDestination?: NativeIdentity): Promise<void> {
  const state = budget();
  const buffer = Buffer.allocUnsafe(256 * 1024);
  const walk = async (from: PinnedDirectory, to: PinnedDirectory, relative: string): Promise<void> => {
    await from.check(); await to.check();
    checkBudget(state, relative);
    const sourceStat = await from.handle.stat();
    for (const name of await fs.readdir(from.access)) {
      nameSafe(name);
      await from.check(); await to.check();
      const childPath = relative ? `${relative}/${name}` : name;
      const input = `${from.access}/${name}`;
      const output = `${to.access}/${name}`;
      const stat = await fs.lstat(input);
      if (stat.isSymbolicLink()) {
        checkBudget(state, childPath);
        await fs.symlink(await fs.readlink(input), output);
      } else if (stat.isDirectory()) {
        await fs.mkdir(output, { mode: 0o700 });
        const childFrom = await PinnedDirectory.open(path.join(from.absolute, name), input);
        const childTo = await PinnedDirectory.open(path.join(to.absolute, name), output);
        try { await walk(childFrom, childTo, childPath); }
        finally { await childFrom.close(); await childTo.close(); }
      } else if (stat.isFile()) {
        checkBudget(state, childPath);
        const inputFile = await fs.open(input, READ_FLAGS);
        let outputFile: FileHandle | undefined;
        try {
          const before = await inputFile.stat();
          if (!before.isFile() || !sameIdentity(before, identity(stat))) unsafe();
          outputFile = await fs.open(output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
          let copied = 0;
          while (true) {
            const { bytesRead } = await inputFile.read(buffer, 0, buffer.length, null);
            if (!bytesRead) break;
            copied += bytesRead; state.bytes += bytesRead;
            if (state.bytes > MAX_TREE_BYTES || Date.now() > state.deadline) limit();
            let written = 0;
            while (written < bytesRead) written += (await outputFile.write(buffer, written, bytesRead - written, null)).bytesWritten;
          }
          const after = await inputFile.stat();
          if (copied !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) unsafe('A trash file changed while being restored. The original trash copy was retained.');
          await outputFile.chmod(before.mode & 0o7777);
        } finally { await inputFile.close(); await outputFile?.close(); }
      } else unsafe('Trash contains a special file that cannot be restored safely.');
    }
    await from.check(); await to.check();
    // The caller removes its root ownership marker before applying this last mode.
    if (relative) await to.handle.chmod(sourceStat.mode & 0o7777);
  };
  const from = await PinnedDirectory.open(source);
  const to = await PinnedDirectory.open(destination);
  try { if (expectedDestination && !sameIdentity(await to.handle.stat(), expectedDestination)) unsafe(); await walk(from, to, ''); }
  catch (error) { if (errno(error, 'EEXIST')) conflict(); throw error; }
  finally { await from.close(); await to.close(); }
  const actual = await captureTree(source);
  if (JSON.stringify(actual) !== JSON.stringify(snapshot)) unsafe('Trash contents changed during restoration. The original copy was retained.');
}

/** A bounded descriptor walk unlinks links themselves and cannot follow them outside the entry. */
export async function removeTree(absolute: string, expectedRoot?: NativeIdentity): Promise<void> {
  const state = budget();
  const stat = await lstatMaybe(absolute);
  if (!stat) return;
  if (!stat.isDirectory() || stat.isSymbolicLink()) unsafe('The trash content root changed. It was not permanently deleted.');
  if (expectedRoot && !sameIdentity(stat, expectedRoot)) unsafe('The owned directory changed before cleanup. Its replacement was preserved.');
  const walk = async (directory: PinnedDirectory, relative: string): Promise<void> => {
    await directory.check();
    checkBudget(state, relative);
    const current = await directory.handle.stat();
    if (current.dev !== stat.dev) unsafe('The trash tree crosses a filesystem boundary. No external directory was removed.');
    // Explicit permanent deletion may clear read-only directories that belong
    // to this entry. The handle pins this permission change to the owned inode.
    if ((current.mode & 0o700) !== 0o700) await directory.handle.chmod((current.mode & 0o7777) | 0o700);
    for (const name of await fs.readdir(directory.access)) {
      nameSafe(name);
      await directory.check();
      const access = `${directory.access}/${name}`;
      const childPath = relative ? `${relative}/${name}` : name;
      const before = await fs.lstat(access);
      if (before.dev !== stat.dev) unsafe('The trash tree crosses a filesystem boundary. No external content was removed.');
      if (before.isDirectory() && !before.isSymbolicLink()) {
        const child = await PinnedDirectory.open(path.join(directory.absolute, name), access);
        try { if (!sameIdentity(await child.handle.stat(), identity(before))) unsafe(); await walk(child, childPath); } finally { await child.close(); }
        await directory.check();
        if (!sameIdentity(await fs.lstat(access), identity(before))) unsafe();
        await fs.rmdir(access);
      } else {
        checkBudget(state, childPath);
        await directory.check();
        if (!sameIdentity(await fs.lstat(access), identity(before))) unsafe();
        await fs.unlink(access);
      }
    }
    await directory.check();
  };
  const parent = await PinnedDirectory.open(path.dirname(absolute));
  let root: PinnedDirectory | undefined;
  try {
    await parent.check();
    const access = `${parent.access}/${path.basename(absolute)}`;
    root = await PinnedDirectory.open(absolute, access);
    if (!sameIdentity(await root.handle.stat(), expectedRoot ?? identity(stat))) unsafe('The owned directory changed before cleanup. Its replacement was preserved.');
    await walk(root, '');
    await parent.check(); await root.check();
    if (!sameIdentity(await fs.lstat(access), identity(stat))) unsafe();
    await fs.rmdir(access);
  } finally { await root?.close(); await parent.close(); }
}
