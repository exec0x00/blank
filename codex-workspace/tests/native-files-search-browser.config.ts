import { defineConfig } from 'vitest/config';

/** Browser dependencies belong to this explicit focused check, not the Node unit suite. */
export default defineConfig({
  test: {
    include: ['tests/native-files-search-browser.spec.ts'],
    pool: 'forks', minWorkers: 1, maxWorkers: 1,
    testTimeout: 45_000, hookTimeout: 20_000,
  },
});
