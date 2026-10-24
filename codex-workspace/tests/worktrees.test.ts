import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig } from '../server/config';
import type { AppContext } from '../server/context';
import { JsonStore, SecretStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import * as gitModule from '../server/git';
import { GitService } from '../server/git';
import { FileMetadataManager } from '../server/file-metadata';
import { WorktreeService } from '../server/worktrees';
import { HttpError } from '../server/errors';
import { encryptBuffer } from '../server/crypto';
import { getGithubAccount } from '../server/github';
import { acquireWorkspaceActivity, withWorkspaceRemoval } from '../server/worktrees/activity';
import { readWorktreeRecord, worktreeRecordKey } from '../server/worktrees/records';
import type { AppSettings, Workspace } from '../shared/types';
import type { WorktreeRecord } from '../server/worktrees/types';

const execute = promisify(execFile);
let directory: string;
let ctx: AppContext;
let source: Workspace;
let git: GitService;
let worktrees: WorktreeService;

function context(root: string): AppContext {
  const config = loadConfig({ DATA_DIR: root, WORKSPACE_PASSWORD: 'worktree-fixture-password', SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'e'.repeat(64) });
  const store = new JsonStore(config.stateDir);
  const settings: AppSettings = { model: 'test', reasoningEffort: 'max', autoApprove: false, theme: 'dark', fontSize: 13, wordWrap: true, provider: 'openai', apiKeyConfigured: false };
  return {
    config, store, secrets: new SecretStore(store, config.encryptionKey), events: new EventEmitter(), workspaces: new WorkspaceService(config, store),
    settings: async () => settings, saveSettings: async patch => Object.assign(settings, patch), providerKey: async () => undefined,
  };
}

async function command(cwd: string, ...args: string[]): Promise<string> {
  const result = await execute('git', ['-c', `safe.directory=${cwd}`, '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Worktree Fixture', '-c', 'user.email=worktrees@example.invalid', ...args], {
    cwd, timeout: 15_000, maxBuffer: 4 * 1024 * 1024,
    env: { PATH: process.env.PATH, HOME: directory, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
  });
  return result.stdout.trim();
}

async function branch(name = 'feature/worktree') { return worktrees.create(source.id, { branch: name, createBranch: true }); }

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-managed-worktrees-'));
  ctx = context(directory);
  source = await ctx.workspaces.create({ name: 'Source project', initializeGit: true });
  await fs.writeFile(path.join(source.path, 'notes.txt'), 'committed source\n');
  await fs.writeFile(path.join(source.path, '.gitignore'), 'ignored.txt\n');
  await command(source.path, 'add', '--all');
  await command(source.path, 'commit', '-m', 'Source commit');
  git = new GitService(ctx);
  worktrees = new WorktreeService(ctx);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await ctx?.store.flush();
  await fs.rm(directory, { recursive: true, force: true });
});

describe('managed native Git worktrees', () => {
  it('creates an independent branch checkout, uses actual editor paths, and stages/diffs/commits without changing dirty source files', async () => {
    const sourceHead = await command(source.path, 'rev-parse', 'HEAD');
    await fs.writeFile(path.join(source.path, 'notes.txt'), 'uncommitted source work\n');
    await fs.writeFile(path.join(source.path, 'source-only.txt'), 'leave this here\n');
    const { workspace, worktree } = await branch();
    expect(workspace.id).not.toBe(source.id);
    expect(workspace.path).toBe(path.join(ctx.config.workspacesDir, workspace.id));
    expect(workspace.worktree).toMatchObject({ id: worktree.id, sourceWorkspaceId: source.id, repositoryWorkspaceId: source.id, commonDirectory: path.join(source.path, '.git') });
    expect((await fs.lstat(path.join(workspace.path, '.git'))).isFile()).toBe(true);
    expect(await command(workspace.path, 'rev-parse', '--git-common-dir')).toBe(path.join(source.path, '.git'));
    expect(await command(source.path, 'worktree', 'list', '--porcelain')).toContain(`worktree ${workspace.path}`);
    expect(await ctx.workspaces.resolvePath(workspace.id, '')).toBe(workspace.path);
    const file = await ctx.workspaces.readFile(workspace.id, 'notes.txt');
    expect(file.content).toBe('committed source\n');
    await ctx.workspaces.writeFile(workspace.id, 'notes.txt', 'independent child work\n', file.version);
    expect((await git.status(workspace.id)).files).toContainEqual({ path: 'notes.txt', status: 'M', staged: false });
    expect(await git.diff(workspace.id, 'notes.txt', false)).toMatchObject({ original: 'committed source\n', modified: 'independent child work\n' });
    await git.stage(workspace.id, ['notes.txt']);
    const commit = await git.commit(workspace.id, 'Commit from the linked worktree');
    expect(await command(source.path, 'rev-parse', 'refs/heads/feature/worktree')).toBe(commit.commit);
    expect(await command(source.path, 'rev-parse', 'HEAD')).toBe(sourceHead);
    expect(await fs.readFile(path.join(source.path, 'notes.txt'), 'utf8')).toBe('uncommitted source work\n');
    expect(await fs.readFile(path.join(source.path, 'source-only.txt'), 'utf8')).toBe('leave this here\n');
    expect(await worktrees.list(source.id)).toEqual([expect.objectContaining({ id: worktree.id, state: 'ready', branch: 'feature/worktree', head: commit.commit, dirty: false })]);
  });

  it('opens an existing local branch and resolves a detached checkout from an explicit committed ref', async () => {
    await command(source.path, 'branch', 'existing/topic');
    await command(source.path, 'tag', 'release-fixture');
    const existing = await worktrees.create(source.id, { branch: 'existing/topic' });
    expect(await command(existing.workspace.path, 'branch', '--show-current')).toBe('existing/topic');
    const detached = await worktrees.create(source.id, { name: 'Detached review', base: 'release-fixture' });
    expect(await command(detached.workspace.path, 'branch', '--show-current')).toBe('');
    expect(await command(detached.workspace.path, 'rev-parse', 'HEAD')).toBe(await command(source.path, 'rev-parse', 'release-fixture'));
    expect(detached.worktree.branch).toBeUndefined();
  });

  it('inherits the selected account and repository identity while retaining explicit per-workspace overrides', async () => {
    const ownerId = 'gh_101';
    const otherId = 'gh_202';
    const fixtures = [
      { id: ownerId, login: 'worktree-owner-fixture', name: 'Owner account fixture', token: 'github_pat_worktree_owner_fixture_not_real_1234567890' },
      { id: otherId, login: 'worktree-other-fixture', name: 'Other account fixture', token: 'github_pat_worktree_other_fixture_not_real_1234567890' },
    ];
    // Controlled snapshots of verified connections use the real immutable
    // account schema. Fixture credentials remain encrypted and never enter Git.
    for (const { token, ...identity } of fixtures) {
      const version = randomUUID();
      const account = { ...identity, avatarUrl: '', createdAt: '2026-09-20T00:00:00Z' };
      await ctx.store.write(`github-account-version-${account.id}-${version}`, {
        schema: 1, kind: 'connection', account, version,
        encryptedToken: encryptBuffer(Buffer.from(token), ctx.config.encryptionKey).toString('base64'),
        supersedes: [], disconnects: [],
      });
      expect(await getGithubAccount(ctx, account.id)).toEqual(account);
    }
    await ctx.workspaces.update(source.id, { githubAccountId: ownerId });
    await command(source.path, 'config', 'user.name', 'Selected Repository Identity');
    await command(source.path, 'config', 'user.email', 'selected@example.invalid');
    const child = await branch();
    expect(child.workspace.githubAccountId).toBe(ownerId);
    await fs.writeFile(path.join(child.workspace.path, 'notes.txt'), 'child commit\n');
    await git.stage(child.workspace.id, ['notes.txt']);
    await git.commit(child.workspace.id, 'Use the repository identity');
    expect(await command(child.workspace.path, 'log', '-1', '--format=%an|%ae')).toBe('Selected Repository Identity|selected@example.invalid');
    await ctx.workspaces.update(child.workspace.id, { githubAccountId: otherId });
    expect((await ctx.workspaces.get(source.id)).githubAccountId).toBe(ownerId);
    const restarted = context(directory);
    const children = await new WorktreeService(restarted).list(source.id);
    expect(children[0].sourceWorkspaceId).toBe(source.id);
    expect((await restarted.workspaces.get(child.workspace.id)).githubAccountId).toBe(otherId);
    const saved = await fs.readFile(path.join(ctx.config.stateDir, `${worktreeRecordKey(child.worktree.id)}.json`), 'utf8');
    expect(JSON.parse(saved)).toMatchObject({ githubAccountId: ownerId });
    expect(JSON.parse(saved)).not.toHaveProperty('encryptedToken');
    for (const { token } of fixtures) expect(saved).not.toContain(token);
  });

  it('refuses a branch already in use and an unborn source without publishing a workspace', async () => {
    const before = (await ctx.workspaces.list()).map(workspace => workspace.id);
    await expect(worktrees.create(source.id, { branch: 'main' })).rejects.toMatchObject({ status: 409, code: 'WORKTREE_BRANCH_IN_USE' });
    expect((await ctx.workspaces.list()).map(workspace => workspace.id)).toEqual(before);
    expect(await worktrees.list(source.id)).toEqual([]);
    const empty = await ctx.workspaces.create({ name: 'No commits', initializeGit: true });
    await expect(worktrees.create(empty.id, {})).rejects.toMatchObject({ status: 409, code: 'WORKTREE_BASE_NOT_FOUND' });
  });

  it.each([
    { branch: '--help' }, { branch: 'main', base: 'HEAD' }, { createBranch: true }, { base: '--output=elsewhere' },
    { branch: 'bad\nname', createBranch: true }, { name: 'bad\0name' }, { path: '/tmp/unowned' }, { force: true },
  ])('rejects invalid or path-selecting creation input %j', async input => {
    const files = await fs.readdir(ctx.config.workspacesDir);
    await expect(worktrees.create(source.id, input)).rejects.toMatchObject({ status: 400 });
    expect(await fs.readdir(ctx.config.workspacesDir)).toEqual(files);
  });

  it('does not adopt an arbitrary linked .git file through a normal workspace registration', async () => {
    const unowned = await ctx.workspaces.create({ name: 'Unmanaged checkout' });
    await command(source.path, 'worktree', 'add', '--detach', unowned.path, 'HEAD');
    await expect(git.status(unowned.id)).rejects.toMatchObject({ code: 'EXTERNAL_GIT_DIRECTORY' });
    await expect(worktrees.create(unowned.id, {})).rejects.toMatchObject({ code: 'EXTERNAL_GIT_DIRECTORY' });
    expect(await worktrees.list(source.id)).toEqual([]);
    expect(await fs.readFile(path.join(unowned.path, 'notes.txt'), 'utf8')).toBe('committed source\n');
  });

  it('accepts legitimate relative Git links but rejects a wrong common directory or checkout backlink', async () => {
    const { workspace } = await branch();
    const admin = workspace.worktree!.gitDirectory;
    const gitFile = path.join(workspace.path, '.git');
    await fs.writeFile(gitFile, `gitdir: ${path.relative(workspace.path, admin)}\n`);
    await fs.writeFile(path.join(admin, 'gitdir'), `${path.relative(admin, gitFile)}\n`);
    expect((await git.status(workspace.id)).isRepository).toBe(true);
    await fs.writeFile(path.join(admin, 'commondir'), `${path.join(directory, 'outside')}\n`);
    await expect(git.status(workspace.id)).rejects.toMatchObject({ code: 'UNSAFE_WORKTREE' });
    await fs.writeFile(path.join(admin, 'commondir'), '../..\n');
    await fs.writeFile(path.join(admin, 'gitdir'), `${path.join(source.path, '.git')}\n`);
    await expect(worktrees.remove(source.id, workspace.worktree!.id)).rejects.toMatchObject({ code: 'UNSAFE_WORKTREE' });
    expect(await fs.readFile(path.join(workspace.path, 'notes.txt'), 'utf8')).toBe('committed source\n');
  });

  it('refuses symbolic links in the checkout, primary root, administration directory, and pointer file', async () => {
    const { workspace } = await branch();
    const admin = workspace.worktree!.gitDirectory;
    const gitFile = path.join(workspace.path, '.git');
    const pointer = await fs.readFile(gitFile);
    const outside = path.join(directory, 'outside-admin');
    await fs.rename(admin, outside);
    await fs.symlink(outside, admin);
    await expect(git.status(workspace.id)).rejects.toMatchObject({ code: 'UNSAFE_WORKTREE' });
    await fs.unlink(admin);
    await fs.rename(outside, admin);
    await fs.writeFile(path.join(directory, 'pointer'), pointer);
    await fs.unlink(gitFile);
    await fs.symlink(path.join(directory, 'pointer'), gitFile);
    await expect(git.status(workspace.id)).rejects.toMatchObject({ code: 'EXTERNAL_GIT_DIRECTORY' });
    await fs.unlink(gitFile);
    await fs.writeFile(gitFile, pointer);
    const moved = `${source.path}-original`;
    await fs.rename(source.path, moved);
    await fs.symlink(moved, source.path);
    await expect(git.status(workspace.id)).rejects.toMatchObject({ code: 'UNSAFE_WORKTREE' });
    expect(await fs.readFile(path.join(moved, 'notes.txt'), 'utf8')).toBe('committed source\n');
  });

  it('does not trust a common Git directory or object store outside authorized managed roots', async () => {
    const { workspace } = await branch();
    const record = (await readWorktreeRecord(ctx, workspace.worktree!.id))!;
    const outside = path.join(directory, 'unowned.git');
    await fs.mkdir(outside);
    await ctx.store.write(worktreeRecordKey(record.id), { ...record, repositoryPath: directory, commonDirectory: outside, gitDirectory: path.join(outside, 'worktrees', record.id) });
    await expect(git.status(workspace.id)).rejects.toMatchObject({ code: 'UNSAFE_WORKTREE' });
    await ctx.store.write(worktreeRecordKey(record.id), record);
    await fs.writeFile(path.join(source.path, '.git', 'objects', 'info', 'alternates'), `${outside}\n`);
    await expect(git.status(workspace.id)).rejects.toMatchObject({ code: 'UNSAFE_WORKTREE' });
  });

  it('refuses nested ref, reflog, and object-shard aliases before a Git mutation can use them', async () => {
    const { workspace } = await branch();
    for (const relative of ['refs/heads', 'logs/refs/heads']) {
      const original = path.join(source.path, '.git', relative);
      const outside = path.join(directory, relative.replaceAll('/', '-'));
      await fs.rename(original, outside);
      await fs.symlink(outside, original);
      const before = await fs.readdir(outside);
      await expect(git.branch(workspace.id, 'must-not-write-external', true)).rejects.toMatchObject({ code: 'UNSAFE_WORKTREE' });
      expect(await fs.readdir(outside)).toEqual(before);
      await fs.unlink(original);
      await fs.rename(outside, original);
    }
    const objects = path.join(source.path, '.git', 'objects');
    const shard = (await fs.readdir(objects)).find(name => /^[a-f0-9]{2}$/.test(name))!;
    expect(shard).toBeTruthy();
    const outside = path.join(directory, 'foreign-objects');
    await fs.rename(path.join(objects, shard), outside);
    await fs.symlink(outside, path.join(objects, shard));
    await expect(git.stage(workspace.id, ['notes.txt'])).rejects.toMatchObject({ code: 'UNSAFE_WORKTREE' });
  });

  it.each(['tracked', 'staged', 'untracked', 'ignored'] as const)('refuses removal of %s files and leaves their exact bytes intact', async kind => {
    const { workspace, worktree } = await branch();
    const name = kind === 'ignored' ? 'ignored.txt' : kind === 'untracked' ? 'new.txt' : 'notes.txt';
    const text = `valuable ${kind} work\n`;
    await fs.writeFile(path.join(workspace.path, name), text);
    if (kind === 'staged') await git.stage(workspace.id, [name]);
    await expect(worktrees.remove(source.id, worktree.id)).rejects.toMatchObject({ status: 409, code: 'WORKTREE_DIRTY' });
    expect(await fs.readFile(path.join(workspace.path, name), 'utf8')).toBe(text);
    expect((await ctx.workspaces.get(workspace.id)).id).toBe(workspace.id);
  });

  it('refuses locked worktrees and index flags which can hide modified files from Git status', async () => {
    const { workspace, worktree } = await branch();
    await command(source.path, 'worktree', 'lock', workspace.path);
    await expect(worktrees.remove(source.id, worktree.id)).rejects.toMatchObject({ code: 'WORKTREE_LOCKED' });
    await command(source.path, 'worktree', 'unlock', workspace.path);
    for (const flag of ['assume-unchanged', 'skip-worktree']) {
      await command(workspace.path, 'update-index', `--${flag}`, 'notes.txt');
      await fs.writeFile(path.join(workspace.path, 'notes.txt'), `hidden ${flag} edit\n`);
      await expect(worktrees.remove(source.id, worktree.id)).rejects.toMatchObject({ code: 'WORKTREE_INDEX_FLAGS' });
      expect(await fs.readFile(path.join(workspace.path, 'notes.txt'), 'utf8')).toBe(`hidden ${flag} edit\n`);
      await command(workspace.path, 'update-index', `--no-${flag}`, 'notes.txt');
    }
  });

  it('does not let repository stat or case settings hide changed bytes or additional files during removal', async () => {
    const { workspace, worktree } = await branch();
    const file = path.join(workspace.path, 'notes.txt');
    const oldTime = new Date(Math.floor(Date.now() / 1000 - 120) * 1000);
    await command(workspace.path, 'config', 'core.trustctime', 'false');
    await command(workspace.path, 'config', 'core.checkStat', 'minimal');
    await fs.utimes(file, oldTime, oldTime);
    await command(workspace.path, 'update-index', '--refresh');
    const changed = 'updated content!\n';
    expect(Buffer.byteLength(changed)).toBe(Buffer.byteLength('committed source\n'));
    await fs.writeFile(file, changed);
    await fs.utimes(file, oldTime, oldTime);
    expect(await command(workspace.path, 'status', '--porcelain=v1', '--untracked-files=all')).toBe('');
    const index = path.join(workspace.worktree!.gitDirectory, 'index');
    const originalIndex = await fs.readFile(index);
    await expect(worktrees.remove(source.id, worktree.id)).rejects.toMatchObject({ code: 'WORKTREE_DIRTY' });
    expect(await fs.readFile(file, 'utf8')).toBe(changed);
    expect(await fs.readFile(index)).toEqual(originalIndex);
    expect((await readWorktreeRecord(ctx, worktree.id))!.phase).toBe('ready');
    expect((await fs.readdir(ctx.config.runtimeDir)).some(name => name.startsWith('worktree-inspect-'))).toBe(false);
    await fs.writeFile(file, 'committed source\n');
    await command(workspace.path, 'config', 'core.ignoreCase', 'true');
    await fs.writeFile(path.join(workspace.path, 'NOTES.TXT'), 'a different native file\n');
    await expect(worktrees.remove(source.id, worktree.id)).rejects.toMatchObject({ code: 'WORKTREE_DIRTY' });
    expect(await fs.readFile(path.join(workspace.path, 'NOTES.TXT'), 'utf8')).toBe('a different native file\n');
  });

  it('uses native text normalization when proving a CRLF checkout clean for removal', async () => {
    await fs.writeFile(path.join(source.path, '.gitattributes'), '*.txt text eol=crlf\n');
    await command(source.path, 'add', '.gitattributes');
    await command(source.path, 'commit', '-m', 'Explicit line endings');
    const { workspace, worktree } = await branch();
    expect(await fs.readFile(path.join(workspace.path, 'notes.txt'), 'utf8')).toBe('committed source\r\n');
    expect((await gitModule.runGit(workspace.path, ['show', 'HEAD:notes.txt'])).stdout.toString('utf8')).toBe('committed source\n');
    expect(await worktrees.remove(source.id, worktree.id)).toEqual({ removed: true, workspaceId: workspace.id });
    expect((await fs.readdir(ctx.config.runtimeDir)).some(name => name.startsWith('worktree-inspect-'))).toBe(false);
  });

  it('refuses submodule removal without running nested repository filters', async () => {
    const { workspace, worktree } = await branch();
    const nested = path.join(workspace.path, 'nested');
    await fs.mkdir(nested);
    await command(nested, 'init', '--initial-branch=main');
    await fs.writeFile(path.join(nested, 'notes.txt'), 'nested work\n');
    await fs.writeFile(path.join(nested, '.gitattributes'), '*.txt filter=nestedfixture\n');
    await command(nested, 'add', '--all');
    await command(nested, 'commit', '-m', 'Nested fixture');
    const commit = await command(nested, 'rev-parse', 'HEAD');
    await command(workspace.path, 'update-index', '--add', '--cacheinfo', `160000,${commit},nested`);
    await command(workspace.path, 'commit', '-m', 'Record nested checkout');
    const marker = path.join(directory, 'nested-filter-ran');
    await command(nested, 'config', 'filter.nestedfixture.clean', `sh -c 'printf ran > ${marker}; cat'`);
    await fs.writeFile(path.join(nested, 'notes.txt'), 'valuable nested changes\n');
    await expect(worktrees.remove(source.id, worktree.id)).rejects.toMatchObject({ code: 'WORKTREE_SUBMODULES' });
    await expect(fs.lstat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(nested, 'notes.txt'), 'utf8')).toBe('valuable nested changes\n');
  });

  it('preserves detached commits until they have a named reference, then removes only the clean checkout', async () => {
    const { workspace, worktree } = await worktrees.create(source.id, {});
    await fs.writeFile(path.join(workspace.path, 'notes.txt'), 'detached committed work\n');
    await git.stage(workspace.id, ['notes.txt']);
    const { commit } = await git.commit(workspace.id, 'Detached work');
    await expect(worktrees.remove(source.id, worktree.id)).rejects.toMatchObject({ code: 'WORKTREE_UNSAVED_COMMITS' });
    await command(workspace.path, 'branch', 'saved-detached-work', 'HEAD');
    expect(await worktrees.remove(source.id, worktree.id)).toEqual({ removed: true, workspaceId: workspace.id });
    await expect(fs.lstat(workspace.path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await command(source.path, 'rev-parse', 'saved-detached-work')).toBe(commit);
    expect(await command(source.path, 'show', 'saved-detached-work:notes.txt')).toBe('detached committed work');
    expect(await worktrees.list(source.id)).toEqual([]);
  });

  it('archives dirty checkouts and restores the same workspace, conversation binding, name, and account after restart', async () => {
    const { workspace, worktree } = await branch();
    await ctx.workspaces.update(workspace.id, { name: 'My linked task', githubAccountId: 'account-after-create' });
    await fs.writeFile(path.join(workspace.path, 'new.txt'), 'untracked work must survive\n');
    await ctx.store.write('thread-worktree-fixture', { id: 'worktree-fixture', workspaceId: workspace.id, messages: [{ content: 'Saved conversation' }] });
    expect((await worktrees.archive(source.id, worktree.id)).state).toBe('archived');
    await expect(ctx.workspaces.get(workspace.id)).rejects.toMatchObject({ status: 404 });
    expect(await fs.readFile(path.join(workspace.path, 'new.txt'), 'utf8')).toBe('untracked work must survive\n');
    const fresh = context(directory);
    const restarted = new WorktreeService(fresh);
    expect(await restarted.list(source.id)).toEqual([expect.objectContaining({ id: worktree.id, name: 'My linked task', state: 'archived', dirty: true })]);
    const reopened = await restarted.open(source.id, worktree.id);
    expect(reopened).toMatchObject({ id: workspace.id, name: 'My linked task', githubAccountId: 'account-after-create', path: workspace.path });
    expect((await fresh.store.read<{ workspaceId: string }>('thread-worktree-fixture', { workspaceId: '' })).workspaceId).toBe(reopened.id);
    expect((await new GitService(fresh).status(reopened.id)).files).toContainEqual({ path: 'new.txt', status: '?', staged: false });
  });

  it('does not implicitly reopen an active checkout archived during its native Git validation', async () => {
    const { workspace, worktree } = await branch();
    const run = gitModule.runGit;
    let archived = false;
    vi.spyOn(gitModule, 'runGit').mockImplementation(async (cwd, args, options) => {
      if (!archived && cwd === workspace.path && args.includes('--show-toplevel')) {
        archived = true;
        await ctx.workspaces.remove(workspace.id);
      }
      return run(cwd, args, options);
    });
    await expect(worktrees.open(source.id, worktree.id)).rejects.toMatchObject({ code: 'WORKSPACE_ARCHIVED' });
    await expect(ctx.workspaces.get(workspace.id)).rejects.toMatchObject({ code: 'WORKSPACE_NOT_FOUND' });
    expect((await fs.readdir(ctx.config.stateDir)).some(name => name.startsWith(`workspace-restored-${workspace.id}-`))).toBe(false);
    expect(await fs.readFile(path.join(workspace.path, 'notes.txt'), 'utf8')).toBe('committed source\n');
  });

  it('keeps a child worktree usable when its originating worktree is removed or the primary registration is archived', async () => {
    const first = await branch('first-origin');
    const second = await worktrees.create(first.workspace.id, { branch: 'second-task', createBranch: true });
    expect(second.workspace.worktree).toMatchObject({ sourceWorkspaceId: first.workspace.id, repositoryWorkspaceId: source.id });
    await worktrees.archive(source.id, second.worktree.id);
    await worktrees.remove(source.id, first.worktree.id);
    expect((await worktrees.open(source.id, second.worktree.id)).id).toBe(second.workspace.id);
    await ctx.workspaces.remove(source.id);
    expect((await git.status(second.workspace.id)).branch).toBe('second-task');
    expect((await worktrees.list(second.workspace.id))[0].id).toBe(second.worktree.id);
  });

  it('can list and explicitly reopen the last archived checkout using the retained source identity', async () => {
    const { workspace, worktree } = await branch();
    await worktrees.archive(source.id, worktree.id);
    await ctx.workspaces.remove(source.id);
    expect((await worktrees.list(source.id))[0].state).toBe('archived');
    expect((await worktrees.open(source.id, worktree.id)).id).toBe(workspace.id);
    await expect(worktrees.create(source.id, {})).rejects.toMatchObject({ code: 'WORKSPACE_NOT_FOUND' });
  });

  it('refuses current/active workspaces and leased native activity, then fences new work through removal', async () => {
    const { workspace, worktree } = await branch();
    await expect(worktrees.remove(workspace.id, worktree.id)).rejects.toMatchObject({ code: 'WORKTREE_ACTIVE' });
    await ctx.workspaces.update(workspace.id, { active: true });
    await expect(worktrees.remove(source.id, worktree.id)).rejects.toMatchObject({ code: 'WORKTREE_ACTIVE' });
    await ctx.workspaces.update(source.id, { active: true });
    const release = acquireWorkspaceActivity(ctx.config.workspacesDir, workspace.id, 'terminal');
    await expect(worktrees.remove(source.id, worktree.id)).rejects.toMatchObject({ code: 'WORKTREE_BUSY' });
    release();
    const original = ctx.store.write.bind(ctx.store);
    let blocked = false;
    vi.spyOn(ctx.store, 'write').mockImplementation(async (key, value) => {
      if (key === worktreeRecordKey(worktree.id) && (value as WorktreeRecord).phase === 'removing') {
        expect(() => acquireWorkspaceActivity(ctx.config.workspacesDir, workspace.id, 'agent')).toThrowError(expect.objectContaining({ code: 'WORKTREE_BUSY' }));
        await expect(ctx.workspaces.writeFile(workspace.id, 'notes.txt', 'too late\n')).rejects.toMatchObject({ code: 'WORKTREE_BUSY' });
        blocked = true;
      }
      return original(key, value);
    });
    await worktrees.remove(source.id, worktree.id);
    expect(blocked).toBe(true);
  });

  it('retains independent concurrent registrations across separate stores and a service restart', async () => {
    const other = context(directory);
    const peer = new WorktreeService(other);
    const created = await Promise.all(Array.from({ length: 6 }, (_, index) => (index % 2 ? worktrees : peer).create(source.id, { branch: `parallel/${index}`, createBranch: true })));
    expect(new Set(created.map(item => item.workspace.id)).size).toBe(6);
    const fresh = context(directory);
    const listed = await new WorktreeService(fresh).list(source.id);
    expect(listed.map(item => item.id).sort()).toEqual(created.map(item => item.worktree.id).sort());
    expect(listed.every(item => item.state === 'ready' && !item.dirty)).toBe(true);
    for (const { workspace } of created) expect((await fresh.workspaces.get(workspace.id)).worktree?.commonDirectory).toBe(path.join(source.path, '.git'));
  });

  it('rolls back a clean checkout if registration fails, retaining the explicit new branch', async () => {
    const count = (await ctx.workspaces.list()).length;
    vi.spyOn(ctx.workspaces, 'registerWorktree').mockRejectedValueOnce(new Error('Fixture registration failure'));
    await expect(branch('kept-new-branch')).rejects.toThrow('Fixture registration failure');
    expect((await ctx.workspaces.list()).length).toBe(count);
    expect(await worktrees.list(source.id)).toEqual([]);
    expect(await command(source.path, 'branch', '--list', 'kept-new-branch')).toBe('kept-new-branch');
    expect((await command(source.path, 'worktree', 'list', '--porcelain')).split('\n').filter(line => line.startsWith('worktree '))).toEqual([`worktree ${source.path}`]);
  });

  it('preserves a file that appears during checkout, retains the failed worktree journal, and reopens without resetting it', async () => {
    const run = gitModule.runGit;
    let checkout = '';
    vi.spyOn(gitModule, 'runGit').mockImplementation(async (cwd, args, options) => {
      if (args.includes('checkout-index') && !checkout) {
        checkout = cwd;
        await fs.writeFile(path.join(cwd, 'notes.txt'), 'concurrent user content\n');
      }
      return run(cwd, args, options);
    });
    await expect(branch()).rejects.toMatchObject({ code: 'GIT_FAILED' });
    expect(await fs.readFile(path.join(checkout, 'notes.txt'), 'utf8')).toBe('concurrent user content\n');
    expect((await ctx.workspaces.list()).some(workspace => workspace.path === checkout)).toBe(false);
    const [recovery] = await worktrees.list(source.id);
    expect(recovery).toMatchObject({ path: checkout, state: 'recovery', dirty: true });
    const opened = await worktrees.open(source.id, recovery.id);
    expect(opened.path).toBe(checkout);
    expect(await fs.readFile(path.join(checkout, 'notes.txt'), 'utf8')).toBe('concurrent user content\n');
  });

  it('recovers an interrupted creation journal without automatically registering or deleting its checkout', async () => {
    const { workspace, worktree } = await branch();
    await fs.writeFile(path.join(workspace.path, 'recovery.txt'), 'preserve interrupted work\n');
    const record = (await readWorktreeRecord(ctx, worktree.id))!;
    await ctx.store.delete(`workspace-record-${workspace.id}`);
    await ctx.store.write(worktreeRecordKey(record.id), { ...record, phase: 'creating', gitDirectory: undefined });
    const fresh = context(directory);
    const recovered = new WorktreeService(fresh);
    await recovered.initialize();
    expect((await recovered.list(source.id))[0]).toMatchObject({ id: worktree.id, state: 'recovery', dirty: true });
    await expect(fresh.workspaces.get(workspace.id)).rejects.toMatchObject({ code: 'WORKSPACE_NOT_FOUND' });
    const opened = await recovered.open(source.id, worktree.id);
    expect(opened.id).toBe(workspace.id);
    expect(await fs.readFile(path.join(opened.path, 'recovery.txt'), 'utf8')).toBe('preserve interrupted work\n');
  });

  it('finishes registration archival after a crash between native removal and the final journal write', async () => {
    const { workspace, worktree } = await branch();
    const write = ctx.store.write.bind(ctx.store);
    vi.spyOn(ctx.store, 'write').mockImplementation(async (key, value) => {
      if (key === worktreeRecordKey(worktree.id) && (value as WorktreeRecord).phase === 'removed') throw new Error('Fixture interrupted final removal write');
      return write(key, value);
    });
    await expect(worktrees.remove(source.id, worktree.id)).rejects.toThrow('Fixture interrupted final removal write');
    await expect(fs.lstat(workspace.path)).rejects.toMatchObject({ code: 'ENOENT' });
    const fresh = context(directory);
    const recovered = new WorktreeService(fresh);
    await recovered.initialize();
    await expect(fresh.workspaces.get(workspace.id)).rejects.toMatchObject({ code: 'WORKSPACE_NOT_FOUND' });
    expect(await recovered.list(source.id)).toEqual([]);
    expect((await readWorktreeRecord(fresh, worktree.id))!.phase).toBe('removed');
    expect(await command(source.path, 'show', 'feature/worktree:notes.txt')).toBe('committed source');
  });

  it('retains removal intent when a command fails after its native filesystem deletion', async () => {
    const { workspace, worktree } = await branch();
    const run = gitModule.runGit;
    vi.spyOn(gitModule, 'runGit').mockImplementation(async (cwd, args, options) => {
      const result = await run(cwd, args, options);
      if (args.includes('worktree') && args.includes('remove')) throw new HttpError(503, 'Fixture lost the result after native removal.', 'GIT_INTERRUPTED');
      return result;
    });
    await expect(worktrees.remove(source.id, worktree.id)).rejects.toMatchObject({ code: 'GIT_INTERRUPTED' });
    expect((await readWorktreeRecord(ctx, worktree.id))!.phase).toBe('removing');
    await expect(fs.lstat(workspace.path)).rejects.toMatchObject({ code: 'ENOENT' });
    const fresh = context(directory);
    await new WorktreeService(fresh).initialize();
    await expect(fresh.workspaces.get(workspace.id)).rejects.toMatchObject({ code: 'WORKSPACE_NOT_FOUND' });
    expect((await readWorktreeRecord(fresh, worktree.id))!.phase).toBe('removed');
  });

  it('does not revive a removed registration after stale metadata recovery or explicit directory recreation', async () => {
    const { workspace, worktree } = await branch();
    await fs.chmod(workspace.path, 0o700);
    await fs.chmod(workspace.worktree!.gitDirectory, 0o700);
    const oldMetadata = new FileMetadataManager(ctx.config, ctx.store);
    await oldMetadata.initialize();
    const record = (await readWorktreeRecord(ctx, worktree.id))!;
    await ctx.store.write(worktreeRecordKey(worktree.id), { ...record, phase: 'removing' });
    await command(source.path, 'worktree', 'remove', '--', workspace.path);
    await expect(fs.lstat(workspace.path)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.lstat(workspace.worktree!.gitDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    // Abrupt termination skips oldMetadata.close(), leaving its saved manifest.
    const fresh = context(directory);
    const restoredMetadata = new FileMetadataManager(fresh.config, fresh.store);
    await restoredMetadata.initialize();
    // Metadata cannot restore missing file bytes, so it must not recreate this
    // deleted checkout or its Git links as though it were a usable workspace.
    await expect(fs.lstat(workspace.path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(restoredMetadata.status().issues).toContainEqual({ root: 'workspaces', path: workspace.id, reason: 'missing-file' });
    await expect(fs.lstat(path.join(workspace.worktree!.gitDirectory, 'gitdir'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await command(source.path, 'worktree', 'list', '--porcelain')).not.toContain(`worktree ${workspace.path}`);
    // A different stale native-state producer can still recreate residual
    // directories. Construct that adversarial, fixture-owned state explicitly;
    // worktree recovery must retain its bytes without reviving registration.
    await fs.mkdir(workspace.path, { mode: 0o700 });
    await fs.mkdir(workspace.worktree!.gitDirectory, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(workspace.path, 'residual-user.txt'), 'retain every residual file\n');
    const recovered = new WorktreeService(fresh);
    await recovered.initialize();
    await expect(fresh.workspaces.get(workspace.id)).rejects.toMatchObject({ code: 'WORKSPACE_NOT_FOUND' });
    expect((await readWorktreeRecord(fresh, worktree.id))!.phase).toBe('recovery');
    expect((await recovered.list(source.id))[0]).toMatchObject({ id: worktree.id, state: 'missing' });
    expect(await fs.readFile(path.join(workspace.path, 'residual-user.txt'), 'utf8')).toBe('retain every residual file\n');
    expect(await command(source.path, 'show', 'feature/worktree:notes.txt')).toBe('committed source');
    await restoredMetadata.close();
  });

  it('aborts and drains an actual Git command before shutdown resolves, retaining partial creation for recovery', async () => {
    const run = gitModule.runGit;
    let checkout = '';
    vi.spyOn(gitModule, 'runGit').mockImplementation((cwd, args, options) => {
      if (args.includes('checkout-index') && !checkout) {
        checkout = cwd;
        return run(cwd, ['-c', 'alias.worktreewait=!printf %s $$ > interrupted-pid.txt; sleep 30', 'worktreewait'], options);
      }
      return run(cwd, args, options);
    });
    const creating = branch('shutdown-task').then(value => ({ value }), error => ({ error }));
    const deadline = Date.now() + 5000;
    while (!checkout || !await fs.lstat(path.join(checkout, 'interrupted-pid.txt')).then(() => true, () => false)) {
      if (Date.now() >= deadline) throw new Error('The native Git fixture did not start.');
      await delay(5);
    }
    const pid = Number(await fs.readFile(path.join(checkout, 'interrupted-pid.txt'), 'utf8'));
    await worktrees.close();
    expect(await creating).toMatchObject({ error: { code: 'GIT_INTERRUPTED' } });
    expect(() => process.kill(pid, 0)).toThrow();
    await expect(worktrees.list(source.id)).rejects.toMatchObject({ code: 'WORKTREES_CLOSING' });
    expect((await ctx.workspaces.list()).some(workspace => workspace.path === checkout)).toBe(false);
    const [record] = await new WorktreeService(context(directory)).list(source.id);
    expect(record).toMatchObject({ path: checkout, state: 'recovery' });
    expect(await fs.readFile(path.join(checkout, 'interrupted-pid.txt'), 'utf8')).toBe(String(pid));
  });

  it('disables source and destination-only filters, checkout hooks, inherited selectors, and global Git settings', async () => {
    const marker = path.join(directory, 'helper-ran');
    const hook = path.join(source.path, '.git', 'hooks', 'post-checkout');
    await fs.mkdir(path.dirname(hook), { recursive: true });
    await fs.writeFile(hook, `#!/bin/sh\nprintf ran > '${marker}'\n`, { mode: 0o755 });
    await fs.writeFile(path.join(source.path, '.gitattributes'), '*.txt filter=fixture\n');
    await command(source.path, 'add', '.gitattributes');
    await command(source.path, 'commit', '-m', 'Attribute fixture');
    await command(source.path, 'config', 'filter.fixture.clean', `sh -c 'printf ran > ${marker}; cat'`);
    await command(source.path, 'config', 'filter.fixture.smudge', `sh -c 'printf ran > ${marker}; cat'`);
    await command(source.path, 'config', 'filter.fixture.required', 'true');
    const conditional = path.join(directory, 'destination-filter-config');
    await fs.writeFile(conditional, `[filter "fixture"]\n process = sh -c 'printf ran > ${marker}; exit 1'\n required = true\n`);
    await command(source.path, 'config', `includeIf.gitdir:${source.path}/.git/worktrees/.path`, conditional);
    const global = path.join(directory, 'global-config');
    await fs.writeFile(global, `[core]\n hooksPath = ${path.dirname(hook)}\n[filter "fixture"]\n process = sh -c 'printf ran > ${marker}; exit 1'\n`);
    vi.stubEnv('GIT_CONFIG_GLOBAL', global);
    vi.stubEnv('GIT_DIR', path.join(directory, 'not-a-repository'));
    vi.stubEnv('GIT_WORK_TREE', directory);
    vi.stubEnv('GIT_CONFIG_COUNT', '1');
    vi.stubEnv('GIT_CONFIG_KEY_0', 'core.worktree');
    vi.stubEnv('GIT_CONFIG_VALUE_0', directory);
    const { workspace } = await branch();
    expect(await fs.readFile(path.join(workspace.path, 'notes.txt'), 'utf8')).toBe('committed source\n');
    await fs.writeFile(path.join(workspace.path, 'notes.txt'), 'stage without clean helper\n');
    await git.stage(workspace.id, ['notes.txt']);
    await git.commit(workspace.id, 'No repository helper execution');
    await expect(fs.lstat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(source.path, 'notes.txt'), 'utf8')).toBe('committed source\n');
  });

  it('fences Git changes during an exclusive removal operation', async () => {
    const { workspace } = await branch();
    await fs.writeFile(path.join(workspace.path, 'notes.txt'), 'saved later\n');
    await withWorkspaceRemoval(ctx.config.workspacesDir, workspace.id, async () => {
      await expect(git.stage(workspace.id, ['notes.txt'])).rejects.toMatchObject({ code: 'WORKTREE_BUSY' });
    });
    await git.stage(workspace.id, ['notes.txt']);
    expect((await git.status(workspace.id)).files).toContainEqual({ path: 'notes.txt', status: 'M', staged: true });
  });

  it('blocks a repository-selected remote helper even when its protocol is explicitly enabled', async () => {
    const { workspace } = await branch();
    const marker = path.join(directory, 'remote-helper-ran');
    const bin = path.join(directory, 'bin');
    await fs.mkdir(bin);
    await fs.writeFile(path.join(bin, 'git-remote-worktreefixture'), `#!/bin/sh\nprintf ran > '${marker}'\nexit 1\n`, { mode: 0o755 });
    await command(source.path, 'remote', 'add', 'origin', 'https://github.com/fixture-owner/fixture-repository.git');
    await command(source.path, 'config', 'remote.origin.vcs', 'worktreefixture');
    await command(source.path, 'config', 'protocol.worktreefixture.allow', 'always');
    vi.stubEnv('PATH', `${bin}:${process.env.PATH}`);
    await expect(git.network(workspace.id, 'fetch', 'selected-account')).rejects.toMatchObject({ code: 'UNSAFE_GIT_HELPER' });
    await expect(gitModule.runGit(workspace.path, ['fetch', 'origin'], {
      env: { CW_GITHUB_TOKEN: 'synthetic_fixture_token_not_real', PATH: process.env.PATH },
    })).rejects.toMatchObject({ code: 'GIT_FAILED' });
    await expect(fs.lstat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
