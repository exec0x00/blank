import { randomBytes } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import type { IncomingMessage, Server } from 'node:http';
import { createRequire, isBuiltin } from 'node:module';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import type { Express, Request, Response } from 'express';
import type { Plugin, ViteDevServer } from 'vite';
import { HttpError } from './errors';

export const DEV_WEB_HMR_PATH = '/__codex_dev_hmr';
const NONCE_PLACEHOLDER = '__CODEX_DEV_SCRIPT_NONCE__';
const MAX_HMR_CONNECTIONS = 64;
const HMR_AUTH_TIMEOUT = 5000;
const VIRTUAL_URLS = new Set(['/@vite/client', '/@vite/env', '/@react-refresh', '/@id/__vite-browser-external', '/@id/__x00__vite/wasm-helper.js']);
const VIRTUAL_IDS = new Set(['/@react-refresh', '\0vite/wasm-helper.js', '__vite-browser-external']);
const browserExternal = (id: string): boolean => id.startsWith('__vite-browser-external:') && isBuiltin(id.slice('__vite-browser-external:'.length));

export interface DevWebOptions {
  rootDir?: string;
  runtimeDir: string;
  dataDir: string;
  authenticateUpgrade: (request: IncomingMessage) => boolean | Promise<boolean>;
  events: Pick<EventEmitter, 'on' | 'off'>;
}

type UpgradeListener = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;
const within = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const denied = () => new HttpError(403, 'This development asset is not available.', 'DEV_ASSET_DENIED');
const cleanId = (id: string) => id.split(/[?#]/, 1)[0];

function requestPath(url: string): string {
  if (url.length > 8192 || !url.startsWith('/') || url.includes('#')) throw denied();
  let pathname: string;
  try { pathname = decodeURIComponent(url.split('?', 1)[0]); }
  catch { throw denied(); }
  // Check before URL normalization, including encoded and double-encoded traversal.
  if (/[\\%\u0000-\u001f\u007f]/.test(pathname) || pathname.includes('//')
    || pathname.split('/').some(part => part === '.' || part === '..' || part.startsWith('.'))) throw denied();
  return pathname;
}

function rejectUpgrade(socket: Duplex, status = 401): void {
  if (socket.destroyed) return;
  socket.on('error', () => undefined);
  socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () => socket.destroy());
}

function addScriptNonce(res: Response, nonce: string): void {
  const header = res.getHeader('Content-Security-Policy');
  const policy = typeof header === 'string' ? header : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'";
  const directive = /(^|;)\s*script-src\s+([^;]*)/;
  res.setHeader('Content-Security-Policy', directive.test(policy)
    ? policy.replace(directive, (_match, prefix: string, values: string) => `${prefix} script-src ${values.trim()} 'nonce-${nonce}'`)
    : `${policy}; script-src 'self' 'nonce-${nonce}'`);
}

/**
 * Mount after the authenticated API and its 404 handler, instead of built static
 * assets. Vite never listens or forwards requests: HTTP and HMR use `server`.
 * Call the returned close function before waiting for the parent HTTP shutdown.
 */
export async function attachDevWeb(app: Express, server: Server, options: DevWebOptions): Promise<() => Promise<void>> {
  const root = await fs.realpath(path.resolve(options.rootDir ?? process.cwd()));
  const dataRoot = await fs.realpath(path.resolve(options.dataDir));
  const runtimeRoot = await fs.realpath(path.resolve(options.runtimeDir));
  if (within('/data', runtimeRoot) || within(dataRoot, runtimeRoot) || within(runtimeRoot, dataRoot)) {
    throw new Error('Development caches must be outside durable storage.');
  }
  const cacheDir = path.join(runtimeRoot, 'cache', 'vite');
  for (const directory of [path.dirname(cacheDir), cacheDir]) {
    await fs.mkdir(directory, { mode: 0o700 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; });
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(directory) !== directory) {
      throw new Error('The development cache must use ordinary runtime directories.');
    }
  }
  const browserDirectories = ['client', 'shared', 'public', 'node_modules'];
  const roots = await Promise.all([...browserDirectories.map(name => path.join(root, name)), cacheDir].map(directory => fs.realpath(directory)));
  const installedVite = await fs.realpath(path.dirname(createRequire(import.meta.url).resolve('vite/package.json')));
  if (roots.slice(0, 3).some((directory, index) => directory !== path.join(root, browserDirectories[index]))
    || !within(roots[3], installedVite)) {
    throw new Error('Development assets must use ordinary browser source directories and the installed dependencies.');
  }
  if (roots.some(directory => within('/data', directory) || within(dataRoot, directory))) {
    throw new Error('Development browser assets must be outside durable storage.');
  }
  const indexPath = path.join(root, 'index.html');
  const permittedRoots = [...roots, path.join(root, 'node_modules')];
  const permitted = (filename: string): boolean => (filename === indexPath || permittedRoots.some(directory => within(directory, filename)))
    && !within('/data', filename) && !within(dataRoot, filename)
    && !filename.split(path.sep).some(part => part.startsWith('.'))
    && !/\.(?:pem|crt|key)$/i.test(filename);
  async function checkedFile(filename: string): Promise<string> {
    if (!permitted(filename)) throw denied();
    let resolved: string;
    try { resolved = await fs.realpath(filename); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, 'This development asset does not exist.');
      throw denied();
    }
    if (!permitted(resolved)) throw denied();
    return resolved;
  }
  async function checkModule(id: string): Promise<void> {
    if (VIRTUAL_IDS.has(id) || browserExternal(id)) return;
    const filename = cleanId(id);
    if (!path.isAbsolute(filename)) throw denied();
    // Optimized dependency files can be resolved just before Vite writes them.
    if (within(cacheDir, filename)) {
      if (!permitted(filename) || await fs.realpath(cacheDir) !== cacheDir) throw denied();
      await checkedFile(filename).catch(error => { if (!(error instanceof HttpError) || error.status !== 404) throw error; });
      return;
    }
    await checkedFile(filename);
  }

  let vite: ViteDevServer | undefined;
  let guardedUpgrade: UpgradeListener | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;
  let authorizationVersion = 0;
  const pending = new Map<Duplex, NodeJS.Timeout>();
  const existingUpgradeListeners = new Set(server.listeners('upgrade'));

  const closeHmr = () => {
    authorizationVersion++;
    for (const [socket, timer] of pending) { clearTimeout(timer); socket.destroy(); }
    pending.clear();
    for (const client of vite?.ws.clients ?? []) client.socket.terminate();
  };
  function guardHmr(dev: ViteDevServer): void {
    // Vite installs its native handler before configureServer. Wrap that handler
    // on every Vite restart; no new server, connection forwarding, or WS port.
    const nativeUpgrade = server.listeners('upgrade').at(-1) as UpgradeListener | undefined;
    if (!nativeUpgrade || nativeUpgrade === guardedUpgrade || existingUpgradeListeners.has(nativeUpgrade)) {
      throw new Error('The development HMR listener could not be secured.');
    }
    server.off('upgrade', nativeUpgrade);
    if (guardedUpgrade) server.off('upgrade', guardedUpgrade);
    guardedUpgrade = (request, socket, head) => {
      let url: URL;
      try { url = new URL(request.url ?? '/', 'http://localhost'); }
      catch { return; }
      if (url.pathname !== DEV_WEB_HMR_PATH) return;
      const protocol = request.headers['sec-websocket-protocol'];
      // The app's existing upgrade handler owns unrecognized protocols.
      if (protocol !== 'vite-hmr' && protocol !== 'vite-ping') return;
      try { if (requestPath(request.url ?? '/') !== DEV_WEB_HMR_PATH) throw denied(); }
      catch { rejectUpgrade(socket, 400); return; }
      if (closed) { rejectUpgrade(socket, 503); return; }
      if (pending.size + dev.ws.clients.size >= MAX_HMR_CONNECTIONS) { rejectUpgrade(socket, 429); return; }
      const version = authorizationVersion;
      const timer = setTimeout(() => { pending.delete(socket); rejectUpgrade(socket); }, HMR_AUTH_TIMEOUT);
      timer.unref();
      pending.set(socket, timer);
      const release = () => { clearTimeout(timer); pending.delete(socket); };
      socket.once('close', release);
      socket.once('error', release);
      void Promise.resolve().then(() => options.authenticateUpgrade(request)).then(allowed => {
        if (!pending.has(socket)) return;
        release();
        if (socket.destroyed) return;
        if (!allowed || closed || version !== authorizationVersion) { rejectUpgrade(socket); return; }
        nativeUpgrade.call(server, request, socket, head);
      }).catch(() => { release(); rejectUpgrade(socket); });
    };
    server.on('upgrade', guardedUpgrade);
    dev.ws.on('connection', (socket) => {
      // The browser only needs invalidation messages. Vite's remote module-runner
      // RPC is deliberately unavailable, even to an authenticated HMR client.
      const listeners = socket.listeners('message');
      socket.removeAllListeners('message');
      socket.on('message', (raw, binary) => {
        if (binary || Buffer.byteLength(raw.toString()) > 16_384) { socket.close(1008, 'Unsupported development message'); return; }
        let message: { type?: string; event?: string; data?: { path?: string } };
        try { message = JSON.parse(raw.toString()) as typeof message; }
        catch { socket.close(1008, 'Unsupported development message'); return; }
        if (message?.type === 'ping') return;
        if (message?.type !== 'custom' || message.event !== 'vite:invalidate' || typeof message.data?.path !== 'string'
          || !dev.environments.client.moduleGraph.urlToModuleMap.has(message.data.path)) {
          socket.close(1008, 'Unsupported development message'); return;
        }
        for (const listener of listeners) listener.call(socket, raw, binary);
      });
    });
  }

  const boundary: Plugin = {
    name: 'codex-development-boundary',
    enforce: 'pre',
    async resolveId(source, importer, settings) {
      const resolved = await this.resolve(source, importer, { ...settings, skipSelf: true });
      if (resolved && !resolved.external) await checkModule(resolved.id);
      return resolved;
    },
    async load(id) { await checkModule(id); return null; },
    transform(code, id) {
      if (cleanId(id) !== path.join(installedVite, 'dist', 'client', 'client.mjs')) return null;
      // Middleware mode still includes Vite's standalone-port fallback. Keep
      // reconnects on this same authenticated origin, including before unlock.
      const transformed = code.replace(/const directSocketHost = [^;\n]+;/, 'const directSocketHost = socketHost;');
      if (transformed === code) throw new HttpError(500, 'The development client cannot establish its same-origin connection.');
      return { code: transformed.replace(/const serverHost = [^;\n]+;/, 'const serverHost = importMetaUrl.host;'), map: null };
    },
    configureServer(dev) { vite = dev; guardHmr(dev); },
  };
  try {
    const [{ createServer: createViteServer }, { default: react }] = await Promise.all([import('vite'), import('@vitejs/plugin-react')]);
    vite = await createViteServer({
      root, configFile: false, envFile: false, appType: 'custom', publicDir: false,
      cacheDir, clearScreen: false, plugins: [boundary, react()], worker: { format: 'es' },
      html: { cspNonce: NONCE_PLACEHOLDER },
      optimizeDeps: { entries: [path.join(root, 'client', 'main.tsx')] },
      server: {
        middlewareMode: true, cors: false,
        allowedHosts: ['.hf.space'],
        hmr: { server, path: DEV_WEB_HMR_PATH, overlay: false },
        fs: { strict: true, allow: [...roots, indexPath], deny: ['**/.*/**', '**/.env*', '**/*.{pem,crt,key}'] },
        watch: {
          followSymlinks: false,
          ignored: (filename: string) => {
            const absolute = path.resolve(filename);
            if (within('/data', absolute) || within(dataRoot, absolute)) return true;
            if (!within(root, absolute) || absolute === root) return false;
            const first = path.relative(root, absolute).split(path.sep)[0];
            return !['client', 'shared', 'public', 'index.html', 'tsconfig.json'].includes(first);
          },
        },
      },
    });
  } catch (error) {
    if (guardedUpgrade) server.off('upgrade', guardedUpgrade);
    await vite?.close();
    throw error;
  }
  const development = vite;
  options.events.on('auth:logout', closeHmr);

  async function checkedRequestFile(filename: string): Promise<void> {
    try { await checkedFile(filename); }
    catch (error) {
      if (!(error instanceof HttpError) || error.status !== 404 || !within(cacheDir, filename)) throw error;
      const optimizer = development.environments.client.depsOptimizer;
      const dependency = optimizer?.metadata.depInfoList.find(info => info.file === filename);
      if (!dependency?.processing || !optimizer?.isOptimizedDepFile(filename)) throw error;
      // Vite publishes import URLs before its cold-start bundles reach disk.
      // Wait only for the exact dependency registered by the native optimizer;
      // arbitrary missing cache paths never acquire permission by being absent.
      await checkModule(filename);
      await dependency.processing;
      if (closed) throw new HttpError(503, 'Development assets are shutting down.');
      // Optimization must not bypass the ordinary realpath/secret boundary.
      // Recheck the installed file before Vite reads or transforms any bytes.
      await checkedFile(filename);
    }
  }

  async function sendIndex(req: Request, res: Response): Promise<void> {
    const template = await fs.readFile(await checkedFile(indexPath), 'utf8');
    const nonce = randomBytes(18).toString('base64');
    const html = await development.transformIndexHtml('/index.html', template, req.originalUrl);
    addScriptNonce(res, nonce);
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(html.replaceAll(NONCE_PLACEHOLDER, nonce));
  }
  app.use(async (req, res, next) => {
    try {
      if (closed) throw new HttpError(503, 'Development assets are shutting down.');
      const pathname = requestPath(req.url);
      if (pathname === '/api' || pathname.startsWith('/api/') || pathname === '/ws' || pathname.startsWith('/ws/')) return next();
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Development assets are read-only.');
      // The application mounts its root status response before this helper.
      // Explicit workspace entries also work without an HTML Accept header.
      if (pathname === '/' || pathname === '/index.html' || pathname === '/work' || pathname === '/work/') { await sendIndex(req, res); return; }
      if (!VIRTUAL_URLS.has(pathname) && !(pathname.startsWith('/@id/') && browserExternal(pathname.slice('/@id/'.length)))) {
        let filename: string | undefined;
        if (pathname.startsWith('/@fs/')) filename = path.resolve('/', pathname.slice('/@fs/'.length));
        else if (['client', 'shared', 'node_modules'].some(directory => pathname.startsWith(`/${directory}/`))) filename = path.join(root, pathname.slice(1));
        if (filename) await checkedRequestFile(filename);
        else {
          if (pathname.startsWith('/@') || pathname.startsWith('/__')) throw denied();
          const publicFile = path.join(root, 'public', pathname.slice(1));
          try {
            const resolved = await checkedFile(publicFile);
            if (!(await fs.stat(resolved)).isFile()) throw denied();
            res.sendFile(resolved, error => { if (error) next(error); });
            return;
          } catch (error) {
            if (!(error instanceof HttpError) || error.status !== 404) throw error;
          }
          if (!path.extname(pathname) && req.headers.accept?.includes('text/html')) { await sendIndex(req, res); return; }
          throw new HttpError(404, 'This development asset does not exist.');
        }
      }
      development.middlewares(req, res, (error?: unknown) => next(error ?? new HttpError(404, 'This development asset does not exist.')));
    } catch (error) { next(error); }
  });
  return () => {
    if (closing) return closing;
    closed = true;
    options.events.off('auth:logout', closeHmr);
    closeHmr();
    if (guardedUpgrade) server.off('upgrade', guardedUpgrade);
    closing = development.close();
    return closing;
  };
}
