import { createHash, randomUUID } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import type { AppContext } from '../context';
import type { FileEntry } from '../../shared/types';
import { HttpError } from '../errors';
import { getDownloadService } from '../downloads';
import type { DownloadJob } from '../downloads/types';
import { withWorkspaceFileMutation } from '../file-transfers/queue';
import { getGeneratedImageService } from '../generated-images';
import { LEGACY_AGENT_IMAGE_SAVE_BYTES } from '../legacy/change-limits';
import { plainObject, uploadPath } from '../uploads/validation';
import type { GeneratedImageMetadata, GeneratedImageRead, GeneratedImageReference } from './types';

const ID = /^img_[a-f0-9]{64}$/;
const HASH = /^[a-f0-9]{64}$/;
const LOCAL_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/;
const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const MAX_ACTIVE = 4;
const same = (a: BigIntStats, b: BigIntStats) => a.isFile() && b.isFile() && a.dev === b.dev && a.ino === b.ino
  && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
const unsafe = () => new HttpError(403, 'The destination changed or contains a symbolic link. Choose an existing workspace folder.', 'UNSAFE_PATH');
const invalid = () => new HttpError(400, 'Choose a saved generated image, its exact SHA-256 and a relative workspace file path.', 'INVALID_GENERATED_IMAGE_INPUT');
const closing = () => new HttpError(503, 'Image delivery is stopping. Try again after the workspace restarts.', 'GENERATED_IMAGE_DELIVERY_CLOSING');

export interface GeneratedImageSave { image: GeneratedImageMetadata; path: string; entry: FileEntry; version: string }
export interface GeneratedImageSaveInput {
  path: string;
  /** Optional assertion of the original asset owner, including in explicit forks.
   * This never attributes a manual user save to an agent conversation. */
  threadId?: string;
}
/** Server-only mutation controls. None of these flags are accepted from HTTP. */
export interface GeneratedImageSaveOptions {
  signal?: AbortSignal;
  source?: 'agent';
  beforeCommit?: (image: GeneratedImageMetadata) => Promise<void>;
}

function reference(workspaceId: string, input: GeneratedImageReference): GeneratedImageReference {
  if (!LOCAL_ID.test(workspaceId) || !plainObject(input, ['id', 'sha256'])
    || typeof input.id !== 'string' || !ID.test(input.id) || typeof input.sha256 !== 'string' || !HASH.test(input.sha256)) throw invalid();
  return { id: input.id, sha256: input.sha256 };
}
function saveInput(input: GeneratedImageSaveInput): GeneratedImageSaveInput {
  if (!plainObject(input, ['path', 'threadId']) || input.threadId !== undefined && (typeof input.threadId !== 'string' || !LOCAL_ID.test(input.threadId))) throw invalid();
  const relative = uploadPath(input.path);
  if (/^[a-z][a-z0-9+.-]*:/iu.test(relative)) throw invalid();
  return { path: relative, ...(input.threadId === undefined ? {} : { threadId: input.threadId }) };
}
function copyLimit(image: GeneratedImageMetadata, source?: 'agent'): void {
  if (source === 'agent' && image.bytes > LEGACY_AGENT_IMAGE_SAVE_BYTES) {
    throw new HttpError(413, 'Agent image copies support up to 2 MiB so they can use change review. Use the image card’s Save to workspace or Download action for this larger original.', 'GENERATED_IMAGE_REVIEW_LIMIT');
  }
}
function normalizeError(error: unknown): Error {
  if (error instanceof HttpError) return error;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'EEXIST') return new HttpError(409, 'A file or folder already exists there. Choose another path; existing contents were preserved.', 'FILE_EXISTS');
  if (code === 'ELOOP' || code === 'ENOTDIR') return unsafe();
  if (code === 'ENOENT') return new HttpError(404, 'The destination folder no longer exists.', 'FILE_NOT_FOUND');
  if (code === 'ENOSPC' || code === 'EDQUOT') return new HttpError(507, 'Storage could not finish the image copy. Inspect the destination before retrying; the saved original is preserved.', 'GENERATED_IMAGE_STORAGE_FULL');
  return new HttpError(503, 'The image copy could not be verified. Inspect the destination before retrying; the saved original is preserved.', 'GENERATED_IMAGE_DELIVERY_FAILED');
}

async function openDirectory(absolute: string): Promise<FileHandle> {
  if (process.platform !== 'linux') throw new HttpError(503, 'Secure image delivery requires the Space’s Linux host.', 'DOWNLOAD_HOST_UNSUPPORTED');
  let handle = await fs.open('/', DIRECTORY_FLAGS);
  try {
    for (const part of absolute.split(path.sep).filter(Boolean)) {
      const next = await fs.open(`/proc/self/fd/${handle.fd}/${part}`, DIRECTORY_FLAGS);
      await handle.close(); handle = next;
    }
    if (await fs.realpath(`/proc/self/fd/${handle.fd}`) !== absolute) throw unsafe();
    return handle;
  } catch (error) { await handle.close(); throw error; }
}

async function destination(ctx: AppContext, workspaceId: string, relative: string) {
  const root = await ctx.workspaces.resolvePath(workspaceId, '');
  const rootStat = await fs.lstat(root, { bigint: true });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw unsafe();
  const location = path.join(root, path.posix.dirname(relative));
  const parent = await openDirectory(location);
  try {
    const parentStat = await parent.stat({ bigint: true });
    const name = path.posix.basename(relative), bound = `/proc/self/fd/${parent.fd}/${name}`;
    const check = async () => {
      const currentRoot = await fs.lstat(root, { bigint: true });
      const live = await fs.lstat(location, { bigint: true });
      if (await ctx.workspaces.resolvePath(workspaceId, '') !== root
        || !currentRoot.isDirectory() || currentRoot.isSymbolicLink() || currentRoot.dev !== rootStat.dev || currentRoot.ino !== rootStat.ino
        || !live.isDirectory() || live.isSymbolicLink() || live.dev !== parentStat.dev || live.ino !== parentStat.ino
        || await fs.realpath(`/proc/self/fd/${parent.fd}`) !== location || await fs.realpath(location) !== location) throw unsafe();
    };
    await check();
    return { parent, name, bound, check };
  } catch (error) { await parent.close(); throw error; }
}

async function assertMissing(bound: string): Promise<void> {
  const exists = await fs.lstat(bound).then(() => true, error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  });
  if (exists) throw new HttpError(409, 'A file or folder already exists there. Choose another path; existing contents were preserved.', 'FILE_EXISTS');
}

async function verifyWritten(handle: FileHandle, bound: string, image: GeneratedImageMetadata): Promise<BigIntStats> {
  const before = await handle.stat({ bigint: true });
  if (!before.isFile() || before.size !== BigInt(image.bytes)) throw new HttpError(409, 'The created image could not be verified. The original is preserved.', 'GENERATED_IMAGE_COPY_UNVERIFIED');
  const digest = createHash('sha256'), buffer = Buffer.allocUnsafe(64 * 1024);
  let total = 0;
  while (total <= image.bytes) {
    const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, image.bytes + 1 - total), total);
    if (!bytesRead) break;
    total += bytesRead; digest.update(buffer.subarray(0, bytesRead));
  }
  if (total !== image.bytes || digest.digest('hex') !== image.sha256
    || !same(before, await handle.stat({ bigint: true })) || !same(before, await fs.lstat(bound, { bigint: true }))) {
    throw new HttpError(409, 'The created image changed before it could be verified. Inspect the destination; its saved original is preserved.', 'GENERATED_IMAGE_COPY_UNVERIFIED');
  }
  return before;
}

export function generatedImageFileName(image: Pick<GeneratedImageMetadata, 'id' | 'mimeType'>): string {
  const extension = image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType === 'image/webp' ? 'webp' : 'png';
  return `generated-image-${image.id.slice(4, 16)}.${extension}`;
}

/** Bounded adapters around durable originals. This service does not own or expire
 * generated assets; only independent published downloads have a 24-hour TTL. */
export class GeneratedImageDeliveryService {
  private readonly stop = new AbortController();
  private readonly active = new Set<Promise<void>>();
  private closed?: Promise<void>;
  constructor(private readonly ctx: AppContext) {}

  private async operation<T>(signal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.stop.signal.aborted) throw closing();
    signal?.throwIfAborted();
    if (this.active.size >= MAX_ACTIVE) throw new HttpError(429, 'Other image copies are being prepared. Try again shortly.', 'GENERATED_IMAGE_DELIVERY_BUSY');
    let finish!: () => void;
    const done = new Promise<void>(resolve => { finish = resolve; });
    this.active.add(done);
    const combined = AbortSignal.any([this.stop.signal, ...(signal ? [signal] : [])]);
    try { return await work(combined); }
    catch (error) { if (combined.aborted) throw combined.reason; throw normalizeError(error); }
    finally { this.active.delete(done); finish(); }
  }

  async validateCopy(workspaceId: string, requested: GeneratedImageReference, target: GeneratedImageSaveInput,
    options: Pick<GeneratedImageSaveOptions, 'signal' | 'source'> = {}): Promise<GeneratedImageMetadata> {
    const selected = reference(workspaceId, requested), input = saveInput(target);
    return this.operation(options.signal, signal => withWorkspaceFileMutation(this.ctx.config.workspacesDir, workspaceId,
      () => getGeneratedImageService(this.ctx).withRead(workspaceId, selected, async ({ metadata }, ownedSignal) => {
        copyLimit(metadata, options.source);
        ownedSignal.throwIfAborted();
        const target = await destination(this.ctx, workspaceId, input.path);
        try { await assertMissing(target.bound); ownedSignal.throwIfAborted(); return metadata; }
        finally { await target.parent.close(); }
      }, { signal, ...(input.threadId === undefined ? {} : { threadId: input.threadId }) }), { signal }));
  }

  async save(workspaceId: string, requested: GeneratedImageReference, target: GeneratedImageSaveInput,
    options: GeneratedImageSaveOptions = {}): Promise<GeneratedImageSave> {
    const selected = reference(workspaceId, requested), input = saveInput(target);
    const source = options.source, beforeCommit = options.beforeCommit;
    // Acquire mutation admission before an asset lease. Permanent workspace
    // cleanup holds the removal gate while it aborts/drains asset readers.
    return this.operation(options.signal, signal => withWorkspaceFileMutation(this.ctx.config.workspacesDir, workspaceId,
      () => getGeneratedImageService(this.ctx).withRead(workspaceId, selected, async (image, ownedSignal) => {
        copyLimit(image.metadata, source);
        return this.copy(workspaceId, input.path, image, { signal: ownedSignal, source, beforeCommit });
      }, { signal, ...(input.threadId === undefined ? {} : { threadId: input.threadId }) }), { signal }));
  }

  private async copy(workspaceId: string, relative: string, image: GeneratedImageRead,
    options: GeneratedImageSaveOptions & { signal: AbortSignal }): Promise<GeneratedImageSave> {
    const { signal, source } = options, metadata = image.metadata;
    signal.throwIfAborted();
    const target = await destination(this.ctx, workspaceId, relative);
    const intent = { workspaceId, operationId: randomUUID(), paths: [relative] };
    let output: FileHandle | undefined, manual = false, committed = false;
    try {
      await assertMissing(target.bound);
      await options.beforeCommit?.(metadata);
      signal.throwIfAborted();
      if (image.bytes.length !== metadata.bytes || createHash('sha256').update(image.bytes).digest('hex') !== metadata.sha256) throw invalid();
      await target.check();
      signal.throwIfAborted();
      if (source !== 'agent') { manual = true; this.ctx.events.emit('workspace:manual-intent', { ...intent, phase: 'start' }); }
      signal.throwIfAborted();
      // This is the create-only commit boundary. Once it starts, drain the small
      // write and verification even if HTTP/Stop cancels; never delete an uncertain
      // durable destination, clobber a competing file, or discard the original.
      output = await fs.open(target.bound, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
      for (let offset = 0; offset < image.bytes.length;) {
        const result = await output.write(image.bytes, offset, Math.min(64 * 1024, image.bytes.length - offset), offset);
        if (!result.bytesWritten) throw new HttpError(507, 'Storage could not finish this image copy. Its saved original remains available.', 'GENERATED_IMAGE_STORAGE_FULL');
        offset += result.bytesWritten;
      }
      await output.sync();
      const final = await verifyWritten(output, target.bound, metadata);
      await target.check();
      committed = true;
      if (source !== 'agent') this.ctx.events.emit('workspace:changed', { workspaceId, paths: [relative] });
      return { image: metadata, path: relative, version: metadata.sha256,
        entry: { name: target.name, path: relative, kind: 'file', size: metadata.bytes, modifiedAt: final.mtime.toISOString() } };
    } finally {
      await output?.close().catch(() => undefined);
      await target.parent.close().catch(() => undefined);
      if (manual) this.ctx.events.emit('workspace:manual-intent', { ...intent, phase: 'end', committed });
    }
  }

  async download(workspaceId: string, requested: GeneratedImageReference, options: { signal?: AbortSignal } = {}): Promise<DownloadJob> {
    const selected = reference(workspaceId, requested);
    return this.operation(options.signal, async signal => {
      const downloads = getDownloadService(this.ctx);
      let accepted: DownloadJob | undefined;
      try {
        return await getGeneratedImageService(this.ctx).withRead(workspaceId, selected, async ({ metadata, bytes }, ownedSignal) => {
          ownedSignal.throwIfAborted();
          accepted = await downloads.prepareBytes(workspaceId, { fileName: generatedImageFileName(metadata), mimeType: metadata.mimeType,
            expectedVersion: metadata.sha256, sourceIdentity: { type: 'generated_image', id: metadata.id, sha256: metadata.sha256 } }, bytes, { signal: ownedSignal });
          // The descriptor and independently verified scratch now belong to the
          // ordinary download worker. No asset lease spans public network IO.
          return accepted;
        }, { signal });
      } catch (error) {
        if (accepted) await downloads.cancel(accepted.id).catch(() => undefined);
        throw error;
      }
    });
  }

  close(): Promise<void> {
    this.closed ??= (async () => { this.stop.abort(closing()); await Promise.all([...this.active]); })();
    return this.closed;
  }
}

const services = new WeakMap<AppContext, GeneratedImageDeliveryService>();
export function getGeneratedImageDeliveryService(ctx: AppContext): GeneratedImageDeliveryService {
  let service = services.get(ctx);
  if (!service) { service = new GeneratedImageDeliveryService(ctx); services.set(ctx, service); }
  return service;
}
export async function shutdownGeneratedImageDelivery(ctx: AppContext): Promise<void> { await services.get(ctx)?.close(); }

async function requestOperation<T>(req: Request, res: Response, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const abort = () => { if (!res.writableFinished) controller.abort(new HttpError(400, 'Image delivery was cancelled. Inspect any chosen destination before retrying.', 'GENERATED_IMAGE_DELIVERY_ABORTED')); };
  req.once('aborted', abort); res.once('close', abort);
  try { return await work(controller.signal); }
  finally { req.off('aborted', abort); res.off('close', abort); }
}

/** Mount behind the app's existing session and same-origin mutation middleware. */
export function createGeneratedImageDeliveryRouter(ctx: AppContext): Router {
  const router = Router(), service = getGeneratedImageDeliveryService(ctx);
  router.post('/workspaces/:workspaceId/generated-images/:id/download', async (req, res) => {
    if (!plainObject(req.body, ['sha256']) || typeof req.body.sha256 !== 'string' || !HASH.test(req.body.sha256) || Object.keys(req.query).length) throw invalid();
    const job = await requestOperation(req, res, signal => service.download(String(req.params.workspaceId), { id: String(req.params.id), sha256: req.body.sha256 }, { signal }));
    if (!res.destroyed) res.status(202).set('Location', `/api/downloads/${job.id}`).set('Cache-Control', 'private, no-store').json(job);
  });
  router.post('/workspaces/:workspaceId/generated-images/:id/save', async (req, res) => {
    if (!plainObject(req.body, ['sha256', 'path', 'threadId']) || typeof req.body.sha256 !== 'string' || !HASH.test(req.body.sha256) || Object.keys(req.query).length) throw invalid();
    const input = saveInput({ path: req.body.path, ...(req.body.threadId === undefined ? {} : { threadId: req.body.threadId }) } as GeneratedImageSaveInput);
    const saved = await requestOperation(req, res, signal => service.save(String(req.params.workspaceId), { id: String(req.params.id), sha256: req.body.sha256 }, input, { signal }));
    if (!res.destroyed) res.status(201).set('Cache-Control', 'private, no-store').json(saved);
  });
  return router;
}
