# Security Audit Log

This file records security audits performed on the OpenShift Airgap Architect codebase.

---

## 2026-06-05: June 1, 2026 `@redhat-cloud-services` npm Compromise

**Audit Date:** 2026-06-05  
**Auditor:** Claude Sonnet 4.5  
**Trigger:** Supply-chain compromise of `@redhat-cloud-services/*` npm packages  
**Severity:** CRITICAL (credential-stealing malware, install-time execution)

### Incident Context

On June 1, 2026, multiple npm packages under the `@redhat-cloud-services/*` namespace were compromised with credential-stealing malware.

**Attack Vector:**
- Install-time scripts (preinstall/install/postinstall hooks)
- Targeted CI environments, developer machines

**Targeted Secrets:**
- CI secrets (GitHub Actions, GitLab CI, Jenkins)
- npm tokens
- GitHub tokens (GITHUB_TOKEN, personal access tokens)
- Cloud credentials (AWS, Azure, GCP, RHCS)
- Kubernetes configurations (kubeconfig)
- Vault tokens
- SSH keys (`.ssh/`)
- Docker credentials (`~/.docker/config.json`)
- Environment files (`.env`)

**Compromised Packages (Partial List):**
```
@redhat-cloud-services/types
@redhat-cloud-services/frontend-components-utilities
@redhat-cloud-services/frontend-components
@redhat-cloud-services/rbac-client
@redhat-cloud-services/javascript-clients-shared
@redhat-cloud-services/frontend-components-config-utilities
@redhat-cloud-services/frontend-components-notifications
@redhat-cloud-services/tsc-transform-imports
@redhat-cloud-services/frontend-components-config
@redhat-cloud-services/eslint-config-redhat-cloud-services
@redhat-cloud-services/host-inventory-client
@redhat-cloud-services/rule-components
@redhat-cloud-services/frontend-components-remediations
@redhat-cloud-services/frontend-components-translations
@redhat-cloud-services/vulnerabilities-client
@redhat-cloud-services/frontend-components-advisor-components
@redhat-cloud-services/entitlements-client
@redhat-cloud-services/chrome
@redhat-cloud-services/notifications-client
@redhat-cloud-services/compliance-client
@redhat-cloud-services/sources-client
@redhat-cloud-services/integrations-client
@redhat-cloud-services/frontend-components-testing
@redhat-cloud-services/remediations-client
@redhat-cloud-services/insights-client
@redhat-cloud-services/topological-inventory-client
@redhat-cloud-services/config-manager-client
@redhat-cloud-services/hcc-pf-mcp
@redhat-cloud-services/quickstarts-client
@redhat-cloud-services/patch-client
@redhat-cloud-services/hcc-feo-mcp
@redhat-cloud-services/hcc-kessel-mcp
```

### Files Checked

**Dependency Manifests:**
- `backend/package.json`
- `backend/package-lock.json`
- `frontend/package.json`
- `frontend/package-lock.json`

**CI/Build Files:**
- `.github/workflows/ci.yml`
- `backend/Dockerfile`
- `backend/Containerfile`
- `frontend/Dockerfile`
- `frontend/Containerfile`

**Documentation:**
- `CLAUDE.md`
- `README.md` (checked for npm install instructions)

### Commands Run

```bash
# Search for compromised packages
find . -name 'package.json' -o -name 'package-lock.json' | grep -v node_modules
grep -R "@redhat-cloud-services" package.json package-lock.json backend frontend .github 2>/dev/null
grep -r "redhat-cloud-services" . --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null

# Deep lockfile inspection
jq -r '.packages | to_entries[] | select(.key | contains("@redhat-cloud-services")) | "\(.key) \(.value.version)"' backend/package-lock.json frontend/package-lock.json
jq -r '.dependencies // {} | to_entries[] | select(.key | contains("@redhat-cloud-services")) | "\(.key) \(.value.version)"' backend/package-lock.json frontend/package-lock.json

# Install script audit
jq -r '.packages | to_entries[] | select(.value.hasInstallScript == true) | "\(.key) \(.value.version)"' backend/package-lock.json frontend/package-lock.json
grep -A 5 '"scripts"' package.json frontend/package.json | grep -E "(preinstall|install|postinstall)"

# Native build dependencies
grep -E "(better-sqlite3|node-gyp|esbuild|@swc|sharp)" package.json frontend/package.json

# CI workflow audit
find .github/workflows -name '*.yml' -o -name '*.yaml' | xargs grep -l "npm"
grep -E "(npm install|npm update|npx|--ignore-scripts)" .github/workflows/ci.yml backend/Dockerfile frontend/Dockerfile
```

### Results

**✅ NO COMPROMISED PACKAGES FOUND**

**Direct Dependencies:**
- **backend:** 0 matches for `@redhat-cloud-services`
- **frontend:** 0 matches for `@redhat-cloud-services`

**Transitive Dependencies (lockfile):**
- **backend/package-lock.json:** 0 matches
- **frontend/package-lock.json:** 0 matches

**Full Repository Search:**
- 0 matches for `redhat-cloud-services` across all files (excluding node_modules, .git)

**Install Scripts:**
- Project package.json files: No install/preinstall/postinstall hooks
- Native build dependency: better-sqlite3 (backend) - APPROVED, LOW RISK

**CI/Build Workflows:**
- ✅ GitHub Actions CI uses `npm ci` (safe, reproducible)
- ⚠️ `backend/Dockerfile` line 39 uses `npm install` (should be `npm ci`)
- ⚠️ `frontend/Dockerfile` line 10 uses `npm install` (should be `npm ci`)

### Action Required

**✅ NO IMMEDIATE ACTION REQUIRED**

The repository is NOT affected by the June 1, 2026 `@redhat-cloud-services` compromise.

**Recommended Improvements:**
1. Update Dockerfiles to use `npm ci` instead of `npm install`
2. Add supply-chain security guardrails to `CLAUDE.md` (COMPLETE)
3. Add this security audit log (COMPLETE)

### Credential Rotation Recommendation

**NOT REQUIRED** - No compromised packages were ever installed in this repository.

If compromised packages had been found, the following credentials would require rotation:
- npm tokens for any developer/CI that ran `npm install`
- GitHub tokens (GITHUB_TOKEN, personal access tokens)
- Cloud credentials (AWS, Azure, GCP)
- SSH keys
- Any secrets in `.env` files
- Vault tokens
- Kubernetes configurations

### Prevention Measures Added

**Documentation Updates:**
- Added "NPM Supply Chain Security Guardrails" section to `CLAUDE.md`
- Permanent ban on `@redhat-cloud-services/*` packages without security approval
- Mandatory security review for all new npm dependencies
- Preference for `npm ci` over `npm install`
- Lifecycle script review requirements
- Credential access audit requirements

**Files Modified:**
- `CLAUDE.md` (+108 lines security section)
- `docs/SECURITY_AUDIT_LOG.md` (NEW, this file)

### Work Status

**DOC-101 Phase 1 Version-Awareness Work: PAUSED**

All version-awareness implementation work paused during security audit.

**Resume Conditions:**
- Security audit complete ✅
- No compromised packages found ✅
- Documentation updated ✅

**SAFE TO RESUME DOC-101 WORK**

---

## Future Audits

Template for future security audits:

### YYYY-MM-DD: [Incident/Audit Name]

**Audit Date:**  
**Auditor:**  
**Trigger:**  
**Severity:**

**Files Checked:**

**Commands Run:**

**Results:**

**Action Required:**

**Files Modified:**

**Work Status:**
