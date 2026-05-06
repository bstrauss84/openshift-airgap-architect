/**
 * OpenShift Airgap Architect - Input Formatting Utilities
 *
 * Formatting and normalization functions for IP addresses, MAC addresses, and CIDRs.
 * Ensures consistent input formatting across wizard steps.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * Format IPv4 CIDR input (trim only).
 * @param {string} value - Raw input
 * @returns {string}
 */
export function formatIpv4Cidr(value) {
  if (value == null || typeof value !== "string") return "";
  return value.trim();
}

/**
 * Format IPv6 CIDR input (trim only).
 * @param {string} value - Raw input
 * @returns {string}
 */
export function formatIpv6Cidr(value) {
  if (value == null || typeof value !== "string") return "";
  return value.trim();
}

/**
 * Normalize MAC address: accept with or without separators (colon, hyphen), return colon-separated lowercase (e.g. aa:bb:cc:dd:ee:ff).
 * Invalid or empty input is returned trimmed only.
 * @param {string} value - Raw input (e.g. "aa:bb:cc:dd:ee:ff" or "aabbccddeeff")
 * @returns {string}
 */
export function normalizeMAC(value) {
  if (value == null || typeof value !== "string") return "";
  const trimmed = value.trim().replace(/[\s\-:]/g, "").toLowerCase();
  if (!trimmed) return "";
  if (!/^[0-9a-f]+$/.test(trimmed) || trimmed.length !== 12) return value.trim();
  return [0, 2, 4, 6, 8, 10].map((i) => trimmed.slice(i, i + 2)).join(":");
}

/**
 * Format MAC as user types: hex chars get colons every 2 (e.g. aabbcc -> aa:bb:cc). Max 12 hex chars.
 * Use in onChange so separators are auto-inserted.
 * @param {string} value - Current input
 * @returns {string}
 */
export function formatMACAsYouType(value) {
  if (value == null || typeof value !== "string") return "";
  const hex = value.replace(/[^0-9a-fA-F]/g, "").toLowerCase().slice(0, 12);
  if (!hex) return "";
  const parts = [];
  for (let i = 0; i < hex.length; i += 2) {
    parts.push(hex.slice(i, i + 2));
  }
  return parts.join(":");
}
