/**
 * Vendor inherited-risk accounting for unmodified official Red Hat binaries.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THE OWNER APPROVED, AND EXACTLY HOW FAR IT GOES
 *
 * Documented, per-artifact acceptance of inherited risk for **unmodified,
 * authentic official Red Hat binaries** that this project ships but does not
 * build: `oc`, `oc-mirror`, `mirror-registry`. The project will not fork,
 * rebuild or patch a vendor binary merely to remediate an upstream CVE.
 *
 * The approval does **NOT** cover:
 *   - UBI base-image OS packages (still this project's obligation to update),
 *   - npm dependencies,
 *   - any code in this repository.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THIS MODULE DOES NOT DO — AND THIS IS THE IMPORTANT PART
 *
 * It does not suppress a single finding. It does not reduce a count. It does
 * not flip `image-vulnerabilities` to PASS, and it must never be changed to.
 * That axis is marked NON-WAIVABLE in the registry, and the owner's approval
 * is of *the risk*, not of the *absence* of the risk — those are different
 * claims and only one of them is true. An accepted risk is a known, recorded,
 * still-present vulnerability.
 *
 * So the reconciliation between "this axis is non-waivable" and "vendor CVEs
 * are accepted" is NOT a waiver. It is attribution: the axis keeps reporting
 * every finding and keeps failing on what this project owns, while this
 * module answers the separate question "who can fix each one, and what did
 * the owner decide about it". Both answers are published; neither is allowed
 * to overwrite the other.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * OWNERSHIP IS DECIDED BY PATH, NEVER BY NAME
 *
 * A finding is attributed to a vendor binary only when the scanner reports it
 * against the *file path of that binary inside the image*. Matching on a
 * package name would be catastrophic here: `golang.org/x/net` appears both
 * inside the vendored `oc-mirror` Go binary AND, in principle, anywhere else.
 * Accepting by name would silently accept a finding this project owns.
 *
 * The path set is exhaustive and closed. An unrecognised path is attributed
 * to the project — the fail-closed direction — so a new vendor binary added
 * later blocks until someone declares it here deliberately.
 */

/** Dispositions this module can assign. Mirrors the ledger's vocabulary. */
export const RISK_OWNER = Object.freeze({
  /** This project builds or selects it. We fix it. */
  PROJECT: "project",
  /** Red Hat builds it; we ship it verbatim. Owner-accepted inherited risk. */
  VENDOR_REDHAT: "vendor-redhat",
});

/**
 * Exact in-image paths of the vendored Red Hat binaries.
 *
 * Verified against the shipped backend image layout. `mirror-registry` is a
 * tarball placed in the export bundle rather than installed into the image,
 * so it has no in-image path and is listed with `inImage: false` — it is
 * covered by the same acceptance but can never match an image scan finding.
 */
export const VENDORED_BINARIES = Object.freeze([
  {
    tool: "oc",
    paths: ["usr/local/bin/oc", "/usr/local/bin/oc"],
    inImage: true,
    source: "https://mirror.openshift.com/pub/openshift-v4/<arch>/clients/ocp/<version>/openshift-client-linux.tar.gz",
    buildsIt: "Red Hat",
    rationale: "shipped verbatim; rebuilding it would produce a binary Red Hat does not support",
  },
  {
    tool: "oc-mirror",
    paths: ["usr/local/bin/oc-mirror", "/usr/local/bin/oc-mirror"],
    inImage: true,
    source: "https://mirror.openshift.com/pub/openshift-v4/clients/ocp/latest/oc-mirror.tar.gz",
    buildsIt: "Red Hat",
    rationale: "shipped verbatim; Red Hat directs users to the latest oc-mirror v2 regardless of target minor",
  },
  {
    tool: "mirror-registry",
    paths: [],
    inImage: false,
    source: "https://mirror.openshift.com/pub/cgw/mirror-registry/latest/mirror-registry-<arch>.tar.gz",
    buildsIt: "Red Hat",
    rationale: "packaged into the export bundle, never installed into a shipped image",
  },
]);

const VENDOR_PATH_INDEX = new Map();
for (const b of VENDORED_BINARIES) {
  for (const p of b.paths) VENDOR_PATH_INDEX.set(p.replace(/^\/+/, ""), b);
}

/**
 * Who owns a single scanner finding?
 *
 * `target` is the scanner's own `Results[].Target`, which for a Go binary is
 * the binary's path inside the image and for an RPM is the image reference.
 * Normalised only by stripping a leading slash and any `(…)` suffix Trivy
 * appends, never by fuzzy matching.
 */
export function ownerOf(target) {
  const raw = String(target ?? "").trim();
  if (!raw) return { owner: RISK_OWNER.PROJECT, binary: null, reason: "no scan target recorded; attributed to the project" };

  const cleaned = raw.replace(/\s*\(.*\)\s*$/, "").replace(/^\/+/, "");
  const binary = VENDOR_PATH_INDEX.get(cleaned);
  if (binary) {
    return {
      owner: RISK_OWNER.VENDOR_REDHAT,
      binary: binary.tool,
      reason: `scanner target is the vendored Red Hat ${binary.tool} binary at ${cleaned}`,
    };
  }
  return {
    owner: RISK_OWNER.PROJECT,
    binary: null,
    // Stated positively so the fail-closed default is visible in evidence,
    // not inferred from an absence.
    reason: `scan target "${cleaned}" is not a declared vendored Red Hat binary path; attributed to the project`,
  };
}

/**
 * Attribute a whole scan report, preserving every finding.
 *
 * Returns counts and the full per-finding attribution. Nothing is filtered —
 * a caller that wants only the project's findings must say so explicitly,
 * which makes the narrowing visible at the call site.
 */
export function attributeFindings(report) {
  const findings = [];
  for (const res of report?.Results ?? []) {
    const attribution = ownerOf(res.Target);
    for (const v of res.Vulnerabilities ?? []) {
      findings.push({
        id: v.VulnerabilityID ?? null,
        severity: String(v.Severity ?? "UNKNOWN").toUpperCase(),
        pkgName: v.PkgName ?? null,
        installedVersion: v.InstalledVersion ?? null,
        fixedVersion: v.FixedVersion ?? null,
        fixAvailable: Boolean(v.FixedVersion),
        target: res.Target ?? null,
        targetClass: res.Class ?? null,
        owner: attribution.owner,
        vendorBinary: attribution.binary,
        attributionReason: attribution.reason,
      });
    }
  }

  const tally = (predicate) => {
    const out = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0, total: 0 };
    for (const f of findings) {
      if (!predicate(f)) continue;
      if (out[f.severity] === undefined) out.UNKNOWN += 1;
      else out[f.severity] += 1;
      out.total += 1;
    }
    return out;
  };

  return {
    findings,
    all: tally(() => true),
    project: tally((f) => f.owner === RISK_OWNER.PROJECT),
    vendor: tally((f) => f.owner === RISK_OWNER.VENDOR_REDHAT),
  };
}

/** A SHA-256, and nothing that merely resembles one. */
const SHA256_RE = /^[0-9a-f]{64}$/i;

/** `<arch>`, `<version>`: the template markers used in VENDORED_BINARIES.source. */
const UNRESOLVED_PLACEHOLDER_RE = /<[^>]+>/;

const DECLARED_TOOLS = new Set(VENDORED_BINARIES.map((b) => b.tool));

/**
 * The owner-approved disposition record for the vendor share.
 *
 * `toolIdentity` must carry the immutable identity the approval is scoped to:
 * resolved version, architecture, SHA256 and source URL. An acceptance that
 * does not name the exact artifact it accepts is not per-artifact, and the
 * approval was explicitly per-artifact.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG HERE, BECAUSE IT IS INSTRUCTIVE
 *
 * The previous implementation validated the MEMBERS of `toolIdentity` and
 * nothing else. An empty array has no members, so
 *
 *   vendorRiskDisposition({ toolIdentity: [], findings: vendorFindings })
 *
 * returned a complete "inherited-risk-accepted" record — for findings whose
 * artifact was never named. The function's own header said it refuses a
 * blanket tool exception; the loop it used could not detect one. Nothing
 * required the identities to COVER the findings being accepted either, so an
 * identity for `oc` could paper over accepted findings in `oc-mirror`.
 *
 * The rule now is coverage, not presence: every accepted finding's binary
 * must be named by a complete, well-formed, unambiguous identity, and every
 * identity must name a binary this project actually declares as vendored.
 *
 * THROWS on: no identities at all; a missing or malformed field; an
 * unresolved `<placeholder>` left in a URL or version; a tool that is not a
 * declared vendored binary; the same tool listed twice (identically or in
 * conflict); an accepted finding whose binary no identity covers; or a
 * finding whose vendor attribution does not survive re-derivation from its
 * scan target.
 */
export function vendorRiskDisposition({ toolIdentity = [], findings = [], decidedOn = null } = {}) {
  const REQUIRED = ["tool", "version", "architecture", "sha256", "sourceUrl"];

  if (!Array.isArray(toolIdentity) || toolIdentity.length === 0) {
    throw new Error(
      "vendorRiskDisposition requires at least one per-artifact identity. An acceptance that names no " +
        "artifact is a blanket tool exception, which was not approved — and an empty array is exactly that, " +
        "not a vacuous success."
    );
  }

  const incomplete = [];
  for (const t of toolIdentity) {
    const missing = REQUIRED.filter((k) => !t?.[k]);
    if (missing.length) incomplete.push({ tool: t?.tool ?? "<unnamed>", missing });
  }
  if (incomplete.length) {
    throw new Error(
      `vendorRiskDisposition requires complete per-artifact identity; incomplete: ${incomplete
        .map((i) => `${i.tool} (${i.missing.join(", ")})`)
        .join("; ")}. A disposition without exact identity is a blanket tool exception, which was not approved.`
    );
  }

  // Well-formedness. A present-but-meaningless value is the same failure as
  // an absent one: "sha256: TBD" identifies nothing, and a source URL still
  // carrying `<arch>` is the template, not the artifact that was fetched.
  const malformed = [];
  for (const t of toolIdentity) {
    if (!SHA256_RE.test(String(t.sha256))) malformed.push(`${t.tool}: sha256 "${t.sha256}" is not 64 hex characters`);
    if (!/^https:\/\/\S+$/.test(String(t.sourceUrl))) {
      malformed.push(`${t.tool}: sourceUrl "${t.sourceUrl}" is not an absolute https URL`);
    }
    for (const field of ["version", "architecture", "sourceUrl"]) {
      if (UNRESOLVED_PLACEHOLDER_RE.test(String(t[field]))) {
        malformed.push(`${t.tool}: ${field} "${t[field]}" still contains an unresolved placeholder`);
      }
    }
  }
  if (malformed.length) {
    throw new Error(
      `vendorRiskDisposition identities are not immutable artifact identities: ${malformed.join("; ")}. ` +
        "The acceptance expires when the artifact changes, which requires naming the artifact exactly."
    );
  }

  // An identity for something this project does not declare as a vendored
  // Red Hat binary would widen the approval by assertion. Fail closed, the
  // same direction `ownerOf` fails for an unrecognised path.
  const undeclared = toolIdentity.filter((t) => !DECLARED_TOOLS.has(t.tool));
  if (undeclared.length) {
    throw new Error(
      `vendorRiskDisposition was given identities for tools that are not declared vendored Red Hat binaries: ` +
        `${undeclared.map((t) => t.tool).join(", ")}. The approval covers ${[...DECLARED_TOOLS].join(", ")} only; ` +
        "adding a tool here is a deliberate declaration in VENDORED_BINARIES, not an argument."
    );
  }

  // Two entries for one tool mean the record cannot say which artifact was
  // accepted. Identical duplicates are rejected too: a reader cannot tell a
  // harmless copy from a merge that silently dropped one of two real
  // artifacts, and the evidence has to be unambiguous on its face.
  const byTool = new Map();
  const duplicates = [];
  for (const t of toolIdentity) {
    const prior = byTool.get(t.tool);
    if (prior) {
      const conflicting = REQUIRED.some((k) => String(prior[k]) !== String(t[k]));
      duplicates.push(`${t.tool} (${conflicting ? "conflicting" : "repeated"})`);
      continue;
    }
    byTool.set(t.tool, t);
  }
  if (duplicates.length) {
    throw new Error(
      `vendorRiskDisposition received more than one identity for: ${duplicates.join(", ")}. ` +
        "One artifact, one identity — otherwise the record does not say which binary the owner accepted."
    );
  }

  const vendorFindings = findings.filter((f) => f.owner === RISK_OWNER.VENDOR_REDHAT);
  const misattributed = vendorFindings.filter((f) => !f.vendorBinary);
  if (misattributed.length) {
    throw new Error(`${misattributed.length} finding(s) marked vendor-owned without naming a vendored binary`);
  }

  // Re-derive ownership from the scan target, as the axis guard does. A
  // finding whose `owner` was set by anything other than the path rule must
  // not be accepted here either — acceptance is the step that would make a
  // mislabel permanent in the evidence.
  const unverifiable = vendorFindings.filter((f) => {
    const rederived = ownerOf(f.target);
    return rederived.owner !== RISK_OWNER.VENDOR_REDHAT || rederived.binary !== f.vendorBinary;
  });
  if (unverifiable.length) {
    throw new Error(
      `vendor inherited-risk scope violation at acceptance: ${unverifiable.length} finding(s) do not re-derive ` +
        `to the vendor binary they claim — ${unverifiable
          .slice(0, 5)
          .map((f) => `${f.id}@${f.target}`)
          .join(", ")}`
    );
  }

  // COVERAGE. This is the check whose absence made the whole function
  // ornamental: an accepted finding must be inside an artifact the record
  // names.
  const uncovered = [...new Set(vendorFindings.map((f) => f.vendorBinary))].filter((b) => !byTool.has(b));
  if (uncovered.length) {
    throw new Error(
      `vendorRiskDisposition is accepting findings in ${uncovered.join(", ")} with no identity for ` +
        `${uncovered.length === 1 ? "that binary" : "those binaries"}. Identities supplied: ` +
        `${[...byTool.keys()].join(", ") || "none"}. Per-artifact acceptance means the artifact is named.`
    );
  }

  return {
    schemaVersion: 1,
    decision: "inherited-risk-accepted",
    scope: "unmodified, authentic official Red Hat binaries shipped verbatim",
    approvedBy: "project owner",
    decidedOn,
    appliesTo: toolIdentity.map((t) => ({ ...t })),
    // Stated positively so a reader of the evidence can see the coverage
    // relationship that was enforced, rather than having to trust it.
    coversBinaries: [...new Set(vendorFindings.map((f) => f.vendorBinary))].sort(),
    excludedFromScope: [
      "UBI base-image OS packages — this project's obligation to update",
      "npm dependencies — this project's obligation",
      "any code in this repository",
    ],
    findingCount: vendorFindings.length,
    findings: vendorFindings,
    effect: {
      suppressesFindings: false,
      reducesCounts: false,
      changesAxisVerdict: false,
      note:
        "This is an attribution and a recorded decision, not a waiver. image-vulnerabilities remains " +
        "non-waivable and continues to report every finding. The risk is accepted, which means it is " +
        "known and still present — not absent.",
    },
    riskStatement:
      "This release ships Red Hat's own `oc` and `oc-mirror` binaries unmodified. They carry known " +
      "upstream vulnerabilities that this project cannot fix without forking Red Hat's supported " +
      "artifacts, which would be worse for the operator than inheriting them. Both are already at the " +
      "newest release the Red Hat channels publish, so there is no newer artifact to adopt. The exact " +
      "version, architecture and SHA256 of every accepted binary is recorded above, so this acceptance " +
      "expires the moment the artifact changes.",
  };
}

/**
 * Guard: prove no project-owned finding has been attributed to the vendor.
 *
 * Called by the axis and asserted directly in tests. It exists because the
 * failure mode this module could introduce — an app or UBI finding quietly
 * accepted as inherited vendor risk — is exactly the one the approval
 * forbids, and it would be invisible in a summary that only showed totals.
 */
export function assertNoProjectFindingAccepted(attribution) {
  // RE-DERIVE ownership from the target and require it to agree.
  //
  // An earlier version of this guard keyed off the scanner's `Class`,
  // rejecting anything vendor-owned that was `lang-pkgs` or `os-pkgs`. That
  // was wrong in a way worth recording: Trivy reports the vendored Go binary
  // itself as `lang-pkgs`, so the guard failed every CORRECT attribution
  // while a genuine mislabel with the right Class would have slipped past.
  //
  // Re-deriving is the actual invariant. The attribution must be a pure
  // function of the path, so recomputing it has to produce the same answer;
  // any disagreement means the owner field was set by something other than
  // the path rule, which is precisely the tampering this guards against.
  const leaked = [];
  for (const f of attribution?.findings ?? []) {
    if (f.owner !== RISK_OWNER.VENDOR_REDHAT) continue;
    const rederived = ownerOf(f.target);
    if (rederived.owner !== RISK_OWNER.VENDOR_REDHAT || !f.vendorBinary || rederived.binary !== f.vendorBinary) {
      leaked.push(f);
    }
  }
  if (leaked.length) {
    throw new Error(
      `vendor inherited-risk scope violation: ${leaked.length} finding(s) owned by this project were ` +
        `attributed to the vendor — ${leaked
          .slice(0, 5)
          .map((f) => `${f.id}@${f.target}`)
          .join(", ")}`
    );
  }
  return true;
}

/* ───────────────────────────────────────────────────────────────────────────
 * THE PRODUCTION PATH
 *
 * Everything above this line was, until now, reachable only from its own test
 * file. `scripts/release/axes/image-vulnerabilities.mjs` imported
 * `attributeFindings` and `assertNoProjectFindingAccepted` and never the
 * disposition, so the owner's per-artifact acceptance — the record that says
 * WHICH binary, at WHICH version and digest, the inherited risk was accepted
 * for — was never emitted into release evidence at all. A correct function
 * nobody calls certifies nothing; this is the same class of defect as the
 * previously-fixed orphaned release gate, and it is closed the same way: by
 * giving it a caller on the real path and a test that proves the caller runs.
 *
 * The two functions below are that bridge. They are here rather than in the
 * axis because the mapping from an inventory record to an acceptance identity
 * is part of this module's vocabulary, and because keeping it here lets it be
 * tested without a container engine.
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * Map an external-binary inventory (`provenance/toolProvenance.mjs`
 * `externalBinaryInventory()`) onto the per-artifact identities
 * `vendorRiskDisposition` requires.
 *
 * Only `baked` records are eligible, and the exclusion is substantive rather
 * than convenient: a `runtimeAcquired` entry carries a `urlTemplate` with
 * `<arch>`/`<version>` still in it and no resolved digest, because the
 * artifact is fetched per request and no single one of them exists at
 * certification time. Feeding those in would be feeding the disposition the
 * placeholders it exists to reject.
 *
 * Returns `{ identities, excluded }`. `excluded` is always populated and
 * always carries a reason, so a reader of the evidence sees which binaries
 * were considered and set aside, instead of inferring it from a short list.
 */
export function identitiesFromInventory(inventory) {
  const identities = [];
  const excluded = [];

  for (const rec of inventory?.baked ?? []) {
    const identity = {
      tool: rec.tool,
      version: rec.version,
      architecture: rec.arch,
      sha256: rec.sha256,
      sourceUrl: rec.url,
      // Carried through because the digest's SUBJECT is the thing most easily
      // misread downstream: this is the checksum of Red Hat's distribution
      // tarball, not of the extracted binary in the image.
      checksumSubject: rec.checksumSubject ?? null,
      checksumCovers: rec.checksumCovers ?? null,
      checksumAuthority: rec.checksumAuthority ?? null,
      inImagePath: rec.path ?? null,
    };
    const missing = ["version", "architecture", "sha256", "sourceUrl"].filter((k) => !identity[k]);
    if (missing.length) {
      excluded.push({ tool: rec.tool, reason: `inventory record is missing ${missing.join(", ")}` });
      continue;
    }
    identities.push(identity);
  }

  for (const rec of inventory?.runtimeAcquired ?? []) {
    excluded.push({
      tool: rec.tool,
      reason:
        "acquired at request time, not installed into a shipped image — no single artifact exists to name at " +
        "certification time, and it can never match an image-scan finding",
    });
  }

  return { identities, excluded };
}

/**
 * Produce the vendor inherited-risk record for a certification run, or an
 * explicit statement of why there is none.
 *
 * FAIL-CLOSED DIRECTION. The absence of an acceptance is the safe state, so
 * every failure path here returns `accepted: false` with a reason rather than
 * throwing. Nothing downstream may read a missing or rejected record as an
 * acceptance, and no field is ever filled in optimistically: an inventory the
 * run could not read produces `NOT VERIFIED`, never a plausible-looking
 * record. This is deliberate — unexecuted checks in machine-readable evidence
 * must say NOT VERIFIED, and a fabricated PASS here would be the single most
 * misleading thing this file could emit.
 *
 * A REJECTION IS NOT AN ERROR TO BE SWALLOWED. If `vendorRiskDisposition`
 * refuses the inputs — an uncovered binary, a malformed digest, a duplicate —
 * that refusal is recorded verbatim in `reason` and surfaced in the evidence,
 * because it means the "N of M findings are not ours to fix" split currently
 * has no per-artifact backing.
 *
 * @param {object}   args
 * @param {object}   args.inventory    externalBinaryInventory() result, or null
 * @param {Array}    args.attributions `[{ role, attribution }]`, one per scanned image
 * @param {string?}  args.decidedOn    ISO date of the owner's decision
 */
export function vendorRiskRecord({ inventory = null, attributions = [], decidedOn = null } = {}) {
  const base = {
    schemaVersion: 1,
    purpose:
      "Per-artifact record of the owner's accepted inherited risk in unmodified official Red Hat binaries. " +
      "Attribution and a recorded decision only: it suppresses no finding, reduces no count and changes no " +
      "axis verdict.",
    decidedOn,
  };

  // Annotate each finding with the image it came from. The disposition passes
  // extra fields through untouched, and without this the record cannot say
  // which image a vendor finding was observed in.
  const vendorFindings = [];
  for (const { role = null, attribution = null } of attributions) {
    for (const f of attribution?.findings ?? []) {
      if (f.owner !== RISK_OWNER.VENDOR_REDHAT) continue;
      vendorFindings.push({ ...f, imageRole: role });
    }
  }

  if (vendorFindings.length === 0) {
    return {
      ...base,
      accepted: false,
      state: "not-applicable",
      reason:
        "no finding in this run was attributed to a vendored Red Hat binary, so there is no inherited risk to " +
        "accept. This is not an acceptance and must not be read as one.",
      findingCount: 0,
      coversBinaries: [],
    };
  }

  if (!inventory || inventory.complete !== true) {
    return {
      ...base,
      accepted: false,
      state: "NOT VERIFIED",
      reason:
        `${vendorFindings.length} finding(s) were attributed to vendored Red Hat binaries, but the external-binary ` +
        `inventory needed to name those artifacts is unavailable: ${inventory?.reason ?? "no inventory was produced"}. ` +
        "Per-artifact acceptance requires the exact version, architecture, digest and source URL of every binary " +
        "whose findings are accepted, so no acceptance is recorded.",
      findingCount: vendorFindings.length,
      coversBinaries: [...new Set(vendorFindings.map((f) => f.vendorBinary))].sort(),
    };
  }

  const { identities, excluded } = identitiesFromInventory(inventory);

  try {
    const disposition = vendorRiskDisposition({ toolIdentity: identities, findings: vendorFindings, decidedOn });
    return {
      ...base,
      accepted: true,
      state: "accepted",
      identitySource: "external-binary inventory measured from the shipping backend image at certification time",
      identitiesExcluded: excluded,
      disposition,
    };
  } catch (err) {
    return {
      ...base,
      accepted: false,
      state: "rejected",
      reason: `the per-artifact acceptance was refused: ${err.message}`,
      identitiesOffered: identities.map((i) => i.tool),
      identitiesExcluded: excluded,
      findingCount: vendorFindings.length,
      coversBinaries: [...new Set(vendorFindings.map((f) => f.vendorBinary))].sort(),
    };
  }
}
