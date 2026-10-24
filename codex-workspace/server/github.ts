import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import type { GithubAccount, GithubRepo, Workspace } from '../shared/types';
import type { AppContext } from './context';
import { HttpError } from './errors';
import { decryptBuffer, encryptBuffer } from './crypto';
import { acquireWorkspaceActivity } from './worktrees/activity';
import { errno, identity, lstatMaybe, PinnedDirectory, sameIdentity, workspaceStorage } from './workspace-trash/filesystem';
import { GithubImportStage, githubImportRecovery } from './github-import-staging';
import { GithubRepositoryCache } from './github-repository-cache';
import {
  assertGithubRepositoryRevision, GITHUB_REPO_PAGE_SIZE, githubAccountListChanged,
  githubAccountPage, githubAccountsPageInput, githubListFingerprint, githubRepositoryPage, githubRepositoryPageInput,
  type GithubAccountPage, type GithubAccountPageInput,
} from './github-listing';
export { initializeGithubImports } from './github-import-staging';

const GITHUB_VERSION = '2026-03-10';
const ACCOUNT_KEY = 'github-accounts';
const VERSION_PREFIX = 'github-account-version-';
const LEGACY_PREFIX = 'github-account-base-';
const DISCONNECT_PREFIX = 'github-account-disconnect-';
const ACCOUNT_ID = /^gh_[1-9][0-9]{0,15}$/;
const VERSION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_ACCOUNT_HISTORY = 2048;
const MAX_REGISTRY_RECORDS = 32768;
const MAX_ACCOUNTS = 512;
const FULL_NAME = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}\/[a-zA-Z0-9_.-]{1,100}$/;
const accountMutations = new WeakMap<AppContext, Promise<unknown>>();
const legacyImports = new WeakMap<AppContext, Promise<void>>();

interface AccountObservation { versions: string[]; disconnects: string[]; legacy: boolean }
interface AccountVersion {
  schema: 1;
  kind: 'connection';
  account: GithubAccount;
  version: string;
  encryptedToken: string;
  supersedes: string[];
  disconnects: string[];
}
interface DisconnectMarker { schema: 1; kind: 'disconnect'; accountId: string; version: string; disconnectedAt: string }
interface AccountState {
  observation: AccountObservation;
  status: 'absent' | 'disconnected' | 'connected' | 'conflict' | 'reconnect';
  account?: GithubAccount;
  token?: string;
  heads: string[];
}

function accountConflict(): HttpError {
  return new HttpError(409, 'This GitHub connection changed while you were connecting. Connect the account again to use the token you intend.', 'GITHUB_CONNECTION_CONFLICT');
}

function accountStateError(): HttpError {
  return new HttpError(409, 'Saved GitHub connection data is invalid. Existing credentials were left unchanged.', 'GITHUB_STATE_INVALID');
}

function reconnectError(): HttpError {
  return new HttpError(409, 'Connect this GitHub account again to restore its saved credential.', 'GITHUB_RECONNECT');
}

function emptyObservation(): AccountObservation { return { versions: [], disconnects: [], legacy: false }; }
function sameIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function publicAccount(value: unknown, expectedId?: string): GithubAccount {
  const item = value as Partial<GithubAccount> | null;
  if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !ACCOUNT_ID.test(item.id)
    || expectedId !== undefined && item.id !== expectedId || typeof item.login !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(item.login)
    || typeof item.name !== 'string' || item.name.length > 200 || typeof item.avatarUrl !== 'string' || item.avatarUrl.length > 2048
    || typeof item.createdAt !== 'string' || item.createdAt.length > 64 || !Number.isFinite(Date.parse(item.createdAt))) throw accountStateError();
  return { id: item.id, login: item.login, name: item.name, avatarUrl: item.avatarUrl, createdAt: item.createdAt };
}

function checkedIds(value: unknown, allowLegacy = false): string[] {
  if (!Array.isArray(value) || value.length > MAX_ACCOUNT_HISTORY || value.some(id => typeof id !== 'string' || !(VERSION_ID.test(id) || allowLegacy && id === 'legacy'))
    || new Set(value).size !== value.length) throw accountStateError();
  return [...value].sort();
}

function checkedVersion(value: unknown, id: string, expectedVersion: string): AccountVersion {
  const item = value as Partial<AccountVersion> | null;
  if (!item || typeof item !== 'object' || item.schema !== 1 || item.kind !== 'connection' || item.version !== expectedVersion
    || typeof item.encryptedToken !== 'string' || !/^[A-Za-z0-9+/=]{44,4096}$/.test(item.encryptedToken)) throw accountStateError();
  const supersedes = checkedIds(item.supersedes, true);
  if (supersedes.includes(expectedVersion)) throw accountStateError();
  return { schema: 1, kind: 'connection', account: publicAccount(item.account, id), version: expectedVersion,
    encryptedToken: item.encryptedToken, supersedes, disconnects: checkedIds(item.disconnects) };
}

function tokenFromVersion(ctx: AppContext, value: AccountVersion): string {
  try {
    const token = decryptBuffer(Buffer.from(value.encryptedToken, 'base64'), ctx.config.encryptionKey).toString('utf8');
    if (!/^[\x21-\x7e]{20,1024}$/.test(token)) throw reconnectError();
    return token;
  } catch { throw reconnectError(); }
}

/** Immutable unique keys avoid read/modify/write of a shared account or secret map. */
async function observeRegistry(ctx: AppContext): Promise<Map<string, AccountObservation>> {
  const entries = await readdir(ctx.config.stateDir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const result = new Map<string, AccountObservation>();
  let records = 0;
  for (const entry of entries) {
    const version = /^github-account-version-(gh_[1-9][0-9]{0,15})-([a-f0-9-]{36})\.json$/.exec(entry.name);
    const disconnect = /^github-account-disconnect-(gh_[1-9][0-9]{0,15})-([a-f0-9-]{36})\.json$/.exec(entry.name);
    const legacy = /^github-account-base-(gh_[1-9][0-9]{0,15})\.json$/.exec(entry.name);
    const match = version ?? disconnect ?? legacy;
    if (!match) continue;
    if (!entry.isFile() || match[2] && !VERSION_ID.test(match[2])) throw accountStateError();
    records += 1;
    if (records > MAX_REGISTRY_RECORDS) throw new HttpError(413, 'Saved GitHub connection history exceeds its storage limit.', 'GITHUB_HISTORY_LIMIT');
    const found = result.get(match[1]) ?? emptyObservation();
    if (version) found.versions.push(version[2]);
    else if (disconnect) found.disconnects.push(disconnect[2]);
    else found.legacy = true;
    if (found.versions.length + found.disconnects.length > MAX_ACCOUNT_HISTORY || result.size >= MAX_ACCOUNTS && !result.has(match[1])) {
      throw new HttpError(413, 'Saved GitHub connection history exceeds its storage limit.', 'GITHUB_HISTORY_LIMIT');
    }
    result.set(match[1], found);
  }
  for (const observation of result.values()) { observation.versions.sort(); observation.disconnects.sort(); }
  return result;
}

async function legacyAccounts(ctx: AppContext): Promise<GithubAccount[]> {
  const legacy = await ctx.store.read<unknown>(ACCOUNT_KEY, []);
  if (!Array.isArray(legacy) || legacy.length > MAX_ACCOUNTS) throw accountStateError();
  const accounts = legacy.map(item => publicAccount(item));
  if (new Set(accounts.map(account => account.id)).size !== accounts.length) throw accountStateError();
  return accounts;
}

async function importLegacyAccounts(ctx: AppContext): Promise<void> {
  const running = legacyImports.get(ctx);
  if (running) return running;
  const operation = (async () => {
    const legacy = await legacyAccounts(ctx);
    if (!legacy.length) return;
    const observed = await observeRegistry(ctx);
    const pending = legacy.filter(account => {
      const existing = observed.get(account.id);
      return !existing?.legacy && !existing?.versions.length && !existing?.disconnects.length;
    });
    if (!pending.length) return;
    const credentials = await ctx.store.read<Record<string, string>>('protected-credentials', {});
    for (const account of pending) {
      // Native versions and disconnect intent always take priority. A delayed
      // migration can publish only a separate base, never a current version.
      const encryptedToken = credentials?.[`github-${account.id}`];
      if (typeof encryptedToken !== 'string') continue;
      let base: AccountVersion;
      try {
        base = checkedVersion({ schema: 1, kind: 'connection', account, version: 'legacy', encryptedToken, supersedes: [], disconnects: [] }, account.id, 'legacy');
        tokenFromVersion(ctx, base);
      } catch { continue; } // Incomplete legacy pairs are never published as connections.
      const key = `${LEGACY_PREFIX}${account.id}`;
      try { await ctx.store.update<AccountVersion | null>(key, null, current => current ?? base); }
      catch (error) {
        if (!(error instanceof HttpError && error.code === 'STATE_CONFLICT') || !await ctx.store.read(key, null)) throw error;
      }
    }
  })();
  legacyImports.set(ctx, operation);
  try { await operation; }
  finally { if (legacyImports.get(ctx) === operation) legacyImports.delete(ctx); }
}

/** Resolves canonical display metadata without decrypting any credential. */
async function accountHeads(ctx: AppContext, id: string, observation: AccountObservation): Promise<AccountVersion[]> {
  for (const version of observation.disconnects) {
    const marker = await ctx.store.read<DisconnectMarker | null>(`${DISCONNECT_PREFIX}${id}-${version}`, null);
    if (!marker || marker.schema !== 1 || marker.kind !== 'disconnect' || marker.accountId !== id || marker.version !== version) throw accountStateError();
  }
  const versions: AccountVersion[] = [];
  for (let start = 0; start < observation.versions.length; start += 12) {
    const batch = await Promise.all(observation.versions.slice(start, start + 12).map(async version => {
      const value = await ctx.store.read<unknown>(`${VERSION_PREFIX}${id}-${version}`, null);
      return value === null ? null : checkedVersion(value, id, version);
    }));
    for (const item of batch) if (item) versions.push(item);
  }
  // Native history permanently supersedes migration input. In particular, an
  // old base cannot become active when all native versions are disconnected.
  if (!versions.length && !observation.disconnects.length && observation.legacy) {
    const value = await ctx.store.read<unknown>(`${LEGACY_PREFIX}${id}`, null);
    if (value !== null) versions.push(checkedVersion(value, id, 'legacy'));
  }
  const eligible = versions.filter(version => sameIds(version.disconnects, observation.disconnects));
  // A writer with a stale disconnect view cannot suppress a later connection
  // that did observe the marker, even if it discovered that version's filename.
  const superseded = new Set(eligible.flatMap(version => version.supersedes));
  const heads = eligible.filter(version => !superseded.has(version.version));
  // Ordering affects display metadata only. We never choose between different
  // credentials based on a timestamp, random ID, or an unreliable local CAS.
  heads.sort((left, right) => left.account.createdAt.localeCompare(right.account.createdAt) || left.version.localeCompare(right.version));
  return heads;
}

async function accountState(ctx: AppContext, id: string, observation: AccountObservation): Promise<AccountState> {
  const heads = await accountHeads(ctx, id, observation);
  const state: AccountState = { observation, status: observation.disconnects.length ? 'disconnected' : 'absent', heads: heads.map(item => item.version).sort() };
  if (!heads.length) return state;
  state.account = heads[0].account;
  let tokens: string[];
  try { tokens = heads.map(head => tokenFromVersion(ctx, head)); }
  catch { state.status = 'reconnect'; return state; }
  if (tokens.some(token => token !== tokens[0])) { state.status = 'conflict'; return state; }
  state.status = 'connected';
  state.token = tokens[0]; // Concurrent identical-PAT writes are equivalent.
  return state;
}

/** Exact public metadata, including selections outside a currently visible page.
 * This reader cannot validate, migrate, choose, or unlock a saved credential. */
export async function getGithubAccount(ctx: AppContext, id: string): Promise<GithubAccount | undefined> {
  if (!ACCOUNT_ID.test(id)) throw new HttpError(400, 'Choose a connected GitHub account.', 'GITHUB_ACCOUNT');
  const observation = (await observeRegistry(ctx)).get(id);
  return observation ? (await accountHeads(ctx, id, observation))[0]?.account : undefined;
}

/** Complete compatibility reader for internal migration/persistence work.
 * Public lists use bounded pages and selected accounts use exact metadata. */
export async function listGithubAccounts(ctx: AppContext): Promise<GithubAccount[]> {
  await importLegacyAccounts(ctx);
  const registry = await observeRegistry(ctx);
  const result: GithubAccount[] = [];
  for (const [id, observation] of registry) {
    const state = await accountState(ctx, id, observation);
    if (state.account) result.push(state.account);
  }
  return result.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

interface PublicAccountSnapshot { registry: string; accounts: GithubAccount[]; checkedAt: number }
const publicAccountSnapshots = new WeakMap<AppContext, PublicAccountSnapshot>();
const publicAccountReads = new WeakMap<AppContext, { registry: string; reading: Promise<PublicAccountSnapshot> }>();
const repositoryPages = new WeakMap<AppContext, GithubRepositoryCache>();

function registryFingerprint(registry: Map<string, AccountObservation>): string {
  return githubListFingerprint([...registry].sort(([left], [right]) => left.localeCompare(right)));
}

async function publicAccountSnapshot(ctx: AppContext): Promise<PublicAccountSnapshot> {
  await importLegacyAccounts(ctx);
  const registry = await observeRegistry(ctx);
  const revision = registryFingerprint(registry);
  const existing = publicAccountSnapshots.get(ctx);
  if (existing?.registry === revision && Date.now() - existing.checkedAt < 2000) return existing;
  const pending = publicAccountReads.get(ctx);
  if (pending?.registry === revision) return pending.reading;
  const reading = (async () => {
    const accounts: GithubAccount[] = [];
    // The registry has a hard 512-account bound. Only public metadata enters
    // this derived snapshot; encrypted versions and decoded tokens do not.
    for (const [id, observation] of registry) {
      const account = (await accountHeads(ctx, id, observation))[0]?.account;
      if (account) accounts.push(account);
    }
    accounts.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    if (registryFingerprint(await observeRegistry(ctx)) !== revision) throw githubAccountListChanged();
    const snapshot = { registry: revision, accounts, checkedAt: Date.now() };
    publicAccountSnapshots.set(ctx, snapshot);
    return snapshot;
  })();
  publicAccountReads.set(ctx, { registry: revision, reading });
  try { return await reading; }
  finally { if (publicAccountReads.get(ctx)?.reading === reading) publicAccountReads.delete(ctx); }
}

export async function getGithubAccountsPage(ctx: AppContext, input: GithubAccountPageInput = {}): Promise<GithubAccountPage> {
  const snapshot = await publicAccountSnapshot(ctx);
  const page = githubAccountPage(ctx.config.sessionSecret, snapshot.accounts, input);
  // A current selection is independent of the search/page window and is read
  // canonically again rather than interpreting its absence from a page.
  if (input.selectedId) {
    const selected = await getGithubAccount(ctx, input.selectedId);
    if (selected) page.selected = selected;
    else delete page.selected;
  }
  return page;
}

interface GithubResponse { data: unknown; hasNext: boolean }

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(502, 'GitHub returned an unexpected response. Please try again.', 'GITHUB_RESPONSE');
  }
  return value as Record<string, unknown>;
}

function validFullName(value: unknown): value is string {
  return typeof value === 'string' && FULL_NAME.test(value) && !['.', '..'].includes(value.split('/')[1]);
}

function mapRepository(value: unknown): GithubRepo {
  const item = record(value);
  if (!Number.isSafeInteger(item.id) || !validFullName(item.full_name)) {
    throw new HttpError(502, 'GitHub returned an invalid repository.', 'GITHUB_RESPONSE');
  }
  const fullName = item.full_name;
  return {
    id: item.id as number,
    name: fullName.split('/')[1],
    fullName,
    description: typeof item.description === 'string' ? item.description.slice(0, 2048) : '',
    private: item.private === true,
    defaultBranch: typeof item.default_branch === 'string' ? item.default_branch : 'main',
    updatedAt: typeof item.updated_at === 'string' ? item.updated_at : '',
    url: `https://github.com/${fullName}`,
  };
}

function mapRepositories(value: unknown): GithubRepo[] {
  if (!Array.isArray(value) || value.length > GITHUB_REPO_PAGE_SIZE) throw new HttpError(502, 'GitHub returned an invalid repository list.', 'GITHUB_RESPONSE');
  return value.map(mapRepository);
}

/** Direct HTTPS deliberately does not consult HTTP(S)_PROXY or a proxy dispatcher. */
function githubRequest(token: string, apiPath: string): Promise<GithubResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, result?: GithubResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (error) reject(error);
      else resolve(result!);
    };
    const req = httpsRequest({
      protocol: 'https:', hostname: 'api.github.com', port: 443,
      method: 'GET', path: apiPath, agent: false,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'Codex-Workspace',
        'X-GitHub-Api-Version': GITHUB_VERSION,
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) {
          const error = new HttpError(502, 'GitHub returned too much data. Please try again.', 'GITHUB_RESPONSE');
          finish(error);
          req.destroy();
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      response.on('aborted', () => finish(new HttpError(502, 'The connection to GitHub was interrupted. Try again.', 'GITHUB_UNAVAILABLE')));
      response.on('error', () => finish(new HttpError(502, 'Could not read the response from GitHub. Try again.', 'GITHUB_UNAVAILABLE')));
      response.on('end', () => {
        const status = response.statusCode ?? 502;
        if (status === 401) return finish(new HttpError(401, 'This GitHub token is invalid or expired. Connect the account again with a new token.', 'GITHUB_RECONNECT'));
        if (status === 403 || status === 429) {
          const rateLimited = status === 429 || response.headers['x-ratelimit-remaining'] === '0' || !!response.headers['retry-after'];
          return finish(new HttpError(rateLimited ? 429 : 403, rateLimited
            ? 'GitHub has temporarily limited requests. Wait a moment, then try again.'
            : 'This token does not have access. Check its repository permissions and any organization approval or SSO requirements.', rateLimited ? 'GITHUB_RATE_LIMIT' : 'GITHUB_ACCESS'));
        }
        if (status === 404) return finish(new HttpError(404, 'GitHub could not find this repository, or this account does not have access.', 'GITHUB_NOT_FOUND'));
        if (status < 200 || status >= 300) return finish(new HttpError(502, 'GitHub could not complete this request. Refresh and try again.', 'GITHUB_UNAVAILABLE'));
        try {
          const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const rawLink = response.headers.link ?? '';
          const link = Array.isArray(rawLink) ? rawLink.join(',') : rawLink;
          finish(undefined, { data, hasNext: /<[^>]+>;\s*rel="next"/.test(link) });
        } catch {
          finish(new HttpError(502, 'GitHub returned an unreadable response. Try again.', 'GITHUB_RESPONSE'));
        }
      });
    });
    const deadline = setTimeout(() => {
      finish(new HttpError(504, 'GitHub did not respond in time. Please try again.', 'GITHUB_TIMEOUT'));
      req.destroy();
    }, 25_000);
    deadline.unref();
    req.on('error', () => finish(new HttpError(502, 'Could not connect to GitHub. Please try again.', 'GITHUB_UNAVAILABLE')));
    req.end();
  });
}

async function connectedAccount(ctx: AppContext, id: unknown): Promise<{ account: GithubAccount; token: string; credentialVersion: string }> {
  if (typeof id !== 'string' || !ACCOUNT_ID.test(id)) {
    throw new HttpError(400, 'Choose a connected GitHub account.', 'GITHUB_ACCOUNT');
  }
  await importLegacyAccounts(ctx);
  const observed = (await observeRegistry(ctx)).get(id) ?? emptyObservation();
  const state = await accountState(ctx, id, observed);
  if (state.status === 'conflict') throw accountConflict();
  if (state.status === 'reconnect') throw reconnectError();
  if (state.status === 'connected' && state.account && state.token) return { account: state.account, token: state.token,
    credentialVersion: `${state.heads.join(',')};${observed.disconnects.join(',')}` };
  if (state.status === 'absent' && (await legacyAccounts(ctx)).some(account => account.id === id)) throw reconnectError();
  throw new HttpError(404, 'This GitHub account is no longer connected.', 'GITHUB_ACCOUNT');
}

async function mutateAccounts<T>(ctx: AppContext, action: () => Promise<T>): Promise<T> {
  const previous = accountMutations.get(ctx) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(action);
  accountMutations.set(ctx, next);
  try { return await next; }
  finally { if (accountMutations.get(ctx) === next) accountMutations.delete(ctx); }
}

async function publishConnection(ctx: AppContext, account: GithubAccount, token: string, observed: AccountObservation): Promise<GithubAccount> {
  const current = (await observeRegistry(ctx)).get(account.id) ?? emptyObservation();
  if (!sameIds(current.disconnects, observed.disconnects)) throw accountConflict();
  const previous = await accountState(ctx, account.id, current);
  const equivalentCredential = previous.status === 'connected' && previous.token === token;
  // Resolve only versions observed before the request's GitHub verification.
  // A different in-flight authorization must never silently replace a newer one.
  if (!sameIds(current.versions, observed.versions) && !equivalentCredential) throw accountConflict();
  if (current.versions.length + current.disconnects.length >= MAX_ACCOUNT_HISTORY) {
    throw new HttpError(413, 'Saved GitHub connection history exceeds its storage limit.', 'GITHUB_HISTORY_LIMIT');
  }
  const version = randomUUID();
  const candidate = checkedVersion({
    schema: 1, kind: 'connection', account, version,
    encryptedToken: encryptBuffer(Buffer.from(token, 'utf8'), ctx.config.encryptionKey).toString('base64'),
    supersedes: [...observed.versions, ...(observed.legacy ? ['legacy'] : [])], disconnects: [...observed.disconnects],
  }, account.id, version);
  if (tokenFromVersion(ctx, candidate) !== token) throw reconnectError();
  const key = `${VERSION_PREFIX}${account.id}-${version}`;
  try {
    // Metadata and ciphertext become visible in one atomic JSON replacement.
    // This is a new random key, never a shared map or another version's path.
    // Even equivalent PATs need their own record: another publisher can still
    // fail its post-write check and roll back the candidate we just observed.
    await ctx.store.write(key, candidate);
    const after = (await observeRegistry(ctx)).get(account.id) ?? emptyObservation();
    if (!sameIds(after.disconnects, observed.disconnects)) throw accountConflict();
    const accepted = await accountState(ctx, account.id, after);
    if (accepted.status !== 'connected' || accepted.token !== token || !accepted.account) throw accountConflict();
    return accepted.account;
  } catch (error) {
    // A failed candidate cannot poison the last good credential. Only this
    // request's unique path is removed; prior versions and markers are retained.
    await ctx.store.delete(key);
    throw error;
  }
}

function invalidateIndex(ctx: AppContext, id: string): void {
  repositoryPages.get(ctx)?.invalidate(id);
  publicAccountSnapshots.delete(ctx);
}

function repositoryPath(page: number, perPage: number): string {
  const query = new URLSearchParams({
    affiliation: 'owner,collaborator,organization_member', visibility: 'all',
    sort: 'updated', direction: 'desc', per_page: String(perPage), page: String(page),
  });
  return `/user/repos?${query}`;
}

function safeGitEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'USER', 'LOGNAME', 'LANG', 'TZ']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.LC_ALL = 'C';
  env.GIT_TERMINAL_PROMPT = '0';
  env.GCM_INTERACTIVE = 'Never';
  env.GIT_ASKPASS = '/bin/false';
  env.SSH_ASKPASS = '/bin/false';
  env.GIT_SSH_COMMAND = 'false';
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_SYSTEM = '/dev/null';
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_NO_REPLACE_OBJECTS = '1';
  const settings: [string, string][] = [
    ['credential.helper', ''], ['credential.interactive', 'false'],
    ['core.hooksPath', '/dev/null'], ['http.proxy', ''],
    ['http.https://github.com/.proxy', ''], ['http.followRedirects', 'false'],
    ['http.extraHeader', ''], ['http.https://github.com/.extraHeader', ''],
    ['protocol.allow', 'never'], ['protocol.https.allow', 'always'],
  ];
  env.GIT_CONFIG_COUNT = String(settings.length);
  settings.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  return env;
}

function redactGitMessage(message: string, token?: string): string {
  let result = token ? message.split(token).join('[redacted]') : message;
  result = result.replace(/github_pat_[a-zA-Z0-9_]+|gh[pousr]_[a-zA-Z0-9_]+/g, '[redacted]');
  return result.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1[redacted]@');
}

/** The callback must await its Git process so credentials are removed afterward. */
export async function withGitCredentials<T>(
  ctx: AppContext,
  accountId: string | undefined,
  callback: (env: NodeJS.ProcessEnv) => Promise<T>,
): Promise<T> {
  const env = safeGitEnvironment();
  if (!accountId) return callback(env);
  const { account, token } = await connectedAccount(ctx, accountId);
  const directory = await mkdtemp(path.join(tmpdir(), 'codex-git-askpass-'));
  const askpassConfig = Number(env.GIT_CONFIG_COUNT);
  try {
    await chmod(directory, 0o700);
    const helper = path.join(directory, 'askpass.cjs');
    // The helper contains no secret. It also rejects prompts for another host.
    const script = `#!${process.execPath}\n` + [
      "const prompt = process.argv[2] || '';",
      "const found = prompt.match(/https:\\/\\/[^\\s'\\\"]+/);",
      "let address; try { address = new URL(found ? found[0] : ''); } catch { process.exit(1); }",
      "if (address.protocol !== 'https:' || address.hostname !== 'github.com' || address.port) process.exit(1);",
      "if (prompt.startsWith('Username ')) process.stdout.write((process.env.CW_GITHUB_USERNAME || '') + '\\n');",
      "else if (prompt.startsWith('Password ')) process.stdout.write((process.env.CW_GITHUB_TOKEN || '') + '\\n');",
      'else process.exit(1);',
      '',
    ].join('\n');
    await writeFile(helper, script, { mode: 0o700 });
    env.GIT_ASKPASS = helper;
    env.CW_GITHUB_USERNAME = account.login;
    env.CW_GITHUB_TOKEN = token;
    // Git's credential.interactive=false skips askpass too. Enable our trusted
    // helper for this command only; GIT_TERMINAL_PROMPT=0 still forbids a TTY.
    env[`GIT_CONFIG_KEY_${askpassConfig}`] = 'credential.interactive';
    env[`GIT_CONFIG_VALUE_${askpassConfig}`] = 'true';
    env.GIT_CONFIG_COUNT = String(askpassConfig + 1);
    try {
      return await callback(env);
    } catch (error) {
      if (error instanceof Error) {
        const message = redactGitMessage(error.message, token);
        if (message !== error.message) {
          throw new HttpError(error instanceof HttpError ? error.status : 502, message, error instanceof HttpError ? error.code : 'GIT_FAILED');
        }
      }
      throw error;
    }
  } finally {
    delete env.CW_GITHUB_TOKEN;
    delete env.CW_GITHUB_USERNAME;
    delete env.GIT_ASKPASS;
    delete env[`GIT_CONFIG_KEY_${askpassConfig}`];
    delete env[`GIT_CONFIG_VALUE_${askpassConfig}`];
    env.GIT_CONFIG_COUNT = String(askpassConfig);
    await rm(directory, { recursive: true, force: true });
  }
}

function cloneRepository(fullName: string, destination: string, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', [
      '-c', 'core.hooksPath=/dev/null', '-c', 'credential.helper=',
      '-c', 'http.proxy=', '-c', 'http.followRedirects=false',
      'clone', '--quiet', '--no-hardlinks', '--config', 'core.filemode=false', '--', `https://github.com/${fullName}.git`, destination,
    ], { cwd: path.dirname(destination), env: { ...env, PWD: path.dirname(destination) },
      stdio: ['ignore', 'ignore', 'pipe'], detached: process.platform !== 'win32' });
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let processError = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch { child.kill('SIGKILL'); }
    }, 10 * 60_000);
    timeout.unref();
    child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-4096); });
    child.on('error', () => {
      if (settled) return;
      processError = true;
      // A failed spawn has no native owner. Errors while an existing process is
      // being signalled do not establish exit; staging waits for actual close.
      if (child.pid) return;
      settled = true;
      clearTimeout(timeout);
      reject(new HttpError(500, 'Git could not start on this instance.', 'GIT_UNAVAILABLE'));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (timedOut) return reject(new HttpError(504, 'Import took too long. Refresh the workspace list before retrying.', 'GIT_TIMEOUT'));
      if (processError) return reject(new HttpError(500, 'Git could not finish on this instance.', 'GIT_UNAVAILABLE'));
      if (code === 0) return resolve();
      const detail = redactGitMessage(stderr.trim(), env.CW_GITHUB_TOKEN).slice(-600);
      reject(new HttpError(502, `Could not clone this repository. Check the account's Contents permission.${detail ? ` ${detail}` : ''}`, 'GIT_CLONE_FAILED'));
    });
  });
}

interface ImportDirectory {
  directory: PinnedDirectory;
  native: ReturnType<typeof identity>;
}

function importChanged(): HttpError {
  return new HttpError(409, 'This workspace changed during import. Its current files were left unchanged; refresh before retrying.', 'GITHUB_IMPORT_CHANGED');
}

async function assertImportRegistration(ctx: AppContext, workspace: Workspace): Promise<void> {
  let current: Workspace;
  try { current = await ctx.workspaces.get(workspace.id); }
  catch (error) {
    if (error instanceof HttpError && error.status === 404) throw importChanged();
    throw error;
  }
  if (current.path !== workspace.path || current.createdAt !== workspace.createdAt || current.worktree) throw importChanged();
  // This route allocates a fresh ID. Even an acknowledged restore supersedes
  // that create/import lifecycle; an active registration alone is insufficient.
  if (await ctx.store.read<unknown>(`workspace-archived-${workspace.id}`, null) !== null) throw importChanged();
}

async function assertImportDirectory(ctx: AppContext, workspace: Workspace, owned: ImportDirectory): Promise<void> {
  await assertImportRegistration(ctx, workspace);
  try { await owned.directory.check(); }
  catch (error) {
    if (error instanceof HttpError && error.code === 'WORKSPACE_TRASH_UNSAFE' || errno(error, 'ENOENT')) throw importChanged();
    throw error;
  }
  const current = await lstatMaybe(owned.directory.absolute);
  if (!current?.isDirectory() || current.isSymbolicLink() || !sameIdentity(current, owned.native)
    || !sameIdentity(await owned.directory.handle.stat(), owned.native)) throw importChanged();
  await assertImportRegistration(ctx, workspace);
}

async function pinImportDirectory(ctx: AppContext, workspace: Workspace): Promise<ImportDirectory> {
  await assertImportRegistration(ctx, workspace);
  const base = await workspaceStorage(ctx.config);
  if (workspace.path !== path.join(base, workspace.id)) throw importChanged();
  const directory = await PinnedDirectory.open(workspace.path);
  try {
    // Publication makes the workspace visible to other clients. Files they
    // create before clone admission are not this import's rollback property.
    if ((await readdir(directory.access)).length) throw importChanged();
    const owned = { directory, native: identity(await directory.handle.stat()) };
    await assertImportDirectory(ctx, workspace, owned);
    return owned;
  } catch (error) { await directory.close(); throw error; }
}

/** Returns false when retained bytes need explicit user recovery/deletion. */
async function rollbackImport(ctx: AppContext, workspace: Workspace, owned: ImportDirectory): Promise<boolean> {
  await assertImportRegistration(ctx, workspace);
  const current = await lstatMaybe(owned.directory.absolute);
  if (!current) {
    // Git may remove its failed destination itself. A still-linked pinned root
    // instead means somebody moved it; that lifecycle must retain its metadata.
    if ((await owned.directory.handle.stat()).nlink !== 0) throw importChanged();
  } else {
    await assertImportDirectory(ctx, workspace, owned);
    // A Git activity lease fences deletion, but intentionally permits editor
    // writes. Inode ownership does not make those leaf bytes ours to erase.
    if ((await readdir(owned.directory.access)).length) return false;
    const parent = await PinnedDirectory.open(path.dirname(owned.directory.absolute));
    try {
      await assertImportDirectory(ctx, workspace, owned);
      await parent.check();
      const access = `${parent.access}/${path.basename(owned.directory.absolute)}`;
      const current = await lstatMaybe(access);
      if (!current?.isDirectory() || current.isSymbolicLink() || !sameIdentity(current, owned.native)) throw importChanged();
      // Nonrecursive rmdir atomically refuses a file arriving after readdir.
      // Never walk/delete a nonempty partial clone or a successful repository
      // whose account/provenance completion failed.
      try { await rmdir(access); }
      catch (error) {
        if (errno(error, 'ENOTEMPTY') || errno(error, 'EEXIST')) return false;
        throw error;
      }
      await parent.check();
    } finally { await parent.close(); }
  }
  await assertImportRegistration(ctx, workspace);
  if (await lstatMaybe(owned.directory.absolute) || (await owned.directory.handle.stat()).nlink !== 0) throw importChanged();
  // Internal registration archival remains metadata-only; never route a failed
  // import through user trash/permanent deletion or remove an unrelated root.
  await ctx.workspaces.remove(workspace.id);
  return true;
}

export function createGithubRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/github/accounts', async (req, res) => {
    const input = githubAccountsPageInput(req.query);
    const paged = req.query.paged === '1';
    if (!paged && Object.keys(req.query).length) throw new HttpError(400, 'Use paged=1 to browse or search GitHub accounts.', 'INVALID_GITHUB_PAGE');
    const page = await getGithubAccountsPage(ctx, paged ? input : { limit: 30 });
    res.json(paged ? page : page.accounts);
  });

  router.get('/github/accounts/:id', async (req, res) => {
    const account = await getGithubAccount(ctx, req.params.id);
    if (!account) throw new HttpError(404, 'This GitHub account is no longer connected.', 'GITHUB_ACCOUNT');
    res.json(account);
  });

  router.get('/github/imports/recovery', async (_req, res) => {
    res.json(await githubImportRecovery(ctx));
  });

  router.post('/github/accounts', async (req, res) => {
    const supplied: unknown = req.body?.token;
    if (typeof supplied !== 'string' || !/^[\x21-\x7e]{20,1024}$/.test(supplied.trim())) {
      throw new HttpError(400, 'Enter a valid GitHub personal access token.', 'GITHUB_TOKEN');
    }
    const token = supplied.trim();
    await importLegacyAccounts(ctx);
    const observedRegistry = await observeRegistry(ctx);
    const oldMetadata = await legacyAccounts(ctx);
    const user = record((await githubRequest(token, '/user')).data);
    if (!Number.isSafeInteger(user.id) || Number(user.id) <= 0 || typeof user.login !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(user.login)) {
      throw new HttpError(502, 'GitHub could not verify this account.', 'GITHUB_RESPONSE');
    }
    const id = `gh_${user.id}`;
    let avatarUrl = '';
    try {
      const candidate = new URL(String(user.avatar_url));
      if (candidate.protocol === 'https:' && candidate.hostname === 'avatars.githubusercontent.com' && !candidate.username && !candidate.password) avatarUrl = candidate.href;
    } catch { /* A missing avatar does not stop an account connection. */ }
    const account = await mutateAccounts(ctx, async () => {
      const current = (await observeRegistry(ctx)).get(id) ?? emptyObservation();
      const existing = (await accountState(ctx, id, current)).account ?? oldMetadata.find(item => item.id === id);
      const next: GithubAccount = {
        id, login: user.login as string,
        name: typeof user.name === 'string' ? redactGitMessage(user.name.slice(0, 200), token) : user.login as string,
        avatarUrl, createdAt: existing?.createdAt ?? new Date().toISOString(),
      };
      const saved = await publishConnection(ctx, next, token, observedRegistry.get(id) ?? emptyObservation());
      invalidateIndex(ctx, id);
      return saved;
    });
    ctx.events.emit('github:changed');
    res.status(201).json(account);
  });

  router.delete('/github/accounts/:id', async (req, res) => {
    const id = req.params.id;
    if (typeof id !== 'string' || !ACCOUNT_ID.test(id)) throw new HttpError(400, 'Choose a connected GitHub account.', 'GITHUB_ACCOUNT');
    await importLegacyAccounts(ctx);
    await mutateAccounts(ctx, async () => {
      const observed = (await observeRegistry(ctx)).get(id) ?? emptyObservation();
      const state = await accountState(ctx, id, observed);
      if (!state.account) throw new HttpError(404, 'This GitHub account is no longer connected.', 'GITHUB_ACCOUNT');
      if (observed.versions.length + observed.disconnects.length >= MAX_ACCOUNT_HISTORY) throw new HttpError(413, 'Saved GitHub connection history exceeds its storage limit.', 'GITHUB_HISTORY_LIMIT');
      const version = randomUUID();
      const marker: DisconnectMarker = { schema: 1, kind: 'disconnect', accountId: id, version, disconnectedAt: new Date().toISOString() };
      // Disconnect intent is permanent. Legacy imports and stale verified
      // requests cannot remove it; a new explicit connect must observe it.
      await ctx.store.write(`${DISCONNECT_PREFIX}${id}-${version}`, marker);
      invalidateIndex(ctx, id);
      for (const workspace of await ctx.workspaces.list()) {
        if (workspace.githubAccountId === id) await ctx.workspaces.clearGithubAccount(workspace.id, id);
      }
    });
    ctx.events.emit('github:changed');
    res.json({ removed: true });
  });

  router.get('/github/accounts/:id/repos', async (req, res) => {
    const input = githubRepositoryPageInput(ctx.config.sessionSecret, req.params.id, req.query);
    const { token, account, credentialVersion } = await connectedAccount(ctx, req.params.id);
    const revision = githubListFingerprint(credentialVersion);
    assertGithubRepositoryRevision(input, revision);
    let cache = repositoryPages.get(ctx);
    if (!cache) { cache = new GithubRepositoryCache(); repositoryPages.set(ctx, cache); }
    if (input.refresh) cache.invalidate(account.id);
    // One bounded provider page per request, including sparse searches. The
    // continuation exposes discovery progress without retaining every repo.
    const loaded = await cache.read(account.id, revision, input.page, async () => {
      const response = await githubRequest(token, repositoryPath(input.page, GITHUB_REPO_PAGE_SIZE));
      return { repositories: mapRepositories(response.data), hasNext: response.hasNext };
    });
    const current = await connectedAccount(ctx, account.id);
    assertGithubRepositoryRevision({ ...input, revision }, githubListFingerprint(current.credentialVersion));
    const result = githubRepositoryPage(ctx.config.sessionSecret, account.id, revision, input, loaded.repositories, loaded.hasNext);
    res.json(input.query || req.query.paged === '1' || req.query.cursor ? result : result.repositories);
  });

  router.post('/github/import', async (req, res) => {
    const { accountId, fullName, name } = req.body ?? {};
    if (!validFullName(fullName)) throw new HttpError(400, 'Use a repository name in the form owner/repository.', 'GITHUB_REPOSITORY');
    if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > 80)) throw new HttpError(400, 'Workspace names must be between 1 and 80 characters.');
    const { account, token } = await connectedAccount(ctx, accountId);
    const [owner, repository] = fullName.split('/');
    const metadata = mapRepository((await githubRequest(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`)).data);
    const workspace = await ctx.workspaces.create({ name: typeof name === 'string' ? name.trim() : metadata.name, initializeGit: false });
    // Admission is synchronous and must precede credentials, path checks and
    // spawning. If deletion already owns admission, nothing here may roll back
    // the workspace it is moving or permanently deleting.
    const release = acquireWorkspaceActivity(ctx.config.workspacesDir, workspace.id, 'git');
    let owned: ImportDirectory | undefined;
    let stage: GithubImportStage | undefined;
    let retained = false;
    let imported: Workspace;
    try {
      owned = await pinImportDirectory(ctx, workspace);
      stage = await GithubImportStage.create(ctx, workspace.id, metadata.fullName);
      await stage.clone(destination => withGitCredentials(ctx, account.id, async (env) => {
        await assertImportDirectory(ctx, workspace, owned!);
        if ((await readdir(owned!.directory.access)).length) throw importChanged();
        return cloneRepository(metadata.fullName, destination, env);
      }));
      await assertImportDirectory(ctx, workspace, owned);
      if ((await readdir(owned.directory.access)).length) throw importChanged();
      await stage.publish(owned.directory.absolute, owned.native);
      imported = await mutateAccounts(ctx, async () => {
        await connectedAccount(ctx, account.id);
        await assertImportDirectory(ctx, workspace, owned!);
        return ctx.workspaces.completeGithubImport(workspace.id, account.id, metadata.fullName);
      });
    } catch (error) {
      retained = true;
      if (owned && !(error instanceof HttpError && error.code === 'GITHUB_IMPORT_CHANGED')) {
        try {
          if (!await rollbackImport(ctx, workspace, owned)) {
            throw new HttpError(error instanceof HttpError ? error.status : 500,
              'Import did not finish. This workspace and its files were retained; open it to inspect or retry.', 'GITHUB_IMPORT_RETAINED');
          }
          retained = false;
        }
        catch (cleanupError) {
          if (cleanupError instanceof HttpError && ['GITHUB_IMPORT_CHANGED', 'GITHUB_IMPORT_RETAINED'].includes(cleanupError.code ?? '')) throw cleanupError;
          throw new HttpError(409, 'The import failed and automatic cleanup could not finish. Refresh the workspace list before retrying.', 'GITHUB_IMPORT_CLEANUP_FAILED');
        }
      }
      throw error;
    } finally {
      try { await stage?.finish(retained); }
      finally {
        try { await owned?.directory.close(); }
        finally { release(); }
      }
    }
    ctx.events.emit('workspace:changed', { workspaceId: workspace.id });
    res.status(201).json(imported!);
  });

  return router;
}
