import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserLaunchOptions } from './browser-launch';

const scratch = process.env.ARC_LOADING_FIXTURE_DIR || mkdtempSync(path.join(os.tmpdir(), 'arc-loading-'));
process.env.ARC_LOADING_FIXTURE_DIR = scratch;
const baseURL = 'http://127.0.0.1:4399';
export default defineConfig({
  testDir: '.', testMatch: 'loading-browser.spec.ts', workers: 1, retries: 0,
  timeout: 60_000, expect: { timeout: 15_000 }, reporter: [['list']],
  outputDir: '/tmp/arc-loading-proof',
  use: { ...devices['Desktop Chrome'], baseURL, viewport: { width: 1440, height: 960 },
    actionTimeout: 15_000, launchOptions: browserLaunchOptions(), screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: {
    command: 'node --import tsx server/index.ts', cwd: fileURLToPath(new URL('..', import.meta.url)),
    url: baseURL + '/health', reuseExistingServer: false, timeout: 60_000,
    env: { NODE_ENV: 'test', CODEX_VITE_DEV: '1', PORT: '4399', HOST: '127.0.0.1',
      DATA_DIR: path.join(scratch, 'data'), RUNTIME_DIR: path.join(scratch, 'runtime'),
      WORKSPACE_PASSWORD: 'loading-fixture-password', SESSION_SECRET: 'loading-fixture-session-32-characters',
      ENCRYPTION_KEY: 'loading-fixture-encryption-32-characters', REQUIRE_PERSISTENT_DATA: '0' },
  },
});
