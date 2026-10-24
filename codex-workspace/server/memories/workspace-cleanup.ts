import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppContext } from '../context';
import { HttpError } from '../errors';
import type { WorkspaceArtifactCleanupRequest } from '../workspace-trash/service';
import { RewindDirectory, isErrno } from '../agent/file-rewind-transaction-io';
import { legacyMemoryScopeSchema as memoryScopeSchema, legacyMemoryHumanOriginSchema as memoryHumanOriginSchema,
  isLegacyMemoryArtifactPath as isMemoryArtifactPath, LEGACY_MEMORY_MAX_ARTIFACTS,
  type LegacyMemoryScope as NativeMemoryScope } from '../legacy/memory-cleanup-metadata';

type CleanupContext = { config: Pick<AppContext['config'], 'stateDir' | 'sessionSecret'> };
type ObjectValue = Record<string, unknown>;
interface Entry { path: string; sha256: string; bytes: number }
interface Snapshot extends Entry { fingerprint: string }
interface ReadRecord { value: ObjectValue; snapshot: Snapshot }
interface Receipt {
  format: 'native-memory-workspace-cleanup-v1'; version: 1;
  workspaceId: string; deletionId: string; deletedAt: string; mode: 'trash' | 'permanent'; threads: string[]; entries: Entry[];
  retiredMemories?: string[];
}
interface SourceOwner { workspaceId: string; threadId: string; turnId: string }
interface MemoryOwner extends SourceOwner { jobId: string; digest: string; fingerprint: string }
interface JobOwner extends SourceOwner { memoryIds: string[]; recordHashes: Record<string, string>; fingerprint?: string }
interface Inventory { owned: Map<string, Snapshot>; threads: Map<string, string>; retiredMemories: Set<string> }
interface Budget { entries: number; bytes: number; deadline: number }

/** Independent of runtime recovery limits: even malformed/foreign entries count. */
export const WORKSPACE_MEMORY_CLEANUP_LIMITS = Object.freeze({ directoryEntries: 120_000, plannedFiles: 110_000,
  readBytes: 1024 * 1024 * 1024, fileBytes: 256 * 1024, receiptBytes: 32 * 1024 * 1024, milliseconds: 60_000 });
const LIMITS = WORKSPACE_MEMORY_CLEANUP_LIMITS;
const THREAD = /^thr_[a-f0-9]{32}$/u, MEMORY = /^mem_[a-f0-9]{32}$/u, JOB = /^mjob_[a-f0-9]{64}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const IDENTITY = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/u, WORKSPACE = /^[a-zA-Z0-9_-]{1,128}$/u;
const DELETION = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const MAX_ARTIFACTS = LEGACY_MEMORY_MAX_ARTIFACTS;
const artifactPath = (value: unknown): value is string => typeof value === 'string' && isMemoryArtifactPath(value);
const READ = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const statuses = new Set(['queued', 'running', 'completed', 'empty', 'skipped', 'failed', 'interrupted', 'cancelled']);
const queues = new Map<string, Promise<void>>();
const object = (value: unknown): value is ObjectValue => !!value && typeof value === 'object' && !Array.isArray(value);
const matches = (value: unknown, expression: RegExp): value is string => typeof value === 'string' && expression.test(value);
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const jsonDigest = (value: unknown) => digest(JSON.stringify(value));
const timestamp = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const fingerprint = (stat: BigIntStats) => `${stat.dev}:${stat.ino}:${stat.mode}:${stat.nlink}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
const sameOwner = (a: SourceOwner, b: SourceOwner) => a.workspaceId === b.workspaceId && a.threadId === b.threadId && a.turnId === b.turnId;
function invalid(): never { throw new HttpError(409, 'Saved memory ownership could not be verified. Remaining memory files were retained for inspection.', 'MEMORY_WORKSPACE_CLEANUP_INVALID'); }
function changed(): never { throw new HttpError(409, 'Saved memory files changed during permanent deletion. Remaining files were retained; retry after reviewing the change.', 'MEMORY_WORKSPACE_CLEANUP_CHANGED'); }
function unsafe(): never { throw new HttpError(409, 'Memory cleanup found an unsafe filesystem entry. Its contents were not followed or removed.', 'MEMORY_WORKSPACE_CLEANUP_UNSAFE'); }
function limited(): never { throw new HttpError(413, 'Memory cleanup reached its bounded inspection limit. Remaining files were retained for retry.', 'MEMORY_WORKSPACE_CLEANUP_LIMIT'); }

function check(budget: Budget): void {
  if (budget.entries > LIMITS.directoryEntries || budget.bytes > LIMITS.readBytes || Date.now() > budget.deadline) limited();
}
function source(value: ObjectValue): SourceOwner {
  if (!matches(value.workspaceId, IDENTITY) || !matches(value.threadId, THREAD) || !matches(value.turnId, IDENTITY)) invalid();
  return { workspaceId: value.workspaceId, threadId: value.threadId, turnId: value.turnId };
}
function ids(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum || value.some(id => !matches(id, MEMORY)) || new Set(value).size !== value.length) invalid();
  return value as string[];
}
function artifactName(name: string): { jobId: string; slot: number } | undefined {
  const match = /^(mjob_[a-f0-9]{64})-([0-9]{1,2})\.json$/u.exec(name);
  if (!match || Number(match[2]) >= MAX_ARTIFACTS || String(Number(match[2])) !== match[2]) return;
  return { jobId: match[1], slot: Number(match[2]) };
}
function plannedPath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = value.split('/');
  if (parts[0] === 'edits') return parts.length === 3 && MEMORY.test(parts[1]) && /^[a-f0-9]{32}\.json$/u.test(parts[2]);
  if (parts.length !== 2) return false;
  if (parts[0] === 'records') return /^mem_[a-f0-9]{32}\.json$/u.test(parts[1]);
  if (['jobs', 'consolidation-jobs', 'consolidation-manifests'].includes(parts[0])) return /^mjob_[a-f0-9]{64}\.json$/u.test(parts[1]);
  if (parts[0] === 'consolidation-heads') return /^(?:[a-f0-9]{64}|owner)\.json$/u.test(parts[1]);
  return parts[0] === 'consolidation-artifacts' && !!artifactName(parts[1]);
}

/** Descriptors pin ancestors. Every deletion also checks the exact inspected bytes.
 * The caller fences cooperative writers; this is not a distributed CAS against an
 * uncooperative process replacing a leaf after the final check and before unlink. */
class MemoryTree {
  constructor(readonly root: RewindDirectory, readonly budget: Budget) {}

  async assertNoPendingRootWrites(): Promise<void> {
    await this.root.check();
    for await (const entry of await fs.opendir(this.root.access, { bufferSize: 16 })) {
      this.budget.entries++; check(this.budget);
      // Both MemoryFiles and this cleanup can leave projected startup metadata
      // on an interrupted write. A projection for workspace A still contains
      // workspace B's reports, so a later purge of B must not ignore that copy.
      // Random temporary names supply no publication authority: fail visibly.
      if (!entry.name.startsWith('.pending-') && !/^\.memory-cleanup-[a-f0-9-]{36}\.tmp$/u.test(entry.name)) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) unsafe();
      invalid();
    }
    await this.root.check();
  }

  private async parent<T>(relative: string, work: (directory: RewindDirectory, name: string) => Promise<T>): Promise<T | undefined> {
    const parts = relative.split('/');
    if (parts.length > 3 || parts.some(part => !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}$/u.test(part) || part === '.' || part === '..')) invalid();
    const opened: RewindDirectory[] = []; let directory = this.root;
    try {
      for (const part of parts.slice(0, -1)) {
        try { directory = await directory.child(part); opened.push(directory); }
        catch (error) { if (isErrno(error, 'ENOENT')) { await this.root.check(); return; } throw error; }
      }
      return await work(directory, parts.at(-1)!);
    } finally { for (const child of opened.reverse()) await child.close(); }
  }

  async read(relative: string, maximum: number = LIMITS.fileBytes): Promise<ReadRecord | undefined> {
    return this.parent(relative, (directory, name) => this.readLeaf(directory, name, relative, maximum));
  }

  private async readLeaf(directory: RewindDirectory, name: string, relative: string, maximum: number): Promise<ReadRecord | undefined> {
    check(this.budget); await this.root.check(); await directory.check();
    let handle: Awaited<ReturnType<typeof fs.open>>;
    try { handle = await fs.open(`${directory.access}/${name}`, READ); }
    catch (error) { if (isErrno(error, 'ENOENT')) { await directory.check(); return; } if (isErrno(error, 'ELOOP') || isErrno(error, 'ENOTDIR')) unsafe(); throw error; }
    try {
      const before = await handle.stat({ bigint: true });
      if (!before.isFile() || before.nlink !== 1n) unsafe();
      if (before.size > BigInt(maximum)) limited();
      if (before.size < 2n) invalid();
      this.budget.bytes += Number(before.size); check(this.budget);
      const bytes = Buffer.allocUnsafe(Number(before.size));
      for (let offset = 0; offset < bytes.length;) {
        check(this.budget);
        const result = await handle.read(bytes, offset, Math.min(64 * 1024, bytes.length - offset), offset);
        if (!result.bytesRead) changed();
        offset += result.bytesRead;
      }
      const after = await handle.stat({ bigint: true }), named = await fs.lstat(`${directory.access}/${name}`, { bigint: true });
      if (!named.isFile() || named.isSymbolicLink() || fingerprint(before) !== fingerprint(after) || fingerprint(after) !== fingerprint(named)) changed();
      await directory.check(); await this.root.check();
      let value: unknown;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { invalid(); }
      if (!object(value)) invalid();
      return { value, snapshot: { path: relative, sha256: digest(bytes), bytes: bytes.length, fingerprint: fingerprint(after) } };
    } finally { await handle.close(); }
  }

  async *files(namespace: string, pattern: RegExp, maximum: number): AsyncGenerator<ReadRecord> {
    let directory: RewindDirectory;
    try { directory = await this.root.child(namespace); }
    catch (error) { if (isErrno(error, 'ENOENT')) { await this.root.check(); return; } throw error; }
    try {
      let count = 0;
      for await (const entry of await fs.opendir(directory.access, { bufferSize: 16 })) {
        this.budget.entries++; check(this.budget);
        if (++count > maximum) limited();
        if (!entry.isFile() || entry.isSymbolicLink()) unsafe();
        if (!pattern.test(entry.name)) invalid();
        const record = await this.readLeaf(directory, entry.name, `${namespace}/${entry.name}`, LIMITS.fileBytes);
        if (!record) changed();
        yield record;
      }
      await directory.check(); await this.root.check();
    } finally { await directory.close(); }
  }

  async *editDirectories(): AsyncGenerator<{ id: string; records: ReadRecord[] }> {
    let parent: RewindDirectory;
    try { parent = await this.root.child('edits'); }
    catch (error) { if (isErrno(error, 'ENOENT')) { await this.root.check(); return; } throw error; }
    try {
      for await (const entry of await fs.opendir(parent.access, { bufferSize: 16 })) {
        this.budget.entries++; check(this.budget);
        if (!entry.isDirectory() || entry.isSymbolicLink()) unsafe();
        if (!MEMORY.test(entry.name)) invalid();
        const directory = await parent.child(entry.name), records: ReadRecord[] = [];
        try {
          for await (const edit of await fs.opendir(directory.access, { bufferSize: 16 })) {
            this.budget.entries++; check(this.budget);
            if (records.length >= 64) limited();
            if (!edit.isFile() || edit.isSymbolicLink()) unsafe();
            if (!/^[a-f0-9]{32}\.json$/u.test(edit.name)) invalid();
            const record = await this.readLeaf(directory, edit.name, `edits/${entry.name}/${edit.name}`, LIMITS.fileBytes);
            if (!record) changed();
            records.push(record);
          }
          await directory.check();
        } finally { await directory.close(); }
        yield { id: entry.name, records };
      }
      await parent.check(); await this.root.check();
    } finally { await parent.close(); }
  }

  async verify(entry: Entry, inspected?: Snapshot): Promise<void> {
    const current = await this.read(entry.path);
    if (current && (current.snapshot.sha256 !== entry.sha256 || current.snapshot.bytes !== entry.bytes
      || inspected && current.snapshot.fingerprint !== inspected.fingerprint)) changed();
  }

  async remove(entry: Entry, request: WorkspaceArtifactCleanupRequest, inspected?: Snapshot): Promise<void> {
    await this.parent(entry.path, async (directory, name) => {
      await request.assertCurrent();
      const current = await this.readLeaf(directory, name, entry.path, LIMITS.fileBytes);
      if (!current) return;
      if (current.snapshot.sha256 !== entry.sha256 || current.snapshot.bytes !== entry.bytes
        || inspected && current.snapshot.fingerprint !== inspected.fingerprint) changed();
      await directory.check(); await this.root.check(); await request.assertCurrent();
      const named = await fs.lstat(`${directory.access}/${name}`, { bigint: true });
      if (!named.isFile() || named.isSymbolicLink() || fingerprint(named) !== current.snapshot.fingerprint) changed();
      await fs.unlink(`${directory.access}/${name}`);
      try { await fs.lstat(`${directory.access}/${name}`); changed(); }
      catch (error) { if (!isErrno(error, 'ENOENT')) throw error; }
      await directory.check(); await this.root.check();
    });
  }

  async replaceRoot(name: string, value: unknown, previous: Snapshot | undefined, request: WorkspaceArtifactCleanupRequest, maximum: number): Promise<Snapshot> {
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    if (bytes.length > maximum) limited();
    const temporary = `.memory-cleanup-${randomUUID()}.tmp`, access = `${this.root.access}/${temporary}`;
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined, owned: BigIntStats | undefined;
    try {
      await this.root.check(); await request.assertCurrent();
      handle = await fs.open(access, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      owned = await handle.stat({ bigint: true }); await handle.writeFile(bytes); await handle.close(); handle = undefined;
      const current = await this.read(name, maximum);
      if (previous ? !current || current.snapshot.sha256 !== previous.sha256 || current.snapshot.fingerprint !== previous.fingerprint : !!current) changed();
      await this.root.check(); await request.assertCurrent();
      const latest = await this.read(name, maximum);
      if (previous ? !latest || latest.snapshot.sha256 !== previous.sha256 || latest.snapshot.fingerprint !== previous.fingerprint : !!latest) changed();
      await fs.rename(access, `${this.root.access}/${name}`); owned = undefined;
      const saved = await this.read(name, maximum);
      if (!saved || saved.snapshot.sha256 !== digest(bytes)) changed();
      return saved.snapshot;
    } finally {
      await handle?.close();
      if (owned) {
        try { const current = await fs.lstat(access, { bigint: true }); if (current.isFile() && current.dev === owned.dev && current.ino === owned.ino) await fs.unlink(access); }
        catch (error) { if (!isErrno(error, 'ENOENT')) throw error; }
      }
    }
  }
}

function receiptName(request: WorkspaceArtifactCleanupRequest): string { return `workspace-cleanup-${jsonDigest([request.workspaceId, request.deletionId])}.json`; }
function sign(ctx: CleanupContext, value: Receipt): string {
  return createHmac('sha256', ctx.config.sessionSecret).update('native-memory-workspace-cleanup-v1\n').update(JSON.stringify(value)).digest('hex');
}
function parseReceipt(ctx: CleanupContext, record: ReadRecord, request: WorkspaceArtifactCleanupRequest): Receipt {
  const envelope = record.value, value = envelope.value;
  if (envelope.version !== 1 || !matches(envelope.signature, HASH) || !object(value)
    || Object.keys(envelope).some(key => !['version', 'value', 'signature'].includes(key))
    || value.format !== 'native-memory-workspace-cleanup-v1' || value.version !== 1 || value.workspaceId !== request.workspaceId
    || value.deletionId !== request.deletionId || value.deletedAt !== request.deletedAt || value.mode !== request.mode
    || Object.keys(value).some(key => !['format', 'version', 'workspaceId', 'deletionId', 'deletedAt', 'mode', 'threads', 'entries', 'retiredMemories'].includes(key))
    || !Array.isArray(value.threads) || value.threads.length > LIMITS.plannedFiles || value.threads.some(id => !matches(id, THREAD))
    || new Set(value.threads).size !== value.threads.length || !Array.isArray(value.entries) || value.entries.length > LIMITS.plannedFiles) invalid();
  if (value.retiredMemories !== undefined) ids(value.retiredMemories, LIMITS.plannedFiles);
  const names = new Set<string>();
  for (const entry of value.entries) {
    if (!object(entry) || !plannedPath(entry.path) || !matches(entry.sha256, HASH)
      || typeof entry.bytes !== 'number' || !Number.isSafeInteger(entry.bytes) || entry.bytes < 2 || entry.bytes > LIMITS.fileBytes
      || Object.keys(entry).some(key => !['path', 'sha256', 'bytes'].includes(key)) || names.has(entry.path)) invalid();
    names.add(entry.path);
  }
  const result = value as unknown as Receipt;
  if (!timingSafeEqual(Buffer.from(envelope.signature, 'hex'), Buffer.from(sign(ctx, result), 'hex'))) invalid();
  return result;
}

interface GenerationOwner { scope: NativeMemoryScope; sources: string[]; workspaces: string[]; identity: string }
function scopeOf(value: unknown): NativeMemoryScope {
  const parsed = memoryScopeSchema.safeParse(value); if (!parsed.success) invalid(); return parsed.data;
}
function generationOwner(value: ObjectValue, version: 1 | 2): GenerationOwner {
  const scope = version === 1 ? scopeOf({ kind: 'workspace', workspaceId: value.workspaceId }) : scopeOf(value.scope);
  let sources: string[];
  if (version === 1) sources = [(scope as { workspaceId: string }).workspaceId];
  else {
    if (!Array.isArray(value.sourceWorkspaces) || value.sourceWorkspaces.length > 64
      || value.sourceWorkspaces.some(id => !matches(id, IDENTITY)) || new Set(value.sourceWorkspaces).size !== value.sourceWorkspaces.length) invalid();
    sources = [...value.sourceWorkspaces as string[]].sort();
  }
  const workspaces = [...new Set([...sources, ...(scope.kind === 'workspace' ? [scope.workspaceId] : [])])].sort();
  return { scope, sources, workspaces, identity: JSON.stringify({ scope, sources }) };
}

async function inventory(tree: MemoryTree, request: WorkspaceArtifactCleanupRequest, receipt?: Receipt): Promise<Inventory> {
  const owned = new Map<string, Snapshot>(), threads = new Map<string, string>((receipt?.threads ?? []).map(id => [id, request.workspaceId] as const));
  const memories = new Map<string, MemoryOwner>(), noteIds = new Set<string>();
  const jobs = new Map<string, JobOwner>(), references = new Map<string, SourceOwner>();
  const recordOwners = new Map<string, string[]>(), recordScopes = new Map<string, NativeMemoryScope>();
  const originalOwners = new Map<string, string[]>(), revisionOwners = new Map<string, Array<{ revision: number; workspaceId: string }>>();
  const recordRows = new Map<string, ReadRecord>(), editRows = new Map<string, Array<{ record: ReadRecord; extraOwners: string[] }>>();
  const generationRows = new Map<string, ReadRecord[]>(), generationDependencies = new Map<string, Set<string>>();
  const consolidated = new Map<string, GenerationOwner>();
  const manifests = new Map<string, { owner: GenerationOwner; digest: string; artifacts: Map<string, { hash: string; path: string }> }>();
  const artifacts = new Map<string, { owner: GenerationOwner; jobId: string; digest: string; path: string }>();
  const heads: Array<{ owner: GenerationOwner; jobId: string; manifestHash: string }> = [];
  const add = (record: ReadRecord, owners: string | readonly string[]) => {
    if (typeof owners === 'string' ? owners !== request.workspaceId : !owners.includes(request.workspaceId)) return;
    if (owned.size >= LIMITS.plannedFiles) limited(); owned.set(record.snapshot.path, record.snapshot);
  };
  const thread = (id: string, workspaceId: string) => { const previous = threads.get(id); if (previous && previous !== workspaceId) invalid(); threads.set(id, workspaceId); };
  const generation = (id: string, owner: GenerationOwner) => { const previous = consolidated.get(id); if (previous && previous.identity !== owner.identity) invalid(); consolidated.set(id, owner); };
  const reference = (id: string, owner: SourceOwner) => { const previous = references.get(id); if (previous && !sameOwner(previous, owner)) invalid(); references.set(id, owner); };
  const generationRow = (id: string, record: ReadRecord) => { const rows = generationRows.get(id) ?? []; rows.push(record); generationRows.set(id, rows); };
  const dependency = (id: string, owner: GenerationOwner, revision?: number) => {
    const base = originalOwners.get(id) ?? (references.has(id) ? [references.get(id)!.workspaceId] : undefined);
    const owners = base && [...base, ...(revisionOwners.get(id) ?? []).filter(edit => revision !== undefined && edit.revision <= revision).map(edit => edit.workspaceId)];
    if (owners?.some(workspaceId => !owner.workspaces.includes(workspaceId))) invalid();
    const scope = recordScopes.get(id); if (scope && JSON.stringify(scope) !== JSON.stringify(owner.scope)) invalid();
  };
  const generationDependency = (jobId: string, id: string, owner: GenerationOwner, revision?: number) => {
    dependency(id, owner, revision); const references = generationDependencies.get(jobId) ?? new Set<string>(); references.add(id); generationDependencies.set(jobId, references);
  };

  await request.assertCurrent();
  for await (const record of tree.files('records', /^mem_[a-f0-9]{32}\.json$/u, 512)) {
    const value = record.value, name = path.posix.basename(record.snapshot.path);
    if (!['native-memory-record-v1', 'native-memory-record-v2'].includes(String(value.format))
      || !matches(value.id, MEMORY) || name !== `${value.id}.json` || value.revision !== 1
      || typeof value.text !== 'string' || value.text.length > 1200) invalid();
    const legacy = value.format === 'native-memory-record-v1';
    const scope = legacy ? scopeOf({ kind: 'workspace', workspaceId: value.workspaceId }) : scopeOf(value.scope);
    const origin = legacy ? { kind: 'extracted', sourceWorkspaceId: value.workspaceId, source: value.source, generation: value.generation } : value.origin;
    if (!object(origin)) invalid();
    const owners = new Set<string>(scope.kind === 'workspace' ? [scope.workspaceId] : []);
    if (origin.kind === 'extracted') {
      if (!object(origin.source) || !object(origin.generation) || !matches(origin.generation.jobId, JOB)
        || !matches(origin.source.fingerprint, HASH) || !Array.isArray(origin.source.evidence)
        || origin.source.evidence.length < 1 || origin.source.evidence.length > 3) invalid();
      const owner = source({ workspaceId: origin.sourceWorkspaceId, threadId: origin.source.threadId, turnId: origin.source.turnId });
      if (origin.generation.jobId !== `mjob_${jsonDigest([owner.threadId, owner.turnId])}`) invalid();
      owners.add(owner.workspaceId); memories.set(value.id, { ...owner, jobId: origin.generation.jobId, digest: jsonDigest(value), fingerprint: origin.source.fingerprint });
      reference(value.id, owner); thread(owner.threadId, owner.workspaceId);
    } else if (origin.kind === 'note') {
      const author = memoryHumanOriginSchema.safeParse(origin.author);
      if (!author.success || Object.keys(origin).some(key => !['kind', 'author'].includes(key))) invalid();
      const operation = await tree.read(`note-operations/${digest(author.data.operationId)}.json`);
      if (operation) {
        const proof = operation.value, proofAuthor = memoryHumanOriginSchema.safeParse(proof.origin);
        if (proof.format !== 'native-memory-note-operation-v1' || proof.id !== author.data.operationId || proof.action !== 'remember'
          || !proofAuthor.success || JSON.stringify(proofAuthor.data) !== JSON.stringify(author.data)
          || !ids(proof.memoryIds, 8).includes(value.id) || !Array.isArray(proof.scopes)
          || !proof.scopes.some(candidate => JSON.stringify(scopeOf(candidate)) === JSON.stringify(scope))
          || proof.published === true && (!object(proof.recordHashes) || proof.recordHashes[value.id] !== jsonDigest(value))) invalid();
      }
      noteIds.add(value.id);
      if (author.data.kind === 'conversation') {
        const owner = source(author.data); owners.add(owner.workspaceId); reference(value.id, owner); thread(owner.threadId, owner.workspaceId);
      }
    } else invalid();
    recordOwners.set(value.id, [...owners].sort()); originalOwners.set(value.id, [...owners].sort()); recordScopes.set(value.id, scope); recordRows.set(value.id, record);
  }

  await request.assertCurrent();
  for await (const record of tree.files('jobs', /^mjob_[a-f0-9]{64}\.json$/u, 4096)) {
    const value = record.value;
    if (value.format !== 'native-memory-job-v1' || !matches(value.id, JOB) || path.posix.basename(record.snapshot.path) !== `${value.id}.json`
      || typeof value.status !== 'string' || !statuses.has(value.status) || !object(value.recordHashes)
      || value.fingerprint !== undefined && !matches(value.fingerprint, HASH)) invalid();
    const owner = source(value), memoryIds = ids(value.memoryIds, 8);
    const scope = value.scope === undefined ? scopeOf({ kind: 'workspace', workspaceId: owner.workspaceId }) : scopeOf(value.scope);
    if (value.id !== `mjob_${jsonDigest([owner.threadId, owner.turnId])}`
      || Object.entries(value.recordHashes).some(([id, hash]) => !memoryIds.includes(id) || !matches(hash, HASH))) invalid();
    const saved: JobOwner = { ...owner, memoryIds, recordHashes: value.recordHashes as Record<string, string>, ...(typeof value.fingerprint === 'string' ? { fingerprint: value.fingerprint } : {}) };
    jobs.set(value.id, saved); thread(owner.threadId, owner.workspaceId);
    for (const id of memoryIds) {
      if (noteIds.has(id)) invalid();
      reference(id, owner);
      if (recordScopes.has(id) && JSON.stringify(recordScopes.get(id)) !== JSON.stringify(scope)) invalid();
    }
    add(record, [...new Set([owner.workspaceId, ...(scope.kind === 'workspace' ? [scope.workspaceId] : [])])]);
  }
  for (const [id, memory] of memories) {
    const job = jobs.get(memory.jobId);
    if (job && (!sameOwner(job, memory) || job.recordHashes[id] && job.recordHashes[id] !== memory.digest
      || job.fingerprint !== undefined && job.fingerprint !== memory.fingerprint)) invalid();
  }

  await request.assertCurrent();
  const receiptMemories = new Set((receipt?.entries ?? []).flatMap(entry => {
    const parts = entry.path.split('/'); return parts[0] === 'records' ? [parts[1].slice(0, -5)] : parts[0] === 'edits' ? [parts[1]] : [];
  }));
  const receiptRetired = new Set(receipt?.retiredMemories ?? (receipt?.entries ?? []).filter(entry => entry.path.startsWith('records/')).map(entry => path.posix.basename(entry.path).slice(0, -5)));
  for await (const directory of tree.editDirectories()) {
    const sourceOwner = references.get(directory.id);
    const owners = recordOwners.get(directory.id) ?? (sourceOwner ? [sourceOwner.workspaceId] : receiptMemories.has(directory.id) ? [request.workspaceId] : undefined);
    if (directory.records.length && !owners) invalid();
    // A signed plan retains exact deletion authority after an editor's own
    // revision has already been removed. The original source may belong to A
    // while this purge is for its committed human editor B; remaining A jobs
    // are not proof that the already-signed B dependency was fabricated.
    if (owners && receiptRetired.has(directory.id) && !owners.includes(request.workspaceId)) owners.push(request.workspaceId);
    for (const record of directory.records) {
      const value = record.value;
      const extraOwners: string[] = [];
      if (!['native-memory-edit-v1', 'native-memory-edit-v2'].includes(String(value.format)) || value.id !== directory.id || typeof value.text !== 'string' || value.text.length > 1200
        || !Number.isInteger(value.revision) || !Number.isInteger(value.parentRevision)
        || (value.revision as number) < 2 || (value.revision as number) > 64 || value.revision !== (value.parentRevision as number) + 1
        || value.format === 'native-memory-edit-v2' && !matches(value.operationId, IDENTITY)) invalid();
      if (value.format === 'native-memory-edit-v2') {
        const operation = await tree.read(`note-operations/${digest(String(value.operationId))}.json`);
        if (operation && (operation.value.format !== 'native-memory-note-operation-v1' || operation.value.id !== value.operationId
          || operation.value.action !== 'update' || !ids(operation.value.memoryIds, 8).includes(directory.id)
          || operation.value.published === true && (!object(operation.value.editHashes) || operation.value.editHashes[directory.id] !== jsonDigest(value)))) invalid();
        if (operation) {
          const author = memoryHumanOriginSchema.safeParse(operation.value.origin);
          if (!author.success || author.data.operationId !== value.operationId) invalid();
          if (author.data.kind === 'conversation') {
            thread(author.data.threadId, author.data.workspaceId);
            extraOwners.push(author.data.workspaceId);
            if (operation.value.published === true) {
              if (owners && !owners.includes(author.data.workspaceId)) owners.push(author.data.workspaceId);
              const authors = revisionOwners.get(directory.id) ?? [];
              authors.push({ revision: value.revision as number, workspaceId: author.data.workspaceId }); revisionOwners.set(directory.id, authors);
            }
          }
        }
      }
      const rows = editRows.get(directory.id) ?? []; rows.push({ record, extraOwners }); editRows.set(directory.id, rows);
    }
    if (owners) recordOwners.set(directory.id, owners);
  }
  const retiredMemories = new Set(receiptRetired);
  for (const [id, owners] of recordOwners) if (owners.includes(request.workspaceId)) retiredMemories.add(id);
  for (const [id, record] of recordRows) {
    const owners = recordOwners.get(id)!;
    if (receiptRetired.has(id) && !owners.includes(request.workspaceId)) owners.push(request.workspaceId);
    add(record, owners);
  }
  for (const [id, rows] of editRows) for (const { record, extraOwners } of rows) add(record, [...(recordOwners.get(id) ?? []), ...extraOwners]);

  await request.assertCurrent();
  for await (const record of tree.files('consolidation-jobs', /^mjob_[a-f0-9]{64}\.json$/u, 1024)) {
    const value = record.value, version = value.format === 'native-memory-consolidation-job-v1' ? 1 : value.format === 'native-memory-consolidation-job-v2' ? 2 : undefined;
    if (!version || !matches(value.id, JOB) || path.posix.basename(record.snapshot.path) !== `${value.id}.json`
      || !matches(value.workspaceId, IDENTITY) || !matches(value.rootThreadId, THREAD) || !matches(value.fingerprint, HASH)
      || !Array.isArray(value.sourceTurns) || value.sourceTurns.length > 64 || !Array.isArray(value.artifactPaths) || value.artifactPaths.length > (version === 1 ? 70 : MAX_ARTIFACTS)
      || value.artifactPaths.some(item => !artifactPath(item))) invalid();
    const owner = generationOwner(value, version); generation(value.id, owner); thread(value.rootThreadId, value.workspaceId);
    for (const id of ids(value.memoryIds, 64)) generationDependency(value.id, id, owner);
    for (const turn of value.sourceTurns) {
      if (!object(turn) || !matches(turn.threadId, THREAD) || !matches(turn.turnId, IDENTITY)) invalid();
      const sourceWorkspace = version === 1 ? value.workspaceId : turn.sourceWorkspaceId ?? threads.get(turn.threadId);
      if (!matches(sourceWorkspace, IDENTITY) || !owner.workspaces.includes(sourceWorkspace)) invalid();
      thread(turn.threadId, sourceWorkspace);
    }
    generationRow(value.id, record);
  }

  await request.assertCurrent();
  for await (const record of tree.files('consolidation-manifests', /^mjob_[a-f0-9]{64}\.json$/u, 1024)) {
    const value = record.value, version = value.format === 'native-memory-consolidation-manifest-v1' ? 1 : value.format === 'native-memory-consolidation-manifest-v2' ? 2 : undefined;
    if (!version || !matches(value.jobId, JOB) || path.posix.basename(record.snapshot.path) !== `${value.jobId}.json`
      || !matches(value.fingerprint, HASH) || !Array.isArray(value.dependencies) || !value.dependencies.length || value.dependencies.length > 64
      || !Array.isArray(value.artifacts) || !value.artifacts.length || value.artifacts.length > (version === 1 ? 70 : MAX_ARTIFACTS)) invalid();
    const owner = generationOwner(value, version); generation(value.jobId, owner);
    const dependencies = new Set<string>(), descriptors = new Map<string, { hash: string; path: string }>();
    for (const item of value.dependencies) {
      if (!object(item) || !matches(item.id, MEMORY) || !matches(item.hash, HASH) || !Number.isInteger(item.revision)
        || (item.revision as number) < 1 || (item.revision as number) > 64 || dependencies.has(item.id)) invalid();
      generationDependency(value.jobId, item.id, owner, item.revision as number); dependencies.add(item.id);
    }
    for (const descriptor of value.artifacts) {
      if (!object(descriptor) || typeof descriptor.name !== 'string' || artifactName(descriptor.name)?.jobId !== value.jobId
        || !artifactPath(descriptor.path) || !matches(descriptor.hash, HASH) || descriptors.has(descriptor.name)) invalid();
      descriptors.set(descriptor.name, { hash: descriptor.hash, path: descriptor.path });
    }
    manifests.set(value.jobId, { owner, digest: jsonDigest(value), artifacts: descriptors }); generationRow(value.jobId, record);
  }

  await request.assertCurrent();
  for await (const record of tree.files('consolidation-artifacts', /^mjob_[a-f0-9]{64}-[0-9]{1,2}\.json$/u, 1024 * MAX_ARTIFACTS)) {
    const value = record.value, name = path.posix.basename(record.snapshot.path), identity = artifactName(name);
    const version = value.format === 'native-memory-artifact-v1' ? 1 : value.format === 'native-memory-artifact-v2' ? 2 : undefined;
    if (!identity || !version || version === 1 && identity.slot >= 70 || value.jobId !== identity.jobId || !artifactPath(value.path)
      || typeof value.content !== 'string' || value.content.length > 128 * 1024) invalid();
    const owner = generationOwner(value, version); generation(identity.jobId, owner);
    if (version === 2) for (const id of ids(value.memoryIds, 64)) generationDependency(identity.jobId, id, owner);
    artifacts.set(name, { owner, jobId: identity.jobId, digest: jsonDigest(value), path: value.path }); generationRow(identity.jobId, record);
  }
  for (const [jobId, manifest] of manifests) for (const [name, descriptor] of manifest.artifacts) {
    const artifact = artifacts.get(name);
    if (artifact && (artifact.jobId !== jobId || artifact.owner.identity !== manifest.owner.identity || artifact.digest !== descriptor.hash || artifact.path !== descriptor.path)) invalid();
  }

  await request.assertCurrent();
  for await (const record of tree.files('consolidation-heads', /^(?:[a-f0-9]{64}|owner)\.json$/u, 512)) {
    const value = record.value, version = value.format === 'native-memory-consolidation-head-v1' ? 1 : value.format === 'native-memory-consolidation-head-v2' ? 2 : undefined;
    if (!version || !matches(value.jobId, JOB) || !matches(value.manifestHash, HASH) || !matches(value.fingerprint, HASH)) invalid();
    const owner = generationOwner(value, version), filename = owner.scope.kind === 'owner' ? 'owner.json' : `${digest(owner.scope.workspaceId)}.json`;
    if (path.posix.basename(record.snapshot.path) !== filename) invalid();
    generation(value.jobId, owner); heads.push({ owner, jobId: value.jobId, manifestHash: value.manifestHash }); generationRow(value.jobId, record);
  }
  for (const head of heads) { const manifest = manifests.get(head.jobId); if (manifest && (manifest.owner.identity !== head.owner.identity || manifest.digest !== head.manifestHash)) invalid(); }
  const signedGenerations = new Set((receipt?.entries ?? []).flatMap(entry => {
    const parts = entry.path.split('/');
    if (['consolidation-jobs', 'consolidation-manifests'].includes(parts[0])) return [parts[1].slice(0, -5)];
    if (parts[0] === 'consolidation-artifacts') return [artifactName(parts[1])!.jobId];
    return [];
  }));
  for (const [jobId, rows] of generationRows) {
    const owner = consolidated.get(jobId)!;
    if (owner.workspaces.includes(request.workspaceId) || signedGenerations.has(jobId)
      || [...(generationDependencies.get(jobId) ?? [])].some(id => retiredMemories.has(id))) {
      for (const record of rows) add(record, request.workspaceId);
    }
  }
  return { owned, threads, retiredMemories };
}

const reportMetadata = new Set(['threadId', 'workspaceId', 'scope', 'generationEpoch', 'status', 'startedAt', 'completedAt', 'directoryEntries', 'metadataExamined',
  'metadataReads', 'candidates', 'sourcesRead', 'sourceBytes', 'turnsExamined', 'admitted', 'alreadyAdmitted', 'skipped', 'missingModelMetadata',
  'unsupportedModelOptions', 'hasMore', 'issues']);
const startupIssues = new Set(['unavailable', 'aborted', 'stopped', 'scope_changed', 'directory_limit', 'metadata_limit', 'admission_limit',
  'source_bytes_limit', 'source_file_limit', 'turn_limit', 'unsafe_file', 'invalid_metadata', 'invalid_source', 'missing_model_metadata',
  'unsupported_model_options', 'model_context_unconfigured', 'input_limit', 'budget', 'storage', 'invalid_checkpoint', 'restart', 'scheduler_limit', 'cursor_limit']);

function assertContentFreeReport(report: ObjectValue): void {
  for (const [key, value] of Object.entries(report)) {
    if (!reportMetadata.has(key)) invalid();
    if (key === 'threadId' || key === 'workspaceId') continue;
    if (key === 'scope') { scopeOf(value); continue; }
    if (key === 'generationEpoch') { if (!matches(value, /^[a-f0-9]{32}$/u)) invalid(); }
    else if (key === 'startedAt' || key === 'completedAt') { if (!timestamp(value)) invalid(); }
    else if (key === 'status') { if (typeof value !== 'string' || !['running', 'completed', 'limited', 'skipped', 'cancelled', 'interrupted', 'failed'].includes(value)) invalid(); }
    else if (key === 'hasMore') { if (typeof value !== 'boolean') invalid(); }
    else if (key === 'issues') { if (!Array.isArray(value) || value.length > startupIssues.size || value.some(issue => typeof issue !== 'string' || !startupIssues.has(issue))) invalid(); }
    else if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid();
  }
}

function startupProjection(value: ObjectValue, request: WorkspaceArtifactCleanupRequest, threads: Map<string, string>): ObjectValue {
  if (value.format !== 'native-memory-startup-v1' || !Array.isArray(value.cursors) || value.cursors.length > 512
    || !Array.isArray(value.reports) || value.reports.length > 64
    || Object.keys(value).some(key => !['format', 'cursors', 'reports', 'active'].includes(key))) invalid();
  const reportOwner = (report: unknown): string | undefined => {
    if (!object(report) || report.workspaceId !== undefined && !matches(report.workspaceId, IDENTITY)
      || report.threadId !== undefined && !matches(report.threadId, THREAD)) invalid();
    const known = typeof report.threadId === 'string' ? threads.get(report.threadId) : undefined;
    if (known && report.workspaceId !== undefined && known !== report.workspaceId) invalid();
    const scope = report.scope === undefined ? undefined : scopeOf(report.scope);
    if (scope?.kind === 'owner') { assertContentFreeReport(report); return undefined; }
    const owner = scope?.kind === 'workspace' ? scope.workspaceId : typeof report.workspaceId === 'string' ? report.workspaceId : known;
    if (!owner) assertContentFreeReport(report);
    return owner;
  };
  const cursors = value.cursors.filter(cursor => {
    if (!object(cursor) || !matches(cursor.workspaceId, IDENTITY)) invalid();
    const scope = cursor.memoryScope === undefined ? undefined : scopeOf(cursor.memoryScope);
    return scope?.kind === 'owner' || (scope?.kind === 'workspace' ? scope.workspaceId : cursor.workspaceId) !== request.workspaceId;
  });
  const reports = value.reports.filter(report => reportOwner(report) !== request.workspaceId);
  const next: ObjectValue = { ...value, cursors, reports };
  if (value.active !== undefined && reportOwner(value.active) === request.workspaceId) delete next.active;
  return next;
}

async function perform(ctx: CleanupContext, request: WorkspaceArtifactCleanupRequest): Promise<void> {
  if (!matches(request.workspaceId, WORKSPACE) || !matches(request.deletionId, DELETION) || !timestamp(request.deletedAt)
    || !['trash', 'permanent'].includes(request.mode) || typeof request.assertCurrent !== 'function') invalid();
  await request.assertCurrent();
  let state: RewindDirectory | undefined, root: RewindDirectory | undefined;
  try {
    try { state = await RewindDirectory.open(path.resolve(ctx.config.stateDir)); root = await state.child('memories'); }
    catch (error) { if (isErrno(error, 'ENOENT')) { await state?.check(); await request.assertCurrent(); return; } throw error; }
    const tree = new MemoryTree(root, { entries: 0, bytes: 0, deadline: Date.now() + LIMITS.milliseconds });
    await tree.assertNoPendingRootWrites();
    const name = receiptName(request), saved = await tree.read(name, LIMITS.receiptBytes);
    let receipt = saved ? parseReceipt(ctx, saved, request) : undefined, proof = saved?.snapshot;
    const found = await inventory(tree, request, receipt);
    const startup = await tree.read('startup.json');
    if (startup) startupProjection(startup.value, request, found.threads); // preflight shared metadata before removing any source
    if (receipt) {
      const known = new Map(receipt.entries.map(entry => [entry.path, entry]));
      for (const entry of found.owned.values()) {
        const previous = known.get(entry.path);
        if (!previous || previous.sha256 !== entry.sha256 || previous.bytes !== entry.bytes) changed();
      }
    } else if (found.owned.size || found.retiredMemories.size) {
      receipt = { format: 'native-memory-workspace-cleanup-v1', version: 1, workspaceId: request.workspaceId,
        deletionId: request.deletionId, deletedAt: request.deletedAt, mode: request.mode,
        threads: [...found.threads].filter(([, owner]) => owner === request.workspaceId).map(([id]) => id).sort(),
        retiredMemories: [...found.retiredMemories].sort(),
        entries: [...found.owned.values()].map(({ path: relative, sha256, bytes }) => ({ path: relative, sha256, bytes })).sort((a, b) => a.path.localeCompare(b.path)) };
      proof = await tree.replaceRoot(name, { version: 1, value: receipt, signature: sign(ctx, receipt) }, undefined, request, LIMITS.receiptBytes);
    }
    if (receipt && proof) {
      // Keep the signed, content-free manifest after completion. If a crash or
      // another cleanup stage has already removed a parent, exact edit ownership
      // still survives. Changed bytes never become newly authorized on retry.
      for (const entry of receipt.entries) await tree.verify(entry, found.owned.get(entry.path));
      // The original A source may remain alive after editor B is purged. A
      // durable negative marker must precede removing the complete edit chain,
      // so an old native-mount view cannot restore the previous A text.
      const retired = receipt.retiredMemories ?? receipt.entries.filter(entry => entry.path.startsWith('records/'))
        .map(entry => path.posix.basename(entry.path).slice(0, -5));
      for (const id of retired) {
        await request.assertCurrent();
        const markerName = `retired-${id}.json`, marker = await tree.read(markerName, 4096);
        if (marker) {
          if (marker.value.format !== 'native-memory-retired-record-v1' || marker.value.id !== id
            || !matches(marker.value.workspaceId, WORKSPACE) || !matches(marker.value.deletionId, DELETION) || !timestamp(marker.value.deletedAt)) invalid();
        } else await tree.replaceRoot(markerName, { format: 'native-memory-retired-record-v1', id,
          workspaceId: request.workspaceId, deletionId: request.deletionId, deletedAt: request.deletedAt }, undefined, request, 4096);
      }
      for (const namespace of ['edits', 'consolidation-artifacts', 'records', 'consolidation-manifests', 'consolidation-heads', 'jobs', 'consolidation-jobs']) {
        await request.assertCurrent();
        const current = await tree.read(name, LIMITS.receiptBytes);
        if (!current || current.snapshot.sha256 !== proof.sha256 || current.snapshot.fingerprint !== proof.fingerprint) changed();
        for (const entry of receipt.entries) if (entry.path.startsWith(`${namespace}/`)) await tree.remove(entry, request, found.owned.get(entry.path));
      }
    }
    await request.assertCurrent();
    const currentStartup = await tree.read('startup.json');
    if (currentStartup) {
      const next = startupProjection(currentStartup.value, request, found.threads);
      if (JSON.stringify(next) !== JSON.stringify(currentStartup.value)) await tree.replaceRoot('startup.json', next, currentStartup.snapshot, request, LIMITS.fileBytes);
    }
    // A completed removal must not silently omit an entry published during the
    // inspection/deletion passes. Never expand the signed authority to such a
    // later write; preserve it and leave the lifecycle journal retryable.
    await request.assertCurrent(); await tree.assertNoPendingRootWrites();
    const remaining = await inventory(tree, request, receipt);
    if (remaining.owned.size) changed();
    const finalStartup = await tree.read('startup.json');
    if (finalStartup && JSON.stringify(startupProjection(finalStartup.value, request, remaining.threads)) !== JSON.stringify(finalStartup.value)) changed();
    await request.assertCurrent(); await root.check(); await state.check();
  } catch (error) {
    if (error instanceof HttpError) { if (error.code?.startsWith('FILE_REWIND_')) unsafe(); throw error; }
    throw new HttpError(503, 'Saved memory cleanup could not finish reading or removing its owned files. Remaining files were retained for retry.', 'MEMORY_WORKSPACE_CLEANUP_IO');
  } finally { await root?.close(); await state?.close(); }
}

/** Called only for a confirmed permanent purge, while the caller holds the
 * existing workspace-removal gate and has fenced/drained live memory writers.
 * No agent, workspace, memory-service recovery or provider is initialized here.
 * Content-free settings, invalidations, barriers and spending receipts survive. */
export function cleanupWorkspaceMemoryFiles(ctx: CleanupContext, request: WorkspaceArtifactCleanupRequest): Promise<void> {
  const key = path.resolve(ctx.config.stateDir), previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => perform(ctx, request));
  const tail = next.catch(() => undefined); queues.set(key, tail);
  return next.finally(() => { if (queues.get(key) === tail) queues.delete(key); });
}
