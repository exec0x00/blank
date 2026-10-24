import { expect, test, type Locator, type Page } from '@playwright/test';
import type { AppSettings, Bootstrap, CodexModel, CodexModelCatalog, CodexRuntimeStatus, Thread, ThreadListPage, Workspace } from '../../shared/types';
import { browserLaunchOptions } from '../browser-launch';

// Playwright hides native scrollbar painting by default. These checks must see
// the same real thumbs and reserved widths as the user, including xterm's pane.
test.use({ launchOptions: { ...browserLaunchOptions(), ignoreDefaultArgs: ['--hide-scrollbars'] } });

const headers = { 'X-Codex-Workspace': '1' };
const password = process.env.PLAYWRIGHT_PASSWORD || 'browser-test-workspace-password';
const source = Array.from({ length: 500 }, (_, index) => `line ${String(index + 1).padStart(3, '0')}: ${'Scrollable source content. '.repeat(9)}`).join('\n');

/** Only native presentation metadata is controlled here. The synthetic catalog
 * provides overflow rows; it is not a claim of provider model availability, and
 * no CLI process, model discovery, update or inference request is started. */
async function nativeMetadata(page: Page) {
  const stamp = '2026-09-22T12:00:00.000Z';
  const runtime: CodexRuntimeStatus = { backend: 'codex-cli', state: 'ready', version: '0.155.1', installedVersion: '0.155.1',
    startedAt: stamp, updatedAt: stamp, canUpdate: true, updateBlockedReason: null, error: null, activeTurns: 0,
    capabilities: { conversations: true, pagination: true, queue: true, goals: true, skills: true, plan: true, review: true, historyRevert: true } };
  const rows: CodexModel[] = Array.from({ length: 40 }, (_, index) => ({
    id: `scrollbar-catalog-${index}`, model: `scrollbar-wire-${index}`, displayName: `Scrollbar fixture ${String(index + 1).padStart(2, '0')}`,
    description: 'Controlled metadata for dropdown overflow.', hidden: false, isDefault: index === 0, inputModalities: ['text'],
    defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Medium' }],
  }));
  const catalog: CodexModelCatalog = { backend: 'codex-cli', connected: true, models: rows.map(row => row.model), catalog: rows };
  const requests: Array<{ method: string; path: string }> = [];
  await page.route(url => ['/api/bootstrap', '/api/settings', '/api/models'].includes(url.pathname) || url.pathname.startsWith('/api/codex/') || url.pathname.startsWith('/api/threads'), async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && (path === '/api/bootstrap' || path === '/api/settings')) {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      const value = await response.json() as Bootstrap | AppSettings;
      const settings = path === '/api/bootstrap' ? (value as Bootstrap).settings : value as AppSettings;
      // The stopped test CLI cannot supply this ready catalog. Keep its paired
      // presentation metadata consistent so startup polling does not reload
      // Settings and intentionally disable/close the selector during a scroll.
      Object.assign(settings, { agentConfigured: true, model: rows[0].model, reasoningEffort: 'medium' });
      return route.fulfill({ response, json: value });
    }
    requests.push({ method: request.method(), path });
    if (request.method() === 'GET' && path === '/api/models') return route.fulfill({ json: catalog });
    if (request.method() === 'GET' && path === '/api/codex/runtime') return route.fulfill({ json: runtime });
    if (request.method() === 'GET' && path === '/api/threads') return route.fulfill({ json: { items: [], olderCursor: null, newerCursor: null, hasOlder: false, hasNewer: false } satisfies ThreadListPage });
    return route.fulfill({ status: 409, json: { error: 'Native execution is not part of this scrollbar metadata fixture.' } });
  });
  return requests;
}

async function prepare(page: Page, fileCount = 1) {
  expect((await page.request.post('/api/session', { headers, data: { password } })).status()).toBe(200);
  const created = await page.request.post('/api/workspaces', { headers, data: { name: `Scrollbar checks ${Date.now()}`, initializeGit: false } });
  expect(created.status()).toBe(201);
  const workspace = await created.json() as Workspace;
  const createFile = async (index: number) => {
    const path = index === 0 ? 'scroll-source.txt' : `visible-file-${String(index).padStart(3, '0')}.txt`;
    expect((await page.request.post(`/api/workspaces/${workspace.id}/files`, { headers, data: { path, kind: 'file' } })).status()).toBe(201);
  };
  for (let offset = 0; offset < fileCount; offset += 4) {
    await Promise.all(Array.from({ length: Math.min(4, fileCount - offset) }, (_, index) => createFile(offset + index)));
  }
  expect((await page.request.put(`/api/workspaces/${workspace.id}/file`, { headers, data: { path: 'scroll-source.txt', content: source } })).ok()).toBe(true);
  expect((await page.request.patch(`/api/workspaces/${workspace.id}`, { headers, data: { active: true } })).ok()).toBe(true);
  const preferences = await (await page.request.get('/api/ui-state')).json();
  const width = page.viewportSize()!.width;
  const profile = width >= 1360 ? 'desktop' : width >= 1000 ? 'laptop' : width >= 680 ? 'tablet' : 'mobile';
  expect((await page.request.patch('/api/ui-state', { headers, data: { revision: preferences.revision, changes: [
    { section: 'layout', profile, key: 'view', value: 'editor' },
    { section: 'layout', profile, key: 'split', value: 'focus' },
    { section: 'editor', key: 'wrap', value: false },
    { section: 'editor', key: 'minimap', value: false },
  ] } })).ok()).toBe(true);
  await page.goto('/work');
  await expect(page.locator('html')).toHaveAttribute('data-scrollbars', 'activity');
  const editor = page.getByRole('region', { name: 'Code editor', exact: true });
  await expect(editor.getByRole('treeitem', { name: 'scroll-source.txt', exact: true })).toBeVisible();
  return { workspace, editor };
}

async function geometry(element: Locator) {
  return element.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height, clientWidth: node.clientWidth, clientHeight: node.clientHeight };
  });
}

async function opacity(element: Locator) {
  return element.evaluate(node => Number(getComputedStyle(node).getPropertyValue('--codex-scrollbar-opacity')));
}

async function nativeIdle(element: Locator) {
  await expect(element).not.toHaveAttribute('data-scroll-active', 'true');
  await expect.poll(() => opacity(element)).toBe(0);
  await expect.poll(() => element.evaluate(node => getComputedStyle(node, '::-webkit-scrollbar-thumb').backgroundColor)).toBe('rgba(133, 133, 133, 0)');
}

async function nativeActive(element: Locator) {
  await expect(element).toHaveAttribute('data-scroll-active', 'true');
  expect(await opacity(element)).toBe(1);
  expect(await element.evaluate(node => getComputedStyle(node, '::-webkit-scrollbar-thumb').backgroundColor)).toBe('rgb(133, 133, 133)');
}

async function noDecorations(element: Locator) {
  expect(await element.evaluate(node => [node, ...node.querySelectorAll('*')].flatMap(child => {
    const style = getComputedStyle(child);
    return style.boxShadow !== 'none' || style.textShadow !== 'none' || style.backdropFilter !== 'none'
      ? [{ element: child.tagName, className: child.getAttribute('class'), boxShadow: style.boxShadow, textShadow: style.textShadow, backdropFilter: style.backdropFilter }] : [];
  }))).toEqual([]);
}

async function openSource(editor: Locator) {
  await editor.getByRole('treeitem', { name: 'scroll-source.txt', exact: true }).click();
  await expect(editor.locator('.monaco-editor textarea.inputarea').first()).toBeVisible();
  return editor.locator('.editor-code-pane .monaco-editor').first();
}

test('native file explorer reveals only its own thumb during real scrolling and fades without changing pane geometry', async ({ page }, testInfo) => {
  const { editor } = await prepare(page, 64);
  const tree = editor.locator('.editor-tree-scroll');
  await expect.poll(() => tree.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await nativeIdle(tree);
  const before = await geometry(tree);
  await tree.hover();
  await page.waitForTimeout(250);
  await nativeIdle(tree);
  await page.mouse.wheel(0, 320);
  await expect.poll(() => tree.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await nativeActive(tree);
  expect(await geometry(tree)).toEqual(before);
  await expect(editor.locator('.editor-sidebar')).not.toHaveAttribute('data-scroll-active', 'true');

  const fade = await tree.evaluate(node => new Promise<{ faded: boolean; settled: boolean }>(resolve => {
    const started = performance.now();
    let faded = false;
    function sample() {
      const opacity = Number(getComputedStyle(node).getPropertyValue('--codex-scrollbar-opacity'));
      if (opacity > 0 && opacity < 1) faded = true;
      if (opacity === 0 && !node.hasAttribute('data-scroll-active')) return resolve({ faded, settled: true });
      if (performance.now() - started > 3_000) return resolve({ faded, settled: false });
      requestAnimationFrame(sample);
    }
    sample();
  }));
  expect(fade).toEqual({ faded: true, settled: true });
  await nativeIdle(tree);
  expect(await geometry(tree)).toEqual(before);
  await noDecorations(editor);
  await testInfo.attach('native-scrollbar-fade', { body: JSON.stringify({ ...fade, before, after: await geometry(tree) }), contentType: 'application/json' });
});

test('keyboard scrolling in a portalled dropdown shows its thumb without activating the underlying dialog', async ({ page }) => {
  const metadataRequests = await nativeMetadata(page);
  await prepare(page);
  await page.keyboard.press('ControlOrMeta+,');
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await dialog.getByRole('combobox', { name: 'Default model', exact: true }).click();
  const menu = page.getByRole('listbox', { name: 'Default model', exact: true });
  await expect(menu).toBeVisible();
  await expect.poll(() => menu.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  const content = dialog.locator('.settings-content');
  // Opening the selector can reveal its trigger in the settings scroller.
  // Measure only subsequent keyboard scrolling inside the separate menu.
  await Promise.all([nativeIdle(menu), nativeIdle(content)]);
  const dialogPosition = await content.evaluate(node => ({ top: node.scrollTop, left: node.scrollLeft }));
  const dialogScrolls = await content.evaluateHandle(node => {
    const activity = { count: 0 };
    node.addEventListener('scroll', event => { if (event.target === node) activity.count++; }, { passive: true });
    return activity;
  });
  const before = await geometry(menu);
  await menu.focus();
  await page.keyboard.press('End');
  await expect.poll(() => menu.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await nativeActive(menu);
  await expect(content).not.toHaveAttribute('data-scroll-active', 'true');
  expect(await geometry(menu)).toEqual(before);
  await nativeIdle(menu);
  expect(await dialogScrolls.evaluate(activity => activity.count)).toBe(0);
  expect(await content.evaluate(node => ({ top: node.scrollTop, left: node.scrollLeft }))).toEqual(dialogPosition);
  await dialogScrolls.dispose();
  await noDecorations(page.locator('.cw-dropdown-surface'));
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Default model', exact: true })).toBeFocused();
  expect(metadataRequests.every(request => request.method === 'GET' && ['/api/models', '/api/codex/runtime', '/api/threads'].includes(request.path))).toBe(true);
});

test('nested conversation and code scroll independently using actual vertical and horizontal input', async ({ page }) => {
  const metadataRequests = await nativeMetadata(page);
  const { workspace } = await prepare(page);
  const time = new Date().toISOString();
  // A saved-transcript fixture supplies enough content; all scrolling below is
  // real browser input in the production conversation and Markdown components.
  const thread: Thread = {
    id: 'thr_scrollbar_preserved_fixture', workspaceId: workspace.id, title: 'Scroll transcript',
    backend: 'legacy', readOnly: true, createdAt: time, updatedAt: time, status: 'idle', agents: [],
    messages: [{
      id: 'scrollbar-saved-message', role: 'assistant', createdAt: time,
      content: `${Array.from({ length: 24 }, (_, index) => `Saved transcript paragraph ${index + 1}.`).join('\n\n')}\n\n\`\`\`text\n${'This is a long saved code example. '.repeat(25)}\n\`\`\`\n\nEnd of saved transcript.`,
    }],
  };
  const threadRequests: Array<{ method: string; path: string }> = [];
  await page.route('**/api/threads**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    threadRequests.push({ method: request.method(), path });
    const json = (value: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    if (request.method() !== 'GET') return route.fulfill({ status: 409, json: { error: 'This preserved transcript is read only.' } });
    if (path === '/api/threads') {
      const { messages: _messages, ...summary } = thread;
      const items = url.searchParams.get('backend') === 'legacy' && url.searchParams.get('workspaceId') === workspace.id ? [summary] : [];
      return json({ items, olderCursor: null, newerCursor: null, hasOlder: false, hasNewer: false } satisfies ThreadListPage);
    }
    if (path === `/api/threads/${thread.id}`) return json(thread);
    if (path === `/api/threads/${thread.id}/agents`) return json([]);
    return route.fulfill({ status: 404, json: { error: 'Unknown preserved transcript route.' } });
  });
  await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('button', { name: 'Agent', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Codex conversation', exact: true });
  await panel.getByRole('button', { name: 'Conversation history', exact: true }).click();
  const history = page.getByRole('dialog', { name: 'Conversations', exact: true });
  await history.getByRole('combobox', { name: 'Conversation source', exact: true }).click();
  await page.getByRole('option', { name: 'Preserved history Read only', exact: true }).click();
  await history.locator('.chat-history-select').filter({ hasText: thread.title }).click();
  await expect(panel.getByText('Preserved conversation · Read only', { exact: true })).toBeVisible();
  await expect(panel.getByRole('textbox', { name: 'Message Codex', exact: true })).toHaveCount(0);
  const conversation = page.locator('.chat-conversation');
  const code = conversation.locator('.chat-code-block pre');
  await expect(code).toBeVisible();
  await code.scrollIntoViewIfNeeded();
  await nativeIdle(conversation);
  await nativeIdle(code);
  expect(await code.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
  const outerPosition = await conversation.evaluate(node => node.scrollTop);
  const before = await geometry(code);
  await code.hover();
  await page.mouse.wheel(350, 0);
  await expect.poll(() => code.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
  await nativeActive(code);
  await expect(conversation).not.toHaveAttribute('data-scroll-active', 'true');
  expect(await conversation.evaluate(node => node.scrollTop)).toBe(outerPosition);
  expect(await geometry(code)).toEqual(before);
  await nativeIdle(code);
  await conversation.hover({ position: { x: 16, y: 70 } });
  await page.mouse.wheel(0, -320);
  await expect.poll(() => conversation.evaluate(node => node.scrollTop)).toBeLessThan(outerPosition);
  await nativeActive(conversation);
  await expect(code).not.toHaveAttribute('data-scroll-active', 'true');
  await nativeIdle(conversation);
  await noDecorations(conversation);
  expect(threadRequests.every(request => request.method === 'GET')).toBe(true);
  expect(threadRequests.some(request => request.path === `/api/threads/${thread.id}/events`)).toBe(false);
  expect(metadataRequests.every(request => request.method === 'GET' && ['/api/models', '/api/codex/runtime', '/api/threads'].includes(request.path))).toBe(true);
});

test('real Monaco scrolling covers primary, split, and diff editors, while idle hover stays hidden and dragging remains usable', async ({ page }) => {
  const { editor } = await prepare(page);
  let monaco = await openSource(editor);
  const bars = (root: Locator) => root.locator('.editor-scrollable > .scrollbar.vertical');
  await expect(bars(monaco)).toHaveCSS('opacity', '0');
  const before = await geometry(monaco);
  await monaco.hover({ position: { x: 140, y: 120 } });
  await page.waitForTimeout(250);
  await expect(bars(monaco)).toHaveCSS('opacity', '0');
  const firstText = await monaco.locator('.view-lines').textContent();
  await page.mouse.wheel(0, 540);
  await expect(monaco).toHaveAttribute('data-scroll-active', 'true');
  await expect(bars(monaco)).toHaveCSS('opacity', '1');
  await expect.poll(() => monaco.locator('.view-lines').textContent()).not.toBe(firstText);
  expect(await geometry(monaco)).toEqual(before);
  await expect(monaco).not.toHaveAttribute('data-scroll-active', 'true');
  await expect(bars(monaco)).toHaveCSS('opacity', '0');

  const slider = bars(monaco).locator(':scope > .slider');
  const handle = await slider.boundingBox();
  expect(handle).toBeTruthy();
  const textBeforeDrag = await monaco.locator('.view-lines').textContent();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2 + 140, { steps: 8 });
  await expect(slider).toHaveClass(/active/);
  await expect.poll(() => monaco.locator('.view-lines').textContent()).not.toBe(textBeforeDrag);
  await page.waitForTimeout(1_150);
  await expect(bars(monaco)).toHaveCSS('opacity', '1');
  await page.mouse.up();
  await expect(bars(monaco)).toHaveCSS('opacity', '0');

  await editor.getByRole('button', { name: 'Split editor', exact: true }).click();
  const second = editor.locator('.editor-second-pane .monaco-editor');
  await expect(second).toBeVisible();
  await expect(bars(second)).toHaveCSS('opacity', '0');
  await second.hover({ position: { x: 140, y: 120 } });
  await page.mouse.wheel(0, 390);
  await expect(second).toHaveAttribute('data-scroll-active', 'true');
  await expect(bars(second)).toHaveCSS('opacity', '1');
  await expect(monaco).not.toHaveAttribute('data-scroll-active', 'true');
  await expect(bars(second)).toHaveCSS('opacity', '0');
  await editor.getByRole('button', { name: 'Close split editor', exact: true }).click();

  await editor.getByRole('button', { name: 'Compare with saved version', exact: true }).click();
  const original = editor.locator('.monaco-diff-editor .editor.original .monaco-editor');
  const modified = editor.locator('.monaco-diff-editor .editor.modified .monaco-editor');
  await expect(original).toBeVisible();
  await expect(modified).toBeVisible();
  for (monaco of [original, modified]) {
    await expect(bars(monaco)).toHaveCSS('opacity', '0');
    await monaco.hover({ position: { x: 140, y: 120 } });
    await page.mouse.wheel(0, 400);
    await expect(monaco).toHaveAttribute('data-scroll-active', 'true');
    await expect(bars(monaco)).toHaveCSS('opacity', '1');
    await expect(bars(monaco)).toHaveCSS('opacity', '0');
  }
  await noDecorations(editor);
});

test('xterm scrollback from a real host command fades at idle and keeps the viewport dimensions', async ({ page }) => {
  await prepare(page);
  await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('button', { name: 'Terminal', exact: true }).click();
  const terminal = page.getByRole('region', { name: 'Terminal sessions and output', exact: true });
  const surface = terminal.locator('.terminal-surface:not([hidden])');
  await expect(surface).toHaveAttribute('data-connection', 'connected');
  await surface.locator('.xterm-helper-textarea').focus();
  await page.keyboard.insertText('node -e \'for(let i=0;i<180;i++) console.log("SCROLL_LINE_"+i); console.log("SCROLL_OUTPUT_READY")\'');
  await page.keyboard.press('Enter');
  await expect(surface.locator('.xterm-rows')).toContainText('SCROLL_OUTPUT_READY');
  const viewport = surface.locator('.xterm-viewport');
  await expect.poll(() => viewport.evaluate(node => node.scrollHeight > node.clientHeight && node.scrollTop > 0)).toBe(true);
  await nativeIdle(viewport);
  const before = await geometry(viewport);
  const bottom = await viewport.evaluate(node => node.scrollTop);
  await surface.locator('.xterm-screen').hover({ position: { x: 160, y: 100 } });
  await page.mouse.wheel(0, -450);
  await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeLessThan(bottom);
  await nativeActive(viewport);
  expect(await geometry(viewport)).toEqual(before);
  await nativeIdle(viewport);
  expect(await geometry(viewport)).toEqual(before);
  await noDecorations(terminal);
});

test('Monaco completion lists reveal a thumb only when their own virtual position changes', async ({ page }) => {
  const { workspace, editor } = await prepare(page);
  const path = 'completion.ts';
  expect((await page.request.post(`/api/workspaces/${workspace.id}/files`, { headers, data: { path, kind: 'file' } })).status()).toBe(201);
  const content = `const values = {\n${Array.from({ length: 60 }, (_, index) => `  value${String(index).padStart(2, '0')}: ${index},`).join('\n')}\n};\nvalues`;
  expect((await page.request.put(`/api/workspaces/${workspace.id}/file`, { headers, data: { path, content } })).ok()).toBe(true);
  await editor.getByRole('button', { name: 'Refresh files', exact: true }).click();
  await editor.getByRole('treeitem', { name: path, exact: true }).click();
  const input = editor.locator('.monaco-editor textarea.inputarea').first();
  await expect(input).toBeVisible();
  await input.focus();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('.');
  const widget = editor.locator('.suggest-widget.visible');
  const list = widget.locator('.monaco-list > .monaco-scrollable-element');
  const bar = list.locator(':scope > .scrollbar.vertical');
  await expect(widget).toBeVisible();
  await expect(bar).toHaveCSS('opacity', '0');
  const before = await geometry(list);
  await widget.hover();
  await page.waitForTimeout(250);
  await expect(bar).toHaveCSS('opacity', '0');
  const topBefore = await list.locator('.monaco-list-rows').evaluate(node => (node as HTMLElement).style.top);
  for (let index = 0; index < 18; index++) await page.keyboard.press('ArrowDown');
  await expect.poll(() => list.locator('.monaco-list-rows').evaluate(node => (node as HTMLElement).style.top)).not.toBe(topBefore);
  await expect(list).toHaveAttribute('data-scroll-active', 'true');
  await expect(bar).toHaveCSS('opacity', '1');
  expect(await geometry(list)).toEqual(before);
  await expect(list).not.toHaveAttribute('data-scroll-active', 'true');
  await expect(bar).toHaveCSS('opacity', '0');
  await page.keyboard.press('Escape');
  await expect(widget).toBeHidden();
  await noDecorations(editor);
});

test.describe('touch and reduced motion', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });

  test('phone explorer still responds to touch and skips the idle fade animation when reduced motion is enabled', async ({ page }) => {
    const { editor } = await prepare(page, 48);
    const tree = editor.locator('.editor-tree-scroll');
    await expect(tree).toBeVisible();
    await nativeIdle(tree);
    const before = await geometry(tree);
    const bounds = await tree.boundingBox();
    expect(bounds).toBeTruthy();
    const touch = await page.context().newCDPSession(page);
    const x = bounds!.x + bounds!.width / 2;
    const y = bounds!.y + Math.min(430, bounds!.height - 50);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let index = 1; index <= 10; index++) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - index * 22 }] });
      await page.waitForTimeout(16);
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => tree.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    await nativeActive(tree);
    expect(await geometry(tree)).toEqual(before);
    await expect(tree).not.toHaveAttribute('data-scroll-active', 'true');
    expect(await tree.evaluate(node => node.getAnimations().length)).toBe(0);
    expect(await opacity(tree)).toBe(0);
    await nativeIdle(tree);
    expect(await geometry(tree)).toEqual(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
