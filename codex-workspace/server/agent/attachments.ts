import { createHash, randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { Router, raw } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import type { AppConfig } from '../config';
import { HttpError } from '../errors';
import { inspectImageBytes, viewWorkspaceImage, VIEW_IMAGE_LIMITS, type ViewImageDetail, type ImageHeader } from './image';
import type { ModelItem } from '../../shared/legacy-types';
import { drainImageAssetCleanups, imageAssetWorkspaceFenced, imageAssetWorkspaceHashFenced, registerImageAssetParticipant, withImageAssetCleanup, type ImageAssetCleanupOptions } from '../image-assets/coordination';
import { imageUploadAttachmentId, parseImageUploadPromotion, readImageUpload, validImageUploadOrigin, type ImageUploadOrigin, type ImageUploadPromotionInput } from './image-upload-promotion';

/** Raw image bytes have a separate bound from the provider's base64 wire size. */
export const IMAGE_ATTACHMENT_LIMITS = Object.freeze({
  maxBytes: VIEW_IMAGE_LIMITS.maxBytes,
  maxDimension: VIEW_IMAGE_LIMITS.maxDimension,
  maxPixels: VIEW_IMAGE_LIMITS.maxPixels,
  maxPerMessage: 8,
  maxMessageBytes: 16 * 1024 * 1024,
  maxDrafts: 32,
  maxDraftBytes: 128 * 1024 * 1024,
  maxConcurrentUploads: 4,
  draftLifetimeMs: 24 * 60 * 60 * 1000,
});

export interface AttachmentReference { id: string; sha256: string }
export interface ImageAttachment extends AttachmentReference {
  workspaceId: string;
  name: string;
  mimeType: ImageHeader['mimeType'];
  bytes: number;
  width: number;
  height: number;
  detail: ViewImageDetail;
  createdAt: string;
  /** Authenticated app route; no bearer token, filesystem path, or image data. */
  previewUrl: string;
}
export interface UploadImageAttachment { name: string; bytes: Buffer; detail?: ViewImageDetail }
export interface WorkspaceImageAttachment { path: string; expectedVersion?: string; detail?: ViewImageDetail }
export interface ResolvedImageAttachments { attachments: ImageAttachment[]; content: ModelItem[] }
export interface AttachmentServiceOptions { now?: () => number; cleanupIntervalMs?: number }
export type ImageAttachmentCleanupConfig = Pick<AppConfig, 'dataDir' | 'stateDir'>;
export interface ImageAttachmentWorkspaceCleanup { workspaceId: string; attachmentsRemoved: number; filesRemoved: number; permanentlyFenced: true }
interface AttachmentRecord extends Omit<ImageAttachment, 'previewUrl'> {
  kind: typeof RECORD_KIND;
  state: 'uploading' | 'ready' | 'discarded';
  retainedAt?: string;
  /** Private idempotency receipt; never grants a thread an image reference. */
  promotion?: ImageUploadOrigin;
}
interface Directory { handle: FileHandle; location: string; stat: Stats }
interface LoadedRecord { value: AttachmentRecord; serialized: string }
interface OwnedOperation { controller: AbortController; done: Promise<void>; finish: () => void }
interface CleanupLeaf { name: string; stat: Stats; sha256: string; bytes: Buffer }

const RECORD_KIND = 'codex-user-image-attachment-v1';
const STORAGE_DIRECTORY = 'image-attachments-v1';
const MAX_RECORD_BYTES = 8192;
const WORKSPACE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/;
const ATTACHMENT_ID = /^att_[a-f0-9]{32}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const suffixes = ['.upload', '.image', '.json'] as const;
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const within = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};
const sameFile = (before: Stats, after: Stats) => before.dev === after.dev && before.ino === after.ino && before.size === after.size
  && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
const sameDirectory = (before: Stats, after: Stats) => after.isDirectory() && before.dev === after.dev && before.ino === after.ino;
const errno = (error: unknown, code: string) => (error as NodeJS.ErrnoException | undefined)?.code === code;
const changed = () => new HttpError(409, 'This image attachment changed in storage. Attach the saved image again.', 'ATTACHMENT_CHANGED');
const missing = () => new HttpError(404, 'Image attachment not found in this workspace.', 'ATTACHMENT_NOT_FOUND');
const unsafe = () => new HttpError(403, 'Image attachment storage must remain inside the data directory.', 'UNSAFE_ATTACHMENT_STORAGE');
const expired = () => new HttpError(410, 'This unsubmitted image attachment expired. Attach it again.', 'ATTACHMENT_EXPIRED');
const draftLimit = () => new HttpError(429, 'This workspace has too many unsubmitted images. Remove unused attachments and try again.', 'ATTACHMENT_DRAFT_LIMIT');
const permanentlyDeleted = () => new HttpError(410, 'Image attachments for this permanently deleted workspace are unavailable.', 'ATTACHMENT_WORKSPACE_DELETED');
const cleanupConflict = () => new HttpError(409, 'Image attachment cleanup could not verify every remaining owned file. Unverified data was preserved for retry.', 'ATTACHMENT_CLEANUP_CONFLICT');
const detailSchema = z.enum(['high', 'original']);
const referenceSchema = z.object({ id: z.string().regex(ATTACHMENT_ID), sha256: z.string().regex(DIGEST) }).strict();
export const imageAttachmentReferencesSchema = z.array(referenceSchema).max(IMAGE_ATTACHMENT_LIMITS.maxPerMessage)
  .refine(items => new Set(items.map(item => item.id)).size === items.length, 'Attach an image only once per message.');

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new HttpError(400, 'Choose valid image attachments, filenames, and detail settings.', 'INVALID_ATTACHMENT_INPUT');
  return result.data;
}
function filename(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 255 || Buffer.byteLength(value) > 1024 ||
      /[\\/\u0000-\u001f\u007f]/.test(value) || value === '.' || value === '..') {
    throw new HttpError(400, 'Use an image filename of 1 to 255 characters, without folders or control characters.', 'INVALID_ATTACHMENT_NAME');
  }
  return value;
}
function date(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}
function metadata(record: AttachmentRecord): ImageAttachment {
  // Deliberately project fields. Internal state and future credentials/paths
  // can never become response properties through an object spread.
  return { id: record.id, workspaceId: record.workspaceId, name: record.name, mimeType: record.mimeType,
    bytes: record.bytes, width: record.width, height: record.height, sha256: record.sha256, detail: record.detail,
    createdAt: record.createdAt,
    previewUrl: `/api/workspaces/${encodeURIComponent(record.workspaceId)}/attachments/${record.id}/content?sha256=${record.sha256}` };
}

/**
 * UserInput::Image / LocalImage become immutable local assets, then real
 * Responses input_image parts. No remote URL fetch, image decoder process,
 * thumbnail service, encryption, or provider file upload is involved.
 */
export class ImageAttachmentService {
  private readonly ctx?: AppContext;
  private readonly config: ImageAttachmentCleanupConfig;
  private readonly now: () => number;
  private readonly cleanupIntervalMs: number;
  private root?: Directory;
  private ready?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private cleanup?: Promise<{ deleted: number; skipped: number }>;
  private readonly queues = new Map<string, Promise<unknown>>();
  private activeUploads = 0;
  private closing = false;
  private closed?: Promise<void>;
  private readonly stop = new AbortController();
  private readonly operations = new Map<string, Set<OwnedOperation>>();
  private readonly deletedWorkspaces = new Set<string>();
  private readonly unregister: () => void;

  constructor(source: AppContext | ImageAttachmentCleanupConfig, options: AttachmentServiceOptions = {}) {
    if ('config' in source) { this.ctx = source; this.config = source.config; }
    else this.config = source;
    this.now = options.now ?? Date.now;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? 15 * 60_000;
    this.unregister = this.ctx ? registerImageAssetParticipant({ storageRoot: () => this.storageRoot(), fence: id => this.fenceOwnedOperations(id) }) : () => undefined;
  }

  initialize(): Promise<void> {
    if (this.closing) return Promise.reject(new HttpError(503, 'The workspace is restarting. Try again shortly.', 'ATTACHMENTS_CLOSING'));
    this.ready ??= this.openRoot().then(async root => {
      this.root = root;
      // Cleanup-only callers must not expire or recover another workspace's data.
      if (this.ctx) await this.sweep();
      if (this.ctx && !this.closing && this.cleanupIntervalMs > 0) {
        this.timer = setInterval(() => { void this.cleanupExpired().catch(() => undefined); }, this.cleanupIntervalMs);
        this.timer.unref();
      }
    });
    return this.ready;
  }

  close(): Promise<void> {
    this.closed ??= (async () => {
      this.closing = true;
      this.stop.abort(new HttpError(503, 'The workspace is restarting. Try again shortly.', 'ATTACHMENTS_CLOSING'));
      clearInterval(this.timer);
      await this.ready?.catch(() => undefined);
      clearInterval(this.timer);
      await this.cleanup?.catch(() => undefined);
      await Promise.all([...this.operations.values()].flatMap(group => [...group].map(operation => operation.done)));
      await Promise.all([...this.queues.values()].map(pending => pending.catch(() => undefined)));
      if (this.ctx && this.root) await drainImageAssetCleanups(this.root.location);
      try { await this.root?.handle.close(); this.root = undefined; }
      finally { this.unregister(); }
    })();
    return this.closed;
  }

  private workspaceContext(): AppContext {
    if (!this.ctx) throw new HttpError(503, 'Image attachment cleanup has no active workspace context.', 'ATTACHMENT_CONTEXT_UNAVAILABLE');
    return this.ctx;
  }

  private async storageRoot(): Promise<string> {
    if (this.root) return this.root.location;
    const dataPath = path.resolve(this.config.dataDir), statePath = path.resolve(this.config.stateDir);
    if (!within(dataPath, statePath)) throw unsafe();
    return path.join(await fs.realpath(dataPath), path.relative(dataPath, statePath), STORAGE_DIRECTORY);
  }

  private checkWorkspace(workspaceId: string, signal?: AbortSignal): void {
    signal?.throwIfAborted();
    if (this.closing) throw new HttpError(503, 'The workspace is restarting. Try again shortly.', 'ATTACHMENTS_CLOSING');
    if (this.deletedWorkspaces.has(workspaceId) || this.root && imageAssetWorkspaceFenced(this.root.location, workspaceId)) throw permanentlyDeleted();
  }

  private async assertWorkspaceOpen(workspaceId: string, signal?: AbortSignal): Promise<void> {
    this.checkWorkspace(workspaceId, signal);
    await this.initialize();
    this.checkWorkspace(workspaceId, signal);
    await this.assertDirectory(this.root!);
    const marker = await fs.lstat(this.entry(this.root!, `${hash(workspaceId)}.deleted.json`)).catch(error => {
      if (errno(error, 'ENOENT')) return undefined; throw error;
    });
    if (marker) { this.deletedWorkspaces.add(workspaceId); throw permanentlyDeleted(); }
    this.checkWorkspace(workspaceId, signal);
  }

  private async workspaceOperation<T>(workspaceId: string, signal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (typeof workspaceId !== 'string' || !WORKSPACE_ID.test(workspaceId)) throw new HttpError(400, 'Choose a valid workspace.', 'INVALID_WORKSPACE_ID');
    this.checkWorkspace(workspaceId, signal);
    let finish!: () => void;
    const operation: OwnedOperation = { controller: new AbortController(), done: new Promise<void>(resolve => { finish = resolve; }), finish: () => finish() };
    const owned = this.operations.get(workspaceId) ?? new Set<OwnedOperation>();
    owned.add(operation); this.operations.set(workspaceId, owned);
    const combined = AbortSignal.any([this.stop.signal, operation.controller.signal, ...(signal ? [signal] : [])]);
    try { return await work(combined); }
    finally {
      owned.delete(operation); if (!owned.size) this.operations.delete(workspaceId);
      operation.finish();
    }
  }

  private fenceOwnedOperations(workspaceId: string): Promise<void> {
    this.deletedWorkspaces.add(workspaceId);
    const owned = [...(this.operations.get(workspaceId) ?? [])];
    for (const operation of owned) operation.controller.abort(permanentlyDeleted());
    const queued = this.queues.get(hash(workspaceId));
    return Promise.all([...owned.map(operation => operation.done), ...(queued ? [queued.catch(() => undefined)] : []),
      ...(this.ready ? [this.ready.catch(() => undefined)] : [])]).then(() => undefined);
  }

  private entry(directory: Directory, name: string): string {
    // The production host is Linux. Descriptor-relative paths keep all writes
    // and unlink operations in the opened directory if a parent is replaced.
    return path.join(process.platform === 'linux' ? `/proc/self/fd/${directory.handle.fd}` : directory.location, name);
  }

  private async assertDirectory(directory: Directory): Promise<void> {
    try {
      const live = await fs.lstat(directory.location);
      if (!sameDirectory(directory.stat, live) || live.isSymbolicLink()) throw unsafe();
      if (process.platform === 'linux' && await fs.realpath(`/proc/self/fd/${directory.handle.fd}`) !== directory.location) throw unsafe();
      if (await fs.realpath(directory.location) !== directory.location) throw unsafe();
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw unsafe();
    }
  }

  private async child(parent: Directory, name: string, create: boolean): Promise<Directory> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) || name === '.' || name === '..') throw unsafe();
    await this.assertDirectory(parent);
    const target = this.entry(parent, name);
    let handle: FileHandle | undefined;
    try {
      if (create) await fs.mkdir(target, { mode: 0o700 }).catch(error => { if (!errno(error, 'EEXIST')) throw error; });
      handle = await fs.open(target, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      const directory = { handle, location: path.join(parent.location, name), stat: await handle.stat() };
      await this.assertDirectory(directory);
      return directory;
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (errno(error, 'ELOOP') || errno(error, 'ENOTDIR')) throw unsafe();
      throw error;
    }
  }

  private async openRoot(): Promise<Directory> {
    const dataPath = path.resolve(this.config.dataDir), statePath = path.resolve(this.config.stateDir);
    if (!within(dataPath, statePath)) throw unsafe();
    const canonical = await fs.realpath(dataPath);
    let directory: Directory | undefined;
    try {
      const handle = await fs.open(canonical, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      directory = { handle, location: canonical, stat: await handle.stat() };
      await this.assertDirectory(directory);
      for (const segment of [...path.relative(dataPath, statePath).split(path.sep).filter(Boolean), STORAGE_DIRECTORY]) {
        const next = await this.child(directory, segment, true);
        await directory.handle.close();
        directory = next;
      }
      return directory;
    } catch (error) {
      await directory?.handle.close().catch(() => undefined);
      throw error;
    }
  }

  private enqueue<T>(key: string, work: () => Promise<T>): Promise<T> {
    const prior = this.queues.get(key) ?? Promise.resolve();
    const result = prior.catch(() => undefined).then(work);
    this.queues.set(key, result);
    void result.finally(() => { if (this.queues.get(key) === result) this.queues.delete(key); }).catch(() => undefined);
    return result;
  }

  private inWorkspace<T>(workspaceId: string, create: boolean, work: (directory: Directory, signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    return this.workspaceOperation(workspaceId, signal, async combined => {
      await this.assertWorkspaceOpen(workspaceId, combined);
      await this.workspaceContext().workspaces.get(workspaceId);
      const key = hash(workspaceId);
      return this.enqueue(key, async () => {
        await this.assertWorkspaceOpen(workspaceId, combined);
        let directory: Directory;
        try { directory = await this.child(this.root!, key, create); }
        catch (error) { if (errno(error, 'ENOENT')) throw missing(); throw error; }
        try {
          const result = await work(directory, combined);
          await this.assertWorkspaceOpen(workspaceId, combined);
          return result;
        } finally { await directory.handle.close(); }
      });
    });
  }

  private async readBounded(directory: Directory, name: string, maxBytes: number, signal?: AbortSignal, allowEmpty = false): Promise<Buffer> {
    signal?.throwIfAborted();
    await this.assertDirectory(directory);
    let handle: FileHandle | undefined;
    try {
      handle = await fs.open(this.entry(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const before = await handle.stat();
      if (!before.isFile() || before.nlink !== 1 || before.size < (allowEmpty ? 0 : 1) || before.size > maxBytes) throw changed();
      const result = Buffer.alloc(before.size + 1);
      let length = 0;
      while (length < result.length) {
        signal?.throwIfAborted();
        const { bytesRead } = await handle.read(result, length, Math.min(64 * 1024, result.length - length), length);
        signal?.throwIfAborted();
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length !== before.size || !sameFile(before, await handle.stat())) throw changed();
      const after = await fs.lstat(this.entry(directory, name));
      if (!after.isFile() || after.isSymbolicLink() || !sameFile(before, after)) throw changed();
      await this.assertDirectory(directory);
      return result.subarray(0, length);
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error instanceof HttpError) throw error;
      if (errno(error, 'ENOENT')) throw missing();
      if (errno(error, 'ELOOP') || errno(error, 'ENOTDIR')) throw unsafe();
      throw new HttpError(503, 'This image attachment cannot currently be read from storage.', 'ATTACHMENT_STORAGE_UNAVAILABLE');
    } finally { await handle?.close(); }
  }

  private async record(directory: Directory, id: string, workspaceId?: string, signal?: AbortSignal): Promise<LoadedRecord> {
    if (!ATTACHMENT_ID.test(id)) throw missing();
    const serialized = (await this.readBounded(directory, `${id}.json`, MAX_RECORD_BYTES, signal)).toString('utf8');
    return this.parseRecord(directory, id, serialized, workspaceId);
  }

  private parseRecord(directory: Directory, id: string, serialized: string, workspaceId?: string): LoadedRecord {
    let value: AttachmentRecord;
    try { value = JSON.parse(serialized) as AttachmentRecord; }
    catch { throw changed(); }
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).some(key => !['kind', 'id', 'workspaceId', 'name', 'mimeType', 'bytes', 'width', 'height', 'sha256', 'detail', 'createdAt', 'state', 'retainedAt', 'promotion'].includes(key)) ||
        value.kind !== RECORD_KIND || value.id !== id || typeof value.workspaceId !== 'string' || value.workspaceId.length > 120 ||
        hash(value.workspaceId) !== path.basename(directory.location) || workspaceId !== undefined && value.workspaceId !== workspaceId ||
        !DIGEST.test(value.sha256) || !MIME_TYPES.has(value.mimeType) || !['high', 'original'].includes(value.detail) ||
        !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > IMAGE_ATTACHMENT_LIMITS.maxBytes ||
        !Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height) || value.width < 1 || value.height < 1 ||
        value.width > IMAGE_ATTACHMENT_LIMITS.maxDimension || value.height > IMAGE_ATTACHMENT_LIMITS.maxDimension || value.width * value.height > IMAGE_ATTACHMENT_LIMITS.maxPixels ||
        !date(value.createdAt) || !['uploading', 'ready', 'discarded'].includes(value.state)
        || value.retainedAt !== undefined && (!date(value.retainedAt) || value.state !== 'ready')
        || value.state === 'discarded' && !value.promotion
        || value.promotion !== undefined && (!validImageUploadOrigin(value.promotion) || value.promotion.sha256 !== value.sha256
          || imageUploadAttachmentId(value.workspaceId, value.promotion, value.detail) !== value.id)) throw changed();
    try { filename(value.name); } catch { throw changed(); }
    return { value, serialized };
  }

  private async writeExclusive(directory: Directory, name: string, bytes: Buffer | string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    await this.assertDirectory(directory);
    let handle: FileHandle | undefined;
    try {
      handle = await fs.open(this.entry(directory, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      signal?.throwIfAborted();
      await handle.writeFile(bytes);
      await handle.sync();
      signal?.throwIfAborted();
      await this.assertDirectory(directory);
    } catch (error) {
      if (handle) await fs.unlink(this.entry(directory, name)).catch(() => undefined);
      throw error;
    } finally { await handle?.close(); }
  }

  private async updateRecord(directory: Directory, previous: LoadedRecord, value: AttachmentRecord, signal?: AbortSignal): Promise<void> {
    this.checkWorkspace(value.workspaceId, signal);
    const name = `${value.id}.${randomUUID().replaceAll('-', '')}.meta.tmp`;
    await this.writeExclusive(directory, name, `${JSON.stringify(value)}\n`, signal);
    try {
      if ((await this.record(directory, value.id, value.workspaceId, signal)).serialized !== previous.serialized) throw changed();
      await this.assertWorkspaceOpen(value.workspaceId, signal);
      await this.assertDirectory(directory);
      await fs.rename(this.entry(directory, name), this.entry(directory, `${value.id}.json`));
    } finally { await fs.unlink(this.entry(directory, name)).catch(error => { if (!errno(error, 'ENOENT')) throw error; }); }
  }

  private isExpired(record: AttachmentRecord): boolean {
    return !record.retainedAt && Date.parse(record.createdAt) <= this.now() - IMAGE_ATTACHMENT_LIMITS.draftLifetimeMs;
  }

  private async bytes(directory: Directory, record: AttachmentRecord, signal?: AbortSignal): Promise<Buffer> {
    if (record.state === 'discarded') throw new HttpError(410, 'This promoted photo was removed. Choose the image again for a new upload.', 'IMAGE_UPLOAD_DISCARDED');
    if (record.state !== 'ready') throw new HttpError(409, 'This image upload did not finish. Attach it again.', 'ATTACHMENT_NOT_READY');
    if (this.isExpired(record)) throw expired();
    const bytes = await this.readBounded(directory, `${record.id}.image`, IMAGE_ATTACHMENT_LIMITS.maxBytes, signal);
    if (bytes.length !== record.bytes || hash(bytes) !== record.sha256) throw changed();
    try {
      const header = inspectImageBytes(bytes);
      if (header.mimeType !== record.mimeType || header.width !== record.width || header.height !== record.height) throw changed();
    } catch { throw changed(); }
    return bytes;
  }

  private async removeOwned(directory: Directory, id: string, keepRecord = false): Promise<void> {
    if (!ATTACHMENT_ID.test(id)) throw unsafe();
    await this.assertDirectory(directory);
    for (const suffix of suffixes) {
      if (keepRecord && suffix === '.json') continue;
      // unlink never follows a symlink and never recursively removes a folder.
      // Names are generated from a validated ID, never read from a record path.
      await fs.unlink(this.entry(directory, `${id}${suffix}`)).catch(error => { if (!errno(error, 'ENOENT')) throw error; });
    }
  }

  private async room(directory: Directory, additionalBytes: number): Promise<void> {
    let count = 0, bytes = 0;
    const entries = await fs.opendir(this.entry(directory, '.'));
    for await (const entry of entries) {
      if (!/^att_[a-f0-9]{32}\.json$/.test(entry.name)) continue;
      try {
        const { value } = await this.record(directory, entry.name.slice(0, -5));
        if (value.retainedAt) continue;
        if (this.isExpired(value)) { await this.removeOwned(directory, value.id); continue; }
        if (value.state === 'discarded') continue;
        count++; bytes += value.bytes;
      } catch (error) {
        if (error instanceof HttpError && error.code === 'ATTACHMENT_NOT_FOUND') continue;
        // Broken or externally edited drafts consume a slot; never discard
        // unknown files in order to manufacture quota capacity.
        count++; bytes += IMAGE_ATTACHMENT_LIMITS.maxBytes;
      }
      if (count >= IMAGE_ATTACHMENT_LIMITS.maxDrafts || bytes + additionalBytes > IMAGE_ATTACHMENT_LIMITS.maxDraftBytes) throw draftLimit();
    }
  }

  private async promoted(directory: Directory, workspaceId: string, origin: ImageUploadOrigin, detail: ViewImageDetail,
    signal: AbortSignal): Promise<ImageAttachment | undefined> {
    const id = imageUploadAttachmentId(workspaceId, origin, detail);
    let loaded: LoadedRecord;
    try { loaded = await this.record(directory, id, workspaceId, signal); }
    catch (error) {
      if (!(error instanceof HttpError && error.code === 'ATTACHMENT_NOT_FOUND')) throw error;
      // A payload without its receipt is uncertain, never a fresh conversion.
      for (const suffix of ['.upload', '.image']) {
        const present = await fs.lstat(this.entry(directory, `${id}${suffix}`)).catch(error => { if (errno(error, 'ENOENT')) return undefined; throw error; });
        if (present) throw new HttpError(409, 'The earlier photo preparation could not be confirmed. Its saved files were retained.', 'IMAGE_PROMOTION_UNCONFIRMED');
      }
      return undefined;
    }
    const value = loaded.value;
    if (!value.promotion || value.promotion.uploadId !== origin.uploadId || value.promotion.sha256 !== origin.sha256 || value.detail !== detail) throw changed();
    if (value.state === 'discarded') throw new HttpError(410, 'This promoted photo was removed. Choose the image again for a new upload.', 'IMAGE_UPLOAD_DISCARDED');
    if (this.isExpired(value)) throw expired();
    if (value.state === 'ready') { await this.bytes(directory, value, signal); return metadata(value); }
    // An interrupted metadata acknowledgement can be completed only from the
    // exact already-written image. Partial or absent payloads remain held.
    const ready: AttachmentRecord = { ...value, state: 'ready' };
    try { await this.bytes(directory, ready, signal); }
    catch (error) {
      if (signal.aborted) throw signal.reason;
      throw new HttpError(409, 'The earlier photo preparation did not finish. Its original and saved work were retained; retry checks the same upload.', 'IMAGE_PROMOTION_UNCONFIRMED');
    }
    await this.updateRecord(directory, loaded, ready, signal);
    return metadata(ready);
  }

  private async save(workspaceId: string, name: string, bytes: Buffer, detail: ViewImageDetail, signal?: AbortSignal,
    promotion?: { origin: ImageUploadOrigin; createdAt: string }): Promise<ImageAttachment> {
    const header = inspectImageBytes(bytes);
    const record: AttachmentRecord = { kind: RECORD_KIND,
      id: promotion ? imageUploadAttachmentId(workspaceId, promotion.origin, detail) : `att_${randomUUID().replaceAll('-', '')}`, workspaceId,
      name: filename(name), ...header, bytes: bytes.length, sha256: hash(bytes), detail,
      createdAt: promotion?.createdAt ?? new Date(this.now()).toISOString(), state: 'uploading', ...(promotion ? { promotion: promotion.origin } : {}) };
    return this.inWorkspace(workspaceId, true, async (directory, signal) => {
      signal.throwIfAborted();
      if (promotion) {
        const existing = await this.promoted(directory, workspaceId, promotion.origin, detail, signal);
        if (existing) return existing;
      }
      await this.room(directory, bytes.length);
      const serialized = `${JSON.stringify(record)}\n`;
      await this.writeExclusive(directory, `${record.id}.json`, serialized, signal);
      try {
        signal.throwIfAborted();
        await this.writeExclusive(directory, `${record.id}.upload`, bytes, signal);
        await this.assertWorkspaceOpen(workspaceId, signal);
        await this.assertDirectory(directory);
        await fs.rename(this.entry(directory, `${record.id}.upload`), this.entry(directory, `${record.id}.image`));
        const ready: AttachmentRecord = { ...record, state: 'ready' };
        await this.updateRecord(directory, { value: record, serialized }, ready, signal);
        await this.assertWorkspaceOpen(workspaceId, signal);
        if (promotion) await this.bytes(directory, ready, signal);
        return metadata(ready);
      } catch (error) {
        // Promotion intent and partial work survive an uncertain result. A
        // repeated request cannot mint another image or silently replace it.
        if (!promotion) await this.removeOwned(directory, record.id).catch(() => undefined);
        throw error;
      }
    }, signal);
  }

  private async uploadSlot<T>(workspaceId: string, signal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.closing) throw new HttpError(503, 'The workspace is restarting. Try again shortly.', 'ATTACHMENTS_CLOSING');
    if (this.activeUploads >= IMAGE_ATTACHMENT_LIMITS.maxConcurrentUploads) throw new HttpError(429, 'Other images are still uploading. Try again shortly.', 'ATTACHMENT_UPLOAD_BUSY');
    this.activeUploads++;
    try { return await this.workspaceOperation(workspaceId, signal, work); }
    finally { this.activeUploads--; }
  }

  upload(workspaceId: string, input: UploadImageAttachment, options: { signal?: AbortSignal } = {}): Promise<ImageAttachment> {
    return this.uploadSlot(workspaceId, options.signal, async signal => {
      if (!input || !Buffer.isBuffer(input.bytes)) throw new HttpError(400, 'Upload the raw image file bytes.', 'INVALID_ATTACHMENT_INPUT');
      if (input.bytes.length > IMAGE_ATTACHMENT_LIMITS.maxBytes) throw new HttpError(413, 'Each image must be 8 MiB or smaller.', 'IMAGE_TOO_LARGE');
      const name = filename(input.name), detail = parse(detailSchema, input.detail ?? 'high');
      // Take a copy before any await; a caller mutating its buffer cannot alter
      // the image after its digest/header have been validated.
      const bytes = Buffer.from(input.bytes);
      signal.throwIfAborted();
      return this.save(workspaceId, name, bytes, detail, signal);
    });
  }

  fromUpload(workspaceId: string, input: ImageUploadPromotionInput, options: { signal?: AbortSignal } = {}): Promise<ImageAttachment> {
    const request = parseImageUploadPromotion(input), detail = request.detail ?? 'high';
    const origin = { uploadId: request.uploadId, sha256: request.sha256 };
    return this.uploadSlot(workspaceId, options.signal, async signal => {
      try {
        const existing = await this.inWorkspace(workspaceId, false, (directory, owned) => this.promoted(directory, workspaceId, origin, detail, owned), signal);
        if (existing) return existing;
      } catch (error) { if (!(error instanceof HttpError && error.code === 'ATTACHMENT_NOT_FOUND')) throw error; }
      const source = await readImageUpload(this.workspaceContext(), workspaceId, origin,
        { maxBytes: IMAGE_ATTACHMENT_LIMITS.maxBytes, maxAgeMs: IMAGE_ATTACHMENT_LIMITS.draftLifetimeMs, now: this.now() }, signal);
      return this.save(workspaceId, source.name, source.bytes, detail, signal, { origin, createdAt: source.createdAt });
    });
  }

  fromWorkspace(workspaceId: string, input: WorkspaceImageAttachment, options: { signal?: AbortSignal } = {}): Promise<ImageAttachment> {
    return this.uploadSlot(workspaceId, options.signal, async signal => {
      const request = parse(z.object({ path: z.string().min(1).max(4096), expectedVersion: z.string().regex(DIGEST).optional(), detail: detailSchema.optional() }).strict(), input);
      if (/^[a-z][a-z0-9+.-]*:/i.test(request.path)) throw new HttpError(400, 'Choose a saved image inside this workspace. Remote URLs are not supported.', 'INVALID_PATH');
      const detail = request.detail ?? 'high';
      await this.assertWorkspaceOpen(workspaceId, signal);
      const first = await viewWorkspaceImage(this.workspaceContext(), workspaceId, request.path, { detail, signal });
      // Compare a second complete read as well as image.ts's descriptor/stats
      // checks: bucket filesystems can reuse timestamps for same-tick writes.
      const second = await viewWorkspaceImage(this.workspaceContext(), workspaceId, request.path, { detail, signal });
      const url = first.output.find(part => part.type === 'input_image')?.image_url;
      if (typeof url !== 'string' || url !== second.output.find(part => part.type === 'input_image')?.image_url || first.metadata.path !== second.metadata.path) {
        throw new HttpError(409, 'The source image changed while being attached. Try the saved file again.', 'IMAGE_CHANGED');
      }
      const bytes = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
      if (request.expectedVersion && request.expectedVersion !== hash(bytes)) throw new HttpError(409, 'The source image changed since it was selected. Review the saved file and attach it again.', 'VERSION_CONFLICT');
      return this.save(workspaceId, path.posix.basename(first.metadata.path), bytes, detail, signal);
    });
  }

  async resolve(workspaceId: string, input: AttachmentReference[], options: { retain?: boolean; signal?: AbortSignal } = {}): Promise<ResolvedImageAttachments> {
    const references = parse(imageAttachmentReferencesSchema, input);
    if (!references.length) return this.workspaceOperation(workspaceId, options.signal, async signal => {
      await this.assertWorkspaceOpen(workspaceId, signal);
      await this.workspaceContext().workspaces.get(workspaceId);
      await this.assertWorkspaceOpen(workspaceId, signal);
      return { attachments: [], content: [] };
    });
    return this.inWorkspace(workspaceId, false, async (directory, signal) => {
      const records: LoadedRecord[] = [];
      const content: ModelItem[] = [];
      let bytes = 0;
      // Validate the entire message before retaining any of its drafts.
      for (const reference of references) {
        const loaded = await this.record(directory, reference.id, workspaceId, signal);
        if (loaded.value.sha256 !== reference.sha256) throw changed();
        bytes += loaded.value.bytes;
        if (bytes > IMAGE_ATTACHMENT_LIMITS.maxMessageBytes) throw new HttpError(413, 'Images in one message must total 16 MiB or less.', 'ATTACHMENT_MESSAGE_TOO_LARGE');
        const image = await this.bytes(directory, loaded.value, signal);
        content.push({ type: 'input_image', image_url: `data:${loaded.value.mimeType};base64,${image.toString('base64')}`, detail: loaded.value.detail });
        records.push(loaded);
      }
      if (options.retain) for (const loaded of records) {
        if (!loaded.value.retainedAt) await this.updateRecord(directory, loaded, { ...loaded.value, retainedAt: new Date(this.now()).toISOString() }, signal);
      }
      return { attachments: records.map(record => metadata(record.value)), content };
    }, options.signal);
  }

  async preview(workspaceId: string, id: string, sha256: string): Promise<{ attachment: ImageAttachment; bytes: Buffer }> {
    if (!ATTACHMENT_ID.test(id) || !DIGEST.test(sha256)) throw missing();
    return this.inWorkspace(workspaceId, false, async (directory, signal) => {
      const { value } = await this.record(directory, id, workspaceId, signal);
      if (value.sha256 !== sha256) throw changed();
      return { attachment: metadata(value), bytes: await this.bytes(directory, value, signal) };
    });
  }

  async discard(workspaceId: string, id: string): Promise<{ deleted: true }> {
    return this.inWorkspace(workspaceId, false, async (directory, signal) => {
      const loaded = await this.record(directory, id, workspaceId, signal), { value } = loaded;
      if (value.retainedAt) throw new HttpError(409, 'This image belongs to a saved message and must remain available to its conversation and forks.', 'ATTACHMENT_IN_USE');
      if (value.promotion) {
        if (value.state !== 'discarded') await this.updateRecord(directory, loaded, { ...value, state: 'discarded' }, signal);
        await this.removeOwned(directory, id, true);
      } else await this.removeOwned(directory, id);
      return { deleted: true };
    });
  }

  private async writeDeletionFence(workspaceId: string): Promise<void> {
    await this.assertDirectory(this.root!);
    const name = `${hash(workspaceId)}.deleted.json`;
    let handle: FileHandle | undefined;
    try {
      handle = await fs.open(this.entry(this.root!, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      // The create-only empty file is the durable fence. It carries no JSON
      // write that can tear and make a correctly authorized retry impossible.
      await handle.sync(); await this.assertDirectory(this.root!);
    } catch (error) {
      if (!errno(error, 'EEXIST')) throw error;
      const stat = await fs.lstat(this.entry(this.root!, name));
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4096) throw cleanupConflict();
      // Older bounded regular markers (including torn JSON) remain deny-only
      // intent. Current lifecycle authority and exact records authorize removal.
      handle = await fs.open(this.entry(this.root!, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const opened = await handle.stat();
      if (!sameFile(stat, opened) || opened.nlink !== 1 || !opened.isFile()) throw cleanupConflict();
      await handle.sync(); await this.assertDirectory(this.root!);
      const current = await fs.lstat(this.entry(this.root!, name));
      if (!sameFile(opened, current) || current.isSymbolicLink() || current.nlink !== 1) throw cleanupConflict();
    } finally { await handle?.close(); }
    // Never remove a deletion fence on an error or partial cleanup.
  }

  private async cleanupLeaf(directory: Directory, name: string, maximum: number, allowEmpty = false): Promise<CleanupLeaf> {
    await this.assertDirectory(directory);
    const before = await fs.lstat(this.entry(directory, name));
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maximum) throw cleanupConflict();
    const bytes = await this.readBounded(directory, name, maximum, undefined, allowEmpty);
    const after = await fs.lstat(this.entry(directory, name));
    if (!sameFile(before, after) || after.nlink !== 1) throw cleanupConflict();
    return { name, stat: after, sha256: hash(bytes), bytes };
  }

  private cleanupName(entry: { name: string; isFile(): boolean; isSymbolicLink(): boolean }): { id: string; kind: 'record' | 'image' | 'upload' | 'temporary' } {
    const regular = /^(att_[a-f0-9]{32})\.(json|image|upload)$/.exec(entry.name);
    const temporary = /^(att_[a-f0-9]{32})\.[a-f0-9]{32}\.meta\.tmp$/.exec(entry.name);
    const id = regular?.[1] ?? temporary?.[1];
    if (!id || !entry.isFile() || entry.isSymbolicLink()) throw cleanupConflict();
    return { id, kind: temporary ? 'temporary' : regular![2] === 'json' ? 'record' : regular![2] as 'image' | 'upload' };
  }

  private ownershipFields(value: AttachmentRecord): string {
    return JSON.stringify([value.kind, value.id, value.workspaceId, value.name, value.mimeType, value.bytes,
      value.width, value.height, value.sha256, value.detail, value.createdAt, value.promotion ?? null]);
  }

  private async preflightCleanup(directory: Directory, workspaceId: string): Promise<void> {
    // Retained originals have no count quota. Stream the complete namespace and
    // bound only the metadata cache, never reject a valid large collection.
    const records = new Map<string, AttachmentRecord>();
    await this.assertDirectory(directory);
    for await (const entry of await fs.opendir(this.entry(directory, '.'))) {
      const { id, kind } = this.cleanupName(entry);
      let record = records.get(id);
      if (!record) {
        record = (await this.record(directory, id, workspaceId)).value;
        if (records.size >= 256) records.delete(records.keys().next().value!);
        records.set(id, record);
      }
      if (kind === 'temporary') {
        const bytes = await this.readBounded(directory, entry.name, MAX_RECORD_BYTES);
        const temporary = this.parseRecord(directory, id, bytes.toString('utf8'), workspaceId).value;
        if (this.ownershipFields(temporary) !== this.ownershipFields(record)) throw cleanupConflict();
      } else if (kind === 'upload' && record.state !== 'uploading' && !(record.state === 'discarded' && record.promotion)) throw cleanupConflict();
    }
    await this.assertDirectory(directory);
  }

  private async deleteCleanupLeaf(directory: Directory, workspaceId: string, id: string, owner: LoadedRecord, expected: CleanupLeaf,
    maximum: number, allowEmpty: boolean, options: ImageAssetCleanupOptions): Promise<void> {
    await options.assertCurrent?.();
    if ((await this.record(directory, id, workspaceId)).serialized !== owner.serialized) throw cleanupConflict();
    const actual = await this.cleanupLeaf(directory, expected.name, maximum, allowEmpty);
    if (!sameFile(expected.stat, actual.stat) || expected.sha256 !== actual.sha256) throw cleanupConflict();
    await this.assertDirectory(directory);
    const current = await fs.lstat(this.entry(directory, expected.name));
    if (!sameFile(actual.stat, current) || !current.isFile() || current.isSymbolicLink() || current.nlink !== 1) throw cleanupConflict();
    await fs.unlink(this.entry(directory, expected.name));
  }

  private async purgeOwnedWorkspace(workspaceId: string, options: ImageAssetCleanupOptions): Promise<ImageAttachmentWorkspaceCleanup> {
    let directory: Directory | undefined;
    try {
      try { directory = await this.child(this.root!, hash(workspaceId), false); }
      catch (error) { if (errno(error, 'ENOENT')) return { workspaceId, attachmentsRemoved: 0, filesRemoved: 0, permanentlyFenced: true }; throw error; }
      await this.preflightCleanup(directory, workspaceId);
      let filesRemoved = 0, attachmentsRemoved = 0;
      // Keep every authoritative record while removing payloads/temporaries.
      // Reopen the iterator until a complete pass finds none; directory mutation
      // must not make a native iterator's skipped entries look like completion.
      for (;;) {
        let removed = 0;
        for await (const entry of await fs.opendir(this.entry(directory, '.'))) {
          const { id, kind } = this.cleanupName(entry);
          if (kind === 'record') continue;
          const owner = await this.record(directory, id, workspaceId), record = owner.value;
          const maximum = kind === 'temporary' ? MAX_RECORD_BYTES : IMAGE_ATTACHMENT_LIMITS.maxBytes;
          const leaf = await this.cleanupLeaf(directory, entry.name, maximum, kind === 'upload');
          if (kind === 'temporary') {
            const temporary = this.parseRecord(directory, id, leaf.bytes.toString('utf8'), workspaceId).value;
            if (this.ownershipFields(temporary) !== this.ownershipFields(record)) throw cleanupConflict();
          } else {
            if (kind === 'upload') {
              if (record.state !== 'uploading' && !(record.state === 'discarded' && record.promotion)) throw cleanupConflict();
              const image = await fs.lstat(this.entry(directory, `${id}.image`)).catch(error => { if (errno(error, 'ENOENT')) return undefined; throw error; });
              if (image) throw cleanupConflict();
            }
            if (leaf.bytes.length > record.bytes || (kind === 'image' || leaf.bytes.length === record.bytes)
              && (leaf.bytes.length !== record.bytes || leaf.sha256 !== record.sha256)) throw cleanupConflict();
          }
          await this.deleteCleanupLeaf(directory, workspaceId, id, owner, leaf, maximum, kind === 'upload', options);
          filesRemoved++; removed++;
        }
        if (!removed) break;
      }
      for (;;) {
        let removed = 0;
        for await (const entry of await fs.opendir(this.entry(directory, '.'))) {
          const { id, kind } = this.cleanupName(entry);
          if (kind !== 'record') throw cleanupConflict();
          const leaf = await this.cleanupLeaf(directory, entry.name, MAX_RECORD_BYTES);
          const owner = this.parseRecord(directory, id, leaf.bytes.toString('utf8'), workspaceId);
          for (const suffix of ['.image', '.upload']) {
            const payload = await fs.lstat(this.entry(directory, `${id}${suffix}`)).catch(error => { if (errno(error, 'ENOENT')) return undefined; throw error; });
            if (payload) throw cleanupConflict();
          }
          await this.deleteCleanupLeaf(directory, workspaceId, id, owner, leaf, MAX_RECORD_BYTES, false, options);
          filesRemoved++; attachmentsRemoved++; removed++;
        }
        if (!removed) break;
      }
      await this.assertDirectory(directory); await options.assertCurrent?.();
      return { workspaceId, attachmentsRemoved, filesRemoved, permanentlyFenced: true };
    } catch (error) {
      if (error instanceof HttpError && error.code === 'WORKSPACE_ARTIFACT_CLEANUP_CHANGED') throw error;
      throw cleanupConflict();
    } finally { await directory?.handle.close(); }
  }

  /** Only permanent purge calls this; ordinary trash/restore retains originals. */
  deleteWorkspace(workspaceId: string, options: ImageAssetCleanupOptions = {}): Promise<ImageAttachmentWorkspaceCleanup> {
    return ImageAttachmentService.cleanupWorkspace(this.ctx ?? this.config, workspaceId, options);
  }

  static async cleanupWorkspace(source: AppContext | ImageAttachmentCleanupConfig, workspaceId: string, options: ImageAssetCleanupOptions = {}): Promise<ImageAttachmentWorkspaceCleanup> {
    if (typeof workspaceId !== 'string' || !WORKSPACE_ID.test(workspaceId)) throw new HttpError(400, 'Choose a valid workspace.', 'INVALID_WORKSPACE_ID');
    const config = 'config' in source ? source.config : source;
    const cleanup = new ImageAttachmentService(config, { cleanupIntervalMs: 0 });
    try {
      const location = await cleanup.storageRoot();
      return await withImageAssetCleanup(location, workspaceId, options, async drain => {
        await cleanup.initialize(); await options.assertCurrent?.();
        await cleanup.writeDeletionFence(workspaceId);
        await drain(); await options.assertCurrent?.();
        return cleanup.purgeOwnedWorkspace(workspaceId, options);
      });
    } finally { await cleanup.close(); }
  }

  cleanupExpired(): Promise<{ deleted: number; skipped: number }> {
    this.cleanup ??= this.initialize().then(() => this.sweep()).finally(() => { this.cleanup = undefined; });
    return this.cleanup;
  }

  private async sweep(): Promise<{ deleted: number; skipped: number }> {
    const result = { deleted: 0, skipped: 0 };
    await this.assertDirectory(this.root!);
    const workspaces = await fs.opendir(this.entry(this.root!, '.'));
    for await (const workspace of workspaces) {
      if (!workspace.isDirectory() || !DIGEST.test(workspace.name)) continue;
      if (imageAssetWorkspaceHashFenced(this.root!.location, workspace.name)) continue;
      await this.enqueue(workspace.name, async () => {
        let directory: Directory | undefined;
        try {
          if (imageAssetWorkspaceHashFenced(this.root!.location, workspace.name)) return;
          const fence = await fs.lstat(this.entry(this.root!, `${workspace.name}.deleted.json`)).catch(error => { if (errno(error, 'ENOENT')) return undefined; throw error; });
          if (fence) return;
          directory = await this.child(this.root!, workspace.name, false);
          const entries = await fs.opendir(this.entry(directory, '.'));
          for await (const entry of entries) {
            const recordId = /^att_[a-f0-9]{32}\.json$/.test(entry.name) ? entry.name.slice(0, -5) : undefined;
            if (recordId) {
              try {
                const { value } = await this.record(directory, recordId);
                if (this.deletedWorkspaces.has(value.workspaceId) || imageAssetWorkspaceFenced(this.root!.location, value.workspaceId)) continue;
                if (this.isExpired(value)) { await this.removeOwned(directory, recordId); result.deleted++; }
              } catch { result.skipped++; }
            } else if (/^att_[a-f0-9]{32}\.[a-f0-9]{32}\.meta\.tmp$/.test(entry.name) && entry.isFile()) {
              // An interrupted atomic metadata update is self-identifying JSON.
              // Validate it before unlinking; arbitrary old files are untouched.
              try {
                if (imageAssetWorkspaceHashFenced(this.root!.location, workspace.name)) continue;
                const bytes = await this.readBounded(directory, entry.name, MAX_RECORD_BYTES);
                const record = JSON.parse(bytes.toString('utf8')) as AttachmentRecord;
                const stat = await fs.lstat(this.entry(directory, entry.name));
                if (record.kind === RECORD_KIND && record.id === entry.name.slice(0, 36) && typeof record.workspaceId === 'string' && hash(record.workspaceId) === workspace.name
                    && date(record.createdAt) && stat.isFile() && !stat.isSymbolicLink() && stat.mtimeMs <= this.now() - IMAGE_ATTACHMENT_LIMITS.draftLifetimeMs) {
                  await this.assertDirectory(directory);
                  if (imageAssetWorkspaceHashFenced(this.root!.location, workspace.name)) continue;
                  await fs.unlink(this.entry(directory, entry.name));
                }
              } catch { result.skipped++; }
            }
          }
        } catch { result.skipped++; }
        finally { await directory?.handle.close(); }
      });
    }
    return result;
  }
}

const services = new WeakMap<AppContext, ImageAttachmentService>();
export function getImageAttachments(ctx: AppContext): ImageAttachmentService {
  let service = services.get(ctx);
  if (!service) { service = new ImageAttachmentService(ctx); services.set(ctx, service); }
  return service;
}
export async function initializeImageAttachments(ctx: AppContext): Promise<void> { await getImageAttachments(ctx).initialize(); }
export async function shutdownImageAttachments(ctx: AppContext): Promise<void> { await services.get(ctx)?.close(); }
export async function cleanupWorkspaceImageAttachments(
  source: AppContext | ImageAttachmentCleanupConfig, workspaceId: string, options: ImageAssetCleanupOptions = {},
): Promise<ImageAttachmentWorkspaceCleanup> { return ImageAttachmentService.cleanupWorkspace(source, workspaceId, options); }

/** Mount only after the app's existing session and mutation-origin middleware. */
export function createImageAttachmentsRouter(ctx: AppContext): Router {
  const router = Router(), service = getImageAttachments(ctx);
  let receiving = 0;
  router.post('/workspaces/:id/attachments', (req, res, next) => {
    if (!req.is('application/octet-stream')) { next(new HttpError(415, 'Upload raw image bytes as application/octet-stream.', 'ATTACHMENT_UPLOAD_TYPE')); return; }
    if (receiving >= IMAGE_ATTACHMENT_LIMITS.maxConcurrentUploads) { next(new HttpError(429, 'Other images are still uploading. Try again shortly.', 'ATTACHMENT_UPLOAD_BUSY')); return; }
    receiving++;
    let released = false;
    const release = () => { if (!released) { released = true; receiving--; } };
    res.once('finish', release); res.once('close', release);
    next();
  }, raw({ type: 'application/octet-stream', limit: IMAGE_ATTACHMENT_LIMITS.maxBytes, inflate: false }), async (req, res) => {
    const query = parse(z.object({ name: z.string(), detail: detailSchema.optional() }).strict(), req.query);
    const controller = new AbortController();
    const abort = () => { if (!res.writableFinished) controller.abort(new HttpError(400, 'The image upload was cancelled.', 'ATTACHMENT_UPLOAD_ABORTED')); };
    req.once('aborted', abort); res.once('close', abort);
    try { res.status(201).json(await service.upload(req.params.id, { name: query.name, bytes: req.body as Buffer, detail: query.detail }, { signal: controller.signal })); }
    finally { req.off('aborted', abort); res.off('close', abort); }
  });
  router.post('/workspaces/:id/attachments/from-workspace', async (req, res) => {
    res.status(201).json(await service.fromWorkspace(req.params.id, req.body as WorkspaceImageAttachment));
  });
  router.post('/workspaces/:id/attachments/from-upload', async (req, res) => {
    res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    const controller = new AbortController();
    const aborted = () => { if (!res.writableEnded) controller.abort(new Error('Photo preparation response disconnected.')); };
    req.once('aborted', aborted); res.once('close', aborted);
    try { res.status(201).json(await service.fromUpload(String(req.params.id), req.body, { signal: controller.signal })); }
    finally { req.off('aborted', aborted); res.off('close', aborted); }
  });
  router.get('/workspaces/:id/attachments/:attachmentId/content', async (req, res) => {
    const query = parse(z.object({ sha256: z.string().regex(DIGEST) }).strict(), req.query);
    const { attachment, bytes } = await service.preview(req.params.id, req.params.attachmentId, query.sha256);
    const extension = attachment.mimeType === 'image/jpeg' ? 'jpg' : attachment.mimeType.slice('image/'.length);
    const encodedName = encodeURIComponent(attachment.name).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    res.set({ 'Content-Type': attachment.mimeType, 'Content-Length': String(bytes.length), 'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': `inline; filename="image.${extension}"; filename*=UTF-8''${encodedName}`, ETag: `"${attachment.sha256}"` });
    res.end(bytes);
  });
  router.delete('/workspaces/:id/attachments/:attachmentId', async (req, res) => {
    res.json(await service.discard(req.params.id, req.params.attachmentId));
  });
  return router;
}
