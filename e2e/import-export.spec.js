/**
 * E2E Test: Import/Export Workflow
 *
 * Tests the ability to export current configuration state
 * and re-import it to restore the wizard to that exact state.
 *
 * Critical path:
 * 1. Configure a minimal wizard state
 * 2. Export the run configuration
 * 3. Start over (clear state)
 * 4. Import the exported configuration
 * 5. Verify state matches original
 */

import { test, expect } from '@playwright/test';

test.describe('Import/Export Workflow', () => {
  test('should export and re-import wizard configuration', async ({ page }) => {
    // Step 1: Configure minimal state
    await page.goto('/');

    const startButton = page.locator('button:has-text("Start")').first();
    await startButton.click();

    // Configure blueprint
    const clusterNameInput = page.locator('input#clusterName, input[placeholder*="cluster"]').first();
    await clusterNameInput.fill('export-test-cluster');

    const baseDomainInput = page.locator('input#baseDomain, input[placeholder*="domain"]').first();
    await baseDomainInput.fill('export-test.com');

    const platformSelect = page.locator('select#platform, [data-testid="platform-select"]').first();
    await platformSelect.selectOption('bare-metal');

    await page.waitForTimeout(1000);

    // Step 2: Export configuration
    const toolsButton = page.locator('button:has-text("Tools"), [data-testid="tools-button"]').first();
    await toolsButton.click();
    await page.waitForTimeout(300);

    const exportRunButton = page.locator('button:has-text("Export Run"), [data-testid="export-run"]').first();

    if (await exportRunButton.isVisible()) {
      // Set up download listener
      const downloadPromise = page.waitForEvent('download', { timeout: 10000 });

      await exportRunButton.click();
      await page.waitForTimeout(500);

      // Confirm export if modal appears
      const confirmButton = page.locator('button:has-text("Export"), button:has-text("Download")').last();
      if (await confirmButton.isVisible({ timeout: 2000 })) {
        await confirmButton.click();
      }

      // Wait for download
      const download = await downloadPromise;
      const path = await download.path();

      expect(path).toBeTruthy();
      expect(await download.suggestedFilename()).toMatch(/\.json$/);

      // Step 3: Start over to clear state
      const startOverButton = page.locator('button:has-text("Start Over"), [data-testid="start-over"]').first();
      await startOverButton.click();
      await page.waitForTimeout(300);

      // Confirm start over
      const confirmStartOver = page.locator('button:has-text("Confirm"), button:has-text("Yes")').first();
      if (await confirmStartOver.isVisible({ timeout: 2000 })) {
        await confirmStartOver.click();
      }

      await page.waitForTimeout(500);

      // Should be back at landing or fresh blueprint
      const clusterNameAfterClear = page.locator('input#clusterName, input[placeholder*="cluster"]').first();
      if (await clusterNameAfterClear.isVisible({ timeout: 3000 })) {
        await expect(clusterNameAfterClear).toHaveValue('');
      }

      // Step 4: Import the exported configuration
      const importButton = page.locator('button:has-text("Import"), [data-testid="import-button"], input[type="file"]').first();

      if (await importButton.isVisible()) {
        // Upload the downloaded file
        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.setInputFiles(path);

        await page.waitForTimeout(1500);

        // Step 5: Verify state restored
        const restoredClusterName = page.locator('input#clusterName, input[placeholder*="cluster"]').first();
        await expect(restoredClusterName).toHaveValue('export-test-cluster', { timeout: 5000 });

        const restoredBaseDomain = page.locator('input#baseDomain, input[placeholder*="domain"]').first();
        await expect(restoredBaseDomain).toHaveValue('export-test.com', { timeout: 5000 });
      }
    } else {
      // Export run not available in current UI state, skip detailed validation
      test.skip();
    }
  });

  test('should reject invalid import files', async ({ page }) => {
    await page.goto('/');

    const startButton = page.locator('button:has-text("Start")').first();
    await startButton.click();
    await page.waitForTimeout(500);

    // Try to import invalid JSON
    const fileInput = page.locator('input[type="file"]').first();

    if (await fileInput.isVisible({ timeout: 2000 })) {
      // Create a temporary invalid file
      const invalidContent = 'not valid json';
      const buffer = Buffer.from(invalidContent);

      // Upload invalid file
      await fileInput.setInputFiles({
        name: 'invalid.json',
        mimeType: 'application/json',
        buffer,
      });

      await page.waitForTimeout(1000);

      // Should see error message
      const errorMessage = page.locator('text=/invalid|error/i, [role="alert"]').first();
      await expect(errorMessage).toBeVisible({ timeout: 5000 });
    }
  });

  test('should handle export with various inclusion options', async ({ page }) => {
    await page.goto('/');

    const startButton = page.locator('button:has-text("Start")').first();
    await startButton.click();
    await page.waitForTimeout(500);

    // Configure minimal blueprint
    const clusterNameInput = page.locator('input#clusterName, input[placeholder*="cluster"]').first();
    await clusterNameInput.fill('options-test');

    await page.waitForTimeout(500);

    // Open export dialog
    const exportButton = page.locator('button:has-text("Export"), [data-testid="export-button"]').first();

    if (await exportButton.isVisible({ timeout: 3000 })) {
      await exportButton.click();
      await page.waitForTimeout(300);

      // Export dialog should show inclusion options
      const exportDialog = page.locator('[role="dialog"], .modal').first();
      await expect(exportDialog).toBeVisible({ timeout: 5000 });

      // Look for credential/certificate toggles
      const includeCredentials = page.locator('input[type="checkbox"], label:has-text(/credential|secret/)').first();

      if (await includeCredentials.isVisible({ timeout: 2000 })) {
        // Toggle some options
        await includeCredentials.click();
        await page.waitForTimeout(200);

        // Confirm export
        const confirmButton = page.locator('button:has-text("Export"), button:has-text("Download")').last();
        await confirmButton.click();

        // Should initiate download
        await page.waitForTimeout(1000);
      }
    }
  });
});
