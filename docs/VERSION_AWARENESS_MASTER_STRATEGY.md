# OpenShift Version-Awareness Master Strategy

**Version:** 1.0 DRAFT  
**Created:** 2026-05-29  
**Status:** Phase 1 Architecture Design - AWAITING APPROVAL  
**Target Release:** v2.0.0 (Breaking Change)  
**Scope:** OpenShift 4.20 (Baseline) → 4.21 (First Target)

---

## EXECUTIVE SUMMARY

### Current State
OpenShift Airgap Architect is hardcoded to **OpenShift 4.20**. All parameters (949 across 13 catalogs), validation rules (1398 tests), tooltips (87 fields), field guide content, and generated artifacts assume 4.20-era schemas and documentation.

### Target State
Fully version-aware application where:
- User selects and locks OpenShift minor version (4.20, 4.21, future 4.22+) on Blueprint page
- Entire app adapts to locked version: field visibility, validations, tooltips, docs links, generated YAML
- New OpenShift releases onboarded in **1-2 weeks** via semi-automated pipeline

### Scope Assessment
**MASSIVE ARCHITECTURAL EFFORT**

This is a **v2.0.0 BREAKING CHANGE** requiring:
- State schema v3 (version.locked structure replaces release.confirmed)
- Params JSON restructuring (per-version catalogs in subdirectories)
- UI/backend version-gating throughout codebase
- Field Guide compartmentalization (build on existing `v4.20/` structure)
- Test matrix expansion (1398 → ~2500-3000 tests for 2 versions)
- Import/export version manifests (required for compatibility)

**Estimated Effort:** 29-32 weeks (7-8 months) with existing scripts and field guide structure

### Critical Discovery
✅ **Field Guide already has version structure:** `backend/src/fieldGuide/v4.20/` directory exists with 8 compartment files (117KB total). This indicates prior architectural thinking about versioning and provides a major head start.

✅ **OCP 4.20 strong audit baseline:** DOC-082 audit (2026-05-20 to 2026-05-27) extracted 553 parameters from installer source, validated 949 catalog parameters, and created 18 reusable automation scripts.

✅ **Proven audit process:** `local-docs/AUDIT_AUTOMATION_GUIDE.md` (800+ lines) documents reproducible 3-phase process achieving 70% automation.

---

## SOURCE-OF-TRUTH HIERARCHY & CONFLICT RESOLUTION

### Authority Chain (Highest to Lowest)

**1. docs.redhat.com OpenShift Installation Documentation**
- **Authority:** User-facing supported behavior
- **Scope:** What users should configure, expected values, required/optional fields
- **Conflicts:** Docs supersede installer source for "supportedness" claims
- **Location:** Downloaded PDFs in `local-docs/ocp-4.{version}/docs/`
- **Examples:**
  - `Installing_on_vSphere-en-US.pdf`
  - `Installation_configuration-en-US.pdf`
  - `Disconnected_environments-en-US.pdf`

**2. Installer Source Code (openshift/installer GitHub)**
- **Authority:** Actual accepted fields, validation rules, defaults
- **Scope:** Go struct definitions, schema validation, installer behavior
- **Conflicts:** Installer source supersedes params for "what actually works"
- **Location:** `local-docs/ocp-4.{version}/installer/source/installer/pkg/types/`
- **Examples:**
  - `pkg/types/installconfig.go` (InstallConfig struct)
  - `pkg/types/agent/agent_config_type.go` (AgentConfig struct)
  - `pkg/types/validation/*.go` (Installer validation rules)

**3. Params Catalog (Normalized App Truth)**
- **Authority:** Reconciled source-of-truth after docs + installer audit
- **Scope:** What the app supports, metadata for UI/backend/validation
- **Conflicts:** Params reconcile docs + installer, with explicit support decisions
- **Location (Canonical):** `data/params/{version}/{scenario}.json`
- **Location (Mirrored):** `frontend/src/data/catalogs/{version}/{scenario}.json`
- **Schema:** `schema/catalog-parameter-schema.json` v2.0 (to be defined)

**4. Frontend Mirrored Catalogs (Derived, Not Canonical)**
- **Authority:** NONE - derived from canonical params via sync
- **Scope:** Browser-accessible copy for frontend validation/rendering
- **Conflicts:** Frontend catalogs NEVER supersede backend canonical
- **Sync:** `scripts/sync-catalogs.js` enforces MD5 parity
- **CI Rule:** Build fails if backend ↔ frontend catalogs diverge

**5. Current App Behavior (Implementation Reality, Not Truth)**
- **Authority:** Evidence of what currently works, not what should work
- **Scope:** Bugs, missing features, incorrect behavior all possible
- **Conflicts:** Implementation bugs do not define truth
- **Use:** AS-IS baseline for gap analysis, not specification

### Conflict Resolution Policy

**Scenario A: Docs vs Installer Source Disagree**
- **Example:** Docs say field X is optional, installer requires it
- **Resolution:** 
  1. Test with actual installer binary - what works?
  2. If installer strictly requires: mark `required: true`, add tooltip note "Documented as optional but installer requires"
  3. If installer accepts optional: mark `required: false`, trust installer
  4. Document discrepancy in `versionNotes` field
- **Tiebreaker:** Installer behavior wins (user must satisfy installer)

**Scenario B: Installer Source vs Params Catalog Disagree**
- **Example:** Installer defines field Y, params missing or wrong metadata
- **Resolution:**
  1. Installer source is authoritative for field existence
  2. Update params to match installer struct definition
  3. Add support decision: supported-ui, supported-backend-only, or docs-only-not-supported
- **Tiebreaker:** Installer source wins, params updated

**Scenario C: Frontend Catalog vs Backend Catalog Disagree**
- **Example:** Frontend has stale metadata, backend updated
- **Resolution:**
  1. Backend canonical params are authoritative
  2. Run `scripts/sync-catalogs.js` to overwrite frontend
  3. Investigate why sync failed (manual edit? CI bypass?)
- **Tiebreaker:** Backend canonical wins, frontend rebuilt

**Scenario D: Multiple Docs Sources Disagree**
- **Example:** Platform-specific doc says one thing, Installation_configuration doc says another
- **Resolution:**
  1. Platform-specific docs supersede general docs (more specific wins)
  2. Newer docs supersede older (if multi-version comparison)
  3. Installation guide supersedes other guides (most authoritative)
  4. Document ambiguity in param `versionNotes`
- **Tiebreaker:** Most specific, most authoritative, newest

**Scenario E: Version-Specific Conflicts**
- **Example:** Field Z required in 4.20 docs, optional in 4.21 docs
- **Resolution:**
  1. Create per-version metadata in params JSON
  2. Use `validationRules` object with version keys
  3. Both are correct for their respective versions
- **No conflict:** Version-specific metadata resolves

---

## FIELD SUPPORT-STATUS MODEL

### Status Taxonomy

Every parameter in the catalog **MUST** have an explicit `supportStatus` field:

**supported-ui**
- **Definition:** Full UI support - field has input control, validation, tooltip, flows to backend
- **UI Behavior:** Rendered as editable field
- **Backend:** Emitted to generated YAML when populated
- **Tests:** UI tests + validation tests + generation tests required
- **Example:** `baseDomain`, `platform.aws.region`, `networking.machineNetwork[0].cidr`

**supported-derived**
- **Definition:** No direct UI input, app calculates/derives value
- **UI Behavior:** May show in preview/summary, not editable
- **Backend:** Emitted to generated YAML based on derivation logic
- **Tests:** Generation tests + derivation logic tests required
- **Example:** `metadata.name` (derived from clusterName), `pullSecret` (merged from multiple sources)

**supported-backend-only**
- **Definition:** Backend emits field, no UI control needed (always default or computed)
- **UI Behavior:** Not shown in UI
- **Backend:** Always emitted with default/computed value
- **Tests:** Generation tests verify correct emission
- **Example:** `apiVersion: v1`, `kind: InstallConfig`, installer-managed networking defaults

**docs-only-not-supported**
- **Definition:** Documented in OCP docs but app intentionally does not support
- **UI Behavior:** Not shown
- **Backend:** Not emitted
- **Tests:** None (explicitly unsupported)
- **Reason:** Out of scope, edge case, or requires manual config
- **Example:** Advanced `ovnKubernetesConfig` tuning, `credentialsMode` variants

**hidden-not-applicable**
- **Definition:** Field exists in installer but not applicable to app's supported scenarios
- **UI Behavior:** Not shown
- **Backend:** Not emitted
- **Tests:** None
- **Reason:** Only relevant for scenarios app doesn't support (e.g., GCP, OpenStack)
- **Example:** `platform.gcp.*`, `platform.openstack.*`

**deprecated-supported**
- **Definition:** Deprecated in OCP but app still supports for backward compatibility
- **UI Behavior:** Shown with ⚠️ deprecation badge, tooltip explains replacement
- **Backend:** Emitted if user provides value (backward compatibility)
- **Tests:** Deprecation warning tests + migration path tests
- **Version Gating:** Only shown for versions where field still accepted
- **Example:** `platform.vsphere.cluster` (4.20, deprecated 4.14, use failureDomains)

**removed**
- **Definition:** Field removed from OCP installer, no longer accepted
- **UI Behavior:** Not shown for versions where removed
- **Backend:** Not emitted for versions where removed
- **Tests:** Version-gating tests ensure field hidden/not emitted
- **Version Gating:** `maxVersion` specifies last version that accepted field
- **Example:** `imageContentSources` (removed 4.17, use `imageDigestSources`)

**unknown-needs-review**
- **Definition:** Field found during audit, support decision pending
- **UI Behavior:** Not shown (default: hide until reviewed)
- **Backend:** Not emitted
- **Tests:** None yet
- **CI Rule:** **CI FAILS if any params have this status** (forces review)
- **Resolution:** Human review assigns one of above statuses

### CI Enforcement

**Pre-commit hook:**
```bash
# scripts/validate-param-support-status.js
for file in data/params/**/*.json; do
  if jq '.parameters[] | select(.supportStatus == "unknown-needs-review")' "$file" | grep .; then
    echo "ERROR: $file has params with unknown-needs-review status"
    echo "All params must have explicit support decision before commit"
    exit 1
  fi
  
  if jq '.parameters[] | select(.supportStatus == null)' "$file" | grep .; then
    echo "ERROR: $file has params without supportStatus field"
    exit 1
  fi
done
```

**GitHub Actions:**
```yaml
- name: Validate param support decisions
  run: node scripts/validate-param-support-status.js
```

### Support Status Migration (4.20 → 2.0.0)

**Current State:** No `supportStatus` field exists in params (v1.1.0 schema)

**Migration Required:**
1. Review all 949 existing params in 4.20 catalogs
2. Assign support status based on current behavior:
   - Has UI field? → `supported-ui`
   - No UI but emitted? → `supported-backend-only` or `supported-derived`
   - Not emitted? → `docs-only-not-supported` or `hidden-not-applicable`
3. Update schema to v2.0 with required `supportStatus` field
4. Add CI enforcement

**Effort:** 2-3 days (can use scripts to infer from current UI/backend, human review for edge cases)

---

## SCENARIO-TRUTH WORKFLOW INTEGRATION

Version-awareness **builds on** the existing scenario-truth workflow, not bypasses it.

### Existing Scenario-Truth Process (Proven in DOC-082)

**Phase 1: Documentation Collection**
- Download OCP docs (PDFs from docs.redhat.com)
- Clone installer source (release-{version} branch)
- Download binaries (openshift-install, oc-mirror)
- Extract text from PDFs
- Create workspace: `local-docs/ocp-{version}/`

**Phase 2: AS-IS Inventory**
- Extract parameters from installer Go structs
- Extract parameters from docs (tables, YAML examples)
- Create parameter inventory JSONs
- Cross-reference installer source vs docs

**Phase 3: Discrepancy Analysis**
- Compare extracted params vs current catalog
- Identify added/changed/removed fields
- Identify metadata discrepancies (type, required, default, allowed)
- Flag deprecated fields
- Flag breaking changes

**Phase 4: Reconciliation**
- Resolve discrepancies using source-of-truth hierarchy
- Update catalog with corrections
- Add new parameters with support decisions
- Mark deprecated fields
- Document conflicts in versionNotes

**Phase 5: Implementation Planning**
- Determine UI placement for new fields
- Plan backend generation changes
- Plan validation rule updates
- Plan tooltip updates
- Plan test coverage

### Version-Awareness Additions

**Phase 0: Baseline Certification (4.20)**
- ✅ Already mostly complete (DOC-082 audit)
- ⏳ Add supportStatus to all 949 params
- ⏳ Normalize all docs.openshift.com → docs.redhat.com
- ⏳ Validate current behavior matches catalog claims

**Phase 2.5: Version Delta Analysis (NEW for 4.21+)**
- Compare 4.21 vs 4.20 installer structs
- Compare 4.21 vs 4.20 docs
- Generate delta JSON:
  ```json
  {
    "added": [...],
    "removed": [...],
    "deprecated": [...],
    "typeChanged": [...],
    "requiredChanged": [...],
    "defaultChanged": [...],
    "allowedChanged": [...]
  }
  ```
- Assess breaking change severity
- Create migration guide

**Phase 4.5: Version Metadata Assignment (NEW)**
- Assign minVersion/maxVersion to all params
- Create validationRules per-version objects (sparse)
- Add versionNotes for changes
- Update deprecation metadata (deprecatedIn, replacementPath, removalVersion)

**Phase 5.5: Version-Gating Implementation (NEW)**
- Update UI to gate field visibility on version
- Update backend to gate YAML emission on version
- Update validation to gate rules on version
- Update tooltips with version annotations
- Update tests with version matrix

### Workflow Enforcement

**No shortcuts allowed:**
- Cannot add 4.21 support without completing Phases 1-5 for 4.21
- Cannot skip discrepancy analysis
- Cannot skip reconciliation
- Cannot implement without support decisions

**Quality gates:**
- Phase 1 → Phase 2: All docs/source downloaded and validated
- Phase 2 → Phase 3: Parameter inventory complete and cross-referenced
- Phase 3 → Phase 4: All discrepancies documented
- Phase 4 → Phase 5: All reconciliations reviewed and approved
- Phase 5 → Implementation: All planning docs reviewed and approved

---

## VERSION METADATA SCHEMA v2.0

### Catalog Parameter Schema Extensions

Building on `schema/catalog-parameter-schema.json` v1.1.0 (which added deprecation support):

**New Required Fields:**
```json
{
  "supportStatus": "supported-ui | supported-derived | supported-backend-only | docs-only-not-supported | hidden-not-applicable | deprecated-supported | removed | unknown-needs-review",
  "minVersion": "4.18",
  "maxVersion": null
}
```

**New Optional Fields:**
```json
{
  "versionNotes": "Changed from GB to GiB in 4.21; default changed from 100 to 120 in 4.20",
  "validationRules": {
    "4.20": {
      "required": true,
      "allowed": ["OVNKubernetes", "OpenShiftSDN"]
    },
    "4.21": {
      "required": true,
      "allowed": ["OVNKubernetes"]
    }
  }
}
```

**Existing Fields (v1.1.0):**
```json
{
  "deprecated": false,
  "deprecatedReason": null,
  "replacementPath": null,
  "removalVersion": null
}
```

### Complete Example

```json
{
  "path": "networking.networkType",
  "outputFile": "install-config.yaml",
  "type": "string",
  "supportStatus": "supported-ui",
  "minVersion": "4.11",
  "maxVersion": null,
  "allowed": ["OVNKubernetes", "OpenShiftSDN"],
  "default": "OVNKubernetes",
  "required": false,
  "deprecated": false,
  "description": "Container network interface (CNI) plugin...",
  "versionNotes": "Default changed from OpenShiftSDN to OVNKubernetes in 4.15; OpenShiftSDN removed from allowed values in 4.21",
  "validationRules": {
    "4.20": {
      "allowed": ["OVNKubernetes", "OpenShiftSDN"],
      "default": "OVNKubernetes"
    },
    "4.21": {
      "allowed": ["OVNKubernetes"],
      "default": "OVNKubernetes"
    }
  },
  "citations": [
    {
      "url": "https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/installation_configuration/index",
      "section": "Networking configuration parameters",
      "docTitle": "Installation configuration"
    }
  ]
}
```

### Sparse vs Dense validationRules

**Default: Sparse (RECOMMENDED)**
- Only store versions where validation rules **change**
- Inherit from base `allowed`, `default`, `required` fields if no version-specific rule
- Keeps JSON compact
- Example above: Only 4.20 and 4.21 listed because allowed values changed

**Dense: Every Version**
- Store validation rules for **all supported versions**
- Redundant but explicit
- Larger JSON files
- Use only if inheritance logic proves error-prone

**Recommendation:** Sparse with explicit inheritance rules in code

### Default Inheritance Rules

```javascript
function getValidationRules(param, version) {
  // Check for version-specific rules first
  if (param.validationRules?.[version]) {
    return param.validationRules[version];
  }
  
  // Fall back to base rules
  return {
    required: param.required,
    allowed: param.allowed,
    default: param.default,
    type: param.type
  };
}
```

---

## STATE SCHEMA v3 SPECIFICATION

### Current State Schema (v2 - Implicit)

```javascript
{
  release: {
    channel: "4.20",
    patchVersion: "4.20.22",
    confirmed: true,
    followLatestMinor: false
  }
}
```

### New State Schema (v3 - Explicit)

```javascript
{
  version: {
    selectedMinor: "4.21",           // User-selected minor version
    selectedPatch: "4.21.15",        // User-selected patch version (optional)
    selectedChannel: "stable-4.21",  // Cincinnati channel
    locked: true,                    // Version lock-in confirmed
    lockTimestamp: 1717000000000,    // When user locked version
    selectionTimestamp: 1716995000000, // When user first selected version
    confirmedByUser: true,           // User clicked "Lock Version" button
    
    // Backward compatibility during migration
    _migrated: true,                 // Indicates migration from v2 completed
    _previousChannel: "4.20"         // Original release.channel if migrated
  },
  
  // Old release field DEPRECATED - kept for backward compat during migration
  release: {
    channel: "4.21",                 // Synced with version.selectedMinor
    patchVersion: "4.21.15",         // Synced with version.selectedPatch
    confirmed: true                  // Synced with version.locked
  }
}
```

### Migration Strategy (v2 → v3)

**Automatic Migration on App Load:**
```javascript
function migrateStateV2toV3(state) {
  // If version object already exists and marked migrated, no-op
  if (state.version?._migrated) {
    return state;
  }
  
  // Migrate from release to version
  const newState = {
    ...state,
    version: {
      selectedMinor: state.release?.channel || "4.20",
      selectedPatch: state.release?.patchVersion || "4.20.0",
      selectedChannel: state.release?.channel ? `stable-${state.release.channel}` : "stable-4.20",
      locked: state.release?.confirmed || false,
      lockTimestamp: state.release?.confirmationTimestamp || Date.now(),
      selectionTimestamp: Date.now(),
      confirmedByUser: state.release?.confirmed || false,
      _migrated: true,
      _previousChannel: state.release?.channel
    },
    // Keep release for backward compat (sync'd)
    release: {
      channel: state.release?.channel || "4.20",
      patchVersion: state.release?.patchVersion || "4.20.0",
      confirmed: state.release?.confirmed || false
    }
  };
  
  return newState;
}
```

**State Persistence:**
- Backend: `/api/state` saves v3 schema
- Import: Detect v2 vs v3, auto-migrate v2 → v3
- Export: Always export v3 (version-manifest.json belongs to the generated artifact ZIP surface; see M01 contract below)

---

## EXPORT/IMPORT PRODUCT SURFACES AND VERSION-MANIFEST CONTRACT

**M01 Contract Freeze — Documentation Only (2026-09-15)**

This section defines the frozen implementation-ready contract for the two distinct export/import product surfaces and the future version-manifest. M01 freezes documentation only. Implementation, checksum code, manifest generation, archive import surfaces, and tests belong to later milestones and must not be marked complete here.

### Surface Classification

The application has two distinct export surfaces that must not be conflated:

**1. JSON Run Envelope (State Portability)**
- Routes: `GET /api/run/export` (produces JSON), `POST /api/run/import` (consumes JSON)
- Purpose: State persistence, sharing, and legacy migration
- Format: JSON response/request body — NOT a ZIP archive
- Current envelope fields: `schemaVersion` (integer, currently 2), `exportedAt` (ISO timestamp), `runId`, `state` (sanitized migrated-v3 state), `migrated` (boolean)
- State migration: `migrateStateToV3()` applied at both export and import boundaries; v1/v2 state auto-migrates to v3
- Credential handling: `sanitizeStateForExport()` strips sensitive data before export
- Does NOT carry `version-manifest.json` — state portability and version-manifest are separate concerns
- Does NOT produce or consume ZIP archives

**2. Generated Artifact ZIP (Deployment Bundle)**
- Routes: `POST /api/bundle.prepare` (issues token) → `GET /api/bundle.zip` (tokenized download); `POST /api/bundle.zip` (direct download)
- Purpose: Downloadable deployment artifacts for OpenShift installation
- Format: ZIP archive produced by `buildBundleZip()`
- Current contents: `install-config.yaml`, `agent-config.yaml` (conditional), `imageset-config.yaml`, `FIELD_MANUAL.md`, NTP MachineConfig YAMLs (conditional), `DRAFT_NOT_VALIDATED.txt` (conditional), optional tool binaries under `tools/`, optional mirror output, optional runtime package
- Does NOT currently contain `state.json` or `version-manifest.json`
- This surface will later receive `version-manifest.json` and integrity checksums per the contract below

### Future version-manifest.json Contract (Frozen)

The following contract is frozen for later implementation in the generated artifact ZIP surface only.

**ZIP placement:** `version-manifest.json` at the archive root, alongside generated YAML artifacts.

**Complete checksum coverage: every non-manifest file in the ZIP must have a checksum entry.** The `integrity.files` mapping must contain an entry for every file present in the archive except `version-manifest.json` itself. Conditional files (e.g., `agent-config.yaml`) that are absent from a given ZIP must not appear in the manifest; conditional files that are present must have a checksum entry. Nested entries (e.g., MachineConfig YAML files under subdirectories) must also have checksum entries keyed by their full ZIP entry path. The manifest must not include a checksum of itself.

**State exclusion:** The ZIP does not contain `state.json` unless a separate approved product decision later adds state export to the ZIP. Until such a decision, the manifest must not contain a `stateChecksum` entry or a required `state.json` reference. State portability remains the JSON run envelope's responsibility.

#### version-manifest.json Schema (Frozen)

```json
{
  "manifestSchemaVersion": "1.0.0",
  "generated": {
    "timestamp": "2026-09-15T10:00:00.000Z",
    "appIdentity": {
      "version": "<from /api/build-info identity surface (backend/package.json version) at runtime>",
      "commit": "<git commit SHA if available at runtime>",
      "buildTime": "<ISO timestamp if available at runtime>"
    },
    "stateSchemaVersion": 3
  },
  "openshift": {
    "selectedMinor": "4.21",
    "selectedPatch": "4.21.15",
    "lockedVersion": true
  },
  "compatibility": {
    "minimumManifestSchemaVersion": "1.0.0",
    "stateFormatCompatible": [3],
    "warnings": []
  },
  "integrity": {
    "algorithm": "sha-256",
    "format": "lowercase-hex",
    "files": {
      "install-config.yaml": "sha256:abcdef0123456789...",
      "agent-config.yaml": "sha256:0123456789abcdef...",
      "imageset-config.yaml": "sha256:fedcba9876543210...",
      "FIELD_MANUAL.md": "sha256:1234567890abcdef..."
    }
  }
}
```

#### Identity and Version Separation

The manifest contains four distinct version/identity concepts that must remain separate:

| Field | Meaning | Source | Example |
|---|---|---|---|
| `manifestSchemaVersion` | Manifest schema/format version | Hardcoded in manifest generation code | `1.0.0` |
| `generated.appIdentity.version` | OAA application version | `/api/build-info` identity surface (`backend/package.json` → `version`) | `2.0.0-dev`, `2.0.0-rc.1`, `2.0.0` |
| `generated.stateSchemaVersion` | State schema version | `_schemaVersion` from migrated state | `3` |
| `openshift.selectedMinor` | OpenShift target version | `state.version.selectedMinor` | `4.21` |

- `manifestSchemaVersion` starts at `1.0.0` and increments independently when the manifest schema changes. It is NOT the OAA application SemVer.
- `generated.appIdentity.version` must read from the same source as `/api/build-info`: `backend/package.json` `version` field. This is the single deterministic identity surface — no VERSION-file-or-package.json ambiguity. It must not silently claim bare `2.0.0` while the application identity is `2.0.0-dev`. The application identity progression (`2.0.0-dev` → `2.0.0-rc.N` → `2.0.0`) is owned by the release process, not the manifest generator.
- `generated.stateSchemaVersion` reflects the state schema at export time (currently `3`). Unknown schemas (> 3) are already blocked at all boundaries per `shared/stateMigration.js`.
- `openshift.selectedMinor`/`selectedPatch` reflect the user's locked OpenShift version selection.

#### Checksum Semantics (Frozen)

- **Algorithm:** SHA-256 over the exact archived file bytes (the file content as stored in the ZIP entry, not the compressed byte stream)
- **Format:** Lowercase hexadecimal, consistently prefixed with `sha256:` (e.g., `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`)
- **Mapping:** `integrity.files` is a stable mapping keyed by exact ZIP entry name (e.g., `install-config.yaml`, `FIELD_MANUAL.md`)
- **Conditional files:** Omit entries for conditional files that are absent from the ZIP. If `agent-config.yaml` is not generated for a given scenario, the manifest omits that key entirely.
- **Self-exclusion:** The manifest must not include a checksum of itself (`version-manifest.json` is not listed in `integrity.files`)
- **Stability:** File content is finalized before checksum computation. The manifest is the last file added to the ZIP.

### ZIP Creation Requirements

- The user must have a **locked, supported** OpenShift version (`state.version.locked === true`, `state.version.selectedMinor` in `SUPPORTED_MINORS`) before ZIP creation proceeds
- Unsupported versions (4.22+) must return the established HTTP 422 UNSUPPORTED_VERSION response. The no-fallback rule applies: the bundle must not silently fall back to 4.21 or any other version.
- The locked version is recorded in the manifest's `openshift` section

### Import Behavior

**Current JSON run import (`POST /api/run/import`):**
- Accepts a JSON body matching `runImportSchema` (Zod-validated: `schemaVersion` 1–2 optional, `state` object required, `exportedAt`/`runId` optional)
- Does NOT accept ZIP archives
- Performs v1/v2→v3 state migration via `migrateStateToV3()`
- Performs host inventory schema migration (`enableIpv6` → `ipStackMode`)
- Detects operator version staleness
- Sanitizes and persists the migrated state
- Does NOT validate or expect a version manifest
- Legacy JSON imports without a manifest continue through the existing explicit migration path; they must not be mislabeled as corrupted archives

### Manifest-Bearing Archive Import HTTP Contract (M03 Design Freeze — 2026-09-16)

This section freezes the API and persistence semantics for a manifest-bearing ZIP upload. M03 route implementation, Express middleware, and integration tests are implemented. M03 implementation and deterministic validation are complete and human-checkpointed at 0ca11266d032dc0216bdc5c4895a5d41984f5dbc. Post-commit certification verified: bundle-import 27/27 pass, import-integrity 174/174 pass, export-integrity 25/25 pass, full backend 1705 pass / 0 fail / 5 todo, git diff --check exit 0, clean working tree. All certification return codes zero (bundle=0, import=0, export=0, full=0, diff=0, clean=0). Persistence/import product semantics resolved: validation-only by design — the generated ZIP contains no `state.json`, so archive import is integrity validation only. Non-persistence contract tests in `backend/test/bundle-import.test.js` prove no filesystem mutation, no state persistence, and idempotent response. DOC-104 remains active/partial (broader testing work outstanding beyond M03).

#### Endpoint

**`POST /api/bundle.import`** — archive validation endpoint, distinct from `POST /api/run/import`.

The `bundle.*` namespace is established by existing routes (`POST /api/bundle.prepare`, `GET /api/bundle.zip`, `POST /api/bundle.zip`). The new endpoint belongs to the generated-artifact ZIP surface, not the JSON run envelope surface.

The existing JSON run import route (`POST /api/run/import`) is unchanged. It must never be subjected to archive-manifest validation. Legacy JSON run imports without a manifest continue through the existing explicit v1/v2→v3 migration path; they must not be mislabeled as corrupted archives.

#### Request Format

- **Content-Type:** `application/zip` (primary). `application/octet-stream` is also accepted. The endpoint does not accept `multipart/form-data`, `application/json`, or any other media type.
- **Body:** Raw ZIP bytes. The request body is the complete ZIP archive, not a multipart upload, not a JSON wrapper, and not a base64-encoded string. The endpoint uses `express.raw()` middleware, not `express.json()`. The global `express.json({ limit: "10mb" })` middleware (line 105 of `backend/src/index.js`) must not apply to this route.
- **Request-size limit:** 536,870,912 bytes (512 MiB). This is the exact value of `ZIP_LIMITS.MAX_ARCHIVE_BYTES` in `backend/src/exportIntegrity.js` (line 41: `512 * 1024 * 1024`). The Express body-parser limit must equal this value. The body-parser limit must never exceed the validator's archive size limit — the validator is the authoritative size boundary.

#### Processing Pipeline

The route passes the unchanged `req.body` buffer directly to `validateArchiveBuffer(buffer)` from `backend/src/exportIntegrity.js`. All validation — ZIP structure parsing, EOCD/central-directory verification, stored/deflate decompression, CRC32 verification, entry name safety, resource limit enforcement, ZIP64/encryption/symlink rejection, manifest extraction, manifest schema validation, state schema compatibility, OpenShift version support, checksum verification, and file coverage completeness — is performed by the existing validator. The route must not add, bypass, or weaken any validation step.

No pre-processing, transformation, or partial parsing of the ZIP buffer occurs before `validateArchiveBuffer`. The buffer is passed as received from the HTTP body.

#### M03 Persistence Semantics: Validation-Only

Successful validation produces no side effects:

- **No state import:** The validated archive contents are not imported into application state. No call to `setState()`, `updateState()`, or any state-mutating function.
- **No `/api/state` write:** The SQLite state table is not modified.
- **No run creation or update:** No `createJob()`, `updateJob()`, or run-lifecycle mutation.
- **No filesystem extraction:** Archive entries are not written to disk. The validator operates entirely in-memory.
- **No durable archive persistence:** The uploaded ZIP is not stored, cached, or written to any filesystem path.

The response confirms validation outcome only. Any later workflow that consumes, persists, extracts, or imports validated archive artifacts requires a separately approved product contract and is outside M03 scope.

#### Success Response

**HTTP 200** with a bounded JSON validation result:

```json
{
  "valid": true,
  "manifestSchemaVersion": "1.0.0",
  "stateSchemaVersion": 3,
  "selectedMinor": "4.21",
  "fileCount": 5
}
```

The response contains exactly the five fields returned by the current validator (`valid`, `manifestSchemaVersion`, `stateSchemaVersion`, `selectedMinor`, `fileCount`) — non-sensitive manifest/version/entry summary information only. The response must NOT include:

- `manifest` — the full parsed manifest object
- `entries` — archived file contents (buffers)
- Any raw archived file content, checksums, or file names beyond the count
- Stack traces, internal paths, or filesystem details

#### Error Response Contract

Error responses fall into two categories by origin:

**Validator errors** (from `validateArchiveBuffer` thrown errors): The route catches errors thrown by the validator and maps them to the appropriate HTTP status. The `code` field preserves the validator's existing machine-readable error code (e.g., `INVALID_ARCHIVE`, `UNSUPPORTED_VERSION`). The `error` field carries a human-readable message derived from the validator error's `message` property.

**Route-layer errors** (generated by the HTTP route itself): Wrong media type, oversized body parser rejection, empty body, and unexpected internal failures are detected before or outside the validator. These receive deterministic route-layer codes defined by this contract (`WRONG_MEDIA_TYPE`, `PAYLOAD_TOO_LARGE`, `EMPTY_BODY`, `INTERNAL_ERROR`).

All error responses use the `{ error, code }` JSON shape. No stack traces, raw archived content, internal file paths, or filesystem details are exposed in any error response.

| HTTP Status | Origin | Condition | Error Codes |
|---|---|---|---|
| **415 Unsupported Media Type** | Route-layer | `Content-Type` is not `application/zip` or `application/octet-stream` | `WRONG_MEDIA_TYPE` |
| **413 Payload Too Large** | Route-layer | Request body exceeds 512 MiB limit — the implementation must intercept raw-body parser size errors and return a deterministic `{ error, code }` JSON response; Express's default HTML error page must not be exposed | `PAYLOAD_TOO_LARGE` |
| **400 Bad Request** | Route-layer | Empty or missing request body | `EMPTY_BODY` |
| **400 Bad Request** | Validator | Malformed or integrity-invalid archive: corrupt ZIP structure, CRC32 failure, checksum mismatch, missing/malformed/self-referencing manifest, invalid checksum format/algorithm, missing or unlisted file coverage, duplicate or colliding entry names, unsafe entry names (path traversal, null bytes, backslashes, absolute paths, Windows drive paths, file-directory ambiguity), unsupported ZIP features (ZIP64, encryption, multi-disk, symlinks), ZIP resource limits exceeded (entry count > 10,000; individual uncompressed > 256 MiB; total uncompressed > 1 GiB) | `INVALID_ARCHIVE`, `CRC32_MISMATCH`, `CHECKSUM_MISMATCH`, `MALFORMED_MANIFEST`, `MISSING_MANIFEST`, `MULTIPLE_MANIFESTS`, `MANIFEST_SELF_REFERENCE`, `INVALID_CHECKSUM_FORMAT`, `INVALID_CHECKSUM_ALGORITHM`, `MISSING_FILE`, `UNLISTED_FILE`, `DUPLICATE_ENTRY`, `NAME_COLLISION`, `UNSAFE_ENTRY_NAME`, `UNSUPPORTED_ZIP_FEATURE`, `ARCHIVE_LIMIT_EXCEEDED` |
| **422 Unprocessable Entity** | Validator | Unsupported OpenShift version, manifest schema, or state schema compatibility; incompatible manifest schema; unlocked version | `UNSUPPORTED_VERSION`, `UNSUPPORTED_MANIFEST_SCHEMA`, `INCOMPATIBLE_STATE_SCHEMA`, `INCOMPATIBLE_MANIFEST_SCHEMA`, `UNLOCKED_VERSION` |
| **500 Internal Server Error** | Route-layer | Unexpected internal error during validation | `INTERNAL_ERROR` — see 500 response shape below |

The 400 vs 422 distinction follows existing repository conventions: 400 for structurally invalid input (the archive itself is broken), 422 for structurally valid input that fails domain-specific compatibility checks (the archive is well-formed but targets an unsupported version or schema).

**HTTP 500 response shape:**

```json
{
  "error": "Internal validation error",
  "code": "INTERNAL_ERROR",
  "errorId": "err_<uuid>"
}
```

The `errorId` field is generated by `generateErrorId()` (format `err_<uuid>`, defined in `backend/src/logger.js`). The same `errorId` is logged server-side with the full error details for operational correlation. The response must not include stack traces, exception messages, raw archived content, internal paths, or filesystem details — only the stable `error`, `code`, and `errorId` fields.

#### Existing Route Isolation

The following routes are explicitly unaffected by this contract:

- `POST /api/run/import` — JSON run envelope import. Accepts `application/json`, validates against `runImportSchema` (Zod), performs v1/v2→v3 state migration, persists state. Not subject to archive-manifest validation.
- `POST /api/bundle.prepare` / `GET /api/bundle.zip` / `POST /api/bundle.zip` — Bundle generation and download. These produce ZIP archives; they do not consume them.
- `POST /api/state` — State update. JSON body, Zod-validated, with version-support and migration checks.

#### Future Scope (Outside M03)

Any workflow that goes beyond validation-only — including but not limited to state import from validated archives, archive persistence to disk, run creation from archive contents, selective file extraction, or integration with existing import/export state flows — requires a separately approved product contract. Such workflows are outside M03 and must not be implemented under this contract.

### Fail-Closed Conditions for Archive Import

All conditions below are enforced by `validateArchiveBuffer` and `validateArchiveManifest` in `backend/src/exportIntegrity.js`. The route surfaces these as the HTTP error codes documented above. The following conditions are fail-closed (reject with a clear error, do not proceed):

1. **Checksum mismatch:** Any file listed in `integrity.files` whose computed SHA-256 does not match the manifest value
2. **Malformed manifest:** `version-manifest.json` is present but fails JSON parse or does not conform to the manifest schema
3. **Unsupported manifest schema:** `manifestSchemaVersion` is higher than the importer understands
4. **Incompatible state schema:** `generated.stateSchemaVersion` is not in the importer's compatible set
5. **Unsupported OpenShift version:** `openshift.selectedMinor` is not in `SUPPORTED_MINORS`
6. **Missing required manifest:** The archive does not contain `version-manifest.json` at the expected root location
7. **Missing checksum coverage:** A file exists in the archive that has no corresponding entry in `integrity.files` (every non-manifest file must be covered)
8. **Unlisted file entry:** The archive contains a file not accounted for by the manifest (neither in `integrity.files` nor `version-manifest.json` itself)
9. **CRC32 mismatch:** Decompressed entry data does not match the declared CRC32 in the ZIP central directory
10. **Unsafe entry name:** Entry name contains path traversal, null bytes, backslashes, absolute paths, Windows drive-absolute paths, or file-directory ambiguity
11. **Unsupported ZIP feature:** Archive uses ZIP64, encryption, multi-disk spanning, or symlinks
12. **Unlocked version:** `openshift.lockedVersion` is not `true` in the manifest

Legacy JSON run imports (via `POST /api/run/import`, without a manifest) continue through the existing explicit v1/v2→v3 migration path. The fail-closed conditions above apply only to manifest-bearing archives; manifest-less JSON run imports are a separate product surface and are not subject to archive integrity rules.

### M01–M03 Integrity Milestone Summary (2026-09-17)

The export/import integrity foundation is complete through three milestones:

| Milestone | Commit | Scope | Status |
|---|---|---|---|
| M01 | 47e27d7 | Contract freeze: surface classification, manifest schema, checksum semantics, fail-closed conditions — documentation only | Accepted |
| M02 | 8e3504d | version-manifest.json generation integrated into `buildBundleZip`; SHA-256 checksums; 25 tests | Accepted |
| M03 | 0ca1126 | `POST /api/bundle.import` validation-only endpoint; validation-core 174 tests + HTTP 27 tests; human-checkpointed; archive-import semantics resolved as validation-only | Accepted/checkpointed |

**Post-M03 documentation commits:** 93c958b (M03 closure evidence reconciliation across three canonical documents), 94e0cb3 (DOC-127 backlog item creation), 1d3b2e4 (DOC-127 integrity provenance correction). These are docs-only and do not constitute a separate milestone.

**No M01–M03 implementation is reopened by this summary.** DOC-127 (frontend productization of the M03 backend capability) is tracked separately in `docs/BACKLOG_STATUS.md` and is non-blocking for application-code GA unless a human changes priority.

**Residual GA register:** See `docs/VERSION_AWARENESS_COMPLETION_MATRIX.md` Section K for the complete application-code GA obligation classification.

---

## VERSION-GATING STRATEGY

### Minor Version Gating (Default)

**Granularity:** OpenShift minor versions (4.20, 4.21, 4.22)

**Rationale:**
- Installer schemas stable within minor versions
- Params added/removed/changed at minor boundaries
- Patch versions (4.21.0 vs 4.21.15) rarely affect schemas
- Simpler to maintain (fewer version checks)

**Implementation:**
```javascript
function isFieldAvailable(paramPath, minorVersion) {
  const param = getParamMeta(paramPath);
  const userMinor = minorVersion; // e.g., "4.21"
  
  if (param.minVersion && userMinor < param.minVersion) {
    return false; // Field not yet added
  }
  
  if (param.maxVersion && userMinor > param.maxVersion) {
    return false; // Field removed
  }
  
  return true;
}
```

### Patch-Level Gating (Exception-Only)

**When to Use:**
- **Documented installer bugs:** Field broken in 4.21.0-4.21.3, fixed in 4.21.4+
- **Security vulnerabilities:** Field usage dangerous until patched
- **Hard incompatibilities:** YAML validation breaks in specific patch range

**Implementation:**
```json
{
  "path": "platform.example.buggyField",
  "minVersion": "4.21",
  "patchLevelRules": {
    "4.21.0-4.21.3": {
      "disabled": true,
      "disabledReason": "Known installer bug - field ignored (fixed in 4.21.4)"
    }
  }
}
```

**Validation:**
```javascript
function isPatchRangeBroken(param, minorVersion, patchVersion) {
  const rules = param.patchLevelRules;
  if (!rules) return false;
  
  for (const [range, rule] of Object.entries(rules)) {
    if (isInPatchRange(patchVersion, range) && rule.disabled) {
      return rule.disabledReason;
    }
  }
  return false;
}
```

**Default:** Do NOT add patch-level gating unless evidence proves it necessary.

---

## PARAMS DIRECTORY STRUCTURE

### Version Subdirectories (APPROVED)

**Structure:**
```
data/params/
├── 4.20/
│   ├── aws-govcloud-ipi.json
│   ├── aws-govcloud-upi.json
│   ├── azure-government-ipi.json
│   ├── azure-government-upi.json
│   ├── bare-metal-agent.json
│   ├── bare-metal-ipi.json
│   ├── bare-metal-upi.json
│   ├── ibm-cloud-ipi.json
│   ├── nutanix-ipi.json
│   ├── vsphere-agent.json
│   ├── vsphere-ipi.json
│   ├── vsphere-upi.json
│   └── oc-mirror-v2.json
└── 4.21/
    ├── aws-govcloud-ipi.json
    ├── ... (same 13 files)
    └── oc-mirror-v2.json
```

**Frontend Mirror:**
```
frontend/src/data/catalogs/
├── 4.20/
│   └── [13 files - exact copies]
└── 4.21/
    └── [13 files - exact copies]
```

**Docs-Index:**
```
data/docs-index/
├── 4.20.json
└── 4.21.json

frontend/src/data/docs-index/
├── 4.20.json
└── 4.21.json
```

### Migration from Current (4.20-only)

**Current:**
```
data/params/4.20/*.json  ✅ Already correct!
```

**No migration needed for 4.20** - structure already matches target.

**Adding 4.21:**
```bash
# After Phase 2 audit completes:
mkdir -p data/params/4.21/
# Copy candidate JSONs from audit process
cp local-docs/ocp-4.21/catalogs/*.json data/params/4.21/

# Sync to frontend
node scripts/sync-catalogs.js 4.21
```

### Catalog Resolver Updates

**Current:**
```javascript
// frontend/src/catalogPaths.js
export function getCatalogForScenario(scenarioId) {
  return require(`./data/catalogs/${scenarioId}.json`);
}
```

**Enhanced (Version-Aware):**
```javascript
// frontend/src/catalogPaths.js
export function getCatalogForScenario(scenarioId, version = "4.20") {
  const minorVersion = version.split(".").slice(0, 2).join(".");
  return require(`./data/catalogs/${minorVersion}/${scenarioId}.json`);
}
```

**Backend:**
```javascript
// backend/src/catalogResolver.js
const path = require("path");

function loadCatalog(scenarioId, version = "4.20") {
  const catalogPath = path.resolve(
    __dirname,
    `../../data/params/${version}/${scenarioId}.json`
  );
  return require(catalogPath);
}
```

---

## HYBRID VALIDATION MODEL

### Metadata-Driven Validation (90% of Cases)

**Simple Rules via Catalog Metadata:**
- Required vs optional
- Allowed enum values
- Type checking (string, integer, boolean, CIDR, IPv4, IPv6)
- Defaults
- Min/max constraints
- Deprecation warnings
- Replacement suggestions

**Implementation:**
```javascript
function validateFromMetadata(paramPath, value, version) {
  const param = getParamMeta(paramPath, version);
  const rules = getValidationRules(param, version);
  const errors = [];
  
  // Required check
  if (rules.required && !value) {
    errors.push({
      field: paramPath,
      error: `Required in OpenShift ${version}`,
      severity: "error"
    });
  }
  
  // Type check
  if (value && !isValidType(value, param.type)) {
    errors.push({
      field: paramPath,
      error: `Must be ${param.type}`,
      severity: "error"
    });
  }
  
  // Allowed values check
  if (value && rules.allowed?.length && !rules.allowed.includes(value)) {
    errors.push({
      field: paramPath,
      error: `Invalid value. Allowed: ${rules.allowed.join(", ")}`,
      severity: "error"
    });
  }
  
  // Deprecation warning
  if (param.deprecated && value) {
    errors.push({
      field: paramPath,
      error: `Deprecated in ${param.deprecatedIn}. Use ${param.replacementPath} instead.`,
      severity: "warning"
    });
  }
  
  return errors;
}
```

### Function-Based Validation (10% of Cases)

**Complex Rules Requiring Code:**
- Cross-field validation (e.g., VIPs must be in machine network CIDR)
- Platform-specific rules (e.g., vSphere requires vCenter OR failureDomains)
- Mutually exclusive fields (e.g., imageContentSources XOR imageDigestSources)
- Conditional requirements (e.g., proxy CA required if httpsProxy uses custom CA)
- Format validation beyond simple types (e.g., AWS ARN format)
- Version-specific breaking changes (e.g., Agent SNO requires platform: none in 4.20+)

**Implementation:**
```javascript
// validation.js
const VERSION_VALIDATORS = {
  "4.20": {
    validateVipsInMachineNetwork,
    validateAgentSNOPlatformNone,
    validateProxyCertificates,
    validateMirrorRegistryTrust
  },
  "4.21": {
    validateVipsInMachineNetwork,      // Inherited from 4.20
    validateAgentSNOPlatformNone,      // Inherited
    validateProxyCertificates,         // Inherited
    validateMirrorRegistryTrust,       // Inherited
    validateOVNKubernetesOnly          // NEW in 4.21
  }
};

function runVersionSpecificValidation(state, version) {
  const validators = VERSION_VALIDATORS[version] || VERSION_VALIDATORS["4.20"];
  const errors = [];
  
  for (const validator of Object.values(validators)) {
    errors.push(...validator(state, version));
  }
  
  return errors;
}
```

**Example: Cross-Field Validator**
```javascript
function validateVipsInMachineNetwork(state, version) {
  const errors = [];
  
  // Only applies to specific platforms
  const platform = state.blueprint?.platform;
  const supportsPlatforms = ["Bare Metal", "VMware vSphere", "Nutanix"];
  if (!supportsPlatforms.includes(platform)) {
    return errors; // Not applicable
  }
  
  const machineNetwork = state.hostInventory?.machineNetworkCidr;
  const apiVip = state.hostInventory?.apiVip;
  const ingressVip = state.hostInventory?.ingressVip;
  
  if (!machineNetwork || !apiVip || !ingressVip) {
    return errors; // Required checks handled by metadata
  }
  
  const [networkAddr, prefix] = machineNetwork.split("/");
  const { start, end } = getCidrRange(networkAddr, parseInt(prefix));
  
  if (!isIpInRange(apiVip, start, end)) {
    errors.push({
      field: "hostInventory.apiVip",
      error: `API VIP must be within machine network (${machineNetwork})`,
      severity: "error"
    });
  }
  
  if (!isIpInRange(ingressVip, start, end)) {
    errors.push({
      field: "hostInventory.ingressVip",
      error: `Ingress VIP must be within machine network (${machineNetwork})`,
      severity: "error"
    });
  }
  
  return errors;
}
```

### Validation Flow

```
User Input → Metadata Validation → Function Validation → Aggregate Errors
              (90% caught here)       (10% edge cases)
```

**Order:**
1. **Metadata validation** runs first (fast, declarative)
2. **Function validation** runs second (slower, complex logic)
3. **Aggregate and deduplicate** errors
4. **Sort by severity** (error > warning > info)
5. **Display to user** (inline + summary)

### Validator Registration

```javascript
// Register validators per version
registerValidator("4.20", "vipsInMachineNetwork", validateVipsInMachineNetwork);
registerValidator("4.20", "agentSNOPlatformNone", validateAgentSNOPlatformNone);
registerValidator("4.21", "ovnKubernetesOnly", validateOVNKubernetesOnly);

// Validators auto-inherit from previous version unless overridden
inheritValidators("4.21", "4.20"); // 4.21 inherits all 4.20 validators
```

---

## SECURITY REVIEW REQUIREMENTS

### Sensitive Data Categories

**1. Pull Secrets**
- Red Hat pull secret
- Mirror registry pull secret
- Operator hub pull secrets
- **Exposure Risks:** Logs, exports, git commits, browser console, localStorage, generated bundles
- **Mitigation:** Obfuscation in UI (SecretInput.jsx), placeholder engine for exports, never log

**2. Platform Credentials**
- vCenter username/password
- BMC credentials (username/password/address)
- AWS access keys
- Azure service principals
- IBM Cloud API keys
- Nutanix credentials
- **Exposure Risks:** Same as pull secrets + plaintext in install-config.yaml
- **Mitigation:** Placeholder engine, encrypted transmission, no persistence in frontend

**3. Mirror Registry Credentials**
- Registry username/password
- Registry TLS certificates (private keys)
- **Exposure Risks:** Export bundles, generated ImageSetConfiguration, logs
- **Mitigation:** Export inclusion toggles, placeholder engine

**4. Proxy Credentials**
- HTTP/HTTPS proxy auth
- Proxy CA certificates (private keys if provided)
- **Exposure Risks:** Install-config.yaml, exports, logs
- **Mitigation:** Placeholder engine

**5. SSH Keys**
- SSH public key (less sensitive but PII)
- SSH private key (NEVER handled by app)
- **Exposure Risks:** Export bundles, install-config.yaml
- **Mitigation:** Public key only, export inclusion toggle

**6. Trust Bundles**
- CA certificates (public certs - low risk)
- Private keys if user mistakenly provides (HIGH RISK)
- **Exposure Risks:** Exports, install-config.yaml
- **Mitigation:** Validate PEM format is cert not key, warn user

### Security Boundaries

**Browser (Frontend):**
- ❌ **NEVER** persist sensitive data to localStorage
- ❌ **NEVER** log sensitive data to console
- ✅ **ALWAYS** use SecretInput component for passwords/tokens
- ✅ **ALWAYS** mask sensitive values in UI (dots/asterisks)
- ✅ **ALWAYS** send sensitive data over POST (not GET query params)

**Backend:**
- ❌ **NEVER** log sensitive data (even in debug mode)
- ❌ **NEVER** commit sensitive data to git
- ❌ **NEVER** persist sensitive data to SQLite without encryption
- ✅ **ALWAYS** use placeholder engine for exports
- ✅ **ALWAYS** sanitize error messages (no credential leakage)

**Generated Artifacts:**
- ❌ **NEVER** include credentials in preview YAML by default
- ✅ **ALWAYS** obfuscate by default, require explicit "Show sensitive values" toggle
- ✅ **ALWAYS** warn user before including credentials in exports
- ✅ **ALWAYS** include export inclusion toggles (per credential category)

**Exports/Bundles:**
- ✅ **ALWAYS** use placeholder engine unless user explicitly includes credentials
- ✅ **ALWAYS** show warning when exporting with credentials included
- ✅ **ALWAYS** create `.ERROR.txt` files for download failures (no sensitive data in error)

**Logs:**
- ✅ **ALWAYS** use structured logging (Pino) with sensitive field redaction
- ✅ **ALWAYS** configure Pino serializers to redact:
  - `pullSecret`
  -