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
const TEST_DATA_DIR = `/tmp/airgap-backend-test-${Date.now()}-${process.pid}`;
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
