#!/usr/bin/env node
/**
 * CLI front-end for scripts/security/historyScanBaseline.mjs, used by
 * scripts/security/tranche-security-gate.sh.
 *
 *   history-scan-baseline-cli.mjs history <scanner-report.json> [baseline.json]
 *   history-scan-baseline-cli.mjs tree    [baseline.json]
 *
 * OUTPUT MINIMIZATION. For an exact baseline match this prints only a status and the
 * count of unexpected findings — no path, detector, fingerprint, commit or digest. A
 * resolved baseline is routine, and routine output should not restate what it covers.
 *
 * UNEXPECTED findings are different: they need investigating, so for those the existing
 * SAFE diagnostic metadata (rule, path, line, fingerprint) is emitted. That metadata is
 * already redacted by the scanner and never contains a secret value.
 *
 * EXIT: 0 = PASS or PASS_WITH_RESOLVED_BASELINE. 1 = RED. 2 = could not run.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  reconcileHistoryScan,
  scanTreeForCredentialArtifacts,
  findingIdentity,
  SCAN_RED,
} from "./historyScanBaseline.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const DEFAULT_BASELINE = path.join(HERE, "history-scan-baseline.json");

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

const git = (args, opts = {}) => {
  try {
    return execFileSync("git", ["-C", REPO_ROOT, ...args], opts);
  } catch {
    return null;
  }
};

function cmdHistory(reportPath, baselinePath) {
  if (!fs.existsSync(reportPath)) {
    console.error("history reconciliation: scanner report not found");
    return 2;
  }
  if (!fs.existsSync(baselinePath)) {
    console.error("history reconciliation: baseline not found");
    return 2;
  }
  const baseline = readJson(baselinePath);
  const findings = readJson(reportPath);

  const result = reconcileHistoryScan({
    findings,
    baseline,
    resolveContent: (commit, file) => git(["cat-file", "blob", `${commit}:${file}`], {}),
  });

  console.log(`STATUS=${result.status}`);
  console.log(`UNEXPECTED=${result.unexpected}`);
  console.log(`RESOLVED=${result.resolvedEntries.length}`);

  if (result.status === SCAN_RED) {
    // Only unregistered findings get diagnostic detail. Registered ones are already
    // accounted for and restating them would publish the baseline's coverage.
    const registered = new Set(
      (baseline.entries ?? []).flatMap((e) => (e.findingIdentities ?? []).map((i) => i.identityHash))
    );
    for (const f of findings) {
      if (registered.has(findingIdentity(f))) continue;
      console.log(`      UNEXPECTED rule=${f.RuleID} path=${f.File} line=${f.StartLine} fingerprint=${f.Fingerprint}`);
    }
    for (const reason of result.reasons) console.log(`      ${reason}`);
  }

  return result.status === SCAN_RED ? 1 : 0;
}

function cmdTree(baselinePath) {
  const baseline = fs.existsSync(baselinePath) ? readJson(baselinePath) : undefined;
  const tracked = (git(["ls-files"], { encoding: "utf8" }) ?? "").split("\n").filter(Boolean);
  const untracked = (git(["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" }) ?? "")
    .split("\n")
    .filter(Boolean);
  const files = [...new Set([...tracked, ...untracked])];

  const result = scanTreeForCredentialArtifacts({
    files,
    baseline,
    readText: (p) => {
      const abs = path.join(REPO_ROOT, p);
      try {
        if (fs.statSync(abs).size > 4 * 1024 * 1024) return null;
        return fs.readFileSync(abs, "utf8");
      } catch {
        return null;
      }
    },
  });

  console.log(`STATUS=${result.ok ? "PASS" : "RED"}`);
  console.log(`SCANNED=${files.length}`);
  for (const f of result.findings) {
    console.log(`      BLOCKED path=${f.path} reasons=${f.reasons.join("; ")}`);
  }
  return result.ok ? 0 : 1;
}

function main() {
  const [, , cmd, ...rest] = process.argv;
  try {
    if (cmd === "history") {
      const [report, baseline = DEFAULT_BASELINE] = rest;
      if (!report) {
        console.error("usage: history-scan-baseline-cli.mjs history <report.json> [baseline.json]");
        return 2;
      }
      return cmdHistory(report, baseline);
    }
    if (cmd === "tree") {
      const [baseline = DEFAULT_BASELINE] = rest;
      return cmdTree(baseline);
    }
    console.error("usage: history-scan-baseline-cli.mjs history <report.json> [baseline.json] | tree [baseline.json]");
    return 2;
  } catch (err) {
    console.error(`history-scan-baseline-cli: ${err.message}`);
    return 2;
  }
}

process.exit(main());
