/**
 * A controllable replacement for `src/store.jsx`, for tests that need to drive
 * the REAL App tree (ErrorBoundary → ShellViewProvider → VersionSupportGate →
 * AppShell) rather than a component in isolation.
 *
 * Why this exists. `App` mounts its own `<AppProvider>`, so wrapping `<App />`
 * in an `AppContext.Provider` from the outside has no effect — the real
 * provider wins and the test silently stops testing the state it set up. And
 * `AppShell` is not exported, so it cannot be rendered directly either.
 *
 * This harness replaces ONLY the provider's data source. Context propagation,
 * `useApp`, and every component under test stay real, and the test gets a
 * handle it can use to change state the way the UI would — which is what makes
 * version-switch behaviour observable at the layer the user experiences it.
 */
import React, { useMemo, useState } from "react";

/**
 * @param actual the real store module, from `importOriginal()`
 * @param handle a `vi.hoisted` object; `handle.initialState` is the state the
 *        provider mounts with, and the harness assigns `handle.setState` /
 *        `handle.updateState` so a test can drive it.
 */
export function makeStoreMock(actual, handle) {
  const HarnessProvider = ({ children }) => {
    const [state, setState] = useState(() => handle.initialState);

    // Mirrors the real provider's merge semantics exactly (store.jsx:95), so a
    // test exercises the same state transitions production does.
    const updateState = (patch) =>
      setState((prev) => ({
        ...prev,
        ...patch,
        version: patch.version ? { ...prev.version, ...patch.version } : prev.version,
      }));

    handle.setState = setState;
    handle.updateState = updateState;

    const startOver = async () => {
      const next = handle.startOverState ?? handle.initialState;
      setState(next);
      return next;
    };

    const value = useMemo(
      () => ({ state, setState, updateState, loading: false, schemaError: null, startOver }),
      [state]
    );

    return <actual.AppContext.Provider value={value}>{children}</actual.AppContext.Provider>;
  };

  return { ...actual, AppProvider: HarnessProvider };
}
