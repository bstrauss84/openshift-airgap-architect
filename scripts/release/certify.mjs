#!/usr/bin/env node
/**
 * OAA release certification — single top-level entry point.
 *
 *   npm run release:certify                        FULL release certification
 *   npm run release:certify -- --axis identity     PARTIAL: targeted diagnostic
 *   npm run release:certify -- --skip-containers   PARTIAL: skips image axes
 *   npm run release:certify -- --list              list axes and exit
 *   npm run release:certify -- --reuse             reuse non-stale prior evidence
 *
 * FULL VERSUS PARTIAL IS THE CENTRAL DISTINCTION. `--axis` and
 * `--skip-containers` are useful for development, and both omit required
 * axes. A run that omits a required axis has said nothing about release
 * readiness, so it is marked PARTIAL and can never report GREEN no matter how
 * many of the axes it did run passed. The omitted axes are named in the
 * console output, in summary.md and in summary.json, so a partial result
 * cannot be mistaken for a complete one by a human or by a script.
 *
 * WHAT THIS IS FOR. Every tranche of this project has been certified by
 * running a hand-picked set of commands and reading the output. That is
 * artisanal: not repeatable, evidence not retained, nothing binding the
 * evidence to the exact candidate, and a check that could not run looking the
 * same as a check that passed.
 *
 * DESIGN RULES, all of which exist because of a specific past failure:
 *
 *   - This script ORCHESTRATES. It contains no certification logic; each axis
 *     is an independent module under axes/.
 *   - An axis that throws becomes INCOMPLETE, never a crash and never a skip.
 *   - Nothing here can upgrade a status. Waivers come from a tracked file,
 *     must name an owner and an unambiguous expiry, cannot produce PASS, and
 *     cannot touch a non-waivable axis.
 *   - Malformed waiver governance forces the run verdict off GREEN.
 *   - Evidence is written to a fresh per-run directory, never into a shared
 *     mutable one.
 *   - The run never mutates the candidate: no install, no build, no git write.
 *   - Resources the harness creates (OCI archives, temp dirs) are cleaned up
 *     even when an axis throws.
 *
 * Exit codes: 0 GREEN, 1 RED, 2 INCOMPLETE, 3 harness error, 4 PARTIAL.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AXES, AXIS_IDS, REQUIRED_AXIS_IDS, NON_WAIVABLE_AXIS_IDS, CONTAINER_AXES, axisById } from "./axes/index.mjs";
import { describeCandidate } from "./lib/candidate.mjs";
import {
  EvidenceStore, EVIDENCE_DIRNAME, REUSE, candidateFiles, inputDigest, contextDigest, findReusableEvidence,
} from "./lib/evidence.mjs";
import {
  applyWaiver, validateWaiverSet, overall, releaseVerdict, exitCodeFor, incomplete, isBlocking, EXIT,
} from "./lib/status.mjs";
import { resolveShippingImages, ImageArchives } from "./lib/images.mjs";
import { loadBuildManifest } from "./lib/provenance.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");

export function parseArgs(argv) {
  const opts = { axes: [], skipContainers: false, list: false, reuse: false, evidenceDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--axis") opts.axes.push(argv[++i]);
    else if (a.startsWith("--axis=")) opts.axes.push(a.slice(7));
    else if (a === "--skip-containers") opts.skipContainers = true;
    else if (a === "--list") opts.list = true;
    else if (a === "--reuse") opts.reuse = true;
    else if (a === "--evidence-dir") opts.evidenceDir = argv[++i];
    else if (a === "--help" || a === "-h") opts.help = true;
    else opts.unknown = [...(opts.unknown ?? []), a];
  }
  return opts;
}

/** Waivers are governance: tracked in git, reviewable in history, never generated. */
export function loadWaivers(repoRoot) {
  const file = path.join(repoRoot, "scripts", "release", "waivers.json");
  if (!fs.existsSync(file)) return { waivers: [], errors: [] };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return { waivers: [], errors: [`waivers.json is not valid JSON: ${err.message}`] };
  }
  return validateWaiverSet(Array.isArray(parsed?.waivers) ? parsed.waivers : [], {
    knownAxisIds: AXIS_IDS,
    nonWaivableAxisIds: NON_WAIVABLE_AXIS_IDS,
  });
}

function renderMarkdown(summary) {
  const { candidate, results, releaseVerdict: verdict, scope, missingRequiredAxes } = summary;
  const row = (r) =>
    `| ${r.axis} | ${r.status}${r.waivedFrom ? ` (was ${r.waivedFrom})` : ""} | ${String(r.detail).replace(/\|/g, "\\|")} |`;

  return [
    "# Release certification summary",
    "",
    `**Release verdict:** ${verdict}`,
    `**Scope:** ${scope.toUpperCase()}${scope === "partial" ? " — this run did NOT attempt every required axis and cannot certify a release" : ""}`,
    "",
    "## Candidate",
    "",
    "| field | value |",
    "| --- | --- |",
    `| candidate id | \`${candidate.candidateId}\` |`,
    `| HEAD | \`${candidate.git.head}\` |`,
    `| branch | \`${candidate.git.branch}\` |`,
    `| working tree | ${candidate.git.clean ? "clean" : `DIRTY — ${candidate.git.modifiedPaths.length} modified, ${candidate.git.untrackedPaths.length} untracked`} |`,
    `| harness revision | \`${candidate.harness.digest?.slice(0, 16) ?? "unknown"}\` (${candidate.harness.fileCount} files) |`,
    `| run id | \`${summary.runId}\` |`,
    `| host | ${candidate.environment.osName ?? candidate.environment.platform} ${candidate.environment.osVersion ?? ""} ${candidate.environment.arch} |`,
    `| node / npm | ${candidate.tools.node} / ${candidate.tools.npm ?? "absent"} |`,
    `| container engine | ${candidate.tools.podman ?? candidate.tools.docker ?? "absent"} |`,
    `| scanners | trivy=${candidate.tools.trivy ?? "absent"}, grype=${candidate.tools.grype ?? "absent"}, syft=${candidate.tools.syft ?? "absent"} |`,
    `| timestamp | ${candidate.timestamp} |`,
    "",
    "## Axes",
    "",
    "| axis | status | detail |",
    "| --- | --- | --- |",
    ...results.map(row),
    "",
    ...(missingRequiredAxes.length
      ? [
          "## Required axes NOT attempted",
          "",
          "This run cannot certify a release. The following required proofs were omitted:",
          "",
          ...missingRequiredAxes.map((a) => `- \`${a}\``),
          "",
        ]
      : []),
    ...(summary.waiverErrors.length ? ["## Waiver governance problems", "", ...summary.waiverErrors.map((e) => `- ${e}`), ""] : []),
    "> INCOMPLETE means a required proof could not be performed. PARTIAL means a",
    "> required proof was not attempted. Neither is a pass, and neither may be",
    "> converted into one.",
    "",
  ].join("\n");
}

async function runAxis(axis, ctx) {
  const started = Date.now();
  try {
    const res = await axis.run(ctx);
    return { ...res, durationMs: Date.now() - started };
  } catch (err) {
    // An axis that throws has not proven anything. INCOMPLETE, with the error
    // retained — never a crash that abandons the run, never a silent skip.
    return incomplete(axis.id, `axis threw: ${err?.message ?? String(err)}`, {
      evidence: { error: String(err?.stack ?? err) },
    });
  }
}

/** Compute an axis's context digest, tolerating a contextKey that throws. */
function axisContext(axis, ctx) {
  if (axis.reuse !== REUSE.CONTEXT || typeof axis.contextKey !== "function") return { key: null, digest: null };
  try {
    const key = axis.contextKey(ctx);
    return { key, digest: contextDigest(key) };
  } catch (err) {
    // No context digest means a context-bound axis cannot be reused. That is
    // the safe direction.
    return { key: { error: String(err?.message ?? err) }, digest: null };
  }
}

export async function certify(argv = [], { repoRoot = REPO_ROOT, now = new Date() } = {}) {
  const opts = parseArgs(argv);

  if (opts.help) {
    process.stdout.write(`${fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]}\n`);
    return { releaseVerdict: "GREEN", exitCode: EXIT.GREEN, results: [] };
  }
  if (opts.list) {
    for (const a of AXES) {
      const flags = [a.required !== false ? "required" : "optional", a.nonWaivable ? "non-waivable" : null, a.planned ? "planned" : null]
        .filter(Boolean)
        .join(",");
      process.stdout.write(`${a.id.padEnd(26)} [${flags}] ${a.title}\n`);
    }
    return { releaseVerdict: "GREEN", exitCode: EXIT.GREEN, results: [] };
  }
  if (opts.unknown?.length) {
    process.stderr.write(`unknown argument(s): ${opts.unknown.join(" ")}\n`);
    return { releaseVerdict: "HARNESS_ERROR", exitCode: EXIT.HARNESS_ERROR, results: [] };
  }

  let selected = AXES;
  if (opts.axes.length) {
    const bad = opts.axes.filter((id) => !axisById(id));
    if (bad.length) {
      process.stderr.write(`unknown axis: ${bad.join(", ")}\navailable: ${AXIS_IDS.join(", ")}\n`);
      return { releaseVerdict: "HARNESS_ERROR", exitCode: EXIT.HARNESS_ERROR, results: [] };
    }
    selected = opts.axes.map(axisById);
  }
  if (opts.skipContainers) selected = selected.filter((a) => !CONTAINER_AXES.includes(a.id));

  const selectedIds = selected.map((a) => a.id);
  const missingRequiredAxes = REQUIRED_AXIS_IDS.filter((id) => !selectedIds.includes(id));
  const scope = missingRequiredAxes.length ? "partial" : "full";

  // THE CERTIFICATION OF RECORD ALWAYS RUNS FRESH.
  //
  // Reused evidence is read out of an older run directory and inserted into
  // this summary, but its artifacts are not copied forward — so a full run
  // using reuse would produce a run directory that is not self-contained,
  // while claiming to be the release evidence. On top of that, no context key
  // can fully specify installed dependency trees, so "equivalent context" is
  // not provable for every axis. Rather than build a cache that copies
  // artifacts and models dependency state, reuse is simply refused for full
  // runs: it is a diagnostic convenience, not release evidence.
  if (opts.reuse && scope === "full") {
    process.stderr.write(
      "--reuse is a PARTIAL/diagnostic convenience and cannot be used for a full release certification.\n" +
        "The certification of record executes every required axis fresh, so that its run directory is self-contained.\n" +
        "Either drop --reuse, or scope the run down with --axis <id> for diagnostics.\n",
    );
    return { releaseVerdict: "HARNESS_ERROR", exitCode: EXIT.HARNESS_ERROR, results: [] };
  }

  const candidate = describeCandidate(repoRoot, { now });
  const evidenceRoot = path.resolve(repoRoot, opts.evidenceDir ?? EVIDENCE_DIRNAME);
  const store = new EvidenceStore(evidenceRoot, candidate, { now });
  store.writeMetadata();

  const { waivers, errors: waiverErrors } = loadWaivers(repoRoot);

  // Shipping images are resolved ONCE so every container axis certifies the
  // same image IDs, and each image is exported to an OCI archive at most once
  // per run and shared between the scanner and the SBOM generator.
  const needsImages = selected.some((a) => CONTAINER_AXES.includes(a.id));
  const shippingImages = needsImages ? resolveShippingImages() : { engine: null, images: [] };
  const buildManifest = loadBuildManifest(repoRoot);
  const archives = needsImages && shippingImages.engine ? new ImageArchives(shippingImages.engine) : { archiveFor: () => ({ ok: false, reason: "no container engine" }), cleanup() {} };

  const files = candidateFiles(repoRoot);
  const results = [];

  try {
    for (const axis of selected) {
      const ctx = { repoRoot, store, candidate, shippingImages, buildManifest, archives, now };
      const { digest: inputs } = inputDigest(repoRoot, axis.inputs, files);
      const { key: ctxKey, digest: ctxDigest } = axisContext(axis, ctx);
      const reuseClass = axis.reuse ?? REUSE.CONTEXT;

      if (opts.reuse) {
        const found = findReusableEvidence(evidenceRoot, axis.id, {
          candidateId: candidate.candidateId,
          inputDigest: inputs,
          contextDigest: ctxDigest,
          reuseClass,
        });
        if (found.found) {
          results.push({ ...found.stored.result, reused: true, reusedFromRun: found.runId, reuseReason: found.reason });
          continue;
        }
      }

      process.stderr.write(`→ ${axis.id}\n`);
      let res = await runAxis(axis, ctx);

      if (isBlocking(res.status)) {
        const waiver = waivers.find((w) => w.axis === axis.id);
        res = applyWaiver(res, waiver, now, { nonWaivable: axis.nonWaivable === true });
      }

      store.recordAxis(axis.id, {
        inputDigest: inputs,
        inputPrefixes: axis.inputs,
        reuseClass,
        contextKey: ctxKey,
        contextDigest: ctxDigest,
        harnessRevision: candidate.harness.digest,
        producedAt: new Date().toISOString(),
        result: res,
      });
      results.push(res);
    }
  } finally {
    // Multi-gigabyte OCI archives must not outlive the run, including when an
    // axis throws.
    archives.cleanup();
  }

  const verdict = releaseVerdict({ results, missingRequiredAxes, governanceErrors: waiverErrors });
  const summary = {
    schemaVersion: 2,
    runId: store.runId,
    scope,
    releaseVerdict: verdict,
    // The rollup across the axes that actually ran. Useful for diagnostics,
    // and deliberately NOT the release verdict.
    executedAxesVerdict: overall(results),
    candidate,
    requiredAxes: REQUIRED_AXIS_IDS,
    axesRun: selectedIds,
    missingRequiredAxes,
    nonWaivableAxes: NON_WAIVABLE_AXIS_IDS,
    waiverErrors,
    results,
  };

  store.writeSummary(summary);
  store.writeMarkdown(renderMarkdown(summary));
  store.writeLatestPointer(summary);

  return { ...summary, evidenceRoot, evidenceDir: store.root, exitCode: exitCodeFor(verdict) };
}

function report(summary) {
  const w = (s) => process.stdout.write(s);
  w("\nOAA Release Certification\n=========================\n");
  w(`candidate : ${summary.candidate.exact}\n`);
  w(`branch    : ${summary.candidate.git.branch}\n`);
  w(`harness   : ${summary.candidate.harness.digest?.slice(0, 16)} (${summary.candidate.harness.fileCount} files)\n`);
  w(`scope     : ${summary.scope.toUpperCase()}\n`);
  w(`evidence  : ${summary.evidenceDir}\n\n`);
  for (const r of summary.results) {
    w(`${r.axis.padEnd(26)} ${r.status.padEnd(15)} ${r.detail}${r.reused ? `  [reused from ${r.reusedFromRun}]` : ""}\n`);
  }
  if (summary.missingRequiredAxes.length) {
    w(`\nREQUIRED AXES NOT ATTEMPTED (${summary.missingRequiredAxes.length}): ${summary.missingRequiredAxes.join(", ")}\n`);
  }
  for (const e of summary.waiverErrors) w(`\nWAIVER GOVERNANCE PROBLEM: ${e}\n`);
  w(`\nRELEASE VERDICT: ${summary.releaseVerdict}\n`);
  if (summary.releaseVerdict === "PARTIAL") {
    w("PARTIAL is not a pass. This run did not attempt every required axis, so it says nothing about release readiness.\n");
  } else if (summary.releaseVerdict === "INCOMPLETE") {
    w("INCOMPLETE is not a pass. Each axis above names what could not be proven and how to close it.\n");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const summary = await certify(process.argv.slice(2));
    if (summary.results.length) report(summary);
    process.exit(summary.exitCode);
  } catch (err) {
    process.stderr.write(`certification harness error: ${err?.stack ?? err}\n`);
    process.exit(EXIT.HARNESS_ERROR);
  }
}
