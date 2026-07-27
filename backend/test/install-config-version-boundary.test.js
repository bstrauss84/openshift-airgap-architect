/**
 * Install-config Version Boundary Tests
 *
 * DOC-102 Slice 5K Tranche 2A: buildInstallConfig enforces an exact
 * supported-version boundary via assertSupportedOpenShiftMinorForGeneration.
 *
 * Verifies:
 * - Direct buildInstallConfig rejects missing, malformed, and unsupported versions
 * - Direct buildInstallConfig succeeds for 4.20 and 4.21
 * - No fallback to 4.20 for missing or malformed versions
 * - No partial YAML returned on rejection
 * - SUPPORTED_MINORS is the sole authority
 * - HTTP routes return structured 422 for missing and malformed versions
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import http from "node:http";
import { buildInstallConfig } from "../src/generate.js";
import { assertSupportedOpenShiftMinorForGeneration, SUPPORTED_MINORS, isSupportedMinor } from "../src/versionPolicy.js";
import { app } from "../src/index.js";

const makeState = (versionOverrides = {}) => ({
  version: {
    _schemaVersion: 3,
    selectedMinor: "4.20",
    selectedPatch: "4.20.8",
    locked: true,
    ...versionOverrides.version,
  },
  release: {
    channel: "4.20",
    patchVersion: "4.20.8",
    confirmed: true,
    ...versionOverrides.release,
  },
  blueprint: {
    platform: "Bare Metal",
    arch: "x86_64",
    clusterName: "test-cluster",
    baseDomain: "example.com",
    confirmed: true,
  },
  methodology: { method: "Agent-Based Installer" },
  credentials: { sshPublicKey: "ssh-rsa test" },
  globalStrategy: {
    networking: {
      networkType: "OVNKubernetes",
      machineNetworkV4: "192.168.1.0/24",
      clusterNetworkCidr: "10.128.0.0/14",
      clusterNetworkHostPrefix: 23,
      serviceNetworkCidr: "172.30.0.0/16",
    },
    mirroring: {
      registryFqdn: "registry.local:5000",
      sources: [],
    },
  },
  hostInventory: { nodes: [] },
  exportOptions: { includeCredentials: false },
});

function createTestServer() {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

// ===================================================================
// assertSupportedOpenShiftMinorForGeneration - direct unit tests
// ===================================================================

describe("assertSupportedOpenShiftMinorForGeneration", () => {
  it("returns 4.20 for valid 4.20 state", () => {
    const state = makeState();
    const result = assertSupportedOpenShiftMinorForGeneration(state);
    assert.strictEqual(result, "4.20");
  });

  it("returns 4.21 for valid 4.21 state", () => {
    const state = makeState({
      version: { selectedMinor: "4.21", selectedPatch: "4.21.5" },
      release: { channel: "4.21", patchVersion: "4.21.5" },
    });
    const result = assertSupportedOpenShiftMinorForGeneration(state);
    assert.strictEqual(result, "4.21");
  });

  it("rejects missing version (empty state)", () => {
    assert.throws(
      () => assertSupportedOpenShiftMinorForGeneration({}),
      (err) => {
        assert.strictEqual(err.code, "UNSUPPORTED_VERSION");
        assert.strictEqual(err.requestedVersion, null);
        assert.deepStrictEqual(err.supportedVersions, SUPPORTED_MINORS);
        return true;
      }
    );
  });

  it("rejects null state", () => {
    assert.throws(
      () => assertSupportedOpenShiftMinorForGeneration(null),
      (err) => err.code === "UNSUPPORTED_VERSION" && err.requestedVersion === null
    );
  });

  it("rejects malformed version string", () => {
    const state = makeState({
      version: { selectedMinor: "not-a-version", selectedPatch: null },
      release: { channel: "not-a-version", patchVersion: null },
    });
    assert.throws(
      () => assertSupportedOpenShiftMinorForGeneration(state),
      (err) => err.code === "UNSUPPORTED_VERSION"
    );
  });

  it("rejects unsupported 4.22", () => {
    const state = makeState({
      version: { selectedMinor: "4.22", selectedPatch: "4.22.1" },
      release: { channel: "4.22", patchVersion: "4.22.1" },
    });
    assert.throws(
      () => assertSupportedOpenShiftMinorForGeneration(state),
      (err) => {
        assert.strictEqual(err.code, "UNSUPPORTED_VERSION");
        assert.strictEqual(err.requestedVersion, "4.22");
        assert.deepStrictEqual(err.supportedVersions, SUPPORTED_MINORS);
        return true;
      }
    );
  });

  it("rejects unsupported older 4.19", () => {
    const state = makeState({
      version: { selectedMinor: "4.19", selectedPatch: "4.19.0" },
      release: { channel: "4.19", patchVersion: "4.19.0" },
    });
    assert.throws(
      () => assertSupportedOpenShiftMinorForGeneration(state),
      (err) => err.code === "UNSUPPORTED_VERSION" && err.requestedVersion === "4.19"
    );
  });

  it("rejects unsupported newer 4.23", () => {
    const state = makeState({
      version: { selectedMinor: "4.23", selectedPatch: "4.23.0" },
      release: { channel: "4.23", patchVersion: "4.23.0" },
    });
    assert.throws(
      () => assertSupportedOpenShiftMinorForGeneration(state),
      (err) => err.code === "UNSUPPORTED_VERSION" && err.requestedVersion === "4.23"
    );
  });

  it("includes supported versions list in error", () => {
    assert.throws(
      () => assertSupportedOpenShiftMinorForGeneration({}),
      (err) => {
        assert.ok(err.message.includes("4.20"));
        assert.ok(err.message.includes("4.21"));
        return true;
      }
    );
  });
});

// ===================================================================
// buildInstallConfig - direct version boundary tests
// ===================================================================

describe("buildInstallConfig version boundary", () => {
  it("produces YAML for valid 4.20 state", () => {
    const state = makeState();
    const result = buildInstallConfig(state);
    assert.ok(typeof result === "string");
    assert.ok(result.includes("apiVersion: v1"));
    assert.ok(result.includes("install-config.yaml"));
  });

  it("produces YAML for valid 4.21 state", () => {
    const state = makeState({
      version: { selectedMinor: "4.21", selectedPatch: "4.21.5" },
      release: { channel: "4.21", patchVersion: "4.21.5" },
    });
    const result = buildInstallConfig(state);
    assert.ok(typeof result === "string");
    assert.ok(result.includes("apiVersion: v1"));
  });

  it("rejects missing version - no YAML returned", () => {
    let result;
    assert.throws(() => {
      result = buildInstallConfig({});
    });
    assert.strictEqual(result, undefined);
  });

  it("rejects malformed version - no YAML returned", () => {
    const state = makeState({
      version: { selectedMinor: "garbage", selectedPatch: null },
      release: { channel: "garbage", patchVersion: null },
    });
    let result;
    assert.throws(() => {
      result = buildInstallConfig(state);
    });
    assert.strictEqual(result, undefined);
  });

  it("rejects 4.22 with UNSUPPORTED_VERSION - no YAML returned", () => {
    const state = makeState({
      version: { selectedMinor: "4.22", selectedPatch: "4.22.1" },
      release: { channel: "4.22", patchVersion: "4.22.1" },
    });
    let result;
    assert.throws(
      () => {
        result = buildInstallConfig(state);
      },
      (err) => {
        assert.strictEqual(err.code, "UNSUPPORTED_VERSION");
        assert.strictEqual(err.requestedVersion, "4.22");
        assert.ok(
          err.supportedVersions.includes("4.20") && err.supportedVersions.includes("4.21")
        );
        return true;
      }
    );
    assert.strictEqual(result, undefined);
  });

  it("does not fall back to 4.20 for missing version", () => {
    assert.throws(
      () => buildInstallConfig({}),
      (err) => {
        assert.strictEqual(err.code, "UNSUPPORTED_VERSION");
        assert.strictEqual(err.requestedVersion, null);
        return true;
      }
    );
  });

  it("does not fall back to 4.20 for malformed version", () => {
    const state = makeState({
      version: { selectedMinor: null, selectedPatch: null },
      release: { channel: null, patchVersion: null },
    });
    assert.throws(
      () => buildInstallConfig(state),
      (err) => {
        assert.strictEqual(err.code, "UNSUPPORTED_VERSION");
        assert.strictEqual(err.requestedVersion, null);
        return true;
      }
    );
  });

  it("error is not swallowed or converted to HTTP 500 shape", () => {
    const state = makeState({
      version: { selectedMinor: "4.22", selectedPatch: "4.22.1" },
      release: { channel: "4.22", patchVersion: "4.22.1" },
    });
    try {
      buildInstallConfig(state);
      assert.fail("Should have thrown");
    } catch (err) {
      assert.strictEqual(err.code, "UNSUPPORTED_VERSION");
      assert.ok(Array.isArray(err.supportedVersions));
      assert.ok(err.message.includes("Supported versions"));
    }
  });

  it("SUPPORTED_MINORS is the only authority for supported versions", () => {
    assert.deepStrictEqual(SUPPORTED_MINORS, ["4.20", "4.21"]);
    assert.strictEqual(isSupportedMinor("4.20"), true);
    assert.strictEqual(isSupportedMinor("4.21"), true);
    assert.strictEqual(isSupportedMinor("4.22"), false);
    assert.strictEqual(isSupportedMinor("4.19"), false);
  });

  it("4.20 YAML unchanged by version boundary (byte-equivalent content)", () => {
    const state = makeState();
    const result = buildInstallConfig(state);
    assert.ok(result.includes("baseDomain: example.com"));
    assert.ok(result.includes("name: test-cluster"));
    assert.ok(result.includes("networkType: OVNKubernetes"));
  });

  it("4.21 YAML unchanged by version boundary (byte-equivalent content)", () => {
    const state = makeState({
      version: { selectedMinor: "4.21", selectedPatch: "4.21.5" },
      release: { channel: "4.21", patchVersion: "4.21.5" },
    });
    const result = buildInstallConfig(state);
    assert.ok(result.includes("baseDomain: example.com"));
    assert.ok(result.includes("name: test-cluster"));
  });
});

// ===================================================================
// HTTP boundary tests for missing and malformed versions
// ===================================================================

describe("HTTP install-config generation - missing and malformed version", () => {
  it("POST /api/generate rejects missing version with 422", async () => {
    const { server, baseUrl } = await createTestServer();
    try {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: {
            version: { _schemaVersion: 3, selectedMinor: null, selectedPatch: null, locked: true },
            release: { channel: null, patchVersion: null, confirmed: true },
            blueprint: { platform: "Bare Metal", baseDomain: "example.com", clusterName: "test" },
            methodology: { method: "Agent-Based Installer" },
            hostInventory: { nodes: [] },
          },
        }),
      });
      assert.strictEqual(res.status, 422);
      const body = await res.json();
      assert.strictEqual(body.code, "UNSUPPORTED_VERSION");
      assert.ok(Array.isArray(body.supportedVersions));
    } finally {
      server.close();
    }
  });

  it("POST /api/generate rejects malformed version with 422", async () => {
    const { server, baseUrl } = await createTestServer();
    try {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: {
            version: { _schemaVersion: 3, selectedMinor: "abc", selectedPatch: "xyz", locked: true },
            release: { channel: "abc", patchVersion: "xyz", confirmed: true },
            blueprint: { platform: "Bare Metal", baseDomain: "example.com", clusterName: "test" },
            methodology: { method: "Agent-Based Installer" },
            hostInventory: { nodes: [] },
          },
        }),
      });
      assert.strictEqual(res.status, 422);
      const body = await res.json();
      assert.strictEqual(body.code, "UNSUPPORTED_VERSION");
    } finally {
      server.close();
    }
  });

  it("POST /api/generate rejects 4.22 with 422 and supportedVersions", async () => {
    const { server, baseUrl } = await createTestServer();
    try {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: makeState({
            version: { selectedMinor: "4.22", selectedPatch: "4.22.1" },
            release: { channel: "4.22", patchVersion: "4.22.1" },
          }),
        }),
      });
      assert.strictEqual(res.status, 422);
      const body = await res.json();
      assert.strictEqual(body.code, "UNSUPPORTED_VERSION");
      assert.strictEqual(body.requestedVersion, "4.22");
      assert.ok(body.supportedVersions.includes("4.20"));
      assert.ok(body.supportedVersions.includes("4.21"));
    } finally {
      server.close();
    }
  });

  it("bundle path rejects 4.22 with UNSUPPORTED_VERSION via buildInstallConfig", () => {
    const state = makeState({
      version: { selectedMinor: "4.22", selectedPatch: "4.22.1" },
      release: { channel: "4.22", patchVersion: "4.22.1" },
    });
    assert.throws(
      () => buildInstallConfig(state),
      (err) => err.code === "UNSUPPORTED_VERSION" && err.requestedVersion === "4.22"
    );
  });
});
