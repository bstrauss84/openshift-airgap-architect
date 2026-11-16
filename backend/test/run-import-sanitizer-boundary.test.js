/**
 * A credential-bearing JSON Run import must not persist credentials.
 *
 * POST /api/state persists through sanitizeStateForPersistence, which strips
 * a recursive set of credential-shaped keys. POST /api/run/import persisted
 * through sanitizeStateForExport instead, which only blanks four
 * `credentials.*` fields and the Blueprint ephemeral. Everything else — SSH
 * private key, vSphere/Nutanix/BMC passwords, userinfo embedded in a proxy
 * URL — survived into stored state and then came back out through
 * GET /api/state, GET /api/run/export and POST /api/run/duplicate.
 *
 * This matters more than it looks: the update banner tells operators to
 * Export Run, upgrade, then Import Run. That is precisely the path that was
 * laundering credentials into persistent storage.
 *
 * The import must still SUCCEED and must still migrate — a test that merely
 * proves "no credential came back" would pass against a 400, so every case
 * asserts the import was accepted and that non-sensitive configuration
 * survived intact.
 *
 * Canaries are generated at runtime; no credential-shaped literal is
 * committed to source.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'oaa-runimport-data-'));

const canary = (cls) =>
  `OAA_SYNTH_CANARY_${cls}_${crypto.randomBytes(9).toString('hex').toUpperCase()}`;

const C = {
  SSH_PRIVATE: canary('SSHPRIVATE'),
  VCENTER_PW: canary('VCENTERPW'),
  BMC_PW: canary('BMCPW'),
  PROXY_PW: canary('PROXYPW'),
  RH_PULL: canary('RHPULL'),
  MIRROR_PULL: canary('MIRRORPULL'),
  NUTANIX_PW: canary('NUTANIXPW')
};

const { app } = await import('../src/index.js');
const { createTestServer, closeTestServer } = await import('./helpers/httpServerLifecycle.js');

/** A v3 run payload carrying every credential shape we care about. */
const credentialBearingState = () => ({
  _schemaVersion: 3,
  version: {
    _schemaVersion: 3, selectedMinor: '4.22', selectedPatch: '4.22.16',
    selectedChannel: 'stable-4.22', selectedVersion: '4.22.16', locked: true
  },
  release: { channel: '4.22', patchVersion: '4.22.16', confirmed: true },
  blueprint: {
    platform: 'vSphere', arch: 'x86_64', clusterName: 'import-canary',
    baseDomain: 'example.com', confirmed: true,
    blueprintPullSecretEphemeral: `{"auths":{"registry.redhat.io":{"auth":"${C.RH_PULL}"}}}`
  },
  methodology: { method: 'IPI' },
  credentials: {
    sshPublicKey: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAB import@test',
    sshPrivateKey: C.SSH_PRIVATE,
    pullSecretPlaceholder: `{"auths":{"registry.redhat.io":{"auth":"${C.RH_PULL}"}}}`,
    mirrorRegistryPullSecret: `{"auths":{"registry.local":{"auth":"${C.MIRROR_PULL}"}}}`
  },
  platformConfig: {
    vsphere: {
      vcenter: 'vcenter.example.com', username: 'svc-openshift',
      password: C.VCENTER_PW, datacenter: 'DC1'
    },
    nutanix: { prismPassword: C.NUTANIX_PW }
  },
  globalStrategy: {
    fips: false,
    networking: {
      networkType: 'OVNKubernetes', machineNetworkV4: '10.90.0.0/24',
      clusterNetworkCidr: '10.128.0.0/14', clusterNetworkHostPrefix: 23,
      serviceNetworkCidr: '172.30.0.0/16'
    },
    // `proxies` (plural) is the canonical key the application reads and
    // writes — backend/src/index.js:394, TrustProxyStep.jsx:207,
    // generate.js:774. Userinfo embedded here is a real credential and must
    // be stripped by stripProxyCredentials during persistence.
    proxies: {
      httpProxy: `http://proxyuser:${C.PROXY_PW}@proxy.example.com:3128`,
      httpsProxy: `https://proxyuser:${C.PROXY_PW}@proxy.example.com:3129`,
      noProxy: '.svc,.cluster.local'
    },
    mirroring: { registryFqdn: 'registry.local:5000', sources: [] }
  },
  hostInventory: {
    ipStackMode: 'ipv4',
    nodes: [{
      hostname: 'master-0', role: 'master',
      bmc: { address: 'redfish+https://10.0.0.9', username: 'root', password: C.BMC_PW }
    }]
  },
  operators: { selected: [], stale: false },
  trust: { additionalTrustBundlePolicy: 'Proxyonly', mirrorRegistryCaPem: '', proxyCaPem: '' }
});

const ALL = Object.entries(C);

/** Assert no canary appears anywhere in a serialized surface. */
const assertNoCanaries = (text, where) => {
  for (const [name, value] of ALL) {
    assert.ok(!text.includes(value), `${where} leaked ${name}`);
  }
};

describe('JSON Run import must not persist credentials', () => {
  let server, baseUrl;

  before(async () => { ({ server, baseUrl } = await createTestServer(app)); });
  after(async () => {
    await closeTestServer(server);
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  });

  const importRun = (state, schemaVersion = 2) =>
    fetch(`${baseUrl}/api/run/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schemaVersion, state })
    });

  it('accepts the import and preserves non-sensitive configuration', async () => {
    // Non-vacuity: if this 400s, every "no credential leaked" assertion below
    // would pass trivially against a rejected request.
    const res = await importRun(credentialBearingState());
    assert.strictEqual(res.status, 200, 'the import must succeed');
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.state?.blueprint?.clusterName, 'import-canary',
      'non-sensitive configuration must survive the import');
    assert.strictEqual(body.state?.version?.selectedMinor, '4.22');
    assert.strictEqual(body.state?.platformConfig?.vsphere?.vcenter, 'vcenter.example.com',
      'non-credential platform fields must survive');
    // The proxy ENDPOINT must survive even though its userinfo is removed —
    // stripping the credential must not silently disable the proxy config.
    assert.match(String(body.state?.globalStrategy?.proxies?.httpProxy || ''),
      /proxy\.example\.com:3128/,
      'the proxy endpoint must be preserved after credential stripping');
    assert.strictEqual(body.state?.globalStrategy?.proxies?.noProxy, '.svc,.cluster.local',
      'noProxy must survive');
  });

  it('does not return credentials in the import response', async () => {
    const res = await importRun(credentialBearingState());
    assertNoCanaries(await res.text(), 'the /api/run/import response');
  });

  it('does not persist credentials into stored state', async () => {
    await importRun(credentialBearingState());
    const res = await fetch(`${baseUrl}/api/state`);
    assertNoCanaries(await res.text(), 'GET /api/state');
  });

  it('does not surface credentials through run export', async () => {
    await importRun(credentialBearingState());
    const res = await fetch(`${baseUrl}/api/run/export`);
    assertNoCanaries(await res.text(), 'GET /api/run/export');
  });

  it('does not propagate credentials through run duplicate', async () => {
    await importRun(credentialBearingState());
    const res = await fetch(`${baseUrl}/api/run/duplicate`, { method: 'POST' });
    assertNoCanaries(await res.text(), 'POST /api/run/duplicate');
  });

  it('does not persist credentials to the database file on disk', async () => {
    // Reading the parsed API response only proves the shape the API returns.
    // The bytes on disk are what actually survives a restart.
    await importRun(credentialBearingState());
    const dbPath = path.join(process.env.DATA_DIR, 'airgap-architect.db');
    if (!fs.existsSync(dbPath)) return; // nothing persisted at all is also fine
    assertNoCanaries(fs.readFileSync(dbPath, 'latin1'), 'the SQLite file');
  });

  it('still migrates a legacy v1/v2 run and keeps it credential-free', async () => {
    // The upgrade path the update banner recommends. Migration must not be a
    // casualty of tightening the sanitizer.
    const legacy = {
      release: { channel: '4.22', patchVersion: '4.22.16', confirmed: true },
      blueprint: { platform: 'Bare Metal', arch: 'x86_64', clusterName: 'legacy-run', baseDomain: 'example.com' },
      credentials: { sshPrivateKey: C.SSH_PRIVATE, pullSecretPlaceholder: `{"auths":{"registry.redhat.io":{"auth":"${C.RH_PULL}"}}}` }
    };
    const res = await importRun(legacy, 1);
    assert.strictEqual(res.status, 200, 'a legacy run must still import');
    const body = await res.json();
    assert.strictEqual(body.state?.blueprint?.clusterName, 'legacy-run',
      'legacy configuration must survive migration');
    assert.strictEqual(body.state?._schemaVersion ?? body.state?.version?._schemaVersion, 3,
      'the imported legacy run must be migrated to schema v3');
    assertNoCanaries(JSON.stringify(body), 'the migrated legacy import');
    assertNoCanaries(await (await fetch(`${baseUrl}/api/state`)).text(), 'state after legacy import');
  });
});
