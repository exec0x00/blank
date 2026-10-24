import { defineConfig, devices } from '@playwright/test';
import { browserLaunchOptions } from '../browser-launch';

// Isolated component proofs need no application server, login, or provider.
export default defineConfig({
  testDir: '.',
  testMatch: 'tool-results.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  outputDir: '/tmp/codex-response-ui-proof',
  reporter: [['list'], ['html', { open: 'never', outputFolder: '/tmp/codex-response-ui-report' }]],
  use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 960 }, screenshot: 'only-on-failure', trace: 'retain-on-failure', launchOptions: { ...browserLaunchOptions(), ignoreDefaultArgs: ['--hide-scrollbars'] } },
});
