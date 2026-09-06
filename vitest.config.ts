import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: { enabled: false },
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    // These integration tests create real SQLite databases. Serialize them on
    // shared CI disks so concurrent migration/fsync work does not starve tests.
    maxWorkers: process.env.CI ? 1 : 4,
    passWithNoTests: true,
    restoreMocks: true,
    setupFiles: ['tests/setup.ts'],
    testTimeout: process.env.CI ? 30_000 : 15_000,
  },
});
