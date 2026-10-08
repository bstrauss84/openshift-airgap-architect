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

const { run, validateFile, ARCHITECTURES } = require("./validate-arch-support.js");

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
