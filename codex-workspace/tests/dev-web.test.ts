import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import { chromium, expect as browserExpect, type Browser } from '@playwright/test';
import { WebSocket } from 'ws';
import { AuthService } from '../server/auth';
import { loadConfig } from '../server/config';
import type { AppContext } from '../server/context';
import { attachDevWeb, DEV_WEB_HMR_PATH } from '../server/dev-web';
import { HttpError } from '../server/errors';
import { defaultSettings } from '../server/settings';
import { JsonStore, SecretStore } from '../server/store';
import { attachTerminalServer } from '../server/terminal';
import { WorkspaceService } from '../server/workspaces';
import { browserLaunchOptions } from './browser-launch';

interface Reply { status: number; headers: IncomingHttpHeaders; text: string }
interface Connection { socket: WebSocket; messages: Record<string, unknown>[]; status?: number; closed?: number; error?: Error }
const secretFixture = 'private-dev-web-fixture-must-never-be-served';
let directory: string;
let root: string;
let origin: string;
let cookie: string;
let token: string;
let server: Server;
let ctx: AppContext;
let auth: AuthService;
let browser: Browser | undefined;
let stopDev: (() => Promise<void>) | undefined;
let terminals: ReturnType<typeof attachTerminalServer> | undefined;
const connections = new Set<Connection>();

function request(route: string, options: { method?: string; cookie?: string; origin?: string; body?: unknown; accept?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = httpRequest(origin, {
      path: route, method: options.method ?? 'GET', agent: false,
      headers: {
        Origin: options.origin ?? origin, 'X-Codex-Workspace': '1',
        ...(options.cookie ? { Cookie: options.cookie } : {}),
        ...(options.accept ? { Accept: options.accept } : {}),
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.once('error', reject);
      res.once('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.once('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Development fixture request timed out.')));
    req.end(body);
  });
}

function connect(route: string, options: { cookie?: string; origin?: string; hmr?: boolean; ping?: boolean } = {}): Connection {
  const socket = new WebSocket(`${origin.replace('http:', 'ws:')}${route}`, options.hmr === false ? [] : [options.ping ? 'vite-ping' : 'vite-hmr'], {
    headers: { Origin: options.origin ?? origin, ...(options.cookie ? { Cookie: options.cookie } : {}) }, handshakeTimeout: 5000,
  });
  const connection: Connection = { socket, messages: [] };
  connections.add(connection);
  socket.on('message', raw => { connection.messages.push(JSON.parse(raw.toString()) as Record<string, unknown>); });
  socket.on('close', code => { connection.closed = code; });
  socket.on('error', error => { connection.error = error; });
  socket.on('unexpected-response', (outgoing, response) => {
    connection.status = response.statusCode;
    response.resume();
    outgoing.destroy();
  });
  return connection;
}

beforeAll(async () => {
  // Start the browser before Vite so the first document loads against the real
  // cold optimizer, rather than accidentally warming every dependency first.
  browser = await chromium.launch({ headless: true, ...browserLaunchOptions() });
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-dev-web-'));
  root = path.join(directory, 'frontend');
  const dataDir = path.join(directory, 'durable');
  const runtimeDir = path.join(directory, 'runtime');
  await Promise.all(['client', 'shared', 'public', 'server'].map(name => fs.mkdir(path.join(root, name), { recursive: true })));
  await Promise.all([fs.mkdir(dataDir), fs.mkdir(runtimeDir, { mode: 0o700 }), fs.symlink(path.resolve('node_modules'), path.join(root, 'node_modules'), 'dir')]);
  await Promise.all([
    fs.writeFile(path.join(root, 'index.html'), '<!doctype html><html><head></head><body><div id="root"></div><script type="module" src="/client/main.tsx"></script></body></html>'),
    fs.writeFile(path.join(root, 'client/main.tsx'), 'import { createRoot } from "react-dom/client"; import { App } from "./App"; createRoot(document.getElementById("root")!).render(<App />); if (import.meta.hot) import.meta.hot.accept();'),
    fs.writeFile(path.join(root, 'client/App.tsx'), 'import { useState } from "react"; import { label } from "../shared/label"; export function App() { const [count, setCount] = useState(0); return <main><h1>{label}</h1><button onClick={() => setCount(count + 1)}>Count {count}</button></main>; }'),
    fs.writeFile(path.join(root, 'shared/label.ts'), 'export const label = "development fixture";'),
    fs.writeFile(path.join(root, 'public/favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><title>Fixture icon</title></svg>'),
    fs.writeFile(path.join(dataDir, 'private.txt'), secretFixture),
    fs.writeFile(path.join(root, 'server/private.ts'), `export const secret = ${JSON.stringify(secretFixture)};`),
    fs.writeFile(path.join(root, '.env'), `PRIVATE_VALUE=${secretFixture}`),
    fs.symlink(path.join(dataDir, 'private.txt'), path.join(root, 'client/stolen.txt')),
    fs.symlink(path.join(dataDir, 'private.txt'), path.join(root, 'public/stolen.txt')),
    fs.symlink(dataDir, path.join(root, 'client/private-link'), 'dir'),
  ]);
  const config = { ...loadConfig({ NODE_ENV: 'test', DATA_DIR: dataDir, RUNTIME_DIR: runtimeDir,
    WORKSPACE_PASSWORD: 'dev-web-test-password', SESSION_SECRET: 'dev-web-test-session-secret-at-least-32',
    ENCRYPTION_KEY: 'dev-web-test-encryption-secret-at-least-32' }), devWeb: true };
  const store = new JsonStore(config.stateDir);
  ctx = { config, store, secrets: new SecretStore(store, config.encryptionKey), events: new EventEmitter(),
    workspaces: new WorkspaceService(config, store), settings: async () => ({ ...defaultSettings }),
    saveSettings: async () => ({ ...defaultSettings }), providerKey: async () => undefined };
  await ctx.workspaces.initialize();
  auth = new AuthService(ctx);
  await auth.initialize();
  const app = express();
  app.use((_req, res, next) => { res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'"); next(); });
  app.use('/api', auth.protectMutations);
  app.use('/api/session', express.json({ limit: '4kb' }));
  app.use('/api', auth.router(), auth.requireSession);
  app.get('/api/private', (_req, res) => res.json({ private: true }));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Unknown API route.')));
  server = createServer(app);
  stopDev = await attachDevWeb(app, server, { rootDir: root, runtimeDir, dataDir, authenticateUpgrade: auth.authenticateUpgrade, events: ctx.events });
  terminals = attachTerminalServer(server, ctx, auth.authenticateUpgrade, { devHmrPath: DEV_WEB_HMR_PATH });
  const handleError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    res.status(error instanceof HttpError ? error.status : 500).json({ error: error instanceof HttpError ? error.message : 'Development request failed.' });
  };
  app.use(handleError);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const login = await request('/api/session', { method: 'POST', body: { password: config.password } });
  expect(login.status).toBe(200);
  cookie = login.headers['set-cookie']![0].split(';')[0];
  const client = await request('/@vite/client');
  expect(client.status).toBe(200);
  expect(client.text).toContain('const directSocketHost = socketHost;');
  const match = /const wsToken = ("[^"]+")/.exec(client.text);
  expect(match).not.toBeNull();
  token = JSON.parse(match![1]) as string;
}, 20_000);

afterAll(async () => {
  for (const connection of connections) connection.socket.terminate();
  await browser?.close();
  await stopDev?.();
  await terminals?.close();
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await auth?.close();
  await ctx?.store.flush();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

describe('native Node and Vite development on one listener', () => {
  it('renders JSX on the first browser load and applies same-origin HMR without losing component state', async () => {
    const context = await browser!.newContext();
    const separator = cookie.indexOf('=');
    await context.addCookies([{ name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url: origin }]);
    const page = await context.newPage(), errors: string[] = [], failedAssets: string[] = [], sockets: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) failedAssets.push(new URL(response.url()).pathname); });
    page.on('websocket', socket => sockets.push(socket.url()));
    try {
      await page.goto(origin);
      await browserExpect(page.getByRole('heading', { name: 'development fixture', exact: true })).toBeVisible();
      const button = page.getByRole('button', { name: 'Count 0', exact: true });
      await button.click();
      await browserExpect(page.getByRole('button', { name: 'Count 1', exact: true })).toBeVisible();
      await page.evaluate(() => { (window as unknown as { __devDocumentIdentity: string }).__devDocumentIdentity = 'initial document'; });
      const appPath = path.join(root, 'client/App.tsx');
      const original = await fs.readFile(appPath, 'utf8');
      await fs.writeFile(appPath, original.replace('<h1>{label}</h1>', '<h1>{label} updated in place</h1>'));
      await browserExpect(page.getByRole('heading', { name: 'development fixture updated in place', exact: true })).toBeVisible();
      await browserExpect(page.getByRole('button', { name: 'Count 1', exact: true })).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as { __devDocumentIdentity: string }).__devDocumentIdentity)).toBe('initial document');
      expect(sockets.length).toBeGreaterThan(0);
      for (const socket of sockets) {
        expect(new URL(socket).host).toBe(new URL(origin).host);
        expect(new URL(socket).pathname).toBe(DEV_WEB_HMR_PATH);
      }
      expect(failedAssets).toEqual([]);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });

  it('loads and unlocks the actual application with a fresh dependency cache', async () => {
    const { createApplication } = await import('../server/index');
    const config = loadConfig({ NODE_ENV: 'test', CODEX_VITE_DEV: '1',
      DATA_DIR: path.join(directory, 'actual-application-data'), RUNTIME_DIR: path.join(directory, 'actual-application-runtime'),
      WORKSPACE_PASSWORD: 'dev-web-actual-application-password', SESSION_SECRET: 'dev-web-actual-application-session-secret',
      ENCRYPTION_KEY: 'dev-web-actual-application-encryption-key' });
    expect(config.devWeb).toBe(true);
    const application = await createApplication(config), context = await browser!.newContext();
    const failures: string[] = [], errors: string[] = [];
    try {
      await new Promise<void>(resolve => application.server.listen(0, '127.0.0.1', resolve));
      const address = `http://127.0.0.1:${(application.server.address() as AddressInfo).port}`;
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => {
        const pathname = new URL(response.url()).pathname;
        if (response.status() >= 400 && /^\/(?:@|client\/|shared\/)/.test(pathname)) failures.push(pathname);
      });
      const status = await page.goto(`${address}/?workspace=linked-workspace&view=agent`);
      expect(status?.status()).toBe(200);
      expect(status?.headers()['content-type']).toBe('text/plain; charset=utf-8');
      expect(await status?.text()).toBe('status: ok');
      expect(await page.locator('script').count()).toBe(0);
      await page.goto(`${address}/work/?view=editor#workspace`);
      expect(page.url()).toBe(`${address}/work/?view=editor#workspace`);
      await browserExpect(page.getByLabel('Workspace password', { exact: true })).toBeVisible({ timeout: 12_000 });
      await page.getByLabel('Workspace password', { exact: true }).fill(config.password);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await browserExpect(page.getByRole('main', { name: 'Workspace', exact: true })).toBeVisible();
      expect(new URL(page.url()).pathname).toBe('/work');
      expect(new URL(page.url()).searchParams.get('view')).toBe('editor');
      expect(new URL(page.url()).hash).toBe('#workspace');
      const unlockedStatus = await context.request.get(`${address}/?workspace=linked-workspace`);
      expect(unlockedStatus.headers()['content-type']).toBe('text/plain; charset=utf-8');
      expect(await unlockedStatus.text()).toBe('status: ok');
      expect(failures).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await application.close();
    }
  }, 40_000);

  it('serves the workspace entry and focused-window links without requiring an HTML Accept header', async () => {
    for (const route of ['/work', '/work/', '/work?workspace=linked-workspace&thread=native-child&view=agent',
      '/work/?workspace=linked-workspace&thread=%24new&view=editor']) {
      const response = await request(route);
      expect(response.status, route).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.headers.location).toBeUndefined();
      expect(response.text).toContain('/client/main.tsx');
      expect(response.text).toContain('/@vite/client');
    }
  });

  it('serves public login assets with a fresh CSP nonce and keeps API authentication and origin checks', async () => {
    const first = await request('/', { accept: 'text/html' });
    const second = await request('/', { accept: 'text/html' });
    expect(first.status).toBe(200);
    expect(first.text).toContain('/@vite/client');
    expect(first.text).toContain('/@react-refresh');
    expect(first.text).not.toContain('__CODEX_DEV_SCRIPT_NONCE__');
    const nonce = /nonce="([^"]+)"/.exec(first.text)![1];
    expect(first.headers['content-security-policy']).toContain(`'nonce-${nonce}'`);
    expect(first.headers['content-security-policy']).toContain("object-src 'none'");
    expect(second.text).not.toContain(`nonce="${nonce}"`);
    expect((await request('/favicon.svg')).text).toContain('Fixture icon');
    expect((await request('/api/private')).status).toBe(401);
    expect((await request('/api/private', { cookie })).text).toBe('{"private":true}');
    expect((await request('/api/missing', { cookie, accept: 'text/html' })).status).toBe(404);
    expect((await request('/api/session', { method: 'POST', origin: 'https://untrusted.example', body: { password: ctx.config.password } })).status).toBe(403);
  });

  it('transforms browser modules and serves their real optimized dependencies on the same HTTP listener', async () => {
    const module = await request('/client/main.tsx');
    expect(module.status).toBe(200);
    expect(module.text).toContain('jsxDEV');
    expect(module.text).toContain('/@vite/client');
    const imports = [...module.text.matchAll(/from\s+"(\/[^"\n]+)"/g)].map(match => match[1]);
    expect(imports.some(url => url.includes('/cache/vite/'))).toBe(true);
    for (const url of imports) expect((await request(url)).status, url).toBe(200);
    expect((await request('/shared/label.ts')).text).toContain('development fixture');
  });

  it('denies private files, raw imports, Vite helpers, encoded traversal and escaping symlinks', async () => {
    const cacheDir = path.join(ctx.config.runtimeDir, 'cache/vite');
    await fs.symlink(path.join(ctx.config.dataDir, 'private.txt'), path.join(cacheDir, 'cache-escape.js'));
    const routes = [
      '/server/private.ts', '/.env', `/@fs${ctx.config.dataDir}/private.txt?raw`, `/@fs${root}/server/private.ts?raw`,
      `/@id/${ctx.config.dataDir}/private.txt?raw`, '/client/stolen.txt?raw', '/stolen.txt', '/client/private-link/private.txt?raw',
      '/client/%2e%2e/server/private.ts?raw', '/client/%252e%252e/server/private.ts?raw', '/@fs/%00private',
      `/__open-in-editor?file=${encodeURIComponent(path.join(ctx.config.dataDir, 'private.txt'))}`, '/@vite/env/../../server/private.ts',
      `/@fs${cacheDir}/cache-escape.js?raw`, `/@fs${ctx.config.runtimeDir}/private.txt?raw`,
      `/@fs${cacheDir}/deps/.env?raw`, `/@fs${cacheDir}/deps/../../../../durable/private.txt?raw`,
    ];
    for (const route of routes) {
      const response = await request(route);
      expect([403, 404], route).toContain(response.status);
      expect(response.text, route).not.toContain(secretFixture);
    }
    // A browser cannot register an arbitrary future cache file by requesting
    // it, and an unknown dependency must fail promptly instead of waiting on
    // another optimizer job or becoming an unrestricted /@fs request.
    const absent = await request(`/@fs${cacheDir}/deps/not-a-registered-dependency.js?v=untrusted`);
    expect(absent.status).toBe(404);
    expect(absent.text).not.toContain(secretFixture);
    await fs.writeFile(path.join(root, 'client/import-private.ts'), `import privateText from ${JSON.stringify(`${ctx.config.dataDir}/private.txt?raw`)}; export default privateText;`);
    const indirect = await request('/client/import-private.ts');
    expect(indirect.status).toBeGreaterThanOrEqual(400);
    expect(indirect.text).not.toContain(secretFixture);
    expect((await request('/client/main.tsx', { method: 'POST' })).status).toBe(405);
  });

  it('requires real session and Origin proofs for HMR and leaves native terminal upgrades working', async () => {
    const route = `${DEV_WEB_HMR_PATH}?token=${token}`;
    const anonymous = connect(route);
    await expect.poll(() => anonymous.status).toBe(401);
    const foreign = connect(route, { cookie, origin: 'https://untrusted.example' });
    await expect.poll(() => foreign.status).toBe(401);
    const anonymousPing = connect(route, { ping: true });
    await expect.poll(() => anonymousPing.status).toBe(401);
    const ping = connect(route, { cookie, ping: true });
    await expect.poll(() => ping.closed).toBe(1000);
    const otherProtocol = connect(route, { cookie, hmr: false });
    await expect.poll(() => otherProtocol.status).toBe(404);
    const hmr = connect(route, { cookie });
    await expect.poll(() => hmr.messages[0]).toEqual({ type: 'connected' });
    const anonymousTerminal = connect('/ws/terminal', { hmr: false });
    await expect.poll(() => anonymousTerminal.status).toBe(401);
    const workspace = (await ctx.workspaces.list())[0];
    const terminal = connect(`/ws/terminal?workspaceId=${workspace.id}&requestId=${randomUUID()}`, { cookie, hmr: false });
    await expect.poll(() => terminal.messages.some(message => message.type === 'ready'), { timeout: 8000 }).toBe(true);
    terminal.socket.send(JSON.stringify({ type: 'input', data: "printf '\\036native-dev-terminal\\037\\n'\r" }));
    await expect.poll(() => terminal.messages.filter(message => message.type === 'output').map(message => message.data).join(''), { timeout: 8000 }).toContain('\x1enative-dev-terminal\x1f');
    const unknown = connect('/ws/unrecognized', { cookie, hmr: false });
    await expect.poll(() => unknown.status).toBe(404);
    hmr.socket.terminate();
    terminal.socket.terminate();
  });

  it('sends real source updates and rejects the Vite module-runner RPC', async () => {
    const hmr = connect(`${DEV_WEB_HMR_PATH}?token=${token}`, { cookie });
    await expect.poll(() => hmr.messages[0]).toEqual({ type: 'connected' });
    await request('/client/main.tsx');
    await fs.appendFile(path.join(root, 'client/main.tsx'), '\nexport const updated = true;\n');
    await expect.poll(() => hmr.messages.some(message => message.type === 'update'), { timeout: 8000 }).toBe(true);
    hmr.socket.send(JSON.stringify({ type: 'custom', event: 'vite:invoke', data: { name: 'fetchModule', id: 'send:1', data: [path.join(ctx.config.dataDir, 'private.txt')] } }));
    await expect.poll(() => hmr.closed).toBe(1008);
    expect(JSON.stringify(hmr.messages)).not.toContain(secretFixture);
  });

  it('closes development sockets when the shared session locks', async () => {
    const hmr = connect(`${DEV_WEB_HMR_PATH}?token=${token}`, { cookie });
    await expect.poll(() => hmr.messages[0]).toEqual({ type: 'connected' });
    expect((await request('/api/session', { method: 'DELETE', cookie })).status).toBe(200);
    await expect.poll(() => hmr.closed).toBeDefined();
    const denied = connect(`${DEV_WEB_HMR_PATH}?token=${token}`, { cookie });
    await expect.poll(() => denied.status).toBe(401);
  });
});
