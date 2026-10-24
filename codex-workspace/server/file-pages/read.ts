import { createHash } from 'node:crypto';
import { HttpError } from '../errors';
import { FilePositionCache } from './cache';
import { LINE_LOOKAHEAD_BYTES, LINE_LOOKBEHIND_BYTES, MAX_PAGE_BYTES, MAX_RANGE_SAVE_FILE_BYTES, PAGE_BYTES, SMALL_FILE_BYTES } from './limits';
import { FileSource } from './source';
import { FilePageTokens, type PageCursor } from './tokens';
import { lineBoundary, lineBreaks, noSplitBoundary } from './text';
import { languageFor, textBytes } from './validation';
import type { WorkspaceFileInfo, WorkspaceFilePage } from './types';

export function fileInfo(source: FileSource, positions: FilePositionCache): WorkspaceFileInfo {
  const editable = source.size <= MAX_RANGE_SAVE_FILE_BYTES;
  return { path: source.path, size: source.size, version: source.version, language: languageFor(source.path),
    paged: source.size > SMALL_FILE_BYTES, maxPageBytes: MAX_PAGE_BYTES, editable,
    readOnlyReason: editable ? null : 'Files larger than 64 MiB open in read-only pages. Safe range saves currently support files up to 64 MiB.',
    totalLines: source.size === 0 ? 1 : positions.total(source.version) };
}

export async function readFilePage(source: FileSource, tokens: FilePageTokens, positions: FilePositionCache,
  offset: number, cursor?: PageCursor, exactEnd?: number): Promise<WorkspaceFilePage> {
  if (offset > source.size) throw new HttpError(416, 'The byte offset is beyond the current file. Reload the file.', 'FILE_OFFSET_OUT_OF_RANGE');
  if (cursor) tokens.check(cursor, source);
  if (exactEnd !== undefined && (!Number.isSafeInteger(exactEnd) || exactEnd < offset || exactEnd > source.size || exactEnd - offset > MAX_PAGE_BYTES)) {
    throw new Error('The saved range is outside its bounded source.');
  }
  const lookbehind = cursor || exactEnd !== undefined ? 4 : LINE_LOOKBEHIND_BYTES;
  const readStart = Math.max(0, offset - lookbehind);
  const bytes = await source.read(readStart, Math.min(source.size - readStart, (exactEnd === undefined ? PAGE_BYTES : exactEnd - offset) + offset - readStart + 4));
  const requested = offset - readStart;
  let start = requested;
  if (exactEnd !== undefined) {
    start = requested;
  } else if (cursor) {
    if (noSplitBoundary(bytes, start) !== start) throw new HttpError(400, 'This cursor splits a text boundary. Reopen the file.', 'INVALID_FILE_CURSOR');
  } else if (offset > 0) {
    let found = false;
    for (let index = requested; index > 0; index--) {
      if (lineBoundary(bytes, index)) { start = index; found = true; break; }
    }
    if (!found) start = noSplitBoundary(bytes, requested);
  }
  const byteStart = readStart + start;
  let end = exactEnd === undefined ? Math.min(bytes.length, start + PAGE_BYTES, source.size - readStart) : exactEnd - readStart;
  if (exactEnd === undefined && readStart + end < source.size) {
    end = noSplitBoundary(bytes, end);
    const earliest = Math.max(start + 1, end - LINE_LOOKAHEAD_BYTES);
    for (let index = end; index >= earliest; index--) {
      if (lineBoundary(bytes, index)) { end = index; break; }
    }
  }
  const byteEnd = readStart + end;
  const pageBytes = bytes.subarray(start, end);
  const content = textBytes(pageBytes);
  let startLine = cursor?.line ?? positions.line(source.version, byteStart)
    ?? (readStart === 0 ? 1 + lineBreaks(bytes, 0, start) : null);
  // An edit may join a preceding CR and a new LF. The response still represents
  // the exact edited bytes, while its global position reflects the joined pair.
  if (exactEnd !== undefined && cursor?.line != null && start > 0 && bytes[start - 1] === 13 && bytes[start] === 10) startLine = Math.max(1, startLine! - 1);
  const endLine = startLine === null ? null : startLine + lineBreaks(bytes, start, end);
  await source.check();
  positions.remember(source.version, byteStart, startLine);
  positions.remember(source.version, byteEnd, endLine, byteEnd === source.size);
  const binding = { format: 1 as const, binding: source.binding, version: source.version };
  return { ...fileInfo(source, positions), content, byteStart, byteEnd, startLine, endLine,
    startsMidLine: byteStart > 0 && !lineBoundary(bytes, start),
    endsMidLine: byteEnd < source.size && !lineBoundary(bytes, end),
    pageToken: tokens.sign({ ...binding, kind: 'range', byteStart, byteEnd, line: startLine,
      sha256: createHash('sha256').update(pageBytes).digest('hex') }),
    nextCursor: byteEnd < source.size ? tokens.sign({ ...binding, kind: 'page',
      offset: end > 0 && bytes[end - 1] === 13 && bytes[end] === 10 ? byteEnd - 1 : byteEnd, line: endLine }) : null,
    previousOffset: byteStart > 0 ? Math.max(0, byteStart - PAGE_BYTES) : null };
}
