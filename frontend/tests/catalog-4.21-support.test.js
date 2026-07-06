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

    it('4.20 catalogs do NOT contain 4.21-only manual-review params (Slice 5D)', () => {
      // Test bare-metal
      const bareMetalParams = getCatalogForScenario('bare-metal-ipi', '4.20');
      const bareMetalManualReview = bareMetalParams.filter(p =>
        p.path === 'platform.baremetal.dnsRecordsType' ||
        p.path === 'platform.baremetal.bmcVerifyCA'
      );
      expect(bareMetalManualReview).toHaveLength(0);

      // Test vsphere
      const vSphereParams = getCatalogForScenario('vsphere-ipi', '4.20');
      const vSphereManualReview = vSphereParams.filter(p =>
        p.path === 'platform.vsphere.dnsRecordsType'
      );
      expect(vSphereManualReview).toHaveLength(0);

      // Test nutanix
      const nutanixParams = getCatalogForScenario('nutanix-ipi', '4.20');
      const nutanixManualReview = nutanixParams.filter(p =>
        p.path === 'platform.nutanix.dnsRecordsType'
      );
      expect(nutanixManualReview).toHaveLength(0);
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

    it('4.21 bare-metal catalogs contain 2 new manual-review params (Slice 5D)', () => {
      // Test all 3 bare-metal scenarios
      ['bare-metal-ipi', 'bare-metal-upi', 'bare-metal-agent'].forEach(scenario => {
        const params = getCatalogForScenario(scenario, '4.21');

        const dnsRecordsType = params.find(p => p.path === 'platform.baremetal.dnsRecordsType');
        const bmcVerifyCA = params.find(p => p.path === 'platform.baremetal.bmcVerifyCA');

        expect(dnsRecordsType).toBeDefined();
        expect(dnsRecordsType.minVersion).toBe('4.21');
        expect(dnsRecordsType.maxVersion).toBe(null);
        expect(dnsRecordsType.supportStatus).toBe('catalog-only');

        expect(bmcVerifyCA).toBeDefined();
        expect(bmcVerifyCA.minVersion).toBe('4.21');
        expect(bmcVerifyCA.maxVersion).toBe(null);
        expect(bmcVerifyCA.supportStatus).toBe('catalog-only');
      });
    });

    it('4.21 vsphere catalogs contain 1 new manual-review param (Slice 5D)', () => {
      // Test all 3 vsphere scenarios
      ['vsphere-ipi', 'vsphere-upi', 'vsphere-agent'].forEach(scenario => {
        const params = getCatalogForScenario(scenario, '4.21');

        const dnsRecordsType = params.find(p => p.path === 'platform.vsphere.dnsRecordsType');

        expect(dnsRecordsType).toBeDefined();
        expect(dnsRecordsType.minVersion).toBe('4.21');
        expect(dnsRecordsType.maxVersion).toBe(null);
        expect(dnsRecordsType.supportStatus).toBe('catalog-only');
      });
    });

    it('4.21 nutanix catalog contains 1 new manual-review param (Slice 5D)', () => {
      const params = getCatalogForScenario('nutanix-ipi', '4.21');

      const dnsRecordsType = params.find(p => p.path === 'platform.nutanix.dnsRecordsType');

      expect(dnsRecordsType).toBeDefined();
      expect(dnsRecordsType.minVersion).toBe('4.21');
      expect(dnsRecordsType.maxVersion).toBe(null);
      expect(dnsRecordsType.supportStatus).toBe('catalog-only');
    });

    it('all 7 high-confidence params (Slice 5B) have catalog-only supportStatus', () => {
      const awsParams = getCatalogForScenario('aws-govcloud-ipi', '4.21');
      const azureParams = getCatalogForScenario('azure-government-ipi', '4.21');

      const highConfParams = [...awsParams, ...azureParams].filter(p =>
        p.minVersion === '4.21' &&
        (p.path.includes('aws.cpuOptions') ||
         p.path.includes('aws.rootVolume.throughput') ||
         p.path.includes('azure.allowSharedKeyAccess') ||
         p.path.includes('azure.subnets'))
      );
      expect(highConfParams).toHaveLength(7);

      highConfParams.forEach(p => {
        expect(p.supportStatus).toBe('catalog-only');
      });
    });

    it('all 4 manual-review params (Slice 5D) have catalog-only supportStatus', () => {
      const bareMetalIpi = getCatalogForScenario('bare-metal-ipi', '4.21');
      const vSphereIpi = getCatalogForScenario('vsphere-ipi', '4.21');
      const nutanixIpi = getCatalogForScenario('nutanix-ipi', '4.21');

      const manualReviewParams = [...bareMetalIpi, ...vSphereIpi, ...nutanixIpi].filter(p =>
        p.minVersion === '4.21' &&
        (p.path.includes('dnsRecordsType') || p.path.includes('bmcVerifyCA'))
      );

      // bare-metal-ipi: 2 params (dnsRecordsType + bmcVerifyCA)
      // vsphere-ipi: 1 param (dnsRecordsType)
      // nutanix-ipi: 1 param (dnsRecordsType)
      expect(manualReviewParams).toHaveLength(4);

      manualReviewParams.forEach(p => {
        expect(p.supportStatus).toBe('catalog-only');
        expect(p.outputFile).toBe('install-config.yaml');
      });
    });
  });

  describe('Version blocking unchanged', () => {
    it('4.99 future version still throws clearly', () => {
      expect(() => getCatalogForScenario('aws-govcloud-ipi', '4.99'))
        .toThrow(/OpenShift 4.99 is not supported by this version of OpenShift Airgap Architect/);
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
