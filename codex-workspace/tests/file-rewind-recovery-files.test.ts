import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileRewindTransaction, type FileRewindPathPlan } from '../server/agent/file-rewind-transaction';
import { hashBytes, observeRewindPath, RewindDirectory } from '../server/agent/file-rewind-transaction-io';
import { FILE_REWIND_RECOVERY_LIMITS, inspectFileRewindRecovery,
  type FileRewindRecoveryReadInput } from '../server/agent/file-rewind-recovery-files';
import type { GitCheckpointFile, GitCheckpointRepository } from '../server/git-checkpoints/types';

let temporary: string;
let root: string;
let directory: string;
let repository: GitCheckpointRepository;
let transactions: FileRewindTransaction[];
const checks = { check: async () => undefined };
const bytes = (value: string | Buffer): Buffer => Buffer.isBuffer(value) ? value : Buffer.from(value);
async function identity(absolute: string) { const stat = await fs.lstat(absolute); return { dev: stat.dev, ino: stat.ino }; }
function snapshot(relative: string, value: Buffer | null, kind: 'file' | 'symlink', mode: number): GitCheckpointFile {
  return value === null ? { path: relative, kind: 'missing', mode: 0, bytes: 0, sha256: null, blob: null, tracked: false }
    : { path: relative, kind, mode, bytes: value.length, sha256: hashBytes(value), blob: null, tracked: true };
}
interface Fixture {
  input: FileRewindRecoveryReadInput;
  original: string;
  restored: string;
  manifest: string;
  identity: string;
  location: string;
}
async function fixture(current: string | Buffer | null, restored: string | Buffer | null,
  options: { path?: string; currentKind?: 'file' | 'symlink'; restoredKind?: 'file' | 'symlink'; currentMode?: number; restoredMode?: number } = {}): Promise<Fixture> {
  const relative = options.path ?? 'changed.txt';
  const currentKind = options.currentKind ?? 'file', restoredKind = options.restoredKind ?? 'file';
  if (current !== null) {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    if (currentKind === 'symlink') await fs.symlink(bytes(current), path.join(root, relative));
    else await fs.writeFile(path.join(root, relative), bytes(current), { mode: options.currentMode ?? 0o644 });
  }
  const pinned = await RewindDirectory.open(root);
  let expected: GitCheckpointFile;
  try { expected = (await observeRewindPath(pinned, relative, checks)).state; }
  finally { await pinned.close(); }
  const desiredBytes = restored === null ? null : bytes(restored);
  const transaction = new FileRewindTransaction({ directory, checkAllowed: async () => undefined }); transactions.push(transaction);
  const status = await transaction.prepare({ workspaceId: 'workspace-a', threadId: 'thread-a', repository,
    files: [{ expected, restore: snapshot(relative, desiredBytes, restoredKind, options.restoredMode ?? (restoredKind === 'symlink' ? 0o777 : 0o644)),
      readRestore: async () => desiredBytes ?? Buffer.alloc(0) }] });
  const location = path.join(directory, status.id);
  return { input: { directory, recoveryId: status.id, workspaceId: 'workspace-a', threadId: 'thread-a', path: relative, side: 'original' },
    original: path.join(location, 'before', '000000'), restored: path.join(location, 'after', '000000'),
    manifest: path.join(location, 'manifest.json'), identity: path.join(location, 'identity.json'), location };
}
async function editJSON(absolute: string, edit: (value: any) => void): Promise<void> {
  const value = JSON.parse(await fs.readFile(absolute, 'utf8')); edit(value); await fs.writeFile(absolute, JSON.stringify(value) + '\n');
}

beforeEach(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-file-rewind-recovery-read-'));
  root = path.join(temporary, 'workspace'); directory = path.join(temporary, 'state', 'file-rewinds'); transactions = [];
  await fs.mkdir(path.join(root, '.git', 'objects'), { recursive: true }); await fs.mkdir(path.dirname(directory));
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
  for (const transaction of transactions) await transaction.close().catch(() => undefined);
  await fs.rm(temporary, { recursive: true, force: true });
});

describe('bounded file rewind recovery inspection', () => {
  it('reads each retained side with exact original metadata and no absolute paths', async () => {
    const item = await fixture('agent current bytes\n', 'historical bytes\n', { path: 'nested/changed.txt', currentMode: 0o640, restoredMode: 0o755 });
    const original = await inspectFileRewindRecovery(item.input);
    expect(original).toEqual({ path: 'nested/changed.txt', side: 'original', kind: 'file', mode: 0o640,
      bytes: Buffer.byteLength('agent current bytes\n'), sha256: hashBytes(Buffer.from('agent current bytes\n')),
      binary: false, text: 'agent current bytes\n', totalBytes: Buffer.byteLength('agent current bytes\n'), offset: 0, nextOffset: null });
    const restored = await inspectFileRewindRecovery({ ...item.input, side: 'restored' });
    expect(restored).toMatchObject({ kind: 'file', mode: 0o755, text: 'historical bytes\n', side: 'restored' });
    expect(JSON.stringify(original)).not.toContain(temporary);
    expect(await fs.readFile(path.join(root, 'nested/changed.txt'), 'utf8')).toBe('agent current bytes\n');
  });

  it('returns at most 32 KiB of actual text with byte cursors', async () => {
    const content = '0123456789'.repeat(10_000); const item = await fixture(content, 'older');
    const first = await inspectFileRewindRecovery({ ...item.input, limit: FILE_REWIND_RECOVERY_LIMITS.maxPageBytes });
    expect(first.text).toBe(content.slice(0, 32_768)); expect(first.nextOffset).toBe(32_768);
    const second = await inspectFileRewindRecovery({ ...item.input, offset: first.nextOffset!, limit: 8_192 });
    expect(second.text).toBe(content.slice(32_768, 40_960)); expect(second.nextOffset).toBe(40_960);
    expect(first.totalBytes).toBe(content.length); expect(Buffer.byteLength(first.text!)).toBeLessThanOrEqual(32_768);
  });

  it('keeps split UTF-8 characters intact across stream buffers and requested positions', async () => {
    const content = `${'a'.repeat(65_535)}😀Z`; const item = await fixture(content, 'older');
    const page = await inspectFileRewindRecovery({ ...item.input, offset: 65_536, limit: 4 });
    expect(page).toMatchObject({ binary: false, text: '😀', offset: 65_535, nextOffset: 65_539 });
    expect(await inspectFileRewindRecovery({ ...item.input, offset: page.nextOffset!, limit: 4 })).toMatchObject({ text: 'Z', offset: 65_539, nextOffset: null });
  });

  it('preserves a UTF-8 byte order mark as part of the actual retained text', async () => {
    const item = await fixture('\ufeffactual text', 'historical');
    expect(await inspectFileRewindRecovery(item.input)).toMatchObject({ binary: false, text: '\ufeffactual text', bytes: Buffer.byteLength('\ufeffactual text') });
  });

  it('pages Unicode text without omission or duplication', async () => {
    const content = '😀ab€\r\n'.repeat(1_100); const item = await fixture(content, 'older');
    let offset: number | null = 0, joined = '';
    while (offset !== null) {
      const page = await inspectFileRewindRecovery({ ...item.input, offset, limit: 4_096 });
      expect(Buffer.byteLength(page.text!)).toBeLessThanOrEqual(4_096); joined += page.text; offset = page.nextOffset;
    }
    expect(joined).toBe(content);
  });

  it.each([['NUL', Buffer.from([0])], ['invalid UTF-8', Buffer.from([0xc3])]] as const)('classifies late %s outside the requested page before returning any text', async (_label, suffix) => {
    const value = Buffer.concat([Buffer.from('readable prefix\n'.repeat(8_000)), suffix]); const item = await fixture(value, 'older');
    const result = await inspectFileRewindRecovery({ ...item.input, limit: 1_024 });
    expect(result).toMatchObject({ binary: true, text: null, totalBytes: value.length, nextOffset: null, sha256: hashBytes(value) });
    expect(result).not.toHaveProperty('base64');
  });

  it('stream-verifies the entire snapshot even when an altered tail lies outside the requested page', async () => {
    const value = Buffer.from('text-prefix-'.repeat(20_000)); const item = await fixture(value, 'older');
    const altered = Buffer.from(value); altered[altered.length - 1] = 'Z'.charCodeAt(0); await fs.writeFile(item.original, altered);
    await expect(inspectFileRewindRecovery({ ...item.input, limit: 1_024 })).rejects.toMatchObject({ code: 'FILE_REWIND_RECOVERY_CONFLICT' });
    expect(await fs.readFile(item.original)).toEqual(altered);
  });

  it('shows a retained symlink target without reading its outside target or parked symlink', async () => {
    const outside = path.join(temporary, 'outside-private'); await fs.writeFile(outside, 'do not return these contents');
    const item = await fixture(outside, 'plain restored file', { currentKind: 'symlink' });
    await fs.symlink(outside, path.join(item.location, 'parked', '000000'));
    const result = await inspectFileRewindRecovery(item.input);
    expect(result).toMatchObject({ kind: 'symlink', mode: 0o777, text: outside, binary: false });
    expect(result.text).not.toContain('do not return these contents');
    expect(await fs.readFile(outside, 'utf8')).toBe('do not return these contents');
  });

  it('represents an absent side and an empty ordinary file accurately', async () => {
    const missing = await fixture(null, 'historical');
    expect(await inspectFileRewindRecovery(missing.input)).toMatchObject({ kind: 'missing', mode: 0, bytes: 0, totalBytes: 0, sha256: null, text: '', binary: false, nextOffset: null });
    const empty = await fixture('', '', { path: 'empty.txt' });
    expect(await inspectFileRewindRecovery(empty.input)).toMatchObject({ kind: 'file', bytes: 0, sha256: hashBytes(Buffer.alloc(0)), text: '', nextOffset: null });
  });

  it('handles EOF and rejects invalid or unbounded ranges', async () => {
    const item = await fixture('current', 'historical');
    expect(await inspectFileRewindRecovery({ ...item.input, offset: 7 })).toMatchObject({ text: '', offset: 7, nextOffset: null });
    await expect(inspectFileRewindRecovery({ ...item.input, offset: 8 })).rejects.toMatchObject({ status: 416, code: 'FILE_REWIND_RECOVERY_RANGE' });
    for (const limit of [0, 3, 32_769, Number.POSITIVE_INFINITY]) await expect(inspectFileRewindRecovery({ ...item.input, limit })).rejects.toMatchObject({ status: 400 });
    for (const offset of [-1, 0.5, Number.NaN]) await expect(inspectFileRewindRecovery({ ...item.input, offset })).rejects.toMatchObject({ status: 400 });
    for (const malformed of [null, { ...item.input, offset: null }, { ...item.input, limit: null }, { ...item.input, recoveryId: [item.input.recoveryId] }]) {
      await expect(inspectFileRewindRecovery(malformed as unknown as FileRewindRecoveryReadInput)).rejects.toMatchObject({ status: 400 });
    }
  });

  it('enforces workspace/thread scope in both immutable ownership records', async () => {
    const item = await fixture('current', 'historical');
    await expect(inspectFileRewindRecovery({ ...item.input, threadId: 'another-thread' })).rejects.toMatchObject({ status: 403, code: 'FILE_REWIND_RECOVERY_SCOPE' });
    await expect(inspectFileRewindRecovery({ ...item.input, workspaceId: 'another-workspace' })).rejects.toMatchObject({ status: 403 });
    await editJSON(item.manifest, value => { value.threadId = 'another-thread'; });
    await expect(inspectFileRewindRecovery(item.input)).rejects.toMatchObject({ status: 403 });
  });

  it('rejects traversal, internal paths, and names absent from the original plan', async () => {
    const item = await fixture('current', 'historical');
    for (const relative of ['../outside', '.git/index', '/absolute', 'x\\y', 'a/../changed.txt']) {
      await expect(inspectFileRewindRecovery({ ...item.input, path: relative })).rejects.toMatchObject({ status: 400 });
    }
    await expect(inspectFileRewindRecovery({ ...item.input, path: 'another.txt' })).rejects.toMatchObject({ status: 404 });
  });

  it('rejects a blob receipt pointing outside its fixed snapshot directory', async () => {
    const item = await fixture('current', 'historical'); const outside = path.join(temporary, 'outside'); await fs.writeFile(outside, 'current');
    await editJSON(item.manifest, value => { value.units[0].backup.absolute = outside; });
    await expect(inspectFileRewindRecovery(item.input)).rejects.toMatchObject({ code: 'FILE_REWIND_RECOVERY_CONFLICT' });
    expect(await fs.readFile(outside, 'utf8')).toBe('current');
  });

  it('rejects a changed identity path map or mismatched snapshot receipt', async () => {
    const item = await fixture('current', 'historical');
    await editJSON(item.identity, value => { value.paths = ['different.txt']; });
    await expect(inspectFileRewindRecovery(item.input)).rejects.toMatchObject({ code: 'FILE_REWIND_RECOVERY_CONFLICT' });
    await editJSON(item.identity, value => { value.paths = ['changed.txt']; });
    await editJSON(item.manifest, value => { value.units[0].backup.sha256 = '0'.repeat(64); });
    await expect(inspectFileRewindRecovery(item.input)).rejects.toMatchObject({ code: 'FILE_REWIND_RECOVERY_CONFLICT' });
  });

  it('rejects coercible non-string kind discriminants in the recovery manifest', async () => {
    const item = await fixture('current', 'historical');
    await editJSON(item.manifest, value => { value.units[0].expected.kind = ['file']; });
    await expect(inspectFileRewindRecovery(item.input)).rejects.toMatchObject({ code: 'FILE_REWIND_RECOVERY_CONFLICT' });
    await editJSON(item.manifest, value => { value.units[0].expected.kind = 'file'; value.units[0].kind = ['workspace']; });
    await expect(inspectFileRewindRecovery(item.input)).rejects.toMatchObject({ code: 'FILE_REWIND_RECOVERY_CONFLICT' });
  });

  it('rejects swapped path labels even when every blob and receipt still matches its original key', async () => {
    await fs.writeFile(path.join(root, 'a.txt'), 'actual A'); await fs.writeFile(path.join(root, 'b.txt'), 'actual B');
    const pinned = await RewindDirectory.open(root);
    const files: FileRewindPathPlan[] = [];
    try {
      for (const relative of ['a.txt', 'b.txt']) files.push({ expected: (await observeRewindPath(pinned, relative, checks)).state,
        restore: snapshot(relative, Buffer.from(`old ${relative}`), 'file', 0o644), readRestore: async () => Buffer.from(`old ${relative}`) });
    } finally { await pinned.close(); }
    const transaction = new FileRewindTransaction({ directory, checkAllowed: async () => undefined }); transactions.push(transaction);
    const status = await transaction.prepare({ workspaceId: 'workspace-a', threadId: 'thread-a', repository, files });
    await editJSON(path.join(directory, status.id, 'manifest.json'), value => {
      for (let index = 0; index < 2; index++) {
        const label = index === 0 ? 'b.txt' : 'a.txt';
        value.units[index].path = label; value.units[index].expected.path = label; value.units[index].desired.path = label;
      }
    });
    await expect(inspectFileRewindRecovery({ directory, recoveryId: status.id, workspaceId: 'workspace-a', threadId: 'thread-a', path: 'b.txt', side: 'original' }))
      .rejects.toMatchObject({ code: 'FILE_REWIND_RECOVERY_CONFLICT' });
  });

  it('rejects a blob symlink even when its outside contents have the expected checksum', async () => {
    const item = await fixture('current', 'historical'); const outside = path.join(temporary, 'outside'); await fs.writeFile(outside, 'current');
    await fs.unlink(item.original); await fs.symlink(outside, item.original);
    await expect(inspectFileRewindRecovery(item.input)).rejects.toMatchObject({ code: 'FILE_REWIND_RECOVERY_CONFLICT' });
    expect(await fs.readFile(outside, 'utf8')).toBe('current');
  });

  it('rejects a substituted snapshot directory and never follows it', async () => {
    const item = await fixture('current', 'historical'); const before = path.dirname(item.original);
    await fs.rename(before, `${before}-retained`); const outside = path.join(temporary, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, '000000'), 'current');
    await fs.symlink(outside, before);
    await expect(inspectFileRewindRecovery(item.input)).rejects.toMatchObject({ code: 'FILE_REWIND_RECOVERY_CONFLICT' });
    expect(await fs.readFile(path.join(outside, '000000'), 'utf8')).toBe('current');
  });

  it('does not silently treat an unexpected stored blob as an absent snapshot', async () => {
    const item = await fixture(null, 'historical'); await fs.writeFile(item.original, 'unexpected retained bytes');
    await expect(inspectFileRewindRecovery(item.input)).rejects.toMatchObject({ code: 'FILE_REWIND_RECOVERY_CONFLICT' });
    expect(await fs.readFile(item.original, 'utf8')).toBe('unexpected retained bytes');
  });

  it('limits inspection to 16 MiB before reading a claimed oversized blob', async () => {
    const item = await fixture('current', 'historical');
    await editJSON(item.manifest, value => {
      value.units[0].expected.bytes = FILE_REWIND_RECOVERY_LIMITS.fileBytes + 1;
      value.units[0].backup.size = FILE_REWIND_RECOVERY_LIMITS.fileBytes + 1;
    });
    await expect(inspectFileRewindRecovery(item.input)).rejects.toMatchObject({ status: 413, code: 'FILE_REWIND_RECOVERY_LIMIT' });
    expect(await fs.readFile(item.original, 'utf8')).toBe('current');
  });

  it('never exposes a retained private Git index through a workspace file name', async () => {
    const header = Buffer.alloc(12); header.write('DIRC'); header.writeUInt32BE(2, 4);
    const index = Buffer.concat([header, createHash('sha1').update(header).digest()]); await fs.writeFile(path.join(root, '.git', 'index'), index);
    const transaction = new FileRewindTransaction({ directory, checkAllowed: async () => undefined }); transactions.push(transaction);
    const status = await transaction.prepare({ workspaceId: 'workspace-a', threadId: 'thread-a', repository, files: [], index: {
      expected: { present: true, sha256: hashBytes(index), bytes: index.length, blob: null, format: 2, extensions: [], entries: [] }, restore: null,
    } });
    await expect(inspectFileRewindRecovery({ directory, recoveryId: status.id, workspaceId: 'workspace-a', threadId: 'thread-a', path: 'index', side: 'original' }))
      .rejects.toMatchObject({ status: 404, code: 'FILE_REWIND_RECOVERY_NOT_FOUND' });
    expect(await fs.readFile(path.join(root, '.git', 'index'))).toEqual(index);
  });

  it.each([['missing', null], ['empty', '']] as const)('checks the inspection deadline for %s snapshots too', async (_label, current) => {
    const item = await fixture(current, 'historical'); const start = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(start + FILE_REWIND_RECOVERY_LIMITS.milliseconds + 1).mockReturnValueOnce(start);
    await expect(inspectFileRewindRecovery(item.input)).rejects.toMatchObject({ status: 503, code: 'FILE_REWIND_RECOVERY_TIMEOUT' });
  });
});
