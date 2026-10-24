import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// Independent in-memory transport fixture: actual request dialogs, native
// queue editor and plan renderer; no model, live workspace or saved user data.
let server: Server | undefined, origin: string;
test.beforeAll(async () => {
  const bundle = await build({ stdin: { loader: 'tsx', sourcefile: 'native-request-fixture.tsx', resolveDir: process.cwd(), contents: String.raw`
    import React, { useRef, useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { QuestionCard } from './client/components/chat/QuestionCard';
    import { ApprovalCard } from './client/components/chat/ApprovalCard';
    import { QueuedInputs } from './client/components/chat/QueuedInputs';
    import { PlanCard } from './client/components/chat/PlanCard';
    import Modal from './client/components/Modal';
    import { SelectMenu } from './client/components/ui/Dropdown';
    import { api } from './client/api';
    import './client/styles.css';
    import './client/components/chat.css';
    const initialQuestion = { id: 'question', threadId: 'thread', turnId: 'turn', itemId: 'question-item', isBlocking: true, questions: [
      { id: 'scope', header: 'Scope', question: 'Which change should we make?', isSecret: false, isOther: true, options: [
        { label: 'Small change (Recommended)', description: 'Keep the existing structure.' }, { label: 'Larger change', description: 'Review the whole feature.' }] },
      { id: 'notes', header: 'Context', question: 'What context should Codex use?', isSecret: false, isOther: false, options: null }] };
    const initialApproval = { id: 'approval', threadId: 'thread', turnId: 'turn', itemId: 'command', kind: 'command', title: 'Review project command',
      description: 'Check the current project directory.', command: 'pwd && git status --short', cwd: '/workspace/project', decisions: ['acceptForSession', 'decline'], createdAt: '2026-09-30T12:00:00Z' };
    const initialQueue = [{ id: 'queued', clientUserMessageId: 'client-message', prompt: 'First pending message', attachmentNames: ['notes.md'] }];
    const records = { answers: [], decisions: [], checks: 0, queueActions: [] };
    const controls = { answerMode: 'accept', approvalMode: 'accept', refreshMode: 'accept', releaseAnswer: undefined, releaseApproval: undefined };
    function App() {
      const [question, setQuestion] = useState(initialQuestion), [approval, setApproval] = useState(initialApproval), [queue, setQueue] = useState(initialQueue);
      const [busy, setBusy] = useState(false), [focusProbe, setFocusProbe] = useState(false);
      const [choice, setChoice] = useState('first');
      const [plan, setPlan] = useState([{ title: 'Read the project', status: 'completed' }, { title: 'Implement the change', status: 'in_progress' }, { title: 'Verify the result', status: 'pending' }]);
      const questionRef = useRef(question), approvalRef = useRef(approval); questionRef.current = question; approvalRef.current = approval;
      async function answer(answers) {
        const captured = questionRef.current; records.answers.push(structuredClone(answers));
        const mode = controls.answerMode;
        if (mode === 'hold') await new Promise((resolve, reject) => controls.releaseAnswer = failed => failed ? reject(new Error('Late unconfirmed response')) : resolve());
        if (mode === 'fail') throw new Error('Untrusted error echoed fixture-secret-do-not-cache');
        if (mode !== 'keep' && questionRef.current === captured) setQuestion(null);
      }
      async function decide(decision) {
        const captured = approvalRef.current; records.decisions.push(decision);
        const mode = controls.approvalMode;
        if (mode === 'hold') await new Promise((resolve, reject) => controls.releaseApproval = failed => failed ? reject(new Error('Late unconfirmed decision')) : resolve());
        if (mode === 'fail') throw new Error('This approval could not be sent.');
        if (mode !== 'keep' && approvalRef.current === captured) setApproval(null);
      }
      async function refresh() { records.checks++; if (controls.refreshMode === 'fail') throw new Error('The request status could not be checked.'); }
      Object.assign(window, { requestHarness: { initialQuestion, initialApproval, records, controls, setQuestion, setApproval, setPlan, setQueue, setBusy } });
      const controller = { items: queue, actions: {}, refreshing: false, paging: false, error: null, hasMore: false, hasPreviousPage: false, pageKey: '', canStart: false,
        refresh: async () => { const value = await api('/__request-fixture-queue'); setQueue(value.items); },
        nextPage: async () => undefined, previousPage: async () => undefined, clearError: () => undefined,
        cancel: async id => { records.queueActions.push(['cancel', id]); setQueue(previous => previous.filter(item => item.id !== id)); },
        resume: async id => records.queueActions.push(['resume', id]) };
      return <main data-loaded="true"><h1>Interaction fixture</h1><button type="button" id="outside">Outside control</button>
        {question && <QuestionCard request={question} busy={busy} onAnswer={answer} onRefresh={refresh} />}
        {approval && <ApprovalCard approval={approval} busy={busy} onAnswer={decide} onRefresh={refresh} />}
        <QueuedInputs controller={controller} scopeKey="workspace:thread" workspaceId="workspace" threadId="thread" />
        <PlanCard rows={plan} explanation="The work follows the steps reported by Codex." />
        <button type="button" onClick={() => setFocusProbe(true)}>Open focus fixture</button>
        <Modal open={focusProbe} onClose={() => setFocusProbe(false)} title="Focus fixture" titleId="focus-fixture-title">
          <div hidden><input data-autofocus aria-label="Hidden field" /></div>
          <div inert><input data-autofocus aria-label="Inert field" /></div>
          <input data-autofocus disabled aria-label="Disabled field" />
          <button type="button">Earlier visible control</button><input data-autofocus aria-label="Preferred field" />
          <SelectMenu aria-label="Dialog choice" value={choice} options={[{value:'first',label:'First choice'},{value:'second',label:'Second choice'}]} onValueChange={setChoice} />
          <button type="button" onClick={() => setFocusProbe(false)}>Dismiss fixture</button>
        </Modal>
      </main>;
    }
    createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
  ` }, bundle: true, write: false, outfile: '/tmp/codex-request-dialog-fixture.js', format: 'esm', platform: 'browser', logLevel: 'silent' });
  const script = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  const style = bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text;
  server = createServer((request, response) => {
    if (request.url === '/fixture.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(script); }
    else if (request.url === '/fixture.css') { response.setHeader('Content-Type', 'text/css'); response.end(style); }
    else { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>html,body{margin:0;min-height:100%;overflow:auto}main{display:flex;flex-direction:column;gap:16px;max-width:760px;padding:20px;margin:auto}h1{font-size:18px}#outside{min-height:44px}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>'); }
  });
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
});
test.afterAll(async () => { if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); } });

async function fixture(page: Page) {
  const errors: string[] = [], calls: Array<{ path: string; method: string; body?: unknown }> = [];
  const entry = { id: 'queued', clientUserMessageId: 'client-message', prompt: 'First pending message', attachmentNames: ['notes.md'], revision: 'queue-revision-1', editable: true };
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const body = request.postData() ? request.postDataJSON() : undefined;
    calls.push({ path: url.pathname, method: request.method(), body });
    if (url.pathname === '/api/__request-fixture-queue') return route.fulfill({ json: { items: [entry] } });
    if (url.pathname === '/api/workspaces/workspace/codex/threads/thread/queue-edit') return route.fulfill({ json: { items: [entry], nextCursor: null, revision: entry.revision } });
    if (url.pathname.endsWith('/queue-edit/queued') && request.method() === 'PATCH') {
      if (body.expectedRevision !== entry.revision) return route.fulfill({ status: 409, json: { error: 'The queued message changed.' } });
      entry.prompt = body.prompt; entry.revision = 'queue-revision-2';
      return route.fulfill({ json: { updated: true } });
    }
    errors.push('Unexpected request: ' + request.method() + ' ' + url.pathname);
    return route.fulfill({ status: 404, json: { error: 'Unknown fixture request.' } });
  });
  await page.goto(origin);
  await expect(page.locator('[data-loaded="true"]')).toBeVisible();
  return { calls, errors, entry };
}

test('multi-question dialog requires explicit answers and retains an ordinary draft when closed', async ({ page }) => {
  const app = await fixture(page), trigger = page.locator('.chat-question').getByRole('button', { name: 'Answer', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Questions from Codex', exact: true });
  await expect(dialog.getByText('Question 1 of 2', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: /Small change/ })).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Next question', exact: true })).toBeDisabled();
  await dialog.getByRole('radio', { name: /Something else/ }).check();
  const answer = dialog.getByLabel('Your answer for Scope', { exact: true });
  await answer.fill('A focused change'); await answer.press('Enter'); await answer.press('x');
  await expect(answer).toHaveValue('A focused change\nx');
  await dialog.getByRole('button', { name: 'Next question', exact: true }).click();
  const context = dialog.getByLabel('Your answer for Context', { exact: true });
  await context.fill('Preserve the native request identity.');
  expect(await page.evaluate(() => (window as any).requestHarness.records.answers)).toEqual([]);
  await dialog.press('Escape');
  await expect(dialog).toHaveCount(0);
  const resume = page.locator('.chat-question').getByRole('button', { name: 'Continue', exact: true });
  await expect(resume).toBeFocused(); await resume.click();
  await expect(context).toHaveValue('Preserve the native request identity.');
  await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(answer).toHaveValue('A focused change\nx');
  await dialog.getByRole('button', { name: 'Next question', exact: true }).click();
  expect(await page.evaluate(() => (window as any).requestHarness.records.answers)).toEqual([]);
  await dialog.getByRole('button', { name: 'Send answers', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).requestHarness.records.answers)).toEqual([{ scope: { answers: ['A focused change\nx'] }, notes: { answers: ['Preserve the native request identity.'] } }]);
  expect(app.errors).toEqual([]);
});

test('secret answers stay in native inputs, clear on close and failure, and never leak server echoes', async ({ page }) => {
  const app = await fixture(page);
  await page.evaluate(() => { const h = (window as any).requestHarness; h.controls.answerMode = 'fail'; h.setQuestion({ ...h.initialQuestion,
    questions: [{ id: 'secret', header: 'Secret code', question: 'Enter your secret code.', isSecret: true, isOther: false, options: null }, h.initialQuestion.questions[0]] }); });
  await page.locator('.chat-question').getByRole('button', { name: 'Answer', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Questions from Codex', exact: true }), secret = dialog.getByLabel('Your answer for Secret code', { exact: true });
  await expect(secret).toHaveAttribute('type', 'password');
  await secret.fill('fixture-secret-do-not-cache');
  await secret.press('Enter');
  expect(await page.evaluate(() => (window as any).requestHarness.records.answers)).toEqual([]);
  await dialog.getByRole('button', { name: 'Next question', exact: true }).click();
  await dialog.getByRole('radio', { name: /Small change/ }).check();
  expect(await page.content()).not.toContain('fixture-secret-do-not-cache');
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain('fixture-secret-do-not-cache');
  await dialog.press('Escape');
  await page.locator('.chat-question').getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(dialog.getByRole('radio', { name: /Small change/ })).toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Send answers', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(secret).toHaveValue(''); await secret.fill('fixture-secret-do-not-cache');
  await dialog.getByRole('button', { name: 'Next question', exact: true }).click();
  await dialog.getByRole('button', { name: 'Send answers', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('The answer could not be confirmed');
  await expect(secret).toHaveValue('');
  expect(await page.content()).not.toContain('fixture-secret-do-not-cache');
  expect(await page.evaluate(() => (window as any).requestHarness.records.answers[0].secret.answers)).toEqual(['fixture-secret-do-not-cache']);
  await dialog.getByRole('button', { name: 'Check request', exact: true }).click();
  expect(await page.evaluate(() => (window as any).requestHarness.records.checks)).toBe(1);
  expect(app.errors).toEqual([]);
});

test('accepted secret answers stay sent until the native request disappears and cannot be submitted twice', async ({ page }) => {
  const app = await fixture(page);
  await page.evaluate(() => { const h = (window as any).requestHarness; h.controls.answerMode = 'keep'; h.setQuestion({ ...h.initialQuestion,
    questions: [{ id: 'secret', header: 'Secret code', question: 'Enter your secret code.', isSecret: true, isOther: false, options: null }, h.initialQuestion.questions[0]] }); });
  await page.locator('.chat-question').getByRole('button', { name: 'Answer', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Questions from Codex', exact: true });
  await dialog.getByLabel('Your answer for Secret code', { exact: true }).fill('fixture-secret-do-not-cache');
  await dialog.getByRole('button', { name: 'Next question', exact: true }).click();
  await dialog.getByRole('radio', { name: /Small change/ }).check();
  await dialog.getByRole('button', { name: 'Send answers', exact: true }).click();
  await expect(dialog).toContainText('Your answer was sent.');
  await expect(dialog.locator('input[type=password]')).toHaveCount(0);
  await expect(dialog.getByRole('progressbar', { name: 'Sent answers', exact: true })).toHaveAttribute('value', '2');
  await expect(dialog.getByRole('button', { name: /^(Send|Retry) answers$/ })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Question 1: Secret code, sent', exact: true }).click();
  await expect(dialog.getByText('Secret answer sent.', { exact: true })).toBeVisible();
  await dialog.press('Escape');
  await page.locator('.chat-question').getByRole('button', { name: 'View response', exact: true }).click();
  await expect(dialog.getByText('Secret answer sent.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).requestHarness.records.answers.length)).toBe(1);
  expect(await page.content()).not.toContain('fixture-secret-do-not-cache');
  await page.evaluate(() => (window as any).requestHarness.setQuestion(null));
  await expect(dialog).toHaveCount(0);
  expect(app.errors).toEqual([]);
});

test('stale and locked question scopes discard draft state and ignore a late submission failure', async ({ page }) => {
  const app = await fixture(page);
  await page.evaluate(() => { const h = (window as any).requestHarness; h.controls.answerMode = 'hold'; h.setQuestion({ ...h.initialQuestion, questions: [h.initialQuestion.questions[1]] }); });
  await page.locator('.chat-question').getByRole('button', { name: 'Answer', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'A question from Codex', exact: true });
  await dialog.getByLabel('Your answer for Context', { exact: true }).fill('This belongs to the old request.');
  await dialog.getByRole('button', { name: 'Send answer', exact: true }).click();
  await page.evaluate(() => { const h = (window as any).requestHarness; h.setQuestion({ ...h.initialQuestion, id: 'replacement', questions: [h.initialQuestion.questions[1]] }); });
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => (window as any).requestHarness.controls.releaseAnswer(true));
  await page.locator('.chat-question').getByRole('button', { name: 'Answer', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'A question from Codex', exact: true });
  await expect(dialog.getByLabel('Your answer for Context', { exact: true })).toHaveValue('');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByLabel('Your answer for Context', { exact: true }).fill('Clear this on lock.');
  await page.evaluate(() => { document.body.dataset.workspaceLocked = 'true'; window.dispatchEvent(new Event('codex:session-locked')); });
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.locator('.chat-question')).toHaveCount(0);
  await page.evaluate(() => { document.body.dataset.workspaceLocked = 'false'; window.dispatchEvent(new Event('codex:session-unlocked')); });
  await page.locator('.chat-question').getByRole('button', { name: 'Answer', exact: true }).click();
  await expect(dialog.getByLabel('Your answer for Context', { exact: true })).toHaveValue('');
  expect(app.errors).toEqual([]);
});

test('approval dialog shows command scope and only offered decisions, with local failure and retry', async ({ page }) => {
  const app = await fixture(page);
  await page.evaluate(() => (window as any).requestHarness.controls.approvalMode = 'fail');
  await page.locator('.chat-approval').getByRole('button', { name: 'Review', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review project command', exact: true });
  await expect(dialog.getByLabel('Requested command', { exact: true })).toHaveText('pwd && git status --short');
  await expect(dialog).toContainText('/workspace/project');
  await expect(dialog.getByRole('button', { name: 'Allow once', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).requestHarness.records.decisions)).toEqual([]);
  await dialog.getByRole('button', { name: 'Allow for this session', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('This approval could not be sent');
  await dialog.press('Escape');
  await expect(page.locator('.chat-approval')).toContainText('Approval needed');
  await page.locator('.chat-approval').getByRole('button', { name: 'Review', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await page.evaluate(() => (window as any).requestHarness.controls.approvalMode = 'keep');
  await dialog.getByRole('button', { name: 'Allow for this session', exact: true }).click();
  await expect(dialog).toContainText('Your decision was sent');
  await expect(dialog.getByRole('group', { name: 'Approval decisions', exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as any).requestHarness.controls.refreshMode = 'fail');
  await dialog.getByRole('button', { name: 'Check request', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('The request status could not be checked');
  expect(await page.evaluate(() => (window as any).requestHarness.records.decisions)).toEqual(['acceptForSession', 'acceptForSession']);
  expect(app.errors).toEqual([]);
});

test('opaque approval offers display complete scopes and submit only the current offered identifier', async ({ page }) => {
  const app = await fixture(page);
  const decision = 'native-decision-11111111-1111-4111-8111-111111111111';
  const command = 'npm test -- ' + 'target '.repeat(1000) + '--last-argument-visible';
  await page.evaluate(({ decision, command }) => {
    const h = (window as any).requestHarness;
    h.setApproval({ ...h.initialApproval, title: 'Review command policy', command, decisions: [decision, 'decline'],
      decisionOptions: [{ id: decision, label: 'Allow this command pattern', description: 'Allow future commands with the npm test prefix.' },
        { id: 'native-decision-22222222-2222-4222-8222-222222222222', label: 'Unrelated offer', description: 'This is not offered for this request.' }],
      detailSections: [{ title: 'Network access', items: ['Host: registry.example.com', 'Protocol: https'] },
        { title: 'File system access', items: ['Read: /workspace/project', 'Write: /workspace/project/cache'] }] });
  }, { decision, command });
  await page.locator('.chat-approval').getByRole('button', { name: 'Review', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review command policy', exact: true });
  await expect(dialog.getByLabel('Requested command', { exact: true })).toHaveText(command);
  await expect(dialog.getByRole('region', { name: 'Network access', exact: true })).toContainText('Host: registry.example.com');
  await expect(dialog.getByRole('region', { name: 'File system access', exact: true })).toContainText('Write: /workspace/project/cache');
  await expect(dialog.getByRole('button', { name: 'Unrelated offer', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Allow once', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Allow this command pattern', exact: true }).click();
  expect(await page.evaluate(() => (window as any).requestHarness.records.decisions)).toEqual([decision]);
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => { const h = (window as any).requestHarness; h.setApproval({ ...h.initialApproval, id: 'stdin-request', title: 'Review terminal input', commandKind: 'writeStdin', command: 'yes\n', decisions: ['accept', 'decline'] }); });
  await page.locator('.chat-approval').getByRole('button', { name: 'Review', exact: true }).click();
  const stdin = page.getByRole('dialog', { name: 'Review terminal input', exact: true });
  await expect(stdin.getByLabel('Requested terminal input', { exact: true })).toHaveText('yes\n');
  await expect(stdin).toContainText('Send the requested terminal input once.');
  await stdin.getByRole('button', { name: 'Decline', exact: true }).click();
  expect(await page.evaluate(() => (window as any).requestHarness.records.decisions)).toEqual([decision, 'decline']);
  expect(app.errors).toEqual([]);
});

test('a replaced approval drops obsolete decisions and ignores a late failed response', async ({ page }) => {
  const app = await fixture(page);
  await page.evaluate(() => (window as any).requestHarness.controls.approvalMode = 'hold');
  await page.locator('.chat-approval').getByRole('button', { name: 'Review', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review project command', exact: true });
  await dialog.getByRole('button', { name: 'Allow for this session', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Decline', exact: true })).toBeDisabled();
  await page.evaluate(() => { const h = (window as any).requestHarness; h.setApproval({ ...h.initialApproval, id: 'replacement', decisions: ['decline'] }); });
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => (window as any).requestHarness.controls.releaseApproval(true));
  await page.locator('.chat-approval').getByRole('button', { name: 'Review', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Allow for this session', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Decline', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(app.errors).toEqual([]);
});

test('native queue editing preserves the submission and attachment identities with an explicit save', async ({ page }) => {
  const app = await fixture(page);
  await page.getByRole('button', { name: 'Edit queued turn 1', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Queued messages', exact: true });
  const text = dialog.getByLabel('Message text', { exact: true });
  await expect(text).toHaveValue('First pending message');
  await text.fill('Updated pending message'); await text.press('Enter'); await text.press('x');
  expect(app.calls.filter(call => call.method !== 'GET')).toEqual([]);
  await dialog.getByRole('button', { name: 'Save pending text', exact: true }).click();
  await expect(page.locator('[data-submission-id="queued"]')).toContainText('Updated pending message');
  expect(app.calls.filter(call => call.method !== 'GET')).toEqual([{ path: '/api/workspaces/workspace/codex/threads/thread/queue-edit/queued', method: 'PATCH',
    body: { prompt: 'Updated pending message\nx', expectedRevision: 'queue-revision-1' } }]);
  expect(app.entry.attachmentNames).toEqual(['notes.md']);
  expect(app.entry.clientUserMessageId).toBe('client-message');
  expect(app.errors).toEqual([]);
});

test('plan dialog updates native progress in place without inventing completion for remaining steps', async ({ page }) => {
  const app = await fixture(page);
  await page.getByRole('button', { name: 'Open plan', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Plan', exact: true });
  await expect(dialog.getByRole('progressbar', { name: 'Plan steps completed', exact: true })).toHaveAttribute('value', '1');
  await expect(dialog.getByRole('list', { name: 'Plan steps', exact: true })).toContainText('In progress');
  await page.evaluate(() => (window as any).requestHarness.setPlan([{ title: 'Read the project', status: 'completed' }, { title: 'Implement the change', status: 'completed' }, { title: 'Verify the result', status: 'pending' }]));
  await expect(dialog).toContainText('2 of 3 steps completed');
  await expect(dialog.getByRole('progressbar', { name: 'Plan steps completed', exact: true })).toHaveAttribute('value', '2');
  await expect(dialog.getByRole('listitem').last()).toContainText('Pending');
  await expect(dialog).toBeVisible();
  expect(app.errors).toEqual([]);
});

test('request dialogs remain usable on a phone with visible focus, touch targets and reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  const app = await fixture(page);
  await page.locator('.chat-question').getByRole('button', { name: 'Answer', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Questions from Codex', exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(element => { const rect = element.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight; })).toBe(true);
  const buttons = dialog.getByRole('button');
  for (const button of await buttons.all()) if (await button.isVisible()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const close = dialog.getByRole('button', { name: 'Close dialog', exact: true });
  await close.focus(); await close.press('Shift+Tab');
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await expect(page.getByRole('button', { name: 'Outside control', exact: true })).not.toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(page.locator('.chat-question').getByRole('button', { name: 'Answer', exact: true })).toBeFocused();
  expect(app.errors).toEqual([]);
});

test('busy approvals skip disabled decisions and keep keyboard and programmatic focus inside', async ({ page }) => {
  const app = await fixture(page);
  await page.evaluate(() => (window as any).requestHarness.setBusy(true));
  const trigger = page.locator('.chat-approval').getByRole('button', { name: 'Review', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Review project command', exact: true });
  await expect(dialog.getByRole('button', { name: 'Allow for this session', exact: true })).toBeDisabled();
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await expect(dialog.getByRole('button', { name: 'Allow for this session', exact: true })).not.toBeFocused();
  await page.evaluate(() => document.getElementById('outside')!.focus());
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  for (let count = 0; count < 5; count++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await dialog.press('Escape'); await expect(trigger).toBeFocused();
  expect(app.errors).toEqual([]);
});

test('controlled dropdown portals retain keyboard focus and close before their request dialog', async ({ page }) => {
  const app = await fixture(page);
  await page.getByRole('button', { name: 'Open focus fixture', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Focus fixture', exact: true }), trigger = dialog.getByRole('combobox', { name: 'Dialog choice', exact: true });
  await trigger.focus(); await trigger.press('Enter');
  const list = page.getByRole('listbox', { name: 'Dialog choice', exact: true });
  await expect(list).toBeFocused();
  await list.press('ArrowDown'); await list.press('Enter');
  await expect(trigger).toContainText('Second choice'); await expect(trigger).toBeFocused();
  await trigger.press('Enter'); await expect(list).toBeFocused();
  await list.press('Escape'); await expect(list).toHaveCount(0); await expect(dialog).toBeVisible(); await expect(trigger).toBeFocused();
  await trigger.press('Escape'); await expect(dialog).toHaveCount(0);
  expect(app.errors).toEqual([]);
});

test('shared dialog prioritizes a rendered autofocus field and excludes hidden, inert and disabled targets', async ({ page }) => {
  const app = await fixture(page), trigger = page.getByRole('button', { name: 'Open focus fixture', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Focus fixture', exact: true });
  await expect(dialog.getByLabel('Preferred field', { exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('button', { name: 'Earlier visible control', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('button', { name: 'Dismiss fixture', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
  await dialog.press('Escape'); await expect(trigger).toBeFocused();
  expect(app.errors).toEqual([]);
});
