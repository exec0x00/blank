import { expect, test, type Page, type Route } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ThreadSummary } from '../../shared/types';

// Explicit saved-conversation fixtures. No CLI, model or user storage is touched.
const firstWorkspace = '11111111-1111-4111-8111-111111111111';
const secondWorkspace = '22222222-2222-4222-8222-222222222222';
const idFor = (index: number, second = false) => `${second ? '0299' : '0199'}a111-1111-7111-8111-${index.toString().padStart(12, '0')}`;
const startedAt = new Date();
const summary = (index: number, patch: Partial<ThreadSummary> = {}): ThreadSummary => {
  const timestamp = new Date(startedAt.getTime() - index * 4 * 60 * 60 * 1000).toISOString();
  return { id: idFor(index), workspaceId: firstWorkspace, title: index === 89 ? 'Quasar search fixture' : index === 8
    ? 'A deliberately long conversation title that stays readable when the conversation picker is narrow' : `Saved conversation ${index.toString().padStart(3, '0')}`,
    status: index === 2 ? 'running' : index === 4 ? 'awaiting_input' : 'idle', backend: 'codex-cli', createdAt: timestamp, updatedAt: timestamp, ...patch };
};
const current = summary(0), secondCurrent = summary(0, { id: idFor(0, true), workspaceId: secondWorkspace, title: 'Second workspace conversation' });
const records: ThreadSummary[] = [
  ...Array.from({ length: 400 }, (_, index) => summary(index)),
  ...Array.from({ length: 3 }, (_, index) => summary(600 + index, { title: `Archived fixture ${index}`, archivedAt: startedAt.toISOString() })),
  summary(700, { id: 'thr_preserved_fixture', title: 'Preserved fixture conversation', backend: 'legacy', readOnly: true, status: 'running' }),
  secondCurrent,
];
let server: Server, origin: string;

test.beforeAll(async () => {
  const result = await build({ stdin: { loader: 'tsx', resolveDir: process.cwd(), sourcefile: 'conversation-navigation-harness.tsx', contents: [
    "import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';",
    "import {ConversationHeader} from './client/components/chat/ConversationHeader';",
    "import {ConversationHistory} from './client/components/chat/ConversationHistory';",
    "import {ContextIndicator} from './client/components/chat/ContextControls';",
    "import {useThreadCatalog} from './client/components/chat/useThreadCatalog';",
    "import {DropdownMenu} from './client/components/ui/Dropdown'; import {Plus, MoreHorizontal, ExternalLink} from 'lucide-react';",
    "import './client/styles.css'; import './client/components/chat.css';",
    `const initial = ${JSON.stringify(current)}, second = ${JSON.stringify(secondCurrent)};`,
    'function Harness(){',
    'const [workspaceId,setWorkspaceId] = useState(initial.workspaceId), [selected,setSelected] = useState(initial);',
    'const [open,setOpen] = useState(false), [query,setQuery] = useState(""), [backend,setBackend] = useState("codex-cli"), [visibility,setVisibility] = useState("active");',
    'const [headerTitle,setHeaderTitle] = useState(null), [tokenUsage,setTokenUsage] = useState(null), [compacting,setCompacting] = useState(false);',
    'const catalog=useThreadCatalog({workspaceId,selectedId:selected?.id??null,open,locked:false,query,backend,archived:visibility});',
    'const create=()=>{setSelected(null);setOpen(false);};',
    'window.conversationFixture={switchWorkspace(){setWorkspaceId(second.workspaceId);setSelected(second);setQuery("");setBackend("codex-cli");setVisibility("active");},setHeaderFixture(value){setHeaderTitle(value.title??null);setTokenUsage(value.usage??null);setCompacting(!!value.compacting);}};',
    'return <main className="chat-panel" data-resident-count={catalog.items.length} data-selected={selected?.id??""}>',
    '<ConversationHeader title={headerTitle??selected?.title??"New conversation"} detail={selected?"Conversation":"Unsent draft"} historyOpen={open} onBrowse={()=>{setOpen(true);setQuery("");}}>',
    '<ContextIndicator tokenUsage={tokenUsage} compacting={compacting} onClick={()=>{document.body.dataset.contextOpened="true";}}/>',
    '<a className="icon-button chat-window-link" href="#fixture" aria-label="Open agent in new window"><ExternalLink size={15}/></a>',
    '<button className="icon-button chat-new-thread" aria-label="New conversation" onClick={create}><Plus size={18}/></button>',
    '<DropdownMenu aria-label="Conversation actions" trigger={<button className="icon-button" aria-label="Conversation actions"><MoreHorizontal size={17}/></button>} items={[{id:"fixture",label:"Fixture action",onSelect(){}}]}/>',
    '</ConversationHeader><p className="fixture-label">Conversation navigation browser fixture</p>',
    '<ConversationHistory open={open} onClose={()=>setOpen(false)} workspaceId={workspaceId} workspaceName={workspaceId===initial.workspaceId?"Navigation fixture workspace":"Second fixture workspace"}',
    'selectedId={selected?.id??null} selectedThread={selected} query={query} backend={backend} visibility={visibility} catalog={catalog} createDisabled={false} creating={false}',
    'onSelect={id=>{setSelected(catalog.items.find(item=>item.id===id)??selected);setOpen(false);}} onCreate={create}',
    'onBackendChange={value=>{setBackend(value);setQuery("");}} onVisibilityChange={setVisibility} onQueryChange={setQuery}/></main>}',
    'createRoot(document.getElementById("root")).render(<React.StrictMode><Harness/></React.StrictMode>);',
  ].join('\n') }, bundle: true, write: false, format: 'esm', platform: 'browser', outfile: '/tmp/codex-conversation-navigation-fixture.js', logLevel: 'silent' });
  const script = result.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  const styles = result.outputFiles.find(file => file.path.endsWith('.css'))!.text;
  server = createServer((request, response) => {
    if (request.url === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(script); }
    else if (request.url === '/fixture.css') { response.setHeader('Content-Type', 'text/css'); response.end(styles); }
    else { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>html,body,#root{height:100%;width:100%;margin:0}#root{max-width:960px;margin:auto}.fixture-label{margin:40px auto;color:var(--muted);font-size:14px}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
});
test.afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });

async function mount(page: Page, options: { failFirst?: boolean } = {}) {
  const errors: string[] = [], requests: URLSearchParams[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const controls = { fail: !!options.failFirst, slow: null as { route: Route; release: () => Promise<void> } | null };
  await page.route('**/api/threads?**', async route => {
    const params = new URL(route.request().url()).searchParams;
    requests.push(params);
    expect(params.get('limit')).toBe('40');
    if (controls.fail) { controls.fail = false; return route.fulfill({ status: 503, json: { error: 'The fixture conversation service is unavailable.' } }); }
    const query = params.get('query')?.toLowerCase() ?? '';
    const filtered = records.filter(item => item.workspaceId === params.get('workspaceId') && item.backend === params.get('backend')
      && !!item.archivedAt === (params.get('archived') === 'archived') && (!query || item.title.toLowerCase().includes(query)));
    const cursor = params.get('before') ?? params.get('after');
    const start = cursor ? Number(cursor.slice('fixture-page-'.length)) : 0;
    const items = filtered.slice(start, start + 40);
    const payload = { items, olderCursor: start + 40 < filtered.length ? `fixture-page-${start + 40}` : null, newerCursor: start > 0 ? `fixture-page-${Math.max(0, start - 40)}` : null,
      hasOlder: start + 40 < filtered.length, hasNewer: start > 0, selected: filtered.find(item => item.id === params.get('selectedId')) };
    if (query === 'slow') {
      controls.slow = { route, release: async () => { try { await route.fulfill({ json: { ...payload, items: [summary(900, { title: 'Slow stale fixture' })] } }); } catch { /* An aborted browser search can finish after it is superseded. */ } } };
      return;
    }
    return route.fulfill({ json: payload });
  });
  await page.goto(origin);
  const trigger = page.getByRole('button', { name: 'Conversation history', exact: true });
  await expect(trigger).toBeVisible();
  const dialog = page.getByRole('dialog', { name: 'Conversations', exact: true });
  return { errors, requests, controls, trigger, dialog, list: page.getByRole('list', { name: 'Saved conversations', exact: true }) };
}

test('opens with search focus, restores focus, and moves through offscreen conversation rows with the keyboard', async ({ page }, testInfo) => {
  const app = await mount(page);
  await app.trigger.click();
  const search = app.dialog.getByRole('searchbox', { name: 'Search conversations', exact: true });
  await expect(search).toBeFocused();
  const first = app.dialog.locator(`[data-conversation-id="${idFor(0)}"]`);
  await expect(first).toHaveAttribute('aria-current', 'true');
  await expect(first).toContainText('Current');
  await expect(app.dialog.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('history-desktop.png') });
  await search.press('ArrowDown');
  await expect(first).toBeFocused();
  await first.press('End');
  await expect(app.dialog.locator(`[data-conversation-id="${idFor(39)}"]`)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(first).toBeFocused();
  await page.keyboard.press('ArrowDown');
  const second = app.dialog.locator(`[data-conversation-id="${idFor(1)}"]`);
  await expect(second).toBeFocused();
  await second.press('Enter');
  await expect(app.dialog).toBeHidden();
  await expect(app.trigger).toBeFocused();
  await expect(app.trigger).toHaveAttribute('aria-description', 'Saved conversation 001');
  await app.trigger.press('Enter');
  await expect(search).toBeFocused();
  await app.dialog.getByRole('combobox', { name: 'Conversation source', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(app.dialog).toBeVisible();
  await expect(app.dialog.getByRole('combobox', { name: 'Conversation source', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(app.dialog).toBeHidden();
  await expect(app.trigger).toBeFocused();
  expect(app.errors).toEqual([]);
});

test('searches the server catalog, rejects stale responses, and keeps preserved and archived history distinct', async ({ page }) => {
  const app = await mount(page);
  await app.trigger.click();
  const search = app.dialog.getByRole('searchbox', { name: 'Search conversations', exact: true });
  await search.fill('slow');
  await expect.poll(() => !!app.controls.slow).toBe(true);
  await search.fill('quasar');
  await expect(app.dialog.getByRole('button', { name: /Quasar search fixture/ })).toBeVisible();
  await app.controls.slow!.release();
  await expect(app.dialog).not.toContainText('Slow stale fixture');
  expect(app.requests.some(params => params.get('query') === 'quasar')).toBe(true);
  await search.fill('nothing matches this fixture');
  await expect(app.dialog.getByText('No matching conversations', { exact: true })).toBeVisible();
  await app.dialog.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await app.dialog.getByRole('button', { name: 'Archived', exact: true }).click();
  await expect(app.dialog.getByRole('button', { name: 'Archived', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(app.dialog.getByRole('button', { name: /Archived fixture 0/ })).toBeVisible();
  await expect(app.dialog).not.toContainText('Saved conversation 000');
  await app.dialog.getByRole('button', { name: 'Active', exact: true }).click();
  await app.dialog.getByRole('combobox', { name: 'Conversation source', exact: true }).click();
  await page.getByRole('option', { name: 'Preserved history Read only', exact: true }).click();
  await expect(app.dialog.getByRole('button', { name: /Preserved fixture conversation/ })).toContainText('Read only');
  await expect(app.dialog.getByRole('button', { name: /Preserved fixture conversation/ })).not.toContainText('Working');
  expect(app.requests.some(params => params.get('backend') === 'legacy')).toBe(true);
  expect(app.requests.every(params => params.get('archived') !== 'all')).toBe(true);
  expect(app.errors).toEqual([]);
});

test('retains a bounded catalog and mounted rows during paging while preserving keyboard focus', async ({ page }) => {
  const app = await mount(page);
  await app.trigger.click();
  await expect(app.dialog.locator('[data-conversation-id]').first()).toBeVisible();
  const resident = () => page.locator('main').getAttribute('data-resident-count').then(Number);
  await expect.poll(resident).toBe(40);
  for (let pageIndex = 1; pageIndex <= 6; pageIndex++) {
    await app.list.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => app.requests.some(params => params.get('before') === `fixture-page-${pageIndex * 40}`)).toBe(true);
    await expect.poll(resident).toBe(Math.min(120, (pageIndex + 1) * 40));
    expect(await app.dialog.locator('[data-conversation-id]').count()).toBeLessThan(32);
  }
  const focusId = await app.dialog.locator('[data-conversation-id]').last().getAttribute('data-conversation-id');
  const focus = app.dialog.locator(`[data-conversation-id="${focusId}"]`);
  await focus.focus();
  await expect(focus).toBeFocused();
  await app.list.evaluate(element => { element.scrollTop -= 140; });
  await expect(app.dialog.locator(`[data-conversation-id="${focusId}"]`)).toBeFocused();
  await app.list.evaluate(element => { element.scrollTop = 0; });
  await expect.poll(() => app.requests.some(params => !!params.get('after'))).toBe(true);
  await expect(app.dialog.locator(`[data-conversation-id="${focusId}"]`)).toBeFocused();
  expect(await resident()).toBeLessThanOrEqual(240);
  expect(app.errors).toEqual([]);
});

test('shows recoverable list failures and rejects an old workspace response', async ({ page }) => {
  const app = await mount(page, { failFirst: true });
  await app.trigger.click();
  await expect(app.dialog.getByRole('alert')).toContainText('The fixture conversation service is unavailable.');
  await app.dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(app.dialog.locator('[data-conversation-id]').first()).toBeVisible();
  await expect(app.dialog.getByRole('alert')).toHaveCount(0);
  await app.dialog.getByRole('searchbox', { name: 'Search conversations', exact: true }).fill('slow');
  await expect.poll(() => !!app.controls.slow).toBe(true);
  await page.evaluate(() => (window as unknown as { conversationFixture: { switchWorkspace(): void } }).conversationFixture.switchWorkspace());
  await expect(app.dialog).toContainText('Second fixture workspace');
  await expect(app.dialog.getByRole('button', { name: /Second workspace conversation/ })).toBeVisible();
  await app.controls.slow!.release();
  await expect(app.dialog).not.toContainText('Slow stale fixture');
  await expect(app.dialog.locator('[data-conversation-id]')).toHaveCount(1);
  expect(app.errors).toEqual([]);
});

test('fits a phone viewport with 44px controls, readable titles, and a top new-conversation action', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const app = await mount(page);
  await app.trigger.click();
  await expect(app.dialog).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('history-phone.png') });
  const bounds = await app.dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  for (const button of [app.dialog.getByRole('button', { name: 'New conversation', exact: true }), app.dialog.getByRole('button', { name: 'Active', exact: true }),
    app.dialog.getByRole('button', { name: 'Archived', exact: true }), app.dialog.getByRole('button', { name: 'Close dialog', exact: true })]) {
    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(43.99);
    expect(box!.width).toBeGreaterThanOrEqual(43.99);
  }
  const search = app.dialog.getByRole('searchbox', { name: 'Search conversations', exact: true });
  await search.fill('deliberately long');
  const clear = await app.dialog.getByRole('button', { name: 'Clear conversation search', exact: true }).boundingBox();
  expect(clear!.width).toBeGreaterThanOrEqual(43.99);
  expect(clear!.height).toBeGreaterThanOrEqual(43.99);
  const row = app.dialog.getByRole('button', { name: /A deliberately long conversation title/ });
  await expect(row).toBeVisible();
  const overflow = await row.evaluate(element => element.scrollWidth > element.clientWidth);
  expect(overflow).toBe(false);
  await app.dialog.getByRole('button', { name: 'New conversation', exact: true }).click();
  await expect(app.dialog).toBeHidden();
  await expect(app.trigger).toHaveAttribute('aria-description', 'New conversation');
  expect(app.errors).toEqual([]);
});

test('compact headers truncate a single-line title while preserving context access and reported values', async ({ page }, testInfo) => {
  const app = await mount(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const title = 'Build a playful dashboard with interactive previews';
  const context = page.getByRole('button', { name: 'Context and usage', exact: true });
  const setContext = async (count: number | null, compacting = false) => page.evaluate(({ title, count, compacting }) => {
    const usage = count === null ? null : { contextTokens: count, modelContextWindow: 1_050_000, reportedAt: '2026-09-30T12:00:00.000Z',
      total: { totalTokens: count, inputTokens: count, outputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, reasoningOutputTokens: 0 } };
    (window as unknown as { conversationFixture: { setHeaderFixture(value: unknown): void } }).conversationFixture.setHeaderFixture({ title, usage, compacting });
  }, { title, count, compacting });
  const metrics: Array<Record<string, unknown>> = [];
  for (const paneWidth of [390, 481, 960]) {
    await page.setViewportSize({ width: paneWidth === 390 ? 390 : 1440, height: paneWidth === 390 ? 844 : 960 });
    await page.locator('#root').evaluate((element, width) => { element.style.width = `${width}px`; }, paneWidth);
    await setContext(null);
    await expect(app.trigger).toHaveAttribute('aria-description', title);
    await expect(context).toHaveAttribute('data-reported', 'false');
    await expect(context).toHaveAccessibleDescription(/Codex has not reported the current context/);
    await expect(context).toHaveAttribute('data-tooltip', /Codex has not reported the current context/);
    const compact = paneWidth <= 520;
    if (compact) {
      await expect(context.locator('span')).toBeHidden();
      await expect(context.locator('small')).toBeHidden();
      await expect(app.trigger.locator('.chat-header-context > span')).toBeHidden();
    } else {
      await expect(context.locator('span')).toHaveText('Context');
      await expect(context.locator('span')).toBeVisible();
      await expect(context.locator('small')).toBeVisible();
      await expect(app.trigger.locator('.chat-header-context > span')).toBeVisible();
    }
    const titleBox = await app.trigger.locator('strong').boundingBox(), contextBox = await context.boundingBox();
    expect(titleBox!.width).toBeGreaterThanOrEqual(paneWidth === 390 ? 150 : paneWidth === 481 ? 225 : 500);
    const headerBox = await page.locator('.conversation-header').boundingBox();
    expect(headerBox!.height).toBe(paneWidth === 390 ? 52 : 44);
    if (compact) {
      expect(titleBox!.height).toBeLessThanOrEqual(20);
      expect(contextBox!.width).toBe(paneWidth === 390 ? 44 : 32);
      expect(contextBox!.height).toBe(paneWidth === 390 ? 44 : 32);
    }
    await context.click();
    await expect(page.locator('body')).toHaveAttribute('data-context-opened', 'true');
    if (paneWidth === 390) for (const action of [page.getByRole('link', { name: 'Open agent in new window', exact: true }), page.getByRole('button', { name: 'New conversation', exact: true }),
      page.getByRole('button', { name: 'Conversation actions', exact: true })]) {
      const box = await action.boundingBox(); expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    metrics.push({ paneWidth, unknownTitleWidth: titleBox!.width, unknownTitleHeight: titleBox!.height, contextWidth: contextBox!.width });
    await page.screenshot({ path: testInfo.outputPath(`compact-header-${paneWidth}.png`), animations: 'disabled' });
    await setContext(8192);
    await expect(context).toHaveAttribute('data-reported', 'true');
    await expect(context.locator('small')).toBeVisible();
    await expect(context.locator('small')).toHaveText('8.19K / 1.05M');
    await expect(context).toHaveAccessibleDescription(/Last reported context: 8,192 tokens/);
    expect(await context.locator('small').evaluate(element => getComputedStyle(element).fontSize)).toBe('12px');
    expect(await app.trigger.locator('strong').evaluate(element => getComputedStyle(element).whiteSpace)).toBe('nowrap');
    expect(await app.trigger.locator('strong').evaluate(element => getComputedStyle(element).textOverflow)).toBe('ellipsis');
    await setContext(0);
    await expect(context).toHaveAttribute('data-reported', 'true');
    await expect(context.locator('small')).toHaveText('0 / 1.05M');
    await expect(context.locator('small')).toBeVisible();
    await setContext(8192, true);
    await expect(context).toHaveAttribute('aria-busy', 'true');
    await expect(context).toBeEnabled();
  }
  await testInfo.attach('compact-header-metrics', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
  expect(app.errors).toEqual([]);
});
