"use strict";

/**
 * Tests for the architecture-support matrix guard (D3 / DOC-156).
 *
 * Proves the guard actually catches the defect classes it exists for, rather
 * than only agreeing with the data that happens to be committed today:
 *
 *   1. the real tracked data for every minor validates;
 *   2. a cell with no provenance is rejected;
 *   3. a cell with provenance pointing at an undeclared source is rejected;
 *   4. an `unknown` cell that is nonetheless offered is rejected (fail closed);
 *   5. a source URL carrying another minor's provenance is rejected;
 *   6. deleting the no-mixed-architecture statement is rejected;
 *   7. deleting the export-binary standing rule is rejected;
 *   8. an empty data directory is an error, never a silent pass;
 *   9. the tracked data really does keep 4.20, 4.21 and 4.22 separate, and
 *      offers nothing that is not `supported`.
 *
 * Hermetic: synthetic fixtures under os.tmpdir() plus read-only passes over the
 * tracked data. No network.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { run, runSupportContract, validateFile, ARCHITECTURES } = require("./validate-arch-support.js");

const REPO_ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(REPO_ROOT, "data", "arch-support");
const MINORS = ["4.20", "4.21", "4.22"];

function readTracked(minor) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${minor}.json`), "utf8"));
}

/** Run validateFile against one in-memory document and return its errors. */
function errorsFor(minor, doc) {
  const errors = [];
  validateFile(`${minor}.json`, JSON.stringify(doc), errors);
  return errors;
}

/** A deep clone of the tracked document, as the base for mutation fixtures. */
function mutable(minor) {
  return JSON.parse(JSON.stringify(readTracked(minor)));
}

describe("arch-support guard — tracked data", () => {
  test("every tracked minor validates", () => {
    assert.strictEqual(run(REPO_ROOT), 0);
  });

  test("4.20, 4.21 and 4.22 are all present", () => {
    const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json")).sort();
    assert.deepStrictEqual(files, MINORS.map((m) => `${m}.json`));
  });

  test("every cell covers exactly the four architectures", () => {
    for (const minor of MINORS) {
      for (const row of readTracked(minor).matrix) {
        assert.deepStrictEqual(
          Object.keys(row.architectures).sort(),
          [...ARCHITECTURES].sort(),
          `${minor} ${row.platform}/${row.installMethod}`
        );
      }
    }
  });

  test("every cell is resolved — no `unknown` survives in tracked data", () => {
    // D3 asset-complete contract: the matrix ships with every platform x
    // install-method x architecture combination decided from same-minor
    // evidence. `unknown` remains a legal value in the schema so a future
    // onboarding can record an in-flight gap, but shipping one would mean
    // carrying an unresolved architecture decision into runtime migration.
    const unresolved = [];
    for (const minor of MINORS) {
      for (const row of readTracked(minor).matrix) {
        for (const [arch, cell] of Object.entries(row.architectures)) {
          if (cell.disposition === "unknown") {
            unresolved.push(`${minor} ${row.platform}/${row.installMethod} ${arch}`);
          }
        }
      }
    }
    assert.deepEqual(unresolved, [], `Unresolved architecture cells:\n${unresolved.join("\n")}`);
  });

  test("every cell disposition is drawn from the declared vocabulary", () => {
    const allowed = new Set(["supported", "locked", "hidden", "unknown"]);
    for (const minor of MINORS) {
      const doc = readTracked(minor);
      for (const row of doc.matrix) {
        for (const [arch, cell] of Object.entries(row.architectures)) {
          assert.ok(allowed.has(cell.disposition), `${minor} ${row.platform}/${row.installMethod} ${arch}`);
          assert.ok(
            Object.prototype.hasOwnProperty.call(doc.dispositions, cell.disposition),
            `disposition "${cell.disposition}" is not documented in dispositions`
          );
        }
      }
    }
  });

  test("nothing other than a supported cell is offered (fail closed)", () => {
    for (const minor of MINORS) {
      for (const row of readTracked(minor).matrix) {
        for (const [arch, cell] of Object.entries(row.architectures)) {
          if (cell.disposition !== "supported") {
            assert.strictEqual(cell.offered, false, `${minor} ${row.platform}/${row.installMethod} ${arch}`);
          }
        }
      }
    }
  });

  test("every source URL carries its own minor's provenance", () => {
    for (const minor of MINORS) {
      for (const [id, src] of Object.entries(readTracked(minor).sources)) {
        const m = src.url.match(/openshift_container_platform\/(\d+\.\d+)/);
        if (m) assert.strictEqual(m[1], minor, `${minor} source ${id}`);
      }
    }
  });

  test("no file implies heterogeneous or mixed-architecture support", () => {
    for (const minor of MINORS) {
      const doc = readTracked(minor);
      assert.strictEqual(doc.homogeneousOnly.value, true);
      assert.strictEqual(doc.homogeneousOnly.mixedArchitectureSupported, false);
      assert.ok(doc.homogeneousOnly.provenance.length > 0);
    }
  });

  test("the ARM64 RHEL 9 FIPS export conclusion is recorded and not re-inverted", () => {
    for (const minor of MINORS) {
      const doc = readTracked(minor);
      // aarch64 is excluded from CLUSTER-NODE FIPS validation ...
      assert.ok(doc.fipsValidatedArchitectures.excludes.includes("aarch64"));
      assert.strictEqual(doc.fipsValidatedArchitectures.axis, "targetCluster");
      // ... and that must not be restated as an export-binary restriction.
      const rule = doc.architectureAxes.exportBinary.standingRule;
      assert.match(rule, /openshift-install-rhel9-arm64\.tar\.gz/);
      assert.match(rule, /CORRECT and is not a defect/);
    }
  });

  test("the matrix is keyed by install method, not by platform alone", () => {
    for (const minor of MINORS) {
      const bm = readTracked(minor).matrix.filter((r) => r.platform === "bare-metal");
      assert.deepStrictEqual(bm.map((r) => r.installMethod).sort(), ["agent", "ipi", "upi"]);
    }
  });
});

describe("arch-support guard — rejects real defects", () => {
  test("a cell with no provenance is rejected", () => {
    const doc = mutable("4.22");
    delete doc.matrix[0].architectures.x86_64.provenance;
    assert.ok(errorsFor("4.22", doc).some((e) => /provenance must cite at least one source/.test(e)));
  });

  test("provenance pointing at an undeclared source is rejected", () => {
    const doc = mutable("4.22");
    doc.matrix[0].architectures.x86_64.provenance = [{ source: "book:atlantis", quote: "x" }];
    assert.ok(errorsFor("4.22", doc).some((e) => /undeclared source "book:atlantis"/.test(e)));
  });

  test("an unknown cell that is offered anyway is rejected", () => {
    // The tracked data carries no `unknown` cells any more, so this fixture
    // synthesises one. The vocabulary is retained on purpose — a future
    // onboarding needs a way to record an in-flight evidence gap — and the
    // guard must keep forcing such a cell to stay closed.
    const doc = mutable("4.22");
    const cell = doc.matrix[0].architectures.s390x;
    cell.disposition = "unknown";
    cell.offered = true;
    assert.ok(errorsFor("4.22", doc).some((e) => /only a supported cell may be offered/.test(e)));
  });

  test("a locked cell that is offered anyway is rejected", () => {
    const doc = mutable("4.22");
    const cell = doc.matrix[0].architectures.s390x;
    cell.disposition = "locked";
    cell.offered = true;
    assert.ok(errorsFor("4.22", doc).some((e) => /only a supported cell may be offered/.test(e)));
  });

  test("a stub reason is rejected", () => {
    const doc = mutable("4.22");
    doc.matrix[0].architectures.x86_64.reason = "yes";
    assert.ok(errorsFor("4.22", doc).some((e) => /reason must be an explicit sentence/.test(e)));
  });

  test("a cross-minor source URL is rejected", () => {
    const doc = mutable("4.22");
    doc.sources["book:vsphere"].url =
      "https://docs.redhat.com/en/documentation/openshift_container_platform/4.21/html-single/installing_on_vmware_vsphere/index";
    assert.ok(errorsFor("4.22", doc).some((e) => /carries OpenShift 4\.21 provenance in the 4\.22 matrix/.test(e)));
  });

  test("removing the no-mixed-architecture statement is rejected", () => {
    const doc = mutable("4.22");
    doc.homogeneousOnly.mixedArchitectureSupported = true;
    assert.ok(errorsFor("4.22", doc).some((e) => /mixedArchitectureSupported must be false/.test(e)));
  });

  test("removing the export-binary standing rule is rejected", () => {
    const doc = mutable("4.22");
    doc.architectureAxes.exportBinary.standingRule = "see the FIPS section";
    assert.ok(errorsFor("4.22", doc).some((e) => /openshift-install-rhel9-arm64\.tar\.gz/.test(e)));
  });

  test("dropping an architecture column is rejected", () => {
    const doc = mutable("4.22");
    delete doc.matrix[0].architectures.s390x;
    assert.ok(errorsFor("4.22", doc).some((e) => /must cover exactly/.test(e)));
  });

  test("a filename/minor mismatch is rejected", () => {
    const doc = mutable("4.22");
    doc.minor = "4.21";
    assert.ok(errorsFor("4.22", doc).some((e) => /but the filename says 4\.22/.test(e)));
  });

  test("an empty data directory is an error, not a silent pass", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-arch-"));
    fs.mkdirSync(path.join(root, "data", "arch-support"), { recursive: true });
    assert.strictEqual(run(root), 1);
  });

  test("a missing data directory is an error", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-arch-"));
    assert.strictEqual(run(root), 1);
  });
});

/* ------------------------------------------------------------------ */
/* Support-contract guard (v2.1 Tranche 7C)                             */
/* ------------------------------------------------------------------ */

/**
 * Builds a throwaway repo root containing only what the support contract
 * reads, so a fixture can express "this minor diverges by method" without
 * touching tracked data.
 */
function fixtureRoot(docsByMinor, { projectAll = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-arch-contract-"));
  const canonical = path.join(root, "data", "arch-support");
  const projection = path.join(root, "frontend", "src", "data", "arch-support");
  fs.mkdirSync(canonical, { recursive: true });
  fs.mkdirSync(projection, { recursive: true });
  const { project } = require("./sync-arch-support.js");
  for (const [minor, doc] of Object.entries(docsByMinor)) {
    fs.writeFileSync(path.join(canonical, `${minor}.json`), JSON.stringify(doc, null, 2));
    if (projectAll) {
      fs.writeFileSync(path.join(projection, `${minor}.json`), JSON.stringify(project(doc), null, 2));
    }
  }
  return root;
}

/** Silence the guard's own console output while asserting its exit code. */
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

describe("arch-support support contract — tracked data", () => {
  test("the tracked repository satisfies the contract for all supported minors", () => {
    const { status } = quietly(() => runSupportContract(REPO_ROOT, MINORS));
    assert.strictEqual(status, 0);
  });

  test("an empty supported-minor list fails rather than passing vacuously", () => {
    const { status } = quietly(() => runSupportContract(REPO_ROOT, []));
    assert.strictEqual(status, 1);
  });

  test("a supported minor with no canonical data fails closed", () => {
    // 4.23 is unsupported and has no matrix; claiming it is supported must fail.
    const { status, output } = quietly(() => runSupportContract(REPO_ROOT, [...MINORS, "4.23"]));
    assert.strictEqual(status, 1);
    assert.match(output, /4\.23 has no usable canonical matrix/);
  });
});

describe("arch-support support contract — synthetic fixtures", () => {
  test("a missing frontend projection fails closed", () => {
    const root = fixtureRoot({ "4.22": mutable("4.22") }, { projectAll: false });
    const { status, output } = quietly(() => runSupportContract(root, ["4.22"]));
    assert.strictEqual(status, 1);
    assert.match(output, /no usable frontend projection/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("a stale frontend projection fails closed", () => {
    const doc = mutable("4.22");
    const root = fixtureRoot({ "4.22": doc });
    // Drift the projection the way an un-synced edit would.
    const projFile = path.join(root, "frontend", "src", "data", "arch-support", "4.22.json");
    const proj = JSON.parse(fs.readFileSync(projFile, "utf8"));
    proj.matrix[0].architectures.x86_64.offered = false;
    fs.writeFileSync(projFile, JSON.stringify(proj, null, 2));

    const { status, output } = quietly(() => runSupportContract(root, ["4.22"]));
    assert.strictEqual(status, 1);
    assert.match(output, /projection for 4\.22 is out of date/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("a scenario offering zero architectures fails closed", () => {
    // This is what "every architecture greyed out" looks like in the data.
    const doc = mutable("4.22");
    for (const arch of ARCHITECTURES) doc.matrix[0].architectures[arch].offered = false;
    const root = fixtureRoot({ "4.22": doc });
    const { status, output } = quietly(() => runSupportContract(root, ["4.22"]));
    assert.strictEqual(status, 1);
    assert.match(output, /offers NO architecture/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("architecture that differs by install method fails closed, demanding a product decision", () => {
    /**
     * The guard that protects the CURRENT Blueprint design. Blueprint presents
     * architecture at platform level, which is only correct while every install
     * method for a platform agrees. Today they all do, at every supported minor.
     * If a future onboarding ever changes that, this must stop the release
     * rather than let the UI silently intersect the difference away.
     */
    const doc = mutable("4.22");
    const ipi = doc.matrix.find((r) => r.scenarioId === "bare-metal-ipi");
    const agent = doc.matrix.find((r) => r.scenarioId === "bare-metal-agent");
    assert.ok(ipi && agent, "fixture needs both bare-metal rows");
    // Make aarch64 available to the agent installer but not to IPI.
    ipi.architectures.aarch64.offered = false;

    const root = fixtureRoot({ "4.22": doc });
    const { status, output } = quietly(() => runSupportContract(root, ["4.22"]));
    assert.strictEqual(status, 1);
    assert.match(output, /DIFFERS BY INSTALL METHOD/);
    assert.match(output, /symmetric/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("the divergence check is not vacuous — the unmodified fixture passes", () => {
    const root = fixtureRoot({ "4.22": mutable("4.22") });
    const { status } = quietly(() => runSupportContract(root, ["4.22"]));
    assert.strictEqual(status, 0);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

/* ------------------------------------------------------------------ */
/* Upstream vs OAA disposition (v2.1 Tranche 7C.2)                      */
/* ------------------------------------------------------------------ */

describe("arch-support — upstream support is recorded separately from Architect's", () => {
  /**
   * The point of the split: Red Hat supporting more than Architect exposes is
   * a deliberate narrowing, not a defect. Only three things are defects —
   * offering what the docs deny, offering what nobody has decided, and
   * narrowing without writing down why.
   */
  test("every tracked cell declares an upstream status, a reason and its own minor's URL", () => {
    for (const minor of MINORS) {
      const doc = readTracked(minor);
      for (const row of doc.matrix) {
        for (const [arch, cell] of Object.entries(row.architectures)) {
          const at = `${minor} ${row.scenarioId}.${arch}`;
          assert.ok(
            ["supported", "unsupported", "documentation-conflict", "unknown-needs-review"].includes(cell.upstreamSupport),
            `${at}: bad upstreamSupport ${cell.upstreamSupport}`
          );
          assert.ok((cell.upstreamReason || "").length >= 40, `${at}: upstreamReason too short`);
          assert.match(cell.upstreamSource || "", /^https:\/\/docs\.redhat\.com\/.*\/html-single\//, `${at}: bad upstreamSource`);
          assert.ok((cell.upstreamSource || "").includes(`/${minor}/`), `${at}: upstreamSource cites another minor`);
        }
      }
    }
  });

  test("nothing offered contradicts the documentation", () => {
    for (const minor of MINORS) {
      for (const row of readTracked(minor).matrix) {
        for (const [arch, cell] of Object.entries(row.architectures)) {
          if (cell.offered) {
            assert.strictEqual(
              cell.upstreamSupport,
              "supported",
              `${minor} ${row.scenarioId}.${arch} is offered but upstream is ${cell.upstreamSupport}`
            );
          }
        }
      }
    }
  });

  test("the three DOC-205 cells carry their resolved dispositions", () => {
    for (const minor of MINORS) {
      const by = {};
      for (const row of readTracked(minor).matrix) by[row.scenarioId] = row.architectures;

      // Resolved: generic commercial-ARM boilerplate does not override the
      // region-specific Government regions row.
      assert.strictEqual(by["aws-govcloud-ipi"].aarch64.upstreamSupport, "unsupported", `${minor} govcloud-ipi/aarch64`);
      assert.strictEqual(by["aws-govcloud-ipi"].aarch64.offered, false);

      // Resolved: an AMI existing is not a support statement.
      assert.strictEqual(by["aws-govcloud-upi"].aarch64.upstreamSupport, "unknown-needs-review", `${minor} govcloud-upi/aarch64`);
      assert.strictEqual(by["aws-govcloud-upi"].aarch64.offered, false, "an undecided cell must fail closed");

      // Resolved: upstream-supported, Architect narrows on purpose.
      const s390x = by["bare-metal-agent"].s390x;
      assert.strictEqual(s390x.upstreamSupport, "supported", `${minor} bare-metal-agent/s390x`);
      assert.strictEqual(s390x.offered, false);
      assert.ok((s390x.oaaScopeDecision || "").length >= 80, "a deliberate narrowing must explain itself");
      assert.match(s390x.oaaScopeDecision, /DOC-205/);
      // The corrected rationale must no longer imply Red Hat denies it.
      assert.match(s390x.reason, /CORRECTED IN TRANCHE 7C\.2/);
      assert.ok(
        s390x.provenance.some((p) => /agent\.s390x\.iso image on the bare-metal machines/.test(p.quote)),
        "the governing sentence must be cited"
      );
    }
  });
});

describe("arch-support — upstream/OAA rules each fail closed", () => {
  const caseFor = (minor, scenarioId, arch, patch) => {
    const doc = mutable(minor);
    const cell = doc.matrix.find((r) => r.scenarioId === scenarioId).architectures[arch];
    Object.assign(cell, patch);
    return errorsFor(minor, doc);
  };

  test("offering a cell the documentation calls unsupported fails", () => {
    const errs = caseFor("4.22", "vsphere-ipi", "aarch64", { disposition: "supported", offered: true });
    assert.ok(errs.some((e) => /OFFERED but upstream documentation says unsupported/.test(e)), errs.join("\n"));
  });

  test("offering an undecided cell fails", () => {
    const errs = caseFor("4.22", "aws-govcloud-upi", "aarch64", { disposition: "supported", offered: true });
    assert.ok(errs.some((e) => /upstream support is undecided/.test(e)), errs.join("\n"));
  });

  test("offering a cell where Red Hat's sources conflict fails", () => {
    const errs = caseFor("4.22", "nutanix-ipi", "aarch64", {
      disposition: "supported",
      offered: true,
      upstreamSupport: "documentation-conflict",
    });
    assert.ok(errs.some((e) => /sources conflict/.test(e)), errs.join("\n"));
  });

  test("narrowing below upstream support without a scope decision fails", () => {
    const errs = caseFor("4.22", "bare-metal-agent", "s390x", { oaaScopeDecision: undefined });
    assert.ok(errs.some((e) => /requires an explicit oaaScopeDecision/.test(e)), errs.join("\n"));
  });

  test("a scope decision on a cell that does not narrow fails", () => {
    const errs = caseFor("4.22", "bare-metal-agent", "x86_64", {
      oaaScopeDecision: "x".repeat(100),
    });
    assert.ok(errs.some((e) => /declares an oaaScopeDecision but is not/.test(e)), errs.join("\n"));
  });

  test("an upstreamSource citing another minor fails — cross-minor backfill", () => {
    const errs = caseFor("4.22", "bare-metal-ipi", "x86_64", {
      upstreamSource: "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html-single/installing_on_bare_metal",
    });
    assert.ok(errs.some((e) => /does not cite this minor's own URL/.test(e)), errs.join("\n"));
  });

  test("an upstream status outside the vocabulary fails", () => {
    const errs = caseFor("4.22", "bare-metal-ipi", "x86_64", { upstreamSupport: "probably" });
    assert.ok(errs.some((e) => /upstreamSupport must be one of/.test(e)), errs.join("\n"));
  });
});
