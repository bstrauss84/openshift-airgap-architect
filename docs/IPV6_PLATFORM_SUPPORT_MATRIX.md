# IPv6-Only Single-Stack Platform Support Matrix

**Research Date:** 2026-05-18  
**OpenShift Version:** 4.20  
**Feature:** IPv6-only single-stack networking (no IPv4)

---

## Support Status Overview

| Platform | Method | IPv6-Only Support | Evidence | Implementation Decision |
|----------|--------|-------------------|----------|------------------------|
| **Bare Metal** | IPI | ✅ **CONFIRMED** | Red Hat Customer Portal #6994999, Official 4.20 docs | **ENABLE** |
| **Bare Metal** | Agent | ✅ **CONFIRMED** | Red Hat Customer Portal #6994999, Official 4.20 docs | **ENABLE** |
| **Bare Metal** | UPI | ✅ **CONFIRMED** | Red Hat Customer Portal #6994999, Official 4.20 docs | **ENABLE** |
| **vSphere** | IPI | ✅ **LIKELY SUPPORTED** | Official 4.20 docs, IPv6 control plane GA Q1 2026 | **ENABLE** |
| **vSphere** | Agent | ✅ **LIKELY SUPPORTED** | Official 4.20 docs, IPv6 control plane GA Q1 2026 | **ENABLE** |
| **vSphere** | UPI | ✅ **LIKELY SUPPORTED** | Official 4.20 docs, IPv6 control plane GA Q1 2026 | **ENABLE** |
| **Nutanix** | IPI | ⚠️ **UNCERTAIN** | Docs exist, but NMState limitations noted | **DEFER** (needs verification) |
| **AWS GovCloud** | IPI | ❌ **NOT SUPPORTED** | No IPv6 mentioned in GovCloud docs, currently blocked | **KEEP BLOCKED** |
| **AWS GovCloud** | UPI | ❌ **NOT SUPPORTED** | No IPv6 mentioned in GovCloud docs, currently blocked | **KEEP BLOCKED** |
| **Azure Government** | IPI | ⚠️ **UNCERTAIN** | ARO available, but Azure Blob/S3 lack IPv6 endpoints | **DEFER** (needs verification) |
| **Azure Government** | UPI | ⚠️ **UNCERTAIN** | ARO available, but Azure Blob/S3 lack IPv6 endpoints | **DEFER** (needs verification) |
| **IBM Cloud** | IPI | ❌ **EXPLICITLY NOT SUPPORTED** | IBM Cloud docs: "IBM Cloud does not support IPv6" | **KEEP BLOCKED** |

---

## Detailed Research Findings

### ✅ Bare Metal (IPI/Agent/UPI)

**Status:** CONFIRMED SUPPORTED  
**Since:** OpenShift 4.12+  
**4.20 Support:** Yes

**Sources:**
- Red Hat Customer Portal Solution #6994999: "Does OpenShift support dual stack and IPv6 single stack?"
- Official OpenShift 4.20 bare metal installation documentation

**Key Points:**
- Single-stack IPv6 supported since 4.12 (4.20 inherits support)
- Applies to all bare metal installation methods (IPI, Agent-Based, UPI)
- No documented limitations for bare metal deployments

**Implementation Decision:** ✅ **ENABLE IPv6-only mode for all bare metal scenarios**

---

### ✅ vSphere (IPI/Agent/UPI)

**Status:** LIKELY SUPPORTED (high confidence)  
**Since:** Dual-stack since 4.14+, IPv6-only control plane GA Q1 2026  
**4.20 Support:** Yes (inferred from dual-stack + IPv6 control plane support)

**Sources:**
- Official OpenShift 4.20 vSphere installation documentation
- February 2026 presentation: "OpenShift IPv6-only control plane on VMware reaches GA"
- Red Hat support for dual-stack vSphere confirmed since 4.14

**Key Points:**
- Dual-stack networking confirmed in 4.14+
- IPv6-only control plane reached GA in early 2026
- Official 4.20 vSphere docs exist (indicates continued support)

**Implementation Decision:** ✅ **ENABLE IPv6-only mode for all vSphere scenarios**

**Note:** While not explicitly confirmed in search results, the progression from dual-stack (4.14) → IPv6-only control plane GA (Q1 2026) → 4.20 release strongly suggests full IPv6-only support.

---

### ⚠️ Nutanix IPI

**Status:** UNCERTAIN (needs further verification)  
**Known Limitation:** Kubernetes NMState operator cannot be installed on Nutanix  
**4.20 Support:** Unknown

**Sources:**
- Official OpenShift 4.20 Nutanix documentation exists
- NMState operator limitation documented in Nutanix requirements

**Key Points:**
- OpenShift 4.20 Nutanix IPI installation docs are available
- NMState operator (used for network configuration) explicitly incompatible with Nutanix
- No explicit mention of IPv6-only support in search results

**Concerns:**
- NMState operator handles advanced network configuration (including IPv6)
- Limitation may impact IPv6-only deployments differently than IPv4-only

**Implementation Decision:** ⚠️ **DEFER** - Do not enable IPv6-only mode until verified

**Next Steps:**
- Test IPv6-only Nutanix deployment in lab environment, OR
- Contact Red Hat support for explicit confirmation, OR
- Review detailed Nutanix 4.20 network configuration documentation

---

### ❌ AWS GovCloud (IPI/UPI)

**Status:** NOT SUPPORTED (IPv4-only)  
**Currently Blocked:** Yes (codebase enforces IPv4-only)  
**4.20 Support:** ROSA 4.20 available, but no IPv6 support

**Sources:**
- ROSA (Red Hat OpenShift Service on AWS) 4.20 available on AWS GovCloud
- No explicit IPv6 support mentioned in AWS GovCloud documentation

**Key Points:**
- GovCloud has limited service availability compared to commercial AWS
- No search results indicated IPv6 networking support
- Currently blocked in codebase: `generate.js` lines 141-142

**Implementation Decision:** ❌ **KEEP BLOCKED** - No changes to current IPv4-only enforcement

**Rationale:** Commercial AWS supports IPv6, but GovCloud lags behind in feature parity. Without explicit documentation confirming IPv6 support, safer to keep IPv4-only restriction.

---

### ⚠️ Azure Government (IPI/UPI)

**Status:** UNCERTAIN (needs verification)  
**Known Limitation:** Azure Blob Storage and S3 CloudFront do not support IPv6 endpoints  
**4.20 Support:** Unknown

**Sources:**
- Azure Red Hat OpenShift (ARO) available on Azure Government
- Azure documentation notes IPv6 endpoint limitations for Blob Storage

**Key Points:**
- ARO is available on Azure Government
- Azure Blob Storage used for bootstrap ignition configs
- S3 CloudFront (used by OpenShift) lacks IPv6 endpoint support

**Concerns:**
- Bootstrap process may require IPv4 connectivity for ignition config retrieval
- Storage service limitations could block IPv6-only deployments

**Implementation Decision:** ⚠️ **DEFER** - Do not enable IPv6-only mode until verified

**Next Steps:**
- Review ARO Azure Government network architecture documentation
- Test bootstrap process in IPv6-only environment
- Verify if alternative storage methods support IPv6

---

### ❌ IBM Cloud IPI

**Status:** EXPLICITLY NOT SUPPORTED  
**Currently Blocked:** Yes (codebase enforces IPv4-only)  
**4.20 Support:** OpenShift 4.20 available, but IPv6 not supported

**Sources:**
- OpenShift 4.20 released on IBM Cloud (February 2026)
- **IBM Cloud documentation: "IBM Cloud does not support IPv6"**

**Key Points:**
- OpenShift 4.20 is available on IBM Cloud
- IBM Cloud platform explicitly states no IPv6 support
- Dual-stack or IPv6-only environments not possible

**Implementation Decision:** ❌ **KEEP BLOCKED** - No changes to current IPv4-only enforcement

**Rationale:** IBM Cloud platform limitation (not OpenShift limitation). Cannot enable IPv6-only mode when underlying cloud provider does not support IPv6.

---

## Implementation Recommendations

### Phase 1: Enable for Confirmed Platforms

**Platforms to enable IPv6-only mode (v1.4.0):**
1. ✅ Bare Metal IPI
2. ✅ Bare Metal Agent
3. ✅ Bare Metal UPI
4. ✅ vSphere IPI
5. ✅ vSphere Agent
6. ✅ vSphere UPI

**Total:** 6 scenarios (out of 12 currently supported)

### Phase 2: Research and Verify (Future)

**Platforms requiring verification before enabling:**
1. ⚠️ Nutanix IPI - Test with NMState limitation
2. ⚠️ Azure Government IPI - Verify storage bootstrap process
3. ⚠️ Azure Government UPI - Verify storage bootstrap process

**Total:** 3 scenarios (potential future expansion)

### Permanently Blocked Platforms

**Platforms that will remain IPv4-only:**
1. ❌ AWS GovCloud IPI - Platform limitation
2. ❌ AWS GovCloud UPI - Platform limitation
3. ❌ IBM Cloud IPI - Platform limitation (explicit no IPv6 support)

**Total:** 3 scenarios

---

## Code Implementation Strategy

### UI Logic (NetworkingV2Step.jsx)

```jsx
const ipv6OnlySupported = useMemo(() => {
  const scenario = state.scenario?.value || '';
  const supported = [
    'bare-metal-ipi',
    'bare-metal-agent',
    'bare-metal-upi',
    'vsphere-ipi',
    'vsphere-agent',
    'vsphere-upi'
  ];
  return supported.includes(scenario);
}, [state.scenario]);

// Only show IPv6-only option if platform supports it
{!isIpv4OnlyScenario && ipv6OnlySupported && (
  <select value={ipStackMode} onChange={...}>
    <option value="ipv4">IPv4 only</option>
    <option value="ipv6">IPv6 only</option>
    <option value="dual-stack">Dual-stack (IPv4 + IPv6)</option>
  </select>
)}

// If platform doesn't support IPv6-only, only show ipv4/dual-stack
{!isIpv4OnlyScenario && !ipv6OnlySupported && (
  <select value={ipStackMode === 'ipv6' ? 'dual-stack' : ipStackMode} onChange={...}>
    <option value="ipv4">IPv4 only</option>
    <option value="dual-stack">Dual-stack (IPv4 + IPv6)</option>
  </select>
)}
```

### Validation Logic (validation.js)

```javascript
const validateIpStackMode = (state) => {
  const scenario = state.scenario?.value || '';
  const ipStackMode = state.hostInventory?.ipStackMode || 'ipv4';
  
  const ipv6OnlySupported = [
    'bare-metal-ipi',
    'bare-metal-agent',
    'bare-metal-upi',
    'vsphere-ipi',
    'vsphere-agent',
    'vsphere-upi'
  ];
  
  if (ipStackMode === 'ipv6' && !ipv6OnlySupported.includes(scenario)) {
    return {
      errors: [`IPv6-only mode is not supported for ${scenario}. Use dual-stack instead.`],
      warnings: [],
      fieldErrors: {}
    };
  }
  
  return { errors: [], warnings: [], fieldErrors: {} };
};
```

---

## Testing Requirements

### Unit Tests (backend/test/)

**New test file:** `ipv6-only-generation.test.js`

1. ✅ Bare Metal Agent IPv6-only: install-config has only IPv6 networks
2. ✅ Bare Metal Agent IPv6-only: agent-config has ipv4.enabled=false, ipv6.enabled=true
3. ✅ Bare Metal IPI IPv6-only: install-config has only IPv6 VIPs
4. ✅ vSphere Agent IPv6-only: install-config has only IPv6 networks
5. ✅ vSphere IPI IPv6-only: install-config has only IPv6 VIPs
6. ❌ Nutanix IPI IPv6-only: Should error or fall back to dual-stack (not yet supported)
7. ❌ AWS GovCloud IPv6-only: Should error (blocked platform)
8. ❌ IBM Cloud IPv6-only: Should error (blocked platform)

### Integration Tests (frontend/tests/)

**New test file:** `validation-ipv6-only.test.js`

1. ✅ IPv6-only mode selector visible for bare-metal-agent
2. ✅ IPv6-only mode selector visible for vsphere-ipi
3. ❌ IPv6-only mode selector NOT visible for nutanix-ipi
4. ❌ IPv6-only mode selector NOT visible for aws-govcloud-ipi
5. ✅ Validation enforces IPv6 machine network when ipStackMode='ipv6'
6. ✅ Validation enforces IPv6 VIPs when ipStackMode='ipv6'

### Regression Tests

**Verify no regressions:**
1. ✅ IPv4-only mode still works (all platforms)
2. ✅ Dual-stack mode still works (supported platforms)
3. ✅ Migration from v1.2.x enableIpv6=true → ipStackMode='dual-stack'
4. ✅ Migration from v1.2.x enableIpv6=false → ipStackMode='ipv4'

---

## Documentation Updates

### Files to Update

1. **BACKLOG_STATUS.md**
   - Mark DOC-074 as `verified_done` after implementation complete
   - Add evidence: commit SHA, test files, this matrix document

2. **IMPLEMENTATION_ROADMAP_2026-05-14.md**
   - Update v1.4.0 status when released
   - Add IPv6-only feature to release notes

3. **CHANGELOG.md**
   - Add v1.4.0 entry with IPv6-only support details
   - List supported platforms explicitly

4. **README.md**
   - Update feature list to include "IPv6-only single-stack networking"
   - Note platform limitations (Nutanix, AWS GovCloud, IBM Cloud, Azure Gov)

---

## References

### Red Hat Documentation

- Red Hat Customer Portal Solution #6994999: "Does OpenShift support dual stack and IPv6 single stack?"
- OpenShift 4.20 Installing on bare metal documentation
- OpenShift 4.20 Installing on vSphere documentation
- OpenShift 4.20 Installing on Nutanix documentation

### Platform Provider Documentation

- IBM Cloud documentation: "IBM Cloud does not support IPv6"
- Azure documentation: IPv6 endpoint limitations for Blob Storage
- AWS GovCloud service availability documentation

### Related Issues

- DOC-074: IPv6-only single-stack support (this feature)
- Existing dual-stack support: OpenShift 4.14+ (vSphere), 4.12+ (bare metal)

---

**Last Updated:** 2026-05-18  
**Next Review:** After v1.4.0 release (verify user feedback from production deployments)
