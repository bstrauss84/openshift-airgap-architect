/**
 * The mounted Red Hat pull secret must never be readable over HTTP.
 *
 * GET /api/secrets/rh-pull-secret/content used to return the operator's full
 * pull secret to any caller. The backend has no authentication on any route,
 * and the shipped OpenShift overlay publishes it on an edge-TLS Route with no
 * auth, so anyone who could reach that Route could read the cluster's pull
 * secret. Compose binds 127.0.0.1 and was contained; the Route was not.
 *
 * These tests are only meaningful with a secret actually mounted — against an
 * unmounted backend the old endpoint answered 404 and every assertion here
 * would pass vacuously. So a synthetic secret carrying a unique canary is
 * mounted via PULL_SECRET_FILE BEFORE importing the app, and the canary is
 * then hunted across the response surface. detectMountedPullSecret() runs at
 * module load, which is why the ordering below matters and why this file
 * cannot share a process-level import with a test that leaves it unset.
 *
 * The canary is generated at runtime and never written to tracked source: a
 * credential-shaped literal in the repository is itself a finding.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CANARY = `OAA_SYNTH_CANARY_MOUNTEDPULL_${crypto.randomBytes(9).toString('hex').toUpperCase()}`;

const MOUNT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'oaa-mounted-secret-'));
const MOUNT_PATH = path.join(MOUNT_DIR, 'pull-secret.json');
fs.writeFileSync(MOUNT_PATH, JSON.stringify({
  auths: { 'registry.redhat.io': { auth: CANARY, email: 'canary@example.invalid' } }
}));

process.env.PULL_SECRET_FILE = MOUNT_PATH;
if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test';
if (!process.env.DATA_DIR) {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'oaa-mounted-secret-data-'));
}

const { app } = await import('../src/index.js');
const { createTestServer, closeTestServer } = await import('./helpers/httpServerLifecycle.js');

describe('mounted Red Hat pull secret is never disclosed over HTTP', () => {
  let server, baseUrl;

  before(async () => { ({ server, baseUrl } = await createTestServer(app)); });
  after(async () => {
    await closeTestServer(server);
    fs.rmSync(MOUNT_DIR, { recursive: true, force: true });
  });

  it('has actually mounted the secret, so the rest of this file is not vacuous', async () => {
    const res = await fetch(`${baseUrl}/api/secrets/rh-pull-secret`);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { available: true },
      'fixture did not mount — every disclosure assertion below would be vacuous');
  });

  it('refuses to return the raw secret to an unauthenticated caller', async () => {
    const res = await fetch(`${baseUrl}/api/secrets/rh-pull-secret/content`);
    assert.strictEqual(res.status, 410);
    const body = await res.text();
    assert.ok(!body.includes(CANARY), 'the raw pull secret leaked in the response body');
    assert.strictEqual(JSON.parse(body).code, 'ENDPOINT_WITHDRAWN');
  });

  it('refuses on every method that reaches the route, not only GET', async () => {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await fetch(`${baseUrl}/api/secrets/rh-pull-secret/content`, { method });
      assert.strictEqual(res.status, 410, `${method} must not disclose`);
      assert.ok(!(await res.text()).includes(CANARY), `${method} leaked the secret`);
    }
  });

  it('answers OPTIONS from the CORS layer and still discloses nothing', async () => {
    // Not 410: app.use(cors()) terminates the preflight before this route is
    // reached. Harmless — a preflight has no body — but the docs claimed
    // "410 on every verb", so the real behaviour is pinned here.
    const res = await fetch(`${baseUrl}/api/secrets/rh-pull-secret/content`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://example.invalid', 'Access-Control-Request-Method': 'GET' }
    });
    assert.strictEqual(res.status, 204);
    assert.ok(!(await res.text()).includes(CANARY), 'preflight leaked the secret');
  });

  it('still reports availability without revealing anything about the secret', async () => {
    // The non-sensitive indication is deliberately preserved: the UI needs to
    // tell the operator a mounted secret exists. It must carry the boolean and
    // nothing else — no length, no registry names, no fingerprint.
    const res = await fetch(`${baseUrl}/api/secrets/rh-pull-secret`);
    const body = await res.text();
    assert.ok(!body.includes(CANARY), 'availability probe leaked the secret');
    assert.deepStrictEqual(Object.keys(JSON.parse(body)), ['available'],
      'availability probe must expose exactly one field');
  });

  it('does not leak the secret through persisted state', async () => {
    // The mounted secret is server-side only and must never be reflected into
    // the state document the client can read back.
    const res = await fetch(`${baseUrl}/api/state`);
    assert.ok(!(await res.text()).includes(CANARY), 'mounted secret reached /api/state');
  });
});
