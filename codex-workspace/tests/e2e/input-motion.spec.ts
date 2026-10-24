import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Workspace } from '../../shared/types';

const headers = { 'X-Codex-Workspace': '1' };
const password = process.env.PLAYWRIGHT_PASSWORD || 'browser-test-workspace-password';
const caret = (page: Page) => page.locator('.cw-input-motion-layer:not([hidden])');

async function prepare(page: Page, view: 'agent' | 'editor' = 'agent') {
  expect((await page.request.post('/api/session', { headers, data: { password } })).status()).toBe(200);
  const response = await page.request.post('/api/workspaces', { headers, data: { name: `Input motion ${Date.now()}`, initializeGit: false } });
  expect(response.status()).toBe(201);
  const workspace = await response.json() as Workspace;
  expect((await page.request.patch(`/api/workspaces/${workspace.id}`, { headers, data: { active: true } })).ok()).toBe(true);
  const preferences = await (await page.request.get('/api/ui-state')).json();
  const width = page.viewportSize()!.width;
  const profile = width >= 1360 ? 'desktop' : width >= 1000 ? 'laptop' : width >= 680 ? 'tablet' : 'mobile';
  expect((await page.request.patch('/api/ui-state', { headers, data: { revision: preferences.revision, changes: [
    { section: 'layout', profile, key: 'view', value: view },
    { section: 'layout', profile, key: 'split', value: 'focus' },
  ] } })).ok()).toBe(true);
  await page.goto('/work');
  await expect(page.getByRole('main', { name: 'Workspace', exact: true })).toBeVisible();
  return workspace;
}

async function expectMotion(page: Page, input: Locator) {
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('data-input-motion-active', 'true');
  await expect(caret(page)).toBeVisible();
  await expect(caret(page)).toHaveAttribute('aria-hidden', 'true');
  expect(await caret(page).textContent()).toBe('');
  await expect(input).toHaveCSS('caret-color', 'rgba(0, 0, 0, 0)');
}

test('password, revealed credentials and explicitly private inputs retain the native caret without measurement', async ({ page }) => {
  await page.addInitScript(() => {
    const nativeMeasure = CanvasRenderingContext2D.prototype.measureText;
    const measurements: string[] = [];
    Object.assign(window, { inputMotionMeasurements: measurements });
    CanvasRenderingContext2D.prototype.measureText = function (text) { measurements.push(text); return nativeMeasure.call(this, text); };
  });
  await page.goto('/work');
  const input = page.getByLabel('Workspace password', { exact: true });
  const secret = 'private-input-fixture-9';
  await input.fill(secret);
  await input.press('End');
  await expect(input).toBeFocused();
  await expect(input).not.toHaveAttribute('data-input-motion-active', 'true');
  await expect(caret(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Show password', exact: true }).click();
  await input.focus();
  await input.press('End');
  await expect(input).toHaveValue(secret);
  await expect(input).not.toHaveAttribute('data-input-motion-active', 'true');
  await expect(caret(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { inputMotionMeasurements: string[] }).inputMotionMeasurements)).toEqual([]);
  expect(await page.locator('canvas').count()).toBe(0);
  await input.press('ControlOrMeta+A');
  await page.keyboard.insertText('replacement-secret-fixture');
  await expect(input).toHaveValue('replacement-secret-fixture');
  await page.getByRole('button', { name: 'Hide password', exact: true }).click();
  await expect(input).toHaveAttribute('type', 'password');

  // A dynamic native request may reveal its field without remounting it.
  // A previously observed password remains private even without autocomplete.
  await page.evaluate(() => {
    const token = document.createElement('input'); token.type = 'password';
    token.setAttribute('aria-label', 'Private token fixture');
    token.style.cssText = 'position:fixed;left:120px;top:120px;width:280px;height:40px;z-index:10000';
    document.body.append(token);
  });
  const token = page.getByLabel('Private token fixture', { exact: true });
  await token.fill('synthetic-token-value');
  await token.press('End');
  await token.evaluate(node => { (node as HTMLInputElement).type = 'text'; });
  await token.pressSequentially('-revealed');
  await expect(token).toHaveValue('synthetic-token-value-revealed');
  await expect(token).not.toHaveAttribute('data-input-motion-active', 'true');
  await expect(caret(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { inputMotionMeasurements: string[] }).inputMotionMeasurements)).toEqual([]);

  // Explicit secret fields are protected before their first focus, even when
  // the host intentionally uses a plain text control.
  await page.evaluate(() => {
    const token = document.createElement('textarea'); token.dataset.privateInput = 'true';
    token.setAttribute('aria-label', 'Marked private fixture');
    token.style.cssText = 'position:fixed;left:120px;top:180px;width:280px;height:60px;z-index:10000';
    document.body.append(token);
  });
  const marked = page.getByRole('textbox', { name: 'Marked private fixture', exact: true });
  await marked.fill('synthetic-private-note');
  await marked.press('End');
  await expect(marked).not.toHaveAttribute('data-input-motion-active', 'true');
  expect(await page.evaluate(() => (window as unknown as { inputMotionMeasurements: string[] }).inputMotionMeasurements)).toEqual([]);
});

test('composer typing, native selection, paste and undo stay immediate while the caret moves smoothly', async ({ page, context }) => {
  await prepare(page);
  const input = page.getByRole('textbox', { name: 'Message Codex', exact: true });
  await input.fill('alpha');
  await input.press('End');
  await expectMotion(page, input);
  const fontHeight = await input.evaluate(node => {
    // A real browser text range supplies an independent font-box reference.
    const probe = document.createElement('span');
    probe.textContent = 'Mg';
    probe.style.cssText = `position:fixed;visibility:hidden;font:${getComputedStyle(node).font}`;
    document.body.append(probe);
    const range = document.createRange(); range.selectNodeContents(probe);
    const height = range.getBoundingClientRect().height;
    probe.remove();
    return height;
  });
  const barBounds = (await caret(page).locator('.cw-input-motion-caret').boundingBox())!;
  expect(barBounds.height).toBeCloseTo(fontHeight, 0);
  expect(barBounds.width).toBeCloseTo(1, 1);
  await page.waitForTimeout(300);
  await input.pressSequentially(' beta');
  await expect(input).toHaveValue('alpha beta');
  await expect(caret(page).locator('.cw-input-motion-caret')).toHaveCSS('transition-duration', '0.08s');
  const timing = await caret(page).locator('.cw-input-motion-bar').evaluate(node => node.getAnimations().find(animation => animation.effect?.getTiming().iterations === 20)?.effect?.getTiming());
  expect(timing).toMatchObject({ delay: 500, duration: 500, direction: 'alternate', iterations: 20 });
  await input.press('ControlOrMeta+A');
  await expect(input).not.toHaveAttribute('data-input-motion-active', 'true');
  expect(await input.evaluate(node => (node as HTMLTextAreaElement).selectionEnd! - (node as HTMLTextAreaElement).selectionStart!)).toBe(10);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => navigator.clipboard.writeText('pasted without a typewriter delay'));
  await input.press('ControlOrMeta+V');
  await expect(input).toHaveValue('pasted without a typewriter delay');
  await expectMotion(page, input);
  await input.press('ControlOrMeta+Z');
  await expect(input).toHaveValue('alpha beta');
});

test('composition temporarily returns to the native caret without intercepting composition or input', async ({ page }) => {
  await prepare(page);
  const input = page.getByRole('textbox', { name: 'Message Codex', exact: true });
  await input.fill('draft ');
  await input.press('End');
  await expectMotion(page, input);
  const prevented = await input.evaluate(node => {
    const start = new CompositionEvent('compositionstart', { bubbles: true, cancelable: true, data: '' });
    node.dispatchEvent(start);
    return start.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await expect(input).not.toHaveAttribute('data-input-motion-active', 'true');
  await expect(caret(page)).toHaveCount(0);
  await page.keyboard.insertText('日本語');
  await expect(input).toHaveValue('draft 日本語');
  await input.dispatchEvent('compositionend', { data: '日本語', bubbles: true });
  await expectMotion(page, input);
});

test('reduced motion makes the input caret solid and instantaneous without changing editing', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await prepare(page);
  const input = page.getByRole('textbox', { name: 'Message Codex', exact: true });
  await input.fill('motion preference');
  await input.press('End');
  await expectMotion(page, input);
  await expect(caret(page)).toHaveAttribute('data-reduced-motion', 'true');
  await expect(caret(page).locator('.cw-input-motion-caret')).toHaveCSS('transition-duration', '0s');
  expect(await caret(page).locator('.cw-input-motion-bar').evaluate(node => node.getAnimations().length)).toBe(0);
  await input.pressSequentially(' works');
  await expect(input).toHaveValue('motion preference works');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(caret(page)).toHaveAttribute('data-reduced-motion', 'false');
  await expect.poll(() => caret(page).locator('.cw-input-motion-bar').evaluate(node => node.getAnimations().length)).toBeGreaterThan(0);
});

test('wrapped textarea caret tracks real scrolling and horizontal input scrolling stays clipped', async ({ page }) => {
  await prepare(page);
  // Real native fields added after startup exercise lazy/dynamic form coverage.
  await page.evaluate(() => {
    const panel = document.createElement('div');
    panel.id = 'input-motion-fixture';
    panel.style.cssText = 'position:fixed;left:200px;top:170px;z-index:10000;background:#111;padding:12px';
    const textarea = document.createElement('textarea');
    textarea.setAttribute('aria-label', 'Scrolling motion fixture');
    textarea.style.cssText = 'display:block;width:260px;height:110px;padding:8px;border:1px solid #777;box-sizing:border-box;font:16px/24px monospace;resize:none';
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'Horizontal motion fixture');
    input.style.cssText = 'display:block;width:160px;height:40px;padding:8px;border:1px solid #777;box-sizing:border-box;font:16px/24px monospace';
    panel.append(textarea, input); document.body.append(panel);
  });
  const textarea = page.getByRole('textbox', { name: 'Scrolling motion fixture', exact: true });
  await textarea.fill(Array.from({ length: 18 }, (_, index) => `line ${index} wraps across the bounded native textarea`).join('\n'));
  await textarea.press('ControlOrMeta+End');
  await expectMotion(page, textarea);
  expect(await textarea.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  const before = await textarea.evaluate(node => ({ value: (node as HTMLTextAreaElement).value, start: (node as HTMLTextAreaElement).selectionStart, end: (node as HTMLTextAreaElement).selectionEnd }));
  const bounds = await textarea.boundingBox();
  const bar = await caret(page).locator('.cw-input-motion-caret').boundingBox();
  expect(bar!.y).toBeGreaterThanOrEqual(bounds!.y);
  expect(bar!.y + bar!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height + 1);
  await textarea.evaluate(node => { node.scrollTop = 0; });
  await expect(textarea).not.toHaveAttribute('data-input-motion-active', 'true');
  expect(await textarea.evaluate(node => ({ value: (node as HTMLTextAreaElement).value, start: (node as HTMLTextAreaElement).selectionStart, end: (node as HTMLTextAreaElement).selectionEnd }))).toEqual(before);
  await textarea.press('ControlOrMeta+Home');
  await expectMotion(page, textarea);

  const input = page.getByRole('textbox', { name: 'Horizontal motion fixture', exact: true });
  await input.fill('an input that is wider than the available field by a long distance');
  await input.press('End');
  await expectMotion(page, input);
  expect(await input.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
  const inputBounds = await input.boundingBox();
  const inputBar = await caret(page).locator('.cw-input-motion-caret').boundingBox();
  expect(inputBar!.x).toBeGreaterThanOrEqual(inputBounds!.x);
  expect(inputBar!.x).toBeLessThanOrEqual(inputBounds!.x + inputBounds!.width);
  await page.locator('#input-motion-fixture').evaluate(node => node.remove());
  await expect(caret(page)).toHaveCount(0);
});

test('native Go to file dialog and Monaco find inputs share motion while Monaco editing owns its caret', async ({ page }) => {
  const workspace = await prepare(page, 'editor');
  expect((await page.request.post(`/api/workspaces/${workspace.id}/files`, { headers, data: { path: 'caret.ts', kind: 'file' } })).status()).toBe(201);
  expect((await page.request.put(`/api/workspaces/${workspace.id}/file`, { headers, data: { path: 'caret.ts', content: 'export const caret = "native editor";\n' } })).ok()).toBe(true);
  await page.locator('.app-topbar').getByRole('button', { name: 'Go to file', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Go to file', exact: true });
  const search = dialog.locator('.editor-quick-search input');
  await search.fill('caret');
  await expectMotion(page, search);
  expect(await caret(page).evaluate(node => node.matches(':popover-open'))).toBe(true);
  await dialog.getByRole('option', { name: /caret\.ts/ }).click();
  const editor = page.getByRole('region', { name: 'Code editor', exact: true });
  const editing = editor.locator('.monaco-editor textarea.inputarea').first();
  await editing.focus();
  await expect(editing).not.toHaveAttribute('data-input-motion-active', 'true');
  await expect(caret(page)).toHaveCount(0);
  await editing.press('ControlOrMeta+f');
  const find = editor.locator('.find-widget .find-part .monaco-inputbox textarea.input').first();
  await expect(find).toBeVisible();
  await find.fill('native');
  await find.press('End');
  await expectMotion(page, find);
  await find.press('Escape');
  await expect(editing).toBeFocused();
  await expect(editing).not.toHaveAttribute('data-input-motion-active', 'true');
  await expect(caret(page)).toHaveCount(0);
});

test('autofill-style replacement, focus changes and page suspension keep the native value and caret recoverable', async ({ page }) => {
  await prepare(page);
  const input = page.getByRole('textbox', { name: 'Message Codex', exact: true });
  await input.fill('initial');
  await input.press('End');
  await expectMotion(page, input);
  await input.evaluate(node => {
    const input = node as HTMLTextAreaElement;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'native replacement');
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: null }));
  });
  await expect(input).toHaveValue('native replacement');
  await expectMotion(page, input);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect(caret(page)).toHaveCount(0);
  await expect(input).not.toHaveAttribute('data-input-motion-active', 'true');
  await expect(input).toHaveValue('native replacement');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')));
  await expectMotion(page, input);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(input).not.toHaveAttribute('data-input-motion-active', 'true');
});

test('a settled focused field follows position-only sibling layout changes without typing or scrolling', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    const panel = document.createElement('div');
    panel.id = 'input-motion-moving-fixture';
    panel.style.cssText = 'position:fixed;left:200px;top:170px;width:300px;height:160px;z-index:10000;background:#111';
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'Moving input fixture');
    input.style.cssText = 'display:block;width:220px;height:40px;padding:8px;box-sizing:border-box;font:16px/24px monospace';
    panel.append(input); document.body.append(panel);
  });
  const input = page.getByRole('textbox', { name: 'Moving input fixture', exact: true });
  await input.fill('same value');
  await input.press('End');
  await expectMotion(page, input);
  await page.waitForTimeout(400);
  const before = (await caret(page).locator('.cw-input-motion-caret').boundingBox())!;
  const fieldBefore = (await input.boundingBox())!;
  await page.locator('#input-motion-moving-fixture').evaluate(node => {
    const spacer = document.createElement('div'); spacer.style.height = '37px'; node.prepend(spacer);
  });
  await expect.poll(async () => Math.round((await caret(page).locator('.cw-input-motion-caret').boundingBox())!.y - before.y)).toBe(37);
  const after = (await input.boundingBox())!;
  expect({ width: after.width, height: after.height }).toEqual({ width: fieldBefore.width, height: fieldBefore.height });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('same value');
});

test('a caret clipped by an ancestor stays native instead of painting outside the pane', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    const clip = document.createElement('div');
    clip.id = 'input-motion-clipping-fixture';
    clip.style.cssText = 'position:fixed;left:200px;top:170px;width:300px;height:30px;overflow:hidden;z-index:10000;background:#111';
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'Clipped input fixture');
    input.style.cssText = 'display:block;width:220px;height:48px;padding:12px;border:1px solid #777;box-sizing:border-box;font:16px/24px monospace';
    clip.append(input); document.body.append(clip);
  });
  const input = page.getByRole('textbox', { name: 'Clipped input fixture', exact: true });
  await input.fill('native clipped caret');
  await input.press('End');
  // Focusing scrolls the ancestor just enough to reveal the native font box.
  // Put it back at the clipped position so this exercises an actual occlusion.
  await page.locator('#input-motion-clipping-fixture').evaluate(node => { node.scrollTop = 0; });
  await expect(input).toBeFocused();
  await expect(input).not.toHaveAttribute('data-input-motion-active', 'true');
  await expect(caret(page)).toHaveCount(0);
  await page.locator('#input-motion-clipping-fixture').evaluate(node => { (node as HTMLElement).style.height = '60px'; });
  await expectMotion(page, input);
});

test('End at a soft-wrap boundary preserves the native upstream caret affinity', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    const input = document.createElement('textarea');
    input.setAttribute('aria-label', 'Wrapped affinity fixture');
    input.style.cssText = 'position:fixed;left:200px;top:170px;width:90px;height:150px;padding:8px;border:1px solid #777;box-sizing:border-box;font:16px/24px monospace;z-index:10000';
    document.body.append(input);
  });
  const input = page.getByRole('textbox', { name: 'Wrapped affinity fixture', exact: true });
  await input.fill('abcdefghijklmnop');
  await input.press('ControlOrMeta+Home');
  await input.press('End');
  const selection = await input.evaluate(node => ({ start: (node as HTMLTextAreaElement).selectionStart, end: (node as HTMLTextAreaElement).selectionEnd, length: (node as HTMLTextAreaElement).value.length }));
  expect(selection.start).toBe(selection.end);
  expect(selection.start).toBeGreaterThan(0);
  expect(selection.start).toBeLessThan(selection.length);
  await expect(input).not.toHaveAttribute('data-input-motion-active', 'true');
  await expect(caret(page)).toHaveCount(0);
  await input.press('ArrowLeft');
  await expectMotion(page, input);
});

test('a delayed font face invalidates caret measurements while a field keeps the same value and font declaration', async ({ page }) => {
  await prepare(page);
  // A font already supplied by the installed Monaco dependency gives this test
  // a real late font load without another dependency or external network request.
  const bytes = await readFile(new URL('../../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.ttf', import.meta.url));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/input-motion-delayed-font.ttf', async route => { await gate; await route.fulfill({ contentType: 'font/ttf', body: bytes }); });
  try {
    await page.evaluate(() => {
      // Chromium 153 exposes sizeAdjust as a FontFace attribute, not a
      // FontFaceDescriptors constructor member. TS 5.9 omits that attribute.
      // Require the actual native accessor so an ignored option/expando cannot
      // make this late-font regression look supported.
      const adjustment = Object.getOwnPropertyDescriptor(FontFace.prototype, 'sizeAdjust');
      if (!adjustment?.get || !adjustment.set) throw new Error('The late-font fixture requires the native FontFace.sizeAdjust accessor.');
      const font = new FontFace('InputMotionDelayedFace', 'url(/input-motion-delayed-font.ttf)', { display: 'swap' }) as FontFace & { sizeAdjust: string };
      font.sizeAdjust = '180%';
      if (font.sizeAdjust !== '180%') throw new Error('The browser did not apply the late-font fixture size adjustment.');
      document.fonts.add(font);
      void font.load();
      const input = document.createElement('input');
      input.setAttribute('aria-label', 'Delayed font fixture');
      input.style.cssText = 'position:fixed;left:200px;top:170px;width:340px;height:70px;padding:8px;border:1px solid #777;box-sizing:border-box;font:16px/36px InputMotionDelayedFace,monospace;z-index:10000';
      document.body.append(input);
    });
    const input = page.getByRole('textbox', { name: 'Delayed font fixture', exact: true });
    await input.fill('\uea60\uea60\uea60\uea60');
    await input.press('End');
    await expectMotion(page, input);
    await page.waitForTimeout(400);
    const before = (await caret(page).locator('.cw-input-motion-caret').boundingBox())!;
    const declaration = await input.evaluate(node => getComputedStyle(node).font);
    release();
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(async () => Math.abs((await caret(page).locator('.cw-input-motion-caret').boundingBox())!.x - before.x)).toBeGreaterThan(8);
    expect(await input.evaluate(node => getComputedStyle(node).font)).toBe(declaration);
    await expect(input).toHaveValue('\uea60\uea60\uea60\uea60');
    await expect(input).toBeFocused();
  } finally { release(); await page.unroute('**/input-motion-delayed-font.ttf'); }
});


test('multiline caret travel snaps to a new baseline and resumes smooth horizontal typing', async ({ page }) => {
  await prepare(page);
  const input = page.getByRole('textbox', { name: 'Message Codex', exact: true });
  await input.fill('first line');
  await input.press('End');
  await expectMotion(page, input);
  await page.waitForTimeout(300);
  await input.press('Enter');
  await expect(input).toHaveValue('first line\n');
  await expectMotion(page, input);
  await expect(caret(page)).toHaveAttribute('data-snap', 'true');
  await expect(caret(page).locator('.cw-input-motion-caret')).toHaveCSS('transition-duration', '0s');
  await input.pressSequentially('second line');
  await expect(input).toHaveValue('first line\nsecond line');
  await expect(caret(page)).toHaveAttribute('data-snap', 'false');
  await expect(caret(page).locator('.cw-input-motion-caret')).toHaveCSS('transition-duration', '0.08s');
});
