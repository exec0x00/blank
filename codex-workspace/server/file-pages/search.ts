import { createHash } from 'node:crypto';
import { HttpError } from '../errors';
import { FilePositionCache } from './cache';
import { MAX_SEARCH_MATCHES, PAGE_BYTES, SEARCH_SCAN_BYTES } from './limits';
import { FileSource } from './source';
import { FilePageTokens, type SearchCursor } from './tokens';
import { lineBreaks, nextCodePoint, noSplitBoundary, utf8Boundary } from './text';
import { textBytes } from './validation';
import type { WorkspaceFileSearchMatch, WorkspaceFileSearchResult } from './types';

export async function searchFilePage(source: FileSource, tokens: FilePageTokens, positions: FilePositionCache,
  query: string, caseSensitive: boolean, cursor?: SearchCursor): Promise<WorkspaceFileSearchResult> {
  const queryHash = createHash('sha256').update(JSON.stringify([query, caseSensitive])).digest('hex');
  if (cursor) {
    tokens.check(cursor, source);
    if (cursor.queryHash !== queryHash || cursor.offset > source.size) {
      throw new HttpError(400, 'A search cursor can only continue its original query and case setting.', 'INVALID_FILE_CURSOR');
    }
  }
  const searchedFrom = cursor?.offset ?? 0;
  let offset = searchedFrom;
  let line = cursor?.line ?? 1;
  const matches: WorkspaceFileSearchMatch[] = [];
  const deadline = Date.now() + 2_000;
  const scanEnd = Math.min(source.size, offset + SEARCH_SCAN_BYTES);
  // Unicode case folding may change a character's byte width; four bytes per
  // query code unit is a safe upper bound for the bounded overlap.
  const overlap = Math.max(4, query.length * 4);
  const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'gu' : 'giu');
  let full = false;
  while (offset < scanEnd && !full) {
    if (offset > searchedFrom && Date.now() > deadline) break;
    // A byte budget may end inside the next UTF-8 character or CRLF pair.
    // Continue from this valid boundary in the next request instead of treating
    // a perfectly valid long line as malformed text or exceeding the budget.
    if (offset > searchedFrom && scanEnd < source.size && scanEnd - offset < 4) break;
    const bytes = await source.read(offset, Math.min(PAGE_BYTES + overlap + 4, source.size - offset));
    let validEnd = bytes.length;
    if (offset + validEnd < source.size) validEnd = utf8Boundary(bytes, validEnd - 4);
    const text = textBytes(bytes.subarray(0, validEnd));
    let coreEnd = Math.min(PAGE_BYTES, scanEnd - offset, validEnd);
    if (offset + coreEnd < source.size) coreEnd = noSplitBoundary(bytes, coreEnd);
    if (coreEnd <= 0) throw new HttpError(415, 'This file contains an invalid text boundary.', 'BINARY_FILE');
    expression.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = expression.exec(text)) !== null) {
      const start = Buffer.byteLength(text.slice(0, match.index));
      if (start >= coreEnd) break;
      const end = start + Buffer.byteLength(match[0]);
      matches.push({ byteStart: offset + start, byteEnd: offset + end, line: line + lineBreaks(bytes, 0, start),
        preview: text.slice(Math.max(0, match.index - 80), match.index + Math.min(match[0].length, 160) + 120).replace(/[\r\n]/g, ' ') });
      if (matches.length >= MAX_SEARCH_MATCHES) { coreEnd = nextCodePoint(bytes, start); full = true; break; }
      // Literal matches may overlap; advance one complete Unicode character.
      expression.lastIndex = match.index + (text.codePointAt(match.index)! > 0xffff ? 2 : 1);
    }
    line += lineBreaks(bytes, 0, coreEnd);
    offset += coreEnd;
    positions.remember(source.version, offset, line, offset === source.size);
  }
  await source.check();
  const complete = offset === source.size;
  if (complete) positions.remember(source.version, offset, line, true);
  return { path: source.path, size: source.size, version: source.version, query, caseSensitive, matches, searchedFrom,
    scannedThrough: offset, complete, totalLines: positions.total(source.version),
    nextCursor: complete ? null : tokens.sign({ format: 1, kind: 'search', binding: source.binding, version: source.version,
      offset, line, queryHash }) };
}
