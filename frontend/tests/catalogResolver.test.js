/**
 * Phase 5: Catalog Meta + Validation — catalogResolver API for replacement tabs.
 */

import { describe, it, expect } from "vitest";
import {
  getScenarioId,
  getCatalogForScenario,
  getParamMeta,
  getRequiredParamsForOutput
} from "../src/catalogResolver.js";

describe("catalogResolver: getScenarioId(state)", () => {
  it("returns bare-metal-agent when platform is Bare Metal and method is Agent-Based Installer", () => {
    const state = {
      blueprint: { platform: "Bare Metal" },
      methodology: { method: "Agent-Based Installer" }
    };
    expect(getScenarioId(state)).toBe("bare-metal-agent");
  });

  it("returns bare-metal-ipi when platform is Bare Metal and method is IPI", () => {
    const state = {
      blueprint: { platform: "Bare Metal" },
      methodology: { method: "IPI" }
    };
    expect(getScenarioId(state)).toBe("bare-metal-ipi");
  });

  it("returns bare-metal-upi when platform is Bare Metal and method is UPI", () => {
    const state = {
      blueprint: { platform: "Bare Metal" },
      methodology: { method: "UPI" }
    };
    expect(getScenarioId(state)).toBe("bare-metal-upi");
  });

  it("returns aws-govcloud-ipi when platform is AWS GovCloud and method is IPI", () => {
    const state = { blueprint: { platform: "AWS GovCloud" }, methodology: { method: "IPI" } };
    expect(getScenarioId(state)).toBe("aws-govcloud-ipi");
  });

  it("returns aws-govcloud-upi when platform is AWS GovCloud and method is UPI", () => {
    const state = { blueprint: { platform: "AWS GovCloud" }, methodology: { method: "UPI" } };
    expect(getScenarioId(state)).toBe("aws-govcloud-upi");
  });

  it("returns azure-government-ipi when platform is Azure Government and method is IPI", () => {
    const state = { blueprint: { platform: "Azure Government" }, methodology: { method: "IPI" } };
    expect(getScenarioId(state)).toBe("azure-government-ipi");
  });

  it("returns nutanix-ipi when platform is Nutanix and method is IPI (Prompt J)", () => {
    const state = { blueprint: { platform: "Nutanix" }, methodology: { method: "IPI" } };
    expect(getScenarioId(state)).toBe("nutanix-ipi");
  });

  it("returns null when platform is not a known scenario (e.g. vSphere typo or empty)", () => {
    expect(getScenarioId({ blueprint: { platform: "vSphere" }, methodology: { method: "IPI" } })).toBeNull();
    expect(getScenarioId({ blueprint: {}, methodology: { method: "Agent-Based Installer" } })).toBeNull();
  });

  it("returns null when state is missing or incomplete", () => {
    expect(getScenarioId(null)).toBeNull();
    expect(getScenarioId({})).toBeNull();
  });
});

describe("catalogResolver: getCatalogForScenario", () => {
  it("returns parameters array for bare-metal-agent", () => {
    const params = getCatalogForScenario("bare-metal-agent");
    expect(Array.isArray(params)).toBe(true);
    expect(params.length).toBeGreaterThan(0);
    expect(params[0]).toHaveProperty("path");
    expect(params[0]).toHaveProperty("outputFile");
  });

  it("returns parameters array for bare-metal-upi without platform.baremetal VIPs (4.20 UPI: platform.none only)", () => {
    const params = getCatalogForScenario("bare-metal-upi");
    expect(Array.isArray(params)).toBe(true);
    expect(params.length).toBeGreaterThan(0);
    expect(params.some((p) => p.path === "platform.baremetal.apiVIP" && p.outputFile === "install-config.yaml")).toBe(false);
    expect(params.some((p) => p.path === "platform.baremetal.apiVIPs" && p.outputFile === "install-config.yaml")).toBe(false);
    expect(params.some((p) => p.path === "apiVersion" && p.outputFile === "install-config.yaml")).toBe(true);
  });

  it("returns parameters array for aws-govcloud-ipi with platform.aws.region (Prompt J)", () => {
    const params = getCatalogForScenario("aws-govcloud-ipi");
    expect(Array.isArray(params)).toBe(true);
    expect(params.length).toBeGreaterThan(0);
    expect(params.some((p) => p.path === "platform.aws.region" && p.outputFile === "install-config.yaml")).toBe(true);
  });

  it("returns parameters array for aws-govcloud-upi with platform.aws.region and platform.aws.vpc.subnets (Prompt J)", () => {
    const params = getCatalogForScenario("aws-govcloud-upi");
    expect(Array.isArray(params)).toBe(true);
    expect(params.length).toBeGreaterThan(0);
    expect(params.some((p) => p.path === "platform.aws.region" && p.outputFile === "install-config.yaml")).toBe(true);
    expect(params.some((p) => p.path === "platform.aws.vpc.subnets" && p.outputFile === "install-config.yaml")).toBe(true);
  });

  it("returns parameters array for nutanix-ipi with platform.nutanix.prismCentral and platform.nutanix.subnet (Prompt J)", () => {
    const params = getCatalogForScenario("nutanix-ipi");
    expect(Array.isArray(params)).toBe(true);
    expect(params.length).toBeGreaterThan(0);
    expect(params.some((p) => p.path === "platform.nutanix.prismCentral" && p.outputFile === "install-config.yaml")).toBe(true);
    expect(params.some((p) => p.path === "platform.nutanix.prismCentral.endpoint.address" && p.outputFile === "install-config.yaml")).toBe(
      true
    );
    expect(params.some((p) => p.path === "platform.nutanix.apiVIP" && p.outputFile === "install-config.yaml")).toBe(true);
    expect(params.some((p) => p.path === "platform.nutanix.ingressVIP" && p.outputFile === "install-config.yaml")).toBe(true);
    expect(params.some((p) => p.path === "platform.nutanix.subnet" && p.outputFile === "install-config.yaml")).toBe(true);
  });

  it("returns empty array for unknown scenario", () => {
    expect(getCatalogForScenario("unknown-scenario")).toEqual([]);
    expect(getCatalogForScenario(null)).toEqual([]);
  });
});

describe("catalogResolver: getParamMeta (re-export)", () => {
  it("returns expected shape for metadata.name and baseDomain for bare-metal-agent", () => {
    const metaName = getParamMeta("bare-metal-agent", "metadata.name", "install-config.yaml");
    expect(metaName).toHaveProperty("type", "string");
    expect(metaName).toHaveProperty("required", false);
    expect(metaName).toHaveProperty("description");
    expect(metaName.description).toContain("Cluster name");

    const metaBase = getParamMeta("bare-metal-agent", "baseDomain", "install-config.yaml");
    expect(metaBase).toHaveProperty("required", true);
    expect(metaBase).toHaveProperty("description");
  });
});

describe("catalogResolver: getRequiredParamsForOutput", () => {
  it("returns required paths for install-config.yaml (bare-metal-agent); required flags match catalog", () => {
    const paths = getRequiredParamsForOutput("bare-metal-agent", "install-config.yaml");
    expect(Array.isArray(paths)).toBe(true);
    expect(paths).toContain("baseDomain");
    expect(paths).toContain("pullSecret");
    expect(paths).toContain("apiVersion");
    expect(paths).toContain("metadata");
  });

  it("returns required paths for agent-config.yaml (bare-metal-agent)", () => {
    const paths = getRequiredParamsForOutput("bare-metal-agent", "agent-config.yaml");
    expect(paths).toContain("apiVersion");
    expect(paths).toContain("metadata");
  });

  it("returns empty array for unknown scenario or no match", () => {
    expect(getRequiredParamsForOutput(null, "install-config.yaml")).toEqual([]);
    expect(getRequiredParamsForOutput("unknown-scenario", "install-config.yaml")).toEqual([]);
  });

  it("returns required paths for install-config.yaml (bare-metal-upi); install-config only, no agent-config", () => {
    const paths = getRequiredParamsForOutput("bare-metal-upi", "install-config.yaml");
    expect(Array.isArray(paths)).toBe(true);
    expect(paths).toContain("baseDomain");
    expect(paths).toContain("pullSecret");
    expect(paths).toContain("apiVersion");
    expect(paths).toContain("metadata");
    expect(paths).toContain("platform");
  });

  it("returns empty array for agent-config (bare-metal-upi has no agent-config)", () => {
    const paths = getRequiredParamsForOutput("bare-metal-upi", "agent-config.yaml");
    expect(paths).toEqual([]);
  });
});
