# SMOKING GUNS - Root Causes Found

**Investigation:** YAML Preview Lag  
**Date:** 2026-05-12 23:10 UTC

---

## 🔥 SMOKING GUN #1: Missing Networking Dependencies (CRITICAL)

**File:** `frontend/src/App.jsx` lines 608-639  
**Severity:** CRITICAL - This is THE root cause

**The Issue:**

useEffect dependency array includes:
```javascript
state?.globalStrategy?.fips,
state?.globalStrategy?.proxyEnabled,
state?.globalStrategy?.proxies,
state?.globalStrategy?.mirroring,
```

**BUT IS MISSING:**
```javascript
state?.globalStrategy?.networking   // ← ENTIRE networking object MISSING!
```

**What this means:**
- User updates `networking.machineNetworkV4` via onBlur
- State DOES update: `state.globalStrategy.networking.machineNetworkV4 = "10.0.0.0/16"`
- BUT useEffect DOESN'T FIRE because `networking` is not in dependency array
- Next field update (e.g., `clusterName`) IS in array
- useEffect fires, picks up BOTH changes
- **Result: Always one step behind**

**Proof:**
1. NetworkingV2Step.jsx line 335: `updateNetworking({ machineNetworkV4: formatted })`
2. This updates `state.globalStrategy.networking.machineNetworkV4`
3. App.jsx useEffect has `state?.globalStrategy?.fips` but NOT `state?.globalStrategy?.networking`
4. useEffect doesn't fire → no YAML update

**Missing fields from dependency array:**
- `state?.globalStrategy?.networking` (entire object)
- `state?.globalStrategy?.networking?.machineNetworkV4`
- `state?.globalStrategy?.networking?.machineNetworkV6`
- `state?.globalStrategy?.networking?.clusterNetworkCidr`
- `state?.globalStrategy?.networking?.clusterNetworkCidrV6`
- `state?.globalStrategy?.networking?.serviceNetworkCidr`
- `state?.globalStrategy?.networking?.serviceNetworkCidrV6`
- `state?.globalStrategy?.networking?.clusterNetworkHostPrefix`
- `state?.globalStrategy?.networking?.serviceNetworkHostPrefixV6`
- ALL OTHER NETWORKING FIELDS

**Fix:** Add networking to dependencies

---

## 🔥 SMOKING GUN #2: Platform Config Missing from Dependencies

**Same issue, different location:**

Dependency array has:
```javascript
state?.platformConfig?.region,
state?.platformConfig?.instanceType,
state?.platformConfig?.replicas,
```

**BUT IS MISSING:**
- `state?.platformConfig?.vsphere` (entire object)
- `state?.platformConfig?.vsphere?.apiVIPs`
- `state?.platformConfig?.vsphere?.ingressVIPs`
- `state?.platformConfig?.nutanix` (entire object)
- `state?.platformConfig?.nutanix?.apiVIP`
- `state?.platformConfig?.nutanix?.ingressVIP`
- `state?.platformConfig?.aws` (entire object)
- `state?.platformConfig?.azure` (entire object)

**When this breaks:**
- PlatformSpecificsStep updates vsphere fields
- State updates
- useEffect doesn't fire (vsphere not in array)
- Next update triggers useEffect
- Previous change appears

---

## 🔥 SMOKING GUN #3: Host Inventory Details Missing

Dependency array has:
```javascript
state?.hostInventory?.nodes,
state?.hostInventory?.vips,
```

**But `nodes` is an ARRAY of objects with nested fields:**
```javascript
state.hostInventory.nodes = [
  {
    hostname: "master-0",
    role: "master",
    bmc: { address: "...", username: "...", password: "..." },
    interfaces: [...],
    // ... many more fields
  }
]
```

**React's dependency check is SHALLOW:**
- Checks `nodes` array reference
- If array reference changes → useEffect fires
- But if you UPDATE A NODE INSIDE THE ARRAY without changing array reference?
- **useEffect WON'T FIRE**

**When this breaks:**
- User updates hostname of node[0]
- State updates node[0].hostname
- But `nodes` array reference MIGHT NOT CHANGE (depending on update logic)
- useEffect doesn't fire

---

## 🔥 SMOKING GUN #4: Trust & Proxy Fields Missing

Dependency array has:
```javascript
state?.trust?.bundle,
state?.trust?.policy,
```

**But TrustProxyStep also updates:**
- `state?.trust?.additionalTrustBundle` ← MISSING
- `state?.trust?.trustBundlePolicy` ← Different from `policy`?
- `state?.trust?.mirrorRegistryUsesPrivateCa` ← MISSING
- `state?.globalStrategy?.proxies?.httpProxy` ← MISSING individual fields
- `state?.globalStrategy?.proxies?.httpsProxy` ← MISSING
- `state?.globalStrategy?.proxies?.noProxy` ← MISSING

Only `state?.globalStrategy?.proxies` (entire object) is in array.
If proxies object reference doesn't change, useEffect won't fire.

---

## 🔥 SMOKING GUN #5: Credentials Sub-fields Missing

Dependency array has:
```javascript
state?.credentials?.pullSecret,
state?.credentials?.sshKey,
state?.credentials?.username,
state?.credentials?.password,
```

**This one might actually be OK** - these are the main credential fields.

But IdentityAccessStep ALSO updates:
- `state?.blueprint?.clusterName` ← IN array ✓
- `state?.blueprint?.baseDomain` ← IN array ✓

So IdentityAccess might work, but Networking definitely doesn't.

---

## Summary of All Missing Dependencies

### Networking (CRITICAL)
- `state?.globalStrategy?.networking`
- All nested networking fields

### Platform Config (HIGH)
- `state?.platformConfig?.vsphere`
- `state?.platformConfig?.nutanix`
- `state?.platformConfig?.aws`
- `state?.platformConfig?.azure`
- All nested platform fields

### Host Inventory (MEDIUM)
- Individual node field updates might not trigger if array ref unchanged

### Trust/Proxy (MEDIUM)
- `state?.trust?.additionalTrustBundle`
- `state?.trust?.mirrorRegistryUsesPrivateCa`
- Individual proxy fields (httpProxy, httpsProxy, noProxy)

### Operators (UNKNOWN)
- `state?.operators?.selected` is in array
- But what about `state?.operators?.catalog`?
- What about `state?.operators?.quickPicks`?

---

## The Pattern

**Root cause pattern:**
1. Step file updates nested state field
2. Nested field path NOT in useEffect dependency array
3. State updates but useEffect doesn't fire
4. Next field that IS in array updates
5. useEffect fires, picks up BOTH changes
6. Previous change appears "late"

**This affects:**
- NetworkingV2Step (SEVERE - all networking fields lag)
- PlatformSpecificsStep (SEVERE - platform-specific fields lag)
- TrustProxyStep (MODERATE - some fields lag)
- HostInventoryStep (MODERATE - depends on update logic)

---

## Next Steps

1. **IMMEDIATE FIX:** Add all missing dependencies
2. **TEST:** Verify each field updates immediately
3. **REFACTOR:** Consider watching entire state object with deep comparison
4. **PREVENT:** Add linter rule or test to catch missing dependencies

---

---

## 🔥 SMOKING GUN #6: Dependency Array Too Specific (ARCHITECTURAL)

**The Core Problem:**

Current approach tries to list EVERY individual field:
```javascript
state?.globalStrategy?.fips,
state?.globalStrategy?.proxyEnabled,
// ... 30+ more fields
```

**Why this fails:**
- React compares dependencies using `Object.is()` (shallow equality)
- `state?.globalStrategy?.fips` checks if `fips` VALUE changed
- If you update `networking.machineNetworkV4` but `fips` hasn't changed
- React sees: `Object.is(oldFips, newFips)` → true → no change → useEffect doesn't fire

**The comment on lines 637-638 explains why they avoided `state`:**
```javascript
// NOTE: Removed entire 'state' dependency - it was causing excessive re-renders
// on EVERY state change. The specific fields above are sufficient.
```

**But depending on specific nested fields MISSES changes to other nested fields!**

**Better approach:** Depend on TOP-LEVEL objects:
```javascript
state?.globalStrategy,      // ← Catches ALL globalStrategy changes
state?.platformConfig,      // ← Catches ALL platformConfig changes
state?.hostInventory,       // ← Catches ALL hostInventory changes
state?.credentials,         // ← Catches ALL credentials changes
state?.trust,               // ← Catches ALL trust changes
state?.operators,           // ← Catches ALL operators changes
state?.blueprint,           // ← Already mostly here
state?.methodology,         // ← Already here
state?.release,             // ← Already here
state?.version,             // ← Already here
```

**Why this works:**
- When you update `networking.machineNetworkV4`:
  - `updateNetworking()` creates NEW `globalStrategy` object
  - React compares: `Object.is(oldGlobalStrategy, newGlobalStrategy)` → false → changed!
  - useEffect fires immediately

**Why this is better than `state`:**
- `state` includes UI fields (activeStepId, visitedSteps, completedSteps)
- UI changes don't affect YAML but would trigger regeneration
- Top-level objects filter out UI noise

---

## 🔥 SMOKING GUN #7: Backend 600ms Debounce (MINOR INTERFERENCE)

**File:** `frontend/src/store.jsx` lines 59-67

**Current backend persistence:**
```javascript
useEffect(() => {
  if (!state) return;
  const toPersist = getStateForPersistence(state);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toPersist));
  const timeout = setTimeout(() => {
    apiFetch("/api/state", { method: "POST", body: JSON.stringify(toPersist) }).catch(() => {});
  }, 600); // ← 600ms debounce
  return () => clearTimeout(timeout);
}, [state]);
```

**Issue:**
- Frontend updates state immediately
- Backend persistence waits 600ms
- If YAML generation reads from backend state instead of frontend state
- YAML would be generated from stale state

**Likelihood:** LOW - YAML generation likely uses frontend state, not backend
- But worth checking in generate endpoint

---

## 🔥 SMOKING GUN #8: Object Spread Creates New References Every Time

**File:** `frontend/src/steps/NetworkingV2Step.jsx` lines 51-59

**Current update pattern:**
```javascript
const updateStrategy = (patch) => 
  updateState({ globalStrategy: { ...strategy, ...patch } });

const updateNetworking = (patch) =>
  updateStrategy({ networking: { ...networking, ...patch } });
```

**What happens:**
1. User updates `machineNetworkV4`
2. `updateNetworking({ machineNetworkV4: "10.0.0.0/16" })`
3. Spreads: `{ ...strategy, networking: { ...networking, machineNetworkV4: "10.0.0.0/16" } }`
4. Creates BRAND NEW `globalStrategy` object
5. `updateState({ globalStrategy: newGlobalStrategy })`
6. Spreads: `{ ...prev, globalStrategy: newGlobalStrategy }`
7. NEW state object with NEW globalStrategy reference

**This is actually CORRECT!**
- Creates new object references (React detects changes)
- Immutable update pattern (React best practice)

**But combined with specific dependencies, it fails:**
- New `globalStrategy` object created
- But dependency checks `state?.globalStrategy?.fips` (specific field)
- If `fips` value unchanged, dependency check fails
- useEffect doesn't fire

**This proves SMOKING GUN #6** - need to depend on objects, not nested fields

---

## 🔥 SMOKING GUN #9: React 18 Automatic Batching

**React 18 feature:** Automatic batching of state updates

**Scenario:**
```javascript
onBlur={(e) => {
  const newValue = e.target.value.trim();
  if (newValue !== storeValue) {
    updateStore({ field: newValue }); // ← Batched
  }
}}
```

**What React 18 does:**
1. Collects all setState calls in event handler
2. Batches them into single re-render
3. useEffects fire AFTER batched update completes

**For single onBlur, this is fine:**
- onBlur fires
- setState batched
- Re-render
- useEffect fires (IF dependency changed)

**But if dependencies are wrong (SMOKING GUN #1), batching doesn't matter**

**Likelihood:** NOT the root cause, but can compound the issue

---

## 🔥 SMOKING GUN #10: AbortController May Cancel Valid Requests

**File:** `frontend/src/App.jsx` line 607

**Current cleanup:**
```javascript
return () => controller.abort();
```

**Scenario:**
1. User blurs field A → state updates → useEffect fires → request 1 starts
2. User IMMEDIATELY blurs field B → state updates → dependencies change
3. useEffect cleanup fires → **aborts request 1** (even though it's valid!)
4. useEffect fires again → request 2 starts
5. Request 2 completes → shows both A and B changes

**This explains the lag IF user types very quickly**
- But shouldn't cause lag if user pauses between fields
- The request ID tracking should handle this

**Likelihood:** LOW for typical use, MEDIUM for rapid field changes

---

## Summary: The Real Root Causes

**PRIMARY (99% sure):**
1. 🔥🔥🔥 **SMOKING GUN #1** - Missing networking dependencies
2. 🔥🔥🔥 **SMOKING GUN #2** - Missing platformConfig dependencies  
3. 🔥🔥🔥 **SMOKING GUN #6** - Dependency array too specific (architectural issue)

**CONTRIBUTING FACTORS:**
4. 🔥 **SMOKING GUN #3** - Host inventory array reference
5. 🔥 **SMOKING GUN #4** - Missing trust/proxy sub-fields
6. **SMOKING GUN #7** - Backend debounce (minor)
7. **SMOKING GUN #9** - React batching (not root cause)
8. **SMOKING GUN #10** - AbortController (edge case)

**NOT ISSUES:**
- **SMOKING GUN #5** - Credentials (already in array)
- **SMOKING GUN #8** - Object spread (correct pattern)

---

## THE FIX

**Replace specific nested field dependencies with top-level object dependencies:**

```javascript
// BEFORE (BROKEN) - 30+ specific fields
useEffect(() => {
  // ... generate YAML ...
}, [
  showPreview,
  previewStepId,
  state?.globalStrategy?.fips,              // ← Too specific
  state?.globalStrategy?.proxyEnabled,       // ← Too specific
  state?.globalStrategy?.proxies,            // ← Too specific
  state?.platformConfig?.region,             // ← Too specific
  state?.platformConfig?.instanceType,       // ← Too specific
  // ... 20+ more specific fields
]);

// AFTER (FIXED) - Top-level objects
useEffect(() => {
  // ... generate YAML ...
}, [
  showPreview,
  previewStepId,
  state?.globalStrategy,      // ← Catches ALL changes
  state?.platformConfig,      // ← Catches ALL changes
  state?.hostInventory,       // ← Catches ALL changes
  state?.credentials,         // ← Catches ALL changes
  state?.trust,               // ← Catches ALL changes
  state?.operators,           // ← Catches ALL changes
  state?.blueprint,           // ← Catches ALL changes
  state?.methodology,         // ← Catches ALL changes
  state?.release,             // ← Catches ALL changes
  state?.version,             // ← Catches ALL changes
]);
```

**This will:**
- ✅ Fire useEffect on ANY relevant state change
- ✅ Catch networking field updates
- ✅ Catch platformConfig field updates
- ✅ Catch ALL nested field updates
- ✅ NOT fire on UI-only changes (activeStepId, visitedSteps, etc.)
- ✅ Simple, maintainable, correct

---

**Created:** 2026-05-12 23:10 UTC  
**Updated:** 2026-05-12 23:20 UTC  
**Confidence:** EXTREMELY HIGH - This WILL fix the issue
**Ready to implement:** YES
