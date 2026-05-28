/**
 * Metrics Module Tests
 *
 * Tests for Prometheus metrics instrumentation including HTTP request metrics,
 * background job metrics, SQLite metrics, oc-mirror metrics, and helper functions.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import {
  httpRequestDuration,
  httpRequestsTotal,
  jobsTotal,
  jobsRunning,
  jobDuration,
  jobErrors,
  stateOperationsTotal,
  recordHttpRequest,
  recordJobStart,
  recordJobComplete,
  recordJobError,
  getMetrics,
  getMetricsContentType,
  register
} from "../src/metrics.js";

describe("Metrics Module", () => {
  // Note: We don't clear the register in before() because that would remove
  // all metric definitions. Metrics will accumulate across tests, which is fine
  // for testing purposes. Each test records new data points to the same metrics.

  after(() => {
    // Clean up after tests (optional - metrics will reset when registry is reimported)
    register.resetMetrics();
  });

  describe("HTTP Request Metrics", () => {
    it("should record HTTP request metrics", async () => {
      recordHttpRequest("GET", "/api/state", 200, 0.123);

      const metrics = await getMetrics();
      assert.ok(metrics.includes("http_requests_total"), "Should include requests counter");
      assert.ok(metrics.includes("http_request_duration_seconds"), "Should include duration histogram");
      assert.ok(metrics.includes('method="GET"'), "Should include method label");
      assert.ok(metrics.includes('route="/api/state"'), "Should include route label");
      assert.ok(metrics.includes('status_code="200"'), "Should include status code label");
    });

    it("should track multiple HTTP requests", async () => {
      recordHttpRequest("POST", "/api/state", 200, 0.050);
      recordHttpRequest("GET", "/api/jobs", 200, 0.012);
      recordHttpRequest("GET", "/api/state", 500, 0.234);

      const metrics = await getMetrics();
      assert.ok(metrics.includes('method="POST"'), "Should track POST requests");
      assert.ok(metrics.includes('status_code="500"'), "Should track error status codes");
    });
  });

  describe("Background Job Metrics", () => {
    it("should record job start", async () => {
      recordJobStart("cincinnati-refresh");

      const metrics = await getMetrics();
      assert.ok(metrics.includes("background_jobs_total"), "Should include jobs counter");
      assert.ok(metrics.includes("background_jobs_running"), "Should include running jobs gauge");
      assert.ok(metrics.includes('job_type="cincinnati-refresh"'), "Should include job type label");
      assert.ok(metrics.includes('status="running"'), "Should include running status");
    });

    it("should record job completion", async () => {
      recordJobComplete("operator-scan", "completed", 45.5);

      const metrics = await getMetrics();
      assert.ok(metrics.includes("background_job_duration_seconds"), "Should include duration histogram");
      assert.ok(metrics.includes('job_type="operator-scan"'), "Should include job type");
      assert.ok(metrics.includes('status="completed"'), "Should include completed status");
    });

    it("should record job errors", async () => {
      recordJobError("oc-mirror-run", "network");

      const metrics = await getMetrics();
      assert.ok(metrics.includes("background_job_errors_total"), "Should include errors counter");
      assert.ok(metrics.includes('job_type="oc-mirror-run"'), "Should include job type");
      assert.ok(metrics.includes('error_type="network"'), "Should include error type");
    });

    it("should track multiple job types", async () => {
      recordJobStart("cincinnati-refresh");
      recordJobStart("operator-scan");
      recordJobComplete("cincinnati-refresh", "completed", 12.3);
      recordJobComplete("operator-scan", "failed", 23.4);
      recordJobError("operator-scan", "auth");

      const metrics = await getMetrics();
      assert.ok(metrics.includes('job_type="cincinnati-refresh"'), "Should track Cincinnati jobs");
      assert.ok(metrics.includes('job_type="operator-scan"'), "Should track operator scan jobs");
      assert.ok(metrics.includes('status="failed"'), "Should track failed status");
      assert.ok(metrics.includes('error_type="auth"'), "Should track auth errors");
    });
  });

  describe("State Operations Metrics", () => {
    it("should increment state save counter", async () => {
      stateOperationsTotal.inc({ operation: "save" });

      const metrics = await getMetrics();
      assert.ok(metrics.includes("app_state_operations_total"), "Should include state operations counter");
      assert.ok(metrics.includes('operation="save"'), "Should include save operation");
    });

    it("should increment state load counter", async () => {
      stateOperationsTotal.inc({ operation: "load" });

      const metrics = await getMetrics();
      assert.ok(metrics.includes('operation="load"'), "Should include load operation");
    });
  });

  describe("Metrics Endpoint Helpers", () => {
    it("should return metrics in Prometheus text format", async () => {
      recordHttpRequest("GET", "/test", 200, 0.1);
      const metrics = await getMetrics();

      assert.strictEqual(typeof metrics, "string", "Should return string");
      assert.ok(metrics.length > 0, "Should not be empty");
      assert.ok(metrics.includes("# HELP"), "Should include Prometheus HELP comments");
      assert.ok(metrics.includes("# TYPE"), "Should include Prometheus TYPE comments");
    });

    it("should return correct content type", () => {
      const contentType = getMetricsContentType();

      assert.strictEqual(typeof contentType, "string", "Should return string");
      assert.ok(contentType.includes("text/plain"), "Should be Prometheus text format");
    });
  });

  describe("Metrics Labels and Cardinality", () => {
    it("should use consistent label names", async () => {
      recordHttpRequest("GET", "/api/test", 200, 0.05);
      recordJobStart("test-job");
      recordJobComplete("test-job", "completed", 5.0);

      const metrics = await getMetrics();

      // HTTP metrics should use method, route, status_code
      assert.ok(metrics.includes('method="GET"'), "HTTP metrics should have method label");
      assert.ok(metrics.includes('route="/api/test"'), "HTTP metrics should have route label");
      assert.ok(metrics.includes('status_code="200"'), "HTTP metrics should have status_code label");

      // Job metrics should use job_type, status
      assert.ok(metrics.includes('job_type="test-job"'), "Job metrics should have job_type label");
      assert.ok(metrics.includes('status="completed"'), "Job metrics should have status label");
    });

    it("should track all metric types", async () => {
      recordHttpRequest("POST", "/api/generate", 200, 1.5);
      recordJobStart("oc-mirror-run");
      recordJobComplete("oc-mirror-run", "completed", 120.5);
      stateOperationsTotal.inc({ operation: "save" });

      const metrics = await getMetrics();

      // Counters
      assert.ok(metrics.includes("http_requests_total"), "Should have HTTP requests counter");
      assert.ok(metrics.includes("background_jobs_total"), "Should have jobs counter");
      assert.ok(metrics.includes("app_state_operations_total"), "Should have state operations counter");

      // Gauges
      assert.ok(metrics.includes("background_jobs_running"), "Should have running jobs gauge");

      // Histograms
      assert.ok(metrics.includes("http_request_duration_seconds"), "Should have HTTP duration histogram");
      assert.ok(metrics.includes("background_job_duration_seconds"), "Should have job duration histogram");
    });
  });

  describe("Default Metrics", () => {
    it("should include Node.js process metrics", async () => {
      const metrics = await getMetrics();

      // prom-client default metrics
      assert.ok(metrics.includes("process_cpu"), "Should include CPU metrics");
      assert.ok(metrics.includes("nodejs_"), "Should include Node.js metrics");
    });
  });
});
