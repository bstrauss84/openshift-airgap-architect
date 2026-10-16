/**
 * AXIS: tests — the candidate's own suites pass.
 *
 * Three independent suites, reported independently so a red result is
 * attributable rather than opaque:
 *
 *   tooling   repository guards; needs root devDependencies (js-yaml)
 *   backend   node:test over backend/test; needs backend/node_modules
 *   frontend  vitest; needs frontend/node_modules
 *
 * DEPENDENCIES ARE NOT INSTALLED BY THIS AXIS. A certification harness that
 * mutates the candidate in order to certify it is certifying something other
 * than the candidate. When a suite's dependencies are absent the axis reports
 * INCOMPLETE and names the exact command the operator must run first — it does
 * not quietly skip, and it does not install.
 */

import fs from "node:fs";
import path from "node:path";
import { pass, fail, incomplete } from "../lib/status.mjs";
import { REUSE } from "../lib/evidence.mjs";
import { run, record, tail } from "../lib/exec.mjs";

const ID = "tests";

/** Parse the trailing counters of a node:test TAP run. */
function tapCounts(output) {
  const grab = (label) => {
    const m = output.match(new RegExp(`^# ${label} (\\d+)$`, "m"));
    return m ? Number(m[1]) : null;
  };
  return { tests: grab("tests"), pass: grab("pass"), fail: grab("fail"), skipped: grab("skipped") };
}

const SUITES = [
  {
    name: "tooling",
    needs: "node_modules",
    install: "npm ci",
    argv: ["npm", "run", "--silent", "test:tooling"],
    cwd: ".",
  },
  {
    name: "backend",
    needs: "backend/node_modules",
    install: "cd backend && npm ci",
    argv: ["npm", "test"],
    cwd: "backend",
  },
  {
    name: "frontend",
    needs: "frontend/node_modules",
    install: "cd frontend && npm ci",
    argv: ["npm", "test"],
    cwd: "frontend",
  },
];

export default {
  id: ID,
  title: "Backend, frontend and tooling test suites",
  required: true,
  // NEVER reused. The result depends on three installed dependency trees,
  // and a Node version is nowhere near sufficient to describe them: the same
  // source passes or fails depending on what `npm ci` last resolved on this
  // disk. Fully specifying that context would mean digesting three
  // node_modules trees on every run — fragile, slow, and still incomplete.
  // Re-running the suites is cheaper and actually correct.
  reuse: REUSE.NEVER,
  inputs: ["backend", "frontend", "shared", "scripts", "data", "schema", "package.json", "package-lock.json"],

  async run({ repoRoot, store }) {
    const results = [];

    for (const suite of SUITES) {
      if (!fs.existsSync(path.join(repoRoot, suite.needs))) {
        results.push({
          suite: suite.name,
          status: "INCOMPLETE",
          reason: `${suite.needs} is absent; run \`${suite.install}\` from the repository root first`,
        });
        continue;
      }
      const [cmd, ...args] = suite.argv;
      const res = run(cmd, args, { cwd: path.join(repoRoot, suite.cwd), timeoutMs: 30 * 60_000 });
      const output = `${res.stdout}${res.stderr}`;
      store.writeArtifact(ID, `${suite.name}.log`, output);
      results.push({
        suite: suite.name,
        status: res.spawnError || res.timedOut ? "INCOMPLETE" : res.status === 0 ? "PASS" : "FAIL",
        counts: tapCounts(output),
        ...record(res),
        tail: tail(res, 25),
      });
    }

    const artifacts = [store.writeArtifact(ID, "suites.json", results)];
    const failed = results.filter((r) => r.status === "FAIL");
    const blocked = results.filter((r) => r.status === "INCOMPLETE");

    if (failed.length) {
      const detail = failed
        .map((r) => `${r.suite}(${r.counts?.fail ?? "?"} failing)`)
        .join(", ");
      return fail(ID, `test suite failures: ${detail}`, { evidence: { results }, artifacts });
    }
    if (blocked.length) {
      return incomplete(ID, `${blocked.length} suite(s) could not run: ${blocked.map((r) => r.suite).join(", ")}`, {
        evidence: { results },
        artifacts,
      });
    }
    const total = results.reduce((n, r) => n + (r.counts?.tests ?? 0), 0);
    return pass(ID, `${results.length} suites green, ${total} tests`, { evidence: { results }, artifacts });
  },
};
