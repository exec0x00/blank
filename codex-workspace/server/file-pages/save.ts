import { createHash, randomUUID, type Hash } from 'node:crypto';
import { constants, promises as fs, type BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { AppContext } from '../context';
import { HttpError } from '../errors';
import { assessHostAdmission, observeHostResources } from '../host-resources';
import { PublicBucketVerifier, captureDurableReceipt, type DurableFileReceipt } from '../file-transfers/durability';
import { withWorkspaceFileMutation } from '../file-transfers/queue';
import { FilePositionCache } from './cache';
import { filePagesLifecycleFor } from './lifecycle';
import { MAX_PAGE_BYTES, MAX_RANGE_SAVE_FILE_BYTES, MAX_RANGE_SAVE_OPERATIONS, PAGE_BYTES, RANGE_SAVE_TIMEOUT_MS } from './limits';
import { readFilePage } from './read';
import { fileSaveRecords, MAX_RECOVERY_RECORD_BYTES, MAX_RECOVERY_RECORDS, recoveryActive, recoveryKey, recoveryRecordPath, writeSaveRecord, type FileSaveRecord } from './recovery';
import { CREATE_FLAGS, errno, FileSource, nativeFileError, nativeIdentity } from './source';
import { FilePageTokens, type RangeToken } from './tokens';
import { conflict, filePagePath, rangeContent } from './validation';
import type { FileRangeSaveInput, WorkspaceFilePage } from './types';

export interface FileSaveOptions {
  /** Test seams replace admission/transport only, never file contents or writes. */
  checkResources?: (estimatedAdditionalBytes: number, signal: AbortSignal) => Promise<void>;
  verifyDurable?: (receipts: readonly DurableFileReceipt[], signal: AbortSignal) => Promise<void>;
}
const reservations = new Map<symbol, number>();
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
interface OutputFile { handle: FileHandle; access: string; absolute: string; initial: BigIntStats; bytes: number; hash: Hash; signal?: AbortSignal }

async function outputFile(source: FileSource, name: string): Promise<OutputFile> {
  source.signal?.throwIfAborted();
  await source.parent.check();
  source.signal?.throwIfAborted();
  const access = `${source.parent.access}/${name}`;
  const handle = await fs.open(access, CREATE_FLAGS, 0o600);
  try {
    const initial = await handle.stat({ bigint: true });
    if (!initial.isFile()) throw new HttpError(403, 'A temporary save is not a regular file.', 'UNSAFE_PATH');
    const absolute = path.join(source.parent.absolute, name);
    if (await fs.realpath(`/proc/self/fd/${handle.fd}`) !== absolute) conflict('The parent folder moved while preparing this save.');
    return { handle, access, absolute, initial, bytes: 0, hash: createHash('sha256'), signal: source.signal };
  } catch (error) { await handle.close(); throw error; }
}

async function writeOutput(output: OutputFile, bytes: Buffer): Promise<void> {
  let written = 0;
  while (written < bytes.length) {
    output.signal?.throwIfAborted();
    const { bytesWritten } = await output.handle.write(bytes, written, bytes.length - written, output.bytes);
    if (!bytesWritten) throw new HttpError(507, 'Storage stopped accepting the edited file. Keep your edits and retry later.', 'FILE_STORAGE_FULL');
    output.hash.update(bytes.subarray(written, written + bytesWritten));
    output.bytes += bytesWritten; written += bytesWritten;
  }
  output.signal?.throwIfAborted();
}

async function finishOutput(output: OutputFile, source: FileSource, preserveMode = true): Promise<BigIntStats> {
  output.signal?.throwIfAborted();
  await output.handle.chmod(preserveMode ? Number(source.initial.mode & 0o777n) : 0o600);
  output.signal?.throwIfAborted();
  await output.handle.sync();
  output.signal?.throwIfAborted();
  const stat = await output.handle.stat({ bigint: true });
  const named = await fs.lstat(output.access, { bigint: true });
  if (!stat.isFile() || stat.size !== BigInt(output.bytes) || nativeIdentity(stat) !== nativeIdentity(named)
    || stat.dev !== output.initial.dev || stat.ino !== output.initial.ino) conflict('A prepared save changed before it could be installed.');
  return stat;
}

async function copyEdited(source: FileSource, output: OutputFile, token: RangeToken, replacement: Buffer, check: () => Promise<void>): Promise<string> {
  const original = createHash('sha256');
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let inserted = false;
  for (let offset = 0; offset < source.size;) {
    await check();
    const bytes = await source.read(offset, Math.min(PAGE_BYTES, source.size - offset));
    if (bytes.includes(0)) throw new HttpError(415, 'Other parts of this file contain binary bytes. The original was not replaced.', 'BINARY_FILE');
    try { decoder.decode(bytes, { stream: true }); }
    catch { throw new HttpError(415, 'Other parts of this file are not valid UTF-8. The original was not replaced.', 'BINARY_FILE'); }
    original.update(bytes);
    const end = offset + bytes.length;
    if (offset < token.byteStart) await writeOutput(output, bytes.subarray(0, Math.min(bytes.length, token.byteStart - offset)));
    if (!inserted && token.byteStart <= end) { await writeOutput(output, replacement); inserted = true; }
    if (end > token.byteEnd) await writeOutput(output, bytes.subarray(Math.max(0, token.byteEnd - offset)));
    offset = end;
  }
  try { decoder.decode(); }
  catch { throw new HttpError(415, 'The file ends with an incomplete UTF-8 character. The original was not replaced.', 'BINARY_FILE'); }
  if (!inserted) await writeOutput(output, replacement);
  await source.check();
  return original.digest('hex');
}

async function sourceDigest(source: FileSource, check: () => Promise<void>): Promise<string> {
  await source.check();
  const hash = createHash('sha256');
  for (let offset = 0; offset < source.size;) {
    await check();
    const bytes = await source.read(offset, Math.min(PAGE_BYTES, source.size - offset));
    hash.update(bytes); offset += bytes.length;
  }
  await source.check();
  return hash.digest('hex');
}

async function copyRecovery(source: FileSource, recovery: OutputFile, expected: BigIntStats, destination: OutputFile,
  check: () => Promise<void>): Promise<void> {
  source.signal?.throwIfAborted();
  const input = await fs.open(recovery.access, READ_FLAGS);
  try {
    if (nativeIdentity(await input.stat({ bigint: true })) !== nativeIdentity(expected)) conflict('The recovery copy was changed. It was retained for inspection.');
    const buffer = Buffer.allocUnsafe(PAGE_BYTES);
    const hash = createHash('sha256');
    let offset = 0;
    while (offset < recovery.bytes) {
      await check();
      const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, recovery.bytes - offset), offset);
      source.signal?.throwIfAborted();
      if (!bytesRead) conflict('The recovery copy was truncated. The original was not replaced.');
      const bytes = buffer.subarray(0, bytesRead);
      hash.update(bytes); await writeOutput(destination, bytes); offset += bytesRead;
    }
    const after = await input.stat({ bigint: true });
    if (hash.digest('hex') !== recovery.hash.copy().digest('hex') || nativeIdentity(after) !== nativeIdentity(expected)
      || nativeIdentity(await fs.lstat(recovery.access, { bigint: true })) !== nativeIdentity(expected)) conflict('The recovery copy was changed. The original was not replaced.');
    await source.parent.check();
  } finally { await input.close(); }
}

async function verifyOutput(source: FileSource, output: OutputFile, expected: BigIntStats, check: () => Promise<void>): Promise<void> {
  source.signal?.throwIfAborted();
  await source.parent.check();
  source.signal?.throwIfAborted();
  const input = await fs.open(output.access, READ_FLAGS);
  try {
    if (nativeIdentity(await input.stat({ bigint: true })) !== nativeIdentity(expected)) conflict('A prepared save changed. The original was not replaced.');
    const buffer = Buffer.allocUnsafe(PAGE_BYTES);
    const hash = createHash('sha256');
    let offset = 0;
    while (offset < output.bytes) {
      await check();
      const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, output.bytes - offset), offset);
      source.signal?.throwIfAborted();
      if (!bytesRead) conflict('A prepared save was truncated. The original was not replaced.');
      hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
    }
    if (hash.digest('hex') !== output.hash.copy().digest('hex') || nativeIdentity(await input.stat({ bigint: true })) !== nativeIdentity(expected)
      || nativeIdentity(await fs.lstat(output.access, { bigint: true })) !== nativeIdentity(expected)) conflict('A prepared save changed. The original was not replaced.');
  } finally { await input.close(); }
}

/** Never remove a changed recovery/temporary copy, including a same-size edit. */
async function removeOwned(source: FileSource, output: OutputFile): Promise<boolean> {
  if (source.signal?.aborted) return false;
  let input: FileHandle | undefined;
  const deadline = Date.now() + 15_000;
  try {
    await source.parent.check();
    if (source.signal?.aborted) return false;
    input = await fs.open(output.access, READ_FLAGS);
    const before = await input.stat({ bigint: true });
    if (!before.isFile() || before.dev !== output.initial.dev || before.ino !== output.initial.ino || before.size !== BigInt(output.bytes)) return false;
    const buffer = Buffer.allocUnsafe(PAGE_BYTES);
    const hash = createHash('sha256');
    let offset = 0;
    while (offset < output.bytes) {
      if (Date.now() > deadline || source.signal?.aborted) return false;
      const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, output.bytes - offset), offset);
      if (!bytesRead) return false;
      hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
    }
    if (hash.digest('hex') !== output.hash.copy().digest('hex') || nativeIdentity(await input.stat({ bigint: true })) !== nativeIdentity(before)
      || nativeIdentity(await fs.lstat(output.access, { bigint: true })) !== nativeIdentity(before)) return false;
    await source.parent.check();
    if (Date.now() > deadline || source.signal?.aborted) return false;
    await fs.unlink(output.access);
    return true;
  } catch (error) { return errno(error, 'ENOENT'); }
  finally { await input?.close().catch(() => undefined); }
}

async function performSave(ctx: AppContext, tokens: FilePageTokens, positions: FilePositionCache, workspaceId: string,
  relative: string, token: RangeToken, replacement: Buffer, reservation: symbol, options: FileSaveOptions, signal: AbortSignal): Promise<WorkspaceFilePage> {
  signal.throwIfAborted();
  const source = await FileSource.open(ctx, workspaceId, relative, token.version, signal);
  let recovery: OutputFile | undefined;
  let install: OutputFile | undefined;
  let current: FileSource | undefined;
  let record: FileSaveRecord | undefined;
  let completeCopy = false;
  let preparedRecovery: Pick<FileSaveRecord, 'sha256' | 'recoveryIdentity'> | undefined;
  let commitStarted = false;
  let destinationConfirmed = false;
  let recoveryRemoved = false;
  let releaseRecord: (() => void) | undefined;
  let manual: { workspaceId: string; operationId: string; paths: string[] } | undefined;
  const deadline = Date.now() + RANGE_SAVE_TIMEOUT_MS;
  let nextResourceCheck = 0;
  const check = async () => {
    signal.throwIfAborted();
    if (Date.now() > deadline) throw new HttpError(503, 'This save exceeded its time limit. Keep your edits and inspect any recovery copy before retrying.', 'FILE_SAVE_TIMEOUT');
    if (Date.now() < nextResourceCheck) return;
    const estimate = 32 * 1024 * 1024 + [...reservations.values()].reduce((sum, bytes) => sum + bytes, 0);
    if (options.checkResources) await options.checkResources(estimate, signal);
    else if (ctx.config.production || ctx.config.requirePersistentData) {
      const admission = assessHostAdmission(await observeHostResources(ctx.config), { estimatedAdditionalBytes: estimate });
      if (!admission.allowed) throw new HttpError(503, 'There is not enough confirmed instance memory headroom to save this file. Keep your edits and wait for other work to finish.', 'FILE_SAVE_RESOURCES');
    }
    signal.throwIfAborted();
    nextResourceCheck = Date.now() + 5_000;
  };
  let verifier: PublicBucketVerifier | undefined;
  const verify = async (receipts: readonly DurableFileReceipt[]) => {
    await check();
    if (!ctx.config.requirePersistentData) return;
    if (options.verifyDurable) await options.verifyDurable(receipts, signal);
    else {
      verifier ??= new PublicBucketVerifier(ctx.config, { checkResources: check, deadline, signal });
      await verifier.verify(receipts);
    }
    signal.throwIfAborted();
  };
  const updateRecord = async (patch: Partial<FileSaveRecord>, duringShutdown = false) => {
    if (!duringShutdown) signal.throwIfAborted();
    const next = { ...record!, ...patch };
    await writeSaveRecord(ctx, next); record = next;
    if (!duringShutdown) signal.throwIfAborted();
  };
  try {
    tokens.check(token, source);
    if (source.size > MAX_RANGE_SAVE_FILE_BYTES) throw new HttpError(413, 'Safe range saves support complete files up to 64 MiB. This larger file remains read-only.', 'FILE_RANGE_SAVE_LIMIT');
    if (token.byteEnd > source.size || token.byteEnd - token.byteStart > MAX_PAGE_BYTES) conflict('The edited range no longer matches this file.');
    const resultingSize = source.size - (token.byteEnd - token.byteStart) + replacement.length;
    if (resultingSize > MAX_RANGE_SAVE_FILE_BYTES) throw new HttpError(413, 'This edit would exceed the 64 MiB safe-save limit. The original was not changed.', 'FILE_RANGE_SAVE_LIMIT');
    reservations.set(reservation, Math.max(source.size, resultingSize) * 3);
    await check();
    const originalRange = await source.read(token.byteStart, token.byteEnd - token.byteStart);
    if (createHash('sha256').update(originalRange).digest('hex') !== token.sha256) conflict();
    if ((await fileSaveRecords(ctx, signal)).length >= MAX_RECOVERY_RECORDS - MAX_RANGE_SAVE_OPERATIONS) {
      throw new HttpError(429, 'File recovery storage is full. Inspect retained recovery copies before saving another large file.', 'FILE_RECOVERY_FULL');
    }
    const id = randomUUID();
    const recoveryName = `.codex-recovery-${id}.recovery`;
    record = { format: 1, id, workspaceId, path: relative, canonicalPath: source.canonicalPath,
      recoveryPath: path.posix.join(path.posix.dirname(source.canonicalPath), recoveryName), originalVersion: source.version,
      size: resultingSize, completeCopy: false, phase: 'preparing', createdAt: new Date().toISOString() };
    signal.throwIfAborted();
    await writeSaveRecord(ctx, record, true);
    signal.throwIfAborted();
    releaseRecord = recoveryActive(ctx, id);
    manual = { workspaceId, operationId: id, paths: [...new Set([relative, source.canonicalPath, record.recoveryPath])] };
    ctx.events.emit('workspace:manual-intent', { ...manual, phase: 'start' });
    recovery = await outputFile(source, recoveryName);
    const originalHash = await copyEdited(source, recovery, token, replacement, check);
    await finishOutput(recovery, source, false);
    await recovery.handle.close();
    const recovered = await fs.lstat(recovery.access, { bigint: true });
    if (!recovered.isFile() || recovered.dev !== recovery.initial.dev || recovered.ino !== recovery.initial.ino
      || recovered.size !== BigInt(recovery.bytes)) conflict('The recovery copy changed while closing. The original was not replaced.');
    if (recovery.bytes !== resultingSize) throw new Error('The replacement size did not match its range.');
    completeCopy = true;
    const editedHash = recovery.hash.copy().digest('hex');
    preparedRecovery = { sha256: editedHash, recoveryIdentity: nativeIdentity(recovered) };
    await updateRecord({ completeCopy: true, phase: 'ready', ...preparedRecovery });
    await verify([{ absolute: recovery.absolute, size: recovery.bytes, sha256: editedHash },
      await captureDurableReceipt(ctx.config, recoveryRecordPath(ctx, id), MAX_RECOVERY_RECORD_BYTES)]);

    // Keep the durable recovery object intact while a separate complete file is
    // installed. A FUSE rename must never delete the only confirmed edited copy.
    const installName = `.codex-write-${randomUUID()}`;
    await updateRecord({ installName });
    install = await outputFile(source, installName);
    await copyRecovery(source, recovery, recovered, install, check);
    await finishOutput(install, source);
    await install.handle.close();
    const installed = await fs.lstat(install.access, { bigint: true });
    if (!installed.isFile() || installed.dev !== install.initial.dev || installed.ino !== install.initial.ino
      || installed.size !== BigInt(install.bytes)) conflict('A prepared save changed while closing. The original was not replaced.');
    await updateRecord({ phase: 'committing' });
    await verify([await captureDurableReceipt(ctx.config, recoveryRecordPath(ctx, id), MAX_RECOVERY_RECORD_BYTES)]);
    await verifyOutput(source, install, installed, check);
    await verifyOutput(source, recovery, recovered, check);
    if (await sourceDigest(source, check) !== originalHash) conflict('The original changed while this save was prepared. The recovery copy was retained.');
    if (nativeIdentity(await fs.lstat(install.access, { bigint: true })) !== nativeIdentity(installed)
      || nativeIdentity(await fs.lstat(recovery.access, { bigint: true })) !== nativeIdentity(recovered)) conflict('A prepared save changed before installation. The original was not replaced.');
    await source.check();
    signal.throwIfAborted();
    commitStarted = true;
    await fs.rename(install.access, source.access);
    await updateRecord({ phase: 'confirming' });
    current = await FileSource.open(ctx, workspaceId, relative, undefined, signal);
    if (current.size !== resultingSize || await sourceDigest(current, check) !== editedHash) conflict('The installed file changed before saving could be confirmed. The recovery copy was retained.');
    await verify([{ absolute: current.absolute, size: current.size, sha256: editedHash }]);
    await current.check();
    destinationConfirmed = true;
    const page = await readFilePage(current, tokens, positions, token.byteStart,
      { format: 1, kind: 'page', binding: current.binding, version: current.version, offset: token.byteStart, line: token.line }, token.byteStart + replacement.length);
    if (page.content !== replacement.toString('utf8')) conflict('The edited range changed after saving. The recovery copy was retained.');
    await updateRecord({ phase: 'complete' });
    if (await removeOwned(source, recovery)) {
      recoveryRemoved = true;
      signal.throwIfAborted();
      await ctx.store.delete(recoveryKey(id)).catch(() => undefined);
    }
    else await updateRecord({ issue: 'The original save was confirmed. Its recovery copy changed independently or could not be removed and was retained.' });
    await current.check();
    ctx.events.emit('workspace:changed', { workspaceId, paths: manual.paths });
    return page;
  } catch (error) {
    // Cancellation retains both full and partial preparation. Cleanup itself
    // must not extend shutdown or unlink a recovery path after admission stops.
    if (install && !signal.aborted) await removeOwned(source, install);
    if (recoveryRemoved) {
      if (signal.aborted && record) await updateRecord({ phase: 'complete',
        issue: 'The file save was confirmed and its owned recovery copy was removed before shutdown finished. No recovery action will run automatically.' }, true).catch(() => undefined);
      return nativeFileError(signal.aborted ? signal.reason : error, true);
    }
    const removedPartial = signal.aborted ? false : recovery && !completeCopy ? await removeOwned(source, recovery) : !recovery;
    if (record) {
      if (!signal.aborted && !completeCopy && removedPartial) await ctx.store.delete(recoveryKey(record.id)).catch(() => undefined);
      else {
        const issue = destinationConfirmed ? 'The edited file was confirmed, but save completion was interrupted. Its recovery copy was retained. Reload the current file before retrying.'
          : commitStarted ? 'A replacement was attempted, but confirmation did not finish. Compare the original with the retained recovery copy before retrying.'
          : completeCopy ? 'The original was not replaced. A full edited recovery copy was retained for inspection.'
          : 'Preparing this save did not finish. Its recovery path may contain an incomplete copy or no file yet; the original was not replaced.';
        await updateRecord({ phase: 'interrupted', issue, ...(completeCopy && preparedRecovery ? { completeCopy: true, ...preparedRecovery } : {}) }, true).catch(() => undefined);
        ctx.events.emit('workspace:changed', { workspaceId, paths: [relative, record.recoveryPath] });
        const explanation = `${issue} Recovery file: ${record.recoveryPath}`;
        if (signal.aborted) throw new HttpError(503, `${signal.reason instanceof Error ? signal.reason.message : 'File editing is shutting down.'} ${explanation}`, 'FILE_PAGES_CLOSING');
        if (commitStarted) throw new HttpError(error instanceof HttpError && error.status === 409 ? 409 : 503, explanation,
          error instanceof HttpError && error.code === 'VERSION_CONFLICT' ? error.code : 'FILE_SAVE_CONFIRMATION_PENDING');
        if (error instanceof HttpError) throw new HttpError(error.status, `${error.message} ${explanation}`, error.code);
        throw new HttpError(503, explanation, 'FILE_SAVE_FAILED');
      }
    }
    return nativeFileError(signal.aborted ? signal.reason : error, true);
  } finally {
    try { if (manual) ctx.events.emit('workspace:manual-intent', { ...manual, phase: 'end' }); }
    finally {
      releaseRecord?.();
      await current?.close();
      await install?.handle.close().catch(() => undefined);
      await recovery?.handle.close().catch(() => undefined);
      await source.close();
    }
  }
}

export function saveFileRange(ctx: AppContext, tokens: FilePageTokens, positions: FilePositionCache, workspaceId: string,
  input: FileRangeSaveInput, options: FileSaveOptions = {}): Promise<WorkspaceFilePage> {
  return filePagesLifecycleFor(ctx).run(async signal => {
    const relative = filePagePath(input.path);
    const token = tokens.read(input.pageToken, 'range');
    const replacement = rangeContent(input.content);
    if (reservations.size >= MAX_RANGE_SAVE_OPERATIONS) throw new HttpError(429, 'Two large-file saves are already running. Wait for a save to finish.', 'FILE_SAVE_BUSY');
    const reservation = Symbol('file-page-save');
    reservations.set(reservation, 0);
    try { return await withWorkspaceFileMutation(ctx.config.workspacesDir, workspaceId,
      () => performSave(ctx, tokens, positions, workspaceId, relative, token, replacement, reservation, options, signal), { signal }); }
    finally { reservations.delete(reservation); }
  });
}
