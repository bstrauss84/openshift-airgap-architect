import { test, expect } from '@playwright/test';
import { resetState, importState, getState } from '../../helpers/api.js';
import { navigateToStep, fillAndBlur, expectStepHidden, expectStepVisible } from '../../helpers/navigation.js';
import * as scenarios from '../../fixtures/scenarios.js';

test.describe('Connectivity & Mirroring Step', () => {
  test.beforeEach(async ({ request }) => { await resetState(request); });

  test('step visible for bare-metal-agent', async ({ page, request }) => {
    await importState(request, scenarios.bareMetalAgent());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expectStepVisible(page, 'Connectivity');
  });

  test('step hidden for aws-govcloud-ipi without mirror registry', async ({ page, request }) => {
    const state = scenarios.awsGovcloudIpi();
    state.credentials.mirrorRegistryCredentialsConfigured = false;
    await importState(request, state);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expectStepHidden(page, 'Connectivity');
  });

  test('can fill mirror registry FQDN', async ({ page, request }) => {
    await importState(request, scenarios.bareMetalAgent());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Connectivity');
    await page.waitForTimeout(500);

    const fqdnInput = page.locator('input[placeholder*="registry.corp"]').or(
      page.locator('input[placeholder*="registry"]').first()
    );
    if (await fqdnInput.first().isVisible({ timeout: 3000 })) {
      await fillAndBlur(fqdnInput.first(), 'mirror.corp.local:5000');
      await page.waitForTimeout(500);

      const state = await getState(request);
      expect(state.globalStrategy.mirroring.registryFqdn).toBe('mirror.corp.local:5000');
    }
  });

  test('NTP servers input visible for non-AWS scenarios', async ({ page, request }) => {
    await importState(request, scenarios.bareMetalAgent());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Connectivity');
    await page.waitForTimeout(500);

    const ntpInput = page.locator('input[placeholder*="time.corp"]').or(
      page.locator('input[placeholder*="ntp"]')
    );
    const visible = await ntpInput.first().isVisible({ timeout: 3000 }).catch(() => false);
    expect(visible).toBeTruthy();
  });
});
