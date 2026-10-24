import type { FileAttachment, ImageAttachment, Thread } from '../../shared/types';

/** Public rewind contracts contain no checkpoint paths, file bodies or Git object database selectors. */
export interface FileRewindPreviewInput {
  beforeTurnId: string;
  dirtyPaths?: string[];
  offset?: number;
  limit?: number;
  planId?: string;
  version?: string;
}

export interface FileRewindSelection { planId: string; version: string }
export interface ThreadRewindOptions { files?: FileRewindSelection; dirtyPaths?: string[] }

export interface FileRewindPreviewRow {
  path: string;
  action: 'create' | 'update' | 'delete';
  staged: boolean;
  conflict?: string;
}

export interface FileRewindPreview {
  availability: 'available' | 'unavailable';
  reason?: string;
  workspaceId: string;
  threadId: string;
  beforeTurnId: string;
  planId?: string;
  version?: string;
  expiresAt?: string;
  checkpoint?: { id: string; createdAt: string; head: string | null; branch: string | null };
  index: {
    behavior: 'preserve' | 'restore-captured-entries' | 'conflict';
    changedPaths: number;
    description: string;
  };
  rows: FileRewindPreviewRow[];
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
  affectedDirtyPaths: string[];
  canCommit: boolean;
  warnings: string[];
  recovery?: ThreadRewindRecoveryRequired | ThreadRewindPending;
}

export interface ThreadRewindComplete {
  status: 'complete';
  beforeTurnId?: string;
  workspaceId?: string;
  threadId?: string;
  planId?: string;
  planVersion?: string;
  thread: Thread;
  restoredPrompt: string;
  restoredAttachments?: ImageAttachment[];
  restoredFileAttachments?: FileAttachment[];
  filesUnchanged: boolean;
  filesRewound: number;
  backupId: string;
  recoveryId?: string;
}

export interface ThreadRewindRecoveryRequired {
  status: 'recovery_required';
  beforeTurnId: string;
  workspaceId: string;
  threadId: string;
  planId: string;
  planVersion: string;
  recoveryId: string;
  backupId: string;
  message: string;
  /** True only when the exact original transcript was verified or restored. */
  threadUnchanged: boolean;
}

export interface ThreadRewindPending {
  status: 'pending';
  beforeTurnId: string;
  workspaceId: string;
  threadId: string;
  planId: string;
  version: string;
  recoveryId: string;
  message: string;
}

export type ThreadRewindResult = ThreadRewindComplete | ThreadRewindRecoveryRequired;
export type ThreadRewindRecoveryStatus = ThreadRewindResult | ThreadRewindPending | FileRewindKeepCurrentResult | {
  status: 'not_started';
  planId?: string;
  version?: string;
};

export interface FileRewindRecoveryRow {
  path: string;
  state: 'original' | 'restored' | 'changed' | 'missing' | 'unavailable';
  staged: boolean;
}
export interface FileRewindRecoveryReview {
  recoveryId: string;
  workspaceId: string;
  targetWorkspaceId?: string;
  targetWorkspaceName?: string;
  threadId: string;
  beforeTurnId: string;
  planId: string;
  planVersion: string;
  backupId: string;
  state: 'pending' | 'recovery_required' | 'kept_current' | 'complete';
  blocking: boolean;
  message: string;
  version?: string;
  expiresAt?: string;
  canKeepCurrent: boolean;
  transcript: 'original' | 'rewound' | 'changed' | 'missing' | 'unknown';
  index: 'original' | 'restored' | 'changed' | 'unavailable';
  rows: FileRewindRecoveryRow[];
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
}
export interface WorkspaceRewindRecovery {
  workspaceId: string;
  recovery: FileRewindRecoveryReview | null;
}
export interface FileRewindRecoveryQuery { recoveryId?: string; version?: string; offset?: number; limit?: number }
export interface FileRewindKeepCurrentInput { recoveryId: string; version: string }
export interface FileRewindKeepCurrentResult {
  status: 'kept_current';
  recoveryId: string;
  version: string;
  workspaceId: string;
  targetWorkspaceId?: string;
  threadId: string;
  beforeTurnId: string;
  planId: string;
  planVersion: string;
  filesUnchanged: true;
  conversationUnchanged: true;
  message: string;
}

export const FILE_REWIND_LIMITS = Object.freeze({
  dirtyPaths: 100,
  pageSize: 25,
  maxPageSize: 50,
  files: 5000,
  turns: 128,
  livePlans: 16,
  unusedPlans: 64,
  expiredPreviewReceipts: 512,
  expiredPreviewReceiptMilliseconds: 24 * 60 * 60_000,
  planMilliseconds: 5 * 60_000,
  metadataBytes: 8 * 1024 * 1024,
});
