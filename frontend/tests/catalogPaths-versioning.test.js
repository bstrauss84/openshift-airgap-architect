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

    it('uses 4.20 as default when version not specified', () => {
      const params = getCatalogForScenario('bare-metal-agent');
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
    it('throws clear error for 4.21 (catalog does not exist)', () => {
      expect(() => getCatalogForScenario('bare-metal-agent', '4.21'))
        .toThrow(/OpenShift 4.21 is not supported yet/);
      expect(() => getCatalogForScenario('bare-metal-agent', '4.21'))
        .toThrow(/Supported versions: 4.20/);
    });

    it('throws clear error for 4.99 (future version)', () => {
      expect(() => getCatalogForScenario('bare-metal-agent', '4.99'))
        .toThrow(/OpenShift 4.99 is not supported yet/);
    });

    it('throws clear error for invalid version format', () => {
      expect(() => getCatalogForScenario('bare-metal-agent', 'invalid'))
        .toThrow(/Invalid version format/);
    });

    it('throws clear error for empty version', () => {
      expect(() => getCatalogForScenario('bare-metal-agent', ''))
        .toThrow(/Invalid version/);
    });

    it('throws clear error for null version', () => {
      expect(() => getCatalogForScenario('bare-metal-agent', null))
        .toThrow(/Invalid version/);
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
      expect(() => getCatalogForScenario('bare-metal-agent', '4.21'))
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
      expect(() => getCatalogParameters('bare-metal-agent', '4.21'))
        .toThrow(/OpenShift 4.21 is not supported yet/);
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
      expect(() => getCatalogPaths('bare-metal-agent', '4.21'))
        .toThrow(/OpenShift 4.21 is not supported yet/);
    });
  });
});
