/**
 * OpenShift Airgap Architect - build registry auth JSON in the browser (v2.2.0)
 *
 * Turns a registry address, a user name and a password or token into the
 * Docker/Podman auth JSON oc-mirror reads ({"auths":{"<registry>":{"auth":"…"}}}),
 * in memory only. Mirrors the server's rules (backend/src/registryAuth.js): keys
 * are normalized only in ways that cannot redirect a credential, and combining
 * with existing entries refuses a registry that would change account silently.
 *
 * Base64 is an encoding, not protection. Nothing here stores, logs or copies a
 * value anywhere; the caller puts the result into an in-memory form field.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */

const REGISTRY_KEY_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?(\/[A-Za-z0-9._\-/]*)?$/;

/** The registry an address names (scheme/trailing slash dropped, host lower-cased), or null. */
export function normalizeRegistryKey(raw) {
  if (typeof raw !== "string") return null;
  const k = raw.trim().replace(/^(https?|docker):\/\//i, "").replace(/\/+$/, "");
  if (!k || k.length > 255 || /[@\s?#]/.test(k)) return null;
  const slash = k.indexOf("/");
  const host = (slash < 0 ? k : k.slice(0, slash)).toLowerCase();
  const key = `${host}${slash < 0 ? "" : k.slice(slash)}`;
  if (key === "index.docker.io/v1") return key;
  return REGISTRY_KEY_RE.test(key) ? key : null;
}

/** base64 of "user:password" as UTF-8 — window.btoa alone fails on non-Latin-1 characters. */
export function encodeBasicAuth(username, password) {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Registries named by an existing auth JSON (names only), or null when it is not readable auth JSON. */
export function registriesIn(text) {
  if (!text || !text.trim()) return [];
  try {
    const parsed = JSON.parse(text);
    const auths = parsed && typeof parsed === "object" && parsed.auths && typeof parsed.auths === "object" ? parsed.auths : null;
    return auths ? Object.keys(auths).map((k) => normalizeRegistryKey(k) || k) : null;
  } catch {
    return null;
  }
}

/** Problems with one entry the user typed, keyed by field ("" = fine). Never includes the values. */
export function entryProblems({ registry, username, password }) {
  return {
    registry: !registry?.trim() ? "Enter the registry address, for example mirror.example.com:8443." : normalizeRegistryKey(registry) ? "" : "Use host[:port], optionally with a path, and no user name, password or https://user@ in it.",
    username: !username?.trim() ? "Enter the user name (for a token, the name the registry expects, for example the robot account)." : /:/.test(username) ? "A user name cannot contain a colon." : "",
    password: !password ? "Enter the password or access token." : ""
  };
}

/**
 * Auth JSON for the entries, optionally combined with existing auth JSON.
 * Throws an Error whose message names registries only.
 * @param {{registry: string, username: string, password: string}[]} entries
 * @param {{ existing?: string, keepExisting?: boolean }} opts
 */
export function buildAuthJson(entries, { existing = "", keepExisting = false } = {}) {
  const auths = {};
  if (keepExisting && existing.trim()) {
    let parsed;
    try { parsed = JSON.parse(existing); } catch { throw new Error("The credentials already in the field are not valid JSON, so they cannot be kept. Clear the field or fix it first."); }
    const prev = parsed?.auths && typeof parsed.auths === "object" ? parsed.auths : null;
    if (!prev) throw new Error('The credentials already in the field have no "auths" section, so they cannot be kept.');
    for (const [k, v] of Object.entries(prev)) auths[normalizeRegistryKey(k) || k] = v;
  }
  const seen = new Set();
  for (const e of entries) {
    const key = normalizeRegistryKey(e.registry);
    if (!key) throw new Error("A registry address is not valid.");
    if (seen.has(key)) throw new Error(`${key} is listed twice. Keep one entry per registry.`);
    seen.add(key);
    const entry = { auth: encodeBasicAuth(e.username.trim(), e.password) };
    if (auths[key] && JSON.stringify(auths[key]) !== JSON.stringify(entry)) {
      throw new Error(`${key} is already in the field with different credentials. Remove it there, or do not keep the existing entries.`);
    }
    auths[key] = entry;
  }
  return JSON.stringify({ auths });
}

/**
 * Registries that need no credentials (OKD-documented placeholder, used by
 * Install's "Anonymous pulls" and Mirroring's anonymous destination):
 * https://github.com/orgs/okd-project/discussions/1930 — base64 of "id:pass\n".
 */
export const OKD_ANONYMOUS_DOC_URL = "https://github.com/orgs/okd-project/discussions/1930";
export const OKD_PLACEHOLDER_AUTH = "aWQ6cGFzcwo=";

/** The placeholder auth JSON for one registry (same document Install emits). */
export function anonymousRegistryAuthJson(registry) {
  return JSON.stringify({ auths: { [registry]: { auth: OKD_PLACEHOLDER_AUTH, email: "" } } });
}
