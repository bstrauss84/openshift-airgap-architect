/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import "@testing-library/jest-dom/vitest";

// jsdom 25+ requires a non-opaque origin for localStorage which vitest's
// environmentOptions doesn't always apply correctly. Provide a working mock.
if (typeof globalThis.localStorage === "undefined" || typeof globalThis.localStorage.getItem !== "function") {
  const store = {};
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      clear: () => { for (const k in store) delete store[k]; },
      get length() { return Object.keys(store).length; },
      key: (i) => Object.keys(store)[i] ?? null
    },
    writable: false,
    configurable: true
  });
}
