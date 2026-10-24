import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FileAttachment, ImageAttachment } from '../../shared/types';
import type { AppContext } from '../context';
import { HttpError } from '../errors';
import { GitCheckpointService, sameLiveCheckpointRepository } from '../git-checkpoints';
import type { GitCheckpointCaptureResult, GitCheckpointCurrent, GitCheckpointManifest, GitCheckpointReference } from '../git-checkpoints/types';
import { PublicBucketVerifier, captureDurableReceipt } from '../file-transfers/durability';
import { assessHostAdmission, observeHostResources } from '../host-resources';
import { listWorktreeRecords } from '../worktrees/records';
import { inspectWorkspaceRepository } from '../worktrees/validation';
import { acquireWorkspaceActivity, allWorkspaceActivityKinds, clearWorkspaceRecoveryBarrier, setWorkspaceRecoveryBarrier, withWorkspaceRecoveryReview, withWorkspaceRemoval, workspaceActivityKinds } from '../worktrees/activity';
import { withWorkspaceFileMutationFence } from '../file-transfers/queue';
import { FileRewindTransaction } from './file-rewind-transaction';
import { verifyFileRewindMetadata } from './file-rewind-metadata';
import { inspectFileRewindRecovery, type FileRewindRecoveryRead } from './file-rewind-recovery-files';
import { assertRewindSourceRepairAllowed } from './file-rewind-source-authority';
import { absentCheckpointFile, affectedDirtyPaths, encodeRewindIndex, mergeRewindIndex, planFileRestore, safeRewindPath, sameCheckpointFile,
  type FileRestorePlan, type RewindTurnPair } from './file-rewind-plan';
import { FILE_REWIND_LIMITS, type FileRewindPreview, type FileRewindPreviewInput, type FileRewindSelection,
  type ThreadRewindPending, type ThreadRewindRecoveryRequired, type FileRewindKeepCurrentInput, type FileRewindKeepCurrentResult,
  type FileRewindRecoveryQuery, type FileRewindRecoveryReview, type FileRewindRecoveryRow, type WorkspaceRewindRecovery } from './file-rewind-types';

interface Signed<T> { version: 1; value: T; signature: string }
interface TurnCheckpointRecord {
  version: 1; workspaceId: string; threadId: string; turnId: string;
  before: GitCheckpointCaptureResult; after?: GitCheckpointCaptureResult;
  manualPaths: string[]; startedAt: string; completedAt?: string;
}
interface ActiveCheckpoint {
  record: TurnCheckpointRecord; revision: number; childGeneration: number; finishing?: boolean; pendingAfter: boolean; children: Set<string>;
}
interface TurnCaptureInput {
  workspaceId: string; threadId: string; turnId: string; parentThreadId?: string; rootThreadId: string; signal?: AbortSignal;
}
interface TurnFinishInput extends Omit<TurnCaptureInput, 'signal'> { hasActiveChildren?: boolean }

export interface FileRewindHistorySource {
  workspaceId: string;
  threadId: string;
  beforeTurnId: string;
  /** Only authoritative removed turns, never queued or cancelled inputs. */
  turnIds: string[];
  /** Hash of the exact saved transcript/model/queue record, not a visible page. */
  sourceDigest: string;
}
interface SavedPlan extends FileRewindHistorySource {
  version: 1; id: string; createdAt: string; expiresAt: string;
  target: GitCheckpointReference;
  current: GitCheckpointCurrent;
  restore: FileRestorePlan;
}

export interface RewindCompletionData {
  beforeTurnId: string;
  workspaceId: string;
  threadId: string;
  planId: string;
  planVersion: string;
  restoredPrompt: string;
  restoredAttachments?: ImageAttachment[];
  restoredFileAttachments?: FileAttachment[];
  filesUnchanged: boolean;
  filesRewound: number;
  backupId: string;
  recoveryId: string;
}
interface SavedOperation {
  version: 1; threadId: string; workspaceId: string; selection: FileRewindSelection; recoveryId: string;
  state: 'pending' | 'complete' | 'recovery_required' | 'kept_current';
  createdAt: string; updatedAt: string; completion: RewindCompletionData;
  message?: string; threadUnchanged?: boolean; blocking: boolean; familyIds: string[];
  sourceDigest: string; rewoundDigest?: string; acknowledgedVersion?: string;
  historyBackupDigest?: string;
  historyCutovers?: FileRewindCutover[];
}
export interface FileRewindCutover {
  intent: 'rewind' | 'rollback'; expectedLogicalDigest: string; expectedRawSha256: string;
  desiredLogicalDigest: string; desiredRawSha256: string;
}
interface SavedRecoveryReview {
  version: 1; recoveryId: string; workspaceId: string; operationDigest: string; fileToken: string; threadDigest: string;
  createdAt: string; expiresAt: string; rows: FileRewindRecoveryRow[];
  transcript: FileRewindRecoveryReview['transcript']; index: FileRewindRecoveryReview['index'];
}
interface ExpiredPreview { id: string; threadId: string; workspaceId: string; selectionVersion: string; discardedAt: string }
interface ExpiredPreviewTable { version: 1; previews: ExpiredPreview[] }
export type FileRewindOperationStatus = { status: 'not_started'; planId?: string; version?: string }
  | ThreadRewindPending | ThreadRewindRecoveryRequired | FileRewindKeepCurrentResult | ({ status: 'complete' } & RewindCompletionData);
export interface FileRewindCommitHooks {
  /** Persist and verify immutable original transcript/journal source first. */
  prepareHistory(): Promise<string>;
  /** Recheck the exact saved source, including external edits, before file work. */
  checkSource(): Promise<void>;
  /** Replace saved history only after every requested file/index change verifies. */
  commitHistory(checkpoint: (cutover: FileRewindCutover) => Promise<void>): Promise<string>;
  /** Guarded rollback; return false if a later source edit must be preserved. */
  rollbackHistory(checkpoint: (cutover: FileRewindCutover) => Promise<void>): Promise<boolean>;
}

const ISO = () => new Date().toISOString();
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const turnKey = (threadId: string, turnId: string) => `file-rewind-turn-${digest([threadId, turnId])}`;
const planKey = (planId: string) => `file-rewind-plan-${planId}`;
const operationKey = (planId: string) => `file-rewind-operation-${planId}`;
const latestKey = (threadId: string) => `file-rewind-latest-${threadId}`;
const blockKey = (workspaceId: string) => `file-rewind-block-${workspaceId}`;
const reviewKey = (recoveryId: string) => `file-rewind-review-${recoveryId}`;
const EXPIRED_PREVIEWS_KEY = 'file-rewind-expired-previews';
const validThread = (value: string) => /^thr_[a-f0-9]{32}$/u.test(value);
const validPlan = (value: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
const unavailable = (code: string, reason: string): GitCheckpointCaptureResult => ({ status: 'unavailable', code, reason });
const stale = () => new HttpError(409, 'The file rewind preview is stale. Refresh it and review the current files before confirming again.', 'FILE_REWIND_STALE');

/** Git file rewind is an explicit extension of CLI conversation rollback. The
 * pinned CLI retains immutable source rollouts and CAS cutover; its legacy
 * ghost_snapshot configuration no longer produces filesystem checkpoints. */
export class FileRewindService {
  readonly checkpoints: GitCheckpointService;
  private readonly roots = new Map<string, ActiveCheckpoint>();
  private readonly children = new Map<string, { rootThreadId: string; turnId: string }>();
  private readonly activeOperations = new Set<string>();
  private readonly activeAcknowledgements = new Set<string>();
  private readonly blockingByWorkspace = new Map<string, string>();
  private readonly recentPlans = new Map<string, number>();
  private readonly unusedPlans = new Set<string>();
  private readonly committingPlans = new Set<string>();
  private readonly retiredThreads = new Set<string>();
  private pruning?: Promise<void>;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private ready?: Promise<void>;
  private closed = false;
  private readonly manual = (event: { workspaceId?: string; paths?: string[]; phase?: string }) => {
    if (!event?.workspaceId || event.phase === 'end') return;
    const paths = Array.isArray(event.paths) && event.paths.length <= FILE_REWIND_LIMITS.files && event.paths.every(value => value === '*' || safeRewindPath(value)) ? event.paths : ['*'];
    for (const active of this.roots.values()) if (active.record.workspaceId === event.workspaceId) {
      active.record.manualPaths = [...new Set([...active.record.manualPaths, ...paths])];
      if (active.record.manualPaths.length > FILE_REWIND_LIMITS.files) active.record.manualPaths = ['*'];
      active.revision++;
    }
  };
  private readonly terminal = (event: { workspaceId?: string }) => {
    if (!event?.workspaceId) return;
    for (const active of this.roots.values()) { active.record.manualPaths = ['*']; active.revision++; }
  };

  constructor(private readonly ctx: AppContext) {
    this.checkpoints = new GitCheckpointService(ctx);
    ctx.events.on('workspace:manual-intent', this.manual);
    ctx.events.on('workspace:user-terminal', this.terminal);
  }

  /** Restore only signed admission barriers. Startup never replays filesystem
   * changes, a transcript cutover or a previous user's acknowledgement. */
  initialize(): Promise<void> {
    this.ready ??= (async () => {
      let directory: Awaited<ReturnType<typeof fs.opendir>>;
      try { directory = await fs.opendir(this.ctx.config.stateDir); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
      let scanned = 0;
      const attemptedPlans = new Set<string>();
      const recoverable: SavedOperation[] = [];
      for await (const entry of directory) {
        if (++scanned > 250_000) throw new HttpError(413, 'The rewind recovery registry needs maintenance before startup.', 'FILE_REWIND_LIMIT');
        const preview = /^file-rewind-plan-([a-f0-9-]{36})\.json$/u.exec(entry.name);
        if (preview) this.unusedPlans.add(preview[1]);
        const match = /^file-rewind-operation-([a-f0-9-]{36})\.json$/u.exec(entry.name);
        if (!match) continue;
        if (!entry.isFile()) throw new HttpError(409, 'A saved rewind recovery marker is not an ordinary file.', 'FILE_REWIND_RECORD_INVALID');
        const saved = await this.read<SavedOperation>(operationKey(match[1]));
        if (!saved) continue;
        attemptedPlans.add(match[1]);
        const operation = await this.workspaceOperation(saved.workspaceId, match[1]);
        if (!operation) continue;
        if (operation.blocking) { this.installBarriers(operation); recoverable.push(operation); }
        else this.releaseBarriers(operation);
      }
      // All barriers are restored first. This repairs only a missing metadata
      // name from a proved original CAS source; it never resumes file changes.
      for (const operation of recoverable) await this.repairMissingTranscript(operation);
      for (const id of attemptedPlans) this.unusedPlans.delete(id);
      await this.pruneUnusedPlans();
      if (!this.closed) {
        this.cleanupTimer = setInterval(() => { void this.pruneUnusedPlans().catch(() => undefined); }, 5 * 60_000);
        this.cleanupTimer.unref();
      }
    })();
    return this.ready;
  }

  private installBarriers(operation: SavedOperation): void {
    for (const workspaceId of operation.familyIds) {
      setWorkspaceRecoveryBarrier(this.ctx.config.workspacesDir, workspaceId,
        { recoveryId: operation.recoveryId, message: 'An unfinished file rewind needs review. Inspect recovery, then explicitly keep the current files or recover the saved originals before changing this repository.' });
      this.blockingByWorkspace.set(workspaceId, operation.recoveryId);
    }
  }
  private releaseBarriers(operation: SavedOperation): void {
    for (const workspaceId of operation.familyIds) {
      clearWorkspaceRecoveryBarrier(this.ctx.config.workspacesDir, workspaceId, operation.recoveryId);
      if (this.blockingByWorkspace.get(workspaceId) === operation.recoveryId) this.blockingByWorkspace.delete(workspaceId);
    }
  }

  private async repairMissingTranscript(operation: SavedOperation): Promise<void> {
    const intent = operation.historyCutovers?.at(-1);
    if (!intent || !['rewind', 'rollback'].includes(intent.intent)
      || [intent.expectedLogicalDigest, intent.expectedRawSha256, intent.desiredLogicalDigest, intent.desiredRawSha256].some(value => !/^[a-f0-9]{64}$/u.test(value))) return;
    try {
      const plan = await this.operationPlan(operation);
      const checkAllowed = async () => {
        // Do not read the canonical thread here: its JsonStore queue is held by
        // recoverConditionalKey. Other signed/lifecycle keys are independent.
        const latest = await this.workspaceOperation(operation.workspaceId, operation.recoveryId);
        if (!latest?.blocking || !latest.historyCutovers?.length || digest(latest.historyCutovers.at(-1)) !== digest(intent)
          || latest.threadId !== operation.threadId || latest.selection.version !== operation.selection.version) throw stale();
        await assertRewindSourceRepairAllowed(this.ctx, { threadId: operation.threadId, workspaceId: operation.workspaceId, repository: plan.current.repository });
      };
      await checkAllowed();
      await this.ctx.store.recoverConditionalKey(`thread-${operation.threadId}`, { threadId: operation.threadId, workspaceId: operation.workspaceId,
        expectedLogicalDigest: intent.expectedLogicalDigest, expectedRawSha256: intent.expectedRawSha256,
        desiredRawSha256: intent.desiredRawSha256, checkAllowed });
    } catch {
      // Missing/ambiguous/changed authority stays barred and inspectable. Do not
      // turn storage repair into successful rewind or a desired-history replay.
    }
  }
  private async saveOperation(operation: SavedOperation): Promise<void> {
    await this.write(operationKey(operation.recoveryId), operation);
    for (const workspaceId of operation.familyIds) await this.write(blockKey(workspaceId), operation);
  }
  private async workspaceOperation(workspaceId: string, recoveryId?: string): Promise<SavedOperation | null> {
    if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(workspaceId) || recoveryId !== undefined && !validPlan(recoveryId)) throw new HttpError(400, 'Choose a registered workspace recovery.', 'FILE_REWIND_SELECTION');
    recoveryId ??= this.blockingByWorkspace.get(workspaceId);
    const marker = await this.read<SavedOperation>(recoveryId ? operationKey(recoveryId) : blockKey(workspaceId));
    if (!marker) return null;
    const operation = recoveryId ? marker : await this.read<SavedOperation>(operationKey(marker.recoveryId)) ?? marker;
    if (!validPlan(operation.recoveryId) || operation.selection.planId !== operation.recoveryId || !Array.isArray(operation.familyIds)
      || operation.familyIds.length > 10_002
      || operation.familyIds.some(id => !/^[a-zA-Z0-9_-]{1,128}$/u.test(id))) {
      throw new HttpError(409, 'The saved workspace recovery ownership failed verification.', 'FILE_REWIND_RECORD_INVALID');
    }
    if (!operation.familyIds.includes(workspaceId)) throw new HttpError(404, 'That recovery does not belong to this workspace.', 'FILE_REWIND_NOT_FOUND');
    let incomplete = operation.blocking || operation.state === 'pending';
    for (const member of operation.familyIds) {
      const familyMarker = await this.read<SavedOperation>(blockKey(member));
      if (familyMarker?.recoveryId === operation.recoveryId && (familyMarker.blocking || familyMarker.state === 'pending')) incomplete = true;
    }
    if (incomplete && !operation.blocking) return { ...operation, state: 'recovery_required', blocking: true,
      message: 'Some saved recovery records still report an unfinished operation. Review the actual files and conversation before ending recovery.' };
    return operation;
  }

  private sign(value: unknown): string {
    return createHmac('sha256', this.ctx.config.sessionSecret).update(JSON.stringify(value)).digest('hex');
  }
  private async write<T>(key: string, value: T): Promise<void> {
    const record: Signed<T> = { version: 1, value, signature: this.sign(value) };
    if (Buffer.byteLength(`${JSON.stringify(record, null, 2)}\n`) > FILE_REWIND_LIMITS.metadataBytes) throw new HttpError(413, 'File rewind metadata exceeds its safe size limit.', 'FILE_REWIND_LIMIT');
    await this.ctx.store.write<Signed<T>>(key, record);
  }
  private async read<T>(key: string): Promise<T | null> {
    const result = await this.ctx.store.read<Signed<T> | null>(key, null);
    return this.verifySigned(result);
  }
  private verifySigned<T>(result: Signed<T> | null): T | null {
    if (result === null) return null;
    if (result.version !== 1 || !result.value || typeof result.signature !== 'string' || !/^[a-f0-9]{64}$/u.test(result.signature)
      || Buffer.byteLength(JSON.stringify(result.value)) > FILE_REWIND_LIMITS.metadataBytes
      || !timingSafeEqual(Buffer.from(result.signature, 'hex'), Buffer.from(this.sign(result.value), 'hex'))) {
      throw new HttpError(409, 'The saved file rewind record failed verification. No files were changed.', 'FILE_REWIND_RECORD_INVALID');
    }
    return result.value;
  }

  private async confirmSignedState(keys: readonly string[], verifier: PublicBucketVerifier): Promise<void> {
    for (const key of keys) {
      const value = await this.read<unknown>(key);
      if (value === null) throw new HttpError(409, 'A required recovery record is missing. Source backups were retained.', 'FILE_REWIND_RECORD_INVALID');
      const receipt = await captureDurableReceipt(this.ctx.config, path.join(this.ctx.config.stateDir, `${key}.json`), FILE_REWIND_LIMITS.metadataBytes);
      const serialized = `${JSON.stringify({ version: 1, value, signature: this.sign(value) }, null, 2)}\n`;
      if (receipt.sha256 !== createHash('sha256').update(serialized).digest('hex')) throw new HttpError(409,
        'A recovery receipt belongs to different record bytes. Source backups were retained.', 'FILE_REWIND_RECORD_INVALID');
      await verifier.verify([receipt]);
      if (digest(await this.read<unknown>(key)) !== digest(value)) throw stale();
    }
  }

  private pruneUnusedPlans(): Promise<void> {
    if (this.pruning) return this.pruning;
    const run = (async () => {
      for (const id of [...this.unusedPlans]) {
        if (this.committingPlans.has(id)) continue;
        const operation = await this.read<SavedOperation>(operationKey(id));
        if (operation) { this.unusedPlans.delete(id); continue; }
        const plan = await this.read<SavedPlan>(planKey(id));
        if (!plan) { this.unusedPlans.delete(id); continue; }
        if (this.retiredThreads.has(plan.threadId)) { this.unusedPlans.delete(id); this.recentPlans.delete(id); continue; }
        if (plan.id !== id || !Number.isFinite(Date.parse(plan.expiresAt))) throw new HttpError(409, 'An unused rewind preview failed ownership verification.', 'FILE_REWIND_RECORD_INVALID');
        if (Date.parse(plan.expiresAt) > Date.now()) continue;
        let release: () => void;
        try { release = acquireWorkspaceActivity(this.ctx.config.workspacesDir, plan.workspaceId, 'files'); }
        catch (error) {
          if (error instanceof HttpError && ['WORKTREE_BUSY', 'FILE_REWIND_RECOVERY_REQUIRED'].includes(error.code ?? '')) continue;
          throw error;
        }
        try {
        const currentPlan = await this.read<SavedPlan>(planKey(id));
        if (!currentPlan) { this.unusedPlans.delete(id); continue; }
        if (this.sign(currentPlan) !== this.sign(plan)) throw stale();
        try { await fs.lstat(path.join(this.ctx.config.stateDir, 'file-rewinds', id)); continue; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        if (this.committingPlans.has(id) || this.retiredThreads.has(plan.threadId)) continue;
        const receipt: ExpiredPreview = { id, threadId: plan.threadId, workspaceId: plan.workspaceId, selectionVersion: this.sign(plan), discardedAt: ISO() };
        await this.ctx.store.update<Signed<ExpiredPreviewTable> | null>(EXPIRED_PREVIEWS_KEY, null, current => {
          const table = this.verifySigned(current) ?? { version: 1 as const, previews: [] };
          if (table.version !== 1 || !Array.isArray(table.previews)) throw new HttpError(409, 'Expired rewind preview receipts failed verification.', 'FILE_REWIND_RECORD_INVALID');
          const cutoff = Date.now() - FILE_REWIND_LIMITS.expiredPreviewReceiptMilliseconds;
          const value: ExpiredPreviewTable = { version: 1, previews: [...table.previews.filter(item => item.id !== id && Date.parse(item.discardedAt) > cutoff), receipt]
            .slice(-FILE_REWIND_LIMITS.expiredPreviewReceipts) };
          return { version: 1, value, signature: this.sign(value) };
        });
        if (this.committingPlans.has(id) || this.retiredThreads.has(plan.threadId) || await this.read<SavedOperation>(operationKey(id))) continue;
        await this.ctx.store.delete(planKey(id)); this.unusedPlans.delete(id); this.recentPlans.delete(id);
        } finally { release(); }
      }
    })();
    this.pruning = run;
    void run.finally(() => { if (this.pruning === run) this.pruning = undefined; }).catch(() => undefined);
    return run;
  }
  private validateSelection(selection: FileRewindSelection): void {
    if (!selection || !validPlan(selection.planId) || !/^[a-f0-9]{64}$/u.test(selection.version)) throw new HttpError(400, 'Choose a verified file rewind preview.', 'FILE_REWIND_SELECTION');
  }
  private async checkResources(): Promise<void> {
    const admission = assessHostAdmission(await observeHostResources(this.ctx.config), { estimatedAdditionalBytes: 256 * 1024 * 1024 });
    if (!admission.allowed) throw new HttpError(503, admission.reason, 'FILE_REWIND_RESOURCES');
  }

  async beginTurn(input: TurnCaptureInput): Promise<void> {
    await this.initialize();
    if (this.closed) throw new HttpError(503, 'The server is closing. Send the message again after it returns.', 'FILE_REWIND_CLOSING');
    const recovery = await this.workspaceOperation(input.workspaceId);
    if (recovery?.blocking) throw new HttpError(409, 'An interrupted file rewind needs review before an agent can change this workspace. Open the conversation rewind recovery details.', 'FILE_REWIND_RECOVERY_REQUIRED');
    if (input.parentThreadId) {
      this.children.set(input.threadId, { rootThreadId: input.rootThreadId, turnId: input.turnId });
      const root = this.roots.get(input.rootThreadId);
      if (root) { root.children.add(input.threadId); root.childGeneration++; }
      return;
    }
    const existing = this.roots.get(input.threadId);
    if (existing) {
      existing.record.after = unavailable('OVERLAPPING_TURNS', 'Another root turn started before this agent family finished. The old turn has no isolated final file checkpoint.');
      existing.record.completedAt = ISO(); await this.write(turnKey(existing.record.threadId, existing.record.turnId), existing.record);
      this.roots.delete(input.threadId);
    }
    const activeChildren = new Set([...this.children].filter(([, value]) => value.rootThreadId === input.rootThreadId).map(([threadId]) => threadId));
    const activity = workspaceActivityKinds(this.ctx.config.workspacesDir, input.workspaceId);
    const otherRoots = [...this.roots.values()].filter(value => value.record.threadId !== input.rootThreadId);
    for (const other of otherRoots) { other.record.manualPaths = ['*']; other.revision++; }
    const manualPaths = activity.exclusive || Number(allWorkspaceActivityKinds(this.ctx.config.workspacesDir).terminal) > 0
      || otherRoots.length > 0 || ['git', 'files', 'extension', 'worktree'].some(kind => Number(activity.counts[kind as keyof typeof activity.counts]) > 0) || activeChildren.size ? ['*'] : [];
    const record: TurnCheckpointRecord = { version: 1, workspaceId: input.workspaceId, threadId: input.threadId, turnId: input.turnId,
      before: unavailable('CAPTURE_INTERRUPTED', 'The before-turn file checkpoint did not finish.'), manualPaths, startedAt: ISO() };
    const active: ActiveCheckpoint = { record, revision: 0, childGeneration: 0, pendingAfter: false, children: activeChildren };
    this.roots.set(input.threadId, active);
    try {
      await this.write(turnKey(input.threadId, input.turnId), record);
      record.before = await this.checkpoints.capture({ ...input, phase: 'before' });
      await this.write(turnKey(input.threadId, input.turnId), record);
    } catch (error) {
      this.roots.delete(input.threadId);
      throw error;
    }
  }

  async finishTurn(input: TurnFinishInput): Promise<void> {
    if (input.parentThreadId) {
      const child = this.children.get(input.threadId);
      if (child?.turnId !== input.turnId) return;
      this.children.delete(input.threadId);
      const root = this.roots.get(child.rootThreadId);
      if (root) { root.children.delete(input.threadId); root.childGeneration++; }
      if (root?.pendingAfter && !root.children.size && !input.hasActiveChildren) await this.finishRoot(root);
      return;
    }
    const active = this.roots.get(input.threadId);
    if (!active || active.record.turnId !== input.turnId) return;
    if (active.children.size || input.hasActiveChildren) { active.pendingAfter = true; return; }
    await this.finishRoot(active);
  }

  /** Admission may fail after the before snapshot but before a real turn starts.
   * Release attribution ownership without inventing a successful final snapshot. */
  async abortTurn(input: TurnCaptureInput): Promise<void> {
    if (input.parentThreadId) {
      const child = this.children.get(input.threadId);
      if (child?.turnId !== input.turnId) return;
      this.children.delete(input.threadId);
      const root = this.roots.get(child.rootThreadId);
      if (root) { root.children.delete(input.threadId); root.childGeneration++; }
      if (root?.pendingAfter && !root.children.size) await this.finishRoot(root);
      return;
    }
    const active = this.roots.get(input.threadId);
    if (!active || active.record.turnId !== input.turnId) return;
    active.record.after = unavailable('ADMISSION_FAILED', 'This turn did not finish admission. Its before snapshot is retained, but it has no completed file history.');
    active.record.completedAt = ISO();
    try { await this.write(turnKey(input.threadId, input.turnId), active.record); }
    finally { if (this.roots.get(input.threadId) === active) this.roots.delete(input.threadId); }
  }

  private async finishRoot(active: ActiveCheckpoint): Promise<void> {
    if (active.finishing) return;
    active.finishing = true;
    const record = active.record;
    const childGeneration = active.childGeneration;
    const checkChildren = () => {
      if (active.children.size || active.childGeneration !== childGeneration) record.after = unavailable('DELEGATION_OVERLAP',
        'Delegated work changed while the final file checkpoint was being captured. This turn has no isolated final file snapshot.');
    };
    try {
      record.after = record.before.status === 'ready'
        ? await this.checkpoints.capture({ workspaceId: record.workspaceId, threadId: record.threadId, turnId: record.turnId, phase: 'after' })
        : unavailable('BEFORE_UNAVAILABLE', record.before.reason);
      checkChildren();
      record.completedAt = ISO();
      for (let attempt = 0; attempt < 4; attempt++) {
        const revision = active.revision, generation = active.childGeneration;
        checkChildren();
        await this.write(turnKey(record.threadId, record.turnId), record);
        if (revision === active.revision && generation === active.childGeneration) return;
      }
      record.after = unavailable('CONCURRENT_MANUAL_ACTIVITY', 'Manual activity continued while the final checkpoint was saving. Its file changes were preserved.');
      await this.write(turnKey(record.threadId, record.turnId), record);
    } finally {
      if (this.roots.get(record.threadId) === active) this.roots.delete(record.threadId);
    }
  }

  private validateSource(source: FileRewindHistorySource): void {
    if (!validThread(source.threadId) || !/^[a-zA-Z0-9_-]{1,128}$/u.test(source.workspaceId) || !source.beforeTurnId
      || !/^[a-f0-9]{64}$/u.test(source.sourceDigest) || !source.turnIds.length || source.turnIds[0] !== source.beforeTurnId
      || source.turnIds.length > FILE_REWIND_LIMITS.turns || new Set(source.turnIds).size !== source.turnIds.length) {
      throw new HttpError(409, 'Choose at most 128 saved turns with a complete file checkpoint history. The conversation-only option remains available.', 'FILE_REWIND_UNAVAILABLE');
    }
  }
  private paging(input: FileRewindPreviewInput): { offset: number; limit: number } {
    const offset = input.offset ?? 0, limit = input.limit ?? FILE_REWIND_LIMITS.pageSize;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > FILE_REWIND_LIMITS.files * 2 || !Number.isSafeInteger(limit) || limit < 1 || limit > FILE_REWIND_LIMITS.maxPageSize) {
      throw new HttpError(400, 'Choose a bounded file rewind page.', 'FILE_REWIND_PAGE');
    }
    affectedDirtyPaths(input.dirtyPaths ?? [], []);
    return { offset, limit };
  }
  private unavailablePreview(source: FileRewindHistorySource, input: FileRewindPreviewInput, reason: string): FileRewindPreview {
    return { availability: 'unavailable', reason, workspaceId: source.workspaceId, threadId: source.threadId, beforeTurnId: source.beforeTurnId,
      index: { behavior: 'preserve', changedPaths: 0, description: 'No staged content will be changed.' }, rows: [], ...this.paging(input),
      total: 0, hasMore: false, affectedDirtyPaths: [], canCommit: false, warnings: [] };
  }
  private async readPlan(source: FileRewindHistorySource, selection: FileRewindSelection, expired = false): Promise<SavedPlan> {
    this.validateSelection(selection);
    const plan = await this.read<SavedPlan>(planKey(selection.planId));
    if (!plan || plan.id !== selection.planId || this.sign(plan) !== selection.version || plan.threadId !== source.threadId
      || plan.workspaceId !== source.workspaceId || plan.beforeTurnId !== source.beforeTurnId || plan.sourceDigest !== source.sourceDigest
      || !expired && Date.parse(plan.expiresAt) <= Date.now()) throw stale();
    return plan;
  }
  private publicPreview(plan: SavedPlan, input: FileRewindPreviewInput): FileRewindPreview {
    const { offset, limit } = this.paging(input), rows = plan.restore.rows;
    const dirty = affectedDirtyPaths(input.dirtyPaths ?? [], rows.map(row => row.path));
    return { availability: 'available', workspaceId: plan.workspaceId, threadId: plan.threadId, beforeTurnId: plan.beforeTurnId,
      planId: plan.id, version: this.sign(plan), expiresAt: plan.expiresAt,
      checkpoint: { id: plan.target.id, createdAt: plan.target.createdAt, head: plan.current.repository.head, branch: plan.current.repository.headRef },
      index: { behavior: plan.restore.indexConflict ? 'conflict' : plan.restore.index.length ? 'restore-captured-entries' : 'preserve', changedPaths: plan.restore.index.length,
        description: plan.restore.index.length ? 'Restore only these paths’ captured staging; unrelated staged content remains unchanged.' : 'Keep the current Git staging.' },
      rows: rows.slice(offset, offset + limit), offset, limit, total: rows.length, hasMore: offset + limit < rows.length,
      affectedDirtyPaths: dirty, canCommit: !dirty.length && !plan.restore.indexConflict && !rows.some(row => row.conflict), warnings: plan.restore.warnings };
  }

  async preview(source: FileRewindHistorySource, input: FileRewindPreviewInput): Promise<FileRewindPreview> {
    await this.initialize();
    this.paging(input);
    const blocking = await this.workspaceOperation(source.workspaceId);
    if (blocking?.blocking) {
      const preview = this.unavailablePreview(source, input, 'An earlier file rewind needs recovery review before another file restore can start.');
      const status = this.publicOperation(blocking);
      if (status.status === 'pending' || status.status === 'recovery_required') preview.recovery = status;
      return preview;
    }
    if (input.planId || input.version) {
      if (!input.planId || !input.version) throw stale();
      return this.publicPreview(await this.readPlan(source, { planId: input.planId, version: input.version }), input);
    }
    try { this.validateSource(source); }
    catch (error) { if (error instanceof HttpError && error.code === 'FILE_REWIND_UNAVAILABLE') return this.unavailablePreview(source, input, error.message); throw error; }
    const pairs: RewindTurnPair[] = [];
    for (const turnId of source.turnIds) {
      const record = await this.read<TurnCheckpointRecord>(turnKey(source.threadId, turnId));
      if (!record || record.threadId !== source.threadId || record.workspaceId !== source.workspaceId || record.turnId !== turnId) {
        return this.unavailablePreview(source, input, 'No saved file checkpoint belongs to at least one selected turn in this conversation. Turns from before file checkpoints, or inherited from another conversation, cannot be recovered from transcript text alone.');
      }
      if (record.before.status !== 'ready' || record.after?.status !== 'ready') {
        const reason = record.before.status === 'unavailable' ? record.before.reason : record.after?.status === 'unavailable' ? record.after.reason : 'The final file checkpoint did not finish, or its delegated agents are still working.';
        return this.unavailablePreview(source, input, reason);
      }
      pairs.push({ before: await this.checkpoints.read(record.before.checkpoint), after: await this.checkpoints.read(record.after.checkpoint), manualPaths: record.manualPaths });
    }
    const target = pairs[0].before, current = await this.checkpoints.inspectCurrent(target);
    let restore: FileRestorePlan;
    try { restore = planFileRestore(pairs, current); }
    catch (error) {
      if (error instanceof HttpError && ['FILE_REWIND_REPOSITORY_CHANGED', 'FILE_REWIND_UNAVAILABLE', 'FILE_REWIND_LIMIT'].includes(error.code ?? '')) return this.unavailablePreview(source, input, error.message);
      throw error;
    }
    for (const [id, expiry] of this.recentPlans) if (expiry <= Date.now()) this.recentPlans.delete(id);
    await this.pruneUnusedPlans();
    if (this.unusedPlans.size >= FILE_REWIND_LIMITS.unusedPlans) throw new HttpError(429, 'Unused file previews reached their storage limit. Close them and wait for expiration before creating another.', 'FILE_REWIND_PREVIEW_LIMIT');
    if (this.recentPlans.size >= FILE_REWIND_LIMITS.livePlans) throw new HttpError(429, 'Too many file previews are open. Close another preview or wait for it to expire.', 'FILE_REWIND_PREVIEW_LIMIT');
    const id = randomUUID(), createdAt = ISO(), expiresAt = new Date(Date.now() + FILE_REWIND_LIMITS.planMilliseconds).toISOString();
    const plan: SavedPlan = { ...source, version: 1, id, createdAt, expiresAt, target: { version: 1, id: target.id,
      workspaceId: target.workspaceId, threadId: target.threadId, turnId: target.turnId, phase: target.phase, createdAt: target.createdAt, manifestHash: target.manifestHash }, current, restore };
    await this.write(planKey(id), plan); this.recentPlans.set(id, Date.parse(expiresAt)); this.unusedPlans.add(id);
    return this.publicPreview(plan, input);
  }

  private publicOperation(operation: SavedOperation): Exclude<FileRewindOperationStatus, { status: 'not_started' }> {
    const identity = { beforeTurnId: operation.completion.beforeTurnId, workspaceId: operation.workspaceId, threadId: operation.threadId,
      planId: operation.selection.planId, planVersion: operation.selection.version };
    if (this.activeAcknowledgements.has(operation.recoveryId) || this.activeOperations.has(operation.recoveryId)) return { status: 'pending', ...identity, planId: operation.selection.planId, version: operation.selection.version,
      recoveryId: operation.recoveryId, message: 'The exact reviewed file and conversation rewind is still saving. Do not submit it again.' };
    if (operation.state === 'complete') return { status: 'complete', ...operation.completion };
    if (operation.state === 'kept_current') return this.keepCurrentReceipt(operation, operation.workspaceId);
    return { status: 'recovery_required', ...identity, recoveryId: operation.recoveryId, backupId: operation.completion.backupId,
      threadUnchanged: operation.threadUnchanged === true,
      message: operation.message ?? 'The server restarted before this file rewind confirmed its final state. Its original files, transcript and transaction record remain saved. Inspect them before continuing; no recovery was replayed automatically.' };
  }

  async status(threadId: string, selection?: FileRewindSelection): Promise<FileRewindOperationStatus> {
    await this.initialize();
    if (!validThread(threadId)) throw new HttpError(404, 'Conversation not found.', 'THREAD_NOT_FOUND');
    if (!selection) selection = await this.read<FileRewindSelection>(latestKey(threadId)) ?? undefined;
    if (!selection) return { status: 'not_started' };
    this.validateSelection(selection);
    const operation = await this.read<SavedOperation>(operationKey(selection.planId));
    if (!operation) {
      const plan = await this.read<SavedPlan>(planKey(selection.planId));
      if (!plan) {
        const expired = await this.read<ExpiredPreviewTable>(EXPIRED_PREVIEWS_KEY);
        const receipt = expired?.previews.find(item => item.id === selection.planId && item.threadId === threadId && item.selectionVersion === selection.version
          && Date.parse(item.discardedAt) > Date.now() - FILE_REWIND_LIMITS.expiredPreviewReceiptMilliseconds);
        if (receipt) return { status: 'not_started', ...selection };
      }
      if (!plan || plan.threadId !== threadId || this.sign(plan) !== selection.version) throw new HttpError(404, 'The file rewind record was not found for this conversation.', 'FILE_REWIND_NOT_FOUND');
      return { status: 'not_started', ...selection };
    }
    if (operation.threadId !== threadId || operation.selection.version !== selection.version) throw new HttpError(404, 'The file rewind record was not found for this conversation.', 'FILE_REWIND_NOT_FOUND');
    return this.publicOperation(await this.workspaceOperation(operation.workspaceId, operation.recoveryId) ?? operation);
  }

  async recoveryStatus(threadId: string, recoveryId: string): Promise<FileRewindOperationStatus> {
    await this.initialize();
    if (!validPlan(recoveryId)) throw new HttpError(404, 'The file rewind record was not found.', 'FILE_REWIND_NOT_FOUND');
    const operation = await this.read<SavedOperation>(operationKey(recoveryId));
    if (!operation || operation.threadId !== threadId) throw new HttpError(404, 'The file rewind record was not found for this conversation.', 'FILE_REWIND_NOT_FOUND');
    return this.publicOperation(await this.workspaceOperation(operation.workspaceId, operation.recoveryId) ?? operation);
  }

  async assertNoRecovery(workspaceId: string): Promise<void> {
    await this.initialize();
    if ((await this.workspaceOperation(workspaceId))?.blocking) throw new HttpError(409,
      'Review the unfinished file rewind before changing this repository or removing its conversation.', 'FILE_REWIND_RECOVERY_REQUIRED');
  }

  async retireThreadForDeletion(threadId: string): Promise<void> {
    if (!validThread(threadId)) throw new HttpError(404, 'Conversation not found.', 'THREAD_NOT_FOUND');
    if (this.roots.has(threadId) || this.children.has(threadId)) throw new HttpError(409, 'Wait for this conversation’s file capture to finish before deleting it.', 'THREAD_FAMILY_BUSY');
    this.retiredThreads.add(threadId);
    await this.pruning?.catch(() => undefined);
    for (const id of [...this.unusedPlans]) {
      const plan = await this.read<SavedPlan>(planKey(id));
      if (!plan || plan.threadId === threadId) { this.unusedPlans.delete(id); this.recentPlans.delete(id); }
    }
  }

  async recoveryThread(workspaceId: string, recoveryId: string): Promise<string> {
    await this.initialize();
    const operation = await this.workspaceOperation(workspaceId, recoveryId);
    if (!operation) throw new HttpError(404, 'That recovery does not belong to this workspace.', 'FILE_REWIND_NOT_FOUND');
    return operation.threadId;
  }

  async historyBackup(threadId: string, recoveryId: string): Promise<{ key: string; digest: string; workspaceId: string }> {
    await this.initialize();
    if (!validThread(threadId) || !validPlan(recoveryId)) throw new HttpError(404, 'The saved recovery source was not found.', 'FILE_REWIND_NOT_FOUND');
    await this.assertSourceNotDeleted(threadId);
    const operation = await this.read<SavedOperation>(operationKey(recoveryId));
    if (!operation || operation.threadId !== threadId || !/^history_[a-f0-9]{32}$/u.test(operation.completion.backupId)
      || !operation.historyBackupDigest || !/^[a-f0-9]{64}$/u.test(operation.historyBackupDigest)) {
      throw new HttpError(404, 'A verified original conversation backup is unavailable for this recovery.', 'FILE_REWIND_BACKUP_UNAVAILABLE');
    }
    return { key: `thread-backup-${operation.completion.backupId}`, digest: operation.historyBackupDigest, workspaceId: operation.workspaceId };
  }

  async recoveryFile(workspaceId: string, recoveryId: string, input: { path: string; side: 'original' | 'restored'; offset?: number; limit?: number }): Promise<FileRewindRecoveryRead> {
    await this.initialize();
    const operation = await this.workspaceOperation(workspaceId, recoveryId);
    if (!operation) throw new HttpError(404, 'That recovery does not belong to this workspace.', 'FILE_REWIND_NOT_FOUND');
    await this.assertSourceNotDeleted(operation.threadId);
    const plan = await this.operationPlan(operation), selected = plan.restore.files.find(file => file.path === input.path);
    if (!selected || !safeRewindPath(input.path)) throw new HttpError(404, 'That file is not part of the saved recovery.', 'FILE_REWIND_NOT_FOUND');
    const expected = input.side === 'original' ? selected.expected : selected.restore;
    const result = await inspectFileRewindRecovery({ directory: path.join(this.ctx.config.stateDir, 'file-rewinds'),
      workspaceId: operation.workspaceId, threadId: operation.threadId, recoveryId: operation.recoveryId, ...input });
    if (result.kind !== expected.kind || result.mode !== expected.mode || result.bytes !== expected.bytes || result.sha256 !== expected.sha256) {
      throw new HttpError(409, 'The retained file does not match its signed rewind source. No content was returned.', 'FILE_REWIND_RECORD_INVALID');
    }
    return result;
  }

  private async assertSourceNotDeleted(threadId: string): Promise<void> {
    try {
      await fs.lstat(path.join(this.ctx.config.stateDir, `thread-deleted-${threadId}.json`));
      throw new HttpError(404, 'This conversation was deleted. Its recovery source is no longer available.', 'FILE_REWIND_BACKUP_UNAVAILABLE');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }

  private recoveryPaging(query: FileRewindRecoveryQuery): { offset: number; limit: number } {
    return this.paging({ beforeTurnId: 'recovery', offset: query.offset, limit: query.limit });
  }

  private recoveryBase(operation: SavedOperation, query: FileRewindRecoveryQuery): FileRewindRecoveryReview {
    const active = this.activeOperations.has(operation.recoveryId) || this.activeAcknowledgements.has(operation.recoveryId);
    return { recoveryId: operation.recoveryId, workspaceId: operation.workspaceId, threadId: operation.threadId,
      beforeTurnId: operation.completion.beforeTurnId, backupId: operation.completion.backupId,
      planId: operation.selection.planId, planVersion: operation.selection.version,
      state: active ? 'pending' : operation.state === 'pending' ? 'recovery_required' : operation.state,
      blocking: active || operation.blocking, message: active ? 'This recovery action is still saving. Wait for its confirmed result before submitting another action.'
        : operation.message ?? (operation.state === 'complete' ? 'The reviewed files and conversation were rewound.' : 'An unfinished file rewind needs review. Its saved originals remain available.'),
      ...(operation.acknowledgedVersion ? { version: operation.acknowledgedVersion } : {}), canKeepCurrent: false,
      transcript: 'unknown', index: 'unavailable', rows: [], ...this.recoveryPaging(query), total: 0, hasMore: false };
  }

  private async operationPlan(operation: SavedOperation): Promise<SavedPlan> {
    const plan = await this.read<SavedPlan>(planKey(operation.selection.planId));
    if (!plan || plan.id !== operation.recoveryId || plan.workspaceId !== operation.workspaceId || plan.threadId !== operation.threadId
      || this.sign(plan) !== operation.selection.version) throw new HttpError(409, 'The recovery source plan failed verification.', 'FILE_REWIND_RECORD_INVALID');
    return plan;
  }

  private async observeRecovery(operation: SavedOperation, plan: SavedPlan): Promise<{ review: SavedRecoveryReview; current: GitCheckpointCurrent }> {
    await this.checkResources();
    await this.assertSourceNotDeleted(operation.threadId);
    const current = await this.checkpoints.inspectWorkspaceCurrent(operation.workspaceId, { paths: plan.restore.rows.map(row => row.path) });
    const thread = await this.ctx.store.read<{ thread?: { id?: string; workspaceId?: string } } | null>(`thread-${operation.threadId}`, null);
    const threadDigest = digest(thread);
    if (!thread || thread.thread?.id !== operation.threadId || thread.thread.workspaceId !== operation.workspaceId) {
      throw new HttpError(409, 'The current conversation source is missing or cannot be verified. Its retained backup must be inspected before ending recovery.', 'FILE_REWIND_RECOVERY_SOURCE');
    }
    const actualFiles = new Map(current.files.map(file => [file.path, file]));
    const files = new Map(plan.restore.files.map(file => [file.path, file]));
    const rows: FileRewindRecoveryRow[] = plan.restore.rows.map(row => {
      const file = files.get(row.path), currentFile = actualFiles.get(row.path) ?? absentCheckpointFile(row.path);
      const state: FileRewindRecoveryRow['state'] = !file ? 'original' : sameCheckpointFile(currentFile, file.expected) ? 'original'
        : sameCheckpointFile(currentFile, file.restore) ? 'restored' : currentFile.kind === 'missing' ? 'missing' : 'changed';
      return { path: row.path, state, staged: row.staged };
    });
    const restoredIndex = plan.restore.index.length ? encodeRewindIndex(mergeRewindIndex(plan.current.index.entries, plan.restore.index), plan.current.repository.objectFormat) : undefined;
    return { current, review: { version: 1, recoveryId: operation.recoveryId, workspaceId: operation.workspaceId,
      operationDigest: digest(operation), fileToken: current.token, threadDigest, createdAt: ISO(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(), rows,
      transcript: threadDigest === operation.sourceDigest || operation.historyCutovers?.some(item => item.intent === 'rollback' && item.desiredLogicalDigest === threadDigest) ? 'original'
        : threadDigest === operation.rewoundDigest || operation.historyCutovers?.some(item => item.intent === 'rewind' && item.desiredLogicalDigest === threadDigest) ? 'rewound' : 'changed',
      index: current.index.sha256 === plan.current.index.sha256 ? 'original'
        : restoredIndex && current.index.sha256 === createHash('sha256').update(restoredIndex).digest('hex') ? 'restored' : 'changed' } };
  }

  async workspaceRecovery(workspaceId: string, query: FileRewindRecoveryQuery = {}): Promise<WorkspaceRewindRecovery> {
    await this.initialize(); this.recoveryPaging(query);
    const operation = await this.workspaceOperation(workspaceId, query.recoveryId);
    if (!operation) {
      await this.ctx.workspaces.get(workspaceId);
      if (query.recoveryId) throw new HttpError(404, 'That recovery does not belong to this workspace.', 'FILE_REWIND_NOT_FOUND');
      return { workspaceId, recovery: null };
    }
    const result = this.recoveryBase(operation, query);
    result.workspaceId = workspaceId;
    if (operation.workspaceId !== workspaceId) {
      result.targetWorkspaceId = operation.workspaceId;
      try { result.targetWorkspaceName = (await this.ctx.workspaces.get(operation.workspaceId)).name; } catch { /* Retained signed recovery still remains visible for a missing checkout. */ }
    }
    if (result.state === 'pending') return { workspaceId, recovery: result };
    const plan = await this.operationPlan(operation);
    if (operation.state === 'complete' || operation.state === 'kept_current') {
      result.version = operation.acknowledgedVersion ?? operation.selection.version;
      if (query.version && query.version !== result.version) throw stale();
      result.rows = plan.restore.rows.slice(result.offset, result.offset + result.limit).map(row => ({ path: row.path, state: 'unavailable', staged: row.staged }));
      result.total = plan.restore.rows.length; result.hasMore = result.offset + result.limit < result.total;
      // These are retained source names, not a claim about later working files.
      return { workspaceId, recovery: result };
    }
    let review: SavedRecoveryReview;
    if (query.version) {
      const saved = await this.read<SavedRecoveryReview>(reviewKey(operation.recoveryId));
      if (!saved || this.sign(saved) !== query.version || saved.operationDigest !== digest(operation) || saved.workspaceId !== operation.workspaceId || Date.parse(saved.expiresAt) <= Date.now()) throw stale();
      review = saved;
    } else {
      try { ({ review } = await this.observeRecovery(operation, plan)); }
      catch (error) {
        if (error instanceof HttpError) { result.message = error.message; return { workspaceId, recovery: result }; }
        result.message = 'The current files or conversation could not be verified. Keep the recovery open and retry after storage is available.';
        return { workspaceId, recovery: result };
      }
      await this.write(reviewKey(operation.recoveryId), review);
    }
    result.version = this.sign(review); result.expiresAt = review.expiresAt; result.canKeepCurrent = true;
    result.transcript = review.transcript; result.index = review.index;
    result.rows = review.rows.slice(result.offset, result.offset + result.limit); result.total = review.rows.length;
    result.hasMore = result.offset + result.limit < result.total;
    result.message = 'Review the observed current files, staging and conversation. Keeping them ends recovery without replaying or undoing any file changes; the original backups remain saved.';
    return { workspaceId, recovery: result };
  }

  private keepCurrentReceipt(operation: SavedOperation, workspaceId: string): FileRewindKeepCurrentResult {
    return { status: 'kept_current', workspaceId, recoveryId: operation.recoveryId, version: operation.acknowledgedVersion!,
      ...(operation.workspaceId === workspaceId ? {} : { targetWorkspaceId: operation.workspaceId }),
      threadId: operation.threadId, beforeTurnId: operation.completion.beforeTurnId,
      planId: operation.selection.planId, planVersion: operation.selection.version,
      filesUnchanged: true, conversationUnchanged: true,
      message: 'The current files, staging and conversation were kept. Original rewind backups remain saved.' };
  }

  async keepCurrent(workspaceId: string, input: FileRewindKeepCurrentInput): Promise<FileRewindKeepCurrentResult> {
    await this.initialize();
    if (!validPlan(input.recoveryId) || !/^[a-f0-9]{64}$/u.test(input.version)) throw new HttpError(400, 'Choose a fresh recovery review.', 'FILE_REWIND_SELECTION');
    const selected = await this.workspaceOperation(workspaceId, input.recoveryId);
    if (!selected) throw new HttpError(404, 'That recovery does not belong to this workspace.', 'FILE_REWIND_NOT_FOUND');
    if (selected.state === 'kept_current' && selected.acknowledgedVersion === input.version) return this.keepCurrentReceipt(selected, workspaceId);
    if (this.activeOperations.has(input.recoveryId) || this.activeAcknowledgements.has(input.recoveryId)) throw new HttpError(409, 'This recovery action is still saving. Check its status before submitting again.', 'FILE_REWIND_PENDING');
    const family = [...selected.familyIds].sort();
    const operation = async (): Promise<FileRewindKeepCurrentResult> => {
      const currentOperation = await this.workspaceOperation(workspaceId, input.recoveryId);
      if (!currentOperation || currentOperation.state === 'complete' || currentOperation.state === 'kept_current') throw stale();
      const reviewed = await this.read<SavedRecoveryReview>(reviewKey(input.recoveryId));
      if (!reviewed || reviewed.operationDigest !== digest(currentOperation) || this.sign(reviewed) !== input.version
        || Date.parse(reviewed.expiresAt) <= Date.now()) throw stale();
      const plan = await this.operationPlan(currentOperation), { review, current } = await this.observeRecovery(currentOperation, plan);
      if (review.fileToken !== reviewed.fileToken || review.threadDigest !== reviewed.threadDigest) throw stale();
      if (this.ctx.config.requirePersistentData) {
        const verifier = new PublicBucketVerifier(this.ctx.config, { checkResources: () => this.checkResources() });
        const paths = new Set(plan.restore.rows.map(row => row.path)), files = current.files.filter(file => paths.has(file.path));
        await verifier.verify(files.filter(file => file.kind === 'file').map(file => ({ absolute: path.join(current.repository.root, file.path), size: file.bytes, sha256: file.sha256! })));
        await verifier.verifyAbsent(plan.restore.files.filter(file => (files.find(actual => actual.path === file.path)?.kind ?? 'missing') === 'missing')
          .map(file => path.join(current.repository.root, file.path)));
        await verifyFileRewindMetadata(this.ctx, plan.restore.files.map(file => {
          const actual = files.find(candidate => candidate.path === file.path) ?? absentCheckpointFile(file.path);
          return { absolute: path.join(current.repository.root, file.path), kind: actual.kind, mode: actual.mode, bytes: actual.bytes, sha256: actual.sha256 };
        }), verifier);
        if (current.index.present) await verifier.verify([await captureDurableReceipt(this.ctx.config, path.join(current.repository.gitDirectory, 'index'), 32 * 1024 * 1024)]);
        const source = await this.ctx.store.read<unknown>(`thread-${currentOperation.threadId}`, null);
        if (digest(source) !== reviewed.threadDigest) throw stale();
        const sourceReceipt = await captureDurableReceipt(this.ctx.config, path.join(this.ctx.config.stateDir, `thread-${currentOperation.threadId}.json`), 256 * 1024 * 1024);
        if (sourceReceipt.sha256 !== createHash('sha256').update(`${JSON.stringify(source, null, 2)}\n`).digest('hex')) throw stale();
        await verifier.verify([sourceReceipt]);
        const final = await this.observeRecovery(currentOperation, plan);
        if (final.review.fileToken !== reviewed.fileToken || final.review.threadDigest !== reviewed.threadDigest) throw stale();
      }
      currentOperation.state = 'kept_current'; currentOperation.blocking = false;
      currentOperation.acknowledgedVersion = input.version; currentOperation.updatedAt = ISO();
      currentOperation.message = 'The current files, staging and conversation were kept by explicit review. Original rewind backups remain saved.';
      try {
        await this.saveOperation(currentOperation);
        if (this.ctx.config.requirePersistentData) await this.confirmSignedState([operationKey(currentOperation.recoveryId), ...family.map(blockKey)],
          new PublicBucketVerifier(this.ctx.config, { checkResources: () => this.checkResources() }));
      } catch (error) {
        currentOperation.state = 'recovery_required'; currentOperation.blocking = true; delete currentOperation.acknowledgedVersion;
        currentOperation.message = 'Keeping the current files could not be confirmed in durable storage. Review recovery again before ending it.';
        await this.saveOperation(currentOperation).catch(() => undefined); this.installBarriers(currentOperation);
        throw error;
      }
      this.releaseBarriers(currentOperation);
      this.ctx.events.emit('workspace:changed', { workspaceId: currentOperation.workspaceId, paths: plan.restore.rows.map(row => row.path) });
      return this.keepCurrentReceipt(currentOperation, workspaceId);
    };
    const fence = (index: number): Promise<FileRewindKeepCurrentResult> => index === family.length ? operation()
      : withWorkspaceRecoveryReview(this.ctx.config.workspacesDir, family[index], input.recoveryId, () => fence(index + 1));
    const queue = (index: number): Promise<FileRewindKeepCurrentResult> => index === family.length ? fence(0)
      : withWorkspaceFileMutationFence(this.ctx.config.workspacesDir, family[index], () => queue(index + 1));
    this.activeAcknowledgements.add(input.recoveryId);
    try { return await queue(0); }
    finally { this.activeAcknowledgements.delete(input.recoveryId); }
  }

  /** Fence every registered checkout sharing Git administration. Existing PTYs,
   * agents, transfers and Git operations cause an honest conflict; none are killed. */
  private async exclusive<T>(plan: SavedPlan, operation: (familyIds: string[]) => Promise<T>): Promise<T> {
    const workspace = await this.ctx.workspaces.get(plan.workspaceId);
    const identity = await inspectWorkspaceRepository(this.ctx, workspace);
    if (!identity || identity.commonDirectory !== plan.current.repository.commonDirectory) throw stale();
    const records = await listWorktreeRecords(this.ctx);
    const family = [...new Set([plan.workspaceId, identity.repositoryWorkspace.id,
      ...records.filter(record => record.commonDirectory === identity.commonDirectory && record.phase !== 'removed').map(record => record.workspaceId)])].sort();
    const admitted = async () => {
      const current = await inspectWorkspaceRepository(this.ctx, await this.ctx.workspaces.get(plan.workspaceId));
      const currentRecords = await listWorktreeRecords(this.ctx);
      const currentFamily = [...new Set([plan.workspaceId, current?.repositoryWorkspace.id,
        ...currentRecords.filter(record => record.commonDirectory === identity.commonDirectory && record.phase !== 'removed').map(record => record.workspaceId)])].filter((id): id is string => !!id).sort();
      if (!current || current.commonDirectory !== identity.commonDirectory || digest(currentFamily) !== digest(family)) {
        throw new HttpError(409, 'The repository checkout family changed while rewind was waiting. Refresh its preview before continuing.', 'FILE_REWIND_STALE');
      }
      return operation(family);
    };
    const fence = (index: number): Promise<T> => index === family.length ? admitted()
      : withWorkspaceRemoval(this.ctx.config.workspacesDir, family[index], () => fence(index + 1));
    const queue = (index: number): Promise<T> => index === family.length ? fence(0)
      : withWorkspaceFileMutationFence(this.ctx.config.workspacesDir, family[index], () => queue(index + 1));
    try { return await queue(0); }
    catch (error) {
      if (error instanceof HttpError && error.code === 'WORKTREE_BUSY') throw new HttpError(409, 'Close terminals and finish agent, Git and file operations in this repository before rewinding files.', 'FILE_REWIND_WORKSPACE_BUSY');
      throw error;
    }
  }

  async commit(source: FileRewindHistorySource, selection: FileRewindSelection, dirtyPaths: string[], completion: Omit<RewindCompletionData, 'recoveryId' | 'filesRewound' | 'filesUnchanged' | 'planId' | 'planVersion'>,
    hooks: FileRewindCommitHooks): Promise<ThreadRewindRecoveryRequired | ({ status: 'complete' } & RewindCompletionData)> {
    this.validateSelection(selection);
    this.committingPlans.add(selection.planId);
    try {
    const existing = await this.status(source.threadId, selection);
    if (existing.status === 'complete' || existing.status === 'recovery_required') return existing;
    if (existing.status === 'kept_current') throw new HttpError(409, 'This recovery already ended by keeping the current files. Create a new preview for another rewind.', 'FILE_REWIND_ALREADY_ACKNOWLEDGED');
    if (existing.status === 'pending') throw new HttpError(409, 'This rewind is already saving. Check its status instead of submitting it again.', 'FILE_REWIND_PENDING');
    const plan = await this.readPlan(source, selection);
    if (plan.restore.rows.some(row => row.conflict)) throw new HttpError(409, 'The preview contains file or staging conflicts. No files were changed.', 'FILE_REWIND_CONFLICT');
    if (affectedDirtyPaths(dirtyPaths, plan.restore.rows.map(row => row.path)).length) throw new HttpError(409, 'Save or close the affected dirty editor buffers before rewinding files.', 'FILE_REWIND_DIRTY_BUFFERS');
    return await this.exclusive(plan, async familyIds => {
      const previous = await this.workspaceOperation(plan.workspaceId);
      if (previous?.blocking) throw new HttpError(409, 'An earlier file rewind needs recovery review first.', 'FILE_REWIND_RECOVERY_REQUIRED');
      await hooks.checkSource();
      const target = await this.checkpoints.read(plan.target);
      const actual = await this.checkpoints.inspectCurrent(target);
      if (actual.token !== plan.current.token || !sameLiveCheckpointRepository(actual.repository, plan.current.repository)) throw stale();
      const manifests = new Map<string, GitCheckpointManifest>([[target.id, target]]);
      const loadManifest = async (reference: GitCheckpointReference) => {
        let value = manifests.get(reference.id);
        if (!value) { value = await this.checkpoints.read(reference); manifests.set(reference.id, value); }
        return value;
      };
      const objects = new Map<string, Buffer>();
      for (const change of plan.restore.index) for (const entry of change.restore) {
        // A null intent-to-add entry deliberately has no staged Git object.
        // Preserve its index flag/OID instead of inventing empty file content.
        if (entry.intentToAdd && /^0+$/u.test(entry.objectId) && !entry.blob) continue;
        if (!entry.blob) throw new HttpError(409, 'A captured staged object is missing. No files were changed.', 'FILE_REWIND_INDEX_INVALID');
        if (!objects.has(entry.objectId)) objects.set(entry.objectId, await this.checkpoints.readBlob(await loadManifest(change.checkpoint), entry.blob));
      }
      const verify = this.ctx.config.requirePersistentData ? new PublicBucketVerifier(this.ctx.config, { checkResources: () => this.checkResources() }) : undefined;
      const transaction = new FileRewindTransaction({ directory: path.join(this.ctx.config.stateDir, 'file-rewinds'),
        requireDurableReceipt: this.ctx.config.requirePersistentData, verifyDurable: verify ? receipts => verify.verify(receipts) : undefined,
        verifyMetadata: verify ? entries => verifyFileRewindMetadata(this.ctx, entries, verify) : undefined,
        verifyAbsent: verify ? paths => verify.verifyAbsent(paths) : undefined, checkResources: () => this.checkResources(),
        checkAllowed: async () => {
          const repository = await this.checkpoints.assertRepository(target);
          if (!sameLiveCheckpointRepository(repository, plan.current.repository)) throw stale();
        } });
      const operation: SavedOperation = { version: 1, threadId: plan.threadId, workspaceId: plan.workspaceId, selection,
        recoveryId: plan.id, state: 'pending', blocking: true, createdAt: ISO(), updatedAt: ISO(),
        familyIds, sourceDigest: source.sourceDigest,
        completion: { ...completion, planId: selection.planId, planVersion: selection.version, recoveryId: plan.id,
          filesUnchanged: plan.restore.rows.length === 0, filesRewound: plan.restore.rows.length } };
      let prepared = false, historyCommitted = false, recorded = false, applyAttempted = false;
      const checkpointHistory = async (cutover: FileRewindCutover) => {
        if (!['rewind', 'rollback'].includes(cutover.intent)
          || [cutover.expectedLogicalDigest, cutover.expectedRawSha256, cutover.desiredLogicalDigest, cutover.desiredRawSha256].some(value => !/^[a-f0-9]{64}$/u.test(value))
          || (operation.historyCutovers?.length ?? 0) >= 2) throw new HttpError(409, 'The history cutover receipt is invalid. Recovery copies were retained.', 'FILE_REWIND_RECORD_INVALID');
        (operation.historyCutovers ??= []).push({ ...cutover });
        await this.saveOperation(operation);
        if (verify) await this.confirmSignedState([operationKey(plan.id), ...familyIds.map(blockKey)], verify);
      };
      this.activeOperations.add(operation.recoveryId);
      try {
        await this.saveOperation(operation); recorded = true;
        await this.write(latestKey(plan.threadId), selection); this.installBarriers(operation);
        operation.historyBackupDigest = await hooks.prepareHistory();
        await this.saveOperation(operation);
        await transaction.prepare({ id: plan.id, workspaceId: plan.workspaceId, threadId: plan.threadId, repository: actual.repository,
          files: await Promise.all(plan.restore.files.map(async file => ({ expected: file.expected, restore: file.restore,
            readRestore: async () => file.restore.kind === 'missing' ? Buffer.alloc(0) : this.checkpoints.readBlob(await loadManifest(file.checkpoint), file.restore.blob!) }))),
          ...(plan.restore.index.length ? { index: { expected: actual.index, restore: encodeRewindIndex(mergeRewindIndex(actual.index.entries, plan.restore.index), actual.repository.objectFormat),
            objects: [...objects].map(([objectId, bytes]) => ({ objectId, bytes })) } } : {}) });
        prepared = true;
        if (verify) await this.confirmSignedState([planKey(plan.id), operationKey(plan.id), latestKey(plan.threadId), ...familyIds.map(blockKey)], verify);
        await hooks.checkSource();
        await this.readPlan(source, selection, true);
        applyAttempted = true;
        await transaction.apply();
        operation.rewoundDigest = await hooks.commitHistory(checkpointHistory); historyCommitted = true;
        await transaction.commit();
        operation.state = 'complete'; operation.blocking = false; operation.updatedAt = ISO();
        await this.saveOperation(operation);
        if (verify) await this.confirmSignedState([operationKey(plan.id), ...familyIds.map(blockKey)], verify);
        this.releaseBarriers(operation);
        this.ctx.events.emit('workspace:changed', { workspaceId: plan.workspaceId, paths: plan.restore.rows.map(row => row.path) });
        return { status: 'complete', ...operation.completion };
      } catch (error) {
        if (!prepared && !recorded) throw error;
        // Once the saved history and files both committed, do not undo them just
        // because the final receipt is uncertain. Recovery reports the ambiguity.
        let threadUnchanged = false, filesRolledBack = !applyAttempted;
        if (!historyCommitted) {
          try { threadUnchanged = await hooks.rollbackHistory(checkpointHistory); } catch { /* Later transcript writes are never overwritten. */ }
          try {
            const state = transaction.status().state;
            filesRolledBack ||= state === 'rolled_back';
            if (state === 'applied') filesRolledBack = (await transaction.rollback()).state === 'rolled_back';
          } catch { /* Retain verified originals and report recovery. */ }
        }
        operation.state = 'recovery_required'; operation.threadUnchanged = threadUnchanged; operation.blocking = historyCommitted || !threadUnchanged || !filesRolledBack;
        operation.updatedAt = ISO();
        operation.message = operation.blocking
          ? 'The file rewind could not confirm one complete transaction. Original files, staged content and conversation backups remain saved. Inspect the recovery record before continuing; later edits were preserved.'
          : 'The file rewind stopped and its applied changes were rolled back. The original files and conversation remain saved. Review the current workspace before creating a new preview.';
        let saved = false;
        try { await this.saveOperation(operation); saved = true; } catch { operation.blocking = true; }
        await this.write(latestKey(plan.threadId), selection).catch(() => undefined);
        if (saved && !operation.blocking) this.releaseBarriers(operation); else this.installBarriers(operation);
        return { status: 'recovery_required', beforeTurnId: source.beforeTurnId, workspaceId: source.workspaceId, threadId: source.threadId,
          planId: selection.planId, planVersion: selection.version,
          recoveryId: operation.recoveryId, backupId: operation.completion.backupId,
          threadUnchanged, message: operation.message };
      } finally { this.activeOperations.delete(operation.recoveryId); await transaction.close(); }
    });
    } finally { this.committingPlans.delete(selection.planId); }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.ctx.events.off('workspace:manual-intent', this.manual);
    this.ctx.events.off('workspace:user-terminal', this.terminal);
    await this.ready?.catch(() => undefined);
    await this.pruning?.catch(() => undefined);
    await this.checkpoints.close();
  }
}

const services = new WeakMap<AppContext, FileRewindService>();
export function getFileRewindService(ctx: AppContext): FileRewindService {
  let service = services.get(ctx);
  if (!service) { service = new FileRewindService(ctx); services.set(ctx, service); }
  return service;
}

export async function closeFileRewindService(ctx: AppContext): Promise<void> {
  const service = services.get(ctx); services.delete(ctx); await service?.close();
}

export function initializeFileRewinds(ctx: AppContext): Promise<void> {
  return getFileRewindService(ctx).initialize();
}
