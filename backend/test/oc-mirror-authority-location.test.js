/**
 * DOC-166 — where ImageSetConfiguration structural authority lives.
 *
 * `imageset-config-schema.test.js` already proves the generated document
 * CONFORMS to `data/oc-mirror-v2/imageset-config-schema.json`. This file guards
 * the complementary property, which nothing else asserts: that the authority
 * stays GLOBAL and is never re-coupled to a target OpenShift minor.
 *
 * Why it needs its own guard. oc-mirror is resolved from `clients/ocp/latest` —
 * the latest build available globally, independent of the cluster minor being
 * mirrored (CLAUDE.md, "External tool version policy"). Its schema is therefore
 * a property of the TOOL. The obvious-looking "consistency" fix is to give each
 * minor its own `data/params/<minor>/oc-mirror-v2.json`; that would encode a
 * dependency that does not exist and reproduce the clone-and-drift pattern that
 * produced 810 stale citations. Tranche 2 deliberately did not create one for
 * 4.22, and this test is what keeps that decision from being quietly undone.
 *
 * STATUS OF THE LEGACY PER-MINOR FILE. `data/params/4.20/oc-mirror-v2.json`
 * survives as transitional data. It is read by NO runtime module — only by
 * tooling that walks `data/params/**` wholesale (catalog schema validation, the
 * citation-minor guard, the frontend mirror sync). Retiring it now would change
 * the 4.20 catalog count from 13 to 12 and drop a frontend mirror, for no
 * runtime benefit, so it is left in place and the obligation stays tracked under
 * DOC-166. What this file guarantees meanwhile is that it is inert and alone.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildImageSetConfig } from "../src/generate.js";
import { SUPPORTED_MINORS } from "../src/versionPolicy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..");
const PARAMS_DIR = path.join(REPO, "data", "params");
const GLOBAL_SCHEMA_PATH = path.join(REPO, "data", "oc-mirror-v2", "imageset-config-schema.json");

const minorsOnDisk = () =>
  fs.readdirSync(PARAMS_DIR).filter((d) => /^\d+\.\d+$/.test(d)).sort();

/** Production source files, excluding tests. */
function sourceFiles() {
  const roots = [path.join(REPO, "backend", "src"), path.join(REPO, "frontend", "src"), path.join(REPO, "shared")];
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|jsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
    }
  };
  for (const r of roots) if (fs.existsSync(r)) walk(r);
  return out;
}

describe("ImageSetConfig authority is global, not per-minor", () => {
  test("the global schema exists and declares itself global", () => {
    const schema = JSON.parse(fs.readFileSync(GLOBAL_SCHEMA_PATH, "utf8"));
    assert.match(schema._authorityScope, /^GLOBAL\./);
    assert.match(schema._authorityScope, /NOT to any OpenShift minor/);
    assert.ok(Array.isArray(schema.paths) && schema.paths.length > 0);
  });

  test("exactly one per-minor oc-mirror catalog survives, and it is the legacy 4.20 file", () => {
    const withCatalog = minorsOnDisk().filter((m) =>
      fs.existsSync(path.join(PARAMS_DIR, m, "oc-mirror-v2.json"))
    );
    assert.deepEqual(withCatalog, ["4.20"], "only the transitional 4.20 file may exist");
  });

  test("no oc-mirror catalog was cloned into a newer minor", () => {
    for (const minor of minorsOnDisk()) {
      if (minor === "4.20") continue;
      assert.equal(
        fs.existsSync(path.join(PARAMS_DIR, minor, "oc-mirror-v2.json")),
        false,
        `data/params/${minor}/oc-mirror-v2.json must not exist — the schema is a property of the tool, not the minor`
      );
    }
  });

  test("4.22 in particular has no oc-mirror catalog", () => {
    assert.equal(fs.existsSync(path.join(PARAMS_DIR, "4.22", "oc-mirror-v2.json")), false);
    assert.ok(fs.existsSync(path.join(PARAMS_DIR, "4.22")), "but 4.22 does have its other catalogs");
  });

  test("the legacy 4.20 catalog is inert: no production module reads it", () => {
    const offenders = sourceFiles().filter((f) => {
      const src = fs.readFileSync(f, "utf8");
      return /params\/[^"'`]*\/oc-mirror-v2|oc-mirror-v2\.json/.test(src);
    });
    assert.deepEqual(offenders.map((f) => path.relative(REPO, f)), []);
  });

  test("no production module builds an oc-mirror schema path out of a minor", () => {
    // Catches the shape this decision forbids, e.g.
    //   `data/oc-mirror-v2/${minor}.json` or `data/params/${minor}/oc-mirror-v2.json`
    const perMinorOcMirrorPath = /oc-mirror-v2[^\n'"`]*\$\{/;
    const offenders = sourceFiles().filter((f) =>
      perMinorOcMirrorPath.test(fs.readFileSync(f, "utf8"))
    );
    assert.deepEqual(offenders.map((f) => path.relative(REPO, f)), []);
  });
});

describe("the generation boundary still gates on supported minor", () => {
  const stateFor = (minor) => ({
    _schemaVersion: 3,
    version: { selectedMinor: minor, selectedPatch: `${minor}.1` },
    release: { channel: `stable-${minor}`, patchVersion: `${minor}.1` },
    operators: { selected: [] },
    imagesetConfig: {},
  });

  for (const minor of SUPPORTED_MINORS) {
    test(`${minor} generates and names its own channel — no global-schema shortcut bypasses the gate`, () => {
      const out = buildImageSetConfig(stateFor(minor));
      assert.match(out, new RegExp(`stable-${minor.replace(".", "\\.")}`));
    });
  }

  test("an unsupported minor is still rejected at the ImageSetConfig boundary", () => {
    // DOC-166 holds after the 4.22 flip: the global ImageSetConfig schema is a
    // property of oc-mirror, not of the target minor, and 4.22 generating is a
    // consequence of the SUPPORT gate opening — not of the schema being global.
    assert.throws(
      () => buildImageSetConfig(stateFor("4.23")),
      (err) => err.code === "UNSUPPORTED_VERSION" && err.requestedVersion === "4.23"
    );
  });

  test("a global schema does not mean a global generation boundary", () => {
    // The schema being minor-independent must not be read as "any minor may
    // generate". These are different questions and the gate owns the second.
    for (const minor of ["4.19", "4.23", "4.24"]) {
      assert.throws(() => buildImageSetConfig(stateFor(minor)), (err) => err.code === "UNSUPPORTED_VERSION");
    }
  });
});
