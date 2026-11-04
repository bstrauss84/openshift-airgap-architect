/**
 * F12 (v2.2.0 M5) — parallel images / layers offered and accepted only within
 * the range the shipped oc-mirror binary accepts (1–10), not 1–32.
 *
 * Exact-binary evidence (oc-mirror 4.22.19, clients/ocp/latest, binary sha256
 * 55b55cf1…, re-probed 2026-10-27): 0, 11 and 32 are refused before any
 * network access with "the flag parallel-images must be between the range 1
 * to 10" (likewise parallel-layers); 10 is accepted.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { OC_MIRROR_CLI_LIMITS, isWithinCliLimit, cliLimitMessage } from "../../shared/ocMirrorCliLimits.js";
import { ocMirrorPreflightSchema, ocMirrorRunSchema, mirroringProfileWriteSchema } from "../src/schemas.js";

describe("F12 — oc-mirror parallelism limits", () => {
  test("the shared limits are the probed 1–10, with the binary's own defaults", () => {
    assert.deepEqual({ ...OC_MIRROR_CLI_LIMITS.parallelImages }, { flag: "--parallel-images", min: 1, max: 10, default: 4 });
    assert.deepEqual({ ...OC_MIRROR_CLI_LIMITS.parallelLayers }, { flag: "--parallel-layers", min: 1, max: 10, default: 5 });
    assert.equal(isWithinCliLimit("parallelImages", 10), true);
    assert.equal(isWithinCliLimit("parallelImages", 11), false);
    assert.equal(isWithinCliLimit("parallelLayers", 0), false);
    assert.equal(isWithinCliLimit("parallelLayers", 2.5), false);
    assert.equal(cliLimitMessage("parallelImages", "Parallel images"), "Parallel images must be a whole number from 1 to 10.");
  });

  for (const [name, schema] of [["preflight", ocMirrorPreflightSchema], ["run", ocMirrorRunSchema]]) {
    test(`${name} schema: 10 accepted, 11 and 32 refused (was 1–32)`, () => {
      for (const key of ["parallelImages", "parallelLayers"]) {
        assert.equal(schema.safeParse({ advanced: { [key]: 10 } }).success, true);
        assert.equal(schema.safeParse({ advanced: { [key]: 11 } }).success, false);
        assert.equal(schema.safeParse({ advanced: { [key]: 32 } }).success, false);
        assert.equal(schema.safeParse({ advanced: { [key]: 0 } }).success, false);
      }
    });
  }

  test("Mirroring profile run options follow the same limits", () => {
    assert.equal(mirroringProfileWriteSchema.safeParse({ execution: { options: { parallelImages: 10, parallelLayers: 1 } } }).success, true);
    assert.equal(mirroringProfileWriteSchema.safeParse({ execution: { options: { parallelImages: 16 } } }).success, false);
  });
});
