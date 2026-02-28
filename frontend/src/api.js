/** Thin fetch wrapper for backend API; VITE_API_BASE for container/proxy.
 * Empty string = same-origin (Ingress proxies /api); unset = localhost for dev. */
const API_BASE =
  import.meta.env.VITE_API_BASE !== undefined ? String(import.meta.env.VITE_API_BASE) : "http://localhost:4000";

const apiFetch = async (path, options = {}) => {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const parsed = JSON.parse(text);
      throw new Error(parsed.error || parsed.message || text || res.statusText);
    } catch {
      throw new Error(text || res.statusText);
    }
  }
  return res.json();
};

export { API_BASE, apiFetch };
