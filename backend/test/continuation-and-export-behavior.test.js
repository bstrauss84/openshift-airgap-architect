import { test } from "node:test";
import assert from "node:assert";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, buildExportReadinessManifest, resetStateForTests } from "../src/index.js";

function createTestServer() {
  return new Promise((resolve) => {
    resetStateForTests();
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

test("import defaults to continuation mode with locks", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const payload = {
      schemaVersion: 2,
      sourceProfile: "connected-authoring",
      state: {
        runId: "imported-run",
        release: { channel: "stable-4.20", patchVersion: "4.20.12", confirmed: true },
        version: { versionConfirmed: true },
        operators: {
          version: "stable-4.20",
          catalogs: { redhat: [], certified: [], community: [] },
          selected: [{ id: "redhat:openshift-gitops-operator", name: "openshift-gitops-operator" }]
        }
      }
    };
    const res = await fetch(`${baseUrl}/api/run/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.state?.continuation?.mode, "continue-imported");
    assert.strictEqual(body.state?.continuation?.locks?.releaseMinor, true);
    assert.strictEqual(body.state?.continuation?.locks?.operatorSelections, true);
    assert.strictEqual(body.state?.statusModel?.continuationLocked, true);
  } finally {
    server.close();
  }
});

test("start-over on imported run preserves caches and unlocks continuation", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const importPayload = {
      schemaVersion: 2,
      sourceProfile: "connected-authoring",
      state: {
        release: { channel: "stable-4.20", patchVersion: "4.20.12", confirmed: true },
        version: { versionConfirmed: true },
        docs: { links: [{ id: "mirror-v2", url: "https://docs.redhat.com/example", validated: true }] },
        operators: {
          version: "stable-4.20",
          catalogs: { redhat: [{ id: "redhat:foo", name: "foo" }], certified: [], community: [] },
          selected: [{ id: "redhat:foo", name: "foo" }]
        }
      }
    };
    await fetch(`${baseUrl}/api/run/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(importPayload)
    });
    const resetRes = await fetch(`${baseUrl}/api/start-over`, { method: "POST" });
    assert.strictEqual(resetRes.status, 200);
    const reset = await resetRes.json();
    assert.strictEqual(reset.continuation?.importedRun, true);
    assert.strictEqual(reset.continuation?.mode, "start-over-from-import");
    assert.strictEqual(reset.continuation?.locks?.releaseMinor, false);
    assert.ok(Array.isArray(reset.docs?.links));
    assert.ok(reset.docs.links.length > 0);
    assert.ok(Array.isArray(reset.operators?.catalogs?.redhat));
    assert.ok(reset.operators.catalogs.redhat.length > 0);
    assert.deepStrictEqual(reset.operators?.selected || [], []);
  } finally {
    server.close();
  }
});

test("state updates reject locked continuation fields", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const importRes = await fetch(`${baseUrl}/api/run/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 2,
        sourceProfile: "connected-authoring",
        state: {
          release: { channel: "stable-4.20", patchVersion: "4.20.12", confirmed: true },
          version: { versionConfirmed: true },
          operators: { selected: [{ id: "redhat:foo", name: "foo" }] }
        }
      })
    });
    assert.strictEqual(importRes.status, 200);
    const imported = await importRes.json();
    assert.strictEqual(imported.state?.continuation?.locks?.releaseMinor, true);
    const releaseChange = await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ release: { channel: "stable-4.19" } })
    });
    assert.strictEqual(releaseChange.status, 409);
    const opChange = await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operators: { selected: [] } })
    });
    assert.strictEqual(opChange.status, 409);
  } finally {
    server.close();
  }
});

test("start-over imported run enables release change but marks operator cache scope mismatch", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    await fetch(`${baseUrl}/api/run/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 2,
        sourceProfile: "connected-authoring",
        state: {
          release: { channel: "stable-4.20", patchVersion: "4.20.12", confirmed: true },
          version: { versionConfirmed: true },
          operators: { version: "stable-4.20", selected: [] }
        }
      })
    });
    await fetch(`${baseUrl}/api/start-over`, { method: "POST" });
    const changeRes = await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ release: { channel: "stable-4.19" } })
    });
    assert.strictEqual(changeRes.status, 200);
    const body = await changeRes.json();
    assert.strictEqual(body.operators?.cacheScopeMismatch, true);
    assert.strictEqual(body.statusModel?.cacheLimited, true);
  } finally {
    server.close();
  }
});

test("bundle export does not include mirror-output directory even when includeInExport is set", async () => {
  const { server, baseUrl } = await createTestServer();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-output-test-"));
  const mirrorDir = path.join(tempRoot, "mirror-output");
  fs.mkdirSync(mirrorDir, { recursive: true });
  fs.writeFileSync(path.join(mirrorDir, "file.txt"), "mirror payload");
  try {
    const state = {
      version: { versionConfirmed: true },
      release: { channel: "stable-4.20", patchVersion: "4.20.12", confirmed: true },
      mirrorWorkflow: { includeInExport: true, archivePath: mirrorDir },
      exportOptions: { includeClientTools: false, includeInstaller: false, includeCertificates: false }
    };
    const res = await fetch(`${baseUrl}/api/bundle.zip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state })
    });
    assert.strictEqual(res.status, 200);
    const bytes = Buffer.from(await res.arrayBuffer());
    const text = bytes.toString("latin1");
    assert.match(text, /mirror-output\/MIRROR_OUTPUT_NOT_INCLUDED\.txt/);
    assert.doesNotMatch(text, /mirror-output\/file\.txt/);
  } finally {
    server.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("installer target host OS family validation surfaces error artifact for unsupported values", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const state = {
      version: { versionConfirmed: true },
      release: { channel: "stable-4.20", patchVersion: "4.20.12", confirmed: true },
      exportOptions: {
        includeClientTools: false,
        includeInstaller: true,
        installerTargetArch: "x86_64",
        installerTargetHostOsFamily: "ubuntu",
        installerTargetFipsRequired: true
      }
    };
    const res = await fetch(`${baseUrl}/api/bundle.zip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state })
    });
    assert.strictEqual(res.status, 200);
    const bytes = Buffer.from(await res.arrayBuffer());
    const text = bytes.toString("latin1");
    assert.match(text, /tools\/openshift-install\.ERROR\.txt/);
  } finally {
    server.close();
  }
});

test("readiness manifest reflects installer packaging policy and mirror payload deprecation", async () => {
  const manifest = buildExportReadinessManifest({
    version: { versionConfirmed: true },
    release: { channel: "4.20", patchVersion: "4.20.12", confirmed: true },
    exportOptions: {
      includeInstaller: false,
      includeClientTools: false,
      includeCredentials: false,
      installerTargetHostOsFamily: "rhel9",
      installerTargetArch: "x86_64",
      installerTargetFipsRequired: true
    },
    mirrorWorkflow: { includeInExport: true, archivePath: "/tmp/ignored" },
    operators: { stale: false, catalogs: { redhat: [], certified: [], community: [] } },
    docs: { links: [] },
    blueprint: { confirmed: true }
  });
  assert.strictEqual(manifest.includedTools?.installerPackagingPolicy?.artifactVariantByHostOsOrFips, false);
  assert.strictEqual(manifest.mirrorPayloadNotIncluded, true);
});

test("readiness manifest reports placeholders and review-needed status", async () => {
  const manifest = buildExportReadinessManifest({
    reviewFlags: { review: false },
    hostInventory: {
      nodes: [{ hostname: "__AIRA_PLACEHOLDER__::hostname::id::Node%20hostname" }]
    },
    exportOptions: {
      inclusion: {
        pullSecret: false,
        platformCredentials: false,
        mirrorRegistryCredentials: false,
        bmcCredentials: false,
        trustBundleAndCertificates: true,
        sshPublicKey: true,
        proxyValues: true
      }
    },
    operators: { stale: false, catalogs: { redhat: [], certified: [], community: [] } },
    docs: { links: [] }
  });
  assert.strictEqual(manifest.placeholdersPresent, true);
  assert.ok((manifest.placeholders?.count || 0) >= 1);
  assert.strictEqual(manifest.runStatus?.reviewNeeded, true);
  assert.strictEqual(manifest.runStatus?.finalizable, false);
  assert.strictEqual(manifest.executionReadiness?.executionBlockedByPlaceholders, true);
});

test("readiness manifest reports high-side runtime package request", async () => {
  const manifest = buildExportReadinessManifest({
    exportOptions: {
      includeHighSideRuntimePackage: true,
      includeInstaller: false,
      includeClientTools: false,
      inclusion: {
        pullSecret: false,
        platformCredentials: false,
        mirrorRegistryCredentials: false,
        bmcCredentials: false,
        trustBundleAndCertificates: true,
        sshPublicKey: true,
        proxyValues: true
      }
    },
    operators: { stale: false, catalogs: { redhat: [], certified: [], community: [] } },
    docs: { links: [] }
  });
  assert.strictEqual(manifest.runtimePackageRequested, true);
  assert.strictEqual(manifest.runtimePackageIncluded, true);
  assert.strictEqual(manifest.runtimePackageArtifactStatus, "requested");
  assert.strictEqual(manifest.runtimePackage?.localhostFirst, true);
  assert.deepStrictEqual(manifest.runtimePackage?.hostSupportScope, ["rhel8", "rhel9"]);
});

test("run export strips credential classes by default", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        credentials: {
          pullSecretPlaceholder: "__AIRA_PLACEHOLDER__::pullSecret::id::Pull%20secret",
          mirrorRegistryPullSecret: "{\"auths\":{\"registry.local:5000\":{\"auth\":\"abc\"}}}",
          sshPublicKey: "ssh-ed25519 AAAATEST test@example"
        }
      })
    });
    const res = await fetch(`${baseUrl}/api/run/export`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.state?.credentials?.pullSecretPlaceholder, "{\"auths\":{}}");
    assert.strictEqual(body.state?.credentials?.mirrorRegistryPullSecret || "", "");
    assert.strictEqual(body.state?.credentials?.sshPublicKey, "ssh-ed25519 AAAATEST test@example");
  } finally {
    server.close();
  }
});

test("generate output replaces internal placeholder tokens with visible marker text", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: { versionConfirmed: true },
        release: { channel: "stable-4.20", patchVersion: "4.20.12", confirmed: true },
        globalStrategy: {
          proxyEnabled: true,
          proxies: {
            httpProxy: "__AIRA_PLACEHOLDER__::proxyValue::id::HTTP%20proxy",
            httpsProxy: "",
            noProxy: ""
          }
        }
      })
    });
    const res = await fetch(`${baseUrl}/api/generate`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    const install = String(body.files?.["install-config.yaml"] || "");
    const manual = String(body.files?.["FIELD_MANUAL.md"] || "");
    assert.match(install, /MARK FOR LATER COMPLETION/);
    assert.match(manual, /MARK FOR LATER COMPLETION/);
    assert.doesNotMatch(install, /__AIRA_PLACEHOLDER__/);
    assert.doesNotMatch(manual, /__AIRA_PLACEHOLDER__/);
  } finally {
    server.close();
  }
});

test("bundle export includes high-side runtime package artifacts when requested", async () => {
  const prevMode = process.env.AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE;
  process.env.AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE = "fixture";
  const { server, baseUrl } = await createTestServer();
  try {
    const state = {
      version: { versionConfirmed: true },
      release: { channel: "stable-4.20", patchVersion: "4.20.12", confirmed: true },
      exportOptions: {
        includeHighSideRuntimePackage: true,
        includeClientTools: false,
        includeInstaller: false
      }
    };
    const res = await fetch(`${baseUrl}/api/bundle.zip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state })
    });
    assert.strictEqual(res.status, 200);
    const bytes = Buffer.from(await res.arrayBuffer());
    const text = bytes.toString("latin1");
    assert.match(text, /runtime-package\/HIGH_SIDE_STARTUP_GUIDE\.md/);
    assert.match(text, /runtime-package\/compose\/high-side\.compose\.yml/);
    assert.match(text, /runtime-package\/payloads\/imported-run\.bundle\.json/);
    assert.match(text, /runtime-package\/SHA256SUMS\.txt/);
  } finally {
    if (prevMode == null) delete process.env.AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE;
    else process.env.AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE = prevMode;
    server.close();
  }
});

test("high-side runtime auto-preloads a single bundled payload", async () => {
  const payloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "airgap-preload-"));
  const payloadFile = path.join(payloadDir, "only-payload.json");
  const prevSide = process.env.AIRGAP_RUNTIME_SIDE;
  const prevPayloadDir = process.env.AIRGAP_BUNDLED_PAYLOADS_DIR;
  const prevPreload = process.env.AIRGAP_PRELOAD_ON_START;
  process.env.AIRGAP_RUNTIME_SIDE = "high-side";
  process.env.AIRGAP_BUNDLED_PAYLOADS_DIR = payloadDir;
  process.env.AIRGAP_PRELOAD_ON_START = "true";
  fs.writeFileSync(payloadFile, JSON.stringify({
    schemaVersion: 2,
    sourceProfile: "connected-authoring",
    state: {
      release: { channel: "stable-4.20", patchVersion: "4.20.12", confirmed: true },
      version: { versionConfirmed: true },
      operators: { selected: [] }
    }
  }, null, 2));
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/state`);
    assert.strictEqual(res.status, 200);
    const state = await res.json();
    assert.strictEqual(state.continuation?.importedRun, true);
    assert.strictEqual(state.continuation?.sourceProfile, "bundled-high-side-package");
    assert.strictEqual(state.runtime?.bundledPayloadPreload?.status, "preload-applied");
  } finally {
    if (prevSide == null) delete process.env.AIRGAP_RUNTIME_SIDE;
    else process.env.AIRGAP_RUNTIME_SIDE = prevSide;
    if (prevPayloadDir == null) delete process.env.AIRGAP_BUNDLED_PAYLOADS_DIR;
    else process.env.AIRGAP_BUNDLED_PAYLOADS_DIR = prevPayloadDir;
    if (prevPreload == null) delete process.env.AIRGAP_PRELOAD_ON_START;
    else process.env.AIRGAP_PRELOAD_ON_START = prevPreload;
    fs.rmSync(payloadDir, { recursive: true, force: true });
    server.close();
  }
});

test("high-side preload unreadable payload directory is reported without crashing", async () => {
  const payloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "airgap-preload-unreadable-"));
  const prevSide = process.env.AIRGAP_RUNTIME_SIDE;
  const prevPayloadDir = process.env.AIRGAP_BUNDLED_PAYLOADS_DIR;
  const prevPreload = process.env.AIRGAP_PRELOAD_ON_START;
  process.env.AIRGAP_RUNTIME_SIDE = "high-side";
  process.env.AIRGAP_BUNDLED_PAYLOADS_DIR = payloadDir;
  process.env.AIRGAP_PRELOAD_ON_START = "true";
  fs.chmodSync(payloadDir, 0o000);
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/state`);
    assert.strictEqual(res.status, 200);
    const state = await res.json();
    assert.strictEqual(state.runtime?.bundledPayloadPreload?.status, "preload-error");
    assert.match(String(state.runtime?.bundledPayloadPreload?.details || ""), /Unable to read payload directory/i);
  } finally {
    if (prevSide == null) delete process.env.AIRGAP_RUNTIME_SIDE;
    else process.env.AIRGAP_RUNTIME_SIDE = prevSide;
    if (prevPayloadDir == null) delete process.env.AIRGAP_BUNDLED_PAYLOADS_DIR;
    else process.env.AIRGAP_BUNDLED_PAYLOADS_DIR = prevPayloadDir;
    if (prevPreload == null) delete process.env.AIRGAP_PRELOAD_ON_START;
    else process.env.AIRGAP_PRELOAD_ON_START = prevPreload;
    fs.chmodSync(payloadDir, 0o700);
    fs.rmSync(payloadDir, { recursive: true, force: true });
    server.close();
  }
});

test("state updates canonicalize export inclusion and legacy flags", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        exportOptions: {
          includeCredentials: true,
          includeCertificates: false,
          inclusion: {
            pullSecret: false,
            platformCredentials: false,
            mirrorRegistryCredentials: false,
            bmcCredentials: false,
            trustBundleAndCertificates: true,
            sshPublicKey: true,
            proxyValues: true
          }
        }
      })
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.exportOptions?.inclusion?.pullSecret, false);
    assert.strictEqual(body.exportOptions?.includeCredentials, false);
    assert.strictEqual(body.exportOptions?.inclusion?.trustBundleAndCertificates, true);
    assert.strictEqual(body.exportOptions?.includeCertificates, true);
  } finally {
    server.close();
  }
});

test("state updates force segmented flow and normalize legacy active step ids", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/api/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ui: {
          segmentedFlowV1: false,
          activeStepId: "global",
          visitedSteps: {},
          completedSteps: {}
        }
      })
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ui?.segmentedFlowV1, true);
    assert.strictEqual(body.ui?.activeStepId, "identity-access");
  } finally {
    server.close();
  }
});

test("docs cache provenance is stamped on docs cache read", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const docsRes = await fetch(`${baseUrl}/api/docs`);
    assert.strictEqual(docsRes.status, 200);
    const stateRes = await fetch(`${baseUrl}/api/state`);
    assert.strictEqual(stateRes.status, 200);
    const state = await stateRes.json();
    assert.ok(state.cacheProvenance?.docsMetadata?.timestamp);
    assert.ok(["cached", "imported"].includes(state.cacheProvenance?.docsMetadata?.source));
  } finally {
    server.close();
  }
});

