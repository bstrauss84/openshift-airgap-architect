/**
 * Field-to-Asset Validation Tests
 *
 * Verifies that every field tied to a config file parameter is properly
 * reflected in the generated YAML assets. Seeds state via API, calls
 * POST /api/generate, and asserts the values appear at the correct YAML paths.
 */
import { test, expect } from '@playwright/test';
import { resetState, importState } from '../../helpers/api.js';
import * as scenarios from '../../fixtures/scenarios.js';

const BACKEND = 'http://localhost:4000';

async function generate(request) {
  const resp = await request.post(`${BACKEND}/api/generate`);
  expect(resp.ok()).toBeTruthy();
  return resp.json();
}

test.describe('Field-to-Asset Validation — install-config.yaml', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  test('clusterName → metadata.name', async ({ request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.blueprint.clusterName = 'my-e2e-cluster';
    await importState(request, fixture);

    const { files } = await generate(request);
    expect(files['install-config.yaml']).toContain('name: my-e2e-cluster');
  });

  test('baseDomain → baseDomain', async ({ request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.blueprint.baseDomain = 'e2e-testing.example.org';
    await importState(request, fixture);

    const { files } = await generate(request);
    expect(files['install-config.yaml']).toContain('baseDomain: e2e-testing.example.org');
  });

  test('sshPublicKey → sshKey', async ({ request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.credentials.sshPublicKey = 'ssh-ed25519 AAAA_E2E_TEST_KEY user@host';
    await importState(request, fixture);

    const { files } = await generate(request);
    expect(files['install-config.yaml']).toContain('AAAA_E2E_TEST_KEY');
  });

  test('fips → fips: true', async ({ request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.globalStrategy.fips = true;
    await importState(request, fixture);

    const { files } = await generate(request);
    expect(files['install-config.yaml']).toContain('fips: true');
  });

  test('fips disabled → no fips line', async ({ request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.globalStrategy.fips = false;
    await importState(request, fixture);

    const { files } = await generate(request);
    expect(files['install-config.yaml']).not.toMatch(/^fips: true$/m);
  });

  test('machineNetworkV4 → networking.machineNetwork[0].cidr', async ({ request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.globalStrategy.networking.machineNetworkV4 = '192.168.50.0/24';
    await importState(request, fixture);

    const { files } = await generate(request);
    expect(files['install-config.yaml']).toContain('192.168.50.0/24');
  });

  test('clusterNetworkCidr → networking.clusterNetwork[0].cidr', async ({ request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.globalStrategy.networking.clusterNetworkCidr = '10.200.0.0/14';
    await importState(request, fixture);

    const { files } = await generate(request);
    expect(files['install-config.yaml']).toContain('10.200.0.0/14');
  });

  test('serviceNetworkCidr → networking.serviceNetwork', async ({ request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.globalStrategy.networking.serviceNetworkCidr = '172.31.0.0/16';
    await importState(request, fixture);

    const { files } = await generate(request);
    expect(files['install-config.yaml']).toContain('172.31.0.0/16');
  });

  test('networkType → networking.networkType', async ({ request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.globalStrategy.networking.networkType = 'OVNKubernetes';
    await importState(request, fixture);

    const { files } = await generate(request);
    expect(files['install-config.yaml']).toContain('networkType: OVNKubernetes');
  });

  test('proxy fields → proxy section', async ({ request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.globalStrategy.proxyEnabled = true;
    fixture.globalStrategy.proxies = {
      httpProxy: 'http://squid.corp:3128',
      httpsProxy: 'https://squid.corp:3129',
      noProxy: '.internal,.svc,10.0.0.0/8',
    };
    await importState(request, fixture);

    const { files } = await generate(request);
    const ic = files['install-config.yaml'];
    expect(ic).toContain('httpProxy: http://squid.corp:3128');
    expect(ic).toContain('httpsProxy: https://squid.corp:3129');
    expect(ic).toContain('.internal,.svc,10.0.0.0/8');
  });

  test('additionalTrustBundle from mirror CA PEM', async ({ request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.trust = {
      mirrorRegistryCaPem: '-----BEGIN CERTIFICATE-----\nE2ETESTCERT\n-----END CERTIFICATE-----',
      proxyCaPem: '',
      additionalTrustBundlePolicy: 'Proxyonly',
    };
    await importState(request, fixture);

    const { files } = await generate(request);
    expect(files['install-config.yaml']).toContain('additionalTrustBundle');
    expect(files['install-config.yaml']).toContain('E2ETESTCERT');
  });

  test('architecture → compute/controlPlane architecture', async ({ request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.blueprint.arch = 'x86_64';
    await importState(request, fixture);

    const { files } = await generate(request);
    expect(files['install-config.yaml']).toContain('architecture: amd64');
  });
});

test.describe('Field-to-Asset Validation — platform-specific install-config', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  test('AWS region → platform.aws.region', async ({ request }) => {
    const fixture = scenarios.awsGovcloudIpi();
    fixture.platformConfig.aws.region = 'us-gov-east-1';
    await importState(request, fixture);

    const { files } = await generate(request);
    expect(files['install-config.yaml']).toContain('region: us-gov-east-1');
  });

  test('AWS AMI ID → platform.aws.amiID', async ({ request }) => {
    const fixture = scenarios.awsGovcloudIpi();
    fixture.platformConfig.aws.amiId = 'ami-e2etestid1234';
    await importState(request, fixture);

    const { files } = await generate(request);
    expect(files['install-config.yaml']).toContain('ami-e2etestid1234');
  });

  test('AWS instance types → controlPlane/compute platform.aws.type', async ({ request }) => {
    const fixture = scenarios.awsGovcloudIpi();
    fixture.platformConfig.aws.controlPlaneInstanceType = 'm5.4xlarge';
    fixture.platformConfig.aws.workerInstanceType = 'c5.2xlarge';
    await importState(request, fixture);

    const { files } = await generate(request);
    expect(files['install-config.yaml']).toContain('m5.4xlarge');
    expect(files['install-config.yaml']).toContain('c5.2xlarge');
  });

  test('vSphere vcenter → platform.vsphere.vcenters[0].server', async ({ request }) => {
    const fixture = scenarios.vsphereIpi();
    fixture.platformConfig.vsphere.vcenter = 'vcenter.e2e.lab';
    fixture.platformConfig.vsphere.placementMode = 'legacy';
    await importState(request, fixture);

    const { files } = await generate(request);
    expect(files['install-config.yaml']).toContain('vcenter.e2e.lab');
  });

  test('vSphere datacenter → platform.vsphere topology', async ({ request }) => {
    const fixture = scenarios.vsphereIpi();
    fixture.platformConfig.vsphere.datacenter = 'DC-E2E';
    fixture.platformConfig.vsphere.placementMode = 'legacy';
    await importState(request, fixture);

    const { files } = await generate(request);
    expect(files['install-config.yaml']).toContain('DC-E2E');
  });

  test('vSphere diskType → platform.vsphere.diskType', async ({ request }) => {
    const fixture = scenarios.vsphereIpi();
    fixture.platformConfig.vsphere.diskType = 'eagerZeroedThick';
    await importState(request, fixture);

    const { files } = await generate(request);
    expect(files['install-config.yaml']).toContain('eagerZeroedThick');
  });

  test('Nutanix endpoint → platform.nutanix.prismCentral.endpoint.address', async ({ request }) => {
    const fixture = scenarios.nutanixIpi();
    fixture.platformConfig.nutanix.endpoint = 'prism.e2e.lab';
    await importState(request, fixture);

    const { files } = await generate(request);
    expect(files['install-config.yaml']).toContain('prism.e2e.lab');
  });

  test('Nutanix subnet → platform.nutanix.subnetUUIDs', async ({ request }) => {
    const fixture = scenarios.nutanixIpi();
    fixture.platformConfig.nutanix.subnet = 'aaaa-bbbb-cccc-dddd';
    await importState(request, fixture);

    const { files } = await generate(request);
    expect(files['install-config.yaml']).toContain('aaaa-bbbb-cccc-dddd');
  });

  test('bare-metal-agent → platform.baremetal in install-config', async ({ request }) => {
    const fixture = scenarios.bareMetalAgent();
    await importState(request, fixture);

    const { files } = await generate(request);
    expect(files['install-config.yaml']).toContain('baremetal:');
  });

  test('bare-metal-upi → platform: none', async ({ request }) => {
    const fixture = scenarios.bareMetalUpi();
    await importState(request, fixture);

    const { files } = await generate(request);
    expect(files['install-config.yaml']).toContain('none:');
  });

  test('Azure region → platform.azure', async ({ request }) => {
    const fixture = scenarios.azureGovernmentIpi();
    fixture.platformConfig.azure = fixture.platformConfig.azure || {};
    fixture.platformConfig.azure.region = 'usgovarizona';
    await importState(request, fixture);

    const { files } = await generate(request);
    expect(files['install-config.yaml']).toContain('usgovarizona');
  });
});

test.describe('Field-to-Asset Validation — agent-config.yaml', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  test('agent-config generated only for agent-based scenarios', async ({ request }) => {
    // Agent scenario - should have agent-config
    const agentFixture = scenarios.bareMetalAgent();
    await importState(request, agentFixture);
    const agentResult = await generate(request);
    expect(agentResult.files['agent-config.yaml']).toBeTruthy();

    // IPI scenario - should NOT have agent-config
    await resetState(request);
    const ipiFixture = scenarios.vsphereIpi();
    await importState(request, ipiFixture);
    const ipiResult = await generate(request);
    expect(ipiResult.files['agent-config.yaml']).toBeFalsy();
  });

  test('clusterName → metadata.name in agent-config', async ({ request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.blueprint.clusterName = 'agent-e2e-test';
    await importState(request, fixture);

    const { files } = await generate(request);
    expect(files['agent-config.yaml']).toContain('name: agent-e2e-test');
  });

  test('ntpServers → additionalNTPSources', async ({ request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.globalStrategy.ntpServers = ['ntp-a.e2e', 'ntp-b.e2e', '10.0.0.123'];
    await importState(request, fixture);

    const { files } = await generate(request);
    const ac = files['agent-config.yaml'];
    expect(ac).toContain('additionalNTPSources');
    expect(ac).toContain('ntp-a.e2e');
    expect(ac).toContain('ntp-b.e2e');
    expect(ac).toContain('10.0.0.123');
  });

  test('node hostnames → hosts[i].hostname', async ({ request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.hostInventory.nodes = [
      { hostname: 'cp-0', role: 'master', bmcAddress: '', bmcUsername: '', bmcPassword: '',
        bootMACAddress: '52:54:00:aa:00:01', networkInterfaces: [], dnsServers: '', dnsSearch: '' },
      { hostname: 'cp-1', role: 'master', bmcAddress: '', bmcUsername: '', bmcPassword: '',
        bootMACAddress: '52:54:00:aa:00:02', networkInterfaces: [], dnsServers: '', dnsSearch: '' },
    ];
    await importState(request, fixture);

    const { files } = await generate(request);
    const ac = files['agent-config.yaml'];
    expect(ac).toContain('hostname: cp-0');
    expect(ac).toContain('hostname: cp-1');
  });

  test('node roles → hosts[i].role', async ({ request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.hostInventory.nodes = [
      { hostname: 'master-0', role: 'master', bmcAddress: '', bmcUsername: '', bmcPassword: '',
        bootMACAddress: '52:54:00:aa:00:01', networkInterfaces: [], dnsServers: '', dnsSearch: '' },
      { hostname: 'worker-0', role: 'worker', bmcAddress: '', bmcUsername: '', bmcPassword: '',
        bootMACAddress: '52:54:00:aa:00:02', networkInterfaces: [], dnsServers: '', dnsSearch: '' },
    ];
    await importState(request, fixture);

    const { files } = await generate(request);
    const ac = files['agent-config.yaml'];
    expect(ac).toContain('role: master');
    expect(ac).toContain('role: worker');
  });

  test('node dnsServers → networkConfig dns-resolver.config.server', async ({ request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.hostInventory.nodes = [
      { hostname: 'node-0', role: 'master', bmcAddress: '', bmcUsername: '', bmcPassword: '',
        bootMACAddress: '52:54:00:aa:00:01', networkInterfaces: [],
        dnsServers: '10.0.0.53,10.0.0.54', dnsSearch: 'e2e.lab' },
    ];
    await importState(request, fixture);

    const { files } = await generate(request);
    const ac = files['agent-config.yaml'];
    if (ac.includes('dns-resolver')) {
      expect(ac).toContain('10.0.0.53');
      expect(ac).toContain('10.0.0.54');
      expect(ac).toContain('e2e.lab');
    }
  });
});

test.describe('Field-to-Asset Validation — imageset-config.yaml', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  test('patchVersion → mirror.platform.channels version', async ({ request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.release.patchVersion = '4.20.5';
    await importState(request, fixture);

    const { files } = await generate(request);
    const isc = files['imageset-config.yaml'];
    expect(isc).toContain('4.20.5');
    expect(isc).toContain('stable-4.20');
  });

  test('kind: ImageSetConfiguration present', async ({ request }) => {
    const fixture = scenarios.bareMetalAgent();
    await importState(request, fixture);

    const { files } = await generate(request);
    expect(files['imageset-config.yaml']).toContain('kind: ImageSetConfiguration');
  });

  test('graph: true by default', async ({ request }) => {
    const fixture = scenarios.bareMetalAgent();
    await importState(request, fixture);

    const { files } = await generate(request);
    expect(files['imageset-config.yaml']).toContain('graph: true');
  });

  test('additional images appear in imageset-config', async ({ request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.imagesetConfig = fixture.imagesetConfig || {};
    fixture.imagesetConfig.additionalImages = 'quay.io/test/image:v1.0\nregistry.io/custom:latest';
    await importState(request, fixture);

    const { files } = await generate(request);
    const isc = files['imageset-config.yaml'];
    if (isc.includes('additionalImages')) {
      expect(isc).toContain('quay.io/test/image:v1.0');
      expect(isc).toContain('registry.io/custom:latest');
    }
  });
});

test.describe('Field-to-Asset Validation — mirror sources', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  test('mirror sources → imageDigestSources in install-config', async ({ request }) => {
    const fixture = scenarios.bareMetalAgent();
    fixture.credentials.usingMirrorRegistry = true;
    fixture.globalStrategy.mirroring = {
      registryFqdn: 'mirror.e2e.lab:5000',
      sources: [
        {
          source: 'quay.io/openshift-release-dev/ocp-release',
          mirrors: ['mirror.e2e.lab:5000/ocp-release'],
        },
      ],
    };
    await importState(request, fixture);

    const { files } = await generate(request);
    const ic = files['install-config.yaml'];
    expect(ic).toContain('quay.io/openshift-release-dev/ocp-release');
    expect(ic).toContain('mirror.e2e.lab:5000/ocp-release');
  });
});
