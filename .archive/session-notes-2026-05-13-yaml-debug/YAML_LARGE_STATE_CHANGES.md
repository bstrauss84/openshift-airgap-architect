# YAML Preview - Large State Changes Issue

**Date:** 2026-05-13 00:10 UTC  
**Status:** INVESTIGATING  
**Priority:** P2 (Workaround exists: toggle hide/show)

---

## Problem Statement

**User Report:**
> "if I select ipi, then do show yaml, then change to agent based installer, the agent-config loads the like basic completely bare bones version of the yaml. but if I toggle hide then show again, it populates with the current up-to-date version"

**Behavior:**
1. Start with IPI methodology
2. Show YAML (shows install-config.yaml)
3. Change to Agent-based methodology
4. YAML drawer switches to split view
5. install-config.yaml shows correctly ✓
6. agent-config.yaml shows SKELETON (bare bones) ❌
7. Toggle hide/show YAML
8. agent-config.yaml now shows FULL content ✓

**Similar issue:**
- Importing JSON/run file might also show bare-bones version initially
- After hide/show toggle, shows full content
- Affects LARGE state changes (methodology switch, imports)

---

## What's the Skeleton YAML?

**File:** `frontend/src/components/YamlDrawer.jsx` lines 236-245

```javascript
const agentDisplay = agentContent ?
  obfuscateYaml(agentContent, showSensitive) :
  `apiVersion: v1beta1
kind: AgentConfig
metadata:
  name: ${installContent.match(/name:\s*(\S+)/)?.[1] || 'cluster-name'}
# Loading...`;
```

**This skeleton is shown when:**
- `previewFiles['agent-config.yaml']` is empty or missing
- Backend didn't return agent-config in response
- OR backend returned empty agent-config

---

## Potential Root Causes

### Hypothesis 1: React Batching Partial State

**Scenario:**
1. User clicks "Agent-based" radio button
2. onChange fires: `updateState({ methodology: { method: 'agent-based' } })`
3. Other code might also update state (reset fields, set defaults)
4. React batches all updates into one render
5. useEffect fires while React is still batching
6. State sent to backend might be in transitional state
7. Backend receives: `methodology: 'agent-based'` but missing agent-specific fields
8. Backend can't generate full agent-config without required fields
9. Returns skeleton or empty agent-config

**Likelihood:** HIGH

---

### Hypothesis 2: Backend Generate Timing

**Scenario:**
1. State changes to agent-based
2. POST /api/generate called immediately
3. Backend receives state and tries to generate
4. Backend checks: "is this agent-based? yes"
5. Backend tries to build agent-config
6. But certain required fields (hosts, networking, etc.) haven't been set yet
7. Backend returns partial/skeleton agent-config
8. User toggles hide/show
9. By now, all default values have been set
10. Backend generates full agent-config

**Need to check:** What does buildAgentConfig require?

**Likelihood:** HIGH

---

### Hypothesis 3: Multiple Rapid useEffect Fires

**Scenario:**
1. Methodology changes → useEffect fires → API call 1 starts
2. Other state changes happen (batched)
3. useEffect fires AGAIN → API call 2 starts
4. AbortController cancels API call 1
5. API call 2 completes
6. But API call 2 was started before all state settled
7. Still has partial state

**Likelihood:** MEDIUM

---

### Hypothesis 4: Import Sets State in Chunks

**For import JSON/run issue:**

**Scenario:**
1. User imports JSON file
2. Import handler sets state in multiple updateState calls
3. Each updateState triggers useEffect
4. First few API calls are aborted (AbortController)
5. One of the middle calls completes with partial state
6. Final state updates happen after API call
7. Toggle hide/show triggers fresh generation with full state

**Likelihood:** HIGH for import, N/A for methodology switch

---

### Hypothesis 5: Frontend Cache/Stale previewFiles

**Scenario:**
1. Switch to agent-based
2. useEffect fires, API call starts
3. API call completes, returns full agent-config
4. But previewFiles state update happens AFTER YamlDrawer re-renders?
5. YamlDrawer sees old previewFiles (no agent-config)
6. Shows skeleton
7. Toggle triggers re-render with updated previewFiles

**Likelihood:** LOW (state updates should be synchronous)

---

## Investigation Steps

### Step 1: Check Backend Response
Add logging to see what backend actually returns:

```javascript
// In App.jsx useEffect
apiFetch("/api/generate", {
  method: "POST",
  body: JSON.stringify({ state }),
  signal: controller.signal
})
  .then((data) => {
    console.log('[YAML] Backend response:', data);
    console.log('[YAML] agent-config present?', !!data.files?.['agent-config.yaml']);
    console.log('[YAML] agent-config length:', data.files?.['agent-config.yaml']?.length);
    // ... rest of code
  });
```

**What to look for:**
- Does backend return agent-config.yaml at all?
- Is agent-config.yaml empty/short (skeleton) or full?
- Does second call (after toggle) return different content?

---

### Step 2: Check State Sent to Backend
Log the state being sent:

```javascript
const stateToSend = state;
console.log('[YAML] Sending state:', {
  methodology: stateToSend?.methodology?.method,
  hasHosts: !!stateToSend?.hostInventory?.nodes?.length,
  hasNetworking: !!stateToSend?.globalStrategy?.networking,
  // ... other relevant fields
});

apiFetch("/api/generate", {
  method: "POST",
  body: JSON.stringify({ state: stateToSend }),
  signal: controller.signal
})
```

**What to look for:**
- Is state fully populated when sent?
- Are agent-specific fields present?
- Does second call (after toggle) send different state?

---

### Step 3: Check Backend Generate Logic
Review `backend/src/generate.js` buildAgentConfig function:

**Questions:**
- What fields does buildAgentConfig require?
- Does it return empty/skeleton if fields missing?
- Does it throw errors or silently fail?

---

### Step 4: Check Methodology Change Handling
Look for code that runs when methodology changes:

```bash
grep -rn "methodology.*agent\|agent.*methodology" frontend/src/
```

**Look for:**
- Does changing to agent-based trigger other state updates?
- Are those updates batched or sequential?
- Do they complete before useEffect fires?

---

## Potential Solutions

### Solution 1: Debounce Large State Changes (SIMPLE)

**Add a small delay for methodology changes:**

```javascript
// In App.jsx useEffect
useEffect(() => {
  if (!showPreview || !previewStepId) return;
  
  // Special handling for large state changes
  const isLargeChange = /* detect methodology change or import */;
  const delay = isLargeChange ? 100 : 0;  // 100ms for large changes
  
  const timer = setTimeout(() => {
    // ... existing generate logic
  }, delay);
  
  return () => clearTimeout(timer);
}, [dependencies]);
```

**Pros:**
- Simple
- Gives React time to settle state
- Allows batched updates to complete

**Cons:**
- Adds delay (100ms)
- Hacky workaround
- Doesn't fix root cause

**Likelihood of Success:** HIGH

**STATUS:** ✅ IMPLEMENTED 2026-05-12  
**File:** `frontend/src/App.jsx` lines 197-198, 577-629  
**Changes:**
- Added `prevMethodologyRef` to track methodology changes
- Detect methodology change in useEffect
- Apply 150ms delay for methodology changes, 0ms for regular edits
- Properly cleanup timer and AbortController

---

### Solution 2: Track Methodology Changes Explicitly

**Add a ref to track when methodology is changing:**

```javascript
const methodologyChangingRef = useRef(false);
const prevMethodologyRef = useRef(state?.methodology?.method);

useEffect(() => {
  const currentMethod = state?.methodology?.method;
  const prevMethod = prevMethodologyRef.current;
  
  if (currentMethod !== prevMethod) {
    methodologyChangingRef.current = true;
    prevMethodologyRef.current = currentMethod;
    
    // Wait for state to settle
    setTimeout(() => {
      methodologyChangingRef.current = false;
    }, 50);
  }
}, [state?.methodology?.method]);

// In generate useEffect
useEffect(() => {
  if (methodologyChangingRef.current) {
    // Skip generation while methodology is changing
    return;
  }
  
  // ... existing generate logic
}, [dependencies]);
```

**Pros:**
- Explicit handling of methodology changes
- Can extend to other large changes (imports)

**Cons:**
- Complex
- More state to track
- Might miss legitimate updates

**Likelihood of Success:** MEDIUM

---

### Solution 3: Use flushSync for Large Changes

**Force React to flush updates before generating:**

```javascript
import { flushSync } from 'react-dom';

// In methodology change handler
const handleMethodologyChange = (newMethod) => {
  flushSync(() => {
    updateState({ methodology: { method: newMethod } });
    // Update other related fields
  });
  // Now state is guaranteed to be updated before next render
};
```

**Pros:**
- Forces synchronous state updates
- Ensures state is complete before useEffect

**Cons:**
- Bypasses React optimizations
- Requires changing all methodology change handlers
- Not recommended React pattern

**Likelihood of Success:** MEDIUM

---

### Solution 4: Check Backend for Required Fields

**Modify backend to return error/flag if fields missing:**

```javascript
// In backend generate.js
function buildAgentConfig(state) {
  const required = ['hostInventory.nodes', 'globalStrategy.networking', /* ... */];
  const missing = required.filter(field => !getNestedField(state, field));
  
  if (missing.length > 0) {
    return {
      yaml: skeletonYaml,
      incomplete: true,
      missingFields: missing
    };
  }
  
  // Build full agent-config
}
```

**Frontend handles incomplete flag:**

```javascript
.then((data) => {
  if (data.incomplete) {
    console.warn('[YAML] Incomplete agent-config, missing:', data.missingFields);
    // Retry after delay?
    // Or show warning to user?
  }
  setPreviewFiles(data.files);
});
```

**Pros:**
- Detects root cause
- Can inform user or retry
- Backend becomes more robust

**Cons:**
- Requires backend changes
- More complex
- Still doesn't prevent the issue

**Likelihood of Success:** LOW (doesn't fix, just detects)

---

### Solution 5: Force Re-generate After Import

**For import issue specifically:**

```javascript
// In import handler
const handleImport = async (file) => {
  const data = await readFile(file);
  
  // Set state
  updateState(data);
  
  // Force YAML regeneration after state settles
  setTimeout(() => {
    triggerYamlRegeneration();
  }, 100);
};
```

**Pros:**
- Specific fix for import issue
- Simple

**Cons:**
- Doesn't fix methodology switch issue
- Band-aid solution

**Likelihood of Success:** MEDIUM for imports only

---

## Recommended Approach

**STEP 1:** Add logging to confirm hypothesis
- Log state sent to backend
- Log backend response
- Confirm agent-config is missing vs empty

**STEP 2:** If confirmed, implement Solution 1 (debounce)
- Simple 100ms delay for large changes
- Detects: methodology change, import action
- Lowest risk, highest success rate

**STEP 3:** If Solution 1 doesn't work, check backend
- Review buildAgentConfig requirements
- See if backend is returning partial results
- Fix backend to handle transitional state

---

## Next Actions

1. Add logging to App.jsx useEffect
2. Test methodology switch (IPI → Agent)
3. Check console logs for what's sent/received
4. Confirm hypothesis
5. Implement appropriate solution
6. Test thoroughly
7. **Don't claim fix until user confirms**

---

**Created:** 2026-05-13 00:10 UTC  
**Status:** Ready to investigate  
**User workaround:** Toggle hide/show YAML drawer
