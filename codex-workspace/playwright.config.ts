import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { browserLaunchOptions } from './tests/browser-launch';
import { browserCaseProjects } from './tests/browser-projects';

const external = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = external || 'http://127.0.0.1:4390';
const dataDir = process.env.PLAYWRIGHT_DATA_DIR || mkdtempSync(path.join(os.tmpdir(), 'codex-workspace-browser-'));
// Workers load this configuration again. Propagate the controller's owned
// directory before they spawn so their guarded fixtures identify the same
// server. An externally supplied URL still requires explicit data authority.
if (!external) process.env.PLAYWRIGHT_DATA_DIR = dataDir;
const lowThreads = process.env.CODEX_BROWSER_LOW_THREADS === '1';
const controllerServer = lowThreads && !external;
const freshProcesses = lowThreads && process.env.CODEX_BROWSER_FRESH_PROCESS === '1';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 12_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  ...(freshProcesses ? { projects: browserCaseProjects() } : {}),
  ...(controllerServer ? { globalSetup: './tests/browser-server.ts', metadata: { codexBrowserServerDataDir: dataDir } } : {}),
  use: {
    ...devices['Desktop Chrome'],
    launchOptions: browserLaunchOptions(),
    baseURL,
    viewport: { width: 1440, height: 960 },
    trace: lowThreads ? 'off' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: external || controllerServer ? undefined : {
    command: 'node dist/server/index.js',
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      NODE_ENV: 'test', PORT: '4390', DATA_DIR: dataDir,
      WORKSPACE_PASSWORD: 'browser-test-workspace-password',
      SESSION_SECRET: 'browser-test-session-secret-32-characters',
      ENCRYPTION_KEY: 'browser-test-credential-key-32-characters',
      REQUIRE_PERSISTENT_DATA: '0',
    },
  },
});
