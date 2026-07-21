import { expect } from '@playwright/test';

export class MethodologyStep {
  constructor(page) {
    this.page = page;
  }

  methodCard(name) {
    return this.page.locator(`button.select-card:has-text("${name}")`);
  }

  async selectMethod(name) {
    await this.methodCard(name).click();
    await expect(this.methodCard(name)).toHaveClass(/selected/);
  }

  async isMethodSelected(name) {
    const cls = await this.methodCard(name).getAttribute('class');
    return cls.includes('selected');
  }

  async isMethodDisabled(name) {
    const card = this.methodCard(name);
    const disabled = await card.getAttribute('disabled');
    const ariaDisabled = await card.getAttribute('aria-disabled');
    return disabled !== null || ariaDisabled === 'true';
  }

  heading() {
    return this.page.locator('h2:has-text("Installation Methodology")');
  }

  recommendedBadge() {
    return this.page.locator('.badge:has-text("Recommended")');
  }

  reEvaluateBtn() {
    return this.page.locator('button:has-text("Re-evaluate this page")');
  }
}
