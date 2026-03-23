/** App state context; syncs to backend and localStorage. getStateForPersistence strips credentials before persist. */
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch } from "./api.js";

const AppContext = createContext(null);

const STORAGE_KEY = "airgap-architect-state";

/** State suitable for persistence: never includes ephemeral or credential secrets unless opted in. Exported for tests. */
export function getStateForPersistence(state) {
  if (!state) return state;
  const next = JSON.parse(JSON.stringify(state));
  if (next?.blueprint && "blueprintPullSecretEphemeral" in next.blueprint) {
    delete next.blueprint.blueprintPullSecretEphemeral;
  }
  if (next?.credentials) {
    delete next.credentials.pullSecretPlaceholder;
    delete next.credentials.mirrorRegistryPullSecret;
  }
  if (next?.platformConfig?.vsphere) {
    const vs = next.platformConfig.vsphere;
    delete vs.username;
    delete vs.password;
    if (Array.isArray(vs.vcenters)) {
      vs.vcenters = vs.vcenters.map((vc) => {
        const { user, password, ...rest } = vc;
        return rest;
      });
    }
  }
  return next;
}

const useAppProvider = () => {
  const [state, setState] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : null;
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/api/state")
      .then((data) => {
        setState(data);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(getStateForPersistence(data)));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!state) return;
    const toPersist = getStateForPersistence(state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toPersist));
    const timeout = setTimeout(() => {
      apiFetch("/api/state", { method: "POST", body: JSON.stringify(toPersist) }).catch(() => {});
    }, 600);
    return () => clearTimeout(timeout);
  }, [state]);

  const updateState = (patch) => setState((prev) => ({ ...prev, ...patch }));

  const startOver = async (options = {}) => {
    const cancelRunningOcMirror = options.cancelRunningOcMirror !== false;
    const data = await apiFetch("/api/start-over", {
      method: "POST",
      body: JSON.stringify({ cancelRunningOcMirror })
    });
    const next = {
      ...data,
      reviewFlags: {
        methodology: false,
        global: false,
        inventory: false,
        operators: false,
        review: false
      },
      ui: {
        ...(data.ui || {}),
        activeStepId: "blueprint",
        visitedSteps: {},
        completedSteps: {}
      }
    };
    localStorage.removeItem(STORAGE_KEY);
    setState(next);
    return next;
  };

  return { state, setState, updateState, loading, startOver };
};

const AppProvider = ({ children }) => {
  const ctx = useAppProvider();
  const value = useMemo(() => ctx, [ctx.state, ctx.loading]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

const useApp = () => useContext(AppContext);

export { AppProvider, useApp, AppContext };
