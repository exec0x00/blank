import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assessHostAdmission, formatHostResources, HOST_MEMORY_CEILING_BYTES, HOST_MEMORY_RESERVE_BYTES, observeHostResources } from '../server/host-resources';

const GB = 1_000_000_000;
const clock = Date.UTC(2026, 8, 20, 12);
let root: string;
let proc: string;
let cgroup: string;
let config: { dataDir: string; runtimeDir: string };

async function file(name: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(name), { recursive: true });
  await fs.writeFile(name, content);
}

function escaped(value: string): string { return value.replaceAll('\\', '\\134').replaceAll(' ', '\\040'); }

async function scope(relative = '', options: { current?: string; maximum?: string; high?: string; stat?: string } = {}): Promise<void> {
  const directory = path.join(cgroup, relative);
  await Promise.all([
    file(path.join(directory, 'memory.current'), options.current ?? String(4 * GB)),
    file(path.join(directory, 'memory.max'), options.maximum ?? String(104 * GB)),
    file(path.join(directory, 'memory.high'), options.high ?? 'max'),
    file(path.join(directory, 'memory.swap.current'), '0'),
    file(path.join(directory, 'memory.stat'), options.stat ?? 'anon 1000000000\nfile 2500000000\nshmem 500000000\nkernel 500000000\ninactive_file 1200000000\n'),
  ]);
}

async function snapshot() {
  return observeHostResources(config, { procRoot: proc, now: () => new Date(clock) });
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-host-resources-'));
  proc = path.join(root, 'proc');
  cgroup = path.join(root, 'cgroup');
  config = { dataDir: path.join(root, 'durable files'), runtimeDir: path.join(root, 'runtime') };
  await Promise.all([fs.mkdir(config.dataDir), fs.mkdir(config.runtimeDir)]);
  await Promise.all([
    file(path.join(proc, 'self/mountinfo'), [
      '20 1 0:1 / / rw - overlay overlay rw',
      `21 20 0:2 / ${escaped(cgroup)} ro - cgroup2 cgroup rw`,
      `22 20 0:3 / ${escaped(config.dataDir)} rw - fuse hf-mount rw`,
    ].join('\n')),
    file(path.join(proc, 'self/cgroup'), '0::/\n'),
    file(path.join(proc, 'meminfo'), 'MemTotal:       2097112360 kB\nMemAvailable:   984565012 kB\n'),
    scope(),
  ]);
});

afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('bounded, cgroup-aware host observations', () => {
  it('distinguishes the cgroup limit, decimal 90 GB policy ceiling, and shared host RAM', async () => {
    const result = await snapshot();
    expect(result.memory).toMatchObject({
      status: 'available', source: 'cgroup-v2', currentBytes: 4 * GB, limitBytes: 104 * GB,
      policyCeilingBytes: 90 * GB, effectiveCeilingBytes: 90 * GB, headroomBytes: 86 * GB,
      hostTotalBytes: 2_097_112_360 * 1024,
    });
    expect(HOST_MEMORY_CEILING_BYTES).toBe(90_000_000_000);
    expect(HOST_MEMORY_RESERVE_BYTES).toBe(2_000_000_000);
    expect(result.memory.breakdown).toEqual({ anonymousBytes: GB, fileBytes: 2.5 * GB, sharedMemoryBytes: 0.5 * GB, kernelBytes: 0.5 * GB, inactiveFileBytes: 1.2 * GB });
    expect(result.filesystems).toEqual([
      expect.objectContaining({ purpose: 'durable', path: config.dataDir, fileSystem: 'fuse', mountPoint: config.dataDir, memoryBacked: null }),
      expect.objectContaining({ purpose: 'runtime', fileSystem: 'overlay', mountPoint: '/', memoryBacked: null }),
      expect.objectContaining({ purpose: 'temporary', path: '/tmp', fileSystem: 'overlay', memoryBacked: null }),
    ]);
    const prompt = formatHostResources(result);
    expect(prompt).toContain('2026-09-20T12:00:00.000Z');
    expect(prompt).toContain('90,000,000,000 decimal bytes');
    expect(prompt).toContain('never 90%');
    expect(prompt).toContain('already included in file cache');
    expect(prompt).toContain('not this instance\'s memory allowance');
    expect(prompt).toContain('not established by this snapshot');
    expect(prompt).not.toContain('lowerdir=');
  });

  it('clamps the operation ceiling to a lower real cgroup limit', async () => {
    await scope('', { maximum: String(64 * GB), current: String(63 * GB) });
    const result = await snapshot();
    expect(result.memory.effectiveCeilingBytes).toBe(64 * GB);
    expect(result.memory.headroomBytes).toBe(GB);
    expect(assessHostAdmission(result, { now: clock })).toMatchObject({ allowed: false, status: 'refused', ceilingBytes: 64 * GB });
    expect(result.warnings.join(' ')).toContain('2 GB reserve');
  });

  it('uses host available memory only as additional pressure, never as an instance-limit fallback', async () => {
    await file(path.join(proc, 'meminfo'), 'MemTotal: 32000000 kB\nMemAvailable: 1000000 kB\n');
    const result = await snapshot();
    expect(result.memory.limitBytes).toBe(104 * GB);
    expect(result.memory.effectiveCeilingBytes).toBe(90 * GB);
    expect(result.memory.headroomBytes).toBe(1_024_000_000);
    expect(assessHostAdmission(result, { now: clock }).allowed).toBe(false);
  });

  it('accounts for memory already charged to siblings in visible constrained ancestors', async () => {
    await file(path.join(proc, 'self/cgroup'), '0::/group/leaf\n');
    await scope('', { current: String(80 * GB), maximum: 'max' });
    await scope('group', { current: String(62.5 * GB), maximum: String(64 * GB) });
    await scope('group/leaf');
    const result = await snapshot();
    expect(result.memory.scopes).toHaveLength(3);
    expect(result.memory.currentBytes).toBe(4 * GB);
    expect(result.memory.effectiveCeilingBytes).toBe(64 * GB);
    expect(result.memory.headroomBytes).toBe(1.5 * GB);
    expect(assessHostAdmission(result, { now: clock }).status).toBe('refused');
  });

  it('resolves an exposed cgroup mount root without walking outside the visible hierarchy', async () => {
    await file(path.join(proc, 'self/cgroup'), '0::/tenant/leaf\n');
    await file(path.join(proc, 'self/mountinfo'), `20 1 0:1 / / rw - overlay overlay rw\n21 20 0:2 /tenant ${escaped(cgroup)} ro - cgroup2 cgroup rw\n`);
    await scope('leaf', { current: String(3 * GB) });
    const result = await snapshot();
    expect(result.memory.scopes.map(item => item.directory)).toEqual([path.join(cgroup, 'leaf'), cgroup]);
    expect(result.memory.currentBytes).toBe(3 * GB);
    expect(result.memory.status).toBe('available');
  });

  it('handles the actual hierarchy root whose non-root-only memory controls do not exist', async () => {
    await file(path.join(proc, 'self/cgroup'), '0::/leaf\n');
    await scope('leaf');
    await Promise.all(['memory.current', 'memory.max', 'memory.high'].map(name => fs.unlink(path.join(cgroup, name))));
    const result = await snapshot();
    expect(result.memory.status).toBe('available');
    expect(result.memory.scopes).toHaveLength(1);
    expect(result.memory.limitBytes).toBe(104 * GB);
    expect(result.memory.headroomBytes).toBe(86 * GB);
  });

  it('keeps memory.high distinct from the hard limit while reserving headroom below it', async () => {
    await scope('', { high: String(5 * GB) });
    const result = await snapshot();
    expect(result.memory.limitBytes).toBe(104 * GB);
    expect(result.memory.effectiveCeilingBytes).toBe(90 * GB);
    expect(result.memory.headroomBytes).toBe(GB);
    expect(result.memory.scopes[0].highBytes).toBe(5 * GB);
  });

  it('reports a real tmpfs mount separately from an overlay whose physical backing is unknown', async () => {
    await fs.appendFile(path.join(proc, 'self/mountinfo'), `\n23 20 0:4 / ${escaped(config.runtimeDir)} rw - tmpfs tmpfs rw,size=1000000k\n`);
    const result = await snapshot();
    expect(result.filesystems.find(item => item.purpose === 'runtime')).toMatchObject({ fileSystem: 'tmpfs', memoryBacked: true });
    expect(result.filesystems.find(item => item.purpose === 'temporary')).toMatchObject({ fileSystem: 'overlay', memoryBacked: null });
    expect(formatHostResources(result)).toContain('This is directly RAM-backed');
  });

  it('reads old v1 memory accounting and its unlimited sentinel without losing numeric precision', async () => {
    await file(path.join(proc, 'self/mountinfo'), `20 1 0:1 / / rw - overlay overlay rw\n21 20 0:2 / ${escaped(cgroup)} ro - cgroup cgroup rw,memory\n`);
    await file(path.join(proc, 'self/cgroup'), '7:memory:/\n');
    await Promise.all([
      file(path.join(cgroup, 'memory.usage_in_bytes'), String(6 * GB)),
      file(path.join(cgroup, 'memory.limit_in_bytes'), '9223372036854771712\n'),
      file(path.join(cgroup, 'memory.stat'), 'total_rss 2000000000\ntotal_cache 4000000000\ntotal_shmem 1000000000\ntotal_inactive_file 2500000000\n'),
    ]);
    const result = await snapshot();
    expect(result.memory).toMatchObject({ status: 'available', source: 'cgroup-v1', currentBytes: 6 * GB, limitBytes: null, limitKind: 'unlimited', effectiveCeilingBytes: 90 * GB, headroomBytes: 84 * GB });
    expect(result.memory.breakdown).toMatchObject({ anonymousBytes: 2 * GB, fileBytes: 4 * GB, sharedMemoryBytes: GB, kernelBytes: null });
  });

  it('uses the v1 memory controller on hybrid hosts with an unrelated cgroup2 hierarchy', async () => {
    const legacy = path.join(root, 'legacy-memory');
    await fs.appendFile(path.join(proc, 'self/mountinfo'), `\n24 20 0:5 / ${escaped(legacy)} ro - cgroup cgroup rw,memory\n`);
    await file(path.join(proc, 'self/cgroup'), '0::/\n7:memory:/\n');
    await fs.unlink(path.join(cgroup, 'memory.current'));
    await Promise.all([
      file(path.join(legacy, 'memory.usage_in_bytes'), String(3 * GB)),
      file(path.join(legacy, 'memory.limit_in_bytes'), String(32 * GB)),
    ]);
    const result = await snapshot();
    expect(result.memory).toMatchObject({ source: 'cgroup-v1', status: 'available', currentBytes: 3 * GB, limitBytes: 32 * GB, effectiveCeilingBytes: 32 * GB });
  });

  it.each(['-1', 'NaN', '9007199254740993', '1e10', '12 bytes', ''])('does not substitute host RAM for invalid cgroup usage %j', async current => {
    await scope('', { current });
    const result = await snapshot();
    expect(result.memory.status).toBe('unavailable');
    expect(result.memory.currentBytes).toBeNull();
    expect(result.memory.headroomBytes).toBeNull();
    expect(assessHostAdmission(result, { now: clock })).toMatchObject({ status: 'unavailable', allowed: false });
  });

  it('fails admission honestly when a hard limit is unreadable, while retaining the observed usage', async () => {
    await fs.unlink(path.join(cgroup, 'memory.max'));
    const result = await snapshot();
    expect(result.memory).toMatchObject({ status: 'partial', currentBytes: 4 * GB, limitKind: 'unknown', headroomBytes: null });
    expect(assessHostAdmission(result, { now: clock }).status).toBe('unavailable');
  });

  it('bounds kernel text and refuses symlinked control-file inputs', async () => {
    const source = path.join(root, 'not-a-control-file');
    await fs.writeFile(source, String(GB));
    await fs.unlink(path.join(cgroup, 'memory.current'));
    await fs.symlink(source, path.join(cgroup, 'memory.current'));
    expect((await snapshot()).memory.currentBytes).toBeNull();
    await file(path.join(proc, 'self/mountinfo'), 'x'.repeat(512 * 1024 + 1));
    const result = await snapshot();
    expect(result.memory.source).toBeNull();
    expect(result.filesystems.every(item => item.fileSystem === null)).toBe(true);
    expect(result.warnings.join(' ')).toContain('bounded read limit');
  });

  it('does not subtract reclaimable-looking file cache from charged usage at the ceiling', async () => {
    await scope('', { current: String(91 * GB), stat: 'anon 1000000000\nfile 89000000000\ninactive_file 88000000000\nshmem 0\n' });
    const result = await snapshot();
    expect(result.memory.headroomBytes).toBe(0);
    expect(result.warnings.join(' ')).toContain('exceeded the effective operation ceiling');
    expect(assessHostAdmission(result, { now: clock }).status).toBe('refused');
  });
});

describe('early admission without process ownership side effects', () => {
  it('admits work only with an estimate plus reserve below all observed limits', async () => {
    await scope('', { current: String(85 * GB) });
    const result = await snapshot();
    expect(assessHostAdmission(result, { now: clock, estimatedAdditionalBytes: 2 * GB })).toMatchObject({ allowed: true, requiredBytes: 4 * GB, headroomBytes: 5 * GB });
    expect(assessHostAdmission(result, { now: clock, estimatedAdditionalBytes: 3 * GB })).toMatchObject({ allowed: false, status: 'refused', requiredBytes: 5 * GB });
  });

  it('requires a fresh observation and rejects invalid or insufficient reserves', async () => {
    const result = await snapshot();
    expect(assessHostAdmission(result, { now: clock + 15_001 })).toMatchObject({ allowed: false, status: 'unavailable' });
    expect(assessHostAdmission(result, { now: clock - 1001 })).toMatchObject({ allowed: false, status: 'unavailable' });
    expect(() => assessHostAdmission(result, { estimatedAdditionalBytes: -1 })).toThrow(RangeError);
    expect(() => assessHostAdmission(result, { estimatedAdditionalBytes: Infinity })).toThrow(RangeError);
    expect(() => assessHostAdmission(result, { reserveBytes: GB })).toThrow(RangeError);
  });
});
