# Import Still Broken - 20+ Smoking Guns

**Date:** 2026-05-13  
**Issue:** Import run file shows correct data in UI but YAML shows incorrect/empty values  
**Screenshot Evidence:** UI shows 3cp + 6w = 9 nodes, YAML shows replicas:0 and hosts:[]  
**Import File:** `/home/billstrauss/code/runs/airgap-run_2026-04-20_1928_bare-metal-agent_amd64_ocp-4.21_fips_proxy_3cp_6w.json`

---

## Evidence from Import File

**Verified:**
- Import file has 9 nodes (3 master, 6 worker) ✓
- Import file has proxy config ✓  
- Import file has VIPs (apiVip: 10.90.0.5, ingressVip: 10.90.0.6) ✓
- Import file has FIPS enabled ✓
- Import file has methodology: "Agent-Based Installer" ✓

**Screenshot shows:**
- UI left side: 9 nodes displayed correctly (3 control plane, 6 workers) ✓
- YAML right side: `compute.replicas: 0` ❌
- YAML right side: `agent-config.yaml hosts: []` ❌

**This proves:** Frontend state has data (UI renders it), but API receives different state

---

## The 20+ Smoking Guns

### Gun #1: 150ms Delay Didn't Fix Import
**Evidence:** Implemented 150ms delay for imports (commit from previous fix)  
**Result:** YAML still shows empty/wrong data  
**Smoking gun:** Delay alone is not sufficient. There's a deeper problem.

---

### Gun #2: Methodology Didn't Change in This Import
**Evidence:** Import file has methodology: "Agent-Based Installer"  
**User scenario:** Likely user already had Agent-Based selected before import  
**Result:** methodologyChanged = false, but isImporting should = true  

**Smoking gun:** If import happens but methodology doesn't change, we're relying solely on isImporting flag. Need to verify this is working.

---

### Gun #3: Import File is From April 20 (23 Days Old)
**Evidence:** Import file created 2026-04-20, current date 2026-05-13  
**Changes since then:** Likely many commits between April 20 and May 13  

**Smoking gun:** Old import file might have schema or structure differences. Backend might be migrating it incorrectly or stripping data.

---

### Gun #4: sanitizeStateForExport Strips Data
**File:** `backend/src/index.js` line 1164  
**Evidence:**
```javascript
const sanitized = sanitizeStateForExport(migrated, { ...(migrated.exportOptions || {}), includeCredentials: false });
setState(sanitized);  // Backend state
res.json({ ok: true, state: sanitized });  // Returns to frontend
```

**What sanitizeStateForExport does (lines 550-574):**
- Strips credentials (pullSecretPlaceholder, mirrorRegistryPullSecret)
- Strips certificates if includeCertificates: false
- Returns modified copy

**Smoking gun:** If sanitizeStateForExport has a bug or is stripping more than credentials, it could be removing hostInventory or operators.

---

### Gun #5: No Verification sanitizeStateForExport Preserves hostInventory
**Evidence:** Checked sanitizeStateForExport code - only touches credentials and trust  
**BUT:** Uses `JSON.parse(JSON.stringify(state))` for deep clone  

**Smoking gun:** JSON stringify/parse can strip undefined values or circular references. If hostInventory.nodes has any non-serializable data, it could be lost.

---

### Gun #6: Import Calls Backend setState THEN Frontend setState
**Flow:**
1. Backend /api/run/import calls `setState(sanitized)` (line 1165)
2. Frontend receives sanitized state
3. Frontend calls `setState({ ...merged, ui: nextUi })` (line 978)

**Smoking gun:** Two separate state stores. If frontend setState is called BEFORE backend setState persists, there's a race condition.

---

### Gun #7: Backend State May Override Frontend State
**Evidence:** Backend has 600ms debounced persistence to backend state store  
**Flow:**
1. Import updates backend state immediately
2. Import updates frontend state immediately
3. Frontend makes other changes
4. 600ms later, frontend state syncs to backend... but backend already has import state
5. Potential conflict/override

**Smoking gun:** Backend state and frontend state might be out of sync after import.

---

### Gun #8: No Logging to Verify What's Sent to API
**Evidence:** No console.log in current code to see what state is sent  
**Result:** Can't verify if state has nodes when API is called  

**Smoking gun:** Flying blind. Don't know if problem is frontend (sending wrong state) or backend (receiving/processing wrong).

---

### Gun #9: Multiple useEffect Fires Still Possible
**Evidence:** Import changes multiple dependencies:
- state.hostInventory (new nodes)
- state.blueprint (might change)
- state.methodology (might not change)
- state.globalStrategy (fips, proxy, networking)
- state.operators (selected operators)
- active index changes

**Smoking gun:** Even with 150ms delay, if useEffect fires multiple times rapidly, the AbortController cleanup could be canceling the correct API call and letting a stale one through.

---

### Gun #10: AbortController Created Outside setTimeout
**File:** `frontend/src/App.jsx` line 597  
**Evidence:**
```javascript
const controller = new AbortController();

const timer = setTimeout(() => {
  // ... API call with controller.signal
}, delay);

return () => {
  clearTimeout(timer);
  controller.abort();  // Aborts even if setTimeout hasn't fired yet
};
```

**Smoking gun:** If useEffect fires twice in rapid succession:
1. First useEffect creates controller1, starts timer1
2. Second useEffect cleanup runs IMMEDIATELY
3. Cleanup calls controller1.abort() - aborts before timer1 fires
4. Second useEffect creates controller2, starts timer2
5. timer2 fires, but might capture stale state from when second useEffect ran

---

### Gun #11: importingRef Might Be Cleared Too Soon
**File:** `frontend/src/App.jsx` lines 982-984  
**Evidence:**
```javascript
setTimeout(() => {
  importingRef.current = false;
}, 200);
```

**Flow:**
1. importingRef.current = true
2. setState + setActive (schedules updates)
3. After 200ms, importingRef.current = false
4. React processes updates (could be >200ms later in complex app)
5. useEffect fires
6. isImporting = importingRef.current = false (already cleared!)
7. delay = 0

**Smoking gun:** If React takes >200ms to process setState (e.g., complex reconciliation), importingRef could be cleared before useEffect fires, resulting in 0ms delay.

---

### Gun #12: No Verification Logging Was Added
**Evidence:** Added logging to App.jsx and backend but didn't test yet  

**Smoking gun:** Can't confirm logging is actually showing the problem until user tests.

---

### Gun #13: Import Endpoint Doesn't Log What It Receives
**File:** `backend/src/index.js` line 1144  
**Evidence:** No console.log showing what payload.state contains  

**Smoking gun:** Can't verify backend receives complete import file data. Maybe frontend is sending partial payload?

---

### Gun #14: Frontend import Doesn't Log What Backend Returns
**File:** `frontend/src/App.jsx` line 909  
**Evidence:**
```javascript
const data = await apiFetch("/api/run/import", { method: "POST", body: JSON.stringify(payload) });
// No logging of data.state
```

**Smoking gun:** Can't verify backend returns complete state after sanitization.

---

### Gun #15: Schema Version Migration Logic
**File:** `backend/src/index.js` lines 1153-1155  
**Evidence:**
```javascript
const migrated = schemaVersion === 1
  ? { ...defaultState(), ...payload.state, exportOptions: payload.state.exportOptions || defaultState().exportOptions }
  : payload.state;
```

**Import file has schemaVersion: 2, so:** migrated = payload.state (no merging with defaultState)

**Smoking gun:** If schemaVersion 2 expects certain fields that schemaVersion 1 had in defaultState(), they might be missing. No backward compatibility check.

---

### Gun #16: defaultState() Might Have Empty hostInventory
**Evidence:** Need to check what defaultState() returns  

**Smoking gun:** If defaultState() has `hostInventory: { nodes: [] }` and import uses schemaVersion 1, the spread operator `{ ...defaultState(), ...payload.state }` would put defaultState first, then override with payload.state. But if payload.state.hostInventory is undefined (not empty array), it wouldn't override defaultState's empty array.

---

### Gun #17: Import File Might Be Malformed
**Evidence:** Import file is 3 weeks old  

**Smoking gun:** Between April 20 and May 13, code changes might have made old import files incompatible. Need to verify file structure matches current expectations.

---

### Gun #18: reconcileReviewFlagsForImportedState Might Modify State
**File:** `frontend/src/App.jsx` line 930  
**Evidence:**
```javascript
const reviewFlags = reconcileReviewFlagsForImportedState(rowState, stepIds);
const merged = { ...rowState, reviewFlags };
```

**Smoking gun:** If reconcileReviewFlagsForImportedState has side effects or returns modified rowState instead of just reviewFlags, merged could have wrong data.

---

### Gun #19: computeVisibleWizardRows Might Filter Steps
**File:** `frontend/src/App.jsx` line 928  
**Evidence:**
```javascript
const rows = computeVisibleWizardRows(rowState, stepMap || {});
```

**Smoking gun:** If import has old step IDs or structure, computeVisibleWizardRows might be filtering out or changing step order, affecting what gets rendered vs what's in state.

---

### Gun #20: YAML Generation Might Be Using BACKEND State Not REQUEST State
**File:** `backend/src/index.js` line 2318  
**Evidence:**
```javascript
const parsed = parseOptionalClientState(req.body?.state, ensureState);
```

**If req.body?.state is undefined:** parseOptionalClientState returns ensureState() (backend state)  
**If req.body?.state is present:** parseOptionalClientState returns req.body.state

**Smoking gun:** If frontend is NOT sending state in request body (bug in our fix?), backend falls back to ensureState() which might be empty or stale.

---

### Gun #21: Frontend Might Not Be Including state in Request Body
**File:** `frontend/src/App.jsx` line 613  
**Evidence:**
```javascript
body: JSON.stringify({ state }),
```

**Smoking gun:** If state variable is undefined at this point (shouldn't be possible but...), the request body would be `{"state":undefined}` which JSON.stringify converts to `{}`, and backend would fall back to ensureState().

---

### Gun #22: useEffect State Closure Might Be Stale
**Evidence:** useEffect captures state variable from closure  

**Flow:**
1. Import updates state
2. React schedules re-render
3. useEffect from OLD render fires (with OLD state)
4. Creates timer with 150ms delay
5. React re-renders with NEW state
6. useEffect from NEW render fires (with NEW state)
7. Cleanup from OLD useEffect runs - aborts controller, clears timer
8. NEW useEffect timer fires with NEW state... but might be overridden?

**Smoking gun:** React's cleanup timing might be causing old useEffect to interfere with new useEffect.

---

### Gun #23: Build Functions Might Have Bugs for Empty Data
**Evidence:** buildInstallConfig and buildAgentConfig have complex logic  

**Smoking gun:** If state has partial data (e.g., hostInventory exists but nodes is empty array instead of undefined), the build functions might have code paths that return empty YAML.

---

### Gun #24: Screenshot Shows Specific Values
**Evidence from screenshot YAML:**
- controlPlane.replicas: 3 ✓ (CORRECT - means masters count is right)
- compute.replicas: 0 ✗ (WRONG - should be 6)
- agent-config hosts: [] ✗ (WRONG - should have 9 hosts)

**This is VERY SPECIFIC:**
- Masters count is CORRECT (3)
- Workers count is WRONG (0 instead of 6)

**Smoking gun:** The state has master nodes but NOT worker nodes. Or the worker nodes have wrong role value. This is a data corruption issue, not a timing issue.

---

### Gun #25: Worker Role Might Be Different
**Verified import file:** Worker nodes have `"role": "worker"`  
**Backend filters:** `sortedNodes.filter((node) => node.role === "worker")`

**Smoking gun:** If import migration changes role values (e.g., "worker" → "compute" or something), the filter would miss them. Need to verify import preserves role values exactly.

---

## Critical Discovery: Masters Count is Correct, Workers Count is Wrong

**This changes everything.**

The YAML shows:
- controlPlane.replicas: 3 ✓
- compute.replicas: 0 ✗

This means:
1. state.hostInventory.nodes IS present (otherwise masters would be 0)
2. state.hostInventory.nodes has 3 nodes with role="master"
3. state.hostInventory.nodes has 0 nodes with role="worker"
4. The 6 worker nodes are either:
   - Missing from the array
   - Have wrong role value
   - Are being filtered out somewhere

**This is NOT a timing issue. This is a data corruption issue.**

---

## Hypotheses

### Hypothesis A: Import Strips Worker Nodes
**Likelihood:** MEDIUM  
**Why:** sanitizeStateForExport or import endpoint might be filtering nodes  
**Test:** Log data.state.hostInventory.nodes in importRun after receiving from backend

---

### Hypothesis B: Worker Nodes Have Wrong Role
**Likelihood:** LOW  
**Why:** Import file verified to have "worker" role  
**Test:** Log node roles in frontend state after import

---

### Hypothesis C: Frontend Merges Wrong Data
**Likelihood:** MEDIUM  
**Why:** const merged = { ...rowState, reviewFlags } might not include hostInventory correctly  
**Test:** Log merged.hostInventory.nodes before setState

---

### Hypothesis D: setState Doesn't Preserve All Fields
**Likelihood:** LOW  
**Why:** setState is standard React, shouldn't lose data  
**Test:** Log state after setState completes (in next useEffect)

---

### Hypothesis E: Old Import File Has Different Structure
**Likelihood:** HIGH ⭐  
**Why:** Import file is 3 weeks old, might have old schema  
**Test:** Check if old files have hostInventory.nodes or different field name

---

## Investigation Steps

### Step 1: Add Logging to Import Flow (DONE)
- ✅ Added logging to frontend App.jsx useEffect
- ✅ Added logging to backend /api/generate
- ✅ Added logging to buildInstallConfig
- ✅ Added logging to buildAgentConfig

### Step 2: Add Logging to Import Endpoint
```javascript
// In backend/src/index.js line 1144
app.post("/api/run/import", (req, res) => {
  const payload = req.body || {};
  console.log('[IMPORT DEBUG] Received payload:');
  console.log('[IMPORT DEBUG] - schemaVersion:', payload.schemaVersion);
  console.log('[IMPORT DEBUG] - state.hostInventory.nodes count:', payload.state?.hostInventory?.nodes?.length);
  console.log('[IMPORT DEBUG] - state.operators.selected count:', payload.state?.operators?.selected?.length);
  // ... rest of function
```

### Step 3: Add Logging to importRun Function
```javascript
// In frontend/src/App.jsx line 909
const data = await apiFetch("/api/run/import", { method: "POST", body: JSON.stringify(payload) });

console.log('[IMPORT DEBUG] Received from backend:');
console.log('[IMPORT DEBUG] - data.state.hostInventory.nodes count:', data.state?.hostInventory?.nodes?.length);
console.log('[IMPORT DEBUG] - data.state.operators.selected count:', data.state?.operators?.selected?.length);

const baseState = data.state || {};
// ... rest of function
```

### Step 4: Add Logging Before setState
```javascript
// In frontend/src/App.jsx line 978
const merged = { ...rowState, reviewFlags };

console.log('[IMPORT DEBUG] About to setState with merged:');
console.log('[IMPORT DEBUG] - merged.hostInventory.nodes count:', merged.hostInventory?.nodes?.length);
console.log('[IMPORT DEBUG] - merged.operators.selected count:', merged.operators?.selected?.length);

setState({ ...merged, ui: nextUi });
```

### Step 5: User Tests Import
1. Open browser DevTools console
2. Click import, select run file
3. Check console logs for all DEBUG messages
4. Report back with log output

---

## Next Steps

1. **Add remaining logging** (import endpoint, importRun, before setState)
2. **User tests import** with full logging
3. **Analyze logs** to find where data is lost
4. **Implement fix** based on log evidence
5. **Don't claim fix** until user confirms YAML shows correct data

---

**Created:** 2026-05-13  
**Status:** INVESTIGATION IN PROGRESS  
**Logging added:** Partial (App.jsx useEffect, backend generate endpoint, build functions)  
**Logging needed:** Import endpoint, importRun, pre-setState  
**User action required:** Test import with logging enabled
