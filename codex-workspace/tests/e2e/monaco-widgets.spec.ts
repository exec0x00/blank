import { expect, test, type Locator, type Page } from '@playwright/test';
import type { FileContent, Workspace } from '../../shared/types';

const headers = { 'X-Codex-Workspace': '1' };
const password = process.env.PLAYWRIGHT_PASSWORD || 'browser-test-workspace-password';
const completionPrefix = 'export const palette = { neutralBlack: "#000000", neutralGray: "#737373", neutralWhite: "#ffffff" };\npalette.';

async function prepareEditor(page: Page, label: string, content: string, path = 'widgets.ts') {
  expect((await page.request.post('/api/session', { headers, data: { password } })).status()).toBe(200);
  const created = await page.request.post('/api/workspaces', { headers, data: { name: `Monaco ${label} ${Date.now()}`, initializeGit: false } });
  expect(created.status()).toBe(201);
  const workspace = await created.json() as Workspace;
  expect((await page.request.post(`/api/workspaces/${workspace.id}/files`, { headers, data: { path, kind: 'file' } })).status()).toBe(201);
  expect((await page.request.put(`/api/workspaces/${workspace.id}/file`, { headers, data: { path, content } })).ok()).toBe(true);
  expect((await page.request.patch(`/api/workspaces/${workspace.id}`, { headers, data: { active: true } })).ok()).toBe(true);

  const width = page.viewportSize()!.width;
  const profile = width >= 1360 ? 'desktop' : width >= 1000 ? 'laptop' : width >= 680 ? 'tablet' : 'mobile';
  const preferences = await page.request.get('/api/ui-state');
  expect(preferences.ok()).toBe(true);
  const { revision } = await preferences.json();
  expect((await page.request.patch('/api/ui-state', { headers, data: { revision, changes: [
    { section: 'layout', profile, key: 'view', value: 'editor' },
    { section: 'layout', profile, key: 'split', value: 'focus' },
    { section: 'layout', profile, key: 'sidebar', value: 'expanded' },
    { section: 'editor', key: 'wrap', value: false },
    { section: 'editor', key: 'minimap', value: false },
  ] } })).ok()).toBe(true);

  await page.goto('/work');
  await page.locator('.app-topbar').getByRole('button', { name: 'Go to file', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Go to file', exact: true });
  await expect(picker).toBeVisible();
  await picker.getByRole('option').filter({ hasText: path }).click();
  await expect(picker).toBeHidden();
  const editor = page.getByRole('region', { name: 'Code editor', exact: true });
  await expect(editor.getByRole('tab', { name: path, exact: true })).toHaveAttribute('aria-selected', 'true');
  const input = editor.locator('.monaco-editor textarea.inputarea').first();
  const save = page.locator('.app-topbar').getByRole('button', { name: 'Save', exact: true });
  await expect(input).toBeVisible();
  await expect(save).toBeDisabled();
  return { workspace, path, editor, input, save };
}

type EditorFixture = Awaited<ReturnType<typeof prepareEditor>>;

async function readSaved(page: Page, fixture: EditorFixture): Promise<FileContent> {
  const response = await page.request.get(`/api/workspaces/${fixture.workspace.id}/file`, { params: { path: fixture.path } });
  expect(response.status()).toBe(200);
  return response.json();
}

async function saveAndReadBack(page: Page, fixture: EditorFixture, expected: string) {
  await expect(fixture.save).toBeEnabled();
  await fixture.save.click();
  await expect.poll(async () => (await readSaved(page, fixture)).content).toBe(expected);
  await expect(fixture.save).toBeDisabled();
}

async function triggerCompletion(page: Page, input: Locator) {
  await input.focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Control+Space');
  const widget = page.locator('.suggest-widget:visible');
  await expect(widget).toBeVisible();
  await expect(widget.getByRole('listbox', { name: 'Suggest', exact: true })).toBeVisible();
  await expect(widget.locator('.monaco-list-row.focused .label-name')).toBeVisible();
  return widget;
}

async function openFind(page: Page, input: Locator) {
  await input.focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.press('ControlOrMeta+KeyF');
  const widget = page.locator('.find-widget.visible');
  await expect(widget).toBeVisible();
  await expect(widget.getByRole('textbox', { name: 'Find', exact: true })).toBeFocused();
  return widget;
}

async function expectWidgetSurface(widget: Locator) {
  await expect(widget).toHaveCSS('background-color', 'rgb(25, 25, 25)');
  await expect(widget).toHaveCSS('border-top-color', 'rgb(66, 66, 66)');
  await expect(widget).toHaveCSS('border-radius', '12px');
  expect(await widget.evaluate(element => [element, ...element.querySelectorAll('*')].flatMap(child => {
    const style = getComputedStyle(child);
    return style.boxShadow !== 'none' || style.textShadow !== 'none' || style.backdropFilter !== 'none'
      ? [{ className: child.getAttribute('class'), boxShadow: style.boxShadow, textShadow: style.textShadow, backdropFilter: style.backdropFilter }]
      : [];
  }))).toEqual([]);
}

async function expectUnclipped(page: Page, element: Locator) {
  await expect(element).toBeVisible();
  // IntersectionObserver also catches clipping by an editor ancestor, which a
  // viewport bounding-box check alone would miss for Monaco's overflow widgets.
  await expect(element).toBeInViewport({ ratio: 1 });
  const viewport = page.viewportSize()!;
  const bounds = await element.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(-1);
  expect(bounds!.y).toBeGreaterThanOrEqual(-1);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function expectNoWidgetMotion(widget: Locator) {
  expect(await widget.evaluate(element => [element, ...element.querySelectorAll('*')].flatMap(child => {
    const style = getComputedStyle(child);
    const hasDuration = (value: string) => value.split(',').some(duration => Number.parseFloat(duration) > 0);
    return hasDuration(style.transitionDuration) || hasDuration(style.animationDuration)
      ? [{ className: child.getAttribute('class'), transition: style.transitionDuration, animation: style.animationDuration }]
      : [];
  }))).toEqual([]);
}

test('keyboard TypeScript completions use neutral rounded rows and save the selected member', async ({ page }) => {
  const fixture = await prepareEditor(page, 'completion', `${completionPrefix}neutral`);
  const widget = await triggerCompletion(page, fixture.input);
  await expect(widget.getByRole('option')).toHaveCount(3);
  await expectWidgetSurface(widget);
  await expectUnclipped(page, widget);
  await expect(widget.locator('.suggest-status-bar')).toBeVisible();

  const row = widget.locator('.monaco-list-row.focused');
  const label = row.locator('.label-name');
  const initial = await label.innerText();
  expect(['neutralBlack', 'neutralGray', 'neutralWhite']).toContain(initial);
  await page.keyboard.press('ArrowDown');
  await expect(label).not.toHaveText(initial);
  const next = await label.innerText();
  await page.keyboard.press('ArrowUp');
  await expect(label).toHaveText(initial);
  await page.keyboard.press('ArrowDown');
  await expect(label).toHaveText(next);
  expect(['neutralBlack', 'neutralGray', 'neutralWhite']).toContain(next);

  await expect(row).toHaveCSS('background-color', 'rgb(44, 44, 44)');
  await expect(row).toHaveCSS('border-radius', '8px');
  await expect(row.locator('.highlight').first()).toHaveCSS('color', 'rgb(255, 255, 255)');
  expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(30);
  await expectUnclipped(page, row);
  await page.keyboard.press('Enter');
  await expect(widget).toBeHidden();
  await saveAndReadBack(page, fixture, `${completionPrefix}${next}`);
});

test('completion details expose real TypeScript documentation and leave the file unchanged until acceptance', async ({ page }) => {
  const prefix = [
    'export const toolkit = {',
    '  /** Reports a readable status for the workspace. */',
    '  describeWorkspace(): string { return "ready"; },',
    '};',
    'toolkit.',
  ].join('\n');
  const original = `${prefix}descr`;
  const fixture = await prepareEditor(page, 'completion details', original);
  const widget = await triggerCompletion(page, fixture.input);
  await expect(widget.locator('.monaco-list-row.focused .label-name')).toHaveText('describeWorkspace');
  await expect(widget.locator('.suggest-status-bar')).toContainText('Show More');
  await page.keyboard.press('Control+Space');
  const details = page.locator('.suggest-details:visible');
  await expect(details.locator('.docs')).toContainText('Reports a readable status for the workspace.');
  await expect(details.locator('.type')).toContainText('describeWorkspace');
  await expect(widget.locator('.suggest-status-bar')).toContainText('Show Less');
  await expectWidgetSurface(details);
  await expectUnclipped(page, details);

  await page.keyboard.press('Control+Alt+Space');
  await expect(details).toHaveClass(/\bfocused\b/);
  await expect(details).toHaveCSS('border-top-color', 'rgb(158, 158, 158)');
  await page.keyboard.press('Control+Alt+Space');
  await expect(details).not.toHaveClass(/\bfocused\b/);
  await expect(details).toHaveCSS('border-top-color', 'rgb(66, 66, 66)');
  await page.keyboard.press('Control+Space');
  await expect(details).toBeHidden();
  await expect(widget).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(widget).toBeHidden();
  await expect(fixture.input).toBeFocused();
  await expect(fixture.save).toBeDisabled();
  expect((await readSaved(page, fixture)).content).toBe(original);

  await triggerCompletion(page, fixture.input);
  await page.keyboard.press('Tab');
  await saveAndReadBack(page, fixture, `${prefix}describeWorkspace`);
});

test('find navigation, case and whole-word controls constrain a real replacement that can be undone', async ({ page }) => {
  const original = 'Alpha alpha alphabet ALPHA\nomega\n';
  const fixture = await prepareEditor(page, 'literal find', original, 'words.txt');
  const widget = await openFind(page, fixture.input);
  const find = widget.getByRole('textbox', { name: 'Find', exact: true });
  const count = widget.locator('.matchesCount');
  await find.fill('alpha');
  await expect(count).toHaveText(/\d+ of 4$/);
  const firstMatch = await count.innerText();
  await find.press('Enter');
  await expect(count).not.toHaveText(firstMatch);
  await find.press('Shift+Enter');
  await expect(count).toHaveText(firstMatch);
  await expectWidgetSurface(widget);
  const inputBox = widget.locator('.find-part .monaco-inputbox');
  await expect(inputBox).toHaveCSS('background-color', 'rgb(17, 17, 17)');
  await expect(inputBox).toHaveCSS('border-radius', '8px');
  await expect(inputBox).toHaveCSS('outline-color', 'rgb(158, 158, 158)');

  const matchCase = widget.getByRole('checkbox', { name: /^Match Case/ });
  const wholeWord = widget.getByRole('checkbox', { name: /^Match Whole Word/ });
  await find.press('Tab');
  await expect(matchCase).toBeFocused();
  await page.keyboard.press('Space');
  await expect(matchCase).toHaveAttribute('aria-checked', 'true');
  await expect(count).toHaveText(/\d+ of 2$/);
  await page.keyboard.press('ArrowRight');
  await expect(wholeWord).toBeFocused();
  await page.keyboard.press('Space');
  await expect(wholeWord).toHaveAttribute('aria-checked', 'true');
  await expect(count).toHaveText('1 of 1');

  await widget.getByRole('button', { name: /^Toggle Replace/ }).click();
  const replace = widget.getByRole('textbox', { name: 'Replace', exact: true });
  await expectUnclipped(page, widget);
  await expectUnclipped(page, replace);
  await replace.fill('neutral');
  await replace.press('Enter');
  await expect(count).toHaveText('No results');
  await widget.getByRole('button', { name: /^Close(?:\s|$)/ }).click();
  await saveAndReadBack(page, fixture, 'Alpha neutral alphabet ALPHA\nomega\n');

  await fixture.input.focus();
  await page.keyboard.press('ControlOrMeta+KeyZ');
  await saveAndReadBack(page, fixture, original);
});

test('invalid regex stays visible and recoverable before capture-group Replace All and undo', async ({ page }) => {
  const original = 'item-12 item-34 spare-56\n';
  const fixture = await prepareEditor(page, 'regular expressions', original, 'items.txt');
  const widget = await openFind(page, fixture.input);
  const find = widget.getByRole('textbox', { name: 'Find', exact: true });
  const regex = widget.getByRole('checkbox', { name: /^Use Regular Expression/ });
  await regex.focus();
  await regex.press('Space');
  await expect(regex).toHaveAttribute('aria-checked', 'true');
  await find.fill('[');
  await expect(find).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('.monaco-inputbox-message:visible')).toContainText(/Invalid regular expression|Unterminated character class/i);
  await expect(fixture.save).toBeDisabled();
  expect((await readSaved(page, fixture)).content).toBe(original);

  await find.fill('item-(\\d+)');
  await expect(find).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('.monaco-inputbox-message:visible')).toHaveCount(0);
  await expect(widget.locator('.matchesCount')).toHaveText(/\d+ of 2$/);
  await widget.getByRole('button', { name: /^Toggle Replace/ }).click();
  await widget.getByRole('textbox', { name: 'Replace', exact: true }).fill('entry-$1');
  const replaceAll = widget.getByRole('button', { name: /^Replace All(?:\s|$)/ });
  await expect(replaceAll).toBeEnabled();
  await replaceAll.click();
  await expect(widget.locator('.matchesCount')).toHaveText('No results');
  await widget.getByRole('button', { name: /^Close(?:\s|$)/ }).click();
  await saveAndReadBack(page, fixture, 'entry-12 entry-34 spare-56\n');

  await fixture.input.focus();
  await page.keyboard.press('ControlOrMeta+KeyZ');
  await saveAndReadBack(page, fixture, original);
});

test('reduced-motion tablet widgets remain usable without animated transitions', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const prefix = 'export const label = "quiet";\nlabel.';
  const fixture = await prepareEditor(page, 'reduced motion', `${prefix}toUpper`);
  const suggestions = await triggerCompletion(page, fixture.input);
  await expect(suggestions.locator('.monaco-list-row.focused .label-name')).toHaveText('toUpperCase');
  await expectNoWidgetMotion(suggestions);
  await expectUnclipped(page, suggestions);
  await page.keyboard.press('Control+Space');
  const details = page.locator('.suggest-details:visible');
  await expect(details.locator('.docs')).toContainText(/upper\s?case/i);
  await expectNoWidgetMotion(details);
  await expectUnclipped(page, details);
  await page.keyboard.press('Tab');
  await saveAndReadBack(page, fixture, `${prefix}toUpperCase`);

  const find = await openFind(page, fixture.input);
  await find.getByRole('textbox', { name: 'Find', exact: true }).fill('quiet');
  await find.getByRole('button', { name: /^Toggle Replace/ }).click();
  await expectNoWidgetMotion(find);
  await expectUnclipped(page, find);
  const replace = find.getByRole('textbox', { name: 'Replace', exact: true });
  await expectUnclipped(page, replace);
  await replace.fill('still');
  await replace.press('Enter');
  await find.getByRole('button', { name: /^Close(?:\s|$)/ }).click();
  await saveAndReadBack(page, fixture, 'export const label = "still";\nlabel.toUpperCase');
});

test.describe('phone Monaco widgets', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('touch completion and compact find controls fit the viewport and save real edits', async ({ page }) => {
    const fixture = await prepareEditor(page, 'phone', `${completionPrefix}neutral`);
    const suggestions = await triggerCompletion(page, fixture.input);
    const option = suggestions.getByRole('option', { name: /^neutralGray(?:,|$)/ });
    await expectWidgetSurface(suggestions);
    await expectUnclipped(page, suggestions);
    await expectUnclipped(page, option);
    expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await option.tap();
    await expect(suggestions).toBeHidden();
    const completed = `${completionPrefix}neutralGray`;
    await saveAndReadBack(page, fixture, completed);

    await fixture.editor.getByRole('button', { name: 'Find in file', exact: true }).tap();
    const find = page.locator('.find-widget.visible');
    const input = find.getByRole('textbox', { name: 'Find', exact: true });
    await input.fill('neutralGray');
    await expectWidgetSurface(find);
    await expectUnclipped(page, find);
    await expectUnclipped(page, input);
    const toggle = find.getByRole('button', { name: /^Toggle Replace/ });
    await expectUnclipped(page, toggle);
    await toggle.tap();
    const replace = find.getByRole('textbox', { name: 'Replace', exact: true });
    await expectUnclipped(page, find);
    await expectUnclipped(page, replace);
    await replace.fill('neutralStone');
    // Monaco keeps this keyboard action available when its narrow layout hides
    // individual find actions. Exercise the real command, without editor hooks.
    await replace.press('ControlOrMeta+Alt+Enter');
    const close = find.getByRole('button', { name: /^Close(?:\s|$)/ });
    await expectUnclipped(page, close);
    await close.tap();
    await saveAndReadBack(page, fixture, completed.replaceAll('neutralGray', 'neutralStone'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
