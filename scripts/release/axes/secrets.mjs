/**
 * AXIS: secrets — secret scanning and runtime credential lifecycle.
 *
 * This axis does NOT reimplement secret scanning. `scripts/security/tranche-security-gate.sh`
 * already covers both halves properly (worktree / index / reachable-history scans
 * reconciled against an opaque baseline, plus synthetic credential canaries
 * proving credentials reach neither persistence, logs, errors, previews nor
 * default exports) and it is the artifact the project's security posture has
 * been validated against. Certification wraps it and maps its sub-gate
 * statuses onto the certification result model.
 *
 * ONE MAPPING SUBTLETY, and it is the reason this is not a one-line wrapper:
 * the tranche gate folds its container-scan check into a single overall exit
 * code, so a GREEN/RED reading of that script cannot distinguish "a secret
 * leaked" from "no image scanner is installed". Those are a FAIL and an
 * INCOMPLETE respectively, and they belong to different axes. This axis
 * therefore reads the gate's per-check JSON and considers ONLY the secret and
 * credential-lifecycle checks; image scanning is owned by the `images` axis.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pass, fail, incomplete } from "../lib/status.mjs";
import { REUSE } from "../lib/evidence.mjs";
import { run, hasTool, tail } from "../lib/exec.mjs";

const ID = "secrets";

const GATE = "scripts/security/tranche-security-gate.sh";

/**
 * The gate's credential canaries and security regression tests are node:test
 * suites inside backend/ and frontend/. When those dependency trees are absent
 * the runner cannot start, `run_node_test` returns non-zero, and the gate
 * records RED.
 *
 * RED there means "the test did not pass", which is true but not the
 * distinction certification needs: a suite that could not execute has proven
 * nothing, and reporting it as a release-blocking FAIL would be as wrong as
 * reporting it as a PASS. This precondition catches that case up front so the
 * axis reports INCOMPLETE and names the command that would make the proof
 * possible.
 */
const CANARY_DEPS = ["backend/node_modules", "frontend/node_modules"];

/** Checks this axis owns. Everything else in the gate belongs to another axis. */
const OWNED = [
  /gitleaks config self-test/i,
  /secret scan/i,
  /sensitive untracked\/tracked files/i,
  /current-tree credential artifacts/i,
  /credential persistence canaries/i,
  /sqlite persistence/i,
  /state api credential guard/i,
  /logs\/error redaction/i,
  /export redaction/i,
  /explicit opt-in export/i,
  /frontend browser storage/i,
  /security regression tests/i,
];

const owns = (name) => OWNED.some((re) => re.test(name));

export default {
  id: ID,
  title: "Secret scanning and runtime credential lifecycle",
  required: true,
  // NEVER reused. The credential canaries are node:test suites in backend/
  // and frontend/, so this axis inherits the same unspecifiable
  // installed-dependency context as the `tests` axis, on top of the gitleaks
  // version and the history baseline.
  reuse: REUSE.NEVER,
  inputs: ["backend", "frontend", "shared", "scripts", "data", ".gitleaks.toml"],

  async run({ repoRoot, store }) {
    if (!hasTool("gitleaks")) {
      return incomplete(ID, "gitleaks is not installed; secret scanning could not be performed", {
        evidence: { reason: "gitleaks absent", remediation: "see .github/workflows/ci.yml for the pinned, checksum-verified install" },
      });
    }
    if (!hasTool("jq")) {
      return incomplete(ID, "jq is not installed; the tranche security gate cannot produce its JSON result", {
        evidence: { reason: "jq absent" },
      });
    }

    const missingDeps = CANARY_DEPS.filter((d) => !fs.existsSync(path.join(repoRoot, d)));
    if (missingDeps.length) {
      return incomplete(
        ID,
        `credential-lifecycle suites cannot execute: ${missingDeps.join(", ")} absent (run \`npm ci\` in backend/ and frontend/)`,
        {
          evidence: {
            reason: "runtime credential canaries are node:test suites requiring installed dependencies",
            missing: missingDeps,
            note: "The scan half of this axis would still run, but a partial result reported as a whole-axis verdict is the failure mode this harness exists to prevent.",
          },
        },
      );
    }

    // The gate writes its reports to this directory. Everything worth keeping
    // is copied into run-scoped evidence below, so the directory itself is
    // removed on every path out — including the throwing one. A certification
    // harness that leaks temp directories has no standing to report that the
    // application does.
    const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "oaa-certify-secrets-"));
    try {
      const jsonOut = path.join(reportDir, "gate.json");
      const res = run("bash", [GATE, "--json", jsonOut], {
        cwd: repoRoot,
        env: { ...process.env, OAA_GATE_REPORT_DIR: reportDir },
        timeoutMs: 30 * 60_000,
      });

      store.writeArtifact(ID, "gate.log", `${res.stdout}${res.stderr}`);

      let gate;
      try {
        gate = JSON.parse(fs.readFileSync(jsonOut, "utf8"));
      } catch {
        return incomplete(ID, `tranche security gate produced no parseable result (exit ${res.status})`, {
          evidence: { exitCode: res.status, tail: tail(res, 30) },
          artifacts: [store.writeArtifact(ID, "gate-unparseable.txt", tail(res, 200))],
        });
      }

      const mine = (gate.checks ?? []).filter((c) => owns(c.name));
      const artifacts = [store.writeArtifact(ID, "gate.json", gate)];

      if (!mine.length) {
        return incomplete(ID, "tranche security gate reported no secret or credential-lifecycle checks", {
          evidence: { gate },
          artifacts,
        });
      }

      // BASELINE is the gate's own status for reachable-history findings that
      // were each still detected and mechanically reconciled against the
      // opaque baseline. It is a pass by accounting, not by suppression.
      const red = mine.filter((c) => c.status === "RED");
      const blocked = mine.filter((c) => c.status === "INCOMPLETE");

      if (red.length) {
        return fail(ID, `${red.length} secret/credential check(s) RED: ${red.map((c) => c.name).join("; ")}`, {
          evidence: { checks: mine },
          artifacts,
        });
      }
      if (blocked.length) {
        return incomplete(ID, `${blocked.length} secret/credential check(s) INCOMPLETE: ${blocked.map((c) => c.name).join("; ")}`, {
          evidence: { checks: mine },
          artifacts,
        });
      }
      return pass(ID, `${mine.length} secret and credential-lifecycle checks passed`, {
        evidence: { checks: mine },
        artifacts,
      });
    } finally {
      try {
        fs.rmSync(reportDir, { recursive: true, force: true });
      } catch {
        /* best effort: a leftover temp dir must not fail an otherwise complete run */
      }
    }
  },
};
