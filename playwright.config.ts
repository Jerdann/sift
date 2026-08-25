import { defineConfig } from '@playwright/test';

export default defineConfig({
  expect: { timeout: 20_000 },
  forbidOnly: true,
  fullyParallel: false,
  outputDir: 'test-results',
  reporter: [['list']],
  retries: 0,
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 1,
});
