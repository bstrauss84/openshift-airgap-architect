/**
 * DOC-101 Phase 1: POST /api/operators/confirm v3 canonical fields test
 *
 * Verifies that the /api/operators/confirm endpoint returns v3 canonical fields
 * (locked, _schemaVersion, selectedMinor, selectedPatch) instead of legacy v2
 * fields (versionConfirmed only).
 *
 * This test was created to prevent regression of the bug where the backend
 * returned v2 fields and frontend lost the v3 locked state during lock/confirm.
 *
 * Root cause: Backend endpoint built a NEW version object without preserving
 * v3 fields. Frontend's lockAndProceed overwrites version with backend response,
 * losing the locked field and breaking navigation.
 *
 * Critical requirement: Backend MUST return v3 canonical schema so frontend
 * can overwrite safely.
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create unique isolated test environment
const TEST_DATA_DIR = `/tmp/airgap-backend-test-operators-confirm-${Date.now()}-${process.pid}`;
const TEST_DB_PATH = path.join(TEST_DATA_DIR, "airgap-architect.db");

let testServer = null;
let baseUrl = null;
let originalDataDir = null;

// Helper to create test server (follows pattern from api-state-migration-boundary.test.js)
async function createTestServer() {
  originalDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = TEST_DATA_DIR;
  process.env.NODE_ENV = 'test';
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });

  const { app } = await import("../src/index.js");

  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

// Helper to query database directly
function getStateFromDatabase() {
  const db = new Database(TEST_DB_PATH);
  try {
    const row = db.prepare("SELECT state_json FROM app_state WHERE id = 'singleton'").get();
    return row ? JSON.parse(row.state_json) : null;
  } finally {
    db.close();
  }
}

// Helper to POST to endpoint
async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  return {
    status: response.status,
    ok: response.ok,
    body: response.ok ? await response.json() : await response.text()
  };
}

// Helper to GET state from API
async function getState() {
  const response = await fetch(`${baseUrl}/api/state`);
  return response.json();
}

describe('POST /api/operators/confirm v3 canonical fields', () => {
  before(async () => {
    const result = await createTestServer();
    testServer = result.server;
    baseUrl = result.baseUrl;
  });

  test('Returns v3 canonical fields for 4.20 release', async () => {
    // Set initial state with 4.20 release
    await postJson('/api/state', {
      blueprint: { platform: "Bare Metal", arch: "x86_64", confirmed: false },
      release: { channel: "4.20", patchVersion: "4.20.0", confirmed: false }
    });

    // Call /api/operators/confirm
    const confirmResult = await postJson('/api/operators/confirm', {});

    // Verify HTTP 200
    assert.equal(confirmResult.status, 200, 'Should return HTTP 200');
    assert.equal(confirmResult.ok, true, 'Should be successful');

    // Verify response structure
    assert.ok(confirmResult.body.ok, 'Response should have ok: true');
    assert.ok(confirmResult.body.version, 'Response should have version object');

    const version = confirmResult.body.version;

    // Verify v3 canonical fields
    assert.equal(version._schemaVersion, 3, 'Should return _schemaVersion: 3');
    assert.equal(version.locked, true, 'Should return locked: true');
    assert.equal(version.selectedMinor, "4.20", 'Should return selectedMinor: "4.20"');
    assert.equal(version.selectedPatch, "4.20.0", 'Should return selectedPatch: "4.20.0"');

    // Verify other expected fields
    assert.equal(version.selectedChannel, "stable-4.20", 'Should return selectedChannel: "stable-4.20"');
    assert.equal(version.selectedVersion, "4.20.0", 'Should return selectedVersion: "4.20.0"');
    assert.equal(version.confirmedByUser, true, 'Should return confirmedByUser: true');
    assert.ok(version.selectionTimestamp, 'Should have selectionTimestamp');
    assert.ok(version.confirmationTimestamp, 'Should have confirmationTimestamp');

    // Verify release.confirmed is set
    assert.ok(confirmResult.body.release, 'Response should have release object');
    assert.equal(confirmResult.body.release.confirmed, true, 'Release should be confirmed');
  });

  test('Persists v3 canonical fields to database for 4.20', async () => {
    // Set initial state with 4.20 release
    await postJson('/api/state', {
      blueprint: { platform: "Bare Metal", arch: "x86_64", confirmed: false },
      release: { channel: "4.20", patchVersion: "4.20.0", confirmed: false }
    });

    // Call /api/operators/confirm
    await postJson('/api/operators/confirm', {});

    // Verify persisted state via API
    const apiState = await getState();
    assert.equal(apiState.version._schemaVersion, 3, 'API state should have _schemaVersion: 3');
    assert.equal(apiState.version.locked, true, 'API state should have locked: true');
    assert.equal(apiState.version.selectedMinor, "4.20", 'API state should have selectedMinor');
    assert.equal(apiState.version.selectedPatch, "4.20.0", 'API state should have selectedPatch');
    assert.equal(apiState.release.confirmed, true, 'API state should have release.confirmed: true');

    // Verify persisted state via direct database query
    const dbState = getStateFromDatabase();
    assert.equal(dbState.version._schemaVersion, 3, 'DB state should have _schemaVersion: 3');
    assert.equal(dbState.version.locked, true, 'DB state should have locked: true');
    assert.equal(dbState.version.selectedMinor, "4.20", 'DB state should have selectedMinor');
    assert.equal(dbState.release.confirmed, true, 'DB state should have release.confirmed: true');
  });

  test('Returns v3 canonical fields for 4.21 release', async () => {
    // Set initial state with 4.21 release
    await postJson('/api/state', {
      blueprint: { platform: "Bare Metal", arch: "x86_64", confirmed: false },
      release: { channel: "4.21", patchVersion: "4.21.20", confirmed: false }
    });

    // Call /api/operators/confirm
    const confirmResult = await postJson('/api/operators/confirm', {});

    // Verify HTTP 200
    assert.equal(confirmResult.status, 200, 'Should return HTTP 200');

    const version = confirmResult.body.version;

    // Verify v3 canonical fields for 4.21
    assert.equal(version._schemaVersion, 3, 'Should return _schemaVersion: 3');
    assert.equal(version.locked, true, 'Should return locked: true');
    assert.equal(version.selectedMinor, "4.21", 'Should return selectedMinor: "4.21"');
    assert.equal(version.selectedPatch, "4.21.20", 'Should return selectedPatch: "4.21.20"');
    assert.equal(version.selectedChannel, "stable-4.21", 'Should return selectedChannel: "stable-4.21"');
    assert.equal(version.selectedVersion, "4.21.20", 'Should return selectedVersion: "4.21.20"');
  });

  test('Does NOT set blueprint.confirmed (frontend responsibility)', async () => {
    // Set initial state with blueprint.confirmed: false
    await postJson('/api/state', {
      blueprint: { platform: "Bare Metal", arch: "x86_64", confirmed: false },
      release: { channel: "4.20", patchVersion: "4.20.0", confirmed: false }
    });

    // Call /api/operators/confirm
    await postJson('/api/operators/confirm', {});

    // Verify blueprint.confirmed is still false (backend does not set it)
    const state = await getState();
    assert.equal(state.blueprint.confirmed, false, 'Backend should NOT set blueprint.confirmed');
    assert.equal(state.release.confirmed, true, 'Backend DOES set release.confirmed');
    assert.equal(state.version.locked, true, 'Backend DOES set version.locked');

    // This proves that App.jsx lockAndProceed() must set blueprint.confirmed separately
  });

  test('Preserves existing _schemaVersion if already v3', async () => {
    // Set initial state that is already v3
    await postJson('/api/state', {
      blueprint: { platform: "Bare Metal", arch: "x86_64", confirmed: false },
      version: { _schemaVersion: 3, selectedMinor: "4.20", locked: false },
      release: { channel: "4.20", patchVersion: "4.20.0", confirmed: false }
    });

    // Call /api/operators/confirm
    const confirmResult = await postJson('/api/operators/confirm', {});

    // Verify _schemaVersion is still 3
    assert.equal(confirmResult.body.version._schemaVersion, 3, 'Should preserve _schemaVersion: 3');
    assert.equal(confirmResult.body.version.locked, true, 'Should update locked to true');
  });

  test('Combined frontend+backend lock flow results in valid v3 state', async () => {
    // Set initial state
    await postJson('/api/state', {
      blueprint: { platform: "Bare Metal", arch: "x86_64", confirmed: false },
      release: { channel: "4.20", patchVersion: "4.20.0", confirmed: false }
    });

    // Step 1: Backend confirms operators (simulates API call from lockAndProceed)
    const confirmResult = await postJson('/api/operators/confirm', {});

    // Step 2: Frontend applies the response (simulates App.jsx lockAndProceed updateState)
    await postJson('/api/state', {
      blueprint: { platform: "Bare Metal", arch: "x86_64", confirmed: true, confirmationTimestamp: Date.now() },
      release: confirmResult.body.release,
      version: confirmResult.body.version
    });

    // Verify final state satisfies foundationalLocked check
    const finalState = await getState();

    // App.jsx foundationalLocked check requires:
    // 1. blueprint.confirmed === true
    // 2. getVersionLocked(state) === true (checks version.locked or version.versionConfirmed)
    assert.equal(finalState.blueprint.confirmed, true, 'blueprint.confirmed should be true');
    assert.equal(finalState.version.locked, true, 'version.locked should be true');
    assert.equal(finalState.version._schemaVersion, 3, 'version._schemaVersion should be 3');

    // Simulate getVersionLocked() check (v3 canonical field takes precedence)
    const versionLocked = Boolean(
      finalState.version?.locked !== undefined
        ? finalState.version.locked
        : finalState.version?.versionConfirmed
    );
    assert.equal(versionLocked, true, 'getVersionLocked() should return true');

    // Simulate foundationalLocked check from App.jsx
    const foundationalLocked = Boolean(finalState.blueprint?.confirmed && versionLocked);
    assert.equal(foundationalLocked, true, 'foundationalLocked should be true (navigation allowed)');
  });

  after(async () => {
    // Clean up test server and data
    if (testServer) {
      testServer.close();
    }

    // Restore original DATA_DIR
    if (originalDataDir !== null) {
      process.env.DATA_DIR = originalDataDir;
    } else {
      delete process.env.DATA_DIR;
    }

    // Clean up test data directory
    if (fs.existsSync(TEST_DATA_DIR)) {
      fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
  });
});
