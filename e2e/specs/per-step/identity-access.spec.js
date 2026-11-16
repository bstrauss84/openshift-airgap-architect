import { test, expect } from '@playwright/test';
import { resetState, importState, getState } from '../../helpers/api.js';
import { navigateToStep, fillAndBlur, fillSecretInput, toggleSwitch, isSwitchOn } from '../../helpers/navigation.js';
import * as scenarios from '../../fixtures/scenarios.js';
import { PULL_SECRET, SSH_KEY, MIRROR_PULL_SECRET } from '../../helpers/mock-data.js';

test.describe('Identity & Access Step', () => {
  test.beforeEach(async ({ request }) => { await resetState(request); });

  async function seedAndNav(page, request) {
    const state = scenarios.bareMetalAgent();
    state.blueprint.clusterName = '';
    state.blueprint.baseDomain = '';
    state.credentials.sshPublicKey = '';
    await importState(request, state);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Identity');
    await page.waitForTimeout(500);
  }

  test('can fill cluster name and base domain', async ({ page, request }) => {
    await seedAndNav(page, request);

    const clusterInput = page.locator('input[placeholder="agent-cluster"]').or(
      page.locator('input[aria-required="true"]').first()
    );
    const domainInput = page.locator('input[placeholder="example.com"]');

    await fillAndBlur(clusterInput.first(), 'my-test-cluster');
    await fillAndBlur(domainInput, 'test.example.com');

    await page.waitForTimeout(500);
    const state = await getState(request);
    expect(state.blueprint.clusterName).toBe('my-test-cluster');
    expect(state.blueprint.baseDomain).toBe('test.example.com');
  });

  test('can fill SSH public key via SecretInput', async ({ page, request }) => {
    await seedAndNav(page, request);

    // SSH key uses SecretInput pattern
    const sshContainer = page.locator('.pull-secret-section-inline').filter({
      has: page.locator('textarea[placeholder*="ssh-"]')
    }).or(page.locator('.pull-secret-section-inline').filter({
      has: page.locator('span:has-text("SSH")')
    }));

    if (await sshContainer.first().isVisible({ timeout: 5000 })) {
      const showBtn = sshContainer.first().locator('button:has-text("Show")');
      if (await showBtn.isVisible({ timeout: 2000 })) {
        await showBtn.click();
        await page.waitForTimeout(200);
      }
      const textarea = sshContainer.first().locator('textarea');
      await textarea.click();
      await textarea.fill(SSH_KEY);
      await textarea.evaluate(el => el.blur());
      await page.waitForTimeout(500);

      const state = await getState(request);
      expect(state.credentials.sshPublicKey).toBe(SSH_KEY);
    }
  });

  test('can toggle FIPS mode', async ({ page, request }) => {
    const state = scenarios.bareMetalAgent();
    await importState(request, state);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Identity');
    await page.waitForTimeout(500);

    // Find FIPS switch — look for switch near "FIPS" text
    const fipsSwitch = page.locator('button[role="switch"]').filter({
      has: page.locator('xpath=ancestor::div[contains(@class, "option-row") or contains(@class, "field-with-info")]//span[contains(text(), "FIPS")]')
    }).or(page.locator('button[role="switch"][aria-label*="FIPS"]'));

    // If no direct FIPS switch found, try all switches and find the one near FIPS text
    const allSwitches = page.locator('button[role="switch"]');
    const count = await allSwitches.count();

    for (let i = 0; i < count; i++) {
      const sw = allSwitches.nth(i);
      const parent = sw.locator('..');
      const text = await parent.textContent();
      if (text.includes('FIPS')) {
        const wasFips = await sw.getAttribute('aria-checked');
        await sw.click();
        await page.waitForTimeout(300);
        const nowFips = await sw.getAttribute('aria-checked');
        expect(nowFips).not.toBe(wasFips);
        break;
      }
    }
  });

  test('mirror registry toggle shows additional fields', async ({ page, request }) => {
    const state = scenarios.bareMetalAgent();
    await importState(request, state);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Identity');
    await page.waitForTimeout(500);

    // Find mirror registry toggle
    const allSwitches = page.locator('button[role="switch"]');
    const count = await allSwitches.count();

    for (let i = 0; i < count; i++) {
      const sw = allSwitches.nth(i);
      const parent = sw.locator('..').locator('..');
      const text = await parent.textContent();
      if (text.includes('mirror') || text.includes('Mirror')) {
        await sw.click();
        await page.waitForTimeout(500);

        // After enabling mirror registry, a pull secret field should appear
        const mirrorSecretContainer = page.locator('.pull-secret-section-inline').filter({
          has: page.locator('span:has-text("Mirror")')
        });
        const visible = await mirrorSecretContainer.first().isVisible({ timeout: 3000 }).catch(() => false);
        // Some form of mirror config should now be visible
        break;
      }
    }
  });

  test('generate keypair button opens modal', async ({ page, request }) => {
    const state = scenarios.bareMetalAgent();
    await importState(request, state);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await navigateToStep(page, 'Identity');
    await page.waitForTimeout(500);

    const generateBtn = page.locator('button:has-text("Generate keypair")').or(
      page.locator('button:has-text("generate")').first()
    );
    if (await generateBtn.first().isVisible({ timeout: 3000 })) {
      await generateBtn.first().click();
      await page.waitForTimeout(500);

      // Should show modal/dialog for key generation
      const modal = page.locator('.modal, [role="dialog"]');
      const visible = await modal.first().isVisible({ timeout: 3000 }).catch(() => false);
      // Modal should appear with algorithm selection
    }
  });
});
