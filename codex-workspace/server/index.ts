import express, { type ErrorRequestHandler } from 'express';
import compression from 'compression';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { loadConfig, type AppConfig } from './config';
import { BootstrapListener } from './bootstrap-listener';
import { JsonStore, SecretStore } from './store';
import { AuthService } from './auth';
import type { AppContext } from './context';
import { HttpError } from './errors';
import { createSettingsRouter, readPreferences, saveSettingsPreferences } from './claude-settings';
import { WorkspaceService, createWorkspaceRouter } from './workspaces';
import { createGitRouter } from './git';
import { createGithubRouter, initializeGithubImports } from './github';
import { createTerminalRouter, attachTerminalServer } from './terminal';
import { createAgentRouter, getClaudeConversations, initializeAgent, shutdownAgent } from './agent';
import { FileMetadataManager } from './file-metadata';
import { prepareRuntimeStorage } from './runtime-storage';
import { readWorkspaceTrashMetadataExclusions } from './workspace-trash/records';
import { assertWorkspaceFileRewindDeletionAllowed, readFileRewindMetadataExclusions } from './agent/file-rewind-cleanup';
import { restoreLegacyRewindBarriers } from './legacy/rewind-barriers';
import { cleanupWorkspaceArtifacts } from './workspace-artifacts';
import { measureApiTime } from './performance';
import { createUiStateRouter } from './ui-state';
import { createDownloadRouter, initializeDownloads, shutdownDownloads } from './downloads';
import { createUploadRouter, initializeUploads, shutdownUploads } from './uploads';
import { createWorktreeRouter, initializeWorktrees, shutdownWorktrees } from './worktrees';
import { createDirectoryPagesRouter, closeDirectoryPages } from './directory-pages';
import { createFilePagesRouter, initializeFilePages, shutdownFilePages } from './file-pages';
import { attachDevWeb, DEV_WEB_HMR_PATH } from './dev-web';

async function prepareStorage(config: AppConfig): Promise<void> {
  if (config.requirePersistentData) {
    // HF attaches the bucket before startup. Never attempt a mount or substitute
    // ephemeral storage when the requested native volume is absent.
    const contents = await fs.readFile('/proc/self/mountinfo', 'utf8');
    const target = path.resolve(config.dataDir);
    const mounted = contents.split('\n').some(line => {
      const mountPath = line.split(' ')[4]?.replace(/\\040/g, ' ');
      return mountPath === target;
    });
    if (!mounted) throw new Error(`Native persistent storage is not mounted at ${target}. Attach the data bucket in Space Settings.`);
  }
  await prepareRuntimeStorage(config);
  for (const directory of [config.dataDir, config.stateDir, config.workspacesDir, config.homeDir]) await fs.mkdir(directory, { recursive: true });
  // A retained file or symlink must never be truncated by a startup health
  // probe. Exclusive creation also keeps concurrent starts independent.
  const probe = path.join(config.stateDir, `.write-probe-${randomUUID()}`);
  await fs.writeFile(probe, 'ok', { flag: 'wx', mode: 0o600 });
  await fs.unlink(probe);
}

export async function createApplication(config: AppConfig = loadConfig()) {
  await prepareStorage(config);
  const store = new JsonStore(config.stateDir);
  const secrets = new SecretStore(store, config.encryptionKey);
  const events = new EventEmitter(); events.setMaxListeners(100);
  events.on('file-metadata:error', () => console.error('Persistent file metadata capture failed; inspect the authenticated storage status.'));
  const metadata = new FileMetadataManager(config, store, events, {
    // Restore saved modes and links before accepting work. A fresh traversal of
    // the remote bucket must not make HTTP startup depend on its latency.
    deferInitialCapture: true,
    scanTimeoutMs: 300_000,
    workspaceRestoreExclusions: async () => {
      const exclusions = await Promise.all([
        readWorkspaceTrashMetadataExclusions(config), readFileRewindMetadataExclusions(config),
      ]);
      return [...new Set(exclusions.flat())];
    },
  });
  const metadataStartedAt = Date.now();
  if (config.production) console.info('Restoring saved workspace file metadata.');
  await metadata.initialize();
  if (config.production) console.info(`Restored ${metadata.status().entries} saved file metadata entries in ${Math.round((Date.now() - metadataStartedAt) / 1000)} seconds.`);
  const workspaces = new WorkspaceService(config, store, {
    checkpointFileMetadata: () => metadata.capture(),
    assertWorkspaceDeletionAllowed: workspaceId => assertWorkspaceFileRewindDeletionAllowed({ config }, workspaceId),
    quiesceWorkspace: workspaceId => getClaudeConversations(ctx).quiesceWorkspace(workspaceId),
    cleanupWorkspaceArtifacts: request => cleanupWorkspaceArtifacts(ctx, request),
  });
  const ctx: AppContext = {
    config, store, secrets, events, workspaces,
    // This service uses the owner's fixed provider configuration. There is no
    // per-user model credential, and the non-secret placeholder must not redact
    // ordinary occurrences of the word in code or model messages.
    providerKey: async () => undefined,
    settings: () => readPreferences(ctx),
    saveSettings: patch => saveSettingsPreferences(ctx, patch),
  };
  let auth: AuthService | undefined;
  let server: ReturnType<typeof createServer> | undefined;
  let terminals: ReturnType<typeof attachTerminalServer> | undefined;
  let closeDevWeb: Awaited<ReturnType<typeof attachDevWeb>> | undefined;
  let agentStarted = false;
  let closing: Promise<void> | undefined;
  try {
    // Restore signed recovery barriers before startup jobs can mutate a checkout.
    // This reconstructs admission state only; it never replays a file rewind.
    await restoreLegacyRewindBarriers(config);
    await workspaces.initialize();
    await workspaces.recoverFileTransfers();
    await initializeGithubImports(ctx);
    await initializeWorktrees(ctx);
    await initializeDownloads(ctx);
    await initializeUploads(ctx);
    await initializeFilePages(ctx);
    agentStarted = true;
    await initializeAgent(ctx);
    metadata.start();
    auth = new AuthService(ctx); await auth.initialize();
    workspaces.startTrashCleanup();
    const app = express();
    app.disable('x-powered-by');
    // Hugging Face terminates TLS. Authentication always uses secure cookies in production.
    app.set('trust proxy', 1);
    app.use(compression({
      level: 4,
      filter: (req, res) => !req.path.startsWith('/api') && !req.path.startsWith('/ws') && compression.filter(req, res),
    }));
    app.use((_req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'same-origin');
      res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://avatars.githubusercontent.com; font-src 'self' data:; connect-src 'self' https://huggingface.co https://cas-bridge-direct.xethub.hf.co https://cas-bridge.xethub.hf.co https://cas-server-direct.xethub.hf.co https://cas-server.xethub.hf.co; worker-src 'self' blob:; frame-ancestors 'self' https://huggingface.co https://*.huggingface.co; object-src 'none'; base-uri 'self'; form-action 'self'");
      next();
    });
    // The public landing page is a status response, even for an unlocked session
    // or a root URL carrying workspace parameters. Mount before either web mode.
    app.get('/', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('status: ok');
    });
    app.get('/health', (_req, res) => res.json({ status: 'ok' }));
    app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
    app.use('/api', auth.protectMutations);
    app.use('/api/session', express.json({ limit: '4kb' }));
    app.use('/api', auth.router());
    app.use('/api', auth.requireSession, measureApiTime);
    app.use('/api/claude/attachments', express.json({ limit: '24mb' }));
    app.use('/api', express.json({ limit: '8mb' }));
    app.use('/api', createSettingsRouter(ctx), createDownloadRouter(ctx), createUploadRouter(ctx), createUiStateRouter(ctx));
    app.get('/api/workspaces/:id/download', (_req, _res, next) => config.production || config.downloadBucket
      ? next(new HttpError(409, 'Prepare this file with the app Download action to receive its public bucket link.', 'DOWNLOAD_PREPARATION_REQUIRED'))
      : next());
    app.use('/api', createDirectoryPagesRouter(ctx), createFilePagesRouter(ctx), createWorkspaceRouter(ctx), createWorktreeRouter(ctx), createGitRouter(ctx), createGithubRouter(ctx), createTerminalRouter(ctx), createAgentRouter(ctx));
    app.get('/api/storage', (_req, res) => res.json({ path: config.dataDir, persistent: config.requirePersistentData, bucket: config.bucket, writable: true, metadata: metadata.status() }));
    app.use('/api', (_req, _res, next) => next(new HttpError(404, 'This API route does not exist.')));
    server = createServer(app);
    closeDevWeb = config.devWeb ? await attachDevWeb(app, server, {
      runtimeDir: config.runtimeDir, dataDir: config.dataDir, authenticateUpgrade: auth.authenticateUpgrade, events,
    }) : undefined;
    if (!config.devWeb) {
      app.use(express.static(config.distDir, { index: false, maxAge: config.production ? '1h' : 0 }));
      app.get('/{*path}', async (req, res, next) => {
        if (!req.accepts('html')) return next(new HttpError(404, 'Not found.'));
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(path.join(config.distDir, 'index.html'), error => { if (error) next(error); });
      });
    }
    const handleError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
      if (res.headersSent) { res.end(); return; }
      if (error instanceof HttpError) { res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) }); return; }
      if (error instanceof ZodError) { res.status(400).json({ error: error.issues.map(issue => `${issue.path.join('.') || 'Request'}: ${issue.message}`).join('; '), code: 'VALIDATION_ERROR' }); return; }
      const detail = error as { type?: string; status?: number; code?: string; name?: string };
      if (detail.type === 'entity.too.large') { res.status(413).json({ error: 'This request is too large.' }); return; }
      if (detail.type === 'entity.parse.failed') { res.status(400).json({ error: 'The request must contain valid JSON.' }); return; }
      if (detail.code === 'ENOENT') { res.status(404).json({ error: 'The requested file no longer exists.' }); return; }
      if (detail.code === 'EACCES' || detail.code === 'EPERM') { res.status(403).json({ error: 'The instance cannot access this file.' }); return; }
      // Never serialize arbitrary upstream error bodies, environment, request data,
      // credential URLs, or stack traces to clients or the public Space logs.
      console.error('Request failed:', detail.name || 'Error', detail.code || 'unclassified');
      res.status(500).json({ error: 'The request could not be completed. Please try again.', code: 'INTERNAL_ERROR' });
    };
    app.use(handleError);
    terminals = attachTerminalServer(server, ctx, auth.authenticateUpgrade, config.devWeb ? { devHmrPath: DEV_WEB_HMR_PATH } : undefined);
    return { app, server, ctx, auth, metadata, close };
  } catch (error) {
    // Initialization can already own timers, directory handles and a native
    // process. Drain that partial application before reporting startup failure.
    try { await close(); }
    catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Workspace startup failed and its cleanup could not be completely confirmed.', { cause: error });
    }
    throw error;
  }

  function close(): Promise<void> {
    if (closing) return closing;
    // Store the promise before dispatching shutdown events so every caller,
    // including repeated process signals, awaits the same completed drain.
    closing = Promise.resolve().then(async () => {
      const failures: unknown[] = [];
      const settle = async (operation: () => unknown | Promise<unknown>): Promise<void> => {
        try { await operation(); }
        catch (error) { failures.push(error); }
      };
      const serverClosed = settle(() => server?.listening
        ? new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()))
        : undefined);
      const forceClose = setTimeout(() => server?.closeAllConnections(), 15_000); forceClose.unref();
      // Latch admission immediately. These drains include work whose HTTP client
      // has disconnected; closing sockets alone cannot prove a save has stopped.
      const filePagesClosed = settle(() => shutdownFilePages(ctx));
      const trashPagesClosed = settle(() => workspaces.closeFileTrashPages());
      const fileMutationsClosed = settle(() => workspaces.closeFileMutations());
      try {
        // Preserve the service dependency order, but one failure must never
        // skip unrelated drains, authentication closure or the final flush.
        await settle(() => events.emit('auth:logout'));
        await settle(() => workspaces.closeTrashCleanup());
        await settle(() => shutdownUploads(ctx));
        await settle(() => shutdownWorktrees(ctx));
        if (agentStarted) await settle(() => shutdownAgent(ctx));
        await settle(() => shutdownDownloads(ctx));
        await settle(() => terminals?.close());
        await settle(() => closeDevWeb?.());
        await serverClosed;
        await filePagesClosed;
        await trashPagesClosed;
        await fileMutationsClosed;
        await settle(() => closeDirectoryPages(ctx));
        await settle(() => auth?.close());
        await settle(() => metadata.close());
        await settle(() => store.flush());
        if (failures.length) throw new AggregateError(failures, 'Workspace shutdown could not be completely confirmed.');
      } finally { clearTimeout(forceClose); }
    });
    return closing;
  }
}

export async function startApplication(config: AppConfig = loadConfig()) {
  const bootstrap = config.bootstrapListener ? new BootstrapListener(config.bootstrapListener, config.port) : undefined;
  // Keep activation handles outside the long-lived context and all metadata.
  const { bootstrapListener: _bootstrapListener, ...applicationConfig } = config;
  let runtime: Awaited<ReturnType<typeof createApplication>> | undefined;
  try {
    runtime = await createApplication(applicationConfig);
    const { server } = runtime;
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => { server.off('listening', ready); reject(error); };
      const ready = () => { server.off('error', failed); resolve(); };
      server.once('error', failed); server.once('listening', ready);
      try { if (bootstrap) bootstrap.listen(server); else server.listen(config.port, config.host); }
      catch (error) { server.off('error', failed); server.off('listening', ready); reject(error); }
    });
    bootstrap?.signalReady();
    return runtime;
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    try { bootstrap?.close(); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
    try { await runtime?.close(); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
    if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], 'The workspace listener could not start and its cleanup could not be completely confirmed.', { cause: error });
    throw error;
  }
}

async function main() {
  const runtime = await startApplication();
  console.log(`Arc Workspace is listening on port ${runtime.ctx.config.port}.`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void runtime.close().then(() => process.exit(0), () => process.exit(1)); });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(error => { console.error('Workspace startup failed:', error instanceof Error ? error.message : 'Unknown error'); process.exit(1); });
}
