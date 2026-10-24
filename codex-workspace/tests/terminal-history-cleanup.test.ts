import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../server/errors';
import { cleanupWorkspaceTerminalHistory } from '../server/terminal-history-cleanup';
import type { WorkspaceArtifactCleanupRequest } from '../server/workspace-trash/service';
import { acquireWorkspaceActivity, withWorkspaceRemoval } from '../server/worktrees/activity';

const workspaceId = 'workspace-terminal-history-owner';
const historyName = (id: string) => `${createHash('sha256').update(id).digest('hex').slice(0, 32)}.history`;
const source = 'printf "workspace-specific command and source text"\n';
const retained = 'Other workspace history and user configuration must remain.\n';
const stale = () => new HttpError(409, 'A newer removal generation superseded this cleanup.', 'STALE_HISTORY_TEST_GENERATION');
const ioError = () => Object.assign(new Error('Injected history cleanup interruption.'), { code: 'EIO' });

describe.skipIf(process.platform !== 'linux')('permanent workspace terminal history cleanup', () => {
  let directory: string, historyDir: string, target: string;
  let ctx: { config: { dataDir: string; homeDir: string; workspacesDir: string } };
  let request: WorkspaceArtifactCleanupRequest;
  let siblings: string[];

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'codex-terminal-history-cleanup-'));
    const dataDir = path.join(directory, 'data');
    ctx = { config: { dataDir, homeDir: path.join(dataDir, 'home'), workspacesDir: path.join(dataDir, 'workspaces') } };
    historyDir = path.join(ctx.config.homeDir, '.local', 'state', 'terminal-history');
    target = path.join(historyDir, historyName(workspaceId));
    await fs.mkdir(historyDir, { recursive: true });
    await fs.writeFile(target, source, { mode: 0o600 });
    siblings = [path.join(historyDir, historyName('another-workspace')), path.join(historyDir, 'shared.history'),
      path.join(historyDir, `${historyName(workspaceId)}.user-backup`), path.join(ctx.config.homeDir, '.bashrc'),
      path.join(ctx.config.homeDir, '.npmrc'), path.join(dataDir, 'saved-account-connections.json')];
    for (const filename of siblings) await fs.writeFile(filename, retained);
    request = { workspaceId, deletionId: randomUUID(), mode: 'permanent', deletedAt: new Date().toISOString(),
      assertCurrent: vi.fn(async () => undefined) };
    // A purge can run at startup after the workspace is already gone. The leaf
    // must use neither runtime recovery nor any live workspace/service port.
    for (const key of ['workspaces', 'store', 'settings', 'providerKey']) Object.defineProperty(ctx, key, {
      get() { throw new Error(`History cleanup must not access ${key}.`); },
    });
  });

  afterEach(async () => { vi.restoreAllMocks(); if (directory) await fs.rm(directory, { recursive: true, force: true }); });

  const cleanup = () => withWorkspaceRemoval(ctx.config.workspacesDir, workspaceId, () => cleanupWorkspaceTerminalHistory(ctx, request));
  const absent = async (filename = target) => { await expect(fs.lstat(filename)).rejects.toMatchObject({ code: 'ENOENT' }); };
  const preserved = async () => { for (const filename of siblings) expect(await fs.readFile(filename, 'utf8')).toBe(retained); };

  it.each(['permanent', 'trash'] as const)('removes only the exact owned history at a confirmed %s purge and is safe to retry', async mode => {
    request = { ...request, mode };
    const before = (await fs.readdir(historyDir)).sort();
    await cleanup();
    await absent();
    await preserved();
    expect((await fs.readdir(historyDir)).sort()).toEqual(before.filter(name => name !== historyName(workspaceId)));
    expect(request.assertCurrent).toHaveBeenCalled();
    expect(vi.mocked(request.assertCurrent).mock.calls.length).toBeGreaterThanOrEqual(3);
    await withWorkspaceRemoval(ctx.config.workspacesDir, workspaceId,
      () => cleanupWorkspaceTerminalHistory({ config: { ...ctx.config } }, request));
    await absent(); await preserved();
  });

  it.each(['data', 'home', 'state', 'history', 'file'] as const)('does not recreate a missing %s path during startup or retry', async missing => {
    const location = missing === 'data' ? ctx.config.dataDir : missing === 'home' ? ctx.config.homeDir
      : missing === 'state' ? path.dirname(historyDir) : missing === 'history' ? historyDir : target;
    await fs.rm(location, { recursive: true });
    await cleanup(); await absent(location);
    await cleanup(); await absent(location);
  });

  it('requires the caller’s exclusive gate and waits for terminal activity without signalling any process', async () => {
    await expect(cleanupWorkspaceTerminalHistory(ctx, request)).rejects.toMatchObject({ code: 'TERMINAL_HISTORY_CLEANUP_BUSY' });
    expect(await fs.readFile(target, 'utf8')).toBe(source);
    const release = acquireWorkspaceActivity(ctx.config.workspacesDir, workspaceId, 'terminal');
    try {
      await expect(cleanup()).rejects.toMatchObject({ code: 'WORKTREE_BUSY' });
      await expect(cleanupWorkspaceTerminalHistory(ctx, request)).rejects.toMatchObject({ code: 'TERMINAL_HISTORY_CLEANUP_BUSY' });
      expect(await fs.readFile(target, 'utf8')).toBe(source);
    } finally { release(); }
    await cleanup(); await absent(); await preserved();
  });

  it('preserves the history and the original authority error when the deletion generation is already stale', async () => {
    const error = stale();
    request = { ...request, assertCurrent: async () => { throw error; } };
    await expect(cleanup()).rejects.toBe(error);
    expect(await fs.readFile(target, 'utf8')).toBe(source);
    await preserved();
  });

  it('rechecks authority after opening the history and before removing any bytes', async () => {
    let current = true;
    const error = stale(), open = fs.open.bind(fs);
    request = { ...request, assertCurrent: async () => { if (!current) throw error; } };
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (String(args[0]).endsWith(`/${historyName(workspaceId)}`)) current = false;
      return handle;
    });
    await expect(cleanup()).rejects.toBe(error);
    expect(await fs.readFile(target, 'utf8')).toBe(source);
    await preserved();
  });

  it('retains history after an unlink failure and completes an actual filesystem retry from a fresh context', async () => {
    const unlink = fs.unlink.bind(fs);
    let interrupted = false;
    vi.spyOn(fs, 'unlink').mockImplementation(async filename => {
      if (!interrupted && String(filename).endsWith(`/${historyName(workspaceId)}`)) { interrupted = true; throw ioError(); }
      return unlink(filename);
    });
    await expect(cleanup()).rejects.toMatchObject({ code: 'TERMINAL_HISTORY_CLEANUP_IO' });
    expect(await fs.readFile(target, 'utf8')).toBe(source);
    await preserved();
    await withWorkspaceRemoval(ctx.config.workspacesDir, workspaceId,
      () => cleanupWorkspaceTerminalHistory({ config: { ...ctx.config } }, request));
    await absent(); await preserved();
  });

  it('checks authority after unlink and safely retries without recreating an already removed history', async () => {
    const unlink = fs.unlink.bind(fs), error = stale();
    let removed = false;
    request = { ...request, assertCurrent: async () => { if (removed) throw error; } };
    vi.spyOn(fs, 'unlink').mockImplementation(async filename => {
      await unlink(filename);
      if (String(filename).endsWith(`/${historyName(workspaceId)}`)) removed = true;
    });
    await expect(cleanup()).rejects.toBe(error);
    await absent(); await preserved();
    request = { ...request, assertCurrent: async () => undefined };
    await cleanup(); await absent(); await preserved();
  });

  it.each(['file', 'history', 'state', 'local', 'home', 'data'] as const)('rejects a %s symlink without following it or changing the original history', async kind => {
    const location = kind === 'file' ? target : kind === 'history' ? historyDir : kind === 'state' ? path.dirname(historyDir)
      : kind === 'local' ? path.dirname(path.dirname(historyDir)) : kind === 'home' ? ctx.config.homeDir : ctx.config.dataDir;
    const parked = path.join(directory, 'original-node');
    const external = path.join(directory, 'outside');
    const remainder = path.relative(location, target);
    const outsideHistory = remainder ? path.join(external, remainder) : external;
    await fs.mkdir(path.dirname(outsideHistory), { recursive: true });
    await fs.writeFile(outsideHistory, retained);
    await fs.rename(location, parked);
    await fs.symlink(external, location, kind === 'file' ? 'file' : 'dir');
    await expect(cleanup()).rejects.toMatchObject({ code: 'TERMINAL_HISTORY_CLEANUP_UNSAFE' });
    expect(await fs.readFile(outsideHistory, 'utf8')).toBe(retained);
    expect(await fs.readFile(remainder ? path.join(parked, remainder) : parked, 'utf8')).toBe(source);
    expect((await fs.lstat(location)).isSymbolicLink()).toBe(true);
  });

  it('refuses a directory or hard-linked history leaf while leaving its contents and other name intact', async () => {
    await fs.unlink(target);
    await fs.mkdir(target);
    const nested = path.join(target, 'do-not-remove');
    await fs.writeFile(nested, retained);
    await expect(cleanup()).rejects.toMatchObject({ code: 'TERMINAL_HISTORY_CLEANUP_UNSAFE' });
    expect(await fs.readFile(nested, 'utf8')).toBe(retained);
    await fs.rm(target, { recursive: true });
    await fs.link(siblings[0], target);
    await expect(cleanup()).rejects.toMatchObject({ code: 'TERMINAL_HISTORY_CLEANUP_UNSAFE' });
    expect(await fs.readFile(target, 'utf8')).toBe(retained);
    await preserved();
  });

  it('detects an owned history replaced while it is open and leaves the replacement untouched', async () => {
    const original = path.join(directory, 'original-history');
    const open = fs.open.bind(fs);
    let replaced = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (!replaced && String(args[0]).endsWith(`/${historyName(workspaceId)}`)) {
        replaced = true;
        await fs.rename(target, original);
        await fs.writeFile(target, retained);
      }
      return handle;
    });
    await expect(cleanup()).rejects.toMatchObject({ code: 'TERMINAL_HISTORY_CLEANUP_CHANGED' });
    expect(await fs.readFile(target, 'utf8')).toBe(retained);
    expect(await fs.readFile(original, 'utf8')).toBe(source);
    await preserved();
  });

  it('detects a pinned parent replaced by a symlink before unlink and preserves both trees', async () => {
    const original = path.join(directory, 'original-history-directory'), external = path.join(directory, 'external-history');
    const open = fs.open.bind(fs);
    let replaced = false;
    await fs.mkdir(external);
    await fs.writeFile(path.join(external, historyName(workspaceId)), retained);
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (!replaced && String(args[0]).endsWith(`/${historyName(workspaceId)}`)) {
        replaced = true;
        await fs.rename(historyDir, original);
        await fs.symlink(external, historyDir, 'dir');
      }
      return handle;
    });
    await expect(cleanup()).rejects.toMatchObject({ code: 'TERMINAL_HISTORY_CLEANUP_CHANGED' });
    expect(await fs.readFile(path.join(original, historyName(workspaceId)), 'utf8')).toBe(source);
    expect(await fs.readFile(path.join(external, historyName(workspaceId)), 'utf8')).toBe(retained);
  });
});
