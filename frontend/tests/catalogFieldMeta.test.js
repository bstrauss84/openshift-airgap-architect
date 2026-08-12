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
import { getFieldMeta, hasAllowedList, getParamMeta, isParamVisibleForVersion } from "../src/catalogFieldMeta.js";
import { getCatalogForScenario } from "../src/catalogPaths.js";

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

describe("Slice 5H: isParamVisibleForVersion", () => {

  it("supported-ui minVersion 4.21: false at 4.20, true at 4.21", () => {
    const param = { supportStatus: "supported-ui", minVersion: "4.21", maxVersion: null };
    expect(isParamVisibleForVersion(param, "4.20")).toBe(false);
    expect(isParamVisibleForVersion(param, "4.21")).toBe(true);
  });

  it("supported-ui maxVersion 4.20: true at 4.20 (inclusive), false at 4.21", () => {
    const param = { supportStatus: "supported-ui", minVersion: "4.20", maxVersion: "4.20" };
    expect(isParamVisibleForVersion(param, "4.20")).toBe(true);
    expect(isParamVisibleForVersion(param, "4.21")).toBe(false);
  });

  it("supported-ui maxVersion null: true at 4.20 and 4.21", () => {
    const param = { supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null };
    expect(isParamVisibleForVersion(param, "4.20")).toBe(true);
    expect(isParamVisibleForVersion(param, "4.21")).toBe(true);
  });

  it("deprecated-supported within range: true", () => {
    const param = { supportStatus: "deprecated-supported", minVersion: "4.20", maxVersion: null };
    expect(isParamVisibleForVersion(param, "4.20")).toBe(true);
  });

  it("each non-user-editable schema status returns false", () => {
    const nonRenderable = [
      "supported-derived",
      "supported-backend-only",
      "docs-only-not-supported",
      "hidden-not-applicable",
      "removed",
      "unknown-needs-review"
    ];
    for (const status of nonRenderable) {
      const param = { supportStatus: status, minVersion: "4.20", maxVersion: null };
      expect(isParamVisibleForVersion(param, "4.20")).toBe(false);
    }
  });

  it("missing supportStatus returns false", () => {
    const param = { minVersion: "4.20", maxVersion: null };
    expect(isParamVisibleForVersion(param, "4.20")).toBe(false);
  });

  it("unrecognized supportStatus returns false", () => {
    const param = { supportStatus: "brand-new-unknown-status", minVersion: "4.20", maxVersion: null };
    expect(isParamVisibleForVersion(param, "4.20")).toBe(false);
  });

  it("missing param returns false", () => {
    expect(isParamVisibleForVersion(null, "4.20")).toBe(false);
    expect(isParamVisibleForVersion(undefined, "4.20")).toBe(false);
  });

  it("missing selectedMinor returns false", () => {
    const param = { supportStatus: "supported-ui", minVersion: "4.20", maxVersion: null };
    expect(isParamVisibleForVersion(param, null)).toBe(false);
    expect(isParamVisibleForVersion(param, undefined)).toBe(false);
  });

  it("missing minVersion returns false", () => {
    // Schema requires minVersion; shared utility is permissive (treats missing as no bound).
    // Helper is conservative: missing minVersion -> false.
    const param = { supportStatus: "supported-ui", maxVersion: null };
    expect(isParamVisibleForVersion(param, "4.20")).toBe(false);
  });

  it("real 4.21 docs-only-not-supported delta param returns false at 4.21", () => {
    const params = getCatalogForScenario("bare-metal-ipi", "4.21");
    const dnsRecords = params.find(p => p.path === "platform.baremetal.dnsRecordsType");
    expect(dnsRecords).toBeDefined();
    expect(dnsRecords.supportStatus).toBe("docs-only-not-supported");
    expect(isParamVisibleForVersion(dnsRecords, "4.21")).toBe(false);
  });

  it("real supported-ui param within range returns true", () => {
    const params = getCatalogForScenario("bare-metal-agent", "4.20");
    const baseDomain = params.find(p => p.path === "baseDomain");
    expect(baseDomain).toBeDefined();
    expect(baseDomain.supportStatus).toBe("supported-ui");
    expect(isParamVisibleForVersion(baseDomain, "4.20")).toBe(true);
    expect(isParamVisibleForVersion(baseDomain, "4.21")).toBe(true);
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
