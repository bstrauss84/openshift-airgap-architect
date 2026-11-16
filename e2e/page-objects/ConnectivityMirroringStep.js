import { expect } from '@playwright/test';

export class ConnectivityMirroringStep {
  constructor(page) {
    this.page = page;
  }

  // --- Local Registry FQDN ---

  registryFqdnInput() {
    return this.page.locator('input[placeholder="registry.corp.local:5000"]');
  }

  async fillRegistryFqdn(fqdn) {
    const input = this.registryFqdnInput();
    await input.fill(fqdn);
    await input.blur();
  }

  // --- NTP Servers (conditional — hidden for AWS GovCloud) ---

  ntpInput() {
    return this.page.locator('input[placeholder="time.corp.local,10.90.0.10"]');
  }

  async fillNtpServers(servers) {
    const input = this.ntpInput();
    await input.fill(servers);
    await input.blur();
  }

  // --- Mirror source / mirror destination rows ---

  mirrorSourceInput(index = 0) {
    return this.page
      .locator('input[placeholder="quay.io/openshift-release-dev/ocp-release"]')
      .nth(index);
  }

  mirrorDestInput(index = 0) {
    // Mirror destination inputs have a dynamic placeholder based on the registry FQDN
    // They are the second input in each mirror row
    return this.page
      .locator('.mirror-row input, .mirror-header ~ * input')
      .nth(index * 2 + 1);
  }

  addMirrorRowBtn() {
    return this.page.locator('button:has-text("Add Mirror Path")');
  }

  removeMirrorBtn(index = 0) {
    return this.page.locator('button:has-text("Remove")').nth(index);
  }

  async addMirrorRow() {
    await this.addMirrorRowBtn().click();
    await this.page.waitForTimeout(300);
  }

  async fillMirrorSource(index, source) {
    const input = this.mirrorSourceInput(index);
    await input.fill(source);
    await input.blur();
  }

  async fillMirrorDest(index, dest) {
    const input = this.mirrorDestInput(index);
    await input.fill(dest);
    await input.blur();
  }

  // --- Heading ---

  heading() {
    return this.page.locator('h2:has-text("Connectivity & Mirroring")');
  }
}
