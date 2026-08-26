import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: { enabled: false },
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    maxWorkers: 4,
    passWithNoTests: true,
    restoreMocks: true,
    setupFiles: ['tests/setup.ts'],
    testTimeout: 15_000,
  },
});
