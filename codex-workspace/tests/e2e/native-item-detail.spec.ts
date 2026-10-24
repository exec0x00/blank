import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import type { ChatMessage, NativeItemDetail, NativeItemDetailReady, Thread, ToolActivity } from '../../shared/types';
import { expandActivityGroups } from '../activity-group-browser';

// Real ConversationTimeline and bounded native/legacy content readers. Only read responses
// are controlled; no CLI, model, external service or filesystem item fallback.
const threadId = '0199d111-1111-7111-8111-111111111111';
const turnId = '0199d222-2222-7222-8222-222222222222';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const secondThread = '0199d333-3333-7333-8333-333333333333';
const stamp = '2026-09-22T14:00:00.000Z';
const itemMessage = 'actual-native-message-id', itemCommand = 'actual-native-command-id', itemPatch = 'actual-native-file-change-id', itemReasoning = 'actual-native-reasoning-id';
const longText = 'A'.repeat(15_999) + '😀' + ' public tail '.repeat(1700);
const publicOutput = 'Readable command output.\n'.repeat(1500);
const patchText = '--- a/source.ts\n+++ b/source.ts\n@@\n-old line\n+new line\n'.repeat(600);
const failures = new WeakMap<Page, string[]>();
let server: Server | undefined, origin: string;

test.beforeAll(async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'native-item-detail-harness.tsx', contents: [
    "import React, { useState } from 'react'; import { createRoot } from 'react-dom/client';",
    "import { ConversationTimeline } from './client/components/chat/ConversationTimeline';",
    "import { ActivityCard } from './client/components/chat/ActivityCard';",
    "import { conversationTimeline } from './client/components/chat/timeline'; import { api } from './client/api';",
    "import './client/styles.css'; import './client/components/chat.css';",
    "const fixtures = await api('/detail-fixture');",
    "function Harness() { const [thread,setThread] = useState(fixtures.native); const [locked,setLocked] = useState(false);",
    "window.switchDetailFixture = kind => { if(kind==='thread') setThread({...fixtures.native,id:fixtures.secondThread,title:'Other native thread'});",
    "else if(kind==='workspace') setThread({...fixtures.native,workspaceId:'22222222-2222-4222-8222-222222222222'});",
    "else if(kind==='legacy') setThread(fixtures.legacy); else setThread(fixtures.native); };",
    "window.replaceOutputFixture = output => setThread(previous => ({...previous,messages:previous.messages.map(message => message.id === 'actual-native-command-id' ? {...message,activities:message.activities.map(activity => ({...activity,output:JSON.stringify({output,exit_code:0})}))} : message)}));",
    "return <main><h1>Native item inspection</h1><button onClick={()=>window.switchDetailFixture('legacy')}>Show legacy</button>",
    "<button onClick={()=>window.switchDetailFixture('native')}>Show native</button>",
    "<button onClick={()=>{document.body.dataset.workspaceLocked='true';window.dispatchEvent(new Event('codex:session-locked'));setLocked(true)}}>Lock fixture</button>",
    "<button onClick={()=>{document.body.dataset.workspaceLocked='false';window.dispatchEvent(new Event('codex:session-unlocked'));setLocked(false)}}>Unlock fixture</button>",
    "<div className='detail-fixture-timeline'><ConversationTimeline rows={conversationTimeline(thread)} thread={thread} locked={locked}",
    "workspacePath='/data/workspaces/inspection' onNotify={()=>undefined} onOpenChange={target=>{window.openedChangeTarget=target}} renderMessage={({content})=><article className='fixture-preview'>{content}</article>} renderActivity={activity=><ActivityCard activity={activity} workspacePath='/data/workspaces/inspection' onNotify={()=>undefined}/>}/></div></main>; }",
    "createRoot(document.getElementById('root')).render(<React.StrictMode><Harness/></React.StrictMode>);",
  ].join('\n') }, bundle: true, write: false, outfile: '/tmp/native-item-detail-fixture.js', format: 'esm', platform: 'browser', logLevel: 'silent' });
  const script = result.outputFiles.find(file => file.path.endsWith('.js'))!.text, css = result.outputFiles.find(file => file.path.endsWith('.css'))!.text;
  server = createServer((request, response) => {
    if (request.url === '/fixture.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(script); }
    else if (request.url === '/fixture.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); }
    else if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>html,body,#root{height:auto;min-height:100%;overflow:auto}main{max-width:900px;padding:24px;margin:auto}main>button{padding:8px;border:1px solid var(--border);border-radius:7px;margin:4px}.detail-fixture-timeline{padding:16px}.fixture-preview{max-height:90px;overflow:auto;white-space:pre-wrap;margin:12px 0}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
    } else { response.statusCode = 404; response.end(); }
  });
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve)); origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
});
test.afterAll(async () => { if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); } });
test.afterEach(async ({ page }) => { expect(failures.get(page) ?? []).toEqual([]); });

function thread(): Thread {
  const activity = (id: string, name: string, patch: Partial<ToolActivity>) => ({ id, name, input: '{}', status: 'completed' as const, startedAt: stamp, ...patch });
  const messages: ChatMessage[] = [
    { id: itemMessage, turnId, role: 'assistant', content: 'A bounded public message preview.', contentTruncated: true, contentChars: longText.length, createdAt: stamp },
    { id: itemCommand, turnId, role: 'assistant', content: '', createdAt: stamp, activities: [activity(itemCommand, 'exec_command', {
      input: JSON.stringify({ cmd: 'printf public-preview', workdir: '/data/workspaces/inspection' }), inputTruncated: true,
      output: JSON.stringify({ output: 'Command output preview.', exit_code: 0 }), outputTruncated: true })] },
    { id: itemPatch, turnId, role: 'assistant', content: '', createdAt: stamp, activities: [activity(itemPatch, 'apply_patch', {
      input: JSON.stringify({ path: 'source.ts', patch: '+preview' }), inputTruncated: true, output: JSON.stringify({ changed: [{ path: 'source.ts', operation: 'updated' }] }) })] },
    { id: itemReasoning, turnId, role: 'assistant', content: '', createdAt: stamp, reasoningSummary: [{ id: itemReasoning, summaryIndex: 0, text: 'Public reasoning preview.', status: 'complete', truncated: true }] },
  ];
  return { id: threadId, workspaceId, title: 'Native detail fixture', backend: 'codex-cli', readOnly: false, status: 'idle', createdAt: stamp, updatedAt: stamp, messages,
    nativePage: { nextCursor: null, backwardsCursor: null },
    timeline: { version: 1, revision: 4, nextSequence: 5, entries: [
      { id: 'fragment-not-the-item-id', messageId: itemMessage, sequence: 1, revision: 1, kind: 'text', text: messages[0].content, startOffset: 0, textTruncated: true },
      { id: 'command-fragment-not-item-id', messageId: itemCommand, sequence: 2, revision: 2, kind: 'activity', activityId: itemCommand },
      { id: 'patch-fragment-not-item-id', messageId: itemPatch, sequence: 3, revision: 3, kind: 'activity', activityId: itemPatch },
      { id: 'summary-fragment-not-item-id', messageId: itemReasoning, sequence: 4, revision: 4, kind: 'reasoning', summaryId: itemReasoning + ':summary:0', text: 'Public reasoning preview.', status: 'complete', truncated: true },
    ] } };
}

type Behavior = 'normal' | 'search' | 'unavailable' | 'notFound' | 'changed' | 'wrongIdentity' | 'protocolFields' | 'oversized' | 'invalidRange';
async function fixture(page: Page, behavior: Behavior = 'normal') {
  const errors: string[] = []; failures.set(page, errors); page.on('pageerror', error => errors.push(error.message));
  const native = thread();
  const legacy: Thread = { ...native, id: 'thr_legacy_detail', backend: 'legacy', readOnly: true, timeline: undefined, messages: [native.messages[0]],
    history: { version: 1, epoch: 'legacy-detail-epoch', revision: 1, totalMessages: 1, oldestSequence: 1, newestSequence: 1, latestSequence: 1,
      hasOlder: false, hasNewer: false, olderCursor: null, newerCursor: null } };
  const calls: URL[] = [], methods: string[] = [];
  const controls = { changed: behavior === 'changed', held: false };
  let holdNext: boolean | 'text' | 'input' | 'output' = false, release: (() => void) | undefined;
  const fields = new Map<string, Array<{ label: string; text: string }>>([
    [itemMessage + ':text', [{ label: 'Agent text', text: longText }]],
    [itemCommand + ':input', [{ label: 'Command', text: 'printf native-public-command' }, { label: 'Working directory', text: '/data/workspaces/inspection' }]],
    [itemCommand + ':output', [{ label: 'Command output', text: publicOutput }]],
    [itemPatch + ':input', [{ label: 'Path 1', text: 'source.ts' }]],
    [itemPatch + ':output', [{ label: 'Change 1: source.ts', text: patchText }, { label: 'Change 2: other.ts', text: '+other public diff\n' }]],
    [itemReasoning + ':text', [{ label: 'Public summary 1', text: 'Public reasoning summary, first part.' }, { label: 'Public summary 2', text: 'Public reasoning summary, second part.' }]],
  ]);
  await page.addInitScript(() => {
    // Readers must reject late responses even if the transport ignores abort.
    const fetch = window.fetch.bind(window);
    window.fetch = (input, init) => fetch(input, init ? { ...init, signal: undefined } : init);
  });
  await page.context().route('https://**/*', route => { errors.push('Unexpected external request'); return route.abort(); });
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/api/detail-fixture') return route.fulfill({ json: { native, legacy, secondThread } });
    methods.push(request.method()); calls.push(url); expect(request.method()).toBe('GET');
    if (url.pathname.endsWith('/history/detail')) {
      expect(url.pathname).toBe('/api/threads/' + legacy.id + '/history/detail');
      expect(url.searchParams.get('epoch')).toBe('legacy-detail-epoch'); expect(url.searchParams.get('field')).toBe('content');
      const text = 'Legacy saved public content.';
      return route.fulfill({ json: { threadId: legacy.id, epoch: 'legacy-detail-epoch', revision: 1, version: 'legacy-version', offset: 0, totalChars: text.length, text, previousOffset: null, nextOffset: null } });
    }
    if (!url.pathname.endsWith('/native-item-detail')) { errors.push('Unexpected inspection route.'); return route.fulfill({ status: 404, json: { error: 'Unexpected inspection route.' } }); }
    expect(url.searchParams.get('limit')).toBe('16000');
    expect(['epoch', 'messageId', 'entryId', 'activityId'].some(key => url.searchParams.has(key))).toBe(false);
    const id = decodeURIComponent(url.pathname.split('/')[3]), itemId = url.searchParams.get('itemId')!, field = url.searchParams.get('field') as 'text' | 'input' | 'output';
    const identity = { threadId: id, turnId: url.searchParams.get('turnId')!, itemId, field };
    expect(identity.turnId).toBe(turnId); expect(fields.has(itemId + ':' + field)).toBe(true);
    const input = url.searchParams.get('cursor');
    if (behavior === 'search' && input !== 'native-search-two') {
      const result: NativeItemDetail = { ...identity, status: 'searching', nextCursor: input === 'native-search-one' ? 'native-search-two' : 'native-search-one', pagesScanned: 8 };
      return route.fulfill({ json: result });
    }
    if (behavior === 'unavailable') return route.fulfill({ json: { ...identity, status: 'unavailable', itemType: 'reasoning', itemCursor: null, reason: 'no-public-content', message: 'This item has no public text for this field.' } satisfies NativeItemDetail });
    if (behavior === 'notFound') return route.fulfill({ json: { ...identity, status: 'notFound', nextCursor: null, message: 'The selected native item was not found.' } satisfies NativeItemDetail });
    if (controls.changed && url.searchParams.has('version')) return route.fulfill({ status: 409, json: { error: 'This native item changed.', code: 'CODEX_DETAIL_STALE' } });
    const selected = fields.get(itemId + ':' + field)!, part = Number(url.searchParams.get('part') ?? 0), requested = Number(url.searchParams.get('offset') ?? 0), value = selected[part];
    const boundary = (offset: number) => offset > 0 && offset < value.text.length && /[\uDC00-\uDFFF]/.test(value.text[offset]) && /[\uD800-\uDBFF]/.test(value.text[offset - 1]) ? offset - 1 : offset;
    const offset = boundary(requested), end = boundary(Math.min(value.text.length, offset + 16000));
    const version = createHash('sha256').update(JSON.stringify([itemId, field, selected])).digest('hex');
    const itemCursor = behavior === 'search' ? 'native-search-two' : null;
    if (url.searchParams.has('version')) { expect(url.searchParams.get('version')).toBe(version); expect(url.searchParams.has('cursor')).toBe(true); expect(input).toBe(itemCursor ?? ''); }
    const response: NativeItemDetailReady = { ...identity, status: 'ready', itemType: itemId === itemCommand ? 'commandExecution' : itemId === itemPatch ? 'fileChange' : itemId === itemReasoning ? 'reasoning' : 'agentMessage',
      itemCursor, parts: selected.map((part, index) => ({ part: index, label: part.label, totalChars: part.text.length })), part, label: value.label,
      text: value.text.slice(offset, end), totalChars: value.text.length, offset, limit: 16000, previousOffset: offset ? boundary(Math.max(0, offset - 16000)) : null,
      nextOffset: end < value.text.length ? end : null, version };
    if (holdNext === true || holdNext === field) { holdNext = false; controls.held = true; await new Promise<void>(resolve => { release = resolve; }); }
    const altered = behavior === 'wrongIdentity' ? { ...response, itemId: 'wrong-item', text: 'MUST_NOT_DISPLAY' }
      : behavior === 'protocolFields' ? { ...response, privateReasoning: 'MUST_NOT_DISPLAY', imageData: 'data:image/png;base64,MUST_NOT_DISPLAY', text: 'MUST_NOT_DISPLAY' }
      : behavior === 'oversized' ? { ...response, text: 'MUST_NOT_DISPLAY'.repeat(2000) }
      : behavior === 'invalidRange' ? { ...response, nextOffset: 0, text: 'MUST_NOT_DISPLAY' } : response;
    return route.fulfill({ json: altered }).catch(() => undefined);
  });
  await page.goto(origin); await expect(page.getByRole('button', { name: 'Inspect full response', exact: true })).toBeVisible();
  await expandActivityGroups(page);
  return { calls, methods, controls, native, fields, hold(field?: 'text' | 'input' | 'output') { holdNext = field ?? true; }, release() { release?.(); },
    async switch(kind: 'thread' | 'workspace' | 'native' | 'legacy') {
      await page.evaluate(value => (window as unknown as { switchDetailFixture: (value: string) => void }).switchDetailFixture(value), kind);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
      await expandActivityGroups(page);
    } };
}

test('native truncated rows use canonical IDs and bounded version-pinned UTF-16 sections', async ({ page }) => {
  const app = await fixture(page);
  await page.getByRole('button', { name: 'Inspect full response', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Full response', exact: true });
  await expect(dialog.getByLabel('Agent text', { exact: true })).toHaveText('A'.repeat(15999));
  expect(app.calls).toHaveLength(1); expect(app.calls[0].searchParams.get('itemId')).toBe(itemMessage);
  expect(app.calls[0].searchParams.get('turnId')).toBe(turnId); expect(app.calls[0].searchParams.has('cursor')).toBe(false);
  await dialog.getByRole('button', { name: 'Next section', exact: true }).click();
  await expect(dialog.getByLabel('Agent text', { exact: true })).toHaveText(longText.slice(15999, 31999));
  expect(app.calls[1].searchParams.get('offset')).toBe('15999');
  expect(app.calls[1].searchParams.has('cursor')).toBe(true); expect(app.calls[1].searchParams.get('cursor')).toBe('');
  expect(app.calls[1].searchParams.get('version')).toMatch(/^[a-f0-9]{64}$/);
  await dialog.getByRole('button', { name: 'Previous section', exact: true }).click();
  await expect(dialog.getByLabel('Agent text', { exact: true })).toHaveText('A'.repeat(15999));
  expect(app.methods.every(method => method === 'GET')).toBe(true);
});

test('command expansion reads output inline, keeps focus and retains one bounded page on collapse', async ({ page }) => {
  const app = await fixture(page);
  const trigger = page.getByRole('button', { name: /Ran command/ });
  expect(app.calls).toHaveLength(0);
  await expect(page.getByRole('button', { name: /Inspect full (command|file)/ })).toHaveCount(0);
  await trigger.focus(); await trigger.press('Enter');
  const output = page.getByRole('region', { name: 'Command output', exact: true });
  const content = output.getByLabel('Command output', { exact: true });
  await expect(content).toHaveText(publicOutput.slice(0, 16000));
  await expect(trigger).toBeFocused();
  expect(app.calls).toHaveLength(2);
  expect(app.calls.every(call => call.searchParams.get('itemId') === itemCommand && call.searchParams.get('turnId') === turnId)).toBe(true);
  await expect(page.getByText('Command output preview.', { exact: true })).toHaveCount(0);
  const next = output.getByRole('button', { name: 'Next section', exact: true });
  await next.click();
  await expect(content).toHaveText(publicOutput.slice(16000, 32000));
  await expect(next).toBeFocused();
  const lastRead = app.calls.at(-1)!;
  expect(lastRead.searchParams.get('offset')).toBe('16000'); expect(lastRead.searchParams.get('version')).toMatch(/^[a-f0-9]{64}$/);
  expect(lastRead.searchParams.get('limit')).toBe('16000');
  const viewport = output.getByRole('region', { name: 'Command output section', exact: true });
  await viewport.evaluate(element => { element.scrollTop = 150; });
  expect(await viewport.evaluate(element => element.scrollTop)).toBe(150);
  await trigger.focus(); await trigger.press('Enter');
  await expect(output).toBeHidden();
  const requests = app.calls.length;
  await trigger.press('Enter');
  await expect(content).toHaveText(publicOutput.slice(16000, 32000));
  expect(await viewport.evaluate(element => element.scrollTop)).toBe(150);
  await page.waitForTimeout(80); expect(app.calls).toHaveLength(requests);
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('pointer clicks have no white outline and keyboard focus remains gray and visible', async ({ page }) => {
  await fixture(page);
  const trigger = page.getByRole('button', { name: /Ran command/ });
  await trigger.click();
  await expect(page.getByRole('region', { name: 'Command output', exact: true }).getByLabel('Command output', { exact: true })).toBeVisible();
  expect(await trigger.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('none');
  expect(await trigger.evaluate(element => getComputedStyle(element).getPropertyValue('-webkit-tap-highlight-color'))).toBe('rgba(0, 0, 0, 0)');
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  await expect(trigger).toBeFocused();
  const focus = await trigger.evaluate(element => ({ visible: element.matches(':focus-visible'), color: getComputedStyle(element).outlineColor, width: getComputedStyle(element).outlineWidth, shadow: getComputedStyle(element).boxShadow }));
  expect(focus).toEqual({ visible: true, color: 'rgb(158, 158, 158)', width: '2px', shadow: 'none' });
});

test('collapsing output discards an unabortable pending page and reopening retries inline', async ({ page }) => {
  const app = await fixture(page); app.hold('output');
  const trigger = page.getByRole('button', { name: /Ran command/ });
  try {
    await trigger.click(); await expect.poll(() => app.controls.held).toBe(true);
    await trigger.click(); app.release(); await page.waitForTimeout(80);
    await expect(page.getByRole('region', { name: 'Command output', exact: true })).toBeHidden();
    expect((await page.locator('.chat-history-detail-inline').allTextContents()).join('')).not.toContain(publicOutput.slice(0, 16000));
    await trigger.click();
    await expect(page.getByRole('region', { name: 'Command output', exact: true }).getByLabel('Command output', { exact: true })).toHaveText(publicOutput.slice(0, 16000));
    expect(app.calls.filter(call => call.searchParams.get('field') === 'output')).toHaveLength(2);
  } finally { app.release(); }
});

for (const scope of ['thread', 'workspace'] as const) test('pending inline output stays scoped after a ' + scope + ' change', async ({ page }) => {
  const app = await fixture(page); app.hold('output');
  try {
    await page.getByRole('button', { name: /Ran command/ }).click(); await expect.poll(() => app.controls.held).toBe(true);
    await app.switch(scope); app.release();
    await expect(page.getByRole('button', { name: /Ran command/ })).toHaveAttribute('aria-expanded', 'false');
    await page.waitForTimeout(80);
    await expect(page.getByRole('region', { name: 'Command output', exact: true })).toHaveCount(0);
    expect(app.calls).toHaveLength(2);
    await app.switch('native');
    await expect(page.getByRole('button', { name: /Ran command/ })).toHaveAttribute('aria-expanded', 'false');
  } finally { app.release(); }
});

test('session lock closes inline output and rejects late content through unlock', async ({ page }) => {
  const app = await fixture(page); app.hold('output');
  try {
    await page.getByRole('button', { name: /Ran command/ }).click(); await expect.poll(() => app.controls.held).toBe(true);
    await page.evaluate(() => { document.body.dataset.workspaceLocked = 'true'; window.dispatchEvent(new Event('codex:session-expired')); });
    await expect(page.getByRole('button', { name: /Ran command/ })).toHaveAttribute('aria-expanded', 'false');
    app.release();
    await page.evaluate(() => { document.body.dataset.workspaceLocked = 'false'; window.dispatchEvent(new Event('codex:session-unlocked')); });
    await page.waitForTimeout(80);
    expect((await page.locator('.chat-history-detail-inline').allTextContents()).join('').includes('Readable command output.')).toBe(false);
    expect(app.calls).toHaveLength(2);
  } finally { app.release(); }
});

test('new output leaves the current page stable and offers an inline refresh', async ({ page }) => {
  const app = await fixture(page);
  await page.getByRole('button', { name: /Ran command/ }).click();
  const output = page.getByRole('region', { name: 'Command output', exact: true });
  await expect(output.getByLabel('Command output', { exact: true })).toHaveText(publicOutput.slice(0, 16000));
  const originalVersion = app.calls.length;
  app.fields.set(itemCommand + ':output', [{ label: 'Command output', text: publicOutput + 'Latest real output.' }]);
  await page.evaluate(() => (window as unknown as { replaceOutputFixture: (output: string) => void }).replaceOutputFixture('Latest public output preview.'));
  await expect(output).toContainText('Newer content is available.');
  await expect(output.getByLabel('Command output', { exact: true })).toHaveText(publicOutput.slice(0, 16000));
  expect(app.calls).toHaveLength(originalVersion);
  await output.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(output).not.toContainText('Newer content is available.');
  await expect.poll(() => app.calls.length).toBe(originalVersion + 1);
  await expect(output.getByLabel('Command output', { exact: true })).toHaveText(publicOutput.slice(0, 16000));
  expect(app.calls.at(-1)!.searchParams.has('version')).toBe(false);
});

test('native search advances only through explicit bounded continuation', async ({ page }) => {
  const app = await fixture(page, 'search');
  expect(app.calls).toHaveLength(0);
  await page.getByRole('button', { name: /Ran command/ }).click();
  const output = page.getByRole('region', { name: 'Command output', exact: true });
  const reads = () => app.calls.filter(call => call.searchParams.get('field') === 'output');
  await expect(output.getByRole('button', { name: 'Continue search', exact: true })).toBeVisible();
  await page.waitForTimeout(120); expect(reads()).toHaveLength(1);
  await output.getByRole('button', { name: 'Continue search', exact: true }).click();
  await expect.poll(() => reads().length).toBe(2);
  await page.waitForTimeout(100); expect(reads()).toHaveLength(2);
  await output.getByRole('button', { name: 'Continue search', exact: true }).click();
  await expect(output.getByLabel('Command output', { exact: true })).toHaveText(publicOutput.slice(0, 16000));
  expect(reads().map(call => call.searchParams.get('cursor'))).toEqual([null, 'native-search-one', 'native-search-two']);
  await output.getByRole('button', { name: 'Next section', exact: true }).click();
  await expect(output.getByLabel('Command output', { exact: true })).toHaveText(publicOutput.slice(16000, 32000));
  expect(app.calls.at(-1)!.searchParams.get('cursor')).toBe('native-search-two');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('native command and summary readers retain their fields while file changes open the exact editor target', async ({ page }) => {
  const app = await fixture(page);
  await page.getByRole('button', { name: /Ran command/ }).click();
  const command = page.getByRole('region', { name: 'Command', exact: true });
  await expect(command.getByLabel('Command', { exact: true })).toHaveText('printf native-public-command');
  await command.getByRole('combobox', { name: 'Content section', exact: true }).click();
  await page.getByRole('option', { name: 'Working directory', exact: true }).click();
  await expect(command.getByLabel('Working directory', { exact: true })).toHaveText('/data/workspaces/inspection');
  expect(app.calls.at(-1)!.searchParams.get('part')).toBe('1');
  const readsBeforeReview = app.calls.length;
  await page.getByRole('button', { name: 'Open changes', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { openedChangeTarget: unknown }).openedChangeTarget)).toEqual({
    source: 'native-item', workspaceId, threadId, turnId, itemId: itemPatch,
  });
  await expect(page.getByRole('region', { name: 'File changes', exact: true })).toHaveCount(0);
  expect(app.calls).toHaveLength(readsBeforeReview);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Inspect full public reasoning summary', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Full public reasoning summary', exact: true });
  await expect(dialog.getByLabel('Public summary 1', { exact: true })).toHaveText('Public reasoning summary, first part.');
  expect(app.calls.at(-1)!.searchParams.get('field')).toBe('text'); expect(app.calls.at(-1)!.searchParams.get('itemId')).toBe(itemReasoning);
  expect(app.calls.some(call => /history\/detail|epoch=/.test(call.href))).toBe(false);
});

test('a changed source clears the old section and requires explicit restart', async ({ page }) => {
  const app = await fixture(page, 'changed');
  await page.getByRole('button', { name: 'Inspect full response', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Full response', exact: true });
  await expect(dialog.getByLabel('Agent text', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Next section', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Native content changed');
  await expect(dialog.getByLabel('Agent text', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Copy this section', exact: true })).toHaveCount(0);
  expect(app.calls).toHaveLength(2); app.controls.changed = false;
  await dialog.getByRole('button', { name: 'Restart from beginning', exact: true }).click();
  await expect(dialog.getByLabel('Agent text', { exact: true })).toHaveText('A'.repeat(15999));
  expect(app.calls.at(-1)!.searchParams.has('version')).toBe(false); expect(app.calls.at(-1)!.searchParams.has('cursor')).toBe(false);
});

for (const behavior of ['wrongIdentity', 'protocolFields', 'oversized', 'invalidRange'] as const) test('invalid native reply is visible without retaining content: ' + behavior, async ({ page }) => {
  await fixture(page, behavior);
  await page.getByRole('button', { name: 'Inspect full response', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Full response', exact: true });
  await expect(dialog.getByRole('alert')).toContainText('could not be verified');
  await expect(dialog).not.toContainText('MUST_NOT_DISPLAY');
  await expect(dialog.getByRole('button', { name: 'Copy this section', exact: true })).toHaveCount(0);
  expect(await page.content()).not.toContain('data:image/png;base64,MUST_NOT_DISPLAY');
});

for (const behavior of ['unavailable', 'notFound'] as const) test('native absence is reported honestly: ' + behavior, async ({ page }) => {
  const app = await fixture(page, behavior);
  await page.getByRole('button', { name: 'Inspect full response', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Full response', exact: true });
  await expect(dialog).toContainText(behavior === 'unavailable' ? 'No public content for this field' : 'Native item not found');
  await page.waitForTimeout(100); expect(app.calls).toHaveLength(1);
  await expect(dialog.getByRole('button', { name: 'Next section', exact: true })).toBeDisabled();
});

for (const scope of ['thread', 'workspace'] as const) test('late native detail content cannot cross a ' + scope + ' change', async ({ page }) => {
  const app = await fixture(page); app.hold();
  try {
    await page.getByRole('button', { name: 'Inspect full response', exact: true }).click();
    await expect.poll(() => app.controls.held).toBe(true);
    await app.switch(scope);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    app.release(); await page.waitForTimeout(80);
    await expect(page.getByText('A'.repeat(15999), { exact: true })).toHaveCount(0);
    await app.switch('native'); await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally { app.release(); }
});

test('session lock closes inspection and discards an unabortable late read', async ({ page }) => {
  const app = await fixture(page); app.hold();
  try {
    await page.getByRole('button', { name: 'Inspect full response', exact: true }).click();
    await expect.poll(() => app.controls.held).toBe(true);
    await page.evaluate(() => { document.body.dataset.workspaceLocked = 'true'; window.dispatchEvent(new Event('codex:session-expired')); });
    await expect(page.getByRole('dialog')).toHaveCount(0); app.release();
    await page.evaluate(() => { document.body.dataset.workspaceLocked = 'false'; window.dispatchEvent(new Event('codex:session-unlocked')); });
    await expect(page.getByRole('dialog')).toHaveCount(0); expect(app.calls).toHaveLength(1);
  } finally { app.release(); }
});

test('legacy inspection retains the saved history route and epoch contract', async ({ page }) => {
  const app = await fixture(page);
  await page.getByRole('button', { name: 'Show legacy', exact: true }).click();
  await page.getByRole('button', { name: 'Inspect full response', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Full response', exact: true });
  await expect(dialog.getByLabel('Full response section', { exact: true })).toContainText('Legacy saved public content.');
  expect(app.calls).toHaveLength(1); expect(app.calls[0].pathname.endsWith('/history/detail')).toBe(true);
});

test('native detail remains readable on a phone without shadows or motion', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await fixture(page);
  const trigger = page.getByRole('button', { name: /Ran command/ });
  await trigger.click();
  const output = page.getByRole('region', { name: 'Command output', exact: true });
  await expect(output.getByLabel('Command output', { exact: true })).toBeVisible();
  const bounds = (await output.boundingBox())!; expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(375);
  for (const button of [trigger, output.getByRole('button', { name: 'Copy this section', exact: true }), output.getByRole('button', { name: 'Next section', exact: true }), output.getByRole('button', { name: 'Previous section', exact: true })]) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  const surfaces = await output.locator('*').evaluateAll(elements => elements.map(element => ({ shadow: getComputedStyle(element).boxShadow, backdrop: getComputedStyle(element).backdropFilter })));
  expect(surfaces.every(surface => surface.shadow === 'none' && surface.backdrop === 'none')).toBe(true);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('inline-output-phone.png'), fullPage: true });
});
