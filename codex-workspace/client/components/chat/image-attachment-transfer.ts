import type { ImageAttachment } from '../../../shared/types';
import { api, ApiError, json } from '../../api';
import { FileAttachmentUploadError, uploadFileAttachment, validateFileAttachmentJob, type FileAttachmentProgress } from './file-attachment-transfer';

export interface ImageAttachmentTransferState extends Omit<FileAttachmentProgress, 'stage'> {
  stage: FileAttachmentProgress['stage'] | 'promoting';
  promotionStarted?: boolean;
  image?: ImageAttachment;
}
export interface ImageAttachmentTransferOptions {
  workspaceId: string;
  file: File;
  detail?: 'high' | 'original';
  previous?: ImageAttachmentTransferState;
  signal?: AbortSignal;
  onProgress?: (state: ImageAttachmentTransferState) => void;
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const HASH = /^[a-f0-9]{64}$/;
const encoded = encodeURIComponent;

function verifiedImage(value: ImageAttachment, options: ImageAttachmentTransferOptions, source: ImageAttachmentTransferState): boolean {
  const detail = options.detail ?? 'high';
  return !!value && /^att_[a-f0-9]{32}$/.test(value.id) && HASH.test(value.sha256) && value.sha256 === source.sha256
    && value.workspaceId === options.workspaceId && value.name === options.file.name && value.bytes === options.file.size
    && value.bytes > 0 && value.bytes <= 8 * 1024 * 1024 && IMAGE_TYPES.has(value.mimeType) && value.detail === detail
    && Number.isSafeInteger(value.width) && value.width > 0 && value.width <= 16384
    && Number.isSafeInteger(value.height) && value.height > 0 && value.height <= 16384 && value.width * value.height <= 40_000_000
    && value.createdAt === source.job?.createdAt
    && value.previewUrl === `/api/workspaces/${encoded(options.workspaceId)}/attachments/${value.id}/content?sha256=${value.sha256}`;
}

function safeError(error: unknown): string {
  return error instanceof ApiError || error instanceof FileAttachmentUploadError ? error.message.slice(0, 600)
    : 'Could not confirm photo preparation. Retry checks the same uploaded file.';
}
const transient = (error: unknown) => error instanceof TypeError
  || error instanceof ApiError && (error.status === 408 || error.status === 429 || error.status >= 500);

async function bounded<T>(path: string, options: RequestInit, signal?: AbortSignal, timeoutMs = 20_000): Promise<T> {
  signal?.throwIfAborted();
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try { return await api<T>(path, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

/** Photo bytes use the existing browser CAS worker; app requests contain JSON only. */
export async function uploadImageAttachment(options: ImageAttachmentTransferOptions): Promise<ImageAttachmentTransferState> {
  const { workspaceId, file, signal } = options;
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > 8 * 1024 * 1024) throw new Error('Each photo must contain at most 8 MiB.');
  let state: ImageAttachmentTransferState = { stage: 'queued', bytesUploaded: 0, bytesImported: 0, ...options.previous, image: undefined };
  const emit = (patch: Partial<ImageAttachmentTransferState>) => { state = { ...state, ...patch }; options.onProgress?.({ ...state }); };
  try {
    signal?.throwIfAborted();
    if (state.job?.state === 'ready' && state.sha256) {
      // This captured receipt remains useful after optional generic-draft
      // disposal. The promotion endpoint verifies its own saved image on retry.
      validateFileAttachmentJob(state.job, { workspaceId, name: file.name, size: file.size,
        id: state.job.id, objectPath: state.job.objectPath, sha256: state.sha256 });
    } else {
      const staged = await uploadFileAttachment({ workspaceId, file, signal, previousJob: state.job,
        expectedSha256: state.sha256, onProgress: progress => emit(progress) });
      emit(staged);
      if (staged.stage !== 'ready' || !staged.job?.attachment) return { ...state };
    }
    signal?.throwIfAborted();
    const job = state.job!, source = job.attachment;
    const sha256 = state.sha256 ?? source?.sha256;
    if (!source || !sha256 || source.sha256 !== sha256) throw new Error('The uploaded photo did not have a verified file receipt.');
    // Keep this exact ready job and hash before any cleanup or uncertain reply.
    emit({ stage: 'promoting', sha256, promotionStarted: true, error: undefined, notice: 'Preparing the uploaded photo…' });
    const path = `/workspaces/${encoded(workspaceId)}/attachments/from-upload`;
    const body = { uploadId: job.id, sha256, detail: options.detail ?? 'high' };
    let image: ImageAttachment;
    try { image = await bounded<ImageAttachment>(path, json('POST', body), signal); }
    catch (error) {
      signal?.throwIfAborted();
      if (!transient(error)) throw error;
      emit({ notice: 'Checking whether this photo was already prepared…' });
      image = await bounded<ImageAttachment>(path, json('POST', body), signal);
    }
    if (!verifiedImage(image, options, state)) throw new Error('The prepared photo did not match the uploaded file.');
    emit({ stage: 'ready', image, error: undefined, notice: undefined, bytesUploaded: file.size, bytesImported: file.size });
    // No original is deleted before a verified image receipt exists. Failure
    // here leaves the ordinary unused-file expiry/retention rules in charge.
    if (!signal?.aborted) {
      try {
        await bounded(`/workspaces/${encoded(workspaceId)}/file-attachments/${encoded(source.id)}?sha256=${source.sha256}`,
          { method: 'DELETE' }, signal, 6000);
      } catch { /* Retained, expired or unavailable generic drafts are safe to keep. */ }
    }
  } catch (error) {
    if (state.image) return { ...state };
    if (signal?.aborted) emit({ stage: state.promotionStarted ? 'unconfirmed' : 'cancelled',
      error: state.promotionStarted ? 'Cancelled while checking this photo. Retry checks the same uploaded file.' : undefined,
      notice: state.promotionStarted ? undefined : 'Photo upload cancelled. Retry or remove it.' });
    else emit({ stage: state.promotionStarted ? 'unconfirmed' : 'failed', error: safeError(error), notice: undefined });
  }
  return { ...state };
}
