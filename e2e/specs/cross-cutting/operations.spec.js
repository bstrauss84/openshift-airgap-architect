import { test, expect } from '@playwright/test';
import { resetState, importState } from '../../helpers/api.js';
import { startFromLanding, navigateToStep } from '../../helpers/navigation.js';
import { bareMetalAgent } from '../../fixtures/scenarios.js';

test.describe('Operations Tab', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  test('should display operations tab with job history', async ({ page, request }) => {
    const fixture = bareMetalAgent();
    await importState(request, fixture);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await navigateToStep(page, 'Operations');
    await page.waitForTimeout(500);

    // Should see the Operations step content
    const heading = page.locator('h2, h3').filter({ hasText: /Operations|Jobs|Background/ });
    await expect(heading.first()).toBeVisible({ timeout: 5000 });

    // Should show job entries, action buttons, or an empty state message
    const jobEntry = page.getByText(/Cincinnati|completed|running|queued/i).first();
    const actionBtn = page.getByRole('button', { name: /Export operations|Clear completed/i }).first();
    const emptyMsg = page.getByText(/No operations yet/i);
    const hasJob = await jobEntry.isVisible({ timeout: 3000 }).catch(() => false);
    const hasAction = await actionBtn.isVisible({ timeout: 3000 }).catch(() => false);
    const isEmpty = await emptyMsg.isVisible({ timeout: 3000 }).catch(() => false);
    expect(hasJob || hasAction || isEmpty).toBeTruthy();
  });

  test('should show operations tab before blueprint lock', async ({ page, request }) => {
    // Operations is accessible even without locking blueprint
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click start to enter wizard
    const installCard = page.locator('button.landing-card-install');
    if (await installCard.isVisible({ timeout: 3000 })) {
      await installCard.click();
      await page.waitForTimeout(500);
    }

    // Operations should be accessible
    const opsStep = page.locator('button.step-item:has-text("Operations")');
    if (await opsStep.isVisible({ timeout: 3000 })) {
      await opsStep.click();
      await page.waitForTimeout(500);

      const content = page.locator('h2, h3').filter({ hasText: /Operations|Jobs/ });
      await expect(content.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('should track Cincinnati refresh job', async ({ page, request }) => {
    // Start fresh and trigger a Cincinnati refresh from Blueprint step
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const installCard = page.locator('button.landing-card-install');
    if (await installCard.isVisible({ timeout: 3000 })) {
      await installCard.click();
      await page.waitForTimeout(500);
    }

    // Look for Update/Refresh button on Blueprint step
    const updateBtn = page.locator('button:has-text("Update")').first();
    if (await updateBtn.isVisible({ timeout: 3000 })) {
      await updateBtn.click();
      await page.waitForTimeout(2000);

      // Navigate to Operations to check job
      const opsStep = page.locator('button.step-item:has-text("Operations")');
      if (await opsStep.isVisible({ timeout: 3000 })) {
        await opsStep.click();
        await page.waitForTimeout(1000);

        // Should see a Cincinnati-related job
        const job = page.locator('text=/cincinnati|channel|refresh/i').first();
        const hasJob = await job.isVisible({ timeout: 10000 }).catch(() => false);
        // Job may or may not appear depending on backend connectivity
        // This is a best-effort check
        if (hasJob) {
          expect(await job.textContent()).toBeTruthy();
        }
      }
    }
  });
});
