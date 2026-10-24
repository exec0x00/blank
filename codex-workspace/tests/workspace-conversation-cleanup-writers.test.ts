import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { AppContext } from '../server/context';
import { loadConfig } from '../server/config';
import { JsonStore } from '../server/store';
import { beginWorkspaceConversationCleanup, finishWorkspaceConversationCleanupAttempt, quiesceWorkspaceConversationWriters,
  registerWorkspaceConversationCleanup, workspaceConversationCleanupActive } from '../server/agent/workspace-cleanup-runtime';
import type { WorkspaceArtifactCleanupRequest } from '../server/workspace-trash/service';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
describe('workspace cleanup fences and drains already-constructed writers', () => {
  let directory: string, ctx: AppContext, request: WorkspaceArtifactCleanupRequest;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-workspace-cleanup-writers-'));
    const config = loadConfig({ DATA_DIR: directory, WORKSPACE_PASSWORD: 'writer-fixture', SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'k'.repeat(64) });
    await fs.mkdir(config.stateDir, { recursive: true });
    ctx = { config, store: new JsonStore(config.stateDir), events: new EventEmitter() } as AppContext;
    request = { workspaceId: 'workspace-retiring', deletionId: randomUUID(), mode: 'permanent', deletedAt: new Date().toISOString(), assertCurrent: async () => undefined };
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await finishWorkspaceConversationCleanupAttempt(ctx, request, false);
    await ctx.store.flush(); await fs.rm(directory, { recursive: true, force: true });
  });
  it('waits for actual queued storage work before the permanent cleanup leaf can start', async () => {
    const entered = deferred(), release = deferred();
    const writing = ctx.store.update('owned-cleanup-fixture', { revision: 0 }, async current => {
      entered.resolve(); await release.promise; return { revision: current.revision + 1 };
    });
    await entered.promise; beginWorkspaceConversationCleanup(ctx, request);
    let drained = false;
    const cleanup = quiesceWorkspaceConversationWriters(ctx, request).then(() => { drained = true; });
    try { await new Promise<void>(resolve => setImmediate(resolve)); expect(drained).toBe(false); }
    finally { release.resolve(); }
    await writing; await cleanup;
    expect(drained).toBe(true); expect(await ctx.store.read('owned-cleanup-fixture', null)).toEqual({ revision: 1 });
  });

  it('drains all same-name live registrations rather than losing an older instance', async () => {
    const entered = deferred(), release = deferred(), observed: string[] = [];
    registerWorkspaceConversationCleanup(ctx, 'same-memory-service', { quiesce: async () => {
      observed.push('old'); entered.resolve(); await release.promise;
    }, forget: async () => undefined });
    registerWorkspaceConversationCleanup(ctx, 'same-memory-service', { quiesce: async () => { observed.push('replacement'); }, forget: async () => undefined });
    beginWorkspaceConversationCleanup(ctx, request);
    let done = false;
    const cleanup = quiesceWorkspaceConversationWriters(ctx, request).then(() => { done = true; });
    try { await entered.promise; await new Promise<void>(resolve => setImmediate(resolve)); expect(done).toBe(false); }
    finally { release.resolve(); }
    await cleanup; expect(observed.sort()).toEqual(['old', 'replacement']);
  });

  it('unregistering one instance retains another same-name participant', async () => {
    const old = vi.fn(async () => undefined), replacement = vi.fn(async () => undefined);
    const unregister = registerWorkspaceConversationCleanup(ctx, 'same-memory-service', { quiesce: old, forget: async () => undefined });
    registerWorkspaceConversationCleanup(ctx, 'same-memory-service', { quiesce: replacement, forget: async () => undefined });
    unregister();
    beginWorkspaceConversationCleanup(ctx, request); await quiesceWorkspaceConversationWriters(ctx, request);
    expect(old).not.toHaveBeenCalled(); expect(replacement).toHaveBeenCalledTimes(1);
  });

  it('releases and resumes every instance when an earlier finalizer fails', async () => {
    const released = vi.fn(async () => undefined), resumedFirst = vi.fn(), resumedSecond = vi.fn();
    const first = registerWorkspaceConversationCleanup(ctx, 'startup', { quiesce: async () => undefined, forget: async () => undefined,
      afterAttempt: async () => { throw new Error('Injected startup metadata read failure'); }, resumeAfterAttempt: resumedFirst });
    const second = registerWorkspaceConversationCleanup(ctx, 'startup', { quiesce: async () => undefined, forget: async () => undefined,
      afterAttempt: released, resumeAfterAttempt: resumedSecond });
    try {
      beginWorkspaceConversationCleanup(ctx, request); await quiesceWorkspaceConversationWriters(ctx, request);
      await expect(finishWorkspaceConversationCleanupAttempt(ctx, request, true)).rejects.toThrow('Injected startup metadata read failure');
      expect(released).toHaveBeenCalledTimes(1);
      expect(resumedFirst).toHaveBeenCalledTimes(1); expect(resumedSecond).toHaveBeenCalledTimes(1);
      expect(workspaceConversationCleanupActive(ctx)).toBe(false);
    } finally { first(); second(); }
  });
});
