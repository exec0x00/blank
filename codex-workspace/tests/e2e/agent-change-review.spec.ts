import { expect, test, type Page } from '@playwright/test';
import type { Bootstrap, NativeItemDetailReady, Thread, Workspace } from '../../shared/types';

const headers = { 'X-Codex-Workspace': '1' };
const password = process.env.PLAYWRIGHT_PASSWORD || 'browser-test-workspace-password';
const threadId = '0199d111-1111-7111-8111-111111111111', turnId = '0199d222-2222-7222-8222-222222222222';
const itemId = 'recorded-file-change', stamp = '2026-09-30T00:00:00.000Z', version = 'a'.repeat(64);
const original = 'export const working = "saved working file";\n';
const patch = '--- a/working.ts\n+++ b/working.ts\n@@ -1 +1 @@\n-recorded-before\n+recorded-after\n' + ' context captured in the patch\n'.repeat(1100);
const deleted = '--- a/removed.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-deleted-recorded-content\n';
const capabilities = { conversations: true, pagination: true, queue: true, goals: true, skills: true, plan: true, review: true, historyRevert: true };

/** The actual App and Monaco run; only native read-only conversation data is mocked. */
async function setup(page: Page, view: 'agent' | 'editor') {
  expect((await page.request.post('/api/session', { headers, data: { password } })).status()).toBe(200);
  const created = await page.request.post('/api/workspaces', { headers, data: { name: 'Recorded review ' + Date.now() } });
  expect(created.status()).toBe(201);
  const workspace = await created.json() as Workspace;
  expect((await page.request.post(`/api/workspaces/${workspace.id}/files`, { headers, data: { path: 'working.ts', kind: 'file' } })).ok()).toBe(true);
  expect((await page.request.put(`/api/workspaces/${workspace.id}/file`, { headers, data: { path: 'working.ts', content: original } })).ok()).toBe(true);
  expect((await page.request.patch(`/api/workspaces/${workspace.id}`, { headers, data: { active: true } })).ok()).toBe(true);
  const changes: Thread = { id: threadId, workspaceId: workspace.id, title: 'Recorded changes', backend: 'codex-cli', status: 'idle', createdAt: stamp, updatedAt: stamp,
    messages: [{ id: 'review-user', turnId, role: 'user', content: 'Review the recorded edits.', createdAt: stamp },
      { id: itemId, turnId, role: 'assistant', content: '', createdAt: stamp, activities: [{ id: itemId, name: 'apply_patch',
        input: JSON.stringify({ path: 'working.ts', patch: '+short chat preview' }), inputTruncated: true,
        output: JSON.stringify({ changed: [{ path: 'working.ts', operation: 'updated' }, { path: 'removed.ts', operation: 'deleted' }] }), status: 'completed', startedAt: stamp, completedAt: stamp }] }],
    turns: [{ id: turnId, userMessageId: 'review-user', startedAt: stamp, completedAt: stamp, status: 'completed', messageIds: ['review-user', itemId] }],
    timeline: { version: 1, revision: 2, nextSequence: 3, entries: [
      { id: 'review-message', messageId: 'review-user', kind: 'message', sequence: 1, revision: 1 },
      { id: 'review-activity', messageId: itemId, activityId: itemId, kind: 'activity', sequence: 2, revision: 2 },
    ] },
    native: { loaded: true, model: 'fixture-model', reasoningEffort: 'medium', activeTurnId: null, approvals: [], questions: [], queue: [], queueCursor: null,
      goal: null, tokenUsage: null, diff: null, capabilities }, nativePage: { nextCursor: null, backwardsCursor: null } };
  await page.addInitScript(() => {
    class Source {
      static CLOSED = 2; static OPEN = 1; static CONNECTING = 0;
      readyState = 0; onmessage = null; onerror = null; onopen: (() => void) | null = null;
      constructor(readonly url: string) { setTimeout(() => { if (this.readyState !== 2) { this.readyState = 1; this.onopen?.(); } }, 0); }
      close() { this.readyState = 2; }
    }
    Object.assign(window, { EventSource: Source });
  });
  await page.route('**/api/bootstrap', async route => {
    const response = await route.fetch(), data = await response.json() as Bootstrap;
    await route.fulfill({ json: { ...data, settings: { ...data.settings, agentConfigured: true, model: 'fixture-model', reasoningEffort: 'medium' } } });
  });
  await page.route('**/api/codex/runtime', route => route.fulfill({ json: { backend: 'codex-cli', state: 'ready', version: '0.155.1', installedVersion: '0.155.1',
    startedAt: stamp, updatedAt: stamp, canUpdate: true, updateBlockedReason: null, error: null, activeTurns: 0, capabilities } }));
  await page.route('**/api/models', route => route.fulfill({ json: { backend: 'codex-cli', connected: true, models: ['fixture-model'], catalog: [{ id: 'fixture-model', model: 'fixture-model', displayName: 'Fixture',
    description: 'Read-only browser fixture', hidden: false, isDefault: true, inputModalities: ['text'], defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Medium' }] }] } }));
  await page.route(`**/api/workspaces/${workspace.id}/codex/skills*`, route => route.fulfill({ json: { skills: [], errors: [] } }));
  await page.route('**/api/threads?*', route => route.fulfill({ json: { items: [changes], olderCursor: null, newerCursor: null, hasOlder: false, hasNewer: false } }));
  await page.route(`**/api/threads/${threadId}`, route => route.fulfill({ json: changes }));
  await page.route(`**/api/threads/${threadId}/agents`, route => route.fulfill({ json: [] }));
  const detailCalls: URL[] = [], writes: string[] = [], fileReads: string[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === `/api/workspaces/${workspace.id}/file`) {
      if (request.method() === 'GET') fileReads.push(url.searchParams.get('path') || '');
      else writes.push(request.method());
    }
  });
  await page.route(`**/api/threads/${threadId}/native-item-detail?*`, route => {
    const url = new URL(route.request().url()); detailCalls.push(url);
    const part = Number(url.searchParams.get('part') || 0), offset = Number(url.searchParams.get('offset') || 0);
    const text = part === 1 ? deleted : patch, selected = text.slice(offset, offset + 16_000), end = offset + selected.length;
    const reply: NativeItemDetailReady = { threadId, turnId, itemId, field: 'output', status: 'ready', itemType: 'fileChange', itemCursor: null, version,
      parts: [{ part: 0, label: 'Change 1: working.ts', totalChars: patch.length }, { part: 1, label: 'Change 2: removed.ts', totalChars: deleted.length }],
      part, label: part === 1 ? 'Change 2: removed.ts' : 'Change 1: working.ts', text: selected, offset, limit: 16_000, totalChars: text.length,
      previousOffset: offset ? Math.max(0, offset - 16_000) : null, nextOffset: end < text.length ? end : null };
    return route.fulfill({ json: reply });
  });
  await page.goto(`/work?workspace=${workspace.id}&thread=${threadId}&view=${view}`);
  return { workspace, detailCalls, writes, fileReads, errors };
}

async function openChange(page: Page) {
  const agent = page.getByRole('region', { name: 'Codex conversation', exact: true });
  await expect(agent.getByRole('region', { name: 'Conversation messages', exact: true })).toContainText('Review the recorded edits.');
  const group = agent.locator('.chat-activity-group-toggle').first();
  await expect(group).toBeVisible();
  if (await group.getAttribute('aria-expanded') !== 'true') await group.click();
  await expect(agent.locator('.response-tool-code.is-diff')).toHaveCount(0);
  await agent.getByRole('button', { name: 'Open changes', exact: true }).click();
  const review = page.getByRole('region', { name: 'Recorded change review', exact: true });
  await expect(review).toBeVisible();
  await expect(review.locator('.view-lines')).toContainText('recorded-before');
  return review;
}

test('recorded review reveals a hidden editor while retaining dirty buffers and disabling saves', async ({ page }) => {
  const fixture = await setup(page, 'editor');
  const editor = page.getByRole('region', { name: 'Code editor', exact: true });
  await editor.getByRole('treeitem', { name: 'working.ts', exact: true }).click();
  const working = editor.locator('.editor-document-area .monaco-editor textarea.inputarea').first();
  await expect(working).toBeVisible();
  await working.focus(); await page.keyboard.press('ControlOrMeta+KeyA'); await page.keyboard.insertText('export const working = "unsaved buffer remains";\n');
  const originalInput = await working.elementHandle();
  await expect(page.locator('.app-editor-save')).toBeEnabled();
  await page.keyboard.press('ControlOrMeta+KeyK');
  const commands = page.getByRole('dialog', { name: 'Go anywhere', exact: true });
  await commands.getByRole('combobox', { name: 'Search actions', exact: true }).fill('Go to agent');
  await commands.getByRole('option', { name: 'Go to agent', exact: true }).click();
  await expect(editor).toBeHidden();
  const review = await openChange(page);
  await expect(editor.getByRole('tab', { name: 'Change review', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.app-editor-save')).toBeDisabled();
  expect(await originalInput!.evaluate(element => element.isConnected)).toBe(true);
  const reviewInput = review.locator('textarea.inputarea');
  expect(await reviewInput.evaluate(element => (element as HTMLTextAreaElement).readOnly)).toBe(true);
  await reviewInput.focus(); await page.keyboard.press('ControlOrMeta+KeyS'); await page.keyboard.press('ControlOrMeta+Shift+KeyS');
  expect(fixture.writes).toEqual([]);
  await review.getByRole('button', { name: 'Next patch page', exact: true }).click();
  await expect(review).toContainText('Characters 16,001');
  expect(fixture.detailCalls.at(-1)?.searchParams.get('version')).toBe(version);
  await review.getByRole('combobox', { name: 'Changed file or patch section', exact: true }).click();
  await page.getByRole('option', { name: 'Change 2: removed.ts', exact: true }).click();
  await expect(review.locator('.view-lines')).toContainText('deleted-recorded-content');
  expect(fixture.fileReads).not.toContain('removed.ts');
  await editor.getByRole('tab', { name: 'working.ts', exact: true }).click();
  await expect(working).toBeVisible();
  await expect(editor.locator('.editor-document-area .view-lines')).toContainText('unsaved buffer remains');
  expect(await originalInput!.evaluate(element => element.isConnected)).toBe(true);
  await expect(page.locator('.app-editor-save')).toBeEnabled();
  const saved = await (await page.request.get(`/api/workspaces/${fixture.workspace.id}/file`, { params: { path: 'working.ts' } })).json();
  expect(saved.content).toBe(original);
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test('phone Open changes selects the editor surface instead of leaving review behind the file tree', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await setup(page, 'agent');
  const review = await openChange(page);
  await expect(page.locator('.editor-panel')).toHaveAttribute('data-mobile-view', 'editor');
  await expect(page.getByRole('region', { name: 'Code editor', exact: true })).toBeVisible();
  await expect(review.locator('textarea.inputarea')).toBeVisible();
  await review.getByRole('button', { name: 'Show files', exact: true }).click();
  await expect(page.locator('.editor-panel')).toHaveAttribute('data-mobile-view', 'files');
  expect(fixture.errors).toEqual([]);
});
