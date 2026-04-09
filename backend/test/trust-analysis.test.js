import { test } from "node:test";
import assert from "node:assert";
import http from "node:http";
import { app } from "../src/index.js";

function createTestServer() {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

const TEST_CA_PEM = `-----BEGIN CERTIFICATE-----
MIIB2zCCAXGgAwIBAgIUUhR5wAiV3f2t7X4yD9WQ0Kd9w4YwCgYIKoZIzj0EAwIw
EzERMA8GA1UEAwwIdGVzdC1yb290MB4XDTI0MDEwMTAwMDAwMFoXDTM0MDEwMTAw
MDAwMFowEzERMA8GA1UEAwwIdGVzdC1yb290MFkwEwYHKoZIzj0CAQYIKoZIzj0D
AQcDQgAEW7d+bwB5nQ2r0+0Qv6y8Q4+8lQb8bE3oR8mR6X2Bf3IYf6J8mGd6x3QJ
P5mJ8UeKQHk2O5Gq9s2lXw2h8TQm8KNTMFEwHQYDVR0OBBYEFK7v5HfQ6wQx4FQp
0n8jYJc4Vw2KMB8GA1UdIwQYMBaAFK7v5HfQ6wQx4FQp0n8jYJc4Vw2KMA8GA1Ud
EwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDSAAwRQIhAK4x7V3GgXoY7qA4G2WjQJrN
9q7I7w5g7A7m4f8VQ2xEAiB8v3fWq6Q4xj8T7d8vD6m9Y5v4qQ6V5r2Qb8a5m6zQ
aw==
-----END CERTIFICATE-----`;

test("POST /api/trust/analyze returns analysis payload", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const state = {
      trust: {
        mirrorRegistryCaPem: TEST_CA_PEM,
        proxyCaPem: "",
        additionalTrustBundlePolicy: "Always"
      },
      globalStrategy: {
        fips: true,
        mirroring: { registryFqdn: "registry.local:5000", sources: [] },
        proxies: { httpProxy: "", httpsProxy: "" }
      }
    };
    const res = await fetch(`${baseUrl}/api/trust/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.analysis);
    assert.ok(data.analysis.analysisHash);
    assert.ok(data.triggerDefaults);
    assert.ok(data.analysis.currentSelectionSummary);
    assert.ok(Array.isArray(data.analysis.certs));
  } finally {
    server.close();
  }
});

test("POST /api/trust/analyze verify if ca bundle value exceeds documented and API restricted length & size", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const state = {
      trust: {
        mirrorRegistryCaPem: TEST_CA_PEM,
        proxyCaPem: "",
        additionalTrustBundlePolicy: "Always",
        bundleSelectionMode: "reduced",
        reducedSelection: {
          analysisHash: "placeholder-hash",
          selectedCertFingerprints: [],
          userModified: true
        }
      },
      globalStrategy: {
        fips: false,
        mirroring: { registryFqdn: "registry.local:5000", sources: [] },
        proxies: { httpProxy: "", httpsProxy: "" }
      }
    };
    const res = await fetch(`${baseUrl}/api/trust/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.analysis.currentSelectionSummary);
    assert.ok(data.analysis.currentSelectionSummary.thresholds);
    assert.ok(["within_recommended", "caution_exceeded", "hard_max_exceeded"].includes(data.analysis.currentSelectionSummary.thresholdBand));
  } finally {
    server.close();
  }
});

test("POST /api/generate rejects stale reduced trust selection", async () => {
  const { server, baseUrl } = await createTestServer();
  try {
    const state = {
      blueprint: { platform: "Bare Metal", baseDomain: "example.com", clusterName: "test", version: "4.20.0" },
      release: { channel: "4.20", patchVersion: "4.20.0", confirmed: true },
      version: { versionConfirmed: true, selectedVersion: "4.20.0" },
      methodology: { method: "Agent-Based Installer" },
      globalStrategy: {
        fips: false,
        proxyEnabled: false,
        proxies: { httpProxy: "", httpsProxy: "", noProxy: "" },
        mirroring: { registryFqdn: "registry.local:5000", sources: [] },
        networking: {}
      },
      hostInventory: { nodes: [] },
      credentials: { pullSecretPlaceholder: "{\"auths\":{}}", sshPublicKey: "" },
      trust: {
        mirrorRegistryCaPem: TEST_CA_PEM,
        proxyCaPem: "",
        additionalTrustBundlePolicy: "Always",
        bundleSelectionMode: "reduced",
        reducedSelection: {
          analysisHash: "stale-hash",
          selectedCertFingerprints: ["deadbeef"]
        }
      }
    };
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state })
    });
    assert.strictEqual(res.status, 409);
    const data = await res.json();
    assert.strictEqual(data.code, "TRUST_ANALYSIS_HASH_MISMATCH");
    assert.strictEqual(data.analysisHashMismatch, true);
  } finally {
    server.close();
  }
});

