/**
 * OpenShift Airgap Architect - Operator Version Constraints Tests
 *
 * Tests for operator version constraints (minVersion/maxVersion) in ImageSetConfiguration.
 * Verifies that version constraints from operator state are correctly included in
 * generated imageset-config.yaml.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildImageSetConfig } from "../src/generate.js";
import yaml from "js-yaml";

// Minimal state for testing imageset config
const createStateWithOperators = (operators) => ({
  release: {
    patchVersion: "4.20.5",
    channel: "4.20",
  },
  operators: {
    selected: operators,
  },
});

test("buildImageSetConfig: includes version constraints when both minVersion and maxVersion specified", () => {
  const state = createStateWithOperators([
    {
      name: "kubevirt-hyperconverged",
      defaultChannel: "stable",
      catalogImage: "registry.redhat.io/redhat/redhat-operator-index:v4.20",
      minVersion: "4.15.0",
      maxVersion: "4.16.5",
    },
  ]);

  const configYaml = buildImageSetConfig(state);
  const config = yaml.load(configYaml);

  assert.strictEqual(config.mirror.operators.length, 1);
  const operator = config.mirror.operators[0];
  assert.strictEqual(operator.packages.length, 1);
  assert.strictEqual(operator.packages[0].name, "kubevirt-hyperconverged");
  assert.strictEqual(operator.packages[0].channels.length, 1);
  assert.strictEqual(operator.packages[0].channels[0].name, "stable");
  assert.ok(operator.packages[0].channels[0].includeConfig);
  assert.strictEqual(operator.packages[0].channels[0].includeConfig.minVersion, "4.15.0");
  assert.strictEqual(operator.packages[0].channels[0].includeConfig.maxVersion, "4.16.5");
});

test("buildImageSetConfig: includes only minVersion when maxVersion not specified", () => {
  const state = createStateWithOperators([
    {
      name: "local-storage-operator",
      defaultChannel: "stable",
      catalogImage: "registry.redhat.io/redhat/redhat-operator-index:v4.20",
      minVersion: "4.14.0",
    },
  ]);

  const configYaml = buildImageSetConfig(state);
  const config = yaml.load(configYaml);

  const channel = config.mirror.operators[0].packages[0].channels[0];
  assert.ok(channel.includeConfig);
  assert.strictEqual(channel.includeConfig.minVersion, "4.14.0");
  assert.strictEqual(channel.includeConfig.maxVersion, undefined);
});

test("buildImageSetConfig: includes only maxVersion when minVersion not specified", () => {
  const state = createStateWithOperators([
    {
      name: "nfd",
      defaultChannel: "stable",
      catalogImage: "registry.redhat.io/redhat/redhat-operator-index:v4.20",
      maxVersion: "3.0.0",
    },
  ]);

  const configYaml = buildImageSetConfig(state);
  const config = yaml.load(configYaml);

  const channel = config.mirror.operators[0].packages[0].channels[0];
  assert.ok(channel.includeConfig);
  assert.strictEqual(channel.includeConfig.minVersion, undefined);
  assert.strictEqual(channel.includeConfig.maxVersion, "3.0.0");
});

test("buildImageSetConfig: omits includeConfig when no version constraints specified", () => {
  const state = createStateWithOperators([
    {
      name: "compliance-operator",
      defaultChannel: "stable",
      catalogImage: "registry.redhat.io/redhat/redhat-operator-index:v4.20",
    },
  ]);

  const configYaml = buildImageSetConfig(state);
  const config = yaml.load(configYaml);

  const channel = config.mirror.operators[0].packages[0].channels[0];
  assert.strictEqual(channel.name, "stable");
  assert.strictEqual(channel.includeConfig, undefined);
});

test("buildImageSetConfig: handles multiple operators with mixed version constraints", () => {
  const state = createStateWithOperators([
    {
      name: "kubevirt-hyperconverged",
      defaultChannel: "stable",
      catalogImage: "registry.redhat.io/redhat/redhat-operator-index:v4.20",
      minVersion: "4.15.0",
      maxVersion: "4.16.0",
    },
    {
      name: "local-storage-operator",
      defaultChannel: "stable",
      catalogImage: "registry.redhat.io/redhat/redhat-operator-index:v4.20",
      // No version constraints
    },
    {
      name: "nfd",
      defaultChannel: "stable",
      catalogImage: "registry.redhat.io/redhat/redhat-operator-index:v4.20",
      minVersion: "2.0.0",
    },
  ]);

  const configYaml = buildImageSetConfig(state);
  const config = yaml.load(configYaml);

  assert.strictEqual(config.mirror.operators[0].packages.length, 3);

  const kubevirt = config.mirror.operators[0].packages.find((p) => p.name === "kubevirt-hyperconverged");
  assert.ok(kubevirt.channels[0].includeConfig);
  assert.strictEqual(kubevirt.channels[0].includeConfig.minVersion, "4.15.0");
  assert.strictEqual(kubevirt.channels[0].includeConfig.maxVersion, "4.16.0");

  const localStorage = config.mirror.operators[0].packages.find((p) => p.name === "local-storage-operator");
  assert.strictEqual(localStorage.channels[0].includeConfig, undefined);

  const nfd = config.mirror.operators[0].packages.find((p) => p.name === "nfd");
  assert.ok(nfd.channels[0].includeConfig);
  assert.strictEqual(nfd.channels[0].includeConfig.minVersion, "2.0.0");
  assert.strictEqual(nfd.channels[0].includeConfig.maxVersion, undefined);
});

test("buildImageSetConfig: handles operators from different catalogs with version constraints", () => {
  const state = createStateWithOperators([
    {
      name: "kubevirt-hyperconverged",
      defaultChannel: "stable",
      catalogImage: "registry.redhat.io/redhat/redhat-operator-index:v4.20",
      minVersion: "4.15.0",
    },
    {
      name: "gpu-operator-certified",
      defaultChannel: "stable",
      catalogImage: "registry.redhat.io/redhat/certified-operator-index:v4.20",
      maxVersion: "23.9.0",
    },
  ]);

  const configYaml = buildImageSetConfig(state);
  const config = yaml.load(configYaml);

  assert.strictEqual(config.mirror.operators.length, 2);

  const redhatCatalog = config.mirror.operators.find(
    (op) => op.catalog === "registry.redhat.io/redhat/redhat-operator-index:v4.20"
  );
  assert.ok(redhatCatalog);
  assert.strictEqual(redhatCatalog.packages[0].channels[0].includeConfig.minVersion, "4.15.0");

  const certifiedCatalog = config.mirror.operators.find(
    (op) => op.catalog === "registry.redhat.io/redhat/certified-operator-index:v4.20"
  );
  assert.ok(certifiedCatalog);
  assert.strictEqual(certifiedCatalog.packages[0].channels[0].includeConfig.maxVersion, "23.9.0");
});

test("buildImageSetConfig: handles empty string version constraints as undefined", () => {
  const state = createStateWithOperators([
    {
      name: "compliance-operator",
      defaultChannel: "stable",
      catalogImage: "registry.redhat.io/redhat/redhat-operator-index:v4.20",
      minVersion: "",
      maxVersion: "",
    },
  ]);

  const configYaml = buildImageSetConfig(state);
  const config = yaml.load(configYaml);

  const channel = config.mirror.operators[0].packages[0].channels[0];
  // Empty strings should not create includeConfig
  assert.strictEqual(channel.includeConfig, undefined);
});
