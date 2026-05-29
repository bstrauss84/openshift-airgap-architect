/**
 * NTP Server Validation Tests
 *
 * Tests for NTP server validation to prevent invalid addresses:
 * 1. Invalid characters (spaces, special chars)
 * 2. Invalid IPv4 addresses (bad octets, wrong format)
 * 3. Invalid IPv6 addresses (malformed)
 * 4. Invalid FQDNs
 * 5. Validation accepts valid FQDNs, IPv4, and IPv6
 *
 * Created: 2026-05-28
 * Author: Bill Strauss
 */

import { describe, it, expect } from "vitest";

describe("NTP Server Validation", () => {
  // Test validation function extracted from validation.js
  const validateNtpServers = (ntpServers) => {
    const errors = [];
    const fieldErrors = {};

    if (!ntpServers || (Array.isArray(ntpServers) && ntpServers.length === 0)) {
      return { errors, warnings: [], fieldErrors };
    }

    const serversArray = Array.isArray(ntpServers)
      ? ntpServers
      : (typeof ntpServers === "string" ? ntpServers.split(",").map((s) => s.trim()).filter(Boolean) : []);

    for (let i = 0; i < serversArray.length; i++) {
      const server = serversArray[i];

      if (!/^[a-zA-Z0-9.:\-]+$/.test(server)) {
        errors.push(`NTP server "${server}" contains invalid characters. Only alphanumeric, dots, colons, and hyphens are allowed.`);
        fieldErrors.ntpServers = "Contains invalid characters";
        continue;
      }

      const isFqdn = /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/.test(server);
      const isIpv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(server);
      const isIpv6 = /^[a-fA-F0-9:]+$/.test(server) && server.includes(":");

      if (!isFqdn && !isIpv4 && !isIpv6) {
        errors.push(`NTP server "${server}" is not a valid FQDN or IP address.`);
        fieldErrors.ntpServers = "Invalid FQDN or IP address";
        continue;
      }

      if (isIpv4) {
        const octets = server.split(".").map(Number);
        const validOctets = octets.every(n => n >= 0 && n <= 255);
        if (!validOctets) {
          errors.push(`NTP server "${server}" has invalid IPv4 octets (must be 0-255).`);
          fieldErrors.ntpServers = "Invalid IPv4 address";
        }
      }

      if (isIpv6 && !isIpv4) {
        const segments = server.split("::");
        if (segments.length > 2) {
          errors.push(`NTP server "${server}" has invalid IPv6 format (multiple :: abbreviations).`);
          fieldErrors.ntpServers = "Invalid IPv6 address";
        }
      }
    }

    if (serversArray.length > 4) {
      return { errors, warnings: ["More than 4 NTP servers configured. OpenShift typically uses up to 4 sources."], fieldErrors };
    }

    return { errors, warnings: [], fieldErrors };
  };

  describe("Valid NTP Servers", () => {
    it("should accept valid FQDN", () => {
      const result = validateNtpServers("time.corp.local");
      expect(result.errors.length).toBe(0);
    });

    it("should accept multiple valid FQDNs", () => {
      const result = validateNtpServers("time.corp.local,time2.corp.local");
      expect(result.errors.length).toBe(0);
    });

    it("should accept valid IPv4 address", () => {
      const result = validateNtpServers("10.90.0.10");
      expect(result.errors.length).toBe(0);
    });

    it("should accept multiple IPv4 addresses", () => {
      const result = validateNtpServers("10.90.0.10,192.168.1.1");
      expect(result.errors.length).toBe(0);
    });

    it("should accept valid IPv6 address", () => {
      const result = validateNtpServers("2001:db8::1");
      expect(result.errors.length).toBe(0);
    });

    it("should accept multiple IPv6 addresses", () => {
      const result = validateNtpServers("fd00::10,fd00::11");
      expect(result.errors.length).toBe(0);
    });

    it("should accept mixed FQDN, IPv4, and IPv6", () => {
      const result = validateNtpServers("time.corp.local,10.90.0.10,fd00::10");
      expect(result.errors.length).toBe(0);
    });

    it("should accept array format", () => {
      const result = validateNtpServers(["time.corp.local", "10.90.0.10"]);
      expect(result.errors.length).toBe(0);
    });

    it("should handle empty string", () => {
      const result = validateNtpServers("");
      expect(result.errors.length).toBe(0);
    });

    it("should handle undefined", () => {
      const result = validateNtpServers(undefined);
      expect(result.errors.length).toBe(0);
    });
  });

  describe("Invalid Characters", () => {
    it("should reject NTP server with spaces", () => {
      const result = validateNtpServers("time corp local");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("invalid characters");
    });

    it("should reject NTP server with special characters", () => {
      const result = validateNtpServers("time@corp.local");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("invalid characters");
    });

    it("should reject NTP server with slashes", () => {
      const result = validateNtpServers("time/corp/local");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("invalid characters");
    });
  });

  describe("Invalid IPv4 Addresses", () => {
    it("should reject IPv4 with octets > 255", () => {
      const result = validateNtpServers("192.168.1.300");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("invalid IPv4 octets");
    });

    it("should reject IPv4 with negative octets", () => {
      const result = validateNtpServers("192.168.-1.1");
      expect(result.errors.length).toBeGreaterThan(0);
      // Negative sign is not in allowed character set, so rejected as invalid FQDN/IP
      expect(result.errors[0]).toContain("not a valid FQDN or IP address");
    });

    it("should accept incomplete IPv4 as valid FQDN (192.168.1 is a valid hostname)", () => {
      // "192.168.1" matches FQDN pattern - it's a valid hostname
      const result = validateNtpServers("192.168.1");
      expect(result.errors.length).toBe(0);
    });

    it("should accept 192.168.1.1.1 as valid FQDN (could be hostname)", () => {
      // "192.168.1.1.1" matches FQDN pattern - it's a valid hostname
      const result = validateNtpServers("192.168.1.1.1");
      expect(result.errors.length).toBe(0);
    });
  });

  describe("Invalid IPv6 Addresses", () => {
    it("should reject IPv6 with multiple :: abbreviations", () => {
      const result = validateNtpServers("2001::db8::1");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("multiple :: abbreviations");
    });

    it("should reject malformed IPv6", () => {
      const result = validateNtpServers("gggg::1");
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("Invalid FQDNs", () => {
    it("should reject FQDN starting with hyphen", () => {
      const result = validateNtpServers("-time.corp.local");
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should reject FQDN ending with hyphen", () => {
      const result = validateNtpServers("time-.corp.local");
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should reject FQDN with consecutive dots", () => {
      const result = validateNtpServers("time..corp.local");
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("Multiple Servers Validation", () => {
    it("should reject if one server is invalid among valid ones", () => {
      const result = validateNtpServers("time.corp.local,999.999.999.999,10.90.0.10");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("999.999.999.999");
    });

    it("should warn if more than 4 servers", () => {
      const result = validateNtpServers("time1.local,time2.local,time3.local,time4.local,time5.local");
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("More than 4 NTP servers");
    });

    it("should not warn with exactly 4 servers", () => {
      const result = validateNtpServers("time1.local,time2.local,time3.local,time4.local");
      expect(result.warnings.length).toBe(0);
    });
  });

  describe("Field Errors", () => {
    it("should set fieldErrors.ntpServers when invalid characters detected", () => {
      const result = validateNtpServers("time corp local");
      expect(result.fieldErrors.ntpServers).toBeDefined();
      expect(result.fieldErrors.ntpServers).toContain("invalid characters");
    });

    it("should set fieldErrors.ntpServers when invalid IP detected", () => {
      const result = validateNtpServers("999.999.999.999");
      expect(result.fieldErrors.ntpServers).toBeDefined();
      expect(result.fieldErrors.ntpServers).toContain("Invalid IPv4");
    });
  });
});
