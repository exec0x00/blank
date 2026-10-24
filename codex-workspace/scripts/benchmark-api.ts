/** Run with: node --import tsx scripts/benchmark-api.ts. See docs/API_PERFORMANCE.md. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { createApplication } from '../server/index';
import { loadConfig } from '../server/config';
import type { FileContent, Workspace } from '../shared/types';

interface Sample { totalMs: number; appMs?: number }
interface Reply<T> extends Sample { data: T }
interface Distribution { p50: number; p95: number }

function integer(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  return value;
}

function distribution(values: number[]): Distribution {
  const ordered = [...values].sort((a, b) => a - b);
  const percentile = (value: number) => Number(ordered[Math.ceil(ordered.length * value) - 1].toFixed(3));
  return { p50: percentile(0.5), p95: percentile(0.95) };
}

function summarize(samples: Sample[]) {
  const app = samples.flatMap(sample => sample.appMs === undefined ? [] : [sample.appMs]);
  return { count: samples.length, totalMs: distribution(samples.map(sample => sample.totalMs)),
    ...(app.length === samples.length ? { appMs: distribution(app) } : {}) };
}

const entries = integer('CODEX_BENCH_FILES', 64, 1, 2048);
const count = integer('CODEX_BENCH_SAMPLES', 24, 5, 200);
const sessionFile = process.env.CODEX_BENCH_SESSION_FILE;
const reportFile = path.resolve(process.env.CODEX_BENCH_REPORT || path.join(os.tmpdir(), 'codex-api-benchmark.json'));
const startedAt = new Date().toISOString();
let runtime: Awaited<ReturnType<typeof createApplication>> | undefined;
let directory: string | undefined;
let workspace: Workspace | undefined;
let base = '';
let cookie = '';
let cleanup = 'not-needed';
let cleanupStarted = false;
const fixtureNames = ['benchmark.txt', ...Array.from({ length: entries }, (_, index) => `fixture-${index}.ts`)];

async function request<T = unknown>(route: string, method = 'GET', body?: unknown): Promise<Reply<T>> {
  const start = performance.now();
  const response = await fetch(`${base}${route}`, {
    method, headers: { Cookie: cookie, 'X-Codex-Workspace': '1', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(45_000),
  });
  // An HTML startup error must not turn into a misleading JSON or latency result.
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Benchmark request ${method} ${route} returned HTTP ${response.status}. Wait for a healthy instance before rerunning.`);
  }
  const data = await response.json() as T;
  const timing = response.headers.get('server-timing')?.match(/(?:^|,\s*)app;dur=([\d.]+)/);
  return { data, totalMs: performance.now() - start, ...(timing ? { appMs: Number(timing[1]) } : {}) };
}

const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

/** Remove only our newly created, unchanged fixture through its own host PTY. */
async function removeHostedFixture(owned: Workspace): Promise<void> {
  cleanupStarted = true;
  if (!/^[a-f0-9-]{36}$/.test(owned.id) || path.basename(owned.path) !== owned.id) throw new Error('Unexpected benchmark workspace identity; files were retained.');
  const { data: terminal } = await request<{ id: string }>(`/api/workspaces/${owned.id}/terminals`, 'POST', {});
  const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/ws/terminal/${terminal.id}`, { headers: { Cookie: cookie, Origin: base } });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Benchmark fixture cleanup timed out; its registration was retained.')), 30_000);
      const marker = randomUUID();
      const result = `\x1e${marker}:removed\x1f`;
      let output = '';
      let sent = false;
      socket.on('error', reject);
      socket.on('close', () => { clearTimeout(timeout); if (!output.includes(result)) reject(new Error('Benchmark cleanup disconnected; its registration was retained.')); });
      socket.on('message', bytes => {
        const message = JSON.parse(bytes.toString()) as { type: string; data?: string; message?: string };
        if (message.type === 'ready' && !sent) {
          sent = true;
          const program = `import fs from 'node:fs/promises'; import path from 'node:path';
const root = ${JSON.stringify(owned.path)};
const allowed = new Set(${JSON.stringify(['.git', ...fixtureNames])});
if (await fs.realpath(process.cwd()) !== root || await fs.realpath(root) !== root) throw new Error('Fixture path changed.');
if ((await fs.readdir(root)).some(name => !allowed.has(name))) throw new Error('Fixture has unexpected files; keep it.');
process.chdir(path.dirname(root));
await fs.rm(root, { recursive: true });
process.stdout.write(${JSON.stringify(result)});`;
          // The marker contains control characters that echoed shell input cannot satisfy.
          socket.send(JSON.stringify({ type: 'input', data: `node --input-type=module --eval ${shellQuote(program)}\r` }));
        } else if (message.type === 'output') {
          output = (output + (message.data ?? '')).slice(-128 * 1024);
          if (output.includes(result)) { clearTimeout(timeout); resolve(); }
        } else if (message.type === 'error') { clearTimeout(timeout); reject(new Error('The host could not clean the isolated benchmark fixture.')); }
      });
    });
  } finally {
    socket.terminate();
    await request(`/api/terminals/${terminal.id}`, 'DELETE').catch(() => undefined);
  }
  await request(`/api/workspaces/${owned.id}`, 'DELETE');
}

try {
  if (sessionFile) {
    const stat = await fs.lstat(sessionFile);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error('Use a regular mode-0600 session file containing only base and cookie.');
    const session = JSON.parse(await fs.readFile(sessionFile, 'utf8')) as { base?: unknown; cookie?: unknown };
    if (typeof session.base !== 'string' || typeof session.cookie !== 'string' || session.cookie.length > 4096 || /[\r\n]/.test(session.cookie)) throw new Error('The session file must contain base and cookie strings.');
    const origin = new URL(session.base);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error('The hosted benchmark requires an HTTPS origin without URL credentials.');
    base = origin.origin;
    cookie = session.cookie;
  } else {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-api-benchmark-'));
    const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: directory, WORKSPACE_PASSWORD: randomBytes(24).toString('hex'),
      SESSION_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex') });
    runtime = await createApplication(config);
    await new Promise<void>(resolve => runtime!.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
    const response = await fetch(`${base}/api/session`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Codex-Workspace': '1' }, body: JSON.stringify({ password: config.password }) });
    if (!response.ok) throw new Error('The isolated local benchmark could not sign in.');
    cookie = response.headers.get('set-cookie')!.split(';')[0];
    await response.body?.cancel();
  }

  const first: Record<string, Sample> = {};
  const cold = async (name: string, route: string) => {
    const { data, ...sample } = await request(route);
    first[name] = sample;
    return data;
  };
  for (const [name, route] of [['health', '/health'], ['session', '/api/session'], ['bootstrap', '/api/bootstrap'], ['workspaces', '/api/workspaces']] as const) await cold(name, route);
  workspace = (await request<Workspace>('/api/workspaces', 'POST', { name: `API latency check ${startedAt}`, initializeGit: true })).data;
  const prefix = `/api/workspaces/${workspace.id}`;
  const text = 'benchmark fixture\n'.repeat(256);
  if (runtime) {
    await fs.writeFile(path.join(workspace.path, 'benchmark.txt'), text);
    for (let offset = 0; offset < entries; offset += 32) await Promise.all(Array.from({ length: Math.min(32, entries - offset) }, (_, index) =>
      fs.writeFile(path.join(workspace!.path, `fixture-${offset + index}.ts`), `export const value = ${offset + index};\n`)));
  } else {
    await request(`${prefix}/file`, 'PUT', { path: 'benchmark.txt', content: text });
    // The service serializes writes within a workspace. Small bounded batches
    // keep the client busy without creating an unbounded mutation backlog.
    for (let offset = 0; offset < entries; offset += 4) await Promise.all(Array.from({ length: Math.min(4, entries - offset) }, (_, index) =>
      request(`${prefix}/file`, 'PUT', { path: `fixture-${offset + index}.ts`, content: `export const value = ${offset + index};\n` })));
  }
  await cold('tree', `${prefix}/tree`);
  let version = (await cold('file', `${prefix}/file?path=benchmark.txt`) as FileContent).version;
  await cold('gitStatus', `${prefix}/git/status`);
  const save = async () => {
    const result = await request<FileContent>(`${prefix}/file`, 'PUT', { path: 'benchmark.txt', content: `benchmark fixture ${performance.now()}\n`.repeat(256), expectedVersion: version });
    version = result.data.version;
    return result;
  };
  const { data: _saved, ...firstSave } = await save();
  first.save = firstSave;
  // Warm means settled filesystem metadata, not just a second request in the
  // same timestamp tick. No operation delay is hidden inside measured samples.
  await new Promise(resolve => setTimeout(resolve, 2_100));
  const operations: [string, () => Promise<Reply<unknown>>][] = [
    ['health', () => request('/health')], ['session', () => request('/api/session')],
    ['bootstrap', () => request('/api/bootstrap')], ['workspaces', () => request('/api/workspaces')],
    ['tree', () => request(`${prefix}/tree`)], ['file', () => request(`${prefix}/file?path=benchmark.txt`)],
    ['gitStatus', () => request(`${prefix}/git/status`)], ['save', save],
  ];
  const warm: Record<string, ReturnType<typeof summarize>> = {};
  for (const [name, operation] of operations) {
    const samples = [];
    for (let index = 0; index < count; index++) samples.push(await operation());
    warm[name] = summarize(samples);
    process.stdout.write(`${name}: ${JSON.stringify(warm[name])}\n`);
  }
  if (sessionFile) { await removeHostedFixture(workspace); cleanup = 'fixture-files-and-registration-removed'; workspace = undefined; }
  const report = { capturedAt: new Date().toISOString(), startedAt, mode: sessionFile ? 'hosted' : 'local',
    fixture: { files: entries + 1, initialFileBytes: Buffer.byteLength(text), samples: count }, first, warm, cleanup: runtime ? 'isolated-directory-removed-on-exit' : cleanup };
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  process.stdout.write(`Report: ${reportFile}\n`);
} finally {
  if (sessionFile && workspace && !cleanupStarted) {
    try { await removeHostedFixture(workspace); }
    catch { process.stderr.write(`Could not remove benchmark fixture ${workspace.id}. Its registration was retained for inspection.\n`); }
  }
  await runtime?.close();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
}
