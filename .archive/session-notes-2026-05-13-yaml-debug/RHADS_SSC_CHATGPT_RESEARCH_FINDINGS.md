# RHADS - SSC ChatGPT Research Findings - Final Status

**Date:** 2026-05-11  
**Research Source:** ChatGPT operator catalog verification  
**Task:** DOC-063 - Trusted Software Supply Chain operator quick pick investigation  
**Final Decision:** ❌ **DO NOT ADD** this quick pick

---

## Executive Summary

ChatGPT research confirmed that:
1. **Correct product name:** Red Hat Advanced Developer Suite - Software Supply Chain (RHADS - SSC), NOT "Trusted Software Supply Chain"
2. **Correct package names:** `rhtas-operator`, `rhtpa-operator`, `rhdh`, `rhbk-operator` (our original research had wrong names)
3. **CRITICAL LIMITATION:** Red Hat explicitly does NOT support RHADS - SSC in air-gapped environments

**Decision:** Do NOT create a quick pick for RHADS - SSC because it would mislead users into thinking they can deploy this solution in disconnected environments when Red Hat explicitly doesn't support this configuration.

---

## ChatGPT Research Results

### Product Information

**Official Name:** Red Hat Advanced Developer Suite - Software Supply Chain (RHADS - SSC)  
**Version:** 1.9 (as of May 2026)  
**Purpose:** Software supply chain security with artifact signing, SBOM analysis, and compliance

### Core Components

| Component | Version | Package Name | Channel | Notes |
|-----------|---------|--------------|---------|-------|
| Red Hat Developer Hub | 1.9 | `rhdh` | `fast-1.9` | Backstage-based developer platform |
| Red Hat Trusted Artifact Signer | 1.3 | `rhtas-operator` | default | Sigstore-based artifact signing |
| Red Hat Trusted Profile Analyzer | 2.2 | `rhtpa-operator` | default | SBOM analysis and vulnerability management |
| Red Hat build of Keycloak | varies | `rhbk-operator` | default | Identity and access management |
| Conforma | 0.7 | ❌ No OLM package | N/A | CLI-based tool, not an operator |

### Required OCP Subscription Products (Already Available)

| Component | Version | Package Name | Channel | Already in Quick Pick |
|-----------|---------|--------------|---------|----------------------|
| Red Hat Advanced Cluster Security | 4.10 | `rhacs-operator` | `stable` | ✅ Platform Plus |
| OpenShift Pipelines | 1.21 | `openshift-pipelines-operator-rh` | `pipelines-1.21` | ✅ CI/CD |
| OpenShift GitOps | 1.19 | `openshift-gitops-operator` | `gitops-1.19` | ✅ GitOps |

---

## Critical Limitation: No Air-Gapped Support

**Source:** [RHADS - SSC 1.9 Release Notes - Unsupported Environments](https://docs.redhat.com/en/documentation/red_hat_advanced_developer_suite_-_software_supply_chain/1.9/html-single/release_notes_for_red_hat_advanced_developer_suite_-_software_supply_chain_1.9/index#unsupported-environments_release-notes)

**Direct quote from ChatGPT research:**
> "Red Hat's RHADS - SSC 1.9 release notes explicitly say it does not support air-gapped environments. Mirroring the operators can still be useful for staging or partial disconnected workflows, but it does not make the full RHADS - SSC installer deployment air-gapped supported."

### Why This Matters

Our tool is **specifically designed for disconnected/airgap installations**. Adding a quick pick for RHADS - SSC would:

1. ❌ **Mislead users** - They would think they can deploy RHADS - SSC in their air-gapped environments
2. ❌ **Cause deployment failures** - Even if operators are mirrored, the full solution won't work
3. ❌ **Waste user time** - Hours of mirroring and deployment attempts would fail
4. ❌ **Damage tool credibility** - Users would lose trust in our quick picks

### What Users CAN Do

While RHADS - SSC as a whole doesn't support air-gapped environments, users can:

- ✅ Mirror individual operators for **staging/testing** in partial disconnected workflows
- ✅ Use **Platform Plus** for RHACS (runtime security and compliance)
- ✅ Use **App Development Suite** for OpenShift Pipelines + GitOps (CI/CD)
- ✅ Implement manual artifact signing workflows suitable for air-gapped environments

---

## Package Name Corrections

### What We Had Wrong

| Component | Our Original Research | Actual Package Name | Status |
|-----------|----------------------|---------------------|--------|
| RHTAS | `trusted-artifact-signer` | `rhtas-operator` | ❌ Wrong |
| RHTPA | `trusted-profile-analyzer-operator` | `rhtpa-operator` | ❌ Wrong |
| RHDH | `rhdh-operator` | `rhdh` | ❌ Wrong |

### What We Fixed

✅ Updated research documentation with correct package names  
✅ Fixed RHDH in Quality of Life quick pick: `rhdh-operator` → `rhdh`  
✅ Added comprehensive comment in OperatorsStep.jsx explaining why quick pick is not added  
✅ Updated package confidence table with verified names

---

## ChatGPT's Recommended ImageSetConfiguration

For reference only (NOT recommended for air-gapped deployments):

```yaml
apiVersion: mirror.openshift.io/v2alpha1
kind: ImageSetConfiguration

mirror:
  operators:
    - catalog: registry.redhat.io/redhat/redhat-operator-index:v4.20
      packages:
        - name: rhdh
          channels:
            - name: fast-1.9

        - name: rhtas-operator

        - name: rhtpa-operator

        - name: rhacs-operator
          channels:
            - name: stable

        - name: openshift-pipelines-operator-rh
          channels:
            - name: pipelines-1.21

        - name: openshift-gitops-operator
          channels:
            - name: gitops-1.19

        - name: rhbk-operator
```

**Note:** This configuration can mirror the operators, but the full RHADS - SSC deployment will NOT work in air-gapped environments per Red Hat's official documentation.

---

## Validation Commands

ChatGPT provided these commands for verifying package names against a live catalog:

### On a Connected OpenShift 4.20 Cluster

```bash
for p in \
  rhdh \
  rhtas-operator \
  rhtpa-operator \
  rhacs-operator \
  openshift-pipelines-operator-rh \
  openshift-gitops-operator \
  rhbk-operator
do
  echo "===== $p ====="
  oc get packagemanifest "$p" -n openshift-marketplace \
    -o jsonpath='defaultChannel={.status.defaultChannel}{"\n"}channels={range .status.channels[*]}{.name}{" "}{end}{"\n\n"}'
done
```

### From Mirroring Host

```bash
# List all operators in catalog
oc mirror list operators \
  --catalog registry.redhat.io/redhat/redhat-operator-index:v4.20

# List specific operator details
oc mirror list operators \
  --catalog registry.redhat.io/redhat/redhat-operator-index:v4.20 \
  --package openshift-pipelines-operator-rh
```

---

## Final Decision Rationale

### Why We're NOT Adding This Quick Pick

1. **Red Hat doesn't support it** - Explicitly documented as unsupported in air-gapped environments
2. **Would mislead users** - Creating the quick pick implies it works in disconnected environments
3. **Most components already available** - RHACS, Pipelines, GitOps, RHDH all in other quick picks
4. **Incomplete solution** - Even with operators mirrored, full deployment won't work

### What We Did Instead

1. ✅ Documented the limitation in research files
2. ✅ Added comprehensive comment in OperatorsStep.jsx explaining why it's not added
3. ✅ Fixed RHDH package name in existing Quality of Life quick pick
4. ✅ Updated research with correct package names for future reference
5. ✅ Provided alternative recommendations for users

### If Users Ask About This

**Recommended response:**

> Red Hat Advanced Developer Suite - Software Supply Chain (RHADS - SSC) is not supported in air-gapped environments per Red Hat's official documentation. However, you can achieve software supply chain security in disconnected environments using:
> 
> - **Platform Plus** quick pick - Includes RHACS for runtime security and compliance
> - **App Development Suite** quick pick - Includes OpenShift Pipelines and GitOps for CI/CD
> - **Quality of Life** quick pick - Includes Red Hat Developer Hub (RHDH)
> 
> For artifact signing in air-gapped environments, you'll need to implement manual signing workflows rather than using RHTAS, which requires external connectivity.

---

## Lessons Learned

### Research Process Improvements

1. **Always verify air-gapped support** - Check release notes for "unsupported environments" sections
2. **Cross-verify package names** - Don't rely on single sources, use multiple verification methods
3. **Test against live catalogs** - Package names can differ from product display names
4. **Check operator vs CLI tools** - Not all components are operators (e.g., Conforma)

### Documentation Standards

1. **Mark unsupported configurations** - Clearly document when Red Hat doesn't support something
2. **Provide alternatives** - Tell users what they CAN use instead
3. **Explain decisions** - Document WHY we chose not to add something
4. **Keep evidence** - Preserve research findings for future reference

---

## Related Documentation

- `.research/ACM_QUAY_TRUSTED_SUPPLY_CHAIN_OPERATORS.md` - Main research file (updated)
- `.research/OPERATOR_VERSION_AWARE_RESEARCH_PROCESS.md` - Research methodology
- `frontend/src/steps/OperatorsStep.jsx` - Comment explaining why quick pick not added
- [RHADS - SSC 1.9 Release Notes](https://docs.redhat.com/en/documentation/red_hat_advanced_developer_suite_-_software_supply_chain/1.9/html-single/release_notes_for_red_hat_advanced_developer_suite_-_software_supply_chain_1.9/index)

---

## Status

✅ **Research complete**  
✅ **Package names verified**  
✅ **Air-gapped limitation documented**  
✅ **Decision made: Do not add quick pick**  
✅ **Alternative recommendations provided**  
✅ **Code updated with comprehensive comment**  
✅ **RHDH package name fixed in existing quick pick**

**Final commit:** 974928a - "Update RHADS - SSC research and permanently disable quick pick (air-gapped unsupported)"

---

**Research by:** ChatGPT (operator catalog verification)  
**Analysis by:** Claude Sonnet 4.5  
**Project:** OpenShift Airgap Architect  
**Date:** 2026-05-11
