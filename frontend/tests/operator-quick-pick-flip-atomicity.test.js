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
 * Tranche 5 performed that atomic flip: `default` is gone, every version-aware
 * Quick Pick declares an explicit row for every supported minor, and resolution
 * fails closed when a minor has no row. These assertions now guard the flip from
 * both sides — they fail if SUPPORTED_MINORS gains a minor with no Quick Pick
 * row, AND if `default` is ever reintroduced.
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
   * Post-flip every `versionPicks` block is per-minor. `default` is gone, so a
   * block that declared only `default` (`app-dev-suite`) would now resolve to
   * nothing at every minor; it declares explicit rows instead, even though its
   * package list does not vary.
   */
  const perMinorBlocks = blocks
    .map((b, i) => ({ ...b, i }))
    .filter((b) => b.versions.length > 0);

  it("every version-aware Quick Pick is declared per-minor, with no fallback block", () => {
    expect(perMinorBlocks.length).toBe(blocks.length);
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

  it("declares a 4.22 row, because 4.22 is supported", () => {
    // The other half of the atomic flip. 4.22 rows without support leave the
    // fallback live; support without 4.22 rows used to serve the 4.21 list.
    // Both halves are now asserted together, in both directions.
    expect(SUPPORTED_MINORS).toContain("4.22");
    for (const b of blocks) expect(b.versions).toContain("4.22");
  });

  it("carries no `default` key, so no minor can inherit another minor's list", () => {
    // The hazard this file was written for. `default` is what made a missing
    // row silently resolve to the previous minor's packages.
    for (const b of blocks) expect(b.hasDefault).toBe(false);
  });

  it("declares no row for a minor the product does not support", () => {
    // A row for an unsupported minor is dead weight at best and an implied
    // support claim at worst. Historical rows below the baseline are allowed:
    // they predate the supported window and are unreachable, not claims.
    const baseline = [...SUPPORTED_MINORS].sort()[0];
    for (const b of blocks) {
      const future = b.versions.filter((v) => v > baseline && !SUPPORTED_MINORS.includes(v));
      expect(future, `block declares rows for unsupported minor(s): ${future.join(", ")}`).toEqual([]);
    }
  });

  it("resolution has no `default` fallback left in the code either", () => {
    // Removing the data keys but keeping the fallback would re-arm the hazard
    // the moment anyone re-added a `default` row.
    expect(SRC).not.toMatch(/versionPicks\?\.\["default"\]/);
    expect(SRC).toMatch(/scenario\?\.versionPicks\) return scenario\.versionPicks\[minor\] \|\| null;/);
  });

  it("an undefined Quick Pick fails closed instead of serving another minor", () => {
    expect(SRC).toMatch(/is not defined for OpenShift/);
  });
});
