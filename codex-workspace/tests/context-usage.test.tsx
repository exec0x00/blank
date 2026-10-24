import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Thread } from '../shared/types';
import type { CodexTokenUsage } from '../shared/codex-cli';
import { ContextIndicator, ContextUsageBreakdown } from '../client/components/chat/ContextControls';
import { contextDescription, currentContext } from '../client/components/chat/context-presentation';
import { contextDescendants } from '../client/components/chat/useContextDetails';

const stamp = '2026-09-30T12:00:00.000Z';
const usage = (totalTokens: number, contextTokens: number): CodexTokenUsage => ({ total: {
  totalTokens, inputTokens: totalTokens, outputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, reasoningOutputTokens: 0,
}, contextTokens, modelContextWindow: 1_050_000, reportedAt: stamp });
function thread(id: string, parentThreadId?: string, tokenUsage: CodexTokenUsage | null = null): Thread {
  return { id, parentThreadId, workspaceId: 'workspace-one', backend: 'codex-cli', title: id, status: 'idle', createdAt: stamp, updatedAt: stamp, messages: [],
    native: { loaded: false, model: 'native-model', reasoningEffort: null, activeTurnId: null, approvals: [], questions: [], queue: [], queueCursor: null,
      goal: null, diff: null, tokenUsage, capabilities: { conversations: true, pagination: true, queue: true, goals: false, skills: true, plan: true, review: true, historyRevert: true } } };
}

describe('honest native context presentation', () => {
  it('labels retained measurements as last reported and keeps exact values available beside compact numbers', () => {
    const report = usage(999_999, 8192), html = renderToStaticMarkup(<ContextIndicator tokenUsage={report} onClick={() => {}} />);
    expect(currentContext(report)).toMatchObject({ count: 8192, label: 'Last reported context', compact: '8.19K / 1.05M', reportedAt: stamp });
    expect(html).toContain('8.19K / 1.05M'); expect(html).toContain('Last reported context: 8,192 tokens.');
    expect(html).not.toContain('999,999'); expect(contextDescription(report)).toContain('Later activity may have changed the context.');
    expect(currentContext({ ...report, contextTokens: null }).count).toBeUndefined();
    expect(contextDescription(null)).toContain('Codex has not reported');
  });

  it('limits usage to the selected subtree after switching from a parent to a child', () => {
    const root = thread('root'), child = thread('child', root.id), grandchild = thread('grandchild', child.id), sibling = thread('sibling', root.id);
    const unrelated = thread('unrelated'), foreign = { ...thread('foreign', child.id), workspaceId: 'another-workspace' };
    const cycle = [thread('cycle-a', 'cycle-b'), thread('cycle-b', 'cycle-a')];
    const family = [root, child, grandchild, sibling, unrelated, foreign, ...cycle, grandchild];
    expect(contextDescendants(root, family).map(value => value.id)).toEqual(['child', 'grandchild', 'sibling']);
    expect(contextDescendants(child, family).map(value => value.id)).toEqual(['grandchild']);
  });

  it('keeps own, descendant and combined totals separate from independent context windows', () => {
    const own = thread('root', undefined, usage(100, 80)), child = thread('child', own.id, usage(20, 17));
    const html = renderToStaticMarkup(<ContextUsageBreakdown details={{ thread: own, children: [child] }} />);
    expect(html).toContain('This conversation'); expect(html).toContain('Subagents'); expect(html).toContain('Combined reported');
    expect(html).toContain('<td>100</td><td>20</td><td>120</td>'); expect(html).not.toContain('<td>97</td>');
    expect(html).toContain('These totals are separate from context size');
    const missing = renderToStaticMarkup(<ContextUsageBreakdown details={{ thread: own, children: [thread('child', own.id)] }} />);
    expect(missing).toContain('<td>100</td><td>Not reported</td><td>Not reported</td>');
    expect(missing).toContain('Missing reports are not counted as zero');
  });
});
