/**
 * Unit tests for canonical OCP minor derivation (operator catalog tags).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getOpenShiftMinorFromSources, getOpenShiftMinorFromState } from "../src/openShiftMinor.js";

describe("openShiftMinor", () => {
  it("uses release.channel when set (minor only)", () => {
    assert.strictEqual(getOpenShiftMinorFromSources({ channel: "4.21", patchVersion: "4.20.1" }, {}), "4.21");
  });

  it("strips stable- prefix on channel", () => {
    assert.strictEqual(getOpenShiftMinorFromSources({ channel: "stable-4.20" }, {}), "4.20");
  });

  it("derives from patchVersion when channel missing", () => {
    assert.strictEqual(getOpenShiftMinorFromSources({ channel: null, patchVersion: "4.21.9" }, {}), "4.21");
  });

  it("derives from version.selectedVersion when channel missing", () => {
    assert.strictEqual(getOpenShiftMinorFromSources({ channel: "" }, { selectedVersion: "4.18.12" }), "4.18");
  });

  it("returns null when nothing usable is present", () => {
    assert.strictEqual(getOpenShiftMinorFromSources({ channel: null, patchVersion: null }, {}), null);
    assert.strictEqual(getOpenShiftMinorFromSources({ channel: "null", patchVersion: null }, {}), null);
  });

  it("ignores literal string channel null when patchVersion is set", () => {
    assert.strictEqual(getOpenShiftMinorFromSources({ channel: "null", patchVersion: "4.18.12" }, {}), "4.18");
  });

  it("getOpenShiftMinorFromState reads nested state", () => {
    assert.strictEqual(
      getOpenShiftMinorFromState({
        release: { channel: null, patchVersion: "4.20.3" },
        version: {}
      }),
      "4.20"
    );
  });
});
