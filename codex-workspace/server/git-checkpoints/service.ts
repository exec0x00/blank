import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppContext } from '../context';
import { HttpError } from '../errors';
import { inspectWorkspaceRepository } from '../worktrees/validation';
import { withWorkspaceFileMutation } from '../file-transfers/queue';
import { prepareRuntimeStorage } from '../runtime-storage';
import { observeHostResources, assessHostAdmission } from '../host-resources';
import { CheckpointDirectory, changed, digest, limit, readRegular, readWorkingFile, relativePath, verifyWorkingIdentity } from './filesystem';
import { readGit, type CheckpointGitDirectories } from './git-reader';
import { parseGitCheckpointIndex } from './git-index';
import { CheckpointRepositoryIdentity, sameCheckpointRepository, type RegisteredRepositoryDirectories } from './logical-identity';
import { CHECKPOINT_LIMITATIONS, CHECKPOINT_LIMITS, CheckpointStore, GitObjectWriter, canonicalJson, checkedId,
  checkpointReference, gitObjectId, manifestHash, writeTree } from './store';
import type { GitCheckpointCaptureInput, GitCheckpointCaptureResult, GitCheckpointCurrent, GitCheckpointFile,
  GitCheckpointIndex, GitCheckpointLimits, GitCheckpointManifest, GitCheckpointOptions, GitCheckpointReference, GitCheckpointRepository } from './types';

interface ScanOptions extends GitCheckpointOptions { additionalPaths?: string[]; writer?: GitObjectWriter }
interface ScanResult extends GitCheckpointCurrent { contentBytes: number }
interface RepositoryHandles extends RegisteredRepositoryDirectories { close(): Promise<void> }
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const validOid = (value: string, format: 'sha1' | 'sha256'): boolean => (format === 'sha256' ? /^[a-f0-9]{64}$/ : /^[a-f0-9]{40}$/).test(value);
const zeroOid = (value: string): boolean => /^0+$/.test(value);
const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item); }
  return value;
};
function repositoryChanged(): never { throw new HttpError(409, 'The repository identity, branch or HEAD changed after this checkpoint. Conversation history can still be rewound without changing files.', 'CHECKPOINT_REPOSITORY_CHANGED'); }
function validText(bytes: Buffer): string { try { return utf8.decode(bytes); } catch { throw new HttpError(409, 'This repository contains filenames that are not valid UTF-8; an exact file checkpoint is unavailable.', 'CHECKPOINT_FILENAME_ENCODING'); } }
function pathsFrom(bytes: Buffer): string[] {
  if (!bytes.length) return [];
  if (bytes.at(-1) !== 0) changed();
  return validText(bytes.subarray(0, -1)).split('\0').map(value => relativePath(value));
}
function publicFailure(error: unknown): GitCheckpointCaptureResult {
  if (error instanceof HttpError) return { status: 'unavailable', code: error.code ?? 'CHECKPOINT_UNAVAILABLE', reason: error.message };
  const code = (error as NodeJS.ErrnoException)?.code;
  return { status: 'unavailable', code: 'CHECKPOINT_UNAVAILABLE', reason: code === 'ENOSPC'
    ? 'Checkpoint storage has insufficient space. Existing files and conversation history were preserved.'
    : 'An exact file checkpoint could not be saved. Conversation history remains available.' };
}

/** Native Git objects live in an isolated durable repository; live Git is read-only plumbing. */
export class GitCheckpointService {
  readonly limits: GitCheckpointLimits;
  private readonly store: CheckpointStore;
  private readonly identities: CheckpointRepositoryIdentity;
  private closed = false;
  private closing?: Promise<void>;
  constructor(private readonly ctx: AppContext, options: { limits?: Partial<GitCheckpointLimits> } = {}) {
    this.limits = { ...CHECKPOINT_LIMITS, ...options.limits };
    for (const [name, value] of Object.entries(this.limits)) {
      if (!Number.isSafeInteger(value) || value < 1 || value > CHECKPOINT_LIMITS[name as keyof GitCheckpointLimits]) throw new Error('Checkpoint limit overrides may only lower the safe defaults.');
    }
    this.store = new CheckpointStore(ctx, this.limits);
    this.identities = new CheckpointRepositoryIdentity(ctx.config);
  }
  private open(): void { if (this.closed) throw new HttpError(503, 'The checkpoint service has closed. Retry with a fresh workspace session.', 'CHECKPOINT_CLOSED'); }
  close(): Promise<void> { if (this.closing) return this.closing; this.closed = true; return this.closing = this.identities.close(); }
  private async resources(writing = true): Promise<void> {
    const admission = assessHostAdmission(await observeHostResources(this.ctx.config), {
      // Worst-case working bytes, loose-object compression, file cache and native batch output.
      estimatedAdditionalBytes: this.limits.totalBytes * 4 + this.limits.indexBytes * 2,
    });
    if (!admission.allowed) throw new HttpError(503, 'Available instance memory is below the checkpoint reserve. Existing files were left unchanged.', 'CHECKPOINT_MEMORY_LIMIT');
    if (!writing) return;
    for (const location of [this.ctx.config.stateDir, this.ctx.config.runtimeDir]) {
      const space = await fs.statfs(location, { bigint: true }).catch(error => {
        if (['ENOENT', 'ENOSYS', 'EOPNOTSUPP'].includes((error as NodeJS.ErrnoException).code ?? '')) return null;
        throw error;
      });
      // Some FUSE backends do not report a capacity. Their bounded writes and
      // explicit ENOSPC failures remain authoritative; do not invent free space.
      if (space && space.blocks > 0n && space.bsize > 0n && space.bavail * space.bsize < BigInt(this.limits.totalBytes * 2 + this.limits.indexBytes)) {
        throw new HttpError(507, 'There is not enough free storage to capture and verify this checkpoint. Existing files were left unchanged.', 'CHECKPOINT_STORAGE_LIMIT');
      }
    }
  }
  private async repository(workspaceId: string, createIdentity = false): Promise<RepositoryHandles> {
    this.open();
    const workspace = await this.ctx.workspaces.get(checkedId(workspaceId));
    const inspected = await inspectWorkspaceRepository(this.ctx, workspace, false);
    if (!inspected) throw new HttpError(409, 'File checkpoints are available for Git repositories. This turn can still use conversation-only rewind.', 'CHECKPOINT_NOT_A_REPOSITORY');
    const opened: CheckpointDirectory[] = [];
    try {
      const root = await CheckpointDirectory.absolute(inspected.root); opened.push(root);
      const git = await CheckpointDirectory.absolute(inspected.gitDirectory); opened.push(git);
      const common = await CheckpointDirectory.absolute(inspected.commonDirectory); opened.push(common);
      const directories = { root, git, common, workspace, repositoryWorkspace: inspected.repositoryWorkspace };
      await this.identities.observe(directories, createIdentity);
      return { ...directories, close: async () => { for (const directory of opened.reverse()) await directory.close(); } };
    } catch (error) { for (const directory of opened.reverse()) await directory.close(); throw error; }
  }
  private async repositoryState(directories: RepositoryHandles, options: GitCheckpointOptions): Promise<GitCheckpointRepository> {
    const generation = await this.identities.observe(directories);
    const promisor = await readGit(directories, ['config', '--null', '--get-regexp', '^(extensions\\.partialclone|remote\\..*\\.promisor)$'],
      { signal: options.signal, maximum: 64 * 1024, allowFailure: true });
    if (promisor.code === 0) throw new HttpError(409, 'Partial-clone and promisor repositories require manual recovery; checkpoints never fetch missing objects.', 'CHECKPOINT_PARTIAL_CLONE');
    if (promisor.code !== 1) throw new HttpError(409, 'The repository configuration could not be inspected safely. No files were changed.', 'CHECKPOINT_GIT_FAILED');
    const rawFormat = (await readGit(directories, ['rev-parse', '--show-object-format'], { signal: options.signal, maximum: 32 })).bytes.toString('ascii').trim();
    if (rawFormat !== 'sha1' && rawFormat !== 'sha256') throw new HttpError(409, 'This Git object format is not supported by exact checkpoints.', 'CHECKPOINT_OBJECT_FORMAT');
    const headBytes = await readRegular(directories.git, 'HEAD', 4096);
    if (!headBytes) repositoryChanged();
    const rawHead = validText(headBytes).trim();
    const headRef = rawHead.startsWith('ref: refs/') ? rawHead.slice(5) : null;
    if (!headRef && !validOid(rawHead, rawFormat) || headRef && /[\u0000-\u0020\u007f]/.test(headRef)) repositoryChanged();
    const head = await readGit(directories, ['rev-parse', '--verify', 'HEAD'], { signal: options.signal, maximum: 256, allowFailure: true });
    const oid = head.code === 0 ? head.bytes.toString('ascii').trim() : null;
    if (oid !== null && !validOid(oid, rawFormat) || oid === null && (!headRef || head.code !== 128)) repositoryChanged();
    return { root: directories.root.absolute, gitDirectory: directories.git.absolute, commonDirectory: directories.common.absolute,
      rootIdentity: { ...directories.root.initial }, gitIdentity: { ...directories.git.initial }, commonIdentity: { ...directories.common.initial },
      generation, observedIn: this.identities.observedIn, objectFormat: rawFormat, head: oid, headRef };
  }
  private async knownPaths(directories: CheckpointGitDirectories, repository: GitCheckpointRepository, index: GitCheckpointIndex,
    indexFile: string, options: GitCheckpointOptions): Promise<{ paths: string[]; tracked: Set<string>; untracked: string[] }> {
    const tracked = new Set(index.entries.map(entry => entry.path));
    if (repository.head) {
      const tree = await readGit(directories, ['ls-tree', '-r', '-z', '--full-tree', repository.head], { signal: options.signal, maximum: this.limits.metadataBytes });
      for (const record of pathsFromTree(tree.bytes)) tracked.add(record);
    }
    const others = await readGit(directories, ['ls-files', '--others', '--exclude-standard', '-z'], { indexFile, signal: options.signal, maximum: this.limits.metadataBytes });
    const untracked = pathsFrom(others.bytes).sort();
    const paths = [...new Set([...tracked, ...untracked])].sort();
    if (paths.length > this.limits.files) limit();
    return { paths, tracked, untracked };
  }
  private async scan(directories: RepositoryHandles, options: ScanOptions): Promise<ScanResult> {
    const started = Date.now();
    const check = () => { options.signal?.throwIfAborted(); if (Date.now() - started > this.limits.milliseconds) throw new HttpError(504, 'Checkpoint capture reached its bounded time limit. Existing files were preserved.', 'CHECKPOINT_TIMEOUT'); };
    check(); await this.resources(!!options.writer);
    const runtime = await prepareRuntimeStorage(this.ctx.config);
    const scratch = await fs.mkdtemp(path.join(runtime.temporaryDir, 'git-checkpoint-'));
    const indexFile = path.join(scratch, 'index');
    try {
      const repository = await this.repositoryState(directories, options);
      const rawIndex = await readRegular(directories.git, 'index', this.limits.indexBytes);
      const parsed = parseGitCheckpointIndex(rawIndex, repository.objectFormat, { maxEntries: this.limits.files * 3, maxBytes: this.limits.indexBytes });
      const index: GitCheckpointIndex = { ...parsed, blob: null };
      if (rawIndex) await fs.writeFile(indexFile, rawIndex, { flag: 'wx', mode: 0o600 });
      const known = await this.knownPaths(directories, repository, index, indexFile, options);
      const paths = [...new Set([...known.paths, ...(options.additionalPaths ?? []).map(value => relativePath(value))])].sort();
      if (paths.length > this.limits.files || paths.reduce((total, value) => total + Buffer.byteLength(value), 0) > this.limits.metadataBytes / 2) limit();
      const files: GitCheckpointFile[] = [];
      let contentBytes = rawIndex?.length ?? 0, nextResourceCheck = Date.now() + 5_000;
      for (const name of paths) {
        check();
        if (Date.now() >= nextResourceCheck) { await this.resources(); nextResourceCheck = Date.now() + 5_000; }
        const { entry, bytes } = await readWorkingFile(directories.root, name, known.tracked.has(name), this.limits.fileBytes);
        contentBytes += entry.bytes;
        if (contentBytes > this.limits.totalBytes) limit();
        if (bytes && options.writer) entry.blob = await options.writer.write('blob', bytes);
        files.push(entry);
      }
      if (options.writer) {
        if (rawIndex) index.blob = await options.writer.write('blob', rawIndex);
        contentBytes += await this.indexObjects(directories, repository, index, options.writer, this.limits.totalBytes - contentBytes, options);
      }
      check();
      for (const file of files) { check(); await verifyWorkingIdentity(directories.root, file); }
      const afterIndex = await readRegular(directories.git, 'index', this.limits.indexBytes);
      if (rawIndex === null ? afterIndex !== null : afterIndex === null || !rawIndex.equals(afterIndex)) changed();
      const after = await this.repositoryState(directories, options);
      if (canonicalJson(repository) !== canonicalJson(after)) repositoryChanged();
      const afterOthers = await readGit(directories, ['ls-files', '--others', '--exclude-standard', '-z'], { indexFile, signal: options.signal, maximum: this.limits.metadataBytes });
      if (canonicalJson(pathsFrom(afterOthers.bytes).sort()) !== canonicalJson(known.untracked)) changed();
      check();
      const state = { repository, files, index };
      const token = digest(canonicalJson({ repository,
        files: files.map(file => ({ path: file.path, kind: file.kind, mode: file.mode, bytes: file.bytes, sha256: file.sha256, tracked: file.tracked })),
        index: { present: index.present, sha256: index.sha256, bytes: index.bytes } }));
      return { ...state, token, contentBytes };
    } finally {
      // Only this invocation's known private file; no broad temporary-directory sweep.
      await fs.unlink(indexFile).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
      await fs.rmdir(scratch);
    }
  }
  private async indexObjects(directories: CheckpointGitDirectories, repository: GitCheckpointRepository, index: GitCheckpointIndex,
    writer: GitObjectWriter, remaining: number, options: GitCheckpointOptions): Promise<number> {
    const ids = [...new Set(index.entries.map(entry => entry.objectId).filter(id => !zeroOid(id)))].sort();
    if (!ids.length) return 0;
    const input = Buffer.from(ids.join('\n') + '\n');
    const sizes = await readGit(directories, ['cat-file', '--batch-check'], { input, signal: options.signal, maximum: ids.length * 128 + 1 });
    const records = sizes.bytes.toString('ascii').trimEnd().split('\n');
    if (records.length !== ids.length) changed();
    const expected = new Map<string, number>();
    let bytes = 0;
    for (let i = 0; i < ids.length; i++) {
      const match = /^([a-f0-9]+) blob (\d+)$/.exec(records[i]);
      if (!match || match[1] !== ids[i]) throw new HttpError(409, 'A staged Git blob is missing or unsupported. Its exact checkpoint was not saved.', 'CHECKPOINT_MISSING_INDEX_OBJECT');
      const size = Number(match[2]);
      if (!Number.isSafeInteger(size) || size > this.limits.fileBytes) limit();
      bytes += size; if (bytes > remaining) limit(); expected.set(ids[i], size);
    }
    const contents = await readGit(directories, ['cat-file', '--batch'], { input, signal: options.signal, maximum: bytes + ids.length * 128 + 1 });
    let offset = 0;
    const blobs = new Map<string, string>();
    for (const id of ids) {
      options.signal?.throwIfAborted();
      const newline = contents.bytes.indexOf(10, offset), size = expected.get(id)!;
      if (newline < offset || newline - offset > 128 || contents.bytes.subarray(offset, newline).toString('ascii') !== `${id} blob ${size}`) changed();
      const body = contents.bytes.subarray(newline + 1, newline + 1 + size);
      if (body.length !== size || contents.bytes[newline + 1 + size] !== 10 || gitObjectId('blob', body, repository.objectFormat) !== id) changed();
      blobs.set(id, await writer.write('blob', body)); offset = newline + 2 + size;
    }
    if (offset !== contents.bytes.length) changed();
    for (const entry of index.entries) entry.blob = blobs.get(entry.objectId) ?? null;
    return bytes;
  }
  async capture(input: GitCheckpointCaptureInput): Promise<GitCheckpointCaptureResult> {
    this.open();
    checkedId(input.workspaceId); checkedId(input.threadId); checkedId(input.turnId);
    try {
      return await withWorkspaceFileMutation(this.ctx.config.workspacesDir, input.workspaceId, async (): Promise<GitCheckpointCaptureResult> => {
        input.signal?.throwIfAborted();
        const deadline = Date.now() + this.limits.milliseconds;
        await this.resources();
        const directories = await this.repository(input.workspaceId, true);
        let capture: Awaited<ReturnType<CheckpointStore['create']>> | undefined, published = false;
        try {
          capture = await this.store.create(input);
          const writer = new GitObjectWriter(capture.directory, this.limits.totalBytes * 2 + this.limits.metadataBytes,
            this.limits.files * 4 + 256, { signal: input.signal, deadline });
          const scan = await this.scan(directories, { signal: input.signal, writer });
          const workingTree = await writeTree(writer, scan.files.filter(file => file.kind !== 'missing').map(file => ({ path: file.path,
            mode: file.kind === 'symlink' ? '120000' : file.mode & 0o100 ? '100755' : '100644', oid: file.blob! })));
          const stagedTree = await writeTree(writer, [...new Map(scan.index.entries.filter(entry => entry.blob).map(entry => [entry.objectId, entry.blob!])).entries()]
            .map(([id, oid]) => ({ path: id, mode: '100644', oid })));
          const tree = await writeTree(writer, [ { path: 'worktree', mode: '40000', oid: workingTree }, { path: 'staged', mode: '40000', oid: stagedTree },
            ...(scan.index.blob ? [{ path: 'index', mode: '100644', oid: scan.index.blob }] : []) ]);
          const finished = await writer.finish(tree, capture.owner.createdAt);
          const { kind: _kind, ...reference } = capture.owner;
          const manifest: GitCheckpointManifest = { ...reference, manifestHash: '', repository: scan.repository, files: scan.files, index: scan.index,
            tree, commit: finished.commit, contentBytes: scan.contentBytes, storedBytes: finished.storedBytes, limitations: [...CHECKPOINT_LIMITATIONS] };
          manifest.manifestHash = manifestHash(manifest);
          writer.check();
          await this.store.publish(capture.directory, manifest); published = true;
          return { status: 'ready', checkpoint: checkpointReference(manifest), files: scan.files.filter(file => file.kind !== 'missing').length,
            bytes: scan.contentBytes, limitations: [...CHECKPOINT_LIMITATIONS] };
        } finally {
          if (capture) {
            if (!published) await this.store.discard(capture.directory).catch(() => undefined);
            await capture.directory.close();
          }
          await directories.close();
        }
      }, { signal: input.signal });
    } catch (error) { if (input.signal?.aborted) throw input.signal.reason; return publicFailure(error); }
  }
  async read(reference: GitCheckpointReference, options: GitCheckpointOptions = {}): Promise<GitCheckpointManifest> {
    this.open();
    options.signal?.throwIfAborted();
    const opened = await this.store.open(checkpointReference(reference as GitCheckpointManifest));
    try { return deepFreeze(opened.manifest); }
    finally { await opened.directory.close(); }
  }
  async readBlob(manifest: GitCheckpointManifest, blob: string, options: GitCheckpointOptions = {}): Promise<Buffer> {
    return (await this.readBlobs(manifest, [blob], options)).get(blob)!;
  }
  async readBlobs(manifest: GitCheckpointManifest, blobs: readonly string[], options: GitCheckpointOptions = {}): Promise<Map<string, Buffer>> {
    this.open();
    options.signal?.throwIfAborted();
    if (!Array.isArray(blobs) || blobs.length > this.limits.files * 4 + 1) limit();
    await this.resources(false);
    const opened = await this.store.open(checkpointReference(manifest));
    try {
      const known = new Map<string, { bytes?: number; sha256?: string; objectIds: string[] }>();
      for (const file of opened.manifest.files) if (file.blob) known.set(file.blob, { bytes: file.bytes, sha256: file.sha256!, objectIds: [] });
      if (opened.manifest.index.blob) known.set(opened.manifest.index.blob, { bytes: opened.manifest.index.bytes, sha256: opened.manifest.index.sha256!, objectIds: [] });
      for (const entry of opened.manifest.index.entries) if (entry.blob) {
        const expected = known.get(entry.blob) ?? { objectIds: [] };
        if (!expected.objectIds.includes(entry.objectId)) expected.objectIds.push(entry.objectId);
        known.set(entry.blob, expected);
      }
      const output = new Map<string, Buffer>();
      let total = 0;
      for (const blob of new Set(blobs)) {
        options.signal?.throwIfAborted();
        const expected = known.get(blob);
        if (!expected) throw new HttpError(404, 'This blob does not belong to the selected checkpoint.', 'CHECKPOINT_BLOB_NOT_FOUND');
        const bytes = await this.store.blob(opened.directory, blob, Math.max(this.limits.fileBytes, this.limits.indexBytes));
        total += bytes.length; if (total > this.limits.totalBytes) limit();
        if (expected.bytes !== undefined && expected.bytes !== bytes.length || expected.sha256 !== undefined && expected.sha256 !== digest(bytes)) changed();
        const objectId = gitObjectId('blob', bytes, opened.manifest.repository.objectFormat);
        if (expected.objectIds.some(expectedId => expectedId !== objectId)) changed();
        output.set(blob, bytes);
      }
      return output;
    } finally { await opened.directory.close(); }
  }
  async readIndex(manifest: GitCheckpointManifest, options: GitCheckpointOptions = {}): Promise<Buffer | null> {
    const actual = await this.read(manifest, options);
    return actual.index.blob ? this.readBlob(actual, actual.index.blob, options) : null;
  }
  async assertRepository(manifest: GitCheckpointManifest, options: GitCheckpointOptions = {}): Promise<GitCheckpointRepository> {
    const actual = await this.read(manifest, options);
    const directories = await this.repository(actual.workspaceId);
    try {
      const current = await this.repositoryState(directories, options);
      if (!sameCheckpointRepository(current, actual.repository)) repositoryChanged();
      return current;
    } finally { await directories.close(); }
  }
  async inspectCurrent(manifest: GitCheckpointManifest, options: GitCheckpointOptions = {}): Promise<GitCheckpointCurrent> {
    const actual = await this.read(manifest, options);
    const directories = await this.repository(actual.workspaceId);
    try {
      const state = await this.scan(directories, { ...options, additionalPaths: actual.files.map(file => file.path) });
      if (!sameCheckpointRepository(state.repository, actual.repository)) repositoryChanged();
      return { repository: state.repository, files: state.files, index: state.index, token: state.token };
    } finally { await directories.close(); }
  }
  /** Read-only recovery observation. It validates the current registration but
   * deliberately does not authorize restoring an earlier branch or HEAD. */
  async inspectWorkspaceCurrent(workspaceId: string, options: GitCheckpointOptions & { paths?: readonly string[] } = {}): Promise<GitCheckpointCurrent> {
    const directories = await this.repository(workspaceId);
    try {
      if (options.paths && options.paths.length > this.limits.files) limit();
      const state = await this.scan(directories, { signal: options.signal, additionalPaths: options.paths ? [...options.paths] : undefined });
      return { repository: state.repository, files: state.files, index: state.index, token: state.token };
    } finally { await directories.close(); }
  }
  async cleanupThread(workspaceId: string, threadId: string, options: { keepTurnIds?: ReadonlySet<string>; signal?: AbortSignal } = {}): Promise<{ removed: number }> {
    this.open();
    return withWorkspaceFileMutation(this.ctx.config.workspacesDir, workspaceId, () => this.store.cleanupThread(workspaceId, threadId, options.keepTurnIds), { signal: options.signal });
  }
  async cleanupWorkspace(workspaceId: string, options: GitCheckpointOptions = {}): Promise<{ removed: number }> {
    this.open();
    return withWorkspaceFileMutation(this.ctx.config.workspacesDir, workspaceId, () => this.store.cleanupWorkspace(workspaceId), { signal: options.signal });
  }
}

function pathsFromTree(bytes: Buffer): string[] {
  if (!bytes.length) return [];
  if (bytes.at(-1) !== 0) changed();
  return validText(bytes.subarray(0, -1)).split('\0').map(record => {
    const tab = record.indexOf('\t'), header = record.slice(0, tab);
    if (tab < 0 || !/^(?:100644|100755|120000) blob [a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(header)) {
      throw new HttpError(409, 'Submodules and unsupported Git tree entries cannot be captured exactly.', 'CHECKPOINT_UNSUPPORTED_FILE');
    }
    return relativePath(record.slice(tab + 1));
  });
}
