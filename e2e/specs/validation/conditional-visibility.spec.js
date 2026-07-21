import { test, expect } from '@playwright/test';
import { resetState, importState } from '../../helpers/api.js';
import { navigateToStep, expectStepVisible, expectStepHidden } from '../../helpers/navigation.js';
import * as scenarios from '../../fixtures/scenarios.js';

test.describe('Conditional Visibility — steps and fields', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  test('Hosts/Inventory step visible for bare-metal-agent', async ({ page, request }) => {
    await importState(request, scenarios.bareMetalAgent());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expectStepVisible(page, 'Hosts');
  });

  test('Hosts/Inventory step visible for bare-metal-ipi', async ({ page, request }) => {
    await importState(request, scenarios.bareMetalIpi());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expectStepVisible(page, 'Hosts');
  });

  test('Hosts/Inventory step visible for vsphere-agent', async ({ page, request }) => {
    await importState(request, scenarios.vsphereAgent());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expectStepVisible(page, 'Hosts');
  });

  test('Hosts/Inventory step hidden for vsphere-ipi', async ({ page, request }) => {
    await importState(request, scenarios.vsphereIpi());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expectStepHidden(page, 'Hosts');
  });

  test('Hosts/Inventory step hidden for aws-govcloud-ipi', async ({ page, request }) => {
    await importState(request, scenarios.awsGovcloudIpi());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expectStepHidden(page, 'Hosts');
  });

  test('Hosts/Inventory step hidden for nutanix-ipi', async ({ page, request }) => {
    await importState(request, scenarios.nutanixIpi());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expectStepHidden(page, 'Hosts');
  });

  test('Connectivity & Mirroring step hidden for aws-govcloud-ipi without mirror registry', async ({ page, request }) => {
    const state = scenarios.awsGovcloudIpi();
    state.credentials.mirrorRegistryCredentialsConfigured = false;
    state.credentials.mirrorRegistryPullSecret = '';
    await importState(request, state);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expectStepHidden(page, 'Connectivity');
  });

  test('Connectivity & Mirroring step visible for bare-metal-agent', async ({ page, request }) => {
    await importState(request, scenarios.bareMetalAgent());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expectStepVisible(page, 'Connectivity');
  });

  test('VIP fields visible on Networking step for bare-metal-agent', async ({ page, request }) => {
    await importState(request, scenarios.bareMetalAgent());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Networking');
    await page.waitForTimeout(500);

    // VIP fields should be visible for scenarios with host inventory
    const apiVipLabel = page.locator('label:has-text("API VIP"), span:has-text("API VIP")').first();
    await expect(apiVipLabel).toBeVisible({ timeout: 5000 });
  });

  test('VIP fields hidden on Networking step for aws-govcloud-ipi', async ({ page, request }) => {
    await importState(request, scenarios.awsGovcloudIpi());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Networking');
    await page.waitForTimeout(500);

    const apiVipLabel = page.locator('label:has-text("API VIP")');
    await expect(apiVipLabel).toHaveCount(0, { timeout: 3000 });
  });

  test('agent-config preview visible for agent-based scenario', async ({ page, request }) => {
    await importState(request, scenarios.bareMetalAgent());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Assets');
    await page.waitForTimeout(1000);

    const agentConfigCard = page.locator('.card:has-text("agent-config"), h3:has-text("agent-config")');
    await expect(agentConfigCard.first()).toBeVisible({ timeout: 5000 });
  });

  test('agent-config preview hidden for non-agent scenario', async ({ page, request }) => {
    await importState(request, scenarios.vsphereIpi());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Assets');
    await page.waitForTimeout(1000);

    // Use h3 selector only — .card may match cards mentioning agent-config in descriptions
    const agentConfigHeading = page.locator('h3:has-text("agent-config")');
    await expect(agentConfigHeading).toHaveCount(0, { timeout: 3000 });
  });

  test('Platform Specifics shows AWS section for aws-govcloud-ipi', async ({ page, request }) => {
    await importState(request, scenarios.awsGovcloudIpi());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Platform');
    await page.waitForTimeout(500);

    const awsSection = page.locator('.card:has-text("AWS GovCloud"), h3:has-text("AWS")');
    await expect(awsSection.first()).toBeVisible({ timeout: 5000 });

    // vSphere and Nutanix sections should NOT be visible
    const vsphereSection = page.locator('.card:has-text("vSphere IPI"), h3:has-text("vSphere IPI")');
    await expect(vsphereSection).toHaveCount(0, { timeout: 2000 });
  });

  test('Platform Specifics shows vSphere section for vsphere-ipi', async ({ page, request }) => {
    await importState(request, scenarios.vsphereIpi());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Platform');
    await page.waitForTimeout(500);

    const vsphereSection = page.locator('.card:has-text("vSphere"), h3:has-text("vSphere")');
    await expect(vsphereSection.first()).toBeVisible({ timeout: 5000 });
  });

  test('Platform Specifics shows Nutanix section for nutanix-ipi', async ({ page, request }) => {
    await importState(request, scenarios.nutanixIpi());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Platform');
    await page.waitForTimeout(500);

    const nutanixSection = page.locator('.card:has-text("Nutanix"), h3:has-text("Nutanix")');
    await expect(nutanixSection.first()).toBeVisible({ timeout: 5000 });
  });
});
