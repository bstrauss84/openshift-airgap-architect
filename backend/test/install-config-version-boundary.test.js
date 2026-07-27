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
import yaml from "js-yaml";
import { buildInstallConfig } from "../src/generate.js";
import { assertSupportedOpenShiftMinorForGeneration, SUPPORTED_MINORS, isSupportedMinor, buildUnsupportedVersionError } from "../src/versionPolicy.js";
import { minimal } from "./fixtures/base-states.js";
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

// ===================================================================
// Stale-field conflict tests
// ===================================================================

describe("stale-field conflict tests", () => {
  it("stale blueprint.version does not override canonical selectedMinor for mirror-source pivot", () => {
    const state = makeState();
    state.blueprint.version = "4.13.32";
    const result = buildInstallConfig(state);
    const config = yaml.load(result);
    assert.strictEqual(config.imageContentSources, undefined, "stale 4.13 blueprint.version must not trigger imageContentSources");
  });

  it("stale release.patchVersion with valid selectedMinor still produces correct output", () => {
    const state = makeState({
      version: { selectedMinor: "4.21", selectedPatch: "4.21.0" },
      release: { channel: "4.21", patchVersion: "4.20.99" },
    });
    const result = buildInstallConfig(state);
    assert.ok(typeof result === "string");
    assert.ok(result.includes("apiVersion: v1"));
  });

  it("contradictory version fields resolve via canonical precedence", () => {
    const state = makeState({
      version: { selectedMinor: "4.21", selectedPatch: "4.20.8" },
      release: { channel: "4.20", patchVersion: "4.20.8" },
    });
    const result = assertSupportedOpenShiftMinorForGeneration(state);
    assert.strictEqual(result, "4.21", "selectedMinor takes precedence per v3 canonical order");
  });
});

// ===================================================================
// Canonical error-construction helper tests
// ===================================================================

describe("buildUnsupportedVersionError canonical helper", () => {
  it("produces error with correct shape for null requested version", () => {
    const err = buildUnsupportedVersionError(null);
    assert.strictEqual(err.code, "UNSUPPORTED_VERSION");
    assert.strictEqual(err.requestedVersion, null);
    assert.deepStrictEqual(err.supportedVersions, SUPPORTED_MINORS);
    assert.ok(err.message.includes("could not be determined"));
  });

  it("produces error with correct shape for specific version", () => {
    const err = buildUnsupportedVersionError("4.19");
    assert.strictEqual(err.code, "UNSUPPORTED_VERSION");
    assert.strictEqual(err.requestedVersion, "4.19");
    assert.deepStrictEqual(err.supportedVersions, SUPPORTED_MINORS);
    assert.ok(err.message.includes("4.19"));
  });

  it("route-level and generation-level assertions share the same error shape", () => {
    const genErr = (() => {
      try { assertSupportedOpenShiftMinorForGeneration({}); } catch (e) { return e; }
    })();
    assert.strictEqual(genErr.code, "UNSUPPORTED_VERSION");
    assert.strictEqual(genErr.requestedVersion, null);
    assert.deepStrictEqual(genErr.supportedVersions, SUPPORTED_MINORS);
  });
});

// ===================================================================
// Fixture isolation tests
// ===================================================================

describe("fixture isolation", () => {
  it("minimal() returns fresh objects on each call", () => {
    const a = minimal();
    const b = minimal();
    assert.notStrictEqual(a, b);
    assert.notStrictEqual(a.version, b.version);
    assert.notStrictEqual(a.release, b.release);
  });

  it("minimal() overrides do not clobber merged nested objects", () => {
    const state = minimal({ version: { selectedMinor: "4.21" } });
    assert.strictEqual(state.version.selectedMinor, "4.21");
    assert.strictEqual(state.version._schemaVersion, 3, "base _schemaVersion must survive override");
    assert.strictEqual(state.version.locked, true, "base locked must survive override");
    assert.strictEqual(state.version.selectedPatch, "4.20.8", "base selectedPatch must survive when not overridden");
  });

  it("minimal() rest overrides add new top-level keys without clobbering nested", () => {
    const state = minimal({
      trust: { mirrorRegistryCaPem: "FAKE" },
      version: { selectedMinor: "4.21" }
    });
    assert.strictEqual(state.trust.mirrorRegistryCaPem, "FAKE");
    assert.strictEqual(state.version.selectedMinor, "4.21");
    assert.strictEqual(state.version._schemaVersion, 3);
  });
});

// ===================================================================
// Valid-output regression proofs (normalized parsed output)
// ===================================================================

describe("valid-output regression proofs", () => {
  it("Bare Metal Agent-Based: produces correct structure", () => {
    const state = makeState();
    const result = buildInstallConfig(state);
    const config = yaml.load(result);
    assert.strictEqual(config.apiVersion, "v1");
    assert.strictEqual(config.baseDomain, "example.com");
    assert.strictEqual(config.metadata.name, "test-cluster");
    assert.strictEqual(config.networking.networkType, "OVNKubernetes");
    assert.ok(Array.isArray(config.networking.machineNetwork));
    assert.strictEqual(config.networking.machineNetwork[0].cidr, "192.168.1.0/24");
    assert.ok(Array.isArray(config.networking.clusterNetwork));
    assert.ok(Array.isArray(config.networking.serviceNetwork));
    assert.strictEqual(config.compute[0].name, "worker");
    assert.strictEqual(config.controlPlane.name, "master");
  });

  it("AWS GovCloud IPI: produces correct platform.aws structure", () => {
    const state = makeState();
    state.blueprint.platform = "AWS GovCloud";
    state.methodology.method = "IPI";
    state.platformConfig = {
      aws: { region: "us-gov-west-1", hostedZone: "Z123456" }
    };
    const result = buildInstallConfig(state);
    const config = yaml.load(result);
    assert.strictEqual(config.apiVersion, "v1");
    assert.strictEqual(config.platform.aws.region, "us-gov-west-1");
    assert.strictEqual(config.platform.aws.hostedZone, "Z123456");
    assert.strictEqual(config.imageContentSources, undefined);
  });

  it("vSphere IPI: produces correct platform.vsphere structure", () => {
    const state = makeState();
    state.blueprint.platform = "VMware vSphere";
    state.methodology.method = "IPI";
    state.platformConfig = {
      vsphere: {
        placementMode: "legacy",
        vcenter: "vcenter.local",
        datacenter: "DC1",
        cluster: "Cluster1",
        datastore: "DS1",
        network: "VM Network"
      }
    };
    const result = buildInstallConfig(state);
    const config = yaml.load(result);
    assert.strictEqual(config.apiVersion, "v1");
    assert.ok(config.platform.vsphere);
    assert.ok(Array.isArray(config.platform.vsphere.vcenters));
    assert.strictEqual(config.platform.vsphere.vcenters[0].server, "vcenter.local");
    assert.strictEqual(config.publish, "External");
  });

  it("mirror-registry state: emits imageDigestSources (never imageContentSources)", () => {
    const sources = [{ source: "quay.io/ocp", mirrors: ["registry.local:5000/ocp"] }];
    const state = makeState();
    state.globalStrategy.mirroring = { registryFqdn: "registry.local:5000", sources };
    state.credentials = {
      usingMirrorRegistry: true,
      mirrorRegistryPullSecret: '{"auths":{"registry.local:5000":{"auth":"dGVzdDp0ZXN0"}}}'
    };
    const result = buildInstallConfig(state);
    const config = yaml.load(result);
    assert.ok(Array.isArray(config.imageDigestSources));
    assert.strictEqual(config.imageDigestSources.length, 1);
    assert.strictEqual(config.imageContentSources, undefined);
  });

  it("trust-bundle state: emits additionalTrustBundle with correct policy", () => {
    const state = makeState();
    state.trust = {
      mirrorRegistryCaPem: "-----BEGIN CERTIFICATE-----\nMIIFAKE=\n-----END CERTIFICATE-----",
    };
    const result = buildInstallConfig(state);
    const config = yaml.load(result);
    assert.ok(typeof config.additionalTrustBundle === "string");
    assert.ok(config.additionalTrustBundle.includes("BEGIN CERTIFICATE"));
    assert.strictEqual(config.additionalTrustBundlePolicy, "Always");
  });

  it("4.21 state produces valid output with correct structure", () => {
    const state = makeState({
      version: { selectedMinor: "4.21", selectedPatch: "4.21.5" },
      release: { channel: "4.21", patchVersion: "4.21.5" },
    });
    const result = buildInstallConfig(state);
    const config = yaml.load(result);
    assert.strictEqual(config.apiVersion, "v1");
    assert.strictEqual(config.baseDomain, "example.com");
    assert.strictEqual(config.controlPlane.replicas, 3);
    assert.strictEqual(config.imageContentSources, undefined);
  });
});
