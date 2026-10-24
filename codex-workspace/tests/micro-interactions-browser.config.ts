import { defineConfig, devices } from '@playwright/test';
import { browserLaunchOptions } from './browser-launch';

export default defineConfig({
  testDir: '.', testMatch: 'micro-interactions-browser.spec.ts', workers: 1, retries: 0,
  timeout: 30_000, expect: { timeout: 8_000 }, reporter: [['list']],
  outputDir: '/tmp/arc-interaction-proof',
  use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 },
    launchOptions: browserLaunchOptions(), screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
