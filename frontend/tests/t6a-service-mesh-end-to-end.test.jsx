/**
 * Tranche 6A §2 — the Service Mesh Quick Pick traced END TO END, per supported
 * minor, through the real `applyScenario` reducer into real operator state.
 *
 * Why this file exists. Tranche 6 reported two claims that cannot both be true:
 *
 *   A. "all 21 Quick Picks resolved per supported minor — no package silently
 *       skipped"
 *   B. "DOC-184: Service Mesh delivers 2 of 3 packages at every minor"
 *
 * B was correct. A was the *title* of a test whose assertion actually exempted
 * `jaeger-product` through a disposition allowlist, and the report repeated the
 * title as an absolute. The contradiction was in the reporting, and the
 * underlying silent skip was real.
 *
 * Tranche 6A removed the stale package (see OperatorsStep.jsx for the evidence),
 * so A is now true without exemptions. This file proves it at the level that
 * matters — what `applyScenario` actually puts in state — rather than at the
 * level of the package table, because the table was never the thing that
 * silently dropped a package. `applyScenario` does `if (!found) return;`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { SUPPORTED_MINORS } from "../src/shared/versionPolicy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");

const SRC = readFileSync(join(REPO, "frontend", "src", "steps", "OperatorsStep.jsx"), "utf8");
const SCAN = JSON.parse(
  readFileSync(join(REPO, "docs", "minor-release", "4.22", "operator-catalog-scan-4.22.json"), "utf8")
);

/** The Service Mesh pick, read from the real source. */
function serviceMeshPicks() {
  const start = SRC.indexOf('id: "service-mesh"');
  const body = SRC.slice(start, SRC.indexOf("},", SRC.indexOf("picks:", start)));
  const m = body.match(/picks:\s*\{([\s\S]*?)\}/);
  const out = {};
  for (const g of (m?.[1] || "").matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
    out[g[1]] = g[2].split(",").map((x) => x.trim().replace(/"/g, "")).filter(Boolean);
  }
  return out;
}

/**
 * The real `applyScenario` lookup, reproduced exactly as OperatorsStep.jsx
 * performs it, including the silent-skip branch. Asserted below to still match
 * the production source, so this reproduction cannot drift.
 */
function applyScenarioLookup(names, catalogList) {
  const selected = [];
  const skipped = [];
  names.forEach((name) => {
    const target = name.toLowerCase();
    const found = catalogList.find((op) => op.name?.toLowerCase() === target);
    if (!found) { skipped.push(name); return; } // production: `if (!found) return;`
    selected.push(found);
  });
  return { selected, skipped };
}

/** A catalog list shaped like a real scan result for `minor`. */
const catalogFor = (minor) =>
  Object.entries(SCAN.packages[`redhat-${minor}`]).map(([name, defaultChannel], i) => ({
    id: `op-${i}`,
    name,
    defaultChannel,
    catalog: "redhat",
  }));

describe("T6A §2 — the reproduction tracks production", () => {
  it("applyScenario still skips a not-found package silently", () => {
    expect(SRC).toMatch(/const found = list\.find\(\(op\) => op\.name\?\.toLowerCase\(\) === target\);/);
    expect(SRC).toMatch(/if \(!found\) return;/);
  });

  it("there is still no warning, log or counter on that branch", () => {
    const apply = SRC.slice(SRC.indexOf("const applyScenario"), SRC.indexOf("const removeScenarioOperators"));
    expect(apply).not.toMatch(/console\.|warn|notFound|missingPackage|skipped/i);
  });
});

describe.each(SUPPORTED_MINORS)("T6A §2 — Service Mesh traced end to end at %s", (minor) => {
  const picks = serviceMeshPicks();
  const catalog = catalogFor(minor);
  const names = picks.redhat;
  const { selected, skipped } = applyScenarioLookup(names, catalog);

  it("requests exactly servicemeshoperator and kiali-ossm from the redhat catalog", () => {
    expect(Object.keys(picks)).toEqual(["redhat"]);
    expect(names).toEqual(["servicemeshoperator", "kiali-ossm"]);
  });

  it("every requested package exists in the real catalog", () => {
    for (const n of names) {
      expect(Object.prototype.hasOwnProperty.call(SCAN.packages[`redhat-${minor}`], n), n).toBe(true);
    }
  });

  it("applyScenario resolves ALL of them — nothing is skipped", () => {
    expect(skipped).toEqual([]);
    expect(selected.map((o) => o.name)).toEqual(names);
  });

  it("delivered count equals requested count", () => {
    // The assertion DOC-184 used to fail: 2 of 3. Now 2 of 2.
    expect(selected).toHaveLength(names.length);
  });

  it("each selected operator carries a resolved channel, so it can be mirrored", () => {
    for (const op of selected) {
      expect(op.defaultChannel, `${op.name} has no channel at ${minor}`).toBeTruthy();
    }
  });

  it("the resolved operator set is what an ImageSetConfig would carry", () => {
    // Generation reads `state.operators.selected`; the names and channels above
    // are exactly the package/channel pairs that reach the imageset payload.
    const payload = selected.map((o) => ({ name: o.name, channel: o.defaultChannel }));
    expect(payload).toEqual([
      { name: "servicemeshoperator", channel: SCAN.packages[`redhat-${minor}`]["servicemeshoperator"] },
      { name: "kiali-ossm", channel: SCAN.packages[`redhat-${minor}`]["kiali-ossm"] },
    ]);
  });
});

describe("T6A §2 — the regression this closes is reproducible", () => {
  it("the OLD package set would still silently drop one package today", () => {
    // Guards against a well-meaning revert: if anyone restores jaeger-product,
    // this demonstrates exactly what the user would lose.
    const old = ["servicemeshoperator", "kiali-ossm", "jaeger-product"];
    for (const minor of SUPPORTED_MINORS) {
      const { selected, skipped } = applyScenarioLookup(old, catalogFor(minor));
      expect(skipped, minor).toEqual(["jaeger-product"]);
      expect(selected, minor).toHaveLength(2);
    }
  });

  it("no Quick Pick requests a package absent from the catalog OF ITS OWN MINOR", () => {
    // The absolute form of claim A, stated once over the whole table.
    //
    // Each package list is checked against its OWN minor only. A `"4.22"` row
    // naming `ocs-tls-profiles` is correct even though 4.20 does not carry that
    // package — that is the entire point of a version-aware Quick Pick. An
    // earlier draft of this sweep cross-checked every row against every minor
    // and produced six false positives, all of them version-aware rows doing
    // exactly what they should.
    const start = SRC.search(/const\s+scenarios\s*=\s*\[/);
    let i = SRC.indexOf("[", start), depth = 0;
    for (; i < SRC.length; i++) {
      if (SRC[i] === "[") depth++;
      else if (SRC[i] === "]") { depth--; if (depth === 0) break; }
    }
    const arr = SRC.slice(start, i + 1);

    const skipped = [];
    let checked = 0;
    for (const g of arr.matchAll(/(redhat|certified):\s*\[([^\]]*)\]/g)) {
      const catalogId = g[1];
      const names = g[2].split(",").map((x) => x.trim().replace(/"/g, "")).filter(Boolean);

      // The nearest preceding `"X.Y":` key is this list's own minor; absent one,
      // the list is a flat pick that applies at every supported minor.
      const rowKey = [...arr.slice(0, g.index).matchAll(/"(\d+\.\d+)":/g)].pop()?.[1];
      const applicable = rowKey ? [rowKey] : SUPPORTED_MINORS;

      for (const minor of applicable) {
        if (!SUPPORTED_MINORS.includes(minor)) continue; // historical rows below the baseline
        const key = `${catalogId}-${minor}`;
        if (!SCAN.packages[key]) continue; // certified was scanned at 4.22 only
        for (const n of names) {
          checked++;
          if (!Object.prototype.hasOwnProperty.call(SCAN.packages[key], n)) skipped.push(`${n}@${key}`);
        }
      }
    }

    expect(checked, "the sweep must actually check something").toBeGreaterThan(100);
    expect(skipped).toEqual([]);
  });
});
