/**
 * Tests for scripts/validate-version-lists.mjs (stale version-list guard).
 *
 * Fixture trees under os.tmpdir(); the real repository is only read in the
 * final live-repository assertion. No network access.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateVersionLists } from "./validate-version-lists.mjs";

const SUPPORTED = ["4.20", "4.21"];
const REPO_ROOT = path.resolve(import.meta.dirname, "..");

function fixture(fileMap) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-vlists-"));
  for (const [rel, body] of Object.entries(fileMap)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof body === "string" ? body : JSON.stringify(body, null, 2), "utf-8");
  }
  return { root, files: Object.keys(fileMap) };
}

async function run(fileMap, opts = {}) {
  const { root, files } = fixture(fileMap);
  return validateVersionLists(root, { supportedMinors: SUPPORTED, files, ...opts });
}

describe("stale version-list guard", () => {
  test("flags a stale supportedVersions array", async () => {
    const r = await run({ "schema/dead.json": { supportedVersions: ["4.17", "4.18", "4.19", "4.20"] } });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.errors.length, 1);
    assert.match(r.errors[0], /schema\/dead\.json/);
    assert.match(r.errors[0], /does not match SUPPORTED_MINORS/);
  });

  test("flags a stale versionRange array nested in an array of objects", async () => {
    // The shape schema/scenarios.json actually had: six nested copies.
    const r = await run({
      "schema/dead.json": {
        scenarios: [
          { id: "a", versionRange: ["4.17", "4.20"] },
          { id: "b", versionRange: ["4.17", "4.20"] },
        ],
      },
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.errors.length, 2, "each nested occurrence is reported separately");
    assert.match(r.errors[0], /\/scenarios\/0\/versionRange/);
    assert.match(r.errors[1], /\/scenarios\/1\/versionRange/);
  });

  test("accepts a list that matches SUPPORTED_MINORS", async () => {
    const r = await run({ "data/live.json": { supportedVersions: ["4.20", "4.21"] } });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.hits.length, 1);
    assert.strictEqual(r.hits[0].matches, true);
  });

  test("rejects a list that merely OVERLAPS SUPPORTED_MINORS", async () => {
    // A subset is still stale: it would silently under-report support.
    const r = await run({ "data/partial.json": { supportedVersions: ["4.20"] } });
    assert.strictEqual(r.ok, false);
  });

  test("rejects a list containing an unsupported future minor", async () => {
    // Guards premature 4.22 enablement leaking in through a data file.
    const r = await run({ "data/early.json": { supportedVersions: ["4.20", "4.21", "4.22"] } });
    assert.strictEqual(r.ok, false);
    assert.match(r.errors[0], /4\.22/);
  });

  test("allowlist suppresses a specific file, and only that file", async () => {
    const r = await run(
      {
        "schema/legacy.json": { supportedVersions: ["4.17"] },
        "schema/other.json": { supportedVersions: ["4.17"] },
      },
      { allowlist: [{ path: "schema/legacy.json", reason: "documented historical artifact" }] }
    );
    assert.strictEqual(r.ok, false, "the non-allowlisted file must still fail");
    assert.strictEqual(r.errors.length, 1);
    assert.match(r.errors[0], /schema\/other\.json/);
    assert.ok(r.hits.find((h) => h.file === "schema/legacy.json").allowlisted);
  });

  describe("scope boundaries (must not false-positive)", () => {
    test("ignores a STRING versionRange such as \"*\"", async () => {
      // schema/parameters.json uses versionRange: "*" — a range expression,
      // not an enumerated support list.
      const r = await run({ "schema/params.json": { parameters: [{ applicability: { versionRange: "*" } }] } });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.hits.length, 0);
    });

    test("ignores a string range expression such as \">=4.20\"", async () => {
      const r = await run({ "schema/x.json": { versionRange: ">=4.20" } });
      assert.strictEqual(r.ok, true);
    });

    test("ignores an array of semver dependency pins", async () => {
      const r = await run({ "x/deps.json": { supportedVersions: ["1.2.3", "4.5.6"] } });
      assert.strictEqual(r.ok, true, "three-part semver is not an OpenShift minor list");
    });

    test("ignores unrelated key names", async () => {
      const r = await run({ "x/y.json": { previouslyReleasedMinors: ["4.17"], minVersions: ["4.17"] } });
      assert.strictEqual(r.ok, true);
    });

    test("ignores an empty array", async () => {
      const r = await run({ "x/y.json": { supportedVersions: [] } });
      assert.strictEqual(r.ok, true);
    });

    test("skips malformed JSON rather than failing (schema validators own that)", async () => {
      const r = await run({ "x/broken.json": "{ not json" });
      assert.strictEqual(r.ok, true);
    });
  });

  test("live repository passes with the real tracked file set", async () => {
    const r = await validateVersionLists(REPO_ROOT);
    assert.strictEqual(
      r.ok,
      true,
      `tracked JSON carries a stale version list:\n${r.errors.join("\n")}`
    );
  });
});
