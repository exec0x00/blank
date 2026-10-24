import { defineConfig, devices } from '@playwright/test';
import { browserLaunchOptions } from '../browser-launch';

// The real browser and bounded catalog hook against an independent HTTP fixture.
export default defineConfig({
  testDir: '.', testMatch: 'conversation-navigation.spec.ts', workers: 1, retries: 0,
  timeout: 45_000, expect: { timeout: 10_000 },
  outputDir: '/tmp/codex-conversation-navigation-proof', reporter: [['list']],
  use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 960 }, screenshot: 'only-on-failure',
    trace: 'retain-on-failure', launchOptions: browserLaunchOptions() },
});
