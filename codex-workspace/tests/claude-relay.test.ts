import { describe, expect, it } from 'vitest';
import { normalizeMessages } from '../server/claude-relay';

describe('Claude relay message normalization', () => {
  it('keeps a tool result in the final message when Claude Code appends system reminders', () => {
    const messages = normalizeMessages([
      { role: 'user', content: 'Create notes.txt' },
      { role: 'system', content: [{ type: 'text', text: 'Environment details' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Write', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Created' }] },
      { role: 'system', content: [{ type: 'text', text: '<total_tokens>1000 tokens left</total_tokens>' }] },
    ]) as { role: string; content: { type: string; text?: string }[] }[];
    expect(messages.map(message => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[2].content[0].type).toBe('tool_result');
    expect(messages[2].content[1].text).toContain('<system-reminder>');
    expect(messages[0].content.map(block => block.type)).toEqual(['text', 'text']);
  });

  it('moves tool results ahead of text and passes images and documents through', () => {
    const messages = normalizeMessages([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_2', name: 'Read', input: {} }] },
      { role: 'user', content: [{ type: 'text', text: 'note' }, { type: 'tool_result', tool_use_id: 'toolu_2', content: 'ok' }, { type: 'image', source: {} }] },
      { role: 'user', content: [{ type: 'document', title: 'a.txt', source: { type: 'text', data: 'hello' } }] },
    ]) as { role: string; content: { type: string; text?: string }[] }[];
    expect(messages).toHaveLength(2);
    expect(messages[1].content.map(block => block.type)).toEqual(['tool_result', 'text', 'image', 'document']);
  });

  it('leaves non-array payloads untouched', () => {
    expect(normalizeMessages(undefined)).toBeUndefined();
  });
});
