/**
 * OpenShift Airgap Architect - State Sanitizer (backend entry point)
 *
 * The implementation moved to shared/stateSanitizer.js so the frontend's localStorage
 * boundary and this SQLite boundary answer "which fields must never be persisted" from
 * ONE list. See that file for why.
 *
 * This re-export keeps every existing backend import path working unchanged.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */
export {
  stripProxyCredentials,
  sanitizeCredentialFields,
  sanitizeStateForPersistence,
} from "../../shared/stateSanitizer.js";
