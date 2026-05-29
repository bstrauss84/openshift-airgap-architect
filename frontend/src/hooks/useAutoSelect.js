/**
 * Custom hook for auto-selecting input text on first focus
 *
 * Enables quick replacement of pre-populated default values by automatically
 * selecting the text when the user first focuses the field. Once the user has
 * edited the field, subsequent focuses do not auto-select.
 *
 * @param {string} value - The current value of the input field
 * @returns {Object} - Contains onFocus handler and reset function
 *
 * @example
 * const { onFocus, reset } = useAutoSelect(localValue);
 *
 * // In your input:
 * <input
 *   value={localValue}
 *   onChange={(e) => {
 *     setLocalValue(e.target.value);
 *     // Don't need to manually track touched state
 *   }}
 *   onFocus={onFocus}
 * />
 *
 * // Reset when external value changes:
 * useEffect(() => {
 *   setLocalValue(externalValue);
 *   reset();
 * }, [externalValue, reset]);
 */

import { useState, useCallback } from "react";

export function useAutoSelect(value) {
  const [touched, setTouched] = useState(false);

  const onFocus = useCallback(
    (e) => {
      // Auto-select pre-populated default value on first focus
      if (!touched && value) {
        e.target.select();
        setTouched(true);
      }
    },
    [touched, value]
  );

  const reset = useCallback(() => {
    setTouched(false);
  }, []);

  return { onFocus, reset };
}
