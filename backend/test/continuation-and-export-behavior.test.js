import { test } from "node:test";
import assert from "node:assert";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, buildExportReadinessManifest } from "../src/index.js";

function createTestServer() {
  return new Promise((resolve) => {
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

