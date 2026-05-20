/**
 * OpenShift Airgap Architect - Health Probe Tests (PROD-006)
 *
 * Tests for liveness and readiness probe endpoints used in Kubernetes deployments.
 * Verifies proper response formats, DB health checking, and error handling.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
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
  dataDir = path.join(tmpdir(), `airgap-test-health-${nanoid()}`);
  await fs.mkdir(dataDir, { recursive: true });

  process.env.DATA_DIR = dataDir;
  process.env.PORT = "0"; // Random port
  process.env.NODE_ENV = "test";

  const { app } = await import("../src/index.js");

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
};

describe("Health Probe Tests", () => {
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

  // ===================================================================
  // Liveness Probe (/api/health) Tests
  // ===================================================================

  describe("Liveness Probe (/api/health)", () => {
    it("returns 200 OK", async () => {
      const response = await fetch(`${baseURL}/api/health`);
      assert.strictEqual(response.status, 200);
    });

    it("returns status field", async () => {
      const response = await fetch(`${baseURL}/api/health`);
      const data = await response.json();
      assert.strictEqual(data.status, "ok");
    });

    it("returns uptime field", async () => {
      const response = await fetch(`${baseURL}/api/health`);
      const data = await response.json();
      assert.ok(typeof data.uptime === "number", "uptime should be a number");
      assert.ok(data.uptime > 0, "uptime should be positive");
    });

    it("returns timestamp field", async () => {
      const response = await fetch(`${baseURL}/api/health`);
      const data = await response.json();
      assert.ok(data.timestamp, "timestamp should be present");
      // Verify it's a valid ISO 8601 timestamp
      const timestamp = new Date(data.timestamp);
      assert.ok(!isNaN(timestamp.getTime()), "timestamp should be valid ISO 8601");
    });

    it("response has correct structure", async () => {
      const response = await fetch(`${baseURL}/api/health`);
      const data = await response.json();
      assert.ok(data.status, "should have status field");
      assert.ok(data.timestamp, "should have timestamp field");
      assert.ok(typeof data.uptime === "number", "should have uptime field");
    });
  });

  // ===================================================================
  // Readiness Probe (/api/ready) Tests - Success Cases
  // ===================================================================

  describe("Readiness Probe (/api/ready) - Success Cases", () => {
    it("returns 200 OK when DB is healthy", async () => {
      const response = await fetch(`${baseURL}/api/ready`);
      assert.strictEqual(response.status, 200);
    });

    it("returns ready: true when healthy", async () => {
      const response = await fetch(`${baseURL}/api/ready`);
      const data = await response.json();
      assert.strictEqual(data.ready, true);
    });

    it("returns database_read: ok", async () => {
      const response = await fetch(`${baseURL}/api/ready`);
      const data = await response.json();
      assert.strictEqual(data.checks.database_read, "ok");
    });

    it("returns database_write: ok", async () => {
      const response = await fetch(`${baseURL}/api/ready`);
      const data = await response.json();
      assert.strictEqual(data.checks.database_write, "ok");
    });

    it("includes timestamp in response", async () => {
      const response = await fetch(`${baseURL}/api/ready`);
      const data = await response.json();
      assert.ok(data.timestamp, "timestamp should be present");
      const timestamp = new Date(data.timestamp);
      assert.ok(!isNaN(timestamp.getTime()), "timestamp should be valid ISO 8601");
    });
  });

  // ===================================================================
  // Integration Tests
  // ===================================================================

  describe("Integration Tests", () => {
    it("health and readiness probes work independently", async () => {
      // Liveness should always succeed (process health only)
      const healthResponse = await fetch(`${baseURL}/api/health`);
      assert.strictEqual(healthResponse.status, 200);

      // Readiness should succeed when DB is healthy
      const readyResponse = await fetch(`${baseURL}/api/ready`);
      assert.strictEqual(readyResponse.status, 200);
    });

    it("readiness probe checks both read and write", async () => {
      const response = await fetch(`${baseURL}/api/ready`);
      const data = await response.json();

      // Both checks should succeed
      assert.strictEqual(data.checks.database_read, "ok");
      assert.strictEqual(data.checks.database_write, "ok");
      assert.strictEqual(data.ready, true);
    });

    it("multiple readiness probe calls do not conflict", async () => {
      // Simulate multiple probe requests in quick succession
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(fetch(`${baseURL}/api/ready`));
      }

      const responses = await Promise.all(promises);

      // All should succeed
      for (let i = 0; i < responses.length; i++) {
        assert.strictEqual(responses[i].status, 200, `request ${i} should succeed`);
        const data = await responses[i].json();
        assert.strictEqual(data.ready, true, `request ${i} should be ready`);
      }
    });
  });
});
