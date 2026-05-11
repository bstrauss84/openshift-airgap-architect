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

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

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
        duration
      });
    }

    return res.json();
  } catch (err) {
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
