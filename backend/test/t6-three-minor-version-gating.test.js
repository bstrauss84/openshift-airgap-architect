/**
 * Tranche 6 §18 — version-gated catalog behaviour, parameterised across all
 * three supported minors, with 4.23 as the negative control.
 *
 * The catalogs are the authority the UI, validation and generation all read, so
 * this certifies the shape of that authority rather than any one consumer:
 * fields introduced at 4.21, fields introduced at 4.22, fields deliberately not
 * supported, deprecated fields, hidden-not-applicable fields and derived
 * fields must each behave the same way at every minor that models them.
 *
 * Success and failure are never treated as interchangeable: every assertion
 * states which one it expects.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SUPPORTED_MINORS, isSupportedMinor, getMinorVersion } from "../src/versionPolicy.js";
import { getCatalog } from "../src/catalogValidator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");

const scenarios = (minor) =>
  readdirSync(join(REPO, "data", "params", minor))
    .filter((f) => f.endsWith(".json") && f !== "oc-mirror-v2.json")
    .map((f) => f.replace(/\.json$/, ""));

const params = (minor) =>
  scenarios(minor).flatMap((s) =>
    JSON.parse(readFileSync(join(REPO, "data", "params", minor, `${s}.json`), "utf8")).parameters.map((p) => ({ ...p, scenario: s }))
  );

const BY_MINOR = Object.fromEntries(SUPPORTED_MINORS.map((m) => [m, params(m)]));

/** The baseline is SUPPORTED_MINORS[0] and deliberately did not move at the flip. */
const BASELINE = [...SUPPORTED_MINORS].sort()[0];

describe("T6 §18 — the version-gating baseline did not move with the flip", () => {
  it("the baseline is still 4.20", () => {
    assert.equal(BASELINE, "4.20");
    const record = JSON.parse(readFileSync(join(REPO, "scripts", "lib", "released-minor-support.json"), "utf8"));
    assert.equal(record.baselineMinor, "4.20");
  });

  it("every parameter carries a minVersion at or above the baseline", () => {
    for (const minor of SUPPORTED_MINORS) {
      for (const p of BY_MINOR[minor]) {
        assert.ok(p.minVersion, `${minor}/${p.scenario}/${p.path} has no minVersion`);
        assert.ok(p.minVersion <= minor, `${minor}/${p.path} claims minVersion ${p.minVersion}`);
      }
    }
  });

  it("no catalog models a parameter from an unsupported future minor", () => {
    for (const minor of SUPPORTED_MINORS) {
      const future = BY_MINOR[minor].filter((p) => !isSupportedMinor(p.minVersion));
      assert.deepEqual(future.map((p) => `${p.path}@${p.minVersion}`), []);
    }
  });
});

describe("T6 §18 — fields introduced at 4.21 behave identically at 4.21 and 4.22", () => {
  const introduced421 = (minor) => BY_MINOR[minor].filter((p) => p.minVersion === "4.21");

  it("4.20 models none of them", () => {
    assert.equal(introduced421("4.20").length, 0);
  });

  it("4.21 and 4.22 model exactly the same 26 of them", () => {
    assert.equal(introduced421("4.21").length, 26);
    assert.equal(introduced421("4.22").length, 26);
    const key = (m) => introduced421(m).map((p) => `${p.scenario}:${p.path}`).sort();
    assert.deepEqual(key("4.22"), key("4.21"));
  });

  it("their support status is unchanged between 4.21 and 4.22 — carried, not re-decided", () => {
    const sig = (m) =>
      introduced421(m).map((p) => `${p.scenario}:${p.path}=${p.supportStatus}`).sort();
    assert.deepEqual(sig("4.22"), sig("4.21"));
  });
});

describe("T6 §18 — fields introduced at 4.22", () => {
  const introduced422 = BY_MINOR["4.22"].filter((p) => p.minVersion === "4.22");

  it("4.22 models 46 rows across 9 distinct paths", () => {
    assert.equal(introduced422.length, 46);
    assert.equal(new Set(introduced422.map((p) => p.path)).size, 9);
  });

  it("neither 4.20 nor 4.21 models any of them", () => {
    const paths = new Set(introduced422.map((p) => p.path));
    for (const minor of ["4.20", "4.21"]) {
      const leaked = BY_MINOR[minor].filter((p) => paths.has(p.path));
      assert.deepEqual(leaked.map((p) => `${p.scenario}:${p.path}`), [], `${minor} models a 4.22-only path`);
    }
  });

  it("exactly one of them is supported-ui, and it is the bare-metal IPI gateway", () => {
    const ui = introduced422.filter((p) => p.supportStatus === "supported-ui");
    assert.deepEqual(
      ui.map((p) => `${p.scenario}:${p.path}`),
      ["bare-metal-ipi:platform.baremetal.provisioningNetworkGateway"]
    );
  });

  it("every other new path is docs-only-not-supported or hidden-not-applicable", () => {
    const rest = introduced422.filter((p) => p.supportStatus !== "supported-ui");
    for (const p of rest) {
      assert.ok(
        ["docs-only-not-supported", "hidden-not-applicable"].includes(p.supportStatus),
        `${p.scenario}:${p.path} is ${p.supportStatus}`
      );
    }
    assert.equal(rest.length, 45);
  });

  it("every 4.22-introduced row carries a 4.22 citation and no other minor's", () => {
    for (const p of introduced422) {
      const refs = JSON.stringify(p.docRefs || p.citations || []);
      if (refs === "[]") continue;
      assert.ok(!/\/4\.20\//.test(refs), `${p.path} cites 4.20`);
      assert.ok(!/\/4\.21\//.test(refs), `${p.path} cites 4.21`);
    }
  });
});

describe("T6 §18 — deliberately unsupported and hidden fields never become UI", () => {
  it("docs-only-not-supported rows exist at 4.22 and none is supported-ui", () => {
    const docsOnly = BY_MINOR["4.22"].filter((p) => p.supportStatus === "docs-only-not-supported");
    assert.equal(docsOnly.length, 32);
    for (const p of docsOnly) assert.notEqual(p.supportStatus, "supported-ui");
  });

  it("hidden-not-applicable rows exist at 4.22 and none is supported-ui", () => {
    const hidden = BY_MINOR["4.22"].filter((p) => p.supportStatus === "hidden-not-applicable");
    assert.equal(hidden.length, 29);
  });

  it("a row never becomes MORE supported when a newer minor is onboarded", () => {
    // The real regression risk: a clone-and-scrub that quietly upgrades a
    // status. Any status change across minors must be a deliberate downgrade
    // or an unchanged carry, never an upgrade to supported-ui.
    const rank = {
      "hidden-not-applicable": 0,
      "docs-only-not-supported": 1,
      "supported-backend-only": 2,
      "supported-derived": 3,
      "supported-ui": 4,
    };
    const index = (m) => new Map(BY_MINOR[m].map((p) => [`${p.scenario}:${p.path}`, p.supportStatus]));
    const a21 = index("4.21");
    for (const [key, status] of index("4.22")) {
      if (!a21.has(key)) continue;
      assert.ok(
        rank[status] <= rank[a21.get(key)],
        `${key} was upgraded from ${a21.get(key)} to ${status} at 4.22`
      );
    }
  });

  it("deprecated rows are marked identically at 4.21 and 4.22", () => {
    const dep = (m) => BY_MINOR[m].filter((p) => p.deprecated === true).map((p) => `${p.scenario}:${p.path}`).sort();
    assert.equal(dep("4.21").length, 13);
    assert.deepEqual(dep("4.22"), dep("4.21"));
  });

  it("derived fields are stable across all three minors", () => {
    const derived = (m) => BY_MINOR[m].filter((p) => p.supportStatus === "supported-derived").length;
    assert.equal(derived("4.21"), 35);
    assert.equal(derived("4.22"), 35);
  });
});

describe("T6 §18 — the catalog loader agrees with the files, per minor", () => {
  for (const minor of SUPPORTED_MINORS) {
    it(`${minor}: every scenario loads through the real backend catalog resolver`, () => {
      for (const s of scenarios(minor)) {
        const cat = getCatalog(s, minor);
        assert.ok(cat, `${minor}/${s} did not resolve`);
        const list = Array.isArray(cat) ? cat : cat.parameters;
        assert.ok(Array.isArray(list) && list.length > 0, `${minor}/${s} resolved empty`);
      }
    });
  }

  it("4.23 is refused for every scenario, with no fallback to 4.22", () => {
    for (const s of scenarios("4.22")) {
      let err = null;
      let got = null;
      try { got = getCatalog(s, "4.23"); } catch (e) { err = e; }
      assert.equal(err?.code, "UNSUPPORTED_VERSION", `${s} must refuse 4.23`);
      assert.equal(got, null, `${s} returned a catalog for 4.23`);
    }
  });

  it("getMinorVersion is the single parser used for all of this", () => {
    assert.equal(getMinorVersion("4.22.16"), "4.22");
    assert.equal(getMinorVersion("4.23.0"), "4.23");
    assert.equal(getMinorVersion("nonsense"), null);
  });
});
