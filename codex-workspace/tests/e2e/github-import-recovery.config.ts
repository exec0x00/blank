import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'github-import-recovery.spec.ts',
  workers: 1, retries: 0, timeout: 30_000, expect: { timeout: 8_000 },
  outputDir: '/tmp/codex-github-import-recovery-proof',
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
