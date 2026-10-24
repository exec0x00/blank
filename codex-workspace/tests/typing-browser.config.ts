import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserLaunchOptions } from './browser-launch';

const scratch = process.env.ARC_TYPING_FIXTURE_DIR || mkdtempSync(path.join(os.tmpdir(), 'arc-typing-'));
process.env.ARC_TYPING_FIXTURE_DIR = scratch;
const baseURL = 'http://127.0.0.1:4409';
export default defineConfig({
  testDir: '.', workers: 1, retries: 0, timeout: 60_000,
  expect: { timeout: 12_000 }, reporter: [['list']], outputDir: '/tmp/arc-typing-proof',
  use: { ...devices['Desktop Chrome'], baseURL, viewport: { width: 1440, height: 960 },
    actionTimeout: 15_000, launchOptions: browserLaunchOptions(), screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'native-input', testMatch: 'e2e/input-motion.spec.ts' },
    { name: 'activity', testMatch: 'e2e/chronological-activity.spec.ts', grep: /streaming groups stay collapsed/ },
    { name: 'response', testMatch: 'e2e/codex-cli-chat.spec.ts',
      grep: /response activity|streamed response|native run sends literal|native steer and queue|secret question answers/ },
  ],
  webServer: {
    command: 'node --import tsx server/index.ts', cwd: fileURLToPath(new URL('..', import.meta.url)),
    url: baseURL + '/health', reuseExistingServer: false, timeout: 60_000,
    env: { NODE_ENV: 'test', CODEX_VITE_DEV: '1', PORT: '4409', HOST: '127.0.0.1',
      DATA_DIR: path.join(scratch, 'data'), RUNTIME_DIR: path.join(scratch, 'runtime'),
      WORKSPACE_PASSWORD: 'browser-test-workspace-password', SESSION_SECRET: 'typing-fixture-session-32-characters',
      ENCRYPTION_KEY: 'typing-fixture-encryption-32-characters', REQUIRE_PERSISTENT_DATA: '0' },
  },
});
