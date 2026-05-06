/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * Validation integration tests - verify validation logic prevents invalid data from reaching generation
 * Tests the full flow: validation checks → error states → generation should not proceed
 */
import { describe, it, expect } from "vitest";
import {
  validateStep,
  validateHostInventory,
  validateNode,
  cidrOverlaps,
  ipv6CidrOverlaps,
  isValidIpv4Cidr,
  isValidIpv4AddressWithPrefix,
  isValidIpv6
} from "../src/validation.js";

describe("Validation Integration - End-to-End Validation Flow", () => {
  describe("Network CIDR overlap detection prevents invalid configurations", () => {
    it("should detect machine network overlapping with service network", () => {
      const state = {
        blueprint: { platform: "Bare Metal" },
        methodology: { method: "Agent-Based Installer" },
        globalStrategy: {
          networking: {
            machineNetworkV4: "10.0.0.0/16",
            serviceNetworkCidr: "10.0.0.0/16", // OVERLAP - invalid!
            clusterNetworkCidr: "10.128.0.0/14"
          }
        }
      };

      const result = validateStep(state, "networking");
      expect(result.errors.some(e => e.includes("overlap"))).toBe(true);
    });

    it("should detect machine network overlapping with cluster network", () => {
      const state = {
        blueprint: { platform: "Bare Metal" },
        methodology: { method: "Agent-Based Installer" },
        globalStrategy: {
          networking: {
            machineNetworkV4: "10.0.0.0/16",
            serviceNetworkCidr: "172.30.0.0/16",
            clusterNetworkCidr: "10.0.0.0/14" // Contains machine network - invalid!
          }
        }
      };

      const result = validateStep(state, "networking");
      expect(result.errors.some(e => e.includes("overlap"))).toBe(true);
    });

    it("should allow valid non-overlapping networks", () => {
      const state = {
        blueprint: { platform: "Bare Metal" },
        methodology: { method: "Agent-Based Installer" },
        globalStrategy: {
          networking: {
            machineNetworkV4: "10.0.0.0/16",
            serviceNetworkCidr: "172.30.0.0/16",
            clusterNetworkCidr: "10.128.0.0/14"
          }
        }
      };

      const result = validateStep(state, "networking");
      expect(result.errors.filter(e => e.includes("overlap"))).toHaveLength(0);
    });

    it("should detect IPv6 network overlaps in dual-stack configuration", () => {
      const state = {
        blueprint: { platform: "Bare Metal" },
        methodology: { method: "Agent-Based Installer" },
        globalStrategy: {
          networking: {
            machineNetworkV4: "10.0.0.0/16",
            machineNetworkV6: "fd00::/48",
            serviceNetworkCidr: "172.30.0.0/16",
            serviceNetworkCidrV6: "fd00::/112", // Within fd00::/48 - overlap!
            clusterNetworkCidr: "10.128.0.0/14",
            clusterNetworkCidrV6: "fd01::/48"
          }
        }
      };

      const result = validateStep(state, "networking");
      expect(result.errors.some(e => e.includes("overlap"))).toBe(true);
    });
  });

  describe("Network CIDR format validation prevents malformed inputs", () => {
    it("should reject non-network addresses for machine network", () => {
      // Machine network must be a network address, not a host address
      expect(isValidIpv4Cidr("10.0.0.5/24")).toBe(false);
      expect(isValidIpv4Cidr("10.0.0.0/24")).toBe(true);
    });

    it("should reject invalid IPv6 formats for network definitions", () => {
      const state = {
        blueprint: { platform: "Bare Metal" },
        methodology: { method: "Agent-Based Installer" },
        credentials: {
          usingMirrorRegistry: true,
          mirrorRegistryUnauthenticated: true // Skip pull secret validation
        },
        globalStrategy: {
          networking: {
            machineNetworkV4: "10.0.0.0/16",
            machineNetworkV6: "fd00::/48",
            serviceNetworkCidr: "172.30.0.0/16",
            serviceNetworkCidrV6: "gggg::/112", // Invalid hex - should be rejected
            clusterNetworkCidr: "10.128.0.0/14",
            clusterNetworkCidrV6: "fd01::/48"
          }
        }
      };

      const result = validateStep(state, "networking");
      expect(result.errors.some(e => e.includes("Service network IPv6 CIDR"))).toBe(true);
    });

    it("should reject malformed IPv6 compressed notation", () => {
      expect(isValidIpv6(":::1")).toBe(false); // Triple colon
      expect(isValidIpv6("2001::db8::1")).toBe(false); // Multiple ::
      expect(isValidIpv6("2001:db8::1")).toBe(true); // Valid
    });
  });

  describe("Host static IP validation distinguishes between network CIDRs and host addresses", () => {
    it("should accept host IP addresses with prefix length for static configuration", () => {
      // Host static IPs can be any valid IP with prefix, not just network addresses
      expect(isValidIpv4AddressWithPrefix("10.0.0.10/24")).toBe(true);
      expect(isValidIpv4AddressWithPrefix("192.168.1.100/24")).toBe(true);
      expect(isValidIpv4AddressWithPrefix("10.0.0.0/24")).toBe(true); // Network address also valid
    });

    it("should reject invalid host IP formats", () => {
      expect(isValidIpv4AddressWithPrefix("10.0.0.5")).toBe(false); // Missing prefix
      expect(isValidIpv4AddressWithPrefix("256.0.0.1/24")).toBe(false); // Invalid IP
      expect(isValidIpv4AddressWithPrefix("10.0.0.1/33")).toBe(false); // Invalid prefix
    });

    it("should validate static IP configuration in host inventory", () => {
      const node = {
        hostname: "node-01",
        rootDevice: "/dev/sda",
        primary: {
          type: "ethernet",
          mode: "static",
          ethernet: {
            name: "eno1",
            macAddress: "00:11:22:33:44:55"
          },
          ipv4Cidr: "192.168.1.10/24", // Host address - should be valid
          ipv4Gateway: "192.168.1.1"
        }
      };

      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "192.168.1.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });

      expect(result.errors).toHaveLength(0);
    });
  });

  describe("Bond validation prevents invalid network configurations", () => {
    it("should reject bond with fewer than 2 slaves", () => {
      const node = {
        hostname: "node-01",
        rootDevice: "/dev/sda",
        primary: {
          type: "bond",
          mode: "dhcp",
          bond: {
            name: "bond0",
            mode: "active-backup",
            slaves: [{ name: "eth0", macAddress: "00:11:22:33:44:55" }] // Only 1 slave!
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

      expect(result.errors.some(e => e.includes("at least 2 member"))).toBe(true);
    });

    it("should accept bond with 2 or more slaves", () => {
      const node = {
        hostname: "node-01",
        rootDevice: "/dev/sda",
        primary: {
          type: "bond",
          mode: "dhcp",
          bond: {
            name: "bond0",
            mode: "active-backup",
            slaves: [
              { name: "eth0", macAddress: "00:11:22:33:44:55" },
              { name: "eth1", macAddress: "00:11:22:33:44:56" }
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

      expect(result.errors).toHaveLength(0);
    });
  });

  describe("VLAN base interface derivation prevents missing configuration", () => {
    it("should derive VLAN base from ethernet name when not explicit", () => {
      const node = {
        hostname: "node-01",
        rootDevice: "/dev/sda",
        primary: {
          type: "vlan-on-ethernet",
          mode: "dhcp",
          ethernet: {
            name: "eno1",
            macAddress: "00:11:22:33:44:55"
          },
          vlan: {
            id: 100
            // baseIface not specified - should derive from ethernet.name
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

      expect(result.errors).toHaveLength(0);
    });

    it("should derive VLAN base from bond name when not explicit", () => {
      const node = {
        hostname: "node-01",
        rootDevice: "/dev/sda",
        primary: {
          type: "vlan-on-bond",
          mode: "dhcp",
          bond: {
            name: "bond0",
            mode: "active-backup",
            slaves: [
              { name: "eth0", macAddress: "00:11:22:33:44:55" },
              { name: "eth1", macAddress: "00:11:22:33:44:56" }
            ]
          },
          vlan: {
            id: 100
            // baseIface not specified - should derive from bond.name
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

      expect(result.errors).toHaveLength(0);
    });

    it("should require VLAN base when neither ethernet nor bond name available", () => {
      const node = {
        hostname: "node-01",
        rootDevice: "/dev/sda",
        primary: {
          type: "vlan-on-ethernet",
          mode: "dhcp",
          ethernet: {
            macAddress: "00:11:22:33:44:55"
            // name not specified
          },
          vlan: {
            id: 100
            // baseIface not specified and no ethernet.name to derive from
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

      expect(result.errors.some(e => e.includes("VLAN base interface"))).toBe(true);
    });
  });

  describe("IPv6 gateway requires IPv6 CIDR in static mode", () => {
    it("should reject IPv6 gateway without IPv6 CIDR", () => {
      const node = {
        hostname: "node-01",
        rootDevice: "/dev/sda",
        primary: {
          type: "ethernet",
          mode: "static",
          ethernet: {
            name: "eno1",
            macAddress: "00:11:22:33:44:55"
          },
          ipv4Cidr: "10.0.0.10/24",
          ipv4Gateway: "10.0.0.1",
          ipv6Gateway: "2001:db8::1" // Gateway without CIDR!
        }
      };

      const result = validateNode({
        node,
        enableIpv6: true,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });

      expect(result.errors.some(e => e.includes("IPv6 CIDR is required when IPv6 gateway"))).toBe(true);
    });

    it("should accept IPv6 gateway with IPv6 CIDR", () => {
      const node = {
        hostname: "node-01",
        rootDevice: "/dev/sda",
        primary: {
          type: "ethernet",
          mode: "static",
          ethernet: {
            name: "eno1",
            macAddress: "00:11:22:33:44:55"
          },
          ipv4Cidr: "10.0.0.10/24",
          ipv4Gateway: "10.0.0.1",
          ipv6Cidr: "2001:db8::10/64",
          ipv6Gateway: "2001:db8::1"
        }
      };

      const result = validateNode({
        node,
        enableIpv6: true,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });

      expect(result.errors).toHaveLength(0);
    });
  });

  describe("Arbiter node validation skips additional interfaces", () => {
    it("should not validate additional interfaces for arbiter nodes", () => {
      const node = {
        hostname: "arbiter-01",
        role: "arbiter",
        primary: {
          type: "ethernet",
          mode: "dhcp",
          ethernet: {
            name: "eno1",
            macAddress: "00:11:22:33:44:55"
          }
        },
        additionalInterfaces: [
          {
            type: "ethernet",
            mode: "dhcp",
            ethernet: {
              // Intentionally invalid - missing name and MAC
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

      // Should not see errors about additional interfaces
      expect(result.errors.filter(e => e.includes("Additional"))).toHaveLength(0);
    });

    it("should validate additional interfaces for non-arbiter nodes", () => {
      const node = {
        hostname: "master-01",
        role: "master",
        primary: {
          type: "ethernet",
          mode: "dhcp",
          ethernet: {
            name: "eno1",
            macAddress: "00:11:22:33:44:55"
          }
        },
        additionalInterfaces: [
          {
            type: "ethernet",
            mode: "dhcp",
            ethernet: {
              // Intentionally invalid - missing name and MAC
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

      // Should see errors about additional interfaces
      expect(result.errors.filter(e => e.includes("Additional"))).toHaveLength(2);
    });
  });

  describe("Full host inventory validation aggregates multi-node errors", () => {
    it("should aggregate errors from multiple nodes", () => {
      const state = {
        blueprint: { platform: "Bare Metal" },
        methodology: { method: "Agent-Based Installer" },
        globalStrategy: {
          networking: {
            machineNetworkV4: "10.0.0.0/24"
          }
        },
        hostInventory: {
          enableIpv6: false,
          nodes: [
            {
              // Node 1: missing hostname
              primary: {
                type: "ethernet",
                mode: "dhcp",
                ethernet: { name: "eno1", macAddress: "00:11:22:33:44:55" }
              }
            },
            {
              // Node 2: invalid bond (only 1 slave)
              hostname: "node-02",
              primary: {
                type: "bond",
                mode: "dhcp",
                bond: {
                  name: "bond0",
                  mode: "active-backup",
                  slaves: [{ name: "eth0", macAddress: "00:11:22:33:44:56" }]
                }
              }
            },
            {
              // Node 3: static IP missing gateway
              hostname: "node-03",
              primary: {
                type: "ethernet",
                mode: "static",
                ethernet: { name: "eno1", macAddress: "00:11:22:33:44:57" },
                ipv4Cidr: "10.0.0.10/24"
                // Missing ipv4Gateway!
              }
            }
          ]
        },
        exportOptions: {
          includeCredentials: false
        }
      };

      const result = validateHostInventory(state);

      expect(result.errors).toContain("Node 1: Hostname is required.");
      expect(result.errors.some(e => e.includes("Node 2") && e.includes("at least 2 member"))).toBe(true);
      expect(result.errors.some(e => e.includes("Node 3") && e.includes("IPv4 default gateway"))).toBe(true);
      expect(result.perNode).toHaveLength(3);
    });
  });

  describe("CIDR overlap function correctness", () => {
    it("should detect overlaps using cidrOverlaps function", () => {
      // Exact overlap
      expect(cidrOverlaps("10.0.0.0/24", "10.0.0.0/24")).toBe(true);

      // Containment
      expect(cidrOverlaps("10.0.0.0/16", "10.0.1.0/24")).toBe(true);
      expect(cidrOverlaps("10.0.1.0/24", "10.0.0.0/16")).toBe(true);

      // No overlap
      expect(cidrOverlaps("10.0.0.0/24", "10.0.1.0/24")).toBe(false);
      expect(cidrOverlaps("192.168.0.0/16", "172.16.0.0/16")).toBe(false);
    });

    it("should detect IPv6 overlaps using ipv6CidrOverlaps function", () => {
      // Exact overlap
      expect(ipv6CidrOverlaps("2001:db8::/64", "2001:db8::/64")).toBe(true);

      // Containment
      expect(ipv6CidrOverlaps("2001:db8::/48", "2001:db8:0:1::/64")).toBe(true);
      expect(ipv6CidrOverlaps("2001:db8:0:1::/64", "2001:db8::/48")).toBe(true);

      // No overlap
      expect(ipv6CidrOverlaps("2001:db8:0:0::/64", "2001:db8:0:1::/64")).toBe(false);
      expect(ipv6CidrOverlaps("fd00::/48", "fd01::/48")).toBe(false);
    });
  });
});
