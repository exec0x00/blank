import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { AppContext } from '../server/context';
import { loadConfig } from '../server/config';
import { HttpError } from '../server/errors';
import { JsonStore, SecretStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import { withWorkspaceRemoval, setWorkspaceRecoveryBarrier, clearWorkspaceRecoveryBarrier } from '../server/worktrees/activity';
import type { WorkspaceArtifactCleanupRequest } from '../server/workspace-trash/service';
import { cleanupWorkspaceConversationState } from '../server/agent/workspace-conversation-cleanup';
import { ConversationCleanupFiles, WORKSPACE_CONVERSATION_CLEANUP_LIMITS } from '../server/agent/workspace-conversation-cleanup-files';
import { registerWorkspaceConversationCleanup } from '../server/agent/workspace-cleanup-runtime';

const target = 'workspace-target', peer = 'workspace-peer', stamp = '2026-09-20T10:00:00.000Z';
const tid = (n: number) => `thr_${n.toString(16).padStart(32, '0')}`;
const reviewId = `review_${'a'.repeat(32)}`, backupKey = `thread-backup-history_${'b'.repeat(32)}`;
const targetText = 'TARGET_CONVERSATION_SOURCE_ownership_regression';
const peerText = 'PEER_CONVERSATION_SOURCE_must_remain';
const summary = (id = tid(1), workspaceId = target) => ({ id, workspaceId, title: workspaceId === target ? targetText : peerText,
  createdAt: stamp, updatedAt: stamp, status: 'idle' as const });
const saved = (id = tid(1), workspaceId = target) => ({ thread: { ...summary(id, workspaceId), messages: [
  { id: `msg_${'1'.repeat(32)}`, role: 'user', content: workspaceId === target ? targetText : peerText, createdAt: stamp }], turns: [] },
  input: [{ role: 'user', content: workspaceId === target ? targetText : peerText }], revision: 1 });

describe('permanent workspace conversation state cleanup', () => {
  let directory: string, runtime: string, ctx: AppContext, request: WorkspaceArtifactCleanupRequest;
  const services: WorkspaceService[] = [];
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-conversation-purge-'));
    runtime = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-conversation-purge-runtime-'));
    const config = loadConfig({ DATA_DIR: directory, RUNTIME_DIR: runtime, WORKSPACE_PASSWORD: 'cleanup-fixture-password',
      SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'k'.repeat(64) });
    await fs.mkdir(config.stateDir, { recursive: true });
    const store = new JsonStore(config.stateDir);
    ctx = { config, store, secrets: new SecretStore(store, config.encryptionKey), events: new EventEmitter(),
      workspaces: { get: vi.fn(async () => { throw new Error('Cleanup cannot require a live workspace.'); }) } as unknown as WorkspaceService,
      settings: vi.fn(async () => { throw new Error('Cleanup cannot load model settings.'); }),
      saveSettings: vi.fn(async () => { throw new Error('Cleanup cannot change settings.'); }),
      providerKey: vi.fn(async () => { throw new Error('Cleanup cannot resolve a provider.'); }) };
    request = { workspaceId: target, deletionId: randomUUID(), mode: 'permanent', deletedAt: stamp, assertCurrent: vi.fn(async () => undefined) };
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const service of services.splice(0)) { await service.closeFileTrashPages(); await service.closeTrashCleanup(); }
    await ctx.store.flush();
    await fs.rm(directory, { recursive: true, force: true }); await fs.rm(runtime, { recursive: true, force: true });
  });
  const file = (key: string) => path.join(ctx.config.stateDir, `${key}.json`);
  const run = (context = ctx, authority = request) => withWorkspaceRemoval(context.config.workspacesDir, authority.workspaceId,
    () => cleanupWorkspaceConversationState(context, authority));
  async function seed(workspaceId = target) {
    const record = { ...saved(tid(1), workspaceId), turnJournals: { turn_one: `thread-turn-${tid(1)}-turn_one` },
      historyBackups: [backupKey], reviewSnapshots: { [reviewId]: `review-snapshot-${reviewId}` } };
    const root = { ...record, turnQueue: { entries: [{ prompt: targetText, modelContent: [{ type: 'input_image', image_url: `data:image/png;base64,${Buffer.from(targetText).toString('base64')}` }] }] } };
    await ctx.store.write(`thread-${tid(1)}`, root);
    await ctx.store.write(`thread-summary-${tid(1)}`, { version: 1, summary: summary(tid(1), workspaceId) });
    await ctx.store.write(`thread-context-${tid(1)}`, { version: 1, threadId: tid(1), workspaceId, contextUsage: null, usage: null });
    await ctx.store.write(`thread-turn-${tid(1)}-turn_one`, { turnId: 'turn_one', input: [{ role: 'user', content: targetText }] });
    await ctx.store.write(backupKey, { version: 2, threadId: tid(1), record, turnInputs: [{ turnId: 'turn_one', input: [{ role: 'user', content: targetText }] }] });
    await ctx.store.write(`review-snapshot-${reviewId}`, { version: 1, id: reviewId, workspaceId, files: [{ original: targetText, modified: targetText }] });
    await ctx.store.write(`thread-goal-${tid(1)}`, { version: 1, threadId: tid(1), goal: { threadId: tid(1), objective: targetText }, history: [] });
    await ctx.store.write(`thread-naming-${tid(1)}`, { version: 1, status: 'generated', title: targetText });
    await ctx.store.write(`thread-view-${tid(1)}`, { version: 1, nextRevision: 500 });
    const child = saved(tid(2), workspaceId);
    Object.assign(child.thread, { parentThreadId: tid(1), rootThreadId: tid(1), taskName: 'owned_child', agentRole: 'worker' });
    await ctx.store.write(`thread-${tid(2)}`, child);
    await ctx.store.write(`agent-${tid(2)}`, { version: 1, agent: { id: tid(2), workspaceId, parentThreadId: tid(1), rootThreadId: tid(1), finalMessage: targetText },
      notifications: [{ finalMessage: targetText }] });
    await ctx.store.write(`thread-${tid(3)}`, saved(tid(3), peer));
    await ctx.store.write(`thread-summary-${tid(3)}`, { version: 1, summary: summary(tid(3), peer) });
    await ctx.store.write('thread-index', [summary(tid(1), workspaceId), summary(tid(2), workspaceId), summary(tid(3), peer)]);
    await ctx.store.write('agent-index', [{ id: tid(2), workspaceId, parentThreadId: tid(1), rootThreadId: tid(1) }]);
    await ctx.store.write('thread-goal-index', [tid(1), tid(3)]);
    await ctx.store.write('thread-naming-pending', { [tid(1)]: 'owned-request', [tid(3)]: 'peer-request' });
    await ctx.store.write('agent-changes', ['pending', 'kept', 'undone'].map((status, i) => ({ id: `owned-${i}`, workspaceId,
      threadId: tid(1), path: `source-${i}.ts`, original: targetText, modified: targetText, status, createdAt: stamp,
      _original: { data: Buffer.from(targetText).toString('base64'), encoding: 'base64' } })).concat([
      { id: 'peer-change', workspaceId: peer, threadId: tid(3), path: 'peer.ts', original: peerText, modified: peerText, status: 'kept', createdAt: stamp,
        _original: { data: Buffer.from(peerText).toString('base64'), encoding: 'base64' } }]));
    for (const key of ['protected-credentials', 'settings', 'model-registry', 'extension-state', 'ui-settings']) await ctx.store.write(key, { marker: `preserved-${key}` });
  }
  async function stateText(): Promise<string> {
    const entries = await fs.readdir(ctx.config.stateDir, { withFileTypes: true });
    return (await Promise.all(entries.filter(entry => entry.isFile()).map(entry => fs.readFile(path.join(ctx.config.stateDir, entry.name), 'utf8')))).join('\n');
  }

  it.each(['permanent', 'trash'] as const)('removes all owned conversation copies for a completed %s purge and preserves peer/global state', async mode => {
    await seed(); request = { ...request, mode };
    const peerBefore = await fs.readFile(file(`thread-${tid(3)}`));
    await run();
    const contents = await stateText();
    expect(contents).not.toContain(targetText);
    expect(contents).not.toContain(Buffer.from(targetText).toString('base64'));
    expect(await fs.readFile(file(`thread-${tid(3)}`))).toEqual(peerBefore);
    expect(contents).toContain(peerText);
    expect(await ctx.store.read('agent-changes', [])).toMatchObject([{ id: 'peer-change', original: peerText }]);
    expect(await ctx.store.read('thread-goal-index', [])).toEqual([tid(3)]);
    expect(await ctx.store.read('thread-naming-pending', {})).toEqual({ [tid(3)]: 'peer-request' });
    for (const key of ['protected-credentials', 'settings', 'model-registry', 'extension-state', 'ui-settings']) expect(await ctx.store.read(key, null)).toEqual({ marker: `preserved-${key}` });
    expect(await ctx.store.read(`thread-deleted-${tid(1)}`, null)).toMatchObject({ version: 1, id: tid(1) });
    expect(await ctx.store.read('thread-deleted-' + tid(2), null)).toMatchObject({ version: 1, id: tid(2) });
    expect(ctx.workspaces.get).not.toHaveBeenCalled(); expect(ctx.settings).not.toHaveBeenCalled(); expect(ctx.providerKey).not.toHaveBeenCalled();
  });

  it('requires caller-owned removal admission before touching saved content', async () => {
    await seed();
    await expect(cleanupWorkspaceConversationState(ctx, request)).rejects.toMatchObject({ code: 'WORKSPACE_CONVERSATION_REMOVAL_REQUIRED' });
    expect(await fs.readFile(file(`thread-${tid(1)}`), 'utf8')).toContain(targetText);
  });

  it('does not mistake a blocking recovery marker for an admitted removal gate', async () => {
    await seed();
    setWorkspaceRecoveryBarrier(ctx.config.workspacesDir, target, { recoveryId: 'pending-rewind', message: 'Review the pending rewind.' });
    try {
      await expect(cleanupWorkspaceConversationState(ctx, request)).rejects.toMatchObject({ code: 'WORKSPACE_CONVERSATION_REMOVAL_REQUIRED' });
      expect(await fs.readFile(file(`thread-${tid(1)}`), 'utf8')).toContain(targetText);
    } finally { clearWorkspaceRecoveryBarrier(ctx.config.workspacesDir, target, 'pending-rewind'); }
  });

  it('retries an interrupted removal with a new context and the signed exact ownership receipt', async () => {
    await seed();
    const unlink = fs.unlink.bind(fs); let injected = false;
    const failure = vi.spyOn(fs, 'unlink').mockImplementation(async value => {
      if (!injected && String(value).endsWith(`/thread-${tid(1)}.json`)) { injected = true; throw Object.assign(new Error('Injected removal outage'), { code: 'EIO' }); }
      return unlink(value);
    });
    await expect(run()).rejects.toThrow('Injected removal outage');
    expect(injected).toBe(true);
    await expect(fs.stat(file(`thread-turn-${tid(1)}-turn_one`))).rejects.toMatchObject({ code: 'ENOENT' });
    failure.mockRestore();
    const fresh = { ...ctx, store: new JsonStore(ctx.config.stateDir) };
    await run(fresh);
    expect(await stateText()).not.toContain(targetText);
    expect(await fresh.store.read(`thread-${tid(3)}`, null)).toEqual(saved(tid(3), peer));
  });

  it('keeps malformed saved references from selecting a credential or unrelated state file', async () => {
    await seed();
    await ctx.store.update<Record<string, unknown>>(`thread-${tid(1)}`, {}, current => ({ ...current, turnJournals: { turn_one: 'protected-credentials' } }));
    await expect(run()).rejects.toMatchObject({ code: 'WORKSPACE_CONVERSATION_CLEANUP_OWNERSHIP' });
    expect(await ctx.store.read('protected-credentials', null)).toEqual({ marker: 'preserved-protected-credentials' });
    expect(await fs.readFile(file(`thread-${tid(1)}`), 'utf8')).toContain(targetText);
  });

  it('refuses conflicting workspace ownership and never traverses into a foreign descendant', async () => {
    await seed();
    await ctx.store.update<Record<string, unknown>>(`thread-${tid(3)}`, {}, current => {
      const thread = current.thread as Record<string, unknown>;
      return { ...current, thread: { ...thread, parentThreadId: tid(1), rootThreadId: tid(1) } };
    });
    const before = await fs.readFile(file(`thread-${tid(3)}`));
    await expect(run()).rejects.toMatchObject({ code: 'WORKSPACE_CONVERSATION_CLEANUP_OWNERSHIP' });
    expect(await fs.readFile(file(`thread-${tid(3)}`))).toEqual(before);
    expect(await fs.readFile(file(`thread-${tid(1)}`), 'utf8')).toContain(targetText);
  });

  it('leaves an unowned legacy journal visible as an incomplete purge instead of guessing its workspace', async () => {
    await seed();
    await ctx.store.write(`thread-turn-${tid(99)}-turn_partial`, { turnId: 'turn_partial', input: [{ role: 'user', content: 'Unknown legacy owner' }] });
    await expect(run()).rejects.toMatchObject({ code: 'WORKSPACE_CONVERSATION_CLEANUP_OWNERSHIP' });
    expect(await ctx.store.read(`thread-turn-${tid(99)}-turn_partial`, null)).toMatchObject({ turnId: 'turn_partial' });
  });

  it('can attribute a new interrupted-fork journal independently from its versioned ownership envelope', async () => {
    await seed();
    await ctx.store.write(`thread-turn-${tid(99)}-turn_partial`, { version: 2, threadId: tid(99), workspaceId: target,
      turnId: 'turn_partial', input: [{ role: 'user', content: targetText }] });
    await run();
    expect(await ctx.store.read(`thread-turn-${tid(99)}-turn_partial`, null)).toBeNull();
    expect(await ctx.store.read('thread-deleted-' + tid(99), null)).toMatchObject({ version: 1, id: tid(99) });
  });

  it.each(['symlink', 'hardlink'] as const)('refuses a %s source and preserves its external bytes', async kind => {
    await seed();
    const outside = path.join(runtime, 'outside.json');
    await fs.rename(file(`thread-${tid(1)}`), outside);
    if (kind === 'symlink') await fs.symlink(outside, file(`thread-${tid(1)}`));
    else await fs.link(outside, file(`thread-${tid(1)}`));
    await expect(run()).rejects.toMatchObject({ code: 'WORKSPACE_CONVERSATION_CLEANUP_UNSAFE' });
    expect(await fs.readFile(outside, 'utf8')).toContain(targetText);
  });

  it('rejects an oversized sparse record before loading its body', async () => {
    await seed();
    await fs.truncate(file(`thread-${tid(1)}`), WORKSPACE_CONVERSATION_CLEANUP_LIMITS.recordBytes + 1);
    await expect(run()).rejects.toMatchObject({ code: 'WORKSPACE_CONVERSATION_CLEANUP_LIMIT' });
    expect((await fs.stat(file(`thread-${tid(1)}`))).size).toBe(WORKSPACE_CONVERSATION_CLEANUP_LIMITS.recordBytes + 1);
  });

  it('fails visibly on a partial JsonStore history write instead of leaving its content silently behind', async () => {
    await seed();
    const partial = `${file(`thread-${tid(1)}`)}.${randomUUID()}.tmp`;
    await fs.writeFile(partial, JSON.stringify(saved()));
    await expect(run()).rejects.toMatchObject({ code: 'WORKSPACE_CONVERSATION_CLEANUP_OWNERSHIP' });
    expect(await fs.readFile(partial, 'utf8')).toContain(targetText);
  });

  it('does not overlook another purge’s interrupted shared-store rewrite containing this workspace’s bytes', async () => {
    await seed();
    const temporary = path.join(ctx.config.stateDir, `.conversation-cleanup-${randomUUID()}.tmp`);
    await fs.writeFile(temporary, JSON.stringify([{ id: 'surviving-owner', workspaceId: target, original: targetText }]));
    await expect(run()).rejects.toMatchObject({ code: 'WORKSPACE_CONVERSATION_CLEANUP_OWNERSHIP' });
    expect(await fs.readFile(temporary, 'utf8')).toContain(targetText);
    expect(await fs.readFile(file(`thread-${tid(1)}`), 'utf8')).toContain(targetText);
  });

  it('rechecks the deletion generation before each unlink and preserves a newly superseded record', async () => {
    await seed();
    const original = ctx.store.mutateGuarded.bind(ctx.store);
    let superseded = false;
    vi.spyOn(ctx.store, 'mutateGuarded').mockImplementation((key, operation) => {
      if (key === `thread-${tid(1)}`) superseded = true;
      return original(key, operation);
    });
    request = { ...request, assertCurrent: async () => {
      if (superseded) throw new HttpError(409, 'Deletion was superseded', 'WORKSPACE_ARTIFACT_CLEANUP_CHANGED');
    } };
    await expect(run()).rejects.toMatchObject({ code: 'WORKSPACE_ARTIFACT_CLEANUP_CHANGED' });
    expect(await fs.readFile(file(`thread-${tid(1)}`), 'utf8')).toContain(targetText);
  });

  it('preserves bytes changed after the signed receipt was captured', async () => {
    await seed();
    const original = ctx.store.mutateGuarded.bind(ctx.store); let changed = false;
    vi.spyOn(ctx.store, 'mutateGuarded').mockImplementation(async (key, operation) => {
      if (!changed && key === `thread-${tid(1)}`) {
        changed = true; const value = saved(); value.thread.messages[0].content = 'Concurrent replacement content';
        await fs.writeFile(file(key), JSON.stringify(value));
      }
      return original(key, operation);
    });
    await expect(run()).rejects.toMatchObject({ code: 'WORKSPACE_CONVERSATION_CLEANUP_CHANGED' });
    expect(await fs.readFile(file(`thread-${tid(1)}`), 'utf8')).toContain('Concurrent replacement content');
  });

  it('preserves an unrelated shared-store update that lands during the final generation check', async () => {
    await seed();
    const current = await ctx.store.read<Array<Record<string, unknown>>>('agent-changes', []);
    const addition = { id: 'new-peer-source', workspaceId: peer, threadId: tid(3), path: 'fresh.ts', status: 'kept',
      original: 'Concurrent peer source', modified: 'Concurrent peer source', createdAt: stamp };
    let checks = 0;
    const authority = { ...request, assertCurrent: async () => {
      if (++checks === 2) await fs.writeFile(file('agent-changes'), JSON.stringify([...current, addition]));
    } };
    const files = await ConversationCleanupFiles.open(ctx, authority);
    try {
      await expect(files.update('agent-changes', WORKSPACE_CONVERSATION_CLEANUP_LIMITS.aggregateBytes, value =>
        (value as Array<Record<string, unknown>>).filter(row => row.workspaceId !== target)))
        .rejects.toMatchObject({ code: 'WORKSPACE_CONVERSATION_CLEANUP_CHANGED' });
    } finally { await files.close(); }
    expect(await ctx.store.read('agent-changes', [])).toEqual([...current, addition]);
  });

  it('keeps ordinary trash and restore histories, then purges them through the actual lifecycle callback', async () => {
    let lifecycle!: WorkspaceService;
    lifecycle = new WorkspaceService(ctx.config, ctx.store, { cleanupWorkspaceArtifacts: authority => cleanupWorkspaceConversationState(ctx, authority) });
    ctx.workspaces = lifecycle; services.push(lifecycle);
    await lifecycle.initialize(); const workspace = await lifecycle.create({ name: 'Conversation lifecycle owner' });
    await seed(workspace.id);
    const first = await lifecycle.trashWorkspace(workspace.id, { expectedMode: 'trash' });
    if (first.mode !== 'trash') throw new Error('Expected ordinary workspace trash');
    expect(await fs.readFile(file(`thread-${tid(1)}`), 'utf8')).toContain(targetText);
    await lifecycle.restoreWorkspaceTrash(first.trash.id);
    expect(await fs.readFile(file(`thread-${tid(1)}`), 'utf8')).toContain(targetText);
    const second = await lifecycle.trashWorkspace(workspace.id, { expectedMode: 'trash' });
    if (second.mode !== 'trash') throw new Error('Expected ordinary workspace trash');
    await lifecycle.purgeWorkspaceTrash(second.trash.id);
    expect(await stateText()).not.toContain(targetText);
  });

  it('runs expired-trash cleanup during fresh workspace initialization without any agent/model initialization', async () => {
    const first = new WorkspaceService(ctx.config, ctx.store); services.push(first); ctx.workspaces = first;
    await first.initialize(); const workspace = await first.create({ name: 'Expired conversation owner' });
    await seed(workspace.id);
    const deleted = await first.trashWorkspace(workspace.id, { expectedMode: 'trash' });
    if (deleted.mode !== 'trash') throw new Error('Expected ordinary workspace trash');
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(deleted.trash.expiresAt) + 1);
    const freshStore = new JsonStore(ctx.config.stateDir), fresh = { ...ctx, store: freshStore };
    const restarted = new WorkspaceService(ctx.config, freshStore, { cleanupWorkspaceArtifacts: authority => cleanupWorkspaceConversationState(fresh, authority) });
    fresh.workspaces = restarted; services.push(restarted);
    await restarted.initialize();
    expect(await stateText()).not.toContain(targetText);
    expect(await restarted.listWorkspaceTrash()).toEqual([]);
    expect(ctx.settings).not.toHaveBeenCalled(); expect(ctx.providerKey).not.toHaveBeenCalled();
  });

  it('drains an already-started legacy state write before cleanup enumerates durable owners', async () => {
    const lifecycle = new WorkspaceService(ctx.config, ctx.store); services.push(lifecycle); ctx.workspaces = lifecycle;
    await lifecycle.initialize(); const workspace = await lifecycle.create({ name: 'Delayed legacy owner' });
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const threadId = tid(77);
    const writing = Promise.resolve().then(async () => {
      entered(); await held;
      await ctx.store.writeWithVersion('thread-' + threadId, saved(threadId, workspace.id));
    });
    const unregister = registerWorkspaceConversationCleanup(ctx, 'owned-legacy-state-writer', {
      quiesce: () => writing, forget: async () => undefined,
    });
    try {
      await reached;
      let completed = false;
      const cleanup = run(ctx, { ...request, workspaceId: workspace.id }).then(() => { completed = true; });
      await new Promise<void>(resolve => setImmediate(resolve)); expect(completed).toBe(false);
      release(); await writing; await cleanup;
      expect(await ctx.store.read('thread-' + threadId, null)).toBeNull();
      expect(await ctx.store.read('thread-deleted-' + threadId, null)).toMatchObject({ version: 1, id: threadId });
      expect(ctx.settings).not.toHaveBeenCalled(); expect(ctx.providerKey).not.toHaveBeenCalled();
    } finally { release(); await writing; unregister(); }
  });
});
