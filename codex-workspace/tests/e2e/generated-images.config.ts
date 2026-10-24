import { defineConfig, devices } from '@playwright/test';
import { browserLaunchOptions } from '../browser-launch';

// No application server or model requests are needed for these UI proofs.
export default defineConfig({
  testDir: '.', testMatch: 'generated-images.spec.ts', workers: 1, retries: 0,
  timeout: 30_000, expect: { timeout: 8_000 },
  outputDir: '/tmp/codex-generated-image-ui-proof',
  reporter: [['list'], ['html', { open: 'never', outputFolder: '/tmp/codex-generated-image-ui-report' }]],
  use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 960 }, screenshot: 'only-on-failure', trace: 'retain-on-failure',
    launchOptions: { ...browserLaunchOptions(), ignoreDefaultArgs: ['--disable-popup-blocking'] } },
});
