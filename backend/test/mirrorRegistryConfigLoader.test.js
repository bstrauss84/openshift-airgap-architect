/**
 * OpenShift Airgap Architect - Mirror Registry Config Loader Tests
 *
 * Tests for mirror registry configuration loading, pull secret generation,
 * CA certificate loading, and state augmentation for pre-loaded configs.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import { loadMirrorRegistryConfig } from "../src/mirrorRegistryConfigLoader.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Mirror Registry Config Loader", () => {
  let originalEnv;
  let testCaFile;
  let testIdmsFile;
  let testItmsFile;

  beforeEach(() => {
    originalEnv = process.env.MIRROR_REGISTRY_CONFIG;

    // Create temporary CA cert file
    testCaFile = path.join(os.tmpdir(), `test-ca-${Date.now()}.pem`);
    const caCert = fs.readFileSync(path.join(__dirname, "fixtures", "test-ca.pem"), "utf8");
    fs.writeFileSync(testCaFile, caCert);

    // Create temporary IDMS/ITMS files
    testIdmsFile = path.join(os.tmpdir(), `test-idms-${Date.now()}.yaml`);
    testItmsFile = path.join(os.tmpdir(), `test-itms-${Date.now()}.yaml`);
    fs.copyFileSync(
      path.join(__dirname, "fixtures", "test-idms.yaml"),
      testIdmsFile
    );
    fs.copyFileSync(
      path.join(__dirname, "fixtures", "test-itms.yaml"),
      testItmsFile
    );
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.MIRROR_REGISTRY_CONFIG = originalEnv;
    } else {
      delete process.env.MIRROR_REGISTRY_CONFIG;
    }

    // Clean up temp files
    [testCaFile, testIdmsFile, testItmsFile].forEach((file) => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
  });

  test("loadMirrorRegistryConfig loads valid config and generates pull secret", () => {
    const configFile = path.join(os.tmpdir(), `test-mirror-config-${Date.now()}.json`);
    const config = {
      hostname: "registry.example.com",
      port: 8443,
      username: "admin",
      password: "secret123",
      caCertPath: testCaFile,
      idmsPath: testIdmsFile,
      itmsPath: testItmsFile
    };
    fs.writeFileSync(configFile, JSON.stringify(config));
    process.env.MIRROR_REGISTRY_CONFIG = configFile;

    try {
      const result = loadMirrorRegistryConfig();

      // Verify result structure
      assert.ok(result, "Result should not be null");
      assert.ok(result.pullSecret, "Pull secret should be present");
      assert.ok(result.state, "State should be present");

      // Verify pull secret format
      const pullSecret = JSON.parse(result.pullSecret);
      assert.ok(pullSecret.auths, "Pull secret should have auths object");
      assert.ok(pullSecret.auths["registry.example.com:8443"], "Pull secret should have registry key");

      // Verify auth is base64 encoded username:password
      const auth = pullSecret.auths["registry.example.com:8443"].auth;
      const decoded = Buffer.from(auth, "base64").toString("utf8");
      assert.strictEqual(decoded, "admin:secret123");

      // Verify state structure
      assert.strictEqual(result.state.credentials.usingMirrorRegistry, true);
      assert.strictEqual(result.state.credentials.mirrorRegistryUnauthenticated, false);
      assert.strictEqual(result.state.trust.mirrorRegistryUsesPrivateCa, true);
      assert.ok(result.state.trust.mirrorRegistryCaPem.includes("BEGIN CERTIFICATE"));
      assert.strictEqual(result.state.globalStrategy.mirroring.registryFqdn, "registry.example.com:8443");
      assert.strictEqual(result.state.ui.mirrorConfigPreloaded, true);

      // Verify mirror sources from IDMS/ITMS
      assert.strictEqual(result.state.globalStrategy.mirroring.sources.length, 4); // 2 IDMS + 2 ITMS
      assert.strictEqual(result.state.globalStrategy.mirroring.sources[0].source, "quay.io/openshift-release-dev/ocp-release");
    } finally {
      fs.unlinkSync(configFile);
    }
  });

  test("loadMirrorRegistryConfig returns null when env var not set", () => {
    delete process.env.MIRROR_REGISTRY_CONFIG;
    const result = loadMirrorRegistryConfig();
    assert.strictEqual(result, null);
  });

  test("loadMirrorRegistryConfig returns null when config file does not exist", () => {
    process.env.MIRROR_REGISTRY_CONFIG = "/nonexistent/mirror-config.json";
    const result = loadMirrorRegistryConfig();
    assert.strictEqual(result, null);
  });

  test("loadMirrorRegistryConfig returns null for invalid JSON", () => {
    const configFile = path.join(os.tmpdir(), `test-invalid-json-${Date.now()}.json`);
    fs.writeFileSync(configFile, "{ invalid json }");
    process.env.MIRROR_REGISTRY_CONFIG = configFile;

    try {
      const result = loadMirrorRegistryConfig();
      assert.strictEqual(result, null);
    } finally {
      fs.unlinkSync(configFile);
    }
  });

  test("loadMirrorRegistryConfig returns null when hostname is missing", () => {
    const configFile = path.join(os.tmpdir(), `test-no-hostname-${Date.now()}.json`);
    const config = {
      port: 8443,
      username: "admin",
      password: "secret123"
    };
    fs.writeFileSync(configFile, JSON.stringify(config));
    process.env.MIRROR_REGISTRY_CONFIG = configFile;

    try {
      const result = loadMirrorRegistryConfig();
      assert.strictEqual(result, null);
    } finally {
      fs.unlinkSync(configFile);
    }
  });

  test("loadMirrorRegistryConfig returns null when port is missing", () => {
    const configFile = path.join(os.tmpdir(), `test-no-port-${Date.now()}.json`);
    const config = {
      hostname: "registry.example.com",
      username: "admin",
      password: "secret123"
    };
    fs.writeFileSync(configFile, JSON.stringify(config));
    process.env.MIRROR_REGISTRY_CONFIG = configFile;

    try {
      const result = loadMirrorRegistryConfig();
      assert.strictEqual(result, null);
    } finally {
      fs.unlinkSync(configFile);
    }
  });

  test("loadMirrorRegistryConfig returns null when username is missing", () => {
    const configFile = path.join(os.tmpdir(), `test-no-username-${Date.now()}.json`);
    const config = {
      hostname: "registry.example.com",
      port: 8443,
      password: "secret123"
    };
    fs.writeFileSync(configFile, JSON.stringify(config));
    process.env.MIRROR_REGISTRY_CONFIG = configFile;

    try {
      const result = loadMirrorRegistryConfig();
      assert.strictEqual(result, null);
    } finally {
      fs.unlinkSync(configFile);
    }
  });

  test("loadMirrorRegistryConfig returns null when password is missing", () => {
    const configFile = path.join(os.tmpdir(), `test-no-password-${Date.now()}.json`);
    const config = {
      hostname: "registry.example.com",
      port: 8443,
      username: "admin"
    };
    fs.writeFileSync(configFile, JSON.stringify(config));
    process.env.MIRROR_REGISTRY_CONFIG = configFile;

    try {
      const result = loadMirrorRegistryConfig();
      assert.strictEqual(result, null);
    } finally {
      fs.unlinkSync(configFile);
    }
  });

  test("loadMirrorRegistryConfig works without CA cert path", () => {
    const configFile = path.join(os.tmpdir(), `test-no-ca-${Date.now()}.json`);
    const config = {
      hostname: "registry.example.com",
      port: 8443,
      username: "admin",
      password: "secret123"
      // No caCertPath
    };
    fs.writeFileSync(configFile, JSON.stringify(config));
    process.env.MIRROR_REGISTRY_CONFIG = configFile;

    try {
      const result = loadMirrorRegistryConfig();
      assert.ok(result);
      assert.strictEqual(result.state.trust.mirrorRegistryUsesPrivateCa, false);
      assert.strictEqual(result.state.trust.mirrorRegistryCaPem, "");
    } finally {
      fs.unlinkSync(configFile);
    }
  });

  test("loadMirrorRegistryConfig proceeds when CA cert file does not exist", () => {
    const configFile = path.join(os.tmpdir(), `test-missing-ca-${Date.now()}.json`);
    const config = {
      hostname: "registry.example.com",
      port: 8443,
      username: "admin",
      password: "secret123",
      caCertPath: "/nonexistent/ca.pem"
    };
    fs.writeFileSync(configFile, JSON.stringify(config));
    process.env.MIRROR_REGISTRY_CONFIG = configFile;

    try {
      const result = loadMirrorRegistryConfig();
      assert.ok(result);
      assert.strictEqual(result.state.trust.mirrorRegistryUsesPrivateCa, false);
      assert.strictEqual(result.state.trust.mirrorRegistryCaPem, "");
    } finally {
      fs.unlinkSync(configFile);
    }
  });

  test("loadMirrorRegistryConfig uses default sources when IDMS/ITMS missing", () => {
    const configFile = path.join(os.tmpdir(), `test-no-idms-itms-${Date.now()}.json`);
    const config = {
      hostname: "registry.example.com",
      port: 5000,
      username: "admin",
      password: "secret123"
      // No idmsPath or itmsPath
    };
    fs.writeFileSync(configFile, JSON.stringify(config));
    process.env.MIRROR_REGISTRY_CONFIG = configFile;

    try {
      const result = loadMirrorRegistryConfig();
      assert.ok(result);

      // Should have default sources with correct registry FQDN
      const sources = result.state.globalStrategy.mirroring.sources;
      assert.strictEqual(sources.length, 2);
      assert.strictEqual(sources[0].source, "quay.io/openshift-release-dev/ocp-release");
      assert.deepStrictEqual(sources[0].mirrors, ["registry.example.com:5000/ocp-release"]);
      assert.strictEqual(sources[1].source, "quay.io/openshift-release-dev/ocp-v4.0-art-dev");
      assert.deepStrictEqual(sources[1].mirrors, ["registry.example.com:5000/ocp-v4.0-art-dev"]);
    } finally {
      fs.unlinkSync(configFile);
    }
  });

  test("loadMirrorRegistryConfig includes email field in pull secret", () => {
    const configFile = path.join(os.tmpdir(), `test-with-email-${Date.now()}.json`);
    const config = {
      hostname: "registry.example.com",
      port: 8443,
      username: "admin",
      password: "secret123",
      email: "admin@example.com"
    };
    fs.writeFileSync(configFile, JSON.stringify(config));
    process.env.MIRROR_REGISTRY_CONFIG = configFile;

    try {
      const result = loadMirrorRegistryConfig();
      assert.ok(result);

      const pullSecret = JSON.parse(result.pullSecret);
      assert.strictEqual(pullSecret.auths["registry.example.com:8443"].email, "admin@example.com");
    } finally {
      fs.unlinkSync(configFile);
    }
  });

  test("loadMirrorRegistryConfig handles special characters in password", () => {
    const configFile = path.join(os.tmpdir(), `test-special-password-${Date.now()}.json`);
    const config = {
      hostname: "registry.example.com",
      port: 8443,
      username: "admin",
      password: "P@ssw0rd!#$%^&*()"
    };
    fs.writeFileSync(configFile, JSON.stringify(config));
    process.env.MIRROR_REGISTRY_CONFIG = configFile;

    try {
      const result = loadMirrorRegistryConfig();
      assert.ok(result);

      const pullSecret = JSON.parse(result.pullSecret);
      const auth = pullSecret.auths["registry.example.com:8443"].auth;
      const decoded = Buffer.from(auth, "base64").toString("utf8");
      assert.strictEqual(decoded, "admin:P@ssw0rd!#$%^&*()");
    } finally {
      fs.unlinkSync(configFile);
    }
  });

  test("loadMirrorRegistryConfig builds correct registry FQDN", () => {
    const configFile = path.join(os.tmpdir(), `test-fqdn-${Date.now()}.json`);
    const config = {
      hostname: "mirror.internal.corp",
      port: 443,
      username: "user",
      password: "pass"
    };
    fs.writeFileSync(configFile, JSON.stringify(config));
    process.env.MIRROR_REGISTRY_CONFIG = configFile;

    try {
      const result = loadMirrorRegistryConfig();
      assert.ok(result);
      assert.strictEqual(result.state.globalStrategy.mirroring.registryFqdn, "mirror.internal.corp:443");
    } finally {
      fs.unlinkSync(configFile);
    }
  });

  test("loadMirrorRegistryConfig does not include pull secret in state", () => {
    const configFile = path.join(os.tmpdir(), `test-no-creds-in-state-${Date.now()}.json`);
    const config = {
      hostname: "registry.example.com",
      port: 8443,
      username: "admin",
      password: "secret123"
    };
    fs.writeFileSync(configFile, JSON.stringify(config));
    process.env.MIRROR_REGISTRY_CONFIG = configFile;

    try {
      const result = loadMirrorRegistryConfig();
      assert.ok(result);

      // Pull secret should be returned separately, not in state
      assert.ok(result.pullSecret);
      assert.strictEqual(result.state.credentials.mirrorRegistryPullSecret, undefined);
    } finally {
      fs.unlinkSync(configFile);
    }
  });
});
