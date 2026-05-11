# Operator Version-Aware Research Process - Complete Documentation

**Date:** 2026-05-11  
**Task:** DOC-063 - Expand operator scenario quick picks  
**Related:** DOC-059 - OpenShift version-aware system with automated minor release update pipeline  
**Purpose:** Document the complete research process, sources, and methodology for creating version-aware operator quick picks

---

## Executive Summary

This document records the **complete research process** used to create version-aware operator quick picks for OpenShift Data Foundation, Advanced Cluster Management, Quay, and Red Hat Trusted Software Supply Chain components.

**Key achievement:** Successfully identified operator dependencies that vary across OpenShift minor releases (4.16-4.21) using official Red Hat documentation, enabling accurate disconnected/airgap installation configurations.

**This process must be replicated** for DOC-059's automated minor release update pipeline, which will systematically handle version-aware updates for all install-config.yaml, agent-config.yaml, and ImageSet configuration parameters.

---

## Problem Statement

### Challenge
Operator dependencies for Red Hat products vary significantly across OpenShift minor releases. For disconnected/airgap installations using oc-mirror, users must specify **exact operator package names** that exist in the catalog for their specific OpenShift version.

**Critical failures that occur when dependencies are incomplete:**
- oc-mirror fails to mirror complete operator sets
- Operator installation fails due to missing dependencies
- Multi-hour debugging cycles in disconnected environments
- Lost productivity and failed deployments

### Example: OpenShift Data Foundation (ODF)

**Problem discovered:**
- Original research identified 4 ODF operators: `odf-operator`, `ocs-operator`, `mcg-operator`, `local-storage-operator`
- Official Red Hat documentation lists **8-11 operators** depending on OpenShift version
- Missing operators: `odf-csi-addons-operator`, `ocs-client-operator`, `odf-prometheus-operator`, `recipe`, `rook-ceph-operator`, `cephcsi-operator` (4.17+), `odf-dependencies` (4.18+), `odf-external-snapshotter-operator` (4.20+)

**User feedback (exact quote):**
> "you may be leaving out several dependencies for the odf operator, which leads me to believe your research isn't nearly as thorough enough"

This feedback triggered a complete overhaul of the research methodology.

---

## Research Methodology (Successful Process)

### Phase 1: Identify Official Documentation Sources

**Goal:** Find authoritative Red Hat documentation for disconnected installations

**Process:**
1. Start with Red Hat Product Documentation portal: `https://docs.redhat.com/`
2. Navigate to product-specific documentation (e.g., "Red Hat OpenShift Data Foundation")
3. Locate **Planning** or **Installation** guides
4. Find **"Disconnected environment"** or **"Air-gapped installation"** sections
5. Identify version-specific PDFs (4.16, 4.17, 4.18, 4.19, 4.20, 4.21)

**Why PDFs?**
- PDFs contain complete package lists in bulleted format
- Less affected by web page rendering issues
- Can be downloaded and parsed offline
- Contain exact `opm index prune` and `oc-mirror` command examples

### Phase 2: Download and Parse Official Documentation

**Tools used:**
- `curl` - Download PDFs from docs.redhat.com
- `pdftotext` - Extract text from PDFs
- `grep` - Search for package names and bulleted lists

**Example command sequence:**

```bash
# Download ODF Planning PDF for specific version
curl -sL "https://docs.redhat.com/en/documentation/red_hat_openshift_data_foundation/4.20/pdf/planning_your_deployment/Red_Hat_OpenShift_Data_Foundation-4.20-Planning_your_deployment-en-US.pdf" -o /tmp/odf-4.20-planning.pdf

# Extract text and search for disconnected environment section
pdftotext /tmp/odf-4.20-planning.pdf - | grep -A 50 "disconnected environment" | grep -A 30 "package"

# Look for bulleted lists of operator packages
pdftotext /tmp/odf-4.20-planning.pdf - | grep -B 5 -A 20 "opm index prune\|oc-mirror\|ImageSetConfiguration"
```

**Key search terms:**
- "disconnected environment"
- "air-gapped"
- "mirror"
- "packages"
- "opm index prune"
- "oc-mirror"
- "ImageSetConfiguration"
- "operator packages"

### Phase 3: Extract Package Lists from Documentation

**ODF Example - Found in Chapter 10: "Disconnected environment"**

Documentation provides package lists in two formats:

**Format 1: opm index prune example**
```bash
opm index prune \
  -f registry.redhat.io/redhat/redhat-operator-index:v4.x \
  -p ocs-operator,odf-operator,mcg-operator,odf-csi-addons-operator,ocs-client-operator,odf-prometheus-operator,recipe,rook-ceph-operator \
  -t myregistry.example.com:5000/mirror/my-operator-index:v4.x
```

**Format 2: oc-mirror ImageSetConfiguration example**
```yaml
operators:
  - catalog: registry.redhat.io/redhat/redhat-operator-index:v4.20
    packages:
      - name: ocs-operator
      - name: odf-operator
      - name: mcg-operator
      - name: odf-csi-addons-operator
      - name: ocs-client-operator
      - name: odf-prometheus-operator
      - name: recipe
      - name: rook-ceph-operator
      - name: cephcsi-operator
      - name: odf-dependencies
      - name: odf-external-snapshotter-operator
```

**Extraction process:**
1. Locate the disconnected installation chapter/section
2. Find opm or oc-mirror command examples
3. Extract package names from `-p` flag or `packages:` YAML list
4. Cross-reference bulleted lists in prerequisites/requirements sections
5. Note any version-specific additions or removals

### Phase 4: Cross-Version Comparison

**Process:**
1. Download documentation for **all supported versions** (4.16-4.21)
2. Extract package lists for each version
3. Create comparison matrix showing deltas

**ODF Version Comparison Matrix:**

| Package | 4.16 | 4.17 | 4.18 | 4.19 | 4.20 | 4.21 |
|---------|------|------|------|------|------|------|
| ocs-operator | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| odf-operator | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| mcg-operator | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| odf-csi-addons-operator | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ocs-client-operator | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| odf-prometheus-operator | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| recipe | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| rook-ceph-operator | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **cephcsi-operator** | ❌ | **✅ NEW** | ✅ | ✅ | ✅ | ✅ |
| **odf-dependencies** | ❌ | ❌ | **✅ NEW** | ✅ | ✅ | ✅ |
| **odf-external-snapshotter-operator** | ❌ | ❌ | ❌ | ❌ | **✅ NEW** | ✅ |

**Findings:**
- **Base ODF:** 8 operators in 4.16
- **4.17 addition:** +1 operator (cephcsi-operator) = 9 total
- **4.18 addition:** +1 operator (odf-dependencies) = 10 total  
- **4.20 addition:** +1 operator (odf-external-snapshotter-operator) = 11 total
- **4.19, 4.21:** No changes from previous minor release

### Phase 5: Validate Package Names Against Operator Catalog

**Goal:** Confirm exact package names match Red Hat operator catalog

**Methods:**

**Method 1: GitHub Operator Catalog Repositories**
```bash
# Search Red Hat operator index repository
curl -sL "https://api.github.com/repos/redhat-openshift-ecosystem/certified-operators/contents/operators" | grep '"name".*operator-name'
```

**Method 2: OpenShift OperatorHub Query**
```bash
# On a live OpenShift cluster
oc get packagemanifests -n openshift-marketplace | grep operator-name
oc describe packagemanifest/operator-name -n openshift-marketplace
```

**Method 3: Documentation Cross-Reference**
- Check Red Hat Ecosystem Catalog: `https://catalog.redhat.com/`
- Search operator by display name
- Verify package name in "Operator Details" section

**Confidence Levels Assigned:**
- ✅ **Confirmed:** Package name verified in multiple sources (docs, catalog, GitHub)
- ⚠️ **High Confidence:** Package name from official docs but not yet verified in live catalog
- ❌ **Unconfirmed:** Package name inferred but not documented

### Phase 6: Special Cases - Dependencies and Optional Operators

**ACM (Advanced Cluster Management) Example:**

**Research finding:**
- Official ACM docs explicitly state: *"you need to include the following package names in your list: advanced-cluster-management, multicluster-engine"*
- Multicluster-engine is **required**, not optional
- Missing this dependency causes ACM installation to fail

**Source:** [ACM 2.14 Install PDF](https://docs.redhat.com/en/documentation/red_hat_advanced_cluster_management_for_kubernetes/2.14/pdf/install/), Chapter 1.3.2

**Key quote from documentation:**
> "If you are creating a partial or filtered mirrored catalog, for which you identify particular packages to be included, you need to include the following package names in your list: advanced-cluster-management, multicluster-engine"

**Quay Example:**

**Research finding:**
- Base Quay requires: `quay-operator` only
- OpenShift integration requires: `quay-operator` + `quay-bridge-operator`
- Container Security Operator: **DEPRECATED** (replaced by RHACS)

**Sources:**
- [Quay Operator GitHub](https://github.com/quay/quay-operator)
- [Quay Bridge Operator GitHub](https://github.com/quay/quay-bridge-operator)
- [Quay 3.7 Documentation](https://access.redhat.com/documentation/en-us/red_hat_quay/3.7/)
- [CSO Deprecation Notice](https://docs.redhat.com/en/documentation/red_hat_quay/3.17/html/red_hat_quay_operator_features/container-security-operator-setup)

---

## Research Sources - Complete Index

### OpenShift Data Foundation (ODF)

**Planning Documentation - Disconnected Environment Section:**
- [ODF 4.16 Planning](https://docs.redhat.com/en/documentation/red_hat_openshift_data_foundation/4.16/html/planning_your_deployment/disconnected-environment_rhodf)
- [ODF 4.17 Planning](https://docs.redhat.com/en/documentation/red_hat_openshift_data_foundation/4.17/html/planning_your_deployment/disconnected-environment_rhodf)
- [ODF 4.18 Planning](https://docs.redhat.com/en/documentation/red_hat_openshift_data_foundation/4.18/html/planning_your_deployment/disconnected-environment_rhodf)
- [ODF 4.19 Planning](https://docs.redhat.com/en/documentation/red_hat_openshift_data_foundation/4.19/html/planning_your_deployment/disconnected-environment_rhodf)
- [ODF 4.20 Planning](https://docs.redhat.com/en/documentation/red_hat_openshift_data_foundation/4.20/html/planning_your_deployment/disconnected-environment_rhodf)
- [ODF 4.21 Planning](https://docs.redhat.com/en/documentation/red_hat_openshift_data_foundation/4.21/html/planning_your_deployment/disconnected-environment_rhodf)

**PDF Versions (preferred for parsing):**
- https://docs.redhat.com/en/documentation/red_hat_openshift_data_foundation/4.20/pdf/planning_your_deployment/

**Disaster Recovery Operators:**
- Found in same planning documents under "Regional-DR" and "Metro-DR" configuration sections
- Additional packages: `odf-multicluster-orchestrator`, `odr-cluster-operator`, `odr-hub-operator`

### Advanced Cluster Management (ACM)

**Install Documentation - Disconnected Installation Section:**
- [ACM 2.14 Install PDF](https://docs.redhat.com/en/documentation/red_hat_advanced_cluster_management_for_kubernetes/2.14/pdf/install/)
- [ACM 2.10 Install](https://docs.redhat.com/en/documentation/red_hat_advanced_cluster_management_for_kubernetes/2.10/html-single/install/)
- [ACM 2.5 Multicluster Engine - Disconnected](https://docs.redhat.com/en/documentation/red_hat_advanced_cluster_management_for_kubernetes/2.5/html/multicluster_engine/install-on-disconnected-networks)

**Critical section:** Chapter 1.3.2 - "Installing in disconnected environments"

### Red Hat Quay

**Operator Documentation:**
- [Quay Operator Features](https://docs.redhat.com/en/documentation/red_hat_quay/3/html-single/red_hat_quay_operator_features/)
- [Quay 3.6 Operator Installation](https://docs.redhat.com/en/documentation/red_hat_quay/3.6/html/deploy_red_hat_quay_on_openshift_with_the_quay_operator/installing_the_quay_operator_from_operatorhub)
- [Quay 3.7 Bridge Operator](https://access.redhat.com/documentation/en-us/red_hat_quay/3.7/html/manage_red_hat_quay/quay-bridge-operator)

**GitHub Repositories:**
- [quay-operator](https://github.com/quay/quay-operator)
- [quay-bridge-operator](https://github.com/quay/quay-bridge-operator)

**Container Security Operator (Deprecated):**
- [CSO Documentation](https://docs.redhat.com/en/documentation/red_hat_quay/3.17/html/red_hat_quay_operator_features/container-security-operator-setup)
- [Red Hat Ecosystem Catalog](https://catalog.redhat.com/en/software/container-stacks/detail/601aa650895df448347e722f)

### Red Hat Trusted Software Supply Chain

**Trusted Artifact Signer (RHTAS):**
- [RHTAS Deployment Guide](https://docs.redhat.com/en/documentation/red_hat_trusted_artifact_signer/1/html-single/deployment_guide/)
- [RHTAS Operator - Ecosystem Catalog](https://catalog.redhat.com/en/software/containers/rhtas/rhtas-rhel9-operator/65e79775f4abd6689b4f056c)
- [RHTAS Developer Tutorial](https://developers.redhat.com/learning/learn:install-sign-verify-using-red-hat-trusted-artifact-signer/)
- [secure-sign-operator GitHub](https://github.com/securesign/secure-sign-operator)

**Trusted Profile Analyzer (RHTPA):**
- [RHTPA 2.2 Deployment Guide](https://docs.redhat.com/en/documentation/red_hat_trusted_profile_analyzer/2.2/html-single/deployment_guide/)
- [RHTPA Helm Chart](https://artifacthub.io/packages/helm/openshift/redhat-trusted-profile-analyzer)
- [trustification GitHub Organization](https://github.com/trustification/)

**Trusted Application Pipeline (RHTAP):**
- [RHTAP 1.0 Release Notes](https://docs.redhat.com/en/documentation/red_hat_trusted_application_pipeline/1.0/html-single/release_notes_for_red_hat_trusted_application_pipeline_1.0/)
- [RHTAP Getting Started](https://docs.redhat.com/en/documentation/red_hat_trusted_application_pipeline/1.3/html-single/getting_started_with_red_hat_trusted_application_pipeline/)
- [Tekton Chains Documentation](https://tekton.dev/docs/chains/config/)

### General Resources

**OpenShift Disconnected Installation:**
- [OCP 4.20 Disconnected Environments](https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/disconnected_environments/)
- [oc-mirror Plugin Documentation](https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/disconnected_environments/installing-mirroring-disconnected)

**Operator Lifecycle Manager (OLM):**
- [Using OLM on Restricted Networks](https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html/operators/administrator-tasks#olm-restricted-networks)

---

## Lessons Learned - Critical Insights for DOC-059

### 1. **PDF Documentation is More Reliable Than Web Pages**

**Why:**
- PDFs contain complete command examples with full package lists
- Less affected by dynamic web page rendering
- Can be parsed offline for automation
- Stable URLs per version (e.g., `/4.20/pdf/` vs `/4.20/html/`)

**Recommendation for DOC-059:**
- Always download PDF versions of Planning and Installation guides
- Parse PDFs with `pdftotext` for package extraction
- Cache PDFs locally for repeat parsing

### 2. **Bulleted Lists in "Disconnected" Sections are Authoritative**

**Pattern observed:**
Red Hat documentation consistently provides operator package lists in these sections:
- "Disconnected environment" (ODF)
- "Installing in disconnected environments" (ACM)
- "Air-gapped installation" (various products)
- "Mirror operator catalog" (OpenShift docs)

**Search strategy:**
```bash
pdftotext doc.pdf - | grep -B 10 -A 50 "disconnected\|air-gapped\|mirror" | grep -A 30 "package\|operator"
```

### 3. **Version-Specific Changes Follow Patterns**

**Observed patterns:**
- **Minor additions:** New operators added in point releases (e.g., cephcsi-operator in 4.17)
- **Dependency additions:** New dependencies added for features (e.g., odf-dependencies in 4.18)
- **Carry-forward:** Operators added in version X.Y remain in all subsequent versions
- **Deprecations:** Rare but happen (container-security-operator)

**Automation strategy:**
- Start with previous version's list
- Parse new version docs
- Identify delta (additions/removals)
- Carry forward unchanged operators
- Annotate changes with "NEW in 4.X" or "REMOVED in 4.X"

### 4. **Package Names vs Display Names - Critical Distinction**

**Examples:**
- Display: "Red Hat Trusted Artifact Signer" → Package: `trusted-artifact-signer`
- Display: "OpenShift GitOps" → Package: `openshift-gitops-operator`
- Display: "Red Hat Quay" → Package: `quay-operator`

**Rule:** Always use **package names** from `packagemanifest` or oc-mirror examples, NOT display names from web UIs

### 5. **Cross-Reference Multiple Sources for Confidence**

**Confidence hierarchy:**
1. ✅ **Highest:** Package name in official docs + GitHub operator repo + Red Hat Ecosystem Catalog
2. ⚠️ **High:** Package name in official docs + logical naming pattern
3. ❌ **Low:** Inferred from product name without documentation

**Example - High confidence:**
- `trusted-profile-analyzer-operator` found in:
  - GitHub trustification/trusted-profile-analyzer-operator repo
  - ArtifactHub Helm chart references
  - Deployment guide OLM installation instructions

### 6. **"Required" vs "Optional" Dependencies Must Be Distinguished**

**Critical distinction:**
- **Required:** Installation fails without it (e.g., multicluster-engine for ACM)
- **Optional:** Enhances functionality (e.g., quay-bridge-operator for Quay)
- **Conditional:** Required for specific configurations (e.g., DR operators for ODF disaster recovery)

**Documentation signals:**
- Required: "you need to include", "must include", "required packages"
- Optional: "optionally add", "if you want to enable", "for advanced features"

---

## Application to DOC-059: Automated Version-Aware Update Pipeline

### Overview of DOC-059

DOC-059 aims to create an **automated pipeline** for updating OpenShift version-specific parameters when new minor releases are published. This includes:

1. **install-config.yaml parameters** (platform-specific fields, networking, advanced options)
2. **agent-config.yaml parameters** (host inventory, rendezvous IP, etc.)
3. **ImageSet configuration** (oc-mirror operator packages, mirroring options)
4. **Operator dependencies** (exactly what we just completed manually)
5. **Documentation references** (Field Guide sources, tooltip examples)

### How This Research Process Applies to DOC-059

#### Step 1: Automated Documentation Retrieval

**Process to automate:**
```bash
# For each new OpenShift minor release (e.g., 4.22):

# Download install-config.yaml parameter docs
curl -sL "https://docs.redhat.com/en/documentation/openshift_container_platform/4.22/pdf/installing/" -o ocp-4.22-installing.pdf

# Download agent-config.yaml docs
curl -sL "https://docs.redhat.com/en/documentation/openshift_container_platform/4.22/pdf/installing_on_a_single_node/" -o ocp-4.22-agent-based.pdf

# Download oc-mirror docs
curl -sL "https://docs.redhat.com/en/documentation/openshift_container_platform/4.22/pdf/disconnected_environments/" -o ocp-4.22-disconnected.pdf

# Download product-specific docs (ODF, ACM, etc.)
curl -sL "https://docs.redhat.com/en/documentation/red_hat_openshift_data_foundation/4.22/pdf/planning_your_deployment/" -o odf-4.22-planning.pdf
```

**Automation note:** URL patterns are consistent across versions - replace `4.20` with `4.22` in URLs

#### Step 2: Parse openshift-install Binary for Parameter Changes

**Process:**
```bash
# Download latest openshift-install binary
curl -O https://mirror.openshift.com/pub/openshift-v4/clients/ocp/4.22.0/openshift-install-linux.tar.gz
tar -xzf openshift-install-linux.tar.gz

# Extract install-config.yaml and agent-config.yaml schemas
./openshift-install create install-config --help
./openshift-install agent create install-config --help

# Compare against previous version schemas (4.21)
diff <(./openshift-install-4.21 create install-config --help) <(./openshift-install-4.22 create install-config --help)
```

**Delta analysis:**
- New fields added
- Fields removed or deprecated
- Changed allowed values
- Changed default values
- Changed field types

#### Step 3: Parse Documentation PDFs for Operator Dependencies

**Automated extraction process:**
```bash
# Extract operator package lists from ODF docs
pdftotext odf-4.22-planning.pdf - | \
  grep -A 50 "disconnected environment" | \
  grep -A 30 "packages\|opm index prune\|ImageSetConfiguration" | \
  grep -oE '(name: [a-z0-9-]+|[a-z0-9-]+operator)' | \
  sort -u > odf-4.22-packages.txt

# Compare against previous version
diff odf-4.21-packages.txt odf-4.22-packages.txt

# Identify additions and removals
comm -13 odf-4.21-packages.txt odf-4.22-packages.txt  # Additions
comm -23 odf-4.21-packages.txt odf-4.22-packages.txt  # Removals
```

#### Step 4: Build Version-Aware Parameter Catalog

**Current structure:** `data/params/4.20/*.json` (manually maintained)

**Automated structure:**
```
data/params/
  4.20/
    bare-metal-agent.json
    vsphere-ipi.json
    ...
  4.21/
    bare-metal-agent.json  (delta from 4.20)
    vsphere-ipi.json      (delta from 4.20)
    ...
  4.22/
    bare-metal-agent.json  (delta from 4.21)
    vsphere-ipi.json      (delta from 4.21)
    ...
```

**Delta file format (proposed):**
```json
{
  "version": "4.22",
  "baseVersion": "4.21",
  "changes": {
    "added": [
      {
        "path": "platform.aws.newField",
        "type": "string",
        "required": false,
        "description": "...",
        "source": "https://docs.redhat.com/..."
      }
    ],
    "removed": [
      "platform.vsphere.deprecatedField"
    ],
    "modified": [
      {
        "path": "networking.clusterNetwork.cidr",
        "change": "default value changed from X to Y"
      }
    ]
  }
}
```

#### Step 5: Operator Quick Pick Version Mapping

**What we just did manually:**
```javascript
{
  id: "odf",
  label: "OpenShift Data Foundation (Base)",
  versionPicks: {
    "4.16": { redhat: [8 operators] },
    "4.17": { redhat: [9 operators] },
    "4.18": { redhat: [10 operators] },
    "4.20": { redhat: [11 operators] },
    "4.21": { redhat: [11 operators] },
    "default": { redhat: [11 operators] }
  }
}
```

**Automated process:**
1. Parse ODF docs for each version (4.16-4.22)
2. Extract operator package lists
3. Build version mapping automatically
4. Generate JavaScript quick pick definition
5. Update OperatorsStep.jsx with new version

**Script outline:**
```bash
#!/bin/bash
# auto-generate-operator-quick-picks.sh

VERSION="4.22"
PREV_VERSION="4.21"

# Download ODF docs
curl -sL "https://docs.redhat.com/en/documentation/red_hat_openshift_data_foundation/${VERSION}/pdf/planning_your_deployment/" -o /tmp/odf-${VERSION}.pdf

# Extract packages
PACKAGES=$(pdftotext /tmp/odf-${VERSION}.pdf - | grep -A 50 "disconnected" | grep -oE 'name: [a-z0-9-]+' | cut -d' ' -f2 | sort -u | tr '\n' ',' | sed 's/,$//')

# Compare with previous version
diff <(cat data/odf-${PREV_VERSION}-packages.txt) <(echo "$PACKAGES")

# Generate version pick entry
cat >> frontend/src/steps/OperatorsStep.jsx <<EOF
    "${VERSION}": { redhat: [${PACKAGES}] },
EOF
```

#### Step 6: Validation Against Live Catalog

**Current gap:** No automated validation that package names exist in catalog

**Proposed automation:**
```bash
# For OpenShift 4.22, verify all operator package names exist in catalog

# Download operator index
oc-mirror list operators --catalog=registry.redhat.io/redhat/redhat-operator-index:v4.22 > /tmp/catalog-4.22.txt

# Verify each operator package exists
for pkg in ocs-operator odf-operator mcg-operator ...; do
  if ! grep -q "^${pkg}$" /tmp/catalog-4.22.txt; then
    echo "ERROR: Package ${pkg} not found in catalog for 4.22"
  fi
done
```

### Recommended Automation Architecture for DOC-059

```
scripts/version-update-pipeline/
  1-download-docs.sh           # Download PDFs for new version
  2-parse-install-config.sh    # Extract install-config params from binary + docs
  3-parse-agent-config.sh      # Extract agent-config params
  4-parse-operators.sh         # Extract operator package lists
  5-build-delta-catalog.sh     # Compare with previous version, build delta JSON
  6-validate-against-catalog.sh # Verify package names exist
  7-generate-quick-picks.sh    # Auto-generate OperatorsStep.jsx updates
  8-update-tooltips.sh         # Update tooltips with new version examples
  9-update-field-guide.sh      # Update Field Guide doc sources
  run-all.sh                   # Orchestrate full pipeline
  
config/
  doc-urls.json                # URL patterns for each doc type
  parser-rules.json            # Regex patterns for extracting params
  operator-products.json       # List of products to track (ODF, ACM, etc.)
  
output/
  4.22/
    delta-catalog.json         # Deltas from 4.21
    operator-packages.json     # All operator package lists
    validation-report.txt      # Validation results
    changelog.md              # Human-readable summary
```

### Implementation Phases for DOC-059

**Phase 1: Documentation Retrieval (1-2 days)**
- Implement automated PDF download for all doc types
- Handle authentication/session if needed
- Cache PDFs locally
- Version detection (when new release available)

**Phase 2: Parameter Parsing (2-3 days)**
- Parse openshift-install binary schemas
- Extract install-config parameters from PDFs
- Extract agent-config parameters
- Build parameter catalog JSON files

**Phase 3: Operator Package Parsing (1-2 days)**
- Extract operator packages from product docs (ODF, ACM, Quay, etc.)
- Build version-aware package mappings
- Handle additions/removals/deprecations

**Phase 4: Delta Analysis & Validation (1-2 days)**
- Compare new version against previous version
- Build delta JSON files
- Validate package names against live catalog
- Generate human-readable changelogs

**Phase 5: Code Generation (2-3 days)**
- Auto-generate OperatorsStep.jsx quick pick updates
- Auto-generate catalog JSON updates
- Auto-update tooltip examples where version-specific
- Auto-update Field Guide doc sources

**Phase 6: Testing & Verification (1-2 days)**
- Automated tests for pipeline scripts
- Manual verification of generated code
- Cross-reference with official docs
- Sign-off checklist

**Total estimated time:** 8-14 days for full automation pipeline

---

## Culmination Files - Research Outputs

All research from this process has been documented in:

### 1. `.research/operator-dependencies-4.20.md`
- Complete ODF package lists for versions 4.16-4.21
- Official Red Hat documentation sources
- Version comparison matrix
- Disaster Recovery operator details

### 2. `.research/ODF_OPERATOR_CORRECTION_SUMMARY.md`
- Summary of what was wrong with original research
- Complete list of missing operators
- Before/after comparison
- Impact analysis

### 3. `.research/COMPREHENSIVE_OPERATOR_QUICK_PICKS_SUMMARY.md`
- All 18 quick picks documented
- 3 updated existing quick picks
- 5 new quick picks added
- Complete research sources
- Testing results

### 4. `.research/ACM_QUAY_TRUSTED_SUPPLY_CHAIN_OPERATORS.md`
- ACM multicluster-engine dependency research
- Quay operator package details
- Trusted Software Supply Chain components breakdown
- Package name confidence levels
- Prerequisites and deployment notes

### 5. `.research/ACM_QUAY_TRUSTED_SUPPLY_CHAIN_UPDATE_SUMMARY.md`
- Implementation summary
- Changes made to OperatorsStep.jsx
- Complete operator list (21 quick picks)
- Testing notes
- User impact

### 6. `.research/OPERATOR_VERSION_AWARE_RESEARCH_PROCESS.md` (THIS FILE)
- Complete research methodology
- All sources indexed
- Lessons learned
- Application to DOC-059 automation
- Recommended automation architecture

---

## Recommendations for DOC-059 Implementation

### 1. Start with Operator Package Automation

**Why:** Most straightforward, well-documented, proven methodology from DOC-063

**Steps:**
1. Implement automated PDF download for product docs
2. Build parser for disconnected environment sections
3. Generate operator package JSON files
4. Auto-update OperatorsStep.jsx with version mappings

**Deliverable:** Working automation for operator packages across all supported OpenShift versions

### 2. Expand to install-config.yaml Parameters

**Next priority:** install-config.yaml field definitions

**Why:** Core configuration file, most parameters, highest impact

**Complexity:** Higher than operators (more field types, validation rules, platform-specific logic)

### 3. Then agent-config.yaml and ImageSet Configuration

**Lower complexity:** Fewer parameters, more standardized

**Automation similar to install-config.yaml**

### 4. Finally: Documentation and Tooltip Updates

**Last phase:** Auto-update tooltips and Field Guide sources to reference correct version docs

**Lower priority but important for completeness**

---

## Success Metrics for DOC-059

### Automation Goals

1. **Speed:** New version support in < 1 day (vs. weeks of manual work)
2. **Accuracy:** 100% of parameters match official docs (verified against catalog)
3. **Completeness:** No missing dependencies (all required operators identified)
4. **Maintainability:** Clear delta tracking (what changed between versions)
5. **Reproducibility:** Fully automated, no manual steps

### Quality Metrics

1. **Documentation traceability:** Every parameter links to official source
2. **Version coverage:** All supported versions (4.16-4.22+) included
3. **Validation pass rate:** 100% of package names exist in catalog
4. **Zero regressions:** No existing functionality broken by automation

---

## Conclusion

This document captures the **complete research process, sources, and methodology** for creating version-aware operator quick picks. The process is **proven, documented, and ready to be automated** for DOC-059.

**Key takeaway:** Manual research for DOC-063 took ~8 hours across 2 days. With automation (DOC-059), this process should complete in **minutes**, with higher accuracy and completeness.

**The research methodology documented here provides the blueprint for DOC-059's automation pipeline.**

---

**Author:** Claude Sonnet 4.5 (AI Assistant)  
**Human Collaborator:** Bill Strauss  
**Project:** OpenShift Airgap Architect  
**Date:** 2026-05-11
