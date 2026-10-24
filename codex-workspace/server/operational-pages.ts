import { promises as fs } from 'node:fs';
import { HttpError } from './errors';

export interface OperationalPageInput { offset?: number; limit?: number; q?: string }
export interface OperationalPageInfo { offset: number; limit: number; total: number; hasMore: boolean }
export interface OperationalPage<T> extends OperationalPageInfo { items: T[] }
export interface OperationalPageQuery { offset: number; limit: number; q: string }
interface IndexEntry { id: string; order: string }
const MAX_INDEX_BYTES = 2 * 1024 * 1024;
let activeIndexReads = 0;

const invalidPage = () => new HttpError(400, 'Choose a valid list page and search using at most 160 readable characters.', 'INVALID_OPERATIONAL_PAGE');

/** Public list inputs never become paths, record keys, Git arguments or mutation options. */
export function operationalPageQuery(input: OperationalPageInput = {}): OperationalPageQuery {
  const offset = input.offset ?? 0, limit = input.limit ?? 25, q = input.q ?? '';
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10_000
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 50
    || typeof q !== 'string' || q.length > 160 || /[\u0000-\u001f\u007f]/.test(q)) throw invalidPage();
  return { offset, limit, q: q.trim().toLocaleLowerCase() };
}

export function parseOperationalPageQuery(input: Record<string, unknown>): OperationalPageQuery {
  if (Object.keys(input).some(key => !['offset', 'limit', 'q'].includes(key))) throw invalidPage();
  const integer = (value: unknown): number | undefined => {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,4})$/.test(value)) throw invalidPage();
    return Number(value);
  };
  if (input.q !== undefined && typeof input.q !== 'string') throw invalidPage();
  return operationalPageQuery({ offset: integer(input.offset), limit: integer(input.limit), q: input.q as string | undefined });
}

/** Scan native directory entries in small batches. No eager readdir array, live
 * directory handle cache, background polling or unbounded discovery work. The
 * owning service still validates every matching journal with its strict reader. */
export async function* operationalRecordIds(directory: string, prefix: string, maxRecords: number, code: string,
  acceptId?: (id: string) => boolean, recordLimitStatus = 413): AsyncGenerator<string> {
  let scanned = 0, matching = 0;
  const deadline = Date.now() + 30_000;
  const entries = await fs.opendir(directory, { bufferSize: 64 });
  for await (const entry of entries) {
    if (++scanned > 250_000 || Date.now() > deadline) throw new HttpError(503, 'The saved list could not be read within its discovery limit. Existing files were left unchanged; try again shortly.', `${code}_SCAN_LIMIT`);
    if (!entry.name.startsWith(prefix) || !entry.name.endsWith('.json')) continue;
    const id = entry.name.slice(prefix.length, -5);
    if (acceptId && !acceptId(id)) continue;
    if (++matching > maxRecords) throw new HttpError(recordLimitStatus, 'The saved list exceeds its safe record limit. Existing files were left unchanged.', code);
    yield id;
  }
}

/** Only compact identity/order pairs survive discovery (at most 10,000 pairs).
 * Full journals and native file/Git checks are retained for the requested page
 * alone. There is deliberately no stale metadata cache across requests. */
export async function operationalIndexPage<T>(records: AsyncIterable<T>, query: OperationalPageQuery,
  describe: (record: T) => IndexEntry | null, newestFirst = true): Promise<OperationalPageInfo & { ids: string[] }> {
  if (activeIndexReads >= 4) throw new HttpError(429, 'Several saved lists are loading. Retry this list shortly.', 'OPERATIONAL_LIST_BUSY');
  activeIndexReads++;
  const index: IndexEntry[] = [];
  let bytes = 0;
  try {
    for await (const record of records) {
      const entry = describe(record);
      if (entry) {
        bytes += Buffer.byteLength(entry.id) + Buffer.byteLength(entry.order) + 64;
        if (index.length >= 10_000 || bytes > MAX_INDEX_BYTES) throw new HttpError(413, 'The saved list exceeds its safe metadata limit.', 'OPERATIONAL_LIST_LIMIT');
        index.push(entry);
      }
    }
  } finally {
    activeIndexReads--;
  }
  index.sort((left, right) => (newestFirst ? right.order.localeCompare(left.order) : left.order.localeCompare(right.order)) || left.id.localeCompare(right.id));
  // A completed action can remove the last row of a page. Move to the nearest
  // existing page instead of leaving a stranded empty page or replaying actions.
  const offset = Math.min(query.offset, index.length ? Math.floor((index.length - 1) / query.limit) * query.limit : 0);
  return { ids: index.slice(offset, offset + query.limit).map(entry => entry.id), offset, limit: query.limit,
    total: index.length, hasMore: offset + query.limit < index.length };
}

export function operationalListChanged(): HttpError {
  return new HttpError(409, 'This saved list changed while it was loading. Refresh to see its current entries.', 'OPERATIONAL_LIST_CHANGED');
}
