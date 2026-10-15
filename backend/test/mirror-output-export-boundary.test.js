/**
 * The mirror-output export boundary must be a real filesystem boundary.
 *
 * POST /api/bundle.zip archives `mirrorWorkflow.archivePath` (or
 * `.outputPath`) from the caller-supplied state. The first fix for this used
 * a LEXICAL check — path.resolve plus a string-prefix test against the
 * allowed roots, plus a blacklist of four exact credential filenames. That is
 * not a filesystem boundary:
 *
 *   - path.resolve does not resolve symlinks, so a link that merely LOOKS
 *     like it is inside an allowed root passes the check and archiver then
 *     follows it to wherever it actually points;
 *   - the same is true of a symlinked PARENT directory;
 *   - a four-name blacklist says nothing about the thousands of other ways a
 *     credential can be named inside an otherwise eligible directory.
 *
 * Every test here drives the real HTTP endpoint and inspects the bytes that
 * come back, because a guard helper returning false proves nothing about what
 * the response actually contains.
 *
 * Canaries are generated at runtime and never written to tracked source: a
 * realistic credential-shaped literal in the repository is itself a finding.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test';
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'oaa-mirror-bound-data-'));
process.env.DATA_DIR = DATA_DIR;

/** Somewhere an export must never reach. Deliberately outside DATA_DIR. */
const OUTSIDE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'oaa-mirror-bound-outside-'));

const canary = (cls) =>
  `OAA_SYNTH_CANARY_${cls}_${crypto.randomBytes(9).toString('hex').toUpperCase()}`;

const C = {
  OUTSIDE: canary('OUTSIDE'),
  PARENT: canary('PARENTLINK'),
  NESTED: canary('NESTEDCRED'),
  LEGIT: canary('LEGITOUTPUT')
};

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
    platform: 'Bare Metal', arch: 'x86_64', clusterName: 'mirror-bound',
    baseDomain: 'example.com', confirmed: true
  },
  methodology: { method: 'Agent-Based Installer' },
  credentials: { sshPublicKey: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAB bound@test' },
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

describe('mirror-output export cannot escape the allowed roots', () => {
  let server, baseUrl;

  const post = async (mirrorWorkflow) => {
    const state = baseState();
    state.mirrorWorkflow = mirrorWorkflow;
    const res = await fetch(`${baseUrl}/api/bundle.zip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state })
    });
    return { res, body: Buffer.from(await res.arrayBuffer()) };
  };

  before(async () => {
    ({ server, baseUrl } = await createTestServer(app));

    // A legitimate, generated-looking mirror output directory.
    const legit = path.join(DATA_DIR, 'oc-mirror', 'archives');
    fs.mkdirSync(legit, { recursive: true });
    fs.writeFileSync(path.join(legit, 'mirror_seq1_000000.tar'), `tar bytes ${C.LEGIT}\n`);

    // Secret material living outside the allowed roots.
    fs.writeFileSync(path.join(OUTSIDE_DIR, 'stolen.txt'), `${C.OUTSIDE}\n`);

    // (a) a symlink that is LEXICALLY inside an allowed directory but points out.
    fs.symlinkSync(OUTSIDE_DIR, path.join(DATA_DIR, 'oc-mirror', 'escape'));

    // (b) a symlinked PARENT: the whole directory is a link to outside.
    const parentOutside = fs.mkdtempSync(path.join(os.tmpdir(), 'oaa-mirror-bound-parent-'));
    fs.writeFileSync(path.join(parentOutside, 'parent-secret.txt'), `${C.PARENT}\n`);
    fs.symlinkSync(parentOutside, path.join(DATA_DIR, 'linked-output'));

    // (c) a credential nested inside an otherwise eligible directory, under a
    //     name the original four-entry blacklist never knew about.
    const nested = path.join(DATA_DIR, 'oc-mirror', 'with-nested-cred');
    fs.mkdirSync(path.join(nested, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(nested, 'mirror_seq1_000000.tar'), 'tar bytes\n');
    fs.writeFileSync(path.join(nested, 'sub', 'auth.json'), `{"auths":{"x":{"auth":"${C.NESTED}"}}}\n`);
  });

  after(async () => {
    await closeTestServer(server);
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.rmSync(OUTSIDE_DIR, { recursive: true, force: true });
  });

  it('refuses a symlink inside an allowed directory that points outside', async () => {
    const { res, body } = await post({
      includeInExport: true,
      archivePath: path.join(DATA_DIR, 'oc-mirror', 'escape')
    });
    assert.ok(!body.includes(C.OUTSIDE), 'content outside the allowed roots was exported');
    assert.ok(!body.includes('stolen.txt'), 'an outside filename was exported');
    assert.ok(res.status >= 400, `unsafe path must be rejected, got ${res.status}`);
  });

  it('refuses a symlinked parent directory', async () => {
    const { res, body } = await post({
      includeInExport: true,
      archivePath: path.join(DATA_DIR, 'linked-output')
    });
    assert.ok(!body.includes(C.PARENT), 'a symlinked parent exported outside content');
    assert.ok(res.status >= 400, `unsafe path must be rejected, got ${res.status}`);
  });

  it('refuses a directory holding a credential file the blacklist never named', async () => {
    const { res, body } = await post({
      includeInExport: true,
      archivePath: path.join(DATA_DIR, 'oc-mirror', 'with-nested-cred')
    });
    assert.ok(!body.includes(C.NESTED), 'a nested credential file was exported');
    assert.ok(res.status >= 400, `a directory containing credentials must be rejected, got ${res.status}`);
  });

  it('applies the same boundary to the alternate outputPath field', async () => {
    const { res, body } = await post({
      includeInExport: true,
      outputPath: path.join(DATA_DIR, 'oc-mirror', 'escape')
    });
    assert.ok(!body.includes(C.OUTSIDE), 'outputPath bypassed the boundary');
    assert.ok(res.status >= 400, `unsafe outputPath must be rejected, got ${res.status}`);
  });

  it('refuses an absolute path far outside the roots', async () => {
    const { res, body } = await post({ includeInExport: true, archivePath: OUTSIDE_DIR });
    assert.ok(!body.includes(C.OUTSIDE), 'an outside absolute path was exported');
    assert.ok(res.status >= 400, `outside path must be rejected, got ${res.status}`);
  });

  it('still exports a legitimate generated mirror-output directory', async () => {
    // The non-vacuity control. Without this, every assertion above could be
    // satisfied by a guard that simply refuses everything.
    const { res, body } = await post({
      includeInExport: true,
      archivePath: path.join(DATA_DIR, 'oc-mirror', 'archives')
    });
    assert.strictEqual(res.status, 200, 'a legitimate mirror output must still export');
    assert.ok(body.includes('mirror_seq1_000000.tar'),
      'the legitimate archive member must be present in the ZIP');
  });

  it('exports normally when mirror output is not requested', async () => {
    const { res } = await post({ includeInExport: false, archivePath: OUTSIDE_DIR });
    assert.strictEqual(res.status, 200, 'an export without mirror output must be unaffected');
  });
});
