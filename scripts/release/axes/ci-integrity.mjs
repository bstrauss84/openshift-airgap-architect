/**
 * AXIS: ci-integrity — the required CI gates are green on the candidate commit.
 *
 * WHY THIS AXIS EXISTS. v2.1 Tranche 8A found that both repository workflows
 * had been failing on every push since 2026-05-27 — 89 of the last 100 `CI`
 * runs red — while tranche after tranche was accepted on the strength of
 * locally-run checks. The `build-and-test` job fails at its first real step,
 * so the backend suite, the frontend suite and build, the bundle budget, the
 * param-authority gate, the container-layout validator and the container
 * smoke test had not executed in CI for the entire 4.21 and 4.22 onboarding
 * program. A gate nobody reads is not a gate.
 *
 * TWO CORRECTNESS RULES, both of which an earlier revision got wrong.
 *
 * 1. A DIRTY CANDIDATE CANNOT BE CERTIFIED BY REMOTE CI. Querying by
 *    `candidate.git.head` when the working tree carries uncommitted changes
 *    asks GitHub about bytes it has never seen. A green answer would be true
 *    about the commit and false about the candidate. Dirty ⇒ INCOMPLETE.
 *
 * 2. THE REQUIRED SET IS DECLARED, NOT DISCOVERED. Accepting whatever
 *    `gh run list` happens to return means a required workflow that never
 *    triggered reads as "nothing failed". Release-critical workflows are
 *    named below, and each must have current, successful evidence.
 *
 * RERUNS. GitHub re-runs a workflow in place: the run keeps its id and gains
 * an attempt, and `conclusion` reflects the latest attempt. A failed run
 * followed by a successful re-run must therefore read as success, not as a
 * permanent failure. Normalisation takes the newest run per workflow by
 * attempt, then by creation time, and judges only that one.
 *
 * Read-only: it queries conclusions and never re-runs or mutates a workflow.
 */

import { pass, fail, incomplete } from "../lib/status.mjs";
import { REUSE } from "../lib/evidence.mjs";
import { run, hasTool } from "../lib/exec.mjs";

const ID = "ci-integrity";

/**
 * Workflows that must be green before a release.
 *
 * Matched against `workflowName`. Anything else is recorded as context but
 * never counted as release proof.
 */
export const REQUIRED_WORKFLOWS = Object.freeze(["CI", "Versioned Copy Guard"]);

/** Conclusions that mean "this did not demonstrably succeed". */
const BAD = new Set(["failure", "timed_out", "cancelled", "startup_failure", "action_required", "stale", "skipped"]);

/**
 * Reduce raw `gh run list` output to one verdict per required workflow.
 *
 * Pure, so rerun and missing-workflow semantics are testable without network.
 *
 * @returns {{perWorkflow: object[], missing: string[], pending: string[], failing: object[], extra: object[]}}
 */
export function normalizeWorkflowRuns(runs, requiredNames = REQUIRED_WORKFLOWS) {
  const byName = new Map();
  for (const r of runs ?? []) {
    const name = r.workflowName ?? r.name;
    const prev = byName.get(name);
    // Newest wins: higher attempt first, then later creation time. A re-run
    // supersedes the attempt it replaced.
    const newer =
      !prev ||
      (r.attempt ?? 1) > (prev.attempt ?? 1) ||
      ((r.attempt ?? 1) === (prev.attempt ?? 1) && new Date(r.createdAt ?? 0) > new Date(prev.createdAt ?? 0));
    if (newer) byName.set(name, r);
  }

  const perWorkflow = [];
  const missing = [];
  const pending = [];
  const failing = [];

  for (const name of requiredNames) {
    const r = byName.get(name);
    if (!r) {
      missing.push(name);
      perWorkflow.push({ workflow: name, state: "MISSING" });
      continue;
    }
    if (r.status !== "completed") {
      pending.push(name);
      perWorkflow.push({ workflow: name, state: "PENDING", status: r.status, attempt: r.attempt ?? 1 });
      continue;
    }
    if (r.conclusion === "success") {
      perWorkflow.push({ workflow: name, state: "SUCCESS", attempt: r.attempt ?? 1, runId: r.databaseId ?? null });
      continue;
    }
    if (BAD.has(r.conclusion)) {
      failing.push({ workflow: name, conclusion: r.conclusion, attempt: r.attempt ?? 1, runId: r.databaseId ?? null });
      perWorkflow.push({ workflow: name, state: "FAILED", conclusion: r.conclusion, attempt: r.attempt ?? 1 });
      continue;
    }
    // An unrecognised conclusion is not evidence of success.
    pending.push(name);
    perWorkflow.push({ workflow: name, state: "UNKNOWN", conclusion: r.conclusion });
  }

  const extra = [...byName.keys()].filter((n) => !requiredNames.includes(n)).map((n) => ({ workflow: n, conclusion: byName.get(n).conclusion }));
  return { perWorkflow, missing, pending, failing, extra };
}

export default {
  id: ID,
  title: "Required CI workflows are green on the candidate commit",
  required: true,
  inputs: [".github/workflows", "package.json", "backend/package.json", "frontend/package.json"],
  // Remote state: a re-run, a new push or a cancelled job changes the answer
  // with the candidate untouched. Never reuse.
  reuse: REUSE.NEVER,

  async run({ repoRoot, store, candidate }) {
    // Rule 1: remote CI has never executed uncommitted bytes.
    if (candidate.git.clean === false) {
      return incomplete(
        ID,
        `candidate is dirty (${candidate.git.modifiedPaths.length} modified, ${candidate.git.untrackedPaths.length} untracked); remote CI cannot certify uncommitted content`,
        {
          evidence: {
            reason: "dirty candidate",
            head: candidate.git.head,
            candidateId: candidate.candidateId,
            modifiedPaths: candidate.git.modifiedPaths.slice(0, 50),
            untrackedPaths: candidate.git.untrackedPaths.slice(0, 50),
            remediation: "commit the candidate and let the required workflows run against that commit",
          },
        },
      );
    }

    if (!hasTool("gh")) {
      return incomplete(ID, "gh CLI not installed; CI conclusions for this commit could not be retrieved", {
        evidence: { reason: "gh absent", requiredWorkflows: REQUIRED_WORKFLOWS },
      });
    }
    if (run("gh", ["auth", "status"], { cwd: repoRoot, timeoutMs: 30_000 }).status !== 0) {
      return incomplete(ID, "gh CLI is not authenticated; CI conclusions could not be retrieved", {
        evidence: { reason: "gh unauthenticated", requiredWorkflows: REQUIRED_WORKFLOWS },
      });
    }

    const head = candidate.git.head;
    if (!head) return incomplete(ID, "candidate has no resolvable HEAD commit", { evidence: { head: null } });

    const res = run(
      "gh",
      ["run", "list", "--commit", head, "--limit", "100", "--json",
        "name,conclusion,status,workflowName,databaseId,headBranch,createdAt,attempt"],
      { cwd: repoRoot, timeoutMs: 120_000 },
    );
    if (res.status !== 0) {
      return incomplete(ID, `gh run list failed: ${res.stderr.trim().split("\n")[0] || `exit ${res.status}`}`, {
        evidence: { exitCode: res.status, stderr: res.stderr.slice(0, 2000) },
      });
    }

    let runs;
    try {
      runs = JSON.parse(res.stdout);
    } catch (err) {
      return incomplete(ID, `could not parse gh output: ${err.message}`, { evidence: { raw: res.stdout.slice(0, 2000) } });
    }

    const norm = normalizeWorkflowRuns(runs, REQUIRED_WORKFLOWS);
    const artifacts = [store.writeArtifact(ID, "workflow-runs.json", { head, requiredWorkflows: REQUIRED_WORKFLOWS, runs, normalized: norm })];
    const evidence = { head, requiredWorkflows: REQUIRED_WORKFLOWS, ...norm };

    // A proven failure is actionable now and outranks missing coverage.
    if (norm.failing.length) {
      const names = norm.failing.map((f) => `${f.workflow}=${f.conclusion}`).join(", ");
      return fail(ID, `required workflow(s) not green on ${head.slice(0, 12)}: ${names}`, { evidence, artifacts });
    }
    if (norm.missing.length) {
      return incomplete(ID, `required workflow(s) never ran on ${head.slice(0, 12)}: ${norm.missing.join(", ")}`, {
        evidence,
        artifacts,
      });
    }
    if (norm.pending.length) {
      return incomplete(ID, `required workflow(s) still in progress on ${head.slice(0, 12)}: ${norm.pending.join(", ")}`, {
        evidence,
        artifacts,
      });
    }
    return pass(ID, `all ${REQUIRED_WORKFLOWS.length} required workflows succeeded on ${head.slice(0, 12)}`, { evidence, artifacts });
  },
};
