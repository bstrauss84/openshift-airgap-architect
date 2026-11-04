/**
 * OpenShift Airgap Architect - Mirroring workflow state (v2.2.0 M1)
 *
 * The standalone Mirroring workflow owns `state.mirroring`, a slice that is
 * separate from every Install slice. It holds independently keyed profiles;
 * each profile owns its own content selection, platform release, operator
 * catalog minor, additional images and execution identity.
 *
 * Ownership rules this module enforces:
 *
 * - The slice is SERVER-OWNED. POST /api/state ignores it, Install import does
 *   not overwrite it and Install Start Over preserves it. Only the
 *   /api/mirroring routes write it, and every write goes through
 *   normalizeMirroringSlice so the stored shape is always whitelisted.
 * - Filesystem locations are DERIVED from the profile id, never accepted from a
 *   client: `<DATA_DIR>/oc-mirror/profiles/<id>/{archives,workspace,cache}`.
 *   Each profile therefore has its own destination, working-dir and cache
 *   (oc-mirror deletes every mirror_*.tar in a destination on mirrorToDisk and
 *   keys incremental history per working-dir, so sharing any of them between
 *   two configurations corrupts the other's output).
 * - Version rules (owner decision 4, 2026-10-23, revised at M3 acceptance
 *   2026-10-26): with platform AND operators content the operator catalog
 *   minor is DERIVED from the platform release minor (`deriveCatalogMinor`);
 *   it is never chosen separately. Operators without platform need an explicit
 *   catalog minor; nothing is invented. Each minor, when present, must be
 *   supported (422 UNSUPPORTED_VERSION otherwise). A profile saved before the
 *   revision, or imported, may carry a catalog minor that differs from its
 *   platform minor: that is preserved, never silently rewritten, and blocks
 *   generation until the user reconciles it (align, or split into another
 *   profile). Additional-images-only content needs no OpenShift version.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */

import path from "node:path";
import { nanoid } from "nanoid";
import { getMinorVersion } from "../../shared/versionUtils.js";
import { ARCHITECTURES } from "../../shared/archSupport.js";
import { getOpenShiftMinorFromSources } from "./openShiftMinor.js";
import { isSupportedMinor, buildUnsupportedVersionError } from "./versionPolicy.js";
import { isWithinCliLimit } from "../../shared/ocMirrorCliLimits.js";

export const MIRRORING_SLICE_SCHEMA = 1;
export const MIRRORING_MODES = Object.freeze(["mirrorToDisk", "diskToMirror", "mirrorToMirror"]);
export const MAX_PROFILES = 50;
const MAX_NAME_LENGTH = 80;
const MAX_ADDITIONAL_IMAGES = 500;
const MAX_IMAGE_REF_LENGTH = 512;
const MAX_SELECTED_OPERATORS = 500;
const MAX_HISTORY = 50;

// Profile ids become path segments, so the format is closed: no separators,
// no dots, nothing a filesystem could reinterpret.
const PROFILE_ID_RE = /^p-[A-Za-z0-9_-]{8,32}$/;
// Container image references: registry/repo[:tag][@digest]. Deliberately
// conservative; it rejects whitespace, quotes and shell metacharacters.
const IMAGE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/:@]*$/;

export const isValidProfileId = (id) => typeof id === "string" && PROFILE_ID_RE.test(id);

export const newProfileId = () => `p-${nanoid(12)}`;

export const emptyMirroringSlice = () => ({
  _schema: MIRRORING_SLICE_SCHEMA,
  activeProfileId: null,
  profiles: {}
});

/**
 * Exact minor ("4.22") or null. Uses the shared parser and accepts only a
 * value that IS a minor: "4.22.3" or "stable-4.22" are not catalog minors.
 */
export const parseExactMinor = (value) => {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const minor = getMinorVersion(value.trim());
    return minor === value.trim() ? minor : null;
  } catch {
    return null;
  }
};

const str = (value, max = 256) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const bool = (value) => value === true;

const normalizeContent = (raw = {}) => ({
  platform: bool(raw.platform),
  operators: bool(raw.operators),
  additionalImages: bool(raw.additionalImages)
});

const normalizePlatform = (raw = {}) => {
  const release = raw.release && typeof raw.release === "object" ? raw.release : {};
  const version = raw.version && typeof raw.version === "object" ? raw.version : {};
  const arch = str(raw.architecture, 16);
  return {
    release: {
      channel: str(release.channel, 32) || null,
      patchVersion: str(release.patchVersion, 32) || null,
      confirmed: bool(release.confirmed)
    },
    version: {
      _schemaVersion: 3,
      selectedMinor: str(version.selectedMinor, 16) || null,
      selectedPatch: str(version.selectedPatch, 32) || null,
      selectedChannel: str(version.selectedChannel, 48) || null,
      selectedVersion: str(version.selectedVersion, 32) || null,
      confirmedByUser: bool(version.confirmedByUser),
      locked: bool(version.locked),
      ...(Number.isFinite(version.selectionTimestamp) ? { selectionTimestamp: version.selectionTimestamp } : {}),
      ...(Number.isFinite(version.confirmationTimestamp) ? { confirmationTimestamp: version.confirmationTimestamp } : {})
    },
    architecture: arch || null,
    graph: raw.graph !== false,
    kubeVirtContainer: bool(raw.kubeVirtContainer)
  };
};

export const OPERATOR_CATALOG_KEYS = Object.freeze(["redhat", "certified", "community"]);
export const CATALOG_MINOR_SOURCES = Object.freeze(["platform", "user", "import"]);

/**
 * A selected operator. Two shapes are valid (M3):
 *  - RESOLVED: carries the catalog image and default channel scanned for the
 *    profile's catalog minor; only these are generated.
 *  - INTENT: the package the user asked for, kept across a catalog-minor change
 *    until the new minor's catalogs resolve it (operatorMinorReconciliation
 *    semantics). No catalog image, no channel — nothing is fabricated.
 */
const normalizeOperator = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const name = str(raw.name, 253);
  if (!name) return null;
  const catalogImage = str(raw.catalogImage, MAX_IMAGE_REF_LENGTH);
  const catalog = OPERATOR_CATALOG_KEYS.includes(raw.catalog) ? raw.catalog : null;
  const sources = Array.isArray(raw.sources)
    ? raw.sources.filter((s) => typeof s === "string" && s.length <= 64).slice(0, 10)
    : [];
  return {
    id: str(raw.id, 300) || (catalogImage ? `${catalogImage}::${name}` : `intent::${name}`),
    name,
    displayName: str(raw.displayName, 253) || null,
    ...(catalog ? { catalog } : {}),
    catalogImage: catalogImage || null,
    defaultChannel: str(raw.defaultChannel, 253) || null,
    ...(sources.length ? { sources } : {}),
    ...(str(raw.minVersion, 64) ? { minVersion: str(raw.minVersion, 64) } : {}),
    ...(str(raw.maxVersion, 64) ? { maxVersion: str(raw.maxVersion, 64) } : {}),
    // The catalog minor whose scanned catalogs were seen to contain this
    // package (M4). Absent means "not checked against a live catalog yet";
    // a structurally valid entry is not evidence that the package exists.
    ...(parseExactMinor(raw.verifiedMinor) ? { verifiedMinor: raw.verifiedMinor } : {}),
    // Live package/channel/version check (M5). Written only by the server's
    // catalog verification; see operatorVerificationState for staleness.
    ...(normalizeVerification(raw.verification) ? { verification: normalizeVerification(raw.verification) } : {})
  };
};

export const VERIFICATION_STATUSES = Object.freeze(["verified", "package-not-found", "channel-not-found", "range-empty", "unverified"]);

function normalizeVerification(raw) {
  if (!raw || typeof raw !== "object" || !VERIFICATION_STATUSES.includes(raw.status)) return null;
  return {
    status: raw.status,
    message: str(raw.message, 600),
    checkedAt: Number.isFinite(raw.checkedAt) ? raw.checkedAt : 0,
    catalogImage: str(raw.catalogImage, MAX_IMAGE_REF_LENGTH),
    // M7 (DOC-155): the digest the catalog reference resolved to when OAA
    // fetched it over verified TLS for this check.
    ...(/^sha256:[a-f0-9]{64}$/.test(raw.catalogDigest || "") ? { catalogDigest: raw.catalogDigest } : {}),
    channel: str(raw.channel, 253),
    minVersion: str(raw.minVersion, 64),
    maxVersion: str(raw.maxVersion, 64),
    source: raw.source === "cache" ? "cache" : "live"
  };
}

/**
 * Where one operator stands against live catalog data (M5). A verification
 * recorded for a different catalog image, channel or version range is stale
 * and counts as not checked. Returns { status, message, checkedAt, stale }.
 */
export const operatorVerificationState = (op) => {
  const v = op?.verification;
  if (!v) return { status: "unverified", message: `${op.displayName || op.name} has not been checked against a live catalog.`, checkedAt: null, stale: false };
  const stale = v.catalogImage !== (op.catalogImage || "") || v.channel !== (op.defaultChannel || "") ||
    v.minVersion !== (op.minVersion || "") || v.maxVersion !== (op.maxVersion || "");
  if (stale) return { status: "unverified", message: `${op.displayName || op.name} changed after its last catalog check; check again.`, checkedAt: v.checkedAt, stale: true };
  return { status: v.status, message: v.message, checkedAt: v.checkedAt, stale: false, source: v.source, ...(v.catalogDigest ? { catalogDigest: v.catalogDigest } : {}) };
};

const IMAGE_ID_RE = /^img-[A-Za-z0-9_-]{4,40}$/;

/**
 * An additional image row. `id` is a stable row identity; `source` records who
 * owns it ("user" for anything typed by a person; reserved for future
 * operator-managed suggestions, e.g. "operator:<package>"); `userModified`
 * marks a suggestion the user edited, which must never be overwritten or
 * removed by a later automatic change.
 */
const normalizeImage = (raw, index) => {
  const name = typeof raw === "string" ? str(raw, MAX_IMAGE_REF_LENGTH) : str(raw?.name, MAX_IMAGE_REF_LENGTH);
  if (!name) return null;
  const obj = typeof raw === "object" && raw ? raw : {};
  const source = str(obj.source, 64) || "user";
  const id = IMAGE_ID_RE.test(obj.id || "") ? obj.id : `img-legacy${index}`;
  return { id, name, source, ...(obj.userModified === true ? { userModified: true } : {}) };
};

const MAX_IMPORTS = 20;
const MAX_IMPORT_ITEMS = 200;
const IMPORT_ID_RE = /^imp-[a-f0-9]{12}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

/**
 * Provenance of a file imported into this profile (M4). The original bytes
 * live on disk under the profile's own directory (imports/<sha256>.yaml);
 * the state keeps identity, hash and what still needs the user's review.
 * Unresolved items are parts of the file the guided editor cannot represent;
 * each stays "open" (blocks generation) until the user leaves it out.
 */
const normalizeImportRecord = (raw) => {
  if (!raw || typeof raw !== "object" || !IMPORT_ID_RE.test(raw.id || "") || !SHA256_RE.test(raw.sha256 || "")) return null;
  const items = Array.isArray(raw.unresolved) ? raw.unresolved : [];
  const warns = Array.isArray(raw.warnings) ? raw.warnings : [];
  return {
    id: raw.id,
    fileName: str(raw.fileName, 120) || "imported.yaml",
    sha256: raw.sha256,
    bytes: Number.isSafeInteger(raw.bytes) ? raw.bytes : 0,
    importedAt: Number.isFinite(raw.importedAt) ? raw.importedAt : Date.now(),
    mode: ["separate", "merge", "into"].includes(raw.mode) ? raw.mode : "separate",
    unresolved: items.slice(0, MAX_IMPORT_ITEMS).filter((u) => u && typeof u === "object").map((u) => ({
      id: str(u.id, 40),
      path: str(u.path, 200),
      code: str(u.code, 40),
      message: str(u.message, 600),
      status: u.status === "omitted" ? "omitted" : "open"
    })).filter((u) => u.id),
    warnings: warns.slice(0, 50).filter((w) => w && typeof w === "object").map((w) => ({ path: str(w.path, 200), message: str(w.message, 400) }))
  };
};

const normalizeOptions = (raw = {}) => ({
  // archiveSize in GiB: a whole number >= 1, or absent (oc-mirror default).
  ...(Number.isSafeInteger(raw?.archiveSize) && raw.archiveSize >= 1 ? { archiveSize: raw.archiveSize } : {})
});

/** Go duration as oc-mirror's --retry-delay / --image-timeout take it ("10m", "1.5h"). */
export const GO_DURATION_RE = /^\d+(\.\d+)?(ns|us|µs|ms|s|m|h)$/;
/** --since as the binary documents it: "format yyyy-MM-dd" (oc-mirror 4.22.19 --help). */
export const SINCE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const RUN_LOG_LEVELS = Object.freeze(["info", "debug"]);

export const isCalendarDate = (value) => {
  if (!SINCE_DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

/**
 * oc-mirror options a profile keeps for its runs (M5). Only values oc-mirror
 * accepts survive normalisation; the write schema refuses anything else with
 * a message, so this is a second line, not the user-facing check.
 */
const normalizeRunOptions = (raw = {}) => {
  const r = raw && typeof raw === "object" ? raw : {};
  const out = {};
  for (const key of ["parallelImages", "parallelLayers"]) if (isWithinCliLimit(key, r[key])) out[key] = r[key];
  if (Number.isInteger(r.retryTimes) && r.retryTimes >= 0 && r.retryTimes <= 10) out.retryTimes = r.retryTimes;
  for (const key of ["retryDelay", "imageTimeout"]) if (typeof r[key] === "string" && GO_DURATION_RE.test(r[key])) out[key] = r[key];
  if (RUN_LOG_LEVELS.includes(r.logLevel)) out.logLevel = r.logLevel;
  if (typeof r.since === "string" && isCalendarDate(r.since)) out.since = r.since;
  return out;
};

const SHA256_HEX_RE = /^[a-f0-9]{64}$/;
const PLAN_ID_RE = /^plan-\d{8}T\d{6}Z-[A-Za-z0-9_-]{6}$/;
const JOB_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const MAX_TRANSFERS = 20;
const ARCHIVE_FILE_RE = /^mirror_\d{6}\.tar$/;

/** One archive file of a transfer: name, size and SHA-256 only. */
const normalizeArchive = (a) => (a && ARCHIVE_FILE_RE.test(a.file || "") && Number.isSafeInteger(a.bytes) && SHA256_HEX_RE.test(a.sha256 || "")
  ? { file: a.file, bytes: a.bytes, sha256: a.sha256 } : null);

/**
 * Where a received profile came from (M6): the low-side profile and the exact
 * mirror-to-disk run and plan its transfer was made from.
 */
const normalizeOrigin = (raw) => {
  if (!raw || typeof raw !== "object" || !isValidProfileId(raw.profileId) || !PLAN_ID_RE.test(raw.planId || "") || !SHA256_HEX_RE.test(raw.planSha256 || "")) return null;
  return {
    profileId: raw.profileId,
    profileName: str(raw.profileName, MAX_NAME_LENGTH),
    planId: raw.planId,
    planSha256: raw.planSha256,
    jobId: JOB_ID_RE.test(raw.jobId || "") ? raw.jobId : null
  };
};

/** A transfer prepared on the low side for one mirror-to-disk run (M6). */
const normalizePreparedTransfer = (raw) => {
  if (!raw || !JOB_ID_RE.test(raw.jobId || "") || !PLAN_ID_RE.test(raw.planId || "") || !SHA256_HEX_RE.test(raw.manifestSha256 || "")) return null;
  const archives = (Array.isArray(raw.archives) ? raw.archives : []).slice(0, 2000).map(normalizeArchive).filter(Boolean);
  return {
    jobId: raw.jobId, planId: raw.planId, manifestSha256: raw.manifestSha256, preparedAt: Number.isFinite(raw.preparedAt) ? raw.preparedAt : 0, archives, offlineReady: typeof raw.offlineReady === "boolean" ? raw.offlineReady : null,
    // Where the prepared files are (the run's own set, or the legacy shared folder) and the cycle kind.
    transferDir: typeof raw.transferDir === "string" && raw.transferDir.startsWith("/") ? raw.transferDir.slice(0, 2048) : null,
    cycleKind: raw.cycleKind === "full" || raw.cycleKind === "delta" ? raw.cycleKind : null
  };
};

const HISTORY_REF = (h) => (h && typeof h.name === "string" && SHA256_HEX_RE.test(h.sha256 || "") ? { name: str(h.name, 200), sha256: h.sha256 } : null);
/** Incremental position of a transfer (mirroringCycle.js); null = not recorded (legacy). */
export const normalizeCycle = (raw) => {
  if (!raw || raw.schema !== "oaa.mirroring.cycle/v1" || !PLAN_ID_RE.test(raw.planId || "") || !["full", "delta"].includes(raw.kind)) return null;
  return {
    schema: raw.schema, planId: raw.planId, createdAt: str(raw.createdAt, 40), kind: raw.kind,
    since: typeof raw.since === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.since) ? raw.since : null,
    baseline: HISTORY_REF(raw.baseline), produced: HISTORY_REF(raw.produced),
    previousPlanId: PLAN_ID_RE.test(raw.previousPlanId || "") ? raw.previousPlanId : null
  };
};
const RECOVERY_CLASSES = ["RETRY_SAME", "RESUME_PRESERVED_STATE", "REPAIR_AUTH_OR_TRUST"];
const normalizeRecovery = (raw) => {
  if (!raw || !JOB_ID_RE.test(raw.originJobId || "")) return null;
  return {
    originJobId: raw.originJobId,
    classification: RECOVERY_CLASSES.includes(raw.classification) ? raw.classification : null,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
    attempts: (Array.isArray(raw.attempts) ? raw.attempts : []).slice(-50)
      .filter((a) => a && JOB_ID_RE.test(a.jobId || ""))
      .map((a) => ({ jobId: a.jobId, planId: PLAN_ID_RE.test(a.planId || "") ? a.planId : null, at: Number.isFinite(a.at) ? a.at : 0 }))
  };
};
/** One transfer loaded into a destination registry on the disconnected side. */
const normalizeApplied = (raw) => {
  if (!raw || !PLAN_ID_RE.test(raw.planId || "") || typeof raw.destination !== "string" || !raw.destination) return null;
  return {
    planId: raw.planId, destination: str(raw.destination, 2048),
    planCreatedAt: Number.isFinite(raw.planCreatedAt) ? raw.planCreatedAt : null,
    kind: raw.kind === "full" || raw.kind === "delta" ? raw.kind : null,
    produced: HISTORY_REF(raw.produced),
    jobId: JOB_ID_RE.test(raw.jobId || "") ? raw.jobId : null,
    at: Number.isFinite(raw.at) ? raw.at : 0
  };
};

const CATALOG_IDENTITY_STATUSES = ["matches-verified", "differs-from-verified", "not-verified", "unpinned"];
/** DOC-155 (M7) per-catalog identity as recorded in a transfer manifest; null = predates it. */
const normalizeCatalogIdentity = (raw) => (Array.isArray(raw)
  ? raw.slice(0, 50).filter((c) => c && CATALOG_IDENTITY_STATUSES.includes(c.status)).map((c) => ({
    sourceReference: str(c.sourceReference, MAX_IMAGE_REF_LENGTH),
    pinnedDigest: /^sha256:[a-f0-9]{64}$/.test(c.pinnedDigest || "") ? c.pinnedDigest : null,
    status: c.status
  }))
  : null);

/**
 * A transfer received, verified and staged on the high side (M6). Disk to
 * mirror runs only from one of these, with its staged configuration.
 */
const normalizeReceived = (raw) => {
  const origin = normalizeOrigin(raw?.origin);
  if (!origin || !SHA256_HEX_RE.test(raw.configSha256 || "") || !SHA256_HEX_RE.test(raw.manifestSha256 || "")) return null;
  const archives = (Array.isArray(raw.archives) ? raw.archives : []).slice(0, 2000).map(normalizeArchive).filter(Boolean);
  if (!archives.length) return null;
  return {
    planId: origin.planId,
    origin,
    configSha256: raw.configSha256,
    manifestSha256: raw.manifestSha256,
    receivedAt: Number.isFinite(raw.receivedAt) ? raw.receivedAt : 0,
    sourceDir: str(raw.sourceDir, 1024),
    toolVersion: str(raw.toolVersion, 200) || null,
    toolSha256: SHA256_HEX_RE.test(raw.toolSha256 || "") ? raw.toolSha256 : null,
    // Option B (v2.2.0): what else the transfer says about the connected side's oc-mirror, and the
    // receipt-time comparison with this server's oc-mirror. Malformed values are dropped.
    toolGitCommit: /^[0-9a-f]{7,64}$/i.test(raw.toolGitCommit || "") ? raw.toolGitCommit : null,
    toolArch: ["amd64", "x86_64", "arm64", "aarch64", "ppc64le", "s390x"].includes(raw.toolArch) ? raw.toolArch : null,
    toolChannelRelease: /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]{1,40})?$/.test(raw.toolChannelRelease || "") ? raw.toolChannelRelease : null,
    toolIdentity: raw.toolIdentity && ["match", "different", "local-missing", "not-recorded", "invalid-recorded"].includes(raw.toolIdentity.status)
      ? {
        status: raw.toolIdentity.status,
        localSha256: SHA256_HEX_RE.test(raw.toolIdentity.localSha256 || "") ? raw.toolIdentity.localSha256 : null,
        localVersion: str(raw.toolIdentity.localVersion, 200) || null,
        checkedAt: Number.isFinite(raw.toolIdentity.checkedAt) ? raw.toolIdentity.checkedAt : null
      }
      : null,
    summary: str(raw.summary, 600),
    archives,
    // DOC-155 (M7): null when the transfer predates catalog identity checks.
    offlineReady: typeof raw.offlineReady === "boolean" ? raw.offlineReady : null,
    catalogIdentity: normalizeCatalogIdentity(raw.catalogIdentity),
    cycle: normalizeCycle(raw.cycle),
    planCreatedAt: Number.isFinite(raw.planCreatedAt) ? raw.planCreatedAt : null
  };
};

const normalizeExecution = (raw = {}) => ({
  mode: MIRRORING_MODES.includes(raw.mode) ? raw.mode : "mirrorToDisk",
  registryUrl: str(raw.registryUrl, 2048),
  options: normalizeRunOptions(raw.options),
  lastRunJobId: str(raw.lastRunJobId, 64) || null
});

export const normalizeProfile = (raw, id) => {
  const now = Date.now();
  const r = raw && typeof raw === "object" ? raw : {};
  const operators = Array.isArray(r.operators?.selected) ? r.operators.selected : [];
  const images = Array.isArray(r.additionalImages) ? r.additionalImages : [];
  const history = Array.isArray(r.history) ? r.history : [];
  return {
    id,
    name: str(r.name, MAX_NAME_LENGTH) || "Untitled profile",
    createdAt: Number.isFinite(r.createdAt) ? r.createdAt : now,
    updatedAt: Number.isFinite(r.updatedAt) ? r.updatedAt : now,
    content: normalizeContent(r.content),
    platform: normalizePlatform(r.platform),
    operators: {
      catalogMinor: str(r.operators?.catalogMinor, 16) || null,
      // Where the catalog minor came from: "platform" (derived from the
      // platform release), "user" (chosen for an operators-only profile, or an
      // override saved before M3 acceptance) or "import" (read from an
      // imported ImageSetConfiguration). Only "platform" may be rewritten
      // automatically; the others are preserved until the user reconciles.
      catalogMinorSource: CATALOG_MINOR_SOURCES.includes(r.operators?.catalogMinorSource) ? r.operators.catalogMinorSource : null,
      selected: operators.slice(0, MAX_SELECTED_OPERATORS).map(normalizeOperator).filter(Boolean)
    },
    additionalImages: images.slice(0, MAX_ADDITIONAL_IMAGES).map((img, i) => normalizeImage(img, i)).filter(Boolean),
    options: normalizeOptions(r.options),
    imports: (Array.isArray(r.imports) ? r.imports : []).slice(-MAX_IMPORTS).map(normalizeImportRecord).filter(Boolean),
    execution: normalizeExecution(r.execution),
    // M6: "planned" profiles are edited and mirrored to disk / to mirror;
    // "received" profiles were created from a low-side transfer and only run
    // disk to mirror from it (their content is the transfer's, not editable).
    kind: r.kind === "received" && normalizeOrigin(r.origin) ? "received" : "planned",
    ...(r.kind === "received" && normalizeOrigin(r.origin) ? { origin: normalizeOrigin(r.origin) } : {}),
    transfers: (Array.isArray(r.transfers) ? r.transfers : []).slice(-MAX_TRANSFERS).map(normalizePreparedTransfer).filter(Boolean),
    received: (Array.isArray(r.received) ? r.received : []).slice(-MAX_TRANSFERS).map(normalizeReceived).filter(Boolean),
    // Disconnected side: transfers loaded into each destination, in order (transfer-order guard).
    appliedCycles: (Array.isArray(r.appliedCycles) ? r.appliedCycles : []).slice(-500).map(normalizeApplied).filter(Boolean),
    // "Run the same again" attempts per original run (no credentials).
    recoveries: (Array.isArray(r.recoveries) ? r.recoveries : []).slice(-100).map(normalizeRecovery).filter(Boolean),
    history: history.filter((h) => typeof h === "string" && h.length <= 64).slice(-MAX_HISTORY),
    // Server-owned: the Mirroring storage root this profile was created under
    // (null = DATA_DIR/oc-mirror). Never taken from a client write; checked
    // against the server's accepted roots each time it is used.
    storageBase: typeof r.storageBase === "string" && r.storageBase.length <= 1024 && r.storageBase ? r.storageBase : null
  };
};

/** Whitelisted, size-bounded copy of a stored or incoming slice. */
export const normalizeMirroringSlice = (raw) => {
  const out = emptyMirroringSlice();
  if (!raw || typeof raw !== "object") return out;
  const profiles = raw.profiles && typeof raw.profiles === "object" ? raw.profiles : {};
  for (const [id, profile] of Object.entries(profiles).slice(0, MAX_PROFILES)) {
    if (!isValidProfileId(id)) continue;
    out.profiles[id] = normalizeProfile(profile, id);
  }
  out.activeProfileId = isValidProfileId(raw.activeProfileId) && out.profiles[raw.activeProfileId]
    ? raw.activeProfileId
    : null;
  return out;
};

/**
 * Per-profile directories, derived from the id and never from client input.
 * `where` is the application DATA_DIR (content under DATA_DIR/oc-mirror, the
 * default) or `{ base }`, the Mirroring storage root the profile is pinned to
 * (mirroringStorage.js).
 */
export const profilePaths = (where, id) => {
  if (!isValidProfileId(id)) throw new Error("Invalid mirroring profile id.");
  const base = where && typeof where === "object" ? path.resolve(where.base) : path.join(path.resolve(where), "oc-mirror");
  const root = path.join(base, "profiles", id);
  return {
    root,
    archivePath: path.join(root, "archives"),
    workspacePath: path.join(root, "workspace"),
    cachePath: path.join(root, "cache"),
    // M6: verified copies of received transfers, one directory per plan.
    receivedPath: path.join(root, "received")
  };
};

/** Staging directory of one received transfer (derived, never client-supplied). */
export const receivedDir = (dataDir, profileId, planId) => {
  if (!PLAN_ID_RE.test(planId || "")) throw new Error("Invalid plan id.");
  return path.join(profilePaths(dataDir, profileId).receivedPath, planId);
};

/**
 * Structural problems that make a profile unusable regardless of version
 * support. Returns a list of { path, message }.
 */
export const validateProfileStructure = (profile) => {
  const errors = [];
  const arch = profile.platform?.architecture;
  if (arch && !ARCHITECTURES.includes(arch)) {
    errors.push({ path: "platform.architecture", message: `Unknown architecture "${arch}". Use one of: ${ARCHITECTURES.join(", ")}.` });
  }
  if (profile.operators?.catalogMinor && !parseExactMinor(profile.operators.catalogMinor)) {
    errors.push({ path: "operators.catalogMinor", message: "Catalog minor must be a minor version such as 4.22." });
  }
  const seenIds = new Set();
  profile.additionalImages.forEach((img, i) => {
    if (!IMAGE_REF_RE.test(img.name)) {
      errors.push({ path: `additionalImages[${i}].name`, message: "Image reference contains characters that are not valid in a container image reference." });
    }
    if (seenIds.has(img.id)) errors.push({ path: `additionalImages[${i}].id`, message: "Duplicate image row identity." });
    seenIds.add(img.id);
  });
  return errors;
};

/** The platform minor of a profile, from its own release/version only. */
export const getProfilePlatformMinor = (profile) =>
  getOpenShiftMinorFromSources(profile?.platform?.release || {}, profile?.platform?.version || {});

/**
 * Supported-minor boundary for one profile. Returns null when every minor the
 * profile carries is supported, or the UNSUPPORTED_VERSION error to return as
 * HTTP 422. Checks the platform minor and the catalog minor independently and
 * regardless of which content types are currently selected: a deselected
 * section is retained (non-destructive deselection), so it must not be able to
 * hold an unsupported version either.
 */
export const findUnsupportedProfileVersion = (profile) => {
  const platformMinor = getProfilePlatformMinor(profile);
  if (platformMinor && !isSupportedMinor(platformMinor)) {
    const err = buildUnsupportedVersionError(platformMinor);
    err.path = "platform";
    return err;
  }
  const patch = profile?.platform?.release?.patchVersion || profile?.platform?.version?.selectedPatch;
  if (patch) {
    let patchMinor = null;
    try { patchMinor = getMinorVersion(patch); } catch { patchMinor = null; }
    if (patchMinor && !isSupportedMinor(patchMinor)) {
      const err = buildUnsupportedVersionError(patchMinor);
      err.path = "platform.release.patchVersion";
      return err;
    }
  }
  const catalogMinor = parseExactMinor(profile?.operators?.catalogMinor);
  if (catalogMinor && !isSupportedMinor(catalogMinor)) {
    const err = buildUnsupportedVersionError(catalogMinor);
    err.path = "operators.catalogMinor";
    return err;
  }
  return null;
};

export const findUnsupportedSliceVersion = (slice) => {
  for (const profile of Object.values(slice?.profiles || {})) {
    const err = findUnsupportedProfileVersion(profile);
    if (err) {
      err.profileId = profile.id;
      return err;
    }
  }
  return null;
};

const catalogTagMinor = (image) => {
  const m = String(image || "").match(/:v(\d+\.\d+)$/);
  return m ? m[1] : null;
};

/** Drop catalog-resolved metadata from one operator, keeping the user's intent. */
const operatorToIntent = (op) => ({
  id: op.id,
  name: op.name,
  ...(op.displayName ? { displayName: op.displayName } : {}),
  ...(op.sources ? { sources: op.sources } : {})
});

/**
 * Catalog-minor relationship for a profile with platform AND operators
 * content. `conflict` is true when the stored catalog minor was not derived
 * from the platform ("user" from before M3 acceptance, or "import") and
 * differs from the platform minor. Returns null for any other profile.
 */
export const catalogMinorReconciliation = (profile) => {
  if (!profile?.content?.platform || !profile?.content?.operators) return null;
  const platformMinor = getProfilePlatformMinor(profile);
  const catalogMinor = parseExactMinor(profile.operators?.catalogMinor);
  const source = profile.operators?.catalogMinorSource || null;
  const conflict = Boolean(platformMinor && catalogMinor && source !== "platform" && catalogMinor !== platformMinor);
  return { platformMinor: platformMinor || null, catalogMinor, source, conflict };
};

/**
 * Apply the "catalogs follow the platform" rule to a profile about to be
 * written (`prev` is the stored profile, or null for a new one). Pure.
 *
 * - Platform + operators: the catalog minor becomes the platform minor
 *   (source "platform"), and selected operators resolved for another minor go
 *   back to intent, to be re-resolved from the new minor's catalogs.
 *   A preserved conflict (see catalogMinorReconciliation) is kept as-is when
 *   the write leaves the catalog minor alone; it is only resolved by an
 *   explicit reconciliation or by the user choosing a matching platform minor.
 *   A write that tries to set a catalog minor other than the platform minor is
 *   refused with CATALOG_MINOR_FOLLOWS_PLATFORM.
 * - Anything else: unchanged (operators-only keeps its explicit choice).
 *
 * @returns {{ profile: object } | { error: { status: number, code: string, message: string } }}
 */
export const deriveCatalogMinor = (prev, next, { incomingCatalogMinor } = {}) => {
  if (!next.content.platform || !next.content.operators) return { profile: next };
  const platformMinor = getProfilePlatformMinor(next);
  const storedMinor = parseExactMinor(prev?.operators?.catalogMinor) || null;
  const requested = incomingCatalogMinor === undefined ? undefined : (parseExactMinor(incomingCatalogMinor) || null);
  if (requested !== undefined && requested !== null && requested !== platformMinor && requested !== storedMinor) {
    return {
      error: {
        status: 400,
        code: "CATALOG_MINOR_FOLLOWS_PLATFORM",
        message: `With OpenShift platform content selected, the operator catalogs follow the platform minor${platformMinor ? ` (${platformMinor})` : ""}. Change the platform release instead, or remove platform content to choose a catalog minor yourself.`
      }
    };
  }
  const prevSource = prev?.operators?.catalogMinorSource || null;
  const preserving = prevSource && prevSource !== "platform" && storedMinor &&
    next.operators.catalogMinorSource !== "platform" &&
    (requested === undefined || requested === storedMinor);
  if (preserving && storedMinor !== platformMinor) {
    // Keep the stored choice untouched; readiness reports the conflict.
    return { profile: { ...next, operators: { ...next.operators, catalogMinor: storedMinor, catalogMinorSource: prevSource } } };
  }
  const derived = platformMinor || null;
  const selected = next.operators.selected.map((op) =>
    op.catalogImage && catalogTagMinor(op.catalogImage) !== derived ? operatorToIntent(op) : op
  );
  return {
    profile: {
      ...next,
      operators: { ...next.operators, catalogMinor: derived, catalogMinorSource: derived ? "platform" : null, selected }
    }
  };
};

/**
 * Explicit reconciliation of a catalog/platform conflict (M4).
 * - "align": catalogs follow the platform minor; operators resolved for the
 *   old minor become intent and are re-resolved when the new catalogs load.
 * - "split": the operators move, unchanged and with their catalog minor, into
 *   a new operators-only profile; this profile keeps its platform content.
 * Returns { profile, newProfile? } or { error }.
 */
export const reconcileCatalogConflict = (profile, action, newId) => {
  const rec = catalogMinorReconciliation(profile);
  if (!rec?.conflict) return { error: { status: 409, code: "NO_CATALOG_CONFLICT", message: "This profile has no catalog minor conflict to reconcile." } };
  const now = Date.now();
  if (action === "align") {
    const aligned = deriveCatalogMinor(null, { ...profile, operators: { ...profile.operators, catalogMinorSource: "platform" } });
    return { profile: { ...aligned.profile, updatedAt: now } };
  }
  if (action === "split") {
    const newProfile = normalizeProfile({
      name: `${profile.name} — operators ${rec.catalogMinor}`.slice(0, MAX_NAME_LENGTH),
      content: { platform: false, operators: true, additionalImages: false },
      operators: { ...profile.operators },
      ...(profile.imports ? { imports: profile.imports } : {}),
      createdAt: now,
      updatedAt: now
    }, newId);
    const kept = normalizeProfile({
      ...profile,
      content: { ...profile.content, operators: false },
      operators: { catalogMinor: null, catalogMinorSource: null, selected: [] },
      updatedAt: now
    }, profile.id);
    return { profile: kept, newProfile };
  }
  return { error: { status: 400, code: "INVALID_RECONCILIATION", message: "Choose align or split." } };
};

/** Advisory (never blocking) findings. */
export const profileWarnings = (profile) => {
  const warnings = [];
  const catalogMinor = parseExactMinor(profile?.operators?.catalogMinor);
  if (profile.content.operators) {
    const unresolved = profile.operators.selected.filter((op) => !(op.catalogImage && op.defaultChannel));
    const resolvedCount = profile.operators.selected.length - unresolved.length;
    if (unresolved.length && resolvedCount) {
      warnings.push({
        code: "OPERATORS_UNRESOLVED",
        message: `${unresolved.length} selected operator(s) are not resolved for catalog ${catalogMinor || "(no minor)"} and are left out of the generated configuration until resolved: ${unresolved.map((op) => op.displayName || op.name).join(", ")}.`
      });
    }
  }
  return warnings;
};

/**
 * What a profile still needs before an ImageSetConfiguration can be generated
 * for its selected content. Returns a list of { path, message }; empty means
 * ready. Unsupported versions are reported by findUnsupportedProfileVersion.
 */
export const generationReadiness = (profile) => {
  const problems = [];
  if (profile.kind === "received") {
    // Nothing is generated for a received profile: it runs its transfer's configuration.
    if (!profile.received?.length) problems.push({ path: "received", message: "Receive a transfer from the low side before running disk to mirror." });
    return problems;
  }
  const c = profile.content;
  if (!c.platform && !c.operators && !c.additionalImages) {
    problems.push({ path: "content", message: "Select at least one content type: OpenShift platform, Operators or Additional images." });
  }
  if (c.platform) {
    if (!getProfilePlatformMinor(profile) || !profile.platform.release.patchVersion) {
      problems.push({ path: "platform", message: "Select an OpenShift release and patch for platform content." });
    } else if (!profile.platform.version.locked) {
      problems.push({ path: "platform.version.locked", message: "Lock the selected OpenShift release before generating platform content." });
    }
  }
  if (c.operators) {
    const rec = catalogMinorReconciliation(profile);
    if (rec?.conflict) {
      problems.push({
        path: "operators.catalogMinor",
        code: "CATALOG_PLATFORM_MINOR_CONFLICT",
        message: `The operator catalogs are for OpenShift ${rec.catalogMinor}, but the platform release is ${rec.platformMinor}. In a profile with both, operator catalogs follow the platform minor. Choose whether to align the catalogs to ${rec.platformMinor} or move the operators into their own profile.`
      });
    } else if (rec && !rec.platformMinor) {
      problems.push({ path: "operators.catalogMinor", message: "Select the OpenShift platform release first; operator catalogs follow its minor." });
    } else if (!parseExactMinor(profile.operators.catalogMinor)) {
      problems.push({ path: "operators.catalogMinor", message: "Select the operator catalog minor (for example 4.22)." });
    }
    const unresolved = profile.operators.selected.filter((op) => !(op.catalogImage && op.defaultChannel)).length;
    if (!profile.operators.selected.length) {
      problems.push({ path: "operators.selected", message: "Select at least one operator." });
    } else if (unresolved === profile.operators.selected.length) {
      problems.push({ path: "operators.selected", message: `None of the selected operators is resolved for catalog ${profile.operators.catalogMinor || "(no minor)"} yet. Load the catalogs for that minor to resolve them.` });
    }
  }
  if (c.additionalImages && !profile.additionalImages.length) {
    problems.push({ path: "additionalImages", message: "Add at least one additional image." });
  }
  for (const imp of profile.imports || []) {
    const open = imp.unresolved.filter((u) => u.status === "open").length;
    if (open) {
      problems.push({
        path: `imports.${imp.id}`,
        code: "IMPORT_REVIEW_REQUIRED",
        message: `${open} part(s) of the imported file ${imp.fileName} cannot be represented in this editor. Review them: each must be left out explicitly before this profile can be generated (the original file is kept unchanged).`
      });
    }
  }
  return problems;
};

/**
 * Projects a profile onto the state shape buildImageSetConfig reads, plus the
 * content flags to pass it. Only the selected content is projected; Install
 * slices are never consulted.
 */
export const projectProfileForGeneration = (profile) => {
  const c = profile.content;
  const catalogMinor = parseExactMinor(profile.operators.catalogMinor);
  return {
    state: {
      release: c.platform ? { ...profile.platform.release } : {},
      version: c.platform ? { ...profile.platform.version } : {},
      blueprint: c.platform && profile.platform.architecture ? { arch: profile.platform.architecture } : {},
      operators: { selected: c.operators ? profile.operators.selected : [] },
      imagesetConfig: {
        ...(profile.options?.archiveSize ? { archiveSize: String(profile.options.archiveSize) } : {}),
        graph: profile.platform.graph,
        kubeVirtContainer: c.platform && profile.platform.kubeVirtContainer,
        additionalImages: c.additionalImages ? profile.additionalImages.map((i) => i.name).join("\n") : ""
      }
    },
    options: {
      content: { platform: c.platform, operators: c.operators, additionalImages: c.additionalImages },
      catalogMinor: c.operators ? catalogMinor : null
    }
  };
};

/**
 * The DRAFT view of a profile that is not ready (v2.2.0, R-UX09): the same
 * profile with only the content groups that can be rendered honestly from what
 * the user has selected. Nothing is invented: a platform release that is
 * selected but not locked is shown as selected; no release, an unresolved
 * catalog minor, no resolved operators or no images leave that group out and
 * say so. Never used for runs, downloads or transfers.
 * @returns {{ profile: object|null, omitted: { group: string, reason: string }[] }}
 */
export const draftProfileView = (profile) => {
  const c = { ...profile.content };
  const omitted = [];
  if (c.platform && !(getProfilePlatformMinor(profile) && profile.platform.release.patchVersion)) {
    c.platform = false;
    omitted.push({ group: "platform", reason: "no OpenShift release and patch selected" });
  }
  if (c.operators) {
    const rec = catalogMinorReconciliation(profile);
    const resolved = profile.operators.selected.filter((op) => op.catalogImage && op.defaultChannel).length;
    if (rec?.conflict) { c.operators = false; omitted.push({ group: "operators", reason: "the catalog minor and the platform minor differ" }); }
    else if (!parseExactMinor(profile.operators.catalogMinor) || (rec && !rec.platformMinor)) { c.operators = false; omitted.push({ group: "operators", reason: "no catalog minor yet" }); }
    else if (!resolved) { c.operators = false; omitted.push({ group: "operators", reason: "no operator resolved from the scanned catalogs yet" }); }
  }
  if (c.additionalImages && !profile.additionalImages.length) {
    c.additionalImages = false;
    omitted.push({ group: "additionalImages", reason: "no additional image added yet" });
  }
  if (!c.platform && !c.operators && !c.additionalImages) return { profile: null, omitted };
  return { profile: { ...profile, content: c }, omitted };
};

/** Public view of a profile: stored fields plus derived, read-only paths. */
export const describeProfile = (where, profile, extra = {}) => ({
  ...profile,
  paths: profilePaths(where, profile.id),
  ...extra,
  warnings: profileWarnings(profile),
  readiness: generationReadiness(profile),
  catalogReconciliation: catalogMinorReconciliation(profile)
});
