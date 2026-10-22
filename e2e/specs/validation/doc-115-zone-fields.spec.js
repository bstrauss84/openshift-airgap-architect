/**
 * DOC-115 (GitHub issue #18) — real-browser keyboard entry for cloud zone lists.
 *
 * Acceptance criterion 4 asks for real keyboard input (pressSequentially), not
 * value replacement. Unlike the older soft checks in multi-value-fields.spec.js
 * these assertions are unconditional: if the field is missing the test fails.
 * Covers AWS GovCloud, Azure Government and IBM Cloud: typing, paste, editing
 * one value, blur normalization, the persisted state array, and the generated
 * install-config.yaml sequence.
 */
import { test, expect } from '@playwright/test';
import * as yaml from 'js-yaml';
import { resetState, getState, generateAssets } from '../../helpers/api.js';

const BACKEND = process.env.OAA_BROWSER_BACKEND_URL || process.env.E2E_BACKEND_URL || 'http://localhost:4000';

const PROVIDERS = [
  { platform: 'AWS GovCloud', key: 'aws', base: { region: 'us-gov-west-1' }, placeholder: 'e.g. us-gov-west-1a,us-gov-west-1b,us-gov-west-1c', a: 'us-gov-west-1a', b: 'us-gov-west-1b', c: 'us-gov-west-1c', at: (ic) => ic.platform.aws.defaultMachinePlatform?.zones },
  { platform: 'Azure Government', key: 'azure', base: { region: 'usgovvirginia', baseDomainResourceGroupName: 'rg' }, placeholder: 'e.g. 1,2,3', a: '1', b: '2', c: '3', at: (ic) => ic.platform.azure.defaultMachinePlatform?.zones },
  { platform: 'IBM Cloud', key: 'ibmcloud', base: { region: 'us-east' }, placeholder: 'e.g. us-east-1,us-east-2,us-east-3', a: 'us-east-1', b: 'us-east-2', c: 'us-east-3', at: (ic) => ic.platform.ibmcloud.defaultMachinePlatform?.zones },
];

const stateFor = (p) => ({
  _schemaVersion: 3,
  version: { _schemaVersion: 3, selectedMinor: '4.22', selectedPatch: '4.22.16', selectedChannel: 'stable-4.22', selectedVersion: '4.22.16', locked: true },
  release: { channel: '4.22', patchVersion: '4.22.16', confirmed: true },
  blueprint: { platform: p.platform, arch: 'x86_64', clusterName: 'doc115', baseDomain: 'example.com', confirmed: true },
  methodology: { method: 'IPI' },
  globalStrategy: { networking: { machineNetworkV4: '10.0.0.0/16' } },
  platformConfig: { [p.key]: p.base },
  ui: { segmentedFlowV1: true, showLanding: false, activeStepId: 'platform-specifics', visitedSteps: { 'platform-specifics': true } },
});

async function open(page, request, p) {
  await resetState(request);
  const res = await request.post(`${BACKEND}/api/state`, { data: stateFor(p), headers: { 'X-OAA-Request': '1' } });
  expect(res.status()).toBeLessThan(400);
  await page.route('**/api/aws/**', (route) => route.fulfill({ json: { regions: ['us-gov-west-1'], ami: 'ami-0123456789abcdef0' } }));
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const input = page.getByPlaceholder(p.placeholder, { exact: true });
  await expect(input).toBeVisible({ timeout: 15000 });
  return input;
}

const zonesIn = async (request, p) => (await getState(request)).platformConfig?.[p.key]?.defaultMachinePlatformZones;

for (const p of PROVIDERS) {
  test.describe(`DOC-115 ${p.platform} zones`, () => {
    test('sequential keyboard entry keeps commas and commits an array on blur', async ({ page, request }) => {
      const input = await open(page, request, p);
      await input.click();
      await input.pressSequentially(`${p.a},${p.b},`, { delay: 25 });
      await expect(input).toHaveValue(`${p.a},${p.b},`);
      await input.pressSequentially(` ${p.c} `, { delay: 25 });
      await page.keyboard.press('Tab');
      await expect(input).toHaveValue(`${p.a},${p.b},${p.c}`);
      await expect.poll(() => zonesIn(request, p), { timeout: 5000 }).toEqual([p.a, p.b, p.c]);

      const { files } = await generateAssets(request, await getState(request));
      expect(p.at(yaml.load(files['install-config.yaml']))).toEqual([p.a, p.b, p.c]);
    });

    test('paste and single-value correction', async ({ page, request }) => {
      const input = await open(page, request, p);
      await input.click();
      await page.keyboard.insertText(`${p.a},${p.b},${p.c}`); // paste-equivalent text insertion
      await expect(input).toHaveValue(`${p.a},${p.b},${p.c}`);
      await page.keyboard.press('End');
      for (let i = 0; i <= p.c.length; i++) await page.keyboard.press('Backspace');
      await input.pressSequentially(`,${p.a}`, { delay: 25 });
      await page.keyboard.press('Tab');
      await expect.poll(() => zonesIn(request, p), { timeout: 5000 }).toEqual([p.a, p.b, p.a]);
    });
  });
}
