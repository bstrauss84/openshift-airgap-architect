import { test, expect } from '@playwright/test';
import { resetState, importState, getState } from '../../helpers/api.js';
import { startFromLanding, navigateToStep, fillAndBlur } from '../../helpers/navigation.js';
import { bareMetalAgent } from '../../fixtures/scenarios.js';

test.describe('State Persistence', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  test('should persist state across page reload', async ({ page, request }) => {
    const fixture = bareMetalAgent();
    await importState(request, fixture);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Navigate to Identity & Access and fill a field
    await navigateToStep(page, 'Identity');
    await page.waitForTimeout(500);

    const clusterNameInput = page.locator('input[placeholder="agent-cluster"]').or(
      page.locator('input[placeholder*="cluster"]')
    ).first();

    if (await clusterNameInput.isVisible({ timeout: 3000 })) {
      await fillAndBlur(clusterNameInput, 'persistence-test-123');
      await page.waitForTimeout(1000);
    }

    // Reload the page
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Verify state was persisted via API
    const state = await getState(request);
    expect(state.blueprint.clusterName).toBe('persistence-test-123');
  });

  test('should clear state on start-over', async ({ page, request }) => {
    const fixture = bareMetalAgent();
    await importState(request, fixture);

    // Verify state is loaded
    let state = await getState(request);
    expect(state.blueprint.platform).toBe('Bare Metal');
    expect(state.blueprint.confirmed).toBe(true);

    // Reset via API
    await resetState(request);

    // Verify state is cleared — start-over preserves defaults (platform, method)
    // but resets confirmation flags and version selections
    state = await getState(request);
    expect(state.blueprint.confirmed).toBeFalsy();
    expect(state.release.confirmed).toBeFalsy();
    expect(state.version.versionConfirmed).toBeFalsy();
  });
});
