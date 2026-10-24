import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AppContext } from '../context';
import { getConversationFiles } from '../conversation-files';
import { validateDownloadSource } from '../downloads/snapshot';
import { HttpError } from '../errors';

const UPLOAD_ID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const DIGEST = /^[a-f0-9]{64}$/;
export interface ImageUploadOrigin { uploadId: string; sha256: string }
export interface ImageUploadPromotionInput extends ImageUploadOrigin { detail?: 'high' | 'original' }
const schema = z.object({ uploadId: z.string().uuid().regex(UPLOAD_ID), sha256: z.string().regex(DIGEST),
  detail: z.enum(['high', 'original']).optional() }).strict();

export function parseImageUploadPromotion(input: unknown): ImageUploadPromotionInput {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, 'Choose a completed photo upload and its exact file hash.', 'INVALID_IMAGE_UPLOAD');
  return parsed.data;
}

export function validImageUploadOrigin(value: unknown): value is ImageUploadOrigin {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const origin = value as Record<string, unknown>;
  return Object.keys(origin).length === 2 && typeof origin.uploadId === 'string' && UPLOAD_ID.test(origin.uploadId)
    && typeof origin.sha256 === 'string' && DIGEST.test(origin.sha256);
}

/** A stable name is not authority: the complete origin and saved bytes are also checked. */
export function imageUploadAttachmentId(workspaceId: string, origin: ImageUploadOrigin, detail: 'high' | 'original'): string {
  const key = JSON.stringify(['codex-image-upload-promotion-v1', workspaceId, origin.uploadId, origin.sha256, detail]);
  return `att_${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
}

const changed = () => new HttpError(409, 'The completed photo upload no longer matches its original bytes.', 'IMAGE_UPLOAD_CHANGED');

/** Read only a server-validated ready upload; no caller path, URL or capability is accepted. */
export async function readImageUpload(ctx: AppContext, workspaceId: string, input: ImageUploadOrigin,
  limits: { maxBytes: number; maxAgeMs: number; now: number }, signal: AbortSignal): Promise<{ name: string; bytes: Buffer; createdAt: string }> {
  signal.throwIfAborted();
  const files = getConversationFiles(ctx), job = await files.get(input.uploadId);
  signal.throwIfAborted();
  if (job.workspaceId !== workspaceId) throw new HttpError(403, 'This photo upload belongs to a different workspace.', 'IMAGE_UPLOAD_WORKSPACE_MISMATCH');
  if (job.state !== 'ready' || !job.attachment) throw new HttpError(409, 'Wait for this photo upload to finish before preparing its preview.', 'IMAGE_UPLOAD_NOT_READY');
  const original = job.attachment;
  if (original.workspaceId !== workspaceId || original.sha256 !== input.sha256 || original.bytes !== job.size
    || original.name !== job.name || original.createdAt !== job.createdAt) throw changed();
  if (!Number.isSafeInteger(job.size) || job.size < 1 || job.size > limits.maxBytes) {
    throw new HttpError(413, 'Each image must be 8 MiB or smaller.', 'IMAGE_TOO_LARGE');
  }
  const created = Date.parse(job.createdAt);
  if (!Number.isFinite(created) || created > limits.now || created <= limits.now - limits.maxAgeMs) {
    throw new HttpError(410, 'This unused photo upload expired. Attach the image again.', 'IMAGE_UPLOAD_EXPIRED');
  }
  const { attachment, source } = await files.openDownloadSource(workspaceId, { id: original.id, sha256: input.sha256 });
  try {
    signal.throwIfAborted();
    if (attachment.id !== original.id || attachment.workspaceId !== workspaceId || attachment.name !== job.name
      || attachment.sha256 !== input.sha256 || attachment.bytes !== job.size || source.size !== job.size) throw changed();
    await validateDownloadSource(source);
    const buffer = Buffer.alloc(source.size + 1);
    let length = 0;
    while (length < buffer.length) {
      signal.throwIfAborted();
      const { bytesRead } = await source.handle.read(buffer, length, Math.min(64 * 1024, buffer.length - length), length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    signal.throwIfAborted();
    if (length !== source.size || createHash('sha256').update(buffer.subarray(0, length)).digest('hex') !== input.sha256) throw changed();
    await validateDownloadSource(source);
    await files.storage.assertWorkspaceAvailable(workspaceId);
    signal.throwIfAborted();
    return { name: attachment.name, bytes: buffer.subarray(0, length), createdAt: job.createdAt };
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, 'The saved photo upload could not be read safely. Its original was retained for retry.', 'IMAGE_UPLOAD_STORAGE_UNAVAILABLE');
  } finally { await source.close(); }
}
