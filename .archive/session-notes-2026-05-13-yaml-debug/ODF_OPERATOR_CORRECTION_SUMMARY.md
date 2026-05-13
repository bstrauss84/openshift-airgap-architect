# ODF Operator Package List Correction Summary

**Date:** 2026-05-11  
**Task:** DOC-063 - Expand operator scenario quick picks  
**Issue:** Original research was incomplete and missing many required ODF operators

---

## What Was Wrong

Original research only included **4 operators** for ODF:
- odf-operator
- ocs-operator
- mcg-operator
- local-storage-operator

**Missing 7-10 operators** depending on version!

---

## What We Fixed

### Research Document Updated

Updated `.research/operator-dependencies-4.20.md` with **official Red Hat documentation** from ODF Planning PDFs (Chapter 10: Disconnected Environment).

### Complete Package Lists (Per Version)

**ODF 4.16** - 8 base packages:
- ocs-operator
- odf-operator
- mcg-operator
- odf-csi-addons-operator ← ADDED
- ocs-client-operator ← ADDED
- odf-prometheus-operator ← ADDED
- recipe ← ADDED
- rook-ceph-operator ← ADDED

**ODF 4.17** - 9 base packages (adds):
- cephcsi-operator ← ADDED in 4.17

**ODF 4.18/4.19** - 10 base packages (adds):
- odf-dependencies ← ADDED in 4.18

**ODF 4.20/4.21** - 11 base packages (adds):
- odf-external-snapshotter-operator ← ADDED in 4.20

**Optional - Local Storage:**
- local-storage-operator (for internal mode deployments)

**Optional - Disaster Recovery:**
- odf-multicluster-orchestrator ← ADDED
- odr-cluster-operator ← ADDED
- odr-hub-operator ← ADDED

---

## Implementation Changes

### OperatorsStep.jsx

**BEFORE:**
- 1 ODF quick pick with 4 operators (incomplete)
- No DR options
- No local storage variant

**AFTER:**
- 3 ODF quick picks:
  1. **"OpenShift Data Foundation (Base)"** - Base packages for disconnected mirroring (8-11 operators depending on version)
  2. **"ODF + Local Storage"** - Base + local-storage-operator (9-12 operators)
  3. **"ODF + Disaster Recovery"** - Base + DR operators (11-14 operators)
  
- 1 Updated Platform Plus quick pick:
  - Now includes full ODF base stack (not just 4 operators)

All quick picks are **version-aware** with correct package lists for OpenShift 4.16-4.21.

---

## Sources

All package lists verified against official Red Hat documentation:

- [ODF 4.16 Planning - Disconnected Environment](https://docs.redhat.com/en/documentation/red_hat_openshift_data_foundation/4.16/html/planning_your_deployment/disconnected-environment_rhodf)
- [ODF 4.17 Planning - Disconnected Environment](https://docs.redhat.com/en/documentation/red_hat_openshift_data_foundation/4.17/html/planning_your_deployment/disconnected-environment_rhodf)
- [ODF 4.18 Planning - Disconnected Environment](https://docs.redhat.com/en/documentation/red_hat_openshift_data_foundation/4.18/html/planning_your_deployment/disconnected-environment_rhodf)
- [ODF 4.19 Planning - Disconnected Environment](https://docs.redhat.com/en/documentation/red_hat_openshift_data_foundation/4.19/html/planning_your_deployment/disconnected-environment_rhodf)
- [ODF 4.20 Planning - Disconnected Environment](https://docs.redhat.com/en/documentation/red_hat_openshift_data_foundation/4.20/html/planning_your_deployment/disconnected-environment_rhodf)
- [ODF 4.21 Planning - Disconnected Environment](https://docs.redhat.com/en/documentation/red_hat_openshift_data_foundation/4.21/html/planning_your_deployment/disconnected-environment_rhodf)

---

## Testing

✅ Frontend build passes  
✅ All 3 new ODF quick picks functional  
✅ Version-aware selection working (4.16-4.21)  
✅ Platform Plus updated with full ODF base stack

---

## Impact

**Users can now:**
- Select complete ODF operator sets for disconnected mirroring
- Choose appropriate variant (base, local storage, or DR)
- Get correct version-specific packages automatically
- Trust that all required operators are included per Red Hat documentation

**No more missing operators!** 🎉
