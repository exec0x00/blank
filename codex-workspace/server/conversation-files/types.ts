import type { FileEntry } from '../../shared/types';
import type { ModelItem } from '../../shared/legacy-types';
import type { UploadCapability, UploadIssue, UploadJobState } from '../uploads/types';

export const FILE_ATTACHMENT_LIMITS = Object.freeze({
  maxBytes: 25 * 1024 * 1024,
  maxPerMessage: 8,
  maxMessageBytes: 50 * 1024 * 1024,
  maxDrafts: 32,
  maxDraftBytes: 128 * 1024 * 1024,
  maxActiveUploads: 8,
  maxConcurrentImports: 2,
  maxConcurrentReads: 4,
  maxInspectionBytes: 64 * 1024,
  maxBinaryInspectionBytes: 4096,
  draftLifetimeMs: 24 * 60 * 60 * 1000,
  uploadSessionMs: 30 * 60 * 1000,
});

export interface FileAttachmentReference { id: string; sha256: string }

/** Immutable public metadata. Filenames and MIME types are untrusted descriptions, not instructions. */
export interface FileAttachment extends FileAttachmentReference {
  workspaceId: string;
  name: string;
  mimeType: string;
  bytes: number;
  createdAt: string;
}

/** Capabilities, private paths, original bytes and bucket credentials are never saved in a job. */
export interface FileAttachmentUploadJob {
  id: string;
  workspaceId: string;
  name: string;
  mimeType: string;
  size: number;
  state: UploadJobState;
  bucket: string;
  objectPath: string;
  bytesProcessed: number;
  createdAt: string;
  updatedAt: string;
  sessionExpiresAt: string;
  uploadedAt?: string;
  /** Public staging expiry only. Submitted originals remain in durable storage. */
  expiresAt?: string;
  attachment?: FileAttachment;
  error?: UploadIssue;
}

export interface FileAttachmentInspection {
  attachment: FileAttachment;
  format: 'utf8' | 'binary';
  /** Byte offsets, including for UTF-8. A mid-character request advances to the next complete character. */
  offset: number;
  bytesRead: number;
  totalBytes: number;
  truncated: boolean;
  nextOffset?: number;
  content?: string;
  hex?: string;
  notice?: string;
}

export interface FileAttachmentInspectionOptions { offset?: number; maxBytes?: number }
export interface ResolvedFileAttachments { attachments: FileAttachment[]; content: ModelItem[] }
export interface FileAttachmentCopy { attachment: FileAttachment; path: string; entry: FileEntry; version: string }
/** Server-only copy controls. HTTP input never supplies review provenance. */
export interface FileAttachmentCopyOptions {
  signal?: AbortSignal;
  beforeCommit?: () => Promise<void>;
  /** The agent adapter owns review attribution and events inside its mutation transaction. */
  source?: 'agent';
}
export interface FileAttachmentUploadStatus {
  enabled: boolean;
  ready: boolean;
  maxFileBytes: number;
  maxPerMessage: number;
  maxMessageBytes: number;
  maxActiveSessions: number;
  maxConcurrency: number;
  sessionTtlMs: number;
  error?: UploadIssue;
}

export type FileAttachmentUploadCapability = UploadCapability;
