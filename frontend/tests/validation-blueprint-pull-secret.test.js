/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, expect } from "vitest";
import {
  validateBlueprintPullSecretOptional,
  validateStep,
  isValidPullSecret
} from "../src/validation.js";

describe("validateBlueprintPullSecretOptional", () => {
  it("accepts empty or whitespace as valid", () => {
    expect(validateBlueprintPullSecretOptional("").valid).toBe(true);
    expect(validateBlueprintPullSecretOptional("   ").valid).toBe(true);
    expect(validateBlueprintPullSecretOptional(null).valid).toBe(true);
  });

  it("accepts valid Red Hat pull secret JSON with auths", () => {
    const valid = '{"auths":{"registry.redhat.io":{"auth":"abc"}}}';
    expect(validateBlueprintPullSecretOptional(valid).valid).toBe(true);
    expect(validateBlueprintPullSecretOptional(valid).error).toBe("");
  });

  it("rejects invalid JSON", () => {
    const r = validateBlueprintPullSecretOptional("not json");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/valid JSON/i);
  });

  it("rejects JSON without auths object", () => {
    const r = validateBlueprintPullSecretOptional('{"other": true}');
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/auths/i);
  });
});

describe("validateStep(blueprint) with pull secret", () => {
  it("returns no pull secret error when field is empty", () => {
    const state = {
      blueprint: { confirmed: false, blueprintPullSecretEphemeral: "" },
      release: {},
      version: {}
    };
    const result = validateStep(state, "blueprint");
    expect(result.errors.some((e) => e.includes("Pull secret") || e.includes("auths"))).toBe(false);
  });

  it("returns error when pull secret is invalid and blocks lock", () => {
    const state = {
      blueprint: { confirmed: false, blueprintPullSecretEphemeral: "invalid" },
      release: {},
      version: {}
    };
    const result = validateStep(state, "blueprint");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes("JSON") || e.includes("auths"))).toBe(true);
  });

  it("returns no pull secret error when value is valid JSON with auths", () => {
    const state = {
      blueprint: {
        confirmed: false,
        blueprintPullSecretEphemeral: '{"auths":{"registry.redhat.io":{}}}'
      },
      release: {},
      version: {}
    };
    const result = validateStep(state, "blueprint");
    expect(result.errors.filter((e) => e.includes("Pull secret") || e.includes("auths") || e.includes("JSON"))).toHaveLength(0);
  });
});

describe("isValidPullSecret (no logging of secret in tests)", () => {
  it("does not expose secret in error message", () => {
    const secret = '{"auths":{"x":"my-secret-value"}}';
    const r = isValidPullSecret(secret);
    expect(r.valid).toBe(true);
    expect(r.error).toBe("");
    expect(String(r)).not.toContain("my-secret-value");
  });
});
