/**
 * OpenShift Minor - Canonical v3 Precedence Tests (Backend)
 *
 * DOC-102 Slice 5F.13: version.selectedMinor must take precedence over release.channel
 * Backend mirror of frontend canonical precedence tests.
 */

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { getOpenShiftMinorFromSources, getOpenShiftMinorFromState } = require('../src/openShiftMinor.js');

describe('OpenShift Minor - Canonical v3 Precedence (Backend)', () => {
  it('version.selectedMinor takes precedence over release.channel (4.22 conflict)', () => {
    const state = {
      version: {
        _schemaVersion: 3,
        selectedMinor: '4.22',
        selectedChannel: 'stable-4.22',
        selectedPatch: null
      },
      release: {
        channel: '4.21',
        patchVersion: null
      }
    };

    const minor = getOpenShiftMinorFromState(state);

    assert.strictEqual(minor, '4.22'); // Canonical selectedMinor wins
  });

  it('version.selectedMinor takes precedence over release.channel (4.21 vs 4.20)', () => {
    const state = {
      version: {
        _schemaVersion: 3,
        selectedMinor: '4.21',
        selectedPatch: null
      },
      release: {
        channel: '4.20',
        patchVersion: null
      }
    };

    const minor = getOpenShiftMinorFromState(state);

    assert.strictEqual(minor, '4.21');
  });

  it('falls back to release.channel when version.selectedMinor is absent (v1/v2 compat)', () => {
    const state = {
      version: {},
      release: {
        channel: '4.20',
        patchVersion: null
      }
    };

    const minor = getOpenShiftMinorFromState(state);

    assert.strictEqual(minor, '4.20');
  });

  it('version.selectedPatch takes precedence over release.patchVersion', () => {
    const state = {
      version: {
        _schemaVersion: 3,
        selectedMinor: null,
        selectedPatch: '4.21.5'
      },
      release: {
        channel: null,
        patchVersion: '4.20.15'
      }
    };

    const minor = getOpenShiftMinorFromState(state);

    assert.strictEqual(minor, '4.21'); // Derived from version.selectedPatch
  });

  it('falls back to release.patchVersion when canonical fields are absent', () => {
    const state = {
      version: {
        selectedMinor: null,
        selectedPatch: null
      },
      release: {
        channel: null,
        patchVersion: '4.20.15'
      }
    };

    const minor = getOpenShiftMinorFromState(state);

    assert.strictEqual(minor, '4.20');
  });

  it('falls back to version.selectedVersion (legacy v1)', () => {
    const state = {
      version: {
        selectedVersion: '4.20.15'
      },
      release: {}
    };

    const minor = getOpenShiftMinorFromState(state);

    assert.strictEqual(minor, '4.20');
  });

  it('returns null when all version fields are absent', () => {
    const state = {
      version: {},
      release: {}
    };

    const minor = getOpenShiftMinorFromState(state);

    assert.strictEqual(minor, null);
  });

  it('getOpenShiftMinorFromSources respects precedence directly', () => {
    const release = { channel: '4.20', patchVersion: null };
    const version = { selectedMinor: '4.21', selectedPatch: null };

    const minor = getOpenShiftMinorFromSources(release, version);

    assert.strictEqual(minor, '4.21'); // selectedMinor wins
  });

  it('handles stable- prefix in release.channel fallback', () => {
    const state = {
      version: { selectedMinor: null },
      release: { channel: 'stable-4.20' }
    };

    const minor = getOpenShiftMinorFromState(state);

    assert.strictEqual(minor, '4.20');
  });

  it('handles complete v3 state with consistent fields', () => {
    const state = {
      version: {
        _schemaVersion: 3,
        selectedMinor: '4.21',
        selectedPatch: '4.21.5',
        selectedChannel: 'stable-4.21',
        locked: true
      },
      release: {
        channel: '4.21',
        patchVersion: '4.21.5',
        confirmed: true
      }
    };

    const minor = getOpenShiftMinorFromState(state);

    assert.strictEqual(minor, '4.21');
  });
});
