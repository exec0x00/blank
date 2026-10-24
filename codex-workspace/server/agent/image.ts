import { constants, type Stats } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { AppContext } from '../context';
import { HttpError } from '../errors';
import type { FunctionTool, ModelItem } from '../../shared/legacy-types';

export const VIEW_IMAGE_LIMITS = Object.freeze({ maxBytes: 8 * 1024 * 1024, maxDimension: 16_384, maxPixels: 40_000_000 });
export type ViewImageDetail = 'high' | 'original';
export interface ViewImageOptions { signal?: AbortSignal; maxBytes?: number; detail?: ViewImageDetail | null }
export interface ViewImageMetadata {
  path: string; mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  bytes: number; width: number; height: number; detail: ViewImageDetail;
}
export interface ViewImageResult {
  /** Send this array directly as function_call_output.output. Do not stringify or redact image bytes. */
  output: ModelItem[];
  /** Only metadata and logOutput belong in browser events or textual tool logs. */
  metadata: ViewImageMetadata;
  logOutput: string;
}

export const viewImageTool: FunctionTool = {
  type: 'function', name: 'view_image', strict: true,
  description: 'View an existing PNG, JPEG, WebP, or non-animated GIF in the current workspace. Returns actual image content for visual inspection. Use a workspace-relative path or an absolute path inside the workspace. Remote URLs are not supported.',
  parameters: {
    type: 'object', properties: {
      path: { type: 'string', description: 'Path to a local image inside the current workspace.' },
      detail: { type: ['string', 'null'], enum: ['high', 'original', null], description: 'Image detail sent to the model. Use null for the default high detail, or original to request original resolution.' },
    }, required: ['path', 'detail'], additionalProperties: false,
  },
};

export type ImageHeader = Pick<ViewImageMetadata, 'mimeType' | 'width' | 'height'>;
const within = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};
function invalid(): never { throw new HttpError(415, 'Unable to process image: invalid or unsupported image data.', 'INVALID_IMAGE'); }
function animated(): never { throw new HttpError(415, 'Animated images are not supported. Save a single frame as PNG, JPEG, WebP, or GIF.', 'ANIMATED_IMAGE'); }
function changed(): never { throw new HttpError(409, 'The image changed while being read. Retry with the saved file.', 'IMAGE_CHANGED'); }
function unsafe(): never { throw new HttpError(403, 'The image must remain inside this workspace.', 'UNSAFE_PATH'); }

function dimensions(width: number, height: number): { width: number; height: number } {
  if (!width || !height) invalid();
  if (width > VIEW_IMAGE_LIMITS.maxDimension || height > VIEW_IMAGE_LIMITS.maxDimension || width * height > VIEW_IMAGE_LIMITS.maxPixels) {
    throw new HttpError(413, 'The image exceeds the limit of 16,384 pixels per side or 40 million pixels. Resize it before viewing.', 'IMAGE_DIMENSIONS_EXCEEDED');
  }
  return { width, height };
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Buffer, start: number, end: number): number {
  let value = 0xffffffff;
  for (let offset = start; offset < end; offset++) value = crcTable[(value ^ bytes[offset]) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function pngHeader(bytes: Buffer): ImageHeader {
  if (bytes.length < 33 || bytes.readUInt32BE(8) !== 13 || bytes.toString('latin1', 12, 16) !== 'IHDR') invalid();
  const size = dimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  if (!depths[bytes[25]]?.includes(bytes[24]) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] > 1) invalid();
  let offset = 8, hasPixels = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 8 + length;
    if (end + 4 > bytes.length) invalid();
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes, offset + 4, end) !== bytes.readUInt32BE(end)) invalid();
    if (type === 'IHDR' && offset !== 8) invalid();
    if (type === 'acTL') animated();
    if (type === 'IDAT' && length) hasPixels = true;
    if (type === 'IEND') {
      if (length || !hasPixels || end + 4 !== bytes.length) invalid();
      return { mimeType: 'image/png', ...size };
    }
    offset = end + 4;
  }
  return invalid();
}

function jpegHeader(bytes: Buffer): ImageHeader {
  let offset = 2, size: { width: number; height: number } | undefined, hasScan = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) invalid();
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) invalid();
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (!size || !hasScan || offset !== bytes.length) invalid();
      return { mimeType: 'image/jpeg', ...size };
    }
    if (marker === 0x00 || marker === 0xd8 || marker >= 0xd0 && marker <= 0xd7) invalid();
    if (marker === 0x01) continue;
    if (offset + 2 > bytes.length) invalid();
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) invalid();
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (length < 11 || size) invalid();
      const components = bytes[offset + 7];
      if (bytes[offset + 2] !== 8 || ![1, 3, 4].includes(components) || length !== 8 + 3 * components) invalid();
      size = dimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
    }
    if (marker === 0xda) {
      if (!size || length < 6 || length !== 6 + 2 * bytes[offset + 2]) invalid();
      hasScan = true;
    }
    offset += length;
    if (marker === 0xda) {
      // Entropy data can contain stuffed FF bytes and restart markers. Other
      // markers start the next segment, including additional progressive scans.
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) { offset++; continue; }
        if (offset + 1 >= bytes.length) invalid();
        const next = bytes[offset + 1];
        if (next === 0x00 || next >= 0xd0 && next <= 0xd7) { offset += 2; continue; }
        break;
      }
    }
  }
  return invalid();
}

function gifHeader(bytes: Buffer): ImageHeader {
  if (bytes.length < 14) invalid();
  const size = dimensions(bytes.readUInt16LE(6), bytes.readUInt16LE(8));
  let offset = 13 + (bytes[10] & 0x80 ? 3 * (2 << (bytes[10] & 7)) : 0), frames = 0;
  const blocks = () => {
    let total = 0;
    for (;;) {
      if (offset >= bytes.length) invalid();
      const length = bytes[offset++];
      if (!length) return total;
      if (offset + length > bytes.length) invalid();
      total += length;
      offset += length;
    }
  };
  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) {
      if (frames !== 1 || offset !== bytes.length) invalid();
      return { mimeType: 'image/gif', ...size };
    }
    if (marker === 0x21) {
      if (offset >= bytes.length) invalid();
      offset++; // Extension label, followed by bounded data sub-blocks.
      blocks();
    } else if (marker === 0x2c) {
      if (++frames > 1) animated();
      if (offset + 9 > bytes.length) invalid();
      const left = bytes.readUInt16LE(offset), top = bytes.readUInt16LE(offset + 2);
      const frame = dimensions(bytes.readUInt16LE(offset + 4), bytes.readUInt16LE(offset + 6));
      if (left + frame.width > size.width || top + frame.height > size.height) invalid();
      const packed = bytes[offset + 8];
      offset += 9 + (packed & 0x80 ? 3 * (2 << (packed & 7)) : 0);
      if (offset >= bytes.length || bytes[offset] < 2 || bytes[offset] > 8) invalid();
      offset++;
      if (!blocks()) invalid();
    } else invalid();
  }
  return invalid();
}

function webpHeader(bytes: Buffer): ImageHeader {
  if (bytes.length < 20 || bytes.readUInt32LE(4) + 8 !== bytes.length) invalid();
  let offset = 12, canvas: { width: number; height: number } | undefined, image: { width: number; height: number } | undefined;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString('latin1', offset, offset + 4), length = bytes.readUInt32LE(offset + 4), start = offset + 8;
    if (start + length + (length & 1) > bytes.length) invalid();
    if (type === 'ANIM' || type === 'ANMF') animated();
    if (type === 'VP8X') {
      if (offset !== 12 || canvas || length !== 10) invalid();
      if (bytes[start] & 0x02) animated();
      if (bytes[start] & 0xc1 || bytes.readUIntLE(start + 1, 3)) invalid();
      canvas = dimensions(1 + bytes.readUIntLE(start + 4, 3), 1 + bytes.readUIntLE(start + 7, 3));
    } else if (type === 'VP8 ') {
      if (image || length <= 10 || bytes[start] & 1 || !bytes.subarray(start + 3, start + 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) invalid();
      image = dimensions(bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff);
    } else if (type === 'VP8L') {
      if (image || length <= 5 || bytes[start] !== 0x2f) invalid();
      const header = bytes.readUInt32LE(start + 1);
      if (header >>> 29) invalid();
      image = dimensions((header & 0x3fff) + 1, (header >>> 14 & 0x3fff) + 1);
    }
    offset = start + length + (length & 1);
  }
  if (offset !== bytes.length || !image || canvas && (canvas.width !== image.width || canvas.height !== image.height)) invalid();
  return { mimeType: 'image/webp', ...image };
}

/** Validate local or restored image bytes without decoding, changing, or logging their content. */
export function inspectImageBytes(bytes: Buffer): ImageHeader {
  if (!Buffer.isBuffer(bytes) || !bytes.length) invalid();
  if (bytes.length > VIEW_IMAGE_LIMITS.maxBytes) {
    throw new HttpError(413, `The image exceeds the ${VIEW_IMAGE_LIMITS.maxBytes}-byte limit. Resize it before viewing.`, 'IMAGE_TOO_LARGE');
  }
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return pngHeader(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegHeader(bytes);
  if (['GIF87a', 'GIF89a'].includes(bytes.toString('latin1', 0, 6))) return gifHeader(bytes);
  if (bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return webpHeader(bytes);
  throw new HttpError(415, 'Unsupported image format. Use PNG, JPEG, WebP, or a non-animated GIF.', 'UNSUPPORTED_IMAGE');
}

function sameFile(before: Stats, after: Stats): boolean {
  return after.isFile() && before.dev === after.dev && before.ino === after.ino && before.size === after.size
    && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}

/** Codex view_image: inspect local bytes without downloading, transforming, or logging their contents. */
export async function viewWorkspaceImage(ctx: AppContext, workspaceId: string, imagePath: string, options: ViewImageOptions = {}): Promise<ViewImageResult> {
  const { signal } = options;
  signal?.throwIfAborted();
  const maxBytes = options.maxBytes ?? VIEW_IMAGE_LIMITS.maxBytes;
  const detail = options.detail ?? 'high';
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > VIEW_IMAGE_LIMITS.maxBytes || !['high', 'original'].includes(detail)) {
    throw new HttpError(400, 'Invalid image size limit or detail setting.', 'INVALID_IMAGE_OPTIONS');
  }
  if (typeof imagePath !== 'string' || !imagePath || imagePath.length > 4096 || /[\\\u0000-\u001f\u007f]/.test(imagePath)) {
    throw new HttpError(400, 'Choose an image path inside this workspace.', 'INVALID_PATH');
  }
  const root = await ctx.workspaces.resolvePath(workspaceId, '');
  signal?.throwIfAborted();
  if (path.isAbsolute(imagePath) && !within(root, imagePath)) unsafe();
  const relative = path.isAbsolute(imagePath) ? path.relative(root, imagePath).split(path.sep).join('/') : imagePath;
  const absolute = await ctx.workspaces.resolvePath(workspaceId, relative);
  if (!within(root, absolute)) unsafe();
  let handle: FileHandle | undefined;
  try {
    signal?.throwIfAborted();
    // NONBLOCK makes a raced-in FIFO fail the regular-file check without hanging.
    handle = await fs.open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat();
    if (!before.isFile()) throw new HttpError(400, 'Choose a regular image file.', 'NOT_A_FILE');
    if (!before.size) invalid();
    if (before.size > maxBytes) throw new HttpError(413, `The image exceeds the ${maxBytes}-byte limit. Resize it before viewing.`, 'IMAGE_TOO_LARGE');
    const validateLocation = async () => {
      // On the Linux host, verify the opened descriptor itself, including any
      // parent directories replaced between resolvePath and open.
      if (process.platform === 'linux' && !within(root, await fs.realpath(`/proc/self/fd/${handle!.fd}`))) unsafe();
      if (await ctx.workspaces.resolvePath(workspaceId, '') !== root || await ctx.workspaces.resolvePath(workspaceId, relative) !== absolute) changed();
      if (!sameFile(before, await fs.stat(absolute))) changed();
    };
    await validateLocation();
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      signal?.throwIfAborted();
      const read = await handle.read(bytes, length, Math.min(64 * 1024, bytes.length - length), length);
      signal?.throwIfAborted();
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length !== before.size || !sameFile(before, await handle.stat())) changed();
    await validateLocation();
    signal?.throwIfAborted();
    const content = bytes.subarray(0, length);
    const header = inspectImageBytes(content);
    const metadata: ViewImageMetadata = { path: path.posix.normalize(relative), ...header, bytes: length, detail };
    const logOutput = `Viewed ${metadata.path}: ${metadata.width} × ${metadata.height} ${metadata.mimeType}, ${metadata.bytes} bytes (${detail} detail).`;
    return { metadata, logOutput, output: [
      { type: 'input_text', text: logOutput },
      { type: 'input_image', image_url: `data:${header.mimeType};base64,${content.toString('base64')}`, detail },
    ] };
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof HttpError) throw error;
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ELOOP') unsafe();
    if (code === 'ENOENT' || code === 'ENOTDIR') throw new HttpError(404, 'Image file not found.', 'FILE_NOT_FOUND');
    if (code === 'EACCES' || code === 'EPERM') throw new HttpError(403, 'The image cannot be read with the current file permissions.', 'IMAGE_ACCESS_DENIED');
    throw new HttpError(400, 'Unable to read this image file. Check that it is saved and accessible.', 'IMAGE_READ_FAILED');
  } finally {
    await handle?.close();
  }
}
