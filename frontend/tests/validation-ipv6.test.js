/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * IPv6 validation tests - comprehensive test suite for isValidIpv6()
 * Covers valid formats, compressed notation, and invalid/malformed addresses
 */
import { describe, it, expect } from "vitest";
import { isValidIpv6 } from "../src/validation.js";

describe("isValidIpv6", () => {
  describe("Valid IPv6 addresses", () => {
    it("should accept full uncompressed IPv6", () => {
      expect(isValidIpv6("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe(true);
      expect(isValidIpv6("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toBe(true);
      expect(isValidIpv6("FEDC:BA98:7654:3210:FEDC:BA98:7654:3210")).toBe(true);
    });

    it("should accept full IPv6 without leading zeros", () => {
      expect(isValidIpv6("2001:db8:0:0:0:0:0:1")).toBe(true);
      expect(isValidIpv6("2001:db8:85a3:0:0:8a2e:370:7334")).toBe(true);
    });

    it("should accept :: for all zeros", () => {
      expect(isValidIpv6("::")).toBe(true);
    });

    it("should accept compressed IPv6 with :: at start", () => {
      expect(isValidIpv6("::1")).toBe(true);
      expect(isValidIpv6("::ffff")).toBe(true);
      expect(isValidIpv6("::1234:5678")).toBe(true);
      expect(isValidIpv6("::1234:5678:90ab:cdef")).toBe(true);
    });

    it("should accept compressed IPv6 with :: at end", () => {
      expect(isValidIpv6("1::")).toBe(true);
      expect(isValidIpv6("2001::")).toBe(true);
      expect(isValidIpv6("2001:db8::")).toBe(true);
      expect(isValidIpv6("fe80::")).toBe(true);
    });

    it("should accept compressed IPv6 with :: in middle", () => {
      expect(isValidIpv6("2001::1")).toBe(true);
      expect(isValidIpv6("2001:db8::1")).toBe(true);
      expect(isValidIpv6("2001:db8::8a2e:370:7334")).toBe(true);
      expect(isValidIpv6("fe80::1234:5678:90ab")).toBe(true);
    });

    it("should accept link-local addresses", () => {
      expect(isValidIpv6("fe80::1")).toBe(true);
      expect(isValidIpv6("fe80::a1b2:c3d4:e5f6:7890")).toBe(true);
    });

    it("should accept loopback address", () => {
      expect(isValidIpv6("::1")).toBe(true);
      expect(isValidIpv6("0000:0000:0000:0000:0000:0000:0000:0001")).toBe(true);
    });

    it("should accept mixed case hex", () => {
      expect(isValidIpv6("2001:Db8::1")).toBe(true);
      expect(isValidIpv6("2001:DB8:ABCD:EF01::1")).toBe(true);
      expect(isValidIpv6("AbCd:EfGh:0123:4567:89aB:cDeF:0123:4567")).toBe(false); // 'g' and 'h' are invalid
    });
  });

  describe("Invalid IPv6 addresses - malformed", () => {
    it("should reject empty string", () => {
      expect(isValidIpv6("")).toBe(false);
      expect(isValidIpv6("   ")).toBe(false);
    });

    it("should reject null and undefined", () => {
      expect(isValidIpv6(null)).toBe(false);
      expect(isValidIpv6(undefined)).toBe(false);
    });

    it("should reject non-string types", () => {
      expect(isValidIpv6(12345)).toBe(false);
      expect(isValidIpv6({})).toBe(false);
      expect(isValidIpv6([])).toBe(false);
    });

    it("should reject addresses with CIDR notation", () => {
      expect(isValidIpv6("2001:db8::1/64")).toBe(false);
      expect(isValidIpv6("::1/128")).toBe(false);
    });

    it("should reject invalid hex characters", () => {
      expect(isValidIpv6("gggg::1")).toBe(false);
      expect(isValidIpv6("2001:xyz::1")).toBe(false);
      expect(isValidIpv6("zzzz:zzzz:zzzz:zzzz:zzzz:zzzz:zzzz:zzzz")).toBe(false);
      expect(isValidIpv6("200g:db8::1")).toBe(false);
    });

    it("should reject multiple :: compressions", () => {
      expect(isValidIpv6("2001::db8::1")).toBe(false);
      expect(isValidIpv6("::1::2")).toBe(false);
      expect(isValidIpv6("::1::")).toBe(false);
    });

    it("should reject excessive colons", () => {
      expect(isValidIpv6(":::::")).toBe(false);
      expect(isValidIpv6(":::1")).toBe(false);
      expect(isValidIpv6("2001:::1")).toBe(false);
      expect(isValidIpv6(":::")).toBe(false);
    });

    it("should reject single colon", () => {
      expect(isValidIpv6(":")).toBe(false);
    });

    it("should reject groups longer than 4 hex digits", () => {
      expect(isValidIpv6("12345::1")).toBe(false);
      expect(isValidIpv6("2001:db8:abcdef::1")).toBe(false);
      expect(isValidIpv6("20011:db8::1")).toBe(false);
    });

    it("should reject wrong number of groups in full format", () => {
      expect(isValidIpv6("2001:db8:0:0:0:0:1")).toBe(false); // 7 groups
      expect(isValidIpv6("2001:db8:0:0:0:0:0:0:1")).toBe(false); // 9 groups
      expect(isValidIpv6("2001")).toBe(false); // 1 group
      expect(isValidIpv6("2001:db8")).toBe(false); // 2 groups
    });

    it("should reject too many groups with compression", () => {
      expect(isValidIpv6("2001:db8:0:0:0:0:0::1")).toBe(false); // 8 groups total
      expect(isValidIpv6("1:2:3:4:5:6:7::8")).toBe(false); // 8 groups
    });

    it("should reject IPv4 addresses", () => {
      expect(isValidIpv6("192.168.1.1")).toBe(false);
      expect(isValidIpv6("10.0.0.1")).toBe(false);
    });

    it("should reject empty groups in uncompressed format", () => {
      expect(isValidIpv6("2001:db8:::1")).toBe(false);
      expect(isValidIpv6("2001::db8::1")).toBe(false); // Multiple ::
    });

    it("should reject trailing/leading single colons", () => {
      expect(isValidIpv6(":2001:db8::1")).toBe(false);
      expect(isValidIpv6("2001:db8::1:")).toBe(false);
    });

    it("should reject special characters", () => {
      expect(isValidIpv6("2001:db8::1@")).toBe(false);
      expect(isValidIpv6("2001:db8::1#")).toBe(false);
      expect(isValidIpv6("2001:db8::1%")).toBe(false);
    });

    it("should reject addresses with spaces", () => {
      expect(isValidIpv6("2001:db8 ::1")).toBe(false);
      expect(isValidIpv6("2001: db8::1")).toBe(false);
    });
  });

  describe("Edge cases", () => {
    it("should accept single group compression at various positions", () => {
      expect(isValidIpv6("1:2:3:4:5:6::8")).toBe(true); // Compresses group 7
      expect(isValidIpv6("1::3:4:5:6:7:8")).toBe(true); // Compresses group 2
      expect(isValidIpv6("1:2:3:4:5::7:8")).toBe(true); // Compresses group 6
    });

    it("should handle maximum valid compression", () => {
      expect(isValidIpv6("::1:2:3:4:5:6:7")).toBe(true); // 7 groups + ::
      expect(isValidIpv6("1:2:3:4:5:6:7::")).toBe(true); // 7 groups + ::
    });

    it("should reject compression with 8 groups total", () => {
      expect(isValidIpv6("1:2:3:4:5:6:7::8")).toBe(false); // Would be 8 groups
    });

    it("should handle lowercase and uppercase correctly", () => {
      expect(isValidIpv6("ABCD:EF01:2345:6789:ABCD:EF01:2345:6789")).toBe(true);
      expect(isValidIpv6("abcd:ef01:2345:6789:abcd:ef01:2345:6789")).toBe(true);
    });

    it("should trim whitespace", () => {
      expect(isValidIpv6("  2001:db8::1  ")).toBe(true);
      expect(isValidIpv6("\t2001:db8::1\t")).toBe(true);
    });
  });
});
