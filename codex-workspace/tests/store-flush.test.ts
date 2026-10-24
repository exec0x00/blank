import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../server/store';

const directories: string[] = [];
const releases: Array<() => void> = [];
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

describe('storage shutdown barrier', () => {
  it('waits for other admitted writes before reporting a failed write', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-store-flush-'));
    directories.push(directory);
    const store = new JsonStore(directory);
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; releases.push(resolve); });
    const writing = new Promise<void>(resolve => { entered = resolve; });
    const rename = fs.rename.bind(fs);
    const failure = Object.assign(new Error('Synthetic storage failure.'), { code: 'EIO' });
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to) === path.join(directory, 'failed.json')) { await writing; throw failure; }
      if (String(to) === path.join(directory, 'retained.json')) { entered(); await blocked; }
      return rename(from, to);
    });
    const failed = store.write('failed', { value: 1 });
    const writes = Promise.allSettled([failed, store.write('retained', { value: 2 })]);
    let finished = false;
    const flushed = store.flush().then(() => { finished = true; }, error => { finished = true; return error; });
    try {
      await writing;
      // The first queue has failed while the second is paused at publication.
      await expect(failed).rejects.toBe(failure);
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(finished).toBe(false);
    } finally { release(); await writes; }
    expect(await flushed).toBeInstanceOf(Error);
    expect(await store.read('retained', null)).toEqual({ value: 2 });
  });
});
