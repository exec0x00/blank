import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cleanAbandonedDownloadStaging, createDownloadStaging, stagingScope } from '../server/downloads/staging';

const created: string[] = [];
afterEach(async () => { await Promise.all(created.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))); });

describe('abandoned download staging cleanup', () => {
  it('removes only a dead process staging directory belonging to the same workspace service', async () => {
    const stateDir = path.join(os.tmpdir(), `download-state-${process.pid}-${Math.random()}`);
    const live = await createDownloadStaging(stateDir); created.push(live);
    const foreign = await createDownloadStaging(`${stateDir}-different`); created.push(foreign);
    const dead = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-download-')); created.push(dead);
    await fs.writeFile(path.join(dead, '.download-owner.json'), JSON.stringify({ kind: 'codex-file-download-staging-v1', scope: stagingScope(stateDir), id: 'test-owner', pid: 2147483647, processStart: '1' }));
    await fs.writeFile(path.join(dead, 'large.snapshot'), 'ordinary unencrypted bytes');
    const unmanaged = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-download-')); created.push(unmanaged);
    await fs.writeFile(path.join(unmanaged, 'keep.txt'), 'unmanaged');
    await cleanAbandonedDownloadStaging(stateDir);
    await expect(fs.stat(dead)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.stat(live)).isDirectory()).toBe(true);
    expect((await fs.stat(foreign)).isDirectory()).toBe(true);
    expect(await fs.readFile(path.join(unmanaged, 'keep.txt'), 'utf8')).toBe('unmanaged');
  });

  it('does not follow symlinked staging roots or owner records', async () => {
    const stateDir = path.join(os.tmpdir(), `download-state-${process.pid}-${Math.random()}`);
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'download-outside-')); created.push(outside);
    await fs.writeFile(path.join(outside, 'keep.txt'), 'outside files remain');
    const linked = `${await fs.mkdtemp(path.join(os.tmpdir(), 'codex-download-'))}`; created.push(linked);
    await fs.rmdir(linked); await fs.symlink(outside, linked);
    const ownerLink = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-download-')); created.push(ownerLink);
    await fs.writeFile(path.join(outside, 'owner.json'), JSON.stringify({ kind: 'codex-file-download-staging-v1', scope: stagingScope(stateDir), pid: 2147483647, processStart: '1' }));
    await fs.symlink(path.join(outside, 'owner.json'), path.join(ownerLink, '.download-owner.json'));
    await cleanAbandonedDownloadStaging(stateDir);
    expect((await fs.lstat(linked)).isSymbolicLink()).toBe(true);
    expect((await fs.stat(ownerLink)).isDirectory()).toBe(true);
    expect(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8')).toBe('outside files remain');
  });
});
