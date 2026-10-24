import { api, json } from '../../api';
import type { NativeCurrentTurnSettings, NativeCurrentTurnSettingsResult } from '../../../shared/native-turn-controls';
import type { AppSettings } from '../../../shared/types';

export function composerServiceTier(saved: string | undefined, accepted: string | undefined,
  settings: Pick<AppSettings, 'serviceTier' | 'fastMode'>): string {
  return saved ?? accepted ?? settings.serviceTier ?? (settings.fastMode === false ? 'default' : 'priority');
}

/** Applies only to the turn explicitly shown by the composer. Never retries on a new turn. */
export async function applyCurrentTurnServiceTier(options: {
  workspaceId: string; threadId: string; turnId: string; serviceTier: string; signal: AbortSignal; current(): boolean;
}, transport: typeof api = api): Promise<void> {
  const { workspaceId, threadId, turnId, serviceTier, signal, current } = options;
  const endpoint = `/workspaces/${encodeURIComponent(workspaceId)}/codex/threads/${encodeURIComponent(threadId)}/current-turn-settings`;
  const assertCurrent = () => { if (signal.aborted || !current()) throw new DOMException('Conversation selection changed.', 'AbortError'); };
  assertCurrent();
  const snapshot = await transport<NativeCurrentTurnSettings>(endpoint, { signal, cache: 'no-store' });
  assertCurrent();
  if (snapshot.scope !== 'current-turn' || snapshot.threadId !== threadId || snapshot.activeTurnId !== turnId) {
    throw new Error('The active turn changed. The selected tier is saved for your next message.');
  }
  if (!snapshot.canRequest || !snapshot.generation) throw new Error(snapshot.unavailableReason || 'Current-turn service tier changes are unavailable.');
  const result = await transport<NativeCurrentTurnSettingsResult>(endpoint, { ...json('PATCH', {
    expectedTurnId: turnId, expectedGeneration: snapshot.generation, serviceTier,
  }), signal });
  assertCurrent();
  if (result.scope !== 'current-turn' || result.threadId !== threadId || result.turnId !== turnId || result.status !== 'applied') {
    throw new Error(result.status === 'targetUnavailable'
      ? 'Codex could not update that turn. The selected tier is saved for your next message.'
      : 'Codex did not confirm the current-turn tier change. Refresh before trying again.');
  }
}
