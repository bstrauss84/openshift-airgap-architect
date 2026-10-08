/**
 * Tranche 6 §12 — all 21 Operator Quick Picks RESOLVED, per supported minor.
 *
 * `t4-quick-pick-catalog-verification.test.js` checks package PRESENCE against
 * the committed real-catalog scan. This file checks RESOLUTION: for each
 * supported minor, what does the application actually hand to `applyScenario`,
 * and does every package it names survive the lookup `applyScenario` performs?
 *
 * That distinction is the whole point of finding B1. `applyScenario` does
 * `if (!found) return;` — a named package that is not in the scanned catalog is
 * skipped **silently**, so "the Quick Pick is defined" and "the user gets what
 * the Quick Pick promises" are different claims. This file certifies the second.
 *
 * Catalog data is the committed `operator-catalog-scan-4.22.json` acquisition
 * evidence (`oc-mirror --v2 list operators` against registry.redhat.io). Tests
 * read the fixture, never the network.
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

/* ---------- parse the real Quick Pick table out of the real source ---------- */

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

/** Source text with // and block comments removed, for "is it actually requested" checks. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

const parseLists = (fragment) => {
  const out = {};
  for (const m of fragment.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
    out[m[1]] = m[2].split(",").map((x) => x.trim().replace(/"/g, "")).filter(Boolean);
  }
  return out;
};

const flatPicks = (body) => parseLists((body.match(/picks:\s*\{([\s\S]*?)\n\s*\}/) || [])[1] || "");
const versionRow = (body, minor) => {
  const m = body.match(new RegExp(`"${minor.replace(".", "\\.")}":\\s*\\{([^}]*)\\}`));
  return m ? parseLists(m[1]) : null;
};

const ALL = quickPickObjects();
const VERSION_AWARE = ALL.filter((p) => p.versionAware);
const FLAT = ALL.filter((p) => !p.versionAware);

/**
 * What the application would hand to `applyScenario` at `minor`.
 * Mirrors the production resolver: per-minor row, else flat picks, else null.
 * There is deliberately no `default` branch — Tranche 5 removed it.
 */
function resolve(pick, minor) {
  return pick.versionAware ? versionRow(pick.body, minor) : flatPicks(pick.body);
}

/**
 * Catalogs actually scanned in the committed evidence. The redhat index was
 * captured at all three minors; `certified` only at 4.22, so certified-catalog
 * resolution is certified at 4.22 and recorded as unscanned elsewhere.
 */
const SCANNED = new Set(["redhat-4.20", "redhat-4.21", "redhat-4.22", "certified-4.22"]);
const scanKey = (catalogId, minor) => `${catalogId === "certified" ? "certified" : "redhat"}-${minor}`;

/**
 * There is NO disposition allowlist any more, deliberately.
 *
 * Tranche 6 carried one entry (`jaeger-product`) and the surrounding test was
 * still named "no package is silently skipped" — so a green run meant "no
 * UNDISPOSITIONED package is skipped", while the report claimed the absolute.
 * Tranche 6A removed the stale package from the Quick Pick itself (DOC-184), so
 * the absolute claim is now literally what is asserted: every package every
 * Quick Pick names must resolve, with no exemptions.
 *
 * If a future catalog drops a package, this fails. That is the point: the
 * correct response is to fix the Quick Pick, not to add an exemption here.
 */

describe("T6 §12 — the Quick Pick inventory after the atomic flip", () => {
  it("there are 21 Quick Picks: 6 version-aware and 15 flat", () => {
    expect(ALL).toHaveLength(21);
    expect(VERSION_AWARE).toHaveLength(6);
    expect(FLAT).toHaveLength(15);
  });

  it("every Quick Pick resolves to a non-empty package set at every supported minor", () => {
    for (const p of ALL) {
      for (const minor of SUPPORTED_MINORS) {
        const picks = resolve(p, minor);
        expect(picks, `${p.id} resolves to nothing at ${minor}`).toBeTruthy();
        expect(Object.values(picks).flat().length, `${p.id} @ ${minor}`).toBeGreaterThan(0);
      }
    }
  });

  it("no Quick Pick resolves for unsupported 4.23 by inheritance", () => {
    // Flat picks are genuinely minor-independent and still resolve by design;
    // what must not happen is a VERSION-AWARE pick inheriting a supported
    // minor's package list for an unsupported one.
    for (const p of VERSION_AWARE) {
      expect(resolve(p, "4.23"), `${p.id} inherited a Quick Pick at 4.23`).toBeNull();
    }
  });

  it("the legacy `default` fallback is gone from data and from resolution", () => {
    expect(SRC).not.toMatch(/"default":/);
    expect(SRC).not.toMatch(/versionPicks\?\.\["default"\]/);
  });
});

describe("T6 §12 — every resolved package survives the applyScenario lookup", () => {
  for (const p of ALL) {
    for (const minor of SUPPORTED_MINORS) {
      const picks = resolve(p, minor) || {};
      for (const [catalogId, names] of Object.entries(picks)) {
        const key = scanKey(catalogId, minor);
        if (!SCANNED.has(key)) continue;
        it(`${p.id}/${catalogId} @ ${minor}: every named package resolves`, () => {
          const catalog = SCAN.packages[key];
          const missing = names.filter((n) => !Object.prototype.hasOwnProperty.call(catalog, n));
          expect(
            missing,
            `${p.id} names ${missing.join(", ")} at ${minor}, but ${key} does not carry it — ` +
              `applyScenario would skip it with no warning, so the Quick Pick would ` +
              `mirror fewer operators than it promises`
          ).toEqual([]);
        });
      }
    }
  }

  it("the claim is absolute: NO Quick Pick package is absent at any scanned catalog", () => {
    // Stated once, globally, so the per-combination tests above cannot be
    // green while the overall claim is false.
    const skipped = [];
    for (const p of ALL) {
      for (const minor of SUPPORTED_MINORS) {
        for (const [catalogId, names] of Object.entries(resolve(p, minor) || {})) {
          const key = scanKey(catalogId, minor);
          if (!SCANNED.has(key)) continue;
          for (const n of names) {
            if (!Object.prototype.hasOwnProperty.call(SCAN.packages[key], n)) {
              skipped.push(`${p.id}/${n}@${minor}`);
            }
          }
        }
      }
    }
    expect(skipped).toEqual([]);
  });
});

describe("T6 §12 — OpenShift AI, exactly", () => {
  const AI = VERSION_AWARE.find((p) => p.id === "openshift-ai");

  it("is version-aware", () => {
    expect(AI).toBeTruthy();
  });

  it("4.20 preserves the pre-Tranche-5 package set", () => {
    expect(versionRow(AI.body, "4.20")).toEqual({
      redhat: ["rhods-operator", "rhods-prometheus-operator", "nfd"],
      certified: ["gpu-operator-certified"],
    });
  });

  it("4.21 preserves the pre-Tranche-5 package set", () => {
    expect(versionRow(AI.body, "4.21")).toEqual({
      redhat: ["rhods-operator", "rhods-prometheus-operator", "nfd"],
      certified: ["gpu-operator-certified"],
    });
  });

  it("4.22 is exactly rhods-operator + nfd (redhat) and gpu-operator-certified (certified)", () => {
    expect(versionRow(AI.body, "4.22")).toEqual({
      redhat: ["rhods-operator", "nfd"],
      certified: ["gpu-operator-certified"],
    });
  });

  it("4.22 does NOT request rhods-prometheus-operator", () => {
    expect(Object.values(versionRow(AI.body, "4.22")).flat()).not.toContain("rhods-prometheus-operator");
  });

  it("4.22 substitutes no replacement Prometheus package", () => {
    const row = Object.values(versionRow(AI.body, "4.22")).flat();
    expect(row.filter((n) => /prometheus/i.test(n))).toEqual([]);
    expect(row).not.toContain("odf-prometheus-operator");
  });

  it("the omitted package really is absent at 4.22 and present at 4.20/4.21", () => {
    expect(Object.prototype.hasOwnProperty.call(SCAN.packages["redhat-4.22"], "rhods-prometheus-operator")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(SCAN.packages["redhat-4.20"], "rhods-prometheus-operator")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(SCAN.packages["redhat-4.21"], "rhods-prometheus-operator")).toBe(true);
  });

  it("every package the 4.22 row names resolves in the real 4.22 catalogs", () => {
    for (const [cat, names] of Object.entries(versionRow(AI.body, "4.22"))) {
      for (const n of names) {
        expect(Object.prototype.hasOwnProperty.call(SCAN.packages[`${cat}-4.22`], n), `${n} @ ${cat}-4.22`).toBe(true);
      }
    }
  });
});

describe("T6 §12 — the other version-aware Quick Picks", () => {
  const OTHERS = VERSION_AWARE.filter((p) => p.id !== "openshift-ai");

  it("there are five, and each declares explicit 4.20, 4.21 and 4.22 rows", () => {
    expect(OTHERS).toHaveLength(5);
    for (const p of OTHERS) {
      for (const minor of SUPPORTED_MINORS) {
        expect(versionRow(p.body, minor), `${p.id} has no "${minor}" row`).toBeTruthy();
      }
    }
  });

  it("the ODF family matches the documented 4.22 package counts", () => {
    const n = (id) => versionRow(VERSION_AWARE.find((p) => p.id === id).body, "4.22").redhat.length;
    expect(n("odf")).toBe(12);
    expect(n("odf-local-storage")).toBe(13);
    expect(n("odf-disaster-recovery")).toBe(16);
    expect(n("platform-plus")).toBe(16);
  });

  it("app-dev-suite does not vary by minor, and says so by repeating the row", () => {
    const body = VERSION_AWARE.find((p) => p.id === "app-dev-suite").body;
    const rows = SUPPORTED_MINORS.map((m) => JSON.stringify(versionRow(body, m)));
    expect(new Set(rows).size).toBe(1);
  });
});

describe("T6A §2 — DOC-184 closed: the stale Jaeger reference is gone", () => {
  const MESH = FLAT.find((p) => p.id === "service-mesh");

  it("the Service Mesh Quick Pick names exactly servicemeshoperator and kiali-ossm", () => {
    expect(flatPicks(MESH.body)).toEqual({ redhat: ["servicemeshoperator", "kiali-ossm"] });
  });

  it("jaeger-product is named in no Quick Pick's package data", () => {
    // Comments are stripped before matching: the removal comment legitimately
    // names the package to explain WHY it is gone, and must not be mistaken
    // for the package still being requested.
    const code = stripComments(SRC);
    expect(code).not.toContain("jaeger-product");
    // And the comment explaining the removal is still there, deliberately.
    expect(SRC).toContain("jaeger-product");
  });

  it("both remaining packages exist at every supported minor", () => {
    for (const m of SUPPORTED_MINORS) {
      for (const n of ["servicemeshoperator", "kiali-ossm"]) {
        expect(Object.prototype.hasOwnProperty.call(SCAN.packages[`redhat-${m}`], n), `${n}@${m}`).toBe(true);
      }
    }
  });

  it("the removed package really is absent everywhere — the removal was not cosmetic", () => {
    for (const m of SUPPORTED_MINORS) {
      expect(Object.prototype.hasOwnProperty.call(SCAN.packages[`redhat-${m}`], "jaeger-product"), m).toBe(false);
    }
  });

  it("no Tempo or OpenTelemetry package was substituted in", () => {
    // Red Hat's OSSM 3.x distributed-tracing chapter lists Tempo and the
    // OpenTelemetry collector as prerequisites of an OPTIONAL tracing
    // integration, not of Service Mesh, and Service Mesh 3 no longer manages
    // tracing components. Adding them would be a new product capability, not a
    // stale-reference fix. They ARE in the catalog, so this is a deliberate
    // omission rather than an unavailable one.
    const names = Object.values(flatPicks(MESH.body)).flat();
    expect(names).not.toContain("tempo-product");
    expect(names).not.toContain("opentelemetry-product");
    expect(Object.prototype.hasOwnProperty.call(SCAN.packages["redhat-4.22"], "tempo-product")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(SCAN.packages["redhat-4.22"], "opentelemetry-product")).toBe(true);
  });

  it("the user-visible description no longer promises distributed tracing", () => {
    const description = (MESH.body.match(/description:\s*"([^"]*)"/) || [])[1] || "";
    expect(description).toBe("Istio-based service mesh with Kiali observability");
    expect(description).not.toMatch(/Jaeger/i);
    expect(description).not.toMatch(/tracing/i);
  });
});
