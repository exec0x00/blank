import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { loadConfig } from '../server/config';
import type { AppContext } from '../server/context';
import { HttpError } from '../server/errors';
import { JsonStore, SecretStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import { defaultSettings } from '../server/settings';
import { cleanupWorkspaceProjectExtensions } from '../server/project-extensions-cleanup';
import type { WorkspaceArtifactCleanupRequest } from '../server/workspace-trash/service';
import { withWorkspaceRemoval, workspaceIsBusy, acquireWorkspaceActivity } from '../server/worktrees/activity';

const targetId = 'ws_extension_cleanup';
const peerId = 'ws_extension_peer';
const deletionId = 'trash_extension_cleanup';
const hash = 'a'.repeat(64);
const revision = `rev_${'1'.repeat(32)}`;
const id = (kind: string, character: string) => `${kind}_${character.repeat(32)}`;

function plugin(character: string, scope: 'project' | 'user', workspaceId = targetId) {
  return { id: id('plugin', character), name: `fixture-${character}`, scope,
    ...(scope === 'project' ? { workspaceId } : {}), enabled: true, revision,
    source: { kind: 'local', workspaceId, path: 'package' },
    revisions: [{ id: revision, installedAt: '2026-09-20T00:00:00.000Z', fingerprint: hash,
      source: { kind: 'local', workspaceId, path: 'package' } }],
    installedAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z',
    manifest: { name: `fixture-${character}`, displayName: `Fixture ${character}`, description: `Retained description ${character}`,
      skills: [], commands: [], manifestPath: '.codex-plugin/plugin.json', manifestHash: hash, agentSchema: false,
      hooks: { Stop: [{ hooks: [{ type: 'command', command: `printf retained-script-${character}` }] }] }, hasHooks: true,
      capabilities: ['hooks'], unavailableCapabilities: [], warnings: [] } };
}

function marketplace(character: string, scope: 'project' | 'user', workspaceId = targetId) {
  const value = plugin(character, scope, workspaceId);
  return { id: id('marketplace', character), name: value.name, scope, ...(scope === 'project' ? { workspaceId } : {}),
    revision, source: value.source, revisions: value.revisions };
}

function registry() {
  return { version: 1,
    plugins: [plugin('1', 'project'), plugin('2', 'user'), plugin('3', 'project', peerId)],
    marketplaces: [marketplace('1', 'project'), marketplace('2', 'user'), marketplace('3', 'project', peerId)],
    skills: [{ id: id('skill', '1'), scope: 'project', workspaceId: targetId, baseline: hash },
      { id: id('skill', '2'), scope: 'user', baseline: hash }],
    disabledSkills: [id('skill', '1'), id('skill', '2')], disabledPlugins: [id('plugin', '1'), id('plugin', '2')],
    builtinFingerprints: { 'skill-creator': hash }, ownerPreferences: { futurePreference: 'preserved exactly' } };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function reached(gate: ReturnType<typeof deferred>, operation: Promise<unknown>): Promise<void> {
  await Promise.race([gate.promise, operation.then(() => { throw new Error('Expected storage gate was not reached.'); })]);
}

describe('permanent workspace project extension registry cleanup', () => {
  let temporary: string, runtime: string, ctx: AppContext;
  const extraServices: WorkspaceService[] = [];
  const request = (overrides: Partial<WorkspaceArtifactCleanupRequest> = {}): WorkspaceArtifactCleanupRequest => ({
    workspaceId: targetId, deletionId, mode: 'permanent', deletedAt: '2026-09-20T00:00:00.000Z',
    assertCurrent: async () => undefined, ...overrides,
  });
  const filename = () => path.join(ctx.config.stateDir, 'extensions.json');
  const cleanup = (overrides: Partial<WorkspaceArtifactCleanupRequest> = {}) => {
    const owned = request(overrides);
    return withWorkspaceRemoval(ctx.config.workspacesDir, owned.workspaceId, () => cleanupWorkspaceProjectExtensions(ctx, owned));
  };

  beforeEach(async () => {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-project-extensions-cleanup-'));
    runtime = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-project-extensions-cleanup-runtime-'));
    const config = loadConfig({ DATA_DIR: temporary, RUNTIME_DIR: runtime, NODE_ENV: 'test',
      WORKSPACE_PASSWORD: 'fixture-cleanup-password', SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'k'.repeat(64) });
    await fs.mkdir(config.stateDir, { recursive: true });
    const store = new JsonStore(config.stateDir);
    ctx = { config, store, secrets: new SecretStore(store, config.encryptionKey), events: new EventEmitter(),
      workspaces: new WorkspaceService(config, store), settings: async () => ({ ...defaultSettings }),
      saveSettings: async () => ({ ...defaultSettings }), providerKey: async () => undefined };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const service of new Set([...extraServices.splice(0), ctx.workspaces])) {
      await service.closeFileTrashPages(); await service.closeTrashCleanup();
    }
    await ctx.store.flush();
    await Promise.all([temporary, runtime].map(directory => fs.rm(directory, { recursive: true, force: true })));
  });

  it('removes only explicitly owned project plugin and marketplace rows, including inline source', async () => {
    const before = registry();
    await ctx.store.write('extensions', before);
    await ctx.store.write('settings', { customModel: 'preserve-model', workflows: ['personal workflow'] });
    await ctx.store.write('protected-credentials', { fixture: 'opaque encrypted test value' });
    const settings = await fs.readFile(path.join(ctx.config.stateDir, 'settings.json'));
    const credentials = await fs.readFile(path.join(ctx.config.stateDir, 'protected-credentials.json'));
    const event = vi.fn(); ctx.events.on('extensions:changed', event);
    await cleanup();
    const after = await ctx.store.read('extensions', before);
    expect(after).toEqual({ ...before, plugins: before.plugins.slice(1), marketplaces: before.marketplaces.slice(1) });
    expect(await fs.readFile(filename(), 'utf8')).not.toContain('retained-script-1');
    expect(await fs.readFile(filename(), 'utf8')).toContain('retained-script-2');
    expect(await fs.readFile(path.join(ctx.config.stateDir, 'settings.json'))).toEqual(settings);
    expect(await fs.readFile(path.join(ctx.config.stateDir, 'protected-credentials.json'))).toEqual(credentials);
    expect(event).toHaveBeenCalledWith({ workspaceId: targetId });
  });

  it('does not infer ownership from source paths, matching IDs, or a personal row workspace hint', async () => {
    const before = registry();
    before.plugins.push({ ...plugin('1', 'user'), workspaceId: targetId });
    before.marketplaces.push({ ...marketplace('1', 'user'), workspaceId: targetId });
    await ctx.store.write('extensions', before);
    await cleanup();
    const after = await ctx.store.read('extensions', before);
    expect(after.plugins).toEqual(before.plugins.filter(row => row.scope !== 'project' || row.workspaceId !== targetId));
    expect(after.marketplaces).toEqual(before.marketplaces.filter(row => row.scope !== 'project' || row.workspaceId !== targetId));
    expect(after.disabledPlugins).toEqual(before.disabledPlugins);
    expect(after.skills).toEqual(before.skills);
  });

  it('is idempotent and does not rewrite an already filtered registry', async () => {
    await ctx.store.write('extensions', registry());
    await cleanup();
    const bytes = await fs.readFile(filename()), identity = await fs.stat(filename(), { bigint: true });
    await cleanup();
    expect(await fs.readFile(filename())).toEqual(bytes);
    expect((await fs.stat(filename(), { bigint: true })).ino).toBe(identity.ino);
  });

  it('does not create registry state, home files, or services when no registry exists at startup', async () => {
    const workspaceInitialization = vi.spyOn(ctx.workspaces, 'initialize');
    const workspaceLookup = vi.spyOn(ctx.workspaces, 'get');
    await cleanup();
    expect(workspaceInitialization).not.toHaveBeenCalled(); expect(workspaceLookup).not.toHaveBeenCalled();
    await expect(fs.lstat(filename())).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.lstat(ctx.config.homeDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('requires the caller removal gate without acquiring another activity lease', async () => {
    await ctx.store.write('extensions', registry());
    const before = await fs.readFile(filename());
    await expect(cleanupWorkspaceProjectExtensions(ctx, request())).rejects.toMatchObject({ code: 'WORKSPACE_PROJECT_EXTENSIONS_CLEANUP_OWNERSHIP' });
    expect(await fs.readFile(filename())).toEqual(before);
    await cleanup();
    expect(workspaceIsBusy(ctx.config.workspacesDir, targetId)).toBe(false);
  });

  it('preserves a superseding generation and retains its exact conflict for retry', async () => {
    await ctx.store.write('extensions', registry());
    const before = await fs.readFile(filename());
    const conflict = new HttpError(409, 'A newer deletion generation owns this workspace.', 'WORKSPACE_ARTIFACT_CLEANUP_SUPERSEDED');
    await expect(cleanup({ assertCurrent: async () => { throw conflict; } })).rejects.toBe(conflict);
    expect(await fs.readFile(filename())).toEqual(before);
    await cleanup();
    expect((await ctx.store.read('extensions', registry())).plugins).toHaveLength(2);
  });

  it('serializes the filter between actual unrelated writers on the shared JsonStore key', async () => {
    await ctx.store.write('extensions', registry());
    const entered = deferred(), proceed = deferred(), queued = deferred();
    const guarded = ctx.store.mutateGuarded.bind(ctx.store);
    vi.spyOn(ctx.store, 'mutateGuarded').mockImplementation(<T>(key: string, operation: () => Promise<T>): Promise<T> => {
      const result = guarded(key, operation); if (key === 'extensions') queued.resolve(); return result;
    });
    const prior = ctx.store.update('extensions', registry(), async current => {
      entered.resolve(); await proceed.promise;
      return { ...current, plugins: [...current.plugins, plugin('4', 'user')] };
    });
    const pending: Promise<unknown>[] = [prior];
    try {
      await reached(entered, prior);
      const purging = cleanup(); pending.push(purging); await reached(queued, purging);
      const following = ctx.store.update('extensions', registry(), current => {
        expect(current.plugins.some(row => row.scope === 'project' && row.workspaceId === targetId)).toBe(false);
        return { ...current, plugins: [...current.plugins, plugin('5', 'project', peerId)],
          marketplaces: [...current.marketplaces, marketplace('4', 'user')] };
      });
      pending.push(following); proceed.resolve(); await Promise.all(pending);
      const after = await ctx.store.read('extensions', registry());
      expect(after.plugins.map(row => row.id)).toEqual(['2', '3', '4', '5'].map(character => id('plugin', character)));
      expect(after.marketplaces.map(row => row.id)).toEqual(['2', '3', '4'].map(character => id('marketplace', character)));
    } finally { proceed.resolve(); await Promise.allSettled(pending); }
  });

  it('rechecks its deletion generation after waiting behind a registry writer', async () => {
    await ctx.store.write('extensions', registry());
    const entered = deferred(), proceed = deferred(), queued = deferred();
    let current = true;
    const conflict = new HttpError(409, 'Deletion ownership changed.', 'WORKSPACE_ARTIFACT_CLEANUP_SUPERSEDED');
    const guarded = ctx.store.mutateGuarded.bind(ctx.store);
    vi.spyOn(ctx.store, 'mutateGuarded').mockImplementation(<T>(key: string, operation: () => Promise<T>): Promise<T> => {
      const result = guarded(key, operation); if (key === 'extensions') queued.resolve(); return result;
    });
    const prior = ctx.store.update('extensions', registry(), async value => { entered.resolve(); await proceed.promise; return value; });
    const pending: Promise<unknown>[] = [prior];
    try {
      await reached(entered, prior);
      const purging = cleanup({ assertCurrent: async () => { if (!current) throw conflict; } });
      pending.push(purging);
      const rejected = expect(purging).rejects.toBe(conflict); pending.push(rejected);
      await reached(queued, purging); current = false; proceed.resolve();
      await prior; await rejected;
      expect(await ctx.store.read('extensions', registry())).toEqual(registry());
    } finally { proceed.resolve(); await Promise.allSettled(pending); }
  });

  it('detects an outside edit during replacement preparation and preserves all changed bytes', async () => {
    await ctx.store.write('extensions', registry());
    let edited = false;
    const changed = { ...registry(), ownerPreferences: { futurePreference: 'outside edit must survive' } };
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation((async (location, flags, mode) => {
      if (!edited && String(location).includes('.conversation-cleanup-')) {
        edited = true; await fs.writeFile(filename(), JSON.stringify(changed));
      }
      return open(location, flags, mode);
    }) as typeof fs.open);
    await expect(cleanup()).rejects.toMatchObject({ code: 'WORKSPACE_PROJECT_EXTENSIONS_CLEANUP_CHANGED' });
    expect(edited).toBe(true);
    expect(JSON.parse(await fs.readFile(filename(), 'utf8'))).toEqual(changed);
    vi.restoreAllMocks();
    await cleanup();
    expect((await ctx.store.read('extensions', registry())).ownerPreferences).toEqual(changed.ownerPreferences);
  });

  it('retains a failed replacement for an honest retry without deleting unrelated temporary files', async () => {
    await ctx.store.write('extensions', registry());
    const before = await fs.readFile(filename());
    const unrelated = path.join(ctx.config.stateDir, 'unrelated-task.tmp'); await fs.writeFile(unrelated, 'Other task');
    const rename = fs.rename.bind(fs), failure = Object.assign(new Error('Injected replace failure.'), { code: 'EIO' });
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(from).includes('.conversation-cleanup-') && String(to).endsWith('/extensions.json')) throw failure;
      return rename(from, to);
    });
    await expect(cleanup()).rejects.toBe(failure);
    expect(await fs.readFile(filename())).toEqual(before);
    expect(await fs.readFile(unrelated, 'utf8')).toBe('Other task');
    expect((await fs.readdir(ctx.config.stateDir)).some(name => name.startsWith('.conversation-cleanup-'))).toBe(false);
    vi.restoreAllMocks(); await cleanup();
    expect((await ctx.store.read('extensions', registry())).plugins).toHaveLength(2);
  });

  it.each(['symlink', 'hardlink', 'directory'] as const)('rejects a %s registry without changing the referenced file', async kind => {
    const outside = path.join(temporary, 'independent-registry.json'), bytes = JSON.stringify(registry());
    await fs.writeFile(outside, bytes);
    if (kind === 'symlink') await fs.symlink(outside, filename());
    else if (kind === 'hardlink') await fs.link(outside, filename());
    else await fs.mkdir(filename());
    await expect(cleanup()).rejects.toMatchObject({ code: 'WORKSPACE_PROJECT_EXTENSIONS_CLEANUP_UNSAFE' });
    expect(await fs.readFile(outside, 'utf8')).toBe(bytes);
  });

  it('rejects a replaced/symlinked state directory and preserves its original bytes', async () => {
    await ctx.store.write('extensions', registry());
    const moved = `${ctx.config.stateDir}-retained`, bytes = await fs.readFile(filename());
    await fs.rename(ctx.config.stateDir, moved); await fs.symlink(moved, ctx.config.stateDir);
    await expect(cleanup()).rejects.toMatchObject({ code: 'WORKSPACE_PROJECT_EXTENSIONS_CLEANUP_UNSAFE' });
    expect(await fs.readFile(path.join(moved, 'extensions.json'))).toEqual(bytes);
  });

  it('refuses oversized sparse registry state before reading its full contents', async () => {
    const handle = await fs.open(filename(), 'wx');
    try { await handle.truncate(32 * 1024 * 1024 + 1); } finally { await handle.close(); }
    await expect(cleanup()).rejects.toMatchObject({ code: 'WORKSPACE_PROJECT_EXTENSIONS_CLEANUP_LIMIT' });
    expect((await fs.stat(filename())).size).toBe(32 * 1024 * 1024 + 1);
  });

  it.each([
    { name: 'invalid JSON', text: '{' },
    { name: 'unsupported registry version', text: JSON.stringify({ ...registry(), version: 2 }) },
    { name: 'ambiguous target plugin identity', text: JSON.stringify({ ...registry(), plugins: [{ scope: 'project', workspaceId: targetId, id: 'not-a-managed-plugin' }] }) },
    { name: 'ambiguous target marketplace identity', text: JSON.stringify({ ...registry(), marketplaces: [{ scope: 'project', workspaceId: targetId, id: id('plugin', '1') }] }) },
    { name: 'non-object registry row', text: JSON.stringify({ ...registry(), plugins: [null] }) },
  ])('retains $name instead of silently filtering unvalidated state', async ({ text }) => {
    await fs.writeFile(filename(), text);
    await expect(cleanup()).rejects.toMatchObject({ status: 409 });
    expect(await fs.readFile(filename(), 'utf8')).toBe(text);
  });

  it('keeps project records through ordinary trash and restore, then filters them on permanent purge', async () => {
    const service = new WorkspaceService(ctx.config, ctx.store, { cleanupWorkspaceArtifacts: owned => cleanupWorkspaceProjectExtensions(ctx, owned) });
    extraServices.push(service); ctx.workspaces = service;
    await service.initialize();
    const workspace = await service.create({ name: 'Project extensions lifecycle' });
    const before = registry();
    before.plugins[0].workspaceId = workspace.id; before.marketplaces[0].workspaceId = workspace.id;
    await ctx.store.write('extensions', before);
    const first = await service.trashWorkspace(workspace.id, { expectedMode: 'trash' });
    if (first.mode !== 'trash') throw new Error('Expected ordinary trash.');
    expect(await ctx.store.read('extensions', before)).toEqual(before);
    await service.restoreWorkspaceTrash(first.trash.id);
    expect(await ctx.store.read('extensions', before)).toEqual(before);
    const second = await service.trashWorkspace(workspace.id, { expectedMode: 'trash' });
    if (second.mode !== 'trash') throw new Error('Expected ordinary trash.');
    await service.purgeWorkspaceTrash(second.trash.id);
    expect(await ctx.store.read('extensions', before)).toEqual({ ...before, plugins: before.plugins.slice(1), marketplaces: before.marketplaces.slice(1) });
  });

  it('blocks late project writers through the existing removal gate while filtering only the retired registry owner', async () => {
    await ctx.workspaces.initialize();
    const workspace = await ctx.workspaces.create({ name: 'Project plugin owner' });
    const source = await ctx.workspaces.create({ name: 'Plugin source' });
    const packageRoot = path.join(source.path, 'package', '.codex-plugin');
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.writeFile(path.join(packageRoot, 'plugin.json'), JSON.stringify({ name: 'cleanup-fixture', description: 'Actual project plugin manifest', skills: [] }));
    const before = registry();
    const installed = before.plugins[0]; installed.workspaceId = workspace.id;
    before.marketplaces[0].workspaceId = workspace.id;
    await ctx.store.write('extensions', before);
    await withWorkspaceRemoval(ctx.config.workspacesDir, workspace.id, async () => {
      expect(() => acquireWorkspaceActivity(ctx.config.workspacesDir, workspace.id, 'extension')).toThrowError(/repository is in use/i);
      await fs.rm(workspace.path, { recursive: true });
      await cleanupWorkspaceProjectExtensions(ctx, request({ workspaceId: workspace.id }));
    });
    expect((await ctx.store.read('extensions', registry())).plugins.some(item => item.id === installed.id)).toBe(false);
    expect(await ctx.store.read('extensions', registry())).toEqual({ ...before, plugins: before.plugins.slice(1), marketplaces: before.marketplaces.slice(1) });
    expect(await fs.readFile(path.join(packageRoot, 'plugin.json'), 'utf8')).toContain('Actual project plugin manifest');
  });
});
