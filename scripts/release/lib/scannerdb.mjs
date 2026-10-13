/**
 * Vulnerability-database identity and freshness evidence.
 *
 * WHY PINNING THE SCANNER IS NOT ENOUGH. A pinned scanner digest fixes the
 * code that interprets advisories; it does not fix the advisories. The same
 * Trivy binary over two different database snapshots yields two different
 * verdicts for the same image. A scan report that names the tool but not the
 * data it consulted is not reproducible evidence, and on a disconnected host
 * — where the database is pre-seeded by an operator and may be arbitrarily
 * old — it can be actively misleading.
 *
 * NO INVENTED THRESHOLD. This module does not assert "a database older than N
 * days is stale". That number would be a fabrication, and the two supported
 * scanners genuinely differ in what they declare:
 *
 *   TRIVY publishes its own validity horizon. `trivy version --format json`
 *   reports `VulnerabilityDB.NextUpdate` alongside `UpdatedAt` and
 *   `DownloadedAt`. Past `NextUpdate`, Trivy itself considers the database due
 *   for refresh, so that is the tool's own declaration of staleness and is
 *   what gates here.
 *
 *   GRYPE publishes no horizon. `grype db status -o json` reports
 *   `schemaVersion`, `from`, `built`, `path` and `valid` (the `checksum` field
 *   was removed in DB v6 because the post-download index build makes the
 *   on-disk digest unstable). With no vendor-declared expiry, this module
 *   records `built` and surfaces the age rather than inventing a cutoff, and
 *   requires `valid === true`.
 *
 *   `valid` is treated as necessary but not sufficient: Anchore has open
 *   reports of `db status` returning valid for a missing or unverified
 *   database, so the recorded `built`/`from` provenance is what a human
 *   actually audits. That caveat is carried in the evidence rather than
 *   papered over.
 *
 * If database identity cannot be established at all, the vulnerability axis is
 * INCOMPLETE — never PASS.
 */

/** Parse `trivy version --format json`. Pure, so it is testable without trivy. */
export function parseTrivyDb(json, now = new Date()) {
  const db = json?.VulnerabilityDB;
  if (!db) return { identified: false, reason: "trivy version output carried no VulnerabilityDB block" };

  const nextUpdate = db.NextUpdate ? new Date(db.NextUpdate) : null;
  const validHorizon = nextUpdate && !Number.isNaN(nextUpdate.getTime()) ? nextUpdate : null;
  const expired = validHorizon ? now > validHorizon : null;

  return {
    identified: true,
    scanner: "trivy",
    scannerVersion: json?.Version ?? null,
    dbVersion: db.Version ?? null,
    builtAt: db.UpdatedAt ?? null,
    downloadedAt: db.DownloadedAt ?? null,
    nextUpdate: db.NextUpdate ?? null,
    // The tool's own declaration, not a threshold invented here.
    expiredByToolDeclaration: expired,
    freshnessPolicy: "trivy VulnerabilityDB.NextUpdate (vendor-declared validity horizon)",
  };
}

/** Parse `grype db status -o json`. Pure. */
export function parseGrypeDb(json) {
  if (!json || (json.schemaVersion === undefined && json.built === undefined)) {
    return { identified: false, reason: "grype db status output carried no schemaVersion or built field" };
  }
  return {
    identified: true,
    scanner: "grype",
    dbSchemaVersion: json.schemaVersion ?? null,
    builtAt: json.built ?? null,
    source: json.from ?? null,
    path: json.path ?? null,
    valid: json.valid === true,
    error: json.error || null,
    // Grype declares no expiry horizon, so none is invented. `built` is
    // recorded for human judgement.
    expiredByToolDeclaration: null,
    freshnessPolicy: "grype db status validity; no vendor-declared expiry horizon exists, so built-date age is reported, not gated",
    caveat: "grype db status has documented cases of reporting valid for a missing or unverified database; treat `valid` as necessary, not sufficient",
  };
}

/**
 * Has a human approved a freshness policy for a scanner that declares none?
 *
 * `false` for v2.1. Grype is supported as a DIAGNOSTIC scanner, but with no
 * vendor-declared validity horizon there is nothing to gate on, and the only
 * alternatives are to invent an age threshold (forbidden) or to accept
 * `valid === true` as sufficient (which would let an arbitrarily old database
 * manufacture a release PASS — the exact false-pass this harness exists to
 * prevent). So Grype cannot produce release-certifying evidence until 8D
 * approves an explicit policy and flips this constant.
 *
 * Deliberately a code constant, not configuration: approving it is a reviewed
 * decision, not an environment variable.
 */
export const GRYPE_FRESHNESS_POLICY = Object.freeze({
  approved: false,
  owner: "8D",
  reason:
    "grype publishes no vendor-declared validity horizon, and `valid` alone cannot distinguish a current database from an arbitrarily old one",
});

/**
 * Is the database acceptable for producing RELEASE evidence?
 *
 * Returns `{ acceptable, reason }`. Unacceptable means the vulnerability axis
 * must be INCOMPLETE: the scan may well run and its findings may well be
 * worth reading, but its output cannot be trusted as release proof.
 */
export function evaluateDb(db, { grypePolicy = GRYPE_FRESHNESS_POLICY } = {}) {
  if (!db?.identified) return { acceptable: false, reason: db?.reason ?? "vulnerability database could not be identified" };

  if (db.scanner === "trivy") {
    // Trivy declares its own horizon, so there is a vendor signal to gate on.
    if (db.expiredByToolDeclaration === true) {
      return { acceptable: false, reason: `trivy reports the database was due for update at ${db.nextUpdate}` };
    }
    if (!db.builtAt) return { acceptable: false, reason: "trivy reported no database build timestamp" };
    return { acceptable: true, reason: `trivy database built ${db.builtAt}, valid until ${db.nextUpdate}` };
  }

  if (db.scanner === "grype") {
    // Identity is still recorded by the caller; it is sufficiency that is refused.
    if (!db.valid) return { acceptable: false, reason: `grype reports the database is not valid${db.error ? `: ${db.error}` : ""}` };
    if (!db.builtAt) return { acceptable: false, reason: "grype reported no database build timestamp" };
    if (!grypePolicy.approved) {
      return {
        acceptable: false,
        diagnosticOnly: true,
        reason:
          `grype is diagnostic-only for release certification: ${grypePolicy.reason}. ` +
          `Database schema ${db.dbSchemaVersion} built ${db.builtAt} is recorded, but no approved freshness policy exists ` +
          `(owner: ${grypePolicy.owner}). Use trivy, or approve a policy in lib/scannerdb.mjs.`,
      };
    }
    return { acceptable: true, reason: `grype database schema ${db.dbSchemaVersion} built ${db.builtAt}` };
  }

  return { acceptable: false, reason: `unknown scanner "${db.scanner}"` };
}

/** Age in whole days, for human-readable evidence. Null when unknown. */
export function ageDays(builtAt, now = new Date()) {
  if (!builtAt) return null;
  const t = new Date(builtAt);
  if (Number.isNaN(t.getTime())) return null;
  return Math.floor((now.getTime() - t.getTime()) / 86_400_000);
}
