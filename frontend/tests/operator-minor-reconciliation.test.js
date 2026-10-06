import { describe, it, expect } from 'vitest';
import {
  buildInvalidatedOperatorState,
  computeOperatorMinorInvalidation,
  getResolvedOperatorMinor,
  hasCrossMinorOperatorState,
  isOperatorResolved,
  reconcileOperatorsForMinor,
  catalogImagesForMinor,
} from '../src/shared/operatorMinorReconciliation.js';

const resolvedOp = (name, minor, catalog = 'redhat', sources = ['odf']) => ({
  name,
  id: `${name}-${catalog}`,
  displayName: `${name} display`,
  catalogImage: catalogImagesForMinor(minor)[catalog],
  defaultChannel: 'stable',
  sources,
});

const operatorsAt = (minor) => ({
  selected: [resolvedOp('odf-operator', minor), resolvedOp('local-storage-operator', minor)],
  catalogs: { redhat: [{ id: 'x' }], certified: [], community: [] },
  version: minor,
  scenarios: { odf: true },
  scenarioAdded: { 'odf-operator-redhat': { odf: true } },
  scanJobs: { redhat: 'job-1' },
  cachedAt: 123,
  stale: false,
  fastMode: false,
});

describe('getResolvedOperatorMinor', () => {
  it('prefers the recorded scan minor', () => {
    expect(getResolvedOperatorMinor(operatorsAt('4.21'))).toBe('4.21');
  });

  it('falls back to the catalog image tag when no minor was recorded', () => {
    const ops = { ...operatorsAt('4.21'), version: null };
    expect(getResolvedOperatorMinor(ops)).toBe('4.21');
  });

  it('returns null when nothing has been resolved', () => {
    expect(getResolvedOperatorMinor({ selected: [{ name: 'a', id: 'a' }] })).toBeNull();
    expect(getResolvedOperatorMinor(undefined)).toBeNull();
  });
});

describe('hasCrossMinorOperatorState', () => {
  it('detects a changed locked minor', () => {
    expect(hasCrossMinorOperatorState(operatorsAt('4.21'), '4.20')).toBe(true);
  });

  it('is false for the same minor', () => {
    expect(hasCrossMinorOperatorState(operatorsAt('4.21'), '4.21')).toBe(false);
  });

  it('is false when nothing was ever resolved', () => {
    expect(hasCrossMinorOperatorState({ selected: [] }, '4.21')).toBe(false);
  });
});

describe('computeOperatorMinorInvalidation', () => {
  it('returns null for a same-minor lock so state is left alone', () => {
    expect(computeOperatorMinorInvalidation(operatorsAt('4.21'), '4.21')).toBeNull();
  });

  describe('4.21 → 4.20', () => {
    const next = computeOperatorMinorInvalidation(operatorsAt('4.21'), '4.20');

    it('invalidates resolved catalog/channel metadata', () => {
      for (const op of next.selected) {
        expect(op.catalogImage).toBeUndefined();
        expect(op.defaultChannel).toBeUndefined();
      }
    });

    it('clears catalogs, scan identity and cache', () => {
      expect(next.catalogs).toEqual({});
      expect(next.version).toBeNull();
      expect(next.scanJobs).toEqual({});
      expect(next.cachedAt).toBeNull();
      expect(next.stale).toBe(true);
    });

    it('stops presenting quick picks as actively selected', () => {
      expect(next.scenarios).toEqual({});
    });

    it('retains quick-pick intent separately', () => {
      expect(next.pendingScenarios).toEqual({ odf: true });
    });

    it('retains package intent and provenance', () => {
      expect(next.selected.map((op) => op.name)).toEqual(['odf-operator', 'local-storage-operator']);
      expect(next.selected[0].sources).toEqual(['odf']);
      expect(next.scenarioAdded).toEqual({ 'odf-operator-redhat': { odf: true } });
    });

    it('keeps display names so preserved intent stays readable', () => {
      expect(next.selected[0].displayName).toBe('odf-operator display');
    });
  });

  it('merges already-pending intent rather than dropping it on a second transition', () => {
    const ops = { ...operatorsAt('4.21'), scenarios: { ai: true }, pendingScenarios: { odf: true } };
    const next = computeOperatorMinorInvalidation(ops, '4.20');
    expect(next.pendingScenarios).toEqual({ odf: true, ai: true });
  });
});

describe('buildInvalidatedOperatorState', () => {
  it('handles entirely absent operator state', () => {
    const next = buildInvalidatedOperatorState(undefined);
    expect(next.selected).toEqual([]);
    expect(next.scenarios).toEqual({});
    expect(next.pendingScenarios).toEqual({});
    expect(next.stale).toBe(true);
  });
});

describe('reconcileOperatorsForMinor', () => {
  const invalidated = computeOperatorMinorInvalidation(operatorsAt('4.21'), '4.20');

  const catalogs420 = {
    redhat: [
      { id: 'odf-operator-redhat', name: 'odf-operator', displayName: 'OpenShift Data Foundation', defaultChannel: 'stable-4.20' },
      { id: 'local-storage-operator-redhat', name: 'local-storage-operator', defaultChannel: 'stable' },
    ],
    certified: [],
    community: [],
  };

  describe('all intent available in the new minor', () => {
    const next = reconcileOperatorsForMinor(invalidated, catalogs420, '4.20');

    it('re-resolves selections against the new minor catalogs', () => {
      expect(next.selected.every(isOperatorResolved)).toBe(true);
      expect(next.selected[0].catalogImage).toBe(catalogImagesForMinor('4.20').redhat);
      expect(next.selected[0].defaultChannel).toBe('stable-4.20');
    });

    it('never carries a previous-minor catalog tag forward', () => {
      for (const op of next.selected) {
        expect(op.catalogImage).not.toContain('v4.21');
      }
    });

    it('restores the quick pick to an active selection', () => {
      expect(next.scenarios).toEqual({ odf: true });
      expect(next.pendingScenarios).toEqual({});
    });

    it('reports no unresolved intent', () => {
      expect(next.unresolvedIntent).toEqual([]);
    });
  });

  describe('intent unavailable in the new minor', () => {
    const partial = { redhat: [catalogs420.redhat[1]], certified: [], community: [] };
    const next = reconcileOperatorsForMinor(invalidated, partial, '4.20');

    it('surfaces the unavailable package as a conflict', () => {
      expect(next.unresolvedIntent).toEqual(['odf-operator']);
    });

    it('leaves the unavailable package unresolved so the generator omits it', () => {
      const odf = next.selected.find((op) => op.name === 'odf-operator');
      expect(isOperatorResolved(odf)).toBe(false);
    });

    it('keeps the owning quick pick pending rather than silently activating it', () => {
      expect(next.scenarios.odf).toBeUndefined();
      expect(next.pendingScenarios).toEqual({ odf: true });
    });
  });

  it('returns null when there is nothing to reconcile', () => {
    expect(reconcileOperatorsForMinor(operatorsAt('4.20'), catalogs420, '4.20')).toBeNull();
  });

  it('returns null for an unparseable minor', () => {
    expect(reconcileOperatorsForMinor(invalidated, catalogs420, '')).toBeNull();
  });

  it('drops a pending quick pick whose operators the user has since removed', () => {
    const orphaned = { ...invalidated, selected: [] };
    const next = reconcileOperatorsForMinor(orphaned, catalogs420, '4.20');
    expect(next.pendingScenarios).toEqual({});
    expect(next.scenarios.odf).toBeUndefined();
  });

  it('does not disturb entries already resolved for the current minor', () => {
    const mixed = {
      selected: [resolvedOp('already-ok', '4.20'), { name: 'odf-operator', id: 'odf-operator-redhat', sources: ['odf'] }],
      pendingScenarios: { odf: true },
    };
    const next = reconcileOperatorsForMinor(mixed, catalogs420, '4.20');
    expect(next.selected[0]).toEqual(mixed.selected[0]);
    expect(isOperatorResolved(next.selected[1])).toBe(true);
  });
});
