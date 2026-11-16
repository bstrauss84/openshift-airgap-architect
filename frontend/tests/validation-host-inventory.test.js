/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * Host Inventory validation tests - comprehensive test suite for validateNode() and validateHostInventory()
 * Critical for preventing invalid host network configurations in OpenShift installations
 */
import { describe, it, expect } from "vitest";
import { validateNode, validateHostInventory } from "../src/validation.js";

// Helper to create a minimal valid node
const createValidNode = () => ({
  hostname: "node-01",
  role: "master",
  rootDevice: "/dev/disk/by-path/pci-0000:00:1f.2-ata-1.0",
  primary: {
    type: "ethernet",
    mode: "dhcp",
    ethernet: {
      name: "eno1",
      macAddress: "00:11:22:33:44:55"
    }
  }
});

// Helper to create a minimal valid state
const createValidState = () => ({
  blueprint: { platform: "Bare Metal" },
  methodology: { method: "Agent-Based Installer" },
  globalStrategy: {
    networking: {
      machineNetworkV4: "10.0.0.0/24"
    }
  },
  hostInventory: {
    enableIpv6: false,
    nodes: []
  },
  exportOptions: {
    includeCredentials: false
  }
});

describe("validateNode - Host inventory node validation", () => {
  describe("Basic field validation", () => {
    it("should require hostname", () => {
      const node = createValidNode();
      delete node.hostname;
      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });
      expect(result.errors).toContain("Hostname is required.");
      expect(result.fieldErrors.hostname).toBe("Hostname is required.");
    });

    it("should warn about missing root device hint for non-arbiter nodes", () => {
      const node = createValidNode();
      delete node.rootDevice;
      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });
      expect(result.warnings).toContain("Root device hint is missing (by-path recommended when available).");
      expect(result.fieldErrors.rootDevice).toBe("Root device hint is missing (by-path recommended when available).");
    });

    it("should NOT warn about missing root device for arbiter nodes in bare-metal-agent", () => {
      const node = createValidNode();
      node.role = "arbiter";
      delete node.rootDevice;
      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });
      expect(result.warnings).not.toContain("Root device hint is missing (by-path recommended when available).");
      expect(result.fieldErrors.rootDevice).toBeUndefined();
    });

    it("should require primary interface type", () => {
      const node = createValidNode();
      delete node.primary.type;
      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });
      expect(result.errors).toContain("Primary interface type is required.");
    });

    it("should require primary interface mode", () => {
      const node = createValidNode();
      delete node.primary.mode;
      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });
      expect(result.errors).toContain("Primary interface IP assignment is required.");
    });
  });

  describe("Bare Metal IPI BMC validation", () => {
    it("should require BMC address for bare metal IPI", () => {
      const node = createValidNode();
      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "IPI",
        includeCredentials: false
      });
      expect(result.errors).toContain("BMC address is required for bare metal IPI.");
    });

    it("should warn about missing BMC credentials when includeCredentials is false", () => {
      const node = createValidNode();
      node.bmc = { address: "192.168.1.100", bootMACAddress: "00:11:22:33:44:66" };
      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "IPI",
        includeCredentials: false
      });
      expect(result.warnings).toContain("BMC username is required for bare metal IPI.");
      expect(result.warnings).toContain("BMC password is required for bare metal IPI.");
    });

    it("should error about missing BMC credentials when includeCredentials is true", () => {
      const node = createValidNode();
      node.bmc = { address: "192.168.1.100", bootMACAddress: "00:11:22:33:44:66" };
      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "IPI",
        includeCredentials: true
      });
      expect(result.errors).toContain("BMC username is required for bare metal IPI.");
      expect(result.errors).toContain("BMC password is required for bare metal IPI.");
    });

    it("should require boot MAC address for bare metal IPI", () => {
      const node = createValidNode();
      node.bmc = { address: "192.168.1.100", username: "admin", password: "password" };
      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "IPI",
        includeCredentials: false
      });
      expect(result.errors).toContain("Boot MAC address is required for bare metal IPI.");
    });

    it("should pass validation with complete BMC configuration", () => {
      const node = createValidNode();
      node.bmc = {
        address: "redfish+https://192.168.1.100/redfish/v1",
        username: "admin",
        password: "password",
        bootMACAddress: "00:11:22:33:44:66"
      };
      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "IPI",
        includeCredentials: true
      });
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("Primary interface - Ethernet validation", () => {
    it("should require ethernet interface name", () => {
      const node = createValidNode();
      delete node.primary.ethernet.name;
      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });
      expect(result.errors).toContain("Ethernet interface name is required.");
    });

    it("should require ethernet MAC address", () => {
      const node = createValidNode();
      delete node.primary.ethernet.macAddress;
      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });
      expect(result.errors).toContain("Ethernet MAC address is required.");
    });

    it("should validate ethernet MAC address format", () => {
      const node = createValidNode();
      node.primary.ethernet.macAddress = "invalid-mac";
      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });
      expect(result.errors).toContain("Ethernet MAC address format is invalid.");
    });

    it("should accept valid MAC address formats", () => {
      const node = createValidNode();
      node.primary.ethernet.macAddress = "AA:BB:CC:DD:EE:FF";
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

  describe("Primary interface - Bond validation (CRITICAL: minimum 2 slaves)", () => {
    it("should require bond name", () => {
      const node = createValidNode();
      node.primary = {
        type: "bond",
        mode: "dhcp",
        bond: {
          mode: "active-backup",
          slaves: [
            { name: "eth0", macAddress: "00:11:22:33:44:55" },
            { name: "eth1", macAddress: "00:11:22:33:44:56" }
          ]
        }
      };
      delete node.primary.bond.name;
      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });
      expect(result.errors).toContain("Bond name is required.");
    });

    it("should require bond mode", () => {
      const node = createValidNode();
      node.primary = {
        type: "bond",
        mode: "dhcp",
        bond: {
          name: "bond0",
          slaves: [
            { name: "eth0", macAddress: "00:11:22:33:44:55" },
            { name: "eth1", macAddress: "00:11:22:33:44:56" }
          ]
        }
      };
      delete node.primary.bond.mode;
      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });
      expect(result.errors).toContain("Bond mode is required.");
    });

    it("should require at least 2 bond member interfaces", () => {
      const node = createValidNode();
      node.primary = {
        type: "bond",
        mode: "dhcp",
        bond: {
          name: "bond0",
          mode: "active-backup",
          slaves: [{ name: "eth0", macAddress: "00:11:22:33:44:55" }]
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
      expect(result.errors).toContain("Bond requires at least 2 member interfaces.");
    });

    it("should reject bond with 0 slaves", () => {
      const node = createValidNode();
      node.primary = {
        type: "bond",
        mode: "dhcp",
        bond: {
          name: "bond0",
          mode: "active-backup",
          slaves: []
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
      expect(result.errors).toContain("Bond requires at least 2 member interfaces.");
    });

    it("should reject bond with 1 slave", () => {
      const node = createValidNode();
      node.primary = {
        type: "bond",
        mode: "dhcp",
        bond: {
          name: "bond0",
          mode: "active-backup",
          slaves: [{ name: "eth0", macAddress: "00:11:22:33:44:55" }]
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
      expect(result.errors).toContain("Bond requires at least 2 member interfaces.");
    });

    it("should accept bond with exactly 2 slaves", () => {
      const node = createValidNode();
      node.primary = {
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

    it("should accept bond with more than 2 slaves", () => {
      const node = createValidNode();
      node.primary = {
        type: "bond",
        mode: "dhcp",
        bond: {
          name: "bond0",
          mode: "balance-rr",
          slaves: [
            { name: "eth0", macAddress: "00:11:22:33:44:55" },
            { name: "eth1", macAddress: "00:11:22:33:44:56" },
            { name: "eth2", macAddress: "00:11:22:33:44:57" },
            { name: "eth3", macAddress: "00:11:22:33:44:58" }
          ]
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

    it("should require bond slave interface name", () => {
      const node = createValidNode();
      node.primary = {
        type: "bond",
        mode: "dhcp",
        bond: {
          name: "bond0",
          mode: "active-backup",
          slaves: [
            { macAddress: "00:11:22:33:44:55" },
            { name: "eth1", macAddress: "00:11:22:33:44:56" }
          ]
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
      expect(result.errors).toContain("Bond member interface name is required.");
    });

    it("should require bond slave MAC address", () => {
      const node = createValidNode();
      node.primary = {
        type: "bond",
        mode: "dhcp",
        bond: {
          name: "bond0",
          mode: "active-backup",
          slaves: [
            { name: "eth0", macAddress: "00:11:22:33:44:55" },
            { name: "eth1" }
          ]
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
    });

    it("should validate bond slave MAC address format", () => {
      const node = createValidNode();
      node.primary = {
        type: "bond",
        mode: "dhcp",
        bond: {
          name: "bond0",
          mode: "active-backup",
          slaves: [
            { name: "eth0", macAddress: "00:11:22:33:44:55" },
            { name: "eth1", macAddress: "invalid-mac" }
          ]
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
      expect(result.errors).toContain("Bond member MAC address format is invalid.");
    });
  });

  describe("Primary interface - VLAN validation (base interface derivation)", () => {
    it("should require VLAN ID", () => {
      const node = createValidNode();
      node.primary = {
        type: "vlan-on-ethernet",
        mode: "dhcp",
        ethernet: {
          name: "eno1",
          macAddress: "00:11:22:33:44:55"
        },
        vlan: {}
      };
      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });
      expect(result.errors).toContain("VLAN ID is required.");
    });

    it("should derive VLAN base interface from ethernet name when not explicitly provided", () => {
      const node = createValidNode();
      node.primary = {
        type: "vlan-on-ethernet",
        mode: "dhcp",
        ethernet: {
          name: "eno1",
          macAddress: "00:11:22:33:44:55"
        },
        vlan: {
          id: 100
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
      // Should not error about missing baseIface since it's derived from ethernet.name
      expect(result.errors).toHaveLength(0);
    });

    it("should derive VLAN base interface from bond name when not explicitly provided", () => {
      const node = createValidNode();
      node.primary = {
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
      // Should not error about missing baseIface since it's derived from bond.name
      expect(result.errors).toHaveLength(0);
    });

    it("should require VLAN base interface when neither bond nor ethernet name is available", () => {
      const node = createValidNode();
      node.primary = {
        type: "vlan-on-ethernet",
        mode: "dhcp",
        ethernet: {
          macAddress: "00:11:22:33:44:55"
        },
        vlan: {
          id: 100
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
      expect(result.errors).toContain("VLAN base interface is required.");
    });

    it("should use explicit VLAN baseIface when provided", () => {
      const node = createValidNode();
      node.primary = {
        type: "vlan-on-ethernet",
        mode: "dhcp",
        ethernet: {
          name: "eno1",
          macAddress: "00:11:22:33:44:55"
        },
        vlan: {
          id: 100,
          baseIface: "eno2"
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
      // Should use eno2 as baseIface, not eno1 from ethernet.name
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("Primary interface - Static IP mode validation", () => {
    it("should require IPv4 CIDR for static mode", () => {
      const node = createValidNode();
      node.primary.mode = "static";
      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });
      expect(result.errors).toContain("IPv4 address/CIDR is required for static mode.");
    });

    it("should validate IPv4 CIDR format", () => {
      const node = createValidNode();
      node.primary.mode = "static";
      node.primary.ipv4Cidr = "invalid-cidr";
      node.primary.ipv4Gateway = "10.0.0.1";
      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });
      expect(result.errors).toContain("IPv4 CIDR is invalid.");
    });

    it("should require IPv4 default gateway for static mode", () => {
      const node = createValidNode();
      node.primary.mode = "static";
      node.primary.ipv4Cidr = "10.0.0.10/24";
      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });
      expect(result.errors).toContain("IPv4 default gateway is required.");
    });

    it("should validate IPv4 gateway format", () => {
      const node = createValidNode();
      node.primary.mode = "static";
      node.primary.ipv4Cidr = "10.0.0.10/24";
      node.primary.ipv4Gateway = "invalid-ip";
      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });
      expect(result.errors).toContain("IPv4 gateway must be a valid IPv4 address.");
    });

    it("should warn when IPv4 is outside machine network CIDR", () => {
      const node = createValidNode();
      node.primary.mode = "static";
      node.primary.ipv4Cidr = "192.168.1.10/24";
      node.primary.ipv4Gateway = "192.168.1.1";
      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });
      expect(result.warnings).toContain("IPv4 is outside machine network (10.0.0.0/24).");
    });

    it("should accept valid static IPv4 configuration within machine network", () => {
      const node = createValidNode();
      node.primary.mode = "static";
      node.primary.ipv4Cidr = "10.0.0.10/24";
      node.primary.ipv4Gateway = "10.0.0.1";
      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe("Primary interface - IPv6 static mode validation", () => {
    it("should validate IPv6 CIDR format when provided", () => {
      const node = createValidNode();
      node.primary.mode = "static";
      node.primary.ipv4Cidr = "10.0.0.10/24";
      node.primary.ipv4Gateway = "10.0.0.1";
      node.primary.ipv6Cidr = "invalid-ipv6-cidr";
      const result = validateNode({
        node,
        enableIpv6: true,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });
      expect(result.errors).toContain("IPv6 CIDR is invalid.");
    });

    it("should require IPv6 CIDR when IPv6 gateway is provided", () => {
      const node = createValidNode();
      node.primary.mode = "static";
      node.primary.ipv4Cidr = "10.0.0.10/24";
      node.primary.ipv4Gateway = "10.0.0.1";
      node.primary.ipv6Gateway = "2001:db8::1";
      const result = validateNode({
        node,
        enableIpv6: true,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });
      expect(result.errors).toContain("IPv6 CIDR is required when IPv6 gateway is provided.");
    });

    it("should accept valid IPv6 configuration with CIDR and gateway", () => {
      const node = createValidNode();
      node.primary.mode = "static";
      node.primary.ipv4Cidr = "10.0.0.10/24";
      node.primary.ipv4Gateway = "10.0.0.1";
      node.primary.ipv6Cidr = "2001:db8::10/64";
      node.primary.ipv6Gateway = "2001:db8::1";
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

  describe("Additional interfaces validation (multiple bonds/VLANs)", () => {
    it("should validate additional ethernet interface", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "ethernet",
          mode: "dhcp",
          ethernet: {
            name: "eno2",
            macAddress: "00:11:22:33:44:66"
          }
        }
      ];
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

    it("should require additional ethernet interface name", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "ethernet",
          mode: "dhcp",
          ethernet: {
            macAddress: "00:11:22:33:44:66"
          }
        }
      ];
      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });
      expect(result.errors).toContain("Additional ethernet interface name is required.");
    });

    it("should require additional ethernet MAC address", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "ethernet",
          mode: "dhcp",
          ethernet: {
            name: "eno2"
          }
        }
      ];
      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });
      expect(result.errors).toContain("Additional ethernet MAC address is required.");
    });

    it("should validate additional ethernet MAC address format", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "ethernet",
          mode: "dhcp",
          ethernet: {
            name: "eno2",
            macAddress: "invalid-mac"
          }
        }
      ];
      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });
      expect(result.errors).toContain("Additional ethernet MAC address format is invalid.");
    });

    it("should validate multiple additional bonds", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "bond",
          mode: "dhcp",
          bond: {
            name: "bond1",
            mode: "active-backup",
            slaves: [
              { name: "eth2", macAddress: "00:11:22:33:44:77" },
              { name: "eth3", macAddress: "00:11:22:33:44:78" }
            ]
          }
        },
        {
          type: "bond",
          mode: "dhcp",
          bond: {
            name: "bond2",
            mode: "balance-rr",
            slaves: [
              { name: "eth4", macAddress: "00:11:22:33:44:79" },
              { name: "eth5", macAddress: "00:11:22:33:44:80" }
            ]
          }
        }
      ];
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

    it("should require at least 2 slaves for additional bond", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "bond",
          mode: "dhcp",
          bond: {
            name: "bond1",
            mode: "active-backup",
            slaves: [{ name: "eth2", macAddress: "00:11:22:33:44:77" }]
          }
        }
      ];
      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });
      expect(result.errors).toContain("Additional bond requires at least 2 member interfaces.");
    });

    it("should validate multiple additional VLANs", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "vlan-on-ethernet",
          mode: "dhcp",
          ethernet: {
            name: "eno2",
            macAddress: "00:11:22:33:44:66"
          },
          vlan: {
            id: 200,
            baseIface: "eno2"
          }
        },
        {
          type: "vlan-on-ethernet",
          mode: "dhcp",
          ethernet: {
            name: "eno3",
            macAddress: "00:11:22:33:44:67"
          },
          vlan: {
            id: 300,
            baseIface: "eno3"
          }
        }
      ];
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

    it("should require VLAN ID for additional VLAN", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "vlan-on-ethernet",
          mode: "dhcp",
          ethernet: {
            name: "eno2",
            macAddress: "00:11:22:33:44:66"
          },
          vlan: {
            baseIface: "eno2"
          }
        }
      ];
      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });
      expect(result.errors).toContain("Additional VLAN ID is required.");
    });

    it("should validate additional interface static mode IPv4 CIDR", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "ethernet",
          mode: "static",
          ethernet: {
            name: "eno2",
            macAddress: "00:11:22:33:44:66"
          },
          ipv4Cidr: "invalid-cidr"
        }
      ];
      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });
      expect(result.errors).toContain("Additional IPv4 CIDR is invalid.");
    });

    it("should validate additional interface static mode IPv6 CIDR", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "ethernet",
          mode: "static",
          ethernet: {
            name: "eno2",
            macAddress: "00:11:22:33:44:66"
          },
          ipv4Cidr: "192.168.1.10/24",
          ipv6Cidr: "invalid-ipv6"
        }
      ];
      const result = validateNode({
        node,
        enableIpv6: true,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });
      expect(result.errors).toContain("Additional IPv6 CIDR is invalid.");
    });
  });

  describe("Arbiter node special handling", () => {
    it("should NOT validate additional interfaces for arbiter nodes", () => {
      const node = createValidNode();
      node.role = "arbiter";
      // Add additional interfaces with intentionally invalid data
      node.additionalInterfaces = [
        {
          type: "ethernet",
          mode: "dhcp",
          ethernet: {
            // Missing name and MAC - should not be validated
          }
        }
      ];
      const result = validateNode({
        node,
        enableIpv6: false,
        machineCidr: "10.0.0.0/24",
        platform: "Bare Metal",
        method: "Agent-Based Installer",
        includeCredentials: false
      });
      // Should not see errors about additional interfaces since arbiter nodes skip that validation
      expect(result.errors.filter(e => e.includes("Additional"))).toHaveLength(0);
    });

    it("should validate additional interfaces for non-arbiter nodes", () => {
      const node = createValidNode();
      node.role = "master";
      node.additionalInterfaces = [
        {
          type: "ethernet",
          mode: "dhcp",
          ethernet: {
            // Missing name and MAC
          }
        }
      ];
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

  describe("VRF cross-field validation", () => {
    const vrfValidate = (node) => validateNode({
      node,
      enableIpv6: false,
      machineCidr: "10.0.0.0/24",
      platform: "Bare Metal",
      method: "Agent-Based Installer",
      includeCredentials: false
    });

    it("should error when two Additional Interfaces use identical default VRF names", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "ethernet", mode: "dhcp",
          ethernet: { name: "eno2", macAddress: "00:11:22:33:44:66" },
          advanced: { vrf: { enabled: true, name: "vrf0", tableId: "100", ports: "" } }
        },
        {
          type: "ethernet", mode: "dhcp",
          ethernet: { name: "eno3", macAddress: "00:11:22:33:44:67" },
          advanced: { vrf: { enabled: true, name: "vrf0", tableId: "100", ports: "" } }
        }
      ];
      const result = vrfValidate(node);
      expect(result.errors.some(e => e.includes('VRF name "vrf0"') && e.includes('already used'))).toBe(true);
    });

    it("should error when Primary VRF and Additional VRF use the same default name", () => {
      const node = createValidNode();
      node.primary.advanced = { vrf: { enabled: true, name: "vrf0", tableId: "100", ports: "" } };
      node.additionalInterfaces = [
        {
          type: "ethernet", mode: "dhcp",
          ethernet: { name: "eno2", macAddress: "00:11:22:33:44:66" },
          advanced: { vrf: { enabled: true, name: "vrf0", tableId: "200", ports: "" } }
        }
      ];
      const result = vrfValidate(node);
      expect(result.errors.some(e => e.includes('VRF name "vrf0"') && e.includes('already used'))).toBe(true);
    });

    it("should error when VRF name collides with an active Ethernet name", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "ethernet", mode: "dhcp",
          ethernet: { name: "eno2", macAddress: "00:11:22:33:44:66" },
          advanced: { vrf: { enabled: true, name: "eno2", tableId: "100", ports: "portX" } }
        }
      ];
      expect(vrfValidate(node).errors.some(e => e.includes('VRF name "eno2"') && e.includes('collides'))).toBe(true);
    });

    it("should error when VRF name collides with an active Bond name", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "bond", mode: "dhcp",
          bond: { name: "bond1", mode: "active-backup", slaves: [
            { name: "eth2", macAddress: "00:11:22:33:44:77" },
            { name: "eth3", macAddress: "00:11:22:33:44:78" }
          ]},
          advanced: { vrf: { enabled: true, name: "bond1", tableId: "100", ports: "portX" } }
        }
      ];
      expect(vrfValidate(node).errors.some(e => e.includes('VRF name "bond1"') && e.includes('collides'))).toBe(true);
    });

    it("should error when VRF name collides with an active Bond member name", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "bond", mode: "dhcp",
          bond: { name: "bond1", mode: "active-backup", slaves: [
            { name: "eth2", macAddress: "00:11:22:33:44:77" },
            { name: "eth3", macAddress: "00:11:22:33:44:78" }
          ]},
          advanced: { vrf: { enabled: true, name: "eth2", tableId: "100", ports: "portX" } }
        }
      ];
      expect(vrfValidate(node).errors.some(e => e.includes('VRF name "eth2"') && e.includes('collides'))).toBe(true);
    });

    it("should error when VRF name collides with a generated VLAN name", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "vlan-on-ethernet", mode: "dhcp",
          ethernet: { name: "eno2", macAddress: "00:11:22:33:44:66" },
          vlan: { id: 200, name: "eno2.200" },
          advanced: { vrf: { enabled: true, name: "eno2.200", tableId: "100", ports: "portX" } }
        }
      ];
      expect(vrfValidate(node).errors.some(e => e.includes('VRF name "eno2.200"') && e.includes('collides'))).toBe(true);
    });

    it("should accept two unique VRF names without errors", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "ethernet", mode: "dhcp",
          ethernet: { name: "eno2", macAddress: "00:11:22:33:44:66" },
          advanced: { vrf: { enabled: true, name: "vrf-a", tableId: "100", ports: "" } }
        },
        {
          type: "ethernet", mode: "dhcp",
          ethernet: { name: "eno3", macAddress: "00:11:22:33:44:67" },
          advanced: { vrf: { enabled: true, name: "vrf-b", tableId: "200", ports: "" } }
        }
      ];
      expect(vrfValidate(node).errors).toHaveLength(0);
    });

    it("should accept blank VRF ports without error", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "ethernet", mode: "dhcp",
          ethernet: { name: "eno2", macAddress: "00:11:22:33:44:66" },
          advanced: { vrf: { enabled: true, name: "vrf0", tableId: "100", ports: "" } }
        }
      ];
      expect(vrfValidate(node).errors).toHaveLength(0);
    });

    it("should accept explicit VRF ports after trimming", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "ethernet", mode: "dhcp",
          ethernet: { name: "eno2", macAddress: "00:11:22:33:44:66" },
          advanced: { vrf: { enabled: true, name: "vrf0", tableId: "100", ports: "  portA , portB  " } }
        }
      ];
      expect(vrfValidate(node).errors).toHaveLength(0);
    });

    it("should error when VRF name is blank", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "ethernet", mode: "dhcp",
          ethernet: { name: "eno2", macAddress: "00:11:22:33:44:66" },
          advanced: { vrf: { enabled: true, name: "", tableId: "100", ports: "" } }
        }
      ];
      expect(vrfValidate(node).errors.some(e => e.includes("VRF name is required"))).toBe(true);
    });

    it("should not validate VRF when disabled", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "ethernet", mode: "dhcp",
          ethernet: { name: "eno2", macAddress: "00:11:22:33:44:66" },
          advanced: { vrf: { enabled: false, name: "", tableId: "", ports: "" } }
        }
      ];
      expect(vrfValidate(node).errors).toHaveLength(0);
    });

    it("should accept single VRF with default name", () => {
      const node = createValidNode();
      node.primary.advanced = { vrf: { enabled: true, name: "vrf0", tableId: "100", ports: "" } };
      expect(vrfValidate(node).errors).toHaveLength(0);
    });

    it("should include Primary and Additional active names in same collision set", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "ethernet", mode: "dhcp",
          ethernet: { name: "eno2", macAddress: "00:11:22:33:44:66" },
          advanced: { vrf: { enabled: true, name: "eno1", tableId: "100", ports: "portX" } }
        }
      ];
      expect(vrfValidate(node).errors.some(e => e.includes('VRF name "eno1"') && e.includes('collides'))).toBe(true);
    });
  });

  describe("VRF table-ID normalization (Number.isInteger)", () => {
    const vrfValidate = (node) => validateNode({
      node,
      enableIpv6: false,
      machineCidr: "10.0.0.0/24",
      platform: "Bare Metal",
      method: "Agent-Based Installer",
      includeCredentials: false
    });

    it("should accept string '100'", () => {
      const node = createValidNode();
      node.primary.advanced = { vrf: { enabled: true, name: "vrf0", tableId: "100", ports: "" } };
      expect(vrfValidate(node).errors).toHaveLength(0);
    });

    it("should accept numeric 100", () => {
      const node = createValidNode();
      node.primary.advanced = { vrf: { enabled: true, name: "vrf0", tableId: 100, ports: "" } };
      expect(vrfValidate(node).errors).toHaveLength(0);
    });

    it("should accept string '0'", () => {
      const node = createValidNode();
      node.primary.advanced = { vrf: { enabled: true, name: "vrf0", tableId: "0", ports: "" } };
      expect(vrfValidate(node).errors.filter(e => e.includes("table ID"))).toHaveLength(0);
    });

    it("should accept numeric 0", () => {
      const node = createValidNode();
      node.primary.advanced = { vrf: { enabled: true, name: "vrf0", tableId: 0, ports: "" } };
      expect(vrfValidate(node).errors.filter(e => e.includes("table ID"))).toHaveLength(0);
    });

    it("should reject string '1.5'", () => {
      const node = createValidNode();
      node.primary.advanced = { vrf: { enabled: true, name: "vrf0", tableId: "1.5", ports: "" } };
      expect(vrfValidate(node).errors.some(e => e.includes("VRF table ID must be a valid integer"))).toBe(true);
    });

    it("should reject numeric 1.5", () => {
      const node = createValidNode();
      node.primary.advanced = { vrf: { enabled: true, name: "vrf0", tableId: 1.5, ports: "" } };
      expect(vrfValidate(node).errors.some(e => e.includes("VRF table ID must be a valid integer"))).toBe(true);
    });

    it("should reject string 'abc'", () => {
      const node = createValidNode();
      node.primary.advanced = { vrf: { enabled: true, name: "vrf0", tableId: "abc", ports: "" } };
      expect(vrfValidate(node).errors.some(e => e.includes("VRF table ID must be a valid integer"))).toBe(true);
    });

    it("should reject empty string", () => {
      const node = createValidNode();
      node.primary.advanced = { vrf: { enabled: true, name: "vrf0", tableId: "", ports: "" } };
      expect(vrfValidate(node).errors.some(e => e.includes("VRF table ID must be a valid integer"))).toBe(true);
    });

    it("should reject whitespace-only string", () => {
      const node = createValidNode();
      node.primary.advanced = { vrf: { enabled: true, name: "vrf0", tableId: "  ", ports: "" } };
      expect(vrfValidate(node).errors.some(e => e.includes("VRF table ID must be a valid integer"))).toBe(true);
    });

    it("should reject null", () => {
      const node = createValidNode();
      node.primary.advanced = { vrf: { enabled: true, name: "vrf0", tableId: null, ports: "" } };
      expect(vrfValidate(node).errors.some(e => e.includes("VRF table ID must be a valid integer"))).toBe(true);
    });

    it("should reject undefined", () => {
      const node = createValidNode();
      node.primary.advanced = { vrf: { enabled: true, name: "vrf0", ports: "" } };
      expect(vrfValidate(node).errors.some(e => e.includes("VRF table ID must be a valid integer"))).toBe(true);
    });
  });

  describe("VRF VLAN-name parity (mirrors backend baseIface fallback)", () => {
    const vrfValidate = (node) => validateNode({
      node,
      enableIpv6: false,
      machineCidr: "10.0.0.0/24",
      platform: "Bare Metal",
      method: "Agent-Based Installer",
      includeCredentials: false
    });

    it("VLAN-on-Ethernet without vlan.baseIface falls back to ethernet.name", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "vlan-on-ethernet", mode: "dhcp",
          ethernet: { name: "eno2", macAddress: "00:11:22:33:44:66" },
          vlan: { id: 200 },
          advanced: { vrf: { enabled: true, name: "eno2.200", tableId: "100", ports: "portX" } }
        }
      ];
      expect(vrfValidate(node).errors.some(e => e.includes('VRF name "eno2.200"') && e.includes('collides'))).toBe(true);
    });

    it("VLAN-on-Bond without vlan.baseIface falls back to bond.name", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "vlan-on-bond", mode: "dhcp",
          bond: { name: "bond1", mode: "active-backup", slaves: [
            { name: "eth2", macAddress: "00:11:22:33:44:77" },
            { name: "eth3", macAddress: "00:11:22:33:44:78" }
          ]},
          vlan: { id: 300 },
          advanced: { vrf: { enabled: true, name: "bond1.300", tableId: "100", ports: "portX" } }
        }
      ];
      expect(vrfValidate(node).errors.some(e => e.includes('VRF name "bond1.300"') && e.includes('collides'))).toBe(true);
    });

    it("VLAN-on-Ethernet with vlan.baseIface uses baseIface ahead of ethernet.name", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "vlan-on-ethernet", mode: "dhcp",
          ethernet: { name: "eno2", macAddress: "00:11:22:33:44:66" },
          vlan: { id: 200, baseIface: "custom-base" },
          advanced: { vrf: { enabled: true, name: "custom-base.200", tableId: "100", ports: "portX" } }
        }
      ];
      expect(vrfValidate(node).errors.some(e => e.includes('VRF name "custom-base.200"') && e.includes('collides'))).toBe(true);
    });

    it("VLAN-on-Bond with vlan.baseIface uses baseIface ahead of bond.name", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "vlan-on-bond", mode: "dhcp",
          bond: { name: "bond1", mode: "active-backup", slaves: [
            { name: "eth2", macAddress: "00:11:22:33:44:77" },
            { name: "eth3", macAddress: "00:11:22:33:44:78" }
          ]},
          vlan: { id: 300, baseIface: "custom-bond-base" },
          advanced: { vrf: { enabled: true, name: "custom-bond-base.300", tableId: "100", ports: "portX" } }
        }
      ];
      expect(vrfValidate(node).errors.some(e => e.includes('VRF name "custom-bond-base.300"') && e.includes('collides'))).toBe(true);
    });

    it("explicit vlan.name overrides both baseIface and the active Ethernet/Bond name", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "vlan-on-ethernet", mode: "dhcp",
          ethernet: { name: "eno2", macAddress: "00:11:22:33:44:66" },
          vlan: { id: 200, baseIface: "custom-base", name: "my-vlan" },
          advanced: { vrf: { enabled: true, name: "my-vlan", tableId: "100", ports: "portX" } }
        }
      ];
      expect(vrfValidate(node).errors.some(e => e.includes('VRF name "my-vlan"') && e.includes('collides'))).toBe(true);
    });

    it("VRF name colliding with baseIface-derived VLAN name is rejected", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "vlan-on-ethernet", mode: "dhcp",
          ethernet: { name: "eno2", macAddress: "00:11:22:33:44:66" },
          vlan: { id: 200, baseIface: "overridden-base" },
          advanced: { vrf: { enabled: true, name: "overridden-base.200", tableId: "100", ports: "portX" } }
        }
      ];
      expect(vrfValidate(node).errors.some(e => e.includes('VRF name "overridden-base.200"') && e.includes('collides'))).toBe(true);
    });

    it("VRF name matching the ignored active fallback does not falsely collide when baseIface overrides it", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "vlan-on-ethernet", mode: "dhcp",
          ethernet: { name: "eno2", macAddress: "00:11:22:33:44:66" },
          vlan: { id: 200, baseIface: "custom-base" },
          advanced: { vrf: { enabled: true, name: "eno2.200", tableId: "100", ports: "portX" } }
        }
      ];
      const result = vrfValidate(node);
      expect(result.errors.filter(e => e.includes('"eno2.200"') && e.includes('collides'))).toHaveLength(0);
    });

    it("surrounding whitespace on baseIface is preserved in generated name, then outer trim normalizes", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "vlan-on-ethernet", mode: "dhcp",
          ethernet: { name: "eno2", macAddress: "00:11:22:33:44:66" },
          vlan: { id: 200, baseIface: "custom-base" },
          advanced: { vrf: { enabled: true, name: " custom-base.200 ", tableId: "100", ports: "portX" } }
        }
      ];
      expect(vrfValidate(node).errors.some(e => e.includes('VRF name "custom-base.200"') && e.includes('collides'))).toBe(true);
    });

    it("stale Bond mode state remains ignored for VLAN-on-Ethernet, except consumed vlan.baseIface", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "vlan-on-ethernet", mode: "dhcp",
          ethernet: { name: "eno2", macAddress: "00:11:22:33:44:66" },
          bond: { name: "bond-stale", mode: "active-backup", slaves: [{ name: "s1" }, { name: "s2" }] },
          vlan: { id: 200 },
          advanced: { vrf: { enabled: true, name: "bond-stale", tableId: "100", ports: "portX" } }
        }
      ];
      expect(vrfValidate(node).errors.filter(e => e.includes("collides"))).toHaveLength(0);
    });

    it("stale standalone Ethernet state remains ignored for VLAN-on-Bond, except consumed vlan.baseIface", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "vlan-on-bond", mode: "dhcp",
          ethernet: { name: "eth-stale", macAddress: "00:11:22:33:44:66" },
          bond: { name: "bond1", mode: "active-backup", slaves: [
            { name: "eth2", macAddress: "00:11:22:33:44:77" },
            { name: "eth3", macAddress: "00:11:22:33:44:78" }
          ]},
          vlan: { id: 300 },
          advanced: { vrf: { enabled: true, name: "eth-stale", tableId: "100", ports: "portX" } }
        }
      ];
      expect(vrfValidate(node).errors.filter(e => e.includes("collides"))).toHaveLength(0);
    });
  });

  describe("VRF active-name-only validation (stale mode state ignored)", () => {
    const vrfValidate = (node) => validateNode({
      node,
      enableIpv6: false,
      machineCidr: "10.0.0.0/24",
      platform: "Bare Metal",
      method: "Agent-Based Installer",
      includeCredentials: false
    });

    it("Ethernet mode ignores a stale hidden Bond name", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "ethernet", mode: "dhcp",
          ethernet: { name: "eno2", macAddress: "00:11:22:33:44:66" },
          bond: { name: "bond-stale", mode: "active-backup", slaves: [{ name: "s1" }, { name: "s2" }] },
          advanced: { vrf: { enabled: true, name: "bond-stale", tableId: "100", ports: "portX" } }
        }
      ];
      expect(vrfValidate(node).errors.filter(e => e.includes("collides"))).toHaveLength(0);
    });

    it("Bond mode ignores a stale hidden Ethernet name", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "bond", mode: "dhcp",
          ethernet: { name: "eth-stale", macAddress: "00:11:22:33:44:66" },
          bond: { name: "bond1", mode: "active-backup", slaves: [
            { name: "eth2", macAddress: "00:11:22:33:44:77" },
            { name: "eth3", macAddress: "00:11:22:33:44:78" }
          ]},
          advanced: { vrf: { enabled: true, name: "eth-stale", tableId: "100", ports: "portX" } }
        }
      ];
      expect(vrfValidate(node).errors.filter(e => e.includes("collides"))).toHaveLength(0);
    });

    it("VLAN-on-Ethernet ignores stale Bond mode state (bond.name/slaves not generated)", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "vlan-on-ethernet", mode: "dhcp",
          ethernet: { name: "eno2", macAddress: "00:11:22:33:44:66" },
          bond: { name: "bond-stale", mode: "active-backup", slaves: [{ name: "s1" }, { name: "s2" }] },
          vlan: { id: 200 },
          advanced: { vrf: { enabled: true, name: "bond-stale", tableId: "100", ports: "portX" } }
        }
      ];
      expect(vrfValidate(node).errors.filter(e => e.includes("collides"))).toHaveLength(0);
    });

    it("VLAN-on-Bond ignores stale standalone Ethernet state (ethernet.name not generated as standalone)", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "vlan-on-bond", mode: "dhcp",
          ethernet: { name: "eth-stale", macAddress: "00:11:22:33:44:66" },
          bond: { name: "bond1", mode: "active-backup", slaves: [
            { name: "eth2", macAddress: "00:11:22:33:44:77" },
            { name: "eth3", macAddress: "00:11:22:33:44:78" }
          ]},
          vlan: { id: 300 },
          advanced: { vrf: { enabled: true, name: "eth-stale", tableId: "100", ports: "portX" } }
        }
      ];
      expect(vrfValidate(node).errors.filter(e => e.includes("collides"))).toHaveLength(0);
    });
  });

  describe("VRF normalized-name collision detection", () => {
    const vrfValidate = (node) => validateNode({
      node,
      enableIpv6: false,
      machineCidr: "10.0.0.0/24",
      platform: "Bare Metal",
      method: "Agent-Based Installer",
      includeCredentials: false
    });

    it("physical ' eno2 ' collides with VRF 'eno2'", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "ethernet", mode: "dhcp",
          ethernet: { name: " eno2 ", macAddress: "00:11:22:33:44:66" },
          advanced: { vrf: { enabled: true, name: "eno2", tableId: "100", ports: "portX" } }
        }
      ];
      expect(vrfValidate(node).errors.some(e => e.includes('VRF name "eno2"') && e.includes('collides'))).toBe(true);
    });

    it("physical 'eno2' collides with VRF ' eno2 '", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "ethernet", mode: "dhcp",
          ethernet: { name: "eno2", macAddress: "00:11:22:33:44:66" },
          advanced: { vrf: { enabled: true, name: " eno2 ", tableId: "100", ports: "portX" } }
        }
      ];
      expect(vrfValidate(node).errors.some(e => e.includes('VRF name "eno2"') && e.includes('collides'))).toBe(true);
    });

    it("bond ' bond1 ' collides with VRF 'bond1'", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "bond", mode: "dhcp",
          bond: { name: " bond1 ", mode: "active-backup", slaves: [
            { name: "eth2", macAddress: "00:11:22:33:44:77" },
            { name: "eth3", macAddress: "00:11:22:33:44:78" }
          ]},
          advanced: { vrf: { enabled: true, name: "bond1", tableId: "100", ports: "portX" } }
        }
      ];
      expect(vrfValidate(node).errors.some(e => e.includes('VRF name "bond1"') && e.includes('collides'))).toBe(true);
    });

    it("bond member ' eth2 ' collides with VRF 'eth2'", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "bond", mode: "dhcp",
          bond: { name: "bond1", mode: "active-backup", slaves: [
            { name: " eth2 ", macAddress: "00:11:22:33:44:77" },
            { name: "eth3", macAddress: "00:11:22:33:44:78" }
          ]},
          advanced: { vrf: { enabled: true, name: "eth2", tableId: "100", ports: "portX" } }
        }
      ];
      expect(vrfValidate(node).errors.some(e => e.includes('VRF name "eth2"') && e.includes('collides'))).toBe(true);
    });

    it("explicit VLAN name ' eno2.200 ' collides with VRF 'eno2.200'", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "vlan-on-ethernet", mode: "dhcp",
          ethernet: { name: "eno2", macAddress: "00:11:22:33:44:66" },
          vlan: { id: 200, name: " eno2.200 " },
          advanced: { vrf: { enabled: true, name: "eno2.200", tableId: "100", ports: "portX" } }
        }
      ];
      expect(vrfValidate(node).errors.some(e => e.includes('VRF name "eno2.200"') && e.includes('collides'))).toBe(true);
    });

    it("two VRF names differing only by surrounding whitespace collide", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "ethernet", mode: "dhcp",
          ethernet: { name: "eno2", macAddress: "00:11:22:33:44:66" },
          advanced: { vrf: { enabled: true, name: "vrf0", tableId: "100", ports: "" } }
        },
        {
          type: "ethernet", mode: "dhcp",
          ethernet: { name: "eno3", macAddress: "00:11:22:33:44:67" },
          advanced: { vrf: { enabled: true, name: " vrf0 ", tableId: "200", ports: "" } }
        }
      ];
      expect(vrfValidate(node).errors.some(e => e.includes('VRF name "vrf0"') && e.includes('already used'))).toBe(true);
    });

    it("noncolliding normalized names remain valid", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "ethernet", mode: "dhcp",
          ethernet: { name: " eno2 ", macAddress: "00:11:22:33:44:66" },
          advanced: { vrf: { enabled: true, name: " vrf-a ", tableId: "100", ports: "" } }
        },
        {
          type: "ethernet", mode: "dhcp",
          ethernet: { name: " eno3 ", macAddress: "00:11:22:33:44:67" },
          advanced: { vrf: { enabled: true, name: " vrf-b ", tableId: "200", ports: "" } }
        }
      ];
      expect(vrfValidate(node).errors).toHaveLength(0);
    });

    it("stale inactive names remain ignored even when trimmed value would collide", () => {
      const node = createValidNode();
      node.additionalInterfaces = [
        {
          type: "ethernet", mode: "dhcp",
          ethernet: { name: "eno2", macAddress: "00:11:22:33:44:66" },
          bond: { name: " vrf0 ", mode: "active-backup", slaves: [{ name: "s1" }, { name: "s2" }] },
          advanced: { vrf: { enabled: true, name: "vrf0", tableId: "100", ports: "" } }
        }
      ];
      expect(vrfValidate(node).errors.filter(e => e.includes("collides"))).toHaveLength(0);
    });
  });
});

describe("validateHostInventory - Full host inventory validation", () => {
  it("should aggregate errors from multiple nodes", () => {
    const state = createValidState();
    state.hostInventory.nodes = [
      {
        // Node 1: missing hostname
        primary: {
          type: "ethernet",
          mode: "dhcp",
          ethernet: { name: "eno1", macAddress: "00:11:22:33:44:55" }
        }
      },
      {
        // Node 2: missing primary type
        hostname: "node-02",
        primary: {
          mode: "dhcp",
          ethernet: { name: "eno1", macAddress: "00:11:22:33:44:56" }
        }
      }
    ];
    const result = validateHostInventory(state);
    expect(result.errors).toContain("Node 1: Hostname is required.");
    expect(result.errors).toContain("Node 2: Primary interface type is required.");
    expect(result.perNode).toHaveLength(2);
  });

  it("should aggregate warnings from multiple nodes", () => {
    const state = createValidState();
    state.hostInventory.nodes = [
      {
        hostname: "node-01",
        // Missing rootDevice - should warn
        primary: {
          type: "ethernet",
          mode: "dhcp",
          ethernet: { name: "eno1", macAddress: "00:11:22:33:44:55" }
        }
      },
      {
        hostname: "node-02",
        // Missing rootDevice - should warn
        primary: {
          type: "ethernet",
          mode: "dhcp",
          ethernet: { name: "eno1", macAddress: "00:11:22:33:44:56" }
        }
      }
    ];
    const result = validateHostInventory(state);
    expect(result.warnings).toContain("Node 1: Root device hint is missing (by-path recommended when available).");
    expect(result.warnings).toContain("Node 2: Root device hint is missing (by-path recommended when available).");
  });

  it("should pass validation for valid host inventory", () => {
    const state = createValidState();
    state.hostInventory.nodes = [
      createValidNode(),
      { ...createValidNode(), hostname: "node-02", primary: { ...createValidNode().primary, ethernet: { name: "eno1", macAddress: "00:11:22:33:44:56" } } }
    ];
    const result = validateHostInventory(state);
    expect(result.errors).toHaveLength(0);
  });

  it("should handle empty nodes array", () => {
    const state = createValidState();
    state.hostInventory.nodes = [];
    const result = validateHostInventory(state);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.perNode).toHaveLength(0);
  });

  it("should propagate enableIpv6 flag to node validation", () => {
    const state = createValidState();
    state.hostInventory.ipStackMode = "dual-stack"; // enableIpv6 is now derived from ipStackMode
    state.hostInventory.nodes = [
      {
        hostname: "node-01",
        rootDevice: "/dev/sda",
        primary: {
          type: "ethernet",
          mode: "static",
          ethernet: { name: "eno1", macAddress: "00:11:22:33:44:55" },
          ipv4Cidr: "10.0.0.10/24",
          ipv4Gateway: "10.0.0.1",
          ipv6Cidr: "invalid-ipv6",
          ipv6Gateway: "2001:db8::1"
        }
      }
    ];
    const result = validateHostInventory(state);
    expect(result.errors).toContain("Node 1: IPv6 CIDR is invalid.");
  });

  it("should propagate platform and method to node validation", () => {
    const state = createValidState();
    state.blueprint.platform = "Bare Metal";
    state.methodology.method = "IPI";
    state.exportOptions.includeCredentials = true;
    state.hostInventory.nodes = [
      {
        hostname: "node-01",
        rootDevice: "/dev/sda",
        primary: {
          type: "ethernet",
          mode: "dhcp",
          ethernet: { name: "eno1", macAddress: "00:11:22:33:44:55" }
        }
        // Missing BMC for bare metal IPI
      }
    ];
    const result = validateHostInventory(state);
    expect(result.errors).toContain("Node 1: BMC address is required for bare metal IPI.");
  });
});
