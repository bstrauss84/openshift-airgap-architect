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
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

const apiFetch = async (path, options = {}) => {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!res.ok) {
    const text = await res.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {}
    const error = new Error(parsed?.error || parsed?.message || text || res.statusText);
    error.status = res.status;
    if (parsed) error.payload = parsed;
    throw error;
  }
  return res.json();
};

export { API_BASE, apiFetch };
