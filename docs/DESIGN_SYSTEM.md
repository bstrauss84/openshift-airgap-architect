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
