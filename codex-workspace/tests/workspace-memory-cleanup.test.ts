import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { cleanupWorkspaceMemoryFiles, WORKSPACE_MEMORY_CLEANUP_LIMITS } from '../server/memories/workspace-cleanup';
import type { WorkspaceArtifactCleanupRequest } from '../server/workspace-trash/service';
import { HttpError } from '../server/errors';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const hash = (value: unknown) => digest(JSON.stringify(value));
const identifier = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`;
const at = '2026-09-20T12:00:00.000Z';
const workspace = 'ws_deleted_memory', peer = 'ws_retained_memory';
const retainedText = 'Peer memory and source bytes must survive unchanged.';
const sourceText = 'Deleted workspace source text that must not remain in memory files.';
const fsError = () => Object.assign(new Error('Injected cleanup interruption.'), { code: 'EIO' });

describe('permanent workspace memory cleanup without runtime recovery', () => {
  let directory: string, stateDir: string, memoryRoot: string;
  let ctx: { config: { stateDir: string; sessionSecret: string } };
  let request: WorkspaceArtifactCleanupRequest;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-workspace-memory-cleanup-'));
    stateDir = path.join(directory, 'state'); memoryRoot = path.join(stateDir, 'memories');
    await fs.mkdir(memoryRoot, { recursive: true });
    ctx = { config: { stateDir, sessionSecret: 'memory-cleanup-fixture-signing-key-'.repeat(3) } };
    request = { workspaceId: workspace, deletionId: randomUUID(), deletedAt: at, mode: 'permanent', assertCurrent: vi.fn(async () => undefined) };
    // Startup cleanup must work before either service exists and after the
    // workspace directory is gone. Access to these runtime ports is a failure.
    for (const key of ['workspaces', 'store', 'settings', 'providerKey']) Object.defineProperty(ctx, key, {
      get() { throw new Error(`Cleanup must not access ${key}.`); },
    });
  });
  afterEach(async () => { vi.restoreAllMocks(); await fs.rm(directory, { recursive: true, force: true }); });

  async function write(relative: string, value: unknown): Promise<string> {
    const filename = path.join(memoryRoot, relative);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, `${JSON.stringify(value, null, 2)}\n`);
    return filename;
  }
  const read = (relative: string) => fs.readFile(path.join(memoryRoot, relative), 'utf8');
  async function absent(relative: string) { await expect(fs.lstat(path.join(memoryRoot, relative))).rejects.toMatchObject({ code: 'ENOENT' }); }
  async function receiptFile() {
    const files = (await fs.readdir(memoryRoot)).filter(name => /^workspace-cleanup-[a-f0-9]{64}\.json$/u.test(name));
    expect(files).toHaveLength(1); return files[0];
  }

  async function extraction(workspaceId = workspace, text = sourceText) {
    const id = identifier('mem'), threadId = identifier('thr'), turnId = identifier('run');
    const jobId = `mjob_${hash([threadId, turnId])}`, fingerprint = digest(`turn-${threadId}`);
    const record = { format: 'native-memory-record-v1', id, revision: 1, workspaceId, kind: 'preference', text,
      createdAt: at, updatedAt: at, expiresAt: '2026-12-19T12:00:00.000Z',
      source: { threadId, turnId, completedAt: at, fingerprint, evidence: [{ messageId: identifier('msg'), role: 'user', quote: text }] },
      generation: { jobId, model: 'gpt-5.6-sol' }, edited: false, epoch: { global: 'initial', workspace: 'initial' } };
    const job = { format: 'native-memory-job-v1', id: jobId, workspaceId, threadId, turnId, status: 'completed',
      model: 'gpt-5.6-sol', reasoningEffort: 'high', createdAt: at, completedAt: at, memoryIds: [id], summary: `${text} Generated summary.`,
      generationEpoch: 'a'.repeat(32), epoch: record.epoch, fingerprint, charged: true, recordHashes: { [id]: hash(record) } };
    const recordPath = `records/${id}.json`, jobPath = `jobs/${jobId}.json`, editPath = `edits/${id}/${randomUUID().replaceAll('-', '')}.json`;
    await write(recordPath, record); await write(jobPath, job);
    await write(editPath, { format: 'native-memory-edit-v1', id, revision: 2, parentRevision: 1, text: `${text} Reviewed revision.`, updatedAt: at, expiresAt: record.expiresAt });
    return { id, threadId, turnId, jobId, record, job, recordPath, jobPath, editPath, paths: [recordPath, jobPath, editPath] };
  }

  async function consolidation(source: Awaited<ReturnType<typeof extraction>>, text = source.record.text) {
    const jobId = `mjob_${digest(`consolidation-${source.threadId}`)}`, workspaceId = source.record.workspaceId;
    const paths = ['memory_summary.md', `rollout_summaries/${source.threadId}.md`, 'skills/workspace-flow/SKILL.md'];
    const artifactPaths: string[] = [];
    const artifacts = [];
    for (const [slot, artifactPath] of paths.entries()) {
      const name = `${jobId}-${slot}.json`, value = { format: 'native-memory-artifact-v1', jobId, workspaceId, path: artifactPath, content: `${text} Consolidated ${slot}.` };
      artifacts.push({ name, path: artifactPath, hash: hash(value) }); artifactPaths.push(`consolidation-artifacts/${name}`);
      await write(artifactPaths.at(-1)!, value);
    }
    const manifest = { format: 'native-memory-consolidation-manifest-v1', jobId, workspaceId, fingerprint: digest(`snapshot-${source.id}`),
      dependencies: [{ id: source.id, revision: 2, hash: digest('validated-memory-view') }], artifacts };
    const job = { format: 'native-memory-consolidation-job-v1', id: jobId, workspaceId, rootThreadId: identifier('thr'),
      fingerprint: manifest.fingerprint, sourceTurns: [{ threadId: source.threadId, turnId: source.turnId }], memoryIds: [source.id],
      artifactPaths: paths, status: 'completed', createdAt: at, completedAt: at };
    const head = { format: 'native-memory-consolidation-head-v1', workspaceId, jobId, fingerprint: manifest.fingerprint, manifestHash: hash(manifest), publishedAt: at };
    const manifestPath = `consolidation-manifests/${jobId}.json`, jobPath = `consolidation-jobs/${jobId}.json`, headPath = `consolidation-heads/${digest(workspaceId)}.json`;
    await write(manifestPath, manifest); await write(jobPath, job); await write(headPath, head);
    return { jobId, manifest, job, head, manifestPath, jobPath, headPath, artifactPaths, paths: [...artifactPaths, manifestPath, jobPath, headPath] };
  }

  it.each(['permanent', 'trash'] as const)('removes all source-bearing files for a confirmed %s purge and preserves other owners and controls', async mode => {
    request = { ...request, mode };
    const target = await extraction(), other = await extraction(peer, retainedText);
    const generated = await consolidation(target), retained = await consolidation(other);
    const controls = ['settings.json', 'barriers/all.json', `barriers/workspace-${digest(workspace)}.json`, `sources/${hash([target.threadId, '*'])}.json`,
      `deleted/${target.id}.json`, `charges/${target.jobId}.json`, `attempts/${target.jobId}.json`, 'user-notes/unrelated.json'];
    for (const relative of controls) await write(relative, { format: 'fixture-control', retain: relative });
    const unchanged = new Map<string, string>();
    for (const relative of [...other.paths, ...retained.paths, ...controls]) unchanged.set(relative, await read(relative));
    const peerReport = { workspaceId: peer, threadId: other.threadId, status: 'completed', summary: retainedText };
    await write('startup.json', { format: 'native-memory-startup-v1', cursors: [{ workspaceId: workspace, partial: { threadId: target.threadId } }, { workspaceId: peer }],
      active: { workspaceId: workspace, threadId: target.threadId, status: 'running', summary: sourceText },
      reports: [{ workspaceId: workspace, threadId: target.threadId, summary: sourceText }, peerReport] });

    await cleanupWorkspaceMemoryFiles(ctx, request);
    for (const relative of [...target.paths, ...generated.paths]) await absent(relative);
    for (const [relative, bytes] of unchanged) expect(await read(relative)).toBe(bytes);
    expect(JSON.parse(await read('startup.json'))).toEqual({ format: 'native-memory-startup-v1', cursors: [{ workspaceId: peer }], reports: [peerReport] });
    const proof = await read(await receiptFile());
    expect(proof).not.toContain(sourceText); expect(proof).not.toContain(retainedText);
    expect(JSON.parse(proof).value).toMatchObject({ workspaceId: workspace, deletionId: request.deletionId, deletedAt: request.deletedAt, mode });
    expect(JSON.parse(proof).value.entries).toHaveLength(target.paths.length + generated.paths.length);
    await cleanupWorkspaceMemoryFiles({ config: { ...ctx.config } }, request);
    expect(await read(await receiptFile())).toBe(proof);
    for (const [relative, bytes] of unchanged) expect(await read(relative)).toBe(bytes);
  });

  it('does not create storage or initialize anything when startup finds no memory directory', async () => {
    await fs.rmdir(memoryRoot);
    await cleanupWorkspaceMemoryFiles(ctx, request);
    await expect(fs.lstat(memoryRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(request.assertCurrent).toHaveBeenCalled();
    await fs.rmdir(stateDir);
    await cleanupWorkspaceMemoryFiles(ctx, request);
    await expect(fs.lstat(stateDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes independently owned partial consolidation artifacts without requiring jobs, manifests or a workspace', async () => {
    const jobId = `mjob_${digest('partial-target-generation')}`, peerJob = `mjob_${digest('partial-peer-generation')}`;
    const targetPath = `consolidation-artifacts/${jobId}-0.json`, otherPath = `consolidation-artifacts/${peerJob}-0.json`;
    await write(targetPath, { format: 'native-memory-artifact-v1', jobId, workspaceId: workspace, path: 'MEMORY.md', content: sourceText });
    await write(otherPath, { format: 'native-memory-artifact-v1', jobId: peerJob, workspaceId: peer, path: 'MEMORY.md', content: retainedText });
    const before = await read(otherPath);
    await cleanupWorkspaceMemoryFiles(ctx, request);
    await absent(targetPath); expect(await read(otherPath)).toBe(before);
  });

  it('uses a validated extraction-job reference to remove revisions whose base record is already missing', async () => {
    const target = await extraction(); await fs.unlink(path.join(memoryRoot, target.recordPath));
    await cleanupWorkspaceMemoryFiles(ctx, request);
    await absent(target.editPath); await absent(target.jobPath);
  });

  it('retains parent ownership until revisions are removed and retries from a fresh context after a failed leaf', async () => {
    const target = await extraction(), other = await extraction(peer, retainedText), original = await read(other.recordPath);
    const unlink = fs.unlink.bind(fs); let fail = true;
    vi.spyOn(fs, 'unlink').mockImplementation(async filename => {
      if (String(filename).endsWith(`/${path.basename(target.editPath)}`) && fail) { fail = false; throw fsError(); }
      return unlink(filename);
    });
    await expect(cleanupWorkspaceMemoryFiles(ctx, request)).rejects.toMatchObject({ code: 'MEMORY_WORKSPACE_CLEANUP_IO' });
    expect(await read(target.recordPath)).toContain(sourceText); expect(await read(target.editPath)).toContain(sourceText);
    const proof = await read(await receiptFile());
    await cleanupWorkspaceMemoryFiles({ config: { ...ctx.config } }, request);
    for (const relative of target.paths) await absent(relative);
    expect(await read(await receiptFile())).toBe(proof); expect(await read(other.recordPath)).toBe(original);
  });

  it('uses the signed receipt to finish an orphan edit chain after an interrupted cleanup loses its parent records', async () => {
    const target = await extraction(), unlink = fs.unlink.bind(fs); let fail = true;
    vi.spyOn(fs, 'unlink').mockImplementation(async filename => {
      if (String(filename).endsWith(`/${path.basename(target.editPath)}`) && fail) { fail = false; throw fsError(); }
      return unlink(filename);
    });
    await expect(cleanupWorkspaceMemoryFiles(ctx, request)).rejects.toMatchObject({ code: 'MEMORY_WORKSPACE_CLEANUP_IO' });
    await unlink(path.join(memoryRoot, target.recordPath)); await unlink(path.join(memoryRoot, target.jobPath));
    await cleanupWorkspaceMemoryFiles({ config: { ...ctx.config } }, request);
    await absent(target.editPath);
  });

  it('retains thread-only startup report ownership after source removal and a failed metadata save', async () => {
    const target = await extraction();
    await write('startup.json', { format: 'native-memory-startup-v1', cursors: [], reports: [{ threadId: target.threadId, summary: sourceText }] });
    const rename = fs.rename.bind(fs); let fail = true;
    vi.spyOn(fs, 'rename').mockImplementation(async (oldName, newName) => {
      if (String(newName).endsWith('/startup.json') && fail) { fail = false; throw fsError(); }
      return rename(oldName, newName);
    });
    await expect(cleanupWorkspaceMemoryFiles(ctx, request)).rejects.toMatchObject({ code: 'MEMORY_WORKSPACE_CLEANUP_IO' });
    for (const relative of target.paths) await absent(relative);
    expect(await read('startup.json')).toContain(sourceText);
    await cleanupWorkspaceMemoryFiles({ config: { ...ctx.config } }, request);
    expect(JSON.parse(await read('startup.json'))).toEqual({ format: 'native-memory-startup-v1', cursors: [], reports: [] });
  });

  it('refuses an edit chain with no verified base, job reference or signed receipt', async () => {
    const target = await extraction(), other = await extraction(peer, retainedText);
    await fs.unlink(path.join(memoryRoot, target.recordPath)); await fs.unlink(path.join(memoryRoot, target.jobPath));
    const bytes = await read(target.editPath), peerBytes = await read(other.recordPath);
    await expect(cleanupWorkspaceMemoryFiles(ctx, request)).rejects.toMatchObject({ code: 'MEMORY_WORKSPACE_CLEANUP_INVALID' });
    expect(await read(target.editPath)).toBe(bytes); expect(await read(other.recordPath)).toBe(peerBytes);
    expect((await fs.readdir(memoryRoot)).filter(name => name.startsWith('workspace-cleanup-'))).toEqual([]);
  });

  it.each(['record-id', 'foreign-reference', 'artifact-reference'] as const)('preserves every source on conflicting %s ownership', async kind => {
    const target = await extraction(), other = await extraction(peer, retainedText);
    if (kind === 'record-id') await write(target.recordPath, { ...target.record, id: other.id });
    if (kind === 'foreign-reference') await write(target.jobPath, { ...target.job, memoryIds: [other.id], recordHashes: { [other.id]: hash(other.record) } });
    if (kind === 'artifact-reference') {
      const generated = await consolidation(target), retained = await consolidation(other);
      await write(generated.manifestPath, { ...generated.manifest, artifacts: [{ ...generated.manifest.artifacts[0], name: path.basename(retained.artifactPaths[0]) }] });
    }
    const targetBytes = await read(target.recordPath), peerBytes = await read(other.recordPath);
    await expect(cleanupWorkspaceMemoryFiles(ctx, request)).rejects.toMatchObject({ code: 'MEMORY_WORKSPACE_CLEANUP_INVALID' });
    expect(await read(target.recordPath)).toBe(targetBytes); expect(await read(target.editPath)).toContain(sourceText);
    expect(await read(other.recordPath)).toBe(peerBytes);
  });

  it('fails visibly on malformed JSON before removing valid target records', async () => {
    const target = await extraction();
    await fs.writeFile(path.join(memoryRoot, target.jobPath), '{incomplete source metadata');
    await expect(cleanupWorkspaceMemoryFiles(ctx, request)).rejects.toMatchObject({ code: 'MEMORY_WORKSPACE_CLEANUP_INVALID' });
    expect(await read(target.recordPath)).toContain(sourceText); expect(await read(target.editPath)).toContain(sourceText);
  });

  it.each(['', 'jobs/', 'consolidation-artifacts/'] as const)('retains unresolved MemoryFiles pending writes in %s and refuses to claim completion', async namespace => {
    const target = await extraction(), pending = `${namespace}.pending-${randomUUID()}.tmp`;
    await write(pending, namespace === ''
      ? { format: 'native-memory-startup-v1', cursors: [], reports: [{ workspaceId: workspace, summary: sourceText }] }
      : { ...target.job, summary: sourceText });
    const before = await read(pending);
    await expect(cleanupWorkspaceMemoryFiles(ctx, request)).rejects.toMatchObject({ code: 'MEMORY_WORKSPACE_CLEANUP_INVALID' });
    expect(await read(pending)).toBe(before); expect(await read(target.recordPath)).toContain(sourceText);
    expect(await read(target.editPath)).toContain(sourceText);
  });

  it('blocks a later peer purge when an earlier interrupted cleanup retained its reports in a projected startup temporary', async () => {
    const target = await extraction(), other = await extraction(peer, retainedText);
    await write('startup.json', { format: 'native-memory-startup-v1', cursors: [], reports: [
      { workspaceId: workspace, threadId: target.threadId, summary: sourceText },
      { workspaceId: peer, threadId: other.threadId, summary: retainedText },
    ] });
    const rename = fs.rename.bind(fs), unlink = fs.unlink.bind(fs);
    const failedRename = vi.spyOn(fs, 'rename').mockImplementation(async (oldName, newName) => {
      if (String(newName).endsWith('/startup.json')) throw fsError();
      return rename(oldName, newName);
    });
    const interruptedRemoval = vi.spyOn(fs, 'unlink').mockImplementation(async filename => {
      if (/\/\.memory-cleanup-[a-f0-9-]{36}\.tmp$/u.test(String(filename))) throw fsError();
      return unlink(filename);
    });
    await expect(cleanupWorkspaceMemoryFiles(ctx, request)).rejects.toMatchObject({ code: 'MEMORY_WORKSPACE_CLEANUP_IO' });
    failedRename.mockRestore(); interruptedRemoval.mockRestore();
    const pending = (await fs.readdir(memoryRoot)).filter(name => /^\.memory-cleanup-[a-f0-9-]{36}\.tmp$/u.test(name));
    expect(pending).toHaveLength(1);
    const retained = await read(pending[0]); expect(retained).toContain(retainedText); expect(retained).not.toContain(sourceText);
    const peerRequest = { ...request, workspaceId: peer, deletionId: randomUUID() };
    await expect(cleanupWorkspaceMemoryFiles({ config: { ...ctx.config } }, peerRequest)).rejects.toMatchObject({ code: 'MEMORY_WORKSPACE_CLEANUP_INVALID' });
    expect(await read(pending[0])).toBe(retained);
    expect(await read(other.recordPath)).toContain(retainedText); expect(await read(other.editPath)).toContain(retainedText);
  });

  it('rejects oversized files before allocation and leaves all source files untouched', async () => {
    const target = await extraction();
    await fs.truncate(path.join(memoryRoot, target.recordPath), WORKSPACE_MEMORY_CLEANUP_LIMITS.fileBytes + 1);
    await expect(cleanupWorkspaceMemoryFiles(ctx, request)).rejects.toMatchObject({ code: 'MEMORY_WORKSPACE_CLEANUP_LIMIT' });
    expect((await fs.stat(path.join(memoryRoot, target.recordPath))).size).toBe(WORKSPACE_MEMORY_CLEANUP_LIMITS.fileBytes + 1);
    expect(await read(target.editPath)).toContain(sourceText);
  });

  it.each(['leaf', 'ancestor', 'hardlink'] as const)('does not follow or remove an unsafe %s replacement', async kind => {
    const target = await extraction(), outside = path.join(directory, 'outside.json');
    await fs.writeFile(outside, JSON.stringify(target.record));
    if (kind === 'ancestor') {
      const moved = path.join(directory, 'foreign-records');
      await fs.rename(path.join(memoryRoot, 'records'), moved); await fs.symlink(moved, path.join(memoryRoot, 'records'));
    } else {
      await fs.unlink(path.join(memoryRoot, target.recordPath));
      if (kind === 'leaf') await fs.symlink(outside, path.join(memoryRoot, target.recordPath));
      else await fs.link(outside, path.join(memoryRoot, target.recordPath));
    }
    const before = await fs.readFile(outside, 'utf8');
    await expect(cleanupWorkspaceMemoryFiles(ctx, request)).rejects.toMatchObject({ code: 'MEMORY_WORKSPACE_CLEANUP_UNSAFE' });
    expect(await fs.readFile(outside, 'utf8')).toBe(before); expect(await read(target.editPath)).toContain(sourceText);
  });

  it('detects source bytes changed after manifest publication before deleting any planned source', async () => {
    const target = await extraction(), rename = fs.rename.bind(fs); let replaced = false;
    vi.spyOn(fs, 'rename').mockImplementation(async (oldName, newName) => {
      await rename(oldName, newName);
      if (!replaced && String(newName).includes('/workspace-cleanup-')) {
        replaced = true; await write(target.recordPath, { ...target.record, text: 'A later external edit must be preserved.' });
      }
    });
    await expect(cleanupWorkspaceMemoryFiles(ctx, request)).rejects.toMatchObject({ code: 'MEMORY_WORKSPACE_CLEANUP_CHANGED' });
    expect(await read(target.recordPath)).toContain('A later external edit must be preserved.');
    expect(await read(target.editPath)).toContain(sourceText); expect(await read(target.jobPath)).toContain(sourceText);
  });

  it('checks the current deletion generation again after an asynchronous earlier stage', async () => {
    const target = await extraction(), unlink = fs.unlink.bind(fs); let current = true;
    const guarded = { ...request, assertCurrent: async () => {
      if (!current) throw new HttpError(409, 'Fixture deletion was superseded.', 'WORKSPACE_ARTIFACT_CLEANUP_CHANGED');
    } };
    vi.spyOn(fs, 'unlink').mockImplementation(async filename => {
      await unlink(filename);
      if (String(filename).endsWith(`/${path.basename(target.editPath)}`)) current = false;
    });
    await expect(cleanupWorkspaceMemoryFiles(ctx, guarded)).rejects.toMatchObject({ code: 'WORKSPACE_ARTIFACT_CLEANUP_CHANGED' });
    await absent(target.editPath); expect(await read(target.recordPath)).toContain(sourceText); expect(await read(target.jobPath)).toContain(sourceText);
    current = true; await cleanupWorkspaceMemoryFiles({ config: { ...ctx.config } }, guarded);
    await absent(target.recordPath); await absent(target.jobPath);
  });

  it('binds orphan ownership receipts to the exact deletion and rejects tampered authority', async () => {
    const target = await extraction(), unlink = fs.unlink.bind(fs); let fail = true;
    vi.spyOn(fs, 'unlink').mockImplementation(async filename => {
      if (String(filename).endsWith(`/${path.basename(target.editPath)}`) && fail) { fail = false; throw fsError(); }
      return unlink(filename);
    });
    await expect(cleanupWorkspaceMemoryFiles(ctx, request)).rejects.toMatchObject({ code: 'MEMORY_WORKSPACE_CLEANUP_IO' });
    const filename = await receiptFile(), signed = JSON.parse(await read(filename));
    signed.value.deletedAt = '2026-09-19T12:00:00.000Z'; await write(filename, signed);
    await expect(cleanupWorkspaceMemoryFiles(ctx, request)).rejects.toMatchObject({ code: 'MEMORY_WORKSPACE_CLEANUP_INVALID' });
    expect(await read(target.editPath)).toContain(sourceText);
    await unlink(path.join(memoryRoot, target.recordPath)); await unlink(path.join(memoryRoot, target.jobPath));
    await expect(cleanupWorkspaceMemoryFiles(ctx, { ...request, deletionId: randomUUID() })).rejects.toMatchObject({ code: 'MEMORY_WORKSPACE_CLEANUP_INVALID' });
    expect(await read(target.editPath)).toContain(sourceText);
  });

  it('does not broaden an acknowledged deletion receipt to a later target generation', async () => {
    const target = await extraction(); await cleanupWorkspaceMemoryFiles(ctx, request);
    const later = await extraction(), before = await read(later.recordPath);
    await expect(cleanupWorkspaceMemoryFiles({ config: { ...ctx.config } }, request)).rejects.toMatchObject({ code: 'MEMORY_WORKSPACE_CLEANUP_CHANGED' });
    expect(await read(later.recordPath)).toBe(before); expect(await read(later.editPath)).toContain(sourceText);
    await absent(target.recordPath);
  });

  it('detects an independently owned artifact published during the removal pass and retains it for review', async () => {
    const target = await extraction(), unlink = fs.unlink.bind(fs), jobId = `mjob_${digest('late-generation')}`;
    const later = `consolidation-artifacts/${jobId}-0.json`; let written = false;
    vi.spyOn(fs, 'unlink').mockImplementation(async filename => {
      await unlink(filename);
      if (!written && String(filename).endsWith(`/${path.basename(target.jobPath)}`)) {
        written = true; await write(later, { format: 'native-memory-artifact-v1', jobId, workspaceId: workspace, path: 'MEMORY.md', content: 'Later separately written memory.' });
      }
    });
    await expect(cleanupWorkspaceMemoryFiles(ctx, request)).rejects.toMatchObject({ code: 'MEMORY_WORKSPACE_CLEANUP_CHANGED' });
    expect(await read(later)).toContain('Later separately written memory.');
    for (const relative of target.paths) await absent(relative);
  });

  it('preserves unowned descendants and refuses unknown entries in an owned revision directory', async () => {
    const target = await extraction();
    const descendant = `edits/${target.id}/manual/retain.json`; await write(descendant, { text: 'Unmanaged nested material.' });
    await expect(cleanupWorkspaceMemoryFiles(ctx, request)).rejects.toMatchObject({ code: 'MEMORY_WORKSPACE_CLEANUP_UNSAFE' });
    expect(await read(descendant)).toContain('Unmanaged nested material.'); expect(await read(target.recordPath)).toContain(sourceText);
  });
});
