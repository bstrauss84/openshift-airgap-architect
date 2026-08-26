# Versioned Copy Adjudication Ledger

**Updated:** 2026-08-26 (DOC-107 narrow adjudication revision)
**Tool:** `scripts/find-hardcoded-versions.sh --check`
**Phase 0 inventory:** DOC-106 (verified_done, commit 94b5b14)

---

## Enforcement

`scripts/find-hardcoded-versions.sh --check` exits nonzero for unclassified hardcoded version references in production frontend code. CI workflow: `.github/workflows/validate-versioned-copy.yml`.

Search pattern: `4\.([0-9]{2,})` — detects all OpenShift 4.x two-digit minors (4.10+), including unsupported/future versions.

---

## Resolved Violations

| File | Lines | Resolution | Commit |
|------|-------|------------|--------|
| `frontend/src/steps/HostInventoryStep.jsx` | 660, 701 | Version-neutral wording | dc871e4 |
| `frontend/src/steps/TrustProxyStep.jsx` | 971 | Version-neutral wording | dc871e4 |
| `frontend/src/steps/GlobalStrategyStep.jsx` | 1395 | Version-neutral wording | dc871e4 |
| `frontend/src/components/AboutModal.jsx` | 126 | `getNewestSupportedMinor()` docs URL | DOC-107 |
| `frontend/src/steps/HostInventoryV2Step.jsx` | 540 | Removed stale `(4.20)` from label | DOC-107 |
| `frontend/src/steps/HostInventoryV2Step.jsx` | 582 | Version-neutral wording | DOC-107 |
| `frontend/src/steps/HostInventoryV2Step.jsx` | 664 | Version-neutral wording | DOC-107 |
| `frontend/src/steps/PlatformSpecificsStep.jsx` | 962 | Version-neutral (removed "4.20 doc") | DOC-107 |
| `frontend/src/steps/PlatformSpecificsStep.jsx` | 1492 | Version-neutral wording | DOC-107 |
| `frontend/src/steps/PlatformSpecificsStep.jsx` | 3183 | Version-neutral ("recommended") | DOC-107 |
| `frontend/src/steps/PlatformSpecificsStep.jsx` | 4114 | Version-neutral (removed "4.20 doc") | DOC-107 |
| `frontend/src/steps/PlatformSpecificsStep.jsx` | 4678, 4709 | Version-neutral wording | DOC-107 |
| `frontend/src/steps/PlatformSpecificsStep.jsx` | 5165 | Dynamic `selectedMinor` (concatenation) | DOC-107 |
| `frontend/src/steps/NetworkingV2Step.jsx` | 443, 470, 491, 495, 576, 921, 943, 956, 1741, 1773 | Version-neutral wording (10 findings) | DOC-107 |
| `frontend/src/components/NodeDrawerAgentContent.jsx` | 776 | Version-neutral ("see §9.1.4") | DOC-107 |

---

---

## Adjudicated Exclusions

Each exclusion is tagged with a category code used by the `--check` guard. All adjudications use narrow, attributable patterns — no whole-file exclusions for user-facing components.

### INFRA — Enumerated Version Infrastructure Authority Files

These files define the version policy, parse version strings, or map versions to catalogs/docs. They are the authority, not the consumer. Each file is listed individually in the guard — new files added to `frontend/src/shared/` are NOT auto-excluded.

| File | Rationale |
|------|-----------|
| `frontend/src/shared/versionPolicy.js` | SUPPORTED_MINORS, trust bundle allowlists |
| `frontend/src/shared/catalogVersion.js` | Version parsing utility |
| `frontend/src/shared/cincinnatiChannels.js` | Channel filtering utility |
| `frontend/src/shared/openShiftMinor.js` | Minor version parser |
| `frontend/src/shared/versionHelpers.js` | Version helper utilities |
| `frontend/src/shared/trustBundlePolicy.js` | Trust bundle policy resolution |
| `frontend/src/docsIndexResolver.js` | Version → docs-index map |
| `frontend/src/catalogPaths.js` | Catalog path infrastructure |
| `frontend/src/catalogFieldMeta.js` | Catalog field metadata |
| `frontend/src/catalogResolver.js` | Catalog resolution infrastructure |

### CDEFLT — Code-Level Fallback Defaults

Lines matching `getOpenShiftMinorFromState(state) || "4.20"` provide a safe default when version state is absent. These are code logic, not user-facing copy.

| File | Lines |
|------|-------|
| `frontend/src/steps/HostInventoryV2Step.jsx` | 138 |
| `frontend/src/steps/IdentityAccessStep.jsx` | 31 |
| `frontend/src/steps/NetworkingV2Step.jsx` | 365 |
| `frontend/src/steps/TrustProxyStep.jsx` | 139 |
| `frontend/src/steps/ConnectivityMirroringStep.jsx` | 50 |

### COMMENT — JS Code Comments

Lines where the version reference appears only in `//`, `/**`, or `*` comments.

| File | Lines | Content |
|------|-------|---------|
| `frontend/src/hostInventoryV2Validation.js` | 53 | Agent-based topology reference |
| `frontend/src/steps/HostInventoryV2Step.jsx` | 236, 258 | SNO and arbiter topology references |
| `frontend/src/steps/NetworkingV2Step.jsx` | 396 | IPv4-only platform note |
| `frontend/src/validation.js` | 1517 | Bare Metal UPI docs reference |

### LOGIC — Version Comparison Code

Code logic that branches on version using `isVersionGTE`, `azureMinor ===`, `SUPPORTED_MINORS`, or `compareVersions`. These are version-gated behavior, not copy.

| File | Lines |
|------|-------|
| `frontend/src/validation.js` | 1997, 2016, 2099, 2103 |

### FMT — Format Examples

Version numbers used as format examples in user-facing validation messages and input placeholders. These show the expected pattern, not a version claim.

| File | Lines | Content |
|------|-------|---------|
| `frontend/src/validation.js` | 2272-2278 | `"must look like 4.20"`, `"e.g. 4.20, 4.21"` |
| `frontend/src/steps/BlueprintStep.jsx` | 520, 527, 532, 539 | Labels `(e.g. 4.20, 4.21)`, placeholders `4.21` |

### THRESH — PlatformSpecificsStep Feature-Introduction Threshold Notation

Threshold notation marks a feature available from a specific version onward. Guard enumerates exact adjudicated versions: **4.11, 4.12, 4.13, 4.20, 4.21 only** (via `4\.(11|12|13|20|21)\+`). A new threshold like "4.30+" or "4.22+" is NOT auto-exempted — it reaches the violation set. Deprecation matching is pinned to `4.13` only. Scoped to PlatformSpecificsStep only; new files are not auto-excluded.

| File | Lines | Content |
|------|-------|---------|
| `frontend/src/steps/PlatformSpecificsStep.jsx` | 699, 730, 3341, 3410, 4703 | `(OpenShift 4.20+)` threshold labels |
| `frontend/src/steps/PlatformSpecificsStep.jsx` | 920, 1735, 4589 | `(OpenShift 4.21+)` threshold labels |
| `frontend/src/steps/PlatformSpecificsStep.jsx` | 4902, 4954 | `OpenShift 4.11+` capability system |
| `frontend/src/steps/PlatformSpecificsStep.jsx` | 5155 | `4.13+` ExternalCloudProvider threshold |
| `frontend/src/steps/PlatformSpecificsStep.jsx` | 3213, 3220 | `Deprecated in OpenShift 4.13+`, `deprecated since OpenShift 4.13` |
| `frontend/src/steps/PlatformSpecificsStep.jsx` | 4909 | `v4.11 / v4.12 / etc.` baselineCapabilitySet presets |

### ENUMVAL — API Enum Values

API enum values containing version strings (e.g., `baselineCapabilitySet: "v4.20"`). Not user-facing copy. Guard pattern is file-scoped and version-pinned: `PlatformSpecificsStep\.jsx:.*baselineCapabilityOptions.*v4\.(11|12|20)` — only the `baselineCapabilityOptions` variable in PlatformSpecificsStep, and only adjudicated versions v4.11, v4.12, v4.20. A new `v4.30` enum value is NOT auto-exempted.

| File | Lines | Content |
|------|-------|---------|
| `frontend/src/steps/PlatformSpecificsStep.jsx` | 484 | `baselineCapabilitySet` enum value |

### VMAP — Version-Keyed Feature Maps

Data structures that map version → feature/operator sets, plus format examples distinguishing operator versions from OpenShift versions. Already version-aware by design. Guard pattern requires object-key syntax (`"4.XX":` with trailing colon) for version-map entries — a quoted 4.x string NOT in key position is not exempted.

| File | Lines | Content |
|------|-------|---------|
| `frontend/src/steps/OperatorsStep.jsx` | 85-128 | ODF Quick Pick version-keyed maps — object keys `"4.20": {...}` (exempted by trailing-colon syntax) |
| `frontend/src/steps/OperatorsStep.jsx` | 1123 | Counter-example: "not OpenShift 4.20" (exempted by `not OpenShift 4.` pattern) |
| `frontend/src/steps/OperatorsStep.jsx` | 1128, 1176 | Hint examples with minVersion/maxVersion version strings (exempted by keyword) |

### VGATED — Version-Gated Delta Descriptions (PlatformSpecificsStep)

User-facing text that accurately describes version-specific behavior AND is correctly version-gated via `isCatalogFieldVisible()`. Each reference is shown only when the user's selected OpenShift version matches. Guard patterns are pinned to the specific adjudicated versions (4.20, 4.21) — a new "required for OpenShift 4.30" is NOT auto-exempted.

| Lines | Content | Gate | Guard phrase |
|-------|---------|------|-------------|
| 1683 | "OpenShift 4.21 supports multiple node subnets" | `canAddNodeSubnet` (4.21+ catalog visibility) | `4\.21 supports multiple node subnet` |
| 1691 | "required for OpenShift 4.20" | Shown only when NOT `canAddNodeSubnet` (4.20) | `required for OpenShift 4\.20` |
| 1723 | Subnet count warning for 4.20 / upgrade guidance for 4.21 | `canAddNodeSubnet` gate | `4\.20 supports only one node subnet`, `Remove extras to generate for 4\.20`, `must use OpenShift 4\.21` |
| 4601 | "Availability: OpenShift 4.21 and later" | `showBmcVerifyCA` (4.21+ catalog visibility) | `OpenShift 4\.21 and later` |

### DOCSRC — PlatformSpecificsStep Doc-Source Citations (RESOLVED)

All 7 DOCSRC findings resolved via production edits in PlatformSpecificsStep.jsx. Catalog evidence confirms all claims are identical across 4.20 and 4.21. No guard exemption needed — these lines no longer match the search pattern.

| Lines | Original | Resolution |
|-------|----------|------------|
| 962 | `(4.20 doc: compute.platform.aws.rootVolume...)` | Version-neutral: `(see compute.platform.aws.rootVolume...)` |
| 1492 | `(per 4.20 doc; ...)` | Version-neutral: `(not used during initial provisioning)` |
| 3183 | `(recommended for 4.20)` | Version-neutral: `(recommended)` |
| 4114 | `(4.20 doc 9.1.6: ...)` | Version-neutral: `(see §9.1.6: ...)` |
| 4678, 4709 | `OpenShift 4.20 documentation (§9.1.5)` | Version-neutral: `OpenShift documentation (§9.1.5)` |
| 5165 | `See OpenShift 4.20 documentation` | Dynamic: `See OpenShift ` + selectedMinor + ` documentation` (concatenation) |

---

## Excluded from DOC-107 Scope

| Category | Rationale |
|----------|-----------|
| Field Guide (`backend/src/fieldGuide/v4.20/`, `v4.21/`) | Version-compartmented by directory. FG-DOCREF-MINOR is complete. |
| Catalog citations (~1,900 `docs.redhat.com` URLs in `data/`) | Version-specific by design; versioned with their catalogs. |
| Documentation (`docs/*.md`) | Intentionally versioned reference material. |

### Backend Code Attributable Classifications

Backend code (`backend/src/`) is outside the `--check` guard's frontend scope. The following attributable classification covers the ~35 version references found in backend source files. None are user-facing frontend copy; all are version infrastructure, logic, comments, or generated output.

| File | Lines | Category | Content |
|------|-------|----------|---------|
| `backend/src/generate.js` | 82, 111, 274, 312, 478, 517, 532, 559, 653, 775, 861 | COMMENT | JS code comments referencing version-specific installer behavior |
| `backend/src/generate.js` | 367, 469, 607, 611, 917, 943 | LOGIC | `isVersionGTE` version comparison guards |
| `backend/src/generate.js` | 1598 | CDEFLT | Fallback default version |
| `backend/src/generate.js` | 1890 | OUTPUT | Generated YAML output — version-derived from state |
| `backend/src/index.js` | 517 | COMMENT | JS code comment |
| `backend/src/index.js` | 3038, 3225 | LOGIC | Version comparison checks |
| `backend/src/openShiftMinor.js` | 2, 11, 12, 35, 36, 37 | COMMENT | JSDoc comments documenting version parsing |
| `backend/src/openshiftInstaller.js` | 137, 157, 292 | FMT | Format examples and comments |
| `backend/src/versionPolicy.js` | 17, 20, 21 | INFRA | `SUPPORTED_MINORS` and trust bundle maps |

---

## Guard Design

The `--check` mode searches `frontend/src/**/*.{js,jsx}` (excluding tests) for `4\.([0-9]{2,})`, then subtracts each adjudicated exclusion category in sequence using narrow, attributable patterns. Any remaining match is an unclassified violation that fails the guard.

Key design properties:
- **No whole-file exclusions** for user-facing components (PlatformSpecificsStep, NetworkingV2Step, OperatorsStep)
- **No directory-wide exclusions**: INFRA enumerates specific `shared/` authority files; new shared/ files are not auto-excluded
- **Enumerated THRESH**: threshold notation exempts only adjudicated versions (4.11, 4.12, 4.13, 4.20, 4.21) in PlatformSpecificsStep; "4.22+", "4.30+", or any other version reaches the violation set
- **Pinned VGATED**: version-gated phrases are pinned to specific versions ("required for OpenShift 4.20", "must use OpenShift 4.21"); "required for OpenShift 4.30" is NOT exempted
- **Object-key VMAP**: OperatorsStep version-map keys require trailing-colon syntax (`"4.XX":`); quoted versions in other positions are NOT exempted
- **All user-facing violations resolved**: NetworkingV2Step.jsx (10 findings) and NodeDrawerAgentContent.jsx (1 finding) resolved via version-neutral wording — guard passes clean
- **Future-version guarantee**: `bash scripts/find-hardcoded-versions.sh --self-test` runs 38 deterministic assertions (11 violation, 25 exemption, 2 structural) against synthetic fixtures using the exact `classify_raw` function shared with `--check`. Violations proven: "OpenShift 4.30+", "OpenShift 4.22+", "required for OpenShift 4.30", "Deprecated in OpenShift 4.30+", "must use OpenShift 4.30", "OpenShift 4.30 supports multiple node subnets", "baselineCapability v4.30", "Requires OpenShift 4.30 or later", "OpenShift 4.30 introduces new lifecycle", "OpenShift 4.30 and later", and user-facing copy in a non-adjudicated step file. Exemptions proven: all 9 adjudication categories (INFRA, CDEFLT, COMMENT, LOGIC, FMT, THRESH, ENUMVAL, VMAP, VGATED) with representative fixtures.
- **Narrow patterns**: each exclusion matches specific text phrases, not file names; new hardcoded version copy in adjudicated files still fails
- **CI execution**: `.github/workflows/validate-versioned-copy.yml` runs `--self-test` then `--check` in sequence; no dependency installation required

The audit mode (no args) writes a full-breadth scan to `$OAA_SUPERVISOR_SCRATCH` or `$TMPDIR` for investigation.
