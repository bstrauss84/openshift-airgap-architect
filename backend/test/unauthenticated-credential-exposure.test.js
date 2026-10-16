/**
 * Credentials must not be reachable by an unauthenticated caller.
 *
 * Withdrawing GET /api/secrets/rh-pull-secret/content closed one door. An
 * exposure audit found two more that reached the same credentials by other
 * routes, and both are covered here:
 *
 *  1. POST /api/bundle.zip archived a caller-supplied directory verbatim.
 *     `mirrorWorkflow.archivePath` was path.resolve()'d and streamed into the
 *     returned ZIP with no boundary check, so a crafted request could archive
 *     the application data directory — where a mounted pull secret lives by
 *     default — or /run/secrets, or a service-account token directory.
 *
 *  2. POST /api/ocmirror/run stored the entire request body, including
 *     rhPullSecret, into job metadata in SQLite. GET /api/jobs and
 *     GET /api/jobs/:id return the whole row, so the credentials an operator
 *     typed into the UI were served back to anyone.
 *
 * NON-VACUITY
 * -----------
 * Each test plants a unique runtime canary in the place the real credential
 * would be and then proves that exact byte sequence cannot come back. A test
 * that merely asserts a 4xx would pass against a broken guard that still
 * leaked on some other path, so the assertions search response BYTES.
 *
 * The canaries are generated at runtime and never written to tracked source.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test';
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'oaa-exposure-data-'));
process.env.DATA_DIR = DATA_DIR;

const SECRET_CANARY = `OAA_SYNTH_CANARY_ONDISK_${crypto.randomBytes(9).toString('hex').toUpperCase()}`;
const BODY_CANARY = `OAA_SYNTH_CANARY_TYPED_${crypto.randomBytes(9).toString('hex').toUpperCase()}`;

// A credential sitting in the data directory, exactly where the application
// looks for a mounted pull secret.
fs.writeFileSync(path.join(DATA_DIR, 'pull-secret.json'), JSON.stringify({
  auths: { 'registry.redhat.io': { auth: SECRET_CANARY } }
}));

const { app } = await import('../src/index.js');
const { createTestServer, closeTestServer } = await import('./helpers/httpServerLifecycle.js');

const baseState = () => ({
  _schemaVersion: 3,
  version: {
    _schemaVersion: 3, selectedMinor: '4.22', selectedPatch: '4.22.16',
    selectedChannel: 'stable-4.22', selectedVersion: '4.22.16', locked: true
  },
  release: { channel: '4.22', patchVersion: '4.22.16', confirmed: true },
  blueprint: {
    platform: 'Bare Metal', arch: 'x86_64', clusterName: 'exposure',
    baseDomain: 'example.com', confirmed: true
  },
  methodology: { method: 'Agent-Based Installer' },
  credentials: { sshPublicKey: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAB exposure@test' },
  globalStrategy: {
    fips: false,
    networking: {
      networkType: 'OVNKubernetes', machineNetworkV4: '10.90.0.0/24',
      clusterNetworkCidr: '10.128.0.0/14', clusterNetworkHostPrefix: 23,
      serviceNetworkCidr: '172.30.0.0/16'
    },
    mirroring: { registryFqdn: 'registry.local:5000', sources: [] }
  },
  hostInventory: { nodes: [], ipStackMode: 'ipv4' },
  operators: { selected: [], stale: false },
  trust: { additionalTrustBundlePolicy: 'Proxyonly', mirrorRegistryCaPem: '', proxyCaPem: '' },
  exportOptions: {
    includeCredentials: false, includeCertificates: true,
    includeClientTools: false, includeInstaller: false,
    includeHighSideRuntimePackage: false
  }
});

describe('an unauthenticated caller cannot reach credentials', () => {
  let server, baseUrl;

  before(async () => { ({ server, baseUrl } = await createTestServer(app)); });
  after(async () => {
    await closeTestServer(server);
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it('will not archive the data directory, where a mounted secret lives', async () => {
    const state = baseState();
    state.mirrorWorkflow = { includeInExport: true, archivePath: DATA_DIR };

    const res = await fetch(`${baseUrl}/api/bundle.zip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state })
    });

    // The export itself may legitimately succeed — the refusal is recorded
    // inside the archive. What must never happen is the canary coming back.
    const body = Buffer.from(await res.arrayBuffer());
    assert.ok(!body.includes(SECRET_CANARY),
      'the on-disk pull secret was streamed to an unauthenticated caller');
    assert.ok(!body.includes('pull-secret.json'),
      'the data directory was archived into the export');
  });

  it('will not archive directories outside the permitted roots', async () => {
    for (const target of ['/etc', '/run/secrets', path.dirname(DATA_DIR)]) {
      const state = baseState();
      state.mirrorWorkflow = { includeInExport: true, archivePath: target };
      const res = await fetch(`${baseUrl}/api/bundle.zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state })
      });
      const body = Buffer.from(await res.arrayBuffer());
      assert.ok(!body.includes(SECRET_CANARY), `${target} leaked the secret`);
      // /etc is readable and non-empty on this host; if it had been archived
      // its contents would be present.
      assert.ok(!body.includes('passwd\0') && !body.includes('/etc/passwd'),
        `${target} contents were archived`);
    }
  });

  it('still exports a legitimate mirror-output subdirectory', async () => {
    // The guard must refuse attacks without breaking the real feature.
    const outDir = path.join(DATA_DIR, 'mirror-out');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'mirror-log.txt'), 'legitimate mirror output\n');

    const state = baseState();
    state.mirrorWorkflow = { includeInExport: true, archivePath: outDir };
    const res = await fetch(`${baseUrl}/api/bundle.zip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state })
    });
    assert.strictEqual(res.status, 200);
    const body = Buffer.from(await res.arrayBuffer());
    assert.ok(body.includes('mirror-log.txt'),
      'a permitted mirror-output directory must still be exported');
    assert.ok(!body.includes(SECRET_CANARY), 'the sibling secret must not ride along');
  });

  it('does not serve back a pull secret submitted to /api/ocmirror/run', async () => {
    // The version must be confirmed first or the run is rejected with 400
    // before a job row is ever created — in which case /api/jobs is empty and
    // every assertion below would pass without proving anything. This was
    // measured: without this POST the run answers
    // "Version must be confirmed before running oc-mirror".
    const confirm = await fetch(`${baseUrl}/api/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        _schemaVersion: 3,
        version: {
          _schemaVersion: 3, selectedMinor: '4.22', selectedPatch: '4.22.16',
          selectedChannel: 'stable-4.22', selectedVersion: '4.22.16', locked: true
        },
        release: { channel: '4.22', patchVersion: '4.22.16', confirmed: true }
      })
    });
    assert.strictEqual(confirm.status, 200, 'fixture: state must be accepted');

    const run = await fetch(`${baseUrl}/api/ocmirror/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'mirrorToDisk',
        dryRun: true,
        archiveDir: path.join(DATA_DIR, 'archive'),
        rhAuthSource: 'inline',
        rhPullSecret: JSON.stringify({
          auths: { 'registry.redhat.io': { auth: BODY_CANARY } }
        }),
        imageSetConfig: 'kind: ImageSetConfiguration\n'
      })
    });
    assert.strictEqual(run.status, 200, 'fixture: the run must be accepted');
    const { jobId } = await run.json();
    assert.ok(jobId, 'fixture: a job must exist for this test to mean anything');

    // Let the job row and its metadata actually be written.
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const listed = await (await fetch(`${baseUrl}/api/jobs`)).text();
    assert.ok(listed.includes(jobId), 'fixture: the job must be listed');
    assert.ok(!listed.includes(BODY_CANARY),
      'GET /api/jobs served back a pull secret the operator typed');

    const one = await (await fetch(`${baseUrl}/api/jobs/${jobId}`)).text();
    assert.ok(!one.includes(BODY_CANARY),
      'GET /api/jobs/:id served back a pull secret the operator typed');

    // Stop the child so it does not outlive the test.
    await fetch(`${baseUrl}/api/jobs/${jobId}/stop`, { method: 'POST' }).catch(() => {});
  });
});
