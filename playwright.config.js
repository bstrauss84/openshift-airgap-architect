/**
 * Playwright E2E Test Configuration
 *
 * End-to-end tests for critical user workflows:
 * - Wizard completion (blueprint → generate → export)
 * - Import/export run
 * - Background job tracking
 *
 * Prerequisites: an ISOLATED backend and frontend (never the owner's normal app):
 *   E2E_FRONTEND_URL=http://127.0.0.1:<port> E2E_BACKEND_URL=http://127.0.0.1:<port> npm run test:e2e
 */

import { defineConfig, devices } from '@playwright/test';

/*
 * FAIL CLOSED: E2E runs only against an explicitly selected, isolated
 * environment. Every spec resets application state (POST /api/start-over), and
 * the previous hardcoded defaults (frontend :5173, backend :4000) are exactly
 * the owner's normal Compose app — a plain `npm run test:e2e` could wipe it.
 *
 * Required: E2E_FRONTEND_URL and E2E_BACKEND_URL. Ports 5173 and 4000 are
 * refused unless OAA_E2E_ALLOW_PROTECTED_PORTS=1 states that the app on them is
 * a disposable test instance (e.g. an ephemeral CI container).
 */
const PROTECTED_PORTS = new Set(['4000', '5173']);
function resolveE2ETarget(env = process.env) {
  const frontend = env.E2E_FRONTEND_URL;
  const backend = env.E2E_BACKEND_URL || env.OAA_BROWSER_BACKEND_URL;
  if (!frontend || !backend) {
    throw new Error(
      'E2E refused: set E2E_FRONTEND_URL and E2E_BACKEND_URL to an isolated test environment. ' +
      'There is deliberately no default, because the specs reset application state.'
    );
  }
  for (const [name, value] of [['E2E_FRONTEND_URL', frontend], ['E2E_BACKEND_URL', backend]]) {
    let url;
    try { url = new URL(value); } catch { throw new Error(`E2E refused: ${name} is not a URL: ${value}`); }
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    if (PROTECTED_PORTS.has(port) && env.OAA_E2E_ALLOW_PROTECTED_PORTS !== '1') {
      throw new Error(
        `E2E refused: ${name} uses port ${port}, the owner's normal application port. ` +
        'Point E2E at an isolated environment, or set OAA_E2E_ALLOW_PROTECTED_PORTS=1 only for a disposable instance.'
      );
    }
  }
  return { frontend, backend };
}
const target = resolveE2ETarget();
// Workers inherit the runner's environment; helpers and specs read these and
// have no fallback of their own.
process.env.E2E_FRONTEND_URL = target.frontend;
process.env.E2E_BACKEND_URL = target.backend;
process.env.OAA_BROWSER_BACKEND_URL = process.env.OAA_BROWSER_BACKEND_URL || target.backend;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js',

  globalSetup: './e2e/global-setup.mjs',

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
    baseURL: target.frontend,
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
    command: 'echo "E2E tests require the isolated frontend/backend selected by E2E_FRONTEND_URL/E2E_BACKEND_URL"',
    url: target.frontend,
    reuseExistingServer: true,
    timeout: 5 * 1000,
  } : undefined,
});
