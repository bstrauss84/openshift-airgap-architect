/**
 * Candidate identity binding.
 *
 * Certification evidence is only meaningful if it is bound to the exact thing
 * that was certified. This module computes that binding: what the tree was,
 * what the harness was, and what the environment was, at the moment a run
 * started.
 *
 * The non-obvious requirement is DIRTY TREES. A release run should happen on a
 * clean tree, but during hardening it frequently will not, and "HEAD = <sha>"
 * is then a lie — the files on disk are not that commit. So the candidate id
 * folds in a digest of the uncommitted delta. Two runs at the same HEAD with
 * different working-tree contents get different candidate ids, which is what
 * makes stale-evidence detection work at all.
 *
 * `git` is invoked through argv arrays (never a shell string) so a branch or
 * path containing shell metacharacters cannot alter the command.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Run a command, returning trimmed stdout, or `null` if it is unavailable or fails. */
export function tryExec(cmd, args, { cwd = process.cwd(), timeoutMs = 30_000 } = {}) {
  try {
    return execFileSync(cmd, args, {
      cwd,
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  } catch {
    return null;
  }
}

/** As tryExec, but preserves raw bytes. Diffs with binary hunks are not UTF-8. */
function tryExecBuffer(cmd, args, { cwd = process.cwd(), timeoutMs = 60_000 } = {}) {
  try {
    return execFileSync(cmd, args, {
      cwd,
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 512 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/**
 * Digest the harness itself.
 *
 * If the certification code changes, previous evidence was produced by a
 * different instrument and must not be reused unexamined. Files are sorted so
 * the digest does not depend on directory iteration order.
 */
export function harnessRevision(releaseDir) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /\.(mjs|js|json|sh)$/.test(entry.name)) files.push(full);
    }
  };
  if (!fs.existsSync(releaseDir)) return { digest: null, fileCount: 0 };
  walk(releaseDir);

  const h = createHash("sha256");
  for (const f of files) {
    h.update(path.relative(releaseDir, f));
    h.update("\0");
    h.update(fs.readFileSync(f));
    h.update("\0");
  }
  return { digest: h.digest("hex"), fileCount: files.length };
}

/** Git facts about the tree being certified. */
export function gitState(repoRoot) {
  const git = (...args) => tryExec("git", ["-C", repoRoot, ...args]);
  const gitBuf = (...args) => tryExecBuffer("git", ["-C", repoRoot, ...args]);

  const head = git("rev-parse", "HEAD");
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");

  // `--binary` is load-bearing, not a nicety. A plain `git diff` renders a
  // changed binary file as the single line "Binary files a/x and b/x differ",
  // which is IDENTICAL for two completely different replacement contents. A
  // candidate id built from that would treat two different trees as the same
  // candidate — exactly the stale-evidence reuse this binding exists to stop.
  // `--binary` emits the literal delta, so content changes always move the
  // digest. Mode changes and deletions are carried in the diff header either
  // way. Captured as raw bytes: binary hunks are not valid UTF-8.
  const trackedDiff = gitBuf("diff", "--binary", "HEAD") ?? Buffer.alloc(0);
  const stagedDiff = gitBuf("diff", "--cached", "--binary") ?? Buffer.alloc(0);
  const modified = (git("diff", "--name-only", "HEAD") ?? "").split("\n").filter(Boolean);
  const untracked = (git("ls-files", "--others", "--exclude-standard") ?? "").split("\n").filter(Boolean);

  // Untracked files are part of the candidate: an uncommitted new source file
  // changes behaviour exactly as much as an edit to a tracked one.
  const untrackedDigest = createHash("sha256");
  for (const rel of untracked.slice().sort()) {
    untrackedDigest.update(rel);
    untrackedDigest.update("\0");
    try {
      const st = fs.statSync(path.join(repoRoot, rel));
      untrackedDigest.update(st.isFile() ? fs.readFileSync(path.join(repoRoot, rel)) : Buffer.alloc(0));
    } catch {
      untrackedDigest.update("<unreadable>");
    }
    untrackedDigest.update("\0");
  }

  const clean = modified.length === 0 && untracked.length === 0 && stagedDiff.length === 0;

  return {
    head,
    branch,
    clean,
    modifiedPaths: modified,
    untrackedPaths: untracked,
    stagedCount: (git("diff", "--cached", "--name-only") ?? "").split("\n").filter(Boolean).length,
    trackedDiffDigest: trackedDiff.length ? sha256(trackedDiff) : null,
    stagedDiffDigest: stagedDiff.length ? sha256(stagedDiff) : null,
    untrackedDigest: untracked.length ? untrackedDigest.digest("hex") : null,
  };
}

/** Versions of every external tool whose behaviour can change a verdict. */
export function toolVersions() {
  const firstLine = (s) => (s ? s.split("\n")[0].trim() : null);
  return {
    node: process.version,
    npm: firstLine(tryExec("npm", ["--version"])),
    git: firstLine(tryExec("git", ["--version"])),
    podman: firstLine(tryExec("podman", ["--version"])),
    skopeo: firstLine(tryExec("skopeo", ["--version"])),
    gitleaks: firstLine(tryExec("gitleaks", ["version"])),
    trivy: firstLine(tryExec("trivy", ["--version"])),
    grype: firstLine(tryExec("grype", ["version"])),
    syft: firstLine(tryExec("syft", ["version"])),
    cosign: firstLine(tryExec("cosign", ["version"])),
    jq: firstLine(tryExec("jq", ["--version"])),
  };
}

/** OS/arch context. Architecture matters: an amd64 scan does not certify arm64. */
export function environment() {
  let osRelease = null;
  try {
    const raw = fs.readFileSync("/etc/os-release", "utf8");
    osRelease = Object.fromEntries(
      raw
        .split("\n")
        .filter((l) => l.includes("="))
        .map((l) => {
          const [k, ...v] = l.split("=");
          return [k, v.join("=").replace(/^"|"$/g, "")];
        }),
    );
  } catch {
    /* not a systemd-style OS; the remaining fields still identify the host */
  }
  return {
    platform: process.platform,
    arch: process.arch,
    osName: osRelease?.NAME ?? null,
    osVersion: osRelease?.VERSION_ID ?? null,
    ci: Boolean(process.env.CI),
  };
}

/**
 * Describe the candidate under certification.
 *
 * `candidateId` is the identity every piece of evidence is bound to. It covers
 * HEAD plus the uncommitted delta, so it is stable across reruns of an
 * unchanged tree and different the moment anything changes.
 */
export function describeCandidate(repoRoot, { now = new Date() } = {}) {
  const git = gitState(repoRoot);
  const harness = harnessRevision(path.join(repoRoot, "scripts", "release"));

  const candidateId = sha256(
    [
      git.head ?? "no-head",
      git.trackedDiffDigest ?? "-",
      git.stagedDiffDigest ?? "-",
      git.untrackedDigest ?? "-",
    ].join("|"),
  );

  return {
    candidateId,
    // Recorded separately so a reader can see at a glance whether the candidate
    // is a commit or a commit-plus-uncommitted-work.
    exact: git.clean ? `${git.head} (clean)` : `${git.head}+dirty:${candidateId.slice(0, 12)}`,
    git,
    harness,
    tools: toolVersions(),
    environment: environment(),
    timestamp: now.toISOString(),
  };
}

export { sha256 };
