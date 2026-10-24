import { afterEach, describe, expect, it } from 'vitest';
import { execFile as execFileCallback, spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Bootstrap, GithubAccount, GithubRepo, GithubRepoPage, Workspace } from '../shared/types';

// The application, AuthService, routers, and disk storage are real. Only the
// external GitHub HTTPS boundary is replaced by a local synthetic API fixture.
// Each app instance runs in its own Node process. The second process receives
// no GitHub token in its arguments or environment: it must recover both from
// the persisted credential store using the same environment encryption key.
const password = 'github-persistence-fixture-workspace-password';
const sessionSecret = 'github-persistence-fixture-session-secret-over-32-characters';
const encryptionKey = 'github-persistence-fixture-encryption-key-over-32-characters';
const accountFixtures = [
  { id: 108101, login: 'fixture-alice', name: 'Persistence fixture Alice', token: 'github_pat_persistence_fixture_alice_not_real_1234567890' },
  { id: 108202, login: 'fixture-bob', name: 'Persistence fixture Bob', token: 'github_pat_persistence_fixture_bob_not_real_1234567890' },
];
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const children = new Set<ChildProcess>();
const directories = new Set<string>();
const upstreamServers = new Set<Server>();
const releaseGates = new Set<() => void>();
const execFile = promisify(execFileCallback);

interface AppProcess { child: ChildProcess; pid: number; base: string; dataDir: string; stateDir: string }
interface RequestOptions { method?: string; cookie?: string; body?: unknown }
interface Reply<T> { status: number; headers: Headers; body: T }
interface GithubRequest { path: string; authorization?: string; accountId?: number }

const appBootstrap = String.raw`
  import https from 'node:https';
  import http from 'node:http';
  import childProcess from 'node:child_process';
  import { syncBuiltinESMExports } from 'node:module';

  // Test-only boundary replacement, installed before importing the real server.
  // It never forwards a request to the public internet and accepts only the
  // application's fixed api.github.com HTTPS destination.
  https.request = (options, callback) => {
    if (!options || typeof options !== 'object' || options.hostname !== 'api.github.com' || options.protocol !== 'https:') {
      throw new Error('Unexpected external destination in the synthetic GitHub fixture.');
    }
    return http.request({
      ...options,
      protocol: 'http:', hostname: '127.0.0.1',
      port: Number(process.env.CODEX_TEST_GITHUB_PORT), agent: false,
    }, callback);
  };
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = (command, args, options) => {
    if (command === 'git' && args.includes('clone')) {
      const source = process.env.CODEX_TEST_GITHUB_REPOSITORY;
      if (!source) throw new Error('The synthetic Git remote has not been configured.');
      const allowed = /^https:\/\/github\.com\/fixture-(?:alice|bob)\/private-project\.git$/;
      const mapped = args.map(argument => allowed.test(argument) ? source : argument);
      if (mapped.some(argument => argument.startsWith('https://'))) throw new Error('Unexpected remote in the synthetic Git fixture.');
      return originalSpawn(command, ['-c', 'protocol.file.allow=always', ...mapped], options);
    }
    return originalSpawn(command, args, options);
  };
  syncBuiltinESMExports();

  const { createApplication } = await import('./server/index.ts');
  const runtime = await createApplication();
  await new Promise((resolve, reject) => {
    runtime.server.once('error', reject);
    runtime.server.listen(0, '127.0.0.1', resolve);
  });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try { await runtime.close(); process.exit(0); }
    catch { process.exit(1); }
  };
  process.on('message', message => { if (message?.type === 'close') void stop(); });
  process.once('SIGTERM', () => void stop());
  process.send({
    type: 'ready', pid: process.pid,
    base: 'http://127.0.0.1:' + runtime.server.address().port,
    dataDir: runtime.ctx.config.dataDir, stateDir: runtime.ctx.config.stateDir,
  });
`;

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => child.kill('SIGKILL'), 8_000);
    timeout.unref();
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`Persistence fixture did not shut down cleanly (${signal ?? code}).`));
    });
    if (child.connected) child.send({ type: 'close' }, error => { if (error) child.kill('SIGTERM'); });
    else child.kill('SIGTERM');
  });
}

async function startProcess(dataDir: string, githubPort: number, repository?: string): Promise<AppProcess> {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8',
    NODE_ENV: 'test', DATA_DIR: dataDir,
    WORKSPACE_PASSWORD: password, SESSION_SECRET: sessionSecret, ENCRYPTION_KEY: encryptionKey,
    CODEX_TEST_GITHUB_PORT: String(githubPort),
    CODEX_TEST_GITHUB_REPOSITORY: repository,
  };
  // No PAT is injected into either fresh application's environment or code.
  for (const account of accountFixtures) {
    expect(JSON.stringify(env)).not.toContain(account.token);
    expect(appBootstrap).not.toContain(account.token);
  }
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', appBootstrap], {
    cwd: projectRoot, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  let diagnostic = '';
  child.stdout?.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-4096); });
  child.stderr?.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-4096); });
  const ready = await new Promise<Omit<AppProcess, 'child'>>((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`Persistence fixture startup timed out. ${diagnostic}`)); }, 15_000);
    timeout.unref();
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup(); reject(new Error(`Persistence fixture exited during startup (${signal ?? code}). ${diagnostic}`));
    };
    const onMessage = (value: unknown) => {
      const message = value as { type?: string; pid?: number; base?: string; dataDir?: string; stateDir?: string };
      if (message?.type !== 'ready') return;
      if (typeof message.pid !== 'number' || typeof message.base !== 'string' || typeof message.dataDir !== 'string' || typeof message.stateDir !== 'string') {
        cleanup(); reject(new Error('Invalid persistence fixture startup response.')); return;
      }
      cleanup();
      resolve({ pid: message.pid, base: message.base, dataDir: message.dataDir, stateDir: message.stateDir });
    };
    function cleanup() {
      clearTimeout(timeout);
      child.off('error', onError); child.off('exit', onExit); child.off('message', onMessage);
    }
    child.once('error', onError); child.once('exit', onExit); child.on('message', onMessage);
  });
  return { child, ...ready };
}

async function startGithubFixture() {
  const requests: GithubRequest[] = [];
  const failures: string[] = [];
  let heldUsers: { count: number; replies: (() => void)[]; arrived: () => void } | undefined;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const account = accountFixtures.find(candidate => req.headers.authorization === `Bearer ${candidate.token}`);
    requests.push({ path: url.pathname, authorization: req.headers.authorization, accountId: account?.id });
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'GET' || req.headers['x-github-api-version'] !== '2026-03-10') {
      failures.push('Unexpected GitHub method or API version.');
      res.statusCode = 400; res.end(JSON.stringify({ message: 'Invalid synthetic API request.' })); return;
    }
    if (!account) {
      failures.push('A repository request lost or mixed up its stored account token.');
      res.statusCode = 401; res.end(JSON.stringify({ message: 'Unknown synthetic credential.' })); return;
    }
    if (url.pathname === '/user') {
      const reply = () => res.end(JSON.stringify({ id: account.id, login: account.login, name: account.name, avatar_url: `https://avatars.githubusercontent.com/u/${account.id}` }));
      if (heldUsers) {
        heldUsers.replies.push(reply);
        if (heldUsers.replies.length === heldUsers.count) heldUsers.arrived();
      } else reply();
      return;
    }
    if (url.pathname === '/user/repos') {
      if (url.searchParams.get('visibility') !== 'all' || url.searchParams.get('affiliation') !== 'owner,collaborator,organization_member') {
        failures.push('The restored account did not request all accessible repository affiliations.');
      }
      res.end(JSON.stringify([{
        id: account.id * 10, name: 'private-project', full_name: `${account.login}/private-project`,
        private: true, description: 'Synthetic private repository used only by the restart test.',
        default_branch: 'main', updated_at: '2026-09-19T00:00:00Z',
      }])); return;
    }
    if (url.pathname === `/repos/${account.login}/private-project`) {
      res.end(JSON.stringify({ id: account.id * 10, name: 'private-project', full_name: `${account.login}/private-project`, private: true,
        description: 'Synthetic private Git repository.', default_branch: 'main', updated_at: '2026-09-19T00:00:00Z' })); return;
    }
    failures.push(`Unexpected GitHub API path: ${url.pathname}`);
    res.statusCode = 404; res.end(JSON.stringify({ message: 'Unknown synthetic endpoint.' }));
  });
  upstreamServers.add(server);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Synthetic GitHub fixture did not start.');
  return { port: address.port, requests, failures, holdNextUsers: (count: number) => {
    if (heldUsers) throw new Error('A synthetic verification gate is already active.');
    let arrived!: () => void;
    const ready = new Promise<void>(resolve => { arrived = resolve; });
    heldUsers = { count, replies: [], arrived };
    const release = () => {
      const replies = heldUsers?.replies ?? [];
      heldUsers = undefined;
      for (const reply of replies) reply();
    };
    releaseGates.add(release);
    return { ready, release };
  } };
}

async function request<T = Record<string, unknown>>(app: AppProcess, endpoint: string, options: RequestOptions = {}): Promise<Reply<T>> {
  const response = await fetch(`${app.base}/api${endpoint}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json', 'X-Codex-Workspace': '1', Connection: 'close', Origin: app.base,
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  return { status: response.status, headers: response.headers, body: await response.json() as T };
}

async function signIn(app: AppProcess): Promise<string> {
  const login = await request(app, '/session', { method: 'POST', body: { password } });
  expect(login.status).toBe(200);
  expect(login.body).toEqual({ authenticated: true });
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  expect(cookie).toMatch(/^codex_workspace_session=.+/);
  return cookie!;
}

async function savedAccountFiles(stateDir: string): Promise<Map<string, string>> {
  const filenames = (await readdir(stateDir)).filter(file => file.startsWith('github-account-version-') || file.startsWith('github-account-base-')).sort();
  return new Map(await Promise.all(filenames.map(async file => [file, await readFile(path.join(stateDir, file), 'utf8')] as const)));
}

function gitEnvironment(directory: string): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, HOME: directory, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
}

async function createGitFixture(directory: string): Promise<string> {
  const source = path.join(directory, 'synthetic-remote');
  await mkdir(source);
  await execFile('git', ['-c', 'init.templateDir=', 'init', '--initial-branch=main', source], { env: gitEnvironment(directory) });
  for (const version of [1, 2]) {
    await writeFile(path.join(source, 'README.md'), `Synthetic private repository version ${version}\n`);
    await execFile('git', ['-C', source, 'add', 'README.md'], { env: gitEnvironment(directory) });
    await execFile('git', ['-C', source, '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Source Fixture', '-c', 'user.email=source@example.test', 'commit', '-m', `Version ${version}`], { env: gitEnvironment(directory) });
  }
  return source;
}

afterEach(async () => {
  for (const release of releaseGates) release();
  releaseGates.clear();
  await Promise.all([...children].map(stopProcess));
  await Promise.all([...upstreamServers].map(server => new Promise<void>((resolve, reject) => {
    server.closeAllConnections(); server.close(error => error ? reject(error) : resolve());
  })));
  upstreamServers.clear();
  await Promise.all([...directories].map(directory => rm(directory, { recursive: true, force: true })));
  directories.clear();
});

describe('GitHub account persistence across real application processes', () => {
  it('restores two accounts from the data directory after logout, restart, and password-only sign-in without reconnecting GitHub', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'codex-github-persistence-'));
    directories.add(dataDir);
    const github = await startGithubFixture();
    const first = await startProcess(dataDir, github.port);
    expect(first.dataDir).toBe(dataDir);
    expect(first.stateDir).toBe(path.join(dataDir, 'codex-workspace', 'state'));
    expect((await request(first, '/github/accounts')).status).toBe(401);
    expect(github.requests).toHaveLength(0);

    const firstCookie = await signIn(first);
    const accounts: GithubAccount[] = [];
    for (const fixture of accountFixtures) {
      const connected = await request<GithubAccount>(first, '/github/accounts', { method: 'POST', cookie: firstCookie, body: { token: fixture.token } });
      expect(connected.status).toBe(201);
      expect(connected.body).toMatchObject({ id: `gh_${fixture.id}`, login: fixture.login });
      accounts.push(connected.body);
    }
    expect(github.requests.filter(call => call.path === '/user')).toHaveLength(2);

    const created = await request<Workspace>(first, '/workspaces', { method: 'POST', cookie: firstCookie, body: { name: 'Persistent GitHub account selection' } });
    expect(created.status).toBe(201);
    const workspace = created.body;
    expect(path.dirname(workspace.path)).toBe(path.join(dataDir, 'workspaces'));
    expect((await request(first, `/workspaces/${workspace.id}`, { method: 'PATCH', cookie: firstCookie, body: { githubAccountId: accounts[1].id } })).status).toBe(200);
    expect((await request(first, `/workspaces/${workspace.id}/files`, { method: 'POST', cookie: firstCookie, body: { path: 'plain.txt', kind: 'file' } })).status).toBe(201);
    const ordinaryText = 'Ordinary workspace content stays unencrypted in the configured data directory.\n';
    expect((await request(first, `/workspaces/${workspace.id}/file`, { method: 'PUT', cookie: firstCookie, body: { path: 'plain.txt', content: ordinaryText } })).status).toBe(200);
    expect(await readFile(path.join(workspace.path, 'plain.txt'), 'utf8')).toBe(ordinaryText);

    const savedRecords = await savedAccountFiles(first.stateDir);
    expect(savedRecords.size).toBe(2);
    const connectionValues = [...savedRecords.values()].map(value => JSON.parse(value));
    expect(connectionValues.map(value => value.account).sort((a, b) => a.id.localeCompare(b.id))).toEqual(accounts);
    for (const value of connectionValues) expect(typeof value.encryptedToken).toBe('string');
    for (const secret of [...accountFixtures.map(account => account.token), password, sessionSecret, encryptionKey]) {
      expect([...savedRecords.values()].join('\n')).not.toContain(secret);
    }

    const logout = await request(first, '/session', { method: 'DELETE', cookie: firstCookie });
    expect(logout.body).toEqual({ authenticated: false });
    expect((await request(first, '/github/accounts', { cookie: firstCookie })).status).toBe(401);
    await stopProcess(first.child);
    expect(first.child.exitCode).toBe(0);

    const second = await startProcess(dataDir, github.port);
    expect(second.pid).not.toBe(first.pid);
    expect(second.stateDir).toBe(first.stateDir);
    expect((await request(second, '/session', { cookie: firstCookie })).body).toEqual({ authenticated: false });
    for (const endpoint of ['/github/accounts', `/github/accounts/${accounts[0].id}/repos`, `/workspaces/${workspace.id}/file?path=plain.txt`]) {
      expect((await request(second, endpoint)).status, endpoint).toBe(401);
    }

    // This is the only sign-in needed in the replacement server. No token entry
    // or POST /github/accounts occurs after the original process has exited.
    const secondCookie = await signIn(second);
    const restored = await request<GithubAccount[]>(second, '/github/accounts', { cookie: secondCookie });
    expect(restored.status).toBe(200);
    expect(restored.body).toEqual(accounts);
    const bootstrap = await request<Bootstrap>(second, '/bootstrap', { cookie: secondCookie });
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.body.githubAccounts).toEqual(accounts);
    expect(bootstrap.body.workspaces.find(item => item.id === workspace.id)?.githubAccountId).toBe(accounts[1].id);
    const savedFile = await request(second, `/workspaces/${workspace.id}/file?path=plain.txt`, { cookie: secondCookie });
    expect(savedFile.status).toBe(200);
    expect(savedFile.body.content).toBe(ordinaryText);

    for (let index = 0; index < accounts.length; index += 1) {
      const repos = await request<GithubRepo[]>(second, `/github/accounts/${accounts[index].id}/repos`, { cookie: secondCookie });
      expect(repos.status).toBe(200);
      expect(repos.body).toMatchObject([{ fullName: `${accountFixtures[index].login}/private-project`, private: true }]);
      expect(github.requests.at(-1)).toEqual({ path: '/user/repos', authorization: `Bearer ${accountFixtures[index].token}`, accountId: accountFixtures[index].id });
      expect(JSON.stringify(repos.body)).not.toContain(accountFixtures[index].token);
    }

    // Another ordinary lock/unlock also leaves both GitHub connections intact.
    expect((await request(second, '/session', { method: 'DELETE', cookie: secondCookie })).body).toEqual({ authenticated: false });
    const thirdCookie = await signIn(second);
    expect((await request<GithubAccount[]>(second, '/github/accounts', { cookie: thirdCookie })).body).toEqual(accounts);
    // Locking the workspace does not discard its bounded public repository
    // cache. Each account still receives only its own cached private listing.
    const beforeCachedReads = github.requests.length;
    for (let index = 0; index < accounts.length; index += 1) {
      const cached = await request<GithubRepoPage>(second, `/github/accounts/${accounts[index].id}/repos?paged=1`, { cookie: thirdCookie });
      expect(cached.status).toBe(200);
      expect(cached.body.repositories).toMatchObject([{ fullName: `${accountFixtures[index].login}/private-project`, private: true }]);
      for (const fixture of accountFixtures) expect(JSON.stringify(cached.body)).not.toContain(fixture.token);
    }
    expect(github.requests).toHaveLength(beforeCachedReads);

    // Explicit refresh proves the saved credential still reaches the external
    // API boundary after this second password-only unlock, without /user
    // verification or token entry. Assert the exact account/token requests below.
    const refreshed = await request<GithubRepoPage>(second, `/github/accounts/${accounts[0].id}/repos?paged=1&refresh=1`, { cookie: thirdCookie });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.repositories).toMatchObject([{ fullName: `${accountFixtures[0].login}/private-project`, private: true }]);
    expect(github.requests.at(-1)).toEqual({ path: '/user/repos', authorization: `Bearer ${accountFixtures[0].token}`, accountId: accountFixtures[0].id });
    for (const fixture of accountFixtures) expect(JSON.stringify(refreshed.body)).not.toContain(fixture.token);
    expect(github.requests.filter(call => call.path === '/user')).toHaveLength(2);
    expect(github.requests.filter(call => call.path === '/user/repos').map(call => call.authorization)).toEqual([
      `Bearer ${accountFixtures[0].token}`, `Bearer ${accountFixtures[1].token}`, `Bearer ${accountFixtures[0].token}`,
    ]);
    expect(github.failures).toEqual([]);
    expect(await savedAccountFiles(second.stateDir)).toEqual(savedRecords);
    expect(await readFile(path.join(workspace.path, 'plain.txt'), 'utf8')).toBe(ordinaryText);
  }, 30_000);

  it('keeps overlapping connections from two live app processes, then uses both saved accounts and real Git repositories after a fresh password-only restart', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'codex-github-overlap-'));
    directories.add(directory);
    const dataDir = path.join(directory, 'data');
    const source = await createGitFixture(directory);
    const github = await startGithubFixture();
    const first = await startProcess(dataDir, github.port, source);
    const second = await startProcess(dataDir, github.port, source);
    expect(first.pid).not.toBe(second.pid);
    const firstCookie = await signIn(first);
    const secondCookie = await signIn(second);
    const gate = github.holdNextUsers(2);
    const connecting = [
      request<GithubAccount>(first, '/github/accounts', { method: 'POST', cookie: firstCookie, body: { token: accountFixtures[0].token } }),
      request<GithubAccount>(second, '/github/accounts', { method: 'POST', cookie: secondCookie, body: { token: accountFixtures[1].token } }),
    ];
    await gate.ready;
    gate.release();
    const connected = await Promise.all(connecting);
    expect(connected.map(reply => reply.status)).toEqual([201, 201]);
    const accounts = connected.map(reply => reply.body);
    for (const [app, cookie] of [[first, firstCookie], [second, secondCookie]] as const) {
      const visible = await request<GithubAccount[]>(app, '/github/accounts', { cookie });
      expect(visible.body.map(account => account.id).sort()).toEqual(accounts.map(account => account.id).sort());
    }

    const imported = await Promise.all([first, second].map((app, index) => request<Workspace>(app, '/github/import', {
      method: 'POST', cookie: index ? secondCookie : firstCookie,
      body: { accountId: accounts[index].id, fullName: `${accountFixtures[index].login}/private-project`, name: `Saved ${accountFixtures[index].login} repository` },
    })));
    expect(imported.map(reply => reply.status)).toEqual([201, 201]);
    const workspaces = imported.map(reply => reply.body);
    for (let index = 0; index < workspaces.length; index += 1) {
      expect(workspaces[index].githubAccountId).toBe(accounts[index].id);
      const history = await execFile('git', ['-C', workspaces[index].path, 'rev-list', '--count', 'HEAD'], { env: gitEnvironment(directory) });
      expect(history.stdout.trim()).toBe('2');
      expect(await readFile(path.join(workspaces[index].path, 'README.md'), 'utf8')).toBe('Synthetic private repository version 2\n');
    }
    const savedRecords = await savedAccountFiles(first.stateDir);
    expect(savedRecords.size).toBe(2);
    for (const fixture of accountFixtures) expect([...savedRecords.values()].join('\n')).not.toContain(fixture.token);

    expect((await request(first, '/session', { method: 'DELETE', cookie: firstCookie })).status).toBe(200);
    expect((await request(second, '/session', { method: 'DELETE', cookie: secondCookie })).status).toBe(200);
    await stopProcess(first.child); await stopProcess(second.child);
    const restored = await startProcess(dataDir, github.port, source);
    expect([first.pid, second.pid]).not.toContain(restored.pid);
    expect((await request(restored, '/github/accounts')).status).toBe(401);
    const cookie = await signIn(restored);
    const bootstrap = await request<Bootstrap>(restored, '/bootstrap', { cookie });
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.body.githubAccounts.map(account => account.id).sort()).toEqual(accounts.map(account => account.id).sort());
    for (let index = 0; index < accounts.length; index += 1) {
      const workspace = workspaces[index];
      expect(bootstrap.body.workspaces.find(item => item.id === workspace.id)?.githubAccountId).toBe(accounts[index].id);
      const repos = await request<GithubRepo[]>(restored, `/github/accounts/${accounts[index].id}/repos`, { cookie });
      expect(repos.status).toBe(200);
      expect(repos.body[0].fullName).toBe(`${accountFixtures[index].login}/private-project`);
      expect(github.requests.at(-1)).toEqual({ path: '/user/repos', accountId: accountFixtures[index].id, authorization: `Bearer ${accountFixtures[index].token}` });
      const content = await request(restored, `/workspaces/${workspace.id}/file?path=README.md`, { cookie });
      const updated = await request(restored, `/workspaces/${workspace.id}/file`, {
        method: 'PUT', cookie, body: { path: 'README.md', content: `Saved edit for ${accountFixtures[index].login}\n`, expectedVersion: content.body.version },
      });
      expect(updated.status).toBe(200);
      expect((await request(restored, `/workspaces/${workspace.id}/git/stage`, { method: 'POST', cookie, body: { paths: ['README.md'] } })).status).toBe(200);
      expect((await request(restored, `/workspaces/${workspace.id}/git/commit`, { method: 'POST', cookie, body: { message: 'Commit after password-only restart' } })).status).toBe(200);
      const author = await execFile('git', ['-C', workspace.path, 'log', '-1', '--format=%an|%ae'], { env: gitEnvironment(directory) });
      expect(author.stdout.trim()).toBe(`${accountFixtures[index].name}|${accountFixtures[index].login}@users.noreply.github.com`);
      expect(await readFile(path.join(workspace.path, 'README.md'), 'utf8')).toBe(`Saved edit for ${accountFixtures[index].login}\n`);
      const gitConfig = await readFile(path.join(workspace.path, '.git', 'config'), 'utf8');
      for (const fixture of accountFixtures) expect(gitConfig).not.toContain(fixture.token);
    }
    expect(github.requests.filter(call => call.path === '/user')).toHaveLength(2);
    expect(github.failures).toEqual([]);
    expect(await savedAccountFiles(restored.stateDir)).toEqual(savedRecords);
  }, 30_000);
});
