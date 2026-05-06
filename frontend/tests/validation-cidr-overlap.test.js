/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * CIDR overlap detection tests - comprehensive test suite for cidrOverlaps()
 * This function is critical for preventing network configuration errors in OpenShift
 * Currently had ZERO tests before this file was created.
 */
import { describe, it, expect } from "vitest";
import { cidrOverlaps } from "../src/validation.js";

describe("cidrOverlaps - IPv4 CIDR overlap detection", () => {
  describe("Exact overlap - same network", () => {
    it("should detect exact overlap for /24 networks", () => {
      expect(cidrOverlaps("10.0.0.0/24", "10.0.0.0/24")).toBe(true);
      expect(cidrOverlaps("192.168.1.0/24", "192.168.1.0/24")).toBe(true);
    });

    it("should detect exact overlap for /16 networks", () => {
      expect(cidrOverlaps("10.0.0.0/16", "10.0.0.0/16")).toBe(true);
      expect(cidrOverlaps("172.16.0.0/16", "172.16.0.0/16")).toBe(true);
    });

    it("should detect exact overlap for /8 networks", () => {
      expect(cidrOverlaps("10.0.0.0/8", "10.0.0.0/8")).toBe(true);
      expect(cidrOverlaps("192.0.0.0/8", "192.0.0.0/8")).toBe(true);
    });

    it("should detect exact overlap for /32 single addresses", () => {
      expect(cidrOverlaps("10.0.0.1/32", "10.0.0.1/32")).toBe(true);
      expect(cidrOverlaps("192.168.1.100/32", "192.168.1.100/32")).toBe(true);
    });
  });

  describe("Partial overlap - one network contains the other", () => {
    it("should detect when smaller network is fully contained in larger", () => {
      // 10.0.0.0/16 contains 10.0.1.0/24
      expect(cidrOverlaps("10.0.0.0/16", "10.0.1.0/24")).toBe(true);
      expect(cidrOverlaps("10.0.1.0/24", "10.0.0.0/16")).toBe(true);
    });

    it("should detect when /24 is contained in /16", () => {
      expect(cidrOverlaps("192.168.0.0/16", "192.168.1.0/24")).toBe(true);
      expect(cidrOverlaps("192.168.1.0/24", "192.168.0.0/16")).toBe(true);
    });

    it("should detect when /16 is contained in /8", () => {
      expect(cidrOverlaps("10.0.0.0/8", "10.1.0.0/16")).toBe(true);
      expect(cidrOverlaps("10.1.0.0/16", "10.0.0.0/8")).toBe(true);
    });

    it("should detect when /27 is contained in /24", () => {
      expect(cidrOverlaps("10.0.0.0/24", "10.0.0.0/27")).toBe(true);
      expect(cidrOverlaps("10.0.0.0/27", "10.0.0.0/24")).toBe(true);
    });

    it("should detect when /32 is contained in any network", () => {
      expect(cidrOverlaps("10.0.0.0/24", "10.0.0.5/32")).toBe(true);
      expect(cidrOverlaps("10.0.0.5/32", "10.0.0.0/24")).toBe(true);
    });
  });

  describe("No overlap - adjacent or separate networks", () => {
    it("should not detect overlap for adjacent /24 networks", () => {
      expect(cidrOverlaps("10.0.0.0/24", "10.0.1.0/24")).toBe(false);
      expect(cidrOverlaps("192.168.1.0/24", "192.168.2.0/24")).toBe(false);
    });

    it("should not detect overlap for separate /16 networks", () => {
      expect(cidrOverlaps("10.0.0.0/16", "10.1.0.0/16")).toBe(false);
      expect(cidrOverlaps("172.16.0.0/16", "172.17.0.0/16")).toBe(false);
    });

    it("should not detect overlap for separate /8 networks", () => {
      expect(cidrOverlaps("10.0.0.0/8", "11.0.0.0/8")).toBe(false);
      expect(cidrOverlaps("192.0.0.0/8", "193.0.0.0/8")).toBe(false);
    });

    it("should not detect overlap for non-adjacent networks", () => {
      expect(cidrOverlaps("10.0.0.0/24", "192.168.1.0/24")).toBe(false);
      expect(cidrOverlaps("172.16.0.0/16", "192.168.0.0/16")).toBe(false);
    });

    it("should not detect overlap for adjacent /32 addresses", () => {
      expect(cidrOverlaps("10.0.0.1/32", "10.0.0.2/32")).toBe(false);
      expect(cidrOverlaps("192.168.1.10/32", "192.168.1.11/32")).toBe(false);
    });
  });

  describe("Boundary cases - edge prefix lengths", () => {
    it("should handle /0 (entire IPv4 space) overlapping with everything", () => {
      expect(cidrOverlaps("0.0.0.0/0", "10.0.0.0/24")).toBe(true);
      expect(cidrOverlaps("10.0.0.0/24", "0.0.0.0/0")).toBe(true);
      expect(cidrOverlaps("0.0.0.0/0", "192.168.1.0/24")).toBe(true);
    });

    it("should handle /0 overlapping with itself", () => {
      expect(cidrOverlaps("0.0.0.0/0", "0.0.0.0/0")).toBe(true);
    });

    it("should handle /31 networks (RFC 3021 point-to-point)", () => {
      expect(cidrOverlaps("10.0.0.0/31", "10.0.0.0/31")).toBe(true);
      expect(cidrOverlaps("10.0.0.0/31", "10.0.0.2/31")).toBe(false);
    });

    it("should handle /32 single host addresses", () => {
      expect(cidrOverlaps("10.0.0.1/32", "10.0.0.1/32")).toBe(true);
      expect(cidrOverlaps("10.0.0.1/32", "10.0.0.2/32")).toBe(false);
    });

    it("should handle /30 networks (4 addresses)", () => {
      expect(cidrOverlaps("10.0.0.0/30", "10.0.0.0/30")).toBe(true);
      expect(cidrOverlaps("10.0.0.0/30", "10.0.0.4/30")).toBe(false);
      // 10.0.0.0/30 = .0-.3, 10.0.0.2/31 = .2-.3 (overlaps)
      expect(cidrOverlaps("10.0.0.0/30", "10.0.0.2/31")).toBe(true);
    });
  });

  describe("OpenShift-specific scenarios", () => {
    it("should detect overlap between machine network and service network", () => {
      // This SHOULD overlap and fail validation
      expect(cidrOverlaps("10.0.0.0/16", "10.0.0.0/16")).toBe(true);
    });

    it("should not detect overlap for typical OpenShift defaults", () => {
      // Machine: 10.0.0.0/16, Service: 172.30.0.0/16
      expect(cidrOverlaps("10.0.0.0/16", "172.30.0.0/16")).toBe(false);

      // Machine: 10.0.0.0/16, Pod: 10.128.0.0/14
      expect(cidrOverlaps("10.0.0.0/16", "10.128.0.0/14")).toBe(false);

      // Service: 172.30.0.0/16, Pod: 10.128.0.0/14
      expect(cidrOverlaps("172.30.0.0/16", "10.128.0.0/14")).toBe(false);
    });

    it("should detect overlap if pod network overlaps machine network", () => {
      // If someone configures pod network as 10.0.0.0/14, it overlaps machine 10.0.0.0/16
      expect(cidrOverlaps("10.0.0.0/16", "10.0.0.0/14")).toBe(true);
    });

    it("should handle AWS VPC subnet scenarios", () => {
      // VPC: 10.0.0.0/16, Subnet 1: 10.0.0.0/24, Subnet 2: 10.0.1.0/24
      expect(cidrOverlaps("10.0.0.0/16", "10.0.0.0/24")).toBe(true);
      expect(cidrOverlaps("10.0.0.0/24", "10.0.1.0/24")).toBe(false);
    });
  });

  describe("Large IP addresses - integer overflow handling", () => {
    it("should handle networks in 255.x.x.x range", () => {
      expect(cidrOverlaps("255.0.0.0/24", "255.0.0.0/24")).toBe(true);
      expect(cidrOverlaps("255.0.0.0/24", "255.0.1.0/24")).toBe(false);
    });

    it("should handle networks near upper bound of IPv4 space", () => {
      expect(cidrOverlaps("255.255.255.0/24", "255.255.255.0/24")).toBe(true);
      expect(cidrOverlaps("255.255.254.0/24", "255.255.255.0/24")).toBe(false);
    });

    it("should handle large /8 networks", () => {
      expect(cidrOverlaps("255.0.0.0/8", "255.1.0.0/16")).toBe(true);
      expect(cidrOverlaps("254.0.0.0/8", "255.0.0.0/8")).toBe(false);
    });

    it("should handle maximum address 255.255.255.255", () => {
      expect(cidrOverlaps("255.255.255.255/32", "255.255.255.255/32")).toBe(true);
      expect(cidrOverlaps("255.255.255.254/32", "255.255.255.255/32")).toBe(false);
    });
  });

  describe("Invalid input handling", () => {
    it("should return false for invalid CIDR notation", () => {
      expect(cidrOverlaps("10.0.0.0", "10.0.0.0/24")).toBe(false);
      expect(cidrOverlaps("10.0.0.0/24", "10.0.0.0")).toBe(false);
      expect(cidrOverlaps("10.0.0.0", "10.0.0.0")).toBe(false);
    });

    it("should return false for invalid IP addresses", () => {
      expect(cidrOverlaps("256.0.0.0/24", "10.0.0.0/24")).toBe(false);
      expect(cidrOverlaps("10.0.0.0/24", "10.256.0.0/24")).toBe(false);
    });

    it("should return false for invalid prefix lengths", () => {
      expect(cidrOverlaps("10.0.0.0/33", "10.0.0.0/24")).toBe(false);
      expect(cidrOverlaps("10.0.0.0/24", "10.0.0.0/-1")).toBe(false);
    });

    it("should return false for null or undefined", () => {
      expect(cidrOverlaps(null, "10.0.0.0/24")).toBe(false);
      expect(cidrOverlaps("10.0.0.0/24", null)).toBe(false);
      expect(cidrOverlaps(null, null)).toBe(false);
    });

    it("should return false for empty strings", () => {
      expect(cidrOverlaps("", "10.0.0.0/24")).toBe(false);
      expect(cidrOverlaps("10.0.0.0/24", "")).toBe(false);
      expect(cidrOverlaps("", "")).toBe(false);
    });

    it("should return false for non-network addresses in CIDR", () => {
      // These should fail isValidIpv4Cidr and return false from cidrOverlaps
      expect(cidrOverlaps("10.0.0.5/24", "10.0.0.0/24")).toBe(false);
      expect(cidrOverlaps("10.0.0.0/24", "10.0.0.5/24")).toBe(false);
    });
  });

  describe("Edge cases with different prefix combinations", () => {
    it("should handle /25 networks correctly", () => {
      // 192.168.1.0/25 = .0-.127, 192.168.1.128/25 = .128-.255
      expect(cidrOverlaps("192.168.1.0/25", "192.168.1.128/25")).toBe(false);
      expect(cidrOverlaps("192.168.1.0/25", "192.168.1.0/24")).toBe(true);
    });

    it("should handle /26 networks correctly", () => {
      // Four /26 networks in a /24
      expect(cidrOverlaps("192.168.1.0/26", "192.168.1.64/26")).toBe(false);
      expect(cidrOverlaps("192.168.1.0/26", "192.168.1.128/26")).toBe(false);
      expect(cidrOverlaps("192.168.1.0/26", "192.168.1.192/26")).toBe(false);
    });

    it("should handle /27 networks correctly", () => {
      // 10.0.0.0/27 = .0-.31, 10.0.0.32/27 = .32-.63
      expect(cidrOverlaps("10.0.0.0/27", "10.0.0.32/27")).toBe(false);
      expect(cidrOverlaps("10.0.0.0/27", "10.0.0.0/26")).toBe(true);
    });

    it("should handle /28 networks correctly", () => {
      // 10.0.0.0/28 = .0-.15, 10.0.0.16/28 = .16-.31
      expect(cidrOverlaps("10.0.0.0/28", "10.0.0.16/28")).toBe(false);
      expect(cidrOverlaps("10.0.0.0/28", "10.0.0.0/27")).toBe(true);
    });

    it("should handle /29 networks correctly", () => {
      // 10.0.0.0/29 = .0-.7, 10.0.0.8/29 = .8-.15
      expect(cidrOverlaps("10.0.0.0/29", "10.0.0.8/29")).toBe(false);
      expect(cidrOverlaps("10.0.0.0/29", "10.0.0.0/28")).toBe(true);
    });
  });

  describe("Real-world OpenShift network configuration edge cases", () => {
    it("should detect overlap when user misconfigures service network inside machine network", () => {
      // Machine: 10.0.0.0/16, Service (wrong): 10.0.1.0/24
      expect(cidrOverlaps("10.0.0.0/16", "10.0.1.0/24")).toBe(true);
    });

    it("should detect overlap when user misconfigures pod network inside machine network", () => {
      // Machine: 10.0.0.0/16, Pod (wrong): 10.0.0.0/14
      expect(cidrOverlaps("10.0.0.0/16", "10.0.0.0/14")).toBe(true);
    });

    it("should allow valid OpenShift network separation", () => {
      // Machine: 10.0.0.0/16 (10.0.0.0 - 10.0.255.255)
      // Service: 172.30.0.0/16 (172.30.0.0 - 172.30.255.255)
      // Pod: 10.128.0.0/14 (10.128.0.0 - 10.131.255.255)
      expect(cidrOverlaps("10.0.0.0/16", "172.30.0.0/16")).toBe(false);
      expect(cidrOverlaps("10.0.0.0/16", "10.128.0.0/14")).toBe(false);
      expect(cidrOverlaps("172.30.0.0/16", "10.128.0.0/14")).toBe(false);
    });
  });
});
