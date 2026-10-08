/**
 * Operator Quick Pick — support-flip ATOMICITY tripwire (Tranche 3, §8).
 *
 * This file changes no behaviour. It exists because of an ordering constraint
 * the accepted 4.22 evidence states explicitly
 * (`docs/minor-release/4.22/ODF_OPERATOR_EVIDENCE_4.22.md` §4):
 *
 *   "removing `default` and adding the `4.22` rows must land in the same atomic
 *    enablement commit as widening SUPPORTED_MINORS. Adding rows first leaves
 *    the fallback live; removing `default` first breaks 4.20/4.21."
 *
 * The hazard (lesson L11): Quick Pick resolution is
 * `versionPicks?.[version] || versionPicks?.["default"] || picks`. The moment
 * 4.22 becomes supported without a `"4.22"` row, every ODF Quick Pick silently
 * serves the 4.21 package list — 11 packages instead of 12 — and the user
 * mirrors a set missing `ocs-tls-profiles` with no warning.
 *
 * Tranche 3 deliberately does NOT fix this: adding the rows now would leave the
 * fallback live for no benefit, and removing `default` now would break 4.20 and
 * 4.21. Both are forbidden by this tranche's scope. What Tranche 3 CAN do is
 * make the omission impossible to ship quietly — these assertions fail the
 * moment SUPPORTED_MINORS gains a minor that has no Quick Pick row, so the
 * enablement commit cannot be half-done.
 *
 * The existing `version-aware-operator-quick-picks.test.js` is no substitute: it
 * re-declares a MOCK scenarios array and asserts the fallback is correct
 * (lesson L10), so it would stay green with wrong rows. This file reads the
 * real module.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { SUPPORTED_MINORS } from "../src/shared/versionPolicy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, "..", "src", "steps", "OperatorsStep.jsx"), "utf8");

/**
 * Extract every `versionPicks: { ... }` block's declared version keys from the
 * real source. Parsing the source rather than importing avoids pulling the whole
 * step (and its API surface) into a data assertion.
 */
function versionPickBlocks() {
  const blocks = [];
  const re = /versionPicks:\s*\{/g;
  let m;
  while ((m = re.exec(SRC))) {
    let i = re.lastIndex;
    let depth = 1;
    while (i < SRC.length && depth > 0) {
      if (SRC[i] === "{") depth++;
      else if (SRC[i] === "}") depth--;
      i++;
    }
    const body = SRC.slice(re.lastIndex, i - 1);
    blocks.push({
      versions: [...body.matchAll(/"(\d+\.\d+)":/g)].map((x) => x[1]),
      hasDefault: /"default":/.test(body),
    });
  }
  return blocks;
}

describe("Quick Pick rows cover every supported minor", () => {
  const blocks = versionPickBlocks();

  it("finds the version-aware Quick Picks in the real source", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(5);
  });

  /**
   * A Quick Pick is "per-minor" when it declares at least one X.Y row — i.e. its
   * package list genuinely varies by OpenShift minor. `app-dev-suite` declares
   * only `default` on purpose: its packages do not vary, so `default` is the
   * correct and complete representation and it is not at risk.
   *
   * The dangerous state is the middle one: a pick that varies by minor but is
   * missing a SUPPORTED minor, because that silently serves another minor's list.
   */
  const perMinorBlocks = blocks
    .map((b, i) => ({ ...b, i }))
    .filter((b) => b.versions.length > 0);

  it("distinguishes per-minor Quick Picks from genuinely version-independent ones", () => {
    expect(perMinorBlocks.length).toBeGreaterThanOrEqual(4);
    expect(perMinorBlocks.length).toBeLessThan(blocks.length);
  });

  it.each(SUPPORTED_MINORS)(
    "every per-minor Quick Pick declares an explicit %s row",
    (minor) => {
      const missing = perMinorBlocks.filter((b) => !b.versions.includes(minor)).map((b) => b.i);
      expect(
        missing,
        `Quick Pick block(s) ${missing.join(", ")} vary by minor but have no "${minor}" row, so they would silently serve the "default" package list. ` +
          `Adding a supported minor REQUIRES adding its Quick Pick rows in the same commit (ODF_OPERATOR_EVIDENCE_4.22.md §4).`
      ).toEqual([]);
    }
  );

  it("does not yet declare a 4.22 row, because 4.22 is not yet supported", () => {
    // Not a style preference: a 4.22 row landing before the flip is the
    // "adding rows first leaves the fallback live" half-step the evidence
    // forbids. When 4.22 is enabled, this expectation flips together with
    // SUPPORTED_MINORS — which is the point.
    expect(SUPPORTED_MINORS).not.toContain("4.22");
    for (const b of blocks) expect(b.versions).not.toContain("4.22");
  });

  it("still carries the `default` key that 4.20 and 4.21 rely on", () => {
    // Removing `default` before the flip would break the supported minors.
    for (const b of blocks) expect(b.hasDefault).toBe(true);
  });

  it("the only Quick Pick without per-minor rows is one whose packages do not vary", () => {
    const flat = blocks.filter((b) => b.versions.length === 0);
    // Recorded rather than asserted by name: if a NEW pick appears with only a
    // `default`, that is a deliberate claim that its packages are
    // minor-independent, and it should be reviewed as such.
    expect(flat.every((b) => b.hasDefault)).toBe(true);
  });

  it("the resolution order that makes this load-bearing is unchanged", () => {
    expect(SRC).toMatch(/versionPicks\?\.\[version\]\s*\|\|\s*\w+\.versionPicks\?\.\["default"\]/);
  });
});
