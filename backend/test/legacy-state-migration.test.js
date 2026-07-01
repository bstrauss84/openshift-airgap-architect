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
   * Test 7: Locked field precedence (OR-based priority)
   *
   * Correct priority: ANY confirmation field === true sets locked: true
   * This matches v3 canonicalization behavior and handles the case where
   * v2 default state has versionConfirmed: false but a patch has release.confirmed: true
   */
  await t.test("locked field precedence: ANY confirmation === true wins", () => {
    // Case 1: versionConfirmed:true sets locked:true (even if locked not present)
    const state1 = {
      runId: "priority-1",
      version: { versionConfirmed: true },
      release: { channel: "4.20", confirmed: false }
    };
    const result1 = migrateStateToV3(state1);
    assert.strictEqual(result1.migrated.version.locked, true, "versionConfirmed:true should set locked:true");
    assert.strictEqual(result1.wasV2, true, "Should be detected as v2 migration");

    // Case 2: locked:true overrides versionConfirmed:false
    const state2 = {
      runId: "priority-2",
      version: { locked: true, versionConfirmed: false },
      release: { channel: "4.20", confirmed: false }
    };
    const result2 = migrateStateToV3(state2);
    assert.strictEqual(result2.migrated.version.locked, true, "Explicit locked:true should override versionConfirmed:false");

    // Case 3: versionConfirmed takes precedence when no locked field
    const state3 = {
      runId: "priority-3",
      version: { versionConfirmed: true },
      release: { channel: "4.20", confirmed: false }
    };
    const result3 = migrateStateToV3(state3);
    assert.strictEqual(result3.migrated.version.locked, true, "versionConfirmed should be used when locked not present");

    // Case 4: release.confirmed used when no version fields
    const state4 = {
      runId: "priority-4",
      version: {},
      release: { channel: "4.20", confirmed: true }
    };
    const result4 = migrateStateToV3(state4);
    assert.strictEqual(result4.migrated.version.locked, true, "release.confirmed should be used as fallback");

    // Case 5: all missing defaults to false
    const state5 = {
      runId: "priority-5",
      version: {},
      release: { channel: "4.20" }
    };
    const result5 = migrateStateToV3(state5);
    assert.strictEqual(result5.migrated.version.locked, false, "Should default to false when all confirmation fields missing");
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
    // v3 schema uses locked, not confirmedByUser (legacy field)
    assert.strictEqual(v3State.version.confirmedByUser, undefined);

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

test("Legacy State Migration: Malformed Channel Rejection", async (t) => {
  /**
   * Test 13: Reject "latest" channel
   */
  await t.test('rejects channel "latest"', () => {
    const state = {
      runId: "malformed-latest",
      release: { channel: "latest", confirmed: true },
      blueprint: {}
    };

    const result = migrateStateToV3(state);
    assert.strictEqual(result.error !== null, true, "Should return error for 'latest' channel");
    assert.ok(result.error.includes("Invalid channel format"), "Error should mention invalid format");
    assert.strictEqual(result.migrated, null, "Should not migrate malformed channel");
  });

  /**
   * Test 14: Reject "stable-mars" channel
   */
  await t.test('rejects channel "stable-mars"', () => {
    const state = {
      runId: "malformed-mars",
      release: { channel: "stable-mars", confirmed: true }
    };

    const result = migrateStateToV3(state);
    assert.strictEqual(result.error !== null, true, "Should return error for 'stable-mars' channel");
    assert.ok(result.error.includes("Invalid channel format"));
  });

  /**
   * Test 15: Reject "4.x" channel
   */
  await t.test('rejects channel "4.x"', () => {
    const state = {
      runId: "malformed-x",
      release: { channel: "4.x", confirmed: true }
    };

    const result = migrateStateToV3(state);
    assert.strictEqual(result.error !== null, true, "Should return error for '4.x' channel");
  });

  /**
   * Test 16: Reject patch version in channel "4.20.15"
   */
  await t.test('rejects channel "4.20.15"', () => {
    const state = {
      runId: "malformed-patch",
      release: { channel: "4.20.15", confirmed: true }
    };

    const result = migrateStateToV3(state);
    assert.strictEqual(result.error !== null, true, "Should return error for '4.20.15' channel");
    assert.ok(result.error.includes("Invalid channel format"));
  });

  /**
   * Test 17: Accept valid formats
   */
  await t.test("accepts valid channel formats", () => {
    const validChannels = ["4.20", "stable-4.20", "fast-4.21", "candidate-4.22", "eus-4.18"];

    validChannels.forEach(channel => {
      const state = {
        runId: `valid-${channel}`,
        release: { channel, confirmed: true }
      };

      const result = migrateStateToV3(state);
      assert.strictEqual(result.error, null, `Channel "${channel}" should be accepted`);
      assert.ok(result.migrated, `Channel "${channel}" should migrate successfully`);
    });
  });
});
