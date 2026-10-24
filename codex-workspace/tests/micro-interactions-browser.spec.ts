import { expect, test, type Locator, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { Notice } from '../client/components/ui/ToastStack';

// The actual shared controls and motion styles run in a browser. This peer
// serves source assets only; it cannot reach user storage, native tools or models.
let server: Server, origin = '';

test.beforeAll(async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const bundle = await build({
    absWorkingDir: root, stdin: { loader: 'tsx', resolveDir: root, contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { Loader2, MoreHorizontal } from 'lucide-react';
      import Modal from './client/components/Modal';
      import { DropdownMenu, SelectMenu } from './client/components/ui/Dropdown';
      import PageNavigation from './client/components/ui/PageNavigation';
      import ToastStack from './client/components/ui/ToastStack';
      import { installTooltips } from './client/tooltips';
      import './client/styles.css'; import './client/tooltips.css';
      import './client/components/chat.css';
      installTooltips();
      function Fixture() {
        const [open, setOpen] = useState(false), [child, setChild] = useState(false);
        const [value, setValue] = useState('alpha'), [draft, setDraft] = useState('Retained native input');
        const [count, setCount] = useState(0), [busy, setBusy] = useState(false);
        const [notices, setNotices] = useState([]), [noticeLimit, setNoticeLimit] = useState(3), [toastMounted, setToastMounted] = useState(true), [dismissedNotices, setDismissedNotices] = useState([]);
        window.arcInteractionFixture = { settle() { setBusy(false); }, close() { setOpen(false); setChild(false); },
          setNotices, setNoticeLimit, setToastMounted, redrawNotices() { setNotices(current => current.map(notice => ({ ...notice }))); } };
        return <main style={{ padding: 24 }}>
          <button className="button primary" onClick={() => setOpen(true)}>Open preferences</button>
          <button className="button primary" onClick={() => { setCount(count + 1); setBusy(true); }} disabled={busy} aria-busy={busy}>
            {busy && <Loader2 size={15} className="spin" />} {busy ? 'Saving preference…' : 'Save preference'}
          </button>
          <button className="button danger" disabled onClick={() => setCount(count + 100)}>Unavailable action</button>
          <button className="button" onClick={() => setNotices([{ id: 1, kind: 'success', message: 'Preferences saved.' }])}>Show notification</button>
          <button className="chat-send" aria-label="Send draft" onClick={() => setCount(count + 1)}>↑</button>
          <p><output aria-label="Actions accepted">{count}</output></p>
          <output className="sr-only" aria-label="Dismissed notifications">{JSON.stringify(dismissedNotices)}</output>
          <textarea className="input" aria-label="Outside editor draft" defaultValue="Unsaved content" />
          <PageNavigation label="Results" offset={0} count={10} total={20} hasPrevious={false} hasNext loading onPrevious={() => setCount(count + 100)} onNext={() => setCount(count + 100)} />
          {toastMounted && <ToastStack notices={notices} limit={noticeLimit} onDismiss={id => {
            setDismissedNotices(current => [...current, id]); setNotices(current => current.filter(notice => notice.id !== id));
          }} />}
          <Modal open={open} title="Preferences" titleId="motion-preferences" onClose={() => setOpen(false)}>
            <div style={{ padding: 20, display: 'grid', gap: 12 }}>
              <label>Preference label<input className="input" aria-label="Preference label" data-autofocus value={draft} onChange={event => setDraft(event.target.value)} /></label>
              <SelectMenu aria-label="Preference value" value={value} onValueChange={setValue} searchable options={[
                { value: 'alpha', label: 'Alpha' }, { value: 'beta', label: 'Beta' }, { value: 'blocked', label: 'Unavailable choice', disabled: true },
              ]} />
              <DropdownMenu aria-label="Review actions" trigger={<button className="button"><MoreHorizontal size={16}/>Review actions</button>} items={[
                { id: 'nested', label: 'Review details', onSelect() { setChild(true); } },
                { id: 'unavailable', label: 'Unavailable command', disabled: true, onSelect() { setCount(count + 100); } },
              ]}/>
              <button className="button" onClick={() => setOpen(false)}>Done</button>
            </div>
          </Modal>
          <Modal open={child} title="Review details" titleId="motion-details" onClose={() => setChild(false)}>
            <div style={{ padding: 20 }}><p>Original preference remains editable.</p><button className="button" onClick={() => setChild(false)}>Back to preferences</button></div>
          </Modal>
        </main>;
      }
      createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture /></React.StrictMode>);
    ` },
    bundle: true, write: false, outfile: 'interaction-fixture.js', platform: 'browser', format: 'iife',
    target: 'es2022', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent',
  });
  const script = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  const styles = bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text;
  server = createServer((request, response) => {
    if (request.url === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(script); }
    else if (request.url === '/fixture.css') { response.setHeader('Content-Type', 'text/css'); response.end(styles); }
    else if (request.url === '/work') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); }
    else { response.writeHead(404); response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });

async function mount(page: Page, motion: 'reduce' | 'no-preference') {
  await page.emulateMedia({ reducedMotion: motion });
  await page.goto(origin + '/work');
  await expect(page.getByRole('button', { name: 'Open preferences', exact: true })).toBeVisible();
}
async function frame(page: Page) { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))); }
async function contrast(control: Locator) {
  return control.evaluate(element => {
    const style = getComputedStyle(element), canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    function luminance(color: string) {
      context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => value / 255)
        .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    }
    const foreground = luminance(style.color), background = luminance(style.backgroundColor);
    return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
  });
}

for (const motion of ['no-preference', 'reduce'] as const) {
  test(`${motion}: pressed actions remain legible, stable and immediate`, async ({ page }) => {
    await mount(page, motion);
    // Keyboard presses do not also match :hover. They must retain the same
    // readable primary palette instead of inheriting the dark generic press.
    const opener = page.getByRole('button', { name: 'Open preferences', exact: true });
    await opener.focus(); await page.keyboard.down('Space');
    expect(await contrast(opener)).toBeGreaterThanOrEqual(4.5);
    await page.keyboard.up('Space');
    await expect(page.getByRole('textbox', { name: 'Preference label', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    const save = page.getByRole('button', { name: 'Save preference', exact: true });
    await save.hover();
    const before = await save.boundingBox();
    await page.mouse.down();
    expect(await contrast(save)).toBeGreaterThanOrEqual(4.5);
    expect(await save.boundingBox()).toEqual(before);
    await page.mouse.up();
    await frame(page);
    await expect(page.getByLabel('Actions accepted')).toHaveText('1');
    const pending = page.getByRole('button', { name: 'Saving preference…', exact: true });
    await expect(pending).toBeDisabled();
    expect(await contrast(pending)).toBeGreaterThanOrEqual(4.5);
    await pending.evaluate(button => (button as HTMLButtonElement).click());
    await page.getByRole('button', { name: 'Unavailable action', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
    await expect(page.getByLabel('Actions accepted')).toHaveText('1');
    const previous = page.getByRole('button', { name: 'Previous results', exact: true });
    await previous.focus(); await page.keyboard.press('Space');
    await expect(previous).toBeFocused();
    await expect(page.getByLabel('Actions accepted')).toHaveText('1');
    const send = page.getByRole('button', { name: 'Send draft', exact: true });
    const resting = await send.boundingBox();
    await send.hover(); await page.mouse.down();
    expect(await send.boundingBox()).toEqual(resting);
    await page.mouse.up();
    await expect(page.getByLabel('Actions accepted')).toHaveText('2');
  });

  test(`${motion}: nested menus and dialogs restore focus without delaying selection or native typing`, async ({ page }) => {
    await mount(page, motion);
    const opener = page.getByRole('button', { name: 'Open preferences', exact: true });
    await opener.focus(); await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Preferences', exact: true });
    const input = dialog.getByRole('textbox', { name: 'Preference label', exact: true });
    await expect(input).toBeFocused();
    await input.press('End'); await input.pressSequentially(' — unchanged');
    await expect(input).toHaveValue('Retained native input — unchanged');
    const select = dialog.getByRole('combobox', { name: 'Preference value', exact: true });
    await select.focus(); await page.keyboard.press('ArrowDown');
    const search = page.getByRole('combobox', { name: 'Search Preference value', exact: true });
    await expect(search).toBeFocused();
    await search.fill('Beta'); await search.press('Enter');
    await frame(page);
    await expect(select).toHaveText('Beta');
    await expect(select).toBeFocused();
    await expect(page.getByRole('listbox')).toHaveCount(0);
    const actions = dialog.getByRole('button', { name: 'Review actions', exact: true });
    await actions.focus(); await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Review details', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    const child = page.getByRole('dialog', { name: 'Review details', exact: true });
    await expect(child.getByRole('button', { name: 'Back to preferences', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await frame(page);
    await expect(child).toHaveCount(0); await expect(actions).toBeFocused();
    await select.click(); await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible(); await expect(select).toBeFocused();
    await page.keyboard.press('Escape'); await frame(page);
    await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
    // A quick reopen keeps the same draft and admits native input immediately.
    await page.keyboard.press('Enter'); await expect(input).toHaveValue('Retained native input — unchanged');
    await expect(input).toBeFocused(); await page.keyboard.press('Escape');
    await expect(page.getByRole('textbox', { name: 'Outside editor draft', exact: true })).toHaveValue('Unsaved content');
  });
}

test('changing the motion preference preserves an open menu, keyboard focus and its typed query', async ({ page }) => {
  await mount(page, 'no-preference');
  await page.getByRole('button', { name: 'Open preferences', exact: true }).click();
  const select = page.getByRole('combobox', { name: 'Preference value', exact: true });
  await select.click();
  const search = page.getByRole('combobox', { name: 'Search Preference value', exact: true });
  await search.fill('Beta');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await frame(page);
  await expect(search).toBeFocused(); await expect(search).toHaveValue('Beta');
  expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(0);
  await page.keyboard.press('Enter');
  await expect(select).toHaveText('Beta'); await expect(select).toBeFocused();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open preferences', exact: true })).toBeFocused();
});

test('reduced motion stops visible decoration and session lock removes open surfaces immediately', async ({ page }) => {
  await mount(page, 'reduce');
  await page.getByRole('button', { name: 'Show notification', exact: true }).click();
  await page.getByRole('button', { name: 'Save preference', exact: true }).click();
  await page.getByRole('button', { name: 'Open preferences', exact: true }).click();
  await page.getByRole('combobox', { name: 'Preference value', exact: true }).click();
  await frame(page);
  expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(0);
  await page.getByRole('combobox', { name: 'Search Preference value', exact: true }).fill('Private draft query');
  await page.evaluate(() => { document.body.dataset.workspaceLocked = 'true'; window.dispatchEvent(new Event('codex:session-locked')); });
  await frame(page);
  await expect(page.locator('.cw-dropdown-surface, .modal-overlay')).toHaveCount(0);
  expect(await page.locator('input').evaluateAll(inputs => inputs.some(input => (input as HTMLInputElement).value === 'Private draft query'))).toBe(false);
});

test.describe('touch feedback', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('menus retain usable targets and do not trap the next tap after dismissal', async ({ page }) => {
    await mount(page, 'no-preference');
    await page.getByRole('button', { name: 'Open preferences', exact: true }).tap();
    const dialog = page.getByRole('dialog', { name: 'Preferences', exact: true });
    const select = dialog.getByRole('combobox', { name: 'Preference value', exact: true });
    await select.tap();
    const beta = page.getByRole('option', { name: 'Beta', exact: true });
    expect((await beta.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await beta.tap();
    await expect(select).toHaveText('Beta');
    await dialog.getByRole('button', { name: 'Done', exact: true }).tap();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: 'Show notification', exact: true }).tap();
    const close = page.getByRole('button', { name: 'Dismiss notification', exact: true });
    await expect(close).toBeVisible();
    expect((await close.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await close.tap();
    await expect(page.locator('.toast')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});

type NotificationFixture = Window & { arcInteractionFixture: {
  setNotices: (notices: Notice[]) => void;
  redrawNotices: () => void;
  setNoticeLimit: (limit: 1 | 2 | 3) => void;
  setToastMounted: (mounted: boolean) => void;
} };
async function notificationClock(page: Page) {
  // Keep the production 3,500/10,000ms budgets. The browser's controlled clock
  // exercises real pointer/focus events and timer cleanup without long sleeps.
  await page.clock.install({ time: new Date('2026-09-30T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-30T12:00:01Z'));
  await mount(page, 'reduce');
}
async function notices(page: Page, values: Notice[]) {
  await page.evaluate(values => (window as unknown as NotificationFixture).arcInteractionFixture.setNotices(values), values);
}
const savedNotice: Notice = { id: 1, kind: 'success', message: 'Workspace preferences saved.' };

test('hovered notifications survive their deadline and resume the remaining time across ordinary renders', async ({ page }) => {
  await notificationClock(page);
  await notices(page, [savedNotice]);
  const toast = page.locator('.toast');
  await expect(toast).toContainText(savedNotice.message);
  await page.clock.runFor(1200);
  await toast.hover();
  await page.clock.runFor(5000);
  await expect(toast).toBeVisible();
  await page.evaluate(() => (window as unknown as NotificationFixture).arcInteractionFixture.redrawNotices());
  await page.mouse.move(0, 0);
  await page.clock.runFor(2200);
  await expect(toast).toBeVisible();
  await page.clock.runFor(150);
  await expect(toast).toHaveCount(0);
  await expect(page.getByLabel('Dismissed notifications')).toHaveText('[1]');
});

test('notification keyboard focus pauses independently of hover and explicit dismissal returns the draft focus', async ({ page }) => {
  await notificationClock(page);
  const input = page.getByRole('textbox', { name: 'Outside editor draft', exact: true });
  await input.fill('Unsubmitted work remains here');
  await notices(page, [{ id: 1, kind: 'error', message: 'The preference could not be saved. Retry when ready.' }]);
  const toast = page.locator('.toast'), close = page.getByRole('button', { name: 'Dismiss notification', exact: true });
  await close.focus(); await toast.hover();
  await page.clock.runFor(10_100);
  await expect(toast).toBeVisible();
  await page.mouse.move(0, 0);
  await page.clock.runFor(10_100);
  await expect(close).toBeFocused(); await expect(toast).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(toast).toHaveCount(0);
  await expect(input).toBeFocused(); await expect(input).toHaveValue('Unsubmitted work remains here');
  await page.clock.runFor(20_000);
  await expect(page.getByLabel('Dismissed notifications')).toHaveText('[1]');
  await notices(page, [{ ...savedNotice, id: 2 }]);
  await close.focus(); await input.focus();
  await page.clock.runFor(3400); await expect(toast).toBeVisible();
  await page.clock.runFor(150); await expect(toast).toHaveCount(0);
  await expect(input).toBeFocused();
  await expect(page.getByLabel('Dismissed notifications')).toHaveText('[1,2]');
});

test('error budgets survive callback changes and a replaced notice cannot expire on its old deadline', async ({ page }) => {
  await notificationClock(page);
  await notices(page, [{ id: 7, kind: 'error', message: 'The request failed.' }]);
  await expect(page.locator('.toast')).toBeVisible();
  await page.clock.runFor(3000);
  await page.evaluate(() => (window as unknown as NotificationFixture).arcInteractionFixture.redrawNotices());
  await page.clock.runFor(6000); await expect(page.locator('.toast')).toBeVisible();
  await page.clock.runFor(1050); await expect(page.locator('.toast')).toHaveCount(0);
  await notices(page, [{ ...savedNotice, id: 9 }]);
  await expect(page.locator('.toast')).toBeVisible(); await page.clock.runFor(3000);
  await notices(page, [{ id: 9, kind: 'error', message: 'A newer error has its own reading time.' }]);
  await expect(page.locator('.toast')).toContainText('A newer error');
  await page.clock.runFor(750); await expect(page.locator('.toast')).toBeVisible();
  await expect(page.getByLabel('Dismissed notifications')).toHaveText('[7]');
  await page.clock.runFor(9000); await expect(page.locator('.toast')).toBeVisible();
  await page.clock.runFor(300); await expect(page.locator('.toast')).toHaveCount(0);
  await expect(page.getByLabel('Dismissed notifications')).toHaveText('[7,9]');
});

test('visibility events pause the queue and unmount cancels every pending dismissal', async ({ page }) => {
  await notificationClock(page);
  await notices(page, [savedNotice]);
  await expect(page.locator('.toast')).toBeVisible(); await page.clock.runFor(1000);
  // Headless tabs do not reliably become hidden when another tab is raised.
  // Drive the Page Visibility contract explicitly while all DOM/timers are real.
  const visibility = (hidden: boolean) => page.evaluate(hidden => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: hidden ? 'hidden' : 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  await visibility(true); await page.clock.runFor(20_000);
  await expect(page.locator('.toast')).toBeVisible();
  await visibility(false); await page.clock.runFor(2400);
  await expect(page.locator('.toast')).toBeVisible();
  await page.clock.runFor(150); await expect(page.locator('.toast')).toHaveCount(0);
  await notices(page, [{ ...savedNotice, id: 2 }]);
  await expect(page.locator('.toast')).toBeVisible();
  await page.evaluate(() => (window as unknown as NotificationFixture).arcInteractionFixture.setToastMounted(false));
  await expect(page.locator('.toast')).toHaveCount(0);
  await page.clock.runFor(20_000);
  await expect(page.getByLabel('Dismissed notifications')).toHaveText('[1]');
});

test('responsive notification rows keep the queue lifetime and clear an offscreen hover pause', async ({ page }) => {
  await notificationClock(page);
  await notices(page, [1, 2, 3].map(id => ({ ...savedNotice, id, message: `Saved preference ${id}.` })));
  await expect(page.locator('.toast')).toHaveCount(3); await page.clock.runFor(2000);
  await page.locator('.toast').first().hover();
  await page.evaluate(() => (window as unknown as NotificationFixture).arcInteractionFixture.setNoticeLimit(1));
  await expect(page.locator('.toast')).toHaveCount(1);
  await page.mouse.move(0, 0);
  await page.clock.runFor(1600);
  await expect(page.locator('.toast')).toHaveCount(0);
  const dismissed = JSON.parse(await page.getByLabel('Dismissed notifications').textContent() || '[]') as number[];
  expect(dismissed.sort()).toEqual([1, 2, 3]);
});
