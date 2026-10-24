import { describe, expect, it } from 'vitest';
import type { AgentEvent, ChangeRecord, CodexModel, CodexModelCatalog, Thread, ToolActivity } from '../shared/types';
import { applyAgentEvent, isThreadBusy, mergeChanges, mergeThreadSummary, stripAnsi, threadSummary } from '../client/components/chat/state';
import { modelOptions, reasoningOptions } from '../client/components/chat/models';

function conversation(): Thread {
  return { id: 'thread-1', workspaceId: 'workspace-1', title: 'Conversation', status: 'running', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', messages: [] };
}
function event(type: AgentEvent['type'], payload: Record<string, unknown>): AgentEvent { return { type, threadId: 'thread-1', ...payload }; }
const activity: ToolActivity = { id: 'tool-1', name: 'shell', input: '{"command":"npm test"}', status: 'running', startedAt: '2026-01-01T00:00:00Z' };

describe('conversation event state', () => {
  it('reconciles duplicate initial messages without losing streamed text or tool output', () => {
    const initialMessage = { id: 'message-1', role: 'assistant', content: '', createdAt: '2026-01-01T00:00:00Z' };
    const events = [event('message', { message: initialMessage }), event('delta', { messageId: 'message-1', text: 'Checking the project.' }), event('activity', { messageId: 'message-1', activity }), event('message', { message: initialMessage }), event('activity', { messageId: 'message-1', activity: { ...activity, status: 'completed', output: '3 tests passed' } })];
    const result = events.reduce<Thread | null>(applyAgentEvent, conversation())!;
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('Checking the project.');
    expect(result.messages[0].activities).toEqual([{ ...activity, status: 'completed', output: '3 tests passed' }]);
  });

  it('restores an authoritative snapshot on reconnect before appending future deltas', () => {
    const old = applyAgentEvent(conversation(), event('delta', { messageId: 'message-1', text: 'Partial' }))!;
    const snapshot = { ...conversation(), messages: [{ id: 'message-1', role: 'assistant' as const, content: 'Complete answer', createdAt: '2026-01-01T00:00:00Z' }] };
    const restored = applyAgentEvent(old, event('snapshot', { thread: snapshot }))!;
    const result = applyAgentEvent(restored, event('delta', { messageId: 'message-1', text: '.' }))!;
    expect(result.messages[0].content).toBe('Complete answer.');
    expect(result.messages).toHaveLength(1);
  });

  it('accepts activity arriving before its message and merges the later message', () => {
    const working = applyAgentEvent(conversation(), event('activity', { messageId: 'message-1', activity }))!;
    const result = applyAgentEvent(working, event('message', { message: { id: 'message-1', role: 'assistant', content: 'Running checks.', createdAt: '2026-01-01T00:00:00Z' } }))!;
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].activities).toEqual([activity]);
    expect(result.messages[0].content).toBe('Running checks.');
  });

  it('clears approval when the server resumes and ends an active response', () => {
    const approval = { id: 'approval-1', threadId: 'thread-1', tool: 'shell', description: 'Run project tests', command: 'npm test' };
    const pending = applyAgentEvent(conversation(), event('approval', { approval }))!;
    expect(pending.status).toBe('awaiting_approval');
    expect(pending.pendingApproval).toEqual(approval);
    const resumed = applyAgentEvent(pending, event('status', { status: 'running', pendingApproval: null }))!;
    expect(resumed.pendingApproval).toBeUndefined();
    expect(isThreadBusy(resumed)).toBe(true);
    expect(applyAgentEvent(resumed, event('done', { runId: 'run-1' }))?.status).toBe('idle');
  });

  it('keeps a real user question pending until an answer resumes the run', () => {
    const question = { id: 'question-1', threadId: 'thread-1', callId: 'call-1', createdAt: '2026-01-01T00:00:00Z', questions: [{ id: 'scope', header: 'Scope', question: 'Which part should change?', options: [{ label: 'Editor', description: 'Improve editing.' }, { label: 'Terminal', description: 'Improve shell access.' }], isOther: true as const }] };
    const pending = applyAgentEvent(conversation(), event('question', { question }))!;
    expect(pending.pendingQuestion).toEqual(question);
    expect(isThreadBusy(pending)).toBe(true);
    expect(applyAgentEvent(pending, event('status', { status: 'awaiting_input' }))?.pendingQuestion).toEqual(question);
    const resumed = applyAgentEvent(pending, event('status', { status: 'running', pendingQuestion: null }))!;
    expect(resumed.pendingQuestion).toBeUndefined();
    expect(applyAgentEvent(pending, event('error', { error: 'Connection lost' }))?.pendingQuestion).toBeUndefined();
  });

  it('preserves saved history, run status, and pending input when only the stream is unavailable', () => {
    const history = { ...conversation(), messages: [{ id: 'kept', role: 'user' as const, content: 'Saved work', createdAt: '2026-01-01T00:00:00Z' }] };
    const approval = { id: 'approval-1', threadId: 'thread-1', tool: 'shell', description: 'Run checks' };
    const question = { id: 'question-1', threadId: 'thread-1', callId: 'call-1', createdAt: '2026-01-01T00:00:00Z', questions: [] };
    for (const pending of [history, { ...history, status: 'awaiting_approval' as const, pendingApproval: approval },
      { ...history, status: 'awaiting_input' as const, pendingQuestion: question }]) {
      const result = applyAgentEvent(pending, event('error', { streamOnly: true, code: 'THREAD_STREAM_LIMIT', error: 'Live updates paused.' }));
      expect(result).toBe(pending);
      expect(result?.error).toBeUndefined();
    }
  });

  it('merges live delegated task state by agent ID and rejects another family', () => {
    const agent = { id: 'child-1', parentThreadId: 'thread-1', rootThreadId: 'thread-1', workspaceId: 'workspace-1', taskName: 'verify', path: '/root/verify', role: 'worker' as const, depth: 1, status: 'running' as const, model: 'test-model', reasoningEffort: 'high' as const, mode: 'agent' as const, autoApprove: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
    const running = applyAgentEvent(conversation(), event('agent_change', { agent }))!;
    const finished = applyAgentEvent(running, event('agent_change', { agent: { ...agent, status: 'completed', finalMessage: 'Checks passed.' } }))!;
    expect(finished.agents).toHaveLength(1);
    expect(finished.agents?.[0].finalMessage).toBe('Checks passed.');
    expect(applyAgentEvent(finished, event('agent_change', { agent: { ...agent, rootThreadId: 'someone-else' } }))).toBe(finished);
  });

  it('does not replace interrupted or failed status with success on a done envelope', () => {
    const interrupted = applyAgentEvent(conversation(), event('status', { status: 'interrupted' }))!;
    expect(applyAgentEvent(interrupted, event('done', { runId: 'run-1' }))?.status).toBe('interrupted');
    const failed = applyAgentEvent(conversation(), event('error', { error: 'Provider rate limit reached' }))!;
    const finished = applyAgentEvent(failed, event('done', { runId: 'run-1' }))!;
    expect(finished.status).toBe('error');
    expect(finished.error).toBe('Provider rate limit reached');
  });

  it('ignores events from a previously selected thread and malformed payloads', () => {
    const current = conversation();
    expect(applyAgentEvent(current, { ...event('delta', { messageId: 'a', text: 'Wrong conversation' }), threadId: 'thread-2' })).toBe(current);
    expect(applyAgentEvent(current, event('snapshot', { thread: { ...current, id: 'thread-2' } }))).toBe(current);
    expect(applyAgentEvent(current, event('delta', { text: 123 }))).toBe(current);
    expect(applyAgentEvent(current, event('status', { status: 'made-up-status' }))).toBe(current);
  });

  it('keeps equal successive delta text because token content is not an event identifier', () => {
    const one = applyAgentEvent(conversation(), event('delta', { messageId: 'message-1', text: 'ha' }))!;
    expect(applyAgentEvent(one, event('delta', { messageId: 'message-1', text: 'ha' }))?.messages[0].content).toBe('haha');
  });

  it('clears the old error when a new run starts', () => {
    const failed = applyAgentEvent(conversation(), event('error', { error: 'Connection lost' }))!;
    expect(applyAgentEvent(failed, event('status', { status: 'running' }))?.error).toBeUndefined();
  });
});

describe('change and history reconciliation', () => {
  it('merges an individual resolution without removing unrelated pending file edits', () => {
    const change: ChangeRecord = { id: 'c1', workspaceId: 'workspace-1', threadId: 'thread-1', path: 'a.ts', original: 'old', modified: 'new', status: 'pending', createdAt: '2026-01-01T00:00:00Z' };
    const other = { ...change, id: 'c2', path: 'b.ts' };
    expect(mergeChanges([change, other], [{ ...change, status: 'kept' }])).toEqual([{ ...change, status: 'kept' }, other]);
    expect(mergeChanges([change], [change, change])).toHaveLength(1);
  });

  it('places the updated thread once in chronological history', () => {
    const first = threadSummary(conversation());
    const updated = { ...first, title: 'Renamed', updatedAt: '2026-02-01T00:00:00Z' };
    const second = { ...first, id: 'thread-2', updatedAt: '2026-01-02T00:00:00Z' };
    expect(mergeThreadSummary([second, first], updated)).toEqual([updated, second]);
  });

  it('shows terminal output without ANSI color or hyperlink escape sequences', () => {
    expect(stripAnsi('\u001b[32mPassed\u001b[0m\n\u001b]8;;https://example.com\u0007source\u001b]8;;\u0007')).toBe('Passed\nsource');
  });
});

// Native catalog records and literal choices replace the retired site profile
// registry/group contract. The reducer and reconciliation assertions above are
// intentionally retained unchanged.
const nativeModel = (model: string, displayName: string, efforts = ['low']): CodexModel => ({
  id: `catalog:${model}`, model, displayName, description: `${displayName} description`, hidden: false,
  supportedReasoningEfforts: efforts.map(reasoningEffort => ({ reasoningEffort, description: `${reasoningEffort} effort` })),
  defaultReasoningEffort: efforts[0] ?? '', inputModalities: ['text'], isDefault: false,
});
const catalogResponse = (catalog: CodexModel[], connected = true): CodexModelCatalog => ({
  backend: 'codex-cli', connected, models: catalog.map(model => model.model), catalog,
});

describe('native model catalog and explicit literal choices', () => {
  it('does not restore absent or retired preset capabilities', () => {
    expect(reasoningOptions([], 'gpt-5.5')).toEqual([]);
    const options = modelOptions(catalogResponse([nativeModel('owner/model-v2', 'Custom model', ['low', 'research-v2'])]), 'owner/model-v2');
    expect(reasoningOptions(options, 'owner/model-v2')).toEqual(['low', 'research-v2']);
  });

  it('uses only the advertised native efforts for the exact literal wire model', () => {
    expect(reasoningOptions([], 'gpt-6-astra')).toEqual([]);
    expect(reasoningOptions([], 'gpt-5.5-pro')).toEqual([]);
    const model = nativeModel('gpt-6-astra', 'Astra', ['high', 'max']);
    expect(reasoningOptions(modelOptions(catalogResponse([model]), model.model), model.model)).toEqual(['high', 'max']);
    expect(reasoningOptions(modelOptions(catalogResponse([model]), model.model), model.id)).toEqual([]);
    expect(reasoningOptions(modelOptions(catalogResponse([model], false), model.model), model.model)).toEqual([]);
  });

  it('preserves native labels, order, catalog identity and wire IDs without duplicated options', () => {
    const catalog = [nativeModel('coding-model', 'Coding model'), nativeModel('team-model', 'Team model'), nativeModel('other-coding-model', 'Other coding model')];
    const options = modelOptions(catalogResponse([...catalog, { ...catalog[0], id: 'another-catalog-id', displayName: 'Duplicate wire choice' }]), 'team-model');
    expect(options.filter(option => option.kind === 'native')).toEqual(catalog.map(option => ({ ...option, kind: 'native', available: true })));
    expect(options.filter(option => option.model === 'coding-model')).toHaveLength(1);
    expect(options.find(option => option.model === 'team-model')).toMatchObject({ id: 'catalog:team-model', model: 'team-model', displayName: 'Team model' });
  });

  it('retains an omitted current selection as an honest literal without fabricated native metadata', () => {
    const response = catalogResponse([nativeModel('available-model', 'Available model')]);
    const options = modelOptions(response, 'selected-model'), selected = options.find(option => option.model === 'selected-model');
    expect(selected).toMatchObject({ kind: 'literal', model: 'selected-model', displayName: 'selected-model', available: true });
    expect(selected).not.toHaveProperty('id'); expect(selected).not.toHaveProperty('supportedReasoningEfforts');
    expect(reasoningOptions(options, 'selected-model')).toEqual([]);
    expect(modelOptions({ ...response, connected: false }, 'selected-model').find(option => option.model === 'selected-model')?.available).toBe(false);
    const declared = nativeModel('selected-model', 'Selected model');
    expect(modelOptions(catalogResponse([declared, declared]), 'selected-model').filter(option => option.model === 'selected-model')).toHaveLength(1);
  });
});
