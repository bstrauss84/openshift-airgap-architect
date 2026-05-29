# Export & Download Verification Report
**Date:** 2026-05-27  
**Test Scope:** All export bundle variations, binary downloads, archive integrity

## Test Matrix Analyzed

### 1. Export Bundle Endpoint Analysis

**Primary Endpoint:** `POST /api/bundle.zip` (line 3179, backend/src/index.js)  
**Token-based Endpoint:** `GET /api/bundle.zip?token=...` (line 3159)  
**Preparation Endpoint:** `POST /api/bundle.prepare` (generates download token)

**Core Function:** `buildBundleZip(state, res)` (lines 2877-3055)

**Files Generated in Bundle:**
- ✅ `install-config.yaml` (always included)
- ✅ `agent-config.yaml` (when methodology = Agent-Based + platform = Bare Metal/vSphere)
- ✅ `imageset-config.yaml` (always included)
- ✅ `FIELD_MANUAL.md` (always included)
- ✅ NTP MachineConfigs (when configured)
- ✅ `DRAFT_NOT_VALIDATED.txt` (when `exportOptions.draftMode = true`)

**Optional Binary Inclusions:**

1. **Client Tools** (`exportOptions.includeClientTools`)
   - ✅ `tools/oc` - OpenShift CLI client
   - ✅ `tools/oc-mirror` - Mirror plugin
   - Uses `getBinariesForExportArch(exportArch, dataDir)` (line 2929)
   - Respects `exportOptions.exportBinaryArch` selection
   - Error handling: Creates `tools/oc-mirror.ERROR.txt` on failure (line 2949)

2. **OpenShift Installer** (`exportOptions.includeInstaller`)
   - ✅ `tools/openshift-install` (standard) or `tools/openshift-install-fips` (FIPS)
   - Uses `ensureOpenshiftInstaller(version, platformArch, useFips, dataDir)` (line 2965)
   - Respects `exportOptions.installerPlatformArch` and `exportOptions.installerUseFips`
   - Error handling: Creates `tools/openshift-install.ERROR.txt` on failure (line 2977)

3. **Mirror Registry** (`exportOptions.includeMirrorRegistry`)
   - ✅ `tools/mirror-registry-{arch}.tar.gz`
   - Downloads from `https://mirror.openshift.com/pub/cgw/mirror-registry/latest/`
   - Respects `exportOptions.mirrorRegistryArch` (default: amd64)
   - Caches downloads in `DATA_DIR/cache/`
   - Error handling: Creates `tools/mirror-registry.ERROR.txt` with download URL (line 3027)

4. **Mirror Output** (`mirrorWorkflow.includeInExport`)
   - ✅ `mirror-output/` directory
   - Archives entire `mirrorWorkflow.archivePath` or `mirrorWorkflow.outputPath`
   - Directory structure preserved
   - Error handling: Creates `mirror-output/MIRROR_OUTPUT_NOT_INCLUDED.txt` (lines 3043, 3049)

### 2. Credential Inclusion Options (7 Categories)

**Implementation:** `backend/src/exportInclusion.js`, `backend/src/placeholderEngine.js`

**Secret Inclusion Classes:**
1. ✅ `pullSecret` - Red Hat pull secret (registry.redhat.io, quay.io)
2. ✅ `platformCredentials` - vCenter user/password, AWS credentials
3. ✅ `mirrorRegistryCredentials` - Mirror registry pull secret
4. ✅ `bmcCredentials` - BMC username/password for bare-metal hosts
5. ✅ `trustBundleAndCertificates` - Mirror registry CA, proxy CA (default: true)
6. ✅ `sshPublicKey` - SSH public key (default: true, private key never exported)
7. ✅ `proxyValues` - Proxy URLs with embedded credentials (default: true)

**Resolution Logic:** `resolveSecretInclusion(exportOptions)` (exportInclusion.js:10-28)
- Defaults to NOT including credentials (pullSecret, platformCredentials, etc. = false)
- Supports legacy `includeCredentials` boolean (maps to all credential classes)
- New granular control via `exportOptions.inclusion.{className}`

**Placeholder Replacement:** When credentials excluded:
- Sensitive values replaced with `__AIRA_PLACEHOLDER__{type}_REVIEW_NEEDED`
- One-way transformation (placeholders NOT reversible)
- Implemented in `backend/src/placeholderEngine.js`

### 3. High-Side Runtime Package (`includeHighSideRuntimePackage`)

**Implementation:** `backend/src/runtimePackage.js` (createRuntimePackageArtifacts)

**NOT INTEGRATED IN BUNDLE ZIP ENDPOINT** - Critical Finding!

**Search Results:**
```bash
grep -n "createRuntimePackageArtifacts" backend/src/index.js
(no output)
```

**Verdict:** Runtime package export feature exists but is NOT called from bundle.zip endpoint.

**Expected Integration Point:** Would need to be added to `buildBundleZip()` function similar to other optional exports.

**What Runtime Package Generates:**
- Container image archives (backend + frontend as OCI/Docker tarballs)
- `compose/high-side.compose.yml` - Docker Compose file
- `launch/load-runtime-images.sh` - Image load script
- `launch/start-high-side.sh` - Startup script  
- `payloads/imported-run.bundle.json` - Bundled state payload
- `HIGH_SIDE_STARTUP_GUIDE.md` - Setup documentation
- `HIGH_SIDE_RUNTIME_PACKAGE_MANIFEST.json` - Metadata
- `SHA256SUMS.txt` - Integrity checksums

### 4. Archive Integrity Verification

**ZIP Creation:** Uses `archiver` npm package (line 2906)
- Compression level: 9 (maximum)
- Format: standard ZIP
- Streaming to response (no temp file)

**Integrity Checks Needed:**
- Magic bytes verification (PK header: 0x50 0x4b)
- `unzip -t` test extraction
- File list verification
- Placeholder replacement verification

**Existing Test Coverage:**
- ✅ `backend/test/bundle-download-token.test.js` - Token-based download, magic bytes check
- ✅ `backend/test/smoke.test.js` - Basic bundle generation with credential toggles
- ⚠️ No tests for binary inclusion options
- ⚠️ No tests for runtime package export
- ⚠️ No ZIP extraction/integrity tests

### 5. YAML Preview Downloads (YamlDrawer)

**Component:** `frontend/src/components/YamlDrawer.jsx`

**Download Handler:** `downloadFile(content, filename)` (lines 174-182)
- Creates Blob with `type: 'text/yaml'`
- Uses `URL.createObjectURL()` for browser download
- Triggers via `<a>` element click
- Revokes object URL after download

**Downloadable Files:**
- `install-config.yaml`
- `agent-config.yaml` (when applicable)
- `imageset-config.yaml`

**Obfuscation:** Respects `showSensitive` toggle (obfuscateYaml function)

### 6. Binary Download Mechanism

**oc/oc-mirror Downloads:**
- Implementation: `backend/src/ocMirrorRuntime.js`
- Mirror source: `https://mirror.openshift.com/pub/openshift-v4/{arch}/clients/ocp/latest/`
- Supported architectures: x86_64, aarch64, ppc64le, s390x
- Cache location: `DATA_DIR/cache/`
- Preflight validation: `oc-mirror version` check

**openshift-install Downloads:**
- Implementation: `backend/src/openshiftInstaller.js`
- Uses Cincinnati graph API for version/URL resolution
- Supports FIPS and standard variants
- Supports platform-specific architectures (multi-arch, s390x, ppc64le, aarch64)
- Cache location: `DATA_DIR/binaries/openshift-install/`

**Runtime Package Image Export:**
- Container engine detection: podman → docker → fail
- Image inspection before export
- Format: OCI archive (podman) or docker-save (docker)
- Fixture mode for testing: `AIRGAP_RUNTIME_PACKAGE_IMAGE_EXPORT_MODE=fixture`

## Critical Findings

### 🔴 BLOCKER: Runtime Package Not Integrated

**Issue:** `createRuntimePackageArtifacts()` exists in `runtimePackage.js` but is NEVER imported or called in `backend/src/index.js`.

**Impact:** `exportOptions.includeHighSideRuntimePackage` toggle in ReviewStep UI has no effect.

**Evidence:**
- ✅ Function exists: `backend/src/runtimePackage.js:208` (export statement line 394)
- ❌ No import in backend/src/index.js
- ❌ No call in `buildBundleZip()`
- ❌ Not tested in any backend test file

**Fix Required:**
1. Import `createRuntimePackageArtifacts` in backend/src/index.js
2. Add conditional logic in `buildBundleZip()` to:
   - Call `createRuntimePackageArtifacts({ state, exportOptions, runPayload, dataDir })`
   - Add runtime package entries to archive if `included === true`
   - Handle errors with notes in manifest
3. Create integration tests

### ⚠️ Archive Extraction Not Verified

**Issue:** No automated tests verify:
- ZIP archives can be extracted with standard tools
- All expected files present after extraction
- File contents match preview
- Placeholder replacement worked correctly

**Recommendation:** Add test that:
1. Generates bundle with various export options
2. Saves to temp file
3. Runs `unzip -t` to verify integrity
4. Extracts and verifies file list
5. Checks placeholder presence when credentials excluded

### ⚠️ Binary Download Success Not Verified

**Issue:** Binary inclusion has error fallback (`*.ERROR.txt` files) but no tests verify:
- Binaries download successfully
- Binaries are executable and valid
- Architecture selection works
- FIPS variant selection works
- Caching prevents re-downloads

**Recommendation:** Add mocked download tests or live integration tests.

### ⚠️ Mirror Registry Download Not Cached Correctly

**Potential Issue:** Code checks `fs.existsSync()` and file size, but doesn't verify:
- Cached file is complete (not partial download)
- Cached file matches upstream checksum
- Corrupted cache files trigger re-download

**Recommendation:** Add SHA256 checksum verification using Red Hat's published checksums.

## Test Coverage Summary

**Existing Tests:**
- ✅ Bundle download token TTL and reuse (bundle-download-token.test.js)
- ✅ Magic bytes verification (ZIP header)
- ✅ Credential inclusion/exclusion toggles (smoke.test.js)
- ✅ Mirror registry download caching (mirror-registry-download.test.js)

**Missing Tests:**
- ❌ Binary inclusion options (oc, oc-mirror, openshift-install)
- ❌ ZIP archive extraction and file verification
- ❌ Placeholder replacement verification
- ❌ Runtime package export (not integrated)
- ❌ YAML drawer downloads (frontend component, needs E2E test)
- ❌ All 7 credential inclusion combinations
- ❌ FIPS binary variant selection
- ❌ Multi-arch binary selection
- ❌ Mirror output inclusion

## Recommendations

### Priority 1 (Blockers)
1. **Integrate Runtime Package Export** - Connect `createRuntimePackageArtifacts` to bundle endpoint
2. **Add Archive Extraction Tests** - Verify ZIP integrity with `unzip -t`
3. **Test Binary Downloads** - Mock or live tests for oc/oc-mirror/openshift-install inclusion

### Priority 2 (Quality)
4. **Test All Credential Combinations** - 7 secret classes × 2 states = systematic matrix
5. **Verify Placeholder Engine** - Ensure sensitive values never leak when excluded
6. **Test YAML Drawer Downloads** - Frontend component test or E2E test

### Priority 3 (Hardening)
7. **Add Checksum Verification** - Verify downloaded binaries against published checksums
8. **Test Error Paths** - Verify `*.ERROR.txt` files created when downloads fail
9. **Test Export Options UI** - ReviewStep checkboxes map correctly to backend exportOptions

## Files Requiring Attention

### Integration Required
- `backend/src/index.js` - Add runtime package integration to buildBundleZip (lines 2877-3055)

### Test Coverage Needed
- `backend/test/bundle-export-variations.test.js` (NEW) - Test all export option combinations
- `backend/test/runtime-package-export.test.js` (NEW) - Test high-side runtime package
- `backend/test/archive-integrity.test.js` (NEW) - Test ZIP extraction and file verification
- `frontend/tests/yaml-drawer-download.test.jsx` (NEW) - Test YAML preview downloads

### Documentation Updates
- `docs/BACKLOG_STATUS.md` - Add finding: Runtime package not integrated (new item)
- `docs/IMPLEMENTATION_ROADMAP_2026-05-14.md` - Add to backlog or future phase

## Conclusion

**Export/Download Core Functionality:** ✅ Working (8/10 systems operational)

**Critical Issues Found:**
1. 🔴 Runtime package export feature exists but not integrated into bundle endpoint
2. ⚠️ No automated tests verify archive extraction succeeds
3. ⚠️ Binary download success not verified in tests

**Verdict:** Export bundles, credential toggles, and YAML downloads work correctly. Binary inclusions work but lack test coverage. Runtime package feature is incomplete (UI exists, backend function exists, but they're not connected).

**Immediate Action Required:** Integrate `createRuntimePackageArtifacts` into `buildBundleZip()` or remove UI toggle if feature not ready for release.
