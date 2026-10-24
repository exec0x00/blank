import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import { WebSocket } from 'ws';
import { AuthService } from '../server/auth';
import { loadConfig, type AppConfig } from '../server/config';
import type { AppContext } from '../server/context';
import { HttpError } from '../server/errors';
import { defaultSettings } from '../server/settings';
import { JsonStore, SecretStore } from '../server/store';
import { attachTerminalServer, createTerminalRouter } from '../server/terminal';
import { WorkspaceService } from '../server/workspaces';

const password = 'auth-test-only-password';
const sessionSecret = 'auth-test-session-key-never-a-real-secret-123456789';
const encryptionKey = 'auth-test-credential-key-never-a-real-secret-123456789';
const cookieName = 'codex_workspace_session';

interface Reply { status: number; headers: IncomingHttpHeaders; text: string; body: Record<string, unknown> }
interface RequestOptions {
  method?: string;
  cookie?: string;
  origin?: string | false;
  marker?: boolean;
  body?: unknown;
  raw?: string;
}
interface Fixture {
  ctx: AppContext;
  server: Server;
  origin: string;
  request: (route: string, options?: RequestOptions) => Promise<Reply>;
  close: () => Promise<void>;
}

let directory: string;
let fixture: Fixture;
const clients = new Set<WebSocket>();

async function createFixture(overrides: Partial<AppConfig> = {}): Promise<Fixture> {
  const config = {
    ...loadConfig({ NODE_ENV: 'test', DATA_DIR: directory, WORKSPACE_PASSWORD: password, SESSION_SECRET: sessionSecret, ENCRYPTION_KEY: encryptionKey }),
    ...overrides,
  };
  const store = new JsonStore(config.stateDir);
  const secrets = new SecretStore(store, config.encryptionKey);
  const ctx: AppContext = {
    config, store, secrets, events: new EventEmitter(), workspaces: new WorkspaceService(config, store),
    settings: async () => ({ ...defaultSettings }),
    saveSettings: async () => ({ ...defaultSettings }),
    providerKey: () => secrets.get('openai-api-key'),
  };
  await ctx.workspaces.initialize();
  const auth = new AuthService(ctx);
  await auth.initialize();
  const app = express();
  app.set('trust proxy', 1);
  app.use('/api', auth.protectMutations);
  app.use('/api/session', express.json({ limit: '4kb' }));
  app.use('/api', auth.router());
  app.use('/api', auth.requireSession);
  app.use('/api', express.json({ limit: '8mb' }));
  app.get('/api/private', (_req, res) => res.json({ workspace: 'private fixture' }));
  app.patch('/api/private', (_req, res) => res.json({ saved: true }));
  app.use('/api', createTerminalRouter(ctx));
  const onError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof HttpError) return void res.status(error.status).json({ error: error.message, code: error.code });
    const parseError = error as { type?: string };
    if (parseError.type === 'entity.too.large') return void res.status(413).json({ error: 'Request too large.' });
    if (parseError.type === 'entity.parse.failed') return void res.status(400).json({ error: 'Invalid JSON.' });
    res.status(500).json({ error: 'Unexpected fixture error.' });
  };
  app.use(onError);
  const server = createServer(app);
  const terminals = attachTerminalServer(server, ctx, auth.authenticateUpgrade);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The HTTP fixture did not start.');
  const origin = `http://127.0.0.1:${address.port}`;
  let closed = false;
  return {
    ctx, server, origin,
    request: (route, options = {}) => new Promise<Reply>((resolve, reject) => {
      const raw = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
      const requestOrigin = options.origin === undefined ? origin : options.origin;
      const req = httpRequest(`${origin}${route}`, {
        method: options.method || 'GET', agent: false,
        headers: {
          ...(requestOrigin ? { Origin: requestOrigin } : {}),
          ...(options.marker === false ? {} : { 'X-Codex-Workspace': '1' }),
          ...(options.cookie ? { Cookie: options.cookie } : {}),
          ...(raw === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) }),
        },
      }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(Buffer.from(chunk)));
        res.once('error', reject);
        res.once('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try { resolve({ status: res.statusCode || 0, headers: res.headers, text, body: JSON.parse(text) }); }
          catch { reject(new Error(`Non-JSON fixture response (${res.statusCode}): ${text}`)); }
        });
      });
      req.setTimeout(5000, () => req.destroy(new Error('HTTP fixture request timed out.')));
      req.once('error', reject);
      req.end(raw);
    }),
    close: async () => {
      if (closed) return;
      closed = true;
      await terminals.close();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await auth.close();
      await store.flush();
    },
  };
}

async function stateFiles(directory = fixture.ctx.config.stateDir): Promise<{ filename: string; contents: string }[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(entries.map(async entry => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return stateFiles(filename);
    return entry.isFile() ? [{ filename, contents: await fs.readFile(filename, 'utf8') }] : [];
  }));
  return groups.flat();
}

async function login(selectedPassword = fixture.ctx.config.password, origin?: string): Promise<string> {
  const response = await fixture.request('/api/session', { method: 'POST', body: { password: selectedPassword }, origin });
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ authenticated: true });
  const cookie = response.headers['set-cookie']?.[0]?.split(';')[0];
  expect(cookie).toMatch(/^codex_workspace_session=.+/);
  return cookie!;
}

async function restart(overrides: Partial<AppConfig> = {}): Promise<void> {
  const config = fixture.ctx.config;
  await fixture.close();
  fixture = await createFixture({ ...config, ...overrides });
}

function openTerminal(route: string, headers: Record<string, string>): Promise<{ status: number; client: WebSocket; message?: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const client = new WebSocket(`${fixture.origin.replace('http:', 'ws:')}${route}`, { headers, handshakeTimeout: 3000 });
    clients.add(client);
    client.on('error', reject);
    client.once('close', () => clients.delete(client));
    client.once('unexpected-response', (_req, res) => {
      res.resume();
      resolve({ status: res.statusCode || 0, client });
      client.terminate();
    });
    client.once('message', data => {
      try { resolve({ status: 101, client, message: JSON.parse(data.toString()) }); }
      catch (error) { reject(error); }
    });
  });
}

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-auth-test-'));
  fixture = await createFixture();
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const client of clients) client.terminate();
  clients.clear();
  await fixture?.close();
  await fs.rm(directory, { recursive: true, force: true });
});

describe('password and server-side sessions over HTTP', () => {
  it('keeps private routes closed until a password login establishes a cookie', async () => {
    expect((await fixture.request('/api/session')).body).toEqual({ authenticated: false });
    expect((await fixture.request('/api/private')).status).toBe(401);
    expect((await fixture.request('/api/private', { method: 'PATCH', body: {} })).status).toBe(401);
    const cookie = await login();
    expect((await fixture.request('/api/session', { cookie })).body).toEqual({ authenticated: true });
    expect((await fixture.request('/api/private', { cookie })).body).toEqual({ workspace: 'private fixture' });
  });

  it('rejects incorrect credentials without returning or saving the supplied password', async () => {
    const supplied = 'incorrect-fixture-password';
    const response = await fixture.request('/api/session', { method: 'POST', body: { password: supplied } });
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('INVALID_PASSWORD');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.text).not.toContain(supplied);
    expect((await stateFiles()).filter(file => /^session-[a-f0-9]{64}\.json$/.test(path.basename(file.filename)))).toEqual([]);
  });

  it.each([{}, { password: null }, { password: 123 }, { password: ['nested'] }, { password: 'x'.repeat(1025) }])(
    'rejects a malformed login body %j', async body => {
      const response = await fixture.request('/api/session', { method: 'POST', body });
      expect(response.status).toBe(400);
      expect(response.headers['set-cookie']).toBeUndefined();
    },
  );

  it('bounds login request bytes and rejects broken JSON before password hashing', async () => {
    expect((await fixture.request('/api/session', { method: 'POST', body: { password: 'x'.repeat(6000) } })).status).toBe(413);
    expect((await fixture.request('/api/session', { method: 'POST', raw: '{"password":' })).status).toBe(400);
    expect((await fixture.request('/api/session')).body.authenticated).toBe(false);
  });

  it('sets the browser cookie attributes required by an embedded production Space', async () => {
    await restart({ production: true });
    const response = await fixture.request('/api/session', { method: 'POST', body: { password }, origin: fixture.origin.replace('http:', 'https:') });
    expect(response.status).toBe(200);
    const cookie = response.headers['set-cookie']?.[0] || '';
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=None', 'Partitioned', 'Path=/', 'Max-Age=604800']) expect(cookie).toContain(attribute);
    expect(cookie).not.toContain('Domain=');
    expect(response.text).not.toContain(cookie.split(';')[0].split('=')[1]);
  });

  it('keeps local HTTP development usable with a HttpOnly SameSite=Lax cookie', async () => {
    const response = await fixture.request('/api/session', { method: 'POST', body: { password } });
    expect(response.status).toBe(200);
    const cookie = response.headers['set-cookie']?.[0] || '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toMatch(/; Secure(?:;|$)|; Partitioned(?:;|$)/);
  });

  it('survives a service restart and durably revokes the cookie on logout', async () => {
    const cookie = await login();
    await restart();
    expect((await fixture.request('/api/private', { cookie })).status).toBe(200);
    const logout = await fixture.request('/api/session', { method: 'DELETE', cookie });
    expect(logout.status).toBe(200);
    expect(logout.body).toEqual({ authenticated: false });
    expect(logout.headers['set-cookie']?.[0]).toContain('Max-Age=0');
    expect((await fixture.request('/api/private', { cookie })).status).toBe(401);
    await restart();
    expect((await fixture.request('/api/private', { cookie })).status).toBe(401);
  });

  it.each([
    { password: 'replacement-test-only-password' },
    { sessionSecret: 'replacement-session-key-never-a-real-secret-123456789' },
  ])('invalidates sessions when an authentication secret changes: %j', async changed => {
    const cookie = await login();
    await restart(changed);
    expect((await fixture.request('/api/private', { cookie })).status).toBe(401);
    const fresh = await login();
    expect((await fixture.request('/api/private', { cookie: fresh })).status).toBe(200);
  });

  it('expires old cookies and removes their grants after the cleanup grace period', async () => {
    const cookie = await login();
    const expired = Date.now() + 10 * 24 * 60 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(expired);
    expect((await fixture.request('/api/private', { cookie })).status).toBe(401);
    await restart();
    expect((await stateFiles()).filter(file => /^session-[a-f0-9]{64}\.json$/.test(path.basename(file.filename)))).toEqual([]);
  });

  it('rate-limits repeated incorrect passwords and permits retry after the cooldown', async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      expect((await fixture.request('/api/session', { method: 'POST', body: { password: 'wrong-password' } })).status).toBe(401);
    }
    const blocked = await fixture.request('/api/session', { method: 'POST', body: { password } });
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('LOGIN_RATE_LIMITED');
    expect(blocked.headers['set-cookie']).toBeUndefined();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60 * 1000);
    expect(await login()).toBeTruthy();
  });

  it('resets the failure count after a successful login', async () => {
    for (let attempt = 0; attempt < 7; attempt++) {
      expect((await fixture.request('/api/session', { method: 'POST', body: { password: 'wrong-password' } })).status).toBe(401);
    }
    await login();
    expect((await fixture.request('/api/session', { method: 'POST', body: { password: 'wrong-again' } })).status).toBe(401);
    expect(await login()).toBeTruthy();
  });

  it('counts simultaneous incorrect passwords toward the same cooldown', async () => {
    for (let batch = 0; batch < 2; batch++) {
      const replies = await Promise.all(Array.from({ length: 4 }, () =>
        fixture.request('/api/session', { method: 'POST', body: { password: 'concurrent-wrong-password' } }),
      ));
      expect(replies.map(response => response.status)).toEqual([401, 401, 401, 401]);
    }
    const response = await fixture.request('/api/session', { method: 'POST', body: { password } });
    expect(response.status).toBe(429);
    expect(response.body.code).toBe('LOGIN_RATE_LIMITED');
  });

  it('does not broadcast a logout or revoke a valid session for an anonymous logout request', async () => {
    const cookie = await login();
    const revoked: unknown[] = [];
    fixture.ctx.events.on('auth:logout', event => revoked.push(event));
    const response = await fixture.request('/api/session', { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ authenticated: false });
    expect(revoked).toEqual([]);
    expect((await fixture.request('/api/private', { cookie })).status).toBe(200);
    expect((await fixture.request('/api/session', { method: 'DELETE', cookie })).status).toBe(200);
    expect(revoked).toHaveLength(1);
  });
});

describe('public session metadata cannot authorize a request', () => {
  it('persists readable hashes without reusable cookies, passwords, or server secret keys', async () => {
    const cookie = await login();
    const token = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
    const files = await stateFiles();
    const disk = files.map(file => file.contents).join('\n');
    const grants = files.filter(file => /^session-[a-f0-9]{64}\.json$/.test(path.basename(file.filename)));
    expect(grants).toHaveLength(1);
    const saved = JSON.parse(grants[0].contents) as { epoch: string; hash: string; expiresAt: number };
    for (const sensitive of [token, password, sessionSecret, encryptionKey]) expect(disk).not.toContain(sensitive);
    expect(files.some(file => path.basename(file.filename) === 'sessions.json')).toBe(false);
    const candidates = [saved.epoch, saved.hash, `${saved.hash}.${saved.expiresAt}.${saved.epoch}`];
    const guessedData = `${randomBytes(32).toString('base64url')}.${saved.expiresAt}`;
    candidates.push(`${guessedData}.${createHmac('sha256', saved.epoch).update(guessedData).digest('base64url')}`);
    for (const candidate of candidates) {
      expect((await fixture.request('/api/private', { cookie: `${cookieName}=${candidate}` })).status).toBe(401);
    }
  });

  it('requires a live server-side session even when a cookie has a valid test-key signature', async () => {
    const data = `${randomBytes(32).toString('base64url')}.${Date.now() + 60_000}`;
    const token = `${data}.${createHmac('sha256', sessionSecret).update(data).digest('base64url')}`;
    expect((await fixture.request('/api/private', { cookie: `${cookieName}=${token}` })).status).toBe(401);
  });

  it('rejects tampering with the random token, expiry, signature, and malformed cookies', async () => {
    const cookie = await login();
    const token = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
    const [nonce, expiry, signature] = token.split('.');
    const candidates = [
      `changed${nonce}.${expiry}.${signature}`, `${nonce}.${Number(expiry) + 1}.${signature}`,
      `${nonce}.${expiry}.invalid`, 'malformed', 'a.b', 'a.b.c.d', 'a'.repeat(600), '%ZZ',
      createHash('sha256').update(token).digest('hex'),
    ];
    for (const candidate of candidates) {
      expect((await fixture.request('/api/private', { cookie: `${cookieName}=${candidate}` })).status).toBe(401);
    }
    expect((await fixture.request('/api/private', { cookie })).status).toBe(200);
  });
});

describe('browser origin and mutation protection', () => {
  it('requires the application header for login, authenticated edits, and logout', async () => {
    expect((await fixture.request('/api/session', { method: 'POST', marker: false, body: { password } })).status).toBe(403);
    const cookie = await login();
    expect((await fixture.request('/api/private', { method: 'PATCH', marker: false, cookie, body: {} })).status).toBe(403);
    expect((await fixture.request('/api/session', { method: 'DELETE', marker: false, cookie })).status).toBe(403);
    expect((await fixture.request('/api/private', { cookie })).status).toBe(200);
  });

  it.each(['https://attacker.example', 'null', 'not-a-url', 'https://127.0.0.1:1', 'ftp://127.0.0.1'])('rejects a foreign or invalid Origin %j', async origin => {
    const cookie = await login();
    expect((await fixture.request('/api/session', { method: 'POST', origin, body: { password } })).status).toBe(403);
    expect((await fixture.request('/api/private', { method: 'PATCH', cookie, origin, body: {} })).status).toBe(403);
    expect((await fixture.request('/api/session', { method: 'DELETE', cookie, origin })).status).toBe(403);
    expect((await fixture.request('/api/private', { cookie })).status).toBe(200);
  });

  it('accepts a same-origin edit and explicit non-browser requests carrying the application header', async () => {
    const cookie = await login();
    expect((await fixture.request('/api/private', { method: 'PATCH', cookie, body: {} })).status).toBe(200);
    expect((await fixture.request('/api/private', { method: 'PATCH', cookie, origin: false, body: {} })).status).toBe(200);
    expect((await fixture.request('/api/private', { method: 'PATCH', cookie, origin: false, marker: false, body: {} })).status).toBe(403);
  });

  it('rejects an insecure same-host Origin when the production application requires HTTPS', async () => {
    await restart({ production: true });
    const secureOrigin = fixture.origin.replace('http:', 'https:');
    const cookie = await login(password, secureOrigin);
    expect((await fixture.request('/api/private', { method: 'PATCH', cookie, origin: fixture.origin, body: {} })).status).toBe(403);
    expect((await fixture.request('/api/private', { method: 'PATCH', cookie, origin: secureOrigin, body: {} })).status).toBe(200);
  });
});

describe('terminal WebSocket authentication', () => {
  it('rejects anonymous and foreign-origin upgrades before exposing an actual terminal', async () => {
    const cookie = await login();
    const workspace = (await fixture.ctx.workspaces.list())[0];
    const terminal = await fixture.request(`/api/workspaces/${workspace.id}/terminals`, { method: 'POST', cookie, body: {} });
    expect(terminal.status).toBe(201);
    const route = `/ws/terminal/${terminal.body.id}`;
    expect((await openTerminal(route, { Origin: fixture.origin })).status).toBe(401);
    expect((await openTerminal(route, { Origin: 'https://attacker.example', Cookie: cookie })).status).toBe(401);
    expect((await openTerminal(route, { Origin: 'null', Cookie: cookie })).status).toBe(401);
    const opened = await openTerminal(route, { Origin: fixture.origin, Cookie: cookie });
    expect(opened.status).toBe(101);
    expect(opened.message?.type).toBe('ready');
    expect(opened.message?.session).toMatchObject({ id: terminal.body.id, workspaceId: workspace.id });
    const closed = new Promise<number>(resolve => opened.client.once('close', code => resolve(code)));
    expect((await fixture.request('/api/session', { method: 'DELETE', cookie })).status).toBe(200);
    expect(await closed).toBe(1008);
    expect((await openTerminal(route, { Origin: fixture.origin, Cookie: cookie })).status).toBe(401);
  }, 15_000);
});
