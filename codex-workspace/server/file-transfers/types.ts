import type { Stats } from 'node:fs';
import type { OperationalPage } from '../operational-pages';

export type TransferKind = 'copy' | 'move';
export type TransferPhase = 'copying' | 'verifying' | 'removing' | 'complete' | 'interrupted';

export interface TransferIdentity {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  mode: number;
}

export interface TransferTreeEntry {
  path: string;
  kind: 'file' | 'directory' | 'symlink';
  source: TransferIdentity;
  destination?: TransferIdentity;
  sha256?: string;
  target?: string;
}

/** Hashes and identities only; file bytes remain at their ordinary native paths. */
export interface TransferManifest {
  version: 1;
  entries: TransferTreeEntry[];
  bytes: number;
}

export interface NativeTransferOptions {
  /** Canonical native directory containing both paths. Never the filesystem root. */
  root: string;
  source: string;
  destination: string;
  kind: TransferKind;
  expectedSource?: TransferIdentity;
  deadline?: number;
  /** Called before writes, after verification, and before the first source unlink. */
  checkpoint?: (phase: Exclude<TransferPhase, 'interrupted'>, manifest?: TransferManifest) => Promise<void>;
  /** A hosting-specific durability check. Local fsync alone is not a remote receipt. */
  verifyDurable?: (manifest: TransferManifest) => Promise<void>;
  /** Recheck registration/admission after long copies or durability checks. */
  checkAllowed?: () => Promise<void>;
  /** Refresh host admission between bounded chunks during a long operation. */
  checkResources?: () => Promise<void>;
}

export interface StoredFileTransfer {
  version: 1;
  id: string;
  workspaceId: string;
  kind: TransferKind;
  path: string;
  newPath: string;
  phase: TransferPhase;
  createdAt: string;
  updatedAt: string;
  issue?: string;
  interruptedPhase?: 'copying' | 'verifying' | 'removing';
}

export interface FileTransferStatus {
  id: string;
  workspaceId: string;
  kind: TransferKind;
  path: string;
  newPath: string;
  state: 'running' | 'interrupted';
  phase: Exclude<TransferPhase, 'complete' | 'interrupted'>;
  createdAt: string;
  updatedAt: string;
  issue?: string;
}

export type FileTransferPage = OperationalPage<FileTransferStatus>;

export function fileIdentity(stat: Stats): TransferIdentity {
  return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, mode: stat.mode & 0o7777 };
}

export function sameIdentity(stat: Pick<Stats, 'dev' | 'ino'>, expected: TransferIdentity): boolean {
  return stat.dev === expected.dev && stat.ino === expected.ino;
}

export function sameVersion(stat: Pick<Stats, 'dev' | 'ino' | 'size' | 'mtimeMs' | 'ctimeMs' | 'mode'>, expected: TransferIdentity): boolean {
  return sameIdentity(stat, expected) && stat.size === expected.size && stat.mtimeMs === expected.mtimeMs
    && stat.ctimeMs === expected.ctimeMs && (stat.mode & 0o7777) === expected.mode;
}
