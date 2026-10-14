/**
 * Ownership boundaries around jobs and their files (v2.1 Tranche 8C)
 *
 * Three defects found by the Tranche 8C independent review, all about the
 * same question — what does this backend actually own, and is it allowed to
 * destroy it?
 *
 *   F-1  An operator-supplied imageset config (configSourceType:"external")
 *        was `safeUnlink`ed by every cleanup path in the oc-mirror run, so
 *        pointing the UI at your own file deleted it. Reachable from a
 *        validated request body, which also makes it an arbitrary-file-delete
 *        primitive.
 *   F-3  The terminal-status guard introduced for operator scans was not
 *        propagated to the oc-mirror run and retry children, so a late
 *        `close` still relabelled a `cancelled` job `failed` (a SIGTERMed
 *        child reports `code === null`, which that branch reads as failure).
 *   F-4  The scan route wrote a pull secret and then returned early when
 *        oc-mirror could not be resolved, without releasing it.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createJob,
  updateJob,
  updateJobUnlessTerminal,
  getJob
} from "../src/utils.js";
import { isTerminalJobStatus } from "../src/jobStatus.js";

const REPO_BACKEND = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

describe("A job that already has an outcome keeps it", () => {
  it("declines a late callback's write once the job is terminal", () => {
    for (const terminal of ["completed", "completed_with_warnings", "failed", "cancelled"]) {
      const id = createJob("ownership-probe", "x");
      updateJob(id, { status: terminal, message: `reached ${terminal}`, progress: 100 });

      const result = updateJobUnlessTerminal(id, {
        status: "failed",
        message: "oc-mirror exited with code null."
      });

      assert.equal(result, null, `${terminal} must not be rewritten`);
      const after = getJob(id);
      assert.equal(after.status, terminal);
      assert.equal(after.message, `reached ${terminal}`, "the real outcome must survive");
    }
  });

  it("still writes while the job is open", () => {
    const id = createJob("ownership-probe", "x");
    updateJob(id, { status: "running", progress: 10 });

    assert.ok(updateJobUnlessTerminal(id, { status: "failed", message: "genuine failure" }));
    assert.equal(getJob(id).status, "failed");
  });

  it("does not mistake an unknown job for an already-terminal one", () => {
    // `null` is ALSO what a declined write returns, so asserting null alone
    // cannot tell "reached updateJob, row was missing" from "refused because
    // it looked terminal" — the very confusion this is meant to rule out.
    // Distinguish them on an observable: a real row proves the guard lets the
    // write through, and the unknown id agrees with plain updateJob.
    assert.equal(updateJobUnlessTerminal("no-such-job", { status: "failed" }), null);
    assert.equal(updateJob("no-such-job", { status: "failed" }), null,
      "plain updateJob returns null for a missing row too, so the two agree");

    const open = createJob("ownership-probe", "open");
    updateJob(open, { status: "running" });
    assert.ok(
      updateJobUnlessTerminal(open, { status: "failed", message: "real failure" }),
      "a readable, non-terminal job must still be written"
    );
    assert.equal(getJob(open).message, "real failure");
  });

  it("every status the guard treats as terminal is one a job can actually reach", () => {
    // Guards against the vocabulary drifting away from what writers produce.
    for (const status of ["completed", "completed_with_warnings", "failed", "cancelled"]) {
      assert.equal(isTerminalJobStatus(status), true);
    }
    assert.equal(isTerminalJobStatus("running"), false);
  });
});

describe("An operator's own files are not this backend's to delete", () => {
  let scratch;

  before(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-ownership-"));
  });

  after(() => {
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  });

  it("the run handler only unlinks a config it generated itself", () => {
    // Pinned against the source because the five cleanup paths are spread
    // across error, close and four early returns; a behaviour test would
    // need a live oc-mirror to reach all of them. The invariant is simple
    // enough to state structurally: no unguarded unlink of configPathToUse.
    const source = fs.readFileSync(path.join(REPO_BACKEND, "src", "index.js"), "utf8");

    const unguarded = source
      .split("\n")
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => line === "safeUnlink(configPathToUse);");
    assert.deepEqual(
      unguarded,
      [],
      `every cleanup path must check ownership first; unguarded at line(s) ${unguarded.map((u) => u.n).join(", ")}`
    );

    const guarded = (source.match(/if \(configPathIsOurs\) safeUnlink\(configPathToUse\);/g) || []).length;
    assert.equal(guarded, 5, `expected all 5 cleanup paths guarded, found ${guarded}`);

    // And ownership is claimed only on the generated branch.
    const claims = (source.match(/configPathIsOurs = true;/g) || []).length;
    assert.equal(claims, 1, "exactly one branch may claim ownership of the config file");
  });

  it("the scan route releases its pull secret when oc-mirror cannot be resolved", () => {
    const source = fs.readFileSync(path.join(REPO_BACKEND, "src", "index.js"), "utf8");
    // The early return that creates failed job rows must release the
    // credential it wrote; it runs before the refcounted releaser exists.
    const branch = source.slice(source.indexOf("if (resolved.error) {"));
    const upToReturn = branch.slice(0, branch.indexOf("return res.json({ jobs });"));
    assert.match(
      upToReturn,
      /if \(tempAuthFile\) safeUnlink\(tempAuthFile\);/,
      "the resolve-error path must not leak the pull secret it wrote"
    );
  });
});
