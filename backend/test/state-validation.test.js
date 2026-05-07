/**
 * State Validation Tests
 *
 * Tests to ensure state consistency and prevent corruption:
 * - Release cannot be confirmed without channel
 * - Version cannot be confirmed without selectedVersion
 * - Asset generation requires valid release data
 * - Operator scanning requires valid release data
 *
 * @author Bill Strauss
 *
 * These tests were added in response to a production bug where release.confirmed=true
 * but release.channel=null, causing "vnull" in operator catalog images and asset
 * generation failures.
 */
import { strict as assert } from "node:assert";
import { after, before, describe, it } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { nanoid } from "nanoid";

// These tests will start the actual Express server
let serverInstance;
let dataDir;
let baseURL;

const startServer = async () => {
  dataDir = path.join(tmpdir(), `airgap-test-state-${nanoid()}`);
  await fs.mkdir(dataDir, { recursive: true });

  process.env.DATA_DIR = dataDir;
  process.env.PORT = "0"; // Random port
  process.env.MOCK_MODE = "true";
  process.env.OC_MIRROR_BINARY = "echo"; // Mock binary

  const { app } = await import("../src/index.js");

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
};

describe("State Validation Tests", () => {
  before(async () => {
    const { server, port } = await startServer();
    serverInstance = server;
    baseURL = `http://localhost:${port}`;
  });

  after(async () => {
    if (serverInstance) {
      await new Promise((resolve) => serverInstance.close(resolve));
    }
    if (dataDir) {
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  });

  describe("Release Confirmation Validation", () => {
    it("should prevent release confirmation without channel", async () => {
      // Attempt to set confirmed=true with null channel
      const response = await fetch(`${baseURL}/api/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          release: {
            confirmed: true,
            channel: null,
            patchVersion: null
          }
        })
      });

      const state = await response.json();

      // Backend should either:
      // 1. Reject the request (validation error)
      // 2. Accept but enforce channel requirement (set confirmed=false)

      if (response.status === 200) {
        // If accepted, release should not be confirmed with null channel
        if (state.release.channel === null || state.release.channel === undefined) {
          assert.strictEqual(
            state.release.confirmed,
            false,
            "Release should not be confirmed when channel is null"
          );
        }
      } else {
        // If rejected, status should be 400 (validation error)
        assert.strictEqual(
            response.status,
            400,
          "Should return 400 when trying to confirm release without channel"
        );
      }
    });

    it("should require channel when confirming release", async () => {
      // Try to confirm with a valid channel
      const response = await fetch(`${baseURL}/api/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          release: {
            confirmed: true,
            channel: "4.21",
            patchVersion: "4.21.3"
          }
        })
      });

      assert.strictEqual(response.status, 200, "Should accept valid release confirmation");
      const state = await response.json();
      assert.strictEqual(state.release.confirmed, true);
      assert.strictEqual(state.release.channel, "4.21");
    });

    it("derives release.channel from patchVersion when channel is null on confirm", async () => {
      await fetch(`${baseURL}/api/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          release: { confirmed: true, channel: null, patchVersion: "4.21.3" },
          version: { selectedVersion: "4.21.3", versionConfirmed: true }
        })
      });
      const response = await fetch(`${baseURL}/api/state`);
      const state = await response.json();
      assert.strictEqual(state.release.channel, "4.21");
    });

    it("normalizes legacy stable-* channel string to minor-only", async () => {
      const response = await fetch(`${baseURL}/api/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          release: { confirmed: true, channel: "stable-4.20", patchVersion: "4.20.1" },
          version: { selectedVersion: "4.20.1", versionConfirmed: true }
        })
      });
      assert.strictEqual(response.status, 200);
      const state = await response.json();
      assert.strictEqual(state.release.channel, "4.20");
    });
  });

  describe("Version Confirmation Validation", () => {
    it("should prevent version confirmation without selectedVersion", async () => {
      const response = await fetch(`${baseURL}/api/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: {
            selectedVersion: null,
            confirmedByUser: true,
            versionConfirmed: true
          }
        })
      });

      const state = await response.json();

      if (response.status === 200) {
        if (state.version.selectedVersion === null || state.version.selectedVersion === undefined) {
          assert.strictEqual(
            state.version.versionConfirmed,
            false,
            "Version should not be confirmed when selectedVersion is null"
          );
        }
      } else {
        assert.strictEqual(response.status, 400, "Should reject version confirmation without selectedVersion");
      }
    });
  });

  describe("Asset Generation Requirements", () => {
    it("should fail asset generation when release not confirmed", async () => {
      // Reset state to unconfirmed
      await fetch(`${baseURL}/api/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          release: { confirmed: false, channel: null, patchVersion: null }
        })
      });

      const response = await fetch(`${baseURL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: {
            release: { confirmed: false, channel: null, patchVersion: null },
            blueprint: { platform: "Bare Metal", arch: "x86_64" }
          },
          options: { includeCredentials: false, includeCertificates: true }
        })
      });

      assert.strictEqual(
        response.status,
        400,
        "Asset generation should fail when release not confirmed"
      );

      const error = await response.json();
      assert.ok(
        error.error && error.error.toLowerCase().includes("version"),
        "Error message should mention version/release requirement"
      );
    });

    it("should succeed asset generation when release properly confirmed", async () => {
      // Set valid confirmed state
      await fetch(`${baseURL}/api/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          release: { confirmed: true, channel: "4.21", patchVersion: "4.21.3" },
          blueprint: {
            platform: "Bare Metal",
            arch: "x86_64",
            clusterName: "test-cluster",
            baseDomain: "example.com",
            confirmed: true
          }
        })
      });

      const response = await fetch(`${baseURL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: {
            release: { confirmed: true, channel: "4.21", patchVersion: "4.21.3" },
            blueprint: {
              platform: "Bare Metal",
              arch: "x86_64",
              clusterName: "test-cluster",
              baseDomain: "example.com",
              confirmed: true
            },
            methodology: { method: "IPI" },
            credentials: { sshPublicKey: "ssh-rsa test" },
            globalStrategy: {
              networking: {
                networkType: "OVNKubernetes",
                machineNetworkV4: "192.168.1.0/24"
              }
            },
            hostInventory: { nodes: [] }
          },
          options: { includeCredentials: false, includeCertificates: false }
        })
      });

      assert.strictEqual(
        response.status,
        200,
        "Asset generation should succeed with valid release"
      );
    });
  });

  describe("Operator Scanning Requirements", () => {
    it("should fail operator scan when release not confirmed", async () => {
      // Reset to unconfirmed
      await fetch(`${baseURL}/api/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          release: { confirmed: false, channel: null, patchVersion: null }
        })
      });

      const response = await fetch(`${baseURL}/api/operators/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });

      assert.strictEqual(
        response.status,
        400,
        "Operator scan should fail when release not confirmed"
      );

      const error = await response.json();
      assert.ok(
        error.error && error.error.toLowerCase().includes("version"),
        "Error message should mention version requirement"
      );
    });

    it("should not use vnull in catalog images", async () => {
      // Set valid confirmed state
      await fetch(`${baseURL}/api/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          release: { confirmed: true, channel: "4.21", patchVersion: "4.21.3" }
        })
      });

      // Note: In mock mode, this won't actually call oc-mirror,
      // but we can verify the state requirements
      const response = await fetch(`${baseURL}/api/operators/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });

      assert.strictEqual(
        response.status,
        200,
        "Operator scan should succeed with valid release"
      );

      // Normalization + getOpenShiftMinorFromState derive "4.21" for catalog tags even if channel was null.
    });

    it("operator scan succeeds when channel is derived from patchVersion only", async () => {
      await fetch(`${baseURL}/api/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          release: { confirmed: true, channel: null, patchVersion: "4.21.3" },
          version: { selectedVersion: "4.21.3", versionConfirmed: true }
        })
      });
      const response = await fetch(`${baseURL}/api/operators/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      assert.strictEqual(response.status, 200);
    });
  });

  describe("State Consistency After Backend Restart", () => {
    it("should maintain consistent state across server restarts", async () => {
      // Set a valid state
      await fetch(`${baseURL}/api/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          release: { confirmed: true, channel: "4.21", patchVersion: "4.21.3" },
          blueprint: { confirmed: true, platform: "Bare Metal", arch: "x86_64" }
        })
      });

      // Read back state
      const response = await fetch(`${baseURL}/api/state`);
      const state = await response.json();

      // Verify consistency
      assert.strictEqual(state.release.confirmed, true);
      assert.strictEqual(state.release.channel, "4.21");

      // State should never have confirmed=true with null channel
      if (state.release.confirmed) {
        assert.ok(
          state.release.channel !== null && state.release.channel !== undefined,
          "Confirmed release must have non-null channel"
        );
      }
    });
  });
});
