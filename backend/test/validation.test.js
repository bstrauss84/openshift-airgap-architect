/**
 * OpenShift Airgap Architect - Comprehensive Validation Tests (PROD-007)
 *
 * Tests for all new Zod schemas added to achieve 100% route validation coverage.
 * Covers schemas for previously unvalidated routes, enhanced validateBody middleware
 * with error IDs, and backward compatibility verification.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  runImportSchema,
  runDuplicateSchema,
  cincinnatiUpdateSchema,
  cincinnatiRefreshSchema,
  operatorConfirmSchema,
  operatorsPrefetchSchema,
  startOverSchema,
  bundlePrepareSchema,
  bundleZipSchema,
  jobStopSchema,
  docsUpdateSchema,
  awsWarmInstallerSchema,
  trustAnalyzeSchema,
  generateSchema,
  feedbackSubmitSchema,
  validateBody,
} from "../src/schemas.js";

// ===================================================================
// runImportSchema Tests
// ===================================================================

test("runImportSchema: accepts valid run bundle with state", () => {
  const valid = {
    schemaVersion: 2,
    state: { blueprint: { platform: "Bare Metal" } },
    exportedAt: "2026-05-20T12:00:00Z",
    runId: "abc123",
  };
  const result = runImportSchema.safeParse(valid);
  assert.strictEqual(result.success, true);
});

test("runImportSchema: accepts minimal valid payload (state only)", () => {
  const result = runImportSchema.safeParse({ state: {} });
  assert.strictEqual(result.success, true);
});

test("runImportSchema: rejects missing state", () => {
  const result = runImportSchema.safeParse({ schemaVersion: 1 });
  assert.strictEqual(result.success, false);
  assert.ok(result.error.errors.some((e) => e.path.includes("state")));
});

test("runImportSchema: rejects non-object state", () => {
  const result = runImportSchema.safeParse({ state: "not an object" });
  assert.strictEqual(result.success, false);
});

test("runImportSchema: rejects array state", () => {
  const result = runImportSchema.safeParse({ state: [1, 2, 3] });
  assert.strictEqual(result.success, false);
});

test("runImportSchema: rejects schemaVersion > 2", () => {
  const result = runImportSchema.safeParse({ state: {}, schemaVersion: 3 });
  assert.strictEqual(result.success, false);
});

test("runImportSchema: rejects schemaVersion < 1", () => {
  const result = runImportSchema.safeParse({ state: {}, schemaVersion: 0 });
  assert.strictEqual(result.success, false);
});

test("runImportSchema: accepts extra fields via passthrough", () => {
  const result = runImportSchema.safeParse({
    state: {},
    extraField: "should be allowed",
  });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.data.extraField, "should be allowed");
});

test("runImportSchema: preserves nested state fields", () => {
  const state = {
    blueprint: { platform: "AWS", arch: "x86_64", confirmed: true },
    release: { channel: "4.20", patchVersion: "4.20.1" },
  };
  const result = runImportSchema.safeParse({ state });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.data.state.blueprint.arch, "x86_64");
});

// ===================================================================
// runDuplicateSchema Tests
// ===================================================================

test("runDuplicateSchema: accepts empty object", () => {
  const result = runDuplicateSchema.safeParse({});
  assert.strictEqual(result.success, true);
});

test("runDuplicateSchema: allows extra fields via passthrough", () => {
  const result = runDuplicateSchema.safeParse({ someField: "value" });
  assert.strictEqual(result.success, true);
});

// ===================================================================
// cincinnatiUpdateSchema Tests
// ===================================================================

test("cincinnatiUpdateSchema: accepts empty object", () => {
  const result = cincinnatiUpdateSchema.safeParse({});
  assert.strictEqual(result.success, true);
});

test("cincinnatiUpdateSchema: allows extra fields via passthrough", () => {
  const result = cincinnatiUpdateSchema.safeParse({ force: true });
  assert.strictEqual(result.success, true);
});

// ===================================================================
// cincinnatiRefreshSchema Tests (nullable support)
// ===================================================================

test("cincinnatiRefreshSchema: accepts null preferredChannel", () => {
  const result = cincinnatiRefreshSchema.safeParse({
    preferredChannel: null,
  });
  assert.strictEqual(result.success, true);
});

test("cincinnatiRefreshSchema: accepts null channel", () => {
  const result = cincinnatiRefreshSchema.safeParse({ channel: null });
  assert.strictEqual(result.success, true);
});

test("cincinnatiRefreshSchema: accepts string preferredChannel", () => {
  const result = cincinnatiRefreshSchema.safeParse({
    preferredChannel: "stable-4.20",
  });
  assert.strictEqual(result.success, true);
});

test("cincinnatiRefreshSchema: rejects non-string/non-null preferredChannel", () => {
  const result = cincinnatiRefreshSchema.safeParse({
    preferredChannel: 42,
  });
  assert.strictEqual(result.success, false);
});

// ===================================================================
// operatorConfirmSchema Tests
// ===================================================================

test("operatorConfirmSchema: accepts empty object (no body used)", () => {
  const result = operatorConfirmSchema.safeParse({});
  assert.strictEqual(result.success, true);
});

test("operatorConfirmSchema: allows any extra fields", () => {
  const result = operatorConfirmSchema.safeParse({
    anything: "goes",
    nested: { data: true },
  });
  assert.strictEqual(result.success, true);
});

// ===================================================================
// operatorsPrefetchSchema Tests
// ===================================================================

test("operatorsPrefetchSchema: accepts empty object", () => {
  const result = operatorsPrefetchSchema.safeParse({});
  assert.strictEqual(result.success, true);
});

// ===================================================================
// startOverSchema Tests
// ===================================================================

test("startOverSchema: accepts cancelRunningOcMirror boolean", () => {
  const result = startOverSchema.safeParse({
    cancelRunningOcMirror: true,
  });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.data.cancelRunningOcMirror, true);
});

test("startOverSchema: accepts cancelRunningOcMirror false", () => {
  const result = startOverSchema.safeParse({
    cancelRunningOcMirror: false,
  });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.data.cancelRunningOcMirror, false);
});

test("startOverSchema: accepts empty object", () => {
  const result = startOverSchema.safeParse({});
  assert.strictEqual(result.success, true);
});

test("startOverSchema: rejects non-boolean cancelRunningOcMirror", () => {
  const result = startOverSchema.safeParse({
    cancelRunningOcMirror: "yes",
  });
  assert.strictEqual(result.success, false);
});

// ===================================================================
// bundlePrepareSchema Tests
// ===================================================================

test("bundlePrepareSchema: accepts state object", () => {
  const result = bundlePrepareSchema.safeParse({
    state: { blueprint: { platform: "AWS" } },
  });
  assert.strictEqual(result.success, true);
});

test("bundlePrepareSchema: accepts null state (uses server state)", () => {
  const result = bundlePrepareSchema.safeParse({ state: null });
  assert.strictEqual(result.success, true);
});

test("bundlePrepareSchema: accepts empty object (no state)", () => {
  const result = bundlePrepareSchema.safeParse({});
  assert.strictEqual(result.success, true);
});

test("bundlePrepareSchema: rejects non-object state (string)", () => {
  const result = bundlePrepareSchema.safeParse({ state: "invalid" });
  assert.strictEqual(result.success, false);
});

test("bundlePrepareSchema: rejects array state", () => {
  const result = bundlePrepareSchema.safeParse({ state: [1, 2] });
  assert.strictEqual(result.success, false);
});

// ===================================================================
// bundleZipSchema Tests
// ===================================================================

test("bundleZipSchema: accepts state object", () => {
  const result = bundleZipSchema.safeParse({
    state: { blueprint: { platform: "Bare Metal" } },
  });
  assert.strictEqual(result.success, true);
});

test("bundleZipSchema: accepts null state", () => {
  const result = bundleZipSchema.safeParse({ state: null });
  assert.strictEqual(result.success, true);
});

test("bundleZipSchema: accepts empty object", () => {
  const result = bundleZipSchema.safeParse({});
  assert.strictEqual(result.success, true);
});

// ===================================================================
// jobStopSchema Tests
// ===================================================================

test("jobStopSchema: accepts empty object (job ID in URL)", () => {
  const result = jobStopSchema.safeParse({});
  assert.strictEqual(result.success, true);
});

// ===================================================================
// docsUpdateSchema Tests
// ===================================================================

test("docsUpdateSchema: accepts empty object", () => {
  const result = docsUpdateSchema.safeParse({});
  assert.strictEqual(result.success, true);
});

// ===================================================================
// awsWarmInstallerSchema Tests
// ===================================================================

test("awsWarmInstallerSchema: accepts version and arch", () => {
  const result = awsWarmInstallerSchema.safeParse({
    version: "4.20.1",
    arch: "x86_64",
  });
  assert.strictEqual(result.success, true);
});

test("awsWarmInstallerSchema: accepts version only", () => {
  const result = awsWarmInstallerSchema.safeParse({ version: "4.20.1" });
  assert.strictEqual(result.success, true);
});

test("awsWarmInstallerSchema: accepts empty object (version can come from query param)", () => {
  const result = awsWarmInstallerSchema.safeParse({});
  assert.strictEqual(result.success, true);
});

test("awsWarmInstallerSchema: rejects empty version string", () => {
  const result = awsWarmInstallerSchema.safeParse({ version: "" });
  assert.strictEqual(result.success, false);
});

test("awsWarmInstallerSchema: rejects version over 100 chars", () => {
  const longVersion = "a".repeat(101);
  const result = awsWarmInstallerSchema.safeParse({ version: longVersion });
  assert.strictEqual(result.success, false);
});

test("awsWarmInstallerSchema: rejects arch over 50 chars", () => {
  const longArch = "a".repeat(51);
  const result = awsWarmInstallerSchema.safeParse({ arch: longArch });
  assert.strictEqual(result.success, false);
});

// ===================================================================
// trustAnalyzeSchema Tests
// ===================================================================

test("trustAnalyzeSchema: accepts state object", () => {
  const result = trustAnalyzeSchema.safeParse({
    state: { trust: { caBundleContent: "PEM data..." } },
  });
  assert.strictEqual(result.success, true);
});

test("trustAnalyzeSchema: accepts null state (uses server state)", () => {
  const result = trustAnalyzeSchema.safeParse({ state: null });
  assert.strictEqual(result.success, true);
});

test("trustAnalyzeSchema: accepts empty object", () => {
  const result = trustAnalyzeSchema.safeParse({});
  assert.strictEqual(result.success, true);
});

test("trustAnalyzeSchema: rejects non-object state", () => {
  const result = trustAnalyzeSchema.safeParse({ state: "invalid" });
  assert.strictEqual(result.success, false);
});

// ===================================================================
// generateSchema Tests
// ===================================================================

test("generateSchema: accepts state in body", () => {
  const result = generateSchema.safeParse({
    state: { blueprint: { platform: "AWS" } },
  });
  assert.strictEqual(result.success, true);
});

test("generateSchema: accepts empty object", () => {
  const result = generateSchema.safeParse({});
  assert.strictEqual(result.success, true);
});

test("generateSchema: preserves all fields via catchall", () => {
  const result = generateSchema.safeParse({
    state: { any: "data" },
    extra: true,
  });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.data.extra, true);
});

// ===================================================================
// feedbackSubmitSchema Tests (updated schema)
// ===================================================================

test("feedbackSubmitSchema: accepts full valid payload", () => {
  const valid = {
    category: "bug",
    severity: "high",
    summary: "Test summary",
    details: "Test details about the issue",
    contactRequested: true,
    contactHandle: "@user",
    challengeToken: "tok123",
    uiContext: "blueprint",
    honeypot: "",
  };
  const result = feedbackSubmitSchema.safeParse(valid);
  assert.strictEqual(result.success, true);
});

test("feedbackSubmitSchema: rejects category over 100 chars", () => {
  const result = feedbackSubmitSchema.safeParse({
    category: "a".repeat(101),
  });
  assert.strictEqual(result.success, false);
});

test("feedbackSubmitSchema: rejects uiContext over 200 chars", () => {
  const result = feedbackSubmitSchema.safeParse({
    uiContext: "a".repeat(201),
  });
  assert.strictEqual(result.success, false);
});

test("feedbackSubmitSchema: allows scenarioContext via passthrough", () => {
  const result = feedbackSubmitSchema.safeParse({
    category: "feature",
    scenarioContext: { step: "review", platform: "AWS" },
  });
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.data.scenarioContext, {
    step: "review",
    platform: "AWS",
  });
});

// ===================================================================
// validateBody Enhanced Middleware Tests
// ===================================================================

test("validateBody: error response includes errorId starting with err_", () => {
  let jsonData = null;
  const schema = z.object({ required: z.string() });
  const middleware = validateBody(schema);
  const req = { body: {}, path: "/test", method: "POST" };
  const res = {
    status: () => ({
      json: (data) => {
        jsonData = data;
      },
    }),
  };
  middleware(req, res, () => {});
  assert.ok(jsonData.errorId);
  assert.ok(jsonData.errorId.startsWith("err_"));
});

test("validateBody: each error gets a unique errorId", () => {
  const ids = new Set();
  const schema = z.object({ required: z.string() });
  const middleware = validateBody(schema);

  for (let i = 0; i < 5; i++) {
    let jsonData = null;
    const req = { body: {}, path: "/test", method: "POST" };
    const res = {
      status: () => ({
        json: (data) => {
          jsonData = data;
        },
      }),
    };
    middleware(req, res, () => {});
    ids.add(jsonData.errorId);
  }
  assert.strictEqual(ids.size, 5, "All error IDs should be unique");
});

test("validateBody: passes through valid data without errorId", () => {
  let nextCalled = false;
  const schema = z.object({ name: z.string() });
  const middleware = validateBody(schema);
  const req = { body: { name: "test" } };
  const res = {};
  middleware(req, res, () => {
    nextCalled = true;
  });
  assert.strictEqual(nextCalled, true);
  assert.strictEqual(req.body.name, "test");
});

test("validateBody: handles non-Zod errors with 500 and errorId", () => {
  let statusCode = null;
  let jsonData = null;
  // Create a schema with a custom transform that throws a non-Zod error
  const schema = z.object({}).transform(() => {
    throw new Error("unexpected");
  });
  const middleware = validateBody(schema);
  const req = { body: {}, path: "/test", method: "POST" };
  const res = {
    status: (code) => {
      statusCode = code;
      return {
        json: (data) => {
          jsonData = data;
        },
      };
    },
  };
  middleware(req, res, () => {});
  assert.strictEqual(statusCode, 500);
  assert.strictEqual(jsonData.error, "Internal validation error");
  assert.ok(jsonData.errorId);
  assert.ok(jsonData.errorId.startsWith("err_"));
});

// ===================================================================
// Backward Compatibility Tests
// ===================================================================

test("backward compat: empty body accepted by permissive route schemas", () => {
  const permissiveSchemas = [
    { name: "runDuplicateSchema", schema: runDuplicateSchema },
    { name: "cincinnatiUpdateSchema", schema: cincinnatiUpdateSchema },
    { name: "operatorConfirmSchema", schema: operatorConfirmSchema },
    { name: "operatorsPrefetchSchema", schema: operatorsPrefetchSchema },
    { name: "jobStopSchema", schema: jobStopSchema },
    { name: "docsUpdateSchema", schema: docsUpdateSchema },
    { name: "startOverSchema", schema: startOverSchema },
    { name: "bundlePrepareSchema", schema: bundlePrepareSchema },
    { name: "bundleZipSchema", schema: bundleZipSchema },
    { name: "awsWarmInstallerSchema", schema: awsWarmInstallerSchema },
    { name: "trustAnalyzeSchema", schema: trustAnalyzeSchema },
    { name: "generateSchema", schema: generateSchema },
    { name: "feedbackSubmitSchema", schema: feedbackSubmitSchema },
  ];

  for (const { name, schema } of permissiveSchemas) {
    const result = schema.safeParse({});
    assert.strictEqual(
      result.success,
      true,
      `${name} should accept empty object for backward compatibility`
    );
  }
});

test("backward compat: start-over with cancelRunningOcMirror boolean", () => {
  // Frontend sends { cancelRunningOcMirror: true/false }
  const result = startOverSchema.safeParse({ cancelRunningOcMirror: true });
  assert.strictEqual(result.success, true);
});

test("backward compat: bundle.prepare with state: null", () => {
  // Frontend sends { state: stateForBundle || null }
  const result = bundlePrepareSchema.safeParse({ state: null });
  assert.strictEqual(result.success, true);
});

test("backward compat: cincinnati/refresh-job with null preferredChannel", () => {
  // Frontend sends { preferredChannel: release?.channel || null }
  const result = cincinnatiRefreshSchema.safeParse({
    preferredChannel: null,
  });
  assert.strictEqual(result.success, true);
});

test("backward compat: aws/warm-installer with version and arch", () => {
  // Frontend sends { version: patchVersion, arch: state.blueprint?.arch }
  const result = awsWarmInstallerSchema.safeParse({
    version: "4.20.1",
    arch: "x86_64",
  });
  assert.strictEqual(result.success, true);
});

test("backward compat: trust/analyze with state object", () => {
  // Frontend sends { state: wizardState }
  const result = trustAnalyzeSchema.safeParse({
    state: {
      trust: { caBundleContent: "-----BEGIN CERTIFICATE-----\n..." },
      blueprint: { platform: "Bare Metal" },
    },
  });
  assert.strictEqual(result.success, true);
});

test("backward compat: run/import with full run bundle", () => {
  // User imports a JSON file with schemaVersion, state, exportedAt, runId
  const result = runImportSchema.safeParse({
    schemaVersion: 2,
    exportedAt: "2026-05-20T12:00:00.000Z",
    runId: "abc123xyz",
    state: {
      blueprint: { platform: "Bare Metal", arch: "x86_64" },
      release: { channel: "4.20", patchVersion: "4.20.1" },
      operators: { selected: [] },
    },
  });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.data.state.blueprint.platform, "Bare Metal");
});

test("backward compat: generate POST with state", () => {
  // Frontend sends { state: wizardState }
  const result = generateSchema.safeParse({
    state: {
      blueprint: { platform: "AWS" },
      release: { patchVersion: "4.20.1" },
    },
  });
  assert.strictEqual(result.success, true);
});
