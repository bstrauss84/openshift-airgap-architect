# Scenario Summary Live-Update Design (DOC-058)

**Date:** 2026-05-11  
**Status:** Design Phase - Awaiting User Approval  
**Objective:** Enhance scenario summary dropdown to dynamically reflect user's configuration as they progress through the wizard

---

## Executive Summary

Transform the static scenario summary dropdown into a live-updating "executive dashboard" that grows richer as the user confirms each wizard tab, similar to the Field Guide's executive summary and documentation sources sections.

**Key Principle:** Only reflect information from tabs the user has explicitly confirmed (clicked Proceed) AND that are not flagged "needs review."

---

## Current State Analysis

### Scenario Summary Dropdown (`ScenarioHeaderPanel.jsx`)

**Location:** `/frontend/src/components/ScenarioHeaderPanel.jsx`

**Current Content:**
- Scenario name (platform + method)
- Target OCP version
- "This will generate" list (install-config.yaml, agent-config.yaml, imageset-config.yaml)
- Documentation links (3 static links from docs-index based on scenario)

**Current Behavior:**
- **Static** - only updates when platform/method/version changes
- **No configuration awareness** - doesn't know about FIPS, proxy, node counts, operators, etc.
- **Always shows same 3 docs** for a given scenario regardless of user's specific choices

**Shown On:**
- All wizard tabs (part of segmented flow header)

---

## Field Guide Analysis

### Executive Summary Section

The Field Guide includes configuration-aware summary at the top:
- Platform / Methodology / Connectivity / OCP Version
- Cluster identity (name.baseDomain)
- Key configuration choices (FIPS, proxy, NTP, dual-stack, etc.)
- Node counts and roles
- Operator selection summary

### Documentation Sources Section

The Field Guide ends with "## Official Documentation Sources":
- Merges docs from docs-index with compartment docRefs
- Deduplicated by URL
- Only includes docs relevant to user's actual configuration
- Validated vs non-validated docs

**Source:** `backend/src/fieldGuide/assembler.js` - `mergeDocLinks()` function

---

## Design: Live-Updating Scenario Summary

### Update Trigger Mechanism

**State Dependencies:**
Track which tabs are "confirmed" and "clean" (not needing review):

```javascript
const isTabConfirmed = (tabId) => {
  // Tab is confirmed if:
  // 1. User has visited it (state.ui?.visitedSteps?.[tabId])
  // 2. Tab is not flagged for review (state.reviewFlags?.[tabId] !== true)
  // 3. Validation passes (no blocking errors for that step)
  
  return (
    state.ui?.visitedSteps?.[tabId] &&
    !state.reviewFlags?.[tabId] &&
    validation[tabId]?.errors?.length === 0
  );
};
```

**Tabs to Track:**
1. blueprint
2. methodology (Note: may be implicit/auto-selected)
3. identity-access
4. networking
5. connectivity-mirroring
6. trust-proxy
7. platform-specifics (conditional - only for certain scenarios)
8. host-inventory
9. operators

**Update Timing:**
- Component re-renders when relevant state changes
- useMemo to avoid expensive recalculations
- Only include data from confirmed tabs

---

### Content Structure Design

**Format:** Organized as definition list (`<dl>`) like current implementation, but with dynamic sections

```markdown
Scenario: Bare Metal, Agent-Based Installer
Target OCP version: 4.21.14

## Configuration Summary
[Only appears if at least one configuration tab is confirmed]

### Identity & Security
- FIPS mode: Enabled
- SSH key: Configured
- Pull secret source: Red Hat + Mirror registry

### Networking
- Topology: Dual-stack (IPv4 + IPv6)
- Cluster network: 10.128.0.0/14
- Service network: 172.30.0.0/16
- API VIP: 192.168.1.100
- Ingress VIP: 192.168.1.101

### Connectivity & Mirroring
- NTP servers: 3 configured
- Mirror registry: registry.corp.local:5000 (authenticated)

### Trust & Proxy
- Corporate proxy: Enabled (HTTP + HTTPS)
- Trust bundle policy: Always
- CA bundles: 2 configured (mirror + proxy)

### Platform Configuration
- vCenter: vcenter.corp.local
- Datacenter: DC1
- Cluster: Production
- Datastore: vsanDatastore

### Hosts & Inventory
- Total nodes: 5 (3 control plane, 2 workers)

### Operators
- 12 operators selected
- Catalogs: Red Hat (8), Certified (3), Community (1)

## Generated Artifacts
- install-config.yaml
- agent-config.yaml
- imageset-config.yaml

## Documentation Sources
[Dynamic list based on confirmed configuration]
- Installation configuration parameters for the Agent-based Installer
- Configuring dual-stack networking
- Enabling FIPS mode
- Configuring corporate proxy for disconnected clusters
- Installing a cluster on disconnected infrastructure
- Installing an on-premise cluster with the Agent-based Installer
- Mirroring images for a disconnected installation
```

---

### Per-Tab Content Mapping

#### Blueprint (always shown - baseline)
```javascript
{
  scenario: `${platform}, ${method}`,
  ocpVersion: state.version?.selectedVersion || state.release?.patchVersion
}
```

#### Methodology
```javascript
// If confirmed:
{
  connectivity: state.methodology?.connectivity || "Connected" // or "Disconnected"
}
```

#### Identity & Access
```javascript
// If confirmed:
{
  fipsMode: state.credentials?.fipsMode ? "Enabled" : "Disabled",
  sshKey: state.credentials?.sshPublicKey ? "Configured" : "Not configured",
  pullSecretSource: getPullSecretSource(state) // "Red Hat" / "Mirror registry" / "Both"
  // NEVER include actual secrets
}
```

#### Networking
```javascript
// If confirmed:
{
  topology: getNetworkTopology(state), // "Single-stack IPv4" / "Dual-stack" etc
  clusterNetwork: state.networking?.clusterNetwork,
  serviceNetwork: state.networking?.serviceNetwork,
  machineNetwork: state.networking?.machineNetwork,
  apiVip: state.networking?.apiVip,
  ingressVip: state.networking?.ingressVip
  // Include relevant IPs/CIDRs - these are not sensitive
}
```

#### Connectivity & Mirroring
```javascript
// If confirmed:
{
  ntpServers: state.connectivity?.ntpServers?.length > 0 
    ? `${state.connectivity.ntpServers.length} configured` 
    : "Not configured",
  mirrorRegistry: state.mirroring?.useMirrorRegistry 
    ? `${state.mirroring.registryFqdn} (${state.credentials?.mirrorRegistryUnauthenticated ? 'anonymous' : 'authenticated'})` 
    : "Not used",
  // NEVER include mirror registry credentials
}
```

#### Trust & Proxy
```javascript
// If confirmed:
{
  proxyEnabled: state.strategy?.proxyEnabled,
  proxyType: getProxyType(state), // "HTTP" / "HTTPS" / "HTTP + HTTPS"
  trustBundlePolicy: state.trust?.additionalTrustBundlePolicy,
  caBundles: getCaBundleCounts(state) // "2 configured (mirror + proxy)" - NO cert contents
  // NEVER include actual certificates
}
```

#### Platform Specifics
```javascript
// If confirmed (platform-dependent):
// vSphere:
{
  vCenter: state.platformSpecifics?.vcenter,
  datacenter: state.platformSpecifics?.datacenter,
  cluster: state.platformSpecifics?.cluster,
  datastore: state.platformSpecifics?.datastore
}
// AWS:
{
  region: state.platformSpecifics?.region,
  instanceType: state.platformSpecifics?.instanceType
}
// etc. per platform
```

#### Host Inventory
```javascript
// If confirmed:
{
  nodeCount: {
    total: inventory.nodes?.length,
    controlPlane: inventory.nodes?.filter(n => n.role === 'master').length,
    workers: inventory.nodes?.filter(n => n.role === 'worker').length
  }
}
```

#### Operators
```javascript
// If confirmed:
{
  operatorCount: state.operators?.selected?.length,
  catalogBreakdown: getCatalogBreakdown(state.operators?.selected)
  // Example: "Red Hat (8), Certified (3), Community (1)"
}
```

---

### Security Exclusions (Enforced)

**NEVER include in summary:**
- ❌ Pull secrets (JSON or any form)
- ❌ Credentials (usernames, passwords, auth tokens)
- ❌ SSH private keys
- ❌ CA certificate contents (PEM blocks)
- ❌ vCenter passwords
- ❌ Mirror registry credentials
- ❌ Proxy credentials
- ❌ Any authentication data

**OK to include:**
- ✅ FQDNs (mirror registry, vCenter, proxy hostnames)
- ✅ IP addresses (VIPs, CIDRs, node IPs)
- ✅ Counts (nodes, operators, certificates, NTP servers)
- ✅ Boolean flags (FIPS on/off, proxy enabled, etc.)
- ✅ Non-sensitive configuration choices
- ✅ Cluster name, base domain

---

### Documentation Sources Algorithm

**Goal:** Dynamically build doc list based on what's actually configured

**Logic:**
```javascript
const buildDocumentationSources = (state, confirmedTabs, docsIndex) => {
  const docs = [];
  const scenarioId = getScenarioId(state.blueprint?.platform, state.methodology?.method);
  
  // Base scenario docs (always include)
  const scenarioDocs = docsIndex?.scenarios?.[scenarioId]?.docs || [];
  docs.push(...scenarioDocs);
  
  // Conditional docs based on confirmed configuration:
  
  if (confirmedTabs.includes('identity-access')) {
    if (state.credentials?.fipsMode) {
      docs.push({ title: "Enabling FIPS mode", url: "..." });
    }
  }
  
  if (confirmedTabs.includes('networking')) {
    if (isDualStack(state.networking)) {
      docs.push({ title: "Configuring dual-stack networking", url: "..." });
    }
  }
  
  if (confirmedTabs.includes('connectivity-mirroring')) {
    if (state.mirroring?.useMirrorRegistry) {
      docs.push({ title: "Mirroring images for a disconnected installation", url: "..." });
    }
  }
  
  if (confirmedTabs.includes('trust-proxy')) {
    if (state.strategy?.proxyEnabled) {
      docs.push({ title: "Configuring corporate proxy for disconnected clusters", url: "..." });
    }
  }
  
  if (confirmedTabs.includes('operators')) {
    if (state.operators?.selected?.length > 0) {
      docs.push({ title: "Installing Operators in disconnected environments", url: "..." });
    }
  }
  
  // Deduplicate by URL
  return deduplicateByUrl(docs);
};
```

**Doc Mapping Rules:**
- FIPS enabled → "Enabling FIPS mode"
- Dual-stack networking → "Configuring dual-stack networking"
- Mirror registry → "Mirroring images for a disconnected installation"
- Proxy enabled → "Configuring corporate proxy"
- Operators selected → "Installing Operators in disconnected environments"
- NTP configured → "Configuring NTP servers"
- Additional trust bundle → "Configuring additional trust bundles"

---

## Implementation Plan

### Phase 1: State Tracking Enhancement

**Files to modify:**
- `frontend/src/store.jsx` - add helper to check tab confirmation status
- `frontend/src/components/ScenarioHeaderPanel.jsx` - enhance to consume confirmation state

**New helper function:**
```javascript
export const getConfirmedTabs = (state) => {
  const confirmed = [];
  const tabs = [
    'blueprint', 'methodology', 'identity-access', 'networking',
    'connectivity-mirroring', 'trust-proxy', 'platform-specifics',
    'host-inventory', 'operators'
  ];
  
  tabs.forEach(tabId => {
    if (isTabConfirmed(state, tabId)) {
      confirmed.push(tabId);
    }
  });
  
  return confirmed;
};
```

### Phase 2: Content Builders

**New utility file:** `frontend/src/scenarioSummaryBuilders.js`

Functions to create:
- `buildIdentitySummary(state)`
- `buildNetworkingSummary(state)`
- `buildConnectivitySummary(state)`
- `buildTrustProxySummary(state)`
- `buildPlatformSummary(state)`
- `buildHostInventorySummary(state)`
- `buildOperatorsSummary(state)`
- `buildDocumentationSources(state, confirmedTabs, docsIndex)`

Each builder returns JSX or data structure for rendering.

### Phase 3: ScenarioHeaderPanel Enhancement

**Modify:** `frontend/src/components/ScenarioHeaderPanel.jsx`

```javascript
export default function ScenarioHeaderPanel({ state }) {
  const [expanded, setExpanded] = useState(false);
  const confirmedTabs = useMemo(() => getConfirmedTabs(state), [state]);
  
  // Build dynamic sections
  const identitySummary = useMemo(() => 
    confirmedTabs.includes('identity-access') 
      ? buildIdentitySummary(state) 
      : null,
    [state, confirmedTabs]
  );
  
  // ... similar for other sections
  
  const documentationSources = useMemo(() =>
    buildDocumentationSources(state, confirmedTabs, docsIndex),
    [state, confirmedTabs]
  );
  
  return (
    <div className="card scenario-header-panel">
      {/* Collapsible header */}
      {expanded ? (
        <div className="scenario-summary-content">
          {/* Scenario + Version (always shown) */}
          {/* Configuration Summary (dynamic sections) */}
          {identitySummary}
          {networkingSummary}
          {/* ... */}
          {/* Generated Artifacts */}
          {/* Documentation Sources */}
        </div>
      ) : null}
    </div>
  );
}
```

### Phase 4: Styling

**CSS requirements:**
- Efficient vertical space usage
- Section headers clear but not overwhelming
- Sub-items indented/bulleted appropriately
- Documentation links distinct and clickable
- Responsive (collapse some details on narrow screens)

### Phase 5: Testing

**Test scenarios:**
1. Empty wizard → minimal summary (scenario + version only)
2. Confirm Blueprint only → still minimal
3. Confirm through Identity → see Identity section appear
4. Confirm through Networking → see both sections
5. Full wizard confirmed → see complete summary
6. Change value on confirmed tab → summary updates
7. Tab flagged "needs review" → that section disappears from summary
8. Re-confirm tab → section reappears with updated values

---

## Risk Assessment

**Low Risk:**
- Pure presentation logic
- No data mutation
- No API calls
- State is read-only

**Medium Risk:**
- Performance - useMemo prevents re-renders but need to test with large state
- State dependency tracking - must track all relevant fields

**Mitigation:**
- Use useMemo aggressively
- Keep builders pure functions
- Test with realistic state size

---

## Example Mock-ups

### Minimal (Blueprint + Methodology confirmed)

```
▶ Scenario summary                                              Expand

  Scenario: Bare Metal, Agent-Based Installer
  Target OCP version: 4.21.14
  
  This will generate:
  • install-config.yaml
  • agent-config.yaml
  • imageset-config.yaml (if mirroring)
  
  Documentation:
  • Installation configuration parameters for the Agent-based Installer
  • Installing a cluster on disconnected infrastructure
  • Installing an on-premise cluster with the Agent-based Installer
```

### Partial (through Networking confirmed)

```
▼ Scenario summary                                            Collapse

  Scenario: Bare Metal, Agent-Based Installer
  Target OCP version: 4.21.14
  
  Configuration Summary
  
  Identity & Security
  • FIPS mode: Enabled
  • SSH key: Configured
  • Pull secret source: Red Hat
  
  Networking
  • Topology: Dual-stack (IPv4 + IPv6)
  • Cluster network: 10.128.0.0/14
  • Service network: 172.30.0.0/16
  • API VIP: 192.168.1.100
  • Ingress VIP: 192.168.1.101
  
  This will generate:
  • install-config.yaml
  • agent-config.yaml
  • imageset-config.yaml (if mirroring)
  
  Documentation:
  • Installation configuration parameters for the Agent-based Installer
  • Enabling FIPS mode
  • Configuring dual-stack networking
  • Installing a cluster on disconnected infrastructure
  • Installing an on-premise cluster with the Agent-based Installer
```

### Complete (all tabs confirmed)

```
▼ Scenario summary                                            Collapse

  Scenario: Bare Metal, Agent-Based Installer
  Target OCP version: 4.21.14
  
  Configuration Summary
  
  Identity & Security
  • FIPS mode: Enabled
  • SSH key: Configured
  • Pull secret source: Red Hat + Mirror registry
  
  Networking
  • Topology: Dual-stack (IPv4 + IPv6)
  • Cluster network: 10.128.0.0/14
  • Service network: 172.30.0.0/16
  • Machine network: 192.168.1.0/24
  • API VIP: 192.168.1.100
  • Ingress VIP: 192.168.1.101
  
  Connectivity & Mirroring
  • NTP servers: 3 configured
  • Mirror registry: registry.corp.local:5000 (authenticated)
  
  Trust & Proxy
  • Corporate proxy: Enabled (HTTP + HTTPS)
  • Trust bundle policy: Always
  • CA bundles: 2 configured (mirror + proxy)
  
  Hosts & Inventory
  • Total nodes: 5 (3 control plane, 2 workers)
  
  Operators
  • 12 operators selected
  • Catalogs: Red Hat (8), Certified (3), Community (1)
  
  This will generate:
  • install-config.yaml
  • agent-config.yaml
  • imageset-config.yaml
  
  Documentation:
  • Installation configuration parameters for the Agent-based Installer
  • Enabling FIPS mode
  • Configuring dual-stack networking
  • Configuring NTP servers for disconnected clusters
  • Configuring corporate proxy for disconnected clusters
  • Configuring additional trust bundles
  • Mirroring images for a disconnected installation
  • Installing Operators in disconnected environments
  • Installing a cluster on disconnected infrastructure
  • Installing an on-premise cluster with the Agent-based Installer
```

---

## Next Steps

1. **User review and approval** of this design
2. **Refinement** based on feedback
3. **Implementation** in phases
4. **Testing** with various wizard states
5. **Documentation** update in README/CHANGELOG

---

## Questions for User

1. **Section ordering** - is the proposed order (Identity → Networking → Connectivity → Trust → Platform → Hosts → Operators) logical?
2. **Level of detail** - is this the right balance of concise vs comprehensive?
3. **Documentation sources** - should we group by category or just list sequentially?
4. **Presentation** - definition list (`<dl>`) vs other formats?
5. **Default state** - should dropdown be expanded or collapsed by default?

