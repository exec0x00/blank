import { createHash } from 'node:crypto';
import type { ThreadListPage, ThreadSummary } from '../../shared/types';
import { HttpError } from '../errors';
import { PublicCursorCodec } from './public-history';

export const THREAD_LIST_LIMITS = Object.freeze({ entries: 40, maxEntries: 60, queryChars: 200, pageBytes: 384 * 1024,
  metadataBytes: 64 * 1024 * 1024, reconcileMs: 2_000 });

export interface ThreadIndexPageInput {
  workspaceId?: string;
  includeAgents?: boolean;
  archived?: 'active' | 'archived' | 'all';
  query?: string;
  selectedId?: string;
  before?: string;
  after?: string;
  limit?: number;
}

export interface ThreadPageQuery {
  workspaceId?: string; includeAgents: boolean; archived: 'active' | 'archived' | 'all'; query: string;
  selectedId?: string; limit: number; scope: string; anchor?: ThreadPosition; newer: boolean;
}
interface ThreadPosition { id: string; updatedAt: string }
export interface ThreadMetadata {
  summary: ThreadSummary; version?: string; source?: string; cacheable: boolean; title: string; bytes: number; cacheBytes: number;
}
export interface ThreadMetadataInput { summary: ThreadSummary; version?: string; source?: string; cacheable?: boolean; freshlyRead?: boolean }
const validId = (value: unknown): value is string => typeof value === 'string' && /^thr_[a-f0-9]{32}$/.test(value);
const compare = (left: ThreadPosition, right: ThreadPosition) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
const invalid = () => new HttpError(400, 'The conversation list page cursor is invalid or belongs to different filters.', 'INVALID_THREAD_CURSOR');

/** A bounded, disposable index of public metadata. Independent summary files and
 * deletion markers remain authoritative; neither cursors nor this cache can
 * restore a conversation. No filtered pages or conversation bodies are cached. */
export class ThreadPageIndex {
  private readonly records = new Map<string, ThreadMetadata>();
  private readonly workspaces = new Map<string, ThreadMetadata[]>();
  private readonly ordered: ThreadMetadata[] = [];
  private readonly cursors: PublicCursorCodec;
  private cachedBytes = 0;

  constructor(secret: string, private readonly maxRecords: number, private readonly maxBytes: number = THREAD_LIST_LIMITS.metadataBytes) {
    this.cursors = new PublicCursorCodec(secret, 'thread-list-v1');
  }

  get(id: string): ThreadMetadata | undefined { return this.records.get(id); }
  ids(): IterableIterator<string> { return this.records.keys(); }
  get size(): number { return this.records.size; }

  clear(): void { this.records.clear(); this.workspaces.clear(); this.ordered.length = 0; this.cachedBytes = 0; }

  private metadata(summary: ThreadSummary, version?: string, source?: string, cacheable = false): ThreadMetadata {
    const title = summary.title.toLowerCase();
    const bytes = Buffer.byteLength(JSON.stringify(summary));
    // Include UTF-16 strings, map/array overhead and metadata fingerprints in the
    // budget, not only the smaller UTF-8 representation sent over the wire.
    const cacheBytes = bytes * 2 + title.length * 2 + (source?.length ?? 0) * 2 + (version?.length ?? 0) * 2 + 512;
    return { summary, version, source, cacheable, title, bytes, cacheBytes };
  }

  private capacity(): never { throw new HttpError(503, 'The conversation metadata index exceeds its memory limit. Saved conversations were left untouched.', 'THREAD_INDEX_CAPACITY'); }

  set(summary: ThreadSummary, version?: string, source?: string, cacheable = false): void {
    const previous = this.records.get(summary.id), record = this.metadata(summary, version, source, cacheable);
    if (!previous && this.records.size >= this.maxRecords || this.cachedBytes - (previous?.cacheBytes ?? 0) + record.cacheBytes > this.maxBytes) this.capacity();
    if (previous) this.delete(summary.id);
    this.records.set(summary.id, record); this.cachedBytes += record.cacheBytes;
    this.ordered.splice(this.boundary(this.ordered, summary, false), 0, record);
    let workspace = this.workspaces.get(summary.workspaceId);
    if (!workspace) { workspace = []; this.workspaces.set(summary.workspaceId, workspace); }
    workspace.splice(this.boundary(workspace, summary, false), 0, record);
  }

  /** Bulk-load once; warm reconciliation changes only the affected sort keys. */
  reconcile(values: ThreadMetadataInput[]): void {
    if (values.length > this.maxRecords) this.capacity();
    if (!this.records.size) {
      const entries = values.map(value => this.metadata(value.summary, value.version, value.source, value.cacheable));
      if (entries.reduce((sum, entry) => sum + entry.cacheBytes, 0) > this.maxBytes) this.capacity();
      entries.sort((left, right) => compare(left.summary, right.summary));
      for (const record of entries) {
        this.records.set(record.summary.id, record); this.cachedBytes += record.cacheBytes; this.ordered.push(record);
        let workspace = this.workspaces.get(record.summary.workspaceId);
        if (!workspace) { workspace = []; this.workspaces.set(record.summary.workspaceId, workspace); }
        workspace.push(record);
      }
      return;
    }
    const seen = new Set(values.map(value => value.summary.id));
    for (const id of this.records.keys()) if (!seen.has(id)) this.delete(id);
    for (const value of values) {
      const previous = this.records.get(value.summary.id);
      if (value.version !== undefined && previous?.version === value.version && previous.cacheable && value.cacheable
        && previous.source === value.source && (!value.freshlyRead || JSON.stringify(previous.summary) === JSON.stringify(value.summary))) continue;
      this.set(value.summary, value.version, value.source, value.cacheable);
    }
  }

  delete(id: string): void {
    const previous = this.records.get(id);
    if (!previous) return;
    this.records.delete(id); this.cachedBytes -= previous.cacheBytes;
    this.ordered.splice(this.boundary(this.ordered, previous.summary, false), 1);
    const workspace = this.workspaces.get(previous.summary.workspaceId)!;
    workspace.splice(this.boundary(workspace, previous.summary, false), 1);
    if (!workspace.length) this.workspaces.delete(previous.summary.workspaceId);
  }

  query(input: ThreadIndexPageInput): ThreadPageQuery {
    if (input.workspaceId !== undefined && (typeof input.workspaceId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,179}$/.test(input.workspaceId))) {
      throw new HttpError(400, 'The conversation workspace is invalid.', 'INVALID_INPUT');
    }
    if (input.includeAgents !== undefined && typeof input.includeAgents !== 'boolean'
      || input.archived !== undefined && !['active', 'archived', 'all'].includes(input.archived)
      || input.selectedId !== undefined && !validId(input.selectedId)
      || input.query !== undefined && (typeof input.query !== 'string' || input.query.length > THREAD_LIST_LIMITS.queryChars || /[\u0000-\u001f\u007f]/.test(input.query))) {
      throw new HttpError(400, 'The conversation list filters are invalid.', 'INVALID_INPUT');
    }
    if (input.before !== undefined && input.after !== undefined) throw new HttpError(400, 'Choose one conversation list page direction.', 'INVALID_INPUT');
    const limit = input.limit ?? THREAD_LIST_LIMITS.entries;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > THREAD_LIST_LIMITS.maxEntries) throw new HttpError(400, 'The conversation list page size is invalid.', 'INVALID_INPUT');
    const query = input.query?.trim().toLowerCase() ?? '', includeAgents = input.includeAgents ?? false, archived = input.archived ?? 'active';
    const scope = createHash('sha256').update(JSON.stringify([input.workspaceId ?? null, includeAgents, archived, query])).digest('base64url');
    let anchor: ThreadPosition | undefined;
    const cursor = input.before ?? input.after;
    if (cursor !== undefined) {
      let value: unknown;
      try { value = this.cursors.decode(cursor); } catch { throw invalid(); }
      if (!Array.isArray(value) || value.length !== 4 || value[0] !== 1 || value[1] !== scope || !validId(value[2])
        || typeof value[3] !== 'string' || value[3].length < 20 || value[3].length > 40 || !Number.isFinite(Date.parse(value[3]))) throw invalid();
      anchor = { id: value[2], updatedAt: value[3] };
    }
    return { workspaceId: input.workspaceId, includeAgents, archived, query, selectedId: input.selectedId, limit, scope,
      ...(anchor ? { anchor } : {}), newer: input.after !== undefined };
  }

  page(query: ThreadPageQuery): ThreadListPage {
    const source = query.workspaceId ? this.workspaces.get(query.workspaceId) ?? [] : this.ordered;
    const scoped = (record: ThreadMetadata) => (query.includeAgents || !record.summary.parentThreadId)
      && (query.archived === 'all' || (query.archived === 'archived' ? !!record.summary.archivedAt : !record.summary.archivedAt));
    const matches = (record: ThreadMetadata) => scoped(record) && (!query.query || record.title.includes(query.query));
    const boundary = query.anchor ? this.boundary(source, query.anchor, !query.newer) : 0;
    const step = query.newer ? -1 : 1;
    let position = query.newer ? boundary - 1 : boundary;
    const chosen: { record: ThreadMetadata; position: number }[] = [];
    const selectedRecord = query.selectedId ? this.records.get(query.selectedId) : undefined;
    const selected = selectedRecord && (!query.workspaceId || selectedRecord.summary.workspaceId === query.workspaceId) && scoped(selectedRecord) ? selectedRecord : undefined;
    // Reserve the sparse current selection and cursor overhead before filling a
    // page; exceptionally large saved titles cannot create an unbounded reply.
    let bytes = selected ? selected.bytes + 2048 : 2048;
    while (position >= 0 && position < source.length) {
      const record = source[position];
      if (matches(record)) {
        if (chosen.length >= query.limit || chosen.length > 0 && bytes + record.bytes > THREAD_LIST_LIMITS.pageBytes) break;
        chosen.push({ record, position }); bytes += record.bytes;
      }
      position += step;
    }
    if (query.newer) chosen.reverse();
    const first = chosen[0], last = chosen.at(-1);
    const any = (start: number, direction: number) => {
      for (let item = start; item >= 0 && item < source.length; item += direction) if (matches(source[item])) return true;
      return false;
    };
    const hasNewer = any(first ? first.position - 1 : boundary - 1, -1);
    const hasOlder = any(last ? last.position + 1 : boundary, 1);
    const encode = (value: ThreadPosition) => this.cursors.encode([1, query.scope, value.id, value.updatedAt]);
    const result: ThreadListPage = {
      items: chosen.map(item => item.record.summary),
      olderCursor: hasOlder && (last || query.anchor) ? encode(last?.record.summary ?? query.anchor!) : null,
      // Keep the newest boundary even when caught up, so arriving threads can be
      // requested after it without making an older window jump to the start.
      newerCursor: first || query.anchor ? encode(first?.record.summary ?? query.anchor!) : null,
      hasOlder, hasNewer,
      ...(selected && !chosen.some(item => item.record.summary.id === selected.summary.id) ? { selected: selected.summary } : {}),
    };
    return structuredClone(result);
  }

  private boundary(source: ThreadMetadata[], position: ThreadPosition, exclusive: boolean): number {
    let low = 0, high = source.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2), order = compare(source[middle].summary, position);
      if (order < 0 || exclusive && order === 0) low = middle + 1; else high = middle;
    }
    return low;
  }
}
