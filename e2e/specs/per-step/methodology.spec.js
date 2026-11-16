import { test, expect } from '@playwright/test';
import { resetState, importState } from '../../helpers/api.js';
import { navigateToStep, selectCard } from '../../helpers/navigation.js';
import * as scenarios from '../../fixtures/scenarios.js';

test.describe('Methodology Step', () => {
  test.beforeEach(async ({ request }) => { await resetState(request); });

  test('Bare Metal: Agent, IPI, UPI all available', async ({ page, request }) => {
    // Use bare-metal-agent fixture but navigate to Methodology
    await importState(request, scenarios.bareMetalAgent());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Methodology');
    await page.waitForTimeout(500);

    await expect(page.locator('button.select-card:has-text("IPI")')).toBeEnabled();
    await expect(page.locator('button.select-card:has-text("UPI")')).toBeEnabled();
    await expect(page.locator('button.select-card:has-text("Agent")')).toBeEnabled();
  });

  test('Nutanix: only IPI available', async ({ page, request }) => {
    await importState(request, scenarios.nutanixIpi());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Methodology');
    await page.waitForTimeout(500);

    await expect(page.locator('button.select-card:has-text("IPI")')).toBeEnabled();
    await expect(page.locator('button.select-card:has-text("UPI")')).toBeDisabled();
    await expect(page.locator('button.select-card:has-text("Agent")')).toBeDisabled();
  });

  test('AWS GovCloud: IPI and UPI available', async ({ page, request }) => {
    await importState(request, scenarios.awsGovcloudIpi());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Methodology');
    await page.waitForTimeout(500);

    await expect(page.locator('button.select-card:has-text("IPI")')).toBeEnabled();
    await expect(page.locator('button.select-card:has-text("UPI")')).toBeEnabled();
    await expect(page.locator('button.select-card:has-text("Agent")')).toBeDisabled();
  });

  test('IBM Cloud: only IPI available', async ({ page, request }) => {
    await importState(request, scenarios.ibmCloudIpi());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Methodology');
    await page.waitForTimeout(500);

    await expect(page.locator('button.select-card:has-text("IPI")')).toBeEnabled();
    await expect(page.locator('button.select-card:has-text("UPI")')).toBeDisabled();
    await expect(page.locator('button.select-card:has-text("Agent")')).toBeDisabled();
  });

  test('VMware vSphere: IPI, UPI, Agent all available', async ({ page, request }) => {
    await importState(request, scenarios.vsphereIpi());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Methodology');
    await page.waitForTimeout(500);

    await expect(page.locator('button.select-card:has-text("IPI")')).toBeEnabled();
    await expect(page.locator('button.select-card:has-text("UPI")')).toBeEnabled();
    await expect(page.locator('button.select-card:has-text("Agent")')).toBeEnabled();
  });

  test('Azure Government: only IPI available', async ({ page, request }) => {
    await importState(request, scenarios.azureGovernmentIpi());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Methodology');
    await page.waitForTimeout(500);

    await expect(page.locator('button.select-card:has-text("IPI")')).toBeEnabled();
    await expect(page.locator('button.select-card:has-text("UPI")')).toBeDisabled();
    await expect(page.locator('button.select-card:has-text("Agent")')).toBeDisabled();
  });
});
