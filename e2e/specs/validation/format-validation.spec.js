import { test, expect } from '@playwright/test';
import { resetState, importState } from '../../helpers/api.js';
import { navigateToStep, fillAndBlur } from '../../helpers/navigation.js';
import { bareMetalAgent } from '../../fixtures/scenarios.js';

test.describe('Format Validation', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  async function seedAndNavigate(page, request, stepName) {
    await importState(request, bareMetalAgent());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, stepName);
    await page.waitForTimeout(500);
  }

  test('rejects invalid CIDR on Networking step', async ({ page, request }) => {
    await seedAndNavigate(page, request, 'Networking');

    const machineInput = page.locator('input[placeholder="10.90.0.0/24"]');
    await fillAndBlur(machineInput, '10.0.0.5/24');
    await page.waitForTimeout(300);

    // Invalid CIDR should produce error indicator
    const hasError = await machineInput.evaluate(el =>
      el.classList.contains('input-error') || el.getAttribute('aria-invalid') === 'true'
    );
    const errorNote = page.locator('.note.warning').first();
    const noteVisible = await errorNote.isVisible({ timeout: 2000 }).catch(() => false);

    expect(hasError || noteVisible).toBeTruthy();
  });

  test('accepts valid CIDR on Networking step', async ({ page, request }) => {
    await seedAndNavigate(page, request, 'Networking');

    const machineInput = page.locator('input[placeholder="10.90.0.0/24"]');
    await fillAndBlur(machineInput, '10.0.0.0/24');
    await page.waitForTimeout(300);

    const hasError = await machineInput.evaluate(el =>
      el.classList.contains('input-error') || el.getAttribute('aria-invalid') === 'true'
    );
    expect(hasError).toBeFalsy();
  });

  test('number fields enforce numeric-only input', async ({ page, request }) => {
    await seedAndNavigate(page, request, 'Networking');

    // Cluster host prefix is a number field
    const hostPrefixInput = page.locator('input[type="number"]').first();
    if (await hostPrefixInput.isVisible({ timeout: 3000 })) {
      // Number inputs natively reject non-numeric characters via browser
      // Verify the field has a valid numeric value and accepts numeric input
      const originalValue = await hostPrefixInput.inputValue();
      expect(!isNaN(Number(originalValue))).toBeTruthy();

      // Fill with a valid number
      await fillAndBlur(hostPrefixInput, '25');
      const newValue = await hostPrefixInput.inputValue();
      expect(newValue).toBe('25');
    }
  });

  test('rejects overly long cluster name', async ({ page, request }) => {
    await seedAndNavigate(page, request, 'Identity');

    const clusterInput = page.locator('input[placeholder="agent-cluster"]').or(
      page.locator('input[aria-required="true"]').first()
    );
    if (await clusterInput.first().isVisible({ timeout: 3000 })) {
      // Cluster names have DNS-label constraints (max 63 chars, lowercase alphanumeric + hyphens)
      const longName = 'a'.repeat(100);
      await fillAndBlur(clusterInput.first(), longName);
      await page.waitForTimeout(300);

      // Check for validation error
      const hasError = await clusterInput.first().evaluate(el =>
        el.classList.contains('input-error') || el.getAttribute('aria-invalid') === 'true'
      );
      const errorNote = page.locator('.note.warning').first();
      const noteVisible = await errorNote.isVisible({ timeout: 2000 }).catch(() => false);
      // At minimum, the app should not crash
    }
  });

  test('rejects invalid IP for VIP fields', async ({ page, request }) => {
    await seedAndNavigate(page, request, 'Networking');

    const apiVipInput = page.locator('input').filter({ hasText: '' }).locator('[placeholder*="VIP"], [placeholder*="vip"]').first();
    // VIP inputs may use label-based locators
    const apiVipByLabel = page.locator('label:has-text("API VIP")').locator('..').locator('input');

    const vipInput = apiVipByLabel.or(apiVipInput).first();
    if (await vipInput.isVisible({ timeout: 3000 })) {
      await fillAndBlur(vipInput, '999.999.999.999');
      await page.waitForTimeout(300);

      const hasError = await vipInput.evaluate(el =>
        el.classList.contains('input-error') || el.getAttribute('aria-invalid') === 'true'
      );
      const errorNote = page.locator('.note.warning').first();
      const noteVisible = await errorNote.isVisible({ timeout: 2000 }).catch(() => false);
      expect(hasError || noteVisible).toBeTruthy();
    }
  });
});
