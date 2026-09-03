/**
 * DOC-101 Phase 1: POST /api/state migration boundary validation tests
 *
 * Hermetic test that imports Express app directly and creates isolated test server.
 * Uses unique DATA_DIR per test run to isolate database state.
 * Critical requirement: Unknown/future schemas must NOT pollute the database.
 *
 * Tests:
 * 1. Unknown/future schema (999) returns 400 and does NOT persist
 * 2. v2 state with versionConfirmed migrates to v3 with locked
 * 3. v3 state persists correctly
 * 4. After rejected schema, subsequent GET returns previous valid state
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { closeTestServer } from "./helpers/httpServerLifecycle.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create unique isolated test environment
const TEST_DATA_DIR = path.join(
  process.env.TMPDIR || process.env.OAA_SUPERVISOR_SCRATCH || '/tmp',
  `airgap-backend-test-${Date.now()}-${process.pid}`
);
const TEST_DB_PATH = path.join(TEST_DATA_DIR, "airgap-architect.db");

let testServer = null;
let baseUrl = null;
let originalDataDir = null;

// Helper to create test server (follows existing pattern from client-state-http.test.js)
async function createTestServer() {
  // Temporarily set DATA_DIR and NODE_ENV for this test
  originalDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = TEST_DATA_DIR;
  process.env.NODE_ENV = 'test';  // Prevent default server from starting
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });

  // Import app AFTER setting DATA_DIR and NODE_ENV so it uses test configuration
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

// Helper to POST state to API
async function postState(stateData) {
  const response = await fetch(`${baseUrl}/api/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(stateData)
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

// Helper to reset state via API
async function resetState() {
  const response = await fetch(`${baseUrl}/api/start-over`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  return response.json();
}

describe('POST /api/state migration boundary validation', () => {
  before(async () => {
    // Create isolated test server
    const result = await createTestServer();
    testServer = result.server;
    baseUrl = result.baseUrl;
  });

  test('Unknown schema (999) returns 400 and does NOT persist', async () => {
    // Get current valid state as baseline
    const initialState = await getState();
    const initialSchema = initialState.version?._schemaVersion;
    const initialClusterName = initialState.blueprint?.clusterName;

    // Attempt to POST future schema 999
    const futureState = {
      version: {
        _schemaVersion: 999,
        selectedMinor: "4.20",
        selectedPatch: "4.20.1"
      },
      blueprint: {
        clusterName: "test-schema-999-should-fail"
      }
    };

    const postResult = await postState(futureState);

    // Verify POST was rejected
    assert.equal(postResult.status, 400, 'Should return HTTP 400 for unknown schema');
    assert.equal(postResult.ok, false, 'Should not be successful');

    // CRITICAL: Verify database was NOT polluted
    const afterRejection = await getState();
    const afterSchema = afterRejection.version?._schemaVersion;
    const afterClusterName = afterRejection.blueprint?.clusterName;

    assert.notEqual(afterSchema, 999, 'Database should NOT contain schema 999');
    assert.equal(afterSchema, initialSchema, 'Schema should remain unchanged');
    assert.notEqual(afterClusterName, "test-schema-999-should-fail", 'Cluster name should NOT be from rejected state');
    assert.equal(afterClusterName, initialClusterName, 'Cluster name should remain unchanged');

    // Double-check by querying database directly
    const dbState = getStateFromDatabase();
    assert.notEqual(dbState?.version?._schemaVersion, 999, 'Database should NOT contain schema 999 (direct query)');
  });

  test('v2 state with versionConfirmed migrates to v3 with locked', async () => {
    // Reset to clean state
    await resetState();

    // POST v2-style state (no _schemaVersion, has versionConfirmed)
    // v2 uses selectedMinor + selectedPatch, not selectedVersion
    const v2State = {
      version: {
        selectedMinor: "4.20",
        selectedPatch: "4.20.1",
        versionConfirmed: true  // v2 field
      },
      blueprint: {
        clusterName: "test-v2-migration"
      }
    };

    const postResult = await postState(v2State);

    // Verify POST succeeded
    assert.equal(postResult.status, 200, 'Should accept v2 state');
    assert.equal(postResult.ok, true, 'Should be successful');

    // Verify migration to v3
    const migratedState = await getState();
    assert.equal(migratedState.version?._schemaVersion, 3, 'Should migrate to schema v3');
    assert.equal(migratedState.version?.locked, true, 'Should migrate versionConfirmed → locked');
    assert.equal(migratedState.version?.selectedMinor, "4.20", 'Should preserve selectedMinor');
    assert.equal(migratedState.version?.selectedPatch, "4.20.1", 'Should preserve selectedPatch');
    assert.equal(migratedState.blueprint?.clusterName, "test-v2-migration", 'Should preserve clusterName');

    // Verify database persisted v3, not v2
    const dbState = getStateFromDatabase();
    assert.equal(dbState?.version?._schemaVersion, 3, 'Database should contain v3 schema');
    assert.equal(dbState?.version?.locked, true, 'Database should have locked field');
  });

  test('v3 state with locked=true persists correctly', async () => {
    // Reset to clean state
    await resetState();

    // POST v3 state
    const v3State = {
      version: {
        _schemaVersion: 3,
        selectedMinor: "4.20",
        selectedPatch: "4.20.1",
        locked: true
      },
      blueprint: {
        clusterName: "test-v3-direct"
      }
    };

    const postResult = await postState(v3State);

    // Verify POST succeeded
    assert.equal(postResult.status, 200, 'Should accept v3 state');
    assert.equal(postResult.ok, true, 'Should be successful');

    // Verify v3 state persisted correctly
    const retrievedState = await getState();
    assert.equal(retrievedState.version?._schemaVersion, 3, 'Should preserve schema v3');
    assert.equal(retrievedState.version?.locked, true, 'Should preserve locked=true');
    assert.equal(retrievedState.version?.selectedMinor, "4.20", 'Should preserve selectedMinor');
  });

  test('v3 state with locked=false persists correctly', async () => {
    // Reset to clean state
    await resetState();

    // POST v3 state with locked=false
    const v3State = {
      version: {
        _schemaVersion: 3,
        selectedMinor: "4.20",
        locked: false
      },
      blueprint: {
        clusterName: "test-v3-unlocked"
      }
    };

    const postResult = await postState(v3State);

    // Verify POST succeeded
    assert.equal(postResult.status, 200, 'Should accept v3 state');

    // Verify locked=false persisted
    const retrievedState = await getState();
    assert.equal(retrievedState.version?.locked, false, 'Should preserve locked=false');
  });

  test('Multiple rejected schemas do not pollute database', async () => {
    // Reset to known good state
    await resetState();
    const initialState = await getState();

    // Attempt to POST multiple invalid schemas
    const invalidSchemas = [999, 1000, 42];

    for (const schema of invalidSchemas) {
      const badState = {
        version: {
          _schemaVersion: schema,
          selectedMinor: "4.20"
        },
        blueprint: {
          clusterName: `test-schema-${schema}`
        }
      };

      const postResult = await postState(badState);

      // Each should be rejected
      assert.equal(postResult.status, 400, `Schema ${schema} should be rejected`);

      // Database should remain unchanged
      const currentState = await getState();
      assert.notEqual(currentState.version?._schemaVersion, schema, `Database should NOT contain schema ${schema}`);
    }

    // Verify state is still the initial clean state
    const finalState = await getState();
    assert.equal(finalState.version?._schemaVersion, initialState.version?._schemaVersion, 'Schema should remain unchanged after multiple rejections');
  });

  test('Valid POST after rejected schema works correctly', async () => {
    // Reset to clean state
    await resetState();

    // First: Attempt invalid schema (should be rejected)
    const invalidState = {
      version: {
        _schemaVersion: 999,
        selectedMinor: "4.20"
      }
    };

    const rejectResult = await postState(invalidState);
    assert.equal(rejectResult.status, 400, 'Invalid schema should be rejected');

    // Second: POST valid v3 state (should succeed)
    const validState = {
      version: {
        _schemaVersion: 3,
        selectedMinor: "4.20",
        locked: true
      },
      blueprint: {
        clusterName: "test-after-rejection"
      }
    };

    const acceptResult = await postState(validState);
    assert.equal(acceptResult.status, 200, 'Valid state should be accepted after rejection');

    // Verify valid state was persisted
    const finalState = await getState();
    assert.equal(finalState.version?._schemaVersion, 3, 'Should have v3 schema');
    assert.equal(finalState.blueprint?.clusterName, "test-after-rejection", 'Should have valid cluster name');
  });

  // --- M02: Version-support persistence boundary tests ---

  test('M02: v3 locked 4.22 returns HTTP 422 UNSUPPORTED_VERSION', async () => {
    await resetState();

    const postResult = await postState({
      version: {
        _schemaVersion: 3,
        selectedMinor: '4.22',
        selectedPatch: '4.22.1',
        selectedChannel: 'stable-4.22',
        locked: true
      },
      release: {
        channel: '4.22',
        patchVersion: '4.22.1',
        confirmed: true
      }
    });

    assert.equal(postResult.status, 422,
      'POST /api/state must return HTTP 422 for unsupported 4.22');

    const body = typeof postResult.body === 'string'
      ? JSON.parse(postResult.body) : postResult.body;
    assert.equal(body.code, 'UNSUPPORTED_VERSION',
      'Response must include code: UNSUPPORTED_VERSION');
    assert.equal(body.requestedVersion, '4.22',
      'Response must include requestedVersion: 4.22');
    assert.ok(Array.isArray(body.supportedVersions),
      'Response must include supportedVersions array');
    assert.ok(
      body.supportedVersions.includes('4.20') && body.supportedVersions.includes('4.21'),
      'supportedVersions must include 4.20 and 4.21');
    assert.equal(body.supportedVersions.length, 2,
      'supportedVersions must contain exactly 2 entries');
  });

  test('M02: v1 legacy state resolving to 4.22 is rejected with HTTP 422', async () => {
    await resetState();

    // Seed a valid 4.20 state WITHOUT version.selectedMinor so the v1 patch's
    // release.channel is the effective minor source after deep merge.
    // Minor resolves via precedence fallback: release.channel → '4.20'.
    const seedResult = await postState({
      version: {
        _schemaVersion: 3,
        selectedPatch: '4.20.17',
        locked: true
      },
      release: { channel: '4.20', patchVersion: '4.20.17', confirmed: true },
      blueprint: { clusterName: 'v1-legacy-survivor' }
    });
    assert.equal(seedResult.status, 200, 'Seeding 4.20 must succeed');

    // Confirm seed resolved to supported 4.20
    const seedState = await getState();
    assert.equal(seedState.release.channel, '4.20',
      'Seed must resolve to 4.20 via release.channel');

    // Submit v1 legacy patch (release-only, no version object) that resolves to 4.22
    const postResult = await postState({
      release: {
        channel: 'stable-4.22',
        patchVersion: '4.22.3',
        confirmed: true
      }
    });

    assert.equal(postResult.status, 422,
      'POST /api/state must return HTTP 422 for v1-legacy 4.22');

    const body = typeof postResult.body === 'string'
      ? JSON.parse(postResult.body) : postResult.body;
    assert.equal(body.code, 'UNSUPPORTED_VERSION');
    assert.equal(body.requestedVersion, '4.22');
    assert.ok(Array.isArray(body.supportedVersions),
      'Response must include supportedVersions array');
    assert.ok(
      body.supportedVersions.includes('4.20') && body.supportedVersions.includes('4.21'),
      'supportedVersions must include 4.20 and 4.21');
    assert.equal(body.supportedVersions.length, 2,
      'supportedVersions must contain exactly 2 entries');

    // Verify prior state survived via GET
    const afterState = await getState();
    assert.equal(afterState.release.channel, '4.20',
      'release.channel must remain 4.20 after v1-legacy 4.22 rejection');
    assert.equal(afterState.version.selectedPatch, '4.20.17',
      'Patch must remain 4.20.17');
    assert.equal(afterState.blueprint.clusterName, 'v1-legacy-survivor',
      'Distinguishing clusterName must survive rejection');

    // Verify via direct database
    const dbState = getStateFromDatabase();
    assert.equal(dbState.release.channel, '4.20',
      'Database release.channel must remain 4.20 after v1-legacy 4.22 rejection');
    assert.equal(dbState.version.selectedPatch, '4.20.17',
      'Database patch must remain 4.20.17');
  });

  test('M02: v2 legacy state resolving to 4.22 is rejected with HTTP 422', async () => {
    await resetState();

    // Seed a distinguishable valid 4.21 state first
    const seedResult = await postState({
      version: {
        _schemaVersion: 3,
        selectedMinor: '4.21',
        selectedPatch: '4.21.12',
        locked: true
      },
      release: { channel: '4.21', patchVersion: '4.21.12', confirmed: true },
      blueprint: { clusterName: 'v2-legacy-survivor' }
    });
    assert.equal(seedResult.status, 200, 'Seeding 4.21 must succeed');

    // Submit v2 legacy state that resolves to 4.22
    const postResult = await postState({
      release: {
        channel: '4.22',
        patchVersion: '4.22.2',
        confirmed: false
      },
      version: {
        selectedMinor: '4.22',
        selectedPatch: '4.22.2'
      }
    });

    assert.equal(postResult.status, 422,
      'POST /api/state must return HTTP 422 for v2-legacy 4.22');

    const body = typeof postResult.body === 'string'
      ? JSON.parse(postResult.body) : postResult.body;
    assert.equal(body.code, 'UNSUPPORTED_VERSION');
    assert.equal(body.requestedVersion, '4.22');
    assert.ok(Array.isArray(body.supportedVersions),
      'Response must include supportedVersions array');
    assert.ok(
      body.supportedVersions.includes('4.20') && body.supportedVersions.includes('4.21'),
      'supportedVersions must include 4.20 and 4.21');
    assert.equal(body.supportedVersions.length, 2,
      'supportedVersions must contain exactly 2 entries');

    // Verify prior state survived via GET
    const afterState = await getState();
    assert.equal(afterState.version.selectedMinor, '4.21',
      'State must remain 4.21 after v2-legacy 4.22 rejection');
    assert.equal(afterState.version.selectedPatch, '4.21.12',
      'Patch must remain 4.21.12');
    assert.equal(afterState.blueprint.clusterName, 'v2-legacy-survivor',
      'Distinguishing clusterName must survive rejection');

    // Verify via direct database
    const dbState = getStateFromDatabase();
    assert.equal(dbState.version.selectedMinor, '4.21',
      'Database must remain 4.21 after v2-legacy 4.22 rejection');
    assert.equal(dbState.version.selectedPatch, '4.21.12',
      'Database patch must remain 4.21.12');
  });

  test('M02: prior valid 4.21 state survives 4.22 rejection (GET + database)', async () => {
    await resetState();

    // Seed valid 4.21 state
    const seedResult = await postState({
      version: {
        _schemaVersion: 3,
        selectedMinor: '4.21',
        selectedPatch: '4.21.5',
        locked: true
      },
      release: { channel: '4.21', patchVersion: '4.21.5', confirmed: true }
    });
    assert.equal(seedResult.status, 200, 'Seeding 4.21 must succeed');

    // Capture state before rejection
    const before = await getState();
    assert.equal(before.version.selectedMinor, '4.21');

    // Attempt 4.22 — must be rejected
    const rejectResult = await postState({
      version: {
        _schemaVersion: 3,
        selectedMinor: '4.22',
        selectedPatch: '4.22.1',
        locked: true
      }
    });
    assert.equal(rejectResult.status, 422, '4.22 must be rejected');

    // Verify via GET
    const afterState = await getState();
    assert.equal(afterState.version.selectedMinor, '4.21',
      'State must remain 4.21 after 4.22 rejection');
    assert.equal(afterState.version.selectedPatch, '4.21.5',
      'Patch must remain 4.21.5');

    // Verify via direct database
    const dbState = getStateFromDatabase();
    assert.equal(dbState.version.selectedMinor, '4.21',
      'Database must remain 4.21 after 4.22 rejection');
  });

  test('M02: supported 4.20 write succeeds', async () => {
    await resetState();

    const postResult = await postState({
      version: {
        _schemaVersion: 3,
        selectedMinor: '4.20',
        selectedPatch: '4.20.8',
        locked: true
      },
      release: { channel: '4.20', patchVersion: '4.20.8', confirmed: true }
    });

    assert.equal(postResult.status, 200,
      'POST /api/state must return 200 for supported 4.20');
    assert.equal(postResult.body.version.selectedMinor, '4.20');
  });

  test('M02: supported 4.21 write succeeds', async () => {
    await resetState();

    const postResult = await postState({
      version: {
        _schemaVersion: 3,
        selectedMinor: '4.21',
        selectedPatch: '4.21.5',
        locked: true
      },
      release: { channel: '4.21', patchVersion: '4.21.5', confirmed: true }
    });

    assert.equal(postResult.status, 200,
      'POST /api/state must return 200 for supported 4.21');
    assert.equal(postResult.body.version.selectedMinor, '4.21');
  });

  test('M02: 4.21 write succeeds after rejected 4.22 attempt', async () => {
    await resetState();

    // Attempt 4.22 — must be rejected
    const rejectResult = await postState({
      version: {
        _schemaVersion: 3,
        selectedMinor: '4.22',
        selectedPatch: '4.22.1',
        locked: true
      }
    });
    assert.equal(rejectResult.status, 422, '4.22 must be rejected');

    // Follow with valid 4.21 — must succeed
    const acceptResult = await postState({
      version: {
        _schemaVersion: 3,
        selectedMinor: '4.21',
        selectedPatch: '4.21.5',
        locked: true
      },
      release: { channel: '4.21', patchVersion: '4.21.5', confirmed: true }
    });
    assert.equal(acceptResult.status, 200,
      'POST /api/state must accept 4.21 after 4.22 rejection');
    assert.equal(acceptResult.body.version.selectedMinor, '4.21');

    // Verify persisted
    const state = await getState();
    assert.equal(state.version.selectedMinor, '4.21');
  });

  test('M02: rejected 4.22 is not normalized or persisted as 4.21 or 4.20', async () => {
    await resetState();

    // Seed known-good 4.20
    const seedResult = await postState({
      version: {
        _schemaVersion: 3,
        selectedMinor: '4.20',
        selectedPatch: '4.20.8',
        locked: true
      },
      release: { channel: '4.20', patchVersion: '4.20.8', confirmed: true }
    });
    assert.equal(seedResult.status, 200, 'Seeding 4.20 must succeed');

    // Attempt 4.22
    const rejectResult = await postState({
      version: {
        _schemaVersion: 3,
        selectedMinor: '4.22',
        selectedPatch: '4.22.1',
        locked: true
      }
    });
    assert.equal(rejectResult.status, 422, '4.22 must be rejected');

    // Verify state is still 4.20 — no silent normalization
    const dbState = getStateFromDatabase();
    assert.equal(dbState.version.selectedMinor, '4.20',
      'State must remain 4.20 — no silent normalization of 4.22');
    assert.ok(dbState.version.selectedMinor !== '4.22',
      '4.22 must never be persisted');
    assert.ok(dbState.version.selectedMinor !== '4.21',
      '4.22 must not be silently normalized to 4.21');
  });

  after(async () => {
    // Clean up test server and data
    if (testServer) {
      await closeTestServer(testServer);
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
