import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseGitCheckpointIndex } from '../server/git-checkpoints/git-index';

type ObjectFormat = 'sha1' | 'sha256';
let root: string;

/** Fixtures come from real Git; no application runner or provider is started. */
function nativeGit(args: string[], input?: string | Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile('/usr/bin/git', [
      '-c', 'user.name=Checkpoint Index Test', '-c', 'user.email=index-test@example.invalid',
      '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
      '-c', 'core.autocrlf=false', '-c', 'index.threads=1', '-c', 'index.skipHash=false',
      '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args,
    ], {
      cwd: root, timeout: 10_000, maxBuffer: 2 * 1024 * 1024, encoding: 'buffer',
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
        GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1', GIT_ALLOW_PROTOCOL: '' },
    }, (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(input);
  });
}

async function init(format: ObjectFormat = 'sha1'): Promise<void> {
  await nativeGit(['init', '--quiet', `--object-format=${format}`]);
}

const indexBytes = () => readFile(path.join(root, '.git/index'));
const text = (bytes: Buffer) => bytes.toString('utf8').trim();

async function singleFile(format: ObjectFormat = 'sha1'): Promise<Buffer> {
  await init(format);
  await writeFile(path.join(root, 'safe.txt'), 'staged contents\n');
  await nativeGit(['add', '--', 'safe.txt']);
  await nativeGit(['update-index', '--index-version=2']);
  return indexBytes();
}

function signed(body: Buffer, format: ObjectFormat = 'sha1'): Buffer {
  return Buffer.concat([body, createHash(format).update(body).digest()]);
}

function altered(raw: Buffer, mutate: (body: Buffer) => void, format: ObjectFormat = 'sha1'): Buffer {
  const body = Buffer.from(raw.subarray(0, raw.length - (format === 'sha1' ? 20 : 32)));
  mutate(body);
  return signed(body, format);
}

function extended(raw: Buffer, signature: string, payload: Buffer, format: ObjectFormat = 'sha1'): Buffer {
  const header = Buffer.alloc(8);
  header.write(signature, 0, 4, 'latin1');
  header.writeUInt32BE(payload.length, 4);
  return signed(Buffer.concat([raw.subarray(0, raw.length - (format === 'sha1' ? 20 : 32)), header, payload]), format);
}

function failure(operation: () => unknown, code = 'CHECKPOINT_INVALID_INDEX', status = 409): void {
  let caught: unknown;
  try { operation(); } catch (error) { caught = error; }
  expect(caught).toMatchObject({ name: 'HttpError', status, code });
}

async function nativeEntries(): Promise<Array<{ mode: string; objectId: string; stage: number; path: string }>> {
  return (await nativeGit(['ls-files', '--stage', '-z'])).toString('utf8').split('\0').filter(Boolean).map(line => {
    const match = /^([0-7]{6}) ([a-f0-9]+) ([0-3])\t([\s\S]+)$/u.exec(line);
    if (!match) throw new Error('Unexpected native Git fixture output.');
    return { mode: match[1], objectId: match[2], stage: Number(match[3]), path: match[4] };
  });
}

beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'codex-checkpoint-index-')); });
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

describe('native Git checkpoint index parsing', () => {
  it('distinguishes an absent index from a present empty native index', async () => {
    expect(parseGitCheckpointIndex(null, 'sha1')).toEqual({ present: false, sha256: null, bytes: 0, format: null, extensions: [], entries: [] });
    await init();
    await nativeGit(['read-tree', '--empty']);
    const raw = await indexBytes();
    expect(parseGitCheckpointIndex(raw, 'sha1', { maxEntries: 0 })).toMatchObject({ present: true,
      sha256: createHash('sha256').update(raw).digest('hex'), bytes: raw.length, format: 2, entries: [] });
    failure(() => parseGitCheckpointIndex(Buffer.alloc(0), 'sha1'));
  });

  it.each(['sha1', 'sha256'] as const)('reads actual %s staged objects, executable modes and symlinks without using working contents', async objectFormat => {
    await init(objectFormat);
    await writeFile(path.join(root, 'plain.txt'), 'the staged version\n');
    await writeFile(path.join(root, 'run.sh'), '#!/bin/sh\nexit 0\n');
    await chmod(path.join(root, 'run.sh'), 0o755);
    await symlink('plain.txt', path.join(root, 'link'));
    await nativeGit(['add', '--', 'plain.txt', 'run.sh', 'link']);
    await nativeGit(['update-index', '--index-version=2']);
    await writeFile(path.join(root, 'plain.txt'), 'a different working version\n');
    await writeFile(path.join(root, 'untracked.txt'), 'not in the index\n');
    const raw = await indexBytes();
    const expected = (await nativeEntries()).map(entry => ({ ...entry, assumeValid: false, skipWorktree: false, intentToAdd: false, blob: null }));
    const parsed = parseGitCheckpointIndex(raw, objectFormat);
    expect(parsed).toMatchObject({ present: true, sha256: createHash('sha256').update(raw).digest('hex'), bytes: raw.length,
      format: 2, entries: expected });
    expect(parsed).not.toHaveProperty('blob');
    expect(parsed.entries.map(entry => entry.mode)).toEqual(['120000', '100644', '100755']);
    expect(parsed.entries.every(entry => entry.objectId.length === (objectFormat === 'sha1' ? 40 : 64))).toBe(true);
    expect(text(await nativeGit(['cat-file', 'blob', parsed.entries.find(entry => entry.path === 'plain.txt')!.objectId]))).toBe('the staged version');
    expect(await indexBytes()).toEqual(raw);
  });

  it.each(['sha1', 'sha256'] as const)('retains version 3 assume-valid, skip-worktree and intent-to-add flags separately in %s indexes', async format => {
    await init(format);
    for (const name of ['assumed.txt', 'intent.txt', 'plain.txt', 'skip.txt']) await writeFile(path.join(root, name), `${name}\n`);
    await nativeGit(['add', '--', 'assumed.txt', 'plain.txt', 'skip.txt']);
    await nativeGit(['update-index', '--assume-unchanged', '--', 'assumed.txt']);
    await nativeGit(['update-index', '--skip-worktree', '--', 'skip.txt']);
    await nativeGit(['add', '--intent-to-add', '--', 'intent.txt']);
    await nativeGit(['update-index', '--index-version=3']);
    const parsed = parseGitCheckpointIndex(await indexBytes(), format);
    expect(parsed.format).toBe(3);
    expect(parsed.entries.map(({ path: name, assumeValid, skipWorktree, intentToAdd }) => ({ name, assumeValid, skipWorktree, intentToAdd }))).toEqual([
      { name: 'assumed.txt', assumeValid: true, skipWorktree: false, intentToAdd: false },
      { name: 'intent.txt', assumeValid: false, skipWorktree: false, intentToAdd: true },
      { name: 'plain.txt', assumeValid: false, skipWorktree: false, intentToAdd: false },
      { name: 'skip.txt', assumeValid: false, skipWorktree: true, intentToAdd: false },
    ]);
    expect(parsed.entries.map(({ path: name, mode, objectId, stage }) => ({ path: name, mode, objectId, stage }))).toEqual(await nativeEntries());
  });

  it.each([2, 4])('keeps all real merge stages in version %i, including repeated compressed paths', async version => {
    await singleFile();
    const ids: string[] = [];
    for (const contents of ['base\n', 'ours\n', 'theirs\n']) ids.push(text(await nativeGit(['hash-object', '-w', '--stdin'], contents)));
    await nativeGit(['update-index', '--index-info'], ids.map((oid, index) => `${index === 2 ? '100755' : '100644'} ${oid} ${index + 1}\tconflict.txt\n`).join(''));
    await nativeGit(['update-index', `--index-version=${version}`]);
    const parsed = parseGitCheckpointIndex(await indexBytes(), 'sha1');
    expect(parsed.format).toBe(version);
    expect(parsed.entries.map(({ path: name, mode, objectId, stage }) => ({ path: name, mode, objectId, stage }))).toEqual(await nativeEntries());
    expect(parsed.entries.map(entry => entry.stage)).toEqual([1, 2, 3, 0]);
    expect(parsed.entries.slice(0, 3).map(entry => entry.objectId)).toEqual(ids);
  });

  it.each(['sha1', 'sha256'] as const)('decodes version 4 UTF-8 byte prefixes and multibyte strip integers in %s repositories', async format => {
    await init(format);
    await mkdir(path.join(root, 'common'));
    const names = [`common/${'a'.repeat(170)}é.txt`, `common/${'a'.repeat(170)}ê.txt`, 'z.txt'];
    for (const name of names) await writeFile(path.join(root, name), `${name}\n`);
    await nativeGit(['add', '--', ...names]);
    await nativeGit(['update-index', '--index-version=4']);
    const raw = await indexBytes();
    const parsed = parseGitCheckpointIndex(raw, format);
    expect(parsed.format).toBe(4);
    expect(parsed.entries.map(entry => entry.path)).toEqual(names);
    expect(parsed.entries.map(({ path: name, mode, objectId, stage }) => ({ path: name, mode, objectId, stage }))).toEqual(await nativeEntries());
    const firstStrip = 12 + 40 + (format === 'sha1' ? 20 : 32) + 2;
    failure(() => parseGitCheckpointIndex(altered(raw, body => { body[firstStrip] = 1; }, format), format));
  });

  it('reads the native long-name sentinel and refuses paths beyond the restoration byte bound', async () => {
    await init();
    const oid = text(await nativeGit(['hash-object', '-w', '--stdin'], 'virtual staged file\n'));
    const virtualPath = Array.from({ length: 17 }, () => 'p'.repeat(240)).join('/');
    await nativeGit(['update-index', '--add', '--cacheinfo', `100644,${oid},${virtualPath}`]);
    const parsed = parseGitCheckpointIndex(await indexBytes(), 'sha1');
    expect(parsed.entries[0]).toMatchObject({ path: virtualPath, objectId: oid });
    await nativeGit(['update-index', '--add', '--cacheinfo', `100644,${oid},${virtualPath}x`]);
    const overlong = await indexBytes();
    failure(() => parseGitCheckpointIndex(overlong, 'sha1'), 'CHECKPOINT_LIMIT', 413);
  });

  it.each(['sha1', 'sha256'] as const)('rejects modified content and omitted native %s checksums', async format => {
    const raw = await singleFile(format);
    const corrupt = Buffer.from(raw);
    corrupt[12] ^= 1;
    failure(() => parseGitCheckpointIndex(corrupt, format));
    const unchecked = Buffer.from(raw);
    unchecked.fill(0, unchecked.length - (format === 'sha1' ? 20 : 32));
    failure(() => parseGitCheckpointIndex(unchecked, format));
    failure(() => parseGitCheckpointIndex(raw.subarray(0, 16), format));
  });

  it.each(['sha1', 'sha256'] as const)('accepts a null %s object ID only for intent-to-add entries', async format => {
    const raw = await singleFile(format);
    const objectBytes = format === 'sha1' ? 20 : 32;
    const nullObject = (body: Buffer) => { body.fill(0, 12 + 40, 12 + 40 + objectBytes); };
    failure(() => parseGitCheckpointIndex(altered(raw, nullObject, format), format));
    await writeFile(path.join(root, 'intent.txt'), 'not staged yet\n');
    await nativeGit(['add', '--intent-to-add', '--', 'intent.txt']);
    const intent = altered(await indexBytes(), nullObject, format);
    expect(parseGitCheckpointIndex(intent, format).entries.find(entry => entry.path === 'intent.txt'))
      .toMatchObject({ objectId: '0'.repeat(objectBytes * 2), intentToAdd: true, blob: null });
  });

  it('rejects unsafe, invalid UTF-8 and NUL-containing paths even with recomputed checksums', async () => {
    const raw = await singleFile();
    const paths = ['../a.txt', '.git/abc', '.GIT/abc', '/bad.txt', 'C:/a.txt', 'bad\\name', '\u001bfoo.txt', 'ab\0d.txt'].map(value => Buffer.from(value));
    paths.push(Buffer.from([0xc3, 0x28, 0x61, 0x62, 0x2e, 0x74, 0x78, 0x74]));
    for (const name of paths) {
      expect(name.length).toBe(8);
      failure(() => parseGitCheckpointIndex(altered(raw, body => { name.copy(body, 12 + 62); }), 'sha1'));
    }
  });

  it('validates entry lengths, zero padding, modes and structural truncation', async () => {
    const raw = await singleFile();
    failure(() => parseGitCheckpointIndex(altered(raw, body => { body.writeUInt16BE(7, 12 + 60); }), 'sha1'));
    failure(() => parseGitCheckpointIndex(altered(raw, body => { body[12 + 62 + 8 + 1] = 1; }), 'sha1'));
    failure(() => parseGitCheckpointIndex(altered(raw, body => { body.writeUInt32BE(0o100600, 12 + 24); }), 'sha1'));
    failure(() => parseGitCheckpointIndex(signed(raw.subarray(0, raw.length - 21)), 'sha1'));
    failure(() => parseGitCheckpointIndex(altered(raw, body => { body.writeUInt32BE(2, 8); }), 'sha1'));
  });

  it('rejects unknown versions and extended flags instead of discarding them', async () => {
    await singleFile();
    await nativeGit(['update-index', '--skip-worktree', '--', 'safe.txt']);
    const raw = await indexBytes();
    failure(() => parseGitCheckpointIndex(altered(raw, body => { body.writeUInt32BE(5, 4); }), 'sha1'), 'CHECKPOINT_UNSUPPORTED_INDEX');
    failure(() => parseGitCheckpointIndex(altered(raw, body => { body.writeUInt16BE(0x8000, 12 + 62); }), 'sha1'), 'CHECKPOINT_UNSUPPORTED_INDEX');
    failure(() => parseGitCheckpointIndex(altered(raw, body => { body.writeUInt32BE(2, 4); }), 'sha1'));
  });

  it('preserves optional extension signatures and rejects required or truncated extensions', async () => {
    const raw = await singleFile();
    const optional = extended(raw, 'TEST', Buffer.from([0, 255, 1, 2]));
    expect(parseGitCheckpointIndex(optional, 'sha1').extensions).toContain('TEST');
    expect(parseGitCheckpointIndex(optional, 'sha1').sha256).toBe(createHash('sha256').update(optional).digest('hex'));
    for (const signature of ['link', 'sdir', 'abcd']) {
      failure(() => parseGitCheckpointIndex(extended(raw, signature, Buffer.alloc(0)), 'sha1'), 'CHECKPOINT_UNSUPPORTED_INDEX');
    }
    const shortHeader = signed(Buffer.concat([raw.subarray(0, -20), Buffer.from('TEST')]));
    failure(() => parseGitCheckpointIndex(shortHeader, 'sha1'));
    failure(() => parseGitCheckpointIndex(altered(optional, body => { body.writeUInt32BE(0xffffffff, raw.length - 20 + 4); }), 'sha1'));
  });

  it('reports native split-index replacement entries as unsupported', async () => {
    await init();
    for (const name of ['a.txt', 'b.txt']) await writeFile(path.join(root, name), 'before\n');
    await nativeGit(['add', '--', 'a.txt', 'b.txt']);
    await nativeGit(['update-index', '--split-index']);
    await writeFile(path.join(root, 'a.txt'), 'changed staged content\n');
    await nativeGit(['-c', 'splitIndex.maxPercentChange=100', 'add', '--', 'a.txt']);
    const raw = await indexBytes();
    expect(raw.readUInt32BE(8)).toBeGreaterThan(0);
    failure(() => parseGitCheckpointIndex(raw, 'sha1'), 'CHECKPOINT_UNSUPPORTED_INDEX');
  });

  it('rejects a real sparse directory index and a real gitlink', async () => {
    await init();
    for (const directory of ['keep', 'omit']) {
      await mkdir(path.join(root, directory));
      await writeFile(path.join(root, directory, 'file.txt'), `${directory}\n`);
    }
    await nativeGit(['add', '--all']);
    await nativeGit(['commit', '--quiet', '--message=Sparse fixture']);
    await nativeGit(['sparse-checkout', 'init', '--cone', '--sparse-index']);
    await nativeGit(['sparse-checkout', 'set', 'keep']);
    const sparse = await indexBytes();
    failure(() => parseGitCheckpointIndex(sparse, 'sha1'), 'CHECKPOINT_UNSUPPORTED_INDEX');
    await nativeGit(['sparse-checkout', 'disable']);
    const commit = text(await nativeGit(['rev-parse', 'HEAD']));
    await nativeGit(['update-index', '--add', '--cacheinfo', `160000,${commit},module`]);
    const gitlink = await indexBytes();
    failure(() => parseGitCheckpointIndex(gitlink, 'sha1'), 'CHECKPOINT_UNSUPPORTED_INDEX');
  });

  it('checks raw bytes, entry count and expanded version 4 path memory before accepting the index', async () => {
    const raw = await singleFile();
    failure(() => parseGitCheckpointIndex(raw, 'sha1', { maxBytes: raw.length - 1 }), 'CHECKPOINT_LIMIT', 413);
    failure(() => parseGitCheckpointIndex(raw, 'sha1', { maxEntries: 0 }), 'CHECKPOINT_LIMIT', 413);
    const oid = text(await nativeGit(['rev-parse', ':safe.txt']));
    const prefix = `${'p'.repeat(200)}/${'q'.repeat(200)}/`;
    await nativeGit(['update-index', '--index-info'], Array.from({ length: 20 }, (_, index) => `100644 ${oid}\t${prefix}${String(index).padStart(3, '0')}.txt\n`).join(''));
    await nativeGit(['update-index', '--index-version=4']);
    const compressed = await indexBytes();
    expect(parseGitCheckpointIndex(compressed, 'sha1').entries).toHaveLength(21);
    failure(() => parseGitCheckpointIndex(compressed, 'sha1', { maxBytes: compressed.length }), 'CHECKPOINT_LIMIT', 413);
  });

  it('rejects duplicate stage entries and unsigned-byte path order violations', async () => {
    await init();
    for (const name of ['a.txt', 'b.txt']) await writeFile(path.join(root, name), 'data\n');
    await nativeGit(['add', '--', 'a.txt', 'b.txt']);
    const raw = await indexBytes();
    const firstPath = 12 + 62;
    const secondPath = 12 + 72 + 62;
    failure(() => parseGitCheckpointIndex(altered(raw, body => { Buffer.from('a.txt').copy(body, secondPath); }), 'sha1'));
    failure(() => parseGitCheckpointIndex(altered(raw, body => { Buffer.from('z.txt').copy(body, firstPath); }), 'sha1'));
  });
});
