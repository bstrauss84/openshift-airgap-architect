/**
 * OpenShift Airgap Architect - API Validation Tests
 *
 * Tests for Zod schema validation on all protected API endpoints.
 * Verifies rejection of invalid inputs, malformed data, and oversized payloads.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import { test } from "node:test";
import assert from "node:assert";
import { z } from "zod";
import {
  stateUpdateSchema,
  sshKeypairSchema,
  operatorScanSchema,
  ocMirrorPreflightSchema,
  ocMirrorRunSchema,
  pathCheckSchema,
  cincinnatiPatchesUpdateSchema,
  cincinnatiRefreshSchema,
  feedbackSubmitSchema,
  validateBody
} from "../src/schemas.js";

// ===================================================================
// stateUpdateSchema Tests
// ===================================================================

test("stateUpdateSchema: accepts valid full state object", () => {
  const validState = {
    blueprint: {
      platform: "Bare Metal",
      baseDomain: "example.com",
      clusterName: "test-cluster",
      version: "4.20.1",
      channel: "stable-4.20",
      fipsMode: false
    },
    methodology: {
      method: "IPI"
    },
    credentials: {
      sshPublicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAbcdefg test@example.com"
    },
    globalStrategy: {
      networking: {
        machineNetworkV4: "10.0.0.0/24",
        clusterNetworkCidr: "10.128.0.0/14",
        serviceNetworkCidr: "172.30.0.0/16"
      }
    }
  };

  const result = stateUpdateSchema.safeParse(validState);
  assert.strictEqual(result.success, true);
});

test("stateUpdateSchema: preserves nested blueprint fields (no Zod strip)", () => {
  const state = {
    blueprint: {
      platform: "Bare Metal",
      arch: "x86_64",
      confirmed: true,
      confirmationTimestamp: 123,
      clusterName: "c",
      baseDomain: "d.e"
    },
    globalStrategy: {
      fips: true,
      proxyEnabled: false,
      networking: { machineNetworkV4: "10.0.0.0/24" }
    }
  };
  const result = stateUpdateSchema.safeParse(state);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.data.blueprint.arch, "x86_64");
  assert.strictEqual(result.data.blueprint.confirmed, true);
  assert.strictEqual(result.data.globalStrategy.fips, true);
});

test("stateUpdateSchema: accepts arbitrary platform string (validation is elsewhere)", () => {
  const invalidState = {
    blueprint: {
      platform: "Invalid Platform Name"
    }
  };
  const result = stateUpdateSchema.safeParse(invalidState);
  assert.strictEqual(result.success, true);
});

test("stateUpdateSchema: accepts cluster names that UI validation would refine", () => {
  const invalidState = {
    blueprint: {
      clusterName: "InvalidName!"
    }
  };
  const result = stateUpdateSchema.safeParse(invalidState);
  assert.strictEqual(result.success, true);
});

test("stateUpdateSchema: accepts empty object (passthrough)", () => {
  const result = stateUpdateSchema.safeParse({});
  assert.strictEqual(result.success, true);
});

// ===================================================================
// sshKeypairSchema Tests
// ===================================================================

test("sshKeypairSchema: accepts valid ed25519 algorithm", () => {
  const result = sshKeypairSchema.safeParse({ algorithm: "ed25519" });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.data.algorithm, "ed25519");
});

test("sshKeypairSchema: accepts valid rsa algorithm", () => {
  const result = sshKeypairSchema.safeParse({ algorithm: "rsa" });
  assert.strictEqual(result.success, true);
});

test("sshKeypairSchema: accepts valid ecdsa algorithm", () => {
  const result = sshKeypairSchema.safeParse({ algorithm: "ecdsa" });
  assert.strictEqual(result.success, true);
});

test("sshKeypairSchema: rejects invalid algorithm", () => {
  const result = sshKeypairSchema.safeParse({ algorithm: "invalid-algo" });
  assert.strictEqual(result.success, false);
  assert.ok(result.error.errors[0].message.includes("Invalid enum value"));
});

test("sshKeypairSchema: defaults to ed25519 when empty", () => {
  const result = sshKeypairSchema.safeParse({});
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.data.algorithm, "ed25519");
});

test("sshKeypairSchema: rejects malicious algorithm injection attempt", () => {
  const result = sshKeypairSchema.safeParse({ algorithm: "rsa; rm -rf /" });
  assert.strictEqual(result.success, false);
});

// ===================================================================
// operatorScanSchema Tests
// ===================================================================

test("operatorScanSchema: accepts valid pull secret JSON", () => {
  const validPullSecret = '{"auths":{"registry.redhat.io":{"auth":"dGVzdDp0ZXN0"}}}';
  const result = operatorScanSchema.safeParse({ pullSecret: validPullSecret });
  assert.strictEqual(result.success, true);
});

test("operatorScanSchema: rejects invalid JSON pull secret", () => {
  const result = operatorScanSchema.safeParse({ pullSecret: "not valid json" });
  assert.strictEqual(result.success, false);
});

test("operatorScanSchema: accepts empty object (optional fields)", () => {
  const result = operatorScanSchema.safeParse({});
  assert.strictEqual(result.success, true);
});

// ===================================================================
// ocMirrorPreflightSchema Tests
// ===================================================================

test("ocMirrorPreflightSchema: accepts valid mirrorToDisk mode", () => {
  const valid = {
    mode: "mirrorToDisk",
    archivePath: "/data/archives",
    registryUrl: "registry.example.com:5000"
  };
  const result = ocMirrorPreflightSchema.safeParse(valid);
  assert.strictEqual(result.success, true);
});

test("ocMirrorPreflightSchema: accepts diskToMirror mode", () => {
  const result = ocMirrorPreflightSchema.safeParse({ mode: "diskToMirror" });
  assert.strictEqual(result.success, true);
});

test("ocMirrorPreflightSchema: accepts mirrorToMirror mode", () => {
  const result = ocMirrorPreflightSchema.safeParse({ mode: "mirrorToMirror" });
  assert.strictEqual(result.success, true);
});

test("ocMirrorPreflightSchema: rejects invalid mode", () => {
  const result = ocMirrorPreflightSchema.safeParse({ mode: "invalidMode" });
  assert.strictEqual(result.success, false);
});

test("ocMirrorPreflightSchema: rejects registry URL longer than 2048 chars", () => {
  const longUrl = "http://example.com/" + "a".repeat(2050);
  const result = ocMirrorPreflightSchema.safeParse({ registryUrl: longUrl });
  assert.strictEqual(result.success, false);
  assert.ok(result.error.errors[0].message.includes("String must contain at most 2048"));
});

test("ocMirrorPreflightSchema: accepts registry URL at 2048 char limit", () => {
  const url = "http://example.com/" + "a".repeat(2020);
  const result = ocMirrorPreflightSchema.safeParse({ registryUrl: url });
  assert.strictEqual(result.success, true);
});

test("ocMirrorPreflightSchema: defaults mode to mirrorToDisk", () => {
  const result = ocMirrorPreflightSchema.safeParse({});
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.data.mode, "mirrorToDisk");
});

test("ocMirrorPreflightSchema: accepts negative minBytes", () => {
  const result = ocMirrorPreflightSchema.safeParse({ minBytes: -100 });
  assert.strictEqual(result.success, false);
  assert.ok(result.error.errors[0].message.includes("Number must be greater than or equal to 0"));
});

// ===================================================================
// ocMirrorRunSchema Tests
// ===================================================================

test("ocMirrorRunSchema: accepts valid configuration", () => {
  const valid = {
    mode: "mirrorToDisk",
    archivePath: "/data/archives/test.tar",
    workspacePath: "/data/workspace",
    registryUrl: "registry.example.com"
  };
  const result = ocMirrorRunSchema.safeParse(valid);
  assert.strictEqual(result.success, true);
});

test("ocMirrorRunSchema: rejects oversized registry URL", () => {
  const longUrl = "x".repeat(2049);
  const result = ocMirrorRunSchema.safeParse({ registryUrl: longUrl });
  assert.strictEqual(result.success, false);
});

test("ocMirrorRunSchema: accepts valid config source types", () => {
  const result1 = ocMirrorRunSchema.safeParse({ configSourceType: "generated" });
  assert.strictEqual(result1.success, true);

  const result2 = ocMirrorRunSchema.safeParse({ configSourceType: "uploaded" });
  assert.strictEqual(result2.success, true);
});

test("ocMirrorRunSchema: rejects invalid config source type", () => {
  const result = ocMirrorRunSchema.safeParse({ configSourceType: "invalid" });
  assert.strictEqual(result.success, false);
});

// ===================================================================
// pathCheckSchema Tests
// ===================================================================

test("pathCheckSchema: accepts valid path", () => {
  const result = pathCheckSchema.safeParse({ path: "/data/test/file.txt" });
  assert.strictEqual(result.success, true);
});

test("pathCheckSchema: rejects empty path", () => {
  const result = pathCheckSchema.safeParse({ path: "" });
  assert.strictEqual(result.success, false);
});

test("pathCheckSchema: rejects path longer than 4096 chars", () => {
  const longPath = "/data/" + "a/".repeat(2100);
  const result = pathCheckSchema.safeParse({ path: longPath });
  assert.strictEqual(result.success, false);
});

test("pathCheckSchema: accepts path at 4096 char limit", () => {
  const path = "/data/" + "a".repeat(4090);
  const result = pathCheckSchema.safeParse({ path });
  assert.strictEqual(result.success, true);
});

test("pathCheckSchema: rejects missing path field", () => {
  const result = pathCheckSchema.safeParse({});
  assert.strictEqual(result.success, false);
});

// ===================================================================
// cincinnatiPatchesUpdateSchema Tests
// ===================================================================

test("cincinnatiPatchesUpdateSchema: accepts valid channel", () => {
  const result = cincinnatiPatchesUpdateSchema.safeParse({ channel: "stable-4.20" });
  assert.strictEqual(result.success, true);
});

test("cincinnatiPatchesUpdateSchema: rejects empty channel", () => {
  const result = cincinnatiPatchesUpdateSchema.safeParse({ channel: "" });
  assert.strictEqual(result.success, false);
});

test("cincinnatiPatchesUpdateSchema: rejects missing channel", () => {
  const result = cincinnatiPatchesUpdateSchema.safeParse({});
  assert.strictEqual(result.success, false);
  assert.ok(result.error.errors.length > 0);
  assert.ok(result.error.errors[0].path.includes("channel"));
});

// ===================================================================
// cincinnatiRefreshSchema Tests
// ===================================================================

test("cincinnatiRefreshSchema: accepts optional preferredChannel", () => {
  const result = cincinnatiRefreshSchema.safeParse({ preferredChannel: "stable-4.20" });
  assert.strictEqual(result.success, true);
});

test("cincinnatiRefreshSchema: accepts optional channel", () => {
  const result = cincinnatiRefreshSchema.safeParse({ channel: "stable-4.19" });
  assert.strictEqual(result.success, true);
});

test("cincinnatiRefreshSchema: accepts empty object", () => {
  const result = cincinnatiRefreshSchema.safeParse({});
  assert.strictEqual(result.success, true);
});

test("cincinnatiRefreshSchema: allows additional fields (passthrough)", () => {
  const result = cincinnatiRefreshSchema.safeParse({
    preferredChannel: "stable-4.20",
    extraField: "should be allowed"
  });
  assert.strictEqual(result.success, true);
});

// ===================================================================
// feedbackSubmitSchema Tests
// ===================================================================

test("feedbackSubmitSchema: accepts valid feedback payload", () => {
  const valid = {
    category: "bug",
    severity: "medium",
    summary: "Something is broken",
    details: "Detailed description of the issue",
    challengeToken: "token123",
    contactRequested: false
  };
  const result = feedbackSubmitSchema.safeParse(valid);
  assert.strictEqual(result.success, true);
});

test("feedbackSubmitSchema: accepts empty object (all fields optional)", () => {
  const result = feedbackSubmitSchema.safeParse({});
  assert.strictEqual(result.success, true);
});

test("feedbackSubmitSchema: rejects summary over 5000 chars", () => {
  const longSummary = "a".repeat(5001);
  const result = feedbackSubmitSchema.safeParse({ summary: longSummary });
  assert.strictEqual(result.success, false);
});

test("feedbackSubmitSchema: accepts summary at 5000 char limit", () => {
  const summary = "a".repeat(5000);
  const result = feedbackSubmitSchema.safeParse({ summary });
  assert.strictEqual(result.success, true);
});

test("feedbackSubmitSchema: rejects details over 50000 chars", () => {
  const longDetails = "a".repeat(50001);
  const result = feedbackSubmitSchema.safeParse({ details: longDetails });
  assert.strictEqual(result.success, false);
});

test("feedbackSubmitSchema: rejects challengeToken over 1024 chars", () => {
  const longToken = "a".repeat(1025);
  const result = feedbackSubmitSchema.safeParse({ challengeToken: longToken });
  assert.strictEqual(result.success, false);
});

test("feedbackSubmitSchema: allows additional fields via passthrough", () => {
  const result = feedbackSubmitSchema.safeParse({
    category: "feature",
    scenarioContext: { step: "blueprint" }
  });
  assert.strictEqual(result.success, true);
});

// ===================================================================
// validateBody Middleware Tests
// ===================================================================

test("validateBody middleware: calls next() on valid data", () => {
  let nextCalled = false;
  const middleware = validateBody(sshKeypairSchema);
  const req = { body: { algorithm: "ed25519" } };
  const res = {};
  const next = () => { nextCalled = true; };

  middleware(req, res, next);
  assert.strictEqual(nextCalled, true);
  assert.strictEqual(req.body.algorithm, "ed25519");
});

test("validateBody middleware: returns 400 with errorId on invalid data", () => {
  let statusCode = null;
  let jsonData = null;
  const middleware = validateBody(sshKeypairSchema);
  const req = { body: { algorithm: "invalid" }, path: "/api/ssh/keypair", method: "POST" };
  const res = {
    status: (code) => {
      statusCode = code;
      return {
        json: (data) => { jsonData = data; }
      };
    }
  };
  const next = () => {};

  middleware(req, res, next);
  assert.strictEqual(statusCode, 400);
  assert.strictEqual(jsonData.error, "Validation failed");
  assert.ok(Array.isArray(jsonData.details));
  assert.ok(typeof jsonData.errorId === "string");
  assert.ok(jsonData.errorId.startsWith("err_"));
});

test("validateBody middleware: formats multiple validation errors with errorId", () => {
  const multiSchema = z.object({
    a: z.string().min(1, "a required"),
    b: z.number()
  });
  let jsonData = null;
  const middleware = validateBody(multiSchema);
  const req = {
    body: {
      a: "",
      b: "not-a-number"
    },
    path: "/test",
    method: "POST"
  };
  const res = {
    status: (code) => ({
      json: (data) => { jsonData = data; }
    })
  };
  const next = () => {};

  middleware(req, res, next);
  assert.strictEqual(jsonData.error, "Validation failed");
  assert.ok(typeof jsonData.errorId === "string");
  assert.ok(jsonData.errorId.startsWith("err_"));
  assert.ok(jsonData.details.length > 0);
  assert.ok(jsonData.details.every(d => d.path !== undefined && d.message));
});
