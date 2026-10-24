/** Downloads are prepared through the authenticated app and delivered by the public Hub bucket. */
export type DownloadJobState = 'queued' | 'snapshotting' | 'uploading' | 'ready' | 'failed' | 'cancelled' | 'expired';

export interface DownloadIssue { code: string; message: string }

/** Stable retry identity, never an asset storage path or an arbitrary download URL. */
export type DownloadSourceIdentity =
  | { type: 'attachment'; id: string; sha256: string }
  | { type: 'generated_image'; id: string; sha256: string };

export interface DownloadJob {
  id: string;
  workspaceId: string;
  path: string;
  /** Present for saved message assets. Their path is a display filename, not a workspace file path. */
  source?: DownloadSourceIdentity;
  fileName: string;
  mimeType: string;
  size: number;
  state: DownloadJobState;
  /** Bytes captured while snapshotting or accepted by the upload protocol while uploading. */
  bytesProcessed: number;
  createdAt: string;
  updatedAt: string;
  version?: string;
  url?: string;
  uploadedAt?: string;
  expiresAt?: string;
  error?: DownloadIssue;
}

export interface DownloadServiceStatus {
  enabled: boolean;
  ready: boolean;
  state: 'disabled' | 'checking' | 'ready' | 'error';
  bucket?: string;
  lastCleanupAt?: string;
  unknownTimestampCount: number;
  error?: DownloadIssue;
}

export interface BucketObject {
  path: string;
  type: 'file' | 'directory' | 'unknown';
  size: number;
  uploadedAt?: string;
  xetHash?: string;
}

export interface BucketDeleteResult { deleted: string[]; failed: string[] }

/** The implementation is pinned to the one, separate download bucket. Tests replace this boundary. */
export interface DownloadBucket {
  readonly id: string;
  list(signal: AbortSignal): AsyncIterable<BucketObject>;
  get(objectPath: string, signal: AbortSignal): Promise<BucketObject | undefined>;
  getMany?(objectPaths: string[], signal: AbortSignal): Promise<BucketObject[]>;
  upload(input: {
    objectPath: string;
    snapshotPath: string;
    mimeType: string;
    size: number;
    signal: AbortSignal;
    onProgress: (bytes: number) => void;
    /** Recheck retention readiness immediately before publishing the bucket object. */
    beforePublish?: () => Promise<void>;
  }): Promise<BucketObject>;
  delete(objectPaths: string[], signal: AbortSignal): Promise<BucketDeleteResult>;
}

export interface StoredDownloadJob extends DownloadJob {
  bucket: string;
  objectPath?: string;
  expectedVersion?: string;
  remoteHash?: string;
}
