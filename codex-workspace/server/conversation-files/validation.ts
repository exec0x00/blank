import { createHash } from 'node:crypto';
import { lookup } from 'mime-types';
import { z } from 'zod';
import { HttpError } from '../errors';
import { FILE_ATTACHMENT_LIMITS } from './types';

export const FILE_ATTACHMENT_ID = /^file_[a-f0-9]{32}$/;
export const FILE_ATTACHMENT_HASH = /^[a-f0-9]{64}$/;
export const WORKSPACE_ID = /^[a-zA-Z0-9_-]{1,128}$/;
export const attachmentHash = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
export const attachmentMissing = (): HttpError => new HttpError(404, 'File attachment not found in this workspace.', 'FILE_ATTACHMENT_NOT_FOUND');
export const attachmentChanged = (): HttpError => new HttpError(409, 'The saved attachment changed. Select the original file and attach it again.', 'FILE_ATTACHMENT_CHANGED');
export const attachmentExpired = (): HttpError => new HttpError(410, 'This unsubmitted file attachment expired. Select the file again.', 'FILE_ATTACHMENT_EXPIRED');
export const attachmentUnsafe = (): HttpError => new HttpError(403, 'File attachment storage contains a link or changed directory.', 'UNSAFE_FILE_ATTACHMENT_STORAGE');

export const fileAttachmentReferenceSchema = z.object({
  id: z.string().regex(FILE_ATTACHMENT_ID), sha256: z.string().regex(FILE_ATTACHMENT_HASH),
}).strict();
export const fileAttachmentReferencesSchema = z.array(fileAttachmentReferenceSchema).max(FILE_ATTACHMENT_LIMITS.maxPerMessage)
  .refine(items => new Set(items.map(item => item.id)).size === items.length, 'Attach each file only once per message.');
export const fileInspectionOptionsSchema = z.object({
  offset: z.number().int().min(0).max(FILE_ATTACHMENT_LIMITS.maxBytes).optional(),
  maxBytes: z.number().int().min(1).max(FILE_ATTACHMENT_LIMITS.maxInspectionBytes).optional(),
}).strict();

export function parseFileInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new HttpError(400, 'Choose valid file attachments and bounded inspection options.', 'INVALID_FILE_ATTACHMENT_INPUT');
  return result.data;
}

export function fileAttachmentName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > 255 || value === '.' || value === '..'
    || /[\\/\u0000-\u001f\u007f]/.test(value) || value.startsWith('.codex-write-')) {
    throw new HttpError(400, 'Use a filename of at most 255 UTF-8 bytes without folders or control characters.', 'INVALID_FILE_ATTACHMENT_NAME');
  }
  return value;
}

export function fileAttachmentMime(value: unknown, name: string): string {
  if (value === undefined || value === '') return lookup(name) || 'application/octet-stream';
  if (typeof value !== 'string' || value.length > 127 || !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(value)) {
    throw new HttpError(400, 'The file MIME type is invalid.', 'INVALID_FILE_ATTACHMENT_MIME');
  }
  return value.toLowerCase();
}

export function validDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}
