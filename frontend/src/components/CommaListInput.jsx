/**
 * OpenShift Airgap Architect - CommaListInput
 *
 * Controlled text input for comma-delimited list fields.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React from "react";

/** Normalize comma-delimited text into a clean list (no blanks, no stray whitespace). */
export function parseCommaList(text) {
  if (Array.isArray(text)) return text.map((s) => String(s).trim()).filter(Boolean);
  return String(text ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function toText(value, separator) {
  if (Array.isArray(value)) return value.join(separator);
  return value ?? "";
}

function sameList(a, b) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * Keeps the user's raw text as the displayed value so editing is never fought
 * by normalization. Re-deriving the input from `list.join(", ")` on every
 * keystroke re-adds separator characters the user just deleted, which makes
 * Backspace a no-op at comma boundaries and strips spaces inside item names.
 * Normalization is therefore deferred to blur; the parsed list is still
 * committed on every keystroke so live consumers (YAML preview) stay current.
 */
export function useCommaListInput(value, onCommit, { separator = ", " } = {}) {
  const [draft, setDraft] = React.useState(() => toText(value, separator));
  const draftRef = React.useRef(draft);
  draftRef.current = draft;

  const incomingList = parseCommaList(value);
  const incomingKey = incomingList.join("\u0000");

  React.useEffect(() => {
    // Keep the in-progress draft whenever it already means the same list, so
    // transient trailing/double commas and interior spaces survive editing.
    if (sameList(parseCommaList(draftRef.current), incomingList)) return;
    setDraft(toText(value, separator));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingKey]);

  return {
    value: draft,
    onChange: (e) => {
      const text = e?.target?.value ?? "";
      setDraft(text);
      onCommit(parseCommaList(text));
    },
    onBlur: () => {
      const list = parseCommaList(draftRef.current);
      setDraft(list.join(separator));
      onCommit(list);
    }
  };
}

/**
 * Input bound to a comma-delimited list. `onCommit` receives the normalized
 * array. Safe to render inside lists because the hook lives in this component.
 */
export default function CommaListInput({ value, onCommit, separator = ", ", ...rest }) {
  const bind = useCommaListInput(value, onCommit, { separator });
  return <input {...rest} {...bind} />;
}
