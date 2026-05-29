/**
 * E2E Test: Operations and Background Jobs
 *
 * Tests the Operations tab functionality including:
 * - Cincinnati refresh job tracking
 * - Job history display
 * - Job log viewing and downloading
 * - Job status updates
 *
 * Critical path:
 * 1. Navigate to Operations tab
 * 2. Verify job history is visible
 * 3. Trigger Cincinnati refresh
 * 4. Monitor job status
 * 5. View job logs
 */

import { test, expect } from '@playwright/test';

test.describe('Operations and Background Jobs', () => {
  test('should display operations tab and job history', async ({ page }) => {
    await page.goto('/');

    // Navigate to Operations tab (available pre-lock)
    const operationsTab = page.locator('[data-testid="tab-operations"], button:has-text("Operations")').first();
    await operationsTab.click();
    await page.waitForTimeout(500);

    // Should see Operations heading
    await expect(page.locator('h2, h3')).toContainText(/Operations|Jobs/);

    // Should see job history section or empty state
    const jobList = page.locator('[data-testid="job-list"], .job-list, table').first();
    const emptyState = page.locator('text=/no jobs|empty/i').first();

    // Either jobs exist or empty state is shown
    const hasJobs = await jobList.isVisible({ timeout: 2000 });
    const isEmpty = await emptyState.isVisible({ timeout: 2000 });

    expect(hasJobs || isEmpty).toBeTruthy();
  });

  test('should trigger and track Cincinnati refresh job', async ({ page }) => {
    await page.goto('/');

    // Start wizard to get to Blueprint
    const startButton = page.locator('button:has-text("Start")').first();
    if (await startButton.isVisible({ timeout: 2000 })) {
      await startButton.click();
      await page.waitForTimeout(500);
    }

    // Look for Cincinnati update/refresh button
    const updateButton = page.locator('button:has-text("Update"), button:has-text("Refresh")').first();

    if (await updateButton.isVisible({ timeout: 3000 })) {
      // Click update to trigger Cincinnati refresh job
      await updateButton.click();
      await page.waitForTimeout(1000);

      // Navigate to Operations tab
      const operationsTab = page.locator('[data-testid="tab-operations"], button:has-text("Operations")').first();
      await operationsTab.click();
      await page.waitForTimeout(500);

      // Should see Cincinnati refresh job in history
      const cincinnatiJob = page.locator('text=/cincinnati.*refresh/i, td:has-text("cincinnati")').first();
      await expect(cincinnatiJob).toBeVisible({ timeout: 10000 });

      // Job should have a status (running, completed, failed)
      const jobStatus = page.locator('text=/running|completed|failed/i').first();
      await expect(jobStatus).toBeVisible({ timeout: 5000 });
    }
  });

  test('should display job output and allow log download', async ({ page }) => {
    await page.goto('/');

    // Navigate to Operations
    const operationsTab = page.locator('[data-testid="tab-operations"], button:has-text("Operations")').first();
    await operationsTab.click();
    await page.waitForTimeout(500);

    // Check if any jobs exist
    const firstJob = page.locator('[data-testid="job-row"], tr').nth(1);

    if (await firstJob.isVisible({ timeout: 2000 })) {
      // Click to expand/view job details
      await firstJob.click();
      await page.waitForTimeout(300);

      // Should see job output or logs
      const jobOutput = page.locator('[data-testid="job-output"], pre, .log-output').first();

      if (await jobOutput.isVisible({ timeout: 3000 })) {
        // Verify output contains some text
        const outputText = await jobOutput.textContent();
        expect(outputText).toBeTruthy();
        expect(outputText.length).toBeGreaterThan(0);
      }

      // Look for download logs button
      const downloadButton = page.locator('button:has-text("Download Logs"), button:has-text("Download")').first();

      if (await downloadButton.isVisible({ timeout: 2000 })) {
        const downloadPromise = page.waitForEvent('download', { timeout: 5000 });
        await downloadButton.click();

        const download = await downloadPromise;
        const filename = await download.suggestedFilename();

        // Filename should include job type and timestamp
        expect(filename).toMatch(/\.(txt|log)$/);
        expect(filename).toMatch(/\d{4}-\d{2}-\d{2}/); // Date format
      }
    }
  });

  test('should allow clearing completed jobs', async ({ page }) => {
    await page.goto('/');

    // Navigate to Operations
    const operationsTab = page.locator('[data-testid="tab-operations"], button:has-text("Operations")').first();
    await operationsTab.click();
    await page.waitForTimeout(500);

    // Look for "Clear Completed" or similar button
    const clearButton = page.locator('button:has-text("Clear"), button:has-text("Delete Completed")').first();

    if (await clearButton.isVisible({ timeout: 2000 })) {
      // Count jobs before clearing
      const jobsBefore = await page.locator('[data-testid="job-row"], tr').count();

      await clearButton.click();
      await page.waitForTimeout(500);

      // Confirm if modal appears
      const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Yes")').first();
      if (await confirmButton.isVisible({ timeout: 2000 })) {
        await confirmButton.click();
        await page.waitForTimeout(500);
      }

      // Jobs should be cleared (count reduced or empty state shown)
      const jobsAfter = await page.locator('[data-testid="job-row"], tr').count();
      const emptyState = page.locator('text=/no jobs|empty/i').first();

      const isCleared = jobsAfter < jobsBefore || await emptyState.isVisible({ timeout: 2000 });
      expect(isCleared).toBeTruthy();
    }
  });

  test('should show job status updates in real-time', async ({ page }) => {
    await page.goto('/');

    // Trigger a background job (Cincinnati refresh)
    const startButton = page.locator('button:has-text("Start")').first();
    if (await startButton.isVisible({ timeout: 2000 })) {
      await startButton.click();
      await page.waitForTimeout(500);
    }

    const updateButton = page.locator('button:has-text("Update"), button:has-text("Refresh")').first();

    if (await updateButton.isVisible({ timeout: 3000 })) {
      await updateButton.click();

      // Navigate to Operations immediately
      const operationsTab = page.locator('[data-testid="tab-operations"], button:has-text("Operations")').first();
      await operationsTab.click();
      await page.waitForTimeout(500);

      // Find the most recent job
      const latestJob = page.locator('[data-testid="job-row"], tr').first();

      if (await latestJob.isVisible({ timeout: 2000 })) {
        // Should show "running" status initially
        const runningStatus = page.locator('text=/running/i').first();
        const hasRunningStatus = await runningStatus.isVisible({ timeout: 3000 });

        if (hasRunningStatus) {
          // Wait for status to change to completed/failed
          await page.waitForTimeout(5000);

          const finalStatus = page.locator('text=/completed|failed/i').first();
          await expect(finalStatus).toBeVisible({ timeout: 15000 });
        }
      }
    }
  });

  test('should handle job errors gracefully', async ({ page }) => {
    await page.goto('/');

    const operationsTab = page.locator('[data-testid="tab-operations"], button:has-text("Operations")').first();
    await operationsTab.click();
    await page.waitForTimeout(500);

    // Look for any failed jobs in history
    const failedJob = page.locator('text=/failed/i, .error, .job-failed').first();

    if (await failedJob.isVisible({ timeout: 2000 })) {
      // Click to view details
      await failedJob.click();
      await page.waitForTimeout(300);

      // Should show error message or stack trace
      const errorOutput = page.locator('[data-testid="job-output"], pre, .error-message').first();
      await expect(errorOutput).toBeVisible({ timeout: 3000 });

      const errorText = await errorOutput.textContent();
      expect(errorText).toBeTruthy();
    }
  });
});
