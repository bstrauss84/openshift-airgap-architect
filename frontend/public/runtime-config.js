// Development / build-time default. The production container REPLACES this at
// /runtime-config.js with a file generated from the container environment (see
// frontend/container/oaa-entrypoint.sh), which is how VITE_API_BASE remains a
// deployment-time setting after the move from the Vite dev server to a static
// build. An empty apiBase means "use the build-time default" — see src/api.js.
window.__OAA_RUNTIME_CONFIG__ = { apiBase: "" };
