import { defineConfig } from '@playwright/test';

export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  outputDir: 'test-results',
  reporter: [['list']],
  retries: 0,
  testDir: 'tests/e2e',
  timeout: 30_000,
  workers: 1,
});
