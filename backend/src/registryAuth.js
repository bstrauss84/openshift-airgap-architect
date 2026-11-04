/**
 * OpenShift Airgap Architect - registry credentials for one oc-mirror run (v2.2.0)
 *
 * Docker/Podman auth JSON ({"auths":{"<registry>":{"auth":"<base64 user:pass>"}}})
 * is parsed, checked and combined here before it is written to the run's
 * temporary auth file. Base64 is an encoding, not protection: these values are
 * credentials and are never logged, stored or echoed — every message below names
 * registries and problems, never values.
 *
 * - Keys are normalized only in ways that cannot redirect a credential:
 *   "https://registry.example.com/" and "registry.example.com" are the same registry; ports and repository
 *   paths are kept; nothing is mapped to another host.
 * - Entries need "auth" (base64 of user:password, UTF-8) or username + password
 *   (converted), or an identity token. Anything else is refused.
 * - Combining source and destination credentials refuses a registry that appears
 *   in both with different values instead of letting one silently win.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */

const MAX_AUTH_JSON_BYTES = 256 * 1024;
const MAX_ENTRIES = 200;
// host[:port][/path], lower-case host; no scheme, no credentials, no query.
const REGISTRY_KEY_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?(\/[A-Za-z0-9._\-/]*)?$/;

export class RegistryAuthError extends Error {
  constructor(message, code = "REGISTRY_AUTH_INVALID") {
    super(message);
    this.code = code;
  }
}

/**
 * The registry an auth key names, or null when it is not a registry reference.
 * Only the scheme, a trailing slash and the host's letter case are normalized.
 */
export function normalizeRegistryKey(raw) {
  if (typeof raw !== "string") return null;
  let k = raw.trim();
  k = k.replace(/^(https?|docker):\/\//i, "").replace(/\/+$/, "");
  if (!k || k.length > 255 || /[@\s?#]/.test(k)) return null;
  const slash = k.indexOf("/");
  const host = (slash < 0 ? k : k.slice(0, slash)).toLowerCase();
  const rest = slash < 0 ? "" : k.slice(slash);
  const key = `${host}${rest}`;
  // Docker Hub's historical key is kept as written (it is what clients send).
  if (key === "index.docker.io/v1") return "index.docker.io/v1";
  return REGISTRY_KEY_RE.test(key) ? key : null;
}

const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const decodeAuth = (b64) => {
  if (typeof b64 !== "string" || !b64 || b64.length > 8192 || !B64_RE.test(b64)) return null;
  const text = Buffer.from(b64, "base64").toString("utf8");
  // Round-trip guards against data that is not really base64 text.
  if (Buffer.from(text, "utf8").toString("base64").replace(/=+$/, "") !== b64.replace(/=+$/, "")) return null;
  const i = text.indexOf(":");
  return i > 0 && i < text.length - 1 ? text : null;
};

const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);

/** base64 of "user:password" as UTF-8 (passwords may contain any character). */
export const encodeBasicAuth = (username, password) => Buffer.from(`${username}:${password}`, "utf8").toString("base64");

/**
 * Parse and check one credential JSON.
 * @param {string|object} input
 * @param {string} label what the user calls it ("Red Hat pull secret", "destination registry credentials")
 * @returns {Record<string, object>} normalized auths
 */
export function parseRegistryAuth(input, label = "credentials") {
  let raw = input;
  if (typeof raw !== "string") raw = JSON.stringify(raw ?? null);
  if (Buffer.byteLength(raw, "utf8") > MAX_AUTH_JSON_BYTES) throw new RegistryAuthError(`${cap(label)}: larger than 256 KB.`);
  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    throw new RegistryAuthError(`${cap(label)}: not valid JSON. Paste the whole {"auths":{…}} document, or use Help me generate.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new RegistryAuthError(`${cap(label)}: must be a JSON object with "auths".`);
  const auths = parsed.auths && typeof parsed.auths === "object" && !Array.isArray(parsed.auths) ? parsed.auths : parsed;
  const keys = Object.keys(auths);
  if (!keys.length) throw new RegistryAuthError(`${cap(label)}: no registry is listed.`);
  if (keys.length > MAX_ENTRIES) throw new RegistryAuthError(`${cap(label)}: more than ${MAX_ENTRIES} registries.`);
  const out = {};
  for (const [index, rawKey] of keys.entries()) {
    const key = normalizeRegistryKey(rawKey);
    // The key itself is not repeated: it may hold credentials (user:password@host).
    if (!key) throw new RegistryAuthError(`${cap(label)}: entry ${index + 1} is not a registry address. Use host[:port] with no user name or password in it, for example registry.example.com or mirror.example.com:8443.`);
    const e = auths[rawKey];
    if (!e || typeof e !== "object" || Array.isArray(e)) throw new RegistryAuthError(`${cap(label)}: the entry for ${key} is not an object.`);
    let entry;
    if (typeof e.auth === "string" && e.auth) {
      if (!decodeAuth(e.auth)) throw new RegistryAuthError(`${cap(label)}: the entry for ${key} has an "auth" value that is not base64 of username:password.`);
      entry = { auth: e.auth };
    } else if (typeof e.username === "string" && e.username && typeof e.password === "string" && e.password) {
      entry = { auth: encodeBasicAuth(e.username, e.password) };
    } else if (typeof e.identitytoken === "string" && e.identitytoken) {
      entry = { identitytoken: e.identitytoken };
    } else {
      throw new RegistryAuthError(`${cap(label)}: the entry for ${key} has no "auth", username and password, or identity token.`);
    }
    if (out[key] && JSON.stringify(out[key]) !== JSON.stringify(entry)) {
      throw new RegistryAuthError(`${cap(label)}: ${key} is listed twice with different values.`);
    }
    out[key] = entry;
  }
  return out;
}

/**
 * Combine credential sets for one run. A registry that appears in more than one
 * set must have the same value in each; otherwise the run is refused.
 * @param {{ label: string, auths: Record<string, object> }[]} sets
 */
export function combineRegistryAuths(sets) {
  const out = {};
  const from = {};
  for (const { label, auths } of sets) {
    for (const [key, entry] of Object.entries(auths || {})) {
      if (out[key] && JSON.stringify(out[key]) !== JSON.stringify(entry)) {
        throw new RegistryAuthError(`${from[key]} and ${label} both contain ${key} with different credentials. Keep it in one of them only, so it is clear which account is used.`, "REGISTRY_AUTH_CONFLICT");
      }
      out[key] = entry;
      from[key] = from[key] || label;
    }
  }
  return out;
}

/** The auth file document for oc-mirror (--authfile). */
export const authFileDocument = (auths) => JSON.stringify({ auths });
