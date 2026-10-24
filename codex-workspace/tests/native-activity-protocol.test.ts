import { describe, expect, it, vi } from 'vitest';
import type { Thread } from '../shared/types';
import type { ThreadItem } from '../server/codex-cli/protocol/generated/v2/ThreadItem';
import type { ServerNotification } from '../server/codex-cli/protocol/generated/ServerNotification';
import { applyNativeNotification, projectNativeThread, NATIVE_ACTIVITY_NOTIFICATIONS, NATIVE_PUBLIC_ITEM_POLICY,
  type NativeItemEntry, type NativeThreadMetadata } from '../server/codex-cli/projection';
import { formatToolActivity } from '../client/components/chat/tool-presentation';

const THREAD = '0199ab12-3a12-7123-a456-123456789abc';
const TURN = '0199ab12-3a14-7456-a789-abcdef123456';
const CHILD = '0199ab12-3a18-7678-b234-fedcba654321';
const observedAt = '2026-09-30T12:45:00.000Z';
const metadata: NativeThreadMetadata = { id: THREAD, name: 'Native activity', createdAt: 1_790_100_000, updatedAt: 1_790_100_001,
  status: { type: 'idle' }, model: 'fixed-native-model', turns: [{ id: TURN, status: 'completed', startedAt: 1_790_100_000 }] };
const entry = (type: string, id: string, fields: Record<string, unknown> = {}): NativeItemEntry => ({ turnId: TURN, item: { type, id, ...fields } });
const view = (entries: NativeItemEntry[] = []) => projectNativeThread(metadata, entries, 'workspace');
const event = (current: Thread, method: string, params: Record<string, unknown>) => applyNativeNotification(current, method,
  { threadId: THREAD, turnId: TURN, ...params }, { observedAt });
const activity = (current: Thread, id: string) => current.messages.find(message => message.id === id)!.activities![0];
const forbidden = (object: object, key: string) => {
  const getter = vi.fn(() => { throw new Error('Excluded native field was accessed: ' + key); });
  Object.defineProperty(object, key, { enumerable: true, get: getter });return getter;
};

describe('official native activity coverage', () => {
  it('covers every current item variant with ordered native identities and an explicit hook-context exclusion', () => {
    const examples = {
      userMessage: { content: [{ type: 'text', text: 'Actual request.' }] }, hookPrompt: { fragments: [{ text: 'PRIVATE_HOOK_CONTEXT' }] },
      agentMessage: { text: 'Actual answer.' }, functionCallOutput: { name: 'lookup', output: 'Actual tool reply.' },
      plan: { text: 'Actual plan.' }, reasoning: { summary: ['Public summary.'], content: ['PRIVATE_REASONING'] },
      commandExecution: { command: 'pwd', cwd: '/workspace', status: 'completed', aggregatedOutput: '/workspace', exitCode: 0 },
      fileChange: { status: 'completed', changes: [{ path: 'actual.ts', kind: { type: 'update' }, diff: '+actual source' }] },
      mcpToolCall: { server: 'docs', tool: 'search', status: 'completed', result: { content: [{ type: 'text', text: 'Actual MCP reply.' }] } },
      dynamicToolCall: { tool: 'lookup', namespace: 'site', status: 'completed', success: true, contentItems: [{ type: 'inputText', text: 'Actual dynamic reply.' }] },
      collabAgentToolCall: { tool: 'spawnAgent', status: 'completed', receiverThreadIds: [CHILD], prompt: 'Actual isolated task.', agentsStates: { [CHILD]: { status: 'completed', message: 'Actual child result.' } } },
      subAgentActivity: { kind: 'completed', agentThreadId: CHILD, agentPath: '/root/check' },
      webSearch: { query: 'actual query', action: { type: 'search' } }, imageView: { path: '/workspace/actual.png' },
      sleep: { durationMs: 250 }, imageGeneration: { status: 'completed', savedPath: '/workspace/generated.png', revisedPrompt: 'Actual image prompt.' },
      enteredReviewMode: { review: 'Actual review task.' }, exitedReviewMode: { review: 'Actual review result.' }, contextCompaction: {},
    } satisfies Record<ThreadItem['type'], Record<string, unknown>>;
    const entries = Object.entries(examples).map(([type, fields]) => entry(type, 'item-' + type, fields));
    const result = view(entries);
    const expectedIds = entries.filter(row => row.item.type !== 'hookPrompt').map(row => row.item.id);
    expect(result.messages.map(message => message.id)).toEqual(expectedIds);
    expect(result.timeline!.entries.map(row => row.messageId)).toEqual(expectedIds);
    expect(result.messages.every(message => message.turnId === TURN)).toBe(true);
    expect(NATIVE_PUBLIC_ITEM_POLICY.hookPrompt).toBe('excluded');
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|hookPrompt|encrypted_content/);
    expect(JSON.stringify(result.messages.flatMap(message => message.activities ?? []).map(formatToolActivity))).toContain('Actual MCP reply.');
    const methods: readonly ServerNotification['method'][] = NATIVE_ACTIVITY_NOTIFICATIONS;
    expect(methods).toContain('item/mcpToolCall/progress');
  });

  it('reads only text results and tool identities for MCP, dynamic and function-output items', () => {
    const content = { type: 'image' }, result = { content: [{ type: 'text', text: '{"message":"Public MCP result.","credential":"PRIVATE"}' }, content] };
    const mcp = entry('mcpToolCall', 'mcp', { server: 'docs', tool: 'search', status: 'completed', result });
    const dynamic = entry('dynamicToolCall', 'dynamic', { namespace: 'site', tool: 'lookup', status: 'completed', success: false,
      contentItems: [{ type: 'inputText', text: 'First public result.' }, { type: 'inputText', text: '{"message":"Second public result.","raw":"PRIVATE"}' }] });
    const reads = [forbidden(mcp.item, 'arguments'), forbidden(mcp.item, 'appContext'), forbidden(result, '_meta'),
      forbidden(result, 'structuredContent'), forbidden(content, 'data'), forbidden(dynamic.item, 'arguments')];
    const projected = view([mcp, dynamic]);
    expect(activity(projected, 'mcp')).toMatchObject({ id: 'mcp', name: 'mcp_tool', status: 'completed', output: 'Public MCP result.' });
    expect(activity(projected, 'dynamic')).toMatchObject({ status: 'error', output: 'First public result.\nSecond public result.' });
    expect(JSON.parse(activity(projected, 'dynamic').input).description).toBe('site · lookup');
    expect(JSON.stringify(projected)).not.toMatch(/PRIVATE|credential|structuredContent/);
    for (const read of reads) expect(read).not.toHaveBeenCalled();
  });

  it.each([
    ['openPage', 'Opened web page', { url: 'https://example.com/page' }, 'example.com'],
    ['findInPage', 'Searched web page', { url: 'https://example.com/page', pattern: 'needle' }, 'needle'],
    ['other', 'Web search', {}, ''],
  ])('maps the native %s web action into its supported presentation', (type, label, fields, expected) => {
    const projected = view([entry('webSearch', 'web', { query: '', action: { type, ...fields } })]);
    const rendered = formatToolActivity(activity(projected, 'web'));
    expect(rendered.label).toBe(label);expect(JSON.stringify(rendered)).toContain(expected);
  });

  it('retains child failure, image failure, and full-detail truncation information', () => {
    const projected = view([entry('collabAgentToolCall', 'child', { tool: 'wait', status: 'completed', receiverThreadIds: [CHILD],
      prompt: 'task '.repeat(1000), agentsStates: { [CHILD]: { status: 'errored', message: 'Failure '.repeat(500) } } }),
    entry('imageGeneration', 'image', { status: 'failed', revisedPrompt: 'Actual image prompt.', failure: null })]);
    expect(activity(projected, 'child')).toMatchObject({ inputTruncated: true, outputTruncated: true });
    expect(formatToolActivity(activity(projected, 'child'))).toMatchObject({ status: 'error', statusLabel: 'Agent failed' });
    expect(activity(projected, 'image')).toMatchObject({ status: 'error' });
    expect(JSON.parse(activity(projected, 'image').output!)).toMatchObject({ status: 'failed', notice: 'Image generation did not complete.' });
  });

  it('ignores unknown items and hook context before reading any payload', () => {
    const unknown = entry('futureNativeItem', 'unknown'), hook = entry('hookPrompt', 'hook');
    const reads = [forbidden(unknown.item, 'arguments'), forbidden(unknown.item, 'result'), forbidden(hook.item, 'fragments')];
    expect(view([unknown, hook]).messages).toEqual([]);
    for (const read of reads) expect(read).not.toHaveBeenCalled();
  });
});

describe('public native activity notifications', () => {
  it('keeps MCP progress and final results in chronological position with the real item identity', () => {
    let current = view([entry('agentMessage', 'before', { text: 'Before.' })]);
    current = event(current, 'item/started', { item: { type: 'mcpToolCall', id: 'mcp', server: 'docs', tool: 'search', status: 'inProgress' } });
    current = event(current, 'item/mcpToolCall/progress', { itemId: 'mcp', message: 'Searching documentation.' });
    expect(activity(current, 'mcp')).toMatchObject({ status: 'running', output: 'Searching documentation.' });
    current = event(current, 'item/completed', { item: { type: 'agentMessage', id: 'after', text: 'After.' } });
    current = event(current, 'item/completed', { item: { type: 'mcpToolCall', id: 'mcp', server: 'docs', tool: 'search', status: 'completed',
      result: { content: [{ type: 'text', text: 'Found the real documentation.' }] } } });
    expect(current.timeline!.entries.map(row => row.messageId)).toEqual(['before', 'mcp', 'after']);
    expect(activity(current, 'mcp').output).toBe('Found the real documentation.');
    expect(event(current, 'item/mcpToolCall/progress', { itemId: 'mcp', message: 'Late' })).toBe(current);
    expect(event(current, 'item/mcpToolCall/progress', { itemId: 'missing', message: 'Missing' })).toBe(current);
    const failure = event(view(), 'item/completed', { item: { type: 'mcpToolCall', id: 'failed', status: 'failed', server: 'docs', tool: 'search', error: { message: 'Native MCP failure.' } } });
    expect(activity(failure, 'failed')).toMatchObject({ status: 'error', output: 'Native MCP failure.' });
  });

  it('shows thread-scoped warnings and actual model reroutes without altering fixed settings', () => {
    let current = event(view(), 'warning', { message: 'Native warning.', turnId: undefined });
    expect(current.messages[0].turnId).toBeUndefined();
    expect(formatToolActivity(current.messages[0].activities![0]).notices).toContainEqual({ kind: 'warning', text: 'Native warning.' });
    current = event(current, 'guardianWarning', { message: 'Native approval warning.', turnId: undefined });
    current = event(current, 'model/rerouted', { fromModel: 'fixed-native-model', toModel: 'native-routed-model', reason: 'highRiskCyberActivity' });
    expect(current.native!.model).toBe('fixed-native-model');expect(current.status).toBe('idle');
    expect(JSON.stringify(current)).toContain('native-routed-model');
    expect(current.messages.every(message => message.id.startsWith('native-notice:'))).toBe(true);
    expect(event(current, 'warning', { threadId: null, message: 'Global warning.' })).toBe(current);
    expect(event(current, 'warning', { threadId: CHILD, message: 'Other thread warning.' })).toBe(current);
  });

  it('updates native authentication recovery in place without changing approval or provider state', () => {
    let current = event(view(), 'modelProvider/authRecoveryStarted', { provider: 'native', message: 'Retrying the native connection.' });
    expect(current.messages[0].activities![0].status).toBe('running');
    current = event(current, 'modelProvider/authRecoveryCompleted', { provider: 'native', message: 'Native recovery completed.' });
    expect(current.messages).toHaveLength(1);expect(current.messages[0].activities![0]).toMatchObject({ status: 'completed', output: 'Native recovery completed.' });
    expect(current.native!.model).toBe('fixed-native-model');expect(current.native!.approvals).toEqual([]);
  });

  it('shows public hook feedback while refusing hook-injected context and preserving real lifecycle identity', () => {
    const context = { kind: 'context' }, read = forbidden(context, 'text');
    const run = { id: 'native-hook-run', eventName: 'preToolUse', status: 'running', startedAt: Date.parse(observedAt), sourcePath: '/workspace/hooks.toml', entries: [] };
    let current = event(view(), 'hook/started', { turnId: null, run });
    current = event(current, 'hook/completed', { turnId: null, run: { ...run, status: 'blocked', completedAt: Date.parse(observedAt) + 50,
      durationMs: 50, statusMessage: 'Hook blocked the action.', entries: [context, { kind: 'feedback', text: 'Actual hook feedback.' }, { kind: 'warning', text: 'Actual hook warning.' }] } });
    expect(current.messages).toHaveLength(1);expect(current.messages[0].id).toMatch(/^native-hook:/);expect(current.messages[0].turnId).toBeUndefined();
    const rendered = formatToolActivity(current.messages[0].activities![0]);
    expect(rendered).toMatchObject({ kind: 'hook', status: 'error' });expect(JSON.stringify(rendered)).toContain('Actual hook feedback.');
    expect(rendered.notices).toContainEqual({ text: 'Actual hook warning.', kind: 'warning' });expect(read).not.toHaveBeenCalled();
  });

  it('presents auto-review decisions and public rationale without making an approval decision itself', () => {
    const action = { type: 'mcpToolCall' }, read = forbidden(action, 'arguments');
    const initial = { reviewId: 'actual-review', targetItemId: null, startedAtMs: Date.parse(observedAt), action,
      review: { status: 'inProgress', rationale: null } };
    let current = event(view(), 'item/autoApprovalReview/started', initial);
    current = event(current, 'item/autoApprovalReview/completed', { ...initial, completedAtMs: Date.parse(observedAt) + 1,
      review: { status: 'denied', rationale: 'The native reviewer rejected this action.' } });
    expect(current.messages).toHaveLength(1);expect(current.messages[0].id).toMatch(/^native-review:/);
    expect(current.messages[0].activities![0].status).toBe('error');
    expect(JSON.stringify(formatToolActivity(current.messages[0].activities![0]))).toContain('The native reviewer rejected this action.');
    expect(current.native!.approvals).toEqual([]);expect(current.status).toBe('idle');expect(read).not.toHaveBeenCalled();
    current = event(current, 'autoApprovalReview/strictReviewRequired', { startedAtMs: Date.parse(observedAt) });
    expect(JSON.stringify(current)).toContain('stricter approval review');
  });

  it('records actual terminal interaction separately while retaining the parent command output and native identity', () => {
    let current = view([entry('commandExecution', 'command', { status: 'inProgress', command: 'interactive-program', aggregatedOutput: 'Waiting for input.' })]);
    current = event(current, 'item/commandExecution/terminalInteraction', { itemId: 'command', processId: 'native-process', stdin: 'yes\n' });
    expect(current.messages).toHaveLength(2);expect(current.messages[1].id).toMatch(/^native-notice:/);
    const input = current.messages[1].activities![0];
    expect(input).toMatchObject({ name: 'write_stdin', status: 'completed' });
    expect(JSON.parse(input.input)).toMatchObject({ chars: 'yes\n', item_id: 'command', process_id: 'native-process' });
    expect(formatToolActivity(input).label).toBe('Sent command input');
    expect(activity(current, 'command').status).toBe('running');expect(activity(current, 'command').output).toContain('Waiting for input.');
    expect(event(current, 'item/commandExecution/terminalInteraction', { itemId: 'missing', processId: 'native-process', stdin: 'wrong' })).toBe(current);
  });
});
