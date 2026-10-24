import { constants, type BigIntStats } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { HttpError } from './errors';
import { renameNoReplace } from './native-atomic-rename';

export const STATE_CAS_LIMITS = Object.freeze({ bytes: 32 * 1024 * 1024, bufferBytes: 64 * 1024, manifestBytes: 4096 });
export const stateCasFingerprint = (stat: BigIntStats): string => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
const validKey = (key: string): boolean => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,180}$/.test(key);
const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const errno = (error: unknown, code: string) => (error as NodeJS.ErrnoException)?.code === code;
const sameNode = (left: BigIntStats, right: BigIntStats) => left.dev === right.dev && left.ino === right.ino;
const READ = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const CREATE = constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;

export interface StateCasManifest {
  version: 1; id: string; key: string; createdAt: string;
  expectedVersion: string; expectedSha256: string; expectedBytes: number;
  desiredSha256: string; desiredBytes: number;
}
export interface ConditionalJsonPublication {
  key: string;
  /** Already-pinned state-directory access, owned and closed by the caller. */
  access: string;
  directory: string;
  temporary: string;
  expected: { version: string; serialized: string };
  serialized: string;
  checkDirectory(): Promise<void>;
  onTemporaryMoved(): void;
}

function conflict(id?: string): HttpError {
  const error = new HttpError(409, id
    ? `Saved state changed during conditional publication. The displaced state and prepared replacement were retained for recovery (${id}). No later destination was overwritten.`
    : 'Saved state changed during conditional publication. Refresh and try again.', 'STATE_CONFLICT');
  if (id) Object.assign(error, { stateRecoveryId: id });
  return error;
}

function checkSize(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > STATE_CAS_LIMITS.bytes) throw new HttpError(413,
    'The conditional state record exceeds its bounded recovery limit. Its existing contents were retained.', 'STATE_CAS_LIMIT');
}

async function digestFile(handle: FileHandle, before: BigIntStats): Promise<string> {
  const bytes = Number(before.size); checkSize(bytes);
  if (!before.isFile() || before.nlink !== 1n) throw conflict();
  const digest = createHash('sha256'), buffer = Buffer.allocUnsafe(STATE_CAS_LIMITS.bufferBytes);
  for (let offset = 0; offset < bytes;) {
    const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, bytes - offset), offset);
    if (!bytesRead) throw conflict();
    digest.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
  }
  if (stateCasFingerprint(await handle.stat({ bigint: true })) !== stateCasFingerprint(before)) throw conflict();
  return digest.digest('hex');
}

async function inspectFile(file: string, maxBytes = STATE_CAS_LIMITS.bytes): Promise<{ handle: FileHandle; stat: BigIntStats; sha256: string }> {
  const named = await fs.lstat(file, { bigint: true });
  if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1n) throw conflict();
  checkSize(Number(named.size)); if (named.size > BigInt(maxBytes)) throw conflict();
  const handle = await fs.open(file, READ);
  try {
    const stat = await handle.stat({ bigint: true });
    if (stateCasFingerprint(stat) !== stateCasFingerprint(named)) throw conflict();
    const sha256 = await digestFile(handle, stat);
    if (stateCasFingerprint(await fs.lstat(file, { bigint: true })) !== stateCasFingerprint(stat)) throw conflict();
    return { handle, stat, sha256 };
  } catch (error) { await handle.close().catch(() => undefined); throw error; }
}

async function readContent(file: string, maxBytes = STATE_CAS_LIMITS.bytes): Promise<{ serialized: string; sha256: string; version: string; bytes: number }> {
  const observed = await inspectFile(file, maxBytes);
  try {
    // The descriptor may grow after inspection. Never hand it to readFile(),
    // which can allocate beyond the admitted size before a later rejection.
    const expectedBytes = Number(observed.stat.size), bytes = Buffer.allocUnsafe(expectedBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await observed.handle.read(bytes, length, Math.min(STATE_CAS_LIMITS.bufferBytes, bytes.length - length), length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const actual = bytes.subarray(0, length);
    if (length !== expectedBytes || hash(actual) !== observed.sha256
      || stateCasFingerprint(await observed.handle.stat({ bigint: true })) !== stateCasFingerprint(observed.stat)
      || stateCasFingerprint(await fs.lstat(file, { bigint: true })) !== stateCasFingerprint(observed.stat)) throw conflict();
    const serialized = actual.toString('utf8');
    if (hash(serialized) !== observed.sha256) throw conflict();
    return { serialized, sha256: observed.sha256, version: stateCasFingerprint(observed.stat), bytes: expectedBytes };
  } finally { await observed.handle.close(); }
}

async function readJson(file: string, maxBytes = STATE_CAS_LIMITS.bytes): Promise<{ value: unknown; sha256: string }> {
  const content = await readContent(file, maxBytes);
  try { return { value: JSON.parse(content.serialized), sha256: content.sha256 }; }
  catch { throw conflict(); }
}

/** A conditional source is size-checked before allocation, bounded even if it
 * grows mid-read, and read under a pinned canonical state directory. */
export async function readConditionalJsonSource(directory: string, key: string): Promise<{
  serialized: string; version: string; bytes: number; settled: false;
} | undefined> {
  if (!validKey(key)) throw conflict();
  const canonical = path.resolve(directory);
  if (await fs.realpath(canonical) !== canonical) throw conflict();
  const before = await fs.lstat(canonical, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink()) throw conflict();
  const root = await fs.open(canonical, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    if (!sameNode(before, await root.stat({ bigint: true }))) throw conflict();
    let content: Awaited<ReturnType<typeof readContent>>;
    try { content = await readContent(`/proc/self/fd/${root.fd}/${key}.json`, STATE_CAS_LIMITS.bytes); }
    catch (error) { if (errno(error, 'ENOENT')) return; throw error; }
    const current = await fs.lstat(canonical, { bigint: true });
    if (!current.isDirectory() || current.isSymbolicLink() || !sameNode(current, before) || await fs.realpath(canonical) !== canonical) throw conflict();
    return { serialized: content.serialized, version: content.version, bytes: content.bytes, settled: false };
  } finally { await root.close(); }
}

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function owner(value: unknown): { threadId: string; workspaceId: string } | undefined {
  if (!record(value) || !record(value.thread) || typeof value.thread.id !== 'string' || !/^thr_[a-f0-9]{32}$/.test(value.thread.id)
    || typeof value.thread.workspaceId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,179}$/.test(value.thread.workspaceId)) return;
  return { threadId: value.thread.id, workspaceId: value.thread.workspaceId };
}

async function writeMarker(access: string, name: string, value: unknown): Promise<void> {
  const serialized = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(serialized) > STATE_CAS_LIMITS.manifestBytes) throw conflict();
  const handle = await fs.open(`${access}/${name}`, CREATE, 0o600);
  try {
    await handle.writeFile(serialized);
    const stat = await handle.stat({ bigint: true });
    if (await digestFile(handle, stat) !== hash(serialized)) throw conflict();
  } finally { await handle.close(); }
}

/** Prepare a private recovery-bundle working copy. This function must never
 * receive the canonical state pathname: publication happens only after this
 * complete inode has been verified and closed. */
async function createOnlyCopy(sourceFile: string, target: string, check: () => Promise<void>, expectedSha256?: string, expectedBytes?: number): Promise<string> {
  const source = await inspectFile(sourceFile);
  let writer: FileHandle | undefined, installed: FileHandle | undefined;
  try {
    if (expectedSha256 !== undefined && source.sha256 !== expectedSha256
      || expectedBytes !== undefined && Number(source.stat.size) !== expectedBytes) throw conflict();
    await check();
    writer = await fs.open(target, CREATE, 0o600);
    const buffer = Buffer.allocUnsafe(STATE_CAS_LIMITS.bufferBytes);
    const bytes = Number(source.stat.size);
    for (let offset = 0; offset < bytes;) {
      await check();
      const { bytesRead } = await source.handle.read(buffer, 0, Math.min(buffer.length, bytes - offset), offset);
      if (!bytesRead) throw conflict();
      for (let written = 0; written < bytesRead;) {
        const result = await writer.write(buffer, written, bytesRead - written, offset + written);
        if (!result.bytesWritten) throw new HttpError(507, 'Storage stopped accepting a conditional state record. Recovery copies were retained.', 'STATE_CAS_WRITE_FAILED');
        written += result.bytesWritten;
      }
      offset += bytesRead;
    }
    const written = await writer.stat({ bigint: true });
    if (written.size !== source.stat.size || await digestFile(writer, written) !== source.sha256
      || stateCasFingerprint(await source.handle.stat({ bigint: true })) !== stateCasFingerprint(source.stat)
      || stateCasFingerprint(await fs.lstat(sourceFile, { bigint: true })) !== stateCasFingerprint(source.stat)) throw conflict();
    // A bucket writer closes before the publication receipt is measured.
    await writer.close(); writer = undefined;
    const named = await fs.lstat(target, { bigint: true });
    if (!named.isFile() || named.isSymbolicLink() || !sameNode(named, written)) throw conflict();
    installed = await fs.open(target, READ);
    const final = await installed.stat({ bigint: true });
    if (!sameNode(final, written) || stateCasFingerprint(final) !== stateCasFingerprint(named)
      || final.size !== source.stat.size || await digestFile(installed, final) !== source.sha256
      || stateCasFingerprint(await fs.lstat(target, { bigint: true })) !== stateCasFingerprint(final)) throw conflict();
    await check();
    return stateCasFingerprint(final);
  } finally {
    await writer?.close().catch(() => undefined); await installed?.close().catch(() => undefined);
    await source.handle.close().catch(() => undefined);
  }
}

async function publishPreparedCopy(sourceFile: string, bundleFd: number, preparedName: string, rootFd: number, targetName: string,
  check: () => Promise<void>, expectedSha256?: string, expectedBytes?: number): Promise<string> {
  const target = `/proc/self/fd/${rootFd}/${targetName}`;
  await check();
  try { await fs.lstat(target); throw Object.assign(new Error('The destination is already present.'), { code: 'EEXIST' }); }
  catch (error) { if (!errno(error, 'ENOENT')) throw error; }
  const source = await inspectFile(sourceFile);
  let wantedHash: string, wantedBytes: number;
  try {
    wantedHash = expectedSha256 ?? source.sha256; wantedBytes = expectedBytes ?? Number(source.stat.size);
    if (source.sha256 !== wantedHash || Number(source.stat.size) !== wantedBytes) throw conflict();
  } finally { await source.handle.close(); }
  const preparedPath = `/proc/self/fd/${bundleFd}/${preparedName}`;
  try { await createOnlyCopy(sourceFile, preparedPath, check, wantedHash, wantedBytes); }
  catch (error) { if (!errno(error, 'EEXIST')) throw error; }
  // An existing complete private preparation can be retried. A partial or
  // changed one remains retained for inspection; it is never overwritten.
  const prepared = await inspectFile(preparedPath);
  try {
    if (prepared.sha256 !== wantedHash || Number(prepared.stat.size) !== wantedBytes) throw conflict();
    await check();
    await renameNoReplace(bundleFd, preparedName, rootFd, targetName);
    // There are no writes to this inode after it becomes publicly named. A
    // later external edit survives and makes the receipt fail, rather than
    // being overwritten by a remaining copy chunk.
    const owned = await prepared.handle.stat({ bigint: true }), named = await fs.lstat(target, { bigint: true });
    if (!sameNode(owned, prepared.stat) || !named.isFile() || named.isSymbolicLink()
      || stateCasFingerprint(owned) !== stateCasFingerprint(named) || Number(owned.size) !== wantedBytes
      || await digestFile(prepared.handle, owned) !== wantedHash
      || stateCasFingerprint(await fs.lstat(target, { bigint: true })) !== stateCasFingerprint(owned)) throw conflict();
    await check();
    return stateCasFingerprint(owned);
  } finally { await prepared.handle.close(); }
}

/** Node has no compare-and-rename primitive. Preserve the actual displaced
 * namespace entry before examining it; never overwrite the live target after
 * a precheck. A raced source remains in source.json even after a failed copy or
 * a successful restore, including writes through an already-open source fd. */
export async function publishConditionalJson(input: ConditionalJsonPublication): Promise<{ version: string; recoveryId: string }> {
  if (!validKey(input.key) || !/^\/proc\/self\/fd\/\d+$/.test(input.access)
    || !input.temporary.startsWith(`${input.access}/${input.key}.json.`) || !input.temporary.endsWith('.tmp')) throw conflict();
  const target = `${input.access}/${input.key}.json`, id = randomUUID().replaceAll('-', '');
  const rootFd = Number(input.access.slice(input.access.lastIndexOf('/') + 1));
  const expectedBytes = Buffer.byteLength(input.expected.serialized), desiredBytes = Buffer.byteLength(input.serialized);
  checkSize(expectedBytes); checkSize(desiredBytes);
  const temporaryIdentity = await fs.lstat(input.temporary, { bigint: true });
  await input.checkDirectory();
  const name = `.state-cas-${input.key}-${id}`, accessPath = `${input.access}/${name}`;
  await fs.mkdir(accessPath, { mode: 0o700 });
  let bundle: FileHandle | undefined, parked = false, temporaryMoved = false;
  const manifest: StateCasManifest = { version: 1, id, key: input.key, createdAt: new Date().toISOString(),
    expectedVersion: input.expected.version, expectedSha256: hash(input.expected.serialized), expectedBytes,
    desiredSha256: hash(input.serialized), desiredBytes };
  try {
    bundle = await fs.open(accessPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const bundleStat = await bundle.stat({ bigint: true }), named = await fs.lstat(accessPath, { bigint: true });
    if (!bundleStat.isDirectory() || !sameNode(named, bundleStat) || named.isSymbolicLink()) throw conflict();
    const access = `/proc/self/fd/${bundle.fd}`;
    const check = async () => {
      await input.checkDirectory();
      const current = await fs.lstat(accessPath, { bigint: true });
      if (!current.isDirectory() || current.isSymbolicLink() || !sameNode(current, bundleStat)) throw conflict(id);
    };
    await writeMarker(access, 'manifest.json', manifest);
    // Both destinations are inside this freshly created, exclusive owned
    // directory. No original/live path is replaced by these preparation moves.
    await renameNoReplace(rootFd, path.basename(input.temporary), bundle.fd, 'candidate.json');
    temporaryMoved = true; input.onTemporaryMoved();
    const candidate = await inspectFile(`${access}/candidate.json`);
    try { if (candidate.sha256 !== manifest.desiredSha256 || Number(candidate.stat.size) !== desiredBytes) throw conflict(id); }
    finally { await candidate.handle.close(); }
    await check();
    const before = await fs.lstat(target, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || stateCasFingerprint(before) !== input.expected.version) throw conflict(id);
    // The race at this syscall is intentional and non-destructive: if another
    // writer won after the check, its actual inode is parked and retained too.
    await renameNoReplace(rootFd, `${input.key}.json`, bundle.fd, 'source.json'); parked = true;
    const source = await inspectFile(`${access}/source.json`);
    try {
      const expectedIdentity = input.expected.version.split(':');
      if (expectedIdentity.length !== 5 || source.stat.dev.toString() !== expectedIdentity[0]
        || source.stat.ino.toString() !== expectedIdentity[1] || source.stat.size.toString() !== expectedIdentity[2]
        || source.stat.mtimeNs.toString() !== expectedIdentity[3] || source.sha256 !== manifest.expectedSha256) throw conflict(id);
    } finally { await source.handle.close(); }
    await writeMarker(access, 'parked.json', { version: 1, id, key: input.key, createdAt: new Date().toISOString() });
    const version = await publishPreparedCopy(`${access}/candidate.json`, bundle.fd, 'publication.json', rootFd, `${input.key}.json`,
      check, manifest.desiredSha256, manifest.desiredBytes);
    await writeMarker(access, 'committed.json', { version: 1, id, key: input.key, createdAt: new Date().toISOString() });
    // Publication proof stays tied to the installed file, never to a later
    // independent path stat which could belong to a different transcript.
    if (stateCasFingerprint(await fs.lstat(target, { bigint: true })) !== version) throw conflict(id);
    await check();
    return { version, recoveryId: id };
  } catch (error) {
    if (bundle) {
      const access = `/proc/self/fd/${bundle.fd}`;
      if (!temporaryMoved) {
        try {
          const candidate = await fs.lstat(`${access}/candidate.json`, { bigint: true });
          if (sameNode(candidate, temporaryIdentity)) { temporaryMoved = true; input.onTemporaryMoved(); }
        } catch { /* Caller still owns the original temporary if it did not move. */ }
      }
      // A thrown rename can have completed before an adapter reports failure.
      if (!parked) { try { await fs.lstat(`${access}/source.json`); parked = true; } catch {} }
      let restored = false;
      if (parked) {
        try {
          let ownerVerifiedSha256: string | undefined;
          if (/^thread-thr_[a-f0-9]{32}$/.test(input.key)) {
            const expectedOwner = owner(JSON.parse(input.expected.serialized));
            const observed = await readJson(`${access}/source.json`), parkedOwner = owner(observed.value);
            if (!expectedOwner || !parkedOwner || `thread-${expectedOwner.threadId}` !== input.key
              || parkedOwner.threadId !== expectedOwner.threadId || parkedOwner.workspaceId !== expectedOwner.workspaceId) throw conflict(id);
            ownerVerifiedSha256 = observed.sha256;
          }
          await publishPreparedCopy(`${access}/source.json`, bundle.fd, 'restore-publication.json', rootFd, `${input.key}.json`,
            input.checkDirectory, ownerVerifiedSha256);
          restored = true;
          await writeMarker(access, 'restored.json', { version: 1, id, key: input.key, createdAt: new Date().toISOString() });
        } catch { /* Keep any later target and the exact parked source. */ }
      }
      await writeMarker(access, 'conflict.json', { version: 1, id, key: input.key, createdAt: new Date().toISOString(), parked, restored }).catch(() => undefined);
    }
    if (error instanceof HttpError && error.code === 'STATE_CAS_LIMIT') throw error;
    if ((error as { code?: string; atomicRenameUnavailable?: boolean }).code === 'ERR_ATOMIC_RENAME_UNAVAILABLE'
      || (error as { atomicRenameUnavailable?: boolean }).atomicRenameUnavailable) throw new HttpError(503,
      'Safe atomic state publication is unavailable on this runtime. Existing state and recovery copies were retained.', 'STATE_ATOMIC_UNAVAILABLE');
    throw conflict(id);
  } finally { await bundle?.close().catch(() => undefined); }
}

export interface ConditionalJsonRecoveryInput {
  threadId: string;
  workspaceId: string;
  expectedLogicalDigest: string;
  expectedRawSha256: string;
  desiredRawSha256: string;
  /** Caller verifies the exact signed pending rewind, current workspace/thread
   * generation and removal barriers. Invoked before and during recovery. */
  checkAllowed(): Promise<void>;
}

/** Targeted recovery for an unfinished conditional operation. Never replay a
 * desired cutover: only an actually parked source can fill a missing target.
 * An existing path wins, and a thread deletion marker always prevents revival. */
export async function recoverConditionalJsonKey(directory: string, key: string, input: ConditionalJsonRecoveryInput): Promise<boolean> {
  if (!validKey(key) || !/^thr_[a-f0-9]{32}$/.test(input.threadId) || key !== `thread-${input.threadId}`
    || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,179}$/.test(input.workspaceId) || typeof input.checkAllowed !== 'function'
    || ![input.expectedLogicalDigest, input.expectedRawSha256, input.desiredRawSha256].every(value => /^[a-f0-9]{64}$/.test(value))) throw conflict();
  await input.checkAllowed();
  const canonical = path.resolve(directory);
  if (await fs.realpath(canonical) !== canonical) throw conflict();
  const root = await fs.open(canonical, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  let bundle: FileHandle | undefined;
  try {
    const rootStat = await root.stat({ bigint: true }), rootAccess = `/proc/self/fd/${root.fd}`;
    const check = async () => {
      await input.checkAllowed();
      const current = await fs.lstat(canonical, { bigint: true });
      if (!current.isDirectory() || current.isSymbolicLink() || !sameNode(current, rootStat) || await fs.realpath(canonical) !== canonical) throw conflict();
      if (/^thread-thr_[a-f0-9]{32}$/.test(key)) {
        try { await fs.lstat(`${rootAccess}/thread-deleted-${key.slice(7)}.json`); throw conflict(); }
        catch (error) { if (!errno(error, 'ENOENT')) throw error; }
      }
    };
    await check();
    const target = `${rootAccess}/${key}.json`;
    try { await fs.lstat(target); return false; } catch (error) { if (!errno(error, 'ENOENT')) throw error; }
    // Only exact per-key candidates are considered. Refuse ambiguity; time,
    // directory order and a "latest" heuristic are not recovery authority.
    const candidates: Array<{ name: string; id: string }> = [];
    const entries = await fs.opendir(rootAccess, { bufferSize: 32 }); let scanned = 0;
    for await (const entry of entries) {
      if (++scanned > 100_000) throw new HttpError(503, 'Conditional state recovery reached its bounded directory limit.', 'STATE_CAS_RECOVERY_LIMIT');
      const prefix = `.state-cas-${key}-`;
      if (!entry.name.startsWith(prefix) || !/^[a-f0-9]{32}$/.test(entry.name.slice(prefix.length))) continue;
      await check();
      const candidateRoot = await fs.open(`${rootAccess}/${entry.name}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try {
        const access = `/proc/self/fd/${candidateRoot.fd}`, id = entry.name.slice(prefix.length);
        const metadata = (await readJson(`${access}/manifest.json`, STATE_CAS_LIMITS.manifestBytes)).value;
        if (!record(metadata) || metadata.version !== 1 || metadata.id !== id || metadata.key !== key) throw conflict();
        if (metadata.expectedSha256 !== input.expectedRawSha256 || metadata.desiredSha256 !== input.desiredRawSha256) continue;
        let finished = false;
        for (const marker of ['committed.json', 'restored.json']) {
          try { await fs.lstat(`${access}/${marker}`); finished = true; } catch (error) { if (!errno(error, 'ENOENT')) throw error; }
        }
        if (finished) continue;
        try { await fs.lstat(`${access}/source.json`); } catch (error) { if (errno(error, 'ENOENT')) continue; throw error; }
        const source = await readJson(`${access}/source.json`), desired = await readJson(`${access}/candidate.json`);
        const sourceOwner = owner(source.value), desiredOwner = owner(desired.value);
        if (source.sha256 !== input.expectedRawSha256 || desired.sha256 !== input.desiredRawSha256
          || hash(JSON.stringify(source.value)) !== input.expectedLogicalDigest
          || sourceOwner?.threadId !== input.threadId || sourceOwner?.workspaceId !== input.workspaceId
          || desiredOwner?.threadId !== input.threadId || desiredOwner?.workspaceId !== input.workspaceId) throw conflict(id);
        candidates.push({ name: entry.name, id });
        if (candidates.length > 1) throw conflict();
      } finally { await candidateRoot.close(); }
    }
    if (candidates.length !== 1) return false;
    const { name, id: recoveryId } = candidates[0], named = await fs.lstat(`${rootAccess}/${name}`, { bigint: true });
    if (!named.isDirectory() || named.isSymbolicLink()) throw conflict();
    bundle = await fs.open(`${rootAccess}/${name}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    if (!sameNode(named, await bundle.stat({ bigint: true }))) throw conflict();
    const access = `/proc/self/fd/${bundle.fd}`;
    const metadata = (await readJson(`${access}/manifest.json`, STATE_CAS_LIMITS.manifestBytes)).value;
    if (!record(metadata) || metadata.version !== 1 || metadata.id !== recoveryId || metadata.key !== key
      || metadata.expectedSha256 !== input.expectedRawSha256 || metadata.desiredSha256 !== input.desiredRawSha256) throw conflict();
    const source = await readJson(`${access}/source.json`), desired = await readJson(`${access}/candidate.json`);
    const sourceOwner = owner(source.value), desiredOwner = owner(desired.value);
    if (source.sha256 !== input.expectedRawSha256 || desired.sha256 !== input.desiredRawSha256
      || hash(JSON.stringify(source.value)) !== input.expectedLogicalDigest || sourceOwner?.threadId !== input.threadId
      || sourceOwner?.workspaceId !== input.workspaceId || desiredOwner?.threadId !== input.threadId || desiredOwner?.workspaceId !== input.workspaceId) throw conflict();
    // Completed operations and a source already restored earlier cannot become
    // authority to undo a later deliberate file removal.
    for (const marker of ['committed.json', 'restored.json']) {
      try { await fs.lstat(`${access}/${marker}`); return false; } catch (error) { if (!errno(error, 'ENOENT')) throw error; }
    }
    try { await publishPreparedCopy(`${access}/source.json`, bundle.fd, 'restore-publication.json', root.fd, `${key}.json`, check, input.expectedRawSha256); }
    catch (error) { if (errno(error, 'EEXIST')) return false; throw error; }
    await writeMarker(access, 'restored.json', { version: 1, id: recoveryId, key, createdAt: new Date().toISOString() });
    return true;
  } finally { await bundle?.close().catch(() => undefined); await root.close(); }
}
