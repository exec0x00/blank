import { test, expect, type Page } from '@playwright/test';
import type { Workspace } from '../../shared/types';

const password = process.env.PLAYWRIGHT_PASSWORD || 'browser-test-workspace-password';
const headers = { 'X-Codex-Workspace': '1' };

async function start(page: Page): Promise<Workspace> {
  expect((await page.request.post('/api/session', { headers, data: { password } })).status()).toBe(200);
  const response = await page.request.post('/api/workspaces', { headers, data: { name: 'Terminal browser performance', initializeGit: false } });
  expect(response.status()).toBe(201);
  const workspace = await response.json() as Workspace;
  await page.request.patch(`/api/workspaces/${workspace.id}`, { headers, data: { active: true } });
  await page.goto('/work');
  return workspace;
}
async function open(page: Page) {
  const name = page.viewportSize()!.width < 680 ? 'Mobile navigation' : 'Main navigation';
  await page.getByRole('navigation', { name }).getByRole('button', { name: 'Terminal', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Terminal sessions and output' });
  await expect(panel.locator('.terminal-surface:not([hidden])')).toHaveAttribute('data-connection', 'connected');
  await expect(panel.locator('footer')).toHaveCount(0);
  return panel;
}
async function write(page: Page, source: string) {
  const textarea = page.locator('.terminal-surface:not([hidden]) .xterm-helper-textarea');
  await textarea.focus();
  await page.keyboard.insertText(source);
  await page.keyboard.press('Enter');
}

test('one terminal action opens a real shell; switching warm tabs keeps their DOM, sockets and output', async ({ page }, testInfo) => {
  const sockets: string[] = [];
  const requests: string[] = [];
  page.on('websocket', (socket) => { if (socket.url().includes('/ws/terminal')) sockets.push(socket.url()); });
  page.on('request', (request) => { if (/\/api\/workspaces\/[^/]+\/terminals/.test(request.url())) requests.push(request.method()); });
  const workspace = await start(page);
  const panel = await open(page);
  expect(sockets).toHaveLength(1);
  expect(requests).toEqual([]);
  await expect(panel.getByRole('button', { name: 'Open terminal', exact: true })).toHaveCount(0);
  await write(page, "export RETAINED_TAB_VALUE=kept; printf 'FIRST_%s\\n' 'REAL_SHELL'");
  await expect(panel.locator('.terminal-surface:not([hidden]) .xterm-rows')).toContainText('FIRST_REAL_SHELL');
  const firstRows = await panel.locator('.terminal-surface:not([hidden]) .xterm-rows').elementHandle();
  await panel.getByRole('button', { name: 'New terminal', exact: true }).click();
  await expect(panel.getByRole('tab')).toHaveCount(2);
  await expect(panel.locator('.terminal-surface:not([hidden])')).toHaveAttribute('data-connection', 'connected');
  await write(page, "printf 'SECOND_%s\\n' 'REAL_SHELL'");
  await expect(panel.locator('.terminal-surface:not([hidden]) .xterm-rows')).toContainText('SECOND_REAL_SHELL');
  expect(sockets).toHaveLength(2);
  const timing = await panel.getByRole('tab', { name: 'bash 1', exact: true }).evaluate((button) => new Promise<number>((resolve) => {
    const start = performance.now();
    (button as HTMLButtonElement).click();
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - start)));
  }));
  await expect(panel.locator('.terminal-surface:not([hidden]) .xterm-rows')).toContainText('FIRST_REAL_SHELL');
  expect(await firstRows!.evaluate((rows) => rows.isConnected && !rows.closest<HTMLElement>('.terminal-surface')!.hidden)).toBe(true);
  expect(sockets).toHaveLength(2);
  expect(requests).toEqual([]);
  await write(page, 'printf "KEPT_%s\\n" "$RETAINED_TAB_VALUE"; pwd');
  await expect(panel.locator('.terminal-surface:not([hidden]) .xterm-rows')).toContainText('KEPT_kept');
  await expect(panel.locator('.terminal-surface:not([hidden]) .xterm-rows')).toContainText(workspace.path);
  await testInfo.attach('warm-tab-frame-timing', { body: JSON.stringify({ milliseconds: timing, websocketCount: sockets.length, terminalRESTRequests: requests.length }), contentType: 'application/json' });
  await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
  await expect(page.getByLabel('Workspace password', { exact: true })).toBeVisible();
  await page.getByLabel('Workspace password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(panel.locator('.terminal-surface:not([hidden])')).toHaveAttribute('data-connection', 'connected');
  await expect(panel.locator('.terminal-surface:not([hidden]) .xterm-rows')).toContainText('KEPT_kept');
  expect(await firstRows!.evaluate((rows) => rows.isConnected)).toBe(true);
  await write(page, 'printf "UNLOCKED_%s\\n" "$RETAINED_TAB_VALUE"');
  await expect(panel.locator('.terminal-surface:not([hidden]) .xterm-rows')).toContainText('UNLOCKED_kept');
});

test('large output is consumed without disconnecting a slower renderer, with real command completion', async ({ page }, testInfo) => {
  await start(page);
  const panel = await open(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Profiler.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Profiler.start');
  const before = await cdp.send('Performance.getMetrics');
  await write(page, 'node -e "process.stdout.write(\'x\'.repeat(2 * 1024 * 1024))"; printf "\\nFLOW_%s\\n" "COMPLETE"');
  await expect(panel.locator('.terminal-surface:not([hidden]) .xterm-rows')).toContainText('FLOW_COMPLETE', { timeout: 20_000 });
  await expect(panel.locator('.terminal-surface:not([hidden])')).toHaveAttribute('data-connection', 'connected');
  await expect(panel.getByRole('alert')).toHaveCount(0);
  const after = await cdp.send('Performance.getMetrics');
  const { profile } = await cdp.send('Profiler.stop');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const metric = (data: typeof before, name: string) => data.metrics.find((item) => item.name === name)?.value || 0;
  await testInfo.attach('large-output-cpu', { body: JSON.stringify({ characters: 2 * 1024 * 1024, cpuThrottle: 4, taskDurationSeconds: metric(after, 'TaskDuration') - metric(before, 'TaskDuration'), scriptDurationSeconds: metric(after, 'ScriptDuration') - metric(before, 'ScriptDuration'), heapAfterBytes: metric(after, 'JSHeapUsedSize') }), contentType: 'application/json' });
  await testInfo.attach('large-output.cpuprofile', { body: JSON.stringify(profile), contentType: 'application/json' });
});

test('consumes tiny native TUI frames with bounded acknowledgements under CPU throttling', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const proof = { connections: 0, outputFrames: 0, acknowledged: [] as number[] };
    (window as unknown as { terminalFrames: typeof proof }).terminalFrames = proof;
    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (!String(url).includes('/ws/terminal')) return;
        proof.connections++;
        this.addEventListener('message', event => {
          if (JSON.parse(String(event.data)).type === 'output') proof.outputFrames++;
        });
      }
      send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        if (typeof data === 'string') {
          const message = JSON.parse(data) as { type: string; characters?: number };
          if (message.type === 'ack') proof.acknowledged.push(message.characters!);
        }
        super.send(data);
      }
    };
  });
  const workspace = await start(page);
  const producer = "if(!process.stdout.isTTY)throw new Error('A real PTY is required');let i=0;const next=()=>{if(i++<1800){process.stdout.write('\\r'+String(i).padStart(4,'0'));setTimeout(next,1)}else process.stdout.write('\\r\\nTINY_NATIVE_COMPLETE\\r\\n')};next()";
  expect((await page.request.put(`/api/workspaces/${workspace.id}/file`, { headers, data: { path: 'tiny-output.cjs', content: producer } })).ok()).toBe(true);
  const panel = await open(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const started = Date.now();
  try {
    await write(page, 'node ./tiny-output.cjs');
    await expect(panel.locator('.xterm-rows')).toContainText('TINY_NATIVE_COMPLETE', { timeout: 20_000 });
    await expect(panel.locator('.terminal-surface')).toHaveAttribute('data-connection', 'connected');
    await expect(panel.getByRole('alert')).toHaveCount(0);
    const proof = await page.evaluate(() => (window as unknown as { terminalFrames: { connections: number; outputFrames: number; acknowledged: number[] } }).terminalFrames);
    expect(proof.connections).toBe(1);
    expect(proof.outputFrames).toBeGreaterThan(256);
    expect(proof.acknowledged.length).toBeGreaterThan(5);
    expect(proof.acknowledged.length).toBeLessThan(proof.outputFrames / 4);
    expect(proof.acknowledged.some(characters => characters < 16 * 1024)).toBe(true);
    await testInfo.attach('tiny-native-frame-credit', { body: JSON.stringify({ cpuThrottle: 4, elapsedMs: Date.now() - started, ...proof }), contentType: 'application/json' });
  } finally { await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }); }
});

test('applies a pane resize after older native TUI output without wrapping over other rows', async ({ page }) => {
  await page.addInitScript(() => {
    type ControlledSocket = WebSocket & { deliver(event: MessageEvent): void };
    const proof = { hold: false, releaseOnResize: false, held: [] as Array<{ socket: ControlledSocket; event: MessageEvent }>, requested: 0, confirmed: 0 };
    (window as unknown as { terminalResize: typeof proof }).terminalResize = proof;
    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket {
      private handler: WebSocket['onmessage'] = null;
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener('message', event => {
          const message = JSON.parse(String(event.data)) as { type: string; cols?: number };
          if (message.type === 'resize') proof.confirmed = message.cols!;
          // Hold real output at the transport boundary to reproduce network
          // delay. Nothing changes its content, geometry or sequence number.
          if (proof.hold && message.type === 'output') { proof.held.push({ socket: this, event }); return; }
          this.deliver(event);
        });
      }
      get onmessage() { return this.handler; }
      set onmessage(handler: WebSocket['onmessage']) { this.handler = handler; }
      deliver(event: MessageEvent) { this.handler?.call(this, event); }
      send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        if (typeof data === 'string') {
          const message = JSON.parse(data) as { type: string; cols?: number };
          if (message.type === 'resize') {
            proof.requested = message.cols!;
            if (proof.releaseOnResize) {
              proof.hold = false; proof.releaseOnResize = false;
              for (const held of proof.held.splice(0)) held.socket.deliver(held.event);
            }
          }
        }
        super.send(data);
      }
    };
  });
  const workspace = await start(page);
  const source = "if(!process.stdin.isTTY)throw new Error('A real PTY is required');process.stdin.setRawMode(true);process.stdin.resume();process.stdout.write('\\x1b[?1049h\\x1b[2J\\x1b[3;1HRESIZE_ROW_PRESERVED');process.stdin.on('data',data=>{if(data.toString()==='R')process.stdout.write('\\x1b[H'+'W'.repeat(process.stdout.columns-2));if(data.toString()==='q'){process.stdout.write('\\x1b[?1049l\\r\\nRESIZE_TUI_CLOSED\\r\\n');process.stdin.setRawMode(false);process.exit(0)}})";
  expect((await page.request.put(`/api/workspaces/${workspace.id}/file`, { headers, data: { path: 'resize-output.cjs', content: source } })).ok()).toBe(true);
  const panel = await open(page);
  await write(page, 'node ./resize-output.cjs');
  await expect(panel.locator('.xterm-rows')).toContainText('RESIZE_ROW_PRESERVED');
  await page.evaluate(() => { const proof = (window as unknown as { terminalResize: { hold: boolean; releaseOnResize: boolean } }).terminalResize; proof.hold = true; proof.releaseOnResize = true; });
  await page.keyboard.press('R');
  await page.waitForFunction(() => (window as unknown as { terminalResize: { held: unknown[] } }).terminalResize.held.length > 0);
  await panel.locator('.terminal-xterm').evaluate(element => { (element as HTMLElement).style.width = `${Math.floor(element.clientWidth / 2)}px`; });
  await page.waitForFunction(() => { const proof = (window as unknown as { terminalResize: { requested: number; confirmed: number } }).terminalResize; return proof.requested > 0 && proof.requested === proof.confirmed; });
  await expect(panel.locator('.xterm-rows > div').nth(2)).toHaveText('RESIZE_ROW_PRESERVED');
  await expect(panel.locator('.xterm-rows > div').nth(1)).toHaveText('');
  await page.keyboard.press('q');
  await expect(panel.locator('.xterm-rows')).toContainText('RESIZE_TUI_CLOSED');
  await expect(panel.locator('.terminal-surface')).toHaveAttribute('data-connection', 'connected');
});

test('measures real key echo through the next frame after xterm updates', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    type Sample = { dataMs: number; frameMs: number };
    const timing: { enabled: boolean; samples: Sample[]; pending?: { start: number; received?: number; expected: string; scheduled?: boolean } } = { enabled: false, samples: [] };
    (window as unknown as { terminalTiming: typeof timing }).terminalTiming = timing;
    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener('message', (event) => {
          if (!timing.pending) return;
          let message: { type?: string; data?: string };
          try { message = JSON.parse(String(event.data)); } catch { return; }
          if (message.type === 'output' && message.data?.includes('q')) timing.pending.received = performance.now();
        });
      }
      send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        if (timing.enabled && typeof data === 'string') {
          let message: { type?: string; data?: string };
          try { message = JSON.parse(data); } catch { message = {}; }
          if (message.type === 'input' && message.data === 'q') timing.pending = { start: performance.now(), expected: 'q'.repeat(timing.samples.length + 1) };
        }
        super.send(data);
      }
    };
    const observer = new MutationObserver(() => {
      const pending = timing.pending;
      if (!pending || pending.scheduled || pending.received === undefined) return;
      const rows = document.querySelector('.terminal-surface:not([hidden]) .xterm-rows');
      if (!rows?.textContent?.includes(`paint> ${pending.expected}`)) return;
      pending.scheduled = true;
      requestAnimationFrame(() => {
        timing.samples.push({ dataMs: pending.received! - pending.start, frameMs: performance.now() - pending.start });
        if (timing.pending === pending) timing.pending = undefined;
      });
    });
    observer.observe(document, { subtree: true, childList: true, characterData: true });
  });
  await start(page);
  const panel = await open(page);
  await write(page, "PS1='paint> '; PROMPT_COMMAND=; clear");
  await expect(panel.locator('.xterm-rows')).toContainText('paint>');
  await page.evaluate(() => { (window as unknown as { terminalTiming: { enabled: boolean } }).terminalTiming.enabled = true; });
  for (let index = 0; index < 30; index++) {
    await page.keyboard.press('q');
    await page.waitForFunction((expected) => (window as unknown as { terminalTiming: { samples: unknown[] } }).terminalTiming.samples.length === expected, index + 1);
  }
  const samples = await page.evaluate(() => (window as unknown as { terminalTiming: { samples: { dataMs: number; frameMs: number }[] } }).terminalTiming.samples);
  const summary = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return { p50: sorted[Math.ceil(sorted.length * .5) - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1)! };
  };
  const frameMs = summary(samples.map((sample) => sample.frameMs));
  expect(frameMs.p50).toBeLessThan(120);
  expect(frameMs.p95).toBeLessThan(300);
  await testInfo.attach('keypress-frame-timing', { body: JSON.stringify({ sampleCount: samples.length, actualDataMs: summary(samples.map((sample) => sample.dataMs)), frameMs }), contentType: 'application/json' });
  await page.keyboard.press('Control+u');
});

test('phone terminal has neutral colors, accessible touch controls, and keeps the viewport contained', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => localStorage.setItem('codex.theme', 'light'));
  await start(page);
  const panel = await open(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  for (const button of await panel.locator('.terminal-touch-controls button').all()) {
    const size = await button.boundingBox();
    expect(size?.height).toBeGreaterThanOrEqual(44);
    expect(size?.width).toBeGreaterThanOrEqual(44);
  }
  expect(await panel.locator('.xterm-viewport').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(17, 17, 17)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await write(page, "printf 'PHONE_%s\\n' 'PTY_READY'");
  await expect(panel.locator('.xterm-rows')).toContainText('PHONE_PTY_READY');
});
