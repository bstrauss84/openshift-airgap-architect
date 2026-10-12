/**
 * OpenShift Airgap Architect - Frontend API Client
 *
 * Thin fetch wrapper for backend API communication.
 * VITE_API_BASE environment variable configures API endpoint for containerized deployments.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
import { generateRequestId, logError } from "./logger.js";

/**
 * Resolution order, most specific first:
 *
 *   1. window.__OAA_RUNTIME_CONFIG__.apiBase — written at container start from
 *      the VITE_API_BASE environment variable. This exists because a Vite
 *      production build inlines `import.meta.env` at BUILD time, so without it
 *      the documented runtime override (docker-compose.yml `environment:`, and
 *      the frontend Deployment's ConfigMap) would silently stop working the
 *      moment the Vite dev server was replaced by a static build.
 *   2. import.meta.env.VITE_API_BASE — the dev server, and any build that bakes
 *      a value deliberately.
 *   3. localhost:4000 — the documented same-host default.
 *
 * An empty string at step 1 means "not configured", not "use an empty origin".
 */
const runtimeApiBase =
  typeof window !== "undefined" ? window.__OAA_RUNTIME_CONFIG__?.apiBase : undefined;
const API_BASE = runtimeApiBase || import.meta.env.VITE_API_BASE || "http://localhost:4000";

function isExpectedAbort(err, signal) {
  return !!err && err instanceof DOMException && err.name === "AbortError" && signal?.aborted === true;
}

const apiFetch = async (path, options = {}) => {
  const requestId = generateRequestId();
  const startTime = Date.now();

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": requestId,
        ...options.headers
      },
      ...options
    });

    const duration = Date.now() - startTime;

    if (!res.ok) {
      const text = await res.text();
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {}
      const errorMsg = parsed?.error || parsed?.message || text || res.statusText;

      logError("api_request", errorMsg, {
        requestId,
        path,
        method: options.method || "GET",
        status: res.status,
        duration
      });

      const error = new Error(errorMsg);
      error.status = res.status;
      error.requestId = requestId;
      if (parsed) error.payload = parsed;
      throw error;
    }

    // Log slow requests (>2s) as warnings
    if (duration > 2000 && typeof window !== "undefined" && window.console?.warn) {
      window.console.warn(`[AirgapArchitect] Slow request`, {
        requestId,
        path,
        method: options.method || "GET",
        duration: `${duration}ms`
      });
    }

    // Log successful requests (debug mode only)
    if (process.env.NODE_ENV !== "production" && typeof window !== "undefined" && window.console?.debug) {
      window.console.debug(`[AirgapArchitect] Request complete`, {
        requestId,
        path,
        method: options.method || "GET",
        status: res.status,
        duration: `${duration}ms`
      });
    }

    return res.json();
  } catch (err) {
    if (isExpectedAbort(err, options.signal)) throw err;
    // Log network/fetch errors
    if (!err.requestId) {
      logError("api_request", err.message, {
        requestId,
        path,
        method: options.method || "GET",
        duration: Date.now() - startTime
      });
      err.requestId = requestId;
    }
    throw err;
  }
};

export { API_BASE, apiFetch };
