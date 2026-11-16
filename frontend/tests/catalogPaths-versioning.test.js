/**
 * Catalog Paths Versioning Tests
 *
 * Tests for version-aware catalog loading (ADR-005).
 * Ensures unsupported versions throw clear errors and no silent fallback occurs.
 */

import { describe, it, expect } from 'vitest';
import { getCatalogForScenario, getCatalogParameters, getCatalogPaths } from '../src/catalogPaths.js';

describe('Catalog versioning (ADR-005)', () => {
  describe('4.20 catalog loading', () => {
    it('loads all 13 4.20 catalogs successfully', () => {
      const scenarios = [
        'bare-metal-agent',
        'bare-metal-ipi',
        'bare-metal-upi',
        'vsphere-agent',
        'vsphere-ipi',
        'vsphere-upi',
        'aws-govcloud-ipi',
        'aws-govcloud-upi',
        'azure-government-ipi',
        'azure-government-upi',
        'ibm-cloud-ipi',
        'nutanix-ipi',
        'oc-mirror-v2'
      ];

      scenarios.forEach(scenario => {
        const params = getCatalogForScenario(scenario, '4.20');
        expect(Array.isArray(params)).toBe(true);
        expect(params.length).toBeGreaterThan(0);
      });
    });

    /**
     * REPLACED IN TRANCHE 7C.1. This test asserted the defect.
     *
     * It pinned `getCatalogForScenario('bare-metal-agent')` — no version —
     * returning the 4.20 catalog. That default was harmless while every
     * catalog was bundled eagerly, and became the enabler for the cold-start
     * CatalogNotLoadedError once catalogs were lazy-loaded per minor: three
     * callers omitted the version and each silently read a 4.20 catalog that
     * had never been fetched. It also contradicted the No Fallback Rule, which
     * forbids answering for a minor the user did not select.
     *
     * The contract is now the opposite: a missing minor is an error.
     */
    it('refuses to answer when the version is not specified', () => {
      expect(() => getCatalogForScenario('bare-metal-agent'))
        .toThrow(/requires an explicit OpenShift minor/);
    });

    it('returns the 4.20 catalog only when 4.20 is asked for explicitly', () => {
      const params = getCatalogForScenario('bare-metal-agent', '4.20');
      expect(Array.isArray(params)).toBe(true);
      expect(params.length).toBeGreaterThan(0);
    });

    it('accepts patch versions and extracts minor', () => {
      const params = getCatalogForScenario('bare-metal-agent', '4.20.15');
      expect(Array.isArray(params)).toBe(true);
      expect(params.length).toBeGreaterThan(0);
    });
  });

  describe('Unsupported version blocking', () => {
    it('throws clear error for 4.23 (future version, catalog does not exist)', () => {
      expect(() => getCatalogForScenario('bare-metal-agent', '4.23'))
        .toThrow(/OpenShift 4.23 is not supported by this version of OpenShift Airgap Architect/);
      expect(() => getCatalogForScenario('bare-metal-agent', '4.23'))
        .toThrow(/Supported versions: 4.20, 4.21/);
    });

    it('throws clear error for 4.99 (future version)', () => {
      expect(() => getCatalogForScenario('bare-metal-agent', '4.99'))
        .toThrow(/OpenShift 4.99 is not supported by this version of OpenShift Airgap Architect/);
    });

    it('throws clear error for invalid version format', () => {
      expect(() => getCatalogForScenario('bare-metal-agent', 'invalid'))
        .toThrow(/Invalid version format/);
    });

    // Tranche 7C.1: the `version = '4.20'` default parameter was removed, so a
    // missing minor is now a named, actionable failure rather than a silent
    // read of the baseline catalog. The error must say what the caller has to
    // do, because the three callers that triggered the cold-start crash all
    // simply forgot to pass it.
    it('throws an explicit-minor error for empty version', () => {
      expect(() => getCatalogForScenario('bare-metal-agent', ''))
        .toThrow(/requires an explicit OpenShift minor/);
    });

    it('throws an explicit-minor error for null version', () => {
      expect(() => getCatalogForScenario('bare-metal-agent', null))
        .toThrow(/requires an explicit OpenShift minor/);
    });

    it('throws an explicit-minor error when the version is omitted entirely', () => {
      // The exact shape of the defect: the argument simply is not passed.
      expect(() => getCatalogForScenario('bare-metal-agent'))
        .toThrow(/requires an explicit OpenShift minor/);
    });

    it('never silently answers from the baseline when the minor is missing', () => {
      // Guards against a future "helpful" default being reintroduced: a
      // missing minor must not return 4.20 data.
      let threw = false;
      try {
        getCatalogForScenario('bare-metal-agent');
      } catch {
        threw = true;
      }
      expect(threw, 'a missing minor returned data instead of throwing').toBe(true);
    });
  });

  describe('Invalid scenario blocking', () => {
    it('throws clear error for unknown scenario in 4.20', () => {
      expect(() => getCatalogForScenario('unknown-scenario', '4.20'))
        .toThrow(/Catalog not found for scenario "unknown-scenario"/);
      expect(() => getCatalogForScenario('unknown-scenario', '4.20'))
        .toThrow(/Available scenarios:/);
    });

    it('throws clear error for null scenario', () => {
      expect(() => getCatalogForScenario(null, '4.20'))
        .toThrow(/Invalid scenarioId/);
    });

    it('throws clear error for empty scenario', () => {
      expect(() => getCatalogForScenario('', '4.20'))
        .toThrow(/Invalid scenarioId/);
    });
  });

  describe('No silent fallback', () => {
    it('does not silently return empty array for unsupported version', () => {
      expect(() => getCatalogForScenario('bare-metal-agent', '4.23'))
        .toThrow();
      // Should NOT return []
    });

    it('does not silently return empty array for unknown scenario', () => {
      expect(() => getCatalogForScenario('fake-scenario', '4.20'))
        .toThrow();
      // Should NOT return []
    });

    it('does not silently default invalid version to 4.20', () => {
      expect(() => getCatalogForScenario('bare-metal-agent', 'bad-version'))
        .toThrow();
      // Should NOT silently use 4.20
    });
  });

  describe('getCatalogParameters alias', () => {
    it('returns same result as getCatalogForScenario', () => {
      const params1 = getCatalogForScenario('bare-metal-agent', '4.20');
      const params2 = getCatalogParameters('bare-metal-agent', '4.20');
      expect(params1).toEqual(params2);
    });

    it('throws same errors for unsupported versions', () => {
      expect(() => getCatalogParameters('bare-metal-agent', '4.23'))
        .toThrow(/OpenShift 4.23 is not supported by this version of OpenShift Airgap Architect/);
    });
  });

  describe('getCatalogPaths', () => {
    it('returns set of parameter paths for valid scenario', () => {
      const paths = getCatalogPaths('bare-metal-agent', '4.20');
      expect(paths instanceof Set).toBe(true);
      expect(paths.size).toBeGreaterThan(0);
      expect(paths.has('baseDomain')).toBe(true);
    });

    it('throws error for unsupported version', () => {
      expect(() => getCatalogPaths('bare-metal-agent', '4.23'))
        .toThrow(/OpenShift 4.23 is not supported by this version of OpenShift Airgap Architect/);
    });
  });
});
