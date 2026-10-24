import type { GeneratedImageMetadata } from '../generated-images/types';
import type { ModelItem } from '../../shared/legacy-types';

const LOCAL_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/;
const ITEM_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,255}$/;
const KEYS = new Set(['id', 'sha256', 'workspaceId', 'threadId', 'messageId', 'runId', 'itemId', 'state',
  'mimeType', 'bytes', 'width', 'height', 'createdAt', 'previewUrl', 'revisedPrompt']);

export interface StoredGeneratedImagePart extends ModelItem {
  type: 'input_image';
  generated_image: GeneratedImageMetadata;
  detail: 'high' | 'original';
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown, maximum: number): value is number => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= maximum;

/** Only a typed, bounded reference belongs in saved model history. This is
 * structural validation, not proof that the immutable original still exists. */
export function generatedImageMetadata(value: unknown): GeneratedImageMetadata | undefined {
  if (!object(value) || Object.keys(value).some(key => !KEYS.has(key))
    || typeof value.id !== 'string' || !/^img_[a-f0-9]{64}$/.test(value.id)
    || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)
    || ['workspaceId', 'threadId', 'messageId', 'runId'].some(key => typeof value[key] !== 'string' || !LOCAL_ID.test(value[key] as string))
    || typeof value.itemId !== 'string' || !ITEM_ID.test(value.itemId) || value.state !== 'completed'
    || typeof value.mimeType !== 'string' || !['image/png', 'image/jpeg', 'image/webp'].includes(value.mimeType)
    || !count(value.bytes, 8 * 1024 * 1024) || !count(value.width, 16_384) || !count(value.height, 16_384)
    || value.width * value.height > 40_000_000
    || typeof value.createdAt !== 'string' || value.createdAt.length > 30 || !Number.isFinite(Date.parse(value.createdAt))
    || new Date(value.createdAt).toISOString() !== value.createdAt
    || value.previewUrl !== `/api/workspaces/${encodeURIComponent(String(value.workspaceId))}/generated-images/${value.id}/content?sha256=${value.sha256}`
    || value.revisedPrompt !== undefined && (typeof value.revisedPrompt !== 'string' || value.revisedPrompt.includes('\0') || Buffer.byteLength(value.revisedPrompt) > 32 * 1024)) return;
  return { id: value.id, sha256: value.sha256, workspaceId: value.workspaceId as string, threadId: value.threadId as string,
    messageId: value.messageId as string, runId: value.runId as string, itemId: value.itemId, state: 'completed',
    mimeType: value.mimeType as GeneratedImageMetadata['mimeType'], bytes: value.bytes, width: value.width, height: value.height,
    createdAt: value.createdAt, previewUrl: value.previewUrl as string,
    ...(value.revisedPrompt === undefined ? {} : { revisedPrompt: value.revisedPrompt as string }) };
}

export function storedGeneratedImagePart(value: unknown): StoredGeneratedImagePart | undefined {
  if (!object(value) || value.type !== 'input_image' || Object.keys(value).some(key => !['type', 'generated_image', 'detail'].includes(key))
    || value.detail !== 'high' && value.detail !== 'original') return;
  const metadata = generatedImageMetadata(value.generated_image);
  return metadata ? { type: 'input_image', generated_image: metadata, detail: value.detail } : undefined;
}

export function createStoredGeneratedImagePart(metadata: GeneratedImageMetadata, detail: 'high' | 'original' = 'original'): StoredGeneratedImagePart {
  const part = storedGeneratedImagePart({ type: 'input_image', generated_image: metadata, detail });
  if (!part) throw new TypeError('The saved generated image reference is invalid.');
  return part;
}

/** Compare all immutable public fields, not merely an id copied into text. */
export function sameGeneratedImage(left: GeneratedImageMetadata, right: GeneratedImageMetadata): boolean {
  return [...KEYS].every(key => left[key as keyof GeneratedImageMetadata] === right[key as keyof GeneratedImageMetadata]);
}

export function generatedImageContextMetadata(metadata: GeneratedImageMetadata, detail: 'high' | 'original'): Record<string, unknown> {
  return { kind: 'historical_generated_image_metadata', id: metadata.id, sha256: metadata.sha256,
    mimeType: metadata.mimeType, bytes: metadata.bytes, width: metadata.width, height: metadata.height, detail,
    ...(metadata.revisedPrompt ? { revisedPrompt: metadata.revisedPrompt } : {}),
    omitted: 'The original image pixels are not included in this metadata. This is not a visual summary. Use read_generated_image with this saved reference to inspect the actual image again.' };
}
