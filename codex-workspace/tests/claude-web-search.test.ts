import { describe, expect, it } from 'vitest';
import { readSearchStream } from '../server/claude-agent';
import { parseSearch } from '../client/components/claude/ToolCard';

const sse = (event: unknown) => `event: x\ndata: ${JSON.stringify(event)}\n\n`;

describe('Workspace web search', () => {
  it('collects sources and the written answer from the bridge stream', () => {
    const raw = ': bridge {"account":"a"}\n\n' + [
      { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', name: 'web_search', input: {} } },
      { type: 'content_block_start', index: 1, content_block: { type: 'web_search_tool_result', content: [
        { type: 'web_search_result', title: 'About', url: 'https://huggingface.co/about' },
        { type: 'web_search_result', title: 'Dup', url: 'https://huggingface.co/about' }] } },
      { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'Clément Delangue ' } },
      { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'is CEO.' } },
    ].map(sse).join('');
    const value = readSearchStream(raw);
    expect(value).toEqual({ links: [{ title: 'About', url: 'https://huggingface.co/about' }], text: 'Clément Delangue is CEO.', error: undefined });
  });

  it('reports a stream error', () => {
    expect(readSearchStream(sse({ type: 'error', error: { message: 'throttled' } })).error).toBe('throttled');
  });

  it('formats results the tool card can render', () => {
    const text = `Web search results for query: "x"\n\nLinks: ${JSON.stringify([{ title: 'A', url: 'https://a.dev' }])}\n\nSummary.\n\nREMINDER: Cite the relevant sources above as markdown links in your answer.`;
    expect(parseSearch(text)).toEqual({ links: [{ title: 'A', url: 'https://a.dev' }], notes: 'Summary.' });
  });
});

describe('Skill files', () => {
  it('reads the description from SKILL.md front matter', async () => {
    const { skillDescription } = await import('../server/claude-agent');
    expect(skillDescription('---\nname: review\ndescription: "Review a pull request for bugs"\n---\n# Review')).toBe('Review a pull request for bugs');
    expect(skillDescription('# No front matter')).toBe('');
  });
});

describe('Goal state from the transcript', () => {
  it('uses the newest goal_status entry', async () => {
    const fs = await import('node:fs/promises'); const os = await import('node:os'); const path = await import('node:path');
    const { transcriptGoal } = await import('../server/claude-agent');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'goal-'));
    const dir = path.join(root, 'projects', '-data-ws'); await fs.mkdir(dir, { recursive: true });
    const line = (attachment: object) => JSON.stringify({ type: 'attachment', attachment: { type: 'goal_status', ...attachment } });
    await fs.writeFile(path.join(dir, 's1.jsonl'), [line({ met: false, sentinel: true, condition: 'tests pass' }), '{"type":"user"}'].join('\n'));
    expect(await transcriptGoal(root, 's1')).toMatchObject({ condition: 'tests pass', iterations: 0 });
    await fs.appendFile(path.join(dir, 's1.jsonl'), '\n' + line({ met: true, condition: 'tests pass', iterations: 2 }));
    expect(await transcriptGoal(root, 's1')).toBeNull();
    expect(await transcriptGoal(root, 'missing')).toBeUndefined();
  });
});
