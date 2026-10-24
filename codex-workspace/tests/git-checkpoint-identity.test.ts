import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CheckpointDirectory } from '../server/git-checkpoints/filesystem';
import { CheckpointRepositoryIdentity, type RegisteredRepositoryDirectories } from '../server/git-checkpoints/logical-identity';
import type { Workspace } from '../shared/types';

const roots: string[] = [];
const directories: CheckpointDirectory[] = [];
const services: CheckpointRepositoryIdentity[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const service of services.splice(0)) await service.close();
  for (const directory of directories.splice(0)) await directory.close();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

describe('checkpoint identity lifetime', () => {
  it('drains an acquired but unpublished native directory lease before repeated close calls finish', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-checkpoint-identity-')); roots.push(root);
    const workspacePath = path.join(root, 'workspace'); await fs.mkdir(path.join(workspacePath, '.git'), { recursive: true });
    const rootDirectory = await CheckpointDirectory.absolute(workspacePath); directories.push(rootDirectory);
    const gitDirectory = await CheckpointDirectory.absolute(path.join(workspacePath, '.git')); directories.push(gitDirectory);
    const commonDirectory = await CheckpointDirectory.absolute(path.join(workspacePath, '.git')); directories.push(commonDirectory);
    const now = new Date().toISOString();
    const workspace: Workspace = { id: 'fixture_workspace', name: 'Owned identity fixture', path: workspacePath, createdAt: now, updatedAt: now };
    const input: RegisteredRepositoryDirectories = { root: rootDirectory, git: gitDirectory, common: commonDirectory, workspace, repositoryWorkspace: workspace };
    const service = new CheckpointRepositoryIdentity({ stateDir: path.join(root, 'state'), encryptionKey: 'e'.repeat(64) }); services.push(service);
    let opened!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { opened = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const original = CheckpointDirectory.open;
    let leased: CheckpointDirectory | undefined;
    vi.spyOn(CheckpointDirectory, 'open').mockImplementation(async (absolute, access) => {
      const directory = await original(absolute, access);
      if (!leased && access?.endsWith('/.')) { leased = directory; opened(); await gate; }
      return directory;
    });
    const observation = service.observe(input, true).then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
    try {
      await entered;
      const closing = service.close();
      expect(service.close()).toBe(closing);
      let completed = false; void closing.then(() => { completed = true; });
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(completed).toBe(false);
      expect(leased!.handle.fd).toBeGreaterThanOrEqual(0);
      release();
      expect((await observation).error).toMatchObject({ code: 'CHECKPOINT_CLOSED' });
      await closing;
      expect(leased!.handle.fd).toBe(-1);
    } finally { release(); await observation; }
  });
});
