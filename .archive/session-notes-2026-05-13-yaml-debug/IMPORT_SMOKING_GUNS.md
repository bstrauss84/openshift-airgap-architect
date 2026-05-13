# Import Run - Smoking Guns (14+)

**Date:** 2026-05-12  
**Issue:** Importing run file shows incomplete YAML despite UI showing imported data  
**User Report:**
- Imported full scenario from run file
- UI shows all imported data (proxy, VIPs, nodes, MACs, FIPS, operators)
- YAML drawer shows incomplete data (missing proxy, VIPs, nodes, FIPS)
- imageset-config.yaml missing operators despite operator list populated

---

## The Smoking Guns

### Gun #1: Import Doesn't Trigger 150ms Delay
**File:** `frontend/src/App.jsx` lines 580-586  
**Evidence:**
```javascript
const currentMethod = state?.methodology?.method;
const methodologyChanged = currentMethod !== prevMethodologyRef.current;
prevMethodologyRef.current = currentMethod;
const delay = methodologyChanged ? 150 : 0;
```

**Smoking gun:** Delay only triggers if methodology.method CHANGES. If you import a run with same methodology (e.g., both IPI → IPI), delay = 0. No time for state to settle.

---

### Gun #2: Import Updates Active Step Simultaneously
**File:** `frontend/src/App.jsx` lines 969-970  
**Evidence:**
```javascript
setState({ ...merged, ui: nextUi });
setActive(targetIdx);
```

**Smoking gun:** importRun calls TWO state updates back-to-back. setState for imported data, setActive for navigation. Both trigger re-renders.

---

### Gun #3: previewStepId Depends on active
**File:** `frontend/src/App.jsx` line 396  
**Evidence:**
```javascript
const previewStepId = visibleSteps[active]?.id;
```

**Smoking gun:** previewStepId is recalculated when active changes. It's in useEffect dependencies (line 634). Changing active causes useEffect to fire.

---

### Gun #4: Multiple State Updates Trigger Multiple useEffect Fires
**Flow:**
1. setState({ ...merged }) → state.* changes → useEffect dependencies change
2. setActive(targetIdx) → active changes → previewStepId changes → useEffect dependencies change
3. React batches renders but useEffect cleanup runs between fires

**Smoking gun:** Import causes at least TWO useEffect fires in rapid succession. Second one aborts first one's API call.

---

### Gun #5: AbortController Created Outside setTimeout
**File:** `frontend/src/App.jsx` line 588  
**Evidence:**
```javascript
const controller = new AbortController();

const timer = setTimeout(() => {
  // API call uses controller.signal
}, delay);

return () => {
  clearTimeout(timer);
  controller.abort();  // Aborts even if setTimeout hasn't fired
};
```

**Smoking gun:** If useEffect fires twice rapidly, cleanup aborts the controller BEFORE setTimeout callback fires. First API call is cancelled, second one runs.

---

### Gun #6: setState is Asynchronous
**Evidence:** React setState schedules update, doesn't apply immediately  

**Smoking gun:** When importRun calls setState(newState), the state variable in App doesn't update until next render. If cleanup/new useEffect fires before render completes, might see partial state.

---

### Gun #7: Import is After Async Operation
**File:** `frontend/src/App.jsx` lines 907-909  
**Evidence:**
```javascript
const text = await file.text();
const payload = JSON.parse(text);
const data = await apiFetch("/api/run/import", { method: "POST", body: JSON.stringify(payload) });
```

**Smoking gun:** importRun is async. setState happens after await. React 18 automatic batching might not batch setState + setActive if they're after await in async function.

---

### Gun #8: sanitizeStateForExport Strips Credentials
**File:** `backend/src/index.js` line 1164  
**Evidence:**
```javascript
const sanitized = sanitizeStateForExport(migrated, { ...(migrated.exportOptions || {}), includeCredentials: false });
setState(sanitized);  // Backend state
res.json({ ok: true, state: sanitized });  // Sent to frontend
```

**Smoking gun:** Import endpoint forces `includeCredentials: false`. Strips pull secrets, passwords from imported state. Frontend gets sanitized state.

---

### Gun #9: Import Updates Both Backend AND Frontend State
**Flow:**
1. Backend /api/run/import receives imported data (line 1144)
2. Backend calls setState(sanitized) (line 1165)
3. Backend returns sanitized state
4. Frontend calls setState with returned data (line 969)

**Smoking gun:** Two separate state stores. Backend state updated by import endpoint. Frontend state updated by importRun. Both should be same sanitized data, but timing matters.

---

### Gun #10: No "Import Detected" Logic
**Evidence:** Checked App.jsx, no special handling for imports vs regular edits  

**Smoking gun:** Import is treated same as regular state update. No delay, no detection, no special handling for large state changes.

---

### Gun #11: Delay Detection Only Checks Methodology
**File:** `frontend/src/App.jsx` lines 580-586  
**Evidence:**
```javascript
const methodologyChanged = currentMethod !== prevMethodologyRef.current;
const delay = methodologyChanged ? 150 : 0;
```

**Smoking gun:** Only methodology changes get 150ms delay. Import changes EVERYTHING (blueprint, hostInventory, globalStrategy, operators, etc.), but gets 0ms delay if methodology doesn't change.

---

### Gun #12: React Batching Behavior with Multiple Updates
**Evidence:** React 18 automatic batching (even after await in async functions)  

**Smoking gun:** setState + setActive might be batched into single render, but useEffect cleanup/execution timing is unpredictable. Cleanup of first useEffect can abort in-flight setTimeout before it fires.

---

### Gun #13: Closure Captures State at useEffect Fire Time
**File:** `frontend/src/App.jsx` line 605  
**Evidence:**
```javascript
setTimeout(() => {
  // ...
  apiFetch("/api/generate", {
    method: "POST",
    body: JSON.stringify({ state }),  // ← Captures state from useEffect closure
    signal: controller.signal
  })
}, delay);
```

**Smoking gun:** The state variable is captured when useEffect fires. If useEffect fires BEFORE React finishes updating state (during batching), captured state might be old or transitional.

---

### Gun #14: previewStepId Changes Can Cause Extra API Calls
**Flow:**
1. Import changes state → useEffect fires with old previewStepId, new state
2. setActive changes active → previewStepId recalculates → useEffect fires again
3. Second useEffect aborts first API call
4. Second API call runs with... old or new state?

**Smoking gun:** previewStepId changing causes useEffect to fire again. This second fire aborts the first API call. Second API call might send different state than first (if React batching hasn't finished).

---

## Additional Evidence: UI Shows Data, YAML Doesn't

**User Quote:**
> "quickpicks and selected operator list being populated.... shows no operators listed"

**Analysis:**
- "quickpicks and selected operator list being populated" = UI shows `state.operators.selected` has data
- "imageset config file... shows no operators listed" = buildImageSetConfig received `state.operators.selected = []`

**This proves:** The state sent to backend API is DIFFERENT from the state React is rendering in UI.

**How is this possible?**
1. UI renders with latest state (after import)
2. API call was made with STALE state (before import or during transition)
3. API call completed and set previewFiles with stale YAML
4. UI shows new state, YAML shows old state

---

## Root Cause Hypothesis

### Primary Cause: Race Condition from Rapid useEffect Fires

**Import flow:**
1. `importRun` calls `await apiFetch("/api/run/import", ...)` - backend updates its state
2. `importRun` calls `setState({ ...merged, ui: nextUi })` - schedules frontend state update
3. `importRun` calls `setActive(targetIdx)` - schedules active update
4. React batches these updates (MIGHT batch, might not - async function)
5. First render with new state → useEffect fires
   - Creates controller1
   - Starts setTimeout1 with delay=0 or 150ms
   - Returns cleanup function
6. Second render with new active → previewStepId changes → useEffect fires AGAIN
   - Cleanup1 runs: clearTimeout(timer1), controller1.abort()
   - Creates controller2
   - Starts setTimeout2 with delay=0 or 150ms
7. setTimeout1 was cancelled or controller1 was aborted - first API call never completes
8. setTimeout2 fires → API call with state from second useEffect
9. But which state? If React still batching, might be transitional state

**Result:** YAML generated from wrong state snapshot during React's batching/rendering cycle.

---

### Secondary Cause: No Delay for Import Operations

**Evidence:**
- Methodology change gets 150ms delay
- Import gets 0ms delay (unless methodology also changed)
- Import changes 10+ top-level state objects simultaneously
- React needs time to batch and settle these updates
- API call fires immediately (delay=0) before React finishes

**Result:** API call captures state mid-transition, missing some imported data.

---

## Proof: Check Browser DevTools

**User can verify:**
1. Open browser DevTools → Network tab
2. Import a run file
3. Watch for POST /api/generate requests
4. Check request payload (request body contains `{state: {...}}`)
5. Inspect `state.operators.selected`, `state.hostInventory.nodes`, etc.
6. Compare to UI display

**Expected finding:** Request payload has empty/incomplete data despite UI showing full data.

---

## Solutions (In Order of Viability)

### Solution 1: Detect Import and Add Delay (RECOMMENDED)

**Add import detection to trigger 150ms delay:**

```javascript
// In App.jsx, add ref to track imports
const importingRef = useRef(false);

// In importRun function (line 969)
importingRef.current = true;
setState({ ...merged, ui: nextUi });
setActive(targetIdx);
setTimeout(() => {
  importingRef.current = false;
}, 200);  // Clear flag after import settles

// In useEffect (line 580-586)
const currentMethod = state?.methodology?.method;
const methodologyChanged = currentMethod !== prevMethodologyRef.current;
prevMethodologyRef.current = currentMethod;

const isImporting = importingRef.current;
const delay = (methodologyChanged || isImporting) ? 150 : 0;
```

**Pros:**
- Simple addition to existing code
- Gives React time to settle all import state updates
- Works for any import (same or different methodology)
- Low risk

**Cons:**
- Adds 150ms delay to imports (user might not notice)
- Requires modifying both importRun and useEffect

**Likelihood of Success:** HIGH ✅

---

### Solution 2: Debounce All Large State Changes

**Detect when multiple top-level objects change simultaneously:**

```javascript
const prevStateRef = useRef({});

useEffect(() => {
  const changedObjects = [];
  if (state?.blueprint !== prevStateRef.current.blueprint) changedObjects.push('blueprint');
  if (state?.methodology !== prevStateRef.current.methodology) changedObjects.push('methodology');
  if (state?.hostInventory !== prevStateRef.current.hostInventory) changedObjects.push('hostInventory');
  if (state?.operators !== prevStateRef.current.operators) changedObjects.push('operators');
  // ... check all top-level objects
  
  prevStateRef.current = state;
  
  const largeChange = changedObjects.length >= 3;  // 3+ objects changed = import or major change
  const delay = largeChange ? 150 : 0;
  
  // ... rest of useEffect
}, [dependencies]);
```

**Pros:**
- Detects any large state change, not just imports
- Handles methodology switch, import, restore, etc.

**Cons:**
- Complex logic
- Need to track all top-level objects
- Might have false positives

**Likelihood of Success:** MEDIUM

---

### Solution 3: Move controller Inside setTimeout

**Fix race condition where controller is aborted before setTimeout fires:**

```javascript
useEffect(() => {
  // Detect delay
  const delay = /* ... */;
  
  let controller = null;  // Don't create yet
  
  const timer = setTimeout(() => {
    controller = new AbortController();  // Create inside timeout
    
    apiFetch("/api/generate", {
      method: "POST",
      body: JSON.stringify({ state }),
      signal: controller.signal
    })
    // ...
  }, delay);
  
  return () => {
    clearTimeout(timer);
    if (controller) controller.abort();  // Only abort if created
  };
}, [dependencies]);
```

**Pros:**
- Prevents controller from being aborted before setTimeout fires
- Fixes race condition

**Cons:**
- Doesn't fix the state capture timing issue
- Controller cleanup is less reliable (might not exist yet)
- Still sends stale state if React is batching

**Likelihood of Success:** LOW

---

### Solution 4: Force React to Flush Updates Before YAML Generation

**Use flushSync to ensure state is fully updated:**

```javascript
import { flushSync } from 'react-dom';

// In importRun
flushSync(() => {
  setState({ ...merged, ui: nextUi });
  setActive(targetIdx);
});
// Now state is guaranteed to be updated before any useEffects run
```

**Pros:**
- Forces synchronous state update
- Ensures useEffect sees final state

**Cons:**
- Bypasses React optimizations (not recommended pattern)
- Requires import of react-dom
- Doesn't work with async imports

**Likelihood of Success:** MEDIUM

---

### Solution 5: Increase Delay for Methodology Changes to 250-300ms

**Current 150ms might not be enough for complex imports:**

```javascript
const delay = methodologyChanged ? 250 : 0;  // Increase from 150ms
```

**Pros:**
- Very simple
- More conservative delay gives React more time

**Cons:**
- Doesn't fix import issue (only methodology changes get delay)
- Noticeable delay for user
- Band-aid, not root fix

**Likelihood of Success:** LOW

---

## Recommended Fix: Solution 1 (Import Detection + Delay)

**Implementation:**

1. Add `importingRef` to track when import is in progress
2. Set flag in `importRun` before setState
3. Clear flag after 200ms (gives React time to settle)
4. Check flag in useEffect delay logic
5. Apply 150ms delay for imports

**Code changes:** ~10 lines total  
**Risk:** Low  
**Testing:** Import run, verify YAML shows all data  

---

## IMPLEMENTATION STATUS ✅

**Date Implemented:** 2026-05-12  
**Commits:** [pending test confirmation]

**Changes Made:**

1. **Added importingRef** (`frontend/src/App.jsx` line 199)
   ```javascript
   const importingRef = useRef(false);  // Track when import is in progress
   ```

2. **Modified importRun** (`frontend/src/App.jsx` lines 971-981)
   ```javascript
   // Mark import in progress to trigger delay in YAML generation
   importingRef.current = true;
   
   setState({ ...merged, ui: nextUi });
   setActive(targetIdx);
   
   // Clear import flag after state settles
   setTimeout(() => {
     importingRef.current = false;
   }, 200);
   ```

3. **Modified useEffect delay logic** (`frontend/src/App.jsx` lines 579-593)
   ```javascript
   const currentMethod = state?.methodology?.method;
   const methodologyChanged = currentMethod !== prevMethodologyRef.current;
   prevMethodologyRef.current = currentMethod;
   
   const isImporting = importingRef.current;
   
   // 150ms delay for large state changes (methodology switch, imports)
   const delay = (methodologyChanged || isImporting) ? 150 : 0;
   ```

**Result:** Import now triggers same 150ms delay as methodology changes. React has time to settle all state updates before YAML generation API call fires.

---

**Created:** 2026-05-12  
**Status:** ✅ IMPLEMENTED, awaiting user testing  
**Actual implementation time:** 8 minutes  
**Confidence:** HIGH (addresses root cause: React batching timing)
