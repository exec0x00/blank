import { expect, test, type Page, type Route } from '@playwright/test';
import { build, stop } from 'esbuild';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Thread } from '../shared/types';

const ONE = '01992a6e-7fa0-7000-8000-111111111111', TWO = '01992a6e-7fa0-7000-8000-222222222222';
function view(ids: string[], nextCursor: string | null = 'opaque older/+=? token', reverse: string | null = 'opaque reverse/+=? token', id = ONE): Thread {
  return { backend: 'codex-cli', id, workspaceId: 'native-workspace', title: id === ONE ? 'First conversation' : 'Second conversation',
    createdAt: '2026-09-22T14:00:00Z', updatedAt: '2026-09-22T14:00:00Z', status: 'idle',
    messages: ids.map(item => ({ id: item, role: 'assistant', content: `Content ${item}`, createdAt: '2026-09-22T14:00:00Z' })),
    timeline: { version: 1, revision: 1, nextSequence: ids.length + 1, entries: ids.map((item, index) => ({ id: `row:${item}`, messageId: item, kind: 'text', text: `Content ${item}`, startOffset: 0, revision: 1, sequence: index + 1 })) },
    nativePage: { nextCursor, backwardsCursor: reverse } };
}
interface HarnessWindow extends Window { nativeHistoryFixture: { current: Thread | null; loading: string | null; hasOlder: boolean; hasNewer: boolean;
  select(id: string): void; snapshot(thread: Thread, replace?: boolean): void; emit(thread: Thread): void; lock(value: boolean): void;
  older(): Promise<void>; newer(): Promise<void>; latest(): Promise<void>; focus(key: string): boolean; range(value: Record<string, unknown>): void } }
let server: Server, origin = '';
test.beforeAll(async () => {
  const bundle = await build({ stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
    import { StrictMode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { useConversationHistory } from './client/components/chat/useConversationHistory';
    import { MeasuredWindow } from './client/components/chat/MeasuredWindow';
    import './client/styles.css';
    const initial = window.nativeHistoryInitial, fixture = window.nativeHistoryFixture;
    const key = row => row.id, estimate = () => 70;
    function Harness() {
      const [id, select] = useState(initial.active), [locked, setLocked] = useState(false);
      const follow = useRef(false), scroll = useRef(null), windowHandle = useRef(null);
      const history = useConversationHistory({ threadId: id, locked, followRef: follow });
      useEffect(() => { history.receiveSnapshot(initial.threads[id]); }, [id]);
      const range = useCallback(value => history.onRangeChange({ ...value, atStart: false, atEnd: false }), [history.onRangeChange]);
      useLayoutEffect(() => { Object.assign(fixture, { current: history.thread, loading: history.paging.loading, hasOlder: history.hasOlder, hasNewer: history.hasNewer,
        select, snapshot: history.receiveSnapshot, emit: thread => history.processEvents([{ type: 'snapshot', threadId: thread.id, thread }]),
        older: history.loadOlder, newer: history.loadNewer, latest: history.jumpToLatest,
        focus: key => windowHandle.current?.jumpToKey(key, 'start') ?? false,
        range: value => history.onRangeChange({ start: 0, end: 1, firstKey: null, lastKey: null, pinnedKeys: new Set(), viewportKeys: new Set(), atStart: false, atEnd: false, ...value }),
        lock: value => { document.body.dataset.workspaceLocked = String(value); setLocked(value); } }); });
      return <main><h1>{history.thread?.title || 'Loading conversation'}</h1><div className="history-actions">
        <button type="button" onClick={history.loadOlder} disabled={!history.hasOlder || !!history.paging.loading}>Load older</button>
        <button type="button" onClick={history.loadNewer} disabled={!history.hasNewer || !!history.paging.loading}>Load newer</button>
        <button type="button" onClick={history.jumpToLatest}>Jump to latest</button>
        <button type="button" onClick={() => history.retryHistory().then(() => windowHandle.current?.jumpToEnd())}>Refresh history</button>
        <span role="status">{history.paging.loading || 'Ready'}</span>
        {history.paging.error && <p role="alert">{history.paging.error}<button type="button" onClick={history.retryHistory}>Retry history</button></p>}
      </div><div ref={scroll} className="history-scroll" tabIndex={0} aria-label="Conversation history"><MeasuredWindow items={history.thread?.timeline?.entries ?? []} itemKey={key}
        estimateHeight={estimate} scrollRef={scroll} handleRef={windowHandle} resetKey={id} initialEdge="start" followRef={follow} overscan={140}
        onRangeChange={range} renderItem={row => <article key={row.id} data-item-id={row.messageId}><p>{row.kind === 'text' ? row.text : row.messageId}</p><input aria-label={'Draft ' + row.messageId} defaultValue={'Draft ' + row.messageId} /></article>} />
      </div></main>;
    }
    createRoot(document.getElementById('root')).render(<StrictMode><Harness /></StrictMode>);
  ` }, bundle: true, write: false, outfile: 'native-history-fixture.js', platform: 'browser', format: 'esm', target: 'es2022', jsx: 'automatic', logLevel: 'silent' });
  stop(); const script = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text + '\nmain{max-width:760px;margin:auto;padding:20px}h1{font-size:17px}.history-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:14px 0}.history-actions button{padding:8px;border:1px solid var(--border);border-radius:7px}.history-scroll{height:420px;overflow:auto;border:1px solid var(--border)}.history-scroll article{height:70px;padding:8px;border-bottom:1px solid var(--border)}.history-scroll p{font-size:12px;margin:0 0 6px}.history-scroll input{max-width:95%;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:4px}';
  server = createServer((request, response) => {
    const path = new URL(request.url || '/', 'http://fixture.invalid').pathname;
    if (path === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(script); return; }
    if (path === '/fixture.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); return; }
    response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => { if (!server) return; server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
const reply = (route: Route, value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
async function fixture(page: Page, first = view(['latest']), second = view(['second'], null, null, TWO)) {
  await page.addInitScript(initial => { Object.assign(window, { nativeHistoryInitial: initial, nativeHistoryFixture: {} }); }, { active: first.id, threads: { [first.id]: first, [second.id]: second } });
  const requests: URL[] = [], errors: string[] = [];
  let handler: ((route: Route, url: URL) => Promise<unknown>) | undefined;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/threads/**', async route => {
    const url = new URL(route.request().url()); requests.push(url);
    return handler ? handler(route, url) : reply(route, { error: 'No history fixture response is configured.' }, 500);
  });
  return { requests, errors, onPage(value: typeof handler) { handler = value; }, async open() { await page.goto(origin); await expect(page.getByRole('heading', { name: first.title })).toBeVisible(); } };
}
const currentIds = (page: Page) => page.evaluate(() => (window as unknown as HarnessWindow).nativeHistoryFixture.current?.messages.map(message => message.id));

test('the real hook passes opaque native cursors unchanged through empty and one-item pages', async ({ page }) => {
  const data = await fixture(page); let reads = 0;
  data.onPage(route => reply(route, reads++ === 0 ? view([], 'second opaque +=/cursor', 'reverse-hidden') : view(['older'], null, 'after:older')));
  await data.open(); await page.getByRole('button', { name: 'Load older', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Ready'); await expect(page.getByRole('button', { name: 'Load older', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Load older', exact: true }).click(); await expect.poll(() => currentIds(page)).toEqual(['older', 'latest']);
  await expect(page.getByRole('button', { name: 'Load older', exact: true })).toBeDisabled();
  expect(data.requests.map(url => url.searchParams.get('before'))).toEqual(['opaque older/+=? token', 'second opaque +=/cursor']);
  expect(data.requests.every(url => !url.searchParams.has('epoch') && !url.searchParams.has('offset'))).toBe(true); expect(data.errors).toEqual([]);
});

test('a late older page preserves newly streamed item content and native status', async ({ page }) => {
  const data = await fixture(page, view(['shared'])); let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  data.onPage(async route => { await held; return reply(route, view(['older', 'shared'], null, 'reverse:older')); });
  await data.open(); await page.getByRole('button', { name: 'Load older', exact: true }).click();
  const live = view(['shared', 'new-live'], 'opaque older/+=? token', 'opaque reverse/+=? token');
  live.status = 'running'; live.messages[0].content = 'Current streamed content';
  if (live.timeline!.entries[0].kind === 'text') live.timeline!.entries[0].text = 'Current streamed content';
  await page.evaluate(thread => (window as unknown as HarnessWindow).nativeHistoryFixture.emit(thread), live); release();
  await expect.poll(() => currentIds(page)).toEqual(['older', 'shared', 'new-live']);
  await expect(page.getByText('Current streamed content', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as HarnessWindow).nativeHistoryFixture.current?.status)).toBe('running'); expect(data.errors).toEqual([]);
});

test('an in-flight page is refused after an explicit native history revert', async ({ page }) => {
  const data = await fixture(page, view(['retained', 'removed'])); let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  data.onPage(async route => { await held; return reply(route, view(['obsolete-page'], null, 'old-reverse')); });
  await data.open(); await page.getByRole('button', { name: 'Load older', exact: true }).click();
  await page.evaluate(thread => (window as unknown as HarnessWindow).nativeHistoryFixture.snapshot(thread, true), view(['retained'], null, 'after:retained')); release();
  await expect(page.getByRole('status')).toHaveText('Ready'); await expect.poll(() => currentIds(page)).toEqual(['retained']);
  await expect(page.locator('[data-item-id="removed"], [data-item-id="obsolete-page"]')).toHaveCount(0); expect(data.errors).toEqual([]);
});

test('conversation changes and lock prevent late page replies from replacing the current view', async ({ page }) => {
  const data = await fixture(page); let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  data.onPage(async route => { await held; return reply(route, view(['old-workspace-data'], null, null)); });
  await data.open(); await page.getByRole('button', { name: 'Load older', exact: true }).click();
  await page.evaluate(id => (window as unknown as HarnessWindow).nativeHistoryFixture.select(id), TWO);
  await expect(page.getByRole('heading', { name: 'Second conversation' })).toBeVisible();
  await page.evaluate(() => (window as unknown as HarnessWindow).nativeHistoryFixture.lock(true)); release();
  await expect.poll(() => currentIds(page)).toEqual(['second']); await expect(page.getByRole('status')).toHaveText('Ready');
  expect(data.requests).toHaveLength(1); expect(data.errors).toEqual([]);
});

test('wrong-thread and nonadvancing responses fail visibly and leave the current native page available for retry', async ({ page }) => {
  const data = await fixture(page); data.onPage(route => reply(route, view(['wrong'], null, null, TWO)));
  await data.open(); await page.getByRole('button', { name: 'Load older', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('does not match'); await expect.poll(() => currentIds(page)).toEqual(['latest']);
  await expect(page.getByRole('status')).toHaveText('Ready'); data.onPage(route => reply(route, view([], 'opaque older/+=? token', null)));
  await page.getByRole('button', { name: 'Retry history' }).click(); await expect(page.getByRole('alert')).toContainText('did not advance');
  await expect(page.getByRole('status')).toHaveText('Ready'); data.onPage(route => reply(route, view(['earlier'], null, 'reverse:earlier')));
  await page.getByRole('button', { name: 'Retry history' }).click(); await expect.poll(() => currentIds(page)).toEqual(['earlier', 'latest']); expect(data.errors).toEqual([]);
});

test('a latest-read overflow keeps the live tail visible and retries with reachable canonical history', async ({ page }) => {
  const initial = view(['old-a', ...Array.from({ length: 255 }, (_, index) => `live-b-${index}`)], 'original-older', 'original-reverse');
  initial.messages = initial.messages.map(message => ({ ...message, turnId: message.id === 'old-a' ? 'turn-a' : 'turn-b' }));
  initial.nativeView = { epoch: 'overflow-producer', revision: 2, historyMode: 'legacy', turns: [
    { turnId: 'turn-a', identity: 'native', revision: 1, coverage: 'complete' },
    { turnId: 'turn-b', identity: 'native', revision: 1, coverage: 'complete' },
  ] };
  const canonicalA = view(['canonical-a-one', 'canonical-a-two'], 'before-canonical-a', 'after-canonical-a');
  canonicalA.messages = canonicalA.messages.map(message => ({ ...message, turnId: 'turn-a' }));
  canonicalA.nativeView = { epoch: 'overflow-producer', revision: 2, historyMode: 'legacy', turns: [
    { turnId: 'turn-a', identity: 'legacy', revision: 2, coverage: 'partial' },
  ] };
  const data = await fixture(page, initial);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  data.onPage(async route => { await held; return reply(route, canonicalA); });
  await data.open();
  await page.getByRole('button', { name: 'Refresh history', exact: true }).click();
  await expect.poll(() => data.requests.length).toBe(1);
  const live = structuredClone(initial); delete live.nativePage; live.nativeView!.revision = 3;
  live.messages.at(-1)!.content = 'The newest live response.';
  Object.assign(live.timeline!.entries.at(-1)!, { text: 'The newest live response.' });
  await page.evaluate(thread => (window as unknown as HarnessWindow).nativeHistoryFixture.emit(thread), live);
  release();
  await expect(page.getByRole('alert')).toContainText('Your current view is kept. Retry to refresh the history.');
  await expect(page.getByText('The newest live response.', { exact: true })).toBeVisible();
  await expect.poll(() => currentIds(page)).toEqual(initial.messages.map(message => message.id));
  await page.waitForTimeout(120);
  expect(data.requests).toHaveLength(1);

  const fresh = view(['canonical-b'], 'actual-older-a', 'after-canonical-b');
  fresh.messages = fresh.messages.map(message => ({ ...message, turnId: 'turn-b' }));
  fresh.nativeView = { epoch: 'overflow-producer', revision: 4, historyMode: 'legacy', turns: [
    { turnId: 'turn-b', identity: 'legacy', revision: 2, coverage: 'complete' },
  ] };
  data.onPage(route => reply(route, fresh));
  await page.getByRole('button', { name: 'Retry history', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(() => currentIds(page)).toEqual(['canonical-b']);
  canonicalA.nativeView.revision = 4;
  canonicalA.nativePage = { nextCursor: null, backwardsCursor: 'actual-after-a' };
  data.onPage((route, url) => {
    expect(url.searchParams.get('before')).toBe('actual-older-a');
    return reply(route, canonicalA);
  });
  await page.getByRole('button', { name: 'Load older', exact: true }).click();
  await expect.poll(() => currentIds(page)).toEqual(['canonical-a-one', 'canonical-a-two', 'canonical-b']);
  expect(data.errors).toEqual([]);
});

test('native prepends preserve the actual focused control, selection and reading anchor with bounded mounted rows', async ({ page }) => {
  const first = view(Array.from({ length: 120 }, (_, index) => `item-${index}`)), data = await fixture(page, first);
  data.onPage(route => reply(route, view(['item-before'], null, 'after:item-before'))); await data.open();
  await page.evaluate(() => (window as unknown as HarnessWindow).nativeHistoryFixture.focus('row:item-60'));
  const input = page.getByRole('textbox', { name: 'Draft item-60', exact: true }); await expect(input).toBeVisible(); await input.fill('Keep this exact focused draft');
  await input.evaluate(element => { element.focus(); (element as HTMLInputElement).setSelectionRange(5, 15); (window as unknown as { focusedNativeInput?: Element }).focusedNativeInput = element; });
  const before = (await input.boundingBox())!.y;
  await page.evaluate(() => (window as unknown as HarnessWindow).nativeHistoryFixture.older());
  await expect.poll(() => currentIds(page)).toHaveLength(121); await expect(input).toBeFocused(); await expect(input).toHaveValue('Keep this exact focused draft');
  const state = await input.evaluate(element => ({ same: (window as unknown as { focusedNativeInput?: Element }).focusedNativeInput === element,
    start: (element as HTMLInputElement).selectionStart, end: (element as HTMLInputElement).selectionEnd }));
  expect(state).toEqual({ same: true, start: 5, end: 15 }); expect(Math.abs((await input.boundingBox())!.y - before)).toBeLessThan(2);
  expect(await page.locator('[data-window-key]').count()).toBeLessThan(30); expect(data.errors).toEqual([]);
});
