/**
 * AXIS: lifecycle — resources return to baseline under repeated and failed operations.
 *
 * Replaces the `lifecycle` placeholder registered by Tranche 8A, whose stated
 * reason was "no deterministic resource-lifecycle probes exist; a static read
 * cannot establish absence of leaks". That is still true of a static read, so
 * this axis does not perform one. It executes the probe suite
 * `backend/test/lifecycle-resource-probes.test.js`, which drives each
 * long-lived resource through N cycles and asserts the observed count returns
 * to baseline.
 *
 * WHY THE AXIS DOES NOT RE-IMPLEMENT THE PROBES
 *
 * The resources in question — temp directories, file descriptors, child
 * processes, SQLite handles — are owned by the backend process. Observing them
 * means being that process. A harness subprocess can only see the counts from
 * outside, which is strictly less information. So the probes live in the
 * backend suite where they can read `/proc/self`, and this axis owns the
 * contract: the suite must exist, must actually run, and must be green.
 *
 * WHY THE 8A "CONFIRMED FINDING" IS CHECKED EXPLICITLY
 *
 * planned.mjs recorded a confirmed unfixed leak — runtimePackage.js's mkdtemp
 * root never being removed. A later tranche fixed it. An axis that simply went
 * green would lose that history, so the probe suite contains a dedicated case
 * for exactly that path and this axis names it. A fix without a regression
 * test is a fix that comes back.
 *
 * DEPENDENCIES ARE NOT INSTALLED HERE, for the same reason the `tests` axis
 * does not install them: a harness that mutates the candidate in order to
 * certify it is certifying something else. Absent dependencies are INCOMPLETE
 * with the exact command to run, never a silent skip.
 */

import fs from "node:fs";
import path from "node:path";
import { pass, fail, incomplete } from "../lib/status.mjs";
import { REUSE } from "../lib/evidence.mjs";
import { run, record, tail } from "../lib/exec.mjs";

const ID = "lifecycle";

const PROBE_SUITE = "test/lifecycle-resource-probes.test.js";

/**
 * Probe cases this axis requires to exist, by the resource each one covers.
 *
 * Named rather than counted: a suite that silently lost its failed-export case
 * would still report "7 passed" and would still be missing the path where
 * cleanup is most often forgotten.
 */
const REQUIRED_PROBES = Object.freeze([
  { resource: "temp-directories", match: /temp directories to baseline/i },
  { resource: "file-descriptors", match: /file descriptors to baseline/i },
  { resource: "failed-operations", match: /accumulate descriptors when exports FAIL/i },
  { resource: "sqlite-and-http", match: /descriptors flat across .* state write\/read cycles/i },
  { resource: "runtime-package-staging", match: /releases runtime-package staging/i },
  { resource: "child-processes", match: /orphaned child processes/i },
  { resource: "shutdown-timers", match: /timer backlog that would block shutdown/i },
]);

/** Parse the trailing counters of a node:test TAP run. */
function tapCounts(output) {
  const grab = (label) => {
    const m = output.match(new RegExp(`^# ${label} (\\d+)$`, "m"));
    return m ? Number(m[1]) : null;
  };
  return { tests: grab("tests"), pass: grab("pass"), fail: grab("fail"), skipped: grab("skipped") };
}

export default {
  id: ID,
  title: "Resource and process lifecycle under repeated and failed operations",
  required: true,
  // NEVER: this axis asserts observed runtime behaviour, not a property of the
  // source text. Reusing a previous run's answer would assert that the machine
  // behaves the same way today because it did yesterday.
  reuse: REUSE.NEVER,
  inputs: ["backend/src", "backend/test", "frontend/src"],

  async run({ repoRoot, store }) {
    const backendDir = path.join(repoRoot, "backend");
    const suitePath = path.join(backendDir, PROBE_SUITE);

    if (!fs.existsSync(suitePath)) {
      return incomplete(ID, `probe suite missing: backend/${PROBE_SUITE}`, {
        evidence: { probeSuite: `backend/${PROBE_SUITE}`, present: false },
      });
    }

    if (!fs.existsSync(path.join(backendDir, "node_modules"))) {
      return incomplete(ID, "backend dependencies absent; run `npm ci --prefix backend` first", {
        evidence: { probeSuite: `backend/${PROBE_SUITE}`, missingDependencies: "backend/node_modules" },
      });
    }

    const source = fs.readFileSync(suitePath, "utf8");
    const missingProbes = REQUIRED_PROBES.filter((p) => !p.match.test(source)).map((p) => p.resource);
    if (missingProbes.length) {
      // A suite that lost a probe would still pass. The axis owns the contract
      // that every resource class is actually covered.
      return fail(ID, `probe suite no longer covers: ${missingProbes.join(", ")}`, {
        evidence: { probeSuite: `backend/${PROBE_SUITE}`, missingProbes, required: REQUIRED_PROBES.map((p) => p.resource) },
      });
    }

    const cycles = process.env.OAA_LIFECYCLE_CYCLES || "6";
    const res = run("node", ["--test", "--test-timeout=180000", PROBE_SUITE], {
      cwd: backendDir,
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATA_DIR: process.env.DATA_DIR || "/tmp/airgap-backend-test",
        OAA_LIFECYCLE_CYCLES: cycles,
      },
      timeoutMs: 10 * 60_000,
    });

    const output = `${res.stdout || ""}${res.stderr || ""}`;
    const counts = tapCounts(output);
    const artifacts = [
      store.writeArtifact(ID, "lifecycle-probes.log", output),
      store.writeArtifact(ID, "lifecycle.json", {
        probeSuite: `backend/${PROBE_SUITE}`,
        cycles: Number(cycles),
        requiredProbes: REQUIRED_PROBES.map((p) => p.resource),
        counts,
        exec: record(res),
        closedFindings: [
          {
            origin: "scripts/release/axes/planned.mjs lifecycle.known.confirmedFinding",
            finding:
              "runtimePackage.js mkdtempSync temp root was never removed; the directory holds exported container image archives",
            state: "CLOSED",
            evidence:
              "backend/src/runtimePackage.js returns a cleanup() the caller invokes; backend/src/index.js releases it in the archive-stream finally. Pinned by the 'releases runtime-package staging' probe.",
          },
        ],
      }),
    ];

    if (res.timedOut) {
      return fail(ID, `probe suite timed out after ${res.durationMs} ms`, {
        evidence: { counts, exec: record(res) },
        artifacts,
      });
    }
    if (res.status !== 0 || (counts.fail ?? 0) > 0) {
      return fail(ID, `resource lifecycle probes failed (${counts.fail ?? "?"} failing of ${counts.tests ?? "?"})`, {
        evidence: { counts, tail: tail(res, 40) },
        artifacts,
      });
    }
    if (!counts.tests) {
      return incomplete(ID, "probe suite produced no parseable TAP counters", {
        evidence: { tail: tail(res, 40) },
        artifacts,
      });
    }
    if ((counts.skipped ?? 0) > 0) {
      // A skipped probe is an unproven resource class, which is INCOMPLETE,
      // not PASS. On Linux nothing should skip; elsewhere /proc is absent.
      return incomplete(ID, `${counts.skipped} lifecycle probe(s) skipped on this platform; the resource class is unproven here`, {
        evidence: { counts, platform: process.platform },
        artifacts,
      });
    }

    return pass(
      ID,
      `${counts.pass} resource lifecycle probes passed over ${cycles} cycles ` +
        `(${REQUIRED_PROBES.length} resource classes; temp dirs, fds, failed exports, SQLite, staging, children, timers)`,
      { evidence: { counts, cycles: Number(cycles), resourceClasses: REQUIRED_PROBES.map((p) => p.resource) }, artifacts }
    );
  },
};
