/**
 * OpenShift Airgap Architect - Owned temporary artifact registry (L4)
 *
 * Every temporary file or directory this process creates is cleaned up by the
 * operation that created it. That ownership is correct and stays correct —
 * but it is all reached through asynchronous callbacks: a child process's
 * `close` handler, an archive stream's `finally`, a request's error path. None
 * of those run when the process is told to exit.
 *
 * This registry is the shutdown-time complement, not a replacement. It records
 * what is currently outstanding so a terminating process can remove it
 * synchronously, which is the only kind of cleanup Node can guarantee at exit.
 * It deliberately tracks only artifacts this process created and still owns —
 * it never discovers or sweeps paths by pattern, so a concurrent process's
 * temp directories can never be collateral.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import fs from "node:fs";
import path from "node:path";

/** absolute path -> { kind: "file" | "dir", label } */
const tracked = new Map();

const normalize = (targetPath) => {
  if (typeof targetPath !== "string" || targetPath.length === 0) return null;
  try {
    return path.resolve(targetPath);
  } catch {
    return null;
  }
};

/**
 * Record a temporary artifact this process owns.
 * @param {string} targetPath
 * @param {"file"|"dir"} kind
 * @param {string} label - coarse category for shutdown logging; never content.
 */
export function trackTempArtifact(targetPath, kind, label) {
  const resolved = normalize(targetPath);
  if (!resolved) return targetPath;
  tracked.set(resolved, { kind: kind === "dir" ? "dir" : "file", label: label || "temp" });
  return targetPath;
}

/**
 * Forget an artifact whose owner has already removed it. Safe for paths that
 * were never tracked, so generic cleanup helpers can call it unconditionally.
 */
export function untrackTempArtifact(targetPath) {
  const resolved = normalize(targetPath);
  if (!resolved) return false;
  return tracked.delete(resolved);
}

/** Snapshot of what is outstanding right now. Test and diagnostic use. */
export function listTempArtifacts() {
  return [...tracked.entries()].map(([targetPath, meta]) => ({ path: targetPath, ...meta }));
}

/**
 * Remove every outstanding artifact, synchronously.
 *
 * Never throws: shutdown must not be derailed by one unremovable path. Returns
 * a summary the caller can log — counts and categories, never file contents.
 * Entries that cannot be removed stay tracked so a later attempt can retry,
 * and are reported so the failure is visible rather than assumed away.
 */
export function releaseAllTempArtifacts() {
  const summary = { released: 0, failed: 0, byLabel: {}, failures: [] };
  for (const [targetPath, meta] of [...tracked.entries()]) {
    try {
      if (meta.kind === "dir") {
        fs.rmSync(targetPath, { recursive: true, force: true });
      } else {
        fs.rmSync(targetPath, { force: true });
      }
      tracked.delete(targetPath);
      summary.released += 1;
      summary.byLabel[meta.label] = (summary.byLabel[meta.label] || 0) + 1;
    } catch (error) {
      summary.failed += 1;
      summary.failures.push({ path: targetPath, label: meta.label, code: error?.code });
    }
  }
  return summary;
}

/** Test-support: drop all tracking without touching the filesystem. */
export function resetTempArtifactTracking() {
  tracked.clear();
}
