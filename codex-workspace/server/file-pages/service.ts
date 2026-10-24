import type { AppContext } from '../context';
import { HttpError } from '../errors';
import { FilePositionCache } from './cache';
import { filePagesLifecycleFor, type FilePagesLifecycle } from './lifecycle';
import { MAX_READ_OPERATIONS } from './limits';
import { fileInfo, readFilePage } from './read';
import { fileSaveRecords, listFileRecoveries } from './recovery';
import { saveFileRange, type FileSaveOptions } from './save';
import { searchFilePage } from './search';
import { FileSource } from './source';
import { FilePageTokens } from './tokens';
import { caseSensitivity, conflict, filePageOffset, filePageVersion, searchQuery } from './validation';
import type { FilePageReadInput, FilePageSearchInput, FileRangeSaveInput, WorkspaceFileInfo, WorkspaceFilePage, WorkspaceFileSearchResult } from './types';

let reads = 0;
async function readSlot<T>(operation: () => Promise<T>): Promise<T> {
  if (reads >= MAX_READ_OPERATIONS) throw new HttpError(429, 'Several file pages are loading. Try again after those requests finish.', 'FILE_PAGES_BUSY');
  reads++;
  try { return await operation(); }
  finally { reads--; }
}

export class FilePagesService {
  private readonly tokens: FilePageTokens;
  private readonly positions = new FilePositionCache();
  private readonly lifecycle: FilePagesLifecycle;
  constructor(private readonly ctx: AppContext, private readonly saveOptions: FileSaveOptions = {}) {
    this.tokens = new FilePageTokens(ctx.config.sessionSecret);
    this.lifecycle = filePagesLifecycleFor(ctx);
  }

  /** Observes crash leftovers without retrying a save or deleting either path. */
  initialize(): Promise<void> { return this.lifecycle.run(async signal => { await fileSaveRecords(this.ctx, signal); }); }

  /** Timeout rejection keeps the context closed and remaining work tracked. */
  close(timeoutMs?: number): Promise<void> { return this.lifecycle.close(timeoutMs); }

  info(workspaceId: string, input: unknown): Promise<WorkspaceFileInfo> {
    return this.lifecycle.run(signal => readSlot(async () => {
      const source = await FileSource.open(this.ctx, workspaceId, input, undefined, signal);
      try { signal.throwIfAborted(); return fileInfo(source, this.positions); }
      finally { await source.close(); }
    }));
  }

  page(workspaceId: string, input: FilePageReadInput): Promise<WorkspaceFilePage> {
    return this.lifecycle.run(signal => readSlot(async () => {
      const requestedVersion = filePageVersion(input.version);
      const cursor = input.cursor === undefined ? undefined : this.tokens.read(input.cursor, 'page');
      if (cursor && requestedVersion !== undefined && requestedVersion !== cursor.version) conflict();
      const offset = input.offset === undefined && cursor ? cursor.offset : filePageOffset(input.offset);
      if (cursor && cursor.offset !== offset) throw new HttpError(400, 'A page cursor must be used with its original byte offset.', 'INVALID_FILE_CURSOR');
      const source = await FileSource.open(this.ctx, workspaceId, input.path, requestedVersion ?? cursor?.version, signal);
      try { return await readFilePage(source, this.tokens, this.positions, offset, cursor); }
      finally { await source.close(); }
    }));
  }

  search(workspaceId: string, input: FilePageSearchInput): Promise<WorkspaceFileSearchResult> {
    return this.lifecycle.run(signal => readSlot(async () => {
      const version = filePageVersion(input.version, true)!;
      const query = searchQuery(input.query);
      const caseSensitive = caseSensitivity(input.caseSensitive);
      const cursor = input.cursor === undefined ? undefined : this.tokens.read(input.cursor, 'search');
      if (cursor && cursor.version !== version) conflict();
      const source = await FileSource.open(this.ctx, workspaceId, input.path, version, signal);
      try { return await searchFilePage(source, this.tokens, this.positions, query, caseSensitive, cursor); }
      finally { await source.close(); }
    }));
  }

  save(workspaceId: string, input: FileRangeSaveInput): Promise<WorkspaceFilePage> {
    return saveFileRange(this.ctx, this.tokens, this.positions, workspaceId, input, this.saveOptions);
  }

  recoveries(workspaceId: string) { return this.lifecycle.run(signal => listFileRecoveries(this.ctx, workspaceId, signal)); }
}
