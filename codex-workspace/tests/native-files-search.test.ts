import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AuthService } from '../server/auth';
import { loadConfig } from '../server/config';
import type { AppContext } from '../server/context';
import { HttpError } from '../server/errors';
import { JsonStore, SecretStore } from '../server/store';
import { defaultSettings } from '../server/settings';
import { WorkspaceService } from '../server/workspaces';
import { setWorkspaceRecoveryBarrier, clearWorkspaceRecoveryBarrier, withWorkspaceRemoval, workspaceIsBusy } from '../server/worktrees/activity';
import type { CodexBridge } from '../server/codex-cli/bridge';
import type { NativeNotification, NativeServerRequest, RpcId } from '../server/codex-cli/rpc';
import type { NativeFeatureDependencies } from '../server/codex-cli/features/common';
import { createNativeFilesSearchRouter, NativeFilesSearchService } from '../server/codex-cli/features/files-search';
import { copyNativeFile, createNativeDirectory, listNativeDirectory, metadataNativeFile, nativeBase64,
  readNativeFile, removeNativeFile, writeNativeFile, NATIVE_DIRECTORY_ENTRIES } from '../server/codex-cli/features/files-search-filesystem';
import type { CodexRuntimeStatus, ThreadSummary, Workspace } from '../shared/types';
import { NATIVE_FILE_BYTES } from '../shared/native-files-search';

const THREAD_A = '01990000-0000-7000-8000-000000000001', THREAD_B = '01990000-0000-7000-8000-000000000002';
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const base64 = (value: string) => Buffer.from(value).toString('base64');
const stamp = '2026-09-30T00:00:00.000Z';

/** The fixture implements native IO requests on real owned temporary files.
 * No model service, agent, live user state or Codex installation is started. */
class Bridge implements CodexBridge {
  current = 'native-files-generation-1';
  calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  handlers = new Map<string, (params: Record<string, unknown>) => unknown | Promise<unknown>>();
  notifications = new Set<(message: NativeNotification, generation: string) => void>();
  connections = new Set<(state: 'ready' | 'closed', generation: string) => void>();
  generation() { return this.current; }
  supports() { return true; }
  status(): CodexRuntimeStatus { return { backend: 'codex-cli', state: 'ready', version: '0.159.2', installedVersion: '0.159.2', startedAt: stamp,
    updatedAt: stamp, canUpdate: false, updateBlockedReason: null, error: null, activeTurns: 0,
    capabilities: { conversations: true, pagination: true, queue: true, goals: true, skills: true, plan: true, review: true, historyRevert: true } }; }
  async request<T>(method: string, input: unknown = {}): Promise<T> {
    const params = input as Record<string, unknown>; this.calls.push({ method, params: structuredClone(params) });
    const handler = this.handlers.get(method); if (handler) return await handler(params) as T;
    if (method === 'fs/readFile') return { dataBase64: (await fs.readFile(String(params.path))).toString('base64') } as T;
    if (method === 'fs/writeFile') { await fs.writeFile(String(params.path), Buffer.from(String(params.dataBase64), 'base64')); return {} as T; }
    if (method === 'fs/copy') { await fs.copyFile(String(params.sourcePath), String(params.destinationPath)); return {} as T; }
    if (method === 'fs/createDirectory') { await fs.mkdir(String(params.path), { recursive: params.recursive === true }); return {} as T; }
    if (method === 'fs/remove') { await fs.rm(String(params.path), { recursive: params.recursive === true, force: params.force === true }); return {} as T; }
    if (method === 'fs/getMetadata') {
      const stat = await fs.stat(String(params.path)), link = await fs.lstat(String(params.path));
      return { isFile: stat.isFile(), isDirectory: stat.isDirectory(), isSymlink: link.isSymbolicLink(), createdAtMs: stat.birthtimeMs, modifiedAtMs: stat.mtimeMs } as T;
    }
    if (method === 'fs/readDirectory') {
      const entries = [];
      for (const fileName of await fs.readdir(String(params.path))) {
        const stat = await fs.stat(path.join(String(params.path), fileName)).catch(() => null);
        entries.push({ fileName, isFile: stat?.isFile() ?? false, isDirectory: stat?.isDirectory() ?? false });
      }
      return { entries } as T;
    }
    if (method === 'fs/watch') return { path: await fs.realpath(String(params.path)) } as T;
    if (method === 'fs/unwatch' || method.startsWith('fuzzyFileSearch/session')) return {} as T;
    throw new Error(`Unexpected native files fixture request: ${method}`);
  }
  respond(_id: RpcId, _result: unknown, _generation: string): void { throw new Error('Files do not answer server requests.'); }
  rejectRequest(_id: RpcId, _message: string, _generation: string): void { throw new Error('Files do not answer server requests.'); }
  onNotification(listener: (message: NativeNotification, generation: string) => void) { this.notifications.add(listener); return () => { this.notifications.delete(listener); }; }
  onRequest(_listener: (message: NativeServerRequest, generation: string) => void) { return () => undefined; }
  onConnection(listener: (state: 'ready' | 'closed', generation: string) => void) { this.connections.add(listener); return () => { this.connections.delete(listener); }; }
  notify(method: string, params: Record<string, unknown>, generation = this.current) { for (const listener of this.notifications) listener({ method, params }, generation); }
  reconnect() {
    for (const listener of this.connections) listener('closed', this.current);
    this.current = 'native-files-generation-2';
    for (const listener of this.connections) listener('ready', this.current);
  }
}

let temporary: string, ctx: AppContext, workspace: Workspace, other: Workspace, bridge: Bridge, deps: NativeFeatureDependencies;
let service: NativeFilesSearchService;
const cleanups: Array<() => void | Promise<void>> = [];

beforeEach(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-native-files-test-'));
  const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: temporary, WORKSPACE_PASSWORD: 'native-file-test-password', SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'e'.repeat(64) });
  const store = new JsonStore(config.stateDir), secrets = new SecretStore(store, config.encryptionKey);
  ctx = { config, store, secrets, workspaces: new WorkspaceService(config, store), events: new EventEmitter(),
    settings: async () => ({ ...defaultSettings }), saveSettings: async () => ({ ...defaultSettings }), providerKey: async () => undefined };
  await ctx.workspaces.initialize(); workspace = await ctx.workspaces.create({ name: 'Native files' }); other = await ctx.workspaces.create({ name: 'Other workspace' });
  bridge = new Bridge();
  deps = { ctx, bridge, registerCleanup: cleanup => cleanups.push(cleanup), authorizeThread: vi.fn(async (workspaceId, threadId) => {
    const expected = threadId === THREAD_A ? workspace.id : threadId === THREAD_B ? other.id : null;
    if (!expected || expected !== workspaceId) throw new HttpError(404, 'Conversation not found.', 'THREAD_NOT_FOUND');
    return { id: threadId, workspaceId, backend: 'codex-cli', title: threadId === THREAD_A ? 'Owned conversation' : 'Other conversation', status: 'idle', createdAt: stamp, updatedAt: stamp } as ThreadSummary;
  }) };
  service = new NativeFilesSearchService(deps);
});

afterEach(async () => {
  vi.useRealTimers();
  clearWorkspaceRecoveryBarrier(ctx.config.workspacesDir, workspace.id, 'test-recovery');
  await Promise.allSettled(cleanups.splice(0).map(cleanup => Promise.resolve().then(cleanup)));
  await ctx.workspaces.closeFileTrashPages(); await ctx.workspaces.closeTrashCleanup();
  await fs.rm(temporary, { recursive: true, force: true });
});

async function file(relative: string, content = 'original') {
  await fs.mkdir(path.dirname(path.join(workspace.path, relative)), { recursive: true });
  await fs.writeFile(path.join(workspace.path, relative), content); return digest(content);
}
async function until(test: () => boolean | Promise<boolean>) {
  const end = Date.now() + 3000;
  while (!await test()) { if (Date.now() > end) throw new Error('Native fixture notification did not settle.'); await new Promise(resolve => setTimeout(resolve, 5)); }
}

describe('native bounded workspace files', () => {
  it('calls native filesystem methods while keeping complete bytes and relative browser paths', async () => {
    const hash = await file('src/example.txt', 'small\n🙂');
    const result = await readNativeFile(deps, workspace.id, 'src/example.txt');
    expect(result).toEqual({ path: 'src/example.txt', dataBase64: base64('small\n🙂'), bytes: Buffer.byteLength('small\n🙂'), version: hash });
    expect(bridge.calls.at(-1)?.params.path).toMatch(new RegExp(`^/proc/${process.pid}/fd/\\d+$`));
    const metadata = await metadataNativeFile(deps, workspace.id, 'src/example.txt');
    expect(metadata).toMatchObject({ path: 'src/example.txt', kind: 'file', version: hash, canReadWholeFile: true });
    expect(JSON.stringify(result)).not.toContain(workspace.path);
  });

  it('rejects absolute paths, traversal, protected Git metadata and internal or external symlinks before native dispatch', async () => {
    await file('safe.txt'); await fs.symlink(path.join(workspace.path, 'safe.txt'), path.join(workspace.path, 'internal-link'));
    await fs.writeFile(path.join(other.path, 'secret.txt'), 'foreign'); await fs.symlink(other.path, path.join(workspace.path, 'escape'));
    for (const selected of ['/etc/passwd', '../other/secret', 'C:/secret', 'safe/../safe.txt', '.git/config', '.codex-write-owned', 'escape/secret.txt', 'internal-link']) {
      await expect(readNativeFile(deps, workspace.id, selected)).rejects.toMatchObject({ status: expect.any(Number) });
    }
    expect(bridge.calls).toHaveLength(0);
  });

  it('blocks large whole-file reads and writes rather than treating a page as the whole file', async () => {
    const content = Buffer.alloc(NATIVE_FILE_BYTES + 1, 97); await fs.writeFile(path.join(workspace.path, 'large.txt'), content);
    await expect(readNativeFile(deps, workspace.id, 'large.txt')).rejects.toMatchObject({ code: 'NATIVE_FILE_PAGE_REQUIRED' });
    await expect(writeNativeFile(deps, workspace.id, 'large.txt', base64('one page'), digest(content))).rejects.toMatchObject({ code: 'NATIVE_FILE_PAGE_REQUIRED' });
    expect(await fs.readFile(path.join(workspace.path, 'large.txt'))).toEqual(content); expect(bridge.calls).toHaveLength(0);
    expect(nativeBase64(Buffer.alloc(NATIVE_FILE_BYTES, 97).toString('base64'))).toHaveLength(NATIVE_FILE_BYTES);
    expect(() => nativeBase64(Buffer.alloc(NATIVE_FILE_BYTES + 1).toString('base64'))).toThrow();
    for (const value of ['abc', 'YWJj\n', 'YR==', '-___']) expect(() => nativeBase64(value)).toThrow();
  });

  it('bounds native read allocation even when an original file grows during dispatch', async () => {
    await file('growing.log', 'initial'); let nativeReadBytes = 0;
    bridge.handlers.set('fs/readFile', async params => {
      await fs.writeFile(path.join(workspace.path, 'growing.log'), Buffer.alloc(NATIVE_FILE_BYTES * 3, 120));
      const bytes = await fs.readFile(String(params.path)); nativeReadBytes = bytes.length;
      return { dataBase64: bytes.toString('base64') };
    });
    await expect(readNativeFile(deps, workspace.id, 'growing.log')).rejects.toMatchObject({ code: 'NATIVE_FILE_CONFLICT' });
    expect(nativeReadBytes).toBe(7);
  });

  it('requires exact whole-file versions, preserves permissions, and publishes newly created files without clobbering', async () => {
    const version = await file('save.txt'); await fs.chmod(path.join(workspace.path, 'save.txt'), 0o640);
    await expect(writeNativeFile(deps, workspace.id, 'save.txt', base64('new'), null)).rejects.toMatchObject({ code: 'FILE_EXISTS' });
    await expect(writeNativeFile(deps, workspace.id, 'save.txt', base64('new'), digest('stale'))).rejects.toMatchObject({ code: 'NATIVE_FILE_CONFLICT' });
    const saved = await writeNativeFile(deps, workspace.id, 'save.txt', base64('new'), version);
    expect(saved.version).toBe(digest('new')); expect(await fs.readFile(path.join(workspace.path, 'save.txt'), 'utf8')).toBe('new');
    expect((await fs.stat(path.join(workspace.path, 'save.txt'))).mode & 0o777).toBe(0o640);
    expect((await writeNativeFile(deps, workspace.id, 'new.txt', base64('created'), null)).bytes).toBe(7);
    expect((await fs.readdir(workspace.path)).some(name => name.startsWith('.codex-write-'))).toBe(false);
  });

  it('retains externally edited files when a native staged write races a real filesystem change', async () => {
    const version = await file('save.txt');
    bridge.handlers.set('fs/writeFile', async params => {
      await fs.writeFile(String(params.path), Buffer.from(String(params.dataBase64), 'base64'));
      await fs.writeFile(path.join(workspace.path, 'save.txt'), 'terminal edit'); return {};
    });
    await expect(writeNativeFile(deps, workspace.id, 'save.txt', base64('overwrite'), version)).rejects.toMatchObject({ code: 'NATIVE_FILE_CONFLICT' });
    expect(await fs.readFile(path.join(workspace.path, 'save.txt'), 'utf8')).toBe('terminal edit');
  });

  it('does not follow a replaced ancestor into another workspace during native staging', async () => {
    const version = await file('src/file.txt'); await fs.writeFile(path.join(other.path, 'file.txt'), 'outside kept');
    bridge.handlers.set('fs/writeFile', async params => {
      await fs.rename(path.join(workspace.path, 'src'), path.join(workspace.path, 'retained-src'));
      await fs.symlink(other.path, path.join(workspace.path, 'src'));
      await fs.writeFile(String(params.path), Buffer.from(String(params.dataBase64), 'base64')); return {};
    });
    await expect(writeNativeFile(deps, workspace.id, 'src/file.txt', base64('native'), version)).rejects.toMatchObject({ status: expect.any(Number) });
    expect(await fs.readFile(path.join(other.path, 'file.txt'), 'utf8')).toBe('outside kept');
    expect(await fs.readFile(path.join(workspace.path, 'retained-src/file.txt'), 'utf8')).toBe('original');
  });

  it('uses the managed-worktree removal and file recovery barriers', async () => {
    await withWorkspaceRemoval(ctx.config.workspacesDir, workspace.id, async () => {
      await expect(writeNativeFile(deps, workspace.id, 'new.txt', base64('x'), null)).rejects.toMatchObject({ code: 'WORKTREE_BUSY' });
    });
    setWorkspaceRecoveryBarrier(ctx.config.workspacesDir, workspace.id, { recoveryId: 'test-recovery', message: 'Resolve the checked file recovery first.' });
    await expect(createNativeDirectory(deps, workspace.id, 'new-folder')).rejects.toMatchObject({ code: 'FILE_REWIND_RECOVERY_REQUIRED' });
    expect(bridge.calls).toHaveLength(0);
  });

  it('creates one native folder, copies checked files exclusively, and refuses recursive native copies', async () => {
    await createNativeDirectory(deps, workspace.id, 'target');
    const version = await file('source.txt', 'copy contents');
    const result = await copyNativeFile(deps, workspace.id, 'source.txt', 'target/copied.txt', version);
    expect(result.version).toBe(version); expect(await fs.readFile(path.join(workspace.path, 'target/copied.txt'), 'utf8')).toBe('copy contents');
    await expect(copyNativeFile(deps, workspace.id, 'source.txt', 'target/copied.txt', version)).rejects.toMatchObject({ code: 'FILE_EXISTS' });
    await expect(copyNativeFile(deps, workspace.id, 'target', 'folder-copy', version)).rejects.toMatchObject({ code: 'NATIVE_REGULAR_FILE_REQUIRED' });
    expect(bridge.calls.filter(call => call.method === 'fs/copy')).toHaveLength(1);
    expect(bridge.calls.find(call => call.method === 'fs/copy')?.params.recursive).toBe(false);
  });

  it('retains a verified durable trash copy before native file removal and restores it through the existing service', async () => {
    const version = await file('remove.txt', 'recoverable');
    const removed = await removeNativeFile(deps, workspace.id, 'remove.txt', version);
    await expect(fs.stat(path.join(workspace.path, 'remove.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(removed.trashId).toMatch(/^[a-f0-9-]{36}$/);
    const record = await ctx.workspaces.getTrashEntry(workspace.id, removed.trashId!);
    expect(record.path).toBe('remove.txt'); expect(Date.parse(record.expiresAt) - Date.parse(record.deletedAt)).toBe(30 * 24 * 60 * 60 * 1000);
    await ctx.workspaces.restoreEntry(workspace.id, removed.trashId!);
    expect(await fs.readFile(path.join(workspace.path, 'remove.txt'), 'utf8')).toBe('recoverable');
    expect(bridge.calls.find(call => call.method === 'fs/remove')?.params).toMatchObject({ force: false, recursive: false });
  });

  it('leaves originals intact on native rejection and never silently substitutes a local mutation', async () => {
    const version = await file('retained.txt');
    bridge.handlers.set('fs/writeFile', () => { throw new HttpError(501, 'Native file writing is unsupported.', 'CODEX_METHOD_UNAVAILABLE'); });
    await expect(writeNativeFile(deps, workspace.id, 'retained.txt', base64('new'), version)).rejects.toMatchObject({ code: 'CODEX_METHOD_UNAVAILABLE' });
    expect(await fs.readFile(path.join(workspace.path, 'retained.txt'), 'utf8')).toBe('original');
    bridge.handlers.set('fs/remove', () => { throw new HttpError(501, 'Native removal is unsupported.', 'CODEX_METHOD_UNAVAILABLE'); });
    await expect(removeNativeFile(deps, workspace.id, 'retained.txt', version)).rejects.toMatchObject({ code: 'CODEX_METHOD_UNAVAILABLE' });
    expect(await fs.readFile(path.join(workspace.path, 'retained.txt'), 'utf8')).toBe('original');
  });

  it('keeps delayed native removals away from a workspace path that an external writer changed', async () => {
    const version = await file('delayed.txt', 'checked version');
    bridge.handlers.set('fs/remove', async params => {
      expect(String(params.path)).not.toContain(workspace.path);
      await fs.writeFile(path.join(workspace.path, 'delayed.txt'), 'new external version');
      await fs.rm(String(params.path)); return {};
    });
    await expect(removeNativeFile(deps, workspace.id, 'delayed.txt', version)).rejects.toMatchObject({ code: 'NATIVE_FILE_CONFLICT' });
    expect(await fs.readFile(path.join(workspace.path, 'delayed.txt'), 'utf8')).toBe('new external version');
  });

  it('pages real native directory results and rejects stale or cross-workspace cursors', async () => {
    await Promise.all(Array.from({ length: 7 }, (_, index) => file(`file-${index}.txt`, String(index))));
    await fs.mkdir(path.join(workspace.path, '.git')); await fs.symlink(other.path, path.join(workspace.path, 'unsafe-link'));
    const first = await service.directory(workspace.id, { limit: 3 });
    expect(first.entries).toHaveLength(3); expect(first.total).toBe(7);
    const next = await service.directory(workspace.id, { limit: 3, cursor: first.nextCursor! });
    expect(next.entries).toHaveLength(3); expect(new Set([...first.entries, ...next.entries].map(entry => entry.path)).size).toBe(6);
    await expect(service.directory(other.id, { limit: 3, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'NATIVE_PAGE_STALE' });
    await file('later.txt');
    await expect(service.directory(workspace.id, { limit: 3, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'NATIVE_PAGE_STALE' });
  });

  it('refuses native unpaginated enumeration of an oversized directory before calling native', async () => {
    for (let offset = 0; offset <= NATIVE_DIRECTORY_ENTRIES; offset += 80) {
      await Promise.all(Array.from({ length: Math.min(80, NATIVE_DIRECTORY_ENTRIES + 1 - offset) }, (_, index) => file(`entry-${offset + index}`, '')));
    }
    await expect(listNativeDirectory(deps, workspace.id, '')).rejects.toMatchObject({ code: 'NATIVE_DIRECTORY_PAGE_REQUIRED' });
    expect(bridge.calls).toHaveLength(0);
  });
});

describe('native file search and notification lifetimes', () => {
  const match = (root: string, selected: string) => ({ root, path: selected, match_type: 'file', file_name: path.basename(selected), score: 1, indices: null });

  it('confines one-shot native search roots and filters absolute, traversal, symlink and foreign results', async () => {
    await file('safe.txt'); await fs.writeFile(path.join(other.path, 'secret'), 'private'); await fs.symlink(other.path, path.join(workspace.path, 'alias'));
    bridge.handlers.set('fuzzyFileSearch', params => {
      expect(params.roots).toEqual([workspace.path]);
      return { files: [match(workspace.path, 'safe.txt'), match(workspace.path, '../secret'), match(workspace.path, '/etc/passwd'),
        match(workspace.path, 'alias/secret'), match(other.path, 'secret'), match(workspace.path, 'safe.txt')] };
    });
    const page = await service.searchFiles(workspace.id, { query: 's' });
    expect(page.files.map(item => item.path)).toEqual(['safe.txt']); expect(JSON.stringify(page)).not.toContain(other.path);
    await expect(service.searchFiles(workspace.id, { root: '/etc', query: '' })).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
  });

  it('bounds watched path notifications, scopes tokens to workspaces, and stops native watches on demand', async () => {
    await fs.mkdir(path.join(workspace.path, 'src'));
    const watch = await service.startWatch(workspace.id, 'src');
    expect(workspaceIsBusy(ctx.config.workspacesDir, workspace.id)).toBe(true);
    bridge.notify('fs/changed', { watchId: watch.id, changedPaths: [path.join(workspace.path, 'src/inside.txt'), path.join(workspace.path, 'outside.txt'), path.join(other.path, 'secret'), path.join(workspace.path, 'src/.git/config')] });
    expect(await service.watchPage(workspace.id, watch.id)).toMatchObject({ paths: ['src/inside.txt'], revision: 1 });
    await expect(service.watchPage(other.id, watch.id)).rejects.toMatchObject({ code: 'NATIVE_SESSION_EXPIRED' });
    for (let index = 0; index < 20; index++) bridge.notify('fs/changed', { watchId: watch.id, changedPaths: [path.join(workspace.path, `src/file-${index}`)] });
    expect(await service.watchPage(workspace.id, watch.id)).toMatchObject({ truncated: true });
    await service.stopWatch(workspace.id, watch.id);
    expect(bridge.calls.at(-1)).toMatchObject({ method: 'fs/unwatch', params: { watchId: watch.id } });
    expect(workspaceIsBusy(ctx.config.workspacesDir, workspace.id)).toBe(false);
  });

  it('keeps resource leases until native stop is acknowledged', async () => {
    const watch = await service.startWatch(workspace.id, '');
    let acknowledge!: () => void;
    bridge.handlers.set('fs/unwatch', () => new Promise<void>(resolve => { acknowledge = resolve; }));
    const stopping = service.stopWatch(workspace.id, watch.id);
    await until(() => !!acknowledge);
    expect(workspaceIsBusy(ctx.config.workspacesDir, workspace.id)).toBe(true);
    acknowledge(); await stopping;
    expect(workspaceIsBusy(ctx.config.workspacesDir, workspace.id)).toBe(false);
  });

  it('accepts the actual 0.159.2 descriptor watch response and remaps descriptor notifications to workspace paths', async () => {
    bridge.handlers.set('fs/watch', params => ({ path: params.path }));
    const watch = await service.startWatch(workspace.id, '');
    const nativePath = String(bridge.calls.find(call => call.method === 'fs/watch')!.params.path);
    expect(await fs.realpath(nativePath)).toBe(workspace.path);
    bridge.notify('fs/changed', { watchId: watch.id, changedPaths: [`${nativePath}/file.txt`] });
    expect(await service.watchPage(workspace.id, watch.id)).toMatchObject({ paths: ['file.txt'], revision: 1 });
    await service.stopWatch(workspace.id, watch.id);
    await expect(fs.realpath(nativePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('drains logout cleanup before shutdown releases native watch ownership', async () => {
    await service.startWatch(workspace.id, '');
    let acknowledge!: () => void;
    bridge.handlers.set('fs/unwatch', () => new Promise<void>(resolve => { acknowledge = resolve; }));
    ctx.events.emit('auth:logout');
    await until(() => !!acknowledge);
    let closed = false;
    const closing = service.close().then(() => { closed = true; });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(closed).toBe(false); expect(workspaceIsBusy(ctx.config.workspacesDir, workspace.id)).toBe(true);
    acknowledge(); await closing;
    expect(workspaceIsBusy(ctx.config.workspacesDir, workspace.id)).toBe(false);
  });

  it('uses start/update/stop and current query notifications for native live searches', async () => {
    await file('alpha.txt'); await file('beta.txt');
    const session = await service.startSearch(workspace.id, '');
    await service.updateSearch(workspace.id, session.id, 'alpha');
    bridge.notify('fuzzyFileSearch/sessionUpdated', { sessionId: session.id, query: 'old', files: [match(workspace.path, 'beta.txt')] });
    bridge.notify('fuzzyFileSearch/sessionUpdated', { sessionId: session.id, query: 'alpha', files: [match(workspace.path, 'alpha.txt')] }, 'old-generation');
    expect((await service.searchPage(workspace.id, session.id)).files).toHaveLength(0);
    bridge.notify('fuzzyFileSearch/sessionUpdated', { sessionId: session.id, query: 'alpha', files: [match(workspace.path, 'alpha.txt')] });
    await until(async () => (await service.searchPage(workspace.id, session.id)).files.length === 1);
    bridge.notify('fuzzyFileSearch/sessionCompleted', { sessionId: session.id });
    expect(await service.searchPage(workspace.id, session.id)).toMatchObject({ query: 'alpha', status: 'complete', files: [{ path: 'alpha.txt' }] });
    await expect(service.updateSearch(other.id, session.id, 'beta')).rejects.toMatchObject({ code: 'NATIVE_SESSION_EXPIRED' });
    await service.stopSearch(workspace.id, session.id);
    expect(bridge.calls.map(call => call.method)).toEqual(['fuzzyFileSearch/sessionStart', 'fuzzyFileSearch/sessionUpdate', 'fuzzyFileSearch/sessionStop']);
  });

  it('expires native watch/search state and never replays it on a new connection', async () => {
    const watch = await service.startWatch(workspace.id, ''), search = await service.startSearch(workspace.id, '');
    bridge.reconnect();
    await expect(service.watchPage(workspace.id, watch.id)).rejects.toMatchObject({ code: 'NATIVE_SESSION_EXPIRED' });
    await expect(service.searchPage(workspace.id, search.id)).rejects.toMatchObject({ code: 'NATIVE_SESSION_EXPIRED' });
    expect(workspaceIsBusy(ctx.config.workspacesDir, workspace.id)).toBe(false);
    expect(bridge.calls.filter(call => /sessionUpdate/.test(call.method))).toHaveLength(0);
  });

  it('releases abandoned resources after an idle limit and closes native listeners during shutdown', async () => {
    const watch = await service.startWatch(workspace.id, ''), search = await service.startSearch(workspace.id, '');
    const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 121_000);
    // Timer behavior is exercised without taking over the real filesystem's timers.
    await new Promise<void>(resolve => { const timer = setInterval(() => {
      if (bridge.calls.some(call => call.method === 'fs/unwatch')) { clearInterval(timer); resolve(); }
    }, 25); });
    await expect(service.watchPage(workspace.id, watch.id)).rejects.toMatchObject({ code: 'NATIVE_SESSION_EXPIRED' });
    await expect(service.searchPage(workspace.id, search.id)).rejects.toMatchObject({ code: 'NATIVE_SESSION_EXPIRED' });
    await service.close();
    expect(bridge.notifications.size).toBe(0); expect(bridge.connections.size).toBe(0);
  }, 20_000);
});

describe('workspace-scoped native conversation search and attachment metadata', () => {
  it('authorizes every result from native global thread search and binds opaque cursors to query/workspace', async () => {
    bridge.handlers.set('thread/search', params => {
      expect(params.searchTerm).toBe('needle'); expect(params.limit).toBe(2);
      if (params.cursor) expect(params.cursor).toBe('native opaque /=+ cursor');
      return { data: [
        { thread: { id: THREAD_A, cwd: workspace.path, turns: [{ private: 'not rendered' }] }, snippet: 'Owned needle' },
        { thread: { id: THREAD_B, cwd: other.path, turns: [] }, snippet: 'Foreign needle secret' },
      ], nextCursor: params.cursor ? null : 'native opaque /=+ cursor', backwardsCursor: null };
    });
    const first = await service.searchThreads(workspace.id, { query: 'needle', limit: 2 });
    expect(first.matches).toEqual([{ threadId: THREAD_A, title: 'Owned conversation', updatedAt: stamp, snippet: 'Owned needle' }]);
    expect(JSON.stringify(first)).not.toContain('Foreign'); expect(JSON.stringify(first)).not.toContain('private');
    await service.searchThreads(workspace.id, { query: 'needle', limit: 2, cursor: first.nextCursor! });
    await expect(service.searchThreads(other.id, { query: 'needle', limit: 2, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'NATIVE_PAGE_STALE' });
    await expect(service.searchThreads(workspace.id, { query: 'different', limit: 2, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'NATIVE_PAGE_STALE' });
  });

  it('retains occurrence UTF-16 ranges and opaque turn cursors without reading unauthorized histories', async () => {
    bridge.handlers.set('thread/searchOccurrences', () => ({ data: [{ turnId: 'turn-a', itemId: 'item-a', snippet: '🙂 needle',
      snippetMatchRange: { start: 3, end: 9 }, turnCursor: 'native turn /=+ inclusive' }], nextCursor: null }));
    expect(await service.occurrences(workspace.id, THREAD_A, { query: 'needle' })).toMatchObject({ occurrences: [{ snippet: '🙂 needle', matchRange: { start: 3, end: 9 }, turnCursor: 'native turn /=+ inclusive' }] });
    await expect(service.occurrences(other.id, THREAD_A, { query: 'needle' })).rejects.toMatchObject({ status: 404 });
    expect(bridge.calls).toHaveLength(1);
  });

  it('adds notes and checked file references as metadata without giving pending attachments to model history or copying files', async () => {
    await file('reference.txt');
    bridge.handlers.set('thread/attachment/add', params => ({ outcome: 'created', attachment: { id: randomUUID(), attachmentType: params.attachmentType,
      identityKey: params.identityKey, payload: params.payload, createdAt: 123 } }));
    const added = await service.addReference(workspace.id, THREAD_A, { kind: 'note', title: 'Note', text: 'Saved separately', clientId: randomUUID() });
    expect(added.reference).toMatchObject({ kind: 'note', title: 'Note', text: 'Saved separately' });
    await service.addReference(workspace.id, THREAD_A, { kind: 'workspace-file', title: 'Source', path: 'reference.txt', clientId: randomUUID() });
    expect(bridge.calls.map(call => call.method)).toEqual(['thread/attachment/add', 'thread/attachment/add']);
    expect(bridge.calls.at(-1)?.params.payload).toMatchObject({ version: 1, workspaceId: workspace.id, path: 'reference.txt' });
    await expect(service.addReference(workspace.id, THREAD_A, { kind: 'workspace-file', title: 'Outside', path: '../private', clientId: randomUUID() })).rejects.toBeDefined();
  });

  it('does not add native attachment metadata while its workspace is being removed', async () => {
    await withWorkspaceRemoval(ctx.config.workspacesDir, workspace.id, async () => {
      await expect(service.addReference(workspace.id, THREAD_A, { kind: 'note', title: 'Deferred', text: 'Preserve workspace ownership.', clientId: randomUUID() }))
        .rejects.toMatchObject({ code: 'WORKTREE_BUSY' });
    });
    expect(bridge.calls).toHaveLength(0);
  });

  it('projects unknown native attachments without raw payloads and authorizes notifications and removals exactly', async () => {
    let attachment = { id: 'saved-1', attachmentType: 'unknown.native.kind', identityKey: 'opaque-record', payload: { secret: 'must not appear', path: '/etc/private' }, createdAt: 123 };
    bridge.handlers.set('thread/attachment/list', () => ({ data: [attachment], nextCursor: null }));
    bridge.handlers.set('thread/attachment/remove', () => ({}));
    const page = await service.references(workspace.id, THREAD_A);
    expect(page.references[0]).toMatchObject({ kind: 'other', title: 'Saved thread reference' });
    expect(JSON.stringify(page)).not.toContain('must not appear'); expect(JSON.stringify(page)).not.toContain('/etc');
    expect(Buffer.from(page.references[0].reference.split('.')[0], 'base64url').toString()).not.toContain(attachment.identityKey);
    bridge.notify('thread/attachment/updated', { threadId: THREAD_A, operation: 'created' });
    expect(await service.referenceRevision(workspace.id, THREAD_A)).toEqual({ revision: 1 });
    await expect(service.removeReference(other.id, THREAD_B, page.references[0].reference)).rejects.toMatchObject({ code: 'NATIVE_PAGE_STALE' });
    attachment = { ...attachment, id: 'replaced-new-id' };
    await expect(service.removeReference(workspace.id, THREAD_A, page.references[0].reference)).rejects.toMatchObject({ code: 'NATIVE_PAGE_STALE' });
    expect(bridge.calls.some(call => call.method === 'thread/attachment/remove')).toBe(false);
    attachment = { ...attachment, id: 'saved-1' };
    await service.removeReference(workspace.id, THREAD_A, page.references[0].reference);
    expect(bridge.calls.at(-1)).toEqual({ method: 'thread/attachment/remove', params: { threadId: THREAD_A, attachmentType: 'unknown.native.kind', identityKey: 'opaque-record' } });
  });

  it('does not interpret transport errors or native rejection as empty search/attachment lists', async () => {
    bridge.handlers.set('thread/search', () => { throw new HttpError(501, 'Native search is unsupported for this store.', 'CODEX_METHOD_UNAVAILABLE'); });
    bridge.handlers.set('thread/attachment/list', () => { throw new HttpError(503, 'Native connection failed.', 'CODEX_CONNECTION_CHANGED'); });
    await expect(service.searchThreads(workspace.id, { query: 'x' })).rejects.toMatchObject({ code: 'CODEX_METHOD_UNAVAILABLE' });
    await expect(service.references(workspace.id, THREAD_A)).rejects.toMatchObject({ code: 'CODEX_CONNECTION_CHANGED' });
  });
});

describe('native file HTTP authorization and strict operation surface', () => {
  let server: Server | undefined, auth: AuthService | undefined, origin = '', cookie = '';
  afterEach(async () => { await auth?.close(); if (server) await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; auth = undefined; });
  async function start() {
    auth = new AuthService(ctx); await auth.initialize();
    const app = express(); app.use('/api', auth.protectMutations); app.use('/api', express.json({ limit: '1mb' }));
    app.use('/api', auth.router()); app.use('/api', auth.requireSession); app.use('/api', createNativeFilesSearchRouter(deps));
    const handler: ErrorRequestHandler = (error, _req, res, _next) => res.status(error instanceof HttpError ? error.status : error instanceof ZodError ? 400 : 500)
      .json({ error: error instanceof Error ? error.message : 'Unknown test error', code: error instanceof HttpError ? error.code : 'INVALID_INPUT' });
    app.use(handler); server = createServer(app); await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const login = await fetch(`${origin}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Codex-Workspace': '1', Origin: origin }, body: JSON.stringify({ password: ctx.config.password }) });
    expect(login.status).toBe(200); cookie = login.headers.get('set-cookie')!.split(';')[0];
  }
  const request = (route: string, options: { method?: string; body?: unknown; authenticated?: boolean; origin?: string } = {}) => fetch(`${origin}/api${route}`, {
    method: options.method ?? 'GET', headers: { 'Content-Type': 'application/json', 'X-Codex-Workspace': '1', Origin: options.origin ?? origin,
      ...(options.authenticated === false ? {} : { Cookie: cookie }) }, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  it('requires the existing session/origin gates and rejects raw method, recursive and absolute-path injection', async () => {
    await start(); const route = `/workspaces/${workspace.id}/native/files`;
    expect((await request(`${route}/directory`, { authenticated: false })).status).toBe(401);
    expect((await request(`${route}/directory`, { method: 'POST', origin: 'https://foreign.invalid', body: { path: 'x' } })).status).toBe(403);
    expect((await request(`${route}/directory`, { method: 'POST', body: { path: 'x', method: 'account/login/start' } })).status).toBe(400);
    expect((await request(`${route}/directory`, { method: 'POST', body: { path: '/tmp/outside' } })).status).toBe(403);
    expect((await request(`${route}/content`, { method: 'DELETE', body: { path: 'x', expectedVersion: digest('x'), recursive: true } })).status).toBe(400);
    expect(bridge.calls).toHaveLength(0);
    const created = await request(`${route}/content`, { method: 'PUT', body: { path: 'created.txt', dataBase64: base64('real native bytes'), expectedVersion: null } });
    expect(created.status).toBe(200); expect(await fs.readFile(path.join(workspace.path, 'created.txt'), 'utf8')).toBe('real native bytes');
    const read = await request(`${route}/content?path=created.txt`); expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ path: 'created.txt', bytes: 17 });
  });
});
