import { constants } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from './config';

/** Decimal bytes, deliberately not a percentage or 90 GiB. */
export const HOST_MEMORY_CEILING_BYTES = 90_000_000_000;
export const HOST_MEMORY_RESERVE_BYTES = 2_000_000_000;
const MAX_MOUNTINFO_BYTES = 512 * 1024;
const MAX_CONTROL_BYTES = 64 * 1024;
const MAX_CGROUP_DEPTH = 32;
const MAX_MOUNTS = 4096;
const MAX_SNAPSHOT_AGE_MS = 15_000;
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

type LimitKind = 'limited' | 'unlimited' | 'unknown';
export interface HostMemoryScope {
  directory: string;
  currentBytes: number | null;
  limitBytes: number | null;
  limitKind: LimitKind;
  highBytes: number | null;
}

export interface HostResourceSnapshot {
  observedAt: string;
  memory: {
    status: 'available' | 'partial' | 'unavailable';
    source: 'cgroup-v2' | 'cgroup-v1' | null;
    currentBytes: number | null;
    /** Lowest visible applicable cgroup hard limit, not host MemTotal. */
    limitBytes: number | null;
    limitKind: LimitKind;
    policyCeilingBytes: number;
    /** Policy ceiling clamped to visible cgroup hard limits, never host MemTotal. */
    effectiveCeilingBytes: number;
    /** Before the admission reserve; includes visible ancestor/host pressure. */
    headroomBytes: number | null;
    defaultReserveBytes: number;
    hostTotalBytes: number | null;
    hostAvailableBytes: number | null;
    breakdown: {
      anonymousBytes: number | null;
      fileBytes: number | null;
      /** A subset of fileBytes; these two values must never be added together. */
      sharedMemoryBytes: number | null;
      kernelBytes: number | null;
      inactiveFileBytes: number | null;
    } | null;
    swapCurrentBytes: number | null;
    scopes: HostMemoryScope[];
  };
  filesystems: Array<{
    purpose: 'durable' | 'runtime' | 'temporary';
    path: string;
    resolvedPath: string | null;
    mountPoint: string | null;
    fileSystem: string | null;
    /** true for tmpfs/ramfs; null when mountinfo cannot establish the medium. */
    memoryBacked: boolean | null;
  }>;
  warnings: string[];
}

export interface HostAdmission {
  allowed: boolean;
  status: 'allowed' | 'refused' | 'unavailable';
  reason: string;
  ceilingBytes: number;
  headroomBytes: number | null;
  requiredBytes: number;
}

interface MountEntry {
  root: string;
  directory: string;
  fileSystem: string;
  controllers: string[];
}

interface ObservationOptions {
  /** Injectable proc tree for filesystem fixtures; never sourced from a request. */
  procRoot?: string;
  now?: () => Date;
}

const within = (root: string, target: string): boolean => target === root || target.startsWith(root === '/' ? '/' : `${root}/`);
const cleanAbsolute = (value: string): boolean => value.length > 0 && value.length <= 4096 && path.posix.isAbsolute(value)
  && path.posix.normalize(value) === value && !/[\u0000-\u001f\u007f]/.test(value);
const decodeMountPath = (value: string): string => value.replace(/\\(040|011|012|134)/g, (_all, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)));

/** Proc/cgroup files commonly report size zero. Bound actual reads, not stat.size. */
async function readBounded(filename: string, maximum: number): Promise<string | null> {
  let handle: FileHandle | undefined;
  try {
    handle = await fs.open(filename, READ_FLAGS);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximum) return null;
    const data = Buffer.alloc(maximum + 1);
    let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await handle.read(data, offset, data.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > maximum) return null;
    return new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, offset));
  } catch { return null; }
  finally { await handle?.close().catch(() => undefined); }
}

function nonnegativeInteger(value: string | undefined | null): number | null {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d{1,20}$/.test(trimmed)) return null;
  const number = Number(trimmed);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function memoryLimit(value: string | null, version: 1 | 2): { bytes: number | null; kind: LimitKind } {
  const trimmed = value?.trim();
  if (version === 2 && trimmed === 'max') return { bytes: null, kind: 'unlimited' };
  // v1 uses a page-aligned LONG_MAX sentinel instead of the v2 word "max".
  if (version === 1 && trimmed && /^\d{1,20}$/.test(trimmed) && BigInt(trimmed) >= (1n << 60n)) return { bytes: null, kind: 'unlimited' };
  const bytes = nonnegativeInteger(trimmed);
  return bytes === null ? { bytes: null, kind: 'unknown' } : { bytes, kind: 'limited' };
}

function numericFields(source: string | null): Map<string, number> {
  const fields = new Map<string, number>();
  if (source === null) return fields;
  for (const line of source.split('\n')) {
    const match = /^([a-z_]+)\s+(\d{1,20})\s*$/.exec(line);
    const value = nonnegativeInteger(match?.[2]);
    if (match && value !== null) fields.set(match[1], value);
  }
  return fields;
}

function parseMounts(source: string | null): MountEntry[] | null {
  if (source === null) return null;
  const lines = source.trim().split('\n');
  if (lines.length > MAX_MOUNTS) return null;
  const mounts: MountEntry[] = [];
  for (const line of lines) {
    const separator = line.indexOf(' - ');
    if (separator < 0) continue;
    const before = line.slice(0, separator).split(' ');
    const after = line.slice(separator + 3).split(' ');
    if (before.length < 6 || after.length < 3) continue;
    const root = decodeMountPath(before[3]);
    const directory = decodeMountPath(before[4]);
    if (!cleanAbsolute(root) || !cleanAbsolute(directory) || !/^[a-zA-Z0-9_.-]{1,80}$/.test(after[0])) continue;
    mounts.push({ root, directory, fileSystem: after[0], controllers: after[2].split(',') });
  }
  return mounts.length ? mounts : null;
}

function cgroupLocation(source: string | null, mounts: MountEntry[], version: 1 | 2): { leaf: string; root: string; mountRoot: string } | null {
  if (source === null) return null;
  for (const line of source.split('\n')) {
    const match = /^(\d+):([^:]*):(.*)$/.exec(line);
    if (!match || (version === 2 ? match[1] !== '0' || match[2] !== '' : !match[2].split(',').includes('memory'))) continue;
    const membership = match[3];
    if (!cleanAbsolute(membership)) continue;
    const candidates = mounts.filter(mount => version === 2 ? mount.fileSystem === 'cgroup2'
      : mount.fileSystem === 'cgroup' && mount.controllers.includes('memory'))
      .filter(mount => within(mount.root, membership))
      .sort((first, second) => first.root.length - second.root.length || first.directory.length - second.directory.length);
    // Prefer the broadest visible hierarchy so ancestor pressure is observable.
    for (const mount of candidates) {
      const leaf = path.posix.join(mount.directory, path.posix.relative(mount.root, membership));
      if (within(mount.directory, leaf)) return { leaf, root: mount.directory, mountRoot: mount.root };
    }
  }
  return null;
}

async function definitelyMissing(filename: string): Promise<boolean> {
  try { await fs.lstat(filename); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
}

function readHostMemory(source: string | null): { total: number | null; available: number | null } {
  const read = (name: string): number | null => {
    const match = source && new RegExp(`^${name}:\\s+(\\d+)\\s+kB\\s*$`, 'm').exec(source);
    const kibibytes = nonnegativeInteger(match ? match[1] : null);
    if (kibibytes === null || !Number.isSafeInteger(kibibytes * 1024)) return null;
    return kibibytes * 1024;
  };
  return { total: read('MemTotal'), available: read('MemAvailable') };
}

async function canonicalExistingAncestor(target: string): Promise<string | null> {
  if (!cleanAbsolute(target)) return null;
  let candidate = target;
  const suffix: string[] = [];
  for (let count = 0; count < 64; count++) {
    try { return path.posix.join(await fs.realpath(candidate), ...suffix); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || candidate === '/') return null;
      try { if ((await fs.lstat(candidate)).isSymbolicLink()) return null; }
      catch (statError) { if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') return null; }
      suffix.unshift(path.posix.basename(candidate));
      candidate = path.posix.dirname(candidate);
    }
  }
  return null;
}

async function filesystemObservation(purpose: HostResourceSnapshot['filesystems'][number]['purpose'], target: string, mounts: MountEntry[] | null): Promise<HostResourceSnapshot['filesystems'][number]> {
  // An exact kernel-reported mount point is already a resolved namespace path.
  // In particular, observing the native /data attachment needs no FUSE I/O.
  const resolvedPath = mounts?.some(entry => entry.directory === target) ? target : await canonicalExistingAncestor(target);
  const mount = resolvedPath && mounts?.filter(entry => within(entry.directory, resolvedPath)).sort((first, second) => second.directory.length - first.directory.length)[0];
  const fileSystem = mount ? mount.fileSystem : null;
  return {
    purpose, path: target, resolvedPath, mountPoint: mount ? mount.directory : null, fileSystem,
    // Even a block filesystem can sit on a RAM device; do not infer its medium.
    memoryBacked: fileSystem === 'tmpfs' || fileSystem === 'ramfs' ? true : null,
  };
}

/** Read-only observation: no processes, mounts, cgroup writes, or machine mutation. */
export async function observeHostResources(config: Pick<AppConfig, 'dataDir' | 'runtimeDir'>, options: ObservationOptions = {}): Promise<HostResourceSnapshot> {
  const proc = options.procRoot ?? '/proc';
  const observedAt = (options.now?.() ?? new Date()).toISOString();
  const warnings: string[] = [];
  const [mountText, cgroupText, hostText] = cleanAbsolute(proc) ? await Promise.all([
    readBounded(path.join(proc, 'self/mountinfo'), MAX_MOUNTINFO_BYTES),
    readBounded(path.join(proc, 'self/cgroup'), MAX_CONTROL_BYTES),
    readBounded(path.join(proc, 'meminfo'), MAX_CONTROL_BYTES),
  ]) : [null, null, null];
  const mounts = parseMounts(mountText);
  const host = readHostMemory(hostText);
  let location = mounts ? cgroupLocation(cgroupText, mounts, 2) : null;
  const legacyLocation = mounts ? cgroupLocation(cgroupText, mounts, 1) : null;
  let version: 1 | 2 = 2;
  // A hybrid host may expose cgroup2 while its memory controller remains on v1.
  if (legacyLocation && (!location || await readBounded(path.join(location.leaf, 'memory.current'), 128) === null)) {
    location = legacyLocation; version = 1;
  }
  const scopes: HostMemoryScope[] = [];
  let complete = !!location;
  let statText: string | null = null;
  let swapCurrentBytes: number | null = null;
  if (location) {
    let directory = location.leaf;
    for (let depth = 0; depth < MAX_CGROUP_DEPTH; depth++) {
      const [current, maximum, high, hierarchy] = await Promise.all([
        readBounded(path.join(directory, version === 2 ? 'memory.current' : 'memory.usage_in_bytes'), 128),
        readBounded(path.join(directory, version === 2 ? 'memory.max' : 'memory.limit_in_bytes'), 128),
        version === 2 ? readBounded(path.join(directory, 'memory.high'), 128) : Promise.resolve(null),
        version === 1 && depth > 0 ? readBounded(path.join(directory, 'memory.use_hierarchy'), 128) : Promise.resolve(null),
      ]);
      // The real v2 hierarchy root has no memory.current/max controls. A scoped
      // namespace root does have them. Skip only confirmed absent root controls,
      // never permission failures, malformed counters, or a missing leaf scope.
      if (version === 2 && depth > 0 && directory === location.root && location.mountRoot === '/'
        && current === null && maximum === null && high === null
        && (await Promise.all(['memory.current', 'memory.max', 'memory.high'].map(name => definitelyMissing(path.join(directory, name))))).every(Boolean)) break;
      if (depth === 0) {
        [statText, swapCurrentBytes] = await Promise.all([
          readBounded(path.join(directory, 'memory.stat'), MAX_CONTROL_BYTES),
          version === 2 ? readBounded(path.join(directory, 'memory.swap.current'), 128).then(nonnegativeInteger) : Promise.resolve(null),
        ]);
      }
      // Old v1 hierarchies may explicitly exclude descendants from accounting.
      const applicable = depth === 0 || version === 2 || hierarchy?.trim() === '1';
      if (version === 1 && depth > 0 && hierarchy?.trim() !== '0' && hierarchy?.trim() !== '1') complete = false;
      if (applicable) {
        const limit = memoryLimit(maximum, version);
        const highLimit = version === 2 ? memoryLimit(high, 2) : { bytes: null, kind: 'unlimited' as const };
        const currentBytes = nonnegativeInteger(current);
        const scope: HostMemoryScope = { directory, currentBytes, limitBytes: limit.bytes, limitKind: limit.kind, highBytes: highLimit.bytes };
        scopes.push(scope);
        if (limit.kind === 'unknown' || currentBytes === null && (depth === 0 || limit.bytes !== null || highLimit.bytes !== null)) complete = false;
      }
      if (directory === location.root) break;
      directory = path.posix.dirname(directory);
      if (!within(location.root, directory) || depth === MAX_CGROUP_DEPTH - 1) { complete = false; break; }
    }
  }
  const currentBytes = scopes[0]?.currentBytes ?? null;
  const limits = scopes.flatMap(scope => scope.limitBytes === null ? [] : [scope.limitBytes]);
  const limitBytes = limits.length ? Math.min(...limits) : null;
  const limitKind: LimitKind = !complete ? 'unknown' : limitBytes === null ? 'unlimited' : 'limited';
  const effectiveCeilingBytes = Math.min(HOST_MEMORY_CEILING_BYTES, limitBytes ?? Infinity);
  const status: HostResourceSnapshot['memory']['status'] = currentBytes === null ? 'unavailable' : complete ? 'available' : 'partial';
  let headroomBytes: number | null = null;
  if (complete && currentBytes !== null) {
    const remainders = [effectiveCeilingBytes - currentBytes];
    if (host.available !== null) remainders.push(host.available);
    for (const scope of scopes) {
      if (scope.currentBytes === null) continue;
      if (scope.limitBytes !== null) remainders.push(scope.limitBytes - scope.currentBytes);
      // memory.high is a reclamation/throttling threshold, not a hard RAM limit.
      if (scope.highBytes !== null) remainders.push(scope.highBytes - scope.currentBytes);
    }
    headroomBytes = Math.max(0, Math.min(...remainders));
  }
  const fields = numericFields(statText);
  const field = (v2: string, v1: string): number | null => fields.get(version === 2 ? v2 : v1) ?? null;
  const breakdown = fields.size ? {
    anonymousBytes: field('anon', 'total_rss'), fileBytes: field('file', 'total_cache'),
    sharedMemoryBytes: field('shmem', 'total_shmem'), kernelBytes: version === 2 ? fields.get('kernel') ?? null : null,
    inactiveFileBytes: field('inactive_file', 'total_inactive_file'),
  } : null;
  if (!mounts) warnings.push('Filesystem mount information is unavailable or exceeds the bounded read limit.');
  if (status !== 'available') warnings.push('Instance memory accounting is unavailable or incomplete; host MemTotal is not an instance allowance.');
  if (currentBytes !== null && currentBytes >= effectiveCeilingBytes) warnings.push('Observed memory usage has reached or exceeded the effective operation ceiling.');
  else if (headroomBytes !== null && headroomBytes <= HOST_MEMORY_RESERVE_BYTES) warnings.push('Observed memory headroom is at or below the 2 GB reserve; defer new heavy work.');
  if (!breakdown) warnings.push('The memory.stat breakdown is unavailable; file cache and shared-memory charges cannot be separated in this snapshot.');
  const filesystems = await Promise.all([
    filesystemObservation('durable', path.resolve(config.dataDir), mounts),
    filesystemObservation('runtime', path.resolve(config.runtimeDir), mounts),
    filesystemObservation('temporary', '/tmp', mounts),
  ]);
  return {
    observedAt,
    memory: { status, source: location ? version === 2 ? 'cgroup-v2' : 'cgroup-v1' : null, currentBytes, limitBytes, limitKind,
      policyCeilingBytes: HOST_MEMORY_CEILING_BYTES, effectiveCeilingBytes, headroomBytes, defaultReserveBytes: HOST_MEMORY_RESERVE_BYTES,
      hostTotalBytes: host.total, hostAvailableBytes: host.available, breakdown, swapCurrentBytes, scopes },
    filesystems, warnings,
  };
}

/** Admission, not an OOM guarantee: it neither signals nor kills any process. */
export function assessHostAdmission(snapshot: HostResourceSnapshot, options: { estimatedAdditionalBytes?: number; reserveBytes?: number; now?: number } = {}): HostAdmission {
  const estimated = options.estimatedAdditionalBytes ?? 0;
  const reserve = options.reserveBytes ?? HOST_MEMORY_RESERVE_BYTES;
  if (!Number.isSafeInteger(estimated) || estimated < 0 || !Number.isSafeInteger(reserve) || reserve < HOST_MEMORY_RESERVE_BYTES
    || !Number.isSafeInteger(estimated + reserve)) throw new RangeError('Memory admission requires a nonnegative byte estimate and at least 2 GB of reserve.');
  const base = { ceilingBytes: snapshot.memory.effectiveCeilingBytes, headroomBytes: snapshot.memory.headroomBytes, requiredBytes: estimated + reserve };
  const observed = Date.parse(snapshot.observedAt);
  const age = (options.now ?? Date.now()) - observed;
  if (!Number.isFinite(age) || age < -1000 || age > MAX_SNAPSHOT_AGE_MS || snapshot.memory.status !== 'available' || snapshot.memory.headroomBytes === null) {
    return { ...base, allowed: false, status: 'unavailable', reason: 'Fresh instance memory accounting is unavailable. Recheck resources before starting this work.' };
  }
  if (snapshot.memory.headroomBytes <= base.requiredBytes) {
    return { ...base, allowed: false, status: 'refused', reason: `Insufficient memory headroom: ${formatBytes(snapshot.memory.headroomBytes)} remains before observed limits; this work needs more than ${formatBytes(base.requiredBytes)} including reserve. Wait for owned work to finish or reduce its memory demand.` };
  }
  return { ...base, allowed: true, status: 'allowed', reason: 'The current snapshot has headroom for the estimate and reserve. Concurrent workloads and sudden allocations can still change memory pressure.' };
}

function formatBytes(bytes: number | null): string {
  return bytes === null ? 'unavailable' : `${(bytes / 1_000_000_000).toFixed(2)} GB (${bytes} bytes)`;
}

/** Small, readable facts for the model; never serialize mount options/protocol JSON. */
export function formatHostResources(snapshot: HostResourceSnapshot): string {
  const memory = snapshot.memory;
  const lines = [
    `Host resource snapshot at ${snapshot.observedAt} (a point-in-time observation, not continuous monitoring):`,
    `Memory policy ceiling: 90 GB (90,000,000,000 decimal bytes, about 83.82 GiB), never 90%; retain at least 2 GB of headroom below the lower applicable limit.`,
    `Instance memory accounting: ${memory.status}${memory.source ? ` via ${memory.source}` : ''}; charged usage ${formatBytes(memory.currentBytes)}; visible cgroup hard limit ${memory.limitKind === 'unlimited' ? 'no finite visible limit' : formatBytes(memory.limitBytes)}${memory.limitKind === 'unknown' ? ' (incomplete limit observation)' : ''}; effective operation ceiling ${formatBytes(memory.effectiveCeilingBytes)}; observed headroom before reserve ${formatBytes(memory.headroomBytes)}.`,
    `Host MemTotal ${formatBytes(memory.hostTotalBytes)} and MemAvailable ${formatBytes(memory.hostAvailableBytes)} describe the shared host, not this instance's memory allowance. Visible ancestor workloads and memory.high thresholds can further reduce headroom.`,
    'Only visible cgroup ancestors were inspected; limits and sibling pressure outside this cgroup namespace may be unobservable.',
  ];
  if (memory.breakdown) lines.push(`Charged memory breakdown: anonymous ${formatBytes(memory.breakdown.anonymousBytes)}, file cache ${formatBytes(memory.breakdown.fileBytes)}, shared memory ${formatBytes(memory.breakdown.sharedMemoryBytes)} (already included in file cache), kernel ${formatBytes(memory.breakdown.kernelBytes)}. These counters are not an exact additive process-RSS total.`);
  for (const filesystem of snapshot.filesystems) {
    const description = filesystem.fileSystem ? `${filesystem.fileSystem} at ${JSON.stringify(filesystem.mountPoint)}` : 'mount information unavailable';
    const backing = filesystem.memoryBacked === true ? ' This is directly RAM-backed; tmpfs may use swap.'
      : filesystem.memoryBacked === false ? ' File cache can still charge instance memory.' : ' The underlying storage medium/capacity is not established by this snapshot.';
    lines.push(`${filesystem.purpose} path ${JSON.stringify(filesystem.path)}: ${description}.${backing}`);
  }
  lines.push('Keep project/source files and essential state, account connections, configuration and history in durable storage. Put disposable caches, dependencies, scratch and rebuildable outputs in the configured runtime paths outside /data where supported; never delete or silently migrate existing user files. Temporary filesystem bytes and RAM are different accounting domains: tmpfs/shared memory and filesystem page cache can contribute to cgroup usage. File cache is not free memory to subtract from the ceiling.');
  lines.push('Recheck immediately before owned heavy work, prefer early admission refusal, and never kill unrelated or manual processes. No sampled check can guarantee protection against instantaneous spikes. Read-only observation does not authorize mounting, unmounting, proot, Docker/container machinery, proxies or mining.');
  lines.push(...snapshot.warnings.map(warning => `Resource warning: ${warning}`));
  return lines.join('\n');
}
