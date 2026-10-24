import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import { EventEmitter, once } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import type { Server } from 'node:http';
import type { RequestOptions } from 'node:https';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../server/config';
import { JsonStore, SecretStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import { HttpError } from '../server/errors';
import { encryptBuffer, decryptBuffer } from '../server/crypto';
import type { AppContext } from '../server/context';
import type { GithubAccount, GithubRepoPage, Workspace } from '../shared/types';
import { createGithubRouter, listGithubAccounts, withGitCredentials } from '../server/github';

// No real GitHub credentials or network are used in this module's tests.
// The HTTPS transport supplies explicit GitHub API fixtures. Import tests redirect
// only Git's remote URL to a local fixture and still execute a real `git clone`.
const mock = vi.hoisted(() => ({
  respond: undefined as ((options: RequestOptions) => { status: number; body: unknown; headers?: Record<string, string> } | Promise<{ status: number; body: unknown; headers?: Record<string, string> }>) | undefined,
  requests: [] as RequestOptions[],
  cloneSource: undefined as string | undefined,
  clones: [] as { args: string[]; env: NodeJS.ProcessEnv }[],
}));

vi.mock('node:https', async () => {
  const { EventEmitter: Events } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  return {
    request: (options: RequestOptions, callback: (response: unknown) => void) => {
      mock.requests.push(options);
      const req = new Events() as InstanceType<typeof Events> & { end: () => void; destroy: () => void };
      req.destroy = () => {};
      req.end = () => queueMicrotask(async () => {
        try {
          const fixture = await mock.respond?.(options) ?? { status: 500, body: { message: 'No GitHub API fixture configured.' } };
          const response = Object.assign(new PassThrough(), { statusCode: fixture.status, headers: fixture.headers ?? {} });
          callback(response);
          response.end(Buffer.from(JSON.stringify(fixture.body)));
        } catch (error) { req.emit('error', error); }
      });
      return req;
    },
  };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (command: string, args: string[], options: import('node:child_process').SpawnOptions) => {
      if (command === 'git' && args.includes('clone')) {
        mock.clones.push({ args: [...args], env: { ...options.env } });
        if (!mock.cloneSource) throw new Error('Git clone requires a local fixture in these tests.');
        const mappedArgs = args.map((arg) => arg.startsWith('https://github.com/') ? mock.cloneSource! : arg);
        return actual.spawn(command, ['-c', 'protocol.file.allow=always', ...mappedArgs], options);
      }
      return actual.spawn(command, args, options);
    },
  };
});

const execFile = promisify(execFileCallback);
const TOKEN_A = 'github_pat_fixture_account_a_not_real_1234567890';
const TOKEN_B = 'github_pat_fixture_account_b_not_real_1234567890';
const TOKEN_REFRESH = 'github_pat_fixture_refreshed_a_not_real_1234567890';
const TOKEN_REFRESH_B = 'github_pat_fixture_refreshed_b_not_real_1234567890';
const TOKEN_C = 'github_pat_fixture_account_c_not_real_1234567890';
const VERSION_PREFIX = 'github-account-version-';
const siblingServers: Server[] = [];
const siblingContexts: AppContext[] = [];
const releaseGates = new Set<() => void>();
let temporary: string;
let ctx: AppContext;
let server: Server;
let base: string;

function identity(options: RequestOptions) {
  const headers = options.headers as Record<string, string>;
  const second = [TOKEN_B, TOKEN_REFRESH_B].some(token => headers.Authorization === `Bearer ${token}`);
  const third = headers.Authorization === `Bearer ${TOKEN_C}`;
  const id = third ? 303 : second ? 202 : 101;
  return { id, login: third ? 'carol' : second ? 'bob' : 'alice', name: third ? 'Carol Example' : second ? 'Bob Example' : 'Alice Example', avatar_url: `https://avatars.githubusercontent.com/u/${id}` };
}

function repository(id: number, fullName = `alice/project-${id}`, isPrivate = false) {
  return { id, name: fullName.split('/')[1], full_name: fullName, private: isPrivate, description: `Repository ${id}`, default_branch: 'main', updated_at: '2026-09-01T12:00:00Z', html_url: `https://github.com/${fullName}` };
}

async function call(method: string, endpoint: string, body?: unknown) {
  const response = await fetch(`${base}/api${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> | unknown[] };
}

async function connect(token = TOKEN_A): Promise<GithubAccount> {
  const result = await call('POST', '/github/accounts', { token });
  expect(result.status).toBe(201);
  return result.body as unknown as GithubAccount;
}

function gitEnv(): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, HOME: temporary, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
}

function fillGitCredential(env: NodeJS.ProcessEnv, input: string, cwd = temporary): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    // This real Git command only exercises its credential protocol; it makes no
    // network request and receives only the synthetic token created by connect().
    const child = execFileCallback('git', ['credential', 'fill'], { env, cwd, timeout: 5000, encoding: 'utf8', maxBuffer: 16 * 1024 }, (error, stdout, stderr) => {
      resolve({ code: error ? typeof error.code === 'number' ? error.code : -1 : 0, stdout, stderr });
    });
    child.stdin?.end(input);
  });
}

async function connectionFiles(context = ctx, accountId?: string): Promise<string[]> {
  return (await readdir(context.config.stateDir)).filter(file => (file.startsWith(VERSION_PREFIX) || file.startsWith('github-account-base-'))
    && (!accountId || file.startsWith(`${VERSION_PREFIX}${accountId}-`) || file === `github-account-base-${accountId}.json`)).sort();
}

async function activeToken(context: AppContext, accountId: string): Promise<string | undefined> {
  return withGitCredentials(context, accountId, async env => env.CW_GITHUB_TOKEN);
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  releaseGates.add(release);
  return { promise, release };
}

function publicationBarrier(contexts: AppContext[], prefix = VERSION_PREFIX) {
  const gate = deferred();
  let arrivals = 0;
  for (const context of contexts) {
    const original = context.store.write.bind(context.store);
    vi.spyOn(context.store, 'write').mockImplementation(async (key, value) => {
      if (key.startsWith(prefix)) {
        arrivals += 1;
        if (arrivals === contexts.length) gate.release();
        await gate.promise;
      }
      return original(key, value);
    });
  }
  return () => arrivals;
}

async function sibling() {
  const store = new JsonStore(ctx.config.stateDir);
  const context: AppContext = { ...ctx, store, secrets: new SecretStore(store, ctx.config.encryptionKey), workspaces: new WorkspaceService(ctx.config, store), events: new EventEmitter() };
  await context.workspaces.initialize();
  siblingContexts.push(context);
  const app = express(); app.use(express.json()); app.use('/api', createGithubRouter(context));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => res.status(error instanceof HttpError ? error.status : 500).json({ error: error instanceof Error ? error.message : 'Unexpected error', code: error instanceof HttpError ? error.code : undefined }));
  const server = app.listen(0, '127.0.0.1'); siblingServers.push(server);
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Sibling fixture did not start.');
  return { ctx: context, call: async (method: string, endpoint: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api${endpoint}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as Record<string, unknown> | unknown[] };
  } };
}

beforeEach(async () => {
  mock.requests = [];
  mock.clones = [];
  mock.cloneSource = undefined;
  mock.respond = (options) => options.path === '/user' ? { status: 200, body: identity(options) } : { status: 404, body: { message: 'Not found' } };
  temporary = await mkdtemp(path.join(tmpdir(), 'codex-github-test-'));
  const config = loadConfig({
    DATA_DIR: temporary, NODE_ENV: 'test', WORKSPACE_PASSWORD: 'fixture-workspace-password',
    SESSION_SECRET: 'fixture-session-secret-with-more-than-32-characters',
    ENCRYPTION_KEY: 'fixture-encryption-key-with-more-than-32-characters',
  });
  const store = new JsonStore(config.stateDir);
  await store.write('workspaces', []);
  const secrets = new SecretStore(store, config.encryptionKey);
  const workspaces = new WorkspaceService(config, store);
  await workspaces.initialize();
  ctx = { config, store, secrets, workspaces, events: new EventEmitter() } as AppContext;
  const app = express();
  app.use(express.json());
  app.use('/api', createGithubRouter(ctx));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(error instanceof HttpError ? error.status : 500).json({ error: error instanceof Error ? error.message : 'Unexpected error', code: error instanceof HttpError ? error.code : undefined });
  });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not start.');
  base = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  for (const release of releaseGates) release();
  releaseGates.clear();
  vi.restoreAllMocks();
  for (const sibling of siblingServers.splice(0)) {
    sibling.closeAllConnections();
    await new Promise<void>((resolve, reject) => sibling.close(error => error ? reject(error) : resolve()));
  }
  await Promise.all(siblingContexts.splice(0).map(context => context.store.flush()));
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await ctx.store.flush();
  await rm(temporary, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('verified GitHub accounts (mock GitHub HTTPS transport)', () => {
  it('verifies two identities, keeps tokens protected on disk, and never returns tokens', async () => {
    const alice = await connect();
    const bob = await connect(TOKEN_B);
    expect(alice.id).toBe('gh_101');
    expect(bob.id).toBe('gh_202');
    const listed = await call('GET', '/github/accounts');
    expect(listed.body).toEqual([alice, bob]);
    expect(JSON.stringify(listed.body)).not.toContain(TOKEN_A);
    expect(JSON.stringify(listed.body)).not.toContain(TOKEN_B);
    const files = await connectionFiles();
    expect(files).toHaveLength(2);
    const persisted = (await Promise.all(files.map(file => readFile(path.join(ctx.config.stateDir, file), 'utf8')))).join('\n');
    expect(persisted).toContain('alice');
    expect(persisted).not.toContain(TOKEN_A);
    expect(persisted).not.toContain(TOKEN_B);
    expect(await activeToken(ctx, 'gh_101')).toBe(TOKEN_A);
    expect(await activeToken(ctx, 'gh_202')).toBe(TOKEN_B);
    expect(await readdir(ctx.config.stateDir)).not.toContain('github-accounts.json');
    expect(await readdir(ctx.config.stateDir)).not.toContain('protected-credentials.json');
    expect(mock.requests).toHaveLength(2);
    for (const request of mock.requests) {
      expect(request.hostname).toBe('api.github.com');
      expect(request.protocol).toBe('https:');
      expect(request.agent).toBe(false);
      expect(request.path).toBe('/user');
      expect((request.headers as Record<string, string>)['X-GitHub-Api-Version']).toBe('2026-03-10');
    }
  });

  it('reconnects the same verified identity without duplicating it or changing its creation date', async () => {
    const first = await connect();
    const second = await connect(TOKEN_REFRESH);
    expect(second).toEqual(first);
    expect((await call('GET', '/github/accounts')).body).toEqual([first]);
    expect(await activeToken(ctx, first.id)).toBe(TOKEN_REFRESH);
  });

  it.each(['', 'too-short', 'github_pat_ bad-token-has-space', 'github_pat_non_ascii_例_123456', 'x'.repeat(1025)])('rejects malformed token %j before calling GitHub', async (token) => {
    const result = await call('POST', '/github/accounts', { token });
    expect(result.status).toBe(400);
    expect(mock.requests).toHaveLength(0);
    expect(await ctx.store.read('github-accounts', [])).toEqual([]);
  });

  it('does not save an expired token or relay an upstream body containing credentials', async () => {
    mock.respond = () => ({ status: 401, body: { message: `Untrusted upstream message ${TOKEN_A}` } });
    const result = await call('POST', '/github/accounts', { token: TOKEN_A });
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ code: 'GITHUB_RECONNECT' });
    expect(JSON.stringify(result.body)).not.toContain(TOKEN_A);
    expect(await ctx.store.read('github-accounts', [])).toEqual([]);
    expect(await ctx.secrets.get('github-gh_101')).toBeUndefined();
  });

  it('disconnects only the selected account and clears references while preserving working files', async () => {
    const alice = await connect();
    const bob = await connect(TOKEN_B);
    const workspace = await ctx.workspaces.create({ name: 'Existing work' });
    await ctx.workspaces.update(workspace.id, { githubAccountId: alice.id });
    await writeFile(path.join(workspace.path, 'keep.txt'), 'Keep this local work.');
    const result = await call('DELETE', `/github/accounts/${alice.id}`);
    expect(result.status).toBe(200);
    expect((await call('GET', '/github/accounts')).body).toEqual([bob]);
    await expect(activeToken(ctx, alice.id)).rejects.toMatchObject({ status: 404 });
    expect(await activeToken(ctx, bob.id)).toBe(TOKEN_B);
    expect((await ctx.workspaces.get(workspace.id)).githubAccountId).toBeUndefined();
    expect(await readFile(path.join(workspace.path, 'keep.txt'), 'utf8')).toBe('Keep this local work.');
    const requestsBefore = mock.requests.length;
    expect((await call('GET', `/github/accounts/${alice.id}/repos`)).status).toBe(404);
    expect(mock.requests).toHaveLength(requestsBefore);
  });
});

describe('repository listing and search (mock GitHub HTTPS transport)', () => {
  it('paginates authenticated private, organization, and collaborator repositories', async () => {
    const alice = await connect();
    const fixtures = Array.from({ length: 35 }, (_, index) => repository(index + 1, `team/project-${index + 1}`, index % 2 === 0));
    mock.respond = (options) => {
      const url = new URL(String(options.path), 'https://api.github.com');
      expect(url.pathname).toBe('/user/repos');
      expect(url.searchParams.get('visibility')).toBe('all');
      expect(url.searchParams.get('affiliation')).toBe('owner,collaborator,organization_member');
      expect((options.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN_A}`);
      const size = Number(url.searchParams.get('per_page'));
      const page = Number(url.searchParams.get('page'));
      return { status: 200, body: fixtures.slice((page - 1) * size, page * size) };
    };
    const first = await call('GET', `/github/accounts/${alice.id}/repos?page=1`);
    const second = await call('GET', `/github/accounts/${alice.id}/repos?page=2`);
    expect(first.status).toBe(200);
    expect(first.body).toHaveLength(30);
    expect((first.body as unknown[])[0]).toMatchObject({ fullName: 'team/project-1', private: true, url: 'https://github.com/team/project-1' });
    expect(second.body).toHaveLength(5);
    expect(JSON.stringify([first.body, second.body])).not.toContain(TOKEN_A);
  });

  it('searches beyond the first upstream page with bounded continuation and reuses cached provider pages', async () => {
    const alice = await connect();
    const fixtures = [...Array.from({ length: 100 }, (_, index) => repository(index + 1)), repository(101, 'organization/billing-private', true)];
    mock.respond = (options) => {
      const url = new URL(String(options.path), 'https://api.github.com');
      const page = Number(url.searchParams.get('page'));
      expect(url.searchParams.get('per_page')).toBe('30');
      return { status: 200, body: fixtures.slice((page - 1) * 30, page * 30), headers: page < 4 ? { link: `<https://api.github.com/user/repos?page=${page + 1}>; rel="next"` } : undefined };
    };
    const first = await call('GET', `/github/accounts/${alice.id}/repos?query=billing&page=1`);
    expect(first.status).toBe(200);
    let found = first.body as unknown as GithubRepoPage;
    expect(found).toMatchObject({ repositories: [], page: 1, scanned: 30, hasMore: true, searchComplete: false });
    expect(mock.requests.filter(request => String(request.path).startsWith('/user/repos'))).toHaveLength(1);
    for (let page = 2; page <= 4; page++) {
      const next = await call('GET', `/github/accounts/${alice.id}/repos?query=billing&cursor=${encodeURIComponent(found.nextCursor!)}`);
      expect(next.status).toBe(200);
      found = next.body as unknown as GithubRepoPage;
      expect(found.page).toBe(page);
    }
    expect(found.repositories).toHaveLength(1);
    expect(found.repositories[0]).toMatchObject({ fullName: 'organization/billing-private', private: true });
    expect(found).toMatchObject({ hasMore: false, searchComplete: true, scanned: 101, nextCursor: null });
    const requestCount = mock.requests.length;
    const again = await call('GET', `/github/accounts/${alice.id}/repos?query=BILLING&page=1`);
    expect(again.body).toEqual(first.body);
    expect(mock.requests).toHaveLength(requestCount);
  });

  it('rejects invalid paging and reports rate limits without returning upstream text', async () => {
    const alice = await connect();
    expect((await call('GET', `/github/accounts/${alice.id}/repos?page=-1`)).status).toBe(400);
    expect((await call('GET', `/github/accounts/${alice.id}/repos?page=1.5`)).status).toBe(400);
    expect((await call('GET', `/github/accounts/${alice.id}/repos?query=${'x'.repeat(121)}`)).status).toBe(400);
    mock.respond = () => ({ status: 403, body: { message: `Rate exceeded ${TOKEN_A}` }, headers: { 'x-ratelimit-remaining': '0' } });
    const result = await call('GET', `/github/accounts/${alice.id}/repos`);
    expect(result.status).toBe(429);
    expect(result.body).toMatchObject({ code: 'GITHUB_RATE_LIMIT' });
    expect(JSON.stringify(result.body)).not.toContain(TOKEN_A);
  });
});

describe('per-command Git credentials', () => {
  it('supplies its saved token through real Git credential fill even when the repository disables interaction', async () => {
    const account = await connect();
    const repository = path.join(temporary, 'credential-repository');
    await mkdir(repository);
    await execFile('git', ['-c', 'init.templateDir=', 'init', repository], { env: gitEnv() });
    await execFile('git', ['-C', repository, 'config', 'credential.interactive', 'false'], { env: gitEnv() });
    let helper = '';
    await withGitCredentials(ctx, account.id, async env => {
      helper = env.GIT_ASKPASS!;
      expect(env.GIT_TERMINAL_PROMPT).toBe('0');
      const filled = await fillGitCredential(env, 'protocol=https\nhost=github.com\n\n', repository);
      expect(filled.code, filled.stderr).toBe(0);
      expect(filled.stdout).toContain('username=alice\n');
      expect(filled.stdout).toContain(`password=${TOKEN_A}\n`);
      expect(filled.stderr).not.toContain(TOKEN_A);
    });
    expect((await execFile('git', ['-C', repository, 'config', '--get', 'credential.interactive'], { env: gitEnv() })).stdout.trim()).toBe('false');
    expect(await readFile(path.join(repository, '.git', 'config'), 'utf8')).not.toContain(TOKEN_A);
    await expect(stat(path.dirname(helper))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    'protocol=https\nhost=github.com.attacker.example\nusername=alice\n\n',
    'protocol=http\nhost=github.com\nusername=alice\n\n',
    'protocol=https\nhost=github.com:444\nusername=alice\n\n',
  ])('rejects unauthorized prompts through real Git credential fill: %j', async input => {
    const account = await connect();
    await withGitCredentials(ctx, account.id, async env => {
      expect(env.GIT_TERMINAL_PROMPT).toBe('0');
      const filled = await fillGitCredential(env, input);
      expect(filled.code).toBe(128);
      expect(filled.stdout).toBe('');
      expect(filled.stderr).not.toContain(TOKEN_A);
    });
  });

  it('keeps anonymous real Git credential requests noninteractive', async () => {
    await withGitCredentials(ctx, undefined, async env => {
      expect(env.GIT_TERMINAL_PROMPT).toBe('0');
      expect(env.GIT_ASKPASS).toBe('/bin/false');
      expect(env.CW_GITHUB_TOKEN).toBeUndefined();
      expect((await execFile('git', ['config', '--get', 'credential.interactive'], { env, cwd: temporary })).stdout.trim()).toBe('false');
      const filled = await fillGitCredential(env, 'protocol=https\nhost=github.com\n\n');
      expect(filled.code).toBe(128);
      expect(filled.stdout).toBe('');
    });
  });

  it('uses a private credential-free helper that only answers exact GitHub HTTPS prompts, then cleans it', async () => {
    const account = await connect();
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.invalid:8080');
    vi.stubEnv('HF_TOKEN', 'synthetic-deployment-secret');
    vi.stubEnv('OPENAI_API_KEY', 'synthetic-provider-secret');
    vi.stubEnv('WORKSPACE_PASSWORD', 'synthetic-login-secret');
    vi.stubEnv('GIT_CONFIG_COUNT', '999');
    let helper = '';
    let receivedEnv: NodeJS.ProcessEnv | undefined;
    await withGitCredentials(ctx, account.id, async (env) => {
      receivedEnv = env;
      helper = env.GIT_ASKPASS!;
      expect((await stat(path.dirname(helper))).mode & 0o777).toBe(0o700);
      expect((await stat(helper)).mode & 0o777).toBe(0o700);
      expect(await readFile(helper, 'utf8')).not.toContain(TOKEN_A);
      expect(env.HTTPS_PROXY).toBeUndefined();
      expect(env.HF_TOKEN).toBeUndefined();
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.WORKSPACE_PASSWORD).toBeUndefined();
      expect(env.GIT_CONFIG_COUNT).not.toBe('999');
      expect(env.GIT_TERMINAL_PROMPT).toBe('0');
      const username = await execFile(helper, ["Username for 'https://github.com': "], { env });
      const password = await execFile(helper, ["Password for 'https://alice@github.com': "], { env });
      expect(username.stdout).toBe('alice\n');
      expect(password.stdout).toBe(`${TOKEN_A}\n`);
      await expect(execFile(helper, ["Password for 'https://github.com.attacker.example': "], { env })).rejects.toMatchObject({ code: 1, stdout: '' });
      await expect(execFile(helper, ["Password for 'http://github.com': "], { env })).rejects.toMatchObject({ code: 1, stdout: '' });
      await expect(execFile(helper, ["Password for 'https://github.com:444': "], { env })).rejects.toMatchObject({ code: 1, stdout: '' });
    });
    expect(receivedEnv?.CW_GITHUB_TOKEN).toBeUndefined();
    expect(receivedEnv?.CW_GITHUB_USERNAME).toBeUndefined();
    expect(receivedEnv?.GIT_ASKPASS).toBeUndefined();
    expect((await execFile('git', ['config', '--get', 'credential.interactive'], { env: receivedEnv, cwd: temporary })).stdout.trim()).toBe('false');
    await expect(stat(path.dirname(helper))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(process.env.HF_TOKEN).toBe('synthetic-deployment-secret');
  });

  it('redacts the exact credential and removes the helper on command failure', async () => {
    const account = await connect();
    let helper = '';
    let receivedEnv: NodeJS.ProcessEnv | undefined;
    await expect(withGitCredentials(ctx, account.id, async (env) => {
      receivedEnv = env;
      helper = env.GIT_ASKPASS!;
      throw new HttpError(502, `Failed with credential ${TOKEN_A}`);
    })).rejects.toMatchObject({ status: 502, message: 'Failed with credential [redacted]' });
    expect(receivedEnv?.CW_GITHUB_TOKEN).toBeUndefined();
    await expect(stat(path.dirname(helper))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not invoke a callback when an account has lost its saved credential', async () => {
    const account = await connect();
    const filename = path.join(ctx.config.stateDir, (await connectionFiles(ctx, account.id))[0]);
    const damaged = JSON.parse(await readFile(filename, 'utf8'));
    damaged.encryptedToken = Buffer.alloc(64).toString('base64');
    await writeFile(filename, JSON.stringify(damaged));
    const callback = vi.fn();
    await expect(withGitCredentials(ctx, account.id, callback)).rejects.toMatchObject({ status: 409, code: 'GITHUB_RECONNECT' });
    expect(callback).not.toHaveBeenCalled();
  });
});

describe('independent GitHub stores and immutable account history', () => {
  it('refreshes an existing repository search after another instance rotates its token', async () => {
    const account = await connect();
    const other = await sibling();
    mock.respond = options => {
      if (options.path === '/user') return { status: 200, body: identity(options) };
      const refreshed = (options.headers as Record<string, string>).Authorization === `Bearer ${TOKEN_REFRESH}`;
      return { status: 200, body: [repository(refreshed ? 2 : 1, `alice/private-${refreshed ? 'current' : 'previous'}`, true)] };
    };
    const first = await call('GET', `/github/accounts/${account.id}/repos?query=private`);
    expect((first.body as unknown as GithubRepoPage).repositories[0]).toMatchObject({ fullName: 'alice/private-previous' });
    expect((await other.call('POST', '/github/accounts', { token: TOKEN_REFRESH })).status).toBe(201);
    const current = await call('GET', `/github/accounts/${account.id}/repos?query=private`);
    expect((current.body as unknown as GithubRepoPage).repositories[0]).toMatchObject({ fullName: 'alice/private-current' });
  });

  it('preserves overlapping different-account connects, rotations, and disconnects across independent stores', async () => {
    const other = await sibling();
    expect(other.ctx.store).not.toBe(ctx.store);
    expect(other.ctx.secrets).not.toBe(ctx.secrets);
    const connectArrivals = publicationBarrier([ctx, other.ctx]);
    const created = await Promise.all([
      call('POST', '/github/accounts', { token: TOKEN_A }),
      other.call('POST', '/github/accounts', { token: TOKEN_B }),
    ]);
    expect(created.map(result => result.status)).toEqual([201, 201]);
    expect(connectArrivals()).toBe(2);
    expect((await listGithubAccounts(ctx)).map(account => account.id)).toEqual(['gh_101', 'gh_202']);
    expect((await listGithubAccounts(other.ctx)).map(account => account.id)).toEqual(['gh_101', 'gh_202']);
    vi.restoreAllMocks();

    const replacementArrivals = publicationBarrier([ctx, other.ctx]);
    const replaced = await Promise.all([
      call('POST', '/github/accounts', { token: TOKEN_REFRESH }),
      other.call('POST', '/github/accounts', { token: TOKEN_REFRESH_B }),
    ]);
    expect(replaced.map(result => result.status)).toEqual([201, 201]);
    expect(replacementArrivals()).toBe(2);
    expect(await activeToken(other.ctx, 'gh_101')).toBe(TOKEN_REFRESH);
    expect(await activeToken(ctx, 'gh_202')).toBe(TOKEN_REFRESH_B);
    vi.restoreAllMocks();

    const independentArrivals = publicationBarrier([ctx, other.ctx], 'github-account-');
    const changed = await Promise.all([
      call('DELETE', '/github/accounts/gh_101'),
      other.call('POST', '/github/accounts', { token: TOKEN_B }),
    ]);
    expect(changed.map(result => result.status)).toEqual([200, 201]);
    expect(independentArrivals()).toBe(2);
    expect(await activeToken(ctx, 'gh_202')).toBe(TOKEN_B);
    await expect(activeToken(other.ctx, 'gh_101')).rejects.toMatchObject({ status: 404 });
    vi.restoreAllMocks();

    expect((await call('POST', '/github/accounts', { token: TOKEN_C })).status).toBe(201);
    const reopened = await sibling();
    expect((await listGithubAccounts(reopened.ctx)).map(account => account.id).sort()).toEqual(['gh_202', 'gh_303']);
    expect(await activeToken(reopened.ctx, 'gh_202')).toBe(TOKEN_B);
    expect(await activeToken(reopened.ctx, 'gh_303')).toBe(TOKEN_C);
    const allFiles = await readdir(ctx.config.stateDir);
    expect(allFiles).not.toContain('github-accounts.json');
    expect(allFiles).not.toContain('protected-credentials.json');
    expect(allFiles.filter(file => file.startsWith('github-account-disconnect-gh_101-'))).toHaveLength(1);
    const saved = (await Promise.all(allFiles.filter(file => file.startsWith('github-account-')).map(file => readFile(path.join(ctx.config.stateDir, file), 'utf8')))).join('\n');
    for (const token of [TOKEN_A, TOKEN_B, TOKEN_C, TOKEN_REFRESH, TOKEN_REFRESH_B]) expect(saved).not.toContain(token);
  });

  it('coalesces overlapping verifications of the identical PAT without forcing a reconnect', async () => {
    const other = await sibling();
    const arrivals = publicationBarrier([ctx, other.ctx]);
    const connected = await Promise.all([
      call('POST', '/github/accounts', { token: TOKEN_A }),
      other.call('POST', '/github/accounts', { token: TOKEN_A }),
    ]);
    expect(connected.map(result => result.status)).toEqual([201, 201]);
    expect(arrivals()).toBe(2);
    expect(await listGithubAccounts(ctx)).toHaveLength(1);
    expect(await activeToken(ctx, 'gh_101')).toBe(TOKEN_A);
    expect(await activeToken(other.ctx, 'gh_101')).toBe(TOKEN_A);
  });

  it.each([false, true])('keeps an acknowledged identical-PAT connection when another publisher rolls back (replacement=%s)', async replacement => {
    if (replacement) await connect();
    const token = replacement ? TOKEN_REFRESH : TOKEN_A;
    const other = await sibling();
    const entered = deferred(); const fail = deferred();
    const write = ctx.store.write.bind(ctx.store);
    vi.spyOn(ctx.store, 'write').mockImplementation(async (key, value) => {
      await write(key, value);
      if (key.startsWith(VERSION_PREFIX)) {
        entered.release(); await fail.promise;
        throw new Error('Synthetic failure after candidate publication.');
      }
    });
    const pendingFailure = call('POST', '/github/accounts', { token });
    await entered.promise;
    expect((await other.call('POST', '/github/accounts', { token })).status).toBe(201);
    fail.release();
    expect((await pendingFailure).status).toBe(500);
    expect(await activeToken(ctx, 'gh_101')).toBe(token);
    expect(await activeToken(other.ctx, 'gh_101')).toBe(token);
    expect(await listGithubAccounts(ctx)).toHaveLength(1);
    expect(await connectionFiles(ctx, 'gh_101')).toHaveLength(replacement ? 2 : 1);
  });

  it('does not let a slow verified rotation replace a newer already-saved credential', async () => {
    await connect();
    const other = await sibling();
    const entered = deferred(); const finish = deferred();
    const laterToken = 'github_pat_fixture_later_alice_not_real_1234567890';
    mock.respond = async options => {
      if ((options.headers as Record<string, string>).Authorization === `Bearer ${TOKEN_REFRESH}`) {
        entered.release(); await finish.promise;
      }
      return { status: 200, body: identity(options) };
    };
    const slow = call('POST', '/github/accounts', { token: TOKEN_REFRESH });
    await entered.promise;
    expect((await other.call('POST', '/github/accounts', { token: laterToken })).status).toBe(201);
    finish.release();
    expect(await slow).toMatchObject({ status: 409, body: { code: 'GITHUB_CONNECTION_CONFLICT' } });
    expect(await activeToken(ctx, 'gh_101')).toBe(laterToken);
    expect(await connectionFiles(ctx, 'gh_101')).toHaveLength(2);
  });

  it('retains a valid prior credential when verification or atomic publication fails', async () => {
    const account = await connect();
    const originalFiles = await connectionFiles(ctx, account.id);
    mock.respond = () => ({ status: 401, body: { message: 'Synthetic rejected verification.' } });
    expect((await call('POST', '/github/accounts', { token: TOKEN_REFRESH })).status).toBe(401);
    expect(await activeToken(ctx, account.id)).toBe(TOKEN_A);
    expect(await connectionFiles(ctx, account.id)).toEqual(originalFiles);
    mock.respond = options => ({ status: 200, body: identity(options) });

    const write = ctx.store.write.bind(ctx.store);
    for (const publishFirst of [false, true]) {
      vi.spyOn(ctx.store, 'write').mockImplementation(async (key, value) => {
        if (key.startsWith(VERSION_PREFIX)) {
          if (publishFirst) await write(key, value);
          throw new Error('Synthetic failed credential publication.');
        }
        return write(key, value);
      });
      expect((await call('POST', '/github/accounts', { token: TOKEN_REFRESH })).status).toBe(500);
      expect(await connectionFiles(ctx, account.id)).toEqual(originalFiles);
      expect(await activeToken(ctx, account.id)).toBe(TOKEN_A);
      vi.restoreAllMocks();
    }
  });

  it('rejects a paused connection after another store disconnects it, then allows a deliberate new connection', async () => {
    const account = await connect();
    const other = await sibling();
    const entered = deferred(); const finish = deferred();
    mock.respond = async options => {
      entered.release(); await finish.promise;
      return { status: 200, body: identity(options) };
    };
    const paused = call('POST', '/github/accounts', { token: TOKEN_REFRESH });
    await entered.promise;
    expect((await other.call('DELETE', `/github/accounts/${account.id}`)).status).toBe(200);
    finish.release();
    expect(await paused).toMatchObject({ status: 409, body: { code: 'GITHUB_CONNECTION_CONFLICT' } });
    expect(await listGithubAccounts(ctx)).toEqual([]);
    await expect(activeToken(ctx, account.id)).rejects.toMatchObject({ status: 404 });
    const markers = (await readdir(ctx.config.stateDir)).filter(file => file.startsWith(`github-account-disconnect-${account.id}-`));
    expect(markers).toHaveLength(1);

    expect((await call('POST', '/github/accounts', { token: TOKEN_REFRESH })).status).toBe(201);
    expect(await activeToken(other.ctx, account.id)).toBe(TOKEN_REFRESH);
    expect((await readdir(ctx.config.stateDir)).filter(file => file.startsWith(`github-account-disconnect-${account.id}-`))).toEqual(markers);
  });

  it('fails closed on competing saved rotations and lets a deliberate verification resolve only the observed versions', async () => {
    const account = await connect();
    const firstFile = (await connectionFiles(ctx, account.id))[0];
    const initial = JSON.parse(await readFile(path.join(ctx.config.stateDir, firstFile), 'utf8'));
    const conflictingIds = [randomUUID(), randomUUID()];
    for (let index = 0; index < conflictingIds.length; index += 1) {
      await ctx.store.write(`${VERSION_PREFIX}${account.id}-${conflictingIds[index]}`, {
        ...initial, version: conflictingIds[index], supersedes: [initial.version],
        encryptedToken: encryptBuffer(Buffer.from(index ? TOKEN_REFRESH : 'github_pat_fixture_competing_alice_not_real_1234567890'), ctx.config.encryptionKey).toString('base64'),
      });
    }
    await expect(activeToken(ctx, account.id)).rejects.toMatchObject({ status: 409, code: 'GITHUB_CONNECTION_CONFLICT' });
    expect(await listGithubAccounts(ctx)).toEqual([account]);
    expect((await call('POST', '/github/accounts', { token: TOKEN_A })).status).toBe(201);
    expect(await activeToken(ctx, account.id)).toBe(TOKEN_A);
    const records = await Promise.all((await connectionFiles(ctx, account.id)).map(async file => JSON.parse(await readFile(path.join(ctx.config.stateDir, file), 'utf8'))));
    const resolved = records.find(record => record.supersedes.includes(conflictingIds[0]) && record.supersedes.includes(conflictingIds[1]));
    expect(resolved).toBeDefined();
    expect(decryptBuffer(Buffer.from(resolved.encryptedToken, 'base64'), ctx.config.encryptionKey).toString('utf8')).toBe(TOKEN_A);
  });

  it('does not let a writer with an obsolete disconnect view suppress a deliberately restored account', async () => {
    const account = await connect();
    expect((await call('DELETE', `/github/accounts/${account.id}`)).status).toBe(200);
    expect((await call('POST', '/github/accounts', { token: TOKEN_REFRESH })).status).toBe(201);
    const records = await Promise.all((await connectionFiles(ctx, account.id)).map(async file => JSON.parse(await readFile(path.join(ctx.config.stateDir, file), 'utf8'))));
    const restored = records.find(record => record.disconnects.length === 1);
    expect(restored).toBeDefined();
    const staleVersion = randomUUID();
    // Model an independently stale directory view: it saw the new connection
    // filename before discovering the permanent disconnect marker it requires.
    await ctx.store.write(`${VERSION_PREFIX}${account.id}-${staleVersion}`, {
      ...restored, version: staleVersion, supersedes: [restored.version], disconnects: [],
      encryptedToken: encryptBuffer(Buffer.from(TOKEN_A), ctx.config.encryptionKey).toString('base64'),
    });
    expect(await activeToken(ctx, account.id)).toBe(TOKEN_REFRESH);
    expect(await listGithubAccounts(ctx)).toHaveLength(1);
  });

  it('rolls back competing failed publications instead of leaving an unusable account', async () => {
    const account = await connect();
    const other = await sibling();
    const gate = deferred(); let published = 0;
    for (const context of [ctx, other.ctx]) {
      const write = context.store.write.bind(context.store);
      vi.spyOn(context.store, 'write').mockImplementation(async (key, value) => {
        await write(key, value);
        if (key.startsWith(VERSION_PREFIX)) {
          published += 1;
          if (published === 2) gate.release();
          await gate.promise;
        }
      });
    }
    const alternative = 'github_pat_fixture_competing_verified_alice_not_real_1234567890';
    const replies = await Promise.all([
      call('POST', '/github/accounts', { token: TOKEN_REFRESH }),
      other.call('POST', '/github/accounts', { token: alternative }),
    ]);
    expect(published).toBe(2);
    expect(replies.map(reply => reply.status)).toContain(409);
    expect(replies.every(reply => reply.status === 201 || reply.status === 409)).toBe(true);
    const acceptedIndex = replies.findIndex(reply => reply.status === 201);
    expect(await activeToken(ctx, account.id)).toBe(acceptedIndex === 0 ? TOKEN_REFRESH : acceptedIndex === 1 ? alternative : TOKEN_A);
    expect(await activeToken(other.ctx, account.id)).toBe(await activeToken(ctx, account.id));
  });

  it('copies complete legacy pairs without rotating ciphertext and never migrates orphan tokens', async () => {
    const legacy: GithubAccount = { id: 'gh_101', login: 'alice', name: 'Alice Example', avatarUrl: '', createdAt: '2026-01-01T00:00:00.000Z' };
    await ctx.store.write('github-accounts', [legacy]);
    await ctx.secrets.set('github-gh_101', TOKEN_A);
    await ctx.secrets.set('github-gh_999', TOKEN_B);
    const before = await readFile(path.join(ctx.config.stateDir, 'protected-credentials.json'), 'utf8');
    expect(await listGithubAccounts(ctx)).toEqual([legacy]);
    const base = JSON.parse(await readFile(path.join(ctx.config.stateDir, 'github-account-base-gh_101.json'), 'utf8'));
    expect(base).toMatchObject({ account: legacy, encryptedToken: JSON.parse(before)['github-gh_101'] });
    expect(await activeToken(ctx, legacy.id)).toBe(TOKEN_A);
    expect(await connectionFiles()).toEqual(['github-account-base-gh_101.json']);
    expect(await readFile(path.join(ctx.config.stateDir, 'protected-credentials.json'), 'utf8')).toBe(before);
    expect((await call('DELETE', `/github/accounts/${legacy.id}`)).status).toBe(200);
    await ctx.store.write('github-accounts', [legacy]); // A delayed old runtime rewrites its obsolete aggregate.
    const reopened = await sibling();
    expect(await listGithubAccounts(reopened.ctx)).toEqual([]);
    await expect(activeToken(reopened.ctx, legacy.id)).rejects.toMatchObject({ status: 404 });
    expect((await reopened.call('POST', '/github/accounts', { token: TOKEN_REFRESH })).status).toBe(201);
    expect(await activeToken(ctx, legacy.id)).toBe(TOKEN_REFRESH);
    expect(await readFile(path.join(ctx.config.stateDir, 'protected-credentials.json'), 'utf8')).toBe(before);
  });

  it('does not let a delayed legacy rename overwrite a verified native connection or clear disconnect intent', async () => {
    const legacy: GithubAccount = { id: 'gh_101', login: 'alice', name: 'Legacy Alice', avatarUrl: '', createdAt: '2026-01-01T00:00:00.000Z' };
    await ctx.store.write('github-accounts', [legacy]);
    await ctx.secrets.set('github-gh_101', TOKEN_A);
    const other = await sibling();
    const entered = deferred(); const finish = deferred();
    const rename = fs.rename.bind(fs); let held = false;
    vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
      if (!held && String(target).endsWith('github-account-base-gh_101.json')) {
        held = true; entered.release(); await finish.promise;
      }
      return rename(source, target);
    });
    const migration = listGithubAccounts(ctx);
    await entered.promise;
    expect((await other.call('POST', '/github/accounts', { token: TOKEN_REFRESH })).status).toBe(201);
    expect(await activeToken(other.ctx, legacy.id)).toBe(TOKEN_REFRESH);
    expect((await other.call('DELETE', `/github/accounts/${legacy.id}`)).status).toBe(200);
    finish.release();
    expect(await migration).toEqual([]);
    expect(await listGithubAccounts(ctx)).toEqual([]);
    await expect(activeToken(ctx, legacy.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe('repository imports (real Git with a local fixture remote)', () => {
  it('clones full history, attaches the selected account, and keeps credentials out of Git config and command arguments', async () => {
    const account = await connect();
    const source = path.join(temporary, 'source');
    await mkdir(source);
    await execFile('git', ['init', '--initial-branch=main', source], { env: gitEnv() });
    for (const version of [1, 2]) {
      await writeFile(path.join(source, 'README.md'), `Version ${version}\n`);
      await execFile('git', ['-C', source, 'add', 'README.md'], { env: gitEnv() });
      await execFile('git', ['-C', source, '-c', 'user.name=Fixture User', '-c', 'user.email=fixture@example.test', 'commit', '-m', `Version ${version}`], { env: gitEnv() });
    }
    mock.cloneSource = source;
    mock.respond = (options) => {
      expect(options.path).toBe('/repos/alice/example');
      return { status: 200, body: { ...repository(123, 'alice/example', true), clone_url: `https://${TOKEN_A}@attacker.example/ignored.git` } };
    };
    const result = await call('POST', '/github/import', { accountId: account.id, fullName: 'alice/example', name: 'Imported project' });
    expect(result.status).toBe(201);
    const workspace = result.body as unknown as Workspace;
    expect(workspace.githubAccountId).toBe(account.id);
    expect(workspace.name).toBe('Imported project');
    expect(await readFile(path.join(workspace.path, 'README.md'), 'utf8')).toBe('Version 2\n');
    expect((await execFile('git', ['-C', workspace.path, 'rev-list', '--count', 'HEAD'], { env: gitEnv() })).stdout.trim()).toBe('2');
    expect((await execFile('git', ['-C', workspace.path, 'config', 'core.filemode'], { env: gitEnv() })).stdout.trim()).toBe('false');
    expect(await ctx.workspaces.list()).toEqual([workspace]);
    expect(mock.clones).toHaveLength(1);
    expect(mock.clones[0].args).toContain('https://github.com/alice/example.git');
    expect(mock.clones[0].args.join(' ')).not.toContain(TOKEN_A);
    expect(mock.clones[0].args.join(' ')).not.toContain('attacker.example');
    expect(await readFile(path.join(workspace.path, '.git', 'config'), 'utf8')).not.toContain(TOKEN_A);
    expect(JSON.stringify(result.body)).not.toContain(TOKEN_A);
  });

  it('removes a failed clone and its registration while preserving unrelated files', async () => {
    const account = await connect();
    const existing = await ctx.workspaces.create({ name: 'Keep me' });
    await writeFile(path.join(existing.path, 'safe.txt'), 'Unrelated work');
    mock.cloneSource = path.join(temporary, 'does-not-exist');
    mock.respond = () => ({ status: 200, body: repository(123, 'alice/unavailable', true) });
    const result = await call('POST', '/github/import', { accountId: account.id, fullName: 'alice/unavailable' });
    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ code: 'GIT_CLONE_FAILED' });
    expect(await ctx.workspaces.list()).toEqual([existing]);
    expect((await readdir(ctx.config.workspacesDir)).filter(name => name !== '.workspace-trash')).toEqual([existing.id]);
    expect(await ctx.workspaces.listWorkspaceTrash()).toEqual([]);
    expect(await readFile(path.join(existing.path, 'safe.txt'), 'utf8')).toBe('Unrelated work');
    expect(JSON.stringify(result.body)).not.toContain(TOKEN_A);
  });

  it.each(['https://github.com/alice/repo', '../outside', 'alice/..', 'alice/repo/extra', 'alice/repo?token=secret'])('rejects invalid repository path %j before creating files', async (fullName) => {
    const account = await connect();
    const before = mock.requests.length;
    const result = await call('POST', '/github/import', { accountId: account.id, fullName });
    expect(result.status).toBe(400);
    expect(mock.requests).toHaveLength(before);
    expect(mock.clones).toHaveLength(0);
    expect(await ctx.workspaces.list()).toEqual([]);
  });
});
