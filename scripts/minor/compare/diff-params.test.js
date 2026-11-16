"use strict";

/**
 * Tests for the promoted parameter-delta comparator.
 *
 * The central case is the F1 regression: the harvested version read `comment`
 * while its producer emitted `description`, so description-change detection was
 * structurally dead and the 4.20 -> 4.21 delta reported `changed: 0`. The
 * "detects a description change" test is the one that would have caught it.
 *
 * Hermetic: in-memory fixtures plus os.tmpdir() for the CLI cases. No network.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { diffParams, INPUT_CONTRACT } = require("./diff-params.js");

const SCRIPT = path.join(__dirname, "diff-params.js");

function extraction(source, parameters) {
  return { source, extractedDate: "2026-10-06T00:00:00.000Z", parameters };
}

function run(baselineParams, targetParams) {
  return diffParams({
    baseline: extraction("installer release-4.21", baselineParams),
    target: extraction("installer release-4.22", targetParams),
    previousMinor: "4.21",
    minor: "4.22",
  });
}

const BASE = { path: "baseDomain", type: "string", required: true, description: "Base domain." };

describe("diff-params", () => {
  describe("finding F1 regression — producer/consumer field contract", () => {
    test("DETECTS a description change (the defect that silently disabled this)", () => {
      const r = run(
        [{ ...BASE, description: "Base domain of the cluster." }],
        [{ ...BASE, description: "Base domain of the cluster. Must be a valid DNS name." }]
      );

      assert.strictEqual(r.summary.changed, 1, "a changed description must be detected");
      assert.ok(r.changed[0].classification.includes("changed_description"));
      assert.match(r.changed[0].oldValue.description, /^Base domain of the cluster\.$/);
      assert.match(r.changed[0].newValue.description, /valid DNS name/);
    });

    test("a description change alone does NOT require manual review", () => {
      const r = run([{ ...BASE, description: "a" }], [{ ...BASE, description: "b" }]);
      assert.strictEqual(r.summary.needsManualReview, 0);
      assert.ok(!r.changed[0].classification.includes("needs_manual_review"));
    });

    test("the declared input contract names the fields the comparator reads", () => {
      // Binds the contract so a future producer can assert against it instead
      // of guessing, which is exactly what went wrong.
      assert.strictEqual(INPUT_CONTRACT.key, "path");
      assert.deepStrictEqual([...INPUT_CONTRACT.compared], ["type", "required", "description"]);
      assert.ok(!INPUT_CONTRACT.compared.includes("comment"), "`comment` was never emitted by any producer");
      assert.ok(!INPUT_CONTRACT.provenance.includes("jsonTag"), "`jsonTag` was never emitted");
      assert.ok(!INPUT_CONTRACT.provenance.includes("file"), "`file` was never emitted");
    });

    test("provenance fields appear in output only when the producer supplied them", () => {
      const r = run([], [{ ...BASE, goType: "string", struct: "types.InstallConfig", field: "BaseDomain" }]);
      assert.strictEqual(r.added[0].struct, "types.InstallConfig");
      assert.strictEqual(r.added[0].goType, "string");

      const bare = run([], [BASE]);
      assert.ok(!("struct" in bare.added[0]), "absent provenance must not appear as undefined");
      assert.ok(!("file" in bare.added[0]));
    });
  });

  describe("classification", () => {
    test("detects an added parameter and labels it with the target minor", () => {
      const r = run([BASE], [BASE, { path: "platform.aws.ipFamily", type: "string", required: false }]);
      assert.strictEqual(r.summary.added, 1);
      assert.strictEqual(r.added[0].path, "platform.aws.ipFamily");
      assert.strictEqual(r.added[0].classification, "added_in_4.22");
    });

    test("detects a removed parameter", () => {
      const r = run([BASE, { path: "legacy.field", type: "string", required: false }], [BASE]);
      assert.strictEqual(r.summary.removed, 1);
      assert.strictEqual(r.removed[0].classification, "removed_in_4.22");
    });

    test("labels are derived from the arguments, not hardcoded", () => {
      // The harvested version had "added_in_4_21" baked into the source.
      const r = diffParams({
        baseline: extraction("a", []),
        target: extraction("b", [BASE]),
        previousMinor: "4.30",
        minor: "4.31",
      });
      assert.strictEqual(r.added[0].classification, "added_in_4.31");
      assert.strictEqual(r.previousMinor, "4.30");
      assert.strictEqual(r.minor, "4.31");
    });

    test("a type change requires manual review", () => {
      const r = run([{ ...BASE, type: "string" }], [{ ...BASE, type: "array" }]);
      assert.strictEqual(r.summary.needsManualReview, 1);
      assert.ok(r.changed[0].classification.includes("changed_type"));
      assert.ok(r.changed[0].classification.includes("needs_manual_review"));
    });

    test("a requiredness change requires manual review", () => {
      const r = run([{ ...BASE, required: false }], [{ ...BASE, required: true }]);
      assert.strictEqual(r.summary.needsManualReview, 1);
      assert.ok(r.changed[0].classification.includes("changed_requiredness"));
    });

    test("multiple simultaneous changes are all recorded", () => {
      const r = run(
        [{ ...BASE, type: "string", required: false, description: "a" }],
        [{ ...BASE, type: "array", required: true, description: "b" }]
      );
      const c = r.changed[0].classification;
      assert.ok(c.includes("changed_type"));
      assert.ok(c.includes("changed_requiredness"));
      assert.ok(c.includes("changed_description"));
    });

    test("identical sets produce an all-unchanged, zero-change delta", () => {
      const r = run([BASE], [BASE]);
      assert.deepStrictEqual(r.summary, {
        added: 0,
        removed: 0,
        changed: 0,
        unchanged: 1,
        needsManualReview: 0,
        totalInBaseline: 1,
        totalInTarget: 1,
      });
    });
  });

  test("output is deterministic (sorted by path)", () => {
    const r = run(
      [],
      [
        { path: "zeta", type: "string", required: false },
        { path: "alpha", type: "string", required: false },
        { path: "mid", type: "string", required: false },
      ]
    );
    assert.deepStrictEqual(r.added.map((a) => a.path), ["alpha", "mid", "zeta"]);
  });

  test("carries the no-support-implied note", () => {
    const r = run([], [BASE]);
    assert.match(r.note, /No production catalog support is implied/);
  });

  describe("CLI argument discipline", () => {
    function cli(args) {
      return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf-8" });
    }

    test("refuses to run without --minor", () => {
      const r = cli(["--baseline", "a.json", "--target", "b.json", "--previous-minor", "4.21"]);
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /--minor is required/);
      assert.match(r.stderr, /never assume a minor/);
    });

    test("refuses to run without --previous-minor", () => {
      const r = cli(["--baseline", "a.json", "--target", "b.json", "--minor", "4.22"]);
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /--previous-minor is required/);
    });

    test("rejects a patch version where a minor is required", () => {
      const r = cli([
        "--baseline", "a.json", "--target", "b.json",
        "--previous-minor", "4.21", "--minor", "4.22.3",
      ]);
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /is not a minor version/);
    });

    test("fails closed on a missing input file", () => {
      const r = cli([
        "--baseline", "/nonexistent/a.json", "--target", "/nonexistent/b.json",
        "--previous-minor", "4.21", "--minor", "4.22",
      ]);
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /Missing baseline extraction/);
    });

    test("end-to-end writes a delta file", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-diff-"));
      const a = path.join(dir, "a.json");
      const b = path.join(dir, "b.json");
      const out = path.join(dir, "delta.json");
      fs.writeFileSync(a, JSON.stringify(extraction("rel-4.21", [BASE])));
      fs.writeFileSync(
        b,
        JSON.stringify(extraction("rel-4.22", [BASE, { path: "new.field", type: "string", required: false }]))
      );

      const r = cli([
        "--baseline", a, "--target", b,
        "--previous-minor", "4.21", "--minor", "4.22", "--out", out,
      ]);
      assert.strictEqual(r.status, 0);

      const delta = JSON.parse(fs.readFileSync(out, "utf-8"));
      assert.strictEqual(delta.summary.added, 1);
      assert.strictEqual(delta.added[0].path, "new.field");
    });
  });
});
