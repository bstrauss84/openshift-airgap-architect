import { expect } from '@playwright/test';

export class ReviewStep {
  constructor(page) {
    this.page = page;
  }

  // --- Download Bundle ---

  downloadBundleBtn() {
    return this.page.locator('button:has-text("Download Bundle")');
  }

  async downloadBundle() {
    const downloadPromise = this.page.waitForEvent('download', { timeout: 30000 });
    await this.downloadBundleBtn().click();
    return downloadPromise;
  }

  // --- Preview panes ---

  installConfigPreview() {
    return this.page.locator('.preview').filter({
      has: this.page.locator(':text("install-config.yaml")'),
    });
  }

  agentConfigPreview() {
    return this.page.locator('.preview').filter({
      has: this.page.locator(':text("agent-config.yaml")'),
    });
  }

  imagesetConfigPreview() {
    return this.page.locator('.preview').filter({
      has: this.page.locator(':text("imageset-config.yaml")'),
    });
  }

  fieldManualPreview() {
    return this.page.locator('.preview').filter({
      has: this.page.locator(':text("Field Manual")'),
    });
  }

  async getInstallConfigText() {
    return this.installConfigPreview().textContent();
  }

  async getAgentConfigText() {
    return this.agentConfigPreview().textContent();
  }

  async getImagesetConfigText() {
    return this.imagesetConfigPreview().textContent();
  }

  // --- Show / Hide sensitive values ---

  showSensitiveBtn() {
    return this.page.locator('button:has-text("Show sensitive values")');
  }

  hideSensitiveBtn() {
    return this.page.locator('button:has-text("Hide sensitive values")');
  }

  async showSensitiveValues() {
    await this.showSensitiveBtn().click();
  }

  async hideSensitiveValues() {
    await this.hideSensitiveBtn().click();
  }

  // --- Actions dropdown ---

  actionsDropdownBtn() {
    return this.page.locator('button:has-text("Actions")');
  }

  refreshPreviewsItem() {
    return this.page.locator('.header-actions-dropdown-item:has-text("Refresh Previews")');
  }

  updateDocsItem() {
    return this.page.locator('.header-actions-dropdown-item:has-text("Update Docs")');
  }

  async openActionsDropdown() {
    await this.actionsDropdownBtn().click();
    await this.page.waitForTimeout(200);
  }

  // --- Export option switches ---

  exportSwitch(label) {
    return this.page.locator(`button[role="switch"][aria-label="${label}"]`);
  }

  pullSecretSwitch() {
    return this.exportSwitch('Include pull secret');
  }

  platformCredentialsSwitch() {
    return this.exportSwitch('Include platform credentials');
  }

  mirrorCredentialsSwitch() {
    return this.exportSwitch('Include mirror registry credentials');
  }

  bmcCredentialsSwitch() {
    return this.exportSwitch('Include BMC credentials');
  }

  trustBundleSwitch() {
    return this.exportSwitch('Include trust bundle and certificates');
  }

  sshKeySwitch() {
    return this.exportSwitch('Include SSH public key');
  }

  proxyValuesSwitch() {
    return this.exportSwitch('Include proxy values');
  }

  ocBinariesSwitch() {
    return this.exportSwitch('Include oc and oc-mirror binaries');
  }

  installerSwitch() {
    return this.exportSwitch('Include version-specific openshift-install');
  }

  fipsInstallerSwitch() {
    return this.exportSwitch('Include FIPS-enabled installer');
  }

  mirrorRegistrySwitch() {
    return this.exportSwitch('Include mirror-registry binary');
  }

  // --- Target architecture selects ---

  ocArchSelect() {
    return this.page.locator('select[aria-label="Target architecture for oc/oc-mirror"]');
  }

  installerArchSelect() {
    return this.page.locator('select[aria-label="Target platform/architecture for openshift-install"]');
  }

  mirrorRegistryArchSelect() {
    return this.page.locator('select[aria-label="Target architecture for mirror-registry"]');
  }

  // --- Credentials confirm modal ---

  credentialsConfirmModal() {
    return this.page.locator('[role="dialog"][aria-labelledby="credentials-confirm-title"]');
  }

  confirmIncludeCredentialsBtn() {
    return this.page.locator('button:has-text("Yes, include credentials")');
  }

  cancelCredentialsBtn() {
    return this.page.locator('.modal button:has-text("Cancel")');
  }

  // --- Heading ---

  heading() {
    return this.page.locator('h2:has-text("Architecture Assets")');
  }
}
