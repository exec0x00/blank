import { expect, test, type Page } from '@playwright/test';

const headers = { 'X-Codex-Workspace': '1' };
const password = process.env.PLAYWRIGHT_PASSWORD || 'browser-test-workspace-password';
const hint = (page: Page) => page.locator('.cw-tooltip[role="tooltip"]');

async function openWorkspace(page: Page, label: string) {
  expect((await page.request.post('/api/session', { headers, data: { password } })).ok()).toBe(true);
  const response = await page.request.post('/api/workspaces', { headers, data: { name: `Tooltip ${label} ${Date.now()}` } });
  expect(response.status()).toBe(201);
  const workspace = await response.json();
  expect((await page.request.patch(`/api/workspaces/${workspace.id}`, { headers, data: { active: true } })).ok()).toBe(true);
  await page.goto('/work');
  await expect(page.getByRole('main', { name: 'Workspace', exact: true })).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-workspace-locked', 'false');
}

async function fixture(page: Page, content: string) {
  await page.evaluate(content => {
    document.getElementById('tooltip-fixture')?.remove();
    const root = document.createElement('div');
    root.id = 'tooltip-fixture';
    root.style.cssText = 'position:fixed;left:160px;top:150px;z-index:900;padding:20px;background:#111;color:#eee;max-width:calc(100vw - 180px)';
    root.innerHTML = content; // Static test controls, never application/provider content.
    document.body.append(root);
  }, content);
}

async function insideViewport(page: Page) {
  const measurements = await hint(page).evaluate(element => {
    const bounds = element.getBoundingClientRect(), style = getComputedStyle(element), viewport = window.visualViewport;
    return {
      left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom,
      viewportLeft: viewport?.offsetLeft || 0, viewportTop: viewport?.offsetTop || 0,
      viewportRight: (viewport?.offsetLeft || 0) + (viewport?.width || innerWidth),
      viewportBottom: (viewport?.offsetTop || 0) + (viewport?.height || innerHeight),
      background: style.backgroundColor, shadow: style.boxShadow, textShadow: style.textShadow, backdrop: style.backdropFilter,
    };
  });
  expect(measurements.left).toBeGreaterThanOrEqual(measurements.viewportLeft);
  expect(measurements.top).toBeGreaterThanOrEqual(measurements.viewportTop);
  expect(measurements.right).toBeLessThanOrEqual(measurements.viewportRight);
  expect(measurements.bottom).toBeLessThanOrEqual(measurements.viewportBottom);
  expect(measurements.background).toBe('rgb(25, 25, 25)');
  expect([measurements.shadow, measurements.textShadow, measurements.backdrop]).toEqual(['none', 'none', 'none']);
}

test('actual rail hints are custom, hoverable, and preserve dialog keyboard dismissal and focus', async ({ page }) => {
  await openWorkspace(page, 'rail keyboard');
  const settings = page.locator('.sidebar-settings');
  await settings.hover();
  await expect(hint(page)).toContainText('Settings');
  await expect(settings).toHaveAttribute('title', '');
  await expect(settings).toHaveAccessibleName('Settings');
  await expect(settings).toHaveAccessibleDescription(/Settings/);
  await hint(page).hover();
  await page.waitForTimeout(180); // The pointer can cross the small trigger-to-hint gap.
  await expect(hint(page)).toBeVisible();
  await insideViewport(page);
  await page.keyboard.press('Escape');
  await expect(hint(page)).toHaveCount(0);
  await expect(settings).not.toHaveAttribute('aria-describedby');
  await settings.click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole('button', { name: 'Close dialog', exact: true });
  await page.keyboard.press('Shift');
  await close.focus();
  await expect(hint(page)).toHaveText('Close dialog');
  await page.keyboard.press('Escape');
  await expect(hint(page)).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('dynamic and removed title props update the one hint without losing accessible names or descriptions', async ({ page }) => {
  await openWorkspace(page, 'dynamic titles');
  await fixture(page, '<p id="existing-tooltip-help">Existing guidance</p><button id="tooltip-target" title="Original path" aria-describedby="existing-tooltip-help"><svg width="20" height="20" aria-hidden="true"><path d="M1 1h18v18H1z" /></svg></button><button id="tooltip-next">Next control</button><button id="tooltip-alt" title="Image guidance"><img alt="Image action"></button>');
  const target = page.locator('#tooltip-target');
  await expect(page.locator('#tooltip-alt')).toHaveAccessibleName('Image action');
  await expect(target).toHaveAccessibleName('Original path');
  await target.focus();
  await expect(hint(page)).toHaveText('Original path');
  await expect(target).toHaveAccessibleDescription('Existing guidance Original path');
  await target.evaluate(element => element.setAttribute('title', 'Updated path'));
  await expect(hint(page)).toHaveText('Updated path');
  await expect(target).toHaveAccessibleName('Updated path');
  await target.evaluate(element => { element.setAttribute('title', 'Intermediate path'); element.setAttribute('title', 'Final path'); });
  await expect(hint(page)).toHaveText('Final path');
  await expect(hint(page)).toHaveCount(1);
  await target.evaluate(element => { element.setAttribute('aria-describedby', 'existing-tooltip-help'); element.removeAttribute('title'); });
  await expect(hint(page)).toHaveCount(0);
  await expect(target).not.toHaveAttribute('data-tooltip-title');
  await expect(target).toHaveAttribute('aria-describedby', 'existing-tooltip-help');
  await expect(target).not.toHaveAttribute('aria-label');
  await target.evaluate(element => { element.setAttribute('aria-label', 'Real action'); element.setAttribute('title', '<img src=x onerror=alert(1)> literal text'); });
  await page.locator('#tooltip-next').focus();
  await target.focus();
  await expect(hint(page)).toHaveText('<img src=x onerror=alert(1)> literal text');
  await expect(hint(page).locator('*')).toHaveCount(0);
  await expect(target).toHaveAccessibleName('Real action');
  await target.evaluate(element => element.setAttribute('title', ''));
  await expect(hint(page)).toHaveCount(0);
  await expect(target).toHaveAccessibleName('Real action');
  await page.evaluate(() => {
    const late = document.createElement('button');
    late.id = 'tooltip-late-title';
    late.style.cssText = 'min-width:44px;min-height:44px';
    document.getElementById('tooltip-fixture')!.append(late);
    late.setAttribute('title', 'Title assigned after insertion');
  });
  const late = page.locator('#tooltip-late-title');
  await expect(late).toHaveAccessibleName('Title assigned after insertion');
  await late.focus();
  await expect(hint(page)).toHaveText('Title assigned after insertion');
  await late.evaluate(element => { element.textContent = 'Visible action'; });
  await expect(late).toHaveAccessibleName('Visible action');
  await expect(late).not.toHaveAttribute('aria-label');
  await late.evaluate(async element => {
    element.remove();
    await new Promise(requestAnimationFrame);
    element.removeAttribute('title');
    document.getElementById('tooltip-fixture')!.append(element);
  });
  await expect(late).not.toHaveAttribute('data-tooltip-title');
  await expect(hint(page)).toHaveCount(0);
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.id = 'tooltip-cleared-together';
    button.style.cssText = 'min-width:44px;min-height:44px';
    button.title = 'Rapid action';
    document.getElementById('tooltip-fixture')!.append(button);
    button.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    button.title = 'Rapid action';
    button.title = '';
  });
  await expect(page.locator('#tooltip-cleared-together')).not.toHaveAttribute('data-tooltip-title');
  await page.waitForTimeout(500);
  await expect(hint(page)).toHaveCount(0);
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.id = 'tooltip-authored-name';
    button.style.cssText = 'min-width:44px;min-height:44px';
    button.title = 'Keep this name';
    document.getElementById('tooltip-fixture')!.append(button);
  });
  const named = page.locator('#tooltip-authored-name');
  await expect(named).toHaveAccessibleName('Keep this name');
  await named.evaluate(element => { element.setAttribute('aria-label', 'Keep this name'); element.removeAttribute('title'); });
  await expect(named).not.toHaveAttribute('data-tooltip-title');
  await expect(named).toHaveAccessibleName('Keep this name');
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.id = 'tooltip-generated-order';
    button.style.cssText = 'min-width:44px;min-height:44px';
    button.title = 'First generated name';
    document.getElementById('tooltip-fixture')!.append(button);
  });
  const ordered = page.locator('#tooltip-generated-order');
  await expect(ordered).toHaveAccessibleName('First generated name');
  await ordered.evaluate(element => {
    element.removeAttribute('aria-label');
    element.setAttribute('title', 'Second generated name');
    element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
  });
  await expect(ordered).toHaveAccessibleName('Second generated name');
  await ordered.evaluate(element => element.removeAttribute('title'));
  await expect(ordered).not.toHaveAttribute('aria-label');
  await ordered.evaluate(element => element.setAttribute('title', 'Final generated name'));
  await expect(ordered).toHaveAccessibleName('Final generated name');
  await ordered.evaluate(element => {
    element.setAttribute('aria-label', 'Final generated name');
    element.setAttribute('title', 'A different explanation');
    element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
  });
  await expect(ordered).toHaveAccessibleName('Final generated name');
  await ordered.evaluate(element => element.removeAttribute('title'));
  await expect(ordered).toHaveAccessibleName('Final generated name');
});

test('native-dialog hints remain in the top layer and fit phone corners with reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openWorkspace(page, 'native dialog');
  await fixture(page, '<dialog id="tooltip-dialog" aria-label="Tooltip placement"><button id="tooltip-dialog-control" aria-label="Placement action" title="A long source path: src/components/workspace/panels/editor/a-file-with-a-long-name.ts">Action</button></dialog>');
  await page.evaluate(() => {
    const dialog = document.getElementById('tooltip-dialog') as HTMLDialogElement;
    dialog.style.cssText = 'padding:0;border:0;inset:0;margin:0;width:100vw;height:100dvh;max-width:none;max-height:none;background:#111;color:#eee';
    dialog.showModal();
  });
  const target = page.locator('#tooltip-dialog-control');
  for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
    await target.evaluate((element, corner) => {
      (element as HTMLElement).style.cssText = `position:fixed;${corner.includes('top') ? 'top:3px' : 'bottom:3px'};${corner.includes('left') ? 'left:3px' : 'right:3px'};min-width:44px;min-height:44px`;
      (element as HTMLElement).blur();
    }, corner);
    await page.keyboard.press('Shift');
    await target.focus();
    await expect(hint(page)).toBeVisible();
    await expect(page.locator('#tooltip-dialog > .cw-tooltip')).toHaveCount(1);
    expect(await hint(page).evaluate(element => element.matches(':popover-open'))).toBe(true);
    await expect(hint(page)).toHaveCSS('animation-name', 'none');
    await insideViewport(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#tooltip-dialog')).toBeVisible();
    await expect(target).toBeFocused();
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#tooltip-dialog')).toBeHidden();
  await expect(hint(page)).toHaveCount(0);
});

test('session locking clears a workspace hint immediately and never turns a password value into a hint', async ({ page }) => {
  await openWorkspace(page, 'lock cleanup');
  await page.locator('.sidebar-settings').hover();
  await expect(hint(page)).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('codex:session-expired')));
  await expect(hint(page)).toHaveCount(0);
  const passwordField = page.getByLabel('Workspace password', { exact: true });
  await expect(passwordField).toBeVisible();
  await passwordField.fill('fixture-private-field-content');
  await passwordField.hover();
  await page.waitForTimeout(500);
  await expect(hint(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Show password', exact: true }).hover();
  await expect(hint(page)).toHaveText('Show password');
  await expect(hint(page)).not.toContainText('fixture-private-field-content');
  await expect(passwordField).toHaveValue('fixture-private-field-content');
  await expect(passwordField).toHaveAttribute('type', 'password');
});

test('hidden controls retain text and image-alt names through updates and session unlock', async ({ page }) => {
  await openWorkspace(page, 'hidden names');
  await fixture(page, '<section id="tooltip-name-group"><button id="tooltip-file-name" title="source/draft.ts"><span id="tooltip-visible-name">draft.ts</span><span id="tooltip-busy" aria-hidden="true">Moving</span></button><button id="tooltip-image-name" title="Image guidance"><img alt="Image action"></button><button id="tooltip-hidden-content" title="Named icon action"><span hidden>Hidden text</span><svg aria-hidden="true"><title>Decorative icon</title></svg></button><button id="tooltip-explicit-name" title="Additional guidance" aria-label="Explicit action"><span>Visible fallback</span></button></section>');
  await page.locator('#tooltip-fixture').evaluate(element => document.querySelector('.app-shell')!.append(element));
  const file = page.locator('#tooltip-file-name'), image = page.locator('#tooltip-image-name');
  const icon = page.locator('#tooltip-hidden-content'), explicit = page.locator('#tooltip-explicit-name');
  await expect(file).toHaveAccessibleName('draft.ts');
  await expect(image).toHaveAccessibleName('Image action');
  await expect(icon).toHaveAccessibleName('Named icon action');
  await expect(explicit).toHaveAccessibleName('Explicit action');

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('codex:session-expired')));
  const passwordField = page.getByLabel('Workspace password', { exact: true });
  await expect(passwordField).toBeVisible();
  // Real transfer completion removes its decorative spinner while the shell
  // is inert. Alternate text can likewise update before the user unlocks.
  await page.evaluate(() => {
    document.getElementById('tooltip-busy')!.remove();
    document.querySelector<HTMLImageElement>('#tooltip-image-name img')!.alt = 'Updated image action';
    document.getElementById('tooltip-explicit-name')!.setAttribute('title', 'Updated explanation');
  });
  await expect(file).not.toHaveAttribute('aria-label');
  await expect(image).not.toHaveAttribute('aria-label');
  await expect(explicit).toHaveAttribute('aria-label', 'Explicit action');
  await passwordField.fill(password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(file).toHaveAccessibleName('draft.ts');
  await expect(image).toHaveAccessibleName('Updated image action');
  await expect(icon).toHaveAccessibleName('Named icon action');
  await expect(explicit).toHaveAccessibleName('Explicit action');

  // A hidden pane or control has the same naming boundary as the locked shell.
  for (const boundary of ['#tooltip-name-group', '#tooltip-file-name']) {
    await page.locator(boundary).evaluate(element => { (element as HTMLElement).hidden = true; });
    await file.locator('#tooltip-visible-name').evaluate(element => { element.textContent = 'renamed.ts'; });
    await expect(file).not.toHaveAttribute('aria-label');
    await page.locator(boundary).evaluate(element => { (element as HTMLElement).hidden = false; });
    await expect(file).toHaveAccessibleName('renamed.ts');
  }
  await page.keyboard.press('Shift');
  await file.focus();
  await expect(hint(page)).toHaveText('source/draft.ts');
});

test('removed virtual rows, pending hints, scroll and workspace changes leave no stale surface', async ({ page }) => {
  await openWorkspace(page, 'window cleanup');
  await fixture(page, '<button id="tooltip-row" title="Current row path">Row</button><button id="tooltip-removed" title="Removed row path">Remove this row</button>');
  await page.locator('#tooltip-row').hover();
  await expect(hint(page)).toHaveText('Current row path');
  await page.locator('#tooltip-row').evaluate(element => element.remove());
  await expect(hint(page)).toHaveCount(0);
  await page.locator('#tooltip-removed').hover();
  await page.locator('#tooltip-removed').evaluate(element => element.remove());
  await page.waitForTimeout(500); // A detached row must not open when its hover delay expires.
  await expect(hint(page)).toHaveCount(0);
  await fixture(page, '<div id="tooltip-scroll" style="overflow:auto;height:100px;width:180px"><button id="tooltip-scrolling" title="Scrolling row path">Scroll row</button><div style="height:1000px"></div></div>');
  await page.locator('#tooltip-scrolling').hover();
  await expect(hint(page)).toBeVisible();
  await page.locator('#tooltip-scroll').evaluate(element => { element.scrollTop = 30; });
  await expect(hint(page)).toHaveCount(0);
  await page.locator('#tooltip-scroll').evaluate(element => { element.scrollTop = 0; });
  await page.mouse.move(5, 5);
  await page.locator('#tooltip-scrolling').hover();
  await expect(hint(page)).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('codex:before-workspace-change', { detail: { cancel: false } })));
  await expect(hint(page)).toHaveCount(0);
  await page.waitForTimeout(500);
  await expect(hint(page)).toHaveCount(0);
});

test('disabled reasons remain available while editor and terminal input surfaces keep their own behavior', async ({ page }) => {
  await openWorkspace(page, 'owned surfaces');
  await fixture(page, '<button id="tooltip-disabled" disabled title="Save needs a restored workspace">Save</button><input id="tooltip-editable" aria-label="Editable fixture" value="never mirror this field" title="Input owned hint"><div class="monaco-hover" id="tooltip-monaco" title="Diagnostic details">Real diagnostic documentation</div><div class="xterm"><textarea id="tooltip-terminal" aria-label="Terminal input" title="Terminal owned hint"></textarea></div>');
  await page.locator('#tooltip-disabled').hover({ force: true });
  await expect(hint(page)).toHaveText('Save needs a restored workspace');
  await page.locator('#tooltip-disabled').evaluate(element => { element.setAttribute('data-tooltip', 'One line of help\n'.repeat(100)); });
  await expect(hint(page)).toContainText('One line of help');
  await hint(page).evaluate(element => { element.scrollTop = 150; });
  await expect.poll(() => hint(page).evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(hint(page)).toBeVisible();
  await page.keyboard.press('Escape');
  for (const id of ['tooltip-editable', 'tooltip-monaco', 'tooltip-terminal']) {
    await page.locator(`#${id}`).hover();
    await page.waitForTimeout(500);
    await expect(hint(page)).toHaveCount(0);
  }
  await expect(page.locator('#tooltip-monaco')).toHaveText('Real diagnostic documentation');
  await expect(page.locator('#tooltip-monaco')).toHaveAttribute('title', 'Diagnostic details');
  await page.locator('#tooltip-editable').focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText('Editable content stays editable');
  await expect(page.locator('#tooltip-editable')).toHaveValue('Editable content stays editable');
  await expect(hint(page)).toHaveCount(0);
});

test.describe('touch tooltips', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test('a normal tap activates once and a help hold does not execute its action on release', async ({ page }) => {
    await openWorkspace(page, 'touch hold');
    await fixture(page, '<button id="tooltip-touch" title="Explain this action" style="min-width:80px;min-height:44px">Action</button><output id="tooltip-clicks">0</output>');
    await page.locator('#tooltip-touch').evaluate(element => element.addEventListener('click', () => {
      const output = document.getElementById('tooltip-clicks')!;
      output.textContent = String(Number(output.textContent) + 1);
    }));
    const box = await page.locator('#tooltip-touch').boundingBox();
    expect(box).toBeTruthy();
    const point = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
    await page.touchscreen.tap(point.x, point.y);
    await expect(page.locator('#tooltip-clicks')).toHaveText('1');
    await expect(hint(page)).toHaveCount(0);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1, radiusX: 3, radiusY: 3, force: 1 }] });
    await expect(hint(page)).toHaveText('Explain this action');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('#tooltip-clicks')).toHaveText('1');
    await expect(hint(page)).toBeVisible();
    await page.touchscreen.tap(point.x, point.y);
    await expect(page.locator('#tooltip-clicks')).toHaveText('2');
    await expect(hint(page)).toHaveCount(0);
    await cdp.detach();
  });
});
