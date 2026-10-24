import { describe, expect, it } from 'vitest';
import { projectNativeThread } from '../server/codex-cli/projection';
import { replaceNativeViewTurns, retainNativeTurnRows } from '../server/codex-cli/native-view';
const THREAD = '01980000-0000-7000-8000-000000000001';
const FIRST = '01980000-0000-7000-8000-000000000101', SECOND = '01980000-0000-7000-8000-000000000102';
const metadata = { id: THREAD, createdAt: 1, updatedAt: 1, status: { type: 'idle' } };
const message = (turnId: string, id: string, text: string) => ({ turnId, item: { id, type: 'agentMessage', text } });

describe('bounded native turn replacement on the server', () => {
  it('retains another turn and its known actual user reference outside the current window', () => {
    const current = projectNativeThread(metadata, [message(FIRST, 'live-first', 'Earlier live text.'), message(SECOND, 'later', 'Another real turn.')], 'workspace');
    current.turns = [{ id: SECOND, userMessageId: 'known-native-user-outside-window', status: 'completed', startedAt: current.createdAt, messageIds: ['later'] }];
    const canonical = projectNativeThread(metadata, [message(FIRST, 'item-5', 'Canonical text.')], 'workspace');
    const next = replaceNativeViewTurns(current, canonical, new Set([FIRST]));
    expect(next.messages.map(row => row.id)).toEqual(['item-5', 'later']);
    expect(next.turns).toEqual([expect.objectContaining({ id: SECOND, userMessageId: 'known-native-user-outside-window', messageIds: ['later'] })]);
    expect(next.turns!.some(turn => !turn.userMessageId)).toBe(false);
  });

  it('filters a new incompatible id without removing exact rows or another native turn', () => {
    const previous = projectNativeThread(metadata, [message(FIRST, 'item-5', 'Canonical text.'), message(SECOND, 'later', 'Another real turn.')], 'workspace');
    const next = projectNativeThread(metadata, [message(FIRST, 'item-5', 'Canonical text.'), message(SECOND, 'later', 'Another real turn.'),
      message(FIRST, 'old-live-id', 'Canonical text.')], 'workspace');
    expect(retainNativeTurnRows(previous, next, FIRST).messages.map(row => row.id)).toEqual(['item-5', 'later']);
  });
});
