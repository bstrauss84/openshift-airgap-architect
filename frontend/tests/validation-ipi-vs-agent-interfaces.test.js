/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * Critical regression tests for IPI vs Agent-based interface validation differences.
 *
 * Context: User-reported blocking bug (2026-05-19) where validation.js incorrectly required
 * primary.ethernet.macAddress for bare-metal IPI installs. Red Hat documentation confirms
 * that IPI uses bootMACAddress in platform.baremetal.hosts[], NOT agent-config interfaces.
 *
 * Fix: Wrap primary interface and additional interface validation in check for method === "Agent-Based Installer".
 *
 * These tests ensure:
 * 1. Bare-metal IPI nodes do NOT require primary.ethernet.macAddress
 * 2. Agent-based nodes DO require primary.ethernet.macAddress
 * 3. Bare-metal IPI DOES require bmc.bootMACAddress
 * 4. Other scenarios correctly apply validation rules
 */
import { describe, it, expect } from "vitest";
import { validateNode } from "../src/validation.js";

describe("Critical: IPI vs Agent-based interface validation (Bug Fix 2026-05-19)", () => {
  describe("Bare-metal IPI - should NOT require primary interface ethernet.macAddress", () => {
    it("bare-metal IPI node with BMC and bootMACAddress should be valid WITHOUT ethernet.macAddress", () => {
      const node = {
        hostname: "control-0",
        role: "master",
        rootDevice: "/dev/disk/by-path/pci-0000:00:1f.2-ata-1.0",
        bmc: {
          address: "redfish+http://192.168.1.10/redfish/v1/Systems/1",
          username: "admin",
          password: "password",
          bootMACAddress: "52:54:00:aa:bb:cc"
        }
        // NOTE: NO primary interface config - IPI doesn't use it
      };

      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "IPI",
        includeCredentials: true
      });

      // Should NOT error about missing primary.ethernet.macAddress
      expect(result.errors).not.toContain("Ethernet MAC address is required.");
      expect(result.errors).not.toContain("Primary interface type is required.");
      expect(result.fieldErrors["primary.ethernet.macAddress"]).toBeUndefined();
      expect(result.fieldErrors["primary.type"]).toBeUndefined();

      // Should ONLY require BMC fields (which are present)
      expect(result.errors).toHaveLength(0);
    });

    it("bare-metal IPI should error if bootMACAddress is missing", () => {
      const node = {
        hostname: "control-0",
        role: "master",
        bmc: {
          address: "redfish+http://192.168.1.10/redfish/v1/Systems/1",
          username: "admin",
          password: "password"
          // Missing bootMACAddress
        }
      };

      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "IPI",
        includeCredentials: true
      });

      expect(result.errors).toContain("Boot MAC address is required for bare metal IPI.");
      expect(result.fieldErrors["bmc.bootMACAddress"]).toBe("Boot MAC address is required for bare metal IPI.");
    });

    it("bare-metal IPI should require BMC address, username, password when includeCredentials is true", () => {
      const node = {
        hostname: "control-0",
        role: "master",
        bmc: {
          // All BMC fields missing
        }
      };

      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "IPI",
        includeCredentials: true
      });

      expect(result.errors).toContain("BMC address is required for bare metal IPI.");
      expect(result.errors).toContain("BMC username is required for bare metal IPI.");
      expect(result.errors).toContain("BMC password is required for bare metal IPI.");
      expect(result.errors).toContain("Boot MAC address is required for bare metal IPI.");
    });
  });

  describe("Agent-based installs - should require primary interface ethernet.macAddress", () => {
    it("bare-metal agent node without ethernet.macAddress should error", () => {
      const node = {
        hostname: "control-0",
        role: "master",
        rootDevice: "/dev/disk/by-path/pci-0000:00:1f.2-ata-1.0",
        primary: {
          type: "ethernet",
          mode: "dhcp",
          ethernet: {
            name: "eno1"
            // Missing macAddress
          }
        }
      };

      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });

      expect(result.errors).toContain("Ethernet MAC address is required.");
      expect(result.fieldErrors["primary.ethernet.macAddress"]).toBe("Ethernet MAC address is required.");
    });

    it("bare-metal agent node WITH ethernet.macAddress should be valid", () => {
      const node = {
        hostname: "control-0",
        role: "master",
        rootDevice: "/dev/disk/by-path/pci-0000:00:1f.2-ata-1.0",
        primary: {
          type: "ethernet",
          mode: "dhcp",
          ethernet: {
            name: "eno1",
            macAddress: "52:54:00:aa:bb:cc"
          }
        }
      };

      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });

      expect(result.errors).not.toContain("Ethernet MAC address is required.");
      expect(result.fieldErrors["primary.ethernet.macAddress"]).toBeUndefined();
    });

    it("bare-metal agent should NOT require BMC fields", () => {
      const node = {
        hostname: "control-0",
        role: "master",
        rootDevice: "/dev/disk/by-path/pci-0000:00:1f.2-ata-1.0",
        primary: {
          type: "ethernet",
          mode: "dhcp",
          ethernet: {
            name: "eno1",
            macAddress: "52:54:00:aa:bb:cc"
          }
        }
        // NO BMC config for Agent-based
      };

      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });

      expect(result.errors).not.toContain("BMC address is required for bare metal IPI.");
      expect(result.errors).not.toContain("Boot MAC address is required for bare metal IPI.");
    });
  });

  describe("Additional interface validation - only for Agent-based", () => {
    it("bare-metal IPI should NOT validate additional interfaces", () => {
      const node = {
        hostname: "control-0",
        role: "master",
        bmc: {
          address: "redfish+http://192.168.1.10/redfish/v1/Systems/1",
          username: "admin",
          password: "password",
          bootMACAddress: "52:54:00:aa:bb:cc"
        },
        additionalInterfaces: [
          {
            type: "ethernet",
            mode: "static",
            ethernet: {
              name: "eno2"
              // Missing macAddress - should NOT error for IPI
            },
            ipv4Cidr: "10.1.0.10/24"
          }
        ]
      };

      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "IPI",
        includeCredentials: true
      });

      // Should NOT error about additional interface macAddress for IPI
      expect(result.errors).not.toContain("Additional ethernet MAC address is required.");
      expect(result.fieldErrors["additional.0.ethernet.macAddress"]).toBeUndefined();
    });

    it("bare-metal agent SHOULD validate additional interfaces and require macAddress", () => {
      const node = {
        hostname: "control-0",
        role: "master",
        rootDevice: "/dev/disk/by-path/pci-0000:00:1f.2-ata-1.0",
        primary: {
          type: "ethernet",
          mode: "dhcp",
          ethernet: {
            name: "eno1",
            macAddress: "52:54:00:aa:bb:cc"
          }
        },
        additionalInterfaces: [
          {
            type: "ethernet",
            mode: "static",
            ethernet: {
              name: "eno2"
              // Missing macAddress - SHOULD error for Agent
            },
            ipv4Cidr: "10.1.0.10/24"
          }
        ]
      };

      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });

      expect(result.errors).toContain("Additional ethernet MAC address is required.");
      expect(result.fieldErrors["additional.0.ethernet.macAddress"]).toBe("Additional ethernet MAC address is required.");
    });
  });

  describe("Other platforms - vSphere IPI, AWS IPI, etc.", () => {
    it("vSphere IPI should NOT require primary interface config", () => {
      const node = {
        hostname: "control-0",
        role: "master"
        // NO primary interface config - vSphere IPI doesn't use it
      };

      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "vSphere",
        method: "IPI",
        includeCredentials: false
      });

      expect(result.errors).not.toContain("Ethernet MAC address is required.");
      expect(result.errors).not.toContain("Primary interface type is required.");
      expect(result.fieldErrors["primary.ethernet.macAddress"]).toBeUndefined();
    });

    it("vSphere agent SHOULD require primary interface config", () => {
      const node = {
        hostname: "control-0",
        role: "master",
        rootDevice: "/dev/disk/by-path/pci-0000:00:1f.2-ata-1.0",
        primary: {
          type: "ethernet",
          mode: "dhcp",
          ethernet: {
            name: "ens192"
            // Missing macAddress
          }
        }
      };

      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "vSphere",
        method: "Agent-Based Installer",
        includeCredentials: false
      });

      expect(result.errors).toContain("Ethernet MAC address is required.");
      expect(result.fieldErrors["primary.ethernet.macAddress"]).toBe("Ethernet MAC address is required.");
    });
  });

  describe("Edge cases and regressions", () => {
    it("arbiter nodes in agent-based should NOT validate additional interfaces", () => {
      const node = {
        hostname: "arbiter-0",
        role: "arbiter",
        rootDevice: "/dev/sda",
        primary: {
          type: "ethernet",
          mode: "dhcp",
          ethernet: {
            name: "eno1",
            macAddress: "52:54:00:aa:bb:cc"
          }
        },
        additionalInterfaces: [
          {
            type: "ethernet",
            mode: "static",
            ethernet: {
              name: "eno2"
              // Missing macAddress - but arbiter shouldn't validate additional interfaces
            }
          }
        ]
      };

      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });

      // Arbiter nodes get empty additionalInterfaces array, so no validation errors for additional interfaces
      expect(result.errors).not.toContain("Additional ethernet MAC address is required.");
    });

    it("bond interface in agent-based should require MAC addresses for all slaves", () => {
      const node = {
        hostname: "control-0",
        role: "master",
        rootDevice: "/dev/disk/by-path/pci-0000:00:1f.2-ata-1.0",
        primary: {
          type: "bond",
          mode: "dhcp",
          bond: {
            name: "bond0",
            mode: "active-backup",
            slaves: [
              {
                name: "eno1",
                macAddress: "52:54:00:aa:bb:01"
              },
              {
                name: "eno2"
                // Missing macAddress
              }
            ]
          }
        }
      };

      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });

      expect(result.errors).toContain("Bond member MAC address is required.");
      expect(result.fieldErrors["primary.bond.slaves.1.macAddress"]).toBe("Bond member MAC address is required.");
    });

    it("bond interface in IPI should NOT be validated", () => {
      const node = {
        hostname: "control-0",
        role: "master",
        bmc: {
          address: "redfish+http://192.168.1.10/redfish/v1/Systems/1",
          username: "admin",
          password: "password",
          bootMACAddress: "52:54:00:aa:bb:cc"
        },
        primary: {
          type: "bond",
          mode: "dhcp",
          bond: {
            name: "bond0",
            mode: "active-backup",
            slaves: [
              {
                name: "eno1"
                // Missing macAddress - should NOT error for IPI
              },
              {
                name: "eno2"
                // Missing macAddress - should NOT error for IPI
              }
            ]
          }
        }
      };

      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "IPI",
        includeCredentials: true
      });

      expect(result.errors).not.toContain("Bond member MAC address is required.");
      expect(result.fieldErrors["primary.bond.slaves.0.macAddress"]).toBeUndefined();
    });
  });
});
