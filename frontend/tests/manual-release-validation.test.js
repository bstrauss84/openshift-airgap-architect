import { describe, it, expect } from "vitest";
import { validateManualOpenShiftRelease } from "../src/validation.js";

describe("validateManualOpenShiftRelease", () => {
  it("accepts aligned minor and patch", () => {
    const r = validateManualOpenShiftRelease("4.17", "4.17.12");
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects patch not under minor", () => {
    const r = validateManualOpenShiftRelease("4.17", "4.18.1");
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("rejects invalid minor shape", () => {
    expect(validateManualOpenShiftRelease("417", "4.17.1").ok).toBe(false);
    expect(validateManualOpenShiftRelease("4.x", "4.x.1").ok).toBe(false);
  });

  it("rejects invalid patch shape", () => {
    expect(validateManualOpenShiftRelease("4.17", "4.17").ok).toBe(false);
    expect(validateManualOpenShiftRelease("4.17", "v4.17.1").ok).toBe(false);
  });
});
