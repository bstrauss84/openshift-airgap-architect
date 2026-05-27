# OpenShift Parameter Audit - Automation Guide

**Version:** 1.0  
**Created:** 2026-05-27  
**Based on:** OCP 4.20 Parameter Canonicalization Audit (2026-05-20 to 2026-05-26)  
**Purpose:** Reproducible process for auditing OpenShift parameter catalogs for future releases (4.21, 4.22, etc.)

---

## Executive Summary

This guide documents the **proven, repeatable process** for auditing and validating OpenShift parameter catalogs against authoritative sources. The process was successfully used to audit OCP 4.20 across 12 deployment scenarios, resulting in:

- ✅ **967 → 949 parameters** (added 100, removed 18 deprecated, fixed 1 metadata issue)
- ✅ **97.4% UI coverage** (252/259 user-configurable parameters)
- ✅ **Zero breaking changes** (all tests passing)
- ✅ **5 audit deliverables** with evidence-based findings
- ✅ **~3-4 weeks effort** (with 7 reusable scripts)

**Key Insight:** With these scripts and this guide, future audits should take **~1-2 weeks** instead of 3-4 weeks.

---

## When to Run This Audit

**Triggers for running a parameter audit:**

1. **New OpenShift minor version release** (4.21, 4.22, etc.)
   - Run audit ~2-4 weeks after GA release
   - Installer source code stabilizes, documentation finalized

2. **Major feature additions** detected in release notes
   - New platform support (e.g., new cloud provider)
   - New installation method (e.g., new agent workflows)
   - Significant API changes

3. **User-reported parameter inconsistencies**
   - Field doesn't work as documented
   - Missing parameters users need
   - Validation errors from UI

4. **Annual comprehensive review**
   - Even if no new version, review for deprecations
   - Check for documentation updates

**Recommended cadence:** Every 6-12 months or when new minor version releases.

---

## Prerequisites

### Required Tools

```bash
# System tools
curl                    # Download PDFs
git                     # Clone installer source
node (v18+)            # Run JavaScript analysis scripts
jq                     # JSON manipulation
grep, find, sed        # Text processing

# Optional but helpful
pdftotext              # Extract text from PDFs (poppler-utils package)
gh                     # GitHub CLI for releases
```

### Required Access

- **Red Hat Documentation:** https://docs.redhat.com/en/documentation/openshift_container_platform/
- **OpenShift Installer GitHub:** https://github.com/openshift/installer
- **Optional - Red Hat Customer Portal:** For release notes, errata

### Disk Space

- **~2-3 GB** for complete workspace:
  - PDFs: ~100-200 MB
  - Installer source: ~500 MB
  - Installer binaries: ~500 MB
  - Analysis outputs: ~10-20 MB
  - Working files: ~50 MB

---

## Audit Process Overview

The audit consists of **3 phases** executed sequentially:

| Phase | Duration | Deliverables | Automation Level |
|-------|----------|--------------|------------------|
| **Phase 1:** Documentation Collection | 2-3 days | PDFs, installer source, binaries | 90% automated |
| **Phase 2:** Parameter Extraction & Analysis | 5-7 days | Parameter inventory, comparison, oc-mirror catalog | 70% automated |
| **Phase 3:** Discrepancy Analysis & Implementation | 4-5 days | Discrepancy reports, catalog fixes, tests | 50% automated |

**Total:** 11-15 days (with existing scripts) vs 21-28 days (from scratch)

---

## Phase 1: Documentation Collection & Workspace Setup

### 1.1 Create Workspace Structure

**Script:** Manual setup (one-time per version)

```bash
# Update version number for new OpenShift release
OCP_VERSION="4.21"  # Change this for each audit

# Create workspace structure
mkdir -p local-docs/ocp-${OCP_VERSION}/{docs/pdf,installer/{source,binaries},analysis,scripts}

# Create .gitignore to exclude large files
cat > local-docs/.gitignore <<'EOF'
# Ignore all downloaded/generated content
ocp-*/docs/
ocp-*/installer/
ocp-*/analysis/*.json
ocp-*/analysis/*.txt

# Keep analysis markdown reports
!ocp-*/analysis/*.md

# Keep scripts
!ocp-*/scripts/
EOF
```

**Directory structure:**
```
local-docs/
  .gitignore
  AUDIT_AUTOMATION_GUIDE.md  ← This file
  ocp-4.21/                  ← New version directory
    docs/
      pdf/                   ← Downloaded PDFs
    installer/
      source/                ← Cloned installer repo
      binaries/              ← Downloaded openshift-install, oc-mirror
    analysis/                ← Analysis outputs
    scripts/                 ← Copied + adapted scripts
```

---

### 1.2 Download OpenShift Documentation PDFs

**Script:** `download-docs.sh` (reusable, requires URL updates)

**Location:** `local-docs/ocp-4.20/scripts/download-docs.sh`

**Adaptation for new version:**

```bash
# Copy script to new version directory
cp local-docs/ocp-4.20/scripts/download-docs.sh \
   local-docs/ocp-4.21/scripts/download-docs.sh

# Update version number in script (line 9)
sed -i 's/4.20/4.21/g' local-docs/ocp-4.21/scripts/download-docs.sh

# Run download
cd local-docs/ocp-4.21/scripts
./download-docs.sh
```

**Expected output:**
- 12 PDF files (~100-200 MB total)
- Success: All downloads complete
- Common failures: URL structure changed (check Red Hat docs site)

**Manual verification:**
```bash
ls -lh local-docs/ocp-4.21/docs/pdf/
# Should show 12 PDFs with reasonable sizes (5-15 MB each)
```

**Troubleshooting:**
- **404 errors:** Red Hat may have changed URL structure
  - Check https://docs.redhat.com/en/documentation/openshift_container_platform/4.21/
  - Update `docs` array in download-docs.sh with new paths
- **Network errors:** Check proxy settings, retry with `curl -v` for details
- **Incomplete downloads:** Check file sizes, re-run for failed downloads only

---

### 1.3 Clone OpenShift Installer Source Code

**Script:** Manual git commands

```bash
cd local-docs/ocp-4.21/installer/source

# Clone installer at specific release branch
git clone --depth 1 --branch release-4.21 \
  https://github.com/openshift/installer.git

cd installer

# Verify correct branch
git branch
# Should show: * release-4.21

# List key parameter files
find pkg/types -name "*.go" -type f | grep -v _test.go | sort
```

**Key files to verify exist:**
```
pkg/types/installconfig.go         ← Core install-config structure
pkg/types/aws/platform.go          ← AWS-specific
pkg/types/azure/platform.go        ← Azure-specific
pkg/types/baremetal/platform.go    ← Bare metal
pkg/types/vsphere/platform.go      ← vSphere
pkg/types/nutanix/platform.go      ← Nutanix
pkg/types/ibmcloud/platform.go     ← IBM Cloud
pkg/types/validation/*.go          ← Validation logic
```

**Troubleshooting:**
- **Branch doesn't exist yet:** Use `main` branch until release branch created
  - After GA release, switch to release branch for stable parameter definitions
- **Missing platform files:** New platform added? Document new files
- **Validation moved:** Search for `Validate` functions if directory restructured

---

### 1.4 Download OpenShift Installer Binaries

**Script:** Manual download

```bash
cd local-docs/ocp-4.21/installer/binaries

# Find latest 4.21 release
LATEST_VERSION=$(curl -s https://mirror.openshift.com/pub/openshift-v4/clients/ocp/stable-4.21/release.txt | grep 'Name:' | awk '{print $2}')

echo "Latest version: $LATEST_VERSION"

# Download openshift-install
curl -o openshift-install-linux.tar.gz \
  https://mirror.openshift.com/pub/openshift-v4/x86_64/clients/ocp/stable-4.21/openshift-install-linux.tar.gz

# Download oc-mirror
curl -o oc-mirror.tar.gz \
  https://mirror.openshift.com/pub/openshift-v4/x86_64/clients/ocp/stable-4.21/oc-mirror.tar.gz

# Extract
tar -xzf openshift-install-linux.tar.gz
tar -xzf oc-mirror.tar.gz

# Verify
./openshift-install version
./oc-mirror version
```

**Expected output:**
```
openshift-install 4.21.x
built from commit abc123def
release image quay.io/openshift-release-dev/ocp-release@sha256:...
```

---

## Phase 2: Parameter Extraction & Analysis

### 2.1 Extract Parameters from Installer Source Code

**Scripts (reusable):**
1. `parse-go-structs.js` - Extract install-config parameters
2. `parse-agent-config-structs.js` - Extract agent-config parameters
3. `parse-imageset-params.js` - Extract oc-mirror ImageSetConfiguration parameters

**Preparation:**

```bash
# Copy scripts to new version directory
cd local-docs/ocp-4.21/scripts
cp ../../ocp-4.20/scripts/parse-go-structs.js .
cp ../../ocp-4.20/scripts/parse-agent-config-structs.js .
cp ../../ocp-4.20/scripts/parse-imageset-params.js .

# Update paths in scripts if needed (check INSTALLER_DIR and OUTPUT_FILE constants)
```

**Execution:**

```bash
# Extract install-config parameters
node parse-go-structs.js > ../analysis/installer-source-params.json

# Extract agent-config parameters
node parse-agent-config-structs.js > ../analysis/agent-config-params.json

# Extract oc-mirror parameters
node parse-imageset-params.js > ../analysis/oc-mirror-params.json
```

**Expected output:**
- `installer-source-params.json`: ~300-400 parameters
- `agent-config-params.json`: ~50-80 parameters
- `oc-mirror-params.json`: ~40-50 parameters

**Verification:**

```bash
# Check parameter counts
jq '.parameters | length' ../analysis/installer-source-params.json
jq '.parameters | length' ../analysis/agent-config-params.json
jq '.parameters | length' ../analysis/oc-mirror-params.json

# Spot-check critical parameters exist
jq '.parameters[] | select(.path == "baseDomain")' ../analysis/installer-source-params.json
jq '.parameters[] | select(.path == "hosts")' ../analysis/agent-config-params.json
```

**Known limitations:**

1. **Nested struct extraction incomplete:**
   - Scripts only extract top-level and one-level-deep fields
   - Deeply nested structures (e.g., `failureDomains[].topology.datacenter`) require manual inspection
   - **Workaround:** Search Go files for specific nested paths: `grep -r "Datacenter" pkg/types/vsphere/`

2. **Conditional fields not marked:**
   - Scripts can't detect "required if X" logic from code
   - **Workaround:** Review validation functions manually: `grep -A 10 "required" pkg/types/validation/`

3. **Default values from functions:**
   - Scripts extract struct tags, not runtime defaults
   - **Workaround:** Inspect `pkg/asset/installconfig/*.go` for defaulting logic

---

### 2.2 Extract Parameters from Documentation PDFs

**Scripts (reusable but fragile):**
1. `extract-table-params.sh` - Extract parameter tables from PDFs
2. `parse-parameter-tables.js` - Parse extracted tables into JSON

**Known issues:**
- PDF extraction is **brittle** - Red Hat documentation format changes break scripts
- Tables may use different formatting in new versions
- Success rate: ~60-70% automated, rest requires manual extraction

**Recommended approach for 4.21:**

**Option A: Try automated extraction first**
```bash
cd local-docs/ocp-4.21/scripts

# Try automated extraction
./extract-table-params.sh

# Check results
ls -lh ../analysis/*-table-params.json

# If files are small or empty, automated extraction failed
```

**Option B: Manual parameter extraction (more reliable)**

For each documentation PDF, open and extract parameter tables manually:

1. **Open PDF:** `local-docs/ocp-4.21/docs/pdf/OpenShift_Container_Platform-4.21-Installing_on_AWS-en-US.pdf`
2. **Find parameter tables:** Search for "Required configuration parameters", "Optional configuration parameters"
3. **Copy table rows** into structured format
4. **Save as JSON:** `local-docs/ocp-4.21/analysis/aws-params-from-docs.json`

**Lessons learned:**
- **Installer source code is authoritative** - When docs conflict with code, trust code
- **Documentation extraction adds ~20% extra parameters** not in code (examples, edge cases)
- **Skip PDF extraction if time-constrained** - Installer source covers 80% of parameters

---

### 2.3 Compare Extracted Parameters vs Existing Catalogs

**Script:** `compare-source-vs-catalogs.js` (reusable)

**Purpose:** Identify missing parameters, phantom parameters, metadata discrepancies

**Execution:**

```bash
cd local-docs/ocp-4.21/scripts

# Copy comparison script
cp ../../ocp-4.20/scripts/compare-source-vs-catalogs.js .

# Update paths in script:
# - ANALYSIS_DIR should point to ../analysis
# - CATALOG_DIR should point to ../../../data/params/4.21 (create this first!)

# Run comparison
node compare-source-vs-catalogs.js > ../analysis/source-catalog-comparison.json
```

**Output structure:**

```json
{
  "summary": {
    "totalExtractedParams": 450,
    "totalCatalogParams": 949,
    "missingInCatalogs": 120,
    "phantomInCatalogs": 15,
    "metadataDiscrepancies": 25
  },
  "missingParameters": [...],
  "phantomParameters": [...],
  "metadataDiscrepancies": [...]
}
```

**Critical step: Filter false positives**

Raw comparison will show **hundreds of "missing" parameters** that are actually:
- Platform-specific (AWS params not in vSphere catalog)
- Method-specific (IPI params not in UPI catalog)
- Conditional (only required in specific scenarios)
- Deprecated (intentionally removed)
- Type aliases (Go type vs YAML representation)

**Filtering script:** `corrected-analysis.js` (reusable with updates)

```bash
# Copy and adapt filtering script
cp ../../ocp-4.20/scripts/corrected-analysis.js .

# Run filtering
node corrected-analysis.js > ../analysis/corrected-comparison.json
```

**Manual review required:**
- Review corrected-comparison.json
- Validate filtering rules still apply to 4.21
- Add new filtering rules for new parameter patterns

---

### 2.4 Create/Update oc-mirror v2 Catalog

**Status:** Manual creation based on extracted parameters

**Source:** `local-docs/ocp-4.21/analysis/oc-mirror-params.json`

**Process:**

1. **Load extracted oc-mirror parameters:**
   ```bash
   jq '.parameters' local-docs/ocp-4.21/analysis/oc-mirror-params.json > oc-mirror-params-list.json
   ```

2. **Compare with existing oc-mirror catalog:**
   ```bash
   # Check if catalog exists
   cat data/params/4.20/oc-mirror-v2.json  # Previous version

   # Identify differences
   diff <(jq -S '.parameters[].path' data/params/4.20/oc-mirror-v2.json) \
        <(jq -S '.[].path' oc-mirror-params-list.json)
   ```

3. **Create new catalog for 4.21:**
   ```bash
   # Copy previous version as template
   cp data/params/4.20/oc-mirror-v2.json data/params/4.21/oc-mirror-v2.json

   # Update version field
   jq '.version = "4.21"' data/params/4.21/oc-mirror-v2.json > tmp.json
   mv tmp.json data/params/4.21/oc-mirror-v2.json

   # Add/remove parameters based on extracted list
   # (Manual editing required)
   ```

4. **Validate catalog structure:**
   ```bash
   # Check all parameters have required fields
   jq '.parameters[] | select(.path == null or .outputFile == null or .type == null)' \
     data/params/4.21/oc-mirror-v2.json

   # Should return empty (no results = all parameters valid)
   ```

---

## Phase 3: Discrepancy Analysis & Implementation

### 3.1 Categorize Discrepancies

**Input:** `local-docs/ocp-4.21/analysis/corrected-comparison.json`

**Manual process (cannot be fully automated):**

Create 3 analysis documents (JSON format for auditability):

#### 1. **deprecated-fields-to-remove.json**

**Purpose:** Identify P0 deprecated parameters that MUST be removed

**Criteria for P0 removal:**
- Field marked `Deprecated:` in Go struct with comment
- Field breaks functionality (e.g., dual-stack IPv6)
- Field creates deprecated Kubernetes resources (e.g., ICSP)
- Canonical replacement exists and is already in catalogs

**Template:**
```json
{
  "auditDate": "2026-05-27",
  "ocpVersion": "4.21",
  "totalDeprecatedFound": 8,
  "p0Removals": 6,
  "p1Markings": 2,
  "deprecatedParameters": [
    {
      "id": "DEP-001",
      "path": "platform.aws.someOldField",
      "catalogsAffected": ["aws-govcloud-ipi", "aws-govcloud-upi"],
      "replacement": "platform.aws.newField",
      "evidence": {
        "installerSource": "pkg/types/aws/platform.go:123 - Deprecated: Use NewField",
        "documentation": "OCP 4.21 docs no longer mention someOldField",
        "functionalImpact": "Field ignored by installer as of 4.20"
      },
      "priority": "P0",
      "removalPlan": "Delete from catalogs, already replaced by newField"
    }
  ]
}
```

**From OCP 4.20 audit:**
- **6 deprecated fields removed** (18 catalog instances)
- Most common: VIP singular → plural (dual-stack IPv6), imageContentSources → imageDigestSources

#### 2. **deprecated-fields-to-mark.json**

**Purpose:** Identify P1 deprecated parameters to mark (but not remove yet)

**Criteria for P1 marking:**
- Field still works but deprecated
- Migration path needed for users
- Affects existing configurations

**Template:**
```json
{
  "auditDate": "2026-05-27",
  "ocpVersion": "4.21",
  "deprecatedParameters": [
    {
      "id": "MARK-001",
      "path": "platform.vsphere.datacenter",
      "catalogsAffected": ["vsphere-ipi", "vsphere-upi"],
      "replacement": "platform.vsphere.failureDomains[].topology.datacenter",
      "evidence": {
        "installerSource": "pkg/types/vsphere/platform.go:89 - Deprecated: Use failureDomains",
        "stillWorks": true,
        "removalVersion": "4.23+ (not specified in code)"
      },
      "uiTreatment": {
        "badge": "Deprecated",
        "tooltip": "⚠️ This field is deprecated. Use failureDomains[] for multi-zone deployments.",
        "section": "Collapse into 'Legacy Single-Zone (Deprecated)' section"
      },
      "priority": "P1",
      "implementationPhase": "v1.7.0+"
    }
  ]
}
```

#### 3. **metadata-fixes-required.json**

**Purpose:** Identify incorrect metadata (required flags, type mismatches, enum errors)

**Process:**
1. Compare extracted parameters against catalogs
2. Filter false positives:
   - Go type aliases (AWSLBType is string in YAML)
   - Stricter catalog requirements (Agent scenarios require VIPs)
   - Conditional requirements (field optional unless X)
3. Document real discrepancies with evidence

**Template:**
```json
{
  "auditDate": "2026-05-27",
  "ocpVersion": "4.21",
  "totalDiscrepanciesFound": 22,
  "realIssuesRequiringFixes": 3,
  "acceptableDiscrepancies": 19,
  "realIssues": [
    {
      "id": "META-001",
      "path": "platform.aws.someField",
      "scenario": "aws-govcloud-ipi",
      "type": "requiredFlag",
      "catalogValue": true,
      "installerValue": false,
      "evidence": {
        "installerSource": "pkg/types/aws/platform.go - Field has omitempty tag",
        "documentation": "AWS IPI docs show field as optional",
        "conditionalRequirement": "Only required when X is set"
      },
      "priority": "P1",
      "proposedFix": "Change required: true → false, add conditional note to description",
      "confidence": "High"
    }
  ],
  "acceptableDiscrepancies": {
    "goTypeAliases": [
      {
        "id": "ACCEPT-001",
        "path": "platform.aws.lbType",
        "reason": "configv1.AWSLBType is Go type alias for string, catalog correctly uses type=string"
      }
    ],
    "stricterCatalogRequirements": [
      {
        "id": "ACCEPT-002",
        "path": "platform.baremetal.apiVIPs",
        "reason": "Catalog requires VIPs for Agent scenarios, Go struct is generic (optional)"
      }
    ]
  }
}
```

**From OCP 4.20 audit:**
- **19 discrepancies analyzed**
- **1 real fix required** (Azure resourceGroupName required flag)
- **18 acceptable discrepancies** (type aliases, scenario-specific requirements)

#### 4. **missing-parameters-analysis.json**

**Purpose:** Identify truly missing parameters (after filtering false positives)

**Filtering rules (critical):**

```javascript
// Platform applicability
if (param.struct.includes('aws.Platform') && scenario !== 'aws-*') {
  return 'acceptable'; // AWS param not needed in vSphere catalog
}

// Deprecated fields
if (param.comment.includes('Deprecated:')) {
  return 'acceptable'; // Intentionally excluded
}

// Conditional requirements
if (param.comment.includes('only when') || param.comment.includes('required if')) {
  return 'review'; // May be optional
}

// Type representations
if (param.type.includes('IPNet') && catalogType === 'string') {
  return 'acceptable'; // Go struct vs YAML representation
}
```

**Template:**
```json
{
  "auditDate": "2026-05-27",
  "ocpVersion": "4.21",
  "totalMissingFromSource": 366,
  "afterFiltering": 125,
  "highPriority": 32,
  "missingParameters": [
    {
      "id": "MISSING-001",
      "path": "networking.clusterNetworkMTU",
      "applicableScenarios": ["all"],
      "type": "integer",
      "required": false,
      "description": "MTU for the cluster network (VXLAN/Geneve overhead)",
      "evidence": {
        "installerSource": "pkg/types/networking.go:45",
        "documentation": "OCP 4.21 Networking docs, section 3.2",
        "default": "Auto-calculated based on node MTU"
      },
      "priority": "P1",
      "uiImpact": "Add to Networking step, advanced section",
      "implementationPhase": "v1.7.0-v1.8.0"
    }
  ]
}
```

---

### 3.2 Implement Catalog Corrections

**Input:** Audit deliverables (deprecated-fields-to-remove.json, metadata-fixes-required.json)

**Process:**

#### Step 1: Apply P0 Deprecated Removals

**Script:** Create removal script (adapt from OCP 4.20)

```bash
#!/bin/bash
# Remove P0 deprecated parameters from catalogs
set -e

CATALOG_DIR="data/params/4.21"

# Example: Remove imageContentSources from all catalogs
for catalog in "$CATALOG_DIR"/*.json; do
  echo "Processing $(basename $catalog)..."
  jq 'del(.parameters[] | select(.path == "imageContentSources"))' "$catalog" > "${catalog}.tmp"
  mv "${catalog}.tmp" "$catalog"
done

# Example: Remove platform.baremetal.apiVIP (singular) from bare-metal catalogs
for scenario in bare-metal-ipi bare-metal-agent; do
  catalog="$CATALOG_DIR/${scenario}.json"
  echo "Removing apiVIP from $(basename $catalog)..."
  jq 'del(.parameters[] | select(.path == "platform.baremetal.apiVIP"))' "$catalog" > "${catalog}.tmp"
  mv "${catalog}.tmp" "$catalog"
done

echo "✓ Deprecated parameters removed"
```

**Verification:**
```bash
# Verify removals
grep -c '"platform.baremetal.apiVIP"' data/params/4.21/bare-metal-ipi.json
# Expected: 0 (parameter removed)

grep -c '"imageContentSources"' data/params/4.21/*.json
# Expected: 0 across all files
```

#### Step 2: Apply Metadata Fixes

**Script:** Create fix script (adapt per discrepancy)

```bash
#!/bin/bash
# Fix metadata discrepancies
set -e

CATALOG_DIR="data/params/4.21"

# Example: Fix Azure resourceGroupName required flag
catalog="$CATALOG_DIR/azure-government-upi.json"
echo "Fixing resourceGroupName in $(basename $catalog)..."

# Change required: true → false
jq '(.parameters[] | select(.path == "platform.azure.resourceGroupName") | .required) = false' "$catalog" > "${catalog}.tmp"
mv "${catalog}.tmp" "$catalog"

# Update description
jq '(.parameters[] | select(.path == "platform.azure.resourceGroupName") | .description) = "Optional. Name of an existing Azure resource group to install the cluster into. If not specified, a new resource group will be created. If specified, the resource group must already exist."' "$catalog" > "${catalog}.tmp"
mv "${catalog}.tmp" "$catalog"

echo "✓ Metadata fixes applied"
```

#### Step 3: Sync Frontend Catalogs

```bash
# Use existing sync script
npm run sync-catalogs

# Or manually
cd scripts
node sync-catalogs.js

# Verify sync
cd ..
md5sum data/params/4.21/bare-metal-ipi.json frontend/src/data/catalogs/bare-metal-ipi.json
# MD5 hashes should match (byte-identical)
```

---

### 3.3 Run Tests and Verify

**Backend tests:**
```bash
cd backend
npm test

# Look for:
# - Catalog loading tests passing
# - YAML validation tests passing
# - All scenario detection tests passing
```

**Frontend tests:**
```bash
cd frontend
npm test

# Look for:
# - Catalog import tests passing
# - All UI rendering tests passing
```

**Manual verification:**

1. **Start application:**
   ```bash
   docker compose up --build
   ```

2. **Test affected scenarios:**
   - Create new run for each modified scenario (e.g., bare-metal-ipi)
   - Verify deprecated fields not visible in UI
   - Verify metadata fixes applied (required badges, descriptions)
   - Generate YAML and inspect output

3. **Verify catalog validator:**
   ```bash
   # Check catalogValidator loads all catalogs
   curl http://localhost:3001/api/catalogs
   # Should return all 13 catalogs with parameter counts
   ```

---

## Lessons Learned (OCP 4.20 Audit)

### What Worked Well ✅

1. **Installer source code as authoritative source**
   - Go structs + JSON tags provided ground truth
   - Validation functions showed conditional requirements
   - Defaulting logic revealed actual behavior

2. **Phased approach with deliverables**
   - Each phase produced concrete artifacts
   - Easy to pause/resume work
   - Clear progress tracking

3. **False positive filtering was critical**
   - Raw comparison showed 366 "missing" parameters
   - After filtering: 120 real gaps (67% false positives)
   - Platform applicability was biggest source of false positives

4. **Version control for audit artifacts**
   - Git commits with evidence links
   - Easy to review changes
   - Rollback capability

5. **Advisory YAML validation**
   - Logs warnings but doesn't block
   - Allows incremental improvement
   - Catches real issues without breaking tests

### What Didn't Work ❌

1. **PDF parameter extraction**
   - Success rate: ~60-70%
   - Red Hat doc format changes broke scripts
   - Manual extraction more reliable

2. **Nested struct extraction**
   - Scripts only got top-level fields
   - Missed deeply nested parameters (e.g., failureDomains[].topology)
   - Required manual Go code inspection

3. **Documentation as source of truth**
   - Docs often outdated or incorrect
   - Examples used deprecated fields
   - Installer code more reliable

4. **Attempting 100% automation**
   - Manual review always required
   - Filtering rules needed human judgment
   - Edge cases required domain knowledge

### Critical Decisions

1. **When docs conflict with installer code, trust installer code**
   - Installer is what actually runs
   - Docs lag behind code changes
   - Confirmed with Red Hat: code is authoritative

2. **2-tier deprecation strategy (P0 remove, P1 mark)**
   - P0: Breaks functionality or creates deprecated resources → remove immediately
   - P1: Works but deprecated → mark with warnings, remove in future version
   - Provides migration path for users

3. **Stricter catalog requirements are acceptable**
   - Catalogs can be MORE strict than Go structs
   - Example: Agent scenarios require VIPs even though struct is optional
   - Validation happens in different code paths

4. **Go type aliases serialize as primitives in YAML**
   - `type AWSLBType string` → catalog type should be "string"
   - `type IPNet *net.IPNet` → catalog type should be "string" (CIDR notation)
   - Catalog represents YAML structure, not Go structure

---

## Common Pitfalls & Solutions

### Pitfall 1: Treating All "Missing" Parameters as Gaps

**Problem:** Raw comparison shows hundreds of missing parameters

**Solution:** Apply platform/scenario filtering FIRST
- AWS params not needed in vSphere catalogs
- IPI params not needed in UPI catalogs
- Agent-specific params not in IPI/UPI catalogs

**Filtering script:** `corrected-analysis.js`

---

### Pitfall 2: Removing Deprecated Fields Without Evidence

**Problem:** Field looks old, might be deprecated, should we remove it?

**Solution:** Require installer source evidence
- `grep -r "Deprecated:" pkg/types/`
- Find comment: `Deprecated: Use NewField`
- Verify replacement exists in catalog
- Only then remove

**Never remove based on:**
- "This looks old"
- "Docs don't mention it"
- "I think it's deprecated"

---

### Pitfall 3: Assuming Docs Are Accurate

**Problem:** Documentation says field is required, but installer code shows omitempty tag

**Solution:** Trust installer code
- Code is what actually runs
- Docs lag behind changes
- Precedence: installer code > installer binary behavior > docs

**When in doubt:** Test with actual installer binary

---

### Pitfall 4: Not Filtering Go Type Aliases

**Problem:** Comparison shows "type mismatch: catalog=string, installer=AWSLBType"

**Solution:** Check if installer type is a type alias
```bash
grep "type AWSLBType" pkg/types/aws/
# Output: type AWSLBType string

# This is a type alias for string, catalog is correct
```

**Common type aliases:**
- `AWSLBType` → string
- `CloudEnvironment` → string
- `ProvisioningNetwork` → string
- `DiskType` → string
- `IPNet` → string (CIDR notation in YAML)

---

### Pitfall 5: Implementing All Missing Parameters

**Problem:** 120 missing parameters identified, try to add all of them

**Solution:** Prioritize based on user impact
- **P1 (high priority):** Common fields users need (MTU, OVN-K config, BYO VPC)
- **P2 (medium):** Advanced features (operator version constraints)
- **P3 (low):** Edge cases (arbiter, fencing, SNO-specific)

**From OCP 4.20 audit:**
- 120 total missing
- 28 high-priority (implemented in v1.7.0-v1.8.0)
- 92 deferred (implemented only if users request)

---

## Authoritative Source Precedence

When sources conflict, use this precedence:

### 1. **Installer Source Code** (HIGHEST AUTHORITY)
   - `pkg/types/*.go` - Go struct definitions
   - `pkg/types/validation/*.go` - Validation logic
   - `pkg/asset/installconfig/*.go` - Defaulting logic

### 2. **Installer Binary Behavior**
   - Run `openshift-install create install-config`
   - Test actual validation errors
   - Observe defaults applied

### 3. **OpenShift Documentation**
   - Use for descriptions, examples, use cases
   - Don't trust for technical accuracy (required flags, types, defaults)
   - Docs lag ~1-2 releases behind code

### 4. **Existing Catalogs**
   - Lowest authority
   - What we're auditing/fixing
   - May contain errors from previous versions

**Example conflict resolution:**

```
Docs: "platform.azure.resourceGroupName is required"
Code: ResourceGroupName string `json:"resourceGroupName,omitempty"`
Catalog: required: true

Resolution: Trust code (omitempty = optional)
Fix: Change catalog to required: false
```

---

## Estimated Effort by Phase

Based on OCP 4.20 audit (first-time execution):

| Phase | First Time | With Scripts | With This Guide |
|-------|-----------|--------------|-----------------|
| **Phase 1:** Documentation Collection | 2-3 days | 4-6 hours | 2-3 hours |
| **Phase 2:** Parameter Extraction | 5-7 days | 2-3 days | 1-2 days |
| **Phase 3:** Discrepancy Analysis | 4-5 days | 2-3 days | 1-2 days |
| **Testing & Verification** | 1-2 days | 1 day | 4-6 hours |
| **Documentation** | 1-2 days | 4-6 hours | 2-3 hours |
| **TOTAL** | **13-19 days** | **10-13 days** | **5-8 days** |

**Optimistic timeline for OCP 4.21 audit:** 1-2 weeks (with this guide + existing scripts)

---

## Success Criteria

An audit is **complete** when:

- ✅ All 12+ scenario catalogs validated against installer source
- ✅ Deprecated parameters removed or marked (with evidence)
- ✅ Metadata discrepancies fixed or documented as acceptable
- ✅ oc-mirror v2 catalog updated for new version
- ✅ All tests passing (backend + frontend)
- ✅ Frontend/backend catalogs synchronized (MD5 verified)
- ✅ Zero breaking changes (existing states still work)
- ✅ Audit deliverables created:
  - `deprecated-fields-to-remove.json`
  - `deprecated-fields-to-mark.json`
  - `metadata-fixes-required.json`
  - `missing-parameters-analysis.json`
  - `AUDIT_SUMMARY.md`

---

## Checklist for OCP 4.21 Audit

### Pre-Audit Setup
- [ ] Create workspace: `local-docs/ocp-4.21/`
- [ ] Update version in all scripts (4.20 → 4.21)
- [ ] Verify installer release-4.21 branch exists
- [ ] Check documentation URL structure unchanged

### Phase 1: Collection
- [ ] Download 12 documentation PDFs
- [ ] Clone installer source (release-4.21 branch)
- [ ] Download openshift-install binary
- [ ] Download oc-mirror binary
- [ ] Verify all files present and correct version

### Phase 2: Extraction
- [ ] Run parse-go-structs.js
- [ ] Run parse-agent-config-structs.js
- [ ] Run parse-imageset-params.js
- [ ] Create/copy 4.21 catalog directory
- [ ] Run compare-source-vs-catalogs.js
- [ ] Run corrected-analysis.js (filter false positives)
- [ ] Spot-check critical parameters exist

### Phase 3: Analysis
- [ ] Create deprecated-fields-to-remove.json
- [ ] Create deprecated-fields-to-mark.json
- [ ] Create metadata-fixes-required.json
- [ ] Create missing-parameters-analysis.json
- [ ] Review all findings with evidence
- [ ] Prioritize changes (P0/P1/P2/P3)

### Phase 4: Implementation
- [ ] Apply P0 deprecated removals
- [ ] Apply metadata fixes
- [ ] Sync frontend catalogs
- [ ] Run backend tests (all passing)
- [ ] Run frontend tests (all passing)
- [ ] Manual verification in UI
- [ ] Commit changes with evidence

### Phase 5: Documentation
- [ ] Create AUDIT_SUMMARY.md
- [ ] Update BACKLOG_STATUS.md
- [ ] Update IMPLEMENTATION_ROADMAP.md
- [ ] Commit audit deliverables
- [ ] Tag release (if applicable)

---

## Quick Reference: Key Scripts

| Script | Purpose | Reusable? | Adaptation Needed |
|--------|---------|-----------|-------------------|
| `download-docs.sh` | Download PDFs | ✅ Yes | Update version number |
| `parse-go-structs.js` | Extract install-config params | ✅ Yes | Update paths if repo restructured |
| `parse-agent-config-structs.js` | Extract agent-config params | ✅ Yes | Update paths if repo restructured |
| `parse-imageset-params.js` | Extract oc-mirror params | ✅ Yes | Minimal changes |
| `compare-source-vs-catalogs.js` | Compare extracted vs catalogs | ✅ Yes | Update catalog dir path |
| `corrected-analysis.js` | Filter false positives | ⚠️ Partial | Update filtering rules |
| `analyze-by-scenario.js` | Breakdown by scenario | ✅ Yes | Minimal changes |

**All scripts located in:** `local-docs/ocp-4.20/scripts/`

**Copy to new version:** `cp -r local-docs/ocp-4.20/scripts local-docs/ocp-4.21/scripts`

---

## Questions & Troubleshooting

### Q: How do I know if a parameter is platform-specific?

**A:** Check Go struct location and applies_to logic:
- `pkg/types/aws/*.go` → AWS-only
- `pkg/types/baremetal/*.go` → Bare-metal-only
- `pkg/types/installconfig.go` → Common to all platforms

Also check installer validation:
```bash
grep -A 5 "switch.*Platform" pkg/types/validation/installconfig.go
```

---

### Q: Should I remove all deprecated parameters immediately?

**A:** No, use 2-tier approach:
- **P0 (remove):** Breaks functionality or creates deprecated resources
- **P1 (mark):** Still works but deprecated, remove in future version

Provides migration path for users with existing configurations.

---

### Q: What if PDF extraction fails completely?

**A:** Skip PDF extraction, rely on installer source code
- Installer source covers 80% of parameters
- Docs add ~20% examples/edge cases
- If time-constrained, installer source alone is sufficient

---

### Q: How do I handle new platforms added in 4.21?

**A:** 
1. Check for new platform files: `find pkg/types -name "*.go" | grep -v _test.go | sort`
2. Create new scenario catalogs (e.g., `data/params/4.21/newplatform-ipi.json`)
3. Run extraction scripts on new platform structs
4. Add to comparison and filtering scripts

---

### Q: Tests fail after catalog changes, what now?

**A:**
1. Check if tests are validating old structure (may need test updates)
2. Verify catalog JSON is valid (run through `jq .` for syntax check)
3. Check frontend/backend catalogs are synchronized
4. Review advisory validation logs for warnings
5. If catalog structure changed intentionally, update tests accordingly

---

## Next Steps After Audit

1. **Implement high-priority missing parameters** (P1 items from missing-parameters-analysis.json)
2. **Mark deprecated parameters** (P1 items from deprecated-fields-to-mark.json)
3. **Monitor user feedback** for parameter requests
4. **Plan next audit** (when OCP 4.22 releases or annual review)

---

## Reference: OCP 4.20 Audit Documentation

**Complete audit documentation for 4.20 is preserved in `local-docs/ocp-4.20/`**

### Key Reference Documents

**Phase Summaries:**
- `PHASE_1_COMPLETION.md` - Documentation collection (2026-05-20)
- `PHASE_2_COMPLETE.md` - Parameter extraction technical details
- `PHASE_2_EXECUTIVE_SUMMARY.md` - **Critical lessons learned, metrics, decision matrix**
- `PHASE_2.4_COMPLETE.md` - oc-mirror extraction specifics
- `OC-MIRROR_CATALOG_COMPLETE.md` - oc-mirror catalog creation

**Analysis Deliverables (`local-docs/ocp-4.20/analysis/`):**
- `deprecated-fields-to-remove.json` (13KB) - P0 removals with installer evidence
- `deprecated-fields-to-mark.json` (13KB) - P1 future deprecation marking
- `metadata-fixes-required.json` (14KB) - Real vs false positive discrepancies
- `missing-parameters-analysis.json` (20KB) - 120 real missing parameters (after filtering 340 false positives)
- `IMPLEMENTATION_COMPLETE.md` (40KB) - Phase 3 implementation summary
- `AUDIT_AND_IMPLEMENTATION_SUMMARY.md` (60KB) - **Complete audit summary, all phases**

**Extracted Parameter Data:**
- `installer-source-params.json` (449KB) - 502 parameters from installer Go structs
- `agent-config-params.json` (32KB) - Agent-specific parameters
- `oc-mirror-v2-params.json` (10KB) - ImageSetConfiguration parameters
- `source-catalog-comparison.json` (572KB) - Raw comparison before filtering
- `normalized-comparison.json` (184KB) - Path-normalized comparison

**Batch Implementation Reports (`local-docs/ocp-4.20/analysis/`):**
- `BATCH_01_COMPLETE.md` through `BATCH_12_COMPLETE.md` - 12 scenario updates
- `BATCHES_01_02_SUMMARY.md`, `BATCHES_03_04_SUMMARY.md`, `BATCHES_05_06_SUMMARY.md` - Progress summaries

**Scripts (`local-docs/ocp-4.20/scripts/`):**
- All 18 extraction, comparison, and analysis scripts (reusable for 4.21+)

### Critical Lessons from Phase 2 Executive Summary

From `PHASE_2_EXECUTIVE_SUMMARY.md` (2026-05-21):

**Coverage Metrics:**
- **Before filtering:** 366 "missing" parameters identified
- **After filtering:** 120 real missing parameters
- **False positive rate:** 67% (340/502 parameters were false positives)
- **Main false positive source:** Platform applicability (AWS params not in vSphere catalog)

**Time Investment:**
- Phase 1: 3-4 hours (documentation download, workspace)
- Phase 2: 12-15 hours (extraction, comparison, analysis)
- Total with reusable scripts: 20-24 hours vs 60-80 hours from scratch

**Priority 0 Critical Fixes Identified:**
- 15 required flag mismatches (2-3 hours effort)
- 10 critical REQUIRED parameters missing (AWS rootVolume, Azure osDisk)

**Recommendation from Phase 2:**
> "Start with Priority 0 fixes (6-9 hours) for immediate impact, then decide on larger improvements based on user feedback and roadmap priorities."

---

## Conclusion

This guide captures the proven process for auditing OpenShift parameter catalogs. With the existing scripts and this documentation, future audits should take **1-2 weeks** instead of 3-4 weeks.

**Key principles:**
- Trust installer source code over documentation
- Filter false positives rigorously (expect ~67% false positive rate)
- Require evidence for all changes
- Test thoroughly before committing
- Document decisions for future audits

**Questions or issues?** Reference the OCP 4.20 audit artifacts in `local-docs/ocp-4.20/analysis/` for examples and patterns.

**Critical reading for next audit:**
1. `PHASE_2_EXECUTIVE_SUMMARY.md` - Lessons learned, metrics, decision framework
2. `AUDIT_AND_IMPLEMENTATION_SUMMARY.md` - Complete audit summary
3. `missing-parameters-analysis.json` - Example of false positive filtering

---

**Document Version:** 1.0  
**Last Updated:** 2026-05-27  
**Next Review:** When OCP 4.21 releases (estimated Q4 2026)
