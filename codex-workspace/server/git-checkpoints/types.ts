/** Durable, private server contracts. Do not serialize absolute repository paths to the browser. */
export type GitCheckpointPhase = 'before' | 'after' | 'backup';
export interface GitCheckpointIdentity { dev: number; ino: number }
export interface GitCheckpointFileIdentity extends GitCheckpointIdentity {
  size: number; mode: number; mtimeMs: number; ctimeMs: number;
}
export interface GitCheckpointGeneration {
  version: 1;
  repository: string;
  checkout: string;
  workspaceId: string;
  workspaceCreatedAt: string;
  repositoryWorkspaceId: string;
  repositoryWorkspaceCreatedAt: string;
  worktreeId: string | null;
}
export interface GitCheckpointRepository {
  root: string;
  gitDirectory: string;
  commonDirectory: string;
  rootIdentity: GitCheckpointIdentity;
  gitIdentity: GitCheckpointIdentity;
  commonIdentity: GitCheckpointIdentity;
  /** Signed durable identity; directory device/inode numbers are observations, not persistence keys. */
  generation: GitCheckpointGeneration;
  /** Live observation epoch; a fresh process or full service shutdown invalidates earlier plans. */
  observedIn: string;
  objectFormat: 'sha1' | 'sha256';
  head: string | null;
  /** Exact symbolic HEAD when present; detached HEAD has null here. */
  headRef: string | null;
}
export interface GitCheckpointFile {
  path: string;
  kind: 'file' | 'symlink' | 'missing';
  /** Complete ordinary Unix permission bits; Git's executable bit alone is insufficient. */
  mode: number;
  bytes: number;
  sha256: string | null;
  /** Blob in the checkpoint's isolated SHA-1 Git object database, never an arbitrary source OID. */
  blob: string | null;
  tracked: boolean;
  identity?: GitCheckpointFileIdentity;
}
export interface GitCheckpointIndexEntry {
  path: string;
  /** Git mode, e.g. 100644, 100755 or 120000, represented as an octal string. */
  mode: '100644' | '100755' | '120000';
  objectId: string;
  stage: 0 | 1 | 2 | 3;
  assumeValid: boolean;
  skipWorktree: boolean;
  intentToAdd: boolean;
  /** Verified bytes of objectId, persisted as an independent checkpoint blob. */
  blob: string | null;
}
export interface GitCheckpointIndex {
  present: boolean;
  sha256: string | null;
  bytes: number;
  blob: string | null;
  format: 2 | 3 | 4 | null;
  extensions: string[];
  entries: GitCheckpointIndexEntry[];
}
export interface GitCheckpointReference {
  version: 1;
  id: string;
  workspaceId: string;
  threadId: string;
  turnId: string;
  phase: GitCheckpointPhase;
  createdAt: string;
  manifestHash: string;
}
export interface GitCheckpointManifest extends GitCheckpointReference {
  repository: GitCheckpointRepository;
  files: GitCheckpointFile[];
  index: GitCheckpointIndex;
  /** Immutable native Git commit/tree in the isolated checkpoint database. */
  commit: string;
  tree: string;
  contentBytes: number;
  storedBytes: number;
  limitations: string[];
}
export interface GitCheckpointCaptureInput {
  workspaceId: string; threadId: string; turnId: string; phase?: GitCheckpointPhase; signal?: AbortSignal;
}
export type GitCheckpointCaptureResult =
  | { status: 'ready'; checkpoint: GitCheckpointReference; files: number; bytes: number; limitations: string[] }
  | { status: 'unavailable'; code: string; reason: string };
export interface GitCheckpointCurrent {
  repository: GitCheckpointRepository;
  files: GitCheckpointFile[];
  index: GitCheckpointIndex;
  /** Exact bytes/kinds/modes/index/HEAD and repository identity; excludes volatile inode timestamps. */
  token: string;
}
export interface GitCheckpointOptions {
  signal?: AbortSignal;
}
export interface GitCheckpointLimits {
  files: number;
  fileBytes: number;
  totalBytes: number;
  indexBytes: number;
  metadataBytes: number;
  milliseconds: number;
  /** Capture refuses new records when this owned durable quota is full; old turns remain honest. */
  retainedCheckpoints: number;
  retainedBytes: number;
}
