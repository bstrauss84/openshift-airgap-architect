/**
 * The PRODUCTION release-evidence bundle: what a scan actually proves, and the
 * structural separation between a preliminary scan and a release artifact.
 *
 * The sibling modules in this directory each close one defect — digest
 * conflation (imageIdentity), scan-input transport (scanInput), the scanner
 * cache contract (scannerProvenance), candidate binding (candidateBinding).
 * Each is unit-tested against fixtures. Fixtures cannot answer the question
 * this module exists for: does the END-TO-END workflow, run against the real
 * images with the real scanner, produce evidence that a release gate can
 * trust? Everything below is grounded in an execution against the actual
 * shipping images on 2026-10-14; the observations are recorded inline as
 * VERIFIED, and the things that were not executed are marked as such.
 *
 * ── FINDING 1: `--input` ERASES THE IMAGE'S NAME ───────────────────────────
 *
 * Scanning a converted OCI layout is correct (scanInput.mjs) but it costs the
 * report its own subject identity. VERIFIED on both images:
 *
 *     ArtifactName         "/scan"         <- the MOUNT PATH, not the image
 *     Metadata.RepoTags    undefined
 *     Metadata.RepoDigests undefined
 *     Metadata.ImageID     sha256:7252836047c2…   <- the CONFIG digest
 *
 * So requirement "the BOM must NAME the image it describes" cannot be met by
 * reading a name out of the report: there is none, and `ArtifactName` is an
 * attacker- and operator-controlled mount path that would make ANY report look
 * like it matched. `Metadata.ImageID` is the only field that identifies the
 * subject, and it is the CONFIG digest — verified equal to `podman .Id` for
 * both images, and NOT equal to `.Digest`.
 *
 * `reportSubjectConsistency()` therefore binds reports and SBOMs to images on
 * the CONFIG DIGEST and explicitly refuses to accept `ArtifactName` as
 * evidence of anything. A report whose ImageID is absent is INCONSISTENT, not
 * "assumed to match" — that is the fail-closed direction.
 *
 * ── FINDING 2: TRIVY'S CYCLONEDX IS NOT BYTE-REPRODUCIBLE ──────────────────
 *
 * Two consecutive runs over the SAME layout with the SAME scanner and SAME
 * database produced files of IDENTICAL length and DIFFERENT sha256. VERIFIED
 * four independent sources of per-run variance:
 *
 *   1. `serialNumber`            a fresh random urn:uuid per run
 *   2. `metadata.timestamp`      wall clock, 1s apart
 *   3. every `bom-ref`           a fresh random UUID per component
 *   4. COMPONENT ORDER           the components array is ordered by bom-ref,
 *                                so random refs randomise the ARRAY ORDER too
 *
 * (4) is the one that matters and the one a naive implementation misses:
 * stripping the timestamp and serial number still leaves two documents whose
 * component arrays are permuted, so they still do not compare equal. A claim
 * of "reproducible SBOM" built on field-stripping alone would be false.
 *
 * `canonicalizeCycloneDx()` therefore does the full job: it drops the two
 * per-run header fields, REWRITES every bom-ref to a deterministic identity
 * derived from the component itself (purl, else name@version), remaps the
 * dependency graph onto the rewritten refs, and sorts components and
 * dependencies by that stable key. The canonical forms of the two runs ARE
 * byte-identical — that is the claim this module makes, and it is the honest
 * one: *the scanner's output is reproducible in content, not in bytes, and the
 * canonical form is what may be hashed, compared, or signed.*
 *
 * ── FINDING 3: THESE IMAGES ARE NOT BOUND TO ANY OAA CANDIDATE ─────────────
 *
 * VERIFIED on all three local images (backend, frontend, and the hardened
 * candidate): `org.opencontainers.image.revision` is present, equals `vcs-ref`,
 * and names a commit that does not exist in this repository — it is Red Hat's
 * UBI base build commit, inherited. No `io.oaa.candidate-id`. No build
 * manifest. The worktree is DIRTY (28 entries), so even a correct revision
 * label could not bind it (candidateBinding B2 refuses a dirty candidate).
 *
 * These images were built BEFORE the changes under certification were
 * committed. They are therefore PRELIMINARY, and the central design rule of
 * this module follows from that:
 *
 *   A PRELIMINARY ARTIFACT MUST BE STRUCTURALLY IMPOSSIBLE TO MISTAKE FOR A
 *   RELEASE ARTIFACT.
 *
 * Not "a release artifact with a false flag" — structurally different. A
 * preliminary bundle carries a DIFFERENT `kind`, and the `release` block that
 * a gate reads is ABSENT rather than present-and-false. A consumer that
 * forgets to check a boolean gets `undefined` and fails; a consumer that reads
 * `kind` sees a string it does not recognise. Both failure modes are closed.
 * `assertReleaseArtifact()` is the single supported entry point for "may I
 * ship this", and it THROWS rather than returning false, so an ignored return
 * value cannot become an accidental approval.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Schema identity of an evidence bundle. */
export const EVIDENCE_SCHEMA_VERSION = 1;

/**
 * The two artifact kinds. These are DIFFERENT DOCUMENT TYPES, not one type
 * with a flag — see FINDING 3.
 */
export const ARTIFACT_KIND = Object.freeze({
  PRELIMINARY: "oaa.release-evidence.preliminary/v1",
  RELEASE: "oaa.release-evidence.release/v1",
});

/** Every reason a bundle can be refused release grade. Stable ids for CI. */
export const BLOCKER = Object.freeze({
  NO_SCANNER: "scanner.absent",
  NO_SCANNER_DIGEST: "scanner.unidentified",
  DB_ABSENT: "database.absent",
  DB_UNIDENTIFIED: "database.unidentified",
  DB_EXPIRED: "database.expired",
  IMAGE_ABSENT: "image.absent",
  IMAGE_MISMATCH: "image.identity-mismatch",
  SUBJECT_INCONSISTENT: "sbom.subject-inconsistent",
  UNBOUND_CANDIDATE: "candidate.unbound",
  DIRTY_CANDIDATE: "candidate.dirty",
  SBOM_NONREPRODUCIBLE: "sbom.nonreproducible",
  EVIDENCE_UNHASHED: "evidence.unhashed",
});

// ---------------------------------------------------------------------------
// Canonical JSON and hashing (item 9)
// ---------------------------------------------------------------------------

/**
 * Serialise with keys in sorted order at every level, so a hash is a function
 * of CONTENT and not of key insertion order.
 */
export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

export function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/** `sha256:`-prefixed digest of a value's canonical JSON form. */
export function canonicalDigest(value) {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}

/**
 * Record a path in a form that survives being copied somewhere else.
 *
 * Evidence is meant to be archived and re-verified on a machine that is not
 * this one. An absolute path like
 * `/home/<user>/code/<worktree>/release-certification/runs/.../backend.json`
 * does two unhelpful things at once: it discloses the build host's directory
 * layout and username, and it describes a location the verifying machine does
 * not have. Relative-to-root is both portable and sufficient, because the
 * digest is what identifies the bytes.
 *
 * Falls back to the basename when the file genuinely lies outside the root —
 * never to the absolute path, so there is no silent leak path.
 */
function portablePath(filePath, root) {
  if (!root) return path.basename(filePath);
  const rel = path.relative(root, filePath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return path.basename(filePath);
  return rel.split(path.sep).join("/");
}

/**
 * Hash one evidence file on disk. A file that cannot be read is reported as
 * unreadable rather than skipped: a missing evidence file must not quietly
 * shrink the manifest it was supposed to appear in.
 *
 * `root` makes the recorded path portable. It is optional for backward
 * compatibility with callers that pass already-relative paths.
 */
export function hashEvidenceFile(filePath, { fsImpl = fs, root = null } = {}) {
  const recorded = root ? portablePath(filePath, root) : filePath;
  try {
    const bytes = fsImpl.readFileSync(filePath);
    return { path: recorded, name: path.basename(filePath), bytes: bytes.length, sha256: `sha256:${sha256Hex(bytes)}`, ok: true };
  } catch (err) {
    return { path: recorded, name: path.basename(filePath), bytes: null, sha256: null, ok: false, reason: err.message };
  }
}

/**
 * Manifest of every evidence file, plus a single digest OVER the manifest.
 * That roll-up is what makes the set tamper-evident as a set: changing any one
 * file, or adding or removing a file, changes `manifestDigest`.
 *
 * `manifestDigest` covers only `{name, sha256}` and is therefore unaffected by
 * the path form — a bundle verified on another host produces the same digest,
 * which is the property that makes a copied bundle checkable at all.
 */
export function evidenceManifest(filePaths, { fsImpl = fs, root = null } = {}) {
  const files = filePaths.map((f) => hashEvidenceFile(f, { fsImpl, root })).sort((a, b) => a.name.localeCompare(b.name));
  const unreadable = files.filter((f) => !f.ok);
  return {
    files,
    complete: unreadable.length === 0,
    unreadable: unreadable.map((f) => f.path),
    manifestDigest: canonicalDigest(files.map((f) => ({ name: f.name, sha256: f.sha256 }))),
    ...(root ? { pathsRelativeTo: "run evidence directory" } : {}),
  };
}

// ---------------------------------------------------------------------------
// CycloneDX canonicalisation (item 6)
// ---------------------------------------------------------------------------

/** Fields whose value is a fresh random/wall-clock value on every run. */
export const PER_RUN_CYCLONEDX_FIELDS = Object.freeze(["serialNumber", "metadata.timestamp"]);

/**
 * The component's canonical COORDINATE. Preferred for readability of the
 * rewritten refs.
 *
 * NOT unique on its own — see `canonicalRef()`.
 */
export function componentKey(component = {}) {
  if (component.purl) return component.purl;
  const name = component.name ?? "(unnamed)";
  const version = component.version ?? "(unversioned)";
  const type = component.type ?? "library";
  return `${type}:${name}@${version}`;
}

/**
 * A TOTAL deterministic identity for a component.
 *
 * FINDING 2b (verified): a purl is NOT unique within one real SBOM. The
 * backend image contains 880 components with only 804 distinct purls. Two
 * mechanisms produce the duplicates, both legitimate:
 *
 *   - npm nesting: `buffer` is installed at BOTH
 *     `app/node_modules/compress-commons/node_modules/buffer` and
 *     `app/node_modules/crc32-stream/node_modules/buffer`. Same purl,
 *     different `aquasecurity:trivy:FilePath`.
 *   - Go vendoring: the same module is linked into both `oc` and `oc-mirror`.
 *
 * Sorting by purl alone therefore leaves TIES, and the tie order is whatever
 * the random bom-refs happened to produce — which is exactly the residual
 * nondeterminism observed: after a purl-only canonicalisation the frontend
 * SBOM matched but the backend SBOM still differed, in precisely the four
 * entries belonging to those duplicated npm packages.
 *
 * The key is therefore the coordinate PLUS a digest of the component's full
 * content, which makes it total: components that differ in any observable
 * field (such as FilePath) get distinct, stably-ordered refs.
 */
export function canonicalRef(component = {}) {
  const content = { ...component };
  delete content["bom-ref"];
  return `${componentKey(component)}#${canonicalDigest(content).slice("sha256:".length, "sha256:".length + 16)}`;
}

/**
 * Rewrite a trivy CycloneDX document into a form that is stable across runs.
 *
 * Addresses all variance sources from FINDING 2 — including the array
 * permutation and the duplicate-coordinate ties, neither of which
 * field-stripping alone fixes.
 */
export function canonicalizeCycloneDx(doc) {
  if (!doc || typeof doc !== "object") return { ok: false, reason: "SBOM is not an object" };
  const out = JSON.parse(JSON.stringify(doc));

  delete out.serialNumber;
  if (out.metadata && typeof out.metadata === "object") delete out.metadata.timestamp;

  // Stabilise property order BEFORE hashing content, so the content digest is
  // itself order-independent.
  const sortProps = (c) => {
    if (c && Array.isArray(c.properties)) {
      c.properties.sort((a, b) => `${a?.name}=${a?.value}`.localeCompare(`${b?.name}=${b?.value}`));
    }
  };
  sortProps(out.metadata?.component);
  for (const c of out.components ?? []) sortProps(c);

  // Map every random bom-ref onto a total deterministic key.
  const refMap = new Map();
  const register = (c) => {
    if (c && typeof c === "object" && typeof c["bom-ref"] === "string") refMap.set(c["bom-ref"], canonicalRef(c));
  };
  register(out.metadata?.component);
  for (const c of out.components ?? []) register(c);

  const remap = (ref) => refMap.get(ref) ?? ref;

  if (out.metadata?.component) out.metadata.component["bom-ref"] = remap(out.metadata.component["bom-ref"]);

  // Rewrite, then COLLAPSE components that are identical in every observable
  // field. Two such entries carry no distinguishing information, and keeping
  // both would force an arbitrary ordinal into the dependency graph — which
  // would reintroduce exactly the nondeterminism being removed.
  if (Array.isArray(out.components)) {
    const byRef = new Map();
    for (const c of out.components) {
      c["bom-ref"] = remap(c["bom-ref"]);
      if (!byRef.has(c["bom-ref"])) byRef.set(c["bom-ref"], c);
    }
    out.components = [...byRef.values()].sort((a, b) => String(a["bom-ref"]).localeCompare(String(b["bom-ref"])));
  }

  // Remap the dependency graph, union any entries that collapsed together,
  // and sort both the entries and their edge lists.
  if (Array.isArray(out.dependencies)) {
    const merged = new Map();
    for (const d of out.dependencies) {
      const ref = remap(d.ref);
      const edges = Array.isArray(d.dependsOn) ? d.dependsOn.map(remap) : [];
      const prev = merged.get(ref);
      if (prev) for (const e of edges) prev.add(e);
      else merged.set(ref, new Set(edges));
    }
    out.dependencies = [...merged.entries()]
      .map(([ref, edges]) => ({ ref, dependsOn: [...edges].sort() }))
      .sort((a, b) => a.ref.localeCompare(b.ref));
  }

  return { ok: true, document: out, digest: canonicalDigest(out), componentCount: (out.components ?? []).length };
}

/**
 * Compare N independent runs over the same input.
 *
 * Reports raw byte-reproducibility and canonical reproducibility SEPARATELY,
 * because conflating them is exactly how a false "reproducible" claim is made.
 */
export function assessSbomReproducibility(runs) {
  const list = Array.isArray(runs) ? runs : [];
  if (list.length < 2) {
    return { ok: false, runs: list.length, reason: "reproducibility needs at least two independent runs" };
  }
  const rawDigests = list.map((r) => `sha256:${sha256Hex(r.bytes ?? Buffer.alloc(0))}`);
  const canon = list.map((r) => canonicalizeCycloneDx(r.document));
  const failed = canon.find((c) => !c.ok);
  if (failed) return { ok: false, runs: list.length, reason: failed.reason };

  const canonicalDigests = canon.map((c) => c.digest);
  const byteIdentical = new Set(rawDigests).size === 1;
  const canonicallyIdentical = new Set(canonicalDigests).size === 1;

  return {
    ok: canonicallyIdentical,
    runs: list.length,
    byteIdentical,
    canonicallyIdentical,
    rawDigests,
    canonicalDigests,
    canonicalDigest: canonicallyIdentical ? canonicalDigests[0] : null,
    componentCount: canon[0].componentCount,
    perRunFields: [...PER_RUN_CYCLONEDX_FIELDS, "every component bom-ref", "component array order"],
    reason: canonicallyIdentical
      ? byteIdentical
        ? "runs are byte-identical"
        : "runs differ byte-for-byte only in per-run fields and array order; canonical forms are identical"
      : "canonical forms differ: the SBOM is not reproducible even after canonicalisation",
  };
}

// ---------------------------------------------------------------------------
// Subject consistency (item 7)
// ---------------------------------------------------------------------------

/**
 * Does this scan report / SBOM actually describe THIS image?
 *
 * Binds on the CONFIG digest (`Metadata.ImageID`), never on `ArtifactName` —
 * see FINDING 1. Absence of an identifying digest is INCONSISTENT.
 */
export function reportSubjectConsistency(report, identity) {
  const expected = normalizeDigest(identity?.configDigest);
  const observed = normalizeDigest(report?.Metadata?.ImageID);
  const artifactName = report?.ArtifactName ?? null;

  const base = {
    artifactName,
    artifactNameIsImageName: false,
    artifactNameTrusted: false,
    expectedConfigDigest: expected,
    observedConfigDigest: observed,
  };

  if (!expected) return { ...base, consistent: false, reason: "no expected image config digest was supplied" };
  if (!observed) {
    return {
      ...base,
      consistent: false,
      reason: "scan report carries no Metadata.ImageID, so it cannot be tied to any image",
    };
  }
  if (observed !== expected) {
    return { ...base, consistent: false, reason: `scan report describes a DIFFERENT image (${observed.slice(0, 19)}…)` };
  }
  return { ...base, consistent: true, reason: "scan report's Metadata.ImageID equals this image's config digest" };
}

/** Does a CycloneDX document name the image it describes? */
export function sbomSubjectConsistency(doc, identity) {
  const comp = doc?.metadata?.component ?? null;
  const props = Array.isArray(comp?.properties) ? comp.properties : [];
  const prop = (name) => props.find((p) => p?.name === name)?.value ?? null;
  const observed = normalizeDigest(prop("aquasecurity:trivy:ImageID"));
  const expected = normalizeDigest(identity?.configDigest);

  const base = {
    componentName: comp?.name ?? null,
    componentType: comp?.type ?? null,
    expectedConfigDigest: expected,
    observedConfigDigest: observed,
    repoDigestProperty: prop("aquasecurity:trivy:RepoDigest"),
    repoTagProperty: prop("aquasecurity:trivy:RepoTag"),
  };

  if (!expected) return { ...base, consistent: false, reason: "no expected image config digest was supplied" };
  if (!observed) {
    return { ...base, consistent: false, reason: "SBOM metadata.component carries no ImageID property; it names no image" };
  }
  if (observed !== expected) {
    return { ...base, consistent: false, reason: `SBOM describes a DIFFERENT image (${observed.slice(0, 19)}…)` };
  }
  return { ...base, consistent: true, reason: "SBOM metadata.component ImageID equals this image's config digest" };
}

function normalizeDigest(value) {
  if (typeof value !== "string" || !value) return null;
  return value.startsWith("sha256:") ? value : `sha256:${value}`;
}

// ---------------------------------------------------------------------------
// Vulnerability summarisation (item 8)
// ---------------------------------------------------------------------------

export const SEVERITIES = Object.freeze(["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"]);

/**
 * Reduce a trivy JSON report to the four facts a release decision needs per
 * finding: severity, package, whether a fix exists, and vendor applicability.
 *
 * `fixAvailable` is derived from `FixedVersion` ONLY. Trivy's `Status` is the
 * VENDOR's applicability statement (`affected`, `will_not_fix`,
 * `under_investigation`, `fixed`, `end_of_life`) and is reported separately —
 * VERIFIED present on the real reports, with `will_not_fix` and `end_of_life`
 * both occurring, which are precisely the cases where "no fix" and "not
 * applicable" must not be collapsed.
 */
export function summarizeFindings(report) {
  const results = Array.isArray(report?.Results) ? report.Results : [];
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  const byStatus = {};
  const targets = [];
  let total = 0;
  let fixAvailable = 0;

  for (const res of results) {
    const vulns = Array.isArray(res.Vulnerabilities) ? res.Vulnerabilities : [];
    targets.push({ target: res.Target ?? null, class: res.Class ?? null, type: res.Type ?? null, findings: vulns.length });
    for (const v of vulns) {
      total += 1;
      const sev = SEVERITIES.includes(v.Severity) ? v.Severity : "UNKNOWN";
      bySeverity[sev] += 1;
      const status = v.Status ?? "unspecified";
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      if (v.FixedVersion) fixAvailable += 1;
    }
  }

  return {
    total,
    bySeverity,
    byVendorStatus: byStatus,
    fixAvailable,
    fixUnavailable: total - fixAvailable,
    targets: targets.sort((a, b) => String(a.target).localeCompare(String(b.target))),
    fields: Object.freeze({
      severity: "Vulnerability.Severity",
      package: "Vulnerability.PkgName + PkgIdentifier.PURL",
      fixAvailability: "Vulnerability.FixedVersion (present => a fix exists)",
      applicability: "Vulnerability.Status (vendor statement; will_not_fix and end_of_life are NOT 'no finding')",
    }),
  };
}

/** Extract the N highest-severity findings in full detail, deterministically. */
export function topFindings(report, limit = 25) {
  const rank = Object.fromEntries(SEVERITIES.map((s, i) => [s, i]));
  const all = [];
  for (const res of report?.Results ?? []) {
    for (const v of res.Vulnerabilities ?? []) {
      all.push({
        id: v.VulnerabilityID ?? null,
        severity: v.Severity ?? "UNKNOWN",
        pkgName: v.PkgName ?? null,
        pkgPurl: v.PkgIdentifier?.PURL ?? null,
        installedVersion: v.InstalledVersion ?? null,
        fixedVersion: v.FixedVersion ?? null,
        fixAvailable: Boolean(v.FixedVersion),
        vendorStatus: v.Status ?? "unspecified",
        target: res.Target ?? null,
      });
    }
  }
  all.sort(
    (a, b) =>
      (rank[a.severity] ?? 99) - (rank[b.severity] ?? 99) ||
      String(a.id).localeCompare(String(b.id)) ||
      String(a.pkgName).localeCompare(String(b.pkgName)),
  );
  return all.slice(0, limit);
}

// ---------------------------------------------------------------------------
// The gate (item 11) and the bundle (item 10)
// ---------------------------------------------------------------------------

/**
 * Decide whether a set of observations is RELEASE evidence.
 *
 * Every check is expressed as "what must be TRUE"; anything unknown,
 * unreadable, absent or merely unasserted produces a blocker. There is no
 * branch that reaches "no blockers" by default — the function starts from a
 * list of required positives, so a new unpopulated field blocks rather than
 * passes.
 */
export function evaluateReleaseGate({
  images = [],
  scanner = null,
  database = null,
  sbomReproducibility = null,
  evidence = null,
  candidate = null,
} = {}) {
  const blockers = [];
  const add = (code, detail) => blockers.push({ code, detail });

  // --- scanner -------------------------------------------------------------
  if (!scanner || scanner.present === false) {
    add(BLOCKER.NO_SCANNER, "no scanner was available, so no scan was performed");
  } else {
    if (!scanner.version) add(BLOCKER.NO_SCANNER_DIGEST, "scanner reported no version");
    const d = scanner.image ?? {};
    if (!d.pinnedDigest && !d.manifestDigest && !d.configDigest) {
      add(BLOCKER.NO_SCANNER_DIGEST, "the scanner that produced these verdicts cannot be identified by image digest");
    }
  }

  // --- vulnerability database ---------------------------------------------
  if (!database) {
    add(BLOCKER.DB_ABSENT, "no vulnerability database was present: an empty cache cannot produce a verdict");
  } else if (database.identified !== true) {
    add(BLOCKER.DB_UNIDENTIFIED, database.reason ?? "the vulnerability database could not be identified");
  } else if (database.expired === true) {
    add(
      BLOCKER.DB_EXPIRED,
      `the vulnerability database passed its vendor-declared NextUpdate (${database.nextUpdate ?? "unknown"}); findings may be stale`,
    );
  }

  // --- images --------------------------------------------------------------
  if (!images.length) add(BLOCKER.IMAGE_ABSENT, "no images were resolved, so there is nothing to certify");
  for (const img of images) {
    const role = img?.role ?? "(unknown role)";
    if (img?.present === false) {
      add(BLOCKER.IMAGE_ABSENT, `image for role "${role}" is not present locally`);
      continue;
    }
    if (img?.reportConsistency && img.reportConsistency.consistent !== true) {
      add(BLOCKER.IMAGE_MISMATCH, `scan report for "${role}": ${img.reportConsistency.reason}`);
    }
    if (img?.sbomConsistency && img.sbomConsistency.consistent !== true) {
      add(BLOCKER.SUBJECT_INCONSISTENT, `SBOM for "${role}": ${img.sbomConsistency.reason}`);
    }
    if (img?.binding && img.binding.bound !== true) {
      add(BLOCKER.UNBOUND_CANDIDATE, `image for "${role}" is not bound to this candidate: ${img.binding.reason}`);
    }
  }

  // --- candidate -----------------------------------------------------------
  if (candidate?.clean === false) {
    const n = Number.isInteger(candidate.dirtyCount) ? `${candidate.dirtyCount} ` : "";
    add(
      BLOCKER.DIRTY_CANDIDATE,
      `the working tree has ${n}uncommitted change(s): no commit SHA describes these bytes`,
    );
  }

  // --- SBOM reproducibility ------------------------------------------------
  if (!sbomReproducibility) {
    add(BLOCKER.SBOM_NONREPRODUCIBLE, "SBOM reproducibility was never demonstrated");
  } else if (sbomReproducibility.ok !== true) {
    add(BLOCKER.SBOM_NONREPRODUCIBLE, sbomReproducibility.reason ?? "SBOM is not reproducible");
  }

  // --- evidence integrity --------------------------------------------------
  if (!evidence) {
    add(BLOCKER.EVIDENCE_UNHASHED, "no evidence manifest was produced");
  } else if (evidence.complete !== true) {
    add(BLOCKER.EVIDENCE_UNHASHED, `evidence files could not be hashed: ${(evidence.unreadable ?? []).join(", ")}`);
  }

  return {
    releaseCertifiable: blockers.length === 0,
    blockers,
    blockerCodes: [...new Set(blockers.map((b) => b.code))].sort(),
  };
}

/**
 * Assemble the bundle.
 *
 * The PRELIMINARY and RELEASE shapes differ structurally — see FINDING 3. The
 * `release` block exists only on a release artifact, so a consumer reading
 * `bundle.release.certifiable` on a preliminary bundle throws a TypeError
 * instead of reading `false` and carrying on.
 */
export function assembleEvidenceBundle({
  candidate,
  images = [],
  scanner = null,
  database = null,
  sboms = [],
  sbomReproducibility = null,
  evidence = null,
  generatedAt = new Date().toISOString(),
  workflow = null,
}) {
  const gate = evaluateReleaseGate({ images, scanner, database, sbomReproducibility, evidence, candidate });
  const isRelease = gate.releaseCertifiable;

  const body = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: isRelease ? ARTIFACT_KIND.RELEASE : ARTIFACT_KIND.PRELIMINARY,
    generatedAt,
    candidate: {
      id: candidate?.candidateId ?? null,
      head: candidate?.head ?? null,
      clean: candidate?.clean ?? null,
      dirtyCount: candidate?.dirtyCount ?? null,
    },
    images,
    scanner,
    vulnerabilityDatabase: database,
    sboms,
    sbomReproducibility,
    evidence,
    workflow,
  };

  if (isRelease) {
    body.release = {
      certifiable: true,
      certifiedAt: generatedAt,
      boundTo: candidate?.candidateId ?? null,
    };
  } else {
    // Deliberately NOT a `release` block with `certifiable:false`.
    body.preliminary = {
      reason: "this evidence does not meet release grade and MUST NOT be published as a release artifact",
      blockers: gate.blockers,
      blockerCodes: gate.blockerCodes,
      rescanRequiredAfterCommit: candidate?.clean === false,
    };
  }

  body.bundleDigest = canonicalDigest({ ...body, bundleDigest: undefined });
  return body;
}

/**
 * The only supported "may I ship this?" entry point.
 *
 * THROWS rather than returning false: a boolean return can be ignored by
 * accident, an exception cannot.
 */
export function assertReleaseArtifact(bundle) {
  if (!bundle || typeof bundle !== "object") throw new Error("release gate: no evidence bundle was supplied");
  if (bundle.schemaVersion !== EVIDENCE_SCHEMA_VERSION) {
    throw new Error(`release gate: unknown evidence schema version ${bundle.schemaVersion}`);
  }
  if (bundle.kind === ARTIFACT_KIND.PRELIMINARY) {
    const codes = bundle.preliminary?.blockerCodes ?? [];
    throw new Error(
      `release gate: this is a PRELIMINARY evidence artifact and must not be shipped (${codes.join(", ") || "unspecified"})`,
    );
  }
  if (bundle.kind !== ARTIFACT_KIND.RELEASE) {
    throw new Error(`release gate: unrecognised artifact kind "${bundle.kind}"`);
  }
  if (bundle.release?.certifiable !== true) {
    throw new Error("release gate: release artifact does not assert certifiability");
  }
  return true;
}

/** Deterministic CI exit code. Mirrors lib/status.mjs EXIT. */
export const GATE_EXIT = Object.freeze({ RELEASE: 0, PRELIMINARY: 2, HARNESS_ERROR: 3 });

export function gateExitCode(bundle) {
  try {
    assertReleaseArtifact(bundle);
    return GATE_EXIT.RELEASE;
  } catch {
    if (bundle?.kind === ARTIFACT_KIND.PRELIMINARY) return GATE_EXIT.PRELIMINARY;
    return GATE_EXIT.HARNESS_ERROR;
  }
}
