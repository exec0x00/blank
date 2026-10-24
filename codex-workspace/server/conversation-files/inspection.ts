import { isUtf8 } from 'node:buffer';
import { HttpError } from '../errors';
import { FILE_ATTACHMENT_LIMITS, type FileAttachment, type FileAttachmentInspection, type FileAttachmentInspectionOptions } from './types';
import { fileInspectionOptionsSchema, parseFileInput } from './validation';

/** Byte inspection only: no shell, document scripts, archive expansion or parser subprocess. */
export function inspectFileAttachment(attachment: FileAttachment, bytes: Buffer, input: FileAttachmentInspectionOptions = {}): FileAttachmentInspection {
  const options = parseFileInput(fileInspectionOptionsSchema, input);
  let offset = options.offset ?? 0;
  if (offset > bytes.length) throw new HttpError(400, 'The requested byte offset is past the end of this file.', 'FILE_ATTACHMENT_OFFSET');
  const isPdf = bytes.subarray(0, 5).equals(Buffer.from('%PDF-'));
  const isArchive = bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    || bytes.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b]));
  // Text/plain supplied by the browser does not turn invalid UTF-8 or binary controls into text.
  let text = !isPdf && !isArchive && isUtf8(bytes);
  if (text) for (const byte of bytes) {
    if ((byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) || byte === 0x7f) { text = false; break; }
  }
  const requested = options.maxBytes ?? 16 * 1024;
  if (!text) {
    const end = Math.min(bytes.length, offset + Math.min(requested, FILE_ATTACHMENT_LIMITS.maxBinaryInspectionBytes));
    return { attachment, format: 'binary', offset, bytesRead: end - offset, totalBytes: bytes.length,
      truncated: end < bytes.length, ...(end < bytes.length ? { nextOffset: end } : {}),
      hex: bytes.subarray(offset, end).toString('hex'),
      notice: isPdf
        ? 'PDF text has not been extracted. These are original file bytes. Copy this attachment into the workspace to inspect it with an available PDF reader; scanned pages may require OCR.'
        : 'This file is not plain UTF-8 text. These are original bytes, not parsed document contents. Copy it into the workspace to inspect it with an appropriate reader. Do not execute attached content.' };
  }
  // Align both ends so valid multi-byte characters never become invented replacement characters.
  while (offset < bytes.length && (bytes[offset] & 0xc0) === 0x80) offset++;
  let end = Math.min(bytes.length, offset + requested);
  while (end > offset && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
  if (end === offset && offset < bytes.length) {
    // A 1-byte caller limit can land before a 4-byte character. Advance by that one
    // complete character, still safely below the global inspection output bound.
    end++;
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end++;
  }
  return { attachment, format: 'utf8', offset, bytesRead: end - offset, totalBytes: bytes.length,
    truncated: end < bytes.length, ...(end < bytes.length ? { nextOffset: end } : {}), content: bytes.subarray(offset, end).toString('utf8') };
}
