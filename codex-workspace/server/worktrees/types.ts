import type { Workspace } from '../../shared/types';
import type { OperationalPage } from '../operational-pages';

/** Server-owned relationship. A linked checkout is never an arbitrary .git file. */
export interface WorkspaceWorktree {
  id: string;
  sourceWorkspaceId: string;
  repositoryWorkspaceId: string;
  gitDirectory: string;
  commonDirectory: string;
}

export interface CreateWorktreeInput {
  name?: string;
  /** Omit for a detached checkout. Existing local branches must not be in use. */
  branch?: string;
  createBranch?: boolean;
  /** Existing commit or ref; used for a detached checkout or a new branch. */
  base?: string;
}

export interface ManagedWorktree {
  id: string;
  workspaceId: string;
  name: string;
  path: string;
  sourceWorkspaceId: string;
  repositoryWorkspaceId: string;
  createdAt: string;
  updatedAt: string;
  state: 'ready' | 'archived' | 'recovery' | 'missing';
  branch?: string;
  head?: string;
  dirty?: boolean;
  locked?: boolean;
  /** Native deletion is durably confirmed; Remove finishes retained artifacts or metadata. */
  removalPending?: true;
  /** A bounded explanation; never raw Git configuration or a credential. */
  issue?: string;
}

export interface CreatedWorktree {
  workspace: Workspace;
  worktree: ManagedWorktree;
}

export interface ManagedWorktreePage extends OperationalPage<ManagedWorktree> {
  /** Exact retained primary, independent of any workspace-list page. */
  repository: Workspace;
  /** At most three active family registrations usable as mutation sources. */
  sources: Workspace[];
}

/** Permanent native removal only. Ordinary Archive never creates this proof. */
export interface WorktreeRemovalProof {
  version: 1;
  deletionId: string;
  deletedAt: string;
  /** Persisted only after the native checkout and administration path are gone. */
  nativeRemovedAt?: string;
  /** Exact managed archive generation owning this permanent cleanup. */
  archiveGeneration?: string;
  artifactCleanup: 'pending' | 'complete';
}

export interface WorktreeRecord {
  version: 1;
  id: string;
  workspaceId: string;
  name: string;
  path: string;
  sourceWorkspaceId: string;
  sourcePath: string;
  repositoryWorkspaceId: string;
  repositoryPath: string;
  commonDirectory: string;
  gitDirectory?: string;
  createdAt: string;
  updatedAt: string;
  phase: 'creating' | 'ready' | 'archived' | 'removing' | 'artifact-cleanup' | 'removed' | 'recovery';
  expectedHead: string;
  initialBranch?: string;
  createdBranch: boolean;
  /** Initial account reference only. Tokens are never copied to normal state. */
  githubAccountId?: string;
  removal?: WorktreeRemovalProof;
  issue?: string;
}
