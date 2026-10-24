import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import type { ChatMessage, ThreadTurn, ToolActivity } from '../../shared/types';
import type { TurnActivityProps } from '../../client/components/chat/TurnActivity';

type FixtureProps = Omit<TurnActivityProps, 'onNotify' | 'onOpenFile'>;
type FixtureWindow = Window & { __turnActivityFixture: { render: (props: FixtureProps) => void; openedFiles: string[]; notifications: string[] } };

// This isolated browser fixture exercises the real component and CSS. Its
// records are explicit test data; no backend or provider response is simulated.
const start = '2026-09-19T12:00:00.000Z';
const tool: ToolActivity = { id: 'fixture-tool', name: 'exec_command', input: JSON.stringify({ cmd: 'node --version', cwd: '/workspace/project' }), output: 'v22.23.2', status: 'completed', startedAt: start, completedAt: '2026-09-19T12:00:03.000Z' };
const message: ChatMessage = { id: 'fixture-assistant', role: 'assistant', content: 'A separate final answer.', createdAt: start, activities: [tool], reasoningSummary: [{ id: 'fixture-provider-item', summaryIndex: 0, text: 'Inspect the recorded **public summary** and [source](src/index.ts).', status: 'complete' }] };
const turn: ThreadTurn = { id: 'fixture-turn', userMessageId: 'fixture-user', startedAt: start, completedAt: '2026-09-19T12:00:13.000Z', status: 'completed', messageIds: [message.id] };
let script = '';
let styles = '';

test.beforeAll(async () => {
  const result = await build({
    absWorkingDir: fileURLToPath(new URL('../..', import.meta.url)),
    stdin: {
      contents: `
        import { createRoot } from 'react-dom/client';
        import './client/styles.css';
        import './client/components/chat.css';
        import { TurnActivity } from './client/components/chat/TurnActivity';
        const root = createRoot(document.getElementById('root'));
        const openedFiles = [];
        const notifications = [];
        window.__turnActivityFixture = {
          openedFiles, notifications,
          render(props) {
            root.render(<main className="turn-activity-test-frame" aria-label="Component fixture">
              <TurnActivity {...props} onNotify={message => notifications.push(message)} onOpenFile={path => openedFiles.push(path)} />
              <button type="button" className="after-activity">After activity</button>
            </main>);
          },
        };
      `,
      loader: 'tsx',
      resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
    },
    bundle: true, write: false, outfile: 'turn-activity-fixture.js', format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent',
  });
  script = result.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  styles = result.outputFiles.find(file => file.path.endsWith('.css'))!.text + '\n#root { overflow: auto; } .turn-activity-test-frame { max-width: 760px; margin: 24px auto; padding: 16px; } .after-activity { min-height: 44px; padding: 8px; }';
});

async function mount(page: Page, props: FixtureProps) {
  await page.setContent('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: script });
  await update(page, props);
}

async function update(page: Page, props: FixtureProps) {
  await page.evaluate(value => (window as unknown as FixtureWindow).__turnActivityFixture.render(value), props);
}

test('completed activity is compact, keyboard accessible, and keeps real commands and public summary links inspectable', async ({ page }) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await mount(page, { messages: [message], turn, workspacePath: '/workspace/project' });
  const toggle = page.getByRole('button', { name: /^Turn activity,/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toContainText('13s');
  await expect(page.locator('.chat-activity')).toHaveCount(0);
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.chat-turn-reasoning strong')).toHaveText('public summary');
  await expect(page.locator('.chat-activity')).toHaveCount(1);
  await expect(page.getByText('v22.23.2', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'source', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).__turnActivityFixture.openedFiles)).toEqual(['src/index.ts']);
  await page.locator('.chat-activity-summary').focus();
  await page.keyboard.press('Space');
  await expect(page.getByText('v22.23.2', { exact: true })).toBeVisible();
  await expect(page.getByText('/workspace/project', { exact: true })).toBeVisible();
  await toggle.click();
  await expect(page.getByText('v22.23.2', { exact: true })).toBeHidden();
  await toggle.click();
  await expect(page.getByText('v22.23.2', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});

test('streaming replacements preserve the user disclosure choice and leave a visible failure when collapsed', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-19T12:00:02.000Z') });
  const workingTurn: ThreadTurn = { ...turn, completedAt: undefined, status: 'running' };
  const workingMessage: ChatMessage = { ...message, activities: [{ ...tool, output: undefined, status: 'running', completedAt: undefined }], reasoningSummary: [{ ...message.reasoningSummary![0], status: 'streaming', text: 'First public summary draft.' }] };
  await mount(page, { messages: [workingMessage], turn: workingTurn, live: true });
  const toggle = page.getByRole('button', { name: /^Turn activity,/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toContainText('2s');
  await page.clock.runFor(3_000);
  await expect(toggle).toContainText('5s');
  const replacement: ChatMessage = { ...workingMessage, reasoningSummary: [{ ...message.reasoningSummary![0], text: 'Final public summary text.' }] };
  await update(page, { messages: [workingMessage, replacement], turn: workingTurn, live: true });
  await expect(page.locator('.chat-turn-reasoning')).toHaveCount(1);
  await expect(page.getByText('First public summary draft.', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Final public summary text.', { exact: true })).toBeVisible();
  await toggle.click();
  const failedMessage: ChatMessage = { ...replacement, activities: [{ ...tool, status: 'error', output: 'Recorded command failure.' }] };
  await update(page, { messages: [failedMessage], turn: workingTurn, live: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toContainText('1 failed');
  await expect(page.getByText('Recorded command failure.', { exact: true })).toBeHidden();
  await toggle.click();
  await expect(page.getByText('Recorded command failure.', { exact: true })).toBeVisible();
  await update(page, { messages: [failedMessage], turn, live: false });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toContainText('13s');
  await page.clock.runFor(60_000);
  await expect(toggle).toContainText('13s');
});

test('finishing collapses untouched activity but preserves a tool log the user is inspecting', async ({ page }) => {
  const workingTurn: ThreadTurn = { ...turn, completedAt: undefined, status: 'running' };
  await mount(page, { messages: [message], turn: workingTurn, live: true });
  const toggle = page.getByRole('button', { name: /^Turn activity,/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await update(page, { messages: [message], turn, live: false });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  const secondTurn = { ...workingTurn, id: 'second-turn' };
  await update(page, { messages: [message], turn: secondTurn, live: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.locator('.chat-activity-summary').click();
  await expect(page.getByText('v22.23.2', { exact: true })).toBeVisible();
  await update(page, { messages: [message], turn: { ...turn, id: secondTurn.id }, live: false });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('v22.23.2', { exact: true })).toBeVisible();
});

test('pending and failed details fit narrow panes with touch targets and reduced motion', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const pending: ChatMessage = { ...message, activities: [
    { ...tool, id: 'pending-tool', status: 'awaiting_input', name: 'request_user_input', completedAt: undefined },
    { ...tool, id: 'failed-tool', status: 'error', input: JSON.stringify({ cmd: 'node ./scripts/verify-a-long-recorded-workspace-file-name.mjs' }), output: 'Recorded failure details remain visible.' },
  ] };
  await mount(page, { messages: [pending], turn: { ...turn, status: 'running', completedAt: undefined }, live: true });
  const toggle = page.getByRole('button', { name: /^Turn activity,/ });
  await expect(toggle).toContainText('Awaiting your answer');
  await expect(page.getByText('Recorded failure details remain visible.', { exact: true })).toBeVisible();
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(await page.locator('.chat-turn-activity').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    for (const button of await page.locator('.chat-turn-activity button:visible').all()) {
      const box = await button.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.locator('.chat-turn-activity').evaluate(element => [...element.querySelectorAll('*')].every(child => {
      const style = getComputedStyle(child);
      return style.animationName === 'none' && style.boxShadow === 'none' && style.backdropFilter === 'none';
    }))).toBe(true);
    if (width === 360) await page.screenshot({ path: testInfo.outputPath('phone-turn-activity.png') });
  }
});
