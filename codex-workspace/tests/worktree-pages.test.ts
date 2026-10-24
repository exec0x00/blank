import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { AppContext } from '../server/context';
import type { AppSettings, CreatedWorktree, Workspace } from '../shared/types';
import { SecretStore } from '../server/store';
import { GitService } from '../server/git';
import * as gitModule from '../server/git';
import { WorktreeService } from '../server/worktrees';
import { acquireWorkspaceActivity } from '../server/worktrees/activity';
import { readWorktreeRecord, writeWorktreeRecord } from '../server/worktrees/records';
import { fixture, type TrashFixture } from './workspace-trash-fixture';

let f: TrashFixture;
let ctx: AppContext;
let service: WorktreeService;
let source: Workspace;
let git: GitService;

beforeEach(async () => {
  f = await fixture();
  const settings: AppSettings = { model: 'test', reasoningEffort: 'max', autoApprove: false, theme: 'dark', fontSize: 13, wordWrap: true, provider: 'openai', apiKeyConfigured: false };
  ctx = { config: f.config, store: f.store, secrets: new SecretStore(f.store, f.config.encryptionKey), events: new EventEmitter(),
    workspaces: f.service, settings: async () => settings, saveSettings: async patch => Object.assign(settings, patch), providerKey: async () => undefined };
  source = await f.service.create({ name: 'Paged repository', initializeGit: true });
  await f.service.writeFile(source.id, 'keep.txt', 'committed native contents\n');
  git = new GitService(ctx);
  await git.stage(source.id, ['keep.txt']); await git.commit(source.id, 'Baseline for worktree paging');
  service = new WorktreeService(ctx);
});
afterEach(async () => { await service?.close(); vi.restoreAllMocks(); await f?.close(); });

async function checkouts(count: number): Promise<CreatedWorktree[]> {
  const result: CreatedWorktree[] = [];
  for (let index = 0; index < count; index++) result.push(await service.create(source.id, { name: `Checkout ${index}`, branch: `paging/checkout-${index}`, createBranch: true }));
  return result;
}

describe('native managed worktree pages', () => {
  it('checks Git dirty/ignored status only for requested records and searches live names and branches beyond page one', async () => {
    const saved = await checkouts(3);
    const observe = vi.spyOn(gitModule, 'runGit');
    const first = await service.listPage(source.id, { limit: 1 });
    expect(first).toMatchObject({ offset: 0, limit: 1, total: 3, hasMore: true, repository: { id: source.id } });
    expect(first.items.map(item => item.id)).toEqual([saved[0].worktree.id]);
    expect(observe.mock.calls.filter(([, args]) => args.includes('status')).map(([cwd]) => cwd)).toEqual([saved[0].workspace.path]);
    expect(observe.mock.calls.filter(([, args]) => args.includes('--ignored')).map(([cwd]) => cwd)).toEqual([saved[0].workspace.path]);
    observe.mockClear();
    const next = await service.listPage(source.id, { offset: 1, limit: 1 });
    expect(next.items.map(item => item.id)).toEqual([saved[1].worktree.id]);
    expect(observe.mock.calls.filter(([, args]) => args.includes('status')).map(([cwd]) => cwd)).toEqual([saved[1].workspace.path]);
    await f.service.update(saved[2].workspace.id, { name: 'Renamed distant checkout' });
    observe.mockClear();
    const search = await service.listPage(source.id, { q: 'renamed distant', limit: 1 });
    expect(search).toMatchObject({ offset: 0, total: 1, hasMore: false });
    expect(search.items[0]).toMatchObject({ id: saved[2].worktree.id, name: 'Renamed distant checkout' });
    expect(observe.mock.calls.filter(([, args]) => args.includes('status')).map(([cwd]) => cwd)).toEqual([saved[2].workspace.path]);
    expect((await service.listPage(source.id, { q: 'paging/checkout-2' })).items[0].id).toBe(saved[2].worktree.id);
  }, 60_000);

  it('supplies the exact off-page creation source and retained primary without needing a global workspace list', async () => {
    const saved = await checkouts(3), selected = saved[2].workspace;
    await f.service.writeFile(selected.id, 'keep.txt', 'a later commit in the chosen linked checkout\n');
    await git.stage(selected.id, ['keep.txt']); const commit = await git.commit(selected.id, 'Only this selected checkout advances');
    const page = await service.listPage(source.id, { limit: 1, sourceWorkspaceId: selected.id });
    expect(page.items.some(item => item.workspaceId === selected.id)).toBe(false);
    expect(page.repository).toMatchObject({ id: source.id, path: source.path });
    expect(page.sources).toHaveLength(2);
    const exact = page.sources.find(workspace => workspace.id === selected.id)!;
    expect(exact).toMatchObject({ id: selected.id, worktree: { repositoryWorkspaceId: source.id } });
    const created = await service.create(exact.id, { name: 'Created from off-page source', branch: 'paging/from-off-page', createBranch: true });
    expect(created.worktree.head).toBe(commit.commit);
    expect(await fs.readFile(path.join(created.workspace.path, 'keep.txt'), 'utf8')).toBe('a later commit in the chosen linked checkout\n');
    expect(await fs.readFile(path.join(source.path, 'keep.txt'), 'utf8')).toBe('committed native contents\n');
    const other = await f.service.create({ name: 'Unrelated active workspace' });
    expect((await service.listPage(source.id, { limit: 1, sourceWorkspaceId: other.id })).sources.some(workspace => workspace.id === other.id)).toBe(false);
  }, 60_000);

  it('keeps interrupted removals observational and never weakens live activity or strict malformed-record checks', async () => {
    const [saved] = await checkouts(1);
    const record = (await readWorktreeRecord(ctx, saved.worktree.id))!;
    await writeWorktreeRecord(ctx, { ...record, phase: 'removing', issue: 'Interrupted removal kept the native files.' });
    const observe = vi.spyOn(gitModule, 'runGit');
    const page = await service.listPage(source.id);
    expect(page.items[0]).toMatchObject({ id: saved.worktree.id, state: 'recovery' });
    expect(observe.mock.calls.some(([, args]) => args.includes('remove'))).toBe(false);
    expect(await readWorktreeRecord(ctx, saved.worktree.id)).toMatchObject({ phase: 'removing' });
    expect(await fs.readFile(path.join(saved.workspace.path, 'keep.txt'), 'utf8')).toBe('committed native contents\n');
    await writeWorktreeRecord(ctx, record);
    const release = acquireWorkspaceActivity(f.config.workspacesDir, saved.workspace.id, 'terminal');
    try {
      expect((await service.listPage(source.id)).items[0].dirty).toBe(false);
      await expect(service.remove(source.id, saved.worktree.id)).rejects.toMatchObject({ code: 'WORKTREE_BUSY' });
    } finally { release(); }
    expect(await fs.readFile(path.join(saved.workspace.path, 'keep.txt'), 'utf8')).toBe('committed native contents\n');
    await expect(service.listPage(source.id, { limit: 51 })).rejects.toMatchObject({ status: 400, code: 'INVALID_OPERATIONAL_PAGE' });
    const malformed = randomUUID();
    await fs.writeFile(path.join(f.config.stateDir, `managed-worktree-${malformed}.json`), JSON.stringify({ version: 1, id: malformed }));
    await expect(service.listPage(source.id, { q: 'does not match' })).rejects.toMatchObject({ code: 'UNSAFE_WORKTREE' });
    expect(await fs.readFile(path.join(saved.workspace.path, 'keep.txt'), 'utf8')).toBe('committed native contents\n');
  }, 60_000);

  it('omits a genuinely missing selected source without hiding the remaining repository page', async () => {
    const [retained, missing] = await checkouts(2);
    await fs.rm(missing.workspace.path, { recursive: true });
    const page = await service.listPage(source.id, { sourceWorkspaceId: missing.workspace.id, limit: 1 });
    expect(page).toMatchObject({ total: 2, repository: { id: source.id } });
    expect(page.items[0]).toMatchObject({ id: retained.worktree.id, state: 'ready' });
    expect(page.sources.some(workspace => workspace.id === missing.workspace.id)).toBe(false);
    expect(page.sources.some(workspace => workspace.id === source.id)).toBe(true);
    expect(await fs.readFile(path.join(retained.workspace.path, 'keep.txt'), 'utf8')).toBe('committed native contents\n');
    expect(await readWorktreeRecord(ctx, missing.worktree.id)).toMatchObject({ id: missing.worktree.id });
  }, 60_000);
});
