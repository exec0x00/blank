import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    pool: 'forks',
    maxWorkers: 2,
    minWorkers: 1,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    restoreMocks: true,
  },
});
