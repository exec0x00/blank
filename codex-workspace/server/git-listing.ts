import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import type { GitFile } from '../shared/types';
import { HttpError } from './errors';

export interface GitStatusSummary {
  isRepository: boolean;
  branch: string;
  ahead: number;
  behind: number;
  remote?: string;
  changedFileCount: number;
  stagedCount: number;
  changesCount: number;
  conflictCount: number;
  /** Changes-list identity, independent of the remote URL. */
  revision?: string;
}

interface GitPageInfo { offset: number; total: number; nextCursor?: string; previousCursor?: string; revision: string }
export interface GitFilePage extends GitPageInfo { files: GitFile[] }
export interface GitBranchPage extends GitPageInfo { branches: string[] }
export interface GitListQuery { scope: string; query: string; limit: number; offset: number; revision?: string }

const INVALID_PAGE = () => new HttpError(400, 'Choose a valid Git page or refresh the list.', 'INVALID_GIT_PAGE');
const changedPage = () => new HttpError(409, 'The repository changed while you were browsing. Refresh this list to show the current results.', 'GIT_LIST_CHANGED');
const MAX_CURSOR = 4096;

/** Cursors contain only bounded pagination metadata and cannot select paths or
 * execute a Git argument. Binding them to scope/query prevents cross-list use. */
export function parseGitListQuery(input: Record<string, unknown>, scope: string): GitListQuery {
  if (input.limit !== undefined && (typeof input.limit !== 'string' || !/^[1-9]\d{0,2}$/.test(input.limit))) throw INVALID_PAGE();
  const limit = input.limit === undefined ? 50 : Number(input.limit);
  if (limit > 100) throw INVALID_PAGE();
  if (input.query !== undefined && (typeof input.query !== 'string' || input.query.length > 300 || input.query.includes('\0'))) throw INVALID_PAGE();
  const query = typeof input.query === 'string' ? input.query.trim().toLowerCase() : '';
  if (input.cursor === undefined || input.cursor === '') return { scope, query, limit, offset: 0 };
  if (typeof input.cursor !== 'string' || input.cursor.length > MAX_CURSOR || !/^[A-Za-z0-9_-]+$/.test(input.cursor)) throw INVALID_PAGE();
  let saved: unknown;
  try { saved = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')); } catch { throw INVALID_PAGE(); }
  if (!saved || typeof saved !== 'object') throw INVALID_PAGE();
  const cursor = saved as Record<string, unknown>;
  if (cursor.v !== 1 || cursor.scope !== scope || cursor.query !== query || cursor.limit !== limit || typeof cursor.offset !== 'number'
    || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0 || cursor.offset > 1_000_000_000
    || typeof cursor.revision !== 'string' || !/^[a-f0-9]{64}$/.test(cursor.revision)) throw INVALID_PAGE();
  return { scope, query, limit, offset: cursor.offset, revision: cursor.revision };
}

function pageInfo(query: GitListQuery, total: number, revision: string): GitPageInfo {
  if (query.revision && query.revision !== revision) throw changedPage();
  if (query.offset > total) throw INVALID_PAGE();
  const cursor = (offset: number) => Buffer.from(JSON.stringify({ v: 1, scope: query.scope, query: query.query, limit: query.limit, offset, revision })).toString('base64url');
  return {
    offset: query.offset, total, revision,
    ...(query.offset > 0 ? { previousCursor: cursor(Math.max(0, query.offset - query.limit)) } : {}),
    ...(query.offset + query.limit < total ? { nextCursor: cursor(query.offset + query.limit) } : {}),
  };
}

/** Tokenize in bounded chunks, including UTF-8 and filename delimiters split
 * across pipe reads. Git path/ref records are limited independently of output. */
class GitRecords {
  private readonly decoder = new StringDecoder('utf8');
  private pending = '';
  constructor(private readonly delimiter: string, private readonly consume: (record: string) => void) {}
  write(chunk: Buffer): void { this.consumeText(this.decoder.write(chunk)); }
  private consumeText(text: string): void {
    let start = 0;
    for (let end = text.indexOf(this.delimiter); end !== -1; end = text.indexOf(this.delimiter, start)) {
      const record = this.pending + text.slice(start, end);
      if (record.length > 16 * 1024) throw new HttpError(413, 'A Git entry is too long to display safely.', 'GIT_ENTRY_LIMIT');
      this.pending = '';
      this.consume(record);
      start = end + this.delimiter.length;
    }
    this.pending += text.slice(start);
    if (this.pending.length > 16 * 1024) throw new HttpError(413, 'A Git entry is too long to display safely.', 'GIT_ENTRY_LIMIT');
  }
  finish(): void {
    this.consumeText(this.decoder.end());
    if (this.pending) { const last = this.pending; this.pending = ''; this.consume(last); }
  }
}

export const emptyGitSummary = (): GitStatusSummary => ({ isRepository: false, branch: '', ahead: 0, behind: 0, changedFileCount: 0, stagedCount: 0, changesCount: 0, conflictCount: 0 });

/** Keep only one requested page while git status streams. Counts are computed
 * per porcelain record, so repositories never require an all-paths Set. */
export class GitStatusScanner {
  private readonly hash = createHash('sha256');
  private readonly records: GitRecords;
  private pendingRename: string | undefined;
  private readonly files: GitFile[] = [];
  private readonly selectedFiles: GitFile[] = [];
  private total = 0;
  private readonly summary: GitStatusSummary = { ...emptyGitSummary(), isRepository: true };
  constructor(scope: string, private readonly page?: { query: GitListQuery; staged: boolean }, private readonly selectedPaths?: ReadonlySet<string>) {
    this.hash.update(scope).update('\0status\0');
    this.records = new GitRecords('\0', record => this.record(record));
  }
  write(chunk: Buffer): void { this.hash.update(chunk); this.records.write(chunk); }
  private record(record: string): void {
    if (this.pendingRename !== undefined) {
      const rename = this.pendingRename; this.pendingRename = undefined;
      this.file(rename, record);
    } else if (record.startsWith('## ')) {
      const header = record.slice(3);
      const branch = header.replace(/^(?:No commits yet on|Initial commit on) /, '').split('...')[0].split(' [')[0];
      this.summary.branch = branch.startsWith('HEAD ') ? 'HEAD' : branch;
      this.summary.ahead = Number(header.match(/ahead (\d+)/)?.[1] ?? 0);
      this.summary.behind = Number(header.match(/behind (\d+)/)?.[1] ?? 0);
    } else if (record.length >= 4) {
      if (/[RC]/.test(record.slice(0, 2))) this.pendingRename = record;
      else this.file(record);
    }
  }
  private file(record: string, originalPath?: string): void {
    const index = record[0], working = record[1], filePath = record.slice(3);
    if (!filePath) return;
    this.summary.changedFileCount++;
    const add = (status: string, staged: boolean) => {
      if (staged) this.summary.stagedCount++; else this.summary.changesCount++;
      if (status === 'U') this.summary.conflictCount++;
      if (this.selectedPaths?.has(filePath)) this.selectedFiles.push({ path: filePath, status, staged, ...(originalPath ? { originalPath } : {}) });
      if (!this.page || this.page.staged !== staged) return;
      const { query } = this.page;
      if (query.query && !`${filePath}\n${originalPath ?? ''}`.toLowerCase().includes(query.query)) return;
      const position = this.total++;
      if (position < query.offset || position >= query.offset + query.limit) return;
      this.files.push({ path: filePath, status, staged, ...(originalPath ? { originalPath } : {}) });
    };
    if (index === '?' && working === '?') add('?', false);
    else if (index === 'U' || working === 'U' || ['AA', 'DD'].includes(index + working)) add('U', false);
    else {
      if (index !== ' ' && index !== '!') add(index, true);
      if (working !== ' ' && working !== '!') add(working, false);
    }
  }
  finish(): { summary: GitStatusSummary; page?: GitFilePage; selectedFiles: GitFile[] } {
    this.records.finish();
    if (this.pendingRename !== undefined) throw changedPage();
    const revision = this.hash.digest('hex');
    this.summary.revision = revision;
    return { summary: this.summary, selectedFiles: this.selectedFiles, ...(this.page ? { page: { files: this.files, ...pageInfo(this.page.query, this.total, revision) } } : {}) };
  }
}

export class GitBranchScanner {
  private readonly hash = createHash('sha256');
  private readonly records: GitRecords;
  private readonly branches: string[] = [];
  private total = 0;
  constructor(private readonly query: GitListQuery) {
    this.hash.update(query.scope).update('\0branches\0');
    this.records = new GitRecords('\n', branch => {
      if (!branch || branch.endsWith('/HEAD') || query.query && !branch.toLowerCase().includes(query.query)) return;
      const position = this.total++;
      if (position >= query.offset && position < query.offset + query.limit) this.branches.push(branch);
    });
  }
  write(chunk: Buffer): void { this.hash.update(chunk); this.records.write(chunk); }
  finish(): GitBranchPage { this.records.finish(); return { branches: this.branches, ...pageInfo(this.query, this.total, this.hash.digest('hex')) }; }
}
