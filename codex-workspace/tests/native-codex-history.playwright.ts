import { defineConfig } from '@playwright/test';
import { browserLaunchOptions } from './browser-launch';

export default defineConfig({
  testDir: '.', testMatch: 'native-codex-history.spec.ts', workers: 1, retries: 0, timeout: 30000, expect: { timeout: 7000 }, reporter: 'list',
  use: { browserName: 'chromium', launchOptions: browserLaunchOptions(), viewport: { width: 1000, height: 850 }, reducedMotion: 'reduce',
    trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
