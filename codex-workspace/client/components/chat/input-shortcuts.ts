import type { CodexQueueEntry } from '../../../shared/codex-cli';
interface ComposerKey {
  key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean; defaultPrevented?: boolean;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
}
/** Enter itself always keeps the textarea's native newline behavior. */
export function composerShortcut(event: ComposerKey, running: boolean): 'send' | 'queue' | null {
  if (event.defaultPrevented || event.nativeEvent?.isComposing || event.nativeEvent?.keyCode === 229
    || event.key !== 'Enter' || event.metaKey || event.altKey) return null;
  if (event.ctrlKey && !event.shiftKey) return 'send';
  return running && event.shiftKey && !event.ctrlKey ? 'queue' : null;
}
export type InputAcceptance =
  | { threadId: string; turnId: string; delivery: 'run' | 'steer' }
  | { threadId: string; queuedSubmission: Pick<CodexQueueEntry, 'id' | 'clientUserMessageId'>; delivery: 'next_turn' };
function nativeQueueAcknowledgment(value: unknown): value is Pick<CodexQueueEntry, 'id' | 'clientUserMessageId'> {
  const item = value as Partial<CodexQueueEntry> | null;
  return !!item && !Array.isArray(item) && typeof item.id === 'string' && !!item.id && item.id.length <= 200
    && typeof item.clientUserMessageId === 'string' && !!item.clientUserMessageId && item.clientUserMessageId.length <= 200;
}
export function nativeQueueEntry(value: unknown): value is CodexQueueEntry {
  if (!nativeQueueAcknowledgment(value)) return false;
  const preview = value as Partial<CodexQueueEntry>;
  return typeof preview.prompt === 'string' && Array.isArray(preview.attachmentNames)
    && preview.attachmentNames.every((name: unknown) => typeof name === 'string');
}
export function inputAcceptance(value: unknown, delivery: 'run' | 'steer' | 'next_turn', threadId: string, clientUserMessageId?: string, expectedTurnId?: string): InputAcceptance {
  const result = value as { threadId?: unknown; turnId?: unknown; queuedSubmission?: unknown } | null;
  const error = () => new Error('Codex did not confirm this message. Check the conversation before trying again; your draft has been kept.');
  if (!result || result.threadId !== threadId) throw error();
  if (delivery === 'next_turn') {
    if (!nativeQueueAcknowledgment(result.queuedSubmission) || clientUserMessageId && result.queuedSubmission.clientUserMessageId !== clientUserMessageId) throw error();
    return { threadId, queuedSubmission: { id: result.queuedSubmission.id, clientUserMessageId: result.queuedSubmission.clientUserMessageId }, delivery };
  }
  if (typeof result.turnId !== 'string' || !result.turnId || result.turnId.length > 200 || expectedTurnId && result.turnId !== expectedTurnId) throw error();
  return { threadId, turnId: result.turnId, delivery };
}
export function acceptanceNotice(result: InputAcceptance): string {
  return result.delivery === 'next_turn' ? 'Message added to the Codex queue.' : result.delivery === 'steer' ? 'Guidance sent to the active turn.' : 'Turn started.';
}
