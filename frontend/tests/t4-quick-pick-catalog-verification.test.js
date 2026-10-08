/**
 * Tranche 4 — Operator Quick Picks verified against the REAL 4.22 catalog.
 *
 * Plan decision **O5**: every version-independent Quick Pick needs a
 * package-presence check against real catalog data, because `applyScenario`
 * silently skips a package it cannot find (`OperatorsStep.jsx`: `if (!found)
 * return;`). A Quick Pick that names a package the catalog does not carry
 * therefore delivers a smaller mirror set than it promises, with no warning.
 *
 * The catalog inventory is committed at
 * `docs/minor-release/4.22/operator-catalog-scan-4.22.json`, captured by
 * `oc-mirror --v2 list operators` against `registry.redhat.io` on 2026-10-08 as
 * an acquisition step. Tests consume the fixture, never the network (runbook
 * Rule 6).
 *
 * This file CHANGES NOTHING. Tranche 4 is verification-only, and the Quick Pick
 * corrections must land in the atomic Tranche 5 flip.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");

const SCAN = JSON.parse(
  readFileSync(join(REPO, "docs", "minor-release", "4.22", "operator-catalog-scan-4.22.json"), "utf8")
);
const SRC = readFileSync(join(REPO, "frontend", "src", "steps", "OperatorsStep.jsx"), "utf8");

/** Split the real `scenarios` array into its top-level Quick Pick objects. */
function quickPickObjects() {
  const start = SRC.search(/const\s+scenarios\s*=\s*\[/);
  let i = SRC.indexOf("[", start);
  let depth = 0;
  for (; i < SRC.length; i++) {
    if (SRC[i] === "[") depth++;
    else if (SRC[i] === "]") { depth--; if (depth === 0) break; }
  }
  const arr = SRC.slice(start, i + 1);
  const objs = [];
  let d = 0, s = -1;
  for (let k = 0; k < arr.length; k++) {
    if (arr[k] === "{") { if (d === 0) s = k; d++; }
    else if (arr[k] === "}") { d--; if (d === 0) objs.push(arr.slice(s, k + 1)); }
  }
  return objs.map((body) => ({
    id: (body.match(/id:\s*"([^"]+)"/) || [])[1],
    versionAware: /versionPicks:/.test(body),
    body,
  }));
}

/** `{ catalogId: [packageName, ...] }` for a flat Quick Pick. */
function flatPicks(body) {
  const picksBody = (body.match(/picks:\s*\{([\s\S]*?)\n\s*\}/) || [])[1] || "";
  const out = {};
  for (const m of picksBody.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
    out[m[1]] = m[2].split(",").map((x) => x.trim().replace(/"/g, "")).filter(Boolean);
  }
  return out;
}

const ALL = quickPickObjects();
const FLAT = ALL.filter((p) => !p.versionAware);
const VERSION_AWARE = ALL.filter((p) => p.versionAware);

const catalogFor = (catalogId, minor) =>
  SCAN.packages[`${catalogId === "certified" ? "certified" : "redhat"}-${minor}`] || {};

describe("T4 — Quick Pick inventory", () => {
  it("the scan fixture carries all four catalogs with plausible sizes", () => {
    for (const key of ["redhat-4.20", "redhat-4.21", "redhat-4.22", "certified-4.22"]) {
      expect(Object.keys(SCAN.packages[key]).length).toBeGreaterThan(100);
    }
  });

  it("there are 21 Quick Picks: 5 version-aware and 16 flat", () => {
    // The accepted Tranche 1 evidence says "20 Quick Picks ... 15 are flat".
    // That is an off-by-one in the evidence document, not a code change: the
    // `scenarios` array is byte-identical to its state at the Tranche 1 commit.
    // Verifying only 15 would leave one Quick Pick unchecked.
    expect(ALL).toHaveLength(21);
    expect(VERSION_AWARE).toHaveLength(5);
    expect(FLAT).toHaveLength(16);
  });

  it("every flat Quick Pick yields a parseable package list", () => {
    for (const p of FLAT) {
      const picks = flatPicks(p.body);
      expect(Object.keys(picks).length, p.id).toBeGreaterThan(0);
    }
  });
});

describe("T4 — every flat Quick Pick package against the real 4.22 catalog", () => {
  for (const p of FLAT) {
    const picks = flatPicks(p.body);
    for (const [catalogId, names] of Object.entries(picks)) {
      for (const name of names) {
        const present = Object.prototype.hasOwnProperty.call(catalogFor(catalogId, "4.22"), name);
        // Two packages are known-absent and are asserted as such below, with
        // their 4.20/4.21 history, so this loop stays an exact statement of
        // fact rather than a list of expected failures.
        const KNOWN_ABSENT = ["rhods-prometheus-operator", "jaeger-product"];
        if (KNOWN_ABSENT.includes(name)) {
          it(`${p.id}/${catalogId}/${name} is ABSENT at 4.22 (known finding)`, () => {
            expect(present).toBe(false);
          });
        } else {
          it(`${p.id}/${catalogId}/${name} exists in the 4.22 catalog`, () => {
            expect(present, `${name} not found in ${catalogId} 4.22`).toBe(true);
          });
        }
      }
    }
  }
});

describe("T4 — the two absent packages, characterised", () => {
  const rh = (minor, name) => Object.prototype.hasOwnProperty.call(SCAN.packages[`redhat-${minor}`], name);

  it("rhods-prometheus-operator is a 4.22 REGRESSION: present at 4.20 and 4.21, gone at 4.22", () => {
    expect(rh("4.20", "rhods-prometheus-operator")).toBe(true);
    expect(rh("4.21", "rhods-prometheus-operator")).toBe(true);
    expect(rh("4.22", "rhods-prometheus-operator")).toBe(false);
  });

  it("jaeger-product is PRE-EXISTING: absent at 4.20, 4.21 and 4.22 alike", () => {
    // Not introduced by 4.22. Red Hat moved distributed tracing to Tempo and
    // OpenTelemetry, both of which the 4.22 catalog does carry.
    for (const m of ["4.20", "4.21", "4.22"]) expect(rh(m, "jaeger-product"), m).toBe(false);
    expect(rh("4.22", "tempo-product")).toBe(true);
    expect(rh("4.22", "opentelemetry-product")).toBe(true);
  });

  it("a missing package is skipped SILENTLY, which is what makes this matter", () => {
    expect(SRC).toMatch(/if \(!found\) return;/);
    const applyScenario = SRC.slice(SRC.indexOf("const picks = scenario.versionPicks"), SRC.indexOf("const picks = scenario.versionPicks") + 1200);
    expect(applyScenario).not.toMatch(/warn|notFound|missingPackage/i);
  });
});

/* ------------------------------------------------------------------ */
/* T4A — B1 disposition and the silent-disappearance invariant          */
/* ------------------------------------------------------------------ */

const RHOAI = JSON.parse(
  readFileSync(join(REPO, "docs", "minor-release", "4.22", "rhoai-package-evidence-4.22.json"), "utf8")
);

/**
 * Every package a flat Quick Pick names that is NOT present in a scanned
 * catalog must appear here with a disposition. The invariant below fails on any
 * absence that is not listed, so a package quietly dropped from a future
 * catalog cannot slip through the way `rhods-prometheus-operator` did.
 *
 * `absentAt` is exact: listing a minor where the package is actually PRESENT
 * fails too, so a disposition cannot outlive the fact it describes.
 */
const DISPOSITIONED_ABSENCES = {
  "rhods-prometheus-operator": {
    finding: "B1",
    absentAt: ["4.22"],
    disposition: "omit-no-replacement",
    owner: "Tranche 5 (S10)",
  },
  "jaeger-product": {
    finding: "B2",
    absentAt: ["4.20", "4.21", "4.22"],
    disposition: "pre-existing-backlog-debt",
    owner: "pre-release closure, independent of the 4.22 flip",
  },
};

describe("T4A — a required Quick Pick package cannot disappear silently", () => {
  // The redhat index was scanned at all three minors; certified only at 4.22.
  const SCANNED = [
    ["redhat", "4.20"], ["redhat", "4.21"], ["redhat", "4.22"], ["certified", "4.22"],
  ];

  for (const p of FLAT) {
    const picks = flatPicks(p.body);
    for (const [catalogId, names] of Object.entries(picks)) {
      const index = catalogId === "certified" ? "certified" : "redhat";
      for (const [idx, minor] of SCANNED) {
        if (idx !== index) continue;
        it(`${p.id}/${catalogId}/${names.join("+")} @ ${minor}: every absence is dispositioned`, () => {
          for (const name of names) {
            const present = Object.prototype.hasOwnProperty.call(
              SCAN.packages[`${index}-${minor}`], name
            );
            const d = DISPOSITIONED_ABSENCES[name];
            if (present) {
              expect(
                d?.absentAt ?? [],
                `${name} IS present at ${minor}; its disposition claims otherwise`
              ).not.toContain(minor);
            } else {
              expect(
                d?.absentAt,
                `${name} is absent from ${index} ${minor} with NO recorded disposition — ` +
                  `a Quick Pick package disappeared and applyScenario would skip it silently`
              ).toContain(minor);
            }
          }
        });
      }
    }
  }

  it("the disposition registry carries no entry for a package no Quick Pick names", () => {
    const named = new Set(FLAT.flatMap((p) => Object.values(flatPicks(p.body)).flat()));
    for (const name of Object.keys(DISPOSITIONED_ABSENCES)) {
      expect(named, `${name} is dispositioned but unused — delete the entry`).toContain(name);
    }
  });
});

describe("T4A — B1: rhods-prometheus-operator is omitted at 4.22 with no replacement", () => {
  it("rhods-operator declares no OLM dependency, so nothing resolves the package in", () => {
    expect(RHOAI["rhods-operator"].dependencyProperties["olm.package.required"]).toBe(0);
    expect(RHOAI["rhods-operator"].dependencyProperties["olm.gvk.required"]).toBe(0);
  });

  it("no rhods-operator bundle at any minor even mentions rhods-prometheus-operator", () => {
    const x = RHOAI["rhods-operator"].crossReferencesToRhodsPrometheusOperator;
    for (const m of ["4.20", "4.21", "4.22"]) expect(x[m], m).toBe(0);
  });

  it("the 4.22 stable-3.x head bundle ships no Prometheus image", () => {
    const head = RHOAI["rhods-operator"].headBundleRelatedImages["4.22"];
    expect(head.bundle).toBe("rhods-operator.3.5.1");
    expect(head.prometheusImages).toEqual([]);
  });

  it("the package was a frozen 2021 beta artifact, identical at 4.20 and 4.21", () => {
    const p = RHOAI["rhods-prometheus-operator"];
    expect(p.defaultChannel).toBe("beta");
    expect(Object.keys(p.channels)).toEqual(["beta"]);
    expect(p.channels.beta).toEqual(["rhods-prometheus-operator.4.10.0"]);
    expect(p.fourTwentyAndFourTwentyOneAreByteIdentical).toBe(true);
  });

  it("the disposition is A — omit, not rename and not replace", () => {
    expect(RHOAI.disposition.option).toBe("A");
    // No replacement is named anywhere in the evidence, deliberately: a
    // similar-looking package name is not evidence of a replacement.
    expect(JSON.stringify(RHOAI.disposition)).not.toMatch(/odf-prometheus-operator"\s*:/);
  });

  it("the intended 4.22 openshift-ai package set is the current set minus that package", () => {
    const ai = FLAT.find((p) => p.id === "openshift-ai");
    const picks = flatPicks(ai.body);
    const intended = Object.fromEntries(
      Object.entries(picks).map(([cat, names]) => [cat, names.filter((n) => n !== "rhods-prometheus-operator")])
    );
    expect(intended).toEqual({ redhat: ["rhods-operator", "nfd"], certified: ["gpu-operator-certified"] });
    for (const [cat, names] of Object.entries(intended)) {
      for (const n of names) {
        expect(
          Object.prototype.hasOwnProperty.call(SCAN.packages[`${cat}-4.22`], n), n
        ).toBe(true);
      }
    }
  });

  it("4.22 is NOT yet wired: the production Quick Pick still names the package", () => {
    // Tranche 4A researches; Tranche 5 edits. This pins that nothing was
    // changed early, and fails the moment S10 lands so the pin is removed.
    const ai = FLAT.find((p) => p.id === "openshift-ai");
    expect(Object.values(flatPicks(ai.body)).flat()).toContain("rhods-prometheus-operator");
    expect(ai.versionAware).toBe(false);
  });
});

describe("T4 — version-aware Quick Pick packages exist at 4.22 (Tranche 5 input)", () => {
  // Not a 4.22 row — Tranche 5 adds those. This verifies the packages such a
  // row would name are real, so the flip commit can be authored from evidence.
  const ODF_4_22_CANDIDATES = [
    "ocs-operator", "odf-operator", "mcg-operator", "odf-csi-addons-operator",
    "ocs-client-operator", "odf-prometheus-operator", "recipe", "rook-ceph-operator",
    "cephcsi-operator", "odf-dependencies", "odf-external-snapshotter-operator",
    "ocs-tls-profiles", "odr-volsync-plugin-operator", "local-storage-operator",
  ];

  it.each(ODF_4_22_CANDIDATES)("%s exists in the real 4.22 catalog", (name) => {
    expect(Object.prototype.hasOwnProperty.call(SCAN.packages["redhat-4.22"], name)).toBe(true);
  });

  it("ocs-tls-profiles is new at 4.22, confirming the ODF package-set delta", () => {
    expect(Object.prototype.hasOwnProperty.call(SCAN.packages["redhat-4.21"], "ocs-tls-profiles")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(SCAN.packages["redhat-4.22"], "ocs-tls-profiles")).toBe(true);
  });

  it("no version-aware Quick Pick carries a 4.22 row yet", () => {
    for (const p of VERSION_AWARE) expect(p.body).not.toMatch(/"4\.22":/);
  });
});
