#!/usr/bin/env node
// Measure actual host PTY round trips. Credentials remain in a caller-owned file.
import { readFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';

const args = process.argv.slice(2);
const option = (name, fallback) => { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; };
const sessionFile = option('--session-file');
if (!sessionFile) throw new Error('Pass --session-file with a mode-0600 JSON file containing base and cookie.');
if ((await stat(sessionFile)).mode & 0o077) throw new Error('The session file must have mode 0600.');
const session = JSON.parse(await readFile(sessionFile, 'utf8'));
const base = new URL(option('--url', session.base));
if (base.username || base.password || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname)))) throw new Error('Use HTTPS or a loopback development server.');
if (typeof session.cookie !== 'string' || !session.cookie || /[\r\n]/.test(session.cookie)) throw new Error('The session file needs a valid cookie.');
const samples = Number(option('--samples', '30'));
const count = Number(option('--sessions', '3'));
if (!Number.isInteger(samples) || samples < 5 || samples > 200 || !Number.isInteger(count) || count < 1 || count > 5) throw new Error('Use 5–200 samples and 1–5 sessions.');
const legacy = args.includes('--legacy');
const sessions = new Set();
let workspace;

const round = (value) => Math.round(value * 100) / 100;
function summary(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return { samples: sorted.length, p50: round(sorted[Math.ceil(sorted.length * .5) - 1]), p95: round(sorted[Math.ceil(sorted.length * .95) - 1]), max: round(sorted.at(-1)) };
}
async function api(route, method = 'GET', body) {
  const response = await fetch(new URL(`/api${route}`, base), { method,
    headers: { Origin: base.origin, 'X-Codex-Workspace': '1', Cookie: session.cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Benchmark request ${method} returned HTTP ${response.status}.`);
  return response.json();
}
async function open(route) {
  const started = performance.now();
  const url = new URL(route, base);
  url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url, { headers: { Cookie: session.cookie, Origin: base.origin }, perMessageDeflate: false, handshakeTimeout: 30_000 });
  let output = '';
  let outputCharacters = 0;
  let ready;
  let failure;
  const pending = new Set();
  const messages = [];
  const changed = () => { for (const check of [...pending]) check(); };
  const wait = (condition) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(check); reject(new Error('The real terminal did not respond within 30 seconds.')); }, 30_000);
    const check = () => {
      if (failure || condition()) { pending.delete(check); clearTimeout(timer); if (failure) reject(failure); else resolve(); }
    };
    pending.add(check);
    check();
  });
  socket.on('message', (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.type !== 'output') {
      messages.push(message);
      if (messages.length > 1000) messages.shift();
    }
    if (message.type === 'output' && typeof message.data === 'string') {
      outputCharacters += message.data.length;
      output = (output + message.data).slice(-512 * 1024);
    }
    if (message.type === 'ready') ready = message;
    changed();
  });
  socket.on('error', () => { failure = new Error('The authenticated terminal connection failed.'); changed(); });
  socket.on('close', () => { failure = new Error('The terminal connection closed during measurement.'); changed(); });
  try { await wait(() => Boolean(ready)); }
  catch (error) { socket.terminate(); throw error; }
  const readyMs = performance.now() - started;
  const send = (data) => socket.send(JSON.stringify({ type: 'input', data }));
  const command = async (source) => {
    const marker = `\x1e${randomUUID()}\x1f`;
    const start = performance.now();
    send(`${source}; printf '\\036${marker.slice(1, -1)}\\037'\r`);
    await wait(() => output.includes(marker));
    return performance.now() - start;
  };
  const ping = async () => {
    const id = randomUUID();
    const start = performance.now();
    const completion = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.off('pong', pong); reject(new Error('WebSocket ping timed out.')); }, 30_000);
      const pong = (value) => { if (value.toString() === id) { clearTimeout(timer); socket.off('pong', pong); resolve(); } };
      socket.on('pong', pong);
    });
    socket.ping(id);
    await completion;
    return performance.now() - start;
  };
  const control = async () => {
    const id = randomUUID();
    const start = performance.now();
    socket.send(JSON.stringify({ type: 'ping', id }));
    await wait(() => messages.some((message) => (message.type === 'pong' && message.id === id) || message.type === 'error'));
    return messages.some((message) => message.type === 'pong' && message.id === id) ? performance.now() - start : null;
  };
  const keypress = async () => {
    const offset = outputCharacters;
    const start = performance.now();
    // q cannot match UUID command framing, a cursor escape or the empty prompt.
    send('q');
    await wait(() => outputCharacters > offset && output.slice(Math.max(0, output.length - (outputCharacters - offset))).includes('q'));
    const duration = performance.now() - start;
    send('\x15');
    return duration;
  };
  return { socket, ready, readyMs, command, ping, control, keypress };
}

const results = [];
try {
  workspace = await api('/workspaces', 'POST', { name: `Terminal benchmark ${randomUUID().slice(0, 8)}`, initializeGit: false });
  for (let index = 0; index < count; index++) {
    let createMs = 0;
    let route;
    if (legacy) {
      const start = performance.now();
      const terminal = await api(`/workspaces/${workspace.id}/terminals`, 'POST', {});
      createMs = performance.now() - start;
      sessions.add(terminal.id);
      route = `/ws/terminal/${terminal.id}`;
    } else {
      const requestId = randomUUID();
      sessions.add(requestId);
      route = `/ws/terminal?workspaceId=${workspace.id}&requestId=${requestId}&new=1&cols=100&rows=28`;
    }
    let connection;
    try {
      connection = await open(route);
      sessions.add(connection.ready.session.id);
      await connection.command('PS1=; PROMPT_COMMAND=; stty echo');
      const wire = [];
      const control = [];
      const echo = [];
      const commands = [];
      let controlSupported = true;
      for (let sample = 0; sample < samples; sample++) {
        wire.push(await connection.ping());
        if (controlSupported) {
          const duration = await connection.control();
          if (duration === null) controlSupported = false;
          else control.push(duration);
        }
        echo.push(await connection.keypress());
      }
      await connection.command('stty -echo');
      for (let sample = 0; sample < samples; sample++) commands.push(await connection.command(':'));
      connection.socket.close();
      const resumed = await open(`/ws/terminal/${connection.ready.session.id}`);
      const reconnectMs = resumed.readyMs;
      resumed.socket.close();
      results.push({ firstInBenchmark: index === 0, restCreateMs: round(createMs), websocketReadyMs: round(connection.readyMs), totalOpenMs: round(createMs + connection.readyMs),
        wireRoundTripMs: summary(wire), applicationRoundTripMs: summary(control), keypressEchoMs: summary(echo), commandCompletionMs: summary(commands), reconnectMs: round(reconnectMs) });
    } finally { connection?.socket.close(); }
    if (connection) { await api(`/terminals/${connection.ready.session.id}`, 'DELETE', {}); sessions.delete(connection.ready.session.id); }
  }
  console.log(JSON.stringify({ measuredAt: new Date().toISOString(), origin: base.origin, protocol: legacy ? 'REST + WebSocket' : 'direct WebSocket',
    note: 'Measurements are from the machine running this command. Network distance and host load change user-visible latency. First connection is not necessarily a cold Space start.', results }, null, 2));
} finally {
  for (const id of sessions) await api(`/terminals/${id}`, 'DELETE', {}).catch(() => {});
  if (workspace) await api(`/workspaces/${workspace.id}`, 'DELETE', {}).catch(() => {});
}
