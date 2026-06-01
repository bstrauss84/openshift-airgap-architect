/**
 * State Migration Boundary Tests (DOC-101 Phase 1 Slice 4 Boundary 1)
 *
 * Tests state migration integration at backend API boundaries.
 * These tests verify the migration helper logic without requiring full database setup.
 *
 * Verifies:
 * - v1/v2 state migrates to v3
 * - v3 state passes through unchanged (returns clone)
 * - Unknown schemas return error (no silent fallback)
 * - Migration preserves all state fields
 * - Migration is idempotent
 *
 * @module backend/test/state-migration-boundary
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { migrateStateToV3, isStateV3 } from '../../shared/stateMigration.js';

describe('State Migration Boundary 1: Backend API Integration', () => {
  describe('migrateStateToV3 - v1 state migration', () => {
    test('v1 state migrates to v3', () => {
      const v1State = {
        runId: 'test-v1',
        scenarioId: 'vsphere-ipi',
        release: {
          channel: '4.20',
          patchVersion: '4.20.10',
          confirmed: true
        },
        blueprint: { clusterName: 'test-cluster' }
      };

      const result = migrateStateToV3(v1State);

      assert.strictEqual(result.wasV1, true);
      assert.strictEqual(result.wasV2, false);
      assert.strictEqual(result.wasV3, false);
      assert.strictEqual(result.error, null);
      assert.strictEqual(result.migrated.version._schemaVersion, 3);
      assert.strictEqual(result.migrated.version.selectedMinor, '4.20');
      assert.strictEqual(result.migrated.version.selectedPatch, '4.20.10');
      assert.strictEqual(result.migrated.version.locked, true);
    });

    test('v1 with unconfirmed version', () => {
      const v1State = {
        release: {
          channel: '4.21',
          confirmed: false
        }
      };

      const result = migrateStateToV3(v1State);

      assert.strictEqual(result.wasV1, true);
      assert.strictEqual(result.migrated.version.selectedMinor, '4.21');
      assert.strictEqual(result.migrated.version.locked, false);
      assert.strictEqual(result.migrated.version.confirmedByUser, false);
    });

    test('v1 defaults to 4.20 if channel missing', () => {
      const v1State = {
        release: {}
      };

      const result = migrateStateToV3(v1State);

      assert.strictEqual(result.wasV1, true);
      assert.strictEqual(result.migrated.version.selectedMinor, '4.20');
      assert.strictEqual(result.migrated.version.selectedChannel, 'stable-4.20');
    });
  });

  describe('migrateStateToV3 - v2 state migration', () => {
    test('v2 state migrates to v3', () => {
      const v2State = {
        runId: 'test-v2',
        release: {
          channel: '4.20',
          confirmed: false
        },
        version: {
          selectedMinor: '4.21', // Inconsistent - version wins
          locked: true
        }
      };

      const result = migrateStateToV3(v2State);

      assert.strictEqual(result.wasV2, true);
      assert.strictEqual(result.wasV1, false);
      assert.strictEqual(result.wasV3, false);
      assert.strictEqual(result.error, null);
      assert.strictEqual(result.migrated.version._schemaVersion, 3);
      // version.selectedMinor takes precedence over release.channel
      assert.strictEqual(result.migrated.version.selectedMinor, '4.21');
      assert.strictEqual(result.migrated.version.locked, true);
    });

    test('v2 with partial version object', () => {
      const v2State = {
        release: {
          channel: '4.20',
          patchVersion: '4.20.10',
          confirmed: false
        },
        version: {
          selectedChannel: 'fast-4.20'
          // Missing selectedMinor, locked
        }
      };

      const result = migrateStateToV3(v2State);

      assert.strictEqual(result.wasV2, true);
      // Falls back to release values when version fields missing
      assert.strictEqual(result.migrated.version.selectedMinor, '4.20');
      assert.strictEqual(result.migrated.version.selectedPatch, '4.20.10');
      assert.strictEqual(result.migrated.version.locked, false);
      assert.strictEqual(result.migrated.version.selectedChannel, 'fast-4.20');
    });
  });

  describe('migrateStateToV3 - v3 state (no-op clone)', () => {
    test('v3 state returns clone (not same reference)', () => {
      const v3State = {
        runId: 'test-v3',
        version: {
          selectedMinor: '4.21',
          locked: false,
          _schemaVersion: 3
        },
        release: {
          channel: '4.21',
          confirmed: false
        }
      };

      const result = migrateStateToV3(v3State);

      assert.strictEqual(result.wasV3, true);
      assert.strictEqual(result.wasV1, false);
      assert.strictEqual(result.wasV2, false);
      assert.strictEqual(result.error, null);
      assert.strictEqual(result.migrated.version._schemaVersion, 3);

      // Returns CLONE, not same reference (safe for mutation)
      assert.notStrictEqual(result.migrated, v3State);

      // But values are equal
      assert.deepStrictEqual(result.migrated, v3State);

      // Mutating result does not affect original
      result.migrated.version.selectedMinor = '4.22';
      assert.strictEqual(v3State.version.selectedMinor, '4.21');
    });

    test('isStateV3 correctly identifies v3 state', () => {
      const v3State = {
        version: { _schemaVersion: 3, selectedMinor: '4.20' }
      };

      assert.strictEqual(isStateV3(v3State), true);
    });

    test('isStateV3 returns false for v2 state', () => {
      const v2State = {
        version: { selectedMinor: '4.20' }, // No _schemaVersion
        release: { channel: '4.20' }
      };

      assert.strictEqual(isStateV3(v2State), false);
    });

    test('isStateV3 returns false for v1 state', () => {
      const v1State = {
        release: { channel: '4.20' }
        // No version object
      };

      assert.strictEqual(isStateV3(v1State), false);
    });
  });

  describe('migrateStateToV3 - error handling', () => {
    test('unknown schema returns error (no silent fallback)', () => {
      const unknownState = {
        someUnknownField: 'value'
        // No release, no version
      };

      const result = migrateStateToV3(unknownState);

      assert.strictEqual(result.migrated, null);
      assert.ok(result.error);
      assert.match(result.error, /Unknown state schema version/);
      assert.strictEqual(result.wasV1, false);
      assert.strictEqual(result.wasV2, false);
      assert.strictEqual(result.wasV3, false);
    });

    test('null state returns error', () => {
      const result = migrateStateToV3(null);

      assert.strictEqual(result.migrated, null);
      assert.ok(result.error);
      assert.match(result.error, /State must be a non-null object/);
    });

    test('undefined state returns error', () => {
      const result = migrateStateToV3(undefined);

      assert.strictEqual(result.migrated, null);
      assert.ok(result.error);
    });

    test('state with unknown _schemaVersion returns error', () => {
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

  describe('Migration preserves state fields', () => {
    test('migration preserves blueprint data', () => {
      const v1State = {
        release: { channel: '4.21' },
        blueprint: {
          clusterName: 'prod-cluster',
          baseDomain: 'example.com'
        }
      };

      const result = migrateStateToV3(v1State);

      assert.strictEqual(result.error, null);
      assert.strictEqual(result.migrated.blueprint.clusterName, 'prod-cluster');
      assert.strictEqual(result.migrated.blueprint.baseDomain, 'example.com');
    });

    test('migration preserves all top-level state fields', () => {
      const v1State = {
        runId: 'abc123',
        scenarioId: 'bare-metal-ipi',
        release: { channel: '4.20' },
        blueprint: { clusterName: 'test' },
        networking: { machineNetworkCidr: '10.0.0.0/16' },
        operators: { selectedOperators: ['test'] },
        trust: { bundleSelectionMode: 'original' }
      };

      const result = migrateStateToV3(v1State);

      assert.strictEqual(result.error, null);
      assert.strictEqual(result.migrated.runId, 'abc123');
      assert.strictEqual(result.migrated.scenarioId, 'bare-metal-ipi');
      assert.strictEqual(result.migrated.blueprint.clusterName, 'test');
      assert.strictEqual(result.migrated.networking.machineNetworkCidr, '10.0.0.0/16');
      assert.deepStrictEqual(result.migrated.operators.selectedOperators, ['test']);
      assert.strictEqual(result.migrated.trust.bundleSelectionMode, 'original');
    });

    test('migration does not strip credentials (API endpoint responsibility)', () => {
      // Migration preserves structure - API endpoint must strip credentials
      const v1State = {
        release: { channel: '4.20' },
        credentials: {
          someField: 'value'
        }
      };

      const result = migrateStateToV3(v1State);

      assert.strictEqual(result.error, null);
      assert.ok(result.migrated.credentials);
      assert.strictEqual(result.migrated.credentials.someField, 'value');
    });
  });

  describe('Migration idempotence', () => {
    test('migrating v3 state multiple times is stable', () => {
      const v3State = {
        version: {
          selectedMinor: '4.20',
          locked: true,
          _schemaVersion: 3
        },
        release: { channel: '4.20', confirmed: true }
      };

      const result1 = migrateStateToV3(v3State);
      const result2 = migrateStateToV3(result1.migrated);
      const result3 = migrateStateToV3(result2.migrated);

      assert.strictEqual(result1.wasV3, true);
      assert.strictEqual(result2.wasV3, true);
      assert.strictEqual(result3.wasV3, true);

      assert.deepStrictEqual(result1.migrated, result2.migrated);
      assert.deepStrictEqual(result2.migrated, result3.migrated);
    });

    test('v1 → v3 → v3 migration is stable', () => {
      const v1State = {
        release: { channel: '4.21', confirmed: true }
      };

      const result1 = migrateStateToV3(v1State);
      assert.strictEqual(result1.wasV1, true);

      // Re-migrate (should be no-op)
      const result2 = migrateStateToV3(result1.migrated);
      assert.strictEqual(result2.wasV3, true);

      assert.deepStrictEqual(result1.migrated, result2.migrated);
    });
  });
});
