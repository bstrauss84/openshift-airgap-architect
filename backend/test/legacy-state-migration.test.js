/**
 * Legacy State Migration Tests (DOC-101 Phase 1 Slice 5 Cleanup)
 *
 * Tests migration of legacy/v2-ish state shapes to v3.
 * Ensures all historical field names and channel formats are handled correctly.
 *
 * Legacy Shapes Tested:
 * - release.channel: "stable-4.20" → version.selectedMinor: "4.20"
 * - release.channel: "4.20" → version.selectedMinor: "4.20"
 * - version.versionConfirmed → version.locked
 * - release.confirmed → version.locked
 * - Mixed v1/v2 hybrid states
 */

import assert from "node:assert";
import { test } from "node:test";
import { migrateStateToV3 } from "../../shared/stateMigration.js";

test("Legacy State Migration: Channel Normalization", async (t) => {
  /**
   * Test 1: release.channel: "stable-4.20" normalizes to selectedMinor: "4.20"
   */
  await t.test('v1 state with channel "stable-4.20" normalizes to "4.20"', () => {
    const v1State = {
      runId: "legacy-stable",
      release: { channel: "stable-4.20", patchVersion: "4.20.8", confirmed: true },
      blueprint: {},
      operators: { selected: [] }
    };

    const result = migrateStateToV3(v1State);
    assert.strictEqual(result.error, null);
    assert.strictEqual(result.wasV1, true);
    assert.strictEqual(result.migrated.version.selectedMinor, "4.20", "Should strip 'stable-' prefix");
    assert.strictEqual(result.migrated.version.selectedChannel, "stable-4.20");
  });

  /**
   * Test 2: release.channel: "4.20" stays as "4.20"
   */
  await t.test('v1 state with channel "4.20" stays as "4.20"', () => {
    const v1State = {
      runId: "legacy-plain",
      release: { channel: "4.20", patchVersion: "4.20.8", confirmed: true },
      blueprint: {},
      operators: { selected: [] }
    };

    const result = migrateStateToV3(v1State);
    assert.strictEqual(result.error, null);
    assert.strictEqual(result.migrated.version.selectedMinor, "4.20");
    assert.strictEqual(result.migrated.version.selectedChannel, "stable-4.20");
  });

  /**
   * Test 3: v2 state with release.channel: "stable-4.20"
   */
  await t.test('v2 state with channel "stable-4.20" normalizes correctly', () => {
    const v2State = {
      runId: "legacy-v2-stable",
      version: { versionConfirmed: true }, // v2 legacy field
      release: { channel: "stable-4.20", patchVersion: "4.20.8", confirmed: true },
      blueprint: {},
      operators: { selected: [] }
    };

    const result = migrateStateToV3(v2State);
    assert.strictEqual(result.error, null);
    assert.strictEqual(result.wasV2, true);
    assert.strictEqual(result.migrated.version.selectedMinor, "4.20", "Should strip 'stable-' from channel");
    assert.strictEqual(result.migrated.version.locked, true, "Should migrate versionConfirmed to locked");
  });

  /**
   * Test 4: Other channel prefixes (fast-, candidate-, eus-)
   */
  await t.test("handles fast-, candidate-, eus- channel prefixes", () => {
    const testCases = [
      { channel: "fast-4.21", expected: "4.21" },
      { channel: "candidate-4.22", expected: "4.22" },
      { channel: "eus-4.18", expected: "4.18" }
    ];

    testCases.forEach(({ channel, expected }) => {
      const state = {
        runId: `test-${channel}`,
        release: { channel, confirmed: true },
        blueprint: {}
      };

      const result = migrateStateToV3(state);
      assert.strictEqual(result.migrated.version.selectedMinor, expected, `Channel ${channel} should normalize to ${expected}`);
    });
  });
});

test("Legacy State Migration: Version Confirmation Fields", async (t) => {
  /**
   * Test 5: version.versionConfirmed → version.locked
   */
  await t.test("v2 state with versionConfirmed migrates to locked", () => {
    const v2State = {
      runId: "legacy-confirmed",
      version: { versionConfirmed: true, selectedMinor: "4.20" },
      release: { channel: "4.20", patchVersion: "4.20.8" },
      blueprint: {}
    };

    const result = migrateStateToV3(v2State);
    assert.strictEqual(result.error, null);
    assert.strictEqual(result.wasV2, true);
    assert.strictEqual(result.migrated.version.locked, true, "versionConfirmed should map to locked");
    assert.strictEqual(result.migrated.version._schemaVersion, 3);
  });

  /**
   * Test 6: release.confirmed → version.locked (v1 state)
   */
  await t.test("v1 state with release.confirmed migrates to locked", () => {
    const v1State = {
      runId: "legacy-release-confirmed",
      release: { channel: "4.20", patchVersion: "4.20.8", confirmed: true },
      blueprint: {}
    };

    const result = migrateStateToV3(v1State);
    assert.strictEqual(result.error, null);
    assert.strictEqual(result.wasV1, true);
    assert.strictEqual(result.migrated.version.locked, true);
  });

  /**
   * Test 7: Priority order - version.locked > version.versionConfirmed > release.confirmed
   */
  await t.test("locked field priority order is correct", () => {
    // Case 1: version.locked takes precedence
    const state1 = {
      runId: "priority-1",
      version: { locked: false, versionConfirmed: true },
      release: { channel: "4.20", confirmed: true }
    };
    const result1 = migrateStateToV3(state1);
    assert.strictEqual(result1.migrated.version.locked, false, "version.locked should take precedence");

    // Case 2: version.versionConfirmed takes precedence over release.confirmed
    const state2 = {
      runId: "priority-2",
      version: { versionConfirmed: false },
      release: { channel: "4.20", confirmed: true }
    };
    const result2 = migrateStateToV3(state2);
    assert.strictEqual(result2.migrated.version.locked, false, "version.versionConfirmed should take precedence over release.confirmed");

    // Case 3: release.confirmed used when no version confirmation fields
    const state3 = {
      runId: "priority-3",
      version: {},
      release: { channel: "4.20", confirmed: true }
    };
    const result3 = migrateStateToV3(state3);
    assert.strictEqual(result3.migrated.version.locked, true, "release.confirmed should be used as fallback");
  });
});

test("Legacy State Migration: Real-World oc-mirror Test State", async (t) => {
  /**
   * Test 8: The exact state shape from the failing oc-mirror test
   */
  await t.test("oc-mirror test legacy state migrates correctly", () => {
    const ocMirrorLegacyState = {
      version: { versionConfirmed: true },
      release: { channel: "stable-4.20", patchVersion: "4.20.0", confirmed: true }
    };

    const result = migrateStateToV3(ocMirrorLegacyState);

    // Should succeed
    assert.strictEqual(result.error, null, "Migration should succeed");
    assert.strictEqual(result.wasV2, true, "Should detect as v2 state");

    // Verify normalized output
    const v3State = result.migrated;
    assert.strictEqual(v3State.version._schemaVersion, 3);
    assert.strictEqual(v3State.version.selectedMinor, "4.20", "Should strip 'stable-' from channel");
    assert.strictEqual(v3State.version.selectedPatch, "4.20.0");
    assert.strictEqual(v3State.version.selectedChannel, "stable-4.20");
    assert.strictEqual(v3State.version.locked, true, "Should normalize versionConfirmed to locked");
    assert.strictEqual(v3State.version.confirmedByUser, true);

    // Verify release object synced
    assert.strictEqual(v3State.release.channel, "4.20", "Synced release.channel should be minor version only");
    assert.strictEqual(v3State.release.patchVersion, "4.20.0");
    assert.strictEqual(v3State.release.confirmed, true);
  });

  /**
   * Test 9: v1 state with stable-4.20 channel
   */
  await t.test("v1 state with stable- prefix migrates for generation", () => {
    const v1StableState = {
      runId: "gen-v1-stable",
      release: { channel: "stable-4.20", patchVersion: "4.20.15", confirmed: true },
      blueprint: { clusterName: "prod", baseDomain: "example.com" },
      methodology: { method: "Agent-Based Installer" },
      globalStrategy: {},
      hostInventory: {},
      operators: { selected: [] }
    };

    const result = migrateStateToV3(v1StableState);
    assert.strictEqual(result.error, null);
    assert.strictEqual(result.wasV1, true);
    assert.strictEqual(result.migrated.version.selectedMinor, "4.20");
    assert.strictEqual(result.migrated.version.locked, true);
  });
});

test("Legacy State Migration: Edge Cases", async (t) => {
  /**
   * Test 10: Empty/missing channel defaults to 4.20
   */
  await t.test("empty channel defaults to 4.20", () => {
    const state = {
      runId: "empty-channel",
      release: { channel: "", confirmed: true },
      blueprint: {}
    };

    const result = migrateStateToV3(state);
    assert.strictEqual(result.migrated.version.selectedMinor, "4.20", "Empty channel should default to 4.20");
  });

  /**
   * Test 11: Null channel defaults to 4.20
   */
  await t.test("null channel defaults to 4.20", () => {
    const state = {
      runId: "null-channel",
      release: { channel: null, confirmed: true },
      blueprint: {}
    };

    const result = migrateStateToV3(state);
    assert.strictEqual(result.migrated.version.selectedMinor, "4.20");
  });

  /**
   * Test 12: Channel without prefix stays unchanged
   */
  await t.test("channel without prefix stays unchanged", () => {
    const state = {
      runId: "no-prefix",
      release: { channel: "4.21", confirmed: true },
      blueprint: {}
    };

    const result = migrateStateToV3(state);
    assert.strictEqual(result.migrated.version.selectedMinor, "4.21");
  });
});
