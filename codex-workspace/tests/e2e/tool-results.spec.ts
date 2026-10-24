import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import type { ToolActivity } from '../../shared/types';

interface FixtureProps { activities: ToolActivity[]; paneWidth?: number }
type FixtureWindow = Window & { __toolResultsFixture: { render: (props: FixtureProps) => void; opened: Array<{ path: string; location?: { line: number; column?: number } }>; notifications: string[] }; EXECUTED?: boolean };
const startedAt = '2026-09-19T12:00:00.000Z';
const hash = 'a'.repeat(64);
function record(id: string, name: string, input: unknown, output?: unknown, status: ToolActivity['status'] = 'completed'): ToolActivity {
  return { id, name, input: JSON.stringify(input), ...(output !== undefined ? { output: typeof output === 'string' ? output : JSON.stringify(output) } : {}), status, startedAt, ...(status === 'completed' || status === 'error' ? { completedAt: '2026-09-19T12:00:02.000Z' } : {}) };
}
const command = record('command', 'exec_command', { command: 'npm run check', cwd: '/workspace/project' }, { stdout: 'TypeScript checks passed.\n', stderr: '', running: false, exit_code: 0, chunk_id: 'INTERNAL_CHUNK', wall_time_seconds: 1.2 });
const jsonContent = '{\n  "name": "project",\n  "version": "1.0.0"\n}';
const file = record('file', 'read_file', { path: 'package.json' }, { path: 'package.json', offset: 1, total_lines: 4, content: jsonContent, version: hash, truncated: false });
const search = record('search', 'search_files', { query: 'saveDocument', include: 'client/**/*.ts' }, { matches: [{ path: 'client/editor/save.ts', line: 42, column: 7, text: 'export async function saveDocument(path: string) {' }, { path: 'client/editor/save.test.ts', line: 18, column: 3, text: 'await saveDocument("notes.md");' }], truncated: false });
const plan = record('plan', 'update_plan', { explanation: 'Verify the editor change and its responsive layout.', steps: [{ step: 'Read the affected files', status: 'completed' }, { step: 'Run the focused checks', status: 'in_progress' }, { step: 'Review the mobile layout', status: 'pending' }] }, { explanation: 'Verify the editor change and its responsive layout.', steps: [{ step: 'Read the affected files', status: 'completed' }, { step: 'Run the focused checks', status: 'in_progress' }, { step: 'Review the mobile layout', status: 'pending' }] });
const failure = record('failure', 'exec_command', { command: 'npm run check' }, { stdout: 'Checking source files…', stderr: 'src/editor.ts:42: Cannot find name saveDocument.', exit_code: 2, running: false, review_warnings: ['One oversized file was not captured for review.'] });
let script = '', styles = '';

test.beforeAll(async () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const result = await build({ absWorkingDir: root, stdin: { loader: 'tsx', resolveDir: root, contents: `
    import { createRoot } from 'react-dom/client';
    import './client/styles.css';
    import './client/components/chat.css';
    import './client/scrollbars.css';
    import { installScrollActivity } from './client/scroll-activity';
    import { ActivityCard } from './client/components/chat/ActivityCard';
    const root = createRoot(document.getElementById('root'));
    installScrollActivity();
    const opened = [], notifications = [];
    window.__toolResultsFixture = { opened, notifications, render(props) {
      root.render(<main className="tool-result-fixture" style={{maxWidth: props.paneWidth || 760}} aria-label="Response presentation fixture">
        <p className="fixture-caption">Activity · isolated test records</p>
        <div className="fixture-tools">{props.activities.map(activity => <ActivityCard key={activity.id} activity={activity} workspacePath="/workspace/project" onNotify={message => notifications.push(message)} onOpenFile={(path, location) => opened.push({path, location})} />)}</div>
        <button className="fixture-after" type="button">After activity</button>
      </main>);
    }};
  ` }, bundle: true, write: false, outfile: 'tool-results-fixture.js', format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent' });
  script = result.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  styles = result.outputFiles.find(file => file.path.endsWith('.css'))!.text + '\n#root {overflow:auto;} .tool-result-fixture {width:100%; margin:24px auto; padding:16px;} .fixture-tools {display:flex; flex-direction:column; gap:10px;} .fixture-caption {color:var(--faint); font-size:11px; margin:0 0 16px;} .fixture-after {min-height:44px; margin-top:16px; padding:8px; color:var(--muted);}';
});

async function mount(page: Page, props: FixtureProps) {
  await page.setContent('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: script });
  await update(page, props);
}
async function update(page: Page, props: FixtureProps) { await page.evaluate(value => (window as unknown as FixtureWindow).__toolResultsFixture.render(value), props); }

test('keyboard disclosures reveal true command and JSON file content, and search links open exact editor locations', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await mount(page, { activities: [command, file, search] });
  const toggles = page.locator('.chat-activity-summary');
  await expect(toggles.nth(0)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('TypeScript checks passed.', { exact: true })).toHaveCount(0);
  await toggles.nth(0).focus();
  await page.keyboard.press('Space');
  await expect(toggles.nth(0)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('TypeScript checks passed.', { exact: true })).toBeVisible();
  await expect(page.getByText('/workspace/project', { exact: true })).toBeVisible();
  await toggles.nth(0).press('Enter');
  await expect(page.getByText('TypeScript checks passed.', { exact: true })).toBeHidden();
  await toggles.nth(0).press('Enter');
  await expect(page.getByText('TypeScript checks passed.', { exact: true })).toBeVisible();
  await toggles.nth(1).click();
  await expect(page.locator('pre[aria-label="File content"]')).toHaveText(jsonContent);
  await page.getByRole('button', { name: 'Open package.json', exact: true }).click();
  await toggles.nth(2).click();
  await page.getByRole('button', { name: 'Open client/editor/save.ts at line 42', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).__toolResultsFixture.opened)).toEqual([{ path: 'package.json' }, { path: 'client/editor/save.ts', location: { line: 42, column: 7 } }]);
  expect(await page.locator('body').innerText()).not.toMatch(/INTERNAL_CHUNK|exit_code|total_lines|expected_version|"matches"/);
  expect(await page.locator('body').innerText()).not.toContain(hash);
  expect(errors).toEqual([]);
});

test('streaming updates never flash a protocol envelope, preserve disclosure choice, and reveal later failures', async ({ page }) => {
  const running = { ...command, status: 'running' as const, output: undefined, completedAt: undefined };
  await mount(page, { activities: [running] });
  const toggle = page.locator('.chat-activity-summary');
  await expect(toggle).toContainText('Running');
  await toggle.click();
  await expect(page.getByText('Waiting for output…', { exact: true })).toBeVisible();
  await update(page, { activities: [{ ...running, output: '{' }] });
  expect(await page.locator('.chat-activity-body').innerText()).not.toContain('{');
  await update(page, { activities: [{ ...running, output: '{"output":"First output line\\nSecond' }] });
  await expect(page.locator('pre[aria-label="Output"]')).toHaveText('First output line\nSecond');
  await expect(page.getByText('Result details are still arriving.', { exact: true })).toBeVisible();
  await toggle.click();
  await update(page, { activities: [command] });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('TypeScript checks passed.', { exact: true })).toBeHidden();
  await expect(page.getByText('Partial result', { exact: true })).toHaveCount(0);
  await update(page, { activities: [{ ...failure, id: command.id }] });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toContainText('Exit 2');
  await expect(page.getByText('src/editor.ts:42: Cannot find name saveDocument.', { exact: true })).toBeVisible();
  await expect(page.getByText('One oversized file was not captured for review.', { exact: true })).toBeVisible();
});

test('truncation, unknown results, and hostile output remain visible and safe without external requests', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  const long = record('long', 'exec_command', { command: 'run-check' }, { output: 'actual output\n'.repeat(5000) + 'LAST ERROR LINE', running: false, exit_code: 1, truncated: true });
  const unknown = record('unknown', 'inspect_database', {}, { summary: 'Three active projects found.', count: 3, result_id: 'INTERNAL_ID', encrypted_content: 'PRIVATE_CONTENT' });
  const hostile = record('hostile', 'exec_command', { command: 'print-test-data' }, { output: '<script>window.EXECUTED=true</script>\n<img src="https://example.test/tracker" />', running: false, exit_code: 1 });
  await mount(page, { activities: [long, unknown, hostile] });
  await expect(page.locator('.response-tool-partial')).toHaveText('Partial result');
  await expect(page.getByText('The tool returned a truncated result.', { exact: true })).toBeVisible();
  await expect(page.locator('pre[aria-label="Output"]').first()).toContainText('LAST ERROR LINE');
  await expect(page.locator('pre[aria-label="Output"]').first()).toContainText('omitted from this preview');
  await page.locator('.chat-activity-summary').nth(1).click();
  await expect(page.getByText('Three active projects found.', { exact: true })).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/INTERNAL_ID|PRIVATE_CONTENT/);
  await expect(page.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).EXECUTED)).toBeUndefined();
  expect(requests).toEqual([]);
});

test('file-review and child failures stay visible even when their tool calls completed', async ({ page }) => {
  const review = record('review-failure', 'exec_command', { command: 'update-source' }, { output: 'Command finished.', running: false, exit_code: 0, review_error: 'The file changes could not be saved for review.' });
  const child = record('child-failure', 'wait_agent', { targets: ['thr_' + 'b'.repeat(32)] }, { status: { ['thr_' + 'b'.repeat(32)]: { status: 'error', error: 'The delegated check could not finish.' } }, timed_out: false });
  await mount(page, { activities: [review, child], paneWidth: 360 });
  const toggles = page.locator('.chat-activity-summary');
  await expect(toggles.nth(0)).toHaveAttribute('aria-expanded', 'true');
  await expect(toggles.nth(0)).toContainText('Review failed');
  await expect(page.getByText('The file changes could not be saved for review.', { exact: true })).toBeVisible();
  await expect(toggles.nth(1)).toHaveAttribute('aria-expanded', 'true');
  await expect(toggles.nth(1)).toContainText('Agent failed');
  await expect(page.getByText('The delegated check could not finish.', { exact: true })).toBeVisible();
  expect(await page.locator('body').innerText()).not.toContain('thr_' + 'b'.repeat(32));
});

test('representative results fit desktop split panes, laptops, tablets, and phones with 44px controls and reduced motion', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const pending = record('approval', 'apply_patch', { patch: '*** Begin Patch\n*** Update File: client/components/editor/very-long-but-realistic-file-name.tsx\n@@\n-const saved = false;\n+const saved = true;\n*** End Patch' }, undefined, 'awaiting_approval');
  const cases = [{ name: 'desktop-split', width: 1440, pane: 420 }, { name: 'laptop-split', width: 1100, pane: 340 }, { name: 'tablet', width: 768, pane: 680 }, { name: 'phone', width: 360, pane: 360 }];
  for (const size of cases) {
    await page.setViewportSize({ width: size.width, height: 1000 });
    await mount(page, { activities: [file, search, plan, pending, failure], paneWidth: size.pane });
    await page.locator('.chat-activity-summary').nth(0).click();
    await page.locator('.chat-activity-summary').nth(1).click();
    for (const card of await page.locator('.response-tool').all()) expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(await page.locator('.tool-result-fixture').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    for (const button of await page.locator('.response-tool button:visible').all()) {
      const box = await button.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.locator('.tool-result-fixture').evaluate(element => [...element.querySelectorAll('*')].filter(child => {
      const style = getComputedStyle(child);
      return style.boxShadow !== 'none' || style.textShadow !== 'none' || style.backdropFilter !== 'none' || style.animationName !== 'none';
    }).map(child => child.getAttribute('class')))).toEqual([]);
    await page.locator('#root').evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath(`${size.name}-tool-results.png`) });
    await page.locator('.response-tool.is-error').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`${size.name}-command-error.png`) });
  }
});

test('long output uses the shared auto-hide scrollbar and remains keyboard scrollable without layout shifts', async ({ page }) => {
  const long = record('long-scroll', 'exec_command', { command: 'list-output' }, { output: Array.from({ length: 140 }, (_, index) => `Recorded line ${index + 1}.`).join('\n'), exit_code: 0, running: false });
  await mount(page, { activities: [long], paneWidth: 420 });
  await page.locator('.chat-activity-summary').click();
  const output = page.locator('pre[aria-label="Output"]');
  await expect.poll(() => output.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await expect(output).not.toHaveAttribute('data-scroll-active', 'true');
  const before = await output.boundingBox();
  await output.hover();
  await expect(output).not.toHaveAttribute('data-scroll-active', 'true');
  await output.focus();
  await page.keyboard.press('PageDown');
  await expect.poll(() => output.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(output).toHaveAttribute('data-scroll-active', 'true');
  await expect(output).not.toHaveAttribute('data-scroll-active', 'true', { timeout: 3000 });
  expect(await output.boundingBox()).toEqual(before);
  expect(await output.evaluate(element => Number(getComputedStyle(element).getPropertyValue('--codex-scrollbar-opacity')))).toBe(0);
});

test('native web search enriches a completed row with observed queries and safely opens sources after keyboard activation', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  const starting = record('native-search', 'web_search', {}, { status: 'in_progress' }, 'running');
  await mount(page, { activities: [starting], paneWidth: 420 });
  const toggle = page.locator('.chat-activity-summary');
  await expect(toggle).toContainText('Web search');
  await expect(toggle).toContainText('In progress');
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(page.getByText('Search details have not arrived yet.', { exact: true })).toBeVisible();
  await expect(page.locator('.response-tool-row.is-queries')).toHaveCount(0);
  await update(page, { activities: [{ ...starting, output: JSON.stringify({ status: 'searching' }) }], paneWidth: 420 });
  await expect(toggle).toContainText('Searching');
  const complete = record(starting.id, 'web_search', {}, { status: 'completed' });
  await update(page, { activities: [complete], paneWidth: 420 });
  await expect(toggle).toContainText('Completed');
  await toggle.click();
  const url = 'https://developer.mozilla.org/en-US/docs/Web/API/URL';
  const enriched = { ...complete, output: JSON.stringify({ action: 'search', query: 'URL constructor documentation', queries: ['URL constructor documentation', 'URL canParse examples'], sources: [{ type: 'url', url, title: 'URL — MDN Web Docs' }], status: 'completed', id: 'PRIVATE_PROVIDER_ID', encrypted_content: 'PRIVATE_REASONING' }) };
  await update(page, { activities: [enriched], paneWidth: 420 });
  await expect(page.locator('.response-tool')).toHaveCount(1);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toContainText('URL constructor documentation');
  await expect(toggle).toContainText('1 source');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.response-tool-row.is-queries')).toHaveCount(2);
  const link = page.getByRole('link', { name: 'Open URL — MDN Web Docs (opens in a new tab)', exact: true });
  await expect(link).toHaveAttribute('href', url);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
  expect(await page.locator('body').innerText()).not.toMatch(/PRIVATE_PROVIDER_ID|PRIVATE_REASONING|encrypted_content|"sources"/);
  expect(requests).toEqual([]);
  await page.context().route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Explicit source navigation fixture</title><p>Local navigation proof.</p>' }));
  await link.focus();
  const [opened] = await Promise.all([page.context().waitForEvent('page'), page.keyboard.press('Enter')]);
  await opened.waitForLoadState();
  expect(opened.url()).toBe(url);
  expect(await opened.evaluate(() => window.opener)).toBeNull();
  await opened.close();
});

test('native web search page actions and preserved failures fit narrow panes without unsafe links or automatic requests', async ({ page }, testInfo) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const url = 'https://developer.mozilla.org/en-US/docs/Web/API/URL';
  const opened = record('native-open', 'web_search', { action: 'open_page', url }, { action: 'open_page', url, status: 'completed' });
  const find = record('native-find', 'web_search', { action: 'find_in_page', url, pattern: 'canParse' }, { action: 'find_in_page', url, pattern: 'canParse', status: 'completed' });
  const failed = record('native-failed', 'web_search', { action: 'search', query: 'Observed search query' }, { action: 'search', query: 'Observed search query', status: 'failed', error: 'Web search was interrupted.', sources: [
    { type: 'url', url, title: 'URL reference' },
    { type: 'url', url: 'javascript:alert(1)', title: 'PRIVATE_UNSAFE_TITLE' },
    { type: 'url', url: 'http://127.0.0.1/private', title: 'PRIVATE_LOCAL_TITLE' },
  ] }, 'error');
  for (const width of [1440, 768, 360, 320]) {
    await page.setViewportSize({ width, height: 1050 });
    await mount(page, { activities: [opened, find, failed], paneWidth: width >= 1000 ? 420 : Math.min(width, 680) });
    await page.locator('.chat-activity-summary').nth(0).click();
    await page.locator('.chat-activity-summary').nth(1).click();
    await expect(page.getByText('Web search was interrupted.', { exact: true })).toBeVisible();
    await expect(page.locator('.response-tool-row.is-queries').first()).toContainText('canParse');
    await expect(page.getByRole('link')).toHaveCount(3);
    expect(await page.locator('body').innerText()).not.toMatch(/PRIVATE_UNSAFE_TITLE|PRIVATE_LOCAL_TITLE|127\.0\.0\.1|javascript:/);
    for (const control of await page.locator('.response-tool button:visible, .response-tool a:visible').all()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    for (const card of await page.locator('.response-tool').all()) expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(await page.locator('.tool-result-fixture').evaluate(element => [...element.querySelectorAll('*')].every(child => {
      const style = getComputedStyle(child);
      return style.boxShadow === 'none' && style.textShadow === 'none' && style.backdropFilter === 'none' && style.animationName === 'none';
    }))).toBe(true);
    if (width === 360 || width === 1440) {
      await page.locator('#root').evaluate(element => { element.scrollTop = 0; });
      await page.screenshot({ path: testInfo.outputPath(`native-web-search-${width}.png`) });
    }
  }
  expect(requests).toEqual([]);
});
