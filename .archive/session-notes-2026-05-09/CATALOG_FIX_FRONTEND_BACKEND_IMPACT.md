# Catalog Metadata Fixes - Frontend/Backend Impact Analysis

**Date:** 2026-05-09  
**Total Fixes:** 17 across 9 catalogs

---

## Impact Summary

| Fix | Frontend Impact | Backend Impact | Action Required |
|-----|----------------|----------------|-----------------|
| **BARE METAL (4 fixes)** |
| 1. baselineCapabilitySet add v4.20 | ⚠️ MINOR | ✅ None | Update fallback array |
| 2. httpProxy allow http/https | ⚠️ MINOR | ✅ None | Update validation |
| 3. httpsProxy allow http/https | ✅ None | ✅ None | Already correct |
| 4. controlPlane replicas add 2 | ⚠️ REVIEW | ✅ Already supported | Verify UI allows 2 |
| **AWS GOVCLOUD (3 fixes)** |
| 5. platform add "aws" | ⚠️ MINOR | ✅ None | Verify dropdown |
| 6. compute[].platform add "aws" | ❓ NOT USED | ❓ NOT USED | N/A |
| 7. controlPlane[].platform add "aws" | ❓ NOT USED | ❓ NOT USED | N/A |
| **AZURE GOVERNMENT (2 fixes)** |
| 8. resourceGroupName optional for IPI | ✅ Auto-fixed | ✅ None | Catalog-driven |
| 9. baseDomainResourceGroupName description | ✅ None | ✅ None | Tooltip only |
| **IBM CLOUD (5 fixes)** |
| 10. machineNetwork[].cidr type fix | ✅ Already correct | ✅ None | N/A |
| 11. compute[].platform fix values | ❓ NOT USED | ❓ NOT USED | N/A |
| 12. controlPlane[].platform fix values | ❓ NOT USED | ❓ NOT USED | N/A |
| 13. platform fix value | ⚠️ MINOR | ✅ None | Verify dropdown |
| 14. imageDigestSources parent add | ✅ None | ✅ None | Metadata only |

**Legend:**
- ✅ **None** - No action required, working correctly
- ⚠️ **MINOR** - Small update needed (fallback array, validation message, etc.)
- ⚠️ **REVIEW** - Should verify behavior
- ❓ **NOT USED** - Parameter not implemented in UI/backend

---

## Detailed Analysis

### 1. ⚠️ capabilities.baselineCapabilitySet - Added "v4.20"

**Catalog Change:**
```json
"allowed": ["None", "v4.11", "v4.12", "v4.20", "vCurrent"]  // Added v4.20
```

**Frontend:**
- **Location:** `frontend/src/steps/PlatformSpecificsStep.jsx:257`
- **Current Implementation:**
  ```javascript
  const baselineCapabilityOptions = Array.isArray(metaBaselineCapability?.allowed) 
    ? metaBaselineCapability.allowed 
    : ["None", "v4.11", "v4.12", "vCurrent"];  // ⚠️ Fallback missing v4.20
  ```
- **Impact:** Dropdown pulls from catalog metadata (✅ correct), but **fallback array is missing v4.20**
- **Action Required:** Update fallback to `["None", "v4.11", "v4.12", "v4.20", "vCurrent"]`
- **Risk:** LOW - Only affects scenarios where catalog metadata is unavailable

**Backend:**
- **Location:** `backend/src/generate.js:334`
- **Implementation:** `installConfig.capabilities.baselineCapabilitySet = platformConfig.baselineCapabilitySet;`
- **Impact:** ✅ **None** - Backend passes through value without validation

**Tooltip:**
- Already mentions version-specific values in description
- ✅ **No update needed** - generic enough

---

### 2. ⚠️ proxy.httpProxy - Changed to "http or https URL"

**Catalog Change:**
```json
"allowed": "http or https URL"  // Was: "http URL"
```

**Frontend:**
- **Location:** `frontend/src/steps/GlobalStrategyStep.jsx:88` and `TrustProxyStep.jsx:296`
- **Current Validation:**
  ```javascript
  if (httpProxy && !httpProxy.startsWith("http://")) {
    proxyErrors.httpProxy = "HTTP proxy must start with http://";  // ⚠️ Too restrictive
  }
  ```
- **Impact:** Validation **rejects https://** URLs even though docs allow them
- **Action Required:** Update validation to:
  ```javascript
  if (httpProxy && !httpProxy.startsWith("http://") && !httpProxy.startsWith("https://")) {
    proxyErrors.httpProxy = "HTTP proxy must start with http:// or https://";
  }
  ```
- **Risk:** MEDIUM - Users cannot currently set https:// URLs for httpProxy

**Backend:**
- **Location:** `backend/src/generate.js:352`
- **Implementation:** `httpProxy: state.globalStrategy?.proxies?.httpProxy`
- **Impact:** ✅ **None** - Backend doesn't validate scheme

**Tooltip:**
- **Location:** `TrustProxyStep.jsx` and `GlobalStrategyStep.jsx`
- Should mention both schemes
- ⚠️ **Review current tooltip** - may need update

---

### 3. ✅ proxy.httpsProxy - Changed to "http or https URL"

**Catalog Change:**
```json
"allowed": "http or https URL"  // Was: "https URL"
```

**Frontend:**
- **Location:** `TrustProxyStep.jsx:299` and `GlobalStrategyStep.jsx:91`
- **Current Validation:**
  ```javascript
  proxyErrors.httpsProxy = "HTTPS proxy must start with http:// or https:// (use the scheme your proxy supports).";
  ```
- **Impact:** ✅ **Already correct!** - Validation already allows both schemes
- **Action Required:** None

**Backend:**
- ✅ **None**

**Tooltip:**
- ✅ **Already correct** - mentions both schemes

---

### 4. ⚠️ controlPlane[].replicas - Added value 2

**Catalog Change:**
```json
"allowed": [1, 2, 3, 4, 5]  // Added 2 for two-node + arbiter
```

**Frontend:**
- **Location:** Need to check `ClusterStep.jsx` for master count input
- **Impact:** If there's a dropdown or restricted input, it should allow 2
- **Action Required:** ⚠️ **REVIEW** - Verify UI allows selecting 2 masters
- **Risk:** MEDIUM - Two-node cluster config may not be accessible

**Backend:**
- **Location:** `backend/src/generate.js:345-347`
- **Implementation:**
  ```javascript
  if (isAgentBased && (platform === "Bare Metal" || platform === "VMware vSphere") 
      && masters === 2 && arbiters === 1) {
    installConfig.controlPlane.replicas = 2;
    installConfig.arbiter = { name: "arbiter", replicas: 1 };
  }
  ```
- **Impact:** ✅ **Already fully supported!** - Backend handles 2 CP + 1 arbiter correctly
- **Action Required:** None for backend

**Tooltip:**
- Should mention two-node cluster option
- ⚠️ **Review tooltip** for master count

---

### 5-7. AWS GovCloud platform allowed values

**Note:** These parameters (`platform`, `compute[].platform`, `controlPlane[].platform`) are **low-level metadata** that may not have dedicated UI controls in Platform Specifics step.

**Frontend:**
- **platform:** Auto-selected based on blueprint choice (AWS GovCloud)
- **compute[].platform / controlPlane[].platform:** Not found in UI - likely not exposed
- **Impact:** ⚠️ **MINOR** - Verify platform dropdown (if exists) includes "aws"
- **Action Required:** Check if these are visible anywhere; likely auto-handled

**Backend:**
- ✅ **None** - Backend doesn't validate these catalog metadata fields

---

### 8. ✅ platform.azure.resourceGroupName - Required status changed

**Catalog Change:**
```json
// IPI: required: false (was true)
// UPI: required: true (unchanged)
```

**Frontend:**
- **Location:** `PlatformSpecificsStep.jsx:977`
- **Implementation:**
  ```javascript
  required={metaAzureResourceGroupName?.required || isRequiredInstall("platform.azure.resourceGroupName")}
  ```
- **Impact:** ✅ **Auto-fixed!** - Field requiredness is **catalog-driven** via `metaAzureResourceGroupName?.required`
- **Action Required:** None - catalog metadata controls this

**Backend:**
- ✅ **None** - Backend emits value if provided, doesn't enforce requirement

---

### 9. ✅ platform.azure.baseDomainResourceGroupName - Description updated

**Catalog Change:**
```json
"description": "Resource group containing the DNS zone for the base domain. Required for public clusters; optional for private clusters."
```

**Impact:**
- ✅ **Tooltip only** - No code changes needed
- Description is pulled from catalog metadata automatically

---

### 10-14. IBM Cloud fixes

**10. machineNetwork[].cidr type:** ✅ Already implemented correctly as string input  
**11-12. compute/controlPlane platform:** ❓ Not found in UI - likely not exposed  
**13. platform:** ⚠️ Auto-selected from blueprint, verify dropdown  
**14. imageDigestSources parent:** ✅ Metadata only, no UI impact

---

## Action Items Summary

### 🔴 HIGH PRIORITY

1. **Fix httpProxy validation** (`GlobalStrategyStep.jsx:88`, `TrustProxyStep.jsx:296`)
   - Allow both `http://` and `https://` schemes
   - Update error message

### 🟡 MEDIUM PRIORITY

2. **Update baselineCapabilitySet fallback** (`PlatformSpecificsStep.jsx:257`)
   - Add `"v4.20"` to fallback array

3. **Verify controlPlane replicas UI** (`ClusterStep.jsx`)
   - Ensure UI allows selecting 2 masters for two-node clusters
   - Check if arbiter field is exposed for Agent-based bare metal/vSphere

### 🟢 LOW PRIORITY

4. **Review proxy tooltips**
   - Ensure httpProxy tooltip mentions both http and https schemes
   - TrustProxyStep and GlobalStrategyStep

5. **Verify platform dropdowns** (if they exist)
   - AWS GovCloud: ensure "aws" is an option
   - IBM Cloud: ensure "ibmcloud" is an option

---

## No Action Required (Already Correct)

- ✅ httpsProxy validation (already allows both schemes)
- ✅ Azure resourceGroupName (catalog-driven requiredness)
- ✅ Azure baseDomainResourceGroupName (description only)
- ✅ machineNetwork[].cidr type (already string input)
- ✅ Backend generate logic (all fixes compatible)
- ✅ imageDigestSources parent (metadata only)
- ✅ Two-node + arbiter backend support (already implemented)

---

**Next Steps:**
1. Apply HIGH priority fixes (httpProxy validation)
2. Apply MEDIUM priority fixes (fallback array, verify replicas UI)
3. Review LOW priority items (tooltips, dropdown verification)
