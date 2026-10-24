import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { AppContext } from '../context';
import { HttpError } from '../errors';
import { DOWNLOAD_RETENTION_MS, PUBLIC_DOWNLOAD_BUCKET, uploadTime, validateDownloadBucket } from '../downloads/bucket';
import type { BucketObject } from '../downloads/types';
import { MAX_UPLOAD_BYTES } from '../workspaces';
import { acquireWorkspaceActivity } from '../worktrees/activity';
import { withWorkspaceFileMutation } from '../file-transfers/queue';
import { HuggingFaceUploadBucket, MAX_CAPABILITY_LIFETIME_MS, validateUploadCapability } from './bucket';
import { cleanUploadTemporary, installUploadFile, recoverUploadedFile, validateUploadDestination } from './install';
import type { StoredUploadJob, UploadBucket, UploadCapability, UploadIssue, UploadJob, UploadServiceStatus } from './types';
import { CONTENT_HASH, MAX_CAPABILITY_REQUESTS, plainObject, UPLOAD_ID, UPLOAD_SESSION_MS, uploadPath, validUploadObjectPath } from './validation';

const STORE_KEY = 'upload-jobs-v1';
const MAX_SAVED_JOBS = 2000;
const MAX_SCAN_OBJECTS = 50_000;
const ACTIVE = new Set(['reserved', 'queued', 'publishing', 'importing']);
const TERMINAL = new Set(['ready', 'failed', 'cancelled', 'expired']);
const HISTORY_MS = 7 * DOWNLOAD_RETENTION_MS;

interface SavedState { format: 1; jobs: StoredUploadJob[]; capabilityIssuedAt: number[] }
interface Running { controller: AbortController; promise: Promise<void> }

export interface UploadServiceOptions {
  bucket?: UploadBucket;
  now?: () => number;
  cleanupIntervalMs?: number;
  cleanupRetryMs?: number;
  cleanupTimeoutMs?: number;
  jobTimeoutMs?: number;
  capabilityTimeoutMs?: number;
  concurrency?: number;
  maxActiveSessions?: number;
}

const MESSAGES: Record<string, string> = {
  UPLOAD_INTERRUPTED: 'The instance restarted or stopped during this upload. Check the destination file and upload it again if needed.',
  UPLOAD_CANCELLED: 'Upload cancelled.',
  UPLOAD_SESSION_EXPIRED: 'This upload session expired. Select the file and upload it again.',
  UPLOAD_BUCKET_REQUEST_FAILED: 'Hugging Face could not complete this upload. Try again shortly.',
  UPLOAD_STAGE_CONFLICT: 'The temporary upload path changed. Select the file and upload it again.',
  UPLOAD_CONTENT_MISMATCH: 'The transferred file does not match the selected file. Upload it again.',
  UPLOAD_SIZE_MISMATCH: 'The transferred file size does not match the selected file. Upload it again.',
  UPLOAD_STORAGE_FULL: 'The workspace has insufficient storage for this upload.',
  UPLOAD_HOST_UNSUPPORTED: 'Secure file uploads require the Linux host used by this Space.',
  UPLOAD_TIMEOUT: 'This upload took too long. Select the file and upload it again.',
  UPLOAD_CLEANUP_FAILED: 'Temporary upload cleanup could not finish. Uploads will become available after an automatic retry.',
  UPLOAD_TIMESTAMP_UNKNOWN: 'Some temporary uploads have an unknown upload time and were kept. Cleanup will retry automatically.',
  UPLOAD_STATE_ERROR: 'Upload state could not be read or saved. Restore writable storage and restart the instance.',
  FILE_EXISTS: 'A file or folder already exists at this path. Rename it or choose another upload location.',
  FILE_NOT_FOUND: 'The destination folder no longer exists. Refresh and choose a folder.',
  WORKSPACE_NOT_FOUND: 'The destination workspace no longer exists.',
  UNSAFE_PATH: 'The destination folder changed or contains a symbolic link. Refresh and choose a workspace folder.',
  WORKTREE_BUSY: 'The repository checkout is being removed. Choose another workspace.',
};
const issue = (code: string, fallback = 'This upload could not be saved. Select the file and try again.'): UploadIssue => ({ code, message: MESSAGES[code] ?? fallback });
const safeIssue = (error: unknown): UploadIssue => error instanceof HttpError && error.code && MESSAGES[error.code]
  ? issue(error.code) : issue('UPLOAD_FAILED');

/** One authenticated app service. Durable JSON contains job metadata and issuance times, never tokens. */
export class UploadService {
  private readonly bucket?: UploadBucket;
  private readonly now: () => number;
  private readonly maxActive: number;
  private readonly concurrency: number;
  private readonly jobs = new Map<string, StoredUploadJob>();
  private readonly queue: string[] = [];
  private readonly running = new Map<string, Running>();
  private readonly committing = new Set<string>();
  private readonly capabilities = new Map<string, UploadCapability>();
  private readonly capabilityPending = new Map<string, Promise<UploadCapability>>();
  private bucketCapability?: UploadCapability;
  private bucketCapabilityPending?: Promise<UploadCapability>;
  private capabilityIssuedAt: number[] = [];
  private readonly stop = new AbortController();
  private initialization?: Promise<void>;
  private initialized = false;
  private startupFailed = false;
  private closing = false;
  private closingPromise?: Promise<void>;
  private preparing = 0;
  private mutationTail: Promise<void> = Promise.resolve();
  private cleanupPromise?: Promise<UploadServiceStatus>;
  private cleanupTimer?: ReturnType<typeof setTimeout>;
  private nextCleanupAt = Number.POSITIVE_INFINITY;
  private nearestExpiry = Number.POSITIVE_INFINITY;
  private statusValue: UploadServiceStatus;

  constructor(private readonly ctx: AppContext, private readonly options: UploadServiceOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxActive = Math.max(1, Math.min(16, Math.floor(options.maxActiveSessions ?? 8)));
    this.concurrency = Math.max(1, Math.min(4, this.maxActive, Math.floor(options.concurrency ?? 2)));
    this.statusValue = {
      enabled: false, ready: false, state: 'disabled', maxFileBytes: MAX_UPLOAD_BYTES,
      maxActiveSessions: this.maxActive, maxConcurrency: this.concurrency, sessionTtlMs: UPLOAD_SESSION_MS,
      unknownTimestampCount: 0,
    };
    if (options.bucket || (ctx.config.downloadBucket && ctx.config.downloadToken)) {
      try {
        const id = validateDownloadBucket(options.bucket?.id ?? ctx.config.downloadBucket!, ctx.config.bucket);
        this.bucket = options.bucket ?? new HuggingFaceUploadBucket(id, ctx.config.downloadToken!, globalThis.fetch, this.now);
        this.statusValue = { ...this.statusValue, enabled: true, state: 'checking', bucket: id };
      } catch {
        this.statusValue = { ...this.statusValue, state: 'error', error: issue('UPLOAD_BUCKET_UNSAFE', 'Uploads require the separate public transfer bucket. The workspace data bucket cannot be used for staging.') };
      }
    } else this.statusValue.error = issue('UPLOADS_UNAVAILABLE', 'File uploads need the public transfer bucket and its server secret. Contact the workspace owner.');
  }

  status(): UploadServiceStatus { return structuredClone(this.statusValue); }
  private isoNow(): string { return new Date(this.now()).toISOString(); }
  private expose(job: StoredUploadJob): UploadJob {
    const { xetHash: _xetHash, sha256: _sha256, capabilityRequests: _requests, publishStartedAt: _publish, commitStartedAt: _commit, ...safe } = job;
    return structuredClone(safe);
  }
  private emit(job: StoredUploadJob): void { this.ctx.events.emit(`upload:${job.id}`, this.expose(job)); }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  initialize(): Promise<void> {
    if (!this.initialization) this.initialization = this.initializeOnce().catch(() => {
      this.initialized = true; this.startupFailed = true;
      this.statusValue = { ...this.statusValue, ready: false, state: 'error', error: issue('UPLOAD_STATE_ERROR') };
      this.ctx.events.emit('uploads:status', this.status());
    });
    return this.initialization;
  }

  private async initializeOnce(): Promise<void> {
    const saved = await this.ctx.store.read<SavedState | null>(STORE_KEY, null);
    if (saved !== null && (saved.format !== 1 || !Array.isArray(saved.jobs) || saved.jobs.length > MAX_SAVED_JOBS
      || !Array.isArray(saved.capabilityIssuedAt) || saved.capabilityIssuedAt.length > 64)) throw new Error('Invalid upload state.');
    this.capabilityIssuedAt = (saved?.capabilityIssuedAt ?? []).filter(time => Number.isSafeInteger(time) && time <= this.now() + 60_000 && time > this.now() - MAX_CAPABILITY_LIFETIME_MS);
    for (const candidate of saved?.jobs ?? []) {
      const job = this.readStored(candidate);
      if (!job) continue;
      if (ACTIVE.has(job.state) && job.state !== 'reserved') {
        if (job.commitStartedAt && job.sha256) {
          try {
            const entry = await recoverUploadedFile(this.ctx.workspaces, job.workspaceId, job.path, job.size, job.sha256);
            if (entry) {
              job.state = 'ready'; job.entry = entry; job.version = job.sha256; job.bytesProcessed = job.size; delete job.error;
            } else { job.state = 'failed'; job.error = issue('UPLOAD_INTERRUPTED'); }
          } catch { job.state = 'failed'; job.error = issue('UPLOAD_INTERRUPTED'); }
        } else { job.state = 'failed'; job.error = issue('UPLOAD_INTERRUPTED'); }
        job.updatedAt = this.isoNow();
      }
      if (job.state === 'reserved' && Date.parse(job.sessionExpiresAt) <= this.now()) {
        job.state = 'expired'; job.updatedAt = this.isoNow(); job.error = issue('UPLOAD_SESSION_EXPIRED');
      }
      this.jobs.set(job.id, job);
      if (job.publishStartedAt || job.commitStartedAt) await cleanUploadTemporary(this.ctx.workspaces, job.workspaceId, job.path, job.id);
    }
    this.initialized = true;
    if (this.bucket) await this.cleanup();
    else await this.persist();
    this.scheduleCleanup();
  }

  private readStored(value: unknown): StoredUploadJob | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const job = value as StoredUploadJob;
    try {
      if (!UPLOAD_ID.test(job.id) || typeof job.workspaceId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(job.workspaceId)
        || uploadPath(job.path) !== job.path || path.posix.basename(job.path) !== job.fileName
        || job.objectPath !== `imports/${job.id}/${job.fileName}` || !validUploadObjectPath(job.objectPath)
        || job.bucket !== PUBLIC_DOWNLOAD_BUCKET || !Number.isSafeInteger(job.size) || job.size < 0 || job.size > MAX_UPLOAD_BYTES
        || (!ACTIVE.has(job.state) && !TERMINAL.has(job.state))
        || uploadTime(job.createdAt, this.now()) === undefined || uploadTime(job.updatedAt, this.now()) === undefined) return undefined;
      const clean: StoredUploadJob = {
        id: job.id, workspaceId: job.workspaceId, path: job.path, fileName: job.fileName, size: job.size,
        state: job.state, bucket: PUBLIC_DOWNLOAD_BUCKET, objectPath: job.objectPath,
        bytesProcessed: Math.min(job.size, Math.max(0, Number.isSafeInteger(job.bytesProcessed) ? job.bytesProcessed : 0)),
        createdAt: job.createdAt, updatedAt: job.updatedAt,
        sessionExpiresAt: new Date(Date.parse(job.createdAt) + UPLOAD_SESSION_MS).toISOString(),
        capabilityRequests: Number.isInteger(job.capabilityRequests) && job.capabilityRequests >= 0 ? Math.min(MAX_CAPABILITY_REQUESTS, job.capabilityRequests) : MAX_CAPABILITY_REQUESTS,
      };
      if (CONTENT_HASH.test(job.xetHash ?? '') && CONTENT_HASH.test(job.sha256 ?? '')) { clean.xetHash = job.xetHash; clean.sha256 = job.sha256; }
      for (const key of ['publishStartedAt', 'commitStartedAt', 'stagingRemovedAt'] as const) {
        if (uploadTime(job[key], this.now()) !== undefined) clean[key] = job[key];
      }
      const uploaded = uploadTime(job.uploadedAt, this.now());
      if (uploaded !== undefined) { clean.uploadedAt = new Date(uploaded).toISOString(); clean.expiresAt = new Date(uploaded + DOWNLOAD_RETENTION_MS).toISOString(); }
      if (clean.state === 'ready') {
        if (clean.sha256 && job.version === clean.sha256 && job.entry?.path === clean.path && job.entry.kind === 'file' && job.entry.size === clean.size
          && uploadTime(job.entry.modifiedAt, this.now()) !== undefined) {
          clean.version = clean.sha256;
          clean.entry = { name: clean.fileName, path: clean.path, kind: 'file', size: clean.size, modifiedAt: job.entry.modifiedAt };
        } else { clean.state = 'failed'; clean.error = issue('UPLOAD_INTERRUPTED'); }
      }
      if (clean.state === 'failed') clean.error = job.error?.code && MESSAGES[job.error.code] ? issue(job.error.code) : issue('UPLOAD_INTERRUPTED');
      if (clean.state === 'cancelled') clean.error = issue('UPLOAD_CANCELLED');
      if (clean.state === 'expired') clean.error = issue('UPLOAD_SESSION_EXPIRED');
      if (ACTIVE.has(clean.state) && clean.state !== 'reserved' && (!clean.xetHash || !clean.sha256)) return undefined;
      return clean;
    } catch { return undefined; }
  }

  private available(): void {
    if (!this.initialized || this.closing || !this.bucket) throw new HttpError(503, this.statusValue.error?.message ?? 'Uploads are starting or stopping. Try again shortly.', 'UPLOADS_UNAVAILABLE');
    if (!this.statusValue.ready) throw new HttpError(503, 'Temporary upload cleanup has not completed. Try again shortly.', 'UPLOAD_CLEANUP_PENDING');
  }
  private find(id: string): StoredUploadJob {
    if (!UPLOAD_ID.test(id)) throw new HttpError(404, 'Upload session not found.', 'UPLOAD_NOT_FOUND');
    const job = this.jobs.get(id);
    if (!job) throw new HttpError(404, 'Upload session not found.', 'UPLOAD_NOT_FOUND');
    return job;
  }
  private expireReservations(): void {
    for (const job of this.jobs.values()) if (job.state === 'reserved' && Date.parse(job.sessionExpiresAt) <= this.now()) {
      job.state = 'expired'; job.error = issue('UPLOAD_SESSION_EXPIRED'); job.updatedAt = this.isoNow();
      this.capabilities.delete(job.id); this.emit(job);
    }
  }

  async reserve(workspaceId: string, input: unknown): Promise<UploadJob> {
    this.available();
    if (!plainObject(input, ['path', 'size']) || typeof input.size !== 'number' || !Number.isSafeInteger(input.size) || input.size < 0) {
      throw new HttpError(400, 'An upload needs a relative path and its exact size in bytes.', 'UPLOAD_INVALID_INPUT');
    }
    if (input.size > MAX_UPLOAD_BYTES) throw new HttpError(413, 'Uploads must be no larger than 25 MB.', 'FILE_TOO_LARGE');
    const relative = uploadPath(input.path);
    this.expireReservations();
    if ([...this.jobs.values()].filter(job => ACTIVE.has(job.state)).length + this.preparing >= this.maxActive) {
      throw new HttpError(429, 'Too many uploads are active. Wait for an upload to finish.', 'UPLOAD_LIMIT');
    }
    this.preparing++;
    try {
      await this.ctx.workspaces.get(workspaceId);
      await validateUploadDestination(this.ctx.workspaces, workspaceId, relative);
      return await this.serialized(async () => {
        this.available(); this.expireReservations(); this.pruneHistory();
        if ([...this.jobs.values()].some(job => ACTIVE.has(job.state) && job.workspaceId === workspaceId && job.path === relative)) {
          throw new HttpError(409, 'Another upload is already using this destination. Wait for it to finish.', 'UPLOAD_DESTINATION_BUSY');
        }
        if (this.jobs.size >= MAX_SAVED_JOBS) throw new HttpError(429, 'Temporary upload storage is full. Wait for expiry cleanup.', 'UPLOAD_LIMIT');
        const id = randomUUID();
        const job: StoredUploadJob = {
          id, workspaceId, path: relative, fileName: path.posix.basename(relative), size: input.size as number,
          state: 'reserved', bucket: this.bucket!.id, objectPath: `imports/${id}/${path.posix.basename(relative)}`,
          bytesProcessed: 0, createdAt: this.isoNow(), updatedAt: this.isoNow(),
          sessionExpiresAt: new Date(this.now() + UPLOAD_SESSION_MS).toISOString(), capabilityRequests: 0,
        };
        this.jobs.set(id, job);
        try { await this.persist(); } catch (error) { this.jobs.delete(id); throw error; }
        this.emit(job); this.scheduleCleanup();
        return this.expose(job);
      });
    } finally { this.preparing--; }
  }

  async get(id: string): Promise<UploadJob> {
    if (!this.initialized) throw new HttpError(503, 'Uploads are starting. Try again shortly.', 'UPLOADS_UNAVAILABLE');
    const job = this.find(id);
    if (job.state === 'reserved' && Date.parse(job.sessionExpiresAt) <= this.now()) { this.expireReservations(); await this.persist(); }
    // A terminal result includes the final metadata write and release of workspace activity.
    if (TERMINAL.has(job.state)) await this.running.get(id)?.promise;
    return this.expose(job);
  }

  async capability(id: string): Promise<UploadCapability> {
    this.available();
    const job = this.find(id);
    if (job.state !== 'reserved' || Date.parse(job.sessionExpiresAt) <= this.now()) throw new HttpError(409, 'This upload session is no longer accepting file bytes.', 'UPLOAD_SESSION_CLOSED');
    const cached = this.capabilities.get(id);
    if (cached && cached.exp * 1000 > this.now() + 60_000) return { ...cached };
    const pending = this.capabilityPending.get(id);
    if (pending) return pending;
    const requested = this.issueCapability(job).finally(() => this.capabilityPending.delete(id));
    this.capabilityPending.set(id, requested);
    return requested;
  }

  private async issueCapability(job: StoredUploadJob): Promise<UploadCapability> {
    await this.serialized(async () => {
      this.available();
      if (job.state !== 'reserved' || Date.parse(job.sessionExpiresAt) <= this.now()) throw new HttpError(409, 'This upload session is closed.', 'UPLOAD_SESSION_CLOSED');
      if (job.capabilityRequests >= MAX_CAPABILITY_REQUESTS) {
        throw new HttpError(429, 'The temporary upload permission limit was reached. Try again later.', 'UPLOAD_CAPABILITY_LIMIT');
      }
      job.capabilityRequests++;
      await this.persist();
    });
    const received = await this.sharedBucketCapability(job.id);
    if (job.state !== 'reserved' || this.closing || Date.parse(job.sessionExpiresAt) <= this.now()
      || received.exp * 1000 > Date.parse(job.sessionExpiresAt)) {
      throw new HttpError(409, 'This upload session is closing or too near expiry. Select the file and upload it again.', 'UPLOAD_SESSION_CLOSED');
    }
    this.capabilities.set(job.id, received);
    return { ...received };
  }

  /**
   * HF capabilities already cover this one bucket, not individual upload paths. Reuse a still
   * valid capability for sequential files, while each reservation retains its own admission,
   * publication and expiry checks. The persistent quota counts provider issuances, not reuse.
   */
  private sharedBucketCapability(sessionId: string): Promise<UploadCapability> {
    if (this.bucketCapability && this.bucketCapability.exp * 1000 > this.now() + 60_000) return Promise.resolve({ ...this.bucketCapability });
    if (this.bucketCapabilityPending) return this.bucketCapabilityPending;
    this.bucketCapability = undefined;
    const pending = this.issueBucketCapability(sessionId).finally(() => {
      if (this.bucketCapabilityPending === pending) this.bucketCapabilityPending = undefined;
    });
    this.bucketCapabilityPending = pending;
    return pending;
  }

  private async issueBucketCapability(sessionId: string): Promise<UploadCapability> {
    await this.serialized(async () => {
      this.available();
      this.capabilityIssuedAt = this.capabilityIssuedAt.filter(time => time > this.now() - MAX_CAPABILITY_LIFETIME_MS);
      if (this.capabilityIssuedAt.length >= this.maxActive * MAX_CAPABILITY_REQUESTS) {
        throw new HttpError(429, 'The temporary upload permission limit was reached. Try again later.', 'UPLOAD_CAPABILITY_LIMIT');
      }
      // Persist before contacting HF, including ambiguous failed responses. Restart or repeated
      // cancellation must never reset the bound on temporary provider permissions.
      this.capabilityIssuedAt.push(this.now());
      await this.persist();
    });
    const signal = AbortSignal.any([this.stop.signal, AbortSignal.timeout(this.options.capabilityTimeoutMs ?? 30_000)]);
    let received: UploadCapability;
    try { received = validateUploadCapability(await this.bucket!.capability(sessionId, signal), this.now(), this.ctx.config.downloadToken); }
    catch { throw new HttpError(502, MESSAGES.UPLOAD_BUCKET_REQUEST_FAILED, 'UPLOAD_BUCKET_REQUEST_FAILED'); }
    signal.throwIfAborted();
    if (this.closing) throw new HttpError(503, 'Uploads are stopping. Try again shortly.', 'UPLOADS_UNAVAILABLE');
    this.bucketCapability = received;
    return { ...received };
  }

  async complete(id: string, input: unknown): Promise<UploadJob> {
    if (!plainObject(input, ['xetHash', 'sha256']) || typeof input.xetHash !== 'string' || !CONTENT_HASH.test(input.xetHash)
      || typeof input.sha256 !== 'string' || !CONTENT_HASH.test(input.sha256)) {
      throw new HttpError(400, 'Provide the Xet and SHA-256 hashes of this uploaded file.', 'UPLOAD_INVALID_INPUT');
    }
    return this.serialized(async () => {
      const job = this.find(id);
      if (job.xetHash || job.sha256) {
        if (job.xetHash !== input.xetHash || job.sha256 !== input.sha256) throw new HttpError(409, 'This upload was already submitted with different contents.', 'UPLOAD_ALREADY_SUBMITTED');
        return this.expose(job);
      }
      this.available();
      if (job.state !== 'reserved') throw new HttpError(409, 'This upload session is no longer accepting file bytes.', 'UPLOAD_SESSION_CLOSED');
      if (Date.parse(job.sessionExpiresAt) <= this.now()) {
        this.expireReservations(); await this.persist();
        throw new HttpError(410, MESSAGES.UPLOAD_SESSION_EXPIRED, 'UPLOAD_SESSION_EXPIRED');
      }
      job.xetHash = input.xetHash as string; job.sha256 = input.sha256 as string;
      job.state = 'queued'; job.updatedAt = this.isoNow(); this.capabilities.delete(id);
      try { await this.persist(); }
      catch (error) {
        // Admission has not reached the queue or provider. Restore the reservation so a retry
        // after storage recovery can durably admit this same session instead of observing a
        // permanently queued job that has no worker. Successfully admitted hashes stay immutable.
        job.state = 'reserved'; delete job.xetHash; delete job.sha256; job.updatedAt = this.isoNow(); this.emit(job);
        throw error;
      }
      this.queue.push(id); this.emit(job); this.pump();
      return this.expose(job);
    });
  }

  private pump(): void {
    while (!this.closing && this.running.size < this.concurrency && this.queue.length) {
      const id = this.queue.shift()!;
      const job = this.jobs.get(id);
      if (!job || job.state !== 'queued') continue;
      const controller = new AbortController();
      const promise = this.run(job, controller).finally(() => {
        this.running.delete(id); this.committing.delete(id); this.pump(); this.scheduleCleanup();
      });
      this.running.set(id, { controller, promise });
      void promise.catch(() => undefined);
    }
  }

  private checkPublished(job: StoredUploadJob, object: BucketObject): void {
    if (object.path !== job.objectPath || object.type !== 'file' || object.xetHash !== job.xetHash) throw new HttpError(409, MESSAGES.UPLOAD_STAGE_CONFLICT, 'UPLOAD_STAGE_CONFLICT');
    if (object.size !== job.size) throw new HttpError(409, MESSAGES.UPLOAD_SIZE_MISMATCH, 'UPLOAD_SIZE_MISMATCH');
    const uploaded = uploadTime(object.uploadedAt, this.now());
    if (uploaded === undefined) throw new HttpError(502, MESSAGES.UPLOAD_TIMESTAMP_UNKNOWN, 'UPLOAD_TIMESTAMP_UNKNOWN');
    if (uploaded + DOWNLOAD_RETENTION_MS <= this.now()) throw new HttpError(410, 'The staged upload expired. Upload the file again.', 'UPLOAD_SESSION_EXPIRED');
    if (job.uploadedAt && Date.parse(job.uploadedAt) !== uploaded) throw new HttpError(409, MESSAGES.UPLOAD_STAGE_CONFLICT, 'UPLOAD_STAGE_CONFLICT');
    job.uploadedAt = new Date(uploaded).toISOString(); job.expiresAt = new Date(uploaded + DOWNLOAD_RETENTION_MS).toISOString();
  }

  private async run(job: StoredUploadJob, controller: AbortController): Promise<void> {
    const timeout = AbortSignal.timeout(this.options.jobTimeoutMs ?? 10 * 60_000);
    const signal = AbortSignal.any([controller.signal, this.stop.signal, timeout]);
    let release: (() => void) | undefined;
    let manual = false;
    const intent = { workspaceId: job.workspaceId, operationId: job.id, paths: [job.path] };
    try {
      signal.throwIfAborted(); this.available();
      await validateUploadDestination(this.ctx.workspaces, job.workspaceId, job.path);
      job.state = 'publishing'; job.publishStartedAt = this.isoNow(); job.updatedAt = this.isoNow();
      await this.persist(); this.emit(job); signal.throwIfAborted();
      const previous = await this.bucket!.get(job.objectPath, signal);
      if (previous) this.checkPublished(job, previous);
      if (this.cleanupPromise) await this.cleanupPromise;
      this.available(); signal.throwIfAborted();
      const object = previous ?? await this.bucket!.publish({ objectPath: job.objectPath, xetHash: job.xetHash!, signal });
      this.checkPublished(job, object); signal.throwIfAborted();
      job.state = 'importing'; job.updatedAt = this.isoNow();
      await this.persist(); this.emit(job); this.scheduleCleanup();
      let lastProgress = 0;
      const bytes = await this.bucket!.read({
        objectPath: job.objectPath, size: job.size, xetHash: job.xetHash!, signal,
        onProgress: processed => {
          job.bytesProcessed = Math.max(job.bytesProcessed, Math.min(job.size, Math.max(0, Math.floor(processed))));
          if (this.now() - lastProgress >= 100 || processed === job.size) { lastProgress = this.now(); this.emit(job); }
        },
      });
      signal.throwIfAborted();
      if (bytes.length !== job.size) throw new HttpError(409, MESSAGES.UPLOAD_SIZE_MISMATCH, 'UPLOAD_SIZE_MISMATCH');
      if (createHash('sha256').update(bytes).digest('hex') !== job.sha256) throw new HttpError(409, MESSAGES.UPLOAD_CONTENT_MISMATCH, 'UPLOAD_CONTENT_MISMATCH');
      const current = await this.bucket!.get(job.objectPath, signal);
      if (!current) throw new HttpError(409, MESSAGES.UPLOAD_STAGE_CONFLICT, 'UPLOAD_STAGE_CONFLICT');
      this.checkPublished(job, current);
      signal.throwIfAborted();
      release = acquireWorkspaceActivity(this.ctx.config.workspacesDir, job.workspaceId, 'files');
      manual = true; this.ctx.events.emit('workspace:manual-intent', { ...intent, phase: 'start' });
      const entry = await withWorkspaceFileMutation(this.ctx.config.workspacesDir, job.workspaceId, () => installUploadFile({
        workspaces: this.ctx.workspaces, workspaceId: job.workspaceId, path: job.path, id: job.id,
        bytes, sha256: job.sha256!, signal,
        beforeCommit: async () => {
          signal.throwIfAborted();
          job.commitStartedAt = this.isoNow();
          await this.persist();
          signal.throwIfAborted();
          this.committing.add(job.id);
        },
      }));
      job.state = 'ready'; job.entry = entry; job.version = job.sha256; job.bytesProcessed = job.size;
      job.updatedAt = this.isoNow(); delete job.error;
      this.ctx.events.emit('workspace:changed', { workspaceId: job.workspaceId, paths: [job.path] });
      await this.persist(); this.emit(job);
    } catch (error) {
      // A completed create can survive a metadata-store failure. Never relabel those bytes as cancelled.
      if (job.state !== 'ready') {
        if (controller.signal.aborted && !this.committing.has(job.id)) { job.state = 'cancelled'; job.error = issue('UPLOAD_CANCELLED'); }
        else { job.state = 'failed'; job.error = this.stop.signal.aborted ? issue('UPLOAD_INTERRUPTED') : timeout.aborted ? issue('UPLOAD_TIMEOUT') : safeIssue(error); }
        job.updatedAt = this.isoNow();
      }
      await this.persist().catch(() => undefined); this.emit(job);
      if (job.publishStartedAt && job.state !== 'ready') this.nextCleanupAt = Math.min(this.nextCleanupAt, this.now() + 1);
    } finally {
      if (manual) this.ctx.events.emit('workspace:manual-intent', { ...intent, phase: 'end' });
      release?.(); this.capabilities.delete(job.id);
    }
  }

  async cancel(id: string): Promise<UploadJob> {
    const job = this.find(id);
    if (TERMINAL.has(job.state)) return this.expose(job);
    const running = this.running.get(id);
    if (running) {
      if (!this.committing.has(id)) running.controller.abort();
      await running.promise;
      return this.expose(job);
    }
    return this.serialized(async () => {
      const live = this.running.get(id);
      if (live) {
        if (!this.committing.has(id)) live.controller.abort();
        await live.promise;
      } else if (!TERMINAL.has(job.state)) {
        job.state = 'cancelled'; job.error = issue('UPLOAD_CANCELLED'); job.updatedAt = this.isoNow();
        this.capabilities.delete(id); await this.persist(); this.emit(job);
      }
      this.scheduleCleanup();
      return this.expose(job);
    });
  }

  cleanup(): Promise<UploadServiceStatus> {
    if (this.cleanupPromise) return this.cleanupPromise;
    if (!this.bucket || this.startupFailed || this.closing) return Promise.resolve(this.status());
    this.cleanupPromise = this.cleanupOnce().finally(() => { this.cleanupPromise = undefined; this.scheduleCleanup(); });
    return this.cleanupPromise;
  }

  private async cleanupOnce(): Promise<UploadServiceStatus> {
    const signal = AbortSignal.any([this.stop.signal, AbortSignal.timeout(this.options.cleanupTimeoutMs ?? 30_000)]);
    const objects: BucketObject[] = [];
    const publishedAtStart = new Set([...this.jobs.values()].filter(job => job.uploadedAt).map(job => job.id));
    let nextExpiry = Number.POSITIVE_INFINITY;
    let unknown = 0;
    try {
      this.expireReservations();
      // Complete pagination before deleting. Mutating a listed prefix can otherwise skip a page.
      let scanned = 0;
      const listedPaths = new Set<string>();
      for await (const object of this.bucket!.list(signal)) {
        signal.throwIfAborted();
        if (++scanned > MAX_SCAN_OBJECTS) throw new HttpError(503, MESSAGES.UPLOAD_CLEANUP_FAILED, 'UPLOAD_CLEANUP_FAILED');
        if (object.type === 'directory' || !validUploadObjectPath(object.path)) continue;
        if (listedPaths.has(object.path)) throw new Error('Repeated bucket listing entry.');
        listedPaths.add(object.path);
        if (object.type !== 'file' || !Number.isSafeInteger(object.size) || object.size < 0) { unknown++; continue; }
        objects.push(object);
      }
      const seen = new Set(objects.map(object => object.path));
      const byPath = new Map([...this.jobs.values()].map(job => [job.objectPath, job]));
      const expired: BucketObject[] = [];
      for (const object of objects) {
        const uploaded = uploadTime(object.uploadedAt, this.now());
        if (uploaded === undefined) { unknown++; continue; }
        const job = byPath.get(object.path);
        if (job?.uploadedAt && !job.stagingRemovedAt && (job.xetHash !== object.xetHash || Date.parse(job.uploadedAt) !== uploaded)) {
          // The original staging copy was replaced externally. Keep the permanent workspace result.
          job.stagingRemovedAt = this.isoNow();
        }
        if (job && !job.stagingRemovedAt && (!job.xetHash || job.xetHash === object.xetHash)) {
          job.uploadedAt ??= new Date(uploaded).toISOString();
          job.expiresAt ??= new Date(uploaded + DOWNLOAD_RETENTION_MS).toISOString();
        }
        const abandoned = job && job.xetHash === object.xetHash && ['failed', 'cancelled', 'expired'].includes(job.state) && !this.running.has(job.id);
        if (uploaded + DOWNLOAD_RETENTION_MS <= this.now() || abandoned) expired.push(object);
        else nextExpiry = Math.min(nextExpiry, uploaded + DOWNLOAD_RETENTION_MS);
      }
      let failed = 0;
      for (let start = 0; start < expired.length; start += 100) {
        const remove: string[] = [];
        for (const old of expired.slice(start, start + 100)) {
          signal.throwIfAborted();
          const current = await this.bucket!.get(old.path, signal);
          if (!current) { const job = byPath.get(old.path); if (job) job.stagingRemovedAt = this.isoNow(); continue; }
          const timestamp = uploadTime(current.uploadedAt, this.now());
          if (timestamp === undefined) { unknown++; continue; }
          // A replacement is never removed based on stale listing metadata.
          if (current.type !== 'file' || current.uploadedAt !== old.uploadedAt || current.xetHash !== old.xetHash || current.size !== old.size) {
            nextExpiry = Math.min(nextExpiry, Math.max(this.now() + 30_000, timestamp + DOWNLOAD_RETENTION_MS)); continue;
          }
          const job = byPath.get(old.path);
          const abandoned = job && job.xetHash === current.xetHash && ['failed', 'cancelled', 'expired'].includes(job.state) && !this.running.has(job.id);
          if (timestamp + DOWNLOAD_RETENTION_MS > this.now() && !abandoned) { nextExpiry = Math.min(nextExpiry, timestamp + DOWNLOAD_RETENTION_MS); continue; }
          remove.push(old.path);
        }
        if (!remove.length) continue;
        const result = await this.bucket!.delete(remove, signal);
        const all = [...result.deleted, ...result.failed];
        if (all.length !== remove.length || new Set(all).size !== all.length || all.some(value => !remove.includes(value))) throw new Error('Incomplete cleanup result.');
        failed += result.failed.length;
        for (const objectPath of result.deleted) { const job = byPath.get(objectPath); if (job) job.stagingRemovedAt = this.isoNow(); }
      }
      for (const job of this.jobs.values()) if (publishedAtStart.has(job.id) && !job.stagingRemovedAt && !seen.has(job.objectPath) && !this.running.has(job.id)) job.stagingRemovedAt = this.isoNow();
      if (failed) throw new HttpError(502, MESSAGES.UPLOAD_CLEANUP_FAILED, 'UPLOAD_CLEANUP_FAILED');
      if (unknown) throw new HttpError(502, MESSAGES.UPLOAD_TIMESTAMP_UNKNOWN, 'UPLOAD_TIMESTAMP_UNKNOWN');
      this.statusValue = { ...this.statusValue, enabled: true, ready: true, state: 'ready', lastCleanupAt: this.isoNow(), unknownTimestampCount: 0 };
      delete this.statusValue.error;
      this.nearestExpiry = nextExpiry;
    } catch (error) {
      this.statusValue = { ...this.statusValue, ready: false, state: 'error', unknownTimestampCount: unknown, error: safeIssue(error) };
      if (this.statusValue.error?.code === 'UPLOAD_FAILED') this.statusValue.error = issue('UPLOAD_CLEANUP_FAILED');
    }
    this.pruneHistory();
    await this.persist().catch(() => undefined);
    this.nextCleanupAt = this.now() + (this.statusValue.ready ? this.options.cleanupIntervalMs ?? 5 * 60_000 : this.options.cleanupRetryMs ?? 30_000);
    this.ctx.events.emit('uploads:status', this.status());
    return this.status();
  }

  private pruneHistory(): void {
    const candidates = [...this.jobs.values()].filter(job => TERMINAL.has(job.state) && (!job.publishStartedAt || job.stagingRemovedAt))
      .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
    for (const job of candidates) {
      if (this.jobs.size < MAX_SAVED_JOBS && Date.parse(job.updatedAt) > this.now() - HISTORY_MS) break;
      this.jobs.delete(job.id);
    }
  }

  private scheduleCleanup(): void {
    if (this.cleanupTimer) { clearTimeout(this.cleanupTimer); this.cleanupTimer = undefined; }
    if (!this.initialized || !this.bucket || this.closing || this.startupFailed || this.cleanupPromise) return;
    const reservationExpiry = Math.min(...[...this.jobs.values()].filter(job => job.state === 'reserved').map(job => Date.parse(job.sessionExpiresAt)));
    const stagedExpiry = Math.min(...[...this.jobs.values()].filter(job => job.expiresAt && !job.stagingRemovedAt).map(job => Date.parse(job.expiresAt!)));
    const target = this.statusValue.ready
      ? Math.min(this.nextCleanupAt, this.nearestExpiry, reservationExpiry, stagedExpiry)
      : this.nextCleanupAt;
    const delay = Math.max(1, Math.min(5 * 60_000, target - this.now()));
    this.cleanupTimer = setTimeout(() => { void this.cleanup().catch(() => undefined); }, delay);
    this.cleanupTimer.unref();
  }

  private async persist(): Promise<void> {
    try { await this.ctx.store.write<SavedState>(STORE_KEY, { format: 1, jobs: [...this.jobs.values()], capabilityIssuedAt: this.capabilityIssuedAt }); }
    catch {
      this.statusValue = { ...this.statusValue, ready: false, state: 'error', error: issue('UPLOAD_STATE_ERROR') };
      this.ctx.events.emit('uploads:status', this.status());
      throw new HttpError(503, MESSAGES.UPLOAD_STATE_ERROR, 'UPLOAD_STATE_ERROR');
    }
  }

  close(): Promise<void> {
    if (!this.closingPromise) this.closingPromise = this.closeOnce();
    return this.closingPromise;
  }

  private async closeOnce(): Promise<void> {
    this.closing = true; this.stop.abort();
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
    this.capabilities.clear();
    this.bucketCapability = undefined;
    for (const id of this.queue.splice(0)) {
      const job = this.jobs.get(id);
      if (job?.state === 'queued') { job.state = 'failed'; job.error = issue('UPLOAD_INTERRUPTED'); job.updatedAt = this.isoNow(); }
    }
    await Promise.allSettled([
      ...[...this.running.values()].map(value => value.promise), ...this.capabilityPending.values(),
      ...(this.cleanupPromise ? [this.cleanupPromise] : []), this.mutationTail,
    ]);
    // The at-most-25-MB filesystem commit cannot be interrupted safely. Drain it before the
    // worktree coordinator may remove a checkout; shutdown never returns with deferred writes.
    if (!this.startupFailed) await this.persist().catch(() => undefined);
  }
}
