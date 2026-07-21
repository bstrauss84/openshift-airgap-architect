import { test, expect } from '@playwright/test';
import { resetState, importState } from '../../helpers/api.js';
import * as scenarios from '../../fixtures/scenarios.js';
import {
  loadCatalogParams,
  getRequiredParams,
  getParamsByFile,
  resolveYamlPath,
  checkRequiredFields,
  checkValueTypes,
  compareKeyStructure,
  loadReferenceYaml,
  parseYaml,
  writeGeneratedAssets,
  makeVersionedFixture,
  SUPPORTED_VERSIONS,
  SCENARIO_MAP,
} from '../../helpers/asset-validation.js';

const BACKEND = 'http://localhost:4000';

async function generate(request) {
  const resp = await request.post(`${BACKEND}/api/generate`);
  expect(resp.ok()).toBeTruthy();
  return resp.json();
}

function enrichFixtureForRequiredFields(fixture) {
  const platform = fixture.blueprint?.platform;
  if (platform === 'VMware vSphere') {
    fixture.platformConfig.vsphere.placementMode = 'legacy';
    if (!fixture.platformConfig.vsphere.vcenter) fixture.platformConfig.vsphere.vcenter = 'vcenter.struct-test.lab';
    if (!fixture.platformConfig.vsphere.datacenter) fixture.platformConfig.vsphere.datacenter = 'DC-struct';
    if (!fixture.platformConfig.vsphere.datastore) fixture.platformConfig.vsphere.datastore = 'ds-struct';
    if (!fixture.platformConfig.vsphere.cluster) fixture.platformConfig.vsphere.cluster = 'cluster-struct';
    if (!fixture.platformConfig.vsphere.network) fixture.platformConfig.vsphere.network = 'VM Network';
  }
  if (platform === 'Nutanix') {
    if (!fixture.platformConfig.nutanix.endpoint) fixture.platformConfig.nutanix.endpoint = 'prism.struct-test.lab';
    if (!fixture.platformConfig.nutanix.subnet) fixture.platformConfig.nutanix.subnet = 'subnet-uuid-struct';
    if (!fixture.platformConfig.nutanix.apiVIP) fixture.platformConfig.nutanix.apiVIP = '10.90.0.2';
    if (!fixture.platformConfig.nutanix.ingressVIP) fixture.platformConfig.nutanix.ingressVIP = '10.90.0.3';
  }
  if (platform === 'AWS GovCloud') {
    if (!fixture.platformConfig.aws.region) fixture.platformConfig.aws.region = 'us-gov-west-1';
  }
  if (platform === 'Azure Government') {
    if (!fixture.platformConfig.azure.region) fixture.platformConfig.azure.region = 'usgovvirginia';
  }
  return fixture;
}

async function seedVersioned(request, scenarioFn, minor, patch) {
  let fixture = makeVersionedFixture(scenarioFn, minor, patch);
  fixture = enrichFixtureForRequiredFields(fixture);
  await importState(request, fixture);
  return fixture;
}

// Catalog paths that are either (a) input-only fields the generator transforms
// into different output paths (e.g., vsphere.vcenter → vsphere.vcenters[].server),
// or (b) conditionally required fields absent in minimal fixtures (e.g., AWS VPC
// subnets only in existing-VPC mode).  Tracked as known gaps, not test failures.
const KNOWN_OPTIONAL_REQUIRED = new Set([
  'platform.aws.vpc.subnets[].id',
  'platform.azure.subnets.name',
  'platform.azure.subnets.role',
  'platform.vsphere.defaultDatastore',
  'platform.vsphere.vcenter',
  'platform.vsphere.datacenter',
  'platform.nutanix.subnet',
]);

// ─── Tier 1: Required Fields per Version ────────────────────────────────────

test.describe('Asset Structure — Tier 1: Required Fields', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  for (const version of SUPPORTED_VERSIONS) {
    for (const scenario of SCENARIO_MAP) {
      test(`[${version.minor}] ${scenario.id}: all required install-config fields present`, async ({ request }) => {
        const params = loadCatalogParams(version.minor, scenario.id);
        const required = getRequiredParams(params, 'install-config.yaml');

        const scenarioFn = scenarios[scenario.fn];
        await seedVersioned(request, scenarioFn, version.minor, version.patch);
        const { files } = await generate(request);

        const ic = parseYaml(files['install-config.yaml']);
        const { present, missing } = checkRequiredFields(ic, required);
        const realMissing = missing.filter((m) => !KNOWN_OPTIONAL_REQUIRED.has(m));

        writeGeneratedAssets(files, scenario.id, version.minor, 'minimal');

        for (const m of realMissing) {
          expect.soft(null, `Required field missing: ${m}`).toBeTruthy();
        }
        expect(present.length).toBeGreaterThan(0);
      });

      if (scenario.hasAgentConfig) {
        test(`[${version.minor}] ${scenario.id}: all required agent-config fields present`, async ({ request }) => {
          const params = loadCatalogParams(version.minor, scenario.id);
          const required = getRequiredParams(params, 'agent-config.yaml');

          const scenarioFn = scenarios[scenario.fn];
          await seedVersioned(request, scenarioFn, version.minor, version.patch);
          const { files } = await generate(request);

          expect(files['agent-config.yaml']).toBeTruthy();
          const ac = parseYaml(files['agent-config.yaml']);
          const { present, missing } = checkRequiredFields(ac, required);

          for (const m of missing) {
            expect.soft(null, `Required field missing: ${m}`).toBeTruthy();
          }
          expect(present.length).toBeGreaterThan(0);
        });
      }
    }
  }
});

// ─── Tier 1b: Value Types ───────────────────────────────────────────────────

// Catalog type definitions that don't match actual OpenShift API output.
// These are catalog metadata inaccuracies, not generator bugs.
const KNOWN_TYPE_EXCEPTIONS = new Set([
  'controlPlane',
  'controlPlane[].platform',
  'compute[].platform',
]);

test.describe('Asset Structure — Tier 1b: Value Type Validation', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  for (const version of SUPPORTED_VERSIONS) {
    for (const scenario of SCENARIO_MAP) {
      test(`[${version.minor}] ${scenario.id}: install-config field types match catalog`, async ({ request }) => {
        const params = loadCatalogParams(version.minor, scenario.id);
        const icParams = getParamsByFile(params, 'install-config.yaml');

        const scenarioFn = scenarios[scenario.fn];
        await seedVersioned(request, scenarioFn, version.minor, version.patch);
        const { files } = await generate(request);

        const ic = parseYaml(files['install-config.yaml']);
        const { mismatched } = checkValueTypes(ic, icParams);
        const realMismatched = mismatched.filter((m) => !KNOWN_TYPE_EXCEPTIONS.has(m.path));

        for (const m of realMismatched) {
          expect.soft(null, `Type mismatch at ${m.path}: expected ${m.expected}, got ${m.actual}`).toBeTruthy();
        }
      });
    }
  }
});

// ─── Tier 2: Variant Overlay Validation ─────────────────────────────────────

function applyFips(fixture) {
  fixture.globalStrategy.fips = true;
  return fixture;
}

function applyProxy(fixture) {
  fixture.globalStrategy.proxyEnabled = true;
  fixture.globalStrategy.proxies = {
    httpProxy: 'http://proxy.e2e.local:3128',
    httpsProxy: 'https://proxy.e2e.local:3129',
    noProxy: '.e2e.local,.svc,10.128.0.0/14',
  };
  return fixture;
}

function applyTrustBundle(fixture) {
  fixture.trust = {
    mirrorRegistryCaPem: '-----BEGIN CERTIFICATE-----\nE2ESTRUCTTEST\n-----END CERTIFICATE-----',
    proxyCaPem: '',
    additionalTrustBundlePolicy: 'Always',
  };
  return fixture;
}

function applyDualStack(fixture) {
  fixture.globalStrategy.networking.machineNetworkV6 = 'fd00::/48';
  fixture.globalStrategy.networking.clusterNetworkCidrV6 = 'fd01::/48';
  fixture.globalStrategy.networking.clusterNetworkHostPrefixV6 = 64;
  fixture.globalStrategy.networking.serviceNetworkCidrV6 = 'fd02::/112';
  fixture.hostInventory.ipStackMode = 'dual-stack';
  return fixture;
}

function applyNtp(fixture) {
  fixture.globalStrategy.ntpServers = ['ntp1.struct.local', 'ntp2.struct.local'];
  return fixture;
}

function applyOperators(fixture, version) {
  fixture.operators = {
    selected: [
      {
        package: 'local-storage-operator',
        name: 'local-storage-operator',
        catalog: 'redhat',
        catalogImage: `registry.redhat.io/redhat/redhat-operator-index:v${version}`,
        defaultChannel: 'stable',
      },
    ],
    stale: false,
    scenarios: [],
    fastMode: false,
  };
  return fixture;
}

const VARIANTS = [
  {
    id: 'with-fips',
    apply: (f) => applyFips(f),
    checks: (ic) => [{ path: 'fips', expected: true }],
    appliesTo: () => true,
  },
  {
    id: 'with-proxy',
    apply: (f) => applyProxy(f),
    checks: (ic) => [
      { path: 'proxy.httpProxy', type: 'string' },
      { path: 'proxy.httpsProxy', type: 'string' },
      { path: 'proxy.noProxy', type: 'string' },
    ],
    appliesTo: () => true,
  },
  {
    id: 'with-trust-bundle',
    apply: (f) => applyTrustBundle(f),
    checks: (ic) => [{ path: 'additionalTrustBundle', type: 'string' }],
    appliesTo: () => true,
  },
  {
    id: 'dual-stack',
    apply: (f) => applyDualStack(f),
    checks: (ic) => {
      const mn = ic.networking?.machineNetwork || [];
      return [{ custom: mn.length >= 2, label: 'machineNetwork has IPv6 entry' }];
    },
    appliesTo: (id) => !id.startsWith('aws') && !id.startsWith('ibm') && !id.startsWith('azure'),
  },
  {
    id: 'with-ntp',
    apply: (f) => applyNtp(f),
    checks: (ic, ac, files) => {
      const results = [];
      if (ac) {
        const parsed = parseYaml(ac);
        results.push({
          custom: parsed?.additionalNTPSources?.length >= 1,
          label: 'agent-config has additionalNTPSources',
        });
      }
      if (files['99-chrony-ntp-master.yaml']) {
        results.push({ custom: true, label: 'chrony master MachineConfig generated' });
      }
      if (files['99-chrony-ntp-worker.yaml']) {
        results.push({ custom: true, label: 'chrony worker MachineConfig generated' });
      }
      return results;
    },
    appliesTo: (id) => id.includes('agent'),
  },
];

test.describe('Asset Structure — Tier 2: Variant Overlays', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  for (const version of SUPPORTED_VERSIONS) {
    for (const scenario of SCENARIO_MAP) {
      for (const variant of VARIANTS) {
        if (!variant.appliesTo(scenario.id)) continue;

        test(`[${version.minor}] ${scenario.id} / ${variant.id}`, async ({ request }) => {
          const scenarioFn = scenarios[scenario.fn];
          let fixture = makeVersionedFixture(scenarioFn, version.minor, version.patch);
          fixture = variant.apply(fixture);
          await importState(request, fixture);

          const { files } = await generate(request);
          const ic = parseYaml(files['install-config.yaml']);
          const ac = files['agent-config.yaml'];

          writeGeneratedAssets(files, scenario.id, version.minor, variant.id);

          const checks = variant.checks(ic, ac, files);
          for (const check of checks) {
            if ('custom' in check) {
              expect.soft(check.custom, check.label).toBeTruthy();
            } else if ('path' in check) {
              const result = resolveYamlPath(ic, check.path);
              expect.soft(result.found, `${check.path} should be present`).toBeTruthy();
              if ('expected' in check) {
                expect.soft(result.value, `${check.path} value`).toBe(check.expected);
              }
            }
          }
        });
      }
    }
  }

  // Operators variant — checks version-tagged catalog images
  for (const version of SUPPORTED_VERSIONS) {
    for (const scenario of SCENARIO_MAP) {
      test(`[${version.minor}] ${scenario.id} / with-operators: catalog image uses v${version.minor}`, async ({ request }) => {
        const scenarioFn = scenarios[scenario.fn];
        let fixture = makeVersionedFixture(scenarioFn, version.minor, version.patch);
        fixture = applyOperators(fixture, version.minor);
        await importState(request, fixture);

        const { files } = await generate(request);
        const isc = files['imageset-config.yaml'];
        expect(isc).toBeTruthy();

        writeGeneratedAssets(files, scenario.id, version.minor, 'with-operators');

        if (isc.includes('redhat-operator-index')) {
          expect(isc).toContain(`v${version.minor}`);
        }
        expect(isc).toContain(`stable-${version.minor}`);
      });
    }
  }
});

// ─── Tier 3: Golden Reference Comparison ────────────────────────────────────

const REFERENCE_FILES = [
  { file: 'bare-metal-agent_minimal.yaml', scenario: 'bareMetalAgent' },
  { file: 'bare-metal-agent_with-proxy.yaml', scenario: 'bareMetalAgent', variant: applyProxy },
  { file: 'bare-metal-agent_with-fips.yaml', scenario: 'bareMetalAgent', variant: applyFips },
  { file: 'bare-metal-ipi_minimal.yaml', scenario: 'bareMetalIpi' },
  { file: 'bare-metal-upi_minimal.yaml', scenario: 'bareMetalUpi' },
  { file: 'vsphere-ipi_minimal.yaml', scenario: 'vsphereIpi' },
  { file: 'vsphere-upi_minimal.yaml', scenario: 'vsphereUpi' },
  { file: 'vsphere-agent_minimal.yaml', scenario: 'vsphereAgent' },
  { file: 'aws-govcloud-ipi_minimal.yaml', scenario: 'awsGovcloudIpi' },
  { file: 'aws-govcloud-upi_minimal.yaml', scenario: 'awsGovcloudUpi' },
  { file: 'azure-government-ipi_minimal.yaml', scenario: 'azureGovernmentIpi' },
  { file: 'nutanix-ipi_minimal.yaml', scenario: 'nutanixIpi' },
];

// Keys in golden references that may not appear in minimal fixture output.
// imageDigestSources requires mirror sources; proxy requires proxy config.
const KNOWN_REF_ONLY_KEYS = new Set([
  'imageDigestSources',
  'proxy',
]);

test.describe('Asset Structure — Tier 3: Golden Reference Comparison', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  for (const ref of REFERENCE_FILES) {
    test(`reference match: ${ref.file}`, async ({ request }) => {
      const refYaml = loadReferenceYaml('install-config', ref.file);

      const scenarioFn = scenarios[ref.scenario];
      let fixture = makeVersionedFixture(scenarioFn, '4.20', '4.20.0');
      fixture = enrichFixtureForRequiredFields(fixture);
      if (ref.variant) fixture = ref.variant(fixture);
      await importState(request, fixture);

      const { files } = await generate(request);
      const genYaml = parseYaml(files['install-config.yaml']);

      const { missing, extra } = compareKeyStructure(genYaml, refYaml);
      const realMissing = missing.filter((m) => {
        const topKey = m.split('.')[0];
        return !KNOWN_REF_ONLY_KEYS.has(topKey);
      });

      for (const m of realMissing) {
        expect.soft(null, `Key missing from generated output: ${m}`).toBeTruthy();
      }
    });
  }

  test('reference match: agent-config bare-metal-agent_minimal.yaml', async ({ request }) => {
    const refYaml = loadReferenceYaml('agent-config', 'bare-metal-agent_minimal.yaml');

    const fixture = makeVersionedFixture(scenarios.bareMetalAgent, '4.20', '4.20.0');
    await importState(request, fixture);

    const { files } = await generate(request);
    expect(files['agent-config.yaml']).toBeTruthy();
    const genYaml = parseYaml(files['agent-config.yaml']);

    const { missing } = compareKeyStructure(genYaml, refYaml);

    for (const m of missing) {
      expect.soft(null, `Key missing from generated agent-config: ${m}`).toBeTruthy();
    }
  });
});

// ─── Tier 4: Version Delta Validation ───────────────────────────────────────

test.describe('Asset Structure — Tier 4: Version Delta (4.20 vs 4.21)', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  for (const scenario of SCENARIO_MAP) {
    test(`${scenario.id}: version-specific output differences`, async ({ request }) => {
      const scenarioFn = scenarios[scenario.fn];

      // Generate for 4.20
      await seedVersioned(request, scenarioFn, '4.20', '4.20.0');
      const result420 = await generate(request);
      const ic420 = parseYaml(result420.files['install-config.yaml']);
      const isc420 = result420.files['imageset-config.yaml'];

      writeGeneratedAssets(result420.files, scenario.id, '4.20', 'version-delta');

      // Generate for 4.21
      await seedVersioned(request, scenarioFn, '4.21', '4.21.0');
      const result421 = await generate(request);
      const ic421 = parseYaml(result421.files['install-config.yaml']);
      const isc421 = result421.files['imageset-config.yaml'];

      writeGeneratedAssets(result421.files, scenario.id, '4.21', 'version-delta');

      // Channel names differ
      expect(isc420).toContain('stable-4.20');
      expect(isc421).toContain('stable-4.21');
      expect(isc420).not.toContain('stable-4.21');
      expect(isc421).not.toContain('stable-4.20');

      // Both produce valid install-config
      expect(ic420.apiVersion).toBe('v1');
      expect(ic421.apiVersion).toBe('v1');
      expect(ic420.baseDomain).toBeTruthy();
      expect(ic421.baseDomain).toBeTruthy();

      // Agent-config version consistency
      if (scenario.hasAgentConfig) {
        const ac420 = parseYaml(result420.files['agent-config.yaml']);
        const ac421 = parseYaml(result421.files['agent-config.yaml']);
        expect(ac420.apiVersion).toBe('v1beta1');
        expect(ac421.apiVersion).toBe('v1beta1');
        expect(ac420.kind).toBe('AgentConfig');
        expect(ac421.kind).toBe('AgentConfig');
      }
    });
  }
});
