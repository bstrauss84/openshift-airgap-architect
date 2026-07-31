# Design System — Living Document

Global design decisions for the OpenShift Airgap Architect frontend.
Update this doc whenever a new pattern is established or an existing one is revised.

---

## Product UI Contract

These contract rules govern UI structure and scope decisions:

- Keep a stable "hallway with doors" flow across scenarios. Hallway navigation stays consistent; door content is scenario-aware.
- Top-level door model remains: Identity and Access, Networking, Connectivity and Mirroring, Trust and Proxy, Platform Specifics, Hosts/Inventory, Review and Export.
- Default to a guided lane with curated fields; advanced lane is opt-in and curated.
- Prefer conditionally required fields with clear reason text when dependencies are enabled.
- Do not expand the wizard by exposing every YAML path directly as a form field.
- Stop and propose alternatives if a change conflicts with this contract.

---

## Color Palette & CSS Variables

All semantic colors are defined as CSS custom properties on `body` (light mode defaults) and overridden on `body[data-theme="dark"]`. **Never hardcode a semantic color** — use the variable.

| Variable | Light | Dark | Use |
|---|---|---|---|
| `--card-bg` | `#ffffff` | `#131e35` | Card / panel backgrounds |
| `--card-bg-subtle` | `#f9fafb` | `#1e293b` | Nested / inset backgrounds |
| `--border-color` | `#d1d5db` | `#374151` | All borders, dividers |
| `--text-subtle` | `#6b7280` | `#94a3b8` | Secondary / helper text |
| `--code-bg` | `#f0f2f5` | `#0f172a` | Inline code, pre blocks |
| `--code-color` | `#1f2937` | `#e2e8f0` | Inline code text |
| `--color-danger` | `#c00` | `#f87171` | Danger text, error states |

Page background: light `#f5f6f8` / dark `#0b1120`.
Body text: light `#1f2937` / dark `#e2e8f0`.

---

## Buttons

Use the `Button` component (`src/components/Button.jsx`). It maps `variant` → CSS class:

| `variant` | CSS class | Use |
|---|---|---|
| `"primary"` | `.primary` | Primary action (confirm, run, submit) — blue |
| `"secondary"` (default) | `.ghost` | Secondary / neutral actions |
| `"destructive"` | `.danger` | Destructive actions (delete, stop) |

- Never use raw `<button className="primary">` outside components — use `<Button variant="primary">`.
- Buttons are **inline / auto-width** by default. They expand to full-width inside `flex-direction: column` containers (e.g., `.card-body`). Wrap in a `<div style={{ display: "flex", gap: 8 }}>` or the `.actions` class to keep them inline.

### Dark mode button states

| State | Light | Dark |
|---|---|---|
| `.primary` | `#2563eb` bg, white text | same |
| `.primary:hover` | `#1d4ed8` | same |
| `.primary:disabled` | `#93c5fd` bg, `#1e3a8a` text | `#1e3a8a` bg, `#93c5fd` text (inverted) |
| `.danger:disabled` | `#fecaca` bg, `#7f1d1d` text | `#7f1d1d` bg, `#fca5a5` text (inverted) |
| `.ghost` | `#F0F3F7` bg, `#111827` text | `#111827` bg, `#e5e7eb` text |

---

## Cards

```html
<section class="card">
  <div class="card-header">
    <h3 class="card-title">Title</h3>
    <div class="card-subtitle">Short subtitle text.</div>
  </div>
  <div class="card-body">
    <!-- content -->
  </div>
</section>
```

`.card-body` is `display: flex; flex-direction: column; gap: 12px`. Children expand to full width unless wrapped in a flex row.

---

## Notes / Callouts

```html
<div class="note">         <!-- neutral info -->
<div class="note warning"> <!-- amber warning -->
<div class="note subtle">  <!-- low-emphasis text -->
```

All note variants use CSS variables and have corresponding dark mode styles — use class names, never hardcoded colors.

---

## Modals

Use `.modal-backdrop` + `.modal` for all overlay dialogs:

```jsx
<div className="modal-backdrop" role="dialog" aria-modal="true">
  <div className="modal">
    <h3>Title</h3>
    <p className="modal-copy subtle">Description.</p>
    <dl className="modal-summary">
      <dt>Label</dt><dd>Value</dd>
    </dl>
    <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
      <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      <Button variant="primary" onClick={onConfirm}>Confirm</Button>
    </div>
  </div>
</div>
```

`.modal` has dark mode styles. Do not use inline background colors inside modals — rely on the class.

---

## Pull Secret / Credential Fields

Always use the `SecretInput` component (`src/components/SecretInput.jsx`) for any field containing credentials or secrets. It provides:
- Masked by default (dots), show/hide toggle
- Drag-and-drop support
- File upload button
- Consistent label + helper text placement

```jsx
<SecretInput
  label="Red Hat pull secret"
  labelHint="Tooltip text shown via (i) icon."
  value={value}
  onChange={setValue}
  placeholder="Paste, drag and drop, or upload…"
  rows={4}
/>
```

**Never use a plain `<textarea>` for secrets.**

---

## Dividers

```html
<div class="divider" />
```

Light: `#e5e7eb`. Dark: `#374151`. Do not use `<hr>` or inline `border-top`.

---

## Advanced Options — Compact Grid Layout

For sections containing multiple short-value fields (dropdowns, small number inputs, short text inputs), use a 3-column grid to avoid wasting horizontal space:

```jsx
<div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px 16px", alignItems: "end" }}>
  <FieldLabelWithInfo label="Log level" hint="…">
    <select>…</select>
  </FieldLabelWithInfo>
  <FieldLabelWithInfo label="Parallel images" hint="…">
    <input type="number" … />
  </FieldLabelWithInfo>
  {/* … */}
</div>
```

Toggle/switch rows (OptionRow with Switch) span full width above the grid — do not put them inside the grid.

---

## Browse Directory Modal (inline)

The browse modal in RunOcMirrorStep uses inline styles with CSS variables:
- Background: `var(--card-bg)`
- Borders: `var(--border-color)`
- Subtle text: `var(--text-subtle)`
- Code paths: `var(--code-bg)` / `var(--code-color)`
- Navigation "↑ Up" button: use `className="ghost"` (NOT `"btn btn-ghost"` — that class does not exist)
- Action buttons: `<Button variant="ghost">Cancel</Button>` and `<Button variant="primary">Select</Button>`

---

## Run/Completion Flow — oc-mirror

When an oc-mirror job transitions to `completed`, `failed`, or `cancelled`, a `.modal-backdrop` completion modal is shown automatically (regardless of active tab). Content differs by outcome:

- **Completed:** summary (workflow, elapsed, archive dir), next-step instructions per mode
- **Failed/Cancelled:** error message from `job.message`, link to Operations logs

The "Include mirror output in export bundle" toggle has been removed — archive sizes (50–200 GB+) make browser-download export impractical. Users are directed to the archive directory in the completion modal.

---

## Links (dark mode)

| State | Dark color |
|---|---|
| default | `#93c5fd` |
| visited | `#a5b4fc` |
| hover | `#bfdbfe` |
| focus | outline `#60a5fa` |

---

## OptionRow Groups (workflow selection)

When logically related options should be visually grouped without a selectable header:

```jsx
<div>
  <div style={{
    borderLeft: isActive ? "3px solid #3b82f6" : "3px solid transparent",
    paddingLeft: 10, marginBottom: 6
  }}>
    <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>Group Label</div>
    <div style={{ fontSize: "0.8rem", color: "var(--text-subtle)", fontStyle: "italic" }}>Description.</div>
  </div>
  <div style={{ paddingLeft: 12 }}>
    {modes.map(m => <OptionRow key={m.value} …/>)}
  </div>
</div>
```

The left-border accent (`#3b82f6`) activates on the group containing the currently selected option.

---

## Paired-Field Layout (Platform Specifics)

Platform Specifics fields use a CSS Grid subgrid pattern that aligns labels, controls, and supporting content across paired columns.

### Base layout

`.field-grid` uses `grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))` with `align-items: start`. Each grid item is a `.field-with-info-row` (from `FieldLabelWithInfo`) or a `.field-control-stack` (for multi-part controls like select + helper).

### Subgrid (3-row pattern)

Inside `@supports (grid-template-rows: subgrid)`:

- `.field-grid` switches to `grid-template-rows: auto auto auto` with `row-gap: 0`.
- Each field item spans 3 rows via `grid-row: span 3` and participates in `grid-template-rows: subgrid`.
  - **Row 1** — label
  - **Row 2** — control (input, select, etc.)
  - **Row 3** — supporting content (helper text, errors, warnings)
- `::after` pseudo-elements on each field item provide `min-height: 1.5rem` between-band spacing.
- When row 3 content exceeds 1.5rem, it grows dynamically and pushes following content down.

### Supporting content (`.field-control-support`)

Error messages, helper text, and warnings live inside a `.field-control-support` wrapper in normal document flow (row 3 of the subgrid). **Never use absolute positioning** for supporting content — it prevents dynamic height expansion and causes overlaps with content below.

### `.field-control-stack`

Groups a control with its supporting content. Inside the subgrid, it uses `display: grid; grid-row: span 3; grid-template-rows: subgrid` with `display: contents` on its inner `.field-with-info-row` to expose label/control to the parent grid.

### `label:has(> .field-with-info-row)`

Outer `<label>` wrappers use `display: contents` so the inner `.field-with-info-row` becomes the grid participant directly.

---

## Version-Aware Parameter Fields

Fields whose visibility depends on the selected OpenShift minor version. These fields appear only when the user selects a version that includes them in the scenario catalog.

### Catalog-driven visibility

Each scenario has per-version catalogs at `frontend/src/data/catalogs/<version>/<scenario>.json`. A field is visible when its parameter appears in the catalog for the user's selected version with `supportStatus: "supported-ui"`. Catalog entries also carry `minVersion` and `maxVersion` for version-range gating. Use `getCatalogForScenario(scenarioId, version)` from `frontend/src/catalogPaths.js` to load the parameter array.

### Version authority

Two distinct concepts govern version-aware fields:

**Product support policy:** `SUPPORTED_MINORS` from `frontend/src/shared/versionPolicy.js` defines which OpenShift minors the application currently supports (currently `["4.20", "4.21"]`). This is not the user's selected version — it is the set of versions the tool can serve.

**Canonical selected-version state:** `state.version.selectedMinor`, `state.version.selectedPatch`, and `state.version.locked` are the authoritative representation of the user's chosen version. `state.release` is backward-compatibility only and is never authoritative over the complete `state.version` object. Stale `selectedMinor` was the root cause of the visibility defect repaired in `310c0c8`.

All version parsing and comparison must use `shared/versionUtils.js`, `shared/catalogVersion.js`, or `shared/versionHelpers.js` — no ad hoc parsers.

### Version helper text rules

When a field appears only in newer versions, display a helper note indicating the version context. Use `FieldLabelWithInfo` `hint` for tooltip explanations. Error and helper text coexist inside `.field-control-support`; they are not mutually exclusive.

### Visibility test contract

Every version-gated UI field must have an entry in `VERSION_GATED_UI_FIELD_REGISTRY` (in `frontend/tests/version-gated-field-boundary.test.jsx`) with:

- `scenario` — catalog scenario ID (e.g., `"aws-govcloud-ipi"`)
- `path` — catalog parameter path (e.g., `"controlPlane.platform.aws.rootVolume.throughput"`)
- `platform` — display platform name (e.g., `"AWS GovCloud"`)
- `method` — install method (e.g., `"IPI"`)
- `introductionMinor` — the minor version that introduced this field (e.g., `"4.21"`)
- `controlQuery` — regex matching the field's label text
- `owningStep` — the step component that renders this field
- `supportContentQuery` (optional) — regex matching expected support content

Bidirectional catalog cross-checks enforce:

1. Every catalog entry with `supportStatus: "supported-ui"` and `minVersion` above the baseline supported minor has a registry entry.
2. Every registry entry has a matching catalog parameter with `supportStatus: "supported-ui"`.

### State retention

When a field becomes inapplicable because of a version or scenario change, preserve its state unless that field's established state-transition contract explicitly requires clearing. Hidden retained state must never leak into inapplicable generated output. Returning to an applicable state restores the retained value when retention is the defined behavior. For the currently implemented AWS throughput and Azure shared-key fields, retention is expected.

### Field layout contract

Version-gated fields participate in the same paired-field layout as all other Platform Specifics fields. They must:

- Use `.field-with-info-row` or `.field-control-stack` wrappers
- Not appear as direct children of `.field-grid` without proper wrappers
- Place all supporting content inside `.field-control-support`
- Not introduce layout shifts when toggling visibility

### Responsive verification

Version-gated fields must follow the same responsive rules as other fields: graceful column reduction at narrower viewports, readable widths maintained, labels and inputs aligned. Test at desktop (1920px+), laptop (1366px), tablet (768px), and mobile (375px).
