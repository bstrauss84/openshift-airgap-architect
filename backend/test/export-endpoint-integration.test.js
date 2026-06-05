/**
 * Export Endpoint Integration Tests (DOC-101 Phase 1 Slice 4 Boundary 3)
 *
 * Tests /api/run/export endpoint behavior by simulating handler logic.
 * Verifies response structure, migration metadata, sanitization, and error handling.
 *
 * NOTE: Cannot use supertest because server doesn't listen in NODE_ENV=test.
 * Instead, tests simulate the endpoint handler logic directly.
 *
 * These complement export-migration-boundary.test.js (pure migration logic)
 * by testing the integration of migration + sanitization.
 */

import assert from "node:assert";
import { test } from "node:test";
import fs from "node:fs";
import path from "path";
import { migrateStateToV3 } from "../../shared/stateMigration.js";

// Import sanitization function
const testDir = process.env.DATA_DIR || "/tmp/airgap-backend-test";
const stateFile = path.join(testDir, "state.json");

// Ensure test data directory exists
if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir, { recursive: true });
}

// Simulate sanitizeStateForExport (simplified for testing)
function simulateSanitizeStateForExport(state, options) {
  const clone = JSON.parse(JSON.stringify(state));

  // Remove ephemeral credentials (matches backend behavior)
  if (clone.blueprint) {
    delete clone.blueprint.blueprintPullSecretEphemeral;
    delete clone.blueprint.sshPrivateKeyEphemeral;
  }

  // includeCredentials: false means remove more fields
  if (!options.includeCredentials) {
    if (clone.trust) {
      delete clone.trust.mirrorRegistryCaPem;
    }
  }

  return clone;
}

// Simulate /api/run/export handler logic
function simulateExportEndpoint(state) {
  // Step 1: Migrate state to v3
  const stateMigrationResult = migrateStateToV3(state);

  // Step 2: Handle migration errors
  if (stateMigrationResult.error) {
    return {
      status: 400,
      body: {
        error: "Export failed: unknown or invalid state schema",
        details: [{
          path: "state._schemaVersion",
          message: stateMigrationResult.error
        }]
      }
    };
  }

  // Step 3: Use migrated v3 state
  const v3State = stateMigrationResult.migrated;

  // Step 4: Sanitize credentials AFTER migration
  const options = v3State.exportOptions || {};
  const sanitized = simulateSanitizeStateForExport(v3State, { ...options, includeCredentials: false });

  // Step 5: Return response
  return {
    status: 200,
    body: {
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      runId: v3State.runId,
      state: sanitized,
      migrated: stateMigrationResult.wasV1 || stateMigrationResult.wasV2
    }
  };
}

test("Export Endpoint Integration: /api/run/export", async (t) => {
  /**
   * Test 1: v1 state export returns v3 with migrated=true
   */
  await t.test("v1 state exports as v3 with migrated: true", () => {
    const v1State = {
      runId: "integration-v1-export",
      release: { channel: "4.20", patchVersion: "4.20.8", confirmed: true },
      // v1: no version object
      blueprint: {
        clusterName: "test-v1",
        baseDomain: "example.com",
        blueprintPullSecretEphemeral: "SHOULD_BE_SANITIZED" // Should NOT appear in export
      },
      globalStrategy: {},
      hostInventory: {},
      operators: { selected: [] },
      exportOptions: {}
    };

    const res = simulateExportEndpoint(v1State);

    assert.strictEqual(res.status, 200, "Should return 200 OK");
    assert.strictEqual(res.body.schemaVersion, 2, "Response schema version should be 2");
    assert.strictEqual(res.body.migrated, true, "Should indicate migration occurred");
    assert.strictEqual(res.body.runId, "integration-v1-export");

    // Verify exported state is v3
    assert.strictEqual(res.body.state.version._schemaVersion, 3, "Exported state should be v3");
    assert.ok(res.body.state.version.selectedMinor, "Should have selectedMinor");

    // Verify sanitization happened AFTER migration
    assert.strictEqual(
      res.body.state.blueprint?.blueprintPullSecretEphemeral,
      undefined,
      "Should sanitize ephemeral credentials"
    );

    // Verify exportedAt timestamp included
    assert.ok(res.body.exportedAt, "Should include exportedAt timestamp");
  });

  /**
   * Test 2: v2 state export returns v3 with migrated=true
   */
  await t.test("v2 state exports as v3 with migrated: true", () => {
    const v2State = {
      runId: "integration-v2-export",
      version: { selectedMinor: "4.20", selectedPatch: "4.20.8" }, // v2: no _schemaVersion
      release: { confirmed: true },
      blueprint: { clusterName: "test-v2" },
      globalStrategy: {},
      hostInventory: {},
      operators: { selected: [] },
      exportOptions: {}
    };

    const res = simulateExportEndpoint(v2State);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.migrated, true, "Should indicate v2 → v3 migration");
    assert.strictEqual(res.body.state.version._schemaVersion, 3);
  });

  /**
   * Test 3: v3 state export returns v3 with migrated=false
   */
  await t.test("v3 state exports unchanged with migrated: false", () => {
    const v3State = {
      runId: "integration-v3-export",
      version: { _schemaVersion: 3, selectedMinor: "4.20", selectedPatch: "4.20.8", locked: true },
      release: { confirmed: true },
      blueprint: { clusterName: "test-v3" },
      globalStrategy: {},
      hostInventory: {},
      operators: { selected: [] },
      exportOptions: {}
    };

    const res = simulateExportEndpoint(v3State);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.migrated, false, "Should NOT indicate migration (already v3)");
    assert.strictEqual(res.body.state.version._schemaVersion, 3);
  });

  /**
   * Test 4: Unknown schema returns 400 error with details
   */
  await t.test("unknown schema version returns 400 error", () => {
    const unknownState = {
      runId: "integration-unknown",
      version: { _schemaVersion: 99, selectedMinor: "4.20" },
      release: { confirmed: true },
      blueprint: { clusterName: "test" }
    };

    const res = simulateExportEndpoint(unknownState);

    assert.strictEqual(res.status, 400, "Should return 400 Bad Request");
    assert.ok(res.body.error, "Should include error message");
    assert.match(res.body.error, /unknown.*invalid.*schema/i, "Error should mention schema issue");
    assert.ok(res.body.details, "Should include error details array");
    assert.ok(res.body.details[0].path, "Should include error path");
    assert.ok(res.body.details[0].message, "Should include detailed error message");
  });

  /**
   * Test 5: Credentials are sanitized AFTER migration
   */
  await t.test("credentials are sanitized from exported state", () => {
    const stateWithCredentials = {
      runId: "integration-sanitize",
      version: { _schemaVersion: 3, selectedMinor: "4.20" },
      release: { confirmed: true },
      blueprint: {
        clusterName: "prod",
        blueprintPullSecretEphemeral: '{"auths":{"registry.redhat.io":{"auth":"SECRET"}}}',
        sshPublicKey: "ssh-rsa AAAAB3... user@host",
        sshPrivateKeyEphemeral: "-----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY-----"
      },
      trust: {
        mirrorRegistryCaPem: "-----BEGIN CERTIFICATE-----\nSECRET\n-----END CERTIFICATE-----"
      },
      globalStrategy: {},
      hostInventory: {},
      operators: { selected: [] },
      exportOptions: {}
    };

    const res = simulateExportEndpoint(stateWithCredentials);

    assert.strictEqual(res.status, 200);

    // Verify ephemeral credentials removed
    assert.strictEqual(
      res.body.state.blueprint?.blueprintPullSecretEphemeral,
      undefined,
      "Pull secret should be sanitized"
    );
    assert.strictEqual(
      res.body.state.blueprint?.sshPrivateKeyEphemeral,
      undefined,
      "SSH private key should be sanitized"
    );

    // Verify CA cert removed (includeCredentials: false)
    assert.strictEqual(
      res.body.state.trust?.mirrorRegistryCaPem,
      undefined,
      "CA certificate should be sanitized"
    );
  });

  /**
   * Test 6: Export preserves non-sensitive state fields
   */
  await t.test("export preserves non-sensitive state structure", () => {
    const fullState = {
      runId: "integration-preserve",
      version: { _schemaVersion: 3, selectedMinor: "4.20", locked: true },
      release: { confirmed: true },
      blueprint: {
        clusterName: "production",
        baseDomain: "example.com",
        platform: "Bare Metal"
      },
      methodology: { method: "Agent-Based Installer" },
      globalStrategy: { fips: true, proxyEnabled: false },
      hostInventory: {
        nodes: [
          { hostname: "master-0", role: "master" },
          { hostname: "worker-0", role: "worker" }
        ]
      },
      operators: {
        selected: ["advanced-cluster-management"],
        version: "4.20"
      },
      exportOptions: { includeClientTools: true }
    };

    const res = simulateExportEndpoint(fullState);

    assert.strictEqual(res.status, 200);

    const exported = res.body.state;
    assert.strictEqual(exported.blueprint.clusterName, "production");
    assert.strictEqual(exported.blueprint.baseDomain, "example.com");
    assert.strictEqual(exported.globalStrategy.fips, true);
    assert.strictEqual(exported.hostInventory.nodes.length, 2);
    assert.deepStrictEqual(exported.operators.selected, ["advanced-cluster-management"]);
  });
});
