/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, expect } from "vitest";
import { getDeterministicProgress, DURATION_MS } from "../src/catalogScanProgress.js";

describe("getDeterministicProgress", () => {
  it("0ms => 0", () => {
    expect(getDeterministicProgress(0)).toBe(0);
  });

  it("360000ms (6 min) => 95", () => {
    expect(getDeterministicProgress(360_000)).toBe(95);
  });

  it("359999ms => 90 (must NOT reach 95 early)", () => {
    expect(getDeterministicProgress(359_999)).toBe(90);
  });

  it(">360000ms => 95 (holds at 95 until complete)", () => {
    expect(getDeterministicProgress(360_001)).toBe(95);
    expect(getDeterministicProgress(600_000)).toBe(95);
  });

  it("negative elapsed => 0", () => {
    expect(getDeterministicProgress(-1)).toBe(0);
  });

  it("mid-point ~3 min => 47 or 50 (step boundary)", () => {
    const at3min = getDeterministicProgress(180_000);
    expect(at3min).toBeGreaterThanOrEqual(45);
    expect(at3min).toBeLessThanOrEqual(50);
  });
});

/**
 * Manual verification: deterministic progress per catalog
 * 1. Start a Prefetch catalogs (or lock with pull secret to trigger scan).
 * 2. Confirm all three rows (Red Hat, Certified, Community) show "running" and % increasing in 5% steps.
 * 3. After ~6 min each row should sit at 95% until that catalog’s backend job completes.
 * 4. When one catalog completes, only that row jumps to 100%; others stay at their current % or 95%.
 * 5. If one catalog fails, only that row shows failed; others keep updating until they complete or fail.
 */
