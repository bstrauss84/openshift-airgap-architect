/**
 * AXIS: docs — documentation claims still agree with the code.
 *
 * Tranche 8 §15 asks for documentation tests that validate FACTS where
 * machine-verifiable, rather than grepping for words. Two existing suites
 * already do that and are reused rather than duplicated:
 *
 *   scripts/validate-release-docs.test.mjs  changelog/README version claims,
 *                                           supported-minor lists, relative links
 *   node scripts/validate-param-authority.js  docs index, catalogs, parity,
 *                                           NMState guards
 *
 * This axis adds one thing neither covers: repository-metadata truthfulness.
 * `package.json#repository.url` points at `billstrauss/openshift-airgap-architect`
 * while every git remote points at `bstrauss84/...`. That is a one-line defect
 * with real consequences — it is what tooling and published package metadata
 * resolve for issue links and provenance.
 */

import fs from "node:fs";
import path from "node:path";
import { pass, fail, incomplete } from "../lib/status.mjs";
import { REUSE } from "../lib/evidence.mjs";
import { run, record, tail } from "../lib/exec.mjs";
import { tryExec } from "../lib/candidate.mjs";

const ID = "docs";

/** Owner/name from a GitHub remote or repository URL, ignoring protocol and .git. */
export function repoSlug(url) {
  if (!url) return null;
  const m = String(url).match(/github\.com[/:]([^/]+)\/([^/.\s]+)/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

export default {
  id: ID,
  title: "Documentation and repository metadata agree with the code",
  required: true,
  // Candidate content, but read by Node validators, so the interpreter is
  // part of the answer.
  reuse: REUSE.CONTEXT,
  contextKey: () => ({ node: process.version }),
  inputs: ["docs", "README.md", "CHANGELOG.md", "package.json", "data", "schema", "scripts"],

  async run({ repoRoot, store }) {
    const checks = [];

    for (const c of [
      { name: "release-docs", argv: ["node", "--test", "scripts/validate-release-docs.test.mjs"] },
      { name: "param-authority", argv: ["node", "scripts/validate-param-authority.js"] },
    ]) {
      const [cmd, ...args] = c.argv;
      const res = run(cmd, args, { cwd: repoRoot, timeoutMs: 15 * 60_000 });
      checks.push({ name: c.name, ...record(res), tail: tail(res, 30) });
    }

    // Repository metadata vs the remotes actually configured.
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    const declared = repoSlug(pkg?.repository?.url);
    const remotes = (tryExec("git", ["-C", repoRoot, "remote", "-v"]) ?? "")
      .split("\n")
      .filter(Boolean)
      .map((l) => ({ name: l.split(/\s+/)[0], slug: repoSlug(l.split(/\s+/)[1]) }));
    const originSlug = remotes.find((r) => r.name === "origin")?.slug ?? null;
    const metadataOk = Boolean(declared) && declared === originSlug;
    checks.push({
      name: "repository-metadata",
      exitCode: metadataOk ? 0 : 1,
      tail: metadataOk
        ? `package.json repository matches origin (${declared})`
        : `package.json declares "${declared}" but origin is "${originSlug}"`,
    });

    const artifacts = [store.writeArtifact(ID, "checks.json", { checks, declared, remotes })];
    const unspawnable = checks.filter((c) => c.spawnError);
    if (unspawnable.length) {
      return incomplete(ID, `could not execute: ${unspawnable.map((c) => c.name).join(", ")}`, {
        evidence: { checks },
        artifacts,
      });
    }
    const failed = checks.filter((c) => c.exitCode !== 0);
    if (failed.length) {
      return fail(ID, `${failed.length}/${checks.length} documentation check(s) failed: ${failed.map((c) => c.name).join(", ")}`, {
        evidence: { checks },
        artifacts,
      });
    }
    return pass(ID, `${checks.length} documentation and metadata checks passed`, { evidence: { checks }, artifacts });
  },
};
