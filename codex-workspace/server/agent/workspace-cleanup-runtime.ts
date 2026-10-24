import type { AppContext } from '../context';
import { HttpError } from '../errors';
import type { WorkspaceArtifactCleanupRequest } from '../workspace-trash/service';

export interface WorkspaceConversationCleanupParticipant {
  /** Stop accepting owned work synchronously, before waiting on any writer. */
  quiesce(request: WorkspaceArtifactCleanupRequest): Promise<void>;
  markDeleted?(request: WorkspaceArtifactCleanupRequest, threadId: string): Promise<void>;
  /** Forget only process-local copies. Durable deletion belongs to the leaf. */
  forget(workspaceId: string, threadIds: ReadonlySet<string>): Promise<void>;
  /** Release only temporary metadata leases, even when a purge needs retry. */
  afterAttempt?(request: WorkspaceArtifactCleanupRequest, quiesced: boolean): Promise<void>;
  resumeAfterAttempt?(): void;
}

const participants = new WeakMap<AppContext, Map<symbol, WorkspaceConversationCleanupParticipant>>();
const removing = new WeakMap<AppContext, Map<string, { deletionId: string; deletedAt: string }>>();
const attempts = new WeakMap<AppContext, Set<string>>();

export function registerWorkspaceConversationCleanup(ctx: AppContext, name: string,
  participant: WorkspaceConversationCleanupParticipant): () => void {
  const entries = participants.get(ctx) ?? new Map<symbol, WorkspaceConversationCleanupParticipant>(), token = Symbol(name);
  // Replacement services may briefly coexist during lifecycle recovery/tests.
  // Every live instance retains its drain until its own disposer runs.
  entries.set(token, participant); participants.set(ctx, entries);
  return () => { if (entries.get(token) === participant) entries.delete(token); };
}

export function workspaceConversationCleanupActive(ctx: AppContext): boolean { return !!attempts.get(ctx)?.size; }

export function workspaceConversationCleanupBusy(): HttpError {
  return new HttpError(409, 'Saved memory state is being updated by workspace deletion. Retry after cleanup finishes.', 'WORKSPACE_CONVERSATION_CLEANUP_BUSY');
}

export function workspaceConversationRemovalPending(ctx: AppContext, workspaceId: string): boolean {
  return removing.get(ctx)?.has(workspaceId) === true;
}

export function assertWorkspaceConversationAvailable(ctx: AppContext, workspaceId: string): void {
  if (workspaceConversationRemovalPending(ctx, workspaceId)) throw new HttpError(409,
    'This workspace is being permanently deleted. Its saved conversations cannot be changed.', 'WORKSPACE_CONVERSATIONS_DELETING');
}

/** The workspace lifecycle has already admitted removal and checked its journal.
 * This is a writer fence, never a replacement for that deletion authority. */
export function beginWorkspaceConversationCleanup(ctx: AppContext, request: WorkspaceArtifactCleanupRequest): void {
  const entries = removing.get(ctx) ?? new Map<string, { deletionId: string; deletedAt: string }>();
  const previous = entries.get(request.workspaceId);
  if (previous && (previous.deletionId !== request.deletionId || previous.deletedAt !== request.deletedAt)) throw new HttpError(409,
    'A different workspace deletion owns the conversation cleanup. Current saved data was retained.', 'WORKSPACE_ARTIFACT_CLEANUP_CHANGED');
  entries.set(request.workspaceId, { deletionId: request.deletionId, deletedAt: request.deletedAt }); removing.set(ctx, entries);
  const active = attempts.get(ctx) ?? new Set<string>(); active.add(request.workspaceId); attempts.set(ctx, active);
}

/** A failed current deletion remains fenced for its retry. Only a superseding
 * lifecycle generation may release it; callers must have verified that fact. */
export function releaseSupersededWorkspaceConversationCleanup(ctx: AppContext, request: WorkspaceArtifactCleanupRequest): void {
  const entries = removing.get(ctx), previous = entries?.get(request.workspaceId);
  if (previous?.deletionId === request.deletionId && previous.deletedAt === request.deletedAt) entries!.delete(request.workspaceId);
}

export async function waitForConversationCleanup(work: Promise<unknown>, milliseconds = 15_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new HttpError(503,
        'Saved conversation work is still stopping. Permanent deletion remains pending and can be retried.', 'WORKSPACE_CONVERSATION_DRAIN_PENDING')), milliseconds);
      timer.unref?.();
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function quiesceWorkspaceConversationWriters(ctx: AppContext, request: WorkspaceArtifactCleanupRequest): Promise<void> {
  // Do not construct an engine or memory service on the startup path. A timeout
  // only leaves cancellation/draining alive; it never starts durable deletion.
  for (const participant of participants.get(ctx)?.values() ?? []) {
    await request.assertCurrent();
    await waitForConversationCleanup(participant.quiesce(request));
  }
  await waitForConversationCleanup(ctx.store.flush());
  await request.assertCurrent();
}

export async function forgetWorkspaceConversationCaches(ctx: AppContext, workspaceId: string, threadIds: ReadonlySet<string>): Promise<void> {
  for (const participant of participants.get(ctx)?.values() ?? []) await participant.forget(workspaceId, threadIds);
}

export async function markWorkspaceConversationThreadDeleted(ctx: AppContext, request: WorkspaceArtifactCleanupRequest, threadId: string): Promise<boolean> {
  let handled = false;
  for (const participant of participants.get(ctx)?.values() ?? []) if (participant.markDeleted) {
    await request.assertCurrent(); await participant.markDeleted(request, threadId); handled = true;
  }
  return handled;
}

export async function finishWorkspaceConversationCleanupAttempt(ctx: AppContext, request: WorkspaceArtifactCleanupRequest, quiesced: boolean): Promise<void> {
  let failed = false, firstError: unknown;
  const remember = (error: unknown) => { if (!failed) { failed = true; firstError = error; } };
  try {
    for (const participant of participants.get(ctx)?.values() ?? []) {
      try { await participant.afterAttempt?.(request, quiesced); }
      catch (error) { remember(error); }
    }
  } finally {
    attempts.get(ctx)?.delete(request.workspaceId);
    for (const participant of participants.get(ctx)?.values() ?? []) {
      try { participant.resumeAfterAttempt?.(); }
      catch (error) { remember(error); }
    }
  }
  if (failed) throw firstError;
}
