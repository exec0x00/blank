import { expect, test, type Locator, type Page } from '@playwright/test';
import type { GeneratedImageMetadata, ToolActivity } from '../../shared/types';
import type { CodexCapabilities, CodexModel, CodexRuntimeStatus } from '../../shared/codex-cli';
import { gitRewindFixture, type GitRewindFixture } from './git-rewind-fixture';
import { expandActivityGroups } from '../activity-group-browser';

// Shipped App + EditorPanel + useDocuments + Monaco, with explicit REST fixtures.
// These cases verify real dirty-buffer and synchronous editor-lock behavior.
// Durable image/file creation itself is covered by the delivery server tests.
// The image is a preserved legacy artifact. Native generation is not simulated,
// and the historical conversation is never sent to an agent mutation endpoint.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jgZkAAAAASUVORK5CYII=', 'base64');
interface Observation { readOnlyAtSave: boolean[][] }
type ObservedWindow = Window & { __generatedImageEditor: Observation };
const fixtures = new Map<Page, GitRewindFixture>();

async function fixture(page: Page) {
  await page.setViewportSize({ width: 1480, height: 960 });
  await page.addInitScript(() => {
    const observation: Observation = { readOnlyAtSave: [] };
    Object.assign(window, { __generatedImageEditor: observation });
    const fetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
      if (init?.method === 'POST' && /\/generated-images\/[^/]+\/save$/.test(url.pathname)) {
        observation.readOnlyAtSave.push([...document.querySelectorAll<HTMLTextAreaElement>('.monaco-editor textarea.inputarea')].map(input => input.readOnly));
      }
      return fetch(input, init);
    };
  });
  const base = await gitRewindFixture(page);
  fixtures.set(page, base);
  for (const thread of [base.root, base.otherThread, base.remoteThread]) { thread.backend = 'legacy'; thread.readOnly = true; }
  const capabilities: CodexCapabilities = { conversations: true, pagination: true, queue: true, goals: true, skills: true, plan: true, review: true, historyRevert: true };
  const model: CodexModel = { id: 'preserved-image-native-catalog-row', model: 'fixture-rewind-model', displayName: 'Fixture native model',
    description: 'Controlled native catalog row; this case only views preserved artifacts.', hidden: false, isDefault: true,
    inputModalities: ['text', 'image'], defaultReasoningEffort: 'max', supportedReasoningEfforts: [{ reasoningEffort: 'max', description: 'Maximum' }] };
  const runtime: CodexRuntimeStatus = { backend: 'codex-cli', state: 'ready', version: '0.155.1', installedVersion: '0.155.1', startedAt: base.workspace.createdAt,
    updatedAt: base.workspace.updatedAt, canUpdate: true, updateBlockedReason: null, error: null, activeTurns: 0, capabilities };
  await page.context().route('https://**/*', route => { base.unexpected.push('Unexpected external request in preserved-image editor coverage.'); return route.abort(); });
  await page.route('**/api/codex/runtime', route => route.fulfill({ json: runtime }));
  await page.route('**/api/models', route => route.fulfill({ json: { backend: 'codex-cli', connected: true, catalog: [model], models: [model.model] } }));
  await page.route(url => url.pathname === '/api/threads', async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() !== 'GET') { base.unexpected.push('Preserved artifact attempted a conversation mutation.'); return route.fulfill({ status: 409, json: { error: 'Preserved conversations are read only.' } }); }
    const items = url.searchParams.get('backend') === 'legacy'
      ? [base.root, base.otherThread, base.remoteThread].filter(thread => thread.workspaceId === url.searchParams.get('workspaceId'))
        .map(({ messages: _messages, ...thread }) => thread) : [];
    return route.fulfill({ json: { items, olderCursor: null, newerCursor: null, hasOlder: false, hasNewer: false } });
  });
  await page.route(url => /^\/api\/threads\/[^/]+(?:\/|$)/.test(url.pathname), route => {
    if (route.request().method() === 'GET') return route.fallback();
    base.unexpected.push('Preserved artifact attempted a historical thread mutation.');
    return route.fulfill({ status: 409, json: { error: 'Preserved conversations are read only.' } });
  });
  const message = base.root.messages.at(-1)!;
  const image: GeneratedImageMetadata = { id: `img_${'c'.repeat(64)}`, sha256: 'd'.repeat(64), workspaceId: base.workspace.id, threadId: base.root.id, messageId: message.id,
    runId: 'fixture-image-run', itemId: 'ig_fixture_editor', state: 'completed', mimeType: 'image/png', bytes: png.length, width: 1, height: 1, createdAt: '2026-09-20T12:00:00.000Z',
    revisedPrompt: 'A simple circle.', previewUrl: `/api/workspaces/${base.workspace.id}/generated-images/img_${'c'.repeat(64)}/content?sha256=${'d'.repeat(64)}` };
  const activity: ToolActivity = { id: 'fixture-generated-image', name: 'generate_image', input: '{"prompt":"Draw a circle."}', output: '{"status":"completed","notice":"The image is saved."}',
    generatedImage: image, status: 'completed', startedAt: image.createdAt, completedAt: image.createdAt };
  message.activities = [activity];
  const before = 'The generated image is ready.\n', after = 'Choose a destination to save it.';
  message.content = before + after;
  base.root.timeline = { version: 1, revision: 1, nextSequence: 7, entries: [
    { id: 'fixture-user-one', sequence: 1, revision: 1, messageId: base.root.messages[0].id, kind: 'message' },
    { id: 'fixture-response-one', sequence: 2, revision: 1, messageId: base.root.messages[1].id, kind: 'text', text: base.root.messages[1].content, startOffset: 0 },
    { id: 'fixture-user-two', sequence: 3, revision: 1, messageId: base.root.messages[2].id, kind: 'message' },
    { id: 'fixture-image-before', sequence: 4, revision: 1, messageId: message.id, kind: 'text', text: before, startOffset: 0 },
    { id: 'fixture-image-action', sequence: 5, revision: 1, messageId: message.id, kind: 'activity', activityId: activity.id },
    { id: 'fixture-image-after', sequence: 6, revision: 1, messageId: message.id, kind: 'text', text: after, startOffset: before.length },
  ] };
  const saves: Record<string, unknown>[] = [];
  let gate: { started: boolean; wait: Promise<void>; release(): void } | undefined;
  const held: Array<{ release(): void }> = [];
  await page.route(/\/api\/workspaces\/[^/]+\/generated-images\/[^/]+\/(?:content|save)(?:\?.*)?$/, async route => {
    const request = route.request();
    if (new URL(request.url()).pathname.endsWith('/content')) return route.fulfill({ contentType: 'image/png', body: png });
    const body = request.postDataJSON() as Record<string, unknown>;
    saves.push(body);
    const pending = gate; gate = undefined;
    if (pending) { pending.started = true; await pending.wait; }
    const path = String(body.path);
    return route.fulfill({ status: 201, json: { image, path, version: image.sha256, entry: { name: path.split('/').at(-1), path, kind: 'file', size: image.bytes } } });
  });
  await page.goto('/work');
  const panel = page.getByRole('region', { name: 'Codex conversation', exact: true });
  await panel.locator('button:is([title="Conversation history"], [data-tooltip-title="Conversation history"])').click();
  const history = page.getByRole('dialog', { name: 'Conversations', exact: true });
  await history.getByRole('combobox', { name: 'Conversation source', exact: true }).click();
  await page.getByRole('option', { name: 'Preserved history Read only', exact: true }).click();
  await history.locator('.chat-history-select').filter({ hasText: base.root.title }).click();
  await expect(panel.getByText('Preserved conversation · Read only', { exact: true })).toBeVisible();
  await expect(panel.getByRole('textbox', { name: 'Message Codex', exact: true })).toHaveCount(0);
  await expect(panel.locator('.chat-activity-group-toggle').first()).toBeVisible();
  await expandActivityGroups(panel);
  await expect(page.getByRole('button', { name: 'Save to workspace', exact: true })).toBeEnabled();
  return { base, image, saves,
    holdSave() {
      let release!: () => void;
      gate = { started: false, wait: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
      held.push(gate); return gate;
    },
    releaseAll: () => held.forEach(value => value.release()),
  };
}

async function openFile(page: Page, path: string) {
  const split = page.getByRole('button', { name: 'Show editor and agent side by side', exact: true });
  if (await split.isVisible()) await split.click();
  await page.locator('.app-topbar').getByRole('button', { name: 'Go to file', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Go to file', exact: true });
  const search = dialog.getByRole('combobox', { name: 'Find a file by name or path', exact: true });
  await search.fill(path); await expect(dialog.getByRole('option')).toHaveCount(1); await search.press('Enter');
  const editor = page.getByRole('region', { name: 'Code editor', exact: true });
  await expect(editor.getByRole('tab', { name: path.split('/').at(-1)!, exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(editor.locator('.monaco-editor textarea.inputarea').first()).toBeVisible();
  return editor;
}

async function edit(page: Page, editor: Locator, name: string, text: string) {
  await editor.locator('.monaco-editor textarea.inputarea').first().focus();
  await page.keyboard.press('ControlOrMeta+KeyA'); await page.keyboard.insertText(text);
  await expect(editor.getByRole('button', { name: `Close ${name} (unsaved)`, exact: true })).toBeVisible();
}

test.afterEach(async ({ page }) => {
  const current = fixtures.get(page); current?.releaseAll(); fixtures.delete(page);
  if (current) { expect(current.unexpected).toEqual([]); expect(current.pageErrors).toEqual([]); }
});

test('real dirty ancestor blocks image Save before POST and an unrelated destination preserves the exact Monaco buffer', async ({ page }) => {
  const current = await fixture(page);
  const editor = await openFile(page, 'src/changed.ts');
  const draft = 'export const parserVersion = "keep this unsaved image-save buffer";\n';
  await edit(page, editor, 'changed.ts', draft);
  await page.getByRole('button', { name: 'Save to workspace', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save image to workspace', exact: true });
  const path = dialog.getByRole('textbox', { name: 'Workspace file path', exact: true });
  await path.fill('src/changed.ts/circle.png');
  await dialog.getByRole('button', { name: 'Save image', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('unsaved');
  expect(current.saves).toEqual([]);
  await expect(editor.getByRole('button', { name: 'Close changed.ts (unsaved)', exact: true })).toBeVisible();
  await path.fill('images/new-circle.png');
  await dialog.getByRole('button', { name: 'Save image', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(current.saves).toEqual([{ sha256: current.image.sha256, path: 'images/new-circle.png', threadId: current.image.threadId }]);
  await expect(editor.getByRole('button', { name: 'Close changed.ts (unsaved)', exact: true })).toBeVisible();
  await page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => current.base.file('src/changed.ts')).toBe(draft);
  expect(current.base.fileWrites().map(request => request.body?.content)).toEqual([draft]);
});

test('image save freezes the actual editor before fetch, then releases it with the same unsaved buffer', async ({ page }) => {
  const current = await fixture(page);
  const editor = await openFile(page, 'notes/unrelated.ts');
  const draft = 'export const unrelated = "preserve this exact buffer while an image is saved";\n';
  await edit(page, editor, 'unrelated.ts', draft);
  const input = editor.locator('.monaco-editor textarea.inputarea').first();
  const pending = current.holdSave();
  try {
    await page.getByRole('button', { name: 'Save to workspace', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Save image to workspace', exact: true });
    await dialog.getByRole('textbox', { name: 'Workspace file path', exact: true }).fill('images/held.png');
    await dialog.getByRole('button', { name: 'Save image', exact: true }).click();
    await expect.poll(() => pending.started).toBe(true);
    const observed = await page.evaluate(() => (window as unknown as ObservedWindow).__generatedImageEditor.readOnlyAtSave);
    expect(observed).toHaveLength(1); expect(observed[0].length).toBeGreaterThan(0); expect(observed[0].every(Boolean)).toBe(true);
    await expect(input).toHaveAttribute('readonly', 'true');
    await expect(page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await input.focus(); await page.keyboard.type('UNEXPECTED_IMAGE_SAVE_EDIT'); await page.keyboard.press('ControlOrMeta+KeyS');
    expect(current.base.fileWrites()).toEqual([]);
    pending.release();
    await expect(input).not.toHaveAttribute('readonly');
    await expect(editor.getByRole('button', { name: 'Close unrelated.ts (unsaved)', exact: true })).toBeVisible();
    await page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => current.base.file('notes/unrelated.ts')).toBe(draft);
  } finally { current.releaseAll(); }
});
