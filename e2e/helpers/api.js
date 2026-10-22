/**
 * API interaction helpers for E2E tests.
 * Uses Playwright's APIRequestContext to communicate with the explicitly selected isolated backend.
 */

// Overridable for the same reason global-setup verifies backend identity
// (finding F4): a hardcoded URL silently pins the suite to whatever happens to
// be listening on 4000, which during Tranche 6 was a stale v2.0.0 container.
// No default: playwright.config.js refuses to run without an explicit isolated
// backend, so a missing value here is a configuration error, not "use :4000".
const BASE_URL = process.env.OAA_BROWSER_BACKEND_URL || process.env.E2E_BACKEND_URL;
if (!BASE_URL) {
  throw new Error('E2E backend not selected: set E2E_BACKEND_URL to an isolated test backend.');
}

/**
 * POST /api/start-over — reset all wizard state to defaults.
 * @param {import('@playwright/test').APIRequestContext} request
 * @returns {Promise<object>} response JSON
 */
export async function resetState(request) {
  const res = await request.post(`${BASE_URL}/api/start-over`);
  return res.json();
}

/**
 * POST /api/run/import — import a previously exported state snapshot.
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {object} stateObj — the wizard state to import
 * @returns {Promise<object>} response JSON
 */
export async function importState(request, stateObj) {
  const res = await request.post(`${BASE_URL}/api/run/import`, {
    data: { schemaVersion: 2, state: stateObj },
  });
  return res.json();
}

/**
 * POST /api/generate — generate install-config and related artifacts from the given state.
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {object} stateObj — the wizard state to generate from
 * @returns {Promise<{files: object}>} response with generated files
 */
export async function generateAssets(request, stateObj) {
  const res = await request.post(`${BASE_URL}/api/generate`, {
    data: { state: stateObj },
  });
  return res.json();
}

/**
 * GET /api/state — fetch the current wizard state from the backend.
 * @param {import('@playwright/test').APIRequestContext} request
 * @returns {Promise<object>} the current state object
 */
export async function getState(request) {
  const res = await request.get(`${BASE_URL}/api/state`);
  return res.json();
}

/**
 * POST /api/bundle.prepare — prepare a downloadable ZIP bundle.
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {object} [stateObj] — optional state override
 * @returns {Promise<{token: string, expiresAt: string}>}
 */
export async function prepareBundle(request, stateObj) {
  const data = stateObj ? { state: stateObj } : undefined;
  const res = await request.post(`${BASE_URL}/api/bundle.prepare`, { data });
  return res.json();
}

/**
 * Build the URL for downloading a prepared bundle ZIP.
 * @param {string} token — the bundle token from prepareBundle
 * @returns {string} full download URL
 */
export function getBundleUrl(token) {
  return `${BASE_URL}/api/bundle.zip?token=${token}`;
}

/**
 * Wait for the backend to become healthy by polling GET /api/health.
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {number} [retries=10] — max number of retries
 * @throws {Error} if the backend does not become healthy within the retry limit
 */
export async function waitForBackend(request, retries = 10) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await request.get(`${BASE_URL}/api/health`);
      if (res.ok()) return;
    } catch {
      // connection refused or network error — retry
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Backend at ${BASE_URL} did not become healthy after ${retries} retries`);
}
