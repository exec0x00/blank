import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AgentEvent, ChatMessage, Thread, WebCitation } from '../shared/types';
import { answerSources } from '../client/components/chat/citations';
import { MessageCitations } from '../client/components/chat/MessageCitations';
import { MarkdownMessage } from '../client/components/chat/MarkdownMessage';
import { applyAgentEvent } from '../client/components/chat/state';

// This public text/citation shape is recorded in docs/WEB_SEARCH.md. Malformed
// and repeated annotations below are explicit boundary fixtures.
const url = 'https://nodejs.org/docs/latest/api/globals.html?utm_source=openai';
const citation: WebCitation = { url, title: 'Global objects | Node.js v24.2.0 Documentation', startIndex: 91, endIndex: 172 };
const answer = 'Yes, `AbortSignal.timeout(delay)` returns a signal that aborts after `delay` milliseconds. ([nodejs.org](https://nodejs.org/docs/latest/api/globals.html?utm_source=openai))';
const render = (citations?: readonly WebCitation[]) => renderToStaticMarkup(<MessageCitations citations={citations} />);
const markdown = (content: string, citations?: readonly WebCitation[]) => renderToStaticMarkup(<MarkdownMessage content={content} citations={citations} workspacePath="/workspace/project" onOpenFile={() => undefined} onNotify={() => undefined} />);

describe('answer citation presentation', () => {
  it('does not invent citations from answer links, provider identifiers, or absent metadata', () => {
    expect(render()).toBe('');
    expect(render([])).toBe('');
    const html = markdown(answer);
    expect(html).toContain(`href="${url}"`);
    expect(html).not.toContain('chat-citations');
  });

  it('deduplicates canonical URLs across spans while preserving the exact original href and meaningful title', () => {
    const original = 'https://NODEJS.org:443/docs/latest/api/globals.html?utm_source=openai';
    const sources = answerSources([
      { ...citation, url: original, title: '' },
      { ...citation, startIndex: 0, endIndex: 3 },
      { ...citation, title: 'Another title for the same document', startIndex: undefined, endIndex: undefined },
      { ...citation, url: `${url}#abortsignaltimeoutdelay`, title: 'A distinct section' },
    ]);
    expect(sources).toHaveLength(2);
    expect(sources[0]).toEqual({ key: url, url: original, title: citation.title, host: 'nodejs.org' });
    expect(sources[1].url).toBe(`${url}#abortsignaltimeoutdelay`);
    const html = render([citation, { ...citation, startIndex: 0, endIndex: 3 }]);
    expect(html.match(/href=/g)).toHaveLength(1);
    expect(html).not.toContain('startIndex');
    expect(html).not.toContain('endIndex');
  });

  it('uses sources without offsets without modifying authored Markdown links or code', () => {
    const html = markdown(`${answer}\n\n[Source file](src/index.ts)\n\n\`[example](https://example.com)\``, [{ ...citation, startIndex: undefined, endIndex: undefined }]);
    expect(html.match(new RegExp(`href="${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g'))).toHaveLength(2);
    expect(html).toContain('title="Open src/index.ts"');
    expect(html).toContain('<code>[example](https://example.com)</code>');
    expect(html).toContain(citation.title);
    expect(html).toContain('aria-label="Sources for this answer"');
    expect(html.match(/target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"/g)).toHaveLength(2);
    expect(html).not.toContain('<img');
  });

  it('rejects unsafe source links and does not turn metadata or source titles into executable markup', () => {
    const unsafe = ['javascript:alert(1)', 'data:text/html,test', '//example.com', 'https://name:secret@example.com', 'https://example.com/%0aevil', 'https://localhost/', 'http://127.0.0.1', 'http://2130706433', 'http://0x7f000001', 'https://10.0.0.2', 'https://192.168.1.2', 'http://[::1]', 'http://[2001::1]', 'https://secret.internal', 'https://example.test'];
    expect(render(unsafe.map(url => ({ url, title: 'Unsafe source' })))).toBe('');
    const html = render([{ url, title: '<script>alert(1)</script> & documentation' }]);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; documentation');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror=');
    expect(html).not.toContain('<img');
  });

  it('keeps titles bounded and falls back to the true hostname for empty or opaque metadata', () => {
    for (const title of ['', 'turn12search3', 'msg_private_identifier', '\uE200cite\uE202turn0search1\uE201']) {
      expect(answerSources([{ url, title }])[0].title).toBe('nodejs.org');
    }
    expect(answerSources([{ url, title: '\u202etitle\u2069\n\twith whitespace' }])[0].title).toBe('title with whitespace');
    expect(answerSources([{ url, title: 'a'.repeat(600) }])[0].title).toHaveLength(512);
    const sources = Array.from({ length: 129 }, (_, index) => ({ url: `https://example.com/docs/${index}`, title: `Document ${index}` }));
    expect(answerSources(sources)).toHaveLength(128);
    expect(render(sources).match(/<li>/g)).toHaveLength(3);
    expect(render(sources)).toContain('Show 125 more sources');
    expect(answerSources([null, { url: 123 }, undefined] as unknown as WebCitation[])).toEqual([]);
  });

  it('hides complete and streaming citation tokens in prose while preserving literal code examples', () => {
    const token = '\uE200cite\uE202turn0search0\uE202turn0search1\uE201';
    const html = markdown(`An answer. ${token}\n\n[Authored link](https://nodejs.org)\n\n\`${token}\`\n\n\`\`\`text\n${token}\n\`\`\``, [citation]);
    expect(html).toContain('<p>An answer. </p>');
    expect(html.match(/turn0search0/g)).toHaveLength(2);
    expect(html).toContain(`<code>${token}</code>`);
    expect(html).toContain(`class="language-text">${token}`);
    expect(html).toContain('href="https://nodejs.org"');
    expect(markdown('An answer. \uE200cite\uE202turn0search')).not.toContain('turn0search');
    expect(markdown('An answer. \uE200cite\uE202turn0search')).toContain('An answer. ');
    for (const partial of ['\uE200', '\uE200c', '\uE200ci', '\uE200cit', '\uE200cite']) expect(markdown(`An answer. ${partial}`)).not.toContain('\uE200');
  });
});

describe('citation events and saved conversations', () => {
  const time = '2026-09-19T15:00:00.000Z';
  const initial: Thread = { id: 'citation-thread', workspaceId: 'workspace', title: 'Source test', createdAt: time, updatedAt: time, status: 'running', messages: [] };
  const message: ChatMessage = { id: 'citation-message', role: 'assistant', content: answer, createdAt: time };
  const event = (type: AgentEvent['type'], payload: Record<string, unknown>): AgentEvent => ({ type, threadId: initial.id, ...payload });

  it('retains final citations through repeated envelopes and reconnects, and honors explicit retraction', () => {
    let state = applyAgentEvent(initial, event('message', { message }))!;
    expect(state.messages[0].citations).toBeUndefined();
    state = applyAgentEvent(state, event('message', { message: { ...message, citations: [citation] } }))!;
    state = applyAgentEvent(state, event('message', { message }))!;
    expect(state.messages[0].citations).toEqual([citation]);
    state = applyAgentEvent(state, event('snapshot', { thread: JSON.parse(JSON.stringify(state)) }))!;
    expect(render(state.messages[0].citations)).toContain(citation.title);
    state = applyAgentEvent(state, event('message', { message: { ...message, citations: [] } }))!;
    expect(render(state.messages[0].citations)).toBe('');
    expect(state.messages[0].content).toBe(answer);
  });
});
