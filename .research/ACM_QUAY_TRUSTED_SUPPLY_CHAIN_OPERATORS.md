# ACM, Quay, and Trusted Supply Chain Operators Research

**Date:** 2026-05-11  
**Task:** DOC-063 - Complete operator quick pick dependencies  
**Purpose:** Research missing operators for ACM, Quay, and Red Hat Trusted Software Supply Chain

---

## Advanced Cluster Management (ACM)

### Required Packages for Disconnected Installation

Per [ACM 2.14 Install Documentation](https://docs.redhat.com/en/documentation/red_hat_advanced_cluster_management_for_kubernetes/2.14/pdf/install/):

When creating a partial/filtered mirrored catalog for disconnected environments, you MUST include both:

1. **advanced-cluster-management** - Main ACM operator
2. **multicluster-engine** - Required dependency for ACM

**Quote from documentation:**
> "If you are creating a partial or filtered mirrored catalog, for which you identify particular packages to be included, you need to include the following package names in your list:
> - advanced-cluster-management
> - multicluster-engine"

### Example ImageSetConfiguration

```yaml
operators:
  - catalog: registry.redhat.io/redhat/redhat-operator-index:v4.11
    packages:
      - name: advanced-cluster-management
      - name: multicluster-engine
```

### Sources

- [ACM 2.14 Install - Disconnected Environments](https://docs.redhat.com/en/documentation/red_hat_advanced_cluster_management_for_kubernetes/2.14/pdf/install/)
- [ACM 2.5 Multicluster Engine - Disconnected Networks](https://docs.redhat.com/en/documentation/red_hat_advanced_cluster_management_for_kubernetes/2.5/html/multicluster_engine/install-on-disconnected-networks)
- [ACM 2.10 Install Documentation](https://docs.redhat.com/en/documentation/red_hat_advanced_cluster_management_for_kubernetes/2.10/html-single/install/)

---

## Red Hat Quay

### Available Operators

1. **quay-operator** - Main Red Hat Quay operator
   - Package name: `quay-operator`
   - Purpose: Deploy and manage Red Hat Quay registry on OpenShift
   - Required for: Quay container registry deployment
   - Source: [Quay Operator GitHub](https://github.com/quay/quay-operator)

2. **quay-bridge-operator** - Quay/OpenShift Integration (Optional)
   - Package name: `quay-bridge-operator` (assumed, not confirmed in catalog)
   - Purpose: Replace integrated OpenShift registry with Quay
   - Features:
     - Synchronize OpenShift namespaces as Quay organizations
     - Create robot accounts for service accounts
     - Synchronize ImageStreams as Quay repositories
   - Prerequisites: Existing Quay deployment with OAuth access token
   - Required for: Using Quay as default OpenShift image registry
   - Source: [Quay Bridge Operator GitHub](https://github.com/quay/quay-bridge-operator)
   - Documentation: [Quay 3.7 Bridge Operator](https://access.redhat.com/documentation/en-us/red_hat_quay/3.7/html/manage_red_hat_quay/quay-bridge-operator)

3. **container-security-operator** - Container Security (DEPRECATED)
   - Package name: `container-security-operator`
   - Status: **DEPRECATED** - Planned for removal in future releases
   - Replacement: Red Hat Advanced Cluster Security (RHACS)
   - Purpose: Surface image vulnerability scan results in OpenShift
   - Dependencies: Requires Red Hat Quay and Clair
   - Source: [Container Security Operator Catalog](https://catalog.redhat.com/en/software/container-stacks/detail/601aa650895df448347e722f)
   - Note: Do NOT include in new deployments, use RHACS instead

### Recommendation for Quick Picks

**Base Quay Quick Pick:**
- quay-operator (only)

**Quay + OpenShift Integration Quick Pick:**
- quay-operator
- quay-bridge-operator

**Do NOT include:**
- container-security-operator (deprecated, replaced by RHACS which is already in Platform Plus)

### Sources

- [Quay Operator Features Documentation](https://docs.redhat.com/en/documentation/red_hat_quay/3/html-single/red_hat_quay_operator_features/)
- [Quay 3.6 Operator Installation](https://docs.redhat.com/en/documentation/red_hat_quay/3.6/html/deploy_red_hat_quay_on_openshift_with_the_quay_operator/installing_the_quay_operator_from_operatorhub)
- [Container Security Operator (CSO) Deprecation](https://docs.redhat.com/en/documentation/red_hat_quay/3.17/html/red_hat_quay_operator_features/container-security-operator-setup)

---

## Red Hat Trusted Software Supply Chain

### Component 1: Red Hat Trusted Artifact Signer (RHTAS)

**Operator:** trusted-artifact-signer

**Package name:** `trusted-artifact-signer` (confirmed in OLM console references)

**Components deployed:**
- Fulcio - Certificate authority for code signing
- Rekor - Transparency log for artifact signatures
- TSA - Timestamping authority
- TUF - The Update Framework for secure software updates

**Prerequisites:**
- OpenShift Container Platform 4.16 or later
- OIDC provider configured (Red Hat SSO, Google, AWS STS, or GitHub)

**Deployment:**
- Installs via OperatorHub
- Operator goes into `openshift-operators` namespace
- Creates `trusted-artifact-signer` project automatically
- All dependencies installed automatically by operator

**Disconnected installation:**
- No specific disconnected documentation found in official docs
- Would follow standard operator mirroring with oc-mirror
- Package name: `trusted-artifact-signer`

**Sources:**
- [RHTAS Deployment Guide](https://docs.redhat.com/en/documentation/red_hat_trusted_artifact_signer/1/html-single/deployment_guide/)
- [RHTAS Operator - Red Hat Ecosystem Catalog](https://catalog.redhat.com/en/software/containers/rhtas/rhtas-rhel9-operator/65e79775f4abd6689b4f056c)
- [RHTAS Developer Tutorial](https://developers.redhat.com/learning/learn:install-sign-verify-using-red-hat-trusted-artifact-signer/resource/resources:install-and-deploy-red-hat-trusted-artifact-signer)
- [GitHub - secure-sign-operator](https://github.com/securesign/secure-sign-operator)

### Component 2: Red Hat Trusted Profile Analyzer (RHTPA)

**Operator:** trusted-profile-analyzer-operator

**Package name:** `trusted-profile-analyzer-operator` (found in GitHub trustification org)

**Purpose:** SBOM analysis and vulnerability management

**Deployment methods:**
- Operator-based (via OperatorHub)
- Helm chart available

**Prerequisites:**
- OpenShift Container Platform 4.17 or later
- OIDC provider (Red Hat SSO or AWS Cognito)
- Storage provider (ODF or Amazon S3)

**Status:** Technology Preview

**GitHub repositories:**
- [trusted-profile-analyzer-operator](https://github.com/trustification/trusted-profile-analyzer-operator)
- [trusted-profile-analyzer-operator-fbc](https://github.com/trustification/trusted-profile-analyzer-operator-fbc) (File-Based Catalog)

**Sources:**
- [RHTPA 2 Deployment Guide](https://docs.redhat.com/en/documentation/red_hat_trusted_profile_analyzer/2.2/html-single/deployment_guide/)
- [RHTPA Helm Chart - Artifact Hub](https://artifacthub.io/packages/helm/openshift/redhat-trusted-profile-analyzer)
- [RHTPA Operator Catalog - Red Hat Ecosystem](https://catalog.redhat.com/en/software/containers/rhtpa-tech-preview/trustification-service-rhel9/)

### Component 3: Red Hat Trusted Application Pipeline (RHTAP)

**NOT operator-based** - This is a managed service/framework

**What it is:**
- Built on Red Hat OpenShift Pipelines (Tekton)
- Uses Tekton Chains for supply chain security
- Integrates with RHTAS for signing
- Part of Red Hat Advanced Developer Suite

**Components used:**
- OpenShift Pipelines (openshift-pipelines-operator-rh) - already in quick picks
- OpenShift GitOps (openshift-gitops-operator) - already in quick picks
- Tekton Chains (part of OpenShift Pipelines)

**Deployment:**
- Requires existing OpenShift Pipelines and GitOps operators
- Configuration via TektonConfig and Chains ConfigMap
- Not a standalone operator package

**Disconnected installation:**
- No specific disconnected documentation found
- Would use existing Tekton operator mirroring
- Configuration in air-gapped environments requires manual ConfigMap setup

**Sources:**
- [RHTAP 1.0 Release Notes](https://docs.redhat.com/en/documentation/red_hat_trusted_application_pipeline/1.0/html-single/release_notes_for_red_hat_trusted_application_pipeline_1.0/)
- [RHTAP Getting Started Guide](https://docs.redhat.com/en/documentation/red_hat_trusted_application_pipeline/1.3/html-single/getting_started_with_red_hat_trusted_application_pipeline/)
- [Tekton Chains Documentation](https://tekton.dev/docs/chains/config/)
- [Operating Tekton at Scale - Red Hat Blog](https://www.redhat.com/en/blog/operating-tekton-scale-10-lessons-learned)

---

## Summary and Recommendations

### ACM Quick Pick Update

**Current:** Platform Plus includes `advanced-cluster-management`  
**Update needed:** Add `multicluster-engine`

### Quay Quick Picks

**Option 1: Red Hat Quay (Base)**
- quay-operator

**Option 2: Red Hat Quay + OpenShift Integration**
- quay-operator
- quay-bridge-operator

**Do NOT create:**
- Container Security quick pick (operator is deprecated)

### Trusted Software Supply Chain Quick Pick

**Name:** "Red Hat Trusted Software Supply Chain"  
**Operators:**
- trusted-artifact-signer (RHTAS)
- trusted-profile-analyzer-operator (RHTPA)

**Note:** RHTAP does not require additional operators beyond OpenShift Pipelines and GitOps, which are already available in other quick picks.

**Prerequisites note for users:**
- Requires OpenShift Pipelines (available in "CI/CD" quick pick)
- Requires OpenShift GitOps (available in "GitOps" quick pick)
- Consider suggesting "App Development Suite" quick pick which includes both

---

## Package Name Confidence Levels

| Operator | Package Name | Confidence | Source |
|----------|--------------|------------|--------|
| ACM | advanced-cluster-management | ✅ Confirmed | Official ACM docs |
| Multicluster Engine | multicluster-engine | ✅ Confirmed | Official ACM docs |
| Quay | quay-operator | ✅ Confirmed | Multiple sources, GitHub |
| Quay Bridge | quay-bridge-operator | ⚠️ Likely | GitHub repo name, not confirmed in catalog |
| Container Security | container-security-operator | ✅ Confirmed (deprecated) | Red Hat Ecosystem Catalog |
| RHTAS | trusted-artifact-signer | ✅ Confirmed | OLM console references in docs |
| RHTPA | trusted-profile-analyzer-operator | ⚠️ Likely | GitHub repo name in trustification org |

**Action items:**
1. Update Platform Plus to include multicluster-engine ✅
2. Create Quay base quick pick ✅
3. Create Quay + Bridge integration quick pick ✅
4. Create Trusted Software Supply Chain quick pick ✅
5. Test operator names against actual OpenShift OperatorHub if possible

---

## Testing Notes

Since this project doesn't have live catalog data files, operator package names are based on:
- Official Red Hat documentation
- GitHub repository names
- Red Hat Ecosystem Catalog listings
- OpenShift OperatorHub console references in documentation

**Recommended verification:**
```bash
oc get packagemanifests -n openshift-marketplace | grep -E 'quay|trusted|multicluster'
```

This will confirm exact package names in a live OpenShift environment.
