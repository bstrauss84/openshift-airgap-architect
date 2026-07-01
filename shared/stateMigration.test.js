/**
 * State Migration System Tests (DOC-101 Phase 1 Slice 3)
 *
 * Tests state schema migration from v1/v2 to v3.
 *
 * @module shared/stateMigration.test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  migrateStateToV3,
  isStateV3,
  createDefaultV3State,
  syncReleaseFromVersion
} from './stateMigration.js';

describe('stateMigration', () => {
  describe('isStateV3', () => {
    test('returns true for v3 state', () => {
      const v3State = { version: { _schemaVersion: 3, selectedMinor: '4.20' } };
      assert.strictEqual(isStateV3(v3State), true);
    });

    test('returns false for v2 state', () => {
      const v2State = { version: { selectedMinor: '4.20' }, release: { channel: '4.20' } };
      assert.strictEqual(isStateV3(v2State), false);
    });

    test('returns false for v1 state', () => {
      const v1State = { release: { channel: '4.20', confirmed: false } };
      assert.strictEqual(isStateV3(v1State), false);
    });

    test('returns false for null/undefined', () => {
      assert.strictEqual(isStateV3(null), false);
      assert.strictEqual(isStateV3(undefined), false);
    });
  });

  describe('createDefaultV3State', () => {
    test('creates minimal valid v3 state', () => {
      const defaultState = createDefaultV3State();

      assert.strictEqual(defaultState.version._schemaVersion, 3);
      assert.strictEqual(defaultState.version.selectedMinor, '4.20');
      assert.strictEqual(defaultState.version.locked, false);
      assert.strictEqual(defaultState.release.channel, '4.20');
    });

    test('is recognized as v3', () => {
      const defaultState = createDefaultV3State();
      assert.strictEqual(isStateV3(defaultState), true);
    });
  });

  describe('migrateStateToV3 - v3 input (normalized clone)', () => {
    test('v3 state returns normalized clone (safe for downstream mutation)', () => {
      const v3State = {
        version: {
          selectedMinor: '4.21',
          locked: true,
          _schemaVersion: 3
        },
        release: { channel: '4.21', confirmed: true }
      };

      const result = migrateStateToV3(v3State);

      assert.strictEqual(result.wasV3, true);
      assert.strictEqual(result.wasV2, false);
      assert.strictEqual(result.wasV1, false);
      assert.strictEqual(result.error, null);

      // Returns CLONE, not same reference (safe for mutation)
      assert.notStrictEqual(result.migrated, v3State);

      // But values are equal
      assert.deepStrictEqual(result.migrated, v3State);

      // Mutating result does not affect original
      result.migrated.version.selectedMinor = '4.22';
      assert.strictEqual(v3State.version.selectedMinor, '4.21'); // Original unchanged
    });
  });

  describe('migrateStateToV3 - v1 → v3', () => {
    test('migrates v1 state (release only) to v3', () => {
      const v1State = {
        release: {
          channel: '4.20',
          patchVersion: '4.20.15',
          confirmed: true,
          followLatestMinor: false
        }
      };

      const result = migrateStateToV3(v1State);

      assert.strictEqual(result.wasV1, true);
      assert.strictEqual(result.wasV2, false);
      assert.strictEqual(result.wasV3, false);
      assert.strictEqual(result.error, null);

      // Check v3 version object created
      assert.strictEqual(result.migrated.version._schemaVersion, 3);
      assert.strictEqual(result.migrated.version.selectedMinor, '4.20');
      assert.strictEqual(result.migrated.version.selectedPatch, '4.20.15');
      assert.strictEqual(result.migrated.version.locked, true);
      assert.strictEqual(result.migrated.version._migratedFrom, 'v1');

      // Check release kept for backward compat
      assert.strictEqual(result.migrated.release.channel, '4.20');
      assert.strictEqual(result.migrated.release.confirmed, true);
    });

    test('migrates v1 with unconfirmed version', () => {
      const v1State = {
        release: {
          channel: '4.21',
          confirmed: false
        }
      };

      const result = migrateStateToV3(v1State);

      assert.strictEqual(result.migrated.version.selectedMinor, '4.21');
      assert.strictEqual(result.migrated.version.locked, false);
      // v3 schema uses locked, not confirmedByUser (legacy field)
      assert.strictEqual(result.migrated.version.confirmedByUser, undefined);
    });

    test('defaults to 4.20 if release.channel missing', () => {
      const v1State = {
        release: {}
      };

      const result = migrateStateToV3(v1State);

      assert.strictEqual(result.migrated.version.selectedMinor, '4.20');
      assert.strictEqual(result.migrated.version.selectedChannel, 'stable-4.20');
    });
  });

  describe('migrateStateToV3 - v2 → v3', () => {
    test('migrates v2 state (release + version dual schema) to v3', () => {
      const v2State = {
        release: {
          channel: '4.20',
          confirmed: true
        },
        version: {
          selectedMinor: '4.21', // Different from release (version wins)
          selectedChannel: 'stable-4.21',
          locked: true
        }
      };

      const result = migrateStateToV3(v2State);

      assert.strictEqual(result.wasV2, true);
      assert.strictEqual(result.wasV1, false);
      assert.strictEqual(result.wasV3, false);
      assert.strictEqual(result.error, null);

      // Version object values take precedence
      assert.strictEqual(result.migrated.version._schemaVersion, 3);
      assert.strictEqual(result.migrated.version.selectedMinor, '4.21');
      assert.strictEqual(result.migrated.version.locked, true);
      assert.strictEqual(result.migrated.version._migratedFrom, 'v2');

      // Release synced from version
      assert.strictEqual(result.migrated.release.channel, '4.21');
      assert.strictEqual(result.migrated.release.confirmed, true);
    });

    test('migrates v2 with partial version object', () => {
      const v2State = {
        release: {
          channel: '4.20',
          patchVersion: '4.20.10',
          confirmed: false
        },
        version: {
          selectedChannel: 'fast-4.20'
          // Missing selectedMinor, locked, etc.
        }
      };

      const result = migrateStateToV3(v2State);

      // Falls back to release values when version fields missing
      assert.strictEqual(result.migrated.version.selectedMinor, '4.20');
      assert.strictEqual(result.migrated.version.selectedPatch, '4.20.10');
      assert.strictEqual(result.migrated.version.locked, false);
      assert.strictEqual(result.migrated.version.selectedChannel, 'fast-4.20');
    });

    test('stores previous version object for audit trail', () => {
      const v2State = {
        release: { channel: '4.20' },
        version: { selectedMinor: '4.20', custom: 'field' }
      };

      const result = migrateStateToV3(v2State);

      assert.ok(result.migrated.version._previousVersionObject);
      assert.strictEqual(result.migrated.version._previousVersionObject.custom, 'field');
    });
  });

  describe('migrateStateToV3 - error handling', () => {
    test('blocks null state with error', () => {
      const result = migrateStateToV3(null);

      assert.strictEqual(result.migrated, null);
      assert.ok(result.error);
      assert.match(result.error, /State must be a non-null object/);
    });

    test('blocks undefined state with error', () => {
      const result = migrateStateToV3(undefined);

      assert.strictEqual(result.migrated, null);
      assert.ok(result.error);
    });

    test('blocks unknown schema with error (no silent fallback)', () => {
      const unknownState = {
        // No release, no version
        someOtherField: 'value'
      };

      const result = migrateStateToV3(unknownState);

      assert.strictEqual(result.migrated, null);
      assert.ok(result.error);
      assert.match(result.error, /Unknown state schema version/);
      assert.strictEqual(result.wasV1, false);
      assert.strictEqual(result.wasV2, false);
      assert.strictEqual(result.wasV3, false);
    });

    test('blocks state with version but unknown schema version', () => {
      const unknownState = {
        version: {
          _schemaVersion: 99, // Future schema
          selectedMinor: '4.25'
        }
      };

      const result = migrateStateToV3(unknownState);

      assert.strictEqual(result.migrated, null);
      assert.ok(result.error);
      assert.match(result.error, /Unknown state schema version/);
    });
  });

  describe('syncReleaseFromVersion', () => {
    test('syncs release from v3 version object', () => {
      const v3State = {
        version: {
          selectedMinor: '4.21',
          selectedPatch: '4.21.5',
          locked: true,
          _schemaVersion: 3
        },
        release: {
          channel: '4.20', // Out of sync
          patchVersion: null,
          confirmed: false
        }
      };

      const synced = syncReleaseFromVersion(v3State);

      assert.strictEqual(synced.release.channel, '4.21');
      assert.strictEqual(synced.release.patchVersion, '4.21.5');
      assert.strictEqual(synced.release.confirmed, true);
    });

    test('throws on non-v3 state', () => {
      const v2State = {
        version: { selectedMinor: '4.20' }, // No _schemaVersion
        release: { channel: '4.20' }
      };

      assert.throws(() => {
        syncReleaseFromVersion(v2State);
      }, /requires v3 state/);
    });
  });

  describe('migration idempotence', () => {
    test('migrating v3 state multiple times produces same result', () => {
      const v3State = createDefaultV3State();

      const result1 = migrateStateToV3(v3State);
      const result2 = migrateStateToV3(result1.migrated);
      const result3 = migrateStateToV3(result2.migrated);

      assert.strictEqual(result1.wasV3, true);
      assert.strictEqual(result2.wasV3, true);
      assert.strictEqual(result3.wasV3, true);

      assert.deepStrictEqual(result1.migrated, result2.migrated);
      assert.deepStrictEqual(result2.migrated, result3.migrated);
    });

    test('migrating v1 then re-migrating v3 is stable', () => {
      const v1State = { release: { channel: '4.20', confirmed: true } };

      const result1 = migrateStateToV3(v1State);
      assert.strictEqual(result1.wasV1, true);

      const result2 = migrateStateToV3(result1.migrated);
      assert.strictEqual(result2.wasV3, true); // Now v3, no-op

      assert.deepStrictEqual(result1.migrated, result2.migrated);
    });
  });

  describe('real-world migration scenarios', () => {
    test('migrates typical v1 export (legacy app state)', () => {
      const v1Export = {
        runId: 'abc123',
        scenarioId: 'bare-metal-ipi',
        release: {
          channel: '4.20',
          patchVersion: '4.20.15',
          confirmed: true,
          confirmationTimestamp: 1717000000000
        },
        blueprint: { clusterName: 'test-cluster' }
      };

      const result = migrateStateToV3(v1Export);

      assert.strictEqual(result.wasV1, true);
      assert.strictEqual(result.migrated.version.selectedMinor, '4.20');
      assert.strictEqual(result.migrated.version.locked, true);
      assert.strictEqual(result.migrated.version.lockTimestamp, 1717000000000);

      // Preserves other state fields
      assert.strictEqual(result.migrated.runId, 'abc123');
      assert.strictEqual(result.migrated.scenarioId, 'bare-metal-ipi');
      assert.strictEqual(result.migrated.blueprint.clusterName, 'test-cluster');
    });

    test('migrates typical v2 export (dual schema inconsistency)', () => {
      const v2Export = {
        runId: 'def456',
        release: { channel: '4.20', confirmed: false },
        version: { selectedMinor: '4.21', locked: true }, // Inconsistent!
        blueprint: { clusterName: 'prod-cluster' }
      };

      const result = migrateStateToV3(v2Export);

      assert.strictEqual(result.wasV2, true);
      // version.selectedMinor takes precedence over release.channel
      assert.strictEqual(result.migrated.version.selectedMinor, '4.21');
      assert.strictEqual(result.migrated.version.locked, true);

      // Release synced from version
      assert.strictEqual(result.migrated.release.channel, '4.21');
      assert.strictEqual(result.migrated.release.confirmed, true);
    });
  });

  describe('v3 canonicalization edge cases', () => {
    test('v3 locked=false, no legacy fields -> remains locked=false', () => {
      const v3State = {
        version: {
          selectedMinor: '4.21',
          selectedPatch: '4.21.3',
          selectedChannel: 'stable-4.21',
          locked: false,
          _schemaVersion: 3
        },
        release: {
          channel: '4.21',
          patchVersion: '4.21.3',
          confirmed: false
        }
      };

      const result = migrateStateToV3(v3State);

      assert.strictEqual(result.wasV3, true);
      assert.strictEqual(result.migrated.version.locked, false);
      assert.strictEqual(result.migrated.release.confirmed, false);
    });

    test('v3 locked=true, no legacy fields -> remains locked=true', () => {
      const v3State = {
        version: {
          selectedMinor: '4.21',
          locked: true,
          _schemaVersion: 3
        },
        release: {
          channel: '4.21',
          confirmed: true
        }
      };

      const result = migrateStateToV3(v3State);

      assert.strictEqual(result.wasV3, true);
      assert.strictEqual(result.migrated.version.locked, true);
      assert.strictEqual(result.migrated.release.confirmed, true);
    });

    test('v3 locked=false + versionConfirmed=true -> locked=true, versionConfirmed removed', () => {
      const v3State = {
        version: {
          selectedMinor: '4.21',
          locked: false,
          versionConfirmed: true,  // Legacy field in v3 state (from patch)
          _schemaVersion: 3
        },
        release: {
          channel: '4.21',
          confirmed: false
        }
      };

      const result = migrateStateToV3(v3State);

      assert.strictEqual(result.wasV3, true);
      assert.strictEqual(result.migrated.version.locked, true);
      assert.strictEqual(result.migrated.version.versionConfirmed, undefined);
      assert.strictEqual(result.migrated.release.confirmed, true);
    });

    test('v3 locked=false + confirmedByUser=true -> locked=true, confirmedByUser removed', () => {
      const v3State = {
        version: {
          selectedMinor: '4.21',
          locked: false,
          confirmedByUser: true,  // Legacy field
          _schemaVersion: 3
        },
        release: {
          channel: '4.21',
          confirmed: false
        }
      };

      const result = migrateStateToV3(v3State);

      assert.strictEqual(result.wasV3, true);
      assert.strictEqual(result.migrated.version.locked, true);
      assert.strictEqual(result.migrated.version.confirmedByUser, undefined);
      assert.strictEqual(result.migrated.release.confirmed, true);
    });

    test('v3 locked=false + release.confirmed=true with NO version legacy fields -> does NOT relock', () => {
      // This is the critical case: stale release.confirmed should not override canonical locked
      // when there are no version-level legacy fields to suggest a patch
      const v3State = {
        version: {
          selectedMinor: '4.21',
          locked: false,
          _schemaVersion: 3
        },
        release: {
          channel: '4.21',
          confirmed: true  // Stale from previous state, not from a patch
        }
      };

      const result = migrateStateToV3(v3State);

      assert.strictEqual(result.wasV3, true);
      // locked should remain false - release.confirmed alone without version legacy fields
      // indicates stale state, not a fresh confirmation patch
      assert.strictEqual(result.migrated.version.locked, false);
      // release.confirmed gets synced FROM version.locked (canonical)
      assert.strictEqual(result.migrated.release.confirmed, false);
    });

    test('v3 locked=true + release.confirmed=false -> locked remains true', () => {
      const v3State = {
        version: {
          selectedMinor: '4.21',
          locked: true,
          _schemaVersion: 3
        },
        release: {
          channel: '4.21',
          confirmed: false  // Stale/inconsistent
        }
      };

      const result = migrateStateToV3(v3State);

      assert.strictEqual(result.wasV3, true);
      assert.strictEqual(result.migrated.version.locked, true);
      // release.confirmed gets synced FROM version.locked
      assert.strictEqual(result.migrated.release.confirmed, true);
    });

    test('v3 locked=true + patch version.locked=false -> locked becomes false', () => {
      // User explicitly unlocking
      const v3State = {
        version: {
          selectedMinor: '4.21',
          locked: false,  // Explicitly set to false in patch
          _schemaVersion: 3
        },
        release: {
          channel: '4.21',
          confirmed: true
        }
      };

      const result = migrateStateToV3(v3State);

      assert.strictEqual(result.wasV3, true);
      assert.strictEqual(result.migrated.version.locked, false);
      assert.strictEqual(result.migrated.release.confirmed, false);
    });
  });
});
