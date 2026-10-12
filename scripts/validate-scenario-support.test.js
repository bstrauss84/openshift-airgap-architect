"use strict";

/**
 * Tests for the platform x installation-method scenario-surface guard
 * (v2.1 Tranche 7C.1).
 *
 * The guard exists because a newly supported platform/method combination can
 * appear upstream with no change to install-config fields, AgentConfig fields
 * or CPU architectures — so field-level and architecture-level onboarding
 * diffs cannot detect it. Nutanix + Agent is the worked example: Red Hat's
 * Agent-based Installer book lists `nutanix` in 4.20, 4.21 and 4.22, and this
 * product models only `nutanix-ipi`.
 *
 * Every fail-closed rule below is proven by making the tracked data violate it,
 * so none of them can rot into a rule that is checked but never enforced.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { run, diffMinors, loadScenarioIds } = require("./validate-scenario-support.js");

const REPO_ROOT = path.join(__dirname, "..");
const MINORS = ["4.20", "4.21", "4.22"];
const DATA_DIR = path.join(REPO_ROOT, "data", "scenario-support");

const tracked = (minor) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${minor}.json`), "utf8"));
const mutable = (minor) => JSON.parse(JSON.stringify(tracked(minor)));

function quietly(fn) {
  const err = console.error;
  const log = console.log;
  const lines = [];
  console.error = (...a) => lines.push(a.join(" "));
  console.log = (...a) => lines.push(a.join(" "));
  try {
    return { status: fn(), output: lines.join("\n") };
  } finally {
    console.error = err;
    console.log = log;
  }
}

/** A root with only what the guard reads, so one cell can be corrupted. */
function fixtureRoot(docsByMinor) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-scenario-"));
  fs.mkdirSync(path.join(root, "data", "scenario-support"), { recursive: true });
  fs.mkdirSync(path.join(root, "shared"), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, "shared", "scenarioId.js"), path.join(root, "shared", "scenarioId.js"));
  for (const [m, doc] of Object.entries(docsByMinor)) {
    fs.writeFileSync(path.join(root, "data", "scenario-support", `${m}.json`), JSON.stringify(doc, null, 2));
  }
  return root;
}

/** Mutate one cell of a 4.22 fixture and run the guard over just that minor. */
function withCell(platform, method, patch) {
  const doc = mutable("4.22");
  const cell = doc.matrix.find((r) => r.platform === platform && r.method === method);
  assert.ok(cell, `fixture has no ${platform}/${method} cell`);
  Object.assign(cell, patch);
  const root = fixtureRoot({ "4.22": doc });
  const res = quietly(() => run(root, ["4.22"]));
  fs.rmSync(root, { recursive: true, force: true });
  return res;
}

describe("scenario surface — tracked data", () => {
  test("the tracked repository passes", () => {
    const { status } = quietly(() => run(REPO_ROOT, MINORS));
    assert.strictEqual(status, 0);
  });

  test("every supported minor carries the full 6 x 3 grid", () => {
    for (const m of MINORS) {
      const doc = tracked(m);
      assert.strictEqual(doc.matrix.length, 18, `${m} has ${doc.matrix.length} cells, expected 18`);
    }
  });

  test("the guard is not vacuous — a fixture copy of the tracked data also passes", () => {
    const root = fixtureRoot({ "4.22": mutable("4.22") });
    const { status } = quietly(() => run(root, ["4.22"]));
    assert.strictEqual(status, 0);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("a declared supported minor with no file fails closed", () => {
    const root = fixtureRoot({ "4.22": mutable("4.22") });
    const { status, output } = quietly(() => run(root, ["4.21", "4.22"]));
    assert.strictEqual(status, 1);
    assert.match(output, /4\.21 has no data\/scenario-support/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("scenario surface — the Nutanix Agent gap is recorded, not lost", () => {
  for (const m of MINORS) {
    test(`${m}: Nutanix/Agent is recorded as a documentation conflict, not flattened`, () => {
      /**
       * CORRECTED IN TRANCHE 7C.2. This previously asserted
       * `upstream === "supported"`, which flattened a real disagreement
       * between Red Hat's own sources:
       *   AGAINST — installation-overview Table 1.1 "Supported platforms"
       *     leaves the Agent-based Installer cell BLANK for Nutanix (support
       *     is a literal "X" there, and Bare metal and vSphere both carry one
       *     in that column, so the blank is meaningful).
       *   FOR — the Agent book's "Supported platforms" list reads
       *     "baremetal vsphere nutanix external none", and the Nutanix book
       *     says you can install on Nutanix with the Agent-based Installer.
       * Both verified verbatim in 4.20, 4.21 and 4.22. Recording it as
       * `supported` would have hidden a documentation defect.
       */
      const cell = tracked(m).matrix.find((r) => r.platform === "Nutanix" && r.method === "Agent");
      assert.ok(cell, "no Nutanix/Agent cell");
      assert.strictEqual(cell.upstream, "documentation-conflict");
      assert.strictEqual(cell.oaa, "intentionally-not-modelled");
      assert.strictEqual(cell.scenarioId, null);
      // Both sides of the conflict must be cited, or it is not a record of one.
      assert.match(cell.upstreamReason, /UNRECONCILED CONFLICT/);
      assert.match(cell.upstreamReason, /Table 1\.1/);
      assert.match(cell.upstreamReason, /baremetal vsphere nutanix external none/);
      assert.deepStrictEqual(
        [...cell.provenance].sort(),
        ["AGENT_PLATFORMS", "NUTANIX_BOOK", "OVERVIEW_T11"]
      );
      // The reason must point at the tracking item, or the gap becomes folklore.
      assert.match(cell.oaaReason, /DOC-200/);
    });
  }

  test("Nutanix/UPI is upstream-unsupported, and OAA agrees", () => {
    const cell = tracked("4.22").matrix.find((r) => r.platform === "Nutanix" && r.method === "UPI");
    assert.strictEqual(cell.upstream, "not-supported");
    assert.strictEqual(cell.scenarioId, null);
  });
});

describe("scenario surface — fail-closed rules each actually fire", () => {
  test("an unreviewed cell fails", () => {
    const { status, output } = withCell("Nutanix", "Agent", { oaa: "unknown-needs-review" });
    assert.strictEqual(status, 1);
    assert.match(output, /unknown-needs-review/);
  });

  test("a disposition outside the vocabulary fails", () => {
    const { status, output } = withCell("Nutanix", "Agent", { oaa: "probably-fine" });
    assert.strictEqual(status, 1);
    assert.match(output, /not in the vocabulary/);
  });

  test("modelling a combination the documentation denies fails", () => {
    const { status, output } = withCell("Nutanix", "UPI", {
      oaa: "modelled",
      scenarioId: "nutanix-upi",
      oaaReason: "a long enough reason string to pass the minimum length check",
    });
    assert.strictEqual(status, 1);
    assert.match(output, /documents as unsupported/);
  });

  test("claiming modelled with a scenarioId the product cannot produce fails", () => {
    const { status, output } = withCell("Nutanix", "Agent", {
      oaa: "modelled",
      scenarioId: "nutanix-agent",
      oaaReason: "a long enough reason string to pass the minimum length check",
    });
    assert.strictEqual(status, 1);
    assert.match(output, /not produced by shared\/scenarioId\.js/);
  });

  test("modelling a combination whose upstream sources conflict fails closed", () => {
    // Added with the documentation-conflict vocabulary in Tranche 7C.2.
    const { status, output } = withCell("Nutanix", "Agent", {
      oaa: "modelled",
      scenarioId: "nutanix-ipi",
      oaaReason: "a long enough reason string to pass the minimum length check",
    });
    assert.strictEqual(status, 1);
    assert.match(output, /unreconciled documentation conflict/);
  });

  test("a cell with no provenance fails", () => {
    const { status, output } = withCell("Bare Metal", "IPI", { provenance: [] });
    assert.strictEqual(status, 1);
    assert.match(output, /no provenance/);
  });

  test("provenance pointing at an undeclared source fails", () => {
    const { status, output } = withCell("Bare Metal", "IPI", { provenance: ["MADE_UP"] });
    assert.strictEqual(status, 1);
    assert.match(output, /is not a declared source/);
  });

  test("an unexplained cell fails", () => {
    const { status, output } = withCell("Bare Metal", "IPI", { oaaReason: "ok" });
    assert.strictEqual(status, 1);
    assert.match(output, /oaaReason is missing or too short/);
  });

  test("a missing platform/method combination fails", () => {
    const doc = mutable("4.22");
    doc.matrix = doc.matrix.filter((r) => !(r.platform === "IBM Cloud" && r.method === "Agent"));
    const root = fixtureRoot({ "4.22": doc });
    const { status, output } = quietly(() => run(root, ["4.22"]));
    assert.strictEqual(status, 1);
    assert.match(output, /missing cell for IBM Cloud\/Agent/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("a scenarioId the product produces but no cell covers fails", () => {
    const doc = mutable("4.22");
    const cell = doc.matrix.find((r) => r.scenarioId === "ibm-cloud-ipi");
    cell.scenarioId = null;
    cell.oaa = "intentionally-not-modelled";
    const root = fixtureRoot({ "4.22": doc });
    const { status, output } = quietly(() => run(root, ["4.22"]));
    assert.strictEqual(status, 1);
    assert.match(output, /produces "ibm-cloud-ipi" but no cell covers it/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("a source citing another minor's URL fails — cross-minor backfill", () => {
    const doc = mutable("4.22");
    doc.sources[0].url = doc.sources[0].url.replace("/4.22/", "/4.20/");
    const root = fixtureRoot({ "4.22": doc });
    const { status, output } = quietly(() => run(root, ["4.22"]));
    assert.strictEqual(status, 1);
    assert.match(output, /does not cite this minor's own URL/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("a non-html-single source URL fails", () => {
    const doc = mutable("4.22");
    doc.sources[0].url = doc.sources[0].url.replace("/html-single/", "/html/");
    const root = fixtureRoot({ "4.22": doc });
    const { status, output } = quietly(() => run(root, ["4.22"]));
    assert.strictEqual(status, 1);
    assert.match(output, /not an html-single/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("scenario surface — the onboarding diff", () => {
  test("identical minors produce no diff", () => {
    assert.deepStrictEqual(diffMinors(tracked("4.21"), tracked("4.22")), []);
  });

  test("a newly supported combination is reported as a change", () => {
    // The Nutanix + Agent shape: upstream changes between minors.
    const a = mutable("4.21");
    const b = mutable("4.22");
    a.matrix.find((r) => r.platform === "Nutanix" && r.method === "Agent").upstream = "not-supported";
    const diffs = diffMinors(a, b);
    assert.strictEqual(diffs.length, 1);
    assert.deepStrictEqual(diffs[0], {
      cell: "Nutanix/Agent",
      kind: "upstream-changed",
      from: "not-supported",
      to: "documentation-conflict",
    });
  });

  test("a conflict resolving to supported in a later minor is reported", () => {
    // What it should look like if Red Hat fixes the Nutanix Agent discrepancy.
    const a = mutable("4.21");
    const b = mutable("4.22");
    b.matrix.find((r) => r.platform === "Nutanix" && r.method === "Agent").upstream = "supported";
    const diffs = diffMinors(a, b);
    assert.ok(
      diffs.some((d) => d.cell === "Nutanix/Agent" && d.from === "documentation-conflict" && d.to === "supported"),
      JSON.stringify(diffs)
    );
  });

  test("a removed combination is reported", () => {
    const a = mutable("4.21");
    const b = mutable("4.22");
    b.matrix = b.matrix.filter((r) => !(r.platform === "IBM Cloud" && r.method === "IPI"));
    const diffs = diffMinors(a, b);
    assert.ok(diffs.some((d) => d.cell === "IBM Cloud/IPI" && d.kind === "removed-cell"));
  });

  test("an OAA disposition change is reported separately from an upstream change", () => {
    const a = mutable("4.21");
    const b = mutable("4.22");
    b.matrix.find((r) => r.platform === "Nutanix" && r.method === "Agent").oaa = "modelled";
    const diffs = diffMinors(a, b);
    assert.ok(diffs.some((d) => d.kind === "oaa-changed"));
  });
});

describe("scenario surface — scenarioId extraction", () => {
  test("reads the product's real scenario list", () => {
    const ids = loadScenarioIds(REPO_ROOT);
    for (const expected of ["bare-metal-agent", "vsphere-upi", "nutanix-ipi", "ibm-cloud-ipi"]) {
      assert.ok(ids.has(expected), `missing ${expected}`);
    }
    assert.ok(!ids.has("nutanix-agent"), "nutanix-agent must NOT be produced by the product today");
  });
});
