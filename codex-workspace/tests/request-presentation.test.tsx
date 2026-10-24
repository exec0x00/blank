import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CodexApproval, CodexQuestionRequest } from '../shared/codex-cli';
import { ApprovalCard, approvalAnswerBody, approvalDecisionDescription, approvalDecisionOptions } from '../client/components/chat/ApprovalCard';
import { QuestionCard } from '../client/components/chat/QuestionCard';
import { emptyQuestionDraft, questionIsAnswered, questionRequestKey, questionTextAnswer } from '../client/components/chat/request-presentation';
import { planProgress } from '../client/components/chat/plan-presentation';
import { formatToolActivity } from '../client/components/chat/tool-presentation';
import { hasNativeItemIdentity } from '../client/components/chat/history-detail-presentation';
import { ActivityCard } from '../client/components/chat/ActivityCard';
import { ToolDetailScope } from '../client/components/chat/ToolDetailScope';
import type { ChatMessage, Thread, ToolActivity } from '../shared/types';

const question: CodexQuestionRequest = { id: 'request', threadId: 'thread', turnId: 'turn', itemId: 'item', isBlocking: true,
  questions: [{ id: 'choice', header: 'Scope', question: 'Choose the next change.', isSecret: false, isOther: true,
    options: [{ label: 'Small change (Recommended)', description: 'Keep the existing structure.' }, { label: 'Larger change', description: 'Review the whole feature.' }] }] };
const approval: CodexApproval = { id: 'approval', threadId: 'thread', turnId: 'turn', itemId: 'item', kind: 'command',
  title: 'Review command', description: 'Read the project files.', command: 'pwd', decisions: ['acceptForSession', 'decline'], createdAt: '2026-09-30T12:00:00Z' };

describe('native request presentation', () => {
  it('never preselects an option, treats other text explicitly, and rejects stale option indexes', () => {
    const native = question.questions[0], draft = emptyQuestionDraft(questionRequestKey(question));
    expect(questionTextAnswer(native, draft)).toBeUndefined();
    expect(questionIsAnswered(native, draft)).toBe(false);
    draft.text.choice = 'Unselected text';
    expect(questionIsAnswered(native, draft)).toBe(false);
    draft.choices.choice = 0;
    expect(questionTextAnswer(native, draft)).toBe('Small change (Recommended)');
    draft.choices.choice = 5;
    expect(questionIsAnswered(native, draft)).toBe(false);
    draft.choices.choice = 'other'; draft.text.choice = '  My answer\nwith context  ';
    expect(questionTextAnswer(native, draft)).toBe('My answer\nwith context');
    expect(questionTextAnswer({ ...native, isOther: false }, draft)).toBeUndefined();
    draft.text.choice = ' \n ';
    expect(questionIsAnswered(native, draft)).toBe(false);
  });

  it('keeps secrets outside drafts and changes identity for native scope or choice revisions', () => {
    const secret = { ...question.questions[0], isSecret: true }, draft = emptyQuestionDraft(questionRequestKey(question));
    draft.text.choice = 'Must never become a secret answer'; draft.choices.choice = 0;
    expect(questionIsAnswered(secret, draft)).toBe(false);
    draft.secretPresent.choice = true;
    expect(questionIsAnswered(secret, draft)).toBe(true);
    expect(questionTextAnswer(secret, draft)).toBeUndefined();
    expect(questionRequestKey(structuredClone(question))).toBe(questionRequestKey(question));
    expect(questionRequestKey({ ...question, turnId: 'replacement' })).not.toBe(questionRequestKey(question));
    expect(questionRequestKey({ ...question, questions: [{ ...question.questions[0], isOther: false }] })).not.toBe(questionRequestKey(question));
    expect(questionRequestKey({ ...question, questions: [{ ...question.questions[0], options: [...question.questions[0].options!].reverse() }] })).not.toBe(questionRequestKey(question));
  });

  it('only constructs responses for explicitly offered decisions and describes permission scope honestly', () => {
    expect(approvalAnswerBody(approval, 'accept')).toBeNull();
    expect(approvalAnswerBody(approval, 'acceptForSession')).toEqual({ approvalId: approval.id, decision: 'acceptForSession' });
    expect(approvalAnswerBody({ ...approval, decisions: [] }, 'decline')).toBeNull();
    expect(approvalDecisionDescription({ ...approval, kind: 'permissions' }, 'accept')).toContain('for this turn');
    expect(approvalDecisionDescription({ ...approval, kind: 'permissions' }, 'cancel')).not.toContain('Stop');
  });

  it('keeps unanswered prompts accessible without opening a dialog or exposing secret fields', () => {
    const html = renderToStaticMarkup(<><QuestionCard request={question} busy={false} onAnswer={async () => undefined} />
      <ApprovalCard approval={approval} busy={false} onAnswer={() => undefined} /></>);
    expect(html).toContain('Codex is waiting for your answer');
    expect(html).toContain('Approval needed');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('type="password"');
    expect(renderToStaticMarkup(<QuestionCard request={question} busy={false} locked onAnswer={async () => undefined} />)).toBe('');
  });

  it('binds opaque decisions to their current offered identifier and complete display description', () => {
    const id = 'native-decision-11111111-1111-4111-8111-111111111111' as const;
    const option = { id, label: 'Allow this command pattern', description: 'Allow future commands with the offered npm test prefix.' };
    const current: CodexApproval = { ...approval, decisions: [id, 'decline'], decisionOptions: [option] };
    expect(approvalDecisionOptions(current)[0]).toEqual(option);
    expect(approvalAnswerBody(current, id)).toEqual({ approvalId: approval.id, decision: id });
    expect(approvalAnswerBody({ ...current, decisions: ['decline'] }, id)).toBeNull();
    expect(approvalAnswerBody({ ...current, decisionOptions: [] }, id)).toBeNull();
    expect(approvalAnswerBody({ ...current, decisionOptions: [option, option] }, id)).toBeNull();
    expect(approvalAnswerBody({ ...current, decisionOptions: [{ ...option, description: '' }] }, id)).toBeNull();
    expect(approvalDecisionDescription({ ...approval, commandKind: 'writeStdin' }, 'accept')).toBe('Send the requested terminal input once.');
  });
});

describe('native plan progress', () => {
  it('counts only reported valid step statuses and makes incomplete previews explicit', () => {
    const rows = [{ title: 'Read', status: 'completed' as const }, { title: 'Implement', status: 'in_progress' as const },
      { title: 'Verify', status: 'pending' as const }, { title: 'Unknown' }, { title: 'Invalid native state', status: 'error' as const }];
    expect(planProgress(rows)).toMatchObject({ completed: 1, total: 3, label: '1 of 3 steps completed' });
    expect(planProgress(rows, 2)).toMatchObject({ completed: 1, total: 3, omitted: 2, label: '1 of 3 shown steps completed' });
    expect(planProgress([])).toMatchObject({ completed: 0, total: 0 });
  });

  it('accepts native camel-case status, preserves all bounded native steps, and marks clipped text', () => {
    const input = { plan: Array.from({ length: 64 }, (_, index) => ({ step: index === 0 ? 'x'.repeat(1600) : 'Step ' + index, status: index ? 'inProgress' : 'completed' })) };
    const view = formatToolActivity({ id: 'plan', name: 'update_plan', status: 'completed', startedAt: '2026-09-30T12:00:00Z', input: JSON.stringify(input) });
    const section = view.sections.find(part => part.type === 'rows' && part.variant === 'plan');
    expect(section?.type).toBe('rows');
    if (section?.type !== 'rows') throw new Error('Expected native plan steps.');
    expect(section.rows).toHaveLength(64);
    expect(section.omitted).toBeUndefined();
    expect(section.rows[0]).toMatchObject({ status: 'completed', truncated: true });
    expect(section.rows[1].status).toBe('in_progress');
    expect(view.statusLabel).toBe('Updated');
  });
});

describe('native derived event details', () => {
  it('retains public previews without issuing item detail reads for derived event rows', () => {
    const activity: ToolActivity = { id: 'activity', name: 'exec_command', status: 'completed', startedAt: '2026-09-30T12:00:00Z',
      input: '{"cmd":"pwd"}', output: 'Public recorded output.', outputTruncated: true };
    const thread: Thread = { id: 'thread', workspaceId: 'workspace', backend: 'codex-cli', title: 'Native thread', status: 'idle', messages: [], createdAt: activity.startedAt, updatedAt: activity.startedAt };
    const render = (id: string) => {
      const message: ChatMessage = { id, role: 'assistant', content: '', turnId: 'turn', createdAt: activity.startedAt };
      return renderToStaticMarkup(<ToolDetailScope thread={thread} message={message} expanded>
        <ActivityCard activity={activity} onNotify={() => undefined} />
      </ToolDetailScope>);
    };
    for (const id of ['native-notice:turn:1', 'native-hook:turn:hash', 'native-review:turn:hash', 'native-plan:turn']) {
      expect(hasNativeItemIdentity(id)).toBe(false);
      const html = render(id);
      expect(html).toContain('Public recorded output.');
      expect(html).not.toContain('aria-label="Native content sections"');
    }
    for (const id of ['canonical-mcp-item', 'canonical-dynamic-item', 'native-notice-without-derived-prefix']) {
      expect(hasNativeItemIdentity(id)).toBe(true);
      expect(render(id)).toContain('aria-label="Native content sections"');
    }
  });
});
