import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ToolActivity } from '../shared/types';
import { projectNativeThread } from '../server/codex-cli/projection';
import { ActivityCard } from '../client/components/chat/ActivityCard';
import { formatToolActivity, safeWebSourceUrl, toolActivityHasFailure, type ToolPresentation, type ToolSection } from '../client/components/chat/tool-presentation';

function web(input: unknown, output: unknown, status: ToolActivity['status'] = 'completed'): ToolActivity {
  return { id: 'local-web-activity', name: 'web_search', input: JSON.stringify(input), output: typeof output === 'string' ? output : JSON.stringify(output), status, startedAt: '2026-09-19T16:00:00.000Z', ...(status === 'completed' || status === 'error' ? { completedAt: '2026-09-19T16:00:02.000Z' } : {}) };
}
const source = { type: 'url', url: 'https://developer.mozilla.org/en-US/docs/Web/API/URL', title: 'URL — MDN Web Docs' };
function rows(view: ToolPresentation, variant: Extract<ToolSection, { type: 'rows' }>['variant']) {
  return view.sections.flatMap(section => section.type === 'rows' && section.variant === variant ? section.rows : []);
}

describe('public web search activity presentation', () => {
  it('shows observed progress without inventing a query, sources, content, or provider identity', () => {
    for (const [stage, label] of [['in_progress', 'In progress'], ['searching', 'Searching']] as const) {
      const view = formatToolActivity(web({}, { status: stage, id: 'PRIVATE_PROVIDER_ID', encrypted_content: 'PRIVATE_REASONING' }, 'running'));
      expect(view.kind).toBe('web');
      expect(view.label).toBe('Web search');
      expect(view.statusLabel).toBe(label);
      expect(view.preview).toBe('');
      expect(rows(view, 'queries')).toEqual([]);
      expect(rows(view, 'sources')).toEqual([]);
      expect(JSON.stringify(view)).not.toMatch(/PRIVATE_PROVIDER_ID|PRIVATE_REASONING|encrypted_content/);
      expect(JSON.stringify(view)).toContain('Search details have not arrived yet.');
    }
  });

  it('accepts completed enrichment with actual queries and sources while ignoring private envelope fields', () => {
    const early = formatToolActivity(web({}, { status: 'completed' }));
    expect(early.preview).toBe('');
    const final = formatToolActivity(web({}, { action: 'search', query: 'URL constructor documentation', queries: ['URL constructor documentation', 'URL canParse examples'], status: 'completed', sources: [source, source], call_id: 'PRIVATE_CALL_ID', output_index: 7, private_data: 'PRIVATE_DATA' }));
    expect(final.label).toBe('Searched the web');
    expect(final.statusLabel).toBe('Completed');
    expect(final.preview).toBe('URL constructor documentation');
    expect(rows(final, 'queries').map(row => row.title)).toEqual(['URL constructor documentation', 'URL canParse examples']);
    expect(rows(final, 'sources')).toEqual([{ title: source.title, url: source.url, detail: 'developer.mozilla.org/en-US/docs/Web/API/URL' }]);
    expect(final.summary).toBe('1 source');
    expect(JSON.stringify(final)).not.toMatch(/PRIVATE_CALL_ID|PRIVATE_DATA|output_index|"action"|"sources"\s*:/);
    expect(toolActivityHasFailure(web({}, { status: 'completed' }))).toBe(false);
  });

  it('renders recorded page-opening and find-on-page actions without inventing page text or matches', () => {
    const open = formatToolActivity(web({ action: 'open_page', url: source.url }, { action: 'open_page', status: 'completed', url: source.url }));
    expect(open.label).toBe('Opened web page');
    expect(rows(open, 'sources')[0].url).toBe(source.url);
    const find = formatToolActivity(web({ action: 'find_in_page', url: source.url, pattern: 'canParse' }, { action: 'find_in_page', status: 'completed', url: source.url, pattern: 'canParse' }));
    expect(find.label).toBe('Searched web page');
    expect(find.preview).toBe('canParse');
    expect(rows(find, 'queries')[0].title).toBe('canParse');
    expect(JSON.stringify(find)).not.toMatch(/No matches|match found|matches found|page content/i);
  });

  it('preserves observed search details on failure and does not add an approval flow', () => {
    const record = web({ action: 'search', query: 'Recorded query' }, { action: 'search', query: 'Recorded query', status: 'failed', sources: [source], error: 'Web search was interrupted.' }, 'error');
    const view = formatToolActivity(record);
    expect(view.statusLabel).toBe('Failed');
    expect(view.notices).toContainEqual({ kind: 'error', text: 'Web search was interrupted.' });
    expect(rows(view, 'queries')[0].title).toBe('Recorded query');
    expect(rows(view, 'sources')[0].url).toBe(source.url);
    expect(toolActivityHasFailure(record)).toBe(true);
    expect(toolActivityHasFailure({ ...record, status: 'completed' })).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(/Awaiting approval|Approve|permission/);
  });

  it('waits for complete metadata before treating a recovered JSON prefix as a source URL or query', () => {
    const view = formatToolActivity(web({}, '{"action":"search","query":"partial query","sources":[{"type":"url","url":"https://example.com/docs', 'running'));
    expect(rows(view, 'queries')).toEqual([]);
    expect(rows(view, 'sources')).toEqual([]);
    expect(view.truncated).toBe(true);
    expect(view.notices.some(notice => notice.text === 'Result details are still arriving.')).toBe(true);
    expect(JSON.stringify(view)).not.toContain('https://example.com/docs');
  });

  it('omits invalid sources without exposing their titles, addresses, or private metadata', () => {
    const view = formatToolActivity(web({ action: 'search', query: 'Observed query' }, { action: 'search', status: 'completed', sources: [source, { type: 'url', url: 'https://user:PRIVATE_CREDENTIAL@example.com/', title: 'PRIVATE_SOURCE_TITLE' }, { type: 'url', url: 'http://127.0.0.1/private', title: 'LOCAL_SOURCE_TITLE' }, { type: 'provider_id', id: 'PRIVATE_PROVIDER_ID' }] }));
    expect(rows(view, 'sources')).toHaveLength(1);
    expect(view.truncated).toBe(true);
    expect(view.notices).toContainEqual({ kind: 'warning', text: '3 source links could not be displayed.' });
    expect(JSON.stringify(view)).not.toMatch(/PRIVATE_CREDENTIAL|PRIVATE_SOURCE_TITLE|LOCAL_SOURCE_TITLE|PRIVATE_PROVIDER_ID|127\.0\.0\.1/);
    const page = formatToolActivity(web({ action: 'open_page', url: 'file:///private/path' }, { status: 'completed' }));
    expect(rows(page, 'sources')).toEqual([]);
    expect(JSON.stringify(page)).not.toContain('/private/path');
  });

  it('makes bounded source and query previews explicit, including malformed and oversized metadata', () => {
    const sources = Array.from({ length: 140 }, (_, index) => ({ type: 'url', url: `https://example.com/source/${index}`, title: `Source ${index}` }));
    const view = formatToolActivity(web({ action: 'search', queries: Array.from({ length: 50 }, (_, index) => `Recorded query ${index}`) }, { status: 'completed', sources }));
    expect(rows(view, 'queries')).toHaveLength(32);
    expect(rows(view, 'sources')).toHaveLength(60);
    expect(view.truncated).toBe(true);
    expect(view.notices.some(notice => notice.text.includes('12 source links are outside'))).toBe(true);
    const malformed = formatToolActivity(web({ action: { toString: null }, query: { toString: null } }, { sources: [null, 3, { type: 'url', url: { toString: null } }], status: 'completed' }));
    expect(malformed.kind).toBe('web');
    expect(rows(malformed, 'sources')).toEqual([]);
    const long = formatToolActivity(web({}, { action: 'search', query: 'q'.repeat(5000), sources: [{ ...source, title: 't'.repeat(700) }], status: 'completed' }));
    expect(rows(long, 'queries')[0].title).toHaveLength(4096);
    expect(rows(long, 'sources')[0].title).toHaveLength(512);
    expect(long.truncated).toBe(true);
  });

  it('escapes source titles and uses safe external anchor attributes without images or raw JSON', () => {
    const title = '<img src="https://example.com/tracker" onerror="alert(1)">';
    const html = renderToStaticMarkup(<ActivityCard activity={web({ action: 'search', query: 'Recorded query' }, { status: 'failed', sources: [{ ...source, title }], error: 'Search did not finish.', provider_id: 'PRIVATE_PROVIDER_ID' }, 'error')} onNotify={() => undefined} />);
    expect(html).toContain('href="https://developer.mozilla.org/en-US/docs/Web/API/URL"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('PRIVATE_PROVIDER_ID');
    expect(html).not.toContain('"sources":');
  });
});

describe('web source URL render boundary', () => {
  const accepted = [source.url, 'http://example.com/path?q=one#part', 'https://8.8.8.8/', 'https://[2606:4700:4700::1111]/', 'https://example.com:8443/path', 'https://example.com./path'];
  const rejected = ['javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/file', '/api/logout', '//example.com/path', 'https://user:pass@example.com/', 'https://example.com/\npath', 'https://example.com/\\path', 'https://example.com/%0a', 'https://example.com/%00', 'http://localhost/', 'http://a.localhost/', 'https://service.local/', 'https://service.internal/', 'https://fixture.test/', 'http://10.2.3.4/', 'http://127.0.0.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://0177.0.0.1/', 'http://169.254.169.254/', 'http://172.16.1.1/', 'http://192.168.1.1/', 'https://192.0.2.1/', 'https://198.51.100.1/', 'https://203.0.113.1/', 'https://[::1]/', 'https://[::ffff:127.0.0.1]/', 'https://[fd00::1]/', 'https://[fe80::1]/', 'https://[2001:db8::1]/', 'https://[2001:0::1]/', 'https://[2001::1]/', `https://example.com/${'x'.repeat(8192)}`];
  it('accepts public HTTP(S) addresses and rejects unsafe or nonpublic destinations', () => {
    for (const url of accepted) expect(safeWebSourceUrl(url), url).toBe(url);
    for (const url of rejected) expect(safeWebSourceUrl(url), url).toBeNull();
    for (const value of [null, undefined, 1, {}, [], { toString: null }]) expect(safeWebSourceUrl(value)).toBeNull();
  });
  // The old custom Responses web-search policy was retired. Exercise the real
  // native item projection and the still-active browser render boundary rather
  // than resurrecting that deleted transport solely for an equivalence test.
  it('keeps native page-opening items behind the render URL boundary without exposing opaque results', () => {
    for (const url of [...accepted, ...rejected]) {
      const thread = projectNativeThread({ id: '01980000-0000-7000-8000-000000000001', createdAt: 1_700_000_000,
        updatedAt: 1_700_000_001, status: { type: 'idle' } }, [{ turnId: '01980000-0000-7000-8000-000000000101',
        item: { type: 'webSearch', id: 'recorded-native-web', status: 'completed', action: { type: 'open_page', url },
          results: { private_data: 'PRIVATE_NATIVE_RESULT', sources: [{ url: 'https://example.com/PRIVATE_NATIVE_QUERY' }] } } }], 'workspace-1');
      const activity = thread.messages.flatMap(message => message.activities ?? [])[0];
      expect(activity, url).toBeDefined();
      const presentation = formatToolActivity(activity);
      expect(rows(presentation, 'sources').some(row => row.url === url), url).toBe(accepted.includes(url));
      expect(JSON.stringify(presentation)).not.toMatch(/PRIVATE_NATIVE_RESULT|PRIVATE_NATIVE_QUERY/);
    }
  });
});
