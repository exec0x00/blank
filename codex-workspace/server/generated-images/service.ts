import { createHash } from 'node:crypto';
import { constants, type Dirent, type Stats } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { AppContext } from '../context';
import type { AppConfig } from '../config';
import { HttpError } from '../errors';
import { inspectImageBytes, VIEW_IMAGE_LIMITS } from '../agent/image';
import type { ModelItem } from '../../shared/legacy-types';
import { drainImageAssetCleanups, imageAssetWorkspaceFenced, imageAssetWorkspaceHashFenced, registerImageAssetParticipant, withImageAssetCleanup, type ImageAssetCleanupOptions } from '../image-assets/coordination';
import type {
  CommitGeneratedImageInput, GeneratedImageMetadata, GeneratedImageMimeType,
  GeneratedImageModelOptions, GeneratedImageRead, GeneratedImageRecovery,
  GeneratedImageReadLeaseOptions, GeneratedImageReference, GeneratedImageServiceOptions, GeneratedImageWorkspaceCleanup,
} from './types';

export const GENERATED_IMAGE_LIMITS = Object.freeze({
  maxBytes: VIEW_IMAGE_LIMITS.maxBytes,
  maxDimension: VIEW_IMAGE_LIMITS.maxDimension,
  maxPixels: VIEW_IMAGE_LIMITS.maxPixels,
  maxPromptBytes: 32 * 1024,
  maxRecordBytes: 48 * 1024,
  maxConcurrentCommits: 4,
  maxPendingOperations: 64,
  maxArtifactsPerWorkspace: 2048,
  maxBytesPerWorkspace: 512 * 1024 * 1024,
  maxDirectoryEntries: 12_288,
});

const STORAGE_DIRECTORY = 'generated-images-v1';
const RECORD_KIND = 'codex-generated-image-v1';
const ID = /^img_[a-f0-9]{64}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const LOCAL_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/;
const ITEM_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,255}$/;
const IMAGE_FILE = /^(img_[a-f0-9]{64})\.image$/;
const RECORD_FILE = /^(img_[a-f0-9]{64})\.json$/;
const READY_FILE = /^(img_[a-f0-9]{64})\.ready$/;
const TEMP_FILE = /^(img_[a-f0-9]{64})\.[a-f0-9]{32}\.json\.tmp$/;
const FENCE_FILE = /^([a-f0-9]{64})\.deleted\.json$/;
const MIME_TYPES = new Set<GeneratedImageMimeType>(['image/png', 'image/jpeg', 'image/webp']);
const INPUT_KEYS = new Set(['workspaceId', 'threadId', 'messageId', 'runId', 'itemId', 'resultBase64', 'outputFormat', 'revisedPrompt']);
const RECORD_KEYS = new Set(['kind', 'id', 'sha256', 'workspaceId', 'threadId', 'messageId', 'runId', 'itemId', 'state', 'mimeType', 'bytes', 'width', 'height', 'createdAt', 'revisedPrompt']);
interface ImageRecord extends Omit<GeneratedImageMetadata, 'previewUrl'> { kind: typeof RECORD_KIND }
interface Directory { handle: FileHandle; location: string; stat: Stats }
interface OwnedOperation { controller: AbortController; done: Promise<void>; finish: () => void }
interface CleanupLeaf { name: string; stat: Stats; sha256: string; bytes: Buffer }
export type GeneratedImageCleanupConfig = Pick<AppConfig, 'dataDir'>;

const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const errno = (error: unknown, code: string) => (error as NodeJS.ErrnoException | undefined)?.code === code;
const sameInode = (before: Stats, after: Stats) => before.dev === after.dev && before.ino === after.ino;
const sameFile = (before: Stats, after: Stats) => sameInode(before, after) && before.size === after.size
  && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && before.nlink === after.nlink;
const missing = () => new HttpError(404, 'Generated image not found in this workspace.', 'GENERATED_IMAGE_NOT_FOUND');
const changed = () => new HttpError(409, 'The saved generated image changed or is incomplete. Its original bytes are unavailable.', 'GENERATED_IMAGE_CHANGED');
const unsafe = () => new HttpError(403, 'Generated image storage must remain in its original data directory.', 'UNSAFE_GENERATED_IMAGE_STORAGE');
const invalid = () => new HttpError(400, 'Choose a valid generated image and its owning workspace, thread and run.', 'INVALID_GENERATED_IMAGE_INPUT');
const deleted = () => new HttpError(410, 'Generated images for this permanently deleted workspace are unavailable.', 'GENERATED_IMAGE_WORKSPACE_DELETED');
const closing = () => new HttpError(503, 'The workspace is restarting. Try again shortly.', 'GENERATED_IMAGES_CLOSING');
const busy = () => new HttpError(429, 'Other generated images are being processed. Try again shortly.', 'GENERATED_IMAGES_BUSY');
const full = () => new HttpError(429, 'This workspace reached its generated image storage limit.', 'GENERATED_IMAGE_STORAGE_LIMIT');

function normalizeError(error: unknown): Error {
  if (error instanceof HttpError) return error;
  if (errno(error, 'ELOOP') || errno(error, 'ENOTDIR')) return unsafe();
  if (errno(error, 'ENOSPC') || errno(error, 'EDQUOT')) return new HttpError(507, 'There is not enough storage to save this generated image.', 'GENERATED_IMAGE_STORAGE_FULL');
  return new HttpError(503, 'Generated image storage is unavailable. Try again after storage recovers.', 'GENERATED_IMAGE_STORAGE_UNAVAILABLE');
}

function localId(value: unknown): value is string { return typeof value === 'string' && LOCAL_ID.test(value); }
function itemId(value: unknown): value is string { return typeof value === 'string' && ITEM_ID.test(value); }
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 30) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
function validPrompt(value: unknown): boolean {
  return value === undefined || typeof value === 'string' && Buffer.byteLength(value) <= GENERATED_IMAGE_LIMITS.maxPromptBytes && !/[\u0000]/.test(value);
}
function generationId(input: Pick<CommitGeneratedImageInput, 'workspaceId' | 'threadId' | 'runId' | 'itemId'>): string {
  return `img_${hash(JSON.stringify([input.workspaceId, input.threadId, input.runId, input.itemId]))}`;
}
function snapshotInput(input: CommitGeneratedImageInput): CommitGeneratedImageInput {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !INPUT_KEYS.has(key))
    || !localId(input.workspaceId) || !localId(input.threadId) || !localId(input.messageId) || !localId(input.runId) || !itemId(input.itemId)
    || typeof input.resultBase64 !== 'string' || !validPrompt(input.revisedPrompt)
    || input.outputFormat !== undefined && !['png', 'jpeg', 'webp'].includes(input.outputFormat)) throw invalid();
  return { workspaceId: input.workspaceId, threadId: input.threadId, messageId: input.messageId, runId: input.runId, itemId: input.itemId,
    resultBase64: input.resultBase64, ...(input.outputFormat === undefined ? {} : { outputFormat: input.outputFormat }),
    ...(input.revisedPrompt === undefined ? {} : { revisedPrompt: input.revisedPrompt }) };
}
function decodeImage(encoded: string): Buffer {
  if (encoded.length > Math.ceil(GENERATED_IMAGE_LIMITS.maxBytes / 3) * 4) {
    throw new HttpError(413, 'Generated images must be 8 MiB or smaller.', 'GENERATED_IMAGE_TOO_LARGE');
  }
  if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new HttpError(415, 'The image service returned invalid base64 image data.', 'INVALID_GENERATED_IMAGE_DATA');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > GENERATED_IMAGE_LIMITS.maxBytes) throw new HttpError(413, 'Generated images must be 8 MiB or smaller.', 'GENERATED_IMAGE_TOO_LARGE');
  if (!bytes.length || bytes.toString('base64') !== encoded) {
    throw new HttpError(415, 'The image service returned noncanonical base64 image data.', 'INVALID_GENERATED_IMAGE_DATA');
  }
  return bytes;
}

function publicMetadata(record: ImageRecord): GeneratedImageMetadata {
  // Project every field. Never spread a disk/provider record into client data.
  return { id: record.id, sha256: record.sha256, workspaceId: record.workspaceId, threadId: record.threadId,
    messageId: record.messageId, runId: record.runId, itemId: record.itemId, state: 'completed', mimeType: record.mimeType,
    bytes: record.bytes, width: record.width, height: record.height, createdAt: record.createdAt,
    previewUrl: `/api/workspaces/${encodeURIComponent(record.workspaceId)}/generated-images/${record.id}/content?sha256=${record.sha256}`,
    ...(record.revisedPrompt === undefined ? {} : { revisedPrompt: record.revisedPrompt }) };
}

/** Immutable local artifacts. It makes no provider requests or filesystem mounts. */
export class GeneratedImageService {
  private readonly ctx?: AppContext;
  private readonly config: GeneratedImageCleanupConfig;
  private readonly now: () => number;
  private root?: Directory;
  private ready?: Promise<void>;
  private closed?: Promise<void>;
  private closing = false;
  private readonly stop = new AbortController();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly workspaceCommits = new Map<string, Set<AbortController>>();
  private readonly operations = new Map<string, Set<OwnedOperation>>();
  private readonly deletedWorkspaces = new Set<string>();
  private pendingOperations = 0;
  private activeCommits = 0;
  private readonly idleWaiters = new Set<() => void>();
  private readonly unregister: () => void;
  private readonly recovered: GeneratedImageRecovery = { removedTemporaryFiles: 0, removedUncommittedImages: 0,
    removedUncommittedRecords: 0, removedDeletedWorkspaceFiles: 0, retainedUnexpectedEntries: 0 };

  constructor(source: AppContext | GeneratedImageCleanupConfig, options: GeneratedImageServiceOptions = {}) {
    if ('config' in source) { this.ctx = source; this.config = source.config; }
    else this.config = source;
    this.now = options.now ?? Date.now;
    this.unregister = this.ctx ? registerImageAssetParticipant({ storageRoot: () => this.storageRoot(), fence: id => this.fenceOwnedOperations(id) }) : () => undefined;
  }

  initialize(): Promise<void> {
    if (this.closing) return Promise.reject(closing());
    this.ready ??= (async () => {
      try { this.root = await this.openRoot(); if (this.ctx) await this.recover(); }
      catch (error) { await this.root?.handle.close().catch(() => undefined); this.root = undefined; throw normalizeError(error); }
    })();
    return this.ready;
  }

  recovery(): GeneratedImageRecovery { return { ...this.recovered }; }

  close(): Promise<void> {
    this.closed ??= (async () => {
      this.closing = true; this.stop.abort(closing());
      await this.ready?.catch(() => undefined);
      if (this.pendingOperations || this.activeCommits) await new Promise<void>(resolve => this.idleWaiters.add(resolve));
      await Promise.all([...this.queues.values()].map(pending => pending.catch(() => undefined)));
      if (this.ctx && this.root) await drainImageAssetCleanups(this.root.location);
      try { await this.root?.handle.close(); this.root = undefined; }
      finally { this.unregister(); }
    })();
    return this.closed;
  }

  private check(signal?: AbortSignal, workspaceHash?: string): void {
    signal?.throwIfAborted();
    if (this.closing) throw closing();
    if (workspaceHash && this.deletedWorkspaces.has(workspaceHash)) throw deleted();
  }

  private workspaceContext(): AppContext {
    if (!this.ctx) throw new HttpError(503, 'Generated image cleanup has no active workspace context.', 'GENERATED_IMAGE_CONTEXT_UNAVAILABLE');
    return this.ctx;
  }

  private async storageRoot(): Promise<string> {
    return this.root?.location ?? path.join(await fs.realpath(path.resolve(this.config.dataDir)), STORAGE_DIRECTORY);
  }

  private fenceOwnedOperations(workspaceId: string): Promise<void> {
    const key = hash(workspaceId);
    this.deletedWorkspaces.add(key);
    for (const controller of this.workspaceCommits.get(key) ?? []) controller.abort(deleted());
    const owned = [...(this.operations.get(key) ?? [])];
    for (const operation of owned) operation.controller.abort(deleted());
    const queued = this.queues.get(key);
    return Promise.all([...owned.map(operation => operation.done), ...(queued ? [queued.catch(() => undefined)] : []),
      ...(this.ready ? [this.ready.catch(() => undefined)] : [])]).then(() => undefined);
  }

  private notifyIdle(): void {
    if (this.pendingOperations || this.activeCommits) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }

  private entry(directory: Directory, name: string): string {
    // Descriptor-relative operations keep a replaced parent from redirecting IO.
    return path.join(process.platform === 'linux' ? `/proc/self/fd/${directory.handle.fd}` : directory.location, name);
  }

  private async assertDirectory(directory: Directory): Promise<void> {
    try {
      const live = await fs.lstat(directory.location);
      if (!live.isDirectory() || live.isSymbolicLink() || !sameInode(directory.stat, live)) throw unsafe();
      if (await fs.realpath(directory.location) !== directory.location) throw unsafe();
      if (process.platform === 'linux' && await fs.realpath(`/proc/self/fd/${directory.handle.fd}`) !== directory.location) throw unsafe();
    } catch { throw unsafe(); }
  }

  private async child(parent: Directory, name: string, create: boolean): Promise<Directory> {
    if (name !== STORAGE_DIRECTORY && !DIGEST.test(name)) throw unsafe();
    await this.assertDirectory(parent);
    let handle: FileHandle | undefined;
    try {
      if (create) await fs.mkdir(this.entry(parent, name), { mode: 0o700 }).catch(error => { if (!errno(error, 'EEXIST')) throw error; });
      handle = await fs.open(this.entry(parent, name), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      const directory = { handle, location: path.join(parent.location, name), stat: await handle.stat() };
      await this.assertDirectory(parent); await this.assertDirectory(directory);
      return directory;
    } catch (error) { await handle?.close().catch(() => undefined); throw error; }
  }

  private async openRoot(): Promise<Directory> {
    const canonical = await fs.realpath(path.resolve(this.config.dataDir));
    const handle = await fs.open(canonical, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const parent = { handle, location: canonical, stat: await handle.stat() };
    try { return await this.child(parent, STORAGE_DIRECTORY, true); }
    finally { await handle.close(); }
  }

  private enqueue<T>(workspaceHash: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.queues.get(workspaceHash) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(operation);
    this.queues.set(workspaceHash, next);
    void next.finally(() => { if (this.queues.get(workspaceHash) === next) this.queues.delete(workspaceHash); }).catch(() => undefined);
    return next;
  }

  private async exists(directory: Directory, name: string): Promise<boolean> {
    await this.assertDirectory(directory);
    try { await fs.lstat(this.entry(directory, name)); return true; }
    catch (error) { if (errno(error, 'ENOENT')) return false; throw error; }
  }

  private async assertWorkspaceOpen(workspaceHash: string, signal?: AbortSignal, workspaceId?: string): Promise<void> {
    this.check(signal, workspaceHash);
    if (workspaceId && imageAssetWorkspaceFenced(this.root!.location, workspaceId)) {
      this.deletedWorkspaces.add(workspaceHash); throw deleted();
    }
    // Even a partial/corrupt marker is a durable deletion intent. Never follow it
    // or treat malformed JSON as permission to recreate a deleted workspace.
    if (await this.exists(this.root!, `${workspaceHash}.deleted.json`)) {
      this.deletedWorkspaces.add(workspaceHash); throw deleted();
    }
    this.check(signal, workspaceHash);
  }

  private async inWorkspace<T>(workspaceId: string, create: boolean, signal: AbortSignal | undefined, operation: (directory: Directory, workspaceHash: string, signal: AbortSignal) => Promise<T>): Promise<T> {
    if (!localId(workspaceId)) throw invalid();
    const workspaceHash = hash(workspaceId);
    this.check(signal, workspaceHash);
    if (this.pendingOperations >= GENERATED_IMAGE_LIMITS.maxPendingOperations) throw busy();
    this.pendingOperations++;
    let finish!: () => void;
    const owned: OwnedOperation = { controller: new AbortController(), done: new Promise<void>(resolve => { finish = resolve; }), finish: () => finish() };
    const active = this.operations.get(workspaceHash) ?? new Set<OwnedOperation>();
    active.add(owned); this.operations.set(workspaceHash, active);
    const combined = AbortSignal.any([this.stop.signal, owned.controller.signal, ...(signal ? [signal] : [])]);
    try {
      await this.initialize();
      await this.assertWorkspaceOpen(workspaceHash, combined, workspaceId);
      await this.workspaceContext().workspaces.get(workspaceId);
      return await this.enqueue(workspaceHash, async () => {
        await this.assertWorkspaceOpen(workspaceHash, combined, workspaceId);
        await this.workspaceContext().workspaces.get(workspaceId);
        this.check(combined, workspaceHash);
        let directory: Directory | undefined;
        try {
          directory = await this.child(this.root!, workspaceHash, create);
          return await operation(directory, workspaceHash, combined);
        } catch (error) { if (errno(error, 'ENOENT')) throw missing(); throw error; }
        finally { await directory?.handle.close(); }
      });
    } catch (error) { if (combined.aborted) throw combined.reason; throw normalizeError(error); }
    finally {
      active.delete(owned); if (!active.size) this.operations.delete(workspaceHash); owned.finish();
      this.pendingOperations--; this.notifyIdle();
    }
  }

  private async entries(directory: Directory): Promise<Dirent[]> {
    await this.assertDirectory(directory);
    const result: Dirent[] = [];
    for await (const entry of await fs.opendir(this.entry(directory, '.'))) {
      if (result.length >= GENERATED_IMAGE_LIMITS.maxDirectoryEntries) throw full();
      result.push(entry);
    }
    await this.assertDirectory(directory);
    return result;
  }

  private async readBounded(directory: Directory, name: string, maximum: number, signal?: AbortSignal, allowEmpty = false): Promise<Buffer> {
    let handle: FileHandle | undefined;
    try {
      this.check(signal); await this.assertDirectory(directory);
      handle = await fs.open(this.entry(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const before = await handle.stat();
      if (!before.isFile() || before.nlink !== 1 || before.size < (allowEmpty ? 0 : 1) || before.size > maximum) throw changed();
      if (process.platform === 'linux' && await fs.realpath(`/proc/self/fd/${handle.fd}`) !== path.join(directory.location, name)) throw unsafe();
      const bytes = Buffer.alloc(before.size + 1); let length = 0;
      while (length < bytes.length) {
        this.check(signal);
        const read = await handle.read(bytes, length, Math.min(64 * 1024, bytes.length - length), length);
        this.check(signal);
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      const after = await handle.stat();
      const named = await fs.lstat(this.entry(directory, name));
      if (length !== before.size || !sameFile(before, after) || !sameFile(after, named) || !named.isFile() || named.isSymbolicLink()) throw changed();
      await this.assertDirectory(directory); this.check(signal);
      return bytes.subarray(0, length);
    } catch (error) { if (errno(error, 'ENOENT')) throw missing(); throw error; }
    finally { await handle?.close(); }
  }

  private async assertCommitted(directory: Directory, id: string, signal?: AbortSignal): Promise<void> {
    let handle: FileHandle | undefined;
    try {
      this.check(signal); await this.assertDirectory(directory);
      const name = `${id}.ready`;
      handle = await fs.open(this.entry(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const opened = await handle.stat(), named = await fs.lstat(this.entry(directory, name));
      if (!opened.isFile() || opened.size !== 0 || opened.nlink !== 1 || !sameFile(opened, named) || named.isSymbolicLink()) throw changed();
      if (process.platform === 'linux' && await fs.realpath(`/proc/self/fd/${handle.fd}`) !== path.join(directory.location, name)) throw unsafe();
      await this.assertDirectory(directory); this.check(signal);
    } catch (error) { if (errno(error, 'ENOENT')) throw missing(); throw error; }
    finally { await handle?.close(); }
  }

  private async record(directory: Directory, id: string, workspaceId: string, signal?: AbortSignal): Promise<ImageRecord> {
    await this.assertCommitted(directory, id, signal);
    const raw = await this.readBounded(directory, `${id}.json`, GENERATED_IMAGE_LIMITS.maxRecordBytes, signal);
    return this.parseRecord(directory, id, workspaceId, raw);
  }

  private parseRecord(directory: Directory, id: string, workspaceId: string, raw: Buffer): ImageRecord {
    let value: ImageRecord;
    try { value = JSON.parse(raw.toString('utf8')) as ImageRecord; } catch { throw changed(); }
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !RECORD_KEYS.has(key))
      || value.kind !== RECORD_KIND || value.state !== 'completed' || value.id !== id || !DIGEST.test(value.sha256)
      || !localId(value.workspaceId) || value.workspaceId !== workspaceId || hash(value.workspaceId) !== path.basename(directory.location)
      || !localId(value.threadId) || !localId(value.messageId) || !localId(value.runId) || !itemId(value.itemId) || generationId(value) !== id
      || !MIME_TYPES.has(value.mimeType) || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > GENERATED_IMAGE_LIMITS.maxBytes
      || !Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height) || value.width < 1 || value.height < 1
      || value.width > GENERATED_IMAGE_LIMITS.maxDimension || value.height > GENERATED_IMAGE_LIMITS.maxDimension
      || value.width * value.height > GENERATED_IMAGE_LIMITS.maxPixels || !validDate(value.createdAt) || !validPrompt(value.revisedPrompt)) throw changed();
    return value;
  }

  private async verifiedBytes(directory: Directory, record: ImageRecord, signal?: AbortSignal): Promise<Buffer> {
    const bytes = await this.readBounded(directory, `${record.id}.image`, GENERATED_IMAGE_LIMITS.maxBytes, signal);
    if (bytes.length !== record.bytes || hash(bytes) !== record.sha256) throw changed();
    try {
      const header = inspectImageBytes(bytes);
      if (header.mimeType !== record.mimeType || header.width !== record.width || header.height !== record.height) throw changed();
    } catch { throw changed(); }
    this.check(signal);
    return bytes;
  }

  private async unlinkOwned(directory: Directory, name: string, created: Stats): Promise<void> {
    // Rollbacks remove only the inode this operation created, never a raced-in
    // replacement. Fail closed if the directory moved; no path-based fallback.
    try {
      await this.assertDirectory(directory);
      const current = await fs.lstat(this.entry(directory, name));
      if (sameInode(created, current) && current.isFile() && !current.isSymbolicLink()) await fs.unlink(this.entry(directory, name));
    } catch (error) { if (!errno(error, 'ENOENT')) throw error; }
  }

  private async writeNew(directory: Directory, name: string, bytes: Buffer, signal?: AbortSignal): Promise<Stats> {
    let handle: FileHandle | undefined, created: Stats | undefined;
    try {
      this.check(signal); await this.assertDirectory(directory);
      handle = await fs.open(this.entry(directory, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      created = await handle.stat();
      if (!created.isFile() || created.nlink !== 1) throw unsafe();
      let written = 0;
      while (written < bytes.length) {
        this.check(signal);
        const result = await handle.write(bytes, written, Math.min(64 * 1024, bytes.length - written), written);
        if (!result.bytesWritten) throw changed();
        written += result.bytesWritten;
      }
      await handle.sync(); this.check(signal);
      const finished = await handle.stat();
      const named = await fs.lstat(this.entry(directory, name));
      if (!sameInode(created, finished) || finished.size !== bytes.length || finished.nlink !== 1
        || !sameFile(finished, named) || !named.isFile() || named.isSymbolicLink()) throw changed();
      await this.assertDirectory(directory); this.check(signal);
      return finished;
    } catch (error) {
      if (created) await this.unlinkOwned(directory, name, created).catch(() => undefined);
      throw error;
    } finally { await handle?.close(); }
  }

  private async assertQuota(directory: Directory, incomingBytes: number): Promise<void> {
    let count = 0, bytes = incomingBytes;
    for (const entry of await this.entries(directory)) {
      if (!IMAGE_FILE.test(entry.name)) continue;
      const stat = await fs.lstat(this.entry(directory, entry.name));
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw unsafe();
      count++; bytes += stat.size;
      if (count >= GENERATED_IMAGE_LIMITS.maxArtifactsPerWorkspace || bytes > GENERATED_IMAGE_LIMITS.maxBytesPerWorkspace) throw full();
    }
  }

  async commit(source: CommitGeneratedImageInput, signal?: AbortSignal): Promise<GeneratedImageMetadata> {
    this.check(signal);
    const input = snapshotInput(source), workspaceHash = hash(input.workspaceId);
    this.check(signal, workspaceHash);
    if (this.activeCommits >= GENERATED_IMAGE_LIMITS.maxConcurrentCommits) throw busy();
    this.activeCommits++;
    const controller = new AbortController();
    const controllers = this.workspaceCommits.get(workspaceHash) ?? new Set<AbortController>();
    controllers.add(controller); this.workspaceCommits.set(workspaceHash, controllers);
    const combined = AbortSignal.any([this.stop.signal, controller.signal, ...(signal ? [signal] : [])]);
    try {
      // Strings are immutable and snapshotted before any await. No caller-owned
      // Buffer or provider object can change the artifact during admission.
      const bytes = decodeImage(input.resultBase64), header = inspectImageBytes(bytes);
      if (!MIME_TYPES.has(header.mimeType as GeneratedImageMimeType)) throw new HttpError(415, 'Generated images must be PNG, JPEG or WebP.', 'INVALID_GENERATED_IMAGE_FORMAT');
      if (input.outputFormat && header.mimeType !== `image/${input.outputFormat}`) throw new HttpError(415, 'The generated image format does not match its actual bytes.', 'INVALID_GENERATED_IMAGE_FORMAT');
      const id = generationId(input), sha256 = hash(bytes);
      return await this.inWorkspace(input.workspaceId, true, combined, async (directory, key) => {
        if (await this.exists(directory, `${id}.ready`)) {
          const existing = await this.record(directory, id, input.workspaceId, combined);
          if (existing.sha256 !== sha256 || existing.messageId !== input.messageId) {
            throw new HttpError(409, 'This image-generation call already saved a different result.', 'GENERATED_IMAGE_CONFLICT');
          }
          await this.verifiedBytes(directory, existing, combined);
          await this.assertWorkspaceOpen(key, combined);
          return publicMetadata(existing);
        }
        await this.assertQuota(directory, bytes.length);
        const record: ImageRecord = { kind: RECORD_KIND, id, sha256, workspaceId: input.workspaceId, threadId: input.threadId,
          messageId: input.messageId, runId: input.runId, itemId: input.itemId, state: 'completed', mimeType: header.mimeType as GeneratedImageMimeType,
          bytes: bytes.length, width: header.width, height: header.height, createdAt: new Date(this.now()).toISOString(),
          ...(input.revisedPrompt === undefined ? {} : { revisedPrompt: input.revisedPrompt }) };
        const serialized = Buffer.from(JSON.stringify(record));
        if (serialized.length > GENERATED_IMAGE_LIMITS.maxRecordBytes) throw invalid();
        let imageStat: Stats | undefined, recordStat: Stats | undefined, markerStat: Stats | undefined, committed = false;
        try {
          await this.assertWorkspaceOpen(key, combined);
          // Write ownership metadata before bytes so an interrupted admission
          // retains enough evidence for exact permanent-workspace cleanup.
          recordStat = await this.writeNew(directory, `${id}.json`, serialized, combined);
          imageStat = await this.writeNew(directory, `${id}.image`, bytes, combined);
          await this.verifiedBytes(directory, record, combined);
          await this.workspaceContext().workspaces.get(input.workspaceId);
          await this.assertWorkspaceOpen(key, combined); await this.assertDirectory(directory);
          // The create-only empty marker publishes already synced bytes and
          // metadata. Workspace readers are serialized behind this commit.
          // This requires neither overwrite-prone rename nor hard-link support
          // from the platform's native bucket filesystem.
          markerStat = await this.writeNew(directory, `${id}.ready`, Buffer.alloc(0), combined);
          await this.assertWorkspaceOpen(key, combined);
          const verified = await this.record(directory, id, input.workspaceId, combined);
          if (verified.sha256 !== sha256 || verified.messageId !== input.messageId) throw changed();
          await this.verifiedBytes(directory, verified, combined);
          await this.assertWorkspaceOpen(key, combined);
          this.check(combined, key);
          committed = true;
          return publicMetadata(verified);
        } catch (error) {
          if (errno(error, 'EEXIST')) throw new HttpError(409, 'The generated image destination already exists. Its contents were preserved.', 'GENERATED_IMAGE_CONFLICT');
          throw error;
        } finally {
          if (!committed) {
            if (markerStat) await this.unlinkOwned(directory, `${id}.ready`, markerStat).catch(() => undefined);
            if (imageStat) await this.unlinkOwned(directory, `${id}.image`, imageStat).catch(() => undefined);
            // A failed write can leave bytes before imageStat was returned;
            // failed rollback must never strand them without their ownership.
            let payloadsAbsent = false;
            try { payloadsAbsent = !await this.exists(directory, `${id}.image`) && !await this.exists(directory, `${id}.ready`); }
            catch { /* Preserve ownership metadata when absence cannot be proved. */ }
            if (payloadsAbsent && recordStat) await this.unlinkOwned(directory, `${id}.json`, recordStat).catch(() => undefined);
          }
        }
      });
    } catch (error) { if (combined.aborted) throw combined.reason; throw normalizeError(error); }
    finally {
      this.activeCommits--; controllers.delete(controller);
      if (!controllers.size) this.workspaceCommits.delete(workspaceHash);
      this.notifyIdle();
    }
  }

  async read(workspaceId: string, id: string, expectedSha256?: string, signal?: AbortSignal): Promise<GeneratedImageRead> {
    if (typeof id !== 'string' || !ID.test(id)) throw missing();
    if (expectedSha256 !== undefined && (typeof expectedSha256 !== 'string' || !DIGEST.test(expectedSha256))) throw invalid();
    return this.inWorkspace(workspaceId, false, signal, async (directory, key, ownedSignal) => {
      const record = await this.record(directory, id, workspaceId, ownedSignal);
      if (expectedSha256 !== undefined && record.sha256 !== expectedSha256) throw changed();
      const bytes = await this.verifiedBytes(directory, record, ownedSignal);
      await this.assertWorkspaceOpen(key, ownedSignal, workspaceId);
      return { metadata: publicMetadata(record), bytes };
    });
  }

  async metadata(workspaceId: string, id: string, expectedSha256?: string): Promise<GeneratedImageMetadata> {
    return (await this.read(workspaceId, id, expectedSha256)).metadata;
  }

  /** Hold cancellation/drain ownership until a copy or independent snapshot is
   * verified. The immutable Buffer is used outside the serialized storage queue. */
  async withRead<T>(workspaceId: string, reference: GeneratedImageReference,
    work: (image: GeneratedImageRead, signal: AbortSignal) => Promise<T>, options: GeneratedImageReadLeaseOptions = {}): Promise<T> {
    if (!localId(workspaceId) || !reference || typeof reference !== 'object' || Array.isArray(reference) || typeof reference.id !== 'string' || !ID.test(reference.id)
      || typeof reference.sha256 !== 'string' || !DIGEST.test(reference.sha256) || typeof work !== 'function'
      || !options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['threadId', 'signal'].includes(key))
      || options.threadId !== undefined && !localId(options.threadId)) throw invalid();
    const { id, sha256 } = reference, { threadId, signal } = options, key = hash(workspaceId);
    this.check(signal, key);
    if (this.pendingOperations >= GENERATED_IMAGE_LIMITS.maxPendingOperations) throw busy();
    this.pendingOperations++;
    let finish!: () => void;
    const owned: OwnedOperation = { controller: new AbortController(), done: new Promise<void>(resolve => { finish = resolve; }), finish: () => finish() };
    const active = this.operations.get(key) ?? new Set<OwnedOperation>(); active.add(owned); this.operations.set(key, active);
    const combined = AbortSignal.any([this.stop.signal, owned.controller.signal, ...(signal ? [signal] : [])]);
    try {
      const image = await this.read(workspaceId, id, sha256, combined);
      if (threadId !== undefined && image.metadata.threadId !== threadId) throw missing();
      this.check(combined, key);
      const result = await work(image, combined);
      await this.assertWorkspaceOpen(key, combined, workspaceId);
      return result;
    } catch (error) { if (combined.aborted) throw combined.reason; throw error; }
    finally {
      active.delete(owned); if (!active.size) this.operations.delete(key); owned.finish();
      this.pendingOperations--; this.notifyIdle();
    }
  }

  async modelContent(workspaceId: string, reference: GeneratedImageReference, options: GeneratedImageModelOptions = {}): Promise<ModelItem> {
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)
      || typeof reference.id !== 'string' || !ID.test(reference.id) || typeof reference.sha256 !== 'string' || !DIGEST.test(reference.sha256)
      || !options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['threadId', 'detail', 'signal'].includes(key))
      || options.threadId !== undefined && !localId(options.threadId) || options.detail !== undefined && !['high', 'original'].includes(options.detail)) throw invalid();
    const { id, sha256 } = reference, { threadId, detail, signal } = options;
    const result = await this.read(workspaceId, id, sha256, signal);
    if (threadId !== undefined && result.metadata.threadId !== threadId) throw missing();
    this.check(signal, hash(workspaceId));
    return { type: 'input_image', image_url: `data:${result.metadata.mimeType};base64,${result.bytes.toString('base64')}`, detail: detail ?? 'high' };
  }

  private async fenceWorkspace(workspaceId: string, workspaceHash: string): Promise<void> {
    await this.assertDirectory(this.root!);
    let handle: FileHandle | undefined;
    try {
      handle = await fs.open(this.entry(this.root!, `${workspaceHash}.deleted.json`), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      // An empty create-only marker cannot acquire a torn JSON body. The
      // lifecycle callback, not marker contents, authorizes exact leaf removal.
      await handle.sync(); await this.assertDirectory(this.root!);
    } catch (error) {
      if (!errno(error, 'EEXIST')) throw error;
      // Existing markers, including interrupted writes, are permanent fences.
      if (!await this.exists(this.root!, `${workspaceHash}.deleted.json`)) throw changed();
      const stat = await fs.lstat(this.entry(this.root!, `${workspaceHash}.deleted.json`));
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4096) throw changed();
      handle = await fs.open(this.entry(this.root!, `${workspaceHash}.deleted.json`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const opened = await handle.stat();
      if (!sameFile(stat, opened) || !opened.isFile() || opened.nlink !== 1) throw changed();
      await handle.sync(); await this.assertDirectory(this.root!);
      const current = await fs.lstat(this.entry(this.root!, `${workspaceHash}.deleted.json`));
      if (!sameFile(opened, current) || current.isSymbolicLink()) throw changed();
    } finally { await handle?.close(); }
    // Never roll back or unlink a fence, even if cleanup or storage fails later.
  }

  private async cleanupLeaf(directory: Directory, name: string, maximum: number, allowEmpty = false): Promise<CleanupLeaf> {
    await this.assertDirectory(directory);
    const before = await fs.lstat(this.entry(directory, name));
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw changed();
    const bytes = await this.readBounded(directory, name, maximum, undefined, allowEmpty);
    const after = await fs.lstat(this.entry(directory, name));
    if (!sameFile(before, after)) throw changed();
    return { name, stat: after, sha256: hash(bytes), bytes };
  }

  private async purgeVerifiedDirectory(directory: Directory, workspaceId: string, options: ImageAssetCleanupOptions): Promise<number> {
    const groups = new Map<string, Set<string>>();
    for (const entry of await this.entries(directory)) {
      const id = IMAGE_FILE.exec(entry.name)?.[1] ?? RECORD_FILE.exec(entry.name)?.[1] ?? READY_FILE.exec(entry.name)?.[1] ?? TEMP_FILE.exec(entry.name)?.[1];
      if (!id || !entry.isFile() || entry.isSymbolicLink()) throw changed();
      const names = groups.get(id) ?? new Set<string>(); names.add(entry.name); groups.set(id, names);
    }
    const plan: Array<Omit<CleanupLeaf, 'bytes'>> = [];
    for (const [id, names] of groups) {
      if (!names.has(`${id}.json`)) throw changed();
      const metadata = await this.cleanupLeaf(directory, `${id}.json`, GENERATED_IMAGE_LIMITS.maxRecordBytes);
      const record = this.parseRecord(directory, id, workspaceId, metadata.bytes);
      const leaves: CleanupLeaf[] = [];
      for (const name of names) {
        if (name === `${id}.json`) continue;
        if (TEMP_FILE.test(name)) {
          const temporary = await this.cleanupLeaf(directory, name, GENERATED_IMAGE_LIMITS.maxRecordBytes);
          const prior = this.parseRecord(directory, id, workspaceId, temporary.bytes);
          if (JSON.stringify(prior) !== JSON.stringify(record)) throw changed();
          leaves.unshift(temporary);
        } else if (READY_FILE.test(name)) {
          const ready = await this.cleanupLeaf(directory, name, 1, true);
          if (ready.bytes.length) throw changed();
          leaves.unshift(ready);
        } else {
          const image = await this.cleanupLeaf(directory, name, GENERATED_IMAGE_LIMITS.maxBytes, !names.has(`${id}.ready`));
          if (image.bytes.length > record.bytes || (names.has(`${id}.ready`) || image.bytes.length === record.bytes)
            && (image.bytes.length !== record.bytes || image.sha256 !== record.sha256)) throw changed();
          leaves.push(image);
        }
      }
      // Keep ownership metadata until all associated byte/marker leaves are gone.
      leaves.push(metadata); plan.push(...leaves.map(({ bytes: _bytes, ...leaf }) => leaf));
    }
    let removed = 0;
    for (const expected of plan) {
      await options.assertCurrent?.();
      const maximum = READY_FILE.test(expected.name) ? 1 : IMAGE_FILE.test(expected.name) ? GENERATED_IMAGE_LIMITS.maxBytes : GENERATED_IMAGE_LIMITS.maxRecordBytes;
      const actual = await this.cleanupLeaf(directory, expected.name, maximum, READY_FILE.test(expected.name) || IMAGE_FILE.test(expected.name));
      if (!sameFile(expected.stat, actual.stat) || expected.sha256 !== actual.sha256) throw changed();
      await this.assertDirectory(directory);
      const named = await fs.lstat(this.entry(directory, expected.name));
      if (!sameFile(actual.stat, named) || !named.isFile() || named.isSymbolicLink() || named.nlink !== 1) throw changed();
      await fs.unlink(this.entry(directory, expected.name)); removed++;
    }
    if ((await this.entries(directory)).length) throw changed();
    return removed;
  }

  private async cleanUncommittedDirectory(directory: Directory): Promise<{ deleted: number; retained: number }> {
    let removed = 0, retained = 0;
    const entries = await this.entries(directory);
    const names = new Set(entries.map(entry => entry.name));
    for (const entry of entries) {
      const workspaceHash = path.basename(directory.location);
      if (this.deletedWorkspaces.has(workspaceHash) || imageAssetWorkspaceHashFenced(this.root!.location, workspaceHash)
        || await this.exists(this.root!, `${workspaceHash}.deleted.json`)) return { deleted: removed, retained };
      const image = IMAGE_FILE.exec(entry.name), record = RECORD_FILE.exec(entry.name), ready = READY_FILE.test(entry.name);
      const id = image?.[1] ?? record?.[1];
      const owned = TEMP_FILE.test(entry.name) || id !== undefined && !names.has(`${id}.ready`);
      if (!owned) { if (!image && !record && !ready) retained++; continue; }
      await this.assertDirectory(directory);
      const live = await fs.lstat(this.entry(directory, entry.name)).catch(error => { if (errno(error, 'ENOENT')) return undefined; throw error; });
      if (!live) continue;
      // unlink removes an owned symlink itself and never follows its target.
      // Unexpected directories are preserved; no recursive removal is used.
      if (!live.isFile() && !live.isSymbolicLink()) { retained++; continue; }
      if (this.deletedWorkspaces.has(workspaceHash) || imageAssetWorkspaceHashFenced(this.root!.location, workspaceHash)
        || await this.exists(this.root!, `${workspaceHash}.deleted.json`)) return { deleted: removed, retained };
      await fs.unlink(this.entry(directory, entry.name)); removed++;
      if (TEMP_FILE.test(entry.name)) this.recovered.removedTemporaryFiles++;
      else if (image) this.recovered.removedUncommittedImages++;
      else if (record) this.recovered.removedUncommittedRecords++;
    }
    await this.assertDirectory(directory);
    return { deleted: removed, retained };
  }

  private async recover(): Promise<void> {
    await this.assertDirectory(this.root!);
    // Historical deletion markers must not impose a lifetime workspace-count
    // ceiling. Stream root entries, and read each workspace's current fence.
    for await (const entry of await fs.opendir(this.entry(this.root!, '.'))) {
      if (FENCE_FILE.test(entry.name)) continue;
      if (!DIGEST.test(entry.name)) continue;
      if (!entry.isDirectory() || entry.isSymbolicLink()) { this.recovered.retainedUnexpectedEntries++; continue; }
      let directory: Directory | undefined;
      try {
        directory = await this.child(this.root!, entry.name, false);
        // A durable fence blocks access immediately. Permanent cleanup is
        // replayed through the authoritative workspace lifecycle callback; a
        // normal startup never turns a marker/prefix into deletion authority.
        if (this.deletedWorkspaces.has(entry.name) || imageAssetWorkspaceHashFenced(this.root!.location, entry.name)
          || await this.exists(this.root!, `${entry.name}.deleted.json`)) continue;
        const result = await this.cleanUncommittedDirectory(directory);
        this.recovered.retainedUnexpectedEntries += result.retained;
      } catch (error) { if (error instanceof HttpError || !errno(error, 'ENOENT')) throw error; }
      finally { await directory?.handle.close(); }
    }
  }

  /** Internal permanent-workspace cleanup hook; never call for archive or trash. */
  deleteWorkspace(workspaceId: string, options: ImageAssetCleanupOptions = {}): Promise<GeneratedImageWorkspaceCleanup> {
    return GeneratedImageService.cleanupWorkspace(this.ctx ?? this.config, workspaceId, options);
  }

  static async cleanupWorkspace(source: AppContext | GeneratedImageCleanupConfig, workspaceId: string, options: ImageAssetCleanupOptions = {}): Promise<GeneratedImageWorkspaceCleanup> {
    if (!localId(workspaceId)) throw invalid();
    const cleanup = new GeneratedImageService('config' in source ? source.config : source);
    try {
      const location = await cleanup.storageRoot();
      return await withImageAssetCleanup(location, workspaceId, options, async drain => {
        await cleanup.initialize(); await options.assertCurrent?.();
        await cleanup.fenceWorkspace(workspaceId, hash(workspaceId));
        await drain(); await options.assertCurrent?.();
        let directory: Directory | undefined;
        try {
          try { directory = await cleanup.child(cleanup.root!, hash(workspaceId), false); }
          catch (error) {
            if (errno(error, 'ENOENT')) return { workspaceId, deletedFiles: 0, permanentlyFenced: true as const };
            throw error;
          }
          const deletedFiles = await cleanup.purgeVerifiedDirectory(directory, workspaceId, options);
          await options.assertCurrent?.();
          return { workspaceId, deletedFiles, permanentlyFenced: true as const };
        } catch (error) {
          if (error instanceof HttpError && error.code === 'WORKSPACE_ARTIFACT_CLEANUP_CHANGED') throw error;
          throw new HttpError(409, 'Generated image cleanup could not verify every remaining owned file. Unverified data was preserved for retry.', 'GENERATED_IMAGE_CLEANUP_INCOMPLETE');
        } finally { await directory?.handle.close(); }
      });
    } catch (error) { throw normalizeError(error); }
    finally { await cleanup.close(); }
  }
}
