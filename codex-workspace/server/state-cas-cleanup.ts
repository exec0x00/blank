import { createHash, randomUUID } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './errors';

export const STATE_CAS_CLEANUP_LIMITS = Object.freeze({ directoryEntries: 200_000, bundles: 16_384,
  threadIds: 32_768, recordBytes: 32 * 1024 * 1024, metadataBytes: 16 * 1024,
  totalReadBytes: 2 * 1024 * 1024 * 1024, milliseconds: 120_000 });
type Configuration = string | { stateDir: string };
export interface StateCasDiscoveryInput {
  workspaceId: string;
  /** Independently established ownership; names discovered on disk are not authority. */
  threadIds?: readonly string[];
  checkAllowed?: () => Promise<void>;
  /** Synchronous, read-only extraction after every blob proves the same owner.
   * References in this body still need the caller's own ownership validation. */
  onOwnedSource?: (threadId: string, source: unknown) => void;
  /** Read-only reference audit for any fully proven workspace owner. This does
   * not add foreign IDs to discovery results or authorize their deletion. */
  onVerifiedSource?: (threadId: string, workspaceId: string, source: unknown) => void;
}
export interface StateCasCleanupInput extends StateCasDiscoveryInput {
  threadIds: readonly string[];
  /** Use JsonStore.mutateGuarded for this original source key. Do not also hold
   * that same queue around this helper: nested same-key queues would deadlock. */
  withSourceMutation?: <T>(key: string, operation: () => Promise<T>) => Promise<T>;
}
const THREAD = /^thr_[a-f0-9]{32}$/u;
const WORKSPACE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const NATIVE = /^\.state-cas-(thread-(thr_[a-f0-9]{32}))-([a-f0-9]{32})$/u;
const QUARANTINE = /^\.state-cas-cleanup-(thread-(thr_[a-f0-9]{32}))-([a-f0-9]{32})-([a-f0-9]{32})$/u;
// Retire publication working copies first: an interrupted copy may need its
// complete source/candidate to prove ownership again on the next cleanup.
const PUBLICATIONS = ['publication.json', 'restore-publication.json'] as const;
const isPublication = (name: string) => (PUBLICATIONS as readonly string[]).includes(name);
const LEAVES = [...PUBLICATIONS, 'source.json', 'candidate.json', 'parked.json', 'committed.json', 'conflict.json', 'restored.json', 'manifest.json'] as const;
const allowedLeaves = new Set<string>(LEAVES);
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const errno = (error: unknown, code: string) => !!error && typeof error === 'object' && 'code' in error && error.code === code;
const sameNode = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino;
const version = (s: BigIntStats, moved = false) => `${s.dev}:${s.ino}:${s.mode}:${s.nlink}:${s.size}:${s.mtimeNs}${moved ? '' : `:${s.ctimeNs}`}`;
function failure(reason: 'unsafe' | 'changed' | 'ownership' | 'limit'): HttpError {
  return new HttpError(reason === 'limit' ? 413 : 409,
    reason === 'limit' ? 'Saved thread recovery cleanup reached its bounded limit. Remaining data was retained for retry.'
      : 'Saved thread recovery ownership or storage changed. Remaining data was retained for review or retry.',
    `STATE_CAS_CLEANUP_${reason.toUpperCase()}`);
}

class Budget {
  scanned = 0;
  bytes = 0;
  private readonly started = Date.now();
  constructor(private readonly input: StateCasDiscoveryInput) {}
  check(): void {
    if (this.scanned > STATE_CAS_CLEANUP_LIMITS.directoryEntries || this.bytes > STATE_CAS_CLEANUP_LIMITS.totalReadBytes
      || Date.now() - this.started > STATE_CAS_CLEANUP_LIMITS.milliseconds) throw failure('limit');
  }
  async admitted(): Promise<void> { this.check(); await this.input.checkAllowed?.(); this.check(); }
}

/** The same descriptor-relative pattern used by the native rewind/retirement
 * helpers. Every ancestor stays pinned, including the newly owned quarantine. */
class Directory {
  private constructor(readonly absolute: string, readonly handle: FileHandle, readonly identity: BigIntStats,
    private readonly parent?: Directory, private readonly name?: string) {}
  get access(): string { return `/proc/self/fd/${this.handle.fd}`; }
  entry(name: string): string {
    if (!name || name === '.' || name === '..' || /[\\/\u0000-\u001f\u007f]/u.test(name)) throw failure('unsafe');
    return `${this.access}/${name}`;
  }
  static async open(absolute: string, parent?: Directory, name?: string, expected?: BigIntStats): Promise<Directory> {
    await parent?.check();
    const access = parent ? parent.entry(name!) : absolute;
    const before = await fs.lstat(access, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink() || parent && before.dev !== parent.identity.dev) throw failure('unsafe');
    if (expected && !sameNode(before, expected)) throw failure('changed');
    const handle = await fs.open(access, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat({ bigint: true });
      if (!opened.isDirectory() || !sameNode(before, opened)) throw failure('changed');
      const directory = new Directory(absolute, handle, opened, parent, name);
      await directory.check();
      return directory;
    } catch (error) { await handle.close(); throw error; }
  }
  child(name: string, expected?: BigIntStats): Promise<Directory> {
    return Directory.open(path.join(this.absolute, name), this, name, expected);
  }
  async check(): Promise<void> {
    try {
      await this.parent?.check();
      const named = await fs.lstat(this.parent ? this.parent.entry(this.name!) : this.absolute, { bigint: true });
      const opened = await this.handle.stat({ bigint: true });
      if (!named.isDirectory() || named.isSymbolicLink() || !opened.isDirectory()
        || !sameNode(named, this.identity) || !sameNode(opened, this.identity)
        || await fs.realpath(this.absolute) !== this.absolute || await fs.realpath(this.access) !== this.absolute) throw failure('changed');
    } catch (error) {
      if (errno(error, 'ENOENT') || errno(error, 'ENOTDIR') || errno(error, 'ELOOP')) throw failure('changed');
      throw error;
    }
  }
  async sync(): Promise<void> {
    await this.check();
    try { await this.handle.sync(); }
    catch (error) {
      // The native bucket can lack directory fsync; pinned readback and a final
      // bounded namespace check are still required on that filesystem.
      if (!errno(error, 'EINVAL') && !errno(error, 'ENOTSUP') && !errno(error, 'EOPNOTSUPP')) throw error;
    }
  }
  close(): Promise<void> { return this.handle.close(); }
}

interface Entry { name: string; key: string; threadId: string; id: string; quarantine: boolean }
interface Snapshot { name: string; stat: BigIntStats; bytes: number; sha256: string }
interface Manifest {
  version: 1; id: string; key: string; createdAt: string; expectedVersion: string;
  expectedSha256: string; expectedBytes: number; desiredSha256: string; desiredBytes: number;
}
interface Bundle { files: Map<string, Snapshot>; owner?: string }

function configuration(value: Configuration): string {
  const directory = typeof value === 'string' ? value : value?.stateDir;
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.resolve(directory) !== directory
    || directory === path.parse(directory).root || Buffer.byteLength(directory) > 4_096
    || /[\\\u0000-\u001f\u007f]/u.test(directory)) throw failure('unsafe');
  return directory;
}
function owners(input: StateCasDiscoveryInput): Set<string> {
  if (typeof input.workspaceId !== 'string' || !WORKSPACE.test(input.workspaceId) || input.threadIds !== undefined && !Array.isArray(input.threadIds)
    || (input.threadIds?.length ?? 0) > STATE_CAS_CLEANUP_LIMITS.threadIds) throw failure('ownership');
  const ids = new Set<string>();
  for (const id of input.threadIds ?? []) {
    if (typeof id !== 'string' || !THREAD.test(id)) throw failure('ownership');
    ids.add(id);
  }
  return ids;
}
async function rootDirectory(config: Configuration): Promise<Directory | undefined> {
  const directory = configuration(config);
  let before: BigIntStats;
  try { before = await fs.lstat(directory, { bigint: true }); }
  catch (error) { if (errno(error, 'ENOENT')) return; throw error; }
  return Directory.open(directory, undefined, undefined, before);
}
async function names(directory: Directory, state: Budget, maximum: number): Promise<string[]> {
  await directory.check();
  const found: string[] = [];
  for await (const entry of await fs.opendir(directory.access, { bufferSize: 16 })) {
    state.scanned++; state.check();
    if (found.length >= maximum) throw failure('unsafe');
    found.push(entry.name);
  }
  await directory.check();
  return found.sort();
}
async function inventory(root: Directory, state: Budget, ids?: ReadonlySet<string>): Promise<Entry[]> {
  await root.check();
  const found: Entry[] = [];
  for await (const entry of await fs.opendir(root.access, { bufferSize: 32 })) {
    state.scanned++; state.check();
    const native = NATIVE.exec(entry.name), match = native ?? QUARANTINE.exec(entry.name);
    if (!match || ids && !ids.has(match[2])) continue;
    if (found.length >= STATE_CAS_CLEANUP_LIMITS.bundles) throw failure('limit');
    found.push({ name: entry.name, key: match[1], threadId: match[2], id: match[3], quarantine: !native });
  }
  await root.check();
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

async function readBytes(directory: Directory, name: string, state: Budget, maximum: number,
  minimum = 2): Promise<{ snapshot: Snapshot; data: Buffer }> {
  await state.admitted(); await directory.check();
  const file = directory.entry(name), before = await fs.lstat(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.dev !== directory.identity.dev) throw failure('unsafe');
  if (before.size < BigInt(minimum) || before.size > BigInt(maximum)) throw failure('limit');
  const bytes = Number(before.size);
  state.bytes += bytes + 1; state.check();
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || version(opened) !== version(before)) throw failure('changed');
    const buffer = Buffer.allocUnsafe(bytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      state.check();
      const { bytesRead } = await handle.read(buffer, offset, Math.min(64 * 1024, buffer.length - offset), offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== bytes || version(await handle.stat({ bigint: true })) !== version(before)
      || version(await fs.lstat(file, { bigint: true })) !== version(before)) throw failure('changed');
    await directory.check();
    return { data: buffer.subarray(0, bytes), snapshot: { name, stat: before, bytes,
      sha256: createHash('sha256').update(buffer.subarray(0, bytes)).digest('hex') } };
  } finally { await handle.close(); }
}

function parse(data: Buffer): unknown {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); }
  catch { throw failure('ownership'); }
}
async function read(directory: Directory, name: string, state: Budget, maximum: number): Promise<{ snapshot: Snapshot; value: unknown }> {
  const record = await readBytes(directory, name, state, maximum);
  return { snapshot: record.snapshot, value: parse(record.data) };
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 32 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function manifest(value: unknown, entry: Entry): Manifest {
  const fields = ['version', 'id', 'key', 'createdAt', 'expectedVersion', 'expectedSha256', 'expectedBytes', 'desiredSha256', 'desiredBytes'];
  if (!isObject(value) || Object.keys(value).length !== fields.length || Object.keys(value).some(key => !fields.includes(key))
    || value.version !== 1 || value.id !== entry.id || value.key !== entry.key || !timestamp(value.createdAt)
    || typeof value.expectedVersion !== 'string' || !value.expectedVersion || value.expectedVersion.length > 512
    || /[\u0000-\u001f\u007f]/u.test(value.expectedVersion)
    || typeof value.expectedSha256 !== 'string' || !HASH.test(value.expectedSha256)
    || typeof value.desiredSha256 !== 'string' || !HASH.test(value.desiredSha256)
    || !Number.isSafeInteger(value.expectedBytes) || !Number.isSafeInteger(value.desiredBytes)
    || (value.expectedBytes as number) < 2 || (value.desiredBytes as number) < 2
    || (value.expectedBytes as number) > STATE_CAS_CLEANUP_LIMITS.recordBytes
    || (value.desiredBytes as number) > STATE_CAS_CLEANUP_LIMITS.recordBytes) throw failure('ownership');
  return value as unknown as Manifest;
}
function phase(value: unknown, entry: Entry): void {
  if (!isObject(value) || value.version !== 1 || value.id !== entry.id || value.key !== entry.key || !timestamp(value.createdAt)
    || Object.keys(value).length > 36 || Object.entries(value).some(([key, item]) => !['version', 'id', 'key', 'createdAt'].includes(key)
      && (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/u.test(key) || typeof item !== 'boolean'))) throw failure('ownership');
}
function threadOwner(value: unknown, entry: Entry): string {
  if (!isObject(value) || !isObject(value.thread) || value.thread.id !== entry.threadId
    || typeof value.thread.workspaceId !== 'string' || !WORKSPACE.test(value.thread.workspaceId)) throw failure('ownership');
  return value.thread.workspaceId;
}
function assertSnapshot(actual: Snapshot, expected: Snapshot, moved = false): void {
  if (actual.name !== expected.name || actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256
    || version(actual.stat, moved) !== version(expected.stat, moved)) throw failure('changed');
}
async function publication(directory: Directory, name: typeof PUBLICATIONS[number], entry: Entry,
  identity: Manifest, files: ReadonlyMap<string, Snapshot>, state: Budget): Promise<{ snapshot: Snapshot; owner: string }> {
  const current = await readBytes(directory, name, state, STATE_CAS_CLEANUP_LIMITS.recordBytes, 0);
  let completeOwner: string | undefined;
  try { completeOwner = threadOwner(parse(current.data), entry); }
  catch (error) { if (!(error instanceof HttpError) || error.code !== 'STATE_CAS_CLEANUP_OWNERSHIP') throw error; }
  if (completeOwner !== undefined && (name === 'restore-publication.json'
    || current.snapshot.bytes === identity.desiredBytes && current.snapshot.sha256 === identity.desiredSha256)) {
    return { snapshot: current.snapshot, owner: completeOwner };
  }
  // A failed private copy can be empty, truncated inside UTF-8/JSON, or lack
  // its final newline. Its name alone proves nothing: compare every raw byte
  // with a freshly revalidated, complete source of the same operation. Hold
  // only this pair of bounded byte buffers, never a full-history aggregate.
  const reference = files.get(name === 'publication.json' ? 'candidate.json' : 'source.json');
  if (!reference || current.snapshot.bytes >= reference.bytes) throw failure('ownership');
  const original = await readBytes(directory, reference.name, state, STATE_CAS_CLEANUP_LIMITS.recordBytes);
  assertSnapshot(original.snapshot, reference);
  const owner = threadOwner(parse(original.data), entry);
  if (!current.data.equals(original.data.subarray(0, current.data.length))) throw failure('ownership');
  return { snapshot: current.snapshot, owner };
}
async function inspect(directory: Directory, entry: Entry, state: Budget, allowEmpty: boolean): Promise<Bundle> {
  const entries = await names(directory, state, LEAVES.length);
  if (entries.some(name => !allowedLeaves.has(name))) throw failure('unsafe');
  if (entries.length === 0 && allowEmpty) return { files: new Map() };
  if (!entries.includes('manifest.json')) throw failure('ownership');
  const savedManifest = await read(directory, 'manifest.json', state, STATE_CAS_CLEANUP_LIMITS.metadataBytes);
  const identity = manifest(savedManifest.value, entry);
  const files = new Map<string, Snapshot>([['manifest.json', savedManifest.snapshot]]);
  let owner: string | undefined;
  for (const name of entries) {
    if (name === 'manifest.json' || isPublication(name)) continue;
    const transcript = name === 'source.json' || name === 'candidate.json';
    const record = await read(directory, name, state, transcript ? STATE_CAS_CLEANUP_LIMITS.recordBytes : STATE_CAS_CLEANUP_LIMITS.metadataBytes);
    if (transcript) {
      const currentOwner = threadOwner(record.value, entry);
      if (owner !== undefined && owner !== currentOwner) throw failure('ownership');
      owner = currentOwner;
      // A parked source is the actual bytes won by rename and can legitimately
      // differ from the writer's expectation. Its own full owner must agree.
      if (name === 'candidate.json' && (record.snapshot.bytes !== identity.desiredBytes
        || record.snapshot.sha256 !== identity.desiredSha256)) throw failure('ownership');
    } else phase(record.value, entry);
    files.set(name, record.snapshot);
  }
  for (const name of PUBLICATIONS) {
    if (!entries.includes(name)) continue;
    const record = await publication(directory, name, entry, identity, files, state);
    if (owner !== undefined && owner !== record.owner) throw failure('ownership');
    owner = record.owner;
    files.set(name, record.snapshot);
  }
  const after = await names(directory, state, LEAVES.length);
  if (after.length !== entries.length || after.some((name, i) => name !== entries[i])) throw failure('changed');
  for (const file of files.values()) {
    if (version(await fs.lstat(directory.entry(file.name), { bigint: true })) !== version(file.stat)) throw failure('changed');
  }
  await directory.check();
  return { files, owner };
}
function assertOwner(bundle: Bundle, workspaceId: string): void {
  if (bundle.owner !== undefined && bundle.owner !== workspaceId) throw failure('ownership');
}
function assertBundle(actual: Bundle, expected: Bundle): void {
  if (actual.owner !== expected.owner || actual.files.size !== expected.files.size) throw failure('changed');
  for (const [name, file] of expected.files) {
    const current = actual.files.get(name);
    if (!current) throw failure('changed');
    assertSnapshot(current, file, true);
  }
}
async function absent(directory: Directory, name: string): Promise<void> {
  try { await fs.lstat(directory.entry(name)); }
  catch (error) { if (errno(error, 'ENOENT')) return; throw error; }
  throw failure('changed');
}
async function removeEmpty(parent: Directory, name: string, directory: Directory, state: Budget): Promise<void> {
  if ((await names(directory, state, 1)).length !== 0) throw failure('changed');
  await state.admitted(); await parent.check(); await directory.check();
  if (!sameNode(await fs.lstat(parent.entry(name), { bigint: true }), directory.identity)) throw failure('changed');
  // rmdir is deliberately non-recursive: even a final outside insertion keeps
  // its bytes and makes removal fail instead of widening deletion authority.
  await fs.rmdir(parent.entry(name));
  await parent.sync(); await absent(parent, name);
}

/** Every unlink occurs inside our private quarantine, never at the original
 * CAS name. Keep the manifest until all transcript/phase leaves are gone so a
 * process restart can validate and finish this exact, bounded retirement. */
async function retireBundle(quarantine: Directory, directory: Directory, bundle: Bundle, state: Budget): Promise<void> {
  const remaining = new Set(bundle.files.keys());
  for (const name of LEAVES) {
    const expected = bundle.files.get(name);
    if (!expected) continue;
    const listed = await names(directory, state, LEAVES.length);
    if (listed.length !== remaining.size || listed.some(item => !remaining.has(item))) throw failure('changed');
    const metadata = bundle.files.get('manifest.json');
    if (metadata && name !== 'manifest.json') assertSnapshot((await read(directory, 'manifest.json', state, STATE_CAS_CLEANUP_LIMITS.metadataBytes)).snapshot, metadata);
    const current = isPublication(name) ? await readBytes(directory, name, state, STATE_CAS_CLEANUP_LIMITS.recordBytes, 0)
      : await read(directory, name, state, name === 'source.json' || name === 'candidate.json'
        ? STATE_CAS_CLEANUP_LIMITS.recordBytes : STATE_CAS_CLEANUP_LIMITS.metadataBytes);
    assertSnapshot(current.snapshot, expected);
    await state.admitted(); await quarantine.check(); await directory.check();
    if (version(await fs.lstat(directory.entry(name), { bigint: true })) !== version(current.snapshot.stat)) throw failure('changed');
    await fs.unlink(directory.entry(name));
    remaining.delete(name);
    await directory.sync(); await absent(directory, name);
  }
  await removeEmpty(quarantine, 'bundle', directory, state);
}

async function reportOwnedSources(directory: Directory, entry: Entry, bundle: Bundle,
  input: StateCasDiscoveryInput, state: Budget): Promise<void> {
  const target = bundle.owner === input.workspaceId;
  if (bundle.owner === undefined || !input.onVerifiedSource && (!target || !input.onOwnedSource)) return;
  for (const name of ['source.json', 'candidate.json']) {
    const expected = bundle.files.get(name);
    if (!expected) continue;
    const metadata = bundle.files.get('manifest.json');
    if (!metadata) throw failure('ownership');
    assertSnapshot((await read(directory, 'manifest.json', state, STATE_CAS_CLEANUP_LIMITS.metadataBytes)).snapshot, metadata);
    // Keep no full-history aggregate: re-read one bounded body through the same
    // pinned directory and tie the callback to its inspected bytes and node.
    const current = await read(directory, name, state, STATE_CAS_CLEANUP_LIMITS.recordBytes);
    assertSnapshot(current.snapshot, expected);
    if (threadOwner(current.value, entry) !== bundle.owner) throw failure('ownership');
    input.onVerifiedSource?.(entry.threadId, bundle.owner, current.value);
    if (target) input.onOwnedSource?.(entry.threadId, current.value);
    state.check();
  }
  await directory.check();
}

async function readEntry(root: Directory, entry: Entry, input: StateCasDiscoveryInput, state: Budget): Promise<Bundle | undefined> {
  const outer = await root.child(entry.name);
  let bundle: Directory | undefined;
  try {
    if (!entry.quarantine) {
      const snapshot = await inspect(outer, entry, state, false);
      await reportOwnedSources(outer, entry, snapshot, input, state);
      return snapshot;
    }
    const entries = await names(outer, state, 1);
    if (!entries.length) return undefined; // An interrupted empty quarantine has no source ownership to infer.
    if (entries[0] !== 'bundle') throw failure('unsafe');
    bundle = await outer.child('bundle');
    const snapshot = await inspect(bundle, entry, state, true);
    await reportOwnedSources(bundle, entry, snapshot, input, state);
    return snapshot;
  } finally { await bundle?.close(); await outer.close(); }
}

/** Read-only orphan discovery, independent of ThreadIndex, a live checkout,
 * model configuration or startup. Only exact native/cleanup namespaces are
 * inspected. A name or metadata-only bundle never invents a workspace owner. */
export async function discoverStateCasThreadIds(config: Configuration, input: StateCasDiscoveryInput): Promise<string[]> {
  const known = owners(input), state = new Budget(input);
  await state.admitted();
  const root = await rootDirectory(config);
  if (!root) return [];
  try {
    const result = new Set<string>();
    for (const entry of await inventory(root, state)) {
      const bundle = await readEntry(root, entry, input, state);
      if (bundle?.owner === input.workspaceId) result.add(entry.threadId);
      else if (bundle?.owner !== undefined && known.has(entry.threadId)) throw failure('ownership');
    }
    await state.admitted(); await root.check();
    return [...result].sort();
  } finally { await root.close(); }
}

async function retire(root: Directory, entry: Entry, input: StateCasCleanupInput, state: Budget): Promise<number> {
  await state.admitted();
  let original: Directory | undefined, quarantine: Directory | undefined, moved: Directory | undefined;
  try {
    if (entry.quarantine) {
      quarantine = await root.child(entry.name);
      const entries = await names(quarantine, state, 1);
      if (!entries.length) { await removeEmpty(root, entry.name, quarantine, state); return 0; }
      if (entries[0] !== 'bundle') throw failure('unsafe');
      moved = await quarantine.child('bundle');
      const snapshot = await inspect(moved, entry, state, true);
      assertOwner(snapshot, input.workspaceId);
      await retireBundle(quarantine, moved, snapshot, state);
    } else {
      original = await root.child(entry.name);
      const snapshot = await inspect(original, entry, state, false);
      assertOwner(snapshot, input.workspaceId);
      await state.admitted(); await root.check(); await original.check();
      const quarantineName = `.state-cas-cleanup-${entry.key}-${entry.id}-${randomUUID().replaceAll('-', '')}`;
      // Exclusive creation never adopts an existing random quarantine. A fresh
      // private directory makes the destination a newly owned absent child;
      // rename of a directory also cannot overwrite a nonempty foreign child.
      await fs.mkdir(root.entry(quarantineName), { mode: 0o700 });
      quarantine = await root.child(quarantineName);
      if ((await names(quarantine, state, 1)).length) throw failure('changed');
      await state.admitted(); await root.check(); await original.check(); await quarantine.check();
      await absent(quarantine, 'bundle');
      await fs.rename(root.entry(entry.name), quarantine.entry('bundle'));
      // Rename retains the actual winner, including a raced foreign directory
      // or leaf. Re-open through the pinned quarantine and validate all of it
      // before the first unlink. On any failure leave it reachable for review.
      moved = await quarantine.child('bundle', original.identity);
      await quarantine.sync(); await root.sync();
      const actual = await inspect(moved, entry, state, false);
      assertBundle(actual, snapshot);
      await retireBundle(quarantine, moved, actual, state);
    }
    await removeEmpty(root, path.basename(quarantine.absolute), quarantine, state);
    return 1;
  } finally { await moved?.close(); await quarantine?.close(); await original?.close(); }
}

/** Permanent deletion only. The caller must already fence/drain workspace
 * writers and hold JsonStore.mutateGuarded for each original thread source key
 * (or supply withSourceMutation). An active writer holding a CAS directory fd
 * must not continue publishing into that directory after it is quarantined.
 * No recursive sweep, startup, workspace initialization or model request runs.
 * The optional queue callback lets one bounded inventory cover all threads. */
export async function cleanupStateCasForThreads(config: Configuration, input: StateCasCleanupInput): Promise<{ removed: number }> {
  if (!Array.isArray(input.threadIds)) throw failure('ownership');
  const ids = owners(input), state = new Budget(input);
  await state.admitted();
  const root = await rootDirectory(config);
  if (!root) return { removed: 0 };
  try {
    let removed = 0;
    for (const entry of await inventory(root, state, ids)) {
      const operation = () => retire(root, entry, input, state);
      removed += input.withSourceMutation ? await input.withSourceMutation(entry.key, operation) : await operation();
    }
    // Detect a new/recreated matching bundle rather than claiming a complete
    // purge based only on the names observed before retirement began.
    if ((await inventory(root, state, ids)).length) throw failure('changed');
    await state.admitted(); await root.check();
    return { removed };
  } finally { await root.close(); }
}
