import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { deflate, inflate } from 'node:zlib';
import { promisify } from 'node:util';
import type { AppContext } from '../context';
import { HttpError } from '../errors';
import { CheckpointDirectory, digest, limit, missing, readRegular, relativePath, unsafe, writeExclusive } from './filesystem';
import type { GitCheckpointCaptureInput, GitCheckpointLimits, GitCheckpointManifest, GitCheckpointReference } from './types';
import { isGitCheckpointRepository } from './identity-contract';

const compress = promisify(deflate);
const decompress = promisify(inflate);
const OID = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
export const CHECKPOINT_LIMITS: Readonly<GitCheckpointLimits> = Object.freeze({ files: 5_000, fileBytes: 16 * 1024 * 1024,
  totalBytes: 128 * 1024 * 1024, indexBytes: 8 * 1024 * 1024, metadataBytes: 8 * 1024 * 1024,
  milliseconds: 120_000, retainedCheckpoints: 256, retainedBytes: 2 * 1024 * 1024 * 1024 });
export const CHECKPOINT_LIMITATIONS = Object.freeze([
  'Git-ignored files and empty directories are outside this checkpoint. Existing tracked files remain included even if ignored.',
  'Branches, commits, remote references, repository configuration and hooks are never rewound.',
]);
export function checkedId(value: string): string { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) unsafe(); return value; }
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function manifestHash(manifest: Omit<GitCheckpointManifest, 'manifestHash'> | GitCheckpointManifest): string {
  const { manifestHash: _ignored, ...value } = manifest as GitCheckpointManifest;
  return digest(canonicalJson(value));
}
export function checkpointReference(manifest: GitCheckpointManifest): GitCheckpointReference {
  const { version, id, workspaceId, threadId, turnId, phase, createdAt, manifestHash: hash } = manifest;
  return { version, id, workspaceId, threadId, turnId, phase, createdAt, manifestHash: hash };
}
function invalid(): never { throw new HttpError(409, 'The saved Git checkpoint is unavailable, incomplete or failed verification. No files were changed.', 'CHECKPOINT_INVALID'); }
function gitObject(type: string, bytes: Buffer): Buffer { return Buffer.concat([Buffer.from(`${type} ${bytes.length}\0`), bytes]); }
export function gitObjectId(type: string, bytes: Buffer, format: 'sha1' | 'sha256' = 'sha1'): string { return createHash(format).update(gitObject(type, bytes)).digest('hex'); }

interface CaptureOwner { version: 1; kind: 'git-checkpoint'; id: string; workspaceId: string; threadId: string; turnId: string; phase: 'before' | 'after' | 'backup'; createdAt: string }
interface Signed<T> { value: T; authentication: string }
interface DeletionIntent { version: 1; kind: 'git-checkpoint-deletion'; owner: CaptureOwner }
interface CheckpointRecord { id: string; directory: boolean; intent: DeletionIntent | null }
const CHECKPOINT_ID = /^gcp_[a-f0-9]{32}$/;
const DELETION_FILE = /^\.delete-(gcp_[a-f0-9]{32})\.json$/;
const deletionName = (id: string): string => `.delete-${id}.json`;
export class CheckpointStore {
  private readonly signingKey: Buffer;
  constructor(private readonly ctx: Pick<AppContext, 'config'>, readonly limits: GitCheckpointLimits) {
    this.signingKey = createHmac('sha256', ctx.config.encryptionKey).update('codex-workspace/git-checkpoints/v1').digest();
  }
  private sign<T>(value: T): Signed<T> { return { value, authentication: createHmac('sha256', this.signingKey).update(canonicalJson(value)).digest('hex') }; }
  private verify<T>(value: unknown): T {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
    const record = value as Signed<T>;
    if (!record.value || typeof record.authentication !== 'string' || !HASH.test(record.authentication)) invalid();
    const expected = this.sign(record.value).authentication;
    if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(record.authentication, 'hex'))) invalid();
    return record.value;
  }
  private async ownedChild(parent: CheckpointDirectory, name: string, owner: object, create: boolean): Promise<CheckpointDirectory> {
    await parent.check();
    let created = false;
    if (create) {
      try { await fs.mkdir(`${parent.access}/${name}`, { mode: 0o700 }); created = true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    const child = await parent.child(name);
    try {
      if (created) await writeExclusive(child, 'owner.json', canonicalJson(this.sign(owner)));
      const bytes = await readRegular(child, 'owner.json', 4096);
      if (!bytes || canonicalJson(this.verify(JSON.parse(bytes.toString('utf8')))) !== canonicalJson(owner)) invalid();
      return child;
    } catch (error) { await child.close(); throw error; }
  }
  async workspace(workspaceId: string, create = false): Promise<CheckpointDirectory> {
    checkedId(workspaceId);
    const { stateDir, dataDir, workspacesDir } = this.ctx.config;
    if (!stateDir.startsWith(`${dataDir}/`) || stateDir === workspacesDir || stateDir.startsWith(`${workspacesDir}/`)) unsafe();
    const state = await CheckpointDirectory.absolute(stateDir, create);
    let base: CheckpointDirectory | undefined;
    try {
      base = await this.ownedChild(state, 'git-checkpoints-v1', { version: 1, kind: 'git-checkpoints' }, create);
      return await this.ownedChild(base, workspaceId, { version: 1, kind: 'git-checkpoint-workspace', workspaceId }, create);
    } finally { await base?.close(); await state.close(); }
  }
  async create(input: GitCheckpointCaptureInput): Promise<{ directory: CheckpointDirectory; owner: CaptureOwner }> {
    const workspace = await this.workspace(input.workspaceId, true);
    try {
      const records = await this.records(workspace, input.workspaceId);
      if (records.length >= this.limits.retainedCheckpoints) throw new HttpError(413, 'This workspace has reached its retained checkpoint limit. Existing snapshots were preserved.', 'CHECKPOINT_RETENTION_LIMIT');
      let bytes = 0;
      for (const record of records) {
        if (record.intent) bytes += 4096;
        if (!record.directory) continue;
        const child = await workspace.child(record.id);
        try {
          const observed = await this.inspectOwner(child, input.workspaceId, record.id, record.intent);
          if (record.intent) {
            // Partial deletion can remove the manifest first. Reserve the bounded
            // writer/manifest maximum until this intent is explicitly resumed.
            if (observed.present) bytes += this.limits.totalBytes * 2 + this.limits.metadataBytes * 2 + 4096;
            continue;
          }
          const manifest = await readRegular(child, 'manifest.json', this.limits.metadataBytes);
          if (!manifest) bytes += this.limits.totalBytes + this.limits.indexBytes;
          else {
            const stored = this.verify<GitCheckpointManifest>(JSON.parse(manifest.toString('utf8')));
            this.validateManifest(stored);
            if (['id', 'workspaceId', 'threadId', 'turnId', 'phase', 'createdAt'].some(key => observed.owner[key as keyof CaptureOwner] !== stored[key as keyof GitCheckpointManifest])) invalid();
            bytes += stored.storedBytes + manifest.length;
          }
        } finally { await child.close(); }
      }
      if (bytes + this.limits.totalBytes + this.limits.indexBytes > this.limits.retainedBytes) {
        throw new HttpError(413, 'This workspace has reached its durable checkpoint storage budget. Existing snapshots were preserved.', 'CHECKPOINT_RETENTION_LIMIT');
      }
      const owner: CaptureOwner = { version: 1, kind: 'git-checkpoint', id: `gcp_${randomUUID().replaceAll('-', '')}`,
        workspaceId: checkedId(input.workspaceId), threadId: checkedId(input.threadId), turnId: checkedId(input.turnId),
        phase: input.phase ?? 'before', createdAt: new Date().toISOString() };
      if (!['before', 'after', 'backup'].includes(owner.phase)) invalid();
      await fs.mkdir(`${workspace.access}/${owner.id}`, { mode: 0o700 });
      const directory = await workspace.child(owner.id);
      try { await writeExclusive(directory, 'owner.json', canonicalJson(this.sign(owner))); return { directory, owner }; }
      catch (error) { await directory.close(); throw error; }
    } finally { await workspace.close(); }
  }
  async publish(directory: CheckpointDirectory, manifest: GitCheckpointManifest): Promise<void> {
    this.validateManifest(manifest);
    const bytes = Buffer.from(canonicalJson(this.sign(manifest)));
    if (bytes.length > this.limits.metadataBytes) limit();
    await writeExclusive(directory, 'manifest.json', bytes);
    const again = await readRegular(directory, 'manifest.json', this.limits.metadataBytes);
    if (!again || !again.equals(bytes)) invalid();
  }
  private validateManifest(value: GitCheckpointManifest): void {
    if (!value || value.version !== 1 || !/^gcp_[a-f0-9]{32}$/.test(value.id) || !HASH.test(value.manifestHash)
      || manifestHash(value) !== value.manifestHash || !OID.test(value.commit) || !OID.test(value.tree)
      || !Array.isArray(value.files) || value.files.length > this.limits.files || !value.index || !Array.isArray(value.index.entries)
      || value.index.entries.length > this.limits.files * 3 || !Array.isArray(value.limitations)
      || !Number.isSafeInteger(value.contentBytes) || value.contentBytes < 0 || value.contentBytes > this.limits.totalBytes
      || !Number.isSafeInteger(value.storedBytes) || value.storedBytes < 0 || value.storedBytes > this.limits.totalBytes * 2 + this.limits.metadataBytes
      || !['before', 'after', 'backup'].includes(value.phase) || !Number.isFinite(Date.parse(value.createdAt))) invalid();
    checkedId(value.workspaceId); checkedId(value.threadId); checkedId(value.turnId);
    const paths = new Set<string>();
    for (const file of value.files) {
      relativePath(file.path);
      if (paths.has(file.path)) invalid(); paths.add(file.path);
      if (!['file', 'symlink', 'missing'].includes(file.kind) || !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777
        || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > this.limits.fileBytes || typeof file.tracked !== 'boolean') invalid();
      if (file.kind === 'missing' ? file.blob !== null || file.sha256 !== null || file.bytes !== 0 || file.mode !== 0
        : !OID.test(file.blob ?? '') || !HASH.test(file.sha256 ?? '')) invalid();
    }
    const index = value.index;
    if (typeof index.present !== 'boolean' || !Number.isSafeInteger(index.bytes) || index.bytes < 0 || index.bytes > this.limits.indexBytes
      || (index.present ? !OID.test(index.blob ?? '') || !HASH.test(index.sha256 ?? '') : index.blob !== null || index.sha256 !== null || index.bytes !== 0 || index.entries.length !== 0)) invalid();
    const sourceOid = value.repository?.objectFormat === 'sha256' ? /^[a-f0-9]{64}$/ : /^[a-f0-9]{40}$/;
    if (!isGitCheckpointRepository(value.repository) || value.repository.generation.workspaceId !== value.workspaceId) invalid();
    for (const item of index.entries) {
      relativePath(item.path);
      if (!['100644', '100755', '120000'].includes(item.mode) || ![0, 1, 2, 3].includes(item.stage)
        || !sourceOid.test(item.objectId) || item.blob !== null && !OID.test(item.blob)) invalid();
    }
  }
  async open(reference: GitCheckpointReference): Promise<{ directory: CheckpointDirectory; manifest: GitCheckpointManifest }> {
    checkedId(reference.workspaceId); checkedId(reference.threadId); checkedId(reference.turnId);
    if (reference.version !== 1 || !/^gcp_[a-f0-9]{32}$/.test(reference.id) || !HASH.test(reference.manifestHash)) invalid();
    const workspace = await this.workspace(reference.workspaceId).catch(error => { if (missing(error)) invalid(); throw error; });
    let directory: CheckpointDirectory | undefined;
    try {
      await this.rejectDeleting(workspace, reference.workspaceId, reference.id);
      directory = await workspace.child(reference.id);
      const ownerBytes = await readRegular(directory, 'owner.json', 4096);
      const bytes = await readRegular(directory, 'manifest.json', this.limits.metadataBytes);
      if (!bytes || !ownerBytes) invalid();
      const owner = this.verify<CaptureOwner>(JSON.parse(ownerBytes.toString('utf8')));
      const manifest = this.verify<GitCheckpointManifest>(JSON.parse(bytes.toString('utf8')));
      this.validateManifest(manifest);
      if (canonicalJson(checkpointReference(manifest)) !== canonicalJson(reference)
        || owner.kind !== 'git-checkpoint' || ['id', 'workspaceId', 'threadId', 'turnId', 'phase', 'createdAt'].some(key => owner[key as keyof CaptureOwner] !== manifest[key as keyof GitCheckpointManifest])) invalid();
      const head = await readRegular(directory, 'HEAD', 128), ref = await readRegular(directory, 'refs/codex/checkpoint', 128);
      if (head?.toString('ascii') !== `${manifest.commit}\n` || ref?.toString('ascii') !== `${manifest.commit}\n`) invalid();
      const commit = await this.object(directory, manifest.commit, 'commit', 4096);
      if (!commit.toString('utf8').startsWith(`tree ${manifest.tree}\n`)) invalid();
      await this.object(directory, manifest.tree, 'tree', this.limits.metadataBytes);
      await this.rejectDeleting(workspace, reference.workspaceId, reference.id);
      return { directory, manifest };
    } catch (error) { await directory?.close(); if (missing(error)) invalid(); throw error; }
    finally { await workspace.close(); }
  }
  async blob(directory: CheckpointDirectory, oid: string, maximum: number): Promise<Buffer> {
    return this.object(directory, oid, 'blob', maximum);
  }
  private async object(directory: CheckpointDirectory, oid: string, type: 'blob' | 'tree' | 'commit', maximum: number): Promise<Buffer> {
    if (!OID.test(oid)) invalid();
    const compressed = await readRegular(directory, `objects/${oid.slice(0, 2)}/${oid.slice(2)}`, maximum + 1024 * 1024);
    if (!compressed) invalid();
    let object: Buffer;
    try { object = await decompress(compressed, { maxOutputLength: maximum + 64 }); }
    catch { invalid(); }
    if (createHash('sha1').update(object).digest('hex') !== oid) invalid();
    const boundary = object.indexOf(0);
    if (boundary < 0 || boundary > 48) invalid();
    const bytes = object.subarray(boundary + 1);
    if (object.subarray(0, boundary).toString('ascii') !== `${type} ${bytes.length}` || bytes.length > maximum) invalid();
    return bytes;
  }
  private decodeSigned<T>(bytes: Buffer): T {
    try { return this.verify<T>(JSON.parse(bytes.toString('utf8'))); }
    catch { invalid(); }
  }
  private ownerScope(owner: CaptureOwner, workspaceId: string, id: string): CaptureOwner {
    if (!owner || owner.version !== 1 || owner.kind !== 'git-checkpoint' || owner.workspaceId !== workspaceId || owner.id !== id
      || !CHECKPOINT_ID.test(owner.id) || !['before', 'after', 'backup'].includes(owner.phase)
      || typeof owner.createdAt !== 'string' || owner.createdAt.length > 64 || !Number.isFinite(Date.parse(owner.createdAt))) invalid();
    checkedId(owner.workspaceId); checkedId(owner.threadId); checkedId(owner.turnId);
    return owner;
  }
  private async deletionIntent(workspace: CheckpointDirectory, workspaceId: string, id: string): Promise<DeletionIntent | null> {
    const bytes = await readRegular(workspace, deletionName(id), 4096);
    if (!bytes) return null;
    const intent = this.decodeSigned<DeletionIntent>(bytes);
    if (!intent || intent.version !== 1 || intent.kind !== 'git-checkpoint-deletion') invalid();
    this.ownerScope(intent.owner, workspaceId, id);
    return intent;
  }
  private async rejectDeleting(workspace: CheckpointDirectory, workspaceId: string, id: string): Promise<void> {
    if (await this.deletionIntent(workspace, workspaceId, id)) {
      throw new HttpError(409, 'This Git checkpoint is being deleted and cannot be read or restored.', 'CHECKPOINT_DELETING');
    }
  }
  /** A directory and its authenticated deletion intent consume one record slot. */
  private async records(workspace: CheckpointDirectory, workspaceId: string): Promise<CheckpointRecord[]> {
    const records = new Map<string, CheckpointRecord>(), intents = new Set<string>();
    let count = 0;
    for await (const entry of await fs.opendir(workspace.access, { bufferSize: 16 })) {
      if (entry.name === 'owner.json') continue;
      if (++count > this.limits.retainedCheckpoints * 2) invalid();
      const match = DELETION_FILE.exec(entry.name), id = match?.[1] ?? entry.name;
      if (!CHECKPOINT_ID.test(id)) invalid();
      if (match ? !entry.isFile() : !entry.isDirectory()) unsafe();
      let record = records.get(id);
      if (!record) {
        if (records.size >= this.limits.retainedCheckpoints) invalid();
        record = { id, directory: false, intent: null }; records.set(id, record);
      }
      if (match) { if (intents.has(id)) invalid(); intents.add(id); }
      else { if (record.directory) invalid(); record.directory = true; }
    }
    for (const id of intents) {
      const intent = await this.deletionIntent(workspace, workspaceId, id);
      if (!intent) invalid();
      records.get(id)!.intent = intent;
    }
    await workspace.check();
    return [...records.values()];
  }
  private async exactChildren(directory: CheckpointDirectory, names: readonly string[]): Promise<void> {
    await directory.check();
    let count = 0;
    for await (const entry of await fs.opendir(directory.access, { bufferSize: 1 })) {
      if (++count > names.length || !names.includes(entry.name)) invalid();
    }
    if (count !== names.length) invalid();
    await directory.check();
  }
  private async inspectOwner(directory: CheckpointDirectory, workspaceId: string, id: string, intent: DeletionIntent | null): Promise<{ owner: CaptureOwner; present: boolean }> {
    const bytes = await readRegular(directory, 'owner.json', 4096);
    if (!bytes) {
      if (!intent) invalid();
      // The external proof authorizes only an empty ownerless directory. Never
      // guess whether remaining payload or unknown files belong to the record.
      await this.exactChildren(directory, []);
      return { owner: intent.owner, present: false };
    }
    const owner = this.ownerScope(this.decodeSigned<CaptureOwner>(bytes), workspaceId, id);
    if (intent && canonicalJson(intent.owner) !== canonicalJson(owner)) invalid();
    return { owner, present: true };
  }
  private async assertIntent(workspace: CheckpointDirectory, intent: DeletionIntent): Promise<void> {
    const actual = await this.deletionIntent(workspace, intent.owner.workspaceId, intent.owner.id);
    if (!actual || canonicalJson(actual) !== canonicalJson(intent)) invalid();
  }
  private async beginDeletion(workspace: CheckpointDirectory, owner: CaptureOwner): Promise<DeletionIntent> {
    const prior = await this.deletionIntent(workspace, owner.workspaceId, owner.id);
    if (prior) {
      if (canonicalJson(prior.owner) !== canonicalJson(owner)) invalid();
      return prior;
    }
    const intent: DeletionIntent = { version: 1, kind: 'git-checkpoint-deletion', owner };
    try { await writeExclusive(workspace, deletionName(owner.id), canonicalJson(this.sign(intent))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    // writeExclusive syncs the proof; verify its durable bytes before deleting
    // any payload, including when an earlier invocation published this intent.
    await this.assertIntent(workspace, intent);
    return intent;
  }
  private async absentRecord(workspace: CheckpointDirectory, id: string): Promise<void> {
    await workspace.check();
    const present = await fs.lstat(`${workspace.access}/${id}`).catch(error => { if (missing(error)) return null; throw error; });
    if (present) invalid();
  }
  private async finishDeletion(workspace: CheckpointDirectory, intent: DeletionIntent): Promise<void> {
    await this.assertIntent(workspace, intent);
    const { owner } = intent;
    const directory = await workspace.child(owner.id).catch(error => { if (missing(error)) return null; throw error; });
    if (directory) {
      try {
        const observed = await this.inspectOwner(directory, owner.workspaceId, owner.id, intent);
        if (observed.present) await this.deleteOwned(workspace, directory, intent);
        await this.exactChildren(directory, []);
        await directory.check(); await workspace.check();
        await fs.rmdir(`${workspace.access}/${owner.id}`);
      } finally { await directory.close(); }
    }
    // A retry after rmdir removes only the signed intent. Keep that proof until
    // absence is verified, including when an unlink/rmdir returned after a crash.
    await this.absentRecord(workspace, owner.id);
    await this.assertIntent(workspace, intent);
    await this.absentRecord(workspace, owner.id);
    await fs.unlink(`${workspace.access}/${deletionName(owner.id)}`);
  }
  async cleanupThread(workspaceId: string, threadId: string, keepTurnIds: ReadonlySet<string> = new Set()): Promise<{ removed: number }> {
    checkedId(threadId);
    return this.cleanup(workspaceId, threadId, keepTurnIds);
  }
  async cleanupWorkspace(workspaceId: string): Promise<{ removed: number }> {
    return this.cleanup(workspaceId);
  }
  private async cleanup(workspaceId: string, threadId?: string, keepTurnIds: ReadonlySet<string> = new Set()): Promise<{ removed: number }> {
    const workspace = await this.workspace(workspaceId).catch(error => { if (missing(error)) return null; throw error; });
    if (!workspace) return { removed: 0 };
    let removed = 0;
    try {
      const selected: CaptureOwner[] = [];
      // Authenticate every listed proof and ownership scope before mutating any
      // selected record. Other threads and retained turns are never resumed.
      for (const record of await this.records(workspace, workspaceId)) {
        let owner = record.intent?.owner;
        if (record.directory) {
          const directory = await workspace.child(record.id);
          try { owner = (await this.inspectOwner(directory, workspaceId, record.id, record.intent)).owner; }
          finally { await directory.close(); }
        }
        if (!owner) invalid();
        if (threadId !== undefined && owner.threadId !== threadId || keepTurnIds.has(owner.turnId)) continue;
        selected.push(owner);
      }
      for (const owner of selected) {
        const intent = await this.beginDeletion(workspace, owner);
        await this.finishDeletion(workspace, intent); removed++;
      }
    } finally { await workspace.close(); }
    return { removed };
  }
  async discard(directory: CheckpointDirectory): Promise<void> {
    const id = path.basename(directory.absolute), workspaceId = checkedId(path.basename(path.dirname(directory.absolute)));
    if (!CHECKPOINT_ID.test(id)) invalid();
    const workspace = await this.workspace(workspaceId);
    try {
      if (directory.absolute !== path.join(workspace.absolute, id)) invalid();
      let intent = await this.deletionIntent(workspace, workspaceId, id);
      if (!intent) {
        const current = await workspace.child(id).catch(error => { if (missing(error)) return null; throw error; });
        if (!current) return;
        try { intent = await this.beginDeletion(workspace, (await this.inspectOwner(current, workspaceId, id, null)).owner); }
        finally { await current.close(); }
      }
      await this.finishDeletion(workspace, intent);
    } finally { await workspace.close(); }
  }
  private async deleteOwned(workspace: CheckpointDirectory, directory: CheckpointDirectory, intent: DeletionIntent): Promise<void> {
    const files: string[] = [], directories: string[] = [];
    let count = 0;
    const walk = async (current: CheckpointDirectory, prefix: string) => {
      for await (const item of await fs.opendir(current.access, { bufferSize: 16 })) {
        const relative = prefix ? `${prefix}/${item.name}` : item.name;
        if (++count > this.limits.files * 5 + 1024 || relative.split('/').length > 5) invalid();
        if (item.isDirectory()) {
          if (!/^(?:objects(?:\/[a-f0-9]{2})?|refs(?:\/codex)?)$/.test(relative)) invalid();
          const child = await current.child(item.name);
          try { await walk(child, relative); directories.push(relative); }
          finally { await child.close(); }
        } else if (item.isFile()) {
          if (!/^(?:owner\.json|manifest\.json|HEAD|config|objects\/[a-f0-9]{2}\/[a-f0-9]{38}|refs\/codex\/checkpoint)$/.test(relative)) invalid();
          const stat = await fs.lstat(`${current.access}/${item.name}`);
          if (!stat.isFile() || stat.nlink !== 1) unsafe();
          files.push(relative);
        } else unsafe();
      }
    };
    await walk(directory, '');
    await this.assertIntent(workspace, intent);
    if (!(await this.inspectOwner(directory, intent.owner.workspaceId, intent.owner.id, intent)).present) invalid();
    // Keep both proofs until all other owned payload and directories are gone.
    for (const relative of files.filter(file => file !== 'owner.json')) await directory.withParent(relative, false, async (parent, name) => {
      await parent.check();
      const stat = await fs.lstat(`${parent.access}/${name}`);
      if (!stat.isFile() || stat.nlink !== 1) unsafe();
      await fs.unlink(`${parent.access}/${name}`);
    });
    for (const relative of directories) await directory.withParent(relative, false, async (parent, name) => { await parent.check(); await fs.rmdir(`${parent.access}/${name}`); });
    await this.exactChildren(directory, ['owner.json']);
    await this.assertIntent(workspace, intent);
    if (!(await this.inspectOwner(directory, intent.owner.workspaceId, intent.owner.id, intent)).present) invalid();
    await fs.unlink(`${directory.access}/owner.json`);
  }
}

export class GitObjectWriter {
  storedBytes = 0;
  private readonly written = new Set<string>();
  constructor(private readonly directory: CheckpointDirectory, private readonly maximum: number,
    readonly maximumObjects = CHECKPOINT_LIMITS.files * 4 + 256,
    private readonly control: { deadline?: number; signal?: AbortSignal } = {}) {}
  check(): void {
    this.control.signal?.throwIfAborted();
    if (this.control.deadline !== undefined && Date.now() > this.control.deadline) {
      throw new HttpError(504, 'Checkpoint capture reached its bounded time limit. Existing files were preserved.', 'CHECKPOINT_TIMEOUT');
    }
  }
  async write(type: 'blob' | 'tree' | 'commit', bytes: Buffer): Promise<string> {
    this.check();
    const object = gitObject(type, bytes), oid = createHash('sha1').update(object).digest('hex');
    if (this.written.has(oid)) return oid;
    if (this.written.size >= this.maximumObjects) limit();
    const packed = await compress(object);
    this.check();
    if (this.storedBytes + packed.length > this.maximum) limit();
    await writeExclusive(this.directory, `objects/${oid.slice(0, 2)}/${oid.slice(2)}`, packed);
    const reread = await readRegular(this.directory, `objects/${oid.slice(0, 2)}/${oid.slice(2)}`, packed.length);
    if (!reread || !reread.equals(packed)) invalid();
    this.check();
    this.storedBytes += packed.length; this.written.add(oid); return oid;
  }
  async finish(tree: string, createdAt: string): Promise<{ commit: string; storedBytes: number }> {
    this.check();
    const seconds = Math.floor(Date.parse(createdAt) / 1000);
    const author = `Arc Workspace <checkpoint@localhost> ${seconds} +0000`;
    const commit = await this.write('commit', Buffer.from(`tree ${tree}\nauthor ${author}\ncommitter ${author}\n\nWorkspace file checkpoint\n`));
    const config = '[core]\n\trepositoryformatversion = 0\n\tbare = true\n\tlogallrefupdates = false\n';
    await writeExclusive(this.directory, 'config', config);
    // Native Git requires a symbolic HEAD to name refs/heads/*. This isolated
    // immutable repository instead uses a valid detached HEAD, with the owned
    // application ref retaining the same commit independently of HEAD.
    await writeExclusive(this.directory, 'HEAD', `${commit}\n`);
    await writeExclusive(this.directory, 'refs/codex/checkpoint', `${commit}\n`);
    this.check();
    return { commit, storedBytes: this.storedBytes + Buffer.byteLength(config) + 96 };
  }
}

export async function writeTree(writer: GitObjectWriter, entries: Array<{ path: string; mode: string; oid: string }>): Promise<string> {
  interface Tree { files: Map<string, { mode: string; oid: string }>; children: Map<string, Tree> }
  const root: Tree = { files: new Map(), children: new Map() };
  let nodes = 1;
  for (const item of entries) {
    writer.check();
    relativePath(item.path);
    let node = root;
    const parts = item.path.split('/');
    for (const name of parts.slice(0, -1)) {
      if (node.files.has(name)) invalid();
      if (!node.children.has(name)) {
        if (++nodes > writer.maximumObjects) limit();
        node.children.set(name, { files: new Map(), children: new Map() });
      }
      node = node.children.get(name)!;
    }
    const name = parts.at(-1)!;
    if (node.children.has(name) || node.files.has(name) || !OID.test(item.oid)) invalid();
    node.files.set(name, { mode: item.mode, oid: item.oid });
  }
  const write = async (node: Tree): Promise<string> => {
    writer.check();
    const children = [...node.files].map(([name, item]) => ({ name, ...item }));
    for (const [name, child] of node.children) children.push({ name, mode: '40000', oid: await write(child) });
    children.sort((a, b) => Buffer.compare(Buffer.from(a.name + (a.mode === '40000' ? '/' : '')), Buffer.from(b.name + (b.mode === '40000' ? '/' : ''))));
    return writer.write('tree', Buffer.concat(children.map(item => Buffer.concat([Buffer.from(`${item.mode} ${item.name}\0`), Buffer.from(item.oid, 'hex')]))));
  };
  return write(root);
}
