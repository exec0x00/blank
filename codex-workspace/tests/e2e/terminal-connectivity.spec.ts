import { expect, test, type Page } from '@playwright/test';
import type { TerminalSession, Workspace } from '../../shared/types';

const headers = { 'X-Codex-Workspace': '1' };
const password = process.env.PLAYWRIGHT_PASSWORD || 'browser-test-workspace-password';
type Probe = { sockets: WebSocket[]; dropPongs: boolean; pings: number; input: string[] };

async function prepare(page: Page) {
  await page.addInitScript(() => {
    const proof: Probe = { sockets: [], dropPongs: false, pings: 0, input: [] };
    Object.assign(window, { terminalConnectionProof: proof });
    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (!String(url).includes('/ws/terminal')) return;
        proof.sockets.push(this);
        this.addEventListener('message', event => {
          try { if (JSON.parse(String(event.data)).type === 'pong' && proof.dropPongs) event.stopImmediatePropagation(); } catch { /* Not terminal JSON. */ }
        });
      }
      send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        if (this.url.includes('/ws/terminal') && typeof data === 'string') {
          try {
            const message = JSON.parse(data);
            if (message.type === 'ping') proof.pings++;
            if (message.type === 'input') proof.input.push(message.data);
          } catch { /* Preserve real transport behavior. */ }
        }
        super.send(data);
      }
    };
  });
  expect((await page.request.post('/api/session', { headers, data: { password } })).ok()).toBe(true);
  const response = await page.request.post('/api/workspaces', { headers, data: { name: 'Terminal connection ' + Date.now() } });
  expect(response.status()).toBe(201);
  const workspace = await response.json() as Workspace;
  await page.request.patch('/api/workspaces/' + workspace.id, { headers, data: { active: true } });
  const state = await (await page.request.get('/api/ui-state')).json();
  await page.request.patch('/api/ui-state', { headers, data: { revision: state.revision, changes: [
    { section: 'layout', profile: 'desktop', key: 'view', value: 'agent' },
    { section: 'layout', profile: 'desktop', key: 'split', value: 'split' },
  ] } });
  await page.goto('/work');
  await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('button', { name: 'Terminal', exact: true }).click();
  const surface = page.locator('.terminal-surface:not([hidden])');
  await expect(surface).toHaveAttribute('data-connection', 'connected');
  return { workspace, surface };
}

const proof = (page: Page) => page.evaluate(() => {
  const state = (window as unknown as { terminalConnectionProof: Probe }).terminalConnectionProof;
  return { count: state.sockets.length, pings: state.pings, input: state.input };
});
const sessions = async (page: Page, workspace: Workspace) => await (await page.request.get(`/api/workspaces/${workspace.id}/terminals`)).json() as TerminalSession[];

test('a silent open connection is retired and resumes the same shell without replaying input', async ({ page }) => {
  await page.clock.install();
  const { workspace, surface } = await prepare(page);
  const original = (await sessions(page, workspace))[0];
  const textarea = surface.locator('.xterm-helper-textarea');
  await textarea.focus();
  await page.keyboard.insertText("export ARC_RETAINED_SHELL=yes; printf 'WATCHDOG_%s\\n' 'READY'");
  await page.keyboard.press('Enter');
  await expect(surface.locator('.xterm-rows')).toContainText('WATCHDOG_READY');
  const before = await proof(page);
  await page.evaluate(() => { (window as unknown as { terminalConnectionProof: Probe }).terminalConnectionProof.dropPongs = true; });
  // Wake performs a round-trip check immediately; losing only pong replies
  // reproduces an OPEN socket that looks healthy to the WebSocket API.
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(async () => (await proof(page)).pings).toBeGreaterThan(before.pings);
  await page.clock.runFor(10_050);
  await expect(surface).toHaveAttribute('data-connection', 'reconnecting');
  await page.evaluate(() => { (window as unknown as { terminalConnectionProof: Probe }).terminalConnectionProof.dropPongs = false; });
  await page.clock.runFor(500);
  await expect(surface).toHaveAttribute('data-connection', 'connected');
  expect((await proof(page)).count).toBe(before.count + 1);
  expect((await proof(page)).input).toEqual(before.input);
  const current = await sessions(page, workspace);
  expect(current).toHaveLength(1);
  expect(current[0].id).toBe(original.id);
  expect(current[0].pid).toBe(original.pid);
  await textarea.focus();
  await page.keyboard.insertText('printf "RESUMED_%s\\n" "$ARC_RETAINED_SHELL"');
  await page.keyboard.press('Enter');
  await expect(surface.locator('.xterm-rows')).toContainText('RESUMED_yes');
});

test('a terminal reconnect preserves focus and an unsent message elsewhere in the workspace', async ({ page }) => {
  const { surface } = await prepare(page);
  const composer = page.getByRole('textbox', { name: 'Message Codex', exact: true });
  await composer.fill('Keep this unsent while the terminal reconnects.');
  await composer.focus();
  const before = await proof(page);
  await page.evaluate(() => { (window as unknown as { terminalConnectionProof: Probe }).terminalConnectionProof.sockets.at(-1)!.close(4000, 'Reconnect test'); });
  await expect.poll(async () => (await proof(page)).count).toBe(before.count + 1);
  await expect(surface).toHaveAttribute('data-connection', 'connected');
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue('Keep this unsent while the terminal reconnects.');
});
