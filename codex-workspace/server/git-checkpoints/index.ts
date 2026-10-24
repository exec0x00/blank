export { GitCheckpointService } from './service';
export { CHECKPOINT_LIMITS, CHECKPOINT_LIMITATIONS } from './store';
export { sameCheckpointRepository, sameLiveCheckpointRepository } from './logical-identity';
export type * from './types';

import type { AppConfig } from '../config';
import { HttpError } from '../errors';
import { CHECKPOINT_LIMITS, CheckpointStore, checkedId } from './store';

/** Internal deletion leaf. The reviewed workspace deletion/expiry job must already
 * hold its exclusive removal barrier; this function must not reacquire that gate.
 * Ownership failures are retryable errors, never permission to sweep unknown data. */
export async function cleanupWorkspaceGitCheckpoints(config: AppConfig, workspaceId: string): Promise<{ removed: number }> {
  return new CheckpointStore({ config }, { ...CHECKPOINT_LIMITS }).cleanupWorkspace(workspaceId);
}

/** Internal exact-thread deletion leaf. Its caller must quiesce the selected
 * family, hold history maintenance, and verify surviving checkpoint references
 * before removing canonical thread/operation authority. No gate is reacquired. */
export async function cleanupThreadGitCheckpoints(config: AppConfig, workspaceId: string, threadId: string,
  options: { keepTurnIds?: ReadonlySet<string> } = {}): Promise<{ removed: number }> {
  checkedId(workspaceId); checkedId(threadId);
  if (options.keepTurnIds) {
    if (options.keepTurnIds.size > CHECKPOINT_LIMITS.retainedCheckpoints) {
      throw new HttpError(413, 'The retained checkpoint turn selection exceeds its bounded cleanup limit.', 'CHECKPOINT_LIMIT');
    }
    for (const turnId of options.keepTurnIds) checkedId(turnId);
  }
  return new CheckpointStore({ config }, { ...CHECKPOINT_LIMITS }).cleanupThread(workspaceId, threadId, options.keepTurnIds);
}
