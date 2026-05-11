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

let sessionId = null;
let requestCounter = 0;

/**
 * Generate or retrieve the session ID for this browser session
 */
function getSessionId() {
  if (!sessionId) {
    sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
  return sessionId;
}

/**
 * Generate a unique request ID for API calls
 */
export function generateRequestId() {
  requestCounter++;
  return `req_${getSessionId()}_${requestCounter}`;
}

/**
 * Log a key action with optional safe context (stepId, action name). Do not pass state or user input that may contain secrets.
 * @param {string} action - e.g. "step_change", "generate_preview", "download_bundle", "export_run", "import_run", "theme_toggle", "flow_toggle"
 * @param {Record<string, unknown>} [context] - optional safe key/value (e.g. { stepId, fromStepId, toStepId }). No credentials.
 */
export function logAction(action, context = {}) {
  const payload = {
    action,
    timestamp: new Date().toISOString(),
    sessionId: getSessionId(),
    ...context
  };
  if (typeof window !== "undefined" && window.console?.info) {
    window.console.info(`${PREFIX}`, payload);
  }
}

/**
 * Log a warning when user input is normalized or ignored
 * @param {string} field - Field name that was normalized
 * @param {string} reason - Why it was normalized
 * @param {Record<string, unknown>} [context] - Additional safe context
 */
export function logNormalization(field, reason, context = {}) {
  logAction("input_normalized", { field, reason, ...context });
}

/**
 * Log an error with context (no sensitive data)
 * @param {string} operation - What operation failed
 * @param {string} message - Error message
 * @param {Record<string, unknown>} [context] - Additional safe context
 */
export function logError(operation, message, context = {}) {
  const payload = {
    action: "error",
    operation,
    message,
    timestamp: new Date().toISOString(),
    sessionId: getSessionId(),
    ...context
  };
  if (typeof window !== "undefined" && window.console?.error) {
    window.console.error(`${PREFIX}`, payload);
  }
}
