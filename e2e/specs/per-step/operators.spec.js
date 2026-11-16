import { test, expect } from '@playwright/test';
import { resetState, importState, getState } from '../../helpers/api.js';
import { navigateToStep } from '../../helpers/navigation.js';
import * as scenarios from '../../fixtures/scenarios.js';

test.describe('Operators Step', () => {
  test.beforeEach(async ({ request }) => { await resetState(request); });

  async function seedAndNav(page, request) {
    await importState(request, scenarios.bareMetalAgent());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Operators');
    await page.waitForTimeout(500);
  }

  test('operator step loads and shows heading and imageset options', async ({ page, request }) => {
    await seedAndNav(page, request);

    // Operator step heading should be visible
    const heading = page.locator('h2:has-text("Operator Catalog Strategy")');
    await expect(heading).toBeVisible({ timeout: 5000 });

    // ImageSet options section uses CollapsibleSection (button, not summary)
    const imagesetSection = page.locator('button[aria-expanded]:has-text("ImageSet options")');
    await expect(imagesetSection).toBeVisible({ timeout: 5000 });
  });

  test('can expand operator catalog selection', async ({ page, request }) => {
    await seedAndNav(page, request);

    const catalogDetails = page.locator('details summary:has-text("Operator Catalog Selection")');
    if (await catalogDetails.isVisible({ timeout: 3000 })) {
      await catalogDetails.click();
      await page.waitForTimeout(500);

      // After expanding, catalog content should be visible
      const catalogContent = page.locator('details:has(summary:has-text("Operator Catalog Selection"))');
      const open = await catalogContent.getAttribute('open');
      expect(open).not.toBeNull();
    }
  });

  test('imageset config options are accessible', async ({ page, request }) => {
    await seedAndNav(page, request);

    // Graph toggle
    const graphToggle = page.locator('button[role="switch"][aria-label*="graph"]').or(
      page.locator('button[role="switch"][aria-label*="update graph"]')
    );
    if (await graphToggle.first().isVisible({ timeout: 3000 })) {
      const before = await graphToggle.first().getAttribute('aria-checked');
      await graphToggle.first().click();
      await page.waitForTimeout(300);
      const after = await graphToggle.first().getAttribute('aria-checked');
      expect(after).not.toBe(before);
    }

    // Additional images textarea
    const additionalImages = page.locator('textarea[aria-label*="Additional images"]');
    if (await additionalImages.isVisible({ timeout: 3000 })) {
      await additionalImages.click();
      await additionalImages.fill('quay.io/test/image:v1.0');
      await additionalImages.evaluate(el => el.blur());
      await page.waitForTimeout(300);
    }
  });
});
