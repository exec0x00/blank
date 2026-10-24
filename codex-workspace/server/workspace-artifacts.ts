import type { AppContext } from './context';
import type { WorkspaceArtifactCleanupRequest } from './workspace-trash/service';
import { cleanupWorkspaceFileRewinds } from './agent/file-rewind-cleanup';
import { cleanupWorkspaceConversationState } from './agent/workspace-conversation-cleanup';
import { cleanupWorkspaceConversationFiles } from './conversation-files';
import { cleanupWorkspaceImageAttachments } from './agent/attachments';
import { cleanupWorkspaceGeneratedImages } from './generated-images';
import { cleanupWorkspaceGitCheckpoints } from './git-checkpoints';
import { cleanupWorkspaceTerminalHistory } from './terminal-history-cleanup';
import { cleanupWorkspaceGitDiscardBackups } from './git-discard-cleanup';
import { cleanupWorkspaceProjectExtensions } from './project-extensions-cleanup';
import { getClaudeConversations } from './agent';

/** The caller owns the exact permanent-removal generation and its exclusive
 * workspace gate. These leaves must not initialize a workspace or reacquire it.
 * Normal restorable trash never calls this composition. */
export async function cleanupWorkspaceArtifacts(ctx: AppContext, request: WorkspaceArtifactCleanupRequest): Promise<void> {
  const { workspaceId } = request;
  const assertCurrent = () => request.assertCurrent();
  await assertCurrent();
  await getClaudeConversations(ctx).cleanupWorkspace(request);
  await assertCurrent();
  // Rewind ownership proofs can refer to the original conversation backups.
  await cleanupWorkspaceFileRewinds(ctx, workspaceId);
  await assertCurrent();
  await cleanupWorkspaceConversationState(ctx, request);
  await assertCurrent();
  await cleanupWorkspaceGitDiscardBackups(ctx, request);
  await assertCurrent();
  await cleanupWorkspaceProjectExtensions(ctx, request);
  await assertCurrent();
  await cleanupWorkspaceTerminalHistory(ctx, request);
  await assertCurrent();
  await cleanupWorkspaceConversationFiles(ctx, workspaceId, { assertCurrent });
  await assertCurrent();
  await cleanupWorkspaceImageAttachments(ctx, workspaceId, { assertCurrent });
  await assertCurrent();
  await cleanupWorkspaceGeneratedImages(ctx, workspaceId, { assertCurrent });
  await assertCurrent();
  await cleanupWorkspaceGitCheckpoints(ctx.config, workspaceId);
  await assertCurrent();
}
