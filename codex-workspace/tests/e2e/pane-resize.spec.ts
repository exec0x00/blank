import { expect, test as base, type CDPSession, type Locator, type Page } from '@playwright/test';
import type { Bootstrap, FileContent, TerminalSession, UiLayoutPreferences, UiLayoutProfile, UiState, UiStateChange, UiStatePatch, Workspace, WorkspaceDeleteResult } from '../../shared/types';

const password = process.env.PLAYWRIGHT_PASSWORD || 'browser-test-workspace-password';
const headers = { 'X-Codex-Workspace': '1' };
const filePath = 'resize.ts';
const original = 'export const value = "saved";\n';
const unsaved = 'export const value = "unsaved text survives pane resizing";\n';
const defaultWidths = { agentWidthRatio: 0.36, explorerWidth: 240 };
const desktop = { width: 1440, height: 960, profile: 'desktop' as const };
const laptop = { width: 1280, height: 850, profile: 'laptop' as const };
const splitters = [
  { name: 'Resize agent and editor', key: 'agentWidthRatio', delta: 64 },
  { name: 'Resize editor and explorer', key: 'explorerWidth', delta: -48 },
] as const;
type Splitter = typeof splitters[number];
type Viewport = { width: number; height: number; profile: UiLayoutProfile };
type Box = { x: number; y: number; width: number; height: number };
type Geometry = { agent: Box; editor: Box; explorer: Box };
type PaneApp = {
  prepare(viewport: Viewport, preferences?: UiLayoutPreferences): Promise<Workspace>;
  createWorkspace(label: string): Promise<Workspace>;
  setLayout(profile: UiLayoutProfile, preferences: UiLayoutPreferences): Promise<void>;
};

async function savedState(page: Page): Promise<UiState> {
  const response = await page.request.get('/api/ui-state');
  expect(response.status()).toBe(200);
  return response.json();
}

async function savedWidths(page: Page, profile: UiLayoutProfile) {
  const layout = (await savedState(page)).layouts[profile];
  return { agentWidthRatio: layout?.agentWidthRatio, explorerWidth: layout?.explorerWidth };
}

async function patchLayout(page: Page, profile: UiLayoutProfile, preferences: UiLayoutPreferences) {
  const changes = Object.entries(preferences).map(([key, value]) => ({ section: 'layout', profile, key, value }) as UiStateChange);
  // A pagehide flush can finish while the fixture restores its original layout.
  for (let attempt = 0; attempt < 3; attempt++) {
    const revision = (await savedState(page)).revision;
    const response = await page.request.patch('/api/ui-state', { headers, data: { revision, changes } });
    if (response.status() === 409) continue;
    expect(response.status()).toBe(200);
    return;
  }
  throw new Error('Could not save the pane fixture layout after three revision conflicts.');
}

const test = base.extend<{ paneApp: PaneApp }>({
  paneApp: async ({ page }, use) => {
    const owned: Workspace[] = [];
    const touchedProfiles = new Set<UiLayoutProfile>();
    let initial: UiState | undefined;
    let previousWorkspaceId: string | null = null;
    const initialize = async () => {
      if (initial) return;
      expect((await page.request.post('/api/session', { headers, data: { password } })).status()).toBe(200);
      initial = await savedState(page);
      const response = await page.request.get('/api/bootstrap');
      expect(response.status()).toBe(200);
      previousWorkspaceId = ((await response.json()) as Bootstrap).activeWorkspaceId;
    };
    const createWorkspace = async (label: string) => {
      await initialize();
      const response = await page.request.post('/api/workspaces', { headers, data: {
        name: `Pane resize ${label} ${Date.now()} ${owned.length}`, initializeGit: false,
      } });
      expect(response.status()).toBe(201);
      const workspace = await response.json() as Workspace;
      owned.push(workspace);
      expect((await page.request.post(`/api/workspaces/${workspace.id}/files`, { headers, data: { path: filePath, kind: 'file' } })).ok()).toBe(true);
      expect((await page.request.put(`/api/workspaces/${workspace.id}/file`, { headers, data: { path: filePath, content: original } })).ok()).toBe(true);
      return workspace;
    };
    const setLayout = async (profile: UiLayoutProfile, preferences: UiLayoutPreferences) => {
      await initialize();
      touchedProfiles.add(profile);
      await patchLayout(page, profile, preferences);
    };
    try {
      await use({ createWorkspace, setLayout, prepare: async (viewport, preferences = {}) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const workspace = await createWorkspace(viewport.profile);
        expect((await page.request.patch(`/api/workspaces/${workspace.id}`, { headers, data: { active: true } })).ok()).toBe(true);
        await setLayout(viewport.profile, { view: 'editor', split: 'split', ...defaultWidths, ...preferences });
        await page.goto('/work');
        await expect(page.locator('.app-shell')).toBeVisible();
        await expect(page.locator('.topbar-workspace')).toHaveText(workspace.name);
        return workspace;
      } });
    } finally {
      if (initial) {
        if (!page.isClosed()) {
          await page.keyboard.press('Escape');
          await page.mouse.up();
          // Only this fixture's document is being closed; discard its test edits.
          page.on('dialog', dialog => { void dialog.accept(); });
          await page.goto('about:blank');
        }
        for (const workspace of owned) {
          const response = await page.request.get(`/api/workspaces/${workspace.id}/terminals`);
          expect(response.status()).toBe(200);
          for (const terminal of await response.json() as TerminalSession[]) {
            expect((await page.request.delete(`/api/terminals/${terminal.id}`, { headers })).ok()).toBe(true);
          }
          let removed: { status: number; body: WorkspaceDeleteResult | { code?: string } } | undefined;
          // Closing a terminal tab precedes verified shell/descendant exit.
          // Only that explicit busy fence may postpone this fixture's cleanup.
          await expect.poll(async () => {
            const response = await page.request.delete(`/api/workspaces/${workspace.id}`, { headers, data: { expectedMode: 'trash' } });
            removed = { status: response.status(), body: await response.json() };
            return removed.status === 409 && 'code' in removed.body && removed.body.code === 'WORKSPACE_BUSY';
          }, { message: 'The closed fixture terminals must settle before workspace deletion.' }).toBe(false);
          expect(removed?.status, JSON.stringify(removed?.body)).toBe(200);
          const result = removed!.body as WorkspaceDeleteResult;
          if (result.mode !== 'trash') throw new Error('An ordinary pane test workspace unexpectedly required permanent deletion.');
          // Purge only the exact trash entry created from this fixture's workspace.
          expect((await page.request.delete(`/api/workspace-trash/${result.trash.id}`, { headers })).ok()).toBe(true);
        }
        for (const profile of touchedProfiles) {
          // The API cannot unset absent optional fields. Restore previous values,
          // or the neutral fixture defaults for fields initialized by this file.
          await patchLayout(page, profile, { view: 'agent', split: 'focus', ...defaultWidths, ...initial.layouts[profile] });
        }
        if (previousWorkspaceId) {
          const previous = await page.request.get(`/api/workspaces/${previousWorkspaceId}`);
          if (previous.status() !== 404) {
            expect(previous.status()).toBe(200);
            expect((await page.request.patch(`/api/workspaces/${previousWorkspaceId}`, { headers, data: { active: true } })).ok()).toBe(true);
          }
        }
      }
    }
  },
});

const separator = (page: Page, splitter: Splitter) => page.getByRole('separator', { name: splitter.name, exact: true });

async function box(locator: Locator): Promise<Box> {
  const result = await locator.boundingBox();
  if (!result) throw new Error(`Expected a visible bounding box for ${locator}`);
  return result;
}

async function geometry(page: Page): Promise<Geometry> {
  const [agent, editor, explorer] = await Promise.all([
    box(page.locator('#agent-workbench')),
    box(page.locator('#editor-workbench .editor-main')),
    box(page.locator('#editor-workbench .editor-sidebar')),
  ]);
  return { agent, editor, explorer };
}

function near(actual: number, expected: number, message: string) {
  expect(Math.abs(actual - expected), message).toBeLessThanOrEqual(1.5);
}

async function expectGeometry(page: Page, expected: Geometry) {
  await expect.poll(async () => {
    const actual = await geometry(page);
    return Math.max(...(['agent', 'editor', 'explorer'] as const).flatMap(key => [
      Math.abs(actual[key].x - expected[key].x), Math.abs(actual[key].width - expected[key].width),
    ]));
  }).toBeLessThanOrEqual(1.5);
}

async function expectThreePanes(page: Page) {
  await expect(page.locator('#agent-workbench')).toBeVisible();
  await expect(page.locator('#editor-workbench .editor-main')).toBeVisible();
  await expect(page.locator('#editor-workbench .editor-sidebar')).toBeVisible();
  for (const splitter of splitters) {
    await expect(separator(page, splitter)).toBeVisible();
    await expect(separator(page, splitter)).toHaveAttribute('aria-orientation', 'vertical');
    await expect(separator(page, splitter)).toHaveAttribute('tabindex', '0');
    for (const attribute of ['aria-valuemin', 'aria-valuemax', 'aria-valuenow']) {
      await expect(separator(page, splitter)).toHaveAttribute(attribute, /^\d+(?:\.\d+)?$/);
    }
  }
  await expect.poll(async () => {
    const { agent, editor, explorer } = await geometry(page);
    return agent.width >= 299 && editor.width >= 319 && explorer.width >= 179
      && agent.x + agent.width <= editor.x + 1 && editor.x + editor.width <= explorer.x + 1
      && explorer.x + explorer.width <= page.viewportSize()!.width + 1;
  }).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

async function openFile(page: Page) {
  await page.locator('#editor-workbench').getByRole('treeitem', { name: filePath, exact: true }).click();
  await expect(page.locator('#editor-workbench .monaco-editor textarea.inputarea').first()).toBeVisible();
}

async function editFile(page: Page, options: { paste?: boolean } = {}) {
  const input = page.locator('#editor-workbench .monaco-editor textarea.inputarea').first();
  await input.focus();
  await page.keyboard.press('ControlOrMeta+KeyA');
  if (options.paste) {
    // Native paste is one undo transaction. insertText follows Monaco's typing
    // boundaries, including a separate undo stop for the final newline.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin });
    await page.evaluate(text => navigator.clipboard.writeText(text), unsaved);
    await page.keyboard.press('ControlOrMeta+KeyV');
  } else await page.keyboard.insertText(unsaved);
  await expect(page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
}

async function savedFile(page: Page, workspace: Workspace) {
  const response = await page.request.get(`/api/workspaces/${workspace.id}/file`, { params: { path: filePath } });
  expect(response.status()).toBe(200);
  return ((await response.json()) as FileContent).content;
}

function observeWidthWrites(page: Page) {
  const writes: UiStateChange[] = [];
  page.on('request', request => {
    if (request.method() !== 'PATCH' || new URL(request.url()).pathname !== '/api/ui-state') return;
    const patch = request.postDataJSON() as UiStatePatch;
    writes.push(...patch.changes.filter(change => change.section === 'layout' && (change.key === 'agentWidthRatio' || change.key === 'explorerWidth')));
  });
  return writes;
}

async function expectDividerAt(divider: Locator, x: number) {
  await expect.poll(async () => Math.abs((await box(divider)).x - x)).toBeLessThanOrEqual(1.5);
}

async function beginMouseDrag(page: Page, divider: Locator, delta: number) {
  const start = await box(divider);
  // Observe browser capture without installing a production test hook.
  const captured = await divider.evaluateHandle(element => {
    const state = { value: false, pointerId: -1 };
    element.addEventListener('gotpointercapture', event => { state.value = true; state.pointerId = (event as PointerEvent).pointerId; }, { once: true });
    return state;
  });
  let pointerId = -1;
  try {
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(start.x + start.width / 2 + delta, start.y + start.height / 2, { steps: 6 });
    await expectDividerAt(divider, start.x + delta);
    await expect.poll(() => captured.evaluate(state => state.value)).toBe(true);
    pointerId = await captured.evaluate(state => state.pointerId);
  } finally { await captured.dispose(); }
  return { ...start, pointerId };
}

async function commitDrag(page: Page, profile: UiLayoutProfile, splitter: Splitter, delta: number) {
  const before = await savedWidths(page, profile);
  await beginMouseDrag(page, separator(page, splitter), delta);
  await page.mouse.up();
  await expect.poll(async () => (await savedWidths(page, profile))[splitter.key]).not.toBe(before[splitter.key]);
}

async function noWidthCommit(page: Page, profile: UiLayoutProfile, expected: Awaited<ReturnType<typeof savedWidths>>, writes: UiStateChange[], count = 0) {
  // A bounded absence check must span the real client's 300 ms save debounce.
  // Positive persistence checks below poll the actual API instead of sleeping.
  await page.waitForTimeout(600);
  expect(writes).toHaveLength(count);
  expect(await savedWidths(page, profile)).toEqual(expected);
}

for (const viewport of [desktop, laptop]) {
  test(`${viewport.profile} dragging both separators resizes adjacent panes and persists only released widths across reload`, async ({ page, paneApp }) => {
    await paneApp.prepare(viewport);
    await openFile(page);
    await expectThreePanes(page);
    const writes = observeWidthWrites(page);
    const initial = await geometry(page);
    const originalWidths = await savedWidths(page, viewport.profile);
    await beginMouseDrag(page, separator(page, splitters[0]), 64);
    const movedAgent = await geometry(page);
    near(movedAgent.agent.width, initial.agent.width + 64, 'The agent grows with its divider.');
    near(movedAgent.editor.width, initial.editor.width - 64, 'The adjacent editor gives up the same space.');
    near(movedAgent.explorer.width, initial.explorer.width, 'The nonadjacent explorer keeps its width.');
    near(movedAgent.explorer.x, initial.explorer.x, 'The explorer stays at the far right.');
    await noWidthCommit(page, viewport.profile, originalWidths, writes);
    await page.mouse.up();
    await expect.poll(async () => (await savedWidths(page, viewport.profile)).agentWidthRatio).toBeGreaterThan(originalWidths.agentWidthRatio!);

    const afterAgent = await savedWidths(page, viewport.profile);
    const writeCount = writes.length;
    await beginMouseDrag(page, separator(page, splitters[1]), -48);
    const movedExplorer = await geometry(page);
    near(movedExplorer.explorer.width, movedAgent.explorer.width + 48, 'Moving the right divider left grows the explorer.');
    near(movedExplorer.editor.width, movedAgent.editor.width - 48, 'Only the adjacent editor gives up width.');
    near(movedExplorer.agent.width, movedAgent.agent.width, 'The nonadjacent agent keeps its width.');
    near(movedExplorer.agent.x, movedAgent.agent.x, 'The agent remains anchored on the left.');
    await noWidthCommit(page, viewport.profile, afterAgent, writes, writeCount);
    await page.mouse.up();
    await expect.poll(async () => (await savedWidths(page, viewport.profile)).explorerWidth).toBe(afterAgent.explorerWidth! + 48);
    const committed = await savedWidths(page, viewport.profile);
    expect(committed.agentWidthRatio).toBeGreaterThanOrEqual(0.1);
    expect(committed.agentWidthRatio).toBeLessThanOrEqual(0.85);
    expect(Number.isInteger(committed.explorerWidth)).toBe(true);
    await page.reload();
    await expectThreePanes(page);
    await expect(page.locator('#editor-workbench').getByRole('tab', { name: filePath, exact: true })).toHaveAttribute('aria-selected', 'true');
    await expectGeometry(page, movedExplorer);
    expect(await savedWidths(page, viewport.profile)).toEqual(committed);
  });
}

for (const splitter of splitters) {
  test(`${splitter.name} supports keyboard steps and Home/End bounds with reduced motion`, async ({ page, paneApp }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await paneApp.prepare(desktop);
    await openFile(page);
    const divider = separator(page, splitter);
    await expectThreePanes(page);
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    await divider.focus();
    await expect(divider).toBeFocused();
    for (const [key, delta] of [['ArrowRight', 16], ['Shift+ArrowLeft', -48], ['ArrowLeft', -16], ['Shift+ArrowRight', 48]] as const) {
      const before = await box(divider);
      const saved = await savedWidths(page, 'desktop');
      await page.keyboard.press(key);
      await expectDividerAt(divider, before.x + delta);
      await expect(divider).toBeFocused();
      await expect.poll(async () => (await savedWidths(page, 'desktop'))[splitter.key]).not.toBe(saved[splitter.key]);
    }
    for (const [key, attribute] of [['Home', 'aria-valuemin'], ['End', 'aria-valuemax']] as const) {
      const before = await savedWidths(page, 'desktop');
      await divider.press(key);
      await expect.poll(async () => {
        const actual = Number(await divider.getAttribute('aria-valuenow'));
        const bound = Number(await divider.getAttribute(attribute));
        return Number.isFinite(actual) && Number.isFinite(bound) ? Math.abs(actual - bound) : Infinity;
      }).toBeLessThanOrEqual(1);
      await expectThreePanes(page);
      await expect.poll(async () => (await savedWidths(page, 'desktop'))[splitter.key]).not.toBe(before[splitter.key]);
    }
    const committed = await geometry(page);
    await page.reload();
    await expectThreePanes(page);
    await expectGeometry(page, committed);
  });
}

test('Escape cancels either active drag without saving or leaving a captured pointer behind', async ({ page, paneApp }) => {
  await paneApp.prepare(desktop);
  await openFile(page);
  await expectThreePanes(page);
  const writes = observeWidthWrites(page);
  for (const splitter of splitters) {
    const originalGeometry = await geometry(page);
    const preferences = await savedWidths(page, 'desktop');
    const divider = separator(page, splitter);
    const start = await beginMouseDrag(page, divider, splitter.delta);
    await noWidthCommit(page, 'desktop', preferences, writes);
    await page.keyboard.press('Escape');
    await expectGeometry(page, originalGeometry);
    await expect.poll(() => divider.evaluate((element, pointerId) => element.hasPointerCapture(pointerId), start.pointerId)).toBe(false);
    // Moving the still-depressed pointer after Escape must not resume the drag.
    await page.mouse.move(start.x + start.width / 2 + splitter.delta + 24, start.y + start.height / 2);
    await page.mouse.up();
    await expectGeometry(page, originalGeometry);
    await noWidthCommit(page, 'desktop', preferences, writes);
  }
  await commitDrag(page, 'desktop', splitters[0], 32);
  expect(writes.length).toBeGreaterThan(0);
});

test.describe('native touch pane resizing', () => {
  test.use({ hasTouch: true });
  test('touch grips resize both panes and native pointer cancellation restores uncommitted dimensions', async ({ page, paneApp }) => {
    await paneApp.prepare(desktop);
    await openFile(page);
    await expectThreePanes(page);
    const writes = observeWidthWrites(page);
    const client: CDPSession = await page.context().newCDPSession(page);
    const startTouch = async (divider: Locator, delta: number) => {
      const start = await box(divider);
      const grip = await box(divider.locator('[data-pane-splitter-grip]'));
      expect(grip.width).toBeGreaterThanOrEqual(44);
      expect(grip.height).toBeGreaterThanOrEqual(44);
      const x = grip.x + grip.width / 2, y = grip.y + grip.height / 2;
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      for (let step = 1; step <= 4; step++) {
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + delta * step / 4, y, id: 1 }] });
      }
      await expectDividerAt(divider, start.x + delta);
    };
    try {
      for (const splitter of splitters) {
        const divider = separator(page, splitter);
        const before = await savedWidths(page, 'desktop');
        const writeCount = writes.length;
        await startTouch(divider, splitter.delta);
        await noWidthCommit(page, 'desktop', before, writes, writeCount);
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect.poll(async () => (await savedWidths(page, 'desktop'))[splitter.key]).not.toBe(before[splitter.key]);
        const committed = await savedWidths(page, 'desktop');
        const committedGeometry = await geometry(page);
        const committedWrites = writes.length;
        await startTouch(divider, -splitter.delta);
        // CDP sends a native touchCancel, causing a real browser pointercancel.
        await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
        await expectGeometry(page, committedGeometry);
        await noWidthCommit(page, 'desktop', committed, writes, committedWrites);
      }
      const committed = await geometry(page);
      await page.reload();
      await expectThreePanes(page);
      await expectGeometry(page, committed);
    } finally {
      await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }).catch(() => undefined);
      await client.detach();
    }
  });
});

test('viewport clamping keeps all three panes usable and restores independent desktop and laptop preferences', async ({ page, paneApp }) => {
  await paneApp.setLayout('laptop', { view: 'editor', split: 'split', agentWidthRatio: 0.31, explorerWidth: 200 });
  await paneApp.setLayout('tablet', { view: 'agent', split: 'focus' });
  await paneApp.setLayout('mobile', { view: 'agent', split: 'focus' });
  const wide = { width: 1840, height: 960, profile: 'desktop' as const };
  await paneApp.prepare(wide, { agentWidthRatio: 0.47, explorerWidth: 420 });
  await openFile(page);
  await expectThreePanes(page);
  const wideGeometry = await geometry(page);
  const editorNode = await page.locator('#editor-workbench .monaco-editor').first().elementHandle();
  const desktopWidths = await savedWidths(page, 'desktop');
  const laptopWidths = await savedWidths(page, 'laptop');
  const writes = observeWidthWrites(page);
  await page.setViewportSize({ width: 1360, height: 960 });
  await expectThreePanes(page);
  const clamped = await geometry(page);
  expect(clamped.editor.width).toBeLessThan(wideGeometry.editor.width);
  await noWidthCommit(page, 'desktop', desktopWidths, writes);
  await page.setViewportSize({ width: wide.width, height: wide.height });
  await expectGeometry(page, wideGeometry);
  await page.setViewportSize({ width: 1359, height: 900 });
  await expectThreePanes(page);
  near((await geometry(page)).explorer.width, laptopWidths.explorerWidth!, 'The laptop profile restores its own explorer width.');
  await noWidthCommit(page, 'laptop', laptopWidths, writes);
  await commitDrag(page, 'laptop', splitters[0], 32);
  const committedLaptop = await savedWidths(page, 'laptop');
  const writeCount = writes.length;
  await page.setViewportSize({ width: 1000, height: 900 });
  await expectThreePanes(page);
  await noWidthCommit(page, 'laptop', committedLaptop, writes, writeCount);
  for (const width of [820, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const splitter of splitters) await expect(separator(page, splitter)).toHaveCount(0);
    await expect(page.locator('#agent-workbench')).toBeVisible();
    const navigation = page.getByRole('navigation', { name: width < 680 ? 'Mobile navigation' : 'Main navigation', exact: true });
    await navigation.getByRole('button', { name: width < 680 ? 'Files' : 'Editor', exact: true }).click();
    await expect(page.locator('#editor-workbench .monaco-editor textarea.inputarea').first()).toBeVisible();
    expect(await editorNode!.evaluate(node => node.isConnected)).toBe(true);
  }
  await page.setViewportSize({ width: wide.width, height: wide.height });
  await expectThreePanes(page);
  await expectGeometry(page, wideGeometry);
  expect(await savedWidths(page, 'desktop')).toEqual(desktopWidths);
  expect(await savedWidths(page, 'laptop')).toEqual(committedLaptop);
});

test('saved pane widths apply across workspace switches through the top bar', async ({ page, paneApp }) => {
  const first = await paneApp.prepare(desktop);
  await openFile(page);
  await expectThreePanes(page);
  await commitDrag(page, 'desktop', splitters[0], 48);
  await commitDrag(page, 'desktop', splitters[1], -32);
  const preferences = await savedWidths(page, 'desktop');
  const resized = await geometry(page);
  const second = await paneApp.createWorkspace('second');
  for (const workspace of [second, first]) {
    await page.locator('.topbar-workspace').click();
    const dialog = page.getByRole('dialog', { name: 'Your workspaces', exact: true });
    await dialog.getByRole('textbox', { name: 'Find a workspace', exact: true }).fill(workspace.name);
    await dialog.locator('.workspace-select').filter({ hasText: workspace.name }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.topbar-workspace')).toHaveText(workspace.name);
    await expectThreePanes(page);
    await expectGeometry(page, resized);
    expect(await savedWidths(page, 'desktop')).toEqual(preferences);
  }
});

test('resizing and pane toggles preserve Monaco undo, dirty buffers, the chat draft and the original live PTY', async ({ page, paneApp }) => {
  const errors: string[] = [];
  const sockets: { closed: boolean }[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => {
    if (!socket.url().includes('/ws/terminal')) return;
    const record = { closed: false };
    sockets.push(record);
    socket.on('close', () => { record.closed = true; });
  });
  const workspace = await paneApp.prepare(desktop);
  await openFile(page);
  await editFile(page, { paste: true });
  const agent = page.locator('#agent-workbench');
  const editor = page.locator('#editor-workbench');
  const draft = agent.locator('.chat-composer textarea');
  const save = page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true });
  await draft.fill('Keep this unsent pane resize draft.');
  const editorNode = await editor.locator('.monaco-editor').first().elementHandle();
  const chatNode = await agent.locator('.chat-panel').elementHandle();
  const navigation = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  await navigation.getByRole('button', { name: 'Terminal', exact: true }).click();
  const terminal = page.locator('.terminal-surface:not([hidden])');
  await expect(terminal).toHaveAttribute('data-connection', 'connected');
  const terminalNode = await terminal.elementHandle();
  const sessionsResponse = await page.request.get(`/api/workspaces/${workspace.id}/terminals`);
  expect(sessionsResponse.status()).toBe(200);
  const sessions = await sessionsResponse.json() as TerminalSession[];
  expect(sessions).toHaveLength(1);
  expect(sessions[0].pid).toBeGreaterThan(0);
  expect(sockets).toEqual([{ closed: false }]);
  await commitDrag(page, 'desktop', splitters[0], 48);
  await commitDrag(page, 'desktop', splitters[1], -32);
  const resized = await geometry(page);
  for (const name of ['Agent', 'Editor']) {
    await navigation.getByRole('button', { name, exact: true }).click();
    await expect(page.locator(name === 'Agent' ? '#agent-workbench' : '#editor-workbench')).toBeHidden();
    await navigation.getByRole('button', { name, exact: true }).click();
    await expectThreePanes(page);
    await expectGeometry(page, resized);
  }
  expect(await editorNode!.evaluate(node => node.isConnected && node === document.querySelector('#editor-workbench .monaco-editor'))).toBe(true);
  expect(await chatNode!.evaluate(node => node.isConnected)).toBe(true);
  expect(await terminalNode!.evaluate(node => node.isConnected)).toBe(true);
  await expect(draft).toHaveValue('Keep this unsent pane resize draft.');
  await expect(save).toBeEnabled();
  await expect(editor.locator('.view-lines').first()).toContainText('unsaved text survives pane resizing');
  expect(await savedFile(page, workspace)).toBe(original);
  const input = editor.locator('.monaco-editor textarea.inputarea').first();
  await input.focus();
  await page.keyboard.press('ControlOrMeta+KeyZ');
  await expect(save).toBeDisabled();
  await expect(editor.locator('.view-lines').first()).toContainText('"saved"');
  await page.keyboard.press('ControlOrMeta+Shift+KeyZ');
  await expect(save).toBeEnabled();
  await expect(editor.locator('.view-lines').first()).toContainText('unsaved text survives pane resizing');

  // The marker is not contiguous in the echoed command: the shell must execute it.
  await terminal.locator('.xterm-helper-textarea').focus();
  await page.keyboard.insertText("printf 'PANE_%s\\n' 'RESIZE_PTY_ALIVE'");
  await page.keyboard.press('Enter');
  await expect(terminal.locator('.xterm-rows')).toContainText('PANE_RESIZE_PTY_ALIVE');
  const retainedResponse = await page.request.get(`/api/workspaces/${workspace.id}/terminals`);
  expect(retainedResponse.status()).toBe(200);
  const retained = await retainedResponse.json() as TerminalSession[];
  expect(retained.map(session => ({ id: session.id, pid: session.pid }))).toEqual(sessions.map(session => ({ id: session.id, pid: session.pid })));
  expect(sockets).toEqual([{ closed: false }]);
  await save.click();
  await expect.poll(() => savedFile(page, workspace)).toBe(unsaved);
  await expect(save).toBeDisabled();
  await draft.fill('');
  await page.getByRole('button', { name: `Close ${sessions[0].title}`, exact: true }).click();
  await expect(page.locator('.terminal-dock')).toBeHidden();
  expect(errors).toEqual([]);
});

for (const viewport of [
  { width: 820, height: 1180, profile: 'tablet' as const },
  { width: 390, height: 844, profile: 'mobile' as const },
]) {
  test(`${viewport.profile} keeps ordinary navigation and dirty editor buffers without pane splitters`, async ({ page, paneApp }) => {
    const workspace = await paneApp.prepare(viewport, { view: 'agent', split: 'focus' });
    const isPhone = viewport.profile === 'mobile';
    const navigation = page.getByRole('navigation', { name: isPhone ? 'Mobile navigation' : 'Main navigation', exact: true });
    const editorButton = navigation.getByRole('button', { name: isPhone ? 'Files' : 'Editor', exact: true });
    const agentButton = navigation.getByRole('button', { name: 'Agent', exact: true });
    const draft = page.locator('#agent-workbench .chat-composer textarea');
    const writes = observeWidthWrites(page);
    await draft.fill('Small screen draft survives navigation.');
    for (const splitter of splitters) await expect(separator(page, splitter)).toHaveCount(0);
    await editorButton.click();
    await openFile(page);
    await editFile(page);
    const editorNode = await page.locator('#editor-workbench .monaco-editor').first().elementHandle();
    for (const splitter of splitters) await expect(separator(page, splitter)).toHaveCount(0);
    await agentButton.click();
    if (isPhone) await agentButton.click();
    await expect(page.locator('#agent-workbench')).toBeVisible();
    await expect(page.locator('#editor-workbench')).toBeHidden();
    await expect(draft).toHaveValue('Small screen draft survives navigation.');
    await editorButton.click();
    if (isPhone) {
      await editorButton.click();
      await expect(editorButton).toHaveAttribute('aria-current', 'page');
      expect(await editorButton.getAttribute('aria-pressed')).toBeNull();
    }
    await expect(page.locator('#editor-workbench .view-lines').first()).toContainText('unsaved text survives pane resizing');
    expect(await editorNode!.evaluate(node => node.isConnected)).toBe(true);
    expect(await savedFile(page, workspace)).toBe(original);
    await page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => savedFile(page, workspace)).toBe(unsaved);
    await agentButton.click();
    await draft.fill('');
    await noWidthCommit(page, viewport.profile, defaultWidths, writes);
  });
}
