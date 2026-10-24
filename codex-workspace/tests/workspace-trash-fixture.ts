import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig } from '../server/config';
import { JsonStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import type { Workspace } from '../shared/types';
import type { WorkspaceTrashEntry, WorkspaceTrashRecord } from '../server/workspace-trash/types';
import { listTrashRecords } from '../server/workspace-trash/records';

export const git = promisify(execFile);
export async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-workspace-trash-'));
  const config = loadConfig({ DATA_DIR: directory, WORKSPACE_PASSWORD: 'fixture-only-password', SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'k'.repeat(64) });
  const store = new JsonStore(config.stateDir);
  const service = new WorkspaceService(config, store);
  const services = [service];
  await service.initialize();
  const workspace = await service.create({ name: 'Retained project' });
  return {
    directory, config, store, service, workspace,
    async restart() {
      const restarted = new WorkspaceService(config, new JsonStore(config.stateDir));
      services.push(restarted);
      await restarted.initialize();
      return restarted;
    },
    async trash(item: Workspace = workspace): Promise<WorkspaceTrashEntry> {
      const deleted = await service.trashWorkspace(item.id, { expectedMode: 'trash' });
      if (deleted.mode !== 'trash') throw new Error('Expected ordinary workspace trash.');
      return deleted.trash;
    },
    entryPath(id: string) { return path.join(config.workspacesDir, '.workspace-trash', id); },
    async record(id: string): Promise<WorkspaceTrashRecord> {
      const record = (await listTrashRecords(config)).find(record => record.id === id);
      if (!record) throw new Error('Expected a durable workspace trash record.');
      return record;
    },
    async githubRemote(item?: Workspace) {
      const repository = item ?? await service.create({ name: 'GitHub checkout', initializeGit: true });
      await git('git', ['-C', repository.path, 'remote', 'add', 'origin', 'https://github.com/example/fixture.git']);
      return repository;
    },
    async close() {
      for (const service of services) { await service.closeFileTrashPages(); await service.closeTrashCleanup(); }
      await fs.rm(directory, { recursive: true, force: true });
    },
  };
}

export type TrashFixture = Awaited<ReturnType<typeof fixture>>;
export function fsError(code: string): NodeJS.ErrnoException { return Object.assign(new Error('Injected filesystem failure.'), { code }); }
