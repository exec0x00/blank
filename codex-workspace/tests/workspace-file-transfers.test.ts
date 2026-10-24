import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { Workspace } from '../shared/types';
import { loadConfig, type AppConfig } from '../server/config';
import type { AppContext } from '../server/context';
import { HttpError } from '../server/errors';
import { JsonStore } from '../server/store';
import { WorkspaceService, createWorkspaceRouter } from '../server/workspaces';
import { FileMetadataManager, FILE_METADATA_KEY } from '../server/file-metadata';
import * as resources from '../server/host-resources';
import { acquireWorkspaceActivity, withWorkspaceRemoval } from '../server/worktrees/activity';
import { listWorkspaceFileTransfers, recoverFileTransfers, transferWorkspaceEntry } from '../server/file-transfers/service';
import type { StoredFileTransfer, TransferManifest } from '../server/file-transfers/types';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('workspace file move/copy API and durable recovery', () => {
  let directory: string;
  let config: AppConfig;
  let store: JsonStore;
  let service: WorkspaceService;
  let workspace: Workspace;
  const servers: Server[] = [];
  const managers: FileMetadataManager[] = [];

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-workspace-transfers-'));
    config = loadConfig({ DATA_DIR: directory, WORKSPACE_PASSWORD: 'workspace-transfer-test', SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'k'.repeat(64) });
    store = new JsonStore(config.stateDir);
    service = new WorkspaceService(config, store);
    await service.initialize();
    workspace = await service.create({ name: 'Transfer fixtures' });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const server of servers.splice(0)) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
    for (const manager of managers.splice(0)) await manager.close();
    await fs.rm(directory, { recursive: true, force: true });
  });

  async function record(): Promise<StoredFileTransfer> {
    const status = (await service.listFileTransfers(workspace.id))[0];
    expect(status).toBeDefined();
    return store.read<StoredFileTransfer>(`file-transfer-${status.id}`, {} as StoredFileTransfer);
  }

  const options = () => ({ workspaceId: workspace.id, root: workspace.path, path: 'source', newPath: 'target',
    source: path.join(workspace.path, 'source'), destination: path.join(workspace.path, 'target'), kind: 'move' as const });

  it('preserves rename compatibility and copies entire directories through the existing workspace service', async () => {
    await service.writeFile(workspace.id, 'source/nested/file.txt', 'actual content');
    await service.createEntry(workspace.id, 'source/empty', 'directory');
    await service.copyEntry(workspace.id, 'source', 'copy');
    expect((await service.readFile(workspace.id, 'source/nested/file.txt')).content).toBe('actual content');
    expect((await service.readFile(workspace.id, 'copy/nested/file.txt')).content).toBe('actual content');
    expect(await service.listTree(workspace.id, 'copy/empty')).toEqual([]);
    await service.renameEntry(workspace.id, 'source', 'moved');
    expect((await service.readFile(workspace.id, 'moved/nested/file.txt')).content).toBe('actual content');
    await expect(service.readFile(workspace.id, 'source/nested/file.txt')).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
    expect(await service.listFileTransfers(workspace.id)).toEqual([]);
    expect((await fs.readdir(config.stateDir)).filter(name => name.startsWith('file-transfer-'))).toEqual([]);
  });

  it('treats identical Move as a no-op but rejects identical Copy and existing or nested destinations', async () => {
    await service.writeFile(workspace.id, 'source/file', 'keep');
    await service.renameEntry(workspace.id, 'source/file', './source/file');
    await expect(service.copyEntry(workspace.id, 'source/file', './source/file')).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(service.copyEntry(workspace.id, 'source', 'source/nested')).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await service.createEntry(workspace.id, 'existing', 'directory');
    await expect(service.copyEntry(workspace.id, 'source', 'existing')).rejects.toMatchObject({ code: 'FILE_EXISTS' });
    expect((await service.readFile(workspace.id, 'source/file')).content).toBe('keep');
    expect(await service.listFileTransfers(workspace.id)).toEqual([]);
  });

  it('preserves permitted internal parent links while transfers never follow symlink leaves', async () => {
    await service.writeFile(workspace.id, 'real/file', 'bytes');
    await fs.symlink('real', path.join(workspace.path, 'alias'));
    await service.copyEntry(workspace.id, 'alias/file', 'copied');
    expect((await service.readFile(workspace.id, 'copied')).content).toBe('bytes');
    const outside = path.join(directory, 'outside-file');
    await fs.writeFile(outside, 'outside');
    await fs.symlink(outside, path.join(workspace.path, 'outside-link'));
    await service.copyEntry(workspace.id, 'outside-link', 'link-copy');
    expect(await fs.readlink(path.join(workspace.path, 'link-copy'))).toBe(outside);
    expect(await fs.readFile(outside, 'utf8')).toBe('outside');
  });

  it('holds the files lease during verification and releases it without requiring an idle terminal to close', async () => {
    await service.writeFile(workspace.id, 'source', 'bytes');
    const entered = deferred();
    const release = deferred();
    let checkpoints = 0;
    const guarded = new WorkspaceService(config, store, { checkpointFileMetadata: async () => {
      if (++checkpoints === 1) { entered.resolve(); await release.promise; }
    } });
    await guarded.initialize();
    const terminal = acquireWorkspaceActivity(config.workspacesDir, workspace.id, 'terminal');
    const move = guarded.renameEntry(workspace.id, 'source', 'target');
    try {
      await entered.promise;
      await expect(withWorkspaceRemoval(config.workspacesDir, workspace.id, async () => undefined)).rejects.toMatchObject({ code: 'WORKTREE_BUSY' });
      expect((await guarded.listFileTransfers(workspace.id))[0]).toMatchObject({ kind: 'move', state: 'running' });
    } finally { release.resolve(); terminal(); }
    await move;
    await expect(withWorkspaceRemoval(config.workspacesDir, workspace.id, async () => 'released')).resolves.toBe('released');
  });

  it('serializes a late editor save from an independent service until Move finishes, then rejects its stale version', async () => {
    const source = await service.writeFile(workspace.id, 'source', 'before');
    const entered = deferred();
    const release = deferred();
    let checkpoints = 0;
    const first = new WorkspaceService(config, new JsonStore(config.stateDir), { checkpointFileMetadata: async () => {
      if (++checkpoints === 1) { entered.resolve(); await release.promise; }
    } });
    const second = new WorkspaceService(config, new JsonStore(config.stateDir));
    await first.initialize(); await second.initialize();
    const moving = first.renameEntry(workspace.id, 'source', 'target');
    await entered.promise;
    let saved = false;
    const saving = second.writeFile(workspace.id, 'source', 'editor bytes', source.version)
      .then(value => { saved = true; return value; }, error => { saved = true; throw error; });
    // Attach the rejection assertion before allowing the queue to proceed.
    const rejected = expect(saving).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
    try {
      await new Promise<void>(resolve => { setImmediate(resolve); });
      expect(saved).toBe(false);
      expect(await fs.readFile(path.join(workspace.path, 'source'), 'utf8')).toBe('before');
    } finally { release.resolve(); }
    await moving; await rejected;
    expect((await second.readFile(workspace.id, 'target')).content).toBe('before');
    await expect(fs.lstat(path.join(workspace.path, 'source'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retains an interrupted-copy record, preserves manual edits, and never replays cleanup during recovery', async () => {
    await fs.writeFile(path.join(workspace.path, 'source'), 'original');
    await expect(transferWorkspaceEntry(config, store, { ...options(), verifyDurable: async () => { throw new Error('Durability receipt unavailable'); } }))
      .rejects.toMatchObject({ code: 'FILE_TRANSFER_FAILED' });
    await fs.writeFile(path.join(workspace.path, 'target'), 'manual target edit');
    await fs.writeFile(path.join(workspace.path, 'source'), 'manual source edit');
    const saved = await record();
    expect(saved).toMatchObject({ phase: 'interrupted', interruptedPhase: 'verifying', kind: 'move', path: 'source', newPath: 'target' });
    const manifest = await store.read<TransferManifest | null>(`file-transfer-tree-${saved.id}`, null);
    expect(manifest?.entries[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    await store.write(`file-transfer-${saved.id}`, { ...saved, phase: 'verifying', issue: undefined, interruptedPhase: undefined });
    const unlink = vi.spyOn(fs, 'unlink');
    const restarted = new WorkspaceService(config, new JsonStore(config.stateDir));
    await restarted.recoverFileTransfers();
    expect(unlink).not.toHaveBeenCalled();
    expect(await fs.readFile(path.join(workspace.path, 'source'), 'utf8')).toBe('manual source edit');
    expect(await fs.readFile(path.join(workspace.path, 'target'), 'utf8')).toBe('manual target edit');
    expect((await restarted.listFileTransfers(workspace.id))[0]).toMatchObject({ id: saved.id, state: 'interrupted', phase: 'verifying' });
    await expect(restarted.copyEntry(workspace.id, 'source', 'target')).rejects.toMatchObject({ code: 'FILE_EXISTS' });
  });

  it('retains the verified destination and remaining source after a real unlink failure and a restart', async () => {
    await fs.mkdir(path.join(workspace.path, 'source'));
    await fs.writeFile(path.join(workspace.path, 'source/a'), 'first');
    await fs.writeFile(path.join(workspace.path, 'source/b'), 'second');
    const unlink = fs.unlink.bind(fs);
    const failure = vi.spyOn(fs, 'unlink').mockImplementation(async target => {
      if (String(target).endsWith('/b')) throw Object.assign(new Error('Injected unlink interruption'), { code: 'EIO' });
      await unlink(target);
    });
    await expect(service.renameEntry(workspace.id, 'source', 'target')).rejects.toMatchObject({ code: 'FILE_TRANSFER_FAILED' });
    failure.mockRestore();
    const saved = await record();
    expect(saved).toMatchObject({ phase: 'interrupted', interruptedPhase: 'removing' });
    expect(await fs.readFile(path.join(workspace.path, 'target/a'), 'utf8')).toBe('first');
    expect(await fs.readFile(path.join(workspace.path, 'target/b'), 'utf8')).toBe('second');
    await fs.writeFile(path.join(workspace.path, 'source/b'), 'new user change');
    await recoverFileTransfers(config, new JsonStore(config.stateDir));
    await expect(fs.lstat(path.join(workspace.path, 'source/a'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(workspace.path, 'source/b'), 'utf8')).toBe('new user change');
    expect((await listWorkspaceFileTransfers(config, workspace.id))[0]).toMatchObject({ state: 'interrupted', phase: 'removing' });
  });

  it('does not act on a manipulated recovery manifest or read files outside the workspace', async () => {
    await fs.writeFile(path.join(workspace.path, 'source'), 'original');
    await expect(transferWorkspaceEntry(config, store, { ...options(), verifyDurable: async () => { throw new Error('Stop'); } })).rejects.toThrow();
    const saved = await record();
    const outside = path.join(directory, 'outside');
    await fs.writeFile(outside, 'must survive');
    await store.write(`file-transfer-tree-${saved.id}`, { version: 1, entries: [{ path: '../../outside', kind: 'file', sha256: 'a'.repeat(64) }] });
    await new WorkspaceService(config, new JsonStore(config.stateDir)).recoverFileTransfers();
    expect(await fs.readFile(outside, 'utf8')).toBe('must survive');
    expect(await fs.readFile(path.join(workspace.path, 'source'), 'utf8')).toBe('original');
    expect(await fs.readFile(path.join(workspace.path, 'target'), 'utf8')).toBe('original');
  });

  it('does not accumulate recovery journals for validation failures before any destination write', async () => {
    await fs.mkdir(path.join(workspace.path, 'source'));
    await fs.writeFile(path.join(workspace.path, 'source/first'), 'bytes');
    await fs.link(path.join(workspace.path, 'source/first'), path.join(workspace.path, 'source/second'));
    for (let index = 0; index < 3; index++) {
      await expect(service.renameEntry(workspace.id, 'source', `target-${index}`)).rejects.toMatchObject({ code: 'FILE_TRANSFER_HARD_LINKS' });
      expect(await service.listFileTransfers(workspace.id)).toEqual([]);
      await expect(fs.lstat(path.join(workspace.path, `target-${index}`))).rejects.toMatchObject({ code: 'ENOENT' });
    }
    expect(await fs.readFile(path.join(workspace.path, 'source/first'), 'utf8')).toBe('bytes');
    expect(await fs.readFile(path.join(workspace.path, 'source/second'), 'utf8')).toBe('bytes');
  });

  it('retains an externally edited pre-copy journal instead of deleting its newer recovery notes', async () => {
    await fs.writeFile(path.join(workspace.path, 'source'), 'bytes');
    await expect(transferWorkspaceEntry(config, store, { ...options(), checkAllowed: async () => {
      const status = (await service.listFileTransfers(workspace.id))[0];
      const key = `file-transfer-${status.id}`;
      const current = await store.read<StoredFileTransfer>(key, {} as StoredFileTransfer);
      await store.write(key, { ...current, phase: 'interrupted', interruptedPhase: 'copying', issue: 'New recovery notes from the owner.' });
      throw new HttpError(409, 'Validation stopped.', 'FILE_TRANSFER_CONFLICT');
    } })).rejects.toMatchObject({ code: 'FILE_TRANSFER_CONFLICT' });
    expect((await service.listFileTransfers(workspace.id))[0]).toMatchObject({ state: 'interrupted', issue: 'New recovery notes from the owner.' });
    expect(await fs.readFile(path.join(workspace.path, 'source'), 'utf8')).toBe('bytes');
    await expect(fs.lstat(path.join(workspace.path, 'target'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('checks public destination bytes and recovery metadata before the first native source unlink', async () => {
    const production = { ...config, requirePersistentData: true };
    const metadata = new FileMetadataManager(config, store);
    managers.push(metadata);
    await metadata.initialize();
    const guarded = new WorkspaceService(production, store, { checkpointFileMetadata: () => metadata.capture() });
    await guarded.initialize();
    await guarded.writeFile(workspace.id, 'source/regular', 'durable content');
    await guarded.createEntry(workspace.id, 'source/empty', 'directory');
    await fs.symlink('regular', path.join(workspace.path, 'source/link'));
    // The transport is controlled; all compared objects are real filesystem bytes.
    vi.spyOn(resources, 'assessHostAdmission').mockReturnValue({ allowed: true, status: 'allowed', reason: 'Fixture admission', ceilingBytes: 90_000_000_000, headroomBytes: 80_000_000_000, requiredBytes: 2_268_435_456 });
    const confirmed = new Set<string>();
    const network = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, request) => {
      const url = new URL(String(input));
      expect(url.origin).toBe('https://huggingface.co');
      const prefix = `/buckets/${config.bucket}/resolve/`;
      expect(url.pathname.startsWith(prefix)).toBe(true);
      const relative = url.pathname.slice(prefix.length).split('/').map(decodeURIComponent).join('/');
      if (request?.method === 'HEAD') {
        await expect(fs.lstat(path.join(config.dataDir, relative))).rejects.toMatchObject({ code: 'ENOENT' });
        return new Response(null, { status: 404 });
      }
      const bytes = await fs.readFile(path.join(config.dataDir, relative));
      confirmed.add(relative);
      return new Response(new Uint8Array(bytes));
    });
    const unlink = fs.unlink.bind(fs);
    let sourceUnlinks = 0;
    vi.spyOn(fs, 'unlink').mockImplementation(async target => {
      if (String(target).endsWith('/regular') || String(target).endsWith('/link')) {
        sourceUnlinks++;
        expect(confirmed.has(`workspaces/${workspace.id}/target/regular`)).toBe(true);
        expect([...confirmed].some(item => /file-transfer-tree-[a-f0-9-]+\.json$/.test(item))).toBe(true);
        expect([...confirmed].some(item => /file-transfer-[a-f0-9-]+\.json$/.test(item))).toBe(true);
        expect(confirmed.has(`codex-workspace/state/${FILE_METADATA_KEY}.json`)).toBe(true);
      }
      await unlink(target);
    });
    await guarded.renameEntry(workspace.id, 'source', 'target');
    expect(sourceUnlinks).toBe(2);
    expect(network).toHaveBeenCalled();
    expect(await fs.readFile(path.join(workspace.path, 'target/regular'), 'utf8')).toBe('durable content');
    expect(await fs.readlink(path.join(workspace.path, 'target/link'))).toBe('regular');
    await expect(fs.lstat(path.join(workspace.path, 'source'))).rejects.toMatchObject({ code: 'ENOENT' });
    const retained = await store.read<{ entries: { path: string }[] }>(FILE_METADATA_KEY, { entries: [] });
    expect(retained.entries.some(entry => entry.path.startsWith(`${workspace.id}/source`))).toBe(false);
  });

  it('refuses a persistent production move before writes if metadata durability cannot be confirmed', async () => {
    await fs.writeFile(path.join(workspace.path, 'source'), 'keep');
    await expect(transferWorkspaceEntry({ ...config, requirePersistentData: true }, store, options()))
      .rejects.toMatchObject({ status: 503, code: 'FILE_TRANSFER_DURABILITY_UNAVAILABLE' });
    expect(await fs.readFile(path.join(workspace.path, 'source'), 'utf8')).toBe('keep');
    await expect(fs.lstat(path.join(workspace.path, 'target'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await service.listFileTransfers(workspace.id)).toEqual([]);
  });

  it('refuses new transfer work when the host memory admission check has insufficient headroom', async () => {
    await fs.writeFile(path.join(workspace.path, 'source'), 'keep');
    vi.spyOn(resources, 'assessHostAdmission').mockReturnValue({ allowed: false, status: 'refused', reason: 'Fixture pressure', ceilingBytes: 90_000_000_000, headroomBytes: 1_000_000_000, requiredBytes: 2_268_435_456 });
    await expect(transferWorkspaceEntry({ ...config, production: true }, store, options()))
      .rejects.toMatchObject({ status: 503, code: 'FILE_TRANSFER_RESOURCES' });
    expect(await fs.readFile(path.join(workspace.path, 'source'), 'utf8')).toBe('keep');
    await expect(fs.lstat(path.join(workspace.path, 'target'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await service.listFileTransfers(workspace.id)).toEqual([]);
  });

  it('serves Move, Copy, recovery status, and scoped manual-intent events through the real router', async () => {
    const app = express();
    const events = new EventEmitter();
    const observed: { event: string; value: { workspaceId: string; paths?: string[]; phase?: string } }[] = [];
    for (const event of ['workspace:manual-intent', 'workspace:changed']) events.on(event, value => { observed.push({ event, value }); });
    app.use(express.json());
    app.use('/api', createWorkspaceRouter({ config, store, workspaces: service, events } as AppContext));
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(error instanceof HttpError ? error.status : 500).json({ error: error instanceof Error ? error.message : 'Error', code: error instanceof HttpError ? error.code : undefined });
    });
    const server = createServer(app); servers.push(server);
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test listener');
    const base = `http://127.0.0.1:${address.port}/api/workspaces/${workspace.id}`;
    await service.writeFile(workspace.id, 'source/file.txt', 'disk bytes');
    const post = (route: string, value: object) => fetch(`${base}/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    const copy = await post('copy', { path: 'source', newPath: './copy' });
    expect(copy.status).toBe(200);
    expect(await copy.json()).toEqual({ copied: true, path: 'copy' });
    const move = await post('rename', { path: 'source', newPath: 'moved' });
    expect(move.status).toBe(200);
    expect(await move.json()).toEqual({ renamed: true });
    const collision = await post('copy', { path: 'moved', newPath: 'copy' });
    expect(collision.status).toBe(409);
    expect(await collision.json()).toMatchObject({ code: 'FILE_EXISTS' });
    const status = await fetch(`${base}/file-transfers`);
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual([]);
    expect(observed.filter(item => item.value.phase === 'start').map(item => item.value.paths)).toEqual([['copy'], ['source', 'moved'], ['copy']]);
    expect(observed.filter(item => item.event === 'workspace:changed').map(item => item.value.paths)).toEqual([['copy'], ['source', 'moved'], ['copy']]);
    expect((await service.readFile(workspace.id, 'copy/file.txt')).content).toBe('disk bytes');
    expect((await service.readFile(workspace.id, 'moved/file.txt')).content).toBe('disk bytes');
  });
});
