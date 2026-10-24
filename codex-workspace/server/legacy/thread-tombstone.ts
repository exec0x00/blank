import type { ConversationCleanupFiles } from '../agent/workspace-conversation-cleanup-files';
import { conversationCleanupFailure } from '../agent/workspace-conversation-cleanup-files';

const threadIdPattern = /^thr_[a-f0-9]{32}$/;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function validMarker(value: unknown, threadId: string): boolean {
  return object(value) && value.version === 1 && value.id === threadId && typeof value.deletedAt === 'string'
    && value.deletedAt.length >= 20 && value.deletedAt.length <= 40 && Number.isFinite(Date.parse(value.deletedAt));
}

/** Only the existing permanent-workspace cleanup may call this after proving
 * the exact thread owner and persisting its signed cleanup receipt. Uses that
 * caller's pinned I/O and actual JsonStore key queue; no index/agent is created.
 * Remaining summaries/aggregate rows are removed by the caller's already
 * validated cleanup inventory, after every permanent marker is verified. */
export async function markLegacyThreadDeleted(files: Pick<ConversationCleanupFiles, 'update' | 'read'>,
  threadId: string): Promise<void> {
  if (!threadIdPattern.test(threadId)) throw conversationCleanupFailure();
  const key = 'thread-deleted-' + threadId;
  await files.update(key, 4096, current => {
    if (current !== undefined) {
      if (!validMarker(current, threadId)) throw conversationCleanupFailure();
      return current;
    }
    return { version: 1, id: threadId, deletedAt: new Date().toISOString() };
  });
  const saved = await files.read(key, 4096);
  if (!saved || !validMarker(saved.value, threadId)) throw conversationCleanupFailure('changed');
}
