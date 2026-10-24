import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { GithubAccount, GithubRepo } from '../shared/types';
import { HttpError } from './errors';

export interface GithubAccountPage {
  accounts: GithubAccount[];
  offset: number;
  total: number;
  nextCursor: string | null;
  previousCursor: string | null;
  revision: string;
  selected?: GithubAccount;
}
export interface GithubAccountPageInput { limit?: number; query?: string; cursor?: string; selectedId?: string }
export interface GithubRepoPage {
  repositories: GithubRepo[];
  nextCursor: string | null;
  previousCursor: string | null;
  /** The provider page being inspected, not a count of matching-result pages. */
  page: number;
  /** Repository positions inspected through this provider page. Not a total. */
  scanned: number;
  hasMore: boolean;
  /** True only after GitHub no longer supplies a next-page relation. */
  searchComplete: boolean;
}

export const GITHUB_ACCOUNT_PAGE_SIZE = 24;
export const GITHUB_REPO_PAGE_SIZE = 30;
const ACCOUNT_ID = /^gh_[1-9][0-9]{0,15}$/;
const MAX_REPO_PAGE = 10_000;
const MAX_CURSOR_LENGTH = 1600;
const DIGEST = /^[A-Za-z0-9_-]{43}$/;

interface AccountCursor { v: 1; scope: 'accounts'; query: string; limit: number; offset: number; revision: string }
interface RepositoryCursor { v: 1; scope: 'repositories'; account: string; query: string; page: number; revision: string }
export interface GithubRepositoryPageInput { page: number; query: string; revision?: string; refresh: boolean }

export const githubListFingerprint = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('base64url');
export const githubAccountListChanged = () => new HttpError(409, 'The GitHub account list changed. Refresh it to continue.', 'GITHUB_ACCOUNT_LIST_CHANGED');
const invalidPage = () => new HttpError(400, 'Choose a valid GitHub page or refresh the current list.', 'INVALID_GITHUB_PAGE');
const connectionChanged = () => new HttpError(409, 'This GitHub connection changed. Refresh the repository list to continue.', 'GITHUB_REPOSITORY_LIST_CHANGED');

function signature(secret: string, encoded: string): string {
  return createHmac('sha256', secret).update('github-list-page-v1\0').update(encoded).digest('base64url');
}

function encode(secret: string, value: AccountCursor | RepositoryCursor): string {
  const encoded = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encoded}.${signature(secret, encoded)}`;
}

function decode(secret: string, value: string): Record<string, unknown> {
  if (value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) throw invalidPage();
  const [encoded, supplied] = value.split('.');
  const expected = signature(secret, encoded);
  if (supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw invalidPage();
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); }
  catch { throw invalidPage(); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalidPage();
  return parsed as Record<string, unknown>;
}

function normalizedQuery(value: unknown): string {
  if (value !== undefined && (typeof value !== 'string' || value.length > 120 || /[\u0000-\u001f\u007f]/.test(value))) throw invalidPage();
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

export function githubAccountsPageInput(input: Record<string, unknown>): GithubAccountPageInput {
  if (Object.keys(input).some(key => !['paged', 'limit', 'cursor', 'query', 'selectedId'].includes(key))
    || Object.values(input).some(value => typeof value !== 'string')
    || input.paged !== undefined && input.paged !== '1'
    || input.limit !== undefined && !/^[1-9]\d?$/.test(input.limit as string)) throw invalidPage();
  const limit = input.limit === undefined ? GITHUB_ACCOUNT_PAGE_SIZE : Number(input.limit);
  if (limit > 50) throw invalidPage();
  const selectedId = input.selectedId as string | undefined;
  if (selectedId && !ACCOUNT_ID.test(selectedId)) throw invalidPage();
  if (input.cursor !== undefined && ((input.cursor as string).length > MAX_CURSOR_LENGTH
    || input.cursor !== '' && !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(input.cursor as string))) throw invalidPage();
  return { limit, query: normalizedQuery(input.query), cursor: input.cursor as string | undefined, ...(selectedId ? { selectedId } : {}) };
}

/** Only the requested rows and optional exact selection cross the API boundary. */
export function githubAccountPage(secret: string, accounts: readonly GithubAccount[], input: GithubAccountPageInput = {}): GithubAccountPage {
  const limit = input.limit ?? GITHUB_ACCOUNT_PAGE_SIZE;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || input.cursor !== undefined && typeof input.cursor !== 'string'
    || input.selectedId !== undefined && !ACCOUNT_ID.test(input.selectedId)) throw invalidPage();
  const query = normalizedQuery(input.query);
  const queryId = githubListFingerprint(query);
  const revision = githubListFingerprint(accounts);
  let offset = 0;
  if (input.cursor) {
    const cursor = decode(secret, input.cursor);
    if (cursor.v !== 1 || cursor.scope !== 'accounts' || cursor.query !== queryId || cursor.limit !== limit
      || typeof cursor.revision !== 'string' || !DIGEST.test(cursor.revision) || typeof cursor.offset !== 'number'
      || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0 || cursor.offset >= 512 || cursor.offset % limit !== 0) throw invalidPage();
    if (cursor.revision !== revision) throw githubAccountListChanged();
    offset = cursor.offset;
  }
  const terms = query.split(' ').filter(Boolean);
  const matching = terms.length ? accounts.filter(account => {
    const haystack = `${account.login} ${account.name}`.toLowerCase();
    return terms.every(term => haystack.includes(term));
  }) : accounts;
  if (offset > 0 && offset >= matching.length) throw githubAccountListChanged();
  const at = (position: number) => encode(secret, { v: 1, scope: 'accounts', query: queryId, limit, offset: position, revision });
  const selected = input.selectedId ? accounts.find(account => account.id === input.selectedId) : undefined;
  return { accounts: matching.slice(offset, offset + limit), offset, total: matching.length, revision,
    previousCursor: offset > 0 ? at(Math.max(0, offset - limit)) : null,
    nextCursor: offset + limit < matching.length ? at(offset + limit) : null,
    ...(selected ? { selected } : {}) };
}

export function githubRepositoryPageInput(secret: string, accountId: string, input: Record<string, unknown>): GithubRepositoryPageInput {
  if (!ACCOUNT_ID.test(accountId) || Object.keys(input).some(key => !['paged', 'page', 'query', 'cursor', 'refresh'].includes(key))
    || Object.values(input).some(value => typeof value !== 'string')
    || input.paged !== undefined && input.paged !== '1'
    || input.refresh !== undefined && !['0', '1'].includes(input.refresh as string)) throw invalidPage();
  const query = normalizedQuery(input.query);
  const refresh = input.refresh === '1';
  if (input.cursor) {
    if (input.page !== undefined || refresh) throw invalidPage();
    const cursor = decode(secret, input.cursor as string);
    if (cursor.v !== 1 || cursor.scope !== 'repositories' || cursor.account !== accountId || cursor.query !== githubListFingerprint(query)
      || typeof cursor.revision !== 'string' || !DIGEST.test(cursor.revision) || typeof cursor.page !== 'number'
      || !Number.isSafeInteger(cursor.page) || cursor.page < 1 || cursor.page > MAX_REPO_PAGE) throw invalidPage();
    return { page: cursor.page, query, revision: cursor.revision, refresh };
  }
  if (input.page !== undefined && (!/^[1-9]\d{0,4}$/.test(input.page as string) || Number(input.page) > MAX_REPO_PAGE)) throw invalidPage();
  return { page: input.page === undefined ? 1 : Number(input.page), query, refresh };
}

export function githubRepositoryPage(secret: string, accountId: string, credentialRevision: string, input: GithubRepositoryPageInput, repositories: GithubRepo[], hasNext: boolean): GithubRepoPage {
  assertGithubRepositoryRevision(input, credentialRevision);
  if (hasNext && input.page >= MAX_REPO_PAGE) {
    throw new HttpError(413, 'GitHub has more repository pages than this browser can request. Refine your account access and try again.', 'GITHUB_REPOSITORY_PAGE_LIMIT');
  }
  const at = (page: number) => encode(secret, { v: 1, scope: 'repositories', account: accountId, query: githubListFingerprint(input.query), page, revision: credentialRevision });
  const terms = input.query.split(' ').filter(Boolean);
  const matches = terms.length ? repositories.filter(repo => {
    const haystack = `${repo.fullName} ${repo.description}`.toLowerCase();
    return terms.every(term => haystack.includes(term));
  }) : repositories;
  return { repositories: matches, page: input.page, scanned: (input.page - 1) * GITHUB_REPO_PAGE_SIZE + repositories.length,
    nextCursor: hasNext ? at(input.page + 1) : null, previousCursor: input.page > 1 ? at(input.page - 1) : null,
    hasMore: hasNext, searchComplete: !hasNext };
}

export function assertGithubRepositoryRevision(input: GithubRepositoryPageInput, credentialRevision: string): void {
  if (input.revision && input.revision !== credentialRevision) throw connectionChanged();
}
