/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * A1: Format helpers for IP and MAC (normalize on blur).
 */

import { describe, it, expect } from "vitest";
import {
  formatIpv4Cidr,
  formatIpv6Cidr,
  normalizeMAC,
  formatMACAsYouType
} from "../src/formatUtils.js";

describe("formatIpv4Cidr", () => {
  it("trims whitespace", () => {
    expect(formatIpv4Cidr("  10.0.0.0/24  ")).toBe("10.0.0.0/24");
  });
  it("returns empty string for null or non-string", () => {
    expect(formatIpv4Cidr(null)).toBe("");
    expect(formatIpv4Cidr(undefined)).toBe("");
  });
});

describe("formatIpv6Cidr", () => {
  it("trims whitespace", () => {
    expect(formatIpv6Cidr("  fd10::/64  ")).toBe("fd10::/64");
  });
});

describe("normalizeMAC", () => {
  it("returns colon-separated lowercase when given 12 hex without separators", () => {
    expect(normalizeMAC("aabbccddeeff")).toBe("aa:bb:cc:dd:ee:ff");
    expect(normalizeMAC("AA:BB:CC:DD:EE:FF")).toBe("aa:bb:cc:dd:ee:ff");
  });
  it("accepts hyphen and normalizes to colon", () => {
    expect(normalizeMAC("aa-bb-cc-dd-ee-ff")).toBe("aa:bb:cc:dd:ee:ff");
  });
  it("returns trimmed only when not 12 hex chars after stripping", () => {
    expect(normalizeMAC("short")).toBe("short");
    expect(normalizeMAC("aabbccddeefff")).toBe("aabbccddeefff");
  });
  it("returns empty when input empty", () => {
    expect(normalizeMAC("")).toBe("");
  });
});

describe("formatMACAsYouType", () => {
  it("inserts colons every 2 hex chars", () => {
    expect(formatMACAsYouType("aa")).toBe("aa");
    expect(formatMACAsYouType("aabb")).toBe("aa:bb");
    expect(formatMACAsYouType("aabbccddeeff")).toBe("aa:bb:cc:dd:ee:ff");
  });
  it("strips non-hex and caps at 12", () => {
    expect(formatMACAsYouType("aabbccddeeff001122")).toBe("aa:bb:cc:dd:ee:ff");
  });
  it("preserves pasted formatted MAC (with colons or hyphens)", () => {
    expect(formatMACAsYouType("aa:bb:cc:dd:ee:ff")).toBe("aa:bb:cc:dd:ee:ff");
    expect(formatMACAsYouType("AA-BB-CC-DD-EE-FF")).toBe("aa:bb:cc:dd:ee:ff");
  });
});
