# Version-Aware UI Field Checklist

Operational checklist for adding a new version-gated parameter field to the frontend.
Complete every category before opening a PR.

**Canonical contract:** `docs/DESIGN_SYSTEM.md` "Version-Aware Parameter Fields" section.

---

## 0. STOP — read this before writing any JSX

Every field below renders its label, its control, its inline validation message,
its `New in OpenShift X.Y` badge and its helper text **inside one
`.field-control-stack` div**. Nothing else is acceptable, for any field, ever.

```jsx
<div className="field-control-stack">            {/* mandatory — NOT a fragment */}
  <FieldLabelWithInfo
    label="…"
    hint={"Introduced in OpenShift " + fieldIntroducedIn(PATH, INSTALL_CONFIG) + ". …"}
  >
    <input … aria-invalid={…} aria-describedby={…} />
  </FieldLabelWithInfo>
  <div className="field-control-support">
    {fieldErrorVisible("x") && <span id="error-x" className="field-error" role="alert">{fieldErrors.x}</span>}
    {fieldAnnotation(PATH, INSTALL_CONFIG).isIntroduced && (
      <div className="field-helper" data-version-annotation="introduced">New in OpenShift {selectedMinor}</div>
    )}
    <div className="field-helper">optional range / hint text</div>
  </div>
</div>
```

The five rules this encodes (R1–R5) are normative and are specified in
`docs/DESIGN_SYSTEM.md` → **Field Supporting-Content Contract (NORMATIVE)**.
They are enforced by `frontend/tests/field-support-structure.test.jsx`, which is
data-driven over scenarios and minors, so a new field is covered automatically.

**This defect has shipped twice.** vSphere "Server" (fixed, guarded by a
single-field test) and bare-metal 4.22 `provisioningNetworkGateway` (the same
defect, on the very next new field, because the guard was hardcoded to one
field). The three things that let it through both times:

1. **"or … as appropriate"** — withdrawn. `.field-with-info-row` on its own is
   allowed *only* for a field with zero supporting content.
2. **React fragments** — `{cond ? (<>…</>) : null}` *looks* wrapped and is not.
   `<>` emits no DOM node, so every child becomes a separate `.field-grid`
   column and pushes neighbouring controls sideways.
3. **The badge had no documented home** — it is supporting content and goes in
   `.field-control-support`, with the inline error ABOVE it.

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
- [ ] **(R1)** Wrap in `<div className="field-control-stack">` whenever the field renders **any** supporting content — inline error, `New in OpenShift X.Y` badge, or helper text. A version-gated field always carries the badge, so a version-gated field **always** needs the stack. `.field-with-info-row` (via `FieldLabelWithInfo`) alone is acceptable only for a field with zero supporting content.
- [ ] **(R2)** If the field is conditionally rendered, confirm the wrapper is a real `<div className="field-control-stack">` and **not** a React fragment `<>…</>`. Search your diff for `? (` immediately followed by `<>`.
- [ ] Confirm the field does NOT appear as a direct child of `.field-grid` without that wrapper — a direct child consumes an auto-fit column and pushes neighbouring controls to the right.
- [ ] **(R5)** Confirm the `hint` opens with `"Introduced in OpenShift " + fieldIntroducedIn(path, INSTALL_CONFIG) + ". "` — read from catalog metadata, never a hardcoded minor string.

## 5. Version gating

- [ ] Gate visibility using the catalog: render only when `getCatalogForScenario(scenarioId, version)` includes the parameter with `supportStatus: "supported-ui"`.
- [ ] Use `SUPPORTED_MINORS` from `frontend/src/shared/versionPolicy.js` — no ad hoc version parsing.
- [ ] Confirm the field is hidden for versions that predate the parameter.

## 6. Validation

- [ ] Add requiredness rules consistent with the upstream contract.
- [ ] Add allowed-value validation if the parameter has a constrained domain.
- [ ] Confirm error messages appear inside `.field-control-support` whose direct parent is `.field-control-stack`, not as standalone elements and not inside the `FieldLabelWithInfo` control child.
- [ ] Confirm the error uses `className="field-error"` with `role="alert"`, plus `aria-invalid` and `aria-describedby` on the control. Do not invent a new class: `.note.error` shipped for months with no CSS rule at all and rendered neutral grey.
- [ ] Trigger the error in the running app and confirm it renders **underneath** the control in the semantic error colour — not beside it, not in body-text colour.

## 7. YAML generation

- [ ] Confirm the backend emits the parameter at the correct YAML path when the field has a value.
- [ ] Confirm the parameter is omitted from generated YAML when the field is empty or the version does not support it.
- [ ] Verify in the YAML preview drawer.

## 8. Supporting-content layout

- [ ] Place error messages, the `New in OpenShift X.Y` badge, and helper text inside **one** `.field-control-support` wrapper. **(R3)** The badge is supporting content; it is never a sibling of the field and never positioned with ad-hoc inline `style`.
- [ ] **(R4)** Confirm the band order inside `.field-control-support` is: **validation message → version badge → helper/range text.** This order is pinned; do not copy an older field that disagrees.
- [ ] Confirm supporting content flows in normal document flow (row 3 of the subgrid) — no absolute positioning.
- [ ] Confirm helper and error text coexist without overlap when both are visible.
- [ ] Confirm the field pair's between-band spacing works correctly (1.5rem minimum via `::after`).
- [ ] Confirm no neighbouring field moved horizontally when the badge and the error are both visible. If anything shifted sideways, supporting content escaped the stack.

## 9. Persistence

- [ ] Confirm the field value survives page refresh (state persistence).
- [ ] Confirm "Start Over" clears the field value.
- [ ] Confirm export bundle includes the value when present.

## 10. Automated tests

- [ ] Add an entry to `VERSION_GATED_UI_FIELD_REGISTRY` in `frontend/tests/version-gated-field-boundary.test.jsx` with `scenario`, `path`, `platform`, `method`, `introductionMinor`, `controlQuery`, `owningStep`, and optional `supportContentQuery`.
- [ ] Confirm the bidirectional catalog cross-check passes (registry matches catalog, catalog matches registry).
- [ ] Add visibility toggle test: field visible at `introductionMinor`, hidden at the previous minor.
- [ ] **Structural assertion (mandatory, non-negotiable).** `frontend/tests/field-support-structure.test.jsx` must cover the new field. It is data-driven over `SCENARIO_BY_PLATFORM_METHOD` × `SUPPORTED_MINORS` × per-platform render variants, so most fields are covered with **no test edit**. You must still:
  - [ ] Confirm the new field actually renders in at least one existing variant. If it only appears under a new mode/branch (e.g. a new provisioning mode), **add a variant to `VARIANTS`** in that file — the structural assertions themselves never change.
  - [ ] Run it and confirm zero violations.
  - [ ] **Prove the guard is live:** temporarily move the field's `.field-control-support` (or its badge) outside the `.field-control-stack`, confirm the test FAILS, then revert. A guard you have not seen fail is not a guard. The registry entry and visibility test in §10 do **not** assert structure — they passed throughout both occurrences of this defect.
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
