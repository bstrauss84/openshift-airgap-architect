# Version-Aware UI Field Checklist

Operational checklist for adding a new version-gated parameter field to the frontend.
Complete every category before opening a PR.

**Canonical contract:** `docs/DESIGN_SYSTEM.md` "Version-Aware Parameter Fields" section.

---

## 1. Upstream contract

- [ ] Identify the official Red Hat docs page that introduces the parameter.
- [ ] Record the exact YAML path, type, allowed values, and default.
- [ ] Confirm the parameter is not ambiguous or conflicting across doc sources.

## 2. Catalog entry

- [ ] Add the parameter to `data/params/<version>/<scenario>.json` with correct metadata.
- [ ] Add a matching entry to `frontend/src/data/catalogs/<version>/<scenario>.json` with `supportStatus: "supported-ui"` and `minVersion` set to the introducing minor.
- [ ] Confirm the parameter does NOT appear in catalogs for earlier versions where it is unsupported.

## 3. State management

- [ ] Add the field's state key to `platformConfig` (or the appropriate state slice).
- [ ] Confirm the value is preserved when switching away from the introducing version unless the field's state-transition contract explicitly requires clearing.
- [ ] Confirm hidden retained state does not leak into inapplicable generated output.
- [ ] Confirm returning to an applicable version restores the retained value when retention is the defined behavior.
- [ ] Confirm the value is included in export/import round-trips.

## 4. UI placement

- [ ] Place the field in the correct Platform Specifics subsection.
- [ ] Wrap in `.field-with-info-row` (via `FieldLabelWithInfo`) or `.field-control-stack` as appropriate.
- [ ] Confirm the field does NOT appear as a direct child of `.field-grid` without a proper wrapper.

## 5. Version gating

- [ ] Gate visibility using the catalog: render only when `getCatalogForScenario(scenarioId, version)` includes the parameter with `supportStatus: "supported-ui"`.
- [ ] Use `SUPPORTED_MINORS` from `frontend/src/shared/versionPolicy.js` — no ad hoc version parsing.
- [ ] Confirm the field is hidden for versions that predate the parameter.

## 6. Validation

- [ ] Add requiredness rules consistent with the upstream contract.
- [ ] Add allowed-value validation if the parameter has a constrained domain.
- [ ] Confirm error messages appear inside `.field-control-support`, not as standalone elements.

## 7. YAML generation

- [ ] Confirm the backend emits the parameter at the correct YAML path when the field has a value.
- [ ] Confirm the parameter is omitted from generated YAML when the field is empty or the version does not support it.
- [ ] Verify in the YAML preview drawer.

## 8. Supporting-content layout

- [ ] Place helper text and error messages inside a `.field-control-support` wrapper.
- [ ] Confirm supporting content flows in normal document flow (row 3 of the subgrid) — no absolute positioning.
- [ ] Confirm helper and error text coexist without overlap when both are visible.
- [ ] Confirm the field pair's between-band spacing works correctly (1.5rem minimum via `::after`).

## 9. Persistence

- [ ] Confirm the field value survives page refresh (state persistence).
- [ ] Confirm "Start Over" clears the field value.
- [ ] Confirm export bundle includes the value when present.

## 10. Automated tests

- [ ] Add an entry to `VERSION_GATED_UI_FIELD_REGISTRY` in `frontend/tests/version-gated-field-boundary.test.jsx` with `scenario`, `path`, `platform`, `method`, `introductionMinor`, `controlQuery`, `owningStep`, and optional `supportContentQuery`.
- [ ] Confirm the bidirectional catalog cross-check passes (registry matches catalog, catalog matches registry).
- [ ] Add visibility toggle test: field visible at `introductionMinor`, hidden at the previous minor.
- [ ] Run the full frontend test suite and confirm zero failures.

## 11. Manual UI verification

- [ ] Start the dev server and verify the field appears at the correct version.
- [ ] Switch versions and confirm the field hides/shows correctly.
- [ ] Confirm paired-field alignment: label row, control row, and support row align with adjacent fields.
- [ ] Test at desktop (1920px+), laptop (1366px), tablet (768px), and mobile (375px).
- [ ] Verify in both light and dark themes.

## 12. Evidence

- [ ] Record the test pass count and confirm zero failures, zero unexpected skips.
- [ ] Record the build result (`npm run build` exits 0).
- [ ] Confirm `git diff --stat` shows only expected files changed.
- [ ] Commit with a descriptive message referencing the backlog item.
