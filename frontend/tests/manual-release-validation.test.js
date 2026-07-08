import { describe, it, expect } from "vitest";
import { validateManualOpenShiftRelease } from "../src/validation.js";

describe("validateManualOpenShiftRelease", () => {
  it("accepts aligned 4.20 minor and patch", () => {
    const r = validateManualOpenShiftRelease("4.20", "4.20.12");
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("accepts aligned 4.21 minor and patch", () => {
    const r = validateManualOpenShiftRelease("4.21", "4.21.5");
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects 4.17 as outside product support", () => {
    const r = validateManualOpenShiftRelease("4.17", "4.17.12");
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]).toContain("4.17");
    expect(r.errors[0]).toContain("not supported");
  });

  it("rejects 4.22 as unsupported", () => {
    const r = validateManualOpenShiftRelease("4.22", "4.22.0");
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]).toContain("4.22");
    expect(r.errors[0]).toContain("not supported");
  });

  it("rejects patch not under minor", () => {
    const r = validateManualOpenShiftRelease("4.20", "4.21.1");
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("rejects invalid minor shape", () => {
    expect(validateManualOpenShiftRelease("420", "4.20.1").ok).toBe(false);
    expect(validateManualOpenShiftRelease("4.x", "4.x.1").ok).toBe(false);
  });

  it("rejects invalid patch shape", () => {
    expect(validateManualOpenShiftRelease("4.20", "4.20").ok).toBe(false);
    expect(validateManualOpenShiftRelease("4.20", "v4.20.1").ok).toBe(false);
  });
});
