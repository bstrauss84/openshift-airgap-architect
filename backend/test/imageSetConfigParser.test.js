/**
 * OpenShift Airgap Architect - ImageSet Config Parser Tests
 *
 * Tests for imageset-config.yaml parsing and OpenShift version extraction.
 * Validates pre-loading of OpenShift version in Blueprint step.
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
import { loadImageSetConfig } from "../src/imageSetConfigParser.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("ImageSet Config Parser", () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env.IMAGESET_CONFIG;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.IMAGESET_CONFIG = originalEnv;
    } else {
      delete process.env.IMAGESET_CONFIG;
    }
  });

  test("loadImageSetConfig extracts version from valid imageset-config.yaml", () => {
    const fixtureFile = path.join(__dirname, "fixtures", "test-imageset-config.yaml");
    process.env.IMAGESET_CONFIG = fixtureFile;

    const result = loadImageSetConfig();

    assert.ok(result, "Result should not be null");
    assert.strictEqual(result.release.channel, "stable-4.14");
    assert.strictEqual(result.release.patchVersion, "4.14.10");
    assert.strictEqual(result.version.selectedChannel, "stable-4.14");
    assert.strictEqual(result.version.selectedVersion, "4.14.10");
    assert.strictEqual(result.blueprint.mirrorBundleDetected, true);
    assert.strictEqual(result.mirrorWorkflow.configSourceType, "custom");
    assert.strictEqual(result.mirrorWorkflow.configPath, fixtureFile);
  });

  test("loadImageSetConfig returns null when env var not set", () => {
    delete process.env.IMAGESET_CONFIG;
    const result = loadImageSetConfig();
    assert.strictEqual(result, null);
  });

  test("loadImageSetConfig returns null when file does not exist", () => {
    process.env.IMAGESET_CONFIG = "/nonexistent/imageset-config.yaml";
    const result = loadImageSetConfig();
    assert.strictEqual(result, null);
  });

  test("loadImageSetConfig returns null for invalid YAML", () => {
    const tmpFile = path.join(os.tmpdir(), `test-invalid-imageset-${Date.now()}.yaml`);
    fs.writeFileSync(tmpFile, "invalid: yaml: {{{");
    process.env.IMAGESET_CONFIG = tmpFile;

    try {
      const result = loadImageSetConfig();
      assert.strictEqual(result, null);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  test("loadImageSetConfig returns null when channels array is empty", () => {
    const tmpFile = path.join(os.tmpdir(), `test-no-channels-${Date.now()}.yaml`);
    fs.writeFileSync(tmpFile, `
kind: ImageSetConfiguration
apiVersion: mirror.openshift.io/v1alpha2
mirror:
  platform:
    channels: []
`);
    process.env.IMAGESET_CONFIG = tmpFile;

    try {
      const result = loadImageSetConfig();
      assert.strictEqual(result, null);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  test("loadImageSetConfig returns null when channels are missing", () => {
    const tmpFile = path.join(os.tmpdir(), `test-missing-channels-${Date.now()}.yaml`);
    fs.writeFileSync(tmpFile, `
kind: ImageSetConfiguration
apiVersion: mirror.openshift.io/v1alpha2
mirror:
  platform:
    something: else
`);
    process.env.IMAGESET_CONFIG = tmpFile;

    try {
      const result = loadImageSetConfig();
      assert.strictEqual(result, null);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  test("loadImageSetConfig extracts minVersion when present", () => {
    const tmpFile = path.join(os.tmpdir(), `test-minversion-${Date.now()}.yaml`);
    fs.writeFileSync(tmpFile, `
kind: ImageSetConfiguration
apiVersion: mirror.openshift.io/v1alpha2
mirror:
  platform:
    channels:
      - name: stable-4.15
        minVersion: 4.15.3
`);
    process.env.IMAGESET_CONFIG = tmpFile;

    try {
      const result = loadImageSetConfig();
      assert.ok(result);
      assert.strictEqual(result.release.channel, "stable-4.15");
      assert.strictEqual(result.release.patchVersion, "4.15.3");
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  test("loadImageSetConfig extracts maxVersion when minVersion is missing", () => {
    const tmpFile = path.join(os.tmpdir(), `test-maxversion-${Date.now()}.yaml`);
    fs.writeFileSync(tmpFile, `
kind: ImageSetConfiguration
apiVersion: mirror.openshift.io/v1alpha2
mirror:
  platform:
    channels:
      - name: stable-4.16
        maxVersion: 4.16.5
`);
    process.env.IMAGESET_CONFIG = tmpFile;

    try {
      const result = loadImageSetConfig();
      assert.ok(result);
      assert.strictEqual(result.release.channel, "stable-4.16");
      assert.strictEqual(result.release.patchVersion, "4.16.5");
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  test("loadImageSetConfig extracts shortestPath when min/max are missing", () => {
    const tmpFile = path.join(os.tmpdir(), `test-shortestpath-${Date.now()}.yaml`);
    fs.writeFileSync(tmpFile, `
kind: ImageSetConfiguration
apiVersion: mirror.openshift.io/v1alpha2
mirror:
  platform:
    channels:
      - name: stable-4.17
        shortestPath: true
`);
    process.env.IMAGESET_CONFIG = tmpFile;

    try {
      const result = loadImageSetConfig();
      assert.ok(result);
      assert.strictEqual(result.release.channel, "stable-4.17");
      assert.strictEqual(result.release.patchVersion, true); // shortestPath is boolean
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  test("loadImageSetConfig uses first channel when multiple channels exist", () => {
    const tmpFile = path.join(os.tmpdir(), `test-multi-channels-${Date.now()}.yaml`);
    fs.writeFileSync(tmpFile, `
kind: ImageSetConfiguration
apiVersion: mirror.openshift.io/v1alpha2
mirror:
  platform:
    channels:
      - name: stable-4.14
        minVersion: 4.14.10
      - name: stable-4.15
        minVersion: 4.15.1
`);
    process.env.IMAGESET_CONFIG = tmpFile;

    try {
      const result = loadImageSetConfig();
      assert.ok(result);
      assert.strictEqual(result.release.channel, "stable-4.14");
      assert.strictEqual(result.release.patchVersion, "4.14.10");
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  test("loadImageSetConfig handles missing mirror.platform gracefully", () => {
    const tmpFile = path.join(os.tmpdir(), `test-no-platform-${Date.now()}.yaml`);
    fs.writeFileSync(tmpFile, `
kind: ImageSetConfiguration
apiVersion: mirror.openshift.io/v1alpha2
mirror:
  operators:
    - catalog: registry.redhat.io/redhat/redhat-operator-index:v4.14
`);
    process.env.IMAGESET_CONFIG = tmpFile;

    try {
      const result = loadImageSetConfig();
      assert.strictEqual(result, null);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});
