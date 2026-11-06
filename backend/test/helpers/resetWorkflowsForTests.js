/**
 * Test-only reset of the Mirroring slice (v2.3.0 R1).
 *
 * The public POST /api/mirroring/start-over is retired (410 Gone, non-mutating):
 * a global, UI-less reset is not part of the product. Tests still need a clean
 * slate, so they use this in-process hook, which exists only when
 * NODE_ENV === "test" and is never reachable over HTTP.
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { __testHooks } from "../../src/index.js";

export const resetMirroringForTests = async () => {
  if (!__testHooks) throw new Error("resetMirroringForTests needs NODE_ENV=test");
  return __testHooks.resetMirroringSlice();
};

export const resetUpgradeForTests = async () => {
  if (!__testHooks) throw new Error("resetUpgradeForTests needs NODE_ENV=test");
  return __testHooks.resetUpgradeSlice ? __testHooks.resetUpgradeSlice() : null;
};
