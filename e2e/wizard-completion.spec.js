/**
 * E2E Test: Wizard Completion Workflow
 *
 * Tests the complete user journey from blueprint configuration
 * through asset generation to export bundle creation.
 *
 * Critical path:
 * 1. Land on app, see landing page
 * 2. Configure blueprint (platform, method, version)
 * 3. Navigate through required steps
 * 4. Generate YAML assets
 * 5. Create export bundle
 */

import { test, expect } from '@playwright/test';

test.describe('Wizard Completion Workflow', () => {
  test('should complete bare-metal IPI wizard flow end-to-end', async ({ page }) => {
    // Step 1: Navigate to app
    await page.goto('/');

    // Should see landing page
    await expect(page.locator('h1')).toContainText('OpenShift Airgap Architect');

    // Click "Start Planning" or similar button to begin
    const startButton = page.locator('button:has-text("Start")').first();
    await startButton.click();

    // Step 2: Configure Blueprint
    await expect(page.locator('h2')).toContainText('Blueprint');

    // Select platform
    const platformSelect = page.locator('select#platform, [data-testid="platform-select"]').first();
    await platformSelect.selectOption('bare-metal');

    // Select install method
    const methodSelect = page.locator('select#method, select:has(option:has-text("IPI"))').first();
    await methodSelect.selectOption({ label: /IPI/ });

    // Select OpenShift version
    const versionSelect = page.locator('select#version, select:has(option:has-text("4.20"))').first();
    await versionSelect.selectOption({ label: /4\.20/ });

    // Enter cluster name
    const clusterNameInput = page.locator('input#clusterName, input[placeholder*="cluster"]').first();
    await clusterNameInput.fill('test-cluster');

    // Enter base domain
    const baseDomainInput = page.locator('input#baseDomain, input[placeholder*="domain"]').first();
    await baseDomainInput.fill('example.com');

    // Lock blueprint
    const lockButton = page.locator('button:has-text("Lock")').first();
    await lockButton.click();

    // Wait for navigation or confirmation
    await page.waitForTimeout(500);

    // Step 3: Navigate through wizard steps
    // Identity & Access step
    const identityTab = page.locator('[data-testid="tab-identity"], button:has-text("Identity")').first();
    if (await identityTab.isVisible()) {
      await identityTab.click();
      await page.waitForTimeout(300);

      // Enter pull secret (mock data)
      const pullSecretInput = page.locator('textarea#pullSecret, textarea[placeholder*="pull"]').first();
      if (await pullSecretInput.isVisible()) {
        await pullSecretInput.fill('{"auths":{"registry.redhat.io":{"auth":"dGVzdDp0ZXN0"}}}');
      }
    }

    // Networking step
    const networkingTab = page.locator('[data-testid="tab-networking"], button:has-text("Network")').first();
    if (await networkingTab.isVisible()) {
      await networkingTab.click();
      await page.waitForTimeout(300);

      // Enter machine network CIDR
      const machineNetworkInput = page.locator('input#machineNetworkCidr, input[placeholder*="10.0"]').first();
      if (await machineNetworkInput.isVisible()) {
        await machineNetworkInput.fill('10.90.0.0/24');
      }
    }

    // Step 4: Navigate to Assets & Guide step
    const assetsTab = page.locator('[data-testid="tab-assets"], button:has-text("Assets")').first();
    await assetsTab.click();
    await page.waitForTimeout(500);

    // Should see Assets & Guide page
    await expect(page.locator('h2')).toContainText(/Assets|Guide/);

    // Step 5: Generate assets
    const generateButton = page.locator('button:has-text("Generate")').first();
    if (await generateButton.isVisible()) {
      await generateButton.click();

      // Wait for generation to complete
      await page.waitForTimeout(2000);

      // Should see success indicator or download buttons
      const downloadButtons = page.locator('button:has-text("Download")');
      await expect(downloadButtons.first()).toBeVisible({ timeout: 10000 });
    }

    // Step 6: Create export bundle
    const exportButton = page.locator('button:has-text("Export"), [data-testid="export-button"]').first();
    if (await exportButton.isVisible()) {
      await exportButton.click();
      await page.waitForTimeout(500);

      // Export modal/dialog should appear
      const exportDialog = page.locator('[role="dialog"], .modal').first();
      await expect(exportDialog).toBeVisible({ timeout: 5000 });

      // Confirm export
      const confirmButton = page.locator('button:has-text("Export"), button:has-text("Download")').last();
      await confirmButton.click();

      // Wait for export to prepare
      await page.waitForTimeout(2000);
    }

    // Workflow complete - verify we can navigate back
    const blueprintTab = page.locator('[data-testid="tab-blueprint"], button:has-text("Blueprint")').first();
    await blueprintTab.click();
    await page.waitForTimeout(300);

    // Should see locked blueprint
    await expect(page.locator('text=/locked|configured/i')).toBeVisible({ timeout: 5000 });
  });

  test('should show validation errors for incomplete configuration', async ({ page }) => {
    await page.goto('/');

    // Start wizard
    const startButton = page.locator('button:has-text("Start")').first();
    await startButton.click();

    // Try to lock blueprint without required fields
    const lockButton = page.locator('button:has-text("Lock")').first();

    if (await lockButton.isVisible() && await lockButton.isEnabled()) {
      await lockButton.click();
      await page.waitForTimeout(500);

      // Should see validation errors
      const errorMessages = page.locator('.error, .warning, [role="alert"]');
      const errorCount = await errorMessages.count();

      // Expect at least one validation message
      expect(errorCount).toBeGreaterThan(0);
    }
  });

  test('should persist state across page reload', async ({ page }) => {
    await page.goto('/');

    // Start and configure blueprint
    const startButton = page.locator('button:has-text("Start")').first();
    await startButton.click();

    const clusterNameInput = page.locator('input#clusterName, input[placeholder*="cluster"]').first();
    await clusterNameInput.fill('persistence-test');

    await page.waitForTimeout(500);

    // Reload page
    await page.reload();
    await page.waitForTimeout(1000);

    // State should be restored
    const restoredInput = page.locator('input#clusterName, input[placeholder*="cluster"]').first();
    await expect(restoredInput).toHaveValue('persistence-test', { timeout: 5000 });
  });
});
