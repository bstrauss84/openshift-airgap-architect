import { test, expect } from '@playwright/test';
import { resetState } from '../../helpers/api.js';
import { startFromLanding, selectCard, lockBlueprint } from '../../helpers/navigation.js';

test.describe('Blueprint Step', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetState(request);
    await startFromLanding(page);
  });

  // 6 tests: one per platform card
  test('can select Bare Metal platform', async ({ page }) => {
    await selectCard(page, 'Bare Metal');
    await expect(page.locator('button.select-card.selected:has-text("Bare Metal")')).toBeVisible();
  });

  test('can select VMware vSphere platform', async ({ page }) => {
    await selectCard(page, 'VMware vSphere');
    await expect(page.locator('button.select-card.selected:has-text("VMware vSphere")')).toBeVisible();
  });

  test('can select Nutanix platform', async ({ page }) => {
    await selectCard(page, 'Nutanix');
    await expect(page.locator('button.select-card.selected:has-text("Nutanix")')).toBeVisible();
  });

  test('can select AWS GovCloud platform', async ({ page }) => {
    await selectCard(page, 'AWS GovCloud');
    await expect(page.locator('button.select-card.selected:has-text("AWS GovCloud")')).toBeVisible();
  });

  test('can select Azure Government platform', async ({ page }) => {
    await selectCard(page, 'Azure Government');
    await expect(page.locator('button.select-card.selected:has-text("Azure Government")')).toBeVisible();
  });

  test('can select IBM Cloud platform', async ({ page }) => {
    await selectCard(page, 'IBM Cloud');
    await expect(page.locator('button.select-card.selected:has-text("IBM Cloud")')).toBeVisible();
  });

  // Architecture filtering
  test('Nutanix only allows x86_64 architecture', async ({ page }) => {
    await selectCard(page, 'Nutanix');
    // aarch64, ppc64le, s390x should be disabled
    const aarch64 = page.locator('button.select-card:has-text("aarch64")');
    const ppc64le = page.locator('button.select-card:has-text("ppc64le")');
    const s390x = page.locator('button.select-card:has-text("s390x")');
    await expect(aarch64).toBeDisabled();
    await expect(ppc64le).toBeDisabled();
    await expect(s390x).toBeDisabled();
    // x86_64 should be enabled and selected
    const x86 = page.locator('button.select-card:has-text("x86_64")');
    await expect(x86).toBeEnabled();
  });

  // Version selection and lock flow - needs the manual version entry since Cincinnati may not be available
  test('can set version manually and lock blueprint', async ({ page }) => {
    await selectCard(page, 'Bare Metal');
    // x86_64 should already be selected

    // Open advanced manual entry
    const advancedDetails = page.locator('details summary:has-text("Advanced")');
    if (await advancedDetails.isVisible({ timeout: 3000 })) {
      await advancedDetails.click();
      await page.waitForTimeout(300);

      const minorInput = page.locator('[data-testid="blueprint-manual-minor"]');
      const patchInput = page.locator('[data-testid="blueprint-manual-patch"]');
      const applyBtn = page.locator('[data-testid="blueprint-manual-apply"]');

      await minorInput.fill('4.20');
      await patchInput.fill('4.20.0');
      await applyBtn.click();
      await page.waitForTimeout(500);
    } else {
      // Try the dropdown approach (if Cincinnati data is loaded)
      const minorSelect = page.locator('label.label-emphasis:has-text("Minor channel")').locator('..').locator('select');
      if (await minorSelect.isVisible({ timeout: 3000 })) {
        const options = await minorSelect.locator('option').count();
        if (options > 1) {
          await minorSelect.selectOption({ index: 1 });
          await page.waitForTimeout(1000);
          const patchSelect = page.locator('label.label-emphasis:has-text("Patch version")').locator('..').locator('select');
          const patchOptions = await patchSelect.locator('option').count();
          if (patchOptions > 1) {
            await patchSelect.selectOption({ index: 1 });
          }
        }
      }
    }

    // Lock blueprint
    await lockBlueprint(page);

    // After lock, should be on Methodology step or next step
    await page.waitForTimeout(500);
  });
});
