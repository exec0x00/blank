import { randomUUID } from 'node:crypto';
import { constants, type BigIntStats, type Stats } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { AppContext } from '../context';
import type { DownloadSource } from '../downloads/snapshot';
import { HttpError } from '../errors';
import { FILE_ATTACHMENT_LIMITS, type FileAttachment, type FileAttachmentReference } from './types';
import {
  assertConversationWorkspaceUnfenced, conversationFileScope, conversationWorkspaceDeleted,
  conversationWorkspaceIsFenced, fenceConversationWorkspace, registerConversationFileParticipant,
  withConversationStorageOperation,
} from './coordination';
import {
  FILE_ATTACHMENT_HASH, FILE_ATTACHMENT_ID, WORKSPACE_ID, attachmentChanged, attachmentExpired,
  attachmentHash, attachmentMissing, attachmentUnsafe, fileAttachmentMime, fileAttachmentName,
  fileAttachmentReferencesSchema, parseFileInput, validDate,
} from './validation';

const KIND = 'codex-conversation-file-v1';
const DELETION_KIND = 'codex-conversation-file-workspace-deleted-v1';
export const CONVERSATION_FILE_DIRECTORY = 'conversation-files-v1';
const MAX_RECORD_BYTES = 8192;
const MAX_SCAN_RECORDS = 50_000;
const errno = (error: unknown, code: string): boolean => (error as NodeJS.ErrnoException | undefined)?.code === code;
const within = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const sameFile = (a: Stats, b: Stats): boolean => a.isFile() && b.isFile() && a.dev === b.dev && a.ino === b.ino
  && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
const sameBigFile = (a: BigIntStats, b: BigIntStats): boolean => a.isFile() && b.isFile() && a.dev === b.dev && a.ino === b.ino
  && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
const sameDirectory = (a: Stats, b: Stats): boolean => b.isDirectory() && !b.isSymbolicLink() && a.dev === b.dev && a.ino === b.ino;

interface Directory { handle: FileHandle; location: string; stat: Stats }
interface FileRecord extends FileAttachment { kind: typeof KIND; state: 'uploading' | 'ready'; retainedAt?: string }
interface LoadedRecord { value: FileRecord; serialized: string }
interface DeletionFence { kind: typeof DELETION_KIND; version: 1; workspaceId: string }
interface CleanupLeaf { name: string; stat: Stats; digest: string; maximum: number }
export interface ConversationFileCleanupOptions { assertCurrent?: () => Promise<void> }
export interface ConversationFileStateDirectory {
  access: string;
  location: string;
  assertStable(): Promise<void>;
}
export interface FileCommitInput extends FileAttachment { bytes: number }

function expose(record: FileRecord): FileAttachment {
  return { id: record.id, workspaceId: record.workspaceId, name: record.name, mimeType: record.mimeType,
    bytes: record.bytes, sha256: record.sha256, createdAt: record.createdAt };
}

/** Durable originals only. Reading never launches a parser or executes user content. */
export class ConversationFileStorage {
  private root?: Directory;
  private initialization?: Promise<void>;
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly sources = new Map<string, Set<DownloadSource>>();
  private readonly scope: string;
  private readonly unregister: () => void;
  private closing = false;

  constructor(private readonly ctx: AppContext, private readonly now: () => number = Date.now) {
    this.scope = conversationFileScope(ctx.config.stateDir);
    this.unregister = registerConversationFileParticipant(this.scope, {
      fence: workspaceId => { for (const source of this.sources.get(workspaceId) ?? []) void source.close(); },
      drain: async workspaceId => {
        await this.queues.get(attachmentHash(workspaceId))?.catch(() => undefined);
        await Promise.allSettled([...(this.sources.get(workspaceId) ?? [])].map(source => source.close()));
      },
    });
  }

  initialize(): Promise<void> {
    if (this.closing) return Promise.reject(new HttpError(503, 'File attachment storage is closing.', 'FILE_ATTACHMENTS_CLOSING'));
    this.initialization ??= this.openRoot().then(root => { this.root = root; });
    return this.initialization;
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    await this.initialization?.catch(() => undefined);
    await Promise.allSettled([...this.queues.values()]);
    await Promise.allSettled([...this.sources.values()].flatMap(sources => [...sources].map(source => source.close())));
    await this.root?.handle.close();
    this.root = undefined;
    this.unregister();
  }

  private entry(directory: Directory, name: string): string {
    if (process.platform !== 'linux') throw new HttpError(503, 'Secure file attachments require this Space’s Linux host.', 'FILE_ATTACHMENT_HOST_UNSUPPORTED');
    return `/proc/self/fd/${directory.handle.fd}/${name}`;
  }

  private async check(directory: Directory): Promise<void> {
    try {
      if (!sameDirectory(directory.stat, await fs.lstat(directory.location))
        || await fs.realpath(`/proc/self/fd/${directory.handle.fd}`) !== directory.location
        || await fs.realpath(directory.location) !== directory.location) throw attachmentUnsafe();
    } catch (error) { if (error instanceof HttpError) throw error; throw attachmentUnsafe(); }
  }

  private async child(parent: Directory, name: string, create: boolean): Promise<Directory> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) || name === '.' || name === '..') throw attachmentUnsafe();
    await this.check(parent);
    let handle: FileHandle | undefined;
    try {
      if (create) await fs.mkdir(this.entry(parent, name), { mode: 0o700 }).catch(error => { if (!errno(error, 'EEXIST')) throw error; });
      handle = await fs.open(this.entry(parent, name), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      const directory = { handle, location: path.join(parent.location, name), stat: await handle.stat() };
      await this.check(parent); await this.check(directory);
      return directory;
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (errno(error, 'ELOOP') || errno(error, 'ENOTDIR')) throw attachmentUnsafe();
      throw error;
    }
  }

  private async openRoot(): Promise<Directory> {
    const data = path.resolve(this.ctx.config.dataDir), state = path.resolve(this.ctx.config.stateDir);
    if (!within(data, state)) throw attachmentUnsafe();
    const canonical = await fs.realpath(data);
    let directory: Directory | undefined;
    try {
      const handle = await fs.open(canonical, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      directory = { handle, location: canonical, stat: await handle.stat() };
      await this.check(directory);
      for (const segment of [...path.relative(data, state).split(path.sep).filter(Boolean), CONVERSATION_FILE_DIRECTORY]) {
        const next = await this.child(directory, segment, true);
        await directory.handle.close(); directory = next;
      }
      return directory;
    } catch (error) { await directory?.handle.close().catch(() => undefined); throw error; }
  }

  private deletionName(workspaceId: string): string {
    if (typeof workspaceId !== 'string' || !WORKSPACE_ID.test(workspaceId)) throw new HttpError(400, 'Choose a valid workspace.', 'INVALID_FILE_ATTACHMENT_WORKSPACE');
    return `${attachmentHash(workspaceId)}.deleted.json`;
  }

  private async readDeletionFence(workspaceId: string): Promise<DeletionFence | undefined> {
    const name = this.deletionName(workspaceId);
    await this.initialize();
    let bytes: Buffer;
    try { bytes = await this.readBounded(this.root!, name, MAX_RECORD_BYTES); }
    catch (error) {
      if (error instanceof HttpError && error.code === 'FILE_ATTACHMENT_NOT_FOUND') return undefined;
      throw error;
    }
    const value: DeletionFence = { kind: DELETION_KIND, version: 1, workspaceId };
    const expected = Buffer.from(`${JSON.stringify(value)}\n`);
    const stat = await fs.lstat(this.entry(this.root!, name));
    // The create-only, deterministic marker itself is the fence. A process can
    // stop during its first write: an exact prefix still fences and is never
    // truncated, repaired, or removed. Unknown contents and links are preserved.
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || bytes.length > expected.length
      || !bytes.equals(expected.subarray(0, bytes.length))) throw attachmentUnsafe();
    return value;
  }

  /** Cold-start safe: neither this check nor fence creation consults the workspace registry. */
  async isWorkspaceDeleted(workspaceId: string): Promise<boolean> {
    this.deletionName(workspaceId);
    if (conversationWorkspaceIsFenced(this.scope, workspaceId)) return true;
    if (await this.readDeletionFence(workspaceId)) { fenceConversationWorkspace(this.scope, workspaceId); return true; }
    return false;
  }

  async assertWorkspaceAvailable(workspaceId: string): Promise<void> {
    assertConversationWorkspaceUnfenced(this.scope, workspaceId);
    if (await this.isWorkspaceDeleted(workspaceId)) throw conversationWorkspaceDeleted();
    assertConversationWorkspaceUnfenced(this.scope, workspaceId);
  }

  /** Immutable recovery marker. It remains after payload cleanup to reject old saved jobs and callbacks. */
  async fenceWorkspace(workspaceId: string, options: ConversationFileCleanupOptions = {}): Promise<void> {
    const name = this.deletionName(workspaceId);
    await options.assertCurrent?.();
    await this.initialize();
    fenceConversationWorkspace(this.scope, workspaceId);
    if (await this.readDeletionFence(workspaceId)) return;
    const value: DeletionFence = { kind: DELETION_KIND, version: 1, workspaceId };
    await options.assertCurrent?.();
    try { await this.writeExclusive(this.root!, name, `${JSON.stringify(value)}\n`); }
    catch (error) { if (!errno(error, 'EEXIST')) throw error; }
    if (!await this.readDeletionFence(workspaceId)) throw attachmentUnsafe();
  }

  /** Hold the already-validated data-root ancestry through an owned state mutation. */
  async withStateDirectory<T>(operation: (directory: ConversationFileStateDirectory) => Promise<T>): Promise<T> {
    await this.initialize(); await this.check(this.root!);
    const handle = await fs.open(this.entry(this.root!, '..'), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const directory: Directory = { handle, location: path.dirname(this.root!.location), stat: await handle.stat() };
      const assertStable = async () => { await this.check(this.root!); await this.check(directory); };
      await assertStable();
      const result = await operation({ access: `/proc/self/fd/${handle.fd}`, location: directory.location, assertStable });
      await assertStable(); return result;
    } finally { await handle.close(); }
  }

  private serialized<T>(key: string, work: () => Promise<T>): Promise<T> {
    const result = withConversationStorageOperation(this.scope, key, work);
    this.queues.set(key, result);
    void result.finally(() => { if (this.queues.get(key) === result) this.queues.delete(key); }).catch(() => undefined);
    return result;
  }

  private async inWorkspace<T>(workspaceId: string, create: boolean, work: (directory: Directory) => Promise<T>): Promise<T> {
    if (!WORKSPACE_ID.test(workspaceId)) throw attachmentMissing();
    await this.assertWorkspaceAvailable(workspaceId);
    await this.ctx.workspaces.get(workspaceId);
    await this.initialize();
    const key = attachmentHash(workspaceId);
    return this.serialized(key, async () => {
      let directory: Directory | undefined;
      try {
        await this.assertWorkspaceAvailable(workspaceId);
        directory = await this.child(this.root!, key, create);
        const result = await work(directory);
        await this.assertWorkspaceAvailable(workspaceId);
        return result;
      }
      catch (error) { if (errno(error, 'ENOENT')) throw attachmentMissing(); throw error; }
      finally { await directory?.handle.close(); }
    });
  }

  private async readBounded(directory: Directory, name: string, maximum: number): Promise<Buffer> {
    await this.check(directory);
    let handle: FileHandle | undefined;
    try {
      handle = await fs.open(this.entry(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const before = await handle.stat();
      if (!before.isFile() || before.size < 0 || before.size > maximum) throw attachmentChanged();
      const buffer = Buffer.alloc(before.size + 1);
      let total = 0;
      while (total < buffer.length) {
        const { bytesRead } = await handle.read(buffer, total, Math.min(64 * 1024, buffer.length - total), total);
        if (!bytesRead) break;
        total += bytesRead;
      }
      if (total !== before.size || !sameFile(before, await handle.stat())
        || !sameFile(before, await fs.lstat(this.entry(directory, name)))) throw attachmentChanged();
      await this.check(directory);
      return buffer.subarray(0, total);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (errno(error, 'ENOENT')) throw attachmentMissing();
      if (errno(error, 'ELOOP') || errno(error, 'ENOTDIR')) throw attachmentUnsafe();
      throw new HttpError(503, 'This attachment cannot currently be read from storage.', 'FILE_ATTACHMENT_STORAGE_UNAVAILABLE');
    } finally { await handle?.close(); }
  }

  private async record(directory: Directory, id: string, workspaceId?: string): Promise<LoadedRecord> {
    if (!FILE_ATTACHMENT_ID.test(id)) throw attachmentMissing();
    const serialized = (await this.readBounded(directory, `${id}.json`, MAX_RECORD_BYTES)).toString('utf8');
    return this.parseRecord(directory, id, serialized, workspaceId);
  }

  private parseRecord(directory: Directory, id: string, serialized: string, workspaceId?: string): LoadedRecord {
    let value: FileRecord;
    try { value = JSON.parse(serialized) as FileRecord; } catch { throw attachmentChanged(); }
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(key => !['kind', 'id', 'workspaceId', 'name', 'mimeType', 'bytes', 'sha256', 'createdAt', 'state', 'retainedAt'].includes(key))
      || value.kind !== KIND || value.id !== id || typeof value.workspaceId !== 'string' || !WORKSPACE_ID.test(value.workspaceId)
      || attachmentHash(value.workspaceId) !== path.basename(directory.location) || workspaceId !== undefined && value.workspaceId !== workspaceId
      || !FILE_ATTACHMENT_HASH.test(value.sha256) || !Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > FILE_ATTACHMENT_LIMITS.maxBytes
      || !validDate(value.createdAt) || Date.parse(value.createdAt) > this.now() + 60_000 || !['uploading', 'ready'].includes(value.state)
      || value.retainedAt !== undefined && (!validDate(value.retainedAt) || value.state !== 'ready')) throw attachmentChanged();
    try {
      if (fileAttachmentName(value.name) !== value.name || fileAttachmentMime(value.mimeType, value.name) !== value.mimeType) throw attachmentChanged();
    } catch { throw attachmentChanged(); }
    return { value, serialized };
  }

  private async writeExclusive(directory: Directory, name: string, bytes: Buffer | string, mode = 0o600): Promise<void> {
    await this.check(directory);
    const handle = await fs.open(this.entry(directory, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
    try { await handle.writeFile(bytes); await handle.sync(); await this.check(directory); }
    finally { await handle.close(); }
  }

  private async update(directory: Directory, previous: LoadedRecord, value: FileRecord): Promise<void> {
    await this.assertWorkspaceAvailable(value.workspaceId);
    const name = `${value.id}.${randomUUID().replaceAll('-', '')}.meta.tmp`;
    await this.writeExclusive(directory, name, `${JSON.stringify(value)}\n`);
    try {
      if ((await this.record(directory, value.id, value.workspaceId)).serialized !== previous.serialized) throw attachmentChanged();
      await this.assertWorkspaceAvailable(value.workspaceId);
      await this.check(directory);
      await fs.rename(this.entry(directory, name), this.entry(directory, `${value.id}.json`));
      const current = await this.record(directory, value.id, value.workspaceId);
      if (current.serialized !== `${JSON.stringify(value)}\n`) throw attachmentChanged();
    } finally { await fs.unlink(this.entry(directory, name)).catch(error => { if (!errno(error, 'ENOENT')) throw error; }); }
  }

  private expired(value: FileRecord): boolean {
    return !value.retainedAt && Date.parse(value.createdAt) + FILE_ATTACHMENT_LIMITS.draftLifetimeMs <= this.now();
  }

  private async bytes(directory: Directory, value: FileRecord, allowUploading = false): Promise<Buffer> {
    if (value.state !== 'ready' && !allowUploading) throw new HttpError(409, 'This file has not finished saving.', 'FILE_ATTACHMENT_NOT_READY');
    if (this.expired(value)) throw attachmentExpired();
    const bytes = await this.readBounded(directory, `${value.id}.file`, FILE_ATTACHMENT_LIMITS.maxBytes);
    if (bytes.length !== value.bytes || attachmentHash(bytes) !== value.sha256) throw attachmentChanged();
    return bytes;
  }

  private async remove(directory: Directory, id: string): Promise<void> {
    if (!FILE_ATTACHMENT_ID.test(id)) throw attachmentUnsafe();
    await this.check(directory);
    for (const suffix of ['.file', '.json']) {
      // Generated leaf names only; unlink neither follows links nor removes folders recursively.
      await fs.unlink(this.entry(directory, `${id}${suffix}`)).catch(error => { if (!errno(error, 'ENOENT')) throw error; });
    }
  }

  private async countDrafts(directory: Directory): Promise<{ count: number; bytes: number }> {
    let count = 0, bytes = 0, scanned = 0;
    await this.check(directory);
    for await (const entry of await fs.opendir(this.entry(directory, '.'))) {
      if (++scanned > MAX_SCAN_RECORDS) throw new HttpError(429, 'Attachment storage needs maintenance before more files can be added.', 'FILE_ATTACHMENT_SCAN_LIMIT');
      if (!/^file_[a-f0-9]{32}\.json$/.test(entry.name)) continue;
      try {
        const { value } = await this.record(directory, entry.name.slice(0, -5));
        if (value.retainedAt) continue;
        if (this.expired(value)) { await this.remove(directory, value.id); continue; }
        count++; bytes += value.bytes;
      } catch (error) {
        if (error instanceof HttpError && error.code === 'FILE_ATTACHMENT_NOT_FOUND') continue;
        // Unknown or edited records do not disappear to manufacture quota space.
        count++; bytes += FILE_ATTACHMENT_LIMITS.maxBytes;
      }
    }
    return { count, bytes };
  }

  async assertDraftRoom(workspaceId: string, extraCount: number, extraBytes: number): Promise<void> {
    await this.inWorkspace(workspaceId, true, async directory => {
      const draft = await this.countDrafts(directory);
      if (draft.count + extraCount > FILE_ATTACHMENT_LIMITS.maxDrafts || draft.bytes + extraBytes > FILE_ATTACHMENT_LIMITS.maxDraftBytes) {
        throw new HttpError(429, 'This workspace has too many unsubmitted file attachments. Remove unused files and try again.', 'FILE_ATTACHMENT_DRAFT_LIMIT');
      }
    });
  }

  async commit(input: FileCommitInput, content: Buffer): Promise<FileAttachment> {
    if (!FILE_ATTACHMENT_ID.test(input.id) || !FILE_ATTACHMENT_HASH.test(input.sha256) || !validDate(input.createdAt) || Date.parse(input.createdAt) > this.now() + 60_000
      || !Number.isSafeInteger(input.bytes) || input.bytes < 0 || input.bytes > FILE_ATTACHMENT_LIMITS.maxBytes
      || !Buffer.isBuffer(content) || content.length !== input.bytes || attachmentHash(content) !== input.sha256) throw attachmentChanged();
    const name = fileAttachmentName(input.name), mimeType = fileAttachmentMime(input.mimeType, name);
    const source: FileAttachment = { id: input.id, workspaceId: input.workspaceId, name, mimeType,
      bytes: input.bytes, sha256: input.sha256, createdAt: input.createdAt };
    // Own this buffer before yielding. A caller cannot replace bytes after the hash check.
    const bytes = Buffer.from(content);
    return this.inWorkspace(source.workspaceId, true, async directory => {
      const drafts = await this.countDrafts(directory);
      if (drafts.count >= FILE_ATTACHMENT_LIMITS.maxDrafts || drafts.bytes + bytes.length > FILE_ATTACHMENT_LIMITS.maxDraftBytes) {
        throw new HttpError(429, 'Remove unused file attachments before adding more.', 'FILE_ATTACHMENT_DRAFT_LIMIT');
      }
      const value: FileRecord = { kind: KIND, ...source, state: 'uploading' };
      const serialized = `${JSON.stringify(value)}\n`;
      // These are essential originals and recovery metadata, not derived cache files.
      // No temporary processing copy is written into the durable data directory.
      await this.assertWorkspaceAvailable(source.workspaceId);
      await this.writeExclusive(directory, `${value.id}.json`, serialized);
      await this.assertWorkspaceAvailable(source.workspaceId);
      await this.writeExclusive(directory, `${value.id}.file`, bytes, 0o400);
      await this.bytes(directory, value, true);
      const ready: FileRecord = { ...value, state: 'ready' };
      await this.update(directory, { value, serialized }, ready);
      return expose(ready);
    });
  }

  /** A restart may finish metadata for exact committed bytes, but never replay an incomplete write. */
  async recover(workspaceId: string, reference: FileAttachmentReference): Promise<FileAttachment | undefined> {
    try {
      return await this.inWorkspace(workspaceId, false, async directory => {
        const previous = await this.record(directory, reference.id, workspaceId);
        if (previous.value.sha256 !== reference.sha256) throw attachmentChanged();
        await this.bytes(directory, previous.value, true);
        if (previous.value.state === 'ready') return expose(previous.value);
        const ready: FileRecord = { ...previous.value, state: 'ready' };
        await this.update(directory, previous, ready);
        return expose(ready);
      });
    } catch (error) {
      if (error instanceof HttpError && ['FILE_ATTACHMENT_NOT_FOUND', 'FILE_ATTACHMENT_EXPIRED', 'FILE_ATTACHMENT_CHANGED'].includes(error.code ?? '')) return undefined;
      throw error;
    }
  }

  async read(workspaceId: string, reference: FileAttachmentReference): Promise<{ attachment: FileAttachment; bytes: Buffer }> {
    if (!FILE_ATTACHMENT_ID.test(reference.id) || !FILE_ATTACHMENT_HASH.test(reference.sha256)) throw attachmentMissing();
    return this.inWorkspace(workspaceId, false, async directory => {
      const { value } = await this.record(directory, reference.id, workspaceId);
      if (value.sha256 !== reference.sha256) throw attachmentChanged();
      return { attachment: expose(value), bytes: await this.bytes(directory, value) };
    });
  }

  async resolve(workspaceId: string, input: FileAttachmentReference[], retain = false): Promise<FileAttachment[]> {
    const references = parseFileInput(fileAttachmentReferencesSchema, input);
    if (!references.length) { await this.assertWorkspaceAvailable(workspaceId); await this.ctx.workspaces.get(workspaceId); return []; }
    return this.inWorkspace(workspaceId, false, async directory => {
      const records: LoadedRecord[] = [];
      let total = 0;
      for (const reference of references) {
        const loaded = await this.record(directory, reference.id, workspaceId);
        if (loaded.value.sha256 !== reference.sha256) throw attachmentChanged();
        total += loaded.value.bytes;
        if (total > FILE_ATTACHMENT_LIMITS.maxMessageBytes) throw new HttpError(413, 'Files in one message must total 50 MiB or less.', 'FILE_ATTACHMENT_MESSAGE_TOO_LARGE');
        await this.bytes(directory, loaded.value);
        records.push(loaded);
      }
      // Validate the whole selection before preserving any draft for a message.
      if (retain) for (const loaded of records) if (!loaded.value.retainedAt) {
        await this.update(directory, loaded, { ...loaded.value, retainedAt: new Date(this.now()).toISOString() });
      }
      return records.map(loaded => expose(loaded.value));
    });
  }

  async discard(workspaceId: string, reference: FileAttachmentReference): Promise<{ deleted: true }> {
    if (!FILE_ATTACHMENT_ID.test(reference.id) || !FILE_ATTACHMENT_HASH.test(reference.sha256)) throw attachmentMissing();
    return this.inWorkspace(workspaceId, false, async directory => {
      const { value } = await this.record(directory, reference.id, workspaceId);
      if (value.sha256 !== reference.sha256) throw attachmentChanged();
      if (value.retainedAt) throw new HttpError(409, 'This attachment belongs to a saved message and must remain available to its conversation and forks.', 'FILE_ATTACHMENT_IN_USE');
      await this.remove(directory, reference.id);
      return { deleted: true };
    });
  }

  async openDownloadSource(workspaceId: string, reference: FileAttachmentReference): Promise<{ attachment: FileAttachment; source: DownloadSource }> {
    if (!FILE_ATTACHMENT_ID.test(reference.id) || !FILE_ATTACHMENT_HASH.test(reference.sha256)) throw attachmentMissing();
    let ownedSource: DownloadSource | undefined;
    try { return await this.inWorkspace(workspaceId, false, async directory => {
      const { value } = await this.record(directory, reference.id, workspaceId);
      if (value.sha256 !== reference.sha256) throw attachmentChanged();
      await this.bytes(directory, value);
      let parent: FileHandle | undefined, file: FileHandle | undefined;
      try {
        // Separate handles remain owned by the download service after this workspace operation ends.
        parent = await fs.open(this.entry(directory, '.'), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        const name = `${value.id}.file`, named = `/proc/self/fd/${parent.fd}/${name}`;
        const before = await fs.lstat(named, { bigint: true });
        file = await fs.open(named, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const stat = await file.stat({ bigint: true });
        if (!sameBigFile(before, stat) || stat.size !== BigInt(value.bytes)) throw attachmentChanged();
        await this.check(directory); await this.assertWorkspaceAvailable(workspaceId);
        const ownedParent = parent, handle = file;
        let closePromise: Promise<void> | undefined;
        let sources = this.sources.get(workspaceId);
        if (!sources) { sources = new Set(); this.sources.set(workspaceId, sources); }
        const group = sources;
        const source: DownloadSource = { handle, parent: ownedParent, name, stat, size: value.bytes,
          close: () => {
            closePromise ??= Promise.allSettled([handle.close(), ownedParent.close()]).then(() => {
              group.delete(source); if (!group.size && this.sources.get(workspaceId) === group) this.sources.delete(workspaceId);
            });
            return closePromise;
          } };
        ownedSource = source; group.add(source);
        return { attachment: expose(value), source };
      } catch (error) { await Promise.allSettled([parent?.close(), file?.close()]); throw error; }
    }); } catch (error) { await ownedSource?.close(); throw error; }
  }

  private cleanupConflict(): HttpError {
    return new HttpError(409, 'Some saved file attachments changed or could not be verified as belonging to this deleted workspace. They were preserved for a cleanup retry.', 'FILE_ATTACHMENT_WORKSPACE_CLEANUP_UNSAFE');
  }

  private async cleanupLeaf(directory: Directory, name: string, maximum: number): Promise<{ leaf: CleanupLeaf; bytes: Buffer }> {
    const before = await fs.lstat(this.entry(directory, name));
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maximum) throw this.cleanupConflict();
    const bytes = await this.readBounded(directory, name, maximum);
    if (!sameFile(before, await fs.lstat(this.entry(directory, name)))) throw this.cleanupConflict();
    return { leaf: { name, stat: before, digest: attachmentHash(bytes), maximum }, bytes };
  }

  private async cleanupPlan(directory: Directory, workspaceId: string): Promise<CleanupLeaf[]> {
    const names: string[] = [];
    for await (const entry of await fs.opendir(this.entry(directory, '.'))) {
      if (names.length >= MAX_SCAN_RECORDS || !entry.isFile() || entry.isSymbolicLink()) throw this.cleanupConflict();
      names.push(entry.name);
    }
    const remaining = new Set(names), payloads: CleanupLeaf[] = [], metadata: CleanupLeaf[] = [];
    const records = new Map<string, LoadedRecord>();
    // Validate every owning record before unlinking any leaf. Unknown files,
    // nested folders, foreign owners, links and changed immutable bytes survive.
    for (const name of names) if (/^file_[a-f0-9]{32}\.json$/.test(name)) {
      const id = name.slice(0, -5), captured = await this.cleanupLeaf(directory, name, MAX_RECORD_BYTES);
      const record = this.parseRecord(directory, id, captured.bytes.toString('utf8'), workspaceId);
      records.set(id, record); metadata.push(captured.leaf); remaining.delete(name);
    }
    for (const [id, record] of records) {
      const name = `${id}.file`;
      if (!remaining.has(name)) continue; // Interrupted creation or an earlier successful payload unlink.
      const captured = await this.cleanupLeaf(directory, name, FILE_ATTACHMENT_LIMITS.maxBytes);
      if (captured.bytes.length > record.value.bytes
        || record.value.state === 'ready' && (captured.bytes.length !== record.value.bytes || captured.leaf.digest !== record.value.sha256)
        || captured.bytes.length === record.value.bytes && captured.leaf.digest !== record.value.sha256) throw this.cleanupConflict();
      payloads.push(captured.leaf); remaining.delete(name);
    }
    for (const name of [...remaining]) if (/^file_[a-f0-9]{32}\.[a-f0-9]{32}\.meta\.tmp$/.test(name)) {
      const captured = await this.cleanupLeaf(directory, name, MAX_RECORD_BYTES);
      this.parseRecord(directory, name.slice(0, 37), captured.bytes.toString('utf8'), workspaceId);
      payloads.push(captured.leaf); remaining.delete(name);
    }
    if (remaining.size) throw this.cleanupConflict();
    return [...payloads, ...metadata];
  }

  /**
   * Exact permanent cleanup, after a persisted fence and participant drain.
   * No workspace lookup, activity acquisition, recursive rm or public-bucket
   * operation occurs here. Owning records are unlinked after their payloads.
   */
  async cleanupWorkspaceOriginals(workspaceId: string, options: ConversationFileCleanupOptions = {}): Promise<{ filesRemoved: number }> {
    this.deletionName(workspaceId);
    await this.initialize();
    if (!await this.readDeletionFence(workspaceId)) throw this.cleanupConflict();
    const key = attachmentHash(workspaceId);
    return this.serialized(key, async () => {
      await options.assertCurrent?.();
      let directory: Directory | undefined;
      try { directory = await this.child(this.root!, key, false); }
      catch (error) { if (errno(error, 'ENOENT')) return { filesRemoved: 0 }; throw error; }
      try {
        const plan = await this.cleanupPlan(directory, workspaceId);
        let filesRemoved = 0;
        for (const leaf of plan) {
          await options.assertCurrent?.(); await this.check(directory);
          const current = await this.cleanupLeaf(directory, leaf.name, leaf.maximum);
          if (!sameFile(leaf.stat, current.leaf.stat) || current.leaf.digest !== leaf.digest) throw this.cleanupConflict();
          await options.assertCurrent?.(); await this.check(directory);
          if (!sameFile(leaf.stat, await fs.lstat(this.entry(directory, leaf.name)))) throw this.cleanupConflict();
          await fs.unlink(this.entry(directory, leaf.name)); filesRemoved++;
        }
        await options.assertCurrent?.(); await this.check(directory); await this.check(this.root!);
        if ((await fs.readdir(this.entry(directory, '.'))).length) throw this.cleanupConflict();
        await fs.rmdir(this.entry(this.root!, key));
        return { filesRemoved };
      } finally { await directory.handle.close(); }
    });
  }

  async cleanupExpired(): Promise<{ deleted: number; skipped: number }> {
    await this.initialize();
    const result = { deleted: 0, skipped: 0 };
    await this.check(this.root!);
    let scanned = 0;
    for await (const workspace of await fs.opendir(this.entry(this.root!, '.'))) {
      if (++scanned > MAX_SCAN_RECORDS) { result.skipped++; break; }
      if (!workspace.isDirectory() || !FILE_ATTACHMENT_HASH.test(workspace.name)) continue;
      await this.serialized(workspace.name, async () => {
        let directory: Directory | undefined;
        try {
          // Permanent deletion has its own ownership checks and retry journal.
          // Ordinary draft expiry must not race it or discard its remaining evidence.
          try { await fs.lstat(this.entry(this.root!, `${workspace.name}.deleted.json`)); return; }
          catch (error) { if (!errno(error, 'ENOENT')) throw error; }
          directory = await this.child(this.root!, workspace.name, false);
          for await (const entry of await fs.opendir(this.entry(directory, '.'))) {
            if (++scanned > MAX_SCAN_RECORDS) { result.skipped++; break; }
            if (/^file_[a-f0-9]{32}\.json$/.test(entry.name)) {
              try {
                const { value } = await this.record(directory, entry.name.slice(0, -5));
                if (this.expired(value)) { await this.remove(directory, value.id); result.deleted++; }
              } catch { result.skipped++; }
            } else if (/^file_[a-f0-9]{32}\.[a-f0-9]{32}\.meta\.tmp$/.test(entry.name) && entry.isFile()) {
              try {
                const bytes = await this.readBounded(directory, entry.name, MAX_RECORD_BYTES);
                const value = JSON.parse(bytes.toString('utf8')) as FileRecord;
                const stat = await fs.lstat(this.entry(directory, entry.name));
                if (value.kind === KIND && value.id === entry.name.slice(0, 37) && WORKSPACE_ID.test(value.workspaceId)
                  && attachmentHash(value.workspaceId) === workspace.name && validDate(value.createdAt)
                  && stat.isFile() && !stat.isSymbolicLink() && stat.mtimeMs <= this.now() - FILE_ATTACHMENT_LIMITS.draftLifetimeMs) {
                  await this.check(directory); await fs.unlink(this.entry(directory, entry.name));
                }
              } catch { result.skipped++; }
            }
          }
        } catch { result.skipped++; }
        finally { await directory?.handle.close(); }
      });
    }
    return result;
  }
}
