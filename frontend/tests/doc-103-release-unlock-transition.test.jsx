import { describe, it, expect } from 'vitest';
import { computeReleaseTransition, TRANSITION_ERRORS } from '../src/shared/versionReleaseTransition.js';

const TS = 1700000000000;

function makeLockedState(minor, patch) {
  return {
    version: {
      selectedMinor: minor,
      selectedPatch: patch,
      selectedChannel: `stable-${minor}`,
      locked: true,
      lockTimestamp: 1700000000000,
      selectionTimestamp: 1700000000000,
      confirmedByUser: true,
      _schemaVersion: 3,
    },
    release: {
      channel: minor,
      patchVersion: patch,
      confirmed: true,
      followLatestMinor: false,
    },
    operators: {
      selected: [{ name: 'test-op', catalogImage: `registry.redhat.io/redhat/redhat-operator-index:v${minor}` }],
      catalogs: { 'redhat-operators': { packages: ['test-pkg'] } },
      version: minor,
      stale: false,
      scenarios: { odf: true },
      scenarioAdded: { 'test-op': 'odf' },
      scanJobs: [{ id: 'job1' }],
      cachedAt: 1700000000000,
    },
    blueprint: { arch: 'x86_64', platform: 'AWS GovCloud', clusterName: 'test', baseDomain: 'example.com', confirmed: true },
    methodology: { method: 'IPI' },
    credentials: { sshPublicKey: 'ssh-rsa AAAA...' },
    platformConfig: { publish: 'External' },
    hostInventory: { nodes: [] },
    globalStrategy: { fips: false },
    trust: { additionalTrustBundlePolicy: 'Proxyonly' },
    reviewFlags: { blueprint: false, operators: false },
    ui: { activeStepId: 'operators', visitedSteps: { blueprint: true, operators: true }, completedSteps: { blueprint: true } },
  };
}

describe('computeReleaseTransition', () => {
  describe('determinism', () => {
    it('two invocations with identical state and options produce deeply equal results', () => {
      const state = makeLockedState('4.20', '4.20.15');
      const a = computeReleaseTransition(state, '4.21', { timestamp: TS });
      const b = computeReleaseTransition(state, '4.21', { timestamp: TS });
      expect(a).toEqual(b);
    });

    it('two invocations with identical state, options, and explicit patch produce deeply equal results', () => {
      const state = makeLockedState('4.20', '4.20.15');
      const a = computeReleaseTransition(state, '4.21', { timestamp: TS, patch: '4.21.8' });
      const b = computeReleaseTransition(state, '4.21', { timestamp: TS, patch: '4.21.8' });
      expect(a).toEqual(b);
    });

    it('different timestamps produce different selectionTimestamp but otherwise equal patches', () => {
      const state = makeLockedState('4.20', '4.20.15');
      const a = computeReleaseTransition(state, '4.21', { timestamp: 1000 });
      const b = computeReleaseTransition(state, '4.21', { timestamp: 2000 });
      expect(a.patch.version.selectionTimestamp).toBe(1000);
      expect(b.patch.version.selectionTimestamp).toBe(2000);
      expect({ ...a.patch.version, selectionTimestamp: null })
        .toEqual({ ...b.patch.version, selectionTimestamp: null });
      expect(a.patch.release).toEqual(b.patch.release);
    });

    it('selectionTimestamp in the patch equals the provided timestamp exactly', () => {
      const state = makeLockedState('4.21', '4.21.3');
      const result = computeReleaseTransition(state, '4.20', { timestamp: 1234567890123 });
      expect(result.patch.version.selectionTimestamp).toBe(1234567890123);
    });
  });

  describe('timestamp validation', () => {
    const state = makeLockedState('4.20', '4.20.15');

    it('rejects missing timestamp (no options)', () => {
      const result = computeReleaseTransition(state, '4.21');
      expect(result.ok).toBe(false);
      expect(result.code).toBe(TRANSITION_ERRORS.INVALID_TIMESTAMP);
    });

    it('rejects missing timestamp (empty options)', () => {
      const result = computeReleaseTransition(state, '4.21', {});
      expect(result.ok).toBe(false);
      expect(result.code).toBe(TRANSITION_ERRORS.INVALID_TIMESTAMP);
    });

    it('rejects non-number timestamp', () => {
      expect(computeReleaseTransition(state, '4.21', { timestamp: '1700000000000' }).code)
        .toBe(TRANSITION_ERRORS.INVALID_TIMESTAMP);
      expect(computeReleaseTransition(state, '4.21', { timestamp: null }).code)
        .toBe(TRANSITION_ERRORS.INVALID_TIMESTAMP);
    });

    it('rejects non-finite timestamp', () => {
      expect(computeReleaseTransition(state, '4.21', { timestamp: Infinity }).code)
        .toBe(TRANSITION_ERRORS.INVALID_TIMESTAMP);
      expect(computeReleaseTransition(state, '4.21', { timestamp: NaN }).code)
        .toBe(TRANSITION_ERRORS.INVALID_TIMESTAMP);
    });

    it('rejects zero and negative timestamp', () => {
      expect(computeReleaseTransition(state, '4.21', { timestamp: 0 }).code)
        .toBe(TRANSITION_ERRORS.INVALID_TIMESTAMP);
      expect(computeReleaseTransition(state, '4.21', { timestamp: -1 }).code)
        .toBe(TRANSITION_ERRORS.INVALID_TIMESTAMP);
    });

    it('accepts a valid positive timestamp', () => {
      const result = computeReleaseTransition(state, '4.21', { timestamp: 1 });
      expect(result.ok).toBe(true);
    });
  });

  describe('4.20 → 4.21 transition', () => {
    it('produces coherent canonical v3 version fields', () => {
      const state = makeLockedState('4.20', '4.20.15');
      const result = computeReleaseTransition(state, '4.21', { timestamp: TS });

      expect(result.ok).toBe(true);
      expect(result.patch.version.selectedMinor).toBe('4.21');
      expect(result.patch.version.selectedPatch).toBeNull();
      expect(result.patch.version.selectedChannel).toBe('stable-4.21');
      expect(result.patch.version._schemaVersion).toBe(3);
      expect(result.patch.version.selectionTimestamp).toBe(TS);
    });

    it('leaves release unlocked and unconfirmed', () => {
      const state = makeLockedState('4.20', '4.20.15');
      const result = computeReleaseTransition(state, '4.21', { timestamp: TS });

      expect(result.patch.version.locked).toBe(false);
      expect(result.patch.version.lockTimestamp).toBeNull();
      expect(result.patch.version.confirmedByUser).toBe(false);
      expect(result.patch.release.confirmed).toBe(false);
    });

    it('produces coherent legacy release fields', () => {
      const state = makeLockedState('4.20', '4.20.15');
      const result = computeReleaseTransition(state, '4.21', { timestamp: TS });

      expect(result.patch.release.channel).toBe('4.21');
      expect(result.patch.release.patchVersion).toBeNull();
      expect(result.patch.release.confirmed).toBe(false);
    });

    it('removes stale old-minor patch and channel', () => {
      const state = makeLockedState('4.20', '4.20.15');
      const result = computeReleaseTransition(state, '4.21', { timestamp: TS });

      expect(result.patch.version.selectedPatch).toBeNull();
      expect(result.patch.release.patchVersion).toBeNull();
      expect(result.patch.version.selectedChannel).toBe('stable-4.21');
      expect(result.patch.release.channel).toBe('4.21');
    });

    it('marks operators stale (existing staleness behavior)', () => {
      const state = makeLockedState('4.20', '4.20.15');
      const result = computeReleaseTransition(state, '4.21', { timestamp: TS });

      expect(result.patch.operators.stale).toBe(true);
    });

    it('preserves existing operator data in the stale-marked patch', () => {
      const state = makeLockedState('4.20', '4.20.15');
      const result = computeReleaseTransition(state, '4.21', { timestamp: TS });

      expect(result.patch.operators.selected).toEqual(state.operators.selected);
      expect(result.patch.operators.catalogs).toEqual(state.operators.catalogs);
      expect(result.patch.operators.version).toBe('4.20');
      expect(result.patch.operators.scenarios).toEqual(state.operators.scenarios);
    });

    it('preserves unrelated state sections (not included in patch)', () => {
      const state = makeLockedState('4.20', '4.20.15');
      const result = computeReleaseTransition(state, '4.21', { timestamp: TS });

      expect(result.patch.blueprint).toBeUndefined();
      expect(result.patch.credentials).toBeUndefined();
      expect(result.patch.methodology).toBeUndefined();
      expect(result.patch.platformConfig).toBeUndefined();
      expect(result.patch.hostInventory).toBeUndefined();
      expect(result.patch.globalStrategy).toBeUndefined();
      expect(result.patch.trust).toBeUndefined();
      expect(result.patch.reviewFlags).toBeUndefined();
      expect(result.patch.ui).toBeUndefined();
    });
  });

  describe('4.21 → 4.20 transition', () => {
    it('produces coherent canonical v3 version fields', () => {
      const state = makeLockedState('4.21', '4.21.3');
      const result = computeReleaseTransition(state, '4.20', { timestamp: TS });

      expect(result.ok).toBe(true);
      expect(result.patch.version.selectedMinor).toBe('4.20');
      expect(result.patch.version.selectedPatch).toBeNull();
      expect(result.patch.version.selectedChannel).toBe('stable-4.20');
      expect(result.patch.version.locked).toBe(false);
      expect(result.patch.version._schemaVersion).toBe(3);
      expect(result.patch.version.selectionTimestamp).toBe(TS);
    });

    it('produces coherent legacy release fields', () => {
      const state = makeLockedState('4.21', '4.21.3');
      const result = computeReleaseTransition(state, '4.20', { timestamp: TS });

      expect(result.patch.release.channel).toBe('4.20');
      expect(result.patch.release.patchVersion).toBeNull();
      expect(result.patch.release.confirmed).toBe(false);
    });

    it('marks operators stale and preserves operator data', () => {
      const state = makeLockedState('4.21', '4.21.3');
      const result = computeReleaseTransition(state, '4.20', { timestamp: TS });

      expect(result.patch.operators.stale).toBe(true);
      expect(result.patch.operators.selected).toEqual(state.operators.selected);
      expect(result.patch.operators.catalogs).toEqual(state.operators.catalogs);
    });
  });

  describe('input immutability', () => {
    it('does not mutate the input state object', () => {
      const state = makeLockedState('4.20', '4.20.15');
      const snapshot = JSON.parse(JSON.stringify(state));
      computeReleaseTransition(state, '4.21', { timestamp: TS });
      expect(state).toEqual(snapshot);
    });

    it('does not mutate input on rejection', () => {
      const state = makeLockedState('4.20', '4.20.15');
      const snapshot = JSON.parse(JSON.stringify(state));
      computeReleaseTransition(state, '4.22', { timestamp: TS });
      expect(state).toEqual(snapshot);
    });
  });

  describe('support boundary enforcement', () => {
    it('accepts 4.20 as a supported target', () => {
      const state = makeLockedState('4.21', '4.21.3');
      expect(computeReleaseTransition(state, '4.20', { timestamp: TS }).ok).toBe(true);
    });

    it('accepts 4.21 as a supported target', () => {
      const state = makeLockedState('4.20', '4.20.15');
      expect(computeReleaseTransition(state, '4.21', { timestamp: TS }).ok).toBe(true);
    });

    it('rejects 4.22 as unsupported without fallback', () => {
      const state = makeLockedState('4.21', '4.21.3');
      const result = computeReleaseTransition(state, '4.22', { timestamp: TS });

      expect(result.ok).toBe(false);
      expect(result.code).toBe(TRANSITION_ERRORS.UNSUPPORTED_VERSION);
      expect(result.patch).toBeUndefined();
    });

    it('rejects 4.19 as unsupported without fallback', () => {
      const state = makeLockedState('4.20', '4.20.15');
      const result = computeReleaseTransition(state, '4.19', { timestamp: TS });

      expect(result.ok).toBe(false);
      expect(result.code).toBe(TRANSITION_ERRORS.UNSUPPORTED_VERSION);
    });
  });

  describe('malformed and unresolved target rejection', () => {
    const state = makeLockedState('4.20', '4.20.15');

    it('rejects null target', () => {
      const result = computeReleaseTransition(state, null, { timestamp: TS });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(TRANSITION_ERRORS.INVALID_TARGET);
    });

    it('rejects undefined target', () => {
      const result = computeReleaseTransition(state, undefined, { timestamp: TS });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(TRANSITION_ERRORS.INVALID_TARGET);
    });

    it('rejects empty string target', () => {
      const result = computeReleaseTransition(state, '', { timestamp: TS });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(TRANSITION_ERRORS.INVALID_TARGET);
    });

    it('rejects non-minor format (full patch version)', () => {
      const result = computeReleaseTransition(state, '4.21.3', { timestamp: TS });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(TRANSITION_ERRORS.INVALID_TARGET);
    });

    it('rejects text strings', () => {
      expect(computeReleaseTransition(state, 'latest', { timestamp: TS }).ok).toBe(false);
      expect(computeReleaseTransition(state, 'stable-4.21', { timestamp: TS }).ok).toBe(false);
    });

    it('rejects single-segment version', () => {
      const result = computeReleaseTransition(state, '4', { timestamp: TS });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(TRANSITION_ERRORS.INVALID_TARGET);
    });

    it('rejects non-numeric minor', () => {
      const result = computeReleaseTransition(state, '4.x', { timestamp: TS });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(TRANSITION_ERRORS.INVALID_TARGET);
    });

    it('rejects invalid state input', () => {
      expect(computeReleaseTransition(null, '4.21', { timestamp: TS }).code).toBe(TRANSITION_ERRORS.INVALID_STATE);
      expect(computeReleaseTransition(undefined, '4.21', { timestamp: TS }).code).toBe(TRANSITION_ERRORS.INVALID_STATE);
      expect(computeReleaseTransition('not-an-object', '4.21', { timestamp: TS }).code).toBe(TRANSITION_ERRORS.INVALID_STATE);
    });

    it('produces no partial mutation or patch on any rejection', () => {
      const result = computeReleaseTransition(state, '4.22', { timestamp: TS });
      expect(result.ok).toBe(false);
      expect(result.patch).toBeUndefined();
    });
  });

  describe('explicit patch handling', () => {
    it('accepts an explicit patch matching the target minor', () => {
      const state = makeLockedState('4.20', '4.20.15');
      const result = computeReleaseTransition(state, '4.21', { timestamp: TS, patch: '4.21.8' });

      expect(result.ok).toBe(true);
      expect(result.patch.version.selectedPatch).toBe('4.21.8');
      expect(result.patch.release.patchVersion).toBe('4.21.8');
    });

    it('rejects an explicit patch from the wrong minor', () => {
      const state = makeLockedState('4.20', '4.20.15');
      const result = computeReleaseTransition(state, '4.21', { timestamp: TS, patch: '4.20.15' });

      expect(result.ok).toBe(false);
      expect(result.code).toBe(TRANSITION_ERRORS.PATCH_MINOR_MISMATCH);
      expect(result.patch).toBeUndefined();
    });

    it('rejects an explicit patch from a completely different version', () => {
      const state = makeLockedState('4.20', '4.20.15');
      const result = computeReleaseTransition(state, '4.21', { timestamp: TS, patch: '4.22.1' });

      expect(result.ok).toBe(false);
      expect(result.code).toBe(TRANSITION_ERRORS.PATCH_MINOR_MISMATCH);
    });

    it('clears patch to null when no explicit patch is provided', () => {
      const state = makeLockedState('4.20', '4.20.15');
      const result = computeReleaseTransition(state, '4.21', { timestamp: TS });

      expect(result.patch.version.selectedPatch).toBeNull();
      expect(result.patch.release.patchVersion).toBeNull();
    });
  });

  describe('followLatestMinor preservation', () => {
    it('preserves followLatestMinor: false from input', () => {
      const state = makeLockedState('4.20', '4.20.15');
      state.release.followLatestMinor = false;
      const result = computeReleaseTransition(state, '4.21', { timestamp: TS });
      expect(result.patch.release.followLatestMinor).toBe(false);
    });

    it('preserves followLatestMinor: true from input', () => {
      const state = makeLockedState('4.20', '4.20.15');
      state.release.followLatestMinor = true;
      const result = computeReleaseTransition(state, '4.21', { timestamp: TS });
      expect(result.patch.release.followLatestMinor).toBe(true);
    });

    it('defaults followLatestMinor to true when release is absent', () => {
      const state = makeLockedState('4.20', '4.20.15');
      delete state.release;
      const result = computeReleaseTransition(state, '4.21', { timestamp: TS });
      expect(result.patch.release.followLatestMinor).toBe(true);
    });
  });

  describe('no automatic post-lock transition', () => {
    it('module exports only pure functions and frozen constants', async () => {
      const mod = await import('../src/shared/versionReleaseTransition.js');
      const exportKeys = Object.keys(mod).filter(k => k !== 'default');
      for (const key of exportKeys) {
        const val = mod[key];
        const t = typeof val;
        expect(t === 'function' || t === 'object').toBe(true);
        if (t === 'object' && val !== null) {
          expect(Object.isFrozen(val)).toBe(true);
        }
      }
    });

    it('calling the function does not mutate any external state', () => {
      const state = makeLockedState('4.20', '4.20.15');
      const result = computeReleaseTransition(state, '4.21', { timestamp: TS });
      expect(result.ok).toBe(true);
      expect(state.version.locked).toBe(true);
      expect(state.release.confirmed).toBe(true);
    });

    it('returned patch does not register callbacks, timers, or subscriptions', () => {
      const state = makeLockedState('4.20', '4.20.15');
      const result = computeReleaseTransition(state, '4.21', { timestamp: TS });
      const patch = result.patch;
      for (const key of Object.keys(patch)) {
        const val = patch[key];
        expect(typeof val).not.toBe('function');
      }
    });
  });

  describe('version/release field coherence', () => {
    it('release.channel matches version.selectedMinor', () => {
      const state = makeLockedState('4.20', '4.20.15');
      const result = computeReleaseTransition(state, '4.21', { timestamp: TS });
      expect(result.patch.release.channel).toBe(result.patch.version.selectedMinor);
    });

    it('release.patchVersion matches version.selectedPatch', () => {
      const state = makeLockedState('4.20', '4.20.15');
      const result = computeReleaseTransition(state, '4.21', { timestamp: TS, patch: '4.21.8' });
      expect(result.patch.release.patchVersion).toBe(result.patch.version.selectedPatch);
    });

    it('release.confirmed matches version.locked', () => {
      const state = makeLockedState('4.20', '4.20.15');
      const result = computeReleaseTransition(state, '4.21', { timestamp: TS });
      expect(result.patch.release.confirmed).toBe(result.patch.version.locked);
    });

    it('selectedChannel is stable-{selectedMinor}', () => {
      const state = makeLockedState('4.20', '4.20.15');
      const result = computeReleaseTransition(state, '4.21', { timestamp: TS });
      expect(result.patch.version.selectedChannel).toBe(`stable-${result.patch.version.selectedMinor}`);
    });
  });
});
