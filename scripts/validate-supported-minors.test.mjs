/**
 * Tests for scripts/validate-supported-minors.mjs (cumulative-support guards).
 *
 * Each case builds a throwaway tree with its own versionPolicy modules and
 * support record, so the guards are exercised against states the real
 * repository must never be in. The real repository is checked once at the end.
 * No network access.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateSupportedMinors } from "./validate-supported-minors.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

function policyModule(minors) {
  return `const SUPPORTED_MINORS = Object.freeze(${JSON.stringify(minors)});\nexport { SUPPORTED_MINORS };\n`;
}

/**
 * @param {object} opts
 * @param {string[]} opts.backend
 * @param {string[]} [opts.frontend] defaults to backend
 * @param {string[]} [opts.previouslyReleased] defaults to ["4.20","4.21"]
 * @param {string} [opts.baselineMinor] defaults to "4.20"
 */
function fixture({ backend, frontend = backend, previouslyReleased = ["4.20", "4.21"], baselineMinor = "4.20" }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-minors-"));
  const write = (rel, body) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, "utf-8");
  };
  // Unique filenames per fixture would be ideal, but ESM caches by URL and each
  // mkdtemp root is unique, so each fixture's modules import fresh.
  write("backend/src/versionPolicy.js", policyModule(backend));
  write("frontend/src/shared/versionPolicy.js", policyModule(frontend));
  write(
    "scripts/lib/released-minor-support.json",
    JSON.stringify({ baselineMinor, previouslyReleasedMinors: previouslyReleased }, null, 2)
  );
  return root;
}

function failed(result, id) {
  return result.checks.find((c) => c.id === id)?.ok === false;
}

describe("cumulative minor-support guards", () => {
  test("passes for the current shipped state (4.20, 4.21)", async () => {
    const r = await validateSupportedMinors(fixture({ backend: ["4.20", "4.21"] }));
    assert.strictEqual(r.ok, true, r.errors.join("\n"));
  });

  test("passes when a minor is ADDED (widening is expected)", async () => {
    const r = await validateSupportedMinors(
      // Widening must record the minor too (G3); recording it here is the
      // point of the invariant, not a weakening of this test.
      fixture({ backend: ["4.20", "4.21", "4.22"], previouslyReleased: ["4.20", "4.21", "4.22"] })
    );
    assert.strictEqual(r.ok, true, r.errors.join("\n"));
  });

  describe("superset / cumulative guard", () => {
    test("FAILS when an already-released minor is dropped", async () => {
      // The exact regression the rule exists to prevent: onboarding 4.22 by
      // replacing 4.20 rather than adding to it.
      const r = await validateSupportedMinors(
        fixture({ backend: ["4.21", "4.22"], previouslyReleased: ["4.20", "4.21"], baselineMinor: "4.20" })
      );
      assert.strictEqual(r.ok, false);
      assert.ok(failed(r, "cumulative-superset"));
      assert.match(r.errors.join("\n"), /CUMULATIVE SUPPORT VIOLATION/);
      assert.match(r.errors.join("\n"), /4\.20/);
    });

    test("FAILS when the oldest minor is dropped even if the baseline moves with it", async () => {
      const r = await validateSupportedMinors(
        fixture({ backend: ["4.21", "4.22"], previouslyReleased: ["4.20", "4.21"], baselineMinor: "4.21" })
      );
      assert.strictEqual(r.ok, false, "a consistent-looking retirement is still a retirement");
      assert.ok(failed(r, "cumulative-superset"));
    });
  });

  describe("bidirectional support-metadata invariant (G3)", () => {
    test("FAILS when code supports a minor the record omits", async () => {
      const r = await validateSupportedMinors(fixture({ backend: ["4.20", "4.21", "4.22"], frontend: ["4.20", "4.21", "4.22"], previouslyReleased: ["4.20", "4.21"] }));
      assert.equal(r.ok, false);
      assert.match(r.errors.join("\n"), /SUPPORT METADATA INCOMPLETE/);
      assert.match(r.errors.join("\n"), /4\.22/);
    });

    test("FAILS when the record claims a minor the code does not support", async () => {
      const r = await validateSupportedMinors(fixture({ backend: ["4.20", "4.21"], frontend: ["4.20", "4.21"], previouslyReleased: ["4.20", "4.21", "4.22"] }));
      assert.equal(r.ok, false);
      assert.match(r.errors.join("\n"), /CUMULATIVE SUPPORT VIOLATION/);
    });

    test("FAILS when a currently supported minor disappears from the record", async () => {
      const r = await validateSupportedMinors(fixture({ backend: ["4.20", "4.21"], frontend: ["4.20", "4.21"], previouslyReleased: ["4.20"] }));
      assert.equal(r.ok, false);
      assert.match(r.errors.join("\n"), /SUPPORT METADATA INCOMPLETE/);
    });

    test("FAILS when a currently supported minor disappears from the code", async () => {
      const r = await validateSupportedMinors(fixture({ backend: ["4.20"], frontend: ["4.20"], previouslyReleased: ["4.20", "4.21"] }));
      assert.equal(r.ok, false);
      assert.match(r.errors.join("\n"), /CUMULATIVE SUPPORT VIOLATION/);
    });

    test("FAILS on a duplicate record entry", async () => {
      const r = await validateSupportedMinors(fixture({ backend: ["4.20", "4.21"], frontend: ["4.20", "4.21"], previouslyReleased: ["4.20", "4.21", "4.21"] }));
      assert.equal(r.ok, false);
      assert.match(r.errors.join("\n"), /Duplicate entry in previouslyReleasedMinors/);
    });

    test("FAILS on a malformed record entry", async () => {
      const r = await validateSupportedMinors(fixture({ backend: ["4.20", "4.21"], frontend: ["4.20", "4.21"], previouslyReleased: ["4.20", "4.21", "latest"] }));
      assert.equal(r.ok, false);
      assert.match(r.errors.join("\n"), /Malformed entry in previouslyReleasedMinors/);
    });

    test("PASSES for a complete, coherent flip — the invariant is not vacuous", async () => {
      const r = await validateSupportedMinors(fixture({ backend: ["4.20", "4.21", "4.22"], frontend: ["4.20", "4.21", "4.22"], previouslyReleased: ["4.20", "4.21", "4.22"] }));
      assert.equal(r.ok, true, JSON.stringify(r.errors));
    });

    test("PASSES for the current pre-flip state", async () => {
      const r = await validateSupportedMinors(fixture({ backend: ["4.20", "4.21"], frontend: ["4.20", "4.21"], previouslyReleased: ["4.20", "4.21"] }));
      assert.equal(r.ok, true, JSON.stringify(r.errors));
    });
  });

  describe("baseline guard", () => {
    test("FAILS when SUPPORTED_MINORS[0] no longer equals the recorded baseline", async () => {
      const r = await validateSupportedMinors(
        fixture({ backend: ["4.21", "4.22"], previouslyReleased: ["4.21"], baselineMinor: "4.20" })
      );
      assert.strictEqual(r.ok, false);
      assert.ok(failed(r, "baseline-minor"));
      assert.match(r.errors.join("\n"), /BASELINE VIOLATION/);
    });

    test("passes when the baseline is retained at the head of a widened list", async () => {
      const r = await validateSupportedMinors(
        fixture({ backend: ["4.20", "4.21", "4.22"], previouslyReleased: ["4.20", "4.21", "4.22"], baselineMinor: "4.20" })
      );
      assert.strictEqual(r.ok, true, r.errors.join("\n"));
    });
  });

  describe("backend/frontend agreement", () => {
    test("FAILS when the two hand-synchronized declarations diverge", async () => {
      const r = await validateSupportedMinors(
        fixture({ backend: ["4.20", "4.21", "4.22"], frontend: ["4.20", "4.21"] })
      );
      assert.strictEqual(r.ok, false);
      assert.ok(failed(r, "fe-be-agreement"));
      assert.match(r.errors.join("\n"), /differs between backend and frontend/);
    });
  });

  describe("well-formedness", () => {
    test("FAILS on descending order (index 0 is semantically the baseline)", async () => {
      const r = await validateSupportedMinors(
        fixture({ backend: ["4.21", "4.20"], baselineMinor: "4.21" })
      );
      assert.strictEqual(r.ok, false);
      assert.ok(failed(r, "well-formed"));
      assert.match(r.errors.join("\n"), /must be ascending/);
    });

    test("FAILS on duplicates", async () => {
      const r = await validateSupportedMinors(
        fixture({ backend: ["4.20", "4.20", "4.21"], previouslyReleased: ["4.20", "4.21"] })
      );
      assert.strictEqual(r.ok, false);
      assert.ok(failed(r, "well-formed"));
    });

    test("FAILS on a malformed entry", async () => {
      const r = await validateSupportedMinors(
        fixture({ backend: ["4.20", "4.21", "latest"], previouslyReleased: ["4.20", "4.21"] })
      );
      assert.strictEqual(r.ok, false);
      assert.ok(failed(r, "well-formed"));
    });

    test("sorts numerically, not lexically (4.9 before 4.21 would be wrong)", async () => {
      const r = await validateSupportedMinors(
        fixture({ backend: ["4.9", "4.21"], previouslyReleased: ["4.9", "4.21"], baselineMinor: "4.9" })
      );
      assert.strictEqual(r.ok, true, `numeric ordering expected: ${r.errors.join("\n")}`);
    });
  });

  test("live repository: 4.20, 4.21 and 4.22 supported, 4.20 is still the baseline", async () => {
    const r = await validateSupportedMinors(REPO_ROOT);
    assert.strictEqual(r.ok, true, r.errors.join("\n"));
    assert.deepStrictEqual([...r.supported], ["4.20", "4.21", "4.22"]);
    // The version-awareness baseline is a separate, human-owned decision and
    // deliberately did NOT move with the 4.22 flip: a field introduced in 4.21
    // must still show no "New in OpenShift" badge at 4.22.
    assert.strictEqual(r.baselineMinor, "4.20");
    assert.ok(!r.supported.includes("4.23"), "4.23 must remain unsupported");
  });
});

/* ------------------------------------------------------------------ */
/* No implicit supported-minor default (v2.1 Tranche 7C.1)              */
/* ------------------------------------------------------------------ */

describe("no implicit supported-minor default in production source", () => {
  /**
   * The check this exercises exists because `version = '4.20'` default
   * parameters and `getOpenShiftMinorFromState(state) || '4.20'` fallbacks were
   * invisible while catalogs were bundled eagerly, then became a cold-start
   * CatalogNotLoadedError once catalogs were lazy-loaded per minor — and were a
   * No Fallback Rule violation the whole time.
   */
  test("the tracked tree is clean", async () => {
    const r = await validateSupportedMinors(REPO_ROOT);
    const check = r.checks.find((c) => c.id === "no-implicit-minor-default");
    assert.ok(check, "the no-implicit-minor-default check did not run");
    assert.strictEqual(
      check.ok,
      true,
      `implicit minor defaults found:\n${r.errors.filter((e) => /hardcoded OpenShift minor/.test(e)).join("\n")}`
    );
  });

  test("a reintroduced default parameter fails the guard", async () => {
    const root = fixture({ backend: ["4.20", "4.21", "4.22"], previouslyReleased: ["4.20", "4.21", "4.22"] });
    const target = path.join(root, "frontend", "src", "regression-probe.js");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "export function read(id, version = '4.20') { return [id, version]; }\n");
    const r = await validateSupportedMinors(root);
    const check = r.checks.find((c) => c.id === "no-implicit-minor-default");
    assert.strictEqual(check.ok, false, "a `version = '4.20'` default parameter was not detected");
  });

  test("a reintroduced `|| \"4.20\"` fallback fails the guard", async () => {
    const root = fixture({ backend: ["4.20", "4.21", "4.22"], previouslyReleased: ["4.20", "4.21", "4.22"] });
    const target = path.join(root, "frontend", "src", "regression-probe.js");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'export const m = getOpenShiftMinorFromState(s) || "4.20";\n');
    const r = await validateSupportedMinors(root);
    const check = r.checks.find((c) => c.id === "no-implicit-minor-default");
    assert.strictEqual(check.ok, false, 'a `|| "4.20"` fallback was not detected');
  });

  test("a fallback AFTER a URL on the same line fails the guard (DOC-203)", async () => {
    // The comment stripper used to cut at the `//` of `https://`, so a fallback
    // later on that line was never seen. DOC-203's fifth site hid exactly so.
    const root = fixture({ backend: ["4.20", "4.21", "4.22"], previouslyReleased: ["4.20", "4.21", "4.22"] });
    const target = path.join(root, "frontend", "src", "regression-probe.js");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'export const href = `https://docs.example/${(v || "4.0").slice(0, 3)}/x`;\n');
    const r = await validateSupportedMinors(root);
    const check = r.checks.find((c) => c.id === "no-implicit-minor-default");
    assert.strictEqual(check.ok, false, "a fallback following a URL scheme was not detected");
  });

  test("a trailing comment after code still does not trip the guard", async () => {
    const root = fixture({ backend: ["4.20", "4.21", "4.22"], previouslyReleased: ["4.20", "4.21", "4.22"] });
    const target = path.join(root, "frontend", "src", "regression-probe.js");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "export const x = 1; // formerly `|| '4.20'`\n");
    const r = await validateSupportedMinors(root);
    const check = r.checks.find((c) => c.id === "no-implicit-minor-default");
    assert.strictEqual(check.ok, true, "a trailing comment was treated as a defect");
  });

  test("a comment mentioning the old default does not trip the guard", async () => {
    // The production files explain the defect by name; explanation is not a defect.
    const root = fixture({ backend: ["4.20", "4.21", "4.22"], previouslyReleased: ["4.20", "4.21", "4.22"] });
    const target = path.join(root, "frontend", "src", "regression-probe.js");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "// This used to read `version = '4.20'`, which was the bug.\nexport const x = 1;\n");
    const r = await validateSupportedMinors(root);
    const check = r.checks.find((c) => c.id === "no-implicit-minor-default");
    assert.strictEqual(check.ok, true, "a comment was treated as a defect");
  });
});
