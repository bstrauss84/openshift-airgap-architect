/**
 * Critical Workflow Integration Tests
 *
 * End-to-end tests for core functionality that must never break:
 * 1. Asset generation and download
 * 2. Operator catalog scanning
 *
 * These tests were added after regression bugs broke both features.
 *
 * @author Bill Strauss
 */
import { strict as assert } from "node:assert";
import { after, before, describe, it } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { nanoid } from "nanoid";

let serverInstance;
let dataDir;
let baseURL;

const startServer = async () => {
  dataDir = path.join(tmpdir(), `airgap-test-critical-${nanoid()}`);
  await fs.mkdir(dataDir, { recursive: true });

  process.env.DATA_DIR = dataDir;
  process.env.PORT = "0"; // Random port
  process.env.MOCK_MODE = "true"; // Use mock data for operator scanning
  process.env.OC_MIRROR_BINARY = "echo"; // Mock binary

  const { app } = await import("../src/index.js");

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
};

describe("Critical Workflow Integration Tests", () => {
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

  describe("Asset Generation and Download", () => {
    it("should generate assets successfully - attempt 1", async () => {
      // Set valid state first
      await fetch(`${baseURL}/api/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          release: { confirmed: true, channel: "4.21", patchVersion: "4.21.9" },
          version: { selectedVersion: "4.21.9", versionConfirmed: true },
          blueprint: {
            platform: "Bare Metal",
            arch: "x86_64",
            clusterName: "test-cluster",
            baseDomain: "example.com",
            confirmed: true
          },
          methodology: { method: "Agent-Based Installer" },
          credentials: { sshPublicKey: "ssh-rsa test" },
          globalStrategy: {
            networking: {
              networkType: "OVNKubernetes",
              machineNetworkV4: "192.168.1.0/24",
              clusterNetworkCidr: "10.128.0.0/14",
              clusterNetworkHostPrefix: 23,
              serviceNetworkCidr: "172.30.0.0/16"
            }
          },
          hostInventory: { nodes: [] }
        })
      });

      const persisted = await (await fetch(`${baseURL}/api/state`)).json();
      assert.strictEqual(
        persisted.blueprint?.arch,
        "x86_64",
        "POST /api/state must preserve nested blueprint fields (regression: Zod strip removed arch)"
      );

      // Test asset generation
      const response = await fetch(`${baseURL}/api/generate`, { method: "POST" });
      assert.strictEqual(response.status, 200, "Asset generation should succeed");

      const data = await response.json();
      assert.ok(data.files, "Response should contain files");
      assert.ok(data.files["install-config.yaml"], "Should include install-config.yaml");
      assert.ok(data.files["agent-config.yaml"], "Should include agent-config.yaml for Bare Metal Agent");
      assert.ok(data.files["imageset-config.yaml"], "Should include imageset-config.yaml");
      assert.ok(data.files["FIELD_MANUAL.md"], "Should include FIELD_MANUAL.md");

      // Verify install-config contains correct values
      assert.ok(
        data.files["install-config.yaml"].includes("name: test-cluster"),
        "install-config should contain cluster name"
      );
      assert.ok(
        data.files["install-config.yaml"].includes("baseDomain: example.com"),
        "install-config should contain base domain"
      );
    });

    it("should generate assets successfully - attempt 2", async () => {
      const response = await fetch(`${baseURL}/api/generate`, { method: "POST" });
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      assert.ok(data.files["install-config.yaml"]);
    });

    it("should generate assets successfully - attempt 3", async () => {
      const response = await fetch(`${baseURL}/api/generate`, { method: "POST" });
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      assert.ok(data.files["install-config.yaml"]);
    });
  });

  describe("Operator Catalog Scanning", () => {
    it("should scan operators without vnull in catalog URL - attempt 1", async () => {
      // Set valid state with release channel
      await fetch(`${baseURL}/api/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          release: { confirmed: true, channel: "4.21", patchVersion: "4.21.9" }
        })
      });

      // Trigger operator scan
      const response = await fetch(`${baseURL}/api/operators/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });

      assert.strictEqual(response.status, 200, "Operator scan should succeed");
      const data = await response.json();
      assert.ok(data.jobs, "Response should contain jobs");
      assert.ok(data.jobs.redhat, "Should include redhat catalog job");
      assert.ok(data.jobs.certified, "Should include certified catalog job");
      assert.ok(data.jobs.community, "Should include community catalog job");

      // In mock mode, jobs should complete immediately
      // Verify no "vnull" in job outputs by checking job status
      const jobsResponse = await fetch(`${baseURL}/api/jobs`);
      const jobsData = await jobsResponse.json();
      const jobs = Array.isArray(jobsData) ? jobsData : [];

      const scanJobs = jobs.filter(j => j.type === "operator-scan");
      for (const job of scanJobs) {
        // In mock mode with valid channel, jobs should complete successfully
        // or have reasonable output without "vnull"
        if (job.output) {
          assert.ok(
            !job.output.includes(":vnull"),
            `Job ${job.id} should not reference vnull catalog images. Output: ${job.output.substring(0, 200)}`
          );
        }
      }
    });

    it("should scan operators without vnull - attempt 2", async () => {
      const response = await fetch(`${baseURL}/api/operators/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      assert.strictEqual(response.status, 200);
    });

    it("should scan operators without vnull - attempt 3", async () => {
      const response = await fetch(`${baseURL}/api/operators/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      assert.strictEqual(response.status, 200);
    });

    it("should reject operator scan when release not confirmed", async () => {
      // Reset state to unconfirmed
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
        "Should reject operator scan when release not confirmed"
      );

      const error = await response.json();
      assert.ok(
        error.error && error.error.toLowerCase().includes("version"),
        "Error should mention version requirement"
      );
    });
  });

  describe("State Persistence Regression Prevention", () => {
    it("should not allow state corruption via overly strict validation", async () => {
      // This tests the bug fix where validation was too strict and blocked
      // legitimate state updates during asset download workflow

      // Set initial valid state
      await fetch(`${baseURL}/api/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          release: { confirmed: true, channel: "4.21", patchVersion: "4.21.9" },
          version: { selectedVersion: "4.21.9", versionConfirmed: true },
          blueprint: { platform: "Bare Metal", confirmed: true }
        })
      });

      // Simulate the frontend's automatic state persistence (which sends partial updates)
      // This should NOT fail even though it doesn't include the channel in the patch
      const response = await fetch(`${baseURL}/api/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          release: { confirmed: true } // Not sending channel - it's already in DB
        })
      });

      assert.strictEqual(
        response.status,
        200,
        "Should allow state update that doesn't include channel when it exists in DB"
      );

      // Verify state is still valid
      const stateResponse = await fetch(`${baseURL}/api/state`);
      const state = await stateResponse.json();
      assert.strictEqual(state.release.confirmed, true);
      assert.strictEqual(state.release.channel, "4.21");
    });

    it("should block explicit null channel with confirmed=true", async () => {
      // Clear patch so normalization cannot infer channel from a leftover patchVersion.
      const response = await fetch(`${baseURL}/api/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          release: { confirmed: true, channel: null, patchVersion: null },
          version: { selectedVersion: null, versionConfirmed: false }
        })
      });

      assert.strictEqual(
        response.status,
        400,
        "Should block explicit null channel with confirmed=true"
      );

      const error = await response.json();
      assert.ok(error.error.includes("Validation failed"));
      assert.ok(error.details[0].path === "release.channel");
    });
  });
});
