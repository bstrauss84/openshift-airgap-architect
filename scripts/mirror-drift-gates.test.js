"use strict";

/**
 * Mirror drift GATE semantics — catalogs and docs-index.
 *
 * These gates are what the tracked pre-commit hook and CI rely on, so their
 * exit codes are the contract, not the log output.
 *
 * Why this file exists: `sync-catalogs.js --dry-run` counted a drifted file in
 * `totalSynced` but only a write ERROR produced a non-zero exit, so it reported
 * drift and still exited 0. Wired into CI that is a gate which can never fail.
 * `--check` was added as the unambiguous read-only failure signal, and
 * `sync-docs-index.js` was aligned to identical semantics so the two cannot
 * disagree about what a flag means.
 *
 * For BOTH mirrors, each case asserts the exit code AND that nothing was written.
 *
 * Hermetic: fixture trees under os.tmpdir() via --root. No network.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const CATALOG_SCRIPT = path.join(__dirname, "sync-catalogs.js");
const DOCSIDX_SCRIPT = path.join(__dirname, "sync-docs-index.js");

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf-8" });
}

function writeFile(abs, body) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf-8");
}

/** Snapshot every file under a tree so "nothing was written" is checkable. */
function snapshot(root) {
  const out = {};
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else out[path.relative(root, abs)] = fs.readFileSync(abs, "utf-8");
    }
  };
  walk(root);
  return out;
}

const CANON = '{"version":"4.21","scenarioId":"a","parameters":[{"path":"canonical"}]}';
const STALE = '{"version":"4.21","scenarioId":"a","parameters":[{"path":"stale"}]}';

// --- fixture builders -------------------------------------------------------

function catalogFixture({ canonical = { "4.21": { "a.json": CANON } }, mirror = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-catgate-"));
  for (const [minor, files] of Object.entries(canonical)) {
    for (const [name, body] of Object.entries(files)) {
      writeFile(path.join(root, "data", "params", minor, name), body);
    }
  }
  // The catalogs root must exist for the script to run at all.
  fs.mkdirSync(path.join(root, "frontend", "src", "data", "catalogs"), { recursive: true });
  for (const [minor, files] of Object.entries(mirror)) {
    for (const [name, body] of Object.entries(files)) {
      writeFile(path.join(root, "frontend", "src", "data", "catalogs", minor, name), body);
    }
  }
  return root;
}

function docsIdxFixture({ canonical = { "4.21.json": CANON }, mirror = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-didxgate-"));
  for (const [name, body] of Object.entries(canonical)) {
    writeFile(path.join(root, "data", "docs-index", name), body);
  }
  fs.mkdirSync(path.join(root, "frontend", "src", "data", "docs-index"), { recursive: true });
  for (const [name, body] of Object.entries(mirror)) {
    writeFile(path.join(root, "frontend", "src", "data", "docs-index", name), body);
  }
  return root;
}

// --- shared case matrix -----------------------------------------------------

const MIRRORS = [
  {
    label: "catalog mirror",
    script: CATALOG_SCRIPT,
    inSync: () => catalogFixture({ mirror: { "4.21": { "a.json": CANON } } }),
    differs: () => catalogFixture({ mirror: { "4.21": { "a.json": STALE } } }),
    missing: () => catalogFixture({ mirror: {} }),
    orphan: () =>
      catalogFixture({ mirror: { "4.21": { "a.json": CANON, "ghost.json": STALE } } }),
  },
  {
    label: "docs-index mirror",
    script: DOCSIDX_SCRIPT,
    inSync: () => docsIdxFixture({ mirror: { "4.21.json": CANON } }),
    differs: () => docsIdxFixture({ mirror: { "4.21.json": STALE } }),
    missing: () => docsIdxFixture({ mirror: {} }),
    orphan: () => docsIdxFixture({ mirror: { "4.21.json": CANON, "4.19.json": STALE } }),
  },
];

for (const m of MIRRORS) {
  describe(`${m.label} --check gate`, () => {
    test("canonical == mirror -> exits 0", () => {
      const root = m.inSync();
      const r = run(m.script, ["--check", "--root", root]);
      assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    });

    test("canonical != mirror -> exits non-zero and writes nothing", () => {
      const root = m.differs();
      const before = snapshot(root);
      const r = run(m.script, ["--check", "--root", root]);
      assert.notStrictEqual(r.status, 0, "drift must fail the gate");
      assert.deepStrictEqual(snapshot(root), before, "--check must not write");
    });

    test("canonical file missing from mirror -> exits non-zero and writes nothing", () => {
      const root = m.missing();
      const before = snapshot(root);
      const r = run(m.script, ["--check", "--root", root]);
      assert.notStrictEqual(r.status, 0);
      assert.deepStrictEqual(snapshot(root), before, "--check must not create the missing file");
    });

    test("orphan mirror file with no canonical source -> exits non-zero", () => {
      const root = m.orphan();
      const before = snapshot(root);
      const r = run(m.script, ["--check", "--root", root]);
      assert.notStrictEqual(r.status, 0, "an orphan is drift too");
      assert.deepStrictEqual(snapshot(root), before);
    });
  });

  describe(`${m.label} --dry-run is a PREVIEW, not a gate`, () => {
    test("reports drift but exits 0, and writes nothing", () => {
      const root = m.differs();
      const before = snapshot(root);
      const r = run(m.script, ["--dry-run", "--root", root]);
      assert.strictEqual(r.status, 0, "--dry-run is explicitly not a gate");
      assert.deepStrictEqual(snapshot(root), before, "--dry-run must not write");
      assert.match(r.stdout, /dry run|preview/i);
    });

    test("help text marks --dry-run as not a gate and --check as the gate", () => {
      const r = run(m.script, ["--help"]);
      const text = r.stdout + r.stderr;
      if (/--help/.test(text)) {
        assert.match(text, /--check/, "help must document the gate flag");
      }
    });
  });

  describe(`${m.label} mutating mode still works`, () => {
    test("default invocation brings a drifted mirror into sync", () => {
      const root = m.differs();
      const w = run(m.script, ["--root", root]);
      assert.strictEqual(w.status, 0, w.stdout + w.stderr);

      const after = run(m.script, ["--check", "--root", root]);
      assert.strictEqual(after.status, 0, "the gate must pass once synced");
    });

    test("default invocation creates a missing mirror file", () => {
      const root = m.missing();
      assert.strictEqual(run(m.script, ["--root", root]).status, 0);
      assert.strictEqual(run(m.script, ["--check", "--root", root]).status, 0);
    });
  });
}

describe("regression: the defect that made the old gate unfailable", () => {
  test("sync-catalogs --dry-run reports drift yet exits 0 (documented, not a gate)", () => {
    const root = catalogFixture({ mirror: { "4.21": { "a.json": STALE } } });
    const r = run(CATALOG_SCRIPT, ["--dry-run", "--root", root]);
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /WOULD SYNC|Drifted/i, "it does see the drift");
  });

  test("...while --check on the same tree fails, which is why CI uses --check", () => {
    const root = catalogFixture({ mirror: { "4.21": { "a.json": STALE } } });
    assert.notStrictEqual(run(CATALOG_SCRIPT, ["--check", "--root", root]).status, 0);
  });

  test("both scripts agree on what --check and --dry-run mean", () => {
    const cat = catalogFixture({ mirror: { "4.21": { "a.json": STALE } } });
    const idx = docsIdxFixture({ mirror: { "4.21.json": STALE } });
    assert.strictEqual(run(CATALOG_SCRIPT, ["--dry-run", "--root", cat]).status, 0);
    assert.strictEqual(run(DOCSIDX_SCRIPT, ["--dry-run", "--root", idx]).status, 0);
    assert.notStrictEqual(run(CATALOG_SCRIPT, ["--check", "--root", cat]).status, 0);
    assert.notStrictEqual(run(DOCSIDX_SCRIPT, ["--check", "--root", idx]).status, 0);
  });
});
