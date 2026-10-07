"use strict";

/**
 * Tests for scripts/sync-docs-index.js.
 *
 * Everything runs against a throwaway fixture tree under os.tmpdir(); the real
 * data/docs-index and frontend/src/data/docs-index are never read or written.
 * No network access.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { syncDocsIndex } = require("./sync-docs-index.js");

const SCRIPT = path.join(__dirname, "sync-docs-index.js");

/** Build a fixture repo root. `mirror` keys absent from `canonical` become orphans. */
function makeFixture({ canonical = {}, mirror = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-docsidx-"));
  const canonicalDir = path.join(root, "data", "docs-index");
  fs.mkdirSync(canonicalDir, { recursive: true });
  for (const [name, body] of Object.entries(canonical)) {
    fs.writeFileSync(path.join(canonicalDir, name), body, "utf-8");
  }
  if (mirror !== null) {
    const mirrorDir = path.join(root, "frontend", "src", "data", "docs-index");
    fs.mkdirSync(mirrorDir, { recursive: true });
    for (const [name, body] of Object.entries(mirror)) {
      fs.writeFileSync(path.join(mirrorDir, name), body, "utf-8");
    }
  }
  return root;
}

function mirrorPath(root, name) {
  return path.join(root, "frontend", "src", "data", "docs-index", name);
}

function quiet() {}

const INDEX_420 = JSON.stringify({ version: "4.20", scenarios: {}, sharedDocs: [] }, null, 2) + "\n";
const INDEX_421 = JSON.stringify({ version: "4.21", scenarios: {}, sharedDocs: [] }, null, 2) + "\n";

describe("sync-docs-index", () => {
  test("mirrors every canonical minor, canonical -> frontend", () => {
    const root = makeFixture({ canonical: { "4.20.json": INDEX_420, "4.21.json": INDEX_421 }, mirror: {} });
    const r = syncDocsIndex({ root, logger: quiet });

    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.synced.sort(), ["4.20.json", "4.21.json"]);
    assert.strictEqual(fs.readFileSync(mirrorPath(root, "4.20.json"), "utf-8"), INDEX_420);
    assert.strictEqual(fs.readFileSync(mirrorPath(root, "4.21.json"), "utf-8"), INDEX_421);
  });

  test("produces a byte-identical copy (no reformatting, no added fields)", () => {
    // Deliberately odd formatting: a real sync must not normalise it.
    const odd = '{"version":"4.21",   "scenarios":{},\n  "sharedDocs":[]}';
    const root = makeFixture({ canonical: { "4.21.json": odd }, mirror: {} });
    syncDocsIndex({ root, logger: quiet });
    assert.strictEqual(fs.readFileSync(mirrorPath(root, "4.21.json"), "utf-8"), odd);
  });

  test("is deterministic: a second run changes nothing", () => {
    const root = makeFixture({ canonical: { "4.21.json": INDEX_421 }, mirror: {} });
    syncDocsIndex({ root, logger: quiet });
    const first = fs.readFileSync(mirrorPath(root, "4.21.json"));

    const second = syncDocsIndex({ root, logger: quiet });
    assert.strictEqual(second.ok, true);
    assert.deepStrictEqual(second.synced, [], "nothing should need syncing on the second run");
    assert.deepStrictEqual(second.identical, ["4.21.json"]);
    assert.deepStrictEqual(fs.readFileSync(mirrorPath(root, "4.21.json")), first);
  });

  describe("--dry-run drift detection (the CI gate)", () => {
    test("detects a CHANGED mirror and writes nothing", () => {
      const stale = JSON.stringify({ version: "4.21", scenarios: { old: {} } }, null, 2) + "\n";
      const root = makeFixture({ canonical: { "4.21.json": INDEX_421 }, mirror: { "4.21.json": stale } });

      const r = syncDocsIndex({ root, dryRun: true, logger: quiet });

      assert.strictEqual(r.ok, false, "drift must fail the check");
      assert.deepStrictEqual(r.drifted, ["4.21.json"]);
      assert.strictEqual(
        fs.readFileSync(mirrorPath(root, "4.21.json"), "utf-8"),
        stale,
        "--dry-run must not write"
      );
    });

    test("detects a MISSING mirror file", () => {
      const root = makeFixture({
        canonical: { "4.20.json": INDEX_420, "4.21.json": INDEX_421 },
        mirror: { "4.20.json": INDEX_420 },
      });
      const r = syncDocsIndex({ root, dryRun: true, logger: quiet });

      assert.strictEqual(r.ok, false);
      assert.deepStrictEqual(r.drifted, ["4.21.json"]);
      assert.ok(!fs.existsSync(mirrorPath(root, "4.21.json")), "--dry-run must not create files");
    });

    test("detects an ORPHAN mirror file with no canonical source", () => {
      // Guards the inverted-authority case: someone authored into the mirror,
      // or a minor was removed canonically and the mirror kept a stale copy.
      const root = makeFixture({
        canonical: { "4.21.json": INDEX_421 },
        mirror: { "4.21.json": INDEX_421, "4.19.json": INDEX_420 },
      });
      const r = syncDocsIndex({ root, dryRun: true, logger: quiet });

      assert.strictEqual(r.ok, false);
      assert.deepStrictEqual(r.drifted, ["4.19.json"]);
    });

    test("passes cleanly when the mirror matches", () => {
      const root = makeFixture({
        canonical: { "4.20.json": INDEX_420, "4.21.json": INDEX_421 },
        mirror: { "4.20.json": INDEX_420, "4.21.json": INDEX_421 },
      });
      const r = syncDocsIndex({ root, dryRun: true, logger: quiet });

      assert.strictEqual(r.ok, true);
      assert.deepStrictEqual(r.drifted, []);
      assert.deepStrictEqual(r.identical.sort(), ["4.20.json", "4.21.json"]);
    });
  });

  test("ignores non-minor filenames rather than guessing", () => {
    const root = makeFixture({
      canonical: { "4.21.json": INDEX_421, "README.md": "notes", "schema.json": "{}" },
      mirror: {},
    });
    const r = syncDocsIndex({ root, logger: quiet });

    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.synced, ["4.21.json"]);
    assert.ok(!fs.existsSync(mirrorPath(root, "schema.json")));
  });

  test("fails closed when the canonical directory is absent", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-docsidx-empty-"));
    const r = syncDocsIndex({ root, logger: quiet });

    assert.strictEqual(r.ok, false);
    assert.match(r.errors[0], /Canonical docs-index directory not found/);
  });

  test("fails closed when the canonical directory holds no minor files", () => {
    const root = makeFixture({ canonical: { "README.md": "notes" }, mirror: {} });
    const r = syncDocsIndex({ root, logger: quiet });

    assert.strictEqual(r.ok, false);
    assert.match(r.errors[0], /No <minor>\.json files/);
  });

  describe("CLI", () => {
    // Gate-vs-preview exit semantics are covered exhaustively, for both
    // mirrors, in scripts/mirror-drift-gates.test.js.
    test("--check exits 1 on drift, 0 once synced", () => {
      const stale = JSON.stringify({ version: "4.21", scenarios: { old: {} } }, null, 2) + "\n";
      const root = makeFixture({ canonical: { "4.21.json": INDEX_421 }, mirror: { "4.21.json": stale } });

      const drifted = spawnSync(process.execPath, [SCRIPT, "--check", "--root", root], {
        encoding: "utf-8",
      });
      assert.strictEqual(drifted.status, 1);
      assert.match(drifted.stdout, /out of sync/);
      assert.match(drifted.stdout, /Never copy the mirror back over canonical/);

      const written = spawnSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf-8" });
      assert.strictEqual(written.status, 0);

      const after = spawnSync(process.execPath, [SCRIPT, "--check", "--root", root], {
        encoding: "utf-8",
      });
      assert.strictEqual(after.status, 0);
    });

    test("--dry-run previews the same drift without gating", () => {
      const stale = JSON.stringify({ version: "4.21", scenarios: { old: {} } }, null, 2) + "\n";
      const root = makeFixture({ canonical: { "4.21.json": INDEX_421 }, mirror: { "4.21.json": stale } });

      const preview = spawnSync(process.execPath, [SCRIPT, "--dry-run", "--root", root], {
        encoding: "utf-8",
      });
      assert.strictEqual(preview.status, 0, "--dry-run is a preview, not a gate");
      assert.match(preview.stdout, /out of sync/);
      assert.strictEqual(
        fs.readFileSync(mirrorPath(root, "4.21.json"), "utf-8"),
        stale,
        "--dry-run must still write nothing"
      );
    });
  });
});
