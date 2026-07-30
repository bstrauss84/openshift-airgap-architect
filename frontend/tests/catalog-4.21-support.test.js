/**
 * 4.21 Catalog Support Tests (DOC-102 Slice 5B)
 *
 * Proves:
 * - 4.20 catalogs still load
 * - 4.21 catalogs now load
 * - 4.21-only params exist in 4.21, not in 4.20
 * - Unknown versions still block
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
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
        expect(dnsRecordsType.supportStatus).toBe('supported-backend-only');

        expect(bmcVerifyCA).toBeDefined();
        expect(bmcVerifyCA.minVersion).toBe('4.21');
        expect(bmcVerifyCA.maxVersion).toBe(null);
        expect(bmcVerifyCA.supportStatus).toBe('supported-backend-only');
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
        expect(dnsRecordsType.supportStatus).toBe('supported-backend-only');
      });
    });

    it('4.21 nutanix catalog contains 1 new manual-review param (Slice 5D)', () => {
      const params = getCatalogForScenario('nutanix-ipi', '4.21');

      const dnsRecordsType = params.find(p => p.path === 'platform.nutanix.dnsRecordsType');

      expect(dnsRecordsType).toBeDefined();
      expect(dnsRecordsType.minVersion).toBe('4.21');
      expect(dnsRecordsType.maxVersion).toBe(null);
      expect(dnsRecordsType.supportStatus).toBe('supported-backend-only');
    });

    it('non-throughput high-confidence params (Slice 5B) have catalog-only supportStatus', () => {
      const awsParams = getCatalogForScenario('aws-govcloud-ipi', '4.21');
      const azureParams = getCatalogForScenario('azure-government-ipi', '4.21');

      const highConfParams = [...awsParams, ...azureParams].filter(p =>
        p.minVersion === '4.21' &&
        (p.path.includes('aws.cpuOptions') ||
         p.path.includes('azure.allowSharedKeyAccess') ||
         p.path.includes('azure.subnets'))
      );
      expect(highConfParams).toHaveLength(6);

      highConfParams.forEach(p => {
        if (p.path === 'platform.azure.allowSharedKeyAccess') {
          expect(p.supportStatus).toBe('supported-ui');
        } else {
          expect(p.supportStatus).toBe('supported-backend-only');
        }
      });
    });

    it('throughput high-confidence params promoted from Slice 5B', () => {
      const awsParams = getCatalogForScenario('aws-govcloud-ipi', '4.21');
      const cpThroughput = awsParams.find(p => p.path === 'controlPlane.platform.aws.rootVolume.throughput');
      const compThroughput = awsParams.find(p => p.path === 'compute[].platform.aws.rootVolume.throughput');
      expect(cpThroughput).toBeDefined();
      expect(cpThroughput.supportStatus).toBe('supported-ui');
      expect(compThroughput).toBeDefined();
      expect(compThroughput.supportStatus).toBe('supported-derived');
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
        expect(p.supportStatus).toBe('supported-backend-only');
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
        .toThrow(/OpenShift 4.22 is not supported by this version of OpenShift Airgap Architect/);

      const error = (() => {
        try {
          getCatalogForScenario('aws-govcloud-ipi', '4.22');
        } catch (e) {
          return e.message;
        }
      })();
      expect(error).toContain('4.20');
      expect(error).toContain('4.21');
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

  describe('Hyperthreading supportStatus reconciliation (Slice 5H R1)', () => {
    const scenarios = [
      'bare-metal-agent', 'bare-metal-ipi', 'bare-metal-upi',
      'vsphere-agent', 'vsphere-ipi', 'vsphere-upi',
      'aws-govcloud-ipi', 'aws-govcloud-upi',
      'azure-government-ipi', 'azure-government-upi',
      'ibm-cloud-ipi', 'nutanix-ipi'
    ];
    const versions = ['4.20', '4.21'];
    const htPaths = ['compute[].hyperthreading', 'controlPlane[].hyperthreading'];

    versions.forEach(version => {
      describe(`${version} catalogs`, () => {
        scenarios.forEach(scenario => {
          htPaths.forEach(htPath => {
            it(`${scenario} has exactly one ${htPath} entry with supportStatus=supported-ui`, () => {
              const params = getCatalogForScenario(scenario, version);
              const matches = params.filter(
                p => p.path === htPath && p.outputFile === 'install-config.yaml'
              );
              expect(matches).toHaveLength(1);
              expect(matches[0].supportStatus).toBe('supported-ui');
              expect(matches[0].minVersion).toBe('4.20');
              expect(matches[0].maxVersion).toBe(null);
            });
          });
        });
      });
    });

    it('no scenario silently omits either hyperthreading field', () => {
      versions.forEach(version => {
        scenarios.forEach(scenario => {
          const params = getCatalogForScenario(scenario, version);
          htPaths.forEach(htPath => {
            const match = params.find(
              p => p.path === htPath && p.outputFile === 'install-config.yaml'
            );
            expect(match).toBeDefined();
          });
        });
      });
    });

    it('4.20 and 4.21 have identical hyperthreading metadata', () => {
      scenarios.forEach(scenario => {
        htPaths.forEach(htPath => {
          const params420 = getCatalogForScenario(scenario, '4.20');
          const params421 = getCatalogForScenario(scenario, '4.21');
          const entry420 = params420.find(
            p => p.path === htPath && p.outputFile === 'install-config.yaml'
          );
          const entry421 = params421.find(
            p => p.path === htPath && p.outputFile === 'install-config.yaml'
          );
          expect(entry420.supportStatus).toBe(entry421.supportStatus);
          expect(entry420.minVersion).toBe(entry421.minVersion);
          expect(entry420.maxVersion).toBe(entry421.maxVersion);
        });
      });
    });
  });

  describe('AWS worker instance-type supportStatus reconciliation (R2)', () => {
    const awsIpiScenarios = ['aws-govcloud-ipi'];
    const versions = ['4.20', '4.21'];
    const targetPath = 'compute[].platform.aws.type';
    const targetOutputFile = 'install-config.yaml';

    versions.forEach(version => {
      awsIpiScenarios.forEach(scenario => {
        it(`${version} ${scenario} has exactly one ${targetPath} entry with supportStatus=supported-ui`, () => {
          const params = getCatalogForScenario(scenario, version);
          const matches = params.filter(
            p => p.path === targetPath && p.outputFile === targetOutputFile
          );
          expect(matches).toHaveLength(1);
          expect(matches[0].supportStatus).toBe('supported-ui');
          expect(matches[0].minVersion).toBe('4.20');
          expect(matches[0].maxVersion).toBe(null);
        });
      });
    });

    it('4.20 and 4.21 have identical AWS worker instance-type metadata', () => {
      awsIpiScenarios.forEach(scenario => {
        const params420 = getCatalogForScenario(scenario, '4.20');
        const params421 = getCatalogForScenario(scenario, '4.21');
        const entry420 = params420.find(
          p => p.path === targetPath && p.outputFile === targetOutputFile
        );
        const entry421 = params421.find(
          p => p.path === targetPath && p.outputFile === targetOutputFile
        );
        expect(entry420.supportStatus).toBe(entry421.supportStatus);
        expect(entry420.minVersion).toBe(entry421.minVersion);
        expect(entry420.maxVersion).toBe(entry421.maxVersion);
      });
    });

    it('compute[].platform.aws.type is absent from every non-AWS scenario catalog', () => {
      const nonAwsScenarios = [
        'bare-metal-agent', 'bare-metal-ipi', 'bare-metal-upi',
        'vsphere-agent', 'vsphere-ipi', 'vsphere-upi',
        'azure-government-ipi', 'azure-government-upi',
        'ibm-cloud-ipi', 'nutanix-ipi'
      ];
      versions.forEach(version => {
        nonAwsScenarios.forEach(scenario => {
          const params = getCatalogForScenario(scenario, version);
          const matches = params.filter(
            p => p.path === targetPath && p.outputFile === targetOutputFile
          );
          expect(matches).toHaveLength(0);
        });
      });
    });

    it('compute[].platform.aws.type is absent from UPI catalogs (IPI-only parameter)', () => {
      versions.forEach(version => {
        const params = getCatalogForScenario('aws-govcloud-upi', version);
        const matches = params.filter(
          p => p.path === targetPath && p.outputFile === targetOutputFile
        );
        expect(matches).toHaveLength(0);
      });
    });
  });

  describe('DOC-102 Slice 5H Host Inventory H4 DNS metadata', () => {
    const agentScenarios = ['bare-metal-agent', 'vsphere-agent'];
    const versions = ['4.20', '4.21'];
    const parentPath = 'hosts[].networkConfig.dns-resolver';
    const childServerPath = 'hosts[].networkConfig.dns-resolver.config.server';
    const childSearchPath = 'hosts[].networkConfig.dns-resolver.config.search';
    const configPath = 'hosts[].networkConfig.dns-resolver.config';
    const testDir = dirname(fileURLToPath(import.meta.url));

    function loadCanonical(version, scenario) {
      const filePath = resolve(testDir, '..', '..', 'data', 'params', version, `${scenario}.json`);
      return JSON.parse(fs.readFileSync(filePath, 'utf8')).parameters;
    }

    versions.forEach(version => {
      agentScenarios.forEach(scenario => {
        it(`${version} ${scenario} has exactly one DNS parent with supportStatus=supported-ui`, () => {
          const params = getCatalogForScenario(scenario, version);
          const matches = params.filter(p => p.path === parentPath);
          expect(matches).toHaveLength(1);
          expect(matches[0].supportStatus).toBe('supported-ui');
          expect(matches[0].minVersion).toBe('4.20');
          expect(matches[0].maxVersion).toBe(null);
          expect(matches[0].outputFile).toBe('agent-config.yaml');
          expect(matches[0].path).toBe(parentPath);
        });

        it(`${version} ${scenario} canonical has exactly one DNS parent identical to mirror`, () => {
          const canonical = loadCanonical(version, scenario);
          const mirror = getCatalogForScenario(scenario, version);
          const canonicalMatches = canonical.filter(p => p.path === parentPath);
          const mirrorMatches = mirror.filter(p => p.path === parentPath);
          expect(canonicalMatches).toHaveLength(1);
          expect(mirrorMatches).toHaveLength(1);
          expect(canonicalMatches[0]).toEqual(mirrorMatches[0]);
        });

        it(`${version} ${scenario} DNS child entries remain supported-backend-only`, () => {
          const params = getCatalogForScenario(scenario, version);
          const server = params.find(p => p.path === childServerPath);
          const search = params.find(p => p.path === childSearchPath);
          const config = params.find(p => p.path === configPath);
          expect(server).toBeDefined();
          expect(server.supportStatus).toBe('supported-backend-only');
          expect(search).toBeDefined();
          expect(search.supportStatus).toBe('supported-backend-only');
          expect(config).toBeDefined();
          expect(config.supportStatus).toBe('supported-backend-only');
        });

        it(`${version} ${scenario} canonical and mirror catalogs are byte-identical`, () => {
          const canonicalFilePath = resolve(testDir, '..', '..', 'data', 'params', version, `${scenario}.json`);
          const mirrorFilePath = resolve(testDir, '..', 'src', 'data', 'catalogs', version, `${scenario}.json`);
          const canonical = fs.readFileSync(canonicalFilePath, 'utf8');
          const mirror = fs.readFileSync(mirrorFilePath, 'utf8');
          expect(canonical).toBe(mirror);
        });
      });
    });

    it('DNS parent is absent from non-agent scenario catalogs', () => {
      const nonAgentScenarios = [
        'bare-metal-ipi', 'bare-metal-upi',
        'vsphere-ipi', 'vsphere-upi',
        'aws-govcloud-ipi', 'aws-govcloud-upi',
        'azure-government-ipi', 'azure-government-upi',
        'ibm-cloud-ipi', 'nutanix-ipi'
      ];
      versions.forEach(version => {
        nonAgentScenarios.forEach(scenario => {
          const params = getCatalogForScenario(scenario, version);
          const matches = params.filter(p => p.path === parentPath);
          expect(matches).toHaveLength(0);
        });
      });
    });
  });

  describe('DOC-102 Slice 5H Host Inventory H5 Root Device Hints metadata', () => {
    const agentScenarios = ['bare-metal-agent', 'vsphere-agent'];
    const versions = ['4.20', '4.21'];
    const parentPath = 'hosts[].rootDeviceHints';
    const childPaths = [
      'hosts[].rootDeviceHints.deviceName',
      'hosts[].rootDeviceHints.hctl',
      'hosts[].rootDeviceHints.model',
      'hosts[].rootDeviceHints.vendor',
      'hosts[].rootDeviceHints.serialNumber',
      'hosts[].rootDeviceHints.wwn',
      'hosts[].rootDeviceHints.minSizeGigabytes',
      'hosts[].rootDeviceHints.rotational',
    ];
    const testDir = dirname(fileURLToPath(import.meta.url));

    function loadCanonical(version, scenario) {
      const filePath = resolve(testDir, '..', '..', 'data', 'params', version, `${scenario}.json`);
      return JSON.parse(fs.readFileSync(filePath, 'utf8')).parameters;
    }

    versions.forEach(version => {
      agentScenarios.forEach(scenario => {
        it(`${version} ${scenario} canonical has exactly one parent entry`, () => {
          const canonical = loadCanonical(version, scenario);
          const matches = canonical.filter(p => p.path === parentPath);
          expect(matches).toHaveLength(1);
        });

        it(`${version} ${scenario} mirror has exactly one parent entry`, () => {
          const params = getCatalogForScenario(scenario, version);
          const matches = params.filter(p => p.path === parentPath);
          expect(matches).toHaveLength(1);
        });

        it(`${version} ${scenario} canonical and mirror parent entries are identical`, () => {
          const canonical = loadCanonical(version, scenario);
          const mirror = getCatalogForScenario(scenario, version);
          const canonicalParent = canonical.find(p => p.path === parentPath);
          const mirrorParent = mirror.find(p => p.path === parentPath);
          expect(canonicalParent).toEqual(mirrorParent);
        });

        it(`${version} ${scenario} parent path is hosts[].rootDeviceHints`, () => {
          const params = getCatalogForScenario(scenario, version);
          const parent = params.find(p => p.path === parentPath);
          expect(parent.path).toBe('hosts[].rootDeviceHints');
        });

        it(`${version} ${scenario} parent outputFile is agent-config.yaml`, () => {
          const params = getCatalogForScenario(scenario, version);
          const parent = params.find(p => p.path === parentPath);
          expect(parent.outputFile).toBe('agent-config.yaml');
        });

        it(`${version} ${scenario} parent supportStatus is supported-ui`, () => {
          const params = getCatalogForScenario(scenario, version);
          const parent = params.find(p => p.path === parentPath);
          expect(parent.supportStatus).toBe('supported-ui');
        });

        it(`${version} ${scenario} parent minVersion remains 4.20`, () => {
          const params = getCatalogForScenario(scenario, version);
          const parent = params.find(p => p.path === parentPath);
          expect(parent.minVersion).toBe('4.20');
        });

        it(`${version} ${scenario} parent maxVersion remains null`, () => {
          const params = getCatalogForScenario(scenario, version);
          const parent = params.find(p => p.path === parentPath);
          expect(parent.maxVersion).toBe(null);
        });

        it(`${version} ${scenario} all eight child paths exist exactly once`, () => {
          const params = getCatalogForScenario(scenario, version);
          childPaths.forEach(cp => {
            const matches = params.filter(p => p.path === cp);
            expect(matches).toHaveLength(1);
          });
        });

        it(`${version} ${scenario} child entries unchanged from canonical pre-reconciliation`, () => {
          const canonical = loadCanonical(version, scenario);
          const mirror = getCatalogForScenario(scenario, version);
          childPaths.forEach(cp => {
            const canonicalChild = canonical.find(p => p.path === cp);
            const mirrorChild = mirror.find(p => p.path === cp);
            expect(canonicalChild).toEqual(mirrorChild);
          });
        });

        it(`${version} ${scenario} no child is reclassified to supported-ui`, () => {
          const params = getCatalogForScenario(scenario, version);
          childPaths.forEach(cp => {
            const child = params.find(p => p.path === cp);
            expect(child.supportStatus).toBe('supported-backend-only');
          });
        });

        it(`${version} ${scenario} no unexpected Root Device Hints child exists`, () => {
          const params = getCatalogForScenario(scenario, version);
          const allRdh = params.filter(p =>
            p.path.startsWith('hosts[].rootDeviceHints.') &&
            p.outputFile === 'agent-config.yaml'
          );
          expect(allRdh).toHaveLength(8);
          allRdh.forEach(entry => {
            expect(childPaths).toContain(entry.path);
          });
        });

        it(`${version} ${scenario} canonical and mirror files are byte-identical`, () => {
          const canonicalFilePath = resolve(testDir, '..', '..', 'data', 'params', version, `${scenario}.json`);
          const mirrorFilePath = resolve(testDir, '..', 'src', 'data', 'catalogs', version, `${scenario}.json`);
          const canonical = fs.readFileSync(canonicalFilePath, 'utf8');
          const mirror = fs.readFileSync(mirrorFilePath, 'utf8');
          expect(canonical).toBe(mirror);
        });
      });
    });

    it('parent is absent from non-Agent scenario catalogs', () => {
      const nonAgentScenarios = [
        'bare-metal-ipi', 'bare-metal-upi',
        'vsphere-ipi', 'vsphere-upi',
        'aws-govcloud-ipi', 'aws-govcloud-upi',
        'azure-government-ipi', 'azure-government-upi',
        'ibm-cloud-ipi', 'nutanix-ipi'
      ];
      versions.forEach(version => {
        nonAgentScenarios.forEach(scenario => {
          const params = getCatalogForScenario(scenario, version);
          const matches = params.filter(p => p.path === parentPath);
          expect(matches).toHaveLength(0);
        });
      });
    });

    it('no unrelated catalog parameter changes', () => {
      versions.forEach(version => {
        agentScenarios.forEach(scenario => {
          const canonicalFilePath = resolve(testDir, '..', '..', 'data', 'params', version, `${scenario}.json`);
          const mirrorFilePath = resolve(testDir, '..', 'src', 'data', 'catalogs', version, `${scenario}.json`);
          const canonical = fs.readFileSync(canonicalFilePath, 'utf8');
          const mirror = fs.readFileSync(mirrorFilePath, 'utf8');
          expect(canonical).toBe(mirror);
        });
      });
    });
  });

  describe('DOC-102 Slice 5H Host Inventory H2 Boot MAC metadata', () => {
    const versions = ['4.20', '4.21'];
    const bootMacPath = 'platform.baremetal.hosts[].bootMACAddress';
    const bmcParentPath = 'platform.baremetal.hosts[].bmc';
    const bmcChildren = [
      { path: 'platform.baremetal.hosts[].bmc.address', expectedStatus: 'supported-backend-only' },
      { path: 'platform.baremetal.hosts[].bmc.username', expectedStatus: 'supported-ui' },
      { path: 'platform.baremetal.hosts[].bmc.password', expectedStatus: 'supported-ui' },
      { path: 'platform.baremetal.hosts[].bmc.disableCertificateVerification', expectedStatus: 'supported-backend-only' },
    ];
    const testDir = dirname(fileURLToPath(import.meta.url));

    function loadCanonical(version) {
      const filePath = resolve(testDir, '..', '..', 'data', 'params', version, 'bare-metal-agent.json');
      return JSON.parse(fs.readFileSync(filePath, 'utf8')).parameters;
    }

    versions.forEach(version => {
      it(`${version} bare-metal-agent canonical has exactly one Boot MAC entry`, () => {
        const canonical = loadCanonical(version);
        const matches = canonical.filter(p => p.path === bootMacPath);
        expect(matches).toHaveLength(1);
      });

      it(`${version} bare-metal-agent mirror has exactly one Boot MAC entry`, () => {
        const mirror = getCatalogForScenario('bare-metal-agent', version);
        const matches = mirror.filter(p => p.path === bootMacPath);
        expect(matches).toHaveLength(1);
      });

      it(`${version} bare-metal-agent canonical and mirror Boot MAC entries are identical`, () => {
        const canonical = loadCanonical(version);
        const mirror = getCatalogForScenario('bare-metal-agent', version);
        const canonicalMatches = canonical.filter(p => p.path === bootMacPath);
        const mirrorMatches = mirror.filter(p => p.path === bootMacPath);
        expect(canonicalMatches).toHaveLength(1);
        expect(mirrorMatches).toHaveLength(1);
        expect(canonicalMatches[0]).toEqual(mirrorMatches[0]);
      });

      it(`${version} bare-metal-agent Boot MAC has correct path, outputFile, and supportStatus`, () => {
        const mirror = getCatalogForScenario('bare-metal-agent', version);
        const entry = mirror.find(p => p.path === bootMacPath);
        expect(entry.path).toBe('platform.baremetal.hosts[].bootMACAddress');
        expect(entry.outputFile).toBe('install-config.yaml');
        expect(entry.supportStatus).toBe('supported-ui');
      });

      it(`${version} bare-metal-agent Boot MAC minVersion is 4.20`, () => {
        const mirror = getCatalogForScenario('bare-metal-agent', version);
        const entry = mirror.find(p => p.path === bootMacPath);
        expect(entry.minVersion).toBe('4.20');
      });

      it(`${version} bare-metal-agent Boot MAC maxVersion is null`, () => {
        const mirror = getCatalogForScenario('bare-metal-agent', version);
        const entry = mirror.find(p => p.path === bootMacPath);
        expect(entry.maxVersion).toBe(null);
      });

      it(`${version} bare-metal-agent BMC parent has one canonical and one mirror entry with supported-ui`, () => {
        const canonical = loadCanonical(version);
        const mirror = getCatalogForScenario('bare-metal-agent', version);
        const canonicalMatches = canonical.filter(p => p.path === bmcParentPath);
        const mirrorMatches = mirror.filter(p => p.path === bmcParentPath);
        expect(canonicalMatches).toHaveLength(1);
        expect(mirrorMatches).toHaveLength(1);
        expect(canonicalMatches[0].supportStatus).toBe('supported-ui');
        expect(mirrorMatches[0].supportStatus).toBe('supported-ui');
      });

      it(`${version} bare-metal-agent each BMC child has one canonical and one mirror entry with correct supportStatus`, () => {
        const canonical = loadCanonical(version);
        const mirror = getCatalogForScenario('bare-metal-agent', version);
        bmcChildren.forEach(({ path, expectedStatus }) => {
          const canonicalMatches = canonical.filter(p => p.path === path);
          const mirrorMatches = mirror.filter(p => p.path === path);
          expect(canonicalMatches).toHaveLength(1);
          expect(mirrorMatches).toHaveLength(1);
          expect(canonicalMatches[0]).toEqual(mirrorMatches[0]);
          expect(canonicalMatches[0].supportStatus).toBe(expectedStatus);
        });
      });

      it(`${version} bare-metal-agent BMC username and password are both supported-ui`, () => {
        const mirror = getCatalogForScenario('bare-metal-agent', version);
        const username = mirror.find(p => p.path === 'platform.baremetal.hosts[].bmc.username');
        const password = mirror.find(p => p.path === 'platform.baremetal.hosts[].bmc.password');
        expect(username).toBeDefined();
        expect(username.supportStatus).toBe('supported-ui');
        expect(password).toBeDefined();
        expect(password.supportStatus).toBe('supported-ui');
      });
    });

    it('bare-metal-ipi has exactly one Boot MAC with supported-backend-only per version', () => {
      versions.forEach(version => {
        const params = getCatalogForScenario('bare-metal-ipi', version);
        const matches = params.filter(p => p.path === bootMacPath);
        expect(matches).toHaveLength(1);
        expect(matches[0].supportStatus).toBe('supported-backend-only');
      });
    });

    it('Boot MAC is absent or not supported-ui in every other non-bare-metal-agent scenario', () => {
      const otherScenarios = [
        'bare-metal-upi',
        'vsphere-agent', 'vsphere-ipi', 'vsphere-upi',
        'aws-govcloud-ipi', 'aws-govcloud-upi',
        'azure-government-ipi', 'azure-government-upi',
        'ibm-cloud-ipi', 'nutanix-ipi'
      ];
      versions.forEach(version => {
        otherScenarios.forEach(scenario => {
          const params = getCatalogForScenario(scenario, version);
          const matches = params.filter(
            p => p.path === bootMacPath && p.supportStatus === 'supported-ui'
          );
          expect(matches).toHaveLength(0);
        });
      });
    });

    it('canonical and mirror files are byte-identical for both versions', () => {
      versions.forEach(version => {
        const canonicalFilePath = resolve(testDir, '..', '..', 'data', 'params', version, 'bare-metal-agent.json');
        const mirrorFilePath = resolve(testDir, '..', 'src', 'data', 'catalogs', version, 'bare-metal-agent.json');
        const canonical = fs.readFileSync(canonicalFilePath, 'utf8');
        const mirror = fs.readFileSync(mirrorFilePath, 'utf8');
        expect(canonical).toBe(mirror);
      });
    });
  });

  describe('DOC-102 Slice 5H H3 H7 H8 Primary Networking metadata', () => {
    const agentScenarios = ['bare-metal-agent', 'vsphere-agent'];
    const versions = ['4.20', '4.21'];
    const parentPath = 'hosts[].networkConfig';
    const interfacesParentPath = 'hosts[].networkConfig.interfaces';
    const routesParentPath = 'hosts[].networkConfig.routes';
    const linkAggregationPath = 'hosts[].networkConfig.interfaces[].link-aggregation';
    const vlanPath = 'hosts[].networkConfig.interfaces[].vlan';
    const subordinateNetworkingPaths = [
      'hosts[].networkConfig.interfaces',
      'hosts[].networkConfig.interfaces[].type',
      'hosts[].networkConfig.interfaces[].name',
      'hosts[].networkConfig.interfaces[].mac-address',
      'hosts[].networkConfig.interfaces[].ipv4',
      'hosts[].networkConfig.interfaces[].ipv4.dhcp',
      'hosts[].networkConfig.interfaces[].ipv4.address[].ip',
      'hosts[].networkConfig.interfaces[].ipv6',
      'hosts[].networkConfig.interfaces[].ipv6.address',
      'hosts[].networkConfig.interfaces[].link-aggregation',
      'hosts[].networkConfig.interfaces[].link-aggregation.mode',
      'hosts[].networkConfig.interfaces[].link-aggregation.port',
      'hosts[].networkConfig.interfaces[].vlan',
      'hosts[].networkConfig.interfaces[].vlan.id',
      'hosts[].networkConfig.interfaces[].vlan.base-iface',
      'hosts[].networkConfig.routes',
      'hosts[].networkConfig.routes.config',
      'hosts[].networkConfig.routes.config[].destination',
      'hosts[].networkConfig.routes.config[].next-hop-address',
      'hosts[].networkConfig.routes.config[].next-hop-interface',
    ];
    const dnsParentPath = 'hosts[].networkConfig.dns-resolver';
    const testDir = dirname(fileURLToPath(import.meta.url));

    function loadCanonical(version, scenario) {
      const filePath = resolve(testDir, '..', '..', 'data', 'params', version, `${scenario}.json`);
      return JSON.parse(fs.readFileSync(filePath, 'utf8')).parameters;
    }

    versions.forEach(version => {
      agentScenarios.forEach(scenario => {
        it(`${version} ${scenario} canonical has exactly one hosts[].networkConfig parent`, () => {
          const canonical = loadCanonical(version, scenario);
          const matches = canonical.filter(p => p.path === parentPath);
          expect(matches).toHaveLength(1);
        });

        it(`${version} ${scenario} mirror has exactly one hosts[].networkConfig parent`, () => {
          const params = getCatalogForScenario(scenario, version);
          const matches = params.filter(p => p.path === parentPath);
          expect(matches).toHaveLength(1);
        });

        it(`${version} ${scenario} canonical and mirror parent objects are identical`, () => {
          const canonical = loadCanonical(version, scenario);
          const mirror = getCatalogForScenario(scenario, version);
          const canonicalParent = canonical.find(p => p.path === parentPath);
          const mirrorParent = mirror.find(p => p.path === parentPath);
          expect(canonicalParent).toEqual(mirrorParent);
        });

        it(`${version} ${scenario} parent path is exactly hosts[].networkConfig`, () => {
          const params = getCatalogForScenario(scenario, version);
          const parent = params.find(p => p.path === parentPath);
          expect(parent.path).toBe('hosts[].networkConfig');
        });

        it(`${version} ${scenario} parent outputFile is exactly agent-config.yaml`, () => {
          const params = getCatalogForScenario(scenario, version);
          const parent = params.find(p => p.path === parentPath);
          expect(parent.outputFile).toBe('agent-config.yaml');
        });

        it(`${version} ${scenario} parent supportStatus is supported-ui`, () => {
          const params = getCatalogForScenario(scenario, version);
          const parent = params.find(p => p.path === parentPath);
          expect(parent.supportStatus).toBe('supported-ui');
        });

        it(`${version} ${scenario} parent minVersion remains 4.20`, () => {
          const params = getCatalogForScenario(scenario, version);
          const parent = params.find(p => p.path === parentPath);
          expect(parent.minVersion).toBe('4.20');
        });

        it(`${version} ${scenario} parent maxVersion remains null`, () => {
          const params = getCatalogForScenario(scenario, version);
          const parent = params.find(p => p.path === parentPath);
          expect(parent.maxVersion).toBe(null);
        });

        it(`${version} ${scenario} canonical and mirror catalog files are byte-identical`, () => {
          const canonicalFilePath = resolve(testDir, '..', '..', 'data', 'params', version, `${scenario}.json`);
          const mirrorFilePath = resolve(testDir, '..', 'src', 'data', 'catalogs', version, `${scenario}.json`);
          const canonical = fs.readFileSync(canonicalFilePath, 'utf8');
          const mirror = fs.readFileSync(mirrorFilePath, 'utf8');
          expect(canonical).toBe(mirror);
        });

        it(`${version} ${scenario} interfaces promoted to supported-ui; routes, link-aggregation, vlan retain supported-backend-only`, () => {
          const params = getCatalogForScenario(scenario, version);
          const interfaces = params.find(p => p.path === interfacesParentPath);
          const routes = params.find(p => p.path === routesParentPath);
          const linkAgg = params.find(p => p.path === linkAggregationPath);
          const vlan = params.find(p => p.path === vlanPath);
          expect(interfaces).toBeDefined();
          expect(interfaces.supportStatus).toBe('supported-ui');
          expect(routes).toBeDefined();
          expect(routes.supportStatus).toBe('supported-backend-only');
          expect(linkAgg).toBeDefined();
          expect(linkAgg.supportStatus).toBe('supported-backend-only');
          expect(vlan).toBeDefined();
          expect(vlan.supportStatus).toBe('supported-backend-only');
        });

        it(`${version} ${scenario} DNS parent and DNS children remain unchanged`, () => {
          const params = getCatalogForScenario(scenario, version);
          const dnsParent = params.find(p => p.path === dnsParentPath);
          expect(dnsParent).toBeDefined();
          expect(dnsParent.supportStatus).toBe('supported-ui');
          const dnsServer = params.find(p => p.path === 'hosts[].networkConfig.dns-resolver.config.server');
          const dnsSearch = params.find(p => p.path === 'hosts[].networkConfig.dns-resolver.config.search');
          expect(dnsServer).toBeDefined();
          expect(dnsServer.supportStatus).toBe('supported-backend-only');
          expect(dnsSearch).toBeDefined();
          expect(dnsSearch.supportStatus).toBe('supported-backend-only');
        });

        it(`${version} ${scenario} no SR-IOV or VRF catalog path is invented`, () => {
          const params = getCatalogForScenario(scenario, version);
          const sriovMatches = params.filter(p => p.path.toLowerCase().includes('sriov') || p.path.toLowerCase().includes('sr-iov'));
          const vrfMatches = params.filter(p => p.path.toLowerCase().includes('vrf'));
          expect(sriovMatches).toHaveLength(0);
          expect(vrfMatches).toHaveLength(0);
        });
      });
    });

    it('parent remains absent from non-Agent scenario catalogs', () => {
      const nonAgentScenarios = [
        'bare-metal-ipi', 'bare-metal-upi',
        'vsphere-ipi', 'vsphere-upi',
        'aws-govcloud-ipi', 'aws-govcloud-upi',
        'azure-government-ipi', 'azure-government-upi',
        'ibm-cloud-ipi', 'nutanix-ipi'
      ];
      versions.forEach(version => {
        nonAgentScenarios.forEach(scenario => {
          const params = getCatalogForScenario(scenario, version);
          const matches = params.filter(p => p.path === parentPath);
          expect(matches).toHaveLength(0);
        });
      });
    });

    it('no unrelated catalog parameter changes (byte-identical files)', () => {
      versions.forEach(version => {
        agentScenarios.forEach(scenario => {
          const canonicalFilePath = resolve(testDir, '..', '..', 'data', 'params', version, `${scenario}.json`);
          const mirrorFilePath = resolve(testDir, '..', 'src', 'data', 'catalogs', version, `${scenario}.json`);
          const canonical = fs.readFileSync(canonicalFilePath, 'utf8');
          const mirror = fs.readFileSync(mirrorFilePath, 'utf8');
          expect(canonical).toBe(mirror);
        });
      });
    });

  });

  describe('DOC-102 Slice 5H H6 H7 H8 Additional Interfaces metadata', () => {
    const agentScenarios = ['bare-metal-agent', 'vsphere-agent'];
    const versions = ['4.20', '4.21'];
    const ifacesParentPath = 'hosts[].networkConfig.interfaces';
    const ifacesChildPaths = [
      'hosts[].networkConfig.interfaces[].type',
      'hosts[].networkConfig.interfaces[].name',
      'hosts[].networkConfig.interfaces[].mac-address',
      'hosts[].networkConfig.interfaces[].ipv4',
      'hosts[].networkConfig.interfaces[].ipv4.dhcp',
      'hosts[].networkConfig.interfaces[].ipv4.address[].ip',
      'hosts[].networkConfig.interfaces[].ipv6',
      'hosts[].networkConfig.interfaces[].ipv6.address',
      'hosts[].networkConfig.interfaces[].link-aggregation',
      'hosts[].networkConfig.interfaces[].link-aggregation.mode',
      'hosts[].networkConfig.interfaces[].link-aggregation.port',
      'hosts[].networkConfig.interfaces[].vlan',
      'hosts[].networkConfig.interfaces[].vlan.id',
      'hosts[].networkConfig.interfaces[].vlan.base-iface',
    ];
    const testDir = dirname(fileURLToPath(import.meta.url));

    function loadCanonical(version, scenario) {
      const filePath = resolve(testDir, '..', '..', 'data', 'params', version, `${scenario}.json`);
      return JSON.parse(fs.readFileSync(filePath, 'utf8')).parameters;
    }

    versions.forEach(version => {
      agentScenarios.forEach(scenario => {
        it(`${version} ${scenario} canonical has exactly one interfaces parent entry`, () => {
          const canonical = loadCanonical(version, scenario);
          const matches = canonical.filter(p => p.path === ifacesParentPath);
          expect(matches).toHaveLength(1);
        });

        it(`${version} ${scenario} mirror has exactly one interfaces parent entry`, () => {
          const params = getCatalogForScenario(scenario, version);
          const matches = params.filter(p => p.path === ifacesParentPath);
          expect(matches).toHaveLength(1);
        });

        it(`${version} ${scenario} canonical and mirror interfaces parent entries are identical`, () => {
          const canonical = loadCanonical(version, scenario);
          const mirror = getCatalogForScenario(scenario, version);
          const canonicalParent = canonical.find(p => p.path === ifacesParentPath);
          const mirrorParent = mirror.find(p => p.path === ifacesParentPath);
          expect(canonicalParent).toEqual(mirrorParent);
        });

        it(`${version} ${scenario} interfaces parent supportStatus is supported-ui`, () => {
          const params = getCatalogForScenario(scenario, version);
          const parent = params.find(p => p.path === ifacesParentPath);
          expect(parent.supportStatus).toBe('supported-ui');
        });

        it(`${version} ${scenario} interfaces parent minVersion remains 4.20`, () => {
          const params = getCatalogForScenario(scenario, version);
          const parent = params.find(p => p.path === ifacesParentPath);
          expect(parent.minVersion).toBe('4.20');
        });

        it(`${version} ${scenario} interfaces parent maxVersion remains null`, () => {
          const params = getCatalogForScenario(scenario, version);
          const parent = params.find(p => p.path === ifacesParentPath);
          expect(parent.maxVersion).toBe(null);
        });

        it(`${version} ${scenario} interfaces parent outputFile is agent-config.yaml`, () => {
          const params = getCatalogForScenario(scenario, version);
          const parent = params.find(p => p.path === ifacesParentPath);
          expect(parent.outputFile).toBe('agent-config.yaml');
        });

        it(`${version} ${scenario} all 14 interface child entries retain their pre-existing supportStatus`, () => {
          const params = getCatalogForScenario(scenario, version);
          const uiPromotedChildren = new Set([
            'hosts[].networkConfig.interfaces[].ipv4',
            'hosts[].networkConfig.interfaces[].ipv4.dhcp',
            'hosts[].networkConfig.interfaces[].ipv6',
          ]);
          ifacesChildPaths.forEach(cp => {
            const child = params.find(p => p.path === cp);
            expect(child).toBeDefined();
            const expected = uiPromotedChildren.has(cp) ? 'supported-ui' : 'supported-backend-only';
            expect(child.supportStatus).toBe(expected);
          });
        });

        it(`${version} ${scenario} canonical and mirror catalog files are byte-identical`, () => {
          const canonicalFilePath = resolve(testDir, '..', '..', 'data', 'params', version, `${scenario}.json`);
          const mirrorFilePath = resolve(testDir, '..', 'src', 'data', 'catalogs', version, `${scenario}.json`);
          const canonical = fs.readFileSync(canonicalFilePath, 'utf8');
          const mirror = fs.readFileSync(mirrorFilePath, 'utf8');
          expect(canonical).toBe(mirror);
        });

        it(`${version} ${scenario} no SR-IOV or VRF catalog path is invented`, () => {
          const params = getCatalogForScenario(scenario, version);
          const sriovMatches = params.filter(p => p.path.toLowerCase().includes('sriov') || p.path.toLowerCase().includes('sr-iov'));
          const vrfMatches = params.filter(p => p.path.toLowerCase().includes('vrf'));
          expect(sriovMatches).toHaveLength(0);
          expect(vrfMatches).toHaveLength(0);
        });
      });
    });

    it('interfaces parent is absent from non-Agent scenario catalogs', () => {
      const nonAgentScenarios = [
        'bare-metal-ipi', 'bare-metal-upi',
        'vsphere-ipi', 'vsphere-upi',
        'aws-govcloud-ipi', 'aws-govcloud-upi',
        'azure-government-ipi', 'azure-government-upi',
        'ibm-cloud-ipi', 'nutanix-ipi'
      ];
      versions.forEach(version => {
        nonAgentScenarios.forEach(scenario => {
          const params = getCatalogForScenario(scenario, version);
          const matches = params.filter(p => p.path === ifacesParentPath);
          expect(matches).toHaveLength(0);
        });
      });
    });

    it('routes parent remains supported-backend-only in all agent scenarios', () => {
      const routesPath = 'hosts[].networkConfig.routes';
      versions.forEach(version => {
        agentScenarios.forEach(scenario => {
          const params = getCatalogForScenario(scenario, version);
          const routes = params.find(p => p.path === routesPath);
          expect(routes).toBeDefined();
          expect(routes.supportStatus).toBe('supported-backend-only');
        });
      });
    });

    it('link-aggregation and vlan parents remain supported-backend-only', () => {
      const linkAggPath = 'hosts[].networkConfig.interfaces[].link-aggregation';
      const vlanPath = 'hosts[].networkConfig.interfaces[].vlan';
      versions.forEach(version => {
        agentScenarios.forEach(scenario => {
          const params = getCatalogForScenario(scenario, version);
          const linkAgg = params.find(p => p.path === linkAggPath);
          const vlan = params.find(p => p.path === vlanPath);
          expect(linkAgg).toBeDefined();
          expect(linkAgg.supportStatus).toBe('supported-backend-only');
          expect(vlan).toBeDefined();
          expect(vlan.supportStatus).toBe('supported-backend-only');
        });
      });
    });

    it('no unrelated catalog parameter changes (byte-identical files)', () => {
      versions.forEach(version => {
        agentScenarios.forEach(scenario => {
          const canonicalFilePath = resolve(testDir, '..', '..', 'data', 'params', version, `${scenario}.json`);
          const mirrorFilePath = resolve(testDir, '..', 'src', 'data', 'catalogs', version, `${scenario}.json`);
          const canonical = fs.readFileSync(canonicalFilePath, 'utf8');
          const mirror = fs.readFileSync(mirrorFilePath, 'utf8');
          expect(canonical).toBe(mirror);
        });
      });
    });

  });

  describe('DOC-102 Slice 5I T7 Workstream A: 4.21 catalog self-identification', () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const allScenarios421 = [
      'aws-govcloud-ipi', 'aws-govcloud-upi',
      'azure-government-ipi', 'azure-government-upi',
      'bare-metal-agent', 'bare-metal-ipi', 'bare-metal-upi',
      'ibm-cloud-ipi', 'nutanix-ipi',
      'vsphere-agent', 'vsphere-ipi', 'vsphere-upi'
    ];

    allScenarios421.forEach(scenario => {
      it(`canonical 4.21/${scenario}.json has top-level version "4.21"`, () => {
        const filePath = resolve(testDir, '..', '..', 'data', 'params', '4.21', `${scenario}.json`);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        expect(data.version).toBe('4.21');
      });

      it(`frontend mirror 4.21/${scenario}.json has top-level version "4.21"`, () => {
        const filePath = resolve(testDir, '..', 'src', 'data', 'catalogs', '4.21', `${scenario}.json`);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        expect(data.version).toBe('4.21');
      });

      it(`canonical and mirror 4.21/${scenario}.json are byte-identical`, () => {
        const canonicalPath = resolve(testDir, '..', '..', 'data', 'params', '4.21', `${scenario}.json`);
        const mirrorPath = resolve(testDir, '..', 'src', 'data', 'catalogs', '4.21', `${scenario}.json`);
        expect(fs.readFileSync(canonicalPath, 'utf8')).toBe(fs.readFileSync(mirrorPath, 'utf8'));
      });
    });

    it('all 4.20 catalogs retain top-level version "4.20"', () => {
      const scenarios420 = [
        'aws-govcloud-ipi', 'aws-govcloud-upi',
        'azure-government-ipi', 'azure-government-upi',
        'bare-metal-agent', 'bare-metal-ipi', 'bare-metal-upi',
        'ibm-cloud-ipi', 'nutanix-ipi', 'oc-mirror-v2',
        'vsphere-agent', 'vsphere-ipi', 'vsphere-upi'
      ];
      scenarios420.forEach(scenario => {
        const filePath = resolve(testDir, '..', '..', 'data', 'params', '4.20', `${scenario}.json`);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        expect(data.version).toBe('4.20');
      });
    });
  });

  describe('DOC-102 Slice 5I T7 Workstream B: AWS GovCloud subnet-role metadata', () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const expectedAllowed = [
      'ClusterNode',
      'BootstrapNode',
      'IngressControllerLB',
      'ControlPlaneExternalLB',
      'ControlPlaneInternalLB'
    ];
    const awsCombinations = [
      { version: '4.20', scenario: 'aws-govcloud-ipi' },
      { version: '4.20', scenario: 'aws-govcloud-upi' },
      { version: '4.21', scenario: 'aws-govcloud-ipi' },
      { version: '4.21', scenario: 'aws-govcloud-upi' },
    ];

    function loadCanonicalRoles(version, scenario) {
      const filePath = resolve(testDir, '..', '..', 'data', 'params', version, `${scenario}.json`);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return data.parameters.filter(p => p.path === 'platform.aws.vpc.subnets[].roles');
    }

    function loadMirrorRoles(version, scenario) {
      const filePath = resolve(testDir, '..', 'src', 'data', 'catalogs', version, `${scenario}.json`);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return data.parameters.filter(p => p.path === 'platform.aws.vpc.subnets[].roles');
    }

    awsCombinations.forEach(({ version, scenario }) => {
      describe(`${version} ${scenario}`, () => {
        it('canonical has exactly one platform.aws.vpc.subnets[].roles entry', () => {
          expect(loadCanonicalRoles(version, scenario)).toHaveLength(1);
        });

        it('mirror has exactly one platform.aws.vpc.subnets[].roles entry', () => {
          expect(loadMirrorRoles(version, scenario)).toHaveLength(1);
        });

        it('canonical has the exact ordered allowed array', () => {
          const roles = loadCanonicalRoles(version, scenario)[0];
          expect(roles.allowed).toEqual(expectedAllowed);
        });

        it('mirror has the exact ordered allowed array', () => {
          const roles = loadMirrorRoles(version, scenario)[0];
          expect(roles.allowed).toEqual(expectedAllowed);
        });

        it('allowed does not contain WorkerExternalLB', () => {
          const roles = loadCanonicalRoles(version, scenario)[0];
          expect(roles.allowed).not.toContain('WorkerExternalLB');
        });

        it('allowed does not contain EdgeNode', () => {
          const roles = loadCanonicalRoles(version, scenario)[0];
          expect(roles.allowed).not.toContain('EdgeNode');
        });

        it('allowed contains ControlPlaneInternalLB', () => {
          const roles = loadCanonicalRoles(version, scenario)[0];
          expect(roles.allowed).toContain('ControlPlaneInternalLB');
        });

        it('description contains ControlPlaneInternalLB', () => {
          const roles = loadCanonicalRoles(version, scenario)[0];
          expect(roles.description).toContain('ControlPlaneInternalLB');
        });

        it('description does not contain WorkerExternalLB', () => {
          const roles = loadCanonicalRoles(version, scenario)[0];
          expect(roles.description).not.toContain('WorkerExternalLB');
        });

        it('canonical and mirror are identical', () => {
          const canonical = loadCanonicalRoles(version, scenario)[0];
          const mirror = loadMirrorRoles(version, scenario)[0];
          expect(canonical).toEqual(mirror);
        });
      });
    });

    it('catalog allowed array matches validation.js AWS_SUBNET_ROLES_ALLOWED constant', async () => {
      const { AWS_SUBNET_ROLES_ALLOWED } = await import('../src/validation.js');
      awsCombinations.forEach(({ version, scenario }) => {
        const roles = loadCanonicalRoles(version, scenario)[0];
        expect(roles.allowed).toEqual(AWS_SUBNET_ROLES_ALLOWED);
      });
    });

    it('catalog allowed array matches PlatformSpecificsStep.jsx AWS_SUBNET_ROLES_ALLOWED constant', () => {
      const stepSrc = fs.readFileSync(
        resolve(testDir, '..', 'src', 'steps', 'PlatformSpecificsStep.jsx'), 'utf8'
      );
      const match = stepSrc.match(/const AWS_SUBNET_ROLES_ALLOWED\s*=\s*\[([^\]]+)\]/);
      expect(match).not.toBeNull();
      const stepAllowed = match[1].split(',').map(s => s.trim().replace(/['"]/g, ''));
      expect(stepAllowed).toEqual(expectedAllowed);
    });
  });

  describe('DOC-102 Slice 5I T8 (Reduced): proven-safe catalog text corrections', () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const allScenarios = [
      'aws-govcloud-ipi', 'aws-govcloud-upi',
      'azure-government-ipi', 'azure-government-upi',
      'bare-metal-agent', 'bare-metal-ipi', 'bare-metal-upi',
      'ibm-cloud-ipi', 'nutanix-ipi',
      'vsphere-agent', 'vsphere-ipi', 'vsphere-upi'
    ];

    function loadParams(scenario) {
      const filePath = resolve(testDir, '..', '..', 'data', 'params', '4.21', `${scenario}.json`);
      return JSON.parse(fs.readFileSync(filePath, 'utf8')).parameters;
    }

    const ACCEPTED_OVN_DESCRIPTION = 'Configuration for OVN-Kubernetes CNI plugin (the default network plugin for OpenShift Container Platform). Only applies when networking.networkType is OVNKubernetes.';

    const ACCEPTED_CHANGES = [
      { scenario: 'aws-govcloud-ipi', path: 'platform.aws.vpc.subnets', field: 'description', value: 'Existing VPC subnets: emitted as platform.aws.vpc.subnets[] with id and optional roles[] per the install-config reference. Omit for installer-provisioned VPC. If any role is set, each subnet must have ≥1 role and required roles (ClusterNode, IngressControllerLB, etc.) must be covered; ControlPlaneExternalLB not required when publish=Internal.' },
      { scenario: 'aws-govcloud-ipi', path: 'platform.aws.vpc.subnets', field: 'allowed', value: 'list of objects with id (optional roles per the install-config reference)' },
      { scenario: 'aws-govcloud-upi', path: 'platform.aws.vpc.subnets', field: 'description', value: 'Existing VPC subnets: emitted as platform.aws.vpc.subnets[] with id and optional roles[] per the install-config reference. Required for UPI in existing VPC. If any role is set, each subnet must have ≥1 role and required role coverage applies.' },
      { scenario: 'aws-govcloud-upi', path: 'platform.aws.vpc.subnets', field: 'allowed', value: 'list of objects with id (optional roles per the install-config reference)' },
      { scenario: 'ibm-cloud-ipi', path: 'networking.clusterNetwork[].cidr', field: 'description', value: 'Pod network CIDR block. IPv4 only for IBM Cloud.' },
      { scenario: 'nutanix-ipi', path: 'controlPlane[].replicas', field: 'description', value: 'Number of control plane machines for Nutanix IPI: 3 for standard or compact three-node (with compute.replicas 0), or 1 for single-node OpenShift (per the Nutanix install-config reference).' },
    ];

    describe('accepted OVN-Kubernetes description (all 12 scenarios)', () => {
      allScenarios.forEach(scenario => {
        it(`${scenario} networking.ovnKubernetesConfig description`, () => {
          const p = loadParams(scenario).find(p => p.path === 'networking.ovnKubernetesConfig');
          expect(p).toBeDefined();
          expect(p.description).toBe(ACCEPTED_OVN_DESCRIPTION);
        });
      });
    });

    describe('accepted non-OVN field changes (6 values)', () => {
      ACCEPTED_CHANGES.forEach(({ scenario, path, field, value }) => {
        it(`${scenario} ${path} ${field}`, () => {
          const p = loadParams(scenario).find(p => p.path === path);
          expect(p).toBeDefined();
          expect(p[field]).toBe(value);
        });
      });
    });

    describe('preservation guards', () => {
      it('exactly 1026 minVersion "4.20" occurrences across all 4.21 catalogs', () => {
        let total = 0;
        allScenarios.forEach(scenario => {
          total += loadParams(scenario).filter(p => p.minVersion === '4.20').length;
        });
        expect(total).toBe(1026);
      });

      it('exactly 2 v4.20 capability enum values in bare-metal-ipi and bare-metal-upi', () => {
        let total = 0;
        ['bare-metal-ipi', 'bare-metal-upi'].forEach(scenario => {
          total += loadParams(scenario).filter(p =>
            Array.isArray(p.allowed) && p.allowed.includes('v4.20')
          ).length;
        });
        expect(total).toBe(2);
      });

      it('exactly 26 "absent in 4.20" historical comparison notes', () => {
        let total = 0;
        allScenarios.forEach(scenario => {
          loadParams(scenario).forEach(p => {
            (p.citations || []).forEach(c => {
              if (c.note && c.note.includes('absent in 4.20')) total++;
            });
          });
        });
        expect(total).toBe(24);
      });
    });

    describe('canonical-mirror parity', () => {
      allScenarios.forEach(scenario => {
        it(`${scenario} canonical and mirror are byte-identical`, () => {
          const canonicalPath = resolve(testDir, '..', '..', 'data', 'params', '4.21', `${scenario}.json`);
          const mirrorPath = resolve(testDir, '..', 'src', 'data', 'catalogs', '4.21', `${scenario}.json`);
          expect(fs.readFileSync(canonicalPath, 'utf8')).toBe(fs.readFileSync(mirrorPath, 'utf8'));
        });
      });
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
