import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, readlink, realpath, rmdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AppContext } from './context';
import { HttpError } from './errors';
import { captureTree, checkedDirectory, copyTree, errno, identity, lstatMaybe, PinnedDirectory, readText, removeTree, sameIdentity, within } from './workspace-trash/filesystem';
import type { NativeIdentity } from './workspace-trash/types';

const RECORD_PREFIX = 'github-import-stage-';
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const REPOSITORY = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}\/[a-zA-Z0-9_.-]{1,100}$/;
const MAX_RECORDS = 1024;
const runtimeId = randomUUID();
const active = new Set<string>();
const initializations = new WeakMap<AppContext, Promise<GithubImportRecovery[]>>();

export interface GithubImportRecovery { workspaceId: string; workspaceName: string; stageId: string; reason: string }
interface Owner { pid: number; started: string; boot: string; namespace: string; runtime: string }
interface StageRecord {
  version: 1;
  id: string;
  workspaceId: string;
  fullName: string;
  parent: string;
  native: NativeIdentity;
  owner: Owner;
  cloneExited: boolean;
  phase: 'ready' | 'cloning' | 'publishing' | 'cleanup' | 'retained';
  retained: boolean;
}

const stageKey = (id: string) => `${RECORD_PREFIX}${id}`;
// Temporary stages share a process-wide namespace. A copied journal in another
// context must not turn a currently active stage into an abandoned one.
const activeKey = (_ctx: AppContext, id: string) => id;
const stagePath = (record: StageRecord) => path.join(record.parent, record.id);

function unsafe(): never {
  throw new HttpError(409, 'GitHub import staging ownership could not be verified. Existing files were retained.', 'GITHUB_IMPORT_STAGING_UNSAFE');
}

async function owner(): Promise<Owner> {
  const [stat, boot, namespace] = await Promise.all([
    readFile(`/proc/${process.pid}/stat`, 'utf8'), readFile('/proc/sys/kernel/random/boot_id', 'utf8'), readlink('/proc/self/ns/pid'),
  ]);
  const started = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19];
  if (!/^[0-9]+$/.test(started) || !/^[a-f0-9-]{36}$/.test(boot.trim()) || !/^pid:\[[0-9]+\]$/.test(namespace)) unsafe();
  return { pid: process.pid, started, boot: boot.trim(), namespace, runtime: runtimeId };
}

async function ownerState(record: StageRecord, current: Owner): Promise<'local' | 'live' | 'gone' | 'unknown'> {
  if (record.owner.boot !== current.boot || record.owner.namespace !== current.namespace) return 'unknown';
  if (record.owner.pid === current.pid && record.owner.started === current.started && record.owner.runtime === runtimeId) return 'local';
  try {
    const source = await readFile(`/proc/${record.owner.pid}/stat`, 'utf8');
    const fields = source.slice(source.lastIndexOf(')') + 2).trim().split(/\s+/);
    return fields[19] === record.owner.started && !['Z', 'X'].includes(fields[0]) ? 'live' : 'gone';
  } catch (error) { return errno(error, 'ENOENT') || errno(error, 'ESRCH') ? 'gone' : 'unknown'; }
}

async function checkedTemporaryParent(ctx: AppContext, parent: string): Promise<string> {
  const systemTemporary = await realpath('/tmp');
  const data = await realpath(ctx.config.dataDir);
  const publicData = await realpath('/data').catch(error => { if (errno(error, 'ENOENT')) return '/data'; throw error; });
  if (!path.isAbsolute(parent) || path.resolve(parent) !== parent || parent.length > 4096
    || path.basename(parent) !== `codex-github-imports-${process.getuid?.() ?? 0}`
    || !within(systemTemporary, parent) || within(data, parent) || within(publicData, parent)) unsafe();
  await checkedDirectory(systemTemporary, path.dirname(parent));
  return parent;
}

async function temporaryParent(ctx: AppContext): Promise<string> {
  // Uncommitted clone bytes must never enter public/durable workspace storage.
  // In particular, TMPDIR=/data (including symlink aliases) is rejected.
  const base = await realpath(tmpdir());
  const parent = await checkedTemporaryParent(ctx, path.join(base, `codex-github-imports-${process.getuid?.() ?? 0}`));
  const pinned = await PinnedDirectory.open(base);
  try {
    await mkdir(`${pinned.access}/${path.basename(parent)}`, { mode: 0o700 }).catch(error => { if (!errno(error, 'EEXIST')) throw error; });
    await pinned.check();
    await checkedDirectory(base, parent);
    const current = await lstatMaybe(parent);
    if (!current || current.uid !== (process.getuid?.() ?? current.uid) || (current.mode & 0o077) !== 0) unsafe();
  } finally { await pinned.close(); }
  return parent;
}

function checkedRecord(value: unknown, id: string): StageRecord {
  const record = value as Partial<StageRecord> | null;
  if (!record || record.version !== 1 || record.id !== id || !ID.test(id)
    || typeof record.workspaceId !== 'string' || !ID.test(record.workspaceId)
    || typeof record.fullName !== 'string' || !REPOSITORY.test(record.fullName)
    || typeof record.parent !== 'string' || !path.isAbsolute(record.parent)
    || !record.native || !Number.isSafeInteger(record.native.dev) || !Number.isSafeInteger(record.native.ino)
    || !record.owner || !Number.isSafeInteger(record.owner.pid) || record.owner.pid < 1
    || typeof record.owner.started !== 'string' || !/^[0-9]+$/.test(record.owner.started)
    || !/^[a-f0-9-]{36}$/.test(record.owner.boot) || !/^pid:\[[0-9]+\]$/.test(record.owner.namespace)
    || !ID.test(record.owner.runtime) || typeof record.cloneExited !== 'boolean' || typeof record.retained !== 'boolean'
    || !['ready', 'cloning', 'publishing', 'cleanup', 'retained'].includes(record.phase ?? '')) unsafe();
  return record as StageRecord;
}

async function forget(ctx: AppContext, record: StageRecord): Promise<void> {
  // A serialized null invalidates this store's cached value before removing the
  // module-owned journal. No account/credential or workspace record is touched.
  await ctx.store.write(stageKey(record.id), null);
  await unlink(path.join(ctx.config.stateDir, `${stageKey(record.id)}.json`)).catch(error => { if (!errno(error, 'ENOENT')) throw error; });
}

async function removeOwnedStage(ctx: AppContext, record: StageRecord): Promise<void> {
  if (!record.cloneExited) unsafe();
  await checkedTemporaryParent(ctx, record.parent);
  const parent = await lstatMaybe(record.parent);
  if (!parent) return;
  await checkedDirectory(await realpath('/tmp'), record.parent);
  const found = await lstatMaybe(stagePath(record));
  if (!found) return;
  if (!found.isDirectory() || found.isSymbolicLink() || !sameIdentity(found, record.native)) unsafe();
  await removeTree(stagePath(record), record.native);
}

async function recovery(ctx: AppContext, workspaceId: string, stageId: string, reason: string): Promise<GithubImportRecovery> {
  let workspaceName = 'GitHub import';
  if (ID.test(workspaceId)) {
    try {
      const workspace = await ctx.workspaces.getRegistration(workspaceId, { includeArchived: true });
      if (typeof workspace.name === 'string' && workspace.name.trim() && workspace.name.length <= 80
        && !/[\u0000-\u001f\u007f]/.test(workspace.name)) workspaceName = workspace.name.trim();
    } catch { /* Metadata-only lookup is optional; never grant filesystem access. */ }
  }
  return { workspaceId, workspaceName, stageId, reason };
}

/** Cleanup only confirmed, abandoned private stages; never replay native Git. */
async function recover(ctx: AppContext): Promise<GithubImportRecovery[]> {
  await checkedDirectory(ctx.config.dataDir, ctx.config.stateDir);
  const files = (await readdir(ctx.config.stateDir)).filter(name => name.startsWith(RECORD_PREFIX) && name.endsWith('.json')).sort();
  const currentOwner = await owner();
  const result: GithubImportRecovery[] = [];
  for (const file of files.slice(0, MAX_RECORDS)) {
    const id = file.slice(RECORD_PREFIX.length, -5);
    if (!ID.test(id) || active.has(activeKey(ctx, id))) continue;
    let record: StageRecord;
    let serialized: string;
    try { serialized = await readText(path.join(ctx.config.stateDir, file), 16 * 1024); }
    catch (error) {
      if (errno(error, 'ENOENT')) continue; // A completed import retired its journal after readdir.
      result.push(await recovery(ctx, '', id, 'Saved import staging ownership is invalid. No files were removed.'));
      continue;
    }
    try {
      const value: unknown = JSON.parse(serialized);
      if (value === null) continue;
      record = checkedRecord(value, id);
      await checkedTemporaryParent(ctx, record.parent);
    } catch {
      result.push(await recovery(ctx, '', id, 'Saved import staging ownership is invalid. No files were removed.'));
      continue;
    }
    const state = await ownerState(record, currentOwner);
    if (state === 'live') continue;
    if (!record.cloneExited || state === 'unknown') {
      result.push(await recovery(ctx, record.workspaceId, record.id, 'Import completion could not be confirmed after interruption. Temporary clone bytes may be unavailable; no clone was replayed.'));
      continue;
    }
    try {
      await removeOwnedStage(ctx, record);
      const workspace = await ctx.workspaces.get(record.workspaceId).catch(error => {
        if (error instanceof HttpError && error.status === 404) return undefined;
        throw error;
      });
      if (!workspace || workspace.source?.kind === 'github' && workspace.source.fullName === record.fullName) {
        await forget(ctx, record);
      } else {
        result.push(await recovery(ctx, record.workspaceId, record.id, 'Import did not finish. Existing workspace files were retained; inspect the workspace before retrying.'));
      }
    } catch {
      result.push(await recovery(ctx, record.workspaceId, record.id, 'Temporary import cleanup could not verify ownership or finish safely. Existing workspace files were retained.'));
    }
  }
  if (files.length > MAX_RECORDS) result.push(await recovery(ctx, '', '', 'The import recovery scan reached its limit. Remaining temporary stages were retained.'));
  return result;
}

async function recoverAvailable(ctx: AppContext): Promise<GithubImportRecovery[]> {
  try { return await recover(ctx); }
  catch {
    return [await recovery(ctx, '', '', 'Import recovery is temporarily unavailable. Unverified temporary stages and existing workspace files were left unchanged.')];
  }
}

/** Root calls this after workspace initialization, before request admission. */
export function initializeGithubImports(ctx: AppContext): Promise<GithubImportRecovery[]> {
  let pending = initializations.get(ctx);
  if (!pending) {
    pending = recoverAvailable(ctx);
    initializations.set(ctx, pending);
  }
  return pending;
}

/** Authenticated UI status contains no credentials, host paths or command data. */
export async function githubImportRecovery(ctx: AppContext): Promise<GithubImportRecovery[]> {
  await initializeGithubImports(ctx);
  return recoverAvailable(ctx);
}

export class GithubImportStage {
  private cloneExited = true;

  private constructor(private readonly ctx: AppContext, private record: StageRecord, private readonly directory: PinnedDirectory) {}

  get repositoryPath(): string { return path.join(this.directory.absolute, 'repository'); }

  static async create(ctx: AppContext, workspaceId: string, fullName: string): Promise<GithubImportStage> {
    if (!ID.test(workspaceId) || !REPOSITORY.test(fullName) || active.size >= 8) throw new HttpError(409, 'Wait for another repository import to finish.', 'GITHUB_IMPORT_LIMIT');
    const id = randomUUID();
    // Reserve before any await so overlapping allocations cannot pass the cap.
    active.add(activeKey(ctx, id));
    let parentDirectory: PinnedDirectory | undefined;
    let directory: PinnedDirectory | undefined;
    try {
      await initializeGithubImports(ctx);
      await checkedDirectory(ctx.config.dataDir, ctx.config.stateDir);
      const parent = await temporaryParent(ctx);
      parentDirectory = await PinnedDirectory.open(parent);
      const absolute = path.join(parent, id);
      await mkdir(`${parentDirectory.access}/${id}`, { mode: 0o700 });
      await parentDirectory.check();
      directory = await PinnedDirectory.open(absolute, `${parentDirectory.access}/${id}`);
      const record: StageRecord = { version: 1, id, workspaceId, fullName, parent, native: identity(await directory.handle.stat()),
        owner: await owner(), cloneExited: true, phase: 'ready', retained: false };
      // Ownership is durable before Git can receive the temporary destination.
      await ctx.store.write(stageKey(id), record);
      await parentDirectory.close();
      parentDirectory = undefined;
      return new GithubImportStage(ctx, record, directory);
    } catch (error) {
      // Git has not received this directory. Remove only our still-empty inode;
      // never guess ownership if allocation or journal publication was partial.
      if (directory && parentDirectory) {
        try {
          await directory.check(); await parentDirectory.check();
          const current = await lstatMaybe(`${parentDirectory.access}/${id}`);
          if (current && sameIdentity(current, identity(await directory.handle.stat())) && !(await readdir(directory.access)).length) {
            await rmdir(`${parentDirectory.access}/${id}`);
          }
        } catch { /* Retain an unprovable scratch entry without native replay. */ }
      }
      try { await directory?.close(); }
      finally { active.delete(activeKey(ctx, id)); }
      throw error;
    } finally { await parentDirectory?.close(); }
  }

  private async save(changes: Partial<StageRecord>): Promise<void> {
    const next = { ...this.record, ...changes };
    await this.ctx.store.write(stageKey(next.id), next);
    this.record = next;
  }

  async clone(run: (destination: string) => Promise<void>): Promise<void> {
    await this.directory.check();
    await this.save({ phase: 'cloning', cloneExited: false });
    this.cloneExited = false;
    try { await run(this.repositoryPath); }
    finally {
      // The callback must settle only after actual Git close (or failed spawn).
      this.cloneExited = true;
      await this.save({ phase: 'ready', cloneExited: true });
    }
  }

  async publish(destination: string, expectedDestination: NativeIdentity): Promise<void> {
    if (!this.cloneExited) unsafe();
    await this.directory.check();
    await this.save({ phase: 'publishing' });
    const snapshot = await captureTree(this.repositoryPath);
    // Every directory and leaf is create-only. Concurrent user files cause a
    // conflict, never overwrite, and any partly published visible root is kept.
    await copyTree(this.repositoryPath, destination, snapshot, expectedDestination);
  }

  async finish(retained: boolean): Promise<void> {
    try {
      await this.save({ phase: retained ? 'retained' : 'cleanup', retained, cloneExited: this.cloneExited });
      if (!this.cloneExited) return;
      await removeOwnedStage(this.ctx, this.record);
      if (!retained) await forget(this.ctx, this.record);
    } catch {
      // The durable journal remains visible to recovery. Never hide a successful
      // publication or erase a user-visible directory because scratch cleanup
      // failed; startup/status recovery retries only proven abandoned stages.
    } finally {
      try { await this.directory.close(); }
      finally { active.delete(activeKey(this.ctx, this.record.id)); }
    }
  }
}
