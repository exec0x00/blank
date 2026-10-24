import type { FileContent, WorkspaceFileInfo, WorkspaceFilePage } from '../../../shared/types';
import { ApiError, api, json } from '../../api';
import type { OpenDocument } from './useDocuments';

export const MAX_LARGE_PAGE_EDIT_BYTES = 256 * 1024;
export const MAX_LARGE_DIRTY_BUFFER_BYTES = 8 * 1024 * 1024;
export const MAX_LINE_SEEK_PAGES = 8;

export interface LargeFileTarget { offset: number; cursor?: string }
export interface LargeFileState {
  /** A closed/reopened tab is a new owner, even at the same path. */
  id: number;
  info: WorkspaceFileInfo;
  page?: WorkspaceFilePage;
  target: LargeFileTarget;
  draftBytes?: number;
  loading?: boolean;
  error?: string;
  conflict?: string;
  invalidated?: boolean;
  remote?: WorkspaceFilePage;
  reviewing?: boolean;
  reviewError?: string;
  seek?: { line: number; column: number; nextCursor: string };
  reveal?: { sequence: number; line?: number; column?: number; byte?: number };
}

type Notify = (message: string, kind?: 'error' | 'success' | 'info') => void;
type Request = <T>(path: string, options?: RequestInit) => Promise<T>;
export interface LargeFileOwner {
  get(path: string): OpenDocument | undefined;
  all(): readonly OpenDocument[];
  update(path: string, apply: (document: OpenDocument) => OpenDocument): void;
  blocked(path: string): boolean;
  notify: Notify;
  saving: Set<string>;
  changed(): void;
}

let documentSequence = 0;
const encoder = new TextEncoder();
export const textByteLength = (value: string) => encoder.encode(value).byteLength;
const dirty = (document: OpenDocument) => document.content !== document.savedContent;
const message = (error: unknown) => error instanceof Error ? error.message : 'The file could not be loaded. Please try again.';
const within = (path: string, parent: string) => path === parent || path.startsWith(`${parent}/`);

function metadata(page: WorkspaceFileInfo): WorkspaceFileInfo {
  const { path, size, version, language, paged, maxPageBytes, editable, readOnlyReason, totalLines } = page;
  return { path, size, version, language, paged, maxPageBytes, editable, readOnlyReason, totalLines };
}

function containsLinePosition(page: WorkspaceFilePage, line: number, column: number): boolean {
  if (page.startLine === null || line < page.startLine || (line === page.startLine && page.startsMidLine)) return false;
  const lines = page.content.split(/\r\n|\r|\n/);
  const local = line - page.startLine;
  if (local >= lines.length) return false;
  if (local === lines.length - 1 && page.nextCursor) {
    if (!lines[local].length) return false;
    if (page.endsMidLine && column > lines[local].length + 1) return false;
  }
  return true;
}

export function pagedDocument(info: WorkspaceFileInfo): OpenDocument {
  return {
    path: info.path, size: info.size, version: info.version, language: info.language,
    content: '', savedContent: '',
    largeFile: { id: ++documentSequence, info: metadata(info), target: { offset: 0 } },
  };
}

/** The normal route stat-checks its limit before reading. Small-file behavior stays unchanged. */
export async function readEditorDocument(base: string, path: string, request: Request = api): Promise<OpenDocument> {
  try {
    const file = await request<FileContent>(`${base}/file?path=${encodeURIComponent(path)}`);
    return { ...file, savedContent: file.content };
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 413) throw error;
    const info = await request<WorkspaceFileInfo>(`${base}/file-info?path=${encodeURIComponent(path)}`);
    return pagedDocument(info);
  }
}

export function validPage(page: WorkspaceFilePage, path: string): boolean {
  return Boolean(page && page.path === path && typeof page.content === 'string'
    && typeof page.version === 'string' && page.version && typeof page.pageToken === 'string' && page.pageToken
    && Number.isSafeInteger(page.size) && page.size >= 0
    && Number.isSafeInteger(page.byteStart) && Number.isSafeInteger(page.byteEnd)
    && page.byteStart >= 0 && page.byteEnd >= page.byteStart && page.byteEnd <= page.size
    && page.byteEnd - page.byteStart <= MAX_LARGE_PAGE_EDIT_BYTES
    && textByteLength(page.content) === page.byteEnd - page.byteStart
    && (page.startLine === null || (Number.isSafeInteger(page.startLine) && page.startLine >= 1))
    && (page.endLine === null || (Number.isSafeInteger(page.endLine) && page.endLine >= (page.startLine ?? 1)))
    && (page.totalLines === null || (Number.isSafeInteger(page.totalLines) && page.totalLines >= 1)));
}

export function canReviewRange(document: OpenDocument): boolean {
  const { page, remote } = document.largeFile ?? {};
  return Boolean(page && remote && page.byteStart === remote.byteStart && page.byteEnd === remote.byteEnd && remote.editable);
}

export function largePageVisibleContent(document: OpenDocument, value = document.content): string {
  return document.largeFile?.page?.byteStart === 0 && value.startsWith('\uFEFF') ? value.slice(1) : value;
}

/** Keep only the active clean range; dirty ranges are pinned until saved or explicitly discarded. */
export function evictCleanLargeRanges(documents: OpenDocument[], activePath: string): OpenDocument[] {
  let changed = false;
  const next = documents.map(document => {
    const state = document.largeFile;
    if (!state?.page || document.path === activePath || dirty(document) || document.saving || state.loading || state.reviewing) return document;
    changed = true;
    return { ...document, content: '', savedContent: '', largeFile: { ...state, page: undefined, draftBytes: 0, remote: undefined, reveal: undefined } };
  });
  return changed ? next : documents;
}

/** A path-bound token cannot be reused after a native move. Never rebase a dirty range implicitly. */
export function movedLargeDocument(document: OpenDocument, path: string): OpenDocument {
  const state = document.largeFile;
  if (!state) return document;
  const changed = dirty(document);
  return {
    ...document, path,
    ...(changed ? {} : { content: '', savedContent: '' }),
    largeFile: {
      ...state, info: { ...state.info, path }, invalidated: true, loading: false, reviewing: false,
      page: changed ? state.page : undefined, draftBytes: changed ? state.draftBytes : 0, target: { offset: state.page?.byteStart ?? state.target.offset },
      remote: undefined, seek: undefined, reveal: undefined, error: undefined,
      conflict: changed ? 'This file moved. Your edited page is retained. Review its current location before applying your edits.' : undefined,
    },
  };
}

export function largeEditError(document: OpenDocument, content: string, documents: readonly OpenDocument[]): string | undefined {
  if (!document.largeFile) return undefined;
  if (!document.largeFile.page) return 'Wait for a page to load before editing.';
  if (!document.largeFile.page.editable) return document.largeFile.page.readOnlyReason || 'This file is read-only.';
  if (document.largeFile.loading || document.transferring || document.saving) return 'Wait for the current file operation to finish.';
  if (content === document.savedContent) return undefined;
  const bytes = textByteLength(content);
  if (bytes > Math.min(MAX_LARGE_PAGE_EDIT_BYTES, document.largeFile.info.maxPageBytes)) return 'This edit is too large for one page. Keep the edited page below 256 KiB.';
  const pinned = documents.reduce((total, other) => other.path !== document.path && other.largeFile && dirty(other)
    ? total + (other.largeFile.draftBytes ?? textByteLength(other.content)) + (other.largeFile.page ? other.largeFile.page.byteEnd - other.largeFile.page.byteStart : textByteLength(other.savedContent)) : total, 0);
  if (pinned + bytes + textByteLength(document.savedContent) > MAX_LARGE_DIRTY_BUFFER_BYTES) return 'Save or close another edited large-file tab before adding more unsaved text.';
  return undefined;
}

interface Ticket { controller: AbortController; id: number; epoch: number; lane: string }

/** Network/state controller. No Monaco models, full-file copies, or implicit background scans. */
export class LargeFileDocuments {
  private epoch = 0;
  private requests = new Map<string, Ticket>();
  private revealSequence = 0;
  private readonly base: string;

  constructor(workspaceId: string, private owner: LargeFileOwner, private request: Request = api) {
    this.base = `/workspaces/${encodeURIComponent(workspaceId)}`;
  }

  private begin(path: string, lane = 'page'): Ticket | undefined {
    const document = this.owner.get(path);
    if (!document?.largeFile || this.owner.blocked(path)) return undefined;
    const key = `${lane}:${path}`;
    this.requests.get(key)?.controller.abort();
    const ticket = { controller: new AbortController(), id: document.largeFile.id, epoch: this.epoch, lane };
    this.requests.set(key, ticket);
    return ticket;
  }

  private current(path: string, ticket: Ticket): boolean {
    return ticket.epoch === this.epoch && !ticket.controller.signal.aborted
      && this.requests.get(`${ticket.lane}:${path}`) === ticket
      && this.owner.get(path)?.largeFile?.id === ticket.id && !this.owner.blocked(path);
  }

  private finish(path: string, ticket: Ticket) {
    if (this.requests.get(`${ticket.lane}:${path}`) === ticket) this.requests.delete(`${ticket.lane}:${path}`);
  }

  private patch(path: string, apply: (state: LargeFileState) => LargeFileState) {
    this.owner.update(path, document => document.largeFile ? { ...document, largeFile: apply(document.largeFile) } : document);
  }

  private async page(path: string, target: LargeFileTarget, ticket: Ticket, version?: string): Promise<WorkspaceFilePage> {
    // Signed cursors own their exact continuation offset, including a CRLF
    // join created by an edited range. Do not reconstruct or override it.
    const params = new URLSearchParams({ path, ...(target.cursor ? {} : { offset: String(target.offset) }) });
    if (version) params.set('version', version);
    if (target.cursor) params.set('cursor', target.cursor);
    const page = await this.request<WorkspaceFilePage>(`${this.base}/file-page?${params}`, { signal: ticket.controller.signal });
    if (!validPage(page, path)) throw new Error('The server returned an invalid or oversized file page. Your buffer is unchanged.');
    if (version && page.version !== version) throw new ApiError('This file changed while loading the page.', 409, 'VERSION_CONFLICT');
    return page;
  }

  private adopt(path: string, page: WorkspaceFilePage, target: LargeFileTarget, extra: Partial<LargeFileState> = {}) {
    this.owner.update(path, document => ({
      ...document, path, content: page.content, savedContent: page.content, size: page.size,
      version: page.version, language: page.language, missing: false, external: undefined,
      largeFile: {
        ...document.largeFile!, info: this.info(page), page, target, draftBytes: page.byteEnd - page.byteStart, loading: false, error: undefined,
        conflict: undefined, invalidated: false, remote: undefined, reviewError: undefined,
        seek: undefined, reveal: undefined, ...extra,
      },
    }));
  }

  private info(page: WorkspaceFileInfo): WorkspaceFileInfo {
    return metadata(page);
  }

  private failure(path: string, error: unknown, ticket: Ticket, lane: 'error' | 'reviewError' = 'error') {
    if (!this.current(path, ticket)) return;
    this.owner.update(path, document => ({
      ...document, ...(error instanceof ApiError && error.status === 404 ? { missing: true } : {}),
      largeFile: {
        ...document.largeFile!, [lane]: message(error), loading: false, reviewing: false,
        ...(error instanceof ApiError && error.status === 409 ? { conflict: 'This file changed on disk. Your loaded page is retained.', remote: undefined } : {}),
      },
    }));
  }

  private navigationAllowed(path: string, discard = false): OpenDocument | undefined {
    const document = this.owner.get(path);
    if (!document?.largeFile || this.owner.blocked(path)) return undefined;
    if (document.saving) { this.owner.notify('Wait for this page to finish saving.', 'info'); return undefined; }
    if (!discard && (dirty(document) || document.largeFile.conflict)) {
      this.owner.notify('Save or explicitly discard this page before navigating. Your unsaved text is retained.', 'info');
      return undefined;
    }
    return document;
  }

  async load(path: string, target?: LargeFileTarget, options: { discard?: boolean; fresh?: boolean; revealByte?: number } = {}): Promise<boolean> {
    const source = this.navigationAllowed(path, options.discard);
    if (!source?.largeFile) return false;
    const destination = target ?? source.largeFile.target;
    if (!Number.isSafeInteger(destination.offset) || destination.offset < 0) return false;
    const ticket = this.begin(path);
    if (!ticket) return false;
    const fresh = options.fresh || source.largeFile.invalidated;
    const requested = fresh ? { offset: destination.offset } : destination;
    this.patch(path, state => ({ ...state, loading: true, error: undefined, target: requested, seek: undefined }));
    try {
      const page = await this.page(path, requested, ticket, fresh ? undefined : source.version);
      if (!this.current(path, ticket)) return false;
      if (this.owner.get(path)?.content !== source.content) throw new Error('New edits arrived while the page was loading. Save or discard them before retrying.');
      this.adopt(path, page, requested, options.revealByte === undefined ? {} : { reveal: { sequence: ++this.revealSequence, byte: options.revealByte } });
      return true;
    } catch (error) { this.failure(path, error, ticket); return false; }
    finally { this.finish(path, ticket); }
  }

  async seekLine(path: string, line: number, column = 1, continuation = false): Promise<boolean> {
    const source = this.owner.get(path);
    if (!source?.largeFile || this.owner.blocked(path) || !Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1) return false;
    const existing = source.largeFile.page;
    if (existing && containsLinePosition(existing, line, column)) {
      this.patch(path, state => ({ ...state, seek: undefined, reveal: { sequence: ++this.revealSequence, line, column } }));
      return true;
    }
    if (!this.navigationAllowed(path)) return false;
    const ticket = this.begin(path);
    if (!ticket) return false;
    this.patch(path, state => ({ ...state, loading: true, error: undefined }));
    let target: LargeFileTarget = continuation && source.largeFile.seek?.nextCursor && existing
      ? { offset: existing.byteEnd, cursor: source.largeFile.seek.nextCursor } : { offset: 0 };
    try {
      for (let count = 0; count < MAX_LINE_SEEK_PAGES; count += 1) {
        const page = await this.page(path, target, ticket, source.version);
        if (!this.current(path, ticket)) return false;
        if (this.owner.get(path)?.content !== source.content) throw new Error('New edits arrived while locating the line. Your buffer is unchanged.');
        if (containsLinePosition(page, line, column)) {
          this.adopt(path, page, target, { reveal: { sequence: ++this.revealSequence, line, column } });
          return true;
        }
        if (!page.nextCursor) {
          this.adopt(path, page, target, { error: `The file ends${page.totalLines === null ? '' : ` at line ${page.totalLines.toLocaleString()}`}. That line is not available.` });
          return false;
        }
        if (count === MAX_LINE_SEEK_PAGES - 1) {
          this.adopt(path, page, target, { seek: { line, column, nextCursor: page.nextCursor } });
          return false;
        }
        target = { offset: page.byteEnd, cursor: page.nextCursor };
      }
      return false;
    } catch (error) { this.failure(path, error, ticket); return false; }
    finally { this.finish(path, ticket); }
  }

  async refresh(path: string): Promise<void> {
    const source = this.owner.get(path);
    if (!source?.largeFile || source.saving || source.largeFile.loading || this.owner.blocked(path) || this.requests.has(`refresh:${path}`)) return;
    const ticket = this.begin(path, 'refresh');
    if (!ticket) return;
    try {
      const info = await this.request<WorkspaceFileInfo>(`${this.base}/file-info?path=${encodeURIComponent(path)}`, { signal: ticket.controller.signal });
      if (!this.current(path, ticket)) return;
      const current = this.owner.get(path);
      if (!current?.largeFile || current.saving || current.largeFile.loading || current.version !== source.version) return;
      if (info.version === source.version && !current.missing && !current.largeFile.invalidated) return;
      if (dirty(current)) {
        if (current.largeFile.remote?.version === info.version && !current.missing) return;
        this.patch(path, state => ({ ...state,
          // A native move already explains why this path-bound page is held.
          // Metadata polling must retain that reason and its invalidated token.
          conflict: state.invalidated && state.conflict ? state.conflict
            : 'This file changed on disk. Your edited page is retained. Review the current range before applying your edits.',
          remote: undefined }));
      } else if (current.largeFile.page) {
        await this.load(path, { offset: Math.min(current.largeFile.page.byteStart, Math.max(0, info.size - 1)) }, { fresh: true, discard: true });
      } else {
        this.owner.update(path, document => ({ ...document, size: info.size, version: info.version, missing: false,
          largeFile: { ...document.largeFile!, info, invalidated: false, target: { offset: Math.min(document.largeFile!.target.offset, Math.max(0, info.size - 1)) } },
        }));
      }
    } catch (error) {
      if (this.current(path, ticket) && error instanceof ApiError && (error.status === 404 || error.status === 409)) this.failure(path, error, ticket);
    } finally { this.finish(path, ticket); }
  }

  async inspectConflict(path: string): Promise<void> {
    const source = this.owner.get(path);
    if (!source?.largeFile?.page || source.saving) return;
    const ticket = this.begin(path, 'review');
    if (!ticket) return;
    this.patch(path, state => ({ ...state, reviewing: true, reviewError: undefined }));
    try {
      const remote = await this.page(path, { offset: source.largeFile.page.byteStart }, ticket);
      if (!this.current(path, ticket)) return;
      this.patch(path, state => ({ ...state, remote, reviewing: false, reviewError: undefined }));
    } catch (error) { this.failure(path, error, ticket, 'reviewError'); }
    finally { this.finish(path, ticket); }
  }

  async save(path: string, reviewed = false): Promise<boolean> {
    const source = this.owner.get(path);
    if (!source?.largeFile || this.owner.blocked(path) || source.saving) return false;
    if (!dirty(source) && !source.largeFile.conflict && !source.missing) return true;
    if (source.missing) { this.owner.notify('This file was removed. Copy your edited page before closing or reloading it.', 'error'); return false; }
    const state = source.largeFile;
    const page = reviewed && canReviewRange(source) ? state.remote : state.page;
    if (!page || !page.editable) { this.owner.notify(page?.readOnlyReason || 'This page is not available for editing.', 'error'); return false; }
    if (reviewed && !canReviewRange(source)) { this.owner.notify('The current file has different page boundaries. Copy your edited page and reload before applying changes.', 'error'); return false; }
    if (!reviewed && (state.conflict || state.invalidated)) { this.owner.notify('Review the current file range before applying your edited page.', 'error'); return false; }
    const tooLarge = largeEditError(source, source.content, this.owner.all());
    if (tooLarge) { this.owner.notify(tooLarge, 'error'); return false; }
    this.invalidate([path]);
    const ticket = this.begin(path, 'save');
    if (!ticket) return false;
    this.owner.saving.add(path);
    this.owner.update(path, document => ({ ...document, saving: true }));
    try {
      const saved = await this.request<WorkspaceFilePage>(`${this.base}/file-range`, {
        ...json('PUT', { path, pageToken: page.pageToken, content: source.content }), signal: ticket.controller.signal,
      });
      if (!this.current(path, ticket)) return false;
      if (!validPage(saved, path) || saved.byteStart !== page.byteStart || saved.content !== source.content) {
        this.patch(path, value => ({ ...value, conflict: 'The save returned an unexpected page. Your edits are retained. Review the current range before retrying.' }));
        throw new Error('The save response did not describe the exact edited range. Reload or review the file before continuing.');
      }
      const current = this.owner.get(path)!;
      const newer = current.content;
      this.adopt(path, saved, { offset: saved.byteStart });
      if (newer !== source.content) this.owner.update(path, document => ({ ...document, content: newer, largeFile: { ...document.largeFile!, draftBytes: textByteLength(newer) } }));
      this.owner.changed();
      return true;
    } catch (error) {
      if (this.current(path, ticket)) {
        this.failure(path, error, ticket);
        this.owner.notify(message(error), 'error');
      }
      return false;
    } finally {
      if (ticket.epoch === this.epoch && this.owner.get(path)?.largeFile?.id === ticket.id) {
        this.owner.saving.delete(path);
        this.owner.update(path, document => ({ ...document, saving: false }));
      }
      this.finish(path, ticket);
    }
  }

  invalidate(prefixes: readonly string[]) {
    for (const [key, ticket] of this.requests) {
      const path = key.slice(key.indexOf(':') + 1);
      if (!prefixes.some(prefix => within(path, prefix))) continue;
      ticket.controller.abort(); this.requests.delete(key);
    }
    for (const document of this.owner.all()) {
      if (!document.largeFile || !prefixes.some(prefix => within(document.path, prefix))) continue;
      this.patch(document.path, state => ({ ...state, loading: false, reviewing: false }));
    }
  }

  reset() {
    this.epoch += 1;
    for (const ticket of this.requests.values()) ticket.controller.abort();
    this.requests.clear();
    for (const document of this.owner.all()) {
      if (!document.largeFile) continue;
      this.owner.saving.delete(document.path);
      this.owner.update(document.path, current => ({ ...current, saving: false, largeFile: { ...current.largeFile!, loading: false, reviewing: false } }));
    }
  }
}
