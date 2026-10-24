import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile as execFileCallback } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import express, { type ErrorRequestHandler } from 'express';
import { AuthService } from '../server/auth';
import { loadConfig } from '../server/config';
import type { AppContext } from '../server/context';
import { HttpError } from '../server/errors';
import { defaultSettings } from '../server/settings';
import { JsonStore, SecretStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';

const password = 'concurrent-auth-test-password';
const signingKey = 'concurrent-auth-signing-secret-not-a-real-key-123456';
const credentialKey = 'concurrent-auth-credential-secret-not-a-real-key-123456';
const epoch = createHmac('sha256', signingKey).update(password).digest('hex');
const day = 24 * 60 * 60 * 1000;
const execFile = promisify(execFileCallback);
const projectRoot = fileURLToPath(new URL('../', import.meta.url));

interface LegacySession { cookie: string; token: string; hash: string; expiresAt: number }
interface Reply { status: number; headers: IncomingHttpHeaders; body: Record<string, unknown> }
interface Fixture {
  ctx: AppContext;
  auth: AuthService;
  server: Server;
  origin: string;
  request(route: string, options?: { method?: string; cookie?: string; body?: unknown }): Promise<Reply>;
  close(): Promise<void>;
}
let directory: string;
let fixtures: Fixture[];
let releases: (() => void)[];
let streams: Set<IncomingMessage>;

function context(store?: JsonStore): AppContext {
  const config = loadConfig({
    NODE_ENV: 'test', DATA_DIR: directory, WORKSPACE_PASSWORD: password,
    SESSION_SECRET: signingKey, ENCRYPTION_KEY: credentialKey,
  });
  store ??= new JsonStore(config.stateDir);
  return {
    config, store, secrets: new SecretStore(store, credentialKey),
    events: new EventEmitter(), workspaces: new WorkspaceService(config, store),
    settings: async () => ({ ...defaultSettings }), saveSettings: async patch => ({ ...defaultSettings, ...patch }),
    providerKey: async () => undefined,
  };
}

async function createFixture(ctx = context()): Promise<Fixture> {
  const auth = new AuthService(ctx);
  const app = express();
  app.use('/api', auth.protectMutations, express.json({ limit: '4kb' }), auth.router(), auth.requireSession);
  app.get('/api/private', (_req, res) => res.json({ authorized: true }));
  app.get('/api/stream', (_req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.write(': ready\n\n');
    const onLogout = () => res.end();
    ctx.events.on('auth:logout', onLogout);
    res.once('close', () => ctx.events.off('auth:logout', onLogout));
  });
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof HttpError) res.status(error.status).json({ error: error.message, code: error.code });
    else res.status(500).json({ error: 'The request could not be completed.' });
  };
  app.use(errors);
  const server = createServer(app);
  let closed = false;
  const fixture: Fixture = {
    ctx, auth, server, origin: '',
    request(route, options = {}) {
      return new Promise((resolve, reject) => {
        const body = options.body === undefined ? undefined : JSON.stringify(options.body);
        const req = httpRequest(`${fixture.origin}${route}`, {
          method: options.method || 'GET', agent: false,
          headers: {
            Origin: fixture.origin, 'X-Codex-Workspace': '1',
            ...(options.cookie ? { Cookie: options.cookie } : {}),
            ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }),
          },
        }, res => {
          const chunks: Buffer[] = [];
          res.on('data', chunk => chunks.push(Buffer.from(chunk)));
          res.once('error', reject);
          res.once('end', () => {
            try { resolve({ status: res.statusCode || 0, headers: res.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
            catch (error) { reject(error); }
          });
        });
        req.setTimeout(10_000, () => req.destroy(new Error('Auth fixture request timed out.')));
        req.once('error', reject);
        req.end(body);
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      server.closeAllConnections();
      if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await auth.close();
      await ctx.store.flush();
    },
  };
  fixtures.push(fixture);
  await auth.initialize();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Auth fixture did not start.');
  fixture.origin = `http://127.0.0.1:${address.port}`;
  return fixture;
}

function legacySession(expiresAt = Date.now() + day): LegacySession {
  const data = `${randomBytes(32).toString('base64url')}.${expiresAt}`;
  const token = `${data}.${createHmac('sha256', signingKey).update(data).digest('base64url')}`;
  return { cookie: `codex_workspace_session=${token}`, token, hash: createHash('sha256').update(token).digest('hex'), expiresAt };
}

async function saveLegacy(sessions: LegacySession[], store = context().store): Promise<string> {
  await store.write('sessions', { epoch, sessions: sessions.map(({ hash, expiresAt }) => ({ hash, expiresAt })) });
  return fs.readFile(path.join(store.directory, 'sessions.json'), 'utf8');
}

async function login(fixture: Fixture): Promise<LegacySession> {
  const response = await fixture.request('/api/session', { method: 'POST', body: { password } });
  expect(response.status).toBe(200);
  const cookie = response.headers['set-cookie']?.[0]?.split(';')[0];
  expect(cookie).toBeTruthy();
  const token = decodeURIComponent(cookie!.slice(cookie!.indexOf('=') + 1));
  return { cookie: cookie!, token, hash: createHash('sha256').update(token).digest('hex'), expiresAt: Number(token.split('.')[1]) };
}

function recordPath(session: Pick<LegacySession, 'hash' | 'expiresAt'>, kind: 'session' | 'revoked' = 'session'): string {
  return path.join(context().config.stateDir, 'auth-sessions-v2', `d-${Math.floor(session.expiresAt / day)}`, `${kind}-${session.hash}.json`);
}

function gate(): { arrived: Promise<void>; signal: () => void; blocked: Promise<void>; release: () => void } {
  let signal!: () => void;
  let release!: () => void;
  const arrived = new Promise<void>(resolve => { signal = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  releases.push(release);
  return { arrived, signal, blocked, release };
}

async function subscribe(fixture: Fixture, cookie: string): Promise<{ ended: Promise<void> }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${fixture.origin}/api/stream`, { agent: false, headers: { Cookie: cookie } }, res => {
      streams.add(res);
      const ended = new Promise<void>(finish => res.once('end', finish));
      res.once('end', () => streams.delete(res));
      res.once('error', reject);
      res.once('data', () => resolve({ ended }));
      res.on('data', () => undefined);
    });
    req.once('error', reject); req.end();
  });
}

beforeEach(async () => {
  fixtures = []; releases = []; streams = new Set();
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-session-concurrency-'));
});

afterEach(async () => {
  for (const release of releases) release();
  for (const stream of streams) stream.destroy();
  await Promise.all(fixtures.map(fixture => fixture.close()));
  vi.restoreAllMocks();
  await fs.rm(directory, { recursive: true, force: true });
});

describe('independent durable session identities', () => {
  it('keeps sequential and overlapping logins valid through two independent auth services and stores', async () => {
    const first = await createFixture();
    const second = await createFixture();
    expect(first.ctx.store).not.toBe(second.ctx.store);
    expect(first.auth).not.toBe(second.auth);
    const sessions = [await login(first), await login(second), ...await Promise.all([login(first), login(second)])];
    for (const session of sessions) {
      expect((await first.request('/api/private', { cookie: session.cookie })).status).toBe(200);
      expect((await second.request('/api/private', { cookie: session.cookie })).status).toBe(200);
      expect(JSON.parse(await fs.readFile(recordPath(session), 'utf8'))).toMatchObject({ version: 2, hash: session.hash, expiresAt: session.expiresAt });
    }
    await expect(fs.stat(path.join(first.ctx.store.directory, 'sessions.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not lose a new login when another initialization finishes from an older legacy snapshot', async () => {
    const original = legacySession();
    const legacy = await saveLegacy([original]);
    const secondContext = context();
    const paused = gate();
    const read = secondContext.store.read.bind(secondContext.store);
    vi.spyOn(secondContext.store, 'read').mockImplementation(async (key, fallback) => {
      const result = await read(key, fallback);
      if (key === 'sessions') { paused.signal(); await paused.blocked; }
      return result;
    });
    const secondStarting = createFixture(secondContext);
    await paused.arrived;
    const first = await createFixture();
    const newest = await login(first);
    paused.release();
    const second = await secondStarting;
    for (const session of [original, newest]) {
      expect((await first.request('/api/private', { cookie: session.cookie })).status).toBe(200);
      expect((await second.request('/api/private', { cookie: session.cookie })).status).toBe(200);
    }
    expect(await fs.readFile(path.join(first.ctx.store.directory, 'sessions.json'), 'utf8')).toBe(legacy);
  });

  it('preserves logout across another login, reinitialization, and a delayed aggregate rewrite', async () => {
    const original = legacySession();
    await saveLegacy([original]);
    const first = await createFixture();
    const second = await createFixture();
    expect((await second.request('/api/private', { cookie: original.cookie })).status).toBe(200);
    expect((await first.request('/api/session', { method: 'DELETE', cookie: original.cookie })).status).toBe(200);
    const newer = await login(second);
    const lateLegacyOnly = legacySession();
    await saveLegacy([original, lateLegacyOnly]);
    const fresh = await createFixture();
    for (const instance of [first, second, fresh]) {
      expect((await instance.request('/api/private', { cookie: original.cookie })).status).toBe(401);
      expect((await instance.request('/api/private', { cookie: newer.cookie })).status).toBe(200);
      expect((await instance.request('/api/private', { cookie: lateLegacyOnly.cookie })).status).toBe(401);
    }
    expect(JSON.parse(await fs.readFile(recordPath(original, 'revoked'), 'utf8'))).toMatchObject({ revoked: true, hash: original.hash, expiresAt: original.expiresAt });
  });

  it('cannot restore a revoked legacy cookie when a stale migration grant reaches disk after logout', async () => {
    const original = legacySession();
    await saveLegacy([original]);
    const paused = gate();
    const rename = fs.rename.bind(fs);
    let intercepted = false;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (!intercepted && String(to) === recordPath(original)) {
        intercepted = true; paused.signal(); await paused.blocked;
      }
      return rename(from, to);
    });
    const staleStarting = createFixture();
    await paused.arrived;
    const first = await createFixture();
    expect((await first.request('/api/private', { cookie: original.cookie })).status).toBe(200);
    expect((await first.request('/api/session', { method: 'DELETE', cookie: original.cookie })).status).toBe(200);
    paused.release();
    const stale = await staleStarting;
    expect((await stale.request('/api/private', { cookie: original.cookie })).status).toBe(401);
    expect((await first.request('/api/private', { cookie: original.cookie })).status).toBe(401);
    expect(JSON.parse(await fs.readFile(recordPath(original), 'utf8')).hash).toBe(original.hash);
    expect(JSON.parse(await fs.readFile(recordPath(original, 'revoked'), 'utf8')).revoked).toBe(true);
  });

  it('writes revocation even when a signed cookie grant is temporarily absent, so its later arrival cannot undo logout', async () => {
    const first = await createFixture();
    const session = await login(first);
    const hidden = path.join(directory, 'delayed-grant.json');
    await fs.rename(recordPath(session), hidden);
    expect((await first.request('/api/session', { method: 'DELETE', cookie: session.cookie })).status).toBe(200);
    await fs.rename(hidden, recordPath(session));
    const second = await createFixture();
    expect((await first.request('/api/private', { cookie: session.cookie })).status).toBe(401);
    expect((await second.request('/api/private', { cookie: session.cookie })).status).toBe(401);
  });

  it('denies a previously accepted cookie when its grant disappears or any revocation marker appears', async () => {
    const first = await createFixture();
    const second = await createFixture();
    const session = await login(first);
    expect((await second.request('/api/private', { cookie: session.cookie })).status).toBe(200);
    const member = await fs.readFile(recordPath(session));
    await fs.unlink(recordPath(session));
    expect((await second.request('/api/private', { cookie: session.cookie })).status).toBe(401);
    await fs.writeFile(recordPath(session), member);
    expect((await second.request('/api/private', { cookie: session.cookie })).status).toBe(200);
    for (const marker of ['null', 'false', '{}', '{"revoked":false}', '{broken-json']) {
      const marked = await login(first);
      expect((await second.request('/api/private', { cookie: marked.cookie })).status).toBe(200);
      await fs.writeFile(recordPath(marked, 'revoked'), marker);
      expect((await second.request('/api/private', { cookie: marked.cookie })).status).toBe(401);
      // Once observed, a revocation cannot be forgotten by this runtime even
      // if a native mount later regresses to an older view without the marker.
      await fs.unlink(recordPath(marked, 'revoked'));
      expect((await second.request('/api/private', { cookie: marked.cookie })).status).toBe(401);
    }
    const dangling = await login(first);
    expect((await second.request('/api/private', { cookie: dangling.cookie })).status).toBe(200);
    await fs.symlink(path.join(directory, 'no-such-marker-target'), recordPath(dangling, 'revoked'));
    expect((await second.request('/api/private', { cookie: dangling.cookie })).status).toBe(401);
  });

  it('locally denies an in-flight cookie and closes its SSE stream before slow revocation persistence finishes', async () => {
    const first = await createFixture();
    const session = await login(first);
    const stream = await subscribe(first, session.cookie);
    const paused = gate();
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to) === recordPath(session, 'revoked')) { paused.signal(); await paused.blocked; }
      return rename(from, to);
    });
    const loggingOut = first.request('/api/session', { method: 'DELETE', cookie: session.cookie });
    await paused.arrived;
    expect((await first.request('/api/private', { cookie: session.cookie })).status).toBe(401);
    await stream.ended;
    paused.release();
    expect((await loggingOut).status).toBe(200);
    await Promise.all([first.auth.close(), first.auth.close()]);
  });

  it('still closes an older SSE session when many newer sessions were seen and its grant becomes unreadable', async () => {
    const sessions = Array.from({ length: 258 }, () => legacySession());
    await saveLegacy(sessions);
    const instance = await createFixture();
    const stream = await subscribe(instance, sessions[0].cookie);
    for (const session of sessions.slice(1)) expect((await instance.request('/api/private', { cookie: session.cookie })).status).toBe(200);
    await fs.unlink(recordPath(sessions[0]));
    expect((await instance.request('/api/session', { method: 'DELETE', cookie: sessions[0].cookie })).status).toBe(200);
    await stream.ended;
  }, 15_000);

  it('closes local SSE when authoritative revocation is first observed from another service', async () => {
    const first = await createFixture();
    const second = await createFixture();
    const session = await login(first);
    const stream = await subscribe(second, session.cookie);
    expect((await first.request('/api/session', { method: 'DELETE', cookie: session.cookie })).status).toBe(200);
    expect((await second.request('/api/private', { cookie: session.cookie })).status).toBe(401);
    await stream.ended;
  });

  it('does not accept an authority read that started before a same-process logout', async () => {
    const instance = await createFixture();
    const session = await login(instance);
    const paused = gate();
    const read = fs.readFile.bind(fs);
    let intercepted = false;
    const delayedRead = (async (...args: Parameters<typeof fs.readFile>) => {
      const contents = await read(...args);
      if (!intercepted && String(args[0]) === recordPath(session)) {
        intercepted = true; paused.signal(); await paused.blocked;
      }
      return contents;
    }) as typeof fs.readFile;
    vi.spyOn(fs, 'readFile').mockImplementation(delayedRead);
    const inFlight = instance.request('/api/private', { cookie: session.cookie });
    await paused.arrived;
    const revoked = new Promise<void>(resolve => instance.ctx.events.once('auth:logout', () => resolve()));
    const loggingOut = instance.request('/api/session', { method: 'DELETE', cookie: session.cookie });
    await revoked;
    expect((await instance.request('/api/private', { cookie: session.cookie })).status).toBe(401);
    paused.release();
    expect((await inFlight).status).toBe(401);
    expect((await loggingOut).status).toBe(200);
  });

  it('does not acknowledge failed durable logout, stays locally denied, and can retry its permanent revocation', async () => {
    const first = await createFixture();
    const second = await createFixture();
    const session = await login(first);
    const rename = fs.rename.bind(fs);
    const failure = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to) === recordPath(session, 'revoked')) throw Object.assign(new Error('Synthetic storage failure.'), { code: 'EIO' });
      return rename(from, to);
    });
    const response = await first.request('/api/session', { method: 'DELETE', cookie: session.cookie });
    expect(response.status).toBe(500);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect((await first.request('/api/private', { cookie: session.cookie })).status).toBe(401);
    // The failed write is deliberately not presented as a distributed revoke.
    expect((await second.request('/api/private', { cookie: session.cookie })).status).toBe(200);
    failure.mockRestore();
    expect((await first.request('/api/session', { method: 'DELETE', cookie: session.cookie })).status).toBe(200);
    expect((await second.request('/api/private', { cookie: session.cookie })).status).toBe(401);
  });
});

describe('legacy migration and bounded expired-session cleanup', () => {
  it('can resume a partially failed migration without marking the legacy source complete too early', async () => {
    const sessions = [legacySession(), legacySession()];
    const original = await saveLegacy(sessions);
    const rename = fs.rename.bind(fs);
    const failure = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to) === recordPath(sessions[1])) throw Object.assign(new Error('Synthetic migration failure.'), { code: 'EIO' });
      return rename(from, to);
    });
    await expect(createFixture()).rejects.toMatchObject({ code: 'EIO' });
    expect(await context().store.read(`session-migration-${epoch}`, null)).toBeNull();
    expect(await fs.readFile(path.join(context().store.directory, 'sessions.json'), 'utf8')).toBe(original);
    failure.mockRestore();
    const recovered = await createFixture();
    for (const session of sessions) expect((await recovered.request('/api/private', { cookie: session.cookie })).status).toBe(200);
    expect(await context().store.read(`session-migration-${epoch}`, null)).toEqual({ version: 2, epoch, complete: true });
  });

  it('accepts an old signed cookie in a fresh Node process, keeps secrets out of state, and never rewrites its legacy source', async () => {
    const session = legacySession();
    const original = await saveLegacy([session]);
    const script = `
      import express from 'express';
      import { createServer } from 'node:http';
      import { EventEmitter } from 'node:events';
      import { AuthService } from './server/auth.ts';
      import { loadConfig } from './server/config.ts';
      import { JsonStore, SecretStore } from './server/store.ts';
      import { WorkspaceService } from './server/workspaces.ts';
      import { defaultSettings } from './server/settings.ts';
      const config = loadConfig();
      const store = new JsonStore(config.stateDir);
      const ctx = { config, store, secrets: new SecretStore(store, config.encryptionKey), events: new EventEmitter(),
        workspaces: new WorkspaceService(config, store), providerKey: async () => undefined,
        settings: async () => defaultSettings, saveSettings: async () => defaultSettings };
      const auth = new AuthService(ctx);
      await auth.initialize();
      const app = express();
      app.use(auth.requireSession);
      app.get('/private', (_req, res) => res.json({ authorized: true }));
      app.use((error, _req, res, _next) => res.status(error.status || 500).json({ authorized: false }));
      const server = createServer(app);
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const response = await fetch('http://127.0.0.1:' + server.address().port + '/private', { headers: { Cookie: process.env.AUTH_TEST_COOKIE } });
      console.log(JSON.stringify({ status: response.status, body: await response.json() }));
      await new Promise(resolve => server.close(resolve));
      await auth.close();
      await store.flush();
    `;
    const env = {
      PATH: process.env.PATH, NODE_ENV: 'test', DATA_DIR: directory, WORKSPACE_PASSWORD: password,
      SESSION_SECRET: signingKey, ENCRYPTION_KEY: credentialKey, AUTH_TEST_COOKIE: session.cookie,
      // These fresh processes use the same bounded tooling pools as the runner.
      GOMAXPROCS: '2', UV_THREADPOOL_SIZE: '1', NODE_OPTIONS: '--v8-pool-size=1',
    };
    for (let run = 0; run < 2; run++) {
      const { stdout } = await execFile(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], { cwd: projectRoot, env, timeout: 15_000 });
      expect(JSON.parse(stdout.trim())).toEqual({ status: 200, body: { authorized: true } });
    }
    expect(await fs.readFile(path.join(context().store.directory, 'sessions.json'), 'utf8')).toBe(original);
    const stored = await fs.readFile(recordPath(session), 'utf8');
    for (const secret of [session.token, session.cookie, password, signingKey, credentialKey]) expect(stored).not.toContain(secret);
    const instance = await createFixture();
    expect((await instance.request('/api/session', { method: 'DELETE', cookie: session.cookie })).status).toBe(200);
    const afterLogout = await execFile(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], { cwd: projectRoot, env, timeout: 15_000 });
    expect(JSON.parse(afterLogout.stdout.trim())).toEqual({ status: 401, body: { authorized: false } });
  }, 30_000);

  it('retains revocation through expiry grace, cleans it only after safe expiry, and never reimports an old snapshot', async () => {
    const now = Date.now();
    const session = legacySession(now + 5 * 60_000);
    const original = await saveLegacy([session]);
    const first = await createFixture();
    expect((await first.request('/api/session', { method: 'DELETE', cookie: session.cookie })).status).toBe(200);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(session.expiresAt + 1);
    const withinGrace = await createFixture();
    expect((await withinGrace.request('/api/private', { cookie: session.cookie })).status).toBe(401);
    expect(JSON.parse(await fs.readFile(recordPath(session, 'revoked'), 'utf8')).revoked).toBe(true);
    clock.mockReturnValue(session.expiresAt + 3 * day);
    const afterGrace = await createFixture();
    expect((await afterGrace.request('/api/private', { cookie: session.cookie })).status).toBe(401);
    await expect(fs.stat(recordPath(session, 'revoked'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(recordPath(session))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(first.ctx.store.directory, 'sessions.json'), 'utf8')).toBe(original);
    // Even a later clock rollback does not make an obsolete aggregate a new
    // membership source after the permanent migration cutover.
    clock.mockReturnValue(now);
    const another = await createFixture();
    expect((await another.request('/api/private', { cookie: session.cookie })).status).toBe(401);
  });

  it('bounds each cleanup pass and preserves live grants and unrelated files', async () => {
    const expiredAt = Date.now() - 4 * day;
    const expiredDirectory = path.dirname(recordPath({ hash: 'a'.repeat(64), expiresAt: expiredAt }));
    const expired = new JsonStore(expiredDirectory);
    await Promise.all(Array.from({ length: 150 }, async (_, index) => {
      const hash = createHash('sha256').update(`expired-session-${index}`).digest('hex');
      const record = { version: 2, epoch, hash, expiresAt: expiredAt };
      await expired.write(`session-${hash}`, record);
      await expired.write(`revoked-${hash}`, { ...record, revoked: true });
    }));
    await fs.writeFile(path.join(expiredDirectory, 'unrelated.txt'), 'Preserve unknown state.');
    const active = legacySession();
    await saveLegacy([active]);
    const instance = await createFixture();
    const remaining = (await fs.readdir(expiredDirectory)).filter(file => /^(session|revoked)-/.test(file));
    expect(remaining.length).toBeGreaterThanOrEqual(300 - 128);
    expect(remaining.length).toBeLessThan(300);
    expect(await fs.readFile(path.join(expiredDirectory, 'unrelated.txt'), 'utf8')).toBe('Preserve unknown state.');
    expect((await instance.request('/api/private', { cookie: active.cookie })).status).toBe(200);
  });

  it('resumes bounded cleanup after a preserved prefix instead of examining the same unknown files forever', async () => {
    const expiredAt = Date.now() - 4 * day;
    const expiredDirectory = path.dirname(recordPath({ hash: 'a'.repeat(64), expiresAt: expiredAt }));
    await fs.mkdir(expiredDirectory, { recursive: true });
    // Both lexical ends keep the session entry behind a preserved prefix on
    // ascending, descending, or ordinary creation-ordered directory listings.
    const unknown = Array.from({ length: 256 }, (_, index) => [`000-unknown-${index}.txt`, `zzz-unknown-${index}.txt`]).flat();
    await Promise.all(unknown.map(name => fs.writeFile(path.join(expiredDirectory, name), 'Preserve unknown content.')));
    let target = '';
    let position = -1;
    for (let attempt = 0; attempt < 64 && position < 128; attempt++) {
      if (target) await fs.unlink(target);
      const hash = createHash('sha256').update(`late-expired-${attempt}`).digest('hex');
      target = path.join(expiredDirectory, `session-${hash}.json`);
      await fs.writeFile(target, JSON.stringify({ version: 2, epoch, hash, expiresAt: expiredAt }));
      const listing = await fs.opendir(expiredDirectory);
      const order: string[] = [];
      for await (const item of listing) order.push(item.name);
      position = order.indexOf(path.basename(target));
    }
    expect(position).toBeGreaterThanOrEqual(128);
    const instance = await createFixture();
    expect(await fs.stat(target)).toBeTruthy();
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now');
    for (let pass = 1; pass <= 6; pass++) {
      clock.mockReturnValue(start + pass * 60 * 60 * 1000 + 1);
      await login(instance);
      // Await the actual background operation started by that HTTP login;
      // assertions concern real files and the bounded, public request path.
      await (instance.auth as unknown as { maintenance?: Promise<void> }).maintenance;
    }
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.readdir(expiredDirectory)).sort()).toEqual([...unknown].sort());
  }, 15_000);

  it.each(['before-pin', 'after-pin'] as const)('does not follow an expiry-bucket symlink replacement %s during cleanup', async timing => {
    const expiredAt = Date.now() - 4 * day;
    const hash = createHash('sha256').update('safe-expired-session').digest('hex');
    const expiredDirectory = path.dirname(recordPath({ hash, expiresAt: expiredAt }));
    const outside = path.join(directory, 'unrelated-files');
    const moved = path.join(directory, 'original-expired-bucket');
    await fs.mkdir(expiredDirectory, { recursive: true });
    await fs.mkdir(outside);
    const name = `session-${hash}.json`;
    await fs.writeFile(path.join(expiredDirectory, name), JSON.stringify({ version: 2, epoch, hash, expiresAt: expiredAt }));
    await fs.writeFile(path.join(outside, name), 'An unrelated file must survive.');
    let swapped = false;
    const swap = async () => {
      if (swapped) return;
      swapped = true;
      await fs.rename(expiredDirectory, moved);
      await fs.symlink(outside, expiredDirectory, 'dir');
    };
    if (timing === 'before-pin') {
      const open = fs.open.bind(fs);
      vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
        if (String(args[0]).endsWith(`/${path.basename(expiredDirectory)}`)) await swap();
        return open(...args);
      });
    } else {
      const opendir = fs.opendir.bind(fs);
      vi.spyOn(fs, 'opendir').mockImplementation(async (...args: Parameters<typeof fs.opendir>) => {
        const location = String(args[0]);
        if (location.startsWith('/proc/self/fd/') || location.startsWith('/dev/fd/')) {
          if (await fs.realpath(location) === expiredDirectory) await swap();
        }
        return opendir(...args);
      });
    }
    await createFixture();
    expect(swapped).toBe(true);
    expect(await fs.readFile(path.join(outside, name), 'utf8')).toBe('An unrelated file must survive.');
  });
});
