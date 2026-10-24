import { describe, expect, it } from 'vitest';
import { HttpError } from '../server/errors';
import { readNativeHistoryPage } from '../server/codex-cli/history';
import { nativePublicTurnFingerprint } from '../server/codex-cli/history-identity';

const THREAD = '01980000-0000-7000-8000-000000000001';
const TURN = '01980000-0000-7000-8000-000000000101';
const OLDER = '01980000-0000-7000-8000-000000000102';
const unsupported = () => Object.assign(new HttpError(501, 'Native method unavailable.', 'CODEX_METHOD_UNAVAILABLE'),
  { nativeCode: -32601, nativeMethod: 'thread/items/list' });
class Bridge {
  current = 'first-native-process';
  calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  items = Array.from({ length: 20 }, (_, index) => ({ id: `native-item-${index}`, type: 'agentMessage', text: `Actual text ${index}` }));
  fail?: Error;
  generation() { return this.current; }
  supports() { return true; }
  async request<T>(method: string, input: unknown): Promise<T> {
    const params = input as Record<string, unknown>;
    this.calls.push({ method, params });
    if (method === 'thread/items/list') throw this.fail ?? unsupported();
    if (method !== 'thread/turns/list') throw new Error('History must use only native read methods.');
    const older = params.cursor === 'native-older' || params.cursor === 'native-reverse-older';
    const reverse = params.sortDirection === 'asc';
    return { data: [{ id: older ? OLDER : TURN, status: 'completed', itemsView: 'full',
      items: older ? [{ id: 'native-earlier-item', type: 'userMessage', content: [{ type: 'text', text: 'Earlier actual turn.' }] }] : this.items }],
      nextCursor: reverse ? older ? 'native-newer' : null : older ? null : 'native-older',
      backwardsCursor: older ? 'native-reverse-older' : 'native-reverse-newest' } as T;
  }
}
const ids = (page: Awaited<ReturnType<typeof readNativeHistoryPage>>) => page.data.map(row => row.item.id);

describe('supported native history presentation', () => {
  it('retries item pagination after an empty paginated thread actually materializes', async () => {
    let materialized = false;
    const calls: string[] = [];
    const bridge = { generation: () => 'same-process', supports: () => true,
      async request<T>(method: string): Promise<T> {
        calls.push(method);
        if (method === 'thread/items/list') {
          if (!materialized) throw unsupported();
          return { data: [{ turnId: TURN, item: { id: 'stable-live-item', type: 'agentMessage', text: 'A short fictional marker.' } }], nextCursor: null } as T;
        }
        throw new HttpError(409, 'Native thread is not materialized.', 'CODEX_HISTORY_UNMATERIALIZED');
      } };
    await expect(readNativeHistoryPage(bridge, { threadId: THREAD, direction: 'desc', historyMode: 'paginated' }))
      .rejects.toMatchObject({ code: 'CODEX_HISTORY_UNMATERIALIZED' });
    materialized = true;
    const page = await readNativeHistoryPage(bridge, { threadId: THREAD, direction: 'desc', historyMode: 'paginated' });
    expect(ids(page)).toEqual(['stable-live-item']);
    expect(calls).toEqual(['thread/items/list', 'thread/turns/list', 'thread/items/list']);
    expect(page.coverage).toEqual([{ turnId: TURN, identity: 'native', complete: false }]);
  });

  it('does not let one legacy thread disable another thread item API on the same connection', async () => {
    const bridge = new Bridge();
    await readNativeHistoryPage(bridge, { threadId: THREAD, direction: 'desc' });
    const request = bridge.request.bind(bridge);
    bridge.request = async <T>(method: string, input: unknown): Promise<T> => {
      if (method === 'thread/items/list' && (input as { threadId: string }).threadId === OLDER) {
        return { data: [{ turnId: TURN, item: { id: 'other-thread-native-item', type: 'agentMessage', text: 'Different real identity.' } }], nextCursor: null } as T;
      }
      return request<T>(method, input);
    };
    expect(ids(await readNativeHistoryPage(bridge, { threadId: OLDER, direction: 'desc', historyMode: 'paginated' }))).toEqual(['other-thread-native-item']);
  });

  it('uses the verified legacy fallback and can page beyond a fully retained live turn', async () => {
    const bridge = new Bridge();
    const first = await readNativeHistoryPage(bridge, { threadId: THREAD, direction: 'desc', historyMode: 'legacy' });
    expect(bridge.calls.some(call => call.method === 'thread/items/list')).toBe(false);
    expect(first.coverage[0]).toMatchObject({ turnId: TURN, identity: 'legacy', complete: false });
    bridge.items[15].text = 'Later active-turn text must not block the explicit outside-turn cursor.';
    const older = await readNativeHistoryPage(bridge, { threadId: THREAD, direction: 'desc', historyMode: 'legacy', cursor: first.coverage[0].afterTurnCursor });
    expect(ids(older)).toEqual(['native-earlier-item']);
    expect(older.coverage[0].complete).toBe(true);
  });

  it('invalidates reconstructed cursors when content changes without removing the anchor id', async () => {
    const bridge = new Bridge();
    bridge.items[0].text = 'p'.repeat(17_000) + 'A' + 's'.repeat(17_000);
    const first = await readNativeHistoryPage(bridge, { threadId: THREAD, direction: 'desc', historyMode: 'legacy' });
    bridge.items[0].text = 'p'.repeat(17_000) + 'B' + 's'.repeat(17_000);
    await expect(readNativeHistoryPage(bridge, { threadId: THREAD, direction: 'desc', historyMode: 'legacy', cursor: first.nextCursor }))
      .rejects.toMatchObject({ code: 'CODEX_HISTORY_CURSOR_STALE' });
  });

  it('fingerprints public representation changes while never reading private reasoning, hook context or media', () => {
    const privateField = { get() { throw new Error('Private native content must not be inspected.'); } };
    const reasoning = Object.defineProperties({ id: 'summary', type: 'reasoning', summary: ['Visible public summary.'] }, {
      content: privateField, encrypted_content: privateField,
    });
    const image = Object.defineProperty({ id: 'image', type: 'imageGeneration', status: 'completed', revisedPrompt: 'Blue bird', savedPath: '/owned/result.png' }, 'result', privateField);
    const hook = Object.defineProperty({ id: 'hook', type: 'hookPrompt' }, 'prompt', privateField);
    const first = nativePublicTurnFingerprint({ id: TURN, status: 'completed', items: [reasoning, image, hook] });
    image.revisedPrompt = 'Red bird';
    expect(nativePublicTurnFingerprint({ id: TURN, status: 'completed', items: [reasoning, image, hook] })).not.toBe(first);
    const summaries = Array.from({ length: 140 }, (_, index) => `Public part ${index}`);
    const before = nativePublicTurnFingerprint({ id: TURN, items: [{ id: 'summary', type: 'reasoning', summary: summaries }] });
    summaries[139] = 'Changed late public part';
    expect(nativePublicTurnFingerprint({ id: TURN, items: [{ id: 'summary', type: 'reasoning', summary: summaries }] })).not.toBe(before);
  });

  it('falls back only after the actual item-method rejection and batches a turn without replaying history', async () => {
    const bridge = new Bridge();
    const first = await readNativeHistoryPage(bridge, { threadId: THREAD, direction: 'desc' });
    expect(ids(first)).toEqual(Array.from({ length: 8 }, (_, index) => `native-item-${19 - index}`));
    expect(bridge.calls).toEqual([
      { method: 'thread/items/list', params: { threadId: THREAD, limit: 1, sortDirection: 'desc' } },
      { method: 'thread/turns/list', params: { threadId: THREAD, limit: 1, sortDirection: 'desc', itemsView: 'full' } },
    ]);
    const second = await readNativeHistoryPage(bridge, { threadId: THREAD, direction: 'desc', cursor: first.nextCursor });
    expect(ids(second)).toEqual(Array.from({ length: 8 }, (_, index) => `native-item-${11 - index}`));
    expect(bridge.calls.filter(call => call.method === 'thread/items/list')).toHaveLength(1);
    expect(bridge.calls.filter(call => call.method === 'thread/turns/list')).toHaveLength(2);
    const newer = await readNativeHistoryPage(bridge, { threadId: THREAD, direction: 'asc', cursor: second.backwardsCursor });
    expect(ids(newer)).toEqual(Array.from({ length: 8 }, (_, index) => `native-item-${12 + index}`));
  });

  it('crosses actual turn boundaries in both directions using the CLI cursor anchor semantics', async () => {
    const bridge = new Bridge();
    const one = await readNativeHistoryPage(bridge, { threadId: THREAD, direction: 'desc' });
    const two = await readNativeHistoryPage(bridge, { threadId: THREAD, direction: 'desc', cursor: one.nextCursor });
    const three = await readNativeHistoryPage(bridge, { threadId: THREAD, direction: 'desc', cursor: two.nextCursor });
    expect(ids(three)).toEqual(['native-item-3', 'native-item-2', 'native-item-1', 'native-item-0']);
    const earlier = await readNativeHistoryPage(bridge, { threadId: THREAD, direction: 'desc', cursor: three.nextCursor });
    expect(ids(earlier)).toEqual(['native-earlier-item']); expect(earlier.data[0].turnId).toBe(OLDER);
    const later = await readNativeHistoryPage(bridge, { threadId: THREAD, direction: 'asc', cursor: earlier.backwardsCursor });
    expect(ids(later)).toEqual(Array.from({ length: 8 }, (_, index) => `native-item-${index}`));
  });

  it('rejects changed anchors and cursors for other threads instead of skipping missing items', async () => {
    const bridge = new Bridge(), first = await readNativeHistoryPage(bridge, { threadId: THREAD, direction: 'desc' });
    bridge.items = bridge.items.filter(item => item.id !== 'native-item-12');
    await expect(readNativeHistoryPage(bridge, { threadId: THREAD, direction: 'desc', cursor: first.nextCursor }))
      .rejects.toMatchObject({ code: 'CODEX_HISTORY_CURSOR_STALE' });
    await expect(readNativeHistoryPage(bridge, { threadId: OLDER, direction: 'desc', cursor: first.nextCursor }))
      .rejects.toMatchObject({ code: 'CODEX_HISTORY_CURSOR_STALE' });
  });

  it('does not translate old item cursors into turn cursors or retry arbitrary native errors', async () => {
    const bridge = new Bridge();
    await expect(readNativeHistoryPage(bridge, { threadId: THREAD, direction: 'desc', cursor: 'actual-native-item-cursor' }))
      .rejects.toMatchObject({ code: 'CODEX_HISTORY_CURSOR_STALE' });
    expect(bridge.calls).toHaveLength(1);
    const other = new Bridge(); other.fail = new HttpError(409, 'Unrelated history rejection.', 'CODEX_RPC_REJECTED');
    await expect(readNativeHistoryPage(other, { threadId: THREAD, direction: 'desc' })).rejects.toBe(other.fail);
    expect(other.calls).toHaveLength(1);
  });

  it('rechecks advertised item support after the official connection changes', async () => {
    const bridge = new Bridge(); await readNativeHistoryPage(bridge, { threadId: THREAD, direction: 'desc' });
    bridge.current = 'second-native-process';
    await readNativeHistoryPage(bridge, { threadId: THREAD, direction: 'desc' });
    expect(bridge.calls.filter(call => call.method === 'thread/items/list')).toHaveLength(2);
  });
});
