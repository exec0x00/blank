import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import type { AppContext } from '../server/context';
import type { Workspace } from '../shared/types';
import { loadConfig } from '../server/config';
import { createApplication } from '../server/index';
import { defaultSettings } from '../server/settings';
import { JsonStore, SecretStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import { cleanupWorkspaceArtifacts } from '../server/workspace-artifacts';
import type { WorkspaceArtifactCleanupRequest } from '../server/workspace-trash/service';
import { listTrashRecords, TRASH_RETENTION_MS } from '../server/workspace-trash/records';
import { assertWorkspaceFileRewindDeletionAllowed } from '../server/agent/file-rewind-cleanup';
import { CodexRuntime } from '../server/codex-cli/runtime';
import { ImageAttachmentService } from '../server/agent/attachments';
import { ConversationFileStorage, CONVERSATION_FILE_DIRECTORY } from '../server/conversation-files/storage';
import { GeneratedImageService } from '../server/generated-images';
import { CheckpointStore, CHECKPOINT_LIMITS } from '../server/git-checkpoints/store';
import { FileMetadataManager } from '../server/file-metadata';
import { clearWorkspaceRecoveryBarrier, workspaceRecoveryBarrier } from '../server/worktrees/activity';

// Frozen persisted registry shape only; no retired plugin runtime is loaded.
interface StoredPlugin { id: string; workspaceId?: string; [key: string]: unknown }
interface StoredMarketplace { id: string; workspaceId?: string; [key: string]: unknown }
interface ExtensionState {
  version: 1; plugins: StoredPlugin[]; marketplaces: StoredMarketplace[];
  skills: Array<{ id: string; scope: 'project' | 'user'; workspaceId?: string; baseline: string }>;
  disabledSkills: string[]; disabledPlugins: string[]; builtinFingerprints: Record<string, string>;
}
const EMPTY_STATE: ExtensionState = { version: 1, plugins: [], marketplaces: [], skills: [], disabledSkills: [], disabledPlugins: [], builtinFingerprints: {} };

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN4bm4DAANjAVvvpjgdAAAAAElFTkSuQmCC', 'base64');
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const digest = (value: unknown) => sha(JSON.stringify(value));
const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`;
const exists = (file: string) => fs.lstat(file).then(() => true, error => {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
  throw error;
});

function extensionRows(owner: Workspace, text: string, scope: 'project' | 'user' = 'project') {
  const revision = id('rev'), stamp = new Date().toISOString(), name = `lifecycle-${sha(text).slice(0, 16)}`;
  const source = { kind: 'local' as const, workspaceId: owner.id, path: 'package' };
  const revisions = [{ id: revision, installedAt: stamp, fingerprint: sha(text), source }];
  const plugin: StoredPlugin = { id: id('plugin'), name, scope, ...(scope === 'project' ? { workspaceId: owner.id } : {}),
    enabled: true, revision, revisions, source, installedAt: stamp, updatedAt: stamp,
    manifest: { name, displayName: name, description: text, skills: [], commands: [], manifestPath: '.codex-plugin/plugin.json',
      manifestHash: sha(text), agentSchema: false, hasHooks: true, capabilities: ['hooks'], unavailableCapabilities: [], warnings: [],
      hooks: { Stop: [{ hooks: [{ type: 'command', command: `printf '%s\\n' '${text}'` }] }] } } };
  const marketplace: StoredMarketplace = { id: id('marketplace'), name, scope, ...(scope === 'project' ? { workspaceId: owner.id } : {}),
    revision, revisions, source };
  return { plugin, marketplace };
}

/** Only filesystem fault boundaries are injected. Every cleanup leaf, journal,
 * ownership signature, attachment hash and restart path below is production code. */
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-artifact-lifecycle-'));
  await fs.chmod(directory, 0o700);
  const config = loadConfig({ DATA_DIR: path.join(directory, 'data'), RUNTIME_DIR: path.join(directory, 'runtime'), NODE_ENV: 'test',
    WORKSPACE_PASSWORD: 'artifact-lifecycle-fixture-only', SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'k'.repeat(64) });
  await fs.mkdir(config.stateDir, { recursive: true });
  await fs.mkdir(config.homeDir, { recursive: true });
  const handles: Array<{ ctx: AppContext; cleanup: ReturnType<typeof vi.fn<(request: WorkspaceArtifactCleanupRequest) => Promise<void>>> }> = [];
  const assets: Array<{ close(): Promise<void> }> = [];
  const applications: Array<Awaited<ReturnType<typeof createApplication>>> = [];
  const barriers: Array<{ workspaceId: string; recoveryId: string }> = [];
  const file = (key: string) => path.join(config.stateDir, `${key}.json`);
  await new JsonStore(config.stateDir).write('workspaces', []);

  async function open() {
    const store = new JsonStore(config.stateDir);
    let ctx: AppContext;
    const cleanup = vi.fn(async (request: WorkspaceArtifactCleanupRequest) => cleanupWorkspaceArtifacts(ctx, request));
    const workspaces = new WorkspaceService(config, store, {
      assertWorkspaceDeletionAllowed: workspaceId => assertWorkspaceFileRewindDeletionAllowed({ config }, workspaceId),
      cleanupWorkspaceArtifacts: cleanup,
    });
    ctx = { config, store, workspaces, secrets: new SecretStore(store, config.encryptionKey), events: new EventEmitter(),
      settings: vi.fn(async () => ({ ...defaultSettings })),
      saveSettings: vi.fn(async () => { throw new Error('Artifact cleanup cannot change preferences.'); }),
      providerKey: vi.fn(async () => { throw new Error('Artifact cleanup cannot initialize model traffic.'); }) };
    const handle = { ctx, cleanup }; handles.push(handle);
    await workspaces.initialize();
    return handle;
  }
  const initial = await open(), ctx = initial.ctx;
  const workspace = await ctx.workspaces.create({ name: 'Lifecycle target' });
  const peer = await ctx.workspaces.create({ name: 'Unrelated workspace' });
  const sign = (value: unknown) => createHmac('sha256', config.sessionSecret).update(JSON.stringify(value)).digest('hex');
  async function signed(key: string, value: object) { await ctx.store.write(key, { version: 1, value, signature: sign(value) }); }

  async function rewind(owner: Workspace, threadId: string, source: object, pending = false) {
    const planId = randomUUID(), turnId = id('turn'), backupId = id('history'), stamp = new Date().toISOString();
    const keys = { plan: `file-rewind-plan-${planId}`, operation: `file-rewind-operation-${planId}`,
      latest: `file-rewind-latest-${threadId}`, turn: `file-rewind-turn-${digest([threadId, turnId])}`,
      block: `file-rewind-block-${owner.id}`, backup: `thread-backup-${backupId}`, journal: `thread-turn-${threadId}-${turnId}` };
    const plan = { version: 1, id: planId, workspaceId: owner.id, threadId, beforeTurnId: turnId, turnIds: [turnId],
      sourceDigest: digest(source), createdAt: stamp, expiresAt: new Date(Date.now() + 60_000).toISOString(),
      current: { repository: { root: owner.path, gitDirectory: path.join(owner.path, '.git') } },
      target: { workspaceId: owner.id, threadId, turnId }, restore: { files: [], rows: [] } };
    const selection = { planId, version: sign(plan) };
    const operation = { version: 1, workspaceId: owner.id, threadId, recoveryId: planId, selection,
      state: pending ? 'pending' : 'complete', blocking: pending, familyIds: [owner.id], sourceDigest: digest(source),
      createdAt: stamp, updatedAt: stamp, completion: { workspaceId: owner.id, threadId, recoveryId: planId,
        planId, planVersion: selection.version, beforeTurnId: turnId, backupId, filesUnchanged: false, filesRewound: 1, restoredPrompt: 'Original prompt' } };
    await signed(keys.plan, plan); await signed(keys.operation, operation); await signed(keys.block, operation);
    await signed(keys.latest, selection);
    await signed(keys.turn, { version: 1, workspaceId: owner.id, threadId, turnId,
      before: { status: 'unavailable', code: 'FIXTURE', reason: 'Retained source cleanup requires no Git process.' }, manualPaths: [] });
    await ctx.store.write(keys.backup, { version: 2, threadId, beforeTurnId: turnId, record: source,
      turnInputs: [{ turnId, input: [{ role: 'user', content: 'Original turn input' }] }] });
    await ctx.store.write(keys.journal, { version: 2, workspaceId: owner.id, threadId, turnId,
      input: [{ role: 'user', content: 'Original turn input' }] });
    const transaction = path.join(config.stateDir, 'file-rewinds', planId);
    await fs.mkdir(path.join(transaction, 'parked'), { recursive: true });
    await fs.writeFile(path.join(transaction, 'identity.json'), JSON.stringify({ version: 1, id: planId, workspaceId: owner.id, threadId }));
    await fs.writeFile(path.join(transaction, 'parked', '000000'), JSON.stringify(source));
    barriers.push({ workspaceId: owner.id, recoveryId: planId });
    return { planId, keys, transaction, paths: [...Object.values(keys).map(file), path.join(transaction, 'identity.json'), path.join(transaction, 'parked', '000000')] };
  }

  async function seed(owner: Workspace, text: string) {
    const threadId = id('thr'), stamp = new Date().toISOString();
    const storage = new ConversationFileStorage(ctx); assets.push(storage);
    const content = Buffer.from(text);
    const attachment = await storage.commit({ id: id('file'), workspaceId: owner.id, name: 'original.txt', mimeType: 'text/plain',
      bytes: content.length, sha256: sha(content), createdAt: stamp }, content);
    await storage.resolve(owner.id, [{ id: attachment.id, sha256: attachment.sha256 }], true);
    const images = new ImageAttachmentService(ctx, { cleanupIntervalMs: 0 }); assets.push(images);
    const image = await images.upload(owner.id, { name: 'original.png', bytes: png });
    await images.resolve(owner.id, [{ id: image.id, sha256: image.sha256 }], { retain: true });
    const generated = new GeneratedImageService(ctx); assets.push(generated);
    const output = await generated.commit({ workspaceId: owner.id, threadId, messageId: id('msg'), runId: id('run'),
      itemId: id('ig'), resultBase64: png.toString('base64'), outputFormat: 'png' });
    const summary = { id: threadId, workspaceId: owner.id, title: text, titleSource: 'manual' as const, createdAt: stamp, updatedAt: stamp, status: 'idle' as const };
    const source = { thread: { ...summary, messages: [{ id: id('msg'), role: 'user', content: text, createdAt: stamp,
      attachments: [image], fileAttachments: [attachment] }], turns: [] }, input: [{ role: 'user', content: [
      { type: 'input_text', text }, { type: 'input_image', image_url: `data:image/png;base64,${png.toString('base64')}` }] }], revision: 1 };
    const recovery = await rewind(owner, threadId, source);
    await ctx.store.write(`thread-${threadId}`, { ...source, historyBackups: [recovery.keys.backup],
      turnJournals: { [recovery.keys.journal.slice(`thread-turn-${threadId}-`.length)]: recovery.keys.journal } });
    // Publish the real source-bound sidecar so ordinary startup repair does not
    // rewrite a deliberately obsolete fixture while peer bytes are compared.
    const full = await fs.lstat(file('thread-' + threadId), { bigint: true });
    const sourceVersion = [full.dev, full.ino, full.size, full.mtimeNs, full.ctimeNs].join(':');
    await ctx.store.write('thread-summary-' + threadId, { version: 1, summary, source: sourceVersion });
    await ctx.store.update<object[]>('thread-index', [], current => [...current, summary]);
    await ctx.store.write(`thread-goal-${threadId}`, { version: 1, threadId, goal: null, history: [] });
    await ctx.store.update<object[]>('agent-changes', [], current => [...current, { id: id('change'), workspaceId: owner.id,
      threadId, path: 'original.txt', status: 'kept', original: text, modified: text, createdAt: stamp }]);

    const discard = file(`git-discard-${randomUUID()}`);
    await ctx.store.write(path.basename(discard, '.json'), { workspaceId: owner.id, createdAt: stamp, state: 'ready',
      files: [{ path: 'src/original.txt', before: { kind: 'file', mode: 0o755, content: content.toString('base64') }, after: sha('discarded checkout bytes') }] });
    const history = path.join(config.homeDir, '.local', 'state', 'terminal-history', `${sha(owner.id).slice(0, 32)}.history`);
    await fs.mkdir(path.dirname(history), { recursive: true });
    await fs.writeFile(history, `printf '%s\\n' '${text}'\n`, { mode: 0o600 });
    const extensions = extensionRows(owner, text), skillId = id('skill');
    await ctx.store.update<ExtensionState>('extensions', EMPTY_STATE, current => ({ ...current,
      plugins: [...current.plugins, extensions.plugin], marketplaces: [...current.marketplaces, extensions.marketplace],
      skills: [...current.skills, { id: skillId, scope: 'project', workspaceId: owner.id, baseline: sha(text) }],
      disabledSkills: [...current.disabledSkills, skillId], disabledPlugins: [...current.disabledPlugins, extensions.plugin.id] }));

    // A real, correctly hashed/compressed Git blob in the signed owned store.
    // Capture/restore itself has separate native Git tests; this tests its lifecycle.
    const checkpoint = await new CheckpointStore({ config }, { ...CHECKPOINT_LIMITS }).create({ workspaceId: owner.id, threadId, turnId: id('turn'), phase: 'before' });
    const object = Buffer.concat([Buffer.from(`blob ${content.length}\0`), content]);
    const oid = createHash('sha1').update(object).digest('hex');
    const objectPath = path.join(checkpoint.directory.absolute, 'objects', oid.slice(0, 2), oid.slice(2));
    const checkpointPath = checkpoint.directory.absolute;
    try { await fs.mkdir(path.dirname(objectPath), { recursive: true }); await fs.writeFile(objectPath, deflateSync(object)); }
    finally { await checkpoint.directory.close(); }
    const generic = path.join(config.stateDir, CONVERSATION_FILE_DIRECTORY, sha(owner.id), attachment.id);
    const uploaded = path.join(config.stateDir, 'image-attachments-v1', sha(owner.id), image.id);
    const produced = path.join(config.dataDir, 'generated-images-v1', sha(owner.id), output.id);
    const paths = [...recovery.paths, file(`thread-${threadId}`), file(`thread-summary-${threadId}`), file(`thread-goal-${threadId}`), discard, history,
      `${generic}.file`, `${generic}.json`, `${uploaded}.image`, `${uploaded}.json`, `${produced}.image`, `${produced}.json`, `${produced}.ready`,
      path.join(checkpointPath, 'owner.json'), objectPath];
    const snapshot = await Promise.all(paths.map(async location => ({ location, bytes: await fs.readFile(location) })));
    return { workspaceId: owner.id, threadId, text, generic, uploaded, produced, recovery, discard, history, extensions,
      checkpointPath, objectPath, object, paths, snapshot };
  }

  async function globals() {
    await ctx.store.write('settings', { ...defaultSettings });
    await ctx.store.write('github-accounts', [{ id: 'gh_lifecycle_fixture', login: 'fixture-owner', connectedAt: new Date().toISOString() }]);
    await ctx.secrets.set('github_account_lifecycle_fixture', 'fixture-value-for-encrypted-store');
    const skill = path.join(config.homeDir, '.codex', 'skills', 'kept-skill', 'SKILL.md');
    const workflow = path.join(peer.path, '.codex', 'workflows', 'kept-workflow.md');
    const separateCopy = path.join(config.dataDir, 'independent-download-copy.png');
    await fs.mkdir(path.dirname(skill), { recursive: true }); await fs.mkdir(path.dirname(workflow), { recursive: true });
    await fs.writeFile(skill, '---\nname: kept-skill\ndescription: Retained user configuration.\n---\nKeep this skill.\n');
    await fs.writeFile(workflow, '# Saved workflow\nKeep this unrelated workspace workflow.\n');
    await fs.writeFile(separateCopy, png);
    const sharedHistory = path.join(config.homeDir, '.local', 'state', 'terminal-history', 'shared.history');
    await fs.mkdir(path.dirname(sharedHistory), { recursive: true });
    await fs.writeFile(sharedHistory, 'printf "Retained shared shell history"\n', { mode: 0o600 });
    // A personal plugin can retain a source-workspace hint without becoming
    // project-owned. Its content and shared enablement choices must survive.
    const personal = extensionRows(workspace, 'Retained personal plugin and hook source', 'user'), skillId = id('skill');
    const extensions = await ctx.store.update<ExtensionState>('extensions', EMPTY_STATE, current => ({ ...current,
      plugins: [...current.plugins, personal.plugin], marketplaces: [...current.marketplaces, personal.marketplace],
      skills: [...current.skills, { id: skillId, scope: 'user', baseline: sha('personal skill baseline') }],
      disabledSkills: [...current.disabledSkills, skillId], disabledPlugins: [...current.disabledPlugins, personal.plugin.id],
      builtinFingerprints: { ...current.builtinFingerprints, 'owner-fixture': sha('saved built-in baseline') } }));
    const files = await Promise.all([file('settings'), file('github-accounts'), file('protected-credentials'), skill, workflow, separateCopy, sharedHistory]
      .map(async location => ({ location, bytes: await fs.readFile(location) })));
    return { files, extensions, personal };
  }
  async function stopHandles() {
    for (const service of assets.splice(0)) await service.close();
    for (const handle of handles.splice(0)) {
      await handle.ctx.workspaces.closeFileTrashPages(); await handle.ctx.workspaces.closeTrashCleanup(); await handle.ctx.store.flush();
    }
  }
  return { directory, config, ctx, cleanup: initial.cleanup, workspace, peer, open, seed, rewind, globals, file, signed, stopHandles,
    async record(deletionId: string) {
      const record = (await listTrashRecords(config)).find(item => item.id === deletionId);
      if (!record) throw new Error('Expected durable deletion progress.');
      return record;
    },
    async application(autoStart = false) { const app = await createApplication({ ...config, codexCliAutoStart: autoStart }); applications.push(app); return app; },
    async close() {
      try { for (const app of applications.splice(0)) await app.close(); }
      finally {
        try { await stopHandles(); }
        finally {
          for (const item of barriers) clearWorkspaceRecoveryBarrier(config.workspacesDir, item.workspaceId, item.recoveryId);
          await fs.rm(directory, { recursive: true, force: true });
        }
      }
    } };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
type Artifacts = Awaited<ReturnType<Fixture['seed']>>;
type Globals = Awaited<ReturnType<Fixture['globals']>>;
async function unchanged(snapshot: Array<{ location: string; bytes: Buffer }>) {
  for (const { location, bytes } of snapshot) expect(await fs.readFile(location), location).toEqual(bytes);
}
async function projectExtensions(f: Fixture, artifacts: Artifacts, present: boolean) {
  const state = await new JsonStore(f.config.stateDir).read<ExtensionState>('extensions', EMPTY_STATE);
  const plugin = state.plugins.find(row => row.id === artifacts.extensions.plugin.id);
  const marketplace = state.marketplaces.find(row => row.id === artifacts.extensions.marketplace.id);
  if (present) { expect(plugin).toEqual(artifacts.extensions.plugin); expect(marketplace).toEqual(artifacts.extensions.marketplace); }
  else {
    expect(plugin).toBeUndefined(); expect(marketplace).toBeUndefined();
    expect(await fs.readFile(f.file('extensions'), 'utf8')).not.toContain(artifacts.text);
  }
}
async function retained(f: Fixture, artifacts: Artifacts) {
  await unchanged(artifacts.snapshot); await projectExtensions(f, artifacts, true);
}
async function preservedGlobals(f: Fixture, saved: Globals) {
  await unchanged(saved.files);
  const state = await new JsonStore(f.config.stateDir).read<ExtensionState>('extensions', EMPTY_STATE);
  expect(state.plugins.find(row => row.id === saved.personal.plugin.id)).toEqual(saved.personal.plugin);
  expect(state.marketplaces.find(row => row.id === saved.personal.marketplace.id)).toEqual(saved.personal.marketplace);
  expect(state.skills).toEqual(saved.extensions.skills);
  expect(state.disabledSkills).toEqual(saved.extensions.disabledSkills);
  expect(state.disabledPlugins).toEqual(saved.extensions.disabledPlugins);
  // Normal application startup may add current built-ins; every previously
  // saved baseline and enablement preference still has to remain unchanged.
  expect(state.builtinFingerprints).toEqual(expect.objectContaining(saved.extensions.builtinFingerprints));
}
async function removed(f: Fixture, artifacts: Artifacts) {
  for (const location of artifacts.paths) expect(await exists(location), location).toBe(false);
  expect(await exists(artifacts.recovery.transaction)).toBe(false);
  expect(await exists(artifacts.checkpointPath)).toBe(false);
  await projectExtensions(f, artifacts, false);
}

describe('composed workspace artifact lifecycle', () => {
  let f: Fixture;
  beforeEach(async () => { f = await fixture(); });
  afterEach(async () => { vi.restoreAllMocks(); await f?.close(); });

  it('retains every source through ordinary trash/restore, then cleans only the expired owner at exactly 30 days', async () => {
    const owned = await f.seed(f.workspace, 'target retention source'), peer = await f.seed(f.peer, 'peer retention source'), saved = await f.globals();
    const engine = vi.spyOn(CodexRuntime.prototype, 'start');
    const result = await f.ctx.workspaces.trashWorkspace(f.workspace.id, { expectedMode: 'trash' });
    if (result.mode !== 'trash') throw new Error('Expected ordinary trash.');
    expect(Date.parse(result.trash.expiresAt) - Date.parse(result.trash.deletedAt)).toBe(TRASH_RETENTION_MS);
    await retained(f, owned); expect(f.cleanup).not.toHaveBeenCalled();
    await f.ctx.workspaces.restoreWorkspaceTrash(result.trash.id);
    await retained(f, owned);
    const again = await f.ctx.workspaces.trashWorkspace(f.workspace.id, { expectedMode: 'trash' });
    if (again.mode !== 'trash') throw new Error('Expected another restorable deletion.');
    await f.stopHandles();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(again.trash.expiresAt) - 1);
    const young = await f.open();
    expect((await young.ctx.workspaces.listWorkspaceTrash()).map(item => item.id)).toContain(again.trash.id);
    expect(young.cleanup).not.toHaveBeenCalled(); await retained(f, owned);
    await f.stopHandles(); clock.mockReturnValue(Date.parse(again.trash.expiresAt));
    const expired = await f.open();
    expect((await f.record(again.trash.id))).toMatchObject({ phase: 'purged', artifactCleanup: { state: 'complete' } });
    expect(await expired.ctx.workspaces.listWorkspaceTrash()).toEqual([]);
    await removed(f, owned); await retained(f, peer); await preservedGlobals(f, saved);
    expect(engine).not.toHaveBeenCalled(); expect(expired.ctx.settings).not.toHaveBeenCalled(); expect(expired.ctx.providerKey).not.toHaveBeenCalled();
  });

  it('permanently removes all sources for trusted GitHub provenance and preserves peer data and decryptable account settings', async () => {
    const owned = await f.seed(f.workspace, 'target GitHub source'), peer = await f.seed(f.peer, 'peer GitHub source'), saved = await f.globals();
    await f.ctx.workspaces.writeFile(f.workspace.id, 'live.txt', 'Local checkout bytes');
    await f.ctx.workspaces.completeGithubImport(f.workspace.id, 'gh_lifecycle_fixture', 'example/lifecycle');
    const get = vi.spyOn(f.ctx.workspaces, 'get').mockRejectedValue(new Error('Permanent cleanup must not reopen the removed checkout.'));
    const engine = vi.spyOn(CodexRuntime.prototype, 'start');
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Lifecycle cleanup must remain local.'));
    expect(await f.ctx.workspaces.trashWorkspace(f.workspace.id, { expectedMode: 'permanent' }))
      .toEqual({ removed: true, mode: 'permanent', workspaceId: f.workspace.id });
    expect(get).not.toHaveBeenCalled(); expect(engine).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    await removed(f, owned); await retained(f, peer); await preservedGlobals(f, saved);
    expect(await exists(f.workspace.path)).toBe(false);
    expect(await f.ctx.workspaces.listWorkspaceTrash()).toEqual([]); expect(await f.ctx.workspaces.listWorkspaceDeletions()).toEqual([]);
    expect(await new SecretStore(new JsonStore(f.config.stateDir), f.config.encryptionKey).get('github_account_lifecycle_fixture')).toBe('fixture-value-for-encrypted-store');
    expect(await new JsonStore(f.config.stateDir).read('agent-changes', [])).toMatchObject([{ workspaceId: f.peer.id, original: peer.text }]);
  });

  it('replays an interrupted late leaf during actual application startup before native CLI startup, with no live target lookup', async () => {
    const owned = await f.seed(f.workspace, 'target restart source'), peer = await f.seed(f.peer, 'peer restart source'), saved = await f.globals();
    await f.ctx.workspaces.completeGithubImport(f.workspace.id, 'gh_lifecycle_fixture', 'example/restart');
    const unlink = fs.unlink.bind(fs); let failed = false;
    const failure = vi.spyOn(fs, 'unlink').mockImplementation(async location => {
      if (!failed && String(location).endsWith(`/${path.basename(owned.uploaded)}.json`)) {
        failed = true; throw Object.assign(new Error('Injected late image metadata removal failure.'), { code: 'EIO' });
      }
      return unlink(location);
    });
    await expect(f.ctx.workspaces.trashWorkspace(f.workspace.id, { expectedMode: 'permanent' })).rejects.toMatchObject({ code: 'WORKSPACE_ARTIFACT_CLEANUP_FAILED' });
    expect(failed).toBe(true); failure.mockRestore();
    const pending = (await f.ctx.workspaces.listWorkspaceDeletions())[0]; expect(pending).toBeDefined();
    expect(await f.record(pending.id)).toMatchObject({ phase: 'purging', artifactCleanup: { state: 'pending' } });
    expect(await exists(f.workspace.path)).toBe(false); expect(await exists(f.file(`thread-${owned.threadId}`))).toBe(false);
    expect(await exists(`${owned.generic}.file`)).toBe(false); expect(await exists(`${owned.uploaded}.json`)).toBe(true);
    expect(await exists(owned.discard)).toBe(false); expect(await exists(owned.history)).toBe(false);
    await projectExtensions(f, owned, false); await retained(f, peer); await preservedGlobals(f, saved);
    expect(inflateSync(await fs.readFile(owned.objectPath))).toEqual(owned.object);
    await f.stopHandles();
    const originalGet = WorkspaceService.prototype.get;
    const forbiddenLookups: string[] = [];
    vi.spyOn(WorkspaceService.prototype, 'get').mockImplementation(function (this: WorkspaceService, workspaceId) {
      if (workspaceId === f.workspace.id) { forbiddenLookups.push(workspaceId); return Promise.reject(new Error('Deleted root cannot be reopened at startup.')); }
      return originalGet.call(this, workspaceId);
    });
    const beforeNativeStart: Array<Record<string, boolean>> = [];
    let observed!: () => void; const observedStart = new Promise<void>(resolve => { observed = resolve; });
    vi.spyOn(CodexRuntime.prototype, 'start').mockImplementation(async function (this: CodexRuntime) {
      // Observe the actual cold-state proof; metadata initialization may create
      // an empty native home. No installer, process or provider is started here.
      const absent = await this.verifyNativeStateAbsent();
      beforeNativeStart.push({ nativeStateAbsent: absent, uploadGone: !await exists(owned.uploaded + '.json'),
        objectGone: !await exists(owned.objectPath), discardGone: !await exists(owned.discard),
        historyGone: !await exists(owned.history), cleanupComplete: (await f.record(pending.id)).artifactCleanup?.state === 'complete' });
      observed();
    });
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Lifecycle startup must not contact a provider.'));
    const application = await f.application(true); await observedStart;
    expect(beforeNativeStart).toEqual([{ nativeStateAbsent: true, uploadGone: true, objectGone: true,
      discardGone: true, historyGone: true, cleanupComplete: true }]);
    expect(forbiddenLookups).toEqual([]); expect(fetch).not.toHaveBeenCalled();
    expect(await application.ctx.workspaces.listWorkspaceDeletions()).toEqual([]);
    await removed(f, owned); await retained(f, peer); await preservedGlobals(f, saved);
    expect(await application.ctx.secrets.get('github_account_lifecycle_fixture')).toBe('fixture-value-for-encrypted-store');
  });

  it('stops between actual cleanup leaves when deletion authority changes and never fences the remaining owner data', async () => {
    const owned = await f.seed(f.workspace, 'target fenced source'), peer = await f.seed(f.peer, 'peer fenced source'), saved = await f.globals();
    const result = await f.ctx.workspaces.trashWorkspace(f.workspace.id, { expectedMode: 'trash' });
    if (result.mode !== 'trash') throw new Error('Expected ordinary trash.');
    const unlink = fs.unlink.bind(fs); let revoked = false;
    const fault = vi.spyOn(fs, 'unlink').mockImplementation(async location => {
      await unlink(location);
      if (!revoked && String(location).endsWith(`/${path.basename(owned.discard)}`)) {
        revoked = true;
        await f.ctx.store.write(`workspace-archived-${f.workspace.id}`, { id: f.workspace.id, kind: 'workspace-trash', trashId: randomUUID(), archivedAt: new Date().toISOString() });
      }
    });
    await expect(f.ctx.workspaces.purgeWorkspaceTrash(result.trash.id)).rejects.toMatchObject({ code: 'WORKSPACE_ARTIFACT_CLEANUP_CHANGED' });
    expect(revoked).toBe(true); fault.mockRestore();
    expect(await exists(f.file(`thread-${owned.threadId}`))).toBe(false); expect(await exists(owned.discard)).toBe(false);
    await unchanged(owned.snapshot.filter(item => [owned.history, `${owned.generic}.file`, `${owned.generic}.json`].includes(item.location)));
    await projectExtensions(f, owned, true);
    expect(await fs.readFile(`${owned.uploaded}.image`)).toEqual(png); expect(await fs.readFile(`${owned.produced}.image`)).toEqual(png);
    expect(inflateSync(await fs.readFile(owned.objectPath))).toEqual(owned.object);
    for (const root of [path.join(f.config.stateDir, 'image-attachments-v1'), path.join(f.config.dataDir, 'generated-images-v1')]) {
      expect(await exists(path.join(root, `${sha(f.workspace.id)}.deleted.json`))).toBe(false);
    }
    await f.ctx.workspaces.purgeWorkspaceTrash(result.trash.id);
    expect(await f.record(result.trash.id)).toMatchObject({ phase: 'purged', artifactCleanup: { state: 'superseded' } });
    await retained(f, peer); await preservedGlobals(f, saved); await projectExtensions(f, owned, true);
    expect(await exists(owned.history)).toBe(true); expect(await exists(`${owned.generic}.file`)).toBe(true);
    expect(await fs.readFile(`${owned.uploaded}.image`)).toEqual(png); expect(await exists(owned.objectPath)).toBe(true);
  });

  it('applies both trash and signed rewind exclusions before metadata restoration and reinstates the recovery barrier before workspace startup', async () => {
    const healthy = await f.ctx.workspaces.create({ name: 'Healthy metadata owner' });
    await fs.mkdir(path.join(f.workspace.path, 'empty'));
    await fs.symlink('empty', path.join(f.workspace.path, 'old-link'));
    const pendingFile = path.join(f.peer.path, 'tool.sh'), healthyFile = path.join(healthy.path, 'tool.sh');
    await fs.writeFile(pendingFile, '#!/bin/sh\nexit 0\n'); await fs.chmod(pendingFile, 0o755);
    await fs.writeFile(healthyFile, '#!/bin/sh\nexit 0\n'); await fs.chmod(healthyFile, 0o755);
    await fs.symlink('tool.sh', path.join(f.peer.path, 'old-link'));
    const metadata = new FileMetadataManager(f.config, f.ctx.store);
    try { await metadata.initialize(); } finally { await metadata.close(); }
    const trashed = await f.ctx.workspaces.trashWorkspace(f.workspace.id, { expectedMode: 'trash' });
    if (trashed.mode !== 'trash') throw new Error('Expected retained trash.');
    const threadId = id('thr');
    const recovery = await f.rewind(f.peer, threadId, { thread: { id: threadId, workspaceId: f.peer.id, messages: [] }, input: [] }, true);
    await fs.chmod(pendingFile, 0o644); await fs.chmod(healthyFile, 0o644); await fs.unlink(path.join(f.peer.path, 'old-link'));
    await f.stopHandles();
    expect(workspaceRecoveryBarrier(f.config.workspacesDir, f.peer.id)).toBeNull();
    const initialize = WorkspaceService.prototype.initialize;
    let observed: object | undefined;
    const startup = vi.spyOn(WorkspaceService.prototype, 'initialize').mockImplementationOnce(async function (this: WorkspaceService) {
      observed = { trashedAbsent: !(await exists(f.workspace.path)), pendingMode: (await fs.stat(pendingFile)).mode & 0o777,
        pendingLinkAbsent: !(await exists(path.join(f.peer.path, 'old-link'))), healthyMode: (await fs.stat(healthyFile)).mode & 0o777,
        recoveryId: workspaceRecoveryBarrier(f.config.workspacesDir, f.peer.id)?.recoveryId };
      return initialize.call(this);
    });
    const application = await f.application(); startup.mockRestore();
    expect(observed).toEqual({ trashedAbsent: true, pendingMode: 0o644, pendingLinkAbsent: true, healthyMode: 0o755, recoveryId: recovery.planId });
    expect((await application.ctx.workspaces.listWorkspaceTrash()).map(item => item.id)).toContain(trashed.trash.id);
    await expect(application.ctx.workspaces.writeFile(f.peer.id, 'blocked.txt', 'Cannot bypass recovery')).rejects.toMatchObject({ code: 'FILE_REWIND_RECOVERY_REQUIRED' });
    expect(await exists(path.join(f.peer.path, 'blocked.txt'))).toBe(false);
    expect(await exists(path.join(recovery.transaction, 'parked', '000000'))).toBe(true);
  });
});
