import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ChatMessage, ReasoningSummarySegment, ThreadTurn, ToolActivity } from '../shared/types';
import { TurnActivity, type TurnActivityProps } from '../client/components/chat/TurnActivity';
import { ActivityCard } from '../client/components/chat/ActivityCard';

// Explicit transport fixtures, never example activity supplied by the product.
const start = '2026-09-19T12:00:00.000Z';
const summary: ReasoningSummarySegment = { id: 'provider-item', summaryIndex: 0, text: 'The recorded **public summary**.', status: 'complete' };
const activity: ToolActivity = { id: 'tool-1', name: 'exec_command', input: JSON.stringify({ cmd: 'node --version', cwd: '/workspace/project' }), output: 'v22.23.2', status: 'completed', startedAt: '2026-09-19T12:00:02.000Z', completedAt: '2026-09-19T12:00:05.000Z' };
const message: ChatMessage = { id: 'assistant-1', role: 'assistant', content: 'The final answer remains separate.', createdAt: start, activities: [activity], reasoningSummary: [summary] };
const turn: ThreadTurn = { id: 'turn-1', userMessageId: 'user-1', startedAt: start, completedAt: '2026-09-19T12:00:13.800Z', status: 'completed', messageIds: [message.id] };

function render(props: Partial<TurnActivityProps> = {}) {
  return renderToStaticMarkup(<TurnActivity messages={[message]} turn={turn} onNotify={() => undefined} {...props} />);
}

describe('turn activity presentation', () => {
  it('keeps routine lifecycle events out of step counts without concealing failures', () => {
    const notices: ToolActivity[] = [
      { ...activity, id: 'start', name: 'turn_started', status: 'running' },
      { ...activity, id: 'end', name: 'turn_over' },
    ];
    expect(render({ messages: [{ ...message, activities: notices, reasoningSummary: [] }] })).toBe('');
    expect(renderToStaticMarkup(<ActivityCard activity={notices[0]} onNotify={() => undefined} />)).toBe('');
    const html = render({ messages: [{ ...message, activities: [...notices, activity], reasoningSummary: [] }] });
    expect(html).toContain('1 step, Completed');
    expect(html).not.toContain('Turn started');
    const failed = render({ messages: [{ ...message, activities: [{ ...notices[1], status: 'error', output: 'Native completion failed.' }], reasoningSummary: [] }] });
    expect(failed).toContain('1 step failed'); expect(failed).toContain('Native completion failed.');
  });

  it('does not invent activity, a thought, or a duration when the provider sent none', () => {
    expect(render({ messages: [{ ...message, activities: undefined, reasoningSummary: undefined }], live: true })).toBe('');
    expect(render({ messages: [{ ...message, activities: [], reasoningSummary: [{ ...summary, text: ' \n ' }] }] })).toBe('');
    expect(render({ messages: [{ ...message, role: 'user' }] })).toBe('');
  });

  it('collapses completed activity without mounting command logs and uses the recorded turn duration', () => {
    const html = render();
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('1 step, Completed, 13s elapsed');
    expect(html).toContain('Turn elapsed time from recorded timestamps');
    expect(html).not.toContain('v22.23.2');
    expect(html).not.toContain('node --version');
    expect(html).not.toContain('<ol');
    expect(html).not.toContain('Thinking');
    expect(html).not.toContain('Worked for');
  });

  it('shows only public summaries and real tool metadata while working, with heavy tool output closed', () => {
    const html = render({ turn: { ...turn, status: 'running', completedAt: undefined }, messages: [{ ...message, reasoningSummary: [{ ...summary, status: 'streaming' }] }], live: true });
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('Reasoning summary');
    expect(html).toContain('<strong>public summary</strong>');
    expect(html).toContain('Updating');
    expect(html).toContain('node --version');
    expect(html).not.toContain('v22.23.2');
    expect(html).not.toContain('The final answer remains separate.');
    expect(html).toContain('aria-controls=');
    expect(html).toContain('role="status"');
  });

  it('replaces repeated provider segments and tool IDs without duplicating rows or hiding a failure', () => {
    const html = render({ messages: [
      { ...message, activities: [{ ...activity, status: 'running', output: 'Old output.' }], reasoningSummary: [{ ...summary, text: 'Outdated summary.' }] },
      { ...message, activities: [{ ...activity, status: 'error', output: 'The actual command failed.' }], reasoningSummary: [{ ...summary, text: 'Current public summary.' }] },
    ] });
    expect(html).toContain('1 step, Finished with errors, 1 step failed, 13s elapsed');
    expect(html).toContain('aria-expanded="true"');
    expect(html.match(/class="chat-turn-reasoning"/g)).toHaveLength(1);
    expect(html.match(/class="chat-activity is-error/g)).toHaveLength(1);
    expect(html).toContain('Current public summary.');
    expect(html).toContain('The actual command failed.');
    expect(html).not.toContain('Old output.');
    expect(html).not.toContain('Outdated summary.');
  });

  it('honors authoritative empty summary replacements and retains saved tool array order', () => {
    const html = render({ turn: { ...turn, status: 'error' }, messages: [
      { ...message, reasoningSummary: [{ ...summary, text: 'Removed summary.' }] },
      { ...message, reasoningSummary: [{ ...summary, text: '' }, { ...summary, id: 'next-item', summaryIndex: 1, text: 'Second summary part.' }, { ...summary, id: 'next-item', text: 'First summary part.' }], activities: [
        { ...activity, id: 'tool-later', input: JSON.stringify({ path: 'later.txt' }), name: 'read_file', startedAt: '2026-09-19T12:00:10.000Z', completedAt: '2026-09-19T12:00:11.000Z' },
        { ...activity, id: 'tool-earlier', input: JSON.stringify({ path: 'earlier.txt' }), name: 'read_file' },
      ] },
    ] });
    expect(html).not.toContain('Removed summary.');
    expect(html.indexOf('First summary part.')).toBeLessThan(html.indexOf('Second summary part.'));
    expect(html.indexOf('later.txt')).toBeLessThan(html.indexOf('earlier.txt'));
    expect(html).toContain('3 steps');
  });

  it('keeps separate responses when a provider reuses its reasoning item IDs', () => {
    const html = render({ turn: { ...turn, status: 'error' }, messages: [
      { ...message, reasoningSummary: [{ ...summary, text: 'First response summary.' }] },
      { ...message, id: 'assistant-2', activities: undefined, reasoningSummary: [{ ...summary, text: 'Second response summary.' }] },
    ] });
    expect(html.match(/class="chat-turn-reasoning"/g)).toHaveLength(2);
    expect(html).toContain('First response summary.');
    expect(html).toContain('Second response summary.');
  });

  it('never constructs an elapsed duration from absent, invalid, or reversed timestamps', () => {
    for (const timing of [
      { startedAt: 'not-a-date', completedAt: turn.completedAt },
      { startedAt: turn.startedAt, completedAt: 'not-a-date' },
      { startedAt: turn.startedAt, completedAt: undefined },
      { startedAt: turn.completedAt!, completedAt: turn.startedAt },
    ]) {
      expect(render({ turn: { ...turn, ...timing } })).not.toContain('chat-turn-activity-duration');
    }
    expect(render({ turn: undefined, messages: [{ ...message, activities: [{ ...activity, completedAt: undefined }] }] })).not.toContain('chat-turn-activity-duration');
    expect(render({ turn: undefined, messages: [{ ...message, activities: [{ ...activity, startedAt: 'invalid' }] }] })).not.toContain('chat-turn-activity-duration');
    expect(render({ turn: undefined })).toContain('Tool activity elapsed time from recorded timestamps');
    expect(render({ turn: undefined })).toContain('3s elapsed');
  });

  it('keeps interrupted turns and pending tools visible and marks genuinely truncated summaries', () => {
    const interrupted = render({ turn: { ...turn, status: 'interrupted' }, messages: [{ ...message, reasoningSummary: [{ ...summary, truncated: true }] }] });
    expect(interrupted).toContain('Interrupted');
    expect(interrupted).toContain('aria-expanded="true"');
    expect(interrupted).toContain('Summary truncated.');
    for (const [status, label] of [['awaiting_approval', 'Awaiting approval'], ['awaiting_input', 'Awaiting your answer']] as const) {
      const pending = render({ turn: { ...turn, status: 'running', completedAt: undefined }, messages: [{ ...message, activities: [{ ...activity, status }] }] });
      expect(pending).toContain(label);
      expect(pending).toContain('aria-expanded="true"');
    }
  });

  it('does not interpret private reasoning fields, inject HTML, or request external summary images', () => {
    const untrusted = {
      ...message,
      reasoning: 'PRIVATE_REASONING_NOT_FOR_DISPLAY',
      encrypted_content: 'OPAQUE_ENCRYPTED_CONTENT',
      reasoningSummary: [{ ...summary, text: '<script>alert(1)</script>\n\n![Attached reference](https://example.test/summary.png)\n\n[Unsafe](javascript:alert(1))\n\n[Source](src/index.ts)' }],
    };
    const html = render({ turn: { ...turn, status: 'error' }, messages: [untrusted], workspacePath: '/workspace/project', onOpenFile: () => undefined });
    expect(html).not.toContain('PRIVATE_REASONING_NOT_FOR_DISPLAY');
    expect(html).not.toContain('OPAQUE_ENCRYPTED_CONTENT');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('href="https://example.test/summary.png"');
    expect(html).toContain('title="Open src/index.ts"');
  });
});
