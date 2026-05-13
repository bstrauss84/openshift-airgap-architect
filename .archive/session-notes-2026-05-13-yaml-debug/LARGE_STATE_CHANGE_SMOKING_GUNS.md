# Large State Change - Smoking Guns (10+)

**Date:** 2026-05-12  
**Issue:** Switching from IPI to Agent-based shows "bare bones" agent-config.yaml initially  
**User Workaround:** Toggle hide/show YAML to get full content  

---

## The Smoking Guns

### Gun #1: buildAgentConfig Always Returns Valid YAML
**File:** `backend/src/generate.js` lines 836-880  
**Evidence:**
```javascript
const buildAgentConfig = (state) => {
  const sortedNodes = sortNodes(state.hostInventory?.nodes || []);
  const hosts = sortedNodes.map((node) => { /* ... */ });
  const agentConfig = {
    apiVersion: "v1beta1",
    kind: "AgentConfig",
    metadata: { name: state.blueprint?.clusterName || "agent-cluster" },
    rendezvousIP,
    hosts  // ← Can be empty array []
  };
  return header + yaml.dump(agentConfig, { lineWidth: 120 });
};
```

**Smoking gun:** buildAgentConfig NEVER returns null or empty string. It ALWAYS returns valid YAML, even with `hosts: []`.

---

### Gun #2: Empty Nodes Array Produces "Bare Bones" YAML
**Evidence:** Running buildAgentConfig with empty nodes:
```yaml
apiVersion: v1beta1
kind: AgentConfig
metadata:
  name: test-cluster
rendezvousIP: 192.168.1.10
hosts: []
```

**Smoking gun:** This matches user's description of "basic completely bare bones version". Not a skeleton, but valid YAML with no hosts.

---

### Gun #3: Skeleton Fallback Only Shows When agentContent is Falsy
**File:** `frontend/src/components/YamlDrawer.jsx` lines 238-244  
**Evidence:**
```javascript
const agentDisplay = agentContent ?
  obfuscateYaml(agentContent, showSensitive) :
  `apiVersion: v1beta1
kind: AgentConfig
metadata:
  name: ${installContent.match(/name:\s*(\S+)/)?.[1] || 'cluster-name'}
# Loading...`;
```

**Smoking gun:** Skeleton only shows when agentContent is empty/null/undefined. But buildAgentConfig returns a non-empty string (the "bare bones" YAML), so user sees the generated YAML, not the skeleton.

---

### Gun #4: IPI Doesn't Use Host Inventory
**File:** `backend/src/generate.js` line 2260-2262  
**Evidence:**
```javascript
const wantsAgentConfig =
  state.methodology?.method === "Agent-Based Installer" &&
  (state.blueprint?.platform === "Bare Metal" || state.blueprint?.platform === "VMware vSphere");
```

**Smoking gun:** IPI doesn't need agent-config or host inventory. So when user is on IPI, `state.hostInventory` is either undefined or has empty `nodes: []`.

---

### Gun #5: Methodology Change Only Updates Methodology Field
**File:** `frontend/src/steps/MethodologyStep.jsx` line 96  
**Evidence:**
```javascript
onClick={() => updateState({ methodology: { method: option.value } })}
```

**Smoking gun:** When user clicks "Agent-Based Installer", ONLY the methodology field updates. No code populates hostInventory or creates default nodes.

---

### Gun #6: Shallow Merge Doesn't Populate Missing Fields
**File:** `frontend/src/store.jsx` line 69  
**Evidence:**
```javascript
const updateState = (patch) => setState((prev) => ({ ...prev, ...patch }));
```

**Smoking gun:** updateState does shallow merge. If `state.hostInventory` was undefined on IPI, it stays undefined after methodology change (unless explicitly set in the patch).

---

### Gun #7: No Auto-Population of Default Hosts
**Search:** Checked HostInventoryStep.jsx for useEffects that might create default nodes  
**Evidence:** Lines 117-167 only SYNC local state with existing nodes, don't CREATE new nodes  

**Smoking gun:** There's no code that automatically creates default host entries when switching to Agent-Based methodology.

---

### Gun #8: Backend Returns "Bare Bones" on First Call
**Flow:**
1. User on IPI → `state.hostInventory.nodes = []` (or undefined)
2. User clicks "Agent-Based Installer"
3. `updateState({ methodology: { method: 'Agent-Based Installer' } })`
4. useEffect fires → POST /api/generate with current state
5. Backend receives state with `hostInventory.nodes = []`
6. buildAgentConfig generates YAML with `hosts: []`
7. Returns valid but "bare bones" YAML
8. Frontend displays it

**Smoking gun:** First API call happens BEFORE user has filled in Host Inventory, so nodes is empty.

---

### Gun #9: Toggle Hide/Show Triggers New API Call
**File:** `frontend/src/App.jsx` line 587  
**Evidence:** useEffect depends on showPreview:
```javascript
useEffect(() => {
  if (!showPreview || !previewStepId) return;
  // ... generate YAML
}, [showPreview, previewStepId, /* ... */]);
```

**Smoking gun:** When user toggles hide then show, showPreview changes from false→true, triggering new API call.

---

### Gun #10: Second Call Has Different State
**Scenario 1:** User filled in Host Inventory between first and second call
- First call: `nodes = []`
- User clicks Host Inventory tab, adds hosts
- User toggles hide/show YAML
- Second call: `nodes = [...]` (populated)
- Full agent-config returned ✅

**Scenario 2:** React batching settled between first and second call
- First call: Partial state (methodology changed, other fields still updating)
- React finishes batching all state updates
- User toggles hide/show YAML
- Second call: Complete state
- Full agent-config returned ✅

**Smoking gun:** Second call sees different state than first call.

---

### Gun #11: Same Issue Likely Happens on Import
**User Quote:** "Importing JSON/run file might also show bare-bones version initially"  

**Flow:**
1. Import handler reads file
2. Calls `updateState(importedData)` (potentially multiple times)
3. Each updateState triggers useEffect
4. AbortController cancels all but last request
5. Last request might fire while state still settling
6. Returns partial YAML
7. Toggle triggers new call with full settled state

**Smoking gun:** Same root cause - API call fired while state is transitional.

---

### Gun #12: No Code to Detect "Large State Change"
**Search:** Checked for methodology change detection  
**Evidence:** No code tracks when methodology changes or delays YAML generation  

**Smoking gun:** Frontend doesn't distinguish between "small edit" (one field) and "large change" (methodology switch, import). Both trigger useEffect immediately.

---

### Gun #13: useEffect Fires on EVERY State Change
**File:** `frontend/src/App.jsx` lines 608-626  
**Evidence:** Dependencies include 10+ top-level objects:
```javascript
}, [
  showPreview,
  previewStepId,
  state.blueprint,
  state.methodology,
  state.globalStrategy,
  // ... 6 more
]);
```

**Smoking gun:** ANY change to methodology object triggers useEffect. No delay, no batching awareness.

---

### Gun #14: buildPreviewFiles Doesn't Validate Required Fields
**File:** `backend/src/generate.js` lines 2252-2274  
**Evidence:**
```javascript
const buildPreviewFiles = (state) => {
  // ... no validation that hostInventory.nodes exists
  const agentConfig = wantsAgentConfig ? buildAgentConfig(state) : null;
  return {
    "install-config.yaml": installConfig,
    "agent-config.yaml": agentConfig,  // ← Can be "bare bones"
    // ...
  };
};
```

**Smoking gun:** Backend doesn't check if required fields are populated before generating. Just generates whatever it can with available state.

---

## Root Cause Analysis

**Primary Cause:** API call fired immediately on methodology change, BEFORE hostInventory is populated.

**Why "bare bones" appears:**
1. User on IPI → no host inventory needed → `nodes = []`
2. Switch to Agent-Based → methodology updates
3. useEffect fires → API call with current state
4. Current state has `nodes = []` (not populated yet)
5. Backend generates valid YAML with empty hosts array
6. Frontend shows "bare bones" agent-config

**Why toggle hide/show fixes it:**
1. User either:
   - Filled in Host Inventory between first call and toggle, OR
   - State settled from batched updates
2. Toggle triggers new API call
3. New call has `nodes = [...]` (populated)
4. Backend generates full agent-config
5. Frontend shows full content ✅

---

## Not a Bug, But Surprising Behavior

**Technically:** This is working as designed
- Backend correctly generates YAML from provided state
- If state has no hosts, YAML correctly shows no hosts
- Not an error, just incomplete data

**User Experience:** Feels like a bug
- User expects switching to Agent-Based to show "full" agent-config
- But "full" requires host inventory data
- Which isn't populated until user fills in Host Inventory step
- Timing issue creates confusion

---

## Solutions (In Order of Preference)

### Solution 1: Small Delay for Methodology Changes (SIMPLE)
Add 100-150ms delay when methodology changes to let React settle state.

**Pros:**
- Simple (10 lines of code)
- Handles both methodology switch and import
- Low risk

**Cons:**
- Slight delay (user might not notice)
- Doesn't fix if user truly hasn't filled in hosts yet

---

### Solution 2: Show Warning When Hosts Empty
Detect when agent-config has empty hosts, show banner: "Add hosts in Host Inventory step to see full configuration"

**Pros:**
- Educates user
- No timing hacks
- Accurate to reality

**Cons:**
- Doesn't "fix" the behavior, just explains it
- User still has to toggle or fill in hosts

---

### Solution 3: Auto-Create Default Hosts on Methodology Change
When switching to Agent-Based, auto-populate 3 default master nodes + 2 workers.

**Pros:**
- "Full" agent-config appears immediately
- Better UX for new users

**Cons:**
- Complex (need to create realistic default nodes)
- User might not want those defaults
- Could be confusing (where did these hosts come from?)

---

### Solution 4: Don't Generate Agent-Config Until Hosts Exist
Modify buildPreviewFiles to return null for agent-config if nodes array is empty.

**Pros:**
- Clear signal that data is missing
- Skeleton fallback shows "Loading..."

**Cons:**
- User sees skeleton instead of bare bones (same confusion)
- Doesn't actually fix the problem

---

## Recommended Fix: Solution 1 (Delay)

**Implementation:**
```javascript
// In App.jsx useEffect
const prevMethodologyRef = useRef(state?.methodology?.method);

useEffect(() => {
  if (!showPreview || !previewStepId) return;
  
  const currentMethod = state?.methodology?.method;
  const methodologyChanged = currentMethod !== prevMethodologyRef.current;
  prevMethodologyRef.current = currentMethod;
  
  const delay = methodologyChanged ? 150 : 0;  // 150ms for methodology changes
  
  const timer = setTimeout(() => {
    const controller = new AbortController();
    apiFetch("/api/generate", {
      method: "POST",
      body: JSON.stringify({ state }),
      signal: controller.signal
    })
      .then((data) => {
        setPreviewFiles(data.files || {});
      })
      .catch((error) => {
        if (error.name !== "AbortError") console.error(error);
      });
    return () => controller.abort();
  }, delay);
  
  return () => clearTimeout(timer);
}, [/* dependencies */]);
```

**Why this works:**
- Methodology changes are rare (user clicks radio button)
- 150ms is imperceptible but enough for React to batch updates
- Regular field edits have no delay (0ms)
- Low risk, easy to test, easy to revert

---

**Created:** 2026-05-12  
**Status:** Ready to implement  
**Estimated fix time:** 5 minutes  
**Confidence:** HIGH (simple, low-risk fix)
