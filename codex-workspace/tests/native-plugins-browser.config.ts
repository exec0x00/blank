import { defineConfig } from 'vitest/config';

// Explicit browser proof; regular unit tests never require a browser install.
export default defineConfig({ test: { include: ['tests/native-plugins-ui.spec.tsx'], pool: 'forks', maxWorkers: 1, minWorkers: 1, testTimeout: 20_000, hookTimeout: 20_000 } });
