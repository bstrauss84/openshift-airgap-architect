/**
 * Field supporting-content structure checkers, shared by the Install
 * (field-support-structure.test.jsx) and Mirroring (mirroring-field-structure)
 * suites so both enforce ONE contract: docs/DESIGN_SYSTEM.md "Field
 * Supporting-Content Contract (NORMATIVE)", rules R1-R4.
 *
 * Pure functions over a rendered DOM subtree or a source string, so each can be
 * negative-controlled. Moved here unchanged from field-support-structure.test.jsx
 * (v2.2.0 M2); findBandOrderViolations is new (R4).
 */

/** Anything that is supporting content and must therefore never be a grid item. */
export const SUPPORT_SELECTOR = ".field-error, .field-control-support, [data-version-annotation]";

export function describeNode(el) {
  const cls = el.getAttribute("class") || "";
  const ann = el.getAttribute("data-version-annotation");
  const text = (el.textContent || "").trim().slice(0, 70);
  return `<${el.tagName.toLowerCase()} class="${cls}"${ann ? ` data-version-annotation="${ann}"` : ""}> "${text}"`;
}

/**
 * Sweep a rendered subtree for supporting content that escaped its field
 * wrapper. Returns a list of human-readable violations (empty === conformant).
 */
export function findSupportPlacementViolations(root) {
  const violations = [];

  // (a) A .field-control-support is only ever a direct child of a stack.
  for (const support of root.querySelectorAll(".field-control-support")) {
    const parent = support.parentElement;
    if (!parent || !parent.classList.contains("field-control-stack")) {
      violations.push(
        `field-control-support is not a direct child of .field-control-stack: ${describeNode(support)}`
      );
    }
  }

  // (b) Every inline validation message sits in its own field's support band.
  for (const error of root.querySelectorAll(".field-error")) {
    const support = error.closest(".field-control-support");
    if (!support) {
      violations.push(`inline .field-error is outside any .field-control-support: ${describeNode(error)}`);
      continue;
    }
    if (!support.parentElement?.classList.contains("field-control-stack")) {
      violations.push(`inline .field-error is in a support band with no .field-control-stack: ${describeNode(error)}`);
    }
  }

  // (c) Every "New in OpenShift X.Y" badge sits in its own field's support band.
  for (const badge of root.querySelectorAll("[data-version-annotation]")) {
    const support = badge.closest(".field-control-support");
    if (!support) {
      violations.push(`version annotation badge is outside any .field-control-support: ${describeNode(badge)}`);
      continue;
    }
    if (!support.parentElement?.classList.contains("field-control-stack")) {
      violations.push(`version annotation badge is in a support band with no .field-control-stack: ${describeNode(badge)}`);
    }
  }

  // (d) Nothing supporting may become an independent grid column.
  for (const grid of root.querySelectorAll(".field-grid")) {
    for (const child of Array.from(grid.children)) {
      if (child.matches(SUPPORT_SELECTOR)) {
        violations.push(
          `supporting content is a direct child of .field-grid (it will steal a column and push neighbouring fields): ${describeNode(child)}`
        );
      }
    }
  }

  return violations;
}

/**
 * Source-level companion check. A React fragment produces no DOM node, so a
 * conditionally rendered field "wrapped" in `<>...</>` leaves its support
 * content as a bare grid child — the exact idiom that broke the 4.22 gateway
 * field. This catches it even in branches no render scenario reaches.
 *
 * Rule, evaluated per fragment body: every `.field-control-support` needs a
 * `.field-control-stack` to live in, and every `.field-error` needs a
 * `.field-control-support` to live in. A fragment that carries more support
 * content than it carries wrappers is, by construction, leaking that content
 * into whatever grid encloses the fragment.
 */
export function findFragmentWrappedSupport(src) {
  const violations = [];
  const tokens = [];
  const re = /<>|<\/>/g;
  let m;
  while ((m = re.exec(src)) !== null) tokens.push({ tok: m[0], idx: m.index });

  const open = [];
  const count = (body, needle) => body.split(needle).length - 1;

  for (const { tok, idx } of tokens) {
    if (tok === "<>") {
      open.push(idx);
      continue;
    }
    const start = open.pop();
    if (start === undefined) continue;
    const body = src.slice(start, idx);
    const line = src.slice(0, start).split("\n").length;
    const stacks = count(body, 'className="field-control-stack"');
    const supports = count(body, 'className="field-control-support"');
    const errors = count(body, 'className="field-error"');

    if (supports > stacks) {
      violations.push(
        `React fragment opened at line ${line}: ${supports} .field-control-support but only ${stacks} .field-control-stack — a fragment emits no DOM node, so the support content becomes a bare .field-grid child. Use <div className="field-control-stack"> instead of <>.`
      );
    }
    if (errors > supports) {
      violations.push(
        `React fragment opened at line ${line}: ${errors} .field-error but only ${supports} .field-control-support — the inline validation message will render as its own grid column beside the field instead of underneath it.`
      );
    }
  }
  return violations;
}

/**
 * R4: inside one .field-control-support the bands are ordered
 * validation message -> version badge -> helper/range text.
 */
export function findBandOrderViolations(root) {
  const violations = [];
  const rank = (el) => {
    if (el.matches(".field-error")) return 0;
    if (el.matches("[data-version-annotation]")) return 1;
    if (el.matches(".field-helper, .note.warning")) return 2;
    return null;
  };
  for (const support of root.querySelectorAll(".field-control-support")) {
    let last = -1;
    for (const child of Array.from(support.children)) {
      const r = rank(child);
      if (r === null) continue;
      if (r < last) {
        violations.push(`support band order is not validation -> version badge -> helper: ${describeNode(child)}`);
      }
      last = Math.max(last, r);
    }
  }
  return violations;
}
