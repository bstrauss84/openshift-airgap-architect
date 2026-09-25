/**
 * Import unsupported version boundary tests.
 *
 * Verifies that POST /api/run/import rejects schemaVersion-2 bundles
 * containing unsupported OpenShift versions (e.g. 4.22) with HTTP 422
 * and the UNSUPPORTED_VERSION error contract, while accepting supported
 * versions (4.20, 4.21).
 *
 * Uses hermetic test server pattern with isolated DATA_DIR.
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { closeTestServer } from "./helpers/httpServerLifecycle.js";

const TEST_DATA_DIR = path.join(
  process.env.TMPDIR || "/tmp",
  `airgap-import-unsupported-${Date.now()}-${process.pid}`
);

let testServer = null;
let baseUrl = null;
let originalDataDir = null;
let originalNodeEnv = null;

function makeLegacyV2Bundle(channel, patchVersion) {
  return {
    schemaVersion: 2,
    state: {
      blueprint: {
        arch: "x86_64",
        platform: "Bare Metal",
        clusterName: "test-cluster",
        baseDomain: "example.com",
        confirmed: true,
      },
      release: {
        channel,
        patchVersion,
        confirmed: true,
      },
      version: {
        selectedChannel: `stable-${channel}`,
        selectedVersion: patchVersion,
      },
      methodology: { method: "Agent-Based Installer" },
      credentials: {
        pullSecretPlaceholder: '{"auths":{"quay.io":{}}}',
        sshPublicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI test",
      },
      platformConfig: {},
      globalStrategy: { networking: {} },
      hostInventory: { nodes: [], schemaVersion: 2 },
      operators: { selected: [] },
      trust: {},
      ui: { segmentedFlowV1: true },
    },
  };
}

async function postImport(bundle) {
  const response = await fetch(`${baseUrl}/api/run/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bundle),
  });
  const body = await response.json();
  return { status: response.status, ok: response.ok, body };
}

describe("POST /api/run/import unsupported version boundary", () => {
  before(async () => {
    originalDataDir = process.env.DATA_DIR;
    originalNodeEnv = process.env.NODE_ENV;
    process.env.DATA_DIR = TEST_DATA_DIR;
    process.env.NODE_ENV = "test";
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true });

    const { app } = await import("../src/index.js");
    const { createTestServer: create } = await import(
      "./helpers/httpServerLifecycle.js"
    );
    const result = await create(app);
    testServer = result.server;
    baseUrl = result.baseUrl;
  });

  after(async () => {
    await closeTestServer(testServer);
    process.env.DATA_DIR = originalDataDir || "";
    process.env.NODE_ENV = originalNodeEnv || "";
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  test("schemaVersion-2 bundle with OCP 4.22 returns 422 UNSUPPORTED_VERSION", async () => {
    const bundle = makeLegacyV2Bundle("4.22", "4.22.9");
    const result = await postImport(bundle);

    assert.equal(result.status, 422, "Expected HTTP 422");
    assert.equal(result.body.code, "UNSUPPORTED_VERSION");
    assert.equal(result.body.requestedVersion, "4.22");
    assert.ok(
      Array.isArray(result.body.supportedVersions),
      "supportedVersions must be an array"
    );
    assert.ok(
      result.body.supportedVersions.includes("4.20"),
      "supportedVersions must include 4.20"
    );
    assert.ok(
      result.body.supportedVersions.includes("4.21"),
      "supportedVersions must include 4.21"
    );
  });

  test("schemaVersion-2 bundle with OCP 4.99 returns 422 UNSUPPORTED_VERSION", async () => {
    const bundle = makeLegacyV2Bundle("4.99", "4.99.1");
    const result = await postImport(bundle);

    assert.equal(result.status, 422);
    assert.equal(result.body.code, "UNSUPPORTED_VERSION");
    assert.equal(result.body.requestedVersion, "4.99");
  });

  test("schemaVersion-2 bundle with OCP 4.20 succeeds", async () => {
    const bundle = makeLegacyV2Bundle("4.20", "4.20.8");
    const result = await postImport(bundle);

    assert.equal(result.status, 200, "Expected HTTP 200 for supported version");
    assert.equal(result.body.ok, true);
    assert.ok(result.body.state, "Response must include migrated state");
    assert.equal(result.body.migrated, true, "v2 bundle should indicate migration");
  });

  test("schemaVersion-2 bundle with OCP 4.21 succeeds", async () => {
    const bundle = makeLegacyV2Bundle("4.21", "4.21.5");
    const result = await postImport(bundle);

    assert.equal(result.status, 200, "Expected HTTP 200 for supported version");
    assert.equal(result.body.ok, true);
  });

  test("rejected 4.22 import does not persist as current state", async () => {
    // First set a known good state
    const goodBundle = makeLegacyV2Bundle("4.20", "4.20.8");
    await postImport(goodBundle);

    // Attempt bad import
    const badBundle = makeLegacyV2Bundle("4.22", "4.22.9");
    const badResult = await postImport(badBundle);
    assert.equal(badResult.status, 422);

    // Verify current state is still the good one
    const getResponse = await fetch(`${baseUrl}/api/state`);
    const currentState = await getResponse.json();
    assert.equal(
      currentState.version?.selectedMinor,
      "4.20",
      "Current state must still be 4.20 after rejected 4.22 import"
    );
  });
});
