# Mirror Operator Bundle Workflow - Internet Dependency Audit

**Date:** 2026-07-09  
**Purpose:** Identify all operations that require internet access in the mirror bundle workflow

## Context

When `mirrorConfigPreloaded === true` (mirror operator bundle flow), the wizard runs on **high-side (air-gapped network)** with:
- No internet access
- Pre-mounted mirror registry config at startup
- Pre-mounted binaries expected at `/data/openshift-install`

## Workflow Steps (High-Side)

### Hidden Steps (Not Available)
1. ✅ **Operators** - Hidden when `mirrorConfigPreloaded === true`
2. ✅ **Run oc-mirror** - Hidden when `mirrorConfigPreloaded === true`

### Visible Steps (Need Audit)

#### 1. Blueprint Step
**Operations:**
- Cincinnati version discovery (fetch available versions)
- **INTERNET DEPENDENCY:** ❌ YES - calls `/api/cincinnati/channels` and `/api/cincinnati/patches`

**Status:** ⚠️ NEEDS FIX
- Should use pre-selected version from `imageset-config.yaml` (already loaded via `imageSetConfigParser.js`)
- Should skip Cincinnati calls when `mirrorConfigPreloaded === true`

#### 2. Methodology Step
**Operations:**
- User selects methodology (local state only)

**Status:** ✅ NO INTERNET DEPENDENCY

#### 3. Identity & Access Step
**Operations:**
- Display pre-loaded pull secret (read-only)
- Display pre-loaded mirror registry pull secret (read-only)

**Status:** ✅ NO INTERNET DEPENDENCY

#### 4. Networking Step
**Operations:**
- User configures networking (local state only)

**Status:** ✅ NO INTERNET DEPENDENCY

#### 5. Connectivity & Mirroring Step
**Operations:**
- Display pre-loaded mirror registry FQDN (read-only)

**Status:** ✅ NO INTERNET DEPENDENCY

#### 6. Trust & Proxy Step
**Operations:**
- Display pre-loaded CA certificate (read-only)

**Status:** ✅ NO INTERNET DEPENDENCY

#### 7. Platform Specifics Step
**Operations:**
- User configures platform-specific settings (local state only)

**Status:** ✅ NO INTERNET DEPENDENCY

#### 8. Hosts / Inventory Step
**Operations:**
- User configures hosts (local state only)

**Status:** ✅ NO INTERNET DEPENDENCY

#### 9. Assets & Guide Step (ReviewStep.jsx)
**Operations:**
- Generate YAML previews via POST `/api/generate`
- Export bundle download

**Export Bundle Generation:**
- Line 3588: `ensureOpenshiftInstaller()` - Downloads openshift-install
- Line 3608: Downloads mirror-registry tarball from `https://mirror.openshift.com`
- Line 3649: Downloads mirror-registry tarball again (duplicate code path)

**Status:** ⚠️ NEEDS FIX
- Should use pre-mounted `/data/openshift-install` binary
- Should skip mirror-registry download when `mirrorConfigPreloaded === true` (already bundled)

#### 10. Generate Agent ISO Step
**Operations:**
- Line 3123: `ensureOpenshiftInstaller()` - Downloads openshift-install

**Status:** ✅ FIXED (commit f620db1)
- Now checks for `/data/openshift-install` first
- Falls back to download only if not found

#### 11. Operations Step
**Operations:**
- Job status display (local state only)
- Log downloads (local state only)

**Status:** ✅ NO INTERNET DEPENDENCY

## Summary of Required Fixes

### 1. Blueprint Step - Cincinnati Discovery
**File:** `frontend/src/steps/BlueprintStep.jsx`  
**Issue:** Calls Cincinnati API to fetch available versions  
**Fix:** Skip Cincinnati calls when `mirrorConfigPreloaded === true`, use pre-selected version from imageset-config

### 2. Export Bundle - openshift-install Binary
**File:** `backend/src/index.js` line 3588  
**Issue:** Downloads openshift-install for export bundle  
**Fix:** Check for `/data/openshift-install` before downloading, copy mounted binary to export bundle

### 3. Export Bundle - mirror-registry Tarball
**File:** `backend/src/index.js` lines 3608, 3649  
**Issue:** Downloads mirror-registry.tar.gz from mirror.openshift.com  
**Fix:** Skip download when `mirrorConfigPreloaded === true` (mirror registry already deployed on high-side)

## Implementation Plan

### Priority 1: Export Bundle Binary Inclusion
- [ ] Modify POST `/api/generate` to check for `/data/openshift-install` before downloading
- [ ] Copy mounted binary to export bundle `tools/` directory
- [ ] Skip mirror-registry download when `mirrorConfigPreloaded === true`

### Priority 2: Cincinnati Integration
- [ ] Add conditional check in BlueprintStep.jsx to skip Cincinnati when `mirrorConfigPreloaded === true`
- [ ] Display pre-selected version as read-only when mirror config preloaded
- [ ] Show informational banner: "Version pre-selected from mirror bundle imageset-config.yaml"

### Priority 3: Testing
- [ ] Test full workflow with `MIRROR_REGISTRY_CONFIG` and `IMAGESET_CONFIG` env vars
- [ ] Verify no network calls made during high-side workflow
- [ ] Verify export bundle contains mounted openshift-install binary
- [ ] Verify Agent ISO generation uses mounted binary
