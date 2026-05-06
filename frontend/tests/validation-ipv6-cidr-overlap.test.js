/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * IPv6 CIDR overlap detection tests - comprehensive test suite for ipv6CidrOverlaps()
 * Critical for preventing network configuration errors in dual-stack OpenShift clusters
 */
import { describe, it, expect } from "vitest";
import { ipv6CidrOverlaps } from "../src/validation.js";

describe("ipv6CidrOverlaps - IPv6 CIDR overlap detection", () => {
  describe("Exact overlap - same network", () => {
    it("should detect exact overlap for /64 networks", () => {
      expect(ipv6CidrOverlaps("2001:db8::/64", "2001:db8::/64")).toBe(true);
      expect(ipv6CidrOverlaps("fd00::/64", "fd00::/64")).toBe(true);
    });

    it("should detect exact overlap for /48 networks", () => {
      expect(ipv6CidrOverlaps("2001:db8::/48", "2001:db8::/48")).toBe(true);
      expect(ipv6CidrOverlaps("fd00:1234::/48", "fd00:1234::/48")).toBe(true);
    });

    it("should detect exact overlap for /128 single addresses", () => {
      expect(ipv6CidrOverlaps("2001:db8::1/128", "2001:db8::1/128")).toBe(true);
      expect(ipv6CidrOverlaps("::1/128", "::1/128")).toBe(true);
    });

    it("should detect exact overlap for compressed notation", () => {
      expect(ipv6CidrOverlaps("2001:db8::1/64", "2001:db8::1/64")).toBe(true);
      expect(ipv6CidrOverlaps("fe80::/64", "fe80::/64")).toBe(true);
    });
  });

  describe("Partial overlap - one network contains the other", () => {
    it("should detect when /64 is contained in /48", () => {
      expect(ipv6CidrOverlaps("2001:db8::/48", "2001:db8:0:1::/64")).toBe(true);
      expect(ipv6CidrOverlaps("2001:db8:0:1::/64", "2001:db8::/48")).toBe(true);
    });

    it("should detect when /48 is contained in /32", () => {
      expect(ipv6CidrOverlaps("2001:db8::/32", "2001:db8:1::/48")).toBe(true);
      expect(ipv6CidrOverlaps("2001:db8:1::/48", "2001:db8::/32")).toBe(true);
    });

    it("should detect when /128 is contained in any network", () => {
      expect(ipv6CidrOverlaps("2001:db8::/64", "2001:db8::5/128")).toBe(true);
      expect(ipv6CidrOverlaps("2001:db8::5/128", "2001:db8::/64")).toBe(true);
    });

    it("should detect when smaller network is in larger with compressed notation", () => {
      // fd00::/48 covers fd00:0:0:: through fd00:0:ffff:...
      // fd00:0:0:1:: has fourth group as 1, so it's within fd00::/48
      expect(ipv6CidrOverlaps("fd00::/48", "fd00:0:0:1::/64")).toBe(true);
      expect(ipv6CidrOverlaps("fd00:0:0:1::/64", "fd00::/48")).toBe(true);
    });
  });

  describe("No overlap - adjacent or separate networks", () => {
    it("should not detect overlap for adjacent /64 networks", () => {
      expect(ipv6CidrOverlaps("2001:db8:0:0::/64", "2001:db8:0:1::/64")).toBe(false);
      // fd00::/64 is fd00:0:0:0::/64, next is fd00:0:0:1::/64
      expect(ipv6CidrOverlaps("fd00::/64", "fd00:0:0:1::/64")).toBe(false);
    });

    it("should not detect overlap for separate /48 networks", () => {
      expect(ipv6CidrOverlaps("2001:db8:0::/48", "2001:db8:1::/48")).toBe(false);
      expect(ipv6CidrOverlaps("fd00::/48", "fd01::/48")).toBe(false);
    });

    it("should not detect overlap for completely separate networks", () => {
      expect(ipv6CidrOverlaps("2001:db8::/32", "2001:db9::/32")).toBe(false);
      expect(ipv6CidrOverlaps("fd00::/32", "fe80::/32")).toBe(false);
    });

    it("should not detect overlap for adjacent /128 addresses", () => {
      expect(ipv6CidrOverlaps("2001:db8::1/128", "2001:db8::2/128")).toBe(false);
      expect(ipv6CidrOverlaps("::1/128", "::2/128")).toBe(false);
    });
  });

  describe("Boundary cases - edge prefix lengths", () => {
    it("should handle /0 (entire IPv6 space) overlapping with everything", () => {
      expect(ipv6CidrOverlaps("::/0", "2001:db8::/32")).toBe(true);
      expect(ipv6CidrOverlaps("2001:db8::/32", "::/0")).toBe(true);
      expect(ipv6CidrOverlaps("::/0", "fd00::/8")).toBe(true);
    });

    it("should handle /0 overlapping with itself", () => {
      expect(ipv6CidrOverlaps("::/0", "::/0")).toBe(true);
    });

    it("should handle /127 networks (point-to-point)", () => {
      expect(ipv6CidrOverlaps("2001:db8::0/127", "2001:db8::0/127")).toBe(true);
      expect(ipv6CidrOverlaps("2001:db8::0/127", "2001:db8::2/127")).toBe(false);
    });

    it("should handle /128 single host addresses", () => {
      expect(ipv6CidrOverlaps("2001:db8::1/128", "2001:db8::1/128")).toBe(true);
      expect(ipv6CidrOverlaps("2001:db8::1/128", "2001:db8::2/128")).toBe(false);
    });

    it("should handle /126 networks (4 addresses)", () => {
      expect(ipv6CidrOverlaps("2001:db8::0/126", "2001:db8::0/126")).toBe(true);
      expect(ipv6CidrOverlaps("2001:db8::0/126", "2001:db8::4/126")).toBe(false);
    });
  });

  describe("OpenShift dual-stack scenarios", () => {
    it("should detect overlap if networks are identical", () => {
      expect(ipv6CidrOverlaps("fd00::/48", "fd00::/48")).toBe(true);
    });

    it("should not detect overlap for typical dual-stack configuration", () => {
      // Machine: fd01::/48, Service: fd02::/112, Pod: fd03::/48
      expect(ipv6CidrOverlaps("fd01::/48", "fd02::/112")).toBe(false);
      expect(ipv6CidrOverlaps("fd01::/48", "fd03::/48")).toBe(false);
      expect(ipv6CidrOverlaps("fd02::/112", "fd03::/48")).toBe(false);
    });

    it("should detect overlap if pod network overlaps machine network", () => {
      // If pod network is fd00::/32, it overlaps machine fd00::/48
      expect(ipv6CidrOverlaps("fd00::/48", "fd00::/32")).toBe(true);
    });

    it("should handle link-local addresses (fe80::/10)", () => {
      expect(ipv6CidrOverlaps("fe80::/10", "fe80::/64")).toBe(true);
      expect(ipv6CidrOverlaps("fe80::/64", "fe80::/10")).toBe(true);
    });

    it("should handle ULA (fd00::/8) vs global unicast (2000::/3)", () => {
      expect(ipv6CidrOverlaps("fd00::/8", "2001:db8::/32")).toBe(false);
      expect(ipv6CidrOverlaps("2000::/3", "fd00::/8")).toBe(false);
    });
  });

  describe("Compressed notation handling", () => {
    it("should handle :: at the start", () => {
      expect(ipv6CidrOverlaps("::1/128", "::1/128")).toBe(true);
      expect(ipv6CidrOverlaps("::ffff:0:0/96", "::ffff:0:0/96")).toBe(true);
    });

    it("should handle :: at the end", () => {
      expect(ipv6CidrOverlaps("2001:db8::/64", "2001:db8::/64")).toBe(true);
      expect(ipv6CidrOverlaps("fe80::/64", "fe80::/64")).toBe(true);
    });

    it("should handle :: in the middle", () => {
      expect(ipv6CidrOverlaps("2001:db8::1/128", "2001:db8::1/128")).toBe(true);
      expect(ipv6CidrOverlaps("fd00::1234:5678/64", "fd00::1234:5678/64")).toBe(true);
    });

    it("should correctly expand and compare compressed addresses", () => {
      // 2001:db8:: is same as 2001:db8:0:0:0:0:0:0
      expect(ipv6CidrOverlaps("2001:db8::/64", "2001:db8:0:0::/64")).toBe(true);
      expect(ipv6CidrOverlaps("2001:db8::1/128", "2001:db8:0:0:0:0:0:1/128")).toBe(true);
    });
  });

  describe("Special IPv6 addresses", () => {
    it("should handle loopback address (::1/128)", () => {
      expect(ipv6CidrOverlaps("::1/128", "::1/128")).toBe(true);
      expect(ipv6CidrOverlaps("::1/128", "::2/128")).toBe(false);
    });

    it("should handle unspecified address (::/128)", () => {
      expect(ipv6CidrOverlaps("::/128", "::/128")).toBe(true);
      expect(ipv6CidrOverlaps("::/128", "::1/128")).toBe(false);
    });

    it("should handle documentation prefix (2001:db8::/32)", () => {
      expect(ipv6CidrOverlaps("2001:db8::/32", "2001:db8:1::/48")).toBe(true);
      expect(ipv6CidrOverlaps("2001:db8::/32", "2001:db9::/32")).toBe(false);
    });

    it("should handle unique local addresses (fc00::/7)", () => {
      expect(ipv6CidrOverlaps("fc00::/7", "fd00::/8")).toBe(true);
      expect(ipv6CidrOverlaps("fc00::/7", "fe00::/8")).toBe(false);
    });
  });

  describe("Invalid input handling", () => {
    it("should return false for invalid CIDR notation", () => {
      expect(ipv6CidrOverlaps("2001:db8::", "2001:db8::/64")).toBe(false);
      expect(ipv6CidrOverlaps("2001:db8::/64", "2001:db8::")).toBe(false);
      expect(ipv6CidrOverlaps("2001:db8::", "2001:db8::")).toBe(false);
    });

    it("should return false for invalid IPv6 addresses", () => {
      expect(ipv6CidrOverlaps("gggg::/64", "2001:db8::/64")).toBe(false);
      expect(ipv6CidrOverlaps("2001:db8::/64", "gggg::/64")).toBe(false);
    });

    it("should return false for invalid prefix lengths", () => {
      expect(ipv6CidrOverlaps("2001:db8::/129", "2001:db8::/64")).toBe(false);
      expect(ipv6CidrOverlaps("2001:db8::/64", "2001:db8::/-1")).toBe(false);
    });

    it("should return false for null or undefined", () => {
      expect(ipv6CidrOverlaps(null, "2001:db8::/64")).toBe(false);
      expect(ipv6CidrOverlaps("2001:db8::/64", null)).toBe(false);
      expect(ipv6CidrOverlaps(null, null)).toBe(false);
    });

    it("should return false for empty strings", () => {
      expect(ipv6CidrOverlaps("", "2001:db8::/64")).toBe(false);
      expect(ipv6CidrOverlaps("2001:db8::/64", "")).toBe(false);
      expect(ipv6CidrOverlaps("", "")).toBe(false);
    });

    it("should return false for IPv4 addresses", () => {
      expect(ipv6CidrOverlaps("10.0.0.0/24", "2001:db8::/64")).toBe(false);
      expect(ipv6CidrOverlaps("2001:db8::/64", "10.0.0.0/24")).toBe(false);
    });

    it("should return false for malformed compressed notation", () => {
      expect(ipv6CidrOverlaps("2001::db8::1/64", "2001:db8::/64")).toBe(false); // Multiple ::
      expect(ipv6CidrOverlaps(":::1/128", "::1/128")).toBe(false);
    });
  });

  describe("Edge cases with different prefix combinations", () => {
    it("should handle /56 networks correctly", () => {
      // /56 = 56 bits network, 72 bits host
      // First 56 bits of 2001:db8:0:: and 2001:db8:0:1:: are the same (both end at 4th group's high byte)
      // So 2001:db8:0:0::/56 and 2001:db8:0:1::/56 overlap
      expect(ipv6CidrOverlaps("2001:db8:0::/56", "2001:db8:0:1::/56")).toBe(true);
      // 2001:db8:0::/64 is contained in 2001:db8:0::/56
      expect(ipv6CidrOverlaps("2001:db8:0::/56", "2001:db8:0::/64")).toBe(true);
      // 2001:db8:0::/56 vs 2001:db8:1::/56 (different 3rd group) should not overlap
      expect(ipv6CidrOverlaps("2001:db8:0::/56", "2001:db8:1::/56")).toBe(false);
    });

    it("should handle /60 networks correctly", () => {
      // /60 = first 60 bits
      // fd00::/60 covers fd00:0:0:0:: through fd00:0:0:f::... (first 60 bits)
      // fd00:0:0:10:: has 4th group = 0x0010, binary: 0000 0000 0001 0000
      // First 60 bits end at the 4th nibble of 4th group
      // fd00:0:0:10::'s first 60 bits = fd00:0:0:1 (nibble)
      // fd00:0:0:0::'s first 60 bits = fd00:0:0:0 (nibble)
      // So they don't overlap
      expect(ipv6CidrOverlaps("fd00::/60", "fd00:0:0:10::/60")).toBe(false);
      expect(ipv6CidrOverlaps("fd00::/60", "fd00::/64")).toBe(true);
    });

    it("should handle /112 networks correctly", () => {
      // /112 gives 65536 addresses (last 16 bits are host)
      // fd02::/112 vs fd02::1:0/112
      // fd02:: = fd02:0:0:0:0:0:0:0
      // fd02::1:0 = fd02:0:0:0:0:0:1:0
      // First 112 bits of fd02:0:0:0:0:0:0:0 vs fd02:0:0:0:0:0:1:0 differ (7th group)
      expect(ipv6CidrOverlaps("fd02::/112", "fd02::1:0/112")).toBe(false);
      // fd02::/112 contains fd02::1/128 (within same /112 block)
      expect(ipv6CidrOverlaps("fd02::/112", "fd02::1/128")).toBe(true);
    });

    it("should handle /120 networks correctly", () => {
      // /120 gives 256 addresses (last 8 bits are host)
      // 2001:db8::100/120 vs 2001:db8::200/120
      // 0x0100 = 0000 0001 0000 0000, /120 keeps first 120 bits, so network is 2001:db8::100 (0x01 is network)
      // 0x0200 = 0000 0010 0000 0000, /120 network is 2001:db8::200 (0x02 is network)
      // Different networks
      expect(ipv6CidrOverlaps("2001:db8::100/120", "2001:db8::200/120")).toBe(false);
      // 2001:db8::100/120 contains 2001:db8::150/128?
      // 0x0100 to 0x01FF is the range for ::100/120
      // 0x0150 is within that range
      expect(ipv6CidrOverlaps("2001:db8::100/120", "2001:db8::150/128")).toBe(true);
    });
  });

  describe("Real-world OpenShift network configuration edge cases", () => {
    it("should detect overlap when user misconfigures service network inside machine network", () => {
      // Machine: fd00::/48 (covers fd00:0:0:: through fd00:0:ffff:...)
      // Service (wrong): fd00:0:0:1::/112 (within fd00::/48)
      expect(ipv6CidrOverlaps("fd00::/48", "fd00:0:0:1::/112")).toBe(true);
    });

    it("should detect overlap when user misconfigures pod network inside machine network", () => {
      // Machine: fd00::/48, Pod (wrong): fd00::/32 (contains machine network)
      expect(ipv6CidrOverlaps("fd00::/48", "fd00::/32")).toBe(true);
    });

    it("should allow valid OpenShift dual-stack network separation", () => {
      // Machine: fd01::/48
      // Service: fd02::/112
      // Pod: fd03::/48
      expect(ipv6CidrOverlaps("fd01::/48", "fd02::/112")).toBe(false);
      expect(ipv6CidrOverlaps("fd01::/48", "fd03::/48")).toBe(false);
      expect(ipv6CidrOverlaps("fd02::/112", "fd03::/48")).toBe(false);
    });

    it("should handle common ULA prefix allocation", () => {
      // RFC 4193 recommends /48 for sites
      // fd12:3456:7890::/48 vs fd12:3456:7891::/48 (different third group)
      expect(ipv6CidrOverlaps("fd12:3456:7890::/48", "fd12:3456:7891::/48")).toBe(false);
      // fd12:3456:7890::/48 vs fd12:3456:7890:1::/64 (fourth group is 1, within /48)
      expect(ipv6CidrOverlaps("fd12:3456:7890::/48", "fd12:3456:7890:1::/64")).toBe(true);
    });
  });

  describe("Large prefix values and edge boundaries", () => {
    it("should handle very specific /124 networks", () => {
      // /124 = 16 addresses
      expect(ipv6CidrOverlaps("2001:db8::0/124", "2001:db8::0/124")).toBe(true);
      expect(ipv6CidrOverlaps("2001:db8::0/124", "2001:db8::10/124")).toBe(false);
    });

    it("should handle /125 networks", () => {
      // /125 = 8 addresses
      expect(ipv6CidrOverlaps("fd00::0/125", "fd00::0/125")).toBe(true);
      expect(ipv6CidrOverlaps("fd00::0/125", "fd00::8/125")).toBe(false);
    });

    it("should handle maximum address space", () => {
      // ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff is the highest address
      expect(ipv6CidrOverlaps("ffff:ffff:ffff:ffff::/64", "ffff:ffff:ffff:ffff::/64")).toBe(true);
      expect(ipv6CidrOverlaps("ffff:ffff:ffff:ffff::/64", "ffff:ffff:ffff:fffe::/64")).toBe(false);
    });
  });
});
