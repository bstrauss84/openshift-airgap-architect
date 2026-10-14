/**
 * Runs the shell-based regression suites under scripts/ as node:test subtests.
 *
 * WHY THIS FILE EXISTS. The security gate is a shell script, so the tests that
 * prove its behaviour are shell scripts too — and `node --test` would never
 * have found them. They would have passed on a developer's terminal and run
 * nowhere else, which for a security gate is indistinguishable from not
 * having them. This bridges them into the ordinary `npm run test:tooling`
 * path with no package.json change: that script already globs
 * `scripts/*.test.mjs`, and this file matches.
 *
 * DISCOVERY IS DELIBERATELY NARROW. Only `*.test.sh` is executed, and only
 * under scripts/. The directory it lives in holds non-test helpers that are
 * *meant* to be sourced, never run — `image-surface.sh` defines functions and
 * does nothing on its own, and executing it because it shares a directory
 * with a test would be exactly the "run anything nearby" mistake that makes
 * test discovery untrustworthy. Node's own runner has the mirror-image hazard
 * (`**\/test\/**\/*.?(c|m)js` makes any helper dropped in a test directory a
 * test), so being explicit here is the point.
 *
 * Image-dependent harnesses are NOT run here. backend/test/image-runtime-parity
 * and backend/test/deployment-identity need podman and a built image; they
 * belong to the release image-verification path, not to unit CI, and they
 * take an image reference as an argument. Pulling them in would make this
 * suite fail on any machine without a prebuilt image.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));

/** Every *.test.sh under scripts/, recursively, excluding node_modules. */
function discover(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...discover(full));
    else if (entry.isFile() && entry.name.endsWith(".test.sh")) found.push(full);
  }
  return found.sort();
}

const suites = discover(SCRIPTS);

/**
 * External tools the shell suites genuinely need.
 *
 * Checked once, up front, so a missing tool is ONE legible failure naming the
 * tool instead of a scatter of assertion failures inside the suites. `jq` is
 * used by the scan-evidence contract and `date -u -d` is GNU-specific (it is
 * how database staleness is computed) — on a BSD/macOS `date` the suites
 * would fail in a way that reads like a logic bug rather than a portability
 * one. Both are present on ubuntu-latest, which is what CI runs.
 *
 * This FAILS rather than skips. A silent skip would quietly delete the
 * security regression coverage on any host missing a tool, which is the
 * outcome the whole bridge exists to prevent.
 */
test("the shell suites' external prerequisites are present", () => {
  const missing = [];
  for (const tool of ["bash", "git", "jq", "node"]) {
    if (spawnSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).status !== 0) missing.push(tool);
  }
  assert.deepEqual(missing, [], `missing tool(s) required by the shell suites: ${missing.join(", ")}`);

  const gnuDate = spawnSync("date", ["-u", "-d", "2026-01-01T00:00:00Z", "+%s"], { encoding: "utf8" });
  assert.equal(
    gnuDate.status,
    0,
    "`date -u -d <iso>` (GNU date) is required for vulnerability-database staleness checks; " +
      "on macOS install coreutils and put gdate on PATH as `date`",
  );
});

test("shell regression suites are discovered", () => {
  // A silent zero would make every assertion below vacuous: the suite would
  // go green by finding nothing. Fail instead.
  assert.ok(suites.length > 0, "no *.test.sh found under scripts/ — discovery is broken");
});

test("discovery does not pick up non-test shell helpers", () => {
  // image-surface.sh is a sourced library; running it as a test would both
  // prove nothing and, if it ever grew a side effect, do something.
  const names = suites.map((s) => path.basename(s));
  for (const helper of ["image-surface.sh", "package-surface.mjs"]) {
    assert.ok(!names.includes(helper), `${helper} must not be executed as a test`);
  }
  for (const s of suites) assert.match(s, /\.test\.sh$/);
});

for (const suite of suites) {
  const rel = path.relative(path.dirname(SCRIPTS), suite);
  test(rel, () => {
    const r = spawnSync("bash", [suite], {
      encoding: "utf8",
      timeout: 300_000,
      // Inherit a clean-ish env: these suites assert on gate behaviour that an
      // inherited OAA_GATE_BASELINE would silently change.
      env: { ...process.env, OAA_GATE_BASELINE: "", OAA_GATE_SURFACE_STRICT: "" },
    });
    if (r.status !== 0) {
      assert.fail(`${rel} failed (exit ${r.status})\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`);
    }
    // A suite that printed nothing has almost certainly not run its cases.
    assert.match(r.stdout, /\d+ passed, \d+ failed/, `${rel} produced no recognisable summary`);
  });
}
