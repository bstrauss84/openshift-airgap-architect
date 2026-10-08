/**
 * History-scan baseline reconciliation + current-tree credential-artifact guard.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A SCANNER ALLOWLIST
 * -----------------------------------------------------
 * A finding in reachable Git history cannot always be removed: once a repository has
 * been public, forks and clones hold independent copies, so rewriting refs sanitizes
 * future archive generation without recalling anything. The naive way to stop a gate
 * going red for such a finding is a scanner allowlist — but that SUPPRESSES DETECTION.
 * The finding vanishes, and with it any ability to notice that the historical content
 * changed, that something new appeared beside it, or that a fresh finding was added.
 *
 * So the scanner is left alone. It keeps detecting everything, and this module
 * mechanically accounts for EVERY finding it reports against an explicit baseline.
 * Accounting is by cryptographic identity, not by name: the baseline stores only
 * SHA-256 digests, so it carries no path, commit, detector string or other descriptive
 * metadata about what it covers. A finding is non-blocking only when its derived
 * identity hash, its occurrence count, and the SHA-256 of the historical content it
 * points at all match a registered entry whose status is `verified-inactive`.
 *
 * Anything unregistered, changed, added or miscounted is RED. Opaque is not weak: the
 * comparison is exact-match, and the baseline cannot be widened by editing a string
 * because every value in it is a digest of something that must be independently
 * re-derived at scan time.
 *
 * Never handles or prints secret material: findings arrive redacted, and the baseline
 * holds digests only.
 */
import { createHash } from "node:crypto";

/** Namespace prefix, so a digest here cannot collide with one computed elsewhere. */
const NS = "oaa-history-baseline/v1";

const sha256 = (value) => "sha256:" + createHash("sha256").update(value).digest("hex");

/** Status under which a registered entry stops blocking. */
export const RESOLVED_STATUS = "verified-inactive";

/** Every status the baseline may declare. Default is the blocking one. */
export const ALLOWED_STATUSES = new Set(["unverified", RESOLVED_STATUS]);

/**
 * Evidence classes that may accompany a resolved entry. The class is a label for how
 * the finding was established as no longer live; the digest commits to the detailed
 * record, which is retained outside this repository.
 */
export const ALLOWED_EVIDENCE_CLASSES = new Set([
  "human-attested-lifecycle-invalidation",
  "machine-verified-signing-key-absence",
  "administratively-revoked",
]);

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

export const SCAN_PASS = "PASS";
export const SCAN_RESOLVED = "PASS_WITH_RESOLVED_BASELINE";
export const SCAN_RED = "RED";

/**
 * Derive the opaque identity of a single scanner finding. Deterministic, and derivable
 * only from the redacted finding itself — the baseline never stores the inputs.
 */
export function findingIdentity(finding) {
  return sha256(`${NS}|${finding.RuleID}|${finding.File}|${finding.Fingerprint}`);
}

/** Derive the opaque identity of a repository-relative path. */
export function pathIdentity(path) {
  return sha256(`${NS}|path|${path}`);
}

/** Content identity of a historical object. */
export function contentIdentity(bytes) {
  return sha256(bytes);
}

/**
 * Reconcile scanner history findings against the baseline.
 *
 * @param {object}   args
 * @param {Array}    args.findings        Redacted findings (RuleID, File, StartLine, Commit, Fingerprint).
 * @param {object}   args.baseline        Parsed baseline document.
 * @param {Function} [args.resolveContent] (commit, path) => Buffer|string|null. Absent =
 *                                         content cannot be confirmed, which is RED.
 */
export function reconcileHistoryScan({ findings, baseline, resolveContent }) {
  const reasons = [];
  const list = findings ?? [];

  if (!baseline || baseline.schemaVersion !== 1) {
    return {
      status: SCAN_RED,
      reasons: [`baseline schemaVersion must be 1, got ${baseline?.schemaVersion ?? "<missing>"}`],
      unexpected: 0,
      resolvedEntries: [],
      totalFindings: list.length,
    };
  }

  const entries = baseline.entries ?? [];

  // identityHash -> { entry, expected }
  const index = new Map();
  for (const entry of entries) {
    if (!DIGEST_RE.test(entry.contentIdentityHash ?? "")) {
      reasons.push(`entry ${entry.id}: contentIdentityHash is not a sha256 digest`);
    }
    if (!ALLOWED_STATUSES.has(entry.status)) {
      reasons.push(`entry ${entry.id}: unknown status "${entry.status}"`);
    }
    for (const expected of entry.findingIdentities ?? []) {
      if (!DIGEST_RE.test(expected.identityHash ?? "")) {
        reasons.push(`entry ${entry.id}: identityHash is not a sha256 digest`);
        continue;
      }
      if (index.has(expected.identityHash)) {
        reasons.push(`entry ${entry.id}: identity registered more than once`);
      }
      index.set(expected.identityHash, { entry, expected });
    }
  }

  // Observed identities and their counts.
  const observed = new Map();
  let unexpected = 0;
  const contentChecked = new Set();

  for (const finding of list) {
    const id = findingIdentity(finding);
    observed.set(id, (observed.get(id) ?? 0) + 1);
    if (!index.has(id)) {
      unexpected += 1;
      continue;
    }
    const { entry } = index.get(id);

    // The registered identity is only half of it. Independently resolve what the
    // finding actually points at and compare its content digest, so a changed
    // historical object can never ride in on a matching identity.
    const key = `${id}`;
    if (contentChecked.has(key)) continue;
    contentChecked.add(key);

    if (typeof resolveContent !== "function") {
      reasons.push(`entry ${entry.id}: content verification unavailable`);
      continue;
    }
    const bytes = resolveContent(finding.Commit, finding.File);
    if (bytes === null || bytes === undefined) {
      reasons.push(`entry ${entry.id}: referenced historical content could not be resolved`);
      continue;
    }
    if (contentIdentity(bytes) !== entry.contentIdentityHash) {
      reasons.push(`entry ${entry.id}: historical content identity does not match the baseline`);
    }
  }

  // Count drift, in both directions.
  for (const [id, { entry, expected }] of index) {
    const got = observed.get(id) ?? 0;
    const want = expected.count ?? 1;
    if (got === 0) {
      reasons.push(`entry ${entry.id}: a registered identity was not observed; the baseline is stale`);
    } else if (got !== want) {
      reasons.push(`entry ${entry.id}: occurrence count drift`);
    }
  }

  // Whole-entry occurrence total, independent of the per-identity counts.
  for (const entry of entries) {
    const total = (entry.findingIdentities ?? []).reduce(
      (sum, e) => sum + (observed.get(e.identityHash) ?? 0),
      0
    );
    if (total === 0) continue;
    if (entry.expectedOccurrenceCount !== total) {
      reasons.push(`entry ${entry.id}: expected occurrence total not met`);
    }
  }

  // Status + evidence gate.
  const resolvedEntries = [];
  for (const entry of entries) {
    const seen = (entry.findingIdentities ?? []).some((e) => (observed.get(e.identityHash) ?? 0) > 0);
    if (!seen) continue;

    if (entry.status !== RESOLVED_STATUS) {
      reasons.push(`entry ${entry.id}: status is "${entry.status}", so its findings remain blocking`);
      continue;
    }
    // A resolved status asserts the finding is no longer live. That assertion must be
    // anchored to a committed evidence digest, so it cannot be granted by editing one
    // word in this file.
    if (!ALLOWED_EVIDENCE_CLASSES.has(entry.evidenceClass)) {
      reasons.push(`entry ${entry.id}: unknown or missing evidenceClass`);
      continue;
    }
    if (!DIGEST_RE.test(entry.evidenceDigest ?? "")) {
      reasons.push(`entry ${entry.id}: evidenceDigest is not a sha256 digest`);
      continue;
    }
    resolvedEntries.push(entry.id);
  }

  let status;
  if (unexpected > 0 || reasons.length > 0) status = SCAN_RED;
  else if (resolvedEntries.length > 0) status = SCAN_RESOLVED;
  else status = SCAN_PASS;

  return { status, reasons, unexpected, resolvedEntries, totalFindings: list.length };
}

/* ------------------------------------------------------------------------- *
 * Current-tree credential-artifact guard
 * ------------------------------------------------------------------------- */

/** Three-segment base64url whose header really is a JWT header with an `alg`. */
function containsRealJwt(text) {
  const re = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g;
  for (const match of text.matchAll(re)) {
    const [head] = match[0].split(".");
    try {
      const json = JSON.parse(Buffer.from(head, "base64url").toString("utf8"));
      if (json && typeof json === "object" && typeof json.alg === "string") return true;
    } catch {
      /* not a JWT header; keep looking */
    }
  }
  return false;
}

/**
 * A base64 `data:` value that decodes to a kubeconfig carrying REAL credential
 * material. Requiring decodable material is what keeps legitimate manifest templates
 * (`token: <your-token>`, `${PULL_SECRET}`) from tripping the guard — ordinary
 * credential-free `kind: Secret` templates are deliberately NOT banned.
 */
function containsEmbeddedCredentialKubeconfig(text) {
  for (const match of text.matchAll(/^\s*[\w.\-]+:\s*([A-Za-z0-9+/=]{200,})\s*$/gm)) {
    let decoded;
    try {
      decoded = Buffer.from(match[1], "base64").toString("utf8");
    } catch {
      continue;
    }
    if (!/\bclusters:/.test(decoded) || !/\busers:/.test(decoded)) continue;
    if (containsRealJwt(decoded)) return true;
    if (/client-key-data:\s*[A-Za-z0-9+/=]{100,}/.test(decoded)) return true;
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(decoded)) return true;
  }
  return false;
}

/** Shapes that indicate a cluster-import manifest rather than ordinary config. */
const IMPORT_MANIFEST_MARKERS = [
  /kind:\s*Klusterlet\b/,
  /open-cluster-management-agent\b/,
  /bootstrap-hub-kubeconfig\b/,
];

/**
 * Classify one tracked file.
 *
 * Content-based by design: a file is a finding only when it actually carries decodable
 * credential material. An optional opaque path check provides defence in depth without
 * naming anything.
 *
 * @returns {{detected: boolean, reasons: string[]}}
 */
export function classifyTrackedFile(path, text, baseline) {
  const reasons = [];
  const blockedPaths = new Set(baseline?.disallowedPathHashes ?? []);
  if (blockedPaths.size > 0 && blockedPaths.has(pathIdentity(path))) {
    reasons.push("path matches a baseline-registered disallowed path");
  }
  const importManifest = IMPORT_MANIFEST_MARKERS.some((re) => re.test(text));
  const kubeconfigCredential = containsEmbeddedCredentialKubeconfig(text);
  if (importManifest && (kubeconfigCredential || containsRealJwt(text))) {
    reasons.push("cluster-import manifest containing decodable credential material");
  } else if (kubeconfigCredential) {
    reasons.push("embedded base64 kubeconfig containing a real bearer token or private key");
  }
  return { detected: reasons.length > 0, reasons };
}

/**
 * Guard the current tree.
 *
 * @param {object}   args
 * @param {string[]} args.files      Tracked (and relevant untracked) repo-relative paths.
 * @param {Function} args.readText   (path) => string|null.
 * @param {object}   [args.baseline] Supplies opaque disallowed-path digests.
 */
export function scanTreeForCredentialArtifacts({ files, readText, baseline }) {
  const findings = [];
  for (const path of files) {
    let text;
    try {
      text = readText(path);
    } catch {
      continue;
    }
    if (typeof text !== "string" || text.length === 0) continue;
    if (text.includes("\u0000")) continue; // binary
    const { detected, reasons } = classifyTrackedFile(path, text, baseline);
    if (detected) findings.push({ path, reasons });
  }
  return { ok: findings.length === 0, findings };
}
