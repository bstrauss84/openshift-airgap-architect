# Catalog Sync Guide

## Overview

This project maintains catalog parameter files in **two locations**:

1. **`data/params/4.20/`** - Backend/canonical source (12 files)
2. **`frontend/src/data/catalogs/`** - Frontend source (12 files)

These files **must stay synchronized** to ensure consistency across the application.

---

## Automatic Sync

### Pre-commit Hook ✅ ACTIVE

A Git pre-commit hook automatically syncs catalogs when you commit changes to catalog files.

**How it works:**
- Detects if you're committing any `*.json` files in catalog directories
- Runs `scripts/sync-catalogs.js` to ensure both locations match
- Auto-stages newly synced files
- Blocks commit if sync fails

**What you see:**
```bash
$ git commit -m "Update bare-metal catalog"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Pre-commit: Catalog files detected
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Catalog files being committed:
  • data/params/4.20/bare-metal-ipi.json

Running catalog sync...
  ✓ bare-metal-ipi.json - SYNCED

✓ Catalog sync complete - proceeding with commit
```

### npm Scripts

Run sync manually anytime:

```bash
# Sync catalogs (from data/params → frontend/catalogs)
npm run sync-catalogs

# Check sync status without modifying (dry run)
npm run sync-catalogs:check

# Verbose output (shows all files)
npm run sync-catalogs:verbose

# Validate catalog schemas
npm run validate-catalogs
```

---

## Manual Sync

If you need to sync outside of Git workflow:

```bash
# Run from repo root
node scripts/sync-catalogs.js

# Options
node scripts/sync-catalogs.js --dry-run    # Preview changes
node scripts/sync-catalogs.js --verbose    # Show all files
node scripts/sync-catalogs.js --help       # Show help
```

---

## Workflow Guidelines

### ✅ Recommended: Edit in `data/params/4.20/`

**Why?** This is the canonical source. Pre-commit hook will auto-sync to frontend.

```bash
# 1. Edit catalog file
vim data/params/4.20/bare-metal-ipi.json

# 2. Commit (sync happens automatically)
git add data/params/4.20/bare-metal-ipi.json
git commit -m "Update bare-metal catalog"

# Pre-commit hook syncs to frontend/src/data/catalogs/ automatically
```

### ⚠️ If you edit `frontend/src/data/catalogs/`

If you edit frontend catalogs directly, you need to sync back to `data/params`:

**Option 1: Let pre-commit handle it**
```bash
git add frontend/src/data/catalogs/vsphere-ipi.json
git commit -m "Update vSphere catalog"
# Hook will sync, but in wrong direction - frontend is not canonical source
```

**Option 2: Manual sync (better)**
```bash
# Copy your changes to canonical source first
cp frontend/src/data/catalogs/vsphere-ipi.json data/params/4.20/

# Then commit from canonical source
git add data/params/4.20/vsphere-ipi.json
git commit -m "Update vSphere catalog"
```

---

## Sync Script Details

### What it does

1. Compares MD5 hashes of all `*.json` files in both directories
2. Copies files from `data/params/4.20/` → `frontend/src/data/catalogs/`
3. Reports: identical, synced, errors

### Output

```bash
═══════════════════════════════════════════════════
  Catalog Sync Utility
═══════════════════════════════════════════════════

📂 Source: data/params/4.20
📂 Target: frontend/src/data/catalogs
📄 Files: 12 catalog files

  ✓ aws-govcloud-ipi.json - SYNCED
  ≡ nutanix-ipi.json - IDENTICAL
  ✓ vsphere-ipi.json - SYNCED
  ...

═══════════════════════════════════════════════════
  Summary
═══════════════════════════════════════════════════
  ✓ Identical: 10
  ↻ Synced:    2
  ✗ Errors:    0
═══════════════════════════════════════════════════

✅ Catalogs synchronized successfully!
```

---

## Troubleshooting

### Commit blocked by sync failure

```bash
✗ Catalog sync failed!
  Fix sync errors before committing.
```

**Solution:**
1. Check error message from sync script
2. Verify both directories exist
3. Ensure files are valid JSON
4. Fix issues and try committing again

### Files out of sync after pull

```bash
# Check sync status
npm run sync-catalogs:check

# Re-sync if needed
npm run sync-catalogs
```

### Disable pre-commit hook temporarily

```bash
# Skip hooks for one commit (NOT RECOMMENDED)
git commit --no-verify -m "Emergency commit"

# Better: fix the underlying issue
```

---

## File Locations

| Location | Role | Notes |
|----------|------|-------|
| `data/params/4.20/*.json` | **Canonical source** | Edit here |
| `frontend/src/data/catalogs/*.json` | Frontend copy | Auto-synced |
| `scripts/sync-catalogs.js` | Sync utility | Run manually or via hook |
| `.git/hooks/pre-commit` | Git hook | Auto-runs on commit |

---

## Catalog Files (12 total)

1. aws-govcloud-ipi.json
2. aws-govcloud-upi.json
3. azure-government-ipi.json
4. azure-government-upi.json
5. bare-metal-agent.json
6. bare-metal-ipi.json
7. bare-metal-upi.json
8. ibm-cloud-ipi.json
9. nutanix-ipi.json
10. vsphere-agent.json
11. vsphere-ipi.json
12. vsphere-upi.json

---

## Best Practices

✅ **DO:**
- Edit catalogs in `data/params/4.20/`
- Run `npm run sync-catalogs:check` before committing
- Let pre-commit hook handle sync
- Commit catalog changes separately from code changes

❌ **DON'T:**
- Edit same catalog in both locations simultaneously
- Skip pre-commit hook with `--no-verify` (unless emergency)
- Assume catalogs are synced without checking
- Mix catalog edits with unrelated changes in same commit

---

## Integration with CI/CD

Add to your CI pipeline:

```yaml
# Example GitHub Actions
- name: Check catalog sync
  run: npm run sync-catalogs:check

- name: Validate catalogs
  run: npm run validate-catalogs
```

---

**Questions or Issues?**

If catalogs get out of sync or sync script fails:
1. Check this guide
2. Run `npm run sync-catalogs:verbose` to see detailed status
3. Review error messages
4. Manually verify JSON file validity
5. Re-run sync: `npm run sync-catalogs`

**Last Updated:** 2026-05-09  
**Version:** 1.0
