/**
 * OpenShift Airgap Architect - FeatureSet Generation Tests
 *
 * Tests for featureSet and featureGates generation in install-config.yaml.
 * Verifies that featureSet and featureGates from platformConfig are correctly
 * included in generated install-config.yaml.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInstallConfig } from "../src/generate.js";
import yaml from "js-yaml";

// Minimal state for bare-metal-ipi scenario
const createMinimalState = (platformConfig = {}) => ({
  blueprint: {
    baseDomain: "example.com",
    clusterName: "test-cluster",
    platform: "Bare Metal",
    version: "4.20",
  },
  methodology: {
    method: "IPI",
  },
  globalStrategy: {
    networking: {
      machineNetworkV4: "192.168.1.0/24",
      clusterNetwork: "10.128.0.0/14",
      clusterNetworkHostPrefix: 23,
      serviceNetwork: "172.30.0.0/16",
    },
  },
  platformConfig: {
    baremetal: {
      apiVIPs: ["192.168.1.10"],
      ingressVIPs: ["192.168.1.11"],
    },
    ...platformConfig,
  },
  credentials: {
    pullSecretPlaceholder: '{"auths":{}}',
    sshKey: "ssh-rsa AAAA...",
  },
  exportOptions: {
    includeCredentials: true,
  },
});

test("buildInstallConfig: includes featureSet when specified", () => {
  const state = createMinimalState({
    featureSet: "TechPreviewNoUpgrade",
  });

  const installConfigYaml = buildInstallConfig(state);
  const config = yaml.load(installConfigYaml);

  assert.strictEqual(config.featureSet, "TechPreviewNoUpgrade");
});

test("buildInstallConfig: includes featureSet LatencyMitigating", () => {
  const state = createMinimalState({
    featureSet: "LatencyMitigating",
  });

  const installConfigYaml = buildInstallConfig(state);
  const config = yaml.load(installConfigYaml);

  assert.strictEqual(config.featureSet, "LatencyMitigating");
});

test("buildInstallConfig: includes featureGates when featureSet is CustomNoUpgrade", () => {
  const state = createMinimalState({
    featureSet: "CustomNoUpgrade",
    featureGates: "ExternalCloudProvider=true\nCSIMigrationAWS=true\nDeprecatedFeature=false",
  });

  const installConfigYaml = buildInstallConfig(state);
  const config = yaml.load(installConfigYaml);

  assert.strictEqual(config.featureSet, "CustomNoUpgrade");
  assert.ok(Array.isArray(config.featureGates));
  assert.strictEqual(config.featureGates.length, 3);
  assert.strictEqual(config.featureGates[0], "ExternalCloudProvider=true");
  assert.strictEqual(config.featureGates[1], "CSIMigrationAWS=true");
  assert.strictEqual(config.featureGates[2], "DeprecatedFeature=false");
});

test("buildInstallConfig: skips featureGates when featureSet is not CustomNoUpgrade", () => {
  const state = createMinimalState({
    featureSet: "TechPreviewNoUpgrade",
    featureGates: "ExternalCloudProvider=true",
  });

  const installConfigYaml = buildInstallConfig(state);
  const config = yaml.load(installConfigYaml);

  assert.strictEqual(config.featureSet, "TechPreviewNoUpgrade");
  assert.strictEqual(config.featureGates, undefined);
});

test("buildInstallConfig: omits featureSet when not specified", () => {
  const state = createMinimalState();

  const installConfigYaml = buildInstallConfig(state);
  const config = yaml.load(installConfigYaml);

  assert.strictEqual(config.featureSet, undefined);
});

test("buildInstallConfig: handles empty featureGates string", () => {
  const state = createMinimalState({
    featureSet: "CustomNoUpgrade",
    featureGates: "",
  });

  const installConfigYaml = buildInstallConfig(state);
  const config = yaml.load(installConfigYaml);

  assert.strictEqual(config.featureSet, "CustomNoUpgrade");
  assert.strictEqual(config.featureGates, undefined);
});

test("buildInstallConfig: handles featureGates with blank lines", () => {
  const state = createMinimalState({
    featureSet: "CustomNoUpgrade",
    featureGates: "ExternalCloudProvider=true\n\n\nCSIMigrationAWS=true\n",
  });

  const installConfigYaml = buildInstallConfig(state);
  const config = yaml.load(installConfigYaml);

  assert.strictEqual(config.featureSet, "CustomNoUpgrade");
  assert.ok(Array.isArray(config.featureGates));
  assert.strictEqual(config.featureGates.length, 2);
  assert.strictEqual(config.featureGates[0], "ExternalCloudProvider=true");
  assert.strictEqual(config.featureGates[1], "CSIMigrationAWS=true");
});
