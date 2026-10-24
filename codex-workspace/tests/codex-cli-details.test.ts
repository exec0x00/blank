import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import https from 'node:https';
import { performance } from 'node:perf_hooks';
import { HttpError } from '../server/errors';
import { readNativeItemDetail, NATIVE_ITEM_DETAIL_LIMITS, type NativeItemDetailBridge,
  type NativeItemDetailRequest, type NativeItemDetailOptions } from '../server/codex-cli/details';

const THREAD = '01980000-0000-7000-8000-000000000001';
const TURN = '01980000-0000-7000-8000-000000000101';
const OTHER_TURN = '01980000-0000-7000-8000-000000000102';
const AGENT = '01980000-0000-7000-8000-000000000002';
const ITEM = 'actual-native-item';
const request = (extra: Partial<NativeItemDetailRequest> = {}): NativeItemDetailRequest => ({ threadId: THREAD, turnId: TURN, itemId: ITEM, field: 'text', ...extra });
const row = (item: Record<string, unknown>, turnId = TURN) => ({ turnId,
  item: Object.defineProperties({ id: ITEM }, Object.getOwnPropertyDescriptors(item)) });
const page = (item: Record<string, unknown>, nextCursor: string | null = null) => ({ data: [row(item)], nextCursor, backwardsCursor: null });
class Bridge implements NativeItemDetailBridge {
  current: string | null = 'native-generation-one';
  available = true;
  turnsAvailable = false;
  calls: Array<{ method: string; params: Record<string, unknown>; timeout: number | undefined }> = [];
  handler: (params: Record<string, unknown>) => unknown | Promise<unknown> = () => page({ type: 'agentMessage', text: 'Actual public text.' });
  turnHandler: (params: Record<string, unknown>) => unknown | Promise<unknown> = () => { throw new Error('No native turn page was supplied.'); };
  generation() { return this.current; }
  supports(method: string) { return this.available && method === 'thread/items/list' || this.turnsAvailable && method === 'thread/turns/list'; }
  async request<T = unknown>(method: string, params: unknown, timeout?: number): Promise<T> {
    const selected = params as Record<string, unknown>;
    this.calls.push({ method, params: selected, timeout });
    return await (method === 'thread/turns/list' ? this.turnHandler : this.handler)(selected) as T;
  }
}
let bridge: Bridge, options: NativeItemDetailOptions;
beforeEach(() => {
  bridge = new Bridge(); options = { assertCurrent: vi.fn(), redact: vi.fn((value: string) => value) };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('The native detail reader must not contact a network service.'); });
  vi.spyOn(https, 'request').mockImplementation(() => { throw new Error('The native detail reader must use only the supplied read-only bridge.'); });
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled(); expect(https.request).not.toHaveBeenCalled();
  vi.restoreAllMocks(); vi.useRealTimers();
});
const forbidden = (target: object, name: string) => {
  const read = vi.fn(() => { throw new Error('A private or binary field was accessed: ' + name); });
  Object.defineProperty(target, name, { enumerable: true, configurable: true, get: read });
  return read;
};

describe('bounded official native public item inspection', () => {
  it('reads and pins full output through actual native turn pages when item pagination is unimplemented', async () => {
    bridge.turnsAvailable = true;
    bridge.handler = () => { throw Object.assign(new HttpError(501, 'Native method unavailable.', 'CODEX_METHOD_UNAVAILABLE'),
      { nativeCode: -32601, nativeMethod: 'thread/items/list' }); };
    let output = 'Actual command output.\n'.repeat(2000);
    bridge.turnHandler = () => ({ data: [{ id: TURN, itemsView: 'full', items: [
      { id: 'another-native-item', type: 'agentMessage', text: 'Other public text.' },
      { id: ITEM, type: 'commandExecution', aggregatedOutput: output, command: 'echo example', status: 'completed' },
    ] }], nextCursor: null, backwardsCursor: null });
    const first = await readNativeItemDetail(bridge, request({ field: 'output' }), options);
    expect(first).toMatchObject({ status: 'ready', totalChars: output.length, text: output.slice(0, 16_000), nextOffset: 16_000 });
    if (first.status !== 'ready') throw new Error('Expected real native output.');
    expect(first.itemCursor).toMatch(/^codex-detail-turn-v1:/);
    const next = await readNativeItemDetail(bridge, request({ field: 'output', cursor: first.itemCursor,
      version: first.version, offset: first.nextOffset! }), options);
    expect(next).toMatchObject({ status: 'ready', text: output.slice(16_000, 32_000), offset: 16_000 });
    expect(bridge.calls.map(call => call.method)).toEqual(['thread/items/list', 'thread/turns/list', 'thread/turns/list']);
    output += 'Changed later.';
    await expect(readNativeItemDetail(bridge, request({ field: 'output', cursor: first.itemCursor, version: first.version, offset: 1 }), options))
      .rejects.toMatchObject({ code: 'CODEX_DETAIL_STALE' });
  });

  it('finds the exact requested turn through bounded turn pages without using an item cursor as a turn cursor', async () => {
    bridge.available = false; bridge.turnsAvailable = true;
    bridge.turnHandler = params => params.cursor === 'actual-older-turn' ? {
      data: [{ id: TURN, itemsView: 'full', items: [{ id: ITEM, type: 'agentMessage', text: 'Target native item.' }] }], nextCursor: null,
    } : { data: [{ id: OTHER_TURN, itemsView: 'full', items: [{ id: ITEM, type: 'agentMessage', text: 'Wrong turn.' }] }], nextCursor: 'actual-older-turn' };
    expect(await readNativeItemDetail(bridge, request(), options)).toMatchObject({ status: 'ready', text: 'Target native item.' });
    expect(bridge.calls).toHaveLength(2);
    await expect(readNativeItemDetail(bridge, request({ cursor: 'actual-item-cursor' }), options)).rejects.toMatchObject({ code: 'CODEX_DETAIL_STALE' });
    expect(bridge.calls).toHaveLength(2);
  });

  it('reads only the exact native turn through one-item pages and returns a bounded public chunk', async () => {
    const text = 'a'.repeat(17_001); bridge.handler = () => page({ type: 'agentMessage', text });
    const result = await readNativeItemDetail(bridge, request(), options);
    expect(result).toMatchObject({ status: 'ready', threadId: THREAD, turnId: TURN, itemId: ITEM, field: 'text', itemType: 'agentMessage',
      itemCursor: null, part: 0, label: 'Agent text', text: text.slice(0, 16_000), offset: 0, limit: 16_000,
      totalChars: 17_001, previousOffset: null, nextOffset: 16_000, parts: [{ part: 0, label: 'Agent text', totalChars: 17_001 }] });
    if (result.status !== 'ready') throw new Error('Expected public text.');
    expect(result.version).toMatch(/^[a-f0-9]{64}$/);
    expect(bridge.calls).toHaveLength(1);
    expect(bridge.calls[0]).toMatchObject({ method: 'thread/items/list', params: { threadId: THREAD, turnId: TURN, limit: 1, sortDirection: 'asc' } });
    expect(bridge.calls[0].timeout).toBeGreaterThan(0); expect(bridge.calls[0].timeout).toBeLessThanOrEqual(15_000);
    expect(options.assertCurrent).toHaveBeenCalledTimes(3);
  });

  it('returns the actual continuation after eight pages and resumes without inventing a missing item', async () => {
    bridge.handler = params => {
      const index = params.cursor ? Number(String(params.cursor).slice(7)) : 0;
      return index === 8 ? page({ type: 'plan', text: 'Real native plan.' })
        : page({ id: 'different-' + index, type: 'agentMessage', text: 'Another native item.' }, 'cursor-' + (index + 1));
    };
    const first = await readNativeItemDetail(bridge, request(), options);
    expect(first).toEqual({ threadId: THREAD, turnId: TURN, itemId: ITEM, field: 'text', status: 'searching', nextCursor: 'cursor-8', pagesScanned: 8 });
    expect(bridge.calls).toHaveLength(8);
    const next = await readNativeItemDetail(bridge, request({ cursor: 'cursor-8' }), options);
    expect(next).toMatchObject({ status: 'ready', text: 'Real native plan.', itemCursor: 'cursor-8' });
    expect(bridge.calls).toHaveLength(9);
  });

  it('reports exhaustion only after the native endpoint returns no next cursor', async () => {
    bridge.handler = () => ({ data: [], nextCursor: null, backwardsCursor: null });
    const result = await readNativeItemDetail(bridge, request({ cursor: 'actual-native-page' }), options);
    expect(result).toMatchObject({ status: 'notFound', nextCursor: null });
    expect(bridge.calls).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/deleted|does not exist|all history/i);
  });

  it('rereads a found cursor once for later offsets and detects text changes or native reverts', async () => {
    let text = '0123456789abcdef'; bridge.handler = () => page({ type: 'agentMessage', text }, 'later-page');
    const first = await readNativeItemDetail(bridge, request({ cursor: 'found-page', limit: 8 }), options);
    if (first.status !== 'ready') throw new Error('Expected public text.');
    bridge.calls.length = 0;
    const next = await readNativeItemDetail(bridge, request({ cursor: first.itemCursor, version: first.version, offset: first.nextOffset!, limit: 8 }), options);
    expect(next).toMatchObject({ status: 'ready', text: '89abcdef', offset: 8, nextOffset: null, previousOffset: 0 });
    expect(bridge.calls).toHaveLength(1); expect(bridge.calls[0].params.cursor).toBe('found-page');
    text = '01234567changed';
    await expect(readNativeItemDetail(bridge, request({ cursor: first.itemCursor, version: first.version, offset: 8 }), options))
      .rejects.toMatchObject({ status: 409, code: 'CODEX_DETAIL_STALE' });
    bridge.calls.length = 0; bridge.handler = () => page({ id: 'replacement-item', type: 'agentMessage', text: 'Native history changed.' }, 'still-more-native-items');
    await expect(readNativeItemDetail(bridge, request({ cursor: first.itemCursor, version: first.version }), options))
      .rejects.toMatchObject({ code: 'CODEX_DETAIL_STALE' });
    expect(bridge.calls).toHaveLength(1);
  });

  it('keeps reasoning strictly to public summary parts and never invokes private or serialization getters', async () => {
    const item: Record<string, unknown> = { type: 'reasoning', id: ITEM, summary: ['Public summary one.', 'Public summary two.'] };
    const privateReads = ['content', 'encrypted_content', 'rawResponseItem', 'toJSON'].map(name => forbidden(item, name));
    bridge.handler = () => ({ data: [{ turnId: TURN, item }], nextCursor: null });
    const first = await readNativeItemDetail(bridge, request(), options);
    expect(first).toMatchObject({ status: 'ready', text: 'Public summary one.',
      parts: [{ part: 0, label: 'Public summary 1', totalChars: 19 }, { part: 1, label: 'Public summary 2', totalChars: 19 }] });
    if (first.status !== 'ready') throw new Error('Expected public summary.');
    const second = await readNativeItemDetail(bridge, request({ cursor: first.itemCursor, version: first.version, part: 1 }), options);
    expect(second).toMatchObject({ status: 'ready', text: 'Public summary two.', part: 1 });
    const unsupported = await readNativeItemDetail(bridge, request({ field: 'output' }), options);
    expect(unsupported).toMatchObject({ status: 'unavailable', reason: 'unsupported-field' });
    for (const read of privateReads) expect(read).not.toHaveBeenCalled();
    expect(vi.mocked(options.redact).mock.calls.flat().every(text => /Public summary/.test(text))).toBe(true);
  });

  it('does not include private reasoning bytes in the public version', async () => {
    let content = 'private-first'; bridge.handler = () => page({ type: 'reasoning', summary: ['Only public summary.'], content: [content] });
    const first = await readNativeItemDetail(bridge, request(), options);
    if (first.status !== 'ready') throw new Error('Expected public summary.');
    content = 'private-second-is-different';
    expect(await readNativeItemDetail(bridge, request({ cursor: first.itemCursor, version: first.version }), options))
      .toMatchObject({ status: 'ready', version: first.version, text: 'Only public summary.' });
    expect(JSON.stringify(vi.mocked(options.redact).mock.calls)).not.toContain('private-');
  });

  it('returns real user text parts while ignoring image, audio, and encrypted payloads', async () => {
    const image: Record<string, unknown> = { type: 'image' }, audio: Record<string, unknown> = { type: 'audio' };
    const imageRead = forbidden(image, 'url'), audioRead = forbidden(audio, 'data');
    bridge.handler = () => page({ type: 'userMessage', content: [{ type: 'text', text: 'First actual text.' }, image,
      { type: 'text', text: 'Second actual text.' }, audio] });
    expect(await readNativeItemDetail(bridge, request({ part: 1 }), options))
      .toMatchObject({ status: 'ready', text: 'Second actual text.', parts: [
        { part: 0, label: 'User text 1', totalChars: 18 }, { part: 1, label: 'User text 3', totalChars: 19 }] });
    expect(imageRead).not.toHaveBeenCalled(); expect(audioRead).not.toHaveBeenCalled();
  });

  it.each([
    ['commandExecution', 'input', { command: 'cat selected.txt', cwd: '/workspace/real' }, 'cat selected.txt', 'Command'],
    ['commandExecution', 'output', { aggregatedOutput: 'actual stdout\nactual stderr' }, 'actual stdout\nactual stderr', 'Command output'],
    ['plan', 'text', { text: 'Native plan content.' }, 'Native plan content.', 'Plan'],
    ['collabAgentToolCall', 'input', { prompt: 'Actual isolated child brief.' }, 'Actual isolated child brief.', 'Agent task'],
    ['collabAgentToolCall', 'output', { receiverThreadIds: [AGENT], agentsStates: { [AGENT]: { status: 'completed', message: 'Real child reply.' } } }, 'Real child reply.', 'Agent reply 1'],
    ['webSearch', 'input', { action: { type: 'findInPage', url: 'https://example.test/page', pattern: 'needle' } }, 'https://example.test/page', 'Page address'],
    ['imageView', 'input', { path: '/workspace/selected.png' }, '/workspace/selected.png', 'Image path'],
    ['imageGeneration', 'input', { revisedPrompt: 'The actual image prompt.' }, 'The actual image prompt.', 'Image prompt'],
  ] as const)('selects only readable %s %s fields', async (type, field, fields, text, label) => {
    const item = { type, ...fields }; const privateRead = forbidden(item, 'raw');
    bridge.handler = () => page(item);
    expect(await readNativeItemDetail(bridge, request({ field }), options)).toMatchObject({ status: 'ready', text, label });
    expect(privateRead).not.toHaveBeenCalled();
  });

  it('offers full native paths and diffs as separate readable parts', async () => {
    const diff = 'diff --git a/old.ts b/new.ts\n' + '+actual source line\n'.repeat(1500);
    bridge.handler = () => page({ type: 'fileChange', changes: [{ path: '/workspace/old.ts', kind: { type: 'update', move_path: '/workspace/new.ts' }, diff }] });
    expect(await readNativeItemDetail(bridge, request({ field: 'input', part: 1 }), options)).toMatchObject({ status: 'ready', text: '/workspace/new.ts', label: 'Move target 1' });
    const first = await readNativeItemDetail(bridge, request({ field: 'output' }), options);
    if (first.status !== 'ready') throw new Error('Expected native diff.');
    expect(first.totalChars).toBe(diff.length); expect(first.text).toBe(diff.slice(0, 16_000));
    expect(first.parts[0].label).toContain('/workspace/old.ts');
    const second = await readNativeItemDetail(bridge, request({ field: 'output', cursor: first.itemCursor, version: first.version, offset: first.nextOffset! }), options);
    expect(second).toMatchObject({ status: 'ready', text: diff.slice(16_000), totalChars: diff.length });
  });

  it('extracts only supported public textual tool outputs without exposing protocol JSON or media', async () => {
    const image: Record<string, unknown> = { type: 'input_image' }, encrypted: Record<string, unknown> = { type: 'encrypted_content' };
    const imageRead = forbidden(image, 'image_url'), encryptedRead = forbidden(encrypted, 'encrypted_content');
    bridge.handler = () => page({ type: 'functionCallOutput', output: [
      { type: 'input_text', text: JSON.stringify({ message: 'Real public tool reply.', credentials: 'must-not-be-displayed' }) }, image, encrypted] });
    const result = await readNativeItemDetail(bridge, request({ field: 'output' }), options);
    expect(result).toMatchObject({ status: 'ready', text: 'Real public tool reply.' });
    expect(JSON.stringify(result)).not.toMatch(/credentials|must-not-be-displayed|input_image|encrypted_content/);
    expect(imageRead).not.toHaveBeenCalled(); expect(encryptedRead).not.toHaveBeenCalled();
    bridge.handler = () => page({ type: 'functionCallOutput', output: JSON.stringify({ type: 'reasoning', summary: 'Do not reclassify a raw reasoning envelope.', content: 'never' }) });
    expect(await readNativeItemDetail(bridge, request({ field: 'output' }), options)).toMatchObject({ status: 'unavailable', reason: 'no-public-content' });
    bridge.handler = () => page({ type: 'dynamicToolCall', contentItems: [{ type: 'inputText', text: 'Actual dynamic output.' }] });
    expect(await readNativeItemDetail(bridge, request({ field: 'output' }), options)).toMatchObject({ status: 'ready', text: 'Actual dynamic output.' });
  });

  it('uses review findings and explanations instead of dumping the native review object', async () => {
    bridge.handler = () => page({ type: 'exitedReviewMode', review: JSON.stringify({ overall_explanation: 'Real review explanation.',
      findings: [{ title: 'Actual finding', body: 'Concrete public review body.', private_extension: 'never' }], other_protocol_field: 'never' }) });
    const result = await readNativeItemDetail(bridge, request({ field: 'output', part: 2 }), options);
    expect(result).toMatchObject({ status: 'ready', text: 'Concrete public review body.', label: 'Finding 1' });
    expect(JSON.stringify(result)).not.toMatch(/private_extension|other_protocol_field|never/);
  });

  it('inspects MCP text and errors with exact native identity without reading arguments, metadata or media', async () => {
    const image: Record<string, unknown> = { type: 'image' };
    const result: Record<string, unknown> = { content: [{ type: 'text', text: 'Actual MCP result. '.repeat(1200) }, image,
      { type: 'text', text: '{"message":"Second public result.","credentials":"EXCLUDED"}' }] };
    const item: Record<string, unknown> = { type: 'mcpToolCall', id: ITEM, server: 'native-docs', tool: 'search', result,
      error: { message: 'Actual native tool error.' } };
    const privateReads = [forbidden(item, 'arguments'), forbidden(item, 'appContext'), forbidden(result, 'structuredContent'),
      forbidden(result, '_meta'), forbidden(image, 'data')];
    bridge.handler = () => ({ data: [{ turnId: TURN, item }], nextCursor: null });
    expect(await readNativeItemDetail(bridge, request({ field: 'input' }), options)).toMatchObject({ status: 'ready', itemId: ITEM, text: 'native-docs', label: 'MCP server' });
    const error = await readNativeItemDetail(bridge, request({ field: 'output' }), options);
    expect(error).toMatchObject({ status: 'ready', text: 'Actual native tool error.', label: 'MCP tool error' });
    const first = await readNativeItemDetail(bridge, request({ field: 'output', part: 1 }), options);
    if (first.status !== 'ready') throw new Error('Expected actual native MCP text.');
    expect(first).toMatchObject({ itemId: ITEM, field: 'output', totalChars: 22_800, nextOffset: 16_000 });
    expect(await readNativeItemDetail(bridge, request({ field: 'output', part: 1, cursor: first.itemCursor, version: first.version, offset: first.nextOffset! }), options))
      .toMatchObject({ status: 'ready', offset: 16_000, nextOffset: null, text: 'Actual MCP result. '.repeat(1200).slice(16_000) });
    expect(await readNativeItemDetail(bridge, request({ field: 'output', part: 2 }), options)).toMatchObject({ status: 'ready', text: 'Second public result.' });
    for (const read of privateReads) expect(read).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(options.redact).mock.calls)).not.toMatch(/EXCLUDED|credentials/);
  });

  it('provides only public dynamic tool identity on input and refuses hook context details', async () => {
    const dynamic: Record<string, unknown> = { type: 'dynamicToolCall', id: ITEM, namespace: 'site', tool: 'inspect' };
    const argumentsRead = forbidden(dynamic, 'arguments');
    bridge.handler = () => ({ data: [{ turnId: TURN, item: dynamic }], nextCursor: null });
    expect(await readNativeItemDetail(bridge, request({ field: 'input', part: 1 }), options)).toMatchObject({ status: 'ready', text: 'inspect', label: 'Tool' });
    expect(argumentsRead).not.toHaveBeenCalled();
    const hook: Record<string, unknown> = { type: 'hookPrompt', id: ITEM }, contextRead = forbidden(hook, 'fragments');
    bridge.handler = () => ({ data: [{ turnId: TURN, item: hook }], nextCursor: null });
    for (const field of ['input', 'output', 'text'] as const) {
      expect(await readNativeItemDetail(bridge, request({ field }), options)).toMatchObject({ status: 'unavailable', reason: 'unsupported-field' });
    }
    expect(contextRead).not.toHaveBeenCalled();
  });

  it('does not read tool arguments, raw response items or generated binary results', async () => {
    const item: Record<string, unknown> = { type: 'dynamicToolCall', id: ITEM };
    const argumentsRead = forbidden(item, 'arguments'), rawRead = forbidden(item, 'rawResponseItem');
    bridge.handler = () => ({ data: [{ turnId: TURN, item }], nextCursor: null });
    expect(await readNativeItemDetail(bridge, request({ field: 'input' }), options)).toMatchObject({ status: 'unavailable', reason: 'no-public-content' });
    expect(argumentsRead).not.toHaveBeenCalled(); expect(rawRead).not.toHaveBeenCalled();
    const generation: Record<string, unknown> = { type: 'imageGeneration', id: ITEM, savedPath: '/workspace/real.png' }, binaryRead = forbidden(generation, 'result');
    bridge.handler = () => ({ data: [{ turnId: TURN, item: generation }], nextCursor: null });
    expect(await readNativeItemDetail(bridge, request({ field: 'output' }), options)).toMatchObject({ status: 'ready', text: '/workspace/real.png' });
    expect(binaryRead).not.toHaveBeenCalled();
  });

  it('redacts the complete public text before slicing, measures that exact UTF-16 text, and omits inline media', async () => {
    const token = 'synthetic-secret-spans-chunk', source = 'abc' + token + 'def data:image/png;base64,aGVsbG8=';
    options.redact = vi.fn(text => text.replaceAll(token, '[redacted]'));
    bridge.handler = () => page({ type: 'agentMessage', text: source });
    const result = await readNativeItemDetail(bridge, request({ limit: 8 }), options);
    expect(result).toMatchObject({ status: 'ready', text: 'abc[reda', totalChars: 'abc[redacted]def [inline media omitted]'.length });
    expect(JSON.stringify(result)).not.toContain(token); expect(JSON.stringify(result)).not.toContain('aGVsbG8=');
    expect(options.redact).toHaveBeenCalledWith(source);
  });

  it('returns safe Unicode boundaries without dropping characters or inventing code-point counts', async () => {
    const source = 'a😀b\ud800z'; bridge.handler = () => page({ type: 'agentMessage', text: source });
    const first = await readNativeItemDetail(bridge, request({ limit: 2 }), options);
    if (first.status !== 'ready') throw new Error('Expected public Unicode text.');
    expect(first).toMatchObject({ text: 'a', totalChars: 6, offset: 0, nextOffset: 1 });
    const second = await readNativeItemDetail(bridge, request({ cursor: first.itemCursor, version: first.version, offset: 2, limit: 2 }), options);
    expect(second).toMatchObject({ status: 'ready', text: '😀', offset: 1, nextOffset: 3, previousOffset: 0 });
    const last = await readNativeItemDetail(bridge, request({ cursor: first.itemCursor, version: first.version, offset: 3, limit: 3 }), options);
    expect(last).toMatchObject({ status: 'ready', text: 'b�z', offset: 3, nextOffset: null });
  });

  it('fails visibly for unknown parts, offsets, or excessive parts instead of clipping them silently', async () => {
    const first = await readNativeItemDetail(bridge, request(), options);
    if (first.status !== 'ready') throw new Error('Expected public text.');
    await expect(readNativeItemDetail(bridge, request({ part: 1 }), options)).rejects.toMatchObject({ status: 416, code: 'CODEX_DETAIL_RANGE' });
    await expect(readNativeItemDetail(bridge, request({ cursor: first.itemCursor, version: first.version, offset: first.totalChars + 1 }), options))
      .rejects.toMatchObject({ status: 416, code: 'CODEX_DETAIL_RANGE' });
    bridge.handler = () => page({ type: 'reasoning', summary: Array.from({ length: 129 }, () => 'Actual public summary.') });
    await expect(readNativeItemDetail(bridge, request(), options)).rejects.toMatchObject({ status: 413, code: 'CODEX_DETAIL_LIMIT' });
  });

  it('reserves the next whole native frame before continuing a media-heavy search', async () => {
    const firstBytes = 'x'.repeat(30 * 1024 * 1024), secondBytes = 'y'.repeat(2 * 1024 * 1024);
    bridge.handler = params => page({ id: 'other-' + String(params.cursor ?? 'first'), type: 'userMessage',
      content: [{ type: 'image', url: params.cursor ? secondBytes : firstBytes }] }, params.cursor ? 'real-third-cursor' : 'real-second-cursor');
    const result = await readNativeItemDetail(bridge, request(), options);
    expect(result).toMatchObject({ status: 'searching', pagesScanned: 2, nextCursor: 'real-third-cursor' });
    expect(bridge.calls).toHaveLength(2); expect(options.redact).not.toHaveBeenCalled();
    expect(JSON.stringify(result).length).toBeLessThan(500);
  });

  it('rejects pages beyond the native frame bound before public extraction', async () => {
    bridge.handler = () => page({ type: 'agentMessage', text: 'x'.repeat(NATIVE_ITEM_DETAIL_LIMITS.nativeFrameBytes) });
    await expect(readNativeItemDetail(bridge, request(), options)).rejects.toMatchObject({ status: 413, code: 'CODEX_DETAIL_LIMIT' });
    expect(options.redact).not.toHaveBeenCalled(); expect(bridge.calls).toHaveLength(1);
  });

  it('checks site authorization before reading, after each native response, and before returning redacted text', async () => {
    let allowed = false; options.assertCurrent = vi.fn(() => { if (!allowed) throw new HttpError(410, 'Workspace removed.', 'SITE_REMOVED'); });
    await expect(readNativeItemDetail(bridge, request(), options)).rejects.toMatchObject({ code: 'SITE_REMOVED' });
    expect(bridge.calls).toHaveLength(0); allowed = true;
    bridge.handler = () => { allowed = false; return page({ type: 'agentMessage', text: 'Do not publish after revocation.' }); };
    await expect(readNativeItemDetail(bridge, request(), options)).rejects.toMatchObject({ code: 'SITE_REMOVED' });
    expect(options.redact).not.toHaveBeenCalled(); allowed = true;
    bridge.handler = () => page({ type: 'agentMessage', text: 'Do not publish after this generation.' });
    options.redact = text => { allowed = false; return text; };
    await expect(readNativeItemDetail(bridge, request(), options)).rejects.toMatchObject({ code: 'SITE_REMOVED' });
  });

  it('rejects connection replacement across the authority await or native read without restarting work', async () => {
    options.assertCurrent = async () => { bridge.current = 'another-native-generation'; };
    await expect(readNativeItemDetail(bridge, request(), options)).rejects.toMatchObject({ code: 'CODEX_DETAIL_CONNECTION_CHANGED' });
    expect(bridge.calls).toHaveLength(0);
    options.assertCurrent = () => undefined;
    bridge.handler = () => { bridge.current = 'yet-another-generation'; return page({ type: 'agentMessage', text: 'Stale' }); };
    await expect(readNativeItemDetail(bridge, request(), options)).rejects.toMatchObject({ code: 'CODEX_DETAIL_CONNECTION_CHANGED' });
    expect(bridge.calls).toHaveLength(1);
  });

  it('bounds a stalled native request to fifteen seconds without an actual clock wait', async () => {
    vi.useFakeTimers(); let now = 0; vi.spyOn(performance, 'now').mockImplementation(() => now);
    bridge.handler = () => new Promise(() => {});
    const outcome = readNativeItemDetail(bridge, request(), options).catch(error => error);
    await vi.advanceTimersByTimeAsync(0); expect(bridge.calls).toHaveLength(1);
    now = 15_001; await vi.advanceTimersByTimeAsync(15_001);
    expect(await outcome).toMatchObject({ status: 504, code: 'CODEX_DETAIL_TIMEOUT' });
    expect(bridge.calls).toHaveLength(1);
  });

  it('preserves an actual native cursor error and detects a repeated cursor or wrong-turn response', async () => {
    const failure = new HttpError(409, 'Native cursor was invalidated by history revert.', 'CODEX_RPC_REJECTED');
    bridge.handler = () => { throw failure; };
    await expect(readNativeItemDetail(bridge, request({ cursor: 'opaque-native-cursor' }), options)).rejects.toBe(failure);
    bridge.handler = () => page({ id: 'other-item', type: 'plan', text: 'Another item.' }, 'same-cursor');
    await expect(readNativeItemDetail(bridge, request({ cursor: 'same-cursor' }), options)).rejects.toMatchObject({ code: 'CODEX_DETAIL_CURSOR_STALE' });
    bridge.handler = () => ({ data: [row({ type: 'agentMessage', text: 'Wrong turn.' }, OTHER_TURN)], nextCursor: null });
    await expect(readNativeItemDetail(bridge, request(), options)).rejects.toMatchObject({ code: 'CODEX_DETAIL_PROTOCOL' });
  });

  it('validates all request bounds and never starts or resumes an unavailable native connection', async () => {
    for (const input of [request({ threadId: 'thr_legacy' }), request({ turnId: 'guessed-turn' }), request({ itemId: '' }),
      request({ cursor: 'x'.repeat(16 * 1024 + 1) }), request({ field: 'private' as never }), request({ offset: 1 }),
      request({ version: 'a'.repeat(64) }), request({ limit: 16_001 }), request({ limit: 1 }), request({ part: 128 })]) {
      await expect(readNativeItemDetail(bridge, input, options)).rejects.toMatchObject({ code: 'CODEX_DETAIL_INVALID' });
    }
    expect(bridge.calls).toHaveLength(0);
    bridge.current = null;
    await expect(readNativeItemDetail(bridge, request(), options)).rejects.toMatchObject({ code: 'CODEX_DETAIL_UNAVAILABLE' });
    bridge.current = 'native-generation'; bridge.available = false;
    await expect(readNativeItemDetail(bridge, request(), options)).rejects.toMatchObject({ code: 'CODEX_DETAIL_UNAVAILABLE' });
    expect(bridge.calls).toHaveLength(0);
  });
});
