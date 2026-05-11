/**
 * OpenShift Airgap Architect - Provisioning Network Validation Tests
 *
 * Tests DHCP range and cluster provisioning IP validation for bare metal provisioning.
 * Covers DOC-025: Bare metal provisioning network audit (DHCP range, provisioning IP validation).
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, expect } from "vitest";
import { validateStep } from "../src/validation.js";

describe("Provisioning Network Validation", () => {
  const makeBaseState = () => ({
    blueprint: {
      platform: "Bare Metal",
      confirmed: true
    },
    methodology: {
      method: "IPI"
    },
    globalStrategy: {
      networking: {
        machineNetworkV4: "10.0.0.0/24"
      }
    },
    hostInventory: {
      nodes: []
    }
  });

  describe("DHCP Range Format Validation", () => {
    it("accepts valid DHCP range format", () => {
      const state = makeBaseState();
      state.hostInventory.provisioningNetworkCIDR = "172.22.0.0/24";
      state.hostInventory.provisioningDHCPRange = "172.22.0.10,172.22.0.254";

      const result = validateStep(state, "networking");

      const dhcpErrors = result.errors.filter(err => err.includes("DHCP"));
      expect(dhcpErrors).toHaveLength(0);
    });

    it("rejects DHCP range with invalid format (missing comma)", () => {
      const state = makeBaseState();
      state.hostInventory.provisioningDHCPRange = "172.22.0.10-172.22.0.254";

      const result = validateStep(state, "networking");

      const formatError = result.errors.find(err => err.includes("format") && err.includes("start_ip,end_ip"));
      expect(formatError).toBeDefined();
    });

    it("rejects DHCP range with too many parts", () => {
      const state = makeBaseState();
      state.hostInventory.provisioningDHCPRange = "172.22.0.10,172.22.0.50,172.22.0.254";

      const result = validateStep(state, "networking");

      const formatError = result.errors.find(err => err.includes("format"));
      expect(formatError).toBeDefined();
    });

    it("rejects DHCP range with invalid IPv4 addresses", () => {
      const state = makeBaseState();
      state.hostInventory.provisioningDHCPRange = "172.22.0.999,172.22.0.254";

      const result = validateStep(state, "networking");

      const ipError = result.errors.find(err => err.includes("valid IPv4"));
      expect(ipError).toBeDefined();
    });
  });

  describe("DHCP Range Order Validation", () => {
    it("accepts DHCP range where start equals end", () => {
      const state = makeBaseState();
      state.hostInventory.provisioningNetworkCIDR = "172.22.0.0/24";
      state.hostInventory.provisioningDHCPRange = "172.22.0.100,172.22.0.100";

      const result = validateStep(state, "networking");

      const orderErrors = result.errors.filter(err => err.includes("start IP") && err.includes("end IP"));
      expect(orderErrors).toHaveLength(0);
    });

    it("rejects DHCP range where start > end", () => {
      const state = makeBaseState();
      state.hostInventory.provisioningNetworkCIDR = "172.22.0.0/24";
      state.hostInventory.provisioningDHCPRange = "172.22.0.254,172.22.0.10";

      const result = validateStep(state, "networking");

      const orderError = result.errors.find(err => err.includes("start IP must be less than or equal to end IP"));
      expect(orderError).toBeDefined();
    });
  });

  describe("DHCP Range Within Provisioning CIDR", () => {
    it("accepts DHCP range fully within provisioning CIDR", () => {
      const state = makeBaseState();
      state.hostInventory.provisioningNetworkCIDR = "172.22.0.0/24";
      state.hostInventory.provisioningDHCPRange = "172.22.0.10,172.22.0.254";

      const result = validateStep(state, "networking");

      const cidrErrors = result.errors.filter(err => err.includes("outside provisioning network CIDR"));
      expect(cidrErrors).toHaveLength(0);
    });

    it("rejects DHCP start IP outside provisioning CIDR", () => {
      const state = makeBaseState();
      state.hostInventory.provisioningNetworkCIDR = "172.22.0.0/24";
      state.hostInventory.provisioningDHCPRange = "172.21.0.10,172.22.0.254"; // Start IP in different subnet

      const result = validateStep(state, "networking");

      const startError = result.errors.find(err => err.includes("DHCP start IP") && err.includes("outside"));
      expect(startError).toBeDefined();
      expect(startError).toContain("172.21.0.10");
    });

    it("rejects DHCP end IP outside provisioning CIDR", () => {
      const state = makeBaseState();
      state.hostInventory.provisioningNetworkCIDR = "172.22.0.0/24";
      state.hostInventory.provisioningDHCPRange = "172.22.0.10,172.23.0.254"; // End IP in different subnet

      const result = validateStep(state, "networking");

      const endError = result.errors.find(err => err.includes("DHCP end IP") && err.includes("outside"));
      expect(endError).toBeDefined();
      expect(endError).toContain("172.23.0.254");
    });

    it("rejects both IPs outside provisioning CIDR", () => {
      const state = makeBaseState();
      state.hostInventory.provisioningNetworkCIDR = "172.22.0.0/24";
      state.hostInventory.provisioningDHCPRange = "172.23.0.10,172.23.0.254";

      const result = validateStep(state, "networking");

      const cidrErrors = result.errors.filter(err => err.includes("outside provisioning network CIDR"));
      expect(cidrErrors.length).toBeGreaterThanOrEqual(2); // Both start and end errors
    });
  });

  describe("Cluster Provisioning IP Within CIDR", () => {
    it("accepts cluster provisioning IP within provisioning CIDR", () => {
      const state = makeBaseState();
      state.hostInventory.provisioningNetworkCIDR = "172.22.0.0/24";
      state.hostInventory.clusterProvisioningIP = "172.22.0.3";

      const result = validateStep(state, "networking");

      const ipErrors = result.errors.filter(err => err.includes("Cluster provisioning IP") && err.includes("outside"));
      expect(ipErrors).toHaveLength(0);
    });

    it("rejects cluster provisioning IP outside provisioning CIDR", () => {
      const state = makeBaseState();
      state.hostInventory.provisioningNetworkCIDR = "172.22.0.0/24";
      state.hostInventory.clusterProvisioningIP = "172.23.0.10"; // Different subnet

      const result = validateStep(state, "networking");

      const ipError = result.errors.find(err => err.includes("Cluster provisioning IP") && err.includes("outside provisioning network CIDR"));
      expect(ipError).toBeDefined();
      expect(ipError).toContain("172.23.0.10");
      expect(ipError).toContain("172.22.0.0/24");
    });

    it("accepts cluster provisioning IP at first address of CIDR", () => {
      const state = makeBaseState();
      state.hostInventory.provisioningNetworkCIDR = "172.22.0.0/24";
      state.hostInventory.clusterProvisioningIP = "172.22.0.0";

      const result = validateStep(state, "networking");

      const ipErrors = result.errors.filter(err => err.includes("Cluster provisioning IP") && err.includes("outside"));
      expect(ipErrors).toHaveLength(0);
    });

    it("accepts cluster provisioning IP at last address of CIDR", () => {
      const state = makeBaseState();
      state.hostInventory.provisioningNetworkCIDR = "172.22.0.0/24";
      state.hostInventory.clusterProvisioningIP = "172.22.0.255";

      const result = validateStep(state, "networking");

      const ipErrors = result.errors.filter(err => err.includes("Cluster provisioning IP") && err.includes("outside"));
      expect(ipErrors).toHaveLength(0);
    });
  });

  describe("Cluster Provisioning IP Not in DHCP Range", () => {
    it("accepts cluster provisioning IP outside DHCP range", () => {
      const state = makeBaseState();
      state.hostInventory.provisioningNetworkCIDR = "172.22.0.0/24";
      state.hostInventory.provisioningDHCPRange = "172.22.0.10,172.22.0.254";
      state.hostInventory.clusterProvisioningIP = "172.22.0.3"; // Before DHCP range

      const result = validateStep(state, "networking");

      const conflictErrors = result.errors.filter(err => err.includes("conflicts with DHCP range"));
      expect(conflictErrors).toHaveLength(0);
    });

    it("rejects cluster provisioning IP at start of DHCP range", () => {
      const state = makeBaseState();
      state.hostInventory.provisioningNetworkCIDR = "172.22.0.0/24";
      state.hostInventory.provisioningDHCPRange = "172.22.0.10,172.22.0.254";
      state.hostInventory.clusterProvisioningIP = "172.22.0.10"; // At start

      const result = validateStep(state, "networking");

      const conflictError = result.errors.find(err => err.includes("conflicts with DHCP range"));
      expect(conflictError).toBeDefined();
      expect(conflictError).toContain("172.22.0.10");
    });

    it("rejects cluster provisioning IP in middle of DHCP range", () => {
      const state = makeBaseState();
      state.hostInventory.provisioningNetworkCIDR = "172.22.0.0/24";
      state.hostInventory.provisioningDHCPRange = "172.22.0.10,172.22.0.254";
      state.hostInventory.clusterProvisioningIP = "172.22.0.100"; // In middle

      const result = validateStep(state, "networking");

      const conflictError = result.errors.find(err => err.includes("conflicts with DHCP range"));
      expect(conflictError).toBeDefined();
    });

    it("rejects cluster provisioning IP at end of DHCP range", () => {
      const state = makeBaseState();
      state.hostInventory.provisioningNetworkCIDR = "172.22.0.0/24";
      state.hostInventory.provisioningDHCPRange = "172.22.0.10,172.22.0.254";
      state.hostInventory.clusterProvisioningIP = "172.22.0.254"; // At end

      const result = validateStep(state, "networking");

      const conflictError = result.errors.find(err => err.includes("conflicts with DHCP range"));
      expect(conflictError).toBeDefined();
    });

    it("accepts cluster provisioning IP just after DHCP range", () => {
      const state = makeBaseState();
      state.hostInventory.provisioningNetworkCIDR = "172.22.0.0/24";
      state.hostInventory.provisioningDHCPRange = "172.22.0.10,172.22.0.200";
      state.hostInventory.clusterProvisioningIP = "172.22.0.201"; // Just after

      const result = validateStep(state, "networking");

      const conflictErrors = result.errors.filter(err => err.includes("conflicts with DHCP range"));
      expect(conflictErrors).toHaveLength(0);
    });
  });

  describe("Edge Cases", () => {
    it("allows empty/missing provisioning network fields", () => {
      const state = makeBaseState();
      // No provisioning fields set

      const result = validateStep(state, "networking");

      const provErrors = result.errors.filter(err => err.toLowerCase().includes("provisioning"));
      expect(provErrors).toHaveLength(0);
    });

    it("validates DHCP range even when cluster provisioning IP is missing", () => {
      const state = makeBaseState();
      state.hostInventory.provisioningNetworkCIDR = "172.22.0.0/24";
      state.hostInventory.provisioningDHCPRange = "172.23.0.10,172.23.0.254"; // Outside CIDR

      const result = validateStep(state, "networking");

      const dhcpErrors = result.errors.filter(err => err.includes("DHCP") && err.includes("outside"));
      expect(dhcpErrors.length).toBeGreaterThan(0);
    });

    it("validates cluster provisioning IP even when DHCP range is missing", () => {
      const state = makeBaseState();
      state.hostInventory.provisioningNetworkCIDR = "172.22.0.0/24";
      state.hostInventory.clusterProvisioningIP = "172.23.0.10"; // Outside CIDR

      const result = validateStep(state, "networking");

      const ipError = result.errors.find(err => err.includes("Cluster provisioning IP") && err.includes("outside"));
      expect(ipError).toBeDefined();
    });

    it("handles small provisioning network (/29)", () => {
      const state = makeBaseState();
      state.hostInventory.provisioningNetworkCIDR = "172.22.0.0/29"; // 8 addresses
      state.hostInventory.provisioningDHCPRange = "172.22.0.2,172.22.0.6";
      state.hostInventory.clusterProvisioningIP = "172.22.0.1";

      const result = validateStep(state, "networking");

      const provErrors = result.errors.filter(err => err.toLowerCase().includes("provisioning"));
      expect(provErrors).toHaveLength(0);
    });
  });
});
