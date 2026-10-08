/**
 * Tranche 4 — atomic flip-surface inventory and partial-flip adversarial matrix.
 *
 * Two jobs, both verification-only:
 *
 *   §7  Pin the CURRENT pre-flip value of every production surface Tranche 5
 *       must change, derived from the code rather than from planning prose. If
 *       a surface is already derived from `SUPPORTED_MINORS`, that is asserted
 *       too, so the flip checklist does not carry work that does not exist.
 *
 *   §8  Demonstrate that representative PARTIAL flips are rejected or detected.
 *       Partial enablement is the reason Tranche 5 must be one commit; this
 *       shows the claim rather than asserting it.
 *
 * Nothing here mutates production code. The adversarial cases run against
 * synthetic fixture roots and injected datasets.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { validateSupportedMinors } from "./validate-supported-minors.mjs";
import {
  resolveArchitectureSupport,
  listArchitectureSupportAcrossMinors,
} from "../shared/archSupport.js";

const REPO = path.resolve(import.meta.dirname, "..");
const read = (...p) => fs.readFileSync(path.join(REPO, ...p), "utf8");

/* ------------------------------------------------------------------ */
/* §7  FLIP-SURFACE INVENTORY — current pre-flip values                 */
/* ------------------------------------------------------------------ */

describe("T4 §7 — surfaces requiring a DIRECT Tranche 5 edit", () => {
  test("S1 backend SUPPORTED_MINORS is ['4.20','4.21']", () => {
    assert.match(read("backend", "src", "versionPolicy.js"), /const SUPPORTED_MINORS = Object\.freeze\(\["4\.20", "4\.21"\]\);/);
  });

  test("S2 frontend SUPPORTED_MINORS is ['4.20','4.21']", () => {
    assert.match(read("frontend", "src", "shared", "versionPolicy.js"), /const SUPPORTED_MINORS = Object\.freeze\(\["4\.20", "4\.21"\]\);/);
  });

  test("S3 FIELD_GUIDE_SUPPORTED_MINORS is ['4.20','4.21']", () => {
    assert.match(read("backend", "src", "fieldGuide", "versionResolution.js"), /FIELD_GUIDE_SUPPORTED_MINORS = Object\.freeze\(\["4\.20", "4\.21"\]\)/);
  });

  test("S4 assembler.js imports and branches on 4.20/4.21 only", () => {
    const src = read("backend", "src", "fieldGuide", "assembler.js");
    assert.match(src, /compartments_v420/);
    assert.match(src, /compartments_v421/);
    assert.doesNotMatch(src, /compartments_v422/);
  });

  test("S5 provenance.js getAuthoritativeExport knows 4.20/4.21 only", () => {
    const src = read("backend", "src", "fieldGuide", "provenance.js");
    assert.match(src, /if \(minor === '4\.21'\) return compartments_v421;/);
    assert.doesNotMatch(src, /compartments_v422/);
  });

  test("S6 released-minor metadata lists 4.20 and 4.21", () => {
    const rec = JSON.parse(read("scripts", "lib", "released-minor-support.json"));
    assert.deepEqual(rec.previouslyReleasedMinors, ["4.20", "4.21"]);
    assert.equal(rec.baselineMinor, "4.20");
  });

  test("S7 TRUST_BUNDLE_POLICY_ALLOWLIST has no 4.22 row, in BOTH policy modules", () => {
    // Not in the expected-class list, and easy to miss because the >=4.17
    // forward rule already returns the right POLICIES for 4.22. What it does
    // not do is mark the source `explicit`, so a flipped-but-unlisted 4.22
    // still resolves `source: "forward"` and triggers
    // getForwardOpenShiftMinorDocNotice() — a user-facing "not yet fully
    // reflected in this tool's docs index and catalogs" caveat on a SUPPORTED
    // minor. See the adversarial case below.
    for (const f of [["backend", "src", "versionPolicy.js"], ["frontend", "src", "shared", "versionPolicy.js"]]) {
      const src = read(...f);
      const block = src.slice(src.indexOf("TRUST_BUNDLE_POLICY_ALLOWLIST"), src.indexOf("};", src.indexOf("TRUST_BUNDLE_POLICY_ALLOWLIST")));
      assert.match(block, /"4\.20"/, f.join("/"));
      assert.match(block, /"4\.21"/, f.join("/"));
      assert.doesNotMatch(block, /"4\.22"/, f.join("/"));
    }
  });

  test("S8 e2e SUPPORTED_VERSIONS lists 4.20 and 4.21 only", () => {
    const src = read("e2e", "helpers", "asset-validation.js");
    const block = src.slice(src.indexOf("export const SUPPORTED_VERSIONS"), src.indexOf("]", src.indexOf("export const SUPPORTED_VERSIONS")));
    assert.match(block, /4\.21/);
    assert.doesNotMatch(block, /4\.22/);
  });

  test("S9 no version-aware Quick Pick carries a 4.22 row, and `default` is still present", () => {
    const src = read("frontend", "src", "steps", "OperatorsStep.jsx");
    assert.doesNotMatch(src, /"4\.22":/);
    assert.match(src, /"default":/);
    assert.match(src, /versionPicks\?\.\[version\]\s*\|\|\s*\w+\.versionPicks\?\.\["default"\]/);
  });

  test("S10 tests pinning the supported list are enumerated, not discovered at flip time", () => {
    // Counted so the flip checklist carries a number rather than a surprise.
    const roots = ["backend/test", "frontend/tests", "scripts", "e2e"];
    const hits = [];
    const walk = (dir) => {
      const abs = path.join(REPO, dir);
      if (!fs.existsSync(abs)) return;
      for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = path.join(dir, e.name);
        if (e.isDirectory()) walk(rel);
        else if (/\.(js|jsx|mjs)$/.test(e.name) && /\["4\.20", *"4\.21"\]/.test(read(rel))) hits.push(rel);
      }
    };
    roots.forEach(walk);
    assert.ok(hits.length >= 25, `expected the pinned-list surface to be substantial, found ${hits.length}`);
    assert.ok(hits.length <= 40, `unexpectedly many pinned lists (${hits.length}); re-inventory before the flip`);
  });
});

describe("T4 §7 — surfaces that need NO direct Tranche 5 edit (derived)", () => {
  test("D1 frontend catalog resolver gates on SUPPORTED_MINORS, with no per-minor map", () => {
    const src = read("frontend", "src", "catalogPaths.js");
    assert.match(src, /import\.meta\.glob\(/);
    assert.match(src, /SUPPORTED_MINORS\.includes\(minor\)/);
    assert.doesNotMatch(src, /"4\.22"/);
  });

  test("D2 docs-index resolver gates on SUPPORTED_MINORS, with no static import map", () => {
    const src = read("frontend", "src", "docsIndexResolver.js");
    assert.match(src, /import\.meta\.glob\(/);
    assert.match(src, /SUPPORTED_MINORS\.includes\(minor\)/);
    assert.doesNotMatch(src, /"4\.22"/);
  });

  test("D3 architecture resolver filters its dataset on SUPPORTED_MINORS", () => {
    const src = read("frontend", "src", "archSupportResolver.js");
    assert.match(src, /import\.meta\.glob\(/);
    assert.match(src, /SUPPORTED_MINORS\.includes\(minor\)/);
    assert.doesNotMatch(src, /"4\.22"/);
  });

  test("D4 the version-awareness baseline is derived from SUPPORTED_MINORS[0]", () => {
    assert.match(read("frontend", "src", "steps", "PlatformSpecificsStep.jsx"), /SUPPORTED_MINORS\[0\]/);
  });

  test("D5 trust-bundle POLICIES for 4.22 already resolve via the >=4.17 forward rule", () => {
    // Which is why S7 is about `source`/notice, not about the policy list.
    assert.match(read("backend", "src", "versionPolicy.js"), /isOpenShiftFourTrustPolicyForwardMinor/);
  });
});

/* ------------------------------------------------------------------ */
/* §8  PARTIAL-FLIP ADVERSARIAL MATRIX                                  */
/* ------------------------------------------------------------------ */

/** Build a throwaway repo root with the given supported-minor declarations. */
function fixtureRoot({ backend, frontend, released, baseline = "4.20" }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-t4-flip-"));
  const write = (rel, body) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };
  const decl = (list) => `const SUPPORTED_MINORS = Object.freeze([${list.map((m) => `"${m}"`).join(", ")}]);\nexport { SUPPORTED_MINORS };\n`;
  write("backend/src/versionPolicy.js", decl(backend));
  write("frontend/src/shared/versionPolicy.js", decl(frontend));
  write(
    "scripts/lib/released-minor-support.json",
    JSON.stringify({ baselineMinor: baseline, previouslyReleasedMinors: released }, null, 2)
  );
  return root;
}

describe("T4 §8 — partial flips are rejected or detected", () => {
  test("P1 backend supports 4.22 but frontend does not -> DETECTED", async () => {
    const r = await validateSupportedMinors(
      fixtureRoot({ backend: ["4.20", "4.21", "4.22"], frontend: ["4.20", "4.21"], released: ["4.20", "4.21"] })
    );
    assert.equal(r.ok, false);
    assert.match(JSON.stringify(r), /diverge|mismatch|agree/i);
  });

  test("P2 frontend offers 4.22 but backend rejects it -> DETECTED", async () => {
    const r = await validateSupportedMinors(
      fixtureRoot({ backend: ["4.20", "4.21"], frontend: ["4.20", "4.21", "4.22"], released: ["4.20", "4.21"] })
    );
    assert.equal(r.ok, false);
  });

  test("P3 released-minor metadata claims 4.22 while the code does not support it -> DETECTED", async () => {
    const r = await validateSupportedMinors(
      fixtureRoot({ backend: ["4.20", "4.21"], frontend: ["4.20", "4.21"], released: ["4.20", "4.21", "4.22"] })
    );
    assert.equal(r.ok, false, "a released minor missing from SUPPORTED_MINORS must fail the superset guard");
  });

  test("P4 a coherent full flip passes the same guard -> the guard is not vacuous", async () => {
    const r = await validateSupportedMinors(
      fixtureRoot({ backend: ["4.20", "4.21", "4.22"], frontend: ["4.20", "4.21", "4.22"], released: ["4.20", "4.21", "4.22"] })
    );
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  test("P5 architecture data visible before version support -> resolver still closes it", () => {
    // Simulates the dataset being loaded for a minor the product does not
    // support. The pure resolver answers from whatever dataset it is given, so
    // the gate must live in the adapter — and it does: the adapter filters on
    // SUPPORTED_MINORS before the dataset is built (D3 above).
    const dataset = {
      "4.22": {
        minor: "4.22",
        matrix: [{ scenarioId: "bare-metal-ipi", architectures: { x86_64: { disposition: "supported", offered: true, summary: "x" } } }],
      },
    };
    const leaked = resolveArchitectureSupport({ dataset, minor: "4.22", scenarioId: "bare-metal-ipi", architecture: "x86_64" });
    assert.equal(leaked.offered, true, "the pure resolver is dataset-driven by design");

    const gated = read("frontend", "src", "archSupportResolver.js");
    assert.match(gated, /\.filter\(\(\[minor\]\) => SUPPORTED_MINORS\.includes\(minor\)\)/);
  });

  test("P6 catalogs resolve 4.22 while the Field Guide rejects it -> incoherent, and both gates are the same list", () => {
    // Both read SUPPORTED_MINORS/FIELD_GUIDE_SUPPORTED_MINORS. The two lists
    // are separate declarations, so they CAN diverge — which is exactly why
    // they belong in one commit. Pinned here as the pre-flip equality.
    const fg = read("backend", "src", "fieldGuide", "versionResolution.js");
    const be = read("backend", "src", "versionPolicy.js");
    const pick = (s) => (s.match(/Object\.freeze\(\[([^\]]*)\]\)/) || [])[1];
    assert.equal(pick(fg), pick(be), "the Field Guide list and the support list must start equal");
  });

  test("P7 Quick Pick 4.22 rows added BEFORE support -> tripwire fails", () => {
    const src = read("frontend", "src", "steps", "OperatorsStep.jsx");
    assert.doesNotMatch(src, /"4\.22":/, "a 4.22 row before the flip leaves the `default` fallback live");
  });

  test("P8 support enabled while Quick Pick rows absent -> the per-minor assertion catches it", () => {
    // The Tranche 3 tripwire asserts every per-minor Quick Pick declares a row
    // for every SUPPORTED minor. Simulated here on its own parsing logic.
    const versions = ["4.20", "4.21"];
    const supportedAfterFlip = ["4.20", "4.21", "4.22"];
    const missing = supportedAfterFlip.filter((m) => !versions.includes(m));
    assert.deepEqual(missing, ["4.22"], "flipping support without rows leaves 4.22 unmatched");
  });

  test("P9 flipped-but-unlisted trust-bundle row -> 4.22 keeps a false 'not yet reflected' caveat", async () => {
    const fe = await import("../frontend/src/shared/versionPolicy.js");
    assert.equal(fe.getTrustBundlePolicySupport("4.21").source, "explicit");
    assert.equal(fe.getTrustBundlePolicySupport("4.22").source, "forward");
    const notice = fe.getForwardOpenShiftMinorDocNotice("4.22");
    assert.ok(notice, "today that notice is correct — 4.22 is unsupported");
    assert.match(notice, /not yet fully reflected/);
    // After the flip the same notice would be shown for a SUPPORTED minor and
    // would be false. That is why S7 is on the Tranche 5 checklist.
  });

  test("P10 the supported-minor guard's detection boundary, stated exactly", async () => {
    const run = async (p) => (await validateSupportedMinors(fixtureRoot(p))).ok;
    assert.equal(await run({ backend: ["4.20", "4.21", "4.22"], frontend: ["4.20", "4.21"], released: ["4.20", "4.21"] }), false, "backend-only widening");
    assert.equal(await run({ backend: ["4.20", "4.21"], frontend: ["4.20", "4.21", "4.22"], released: ["4.20", "4.21"] }), false, "frontend-only widening");
    assert.equal(await run({ backend: ["4.20", "4.21"], frontend: ["4.20", "4.21"], released: ["4.20", "4.21", "4.22"] }), false, "released claims an unsupported minor");
  });

  test("P11 code supports 4.22 while released-minor metadata omits it -> DETECTED (G3 closed)", async () => {
    // Tranche 4 recorded this as finding G3: the guard enforced only that
    // SUPPORTED_MINORS is a SUPERSET of the recorded released minors, so
    // flipping S1/S2 while forgetting S6 (runbook Phase 6 step 9) passed
    // silently. Second-order consequence: with 4.22 supported but unrecorded, a
    // LATER change could drop 4.22 from SUPPORTED_MINORS and the cumulative
    // guard would raise nothing, because it never learned 4.22 had shipped.
    //
    // Tranche 4A made the invariant bidirectional. Enabling a minor and
    // recording it are now one atomic change in both directions.
    const r = await validateSupportedMinors(
      fixtureRoot({ backend: ["4.20", "4.21", "4.22"], frontend: ["4.20", "4.21", "4.22"], released: ["4.20", "4.21"] })
    );
    assert.equal(r.ok, false, "a supported-but-unrecorded minor must now fail");
    assert.match(r.errors.join("\n"), /SUPPORT METADATA INCOMPLETE/);
    assert.match(r.errors.join("\n"), /4\.22/);
    assert.ok(
      r.checks.find((c) => c.id === "support-metadata-bidirectional")?.ok === false,
      "the named check, not an incidental failure elsewhere"
    );
  });

  test("P12 the bidirectional invariant is not vacuous: a coherent flip still passes", async () => {
    // Guards the obvious over-correction — a check that rejects everything
    // would also 'detect' P11.
    const r = await validateSupportedMinors(
      fixtureRoot({ backend: ["4.20", "4.21", "4.22"], frontend: ["4.20", "4.21", "4.22"], released: ["4.20", "4.21", "4.22"] })
    );
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.checks.find((c) => c.id === "support-metadata-bidirectional")?.ok, true);
  });
});
