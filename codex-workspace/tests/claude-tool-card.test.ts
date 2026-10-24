import { describe, expect, it } from 'vitest';
import { parseSearch } from '../client/components/claude/ToolCard';

describe('Claude WebSearch results', () => {
  it('splits the source links from Claude Code’s notes', () => {
    const result = 'Web search results for query: "hf ceo"\n\nLinks: [{"title":"Hugging Face","url":"https://huggingface.co/about"},{"title":"","url":"https://en.wikipedia.org/wiki/HF"},{"title":"bad","url":"javascript:alert(1)"}]\n\nClément Delangue is the CEO.\n\nREMINDER: You MUST include the sources above.';
    const { links, notes } = parseSearch(result);
    expect(links).toEqual([{ title: 'Hugging Face', url: 'https://huggingface.co/about' }, { title: 'https://en.wikipedia.org/wiki/HF', url: 'https://en.wikipedia.org/wiki/HF' }]);
    expect(notes).toBe('Clément Delangue is the CEO.');
  });

  it('falls back to the raw text when there is no link list', () => {
    expect(parseSearch('No results')).toEqual({ links: [], notes: 'No results' });
  });
});
