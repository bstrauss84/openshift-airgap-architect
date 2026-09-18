/**
 * OpenShift Airgap Architect - Connected Flow Backend Tests
 *
 * Tests for connected mode functionality:
 * - Connectivity state validation
 * - imageset-config-only generation
 * - Field Manual generation for connected mode
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { test } from "node:test";
import assert from "node:assert";
import yaml from "js-yaml";
import { buildImageSetConfig, buildFieldManual } from "../src/generate.js";

test("buildImageSetConfig works with minimal connected state", () => {
  const state = {
    docs: { connectivity: "connected" },
    release: { patchVersion: "4.20.5", channel: "stable-4.20" },
    version: { selectedVersion: "4.20" },
    operators: { selected: [] },
    imagesetConfig: { graph: true }
  };

  const raw = buildImageSetConfig(state);
  assert.strictEqual(typeof raw, "string");

  const config = yaml.load(raw);
  assert.strictEqual(config.kind, "ImageSetConfiguration");
  assert.strictEqual(config.mirror.platform.graph, true);
});

test("buildImageSetConfig includes selected operators", () => {
  const state = {
    docs: { connectivity: "connected" },
    release: { patchVersion: "4.20.5", channel: "stable-4.20" },
    version: { selectedVersion: "4.20" },
    operators: {
      selected: [
        {
          name: "kubevirt-hyperconverged",
          displayName: "KubeVirt",
          catalog: "redhat-operators",
          defaultChannel: "stable"
        }
      ]
    },
    imagesetConfig: { graph: true }
  };

  const raw = buildImageSetConfig(state);

  // Verify YAML contains operator reference
  assert.ok(raw.includes("kubevirt-hyperconverged"), "Should include kubevirt-hyperconverged in YAML");
  assert.ok(raw.includes("packages:"), "Should include operator packages section");
});

test("buildImageSetConfig excludes update graph when disabled", () => {
  const state = {
    docs: { connectivity: "connected" },
    release: { patchVersion: "4.20.5", channel: "stable-4.20" },
    version: { selectedVersion: "4.20" },
    operators: { selected: [] },
    imagesetConfig: { graph: false }
  };

  const raw = buildImageSetConfig(state);
  const config = yaml.load(raw);

  // When graph is false, the platform section should not include graph: true
  assert.strictEqual(config.mirror.platform.graph, undefined);
});

test("buildImageSetConfig includes additional images", () => {
  const state = {
    docs: { connectivity: "connected" },
    release: { patchVersion: "4.20.5", channel: "stable-4.20" },
    version: { selectedVersion: "4.20" },
    operators: { selected: [] },
    imagesetConfig: {
      additionalImages: "registry.example.com/app:v1\nquay.io/org/image:latest"
    }
  };

  const raw = buildImageSetConfig(state);
  assert.ok(raw.includes("registry.example.com/app:v1"), "Should include first additional image");
  assert.ok(raw.includes("quay.io/org/image:latest"), "Should include second additional image");
});

test("buildFieldManual generates connected mode instructions", () => {
  const state = {
    docs: { connectivity: "connected" },
    release: { patchVersion: "4.20.5" },
    version: { selectedVersion: "4.20" },
    operators: {
      selected: [
        { name: "kubevirt-hyperconverged", displayName: "KubeVirt", catalog: "redhat-operators" }
      ]
    },
    imagesetConfig: { graph: true }
  };

  const manual = buildFieldManual(state);

  // Should include oc-mirror instructions
  assert.ok(manual.includes("oc-mirror"), "Should mention oc-mirror");
  assert.ok(manual.includes("imageset-config.yaml"), "Should reference imageset-config.yaml");

  // Should include operator information
  assert.ok(manual.includes("KubeVirt") || manual.includes("kubevirt"), "Should mention selected operator");

  // Should NOT include install-config instructions (disconnected mode only)
  assert.ok(!manual.includes("openshift-install create cluster"), "Should not include cluster creation commands");
});

test("buildFieldManual for disconnected mode includes install instructions", () => {
  const state = {
    docs: { connectivity: "fully-disconnected" },
    blueprint: { platform: "bare-metal", architecture: "x86_64" },
    methodology: { installMethod: "agent" },
    release: { patchVersion: "4.20.5", confirmed: true },
    version: { selectedVersion: "4.20", confirmed: true },
    credentials: {
      pullSecret: '{"auths":{}}',
      sshPublicKey: "ssh-rsa AAAAB3NzaC1yc2E..."
    },
    networkWide: {
      clusterName: "test-cluster",
      baseDomain: "example.com",
      machineNetwork: "10.90.0.0/24"
    },
    operators: { selected: [] }
  };

  const manual = buildFieldManual(state);

  // Disconnected mode should include install-config references
  assert.ok(manual.includes("install-config") || manual.includes("agent-config"), "Should reference install configs");
});
