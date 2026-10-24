import fs from 'node:fs/promises';
import { constants, type BigIntStats } from 'node:fs';
import path from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../config';
import { HttpError } from '../errors';
import { setWorkspaceRecoveryBarrier, workspaceRecoveryBarrier } from '../worktrees/activity';

type Config = Pick<AppConfig, 'dataDir' | 'stateDir' | 'workspacesDir' | 'sessionSecret'>;
export interface LegacyRewindBarrierStatus {
  pendingOperations: number;
  blockedWorkspaces: string[];
  recoveryIds: string[];
}
export interface LegacyRewindBarrierOptions {
  /** Smaller constructor-only limits for bounded callers/fixtures. */
  maxDirectoryEntries?: number;
  maxRecords?: number;
  maxReadBytes?: number;
  timeoutMs?: number;
}
export const LEGACY_REWIND_BARRIER_LIMITS = Object.freeze({
  directoryEntries: 250_000, records: 4096, readBytes: 128 * 1024 * 1024,
  recordValueBytes: 8 * 1024 * 1024, recordWireBytes: 32 * 1024 * 1024 + 4096,
  familyMembers: 100_000, timeoutMs: 30_000,
});
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const WORKSPACE = /^[a-zA-Z0-9_-]{1,128}$/;
const THREAD = /^thr_[a-f0-9]{32}$/, HASH = /^[a-f0-9]{64}$/;
const HISTORY = /^history_[a-f0-9]{32}$/, TURN = /^[a-z0-9_]{1,160}$/;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const sameNode = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino;
const fingerprint = (value: BigIntStats) => [value.dev, value.ino, value.mode, value.nlink, value.size, value.mtimeNs, value.ctimeNs].join(':');
const message = 'An unfinished previous file rewind needs explicit recovery review. Current files, staging and conversation backups were retained; native Codex and site mutations cannot enter this workspace.';
const invalid = () => new HttpError(409, 'Previous file rewind metadata could not be verified safely. Its files and backups were retained; startup cannot admit workspace mutations.', 'LEGACY_REWIND_STATE_INVALID');
const changed = () => new HttpError(409, 'Previous file rewind metadata changed during inspection. Its files and existing barriers were retained; retry startup after reviewing the change.', 'LEGACY_REWIND_STATE_CHANGED');
const limitError = () => new HttpError(413, 'Previous file rewind metadata exceeds the bounded startup inspection. Its files and backups were retained for explicit review.', 'LEGACY_REWIND_STATE_LIMIT');

interface Name { name: string; kind: 'operation' | 'block'; id: string }
interface Operation {
  recoveryId: string; workspaceId: string; threadId: string; familyIds: string[];
  selectionVersion: string; backupId: string; beforeTurnId: string; blocking: boolean;
}
interface ReadRecord { name: Name; operation: Operation; version: string }

function operation(value: unknown, file: Name): Operation {
  if (!object(value) || value.version !== 1 || typeof value.workspaceId !== 'string' || !WORKSPACE.test(value.workspaceId)
    || typeof value.threadId !== 'string' || !THREAD.test(value.threadId) || typeof value.recoveryId !== 'string' || !UUID.test(value.recoveryId)
    || file.kind === 'operation' && value.recoveryId !== file.id || !object(value.selection) || value.selection.planId !== value.recoveryId
    || typeof value.selection.version !== 'string' || !HASH.test(value.selection.version)
    || !Array.isArray(value.familyIds) || !value.familyIds.length || value.familyIds.length > 10_002
    || value.familyIds.some(id => typeof id !== 'string' || !WORKSPACE.test(id))
    || new Set(value.familyIds).size !== value.familyIds.length || !value.familyIds.includes(value.workspaceId)
    || file.kind === 'block' && !value.familyIds.includes(file.id)
    || !['pending', 'complete', 'recovery_required', 'kept_current'].includes(String(value.state))
    || typeof value.blocking !== 'boolean' || !object(value.completion)
    || value.completion.workspaceId !== value.workspaceId || value.completion.threadId !== value.threadId
    || value.completion.recoveryId !== value.recoveryId
    || typeof value.completion.backupId !== 'string' || !HISTORY.test(value.completion.backupId)
    || typeof value.completion.beforeTurnId !== 'string' || !TURN.test(value.completion.beforeTurnId)) throw invalid();
  return { recoveryId: value.recoveryId, workspaceId: value.workspaceId, threadId: value.threadId,
    familyIds: [...value.familyIds as string[]].sort(), selectionVersion: value.selection.version,
    backupId: value.completion.backupId, beforeTurnId: value.completion.beforeTurnId,
    blocking: value.blocking || value.state === 'pending' || value.state === 'recovery_required' };
}
function identity(value: Operation): string {
  const { blocking: _blocking, ...owner } = value;
  return JSON.stringify(owner);
}
function selectedName(name: string): Name | undefined {
  const match = /^file-rewind-(operation|block)-(.*)\.json$/.exec(name);
  if (!match) return;
  const kind = match[1] as Name['kind'], id = match[2];
  if (!(kind === 'operation' ? UUID : WORKSPACE).test(id)) throw invalid();
  return { name, kind, id };
}
function maximum(value: number | undefined, allowed: number): number {
  if (value === undefined) return allowed;
  if (!Number.isSafeInteger(value) || value < 1 || value > allowed) throw new TypeError('Choose bounded legacy rewind inspection limits.');
  return value;
}
function configuration(config: Config): { state: string; workspaces: string; data: string } {
  if (!config || [config.dataDir, config.stateDir, config.workspacesDir].some(value => typeof value !== 'string'
    || !path.isAbsolute(value) || path.resolve(value) !== value) || typeof config.sessionSecret !== 'string' || config.sessionSecret.length < 32) {
    throw new HttpError(500, 'Legacy recovery requires the configured native storage roots and signing identity.', 'LEGACY_REWIND_CONFIGURATION');
  }
  for (const target of [config.stateDir, config.workspacesDir]) {
    const relative = path.relative(config.dataDir, target);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      throw new HttpError(500, 'Legacy recovery storage must remain inside its configured data root.', 'LEGACY_REWIND_CONFIGURATION');
    }
  }
  return { data: config.dataDir, state: config.stateDir, workspaces: config.workspacesDir };
}

/** Compatibility protection only: read signed operation/block records and
 * restore in-memory admission barriers before any site/CLI writer starts.
 * Never initialize the retired engine/FileRewindService, read a checkout/index,
 * open transcript/plan/backup payloads, repair CAS state, prune, clear a barrier,
 * create a timer or replay/settle a transaction. A signed record can establish a
 * conservative block even if its backup needs further human inspection.
 */
export async function restoreLegacyRewindBarriers(config: Config,
  options: LegacyRewindBarrierOptions = {}): Promise<LegacyRewindBarrierStatus> {
  const roots = configuration(config), maxEntries = maximum(options.maxDirectoryEntries, LEGACY_REWIND_BARRIER_LIMITS.directoryEntries);
  const maxRecords = maximum(options.maxRecords, LEGACY_REWIND_BARRIER_LIMITS.records);
  const maxBytes = maximum(options.maxReadBytes, LEGACY_REWIND_BARRIER_LIMITS.readBytes);
  const deadline = Date.now() + maximum(options.timeoutMs, LEGACY_REWIND_BARRIER_LIMITS.timeoutMs);
  let entries = 0, readBytes = 0, familyMembers = 0;
  const checkBudget = () => {
    if (entries > maxEntries || readBytes > maxBytes || familyMembers > LEGACY_REWIND_BARRIER_LIMITS.familyMembers || Date.now() > deadline) throw limitError();
  };
  const empty = (): LegacyRewindBarrierStatus => ({ pendingOperations: 0, blockedWorkspaces: [], recoveryIds: [] });
  // Verify each existing parent without following a link. Missing state is an
  // empty read-only result, never an instruction to create a directory.
  let current = roots.data;
  for (const component of ['', ...path.relative(roots.data, roots.state).split(path.sep)]) {
    if (component) current = path.join(current, component);
    let stat: BigIntStats;
    try { stat = await fs.lstat(current, { bigint: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty(); throw invalid(); }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw invalid();
  }
  if (await fs.realpath(roots.state) !== roots.state) throw invalid();
  const before = await fs.lstat(roots.state, { bigint: true });
  let directory: Awaited<ReturnType<typeof fs.open>>;
  try { directory = await fs.open(roots.state, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); }
  catch { throw invalid(); }
  try {
    const opened = await directory.stat({ bigint: true }), access = '/proc/self/fd/' + directory.fd;
    if (!opened.isDirectory() || !sameNode(before, opened)) throw changed();
    const assertDirectory = async () => {
      checkBudget();
      const named = await fs.lstat(roots.state, { bigint: true });
      if (!named.isDirectory() || named.isSymbolicLink() || !sameNode(named, opened) || await fs.realpath(roots.state) !== roots.state) throw changed();
    };
    const inventory = async (): Promise<Name[]> => {
      await assertDirectory();
      const names: Name[] = [];
      for await (const entry of await fs.opendir(access, { bufferSize: 64 })) {
        entries++; checkBudget();
        const selected = selectedName(entry.name);
        if (!selected) continue;
        if (names.length >= maxRecords) throw limitError();
        names.push(selected);
      }
      await assertDirectory();
      return names.sort((a, b) => a.name.localeCompare(b.name));
    };
    const read = async (name: Name): Promise<ReadRecord> => {
      await assertDirectory();
      const file = access + '/' + name.name, initial = await fs.lstat(file, { bigint: true });
      if (!initial.isFile() || initial.isSymbolicLink() || initial.nlink !== 1n || initial.size < 1n
        || initial.size > BigInt(LEGACY_REWIND_BARRIER_LIMITS.recordWireBytes)) throw invalid();
      readBytes += Number(initial.size) + 1; checkBudget();
      const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const first = await handle.stat({ bigint: true });
        if (!first.isFile() || first.nlink !== 1n || fingerprint(first) !== fingerprint(initial)) throw changed();
        const buffer = Buffer.allocUnsafe(Number(initial.size) + 1); let length = 0;
        while (length < buffer.length) {
          checkBudget();
          const chunk = await handle.read(buffer, length, Math.min(64 * 1024, buffer.length - length), length);
          if (!chunk.bytesRead) break;
          length += chunk.bytesRead;
        }
        const after = await handle.stat({ bigint: true }), named = await fs.lstat(file, { bigint: true });
        if (length !== Number(initial.size) || fingerprint(after) !== fingerprint(initial) || fingerprint(named) !== fingerprint(initial)) throw changed();
        let envelope: unknown;
        try { envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length))); }
        catch { throw invalid(); }
        if (!object(envelope) || envelope.version !== 1 || !object(envelope.value)
          || typeof envelope.signature !== 'string' || !HASH.test(envelope.signature)) throw invalid();
        const serialized = JSON.stringify(envelope.value);
        if (Buffer.byteLength(serialized) > LEGACY_REWIND_BARRIER_LIMITS.recordValueBytes) throw limitError();
        const expected = createHmac('sha256', config.sessionSecret).update(serialized).digest();
        if (!timingSafeEqual(expected, Buffer.from(envelope.signature, 'hex'))) throw invalid();
        const value = operation(envelope.value, name);
        familyMembers += value.familyIds.length; checkBudget();
        return { name, operation: value, version: fingerprint(after) };
      } finally { await handle.close(); }
    };
    const names = await inventory(), records: ReadRecord[] = [];
    for (const name of names) records.push(await read(name));
    const canonical = new Map(records.filter(record => record.name.kind === 'operation')
      .map(record => [record.operation.recoveryId, record.operation]));
    const pending = new Map<string, Operation>();
    for (const record of records) {
      const owner = canonical.get(record.operation.recoveryId);
      if (!owner || identity(owner) !== identity(record.operation)) throw invalid();
      if (owner.blocking || record.operation.blocking) pending.set(owner.recoveryId, owner);
    }
    const blockers = new Map<string, string>();
    for (const [recoveryId, operation] of pending) for (const workspaceId of operation.familyIds) {
      const existing = blockers.get(workspaceId) ?? workspaceRecoveryBarrier(roots.workspaces, workspaceId)?.recoveryId;
      if (existing && existing !== recoveryId) throw new HttpError(409,
        'Different previous recoveries claim the same workspace. All saved state and existing barriers were retained.', 'LEGACY_REWIND_CONFLICT');
      blockers.set(workspaceId, recoveryId);
    }
    // A second namespace inventory and final source versions fence missing,
    // added or replaced authority before the synchronous barrier publication.
    if (JSON.stringify((await inventory()).map(name => name.name)) !== JSON.stringify(names.map(name => name.name))) throw changed();
    for (const record of records) {
      const named = await fs.lstat(access + '/' + record.name.name, { bigint: true });
      if (fingerprint(named) !== record.version) throw changed();
    }
    await assertDirectory();
    for (const [workspaceId, recoveryId] of blockers) setWorkspaceRecoveryBarrier(roots.workspaces, workspaceId, { recoveryId, message });
    return { pendingOperations: pending.size, blockedWorkspaces: [...blockers.keys()].sort(), recoveryIds: [...pending.keys()].sort() };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw changed();
  } finally { await directory.close(); }
}
