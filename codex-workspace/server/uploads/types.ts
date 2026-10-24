import type { FileEntry } from '../../shared/types';
import type { BucketDeleteResult, BucketObject } from '../downloads/types';

export type UploadJobState = 'reserved' | 'queued' | 'publishing' | 'importing' | 'ready' | 'failed' | 'cancelled' | 'expired';
export interface UploadIssue { code: string; message: string }

/** Safe, serializable state. No provider credentials or temporary capabilities are persisted here. */
export interface UploadJob {
  id: string;
  workspaceId: string;
  path: string;
  fileName: string;
  size: number;
  state: UploadJobState;
  bucket: string;
  objectPath: string;
  /** Bytes downloaded by the server from the published staging object. Browser upload progress is separate. */
  bytesProcessed: number;
  createdAt: string;
  updatedAt: string;
  sessionExpiresAt: string;
  uploadedAt?: string;
  /** Expiry of the public staging copy only; the imported workspace file remains persistent. */
  expiresAt?: string;
  stagingRemovedAt?: string;
  version?: string;
  entry?: FileEntry;
  error?: UploadIssue;
}

/** Provider-issued Xet CAS capability; return only from the authenticated, no-store capability route. */
export interface UploadCapability { accessToken: string; casUrl: string; exp: number }

export interface UploadServiceStatus {
  enabled: boolean;
  ready: boolean;
  state: 'disabled' | 'checking' | 'ready' | 'error';
  bucket?: string;
  maxFileBytes: number;
  maxActiveSessions: number;
  maxConcurrency: number;
  sessionTtlMs: number;
  lastCleanupAt?: string;
  unknownTimestampCount: number;
  error?: UploadIssue;
}

/** Tests replace this external boundary; the production implementation pins the transfer bucket. */
export interface UploadBucket {
  readonly id: string;
  capability(sessionId: string, signal: AbortSignal): Promise<UploadCapability>;
  list(signal: AbortSignal): AsyncIterable<BucketObject>;
  get(objectPath: string, signal: AbortSignal): Promise<BucketObject | undefined>;
  publish(input: { objectPath: string; xetHash: string; signal: AbortSignal }): Promise<BucketObject>;
  read(input: {
    objectPath: string;
    size: number;
    xetHash: string;
    signal: AbortSignal;
    onProgress?: (bytes: number) => void;
  }): Promise<Buffer>;
  delete(objectPaths: string[], signal: AbortSignal): Promise<BucketDeleteResult>;
}

export interface StoredUploadJob extends UploadJob {
  xetHash?: string;
  sha256?: string;
  capabilityRequests: number;
  /** Persisted before the first provider publication, including ambiguous timeout outcomes. */
  publishStartedAt?: string;
  /** Persisted immediately before the non-interruptible, create-only workspace commit. */
  commitStartedAt?: string;
}
