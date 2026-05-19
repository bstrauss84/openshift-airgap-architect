/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * Tests for smart retry signature error handling (DOC-079 v1.5.0)
 *
 * Tests per-image signature disabling with automatic retry logic:
 * - parseSignatureErrors() extracts failing image paths from oc-mirror logs
 * - writePerImageRegistriesDConfigs() generates per-image registries.d YAML configs
 */
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseSignatureErrors, writePerImageRegistriesDConfigs } from "../src/index.js";

test("parseSignatureErrors extracts single image path from signature error log", () => {
  const logOutput = `
[ERROR] 2024-05-18 15:00:27 [Worker] error mirroring image docker://registry.connect.redhat.com/netapp/trident-operator@sha256:210590c60ca7855046d73ab9b502c6d6d40fc430a98e05f1ef37ad2e0df97bd4 (Operator bundles: [trident-operator.v26.2.1] - Operators: [trident-operator]) error: reading signatures: reading manifest sha256-210590c60ca7855046d73ab9b502c6d6d40fc430a98e05f1ef37ad2e0df97bd4.sig in registry.connect.redhat.com/netapp/trident-operator: name unknown: Image not found
  `;

  const failures = parseSignatureErrors(logOutput);

  assert.strictEqual(failures.length, 1);
  assert.strictEqual(failures[0], "registry.connect.redhat.com/netapp/trident-operator");
});

test("parseSignatureErrors extracts multiple unique image paths", () => {
  const logOutput = `
error mirroring image docker://registry.connect.redhat.com/netapp/trident-operator@sha256:abc123 error: reading signatures: reading manifest sha256-abc123.sig in registry.connect.redhat.com/netapp/trident-operator: name unknown: Image not found
error mirroring image docker://registry.connect.redhat.com/netapp/trident-operator-bundle@sha256:def456 error: reading signatures: reading manifest sha256-def456.sig in registry.connect.redhat.com/netapp/trident-operator-bundle: name unknown: Image not found
error mirroring image docker://registry.connect.redhat.com/netapp/trident-operator@sha256:xyz789 error: reading signatures: reading manifest sha256-xyz789.sig in registry.connect.redhat.com/netapp/trident-operator: name unknown: Image not found
  `;

  const failures = parseSignatureErrors(logOutput);

  assert.strictEqual(failures.length, 2, "Should deduplicate same image path");
  assert.ok(failures.includes("registry.connect.redhat.com/netapp/trident-operator"));
  assert.ok(failures.includes("registry.connect.redhat.com/netapp/trident-operator-bundle"));
});

test("parseSignatureErrors ignores non-signature errors", () => {
  const logOutput = `
[ERROR] Some other error
error mirroring image docker://registry.connect.redhat.com/netapp/trident-operator@sha256:abc123 error: timeout
error mirroring image docker://quay.io/some/image@sha256:def456 error: network error
  `;

  const failures = parseSignatureErrors(logOutput);

  assert.strictEqual(failures.length, 0, "Should not match non-signature errors");
});

test("parseSignatureErrors returns empty array when no errors", () => {
  const logOutput = `
✓ 190 / 190 release images mirrored successfully
✓ 100 / 100 operator images mirrored successfully
  `;

  const failures = parseSignatureErrors(logOutput);

  assert.strictEqual(failures.length, 0);
});

test("writePerImageRegistriesDConfigs generates correct YAML format", () => {
  const imagePaths = [
    "registry.connect.redhat.com/netapp/trident-operator",
    "registry.connect.redhat.com/netapp/trident-operator-bundle"
  ];

  const dir = writePerImageRegistriesDConfigs(imagePaths);

  try {
    assert.ok(dir, "Should return directory path");
    assert.ok(fs.existsSync(dir), "Directory should exist");

    const files = fs.readdirSync(dir);
    assert.strictEqual(files.length, 2, "Should create 2 YAML files");

    // Check first config file
    const config1Path = path.join(dir, files[0]);
    const config1Content = fs.readFileSync(config1Path, "utf8");

    assert.ok(config1Content.includes("docker:"), "Should have docker: key");
    assert.ok(config1Content.includes("use-sigstore-attachments: false"), "Should disable sigstore attachments");
    assert.ok(
      config1Content.includes("registry.connect.redhat.com/netapp/trident-operator"),
      "Should include image path"
    );

    // Check filename sanitization
    assert.ok(
      files[0].includes("registry.connect.redhat.com-netapp"),
      "Should sanitize slashes to dashes in filename"
    );
    assert.ok(files[0].endsWith(".yaml"), "Should have .yaml extension");

    // Verify YAML structure (indentation matters for registries.d)
    const lines = config1Content.split("\n");
    assert.strictEqual(lines[0], "docker:", "First line should be 'docker:'");
    assert.ok(lines[1].startsWith("  "), "Image path should be indented 2 spaces");
    assert.ok(lines[2].startsWith("    "), "use-sigstore-attachments should be indented 4 spaces");
  } finally {
    // Cleanup
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("writePerImageRegistriesDConfigs returns null for empty array", () => {
  const dir = writePerImageRegistriesDConfigs([]);
  assert.strictEqual(dir, null, "Should return null for empty array");
});

test("writePerImageRegistriesDConfigs returns null for null input", () => {
  const dir = writePerImageRegistriesDConfigs(null);
  assert.strictEqual(dir, null, "Should return null for null input");
});

test("writePerImageRegistriesDConfigs creates unique temp directory each call", () => {
  const imagePaths = ["registry.connect.redhat.com/test/image"];

  const dir1 = writePerImageRegistriesDConfigs(imagePaths);
  const dir2 = writePerImageRegistriesDConfigs(imagePaths);

  try {
    assert.ok(dir1, "First call should return directory");
    assert.ok(dir2, "Second call should return directory");
    assert.notStrictEqual(dir1, dir2, "Should create unique directories");

    assert.ok(fs.existsSync(dir1), "First directory should exist");
    assert.ok(fs.existsSync(dir2), "Second directory should exist");
  } finally {
    // Cleanup
    if (dir1 && fs.existsSync(dir1)) fs.rmSync(dir1, { recursive: true, force: true });
    if (dir2 && fs.existsSync(dir2)) fs.rmSync(dir2, { recursive: true, force: true });
  }
});

test("parseSignatureErrors handles real NetApp Trident error format", () => {
  // Real error message from /home/billstrauss/local-oc-mirror/archives1/working-dir/logs/
  const logOutput = `
2024-05-18T15:00:27-04:00 [ERROR] [Worker] error mirroring image docker://registry.connect.redhat.com/netapp/trident-operator@sha256:210590c60ca7855046d73ab9b502c6d6d40fc430a98e05f1ef37ad2e0df97bd4 (Operator bundles: [trident-operator.v26.2.1] - Operators: [trident-operator]) error: reading signatures: reading manifest sha256-210590c60ca7855046d73ab9b502c6d6d40fc430a98e05f1ef37ad2e0df97bd4.sig in registry.connect.redhat.com/netapp/trident-operator: name unknown: Image not found
  `;

  const failures = parseSignatureErrors(logOutput);

  assert.strictEqual(failures.length, 1);
  assert.strictEqual(
    failures[0],
    "registry.connect.redhat.com/netapp/trident-operator",
    "Should extract NetApp Trident operator image path"
  );
});

test("writePerImageRegistriesDConfigs handles complex image paths with ports", () => {
  const imagePaths = [
    "my-registry.example.com:5000/vendor/product",
    "registry.io:443/namespace/image-name"
  ];

  const dir = writePerImageRegistriesDConfigs(imagePaths);

  try {
    assert.ok(dir);
    const files = fs.readdirSync(dir);
    assert.strictEqual(files.length, 2);

    // Check that colons in port numbers are sanitized
    assert.ok(
      files.some(f => f.includes("my-registry.example.com-5000")),
      "Should sanitize port colon to dash"
    );
  } finally {
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
});
