import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fixture, type TrashFixture } from './workspace-trash-fixture';
import { readWorkspaceTrashMetadataExclusions } from '../server/workspace-trash/records';

// Exercise the actual filesystem/history protocol at its boundary without
// writing 10,000 fixture journals just to lower the next available slot to one.
vi.mock('../server/workspace-trash/filesystem', async importOriginal => ({
  ...await importOriginal<typeof import('../server/workspace-trash/filesystem')>(),
  MAX_TRASH_ENTRIES: 2,
}));

describe('bounded concurrent trash history', () => {
  let f: TrashFixture;
  beforeEach(async () => { f = await fixture(); });
  afterEach(async () => { vi.restoreAllMocks(); await f?.close(); });

  it('admits only one of two competing workspace deletions into the last history slot', async () => {
    await f.service.writeFile(f.workspace.id, 'retained.txt', 'first trash entry');
    await f.trash();
    const left = await f.service.create({ name: 'Left capacity contender' });
    const right = await f.service.create({ name: 'Right capacity contender' });
    await f.service.writeFile(left.id, 'keep.txt', 'left actual bytes');
    await f.service.writeFile(right.id, 'keep.txt', 'right actual bytes');
    const other = await f.restart();
    const results = await Promise.allSettled([
      f.service.trashWorkspace(left.id, { expectedMode: 'trash' }),
      other.trashWorkspace(right.id, { expectedMode: 'trash' }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(failure.reason).toMatchObject({ code: 'WORKSPACE_TRASH_LIMIT' });
    const retained = results[0].status === 'rejected' ? left : right;
    expect(await fs.readFile(path.join(retained.path, 'keep.txt'), 'utf8')).toBe(retained.id === left.id ? 'left actual bytes' : 'right actual bytes');
    const records = (await fs.readdir(f.config.stateDir)).filter(name => name.startsWith('workspace-trash-record-'));
    expect(records).toHaveLength(2);
    const restarted = await f.restart();
    expect((await restarted.list()).some(item => item.id === retained.id)).toBe(true);
    expect((await restarted.listWorkspaceTrash()).length).toBe(2);
  });

  it('does not exceed the per-file reader cap when two startup sweeps use stale initial history lists', async () => {
    const peer = await f.service.create({ name: 'Second per-file trash owner' });
    const entries = [];
    for (const [workspace, name] of [[f.workspace, 'first.txt'], [f.workspace, 'second.txt'], [peer, 'third.txt']] as const) {
      await f.service.writeFile(workspace.id, name, name);
      entries.push(await f.service.trashEntry(workspace.id, name));
    }
    vi.spyOn(Date, 'now').mockReturnValue(Math.max(...entries.map(entry => Date.parse(entry.expiresAt))) + 1);
    await Promise.all([f.restart(), f.restart()]);
    const records = (await fs.readdir(f.config.stateDir)).filter(name => name.startsWith('file-trash-expiry-'));
    expect(records).toHaveLength(2);
    const retained = (await Promise.all([f.workspace, peer].map(workspace => fs.readdir(path.join(f.config.workspacesDir, '.trash', workspace.id))))).flat();
    expect(retained).toHaveLength(1);
    expect((await Promise.all([f.workspace, peer].map(workspace => f.service.fileTrashStatus(workspace.id)))).some(status => status.issue?.includes('retained'))).toBe(true);
    expect(await readWorkspaceTrashMetadataExclusions(f.config)).toHaveLength(2);
    const restarted = await f.restart();
    expect((await restarted.list()).some(item => item.id === f.workspace.id)).toBe(true);
    expect((await restarted.listTrash(f.workspace.id)).length + (await restarted.listTrash(peer.id)).length).toBe(1);
  });
});
