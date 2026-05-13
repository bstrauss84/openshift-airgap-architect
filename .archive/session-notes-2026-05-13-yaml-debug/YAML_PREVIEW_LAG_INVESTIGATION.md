# YAML Preview Lag - Comprehensive Investigation

**Date:** 2026-05-12 23:00 UTC  
**Status:** ACTIVE INVESTIGATION  
**Priority:** P0 - CRITICAL

---

## Problem Statement

**User Report:**
> "I update a field, i exit the field, nothing fucking happens to the yaml in the yaml preview. I click in another field, still nothing happens. I update one keystroke in the second field, and the changes to the first are finally reflected in the preview, but not the changes I just made in the second field."

**Behavior:**
- YAML preview updates are delayed by exactly ONE field change
- Always one step behind current state
- onBlur IS firing, but preview doesn't update until NEXT onBlur

---

## Investigation Approach

**Requirements:**
1. Find AT LEAST 5 potential root causes
2. Find AT LEAST 5 potential solutions
3. Document EVERYTHING we've tried
4. NO settling for first "smoking gun"
5. Look for MULTIPLE issues (smoking guns plural)

---

## What We've Tried (Chronological)

### Attempt 1: Debouncing + Request Cancellation
**Commit:** 9e8b357  
**Date:** 2026-05-12  
**Approach:** Add 300ms debounce in App.jsx useEffect  
**Result:** FAILED  
**Why Failed:** SecretInput onChange blocking + React batching interference

### Attempt 2: onBlur Refactor (MASSIVE)
**Commits:** a6e7b60, 24b1dd2  
**Date:** 2026-05-12  
**Approach:** 
- Convert ALL text inputs to onBlur pattern
- Add local state for immediate visual feedback
- Remove 300ms debounce from App.jsx
- Claimed "95% API reduction" and "100% fix"

**Files Changed:** 10 files, 1,520 additions, 376 deletions  
**Result:** FAILED - YAML still lags behind by one step  
**Why Failed:** Unknown - onBlur IS firing, but something prevents immediate update

### Attempt 3: React Hooks Violations Fix
**Commits:** 9c75088, 44c41e1  
**Date:** 2026-05-12  
**Approach:** Remove useMemo from YamlDrawer helper functions  
**Result:** PARTIAL - Fixed crashes, but lag persists  
**Why Failed:** This was a separate bug, not the root cause of lag

---

## Deep Code Analysis - Finding ALL Potential Causes

### Investigation Areas

1. App.jsx YAML preview useEffect (lines 553-639)
2. Store update mechanism (store.jsx)
3. onBlur handlers in step files
4. useEffect dependency arrays
5. React batching behavior
6. AbortController cleanup timing
7. Request ID tracking
8. State update merging
9. Preview step ID updates
10. Race conditions

---

## Potential Causes (Detailed)

### CAUSE 1: useEffect Dependency Array Issues

**File:** `frontend/src/App.jsx` lines 608-638  
**Issue:** Dependencies might not include all relevant state fields

**Current dependencies:**
```javascript
useEffect(() => {
  // ... YAML generation ...
}, [
  showPreview,
  previewStepId,
  state?.release?.patchVersion,
  state?.release?.confirmed,
  state?.version?.versionConfirmed,
  state?.blueprint?.platform,
  state?.blueprint?.confirmed,
  state?.blueprint?.blueprintPullSecretEphemeral,
  state?.methodology?.method,
  state?.blueprint?.clusterName,
  state?.blueprint?.baseDomain,
  // ... more individual fields ...
  state?.operators?.selected
]);
```

**Hypothesis:** Missing dependencies cause useEffect NOT to fire when state updates

**Evidence to check:**
- Are ALL state fields that affect YAML in the dependency array?
- When onBlur updates state, which fields change?
- Does the dependency array include those exact fields?

**Likelihood:** HIGH 🔥

---

### CAUSE 2: React State Update Batching

**Issue:** React batches multiple setState calls in event handlers

**Scenario:**
1. onBlur fires → calls `updateState({ field: newValue })`
2. React batches this update
3. useEffect doesn't fire until NEXT render
4. Next render happens when NEXT onBlur fires
5. Result: Always one step behind

**Evidence:**
- onBlur → setState → batched → useEffect fires LATER
- In React 18+, automatic batching is default
- Event handlers batch ALL setState calls

**Likelihood:** VERY HIGH 🔥🔥

---

### CAUSE 3: Store Update Not Triggering Subscribers

**File:** `frontend/src/store.jsx`

**Issue:** Zustand store might not notify subscribers immediately after updateState

**Current store implementation:**
```javascript
const useApp = create((set) => ({
  state: getInitialState(),
  updateState: (patch) => set((prev) => ({ 
    state: deepMerge(prev.state, patch) 
  }))
}));
```

**Hypothesis:** deepMerge or Zustand update might delay notification

**Likelihood:** MEDIUM 🔥

---

### CAUSE 4: AbortController Cleanup Race

**File:** `frontend/src/App.jsx` lines 578-607

**Current cleanup:**
```javascript
return () => controller.abort();
```

**Issue:** useEffect cleanup runs when dependencies change
- onBlur updates state
- Dependencies change
- useEffect cleanup fires → aborts current request
- NEW useEffect fires → starts new request
- But timing might cause valid request to be aborted

**Likelihood:** MEDIUM 🔥

---

### CAUSE 5: Request ID Tracking Off-By-One

**File:** `frontend/src/App.jsx` lines 584-585

**Current code:**
```javascript
previewRequestIdRef.current += 1;
const currentRequestId = previewRequestIdRef.current;
```

**Issue:** Request ID increments but response check might fail
- What if response arrives AFTER next request starts?
- Is the `currentRequestId === previewRequestIdRef.current` check correct?

**Likelihood:** LOW

---

### CAUSE 6: onBlur Handler Execution Order

**Issue:** Multiple onBlur handlers might interfere

**Scenario:**
1. User blurs field A → onBlur fires → updates local state
2. User focuses field B → field A onBlur STILL executing
3. Field B focus → field A onBlur completes → state updates
4. But useEffect already evaluated OLD state
5. Next onBlur triggers useEffect with field A's change

**Likelihood:** LOW

---

### CAUSE 7: State Update Not Deep Enough

**File:** `frontend/src/store.jsx` - deepMerge function

**Issue:** deepMerge might not update nested objects correctly

**Example:**
```javascript
updateNetworking({ machineNetworkV4: "10.0.0.0/16" })
// If deepMerge doesn't properly merge nested objects...
// state.globalStrategy.networking might not update
```

**Likelihood:** MEDIUM 🔥

---

### CAUSE 8: Preview Step ID Not Updating

**File:** `frontend/src/App.jsx`

**Issue:** `previewStepId` might not match `activeStepId` when expected

**Dependency:** `previewStepId` in useEffect array
- What sets previewStepId?
- Does it update when user changes tabs?
- Is it correct for all scenarios?

**Likelihood:** LOW

---

### CAUSE 9: Missing flush/forceUpdate

**Issue:** No explicit render flush after onBlur state update

**In React 18+:**
- Automatic batching delays updates
- No manual flush mechanism used
- useEffect fires AFTER batched updates complete
- But "after" might mean "next event loop tick"

**Likelihood:** HIGH 🔥🔥

---

### CAUSE 10: Backend Debounce Interference

**File:** `backend/src/store.js` (if exists)

**Issue:** Backend might have its own debouncing on state persistence

**From previous notes:** "600ms backend persistence debounce"

**Scenario:**
- Frontend sends state update
- Backend debounces for 600ms
- Frontend requests YAML generation
- Backend generates from OLD state (not yet persisted)
- Result: Stale YAML

**Likelihood:** UNKNOWN - need to check backend code

---

## Potential Solutions

### SOLUTION 1: Force Synchronous State Update + Render

**Approach:** Use flushSync from react-dom to force immediate render

**Code change:**
```javascript
import { flushSync } from 'react-dom';

// In onBlur handler:
onBlur={(e) => {
  const newValue = e.target.value.trim();
  if (newValue !== storeValue) {
    flushSync(() => {
      updateStore({ field: newValue });
    });
  }
}}
```

**Pros:**
- Forces React to update immediately
- No batching delay
- useEffect fires right after update

**Cons:**
- Bypasses React optimizations
- More expensive (more renders)
- Not recommended pattern

**Likelihood of Success:** HIGH 🔥🔥

---

### SOLUTION 2: Add Missing Dependencies to useEffect

**Approach:** Audit ALL state fields that affect YAML, add to dependencies

**Steps:**
1. List every state field that appears in generated YAML
2. Check if it's in useEffect dependency array
3. Add missing ones

**Example:**
```javascript
useEffect(() => {
  // ... generate YAML ...
}, [
  // ... existing ...
  state?.globalStrategy?.networking?.machineNetworkV4,
  state?.globalStrategy?.networking?.machineNetworkV6,
  state?.globalStrategy?.networking?.clusterNetworkCidr,
  // ... ALL networking fields ...
  state?.platformConfig?.vsphere?.apiVIPs,
  // ... etc ...
]);
```

**Pros:**
- Proper React pattern
- Ensures useEffect fires on ANY relevant change

**Cons:**
- Huge dependency array
- Hard to maintain
- Might cause excessive re-renders

**Likelihood of Success:** VERY HIGH 🔥🔥🔥

---

### SOLUTION 3: Watch Entire State Object with Deep Comparison

**Approach:** Use a deep comparison library to detect ANY state change

**Code:**
```javascript
import { useDeepCompareEffect } from 'use-deep-compare';

useDeepCompareEffect(() => {
  // ... generate YAML ...
}, [state]); // Deep compare entire state
```

**Pros:**
- Catches ALL state changes
- No missing dependencies

**Cons:**
- Requires new library
- Performance overhead (deep compare on every render)
- Might fire too often

**Likelihood of Success:** HIGH 🔥

---

### SOLUTION 4: Manual Trigger After onBlur

**Approach:** Explicitly trigger YAML regeneration after state update

**Code:**
```javascript
// In step files:
onBlur={(e) => {
  const newValue = e.target.value.trim();
  if (newValue !== storeValue) {
    updateStore({ field: newValue });
    // Manually trigger preview update
    triggerPreviewUpdate();
  }
}}

// In App.jsx:
const triggerPreviewUpdate = () => {
  previewRequestIdRef.current += 1;
  const currentRequestId = previewRequestIdRef.current;
  // ... fetch and update ...
};
```

**Pros:**
- Direct control over when YAML regenerates
- No dependency array issues

**Cons:**
- Couples step files to App.jsx
- More complex
- Requires passing trigger function down

**Likelihood of Success:** MEDIUM

---

### SOLUTION 5: Use useEffect in EACH Step File

**Approach:** Instead of centralized useEffect in App.jsx, each step watches its own state

**Code:**
```javascript
// In NetworkingV2Step.jsx:
useEffect(() => {
  if (showYamlDrawer) {
    triggerYamlUpdate();
  }
}, [networking.machineNetworkV4, networking.machineNetworkV6, /* ... */]);
```

**Pros:**
- Step-specific dependencies (easier to manage)
- Fires immediately when step state changes

**Cons:**
- Duplicate logic across files
- Each step needs to know about YAML generation
- More complex architecture

**Likelihood of Success:** MEDIUM

---

### SOLUTION 6: Debounce onBlur Instead of useEffect

**Approach:** Keep useEffect reactive, but debounce the state updates

**Code:**
```javascript
import { debounce } from 'lodash';

const debouncedUpdate = debounce((field, value) => {
  updateStore({ [field]: value });
}, 100); // Small debounce

onBlur={(e) => {
  const newValue = e.target.value.trim();
  debouncedUpdate('fieldName', newValue);
}}
```

**Pros:**
- Reduces rapid-fire updates
- useEffect fires after debounce completes

**Cons:**
- Still has delay
- Requires library
- onBlur defeats the purpose (already infrequent)

**Likelihood of Success:** LOW

---

### SOLUTION 7: Use Callback in setState

**Approach:** Pass callback to updateState to ensure it completes before continuing

**Code:**
```javascript
// Modify store.jsx:
updateState: (patch, callback) => {
  set((prev) => ({ state: deepMerge(prev.state, patch) }));
  if (callback) callback();
}

// In onBlur:
onBlur={(e) => {
  updateStore({ field: newValue }, () => {
    // State updated, force re-render or trigger YAML
  });
}}
```

**Pros:**
- Guarantees state update completes
- Can trigger follow-up actions

**Cons:**
- Zustand doesn't support callbacks natively
- Would need custom implementation
- Complex

**Likelihood of Success:** MEDIUM

---

### SOLUTION 8: Move YAML Generation to Backend on State Update

**Approach:** Backend regenerates YAML automatically when state changes

**Code:**
```javascript
// Backend watches state changes
app.post('/api/state/update', (req, res) => {
  updateState(req.body);
  const yaml = generateYaml(getState());
  res.json({ state: getState(), yaml });
});

// Frontend gets YAML with every state update
onBlur={(e) => {
  apiFetch('/api/state/update', { 
    method: 'POST', 
    body: { field: newValue } 
  }).then(({ yaml }) => {
    setPreviewFiles(yaml);
  });
}}
```

**Pros:**
- No dependency tracking needed
- Always in sync

**Cons:**
- Major architecture change
- More API calls
- Backend state management complexity

**Likelihood of Success:** LOW (too invasive)

---

### SOLUTION 9: useLayoutEffect Instead of useEffect

**Approach:** Use useLayoutEffect to fire synchronously before paint

**Code:**
```javascript
import { useLayoutEffect } from 'react';

useLayoutEffect(() => {
  // ... generate YAML ...
}, [dependencies]);
```

**Pros:**
- Fires synchronously before browser paint
- Might catch state updates faster

**Cons:**
- Can cause performance issues (blocks paint)
- Not recommended for data fetching
- Might not solve the issue

**Likelihood of Success:** LOW

---

### SOLUTION 10: Track Last Updated Field + Force Update

**Approach:** Track which field was last updated and ensure its value is in YAML

**Code:**
```javascript
const [lastUpdatedField, setLastUpdatedField] = useState(null);

onBlur={(e) => {
  updateStore({ field: newValue });
  setLastUpdatedField('field');
}}

useEffect(() => {
  // Generate YAML
  // If lastUpdatedField is set, verify it's in generated YAML
  if (lastUpdatedField) {
    // Force immediate update for that field
  }
}, [state, lastUpdatedField]);
```

**Pros:**
- Ensures last change is reflected
- Catches edge cases

**Cons:**
- Complex tracking
- Band-aid solution
- Doesn't fix root cause

**Likelihood of Success:** MEDIUM

---

## Investigation Steps

### Step 1: Identify Exact State Path
- [ ] Pick ONE field (e.g., machineNetworkV4)
- [ ] Trace updateNetworking → updateState → store update
- [ ] Check exact state path: `state.globalStrategy.networking.machineNetworkV4`
- [ ] Verify it's in useEffect dependency array

### Step 2: Add Console Logs
- [ ] Log when onBlur fires
- [ ] Log when updateState is called
- [ ] Log when useEffect fires
- [ ] Log request ID and timestamps
- [ ] Compare timing

### Step 3: Test with flushSync
- [ ] Add flushSync to ONE onBlur handler
- [ ] Test if that field updates immediately
- [ ] If yes → batching is the issue
- [ ] If no → deeper problem

### Step 4: Check Backend State Persistence
- [ ] Review backend code for debouncing
- [ ] Check if backend state lags behind frontend
- [ ] Test with backend logs

### Step 5: Audit Dependency Array
- [ ] List ALL fields in generated YAML
- [ ] Compare to useEffect dependencies
- [ ] Add any missing ones
- [ ] Test if updates work

---

## Next Actions

**IMMEDIATE:**
1. Deep dive into App.jsx useEffect dependencies
2. Test flushSync on ONE field
3. Add comprehensive logging
4. Compare timing of onBlur → state update → useEffect

**SYSTEMATIC:**
1. Fix most likely cause first (dependency array or batching)
2. Test thoroughly
3. Document result
4. Move to next cause if failed
5. Repeat until solved

---

## Success Criteria

- [ ] User edits field 1, exits → YAML updates IMMEDIATELY
- [ ] No lag between field change and preview update
- [ ] Works for ALL fields consistently
- [ ] No performance degradation
- [ ] No new bugs introduced

---

**Created:** 2026-05-12 23:00 UTC  
**Status:** Investigation in progress  
**Priority:** P0 - DO NOT SHIP WITHOUT FIX
