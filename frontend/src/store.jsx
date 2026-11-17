/**
 * OpenShift Airgap Architect - Application State Management
 *
 * App state context; syncs to backend and localStorage.
 * getStateForPersistence strips credentials before persist for security.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "./api.js";
import { detectUnknownSchema } from "./shared/versionHelpers.js";
import { sanitizeStateForPersistence } from "../../shared/stateSanitizer.js";

const AppContext = createContext(null);

const STORAGE_KEY = "airgap-architect-state";

/** Debounce window for POST /api/state. Exported so tests cannot drift from it. */
export const SAVE_DEBOUNCE_MS = 600;

/**
 * State suitable for browser persistence (localStorage).
 *
 * Delegates to the SHARED sanitizer, the same one the backend applies before writing
 * SQLite, so the two persistence boundaries cannot disagree about what counts as a
 * credential.
 *
 * This previously stripped only the pull secrets and vSphere, while the backend's list
 * also covered AWS `secretAccessKey`, Azure `clientSecret`, IBM Cloud `apiKey`, Nutanix
 * `prismPassword`, BMC passwords, embedded proxy passwords and `sshPrivateKey`. Those
 * therefore reached localStorage even though the server deliberately refused to store
 * them. Runtime credential canaries caught it; see
 * frontend/tests/credential-canary-browser-storage.test.js.
 *
 * Nothing functional is lost by stripping more here: on mount the app hydrates from
 * GET /api/state, which already returns the server-sanitized state, so localStorage was
 * never able to carry these fields across a reload in a usable way.
 *
 * Exported for tests.
 */
export function getStateForPersistence(state) {
  if (!state) return state;
  return sanitizeStateForPersistence(state);
}

const useAppProvider = () => {
  const [state, setState] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : null;
  });
  const [loading, setLoading] = useState(true);
  const [schemaError, setSchemaError] = useState(null);

  useEffect(() => {
    apiFetch("/api/state")
      .then((data) => {
        // Check for unknown/future schema before applying state
        const unknownSchema = detectUnknownSchema(data);
        if (unknownSchema) {
          setSchemaError(unknownSchema);
          setLoading(false);
          return;
        }

        setState(data);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(getStateForPersistence(data)));
      })
      .catch((err) => {
        // API/network error during hydration - surface error instead of silently using stale localStorage
        console.error("Failed to load state from backend:", err);
        setSchemaError({
          schemaVersion: "unknown",
          message: `Failed to load configuration from backend: ${err.message}. The application may not function correctly.`
        });
      })
      .finally(() => setLoading(false));
  }, []);

  /**
   * Persistence bookkeeping for the debounced POST /api/state.
   *
   * A plain debounce is not enough once anything needs to READ the server copy.
   * "Tools -> Export Run" downloads GET /api/run/export, which serialises what the
   * SERVER holds, so during the debounce window the exported file silently predates
   * the user's most recent edit. The old code also swallowed save failures with
   * `.catch(() => {})`, so a rejected save left the UI believing it was saved and
   * the next export would quietly hand back pre-edit data.
   *
   * Generations make both cases decidable without guessing:
   *   - every state change takes the next generation number;
   *   - a save that succeeds advances `savedGenerationRef` to its own generation;
   *   - anything pending is simply `pendingRef.generation > savedGenerationRef`.
   *
   * Comparing generations rather than storing a boolean is what makes out-of-order
   * responses safe: a late reply for an older generation cannot move the watermark
   * backwards, so it cannot mark a newer edit as saved.
   */
  const generationRef = useRef(0);
  const savedGenerationRef = useRef(0);
  const pendingRef = useRef(null);
  const timerRef = useRef(null);
  const controllerRef = useRef(null);
  const inFlightRef = useRef(null);
  const [saveError, setSaveError] = useState(null);

  const persist = useCallback(async (entry) => {
    const { generation, body } = entry;
    const controller = new AbortController();
    controllerRef.current = controller;

    const promise = (async () => {
      try {
        await apiFetch("/api/state", { method: "POST", body, signal: controller.signal });
        if (generation > savedGenerationRef.current) {
          savedGenerationRef.current = generation;
        }
        if (pendingRef.current && pendingRef.current.generation <= savedGenerationRef.current) {
          pendingRef.current = null;
        }
        setSaveError(null);
        return { ok: true };
      } catch (err) {
        // An abort is a supersede or an unmount, not a user-visible failure: the
        // newer generation owns the outcome, so do not surface an error for it.
        if (err?.name === "AbortError" || controller.signal.aborted) {
          return { ok: false, aborted: true, error: "superseded" };
        }
        const message = err?.message || String(err);
        setSaveError(message);
        return { ok: false, error: message };
      } finally {
        if (inFlightRef.current?.generation === generation) inFlightRef.current = null;
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    })();

    inFlightRef.current = { generation, promise };
    return promise;
  }, []);

  useEffect(() => {
    if (!state) return;
    const toPersist = getStateForPersistence(state);
    const body = JSON.stringify(toPersist);
    localStorage.setItem(STORAGE_KEY, body);

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    pendingRef.current = { generation, body };

    const timeout = setTimeout(() => {
      if (timerRef.current === timeout) timerRef.current = null;
      persist({ generation, body });
    }, SAVE_DEBOUNCE_MS);
    timerRef.current = timeout;

    return () => {
      clearTimeout(timeout);
      if (timerRef.current === timeout) timerRef.current = null;
      controllerRef.current?.abort();
    };
  }, [state, persist]);

  /**
   * Force any pending save to complete, and report whether the server copy is now
   * current. Callers that are about to READ server-side state (Export Run) must
   * await this and must not proceed on `{ ok: false }` — an export built on a
   * failed save is a backup the user would trust and should not.
   */
  const flushPendingSave = useCallback(async () => {
    if (inFlightRef.current) {
      try {
        await inFlightRef.current.promise;
      } catch {
        /* settled below via the generation watermark */
      }
    }

    const pending = pendingRef.current;
    if (!pending || pending.generation <= savedGenerationRef.current) {
      // Nothing outstanding. Still refuse if the last attempt failed, because the
      // server copy is then known to be behind the browser.
      return saveError ? { ok: false, error: saveError } : { ok: true };
    }

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const result = await persist(pending);
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }, [persist, saveError]);

  const updateState = (patch) =>
    setState((prev) => ({
      ...prev,
      ...patch,
      // Preserve nested version metadata from v3 schema during partial updates
      version: patch.version
        ? { ...prev.version, ...patch.version }
        : prev.version
    }));

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

  return { state, setState, updateState, loading, schemaError, startOver, flushPendingSave, saveError };
};

const AppProvider = ({ children }) => {
  const ctx = useAppProvider();
  const value = useMemo(() => ctx, [ctx.state, ctx.loading, ctx.schemaError, ctx.saveError]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

const useApp = () => useContext(AppContext);

export { AppProvider, useApp, AppContext };
