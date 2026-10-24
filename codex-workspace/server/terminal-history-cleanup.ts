import { createHash } from 'node:crypto';
import { constants, promises as fs, type BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from './config';
import { HttpError } from './errors';
import type { WorkspaceArtifactCleanupRequest } from './workspace-trash/service';
import { workspaceActivityKinds } from './worktrees/activity';

type CleanupContext = { config: Pick<AppConfig, 'dataDir' | 'homeDir' | 'workspacesDir'> };
interface PinnedDirectory { path: string; access: string; handle: FileHandle; identity: BigIntStats }
const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const fileFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | constants.O_NOCTTY;
const sameNode = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino;
const fingerprint = (value: BigIntStats) => `${value.dev}:${value.ino}:${value.size}:${value.mtimeNs}:${value.ctimeNs}`;
const errno = (error: unknown, code: string) => (error as NodeJS.ErrnoException | null)?.code === code;
const normalized = (value: unknown): value is string => typeof value === 'string' && value.length > 1 && value.length <= 4096
  && path.isAbsolute(value) && path.resolve(value) === value && value.split(path.sep).length <= 64 && !/[\u0000-\u001f\u007f]/.test(value);
const within = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

function failure(reason: 'UNSAFE' | 'CHANGED' | 'BUSY' | 'IO'): HttpError {
  return new HttpError(409, reason === 'BUSY'
    ? 'Terminal history cleanup requires the workspace removal lock and completed terminal activity.'
    : 'Terminal history storage or ownership could not be verified. Remaining history was retained and permanent deletion can be retried.',
  `TERMINAL_HISTORY_CLEANUP_${reason}`);
}

async function lstatMaybe(access: string): Promise<BigIntStats | undefined> {
  try { return await fs.lstat(access, { bigint: true }); }
  catch (error) { if (errno(error, 'ENOENT')) return; throw error; }
}

async function pinDirectory(directory: string, access: string): Promise<PinnedDirectory | undefined> {
  const before = await lstatMaybe(access);
  if (!before) return;
  if (!before.isDirectory() || before.isSymbolicLink() || await fs.realpath(directory) !== directory) throw failure('UNSAFE');
  const handle = await fs.open(access, directoryFlags);
  try {
    const identity = await handle.stat({ bigint: true });
    if (!identity.isDirectory() || !sameNode(identity, before)
      || await fs.realpath(`/proc/self/fd/${handle.fd}`) !== directory) throw failure('CHANGED');
    return { path: directory, access, handle, identity };
  } catch (error) { await handle.close(); throw error; }
}

async function checkDirectories(directories: PinnedDirectory[]): Promise<void> {
  for (const directory of directories) {
    const named = await lstatMaybe(directory.access);
    const opened = await directory.handle.stat({ bigint: true });
    if (!named?.isDirectory() || named.isSymbolicLink() || !sameNode(named, directory.identity) || !sameNode(opened, directory.identity)
      || await fs.realpath(directory.path) !== directory.path
      || await fs.realpath(`/proc/self/fd/${directory.handle.fd}`) !== directory.path) throw failure('CHANGED');
  }
}

function regularHistory(value: BigIntStats, directory: PinnedDirectory): void {
  if (!value.isFile() || value.isSymbolicLink() || value.nlink !== 1n || value.dev !== directory.identity.dev) throw failure('UNSAFE');
}

/**
 * Permanent-purge leaf only. The caller owns the deletion generation and the
 * exclusive workspace gate; original mode='trash' also reaches here at purge.
 * No workspace/runtime initialization, directory creation, history reads or
 * process signals occur. Only the terminal's exact workspace-derived filename
 * is eligible; shared history and every sibling/configuration file stay intact.
 */
export async function cleanupWorkspaceTerminalHistory(ctx: CleanupContext, request: WorkspaceArtifactCleanupRequest): Promise<void> {
  const { dataDir, homeDir, workspacesDir } = ctx.config;
  const workspaceId = request.workspaceId;
  if (typeof workspaceId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(workspaceId) || ![dataDir, homeDir, workspacesDir].every(normalized)
    || !within(dataDir, homeDir)) throw failure('UNSAFE');
  const filename = `${createHash('sha256').update(workspaceId).digest('hex').slice(0, 32)}.history`;
  const directories: PinnedDirectory[] = [];
  let history: FileHandle | undefined;
  let authorityFailed = false, authorityError: unknown;
  const assertCurrent = async () => {
    try { await request.assertCurrent(); }
    catch (error) { authorityFailed = true; authorityError = error; throw error; }
    if (request.workspaceId !== workspaceId) throw failure('CHANGED');
    // This is an observation, never another acquisition of the caller's gate.
    // Real PTY leases include their conservatively tracked native descendants.
    const activity = workspaceActivityKinds(workspacesDir, workspaceId);
    if (!activity.exclusive || Object.values(activity.counts).some(count => (count ?? 0) > 0)) throw failure('BUSY');
  };
  const check = async () => { await assertCurrent(); await checkDirectories(directories); };
  try {
    await assertCurrent();
    const data = await pinDirectory(dataDir, dataDir);
    if (!data) { await assertCurrent(); return; }
    directories.push(data);
    let parent = data;
    const components = [...path.relative(dataDir, homeDir).split(path.sep), '.local', 'state', 'terminal-history'];
    for (const component of components) {
      await check();
      const next = await pinDirectory(path.join(parent.path, component), `/proc/self/fd/${parent.handle.fd}/${component}`);
      if (!next) { await check(); return; }
      directories.push(next); parent = next;
    }
    await check();
    const access = `/proc/self/fd/${parent.handle.fd}/${filename}`;
    const before = await lstatMaybe(access);
    if (!before) { await check(); return; }
    regularHistory(before, parent);
    history = await fs.open(access, fileFlags);
    const opened = await history.stat({ bigint: true });
    regularHistory(opened, parent);
    if (fingerprint(opened) !== fingerprint(before)) throw failure('CHANGED');
    await check();
    const named = await lstatMaybe(access);
    if (!named) { await check(); return; }
    regularHistory(named, parent);
    const current = await history.stat({ bigint: true });
    regularHistory(current, parent);
    if (fingerprint(named) !== fingerprint(before) || fingerprint(current) !== fingerprint(before)) throw failure('CHANGED');
    // App writers are fenced by the caller's gate. The final no-follow name
    // check detects outside edits; native unlink has no distributed CAS claim.
    await fs.unlink(access).catch(error => { if (!errno(error, 'ENOENT')) throw error; });
    await check();
    if (await lstatMaybe(access)) throw failure('CHANGED');
    await check();
  } catch (error) {
    if ((authorityFailed && error === authorityError) || error instanceof HttpError) throw error;
    if (errno(error, 'ELOOP') || errno(error, 'ENOTDIR')) throw failure('UNSAFE');
    if (errno(error, 'ENOENT')) throw failure('CHANGED');
    throw failure('IO');
  } finally {
    // These descriptors are read-only; closing cannot rewrite a history file.
    await Promise.allSettled([...(history ? [history.close()] : []), ...directories.reverse().map(directory => directory.handle.close())]);
  }
}
