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

  // Maximum time one test can run
  timeout: 90 * 1000, // 90 seconds (some workflows involve state save/load)

  // Retry failed tests once in CI
  retries: process.env.CI ? 1 : 0,

  // Run tests in parallel
  workers: process.env.CI ? 2 : undefined,

  // Reporter
  reporter: process.env.CI ? 'github' : 'list',

  // Shared settings for all tests
  use: {
    // Base URL for navigation
    baseURL: 'http://localhost:5173',

    // Browser context options
    viewport: { width: 1280, height: 720 },

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure
    video: 'retain-on-failure',

    // Trace on first retry
    trace: 'on-first-retry',
  },

  // Configure projects for different browsers
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    // Uncomment to test in Firefox and WebKit
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  // Web server configuration (optional - for CI)
  // In local dev, assume frontend/backend are already running via docker compose
  webServer: process.env.CI ? {
    command: 'echo "E2E tests require frontend at :5173 and backend at :4000"',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 5 * 1000,
  } : undefined,
});
