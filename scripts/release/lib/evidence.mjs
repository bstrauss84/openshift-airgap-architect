/**
 * Evidence store, run scoping, and reuse safety.
 *
 * RETENTION POLICY (v2.1 Tranche 8A; see
 * docs/release-hardening/TRANCHE_8A_HARDENING_INVENTORY.md §7):
 *
 *   tracked in git      scripts/release/**           the harness itself
 *                       scripts/release/waivers.json governance: a waiver is a
 *                                                    human decision and must be
 *                                                    reviewable in history
 *   NOT tracked         release-certification/**     every generated run
 *   CI artifact         one run directory
 *   release artifact    one full-certification run directory
 *
 * RUN SCOPING. Evidence is written under `runs/<runId>/`, never into one
 * shared mutable directory. With a shared directory, a later partial run
 * overwrites `summary.json` while leaving the previous run's per-axis files
 * and artifacts beside it, producing a directory that mixes candidates and
 * reads as current. Per-run directories make that structurally impossible:
 * a summary can only ever reference artifacts from its own run, and CI or
 * release packaging can point at exactly one directory.
 *
 * REUSE SAFETY. Matching the candidate and the axis's declared inputs is
 * sufficient only for axes whose truth is a pure function of the source tree.
 * It is not sufficient for anything whose answer can change while the source
 * stands still — a vulnerability database update, a scanner upgrade, a CI
 * re-run, a locally rebuilt image. Those axes declare a CONTEXT KEY, and
 * reuse additionally requires the context digest to match. Axes whose answer
 * lives entirely outside the candidate declare `never` and are always re-run.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { tryExec } from "./candidate.mjs";

export const EVIDENCE_DIRNAME = "release-certification";

/**
 * Reuse classes. Default is the conservative one: an axis that does not say
 * otherwise is assumed to depend on context it has not declared.
 */
export const REUSE = Object.freeze({
  /** Truth is a pure function of the candidate source tree. */
  CANDIDATE: "candidate",
  /** Truth also depends on tools, databases or built artifacts. */
  CONTEXT: "context",
  /** Truth lives outside the candidate entirely; never reuse. */
  NEVER: "never",
});

/** Repo-relative paths of all files the candidate consists of (tracked + untracked). */
export function candidateFiles(repoRoot) {
  const tracked = (tryExec("git", ["-C", repoRoot, "ls-files"]) ?? "").split("\n").filter(Boolean);
  const untracked = (tryExec("git", ["-C", repoRoot, "ls-files", "--others", "--exclude-standard"]) ?? "")
    .split("\n")
    .filter(Boolean);
  return [...new Set([...tracked, ...untracked])].sort();
}

/**
 * Digest the subset of candidate files an axis depends on.
 *
 * Matching is by path prefix on the repo-relative path, so `"backend/src"`
 * covers the whole subtree and `"package.json"` covers exactly that file.
 */
export function inputDigest(repoRoot, prefixes, files = candidateFiles(repoRoot)) {
  const selected = prefixes?.length
    ? files.filter((f) => prefixes.some((p) => f === p || f.startsWith(p.endsWith("/") ? p : `${p}/`)))
    : files;

  const h = createHash("sha256");
  h.update(`n=${selected.length}\0`);
  for (const rel of selected) {
    h.update(rel);
    h.update("\0");
    try {
      h.update(fs.readFileSync(path.join(repoRoot, rel)));
    } catch {
      // A declared input that cannot be read is itself a meaningful state and
      // must change the digest rather than be skipped.
      h.update("<unreadable>");
    }
    h.update("\0");
  }
  return { digest: h.digest("hex"), fileCount: selected.length };
}

/** Stable digest of an axis's declared external context. Key order independent. */
export function contextDigest(contextKey) {
  if (contextKey === null || contextKey === undefined) return null;
  const canonical = JSON.stringify(contextKey, Object.keys(flatten(contextKey)).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

/** Collect every key name in a nested object so JSON.stringify ordering is stable. */
function flatten(obj, out = {}) {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      out[k] = true;
      flatten(v, out);
    }
  } else if (Array.isArray(obj)) {
    for (const v of obj) flatten(v, out);
  }
  return out;
}

/** `20261012T231500Z-6b4f486d721f` — sorts chronologically, names its candidate. */
export function makeRunId(candidate, now = new Date()) {
  const ts = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${ts}-${String(candidate.candidateId ?? "unknown").slice(0, 12)}`;
}

export class EvidenceStore {
  /**
   * @param {string} evidenceRoot absolute path of `release-certification/`
   * @param {object} candidate from describeCandidate()
   */
  /**
   * Claims an exclusive run directory.
   *
   * Run ids are second-granular, so two runs started within the same second
   * on the same candidate would collide. Neither obvious response is
   * acceptable: reusing the directory merges two runs' evidence, and throwing
   * aborts an otherwise valid certification over a clock coincidence. So a
   * collision is disambiguated with a suffix, and exclusivity is established
   * by a non-recursive `mkdir`, which fails atomically with EEXIST rather
   * than racing a separate existence check.
   *
   * An explicit `runId` is honoured exactly and never suffixed: callers who
   * name a run are asserting it is new, and silently renaming it would make
   * the directory they expect disagree with the one that exists.
   */
  constructor(evidenceRoot, candidate, { runId, now = new Date() } = {}) {
    this.evidenceRoot = evidenceRoot;
    this.candidate = candidate;
    const base = runId ?? makeRunId(candidate, now);
    fs.mkdirSync(path.join(evidenceRoot, "runs"), { recursive: true });

    for (let attempt = 0; ; attempt++) {
      const id = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const dir = path.join(evidenceRoot, "runs", id);
      try {
        fs.mkdirSync(dir); // non-recursive: EEXIST is the exclusivity signal
        this.runId = id;
        this.root = dir;
        break;
      } catch (err) {
        if (err.code !== "EEXIST") throw err;
        if (runId) throw new Error(`evidence run directory already exists: ${dir}`);
        if (attempt >= 99) throw new Error(`could not claim an evidence run directory under ${evidenceRoot}`);
      }
    }
    fs.mkdirSync(path.join(this.root, "axes"), { recursive: true });
  }

  artifactPath(axisId, filename) {
    const dir = path.join(this.root, axisId);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, filename);
  }

  /** Write an artifact; returns the run-root-relative path. */
  writeArtifact(axisId, filename, contents) {
    const abs = this.artifactPath(axisId, filename);
    const body = typeof contents === "string" ? contents : `${JSON.stringify(contents, null, 2)}\n`;
    fs.writeFileSync(abs, body);
    return path.relative(this.root, abs);
  }

  recordAxis(axisId, record) {
    const file = path.join(this.root, "axes", `${axisId}.json`);
    fs.writeFileSync(
      file,
      `${JSON.stringify({ runId: this.runId, candidateId: this.candidate.candidateId, ...record }, null, 2)}\n`,
    );
    return path.relative(this.root, file);
  }

  writeSummary(summary) {
    fs.writeFileSync(path.join(this.root, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  }

  writeMetadata() {
    fs.writeFileSync(path.join(this.root, "metadata.json"), `${JSON.stringify(this.candidate, null, 2)}\n`);
  }

  writeMarkdown(text) {
    fs.writeFileSync(path.join(this.root, "summary.md"), text);
  }

  /**
   * A pointer to the most recent run.
   *
   * A file, not a symlink: evidence directories are archived and copied
   * between hosts, and a dangling symlink is a worse failure than a stale
   * pointer that names what it points at.
   */
  writeLatestPointer(summary) {
    fs.writeFileSync(
      path.join(this.evidenceRoot, "latest.json"),
      `${JSON.stringify(
        {
          runId: this.runId,
          path: path.relative(this.evidenceRoot, this.root),
          scope: summary.scope,
          releaseVerdict: summary.releaseVerdict,
          candidateId: this.candidate.candidateId,
          finishedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
  }
}

/** Prior run directories, newest first. */
export function priorRuns(evidenceRoot) {
  const runsDir = path.join(evidenceRoot, "runs");
  if (!fs.existsSync(runsDir)) return [];
  return fs
    .readdirSync(runsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .reverse();
}

/**
 * Decide whether a stored axis record still certifies the current candidate.
 *
 * Anything other than an exact match on every applicable dimension is
 * unusable: conservative invalidation is the documented preference over
 * unsafe reuse.
 */
export function evaluateStaleness(stored, { candidateId, inputDigest: current, contextDigest: ctx, reuseClass }) {
  if (reuseClass === REUSE.NEVER) {
    return { usable: false, reason: "axis is classified never-reusable; its truth lives outside the candidate" };
  }
  if (!stored) return { usable: false, reason: "no prior evidence" };
  if (stored.candidateId !== candidateId) {
    return { usable: false, reason: `evidence bound to a different candidate (${String(stored.candidateId).slice(0, 12)})` };
  }
  if (stored.inputDigest !== current) {
    return { usable: false, reason: "declared inputs changed since the evidence was produced" };
  }
  if (reuseClass === REUSE.CONTEXT) {
    if (!ctx || !stored.contextDigest) {
      return { usable: false, reason: "context-bound axis has no recorded context digest to compare" };
    }
    if (stored.contextDigest !== ctx) {
      return { usable: false, reason: "external context changed (tool, database, image or remote state)" };
    }
  }
  return { usable: true, reason: "candidate, declared inputs and context all match" };
}

/** Find the newest prior run whose record for `axisId` is still usable. */
export function findReusableEvidence(evidenceRoot, axisId, criteria) {
  if (criteria.reuseClass === REUSE.NEVER) {
    return { found: false, reason: "axis is classified never-reusable" };
  }
  for (const runId of priorRuns(evidenceRoot)) {
    const file = path.join(evidenceRoot, "runs", runId, "axes", `${axisId}.json`);
    let stored;
    try {
      stored = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const staleness = evaluateStaleness(stored, criteria);
    if (staleness.usable) return { found: true, runId, stored, reason: staleness.reason };
  }
  return { found: false, reason: "no prior run carried usable evidence for this axis" };
}
