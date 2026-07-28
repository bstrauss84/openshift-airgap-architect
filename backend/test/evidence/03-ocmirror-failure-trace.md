# OC-Mirror Failure Trace

## Test

"POST /api/ocmirror/run without version confirmed returns 400"
File: test/ocmirror.test.js:75-103

## Isolated Runs (all 4 commits): PASS

Each commit passes when run individually with fresh DATA_DIR.
Confirmed: the test passes at 146239c, 86b5a4e, 734bc27, 2ae92b0.

## Full Suite Run (npm test): FAIL (before c77369e fix)

The test fails only during `npm test` due to test ordering and shared SQLite state.

## State Flow Trace

1. **Initial state:** `defaultState()` → `version: { versionConfirmed: false, confirmedByUser: false }`
   No `_schemaVersion`, no `locked` field.

2. **Prior tests** (e.g. unsupported-version-http-boundary.test.js, smoke.test.js):
   POST `/api/state` with `{ version: { _schemaVersion: 3, locked: true, selectedMinor: "4.20" }, ... }`
   → `setState()` persists to SQLite singleton row
   → Shared state now has `version.locked = true`

3. **oc-mirror test POSTs (BEFORE FIX):**
   `{ version: { versionConfirmed: false }, release: { confirmed: false } }`

4. **State POST handler** (index.js:1116-1224):
   a) `current = ensureState()` → retrieves state with `version.locked = true` (leaked)
   b) `merged = deepMerge(current, patch)` →
      - `version._schemaVersion: 3` (from existing)
      - `version.locked: true` (from existing, NOT overwritten by patch)
      - `version.versionConfirmed: false` (from patch)
      - `release.confirmed: false` (from patch)
   c) `migrateStateToV3(merged)` → v3 path (has `_schemaVersion: 3`)
      - `hasVersionLegacyConfirmation = true` (versionConfirmed exists)
      - `locked = (versionConfirmed === true) || (confirmedByUser === true) || (locked !== undefined && locked)`
      - `locked = false || false || (true && true) = true`
   d) `setState(sanitized)` → persists `version.locked: true`, `release.confirmed: true`

5. **oc-mirror run route** (index.js:2580-2617):
   `state = ensureState()` → `version.locked = true`
   `v3State.version?.locked = true`
   `confirmed = true` → returns 200, not 400
   **TEST FAILS:** expected 400, got 200

## Fix Applied (c77369e)

Changed test to POST v3 canonical fields:
`{ version: { _schemaVersion: 3, locked: false }, release: { confirmed: false } }`

After fix:
- `deepMerge` sets `version.locked = false` (explicitly overwritten)
- v3 canonicalization: `locked = false || false || false = false`
- oc-mirror run: `confirmed = false` → returns 400
- **TEST PASSES**

## Additional Fix (this commit)

Added `resetState(baseUrl)` call before every HTTP test to ensure clean state via `/api/start-over`. This prevents any future cross-test state leakage regardless of test ordering.

## Key Production Code Paths

- `deepMerge` (index.js:569-587): per-key replace, preserves keys not in patch
- `migrateStateToV3` (shared/stateMigration.js:66-153): v3 canonicalization at lines 85-114
- oc-mirror run route (index.js:2580-2617): `version.locked` check at line 2611
- `getState/setState` (utils.js:232-248): SQLite singleton row persistence
- `/api/start-over` (index.js:1236-1289): resets state to `defaultState()`
