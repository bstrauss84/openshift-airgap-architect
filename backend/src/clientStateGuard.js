/**
 * Validates client-supplied wizard state on POST bodies (generate, bundle.prepare, bundle.zip).
 * Rejects arrays, non-objects, and exotic prototypes to reduce prototype-pollution and mistaken payloads.
 */

/** @param {() => object} getFallback - called only when body omits state (e.g. ensureState). */
export function parseOptionalClientState(bodyState, getFallback) {
  if (bodyState === undefined || bodyState === null) {
    return { ok: true, state: getFallback() };
  }
  if (typeof bodyState !== "object" || Array.isArray(bodyState)) {
    return { ok: false, error: "State must be a plain JSON object." };
  }
  const proto = Object.getPrototypeOf(bodyState);
  if (proto !== null && proto !== Object.prototype) {
    return { ok: false, error: "State must be a plain JSON object." };
  }
  return { ok: true, state: bodyState };
}
