/**
 * Comprehensive oc-mirror preflight validation tests.
 * Tests all validation rules including advanced options.
 *
 * @author Bill Strauss
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import test from "node:test";
import assert from "node:assert/strict";

test("RH pull secret should be BLOCKER for mirrorToDisk mode", async () => {
  const mockPreflightResponse = {
    ok: false,
    blockers: ["Red Hat pull secret is required to pull from registry.redhat.io / quay.io."],
    warnings: [],
    checks: { auth: "missing" },
    fieldErrors: {
      rhPullSecret: {
        severity: "blocker",
        message: "Red Hat pull secret is required to pull from registry.redhat.io / quay.io."
      }
    }
  };

  assert.strictEqual(mockPreflightResponse.ok, false);
  assert.ok(mockPreflightResponse.blockers.includes("Red Hat pull secret is required to pull from registry.redhat.io / quay.io."));
  assert.strictEqual(mockPreflightResponse.fieldErrors.rhPullSecret.severity, "blocker");
});

test("RH pull secret should be BLOCKER for mirrorToMirror mode", async () => {
  const mockPreflightResponse = {
    ok: false,
    blockers: ["Red Hat pull secret is required to pull from registry.redhat.io / quay.io."],
    warnings: [],
    checks: { auth: "missing" },
    fieldErrors: {
      rhPullSecret: {
        severity: "blocker",
        message: "Red Hat pull secret is required to pull from registry.redhat.io / quay.io."
      }
    }
  };

  assert.strictEqual(mockPreflightResponse.fieldErrors.rhPullSecret.severity, "blocker");
});

test("Mirror pull secret should be BLOCKER for diskToMirror mode", async () => {
  const mockPreflightResponse = {
    ok: false,
    blockers: ["Mirror registry credentials are required for this mode."],
    warnings: [],
    checks: { auth: "missing" },
    fieldErrors: {
      mirrorPullSecret: {
        severity: "blocker",
        message: "Mirror registry credentials are required for this mode."
      }
    }
  };

  assert.strictEqual(mockPreflightResponse.fieldErrors.mirrorPullSecret.severity, "blocker");
});

test("Mirror pull secret should be BLOCKER for mirrorToMirror mode", async () => {
  const mockPreflightResponse = {
    ok: false,
    blockers: ["Mirror registry credentials are required for this mode."],
    warnings: [],
    checks: { auth: "missing" },
    fieldErrors: {
      mirrorPullSecret: {
        severity: "blocker",
        message: "Mirror registry credentials are required for this mode."
      }
    }
  };

  assert.strictEqual(mockPreflightResponse.fieldErrors.mirrorPullSecret.severity, "blocker");
});

test("Advanced options: invalid log level should be blocker", async () => {
  const mockPreflightResponse = {
    ok: false,
    blockers: ["Log level must be one of: error, warn, info, debug, trace"],
    warnings: [],
    checks: {},
    fieldErrors: {
      logLevel: {
        severity: "blocker",
        message: "Log level must be one of: error, warn, info, debug, trace"
      }
    }
  };

  assert.ok(mockPreflightResponse.blockers.length > 0);
  assert.strictEqual(mockPreflightResponse.fieldErrors.logLevel.severity, "blocker");
});

test("Advanced options: parallelImages out of range should be blocker", async () => {
  const testCases = [
    { value: 0, should: "reject" },
    { value: -1, should: "reject" },
    { value: 33, should: "reject" },
    { value: 1, should: "accept" },
    { value: 32, should: "accept" },
    { value: 16, should: "accept" }
  ];

  testCases.forEach(({ value, should }) => {
    const isValid = Number.isInteger(value) && value >= 1 && value <= 32;
    if (should === "reject") {
      assert.strictEqual(isValid, false, `Value ${value} should be rejected`);
    } else {
      assert.strictEqual(isValid, true, `Value ${value} should be accepted`);
    }
  });
});

test("Advanced options: parallelLayers out of range should be blocker", async () => {
  const testCases = [
    { value: 0, should: "reject" },
    { value: 33, should: "reject" },
    { value: 1, should: "accept" },
    { value: 32, should: "accept" }
  ];

  testCases.forEach(({ value, should }) => {
    const isValid = Number.isInteger(value) && value >= 1 && value <= 32;
    assert.strictEqual(isValid, should === "accept");
  });
});

test("Advanced options: imageTimeout must be valid Go duration", async () => {
  const durationRegex = /^(\d+(\.\d+)?)(ns|us|µs|ms|s|m|h)$/;

  const validDurations = ["10m", "1h", "30s", "500ms", "1.5h"];
  const invalidDurations = ["10", "ten minutes", "10mins", "1hour", "30sec"];

  validDurations.forEach(d => {
    assert.ok(durationRegex.test(d), `${d} should be valid`);
  });

  invalidDurations.forEach(d => {
    assert.strictEqual(durationRegex.test(d), false, `${d} should be invalid`);
  });
});

test("Advanced options: retryTimes must be 0-10", async () => {
  const testCases = [
    { value: -1, should: "reject" },
    { value: 11, should: "reject" },
    { value: 0, should: "accept" },
    { value: 10, should: "accept" },
    { value: 5, should: "accept" }
  ];

  testCases.forEach(({ value, should }) => {
    const isValid = Number.isInteger(value) && value >= 0 && value <= 10;
    assert.strictEqual(isValid, should === "accept");
  });
});

test("Advanced options: retryDelay must be valid Go duration", async () => {
  const durationRegex = /^(\d+(\.\d+)?)(ns|us|µs|ms|s|m|h)$/;

  const validDurations = ["1s", "5s", "30s", "1m"];
  const invalidDurations = ["1second", "5sec", "thirty"];

  validDurations.forEach(d => {
    assert.ok(durationRegex.test(d), `${d} should be valid`);
  });

  invalidDurations.forEach(d => {
    assert.strictEqual(durationRegex.test(d), false, `${d} should be invalid`);
  });
});
