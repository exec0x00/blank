import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';
import { FileRewindTransaction, FILE_REWIND_LIMITS, listFileRewindTransactions,
  type FileRewindPathPlan, type FileRewindTransactionOptions, type FileRewindTransactionPlan } from '../server/agent/file-rewind-transaction';
import { RewindDirectory, hashBytes, observeRewindPath } from '../server/agent/file-rewind-transaction-io';
import type { GitCheckpointFile, GitCheckpointIndex, GitCheckpointRepository } from '../server/git-checkpoints/types';

const execute = promisify(execFile);
const checks = { check: async () => undefined };
let temporary: string;
let root: string;
let state: string;
let repository: GitCheckpointRepository;
let transactions: FileRewindTransaction[];

async function identity(absolute: string) { const stat = await fs.lstat(absolute); return { dev: stat.dev, ino: stat.ino }; }
async function inspect(relative: string): Promise<GitCheckpointFile> {
  const directory = await RewindDirectory.open(root);
  try { return (await observeRewindPath(directory, relative, checks)).state; }
  finally { await directory.close(); }
}
function desired(relative: string, bytes: Buffer | null, kind: 'file' | 'symlink' = 'file', mode = kind === 'symlink' ? 0o777 : 0o644): GitCheckpointFile {
  return bytes === null ? { path: relative, kind: 'missing', bytes: 0, mode: 0, sha256: null, blob: null, tracked: false }
    : { path: relative, kind, bytes: bytes.length, mode, sha256: hashBytes(bytes), blob: null, tracked: true };
}
async function restore(relative: string, bytes: Buffer | string | null, kind: 'file' | 'symlink' = 'file', mode?: number): Promise<FileRewindPathPlan> {
  const buffer = typeof bytes === 'string' ? Buffer.from(bytes) : bytes;
  return { expected: await inspect(relative), restore: desired(relative, buffer, kind, mode), readRestore: async () => buffer ?? Buffer.alloc(0) };
}
function transaction(options: Partial<FileRewindTransactionOptions> = {}): FileRewindTransaction {
  const item = new FileRewindTransaction({ directory: path.join(state, 'file-rewinds'), checkAllowed: async () => undefined, ...options });
  transactions.push(item); return item;
}
function plan(files: FileRewindPathPlan[], extra: Partial<FileRewindTransactionPlan> = {}): FileRewindTransactionPlan {
  return { workspaceId: 'workspace-a', threadId: 'thread-a', repository, files, ...extra };
}
function indexState(bytes: Buffer | null): GitCheckpointIndex {
  return { present: bytes !== null, sha256: bytes === null ? null : hashBytes(bytes), bytes: bytes?.length ?? 0, blob: null,
    format: bytes === null ? null : 2, extensions: [], entries: [] };
}
function emptyIndex(algorithm: 'sha1' | 'sha256' = 'sha1'): Buffer {
  const bytes = Buffer.alloc(12); bytes.write('DIRC'); bytes.writeUInt32BE(2, 4);
  return Buffer.concat([bytes, createHash(algorithm).update(bytes).digest()]);
}
async function absent(absolute: string): Promise<boolean> {
  try { await fs.lstat(absolute); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true; throw error; }
}
async function git(...args: string[]): Promise<string> {
  return (await execute('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'user.name=Rewind Test',
    '-c', 'user.email=rewind@example.invalid', ...args], { cwd: root, timeout: 15_000, maxBuffer: 2 * 1024 * 1024,
    env: { PATH: process.env.PATH, HOME: temporary, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1' } })).stdout.trim();
}
async function onEvent(type: string, work: () => Promise<void>): Promise<FileRewindTransactionOptions['verifyDurable']> {
  let fired = false;
  return async receipts => {
    for (const receipt of receipts) {
      if (!receipt.absolute.includes(`${path.sep}events${path.sep}`)) continue;
      const event = JSON.parse(await fs.readFile(receipt.absolute, 'utf8')) as { type: string };
      if (!fired && event.type === type) { fired = true; await work(); }
    }
  };
}

beforeEach(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-file-rewind-transaction-'));
  root = path.join(temporary, 'workspace'); state = path.join(temporary, 'state'); transactions = [];
  await fs.mkdir(path.join(root, '.git', 'objects'), { recursive: true }); await fs.mkdir(state);
  repository = { root, gitDirectory: path.join(root, '.git'), commonDirectory: path.join(root, '.git'),
    rootIdentity: await identity(root), gitIdentity: await identity(path.join(root, '.git')),
    commonIdentity: await identity(path.join(root, '.git')), objectFormat: 'sha1', head: null, headRef: 'refs/heads/main',
    generation: { version: 1, repository: 'repository_' + 'a'.repeat(32), checkout: 'checkout_' + 'b'.repeat(32),
      workspaceId: 'workspace-a', workspaceCreatedAt: '2026-09-20T00:00:00.000Z',
      repositoryWorkspaceId: 'workspace-a', repositoryWorkspaceCreatedAt: '2026-09-20T00:00:00.000Z', worktreeId: null },
    observedIn: 'boot_' + 'c'.repeat(32) };
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const item of transactions) await item.close().catch(() => undefined);
  await fs.rm(temporary, { recursive: true, force: true });
});

describe('guarded file rewind transaction', () => {
  it('durably stages original and desired binary bytes before mutation, restores mode and retains recovery data on commit', async () => {
    const current = Buffer.from([0, 255, 91, 42, 0, 19]), previous = Buffer.from([0, 128, 1, 17, 255]);
    await fs.writeFile(path.join(root, 'binary.bin'), current, { mode: 0o640 });
    const receipts: string[] = [];
    const item = transaction({ verifyDurable: async values => {
      for (const receipt of values) { const bytes = await fs.readFile(receipt.absolute); expect(bytes.length).toBe(receipt.size); expect(hashBytes(bytes)).toBe(receipt.sha256); receipts.push(receipt.absolute); }
    } });
    const prepared = await item.prepare(plan([await restore('binary.bin', previous, 'file', 0o755)]));
    const directory = path.join(state, 'file-rewinds', prepared.id);
    expect(await fs.readFile(path.join(root, 'binary.bin'))).toEqual(current);
    expect(await fs.readFile(path.join(directory, 'before', '000000'))).toEqual(current);
    expect(await fs.readFile(path.join(directory, 'after', '000000'))).toEqual(previous);
    expect(receipts).toContain(path.join(directory, 'manifest.json'));
    expect((await item.apply()).state).toBe('applied');
    expect(await fs.readFile(path.join(root, 'binary.bin'))).toEqual(previous);
    expect((await fs.lstat(path.join(root, 'binary.bin'))).mode & 0o777).toBe(0o755);
    expect((await item.commit()).state).toBe('complete');
    expect(await fs.readFile(path.join(directory, 'parked', '000000'))).toEqual(current);
    expect(await absent(path.join(root, '.git', 'index.lock'))).toBe(true);
    expect((await listFileRewindTransactions(path.join(state, 'file-rewinds')))[0]).toMatchObject({ id: prepared.id, state: 'complete', appliedPaths: ['binary.bin'], backupsRetained: true, automaticRecovery: false });
  });

  it('restores deleted files, removes agent-created files, and leaves unrelated untracked data alone', async () => {
    await fs.writeFile(path.join(root, 'created.txt'), 'agent-created');
    await fs.writeFile(path.join(root, 'manual.txt'), 'unrelated user bytes');
    const item = transaction();
    await item.prepare(plan([await restore('nested/deleted.txt', 'earlier\n'), await restore('created.txt', null)]));
    await item.apply(); await item.commit();
    expect(await fs.readFile(path.join(root, 'nested/deleted.txt'), 'utf8')).toBe('earlier\n');
    expect(await absent(path.join(root, 'created.txt'))).toBe(true);
    expect(await fs.readFile(path.join(root, 'manual.txt'), 'utf8')).toBe('unrelated user bytes');
  });

  it('restores symlink targets without following or editing an outside target', async () => {
    const outside = path.join(temporary, 'outside-secret'); await fs.writeFile(outside, 'keep outside');
    await fs.writeFile(path.join(root, 'link'), 'agent replaced link');
    const item = transaction();
    await item.prepare(plan([await restore('link', Buffer.from(outside), 'symlink')]));
    await item.apply(); await item.commit();
    expect((await fs.lstat(path.join(root, 'link'))).isSymbolicLink()).toBe(true);
    expect(await fs.readlink(path.join(root, 'link'))).toBe(outside);
    expect(await fs.readFile(outside, 'utf8')).toBe('keep outside');
  });

  it('does not alter an unknown hard-linked alias when restoring one planned name', async () => {
    await fs.writeFile(path.join(root, 'changed'), 'current'); await fs.link(path.join(root, 'changed'), path.join(root, 'unplanned-alias'));
    const item = transaction(); await item.prepare(plan([await restore('changed', 'earlier')])); await item.apply(); await item.commit();
    expect(await fs.readFile(path.join(root, 'changed'), 'utf8')).toBe('earlier');
    expect(await fs.readFile(path.join(root, 'unplanned-alias'), 'utf8')).toBe('current');
  });

  it('rejects later edits before any workspace mutation', async () => {
    await fs.writeFile(path.join(root, 'code.txt'), 'agent version'); const file = await restore('code.txt', 'older');
    await fs.writeFile(path.join(root, 'code.txt'), 'manual newer version');
    const item = transaction(); await expect(item.prepare(plan([file]))).rejects.toMatchObject({ code: 'FILE_REWIND_RECOVERY_REQUIRED' });
    expect(await fs.readFile(path.join(root, 'code.txt'), 'utf8')).toBe('manual newer version');
    expect(await absent(path.join(root, '.git', 'index.lock'))).toBe(true);
    const statuses = await listFileRewindTransactions(path.join(state, 'file-rewinds'));
    expect(statuses[0]).toMatchObject({ state: 'recovery_required', paths: ['code.txt'], automaticRecovery: false });
  });

  it('rejects a same-byte replacement with a different inode and a changed executable mode', async () => {
    await fs.writeFile(path.join(root, 'code.txt'), 'same'); const file = await restore('code.txt', 'older');
    await fs.rename(path.join(root, 'code.txt'), path.join(root, 'kept-old-inode')); await fs.writeFile(path.join(root, 'code.txt'), 'same');
    await expect(transaction().prepare(plan([file]))).rejects.toMatchObject({ originalCode: 'FILE_REWIND_CONFLICT' });
    const changedMode = await restore('code.txt', 'older'); await fs.chmod(path.join(root, 'code.txt'), 0o755);
    await expect(transaction().prepare(plan([changedMode]))).rejects.toMatchObject({ originalCode: 'FILE_REWIND_CONFLICT' });
    expect(await fs.readFile(path.join(root, 'code.txt'), 'utf8')).toBe('same');
    expect((await fs.lstat(path.join(root, 'code.txt'))).mode & 0o777).toBe(0o755);
  });

  it('rejects traversal, .git writes, parent/child conflicts, and unsupported special paths before preparing', async () => {
    for (const relative of ['../outside', '.git/config', 'a/../b', '/absolute', 'a\\b']) {
      const file: FileRewindPathPlan = { expected: desired(relative, null), restore: desired(relative, Buffer.from('x')), readRestore: async () => Buffer.from('x') };
      await expect(transaction().prepare(plan([file]))).rejects.toMatchObject({ code: 'FILE_REWIND_UNSAFE_PATH' });
    }
    const files = ['a', 'a-b', 'a/child'].map(relative => ({ expected: desired(relative, null), restore: desired(relative, Buffer.from('x')), readRestore: async () => Buffer.from('x') }));
    await expect(transaction().prepare(plan(files))).rejects.toMatchObject({ code: 'FILE_REWIND_UNSAFE_PATH' });
    expect(await absent(path.join(state, 'file-rewinds'))).toBe(true);
  });

  it('rejects a symlink ancestor instead of restoring outside the checkout', async () => {
    const outside = path.join(temporary, 'outside'); await fs.mkdir(outside); await fs.symlink(outside, path.join(root, 'escape'));
    const file: FileRewindPathPlan = { expected: desired('escape/new', null), restore: desired('escape/new', Buffer.from('x')), readRestore: async () => Buffer.from('x') };
    await expect(transaction().prepare(plan([file]))).rejects.toMatchObject({ originalCode: 'FILE_REWIND_UNSAFE_PATH' });
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it('requires real receipt adapters on persistent storage and keeps originals when receipt verification fails', async () => {
    expect(() => transaction({ requireDurableReceipt: true })).toThrow('verified durable storage');
    await fs.writeFile(path.join(root, 'code.txt'), 'current'); const file = await restore('code.txt', 'earlier');
    const rename = vi.spyOn(fs, 'rename');
    const item = transaction({ requireDurableReceipt: true, verifyAbsent: async () => undefined, verifyDurable: async () => { throw new Error('public storage pending'); } });
    await expect(item.prepare(plan([file]))).rejects.toMatchObject({ code: 'FILE_REWIND_RECOVERY_REQUIRED' });
    expect(rename).not.toHaveBeenCalled(); expect(await fs.readFile(path.join(root, 'code.txt'), 'utf8')).toBe('current');
    expect(() => transaction({ requireDurableReceipt: true, verifyDurable: async () => undefined }))
      .toThrow('deletion receipts');
  });

  it('revalidates all files after the durable preparation barrier', async () => {
    await fs.writeFile(path.join(root, 'code.txt'), 'current');
    const item = transaction({ verifyDurable: async receipts => {
      if (receipts.some(receipt => receipt.absolute.endsWith('/manifest.json'))) await fs.writeFile(path.join(root, 'code.txt'), 'late manual edit');
    } });
    await expect(item.prepare(plan([await restore('code.txt', 'old')]))).rejects.toMatchObject({ originalCode: 'FILE_REWIND_CONFLICT' });
    expect(await fs.readFile(path.join(root, 'code.txt'), 'utf8')).toBe('late manual edit');
  });

  it('refuses a preexisting Git lock and never deletes its owner data', async () => {
    await fs.writeFile(path.join(root, 'code.txt'), 'current'); const item = transaction(); await item.prepare(plan([await restore('code.txt', 'old')]));
    await fs.writeFile(path.join(root, '.git', 'index.lock'), 'another git operation');
    await expect(item.apply()).rejects.toMatchObject({ originalCode: 'FILE_REWIND_GIT_LOCKED', transaction: { state: 'rolled_back' } });
    expect(await fs.readFile(path.join(root, '.git', 'index.lock'), 'utf8')).toBe('another git operation');
    expect(await fs.readFile(path.join(root, 'code.txt'), 'utf8')).toBe('current');
  });

  it('rejects a changed index before any file restore and preserves its current staging', async () => {
    const original = emptyIndex(); await fs.writeFile(path.join(root, '.git', 'index'), original); await fs.writeFile(path.join(root, 'code.txt'), 'current');
    const item = transaction(); await item.prepare(plan([await restore('code.txt', 'old')], { index: { expected: indexState(original), restore: null } }));
    await fs.writeFile(path.join(root, '.git', 'index'), 'new manual index bytes');
    await expect(item.apply()).rejects.toMatchObject({ transaction: { state: 'rolled_back' } });
    expect(await fs.readFile(path.join(root, '.git', 'index'), 'utf8')).toBe('new manual index bytes');
    expect(await fs.readFile(path.join(root, 'code.txt'), 'utf8')).toBe('current');
  });

  it('rolls back only its exact writes after a later step fails', async () => {
    await fs.writeFile(path.join(root, 'first'), 'first-current'); await fs.writeFile(path.join(root, 'second'), 'second-current');
    const item = transaction({ verifyDurable: await onEvent('path_applied', async () => { await fs.writeFile(path.join(root, 'second'), 'manual-second'); }) });
    await item.prepare(plan([await restore('first', 'first-old'), await restore('second', 'second-old')]));
    await expect(item.apply()).rejects.toMatchObject({ transaction: { state: 'rolled_back' } });
    expect(await fs.readFile(path.join(root, 'first'), 'utf8')).toBe('first-current');
    expect(await fs.readFile(path.join(root, 'second'), 'utf8')).toBe('manual-second');
    expect(await absent(path.join(root, '.git', 'index.lock'))).toBe(true);
  });

  it('keeps edits to already-applied paths and reports recovery instead of undoing them', async () => {
    await fs.writeFile(path.join(root, 'first'), 'first-current');
    const item = transaction({ verifyDurable: await onEvent('path_applied', async () => {
      await fs.writeFile(path.join(root, 'first'), 'new manual edit'); throw new Error('transport failed');
    }) });
    const prepared = await item.prepare(plan([await restore('first', 'first-old')]));
    await expect(item.apply()).rejects.toMatchObject({ transaction: { state: 'recovery_required' } });
    expect(await fs.readFile(path.join(root, 'first'), 'utf8')).toBe('new manual edit');
    expect(await fs.readFile(path.join(state, 'file-rewinds', prepared.id, 'before', '000000'), 'utf8')).toBe('first-current');
    expect(await absent(path.join(root, '.git', 'index.lock'))).toBe(true);
  });

  it('never overwrites a new destination claim between parking and installation', async () => {
    await fs.writeFile(path.join(root, 'code.txt'), 'current');
    const item = transaction({ verifyDurable: await onEvent('parked', async () => { await fs.writeFile(path.join(root, 'code.txt'), 'claimed by user', { flag: 'wx' }); }) });
    const prepared = await item.prepare(plan([await restore('code.txt', 'old')]));
    await expect(item.apply()).rejects.toMatchObject({ transaction: { state: 'recovery_required' } });
    expect(await fs.readFile(path.join(root, 'code.txt'), 'utf8')).toBe('claimed by user');
    expect(await fs.readFile(path.join(state, 'file-rewinds', prepared.id, 'parked', '000000'), 'utf8')).toBe('current');
  });

  it('retains a last-syscall concurrent replacement in parking and never silently deletes it', async () => {
    await fs.writeFile(path.join(root, 'code.txt'), 'current'); const item = transaction();
    const prepared = await item.prepare(plan([await restore('code.txt', 'old')]));
    const realRename = fs.rename.bind(fs); let changed = false;
    vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
      if (!changed && String(destination).endsWith('/000000')) { changed = true; await fs.writeFile(source, 'last-instant manual edit'); }
      return realRename(source, destination);
    });
    await expect(item.apply()).rejects.toMatchObject({ transaction: { state: 'recovery_required' } });
    expect(await fs.readFile(path.join(state, 'file-rewinds', prepared.id, 'parked', '000000'), 'utf8')).toBe('last-instant manual edit');
    expect(await fs.readFile(path.join(state, 'file-rewinds', prepared.id, 'before', '000000'), 'utf8')).toBe('current');
  });

  it('rejects a replaced checkout root without writing into its replacement', async () => {
    await fs.writeFile(path.join(root, 'code.txt'), 'current'); const item = transaction(); await item.prepare(plan([await restore('code.txt', 'old')]));
    const originalRoot = `${root}-original`; await fs.rename(root, originalRoot); await fs.mkdir(root); await fs.writeFile(path.join(root, 'code.txt'), 'replacement root');
    await expect(item.apply()).rejects.toMatchObject({ transaction: { state: 'rolled_back' } });
    expect(await fs.readFile(path.join(root, 'code.txt'), 'utf8')).toBe('replacement root');
    expect(await fs.readFile(path.join(originalRoot, 'code.txt'), 'utf8')).toBe('current');
  });

  it('restores the original index and exact file bytes when the conversation update must be rolled back', async () => {
    const current = emptyIndex(); await fs.writeFile(path.join(root, '.git', 'index'), current); await fs.writeFile(path.join(root, 'code.txt'), 'current');
    const item = transaction(); await item.prepare(plan([await restore('code.txt', 'old')], { index: { expected: indexState(current), restore: null } }));
    await item.apply(); expect(await absent(path.join(root, '.git', 'index'))).toBe(true);
    expect((await item.rollback()).state).toBe('rolled_back');
    expect(await fs.readFile(path.join(root, '.git', 'index'))).toEqual(current);
    expect(await fs.readFile(path.join(root, 'code.txt'), 'utf8')).toBe('current');
    expect(await absent(path.join(root, '.git', 'index.lock'))).toBe(true);
  });

  it('removes only its empty new directories on rollback and preserves new manual children', async () => {
    const item = transaction(); await item.prepare(plan([await restore('new/deep/file', 'old')])); await item.apply();
    await fs.writeFile(path.join(root, 'new', 'manual'), 'keep'); await item.rollback();
    expect(await absent(path.join(root, 'new', 'deep'))).toBe(true);
    expect(await fs.readFile(path.join(root, 'new', 'manual'), 'utf8')).toBe('keep');
  });

  it('reports unfinished applied state after descriptors close without replaying files or releasing an unknown lock', async () => {
    await fs.writeFile(path.join(root, 'code.txt'), 'current'); const item = transaction(); const prepared = await item.prepare(plan([await restore('code.txt', 'old')])); await item.apply(); await item.close();
    const before = await fs.readFile(path.join(root, 'code.txt'));
    const status = await listFileRewindTransactions(path.join(state, 'file-rewinds'), { workspaceId: 'workspace-a', threadId: 'thread-a' });
    expect(status[0]).toMatchObject({ id: prepared.id, state: 'applied', automaticRecovery: false });
    expect(await fs.readFile(path.join(root, 'code.txt'))).toEqual(before);
    expect(await absent(path.join(root, '.git', 'index.lock'))).toBe(false);
    expect(await listFileRewindTransactions(path.join(state, 'file-rewinds'), { threadId: 'different' })).toEqual([]);
  });

  it('treats repeated transaction ids as conflicts and never replays a lost response', async () => {
    await fs.writeFile(path.join(root, 'code.txt'), 'current'); const id = randomUUID();
    const first = transaction(); await first.prepare(plan([await restore('code.txt', 'old')], { id }));
    await expect(transaction().prepare(plan([await restore('code.txt', 'other')], { id }))).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await fs.readFile(path.join(root, 'code.txt'), 'utf8')).toBe('current');
    expect((await listFileRewindTransactions(path.join(state, 'file-rewinds')))[0].id).toBe(id);
  });

  it('rejects oversized plans and checkpoint hash mismatches before moving files', async () => {
    const oversized = desired('large', Buffer.from('x')); oversized.bytes = FILE_REWIND_LIMITS.fileBytes + 1;
    await expect(transaction().prepare(plan([{ expected: desired('large', null), restore: oversized, readRestore: async () => Buffer.from('x') }])))
      .rejects.toMatchObject({ code: 'FILE_REWIND_LIMIT' });
    await fs.writeFile(path.join(root, 'code.txt'), 'current'); const file = await restore('code.txt', 'old'); file.readRestore = async () => Buffer.from('tampered');
    await expect(transaction().prepare(plan([file]))).rejects.toMatchObject({ originalCode: 'FILE_REWIND_CONFLICT' });
    expect(await fs.readFile(path.join(root, 'code.txt'), 'utf8')).toBe('current');
  });

  it('verifies persistent absence after a deletion and retains its durable original', async () => {
    await fs.writeFile(path.join(root, 'created.txt'), 'current'); const deleted: string[] = [];
    const item = transaction({ requireDurableReceipt: true, verifyDurable: async () => undefined, verifyAbsent: async paths => { for (const value of paths) { expect(await absent(value)).toBe(true); deleted.push(value); } } });
    const prepared = await item.prepare(plan([await restore('created.txt', null)])); await item.apply(); await item.commit();
    expect(deleted).toEqual([path.join(root, 'created.txt'), path.join(root, '.git', 'index.lock')]);
    expect(await fs.readFile(path.join(state, 'file-rewinds', prepared.id, 'before', '000000'), 'utf8')).toBe('current');
  });

  it('preserves the real Git HEAD and unrelated staging while restoring a missing historical object and selective index', async () => {
    await git('init', '-b', 'main');
    await fs.writeFile(path.join(root, 'agent.txt'), 'base agent\n'); await fs.writeFile(path.join(root, 'manual.txt'), 'base manual\n');
    await git('add', 'agent.txt', 'manual.txt'); await git('commit', '-m', 'baseline');
    const head = await git('rev-parse', 'HEAD');
    await fs.writeFile(path.join(root, 'agent.txt'), 'historical staged agent\n'); await fs.writeFile(path.join(root, 'manual.txt'), 'manual staged bytes\n'); await git('add', 'agent.txt', 'manual.txt');
    const desiredIndex = await fs.readFile(path.join(root, '.git', 'index'));
    const objectId = (await git('ls-files', '--stage', '--', 'agent.txt')).split(/\s+/)[1];
    await fs.writeFile(path.join(root, 'agent.txt'), 'new agent version\n'); await git('add', 'agent.txt');
    const currentIndex = await fs.readFile(path.join(root, '.git', 'index'));
    await fs.unlink(path.join(root, '.git', 'objects', objectId.slice(0, 2), objectId.slice(2)));
    repository.head = head;
    const item = transaction(); await item.prepare(plan([await restore('agent.txt', 'historical staged agent\n')], {
      index: { expected: indexState(currentIndex), restore: desiredIndex, objects: [{ objectId, bytes: Buffer.from('historical staged agent\n') }] },
    }));
    await item.apply(); await item.commit();
    expect(await git('rev-parse', 'HEAD')).toBe(head); expect(await git('symbolic-ref', 'HEAD')).toBe('refs/heads/main');
    expect(await fs.readFile(path.join(root, '.git', 'index'))).toEqual(desiredIndex);
    expect(await git('show', ':manual.txt')).toBe('manual staged bytes');
    expect(await git('show', ':agent.txt')).toBe('historical staged agent');
    expect(await fs.readFile(path.join(root, 'manual.txt'), 'utf8')).toBe('manual staged bytes\n');
  });

  it('rejects a corrupt existing Git object instead of overwriting it or installing its index', async () => {
    const bytes = Buffer.from('historical'); const oid = createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
    await fs.mkdir(path.join(root, '.git', 'objects', oid.slice(0, 2))); const objectPath = path.join(root, '.git', 'objects', oid.slice(0, 2), oid.slice(2));
    await fs.writeFile(objectPath, 'manual object corruption');
    await fs.writeFile(path.join(root, 'code.txt'), 'current');
    const item = transaction(); await item.prepare(plan([await restore('code.txt', 'old')], { index: { expected: indexState(null), restore: emptyIndex(), objects: [{ objectId: oid, bytes }] } }));
    await expect(item.apply()).rejects.toMatchObject({ transaction: { state: 'rolled_back' } });
    expect(await fs.readFile(objectPath, 'utf8')).toBe('manual object corruption');
    expect(await fs.readFile(path.join(root, 'code.txt'), 'utf8')).toBe('current');
    expect(await absent(path.join(root, '.git', 'index'))).toBe(true);
  });

  it('requires native metadata proof for either symlink side and for unchanged nondefault file permissions', async () => {
    await fs.writeFile(path.join(root, 'code.txt'), 'current', { mode: 0o755 });
    const options = { requireDurableReceipt: true, verifyDurable: async () => undefined, verifyAbsent: async () => undefined };
    await expect(transaction(options).prepare(plan([await restore('code.txt', 'old', 'file', 0o755)])))
      .rejects.toMatchObject({ code: 'FILE_REWIND_METADATA_REQUIRED' });
    await fs.symlink('../outside', path.join(root, 'link'));
    await expect(transaction(options).prepare(plan([await restore('link', 'regular replacement')])))
      .rejects.toMatchObject({ code: 'FILE_REWIND_METADATA_REQUIRED' });
    expect(await absent(path.join(state, 'file-rewinds'))).toBe(true);
    const index = emptyIndex(); await fs.writeFile(path.join(root, '.git', 'index'), index, { mode: 0o600 });
    await expect(transaction(options).prepare(plan([], { index: { expected: indexState(index), restore: null } })))
      .rejects.toMatchObject({ originalCode: 'FILE_REWIND_METADATA_REQUIRED' });
    expect(await fs.readFile(path.join(root, '.git', 'index'))).toEqual(index);
  });

  it('checks actual native metadata after apply and after a guarded rollback', async () => {
    await fs.writeFile(path.join(root, 'link'), 'current', { mode: 0o640 });
    const kinds: string[][] = [];
    const item = transaction({ requireDurableReceipt: true, verifyDurable: async () => undefined, verifyAbsent: async () => undefined,
      verifyMetadata: async entries => {
        kinds.push(entries.map(entry => entry.kind));
        for (const entry of entries) {
          const current = await fs.lstat(entry.absolute);
          expect(current.mode & 0o777).toBe(entry.mode);
          if (entry.kind === 'symlink') expect((await fs.readlink(entry.absolute, { encoding: 'buffer' })).toString('base64')).toBe(entry.linkTargetBase64);
        }
      },
    });
    await item.prepare(plan([await restore('link', 'relative-target', 'symlink')])); await item.apply(); await item.rollback();
    expect(kinds).toEqual([['symlink'], ['file']]);
    expect(await fs.readFile(path.join(root, 'link'), 'utf8')).toBe('current');
    expect((await fs.lstat(path.join(root, 'link'))).mode & 0o777).toBe(0o640);
  });

  it('keeps a failed index-lock initialization visible as recovery instead of reporting a clean rollback', async () => {
    await fs.writeFile(path.join(root, 'code.txt'), 'current'); const item = transaction(); await item.prepare(plan([await restore('code.txt', 'old')]));
    const realOpen = fs.open.bind(fs); let injected = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await realOpen(...args);
      if (!injected && String(args[0]).endsWith('/index.lock')) {
        injected = true;
        vi.spyOn(handle, 'writeFile').mockRejectedValueOnce(Object.assign(new Error('lock write failed'), { code: 'EIO' }));
      }
      return handle;
    });
    await expect(item.apply()).rejects.toMatchObject({ transaction: { state: 'recovery_required' } });
    expect(item.status().issues.join(' ')).toContain('index lock was created');
    expect(await absent(path.join(root, '.git', 'index.lock'))).toBe(false);
    expect(await fs.readFile(path.join(root, 'code.txt'), 'utf8')).toBe('current');
  });

  it('cannot retry rollback after releasing ownership for a durable conversation commit', async () => {
    await fs.writeFile(path.join(root, 'code.txt'), 'current');
    const item = transaction({ verifyDurable: await onEvent('complete', async () => { throw new Error('completion receipt pending'); }) });
    await item.prepare(plan([await restore('code.txt', 'old')])); await item.apply();
    await expect(item.commit()).rejects.toMatchObject({ transaction: { state: 'recovery_required' } });
    expect(await absent(path.join(root, '.git', 'index.lock'))).toBe(true);
    await fs.writeFile(path.join(root, '.git', 'index.lock'), 'different owner');
    await expect(item.rollback()).rejects.toMatchObject({ code: 'FILE_REWIND_STATE' });
    expect(await fs.readFile(path.join(root, 'code.txt'), 'utf8')).toBe('old');
    expect(await fs.readFile(path.join(root, '.git', 'index.lock'), 'utf8')).toBe('different owner');
  });

  it('rejects a changed index-lock identity and preserves its new owner during commit and close', async () => {
    await fs.writeFile(path.join(root, 'code.txt'), 'current'); const item = transaction(); await item.prepare(plan([await restore('code.txt', 'old')])); await item.apply();
    await fs.rename(path.join(root, '.git', 'index.lock'), path.join(root, '.git', 'old-rewind-lock'));
    await fs.writeFile(path.join(root, '.git', 'index.lock'), 'new owner');
    await expect(item.commit()).rejects.toMatchObject({ transaction: { state: 'recovery_required' } }); await item.close();
    expect(await fs.readFile(path.join(root, '.git', 'index.lock'), 'utf8')).toBe('new owner');
  });

  it('fails safely before file/index changes when native object publication has no no-overwrite primitive', async () => {
    const bytes = Buffer.from('historical'); const oid = createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
    await fs.writeFile(path.join(root, 'code.txt'), 'current'); const item = transaction();
    await item.prepare(plan([await restore('code.txt', 'old')], { index: { expected: indexState(null), restore: emptyIndex(), objects: [{ objectId: oid, bytes }] } }));
    vi.spyOn(fs, 'link').mockRejectedValue(Object.assign(new Error('hard links unavailable'), { code: 'EOPNOTSUPP' }));
    await expect(item.apply()).rejects.toMatchObject({ originalCode: 'FILE_REWIND_OBJECT_STORAGE', transaction: { state: 'rolled_back' } });
    expect(await fs.readFile(path.join(root, 'code.txt'), 'utf8')).toBe('current');
    expect(await absent(path.join(root, '.git', 'index'))).toBe(true);
    expect(await absent(path.join(root, '.git', 'objects', oid.slice(0, 2), oid.slice(2)))).toBe(true);
    expect(await absent(path.join(root, '.git', 'index.lock'))).toBe(true);
  });

  it('accepts an identical Git blob published concurrently with a different valid zlib representation', async () => {
    const bytes = Buffer.from('historical staged bytes '.repeat(100)); const raw = Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]);
    const oid = createHash('sha1').update(raw).digest('hex'); const concurrent = deflateSync(raw, { level: 0 });
    const item = transaction(); await item.prepare(plan([], { index: { expected: indexState(null), restore: emptyIndex(), objects: [{ objectId: oid, bytes }] } }));
    vi.spyOn(fs, 'link').mockImplementation(async (_source, destination) => {
      await fs.writeFile(destination, concurrent, { flag: 'wx', mode: 0o444 });
      throw Object.assign(new Error('concurrent object publisher'), { code: 'EEXIST' });
    });
    await item.apply(); await item.commit();
    expect(await fs.readFile(path.join(root, '.git', 'objects', oid.slice(0, 2), oid.slice(2)))).toEqual(concurrent);
  });

  it('supports SHA-256 object names and Git index checksums without altering references', async () => {
    repository.objectFormat = 'sha256'; const bytes = Buffer.from('sha256 historical bytes');
    const oid = createHash('sha256').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
    const item = transaction(); await item.prepare(plan([], { index: { expected: indexState(null), restore: emptyIndex('sha256'), objects: [{ objectId: oid, bytes }] } }));
    await item.apply(); await item.commit();
    expect(await fs.readFile(path.join(root, '.git', 'index'))).toEqual(emptyIndex('sha256'));
    expect(await absent(path.join(root, '.git', 'refs'))).toBe(true);
    expect(await absent(path.join(root, '.git', 'objects', oid.slice(0, 2), oid.slice(2)))).toBe(false);
  });

  it('does not hide an invalid recovery manifest or silently return a truncated directory scan', async () => {
    await fs.writeFile(path.join(root, 'code.txt'), 'current'); const item = transaction(); const prepared = await item.prepare(plan([await restore('code.txt', 'old')])); await item.close();
    const directory = path.join(state, 'file-rewinds'); const manifest = path.join(directory, prepared.id, 'manifest.json');
    const original = await fs.readFile(manifest); await fs.writeFile(manifest, JSON.stringify({ version: 1, id: 'mismatched' }));
    await expect(listFileRewindTransactions(directory)).rejects.toMatchObject({ code: 'FILE_REWIND_RECOVERY_RECORD' });
    await fs.writeFile(manifest, original);
    // A bounded injected iterator verifies the scan exhaustion branch without
    // creating thousands of scratch directories or additional processes.
    const realOpenDir = fs.opendir.bind(fs);
    vi.spyOn(fs, 'opendir').mockImplementation(async (target, options) => {
      const canonical = await fs.realpath(target);
      if (canonical !== directory) return realOpenDir(target, options);
      return { async *[Symbol.asyncIterator]() {
        for (let index = 0; index < 2_001; index++) yield { name: `other-${index}`, isDirectory: () => false, isSymbolicLink: () => false };
      } } as unknown as Awaited<ReturnType<typeof fs.opendir>>;
    });
    await expect(listFileRewindTransactions(directory)).rejects.toMatchObject({ code: 'FILE_REWIND_RECOVERY_LIMIT' });
  });
});
