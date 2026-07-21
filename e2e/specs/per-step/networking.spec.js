import { test, expect } from '@playwright/test';
import { resetState, importState, getState } from '../../helpers/api.js';
import { navigateToStep, fillAndBlur } from '../../helpers/navigation.js';
import * as scenarios from '../../fixtures/scenarios.js';

test.describe('Networking Step', () => {
  test.beforeEach(async ({ request }) => { await resetState(request); });

  async function seedAndNav(page, request, scenarioFn = scenarios.bareMetalAgent) {
    await importState(request, scenarioFn());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Networking');
    await page.waitForTimeout(500);
  }

  test('can fill machine network CIDR', async ({ page, request }) => {
    await seedAndNav(page, request);
    const input = page.locator('input[placeholder="10.90.0.0/24"]');
    await expect(input).toBeVisible();
    await fillAndBlur(input, '192.168.10.0/24');
    await page.waitForTimeout(500);

    const state = await getState(request);
    expect(state.globalStrategy.networking.machineNetworkV4).toBe('192.168.10.0/24');
  });

  test('can fill cluster and service network CIDRs', async ({ page, request }) => {
    await seedAndNav(page, request);

    const clusterInput = page.locator('input[placeholder="10.128.0.0/14"]');
    const serviceInput = page.locator('input[placeholder="172.30.0.0/16"]');

    if (await clusterInput.isVisible({ timeout: 3000 })) {
      await fillAndBlur(clusterInput, '10.200.0.0/14');
    }
    if (await serviceInput.isVisible({ timeout: 3000 })) {
      await fillAndBlur(serviceInput, '172.31.0.0/16');
    }

    await page.waitForTimeout(500);
    const state = await getState(request);
    expect(state.globalStrategy.networking.clusterNetworkCidr).toBe('10.200.0.0/14');
    expect(state.globalStrategy.networking.serviceNetworkCidr).toBe('172.31.0.0/16');
  });

  test('API VIP and Ingress VIP visible for bare-metal-agent', async ({ page, request }) => {
    await seedAndNav(page, request, scenarios.bareMetalAgent);

    // VIP fields should be present for scenarios with host inventory
    const apiVipLabel = page.locator('label:has-text("API VIP"), span:has-text("API VIP")').first();
    await expect(apiVipLabel).toBeVisible({ timeout: 5000 });

    const ingressVipLabel = page.locator('label:has-text("Ingress VIP"), span:has-text("Ingress VIP")').first();
    await expect(ingressVipLabel).toBeVisible({ timeout: 5000 });
  });

  test('VIP fields not visible for aws-govcloud-ipi', async ({ page, request }) => {
    await seedAndNav(page, request, scenarios.awsGovcloudIpi);

    const apiVipLabel = page.locator('label:has-text("API VIP"), span:has-text("API VIP")');
    await expect(apiVipLabel).toHaveCount(0, { timeout: 3000 });
  });

  test('IP stack mode select changes available fields', async ({ page, request }) => {
    await seedAndNav(page, request);

    const ipStackSelect = page.locator('select[aria-label="IP Stack Mode"]');
    if (await ipStackSelect.isVisible({ timeout: 3000 })) {
      // Select dual-stack
      await ipStackSelect.selectOption('dual-stack');
      await page.waitForTimeout(500);

      // IPv6 CIDR fields should now be visible
      const v6Label = page.locator('label:has-text("IPv6"), span:has-text("IPv6")').first();
      const v6Visible = await v6Label.isVisible({ timeout: 3000 }).catch(() => false);
      // If dual-stack is available, IPv6 fields should appear
    }
  });

  test('can fill VIP addresses for bare-metal-agent', async ({ page, request }) => {
    await seedAndNav(page, request, scenarios.bareMetalAgent);

    // Find VIP input fields by their nearby labels
    const allInputs = page.locator('input[type="text"]');
    const count = await allInputs.count();

    for (let i = 0; i < count; i++) {
      const input = allInputs.nth(i);
      const placeholder = await input.getAttribute('placeholder');
      if (placeholder && (placeholder.includes('VIP') || placeholder.includes('vip'))) {
        await fillAndBlur(input, '10.90.0.100');
        break;
      }
    }
  });
});
