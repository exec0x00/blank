import type { AppContext } from '../context';
import { ConversationFileStorage, type ConversationFileCleanupOptions } from './storage';
import { cleanupWorkspaceFileUploadJobs } from './service';
import { conversationFileScope, drainConversationWorkspace, withConversationWorkspaceDeletion } from './coordination';

/**
 * Internal permanent-deletion hook, never a REST endpoint. The workspace trash
 * coordinator supplies current deletion authority and already owns its removal
 * gate. Ordinary trash/restore must not call this function.
 */
export function cleanupWorkspaceConversationFiles(ctx: AppContext, workspaceId: string,
  options: ConversationFileCleanupOptions = {}): Promise<{ filesRemoved: number }> {
  const scope = conversationFileScope(ctx.config.stateDir);
  return withConversationWorkspaceDeletion(scope, workspaceId, async () => {
    const storage = new ConversationFileStorage(ctx);
    try {
      await options.assertCurrent?.();
      await storage.fenceWorkspace(workspaceId, options);
      await options.assertCurrent?.();
      await drainConversationWorkspace(scope, workspaceId);
      await options.assertCurrent?.();
      const result = await storage.cleanupWorkspaceOriginals(workspaceId, options);
      await options.assertCurrent?.();
      await storage.withStateDirectory(directory => cleanupWorkspaceFileUploadJobs(ctx, workspaceId, directory, options));
      await options.assertCurrent?.();
      return result;
    } finally { await storage.close(); }
  });
}
