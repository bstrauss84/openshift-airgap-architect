# UI Standardization Guide
**OpenShift Airgap Architect - Frontend Design Patterns**

**Last Updated:** 2026-05-09  
**Status:** Living document - update as patterns evolve

---

## Overview

This guide documents the UI/UX patterns, spacing conventions, component usage, and design decisions for the OpenShift Airgap Architect frontend. The goal is to maintain visual consistency and predictable user experience across all steps.

---

## Design Philosophy

**Key principles:**
- **Consistency over novelty** - Reuse established patterns rather than inventing new ones
- **Responsive by default** - All layouts must gracefully adapt to different screen sizes
- **Accessibility first** - Proper ARIA labels, semantic HTML, keyboard navigation
- **Information density** - Balance between showing enough context and avoiding clutter
- **No unnecessary emojis** - Clean, professional aesthetic

---

## Reference Implementation: Azure Platform Specifics

The **Azure Government IPI** section in `PlatformSpecificsStep.jsx` is considered the gold standard for field layout, spacing, and organization. Use it as a reference when implementing new sections.

**What makes it great:**
- Perfect spacing between field labels and inputs
- Proper buffer/gap between fields in a row (1rem)
- Automatic wrapping to next row when zoomed/resized
- Consistent font sizing and hierarchy
- Clean, scannable layout

---

## Layout Patterns

### 1. Field Grid (Standard Multi-Column Form)

**Use for:** Platform-specific configs, advanced options, most form sections

**CSS Class:** `.field-grid`

**Behavior:**
- Responsive grid that auto-fills columns based on available space
- Minimum column width: 220px
- Fields automatically wrap to next row when space is constrained
- Gap between fields: 1rem (16px)
- All fields align to top (`align-items: start`)

**Example:**
```jsx
<div className="field-grid">
  <FieldLabelWithInfo
    label="Cloud name"
    hint="Tooltip text here..."
    required
  >
    <select value={value} onChange={handler}>
      <option>Option 1</option>
    </select>
  </FieldLabelWithInfo>
  
  <FieldLabelWithInfo
    label="Region"
    hint="Tooltip text here..."
  >
    <input value={value} onChange={handler} placeholder="e.g. usgovvirginia" />
  </FieldLabelWithInfo>
</div>
```

**CSS Definition:**
```css
.field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 1rem;
  margin-top: 0.75rem;
  align-items: start;
  width: 100%;
}
```

---

### 2. Constrained Credential Fields

**Use for:** Pull secrets, SSH keys, sensitive textarea inputs that should not span full width

**CSS Class:** `.credentials-field-constrained`

**Behavior:**
- Max width: 700px (~50% of typical card width)
- Matches Blueprint tab pull secret layout
- Still responsive on smaller screens

**Example:**
```jsx
<div className="credentials-field-constrained">
  <SecretInput
    value={pullSecret}
    onChange={handler}
    label="Pull secret (Red Hat)"
    labelEmphasis="Paste, drag and drop, or upload..."
    required
    rows={5}
  />
</div>
```

**CSS Definition:**
```css
.credentials-field-constrained {
  max-width: 700px;
  width: 100%;
}

.credentials-field-constrained textarea {
  width: 100%;
}
```

---

### 3. Field Width Classes (Short/Medium Inputs)

**Use for:** Numeric inputs, short text fields, timeouts, ports

**Short fields** (`.field-short`):
- Max width: 180px container, 140px input
- Use for: counts, retry values, small numbers

**Medium fields** (`.field-medium`):
- Max width: 220px container, 200px input
- Use for: timeouts, delays, medium-length text

**Example:**
```jsx
<div className="field-grid">
  <div className="field-short">
    <label>
      Retry count
      <input type="number" value={count} onChange={handler} />
    </label>
  </div>
  
  <div className="field-medium">
    <label>
      Timeout (seconds)
      <input type="number" value={timeout} onChange={handler} />
    </label>
  </div>
</div>
```

---

## Spacing & Hierarchy

### Card Structure

**Standard card with header:**
```jsx
<section className="card">
  <div className="card-header">
    <div>
      <h3 className="card-title">Section Title</h3>
      <div className="card-subtitle">Brief description of what this section contains.</div>
    </div>
  </div>
  <div className="card-body">
    {/* Content here */}
  </div>
</section>
```

**Spacing values:**
- Between card header and body: Auto (handled by `.card-body`)
- Between fields in grid: `gap: 1rem` (16px)
- Between label and input: `4-6px` (handled by component)
- Between sections: `1.5rem` (24px)

---

### Label & Input Spacing

**Vertical spacing within a field:**
1. **Label** → 4-6px gap → **Input**
2. **Input** → 8px gap → **Helper text/error**

**FieldLabelWithInfo pattern:**
```jsx
<FieldLabelWithInfo
  label="Field Label"
  hint="Detailed tooltip content with full context"
  required  // Shows (required) indicator
>
  <input value={value} onChange={handler} />
</FieldLabelWithInfo>
```

**Benefits:**
- Info icon stays aligned with label text
- Consistent tooltip behavior across all fields
- Auto-manages required indicators
- Proper ARIA attributes

---

## Component Usage

### SecretInput (Pull Secrets)

**Always use `SecretInput` for:**
- Red Hat pull secrets
- Mirror registry pull secrets
- Any JSON credential inputs

**Features:**
- Masked by default with Show/Hide toggle
- Drag & drop support
- File upload support
- Paste detection
- Consistent layout everywhere

**Standard props:**
```jsx
<SecretInput
  value={secret}
  onChange={handler}
  label="Pull secret (Red Hat)"
  labelEmphasis="Action-oriented label text"
  labelHint="Detailed tooltip with full context"
  getPullSecretUrl="https://..."  // Optional: Shows "Access/download" link
  required={boolean}
  rows={5}
  placeholder='{"auths":{...}}'
  aria-label="Descriptive label for screen readers"
/>
```

---

### FieldLabelWithInfo (Labels with Tooltips)

**Always use for fields with explanatory content:**

**Pattern:**
```jsx
<FieldLabelWithInfo
  label="Short field label"
  hint={`Multi-line tooltip with:
- Context about what this field does
- Why it matters
- Examples
- Important caveats with ⚠️ prefix`}
  required={boolean}
>
  <input />
</FieldLabelWithInfo>
```

**Tooltip guidelines:**
- Start with "What this is"
- Add "Why it matters"
- Include examples
- Warn about gotchas with ⚠️
- Use markdown formatting (bold, bullets, code blocks)
- No emojis except ⚠️ for warnings

---

### Switch Component

**Use for:** Boolean toggles, feature flags, on/off settings

**Pattern:**
```jsx
<div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
  <span>Feature name</span>
  <Switch
    checked={value}
    onChange={handler}
    aria-label="Descriptive label"
  />
</div>
```

**Don't use checkboxes for simple on/off toggles** - use Switch instead for better visual clarity.

---

## Color & Visual Hierarchy

### Semantic Colors

**Notes/Banners:**
- `.note` - Default informational (gray)
- `.note.warning` - Warning/attention needed (yellow/orange)
- `.note.note-prominent` - Important info to highlight (slightly bolder)

**Validation:**
- `.input-error` - Red border on invalid inputs
- Pair with `.note.warning` below the field for error message

**Example:**
```jsx
<input
  className={hasError ? "input-error" : ""}
  aria-invalid={hasError ? "true" : "false"}
  aria-describedby={hasError ? "field-error" : undefined}
/>
{hasError && (
  <div id="field-error" className="note warning" role="alert">
    Error message here
  </div>
)}
```

---

## Typography

### Headings

- **Card title:** `<h3 className="card-title">` - Main section heading
- **Card subtitle:** `<div className="card-subtitle">` - Brief description
- **Field labels:** Regular `<label>` or via `FieldLabelWithInfo`

### Font Sizing

- Body text: Base font size (inherited)
- Card subtitles: Slightly smaller, muted color
- Helper text (`.note`): 0.875rem (14px)
- Monospace (code/secrets): 0.8125rem (13px)

---

## Responsive Behavior

### Breakpoints

**Mobile (≤640px):**
- Grid collapses to single column
- Pull secret layout stacks vertically
- Reduced padding/margins

**Tablet (≤900px):**
- Field grid reduces to 2 columns
- Some side-by-side layouts stack

**Desktop (>900px):**
- Full grid layout
- Multi-column field grids
- Side-by-side pull secret layout

### Testing Responsiveness

**Always test:**
1. Full desktop width (1920px+)
2. Laptop width (1366px)
3. Tablet width (768px)
4. Mobile width (375px)

**Field grid should:**
- Never break layout at any width
- Gracefully reduce columns as space narrows
- Maintain readable field widths
- Keep labels and inputs aligned

---

## Accessibility

### Required Fields

**Always indicate required fields:**
```jsx
<label>
  Field Name
  {required && <span className="required-indicator"> (required)</span>}
</label>
```

### ARIA Attributes

**Form inputs:**
```jsx
<input
  aria-required={required ? "true" : "false"}
  aria-invalid={hasError ? "true" : "false"}
  aria-describedby={hasError ? "error-id" : helperId}
  aria-label="Descriptive label when label text isn't sufficient"
/>
```

**Error messages:**
```jsx
<div id="error-id" className="note warning" role="alert">
  Error message
</div>
```

### Keyboard Navigation

- All interactive elements must be keyboard-accessible
- Modal close on Escape key
- Logical tab order
- Focus indicators visible

---

## Common Patterns

### Mirror Registry Toggle Pattern

**Used in:** IdentityAccessStep, GlobalStrategyStep

**Pattern:**
```jsx
<div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
  <span>Using a mirror registry?</span>
  <Switch checked={using} onChange={handler} />
</div>

{using && (
  <div className="note">
    Explanation of what happens when enabled
  </div>
)}
```

---

### Conditional Field Visibility

**Show/hide fields based on catalog metadata:**

```jsx
const showField = catalogParams.some(
  (p) => p.path === "platform.aws.region" && p.outputFile === INSTALL_CONFIG
);

{showField && (
  <FieldLabelWithInfo label="Region" hint="...">
    <input />
  </FieldLabelWithInfo>
)}
```

---

### Generate/Help Buttons

**Pattern for credential helpers:**
```jsx
<div className="actions">
  <button type="button" className="ghost" onClick={openHelper}>
    Help me generate
  </button>
</div>
```

**Classes:**
- `.ghost` - Secondary action, less prominent
- `.primary` - Main call-to-action
- `.actions` - Container for action buttons (right-aligned, proper spacing)

---

## Don'ts

❌ **Don't:**
- Use emojis in UI text (except ⚠️ for warnings)
- Create new layout patterns when existing ones work
- Mix grid systems (stick to `.field-grid`)
- Use inline styles excessively (add to CSS instead)
- Make fields full-width unless truly needed (use constraints)
- Skip ARIA attributes on form fields
- Forget to test mobile/tablet layouts

✅ **Do:**
- Reuse established components (`FieldLabelWithInfo`, `SecretInput`, etc.)
- Follow the Azure section's spacing/layout
- Add helpful tooltips with context
- Constrain field widths appropriately
- Test at multiple screen sizes
- Maintain semantic HTML structure

---

## File Organization

**Key files:**
- `src/styles.css` - All global styles, layout classes
- `src/components/FieldLabelWithInfo.jsx` - Standard label+tooltip component
- `src/components/SecretInput.jsx` - Pull secret input component
- `src/components/Switch.jsx` - Toggle switch component
- `src/steps/PlatformSpecificsStep.jsx` - Reference implementation (Azure section)

**When adding new patterns:**
1. Check if existing pattern can be reused
2. If new class needed, add to `styles.css` with descriptive name
3. Document pattern here
4. Update this guide's "Last Updated" date

---

## Quick Reference

### Common Class Names

| Class | Use Case | Max Width | Behavior |
|-------|----------|-----------|----------|
| `.field-grid` | Multi-column form layout | 100% | Auto-fill, wraps to rows |
| `.field-short` | Numeric inputs | 180px | Fixed small width |
| `.field-medium` | Timeout/delay inputs | 220px | Fixed medium width |
| `.credentials-field-constrained` | Pull secrets, SSH keys | 700px | Constrained textarea width |
| `.card` | Section container | 100% | Standard card styling |
| `.note` | Helper text | - | Informational text |
| `.note.warning` | Error/warning | - | Warning styling |
| `.actions` | Button container | - | Right-aligned buttons |

### Common Components

| Component | Import From | Use For |
|-----------|-------------|---------|
| `FieldLabelWithInfo` | `components/FieldLabelWithInfo` | Labels with tooltips |
| `SecretInput` | `components/SecretInput` | Pull secrets, credentials |
| `Switch` | `components/Switch` | Boolean toggles |
| `Banner` | `components/Banner` | Alert messages |
| `Button` | `components/Button` | Standard buttons |
| `CollapsibleSection` | `components/CollapsibleSection` | Expandable sections |

---

## Future Considerations

**Potential improvements:**
- Create a Storybook for component documentation
- Add visual regression testing
- Document animation/transition patterns
- Standardize modal/dialog patterns
- Create theme/color token system

---

**Maintainers:** Update this guide when adding new UI patterns  
**Questions?** Check existing implementations in `PlatformSpecificsStep.jsx` (Azure section) as reference
