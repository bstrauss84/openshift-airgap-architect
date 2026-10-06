import { describe, it, expect } from 'vitest';
import { computeReleaseTransition } from '../src/shared/versionReleaseTransition.js';

const TS = 1700000000000;

function makeState(minor, patch, operatorOverrides = {}) {
  return {
    version: {
      selectedMinor: minor,
      selectedPatch: patch,
      selectedChannel: `stable-${minor}`,
      locked: true,
      lockTimestamp: TS,
      selectionTimestamp: TS,
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
      selected: [
        {
          name: 'odf-operator',
          id: 'odf-operator-redhat',
          catalogImage: `registry.redhat.io/redhat/redhat-operator-index:v${minor}`,
          defaultChannel: 'stable-4.x',
          sources: ['odf'],
          minVersion: null,
          maxVersion: null,
        },
        {
          name: 'compliance-operator',
          id: 'compliance-operator-certified',
          catalogImage: `registry.redhat.io/redhat/certified-operator-index:v${minor}`,
          defaultChannel: 'release-0.1',
          sources: ['manual'],
        },
      ],
      catalogs: {
        redhat: [{ id: 'odf-operator-redhat', name: 'odf-operator', defaultChannel: 'stable-4.x' }],
        certified: [{ id: 'compliance-operator-certified', name: 'compliance-operator' }],
        community: [],
      },
      version: minor,
      stale: false,
      scenarios: { odf: true },
      scenarioAdded: { 'odf-operator-redhat': { odf: true } },
      scanJobs: { redhat: 'job-r-1', certified: 'job-c-1', community: 'job-m-1' },
      cachedAt: TS,
      fastMode: false,
      ...operatorOverrides,
    },
    blueprint: { arch: 'x86_64', platform: 'AWS GovCloud', confirmed: true },
    methodology: { method: 'IPI' },
  };
}

describe('Operator state across version transitions', () => {
  describe('cross-minor 4.21 → 4.20', () => {
    const state = makeState('4.21', '4.21.3');
    const result = computeReleaseTransition(state, '4.20', { timestamp: TS });

    it('succeeds', () => {
      expect(result.ok).toBe(true);
    });

    it('marks operators stale', () => {
      expect(result.patch.operators.stale).toBe(true);
    });

    it('clears catalog browse data', () => {
      expect(result.patch.operators.catalogs).toEqual({});
    });

    it('clears scan jobs', () => {
      expect(result.patch.operators.scanJobs).toEqual({});
    });

    it('sets version to null', () => {
      expect(result.patch.operators.version).toBeNull();
    });

    it('clears cachedAt', () => {
      expect(result.patch.operators.cachedAt).toBeNull();
    });

    it('preserves selected operator names and IDs', () => {
      expect(result.patch.operators.selected).toHaveLength(2);
      expect(result.patch.operators.selected[0].name).toBe('odf-operator');
      expect(result.patch.operators.selected[0].id).toBe('odf-operator-redhat');
      expect(result.patch.operators.selected[1].name).toBe('compliance-operator');
      expect(result.patch.operators.selected[1].id).toBe('compliance-operator-certified');
    });

    it('preserves sources on selected operators', () => {
      expect(result.patch.operators.selected[0].sources).toEqual(['odf']);
      expect(result.patch.operators.selected[1].sources).toEqual(['manual']);
    });

    it('clears version-specific resolved metadata from selected operators', () => {
      for (const op of result.patch.operators.selected) {
        expect(op.catalogImage).toBeUndefined();
        expect(op.defaultChannel).toBeUndefined();
      }
    });

    it('clears the ACTIVE scenario selection — it is no longer current', () => {
      expect(result.patch.operators.scenarios).toEqual({});
    });

    it('preserves the quick-pick INTENT separately for reconciliation', () => {
      expect(result.patch.operators.pendingScenarios).toEqual({ odf: true });
    });

    it('preserves scenarioAdded', () => {
      expect(result.patch.operators.scenarioAdded).toEqual({ 'odf-operator-redhat': { odf: true } });
    });

    it('preserves fastMode', () => {
      expect(result.patch.operators.fastMode).toBe(false);
    });
  });

  describe('cross-minor 4.20 → 4.21', () => {
    const state = makeState('4.20', '4.20.15');
    const result = computeReleaseTransition(state, '4.21', { timestamp: TS });

    it('clears catalogs and scan data', () => {
      expect(result.patch.operators.catalogs).toEqual({});
      expect(result.patch.operators.version).toBeNull();
      expect(result.patch.operators.scanJobs).toEqual({});
    });

    it('preserves user intent', () => {
      expect(result.patch.operators.selected).toHaveLength(2);
      expect(result.patch.operators.selected[0].name).toBe('odf-operator');
      expect(result.patch.operators.selected[0].catalogImage).toBeUndefined();
    });
  });

  describe('same-minor 4.21 → 4.21', () => {
    const state = makeState('4.21', '4.21.3');
    const result = computeReleaseTransition(state, '4.21', { timestamp: TS });

    it('preserves all operator data', () => {
      expect(result.patch.operators.selected).toEqual(state.operators.selected);
      expect(result.patch.operators.catalogs).toEqual(state.operators.catalogs);
      expect(result.patch.operators.version).toBe('4.21');
      expect(result.patch.operators.scanJobs).toEqual(state.operators.scanJobs);
      expect(result.patch.operators.cachedAt).toBe(TS);
    });

    it('still marks stale', () => {
      expect(result.patch.operators.stale).toBe(true);
    });
  });

  describe('same-minor 4.20 → 4.20', () => {
    const state = makeState('4.20', '4.20.15');
    const result = computeReleaseTransition(state, '4.20', { timestamp: TS });

    it('preserves all operator data', () => {
      expect(result.patch.operators.selected).toEqual(state.operators.selected);
      expect(result.patch.operators.version).toBe('4.20');
    });
  });

  describe('no operators selected', () => {
    const state = makeState('4.21', '4.21.3', {
      selected: [],
      catalogs: { redhat: [{ id: 'some-op' }], certified: [], community: [] },
      version: '4.21',
    });
    const result = computeReleaseTransition(state, '4.20', { timestamp: TS });

    it('clears catalog browse data even with no selections', () => {
      expect(result.patch.operators.catalogs).toEqual({});
      expect(result.patch.operators.version).toBeNull();
    });

    it('selected remains empty', () => {
      expect(result.patch.operators.selected).toEqual([]);
    });
  });

  describe('no existing operators state', () => {
    it('handles undefined operators gracefully', () => {
      const state = {
        version: { selectedMinor: '4.20', _schemaVersion: 3, locked: true },
        release: { channel: '4.20', confirmed: true },
      };
      const result = computeReleaseTransition(state, '4.21', { timestamp: TS });
      expect(result.ok).toBe(true);
      expect(result.patch.operators.selected).toEqual([]);
      expect(result.patch.operators.stale).toBe(true);
    });
  });

  describe('ImageSet safety: stale operators without catalogImage', () => {
    it('cross-minor transition produces operators without catalogImage', () => {
      const state = makeState('4.21', '4.21.3');
      const result = computeReleaseTransition(state, '4.20', { timestamp: TS });
      const staleOps = result.patch.operators.selected.filter(op => !op.catalogImage);
      expect(staleOps.length).toBe(2);
    });
  });

  describe('async/background safety contracts', () => {
    it('cross-minor clears scanJobs so stale poll cannot restart', () => {
      const state = makeState('4.21', '4.21.3');
      const result = computeReleaseTransition(state, '4.20', { timestamp: TS });
      expect(result.patch.operators.scanJobs).toEqual({});
      expect(Object.keys(result.patch.operators.scanJobs).length).toBe(0);
    });

    it('cross-minor sets version to null so stale status fetch uses new version', () => {
      const state = makeState('4.21', '4.21.3');
      const result = computeReleaseTransition(state, '4.20', { timestamp: TS });
      expect(result.patch.operators.version).toBeNull();
    });

    it('same-minor preserves scanJobs (no unnecessary invalidation)', () => {
      const state = makeState('4.21', '4.21.3');
      const result = computeReleaseTransition(state, '4.21', { timestamp: TS });
      expect(result.patch.operators.scanJobs).toEqual(state.operators.scanJobs);
    });

    it('cross-minor transition followed by re-apply does not re-introduce stale metadata', () => {
      const state = makeState('4.21', '4.21.3');
      const first = computeReleaseTransition(state, '4.20', { timestamp: TS });
      const mergedState = { ...state, ...first.patch };
      const second = computeReleaseTransition(mergedState, '4.20', { timestamp: TS + 1 });
      expect(second.patch.operators.selected).toEqual(first.patch.operators.selected);
      for (const op of second.patch.operators.selected) {
        expect(op.catalogImage).toBeUndefined();
        expect(op.defaultChannel).toBeUndefined();
      }
    });

    it('stale operator without catalogImage is skipped by ImageSet builder guard', () => {
      const state = makeState('4.21', '4.21.3');
      const result = computeReleaseTransition(state, '4.20', { timestamp: TS });
      for (const op of result.patch.operators.selected) {
        const hasCatalogImage = Boolean(op.catalogImage);
        const hasDefaultChannel = Boolean(op.defaultChannel);
        expect(hasCatalogImage && hasDefaultChannel).toBe(false);
      }
    });
  });

  describe('Generator guard contract: transition output matches guard predicates', () => {
    function applyGuard(operators, catalogMinor) {
      return operators.filter(op => {
        if (!op.catalogImage || !op.defaultChannel) return false;
        const tagMatch = op.catalogImage.match(/:v(\d+\.\d+)/);
        if (tagMatch && tagMatch[1] !== catalogMinor) return false;
        return true;
      });
    }

    it('4.21→4.20 transition: all operators stripped by guard (no catalogImage/defaultChannel)', () => {
      const state = makeState('4.21', '4.21.3');
      const result = computeReleaseTransition(state, '4.20', { timestamp: TS });
      const surviving = applyGuard(result.patch.operators.selected, '4.20');
      expect(surviving).toHaveLength(0);
    });

    it('mixed stale 4.21 + fresh 4.20 operator: only fresh passes guard', () => {
      const staleOps = [
        { name: 'stale-op', id: 'stale-op-redhat', catalogImage: 'registry.redhat.io/redhat/redhat-operator-index:v4.21', defaultChannel: 'stable' },
        { name: 'fresh-op', id: 'fresh-op-redhat', catalogImage: 'registry.redhat.io/redhat/redhat-operator-index:v4.20', defaultChannel: 'stable-v2' },
      ];
      const surviving = applyGuard(staleOps, '4.20');
      expect(surviving).toHaveLength(1);
      expect(surviving[0].name).toBe('fresh-op');
    });

    it('same-minor operators: all pass guard', () => {
      const state = makeState('4.21', '4.21.3');
      const result = computeReleaseTransition(state, '4.21', { timestamp: TS });
      const surviving = applyGuard(result.patch.operators.selected, '4.21');
      expect(surviving).toHaveLength(2);
      expect(surviving[0].name).toBe('odf-operator');
      expect(surviving[1].name).toBe('compliance-operator');
    });

    it('end-to-end: 4.21→4.20 transition then guard produces empty operator list', () => {
      const state = makeState('4.21', '4.21.3');
      const result = computeReleaseTransition(state, '4.20', { timestamp: TS });
      const mergedOperators = result.patch.operators.selected;
      expect(mergedOperators).toHaveLength(2);
      expect(mergedOperators.every(op => !op.catalogImage)).toBe(true);
      const surviving = applyGuard(mergedOperators, '4.20');
      expect(surviving).toHaveLength(0);
    });
  });
});
