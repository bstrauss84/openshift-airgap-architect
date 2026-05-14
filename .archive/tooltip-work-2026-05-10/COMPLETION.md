# Tooltip Completion Report
**Date:** 2026-05-10  
**Status:** ✅ ALL COMPLETE

---

## Summary

All tooltip gaps identified in the audit have been completed with full gold standard formatting:
- ✅ Template literal syntax `{`...`}`
- ✅ **Bold** section headers with yellow highlighting
- ✅ Comprehensive content (WHAT, WHY, WHEN, FORMAT, EXAMPLES)
- ✅ Consistent structure across all tooltips

---

## Completed Work

### 1. Missing Field Tooltips ✅

**SSH Public Key (Identity & Access)** - COMPLETED
- File: `frontend/src/steps/IdentityAccessStep.jsx`
- Converted from plain `<label>` to FieldLabelWithInfo
- Comprehensive tooltip covering:
  - Format requirements (ssh-rsa, ssh-ed25519, ecdsa)
  - How to provide (paste, upload, generate)
  - **Generate keypair button** functionality explained
  - Security warnings about private key handling
  - Why SSH access matters
  - Examples

**FIPS Mode (Identity & Access)** - COMPLETED
- File: `frontend/src/steps/IdentityAccessStep.jsx`
- Added FieldLabelWithInfo wrapper for Switch component
- Comprehensive tooltip covering:
  - What FIPS is (Federal Information Processing Standards 140-2)
  - Who needs it (government, defense contractors, regulated industries)
  - **Critical requirement:** RHEL 9 installer host with FIPS enabled
  - Impact on cluster (performance, compatibility, immutability)
  - When NOT to enable
  - Example use cases

**Mirror Registry CA (Trust & Proxy)** - COMPLETED
- File: `frontend/src/steps/TrustProxyStep.jsx`
- Enhanced PemField component to support `hint` prop
- Comprehensive tooltip covering:
  - When required (private CA vs self-signed)
  - Format (PEM-encoded X.509)
  - Multiple certificates (chain of trust)
  - How to provide (paste, drag-and-drop, upload)
  - How it's used (install-config additionalTrustBundle)
  - Trust bundle policy automatic selection
  - Example certificate

**Proxy CA (Trust & Proxy)** - COMPLETED
- File: `frontend/src/steps/TrustProxyStep.jsx`
- Enhanced PemField component with `hint` prop
- Comprehensive tooltip covering:
  - When needed (corporate proxy, HTTPS inspection)
  - Format (PEM-encoded X.509)
  - Multiple certificates support
  - How it's used (additionalTrustBundle)
  - Trust bundle policy (Proxyonly default)
  - Common scenarios (corporate network, SSL inspection)
  - Example certificate

**Trust Bundle Policy (Trust & Proxy)** - COMPLETED
- File: `frontend/src/steps/TrustProxyStep.jsx`
- Wrapped select element with FieldLabelWithInfo
- Comprehensive tooltip covering:
  - What additionalTrustBundlePolicy controls
  - **Proxyonly** vs **Always** explained in detail
  - Automatic selection based on CA certificates provided
  - When to change the default
  - Important warnings (Mirror registry with Proxyonly will fail)
  - How it's used in install-config
  - Example decision tree

### 2. SecretInput Component Enhancement ✅

**Component Update** - COMPLETED
- File: `frontend/src/components/SecretInput.jsx`
- Added `hint` prop support (alias for `labelHint`)
- Backwards compatible - existing `labelHint` props still work
- Uses `effectiveHint = hint || labelHint` pattern
- Integrates with FieldLabelWithInfo when hint provided

### 3. Pull Secret Field Tooltips ✅

All 9 SecretInput instances now have comprehensive gold standard tooltips:

**Identity & Access Tab:**
1. **Red Hat Pull Secret** - COMPLETED
   - Explains OpenShift Cluster Manager source
   - When needed (connected vs disconnected)
   - How it's used in install-config
   - Format with JSON example
   - Security note (not persisted)
   - Mirror registry mode explanation

2. **Mirror Registry Pull Secret** - COMPLETED
   - Explains disconnected/airgap usage
   - When needed (no egress environments)
   - Format with registry hostname example
   - **"Help me generate" button** functionality explained
   - How to create (3 options: helper, podman login, manual)
   - Anonymous pulls explanation
   - Security note

**Blueprint Tab:**
3. **Red Hat Pull Secret (Blueprint)** - COMPLETED
   - Explains Blueprint-stage usage for operator scanning
   - Different from install-config pull secret
   - When optional (only for operator inclusion)
   - **"Retain for oc-mirror runs"** checkbox explained
   - Not persisted/exported details
   - Format with JSON example

**Operators Tab:**
4. **Red Hat Pull Secret (Operators)** - COMPLETED
   - Explains catalog scanning authentication
   - When optional (mounted/retained sources)
   - Pull secret sources explained (mounted, retained, pasted)
   - How it's used for Scan operation
   - Fast mode cache explanation
   - Not stored/persisted details

**Run oc-mirror Tab:**
5-6. **Red Hat Pull Secret (2 instances)** - COMPLETED
   - Explains oc-mirror authentication
   - When needed by mode (diskToMirror, mirrorToMirror)
   - Alternative sources (mounted, retained from Blueprint)
   - How oc-mirror uses it
   - Ephemeral (this run only)
   - Format with JSON example

7-8. **Mirror Registry Pull Secret (2 instances)** - COMPLETED
   - Explains mirror registry push authentication
   - When needed (diskToMirror, mirrorToMirror modes)
   - Format with registry hostname
   - How to create (podman login, manual base64)
   - How oc-mirror uses it
   - Ephemeral (this run only)
   - Example with base64 auth string

---

## Files Modified

1. `frontend/src/components/SecretInput.jsx` - Enhanced with hint prop
2. `frontend/src/steps/IdentityAccessStep.jsx` - SSH Key, FIPS, 2 pull secrets
3. `frontend/src/steps/TrustProxyStep.jsx` - PemField enhancement, 3 CA/trust tooltips
4. `frontend/src/steps/BlueprintStep.jsx` - 1 pull secret
5. `frontend/src/steps/OperatorsStep.jsx` - 1 pull secret
6. `frontend/src/steps/RunOcMirrorStep.jsx` - 4 pull secrets

**Total Files:** 6  
**Total Tooltips Added/Enhanced:** 14

---

## Build Status

✅ **Build successful** with no errors

```
dist/index.html                     0.41 kB │ gzip:   0.28 kB
dist/assets/index-CVQvPXKB.css     87.23 kB │ gzip:  16.08 kB
dist/assets/index-BTXZ_c5W.js   1,348.01 kB │ gzip: 264.39 kB
✓ built in 1.07s
```

---

## Gold Standard Compliance

All tooltips now comply with the gold standard:

✅ **Template Literals:** All use `{`...`}` syntax for multiline  
✅ **Bold Headers:** All use `**Header:**` for section titles (renders as yellow highlight)  
✅ **Structure:** Consistent WHAT/WHY/WHEN/HOW/FORMAT/EXAMPLE/IMPORTANT sections  
✅ **Examples:** Real-world values and code snippets  
✅ **Warnings:** ⚠️ symbols for critical notes  
✅ **Code Blocks:** Backticks for code, triple backticks for multi-line  
✅ **Clarity:** Beginner-friendly language, no unexplained jargon

---

## Next Steps

Ready to proceed with documentation consolidation:
1. Update COMPREHENSIVE_MASTER_PLAN.md to mark Phase 1 as 100% complete
2. Add DOC-056 to BACKLOG_STATUS.md for tooltip completion work
3. Continue with consolidation plan (Phases 1-7)
