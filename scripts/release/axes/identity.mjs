/**
 * AXIS: identity — the release knows what it is.
 *
 * Certifies that the single application-version authority (`VERSION`) agrees
 * with every manifest and lockfile that restates it, and that the supported
 * OpenShift minors declared by the backend and the frontend agree with each
 * other and with the cumulative-support record.
 *
 * This axis is first because every other axis's evidence is captioned with the
 * identity this one establishes. If the candidate cannot say what version it
 * is, nothing downstream is attributable.
 */

import { pass, fail, incomplete } from "../lib/status.mjs";
import { REUSE } from "../lib/evidence.mjs";
import { run, record, tail } from "../lib/exec.mjs";

const ID = "identity";

export default {
  id: ID,
  title: "Release identity and supported-version declarations",
  required: true,
  // Pure function of the candidate: three Node scripts reading tracked files.
  reuse: REUSE.CANDIDATE,
  inputs: [
    "VERSION",
    "package.json",
    "package-lock.json",
    "backend/package.json",
    "backend/package-lock.json",
    "frontend/package.json",
    "frontend/package-lock.json",
    "shared/package.json",
    "backend/src/versionPolicy.js",
    "frontend/src/shared/versionPolicy.js",
    "scripts/lib/released-minor-support.json",
  ],

  async run({ repoRoot, store }) {
    const checks = [
      { name: "app-version-sync", argv: ["node", "scripts/validate-app-version.mjs"] },
      { name: "supported-minors", argv: ["node", "scripts/validate-supported-minors.mjs"] },
      { name: "version-lists", argv: ["node", "scripts/validate-version-lists.mjs"] },
    ];

    const runs = [];
    for (const c of checks) {
      const [cmd, ...args] = c.argv;
      const res = run(cmd, args, { cwd: repoRoot });
      runs.push({ name: c.name, ...record(res), output: tail(res, 40) });
    }

    const artifacts = [store.writeArtifact(ID, "checks.json", runs)];

    const unspawnable = runs.filter((r) => r.spawnError);
    if (unspawnable.length) {
      return incomplete(ID, `could not execute: ${unspawnable.map((r) => r.name).join(", ")}`, {
        evidence: { runs },
        artifacts,
      });
    }

    const failed = runs.filter((r) => r.exitCode !== 0);
    if (failed.length) {
      return fail(ID, `${failed.length}/${runs.length} identity guard(s) failed: ${failed.map((r) => r.name).join(", ")}`, {
        evidence: { runs },
        artifacts,
      });
    }

    const version = runs.find((r) => r.name === "app-version-sync")?.output ?? "";
    return pass(ID, `all ${runs.length} identity guards passed — ${version.split("\n").pop()}`, {
      evidence: { runs },
      artifacts,
    });
  },
};
