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
 *   3. localhost:4000 — the documented same-host default, DEV ONLY.
 *
 * SAME-ORIGIN IS NOW EXPRESSIBLE, AND IS THE PRODUCTION TOPOLOGY.
 *
 * A value of "/api" (or any relative path) means "talk to this page's own
 * origin", which is what the OpenShift deployment uses: nginx in the frontend
 * pod proxies /api to the backend Service, and oauth-proxy authenticates the
 * single Route in front of it. Same-origin is a hard requirement there —
 * oauth-proxy's session is a cookie, and a cross-origin XHR would not carry
 * it.
 *
 * THE LOCALHOST FALLBACK IS NOW DEV-ONLY, deliberately.
 *
 * Previously any unset/empty value fell through to `http://localhost:4000`.
 * In a browser on a user's workstation pointed at a deployed cluster UI, that
 * silently aimed the whole API at the USER'S OWN machine: every call fails
 * confusingly, and if that user happens to run a local backend it reads and
 * writes THEIR data while they believe they are using the cluster. A
 * production build with no configured base must fail loudly instead, so the
 * misconfiguration is visible at once rather than as corrupted state later.
 */
const runtimeApiBase =
  typeof window !== "undefined" ? window.__OAA_RUNTIME_CONFIG__?.apiBase : undefined;

const configuredApiBase = runtimeApiBase || import.meta.env.VITE_API_BASE || "";

function resolveApiBase() {
  if (configuredApiBase) {
    // Trailing slashes would produce "//api/state"; normalise once here.
    return configuredApiBase.replace(/\/+$/, "");
  }
  if (import.meta.env.DEV) {
    return "http://localhost:4000";
  }
  // Production build, nothing configured. Fall back to the page's own origin
  // rather than the user's laptop: a same-origin deployment is the supported
  // topology, so this is the correct guess, and when it is wrong it fails
  // visibly against a real server instead of silently against localhost.
  return "";
}

const API_BASE = resolveApiBase();

/**
 * Header that marks a request as coming from this application.
 *
 * The backend requires it on state-changing requests when it is running
 * behind an authenticating proxy. Its value is never inspected — a plain
 * cross-site <form> cannot set a custom header at all, and `fetch` setting
 * one cross-origin triggers a CORS preflight the backend's origin allowlist
 * then refuses. That is the whole mechanism.
 */
const CSRF_HEADER = "X-OAA-Request";

function isExpectedAbort(err, signal) {
  return !!err && err instanceof DOMException && err.name === "AbortError" && signal?.aborted === true;
}

const apiFetch = async (path, options = {}) => {
  const requestId = generateRequestId();
  const startTime = Date.now();

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      // Send the oauth-proxy session cookie. Default is "same-origin", which
      // is correct for the production topology; naming it explicitly stops a
      // future cross-origin configuration from silently dropping the session
      // and presenting as an unexplained 401.
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": requestId,
        [CSRF_HEADER]: "1",
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
