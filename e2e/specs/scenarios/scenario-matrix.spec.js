import { test, expect } from '@playwright/test';
import { resetState, importState, generateAssets } from '../../helpers/api.js';
import * as scenarios from '../../fixtures/scenarios.js';

const BACKEND = 'http://localhost:4000';

test.describe('Scenario Matrix — generate + validate assets for all scenarios', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  for (const { id, name, fixture, hasAgentConfig } of scenarios.ALL_SCENARIOS) {
    test(`${id}: generates valid install-config and imageset-config`, async ({ request }) => {
      const state = fixture();

      await importState(request, state);

      const result = await generateAssets(request, state);
      const files = result.files;

      // install-config.yaml must always exist
      expect(files['install-config.yaml']).toBeTruthy();
      const ic = files['install-config.yaml'];
      expect(ic).toContain('apiVersion:');
      expect(ic).toContain(`baseDomain: ${state.blueprint.baseDomain}`);
      expect(ic).toContain(`name: ${state.blueprint.clusterName}`);
      expect(ic).toContain('networking:');
      expect(ic).toContain('platform:');

      // Validate correct platform key
      const platformKey = getPlatformKey(id);
      expect(ic).toContain(`${platformKey}:`);

      // imageset-config.yaml must always exist
      expect(files['imageset-config.yaml']).toBeTruthy();
      expect(files['imageset-config.yaml']).toContain('kind: ImageSetConfiguration');

      // FIELD_MANUAL.md must always exist
      expect(files['FIELD_MANUAL.md']).toBeTruthy();
      expect(files['FIELD_MANUAL.md'].length).toBeGreaterThan(100);

      // agent-config.yaml: only for agent-based scenarios
      if (hasAgentConfig) {
        expect(files['agent-config.yaml']).toBeTruthy();
        expect(files['agent-config.yaml']).toContain('kind: AgentConfig');
        expect(files['agent-config.yaml']).toContain('rendezvousIP:');
        expect(files['agent-config.yaml']).toContain('hosts:');
      } else {
        expect(files['agent-config.yaml']).toBeFalsy();
      }
    });
  }

  test('bare-metal-agent with FIPS generates fips: true in install-config', async ({ request }) => {
    const state = scenarios.withFips(scenarios.bareMetalAgent());
    await importState(request, state);
    const result = await generateAssets(request, state);
    expect(result.files['install-config.yaml']).toContain('fips: true');
  });

  test('bare-metal-agent with proxy generates proxy config', async ({ request }) => {
    const state = scenarios.withProxy(scenarios.bareMetalAgent());
    await importState(request, state);
    const result = await generateAssets(request, state);
    const ic = result.files['install-config.yaml'];
    expect(ic).toContain('proxy:');
    expect(ic).toContain('httpProxy:');
  });

  test('bare-metal-agent with dual-stack generates IPv6 networks', async ({ request }) => {
    const state = scenarios.withDualStack(scenarios.bareMetalAgent());
    await importState(request, state);
    const result = await generateAssets(request, state);
    const ic = result.files['install-config.yaml'];
    // Dual-stack adds IPv6 cluster and service CIDRs
    expect(ic).toContain('fd01::/48');
    expect(ic).toContain('fd02::/112');
  });

  test('vsphere-ipi with trust bundle generates additionalTrustBundle', async ({ request }) => {
    const state = scenarios.withTrustBundle(scenarios.vsphereIpi());
    await importState(request, state);
    const result = await generateAssets(request, state);
    const ic = result.files['install-config.yaml'];
    expect(ic).toContain('additionalTrustBundle:');
  });
});

function getPlatformKey(scenarioId) {
  if (scenarioId.startsWith('bare-metal-upi')) return 'none';
  if (scenarioId.startsWith('bare-metal')) return 'baremetal';
  if (scenarioId.startsWith('vsphere') && scenarioId.endsWith('upi')) return 'vsphere';
  if (scenarioId.startsWith('vsphere')) return 'vsphere';
  if (scenarioId.startsWith('aws')) return 'aws';
  if (scenarioId.startsWith('azure')) return 'azure';
  if (scenarioId.startsWith('nutanix')) return 'nutanix';
  if (scenarioId.startsWith('ibm')) return 'ibmcloud';
  return 'none';
}
