/**
 * OpenShift Airgap Architect - what an unfinished Mirroring run needs (v2.2.0)
 *
 * Classifies a finished oc-mirror run from what it recorded — exit status,
 * oc-mirror's own error list, the output — into the recovery classes of the
 * recovery research (recovery-policy.json) and says whether "Run the same
 * again" is safe. Evidence from the shipped oc-mirror (EXPERIMENT_REPORT.md):
 * rerunning the identical configuration fetches only what is missing and
 * produces a complete result (E2, E4, E6); 404, 401 and certificate failures
 * are never retried by oc-mirror and need a person first (E3).
 *
 * Nothing here runs anything; there is no automatic retry.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */

const TRANSIENT = /\b(50[234]|429)\b|too many requests|service unavailable|bad gateway|gateway time-?out|connection reset|unexpected EOF|\bEOF\b|i\/o timeout|deadline exceeded|context canceled|TLS handshake timeout|connection refused|no route to host|temporary failure in name resolution|server misbehaving/i;
const AUTH = /unauthorized|authentication required|\b401\b|\b403\b|access to the requested resource is not authorized|denied: |invalid username\/password/i;
const TRUST = /x509:|certificate signed by unknown authority|certificate verify failed|tls: failed to verify/i;
const MISSING = /manifest unknown|\b404\b|not found: manifest|reading manifest .* not found/i;
const STORAGE = /no space left on device|ENOSPC|disk quota exceeded|read-only file system|permission denied/i;
const SIGNATURE = /error: reading signatures.*name unknown: Image not found/i;

/**
 * @param {{ status: string, exitCode: number|null, dryRun?: boolean, mode: string }} run
 * @param {string[]} errorLines oc-mirror's error list for the run (may be empty)
 * @param {string} output the stored output (tail)
 * @returns {{ classification: string, eligible: boolean, requires: string[], text: string }}
 */
export function classifyRecovery(run, errorLines = [], output = "") {
  if (run.dryRun) return { classification: "NONE", eligible: false, requires: [], text: "A dry run copies nothing; run the real workflow." };
  if (run.status === "queued" || run.status === "running") return { classification: "NONE", eligible: false, requires: [], text: "Still running." };
  if (run.status === "completed" && run.exitCode === 0) return { classification: "NONE", eligible: false, requires: [], text: "Completed; nothing to recover." };
  const stopped = run.status === "cancelled" || run.exitCode === null || [130, 137, 143].includes(run.exitCode);
  if (stopped) {
    return { classification: "RESUME_PRESERVED_STATE", eligible: true, requires: run.mode === "mirrorToDisk" ? ["source credentials"] : ["credentials"],
      text: "The run stopped before it finished, so nothing was archived or recorded as done. Running the same again continues from what is already in the cache and at the destination." };
  }
  const text = `${errorLines.join("\n")}\n${String(output || "").slice(-200000)}`;
  const lines = errorLines.length ? errorLines : text.split("\n").filter((l) => /error/i.test(l));
  const has = (re) => lines.some((l) => re.test(l));
  if (run.mode === "diskToMirror" && /archive|mirror_\d+\.tar|unable to extract|blob unknown/i.test(text) && has(/archive|blob unknown|extract/i)) {
    return { classification: "REQUIRE_NEW_LOW_SIDE_TRANSFER", eligible: false, requires: ["a new or re-copied transfer"],
      text: "The transfer on this side is missing content oc-mirror needs. Copy it again, or have the connected side prepare a new one." };
  }
  if (has(SIGNATURE) && !lines.some((l) => !SIGNATURE.test(l) && /error/i.test(l))) {
    return { classification: "REQUIRE_OWNER_ACTION", eligible: false, requires: ["a decision about signatures"],
      text: "Only signature lookups failed. The automatic signature retry handles this for mirror to disk and mirror to mirror; otherwise decide whether these images may be mirrored without their signatures." };
  }
  if (has(MISSING) && !has(TRANSIENT)) {
    return { classification: "REQUIRE_OWNER_ACTION", eligible: false, requires: ["source content"],
      text: "An image or layer no longer exists at the source (not found). Running the same again cannot fix that: remove or replace the image in the profile, then run again." };
  }
  if (has(TRUST)) {
    return { classification: "REPAIR_AUTH_OR_TRUST", eligible: true, requires: ["certificate trust"],
      text: "A registry's certificate could not be verified. Add its CA to the server's trust (see Destination registry help), then run the same again." };
  }
  if (has(AUTH)) {
    return { classification: "REPAIR_AUTH_OR_TRUST", eligible: true, requires: ["credentials"],
      text: "A registry refused the credentials. Enter valid credentials for this attempt, then run the same again." };
  }
  if (has(STORAGE)) {
    return { classification: "RETRY_SAME", eligible: true, requires: ["free space or permissions"],
      text: "The server ran out of space or could not write. Fix that first; then running the same again reuses everything already in the cache." };
  }
  if (has(TRANSIENT)) {
    return { classification: "RETRY_SAME", eligible: true, requires: ["credentials"],
      text: "Some images failed with temporary network or registry errors. Running the same again fetches only what is missing; what already arrived is kept." };
  }
  return { classification: "UNSUPPORTED_OR_UNKNOWN", eligible: false, requires: [],
    text: "Architect cannot tell from the output what went wrong, so it does not offer a retry. Read the output; nothing was changed." };
}
