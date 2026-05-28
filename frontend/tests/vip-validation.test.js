/**
 * VIP IP Address Validation Tests
 *
 * Tests for VIP validation across all scenarios to prevent invalid IP addresses:
 * 1. Invalid IPv4 addresses (bad octets, wrong format)
 * 2. Invalid IPv6 addresses (malformed, multiple ::)
 * 3. Comma-separated VIP arrays (vSphere IPI)
 * 4. Single VIPs (bare metal, Nutanix, vSphere Agent)
 * 5. Dual-stack validation (IPv4 + IPv6)
 * 6. IPv6-only validation
 *
 * Scenarios covered:
 * - vSphere IPI (comma-separated arrays)
 * - Nutanix IPI (single VIPs, dual-stack support)
 * - Bare metal Agent/IPI (single VIPs, dual-stack, IPv6-only)
 * - vSphere Agent (single VIPs, dual-stack)
 *
 * Created: 2026-05-28
 * Author: Bill Strauss
 */

import { describe, it, expect } from "vitest";

describe("VIP IP Address Validation", () => {
  // Actual validation helpers from validation.js (copied for testing)
  const isValidIpv4 = (value) => {
    const parts = value.split(".");
    if (parts.length !== 4) return false;
    return parts.every((part) => {
      if (!/^\d+$/.test(part)) return false;
      const num = Number(part);
      return num >= 0 && num <= 255;
    });
  };

  const isValidIpv6 = (value) => {
    if (!value || typeof value !== "string") return false;
    const trimmed = value.trim();
    if (trimmed.includes("/")) return false;

    // Quick reject obviously invalid patterns
    if (trimmed === "" || trimmed === ":" || trimmed === ":::" || trimmed.includes(":::")) return false;

    // Handle special cases
    if (trimmed === "::") return true; // All zeros

    // Split on :: for compressed notation
    const parts = trimmed.split("::");

    // Can only have one :: (compression)
    if (parts.length > 2) return false;

    if (parts.length === 2) {
      // Compressed format - validate each side
      const left = parts[0] ? parts[0].split(":") : [];
      const right = parts[1] ? parts[1].split(":") : [];

      // Total groups must be less than 8 (compression replaces at least one group)
      if (left.length + right.length >= 8) return false;

      // Validate each group
      const allGroups = [...left, ...right];
      for (const group of allGroups) {
        if (group === "") return false; // Empty groups not allowed except in ::
        if (group.length > 4) return false;
        if (!/^[0-9a-fA-F]+$/.test(group)) return false;
      }

      return true;
    } else {
      // Full format - must have exactly 8 groups
      const groups = trimmed.split(":");
      if (groups.length !== 8) return false;

      for (const group of groups) {
        if (group === "" || group.length > 4) return false;
        if (!/^[0-9a-fA-F]+$/.test(group)) return false;
      }

      return true;
    }
  };

  // getScenarioId helper (matches hostInventoryV2Helpers.js signature)
  const getScenarioId = (platform, method) => {
    if (!platform || !method) return null;
    return `${platform}-${method}`;
  };

  // Define validateVipAddresses to match the actual implementation
  const validateVipAddresses = (state) => {
    const errors = [];
    const fieldErrors = {};

    const scenarioId = getScenarioId(state?.blueprint?.platform, state?.methodology?.method);
    if (!scenarioId) return { errors, warnings: [], fieldErrors };

    const hostInventory = state.hostInventory || {};

    // SNO (Single Node OpenShift) detection - VIPs not required for SNO
    const isSno = () => {
      // Agent-based scenarios: check node count (1 master, 0 workers)
      if (scenarioId === "bare-metal-agent" || scenarioId === "vsphere-agent") {
        const nodes = hostInventory.nodes || [];
        const masterCount = nodes.filter((n) => n.role === "master").length;
        const workerCount = nodes.filter((n) => n.role === "worker").length;
        return masterCount === 1 && workerCount === 0;
      }

      // IPI scenarios: check controlPlane and compute replicas
      if (scenarioId === "bare-metal-ipi" || scenarioId === "vsphere-ipi" || scenarioId === "nutanix-ipi") {
        const controlPlane = state.controlPlane || {};
        const compute = state.compute || {};
        return controlPlane.replicas === 1 && compute.replicas === 0;
      }

      return false;
    };

    // Skip VIP validation for SNO - VIPs are not used in single-node configurations
    if (isSno()) {
      return { errors, warnings: [], fieldErrors };
    }

    const validateSingleVip = (vip, fieldName, ipVersion) => {
      const trimmed = vip.trim();
      if (!trimmed) return;

      if (ipVersion === "ipv4") {
        if (!isValidIpv4(trimmed)) {
          errors.push(`${fieldName} "${trimmed}" is not a valid IPv4 address.`);
          fieldErrors[fieldName] = "Invalid IPv4 address";
        }
      } else if (ipVersion === "ipv6") {
        if (!isValidIpv6(trimmed)) {
          errors.push(`${fieldName} "${trimmed}" is not a valid IPv6 address.`);
          fieldErrors[fieldName] = "Invalid IPv6 address";
        }
      }
    };

    const validateVipArray = (vipString, fieldName, ipVersion) => {
      if (!vipString || vipString.trim() === "") return;
      const vips = vipString.split(",").map((v) => v.trim()).filter(Boolean);
      for (const vip of vips) {
        validateSingleVip(vip, fieldName, ipVersion);
      }
    };

    // vSphere IPI uses comma-separated arrays
    if (scenarioId === "vsphere-ipi") {
      const vsphere = state?.platformConfig?.vsphere || {};
      const apiVIPs = Array.isArray(vsphere.apiVIPs) ? vsphere.apiVIPs.join(",") : "";
      const ingressVIPs = Array.isArray(vsphere.ingressVIPs) ? vsphere.ingressVIPs.join(",") : "";
      const apiVIPsV6 = Array.isArray(vsphere.apiVIPsV6) ? vsphere.apiVIPsV6.join(",") : "";
      const ingressVIPsV6 = Array.isArray(vsphere.ingressVIPsV6) ? vsphere.ingressVIPsV6.join(",") : "";

      validateVipArray(apiVIPs, "apiVip", "ipv4");
      validateVipArray(ingressVIPs, "ingressVip", "ipv4");
      validateVipArray(apiVIPsV6, "apiVipV6", "ipv6");
      validateVipArray(ingressVIPsV6, "ingressVipV6", "ipv6");
    }
    // Nutanix IPI uses single VIPs
    else if (scenarioId === "nutanix-ipi") {
      const nutanix = state?.platformConfig?.nutanix || {};
      validateSingleVip(nutanix.apiVIP || "", "nutanixApiVIP", "ipv4");
      validateSingleVip(nutanix.ingressVIP || "", "nutanixIngressVIP", "ipv4");
      validateSingleVip(nutanix.apiVIPV6 || "", "nutanixApiVIPV6", "ipv6");
      validateSingleVip(nutanix.ingressVIPV6 || "", "nutanixIngressVIPV6", "ipv6");
    }
    // Bare metal and vSphere Agent use hostInventory
    else {
      validateSingleVip(hostInventory.apiVip || "", "apiVip", "ipv4");
      validateSingleVip(hostInventory.ingressVip || "", "ingressVip", "ipv4");
      validateSingleVip(hostInventory.apiVipV6 || "", "apiVipV6", "ipv6");
      validateSingleVip(hostInventory.ingressVipV6 || "", "ingressVipV6", "ipv6");
    }

    return { errors, warnings: [], fieldErrors };
  };

  describe("IPv4 VIP Validation", () => {
    describe("Valid IPv4 VIPs", () => {
      it("should accept valid IPv4 address", () => {
        const state = {
          blueprint: { platform: "bare-metal" },
          methodology: { method: "agent" },
          hostInventory: { apiVip: "10.90.0.2" }
        };
        const result = validateVipAddresses(state);
        expect(result.errors.length).toBe(0);
      });

      it("should accept IPv4 with all octets at boundaries", () => {
        const state = {
          blueprint: { platform: "bare-metal" },
          methodology: { method: "agent" },
          hostInventory: {
            apiVip: "0.0.0.0",
            ingressVip: "255.255.255.255"
          }
        };
        const result = validateVipAddresses(state);
        expect(result.errors.length).toBe(0);
      });

      it("should accept multiple valid IPv4 VIPs for vSphere IPI", () => {
        const state = {
          blueprint: { platform: "vsphere" },
          methodology: { method: "ipi" },
          platformConfig: {
            vsphere: {
              apiVIPs: ["10.90.0.2", "192.168.1.10"],
              ingressVIPs: ["10.90.0.3"]
            }
          }
        };
        const result = validateVipAddresses(state);
        expect(result.errors.length).toBe(0);
      });
    });

    describe("Invalid IPv4 VIPs", () => {
      it("should reject IPv4 with octet > 255", () => {
        const state = {
          blueprint: { platform: "bare-metal" },
          methodology: { method: "agent" },
          hostInventory: { apiVip: "192.168.1.300" }
        };
        const result = validateVipAddresses(state);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toContain("192.168.1.300");
        expect(result.errors[0]).toContain("not a valid IPv4 address");
        expect(result.fieldErrors.apiVip).toBeDefined();
      });

      it("should reject IPv4 with too few octets", () => {
        const state = {
          blueprint: { platform: "nutanix" },
          methodology: { method: "ipi" },
          platformConfig: { nutanix: { apiVIP: "192.168.1" } }
        };
        const result = validateVipAddresses(state);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.fieldErrors.nutanixApiVIP).toBeDefined();
      });

      it("should reject IPv4 with non-numeric octets", () => {
        const state = {
          blueprint: { platform: "bare-metal" },
          methodology: { method: "agent" },
          hostInventory: { ingressVip: "192.168.abc.1" }
        };
        const result = validateVipAddresses(state);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.fieldErrors.ingressVip).toBeDefined();
      });

      it("should reject multiple IPv4 VIPs with one invalid for vSphere IPI", () => {
        const state = {
          blueprint: { platform: "vsphere" },
          methodology: { method: "ipi" },
          platformConfig: {
            vsphere: {
              apiVIPs: ["10.90.0.2", "999.999.999.999"]
            }
          }
        };
        const result = validateVipAddresses(state);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toContain("999.999.999.999");
      });
    });
  });

  describe("IPv6 VIP Validation", () => {
    describe("Valid IPv6 VIPs", () => {
      it("should accept valid full IPv6 address", () => {
        const state = {
          blueprint: { platform: "bare-metal" }, methodology: { method: "agent" },
          hostInventory: { apiVipV6: "2001:db8:85a3:0000:0000:8a2e:0370:7334" }
        };
        const result = validateVipAddresses(state);
        expect(result.errors.length).toBe(0);
      });

      it("should accept compressed IPv6 address", () => {
        const state = {
          blueprint: { platform: "bare-metal" }, methodology: { method: "agent" },
          hostInventory: {
            apiVipV6: "2001:db8::1",
            ingressVipV6: "fd00::2"
          }
        };
        const result = validateVipAddresses(state);
        expect(result.errors.length).toBe(0);
      });

      it("should accept IPv6 loopback", () => {
        const state = {
          blueprint: { platform: "bare-metal" }, methodology: { method: "agent" },
          hostInventory: { apiVipV6: "::1" }
        };
        const result = validateVipAddresses(state);
        expect(result.errors.length).toBe(0);
      });

      it("should accept multiple valid IPv6 VIPs for vSphere IPI", () => {
        const state = {
          blueprint: { platform: "vsphere" }, methodology: { method: "ipi" },
          platformConfig: {
            vsphere: {
              apiVIPsV6: ["fd00::10", "2001:db8::1"],
              ingressVIPsV6: ["fd00::11"]
            }
          }
        };
        const result = validateVipAddresses(state);
        expect(result.errors.length).toBe(0);
      });
    });

    describe("Invalid IPv6 VIPs", () => {
      it("should reject IPv6 with multiple :: abbreviations", () => {
        const state = {
          blueprint: { platform: "bare-metal" }, methodology: { method: "agent" },
          hostInventory: { apiVipV6: "2001::db8::1" }
        };
        const result = validateVipAddresses(state);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toContain("2001::db8::1");
        expect(result.fieldErrors.apiVipV6).toBeDefined();
      });

      it("should reject IPv6 with invalid characters", () => {
        const state = {
          blueprint: { platform: "nutanix" }, methodology: { method: "ipi" },
          platformConfig: { nutanix: { apiVIPV6: "gggg::1" } }
        };
        const result = validateVipAddresses(state);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.fieldErrors.nutanixApiVIPV6).toBeDefined();
      });

      it("should reject IPv6 without colons", () => {
        const state = {
          blueprint: { platform: "bare-metal" }, methodology: { method: "agent" },
          hostInventory: { ingressVipV6: "fd00" }
        };
        const result = validateVipAddresses(state);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.fieldErrors.ingressVipV6).toBeDefined();
      });
    });
  });

  describe("Dual-Stack Validation", () => {
    it("should validate both IPv4 and IPv6 VIPs for bare metal", () => {
      const state = {
        blueprint: { platform: "bare-metal" }, methodology: { method: "agent" },
        hostInventory: {
          apiVip: "10.90.0.2",
          apiVipV6: "fd00::2",
          ingressVip: "10.90.0.3",
          ingressVipV6: "fd00::3"
        }
      };
      const result = validateVipAddresses(state);
      expect(result.errors.length).toBe(0);
    });

    it("should detect invalid IPv4 in dual-stack configuration", () => {
      const state = {
        blueprint: { platform: "bare-metal" }, methodology: { method: "agent" },
        hostInventory: {
          apiVip: "999.999.999.999",
          apiVipV6: "fd00::2"
        }
      };
      const result = validateVipAddresses(state);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.fieldErrors.apiVip).toBeDefined();
      // IPv6 should still be valid
      expect(result.fieldErrors.apiVipV6).toBeUndefined();
    });

    it("should detect invalid IPv6 in dual-stack configuration", () => {
      const state = {
        blueprint: { platform: "nutanix" }, methodology: { method: "ipi" },
        platformConfig: {
          nutanix: {
            apiVIP: "10.90.0.2",
            apiVIPV6: "gggg::1"
          }
        }
      };
      const result = validateVipAddresses(state);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.fieldErrors.nutanixApiVIPV6).toBeDefined();
      // IPv4 should still be valid
      expect(result.fieldErrors.nutanixApiVIP).toBeUndefined();
    });
  });

  describe("Scenario-Specific Validation", () => {
    it("should validate vSphere IPI comma-separated arrays", () => {
      const state = {
        blueprint: { platform: "vsphere" }, methodology: { method: "ipi" },
        platformConfig: {
          vsphere: {
            apiVIPs: ["10.90.0.2"],
            ingressVIPs: ["10.90.0.3"],
            apiVIPsV6: ["fd00::2"],
            ingressVIPsV6: ["fd00::3"]
          }
        }
      };
      const result = validateVipAddresses(state);
      expect(result.errors.length).toBe(0);
    });

    it("should validate Nutanix IPI single VIPs", () => {
      const state = {
        blueprint: { platform: "nutanix" }, methodology: { method: "ipi" },
        platformConfig: {
          nutanix: {
            apiVIP: "10.90.0.2",
            ingressVIP: "10.90.0.3"
          }
        }
      };
      const result = validateVipAddresses(state);
      expect(result.errors.length).toBe(0);
    });

    it("should validate vSphere Agent single VIPs", () => {
      const state = {
        blueprint: { platform: "vsphere" }, methodology: { method: "agent" },
        hostInventory: {
          apiVip: "10.90.0.2",
          ingressVip: "10.90.0.3"
        }
      };
      const result = validateVipAddresses(state);
      expect(result.errors.length).toBe(0);
    });

    it("should validate bare metal IPI single VIPs", () => {
      const state = {
        blueprint: { platform: "bare-metal" }, methodology: { method: "ipi" },
        hostInventory: {
          apiVip: "10.90.0.2",
          ingressVip: "10.90.0.3"
        }
      };
      const result = validateVipAddresses(state);
      expect(result.errors.length).toBe(0);
    });
  });

  describe("Empty and Optional VIPs", () => {
    it("should allow empty VIPs (optional fields)", () => {
      const state = {
        blueprint: { platform: "bare-metal" }, methodology: { method: "agent" },
        hostInventory: {
          apiVip: "",
          ingressVip: ""
        }
      };
      const result = validateVipAddresses(state);
      expect(result.errors.length).toBe(0);
    });

    it("should allow undefined VIPs", () => {
      const state = {
        blueprint: { platform: "bare-metal" }, methodology: { method: "agent" },
        hostInventory: {}
      };
      const result = validateVipAddresses(state);
      expect(result.errors.length).toBe(0);
    });

    it("should allow partial dual-stack (IPv4 only)", () => {
      const state = {
        blueprint: { platform: "bare-metal" }, methodology: { method: "agent" },
        hostInventory: {
          apiVip: "10.90.0.2",
          apiVipV6: ""
        }
      };
      const result = validateVipAddresses(state);
      expect(result.errors.length).toBe(0);
    });

    it("should allow partial dual-stack (IPv6 only)", () => {
      const state = {
        blueprint: { platform: "bare-metal" }, methodology: { method: "agent" },
        hostInventory: {
          apiVip: "",
          apiVipV6: "fd00::2"
        }
      };
      const result = validateVipAddresses(state);
      expect(result.errors.length).toBe(0);
    });
  });

  describe("Field Error Mapping", () => {
    it("should set fieldErrors.apiVip for invalid IPv4", () => {
      const state = {
        blueprint: { platform: "bare-metal" }, methodology: { method: "agent" },
        hostInventory: { apiVip: "999.999.999.999" }
      };
      const result = validateVipAddresses(state);
      expect(result.fieldErrors.apiVip).toBe("Invalid IPv4 address");
    });

    it("should set fieldErrors.apiVipV6 for invalid IPv6", () => {
      const state = {
        blueprint: { platform: "bare-metal" }, methodology: { method: "agent" },
        hostInventory: { apiVipV6: "gggg::1" }
      };
      const result = validateVipAddresses(state);
      expect(result.fieldErrors.apiVipV6).toBe("Invalid IPv6 address");
    });

    it("should set fieldErrors.nutanixApiVIP for invalid Nutanix VIP", () => {
      const state = {
        blueprint: { platform: "nutanix" }, methodology: { method: "ipi" },
        platformConfig: { nutanix: { apiVIP: "192.168.1.300" } }
      };
      const result = validateVipAddresses(state);
      expect(result.fieldErrors.nutanixApiVIP).toBe("Invalid IPv4 address");
    });
  });

  describe("SNO (Single Node OpenShift) Validation Skipping", () => {
    describe("Agent-based SNO", () => {
      it("should skip validation for bare-metal-agent SNO (1 master, 0 workers)", () => {
        const state = {
          blueprint: { platform: "bare-metal" },
          methodology: { method: "agent" },
          hostInventory: {
            apiVip: "999.999.999.999", // Invalid IP
            nodes: [{ role: "master" }] // 1 master, 0 workers = SNO
          }
        };
        const result = validateVipAddresses(state);
        expect(result.errors.length).toBe(0);
        expect(result.fieldErrors.apiVip).toBeUndefined();
      });

      it("should skip validation for vsphere-agent SNO (1 master, 0 workers)", () => {
        const state = {
          blueprint: { platform: "vsphere" },
          methodology: { method: "agent" },
          hostInventory: {
            apiVip: "invalid-ip",
            ingressVip: "999.999.999.999",
            nodes: [{ role: "master" }]
          }
        };
        const result = validateVipAddresses(state);
        expect(result.errors.length).toBe(0);
      });

      it("should validate for bare-metal-agent multi-node (3 masters, 2 workers)", () => {
        const state = {
          blueprint: { platform: "bare-metal" },
          methodology: { method: "agent" },
          hostInventory: {
            apiVip: "999.999.999.999",
            nodes: [
              { role: "master" },
              { role: "master" },
              { role: "master" },
              { role: "worker" },
              { role: "worker" }
            ]
          }
        };
        const result = validateVipAddresses(state);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.fieldErrors.apiVip).toBeDefined();
      });

      it("should validate for vsphere-agent multi-node (3 masters, 0 workers)", () => {
        const state = {
          blueprint: { platform: "vsphere" },
          methodology: { method: "agent" },
          hostInventory: {
            apiVip: "999.999.999.999",
            nodes: [
              { role: "master" },
              { role: "master" },
              { role: "master" }
            ]
          }
        };
        const result = validateVipAddresses(state);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });

    describe("IPI SNO", () => {
      it("should skip validation for bare-metal-ipi SNO (1 control plane, 0 compute)", () => {
        const state = {
          blueprint: { platform: "bare-metal" },
          methodology: { method: "ipi" },
          controlPlane: { replicas: 1 },
          compute: { replicas: 0 },
          hostInventory: {
            apiVip: "999.999.999.999"
          }
        };
        const result = validateVipAddresses(state);
        expect(result.errors.length).toBe(0);
        expect(result.fieldErrors.apiVip).toBeUndefined();
      });

      it("should skip validation for vsphere-ipi SNO", () => {
        const state = {
          blueprint: { platform: "vsphere" },
          methodology: { method: "ipi" },
          controlPlane: { replicas: 1 },
          compute: { replicas: 0 },
          platformConfig: {
            vsphere: {
              apiVIPs: ["999.999.999.999"]
            }
          }
        };
        const result = validateVipAddresses(state);
        expect(result.errors.length).toBe(0);
      });

      it("should skip validation for nutanix-ipi SNO", () => {
        const state = {
          blueprint: { platform: "nutanix" },
          methodology: { method: "ipi" },
          controlPlane: { replicas: 1 },
          compute: { replicas: 0 },
          platformConfig: {
            nutanix: {
              apiVIP: "invalid-ip"
            }
          }
        };
        const result = validateVipAddresses(state);
        expect(result.errors.length).toBe(0);
      });

      it("should validate for bare-metal-ipi multi-node (3 control plane, 2 compute)", () => {
        const state = {
          blueprint: { platform: "bare-metal" },
          methodology: { method: "ipi" },
          controlPlane: { replicas: 3 },
          compute: { replicas: 2 },
          hostInventory: {
            apiVip: "999.999.999.999"
          }
        };
        const result = validateVipAddresses(state);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.fieldErrors.apiVip).toBeDefined();
      });

      it("should validate for vsphere-ipi compact cluster (3 control plane, 0 compute)", () => {
        const state = {
          blueprint: { platform: "vsphere" },
          methodology: { method: "ipi" },
          controlPlane: { replicas: 3 },
          compute: { replicas: 0 },
          platformConfig: {
            vsphere: {
              apiVIPs: ["999.999.999.999"]
            }
          }
        };
        const result = validateVipAddresses(state);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });

    describe("SNO with empty VIPs", () => {
      it("should allow empty VIPs for SNO (best practice)", () => {
        const state = {
          blueprint: { platform: "bare-metal" },
          methodology: { method: "agent" },
          hostInventory: {
            apiVip: "",
            ingressVip: "",
            nodes: [{ role: "master" }]
          }
        };
        const result = validateVipAddresses(state);
        expect(result.errors.length).toBe(0);
      });

      it("should allow undefined VIPs for SNO", () => {
        const state = {
          blueprint: { platform: "vsphere" },
          methodology: { method: "ipi" },
          controlPlane: { replicas: 1 },
          compute: { replicas: 0 },
          platformConfig: {
            vsphere: {}
          }
        };
        const result = validateVipAddresses(state);
        expect(result.errors.length).toBe(0);
      });
    });
  });
});
