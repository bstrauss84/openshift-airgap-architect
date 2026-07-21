/**
 * Playwright E2E Test Configuration
 *
 * End-to-end tests for critical user workflows:
 * - Wizard completion (blueprint → generate → export)
 * - Import/export run
 * - Background job tracking
 *
 * Prerequisites:
 * - Backend running at http://localhost:4000
 * - Frontend running at http://localhost:5173
 *
 * Run with: npm run test:e2e
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js',

  globalSetup: './e2e/global-setup.js',

  timeout: 120 * 1000,

  retries: process.env.CI ? 1 : 0,

  // Single worker — tests share one backend state store
  workers: 1,
  fullyParallel: false,

  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'e2e-results/html-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'e2e-results/html-report' }]],

  outputDir: 'e2e-results/artifacts',

  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10_000,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: process.env.CI ? {
    command: 'echo "E2E tests require frontend at :5173 and backend at :4000"',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 5 * 1000,
  } : undefined,
});
