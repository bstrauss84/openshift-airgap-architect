/**
 * A1: Validation respects catalog required/allowed; MAC format normalization.
 */

import { describe, it, expect } from "vitest";
import { validateNode, validateStep } from "../src/validation.js";
import { getRequiredParamsForOutput } from "../src/catalogResolver.js";
import { getParamMeta, hasAllowedList } from "../src/catalogFieldMeta.js";

describe("A1: validateNode MAC normalization", () => {
  it("accepts MAC address without colons (normalized for validation)", () => {
    const node = {
      hostname: "node-0",
      role: "master",
      rootDevice: "/dev/disk/by-id/foo",
      bmc: { address: "http://bmc", username: "u", password: "p", bootMACAddress: "aabbccddeeff" },
      primary: {
        type: "ethernet",
        mode: "static",
        ethernet: { name: "eth0", macAddress: "525400aabbcc" },
        ipv4Cidr: "192.168.1.10/24",
        ipv4Gateway: "192.168.1.1"
      }
    };
    const result = validateNode({
      node,
      enableIpv6: false,
      machineCidr: "192.168.1.0/24",
      platform: "Bare Metal",
      method: "IPI",
      includeCredentials: true
    });
    expect(result.fieldErrors["primary.ethernet.macAddress"]).toBeUndefined();
    expect(result.fieldErrors["bmc.bootMACAddress"]).toBeUndefined();
  });

  it("arbiter node skips additional-interface validation (matches reduced arbiter drawer)", () => {
    const node = {
      hostname: "arbiter-0",
      role: "arbiter",
      rootDevice: "/dev/disk/by-id/foo",
      primary: {
        type: "ethernet",
        mode: "dhcp",
        ethernet: { name: "eth0", macAddress: "52:54:00:aa:11:01" }
      },
      additionalInterfaces: [
        { type: "ethernet", mode: "static", ethernet: { name: "", macAddress: "" } }
      ]
    };
    const result = validateNode({
      node,
      enableIpv6: false,
      machineCidr: "10.0.0.0/24",
      platform: "VMware vSphere",
      method: "Agent-Based Installer",
      includeCredentials: false
    });
    expect(result.errors.some((e) => /Additional ethernet interface name is required/i.test(e))).toBe(false);
  });

  it("rejects invalid primary.ethernet.macAddress format (normalizer cannot produce valid MAC)", () => {
    const node = {
      hostname: "n",
      role: "master",
      rootDevice: "x",
      bmc: { address: "x", bootMACAddress: "52:54:00:aa:bb:cc" },
      primary: { type: "ethernet", mode: "dhcp", ethernet: { name: "eth0", macAddress: "not-valid-mac" } }
    };
    const result = validateNode({
      node,
      enableIpv6: false,
      machineCidr: "192.168.1.0/24",
      platform: "Bare Metal",
      method: "IPI",
      includeCredentials: false
    });
    expect(result.fieldErrors["primary.ethernet.macAddress"]).toBeDefined();
  });
});

describe("A1: getRequiredParamsForOutput matches catalog required", () => {
  it("returns only params with required true for install-config (bare-metal-agent)", () => {
    const paths = getRequiredParamsForOutput("bare-metal-agent", "install-config.yaml");
    expect(paths).toContain("baseDomain");
    expect(paths).toContain("pullSecret");
    expect(paths.every((p) => typeof p === "string")).toBe(true);
  });
});

describe("A1: widget type from catalog (dropdown when allowed array)", () => {
  it("additionalTrustBundlePolicy has allowed list so UI should use dropdown", () => {
    const meta = getParamMeta("bare-metal-agent", "additionalTrustBundlePolicy", "install-config.yaml");
    expect(hasAllowedList("bare-metal-agent", "install-config.yaml", "additionalTrustBundlePolicy")).toBe(true);
    expect(Array.isArray(meta.allowed)).toBe(true);
    expect(meta.allowed).toContain("Proxyonly");
    expect(meta.allowed).toContain("Always");
  });

  it("networking.networkType has single allowed OVNKubernetes in 4.20 catalog", () => {
    const meta = getParamMeta("bare-metal-agent", "networking.networkType", "install-config.yaml");
    expect(meta.type).toBe("string");
    const allowed = Array.isArray(meta.allowed) ? meta.allowed : (meta.allowed ? [meta.allowed] : []);
    expect(allowed.length).toBeGreaterThanOrEqual(1);
    expect(allowed).toContain("OVNKubernetes");
  });
});

describe("A1: validateStep platformConfig respects catalog-required fields", () => {
  it("vSphere IPI with legacy placement requires vcenter, datacenter, cluster, datastore, network", () => {
    const state = {
      blueprint: { platform: "VMware vSphere" },
      methodology: { method: "IPI" },
      platformConfig: { vsphere: { placementMode: "legacy" } }
    };
    const result = validateStep(state, "networking");
    expect(result.errors.some((e) => e.includes("vCenter") || e.includes("Datacenter") || e.includes("Cluster") || e.includes("Datastore") || e.includes("Network"))).toBe(true);
  });

  it("vSphere IPI with failure-domains placement does not require vcenter/datacenter in global step", () => {
    const state = {
      blueprint: { platform: "VMware vSphere" },
      methodology: { method: "IPI" },
      platformConfig: { vsphere: { placementMode: "failureDomains" } }
    };
    const result = validateStep(state, "networking");
    expect(result.errors.some((e) => e.includes("vCenter server is required") || e.includes("Datacenter is required"))).toBe(false);
  });
});

describe("A1: validation inclusion policy uses resolved per-class controls", () => {
  it("treats missing vSphere platform credentials as errors when platformCredentials inclusion is enabled", () => {
    const state = {
      blueprint: { platform: "VMware vSphere" },
      methodology: { method: "IPI" },
      exportOptions: {
        includeCredentials: false,
        inclusion: {
          platformCredentials: true,
          pullSecret: false,
          mirrorRegistryCredentials: false,
          bmcCredentials: false
        }
      },
      platformConfig: { vsphere: { placementMode: "failureDomains" } },
      credentials: { pullSecretPlaceholder: "{\"auths\":{}}" }
    };
    const result = validateStep(state, "networking");
    expect(result.errors.some((e) => e.includes("vCenter username is required"))).toBe(true);
    expect(result.errors.some((e) => e.includes("vCenter password is required"))).toBe(true);
  });

  it("treats missing vSphere platform credentials as warnings when platformCredentials inclusion is disabled", () => {
    const state = {
      blueprint: { platform: "VMware vSphere" },
      methodology: { method: "IPI" },
      exportOptions: {
        includeCredentials: true,
        inclusion: {
          platformCredentials: false,
          pullSecret: true,
          mirrorRegistryCredentials: true,
          bmcCredentials: true
        }
      },
      platformConfig: { vsphere: { placementMode: "failureDomains" } },
      credentials: { pullSecretPlaceholder: "{\"auths\":{}}" }
    };
    const result = validateStep(state, "networking");
    expect(result.errors.some((e) => e.includes("vCenter username is required"))).toBe(false);
    expect(result.warnings.some((e) => e.includes("vCenter username is required"))).toBe(true);
  });
});
