import { describe, expect, it } from 'vitest';
import { acceptanceNotice, composerShortcut, inputAcceptance, nativeQueueEntry } from '../client/components/chat/input-shortcuts';

const enter = { key: 'Enter', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, nativeEvent: { isComposing: false, keyCode: 13 } };

describe('composer shortcuts', () => {
  it('keeps ordinary Enter available for native multiline input during idle and active turns', () => {
    expect(composerShortcut(enter, false)).toBeNull();
    expect(composerShortcut(enter, true)).toBeNull();
  });

  it('uses Ctrl+Enter for send or steering independently of turn state', () => {
    expect(composerShortcut({ ...enter, ctrlKey: true }, false)).toBe('send');
    expect(composerShortcut({ ...enter, ctrlKey: true }, true)).toBe('send');
  });

  it('uses Shift+Enter only for a deferred active-turn submission', () => {
    expect(composerShortcut({ ...enter, shiftKey: true }, true)).toBe('queue');
    expect(composerShortcut({ ...enter, shiftKey: true }, false)).toBeNull();
  });

  it('does not steal IME confirmation or legacy key-code composition events', () => {
    for (const nativeEvent of [{ isComposing: true, keyCode: 13 }, { isComposing: false, keyCode: 229 }]) {
      expect(composerShortcut({ ...enter, ctrlKey: true, nativeEvent }, true)).toBeNull();
      expect(composerShortcut({ ...enter, shiftKey: true, nativeEvent }, true)).toBeNull();
    }
  });

  it('leaves unrelated modified keys and already-consumed events to their owner', () => {
    for (const patch of [{ metaKey: true }, { altKey: true }, { shiftKey: true }, { defaultPrevented: true }, { key: 'Escape' }]) {
      expect(composerShortcut({ ...enter, ctrlKey: true, ...patch }, true)).toBeNull();
    }
  });
});

const threadId = '01980000-0000-7000-8000-000000000001';
const turnId = '01980000-0000-7000-8000-000000000101';
const clientUserMessageId = '11111111-1111-4111-8111-111111111111';

// The retired site scheduler's submissionId/held/late-steer downgrade receipts
// are not native acknowledgments and cannot authorize clearing a draft.
describe('native input acknowledgements', () => {
  it('accepts actual native run and exact-turn steering acknowledgments', () => {
    const run = inputAcceptance({ threadId, turnId }, 'run', threadId);
    expect(run).toEqual({ threadId, turnId, delivery: 'run' });
    expect(acceptanceNotice(run)).toBe('Turn started.');
    const steer = inputAcceptance({ threadId, turnId }, 'steer', threadId, clientUserMessageId, turnId);
    expect(steer).toEqual({ threadId, turnId, delivery: 'steer' });
    expect(acceptanceNotice(steer)).toBe('Guidance sent to the active turn.');
  });

  it('accepts the real minimal native queue commit without requiring a fallible preview read', () => {
    const queuedSubmission = { id: 'native-queue-item', clientUserMessageId };
    const receipt = inputAcceptance({ threadId, queuedSubmission }, 'next_turn', threadId, clientUserMessageId);
    expect(receipt).toEqual({ threadId, queuedSubmission, delivery: 'next_turn' });
    expect(acceptanceNotice(receipt)).toBe('Message added to the Codex queue.');
    expect(nativeQueueEntry(queuedSubmission)).toBe(false);
    expect(nativeQueueEntry({ ...queuedSubmission, prompt: 'Future message', attachmentNames: ['notes.txt'] })).toBe(true);
  });

  it('does not silently change queue delivery into steering or a stale steer into a queue', () => {
    expect(() => inputAcceptance({ threadId, turnId }, 'next_turn', threadId, clientUserMessageId)).toThrow(/did not confirm/);
    expect(() => inputAcceptance({ threadId, queuedSubmission: { id: 'native-queue-item', clientUserMessageId } }, 'steer', threadId, clientUserMessageId, turnId))
      .toThrow(/did not confirm/);
    expect(() => inputAcceptance({ threadId, turnId: 'another-turn' }, 'steer', threadId, clientUserMessageId, turnId)).toThrow(/draft has been kept/);
  });

  it('rejects missing, malformed and obsolete acknowledgements so the draft can be preserved', () => {
    for (const receipt of [null, {}, { queued: true }, { threadId }, { threadId, turnId: '' }, { threadId, turnId: 123 },
      { threadId, turnId: 'x'.repeat(201) }, { threadId: 'other-thread', turnId },
      { submissionId: 'input-held', delivery: 'next_turn', state: 'held' },
      { submissionId: 'input', delivery: 'steer', state: 'delivering' },
      { submissionId: 'input', delivery: 'steer', state: 'pending', runId: 123 }]) {
      expect(() => inputAcceptance(receipt, 'run', threadId)).toThrow(/did not confirm.*draft has been kept/);
    }
  });

  it('requires the exact queued client identity and strips incidental payload/protocol fields from the acknowledgment', () => {
    for (const queuedSubmission of [null, {}, { id: '', clientUserMessageId }, { id: 'x'.repeat(201), clientUserMessageId },
      { id: 'native-queue', clientUserMessageId: '' }, { id: 'native-queue', clientUserMessageId: 'other-client' }]) {
      expect(() => inputAcceptance({ threadId, queuedSubmission }, 'next_turn', threadId, clientUserMessageId)).toThrow(/did not confirm/);
    }
    const receipt = inputAcceptance({ threadId, queuedSubmission: { id: 'native-queue', clientUserMessageId,
      prompt: 'Incidental preview', input: [{ type: 'image', url: 'PRIVATE_PAYLOAD' }], private_data: 'PRIVATE_VALUE' } },
    'next_turn', threadId, clientUserMessageId);
    expect(receipt).toEqual({ threadId, queuedSubmission: { id: 'native-queue', clientUserMessageId }, delivery: 'next_turn' });
    expect(JSON.stringify(receipt)).not.toMatch(/PRIVATE_PAYLOAD|PRIVATE_VALUE|Incidental preview|"input"/);
  });
});
