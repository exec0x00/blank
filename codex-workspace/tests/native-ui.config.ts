import { defineConfig } from 'vitest/config';

/** Reproducible component browser checks, separate from browser-free units. */
export default defineConfig({
  test: {
    include: ['tests/native-plugins-ui.spec.tsx', 'tests/native-files-search-browser.spec.ts', 'tests/native-mcp-ui.test.ts'],
    env: { CODEX_MCP_BROWSER_TEST: '1' },
    pool: 'forks', maxWorkers: 1, minWorkers: 1,
    testTimeout: 45_000, hookTimeout: 30_000,
  },
});
