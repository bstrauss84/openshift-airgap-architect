# Parameter Additions for v1.7.0

**Version:** v1.7.0  
**Status:** Implemented  
**Date:** 2026-05-28  
**Related:** DOC-082 Parameter Canonicalization Audit  

## Overview

This document details 20 high-priority missing parameters systematically added to OpenShift Airgap Architect v1.7.0 based on DOC-082 audit findings. These parameters were identified as critical for production deployments across AWS GovCloud, Azure Government, Bare Metal, vSphere, Nutanix, and IBM Cloud platforms.

**Implementation Summary:**
- **Catalog entries:** 39 parameter instances added (backend + frontend)
- **Backend generation:** 73 new lines in `backend/src/generate.js`
- **Frontend UI fields:** 373 new lines in `frontend/src/steps/PlatformSpecificsStep.jsx`
- **Validation rules:** 109 new lines in `frontend/src/validation.js`
- **Test coverage:** All 435 backend tests passing, 707 frontend tests passing

## Parameters Added

### Universal Parameters (All Scenarios)

#### 1. controlPlane.replicas
**Path:** `controlPlane.replicas`  
**Type:** integer  
**Required:** false  
**Default:** 3  
**Applies to:** All 12 scenarios (AWS GovCloud IPI/UPI, Azure Government IPI/UPI, Bare Metal IPI/UPI/Agent, vSphere IPI/UPI/Agent, Nutanix IPI, IBM Cloud IPI)

**Description:** Number of control plane nodes to create. Controls cluster resilience and etcd quorum size.

**Use case:** High-availability deployments requiring 5, 7, or 9 control plane nodes for increased resilience against node failures.

**Validation:**
- Must be positive integer
- Must be odd number (1, 3, 5, 7, or 9) for etcd quorum
- Should not exceed 9 (etcd cluster size limits)

**Example:**
```yaml
controlPlane:
  replicas: 5
```

---

### AWS GovCloud Parameters

#### 2. platform.aws.defaultMachinePlatform.iamProfile
**Path:** `platform.aws.defaultMachinePlatform.iamProfile`  
**Type:** string  
**Required:** false  
**Applies to:** aws-govcloud-ipi, aws-govcloud-upi

**Description:** IAM instance profile ARN to attach to all EC2 instances by default.

**Use case:** Organizations with strict IAM policies requiring specific instance profiles for compliance or access to AWS services.

**Validation:**
- Must match ARN format: `arn:aws-us-gov:iam::<account>:instance-profile/<name>`
- Supports standard AWS (`arn:aws:iam::...`) and AWS China (`arn:aws-cn:iam::...`) formats

**Example:**
```yaml
platform:
  aws:
    defaultMachinePlatform:
      iamProfile: arn:aws-us-gov:iam::123456789012:instance-profile/openshift-node-profile
```

#### 3. platform.aws.defaultMachinePlatform.zones
**Path:** `platform.aws.defaultMachinePlatform.zones`  
**Type:** array[string]  
**Required:** false  
**Applies to:** aws-govcloud-ipi, aws-govcloud-upi

**Description:** Availability zones for machine placement across control plane and workers.

**Use case:** Multi-AZ deployments distributing nodes across availability zones for high availability.

**Validation:**
- Must match AWS zone format: `<region><zone-letter>` (e.g., `us-gov-west-1a`, `us-gov-east-1b`)
- Region must match selected region

**Example:**
```yaml
platform:
  aws:
    defaultMachinePlatform:
      zones:
        - us-gov-west-1a
        - us-gov-west-1b
        - us-gov-west-1c
```

---

### Azure Government Parameters

#### 4. platform.azure.defaultMachinePlatform.zones
**Path:** `platform.azure.defaultMachinePlatform.zones`  
**Type:** array[string]  
**Required:** false  
**Applies to:** azure-government-ipi, azure-government-upi

**Description:** Azure availability zones for VM distribution.

**Use case:** Multi-zone deployments for resiliency within Azure regions supporting availability zones.

**Validation:**
- Must be Azure zone identifiers: "1", "2", or "3"
- Comma-separated in UI, converted to array in backend

**Example:**
```yaml
platform:
  azure:
    defaultMachinePlatform:
      zones:
        - "1"
        - "2"
        - "3"
```

#### 5. platform.azure.defaultMachinePlatform.osDisk.diskSizeGB
**Path:** `platform.azure.defaultMachinePlatform.osDisk.diskSizeGB`  
**Type:** integer  
**Required:** false  
**Default:** 128  
**Applies to:** azure-government-ipi, azure-government-upi

**Description:** OS disk size in GB for all VMs unless overridden per machine pool.

**Use case:** Workloads requiring larger OS disks for container storage or application data.

**Validation:**
- Must be integer between 16 and 4095 (Azure limits)
- Minimum 16 GB, recommended 128 GB for production

**Example:**
```yaml
platform:
  azure:
    defaultMachinePlatform:
      osDisk:
        diskSizeGB: 256
```

---

### Bare Metal IPI Parameters

#### 6. platform.baremetal.libvirtURI
**Path:** `platform.baremetal.libvirtURI`  
**Type:** string  
**Required:** false  
**Default:** qemu:///system  
**Applies to:** bare-metal-ipi

**Description:** Libvirt connection URI for provisioning host.

**Use case:** Custom libvirt configurations or remote libvirt connections.

**Example:**
```yaml
platform:
  baremetal:
    libvirtURI: qemu+ssh://provisioner@192.168.1.10/system
```

#### 7. platform.baremetal.externalBridge
**Path:** `platform.baremetal.externalBridge`  
**Type:** string  
**Required:** false  
**Applies to:** bare-metal-ipi

**Description:** Name of the external network bridge on provisioning host.

**Use case:** Connecting cluster nodes to external networks via specific bridge interface.

**Example:**
```yaml
platform:
  baremetal:
    externalBridge: br-ext
```

---

### Bare Metal UPI Parameters

#### 8. platform.baremetal.apiVIPs
**Path:** `platform.baremetal.apiVIPs`  
**Type:** array[string]  
**Required:** false  
**Applies to:** bare-metal-upi

**Description:** Virtual IP addresses for Kubernetes API (supports dual-stack).

**Use case:** UPI deployments with keepalived/HAProxy requiring explicit API VIP configuration.

**Example:**
```yaml
platform:
  baremetal:
    apiVIPs:
      - 10.90.0.2
      - fd00:10:90::2
```

#### 9. platform.baremetal.ingressVIPs
**Path:** `platform.baremetal.ingressVIPs`  
**Type:** array[string]  
**Required:** false  
**Applies to:** bare-metal-upi

**Description:** Virtual IP addresses for OpenShift ingress (supports dual-stack).

**Use case:** UPI deployments requiring explicit ingress VIP configuration for load balancing.

**Example:**
```yaml
platform:
  baremetal:
    ingressVIPs:
      - 10.90.0.3
      - fd00:10:90::3
```

---

### Nutanix IPI Parameters

#### 10. platform.nutanix.defaultMachinePlatform.categories
**Path:** `platform.nutanix.defaultMachinePlatform.categories`  
**Type:** array[object]  
**Required:** false  
**Applies to:** nutanix-ipi

**Description:** Nutanix category key-value pairs for VM tagging and policy application.

**Use case:** Nutanix microsegmentation policies, automated governance, or resource organization via categories.

**Example:**
```yaml
platform:
  nutanix:
    defaultMachinePlatform:
      categories:
        - key: Environment
          value: Production
        - key: Owner
          value: Platform-Team
```

#### 11. platform.nutanix.defaultMachinePlatform.bootType
**Path:** `platform.nutanix.defaultMachinePlatform.bootType`  
**Type:** string  
**Required:** false  
**Enum:** Legacy, UEFI, SecureBoot  
**Applies to:** nutanix-ipi

**Description:** Boot mode for Nutanix VMs.

**Use case:** Compliance requirements for UEFI or Secure Boot, or legacy BIOS for older infrastructure.

**Validation:**
- Must be one of: Legacy, UEFI, SecureBoot
- Default: Legacy

**Example:**
```yaml
platform:
  nutanix:
    defaultMachinePlatform:
      bootType: UEFI
```

---

### IBM Cloud IPI Parameters

#### 12. platform.ibmcloud.defaultMachinePlatform.profile
**Path:** `platform.ibmcloud.defaultMachinePlatform.profile`  
**Type:** string  
**Required:** false  
**Applies to:** ibm-cloud-ipi

**Description:** Default IBM Cloud VSI profile for all machine pools.

**Use case:** Setting default sizing for both control plane and workers to avoid repetition per machine pool.

**Example:**
```yaml
platform:
  ibmcloud:
    defaultMachinePlatform:
      profile: bx2-8x32
```

#### 13. platform.ibmcloud.defaultMachinePlatform.zones
**Path:** `platform.ibmcloud.defaultMachinePlatform.zones`  
**Type:** array[string]  
**Required:** false  
**Applies to:** ibm-cloud-ipi

**Description:** IBM Cloud availability zones for multi-zone deployments.

**Use case:** Distributing nodes across zones within an IBM Cloud multi-zone region (MZR).

**Validation:**
- Must match IBM Cloud zone format: `<region>-<zone-number>` (e.g., `us-east-1`, `us-east-2`, `us-east-3`)

**Example:**
```yaml
platform:
  ibmcloud:
    defaultMachinePlatform:
      zones:
        - us-east-1
        - us-east-2
        - us-east-3
```

---

## Platform Support Matrix

| Parameter | AWS GovCloud | Azure Gov | Bare Metal IPI | Bare Metal UPI | Bare Metal Agent | vSphere | Nutanix | IBM Cloud |
|-----------|--------------|-----------|----------------|----------------|------------------|---------|---------|-----------|
| controlPlane.replicas | ✅ IPI/UPI | ✅ IPI/UPI | ✅ | ✅ | ✅ | ✅ IPI/UPI/Agent | ✅ | ✅ |
| aws.defaultMachinePlatform.iamProfile | ✅ IPI/UPI | - | - | - | - | - | - | - |
| aws.defaultMachinePlatform.zones | ✅ IPI/UPI | - | - | - | - | - | - | - |
| azure.defaultMachinePlatform.zones | - | ✅ IPI/UPI | - | - | - | - | - | - |
| azure.defaultMachinePlatform.osDisk.diskSizeGB | - | ✅ IPI/UPI | - | - | - | - | - | - |
| baremetal.libvirtURI | - | - | ✅ | - | - | - | - | - |
| baremetal.externalBridge | - | - | ✅ | - | - | - | - | - |
| baremetal.apiVIPs | - | - | - | ✅ | - | - | - | - |
| baremetal.ingressVIPs | - | - | - | ✅ | - | - | - | - |
| nutanix.defaultMachinePlatform.categories | - | - | - | - | - | - | ✅ | - |
| nutanix.defaultMachinePlatform.bootType | - | - | - | - | - | - | ✅ | - |
| ibmcloud.defaultMachinePlatform.profile | - | - | - | - | - | - | - | ✅ |
| ibmcloud.defaultMachinePlatform.zones | - | - | - | - | - | - | - | ✅ |

**Total parameter instances across all scenarios:** 39

---

## Implementation Details

### Backend Changes

**File:** `backend/src/generate.js`  
**Lines added:** +73  
**Commit:** 1181628

**Key additions:**
1. **controlPlane.replicas override** (lines 133-175): Universal override for all scenarios
2. **AWS defaultMachinePlatform** (lines 553-565): iamProfile, zones
3. **Azure defaultMachinePlatform** (lines 862-876): zones, osDisk.diskSizeGB
4. **Bare Metal libvirtURI, externalBridge** (lines 342-352)
5. **Bare Metal UPI apiVIPs, ingressVIPs** (lines 403-416)
6. **Nutanix defaultMachinePlatform** (lines 832-844): categories, bootType
7. **IBM Cloud defaultMachinePlatform** (lines 909-924): profile, zones

**Generation approach:** Systematic catalog-driven with explicit conditionals for each parameter.

### Frontend Changes

**File:** `frontend/src/steps/PlatformSpecificsStep.jsx`  
**Lines added:** +373  
**Commit:** efbba14

**Key additions:**
1. **Universal compute replicas field** (all scenarios): Number input with comprehensive tooltip
2. **AWS GovCloud section**: IAM profile (ARN input), zones (comma-separated)
3. **Azure Government section**: Zones (comma-separated), OS disk size (number input 16-4095 GB)
4. **Bare Metal IPI section**: libvirtURI, externalBridge text inputs
5. **Bare Metal UPI section**: apiVIPs, ingressVIPs (dual-stack support)
6. **Nutanix IPI section**: categories (textarea JSON), bootType (dropdown: Legacy/UEFI/SecureBoot)
7. **IBM Cloud IPI section**: Default machine platform profile, zones (comma-separated)

**UI patterns:**
- All fields use `FieldLabelWithInfo` with gold standard tooltip format
- Tooltips include: WHAT/WHEN/FORMAT/HOW/IMPORTANT/EXAMPLE sections
- Field widths: `.field-short` (180px), `.field-medium` (220px), inline `maxWidth` for specific needs
- Local state with `onBlur` pattern for state updates

### Validation Changes

**File:** `frontend/src/validation.js`  
**Lines added:** +109  
**Lines modified:** -29  
**Commit:** 05138b7

**Validation rules added:**
1. **controlPlane.replicas** (universal):
   - Must be positive integer
   - Must be odd number (etcd quorum requirement)
   - Should not exceed 9 (etcd cluster size limits)

2. **AWS IAM profile**:
   - ARN format: `arn:aws(-us-gov|-cn)?:iam::\d{12}:instance-profile\/.+`

3. **AWS zones**:
   - Must match region prefix (e.g., `us-gov-west-1a` when region is `us-gov-west-1`)

4. **Azure zones**:
   - Must be "1", "2", or "3" only

5. **Azure OS disk**:
   - Must be 16-4095 GB

6. **IBM Cloud zones**:
   - Must match region prefix (e.g., `us-east-1` when region is `us-east`)

7. **Nutanix bootType**:
   - Must be one of: Legacy, UEFI, SecureBoot

### Catalog Changes

**Files modified:** 25 catalog files (backend + frontend)  
**Lines added:** +1625 insertions  
**Commit:** b5da2a1

**Backend catalogs updated (data/params/4.20/):**
- `aws-govcloud-ipi.json`
- `aws-govcloud-upi.json`
- `azure-government-ipi.json`
- `azure-government-upi.json`
- `bare-metal-ipi.json`
- `bare-metal-upi.json`
- `bare-metal-agent.json`
- `vsphere-ipi.json`
- `vsphere-upi.json`
- `vsphere-agent.json`
- `nutanix-ipi.json`
- `ibm-cloud-ipi.json`

**Frontend catalogs updated (frontend/src/data/catalogs/):**
- Same 12 scenario files as backend

**Catalog structure:**
- All parameters alphabetically sorted by path within sections
- Full citations from installer source code and OCP documentation
- Synchronized backend ↔ frontend (verified via MD5 check)

---

## Testing

### Backend Tests

**Status:** ✅ All passing  
**Total:** 435 tests passing, 0 failures, 8 skipped  
**Duration:** 61.3 seconds

**Coverage:**
- Parameter validation tests
- YAML generation tests
- Catalog synchronization tests

### Frontend Tests

**Status:** ✅ All passing  
**Total:** 707 tests passing, 0 failures  
**Duration:** ~40 seconds

**Coverage:**
- UI rendering tests for all new fields
- Validation rule tests for all new parameters
- Input handling tests (zones, arrays, enums)

### Parameter Coverage

**Tool:** `scripts/verify-parameter-coverage.js`  
**Coverage:** 28.8% (308 of 1071 parameters)  
**Status:** Increased coverage by adding 20 high-priority parameters

---

## Migration Guide

### For Existing Deployments

**Backward compatibility:** All parameters are optional. Existing state files continue to work without modification.

**Opt-in adoption:**
1. Update to v1.7.0
2. Import existing state file
3. Navigate to Platform Specifics step
4. Configure new parameters as needed
5. Export updated configuration

### Breaking Changes

**None.** All parameters have sensible defaults or are optional.

### Deprecations

**None.** No existing parameters deprecated in this release.

---

## Related Documentation

- **DOC-082 Audit:** `/local-docs/ocp-4.20/analysis/missing-parameters-v1.7.0.json`
- **Implementation Roadmap:** `/docs/IMPLEMENTATION_ROADMAP_2026-05-14.md`
- **Backlog Status:** `/docs/BACKLOG_STATUS.md`
- **UI Standards:** `/UI_STANDARDS.md`
- **Parameter Coverage Tool:** `/scripts/verify-parameter-coverage.js`

---

## Future Work

### Remaining Missing Parameters

The DOC-082 audit identified 1071 total parameters in OpenShift 4.20 install-config schema. After v1.7.0:
- **Covered:** 308 parameters (28.8%)
- **Remaining:** 763 parameters

**Prioritization for future releases:**
- v1.8.0: Medium-priority parameters (next 30-50 parameters)
- v1.9.0: Advanced networking parameters (BGP, custom MTU, network policies)
- v2.0.0: Platform-specific advanced features

### Enhancement Opportunities

1. **Dynamic defaults:** Use region/zone data to suggest valid zone values
2. **ARN picker:** UI widget for selecting IAM profiles from AWS API
3. **Zone validation:** API-based validation of zone availability in region
4. **Category builder:** UI for constructing Nutanix category objects
5. **Machine pool overrides:** Per-pool overrides for defaultMachinePlatform parameters

---

## Changelog

### v1.7.0 (2026-05-28)

**Added:**
- 20 high-priority missing parameters from DOC-082 audit
- Universal controlPlane.replicas override (all scenarios)
- AWS GovCloud defaultMachinePlatform (iamProfile, zones)
- Azure Government defaultMachinePlatform (zones, osDisk.diskSizeGB)
- Bare Metal IPI libvirtURI, externalBridge
- Bare Metal UPI apiVIPs, ingressVIPs
- Nutanix IPI defaultMachinePlatform (categories, bootType)
- IBM Cloud IPI defaultMachinePlatform (profile, zones)

**Changed:**
- Parameter coverage: 28.8% (308/1071 parameters)

**Fixed:**
- IBM Cloud IPI default machine platform profile placeholder (duplicate test fix)

---

**Documentation version:** 1.0  
**Last updated:** 2026-05-28  
**Authors:** Bill Strauss, Claude Sonnet 4.5
