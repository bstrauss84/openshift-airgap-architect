/**
 * Tests for useAutoSelect hook
 *
 * Verifies auto-select behavior for input fields with default values
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAutoSelect } from "../src/hooks/useAutoSelect.js";

describe("useAutoSelect", () => {
  it("should return onFocus handler and reset function", () => {
    const { result } = renderHook(() => useAutoSelect("test-value"));

    expect(result.current).toHaveProperty("onFocus");
    expect(result.current).toHaveProperty("reset");
    expect(typeof result.current.onFocus).toBe("function");
    expect(typeof result.current.reset).toBe("function");
  });

  it("should auto-select text on first focus when value exists", () => {
    const { result } = renderHook(() => useAutoSelect("default-value"));

    const mockEvent = {
      target: {
        select: vi.fn(),
      },
    };

    act(() => {
      result.current.onFocus(mockEvent);
    });

    expect(mockEvent.target.select).toHaveBeenCalledTimes(1);
  });

  it("should not auto-select on subsequent focus after first touch", () => {
    const { result } = renderHook(() => useAutoSelect("default-value"));

    const mockEvent = {
      target: {
        select: vi.fn(),
      },
    };

    // First focus - should select
    act(() => {
      result.current.onFocus(mockEvent);
    });
    expect(mockEvent.target.select).toHaveBeenCalledTimes(1);

    // Second focus - should NOT select
    act(() => {
      result.current.onFocus(mockEvent);
    });
    expect(mockEvent.target.select).toHaveBeenCalledTimes(1); // Still 1, not 2
  });

  it("should not auto-select when value is empty", () => {
    const { result } = renderHook(() => useAutoSelect(""));

    const mockEvent = {
      target: {
        select: vi.fn(),
      },
    };

    act(() => {
      result.current.onFocus(mockEvent);
    });

    expect(mockEvent.target.select).not.toHaveBeenCalled();
  });

  it("should reset touched state when reset is called", () => {
    const { result } = renderHook(() => useAutoSelect("default-value"));

    const mockEvent = {
      target: {
        select: vi.fn(),
      },
    };

    // First focus - should select
    act(() => {
      result.current.onFocus(mockEvent);
    });
    expect(mockEvent.target.select).toHaveBeenCalledTimes(1);

    // Reset the touched state
    act(() => {
      result.current.reset();
    });

    // Focus again - should select again after reset
    act(() => {
      result.current.onFocus(mockEvent);
    });
    expect(mockEvent.target.select).toHaveBeenCalledTimes(2);
  });

  it("should handle value changes correctly", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useAutoSelect(value),
      { initialProps: { value: "initial" } }
    );

    const mockEvent = {
      target: {
        select: vi.fn(),
      },
    };

    // Focus with initial value
    act(() => {
      result.current.onFocus(mockEvent);
    });
    expect(mockEvent.target.select).toHaveBeenCalledTimes(1);

    // Change value
    rerender({ value: "updated" });

    // Focus again - should NOT auto-select (touched state persists across value changes)
    act(() => {
      result.current.onFocus(mockEvent);
    });
    expect(mockEvent.target.select).toHaveBeenCalledTimes(1); // Still 1

    // But after reset, should auto-select with new value
    act(() => {
      result.current.reset();
    });

    act(() => {
      result.current.onFocus(mockEvent);
    });
    expect(mockEvent.target.select).toHaveBeenCalledTimes(2);
  });
});
