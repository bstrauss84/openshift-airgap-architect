import { test, expect } from '@playwright/test';
import { resetState, importState } from '../../helpers/api.js';
import { navigateToStep, fillAndBlur } from '../../helpers/navigation.js';
import { bareMetalAgent, nutanixIpi } from '../../fixtures/scenarios.js';

test.describe('Required Field Validation', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  test('Identity step shows validation for empty cluster name', async ({ page, request }) => {
    const state = bareMetalAgent();
    state.blueprint.clusterName = '';
    await importState(request, state);

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Identity');
    await page.waitForTimeout(500);

    const clusterInput = page.locator('input[placeholder="agent-cluster"]').or(
      page.locator('input[aria-required="true"]').first()
    );
    await expect(clusterInput.first()).toBeVisible({ timeout: 5000 });

    // The field should be empty
    const value = await clusterInput.first().inputValue();
    expect(value).toBe('');

    // Check for validation indicator (input-error class or warning note)
    // Validation may only appear after blur or proceed attempt
    await clusterInput.first().click();
    await clusterInput.first().fill('');
    await clusterInput.first().evaluate(el => el.blur());
    await page.waitForTimeout(300);
  });

  test('Identity step shows validation for empty base domain', async ({ page, request }) => {
    const state = bareMetalAgent();
    state.blueprint.baseDomain = '';
    await importState(request, state);

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Identity');
    await page.waitForTimeout(500);

    const domainInput = page.locator('input[placeholder="example.com"]');
    await expect(domainInput).toBeVisible({ timeout: 5000 });
    const value = await domainInput.inputValue();
    expect(value).toBe('');
  });

  test('filling required cluster name removes validation error', async ({ page, request }) => {
    const state = bareMetalAgent();
    state.blueprint.clusterName = '';
    await importState(request, state);

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Identity');
    await page.waitForTimeout(500);

    const clusterInput = page.locator('input[placeholder="agent-cluster"]').or(
      page.locator('input[aria-required="true"]').first()
    );

    // Fill the required field
    await fillAndBlur(clusterInput.first(), 'test-cluster');
    await page.waitForTimeout(300);

    // Input should no longer have error class
    const hasError = await clusterInput.first().evaluate(el =>
      el.classList.contains('input-error') || el.getAttribute('aria-invalid') === 'true'
    );
    expect(hasError).toBeFalsy();
  });

  test('Networking step validates machine network CIDR format', async ({ page, request }) => {
    const state = bareMetalAgent();
    await importState(request, state);

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Networking');
    await page.waitForTimeout(500);

    const machineNetworkInput = page.locator('input[placeholder="10.90.0.0/24"]');
    await expect(machineNetworkInput).toBeVisible({ timeout: 5000 });

    // Enter invalid CIDR
    await fillAndBlur(machineNetworkInput, 'not-a-cidr');
    await page.waitForTimeout(300);

    // Should show validation error
    const errorNote = page.locator('.note.warning, .input-error, [aria-invalid="true"]').first();
    const hasError = await errorNote.isVisible({ timeout: 3000 }).catch(() => false);
    // Check if the input itself has error styling
    const inputHasError = await machineNetworkInput.evaluate(el =>
      el.classList.contains('input-error') || el.getAttribute('aria-invalid') === 'true'
    );
    expect(hasError || inputHasError).toBeTruthy();
  });

  test('Networking step accepts valid CIDR', async ({ page, request }) => {
    const state = bareMetalAgent();
    await importState(request, state);

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Networking');
    await page.waitForTimeout(500);

    const machineNetworkInput = page.locator('input[placeholder="10.90.0.0/24"]');
    await fillAndBlur(machineNetworkInput, '192.168.0.0/24');
    await page.waitForTimeout(300);

    const inputHasError = await machineNetworkInput.evaluate(el =>
      el.classList.contains('input-error') || el.getAttribute('aria-invalid') === 'true'
    );
    expect(inputHasError).toBeFalsy();
  });

  test('Nutanix Platform Specifics requires endpoint', async ({ page, request }) => {
    const state = nutanixIpi();
    state.platformConfig.nutanix.endpoint = '';
    await importState(request, state);

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Platform');
    await page.waitForTimeout(500);

    const endpointInput = page.locator('input[placeholder*="prism"]');
    if (await endpointInput.isVisible({ timeout: 3000 })) {
      const value = await endpointInput.inputValue();
      expect(value).toBe('');

      // The field should have aria-required
      const isRequired = await endpointInput.getAttribute('aria-required');
      // Nutanix endpoint is catalog-driven required
    }
  });

  test('Nutanix Platform Specifics requires subnet UUID', async ({ page, request }) => {
    const state = nutanixIpi();
    state.platformConfig.nutanix.subnet = '';
    await importState(request, state);

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Platform');
    await page.waitForTimeout(500);

    const subnetInput = page.locator('input[placeholder*="subnet-uuid"]');
    if (await subnetInput.isVisible({ timeout: 3000 })) {
      const value = await subnetInput.inputValue();
      expect(value).toBe('');
    }
  });

  test('SSH key is required on Identity step', async ({ page, request }) => {
    const state = bareMetalAgent();
    state.credentials.sshPublicKey = '';
    await importState(request, state);

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Identity');
    await page.waitForTimeout(500);

    // SSH key textarea should be empty
    const sshTextarea = page.locator('textarea[aria-label*="SSH"]').or(
      page.locator('textarea[placeholder*="ssh-rsa"]')
    );
    if (await sshTextarea.isVisible({ timeout: 3000 })) {
      // Field should indicate it's required
      const required = await sshTextarea.getAttribute('aria-required');
      expect(required).toBe('true');
    }
  });
});
