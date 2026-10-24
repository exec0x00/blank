import type { UploadCapability, UploadJob, UploadServiceStatus } from '../shared/types';
import { ApiError, api, json } from './api';
import type { UploadWorkerEvent, UploadWorkerRequest, UploadWorkerResult } from './uploads.worker';

export const MAX_WORKSPACE_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_WORKSPACE_UPLOAD_FILES = 50;
export const MAX_WORKSPACE_FOLDER_UPLOAD_FILES = 1000;
export const MAX_WORKSPACE_UPLOAD_TOTAL_BYTES = 250 * 1024 * 1024;
const TRANSFER_BUCKET = 'alvin3y12/codex-downloads';
const HASH = /^[a-f0-9]{64}$/;
const TERMINAL_JOBS = new Set(['ready', 'failed', 'cancelled', 'expired']);
const JOB_STATES = new Set(['reserved', 'queued', 'publishing', 'importing', ...TERMINAL_JOBS]);

export type WorkspaceUploadStage = 'queued' | 'reserving' | 'preparing' | 'uploading' | 'publishing' | 'importing' | 'cancelling' | 'ready' | 'failed' | 'cancelled' | 'unconfirmed';

export interface WorkspaceUploadProgress {
  id: string;
  index: number;
  fileName: string;
  path: string;
  size: number;
  stage: WorkspaceUploadStage;
  /** Source bytes acknowledged or deduplicated by the official upload SDK. */
  bytesUploaded: number;
  /** Bytes the server has received from the published staging copy. */
  bytesImported: number;
  jobId?: string;
  error?: string;
  errorCode?: string;
  notice?: string;
  expiresAt?: string;
}

export interface WorkspaceUploadResult {
  files: WorkspaceUploadProgress[];
  uploaded: number;
  failed: number;
  cancelled: number;
  unconfirmed: number;
}

export interface WorkspaceUploadOptions {
  workspaceId: string;
  directory: string;
  files: readonly File[];
  /** Preplanned paths beneath directory, one per file. Parents must exist. */
  relativePaths?: readonly string[];
  signal?: AbortSignal;
  onProgress?: (files: WorkspaceUploadProgress[]) => void;
  /** Check open dirty/conflicted buffers immediately before reserving and finalizing. */
  checkTarget?: (path: string) => void;
}

export class WorkspaceUploadError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'WorkspaceUploadError'; }
}

export function isWorkspaceUploadActive(file: WorkspaceUploadProgress): boolean {
  return !['ready', 'failed', 'cancelled', 'unconfirmed'].includes(file.stage);
}

function aborted(): DOMException { return new DOMException('Upload cancelled.', 'AbortError'); }
function throwIfAborted(signal?: AbortSignal) { if (signal?.aborted) throw aborted(); }

async function request<T>(path: string, options: RequestInit = {}, signal?: AbortSignal, timeoutMs = 20_000): Promise<T> {
  throwIfAborted(signal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try { return await api<T>(path, { ...options, signal: controller.signal }); }
  catch (error) {
    throwIfAborted(signal);
    if (controller.signal.aborted) throw new WorkspaceUploadError('UPLOAD_REQUEST_TIMEOUT', 'The upload service took too long to respond. Check your connection and try again.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const done = () => { signal?.removeEventListener('abort', stop); resolve(); };
    const timer = setTimeout(done, ms);
    const stop = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); reject(aborted()); };
    signal?.addEventListener('abort', stop, { once: true });
  });
}

function failure(error: unknown): { error: string; errorCode: string } {
  if (error instanceof ApiError || error instanceof WorkspaceUploadError) {
    const code = error.code || 'UPLOAD_FAILED';
    if (code === 'FILE_EXISTS' || code === 'UPLOAD_FILE_EXISTS') return { error: 'A file already exists at this path. Rename the upload before trying again.', errorCode: code };
    return { error: error.message.slice(0, 600), errorCode: code };
  }
  if (error instanceof TypeError) return { error: 'Could not reach the upload service. Check your connection and try again.', errorCode: 'UPLOAD_NETWORK_ERROR' };
  return { error: 'The upload could not finish. Check the destination folder before trying again.', errorCode: 'UPLOAD_FAILED' };
}

function validateDirectory(directory: string): void {
  if (typeof directory !== 'string' || directory.length > 2048 || /[\\\u0000-\u001f\u007f]/.test(directory)
    || (directory !== '' && directory.split('/').some(part => !part || part === '.' || part === '..'))) {
    throw new WorkspaceUploadError('UPLOAD_PATH_INVALID', 'Choose a folder inside this workspace before uploading.');
  }
}

function validateFile(file: File, maxBytes: number): void {
  if (!(file instanceof Blob) || typeof file.name !== 'string' || !file.name || file.name === '.' || file.name === '..'
    || /[/\\\u0000-\u001f\u007f]/.test(file.name) || new TextEncoder().encode(file.name).byteLength > 255) {
    throw new WorkspaceUploadError('UPLOAD_NAME_INVALID', 'This filename cannot be used in the workspace. Rename it before uploading.');
  }
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > maxBytes) {
    throw new WorkspaceUploadError('UPLOAD_TOO_LARGE', `This file exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MB upload limit.`);
  }
}

function validateJob(value: UploadJob, target: { workspaceId: string; path: string; size: number; id?: string; objectPath?: string; sha256?: string }): UploadJob {
  if (!value || typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id) || (target.id && value.id !== target.id)
    || value.workspaceId !== target.workspaceId || value.path !== target.path || value.size !== target.size || !JOB_STATES.has(value.state)
    || value.bucket !== TRANSFER_BUCKET || typeof value.objectPath !== 'string' || !value.objectPath.startsWith(`imports/${value.id}/`)
    || (target.objectPath && value.objectPath !== target.objectPath) || !Number.isFinite(Date.parse(value.sessionExpiresAt))
    || !Number.isSafeInteger(value.bytesProcessed) || value.bytesProcessed < 0 || value.bytesProcessed > target.size) {
    throw new WorkspaceUploadError('UPLOAD_RESPONSE_INVALID', 'The upload service returned an unexpected file status.');
  }
  if (value.state === 'ready' && (!value.entry || value.entry.kind !== 'file' || value.entry.path !== target.path
    || value.entry.size !== target.size || typeof value.version !== 'string' || !HASH.test(value.version)
    || (target.sha256 && value.version !== target.sha256))) {
    throw new WorkspaceUploadError('UPLOAD_RESPONSE_INVALID', 'The upload service did not confirm the expected saved file.');
  }
  return value;
}

/** Creates one disposable worker; no capability is kept in UI state or storage. */
function transferFile(file: File, job: UploadJob, signal: AbortSignal | undefined, onProgress: (event: Extract<UploadWorkerEvent, { type: 'progress' }>) => void): Promise<UploadWorkerResult> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL('./uploads.worker.ts', import.meta.url), { type: 'module', name: 'workspace-file-upload' }); }
    catch { reject(new WorkspaceUploadError('UPLOAD_WORKER_UNAVAILABLE', 'The browser could not start the upload. Reload the workspace and try again.')); return; }
    const controller = new AbortController();
    let settled = false;
    let capabilityRequests = 0;
    const requested = new Set<number>();
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
    const timer = setTimeout(() => finish(new WorkspaceUploadError('UPLOAD_TRANSFER_TIMEOUT', 'The direct upload took too long. Try the upload again.')), 15 * 60_000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.addEventListener('error', event => { event.preventDefault(); finish(new WorkspaceUploadError('UPLOAD_WORKER_FAILED', 'The browser stopped the upload before it finished. Reload the workspace and try again.')); });
    worker.addEventListener('messageerror', () => finish(new WorkspaceUploadError('UPLOAD_WORKER_FAILED', 'The browser could not read the upload result. Try the upload again.')));
    worker.addEventListener('message', (event: MessageEvent<UploadWorkerEvent>) => {
      if (settled) return;
      const message = event.data;
      if (!message || typeof message !== 'object') return finish(new WorkspaceUploadError('UPLOAD_PROTOCOL_INVALID', 'The upload returned an invalid result.'));
      if (message.type === 'progress') {
        if (!['preparing', 'uploading'].includes(message.stage) || !Number.isSafeInteger(message.bytesUploaded) || message.bytesUploaded < 0 || message.bytesUploaded > file.size) {
          return finish(new WorkspaceUploadError('UPLOAD_PROTOCOL_INVALID', 'The upload returned invalid progress.'));
        }
        onProgress(message);
      } else if (message.type === 'capability') {
        if (!Number.isSafeInteger(message.requestId) || message.requestId < 1 || requested.has(message.requestId) || ++capabilityRequests > 8) {
          return finish(new WorkspaceUploadError('UPLOAD_PROTOCOL_INVALID', 'The upload requested an invalid temporary capability.'));
        }
        requested.add(message.requestId);
        void request<UploadCapability>(`/uploads/${encodeURIComponent(job.id)}/capability`, json('POST'), controller.signal).then(capability => {
          if (!settled) worker.postMessage({ type: 'capability', requestId: message.requestId, capability } satisfies UploadWorkerRequest);
        }).catch(error => finish(error));
      } else if (message.type === 'complete') {
        if (!HASH.test(message.xetHash) || !HASH.test(message.sha256)) return finish(new WorkspaceUploadError('UPLOAD_PROTOCOL_INVALID', 'The upload did not return valid file integrity checks.'));
        finish(undefined, { xetHash: message.xetHash, sha256: message.sha256 });
      } else if (message.type === 'error') {
        finish(new WorkspaceUploadError(typeof message.code === 'string' ? message.code.slice(0, 80) : 'UPLOAD_TRANSFER_FAILED', typeof message.message === 'string' ? message.message.slice(0, 600) : 'The direct upload failed.'));
      } else finish(new WorkspaceUploadError('UPLOAD_PROTOCOL_INVALID', 'The upload returned an unexpected result.'));
    });
    if (signal?.aborted) { abort(); return; }
    try { worker.postMessage({ type: 'start', file, bucket: job.bucket, objectPath: job.objectPath, reservationId: job.id } satisfies UploadWorkerRequest); }
    catch { finish(new WorkspaceUploadError('UPLOAD_FILE_UNREADABLE', 'The browser could not read this file. Select it again and retry.')); }
  });
}

function transient(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 408 || error.status === 429 || error.status >= 500;
  if (error instanceof WorkspaceUploadError) return error.code === 'UPLOAD_REQUEST_TIMEOUT';
  return error instanceof TypeError;
}

/**
 * Uploads selected files sequentially without ever sending file bytes to /api.
 * Existing paths are create-only on the server. Abort on workspace switch/lock;
 * retain this result until errors have been shown or explicitly dismissed.
 */
export async function uploadWorkspaceFiles(options: WorkspaceUploadOptions): Promise<WorkspaceUploadResult> {
  const { workspaceId, directory, files, signal } = options;
  if (!workspaceId || workspaceId.length > 200) throw new WorkspaceUploadError('UPLOAD_WORKSPACE_INVALID', 'Choose a workspace before uploading.');
  validateDirectory(directory);
  const maxFiles = options.relativePaths ? MAX_WORKSPACE_FOLDER_UPLOAD_FILES : MAX_WORKSPACE_UPLOAD_FILES;
  if (files.length > maxFiles) throw new WorkspaceUploadError('UPLOAD_BATCH_TOO_LARGE', `Choose no more than ${maxFiles} files at a time.`);
  if (options.relativePaths !== undefined) {
    if (!Array.isArray(options.relativePaths) || options.relativePaths.length !== files.length) throw new WorkspaceUploadError('UPLOAD_PATHS_INVALID', 'Every selected file needs its own planned destination. Select the folder again.');
    for (let index = 0; index < options.relativePaths.length; index++) {
      const path = options.relativePaths[index];
      validateDirectory(path);
      if (!path || path.split('/').at(-1) !== files[index].name || path.split('/').length > 32
        || path.split('/').some((part: string) => new TextEncoder().encode(part).byteLength > 255)) throw new WorkspaceUploadError('UPLOAD_PATH_INVALID', 'A selected file has an invalid relative destination. Select the folder again.');
      validateDirectory(`${directory ? `${directory}/` : ''}${path}`);
    }
  }
  if (files.reduce((total, file) => total + (Number.isSafeInteger(file.size) && file.size >= 0 ? file.size : 0), 0) > MAX_WORKSPACE_UPLOAD_TOTAL_BYTES) {
    throw new WorkspaceUploadError('UPLOAD_BATCH_TOO_LARGE', `Choose no more than ${MAX_WORKSPACE_UPLOAD_TOTAL_BYTES / 1024 / 1024} MB of files in one upload.`);
  }
  const batchId = crypto.randomUUID();
  const progress: WorkspaceUploadProgress[] = files.map((file, index) => ({
    id: `${batchId}:${index}`, index, fileName: file.name, path: `${directory ? `${directory}/` : ''}${options.relativePaths?.[index] ?? file.name}`,
    size: file.size, stage: 'queued', bytesUploaded: 0, bytesImported: 0,
  }));
  const emit = () => options.onProgress?.(progress.map(file => ({ ...file })));
  const update = (index: number, patch: Partial<WorkspaceUploadProgress>) => { Object.assign(progress[index], patch); emit(); };
  const result = (): WorkspaceUploadResult => ({
    files: progress.map(file => ({ ...file })), uploaded: progress.filter(file => file.stage === 'ready').length,
    failed: progress.filter(file => file.stage === 'failed').length, cancelled: progress.filter(file => file.stage === 'cancelled').length,
    unconfirmed: progress.filter(file => file.stage === 'unconfirmed').length,
  });
  if (!files.length) return result();
  emit();

  const paths = new Set<string>();
  for (let index = 0; index < files.length; index++) {
    try {
      validateFile(files[index], MAX_WORKSPACE_UPLOAD_BYTES);
      if (paths.has(progress[index].path)) throw new WorkspaceUploadError('UPLOAD_DUPLICATE_PATH', 'Another selected file has the same destination name. Rename one before uploading.');
      paths.add(progress[index].path);
    } catch (error) { update(index, { stage: 'failed', ...failure(error) }); }
  }
  if (progress.every(file => file.stage !== 'queued')) return result();

  let maxFileBytes = MAX_WORKSPACE_UPLOAD_BYTES;
  try {
    throwIfAborted(signal);
    if (typeof Worker === 'undefined') throw new WorkspaceUploadError('UPLOAD_WORKER_UNAVAILABLE', 'This browser cannot start a direct file upload. Use an updated browser.');
    const status = await request<UploadServiceStatus>('/uploads/status', {}, signal);
    if (!status.ready || !status.enabled) throw new WorkspaceUploadError(status.error?.code || 'UPLOADS_UNAVAILABLE', status.error?.message || 'File uploads are temporarily unavailable. Try again shortly.');
    if (status.bucket !== TRANSFER_BUCKET || !Number.isSafeInteger(status.maxFileBytes) || status.maxFileBytes <= 0) throw new WorkspaceUploadError('UPLOAD_RESPONSE_INVALID', 'The upload service returned invalid limits.');
    maxFileBytes = Math.min(maxFileBytes, status.maxFileBytes);
  } catch (error) {
    for (const file of progress) if (file.stage === 'queued') Object.assign(file, signal?.aborted ? { stage: 'cancelled', notice: 'Upload cancelled before transfer.' } : { stage: 'failed', ...failure(error) });
    emit();
    return result();
  }

  let stopForSession = false;
  for (let index = 0; index < files.length; index++) {
    const item = progress[index];
    if (item.stage !== 'queued') continue;
    if (signal?.aborted || stopForSession) {
      update(index, { stage: 'cancelled', notice: stopForSession ? 'The workspace session ended before this file was uploaded.' : 'Upload cancelled before transfer.' });
      continue;
    }
    const file = files[index];
    let job: UploadJob | undefined;
    let sha256: string | undefined;
    let finalizationRequested = false;
    const target = () => ({ workspaceId, path: item.path, size: file.size, id: job?.id, objectPath: job?.objectPath, sha256 });
    const applyJob = (next: UploadJob, notice?: string) => {
      job = validateJob(next, target());
      const stage: WorkspaceUploadStage = job.state === 'ready' ? 'ready' : job.state === 'failed' || job.state === 'expired' ? 'failed'
        : job.state === 'cancelled' ? 'cancelled' : job.state === 'importing' ? 'importing' : 'publishing';
      update(index, {
        stage, jobId: job.id, bytesImported: job.bytesProcessed, expiresAt: job.expiresAt,
        ...(job.state === 'ready' ? { bytesUploaded: file.size, bytesImported: file.size, error: undefined, errorCode: undefined } : {}),
        ...(job.state === 'failed' || job.state === 'expired' ? { error: job.error?.message || 'The staged file could not be saved to the workspace.', errorCode: job.error?.code || 'UPLOAD_FAILED' } : {}),
        notice,
      });
    };
    try {
      validateFile(file, maxFileBytes);
      options.checkTarget?.(item.path);
      throwIfAborted(signal);
      update(index, { stage: 'reserving' });
      job = validateJob(await request<UploadJob>(`/workspaces/${encodeURIComponent(workspaceId)}/uploads`, json('POST', { path: item.path, size: file.size }), signal), target());
      if (job.state !== 'reserved' || Date.parse(job.sessionExpiresAt) <= Date.now()) throw new WorkspaceUploadError('UPLOAD_RESERVATION_INVALID', 'The upload reservation is no longer available. Try again.');
      update(index, { stage: 'preparing', jobId: job.id });
      const hashes = await transferFile(file, job, signal, event => update(index, { stage: event.stage, bytesUploaded: Math.max(item.bytesUploaded, event.bytesUploaded) }));
      sha256 = hashes.sha256;
      throwIfAborted(signal);
      options.checkTarget?.(item.path);
      update(index, { stage: 'publishing', bytesUploaded: file.size });
      finalizationRequested = true;
      try {
        applyJob(await request<UploadJob>(`/uploads/${encodeURIComponent(job.id)}/complete`, json('POST', hashes), signal));
      } catch (error) {
        throwIfAborted(signal);
        if (!transient(error)) throw error;
        // Publication is idempotent for this reservation/hash. A lost response
        // must be reconciled before another upload can be reported as necessary.
        update(index, { notice: 'Connection interrupted. Checking whether the file was saved…' });
        const recovered = validateJob(await request<UploadJob>(`/uploads/${encodeURIComponent(job.id)}`, {}, signal), target());
        if (recovered.state === 'reserved') applyJob(await request<UploadJob>(`/uploads/${encodeURIComponent(job.id)}/complete`, json('POST', hashes), signal));
        else applyJob(recovered);
      }
      const deadline = Date.now() + 10 * 60_000;
      let failures = 0;
      while (!TERMINAL_JOBS.has(job.state)) {
        if (Date.now() >= deadline) throw new WorkspaceUploadError('UPLOAD_IMPORT_TIMEOUT', 'The upload service did not confirm saving the file in time.');
        await pause(failures ? 1500 : 700, signal);
        try {
          applyJob(await request<UploadJob>(`/uploads/${encodeURIComponent(job.id)}`, {}, signal));
          failures = 0;
        } catch (error) {
          throwIfAborted(signal);
          if (!transient(error) || ++failures >= 3) throw error;
          update(index, { notice: 'Connection interrupted. Checking whether the file was saved…' });
        }
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) stopForSession = true;
      let outcome: UploadJob | undefined;
      if (job) {
        if (signal?.aborted) update(index, { stage: 'cancelling', notice: 'Checking whether saving finished before cancellation…' });
        // Cleanup has its own bounded signal: the user's aborted signal must not
        // prevent cancellation or conceal an already committed workspace file.
        try { outcome = validateJob(await request<UploadJob>(`/uploads/${encodeURIComponent(job.id)}`, json('DELETE'), undefined, 6000), target()); }
        catch {
          try { outcome = validateJob(await request<UploadJob>(`/uploads/${encodeURIComponent(job.id)}`, {}, undefined, 6000), target()); } catch { /* The outcome remains explicitly unconfirmed below. */ }
        }
      }
      if (outcome?.state === 'ready') {
        applyJob(outcome, signal?.aborted ? 'Saved before cancellation took effect.' : 'The file was saved; its confirmation was delayed.');
      } else if (finalizationRequested && (!outcome || !TERMINAL_JOBS.has(outcome.state))) {
        update(index, { stage: 'unconfirmed', error: 'Could not confirm whether this file was saved or cancelled. Refresh the destination folder before retrying.', errorCode: 'UPLOAD_OUTCOME_UNCONFIRMED', notice: undefined });
      } else if (signal?.aborted) {
        if (outcome?.state === 'failed') applyJob(outcome);
        else update(index, { stage: 'cancelled', error: undefined, errorCode: undefined, notice: 'Upload cancelled.' });
      } else {
        update(index, { stage: 'failed', ...failure(error), notice: undefined });
      }
    }
  }
  return result();
}
