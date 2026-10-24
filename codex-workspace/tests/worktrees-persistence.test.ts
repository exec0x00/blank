import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const processes = new Set<ChildProcess>();
const directories = new Set<string>();
const fixtureToken = 'github_pat_worktree_persistence_fixture_not_a_real_token_123456789';

// Every service, Git command, native file and credential askpass exchange is
// real. The saved account fixture stands for an already verified connection;
// this test makes no GitHub request and puts no PAT in child arguments/env.
const bootstrap = String.raw`
  import { EventEmitter } from 'node:events';
  import { createHash } from 'node:crypto';
  import { spawn } from 'node:child_process';
  import fs from 'node:fs/promises';
  import path from 'node:path';
  import { loadConfig } from './server/config.ts';
  import { JsonStore, SecretStore } from './server/store.ts';
  import { WorkspaceService } from './server/workspaces.ts';
  import { WorktreeService } from './server/worktrees.ts';
  import { GitService, runGit } from './server/git.ts';
  import { FileMetadataManager } from './server/file-metadata.ts';
  import { listGithubAccounts, withGitCredentials } from './server/github.ts';

  const config = loadConfig();
  for (const dir of [config.dataDir, config.stateDir, config.workspacesDir, config.homeDir]) await fs.mkdir(dir, { recursive: true });
  const store = new JsonStore(config.stateDir);
  const events = new EventEmitter();
  const settings = { model: 'test', reasoningEffort: 'max', autoApprove: false, theme: 'dark', fontSize: 13, wordWrap: true, provider: 'openai', apiKeyConfigured: false };
  const ctx = { config, store, events, secrets: new SecretStore(store, config.encryptionKey), workspaces: new WorkspaceService(config, store), settings: async () => settings, saveSettings: async patch => Object.assign(settings, patch), providerKey: async () => undefined };
  const metadata = new FileMetadataManager(config, store, events);
  await metadata.initialize();
  await ctx.workspaces.initialize();
  const worktrees = new WorktreeService(ctx);
  await worktrees.initialize();
  const git = new GitService(ctx);
  async function credentialProof(workspace) {
    return withGitCredentials(ctx, workspace.githubAccountId, env => new Promise((resolve, reject) => {
      const child = spawn('git', ['-c', 'safe.directory=', '-c', 'safe.directory=' + workspace.path, '-c', 'credential.helper=', 'credential', 'fill'], { cwd: workspace.path, env, stdio: ['pipe', 'pipe', 'pipe'] });
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Credential fixture timed out.')); }, 5000);
      const output = [];
      let diagnostic = '';
      let size = 0;
      child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-2000); });
      child.stdout.on('data', chunk => { size += chunk.length; if (size > 4096) { child.kill('SIGKILL'); reject(new Error('Oversized credential fixture.')); } else output.push(chunk); });
      child.on('error', () => { clearTimeout(timer); reject(new Error('Credential fixture failed to start.')); });
      child.on('close', code => {
        clearTimeout(timer);
        if (code) return reject(new Error('Credential fixture failed: ' + diagnostic.replace(/github_pat_[A-Za-z0-9_]+/g, '[redacted]')));
        const fields = Object.fromEntries(Buffer.concat(output).toString('utf8').trim().split('\n').map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]; }));
        resolve({ login: fields.username, fingerprint: createHash('sha256').update(fields.password || '').digest('hex') });
      });
      child.stdin.end('protocol=https\nhost=github.com\n\n');
    }));
  }
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    await metadata.capture();
    await metadata.close();
    await store.flush();
    process.exit(0);
  }
  process.on('message', async request => {
    try {
      if (request.type === 'close') return await close();
      if (request.type === 'create') {
        const account = { id: 'gh_989101', login: 'fixture-worktree-owner', name: 'Worktree Owner Fixture', avatarUrl: '', createdAt: new Date().toISOString() };
        await store.write('github-accounts', [account]);
        await ctx.secrets.set('github-' + account.id, request.token);
        await listGithubAccounts(ctx);
        const source = await ctx.workspaces.create({ name: 'Persistent source', initializeGit: true });
        await ctx.workspaces.update(source.id, { githubAccountId: account.id });
        await fs.writeFile(path.join(source.path, 'run.sh'), '#!/bin/sh\nprintf native-worktree\n', { mode: 0o755 });
        await git.stage(source.id, ['run.sh']);
        await git.commit(source.id, 'Persistent source commit');
        const child = await worktrees.create(source.id, { name: 'Persistent child', branch: 'persistent/task', createBranch: true });
        await fs.writeFile(path.join(child.workspace.path, 'plain.txt'), 'ordinary unencrypted worktree files\n');
        await fs.mkdir(path.join(child.workspace.path, 'empty-user-folder'));
        await fs.symlink('run.sh', path.join(child.workspace.path, 'run-link'));
        await store.write('thread-worktree-persistence', { id: 'worktree-persistence', workspaceId: child.workspace.id, messages: [{ role: 'user', content: 'Keep this conversation binding' }] });
        await worktrees.archive(source.id, child.worktree.id);
        await metadata.capture();
        process.send({ type: 'result', id: request.id, value: { pid: process.pid, source, child, stateDir: config.stateDir } });
      } else if (request.type === 'verify') {
        const before = await worktrees.list(request.sourceId);
        const workspace = await worktrees.open(request.sourceId, request.worktreeId);
        const proof = await credentialProof(workspace);
        const status = await git.status(workspace.id);
        const author = (await runGit(workspace.path, ['log', '-1', '--format=%an|%ae'])).stdout.toString('utf8').trim();
        process.send({ type: 'result', id: request.id, value: {
          pid: process.pid, before, workspace, status, proof, author,
          plain: await fs.readFile(path.join(workspace.path, 'plain.txt'), 'utf8'),
          pointer: await fs.readFile(path.join(workspace.path, '.git'), 'utf8'),
          mode: (await fs.stat(path.join(workspace.path, 'run.sh'))).mode & 0o777,
          link: await fs.readlink(path.join(workspace.path, 'run-link')),
          empty: (await fs.stat(path.join(workspace.path, 'empty-user-folder'))).isDirectory(),
          thread: await store.read('thread-worktree-persistence', null),
          accounts: await listGithubAccounts(ctx),
        } });
      }
    } catch (error) {
      // Never send raw command output or credential-bearing error objects.
      process.send({ type: 'failure', id: request.id, error: { name: error?.name, code: error?.code, message: String(error?.message || '').replace(/github_pat_[A-Za-z0-9_]+/g, '[redacted]') } });
    }
  });
  process.once('SIGTERM', () => void close());
  process.send({ type: 'ready', pid: process.pid });
`;

async function start(dataDir: string): Promise<ChildProcess> {
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8', NODE_ENV: 'test', DATA_DIR: dataDir,
    WORKSPACE_PASSWORD: 'worktree-persistence-fixture-password', SESSION_SECRET: 'worktree-persistence-session-secret-over-32-characters',
    ENCRYPTION_KEY: 'worktree-persistence-encryption-key-over-32-characters',
  };
  expect(JSON.stringify(env)).not.toContain(fixtureToken);
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', bootstrap], {
    cwd: projectRoot, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  processes.add(child);
  child.once('exit', () => processes.delete(child));
  let diagnostic = '';
  child.stderr?.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-2000); });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Worktree fixture startup timed out: ${diagnostic}`)), 10_000);
    const ready = (value: unknown) => {
      if ((value as { type?: string })?.type !== 'ready') return;
      clearTimeout(timer); child.off('message', ready); child.off('exit', exited); resolve();
    };
    const exited = () => { clearTimeout(timer); child.off('message', ready); reject(new Error(`Worktree fixture exited: ${diagnostic}`)); };
    child.on('message', ready); child.once('exit', exited); child.once('error', reject);
  });
  return child;
}

async function request<T>(child: ChildProcess, body: object): Promise<T> {
  const id = Math.random().toString(16).slice(2);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { child.off('message', receive); reject(new Error('Worktree fixture request timed out.')); }, 12_000);
    const receive = (value: unknown) => {
      const reply = value as { id?: string; type?: string; value: T; error?: object };
      if (reply?.id !== id) return;
      clearTimeout(timer); child.off('message', receive);
      if (reply.type === 'failure') reject(new Error(JSON.stringify(reply.error)));
      else resolve(reply.value);
    };
    child.on('message', receive);
    child.send({ ...body, id });
  });
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 6000);
    child.once('exit', (code, signal) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Worktree fixture close failed: ${signal ?? code}`)); });
    child.send({ type: 'close' });
  });
}

afterEach(async () => {
  for (const child of [...processes]) await stop(child).catch(() => { child.kill('SIGKILL'); });
  for (const directory of directories) await fs.rm(directory, { recursive: true, force: true });
  directories.clear();
});

describe('worktree persistence across real Node processes', () => {
  it('restores native metadata, linked Git, the same conversation/account selection, and real askpass credentials without a new token', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-worktree-restart-'));
    directories.add(directory);
    const first = await start(directory);
    const created = await request<{
      pid: number; source: { id: string; path: string }; child: { workspace: { id: string; path: string }; worktree: { id: string } }; stateDir: string;
    }>(first, { type: 'create', token: fixtureToken });
    await stop(first);
    const childPath = created.child.workspace.path;
    // Simulate the native bucket's loss of POSIX metadata, while all normal file
    // bytes and JSON stay readable on disk. Startup owns restoration, not mounting.
    await fs.chmod(path.join(childPath, 'run.sh'), 0o644);
    await fs.unlink(path.join(childPath, 'run-link'));
    await fs.rmdir(path.join(childPath, 'empty-user-folder'));
    const second = await start(directory);
    const checked = await request<{
      pid: number; before: Array<{ state: string }>; workspace: { id: string; path: string; githubAccountId: string };
      status: { branch: string; files: Array<{ path: string }> }; proof: { login: string; fingerprint: string }; author: string;
      plain: string; pointer: string; mode: number; link: string; empty: boolean; thread: { workspaceId: string }; accounts: Array<{ id: string }>;
    }>(second, { type: 'verify', sourceId: created.source.id, worktreeId: created.child.worktree.id });
    expect(checked.pid).not.toBe(created.pid);
    expect(checked.before[0].state).toBe('archived');
    expect(checked.workspace).toMatchObject({ id: created.child.workspace.id, path: childPath, githubAccountId: 'gh_989101' });
    expect(checked.thread.workspaceId).toBe(created.child.workspace.id);
    expect(checked.status.branch).toBe('persistent/task');
    expect(checked.status.files.map(file => file.path)).toContain('plain.txt');
    expect(checked.plain).toBe('ordinary unencrypted worktree files\n');
    expect(checked.pointer).toContain(path.join(created.source.path, '.git', 'worktrees'));
    expect(checked.mode).toBe(0o755);
    expect(checked.link).toBe('run.sh');
    expect(checked.empty).toBe(true);
    expect(checked.accounts.map(account => account.id)).toEqual(['gh_989101']);
    expect(checked.author).toBe('Worktree Owner Fixture|fixture-worktree-owner@users.noreply.github.com');
    expect(checked.proof).toEqual({ login: 'fixture-worktree-owner', fingerprint: createHash('sha256').update(fixtureToken).digest('hex') });
    expect(JSON.stringify(checked)).not.toContain(fixtureToken);
    for (const name of await fs.readdir(created.stateDir)) {
      if (name.endsWith('.json')) expect(await fs.readFile(path.join(created.stateDir, name), 'utf8')).not.toContain(fixtureToken);
    }
    await stop(second);
  }, 30_000);
});
