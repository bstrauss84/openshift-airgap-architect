/**
 * Phase 4.3: Catalog-driven validation for Host Inventory v2 only.
 */

import { describe, it, expect } from "vitest";
import {
  getCatalogValidationForInventoryV2,
  mergeNodeValidation
} from "../src/hostInventoryV2Validation.js";

describe("Phase 4.3: getCatalogValidationForInventoryV2", () => {
  it("returns no errors when scenarioId is null", () => {
    const state = {
      hostInventory: { nodes: [{ role: "invalid" }], apiVip: "", ingressVip: "" },
      blueprint: { platform: "Bare Metal" },
      methodology: { method: "Agent-Based Installer" }
    };
    const result = getCatalogValidationForInventoryV2(state, null);
    expect(result.errors).toEqual([]);
    expect(result.perNode).toHaveLength(1);
    expect(result.perNode[0].errors).toEqual([]);
  });

  it("validates role enum when catalog has allowed list (bare-metal-agent)", () => {
    const state = {
      hostInventory: {
        nodes: [
          { role: "master", hostname: "m-0", primary: {} },
          { role: "invalid-role", hostname: "w-0", primary: {} }
        ],
        apiVip: "1.2.3.4",
        ingressVip: "1.2.3.5"
      },
      blueprint: { platform: "Bare Metal" },
      methodology: { method: "Agent-Based Installer" }
    };
    const result = getCatalogValidationForInventoryV2(state, "bare-metal-agent");
    expect(result.perNode[0].errors).toEqual([]);
    expect(result.perNode[0].fieldErrors.role).toBeUndefined();
    expect(result.perNode[1].errors.length).toBeGreaterThan(0);
    expect(result.perNode[1].fieldErrors.role).toMatch(/must be one of/i);
  });

  it("does not add API/Ingress VIP errors when catalog required is false", () => {
    const state = {
      hostInventory: { nodes: [], apiVip: "", ingressVip: "" },
      blueprint: { platform: "Bare Metal" },
      methodology: { method: "Agent-Based Installer" }
    };
    const result = getCatalogValidationForInventoryV2(state, "bare-metal-agent");
    expect(result.errors).toEqual([]);
  });

  it("perNode length matches nodes length", () => {
    const state = {
      hostInventory: { nodes: [{ role: "master" }, { role: "worker" }], apiVip: "x", ingressVip: "y" },
      blueprint: { platform: "Bare Metal" },
      methodology: { method: "Agent-Based Installer" }
    };
    const result = getCatalogValidationForInventoryV2(state, "bare-metal-agent");
    expect(result.perNode).toHaveLength(2);
  });

  it("bare-metal-ipi requires at least one host", () => {
    const state = {
      hostInventory: { nodes: [], schemaVersion: 2 },
      blueprint: { platform: "Bare Metal" },
      methodology: { method: "IPI" }
    };
    const result = getCatalogValidationForInventoryV2(state, "bare-metal-ipi");
    expect(result.errors).toContain("At least one host is required for bare metal IPI (install-config platform.baremetal.hosts).");
  });

  it("vsphere-agent: two control plane without arbiter yields catalog error (same rule as bare-metal-agent)", () => {
    const state = {
      hostInventory: {
        nodes: [
          { role: "master", hostname: "m-0", primary: {} },
          { role: "master", hostname: "m-1", primary: {} }
        ],
        apiVip: "10.0.0.1",
        ingressVip: "10.0.0.2"
      },
      blueprint: { platform: "VMware vSphere" },
      methodology: { method: "Agent-Based Installer" }
    };
    const result = getCatalogValidationForInventoryV2(state, "vsphere-agent");
    expect(result.errors.some((e) => /arbiter/i.test(e))).toBe(true);
  });

  it("bare-metal-agent with Day-2 install-config warns when BMC address missing", () => {
    const state = {
      hostInventory: {
        nodes: [{ role: "master", hostname: "m-0", primary: {}, bmc: {} }],
        apiVip: "10.0.0.1",
        ingressVip: "10.0.0.2",
        includeBareMetalDay2InInstallConfig: true
      },
      blueprint: { platform: "Bare Metal" },
      methodology: { method: "Agent-Based Installer" }
    };
    const result = getCatalogValidationForInventoryV2(state, "bare-metal-agent");
    expect(result.perNode[0].warnings.some((w) => /Day-2 install-config/i.test(w))).toBe(true);
  });

  it("bare-metal-ipi adds per-node warning when BMC address missing", () => {
    const state = {
      hostInventory: {
        nodes: [
          { role: "master", hostname: "m-0", bmc: { address: "redfish+http://x" } },
          { role: "worker", hostname: "w-0", bmc: {} }
        ],
        schemaVersion: 2
      },
      blueprint: { platform: "Bare Metal" },
      methodology: { method: "IPI" }
    };
    const result = getCatalogValidationForInventoryV2(state, "bare-metal-ipi");
    expect(result.perNode[0].warnings).not.toContain("BMC address is recommended for provisioning.");
    expect(result.perNode[1].warnings).toContain("BMC address is recommended for provisioning.");
  });
});

describe("Phase 4.3: mergeNodeValidation", () => {
  it("merges base and catalog errors and fieldErrors", () => {
    const base = { errors: ["Hostname is required."], warnings: [], fieldErrors: { hostname: "Hostname is required." } };
    const catalog = { errors: ["Role must be one of: master, worker."], warnings: [], fieldErrors: { role: "Role must be one of: master, worker." } };
    const merged = mergeNodeValidation(base, catalog);
    expect(merged.errors).toHaveLength(2);
    expect(merged.errors).toContain("Hostname is required.");
    expect(merged.errors).toContain("Role must be one of: master, worker.");
    expect(merged.fieldErrors.hostname).toBeDefined();
    expect(merged.fieldErrors.role).toBeDefined();
  });

  it("handles empty catalog", () => {
    const base = { errors: ["x"], warnings: [], fieldErrors: { f: "x" } };
    const merged = mergeNodeValidation(base, {});
    expect(merged.errors).toEqual(["x"]);
    expect(merged.fieldErrors.f).toBe("x");
  });
});
