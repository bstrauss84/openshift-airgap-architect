/**
 * Regression test for SecretInput handleBlur bug (2026-05-15)
 *
 * Bug: handleBlur was using e.target.value instead of localValue,
 * causing masked field to send dots to parent onChange instead of actual value.
 *
 * Scenario:
 * 1. Field has a value (showing masked dots)
 * 2. User clicks "Show" to edit
 * 3. User types new value
 * 4. User clicks "Hide" (field becomes masked again)
 * 5. User clicks elsewhere (blur fires)
 * 6. BUG: onChange was called with dots string instead of actual value
 *
 * Fix: handleBlur now uses localValue instead of e.target.value
 *
 * Additional fix: Auto-show field when focused if there's an error
 */

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import SecretInput from "../src/components/SecretInput.jsx";

describe("SecretInput handleBlur regression", () => {
  it("should send actual value on blur, not masked dots", () => {
    const onChange = vi.fn();
    const initialValue = '{"auths": {}}';

    const { container } = render(
      <SecretInput
        value={initialValue}
        onChange={onChange}
        label="Pull secret (JSON)"
      />
    );

    const textarea = container.querySelector("textarea");
    const toggleButton = container.querySelector("button.pull-secret-toggle");

    // Initial state: field is masked, shows dots
    expect(textarea.value).toBe("••••••••••••"); // 12 dots

    // User clicks "Show" to edit
    fireEvent.click(toggleButton);
    expect(textarea.value).toBe(initialValue); // Shows actual value

    // User edits the value (types new text)
    const newValue = '{"auths": {"quay.io": {"auth": "dGVzdA=="}}}';
    fireEvent.change(textarea, { target: { value: newValue } });

    // User clicks "Hide" to mask the field again
    fireEvent.click(toggleButton);
    expect(textarea.value).toBe("••••••••••••"); // Back to masked dots

    // User clicks elsewhere (blur fires)
    fireEvent.blur(textarea);

    // CRITICAL: onChange should be called with actual value, NOT dots
    expect(onChange).toHaveBeenCalledWith(newValue);
    expect(onChange).not.toHaveBeenCalledWith("••••••••••••");
  });

  it("should not call onChange on blur if value hasn't changed", () => {
    const onChange = vi.fn();
    const value = '{"auths": {}}';

    const { container } = render(
      <SecretInput
        value={value}
        onChange={onChange}
      />
    );

    const textarea = container.querySelector("textarea");

    // User clicks into field and then blurs without changing anything
    fireEvent.focus(textarea);
    fireEvent.blur(textarea);

    // onChange should NOT be called (no change)
    expect(onChange).not.toHaveBeenCalled();
  });

  it("should auto-show field when focused if there's an error", () => {
    const onChange = vi.fn();
    const value = "invalid json";
    const errorMessage = "Pull secret must be valid JSON.";

    const { container } = render(
      <SecretInput
        value={value}
        onChange={onChange}
        errorMessage={errorMessage}
      />
    );

    const textarea = container.querySelector("textarea");
    const toggleButton = container.querySelector("button.pull-secret-toggle");

    // Initial state: field is masked, shows dots
    expect(textarea.value).toBe("••••••••••••");
    expect(textarea.readOnly).toBe(true);
    expect(toggleButton.textContent).toContain("Show");

    // User focuses the field (clicks on it to fix the error)
    fireEvent.focus(textarea);

    // Field should auto-show to allow editing
    expect(toggleButton.textContent).toContain("Hide"); // Button text changed to "Hide"
    expect(textarea.value).toBe(value); // Shows actual value
    expect(textarea.readOnly).toBe(false); // Now editable
  });

  it("should handle paste with immediate update", () => {
    const onChange = vi.fn();

    const { container } = render(
      <SecretInput
        value=""
        onChange={onChange}
      />
    );

    const textarea = container.querySelector("textarea");
    const pastedValue = '{"auths": {"cloud.openshift.com": {"auth": "test"}}}';

    // User pastes into field
    fireEvent.paste(textarea, {
      clipboardData: { getData: () => pastedValue }
    });

    // onChange should be called immediately with trimmed pasted value
    expect(onChange).toHaveBeenCalledWith(pastedValue);
  });

  it("should handle file drop with immediate update", () => {
    const onChange = vi.fn();

    const { container } = render(
      <SecretInput
        value=""
        onChange={onChange}
      />
    );

    const wrapper = container.querySelector(".pull-secret-field-wrap");
    const fileContent = '{"auths": {"registry.redhat.io": {"auth": "abc123"}}}';

    // Mock FileReader
    const mockFileReader = {
      readAsText: vi.fn(),
      onload: null,
      result: fileContent
    };
    global.FileReader = vi.fn(() => mockFileReader);

    // User drops a file
    const file = new File([fileContent], "pull-secret.json", { type: "application/json" });
    fireEvent.drop(wrapper, {
      dataTransfer: { files: [file] }
    });

    // Trigger FileReader onload
    mockFileReader.onload();

    // onChange should be called immediately with file content
    expect(onChange).toHaveBeenCalledWith(fileContent);
  });

  it("should trim value on blur", () => {
    const onChange = vi.fn();
    const initialValue = '{"auths": {}}';
    const newCleanValue = '{"auths": {"quay.io": {}}}';
    const newValueWithWhitespace = `  ${newCleanValue}  \n`;

    const { container } = render(
      <SecretInput
        value={initialValue}
        onChange={onChange}
      />
    );

    const textarea = container.querySelector("textarea");
    const toggleButton = container.querySelector("button.pull-secret-toggle");

    // User clicks "Show"
    fireEvent.click(toggleButton);

    // User types new value with whitespace
    fireEvent.change(textarea, { target: { value: newValueWithWhitespace } });

    // User blurs
    fireEvent.blur(textarea);

    // onChange should be called with trimmed NEW value (not the whitespace version)
    expect(onChange).toHaveBeenCalledWith(newCleanValue);
    expect(onChange).not.toHaveBeenCalledWith(newValueWithWhitespace);
  });

  it("should maintain localValue during Show/Hide toggles", () => {
    const onChange = vi.fn();
    const initialValue = '{"auths": {}}';

    const { container } = render(
      <SecretInput
        value={initialValue}
        onChange={onChange}
      />
    );

    const textarea = container.querySelector("textarea");
    const toggleButton = container.querySelector("button.pull-secret-toggle");

    // Show
    fireEvent.click(toggleButton);
    expect(textarea.value).toBe(initialValue);

    // User edits
    const newValue = '{"auths": {"test": {}}}';
    fireEvent.change(textarea, { target: { value: newValue } });

    // Hide
    fireEvent.click(toggleButton);
    expect(textarea.value).toBe("••••••••••••");

    // Show again
    fireEvent.click(toggleButton);

    // Should still have the edited value
    expect(textarea.value).toBe(newValue);

    // Blur should send the edited value, not initial value or dots
    fireEvent.blur(textarea);
    expect(onChange).toHaveBeenCalledWith(newValue);
  });
});
