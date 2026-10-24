import path from 'node:path';
import { HttpError } from '../errors';
import { validObjectPath } from '../downloads/bucket';

export const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const CONTENT_HASH = /^[0-9a-f]{64}$/;
export const UPLOAD_SESSION_MS = 30 * 60 * 1000;
export const MAX_CAPABILITY_REQUESTS = 4;

export function uploadPath(value: unknown): string {
  if (typeof value !== 'string' || !validObjectPath(value) || path.posix.normalize(value) !== value
    || /^[a-z]:/i.test(value) || Buffer.byteLength(value) > 4096
    || value.split('/').some(part => Buffer.byteLength(part) > 255 || part.startsWith('.codex-write-'))) {
    throw new HttpError(400, 'Choose a file path inside the workspace without links or parent segments.', 'INVALID_PATH');
  }
  return value;
}

export function validUploadObjectPath(value: unknown): value is string {
  if (!validObjectPath(value)) return false;
  const parts = value.split('/');
  return parts.length === 3 && parts[0] === 'imports' && UPLOAD_ID.test(parts[1])
    && Buffer.byteLength(parts[2]) <= 255 && !parts[2].startsWith('.codex-write-');
}

export function plainObject(value: unknown, fields: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => fields.includes(key));
}
