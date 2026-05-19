/**
 * IPI networkConfig validation tests
 *
 * Tests for platform.baremetal.hosts[].networkConfig parameter validation
 * in Installer-Provisioned Infrastructure (IPI) scenarios.
 */

import { describe, it, expect } from "vitest";
import { validateNode } from "../src/validation.js";

/**
 * Helper function to create a minimal valid IPI node
 */
function createIpiNode(nodeOverrides = {}) {
  return {
    role: "master",
    hostname: "master-0",
    bmc: {
      address: "redfish+http://192.168.1.1",
      bootMACAddress: "52:54:00:aa:bb:cc"
    },
    ...nodeOverrides
  };
}

describe("IPI networkConfig validation", () => {
  it("accepts valid static IP config", () => {
    const node = createIpiNode({
      networkConfig: {
        primaryInterface: {
          name: "enp1s0",
          ip: "192.168.1.10/24",
          gateway: "192.168.1.1",
          dns: "8.8.8.8"
        }
      }
    });

    const validation = validateNode({
      node,
      enableIpv6: false,
      machineCidr: "10.0.0.0/24",
      platform: "bare-metal-ipi",
      method: "Installer-Provisioned",
      includeCredentials: false
    });

    expect(validation.errors || []).toHaveLength(0);
    expect(validation.fieldErrors?.["networkConfig.primaryInterface.ip"]).toBeUndefined();
    expect(validation.fieldErrors?.["networkConfig.primaryInterface.name"]).toBeUndefined();
    expect(validation.fieldErrors?.["networkConfig.primaryInterface.gateway"]).toBeUndefined();
  });

  it("rejects invalid IP format (missing CIDR)", () => {
    const node = createIpiNode({
      networkConfig: {
        primaryInterface: {
          name: "enp1s0",
          ip: "192.168.1.10", // Missing /24
          gateway: "192.168.1.1"
        }
      }
    });

    const validation = validateNode({
      node,
      enableIpv6: false,
      machineCidr: "10.0.0.0/24",
      platform: "bare-metal-ipi",
      method: "Installer-Provisioned",
      includeCredentials: false
    });

    expect(validation.fieldErrors["networkConfig.primaryInterface.ip"]).toBeDefined();
    expect(validation.fieldErrors["networkConfig.primaryInterface.ip"]).toContain("CIDR format");
  });

  it("requires interface name when IP provided", () => {
    const node = createIpiNode({
      networkConfig: {
        primaryInterface: {
          ip: "192.168.1.10/24",
          gateway: "192.168.1.1"
          // name is missing
        }
      }
    });

    const validation = validateNode({
      node,
      enableIpv6: false,
      machineCidr: "10.0.0.0/24",
      platform: "bare-metal-ipi",
      method: "Installer-Provisioned",
      includeCredentials: false
    });

    expect(validation.fieldErrors["networkConfig.primaryInterface.name"]).toBeDefined();
    expect(validation.fieldErrors["networkConfig.primaryInterface.name"]).toContain("Interface name required");
  });

  it("rejects invalid gateway format", () => {
    const node = createIpiNode({
      networkConfig: {
        primaryInterface: {
          name: "enp1s0",
          ip: "192.168.1.10/24",
          gateway: "192.168.1" // Invalid IP (missing last octet)
        }
      }
    });

    const validation = validateNode({
      node,
      enableIpv6: false,
      machineCidr: "10.0.0.0/24",
      platform: "bare-metal-ipi",
      method: "Installer-Provisioned",
      includeCredentials: false
    });

    expect(validation.fieldErrors["networkConfig.primaryInterface.gateway"]).toBeDefined();
    expect(validation.fieldErrors["networkConfig.primaryInterface.gateway"]).toContain("valid IPv4 address");
  });

  it("accepts config with no gateway (optional)", () => {
    const node = createIpiNode({
      networkConfig: {
        primaryInterface: {
          name: "enp1s0",
          ip: "192.168.1.10/24"
          // gateway is optional
        }
      }
    });

    const validation = validateNode({
      node,
      enableIpv6: false,
      machineCidr: "10.0.0.0/24",
      platform: "bare-metal-ipi",
      method: "Installer-Provisioned",
      includeCredentials: false
    });

    expect(validation.errors || []).toHaveLength(0);
    expect(validation.fieldErrors?.["networkConfig.primaryInterface.gateway"]).toBeUndefined();
  });

  it("accepts config with no DNS (optional)", () => {
    const node = createIpiNode({
      networkConfig: {
        primaryInterface: {
          name: "enp1s0",
          ip: "192.168.1.10/24",
          gateway: "192.168.1.1"
          // dns is optional
        }
      }
    });

    const validation = validateNode({
      node,
      enableIpv6: false,
      machineCidr: "10.0.0.0/24",
      platform: "bare-metal-ipi",
      method: "Installer-Provisioned",
      includeCredentials: false
    });

    expect(validation.errors || []).toHaveLength(0);
  });

  it("no validation errors when networkConfig absent", () => {
    const node = createIpiNode({
      // networkConfig not provided - should use DHCP
    });

    const validation = validateNode({
      node,
      enableIpv6: false,
      machineCidr: "10.0.0.0/24",
      platform: "bare-metal-ipi",
      method: "Installer-Provisioned",
      includeCredentials: false
    });

    expect(validation.fieldErrors?.["networkConfig.primaryInterface.ip"]).toBeUndefined();
    expect(validation.fieldErrors?.["networkConfig.primaryInterface.name"]).toBeUndefined();
  });

  it("only validates for Installer-Provisioned method", () => {
    const node = createIpiNode({
      networkConfig: {
        primaryInterface: {
          ip: "192.168.1.10" // Invalid format (missing CIDR)
          // name is also missing
        }
      }
    });

    const validation = validateNode({
      node,
      enableIpv6: false,
      machineCidr: "10.0.0.0/24",
      platform: "bare-metal-ipi",
      method: "Agent-Based Installer", // Changed to Agent-Based
      includeCredentials: false
    });

    // Should NOT validate IPI networkConfig for Agent-based
    expect(validation.fieldErrors?.["networkConfig.primaryInterface.ip"]).toBeUndefined();
    expect(validation.fieldErrors?.["networkConfig.primaryInterface.name"]).toBeUndefined();
  });

  it("accepts various valid CIDR prefixes", () => {
    const testCases = [
      "192.168.1.10/24",
      "10.0.0.5/8",
      "172.16.0.1/16",
      "192.168.1.1/32",
      "10.90.0.100/22"
    ];

    for (const cidr of testCases) {
      const node = createIpiNode({
        networkConfig: {
          primaryInterface: {
            name: "enp1s0",
            ip: cidr
          }
        }
      });

      const validation = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "bare-metal-ipi",
        method: "Installer-Provisioned",
        includeCredentials: false
      });

      expect(validation.fieldErrors?.["networkConfig.primaryInterface.ip"]).toBeUndefined();
    }
  });

  it("rejects invalid CIDR formats", () => {
    const testCases = [
      "192.168.1.10",        // Missing prefix
      "192.168.1.10/",       // Empty prefix
      "192.168.1/24",        // Incomplete IP
      "192.168.1.10/abc",    // Non-numeric prefix
      "not-an-ip/24",        // Invalid IP
      "192.168.1.10/24/16"   // Multiple slashes
    ];

    for (const invalidCidr of testCases) {
      const node = createIpiNode({
        networkConfig: {
          primaryInterface: {
            name: "enp1s0",
            ip: invalidCidr
          }
        }
      });

      const validation = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "bare-metal-ipi",
        method: "Installer-Provisioned",
        includeCredentials: false
      });

      expect(validation.fieldErrors?.["networkConfig.primaryInterface.ip"]).toBeDefined();
    }
  });
});
