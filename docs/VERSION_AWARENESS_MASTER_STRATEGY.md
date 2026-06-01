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
- Export: Always export v3 (with version manifest)

---

## IMPORT/EXPORT VERSION MANIFESTS

### Required v2.0.0 Design

**Export Bundle Structure:**
```
export-bundle-{timestamp}.zip
├── version-manifest.json          ← NEW REQUIRED
├── state.json                      
├── install-config.yaml
├── agent-config.yaml (if applicable)
├── imageset-config.yaml (if applicable)
├── field-guide.md
└── tools/ (binaries if included)
```

### version-manifest.json Schema

```json
{
  "manifestVersion": "2.0.0",
  "generated": {
    "timestamp": "2026-05-29T10:00:00.000Z",
    "appVersion": "2.0.0",
    "appCommit": "abc1234",
    "stateSchemaVersion": "3"
  },
  "openshift": {
    "selectedMinor": "4.21",
    "selectedPatch": "4.21.15",
    "lockedVersion": true
  },
  "compatibility": {
    "minimumAppVersion": "2.0.0",
    "maximumAppVersion": null,
    "stateFormatCompatible": ["3"],
    "warnings": []
  },
  "integrity": {
    "stateChecksum": "sha256:abc123...",
    "installConfigChecksum": "sha256:def456...",
    "agentConfigChecksum": "sha256:789abc..."
  }
}
```

### Import Validation

**On Import:**
1. **Check version-manifest.json exists**
   - If missing: Assume v1.x export, warn user about upgrade
   - If present: Validate schema

2. **Validate app version compatibility**
   ```javascript
   if (manifest.compatibility.minimumAppVersion > CURRENT_APP_VERSION) {
     throw new Error(
       `This export requires app version ${manifest.compatibility.minimumAppVersion} or higher. ` +
       `You are running ${CURRENT_APP_VERSION}. Please upgrade.`
     );
   }
   ```

3. **Validate state schema compatibility**
   ```javascript
   if (!manifest.compatibility.stateFormatCompatible.includes(CURRENT_STATE_SCHEMA)) {
     throw new Error(
       `This export uses state schema ${manifest.stateSchemaVersion}. ` +
       `Current app supports: ${manifest.compatibility.stateFormatCompatible.join(", ")}. ` +
       `Migration required.`
     );
   }
   ```

4. **Validate OCP version compatibility**
   ```javascript
   const supportedVersions = ["4.20", "4.21"];
   if (!supportedVersions.includes(manifest.openshift.selectedMinor)) {
     showWarning(
       `This export is for OpenShift ${manifest.openshift.selectedMinor}. ` +
       `This app version supports: ${supportedVersions.join(", ")}. ` +
       `Some features may not work correctly.`
     );
   }
   ```

5. **Verify integrity checksums**
   ```javascript
   const stateActual = sha256(stateJsonContent);
   if (stateActual !== manifest.integrity.stateChecksum) {
     throw new Error("State file corrupted - checksum mismatch");
   }
   ```

6. **Display warnings**
   - Show manifest.compatibility.warnings to user
   - Allow user to proceed or cancel

### Export Generation

**Always include version-manifest.json:**
- Required field in export options (cannot disable)
- Generated automatically before ZIP creation
- Checksums computed after all YAMLs generated
- App version from `package.json`
- OCP version from `state.version.selectedMinor`

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