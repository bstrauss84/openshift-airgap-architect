/**
 * OpenShift Airgap Architect - Structured Application Logger
 *
 * Structured logging for key app actions. Never logs credentials, pull secrets, or PII.
 * Used for observability and debugging; safe for production.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

const PREFIX = "[AirgapArchitect]";

/**
 * Log a key action with optional safe context (stepId, action name). Do not pass state or user input that may contain secrets.
 * @param {string} action - e.g. "step_change", "generate_preview", "download_bundle", "export_run", "import_run", "theme_toggle", "flow_toggle"
 * @param {Record<string, unknown>} [context] - optional safe key/value (e.g. { stepId, fromStepId, toStepId }). No credentials.
 */
export function logAction(action, context = {}) {
  const payload = { action, ...context };
  if (typeof window !== "undefined" && window.console?.info) {
    window.console.info(`${PREFIX}`, payload);
  }
}
