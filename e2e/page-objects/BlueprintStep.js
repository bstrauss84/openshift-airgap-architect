import { expect } from '@playwright/test';

export class BlueprintStep {
  constructor(page) {
    this.page = page;
  }

  // --- Platform cards ---

  platformCard(name) {
    return this.page.locator(`button.select-card:has-text("${name}")`);
  }

  async selectPlatform(name) {
    await this.platformCard(name).click();
    await expect(this.platformCard(name)).toHaveClass(/selected/);
  }

  async isPlatformSelected(name) {
    const cls = await this.platformCard(name).getAttribute('class');
    return cls.includes('selected');
  }

  // --- Architecture cards ---

  archCard(name) {
    return this.page.locator(`button.select-card:has-text("${name}")`);
  }

  async selectArch(name) {
    await this.archCard(name).click();
    await expect(this.archCard(name)).toHaveClass(/selected/);
  }

  async isArchDisabled(name) {
    const disabled = await this.archCard(name).getAttribute('disabled');
    return disabled !== null;
  }

  // --- Version selects ---

  minorChannelSelect() {
    return this.page
      .locator('label.label-emphasis:has-text("Minor channel")')
      .locator('..')
      .locator('select');
  }

  patchVersionSelect() {
    return this.page
      .locator('label.label-emphasis:has-text("Patch version")')
      .locator('..')
      .locator('select');
  }

  async selectMinorChannel(value) {
    await this.minorChannelSelect().selectOption(value);
  }

  async selectPatchVersion(value) {
    await this.patchVersionSelect().selectOption(value);
  }

  async waitForPatchesLoaded() {
    const select = this.patchVersionSelect();
    await this.page.waitForFunction(
      (sel) => {
        const el = document.querySelector(sel);
        return el && el.options.length > 1;
      },
      'label.label-emphasis:has-text("Patch version") + select, label.label-emphasis + * select',
      { timeout: 15000 },
    );
    // Fallback: poll the locator directly
    await expect(select).not.toBeEmpty({ timeout: 15000 });
  }

  // --- Pull secret (SecretInput) ---

  pullSecretTextarea() {
    return this.page.locator('textarea[aria-label="Red Hat pull secret JSON"]');
  }

  pullSecretShowBtn() {
    return this.page
      .locator('.pull-secret-section-inline')
      .locator('button.pull-secret-toggle:has-text("Show")')
      .first();
  }

  async fillPullSecret(secret) {
    // SecretInput is masked by default; click Show first
    const showBtn = this.pullSecretShowBtn();
    if (await showBtn.isVisible()) {
      await showBtn.click();
    }
    const textarea = this.pullSecretTextarea();
    await textarea.fill(secret);
    await textarea.blur();
  }

  // --- Advanced manual entry ---

  advancedSummary() {
    return this.page.locator('summary:has-text("Advanced")');
  }

  manualMinorInput() {
    return this.page.locator('[data-testid="blueprint-manual-minor"]');
  }

  manualPatchInput() {
    return this.page.locator('[data-testid="blueprint-manual-patch"]');
  }

  manualApplyBtn() {
    return this.page.locator('[data-testid="blueprint-manual-apply"]');
  }

  async openAdvanced() {
    await this.advancedSummary().click();
  }

  async setManualVersion(minor, patch) {
    await this.openAdvanced();
    await this.manualMinorInput().fill(minor);
    await this.manualPatchInput().fill(patch);
    await this.manualApplyBtn().click();
  }

  // --- Retain pull secret checkbox ---

  retainPullSecretCheckbox() {
    return this.page.locator('input[type="checkbox"][aria-describedby="retain-pull-secret-desc"]');
  }
}
