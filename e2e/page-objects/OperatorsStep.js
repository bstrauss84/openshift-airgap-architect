import { expect } from '@playwright/test';

export class OperatorsStep {
  constructor(page) {
    this.page = page;
  }

  // --- Scenario quick picks ---

  scenarioPickBtn(name) {
    return this.page.locator(`button.scenario-pick:has-text("${name}")`);
  }

  async selectScenario(name) {
    await this.scenarioPickBtn(name).click();
    await this.page.waitForTimeout(300);
  }

  async isScenarioSelected(name) {
    const cls = await this.scenarioPickBtn(name).getAttribute('class');
    return cls.includes('selected');
  }

  // --- Clear selections ---

  clearSelectionsBtn() {
    return this.page.locator('button:has-text("Clear selections")');
  }

  async clearAll() {
    await this.clearSelectionsBtn().click();
    await this.page.waitForTimeout(300);
  }

  // --- Selected operator cards ---

  selectedCards() {
    return this.page.locator('.selected-card');
  }

  async selectedCardCount() {
    return this.selectedCards().count();
  }

  removeOperatorBtn(name) {
    return this.page
      .locator(`.selected-card:has-text("${name}") button:has-text("Remove")`);
  }

  // --- Operator catalog tabs ---

  tab(name) {
    return this.page.locator(`.tab:has-text("${name}")`);
  }

  async selectTab(name) {
    await this.tab(name).click();
    await this.page.waitForTimeout(200);
  }

  // --- Available operator cards ---

  operatorCard(name) {
    return this.page.locator(`.operator-card:has-text("${name}")`);
  }

  async addOperator(name) {
    await this.operatorCard(name).click();
    await this.page.waitForTimeout(200);
  }

  // --- Switches ---

  enableDiscoverySwitch() {
    return this.page.locator('button[role="switch"][aria-label="Enable Operator Discovery"]');
  }

  fastModeSwitch() {
    return this.page.locator('button[role="switch"][aria-label="Fast mode"]');
  }

  graphToggle() {
    return this.page.locator(
      'button[role="switch"][aria-label="Include update graph in ImageSetConfiguration"]',
    );
  }

  async toggleDiscovery() {
    await this.enableDiscoverySwitch().click();
  }

  async toggleFastMode() {
    await this.fastModeSwitch().click();
  }

  async toggleGraph() {
    await this.graphToggle().click();
  }

  // --- Scan / Prefetch ---

  scanBtn() {
    return this.page.locator('button:has-text("Scan")').first();
  }

  prefetchBtn() {
    return this.page.locator('button:has-text("Prefetch")');
  }

  // --- Pull secret for operator discovery ---

  pullSecretTextarea() {
    return this.page.locator('textarea[aria-label="Red Hat pull secret JSON for operator discovery"]');
  }

  pullSecretShowBtn() {
    return this.page
      .locator(
        '.pull-secret-section-inline:has(textarea[aria-label="Red Hat pull secret JSON for operator discovery"]) button.pull-secret-toggle:has-text("Show")',
      );
  }

  async fillPullSecret(secret) {
    const showBtn = this.pullSecretShowBtn();
    if (await showBtn.isVisible().catch(() => false)) {
      await showBtn.click();
    }
    const textarea = this.pullSecretTextarea();
    await textarea.fill(secret);
    await textarea.blur();
  }

  // --- Additional images ---

  additionalImagesTextarea() {
    return this.page.locator('textarea[aria-label="Additional images to mirror"]');
  }

  async fillAdditionalImages(images) {
    const textarea = this.additionalImagesTextarea();
    await textarea.fill(images);
    await textarea.blur();
  }

  // --- Archive chunk size ---

  archiveChunkSizeInput() {
    return this.page.locator('input[aria-label="Archive chunk size in GiB"]');
  }

  async fillArchiveChunkSize(size) {
    const input = this.archiveChunkSizeInput();
    await input.fill(String(size));
    await input.blur();
  }

  // --- Heading ---

  heading() {
    return this.page.locator('h2:has-text("Operator Catalog")');
  }
}
