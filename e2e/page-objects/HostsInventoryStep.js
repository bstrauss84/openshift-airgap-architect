import { expect } from '@playwright/test';

export class HostsInventoryStep {
  constructor(page) {
    this.page = page;
  }

  // --- Node count controls ---

  controlPlaneCount() {
    return this.page.locator('label:has-text("Control plane") input[type="number"]');
  }

  workerCount() {
    return this.page.locator('label:has-text("Worker") input[type="number"]');
  }

  infraCount() {
    return this.page.locator('label:has-text("Infra") input[type="number"]');
  }

  generateNodesBtn() {
    return this.page.locator('button:has-text("Generate nodes")');
  }

  clearNodesBtn() {
    return this.page.locator('button:has-text("Clear and set counts again")');
  }

  async setNodeCounts(cp, workers = 0, infra = 0) {
    const cpInput = this.controlPlaneCount();
    await cpInput.fill(String(cp));
    await cpInput.blur();

    if (workers > 0) {
      const workerInput = this.workerCount();
      await workerInput.fill(String(workers));
      await workerInput.blur();
    }

    if (infra > 0) {
      const infraInput = this.infraCount();
      await infraInput.fill(String(infra));
      await infraInput.blur();
    }
  }

  async generateNodes() {
    await this.generateNodesBtn().click();
    await this.page.waitForTimeout(500);
  }

  async clearNodes() {
    await this.clearNodesBtn().click();
    await this.page.waitForTimeout(300);
  }

  // --- Node tiles ---

  nodeTile(index) {
    return this.page.locator('button.host-inventory-v2-tile').nth(index);
  }

  async nodeTileCount() {
    return this.page.locator('button.host-inventory-v2-tile').count();
  }

  nodeTileHostname(index) {
    return this.nodeTile(index).locator('.host-inventory-v2-tile-hostname');
  }

  nodeTileRole(index) {
    return this.nodeTile(index).locator('.host-inventory-v2-tile-role');
  }

  async openNodeDrawer(index) {
    await this.nodeTile(index).click();
    await this.page.waitForTimeout(300);
  }

  // --- Drawer ---

  drawer() {
    return this.page.locator('.host-inventory-v2-drawer');
  }

  drawerCloseBtn() {
    return this.page.locator('button[aria-label="Close"]');
  }

  drawerPreviousBtn() {
    return this.page.locator('button:has-text("Previous")');
  }

  drawerNextBtn() {
    return this.page.locator('button:has-text("Next")');
  }

  async closeDrawer() {
    await this.drawerCloseBtn().click();
    await this.page.waitForTimeout(200);
  }

  async nextNode() {
    await this.drawerNextBtn().click();
    await this.page.waitForTimeout(200);
  }

  async previousNode() {
    await this.drawerPreviousBtn().click();
    await this.page.waitForTimeout(200);
  }

  // --- Drawer hostname ---

  drawerHostnameInput() {
    return this.page
      .locator('input[placeholder*="master-0"]')
      .or(this.page.locator('input[placeholder*="worker-0"]'))
      .first();
  }

  async fillDrawerHostname(hostname) {
    const input = this.drawerHostnameInput();
    await input.fill(hostname);
    await input.blur();
  }

  // --- BMC fields ---

  bmcAddress() {
    return this.page.locator('input[placeholder*="redfish"]');
  }

  bmcUsername() {
    // BMC username input -- locate by its position near BMC address
    return this.page.locator('input[placeholder*="admin"]')
      .or(this.page.locator('input[placeholder*="bmc"]'));
  }

  bmcPassword() {
    return this.page.locator('input[type="password"]');
  }

  bmcBootMac() {
    return this.page.locator('input[placeholder*="52:54"]');
  }

  async fillBmcAddress(address) {
    const input = this.bmcAddress();
    await input.fill(address);
    await input.blur();
  }

  async fillBmcUsername(username) {
    const input = this.bmcUsername();
    await input.fill(username);
    await input.blur();
  }

  async fillBmcPassword(password) {
    const input = this.bmcPassword();
    await input.fill(password);
    await input.blur();
  }

  async fillBmcBootMac(mac) {
    const input = this.bmcBootMac();
    await input.fill(mac);
    await input.blur();
  }

  // --- Network interface fields ---

  interfaceTypeSelect() {
    return this.page
      .locator('select')
      .filter({ has: this.page.locator('option:has-text("ethernet")') });
  }

  ipModeSelect() {
    return this.page
      .locator('select')
      .filter({ has: this.page.locator('option:has-text("DHCP")') });
  }

  ethernetNameInput() {
    return this.page
      .locator('input[placeholder*="eno"]')
      .or(this.page.locator('input[placeholder*="enp"]'));
  }

  ethernetMacInput() {
    return this.page.locator('input[placeholder*="52:54:00"]');
  }

  ipv4CidrInput() {
    return this.page.locator('input[placeholder*="192.168"]');
  }

  ipv4GatewayInput() {
    return this.page.locator('input[placeholder*="gateway"]');
  }

  async fillEthernetName(name) {
    const input = this.ethernetNameInput();
    await input.fill(name);
    await input.blur();
  }

  async fillEthernetMac(mac) {
    const input = this.ethernetMacInput();
    await input.fill(mac);
    await input.blur();
  }

  async fillIpv4Cidr(cidr) {
    const input = this.ipv4CidrInput();
    await input.fill(cidr);
    await input.blur();
  }

  // --- DNS ---

  dnsServersInput() {
    return this.page.locator('input[placeholder*="192.168.1.10,192.168.1.11"]');
  }

  async fillDnsServers(servers) {
    const input = this.dnsServersInput();
    await input.fill(servers);
    await input.blur();
  }

  // --- Boot artifacts ---

  bootArtifactsInput() {
    return this.page.locator('input[placeholder*="agent-artifacts"]');
  }

  async fillBootArtifacts(url) {
    const input = this.bootArtifactsInput();
    await input.fill(url);
    await input.blur();
  }

  // --- Apply settings to other nodes ---

  applySettingsBtn() {
    return this.page.locator('button:has-text("Apply settings to other nodes")');
  }

  applyConfirmBtn() {
    return this.page.locator('button:has-text("Apply")').first();
  }

  // --- Heading ---

  heading() {
    return this.page.locator('h2:has-text("Hosts")');
  }
}
