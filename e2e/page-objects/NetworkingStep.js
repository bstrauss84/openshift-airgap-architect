import { expect } from '@playwright/test';

export class NetworkingStep {
  constructor(page) {
    this.page = page;
  }

  // --- IP Stack Mode ---

  ipStackModeSelect() {
    return this.page.locator('select[aria-label="IP Stack Mode"]');
  }

  async selectIpStackMode(mode) {
    await this.ipStackModeSelect().selectOption(mode);
  }

  // --- Machine Network ---

  machineNetworkInput() {
    return this.page.locator('input[placeholder="10.90.0.0/24"]');
  }

  machineNetworkV6Input() {
    return this.page.locator('input[placeholder="fd10:90::/64"]');
  }

  async fillMachineNetwork(cidr) {
    const input = this.machineNetworkInput();
    await input.fill(cidr);
    await input.blur();
  }

  async fillMachineNetworkV6(cidr) {
    const input = this.machineNetworkV6Input();
    await input.fill(cidr);
    await input.blur();
  }

  // --- Cluster Network ---

  clusterNetworkInput() {
    return this.page.locator('input[placeholder="10.128.0.0/14"]');
  }

  clusterHostPrefixInput() {
    // Number input near "Cluster Network Host Prefix" label
    return this.page
      .locator('input[type="number"]')
      .filter({ has: this.page.locator('xpath=ancestor::*[contains(., "Host Prefix")]') })
      .first()
      .or(
        this.page.locator('input[type="number"][min="16"][max="28"]'),
      );
  }

  clusterNetworkV6Input() {
    return this.page.locator('input[placeholder="fd01::/48"]');
  }

  async fillClusterNetwork(cidr) {
    const input = this.clusterNetworkInput();
    await input.fill(cidr);
    await input.blur();
  }

  // --- Service Network ---

  serviceNetworkInput() {
    return this.page.locator('input[placeholder="172.30.0.0/16"]');
  }

  serviceNetworkV6Input() {
    return this.page.locator('input[placeholder="fd02::/112"]');
  }

  async fillServiceNetwork(cidr) {
    const input = this.serviceNetworkInput();
    await input.fill(cidr);
    await input.blur();
  }

  // --- API and Ingress VIPs (conditional) ---

  apiVipInput() {
    // VIP inputs have dynamic placeholders like "e.g. 10.90.0.2"
    return this.page.locator('input[placeholder*="e.g."]').first();
  }

  ingressVipInput() {
    return this.page.locator('input[placeholder*="e.g."]').nth(1);
  }

  async fillApiVip(ip) {
    const input = this.apiVipInput();
    await input.fill(ip);
    await input.blur();
  }

  async fillIngressVip(ip) {
    const input = this.ingressVipInput();
    await input.fill(ip);
    await input.blur();
  }

  // --- Heading ---

  heading() {
    return this.page.locator('h2:has-text("Networking")');
  }

  vipSection() {
    return this.page.locator('h3:has-text("API and Ingress VIPs")');
  }
}
