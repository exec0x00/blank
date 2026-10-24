import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { AppContext } from '../context';
import { HttpError } from '../errors';

export const WORKTREE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const WORKSPACE_ID = /^[a-zA-Z0-9_-]{1,128}$/;
export const missing = (error: unknown): boolean => !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';

export function unsafeWorktree(message = 'The Git checkout no longer has a valid managed storage location. Its files were left unchanged.'): never {
  throw new HttpError(409, message, 'UNSAFE_WORKTREE');
}

export function normalizedPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 1 && value.length <= 4096 && path.isAbsolute(value)
    && path.resolve(value) === value && !/[\u0000-\u001f\u007f*]/.test(value);
}

export function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Check every native path component; a realpath prefix by itself admits aliases. */
export async function directoryUnder(root: string, target: string): Promise<string> {
  if (!normalizedPath(root) || !normalizedPath(target) || !within(root, target)) unsafeWorktree();
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || await realpath(root) !== root) unsafeWorktree();
  let current = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) unsafeWorktree();
  }
  if (await realpath(target) !== target) unsafeWorktree();
  return target;
}

export async function workspaceStorage(ctx: AppContext): Promise<string> {
  const { dataDir, workspacesDir } = ctx.config;
  if (dataDir === workspacesDir) unsafeWorktree();
  return directoryUnder(dataDir, workspacesDir);
}

export async function workspaceRoot(ctx: AppContext, declared: string): Promise<string> {
  const base = await workspaceStorage(ctx);
  if (base === declared) unsafeWorktree();
  return directoryUnder(base, declared);
}

export async function regularMetadata(file: string, optional = false): Promise<boolean> {
  const stat = await lstat(file).catch(error => { if (optional && missing(error)) return undefined; throw error; });
  if (!stat) return false;
  if (!stat.isFile() || stat.isSymbolicLink()) unsafeWorktree('Git metadata must contain ordinary files, not symbolic links or special files.');
  return true;
}

/** NOFOLLOW and a capped read also reject a file replaced with a pipe during validation. */
export async function readMetadata(file: string, maxBytes = 16 * 1024): Promise<string> {
  let handle;
  try { handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && ['ELOOP', 'ENOTDIR'].includes(String(error.code))) unsafeWorktree();
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) unsafeWorktree('Git metadata is invalid or exceeds its size limit.');
    const buffer = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > maxBytes) unsafeWorktree('Git metadata is invalid or exceeds its size limit.');
    const latest = await lstat(file);
    if (!latest.isFile() || latest.isSymbolicLink() || latest.dev !== stat.dev || latest.ino !== stat.ino
      || latest.size !== stat.size || latest.mtimeMs !== stat.mtimeMs || latest.ctimeMs !== stat.ctimeMs) unsafeWorktree('Git metadata changed during validation. Refresh and try again.');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)); }
    catch { return unsafeWorktree('Git metadata contains an unsupported path encoding.'); }
  } finally { await handle.close(); }
}

export function metadataPath(contents: string, relativeTo: string, prefix = ''): string {
  const line = contents.replace(/\r?\n$/, '');
  if (!line.startsWith(prefix)) unsafeWorktree('The checkout has invalid Git link metadata.');
  const value = line.slice(prefix.length);
  if (!value || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) unsafeWorktree('The checkout has invalid Git link metadata.');
  const resolved = path.resolve(relativeTo, value);
  if (!normalizedPath(resolved)) unsafeWorktree();
  return resolved;
}
