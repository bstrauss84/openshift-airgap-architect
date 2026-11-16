/**
 * Wizard navigation and form interaction helpers for E2E tests.
 */

import { expect } from '@playwright/test';
import { LANDING, FOOTER, SIDEBAR, CARDS, MODAL, SECRET_INPUT } from './selectors.js';

/**
 * Navigate to the landing page and wait for it to fully load.
 * @param {import('@playwright/test').Page} page
 */
export async function goToLandingPage(page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
}

/**
 * From the landing page, click the Install card to start the wizard.
 * Handles both "Start new install" and "Continue install" button states.
 * @param {import('@playwright/test').Page} page
 */
export async function startFromLanding(page) {
  await goToLandingPage(page);
  const installCard = page.locator(LANDING.installCard);
  // Handle both "Start new install" and "Continue install" states
  await installCard.waitFor({ state: 'visible', timeout: 10000 });
  await installCard.click();
  // Wait for wizard to load (Blueprint step heading or similar content)
  await page.waitForTimeout(500);
}

/**
 * Select a platform card by its visible text (e.g., "Bare Metal", "VMware vSphere").
 * Waits for the card to appear, clicks it, and asserts the selected class is applied.
 * @param {import('@playwright/test').Page} page
 * @param {string} text — visible text on the card
 */
export async function selectCard(page, text) {
  const card = page.locator(CARDS.card(text));
  await card.waitFor({ state: 'visible', timeout: 5000 });
  await expect(card).toBeEnabled();
  await card.click();
  await expect(card).toHaveClass(/selected/);
}

/**
 * Lock the blueprint: click "Confirm & Proceed" in the footer, then confirm in the modal.
 * Waits for the modal to appear, confirms, and waits for it to disappear.
 * @param {import('@playwright/test').Page} page
 */
export async function lockBlueprint(page) {
  const proceedBtn = page.locator(FOOTER.proceed);
  await proceedBtn.click();

  // Wait for lock modal to appear
  const lockConfirm = page.locator(MODAL.lockConfirm);
  await lockConfirm.waitFor({ state: 'visible', timeout: 5000 });
  await lockConfirm.click();

  // Wait for lock to complete (modal disappears, API call resolves)
  await page.locator(MODAL.backdrop).waitFor({ state: 'hidden', timeout: 15000 });
  await page.waitForTimeout(500);
}

/**
 * Ensure we've entered the wizard (past the landing page).
 * If the landing Install card is visible, click it first.
 */
async function ensureInWizard(page) {
  const installCard = page.locator(LANDING.installCard);
  if (await installCard.isVisible({ timeout: 2000 }).catch(() => false)) {
    await installCard.click();
    await page.waitForTimeout(500);
  }
}

/**
 * Navigate to a wizard step by clicking it in the sidebar.
 * Automatically enters the wizard from the landing page if needed.
 * @param {import('@playwright/test').Page} page
 * @param {string} stepName — the visible step name text
 */
export async function navigateToStep(page, stepName) {
  await ensureInWizard(page);
  const step = page.locator(SIDEBAR.step(stepName));
  await step.waitFor({ state: 'visible', timeout: 5000 });
  await step.click();
  await page.waitForTimeout(300);
}

/**
 * Click the Proceed button in the footer to advance to the next step.
 * @param {import('@playwright/test').Page} page
 */
export async function proceedToNextStep(page) {
  const btn = page.locator(FOOTER.proceed);
  await btn.click();
  await page.waitForTimeout(300);
}

/**
 * Click the Back button in the footer to return to the previous step.
 * @param {import('@playwright/test').Page} page
 */
export async function goBack(page) {
  const btn = page.locator(FOOTER.back);
  await btn.click();
  await page.waitForTimeout(300);
}

/**
 * Fill a text input and blur to trigger onBlur state updates.
 * @param {import('@playwright/test').Locator} locator — the input locator
 * @param {string} value — the value to fill
 */
export async function fillAndBlur(locator, value) {
  await locator.click();
  await locator.fill(value);
  await locator.evaluate((el) => el.blur());
  // Small delay for state update to propagate
  await locator.page().waitForTimeout(200);
}

/**
 * Fill a SecretInput (masked textarea): show it, fill it, then blur.
 * @param {import('@playwright/test').Page} page
 * @param {string} ariaLabel — the aria-label of the textarea
 * @param {string} value — the secret value to enter
 */
export async function fillSecretInput(page, ariaLabel, value) {
  const container = page.locator(
    `${SECRET_INPUT.container}:has(textarea[aria-label="${ariaLabel}"])`
  );
  await container.waitFor({ state: 'visible', timeout: 5000 });

  // Click Show button to unmask
  const showBtn = container.locator(SECRET_INPUT.showToggle);
  const btnText = await showBtn.textContent();
  if (btnText.includes('Show')) {
    await showBtn.click();
    await page.waitForTimeout(200);
  }

  // Fill the textarea
  const textarea = container.locator(`textarea[aria-label="${ariaLabel}"]`);
  await textarea.click();
  await textarea.fill(value);
  await textarea.evaluate((el) => el.blur());
  await page.waitForTimeout(200);
}

/**
 * Toggle a Switch component by its aria-label.
 * @param {import('@playwright/test').Page} page
 * @param {string} ariaLabel — the aria-label of the switch
 */
export async function toggleSwitch(page, ariaLabel) {
  const sw = page.locator(`button[role="switch"][aria-label="${ariaLabel}"]`);
  await sw.waitFor({ state: 'visible', timeout: 5000 });
  await sw.click();
  await page.waitForTimeout(200);
}

/**
 * Check whether a switch is currently on (aria-checked="true").
 * @param {import('@playwright/test').Page} page
 * @param {string} ariaLabel — the aria-label of the switch
 * @returns {Promise<boolean>}
 */
export async function isSwitchOn(page, ariaLabel) {
  const sw = page.locator(`button[role="switch"][aria-label="${ariaLabel}"]`);
  const checked = await sw.getAttribute('aria-checked');
  return checked === 'true';
}

/**
 * Assert that a step is visible in the sidebar.
 * Automatically enters the wizard from the landing page if needed.
 * @param {import('@playwright/test').Page} page
 * @param {string} stepName
 */
export async function expectStepVisible(page, stepName) {
  await ensureInWizard(page);
  await expect(page.locator(SIDEBAR.step(stepName))).toBeVisible({ timeout: 5000 });
}

/**
 * Assert that a step does NOT exist in the sidebar.
 * Automatically enters the wizard from the landing page if needed.
 * @param {import('@playwright/test').Page} page
 * @param {string} stepName
 */
export async function expectStepHidden(page, stepName) {
  await ensureInWizard(page);
  await expect(page.locator(SIDEBAR.step(stepName))).toHaveCount(0, { timeout: 3000 });
}

/**
 * Wait for the app to fully load after a state import.
 * Navigates to the root and waits for network idle.
 * @param {import('@playwright/test').Page} page
 */
export async function waitForAppReady(page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
}
