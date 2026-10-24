import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { loadConfig } from '../server/config';
import { JsonStore, SecretStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import { WorktreeService } from '../server/worktrees';
import { GitCheckpointService, sameCheckpointRepository, sameLiveCheckpointRepository,
  type GitCheckpointManifest, type GitCheckpointPhase } from '../server/git-checkpoints';
import { CHECKOUT_GENERATION_MARKER, REPOSITORY_GENERATION_MARKER } from '../server/git-checkpoints/logical-identity';
import { GitObjectWriter, canonicalJson, manifestHash } from '../server/git-checkpoints/store';
import type { AppContext } from '../server/context';
import type { AppSettings, Workspace } from '../shared/types';

const execute = promisify(execFile);
let root: string, runtime: string, ctx: AppContext, workspace: Workspace, service: GitCheckpointService;
let retiredDirectories: string[];
let services: GitCheckpointService[];
function trackedService(value: GitCheckpointService): GitCheckpointService { services.push(value); return value; }
function context(): AppContext {
  const config = loadConfig({ DATA_DIR: root, RUNTIME_DIR: runtime, WORKSPACE_PASSWORD: 'checkpoint-test-password',
    SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'e'.repeat(64) });
  const store = new JsonStore(config.stateDir);
  const settings: AppSettings = { model: 'fixture', reasoningEffort: 'high', autoApprove: false, theme: 'dark', fontSize: 13,
    wordWrap: true, provider: 'openai', apiKeyConfigured: false };
  return { config, store, secrets: new SecretStore(store, config.encryptionKey), workspaces: new WorkspaceService(config, store),
    events: new EventEmitter(), settings: async () => settings, saveSettings: async patch => Object.assign(settings, patch), providerKey: async () => undefined };
}
async function git(...args: string[]): Promise<Buffer> {
  const result = await execute('/usr/bin/git', ['-c', 'user.name=Checkpoint Test', '-c', 'user.email=checkpoint@example.invalid',
    '-c', 'core.hooksPath=/dev/null', '-c', 'gc.auto=0', ...args], { cwd: workspace.path, encoding: 'buffer', timeout: 10_000, maxBuffer: 8 * 1024 * 1024,
    env: { PATH: '/usr/bin:/bin', HOME: runtime, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' } });
  return result.stdout;
}
async function init(format: 'sha1' | 'sha256' = 'sha1') { await git('init', '-b', 'main', `--object-format=${format}`); }
async function committed(name = 'source.txt', bytes: string | Buffer = 'committed\n') {
  await init(); await fs.writeFile(path.join(workspace.path, name), bytes); await git('add', '--', name); await git('commit', '-m', 'Fixture baseline');
}
async function capture(turnId = 'turn_one', phase: GitCheckpointPhase = 'before', owner = service): Promise<GitCheckpointManifest> {
  const result = await owner.capture({ workspaceId: workspace.id, threadId: 'thread_one', turnId, phase });
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'ready' });
  if (result.status !== 'ready') throw new Error(result.reason);
  return owner.read(result.checkpoint);
}
function checkpointPath(manifest: GitCheckpointManifest): string { return path.join(ctx.config.stateDir, 'git-checkpoints-v1', manifest.workspaceId, manifest.id); }
const fileHash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function hasDescriptorPath(target: string): Promise<boolean> {
  for (const descriptor of await fs.readdir('/proc/self/fd')) {
    const current = await fs.readlink(`/proc/self/fd/${descriptor}`).catch(() => null);
    if (current === target) return true;
  }
  return false;
}

beforeEach(async () => {
  retiredDirectories = [];
  services = [];
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-checkpoints-data-'));
  runtime = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-checkpoints-runtime-'));
  ctx = context(); workspace = await ctx.workspaces.create({ name: 'Checkpoint fixture' }); service = trackedService(new GitCheckpointService(ctx));
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const current of services ?? []) await current.close();
  await ctx?.store.flush();
  if (root) await fs.rm(root, { recursive: true, force: true });
  if (runtime) await fs.rm(runtime, { recursive: true, force: true });
  for (const directory of retiredDirectories ?? []) await fs.rm(directory, { recursive: true, force: true });
});

describe('durable native Git checkpoints', () => {
  it('captures exact staged and unstaged bytes without changing HEAD, refs, config, index or status', async () => {
    await committed();
    await fs.writeFile(path.join(workspace.path, 'source.txt'), 'staged\n'); await git('add', '--', 'source.txt');
    await fs.writeFile(path.join(workspace.path, 'source.txt'), 'working\n');
    await fs.writeFile(path.join(workspace.path, 'untracked.bin'), Buffer.from([0, 255, 1, 128]));
    const before = { head: await git('rev-parse', 'HEAD'), refs: await git('show-ref'), config: await fs.readFile(path.join(workspace.path, '.git/config')),
      index: await fs.readFile(path.join(workspace.path, '.git/index')), status: await git('status', '--porcelain=v1', '-z') };
    const saved = await capture();
    const working = saved.files.find(file => file.path === 'source.txt')!;
    const staged = saved.index.entries.find(file => file.path === 'source.txt')!;
    expect(await service.readBlob(saved, working.blob!)).toEqual(Buffer.from('working\n'));
    expect(await service.readBlob(saved, staged.blob!)).toEqual(Buffer.from('staged\n'));
    expect(await service.readIndex(saved)).toEqual(before.index);
    expect(saved.files.find(file => file.path === 'untracked.bin')).toMatchObject({ tracked: false, kind: 'file', bytes: 4 });
    expect(await git('rev-parse', 'HEAD')).toEqual(before.head); expect(await git('show-ref')).toEqual(before.refs);
    expect(await fs.readFile(path.join(workspace.path, '.git/config'))).toEqual(before.config);
    expect(await fs.readFile(path.join(workspace.path, '.git/index'))).toEqual(before.index);
    expect(await git('status', '--porcelain=v1', '-z')).toEqual(before.status);
    // Native Git can actually open and verify the independent repository; this is not a simulated commit ID.
    await git('--git-dir', checkpointPath(saved), 'fsck', '--no-reflogs');
    expect((await git('--git-dir', checkpointPath(saved), 'rev-parse', 'HEAD')).toString().trim()).toBe(saved.commit);
    expect((await git('--git-dir', checkpointPath(saved), 'show', 'HEAD:worktree/source.txt')).toString()).toBe('working\n');
  });
  it('preserves binary files, full ordinary modes and symlink target bytes without reading the target', async () => {
    await committed();
    const binary = Buffer.from([0, 255, 20, 0, 128]);
    await fs.writeFile(path.join(workspace.path, 'binary'), binary); await fs.chmod(path.join(workspace.path, 'binary'), 0o751);
    await fs.writeFile(path.join(workspace.path, 'other-executable'), 'ordinary mode'); await fs.chmod(path.join(workspace.path, 'other-executable'), 0o641);
    await fs.writeFile(path.join(root, 'outside-secret'), 'must not be captured');
    await fs.symlink('../../outside-secret', path.join(workspace.path, 'link'));
    const saved = await capture();
    const regular = saved.files.find(file => file.path === 'binary')!, link = saved.files.find(file => file.path === 'link')!;
    expect(regular.mode).toBe(0o751); expect(await service.readBlob(saved, regular.blob!)).toEqual(binary);
    expect(link.kind).toBe('symlink'); expect((await service.readBlob(saved, link.blob!)).toString()).toBe('../../outside-secret');
    expect(saved.files.some(file => file.path.includes('outside-secret'))).toBe(false);
    expect(saved.files.find(file => file.path === 'other-executable')?.mode).toBe(0o641);
    expect((await git('--git-dir', checkpointPath(saved), 'ls-tree', `${saved.commit}:worktree`, '--', 'other-executable')).toString()).toMatch(/^100644 blob /);
  });
  it('records explicit before/after phases and retains exact staged deletions and absent tracked paths', async () => {
    await committed(); const before = await capture('turn_one', 'before');
    await git('rm', '--', 'source.txt');
    const after = await capture('turn_one', 'after');
    expect(before.phase).toBe('before'); expect(after.phase).toBe('after'); expect(after.id).not.toBe(before.id);
    expect(after.files.find(file => file.path === 'source.txt')).toMatchObject({ kind: 'missing', tracked: true, blob: null });
    expect(after.index.entries).toEqual([]);
    expect((await service.readBlob(before, before.files.find(file => file.path === 'source.txt')!.blob!)).toString()).toBe('committed\n');
  });
  it('supports a real unborn repository and SHA-256 object-format indexes', async () => {
    await init('sha256'); await fs.writeFile(path.join(workspace.path, 'note'), 'new\n'); await git('add', '--', 'note');
    const saved = await capture();
    expect(saved.repository).toMatchObject({ head: null, headRef: 'refs/heads/main', objectFormat: 'sha256' });
    expect(saved.index.entries[0].objectId).toHaveLength(64); expect(saved.commit).toHaveLength(40);
    expect((await service.readBlob(saved, saved.index.entries[0].blob!)).toString()).toBe('new\n');
    expect((await git('ls-files', '--stage')).toString()).toContain(saved.index.entries[0].objectId);
  });
  it('persists verified material across service restart and temporary runtime deletion', async () => {
    await committed('source.txt', Buffer.from([0, 127, 254]));
    const saved = await capture(); const blob = saved.files[0].blob!;
    await fs.rm(runtime, { recursive: true, force: true });
    const restarted = trackedService(new GitCheckpointService(context()));
    expect((await restarted.read(saved)).manifestHash).toBe(saved.manifestHash);
    expect(await restarted.readBlob(saved, blob)).toEqual(Buffer.from([0, 127, 254]));
    expect((await restarted.inspectCurrent(saved)).files[0].sha256).toBe(fileHash(Buffer.from([0, 127, 254])));
    expect(await fs.readdir(path.join(runtime, 'tmp'))).toEqual([]);
  });
  it('expires live evidence after full checkpoint-service shutdown even when physical directories did not change', async () => {
    await committed(); const saved = await capture();
    const before = await service.inspectCurrent(saved);
    const shared = trackedService(new GitCheckpointService(context()));
    expect((await shared.inspectCurrent(saved)).repository.observedIn).toBe(before.repository.observedIn);
    await service.close();
    await expect(service.read(saved)).rejects.toMatchObject({ code: 'CHECKPOINT_CLOSED' });
    expect((await shared.inspectCurrent(saved)).token).toBe(before.token);
    const closing = shared.close();
    expect(shared.close()).toBe(closing);
    await closing;
    const restarted = trackedService(new GitCheckpointService(context()));
    const after = await restarted.inspectCurrent(saved);
    expect(after.repository.rootIdentity).toEqual(before.repository.rootIdentity);
    expect(after.repository.gitIdentity).toEqual(before.repository.gitIdentity);
    expect(after.repository.observedIn).not.toBe(before.repository.observedIn);
    expect(after.token).not.toBe(before.token);
    expect(sameCheckpointRepository(before.repository, after.repository)).toBe(true);
    expect(sameLiveCheckpointRepository(before.repository, after.repository)).toBe(false);
  });
  it('rejects replayed repository identity on replaced directories during the same process, including a new service instance', async () => {
    await committed(); const saved = await capture();
    const replacement = `${workspace.path}-replacement`, retired = `${workspace.path}-retired`;
    await fs.cp(workspace.path, replacement, { recursive: true, dereference: false, verbatimSymlinks: true, preserveTimestamps: true });
    await fs.rename(workspace.path, retired); await fs.rename(replacement, workspace.path);
    expect((await fs.stat(workspace.path)).ino).not.toBe(saved.repository.rootIdentity.ino);
    expect(await fs.readFile(path.join(workspace.path, '.git', REPOSITORY_GENERATION_MARKER)))
      .toEqual(await fs.readFile(path.join(retired, '.git', REPOSITORY_GENERATION_MARKER)));
    await expect(service.inspectCurrent(saved)).rejects.toMatchObject({ code: 'CHECKPOINT_LIVE_REPOSITORY_CHANGED' });
    await expect(trackedService(new GitCheckpointService(context())).assertRepository(saved)).rejects.toMatchObject({ code: 'CHECKPOINT_LIVE_REPOSITORY_CHANGED' });
    expect(await fs.readFile(path.join(workspace.path, 'source.txt'), 'utf8')).toBe('committed\n');
  });
  it('retains replacement evidence after complete source-directory deletion rather than depending on a named retired directory', async () => {
    await committed(); const saved = await capture();
    const replacement = `${workspace.path}-replacement`;
    await fs.cp(workspace.path, replacement, { recursive: true, dereference: false, verbatimSymlinks: true });
    await fs.rm(workspace.path, { recursive: true }); await fs.rename(replacement, workspace.path);
    // A live directory lease keeps the old inode allocated even after unlink;
    // checking only saved numbers would have no such native lifetime guarantee.
    expect(await hasDescriptorPath(`${workspace.path} (deleted)`)).toBe(true);
    expect(await hasDescriptorPath(`${workspace.path}/.git (deleted)`)).toBe(true);
    await expect(service.assertRepository(saved)).rejects.toMatchObject({ code: 'CHECKPOINT_LIVE_REPOSITORY_CHANGED' });
    const shared = trackedService(new GitCheckpointService(context()));
    await expect(shared.inspectCurrent(saved)).rejects.toMatchObject({ code: 'CHECKPOINT_LIVE_REPOSITORY_CHANGED' });
    await service.close();
    expect(await hasDescriptorPath(`${workspace.path} (deleted)`)).toBe(true);
    await shared.close();
    expect(await hasDescriptorPath(`${workspace.path} (deleted)`)).toBe(false);
    expect(await fs.readFile(path.join(workspace.path, 'source.txt'), 'utf8')).toBe('committed\n');
  });
  it('recognizes reconstructed durable data in a fresh Node process for primary and managed checkouts while expiring old live plans', async () => {
    await committed();
    const primaryWorkspace = workspace, primary = await capture('primary_turn');
    const managed = await new WorktreeService(ctx).create(workspace.id, { branch: 'persisted-checkout', createBranch: true });
    workspace = managed.workspace;
    await fs.writeFile(path.join(workspace.path, 'source.txt'), 'managed source\n');
    const child = await capture('child_turn');
    const originalTokens = new Map<string, string>();
    for (const saved of [primary, child]) originalTokens.set(saved.id, (await service.inspectCurrent(saved)).token);
    expect(child.repository.generation.repository).toBe(primary.repository.generation.repository);
    expect(child.repository.generation.checkout).not.toBe(primary.repository.generation.checkout);
    expect(child.repository.generation.worktreeId).toBe(managed.worktree.id);
    await ctx.store.flush();
    const replacement = `${root}-reconstructed`, retired = `${root}-retired`;
    retiredDirectories.push(replacement, retired);
    await fs.cp(root, replacement, { recursive: true, dereference: false, verbatimSymlinks: true, preserveTimestamps: true });
    await fs.rename(root, retired); await fs.rename(replacement, root);
    expect((await fs.stat(primaryWorkspace.path)).ino).not.toBe(primary.repository.rootIdentity.ino);
    expect((await fs.stat(child.repository.gitDirectory)).ino).not.toBe(child.repository.gitIdentity.ino);
    // Copying to replacement directories is an owned reconstruction fixture, never a mount/proxy/container operation.
    const requestFile = path.join(runtime, 'restart-input.json');
    await fs.writeFile(requestFile, JSON.stringify({ dataDir: root, runtimeDir: path.join(runtime, 'fresh-process'),
      references: [primary, child], captureAfter: child }), { flag: 'wx', mode: 0o600 });
    const result = await execute(process.execPath, ['--import', 'tsx', 'tests/fixtures/git-checkpoint-restart.ts', requestFile], {
      cwd: process.cwd(), timeout: 25_000, maxBuffer: 1024 * 1024,
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', NODE_OPTIONS: '--v8-pool-size=1 --max-old-space-size=512', UV_THREADPOOL_SIZE: '1', GOMAXPROCS: '2' },
    });
    const proof = JSON.parse(result.stdout) as { observations: Array<{ id: string; repository: GitCheckpointManifest['repository']; current: { token: string }; content: string }>; after: GitCheckpointManifest };
    expect(proof.observations).toHaveLength(2);
    for (const before of [primary, child]) {
      const current = proof.observations.find(item => item.id === before.id)!;
      expect(current.repository.generation).toEqual(before.repository.generation);
      expect(current.repository.observedIn).not.toBe(before.repository.observedIn);
      expect(current.repository.rootIdentity.ino).not.toBe(before.repository.rootIdentity.ino);
      expect(sameCheckpointRepository(before.repository, current.repository)).toBe(true);
      expect(sameLiveCheckpointRepository(before.repository, current.repository)).toBe(false);
      expect(current.current.token).not.toBe(originalTokens.get(before.id));
    }
    expect(proof.after.phase).toBe('after');
    expect(sameCheckpointRepository(child.repository, proof.after.repository)).toBe(true);
    expect(proof.after.files.map(file => [file.path, file.kind, file.mode, file.sha256])).toEqual(child.files.map(file => [file.path, file.kind, file.mode, file.sha256]));
    expect(proof.after.index.sha256).toBe(child.index.sha256);
    expect(await fs.readFile(path.join(primaryWorkspace.path, 'source.txt'), 'utf8')).toBe('committed\n');
    expect(await fs.readFile(path.join(workspace.path, 'source.txt'), 'utf8')).toBe('managed source\n');
  }, 40_000);
  it('refuses missing, tampered and copied generation markers instead of assigning identity to old checkpoints', async () => {
    await committed(); const saved = await capture();
    const marker = path.join(workspace.path, '.git', REPOSITORY_GENERATION_MARKER), original = await fs.readFile(marker);
    const value = JSON.parse(original.toString('utf8')); value.value.workspaceId = 'different_workspace';
    await fs.writeFile(marker, JSON.stringify(value));
    await expect(service.assertRepository(saved)).rejects.toMatchObject({ code: 'CHECKPOINT_GENERATION_UNAVAILABLE' });
    await fs.unlink(marker);
    await expect(service.inspectCurrent(saved)).rejects.toMatchObject({ code: 'CHECKPOINT_GENERATION_UNAVAILABLE' });
    // A subsequent real capture may identify a new repository generation, but never resurrect the old identity.
    const fresh = await capture('new_generation');
    expect(fresh.repository.generation.repository).not.toBe(saved.repository.generation.repository);
    expect(sameCheckpointRepository(fresh.repository, saved.repository)).toBe(false);
    await expect(service.assertRepository(saved)).rejects.toMatchObject({ code: 'CHECKPOINT_REPOSITORY_CHANGED' });
    await fs.writeFile(marker, original);
  });
  it('rejects another registered checkout’s signed marker even when the common repository and HEAD match', async () => {
    await committed(); const primary = workspace;
    const worktrees = new WorktreeService(ctx);
    const first = await worktrees.create(primary.id, { branch: 'first-checkout', createBranch: true });
    workspace = first.workspace; const firstSnapshot = await capture('first_checkout');
    const second = await worktrees.create(primary.id, { branch: 'second-checkout', createBranch: true });
    workspace = second.workspace; const secondSnapshot = await capture('second_checkout');
    const firstMarker = path.join(firstSnapshot.repository.gitDirectory, CHECKOUT_GENERATION_MARKER);
    const secondMarker = path.join(secondSnapshot.repository.gitDirectory, CHECKOUT_GENERATION_MARKER);
    await fs.writeFile(secondMarker, await fs.readFile(firstMarker));
    await expect(service.assertRepository(secondSnapshot)).rejects.toMatchObject({ code: 'CHECKPOINT_GENERATION_UNAVAILABLE' });
    expect(await fs.readFile(path.join(primary.path, 'source.txt'), 'utf8')).toBe('committed\n');
  });
  it('includes formerly captured untracked paths in live checks even after ignore rules change', async () => {
    await committed(); await fs.writeFile(path.join(workspace.path, 'draft'), 'before');
    const saved = await capture();
    await fs.writeFile(path.join(workspace.path, '.gitignore'), 'draft\n'); await fs.unlink(path.join(workspace.path, 'draft'));
    const current = await service.inspectCurrent(saved);
    expect(current.files.find(file => file.path === 'draft')).toMatchObject({ kind: 'missing', sha256: null });
    await fs.writeFile(path.join(workspace.path, 'draft'), 'manual hidden edit');
    const updated = await service.inspectCurrent(saved);
    expect(updated.files.find(file => file.path === 'draft')).toMatchObject({ kind: 'file', sha256: fileHash(Buffer.from('manual hidden edit')) });
    expect(updated.token).not.toBe(current.token);
  });
  it('keeps ignored generated data outside coverage while still including ignored tracked source', async () => {
    await committed(); await fs.writeFile(path.join(workspace.path, '.gitignore'), 'source.txt\ncache/\n');
    await fs.mkdir(path.join(workspace.path, 'cache')); await fs.writeFile(path.join(workspace.path, 'cache/output'), 'cache');
    const saved = await capture();
    expect(saved.files.find(file => file.path === 'source.txt')?.tracked).toBe(true);
    expect(saved.files.some(file => file.path.startsWith('cache/'))).toBe(false);
    expect(saved.limitations.join(' ')).toContain('Git-ignored');
  });
  it('preserves a leading UTF-8 BOM in the first untracked filename', async () => {
    await init();
    const name = '\uFEFFfile.txt'; await fs.writeFile(path.join(workspace.path, name), 'exact filename');
    const saved = await capture();
    expect(saved.files.map(file => file.path)).toEqual([name]);
    expect(saved.files[0].kind).toBe('file');
    expect((await service.readBlob(saved, saved.files[0].blob!)).toString()).toBe('exact filename');
  });
  it('refuses promisor repositories before object enumeration instead of attempting a lazy fetch', async () => {
    await committed(); await git('config', 'remote.origin.promisor', 'true');
    expect(await service.capture({ workspaceId: workspace.id, threadId: 'thread_one', turnId: 'partial_clone' })).toMatchObject({ status: 'unavailable', code: 'CHECKPOINT_PARTIAL_CLONE' });
    expect(await fs.readFile(path.join(workspace.path, 'source.txt'), 'utf8')).toBe('committed\n');
  });
  it('refuses after a branch or checkout identity change without changing any files', async () => {
    await committed(); const saved = await capture(); await git('switch', '-c', 'manual-branch');
    await expect(service.assertRepository(saved)).rejects.toMatchObject({ code: 'CHECKPOINT_REPOSITORY_CHANGED' });
    await expect(service.inspectCurrent(saved)).rejects.toMatchObject({ code: 'CHECKPOINT_REPOSITORY_CHANGED' });
    const recovery = await service.inspectWorkspaceCurrent(workspace.id, { paths: saved.files.map(file => file.path) });
    expect(recovery.repository.headRef).toBe('refs/heads/manual-branch');
    expect(recovery.repository.head).toBe(saved.repository.head);
    expect(await fs.readFile(path.join(workspace.path, 'source.txt'), 'utf8')).toBe('committed\n');
  });
  it('uses the registered managed-worktree index without changing the source repository index', async () => {
    await committed(); const primary = workspace;
    const parentIndex = await fs.readFile(path.join(primary.path, '.git/index'));
    const managed = await new WorktreeService(ctx).create(primary.id, { branch: 'checkpoint-child', createBranch: true });
    workspace = managed.workspace;
    await fs.writeFile(path.join(workspace.path, 'source.txt'), 'child working\n');
    const saved = await capture();
    expect(saved.repository.commonDirectory).toBe(path.join(primary.path, '.git'));
    expect(saved.repository.gitDirectory).toBe(workspace.worktree!.gitDirectory);
    expect(saved.repository.root).toBe(workspace.path);
    expect(await fs.readFile(path.join(primary.path, '.git/index'))).toEqual(parentIndex);
    expect(await fs.readFile(path.join(primary.path, 'source.txt'), 'utf8')).toBe('committed\n');
  });
  it('never invokes repository filters, fsmonitor or hooks when capturing', async () => {
    await committed();
    const marker = path.join(runtime, 'unsafe-hook-ran');
    await git('config', 'filter.fixture.clean', `touch ${marker}`); await git('config', 'filter.fixture.smudge', `touch ${marker}`);
    await git('config', 'core.fsmonitor', `touch ${marker}`);
    await fs.writeFile(path.join(workspace.path, '.gitattributes'), '* filter=fixture\n');
    await fs.writeFile(path.join(workspace.path, '.git/hooks/post-index-change'), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
    await capture();
    await expect(fs.lstat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('reports non-repositories, hard links, submodules and oversized files honestly without ready snapshots', async () => {
    expect(await service.capture({ workspaceId: workspace.id, threadId: 'thread_one', turnId: 'no_git' })).toMatchObject({ status: 'unavailable', code: 'CHECKPOINT_NOT_A_REPOSITORY' });
    await committed(); await fs.link(path.join(workspace.path, 'source.txt'), path.join(workspace.path, 'hardlink'));
    expect(await service.capture({ workspaceId: workspace.id, threadId: 'thread_one', turnId: 'hard_link' })).toMatchObject({ status: 'unavailable', code: 'CHECKPOINT_HARD_LINK' });
    await fs.unlink(path.join(workspace.path, 'hardlink'));
    const bounded = trackedService(new GitCheckpointService(ctx, { limits: { fileBytes: 2 } }));
    expect(await bounded.capture({ workspaceId: workspace.id, threadId: 'thread_one', turnId: 'too_large' })).toMatchObject({ status: 'unavailable', code: 'CHECKPOINT_LIMIT' });
    const head = (await git('rev-parse', 'HEAD')).toString().trim(); await git('update-index', '--add', '--cacheinfo', `160000,${head},module`);
    expect(await service.capture({ workspaceId: workspace.id, threadId: 'thread_one', turnId: 'submodule' })).toMatchObject({ status: 'unavailable', code: 'CHECKPOINT_UNSUPPORTED_INDEX' });
    expect((await fs.readdir(path.join(ctx.config.stateDir, 'git-checkpoints-v1', workspace.id))).filter(name => name.startsWith('gcp_'))).toEqual([]);
  });
  it('rejects a changed ancestor symlink instead of following outside the workspace', async () => {
    await committed(); await fs.mkdir(path.join(workspace.path, 'nested')); await fs.writeFile(path.join(workspace.path, 'nested/source'), 'original');
    const saved = await capture();
    const outside = path.join(root, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'source'), 'outside secret');
    await fs.rm(path.join(workspace.path, 'nested'), { recursive: true }); await fs.symlink(outside, path.join(workspace.path, 'nested'));
    await expect(service.inspectCurrent(saved)).rejects.toMatchObject({ code: 'CHECKPOINT_UNSAFE_PATH' });
    expect(await fs.readFile(path.join(outside, 'source'), 'utf8')).toBe('outside secret');
  });
  it('detects edits during capture and discards only its unpublished checkpoint directory', async () => {
    await committed();
    const original = GitObjectWriter.prototype.write; let edited = false;
    vi.spyOn(GitObjectWriter.prototype, 'write').mockImplementation(async function (this: GitObjectWriter, type, bytes) {
      const result = await original.call(this, type, bytes);
      if (!edited && type === 'blob' && bytes.equals(Buffer.from('committed\n'))) { edited = true; await fs.writeFile(path.join(workspace.path, 'source.txt'), 'racing manual edit'); }
      return result;
    });
    expect(await service.capture({ workspaceId: workspace.id, threadId: 'thread_one', turnId: 'race' })).toMatchObject({ status: 'unavailable', code: 'CHECKPOINT_CHANGED' });
    expect(await fs.readFile(path.join(workspace.path, 'source.txt'), 'utf8')).toBe('racing manual edit');
    expect((await fs.readdir(path.join(ctx.config.stateDir, 'git-checkpoints-v1', workspace.id))).filter(name => name.startsWith('gcp_'))).toEqual([]);
  });
  it('authenticates manifests, validates blob bytes and prevents cross-thread or cross-checkpoint lookup', async () => {
    await committed(); const saved = await capture();
    await expect(service.read({ ...saved, threadId: 'other_thread' })).rejects.toMatchObject({ code: 'CHECKPOINT_INVALID' });
    await expect(service.readBlob(saved, '0'.repeat(40))).rejects.toMatchObject({ code: 'CHECKPOINT_BLOB_NOT_FOUND' });
    const blob = saved.files[0].blob!, objectPath = path.join(checkpointPath(saved), 'objects', blob.slice(0, 2), blob.slice(2));
    const bytes = await fs.readFile(objectPath); await fs.writeFile(objectPath, 'tampered');
    await expect(service.readBlob(saved, blob)).rejects.toMatchObject({ code: 'CHECKPOINT_INVALID' });
    await fs.writeFile(objectPath, bytes);
    const manifestPath = path.join(checkpointPath(saved), 'manifest.json');
    const altered = JSON.parse(await fs.readFile(manifestPath, 'utf8')); altered.value.files[0].path = '../outside';
    await fs.writeFile(manifestPath, JSON.stringify(altered));
    await expect(service.read(saved)).rejects.toMatchObject({ code: 'CHECKPOINT_INVALID' });
  });
  it('rejects an authenticated legacy manifest missing durable repository identity at the persistence boundary', async () => {
    await committed(); const saved = await capture();
    const manifestPath = path.join(checkpointPath(saved), 'manifest.json');
    const legacy = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    delete legacy.value.repository.generation;
    legacy.value.manifestHash = manifestHash(legacy.value);
    const key = createHmac('sha256', ctx.config.encryptionKey).update('codex-workspace/git-checkpoints/v1').digest();
    legacy.authentication = createHmac('sha256', key).update(canonicalJson(legacy.value)).digest('hex');
    await fs.writeFile(manifestPath, canonicalJson(legacy));
    await expect(service.read({ ...saved, manifestHash: legacy.value.manifestHash })).rejects.toMatchObject({ code: 'CHECKPOINT_INVALID' });
    expect(await fs.readFile(path.join(workspace.path, 'source.txt'), 'utf8')).toBe('committed\n');
  });
  it('keeps retained checkpoints until explicit thread cleanup and refuses new capture at the quota', async () => {
    await committed(); const bounded = trackedService(new GitCheckpointService(ctx, { limits: { retainedCheckpoints: 2 } }));
    const first = await capture('first', 'before', bounded), second = await capture('second', 'before', bounded);
    expect(await bounded.capture({ workspaceId: workspace.id, threadId: 'thread_one', turnId: 'third' })).toMatchObject({ status: 'unavailable', code: 'CHECKPOINT_RETENTION_LIMIT' });
    expect(await bounded.cleanupThread(workspace.id, 'different_thread')).toEqual({ removed: 0 });
    expect(await bounded.cleanupThread(workspace.id, 'thread_one', { keepTurnIds: new Set(['second']) })).toEqual({ removed: 1 });
    await expect(bounded.read(first)).rejects.toMatchObject({ code: 'CHECKPOINT_INVALID' });
    expect((await bounded.read(second)).id).toBe(second.id);
    expect((await capture('third', 'after', bounded)).phase).toBe('after');
  });
  it('never recovers an incomplete checkpoint as ready after restart', async () => {
    await committed(); const saved = await capture();
    await fs.unlink(path.join(checkpointPath(saved), 'manifest.json'));
    const restarted = trackedService(new GitCheckpointService(context()));
    await expect(restarted.read(saved)).rejects.toMatchObject({ code: 'CHECKPOINT_INVALID' });
    expect(await restarted.cleanupThread(workspace.id, 'thread_one')).toEqual({ removed: 1 });
    expect((await capture('after_recovery', 'before', restarted)).files[0].path).toBe('source.txt');
  });
  it('purges every owned checkpoint for permanent workspace deletion while preserving other workspace records', async () => {
    await committed(); const saved = await capture();
    const second = await service.capture({ workspaceId: workspace.id, threadId: 'different_thread', turnId: 'other_turn' });
    expect(second.status).toBe('ready');
    const unrelated = await ctx.workspaces.create({ name: 'Unrelated persistent data' });
    await fs.writeFile(path.join(unrelated.path, 'leave.txt'), 'leave me');
    // The source has already been removed by the reviewed workspace deletion job.
    await fs.rm(workspace.path, { recursive: true });
    expect(await service.cleanupWorkspace(workspace.id)).toEqual({ removed: 2 });
    await expect(service.read(saved)).rejects.toMatchObject({ code: 'CHECKPOINT_INVALID' });
    expect(await fs.readFile(path.join(unrelated.path, 'leave.txt'), 'utf8')).toBe('leave me');
    expect(await service.cleanupWorkspace(workspace.id)).toEqual({ removed: 0 });
  });
});
