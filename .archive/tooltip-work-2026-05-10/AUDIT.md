# Tooltip Audit Report
**Date:** 2026-05-10  
**Scope:** All step files in frontend/src/steps/

---

## Executive Summary

**Progress:**
- ✅ **150 tooltips** using FieldLabelWithInfo with `hint={...}` are ALL in gold standard format (template literals with **bold** sections)
- ❌ **9 SecretInput fields** use `labelHint` with brief, non-gold-standard text
- ❌ **Multiple critical fields** have NO tooltips at all

**Conclusion:** The work on FieldLabelWithInfo tooltips is essentially complete, but there are two gaps:
1. SecretInput fields need proper tooltips
2. Several important fields don't use FieldLabelWithInfo at all

---

## Gap 1: SecretInput Fields (Not Gold Standard)

SecretInput component uses `labelHint` prop which is a simple string, not a structured tooltip. These need enhancement:

### Identity & Access Tab (IdentityAccessStep.jsx)

**Line 374-383: Red Hat Pull Secret**
```jsx
<SecretInput
  value={pullSecretPlaceholder}
  onChange={(v) => updateCredentials({ pullSecretPlaceholder: v })}
  label="Pull secret (Red Hat)"
  labelEmphasis="Paste, drag and drop, or upload a Red Hat pull secret (JSON)"
  labelHint="For clusters that access Red Hat registries directly or through allowed egress. From OpenShift Cluster Manager. Used in install-config when not using a mirror registry. Not persisted."
  getPullSecretUrl="https://console.redhat.com/openshift/downloads#tool-pull-secret"
  required={requiredPullSecret}
  placeholder='{"auths":{...}}'
  rows={5}
```

**Current labelHint:** Simple one-liner  
**Needs:** Gold standard format with:
- **What is this:** Explanation of pull secret purpose
- **Where to get it:** OpenShift Cluster Manager details
- **When needed:** Direct registry access vs mirror registry
- **Important:** Not persisted, used in install-config
- **Format:** JSON structure
- **Example:** Sample JSON snippet

**Line 394-408: Mirror Registry Pull Secret**
```jsx
<SecretInput
  value={mirrorRegistryPullSecret}
  onChange={(v) => {...}}
  label="Pull secret (Mirror registry)"
  labelEmphasis="Paste, drag and drop, or upload mirror registry pull secret (JSON)"
  required={requiredPullSecret}
  placeholder='{"auths":{...}}'
  rows={5}
/>
```

**Current labelHint:** NONE  
**Needs:** Gold standard tooltip explaining:
- **What is this:** Mirror registry authentication
- **How it's used:** Local registry access
- **Help me generate button:** Mention the helper tool available
- **Format:** JSON structure matching Red Hat format
- **Example:** Sample JSON

### Blueprint Tab (BlueprintStep.jsx)

**Line 370-379: Red Hat Pull Secret**
```jsx
<SecretInput
  value={blueprint?.blueprintPullSecretEphemeral || ""}
  onChange={(v) => {...}}
  label="Pull secret (JSON)"
  labelEmphasis="Pull secret (JSON)"
  labelHint="Not stored or exported. Optional; required only if you plan to include Operators in your mirror."
  getPullSecretUrl="https://console.redhat.com/openshift/downloads#tool-pull-secret"
  errorMessage={blueprintPullSecretError || undefined}
  disabled={locked}
  placeholder="Paste, drag and drop, or upload a Red Hat pull secret"
  rows={8}
/>
```

**Current labelHint:** Brief one-liner  
**Needs:** Gold standard format explaining:
- **What is this:** Blueprint-level pull secret for operator catalog fetching
- **Why optional:** Only needed for operator inclusion
- **How it's used:** Authenticate to Red Hat for catalog metadata
- **Not persisted:** Ephemeral, not stored or exported
- **Retain option:** Explain the "Retain for oc-mirror runs" checkbox

### Operators Tab (OperatorsStep.jsx)

**Line 514-527: Red Hat Pull Secret**
```jsx
<SecretInput
  value={pullSecretInput}
  onChange={setPullSecretInput}
  label="Red Hat pull secret (optional)"
  labelEmphasis="Red Hat pull secret (optional)"
  labelHint={
    state.credentials?.redHatPullSecretConfigured
      ? "Pull secret configured for operator discovery."
      : hasRetainedPullSecret && discoveryAlreadyRunningOrDone
        ? "From Blueprint (in memory only). Used for catalog scan; not stored or exported."
        : "Used only for catalog scan. Red Hat login required to obtain."
  }
  getPullSecretUrl="https://console.redhat.com/openshift/downloads#tool-pull-secret"
  placeholder="Paste Red Hat pull secret JSON"
  rows={5}
/>
```

**Current labelHint:** Dynamic, brief text  
**Needs:** Gold standard format (may need to be static or handle dynamic states better)

### Run oc-mirror Tab (RunOcMirrorStep.jsx)

**4 instances of Red Hat pull secret and Mirror registry pull secret**

**Lines 845-853, 859-867: Red Hat Pull Secret (2 instances)**
```jsx
labelHint="Paste, drag-and-drop, or upload your Red Hat pull secret JSON from console.redhat.com. Used for this run only — not stored."
```

**Lines 915-923, 929-937: Mirror Registry Pull Secret (2 instances)**
```jsx
labelHint="Paste, drag-and-drop, or upload mirror registry pull secret JSON. Used for this run only — not stored."
```

**Current labelHint:** Brief one-liners  
**Needs:** Gold standard format for both types

### Global Strategy Tab (GlobalStrategyStep.jsx)

**Line 1461: Additional CA bundle (legacy tab, not segmented flow)**
```jsx
<SecretInput
  ...
/>
```

**Status:** Legacy tab, may not need update if segmented flow is primary

---

## Gap 2: Fields Without Tooltips

Critical fields that should have FieldLabelWithInfo with proper tooltips:

### Identity & Access Tab (IdentityAccessStep.jsx)

**Line 436-448: SSH Public Key**
- Currently: Plain `<label>` with simple note "Paste, drag and drop, or upload; or generate a keypair below."
- Needs: FieldLabelWithInfo with tooltip explaining:
  - **What is this:** SSH public key for cluster machine access
  - **Format:** ssh-rsa, ssh-ed25519, etc.
  - **Generate keypair button:** Mention the helper tool
  - **Why needed:** Debug access, day-2 operations
  - **Security:** Keep private key secure
  - **Example:** ssh-rsa AAAA...

**Line 459-471: FIPS Mode**
- Currently: Plain `<span>` label with Switch
- Needs: FieldLabelWithInfo or info icon with tooltip explaining:
  - **What is FIPS:** Federal Information Processing Standards
  - **Why enable:** Compliance requirements (government, finance)
  - **Requirements:** RHEL 9 installer host with FIPS enabled
  - **Impact:** Hardened cryptography, some features limited
  - **Cannot be changed:** After installation
  - **Who needs this:** Regulated industries

**Mirror Registry Authentication Section (Lines 326-359)**
- Currently: Plain labels for radio buttons and checkboxes
- Consider: Info icons for "Anonymous pulls" and "Use mirror-registry credentials" options

### Trust & Proxy Tab (TrustProxyStep.jsx)

**Line 673-688: Mirror Registry CA**
- Currently: `<h4>` title and `<p>` description
- Needs: FieldLabelWithInfo or info icon explaining:
  - **What is this:** CA certificate for private/self-signed registry
  - **When required:** Private CA registries only
  - **Format:** PEM-encoded certificate(s)
  - **Multiple certs:** Can paste multiple in one bundle
  - **How it's used:** Install-config additionalTrustBundle
  - **Example:** -----BEGIN CERTIFICATE-----

**Line 692-702: Proxy CA**
- Currently: `<h4>` title and `<p>` description  
- Needs: FieldLabelWithInfo or info icon explaining:
  - **What is this:** CA certificate for HTTPS proxy
  - **When needed:** Corporate/custom proxy CAs
  - **How it's used:** additionalTrustBundle in install-config
  - **Proxyonly vs Always:** Mention trust bundle policy below

**Line 708-745: Trust Bundle Policy (additionalTrustBundlePolicy)**
- Currently: Custom label with explanations below
- Needs: FieldLabelWithInfo or info icon explaining:
  - **What is this:** How OpenShift applies CA bundles
  - **Proxyonly:** Only for proxy trust path
  - **Always:** Distributed to all nodes
  - **When to use each:** Guidelines
  - **Automatically selected:** Based on Mirror registry vs Proxy CA

---

## Recommendations

### Priority 1: SecretInput Component Enhancement

**Option A:** Enhance SecretInput component to support `hint` prop like FieldLabelWithInfo
```jsx
<SecretInput
  ...
  hint={`Gold standard formatted tooltip...`}
/>
```

**Option B:** Wrap SecretInput in FieldLabelWithInfo structure
```jsx
<FieldLabelWithInfo
  label="Pull secret (Red Hat)"
  hint={`Gold standard tooltip...`}
>
  <SecretInput
    ... (simplified props)
  />
</FieldLabelWithInfo>
```

### Priority 2: Add Missing Tooltips

1. SSH Public Key (Identity & Access)
2. FIPS Mode (Identity & Access)
3. Mirror Registry CA (Trust & Proxy)
4. Proxy CA (Trust & Proxy)
5. Trust Bundle Policy (Trust & Proxy)

### Priority 3: Content Development

For each field, write gold standard tooltips with:
- **What is this:** Clear explanation
- **Why it matters:** Purpose and impact
- **When to use:** Scenarios and requirements
- **Format/validation:** Expected input
- **Examples:** Concrete values
- **Important notes:** Warnings, constraints, immutability

---

## Estimated Effort

**SecretInput enhancement:** 2-3 hours (component + 9 instances)  
**Missing tooltips (5 fields):** 2-3 hours  
**Testing & verification:** 1 hour  
**Total:** 5-7 hours

---

## Next Steps

1. User confirms which approach for SecretInput (Option A or B)
2. Implement SecretInput tooltip support
3. Write gold standard content for all pull secret fields
4. Add FieldLabelWithInfo to SSH Key, FIPS, CA fields
5. Write gold standard content for newly added tooltips
6. Test all tooltips render correctly
7. Update COMPREHENSIVE_MASTER_PLAN.md to reflect 100% completion
