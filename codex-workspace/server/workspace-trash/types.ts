import type { Workspace } from '../../shared/types';
import type { OperationalPage } from '../operational-pages';

/** Public metadata only. Account credentials never enter a trash record. */
export interface WorkspaceTrashEntry {
  id: string;
  workspaceId: string;
  name: string;
  deletedAt: string;
  expiresAt: string;
  reason: 'deleted' | 'missing';
  state: 'ready' | 'missing' | 'recovery';
  canRestore: boolean;
  issue?: string;
}

export interface WorkspaceDeletionPlan { workspaceId: string; mode: 'trash' | 'permanent'; retentionDays: 30 | null }
export interface WorkspaceDeletionStatus {
  id: string;
  workspaceId: string;
  name: string;
  mode: 'permanent';
  state: 'pending' | 'error';
  updatedAt: string;
  issue?: string;
}
export type WorkspaceDeleteResult = { removed: true; mode: 'trash'; trash: WorkspaceTrashEntry }
  | { removed: true; mode: 'permanent'; workspaceId: string };
export interface WorkspaceTrashDeleteResult { deleted: true; id: string }
export type WorkspaceTrashPage = OperationalPage<WorkspaceTrashEntry>;
export type WorkspaceDeletionPage = OperationalPage<WorkspaceDeletionStatus>;

export interface NativeIdentity { dev: number; ino: number }
export interface TreeMetadataEntry {
  path: string;
  kind: 'file' | 'directory' | 'symlink';
  mode: number;
  size?: number;
  target?: string;
}
export interface TrashSnapshot {
  version: 1;
  content: TreeMetadataEntry[] | null;
  fileTrash: TreeMetadataEntry[] | null;
}

/** Each entry has an independent journal; there is no replaceable global list. */
export interface WorkspaceTrashRecord {
  version: 1;
  id: string;
  workspace: Workspace;
  deletedAt: string;
  expiresAt: string;
  updatedAt: string;
  reason: WorkspaceTrashEntry['reason'];
  mode: WorkspaceDeletionPlan['mode'];
  phase: 'preparing' | 'ready' | 'missing' | 'restoring' | 'restored' | 'purging' | 'purged' | 'recovery' | 'cancelled';
  contentIdentity?: NativeIdentity;
  fileTrashIdentity?: NativeIdentity;
  restore?: { token: string; phase: 'copying' | 'copied' };
  /** Opt-in permanent artifact cleanup; absent on older, already-purged history. */
  artifactCleanup?: { version: 1; state: 'pending' | 'complete' | 'superseded'; updatedAt: string };
  issue?: string;
}

/** Internal port, implemented by WorkspaceService without an AppContext cycle. */
export interface WorkspaceTrashRegistry {
  registration(id: string): Promise<Workspace | null>;
  registrations(): Promise<Workspace[]>;
  active(id: string): Promise<boolean>;
  archivedBy(id: string, trashId: string): Promise<boolean>;
  restoredBy(id: string, trashId: string): Promise<'current' | 'previous' | false>;
  archive(record: WorkspaceTrashRecord): Promise<void>;
  restore(record: WorkspaceTrashRecord): Promise<Workspace>;
  repairSelection(): Promise<void>;
}
