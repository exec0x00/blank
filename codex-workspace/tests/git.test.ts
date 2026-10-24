import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readlink, rename, rm, symlink, writeFile, chmod, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { GitService, runGit } from '../server/git';
import { loadConfig } from '../server/config';
import { JsonStore, SecretStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import type { AppContext } from '../server/context';
import type { AppSettings, Workspace } from '../shared/types';

const execute = promisify(execFile);
let root: string;
let workspace: Workspace;
let ctx: AppContext;
let git: GitService;

async function command(cwd: string, ...args: string[]): Promise<string> {
  const result = await execute('git', ['-c', 'user.name=Integration Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', ...args], {
    cwd, timeout: 15_000, maxBuffer: 4 * 1024 * 1024,
    env: { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
  });
  return result.stdout.trim();
}

async function trackedFile(name = 'notes.txt', content = 'first version\n'): Promise<void> {
  await git.init(workspace.id);
  await writeFile(path.join(workspace.path, name), content);
  await git.stage(workspace.id, [name]);
  await git.commit(workspace.id, 'Initial work');
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'codex-git-test-'));
  const config = loadConfig({ DATA_DIR: root, WORKSPACE_PASSWORD: 'test-workspace-password', SESSION_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });
  const store = new JsonStore(config.stateDir);
  const workspaces = new WorkspaceService(config, store);
  const settings: AppSettings = { model: 'test', reasoningEffort: 'high', autoApprove: false, theme: 'dark', fontSize: 13, wordWrap: true, provider: 'openai', apiKeyConfigured: false };
  ctx = {
    config, store, workspaces, secrets: new SecretStore(store, config.encryptionKey), events: new EventEmitter(),
    settings: async () => settings,
    saveSettings: async patch => Object.assign(settings, patch),
    providerKey: async () => undefined,
  };
  workspace = await workspaces.create({ name: 'Git integration' });
  git = new GitService(ctx);
});

afterEach(async () => {
  await ctx?.store.flush();
  if (root) await rm(root, { recursive: true, force: true });
});

describe('Git integration', () => {
  it('serves compact status and real bounded pages, including unchanged account-independent revision guards', async () => {
    expect(await git.summary(workspace.id)).toMatchObject({ isRepository: false, changedFileCount: 0 });
    await git.init(workspace.id, true);
    for (let start = 0; start < 121; start += 12) {
      await Promise.all(Array.from({ length: Math.min(12, 121 - start) }, (_, index) => writeFile(path.join(workspace.path, `page-${String(start + index).padStart(3, '0')}.txt`), 'saved\n')));
    }
    const summary = await git.summary(workspace.id);
    expect(summary).toMatchObject({ isRepository: true, changedFileCount: 121, changesCount: 121, stagedCount: 0 });
    expect(summary).not.toHaveProperty('files');
    expect(summary).not.toHaveProperty('branches');
    const first = await git.changesPage(workspace.id, { staged: 'false', limit: '40' });
    expect(first.files).toHaveLength(40);
    expect(first).toMatchObject({ offset: 0, total: 121, revision: summary.revision });
    const second = await git.changesPage(workspace.id, { staged: 'false', limit: '40', cursor: first.nextCursor });
    expect(second.files).toHaveLength(40);
    expect(second.files[0].path).toBe('page-040.txt');
    expect((await git.changesPage(workspace.id, { staged: 'false', limit: '40', cursor: second.previousCursor })).files).toEqual(first.files);
    const filtered = await git.changesPage(workspace.id, { staged: 'false', limit: '40', query: 'page-12' });
    expect(filtered.files.map(file => file.path)).toEqual(['page-120.txt']);
    await writeFile(path.join(workspace.path, 'newer.txt'), 'new\n');
    await expect(git.changesPage(workspace.id, { staged: 'false', limit: '40', cursor: first.nextCursor })).rejects.toMatchObject({ code: 'GIT_LIST_CHANGED' });
  });

  it('stages and unstages all real changes without requesting an all-files client list', async () => {
    await git.init(workspace.id, true);
    await mkdir(path.join(workspace.path, 'nested'));
    await writeFile(path.join(workspace.path, 'nested', 'a.txt'), 'alpha\n');
    await writeFile(path.join(workspace.path, 'b.txt'), 'beta\n');
    expect(await git.stageAll(workspace.id, true)).toMatchObject({ stagedCount: 2, changesCount: 0 });
    expect(await git.stageAll(workspace.id, false)).toMatchObject({ stagedCount: 0, changesCount: 2 });
    await git.stageAll(workspace.id, true);
    await git.commit(workspace.id, 'Initial batch');
    await writeFile(path.join(workspace.path, 'b.txt'), 'updated\n');
    expect(await git.stageAll(workspace.id, true)).toMatchObject({ stagedCount: 1, changesCount: 0 });
    expect(await git.stageAll(workspace.id, false)).toMatchObject({ stagedCount: 0, changesCount: 1 });
    expect(await readFile(path.join(workspace.path, 'b.txt'), 'utf8')).toBe('updated\n');
  });

  it('streams refs through the bounded runner and pages server-side branch search', async () => {
    await trackedFile();
    await command(workspace.path, 'branch', 'feature/one');
    await command(workspace.path, 'branch', 'feature/two');
    await command(workspace.path, 'branch', 'other');
    const page = await git.branchesPage(workspace.id, { query: 'feature/', limit: '1' });
    expect(page).toMatchObject({ branches: ['feature/one'], total: 2 });
    const next = await git.branchesPage(workspace.id, { query: 'feature/', limit: '1', cursor: page.nextCursor });
    expect(next).toMatchObject({ branches: ['feature/two'], total: 2 });
    const chunks: string[] = [];
    const streamed = await runGit(workspace.path, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], { onStdout: chunk => chunks.push(chunk.toString('utf8')) });
    expect(streamed.stdout.length).toBe(0);
    expect(chunks.join('')).toContain('feature/two');
  });

  it('initializes, previews, stages, unstages an unborn index, and creates a real commit', async () => {
    expect(await git.status(workspace.id)).toMatchObject({ isRepository: false, files: [] });
    expect(await git.init(workspace.id)).toMatchObject({ isRepository: true, branch: 'main', branches: ['main'] });
    await writeFile(path.join(workspace.path, 'notes.txt'), 'first version\n');
    expect((await git.status(workspace.id)).files).toEqual([{ path: 'notes.txt', status: '?', staged: false }]);
    expect(await git.diff(workspace.id, 'notes.txt', false)).toMatchObject({ original: '', modified: 'first version\n' });
    expect((await git.diff(workspace.id, 'notes.txt', false)).patch).toContain('+first version');
    await git.stage(workspace.id, ['notes.txt']);
    expect((await git.status(workspace.id)).files).toEqual([{ path: 'notes.txt', status: 'A', staged: true }]);
    await writeFile(path.join(workspace.path, 'notes.txt'), 'second version\n');
    expect(await git.diff(workspace.id, 'notes.txt', true)).toMatchObject({ original: '', modified: 'first version\n' });
    expect(await git.diff(workspace.id, 'notes.txt', false)).toMatchObject({ original: 'first version\n', modified: 'second version\n' });
    await git.unstage(workspace.id, ['notes.txt']);
    expect(await readFile(path.join(workspace.path, 'notes.txt'), 'utf8')).toBe('second version\n');
    expect((await git.status(workspace.id)).files).toEqual([{ path: 'notes.txt', status: '?', staged: false }]);
    await git.stage(workspace.id, ['notes.txt']);
    const result = await git.commit(workspace.id, 'Save the first note\n\nWith a useful description.');
    expect(result.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(await command(workspace.path, 'show', 'HEAD:notes.txt')).toBe('second version');
    expect((await git.status(workspace.id)).files).toHaveLength(0);
    expect(await command(workspace.path, 'log', '-1', '--format=%B')).toContain('With a useful description.');
  });

  it('treats filenames as literal argv paths, including glob syntax and leading hyphens', async () => {
    await git.init(workspace.id);
    const names = ['[draft]*.txt', 'draft1.txt', '-option.txt', 'file with spaces.md', "quote'file.txt", '$(not-a-command).txt'];
    for (const name of names) await writeFile(path.join(workspace.path, name), `content: ${name}\n`);
    await git.stage(workspace.id, ['[draft]*.txt', '-option.txt', '$(not-a-command).txt']);
    const status = await git.status(workspace.id);
    expect(status.files.filter(file => file.staged).map(file => file.path).sort()).toEqual(['[draft]*.txt', '-option.txt', '$(not-a-command).txt'].sort());
    expect(status.files.find(file => file.path === 'draft1.txt')?.staged).toBe(false);
    await git.stage(workspace.id, ['file with spaces.md', "quote'file.txt", 'draft1.txt']);
    await git.commit(workspace.id, 'Handle literal filenames');
    expect((await git.status(workspace.id)).files).toEqual([]);
  });

  it('keeps a renamed file and both sides of its index entry when unstaging', async () => {
    await trackedFile('old name.txt', 'a complete line\n');
    await rename(path.join(workspace.path, 'old name.txt'), path.join(workspace.path, 'new name.txt'));
    await git.stage(workspace.id, ['old name.txt', 'new name.txt']);
    expect((await git.status(workspace.id)).files).toEqual([{ path: 'new name.txt', status: 'R', staged: true, originalPath: 'old name.txt' }]);
    expect(await git.diff(workspace.id, 'new name.txt', true)).toMatchObject({ original: 'a complete line\n', modified: 'a complete line\n' });
    await git.unstage(workspace.id, ['new name.txt']);
    expect((await git.status(workspace.id)).files).toEqual(expect.arrayContaining([
      { path: 'old name.txt', status: 'D', staged: false },
      { path: 'new name.txt', status: '?', staged: false },
    ]));
    expect(await readFile(path.join(workspace.path, 'new name.txt'), 'utf8')).toBe('a complete line\n');
    await expect(readFile(path.join(workspace.path, 'old name.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('discards only working edits, preserves the index, and restores tracked and untracked bytes', async () => {
    await trackedFile();
    await writeFile(path.join(workspace.path, 'notes.txt'), 'staged work\n');
    await git.stage(workspace.id, ['notes.txt']);
    await writeFile(path.join(workspace.path, 'notes.txt'), 'newer working edit\n');
    const image = Buffer.from([0, 1, 255, 12, 0, 84]);
    await writeFile(path.join(workspace.path, 'image.bin'), image);
    const events: string[] = [];
    ctx.events.on('workspace:changed', ({ workspaceId }) => events.push(workspaceId));
    const discarded = await git.discard(workspace.id, ['notes.txt', 'image.bin']);
    expect(discarded.count).toBe(2);
    expect(await readFile(path.join(workspace.path, 'notes.txt'), 'utf8')).toBe('staged work\n');
    expect(await command(workspace.path, 'show', ':notes.txt')).toBe('staged work');
    expect((await git.status(workspace.id)).files).toEqual([{ path: 'notes.txt', status: 'M', staged: true }]);
    await expect(readFile(path.join(workspace.path, 'image.bin'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await git.restoreDiscard(workspace.id, discarded.discardId)).toEqual({ restored: 2 });
    expect(await readFile(path.join(workspace.path, 'notes.txt'), 'utf8')).toBe('newer working edit\n');
    expect(await readFile(path.join(workspace.path, 'image.bin'))).toEqual(image);
    expect(await command(workspace.path, 'show', ':notes.txt')).toBe('staged work');
    expect(events).toEqual([workspace.id, workspace.id]);
    await expect(git.restoreDiscard(workspace.id, discarded.discardId)).rejects.toMatchObject({ status: 404 });
  });

  it('refuses to undo a discard across newer file edits', async () => {
    await trackedFile();
    await writeFile(path.join(workspace.path, 'notes.txt'), 'discard this\n');
    const { discardId } = await git.discard(workspace.id, ['notes.txt']);
    await writeFile(path.join(workspace.path, 'notes.txt'), 'valuable new work\n');
    await expect(git.restoreDiscard(workspace.id, discardId)).rejects.toMatchObject({ status: 409, code: 'RESTORE_CONFLICT' });
    expect(await readFile(path.join(workspace.path, 'notes.txt'), 'utf8')).toBe('valuable new work\n');
  });

  it('can recover an unstaged deletion and undo that recovery', async () => {
    await trackedFile();
    await rm(path.join(workspace.path, 'notes.txt'));
    const result = await git.discard(workspace.id, ['notes.txt']);
    expect(await readFile(path.join(workspace.path, 'notes.txt'), 'utf8')).toBe('first version\n');
    await git.restoreDiscard(workspace.id, result.discardId);
    await expect(readFile(path.join(workspace.path, 'notes.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await git.status(workspace.id)).files).toEqual([{ path: 'notes.txt', status: 'D', staged: false }]);
  });

  it('saves discard recovery before removing a file and refuses oversized backups', async () => {
    await git.init(workspace.id);
    await writeFile(path.join(workspace.path, 'local.txt'), 'keep this');
    const originalWrite = ctx.store.write.bind(ctx.store);
    ctx.store.write = async (key, value) => {
      if (key.startsWith('git-discard-')) throw new Error('Storage unavailable');
      return originalWrite(key, value);
    };
    await expect(git.discard(workspace.id, ['local.txt'])).rejects.toThrow('Storage unavailable');
    expect(await readFile(path.join(workspace.path, 'local.txt'), 'utf8')).toBe('keep this');
    ctx.store.write = originalWrite;
    const file = await open(path.join(workspace.path, 'large.bin'), 'w');
    await file.truncate(51 * 1024 * 1024);
    await file.close();
    await expect(git.discard(workspace.id, ['large.bin'])).rejects.toMatchObject({ status: 413, code: 'FILE_TOO_LARGE' });
  });

  it('identifies binary diffs without exposing corrupt text previews', async () => {
    await git.init(workspace.id);
    await writeFile(path.join(workspace.path, 'asset.bin'), Buffer.from([0, 129, 254, 33]));
    expect(await git.diff(workspace.id, 'asset.bin', false)).toMatchObject({ binary: true, original: '', modified: '' });
    await git.stage(workspace.id, ['asset.bin']);
    expect(await git.diff(workspace.id, 'asset.bin', true)).toMatchObject({ binary: true, original: '', modified: '' });
  });

  it('creates and switches branches while protecting work that a checkout would overwrite', async () => {
    await trackedFile();
    expect((await git.branch(workspace.id, 'feature/idea', true)).branch).toBe('feature/idea');
    await writeFile(path.join(workspace.path, 'notes.txt'), 'feature content\n');
    await git.stage(workspace.id, ['notes.txt']);
    await git.commit(workspace.id, 'Improve the idea');
    expect((await git.branch(workspace.id, 'main', false)).branch).toBe('main');
    await writeFile(path.join(workspace.path, 'notes.txt'), 'uncommitted user work\n');
    await expect(git.branch(workspace.id, 'feature/idea', false)).rejects.toMatchObject({ status: 409, code: 'GIT_LOCAL_CHANGES' });
    expect(await readFile(path.join(workspace.path, 'notes.txt'), 'utf8')).toBe('uncommitted user work\n');
    expect((await git.status(workspace.id)).branch).toBe('main');
    await expect(git.branch(workspace.id, '--orphan', true)).rejects.toMatchObject({ status: 400 });
    await expect(git.branch(workspace.id, 'bad branch', true)).rejects.toMatchObject({ status: 400 });
  });

  it('pushes, fetches, and fast-forwards a real remote while preserving unrelated local files', async () => {
    await trackedFile();
    const remote = path.join(root, 'remote.git');
    await command(root, 'init', '--bare', '--initial-branch=main', remote);
    await command(workspace.path, 'remote', 'add', 'origin', remote);
    const pushed = await git.network(workspace.id, 'push');
    expect(pushed).toMatchObject({ ahead: 0, behind: 0, remote });
    expect(await command(remote, 'rev-parse', 'main')).toBe(await command(workspace.path, 'rev-parse', 'HEAD'));

    const other = path.join(root, 'collaborator');
    await command(root, 'clone', remote, other);
    await writeFile(path.join(other, 'from-remote.txt'), 'remote work\n');
    await command(other, 'add', '--', 'from-remote.txt');
    await command(other, 'commit', '-m', 'Remote contribution');
    await command(other, 'push', 'origin', 'main');
    expect((await git.network(workspace.id, 'fetch')).behind).toBe(1);
    await writeFile(path.join(workspace.path, 'unrelated.txt'), 'unsaved user work\n');
    expect((await git.network(workspace.id, 'pull')).behind).toBe(0);
    expect(await readFile(path.join(workspace.path, 'from-remote.txt'), 'utf8')).toBe('remote work\n');
    expect(await readFile(path.join(workspace.path, 'unrelated.txt'), 'utf8')).toBe('unsaved user work\n');

    await git.stage(workspace.id, ['unrelated.txt']);
    await git.commit(workspace.id, 'Local contribution');
    const localHead = await command(workspace.path, 'rev-parse', 'HEAD');
    await writeFile(path.join(other, 'second-remote.txt'), 'another contribution\n');
    await command(other, 'add', '--', 'second-remote.txt');
    await command(other, 'commit', '-m', 'Another remote contribution');
    await command(other, 'push', 'origin', 'main');
    await expect(git.network(workspace.id, 'pull')).rejects.toMatchObject({ status: 409, code: 'GIT_DIVERGED' });
    expect(await command(workspace.path, 'rev-parse', 'HEAD')).toBe(localHead);
    await expect(git.network(workspace.id, 'push')).rejects.toMatchObject({ status: 409, code: 'GIT_PUSH_REJECTED' });
  }, 20_000);

  it('redacts configured credentials from status and refuses credential-bearing remotes before network access', async () => {
    await trackedFile();
    const exampleToken = 'ghp_TEST_TOKEN_WITH_NO_REAL_ACCESS_123456';
    await command(workspace.path, 'remote', 'add', 'origin', `https://${exampleToken}@github.com/example/repository.git`);
    const status = await git.status(workspace.id);
    expect(status.remote).toContain('[redacted]');
    expect(JSON.stringify(status)).not.toContain(exampleToken);
    await expect(git.network(workspace.id, 'push')).rejects.toMatchObject({ status: 409, code: 'CREDENTIALS_IN_REMOTE' });
  });

  it('blocks a configured transport helper even when its protocol is explicitly allowed in repository config', async () => {
    await trackedFile();
    const bin = path.join(root, 'fixture-bin');
    const marker = path.join(root, 'unexpected-helper-execution');
    await mkdir(bin);
    const helper = path.join(bin, 'git-remote-fixture');
    await writeFile(helper, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');\nprocess.exit(1);\n`, { mode: 0o700 });
    await command(workspace.path, 'remote', 'add', 'origin', 'https://github.com/example/repository.git');
    await command(workspace.path, 'config', 'remote.origin.vcs', 'fixture');
    await command(workspace.path, 'config', 'protocol.fixture.allow', 'always');
    const result = await runGit(workspace.path, ['ls-remote', 'origin'], {
      allowFailure: true,
      env: { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, CW_GITHUB_TOKEN: 'synthetic-test-value-with-no-access' },
    });
    expect(result.code).not.toBe(0);
    expect(result.stderr.toString()).toContain("transport 'fixture' not allowed");
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects selected remote helpers before loading account credentials or attempting a network operation', async () => {
    await trackedFile();
    await command(workspace.path, 'remote', 'add', 'origin', 'https://github.com/example/repository.git');
    await command(workspace.path, 'config', 'remote.origin.vcs', 'fixture');
    await expect(git.network(workspace.id, 'push', 'gh_9999999')).rejects.toMatchObject({ status: 409, code: 'UNSAFE_GIT_HELPER' });
  });

  it('does not pass authenticated Git environments to file transports even with a command-level allow override', async () => {
    await trackedFile();
    const remote = path.join(root, 'local-remote.git');
    await command(root, 'init', '--bare', remote);
    const result = await runGit(workspace.path, ['-c', 'protocol.file.allow=always', 'ls-remote', remote], {
      allowFailure: true, env: { CW_GITHUB_TOKEN: 'synthetic-test-value-with-no-access' },
    });
    expect(result.code).not.toBe(0);
    expect(result.stderr.toString()).toContain("transport 'file' not allowed");
  });

  it('refuses multiple push destinations before writing to any remote', async () => {
    await trackedFile();
    const first = path.join(root, 'first-remote.git');
    const second = path.join(root, 'second-remote.git');
    await command(root, 'init', '--bare', '--initial-branch=main', first);
    await command(root, 'init', '--bare', '--initial-branch=main', second);
    await command(workspace.path, 'remote', 'add', 'origin', first);
    await command(workspace.path, 'config', '--add', 'remote.origin.pushurl', first);
    await command(workspace.path, 'config', '--add', 'remote.origin.pushurl', second);
    await expect(git.network(workspace.id, 'push')).rejects.toMatchObject({ status: 409 });
    expect(await command(first, 'for-each-ref', '--format=%(refname)', 'refs/heads')).toBe('');
    expect(await command(second, 'for-each-ref', '--format=%(refname)', 'refs/heads')).toBe('');
  });

  it('overrides URL-specific HTTP settings that are more specific than the GitHub root', async () => {
    await trackedFile();
    const url = 'https://github.com/example/repository.git';
    const prefix = 'http.https://github.com/example/';
    await command(workspace.path, 'config', `${prefix}.proxy`, 'http://fixture.invalid:9999');
    await command(workspace.path, 'config', `${prefix}.followRedirects`, 'true');
    await command(workspace.path, 'config', `${prefix}.extraHeader`, 'X-Fixture: synthetic-test-data');
    await command(workspace.path, 'config', `${prefix}.sslVerify`, 'false');
    const options = { env: { CW_GITHUB_TOKEN: 'synthetic-test-value-with-no-access' } };
    const redirects = await runGit(workspace.path, ['config', '--get-urlmatch', 'http.followRedirects', url], options);
    const tls = await runGit(workspace.path, ['config', '--get-urlmatch', 'http.sslVerify', url], options);
    const proxy = await runGit(workspace.path, ['config', '--get-urlmatch', 'http.proxy', url], options);
    const header = await runGit(workspace.path, ['config', '--get-urlmatch', 'http.extraHeader', url], options);
    expect(redirects.stdout.toString().trim()).toBe('false');
    expect(tls.stdout.toString().trim()).toBe('true');
    expect(proxy.stdout.toString().trim()).toBe('');
    expect(header.stdout.toString().trim()).toBe('');
  });

  it.each(['sslCAInfo', 'sslCAPath', 'sslCert', 'sslKey'])('rejects repository-controlled %s before using an account credential', async setting => {
    await trackedFile();
    await command(workspace.path, 'config', `http.https://github.com/example/.${setting}`, path.join(root, 'untrusted-tls-material'));
    await expect(runGit(workspace.path, ['config', '--get-urlmatch', `http.${setting}`, 'https://github.com/example/repository.git'], {
      env: { CW_GITHUB_TOKEN: 'synthetic-test-value-with-no-access' },
    })).rejects.toMatchObject({ status: 409 });
  });

  it('rejects traversal and parent symlink escapes, while treating leaf symlinks as links', async () => {
    await git.init(workspace.id);
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'secret.txt'), 'do not read this value');
    await symlink(outside, path.join(workspace.path, 'escape'));
    await expect(git.diff(workspace.id, '../outside/secret.txt', false)).rejects.toMatchObject({ status: 400 });
    await expect(git.diff(workspace.id, '.git/config', false)).rejects.toMatchObject({ status: 400 });
    await expect(git.diff(workspace.id, 'escape/secret.txt', false)).rejects.toMatchObject({ status: 403 });
    await symlink(path.join(outside, 'secret.txt'), path.join(workspace.path, 'link.txt'));
    const preview = await git.diff(workspace.id, 'link.txt', false);
    expect(preview.modified).toBe(path.join(outside, 'secret.txt'));
    expect(preview.patch).not.toContain('do not read this value');
    const result = await git.discard(workspace.id, ['link.txt']);
    await git.restoreDiscard(workspace.id, result.discardId);
    expect(await readlink(path.join(workspace.path, 'link.txt'))).toBe(path.join(outside, 'secret.txt'));
    expect(await readFile(path.join(outside, 'secret.txt'), 'utf8')).toBe('do not read this value');
  });

  it('never executes repository hooks for a web commit', async () => {
    await git.init(workspace.id);
    const hook = path.join(workspace.path, '.git', 'hooks', 'pre-commit');
    await mkdir(path.dirname(hook), { recursive: true });
    await writeFile(hook, '#!/bin/sh\nexit 42\n');
    await chmod(hook, 0o755);
    await writeFile(path.join(workspace.path, 'notes.txt'), 'hook must not run\n');
    await git.stage(workspace.id, ['notes.txt']);
    expect((await git.commit(workspace.id, 'A safe web commit')).commit).toMatch(/^[a-f0-9]{40}$/);
  });

  it('marks the entire manual discard interval before touching work and clears it after the change event', async () => {
    await trackedFile();
    await writeFile(path.join(workspace.path, 'notes.txt'), 'manual edits\n');
    const observed: { kind: string; workspaceId: string; paths?: string[]; operationId?: string; content: string }[] = [];
    ctx.events.on('workspace:manual-intent', event => observed.push({ ...event, kind: event.phase, content: readFileSync(path.join(workspace.path, 'notes.txt'), 'utf8') }));
    ctx.events.on('workspace:changed', event => observed.push({ ...event, kind: 'changed', content: readFileSync(path.join(workspace.path, 'notes.txt'), 'utf8') }));
    await git.discard(workspace.id, ['notes.txt']);
    expect(observed.map(event => event.kind)).toEqual(['start', 'changed', 'end']);
    expect(observed[0]).toMatchObject({ workspaceId: workspace.id, paths: ['notes.txt'], content: 'manual edits\n' });
    expect(observed[1]).toMatchObject({ workspaceId: workspace.id, paths: ['notes.txt'], content: 'first version\n' });
    expect(observed[2]).toMatchObject({ workspaceId: workspace.id, paths: ['notes.txt'], content: 'first version\n', operationId: observed[0].operationId });
    expect(observed[0].operationId).toMatch(/^[a-f\d-]{36}$/);
  });

  it('releases manual intent even when a Git mutation fails', async () => {
    await trackedFile();
    await git.branch(workspace.id, 'feature', true);
    await writeFile(path.join(workspace.path, 'notes.txt'), 'feature work\n');
    await git.stage(workspace.id, ['notes.txt']);
    await git.commit(workspace.id, 'Feature work');
    await git.branch(workspace.id, 'main', false);
    await writeFile(path.join(workspace.path, 'notes.txt'), 'keep this uncommitted work\n');
    const intent: { workspaceId: string; operationId: string; phase: string; paths?: string[] }[] = [];
    const changes: unknown[] = [];
    ctx.events.on('workspace:manual-intent', event => intent.push(event));
    ctx.events.on('workspace:changed', event => changes.push(event));
    await expect(git.branch(workspace.id, 'feature', false)).rejects.toMatchObject({ code: 'GIT_LOCAL_CHANGES' });
    expect(intent).toHaveLength(2);
    expect(intent[0]).toEqual({ workspaceId: workspace.id, operationId: expect.any(String), phase: 'start' });
    expect(intent[1]).toEqual({ ...intent[0], phase: 'end' });
    expect(changes).toHaveLength(0);
    expect(await readFile(path.join(workspace.path, 'notes.txt'), 'utf8')).toBe('keep this uncommitted work\n');
  });

  it('does not treat an ancestor repository as belonging to an uninitialized workspace', async () => {
    await command(root, 'init', '--initial-branch=main');
    expect(await git.status(workspace.id)).toMatchObject({ isRepository: false, files: [] });
    await expect(git.stage(workspace.id, ['anything.txt'])).rejects.toMatchObject({ status: 409, code: 'NOT_A_REPOSITORY' });
  });
});
