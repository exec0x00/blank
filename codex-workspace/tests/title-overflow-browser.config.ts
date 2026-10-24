import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserLaunchOptions } from './browser-launch';

// Source UI and real site APIs, with storage owned only by this regression.
const scratch = process.env.TITLE_OVERFLOW_FIXTURE_DIR || mkdtempSync(path.join(os.tmpdir(), 'arc-title-overflow-'));
process.env.TITLE_OVERFLOW_FIXTURE_DIR = scratch;
const baseURL = 'http://127.0.0.1:4398';
export default defineConfig({
  testDir: '.', testMatch: 'title-overflow-browser.spec.ts', workers: 1, retries: 0,
  // A fresh browser per viewport also supports hosts using single-process Chromium.
  projects: [1440, 1100, 800, 390].map(width => ({ name: `${width}px`, grep: new RegExp(`${width}px titles`) })),
  timeout: 90_000, expect: { timeout: 15_000 }, reporter: [['list']],
  outputDir: '/tmp/arc-title-overflow-proof',
  use: { ...devices['Desktop Chrome'], baseURL, viewport: { width: 1440, height: 960 }, actionTimeout: 15_000,
    launchOptions: browserLaunchOptions(), screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: {
    command: 'node --import tsx server/index.ts', cwd: fileURLToPath(new URL('..', import.meta.url)), url: baseURL + '/health', reuseExistingServer: false, timeout: 60_000,
    env: { NODE_ENV: 'test', CODEX_VITE_DEV: '1', PORT: '4398', HOST: '127.0.0.1',
      DATA_DIR: path.join(scratch, 'data'), RUNTIME_DIR: path.join(scratch, 'runtime'),
      WORKSPACE_PASSWORD: 'title-overflow-fixture-password', SESSION_SECRET: 'title-overflow-session-fixture-32-characters',
      ENCRYPTION_KEY: 'title-overflow-encryption-fixture-32-characters', REQUIRE_PERSISTENT_DATA: '0' },
  },
});
