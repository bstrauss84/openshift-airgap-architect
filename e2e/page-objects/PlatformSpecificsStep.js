import { expect } from '@playwright/test';

export class PlatformSpecificsStep {
  constructor(page) {
    this.page = page;
  }

  // =====================================================================
  // AWS GovCloud fields
  // =====================================================================
  aws = {
    regionInput: () =>
      this.page.locator('input[placeholder="us-gov-west-1"]'),

    amiIdInput: () =>
      this.page.locator('input[placeholder*="ami-"]'),

    subnetInput: () =>
      this.page.locator('input[placeholder*="subnet-"]'),

    subnetRolesSelect: () =>
      this.page.locator('select[aria-label="Subnet roles"]'),

    hostedZoneInput: () =>
      this.page.locator('input[placeholder*="Z1234"]'),

    hostedZoneRoleInput: () =>
      this.page.locator('input[placeholder*="arn:aws-us-gov:iam"]'),

    hostedZoneSharedVpcSwitch: () =>
      this.page.locator('button[role="switch"][aria-label*="Hosted zone in another account"]'),

    addSubnetBtn: () =>
      this.page.locator('button:has-text("Add subnet")'),

    removeSubnetBtn: (index = 0) =>
      this.page.locator('button[aria-label="Remove subnet"]').nth(index),

    addEndpointBtn: () =>
      this.page.locator('button:has-text("Add endpoint")'),

    serviceNameInput: (index = 0) =>
      this.page.locator('input[aria-label="Service name"]').nth(index),

    serviceEndpointInput: (index = 0) =>
      this.page.locator('input[aria-label="Service endpoint URL"]').nth(index),

    removeEndpointBtn: (index = 0) =>
      this.page.locator('button[aria-label="Remove endpoint"]').nth(index),

    sectionVisible: () =>
      this.page.locator('input[placeholder="us-gov-west-1"]').isVisible(),

    async fillRegion(region) {
      const input = this.regionInput();
      await input.fill(region);
      await input.blur();
    },

    async fillAmiId(amiId) {
      const input = this.amiIdInput();
      await input.fill(amiId);
      await input.blur();
    },

    async fillHostedZone(zone) {
      const input = this.hostedZoneInput();
      await input.fill(zone);
      await input.blur();
    },
  };

  // =====================================================================
  // vSphere fields
  // =====================================================================
  vsphere = {
    vcenterInput: () =>
      this.page.locator('input[placeholder="vcenter.example.com"]'),

    passwordInput: () =>
      this.page.locator('input[aria-label*="vCenter password"]')
        .or(this.page.locator('input[type="password"]').first()),

    passwordToggle: () =>
      this.page.locator('button[aria-label="Show password"], button[aria-label="Hide password"]').first(),

    failureDomainsRadio: () =>
      this.page.locator('input[aria-label*="failure domains"]'),

    legacyRadio: () =>
      this.page.locator('input[aria-label*="legacy"]'),

    datacenterInput: (index = 0) =>
      this.page.locator('input[placeholder*="Datacenter"]').nth(index),

    datastoreInput: (index = 0) =>
      this.page.locator('input[placeholder*="Datastore"]').nth(index),

    clusterInput: (index = 0) =>
      this.page.locator('input[placeholder*="Cluster"]').nth(index),

    networkInput: (index = 0) =>
      this.page.locator('input[placeholder*="VM Network"]').nth(index),

    diskTypeSelect: () =>
      this.page.locator('select[aria-label*="Disk"]')
        .or(this.page.locator('.platform-specifics-disk-type-select')),

    addFailureDomainBtn: () =>
      this.page.locator('button:has-text("Add failure domain")'),

    removeFailureDomainBtn: (index = 0) =>
      this.page.locator(`button[aria-label="Remove failure domain ${index + 1}"]`),

    sectionVisible: () =>
      this.page.locator('input[placeholder="vcenter.example.com"]').isVisible(),

    async fillVcenter(address) {
      const input = this.vcenterInput();
      await input.fill(address);
      await input.blur();
    },

    async fillPassword(password) {
      const input = this.passwordInput();
      await input.fill(password);
      await input.blur();
    },

    async fillDatacenter(name, index = 0) {
      const input = this.datacenterInput(index);
      await input.fill(name);
      await input.blur();
    },

    async fillDatastore(name, index = 0) {
      const input = this.datastoreInput(index);
      await input.fill(name);
      await input.blur();
    },

    async fillCluster(name, index = 0) {
      const input = this.clusterInput(index);
      await input.fill(name);
      await input.blur();
    },

    async fillNetwork(name, index = 0) {
      const input = this.networkInput(index);
      await input.fill(name);
      await input.blur();
    },
  };

  // =====================================================================
  // Nutanix fields
  // =====================================================================
  nutanix = {
    endpointInput: () =>
      this.page.locator('input[placeholder*="prism.example.com"]'),

    portInput: () =>
      this.page.locator('input[placeholder="9440"]'),

    usernameInput: () =>
      this.page.locator('input[placeholder="admin"]'),

    passwordInput: () =>
      this.page.locator('input[type="password"]'),

    passwordToggle: () =>
      this.page.locator('button[aria-label="Show password"], button[aria-label="Hide password"]').first(),

    credentialsModeSelect: () =>
      this.page.locator('select[aria-label*="Credentials mode"]'),

    publishSelect: () =>
      this.page.locator('select[aria-label*="Publish"]'),

    sectionVisible: () =>
      this.page.locator('input[placeholder*="prism.example.com"]').isVisible(),

    async fillEndpoint(endpoint) {
      const input = this.endpointInput();
      await input.fill(endpoint);
      await input.blur();
    },

    async fillPort(port) {
      const input = this.portInput();
      await input.fill(port);
      await input.blur();
    },

    async fillUsername(username) {
      const input = this.usernameInput();
      await input.fill(username);
      await input.blur();
    },

    async fillPassword(password) {
      const input = this.passwordInput();
      await input.fill(password);
      await input.blur();
    },
  };

  // =====================================================================
  // Azure Government fields
  // =====================================================================
  azure = {
    regionInput: () =>
      this.page.locator('input[placeholder*="usgovvirginia"]'),

    cloudNameInput: () =>
      this.page.locator('input[placeholder*="AzureUSGovernmentCloud"]'),

    sectionVisible: () =>
      this.page.locator('input[placeholder*="usgovvirginia"]').isVisible(),

    async fillRegion(region) {
      const input = this.regionInput();
      await input.fill(region);
      await input.blur();
    },

    async fillCloudName(cloudName) {
      const input = this.cloudNameInput();
      await input.fill(cloudName);
      await input.blur();
    },
  };

  // =====================================================================
  // IBM Cloud fields
  // =====================================================================
  ibmcloud = {
    regionInput: () =>
      this.page.locator('input[placeholder*="us-east"]'),

    sectionVisible: () =>
      this.page.locator('input[placeholder*="us-east"]').isVisible(),

    async fillRegion(region) {
      const input = this.regionInput();
      await input.fill(region);
      await input.blur();
    },
  };

  // =====================================================================
  // Bare Metal Agent fields
  // =====================================================================
  bareMetalAgent = {
    day2Toggle: () =>
      this.page.locator('button[role="switch"][aria-label*="Day-2"]')
        .or(this.page.locator('button[role="switch"][aria-label="Include optional Day-2 bare metal in install-config"]')),

    bootArtifactsInput: () =>
      this.page.locator('input[placeholder*="agent-artifacts"]')
        .or(this.page.locator('input[placeholder*="boot artifacts"]')),

    sectionVisible: async () => {
      const toggle = this.page.locator('button[role="switch"][aria-label*="Day-2"]');
      return (await toggle.count()) > 0;
    },

    async toggleDay2() {
      await this.day2Toggle().click();
    },

    async fillBootArtifacts(url) {
      const input = this.bootArtifactsInput();
      await input.fill(url);
      await input.blur();
    },
  };

  // =====================================================================
  // Bare Metal IPI fields
  // =====================================================================
  bareMetalIpi = {
    provisioningNetworkSelect: () =>
      this.page.locator('select').filter({
        has: this.page.locator('option:has-text("Managed")'),
      }),

    provisioningCidrInput: () =>
      this.page.locator('input[placeholder*="172.22.0.0/24"]'),

    provisioningInterfaceInput: () =>
      this.page.locator('input[placeholder*="eth1"]'),

    provisioningDhcpRange: () =>
      this.page.locator('input[placeholder*="172.22.0.10"]'),

    sectionVisible: () =>
      this.page.locator('input[placeholder*="172.22.0.0/24"]').isVisible(),

    async fillProvisioningCidr(cidr) {
      const input = this.provisioningCidrInput();
      await input.fill(cidr);
      await input.blur();
    },

    async fillProvisioningInterface(iface) {
      const input = this.provisioningInterfaceInput();
      await input.fill(iface);
      await input.blur();
    },
  };

  // =====================================================================
  // Advanced section (common across scenarios)
  // =====================================================================
  advanced = {
    section: () =>
      this.page.locator('button:has-text("Advanced"), summary:has-text("Advanced")'),

    minimalIsoToggle: () =>
      this.page.locator('button[role="switch"][aria-label*="minimal ISO"]')
        .or(this.page.locator('button[role="switch"][aria-label="Use minimal ISO"]')),

    bootArtifactsUrl: () =>
      this.page.locator('input[placeholder*="agent-artifacts"]')
        .or(this.page.locator('input[placeholder*="boot artifacts"]')),

    async openAdvanced() {
      const section = this.section();
      await section.click();
    },

    async toggleMinimalIso() {
      await this.minimalIsoToggle().click();
    },
  };

  // --- Heading ---

  heading() {
    return this.page.locator('h2').first();
  }
}
