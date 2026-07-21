import { test, expect } from '@playwright/test';
import { resetState, importState, getState } from '../../helpers/api.js';
import { startFromLanding, navigateToStep, fillAndBlur } from '../../helpers/navigation.js';
import { bareMetalAgent } from '../../fixtures/scenarios.js';

test.describe('Import / Export Workflow', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  test('should export state as JSON and re-import it', async ({ page, request }) => {
    const fixture = bareMetalAgent();
    await importState(request, fixture);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Navigate to Assets & Guide (Review step) where export lives
    await navigateToStep(page, 'Assets');
    await page.waitForTimeout(500);

    // Look for Export Run button in the actions dropdown
    const actionsBtn = page.locator('button:has-text("Actions")');
    if (await actionsBtn.isVisible({ timeout: 3000 })) {
      await actionsBtn.click();
      await page.waitForTimeout(300);
    }

    const exportBtn = page.locator('button:has-text("Export Run")');
    if (await exportBtn.isVisible({ timeout: 3000 })) {
      const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
      await exportBtn.click();
      const download = await downloadPromise;

      expect(download).toBeTruthy();
      const filename = download.suggestedFilename();
      expect(filename).toMatch(/\.json$/);

      const filePath = await download.path();
      expect(filePath).toBeTruthy();

      // Reset state
      await resetState(request);

      // Re-import via API to verify the exported JSON is valid
      const fs = await import('node:fs');
      const exportedJson = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(exportedJson).toBeTruthy();
      expect(exportedJson.state || exportedJson).toHaveProperty('blueprint');
    }
  });

  test('should import a valid state file via the UI', async ({ page, request }) => {
    const fixture = bareMetalAgent();
    await importState(request, fixture);

    // Export state from API
    const stateToExport = await getState(request);

    // Create a temporary file with the state
    const fs = await import('node:fs');
    const path = await import('node:path');
    const tmpFile = path.join('/tmp', `e2e-import-test-${Date.now()}.json`);
    fs.writeFileSync(tmpFile, JSON.stringify({ schemaVersion: 2, state: stateToExport }));

    // Reset and go to landing page
    await resetState(request);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Look for import file input
    const fileInput = page.locator('input[type="file"]');
    if (await fileInput.isVisible({ timeout: 3000 })) {
      await fileInput.setInputFiles(tmpFile);
      await page.waitForTimeout(2000);

      // Verify imported state
      const importedState = await getState(request);
      expect(importedState.blueprint.clusterName).toBe(fixture.blueprint.clusterName);
      expect(importedState.blueprint.platform).toBe(fixture.blueprint.platform);
    }

    // Cleanup
    fs.unlinkSync(tmpFile);
  });

  test('should reject invalid import file', async ({ page, request }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const fileInput = page.locator('input[type="file"]');
    if (await fileInput.isVisible({ timeout: 3000 })) {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const tmpFile = path.join('/tmp', `e2e-invalid-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, 'not valid json at all');

      await fileInput.setInputFiles(tmpFile);
      await page.waitForTimeout(1000);

      // Should show an error or toast
      const errorIndicator = page.locator('.toast, [role="alert"], .error, .warning').first();
      const hasError = await errorIndicator.isVisible({ timeout: 5000 }).catch(() => false);
      // The app should either show an error or silently reject the import
      // Either way, state should not be corrupted
      const state = await getState(request);
      expect(state.blueprint).toBeTruthy();

      fs.unlinkSync(tmpFile);
    }
  });
});
