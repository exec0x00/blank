import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { lookup as lookupMime } from 'mime-types';
import type { AppContext } from '../context';
import { HttpError } from '../errors';
import { DOWNLOAD_RETENTION_MS, HuggingFaceDownloadBucket, publicDownloadUrl, uploadTime, validObjectPath, validateDownloadBucket } from './bucket';
import { openDownloadSource, snapshotDownloadSource, validateDownloadSource, type DownloadSource } from './snapshot';
import { createDownloadStaging } from './staging';
import { MAX_BUFFER_DOWNLOAD_BYTES, stageBufferDownloadSource } from './buffer-source';
import type { BucketObject, DownloadBucket, DownloadIssue, DownloadJob, DownloadServiceStatus, DownloadSourceIdentity, StoredDownloadJob } from './types';

const STORE_KEY = 'download-jobs-v1';
const ACTIVE_STATES = new Set(['queued', 'snapshotting', 'uploading']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_SAVED_JOBS = 2000;
const MAX_SUBSCRIBERS = 32;
const HISTORY_RETENTION_MS = 7 * DOWNLOAD_RETENTION_MS;

interface SavedState { format: 1; jobs: StoredDownloadJob[]; status?: DownloadServiceStatus }
interface QueuedJob { id: string; source: DownloadSource }
interface RunningJob { controller: AbortController; promise: Promise<void> }

/** Server-only input. Authentication and asset ownership are checked before opening the source. */
export interface DownloadSourceRequest {
  fileName: string;
  mimeType?: string;
  expectedVersion: string;
  sourceIdentity: DownloadSourceIdentity;
}
interface PreparedSourceMetadata {
  path: string;
  fileName: string;
  mimeType: string;
  expectedVersion?: string;
  source?: DownloadSourceIdentity;
}

export interface DownloadServiceOptions {
  bucket?: DownloadBucket;
  now?: () => number;
  cleanupIntervalMs?: number;
  cleanupTimeoutMs?: number;
  cleanupRetryMs?: number;
  startupAttempts?: number;
  startupRetryMs?: number;
  jobTimeoutMs?: number;
  concurrency?: number;
  maxQueued?: number;
}

const issue = (code: string, message: string): DownloadIssue => ({ code, message });
const interrupted = () => issue('DOWNLOAD_INTERRUPTED', 'The instance restarted while preparing this download. Select Download again.');
const expired = () => issue('DOWNLOAD_EXPIRED', 'This temporary download has expired. Select Download to prepare a new link.');
const cancelled = () => issue('DOWNLOAD_CANCELLED', 'Download preparation was cancelled.');

function safeIssue(error: unknown, fallback: DownloadIssue): DownloadIssue {
  if (error instanceof HttpError && error.code && new Set([
    'DOWNLOAD_BUCKET_REQUEST_FAILED', 'DOWNLOAD_FILE_CHANGED', 'DOWNLOAD_TOO_LARGE', 'DOWNLOAD_STORAGE_FULL',
    'VERSION_CONFLICT', 'UNSAFE_PATH', 'FILE_NOT_FOUND', 'NOT_A_FILE', 'DOWNLOAD_HOST_UNSUPPORTED',
    'DOWNLOAD_CLEANUP_FAILED', 'DOWNLOAD_TIMESTAMP_UNKNOWN',
  ]).has(error.code)) return issue(error.code, error.message);
  return fallback;
}

function downloadableObject(job: StoredDownloadJob): boolean {
  if (!job.objectPath || !validObjectPath(job.objectPath)) return false;
  const parts = job.objectPath.split('/');
  return parts.length === 3 && parts[0] === 'exports' && UUID.test(parts[1]) && parts[2] === job.fileName;
}

function sourceIdentity(value: unknown): DownloadSourceIdentity | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as DownloadSourceIdentity;
  if (Object.keys(source).some(key => !['type', 'id', 'sha256'].includes(key))
    || !['attachment', 'generated_image'].includes(source.type)
    || typeof source.id !== 'string' || !(source.type === 'attachment' ? /^file_[a-f0-9]{32}$/ : /^img_[a-f0-9]{64}$/).test(source.id)
    || typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256)) return undefined;
  return { type: source.type, id: source.id, sha256: source.sha256 };
}

function attachmentFileName(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim() && validObjectPath(value) && !value.includes('/')
    && Buffer.byteLength(value) <= 255 && !value.startsWith('.codex-write-');
}

function attachmentMime(value: unknown, fileName: string): string {
  const mime = value === undefined ? lookupMime(fileName) || 'application/octet-stream' : value;
  if (typeof mime !== 'string' || mime.length > 127 || !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(mime)) {
    throw new HttpError(400, 'Choose a file with a valid MIME type.', 'INVALID_DOWNLOAD_SOURCE');
  }
  const normalized = mime.toLowerCase();
  return ['text/html', 'application/xhtml+xml', 'image/svg+xml', 'text/xml', 'application/xml', 'text/javascript', 'application/javascript'].includes(normalized)
    || normalized.endsWith('+xml') ? 'application/octet-stream' : normalized;
}

/** One host service, with all authoritative job records in the ordinary public /data state store. */
export class DownloadService {
  private readonly bucket?: DownloadBucket;
  private readonly now: () => number;
  private readonly jobs = new Map<string, StoredDownloadJob>();
  private readonly queued: QueuedJob[] = [];
  private readonly running = new Map<string, RunningJob>();
  private readonly subscribers = new Set<() => void>();
  private readonly stop = new AbortController();
  private preparing = 0;
  private initializing?: Promise<void>;
  private initialized = false;
  private startupFailed = false;
  private closing = false;
  private temporary?: string;
  private cleanupPromise?: Promise<DownloadServiceStatus>;
  private cleanupTimer?: ReturnType<typeof setTimeout>;
  private nearestExpiry = Number.POSITIVE_INFINITY;
  private nextCleanupCheck = Number.POSITIVE_INFINITY;
  private readonly progressTimes = new Map<string, number>();
  private serviceStatus: DownloadServiceStatus = { enabled: false, ready: false, state: 'disabled', unknownTimestampCount: 0 };

  constructor(private readonly ctx: AppContext, private readonly options: DownloadServiceOptions = {}) {
    this.now = options.now ?? Date.now;
    const configuredBucket = ctx.config.downloadBucket;
    if (options.bucket || (configuredBucket && ctx.config.downloadToken)) {
      try {
        const bucketId = validateDownloadBucket(options.bucket?.id ?? configuredBucket!, ctx.config.bucket);
        this.bucket = options.bucket ?? new HuggingFaceDownloadBucket(bucketId, ctx.config.downloadToken!);
        this.serviceStatus = { enabled: true, ready: false, state: 'checking', bucket: bucketId, unknownTimestampCount: 0 };
      } catch {
        this.serviceStatus = {
          enabled: false, ready: false, state: 'error', unknownTimestampCount: 0,
          error: issue('DOWNLOAD_BUCKET_UNSAFE', 'The separate public download bucket is not safely configured. The data bucket is never used for temporary downloads.'),
        };
      }
    } else {
      this.serviceStatus.error = issue('DOWNLOADS_UNAVAILABLE', 'File downloads need the public download bucket and its server secret. Contact the workspace owner.');
    }
  }

  status(): DownloadServiceStatus { return structuredClone(this.serviceStatus); }

  initialize(): Promise<void> {
    if (!this.initializing) this.initializing = this.initializeOnce().catch(() => {
      // A broken download record must not take down the editor, terminal or other workspace services.
      // Do not overwrite prior state we could not safely read; an owner can repair it and restart.
      this.startupFailed = true;
      this.initialized = true;
      this.serviceStatus = {
        ...this.serviceStatus, ready: false, state: 'error',
        error: issue('DOWNLOAD_STATE_ERROR', 'Download state could not be read or saved. Restore writable storage and restart the instance.'),
      };
      this.ctx.events.emit('downloads:status', this.status());
    });
    return this.initializing;
  }

  private async initializeOnce(): Promise<void> {
    const saved = await this.ctx.store.read<SavedState | null>(STORE_KEY, null);
    if (saved !== null && (saved.format !== 1 || !Array.isArray(saved.jobs))) throw new Error('Invalid saved download state.');
    if (saved?.format === 1 && Array.isArray(saved.jobs)) {
      for (const candidate of saved.jobs.slice(-MAX_SAVED_JOBS)) {
        const job = this.readStoredJob(candidate);
        if (!job) continue;
        if (ACTIVE_STATES.has(job.state)) {
          job.state = 'failed'; job.error = interrupted(); job.updatedAt = this.isoNow();
          delete job.url;
        }
        this.jobs.set(job.id, job);
      }
    }
    if (this.bucket) {
      this.temporary = await createDownloadStaging(this.ctx.config.stateDir);
      // A bounded initial scan always finishes or reports a failure before the coordinator listens.
      const attempts = this.options.startupAttempts ?? 3;
      for (let attempt = 0; attempt < attempts && !this.closing; attempt++) {
        const status = await this.cleanup();
        if (status.ready) break;
        if (attempt + 1 < attempts) await delay((this.options.startupRetryMs ?? 500) * (attempt + 1), undefined, { signal: this.stop.signal }).catch(() => undefined);
      }
    }
    this.initialized = true;
    await this.persist().catch(() => undefined);
    this.scheduleCleanup();
  }

  private readStoredJob(value: unknown): StoredDownloadJob | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const job = value as StoredDownloadJob;
    if (!UUID.test(job.id) || typeof job.workspaceId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(job.workspaceId)
      || typeof job.path !== 'string' || !validObjectPath(job.path) || path.posix.basename(job.path) !== job.fileName
      || !Number.isSafeInteger(job.size) || job.size < 0 || typeof job.bucket !== 'string'
      || !['queued', 'snapshotting', 'uploading', 'ready', 'failed', 'cancelled', 'expired'].includes(job.state)
      || uploadTime(job.createdAt, this.now()) === undefined || uploadTime(job.updatedAt, this.now()) === undefined) return undefined;
    try { validateDownloadBucket(job.bucket, this.ctx.config.bucket); }
    catch { return undefined; }
    const source = job.source === undefined ? undefined : sourceIdentity(job.source);
    let mimeType = lookupMime(job.fileName) || 'application/octet-stream';
    if (job.source !== undefined) {
      if (!source || !attachmentFileName(job.fileName) || job.path !== job.fileName || job.expectedVersion !== source.sha256
        || (job.version !== undefined && job.version !== source.sha256)) return undefined;
      try { mimeType = attachmentMime(job.mimeType, job.fileName); } catch { return undefined; }
    }
    const clean: StoredDownloadJob = {
      id: job.id, workspaceId: job.workspaceId, path: job.path, fileName: job.fileName,
      mimeType, size: job.size, ...(source ? { source } : {}),
      state: job.state, bytesProcessed: Math.min(job.size, Math.max(0, Number.isFinite(job.bytesProcessed) ? job.bytesProcessed : 0)),
      createdAt: job.createdAt, updatedAt: job.updatedAt, bucket: job.bucket,
      ...(typeof job.version === 'string' && /^[0-9a-f]{64}$/.test(job.version) ? { version: job.version } : {}),
      ...(typeof job.expectedVersion === 'string' && /^[0-9a-f]{64}$/.test(job.expectedVersion) ? { expectedVersion: job.expectedVersion } : {}),
      ...(typeof job.objectPath === 'string' ? { objectPath: job.objectPath } : {}),
      ...(typeof job.remoteHash === 'string' && /^[a-f0-9]{64}$/i.test(job.remoteHash) ? { remoteHash: job.remoteHash } : {}),
    };
    if (!downloadableObject(clean)) delete clean.objectPath;
    const uploaded = uploadTime(job.uploadedAt, this.now());
    if (clean.objectPath && uploaded !== undefined) {
      clean.uploadedAt = new Date(uploaded).toISOString();
      clean.expiresAt = new Date(uploaded + DOWNLOAD_RETENTION_MS).toISOString();
    }
    if (clean.state === 'ready' && (!clean.version || !clean.objectPath || !clean.expiresAt)) {
      clean.state = 'failed'; clean.error = interrupted();
    }
    if (clean.state === 'ready' && Date.parse(clean.expiresAt!) <= this.now()) { clean.state = 'expired'; clean.error = expired(); }
    if (clean.state === 'failed' && !clean.error) clean.error = issue('DOWNLOAD_FAILED', 'This download could not be prepared. Select Download to try again.');
    if (clean.state === 'cancelled') clean.error = cancelled();
    if (clean.state === 'expired') clean.error = expired();
    return clean;
  }

  async prepare(workspaceId: string, input: { path: string; expectedVersion?: string }): Promise<DownloadJob> {
    this.assertPreparationAvailable();
    if (!input || typeof input.path !== 'string' || !input.path || input.path.length > 4096
      || (input.expectedVersion !== undefined && (typeof input.expectedVersion !== 'string' || !/^[0-9a-f]{64}$/.test(input.expectedVersion)))) {
      throw new HttpError(400, 'Choose a file and an optional valid saved version.', 'INVALID_DOWNLOAD');
    }
    const normalized = path.posix.normalize(input.path);
    return this.prepareWithSource(workspaceId, {
      path: normalized, fileName: path.posix.basename(normalized), mimeType: lookupMime(normalized) || 'application/octet-stream',
      ...(input.expectedVersion ? { expectedVersion: input.expectedVersion } : {}),
    }, () => openDownloadSource(this.ctx.workspaces, workspaceId, input.path));
  }

  /**
   * Takes ownership immediately, including validation/admission failure. Only server code may
   * supply this already-opened source; its private storage path is never saved or sent to clients.
   */
  async prepareSource(workspaceId: string, input: DownloadSourceRequest, source: DownloadSource): Promise<DownloadJob> {
    let transferred = false;
    try {
      this.assertPreparationAvailable();
      const metadata = this.sourceMetadata(input);
      return await this.prepareWithSource(workspaceId, metadata, async () => {
        await this.ctx.workspaces.get(workspaceId);
        transferred = true;
        return source;
      }, true);
    } finally { if (!transferred) await source.close(); }
  }

  /** Small authenticated generated assets join the same owned staging, queue,
   * immutable public publication and 24-hour expiry path as ordinary downloads.
   * No durable source path is accepted or retained by the download service. */
  async prepareBytes(workspaceId: string, input: DownloadSourceRequest, bytes: Buffer,
    options: { signal?: AbortSignal } = {}): Promise<DownloadJob> {
    this.assertPreparationAvailable();
    const metadata = this.sourceMetadata(input), signal = options.signal;
    if (metadata.source?.type !== 'generated_image') throw new HttpError(400, 'This download requires a verified generated-image reference.', 'INVALID_DOWNLOAD_SOURCE');
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BUFFER_DOWNLOAD_BYTES) {
      throw new HttpError(413, 'Generated-image downloads must be 8 MiB or smaller.', 'DOWNLOAD_TOO_LARGE');
    }
    signal?.throwIfAborted();
    // Do not retain a caller-owned mutable Buffer across workspace admission.
    const ownedBytes = Buffer.from(bytes);
    return this.prepareWithSource(workspaceId, metadata, async () => {
      signal?.throwIfAborted();
      await this.ctx.workspaces.get(workspaceId);
      signal?.throwIfAborted();
      return stageBufferDownloadSource(this.temporary!, ownedBytes, metadata.expectedVersion!, signal);
    }, true, signal);
  }

  private sourceMetadata(input: DownloadSourceRequest): PreparedSourceMetadata {
    const identity = sourceIdentity(input?.sourceIdentity);
    if (!input || !attachmentFileName(input.fileName) || !identity
      || typeof input.expectedVersion !== 'string' || input.expectedVersion !== identity.sha256
      || Object.keys(input).some(key => !['fileName', 'mimeType', 'expectedVersion', 'sourceIdentity'].includes(key))) {
      throw new HttpError(400, 'Choose a verified saved asset and its exact version.', 'INVALID_DOWNLOAD_SOURCE');
    }
    return { path: input.fileName, fileName: input.fileName, mimeType: attachmentMime(input.mimeType, input.fileName),
      expectedVersion: input.expectedVersion, source: identity };
  }

  private assertPreparationAvailable(): void {
    if (!this.initialized || this.closing) throw new HttpError(503, 'Downloads are starting or stopping. Try again shortly.', 'DOWNLOADS_UNAVAILABLE');
    if (!this.bucket) throw new HttpError(503, this.serviceStatus.error?.message ?? 'Downloads are not configured.', 'DOWNLOADS_UNAVAILABLE');
    if (!this.serviceStatus.ready) throw new HttpError(503, 'The download bucket cleanup has not completed. Try again shortly.', 'DOWNLOAD_CLEANUP_PENDING');
  }

  private async prepareWithSource(workspaceId: string, metadata: PreparedSourceMetadata, open: () => Promise<DownloadSource>, verify = false, signal?: AbortSignal): Promise<DownloadJob> {
    this.assertPreparationAvailable();
    signal?.throwIfAborted();
    if (this.queued.length + this.running.size + this.preparing >= (this.options.maxQueued ?? 16)) {
      throw new HttpError(429, 'Several files are already being prepared. Wait for a download to finish.', 'DOWNLOAD_QUEUE_FULL');
    }
    this.pruneHistory();
    if (this.jobs.size + this.preparing >= MAX_SAVED_JOBS) throw new HttpError(429, 'The download history is full. Wait for older links to expire.', 'DOWNLOAD_QUEUE_FULL');
    this.preparing++;
    let source: DownloadSource | undefined;
    let createdId: string | undefined;
    let persisted = false;
    try {
      source = await open();
      if (verify) await validateDownloadSource(source);
      signal?.throwIfAborted();
      if (this.closing || !this.serviceStatus.ready) throw new HttpError(503, 'Downloads are temporarily unavailable. Try again shortly.', 'DOWNLOAD_CLEANUP_PENDING');
      const now = this.isoNow();
      const job: StoredDownloadJob = {
        id: randomUUID(), workspaceId, ...metadata,
        size: source.size, state: 'queued', bytesProcessed: 0,
        createdAt: now, updatedAt: now, bucket: this.bucket!.id,
      };
      createdId = job.id;
      this.jobs.set(job.id, job);
      await this.persist();
      persisted = true;
      if (signal?.aborted) {
        job.state = 'cancelled'; job.updatedAt = this.isoNow(); job.error = cancelled();
        await this.persist();
        throw signal.reason;
      }
      if (this.closing || !this.serviceStatus.ready) {
        job.state = 'failed'; job.updatedAt = this.isoNow();
        job.error = this.closing ? interrupted() : issue('DOWNLOAD_CLEANUP_FAILED', 'Download cleanup is not ready. Try again shortly.');
        await this.persist();
        throw new HttpError(503, 'Downloads are temporarily unavailable. Try again shortly.', 'DOWNLOAD_CLEANUP_PENDING');
      }
      this.queued.push({ id: job.id, source });
      source = undefined;
      this.emit(job);
      setImmediate(() => this.pump());
      return this.publicJob(job);
    } catch (error) {
      if (createdId && !persisted) this.jobs.delete(createdId);
      throw error;
    } finally {
      this.preparing--;
      await source?.close();
    }
  }

  async get(id: string): Promise<DownloadJob> {
    const job = this.find(id);
    if (job.state === 'ready' && Date.parse(job.expiresAt ?? '') <= this.now()) {
      this.expire(job);
      await this.persist();
      this.scheduleCleanup();
    }
    return this.publicJob(job);
  }

  async cancel(id: string): Promise<DownloadJob> {
    const job = this.find(id);
    if (ACTIVE_STATES.has(job.state)) {
      this.running.get(id)?.controller.abort();
      const pendingIndex = this.queued.findIndex(item => item.id === id);
      if (pendingIndex >= 0) await this.queued.splice(pendingIndex, 1)[0].source.close();
      job.state = 'cancelled'; job.error = cancelled(); job.updatedAt = this.isoNow(); delete job.url;
      await this.persist(); this.emit(job);
      this.pump();
    }
    return this.publicJob(job);
  }

  /** Subscribers receive current complete state, so reconnect never depends on a missing event delta. */
  subscribe(id: string, listener: (job: DownloadJob) => void): () => void {
    const job = this.find(id);
    if (this.subscribers.size >= MAX_SUBSCRIBERS) throw new HttpError(429, 'Too many live download views are open.', 'DOWNLOAD_SUBSCRIBERS_FULL');
    const event = (value: DownloadJob) => { if (value.id === id) listener(value); };
    const unsubscribe = () => { this.ctx.events.off('download:changed', event); this.subscribers.delete(unsubscribe); };
    this.subscribers.add(unsubscribe);
    this.ctx.events.on('download:changed', event);
    listener(this.publicJob(job));
    return unsubscribe;
  }

  private find(id: string): StoredDownloadJob {
    const found = typeof id === 'string' && UUID.test(id) ? this.jobs.get(id) : undefined;
    if (!found) throw new HttpError(404, 'Download preparation was not found. Select Download again.', 'DOWNLOAD_NOT_FOUND');
    return found;
  }

  private publicJob(job: StoredDownloadJob): DownloadJob {
    const { bucket: _bucket, objectPath: _objectPath, expectedVersion: _expectedVersion, remoteHash: _remoteHash, ...result } = job;
    delete result.url;
    if (result.state === 'ready' && downloadableObject(job) && Date.parse(result.expiresAt ?? '') > this.now()) {
      result.url = publicDownloadUrl(job.bucket, job.objectPath!);
    } else if (result.state === 'ready') {
      result.state = 'expired'; result.error = expired();
    }
    return structuredClone(result);
  }

  private isoNow(): string { return new Date(this.now()).toISOString(); }

  private emit(job: StoredDownloadJob): void { this.ctx.events.emit('download:changed', this.publicJob(job)); }

  private async change(job: StoredDownloadJob, patch: Partial<StoredDownloadJob>): Promise<void> {
    Object.assign(job, patch, { updatedAt: this.isoNow() });
    await this.persist();
    this.emit(job);
  }

  private progress(job: StoredDownloadJob, bytes: number): void {
    if (!ACTIVE_STATES.has(job.state)) return;
    job.bytesProcessed = Math.min(job.size, Math.max(job.bytesProcessed, bytes));
    const now = this.now();
    if (now - (this.progressTimes.get(job.id) ?? 0) < 100 && bytes < job.size) return;
    this.progressTimes.set(job.id, now);
    job.updatedAt = this.isoNow();
    this.emit(job);
  }

  private pump(): void {
    if (this.closing || !this.serviceStatus.ready) return;
    while (this.queued.length > 0 && this.running.size < (this.options.concurrency ?? 1)) {
      const item = this.queued.shift()!;
      const job = this.jobs.get(item.id);
      if (!job || job.state !== 'queued') { void item.source.close(); continue; }
      const controller = new AbortController();
      const promise = this.run(job, item.source, controller).finally(() => {
        this.running.delete(item.id); this.progressTimes.delete(item.id); this.pump();
      });
      this.running.set(item.id, { controller, promise });
      void promise.catch(() => {
        this.ctx.events.emit('downloads:error', issue('DOWNLOAD_STATE_ERROR', 'A download state update failed. Inspect the download status.'));
      });
    }
  }

  private async run(job: StoredDownloadJob, source: DownloadSource, controller: AbortController): Promise<void> {
    const deadline = AbortSignal.timeout(this.options.jobTimeoutMs ?? 30 * 60 * 1000);
    const signal = AbortSignal.any([controller.signal, deadline, this.stop.signal]);
    const snapshotPath = path.join(this.temporary!, `${job.id}.snapshot`);
    try {
      signal.throwIfAborted();
      await this.change(job, { state: 'snapshotting', bytesProcessed: 0 });
      const captured = await snapshotDownloadSource({
        source, destination: snapshotPath, expectedVersion: job.expectedVersion, signal,
        onProgress: bytes => this.progress(job, bytes),
      });
      signal.throwIfAborted();
      job.version = captured.version;
      // Equal stat times alone do not prove equal bytes, particularly on the native data bucket.
      // Reuse only after hashing the freshly captured bytes and checking the remote object still exists.
      const existing = [...this.jobs.values()].find(candidate => candidate.id !== job.id && candidate.state === 'ready'
        && candidate.version === captured.version && candidate.fileName === job.fileName && candidate.size === job.size && candidate.mimeType === job.mimeType
        && candidate.bucket === this.bucket!.id && downloadableObject(candidate)
        && Date.parse(candidate.expiresAt ?? '') > this.now() + 30_000);
      if (existing) {
        const remote = await this.bucket!.get(existing.objectPath!, signal);
        signal.throwIfAborted();
        if (remote && remote.size === captured.size && uploadTime(remote.uploadedAt, this.now()) === Date.parse(existing.uploadedAt!)
          && (!existing.remoteHash || existing.remoteHash === remote.xetHash)) {
          await this.ready(job, remote, existing.objectPath!);
          return;
        }
      }
      signal.throwIfAborted();
      job.objectPath = `exports/${job.id}/${job.fileName}`;
      await this.change(job, { state: 'uploading', bytesProcessed: 0, version: captured.version });
      await this.requireHealthyBucket(signal);
      const remote = await this.bucket!.upload({
        objectPath: job.objectPath, snapshotPath, mimeType: job.mimeType, size: captured.size, signal,
        onProgress: bytes => this.progress(job, bytes),
        beforePublish: () => this.requireHealthyBucket(signal),
      });
      signal.throwIfAborted();
      await this.ready(job, remote, job.objectPath);
    } catch (error) {
      const problem = this.closing ? interrupted() : controller.signal.aborted ? cancelled()
        : deadline.aborted ? issue('DOWNLOAD_TIMEOUT', 'Preparing this file took too long. Try again with the saved file.')
          : safeIssue(error, issue('DOWNLOAD_BUCKET_REQUEST_FAILED', 'The file could not be prepared in the public download bucket. Try again shortly.'));
      await this.change(job, { state: controller.signal.aborted && !this.closing ? 'cancelled' : 'failed', error: problem });
    } finally {
      await source.close();
      await fs.rm(snapshotPath, { force: true }).catch(() => undefined);
      this.scheduleCleanup();
    }
  }

  private async ready(job: StoredDownloadJob, remote: BucketObject, objectPath: string): Promise<void> {
    const uploaded = uploadTime(remote.uploadedAt, this.now());
    if (remote.type !== 'file' || remote.path !== objectPath || remote.size !== job.size || uploaded === undefined) {
      throw new HttpError(502, 'The download bucket did not confirm a valid upload time. Try again shortly.', 'DOWNLOAD_TIMESTAMP_UNKNOWN');
    }
    const expiry = uploaded + DOWNLOAD_RETENTION_MS;
    if (expiry <= this.now()) throw new HttpError(502, 'This download expired while it was being prepared. Select Download again.', 'DOWNLOAD_BUCKET_REQUEST_FAILED');
    this.nearestExpiry = Math.min(this.nearestExpiry, expiry);
    this.scheduleCleanup();
    delete job.error;
    await this.change(job, {
      objectPath, state: 'ready', bytesProcessed: job.size,
      ...(remote.xetHash ? { remoteHash: remote.xetHash } : {}),
      uploadedAt: new Date(uploaded).toISOString(), expiresAt: new Date(expiry).toISOString(),
    });
  }

  private async requireHealthyBucket(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.cleanupPromise) {
      const cleanup = this.cleanupPromise;
      await new Promise<void>((resolve, reject) => {
        const aborted = () => { signal.removeEventListener('abort', aborted); reject(signal.reason); };
        signal.addEventListener('abort', aborted, { once: true });
        if (signal.aborted) { aborted(); return; }
        void cleanup.then(() => { signal.removeEventListener('abort', aborted); resolve(); }, error => { signal.removeEventListener('abort', aborted); reject(error); });
      });
    }
    signal.throwIfAborted();
    if (!this.serviceStatus.ready) {
      throw new HttpError(503, 'The download bucket cleanup has not completed. Try this download again after cleanup recovers.', 'DOWNLOAD_CLEANUP_FAILED');
    }
  }

  cleanup(): Promise<DownloadServiceStatus> {
    if (!this.bucket || this.closing || this.startupFailed) return Promise.resolve(this.status());
    if (!this.cleanupPromise) {
      const pending = this.performCleanup().finally(() => {
        if (this.cleanupPromise === pending) this.cleanupPromise = undefined;
        this.scheduleCleanup();
        this.pump();
      });
      this.cleanupPromise = pending;
    }
    return this.cleanupPromise;
  }

  private async performCleanup(): Promise<DownloadServiceStatus> {
    const started = this.now();
    const signal = AbortSignal.any([this.stop.signal, AbortSignal.timeout(this.options.cleanupTimeoutMs ?? 20_000)]);
    this.serviceStatus = { ...this.serviceStatus, ready: false, state: 'checking', unknownTimestampCount: 0 };
    delete this.serviceStatus.error;
    this.ctx.events.emit('downloads:status', this.status());
    const journal = path.join(this.temporary!, `cleanup-${randomUUID()}.jsonl`);
    const ownedAtStart = new Map<string, string[]>();
    // Only reconcile objects already ready when this scan began. An in-flight upload may commit
    // between listing pages, and remote timestamps can have lower precision than the host clock.
    for (const job of this.jobs.values()) if (job.state === 'ready' && job.objectPath) ownedAtStart.set(job.objectPath, [...(ownedAtStart.get(job.objectPath) ?? []), job.id]);
    const seen = new Set<string>();
    let journalHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
    let unknown = 0;
    let failures = 0;
    let nextExpiry = Number.POSITIVE_INFINITY;
    try {
      journalHandle = await fs.open(journal, 'wx', 0o600);
      let journalLines: string[] = [];
      // Finish every listing page before deleting anything. This also works with offset-based cursors.
      // A local journal bounds memory even when many expired objects accumulated while the Space slept.
      for await (const object of this.bucket!.list(signal)) {
        signal.throwIfAborted();
        if (object.type === 'directory') continue;
        if (object.type !== 'file' || !validObjectPath(object.path)) { unknown++; continue; }
        if (ownedAtStart.has(object.path)) seen.add(object.path);
        const uploaded = uploadTime(object.uploadedAt, this.now());
        if (uploaded === undefined) { unknown++; continue; }
        const expiry = uploaded + DOWNLOAD_RETENTION_MS;
        for (const id of ownedAtStart.get(object.path) ?? []) {
          const job = this.jobs.get(id)!;
          if (job.state === 'ready') {
            if (Date.parse(job.uploadedAt ?? '') !== uploaded || job.size !== object.size
              || (job.remoteHash && job.remoteHash !== object.xetHash) || expiry <= this.now()) this.expire(job);
          }
        }
        if (expiry <= this.now()) {
          journalLines.push(JSON.stringify({ path: object.path, uploadedAt: object.uploadedAt }));
          if (journalLines.length >= 100) { await journalHandle.writeFile(journalLines.join('\n') + '\n'); journalLines = []; }
        } else nextExpiry = Math.min(nextExpiry, expiry);
      }
      if (journalLines.length) await journalHandle.writeFile(journalLines.join('\n') + '\n');
      await journalHandle.close(); journalHandle = undefined;
      const journalInput = createReadStream(journal, { highWaterMark: 64 * 1024 });
      const lines = createInterface({ input: journalInput, crlfDelay: Infinity });
      let batch: { path: string; uploadedAt: string }[] = [];
      const removeBatch = async () => {
        signal.throwIfAborted();
        const pending = [...new Map(batch.map(item => [item.path, item])).values()]; batch = [];
        const requested = pending.map(item => item.path);
        const currentObjects = this.bucket!.getMany
          ? await this.bucket!.getMany(requested, signal)
          : (await Promise.all(requested.map(item => this.bucket!.get(item, signal)))).filter((item): item is BucketObject => !!item);
        const confirmed = new Map(currentObjects.map(item => [item.path, item]));
        const current: string[] = [];
        for (const previous of pending) {
          const object = confirmed.get(previous.path);
          if (!object) {
            for (const id of ownedAtStart.get(previous.path) ?? []) this.expire(this.jobs.get(id)!);
            continue;
          }
          const uploaded = uploadTime(object.uploadedAt, this.now());
          if (object.type !== 'file' || uploaded === undefined) { unknown++; continue; }
          if (uploaded + DOWNLOAD_RETENTION_MS > this.now()) { nextExpiry = Math.min(nextExpiry, uploaded + DOWNLOAD_RETENTION_MS); continue; }
          current.push(previous.path);
        }
        if (current.length === 0) return;
        const result = await this.bucket!.delete(current, signal);
        const expected = new Set(current);
        if (result.deleted.length + result.failed.length !== current.length
          || new Set([...result.deleted, ...result.failed]).size !== current.length
          || [...result.deleted, ...result.failed].some(item => !expected.has(item))) {
          throw new HttpError(502, 'The download bucket returned an incomplete cleanup result.', 'DOWNLOAD_CLEANUP_FAILED');
        }
        failures += result.failed.length;
        for (const objectPath of result.deleted) for (const id of ownedAtStart.get(objectPath) ?? []) this.expire(this.jobs.get(id)!);
      };
      try {
        for await (const line of lines) {
          signal.throwIfAborted();
          batch.push(JSON.parse(line) as { path: string; uploadedAt: string });
          if (batch.length === 100) await removeBatch();
        }
        if (batch.length) await removeBatch();
      } finally { lines.close(); journalInput.destroy(); }
      for (const [objectPath, ids] of ownedAtStart) if (!seen.has(objectPath)) for (const id of ids) {
        const job = this.jobs.get(id)!;
        if (job.state === 'ready' && Date.parse(job.uploadedAt ?? '') <= started) this.expire(job);
      }
      if (failures > 0) throw new HttpError(502, 'Some expired downloads could not be removed. Cleanup will retry automatically.', 'DOWNLOAD_CLEANUP_FAILED');
      if (unknown > 0) throw new HttpError(502, 'Some bucket objects have an unknown upload time and were kept. Cleanup will retry automatically.', 'DOWNLOAD_TIMESTAMP_UNKNOWN');
      this.serviceStatus = {
        enabled: true, ready: true, state: 'ready', bucket: this.bucket!.id,
        lastCleanupAt: this.isoNow(), unknownTimestampCount: 0,
      };
      this.nearestExpiry = Math.min(nextExpiry, ...[...this.jobs.values()].filter(job => job.state === 'ready').map(job => Date.parse(job.expiresAt!)));
    } catch (error) {
      this.serviceStatus = {
        ...this.serviceStatus, ready: false, state: 'error', unknownTimestampCount: unknown,
        error: safeIssue(error, issue('DOWNLOAD_CLEANUP_FAILED', 'The download bucket cleanup could not finish. Downloads will become available after an automatic retry.')),
      };
    } finally {
      await journalHandle?.close().catch(() => undefined);
      await fs.rm(journal, { force: true }).catch(() => undefined);
      this.pruneHistory();
      try { await this.persist(); }
      catch {
        this.serviceStatus = {
          ...this.serviceStatus, ready: false, state: 'error',
          error: issue('DOWNLOAD_STATE_ERROR', 'Download cleanup finished, but its state could not be saved. Downloads will retry after storage recovers.'),
        };
      }
      this.nextCleanupCheck = this.now() + (this.serviceStatus.ready ? this.options.cleanupIntervalMs ?? 5 * 60 * 1000 : this.options.cleanupRetryMs ?? 30_000);
      this.ctx.events.emit('downloads:status', this.status());
    }
    return this.status();
  }

  private expire(job: StoredDownloadJob): void {
    if (job.state !== 'ready' && job.state !== 'expired') return;
    if (job.state === 'expired') return;
    job.state = 'expired'; job.error = expired(); job.updatedAt = this.isoNow(); delete job.url;
    this.emit(job);
  }

  private scheduleCleanup(): void {
    if (this.cleanupTimer) { clearTimeout(this.cleanupTimer); this.cleanupTimer = undefined; }
    if (!this.initialized || this.closing || !this.bucket || this.cleanupPromise || this.startupFailed) return;
    // Completion of another job may bring an expiry closer, but must never push a periodic pass
    // farther into the future. Failed/cancelled uploads can leave objects needing discovery too.
    const interval = this.serviceStatus.ready
      ? Math.max(1, Math.min(this.nextCleanupCheck - this.now(), this.nearestExpiry - this.now()))
      : Math.max(1, this.nextCleanupCheck - this.now());
    this.cleanupTimer = setTimeout(() => { void this.cleanup().catch(() => undefined); }, interval);
    this.cleanupTimer.unref();
  }

  private pruneHistory(): void {
    const removable = [...this.jobs.values()].filter(job => !ACTIVE_STATES.has(job.state) && job.state !== 'ready')
      .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
    for (const job of removable) {
      if (this.jobs.size < MAX_SAVED_JOBS && Date.parse(job.updatedAt) > this.now() - HISTORY_RETENTION_MS) break;
      this.jobs.delete(job.id);
    }
  }

  private persist(): Promise<void> {
    return this.ctx.store.write<SavedState>(STORE_KEY, { format: 1, jobs: [...this.jobs.values()], status: this.status() }).catch(() => {
      this.serviceStatus = {
        ...this.serviceStatus, ready: false, state: 'error',
        error: issue('DOWNLOAD_STATE_ERROR', 'Download state could not be saved. Downloads will retry after storage recovers.'),
      };
      if (!Number.isFinite(this.nextCleanupCheck) || this.nextCleanupCheck <= this.now()) this.nextCleanupCheck = this.now() + (this.options.cleanupRetryMs ?? 30_000);
      this.ctx.events.emit('downloads:status', this.status());
      this.scheduleCleanup();
      throw new HttpError(503, 'Download state could not be saved. Try again after storage recovers.', 'DOWNLOAD_STATE_ERROR');
    });
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.stop.abort();
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
    for (const unsubscribe of this.subscribers) unsubscribe();
    for (const pending of this.queued.splice(0)) {
      await pending.source.close();
      const job = this.jobs.get(pending.id);
      if (job) { job.state = 'failed'; job.error = interrupted(); job.updatedAt = this.isoNow(); }
    }
    const pending = Promise.allSettled([...this.running.values()].map(item => item.promise).concat(this.cleanupPromise ? [this.cleanupPromise.then(() => undefined)] : []));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const completed = await Promise.race([
      pending.then(() => true),
      new Promise<false>(resolve => { timeout = setTimeout(() => resolve(false), 5_000); timeout.unref(); }),
    ]);
    if (timeout) clearTimeout(timeout);
    if (!this.startupFailed) await this.persist();
    if (completed && this.temporary) await fs.rm(this.temporary, { recursive: true, force: true });
  }
}
