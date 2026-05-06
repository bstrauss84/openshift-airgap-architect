/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * CIDR validation tests - ensures network address validation for IPv4 CIDRs
 */
import { describe, it, expect } from "vitest";
import { isValidIpv4Cidr } from "../src/validation.js";

describe("isValidIpv4Cidr", () => {
  describe("Valid CIDR notation with correct network addresses", () => {
    it("should accept /24 networks with correct network address", () => {
      expect(isValidIpv4Cidr("10.0.0.0/24")).toBe(true);
      expect(isValidIpv4Cidr("192.168.1.0/24")).toBe(true);
      expect(isValidIpv4Cidr("172.16.0.0/24")).toBe(true);
    });

    it("should accept /16 networks with correct network address", () => {
      expect(isValidIpv4Cidr("10.0.0.0/16")).toBe(true);
      expect(isValidIpv4Cidr("192.168.0.0/16")).toBe(true);
      expect(isValidIpv4Cidr("172.16.0.0/16")).toBe(true);
    });

    it("should accept /8 networks with correct network address", () => {
      expect(isValidIpv4Cidr("10.0.0.0/8")).toBe(true);
      expect(isValidIpv4Cidr("192.0.0.0/8")).toBe(true);
      expect(isValidIpv4Cidr("172.0.0.0/8")).toBe(true);
    });

    it("should accept /25 networks with correct network address", () => {
      expect(isValidIpv4Cidr("192.168.1.0/25")).toBe(true);
      expect(isValidIpv4Cidr("192.168.1.128/25")).toBe(true);
      expect(isValidIpv4Cidr("10.0.0.0/25")).toBe(true);
    });

    it("should accept /26 networks with correct network address", () => {
      expect(isValidIpv4Cidr("192.168.1.0/26")).toBe(true);
      expect(isValidIpv4Cidr("192.168.1.64/26")).toBe(true);
      expect(isValidIpv4Cidr("192.168.1.128/26")).toBe(true);
      expect(isValidIpv4Cidr("192.168.1.192/26")).toBe(true);
    });

    it("should accept /27 networks with correct network address", () => {
      expect(isValidIpv4Cidr("10.0.0.0/27")).toBe(true);
      expect(isValidIpv4Cidr("10.0.0.32/27")).toBe(true);
      expect(isValidIpv4Cidr("10.0.0.64/27")).toBe(true);
    });

    it("should accept /28 networks with correct network address", () => {
      expect(isValidIpv4Cidr("192.168.1.0/28")).toBe(true);
      expect(isValidIpv4Cidr("192.168.1.16/28")).toBe(true);
      expect(isValidIpv4Cidr("192.168.1.32/28")).toBe(true);
    });

    it("should accept /30 networks (point-to-point) with correct network address", () => {
      expect(isValidIpv4Cidr("10.0.0.0/30")).toBe(true);
      expect(isValidIpv4Cidr("10.0.0.4/30")).toBe(true);
      expect(isValidIpv4Cidr("10.0.0.8/30")).toBe(true);
    });

    it("should accept /31 networks (RFC 3021) with correct network address", () => {
      expect(isValidIpv4Cidr("10.0.0.0/31")).toBe(true);
      expect(isValidIpv4Cidr("10.0.0.2/31")).toBe(true);
      expect(isValidIpv4Cidr("192.168.1.0/31")).toBe(true);
    });

    it("should accept /32 single host addresses", () => {
      expect(isValidIpv4Cidr("10.0.0.1/32")).toBe(true);
      expect(isValidIpv4Cidr("192.168.1.5/32")).toBe(true);
      expect(isValidIpv4Cidr("172.16.0.100/32")).toBe(true);
    });

    it("should accept /0 default route", () => {
      expect(isValidIpv4Cidr("0.0.0.0/0")).toBe(true);
    });
  });

  describe("Invalid - non-network addresses", () => {
    it("should reject /24 with host bits set", () => {
      expect(isValidIpv4Cidr("10.0.0.5/24")).toBe(false);
      expect(isValidIpv4Cidr("192.168.1.1/24")).toBe(false);
      expect(isValidIpv4Cidr("172.16.0.255/24")).toBe(false);
    });

    it("should reject /16 with host bits set", () => {
      expect(isValidIpv4Cidr("10.0.1.0/16")).toBe(false);
      expect(isValidIpv4Cidr("192.168.1.0/16")).toBe(false);
      expect(isValidIpv4Cidr("172.16.0.1/16")).toBe(false);
    });

    it("should reject /8 with host bits set", () => {
      expect(isValidIpv4Cidr("10.1.0.0/8")).toBe(false);
      expect(isValidIpv4Cidr("192.0.1.0/8")).toBe(false);
      expect(isValidIpv4Cidr("172.0.0.1/8")).toBe(false);
    });

    it("should reject /25 with host bits set", () => {
      expect(isValidIpv4Cidr("192.168.1.1/25")).toBe(false);
      expect(isValidIpv4Cidr("192.168.1.129/25")).toBe(false);
      expect(isValidIpv4Cidr("192.168.1.254/25")).toBe(false);
    });

    it("should reject /26 with host bits set", () => {
      expect(isValidIpv4Cidr("192.168.1.1/26")).toBe(false);
      expect(isValidIpv4Cidr("192.168.1.65/26")).toBe(false);
      expect(isValidIpv4Cidr("192.168.1.129/26")).toBe(false);
    });

    it("should reject /27 with host bits set", () => {
      expect(isValidIpv4Cidr("10.0.0.1/27")).toBe(false);
      expect(isValidIpv4Cidr("10.0.0.33/27")).toBe(false);
      expect(isValidIpv4Cidr("10.0.0.65/27")).toBe(false);
    });

    it("should reject /28 with host bits set", () => {
      expect(isValidIpv4Cidr("192.168.1.1/28")).toBe(false);
      expect(isValidIpv4Cidr("192.168.1.17/28")).toBe(false);
      expect(isValidIpv4Cidr("192.168.1.33/28")).toBe(false);
    });

    it("should reject /30 with host bits set", () => {
      expect(isValidIpv4Cidr("10.0.0.1/30")).toBe(false);
      expect(isValidIpv4Cidr("10.0.0.5/30")).toBe(false);
      expect(isValidIpv4Cidr("10.0.0.9/30")).toBe(false);
    });

    it("should reject /31 with host bits set", () => {
      expect(isValidIpv4Cidr("10.0.0.1/31")).toBe(false);
      expect(isValidIpv4Cidr("10.0.0.3/31")).toBe(false);
      expect(isValidIpv4Cidr("192.168.1.1/31")).toBe(false);
    });
  });

  describe("Invalid - format errors", () => {
    it("should reject missing CIDR notation", () => {
      expect(isValidIpv4Cidr("10.0.0.0")).toBe(false);
      expect(isValidIpv4Cidr("192.168.1.1")).toBe(false);
    });

    it("should reject invalid IP addresses", () => {
      expect(isValidIpv4Cidr("256.0.0.0/24")).toBe(false);
      expect(isValidIpv4Cidr("10.256.0.0/24")).toBe(false);
      expect(isValidIpv4Cidr("10.0.256.0/24")).toBe(false);
      expect(isValidIpv4Cidr("10.0.0.256/24")).toBe(false);
    });

    it("should reject invalid prefix lengths", () => {
      expect(isValidIpv4Cidr("10.0.0.0/33")).toBe(false);
      expect(isValidIpv4Cidr("10.0.0.0/-1")).toBe(false);
      expect(isValidIpv4Cidr("10.0.0.0/abc")).toBe(false);
      expect(isValidIpv4Cidr("10.0.0.0/24.5")).toBe(false);
    });

    it("should reject empty or null values", () => {
      expect(isValidIpv4Cidr("")).toBe(false);
      expect(isValidIpv4Cidr(null)).toBe(false);
      expect(isValidIpv4Cidr(undefined)).toBe(false);
    });

    it("should reject malformed notation", () => {
      expect(isValidIpv4Cidr("10.0.0.0/")).toBe(false);
      expect(isValidIpv4Cidr("/24")).toBe(false);
      expect(isValidIpv4Cidr("10.0.0/24")).toBe(false);
    });
  });

  describe("Edge cases", () => {
    it("should handle common OpenShift defaults correctly", () => {
      // Machine network
      expect(isValidIpv4Cidr("10.0.0.0/16")).toBe(true);
      expect(isValidIpv4Cidr("10.0.1.0/16")).toBe(false); // Not network address

      // Service network
      expect(isValidIpv4Cidr("172.30.0.0/16")).toBe(true);
      expect(isValidIpv4Cidr("172.30.1.0/16")).toBe(false); // Not network address

      // Pod network
      expect(isValidIpv4Cidr("10.128.0.0/14")).toBe(true);
      expect(isValidIpv4Cidr("10.129.0.0/14")).toBe(false); // Not network address
    });

    it("should validate AWS VPC defaults correctly", () => {
      expect(isValidIpv4Cidr("10.0.0.0/16")).toBe(true);
      expect(isValidIpv4Cidr("10.0.0.0/24")).toBe(true);
    });

    it("should validate Azure subnet defaults correctly", () => {
      expect(isValidIpv4Cidr("10.0.0.0/16")).toBe(true);
      expect(isValidIpv4Cidr("10.0.1.0/24")).toBe(true);
    });
  });
});
