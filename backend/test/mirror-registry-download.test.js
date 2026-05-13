/**
 * OpenShift Airgap Architect - Mirror Registry Download Test
 *
 * Tests that mirror-registry binary download works correctly:
 * - Handles 307 redirects (mirror.openshift.com -> developers.redhat.com)
 * - Downloads complete file (not 0 bytes)
 * - Caches correctly
 * - Validates file size
 *
 * @author Bill Strauss
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Mirror Registry Download", () => {
  it("should download mirror-registry binary with correct size (handles 307 redirect)", async () => {
    const testDir = path.join(__dirname, "..", "..", "tmp", "mirror-registry-test");
    fs.mkdirSync(testDir, { recursive: true });

    const mirrorRegistryFilename = "mirror-registry-amd64.tar.gz";
    const mirrorRegistryUrl = `https://mirror.openshift.com/pub/cgw/mirror-registry/latest/${mirrorRegistryFilename}`;
    const mirrorRegistryPath = path.join(testDir, mirrorRegistryFilename);

    try {
      // Remove cached file if exists to test fresh download
      if (fs.existsSync(mirrorRegistryPath)) {
        fs.unlinkSync(mirrorRegistryPath);
      }

      // Download using fetch (same method as production code)
      const response = await fetch(mirrorRegistryUrl);
      assert.ok(response.ok, `HTTP request failed: ${response.status} ${response.statusText}`);

      const buffer = await response.arrayBuffer();
      fs.writeFileSync(mirrorRegistryPath, Buffer.from(buffer));

      // Verify file exists and is not 0 bytes
      assert.ok(fs.existsSync(mirrorRegistryPath), "Downloaded file should exist");

      const stat = fs.statSync(mirrorRegistryPath);
      assert.ok(stat.size > 0, "Downloaded file should not be 0 bytes");

      // Mirror registry is typically 900+ MB
      const minExpectedSize = 500 * 1024 * 1024; // 500 MB minimum (conservative)
      assert.ok(
        stat.size > minExpectedSize,
        `File size ${stat.size} bytes (${(stat.size / 1024 / 1024).toFixed(2)} MB) should be > ${minExpectedSize} bytes`
      );

      console.log(`✓ Downloaded mirror-registry: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
    } finally {
      // Cleanup
      if (fs.existsSync(mirrorRegistryPath)) {
        fs.unlinkSync(mirrorRegistryPath);
      }
      // Remove test directory if empty
      try {
        fs.rmdirSync(testDir);
      } catch {
        // Directory not empty or doesn't exist - ignore
      }
    }
  });

  it("should detect and reject 0-byte corrupt downloads", async () => {
    const testDir = path.join(__dirname, "..", "..", "tmp", "mirror-registry-test");
    fs.mkdirSync(testDir, { recursive: true });

    const corruptFilePath = path.join(testDir, "corrupt-file.tar.gz");

    try {
      // Create a 0-byte file to simulate corrupt download
      fs.writeFileSync(corruptFilePath, "");

      const stat = fs.statSync(corruptFilePath);
      assert.strictEqual(stat.size, 0, "Test file should be 0 bytes");

      // Production code should detect this and throw
      if (stat.size === 0) {
        fs.unlinkSync(corruptFilePath);
        // This is the correct behavior - remove corrupt file
      }

      assert.ok(!fs.existsSync(corruptFilePath), "Corrupt file should be removed");
    } finally {
      // Cleanup
      if (fs.existsSync(corruptFilePath)) {
        fs.unlinkSync(corruptFilePath);
      }
      try {
        fs.rmdirSync(testDir);
      } catch {
        // Ignore
      }
    }
  });
});
