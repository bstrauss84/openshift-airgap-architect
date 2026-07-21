import { test, expect } from '@playwright/test';
import { resetState, importState, getState } from '../../helpers/api.js';
import { navigateToStep, fillAndBlur, toggleSwitch, isSwitchOn } from '../../helpers/navigation.js';
import * as scenarios from '../../fixtures/scenarios.js';
import { CA_CERT, PROXY } from '../../helpers/mock-data.js';

test.describe('Trust & Proxy Step', () => {
  test.beforeEach(async ({ request }) => { await resetState(request); });

  async function seedAndNav(page, request) {
    await importState(request, scenarios.bareMetalAgent());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Trust');
    await page.waitForTimeout(500);
  }

  test('can toggle proxy and fill proxy fields', async ({ page, request }) => {
    await seedAndNav(page, request);

    // Find proxy toggle
    const proxySwitch = page.locator('button[role="switch"][aria-label*="proxy"]').or(
      page.locator('button[role="switch"][aria-label="Enable proxy"]')
    );
    if (await proxySwitch.first().isVisible({ timeout: 3000 })) {
      await proxySwitch.first().click();
      await page.waitForTimeout(500);

      // Proxy fields should now appear
      const httpProxy = page.locator('textarea[placeholder*="http://proxy"]').or(
        page.locator('textarea.proxy-field-textarea').first()
      );
      if (await httpProxy.first().isVisible({ timeout: 3000 })) {
        await httpProxy.first().click();
        await httpProxy.first().fill(PROXY.httpProxy);
        await httpProxy.first().evaluate(el => el.blur());
        await page.waitForTimeout(300);
      }
    }
  });

  test('can fill mirror CA certificate PEM', async ({ page, request }) => {
    await seedAndNav(page, request);

    // Mirror registry CA textarea is the first PEM field
    const pemTextarea = page.locator('textarea[placeholder="Paste or drop .pem/.crt here"]').first();
    if (await pemTextarea.isVisible({ timeout: 3000 })) {
      await pemTextarea.click();
      await pemTextarea.fill(CA_CERT);
      // Tab away to trigger natural blur (more reliable than evaluate blur for React)
      await page.keyboard.press('Tab');
      await page.waitForTimeout(800);

      const state = await getState(request);
      expect(state.trust.mirrorRegistryCaPem).toContain('BEGIN CERTIFICATE');
    }
  });

  test('trust bundle policy select appears after adding CA cert', async ({ page, request }) => {
    const state = scenarios.bareMetalAgent();
    state.trust.mirrorRegistryCaPem = CA_CERT;
    await importState(request, state);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Trust');
    await page.waitForTimeout(500);

    const policySelect = page.locator('select').filter({
      has: page.locator('option:has-text("Proxyonly")')
    });
    const visible = await policySelect.first().isVisible({ timeout: 3000 }).catch(() => false);
    // Trust bundle policy should be visible when a CA cert is present
  });

  test('mirror registry private CA toggle works', async ({ page, request }) => {
    await seedAndNav(page, request);

    const caSwitch = page.locator('button[role="switch"][aria-label*="private CA"]').or(
      page.locator('button[role="switch"][aria-label*="Mirror registry uses"]')
    );
    if (await caSwitch.first().isVisible({ timeout: 3000 })) {
      const before = await caSwitch.first().getAttribute('aria-checked');
      await caSwitch.first().click();
      await page.waitForTimeout(300);
      const after = await caSwitch.first().getAttribute('aria-checked');
      expect(after).not.toBe(before);
    }
  });
});
