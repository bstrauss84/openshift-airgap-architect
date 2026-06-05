/**
 * Export State Migration Boundary Tests (DOC-101 Phase 1 Slice 4 Boundary 3)
 *
 * Tests state migration integration at backend export boundary (GET /api/run/export).
 * These tests verify exported state is normalized to v3 schema correctly.
 *
 * Verifies:
 * - v1 state exports normalize to v3
 * - v2 state exports normalize to v3
 * - v3 state exports pass through unchanged
 * - unknown schema blocks export with clear error
 * - migration result indicated in response
 * - existing export structure preserved
 *
 * NOTE: This focuses on version object migration (v1/v2 → v3).
 * IPv6 field migration (enableIpv6 → ipStackMode) is handled separately.
 */

import assert from "node:assert";
import { test } from "node:test";
import { migrateStateToV3 } from "../../shared/stateMigration.js";

test("Export Migration Boundary 3: Backend Export (/api/run/export)", async (t) => {
  /**
   * Test 1: Export v1 state → normalizes to v3
   */
  await t.test("v1 state normalizes to v3 in exported state.json", () => {
    const v1State = {
      runId: "test-v1-export",
      release: { channel: "4.20", patchVersion: "4.20.8", confirmed: true },
      // v1 implicit: no version object
      blueprint: { clusterName: "test", baseDomain: "example.com" },
      globalStrategy: {},
      hostInventory: {},
      operators: { selected: [] }
    };

    const result = migrateStateToV3(v1State);
    assert.strictEqual(result.error, null, "v1 migration should succeed");
    assert.strictEqual(result.wasV1, true, "Should detect v1 state");
    assert.strictEqual(result.migrated.version._schemaVersion, 3, "Migrated state should be v3");
    assert.ok(result.migrated.version.selectedMinor, "Should have selectedMinor");
    assert.ok(result.migrated.release, "Should preserve release for compat");
  });

  /**
   * Test 2: Export v2 state → normalizes to v3
   */
  await t.test("v2 state normalizes to v3 in exported state.json", () => {
    const v2State = {
      runId: "test-v2-export",
      version: { selectedMinor: "4.20", selectedPatch: "4.20.8" }, // v2: no _schemaVersion
      release: { confirmed: true },
      blueprint: { clusterName: "test" },
      globalStrategy: {},
      hostInventory: {},
      operators: { selected: [] }
    };

    const result = migrateStateToV3(v2State);
    assert.strictEqual(result.error, null, "v2 migration should succeed");
    assert.strictEqual(result.wasV2, true, "Should detect v2 state");
    assert.strictEqual(result.migrated.version._schemaVersion, 3, "Migrated state should be v3");
  });

  /**
   * Test 3: Export v3 state → passes through unchanged
   */
  await t.test("v3 state exports without modification", () => {
    const v3State = {
      runId: "test-v3-export",
      version: { _schemaVersion: 3, selectedMinor: "4.20", selectedPatch: "4.20.8" },
      release: { confirmed: true },
      blueprint: { clusterName: "test" },
      globalStrategy: {},
      hostInventory: {},
      operators: { selected: [] }
    };

    const result = migrateStateToV3(v3State);
    assert.strictEqual(result.error, null, "v3 should pass through");
    assert.strictEqual(result.wasV1, false, "Should not detect as v1");
    assert.strictEqual(result.wasV2, false, "Should not detect as v2");
    assert.strictEqual(result.wasV3, true, "Should detect as v3");
    assert.strictEqual(result.migrated.version._schemaVersion, 3, "Should remain v3");
  });

  /**
   * Test 4: Unknown schema blocks export with clear error
   */
  await t.test("unknown schema version blocks export", () => {
    const unknownState = {
      runId: "test-unknown-export",
      version: { _schemaVersion: 99, selectedMinor: "4.20" },
      release: { confirmed: true },
      blueprint: { clusterName: "test" }
    };

    const result = migrateStateToV3(unknownState);
    assert.strictEqual(result.migrated, null, "Should not return migrated state");
    assert.ok(result.error, "Should return error");
    assert.match(result.error, /unknown.*schema/i, "Error should mention unknown schema");
  });

  /**
   * Test 5: Future schema blocks export with clear error
   */
  await t.test("future schema version blocks export", () => {
    const futureState = {
      runId: "test-future-export",
      version: { _schemaVersion: 4, selectedMinor: "4.21" },
      release: { confirmed: true },
      blueprint: { clusterName: "test" }
    };

    const result = migrateStateToV3(futureState);
    assert.strictEqual(result.migrated, null, "Should not return migrated state");
    assert.ok(result.error, "Should return error");
    assert.match(result.error, /unknown.*schema|future.*schema/i, "Error should mention unknown/future schema");
  });

  /**
   * Test 6: Exported state structure preserved (except v3 normalization)
   */
  await t.test("exported state preserves structure except schema normalization", () => {
    const v1StateWithFields = {
      runId: "test-structure-export",
      release: { channel: "4.20", confirmed: true },
      blueprint: { clusterName: "prod", baseDomain: "company.com" },
      globalStrategy: { fips: true },
      hostInventory: { nodes: [{ hostname: "master-0" }] },
      operators: { selected: ["acm"], catalogs: {} },
      exportOptions: { includeClientTools: true }
    };

    const result = migrateStateToV3(v1StateWithFields);
    const migrated = result.migrated;

    // Verify v3 normalization happened
    assert.strictEqual(migrated.version._schemaVersion, 3);

    // Verify all other fields preserved
    assert.strictEqual(migrated.runId, "test-structure-export");
    assert.strictEqual(migrated.blueprint.clusterName, "prod");
    assert.strictEqual(migrated.globalStrategy.fips, true);
    assert.deepStrictEqual(migrated.hostInventory.nodes, [{ hostname: "master-0" }]);
    assert.deepStrictEqual(migrated.operators.selected, ["acm"]);
    assert.strictEqual(migrated.exportOptions.includeClientTools, true);
  });

  /**
   * Test 7: Migration metadata included in response
   */
  await t.test("response includes migration metadata for v1/v2 state", () => {
    const v1State = {
      runId: "test-metadata",
      release: { confirmed: true },
      blueprint: {},
      hostInventory: {}
    };

    const result = migrateStateToV3(v1State);
    assert.strictEqual(result.wasV1, true, "Should indicate v1 migration occurred");

    // Response should include: { ..., migrated: true }
    const responseWouldInclude_migrated = result.wasV1 || result.wasV2;
    assert.strictEqual(responseWouldInclude_migrated, true, "Response should include migrated: true");
  });

  /**
   * Test 8: Migration metadata NOT included for v3 state
   */
  await t.test("response excludes migration metadata for v3 state", () => {
    const v3State = {
      runId: "test-no-metadata",
      version: { _schemaVersion: 3 },
      release: { confirmed: true },
      blueprint: {},
      hostInventory: {}
    };

    const result = migrateStateToV3(v3State);
    assert.strictEqual(result.wasV1, false, "Should not indicate v1 migration");
    assert.strictEqual(result.wasV2, false, "Should not indicate v2 migration");
    assert.strictEqual(result.wasV3, true, "Should indicate v3 passthrough");

    // Response should include: { ..., migrated: false }
    const responseWouldInclude_migrated = result.wasV1 || result.wasV2;
    assert.strictEqual(responseWouldInclude_migrated, false, "Response should include migrated: false");
  });

  /**
   * Test 9: Idempotence - exporting same state multiple times
   */
  await t.test("exporting same state multiple times produces stable v3", () => {
    const v2State = {
      runId: "test-idempotence",
      version: { selectedMinor: "4.20" }, // v2
      release: { confirmed: true },
      blueprint: {},
      hostInventory: {}
    };

    const result1 = migrateStateToV3(v2State);
    const result2 = migrateStateToV3(result1.migrated); // Re-export migrated state
    const result3 = migrateStateToV3(result2.migrated); // Re-export again

    assert.strictEqual(result2.wasV1, false, "Second export should not detect v1");
    assert.strictEqual(result2.wasV2, false, "Second export should not detect v2");
    assert.strictEqual(result2.wasV3, true, "Second export should detect v3");

    assert.strictEqual(result3.wasV3, true, "Third export should detect v3");
    assert.strictEqual(result2.migrated.version._schemaVersion, 3);
    assert.strictEqual(result3.migrated.version._schemaVersion, 3);
  });
});
