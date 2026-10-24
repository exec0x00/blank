import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { AppContext } from '../context';
import { HttpError } from '../errors';
import type { WorkspaceArtifactCleanupRequest } from '../workspace-trash/service';
import { workspaceActivityKinds, workspaceRecoveryBarrier } from '../worktrees/activity';
import { cleanupWorkspaceMemoryFiles } from '../memories/workspace-cleanup';
import { cleanupStateCasForThreads, discoverStateCasThreadIds } from '../state-cas-cleanup';
import { markLegacyThreadDeleted } from '../legacy/thread-tombstone';
import { beginWorkspaceConversationCleanup, finishWorkspaceConversationCleanupAttempt, forgetWorkspaceConversationCaches, quiesceWorkspaceConversationWriters,
  markWorkspaceConversationThreadDeleted, releaseSupersededWorkspaceConversationCleanup } from './workspace-cleanup-runtime';
import { ConversationCleanupFiles, WORKSPACE_CONVERSATION_CLEANUP_LIMITS as LIMITS, conversationCleanupFailure,
  type CleanupFile, type CleanupFileReference } from './workspace-conversation-cleanup-files';

const threadPattern = /^thr_[a-f0-9]{32}$/;
const workspacePattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const turnPattern = /^[a-z0-9_]{1,132}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const fullPattern = /^thread-(thr_[a-f0-9]{32})$/;
const summaryPattern = /^thread-summary-(thr_[a-f0-9]{32})$/;
const contextPattern = /^thread-context-(thr_[a-f0-9]{32})$/;
const agentPattern = /^agent-(thr_[a-f0-9]{32})$/;
const journalPattern = /^thread-turn-(thr_[a-f0-9]{32})-([a-z0-9_]{1,132})$/;
const backupPattern = /^thread-backup-history_[a-f0-9]{32}$/;
const reviewPattern = /^review-snapshot-(review_[a-f0-9]{32})$/;
const sidecarPattern = /^thread-(?:naming|goal|view)-(thr_[a-f0-9]{32})$/;
const payloadKey = (key: string) => fullPattern.test(key) || summaryPattern.test(key) || contextPattern.test(key)
  || agentPattern.test(key) || journalPattern.test(key) || backupPattern.test(key) || reviewPattern.test(key) || sidecarPattern.test(key);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const reference = (file: CleanupFile): CleanupFileReference => ({ key: file.key, sha256: file.sha256, bytes: file.bytes });

interface CleanupReceipt {
  version: 1;
  workspaceId: string;
  deletionId: string;
  deletedAt: string;
  threadIds: string[];
  files: CleanupFileReference[];
}
interface SignedReceipt { version: 1; value: CleanupReceipt; signature: string }
interface Inventory {
  owners: Map<string, string>;
  threadIds: Set<string>;
  files: Map<string, CleanupFileReference>;
  casThreadIds: Set<string>;
}

function requireThread(value: unknown): string {
  if (typeof value !== 'string' || !threadPattern.test(value)) throw conversationCleanupFailure();
  return value;
}
function requireWorkspace(value: unknown): string {
  if (typeof value !== 'string' || !workspacePattern.test(value)) throw conversationCleanupFailure();
  return value;
}
function signature(ctx: AppContext, value: CleanupReceipt): string {
  return createHmac('sha256', ctx.config.sessionSecret).update('workspace-conversation-cleanup-v1\0').update(JSON.stringify(value)).digest('hex');
}
function validateReceipt(ctx: AppContext, request: WorkspaceArtifactCleanupRequest, raw: unknown): CleanupReceipt {
  if (!object(raw) || raw.version !== 1 || !object(raw.value) || typeof raw.signature !== 'string' || !hashPattern.test(raw.signature)) throw conversationCleanupFailure();
  const value = raw.value;
  if (value.version !== 1 || value.workspaceId !== request.workspaceId || value.deletionId !== request.deletionId || value.deletedAt !== request.deletedAt
    || !Array.isArray(value.threadIds) || value.threadIds.length > LIMITS.records || !Array.isArray(value.files) || value.files.length > LIMITS.records) throw conversationCleanupFailure();
  for (const threadId of value.threadIds) requireThread(threadId);
  if (new Set(value.threadIds).size !== value.threadIds.length) throw conversationCleanupFailure();
  const keys = new Set<string>();
  for (const entry of value.files) {
    if (!object(entry) || typeof entry.key !== 'string' || !payloadKey(entry.key) || keys.has(entry.key)
      || typeof entry.sha256 !== 'string' || !hashPattern.test(entry.sha256) || !Number.isSafeInteger(entry.bytes)
      || (entry.bytes as number) < 2 || (entry.bytes as number) > LIMITS.recordBytes) throw conversationCleanupFailure();
    keys.add(entry.key);
  }
  const receipt = value as unknown as CleanupReceipt;
  if (!timingSafeEqual(Buffer.from(raw.signature, 'hex'), Buffer.from(signature(ctx, receipt), 'hex'))) throw conversationCleanupFailure();
  return receipt;
}

/** Only exact, independently attributed records or validated saved references
 * become removal targets. A basename is never enough to own legacy journals. */
async function inspect(ctx: AppContext, files: ConversationCleanupFiles, request: WorkspaceArtifactCleanupRequest,
  previous?: CleanupReceipt): Promise<Inventory> {
  const keys = await files.inventory(), owners = new Map<string, string>(), targets = new Map<string, CleanupFileReference>();
  const legacyJournals = new Map<string, string>(), referencedBackups = new Map<string, string>(), referencedReviews = new Map<string, string>();
  const ancestry: Array<{ id: string; workspaceId: string; parent?: string; root?: string }> = [];
  const oldReferences = new Map(previous?.files.map(entry => [entry.key, entry]) ?? []);
  const own = (threadId: string, workspaceId: string) => {
    requireThread(threadId); requireWorkspace(workspaceId);
    const existing = owners.get(threadId);
    if (existing !== undefined && existing !== workspaceId) throw conversationCleanupFailure();
    owners.set(threadId, workspaceId);
    if (owners.size > LIMITS.records) throw conversationCleanupFailure('limit');
  };
  const add = (file: CleanupFile) => {
    const expected = oldReferences.get(file.key);
    if (expected && (expected.sha256 !== file.sha256 || expected.bytes !== file.bytes)) throw conversationCleanupFailure('changed');
    targets.set(file.key, reference(file));
    if (targets.size > LIMITS.records) throw conversationCleanupFailure('limit');
  };
  const rememberReference = (map: Map<string, string>, key: string, workspaceId: string) => {
    const other = map.get(key);
    if (other !== undefined && other !== workspaceId) throw conversationCleanupFailure();
    map.set(key, workspaceId);
    if (map.size > LIMITS.records) throw conversationCleanupFailure('limit');
  };
  const savedRecord = (raw: unknown, expectedId?: string) => {
    if (!object(raw) || !object(raw.thread) || !Array.isArray(raw.thread.messages) || !Array.isArray(raw.input)) throw conversationCleanupFailure();
    const threadId = requireThread(raw.thread.id), workspaceId = requireWorkspace(raw.thread.workspaceId);
    if (expectedId !== undefined && expectedId !== threadId) throw conversationCleanupFailure();
    own(threadId, workspaceId);
    const parent = raw.thread.parentThreadId === undefined ? undefined : requireThread(raw.thread.parentThreadId);
    const root = raw.thread.rootThreadId === undefined ? undefined : requireThread(raw.thread.rootThreadId);
    ancestry.push({ id: threadId, workspaceId, parent, root });
    if (raw.turnJournals !== undefined) {
      if (!object(raw.turnJournals) || Object.keys(raw.turnJournals).length > LIMITS.records) throw conversationCleanupFailure();
      for (const [turnId, key] of Object.entries(raw.turnJournals)) {
        if (!turnPattern.test(turnId) || key !== `thread-turn-${threadId}-${turnId}` || !journalPattern.test(key as string)) throw conversationCleanupFailure();
        rememberReference(legacyJournals, key as string, workspaceId);
      }
    }
    if (raw.pendingJournal !== undefined) {
      if (!object(raw.pendingJournal) || typeof raw.pendingJournal.turnId !== 'string' || !turnPattern.test(raw.pendingJournal.turnId)
        || !Array.isArray(raw.pendingJournal.input)) throw conversationCleanupFailure();
      rememberReference(legacyJournals, `thread-turn-${threadId}-${raw.pendingJournal.turnId}`, workspaceId);
    }
    if (raw.historyBackups !== undefined) {
      if (!Array.isArray(raw.historyBackups) || raw.historyBackups.length > LIMITS.records) throw conversationCleanupFailure();
      for (const key of raw.historyBackups) {
        if (typeof key !== 'string' || !backupPattern.test(key)) throw conversationCleanupFailure();
        rememberReference(referencedBackups, key, workspaceId);
      }
    }
    if (raw.reviewSnapshots !== undefined) {
      if (!object(raw.reviewSnapshots) || Object.keys(raw.reviewSnapshots).length > LIMITS.records) throw conversationCleanupFailure();
      for (const [reviewId, key] of Object.entries(raw.reviewSnapshots)) {
        if (!/^review_[a-f0-9]{32}$/.test(reviewId) || key !== `review-snapshot-${reviewId}`) throw conversationCleanupFailure();
        rememberReference(referencedReviews, key as string, workspaceId);
      }
    }
    return { threadId, workspaceId };
  };

  for (const threadId of previous?.threadIds ?? []) own(threadId, request.workspaceId);
  // A preserved conditional-write source may be the only surviving canonical
  // owner after an earlier interrupted thread deletion. Its validated bodies
  // also retain exact references to legacy journals and review copies.
  const casThreadIds = new Set(await discoverStateCasThreadIds(ctx.config, {
    workspaceId: request.workspaceId, threadIds: previous?.threadIds,
    checkAllowed: async () => { await request.assertCurrent(); await files.check(); },
    onOwnedSource: (threadId, source) => {
      if (savedRecord(source, threadId).workspaceId !== request.workspaceId) throw conversationCleanupFailure();
    },
  }));
  for (const threadId of casThreadIds) own(threadId, request.workspaceId);
  // Shared metadata can preserve exact workspace attribution after a crash
  // removed a full thread. It is cross-checked against every remaining source.
  for (const key of ['thread-index', 'agent-index']) {
    const file = await files.read(key, LIMITS.aggregateBytes);
    if (!file) continue;
    if (!Array.isArray(file.value) || file.value.length > LIMITS.records) throw conversationCleanupFailure();
    for (const row of file.value) {
      if (!object(row)) throw conversationCleanupFailure();
      own(requireThread(row.id), requireWorkspace(row.workspaceId));
    }
  }

  for (const key of keys) {
    const full = fullPattern.exec(key), summary = summaryPattern.exec(key), context = contextPattern.exec(key), agent = agentPattern.exec(key);
    const backup = backupPattern.test(key), review = reviewPattern.exec(key), journal = journalPattern.exec(key);
    if (!full && !summary && !context && !agent && !backup && !review && !journal) continue;
    const file = await files.read(key);
    if (!file) continue;
    const raw = file.value;
    let workspaceId: string | undefined;
    if (full) workspaceId = savedRecord(raw, full[1]).workspaceId;
    else if (summary) {
      if (!object(raw)) throw conversationCleanupFailure();
      const value = raw.version === 1 ? raw.summary : raw;
      if (!object(value) || value.id !== summary[1]) throw conversationCleanupFailure();
      workspaceId = requireWorkspace(value.workspaceId); own(summary[1], workspaceId);
    } else if (context) {
      if (!object(raw) || raw.version !== 1 || raw.threadId !== context[1]) throw conversationCleanupFailure();
      workspaceId = requireWorkspace(raw.workspaceId); own(context[1], workspaceId);
    } else if (agent) {
      if (!object(raw) || raw.version !== 1 || !object(raw.agent) || raw.agent.id !== agent[1] || !Array.isArray(raw.notifications)) throw conversationCleanupFailure();
      workspaceId = requireWorkspace(raw.agent.workspaceId); own(agent[1], workspaceId);
      ancestry.push({ id: agent[1], workspaceId, parent: requireThread(raw.agent.parentThreadId), root: requireThread(raw.agent.rootThreadId) });
    } else if (backup) {
      if (!object(raw) || ![1, 2].includes(raw.version as number)) throw conversationCleanupFailure();
      workspaceId = savedRecord(raw.record, requireThread(raw.threadId)).workspaceId;
    } else if (review) {
      if (!object(raw) || raw.version !== 1 || raw.id !== review[1]) throw conversationCleanupFailure();
      workspaceId = requireWorkspace(raw.workspaceId);
    } else if (journal) {
      if (!object(raw) || raw.turnId !== journal[2] || !Array.isArray(raw.input)) throw conversationCleanupFailure();
      if (raw.version === 2) {
        if (raw.threadId !== journal[1]) throw conversationCleanupFailure();
        workspaceId = requireWorkspace(raw.workspaceId); own(journal[1], workspaceId);
      } else if (raw.workspaceId !== undefined || raw.threadId !== undefined) throw conversationCleanupFailure();
      // Legacy ownership is resolved after every full record and backup has
      // contributed its exact turn-journal references below.
    }
    if (workspaceId === request.workspaceId) add(file);
  }

  for (const row of ancestry) for (const related of [row.parent, row.root]) {
    if (related && owners.has(related) && owners.get(related) !== row.workspaceId) throw conversationCleanupFailure();
  }
  for (const key of keys) {
    const journal = journalPattern.exec(key), sidecar = sidecarPattern.exec(key);
    const referenced = referencedBackups.get(key) ?? referencedReviews.get(key);
    if (referenced !== undefined) {
      const target = targets.has(key);
      if (target && referenced !== request.workspaceId || !target && referenced === request.workspaceId && await files.read(key)) throw conversationCleanupFailure();
    }
    if (!journal && !sidecar) continue;
    const file = await files.read(key);
    if (!file) continue;
    const threadId = (journal ?? sidecar)![1], owner = owners.get(threadId);
    if (!owner) {
      // Bare view counters contain no source material. Every other sidecar can
      // hold user text, and an unowned legacy orphan prevents a complete purge.
      if (key.startsWith('thread-view-')) continue;
      throw conversationCleanupFailure();
    }
    if (owner !== request.workspaceId) continue;
    if (journal) {
      if (!object(file.value) || file.value.turnId !== journal[2] || !Array.isArray(file.value.input)) throw conversationCleanupFailure();
      if (file.value.version !== 2 && legacyJournals.get(key) !== owner && !oldReferences.has(key)) throw conversationCleanupFailure();
    } else if (key.startsWith('thread-goal-')) {
      if (!object(file.value) || file.value.version !== 1 || file.value.threadId !== threadId
        || object(file.value.goal) && file.value.goal.threadId !== threadId) throw conversationCleanupFailure();
    } else if (key.startsWith('thread-view-')) {
      if (!object(file.value) || file.value.version !== 1 || !Number.isSafeInteger(file.value.nextRevision)) throw conversationCleanupFailure();
    } else if (file.value !== null && (!object(file.value) || file.value.version !== 1)) throw conversationCleanupFailure();
    add(file);
  }
  // Signed exact references outlive the canonical parent and allow a crashed
  // deletion to resume without inventing ownership from a key prefix.
  for (const entry of previous?.files ?? []) {
    const file = await files.read(entry.key);
    if (file) {
      if (file.sha256 !== entry.sha256 || file.bytes !== entry.bytes) throw conversationCleanupFailure('changed');
      targets.set(entry.key, entry);
    }
  }
  return { owners, threadIds: new Set([...owners].filter(([, owner]) => owner === request.workspaceId).map(([id]) => id)), files: targets, casThreadIds };
}

async function clearSharedRecords(files: ConversationCleanupFiles, request: WorkspaceArtifactCleanupRequest, inventory: Inventory): Promise<void> {
  for (const key of ['thread-index', 'agent-index']) await files.update(key, LIMITS.aggregateBytes, current => {
    if (current === undefined) return undefined;
    if (!Array.isArray(current) || current.length > LIMITS.records) throw conversationCleanupFailure();
    return current.filter(row => {
      if (!object(row)) throw conversationCleanupFailure();
      const id = requireThread(row.id), owner = requireWorkspace(row.workspaceId);
      if (inventory.owners.has(id) && inventory.owners.get(id) !== owner) throw conversationCleanupFailure();
      if (owner !== request.workspaceId) return true;
      if (!inventory.threadIds.has(id)) throw conversationCleanupFailure('changed');
      return false;
    });
  });
  await files.update('thread-goal-index', LIMITS.aggregateBytes, current => {
    if (current === undefined) return undefined;
    if (!Array.isArray(current) || current.length > LIMITS.records) throw conversationCleanupFailure();
    return current.filter(id => !inventory.threadIds.has(requireThread(id)));
  });
  await files.update('thread-naming-pending', LIMITS.aggregateBytes, current => {
    if (current === undefined) return undefined;
    if (!object(current) || Object.keys(current).length > LIMITS.records) throw conversationCleanupFailure();
    return Object.fromEntries(Object.entries(current).filter(([id]) => !inventory.threadIds.has(requireThread(id))));
  });
  await files.update('agent-changes', LIMITS.aggregateBytes, current => {
    if (current === undefined) return undefined;
    if (!Array.isArray(current) || current.length > 100_000) throw conversationCleanupFailure('limit');
    const ids = new Set<string>();
    return current.filter(row => {
      if (!object(row) || typeof row.id !== 'string' || !row.id || row.id.length > 128 || ids.has(row.id)
        || typeof row.workspaceId !== 'string' || !workspacePattern.test(row.workspaceId)
        || typeof row.threadId !== 'string' || !row.threadId || row.threadId.length > 128
        || typeof row.path !== 'string' || !row.path || row.path.length > 4096
        || !['pending', 'kept', 'undone'].includes(row.status as string)
        || !(row.original === null || typeof row.original === 'string') || !(row.modified === null || typeof row.modified === 'string')) throw conversationCleanupFailure();
      ids.add(row.id);
      if (row.workspaceId !== request.workspaceId) return true;
      const owner = inventory.owners.get(row.threadId);
      if (owner !== undefined && owner !== request.workspaceId) throw conversationCleanupFailure();
      return false;
    });
  });
}

/** Permanent-workspace leaf. Ordinary archive/trash never calls this function.
 * The caller already owns withWorkspaceRemoval and has removed workspace/file
 * trash bytes. Rewind cleanup must run first while its backup proofs remain. */
export async function cleanupWorkspaceConversationState(ctx: AppContext, request: WorkspaceArtifactCleanupRequest): Promise<void> {
  requireWorkspace(request.workspaceId);
  if (typeof request.deletionId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(request.deletionId)
    || !['trash', 'permanent'].includes(request.mode) || !Number.isFinite(Date.parse(request.deletedAt))) throw conversationCleanupFailure();
  await request.assertCurrent();
  const admission = workspaceActivityKinds(ctx.config.workspacesDir, request.workspaceId);
  if (!admission.exclusive || workspaceRecoveryBarrier(ctx.config.workspacesDir, request.workspaceId)
    || Object.values(admission.counts).some(count => count)) throw new HttpError(409,
    'Conversation cleanup requires the existing exclusive workspace removal operation.', 'WORKSPACE_CONVERSATION_REMOVAL_REQUIRED');
  beginWorkspaceConversationCleanup(ctx, request);
  let files: ConversationCleanupFiles | undefined;
  let quiesced = false;
  try {
    await quiesceWorkspaceConversationWriters(ctx, request);
    quiesced = true;
    files = await ConversationCleanupFiles.open(ctx, request);
    const receiptKey = `workspace-conversation-cleanup-${createHash('sha256').update(JSON.stringify([request.workspaceId, request.deletionId])).digest('hex')}`;
    const saved = await files.read(receiptKey, LIMITS.receiptBytes);
    const previous = saved ? validateReceipt(ctx, request, saved.value) : undefined;
    const inventory = await inspect(ctx, files, request, previous);
    const retained = new Map(previous?.files.map(entry => [entry.key, entry]) ?? []);
    for (const [key, entry] of inventory.files) retained.set(key, entry);
    const receipt: CleanupReceipt = { version: 1, workspaceId: request.workspaceId, deletionId: request.deletionId,
      deletedAt: request.deletedAt, threadIds: [...inventory.threadIds].sort(), files: [...retained.values()].sort((a, b) => a.key.localeCompare(b.key)) };
    const envelope: SignedReceipt = { version: 1, value: receipt, signature: signature(ctx, receipt) };
    await files.update(receiptKey, LIMITS.receiptBytes, current => {
      if (current !== undefined) validateReceipt(ctx, request, current);
      return envelope;
    });
    const verified = await files.read(receiptKey, LIMITS.receiptBytes);
    if (!verified) throw conversationCleanupFailure('changed');
    validateReceipt(ctx, request, verified.value);
    // Preserve permanent markers without constructing the retired thread index.
    // The already-pinned cleanup owns subsequent summary/aggregate removal.
    for (const threadId of inventory.threadIds) {
      await request.assertCurrent();
      if (!await markWorkspaceConversationThreadDeleted(ctx, request, threadId)) await markLegacyThreadDeleted(files, threadId);
    }
    await cleanupStateCasForThreads(ctx.config, { workspaceId: request.workspaceId, threadIds: [...inventory.threadIds],
      checkAllowed: async () => { await request.assertCurrent(); await files!.check(); },
      withSourceMutation: (key, operation) => ctx.store.mutateGuarded(key, operation) });
    await clearSharedRecords(files, request, inventory);
    // Derived copies and exact journals go first; the signed receipt preserves
    // proof even if a process stops after any individual unlink.
    const ordered = [...inventory.files.values()].sort((a, b) => Number(fullPattern.test(a.key)) - Number(fullPattern.test(b.key)) || a.key.localeCompare(b.key));
    for (const entry of ordered) await files.remove(entry);
    await request.assertCurrent();
    await cleanupWorkspaceMemoryFiles(ctx, request);
    const remaining = await inspect(ctx, files, request, receipt);
    if (remaining.files.size || remaining.casThreadIds.size) throw conversationCleanupFailure('changed');
    await clearSharedRecords(files, request, remaining);
    await forgetWorkspaceConversationCaches(ctx, request.workspaceId, inventory.threadIds);
    await request.assertCurrent();
  } catch (error) {
    // A superseding restore/new generation cannot inherit this process-local
    // workspace fence. Existing per-thread tombstones remain authoritative.
    try { await request.assertCurrent(); }
    catch (currentError) {
      if (currentError instanceof HttpError && currentError.code === 'WORKSPACE_ARTIFACT_CLEANUP_CHANGED') releaseSupersededWorkspaceConversationCleanup(ctx, request);
    }
    throw error;
  } finally {
    await files?.close();
    await finishWorkspaceConversationCleanupAttempt(ctx, request, quiesced);
  }
}
