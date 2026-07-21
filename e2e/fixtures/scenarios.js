/**
 * State fixtures for all 12 platform/method scenarios.
 *
 * Each fixture returns a complete wizard state with a locked blueprint and confirmed
 * version so the wizard opens in the post-lock state, allowing sidebar navigation to
 * all steps.
 *
 * Modeled after backend/scripts/e2e-matrix.js.
 */

// ---------------------------------------------------------------------------
// Deep merge utility
// ---------------------------------------------------------------------------

function isPlainObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

/**
 * Recursively merge `source` into `target`. Arrays are replaced, not concatenated.
 * Returns a new object — neither input is mutated.
 */
function deepMerge(target, source) {
  if (!source) return structuredClone(target);
  const out = structuredClone(target);
  for (const key of Object.keys(source)) {
    if (isPlainObject(source[key]) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], source[key]);
    } else {
      out[key] = structuredClone(source[key]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Base state factory
// ---------------------------------------------------------------------------

function baseState(overrides) {
  const now = Date.now();
  const base = {
    blueprint: {
      arch: 'x86_64',
      platform: 'Bare Metal',
      baseDomain: 'example.com',
      clusterName: 'e2e-cluster',
      confirmed: true,
      confirmationTimestamp: now,
    },
    release: { channel: '4.20', patchVersion: '4.20.0', confirmed: true },
    version: {
      selectedChannel: 'stable-4.20',
      selectedVersion: '4.20.0',
      selectionTimestamp: now,
      confirmedByUser: true,
      confirmationTimestamp: now,
      versionConfirmed: true,
      _schemaVersion: 3,
    },
    methodology: { method: 'Agent-Based Installer' },
    globalStrategy: {
      fips: false,
      proxyEnabled: false,
      proxies: { httpProxy: '', httpsProxy: '', noProxy: '' },
      ntpServers: [],
      networking: {
        networkType: 'OVNKubernetes',
        machineNetworkV4: '10.90.0.0/24',
        machineNetworkV6: '',
        clusterNetworkCidr: '10.128.0.0/14',
        clusterNetworkHostPrefix: 23,
        clusterNetworkCidrV6: '',
        clusterNetworkHostPrefixV6: 64,
        serviceNetworkCidr: '172.30.0.0/16',
        serviceNetworkCidrV6: '',
      },
      mirroring: {
        registryFqdn: 'registry.local:5000',
        sources: [
          { source: 'quay.io/openshift-release-dev/ocp-release', mirrors: ['registry.local:5000/ocp-release'] },
          { source: 'quay.io/openshift-release-dev/ocp-v4.0-art-dev', mirrors: ['registry.local:5000/ocp-v4.0-art-dev'] },
        ],
      },
    },
    platformConfig: {
      publish: 'External',
      credentialsMode: '',
      aws: { region: '', subnets: '', hostedZone: '', amiId: '', controlPlaneInstanceType: '', workerInstanceType: '' },
      vsphere: { vcenter: '', username: '', password: '', datacenter: '', cluster: '', datastore: '', network: '' },
      nutanix: { endpoint: '', port: '9440', username: '', password: '', cluster: '', subnet: '', apiVIP: '', ingressVIP: '', apiVIPV6: '', ingressVIPV6: '' },
      azure: { cloudName: 'AzureUSGovernmentCloud', region: '', resourceGroupName: '', baseDomainResourceGroupName: '' },
      ibmcloud: { region: '', resourceGroupName: '', vpcMode: 'installer-managed', vpcName: '', type: '' },
    },
    hostInventory: {
      apiVip: '',
      ingressVip: '',
      provisioningNetwork: 'Managed',
      schemaVersion: 2,
      ipStackMode: 'ipv4',
      nodes: [],
      bootArtifactsBaseURL: '',
    },
    operators: { selected: [], stale: false, scenarios: [], fastMode: false },
    credentials: {
      sshPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyForE2ETestingPurposesOnly e2e@test',
      pullSecretPlaceholder: '{"auths":{}}',
      redHatPullSecretConfigured: false,
      mirrorRegistryCredentialsConfigured: false,
      mirrorRegistryPullSecret: '',
      mirrorRegistryUnauthenticated: false,
    },
    trust: {
      mirrorRegistryUsesPrivateCa: false,
      mirrorRegistryCaPem: '',
      proxyCaPem: '',
      additionalTrustBundlePolicy: 'Proxyonly',
    },
    exportOptions: { includeCredentials: true, includeCertificates: true },
    ui: {
      segmentedFlowV1: true,
      visitedSteps: { blueprint: true, methodology: true },
      completedSteps: { blueprint: true },
    },
  };
  return deepMerge(base, overrides);
}

// ---------------------------------------------------------------------------
// Node helper for agent-based scenarios
// ---------------------------------------------------------------------------

function makeNode(hostname, role, ip, mac) {
  return {
    hostname,
    role,
    primary: {
      type: 'ethernet',
      ipMode: 'static',
      ipv4Cidr: ip,
      ipv4Gateway: '192.168.1.1',
      ethernet: { name: 'eth0', macAddress: mac },
    },
    bmc: {},
    rootDevice: '',
    dns: { servers: '', search: '' },
  };
}

function threeControlPlaneNodes() {
  return [
    makeNode('master-0', 'master', '192.168.1.10/24', '52:54:00:aa:00:01'),
    makeNode('master-1', 'master', '192.168.1.11/24', '52:54:00:aa:00:02'),
    makeNode('master-2', 'master', '192.168.1.12/24', '52:54:00:aa:00:03'),
  ];
}

// ---------------------------------------------------------------------------
// Scenario fixtures
// ---------------------------------------------------------------------------

/** Bare Metal + Agent-Based Installer — 3 CP nodes with VIPs */
export function bareMetalAgent() {
  return baseState({
    blueprint: { platform: 'Bare Metal' },
    methodology: { method: 'Agent-Based Installer' },
    hostInventory: {
      nodes: threeControlPlaneNodes(),
      apiVip: '192.168.1.100',
      ingressVip: '192.168.1.101',
    },
  });
}

/** Bare Metal + IPI — empty nodes, provisioning network managed */
export function bareMetalIpi() {
  return baseState({
    blueprint: { platform: 'Bare Metal' },
    methodology: { method: 'IPI' },
    hostInventory: { nodes: [], provisioningNetwork: 'Managed' },
  });
}

/** Bare Metal + UPI — no nodes */
export function bareMetalUpi() {
  return baseState({
    blueprint: { platform: 'Bare Metal' },
    methodology: { method: 'UPI' },
    hostInventory: { nodes: [] },
  });
}

/** VMware vSphere + IPI — vSphere platform config filled */
export function vsphereIpi() {
  return baseState({
    blueprint: { platform: 'VMware vSphere' },
    methodology: { method: 'IPI' },
    platformConfig: {
      vsphere: {
        vcenter: 'vcenter.example.com',
        username: 'administrator@vsphere.local',
        password: 'vSphereTestPass123',
        datacenter: 'DC0',
        cluster: 'cluster0',
        datastore: 'datastore0',
        network: 'VM Network',
      },
    },
  });
}

/** VMware vSphere + UPI — vSphere platform config filled */
export function vsphereUpi() {
  return baseState({
    blueprint: { platform: 'VMware vSphere' },
    methodology: { method: 'UPI' },
    platformConfig: {
      vsphere: {
        vcenter: 'vcenter.example.com',
        username: 'administrator@vsphere.local',
        password: 'vSphereTestPass123',
        datacenter: 'DC0',
        cluster: 'cluster0',
        datastore: 'datastore0',
        network: 'VM Network',
      },
    },
  });
}

/** VMware vSphere + Agent-Based Installer — vSphere config + 3 CP nodes + VIPs */
export function vsphereAgent() {
  return baseState({
    blueprint: { platform: 'VMware vSphere' },
    methodology: { method: 'Agent-Based Installer' },
    platformConfig: {
      vsphere: {
        placementMode: 'legacy',
        vcenter: 'vcenter.example.com',
        username: 'administrator@vsphere.local',
        password: 'vSphereTestPass123',
        datacenter: 'DC0',
        cluster: 'cluster0',
        datastore: 'datastore0',
        network: 'VM Network',
      },
    },
    hostInventory: {
      nodes: threeControlPlaneNodes(),
      apiVip: '192.168.1.100',
      ingressVip: '192.168.1.101',
    },
  });
}

/** Nutanix + IPI — Nutanix platform config filled with replicas */
export function nutanixIpi() {
  return baseState({
    blueprint: { platform: 'Nutanix' },
    methodology: { method: 'IPI' },
    platformConfig: {
      controlPlaneReplicas: 3,
      computeReplicas: 3,
      nutanix: {
        endpoint: 'prism-central.example.com',
        port: '9440',
        username: 'admin',
        password: 'NutanixTestPass123',
        cluster: 'nutanix-cluster-1',
        subnet: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        apiVIP: '10.90.0.10',
        ingressVIP: '10.90.0.11',
        apiVIPV6: '',
        ingressVIPV6: '',
      },
    },
  });
}

/** AWS GovCloud + IPI — AWS platform config with region */
export function awsGovcloudIpi() {
  return baseState({
    blueprint: { platform: 'AWS GovCloud' },
    methodology: { method: 'IPI' },
    platformConfig: {
      aws: {
        region: 'us-gov-west-1',
        subnets: '',
        hostedZone: '',
        amiId: '',
        controlPlaneInstanceType: '',
        workerInstanceType: '',
      },
    },
  });
}

/** AWS GovCloud + UPI — AWS platform config with region */
export function awsGovcloudUpi() {
  return baseState({
    blueprint: { platform: 'AWS GovCloud' },
    methodology: { method: 'UPI' },
    platformConfig: {
      aws: {
        region: 'us-gov-west-1',
        subnets: '',
        hostedZone: '',
        amiId: '',
        controlPlaneInstanceType: '',
        workerInstanceType: '',
      },
    },
  });
}

/** Azure Government + IPI — Azure platform config filled */
export function azureGovernmentIpi() {
  return baseState({
    blueprint: { platform: 'Azure Government' },
    methodology: { method: 'IPI' },
    platformConfig: {
      azure: {
        cloudName: 'AzureUSGovernmentCloud',
        region: 'usgovvirginia',
        resourceGroupName: 'rg-ocp-test',
        baseDomainResourceGroupName: 'rg-dns-test',
      },
    },
  });
}

/** Azure Government + UPI — Azure platform config filled */
export function azureGovernmentUpi() {
  return baseState({
    blueprint: { platform: 'Azure Government' },
    methodology: { method: 'UPI' },
    platformConfig: {
      azure: {
        cloudName: 'AzureUSGovernmentCloud',
        region: 'usgovvirginia',
        resourceGroupName: 'rg-ocp-test',
        baseDomainResourceGroupName: 'rg-dns-test',
      },
    },
  });
}

/** IBM Cloud + IPI — IBM Cloud platform config filled */
export function ibmCloudIpi() {
  return baseState({
    blueprint: { platform: 'IBM Cloud' },
    methodology: { method: 'IPI' },
    platformConfig: {
      ibmcloud: {
        region: 'us-east',
        resourceGroupName: 'ibm-rg-test',
        vpcMode: 'installer-managed',
        vpcName: '',
        type: 'bx2-4x16',
      },
    },
  });
}

// ---------------------------------------------------------------------------
// ALL_SCENARIOS — iterable list of all scenario fixtures
// ---------------------------------------------------------------------------

export const ALL_SCENARIOS = [
  { id: 'bare-metal-agent', name: 'Bare Metal + Agent-Based Installer', fixture: bareMetalAgent, hasAgentConfig: true },
  { id: 'bare-metal-ipi', name: 'Bare Metal + IPI', fixture: bareMetalIpi, hasAgentConfig: false },
  { id: 'bare-metal-upi', name: 'Bare Metal + UPI', fixture: bareMetalUpi, hasAgentConfig: false },
  { id: 'vsphere-ipi', name: 'VMware vSphere + IPI', fixture: vsphereIpi, hasAgentConfig: false },
  { id: 'vsphere-upi', name: 'VMware vSphere + UPI', fixture: vsphereUpi, hasAgentConfig: false },
  { id: 'vsphere-agent', name: 'VMware vSphere + Agent-Based Installer', fixture: vsphereAgent, hasAgentConfig: true },
  { id: 'nutanix-ipi', name: 'Nutanix + IPI', fixture: nutanixIpi, hasAgentConfig: false },
  { id: 'aws-govcloud-ipi', name: 'AWS GovCloud + IPI', fixture: awsGovcloudIpi, hasAgentConfig: false },
  { id: 'aws-govcloud-upi', name: 'AWS GovCloud + UPI', fixture: awsGovcloudUpi, hasAgentConfig: false },
  { id: 'azure-government-ipi', name: 'Azure Government + IPI', fixture: azureGovernmentIpi, hasAgentConfig: false },
  { id: 'azure-government-upi', name: 'Azure Government + UPI', fixture: azureGovernmentUpi, hasAgentConfig: false },
  { id: 'ibm-cloud-ipi', name: 'IBM Cloud + IPI', fixture: ibmCloudIpi, hasAgentConfig: false },
];

// ---------------------------------------------------------------------------
// Overlay functions — compose with any scenario fixture
// ---------------------------------------------------------------------------

/** Enable FIPS mode. */
export function withFips(state) {
  return deepMerge(state, {
    globalStrategy: { fips: true },
  });
}

/** Enable proxy with populated URLs. */
export function withProxy(state) {
  return deepMerge(state, {
    globalStrategy: {
      proxyEnabled: true,
      proxies: {
        httpProxy: 'http://proxy.example.com:3128',
        httpsProxy: 'https://proxy.example.com:3129',
        noProxy: '.example.com,10.90.0.0/24,172.30.0.0/16',
      },
    },
  });
}

/** Enable dual-stack networking with IPv6 CIDRs populated. */
export function withDualStack(state) {
  return deepMerge(state, {
    globalStrategy: {
      networking: {
        machineNetworkV6: 'fd00::/48',
        clusterNetworkCidrV6: 'fd01::/48',
        clusterNetworkHostPrefixV6: 64,
        serviceNetworkCidrV6: 'fd02::/112',
      },
    },
    hostInventory: {
      ipStackMode: 'dual',
    },
  });
}

/** Add a CA certificate to the trust bundle. */
export function withTrustBundle(state) {
  return deepMerge(state, {
    trust: {
      mirrorRegistryUsesPrivateCa: true,
      mirrorRegistryCaPem: [
        '-----BEGIN CERTIFICATE-----',
        'MIICpDCCAYwCCQDMq2inYDfBQjANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAls',
        'b2NhbGhvc3QwHhcNMjQwMTAxMDAwMDAwWhcNMjUwMTAxMDAwMDAwWjAUMRIwEAYD',
        'VQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC7',
        'o4qne60TB3bALBSOTKMdMVFJOyEFwYMXLqBMzoTHIVJNBFdhMXWPNuaVJCFGOsOi',
        'FakeDataForE2ETestingPurposesOnly',
        '-----END CERTIFICATE-----',
      ].join('\n'),
      additionalTrustBundlePolicy: 'Always',
    },
  });
}
