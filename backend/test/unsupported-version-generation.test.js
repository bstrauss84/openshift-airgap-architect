/**
 * Unsupported Version - Generation & Bundle Tests
 *
 * DOC-102 Slice 5F.13: assertSupportedOpenShiftVersion must reject 4.22 before builders execute.
 */

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { SUPPORTED_MINORS, isSupportedMinor } = require('../src/versionPolicy.js');
const { getOpenShiftMinorFromState } = require('../src/openShiftMinor.js');

describe('Unsupported Version - Shared Assertion Logic', () => {

  it('isSupportedMinor rejects 4.22', () => {
    assert.strictEqual(isSupportedMinor('4.22'), false);
  });

  it('isSupportedMinor accepts 4.21', () => {
    assert.strictEqual(isSupportedMinor('4.21'), true);
  });

  it('isSupportedMinor accepts 4.20', () => {
    assert.strictEqual(isSupportedMinor('4.20'), true);
  });

  it('getOpenShiftMinorFromState resolves 4.22 from canonical selectedMinor', () => {
    const state = {
      version: {
        _schemaVersion: 3,
        selectedMinor: '4.22',
        selectedPatch: '4.22.1',
        locked: true
      },
      release: {
        channel: '4.21', // Conflicting but canonical takes priority
        patchVersion: '4.22.1',
        confirmed: true
      }
    };

    const minor = getOpenShiftMinorFromState(state);
    assert.strictEqual(minor, '4.22');
  });

  it('SUPPORTED_MINORS contains only 4.20 and 4.21', () => {
    assert.deepStrictEqual(SUPPORTED_MINORS, ['4.20', '4.21']);
  });

  it('SUPPORTED_MINORS does not include 4.22', () => {
    assert.ok(!SUPPORTED_MINORS.includes('4.22'));
  });
});
