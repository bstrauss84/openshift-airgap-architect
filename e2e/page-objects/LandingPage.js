import { expect } from '@playwright/test';

export class LandingPage {
  constructor(page) {
    this.page = page;
  }

  installCard() {
    return this.page.locator('button.landing-card-install');
  }

  upgradeCard() {
    return this.page.locator('button.landing-card-upgrade');
  }

  operatorCard() {
    return this.page.locator('button.landing-card-operator');
  }

  heading() {
    return this.page.locator('h1');
  }

  async clickInstall() {
    await this.installCard().click();
    await this.page.waitForTimeout(500);
  }

  async expectVisible() {
    await expect(this.heading()).toContainText('What would you like to do?');
  }
}
