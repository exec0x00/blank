import { describe, expect, it, vi } from 'vitest';
import type { CodexThreadState, FileAttachment, ImageAttachment, Thread } from '../shared/types';
import {
  applyNativeNotification, NATIVE_PROJECTION_LIMITS, NativeProjectionLimitError, projectNativeThread,
  type NativeItemEntry, type NativeThreadItem, type NativeThreadMetadata,
} from '../server/codex-cli/projection';
import { conversationTimeline } from '../client/components/chat/timeline';
import { formatToolActivity } from '../client/components/chat/tool-presentation';

// Structural fixtures from official app-server 0.159.2 v2 schemas. These tests
// exercise pure public presentation, not a simulated CLI/model/tool runtime.
const threadId = '0199ab12-3a12-7123-a456-123456789abc';
const turnId = '0199ab12-3a14-7456-a789-abcdef123456';
const secondTurnId = '0199ab12-3a16-7567-b123-fedcba123456';
const otherThreadId = '0199ab12-3a18-7678-b234-fedcba654321';
const workspaceId = 'workspace-projection';
const started = 1_790_100_000, observedAt = new Date((started + 20) * 1000).toISOString();
const metadata = (extra: Partial<NativeThreadMetadata> = {}): NativeThreadMetadata => ({
  id: threadId, createdAt: started, updatedAt: started + 10, name: 'Native conversation', preview: 'Initial request',
  status: { type: 'idle' }, model: 'gpt-6-astra', reasoningEffort: 'max',
  turns: [{ id: turnId, status: 'completed', startedAt: started + 1, completedAt: started + 9 }], ...extra,
});
const entry = (type: string, id: string, fields: Record<string, unknown> = {}, ownerTurnId = turnId): NativeItemEntry => ({ turnId: ownerTurnId, item: { type, id, ...fields } });
const user = () => entry('userMessage', 'native-user-item', { content: [{ type: 'text', text: 'Inspect this project.', text_elements: [] }] });
const empty = () => projectNativeThread(metadata(), [], workspaceId);
const event = (view: Thread, method: string, params: Record<string, unknown>) => applyNativeNotification(view, method,
  { threadId, turnId, ...params }, { observedAt });
const nativeState = (): CodexThreadState => ({ model: 'gpt-6-astra', reasoningEffort: 'max', activeTurnId: null,
  approvals: [], questions: [], queue: [], queueCursor: null, goal: null, tokenUsage: null, diff: null,
  capabilities: { conversations: true, pagination: true, queue: true, goals: true, skills: true, plan: true, review: true, historyRevert: true } });
const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child);Object.freeze(value); }
  return value;
};

describe('native Codex public history projection', () => {
  it('preserves native UUIDs, item IDs and supplied page order without invented counts or ordinals', () => {
    const entries = [user(), entry('agentMessage', 'message-before', { text: 'Before the command.', phase: 'commentary' }),
      entry('reasoning', 'public-reasoning', { summary: ['A public summary.'], content: ['PRIVATE_REASONING_SENTINEL'] }),
      entry('commandExecution', 'native-command', { command: 'pwd', cwd: '/workspace', status: 'completed', aggregatedOutput: '/workspace\n', exitCode: 0 }),
      entry('agentMessage', 'message-after', { text: 'After the command.', phase: 'final_answer' })];
    const view = projectNativeThread(metadata(), entries, workspaceId, undefined, { startSequence: 700 });
    expect(view.id).toBe(threadId);expect(view.backend).toBe('codex-cli');expect(view.messages.map(message => message.id)).toEqual(entries.map(item => item.item.id));
    expect(view.messages.every(message => message.turnId === turnId && message.ordinal === undefined)).toBe(true);
    expect(view.turns).toMatchObject([{ id: turnId, userMessageId: 'native-user-item', startedAt: new Date((started + 1) * 1000).toISOString(), status: 'completed' }]);
    expect(view.turns?.[0].ordinal).toBeUndefined();expect(view.history).toBeUndefined();
    expect(view.timeline?.entries.map(item => item.sequence)).toEqual([700, 701, 702, 703, 704]);
    expect(conversationTimeline(view).map(row => row.kind)).toEqual(['message', 'message', 'reasoning', 'activity', 'message', 'turn-end']);
    expect(JSON.stringify(view)).not.toContain('PRIVATE_REASONING_SENTINEL');
    expect(projectNativeThread(metadata(), entries, workspaceId, undefined, { startSequence: 700 })).toEqual(view);
  });

  it('anchors timestamp-less history to supplied native turn/thread times and never the current clock', () => {
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('Projection must not invent a timestamp.'); });
    try {
      const view = projectNativeThread(metadata({ turns: [] }), [entry('commandExecution', 'command', { command: 'ls', status: 'completed' })], workspaceId);
      expect(view.messages[0].createdAt).toBe(new Date(started * 1000).toISOString());
      expect(view.messages[0].activities?.[0].startedAt).toBe(view.createdAt);
      expect(view.messages[0].activities?.[0].completedAt).toBeUndefined();
      expect(view.turns).toEqual([]); // User item/turn metadata is outside this page.
      const supplied = projectNativeThread(metadata({ turns: [] }), [user()], workspaceId, undefined,
        { turns: [{ id: turnId, status: 'completed', startedAt: started + 3 }] });
      expect(supplied.messages[0].createdAt).toBe(new Date((started + 3) * 1000).toISOString());
    } finally { clock.mockRestore(); }
  });

  it('never reads private reasoning, opaque search results, raw image bytes, hook prompts or MCP arguments', () => {
    const secret = () => { throw new Error('Private payload was accessed.'); };
    const reasoning = entry('reasoning', 'summary', { summary: ['Safe summary.'] });
    Object.defineProperty(reasoning.item, 'content', { get: secret });
    const generated = entry('imageGeneration', 'generated-image', { status: 'completed', revisedPrompt: 'A blue square.', savedPath: '/workspace/square.png', failure: null });
    Object.defineProperty(generated.item, 'result', { get: secret });
    const search = entry('webSearch', 'search', { query: 'native projection', action: { type: 'search' } });
    Object.defineProperty(search.item, 'results', { get: secret });
    const hook = entry('hookPrompt', 'hook');Object.defineProperty(hook.item, 'fragments', { get: secret });
    const mcp = entry('mcpToolCall', 'mcp');Object.defineProperty(mcp.item, 'arguments', { get: secret });
    const meta = metadata();Object.defineProperty(meta, 'extra', { get: secret });
    const view = projectNativeThread(meta, [reasoning, generated, search, hook, mcp], workspaceId);
    expect(view.messages.map(message => message.id)).toEqual(['summary', 'generated-image', 'search', 'mcp']);
    expect(JSON.stringify(view)).toContain('Safe summary.');expect(JSON.stringify(view)).toContain('/workspace/square.png');
    expect(view.messages[1].activities?.[0].generatedImage).toBeUndefined();
  });

  it('renders user text, mentions and skills while resolving only actual same-workspace attachment metadata', () => {
    const image: ImageAttachment = { id: 'att_' + 'a'.repeat(32), workspaceId, name: 'photo.png', mimeType: 'image/png', bytes: 100,
      width: 2, height: 3, sha256: 'b'.repeat(64), detail: 'high', createdAt: observedAt,
      previewUrl: `/api/workspaces/${workspaceId}/attachments/att_${'a'.repeat(32)}/content?sha256=${'b'.repeat(64)}` };
    const file: FileAttachment = { id: 'file_' + 'c'.repeat(32), workspaceId, name: 'notes.txt', mimeType: 'text/plain', bytes: 20,
      sha256: 'd'.repeat(64), createdAt: observedAt };
    const input = entry('userMessage', 'user-with-inputs', { clientId: 'actual-client-user-message', content: [
      { type: 'text', text: 'Look here.', text_elements: [{ private: 'HIDDEN_TEXT_ELEMENT' }] },
      { type: 'mention', name: 'notes', path: '/workspace/notes.txt' }, { type: 'skill', name: 'testing', path: '/private/skill.md' },
      { type: 'localImage', path: '/workspace/photo.png' }, { type: 'image', url: 'data:image/png;base64,PRIVATE_IMAGE_BYTES' },
    ] });
    const resolver = vi.fn((part: { type: string }, context: { inputIndex: number }) => context.inputIndex === 1 ? { fileAttachments: [file] }
      : part.type === 'localImage' ? { attachments: [image, { ...image, id: 'att_' + 'e'.repeat(32), workspaceId: 'other-workspace' }] } : undefined);
    const view = projectNativeThread(metadata(), [input], workspaceId, undefined, { resolveAttachment: resolver });
    expect(view.messages[0]).toMatchObject({ content: 'Look here.\n[Skill: testing]\n[Image attachment]', attachments: [image], fileAttachments: [file] });
    expect(resolver.mock.calls[1][1]).toMatchObject({ threadId, turnId, itemId: 'user-with-inputs', workspaceId, inputIndex: 1, clientUserMessageId: 'actual-client-user-message' });
    expect(resolver.mock.calls[0][0].type).toBe('text');
    expect(JSON.stringify(view)).not.toMatch(/PRIVATE_IMAGE_BYTES|HIDDEN_TEXT_ELEMENT|\/private\/skill/);
    expect(projectNativeThread(metadata(), [input], workspaceId).messages[0].attachments).toBeUndefined();
  });

  it('replaces only exactly bound generated attachment text suffixes, preserving user prose and native null client IDs', () => {
    const file: FileAttachment = { id: 'file_' + 'a'.repeat(32), workspaceId, name: 'notes.txt', mimeType: 'text/plain', bytes: 20,
      sha256: 'b'.repeat(64), createdAt: observedAt };
    const prompt = 'Keep my exact leading and trailing text.\n', nativeText = prompt + '\nGenerated factual attachment reference.';
    const input = entry('userMessage', 'bound-user', { clientId: 'accepted-client-id', content: [{ type: 'text', text: nativeText, text_elements: [] }] });
    const resolveAttachment = vi.fn((_input, context) => context.clientUserMessageId === 'accepted-client-id' ? { text: prompt, fileAttachments: [file] } : undefined);
    const view = projectNativeThread(metadata(), [input], workspaceId, undefined, { resolveAttachment });
    expect(view.messages[0]).toMatchObject({ content: prompt, fileAttachments: [file], clientUserMessageId: 'accepted-client-id' });expect(input.item.content).toEqual([{ type: 'text', text: nativeText, text_elements: [] }]);
    const unbound = { ...input, item: { ...input.item, clientId: null } };
    expect(projectNativeThread(metadata(), [unbound], workspaceId, undefined, { resolveAttachment }).messages[0].content).toBe(nativeText);
    expect(projectNativeThread(metadata(), [unbound], workspaceId).messages[0].clientUserMessageId).toBeUndefined();
    expect(resolveAttachment.mock.calls.at(-1)?.[1].clientUserMessageId).toBeNull();
    expect(projectNativeThread(metadata(), [input], workspaceId, undefined, { resolveAttachment: () => ({ text: 'Invented user prose', fileAttachments: [file] }) }).messages[0].content).toBe(nativeText);
    expect(projectNativeThread(metadata(), [input], workspaceId, undefined, { resolveAttachment: () => ({ text: '', fileAttachments: [{ ...file, workspaceId: 'other' }] }) }).messages[0].content).toBe(nativeText);
    expect(projectNativeThread(metadata(), [input], workspaceId, undefined, { resolveAttachment: () => ({ text: '' }) }).messages[0].content).toBe(nativeText);
  });

  it('keeps model and effort as exact native literals, with explicit null and no truncated substitute IDs', () => {
    const view = projectNativeThread(metadata({ model: 'literal-wire/model', reasoningEffort: 'literal_effort' }), [], workspaceId);
    expect(view.native).toMatchObject({ model: 'literal-wire/model', reasoningEffort: 'literal_effort' });
    const state = { ...nativeState(), model: null, reasoningEffort: null };
    expect(projectNativeThread(metadata(), [], workspaceId, state).native).toMatchObject({ model: null, reasoningEffort: null });
    expect(projectNativeThread(metadata({ model: 'x'.repeat(257) }), [], workspaceId).native?.model).toBeNull();
  });

  it('rejects invented backend aliases, inconsistent item ownership and oversized native windows', () => {
    expect(() => projectNativeThread(metadata({ id: 'thr_invented' }), [], workspaceId)).toThrow(/native thread UUID/i);
    expect(() => projectNativeThread(metadata(), [entry('agentMessage', 'native-item', { text: 'Text' }, 'run_invented')], workspaceId)).toThrow(/actual item and turn/);
    expect(() => projectNativeThread(metadata(), [entry('agentMessage', 'same', { text: 'First' }), entry('agentMessage', 'same', { text: 'Second' }, secondTurnId)], workspaceId)).toThrow(/scope/);
    expect(() => projectNativeThread(metadata(), Array.from({ length: 257 }, (_, index) => entry('agentMessage', 'm' + index)), workspaceId)).toThrow(NativeProjectionLimitError);
    expect(() => projectNativeThread(metadata(), [], workspaceId, undefined, { startSequence: Number.MAX_SAFE_INTEGER })).toThrow(NativeProjectionLimitError);
  });

  it('bounds logical text, preserves valid tool descriptors and leaves complete native input untouched', () => {
    const entries = [entry('agentMessage', 'huge-message', { text: '🙂'.repeat(10_000) }),
      entry('commandExecution', 'huge-command', { command: 'x'.repeat(30_000), cwd: '/workspace', status: 'completed', aggregatedOutput: 'o'.repeat(50_000), exitCode: 0 })];
    freeze(entries);const before = JSON.stringify(entries);
    const view = projectNativeThread(metadata(), entries, workspaceId, undefined, { limits: { maxTextChars: 300, maxTotalTextChars: 500 } });
    const message = view.messages[0], activity = view.messages[1].activities![0];
    expect(message.content.length).toBeLessThanOrEqual(300);expect(message.contentChars).toBe(20_000);expect(message.contentTruncated).toBe(true);
    expect(message.content.endsWith('\ud83d')).toBe(false);expect(activity.inputTruncated).toBe(true);expect(activity.outputTruncated).toBe(true);
    if (activity.input) expect(() => JSON.parse(activity.input)).not.toThrow();
    if (activity.output) expect(() => JSON.parse(activity.output!)).not.toThrow();
    expect(message.content.length + activity.input.length + (activity.output?.length ?? 0)).toBeLessThanOrEqual(500);
    expect(JSON.stringify(entries)).toBe(before);
  });

  it('maps commands, actual diffs, collaboration and web/image/review actions into the existing readable renderer', () => {
    const view = projectNativeThread(metadata(), [
      entry('commandExecution', 'cmd', { command: 'cat package.json', cwd: '/workspace', status: 'completed', aggregatedOutput: '{"name":"project"}\n', exitCode: 0 }),
      entry('fileChange', 'patch', { status: 'completed', changes: [{ path: 'file.ts', kind: { type: 'update', move_path: null }, diff: '@@ -1 +1 @@\n-old\n+new' }] }),
      entry('collabAgentToolCall', 'delegate', { tool: 'spawnAgent', status: 'completed', senderThreadId: threadId, receiverThreadIds: [otherThreadId],
        prompt: 'Check the tests.', model: 'gpt-6-astra', reasoningEffort: 'max', agentsStates: { [otherThreadId]: { status: 'completed', message: 'Checked the tests.' } } }),
      entry('webSearch', 'web', { query: 'Codex docs', action: { type: 'search', queries: ['Codex docs'] }, results: [{ raw: 'OPAQUE_SEARCH_RESULT' }] }),
      entry('imageView', 'image', { path: '/workspace/photo.png' }), entry('sleep', 'sleep', { durationMs: 500 }),
      entry('enteredReviewMode', 'review', { review: 'Review the changed files.' }), entry('contextCompaction', 'compact'),
    ], workspaceId);
    const activities = view.messages.flatMap(message => message.activities ?? []), rendered = activities.map(formatToolActivity);
    expect(rendered.map(item => item.kind)).toEqual(['command', 'changes', 'agent', 'web', 'image', 'time', 'generic', 'generic']);
    expect(JSON.stringify(rendered)).toContain('cat package.json');expect(JSON.stringify(rendered)).toContain('package.json');
    expect(JSON.stringify(rendered)).toContain('file.ts');expect(JSON.stringify(rendered)).toContain('Check the tests.');
    expect(JSON.stringify(rendered)).not.toMatch(/OPAQUE_SEARCH_RESULT|commandExecution|collabAgentToolCall|encrypted_content/);
    expect(activities.map(activity => activity.id)).toEqual(['cmd', 'patch', 'delegate', 'web', 'image', 'sleep', 'review', 'compact']);
  });

  it('rejects credential-bearing web URLs and encrypted/media protocol parts without hiding public tool text', () => {
    const view = projectNativeThread(metadata(), [entry('webSearch', 'secret-url', { query: '', action: { type: 'open_page', url: 'https://user:SECRET@example.com/' } }),
      entry('webSearch', 'token-url', { query: '', action: { type: 'open_page', url: 'https://example.com/?token=SECRET' } }),
      entry('functionCallOutput', 'result', { name: 'site_tool', output: [
        { type: 'input_text', text: 'Public tool text.' }, { type: 'encrypted_content', encrypted_content: 'ENCRYPTED_SECRET' },
        { type: 'input_image', image_url: 'data:image/png;base64,IMAGE_SECRET' }, { type: 'input_audio', audio_url: 'AUDIO_SECRET' },
      ] }), entry('dynamicToolCall', 'dynamic', { tool: 'site_tool', status: 'completed', success: true,
        arguments: { password: 'ARGUMENT_SECRET' }, contentItems: [{ type: 'inputText', text: '{"message":"Readable result."}' }] })], workspaceId);
    expect(JSON.stringify(view)).not.toMatch(/SECRET|encrypted_content|data:image/);expect(JSON.stringify(view)).toContain('Public tool text.');
    expect(JSON.stringify(view)).toContain('Readable result.');
  });

  it('shows actual moved-file destinations and readable native review findings without protocol dumps', () => {
    const view = projectNativeThread(metadata(), [entry('fileChange', 'move', { status: 'completed', changes: [{ path: 'old.ts', kind: { type: 'update', move_path: 'new.ts' }, diff: 'actual diff' }] }),
      entry('exitedReviewMode', 'review-result', { review: JSON.stringify({ findings: [{ title: 'Guard the empty case', body: 'The empty value needs a check.', private_field: 'PRIVATE_REVIEW_FIELD' }], overall_explanation: 'One issue was found.' }) })], workspaceId);
    expect(JSON.parse(view.messages[0].activities![0].output!).changed).toEqual([{ path: 'new.ts', operation: 'moved' }]);
    const rendered = JSON.stringify(formatToolActivity(view.messages[1].activities![0]));
    expect(rendered).toContain('One issue was found.');expect(rendered).toContain('Guard the empty case');expect(rendered).not.toMatch(/PRIVATE_REVIEW_FIELD|overall_explanation/);
  });
});

describe('native notification public reducer', () => {
  it.each(['item/reasoning/textDelta', 'rawResponseItem/completed', 'rawResponse/completed', 'unknown/method'])
    ('ignores %s without inspecting its parameters', method => {
      const view = empty(), source = new Proxy({}, { get: () => { throw new Error('Raw parameters must remain unread.'); } });
      expect(applyNativeNotification(view, method, source)).toBe(view);
    });

  it('does not mix a foreign thread, an unknown item or a mismatching native turn into this window', () => {
    const view = projectNativeThread(metadata(), [entry('agentMessage', 'message', { text: 'Public' })], workspaceId);
    expect(event(view, 'item/agentMessage/delta', { threadId: otherThreadId, itemId: 'message', delta: 'FOREIGN' })).toBe(view);
    expect(event(view, 'item/agentMessage/delta', { turnId: secondTurnId, itemId: 'message', delta: 'FOREIGN' })).toBe(view);
    expect(event(view, 'item/agentMessage/delta', { itemId: 'missing', delta: 'UNKNOWN' })).toBe(view);
    expect(event({ ...view, backend: 'legacy' }, 'item/agentMessage/delta', { itemId: 'message', delta: 'NATIVE' }).messages[0].content).toBe('Public');
  });

  it('retains the actual interleaving of message and public-summary fragments around native tools', () => {
    let view = projectNativeThread(metadata({ status: { type: 'active', activeFlags: [] } }), [user()], workspaceId);
    view = event(view, 'item/started', { item: { type: 'agentMessage', id: 'answer', text: '' }, startedAtMs: (started + 2) * 1000 });
    view = event(view, 'item/agentMessage/delta', { itemId: 'answer', delta: 'First. ' });
    view = event(view, 'item/started', { item: { type: 'reasoning', id: 'reason', summary: [], content: ['PRIVATE'] }, startedAtMs: (started + 3) * 1000 });
    view = event(view, 'item/reasoning/summaryPartAdded', { itemId: 'reason', summaryIndex: 0 });
    view = event(view, 'item/reasoning/summaryTextDelta', { itemId: 'reason', summaryIndex: 0, delta: 'Public summary. ' });
    view = event(view, 'item/started', { item: { type: 'commandExecution', id: 'command', command: 'pwd', cwd: '/workspace', status: 'inProgress', aggregatedOutput: null }, startedAtMs: (started + 4) * 1000 });
    view = event(view, 'item/reasoning/summaryTextDelta', { itemId: 'reason', summaryIndex: 0, delta: 'After tool. ' });
    view = event(view, 'item/agentMessage/delta', { itemId: 'answer', delta: 'Last.' });
    expect(view.timeline?.entries.filter(item => item.kind === 'text' || item.kind === 'reasoning' || item.kind === 'activity')
      .map(item => item.kind === 'activity' ? 'tool' : item.text)).toEqual(['First. ', 'Public summary. ', 'tool', 'After tool. ', 'Last.']);
    expect(view.messages.find(message => message.id === 'answer')?.content).toBe('First. Last.');
    expect(JSON.stringify(view)).not.toContain('PRIVATE');
    const beforeIds = view.timeline!.entries.map(entry => entry.id);
    view = event(view, 'item/completed', { item: { type: 'agentMessage', id: 'answer', text: 'First. Last.' }, completedAtMs: (started + 9) * 1000 });
    expect(view.timeline!.entries.map(entry => entry.id)).toEqual(beforeIds);
  });

  it('places a corrected final public value at its observed position instead of inventing its earlier order', () => {
    let view = projectNativeThread(metadata(), [entry('agentMessage', 'answer', { text: 'Earlier text.' }),
      entry('commandExecution', 'cmd', { command: 'pwd', status: 'completed', aggregatedOutput: '/workspace', exitCode: 0 })], workspaceId);
    view = event(view, 'item/completed', { item: { type: 'agentMessage', id: 'answer', text: 'Corrected text.' }, completedAtMs: (started + 11) * 1000 });
    expect(view.timeline?.entries.at(-1)).toMatchObject({ kind: 'text', text: 'Corrected text.', revised: true, startOffset: 0 });
    expect(conversationTimeline(view).filter(row => row.kind === 'message').map(row => row.kind === 'message' ? row.content : '')).toEqual(['Corrected text.']);
  });

  it('honors a completed native summary correction without retaining removed public parts or private content', () => {
    let view = projectNativeThread(metadata(), [entry('reasoning', 'reason', { summary: ['Old first summary.', 'Removed summary.'], content: ['PRIVATE'] })], workspaceId);
    view = event(view, 'item/completed', { item: { type: 'reasoning', id: 'reason', summary: ['Corrected summary.'], content: ['PRIVATE_FINAL'] }, completedAtMs: (started + 10) * 1000 });
    expect(view.messages[0].reasoningSummary).toEqual([{ id: 'reason', summaryIndex: 0, text: 'Corrected summary.', status: 'complete' }]);
    expect(JSON.stringify(view)).not.toMatch(/Old first summary|Removed summary|PRIVATE/);
  });

  it('uses actual item lifecycle milliseconds and bounds command deltas while retaining final native exit state', () => {
    let view = event(empty(), 'item/started', { item: { type: 'commandExecution', id: 'command', command: 'printf result', cwd: '/workspace', status: 'inProgress', aggregatedOutput: null }, startedAtMs: (started + 2) * 1000 + 125 });
    const frozen = freeze(structuredClone(view));
    view = event(frozen, 'item/commandExecution/outputDelta', { itemId: 'command', delta: 'x'.repeat(50_000) });
    expect(frozen.messages[0].activities?.[0].output).not.toContain('xxxx');
    expect(view.messages[0].activities?.[0].output!.length).toBeLessThanOrEqual(NATIVE_PROJECTION_LIMITS.maxTextChars);
    expect(view.messages[0].activities?.[0].outputTruncated).toBe(true);
    expect(view.messages[0].activities?.[0].outputChars).toBe(50_000);
    view = event(view, 'item/completed', { item: { type: 'commandExecution', id: 'command', command: 'printf result', cwd: '/workspace', status: 'failed', aggregatedOutput: 'actual error', exitCode: 2 }, completedAtMs: (started + 4) * 1000 + 250 });
    expect(view.messages[0].activities?.[0]).toMatchObject({ id: 'command', status: 'error', startedAt: new Date((started + 2) * 1000 + 125).toISOString(), completedAt: new Date((started + 4) * 1000 + 250).toISOString() });
    expect(JSON.parse(view.messages[0].activities![0].output!)).toMatchObject({ output: 'actual error', exit_code: 2, running: false });
  });

  it('keeps native file patch updates and progress readable without changing activity identity', () => {
    let view = event(empty(), 'item/started', { item: { type: 'fileChange', id: 'patch', changes: [], status: 'inProgress' }, startedAtMs: started * 1000 });
    view = event(view, 'item/fileChange/patchUpdated', { itemId: 'patch', changes: [{ path: 'new.ts', kind: { type: 'add' }, diff: '+export const value = 1;' }] });
    view = event(view, 'item/fileChange/outputDelta', { itemId: 'patch', delta: 'Applying the change.' });
    expect(JSON.parse(view.messages[0].activities![0].input).patch).toBe('+export const value = 1;');
    expect(JSON.parse(view.messages[0].activities![0].output!).notice).toBe('Applying the change.');
    expect(view.timeline?.entries).toHaveLength(1);expect(view.messages[0].activities?.[0].id).toBe('patch');
  });

  it('maps actual usage only with an observation time and never invents last/billing-request metrics', () => {
    const value = { totalTokens: 900, inputTokens: 800, cachedInputTokens: 100, cacheWriteInputTokens: 10, outputTokens: 100, reasoningOutputTokens: 20 };
    const params = { threadId, turnId, tokenUsage: { total: value, last: { ...value, totalTokens: 300 }, modelContextWindow: 1_050_000 } };
    const view = empty();expect(applyNativeNotification(view, 'thread/tokenUsage/updated', params).native?.tokenUsage).toBeNull();
    const updated = applyNativeNotification(view, 'thread/tokenUsage/updated', params, { observedAt });
    expect(updated.native?.tokenUsage).toEqual({ total: value, contextTokens: 300, modelContextWindow: 1_050_000, reportedAt: observedAt });
    expect(updated.usage).toBeUndefined();expect(updated.contextUsage).toBeUndefined();expect(updated.native?.tokenUsage).not.toHaveProperty('last');
    expect(updated.native?.tokenUsage?.total).not.toHaveProperty('requests');
  });

  it('passes explicit native controls as data, never claims queued input or invents legacy approval/goal scheduling', () => {
    const state = nativeState();state.queue = [{ id: 'queue-native', clientUserMessageId: 'client-native', prompt: 'Not sent yet.', attachmentNames: ['notes.txt'] }];
    state.approvals = [{ id: 'connection-request', threadId, turnId, itemId: 'native-command', kind: 'command', title: 'Run command',
      description: 'Print the working directory.', command: 'pwd', decisions: ['accept', 'decline'], createdAt: observedAt }];
    state.goal = { threadId, objective: 'Use the actual native goal.', status: 'active', tokenBudget: 10, tokensUsed: 11, timeUsedSeconds: 2, createdAt: started, updatedAt: started + 2 };
    const view = projectNativeThread(metadata(), [user()], workspaceId, freeze(state));
    expect(view.messages).toHaveLength(1);expect(view.queuedInput).toBeUndefined();expect(view.pendingApproval).toBeUndefined();expect(view.goal).toBeUndefined();
    expect(view.native?.goal?.status).toBe('active');expect(view.native?.queue).toEqual(state.queue);
    const unchanged = event(view, 'serverRequest/resolved', { requestId: 'connection-request' });expect(unchanged.native?.approvals).toEqual(state.approvals);
    expect(event(view, 'thread/queue/changed', {}).native?.queue).toEqual(state.queue);
    const replacement = { ...nativeState(), queueCursor: 'actual-native-cursor' };
    const updated = applyNativeNotification(view, 'thread/queue/changed', { threadId }, { nativeState: replacement });
    expect(updated.native?.queue).toEqual([]);expect(updated.native?.queueCursor).toBe('actual-native-cursor');
    expect(view.native?.queue).toEqual(state.queue);
  });

  it('uses native status/goal/plan notifications without executing transitions or exposing private error details', () => {
    let view = event(empty(), 'thread/status/changed', { status: { type: 'active', activeFlags: ['waitingOnApproval'] } });
    expect(view.status).toBe('awaiting_approval');
    view = event(view, 'turn/plan/updated', { explanation: 'The native plan.', plan: [{ step: 'Inspect files', status: 'completed' }, { step: 'Apply change', status: 'inProgress' }] });
    expect(formatToolActivity(view.messages[0].activities![0]).summary).toBe('1 of 2 completed');
    view = event(view, 'thread/goal/updated', { goal: { threadId, objective: 'The native goal.', status: 'complete', tokenBudget: null, tokensUsed: 20, timeUsedSeconds: 3, createdAt: started, updatedAt: started + 3 } });
    expect(view.native?.goal?.status).toBe('complete');
    view = event(view, 'thread/goal/cleared', {});expect(view.native?.goal).toBeNull();
    const error = { message: 'The native request failed.', additionalDetails: 'PRIVATE_DEBUG_DATA', codexErrorInfo: { secret: 'PRIVATE_ERROR_PAYLOAD' } };
    view = event(view, 'error', { error, willRetry: true });expect(view.status).toBe('awaiting_approval');
    expect(view.error).toBe(error.message);expect(JSON.stringify(view)).not.toMatch(/PRIVATE_DEBUG_DATA|PRIVATE_ERROR_PAYLOAD/);
  });

  it('preserves unrelated newer active turns when an older native turn completes', () => {
    let view = event(empty(), 'turn/started', { turn: { id: secondTurnId, status: 'inProgress', startedAt: started + 30, completedAt: null } });
    view = event(view, 'turn/completed', { turn: { id: turnId, status: 'completed', startedAt: started, completedAt: started + 9 } });
    expect(view.native?.activeTurnId).toBe(secondTurnId);expect(view.status).toBe('running');
    expect(view.updatedAt).toBe(new Date((started + 30) * 1000).toISOString());
  });

  it('signals a fresh native window requirement instead of silently losing overflowed live items', () => {
    const view = projectNativeThread(metadata(), [entry('agentMessage', 'first', { text: 'First' })], workspaceId, undefined, { limits: { maxItems: 1 } });
    expect(() => applyNativeNotification(view, 'item/started', { threadId, turnId, item: { type: 'agentMessage', id: 'second', text: '' } }, { limits: { maxItems: 1 } })).toThrow(NativeProjectionLimitError);
    expect(view.messages.map(message => message.id)).toEqual(['first']);
  });

  it('applies a pure caller redactor to public text and tool previews without changing native input', () => {
    const source = [entry('agentMessage', 'message', { text: 'Public SECRET_VALUE text.' }), entry('commandExecution', 'command',
      { command: 'printf SECRET_VALUE', cwd: '/workspace', status: 'completed', aggregatedOutput: 'SECRET_VALUE', exitCode: 0 })];
    const before = JSON.stringify(source), view = projectNativeThread(metadata(), source, workspaceId, undefined, { redact: text => text.replaceAll('SECRET_VALUE', '[redacted]') });
    expect(JSON.stringify(view)).not.toContain('SECRET_VALUE');expect(JSON.stringify(view)).toContain('[redacted]');expect(JSON.stringify(source)).toBe(before);
  });
});
