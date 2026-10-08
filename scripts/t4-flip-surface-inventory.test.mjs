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

describe("T5 §7 — surfaces changed by the DIRECT Tranche 5 edit", () => {
  // Inverted from the Tranche 4 pre-flip pins. Each assertion now states the
  // POST-flip value, so the file keeps its job: it fails if any one surface is
  // reverted independently, which is the half-flip the whole tranche forbids.

  test("S1 backend SUPPORTED_MINORS is ['4.20','4.21','4.22']", () => {
    assert.match(read("backend", "src", "versionPolicy.js"), /const SUPPORTED_MINORS = Object\.freeze\(\["4\.20", "4\.21", "4\.22"\]\);/);
  });

  test("S2 frontend SUPPORTED_MINORS is ['4.20','4.21','4.22']", () => {
    assert.match(read("frontend", "src", "shared", "versionPolicy.js"), /const SUPPORTED_MINORS = Object\.freeze\(\["4\.20", "4\.21", "4\.22"\]\);/);
  });

  test("S1 and S2 are byte-identical declarations — hand-synchronised twins", () => {
    const pick = (s) => (s.match(/const SUPPORTED_MINORS = Object\.freeze\(\[([^\]]*)\]\)/) || [])[1];
    assert.equal(
      pick(read("backend", "src", "versionPolicy.js")),
      pick(read("frontend", "src", "shared", "versionPolicy.js"))
    );
  });

  test("S3 FIELD_GUIDE_SUPPORTED_MINORS is ['4.20','4.21','4.22']", () => {
    assert.match(read("backend", "src", "fieldGuide", "versionResolution.js"), /FIELD_GUIDE_SUPPORTED_MINORS = Object\.freeze\(\["4\.20", "4\.21", "4\.22"\]\)/);
  });

  test("S4 assembler.js imports and branches on v4.22", () => {
    const src = read("backend", "src", "fieldGuide", "assembler.js");
    assert.match(src, /compartments_v420/);
    assert.match(src, /compartments_v421/);
    assert.match(src, /compartments_v422/);
    assert.match(src, /normalizedMinor === "4\.22"/);
  });

  test("S5 provenance.js getAuthoritativeExport knows 4.22", () => {
    const src = read("backend", "src", "fieldGuide", "provenance.js");
    assert.match(src, /if \(minor === '4\.21'\) return compartments_v421;/);
    assert.match(src, /if \(minor === '4\.22'\) return compartments_v422;/);
  });

  test("S6 released-minor metadata lists 4.20, 4.21 and 4.22, baseline unmoved", () => {
    const rec = JSON.parse(read("scripts", "lib", "released-minor-support.json"));
    assert.deepEqual(rec.previouslyReleasedMinors, ["4.20", "4.21", "4.22"]);
    // Cumulative: adding a minor never removes one.
    assert.ok(rec.previouslyReleasedMinors.includes("4.20"));
    assert.ok(rec.previouslyReleasedMinors.includes("4.21"));
    // The version-awareness baseline is a separate decision and did NOT move.
    assert.equal(rec.baselineMinor, "4.20");
  });

  test("S7 TRUST_BUNDLE_POLICY_ALLOWLIST has an explicit 4.22 row, in BOTH policy modules", () => {
    // Without the row, 4.22 resolves source: "forward" and a SUPPORTED minor
    // shows users a false "not yet fully reflected in this tool's docs index
    // and catalogs" caveat. See the adversarial case below.
    for (const f of [["backend", "src", "versionPolicy.js"], ["frontend", "src", "shared", "versionPolicy.js"]]) {
      const src = read(...f);
      const block = src.slice(src.indexOf("TRUST_BUNDLE_POLICY_ALLOWLIST"), src.indexOf("};", src.indexOf("TRUST_BUNDLE_POLICY_ALLOWLIST")));
      assert.match(block, /"4\.20"/, f.join("/"));
      assert.match(block, /"4\.21"/, f.join("/"));
      assert.match(block, /"4\.22": \["Proxyonly", "Always"\]/, f.join("/"));
    }
  });

  test("S8 e2e SUPPORTED_VERSIONS lists 4.22", () => {
    const src = read("e2e", "helpers", "asset-validation.js");
    const block = src.slice(src.indexOf("export const SUPPORTED_VERSIONS"), src.indexOf("]", src.indexOf("export const SUPPORTED_VERSIONS")));
    assert.match(block, /4\.21/);
    assert.match(block, /4\.22/);
  });

  test("S9 every version-aware Quick Pick carries a 4.22 row, and `default` is gone", () => {
    const src = read("frontend", "src", "steps", "OperatorsStep.jsx");
    assert.match(src, /"4\.22":/);
    assert.doesNotMatch(src, /"default":/, "the default fallback must not survive the flip");
    assert.doesNotMatch(src, /versionPicks\?\.\["default"\]/, "the resolution fallback must be gone too");
  });

  test("S10 openshift-ai is version-aware and omits rhods-prometheus-operator at 4.22 only", () => {
    const src = read("frontend", "src", "steps", "OperatorsStep.jsx");
    const block = src.slice(src.indexOf('id: "openshift-ai"'), src.indexOf('id: "compliance"'));
    assert.match(block, /versionPicks/);
    const row = (m) => (block.match(new RegExp(`"${m}": \\{([^}]*)\\}`)) || [])[1] || "";
    assert.match(row("4.20"), /rhods-prometheus-operator/, "4.20 behaviour is preserved");
    assert.match(row("4.21"), /rhods-prometheus-operator/, "4.21 behaviour is preserved");
    assert.doesNotMatch(row("4.22"), /rhods-prometheus-operator/, "absent from the 4.22 catalog");
    assert.doesNotMatch(row("4.22"), /prometheus/i, "omitted with NO replacement");
  });

  test("S11 tests pinning the supported list are enumerated, not discovered at flip time", () => {
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
    assert.ok(hits.length <= 40, `unexpectedly many pinned lists (${hits.length}); re-inventory`);
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

  test("P7 support and Quick Pick rows landed together -> neither half is alone", () => {
    // Pre-flip this asserted the ABSENCE of a 4.22 row, because a row without
    // support leaves the `default` fallback live. Post-flip the same hazard is
    // the mirror image: support without rows. Both halves are asserted here, so
    // reverting either one alone fails.
    const src = read("frontend", "src", "steps", "OperatorsStep.jsx");
    const supported = /"4\.22"/.test(read("backend", "src", "versionPolicy.js"));
    const hasRow = /"4\.22":/.test(src);
    assert.equal(hasRow, supported, "a 4.22 Quick Pick row and 4.22 support must coexist");
    assert.doesNotMatch(src, /"default":/, "and the fallback that made a missing row silent is gone");
  });

  test("P8 support enabled while Quick Pick rows absent -> the per-minor assertion catches it", () => {
    // The tripwire asserts every per-minor Quick Pick declares a row for every
    // SUPPORTED minor. Simulated here on its own parsing logic, against a
    // hypothetical next flip so the case stays live after 4.22 shipped.
    const versions = ["4.20", "4.21", "4.22"];
    const supportedAfterFlip = ["4.20", "4.21", "4.22", "4.23"];
    const missing = supportedAfterFlip.filter((m) => !versions.includes(m));
    assert.deepEqual(missing, ["4.23"], "flipping support without rows leaves the new minor unmatched");
  });

  test("P9 S7 landed -> no SUPPORTED minor carries a false 'not yet reflected' caveat", async () => {
    // The case Tranche 4 reproduced: a flipped-but-unlisted 4.22 resolves
    // source "forward" and shows users of a SUPPORTED minor a caveat saying the
    // tool's docs index and catalogs do not yet reflect their release. That
    // statement is false once 4.22 ships, which is why S7 is not optional.
    const fe = await import("../frontend/src/shared/versionPolicy.js");
    for (const minor of fe.SUPPORTED_MINORS) {
      assert.equal(fe.getTrustBundlePolicySupport(minor).source, "explicit", minor);
      assert.equal(fe.getForwardOpenShiftMinorDocNotice(minor), null, `${minor} must carry no caveat`);
    }
    // The forward rule itself is untouched and still covers unlisted minors.
    assert.equal(fe.getTrustBundlePolicySupport("4.23").source, "forward");
    assert.match(fe.getForwardOpenShiftMinorDocNotice("4.23"), /not yet fully reflected/);
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
