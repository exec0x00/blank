import type { FullConfig } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AppConfig } from '../server/config';
import type { createApplication as CreateApplication } from '../server/index';

// Low-thread runs keep the actual built backend in Playwright's controller.
// Test workers and browser contexts still use its authenticated HTTP/WS routes.
// This removes the additional Node server and shell used by webServer.
export default async function browserServer(config: FullConfig) {
  if (process.env.CODEX_BROWSER_LOW_THREADS !== '1' || process.env.PLAYWRIGHT_BASE_URL) throw new Error('The controller browser server requires the local low-thread test configuration.');
  const configuredDataDir = config.metadata.codexBrowserServerDataDir;
  const baseURL = config.projects[0]?.use.baseURL;
  if (typeof configuredDataDir !== 'string' || typeof baseURL !== 'string') throw new Error('The local browser server is missing its fixture data directory or URL.');
  const url = new URL(baseURL);
  if (url.origin !== 'http://127.0.0.1:4390') throw new Error('The controller browser server only listens on its configured local test URL.');
  const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
  const dataDir = path.resolve(configuredDataDir);
  const built = await import(pathToFileURL(path.join(sourceRoot, 'dist', 'server', 'index.js')).href) as { createApplication: typeof CreateApplication };
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-browser-server-runtime-'));
  const removeRuntime = () => fs.rm(runtimeDir, { recursive: true, force: true });
  const serverConfig: AppConfig = {
    dataDir,
    stateDir: path.join(dataDir, 'codex-workspace', 'state'),
    workspacesDir: path.join(dataDir, 'workspaces'),
    homeDir: path.join(dataDir, 'home'),
    runtimeDir,
    password: 'browser-test-workspace-password',
    sessionSecret: 'browser-test-session-secret-32-characters',
    encryptionKey: 'browser-test-credential-key-32-characters',
    port: 4390,
    host: '127.0.0.1',
    production: false,
    bucket: 'alvin3y12/data',
    requirePersistentData: false,
    nativeBrowserEnabled: false,
    codexCliAutoStart: false,
    distDir: path.join(sourceRoot, 'dist', 'client'),
  };
  const runtime = await built.createApplication(serverConfig).catch(async error => {
    await removeRuntime();
    throw error;
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => reject(error);
      runtime.server.once('error', failed);
      runtime.server.listen(serverConfig.port, serverConfig.host, () => {
        runtime.server.off('error', failed);
        resolve();
      });
    });
  } catch (error) {
    try { await runtime.close(); }
    finally { await removeRuntime(); }
    throw error;
  }
  const topology = { mode: 'playwright-controller', controllerPid: process.pid, backendPid: process.pid, baseURL, dataDir, closed: false };
  config.metadata.codexBrowserServer = topology;
  console.log(`Local built browser backend is running in Playwright controller PID ${process.pid}.`);
  return async () => {
    try {
      await runtime.close();
      topology.closed = true;
      console.log(`Local built browser backend closed in Playwright controller PID ${process.pid}.`);
    } finally { await removeRuntime(); }
  };
}
