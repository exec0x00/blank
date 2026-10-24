import { createHash } from 'node:crypto';
import type { GitCheckpointCurrent, GitCheckpointFile, GitCheckpointIndexEntry, GitCheckpointManifest, GitCheckpointReference, GitCheckpointRepository } from '../git-checkpoints/types';
import { sameCheckpointRepository as sameHistoricalRepository } from '../git-checkpoints/logical-identity';
import { HttpError } from '../errors';
import { FILE_REWIND_LIMITS, type FileRewindPreviewRow } from './file-rewind-types';

export interface RewindTurnPair { before: GitCheckpointManifest; after: GitCheckpointManifest; manualPaths: string[] }
export interface PlannedFileRestore {
  path: string;
  expected: GitCheckpointFile;
  restore: GitCheckpointFile;
  checkpoint: GitCheckpointReference;
}
export interface PlannedIndexRestore {
  path: string;
  expected: GitCheckpointIndexEntry[];
  restore: GitCheckpointIndexEntry[];
  checkpoint: GitCheckpointReference;
}
export interface FileRestorePlan {
  files: PlannedFileRestore[];
  index: PlannedIndexRestore[];
  rows: FileRewindPreviewRow[];
  warnings: string[];
  indexConflict: boolean;
}

export function safeRewindPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\\\u0000-\u001f\u007f]/u.test(value)
    && !value.startsWith('/') && !/^[a-z]:/iu.test(value) && value.split('/').every(part => !!part && !['.', '..', '.git'].includes(part))
    && !value.split('/').some(part => part.startsWith('.codex-rewind-'));
}

export const absentCheckpointFile = (relative: string): GitCheckpointFile => ({ path: relative, kind: 'missing', mode: 0, bytes: 0, sha256: null, blob: null, tracked: false });

/** Inode timestamps prove that the current pathname is still the scanned file;
 * historical content equality deliberately ignores inode reuse and stat caches. */
export function sameCheckpointFile(left: GitCheckpointFile, right: GitCheckpointFile): boolean {
  return left.kind === right.kind && (left.kind === 'missing' || left.mode === right.mode && left.bytes === right.bytes && left.sha256 === right.sha256);
}

const reference = (manifest: GitCheckpointManifest): GitCheckpointReference => ({ version: 1, id: manifest.id,
  workspaceId: manifest.workspaceId, threadId: manifest.threadId, turnId: manifest.turnId, phase: manifest.phase,
  createdAt: manifest.createdAt, manifestHash: manifest.manifestHash });

export function sameCheckpointRepository(left: GitCheckpointRepository, right: GitCheckpointRepository): boolean {
  return sameHistoricalRepository(left, right);
}

export function sameCheckpointIndexEntries(left: readonly GitCheckpointIndexEntry[], right: readonly GitCheckpointIndexEntry[]): boolean {
  return left.length === right.length && left.every((entry, index) => {
    const other = right[index];
    return entry.path === other.path && entry.mode === other.mode && entry.objectId === other.objectId && entry.stage === other.stage
      && entry.assumeValid === other.assumeValid && entry.skipWorktree === other.skipWorktree && entry.intentToAdd === other.intentToAdd;
  });
}

function indexPaths(entries: readonly GitCheckpointIndexEntry[]): Map<string, GitCheckpointIndexEntry[]> {
  const result = new Map<string, GitCheckpointIndexEntry[]>();
  for (const entry of entries) {
    if (!safeRewindPath(entry.path)) throw new HttpError(409, 'The captured Git index contains an unsupported path. No files were changed.', 'FILE_REWIND_UNAVAILABLE');
    const rows = result.get(entry.path) ?? []; rows.push(entry); result.set(entry.path, rows);
  }
  for (const rows of result.values()) rows.sort((a, b) => a.stage - b.stage);
  return result;
}

function manualMatch(paths: readonly string[], relative: string): boolean {
  return paths.some(item => item === '*' || item === relative || relative.startsWith(`${item}/`) || item.startsWith(`${relative}/`));
}

/** Replay only actual per-turn deltas backwards. A gap between two agent deltas
 * belongs to somebody else; it is a conflict, never a reason to reset the tree.
 * Files never changed by these turns and unrelated index entries stay intact. */
export function planFileRestore(pairs: readonly RewindTurnPair[], current: GitCheckpointCurrent): FileRestorePlan {
  if (!pairs.length || pairs.length > FILE_REWIND_LIMITS.turns) throw new HttpError(409, 'This rewind has no complete bounded checkpoint history.', 'FILE_REWIND_UNAVAILABLE');
  const files = new Map<string, PlannedFileRestore>(), index = new Map<string, PlannedIndexRestore>(), conflicts = new Map<string, string>();
  const warnings = new Set<string>();
  for (const pair of pairs) {
    if (!sameCheckpointRepository(pairs[0].before.repository, pair.before.repository)
      || !sameCheckpointRepository(pair.before.repository, pair.after.repository)
      || !sameCheckpointRepository(pair.before.repository, current.repository)) {
      throw new HttpError(409, 'The repository, branch, or HEAD changed after this checkpoint. Rewind the conversation only, or inspect Git history first. No files were changed.', 'FILE_REWIND_REPOSITORY_CHANGED');
    }
    for (const warning of [...pair.before.limitations, ...pair.after.limitations]) warnings.add(warning);
    const before = new Map(pair.before.files.map(file => [file.path, file])), after = new Map(pair.after.files.map(file => [file.path, file]));
    for (const relative of new Set([...before.keys(), ...after.keys()])) {
      if (!safeRewindPath(relative)) throw new HttpError(409, 'A captured file path is unsupported. No files were changed.', 'FILE_REWIND_UNAVAILABLE');
      const oldFile = before.get(relative) ?? absentCheckpointFile(relative), newFile = after.get(relative) ?? absentCheckpointFile(relative);
      if (sameCheckpointFile(oldFile, newFile)) continue;
      const planned = files.get(relative);
      if (planned && !sameCheckpointFile(planned.expected, oldFile)) conflicts.set(relative, 'This file also changed between agent turns. Its manual changes were preserved.');
      if (manualMatch(pair.manualPaths, relative)) conflicts.set(relative, 'Manual file or terminal activity overlapped this turn. Its changes cannot be attributed safely.');
      files.set(relative, planned ? { ...planned, expected: newFile } : { path: relative, expected: newFile, restore: oldFile, checkpoint: reference(pair.before) });
    }
    const oldIndex = indexPaths(pair.before.index.entries), newIndex = indexPaths(pair.after.index.entries);
    for (const relative of new Set([...oldIndex.keys(), ...newIndex.keys()])) {
      const oldEntries = oldIndex.get(relative) ?? [], newEntries = newIndex.get(relative) ?? [];
      if (sameCheckpointIndexEntries(oldEntries, newEntries)) continue;
      const planned = index.get(relative);
      if (planned && !sameCheckpointIndexEntries(planned.expected, oldEntries)) conflicts.set(relative, 'This path also had staging changes between agent turns. Its staged content was preserved.');
      if (manualMatch(pair.manualPaths, relative)) conflicts.set(relative, 'Manual activity overlapped this staging change. Its staged content was preserved.');
      index.set(relative, planned ? { ...planned, expected: newEntries } : { path: relative, expected: newEntries, restore: oldEntries, checkpoint: reference(pair.before) });
    }
    if (files.size > FILE_REWIND_LIMITS.files || index.size > FILE_REWIND_LIMITS.files) throw new HttpError(413, 'This rewind exceeds the bounded file checkpoint limit. The conversation-only option remains available.', 'FILE_REWIND_LIMIT');
  }
  const actualFiles = new Map(current.files.map(file => [file.path, file])), actualIndex = indexPaths(current.index.entries);
  for (const [relative, planned] of files) {
    if (sameCheckpointFile(planned.expected, planned.restore)) { files.delete(relative); continue; }
    const actual = actualFiles.get(relative) ?? absentCheckpointFile(relative);
    if (!sameCheckpointFile(actual, planned.expected)) conflicts.set(relative, 'This file changed after the agent turn. Save or inspect the newer work before choosing another action.');
    planned.expected = actual;
  }
  for (const [relative, planned] of index) {
    if (sameCheckpointIndexEntries(planned.expected, planned.restore)) { index.delete(relative); continue; }
    const actual = actualIndex.get(relative) ?? [];
    if (!sameCheckpointIndexEntries(actual, planned.expected)) conflicts.set(relative, 'This staged path changed after the agent turn. The newer staging was preserved.');
    planned.expected = actual;
  }
  // Discard only regenerable index caches. Resolve-undo and unknown optional
  // metadata may carry user intent even though Git can technically ignore it.
  const cacheExtensions = new Set(['TREE', 'UNTR', 'FSMN', 'EOIE', 'IEOT']);
  const unsupportedIndex = index.size > 0 && [current.index, ...pairs.flatMap(pair => [pair.before.index, pair.after.index])]
    .some(snapshot => snapshot.extensions.some(extension => !cacheExtensions.has(extension)));
  if (unsupportedIndex) for (const relative of index.keys()) conflicts.set(relative, 'The Git index contains additional staging metadata that cannot be selectively restored safely.');
  const relatives = [...new Set([...files.keys(), ...index.keys()])].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  if (relatives.length > FILE_REWIND_LIMITS.files) throw new HttpError(413, 'This rewind exceeds the bounded affected-path limit. The conversation-only option remains available.', 'FILE_REWIND_LIMIT');
  for (const relative of relatives) {
    const parent = relatives.find(candidate => candidate !== relative && relative.startsWith(`${candidate}/`) && files.get(candidate)?.restore.kind !== 'missing');
    if (parent) conflicts.set(relative, 'The requested restore would replace a parent path. Inspect the directory changes before continuing.');
  }
  const rows = relatives.map(relative => {
    const file = files.get(relative);
    return { path: relative, action: file?.restore.kind === 'missing' ? 'delete' as const : file?.expected.kind === 'missing' ? 'create' as const : 'update' as const,
      staged: index.has(relative), ...(conflicts.has(relative) ? { conflict: conflicts.get(relative)! } : {}) };
  });
  return { files: [...files.values()], index: [...index.values()], rows, warnings: [...warnings].slice(0, 32),
    indexConflict: unsupportedIndex || [...index.keys()].some(relative => conflicts.has(relative)) };
}

/** Official format: https://git-scm.com/docs/index-format. All semantic entries
 * survive, including merge stages and intent flags. Recomputed stat/cache data
 * is deliberately invalidated; no refs, branch history or working files move. */
export function encodeRewindIndex(entries: readonly GitCheckpointIndexEntry[], objectFormat: 'sha1' | 'sha256'): Buffer {
  if (entries.length > FILE_REWIND_LIMITS.files * 4) throw new HttpError(413, 'The restored Git index is too large.', 'FILE_REWIND_LIMIT');
  const sorted = [...entries].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)) || a.stage - b.stage);
  const extended = sorted.some(entry => entry.skipWorktree || entry.intentToAdd), oidBytes = objectFormat === 'sha256' ? 32 : 20;
  const header = Buffer.alloc(12); header.write('DIRC', 0, 'ascii'); header.writeUInt32BE(extended ? 3 : 2, 4); header.writeUInt32BE(sorted.length, 8);
  const parts = [header];
  let previous = '';
  for (const entry of sorted) {
    const key = `${entry.path}\0${entry.stage}`;
    if (!safeRewindPath(entry.path) || !['100644', '100755', '120000'].includes(entry.mode) || ![0, 1, 2, 3].includes(entry.stage)
      || !new RegExp(`^[a-f0-9]{${oidBytes * 2}}$`, 'u').test(entry.objectId) || key === previous) {
      throw new HttpError(409, 'The captured staged content cannot form a valid Git index.', 'FILE_REWIND_INDEX_INVALID');
    }
    previous = key;
    const name = Buffer.from(entry.path), hasExtended = entry.skipWorktree || entry.intentToAdd;
    const fixed = 40 + oidBytes + 2 + (hasExtended ? 2 : 0), unpadded = fixed + name.length + 1;
    const encoded = Buffer.alloc(Math.ceil(unpadded / 8) * 8);
    encoded.writeUInt32BE(Number.parseInt(entry.mode, 8), 24);
    Buffer.from(entry.objectId, 'hex').copy(encoded, 40);
    encoded.writeUInt16BE((entry.assumeValid ? 0x8000 : 0) | (hasExtended ? 0x4000 : 0) | entry.stage << 12 | Math.min(name.length, 0xfff), 40 + oidBytes);
    if (hasExtended) encoded.writeUInt16BE((entry.skipWorktree ? 0x4000 : 0) | (entry.intentToAdd ? 0x2000 : 0), 42 + oidBytes);
    name.copy(encoded, fixed); parts.push(encoded);
  }
  const body = Buffer.concat(parts);
  return Buffer.concat([body, createHash(objectFormat).update(body).digest()]);
}

export function mergeRewindIndex(current: readonly GitCheckpointIndexEntry[], changes: readonly PlannedIndexRestore[]): GitCheckpointIndexEntry[] {
  const changed = new Set(changes.map(change => change.path));
  return [...current.filter(entry => !changed.has(entry.path)), ...changes.flatMap(change => change.restore)];
}

export function affectedDirtyPaths(paths: readonly string[], affected: readonly string[]): string[] {
  if (paths.length > FILE_REWIND_LIMITS.dirtyPaths || paths.some(relative => !safeRewindPath(relative))) {
    throw new HttpError(400, 'Provide at most 100 relative dirty editor paths.', 'FILE_REWIND_DIRTY_PATHS');
  }
  return [...new Set(paths)].filter(relative => affected.some(item => relative === item || relative.startsWith(`${item}/`) || item.startsWith(`${relative}/`)));
}
