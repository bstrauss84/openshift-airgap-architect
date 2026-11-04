/**
 * OpenShift Airgap Architect - operator package lookup (v2.2.0 M5)
 *
 * Live catalog facts for one package, from the same oc-mirror v2 discovery
 * engine the catalog scan uses:
 *
 *   oc-mirror --v2 list operators --catalog=<image> --package=<name>
 *     → the package row (NAME / DISPLAY NAME / DEFAULT CHANNEL), a blank line,
 *       then PACKAGE / CHANNEL / HEAD rows, channels sorted by name
 *   oc-mirror --v2 list operators --catalog=<image> --package=<name> --channel=<c>
 *     → VERSIONS, then one bundle version per line
 *
 * Contract verified on the exact binary (4.22.19, sha256 55b55cf1…) against a
 * synthetic File-Based Catalog in a disposable registry, 2026-10-27
 * (fixtures: test/fixtures/operator-package-lookup/list-operators-fixtures.json):
 * tables go to stdout with no colour codes and variable column widths; every
 * log line goes to stderr; a missing package or channel exits 1 with
 * `operator "<p>" not found in catalog` / `channel "<c>" not found for operator
 * "<p>"`. An unreachable registry exits 1 after its retries (33 s with the
 * default 5, ~1 s with --retry-times=1); a registry that accepts the
 * connection and never answers hung until killed, so every call here has its
 * own deadline.
 *
 * Results are facts about one catalog IMAGE REFERENCE at one time. A failed
 * lookup is reported as unverified, never as passed and never as "missing".
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { spawn } from "node:child_process";
import { loopbackCatalogArgs, loopbackListEnv } from "./verifiedCatalog.js";
import { db } from "./db.js";
import { activeProcesses } from "./processRegistry.js";

const LOOKUP_TIMEOUT_MS = 90 * 1000;
const lookupTimeoutMs = () => {
  const raw = Number(process.env.OPERATOR_LOOKUP_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : LOOKUP_TIMEOUT_MS;
};

/** Rows of a whitespace-aligned table; columns are separated by two or more spaces. */
const tableRows = (block) => block.split("\n").map((l) => l.trimEnd()).filter(Boolean).map((l) => l.split(/\s{2,}/));

/**
 * Parse `--package` output. Returns null when stdout is not the expected shape
 * (never a guessed partial answer).
 * @returns {{ name: string, displayName: string, defaultChannel: string, channels: { name: string, head: string }[] } | null}
 */
export function parsePackageListing(stdout) {
  const blocks = String(stdout || "").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length < 2) return null;
  const pkgRows = tableRows(blocks[0]);
  const chRows = tableRows(blocks[1]);
  if (pkgRows[0]?.[0] !== "NAME" || chRows[0]?.[0] !== "PACKAGE" || chRows[0]?.[1] !== "CHANNEL") return null;
  const header = pkgRows[0];
  const row = pkgRows[1];
  if (!row) return null;
  const at = (label) => {
    const i = header.indexOf(label);
    return i >= 0 ? (row[i] || "") : "";
  };
  // DISPLAY NAME may be empty, which collapses its column; the default
  // channel is always the last cell.
  const defaultChannel = row.length === header.length ? at("DEFAULT CHANNEL") : row[row.length - 1];
  const displayName = row.length === header.length ? at("DISPLAY NAME") : "";
  return {
    name: row[0],
    displayName,
    defaultChannel,
    channels: chRows.slice(1).filter((r) => r[0] === row[0] && r[1]).map((r) => ({ name: r[1], head: r[2] || "" }))
  };
}

/** Parse `--channel` output: VERSIONS then one version per line, or null. */
export function parseChannelVersions(stdout) {
  const lines = String(stdout || "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines[0] !== "VERSIONS") return null;
  return lines.slice(1);
}

const stripAnsi = (text) => String(text || "").replace(/\x1b\[[0-9;]*m/g, "");

/**
 * What a failed `list operators` call means.
 * kind: "package-not-found" | "channel-not-found" | "unreachable" | "credentials" | "credentials-missing" | "timeout" | "error"
 * The two not-found kinds are definitive catalog facts; everything else means
 * "could not check".
 */
/** What a failed verified catalog fetch (verifiedRegistry.js RegistryError) means for a lookup. */
export function classifyFetchFailure(err) {
  const kind = {
    TLS_UNTRUSTED: "untrusted",
    AUTH_REQUIRED: "credentials-missing",
    AUTH_DENIED: "credentials",
    PROXY_AUTH: "unreachable",
    UNREACHABLE: "unreachable",
    TRANSIENT: "unreachable",
    INTEGRITY: "integrity"
  }[err?.code] || "error";
  return { kind, message: String(err?.message || err) };
}

export function classifyLookupFailure({ stderr, exitCode, timedOut }) {
  if (timedOut) return { kind: "timeout", message: "The catalog did not answer before the lookup's time limit." };
  const text = stripAnsi(stderr);
  const lastError = (text.match(/\[ERROR\][^\n]*/g) || []).pop() || "";
  const detail = lastError.replace(/^\[ERROR\]\s*:\s*/, "").replace(/^\[Executor\]\s*/, "").trim();
  if (/operator "[^"]*" not found in catalog/.test(text)) return { kind: "package-not-found", message: detail };
  if (/channel "[^"]*" not found for operator/.test(text)) return { kind: "channel-not-found", message: detail };
  // Credential failures were not captured from the binary (no real registry
  // was used); these are the containers/image phrasings, matched by pattern.
  if (/unauthorized|authentication required|denied|invalid username\/password/i.test(text)) {
    return { kind: "credentials", message: detail || "The registry refused the credentials." };
  }
  if (/no such host|connection refused|i\/o timeout|network is unreachable|pinging container registry|TLS handshake timeout/i.test(text)) {
    return { kind: "unreachable", message: detail || "The catalog registry could not be reached." };
  }
  return { kind: "error", message: detail || `oc-mirror exited with code ${exitCode}.` };
}

// ---------------------------------------------------------------------------
// Bundle version ordering (Masterminds semver, which oc-mirror uses): optional
// "v", 1–3 numeric parts (missing parts are 0), pre-release lower than the
// release, pre-release identifiers compared per SemVer 2.0, build ignored.
// These are operator bundle versions, not OpenShift release versions
// (shared/versionUtils.js), which is why they have their own comparator.
// ---------------------------------------------------------------------------
const BUNDLE_VERSION_RE = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export const parseBundleVersion = (v) => {
  const m = BUNDLE_VERSION_RE.exec(String(v || "").trim());
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)], pre: m[4] ? m[4].split(".") : [] };
};

export const compareBundleVersions = (a, b) => {
  const x = parseBundleVersion(a);
  const y = parseBundleVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] < y.nums[i] ? -1 : 1;
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : (x.pre.length ? -1 : 1);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) { if (Number(p) !== Number(q)) return Number(p) < Number(q) ? -1 : 1; continue; }
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
};

/** The listed versions that fall within [min, max] (either bound optional). */
export const versionsInRange = (versions, min, max) => versions.filter((v) => {
  if (min && (compareBundleVersions(v, min) ?? -1) < 0) return false;
  if (max && (compareBundleVersions(v, max) ?? 1) > 0) return false;
  return true;
});

// ---------------------------------------------------------------------------
// Running oc-mirror and caching
// ---------------------------------------------------------------------------

/**
 * One `list operators` call with its own deadline (SIGTERM, then SIGKILL).
 * Registered in activeProcesses under `jobId` so Stop on the owning job ends it.
 */
export function runListOperators({ bin, localReference, emptyAuthFile = null, pkg, channel, jobId, timeoutMs = lookupTimeoutMs() }) {
  // `localReference` is the digest-pinned loopback copy of a catalog OAA has
  // already fetched over verified TLS (verifiedCatalog.js); no auth file is
  // ever given to this oc-mirror path.
  const args = ["--v2", "list", "operators", ...loopbackCatalogArgs(localReference, emptyAuthFile), `--package=${pkg}`, "--retry-times=2"];
  if (channel) args.push(`--channel=${channel}`);
  const env = loopbackListEnv(process.env);
  return new Promise((resolve) => {
    const child = spawn(bin, args, { env });
    if (jobId) activeProcesses.set(jobId, child);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killTimer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
    }, timeoutMs);
    child.stdout.on("data", (d) => { if (stdout.length < 1_000_000) stdout += d.toString(); });
    child.stderr.on("data", (d) => { if (stderr.length < 200_000) stderr += d.toString(); });
    const done = (exitCode, signal) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (jobId && activeProcesses.get(jobId) === child) activeProcesses.delete(jobId);
      resolve({ exitCode, signal, stdout, stderr, timedOut });
    };
    child.on("error", (err) => { stderr += `\n${String(err)}`; done(-1, null); });
    child.on("close", (code, signal) => done(code, signal));
  });
}

export const storePackageDetails = (catalogImage, pkg, details) => {
  db.prepare(
    "INSERT INTO operator_package_details (catalog_image, package, details_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(catalog_image, package) DO UPDATE SET details_json = excluded.details_json, updated_at = excluded.updated_at"
  ).run(catalogImage, pkg, JSON.stringify(details), Date.now());
};

export const getPackageDetails = (catalogImage, pkg) => {
  const row = db.prepare("SELECT details_json, updated_at FROM operator_package_details WHERE catalog_image = ? AND package = ?").get(catalogImage, pkg);
  if (!row) return null;
  try {
    return { ...JSON.parse(row.details_json), updatedAt: row.updated_at };
  } catch {
    return null;
  }
};

/**
 * Verdict for one selected operator from live facts.
 * status: "verified" | "package-not-found" | "channel-not-found" | "range-empty" | "unverified"
 * Only the not-found statuses are definitive problems; "range-empty" states
 * what the catalog lists and lets the user judge.
 */
export function judgeOperator(op, facts) {
  const channel = op.defaultChannel;
  if (facts.failure) {
    const { kind, message } = facts.failure;
    if (kind === "package-not-found") return { status: "package-not-found", message: `${op.name} is not in ${op.catalogImage}.`, detail: message };
    if (kind === "channel-not-found") return { status: "channel-not-found", message: `${op.name} has no channel ${channel} in ${op.catalogImage}.`, detail: message };
    const why = {
      unreachable: "the catalog could not be reached (offline or blocked?)",
      credentials: "the registry refused the credentials",
      "credentials-missing": "the registry needs credentials and none were given for it (enter the Red Hat pull secret, then check again)",
      untrusted: "the catalog registry's certificate could not be verified, so nothing was sent to it",
      integrity: "the catalog content did not match its digest",
      timeout: "the catalog did not answer in time",
      error: "oc-mirror could not list it"
    }[kind] || "the lookup failed";
    return { status: "unverified", message: `${op.name} was not checked: ${why}.`, detail: message };
  }
  const listing = facts.listing;
  if (!listing.channels.some((c) => c.name === channel)) {
    return { status: "channel-not-found", message: `${op.name} has no channel ${channel} in ${op.catalogImage}. Channels listed: ${listing.channels.map((c) => c.name).join(", ") || "none"}.` };
  }
  if ((op.minVersion || op.maxVersion) && facts.versions) {
    const hits = versionsInRange(facts.versions, op.minVersion, op.maxVersion);
    if (!hits.length) {
      return {
        status: "range-empty",
        message: `None of the versions the catalog lists for ${op.name} channel ${channel} (${facts.versions.join(", ") || "none"}) is within ${op.minVersion || "any"}–${op.maxVersion || "any"}.`
      };
    }
    return { status: "verified", message: `${op.name}: channel ${channel} exists; ${hits.length} of ${facts.versions.length} listed version(s) within the range.`, versionsInRange: hits.length };
  }
  return { status: "verified", message: `${op.name}: channel ${channel} exists in ${op.catalogImage}.` };
}
