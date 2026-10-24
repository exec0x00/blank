import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { buildSync } from 'esbuild';
import { test, expect, type Page } from '@playwright/test';
import type { Terminal as BrowserTerminal } from '@xterm/xterm';
import type { TerminalSession, Workspace } from '../../shared/types';
import { TerminalReplay } from '../../server/terminal-replay';

const password = process.env.PLAYWRIGHT_PASSWORD || 'browser-test-workspace-password';
const headers = { 'X-Codex-Workspace': '1' };
async function command(page: Page, source: string) {
  await page.locator('.terminal-surface:not([hidden]) .xterm-helper-textarea').focus();
  await page.keyboard.insertText(source);
  await page.keyboard.press('Enter');
}
async function terminalPanel(page: Page) {
  const panel = page.getByRole('region', { name: 'Terminal sessions and output' });
  if (!await panel.isVisible()) {
    const nav = page.viewportSize()!.width < 680 ? 'Mobile navigation' : 'Main navigation';
    await page.getByRole('navigation', { name: nav }).getByRole('button', { name: 'Terminal', exact: true }).click();
  }
  await expect(panel.locator('.terminal-surface:not([hidden])')).toHaveAttribute('data-connection', 'connected');
  return panel;
}

for (const position of ['live output', 'intentional history'] as const) {
  test(`reconnect preserves the settled viewport for ${position}`, async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      const proof = { connections: [] as Array<{ socket: WebSocket; replay: string; live: string; complete: boolean }>,
        scrolls: [] as Array<{ top: number; maximum: number; trusted: boolean }> };
      (window as unknown as { __terminalReconnect: typeof proof }).__terminalReconnect = proof;
      const NativeSocket = window.WebSocket;
      window.WebSocket = class extends NativeSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          if (!String(url).includes('/ws/terminal')) return;
          const entry = { socket: this as WebSocket, replay: '', live: '', complete: false };
          proof.connections.push(entry);
          this.addEventListener('message', event => {
            const message = JSON.parse(String(event.data)) as { type: string; data?: string };
            if (message.type === 'output') { if (entry.complete) entry.live += message.data ?? ''; else entry.replay += message.data ?? ''; }
            if (message.type === 'replay-complete') entry.complete = true;
          });
        }
      };
      document.addEventListener('scroll', event => {
        if (!(event.target instanceof HTMLElement) || !event.target.matches('.xterm-viewport')) return;
        proof.scrolls.push({ top: event.target.scrollTop, maximum: event.target.scrollHeight - event.target.clientHeight, trusted: event.isTrusted });
        if (proof.scrolls.length > 40) proof.scrolls.shift();
      }, true);
    });
    expect((await page.request.post('/api/session', { headers, data: { password } })).status()).toBe(200);
    const workspace = await (await page.request.post('/api/workspaces', { headers, data: { name: `Reconnect ${position}`, initializeGit: false } })).json() as Workspace;
    await page.request.patch(`/api/workspaces/${workspace.id}`, { headers, data: { active: true } });
    const producer = `if(!process.stdout.isTTY)throw new Error('A native PTY is required');let i=0;const timer=setInterval(()=>{process.stdout.write('LIVE_SEQUENCE_'+String(i).padStart(4,'0')+'\\n');if(++i===200){clearInterval(timer);process.stdout.write('LIVE_SEQUENCE_COMPLETE\\n');}},10);`;
    expect((await page.request.put(`/api/workspaces/${workspace.id}/file`, { headers, data: { path: 'reconnect-stream.cjs', content: producer } })).ok()).toBe(true);
    await page.goto('/work');
    const panel = await terminalPanel(page), viewport = panel.locator('.xterm-viewport'), rows = panel.locator('.xterm-rows');
    const sourceRows = position === 'live output' ? 4000 : 1200, padding = position === 'live output' ? 20 : 65;
    await command(page, `node -e "for(let i=0;i<${sourceRows};i++)process.stdout.write('REPLAY_HISTORY_'+String(i).padStart(4,'0')+' '+ 'x'.repeat(${padding})+'\\n')"; printf 'HISTORY_%s\\n' READY`);
    await expect(rows).toContainText('HISTORY_READY');
    const sessions = await (await page.request.get(`/api/workspaces/${workspace.id}/terminals`)).json() as TerminalSession[];
    expect(sessions).toHaveLength(1);
    const settled = () => viewport.evaluate(async element => {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const proof = (window as unknown as { __terminalReconnect: { scrolls: Array<{ top: number; maximum: number; trusted: boolean }> } }).__terminalReconnect;
      return { top: element.scrollTop, maximum: element.scrollHeight - element.clientHeight,
        firstLine: element.closest('.terminal-surface')!.querySelector('.xterm-rows > div')!.textContent,
        lastScroll: proof.scrolls.at(-1) };
    });
    if (position === 'live output') {
      await command(page, 'node ./reconnect-stream.cjs');
      await page.waitForFunction(() => (window as unknown as { __terminalReconnect: { connections: Array<{ live: string }> } }).__terminalReconnect.connections.at(-1)?.live.includes('LIVE_SEQUENCE_0005'));
    } else {
      await panel.locator('.xterm-screen').hover();
      await page.mouse.wheel(0, -420);
      await expect.poll(async () => (await settled()).top).toBeLessThan((await settled()).maximum - 100);
    }
    const before = await settled();
    expect(before.lastScroll?.trusted).toBe(true);
    expect(before.lastScroll?.top).toBeCloseTo(before.top, 0);
    if (position === 'live output') expect(before.top).toBeCloseTo(before.maximum, 0);
    else { expect(before.top).toBeGreaterThan(0); expect(before.firstLine).toContain('REPLAY_HISTORY_'); }
    const count = await page.evaluate(() => {
      const proof = (window as unknown as { __terminalReconnect: { connections: Array<{ socket: WebSocket }> } }).__terminalReconnect;
      const count = proof.connections.length; proof.connections.at(-1)!.socket.close(); return count;
    });
    await page.waitForFunction(previous => (window as unknown as { __terminalReconnect: { connections: unknown[] } }).__terminalReconnect.connections.length > previous, count);
    await terminalPanel(page);
    if (position === 'live output') {
      await page.waitForFunction(() => (window as unknown as { __terminalReconnect: { connections: Array<{ live: string }> } }).__terminalReconnect.connections.at(-1)?.live.includes('LIVE_SEQUENCE_COMPLETE'));
      await expect(rows).toContainText('LIVE_SEQUENCE_COMPLETE');
      const wire = await page.evaluate(() => {
        const entry = (window as unknown as { __terminalReconnect: { connections: Array<{ replay: string; live: string }> } }).__terminalReconnect.connections.at(-1)!;
        return { replay: entry.replay, live: entry.live };
      });
      expect(wire.replay).toContain('LIVE_SEQUENCE_'); expect(wire.live).toContain('LIVE_SEQUENCE_');
      expect([...stripVTControlCharacters(wire.replay + wire.live).matchAll(/LIVE_SEQUENCE_(\d{4})/g)].map(match => Number(match[1])))
        .toEqual(Array.from({ length: 200 }, (_, index) => index));
      expect((await settled()).top).toBeCloseTo((await settled()).maximum, 0);
    } else {
      await expect.poll(async () => (await settled()).firstLine).toBe(before.firstLine);
      expect((await settled()).top).toBeCloseTo(before.top, 0);
    }
    const after = await (await page.request.get(`/api/workspaces/${workspace.id}/terminals`)).json() as TerminalSession[];
    expect(after.map(session => [session.id, session.pid])).toEqual(sessions.map(session => [session.id, session.pid]));
    await testInfo.attach(`settled-reconnect-${position.replaceAll(' ', '-')}`, { body: JSON.stringify({ before, after: await settled(), nativePid: sessions[0].pid }), contentType: 'application/json' });
    await page.request.delete(`/api/terminals/${sessions[0].id}`, { headers, data: {} });
  });
}

test('restores the recent context and a native TUI through reload, paste, mouse, clear and phone resize', async ({ page }, testInfo) => {
  expect((await page.request.post('/api/session', { headers, data: { password } })).status()).toBe(200);
  const workspace = await (await page.request.post('/api/workspaces', { headers, data: { name: 'Native terminal replay', initializeGit: false } })).json() as Workspace;
  await page.request.patch(`/api/workspaces/${workspace.id}`, { headers, data: { active: true } });
  const source = await readFile(path.resolve('tests/fixtures/terminal-tui.cjs'), 'utf8');
  expect((await page.request.put(`/api/workspaces/${workspace.id}/file`, { headers, data: { path: 'tui-fixture.cjs', content: source } })).ok()).toBe(true);
  const getInput = async () => {
    const response = await page.request.get(`/api/workspaces/${workspace.id}/file`, { params: { path: 'tui-input.log' } });
    if (!response.ok()) return '';
    const value = await response.json() as { content: string };
    return value.content.trim().split('\n').filter(Boolean).map(hex => Buffer.from(hex, 'hex').toString('utf8')).join('');
  };
  await page.goto('/work');
  const panel = await terminalPanel(page);
  await command(page, 'node -e "for(let i=0;i<4000;i++) process.stdout.write(\'RECENT_CONTEXT_\'+i+\' useful compiler output\\n\')"; printf "CONTEXT_COMPLETE\\n"');
  await expect(panel.locator('.xterm-rows')).toContainText('CONTEXT_COMPLETE', { timeout: 20_000 });
  await command(page, 'node ./tui-fixture.cjs ./tui-input.log');
  await expect(panel.locator('.xterm-rows')).toContainText('Native TUI fixture');
  const palette = await panel.locator('.xterm-fg-2').first().evaluate(element => getComputedStyle(element).color);
  const before = await (await page.request.get(`/api/workspaces/${workspace.id}/terminals`)).json() as TerminalSession[];
  expect(before).toHaveLength(1);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const start = Date.now();
  await page.reload();
  const restored = await terminalPanel(page);
  await expect(restored.locator('.xterm-rows')).toContainText('Native TUI fixture');
  await expect(restored.locator('.xterm-rows')).toContainText('TERM=xterm-256color');
  await expect(restored.locator('.xterm-rows')).toContainText('你好');
  expect(await restored.locator('.xterm-fg-2').first().evaluate(element => getComputedStyle(element).color)).toBe(palette);
  await expect(restored.locator('.terminal-history-note')).toContainText('Earlier output was trimmed');
  const restoredMs = Date.now() - start;
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const after = await (await page.request.get(`/api/workspaces/${workspace.id}/terminals`)).json() as TerminalSession[];
  expect(after.map(session => [session.id, session.pid])).toEqual(before.map(session => [session.id, session.pid]));
  await restored.locator('.terminal-history-note button').click();
  const textarea = restored.locator('.xterm-helper-textarea');
  await textarea.focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(getInput).toContain('\x1bOA');
  await textarea.evaluate(element => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', 'pasted native text');
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  await expect.poll(getInput).toContain('\x1b[200~pasted native text\x1b[201~');
  await restored.locator('.xterm-screen').click({ position: { x: 110, y: 55 } });
  await expect.poll(getInput).toMatch(/\x1b\[<0;\d+;\d+M/);
  await restored.getByRole('button', { name: 'Clear terminal output', exact: true }).click();
  await expect(restored.locator('.xterm-rows')).toContainText('Native TUI fixture');
  await page.setViewportSize({ width: 390, height: 844 });
  await terminalPanel(page);
  await expect(restored.locator('.terminal-surface:not([hidden])')).toHaveAttribute('data-connection', 'connected');
  await expect(restored.locator('.xterm-rows')).toContainText('Size');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await textarea.focus();
  await page.keyboard.press('q');
  await expect(restored.locator('.xterm-rows')).toContainText('TUI closed cleanly');
  await command(page, "printf 'SHELL_AFTER_TUI_%s\\n' READY");
  await expect(restored.locator('.xterm-rows')).toContainText('SHELL_AFTER_TUI_READY');
  await testInfo.attach('native-tui-replay', { body: JSON.stringify({ cpuThrottleDuringReload: 4, reloadAndRestoreMs: restoredMs, sameNativePid: true, actualInput: await getInput() }), contentType: 'application/json' });
  for (const session of before) await page.request.delete(`/api/terminals/${session.id}`, { headers, data: {} });
});

test('measures candidate scrollback restoration in the actual xterm renderer under fourfold CPU throttling', async ({ page }, testInfo) => {
  const source = new TerminalReplay(100, 28, () => {}, 5000);
  const transcript = Array.from({ length: 9000 }, (_, index) => `\x1b[38;5;${index % 255}m${String(index).padStart(5)}\x1b[0m build src/features/item-${index}.ts done, 你好 😀 useful recent context\r\n`).join('');
  try {
    source.write(transcript);
    const candidates: Array<{ label: string; data: string; lines: number; bytes: number }> = [];
    for (const [lines, byteLimit] of [[100, 16 * 1024], [250, 32 * 1024], [500, 64 * 1024], [1000, 128 * 1024], [2000, 256 * 1024]]) {
      const snapshot = await source.snapshot(lines, byteLimit);
      candidates.push({ label: `${lines} lines/${byteLimit} bytes`, data: snapshot.data, lines, bytes: Buffer.byteLength(snapshot.data) });
    }
    candidates.push({ label: 'previous raw 256 Ki characters / 5000 scrollback', data: transcript.slice(-256 * 1024), lines: 5000, bytes: Buffer.byteLength(transcript.slice(-256 * 1024)) });
    await page.goto('about:blank');
    await page.addStyleTag({ path: path.resolve('node_modules/@xterm/xterm/css/xterm.css') });
    await page.addScriptTag({ path: path.resolve('node_modules/@xterm/xterm/lib/xterm.js') });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const measurements = await page.evaluate(async entries => {
      const Xterm = (window as unknown as { Terminal: new (options: Record<string, unknown>) => BrowserTerminal }).Terminal;
      const observations: Array<{ label: string; bytes: number; parseMs: number; paintedMs: number }> = [];
      for (let sample = 0; sample < 5; sample++) {
        for (const entry of entries) {
          const host = document.createElement('div');
          host.style.cssText = 'width:1000px;height:530px;background:#0a0a0a';
          document.body.append(host);
          const terminal = new Xterm({ cols: 100, rows: 28, scrollback: entry.lines, fontSize: 13, lineHeight: 1.32, theme: { background: '#0a0a0a', foreground: '#ededed' } });
          terminal.open(host);
          await new Promise<void>(resolve => terminal.write('warmup', resolve));
          terminal.reset();
          const started = performance.now();
          for (let offset = 0; offset < entry.data.length;) {
            let end = Math.min(entry.data.length, offset + 16 * 1024);
            if (end < entry.data.length && /[\uD800-\uDBFF]/.test(entry.data[end - 1]) && /[\uDC00-\uDFFF]/.test(entry.data[end])) end--;
            await new Promise<void>(resolve => terminal.write(entry.data.slice(offset, end), resolve));
            offset = end;
          }
          const parsed = performance.now();
          await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          observations.push({ label: entry.label, bytes: entry.bytes, parseMs: parsed - started, paintedMs: performance.now() - started });
          terminal.dispose(); host.remove();
        }
      }
      return observations;
    }, candidates);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    expect(measurements).toHaveLength(30);
    expect(measurements.every(sample => sample.paintedMs >= sample.parseMs && sample.parseMs >= 0)).toBe(true);
    await testInfo.attach('terminal-replay-candidates', { body: JSON.stringify({ cpuThrottle: 4, observations: measurements }), contentType: 'application/json' });
  } finally { source.dispose(); }
});

async function loadViewportCompatibility(page: Page) {
  const bundle = buildSync({ entryPoints: [path.resolve('client/terminal-viewport.ts')], bundle: true, write: false,
    platform: 'browser', format: 'iife', globalName: 'TerminalViewportCompatibility', target: 'es2022' }).outputFiles[0].text;
  await page.goto('about:blank');
  await page.addStyleTag({ path: path.resolve('node_modules/@xterm/xterm/css/xterm.css') });
  await page.addScriptTag({ path: path.resolve('node_modules/@xterm/xterm/lib/xterm.js') });
  await page.addScriptTag({ content: bundle });
}

test('keeps real native scrollbar clamps finite across both terminal reset paths', async ({ page }, testInfo) => {
  await loadViewportCompatibility(page);
  const result = await page.evaluate(async () => {
    type Viewport = { reset(): void; syncScrollArea(immediate: boolean): void; _currentRowHeight: number; _viewportElement: HTMLElement };
    const runtime = window as unknown as { Terminal: new (options: Record<string, unknown>) => BrowserTerminal;
      TerminalViewportCompatibility: { synchronizeTerminalViewportResets(terminal: BrowserTerminal): () => void } };
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const outcomes = [];
    for (const guarded of [false, true]) {
      const host = document.createElement('div');
      host.style.cssText = 'width:900px;height:260px'; document.body.append(host);
      const terminal = new runtime.Terminal({ cols: 90, rows: 9, scrollback: 500, fontSize: 14, lineHeight: 1.32, allowProposedApi: true });
      terminal.open(host);
      const viewport = (terminal as unknown as { _core: { viewport: Viewport } })._core.viewport;
      const originalReset = viewport.reset;
      const dispose = guarded ? runtime.TerminalViewportCompatibility.synchronizeTerminalViewportResets(terminal) : () => {};
      const write = (data: string) => new Promise<void>(resolve => terminal.write(data, resolve));
      try {
        await write(Array.from({ length: 800 }, (_, index) => `NATIVE_RESET_HISTORY_${index}\r\n`).join(''));
        await frame(); terminal.scrollToLine(terminal.buffer.normal.baseY - 20); await frame();
        const before = { top: viewport._viewportElement.scrollTop, cols: terminal.cols, rows: terminal.rows };
        const scrolls: Array<{ trusted: boolean; rowHeight: number; finite: boolean }> = [];
        viewport._viewportElement.addEventListener('scroll', event => scrolls.push({ trusted: event.isTrusted,
          rowHeight: viewport._currentRowHeight, finite: Number.isFinite(terminal.buffer.normal.viewportY) }));
        // The first renderer synchronization clamps the real DOM scrollbar.
        // A second reset before that queued native event mirrors explicit reset
        // followed by replay RIS. No scroll event or metric is fabricated.
        terminal.reset(); viewport.syncScrollArea(true); terminal.reset();
        await frame();
        const after = { finite: Number.isFinite(terminal.buffer.normal.viewportY), position: String(terminal.buffer.normal.viewportY),
          rowHeight: viewport._currentRowHeight, cols: terminal.cols, rows: terminal.rows };
        let risHeight: number | undefined, rendered: string | undefined;
        if (guarded) {
          await write('\x18\x1bc'); risHeight = viewport._currentRowHeight;
          await write('NATIVE_RESET_READABLE'); await frame();
          rendered = host.querySelector('.xterm-rows')?.textContent ?? '';
        }
        dispose();
        outcomes.push({ guarded, before, after, scrolls, risHeight, rendered, originalResetRestored: viewport.reset === originalReset });
      } finally { dispose(); terminal.dispose(); host.remove(); }
    }
    return outcomes;
  });
  const [native, guarded] = result;
  expect(native.before.top).toBeGreaterThan(0);
  expect(native.scrolls.some(event => event.trusted && event.rowHeight === 0 && !event.finite)).toBe(true);
  expect(native.after.position).toBe('NaN');
  expect(guarded.before.top).toBeGreaterThan(0);
  expect(guarded.scrolls.length).toBeGreaterThan(0);
  expect(guarded.scrolls.every(event => event.trusted && event.rowHeight > 0 && event.finite)).toBe(true);
  expect(guarded.after.finite).toBe(true);
  expect([guarded.after.cols, guarded.after.rows]).toEqual([guarded.before.cols, guarded.before.rows]);
  expect(guarded.risHeight).toBeGreaterThan(0);
  expect(guarded.rendered).toContain('NATIVE_RESET_READABLE');
  expect(result.every(value => value.originalResetRestored)).toBe(true);
  await testInfo.attach('native-reset-scroll-comparison', { body: JSON.stringify(result), contentType: 'application/json' });
});

test('uses measured viewport geometry for hidden terminals and releases only its own reset wrapper', async ({ page }, testInfo) => {
  await loadViewportCompatibility(page);
  const results = [];
  for (const measurement of ['native', 'dom'] as const) {
    const result = await page.evaluate(async measurement => {
      type Viewport = { reset(): void; _currentRowHeight: number; _charSizeService: { height: number };
        _renderDimensions: { device: { cell: { height: number } } }; _coreBrowserService: { dpr: number } };
      const runtime = window as unknown as { Terminal: new (options: Record<string, unknown>) => BrowserTerminal;
        TerminalViewportCompatibility: { synchronizeTerminalViewportResets(terminal: BrowserTerminal): () => void } };
      // Exercise xterm's real DOM measurement fallback too. A hidden native
      // OffscreenCanvas can legitimately obtain positive TextMetrics already.
      const canvas = Object.getOwnPropertyDescriptor(window, 'OffscreenCanvas');
      if (measurement === 'dom') Object.defineProperty(window, 'OffscreenCanvas', { configurable: true, value: undefined });
      const host = document.createElement('div'); host.style.cssText = 'display:none;width:900px;height:260px'; document.body.append(host);
      const terminal = new runtime.Terminal({ cols: 90, rows: 9, fontSize: 14, lineHeight: 1.32 }); terminal.open(host);
      const viewport = (terminal as unknown as { _core: { viewport: Viewport } })._core.viewport, original = viewport.reset;
      const nativeMetrics = { charHeight: viewport._charSizeService.height, cellHeight: viewport._renderDimensions.device.cell.height,
        dpr: viewport._coreBrowserService.dpr };
      const dispose = runtime.TerminalViewportCompatibility.synchronizeTerminalViewportResets(terminal);
      try {
        terminal.reset();
        const unmeasured = { charHeight: viewport._charSizeService.height, rowHeight: viewport._currentRowHeight };
        host.style.display = 'block';
        await new Promise<void>((resolve, reject) => {
          const deadline = performance.now() + 3000;
          const measured = () => {
            if (viewport._charSizeService.height > 0 && viewport._renderDimensions.device.cell.height > 0
              && viewport._coreBrowserService.dpr > 0) { resolve(); return; }
            if (performance.now() >= deadline) { reject(new Error('The visible terminal did not obtain real measurements.')); return; }
            requestAnimationFrame(measured);
          };
          requestAnimationFrame(measured);
        });
        // Deferred DOM measurement is now real. A subsequent reset must use it
        // synchronously, without assuming a renderer paint already scrolled.
        terminal.reset();
        await new Promise<void>(resolve => terminal.write('MEASURED_HIDDEN_TERMINAL', resolve));
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const measured = { charHeight: viewport._charSizeService.height, rowHeight: viewport._currentRowHeight,
          rendered: host.querySelector('.xterm-rows')?.textContent ?? '', cols: terminal.cols, rows: terminal.rows };
        host.style.display = 'none'; terminal.reset();
        const retained = { charHeight: viewport._charSizeService.height, rowHeight: viewport._currentRowHeight,
          cols: terminal.cols, rows: terminal.rows };
        dispose(); dispose(); const restored = viewport.reset === original;
        const stop = runtime.TerminalViewportCompatibility.synchronizeTerminalViewportResets(terminal), installed = viewport.reset;
        function later(this: Viewport) { installed.call(this); }
        viewport.reset = later; stop(); const laterPreserved = viewport.reset === later;
        viewport.reset = original;
        return { measurement, nativeMetrics, unmeasured, measured, retained, restored, laterPreserved };
      } finally {
        dispose(); terminal.dispose(); host.remove();
        if (measurement === 'dom') {
          if (canvas) Object.defineProperty(window, 'OffscreenCanvas', canvas);
          else Reflect.deleteProperty(window, 'OffscreenCanvas');
        }
      }
    }, measurement);
    const metrics = result.nativeMetrics;
    expect(result.unmeasured.charHeight).toBe(metrics.charHeight);
    expect(result.unmeasured.rowHeight).toBe(metrics.charHeight > 0 && metrics.cellHeight > 0 && metrics.dpr > 0
      ? metrics.cellHeight / metrics.dpr : 0);
    if (measurement === 'dom') expect(result.unmeasured).toEqual({ charHeight: 0, rowHeight: 0 });
    expect(result.measured.charHeight).toBeGreaterThan(0);
    expect(result.measured.rowHeight).toBeGreaterThan(0);
    expect(result.measured.rendered).toContain('MEASURED_HIDDEN_TERMINAL');
    expect(result.retained).toEqual({ charHeight: result.measured.charHeight, rowHeight: result.measured.rowHeight,
      cols: result.measured.cols, rows: result.measured.rows });
    expect(result.restored).toBe(true);
    expect(result.laterPreserved).toBe(true);
    results.push(result);
  }
  await testInfo.attach('hidden-viewport-reset-lifecycle', { body: JSON.stringify(results), contentType: 'application/json' });
});
