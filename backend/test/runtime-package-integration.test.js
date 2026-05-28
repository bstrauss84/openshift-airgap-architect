/**
 * Runtime Package Integration Tests (DOC-083)
 *
 * Tests integration of high-side runtime package export into bundle creation.
 * Verifies that when includeHighSideRuntimePackage is enabled, the export
 * bundle contains all expected runtime package artifacts.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRuntimePackageArtifacts } from "../src/runtimePackage.js";

// Minimal state for testing
const createMinimalState = () => ({
  blueprint: { platform: "Bare Metal" },
  methodology: { method: "Agent-Based Installer" },
  release: { patchVersion: "4.20.0" },
  version: { versionConfirmed: true },
  exportOptions: {
    includeHighSideRuntimePackage: true
  }
});

describe("Runtime package integration", () => {
  let tempDir;

  before(() => {
    // Set fixture mode to avoid requiring actual container images
    process.env.AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE = "fixture";
  });

  after(() => {
    delete process.env.AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE;
  });

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-package-test-"));
  });

  it("createRuntimePackageArtifacts returns expected structure when requested", () => {
    const state = createMinimalState();
    const runPayload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      sourceProfile: "connected-authoring",
      state,
      version: "4.20",
      platform: "Bare Metal",
      method: "Agent-Based Installer"
    };

    const result = createRuntimePackageArtifacts({
      state,
      exportOptions: { includeHighSideRuntimePackage: true },
      runPayload,
      dataDir: tempDir
    });

    assert.equal(result.requested, true, "Runtime package should be requested");
    assert.equal(result.included, true, "Runtime package should be included in fixture mode");
    assert.ok(Array.isArray(result.entries), "Should return entries array");
    assert.ok(Array.isArray(result.imageEntries), "Should return imageEntries array");
    assert.ok(Array.isArray(result.notes), "Should return notes array");
  });

  it("returns all required artifact files", () => {
    const state = createMinimalState();
    const runPayload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      sourceProfile: "connected-authoring",
      state,
      version: "4.20"
    };

    const result = createRuntimePackageArtifacts({
      state,
      exportOptions: { includeHighSideRuntimePackage: true },
      runPayload,
      dataDir: tempDir
    });

    // Check that all required files are present
    const expectedFiles = [
      "compose/high-side.compose.yml",
      "launch/load-runtime-images.sh",
      "launch/start-high-side.sh",
      "payloads/imported-run.bundle.json",
      "HIGH_SIDE_STARTUP_GUIDE.md",
      "HIGH_SIDE_RUNTIME_PACKAGE_MANIFEST.json",
      "SHA256SUMS.txt"
    ];

    const entryPaths = result.entries.map(e => e.relativePath);
    for (const expected of expectedFiles) {
      assert.ok(
        entryPaths.includes(expected),
        `Expected file ${expected} not found in entries. Got: ${entryPaths.join(", ")}`
      );
    }
  });

  it("includes 2 image archives (backend + frontend) in fixture mode", () => {
    const state = createMinimalState();
    const runPayload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      sourceProfile: "connected-authoring",
      state,
      version: "4.20"
    };

    const result = createRuntimePackageArtifacts({
      state,
      exportOptions: { includeHighSideRuntimePackage: true },
      runPayload,
      dataDir: tempDir
    });

    assert.equal(result.imageEntries.length, 2, "Should have 2 image entries (backend + frontend)");

    const roles = result.imageEntries.map(e => e.role).sort();
    assert.deepEqual(roles, ["backend", "frontend"], "Should have backend and frontend roles");

    // Check that image entries are also in main entries array
    const imageRelativePaths = result.imageEntries.map(e => `images/${e.archiveName}`);
    const entryPaths = result.entries.map(e => e.relativePath);
    for (const imagePath of imageRelativePaths) {
      assert.ok(
        entryPaths.includes(imagePath),
        `Image archive ${imagePath} not found in entries`
      );
    }
  });

  it("creates executable launch scripts", () => {
    const state = createMinimalState();
    const runPayload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      sourceProfile: "connected-authoring",
      state,
      version: "4.20"
    };

    const result = createRuntimePackageArtifacts({
      state,
      exportOptions: { includeHighSideRuntimePackage: true },
      runPayload,
      dataDir: tempDir
    });

    const scripts = result.entries.filter(e => e.relativePath.startsWith("launch/") && e.relativePath.endsWith(".sh"));
    assert.equal(scripts.length, 2, "Should have 2 launch scripts");

    // Verify scripts are executable (0o755)
    for (const script of scripts) {
      const stat = fs.statSync(script.absolutePath);
      const mode = stat.mode & 0o777;
      assert.equal(mode, 0o755, `Script ${script.relativePath} should be executable (755)`);
    }
  });

  it("includes payload file with state data", () => {
    const state = createMinimalState();
    const runPayload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      sourceProfile: "connected-authoring",
      state,
      version: "4.20",
      platform: "Bare Metal"
    };

    const result = createRuntimePackageArtifacts({
      state,
      exportOptions: { includeHighSideRuntimePackage: true },
      runPayload,
      dataDir: tempDir
    });

    const payloadEntry = result.entries.find(e => e.relativePath === "payloads/imported-run.bundle.json");
    assert.ok(payloadEntry, "Should have payload file");

    // Verify payload content
    const payloadContent = JSON.parse(fs.readFileSync(payloadEntry.absolutePath, "utf-8"));
    assert.equal(payloadContent.schemaVersion, 1, "Payload should have schemaVersion 1");
    assert.equal(payloadContent.sourceProfile, "connected-authoring", "Payload should have sourceProfile");
    assert.ok(payloadContent.state, "Payload should contain state");
    assert.equal(payloadContent.platform, "Bare Metal", "Payload should have platform");
  });

  it("creates manifest with correct metadata", () => {
    const state = createMinimalState();
    const runPayload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      sourceProfile: "connected-authoring",
      state,
      version: "4.20"
    };

    const result = createRuntimePackageArtifacts({
      state,
      exportOptions: { includeHighSideRuntimePackage: true },
      runPayload,
      dataDir: tempDir
    });

    const manifestEntry = result.entries.find(e => e.relativePath === "HIGH_SIDE_RUNTIME_PACKAGE_MANIFEST.json");
    assert.ok(manifestEntry, "Should have manifest file");

    const manifest = JSON.parse(fs.readFileSync(manifestEntry.absolutePath, "utf-8"));
    assert.equal(manifest.schemaVersion, 1, "Manifest should have schemaVersion 1");
    assert.ok(manifest.generatedAt, "Manifest should have generatedAt timestamp");
    assert.deepEqual(manifest.hostSupportScope, ["rhel8", "rhel9"], "Manifest should specify host support scope");
    assert.equal(manifest.localhostOnlyByDefault, true, "Manifest should specify localhost-only binding");
    assert.equal(manifest.disconnectedProfile, "disconnected-execution", "Manifest should specify disconnected profile");
    assert.ok(manifest.payloads, "Manifest should have payloads section");
    assert.equal(manifest.payloads.bundledCount, 1, "Manifest should show 1 bundled payload");
    assert.ok(Array.isArray(manifest.images), "Manifest should have images array");
    assert.equal(manifest.images.length, 2, "Manifest should list 2 images");
  });

  it("creates SHA256SUMS.txt with all file checksums", () => {
    const state = createMinimalState();
    const runPayload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      sourceProfile: "connected-authoring",
      state,
      version: "4.20"
    };

    const result = createRuntimePackageArtifacts({
      state,
      exportOptions: { includeHighSideRuntimePackage: true },
      runPayload,
      dataDir: tempDir
    });

    const checksumsEntry = result.entries.find(e => e.relativePath === "SHA256SUMS.txt");
    assert.ok(checksumsEntry, "Should have SHA256SUMS.txt file");

    const checksums = fs.readFileSync(checksumsEntry.absolutePath, "utf-8");
    const lines = checksums.trim().split("\n");

    // Should have checksums for all files except SHA256SUMS.txt itself
    const expectedCount = result.entries.length - 1;
    assert.equal(lines.length, expectedCount, `Should have ${expectedCount} checksum lines`);

    // Verify checksum format (64-char hex + 2 spaces + filepath)
    for (const line of lines) {
      assert.match(line, /^[a-f0-9]{64}  .+$/, `Invalid checksum format: ${line}`);
    }
  });

  it("returns requested=false when not requested", () => {
    const state = createMinimalState();
    state.exportOptions.includeHighSideRuntimePackage = false;

    const runPayload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      sourceProfile: "connected-authoring",
      state,
      version: "4.20"
    };

    const result = createRuntimePackageArtifacts({
      state,
      exportOptions: { includeHighSideRuntimePackage: false },
      runPayload,
      dataDir: tempDir
    });

    assert.equal(result.requested, false, "Runtime package should not be requested");
    assert.equal(result.included, false, "Runtime package should not be included");
    assert.equal(result.entries.length, 0, "Should have no entries");
    assert.ok(result.notes.length > 0, "Should have notes explaining why not included");
  });

  it("creates compose file with correct environment variables", () => {
    const state = createMinimalState();
    const runPayload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      sourceProfile: "connected-authoring",
      state,
      version: "4.20"
    };

    const result = createRuntimePackageArtifacts({
      state,
      exportOptions: { includeHighSideRuntimePackage: true },
      runPayload,
      dataDir: tempDir
    });

    const composeEntry = result.entries.find(e => e.relativePath === "compose/high-side.compose.yml");
    assert.ok(composeEntry, "Should have compose file");

    const composeContent = fs.readFileSync(composeEntry.absolutePath, "utf-8");

    // Verify critical environment variables
    assert.ok(composeContent.includes("AIRGAP_RUNTIME_SIDE=high-side"), "Compose should set AIRGAP_RUNTIME_SIDE");
    assert.ok(composeContent.includes("AIRGAP_PRELOAD_ON_START=true"), "Compose should enable preload");
    assert.ok(composeContent.includes("AIRGAP_BUNDLED_PAYLOADS_DIR=/opt/airgap/payloads"), "Compose should set payloads dir");

    // Verify volume mounts
    assert.ok(composeContent.includes("- backend-data:/data"), "Compose should mount backend data volume");
    assert.ok(composeContent.includes("/opt/airgap/payloads:ro,Z"), "Compose should mount payloads directory read-only with SELinux label");
  });

  it("creates startup guide with correct instructions", () => {
    const state = createMinimalState();
    const runPayload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      sourceProfile: "connected-authoring",
      state,
      version: "4.20"
    };

    const result = createRuntimePackageArtifacts({
      state,
      exportOptions: { includeHighSideRuntimePackage: true },
      runPayload,
      dataDir: tempDir
    });

    const guideEntry = result.entries.find(e => e.relativePath === "HIGH_SIDE_STARTUP_GUIDE.md");
    assert.ok(guideEntry, "Should have startup guide");

    const guide = fs.readFileSync(guideEntry.absolutePath, "utf-8");

    // Verify guide contains key sections
    assert.ok(guide.includes("# High-Side Runtime Startup Guide"), "Guide should have title");
    assert.ok(guide.includes("## What was exported"), "Guide should list exported artifacts");
    assert.ok(guide.includes("## Host support scope"), "Guide should specify host support");
    assert.ok(guide.includes("## Startup flow (localhost-first)"), "Guide should have startup instructions");
    assert.ok(guide.includes("sha256sum -c SHA256SUMS.txt"), "Guide should mention checksum verification");
    assert.ok(guide.includes("bash launch/load-runtime-images.sh"), "Guide should mention image loading");
    assert.ok(guide.includes("bash launch/start-high-side.sh"), "Guide should mention runtime startup");
    assert.ok(guide.includes("## Bundled payload preload behavior"), "Guide should explain payload preload");
    assert.ok(guide.includes("## Remote access from another approved high-side workstation"), "Guide should cover remote access");
    assert.ok(guide.includes("## Firewall and exposure caveats"), "Guide should have security warnings");
  });
});
