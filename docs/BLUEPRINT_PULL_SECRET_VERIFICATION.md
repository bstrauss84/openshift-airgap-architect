# Blueprint pull secret & locked message – verification notes

> Authority: Working verification note
> Canonical status source: `docs/BACKLOG_STATUS.md`
> Canonical navigation source: `docs/INDEX.md`

## Summary of changes

### 1) "Foundational selections are locked" message position
- **File:** `frontend/src/steps/BlueprintStep.jsx`
- **Change:** The warning "Foundational selections are locked. Use Start Over to change platform, architecture, or release." now renders **immediately above** the "Target Platform" section (first child of `.step-body` when locked). When not locked, the message is not rendered and no extra whitespace is added.
- **Manual check:** Lock foundational selections (use "Yes, lock selections" from the core lock modal). On the Blueprint page, confirm the warning appears above the Target Platform card. Start Over, then confirm the warning is gone and Target Platform is the first section.

### 2) Red Hat pull secret section on Blueprint
- **Files:** `frontend/src/steps/BlueprintStep.jsx`, `frontend/src/validation.js`
- **Change:** New section "Red Hat pull secret" below the OpenShift release section with:
  - Helper text: optional; only for operator mirror; used only to fetch Operator catalog metadata; not stored or transmitted elsewhere.
  - Password-style input (obfuscated by default), Show/Hide toggle (eye icon when hidden), paste/type/upload file.
  - Validation: optional; if non-empty, must be valid JSON with an `auths` object; invalid value blocks lock and shows an error.
- **Manual check:** On Blueprint, enter invalid JSON in the pull secret field → "Yes, lock selections" should be disabled and an error shown. Enter valid `{"auths":{}}` → error clears and lock is allowed. Toggle Show/Hide and use "Upload file" to confirm behavior.

### 3) Security: no persistence of pull secret
- **Files:** `frontend/src/store.jsx`, `backend/src/index.js`
- **Change:**
  - **Frontend:** `getStateForPersistence(state)` strips `blueprint.blueprintPullSecretEphemeral` before writing to `localStorage` and before `POST /api/state`. Exported for tests.
  - **Backend:** `POST /api/state` strips `blueprintPullSecretEphemeral` from incoming body before merging. `sanitizeStateForExport` always removes it so run export never includes it.
- **Manual check:** Enter a pull secret on Blueprint, wait for auto-save (or navigate away), then inspect `localStorage` for `airgap-architect-state` and confirm the value does not contain your secret or the key `blueprintPullSecretEphemeral`. Export a run and confirm the downloaded JSON does not contain the secret.

### 4) Lock flow: scan kickoff and field cleared
- **Files:** `frontend/src/App.jsx`, `backend/src/operators.js`, `backend/src/index.js`
- **Change:**
  - When the user clicks "Yes, lock selections" in the core lock modal, if there is a valid pull secret in `state.blueprint.blueprintPullSecretEphemeral`, the app calls `POST /api/operators/scan` with `{ pullSecret: "<value>" }` (same as the Operators tab scan). The secret is then cleared from state (and the field is disabled because the blueprint is locked). Scan runs in the background; Operators tab shows in-progress/completed state as today.
  - "Yes, lock selections" is disabled when blueprint step validation fails (e.g. invalid pull secret) via `errorFlags.blueprint`.
  - **Backend:** Temp auth file written for scan is deleted in `child.on("close")` in `runScanJob` via `safeUnlink(authFile)`. Comment added: do not log `req.body` in the scan route.
- **Manual check:** Enter a valid pull secret on Blueprint, click Proceed to open the lock modal, click "Yes, lock selections". Confirm the Blueprint pull secret field is cleared and disabled. Open the Operators tab and confirm scan status shows running or completed. Manually trigger "Scan / Update Operators" on the Operators tab and confirm it still works.

### 5) Tests
- **Files:**  
  - `frontend/tests/validation-blueprint-pull-secret.test.js` – optional pull secret validation; blueprint step errors; no secret in error output.  
  - `frontend/tests/blueprint-locked-message-position.test.jsx` – locked message above Target Platform when locked; no message when not locked.  
  - `frontend/tests/blueprint-lock-scan-flow.test.jsx` – lock with pull secret triggers `POST /api/operators/scan` with `pullSecret` in body.  
  - `frontend/tests/blueprint-pull-secret-no-persistence.test.js` – `getStateForPersistence` removes `blueprintPullSecretEphemeral` and secret value from stringified state; **Phase 5 Prompt E:** also removes `credentials.pullSecretPlaceholder` and `credentials.mirrorRegistryPullSecret` so Identity & Access pull secrets are never persisted.
- **Run:** `cd frontend && npm run test` (or `npx vitest run`).

## Security checklist (must remain true)
- [x] Pull secret is never persisted (no disk, no localStorage/sessionStorage; stripped in store and backend).
- [x] Pull secret is never logged (comment in scan route; no `console.log` of `req.body` or secret).
- [x] Pull secret is sent only to the existing operator scan flow (once per lock, in request body); backend uses it only in memory and temp file, and deletes the temp file after the child process exits.
- [x] Run export and state POST never include `blueprintPullSecretEphemeral`.
