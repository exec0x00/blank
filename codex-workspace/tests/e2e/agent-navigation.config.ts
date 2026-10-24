import { defineConfig, devices } from '@playwright/test';
import { browserLaunchOptions } from '../browser-launch';

// The real chat and navigation components with controlled authenticated DTOs.
// This proof never starts the CLI or sends requests to a model service.
export default defineConfig({
  testDir: '.', testMatch: 'codex-cli-chat.spec.ts', workers: 1, retries: 0,
  timeout: 60_000, expect: { timeout: 12_000 },
  outputDir: '/tmp/codex-agent-navigation-proof',
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 960 }, screenshot: 'only-on-failure', trace: 'retain-on-failure', launchOptions: browserLaunchOptions() },
});
