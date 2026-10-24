import type { AppContext } from './context';
import { HttpError } from './errors';
import { ConversationCleanupFiles } from './agent/workspace-conversation-cleanup-files';
import type { WorkspaceArtifactCleanupRequest } from './workspace-trash/service';
import { workspaceActivityKinds, workspaceRecoveryBarrier } from './worktrees/activity';

const workspaceIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const recordBytes = 32 * 1024 * 1024;
const maxRows = 10_000;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function invalid(): HttpError {
  return new HttpError(409, 'Project extension ownership or saved state changed. Remaining records were retained and permanent deletion can be retried.', 'WORKSPACE_PROJECT_EXTENSIONS_CLEANUP_OWNERSHIP');
}

/** Remove only rows whose explicit owner and registry identity agree. Source
 * paths, marketplace references and disabled IDs do not establish ownership. */
function withoutProjectRows(value: unknown, kind: 'plugin' | 'marketplace', workspaceId: string): unknown[] {
  if (!Array.isArray(value) || value.length > maxRows) throw invalid();
  const identifier = new RegExp(`^${kind}_[a-f0-9]{32}$`);
  return value.filter(row => {
    if (!object(row)) throw invalid();
    if (row.scope !== 'project' || row.workspaceId !== workspaceId) return true;
    if (typeof row.id !== 'string' || !identifier.test(row.id)) throw invalid();
    return false;
  });
}

/** Called only after permanent removal (including expiry of ordinary trash),
 * under the caller's existing exclusive gate and exact deletion generation.
 * It never initializes a workspace, extension service or agent runtime.
 *
 * Project plugin manifests retain descriptions and inline hook scripts in this
 * registry even after their files disappear. Project marketplaces also retain
 * source/revision metadata. The skill index contains only ownership and baseline
 * hashes, so it and all shared enablement/preferences remain untouched. */
export async function cleanupWorkspaceProjectExtensions(ctx: AppContext, request: WorkspaceArtifactCleanupRequest): Promise<void> {
  if (!request || typeof request.workspaceId !== 'string' || !workspaceIdPattern.test(request.workspaceId)
    || typeof request.deletionId !== 'string' || !workspaceIdPattern.test(request.deletionId)
    || (request.mode !== 'trash' && request.mode !== 'permanent') || typeof request.deletedAt !== 'string'
    || request.deletedAt.length > 64 || !Number.isFinite(Date.parse(request.deletedAt)) || typeof request.assertCurrent !== 'function') throw invalid();
  const workspaceId = request.workspaceId, assertGeneration = request.assertCurrent.bind(request);
  const assertCurrent = async (): Promise<void> => {
    await assertGeneration();
    const activity = workspaceActivityKinds(ctx.config.workspacesDir, workspaceId);
    if (!activity.exclusive || Object.values(activity.counts).some(count => (count ?? 0) > 0)
      || workspaceRecoveryBarrier(ctx.config.workspacesDir, workspaceId)) throw invalid();
  };
  const owned = Object.freeze({ workspaceId, deletionId: request.deletionId, mode: request.mode, deletedAt: request.deletedAt, assertCurrent });
  await assertCurrent();
  let files: ConversationCleanupFiles | undefined;
  try {
    // This helper owns only pinned state-file I/O. Its update callback shares
    // JsonStore's actual per-key queue with installs and independent home edits.
    files = await ConversationCleanupFiles.open(ctx, owned);
    await files.update('extensions', recordBytes, async current => {
      await assertCurrent();
      if (current === undefined) return undefined;
      if (!object(current) || current.version !== 1 || !Array.isArray(current.skills)
        || !Array.isArray(current.disabledSkills) || !Array.isArray(current.disabledPlugins)
        || !object(current.builtinFingerprints)) throw invalid();
      return { ...current,
        plugins: withoutProjectRows(current.plugins, 'plugin', workspaceId),
        marketplaces: withoutProjectRows(current.marketplaces, 'marketplace', workspaceId),
      };
    });
    await assertCurrent();
    // The custom plugin execution/catalog runtime has been retired. Durable
    // ownership filtering above does not construct or invalidate that runtime.
    ctx.events.emit('extensions:changed', { workspaceId });
  } catch (error) {
    // Keep outside errno and caller generation errors intact for their owners.
    if (error instanceof HttpError && error.code?.startsWith('WORKSPACE_CONVERSATION_CLEANUP_')) {
      throw new HttpError(error.status, 'Project extension storage changed or exceeded its bounded cleanup limit. Remaining records were retained for retry.',
        error.code.replace('WORKSPACE_CONVERSATION_CLEANUP_', 'WORKSPACE_PROJECT_EXTENSIONS_CLEANUP_'));
    }
    throw error;
  } finally { await files?.close(); }
}
