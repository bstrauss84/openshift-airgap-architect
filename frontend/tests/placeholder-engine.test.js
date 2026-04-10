import { describe, it, expect } from "vitest";
import {
  buildPlaceholderEntry,
  countPlaceholders,
  isPlaceholderToken,
  registerPlaceholderEntry
} from "../src/placeholderEngine.js";

describe("placeholderEngine", () => {
  it("creates typed placeholder token and metadata", () => {
    const entry = buildPlaceholderEntry({ type: "hostname", label: "Host name" });
    expect(isPlaceholderToken(entry.token)).toBe(true);
    expect(entry.metadata.displayLabel).toBe("Host name");
    expect(entry.metadata.reviewRequired).toBe(true);
  });

  it("registers placeholders and counts nested placeholder values", () => {
    const state = { placeholders: { entries: {} } };
    const entry = buildPlaceholderEntry({ type: "ipAddress", label: "Node IP" });
    const placeholders = registerPlaceholderEntry(state, entry);
    const count = countPlaceholders({
      hostInventory: { nodes: [{ primary: { ipv4Cidr: entry.token } }] }
    });
    expect(placeholders.entries[entry.token]).toBeDefined();
    expect(count).toBe(1);
  });
});
