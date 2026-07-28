# Verdict: TEST_ISOLATION_BUG

## Root Cause

The oc-mirror "without version confirmed" test used legacy v2 field (`versionConfirmed: false`) which did not clear the v3 canonical field (`version.locked`) when prior tests had set `locked: true` via the shared SQLite state.

## State Flow

1. Prior tests POST state with `version.locked: true` (v3 canonical)
2. oc-mirror test POSTs `{ version: { versionConfirmed: false }, release: { confirmed: false } }`
3. `deepMerge` preserves `version.locked: true` (not in patch, not overwritten)
4. v3 canonicalization computes `locked = false || false || true = true`
5. oc-mirror run route sees `locked: true` -> returns 200, test expects 400

## Fix Applied (c77369e)

Updated test to send v3 canonical fields: `{ version: { _schemaVersion: 3, locked: false } }`. This ensures `deepMerge` explicitly sets `locked: false` regardless of prior test leakage.

## Additional Changes (this commit)

- Converted 5 `test.skip` to `test.todo` with backlog IDs DOC-123 through DOC-126
- Removed skip allowlist from test-integrity guard; replaced with backlog ID validation
- Added state reset (`/api/start-over`) before every oc-mirror HTTP test
- Added `closeServer` promise helper; awaited `server.close()` in all 10 test files
- Added 4 isolation proving tests
- Added 5 legacy contract regression tests
- Added 4 new backlog items (DOC-123 through DOC-126) to BACKLOG_STATUS.md

## Legacy Partial-Patch Contract

**LEGACY_PARTIAL_PATCH_MIGRATES_AND_CLEARS** with OR semantics:
- Legacy confirmation fields (`versionConfirmed`, `confirmedByUser`) are consumed by v3 canonicalization and deleted
- OR logic: `locked = versionConfirmed===true || confirmedByUser===true || (locked!==undefined && locked)`
- Legacy `versionConfirmed: false` CANNOT unlock a v3 `locked: true` state
- Only explicit v3 `locked: false` can unlock

## Production Code: No Changes

All changes are test-only and documentation. Generated YAML output is identical between 146239c baseline and HEAD across all 8 scenarios.
