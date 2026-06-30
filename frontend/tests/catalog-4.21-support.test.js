/**
 * 4.21 Catalog Support Tests (DOC-102 Slice 5B)
 *
 * Proves:
 * - 4.20 catalogs still load
 * - 4.21 catalogs now load
 * - 4.21-only params exist in 4.21, not in 4.20
 * - Unknown versions still block
 */

import { describe, it, expect } from 'vitest';
import { getCatalogForScenario } from '../src/catalogPaths.js';

describe('4.21 catalog support (DOC-102 Slice 5B)', () => {
  describe('4.20 catalogs unchanged', () => {
    it('loads all 13 4.20 catalogs successfully', () => {
      const scenarios = [
        'bare-metal-agent', 'bare-metal-ipi', 'bare-metal-upi',
        'vsphere-agent', 'vsphere-ipi', 'vsphere-upi',
        'aws-govcloud-ipi', 'aws-govcloud-upi',
        'azure-government-ipi', 'azure-government-upi',
        'ibm-cloud-ipi', 'nutanix-ipi', 'oc-mirror-v2'
      ];

      scenarios.forEach(scenario => {
        const params = getCatalogForScenario(scenario, '4.20');
        expect(Array.isArray(params)).toBe(true);
        expect(params.length).toBeGreaterThan(0);
      });
    });

    it('4.20 catalogs do NOT contain 4.21-only AWS params', () => {
      const params = getCatalogForScenario('aws-govcloud-ipi', '4.20');
      const awsParams421 = params.filter(p =>
        p.path === 'controlPlane.platform.aws.cpuOptions' ||
        p.path === 'controlPlane.platform.aws.cpuOptions.confidentialCompute' ||
        p.path === 'controlPlane.platform.aws.rootVolume.throughput'
      );
      expect(awsParams421).toHaveLength(0);
    });

    it('4.20 catalogs do NOT contain 4.21-only Azure params', () => {
      const params = getCatalogForScenario('azure-government-ipi', '4.20');
      const azureParams421 = params.filter(p =>
        p.path === 'platform.azure.allowSharedKeyAccess' ||
        p.path === 'platform.azure.subnets' ||
        p.path === 'platform.azure.subnets.name' ||
        p.path === 'platform.azure.subnets.role'
      );
      expect(azureParams421).toHaveLength(0);
    });
  });

  describe('4.21 catalogs load', () => {
    it('loads 12 install-config/agent-config 4.21 catalogs successfully', () => {
      const scenarios = [
        'bare-metal-agent', 'bare-metal-ipi', 'bare-metal-upi',
        'vsphere-agent', 'vsphere-ipi', 'vsphere-upi',
        'aws-govcloud-ipi', 'aws-govcloud-upi',
        'azure-government-ipi', 'azure-government-upi',
        'ibm-cloud-ipi', 'nutanix-ipi'
        // oc-mirror-v2 DEFERRED - ImageSetConfiguration extraction still pending
      ];

      scenarios.forEach(scenario => {
        const params = getCatalogForScenario(scenario, '4.21');
        expect(Array.isArray(params)).toBe(true);
        expect(params.length).toBeGreaterThan(0);
      });
    });

    it('accepts 4.21 patch versions (e.g., 4.21.5)', () => {
      const params = getCatalogForScenario('aws-govcloud-ipi', '4.21.5');
      expect(Array.isArray(params)).toBe(true);
      expect(params.length).toBeGreaterThan(0);
    });
  });

  describe('4.21-only parameter visibility', () => {
    it('4.21 AWS catalogs contain 3 new AWS params', () => {
      const params = getCatalogForScenario('aws-govcloud-ipi', '4.21');

      const cpuOptions = params.find(p => p.path === 'controlPlane.platform.aws.cpuOptions');
      const confidentialCompute = params.find(p => p.path === 'controlPlane.platform.aws.cpuOptions.confidentialCompute');
      const throughput = params.find(p => p.path === 'controlPlane.platform.aws.rootVolume.throughput');

      expect(cpuOptions).toBeDefined();
      expect(cpuOptions.minVersion).toBe('4.21');
      expect(cpuOptions.maxVersion).toBe(null);

      expect(confidentialCompute).toBeDefined();
      expect(confidentialCompute.minVersion).toBe('4.21');
      expect(confidentialCompute.maxVersion).toBe(null);

      expect(throughput).toBeDefined();
      expect(throughput.minVersion).toBe('4.21');
      expect(throughput.maxVersion).toBe(null);
    });

    it('4.21 Azure catalogs contain 4 new Azure params', () => {
      const params = getCatalogForScenario('azure-government-ipi', '4.21');

      const allowSharedKey = params.find(p => p.path === 'platform.azure.allowSharedKeyAccess');
      const subnets = params.find(p => p.path === 'platform.azure.subnets');
      const subnetsName = params.find(p => p.path === 'platform.azure.subnets.name');
      const subnetsRole = params.find(p => p.path === 'platform.azure.subnets.role');

      expect(allowSharedKey).toBeDefined();
      expect(allowSharedKey.minVersion).toBe('4.21');
      expect(allowSharedKey.maxVersion).toBe(null);

      expect(subnets).toBeDefined();
      expect(subnets.minVersion).toBe('4.21');
      expect(subnets.maxVersion).toBe(null);

      expect(subnetsName).toBeDefined();
      expect(subnetsName.minVersion).toBe('4.21');
      expect(subnetsName.maxVersion).toBe(null);

      expect(subnetsRole).toBeDefined();
      expect(subnetsRole.minVersion).toBe('4.21');
      expect(subnetsRole.maxVersion).toBe(null);
    });

    it('all 7 new params have catalog-only supportStatus', () => {
      const awsParams = getCatalogForScenario('aws-govcloud-ipi', '4.21');
      const azureParams = getCatalogForScenario('azure-government-ipi', '4.21');

      const new421Params = [...awsParams, ...azureParams].filter(p => p.minVersion === '4.21');
      expect(new421Params).toHaveLength(7);

      new421Params.forEach(p => {
        expect(p.supportStatus).toBe('catalog-only');
      });
    });
  });

  describe('Version blocking unchanged', () => {
    it('4.99 future version still throws clearly', () => {
      expect(() => getCatalogForScenario('aws-govcloud-ipi', '4.99'))
        .toThrow(/OpenShift 4.99 is not supported yet/);
    });

    it('4.22 future version still throws clearly', () => {
      expect(() => getCatalogForScenario('aws-govcloud-ipi', '4.22'))
        .toThrow(/OpenShift 4.22 is not supported yet/);
    });

    it('invalid version format still throws', () => {
      expect(() => getCatalogForScenario('aws-govcloud-ipi', 'invalid'))
        .toThrow(/Invalid version format/);
    });

    it('unknown scenario still throws with available list', () => {
      expect(() => getCatalogForScenario('unknown-scenario', '4.21'))
        .toThrow(/Catalog not found for scenario "unknown-scenario"/);
      expect(() => getCatalogForScenario('unknown-scenario', '4.21'))
        .toThrow(/Available scenarios:/);
    });
  });

  describe('No deferred platforms/scenarios added', () => {
    it('PowerVC catalogs do not exist', () => {
      expect(() => getCatalogForScenario('powervc-ipi', '4.21'))
        .toThrow(/Catalog not found/);
    });

    it('GCP catalogs do not exist', () => {
      expect(() => getCatalogForScenario('gcp-ipi', '4.21'))
        .toThrow(/Catalog not found/);
    });

    it('OpenStack catalogs do not exist', () => {
      expect(() => getCatalogForScenario('openstack-ipi', '4.21'))
        .toThrow(/Catalog not found/);
    });

    it('oc-mirror 4.21 catalog does not exist (ImageSetConfiguration deferred)', () => {
      expect(() => getCatalogForScenario('oc-mirror-v2', '4.21'))
        .toThrow(/Catalog not found for scenario "oc-mirror-v2"/);
      expect(() => getCatalogForScenario('oc-mirror-v2', '4.21'))
        .toThrow(/Available scenarios:/);
    });
  });
});
