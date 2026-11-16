import React, { useEffect, useRef } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { AppProvider, useApp } from "../src/store.jsx";
import { apiFetch } from "../src/api.js";

function StateDriver({ onReady }) {
  const { state, updateState } = useApp();
  const readyRef = useRef(false);
  useEffect(() => {
    if (state && !readyRef.current) {
      readyRef.current = true;
      onReady({ state, updateState });
    }
  }, [state]);
  return null;
}

function makeHydrationResponse() {
  return {
    ok: true,
    json: () => Promise.resolve({ version: { selectedMinor: "4.21" }, blueprint: {} }),
  };
}

describe("store persistence — expected abort vs genuine failure", () => {
  let consoleErrorSpy;
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    consoleErrorSpy.mockRestore();
    localStorage.clear();
    vi.useRealTimers();
  });

  it("superseded save: aborted persistence produces no logError; newest save completes", async () => {
    const postBodies = [];

    globalThis.fetch = vi.fn((url, opts) => {
      if (!opts?.method || opts.method === "GET") {
        return Promise.resolve(makeHydrationResponse());
      }
      postBodies.push(JSON.parse(opts.body));
      const postIndex = postBodies.length;
      return new Promise((resolve, reject) => {
        if (opts.signal?.aborted) {
          reject(new DOMException("signal is aborted without reason", "AbortError"));
          return;
        }
        if (postIndex === 1) {
          opts.signal?.addEventListener("abort", () => {
            reject(new DOMException("signal is aborted without reason", "AbortError"));
          });
        } else {
          resolve({ ok: true, json: () => Promise.resolve({}) });
        }
      });
    });

    let ctx;
    await act(async () => {
      render(
        <AppProvider>
          <StateDriver onReady={(c) => { ctx = c; }} />
        </AppProvider>
      );
    });
    expect(ctx).toBeTruthy();

    consoleErrorSpy.mockClear();

    await act(async () => {
      ctx.updateState({ test: "first" });
    });

    await act(async () => {
      vi.advanceTimersByTime(650);
    });

    expect(postBodies.length).toBeGreaterThanOrEqual(1);

    await act(async () => {
      ctx.updateState({ test: "second" });
    });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(650);
    });

    await act(async () => {
      await Promise.resolve();
    });

    const airgapErrors = consoleErrorSpy.mock.calls.filter((call) =>
      call.some((arg) => typeof arg === "string" && arg.includes("[AirgapArchitect]"))
    );
    expect(airgapErrors, "logError must not fire for an expected abort").toHaveLength(0);

    const stored = JSON.parse(localStorage.getItem("airgap-architect-state"));
    expect(stored.test).toBe("second");

    const lastPostBody = postBodies[postBodies.length - 1];
    expect(lastPostBody.test).toBe("second");
  });

  it("genuine persistence failure: logError fires with api_request operation and original error", async () => {
    globalThis.fetch = vi.fn((url, opts) => {
      if (!opts?.method || opts.method === "GET") {
        return Promise.resolve(makeHydrationResponse());
      }
      return Promise.reject(new TypeError("Failed to fetch"));
    });

    let ctx;
    await act(async () => {
      render(
        <AppProvider>
          <StateDriver onReady={(c) => { ctx = c; }} />
        </AppProvider>
      );
    });
    expect(ctx).toBeTruthy();

    consoleErrorSpy.mockClear();

    await act(async () => {
      ctx.updateState({ test: "will-fail" });
    });

    await act(async () => {
      vi.advanceTimersByTime(650);
    });

    await act(async () => {
      await Promise.resolve();
    });

    const airgapErrors = consoleErrorSpy.mock.calls.filter((call) =>
      call.some((arg) => typeof arg === "string" && arg.includes("[AirgapArchitect]"))
    );
    expect(airgapErrors.length, "logError must fire for genuine failure").toBeGreaterThan(0);

    const hasFailedFetch = consoleErrorSpy.mock.calls.some((call) =>
      call.some((arg) => {
        if (arg && typeof arg === "object" && arg.message) return arg.message.includes("Failed to fetch");
        return false;
      })
    );
    expect(hasFailedFetch, "error must contain the original failure reason").toBe(true);

    const hasApiRequestOp = consoleErrorSpy.mock.calls.some((call) =>
      call.some((arg) => arg?.operation === "api_request")
    );
    expect(hasApiRequestOp, "error must be classified as api_request").toBe(true);
  });
});

describe("apiFetch — abort classification", () => {
  let consoleErrorSpy;
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    consoleErrorSpy.mockRestore();
  });

  it("expected abort: rethrows AbortError without logError when signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    globalThis.fetch = vi.fn(() =>
      Promise.reject(new DOMException("The operation was aborted", "AbortError"))
    );

    consoleErrorSpy.mockClear();

    let caughtErr = null;
    try {
      await apiFetch("/api/test", { signal: controller.signal });
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr).not.toBeNull();
    expect(caughtErr.name).toBe("AbortError");

    const airgapErrors = consoleErrorSpy.mock.calls.filter((call) =>
      call.some((arg) => typeof arg === "string" && arg.includes("[AirgapArchitect]"))
    );
    expect(airgapErrors, "logError must not fire for expected abort").toHaveLength(0);
  });

  it("genuine error: logError fires with api_request operation", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.reject(new TypeError("Failed to fetch"))
    );

    consoleErrorSpy.mockClear();

    let caughtErr = null;
    try {
      await apiFetch("/api/test");
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr).not.toBeNull();

    const airgapErrors = consoleErrorSpy.mock.calls.filter((call) =>
      call.some((arg) => typeof arg === "string" && arg.includes("[AirgapArchitect]"))
    );
    expect(airgapErrors.length, "logError must fire for genuine error").toBeGreaterThan(0);

    const hasApiRequestOp = consoleErrorSpy.mock.calls.some((call) =>
      call.some((arg) => arg?.operation === "api_request")
    );
    expect(hasApiRequestOp, "must be classified as api_request").toBe(true);
  });

  it("false AbortError name without signal: logged as genuine error", async () => {
    const fakeAbort = new Error("not really aborted");
    fakeAbort.name = "AbortError";

    globalThis.fetch = vi.fn(() => Promise.reject(fakeAbort));

    consoleErrorSpy.mockClear();

    let caughtErr = null;
    try {
      await apiFetch("/api/test");
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr).not.toBeNull();

    const airgapErrors = consoleErrorSpy.mock.calls.filter((call) =>
      call.some((arg) => typeof arg === "string" && arg.includes("[AirgapArchitect]"))
    );
    expect(airgapErrors.length, "logError must fire for spoofed AbortError without aborted signal").toBeGreaterThan(0);
  });

  it("spoofed Error named AbortError with aborted signal: not classified as genuine browser AbortError", async () => {
    const controller = new AbortController();
    controller.abort();

    const fakeAbort = new Error("spoofed abort");
    fakeAbort.name = "AbortError";

    globalThis.fetch = vi.fn(() => Promise.reject(fakeAbort));

    consoleErrorSpy.mockClear();

    let caughtErr = null;
    try {
      await apiFetch("/api/test", { signal: controller.signal });
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr).not.toBeNull();
    expect(caughtErr.name).toBe("AbortError");
    expect(caughtErr instanceof DOMException, "must be a plain Error, not DOMException").toBe(false);

    const airgapErrors = consoleErrorSpy.mock.calls.filter((call) =>
      call.some((arg) => typeof arg === "string" && arg.includes("[AirgapArchitect]"))
    );
    expect(airgapErrors.length, "logError must fire for non-DOMException AbortError even with aborted signal").toBeGreaterThan(0);
  });
});
