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
// Correction B: Parameterized mirror behavior tests
// ===================================================================

describe("mirror-source pivot: imageDigestSources only", () => {
  const mirrorSources = [{ source: "quay.io/ocp", mirrors: ["registry.local:5000/ocp"] }];

  for (const minor of ["4.20", "4.21"]) {
    it(`${minor} emits imageDigestSources, never imageContentSources`, () => {
      const state = makeState({
        version: { selectedMinor: minor, selectedPatch: `${minor}.8` },
        release: { channel: minor, patchVersion: `${minor}.8` },
      });
      state.globalStrategy.mirroring = { registryFqdn: "registry.local:5000", sources: mirrorSources };
      state.credentials = {
        usingMirrorRegistry: true,
        mirrorRegistryPullSecret: '{"auths":{"registry.local:5000":{"auth":"dGVzdDp0ZXN0"}}}',
      };
      const config = yaml.load(buildInstallConfig(state));
      assert.ok(Array.isArray(config.imageDigestSources), `${minor}: imageDigestSources must be array`);
      assert.strictEqual(config.imageDigestSources.length, 1);
      assert.deepStrictEqual(config.imageDigestSources[0], mirrorSources[0]);
      assert.strictEqual(config.imageContentSources, undefined, `${minor}: imageContentSources must be absent`);
    });
  }

  it("stale blueprint.version 4.13.32 does not trigger imageContentSources", () => {
    const state = makeState();
    state.blueprint.version = "4.13.32";
    state.globalStrategy.mirroring = { registryFqdn: "registry.local:5000", sources: mirrorSources };
    state.credentials = {
      usingMirrorRegistry: true,
      mirrorRegistryPullSecret: '{"auths":{"registry.local:5000":{"auth":"dGVzdDp0ZXN0"}}}',
    };
    const config = yaml.load(buildInstallConfig(state));
    assert.ok(Array.isArray(config.imageDigestSources));
    assert.strictEqual(config.imageContentSources, undefined, "stale 4.13 must not trigger imageContentSources");
  });

  it("4.21 with stale blueprint.version 4.13.32 emits imageDigestSources", () => {
    const state = makeState({
      version: { selectedMinor: "4.21", selectedPatch: "4.21.5" },
      release: { channel: "4.21", patchVersion: "4.21.5" },
    });
    state.blueprint.version = "4.13.32";
    state.globalStrategy.mirroring = { registryFqdn: "registry.local:5000", sources: mirrorSources };
    state.credentials = {
      usingMirrorRegistry: true,
      mirrorRegistryPullSecret: '{"auths":{"registry.local:5000":{"auth":"dGVzdDp0ZXN0"}}}',
    };
    const config = yaml.load(buildInstallConfig(state));
    assert.ok(Array.isArray(config.imageDigestSources));
    assert.strictEqual(config.imageContentSources, undefined);
  });
});

// ===================================================================
// Correction C: Trust-bundle policy canonical minor proof
// ===================================================================

describe("trust-bundle policy uses canonical minor", () => {
  const certPem = (label) => `-----BEGIN CERTIFICATE-----\n${label}\n-----END CERTIFICATE-----`;

  it("4.20 trust-bundle config has correct policy via canonical minor", () => {
    const state = makeState();
    state.trust = { mirrorRegistryCaPem: certPem("TESTCERT420") };
    const config = yaml.load(buildInstallConfig(state));
    assert.strictEqual(config.additionalTrustBundlePolicy, "Always");
    assert.ok(config.additionalTrustBundle.includes("TESTCERT420"));
  });

  it("4.21 trust-bundle config has correct policy via canonical minor", () => {
    const state = makeState({
      version: { selectedMinor: "4.21", selectedPatch: "4.21.5" },
      release: { channel: "4.21", patchVersion: "4.21.5" },
    });
    state.trust = { mirrorRegistryCaPem: certPem("TESTCERT421") };
    const config = yaml.load(buildInstallConfig(state));
    assert.strictEqual(config.additionalTrustBundlePolicy, "Always");
    assert.ok(config.additionalTrustBundle.includes("TESTCERT421"));
  });

  it("coherent 4.20 and 4.21 trust configs differ only in certificate content", () => {
    const state420 = makeState();
    state420.trust = { mirrorRegistryCaPem: certPem("TESTCERT420") };
    const config420 = yaml.load(buildInstallConfig(state420));

    const state421 = makeState({
      version: { selectedMinor: "4.21", selectedPatch: "4.21.5" },
      release: { channel: "4.21", patchVersion: "4.21.5" },
    });
    state421.trust = { mirrorRegistryCaPem: certPem("TESTCERT421") };
    const config421 = yaml.load(buildInstallConfig(state421));

    assert.strictEqual(config420.additionalTrustBundlePolicy, config421.additionalTrustBundlePolicy);
    assert.notStrictEqual(config420.additionalTrustBundle, config421.additionalTrustBundle);
  });

  it("contradictory selectedMinor=4.21 + channel=4.20: policy resolves via canonical 4.21", () => {
    const state = makeState({
      version: { selectedMinor: "4.21", selectedPatch: "4.21.5" },
      release: { channel: "4.20", patchVersion: "4.21.5" },
    });
    state.trust = { mirrorRegistryCaPem: certPem("CONTRADICT") };
    const config = yaml.load(buildInstallConfig(state));
    assert.strictEqual(config.additionalTrustBundlePolicy, "Always");
  });
});

// ===================================================================
// Correction D: Canonical precedence both directions
// ===================================================================

describe("canonical precedence both directions", () => {
  it("selectedMinor=4.21 + channel=4.20 resolves to 4.21", () => {
    const state = makeState({
      version: { selectedMinor: "4.21", selectedPatch: "4.21.5" },
      release: { channel: "4.20", patchVersion: "4.20.8" },
    });
    const result = assertSupportedOpenShiftMinorForGeneration(state);
    assert.strictEqual(result, "4.21");
  });

  it("selectedMinor=4.20 + channel=4.21 resolves to 4.20", () => {
    const state = makeState({
      version: { selectedMinor: "4.20", selectedPatch: "4.20.8" },
      release: { channel: "4.21", patchVersion: "4.21.5" },
    });
    const result = assertSupportedOpenShiftMinorForGeneration(state);
    assert.strictEqual(result, "4.20");
  });

  it("selectedMinor=4.21 + channel=4.20 produces valid install-config", () => {
    const state = makeState({
      version: { selectedMinor: "4.21", selectedPatch: "4.21.5" },
      release: { channel: "4.20", patchVersion: "4.20.8" },
    });
    const config = yaml.load(buildInstallConfig(state));
    assert.strictEqual(config.apiVersion, "v1");
    assert.strictEqual(config.baseDomain, "example.com");
  });

  it("selectedMinor=4.20 + channel=4.21 produces valid install-config", () => {
    const state = makeState({
      version: { selectedMinor: "4.20", selectedPatch: "4.20.8" },
      release: { channel: "4.21", patchVersion: "4.21.5" },
    });
    const config = yaml.load(buildInstallConfig(state));
    assert.strictEqual(config.apiVersion, "v1");
    assert.strictEqual(config.baseDomain, "example.com");
  });
});

// ===================================================================
// Correction F: Fixture isolation and coherence proofs
// ===================================================================

describe("fixture isolation and coherence", () => {
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

  it("makeState version/release overrides are coherent with canonical resolution", () => {
    const state420 = makeState();
    assert.strictEqual(assertSupportedOpenShiftMinorForGeneration(state420), "4.20");

    const state421 = makeState({
      version: { selectedMinor: "4.21", selectedPatch: "4.21.5" },
      release: { channel: "4.21", patchVersion: "4.21.5" },
    });
    assert.strictEqual(assertSupportedOpenShiftMinorForGeneration(state421), "4.21");
  });

  it("makeState default produces buildable install-config", () => {
    const state = makeState();
    const result = buildInstallConfig(state);
    assert.ok(typeof result === "string");
    const config = yaml.load(result);
    assert.strictEqual(config.apiVersion, "v1");
  });

  it("minimal() 4.21 override produces buildable install-config", () => {
    const state = minimal({
      version: { selectedMinor: "4.21", selectedPatch: "4.21.5" },
      release: { channel: "4.21", patchVersion: "4.21.5" },
    });
    state.credentials = { sshPublicKey: "ssh-rsa AAAA" };
    state.globalStrategy = {
      networking: {
        networkType: "OVNKubernetes",
        machineNetworkV4: "192.168.1.0/24",
        clusterNetworkCidr: "10.128.0.0/14",
        clusterNetworkHostPrefix: 23,
        serviceNetworkCidr: "172.30.0.0/16",
      },
    };
    const result = buildInstallConfig(state);
    const config = yaml.load(result);
    assert.strictEqual(config.apiVersion, "v1");
  });
});

// ===================================================================
// Correction G: Complete normalized-output regression (deepStrictEqual)
// ===================================================================

describe("normalized-output regression (full deepStrictEqual)", () => {
  const baseBmAgent = {
    apiVersion: "v1",
    baseDomain: "example.com",
    metadata: { name: "test-cluster" },
    compute: [{ name: "worker", replicas: 0, architecture: "amd64" }],
    controlPlane: { name: "master", replicas: 3, architecture: "amd64" },
    networking: {
      networkType: "OVNKubernetes",
      machineNetwork: [{ cidr: "192.168.1.0/24" }],
      clusterNetwork: [{ cidr: "10.128.0.0/14", hostPrefix: 23 }],
      serviceNetwork: ["172.30.0.0/16"],
    },
    platform: { baremetal: {} },
    pullSecret: '{"auths":{}}',
    sshKey: "ssh-rsa AAAA",
  };

  it("BM Agent 4.20: full deepStrictEqual", () => {
    const state = makeState();
    state.credentials = { sshPublicKey: "ssh-rsa AAAA", pullSecret: '{"auths":{}}' };
    const config = yaml.load(buildInstallConfig(state));
    assert.deepStrictEqual(config, baseBmAgent);
  });

  it("BM Agent 4.21: full deepStrictEqual", () => {
    const state = makeState({
      version: { selectedMinor: "4.21", selectedPatch: "4.21.5" },
      release: { channel: "4.21", patchVersion: "4.21.5" },
    });
    state.credentials = { sshPublicKey: "ssh-rsa AAAA", pullSecret: '{"auths":{}}' };
    const config = yaml.load(buildInstallConfig(state));
    assert.deepStrictEqual(config, baseBmAgent);
  });

  it("AWS GovCloud IPI 4.20: full deepStrictEqual", () => {
    const state = makeState();
    state.blueprint.platform = "AWS GovCloud";
    state.methodology.method = "IPI";
    state.platformConfig = { aws: { region: "us-gov-west-1" } };
    state.credentials = { sshPublicKey: "ssh-rsa AAAA", pullSecret: '{"auths":{}}' };
    const config = yaml.load(buildInstallConfig(state));
    assert.deepStrictEqual(config, {
      ...baseBmAgent,
      platform: { aws: { region: "us-gov-west-1" } },
    });
  });

  it("AWS GovCloud IPI 4.21: full deepStrictEqual", () => {
    const state = makeState({
      version: { selectedMinor: "4.21", selectedPatch: "4.21.5" },
      release: { channel: "4.21", patchVersion: "4.21.5" },
    });
    state.blueprint.platform = "AWS GovCloud";
    state.methodology.method = "IPI";
    state.platformConfig = { aws: { region: "us-gov-west-1" } };
    state.credentials = { sshPublicKey: "ssh-rsa AAAA", pullSecret: '{"auths":{}}' };
    const config = yaml.load(buildInstallConfig(state));
    assert.deepStrictEqual(config, {
      ...baseBmAgent,
      platform: { aws: { region: "us-gov-west-1" } },
    });
  });

  it("vSphere IPI 4.20: full deepStrictEqual", () => {
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
        network: "VM Network",
      },
    };
    state.credentials = { sshPublicKey: "ssh-rsa AAAA", pullSecret: '{"auths":{}}' };
    const config = yaml.load(buildInstallConfig(state));
    assert.deepStrictEqual(config, {
      ...baseBmAgent,
      platform: {
        vsphere: {
          vcenters: [{
            server: "vcenter.local",
            user: "",
            password: "",
            datacenters: ["DC1"],
            port: 443,
          }],
          failureDomains: [{
            name: "fd-0",
            region: "DC1",
            zone: "Cluster1",
            server: "vcenter.local",
            topology: {
              datacenter: "DC1",
              computeCluster: "Cluster1",
              datastore: "DS1",
              networks: ["VM Network"],
            },
          }],
        },
      },
      publish: "External",
    });
  });

  it("mirror 4.20: full deepStrictEqual", () => {
    const mirrorSources = [{ source: "quay.io/ocp", mirrors: ["registry.local:5000/ocp"] }];
    const state = makeState();
    state.globalStrategy.mirroring = { registryFqdn: "registry.local:5000", sources: mirrorSources };
    state.credentials = {
      sshPublicKey: "ssh-rsa AAAA",
      pullSecret: '{"auths":{}}',
      usingMirrorRegistry: true,
      mirrorRegistryPullSecret: '{"auths":{"registry.local:5000":{"auth":"dGVzdDp0ZXN0"}}}',
    };
    const config = yaml.load(buildInstallConfig(state));
    assert.deepStrictEqual(config, {
      ...baseBmAgent,
      imageDigestSources: [{ source: "quay.io/ocp", mirrors: ["registry.local:5000/ocp"] }],
    });
  });

  it("mirror 4.21: full deepStrictEqual", () => {
    const mirrorSources = [{ source: "quay.io/ocp", mirrors: ["registry.local:5000/ocp"] }];
    const state = makeState({
      version: { selectedMinor: "4.21", selectedPatch: "4.21.5" },
      release: { channel: "4.21", patchVersion: "4.21.5" },
    });
    state.globalStrategy.mirroring = { registryFqdn: "registry.local:5000", sources: mirrorSources };
    state.credentials = {
      sshPublicKey: "ssh-rsa AAAA",
      pullSecret: '{"auths":{}}',
      usingMirrorRegistry: true,
      mirrorRegistryPullSecret: '{"auths":{"registry.local:5000":{"auth":"dGVzdDp0ZXN0"}}}',
    };
    const config = yaml.load(buildInstallConfig(state));
    assert.deepStrictEqual(config, {
      ...baseBmAgent,
      imageDigestSources: [{ source: "quay.io/ocp", mirrors: ["registry.local:5000/ocp"] }],
    });
  });

  it("trust 4.20: full deepStrictEqual", () => {
    const state = makeState();
    state.trust = {
      mirrorRegistryCaPem: "-----BEGIN CERTIFICATE-----\nTESTCERT420\n-----END CERTIFICATE-----\n",
    };
    state.credentials = { sshPublicKey: "ssh-rsa AAAA", pullSecret: '{"auths":{}}' };
    const config = yaml.load(buildInstallConfig(state));
    assert.deepStrictEqual(config, {
      ...baseBmAgent,
      additionalTrustBundle: "-----BEGIN CERTIFICATE-----\nTESTCERT420\n-----END CERTIFICATE-----\n",
      additionalTrustBundlePolicy: "Always",
    });
  });
});
