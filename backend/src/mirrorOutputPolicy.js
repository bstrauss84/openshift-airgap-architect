/**
 * OpenShift Airgap Architect - mirror-output export boundary
 *
 * `mirrorWorkflow.archivePath` / `.outputPath` arrive in the body of an
 * unauthenticated POST /api/bundle.zip, and whatever directory they name is
 * streamed into the ZIP that comes back. That makes this the authority
 * deciding which bytes on the server an anonymous caller may read, so it has
 * to be a FILESYSTEM boundary, not a string comparison.
 *
 * The first attempt at this guard was lexical: path.resolve plus a prefix
 * test, plus a blacklist of four exact credential filenames. It was bypassed
 * three ways, each reproduced against the real endpoint:
 *
 *   1. a symlink sitting lexically inside an allowed root but pointing out —
 *      path.resolve does not resolve symlinks, so the check passed and
 *      archiver followed the link;
 *   2. a symlinked PARENT, same cause;
 *   3. a credential inside an otherwise eligible directory under any name the
 *      four-entry blacklist did not happen to list.
 *
 * So the rules here are:
 *   - every path is canonicalised with realpath before it is compared;
 *   - the target must be a STRICT descendant of a canonicalised allowed root,
 *     never a root itself (the data directory holds mounted credentials and
 *     temporary auth files, and /tmp holds everything);
 *   - the whole tree is walked, and ANY symlink is fatal — not followed, not
 *     skipped. Skipping would ship a quietly incomplete archive, and
 *     following is the bug;
 *   - any file whose name looks like credential material is fatal.
 *
 * Rejection is deterministic and total: an unsafe path fails the request
 * before any response headers commit, rather than producing a "successful"
 * ZIP with a silent omission. A false rejection is recoverable and tells the
 * operator exactly which entry caused it; a false acceptance is a disclosure.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import fs from "node:fs";
import path from "node:path";

/** Carries a stable code so the HTTP layer can map it to a 400. */
export class MirrorOutputPolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MirrorOutputPolicyError";
    this.code = code;
  }
}

/**
 * Names that must never be archived.
 *
 * Patterns, not an exact-name list: the previous exact list was the defect.
 * Deliberately broader than "things oc-mirror writes" — refusing a harmless
 * file named `token.json` costs an operator one clear error message, while
 * accepting one real `auth.json` is a credential disclosure.
 */
const SENSITIVE_BASENAME_PATTERNS = [
  /^\.?docker(config)?\.json$/i,
  /^\.dockerconfigjson$/i,
  /^config\.json$/i,
  /auth/i,
  /pull[-_]?secret/i,
  /credential/i,
  /secret/i,
  /token/i,
  /^\.netrc$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)/i,
  /\.(key|pem|p12|pfx|jks|keystore)$/i,
  /^\.ssh$/i,
  /^\.git-credentials$/i
];

/** Upper bound on tree size, so validation cannot itself become a DoS. */
const MAX_SCANNED_ENTRIES = 50_000;

export function isSensitiveBasename(name) {
  return SENSITIVE_BASENAME_PATTERNS.some((re) => re.test(name));
}

/** Canonicalise, dropping roots that do not exist on this host. */
function canonicalRoots(allowedRoots) {
  const out = [];
  for (const root of allowedRoots) {
    try {
      out.push(fs.realpathSync(path.resolve(root)));
    } catch {
      /* a configured root that is absent simply grants nothing */
    }
  }
  return out;
}

function isStrictDescendant(candidate, root) {
  if (candidate === root) return false; // the root itself is never exportable
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return candidate.startsWith(prefix);
}

/**
 * Walk the tree, refusing symlinks and credential-shaped names.
 *
 * Uses lstat semantics via withFileTypes so a symlink is detected as a
 * symlink rather than silently resolved to whatever it targets.
 */
function assertTreeIsSafe(dir, rootForMessages, counter) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (++counter.n > MAX_SCANNED_ENTRIES) {
      throw new MirrorOutputPolicyError(
        "MIRROR_OUTPUT_TOO_LARGE",
        `Mirror output directory has more than ${MAX_SCANNED_ENTRIES} entries and cannot be verified for export.`
      );
    }
    const full = path.join(dir, entry.name);
    const relative = path.relative(rootForMessages, full) || entry.name;

    if (entry.isSymbolicLink()) {
      throw new MirrorOutputPolicyError(
        "MIRROR_OUTPUT_SYMLINK",
        `Mirror output cannot be exported: "${relative}" is a symbolic link. Links are refused because the export cannot prove where they lead.`
      );
    }
    if (isSensitiveBasename(entry.name)) {
      throw new MirrorOutputPolicyError(
        "MIRROR_OUTPUT_SENSITIVE_FILE",
        `Mirror output cannot be exported: "${relative}" looks like credential material. Move it outside the mirror output directory and retry.`
      );
    }
    if (entry.isDirectory()) {
      assertTreeIsSafe(full, rootForMessages, counter);
    } else if (!entry.isFile()) {
      throw new MirrorOutputPolicyError(
        "MIRROR_OUTPUT_UNSUPPORTED_ENTRY",
        `Mirror output cannot be exported: "${relative}" is neither a regular file nor a directory.`
      );
    }
  }
}

/**
 * Validate a caller-supplied mirror-output directory and return its real path.
 *
 * @param {string} rawPath caller-supplied, untrusted
 * @param {string[]} allowedRoots e.g. [DATA_DIR, "/tmp"]
 * @returns {string} canonical directory safe to archive
 * @throws {MirrorOutputPolicyError} on any violation — never returns a
 *   partially-trusted result for the caller to decide about
 */
export function assertExportableMirrorOutput(rawPath, allowedRoots) {
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    throw new MirrorOutputPolicyError(
      "MIRROR_OUTPUT_INVALID_PATH",
      "Mirror output path is empty."
    );
  }

  const roots = canonicalRoots(allowedRoots);
  if (roots.length === 0) {
    throw new MirrorOutputPolicyError(
      "MIRROR_OUTPUT_NO_ROOTS",
      "No exportable directory roots are configured on this server."
    );
  }

  let real;
  try {
    real = fs.realpathSync(path.resolve(rawPath));
  } catch {
    // Deliberately does not echo the resolved path: the request is
    // unauthenticated and this would otherwise be a filesystem oracle.
    throw new MirrorOutputPolicyError(
      "MIRROR_OUTPUT_NOT_FOUND",
      "The mirror output directory does not exist or is not readable."
    );
  }

  if (!fs.statSync(real).isDirectory()) {
    throw new MirrorOutputPolicyError(
      "MIRROR_OUTPUT_NOT_A_DIRECTORY",
      "The mirror output path is not a directory."
    );
  }

  if (!roots.some((root) => isStrictDescendant(real, root))) {
    throw new MirrorOutputPolicyError(
      "MIRROR_OUTPUT_OUTSIDE_ROOT",
      "The mirror output directory is outside the directories this server may export. Use a subdirectory of the application data directory."
    );
  }

  assertTreeIsSafe(real, real, { n: 0 });
  return real;
}
