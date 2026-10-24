import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { expect, it } from 'vitest';
import { createApplication } from '../server/index';
import { loadConfig } from '../server/config';

/** Real authenticated application, transport and PTY; clocks never use polling intervals. */
it.skipIf(process.platform === 'win32')('keeps direct-open, control round trips and actual shell execution interactive', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'codex-terminal-timing-'));
  const password = 'terminal-timing-local-test-password';
  const runtime = await createApplication(loadConfig({ NODE_ENV: 'test', DATA_DIR: dataDir, WORKSPACE_PASSWORD: password,
    SESSION_SECRET: 'terminal-timing-session-key-32-characters', ENCRYPTION_KEY: 'terminal-timing-credential-key-32-characters' }));
  let socket: WebSocket | undefined;
  try {
    await new Promise<void>((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
    const response = await fetch(`${origin}/api/session`, { method: 'POST', headers: { Origin: origin, 'X-Codex-Workspace': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie')!.split(';')[0];
    const workspace = await runtime.ctx.workspaces.create({ name: 'Terminal timing' });
    const opening = performance.now();
    socket = new WebSocket(`${origin.replace('http:', 'ws:')}/ws/terminal?workspaceId=${workspace.id}&requestId=${randomUUID()}&cols=100&rows=28`, { headers: { Cookie: cookie, Origin: origin } });
    const pending = new Map<string, { resolve(value: number): void; start: number; timer: ReturnType<typeof setTimeout> }>();
    let output = '';
    const receive = (value: string) => {
      const entry = pending.get(value);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(value);
      entry.resolve(performance.now() - entry.start);
    };
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as { type: string; id?: string; data?: string };
      if (message.type === 'ready') receive('ready');
      else if (message.type === 'pong' && message.id) receive(message.id);
      else if (message.type === 'output') {
        output = (output + message.data).slice(-256 * 1024);
        for (const marker of pending.keys()) if (marker.startsWith('\x1e') && output.includes(marker)) receive(marker);
      }
    });
    const waitFor = (key: string, start = performance.now()) => new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(key); reject(new Error('The actual PTY did not respond within the test deadline.')); }, 5000);
      pending.set(key, { resolve, start, timer });
    });
    const openMs = await waitFor('ready', opening);
    const run = async (source: string) => {
      const marker = `\x1e${randomUUID()}\x1f`;
      const done = waitFor(marker);
      socket!.send(JSON.stringify({ type: 'input', data: `${source}; printf '\\036${marker.slice(1, -1)}\\037'\r` }));
      return done;
    };
    await run('stty -echo; PS1=; PROMPT_COMMAND=');
    const control: number[] = [];
    const commands: number[] = [];
    for (let index = 0; index < 30; index++) {
      const id = randomUUID();
      const pong = waitFor(id);
      socket.send(JSON.stringify({ type: 'ping', id }));
      control.push(await pong);
      // Only the shell can produce the control-character marker. Echoed command
      // source cannot satisfy this measurement or masquerade as execution.
      commands.push(await run(':'));
    }
    const summary = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return { p50: sorted[Math.floor((sorted.length - 1) * .5)], p95: sorted[Math.floor((sorted.length - 1) * .95)], max: sorted.at(-1)! };
    };
    const controlMs = summary(control);
    const shellMs = summary(commands);
    // Generous shared-CI budgets catch polling/debounce regressions. Report real
    // observations separately; these limits are not hosted latency promises.
    expect(openMs).toBeLessThan(1500);
    expect(controlMs.p50).toBeLessThan(25);
    expect(shellMs.p50).toBeLessThan(25);
    expect(shellMs.p95).toBeLessThan(250);
    console.info('Terminal timing (local ms)', JSON.stringify({ openMs, controlMs, shellMs, samples: commands.length }));
  } finally {
    socket?.terminate();
    await runtime.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
