import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppContext } from '../server/context';
import { FileMetadataManager, FILE_METADATA_KEY } from '../server/file-metadata';
import { PublicBucketVerifier } from '../server/file-transfers/durability';
import { JsonStore } from '../server/store';
import { verifyFileRewindMetadata } from '../server/agent/file-rewind-metadata';
import type { FileRewindMetadataExpectation } from '../server/agent/file-rewind-transaction';

interface MetadataEntry { root: 'workspaces' | 'home'; path: string; kind: string; mode: number; mtimeMs: number; size: number; target?: string; restoreMissing?: boolean }
interface MetadataSnapshot { version: 1; revision: number; capturedAt: string; entries: MetadataEntry[]; workspaceFileRoots?: string[] }
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
let temporary: string;
let ctx: AppContext;
let store: JsonStore;
let manager: FileMetadataManager;
let capture: ReturnType<typeof vi.fn<() => Promise<void>>>;
const workspacePath = (relative: string) => path.join(ctx.config.workspacesDir, 'workspace-a', relative);
const metadataFile = () => path.join(ctx.config.stateDir, `${FILE_METADATA_KEY}.json`);
const readSnapshot = () => store.read<MetadataSnapshot | null>(FILE_METADATA_KEY, null);

async function createFile(relative: string, bytes: string, mode: number): Promise<FileRewindMetadataExpectation> {
  const absolute = workspacePath(relative);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, bytes); await fs.chmod(absolute, mode);
  return { absolute, kind: 'file', mode, bytes: Buffer.byteLength(bytes), sha256: hash(bytes) };
}
async function createLink(relative: string, target: string): Promise<FileRewindMetadataExpectation> {
  const absolute = workspacePath(relative);
  await fs.mkdir(path.dirname(absolute), { recursive: true }); await fs.symlink(target, absolute);
  return { absolute, kind: 'symlink', mode: (await fs.lstat(absolute)).mode & 0o7777,
    bytes: Buffer.byteLength(target), sha256: hash(target), linkTargetBase64: Buffer.from(target).toString('base64') };
}
function readback(body: () => Promise<Buffer> = () => fs.readFile(metadataFile())) {
  let now = 1_000;
  const requests: Array<{ url: URL; options: RequestInit | undefined }> = [];
  const fetchImpl = vi.fn<typeof fetch>(async (input, options) => {
    requests.push({ url: new URL(String(input)), options });
    const bytes = await body();
    return new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-length': String(bytes.length) } });
  });
  // Exercise the real public checksum reader without network access or long retry sleeps.
  const verifier = new PublicBucketVerifier(ctx.config, { fetchImpl, now: () => now,
    deadline: 2_000, sleep: async milliseconds => { now += milliseconds; } });
  const verify = vi.spyOn(verifier, 'verify');
  return { verifier, requests, fetchImpl, verify };
}

beforeEach(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-rewind-metadata-'));
  await fs.chmod(temporary, 0o700);
  const dataDir = path.join(temporary, 'data'), workspacesDir = path.join(dataDir, 'workspaces');
  const homeDir = path.join(dataDir, 'home'), stateDir = path.join(dataDir, 'state');
  await Promise.all([fs.mkdir(workspacesDir, { recursive: true }), fs.mkdir(homeDir, { recursive: true }), fs.mkdir(stateDir, { recursive: true })]);
  store = new JsonStore(stateDir);
  manager = new FileMetadataManager({ workspacesDir, homeDir }, store);
  await manager.initialize();
  capture = vi.fn(() => manager.capture());
  ctx = { config: { dataDir, workspacesDir, homeDir, stateDir, bucket: 'rewind-fixture/data', requirePersistentData: true }, store,
    workspaces: { checkpointMetadataForRecovery: capture } } as unknown as AppContext;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await manager?.close();
  await fs.rm(temporary, { recursive: true, force: true });
});

describe('file rewind native metadata durability barrier', () => {
  it('captures and publicly verifies explicit metadata for 0644, 0600 and executable 0755 files', async () => {
    const privateFile = await createFile('private.txt', 'private-mode fixture bytes', 0o600);
    const executable = await createFile('bin/run.sh', '#!/bin/sh\nexit 0\n', 0o755);
    const plain = await createFile('ordinary.ts', 'export const ordinary = true;\n', 0o644);
    const publicRead = readback();

    await verifyFileRewindMetadata(ctx, [privateFile, executable, plain], publicRead.verifier);

    expect(capture).toHaveBeenCalledTimes(1);
    const snapshot = (await readSnapshot())!;
    expect(snapshot.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ root: 'workspaces', path: 'workspace-a/private.txt', kind: 'file', mode: 0o600, size: privateFile.bytes }),
      expect.objectContaining({ root: 'workspaces', path: 'workspace-a/bin/run.sh', kind: 'file', mode: 0o755, size: executable.bytes }),
      expect.objectContaining({ root: 'workspaces', path: 'workspace-a/ordinary.ts', kind: 'file', mode: 0o644, size: plain.bytes }),
    ]));
    const bytes = await fs.readFile(metadataFile());
    expect(publicRead.verify).toHaveBeenCalledWith([{ absolute: metadataFile(), size: bytes.length, sha256: hash(bytes) }]);
    expect(publicRead.requests).toHaveLength(1);
    expect(publicRead.requests[0].url.origin).toBe('https://huggingface.co');
    expect(publicRead.requests[0].url.pathname).toBe('/buckets/rewind-fixture/data/resolve/state/filesystem-metadata.json');
    expect(publicRead.requests[0].options).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'manual', cache: 'no-store' });
    expect(new Headers(publicRead.requests[0].options?.headers).has('authorization')).toBe(false);
  });

  it('verifies raw Unicode symlink targets without resolving them or reading a target', async () => {
    const raw = '../not-present/文書 with spaces';
    const expected = await createLink('link', raw), publicRead = readback();
    await verifyFileRewindMetadata(ctx, [expected], publicRead.verifier);
    expect((await readSnapshot())!.entries).toContainEqual(expect.objectContaining({ root: 'workspaces', path: 'workspace-a/link', kind: 'symlink', target: raw }));
    expect(await fs.readlink(expected.absolute)).toBe(raw);
    await expect(fs.stat(expected.absolute)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(publicRead.requests).toHaveLength(1);
  });

  it.each([0o644, 0o600, 0o755])('refuses legacy sparse omission as proof of requested mode %s', async mode => {
    const expected = await createFile('plain', 'legacy sparse fixture bytes', mode), publicRead = readback();
    // Reproduce the old canonical v1 representation, not a missing JSON file:
    // all other captured records and the real regular-file bytes remain valid.
    capture.mockImplementation(async () => {
      await manager.capture();
      const snapshot = (await readSnapshot())!;
      await store.write(FILE_METADATA_KEY, { ...snapshot, entries: snapshot.entries.filter(entry => entry.path !== 'workspace-a/plain') });
    });
    await expect(verifyFileRewindMetadata(ctx, [expected], publicRead.verifier)).rejects.toMatchObject({ status: 503, code: 'FILE_REWIND_METADATA_UNCONFIRMED' });
    expect((await readSnapshot())!.entries.some(entry => entry.path === 'workspace-a/plain')).toBe(false);
    expect(publicRead.fetchImpl).not.toHaveBeenCalled();
    expect((await fs.stat(expected.absolute)).mode & 0o7777).toBe(mode);
    expect(await fs.readFile(expected.absolute, 'utf8')).toBe('legacy sparse fixture bytes');
  });

  it('accepts an explicit matching default-mode receipt for an empty file', async () => {
    const expected = await createFile('empty.txt', '', 0o644), publicRead = readback();
    await verifyFileRewindMetadata(ctx, [expected], publicRead.verifier);
    expect((await readSnapshot())!.entries).toContainEqual(expect.objectContaining({ root: 'workspaces', path: 'workspace-a/empty.txt', kind: 'file', mode: 0o644, size: 0 }));
    const bytes = await fs.readFile(metadataFile());
    expect(publicRead.verify).toHaveBeenCalledWith([{ absolute: metadataFile(), size: bytes.length, sha256: hash(bytes) }]);
    expect(publicRead.requests).toHaveLength(1);
    expect(await fs.readFile(expected.absolute)).toEqual(Buffer.alloc(0));
  });

  it('rejects observed 0666 drift for requested 0644 without normalizing the actual file', async () => {
    const current = await createFile('remounted.txt', 'unchanged remounted bytes', 0o666), publicRead = readback();
    await expect(verifyFileRewindMetadata(ctx, [{ ...current, mode: 0o644 }], publicRead.verifier))
      .rejects.toMatchObject({ status: 503, code: 'FILE_REWIND_METADATA_UNCONFIRMED' });
    expect((await readSnapshot())!.entries).toContainEqual(expect.objectContaining({ path: 'workspace-a/remounted.txt', kind: 'file', mode: 0o666, size: current.bytes }));
    expect(publicRead.fetchImpl).not.toHaveBeenCalled();
    expect((await fs.stat(current.absolute)).mode & 0o7777).toBe(0o666);
    expect(await fs.readFile(current.absolute, 'utf8')).toBe('unchanged remounted bytes');
  });

  it.each(['directory', 'symlink'] as const)('refuses a %s receipt as evidence for an ordinary 0644 file', async kind => {
    const expected = await createFile('plain.txt', 'ordinary file', 0o644), publicRead = readback();
    capture.mockImplementation(async () => {
      await manager.capture();
      const snapshot = (await readSnapshot())!;
      const metadata: MetadataEntry = { root: 'workspaces', path: 'workspace-a/plain.txt', kind, mode: 0o644,
        mtimeMs: (await fs.stat(expected.absolute)).mtimeMs, size: expected.bytes,
        ...(kind === 'directory' ? { restoreMissing: false } : { target: 'ordinary file' }) };
      await store.write(FILE_METADATA_KEY, { ...snapshot, entries: [...snapshot.entries.filter(entry => entry.path !== metadata.path), metadata] });
    });
    await expect(verifyFileRewindMetadata(ctx, [expected], publicRead.verifier))
      .rejects.toMatchObject({ status: 503, code: 'FILE_REWIND_METADATA_UNCONFIRMED' });
    expect(publicRead.fetchImpl).not.toHaveBeenCalled();
    expect((await fs.lstat(expected.absolute)).isFile()).toBe(true);
    expect((await fs.stat(expected.absolute)).mode & 0o7777).toBe(0o644);
  });

  it.each(['mode', 'size', 'kind'] as const)('refuses metadata whose %s does not match the requested restore', async mismatch => {
    const expected = await createFile('source', 'same-size content', 0o600), publicRead = readback();
    const wrong = { ...expected };
    if (mismatch === 'mode') wrong.mode = 0o755;
    if (mismatch === 'size') wrong.bytes++;
    if (mismatch === 'kind') wrong.kind = 'symlink';
    await expect(verifyFileRewindMetadata(ctx, [wrong], publicRead.verifier)).rejects.toMatchObject({ code: 'FILE_REWIND_METADATA_UNCONFIRMED' });
    expect(publicRead.fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['target hash', 'target bytes', 'raw base64'] as const)('refuses a link with mismatched %s even if its destination might resolve identically', async mismatch => {
    const expected = await createLink('link', './same-target'), publicRead = readback();
    const wrong = { ...expected };
    if (mismatch === 'target hash') wrong.sha256 = hash('same-target');
    if (mismatch === 'target bytes') wrong.bytes++;
    if (mismatch === 'raw base64') wrong.linkTargetBase64 = Buffer.from('same-target').toString('base64');
    await expect(verifyFileRewindMetadata(ctx, [wrong], publicRead.verifier)).rejects.toMatchObject({ code: 'FILE_REWIND_METADATA_UNCONFIRMED' });
    expect(publicRead.fetchImpl).not.toHaveBeenCalled();
  });

  it('captures deletion of a previously recorded nondefault file and verifies its omission', async () => {
    const existing = await createFile('removed', 'old', 0o755); await manager.capture();
    expect((await readSnapshot())!.entries.some(entry => entry.path === 'workspace-a/removed')).toBe(true);
    await fs.unlink(existing.absolute);
    const publicRead = readback();
    await verifyFileRewindMetadata(ctx, [{ absolute: existing.absolute, kind: 'missing', bytes: 0, mode: 0, sha256: null }], publicRead.verifier);
    expect((await readSnapshot())!.entries.some(entry => entry.path === 'workspace-a/removed')).toBe(false);
    expect(publicRead.requests).toHaveLength(1);
  });

  it('does not certify a missing path while it or a recorded descendant is still present', async () => {
    const existing = await createFile('still-present', 'keep', 0o600);
    await createFile('directory/child', 'keep child', 0o755);
    const publicRead = readback();
    for (const absolute of [existing.absolute, workspacePath('directory')]) {
      await expect(verifyFileRewindMetadata(ctx, [{ absolute, kind: 'missing', mode: 0, bytes: 0, sha256: null }], publicRead.verifier))
        .rejects.toMatchObject({ code: 'FILE_REWIND_METADATA_UNCONFIRMED' });
    }
    expect(publicRead.fetchImpl).not.toHaveBeenCalled();
    expect(await fs.readFile(existing.absolute, 'utf8')).toBe('keep');
  });

  it('rejects a stale in-memory snapshot even when it still contains all requested modes', async () => {
    const expected = await createFile('source', 'keep', 0o600); await manager.capture();
    const stale = (await readSnapshot())!;
    await createFile('other-workspace-change', 'new', 0o755); await manager.capture();
    const read = store.read.bind(store);
    let substituted = false;
    vi.spyOn(store, 'read').mockImplementation(async <T>(key: string, fallback: T): Promise<T> => {
      if (key === FILE_METADATA_KEY && !substituted) { substituted = true; return structuredClone(stale) as T; }
      return read(key, fallback);
    });
    const publicRead = readback();
    await expect(verifyFileRewindMetadata(ctx, [expected], publicRead.verifier)).rejects.toMatchObject({ code: 'FILE_REWIND_METADATA_UNCONFIRMED' });
    expect(substituted).toBe(true);
    expect(publicRead.fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a metadata revision that changes after its local byte receipt was captured', async () => {
    const expected = await createFile('source', 'keep', 0o600); await manager.capture();
    const read = store.read.bind(store);
    let reads = 0;
    vi.spyOn(store, 'read').mockImplementation(async <T>(key: string, fallback: T): Promise<T> => {
      if (key === FILE_METADATA_KEY && ++reads === 2) {
        const value = (await read<MetadataSnapshot | null>(key, null))!;
        await store.write(key, { ...value, revision: value.revision + 1 });
      }
      return read(key, fallback);
    });
    const publicRead = readback();
    await expect(verifyFileRewindMetadata(ctx, [expected], publicRead.verifier)).rejects.toMatchObject({ code: 'FILE_REWIND_METADATA_UNCONFIRMED' });
    expect(reads).toBe(2);
    expect(publicRead.fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a public object with different bytes even when its advertised size matches', async () => {
    const expected = await createFile('source', 'keep', 0o755);
    const publicRead = readback(async () => { const bytes = await fs.readFile(metadataFile()); bytes[0] ^= 1; return bytes; });
    await expect(verifyFileRewindMetadata(ctx, [expected], publicRead.verifier)).rejects.toMatchObject({ code: 'FILE_TRANSFER_DURABILITY_PENDING' });
    expect(publicRead.fetchImpl).toHaveBeenCalled();
    expect(publicRead.requests.length).toBeLessThanOrEqual(4);
    expect(await fs.readFile(expected.absolute, 'utf8')).toBe('keep');
  });

  it('rejects a duplicate or missing manifest before sending any public verification request', async () => {
    const expected = await createFile('source', 'keep', 0o600), publicRead = readback();
    capture.mockImplementation(async () => {
      await manager.capture();
      const snapshot = (await readSnapshot())!;
      const repeated = snapshot.entries.find(entry => entry.path === 'workspace-a/source')!;
      await store.write(FILE_METADATA_KEY, { ...snapshot, entries: [...snapshot.entries, repeated] });
    });
    await expect(verifyFileRewindMetadata(ctx, [expected], publicRead.verifier)).rejects.toMatchObject({ code: 'FILE_REWIND_METADATA_UNCONFIRMED' });
    capture.mockImplementation(async () => { await manager.capture(); await store.delete(FILE_METADATA_KEY); });
    await expect(verifyFileRewindMetadata(ctx, [expected], publicRead.verifier)).rejects.toMatchObject({ code: 'FILE_REWIND_METADATA_UNCONFIRMED' });
    expect(publicRead.fetchImpl).not.toHaveBeenCalled();
  });

  it('does not turn a failed canonical metadata capture into a successful receipt', async () => {
    const expected = await createFile('source', 'keep', 0o755), publicRead = readback();
    vi.spyOn(manager, 'capture').mockRejectedValueOnce(Object.assign(new Error('Fixture metadata I/O failed'), { code: 'EIO' }));
    await expect(verifyFileRewindMetadata(ctx, [expected], publicRead.verifier)).rejects.toMatchObject({ code: 'EIO' });
    expect(publicRead.fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects paths outside the workspace root and bounds requests before metadata work', async () => {
    const publicRead = readback();
    const outside: FileRewindMetadataExpectation = { absolute: path.join(ctx.config.homeDir, 'other'), kind: 'missing', mode: 0, bytes: 0, sha256: null };
    await expect(verifyFileRewindMetadata(ctx, [outside], publicRead.verifier)).rejects.toMatchObject({ code: 'FILE_REWIND_METADATA_UNCONFIRMED' });
    capture.mockClear();
    await expect(verifyFileRewindMetadata(ctx, Array.from({ length: 5002 }, () => outside), publicRead.verifier)).rejects.toMatchObject({ code: 'FILE_REWIND_METADATA_UNCONFIRMED' });
    expect(capture).not.toHaveBeenCalled();
    expect(publicRead.fetchImpl).not.toHaveBeenCalled();
  });

  it('requires no public metadata receipt for an explicitly nonpersistent fixture', async () => {
    ctx.config.requirePersistentData = false;
    const publicRead = readback();
    await verifyFileRewindMetadata(ctx, [], publicRead.verifier);
    expect(capture).not.toHaveBeenCalled();
    expect(publicRead.fetchImpl).not.toHaveBeenCalled();
  });
});
