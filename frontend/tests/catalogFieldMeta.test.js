/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * Phase 4.3: Field meta resolver (getFieldMeta, hasAllowedList).
 */

import { describe, it, expect } from "vitest";
import { getFieldMeta, hasAllowedList, getParamMeta } from "../src/catalogFieldMeta.js";

describe("Phase 4.3: getFieldMeta", () => {
  it("returns null when scenarioId is null", () => {
    expect(getFieldMeta(null, "install-config.yaml", "baseDomain")).toBeNull();
  });

  it("returns null when path is not in catalog", () => {
    expect(getFieldMeta("bare-metal-agent", "install-config.yaml", "nonexistent.path")).toBeNull();
  });

  it("returns type, allowed, required, default when specified (not 'not specified in docs')", () => {
    const meta = getFieldMeta("bare-metal-agent", "install-config.yaml", "additionalTrustBundlePolicy");
    expect(meta).not.toBeNull();
    expect(meta.type).toBe("string");
    expect(meta.allowed).toEqual(["Proxyonly", "Always"]);
    expect(meta.required).toBe(false);
    expect(meta.default).toBe("Proxyonly");
  });

  it("returns required true for baseDomain in install-config", () => {
    const meta = getFieldMeta("bare-metal-agent", "install-config.yaml", "baseDomain");
    expect(meta).not.toBeNull();
    expect(meta.required).toBe(true);
  });

  it("returns allowed array for hosts[].role in agent-config", () => {
    const meta = getFieldMeta("bare-metal-agent", "agent-config.yaml", "hosts[].role");
    expect(meta).not.toBeNull();
    expect(Array.isArray(meta.allowed)).toBe(true);
    expect(meta.allowed).toContain("master");
    expect(meta.allowed).toContain("worker");
  });

  it("returns null allowed when catalog says 'not specified in docs'", () => {
    const meta = getFieldMeta("bare-metal-agent", "install-config.yaml", "platform.baremetal.hosts[].name");
    expect(meta).not.toBeNull();
    expect(meta.required).toBe(false);
    expect(meta.allowed).toBeNull();
  });
});

describe("Phase 4.3: hasAllowedList", () => {
  it("returns true when catalog has array allowed", () => {
    expect(hasAllowedList("bare-metal-agent", "agent-config.yaml", "hosts[].role")).toBe(true);
    expect(hasAllowedList("bare-metal-agent", "install-config.yaml", "additionalTrustBundlePolicy")).toBe(true);
  });

  it("returns false when catalog has no allowed or string allowed", () => {
    expect(hasAllowedList("bare-metal-agent", "install-config.yaml", "platform.baremetal.apiVIP")).toBe(false);
    expect(hasAllowedList(null, "install-config.yaml", "baseDomain")).toBe(false);
  });
});

describe("Phase 5: getParamMeta", () => {
  it("returns expected shape for metadata.name (bare-metal-agent install-config)", () => {
    const meta = getParamMeta("bare-metal-agent", "metadata.name", "install-config.yaml");
    expect(meta).toEqual(
      expect.objectContaining({
        type: "string",
        required: false,
        description: expect.any(String)
      })
    );
    expect(meta.description).toContain("Cluster name");
    expect(meta.default).toBe("agent-cluster when not provided");
  });

  it("returns expected shape for baseDomain (bare-metal-agent); required matches catalog", () => {
    const meta = getParamMeta("bare-metal-agent", "baseDomain", "install-config.yaml");
    expect(meta).toEqual(
      expect.objectContaining({
        type: "string",
        required: true,
        description: expect.any(String)
      })
    );
    expect(meta.description).toContain("Base domain");
  });

  it("returns safe defaults when parameter not in catalog (required: false)", () => {
    const meta = getParamMeta("bare-metal-agent", "nonexistent.path", "install-config.yaml");
    expect(meta).toEqual({
      type: null,
      allowed: null,
      default: null,
      required: false,
      description: null
    });
  });

  it("returns safe defaults when scenarioId is null", () => {
    const meta = getParamMeta(null, "metadata.name", "install-config.yaml");
    expect(meta.required).toBe(false);
    expect(meta.description).toBeNull();
  });
});
