import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import { EventEmitter, once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { RequestOptions } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { GithubAccount, GithubAccountPage, GithubRepoPage } from '../shared/types';
import type { AppContext } from '../server/context';
import { loadConfig } from '../server/config';
import { encryptBuffer } from '../server/crypto';
import { HttpError } from '../server/errors';
import { createGithubRouter, getGithubAccount, getGithubAccountsPage } from '../server/github';
import { JsonStore, SecretStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';

// Every provider reply below is explicit synthetic data. The real router and
// filesystem are exercised; no live GitHub account or provider is contacted.
const transport = vi.hoisted(() => ({
  requests: [] as RequestOptions[],
  reply: undefined as ((options: RequestOptions) => { body: unknown; status?: number; next?: boolean } | Promise<{ body: unknown; status?: number; next?: boolean }>) | undefined,
}));
vi.mock('node:https', async () => {
  const { EventEmitter: Events } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  return { request: (options: RequestOptions, receive: (response: unknown) => void) => {
    transport.requests.push(options);
    const request = new Events() as InstanceType<typeof Events> & { end(): void; destroy(): void };
    request.destroy = () => {};
    request.end = () => queueMicrotask(async () => {
      try {
        if (!transport.reply) throw new Error('GitHub listing fixture is not configured.');
        const fixture = await transport.reply(options);
        const response = Object.assign(new PassThrough(), { statusCode: fixture.status ?? 200,
          headers: fixture.next ? { link: '<https://api.github.com/user/repos?page=2>; rel="next"' } : {} });
        receive(response); response.end(Buffer.from(JSON.stringify(fixture.body)));
      } catch (failure) { request.emit('error', failure); }
    });
    return request;
  } };
});

const TOKEN = 'github_pat_synthetic_listing_fixture_not_real_12345';
let directory: string;
let ctx: AppContext;
let server: Server;
let base: string;
const gates: Array<() => void> = [];

async function account(index: number, name = `Person ${index}`, token = TOKEN): Promise<GithubAccount> {
  const value: GithubAccount = { id: `gh_${index}`, login: `account-${String(index).padStart(3, '0')}`, name, avatarUrl: '', createdAt: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString() };
  const version = randomUUID();
  await ctx.store.write(`github-account-version-${value.id}-${version}`, { schema: 1, kind: 'connection', account: value,
    version, encryptedToken: encryptBuffer(Buffer.from(token), ctx.config.encryptionKey).toString('base64'), supersedes: [], disconnects: [] });
  return value;
}

async function seed(count: number): Promise<GithubAccount[]> {
  const accounts: GithubAccount[] = [];
  for (let start = 1; start <= count; start += 8) accounts.push(...await Promise.all(Array.from({ length: Math.min(8, count - start + 1) }, (_, index) => account(start + index))));
  return accounts;
}

function repository(id: number, fullName = `owner/project-${id}`, privateRepo = true) {
  return { id, full_name: fullName, description: `Fixture repository ${id}`, private: privateRepo, default_branch: 'main', updated_at: '2026-09-20T00:00:00Z' };
}

async function request<T = unknown>(endpoint: string, method = 'GET', body?: unknown): Promise<{ status: number; body: T }> {
  const response = await fetch(`${base}/api${endpoint}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() as T };
}

beforeEach(async () => {
  transport.requests = []; transport.reply = undefined;
  directory = await mkdtemp(path.join(tmpdir(), 'codex-github-listing-'));
  const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: path.join(directory, 'data'), RUNTIME_DIR: path.join(directory, 'runtime'),
    WORKSPACE_PASSWORD: 'listing-fixture-password', SESSION_SECRET: 'listing-fixture-session-secret-over-32-characters',
    ENCRYPTION_KEY: 'listing-fixture-encryption-secret-over-32-characters' });
  const store = new JsonStore(config.stateDir);
  await store.write('workspaces', []);
  const workspaces = new WorkspaceService(config, store);
  await workspaces.initialize();
  ctx = { config, store, workspaces, secrets: new SecretStore(store, config.encryptionKey), events: new EventEmitter() } as AppContext;
  const app = express(); app.use(express.json()); app.use('/api', createGithubRouter(ctx));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(error instanceof HttpError ? error.status : 500).json({ error: error instanceof Error ? error.message : 'Fixture error', code: error instanceof HttpError ? error.code : undefined });
  });
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Listing fixture did not start.');
  base = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  for (const release of gates.splice(0)) release();
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await ctx?.store.flush();
  vi.restoreAllMocks();
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe('paged GitHub public account metadata over HTTP', () => {
  it('returns only a bounded account page and resolves an exact selected account without unlocking credentials', async () => {
    const accounts = await seed(70);
    ctx.config.encryptionKey = 'another-fixture-encryption-key-over-32-characters';
    const first = await request<GithubAccountPage>('/github/accounts?paged=1&selectedId=gh_70');
    expect(first.status).toBe(200);
    expect(first.body.accounts).toEqual(accounts.slice(0, 24));
    expect(first.body).toMatchObject({ offset: 0, total: 70, previousCursor: null, selected: accounts[69] });
    expect(first.body.nextCursor).toBeTypeOf('string');
    const exact = await request<GithubAccount>('/github/accounts/gh_70');
    expect(exact).toEqual({ status: 200, body: accounts[69] });
    expect(await getGithubAccount(ctx, 'gh_70')).toEqual(accounts[69]);
    expect((await request<GithubAccount[]>('/github/accounts')).body).toHaveLength(30);
    expect(JSON.stringify(first.body)).not.toMatch(/encryptedToken|supersedes|github_pat_/);
    expect(transport.requests).toHaveLength(0);
    expect((await request<{ code: string }>('/github/accounts/gh_70/repos')).body.code).toBe('GITHUB_RECONNECT');
    expect(transport.requests).toHaveLength(0);
  });

  it('replaces account pages, follows signed previous/next cursors, and searches all saved public metadata', async () => {
    const accounts = await seed(70);
    const first = (await request<GithubAccountPage>('/github/accounts?paged=1')).body;
    const second = (await request<GithubAccountPage>(`/github/accounts?paged=1&cursor=${encodeURIComponent(first.nextCursor!)}`)).body;
    const third = (await request<GithubAccountPage>(`/github/accounts?paged=1&cursor=${encodeURIComponent(second.nextCursor!)}`)).body;
    expect(second.accounts).toEqual(accounts.slice(24, 48));
    expect(third.accounts).toEqual(accounts.slice(48));
    expect(third).toMatchObject({ offset: 48, total: 70, nextCursor: null });
    const previous = (await request<GithubAccountPage>(`/github/accounts?paged=1&cursor=${encodeURIComponent(third.previousCursor!)}`)).body;
    expect(previous).toEqual(second);
    const search = await request<GithubAccountPage>('/github/accounts?paged=1&query=PERSON%2069&selectedId=gh_70');
    expect(search.body.accounts).toEqual([accounts[68]]);
    expect(search.body).toMatchObject({ total: 1, selected: accounts[69] });
  });

  it('rejects changed, forged, cross-query and cross-limit account cursors without silently losing off-page selections', async () => {
    await seed(30);
    const first = (await request<GithubAccountPage>('/github/accounts?paged=1')).body;
    const cursor = encodeURIComponent(first.nextCursor!);
    expect((await request(`/github/accounts?paged=1&query=other&cursor=${cursor}`)).status).toBe(400);
    expect((await request(`/github/accounts?paged=1&limit=12&cursor=${cursor}`)).status).toBe(400);
    expect((await request(`/github/accounts?paged=1&cursor=${cursor.slice(0, -4)}fake`)).status).toBe(400);
    await account(31);
    const changed = await request<{ code: string }>(`/github/accounts?paged=1&selectedId=gh_30&cursor=${cursor}`);
    expect(changed).toMatchObject({ status: 409, body: { code: 'GITHUB_ACCOUNT_LIST_CHANGED' } });
    expect((await request<GithubAccountPage>('/github/accounts?paged=1&selectedId=gh_30')).body.selected?.id).toBe('gh_30');
  });

  it('keeps off-page metadata and repository selections after a new store opens, then observes a real disconnect', async () => {
    const accounts = await seed(32);
    const workspace = await ctx.workspaces.create({ name: 'Off-page account fixture', initializeGit: false });
    await ctx.workspaces.update(workspace.id, { githubAccountId: 'gh_32' });
    const reopenedStore = new JsonStore(ctx.config.stateDir);
    const reopened = { ...ctx, store: reopenedStore, secrets: new SecretStore(reopenedStore, ctx.config.encryptionKey) };
    expect((await getGithubAccountsPage(reopened, { selectedId: 'gh_32' })).selected).toEqual(accounts[31]);
    expect((await ctx.workspaces.get(workspace.id)).githubAccountId).toBe('gh_32');
    expect((await request('/github/accounts/gh_32', 'DELETE')).status).toBe(200);
    expect(await getGithubAccount(reopened, 'gh_32')).toBeUndefined();
    const fresh = (await request<GithubAccountPage>('/github/accounts?paged=1&selectedId=gh_32')).body;
    expect(fresh.total).toBe(31); expect(fresh.selected).toBeUndefined();
    expect((await request('/github/accounts/gh_32')).status).toBe(404);
    expect((await ctx.workspaces.get(workspace.id)).githubAccountId).toBeUndefined();
    await reopenedStore.flush();
  });

  it('bounds and validates account request inputs before listing', async () => {
    for (const suffix of ['paged=1&limit=51', 'paged=1&limit=0', 'paged=1&limit=3.5', 'paged=1&limit=2&limit=3', `paged=1&query=${'x'.repeat(121)}`, 'paged=1&query=%00', 'paged=1&selectedId=../other', 'query=hello', 'paged=1&cursor=%7B%7D']) {
      expect((await request(`/github/accounts?${suffix}`)).status).toBe(400);
    }
  });
});

describe('bounded GitHub repository search discovery over HTTP', () => {
  it('uses one provider page per response and finds private organization/collaborator repositories through continuation', async () => {
    await account(1);
    transport.reply = options => {
      const url = new URL(String(options.path), 'https://api.github.com');
      expect(url.pathname).toBe('/user/repos');
      expect(url.searchParams.get('per_page')).toBe('30');
      expect(url.searchParams.get('affiliation')).toBe('owner,collaborator,organization_member');
      expect(url.searchParams.get('visibility')).toBe('all');
      const page = Number(url.searchParams.get('page'));
      return page === 1 ? { body: Array.from({ length: 30 }, (_, index) => repository(index + 1)), next: true }
        : { body: [repository(31, 'organization/billing-private'), repository(32, 'collaborator/billing-shared')] };
    };
    const first = await request<GithubRepoPage>('/github/accounts/gh_1/repos?query=billing');
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ repositories: [], page: 1, scanned: 30, hasMore: true, searchComplete: false, previousCursor: null });
    expect(transport.requests).toHaveLength(1);
    const second = await request<GithubRepoPage>(`/github/accounts/gh_1/repos?query=billing&cursor=${encodeURIComponent(first.body.nextCursor!)}`);
    expect(second.body.repositories.map(repo => repo.fullName)).toEqual(['organization/billing-private', 'collaborator/billing-shared']);
    expect(second.body.repositories.every(repo => repo.private)).toBe(true);
    expect(second.body).toMatchObject({ page: 2, scanned: 32, hasMore: false, searchComplete: true, nextCursor: null });
    expect(transport.requests).toHaveLength(2);
    const previous = await request<GithubRepoPage>(`/github/accounts/gh_1/repos?query=BILLING&cursor=${encodeURIComponent(second.body.previousCursor!)}`);
    expect(previous.body).toEqual(first.body);
    expect(transport.requests).toHaveLength(2);
    expect(JSON.stringify([first.body, second.body])).not.toContain(TOKEN);
  });

  it('honors a next-page relation even for an empty batch and only declares completion at the end', async () => {
    await account(1);
    transport.reply = options => ({ body: [], next: new URL(String(options.path), 'https://api.github.com').searchParams.get('page') === '1' });
    const first = (await request<GithubRepoPage>('/github/accounts/gh_1/repos?query=absent')).body;
    expect(first).toMatchObject({ repositories: [], scanned: 0, hasMore: true, searchComplete: false });
    const last = (await request<GithubRepoPage>(`/github/accounts/gh_1/repos?query=absent&cursor=${encodeURIComponent(first.nextCursor!)}`)).body;
    expect(last).toMatchObject({ repositories: [], hasMore: false, searchComplete: true, nextCursor: null });
    expect(transport.requests).toHaveLength(2);
  });

  it('binds repository cursors to the account, normalized query and current credential version', async () => {
    await account(1); await account(2);
    transport.reply = options => options.path === '/user' ? { body: { id: 1, login: 'account-001', name: 'Person 1' } }
      : { body: [repository(1, 'owner/billing')], next: true };
    const first = (await request<GithubRepoPage>('/github/accounts/gh_1/repos?query=billing')).body;
    const cursor = encodeURIComponent(first.nextCursor!);
    expect((await request(`/github/accounts/gh_2/repos?query=billing&cursor=${cursor}`)).status).toBe(400);
    expect((await request(`/github/accounts/gh_1/repos?query=other&cursor=${cursor}`)).status).toBe(400);
    expect((await request(`/github/accounts/gh_1/repos?query=billing&page=2&cursor=${cursor}`)).status).toBe(400);
    expect(transport.requests).toHaveLength(1);
    expect((await request('/github/accounts', 'POST', { token: 'github_pat_synthetic_rotated_fixture_not_real_67890' })).status).toBe(201);
    const changed = await request<{ code: string }>(`/github/accounts/gh_1/repos?query=billing&cursor=${cursor}`);
    expect(changed).toMatchObject({ status: 409, body: { code: 'GITHUB_REPOSITORY_LIST_CHANGED' } });
    expect(transport.requests).toHaveLength(2);
    expect((await request<GithubRepoPage>('/github/accounts/gh_1/repos?query=billing')).body.repositories).toHaveLength(1);
    expect(transport.requests).toHaveLength(3);
  });

  it('does not release a stale private repository page after its account disconnects', async () => {
    await account(1);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }); gates.push(release);
    transport.reply = async () => { await held; return { body: [repository(1, 'organization/private-before-disconnect')] }; };
    const pending = request('/github/accounts/gh_1/repos?query=private');
    await expect.poll(() => transport.requests.length).toBe(1);
    expect((await request('/github/accounts/gh_1', 'DELETE')).status).toBe(200);
    release();
    const result = await pending;
    expect(result.status).toBe(404);
    expect(JSON.stringify(result.body)).not.toContain('private-before-disconnect');
  });

  it('keeps legacy browse bounded, supplies truthful next metadata to paged browse, and refreshes only on request', async () => {
    await account(1);
    let generation = 1;
    transport.reply = () => ({ body: Array.from({ length: 30 }, (_, index) => repository(generation * 100 + index)), next: false });
    expect((await request<unknown[]>('/github/accounts/gh_1/repos')).body).toHaveLength(30);
    const first = await request<GithubRepoPage>('/github/accounts/gh_1/repos?paged=1');
    expect(first.body).toMatchObject({ nextCursor: null, hasMore: false, searchComplete: true });
    expect(transport.requests).toHaveLength(1);
    generation = 2;
    const refreshed = await request<GithubRepoPage>('/github/accounts/gh_1/repos?paged=1&refresh=1');
    expect(refreshed.body.repositories[0].id).toBe(200);
    expect(transport.requests).toHaveLength(2);
  });

  it('rejects oversize provider pages and reports a provider continuation beyond its browse limit honestly', async () => {
    await account(1);
    transport.reply = () => ({ body: Array.from({ length: 31 }, (_, index) => repository(index + 1)) });
    expect((await request('/github/accounts/gh_1/repos?paged=1')).status).toBe(502);
    transport.reply = () => ({ body: [], next: true });
    const limited = await request<{ code: string }>('/github/accounts/gh_1/repos?query=missing&page=10000');
    expect(limited).toMatchObject({ status: 413, body: { code: 'GITHUB_REPOSITORY_PAGE_LIMIT' } });
  });
});
