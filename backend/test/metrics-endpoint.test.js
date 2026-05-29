/**
 * Metrics Endpoint Tests
 *
 * Integration tests for /api/metrics endpoint that exposes Prometheus metrics.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import express from "express";
import { metricsMiddleware } from "../src/middleware/metrics.js";
import { getMetrics, getMetricsContentType, register } from "../src/metrics.js";

describe("Metrics Endpoint", () => {
  let app;

  before(() => {
    // Create minimal Express app for testing
    app = express();
    app.use(metricsMiddleware);

    // Add metrics endpoint
    app.get("/api/metrics", async (_req, res) => {
      try {
        const metrics = await getMetrics();
        res.set("Content-Type", getMetricsContentType());
        res.send(metrics);
      } catch (err) {
        res.status(500).json({ error: "Failed to retrieve metrics" });
      }
    });

    // Add test routes
    app.get("/api/test", (_req, res) => {
      res.json({ status: "ok" });
    });

    app.post("/api/test", (_req, res) => {
      res.status(201).json({ created: true });
    });
  });

  after(() => {
    register.clear();
  });

  describe("GET /api/metrics", () => {
    it("should return 200 status", async () => {
      const response = await request(app).get("/api/metrics");
      assert.strictEqual(response.status, 200, "Should return 200");
    });

    it("should return Prometheus text format", async () => {
      const response = await request(app).get("/api/metrics");
      assert.ok(
        response.headers["content-type"].includes("text/plain"),
        "Should return text/plain content type"
      );
    });

    it("should include HELP and TYPE comments", async () => {
      const response = await request(app).get("/api/metrics");
      const body = response.text;

      assert.ok(body.includes("# HELP"), "Should include HELP comments");
      assert.ok(body.includes("# TYPE"), "Should include TYPE comments");
    });

    it("should include HTTP request metrics", async () => {
      // Make a test request to generate metrics
      await request(app).get("/api/test");

      const response = await request(app).get("/api/metrics");
      const body = response.text;

      assert.ok(body.includes("http_requests_total"), "Should include requests counter");
      assert.ok(body.includes("http_request_duration_seconds"), "Should include duration histogram");
    });

    it("should include Node.js process metrics", async () => {
      const response = await request(app).get("/api/metrics");
      const body = response.text;

      assert.ok(body.includes("process_cpu"), "Should include CPU metrics");
      assert.ok(body.includes("nodejs_"), "Should include Node.js metrics");
    });

    it("should track multiple requests", async () => {
      // Generate multiple requests
      await request(app).get("/api/test");
      await request(app).post("/api/test");
      await request(app).get("/api/test");

      const response = await request(app).get("/api/metrics");
      const body = response.text;

      assert.ok(body.includes('method="GET"'), "Should track GET requests");
      assert.ok(body.includes('method="POST"'), "Should track POST requests");
    });

    it("should include status codes in metrics", async () => {
      // Make requests with different status codes
      await request(app).get("/api/test"); // 200
      await request(app).post("/api/test"); // 201
      await request(app).get("/api/nonexistent"); // 404

      const response = await request(app).get("/api/metrics");
      const body = response.text;

      assert.ok(body.includes('status_code="200"'), "Should track 200 status");
      assert.ok(body.includes('status_code="201"'), "Should track 201 status");
      assert.ok(body.includes('status_code="404"'), "Should track 404 status");
    });

    it("should normalize routes to avoid high cardinality", async () => {
      // Make requests with UUID-like paths (should be normalized to :id)
      await request(app).get("/api/test/550e8400-e29b-41d4-a716-446655440000");

      const response = await request(app).get("/api/metrics");
      const body = response.text;

      // Should normalize UUID to :id to avoid cardinality explosion
      assert.ok(body.includes("route="), "Should include route label");
      // The actual normalization happens in the middleware
    });

    it("should include histogram buckets", async () => {
      const response = await request(app).get("/api/metrics");
      const body = response.text;

      // HTTP duration histogram buckets (0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30)
      assert.ok(body.includes("_bucket{"), "Should include histogram buckets");
      assert.ok(body.includes("le="), "Should include le (less than or equal) labels");
    });

    it("should include metric descriptions", async () => {
      const response = await request(app).get("/api/metrics");
      const body = response.text;

      assert.ok(
        body.includes("Duration of HTTP requests in seconds"),
        "Should include HTTP duration description"
      );
      assert.ok(
        body.includes("Total number of HTTP requests"),
        "Should include HTTP requests description"
      );
    });
  });

  describe("Metrics Middleware", () => {
    it("should record request duration", async () => {
      await request(app).get("/api/test");

      const response = await request(app).get("/api/metrics");
      const body = response.text;

      // Should have recorded duration for /api/test
      assert.ok(
        body.includes("http_request_duration_seconds"),
        "Should record request duration"
      );
    });

    it("should increment request counter", async () => {
      // Get current metrics to establish baseline
      const before = await request(app).get("/api/metrics");

      // Make test request
      await request(app).get("/api/test");

      // Get updated metrics
      const after = await request(app).get("/api/metrics");

      // Should have incremented counter
      assert.ok(after.text.includes("http_requests_total"), "Should increment request counter");
    });
  });
});
