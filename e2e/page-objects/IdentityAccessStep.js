import { expect } from '@playwright/test';

export class IdentityAccessStep {
  constructor(page) {
    this.page = page;
  }

  // --- Cluster Name ---

  clusterNameInput() {
    return this.page.locator('input[placeholder="agent-cluster"]');
  }

  async fillClusterName(name) {
    const input = this.clusterNameInput();
    await input.fill(name);
    await input.blur();
  }

  // --- Base Domain ---

  baseDomainInput() {
    return this.page.locator('input[placeholder="example.com"]');
  }

  async fillBaseDomain(domain) {
    const input = this.baseDomainInput();
    await input.fill(domain);
    await input.blur();
  }

  // --- SSH Public Key (SecretInput pattern) ---

  sshKeyTextarea() {
    return this.page.locator('textarea[placeholder="ssh-rsa AAAA..."]');
  }

  sshKeyShowBtn() {
    // The SSH key section's show toggle — find the SecretInput container
    // near the SSH label and click its Show button
    return this.page
      .locator('label:has-text("SSH Public Key")')
      .locator('~ .pull-secret-section-inline button.pull-secret-toggle:has-text("Show")')
      .first()
      .or(
        this.page
          .locator('.pull-secret-section-inline:has(textarea[placeholder="ssh-rsa AAAA..."]) button.pull-secret-toggle:has-text("Show")'),
      );
  }

  async fillSSHKey(key) {
    const showBtn = this.sshKeyShowBtn();
    if (await showBtn.isVisible().catch(() => false)) {
      await showBtn.click();
    }
    const textarea = this.sshKeyTextarea();
    await textarea.fill(key);
    await textarea.blur();
  }

  // --- Red Hat Pull Secret (SecretInput pattern) ---

  pullSecretTextarea() {
    return this.page.locator('textarea[aria-label="Red Hat pull secret JSON"]');
  }

  pullSecretShowBtn() {
    return this.page
      .locator('.pull-secret-section-inline:has(textarea[aria-label="Red Hat pull secret JSON"]) button.pull-secret-toggle:has-text("Show")');
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

  // --- FIPS mode switch ---
  // The FIPS switch has no aria-label; it is inside a FieldLabelWithInfo
  // with text "FIPS mode". Locate the switch role button nearest that label.

  fipsSwitch() {
    return this.page
      .locator('button[role="switch"]')
      .filter({ has: this.page.locator('xpath=ancestor::*[contains(., "FIPS mode")]') })
      .first()
      .or(
        this.page.locator(':has-text("FIPS mode") button[role="switch"]').first(),
      );
  }

  async toggleFips() {
    // Find the switch near "FIPS mode" text
    const switchBtn = this.page.locator('button[role="switch"]').last();
    // Fallback: walk the DOM to find the FIPS-adjacent switch
    const fipsSection = this.page.locator(':text("FIPS mode")').locator('..').locator('button[role="switch"]');
    const target = (await fipsSection.count()) > 0 ? fipsSection.first() : switchBtn;
    await target.click();
  }

  // --- Mirror registry toggle ---

  mirrorRegistrySwitch() {
    return this.page
      .locator(':has-text("Using a mirror registry") button[role="switch"]')
      .first()
      .or(
        this.page.locator('.credentials-mirror-label').locator('..').locator('button[role="switch"]'),
      );
  }

  async toggleMirrorRegistry() {
    const toggle = this.mirrorRegistrySwitch();
    await toggle.click();
  }

  // --- Mirror registry pull secret (conditional) ---

  mirrorPullSecretTextarea() {
    return this.page.locator('textarea[aria-label="Mirror registry pull secret JSON"]');
  }

  mirrorPullSecretShowBtn() {
    return this.page
      .locator('.pull-secret-section-inline:has(textarea[aria-label="Mirror registry pull secret JSON"]) button.pull-secret-toggle:has-text("Show")');
  }

  async fillMirrorPullSecret(secret) {
    const showBtn = this.mirrorPullSecretShowBtn();
    if (await showBtn.isVisible().catch(() => false)) {
      await showBtn.click();
    }
    const textarea = this.mirrorPullSecretTextarea();
    await textarea.fill(secret);
    await textarea.blur();
  }

  // --- Generate keypair ---

  generateKeypairBtn() {
    return this.page.locator('button:has-text("Generate keypair")');
  }

  async clickGenerateKeypair() {
    await this.generateKeypairBtn().click();
    await this.page.waitForTimeout(300);
  }

  // --- Heading ---

  heading() {
    return this.page.locator('h2:has-text("Identity & Access")');
  }
}
