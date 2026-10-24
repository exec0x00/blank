import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Thread, Workspace } from '../shared/types';
import type { CodexApproval } from '../shared/codex-cli';
import { InlineAgentRequests } from '../client/components/chat/InlineAgents';

const rootId = '0199a111-1111-7111-8111-111111111111';
const childId = '0199a222-2222-7222-8222-222222222222';
const stamp = '2026-09-30T12:00:00.000Z';
const workspace: Workspace = { id: 'workspace-summary', name: 'Summary test', path: '/workspace', createdAt: stamp, updatedAt: stamp };
const child: Thread = {
  id: childId, workspaceId: workspace.id, title: 'Review keyboard navigation', parentThreadId: rootId,
  backend: 'codex-cli', status: 'running', createdAt: stamp, updatedAt: stamp,
  messages: [{ id: 'child-message', role: 'assistant', content: 'Repeated child transcript must stay in the child conversation.', createdAt: stamp }],
  native: { model: 'fixture-model', reasoningEffort: 'high', activeTurnId: '0199a333-3333-7333-8333-333333333333',
    approvals: [], questions: [], queue: [], queueCursor: null, goal: null, tokenUsage: null, diff: null,
    capabilities: { conversations: true, pagination: true, queue: true, goals: true, skills: true, plan: true, review: true, historyRevert: true } },
};
function render(thread = child, locked = false) {
  return renderToStaticMarkup(<InlineAgentRequests rootThreadId={rootId} nativeThreads={[thread]} workspace={workspace}
    locked={locked} onNotify={() => {}} onRefreshAgents={async () => {}} onSelectAgent={() => {}} />);
}

describe('compact native agent summaries', () => {
  it('keeps identity, honest status and navigation without duplicating the child transcript', () => {
    const html = render();
    expect(html).toContain('Review keyboard navigation');
    expect(html).toContain('Working');
    expect(html).toContain('Switch to agent Review keyboard navigation');
    expect(html).toContain('/work?workspace=workspace-summary');
    expect(html).not.toContain('Repeated child transcript');
    expect(html).not.toContain('Recent activity');
  });

  it('keeps required child approval controls visible even without transcript previews', () => {
    const approval: CodexApproval = { id: 'approval-1', threadId: childId, turnId: child.native!.activeTurnId!, itemId: 'command-1',
      kind: 'command', title: 'Run the navigation check', description: 'Verify keyboard behavior',
      command: 'npm test', cwd: workspace.path, decisions: ['accept', 'decline'], createdAt: stamp };
    const html = render({ ...child, status: 'awaiting_approval', native: { ...child.native!, approvals: [approval] } });
    expect(html).toContain('Needs approval');
    expect(html).toContain('Run the navigation check');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('Review');
    expect(html).not.toContain('Repeated child transcript');
  });

  it('keeps failures visible and hides locked or unrelated workspace content', () => {
    expect(render({ ...child, status: 'error', error: 'Command connection closed.' })).toContain('Command connection closed.');
    expect(render(child, true)).toBe('');
    expect(render({ ...child, workspaceId: 'another-workspace' })).toBe('');
  });
});
