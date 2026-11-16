/**
 * OpenShift Airgap Architect - Drag-and-drop copy semantics for text fields
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * Request COPY semantics for text dragged into any OAA text-entry field.
 *
 * WHY. Dragging a selected pull secret out of a desktop text editor and into
 * the Blueprint field inserted it correctly but DELETED it from the source
 * document — the drag had been negotiated as a move. There is no workflow in
 * this product where dropping text into a form field should mean "remove this
 * from the application it came from", and the consequence is worst exactly
 * where it is most likely to happen: a credential the user may not have
 * written down anywhere else.
 *
 * `SecretInput` already asked for copy on its own wrapper, but it is one
 * component. Every plain `<input type="password">` — BMC, vCenter, Prism
 * Central, the mirror-registry helper — had no drag handling at all and fell
 * through to whatever the browser and the source application negotiated
 * between them. A policy installed once at the document covers those, and
 * covers fields nobody has written yet.
 *
 * WHAT THIS CAN AND CANNOT DO — the honest boundary. The drag SOURCE declares
 * `effectAllowed` when the drag starts, and the target may only choose from
 * what the source permits. If a native application advertises move-only, no
 * web page can force a copy; the HTML drag-and-drop model resets a
 * `dropEffect` that is not permitted. So this asks for copy whenever copy is
 * on offer, and otherwise leaves the negotiation exactly as it found it. It
 * never asks for "move".
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH:
 *  - File payloads. The PEM and pull-secret file drop zones have their own
 *    intentional contract; a drag carrying Files is ignored entirely here.
 *  - Drop eligibility. This never calls `preventDefault()`, so it cannot make
 *    a non-drop-target accept a drop, and cannot suppress a component's own
 *    drop handling.
 *  - Clipboard, typing, autofill, selection and accessibility, none of which
 *    involve `DataTransfer`.
 */

/** Input types that hold user-entered text a drop could land in. */
const TEXT_INPUT_TYPES = new Set([
  "text",
  "password",
  "search",
  "url",
  "tel",
  "email",
  "number",
  ""
]);

/**
 * `effectAllowed` values that permit a copy. `uninitialized` means the source
 * expressed no restriction, which the spec treats as all effects allowed.
 */
const COPY_PERMITTED = new Set(["copy", "copyLink", "copyMove", "all", "uninitialized"]);

/** True when `node` is somewhere a user types text. */
function isTextEntryTarget(node) {
  let el = node;
  // A drag can land on a text node or on a span inside a contenteditable.
  if (el && el.nodeType === 3) el = el.parentElement;
  while (el && el.nodeType === 1) {
    const tag = el.tagName;
    if (tag === "TEXTAREA") return true;
    if (tag === "INPUT") {
      const type = String(el.getAttribute("type") || "text").toLowerCase();
      return TEXT_INPUT_TYPES.has(type);
    }
    if (el.isContentEditable) return true;
    el = el.parentElement;
  }
  return false;
}

/** True when the drag carries files rather than text. */
function carriesFiles(dataTransfer) {
  const types = dataTransfer?.types;
  if (!types) return false;
  // `types` is a DOMStringList in some engines and an array in others.
  return Array.from(types).includes("Files");
}

/**
 * Decide the dropEffect for one drag event.
 *
 * Exported separately from the listener so the decision is unit-testable
 * without a DOM drag, and so the "never request move" property can be
 * asserted directly rather than inferred.
 *
 * @returns {"copy"|null} "copy" to request copy, null to leave untouched
 */
export function resolveTextDropEffect(target, dataTransfer) {
  if (!dataTransfer) return null;
  if (carriesFiles(dataTransfer)) return null;
  if (!isTextEntryTarget(target)) return null;
  const allowed = String(dataTransfer.effectAllowed || "uninitialized");
  // A source that permits only move cannot be talked into a copy. Asking
  // anyway would be reset by the user agent and would misrepresent what
  // happened, so leave the negotiation alone.
  if (!COPY_PERMITTED.has(allowed)) return null;
  return "copy";
}

/**
 * Install the policy. Idempotent; returns a function that removes it.
 *
 * Listens in the CAPTURE phase on both `dragenter` and `dragover`: the user
 * agent reads `dropEffect` from the last of those it saw, and capture runs
 * before a component's own handler so a component may still override.
 *
 * @param {Document|HTMLElement} root
 * @returns {() => void} uninstall
 */
export function installTextDropCopyPolicy(root = document) {
  if (!root || typeof root.addEventListener !== "function") return () => {};
  if (root.__oaaTextDropCopyPolicy) return root.__oaaTextDropCopyPolicy;

  const handler = (event) => {
    const effect = resolveTextDropEffect(event.target, event.dataTransfer);
    if (!effect) return;
    try {
      event.dataTransfer.dropEffect = effect;
    } catch {
      // Some engines expose dropEffect as read-only outside a drag context.
      // Failing to influence the hint is not worth breaking the drag over.
    }
  };

  root.addEventListener("dragenter", handler, true);
  root.addEventListener("dragover", handler, true);

  const uninstall = () => {
    root.removeEventListener("dragenter", handler, true);
    root.removeEventListener("dragover", handler, true);
    delete root.__oaaTextDropCopyPolicy;
  };
  root.__oaaTextDropCopyPolicy = uninstall;
  return uninstall;
}
