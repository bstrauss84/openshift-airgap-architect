/**
 * Mock test data constants for E2E tests.
 * Provides realistic but fake credentials, network configs, and platform settings.
 */

export const PULL_SECRET = '{"auths":{"registry.redhat.io":{"auth":"dGVzdDp0ZXN0"}}}';
export const MIRROR_PULL_SECRET = '{"auths":{"registry.local:5000":{"auth":"bWlycm9yOnRlc3Q="}}}';
export const SSH_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyForE2ETestingPurposesOnly e2e@test';

export const CA_CERT = `-----BEGIN CERTIFICATE-----
MIICpDCCAYwCCQDMq2inYDfBQjANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAls
b2NhbGhvc3QwHhcNMjQwMTAxMDAwMDAwWhcNMjUwMTAxMDAwMDAwWjAUMRIwEAYD
VQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC7
o4qne60TB3bALBSOTKMdMVFJOyEFwYMXLqBMzoTHIVJNBFdhMXWPNuaVJCFGOsOi
TZEBmEXp/KuEEkDJUFpmmHEljLry0i6R/fSwiITJlfBBPaYSWfEoLiRYMoaiPIG1
F4uJoBfNPKJN0MbOjVUmfxOUjBBjkCAhPQe9LLKdD0Y7DGJMqwF/loBe0gN3L3x
E2aaL1t5bG/ZJzDE09V9MDbQnRBbvL6FKq2GJS6hHERZ0nREsbWJRBLdGA8PuCMY
pDGoJBIBvlP0MFNMHZdxJFnsfpQk5ORwJy5eIzfEjP3JbQbYOIaB9hPXPboW0EPj
LJqkPkLjVMDr0GvG3bIhAgMBAAEwDQYJKoZIhvcNAQELBQADggEBAAwsome fake
data for testing purposes only
-----END CERTIFICATE-----`;

export const MAC_ADDRESSES = [
  '52:54:00:aa:00:01', '52:54:00:aa:00:02', '52:54:00:aa:00:03',
  '52:54:00:aa:00:04', '52:54:00:aa:00:05', '52:54:00:aa:00:06',
  '52:54:00:aa:00:07', '52:54:00:aa:00:08', '52:54:00:aa:00:09',
  '52:54:00:aa:00:10',
];

export const NETWORK = {
  machineV4: '10.90.0.0/24',
  machineV6: 'fd00::/48',
  clusterCidr: '10.128.0.0/14',
  clusterHostPrefix: 23,
  clusterCidrV6: 'fd01::/48',
  clusterHostPrefixV6: 64,
  serviceCidr: '172.30.0.0/16',
  serviceCidrV6: 'fd02::/112',
};

export const VIPS = {
  api: '10.90.0.2',
  ingress: '10.90.0.3',
};

export const BMC = {
  address: 'redfish+http://192.168.1.10/redfish/v1/Systems/1',
  username: 'admin',
  password: 'bmc-test-pass',
  bootMAC: '52:54:00:bb:00:01',
};

export const VSPHERE = {
  vcenter: 'vcenter.example.com',
  username: 'administrator@vsphere.local',
  password: 'vSphereTestPass123',
  datacenter: 'DC0',
  cluster: 'cluster0',
  datastore: 'datastore0',
  network: 'VM Network',
};

export const NUTANIX = {
  endpoint: 'prism-central.example.com',
  port: '9440',
  username: 'admin',
  password: 'NutanixTestPass123',
  subnetUuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  clusterName: 'nutanix-cluster-1',
};

export const AWS = {
  region: 'us-gov-west-1',
  amiId: 'ami-0123456789abcdef0',
  controlPlaneInstanceType: 'm5.xlarge',
  workerInstanceType: 'm5.large',
  hostedZone: 'Z0123456789ABCDEFGHIJ',
};

export const AZURE = {
  region: 'usgovvirginia',
  resourceGroup: 'rg-ocp-test',
  baseDomainResourceGroup: 'rg-dns-test',
};

export const IBM_CLOUD = {
  region: 'us-east',
  resourceGroup: 'ibm-rg-test',
  instanceType: 'bx2-4x16',
};

export const NTP_SERVERS = 'time.corp.local,10.90.0.10';

export const PROXY = {
  httpProxy: 'http://proxy.example.com:3128',
  httpsProxy: 'https://proxy.example.com:3129',
  noProxy: '.example.com,10.90.0.0/24,172.30.0.0/16',
};

export const MIRROR = {
  registryFqdn: 'registry.local:5000',
  sources: [
    { source: 'quay.io/openshift-release-dev/ocp-release', mirrors: ['registry.local:5000/ocp-release'] },
    { source: 'quay.io/openshift-release-dev/ocp-v4.0-art-dev', mirrors: ['registry.local:5000/ocp-v4.0-art-dev'] },
  ],
};
