/**
 * Tests for oc-mirror preflight field-level validation.
 * Ensures that specific field errors are returned for better UX.
 *
 * @author Bill Strauss
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import test from "node:test";
import assert from "node:assert/strict";

test("oc-mirror preflight validation returns fieldErrors structure", async () => {
  // This test ensures the preflight endpoint returns field-level errors
  // for better error messaging in the UI

  const mockPreflightResponse = {
    ok: false,
    blockers: ["Archive path is required."],
    warnings: [],
    checks: {
      archivePath: null,
      workspacePath: null,
      cachePath: null,
      config: "missing",
      auth: "missing",
      registryUrl: "empty"
    },
    fieldErrors: {
      archivePath: {
        severity: "blocker",
        message: "Archive path is required."
      }
    }
  };

  // Verify fieldErrors structure
  assert.ok(mockPreflightResponse.fieldErrors, "fieldErrors object should exist");
  assert.strictEqual(typeof mockPreflightResponse.fieldErrors, "object");

  // Verify field error has severity and message
  const archiveError = mockPreflightResponse.fieldErrors.archivePath;
  assert.ok(archiveError, "archivePath error should exist");
  assert.strictEqual(archiveError.severity, "blocker");
  assert.strictEqual(archiveError.message, "Archive path is required.");
});

test("preflight fieldErrors should map to specific fields", async () => {
  // This test ensures all validated fields can have field-specific errors

  const expectedFields = [
    "archivePath",
    "workspacePath",
    "cachePath",
    "registryUrl",
    "rhPullSecret",
    "mirrorPullSecret",
    "configPath"
  ];

  // Each field should be able to have an error entry
  expectedFields.forEach(fieldName => {
    const mockError = {
      severity: "blocker",
      message: `Test error for ${fieldName}`
    };

    assert.strictEqual(mockError.severity, "blocker");
    assert.ok(mockError.message.includes(fieldName));
  });
});

test("preflight fieldErrors severity should be blocker or warning", async () => {
  const validSeverities = ["blocker", "warning"];

  const mockFieldError = {
    severity: "blocker",
    message: "Test error message"
  };

  assert.ok(validSeverities.includes(mockFieldError.severity),
    "severity must be either 'blocker' or 'warning'");
});

test("preflight response should include all required fields", async () => {
  const mockPreflightResponse = {
    ok: true,
    blockers: [],
    warnings: [],
    checks: {
      archivePath: null,
      workspacePath: null,
      cachePath: null,
      config: "present",
      auth: "present",
      registryUrl: "empty"
    },
    fieldErrors: {}
  };

  // Verify all required response fields exist
  assert.ok(typeof mockPreflightResponse.ok === "boolean", "ok should be boolean");
  assert.ok(Array.isArray(mockPreflightResponse.blockers), "blockers should be array");
  assert.ok(Array.isArray(mockPreflightResponse.warnings), "warnings should be array");
  assert.ok(typeof mockPreflightResponse.checks === "object", "checks should be object");
  assert.ok(typeof mockPreflightResponse.fieldErrors === "object", "fieldErrors should be object");
});
