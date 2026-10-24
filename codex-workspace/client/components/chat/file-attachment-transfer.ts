import type { FileAttachment, FileAttachmentUploadJob, UploadCapability } from '../../../shared/types';
import { api, ApiError, json } from '../../api';
import type { UploadWorkerEvent, UploadWorkerRequest, UploadWorkerResult } from '../../uploads.worker';

export const FILE_ATTACHMENT_LIMITS = { count: 8, fileBytes: 25 * 1024 * 1024, totalBytes: 50 * 1024 * 1024 } as const;
const BUCKET = 'alvin3y12/codex-downloads';
const HASH = /^[a-f0-9]{64}$/;
const JOB_STATES = new Set(['reserved', 'queued', 'publishing', 'importing', 'ready', 'failed', 'cancelled', 'expired']);
const TERMINAL_STATES = new Set(['ready', 'failed', 'cancelled', 'expired']);

export type FileAttachmentStage = 'queued' | 'reserving' | 'checking' | 'preparing' | 'uploading' | 'publishing' | 'importing' | 'cancelling' | 'ready' | 'failed' | 'cancelled' | 'unconfirmed' | 'paused' | 'removing';
export interface FileAttachmentProgress {
  stage: FileAttachmentStage;
  bytesUploaded: number;
  bytesImported: number;
  job?: FileAttachmentUploadJob;
  sha256?: string;
  attachment?: FileAttachment;
  error?: string;
  notice?: string;
}
export interface FileAttachmentUploadOptions {
  workspaceId: string;
  file: File;
  signal?: AbortSignal;
  /** Reconcile an interrupted reservation before transferring this file again. */
  previousJob?: FileAttachmentUploadJob;
  expectedSha256?: string;
  onProgress?: (progress: FileAttachmentProgress) => void;
}

export class FileAttachmentUploadError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'FileAttachmentUploadError'; }
}

const encoded = encodeURIComponent;
const aborted = () => new DOMException('File upload cancelled.', 'AbortError');
function checkSignal(signal?: AbortSignal) { if (signal?.aborted) throw aborted(); }
function failure(error: unknown): string {
  if (error instanceof ApiError || error instanceof FileAttachmentUploadError) return error.message.slice(0, 600);
  if (error instanceof TypeError) return 'Could not reach the upload service. Check your connection and try again.';
  return 'The file could not be attached. Try again.';
}
function transient(error: unknown): boolean {
  return error instanceof TypeError || error instanceof ApiError && (error.status === 408 || error.status === 429 || error.status >= 500)
    || error instanceof FileAttachmentUploadError && error.code === 'FILE_ATTACHMENT_REQUEST_TIMEOUT';
}

export function validAttachmentName(name: unknown): name is string {
  return typeof name === 'string' && !!name.trim() && name !== '.' && name !== '..'
    && new TextEncoder().encode(name).byteLength <= 255 && !/[/\\\u0000-\u001f\u007f]/.test(name) && !name.startsWith('.codex-write-');
}

/** Treat server descriptors as metadata, never as an arbitrary URL or HTML. */
export function validFileAttachment(value: FileAttachment, workspaceId: string): boolean {
  return !!value && /^file_[a-f0-9]{32}$/.test(value.id) && HASH.test(value.sha256) && value.workspaceId === workspaceId
    && validAttachmentName(value.name) && Number.isSafeInteger(value.bytes) && value.bytes >= 0 && value.bytes <= FILE_ATTACHMENT_LIMITS.fileBytes
    && typeof value.mimeType === 'string' && value.mimeType.length <= 127 && /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(value.mimeType)
    && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt));
}

export function validateAttachmentFile(file: File): void {
  if (!(file instanceof Blob) || !validAttachmentName(file.name)) {
    throw new FileAttachmentUploadError('FILE_ATTACHMENT_NAME_INVALID', 'Use a filename of up to 255 bytes without slashes or control characters.');
  }
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > FILE_ATTACHMENT_LIMITS.fileBytes) {
    throw new FileAttachmentUploadError('FILE_ATTACHMENT_TOO_LARGE', `${file.name} is too large. Each file can be up to 25 MiB.`);
  }
}

type UploadTarget = { workspaceId: string; name: string; size: number; id?: string; objectPath?: string; sha256?: string };
export function validateFileAttachmentJob(value: FileAttachmentUploadJob, target: UploadTarget): FileAttachmentUploadJob {
  if (!value || typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id) || target.id && value.id !== target.id
    || value.workspaceId !== target.workspaceId || value.name !== target.name || value.size !== target.size || !JOB_STATES.has(value.state)
    || value.bucket !== BUCKET || typeof value.objectPath !== 'string' || !value.objectPath.startsWith(`imports/${value.id}/`)
    || !/^imports\/[a-f0-9-]{36}\/[^/\\\u0000-\u001f\u007f]+$/.test(value.objectPath) || target.objectPath && value.objectPath !== target.objectPath
    || !Number.isSafeInteger(value.bytesProcessed) || value.bytesProcessed < 0 || value.bytesProcessed > target.size
    || typeof value.sessionExpiresAt !== 'string' || !Number.isFinite(Date.parse(value.sessionExpiresAt))) {
    throw new FileAttachmentUploadError('FILE_ATTACHMENT_RESPONSE_INVALID', 'The upload service returned an unexpected file status.');
  }
  if (value.state === 'ready' && (!value.attachment || !validFileAttachment(value.attachment, target.workspaceId)
    || value.attachment.bytes !== target.size || value.attachment.name !== target.name || target.sha256 && value.attachment.sha256 !== target.sha256)) {
    throw new FileAttachmentUploadError('FILE_ATTACHMENT_RESPONSE_INVALID', 'The upload service did not confirm the expected attachment.');
  }
  return value;
}

async function request<T>(path: string, options: RequestInit = {}, signal?: AbortSignal, timeoutMs = 20_000): Promise<T> {
  checkSignal(signal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try { return await api<T>(path, { ...options, signal: controller.signal }); }
  catch (error) {
    checkSignal(signal);
    if (controller.signal.aborted) throw new FileAttachmentUploadError('FILE_ATTACHMENT_REQUEST_TIMEOUT', 'The upload service took too long to respond. Try again.');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  checkSignal(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(aborted()); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Uses the existing isolated HF worker; file bodies never go to the app server. */
function transfer(file: File, job: FileAttachmentUploadJob, signal: AbortSignal | undefined, progress: (event: Extract<UploadWorkerEvent, { type: 'progress' }>) => void): Promise<UploadWorkerResult> {
  checkSignal(signal);
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL('../../uploads.worker.ts', import.meta.url), { type: 'module', name: 'chat-file-upload' }); }
    catch { reject(new FileAttachmentUploadError('FILE_ATTACHMENT_WORKER_UNAVAILABLE', 'This browser could not start a direct file upload. Reload and try again.')); return; }
    const controller = new AbortController();
    let settled = false;
    const capabilityRequests = new Set<number>();
    const finish = (error?: unknown, result?: UploadWorkerResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      controller.abort();
      worker.terminate();
      if (error !== undefined) reject(error); else resolve(result!);
    };
    const abort = () => finish(aborted());
    const invalid = () => finish(new FileAttachmentUploadError('FILE_ATTACHMENT_PROTOCOL_INVALID', 'The direct upload returned an invalid result.'));
    const timer = setTimeout(() => finish(new FileAttachmentUploadError('FILE_ATTACHMENT_TRANSFER_TIMEOUT', 'The direct upload took too long. Try again.')), 15 * 60_000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.addEventListener('error', event => { event.preventDefault(); finish(new FileAttachmentUploadError('FILE_ATTACHMENT_WORKER_FAILED', 'The browser stopped the upload. Reload and try again.')); });
    worker.addEventListener('messageerror', invalid);
    worker.addEventListener('message', (event: MessageEvent<UploadWorkerEvent>) => {
      if (settled) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return invalid();
      if (data.type === 'progress') {
        if (!['preparing', 'uploading'].includes(data.stage) || !Number.isSafeInteger(data.bytesUploaded) || data.bytesUploaded < 0 || data.bytesUploaded > file.size) return invalid();
        progress(data);
      } else if (data.type === 'capability') {
        if (!Number.isSafeInteger(data.requestId) || data.requestId < 1 || capabilityRequests.has(data.requestId) || capabilityRequests.size >= 8) return invalid();
        capabilityRequests.add(data.requestId);
        void request<UploadCapability>(`/file-attachment-uploads/${encoded(job.id)}/capability`, json('POST'), controller.signal).then(capability => {
          if (!settled) worker.postMessage({ type: 'capability', requestId: data.requestId, capability } satisfies UploadWorkerRequest);
        }).catch(error => finish(error));
      } else if (data.type === 'complete') {
        if (typeof data.xetHash !== 'string' || !HASH.test(data.xetHash) || typeof data.sha256 !== 'string' || !HASH.test(data.sha256)) return invalid();
        finish(undefined, { xetHash: data.xetHash, sha256: data.sha256 });
      } else if (data.type === 'error') {
        finish(new FileAttachmentUploadError(typeof data.code === 'string' ? data.code.slice(0, 80) : 'FILE_ATTACHMENT_TRANSFER_FAILED', typeof data.message === 'string' ? data.message.slice(0, 600) : 'The direct upload failed.'));
      } else invalid();
    });
    if (signal?.aborted) { abort(); return; }
    try { worker.postMessage({ type: 'start', file, bucket: job.bucket, objectPath: job.objectPath, reservationId: job.id } satisfies UploadWorkerRequest); }
    catch { finish(new FileAttachmentUploadError('FILE_ATTACHMENT_UNREADABLE', 'The browser could not read this file. Select it again.')); }
  });
}

/**
 * A ready result always comes from the server's verified durable import. A lost
 * publication response is reconciled, including when cancellation lost a race.
 */
export async function uploadFileAttachment(options: FileAttachmentUploadOptions): Promise<FileAttachmentProgress> {
  const { workspaceId, file, signal } = options;
  if (!workspaceId || workspaceId.length > 200) throw new FileAttachmentUploadError('FILE_ATTACHMENT_WORKSPACE_INVALID', 'Choose a workspace before attaching a file.');
  validateAttachmentFile(file);
  let job = options.previousJob;
  let sha256 = options.expectedSha256;
  let finalizationRequested = !!job && job.state !== 'reserved';
  let state: FileAttachmentProgress = { stage: 'queued', bytesUploaded: 0, bytesImported: 0, job, sha256 };
  const emit = (patch: Partial<FileAttachmentProgress>) => { state = { ...state, ...patch }; options.onProgress?.({ ...state }); };
  const target = (): UploadTarget => ({ workspaceId, name: file.name, size: file.size, id: job?.id, objectPath: job?.objectPath, sha256 });
  const apply = (value: FileAttachmentUploadJob, notice?: string) => {
    job = validateFileAttachmentJob(value, target());
    const stage: FileAttachmentStage = job.state === 'ready' ? 'ready' : job.state === 'failed' || job.state === 'expired' ? 'failed'
      : job.state === 'cancelled' ? 'cancelled' : job.state === 'importing' ? 'importing' : 'publishing';
    emit({ stage, job, sha256, bytesImported: job.bytesProcessed, attachment: job.state === 'ready' ? job.attachment : undefined,
      ...(job.state === 'ready' ? { bytesUploaded: file.size, bytesImported: file.size } : {}),
      error: job.state === 'failed' || job.state === 'expired' ? job.error?.message || 'The staged file could not be attached.' : undefined, notice });
  };
  const inspect = () => request<FileAttachmentUploadJob>(`/file-attachment-uploads/${encoded(job!.id)}`, {}, signal);
  try {
    checkSignal(signal);
    if (job) {
      validateFileAttachmentJob(job, target());
      emit({ stage: 'checking', notice: 'Checking the previous upload…' });
      let prior: FileAttachmentUploadJob | undefined;
      try { prior = validateFileAttachmentJob(await inspect(), target()); }
      catch (error) { if (!(error instanceof ApiError && (error.status === 404 || error.status === 410))) throw error; }
      if (prior && !TERMINAL_STATES.has(prior.state)) {
        prior = validateFileAttachmentJob(await request<FileAttachmentUploadJob>(`/file-attachment-uploads/${encoded(job.id)}`, json('DELETE'), signal), target());
        for (let attempt = 0; !TERMINAL_STATES.has(prior.state) && attempt < 8; attempt++) {
          await pause(700, signal);
          prior = validateFileAttachmentJob(await inspect(), target());
        }
      }
      if (prior?.state === 'ready') { apply(prior, 'The previous upload finished. Ready to send.'); return state; }
      if (prior && !TERMINAL_STATES.has(prior.state)) {
        emit({ stage: 'unconfirmed', job: prior, error: 'The previous upload is still being checked. Check its status again before retrying.', notice: undefined });
        return state;
      }
      job = undefined; sha256 = undefined; finalizationRequested = false;
      emit({ job: undefined, sha256: undefined, notice: undefined });
    }
    checkSignal(signal);
    emit({ stage: 'reserving', error: undefined });
    const mimeType = typeof file.type === 'string' && /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(file.type) && file.type.length <= 127 ? file.type : 'application/octet-stream';
    job = validateFileAttachmentJob(await request<FileAttachmentUploadJob>(`/workspaces/${encoded(workspaceId)}/file-attachments/uploads`, json('POST', { name: file.name, size: file.size, mimeType }), signal), target());
    if (job.state !== 'reserved' || Date.parse(job.sessionExpiresAt) <= Date.now()) throw new FileAttachmentUploadError('FILE_ATTACHMENT_RESERVATION_INVALID', 'The upload reservation is no longer available. Try again.');
    emit({ stage: 'preparing', job });
    const hashes = await transfer(file, job, signal, value => emit({ stage: value.stage, bytesUploaded: Math.max(state.bytesUploaded, value.bytesUploaded) }));
    sha256 = hashes.sha256;
    checkSignal(signal);
    emit({ stage: 'publishing', sha256, bytesUploaded: file.size });
    finalizationRequested = true;
    try { apply(await request<FileAttachmentUploadJob>(`/file-attachment-uploads/${encoded(job.id)}/complete`, json('POST', hashes), signal)); }
    catch (error) {
      checkSignal(signal);
      if (!transient(error)) throw error;
      emit({ notice: 'Connection interrupted. Checking whether the file was attached…' });
      const recovered = validateFileAttachmentJob(await inspect(), target());
      if (recovered.state === 'reserved') apply(await request<FileAttachmentUploadJob>(`/file-attachment-uploads/${encoded(job.id)}/complete`, json('POST', hashes), signal));
      else apply(recovered);
    }
    const deadline = Date.now() + 10 * 60_000;
    let failures = 0;
    while (!TERMINAL_STATES.has(job.state)) {
      if (Date.now() >= deadline) throw new FileAttachmentUploadError('FILE_ATTACHMENT_IMPORT_TIMEOUT', 'The upload service did not confirm attaching this file in time.');
      await pause(failures ? 1500 : 700, signal);
      try { apply(await inspect()); failures = 0; }
      catch (error) {
        checkSignal(signal);
        if (!transient(error) || ++failures >= 3) throw error;
        emit({ notice: 'Connection interrupted. Checking whether the file was attached…' });
      }
    }
  } catch (error) {
    let outcome: FileAttachmentUploadJob | undefined;
    if (job) {
      if (signal?.aborted) emit({ stage: 'cancelling', notice: 'Checking whether the file finished before cancellation…' });
      // Cleanup has a separate bounded signal so an abort cannot hide a commit.
      try { outcome = validateFileAttachmentJob(await request<FileAttachmentUploadJob>(`/file-attachment-uploads/${encoded(job.id)}`, json('DELETE'), undefined, 6000), target()); }
      catch { try { outcome = validateFileAttachmentJob(await request<FileAttachmentUploadJob>(`/file-attachment-uploads/${encoded(job.id)}`, {}, undefined, 6000), target()); } catch { /* Explicitly unconfirmed below. */ } }
    }
    if (outcome?.state === 'ready') apply(outcome, signal?.aborted ? 'Attached before cancellation took effect.' : 'The file was attached; confirmation was delayed.');
    else if (finalizationRequested && (!outcome || !TERMINAL_STATES.has(outcome.state))) emit({ stage: 'unconfirmed', error: 'Could not confirm whether this file was attached. Check its status before retrying.', notice: undefined });
    else if (signal?.aborted) {
      if (outcome?.state === 'failed') apply(outcome);
      else emit({ stage: 'cancelled', ...(outcome ? { job: outcome } : {}), error: undefined, notice: 'Upload cancelled. Retry or remove this file.' });
    } else emit({ stage: 'failed', ...(outcome ? { job: outcome } : {}), error: failure(error), notice: undefined });
  }
  return { ...state };
}
