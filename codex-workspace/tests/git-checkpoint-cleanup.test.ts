import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { constants, type PathLike } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadConfig } from '../server/config';
import type { AppContext } from '../server/context';
import { JsonStore, SecretStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import { GitCheckpointService, type GitCheckpointLimits, type GitCheckpointManifest } from '../server/git-checkpoints';
import { CheckpointDirectory } from '../server/git-checkpoints/filesystem';
import { CHECKPOINT_LIMITS, CheckpointStore } from '../server/git-checkpoints/store';
import type { AppSettings, Workspace } from '../shared/types';

const execute = promisify(execFile);
const contexts: AppContext[] = [];
const activeServices = new Set<GitCheckpointService>();
let root: string, runtime: string, ctx: AppContext, workspace: Workspace, service: GitCheckpointService;

function context(): AppContext {
  const config = loadConfig({ DATA_DIR: root, RUNTIME_DIR: runtime, WORKSPACE_PASSWORD: 'cleanup-fixture-password',
    SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'e'.repeat(64) });
  const store = new JsonStore(config.stateDir);
  const settings: AppSettings = { model: 'fixture', reasoningEffort: 'high', autoApprove: false, theme: 'dark', fontSize: 13,
    wordWrap: true, provider: 'openai', apiKeyConfigured: false };
  const result: AppContext = { config, store, secrets: new SecretStore(store, config.encryptionKey),
    workspaces: new WorkspaceService(config, store), events: new EventEmitter(), settings: async () => settings,
    saveSettings: async patch => Object.assign(settings, patch), providerKey: async () => undefined };
  contexts.push(result);
  return result;
}

function makeService(limits?: Partial<GitCheckpointLimits>): GitCheckpointService {
  const result = new GitCheckpointService(ctx, { limits });
  activeServices.add(result);
  return result;
}

async function restart(limits?: Partial<GitCheckpointLimits>): Promise<GitCheckpointService> {
  if (activeServices.delete(service)) await service.close();
  await ctx.store.flush();
  ctx = context();
  service = makeService(limits);
  return service;
}

async function nativeGit(target: Workspace, ...args: string[]): Promise<Buffer> {
  const result = await execute('/usr/bin/git', ['-c', 'user.name=Cleanup Fixture', '-c', 'user.email=cleanup@example.invalid',
    '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'index.skipHash=false',
    '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args], {
    cwd: target.path, encoding: 'buffer', timeout: 10_000, maxBuffer: 2 * 1024 * 1024,
    env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: '' },
  });
  return result.stdout;
}

async function prepare(target: Workspace): Promise<void> {
  await nativeGit(target, 'init', '-b', 'main');
  await fs.writeFile(path.join(target.path, 'source.txt'), 'durable source\n');
  await nativeGit(target, 'add', '--', 'source.txt');
  await nativeGit(target, 'commit', '-m', 'Cleanup fixture baseline');
}

async function capture(threadId = 'thread_one', turnId = 'turn_one', target = workspace): Promise<GitCheckpointManifest> {
  const result = await service.capture({ workspaceId: target.id, threadId, turnId });
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'ready' });
  if (result.status !== 'ready') throw new Error(result.reason);
  return service.read(result.checkpoint);
}

const recordPath = (saved: GitCheckpointManifest) => path.join(ctx.config.stateDir, 'git-checkpoints-v1', saved.workspaceId, saved.id);
const intentPath = (saved: GitCheckpointManifest) => path.join(path.dirname(recordPath(saved)), `.delete-${saved.id}.json`);
const ioFailure = () => Object.assign(new Error('Injected filesystem interruption'), { code: 'EIO' });

async function actualPath(value: PathLike): Promise<string> {
  const supplied = value instanceof URL ? fileURLToPath(value) : value.toString();
  return path.join(await fs.realpath(path.dirname(supplied)), path.basename(supplied));
}

type FailurePoint = 'before-payload' | 'after-owner-unlink' | 'after-rmdir' | 'before-intent-unlink';
function interruptAt(saved: GitCheckpointManifest, point: FailurePoint): { restore(): void; happened(): boolean } {
  const originalUnlink = fs.unlink.bind(fs), originalRmdir = fs.rmdir.bind(fs);
  const record = recordPath(saved), intent = intentPath(saved);
  let happened = false;
  if (point === 'after-rmdir') {
    const spy = vi.spyOn(fs, 'rmdir').mockImplementation(async (filename, options) => {
      if (!happened && await actualPath(filename) === record) {
        happened = true;
        await originalRmdir(filename, options);
        throw ioFailure();
      }
      return originalRmdir(filename, options);
    });
    return { restore: () => spy.mockRestore(), happened: () => happened };
  }
  const spy = vi.spyOn(fs, 'unlink').mockImplementation(async filename => {
    const target = await actualPath(filename);
    const selected = point === 'before-payload' ? target.startsWith(`${record}/`) && target !== `${record}/owner.json`
      : point === 'after-owner-unlink' ? target === `${record}/owner.json` : target === intent;
    if (!happened && selected) {
      happened = true;
      if (point === 'after-owner-unlink') await originalUnlink(filename);
      throw ioFailure();
    }
    return originalUnlink(filename);
  });
  return { restore: () => spy.mockRestore(), happened: () => happened };
}

async function interruptedCleanup(saved: GitCheckpointManifest, point: FailurePoint): Promise<void> {
  const fault = interruptAt(saved, point);
  try { await expect(service.cleanupThread(saved.workspaceId, saved.threadId)).rejects.toMatchObject({ code: 'EIO' }); }
  finally { fault.restore(); }
  expect(fault.happened()).toBe(true);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-checkpoint-cleanup-data-'));
  runtime = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-checkpoint-cleanup-runtime-'));
  ctx = context(); workspace = await ctx.workspaces.create({ name: 'Cleanup fixture' }); service = makeService();
  await prepare(workspace);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const instance of activeServices) await instance.close();
  activeServices.clear();
  for (const instance of contexts) await instance.store.flush();
  contexts.length = 0;
  if (root) await fs.rm(root, { recursive: true, force: true });
  if (runtime) await fs.rm(runtime, { recursive: true, force: true });
});

describe('authenticated checkpoint cleanup recovery', () => {
  it.each(['after-owner-unlink', 'after-rmdir', 'before-intent-unlink'] as const)('resumes %s after service recreation without losing its deletion proof', async point => {
    const saved = await capture();
    const owner = JSON.parse(await fs.readFile(path.join(recordPath(saved), 'owner.json'), 'utf8'));
    await interruptedCleanup(saved, point);
    const proof = JSON.parse(await fs.readFile(intentPath(saved), 'utf8'));
    expect(proof.value).toEqual({ version: 1, kind: 'git-checkpoint-deletion', owner: owner.value });
    expect(proof.authentication).toMatch(/^[a-f0-9]{64}$/);
    if (point === 'after-owner-unlink') expect(await fs.readdir(recordPath(saved))).toEqual([]);
    else await expect(fs.lstat(recordPath(saved))).rejects.toMatchObject({ code: 'ENOENT' });
    await restart();
    await expect(service.read(saved)).rejects.toMatchObject({ code: 'CHECKPOINT_DELETING' });
    expect(await service.cleanupThread(workspace.id, 'different_thread')).toEqual({ removed: 0 });
    expect(await service.cleanupThread(workspace.id, saved.threadId, { keepTurnIds: new Set([saved.turnId]) })).toEqual({ removed: 0 });
    expect(await fs.lstat(intentPath(saved))).toMatchObject({ nlink: 1 });
    expect(await service.cleanupThread(workspace.id, saved.threadId)).toEqual({ removed: 1 });
    await expect(fs.lstat(recordPath(saved))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.lstat(intentPath(saved))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await service.cleanupThread(workspace.id, saved.threadId)).toEqual({ removed: 0 });
    expect(await fs.readFile(path.join(workspace.path, 'source.txt'), 'utf8')).toBe('durable source\n');
  });

  it('preserves a readable checkpoint when publishing its deletion proof fails', async () => {
    const saved = await capture();
    const manifest = await fs.readFile(path.join(recordPath(saved), 'manifest.json'));
    const originalOpen = fs.open.bind(fs);
    let refused = false;
    const fault = vi.spyOn(fs, 'open').mockImplementation(async (filename, flags, mode) => {
      if (path.basename(filename.toString()) === path.basename(intentPath(saved)) && typeof flags === 'number' && (flags & constants.O_CREAT)) {
        refused = true;
        throw ioFailure();
      }
      return originalOpen(filename, flags, mode);
    });
    try { await expect(service.cleanupThread(workspace.id, saved.threadId)).rejects.toMatchObject({ code: 'EIO' }); }
    finally { fault.mockRestore(); }
    expect(refused).toBe(true);
    await expect(fs.lstat(intentPath(saved))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(recordPath(saved), 'manifest.json'))).toEqual(manifest);
    expect((await service.read(saved)).id).toBe(saved.id);
  });

  it('publishes proof before payload deletion, blocks reads, and preserves excluded threads and turns', async () => {
    const saved = await capture();
    const manifest = await fs.readFile(path.join(recordPath(saved), 'manifest.json'));
    await interruptedCleanup(saved, 'before-payload');
    const proof = await fs.readFile(intentPath(saved));
    expect(await fs.readFile(path.join(recordPath(saved), 'manifest.json'))).toEqual(manifest);
    expect(await fs.readFile(path.join(recordPath(saved), 'HEAD'), 'utf8')).toBe(`${saved.commit}\n`);
    expect(await fs.readFile(path.join(recordPath(saved), 'refs/codex/checkpoint'), 'utf8')).toBe(`${saved.commit}\n`);
    await restart();
    await expect(service.read(saved)).rejects.toMatchObject({ code: 'CHECKPOINT_DELETING' });
    expect(await service.cleanupThread(workspace.id, 'different_thread')).toEqual({ removed: 0 });
    expect(await service.cleanupThread(workspace.id, saved.threadId, { keepTurnIds: new Set([saved.turnId]) })).toEqual({ removed: 0 });
    expect(await fs.readFile(intentPath(saved))).toEqual(proof);
    expect(await fs.readFile(path.join(recordPath(saved), 'manifest.json'))).toEqual(manifest);
    expect(await service.cleanupThread(workspace.id, saved.threadId)).toEqual({ removed: 1 });
  });

  it('counts a pending directory and intent once without resuming them during another capture', async () => {
    await restart({ retainedCheckpoints: 2 });
    const first = await capture();
    await interruptedCleanup(first, 'before-payload');
    const proof = await fs.readFile(intentPath(first));
    await restart({ retainedCheckpoints: 2 });
    const second = await capture('other_thread', 'other_turn');
    expect(await fs.readFile(intentPath(first))).toEqual(proof);
    expect((await service.read(second)).id).toBe(second.id);
    expect(await service.capture({ workspaceId: workspace.id, threadId: 'third_thread', turnId: 'third_turn' }))
      .toMatchObject({ status: 'unavailable', code: 'CHECKPOINT_RETENTION_LIMIT' });
    expect(await service.cleanupThread(workspace.id, first.threadId)).toEqual({ removed: 1 });
    expect((await service.read(second)).id).toBe(second.id);
    expect((await capture('third_thread', 'third_turn')).threadId).toBe('third_thread');
  });

  it('finishes pending and live records only in the requested workspace', async () => {
    const first = await capture();
    await interruptedCleanup(first, 'after-owner-unlink');
    await capture('another_thread', 'another_turn');
    const other = await ctx.workspaces.create({ name: 'Unrelated workspace' });
    await prepare(other);
    const unrelated = await capture('unrelated_thread', 'unrelated_turn', other);
    await restart();
    expect(await service.cleanupWorkspace(workspace.id)).toEqual({ removed: 2 });
    expect((await service.read(unrelated)).id).toBe(unrelated.id);
    expect(await fs.readFile(path.join(other.path, 'source.txt'), 'utf8')).toBe('durable source\n');
    expect(await fs.readdir(path.dirname(recordPath(first)))).toEqual(['owner.json']);
  });

  it('rejects a tampered intent during reads, quota enumeration and cleanup without deleting payload', async () => {
    const saved = await capture();
    const manifest = await fs.readFile(path.join(recordPath(saved), 'manifest.json'));
    await interruptedCleanup(saved, 'before-payload');
    const original = await fs.readFile(intentPath(saved));
    const tampered = JSON.parse(original.toString());
    tampered.value.owner.threadId = 'different_thread';
    await fs.writeFile(intentPath(saved), JSON.stringify(tampered));
    await restart();
    await expect(service.read(saved)).rejects.toMatchObject({ code: 'CHECKPOINT_INVALID' });
    await expect(service.cleanupThread(workspace.id, saved.threadId)).rejects.toMatchObject({ code: 'CHECKPOINT_INVALID' });
    expect(await service.capture({ workspaceId: workspace.id, threadId: 'new_thread', turnId: 'new_turn' }))
      .toMatchObject({ status: 'unavailable', code: 'CHECKPOINT_INVALID' });
    expect(await fs.readFile(path.join(recordPath(saved), 'manifest.json'))).toEqual(manifest);
    await fs.writeFile(intentPath(saved), original);
    expect(await service.cleanupThread(workspace.id, saved.threadId)).toEqual({ removed: 1 });
  });

  it('rejects a valid intent copied into a foreign workspace', async () => {
    const saved = await capture();
    await interruptedCleanup(saved, 'before-payload');
    const other = await ctx.workspaces.create({ name: 'Foreign intent fixture' });
    await prepare(other);
    const unrelated = await capture('other_thread', 'other_turn', other);
    const foreignPath = path.join(path.dirname(recordPath(unrelated)), path.basename(intentPath(saved)));
    await fs.copyFile(intentPath(saved), foreignPath);
    await restart();
    await expect(service.cleanupWorkspace(other.id)).rejects.toMatchObject({ code: 'CHECKPOINT_INVALID' });
    expect((await service.read(unrelated)).id).toBe(unrelated.id);
    expect(await fs.readFile(foreignPath)).toEqual(await fs.readFile(intentPath(saved)));
  });

  it('requires any remaining authenticated owner to match the exact deletion intent', async () => {
    const saved = await capture();
    await interruptedCleanup(saved, 'before-payload');
    const other = await capture('other_thread', 'other_turn');
    const manifest = await fs.readFile(path.join(recordPath(saved), 'manifest.json'));
    await fs.copyFile(path.join(recordPath(other), 'owner.json'), path.join(recordPath(saved), 'owner.json'));
    await restart();
    await expect(service.cleanupThread(workspace.id, saved.threadId)).rejects.toMatchObject({ code: 'CHECKPOINT_INVALID' });
    expect(await fs.readFile(path.join(recordPath(saved), 'manifest.json'))).toEqual(manifest);
    expect((await service.read(other)).id).toBe(other.id);
    expect(await fs.lstat(intentPath(saved))).toMatchObject({ nlink: 1 });
  });

  it.each(['personal-notes.txt', 'HEAD'])('never deletes ownerless nonempty data, including %s, using an old intent', async filename => {
    const saved = await capture();
    await interruptedCleanup(saved, 'after-owner-unlink');
    const proof = await fs.readFile(intentPath(saved));
    await fs.writeFile(path.join(recordPath(saved), filename), 'preserve unrelated data');
    await restart();
    await expect(service.cleanupWorkspace(workspace.id)).rejects.toMatchObject({ code: 'CHECKPOINT_INVALID' });
    expect(await fs.readFile(path.join(recordPath(saved), filename), 'utf8')).toBe('preserve unrelated data');
    expect(await fs.readFile(intentPath(saved))).toEqual(proof);
  });

  it('does not delete an ownerless empty directory without an authenticated intent', async () => {
    const saved = await capture();
    const unknown = path.join(path.dirname(recordPath(saved)), `gcp_${'f'.repeat(32)}`);
    await fs.mkdir(unknown);
    await restart();
    await expect(service.cleanupWorkspace(workspace.id)).rejects.toMatchObject({ code: 'CHECKPOINT_INVALID' });
    expect(await fs.readdir(unknown)).toEqual([]);
    expect((await service.read(saved)).id).toBe(saved.id);
  });

  it('refuses a checkpoint directory alias while preserving the target and signed proof', async () => {
    const saved = await capture();
    await interruptedCleanup(saved, 'after-owner-unlink');
    await fs.rmdir(recordPath(saved));
    const outside = path.join(root, 'unrelated-target');
    await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'keep.txt'), 'keep this');
    await fs.symlink(outside, recordPath(saved));
    await restart();
    await expect(service.cleanupWorkspace(workspace.id)).rejects.toMatchObject({ code: 'CHECKPOINT_UNSAFE_PATH' });
    expect(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8')).toBe('keep this');
    expect((await fs.lstat(recordPath(saved))).isSymbolicLink()).toBe(true);
    expect(await fs.lstat(intentPath(saved))).toMatchObject({ nlink: 1 });
  });

  it('refuses intent aliases and unknown payload before deleting any record files', async () => {
    const saved = await capture();
    const manifest = await fs.readFile(path.join(recordPath(saved), 'manifest.json'));
    const notes = path.join(recordPath(saved), 'personal-notes.txt');
    await fs.writeFile(notes, 'not owned checkpoint data');
    await expect(service.cleanupThread(workspace.id, saved.threadId)).rejects.toMatchObject({ code: 'CHECKPOINT_INVALID' });
    expect(await fs.readFile(notes, 'utf8')).toBe('not owned checkpoint data');
    expect(await fs.readFile(path.join(recordPath(saved), 'manifest.json'))).toEqual(manifest);
    const proof = await fs.readFile(intentPath(saved));
    const outside = path.join(root, 'intent-copy'); await fs.writeFile(outside, proof);
    await fs.unlink(intentPath(saved)); await fs.symlink(outside, intentPath(saved));
    await restart();
    await expect(service.cleanupWorkspace(workspace.id)).rejects.toMatchObject({ code: 'CHECKPOINT_UNSAFE_PATH' });
    expect(await fs.readFile(outside)).toEqual(proof);
    expect(await fs.readFile(path.join(recordPath(saved), 'manifest.json'))).toEqual(manifest);
  });

  it('rejects a hard-linked payload leaf instead of treating it as exclusively owned data', async () => {
    const saved = await capture();
    const head = path.join(recordPath(saved), 'HEAD'), outside = path.join(root, 'linked-head');
    await fs.link(head, outside);
    await expect(service.cleanupThread(workspace.id, saved.threadId)).rejects.toMatchObject({ code: 'CHECKPOINT_UNSAFE_PATH' });
    expect(await fs.readFile(outside, 'utf8')).toBe(`${saved.commit}\n`);
    expect(await fs.readFile(head, 'utf8')).toBe(`${saved.commit}\n`);
    expect(await fs.lstat(path.join(recordPath(saved), 'owner.json'))).toMatchObject({ nlink: 1 });
  });

  it('uses the same external proof for interrupted discard and its retry', async () => {
    const saved = await capture();
    const directory = await CheckpointDirectory.absolute(recordPath(saved));
    const fault = interruptAt(saved, 'after-rmdir');
    try {
      try { await expect(new CheckpointStore({ config: ctx.config }, { ...CHECKPOINT_LIMITS }).discard(directory)).rejects.toMatchObject({ code: 'EIO' }); }
      finally { fault.restore(); }
      expect(fault.happened()).toBe(true);
      await expect(fs.lstat(recordPath(saved))).rejects.toMatchObject({ code: 'ENOENT' });
      await restart();
      await new CheckpointStore({ config: ctx.config }, { ...CHECKPOINT_LIMITS }).discard(directory);
      await expect(fs.lstat(intentPath(saved))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await directory.close(); }
  });
});
