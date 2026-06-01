/**
 * Version Utilities Test Suite
 *
 * Tests centralized version comparison and normalization logic.
 *
 * @module shared/versionUtils.test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  normalizeVersion,
  getMinorVersion,
  compareVersions,
  isVersionInRange,
  isVersionGTE,
  isVersionLT,
  isParamSupportedForVersion
} from './versionUtils.js';

describe('versionUtils', () => {
  describe('normalizeVersion', () => {
    test('normalizes major.minor to major.minor.0', () => {
      assert.strictEqual(normalizeVersion('4.20'), '4.20.0');
      assert.strictEqual(normalizeVersion('4.21'), '4.21.0');
    });

    test('preserves full semantic version', () => {
      assert.strictEqual(normalizeVersion('4.20.15'), '4.20.15');
      assert.strictEqual(normalizeVersion('4.21.0'), '4.21.0');
      assert.strictEqual(normalizeVersion('4.22.3'), '4.22.3');
    });

    test('removes leading v prefix', () => {
      assert.strictEqual(normalizeVersion('v4.20'), '4.20.0');
      assert.strictEqual(normalizeVersion('v4.21.5'), '4.21.5');
    });

    test('trims whitespace', () => {
      assert.strictEqual(normalizeVersion('  4.20  '), '4.20.0');
      assert.strictEqual(normalizeVersion(' v4.21.1 '), '4.21.1');
    });

    test('throws on invalid formats', () => {
      assert.throws(() => normalizeVersion(''), /non-empty string/);
      assert.throws(() => normalizeVersion(null), /non-empty string/);
      assert.throws(() => normalizeVersion(undefined), /non-empty string/);
      assert.throws(() => normalizeVersion(123), /non-empty string/);
      assert.throws(() => normalizeVersion('invalid'), /Invalid version format/);
      assert.throws(() => normalizeVersion('4'), /Invalid version format/);
      assert.throws(() => normalizeVersion('4.20.x'), /Invalid version format/);
      assert.throws(() => normalizeVersion('4.20.1.5'), /Invalid version format/);
    });
  });

  describe('getMinorVersion', () => {
    test('extracts minor version from full version', () => {
      assert.strictEqual(getMinorVersion('4.20.15'), '4.20');
      assert.strictEqual(getMinorVersion('4.21.0'), '4.21');
      assert.strictEqual(getMinorVersion('4.22.3'), '4.22');
    });

    test('handles versions already in major.minor format', () => {
      assert.strictEqual(getMinorVersion('4.20'), '4.20');
      assert.strictEqual(getMinorVersion('4.21'), '4.21');
    });

    test('handles v prefix', () => {
      assert.strictEqual(getMinorVersion('v4.20.15'), '4.20');
      assert.strictEqual(getMinorVersion('v4.21'), '4.21');
    });

    test('throws on invalid formats', () => {
      assert.throws(() => getMinorVersion('invalid'), /Invalid version format/);
      assert.throws(() => getMinorVersion(''), /non-empty string/);
    });
  });

  describe('compareVersions', () => {
    describe('major version comparison', () => {
      test('returns -1 when A major < B major', () => {
        assert.strictEqual(compareVersions('3.11', '4.20'), -1);
        assert.strictEqual(compareVersions('4.20', '5.0'), -1);
      });

      test('returns 1 when A major > B major', () => {
        assert.strictEqual(compareVersions('5.0', '4.20'), 1);
        assert.strictEqual(compareVersions('4.20', '3.11'), 1);
      });
    });

    describe('minor version comparison', () => {
      test('returns -1 when A minor < B minor (same major)', () => {
        assert.strictEqual(compareVersions('4.19', '4.20'), -1);
        assert.strictEqual(compareVersions('4.20', '4.21'), -1);
        assert.strictEqual(compareVersions('4.21', '4.22'), -1);
      });

      test('returns 1 when A minor > B minor (same major)', () => {
        assert.strictEqual(compareVersions('4.21', '4.20'), 1);
        assert.strictEqual(compareVersions('4.22', '4.20'), 1);
      });

      test('returns 0 when minor versions equal', () => {
        assert.strictEqual(compareVersions('4.20', '4.20'), 0);
        assert.strictEqual(compareVersions('4.21.0', '4.21.0'), 0);
      });
    });

    describe('patch version comparison', () => {
      test('returns -1 when A patch < B patch (same major.minor)', () => {
        assert.strictEqual(compareVersions('4.20.1', '4.20.10'), -1);
        assert.strictEqual(compareVersions('4.20.0', '4.20.1'), -1);
        assert.strictEqual(compareVersions('4.21.5', '4.21.15'), -1);
      });

      test('returns 1 when A patch > B patch (same major.minor)', () => {
        assert.strictEqual(compareVersions('4.20.10', '4.20.1'), 1);
        assert.strictEqual(compareVersions('4.20.15', '4.20.5'), 1);
      });

      test('treats missing patch as .0', () => {
        assert.strictEqual(compareVersions('4.20', '4.20.0'), 0);
        assert.strictEqual(compareVersions('4.20.1', '4.20'), 1);
        assert.strictEqual(compareVersions('4.20', '4.20.1'), -1);
      });
    });

    describe('realistic OpenShift version scenarios', () => {
      test('handles common version comparisons', () => {
        assert.strictEqual(compareVersions('4.20.15', '4.21.0'), -1);
        assert.strictEqual(compareVersions('4.21.0', '4.20.99'), 1);
        assert.strictEqual(compareVersions('4.20', '4.20'), 0);
      });

      test('handles v prefix in comparisons', () => {
        assert.strictEqual(compareVersions('v4.20', '4.21'), -1);
        assert.strictEqual(compareVersions('4.20', 'v4.20'), 0);
      });
    });

    test('throws on invalid versions', () => {
      assert.throws(() => compareVersions('invalid', '4.20'));
      assert.throws(() => compareVersions('4.20', 'bad'));
    });
  });

  describe('isVersionInRange', () => {
    test('returns true when version is within range', () => {
      assert.strictEqual(isVersionInRange('4.20', '4.20', '4.22'), true);
      assert.strictEqual(isVersionInRange('4.21', '4.20', '4.22'), true);
      assert.strictEqual(isVersionInRange('4.22', '4.20', '4.22'), true);
    });

    test('returns false when version is below minimum', () => {
      assert.strictEqual(isVersionInRange('4.19', '4.20', null), false);
      assert.strictEqual(isVersionInRange('4.19.99', '4.20.0', null), false);
    });

    test('returns false when version is above maximum', () => {
      assert.strictEqual(isVersionInRange('4.23', null, '4.22'), false);
      assert.strictEqual(isVersionInRange('4.22.1', null, '4.22.0'), false);
    });

    test('handles null constraints (unbounded)', () => {
      assert.strictEqual(isVersionInRange('4.20', null, null), true);
      assert.strictEqual(isVersionInRange('4.21', null, '4.22'), true);
      assert.strictEqual(isVersionInRange('4.21', '4.20', null), true);
    });

    test('handles edge cases at boundaries', () => {
      assert.strictEqual(isVersionInRange('4.20.0', '4.20', '4.22'), true);
      assert.strictEqual(isVersionInRange('4.22.0', '4.20', '4.22'), true);
      assert.strictEqual(isVersionInRange('4.22.1', '4.20', '4.22'), false);
      assert.strictEqual(isVersionInRange('4.19.99', '4.20', '4.22'), false);
    });

    test('throws on invalid version', () => {
      assert.throws(() => isVersionInRange('invalid', '4.20', '4.22'));
    });
  });

  describe('isVersionGTE', () => {
    test('returns true when A >= B', () => {
      assert.strictEqual(isVersionGTE('4.21', '4.20'), true);
      assert.strictEqual(isVersionGTE('4.20', '4.20'), true);
      assert.strictEqual(isVersionGTE('4.20.1', '4.20.0'), true);
    });

    test('returns false when A < B', () => {
      assert.strictEqual(isVersionGTE('4.19', '4.20'), false);
      assert.strictEqual(isVersionGTE('4.20.0', '4.20.1'), false);
    });
  });

  describe('isVersionLT', () => {
    test('returns true when A < B', () => {
      assert.strictEqual(isVersionLT('4.20', '4.21'), true);
      assert.strictEqual(isVersionLT('4.20.0', '4.20.1'), true);
    });

    test('returns false when A >= B', () => {
      assert.strictEqual(isVersionLT('4.21', '4.20'), false);
      assert.strictEqual(isVersionLT('4.20', '4.20'), false);
      assert.strictEqual(isVersionLT('4.20.1', '4.20.0'), false);
    });
  });

  describe('isParamSupportedForVersion', () => {
    test('returns true for param within version range', () => {
      const param = { path: 'foo', minVersion: '4.20', maxVersion: null };
      assert.strictEqual(isParamSupportedForVersion(param, '4.20'), true);
      assert.strictEqual(isParamSupportedForVersion(param, '4.21'), true);
      assert.strictEqual(isParamSupportedForVersion(param, '4.22'), true);
    });

    test('returns false for param below minVersion', () => {
      const param = { path: 'foo', minVersion: '4.20', maxVersion: null };
      assert.strictEqual(isParamSupportedForVersion(param, '4.19'), false);
      assert.strictEqual(isParamSupportedForVersion(param, '4.19.99'), false);
    });

    test('returns false for param above maxVersion', () => {
      const param = { path: 'foo', minVersion: '4.19', maxVersion: '4.20' };
      assert.strictEqual(isParamSupportedForVersion(param, '4.21'), false);
      assert.strictEqual(isParamSupportedForVersion(param, '4.22'), false);
    });

    test('handles deprecated params (maxVersion set)', () => {
      const deprecatedParam = { path: 'oldField', minVersion: '4.18', maxVersion: '4.20' };
      assert.strictEqual(isParamSupportedForVersion(deprecatedParam, '4.19'), true);
      assert.strictEqual(isParamSupportedForVersion(deprecatedParam, '4.20'), true);
      assert.strictEqual(isParamSupportedForVersion(deprecatedParam, '4.21'), false);
    });

    test('handles params with no version constraints', () => {
      const param = { path: 'foo', minVersion: null, maxVersion: null };
      assert.strictEqual(isParamSupportedForVersion(param, '4.19'), true);
      assert.strictEqual(isParamSupportedForVersion(param, '4.20'), true);
      assert.strictEqual(isParamSupportedForVersion(param, '4.21'), true);
    });

    test('handles params with missing version fields', () => {
      const param = { path: 'foo' };
      assert.strictEqual(isParamSupportedForVersion(param, '4.20'), true);
    });

    test('realistic catalog parameter scenarios', () => {
      // New field added in 4.21
      const newField = { path: 'newFeature', minVersion: '4.21', maxVersion: null };
      assert.strictEqual(isParamSupportedForVersion(newField, '4.20'), false);
      assert.strictEqual(isParamSupportedForVersion(newField, '4.21'), true);

      // Deprecated field removed in 4.22
      const deprecatedField = { path: 'oldFeature', minVersion: '4.20', maxVersion: '4.21' };
      assert.strictEqual(isParamSupportedForVersion(deprecatedField, '4.20'), true);
      assert.strictEqual(isParamSupportedForVersion(deprecatedField, '4.21'), true);
      assert.strictEqual(isParamSupportedForVersion(deprecatedField, '4.22'), false);

      // Always-supported field
      const alwaysSupported = { path: 'baseDomain', minVersion: '4.20', maxVersion: null };
      assert.strictEqual(isParamSupportedForVersion(alwaysSupported, '4.20'), true);
      assert.strictEqual(isParamSupportedForVersion(alwaysSupported, '4.25'), true);
    });
  });

  describe('integration tests', () => {
    test('version comparison consistency', () => {
      const versions = ['4.19', '4.20.0', '4.20.5', '4.21', '4.22.0'];

      // Verify transitivity: if A < B and B < C, then A < C
      for (let i = 0; i < versions.length - 2; i++) {
        assert.strictEqual(compareVersions(versions[i], versions[i + 1]), -1);
        assert.strictEqual(compareVersions(versions[i], versions[i + 2]), -1);
        assert.strictEqual(compareVersions(versions[i + 2], versions[i]), 1);
      }
    });

    test('normalization preserves comparison semantics', () => {
      assert.strictEqual(compareVersions('4.20', '4.20.0'), 0);
      assert.strictEqual(compareVersions('v4.20', '4.20'), 0);
      assert.strictEqual(compareVersions('  4.20  ', '4.20.0'), 0);
    });

    test('range checking matches comparison logic', () => {
      const version = '4.21';
      const min = '4.20';
      const max = '4.22';

      // Range check should be equivalent to two comparisons
      assert.strictEqual(
        isVersionInRange(version, min, max),
        compareVersions(version, min) >= 0 && compareVersions(version, max) <= 0
      );
    });
  });
});
